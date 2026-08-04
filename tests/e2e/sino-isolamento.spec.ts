import { test, expect, type Page } from '@playwright/test'
import { SENHA, carimbo, criarConta } from './apoio'

/**
 * O item de verificacao manual que a Task 11 registrou como NAO executado: a
 * notificacao chega a quem deve e **nao** chega a quem nao deve, com duas
 * sessoes simultaneas de verdade.
 *
 * O isolamento ja esta provado no nivel do banco (notificacoes-store.test.ts:
 * vendedor B nao le a notificacao de A). O que faltava era ve-lo valer no
 * websocket, onde quem roteia e a RLS avaliada por assinante — se o Realtime
 * entregasse por canal em vez de por policy, o teste de integracao continuaria
 * verde e o sino do admin acenderia com notificacao alheia.
 *
 * Dois contextos de navegador porque sao duas sessoes ao mesmo tempo: reusar a
 * mesma page trocaria os cookies e apagaria exatamente o que se quer observar.
 */

async function convidarVendedor(paginaAdmin: Page, email: string): Promise<string> {
  await paginaAdmin.goto('/config')
  await expect(paginaAdmin.getByRole('heading', { name: 'Configuração', level: 1 })).toBeVisible()

  // Mesma sondagem do convite.spec.ts: a tela chega por navegacao de documento
  // inteiro e um clique disparado antes de o React anexar o onClick se perde.
  // "Convidar" com o campo vazio devolve email_invalido e nao escreve nada.
  const convidar = paginaAdmin.getByRole('button', { name: 'Convidar' })
  await expect(async () => {
    await convidar.click()
    await expect(paginaAdmin.getByText('Email inválido.')).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })

  await paginaAdmin.getByPlaceholder('email do convidado').fill(email)
  await convidar.click()

  const codigo = paginaAdmin.locator('code')
  await expect(codigo).toBeVisible()
  const link = (await codigo.textContent())?.trim()
  if (!link) throw new Error('link do convite nao apareceu')
  return link
}

test('a notificacao acende o sino do responsavel e nao o do admin', async ({
  browser,
  request,
}) => {
  const contextoAdmin = await browser.newContext()
  const contextoVendedor = await browser.newContext()

  try {
    const paginaAdmin = await contextoAdmin.newPage()
    await criarConta(paginaAdmin)

    const emailVendedor = `vendedor-${carimbo()}@exemplo.com`
    const link = await convidarVendedor(paginaAdmin, emailVendedor)

    const paginaVendedor = await contextoVendedor.newPage()
    await paginaVendedor.goto(link)
    await paginaVendedor.getByRole('link', { name: 'Criar conta' }).click()
    await paginaVendedor.getByPlaceholder('seu nome', { exact: true }).fill('Vendedor E2E')
    await paginaVendedor.getByPlaceholder('email', { exact: true }).fill(emailVendedor)
    await paginaVendedor.getByPlaceholder('senha (min. 8 caracteres)', { exact: true }).fill(SENHA)
    await paginaVendedor.getByRole('button', { name: 'Criar conta' }).click()
    await expect(paginaVendedor).toHaveURL(/\/funil/)

    // Fonte do Google com o VENDEDOR como responsavel padrao. E o que faz
    // ingerir_lead (0011) gravar a notificacao no nome dele, e nao no do admin.
    await paginaAdmin.goto('/config')
    const nomeDaFonte = `Isolamento ${carimbo()}`
    await paginaAdmin.getByPlaceholder('nome do formulário', { exact: true }).fill(nomeDaFonte)
    await paginaAdmin.getByRole('button', { name: 'Gerar URL do Google' }).click()

    const urlTexto = await paginaAdmin
      .locator('code')
      .filter({ hasText: '/api/webhooks/google/' })
      .textContent()
    const chaveTexto = await paginaAdmin
      .locator('code')
      .filter({ hasText: /^chave: / })
      .textContent()
    expect(urlTexto).toBeTruthy()
    expect(chaveTexto).toBeTruthy()
    const urlDoWebhook = urlTexto!.trim()
    const chaveDoGoogle = chaveTexto!.replace(/^chave:\s*/, '').trim()

    // Esperar a resposta da Server Action, e nao so o evento de DOM do
    // selectOption — a corrida que o Plano 3 encontrou.
    const fonte = paginaAdmin.locator('li').filter({ hasText: nomeDaFonte })
    const respostaResponsavel = paginaAdmin.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/config',
    )
    await fonte.getByRole('combobox').selectOption({ label: 'Vendedor E2E' })
    await respostaResponsavel

    // As duas sessoes ficam paradas no funil pelo resto do teste. Nenhum reload
    // ate a assercao positiva passar: e o que faz o sino do vendedor provar
    // Realtime, e nao render novo do servidor.
    await paginaAdmin.goto('/funil')
    await paginaVendedor.goto('/funil')

    const nomeDoLead = `Lead Isolado ${carimbo()}`
    const resposta = await request.post(urlDoWebhook, {
      data: {
        lead_id: carimbo(),
        google_key: chaveDoGoogle,
        campaign_id: 1,
        form_id: 1,
        user_column_data: [{ column_id: 'FULL_NAME', string_value: nomeDoLead }],
      },
    })
    expect(resposta.ok()).toBe(true)

    const indicadorVendedor = paginaVendedor.getByRole('status', {
      name: 'notificações não lidas',
    })
    const indicadorAdmin = paginaAdmin.getByRole('status', { name: 'notificações não lidas' })

    // ASSERCAO POSITIVA PRIMEIRO. Ate ela passar, "o sino do admin nao acendeu"
    // nao afirma nada: poderia estar apenas observando o instante anterior a
    // notificacao existir. Depois dela, a notificacao esta gravada e o Realtime
    // ja disparou — entao a ausencia no admin passa a ser um fato sobre
    // roteamento, e nao sobre relogio.
    await expect(indicadorVendedor).toHaveText('1', { timeout: 20_000 })

    // Agora sim: o admin, na mesma janela de tempo, nao recebeu nada.
    await expect(indicadorAdmin).toHaveCount(0)

    // E a prova mais forte, que nao depende de timing nenhum: um reload do admin
    // le naoLidas() do banco no servidor. Se a notificacao tivesse ido para ele,
    // apareceria aqui mesmo que o websocket tivesse falhado em entregar.
    await paginaAdmin.reload()
    // Positiva antes da negativa, de novo: prova que a pagina do admin
    // renderizou de verdade, senao "sem indicador" passaria numa tela quebrada.
    await expect(
      paginaAdmin.getByRole('heading', { name: 'Novo lead', exact: true, level: 2 }),
    ).toBeVisible()
    await expect(indicadorAdmin).toHaveCount(0)

    // O lead existe e e do vendedor: o admin ve o card (admin enxerga a conta
    // inteira), entao a ausencia do sino nao e "nao chegou lead nenhum".
    await expect(paginaAdmin.getByRole('link', { name: nomeDoLead })).toBeVisible()
  } finally {
    await contextoAdmin.close()
    await contextoVendedor.close()
  }
})
