import { test, expect } from '@playwright/test'
import { criarConta, carimbo, coluna } from './apoio'
import { PREFIXO_FONTE_GOOGLE_E2E } from './global-setup'

/**
 * A prova de ponta a ponta de que as peças do Plano 4 se encaixam: um POST no
 * webhook do Google (o único que aceita URL local — o do Meta exige HTTPS
 * pública, ver task-13-brief.md) vira card no funil sem reload, e um segundo
 * POST da mesma pessoa vira evento no card existente em vez de duplicar.
 *
 * O sino NÃO é asserido aqui: `sino.spec.ts` (Task 11) já cobre a mesma
 * asserção de Realtime, e repeti-la faria os dois arquivos falharem juntos
 * pelo mesmo motivo sem acrescentar nada.
 */
test('lead do Google vira card sem reload, e o reenvio da mesma pessoa vira evento sem duplicar', async ({
  page,
  request,
}) => {
  await criarConta(page)

  await page.goto('/config')
  const nomeDaFonte = `${PREFIXO_FONTE_GOOGLE_E2E}${carimbo()}`
  await page.getByPlaceholder('nome do formulário', { exact: true }).fill(nomeDaFonte)
  await page.getByRole('button', { name: 'Gerar URL do Google' }).click()

  const urlTexto = await page
    .locator('code')
    .filter({ hasText: '/api/webhooks/google/' })
    .textContent()
  const chaveTexto = await page.locator('code').filter({ hasText: /^chave: / }).textContent()
  expect(urlTexto).toBeTruthy()
  expect(chaveTexto).toBeTruthy()
  const urlDoWebhook = urlTexto!.trim()
  const chaveDoGoogle = chaveTexto!.replace(/^chave:\s*/, '').trim()

  // definirResponsavelAction e Server Action == POST na propria rota: o
  // selectOption do Playwright so espera o evento de DOM, nao a gravacao no
  // banco. Sem esperar a resposta, o goto('/funil') do proximo passo corre na
  // frente da escrita e a fonte as vezes fica sem responsavel_padrao_id — sem
  // ele ingerir_lead (0011) nao grava a notificacao de novo_lead, e o teste
  // falharia por um motivo que nao tem nada a ver com o Realtime. Mesmo
  // padrao de funil.spec.ts e sino.spec.ts.
  const fonte = page.locator('li').filter({ hasText: nomeDaFonte })
  const respostaResponsavel = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/config',
  )
  await fonte.getByRole('combobox').selectOption({ label: 'Cliente E2E' })
  await respostaResponsavel

  // Fica em /funil ate a asserção 6: e o unico jeito de provar que o card
  // chega por Realtime (router.refresh() disparado pelo INSERT em
  // notifications), e nao por um proximo render de servidor motivado por
  // navegacao.
  await page.goto('/funil')

  const telefone = '(83) 99999-0000'
  const nomeDoLead = `Lead Ingestão ${carimbo()}`

  const primeiraEntrega = await request.post(urlDoWebhook, {
    data: {
      lead_id: carimbo(),
      google_key: chaveDoGoogle,
      campaign_id: 1,
      form_id: 1,
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: nomeDoLead },
        { column_id: 'PHONE_NUMBER', string_value: telefone },
      ],
    },
  })
  expect(primeiraEntrega.ok()).toBe(true)

  // Asserção positiva, com timeout generoso: o `after()` da rota processa a
  // entrega DEPOIS de responder 200 (ver route.ts do webhook do Google), entao
  // ha uma janela real entre o POST devolver e o card existir. Esta é a
  // asserção que dá segurança para todas as seguintes — se o card não
  // aparecesse aqui, nada do resto do teste provaria coisa nenhuma.
  const novoLead = coluna(page, 'Novo lead')
  const cartao = novoLead.getByRole('link', { name: nomeDoLead })
  await expect(cartao).toBeVisible({ timeout: 20_000 })

  // Segundo POST: mesma pessoa (mesmo telefone), lead_id diferente — o
  // reenvio que o Google Ads faz quando o mesmo usuario submete o formulario
  // de novo. ingerir_lead (0011) so dedupa contra lead ABERTO com telefone ou
  // email batendo; o card acima acabou de nascer aberto, entao o telefone
  // repetido tem que resolver para reingestao, não para um segundo card.
  const segundaEntrega = await request.post(urlDoWebhook, {
    data: {
      lead_id: carimbo(),
      google_key: chaveDoGoogle,
      campaign_id: 1,
      form_id: 1,
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: nomeDoLead },
        { column_id: 'PHONE_NUMBER', string_value: telefone },
      ],
    },
  })
  expect(segundaEntrega.ok()).toBe(true)

  // Abre a ficha do lead existente para observar a timeline. Isto navega para
  // fora de /funil — tudo bem, a asserção de Realtime já passou acima; esta
  // parte só precisa provar que o dedup do banco funcionou, não que o
  // Realtime também alcança a ficha.
  await cartao.click()
  await expect(page.getByRole('heading', { name: nomeDoLead, exact: true, level: 1 })).toBeVisible()

  const linhaDoTempo = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Linha do tempo', exact: true, level: 2 }) })
  const rotulos = linhaDoTempo.locator('ol > li > p:first-child')

  // Asserção positiva PRIMEIRO: o after() do segundo POST ainda pode estar em
  // voo quando a ficha carrega, então recarrega até o evento aparecer, com
  // timeout generoso. Só depois desta asserção passar é que faz sentido
  // afirmar que não duplicou — do contrário a asserção negativa abaixo
  // poderia estar só observando o instante ANTES do processamento terminar,
  // sem provar dedup nenhum (a corrida que o Plano 3 encontrou, só que aqui
  // do lado da leitura).
  await expect(async () => {
    await page.reload()
    await expect(rotulos.filter({ hasText: /^reingestao$/ })).toHaveCount(1)
  }).toPass({ timeout: 20_000 })

  // Só agora, com a reingestão já confirmada no banco, a asserção negativa
  // tem valor: se ainda houvesse duas leads separadas para o mesmo telefone,
  // o segundo card apareceria aqui.
  await page.goto('/funil')
  await expect(coluna(page, 'Novo lead').getByRole('link', { name: nomeDoLead })).toHaveCount(1)

  // Painel de diagnostico: as duas entregas (criação e reingestão) aparecem
  // como processadas — é o que transforma "não sei se chegou" em diagnóstico
  // (Task 12).
  await page.goto('/config')
  const painelEntregas = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Últimas entregas', exact: true, level: 3 }) })
  await expect(painelEntregas.getByText('Virou lead')).toHaveCount(2)
})
