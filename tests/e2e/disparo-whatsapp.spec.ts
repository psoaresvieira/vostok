import { test, expect, type Page } from '@playwright/test'
import { SENHA, carimbo, coluna, criarConta } from './apoio'
import { NUMERO_FALSO_PADRAO, TOKEN_FALSO_PADRAO } from '@/lib/integracoes/whatsapp-falso'

/**
 * O percurso da spec §10 do Plano 11, ponta a ponta: o admin conecta o WhatsApp
 * (falso), escreve um script da etapa em que o lead esta, submete o script como
 * template, e dispara da ficha do lead — com confirmacao — para um lead que tem
 * todos os dados. A timeline mostra o texto EXATO que foi enviado. Num lead sem
 * empresa, o mesmo botao aparece bloqueado, dizendo por que. E o vendedor da
 * conta dispara, mas nao ve caminho de submissao nenhum.
 *
 * O que este arquivo tranca e que os testes de componente e de unidade nao
 * conseguem: que as TRES identidades funcionam juntas contra o Postgres de
 * verdade (sessao para ler/gravar template e evento, anon+segredo para
 * credencial e status), e que o texto que sai do snapshot posicional no
 * servidor e' byte a byte o que o preview mostrou na tela.
 */

/** A etapa em que o lead nasce — a mesma coluna do funil, e o valor de {{etapa}}. */
const ETAPA_DO_LEAD = 'Novo lead'

/**
 * Copiado de scripts.spec.ts / tarefas.spec.ts pelo mesmo motivo: a tela de
 * configuracao chega por navegacao de documento inteiro, e um clique disparado
 * antes de o React anexar o onClick se perde. "Conectar" com os campos vazios
 * devolve whatsapp_campos_vazios sem escrever nada e serve de sonda ate a
 * hidratacao acontecer.
 */
async function conectarWhatsApp(pagina: Page): Promise<void> {
  await pagina.goto('/config')
  await expect(pagina.getByRole('heading', { name: 'Configuração', level: 1 })).toBeVisible()

  const conectar = pagina.getByRole('button', { name: 'Conectar' })
  await expect(async () => {
    await conectar.click()
    await expect(
      pagina.getByText('Preencha o token, o ID do número e o ID da WABA.'),
    ).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })

  // O par que o WhatsAppGraphFalso aceita sem semeadura (TOKEN_FALSO_PADRAO):
  // o duplo vive no processo do `next dev`, e o teste nao o alcanca de fora.
  await pagina.getByLabel('Token').fill(TOKEN_FALSO_PADRAO)
  await pagina.getByLabel('ID do número').fill(NUMERO_FALSO_PADRAO.phoneNumberId)
  await pagina.getByLabel('ID da WABA').fill(NUMERO_FALSO_PADRAO.wabaId)
  await conectar.click()

  // O que se grava e' o que o Graph devolveu, nunca o formulario.
  await expect(pagina.getByText(NUMERO_FALSO_PADRAO.numeroExibicao)).toBeVisible()
}

async function criarLeadCompleto(
  pagina: Page,
  d: { nome: string; telefone: string; empresa?: string },
): Promise<void> {
  await pagina.goto('/funil')
  await expect(async () => {
    await pagina.getByRole('button', { name: 'Novo lead' }).click()
    await expect(pagina.getByPlaceholder('nome', { exact: true })).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })

  await pagina.getByPlaceholder('nome', { exact: true }).fill(d.nome)
  await pagina.getByPlaceholder('telefone', { exact: true }).fill(d.telefone)
  if (d.empresa) await pagina.getByPlaceholder('empresa', { exact: true }).fill(d.empresa)
  await pagina.getByRole('button', { name: 'Salvar' }).click()

  await expect(coluna(pagina, ETAPA_DO_LEAD).getByRole('link', { name: d.nome })).toBeVisible()
}

/** Mesmo par convite/aceite de scripts.spec.ts. */
async function convidarVendedor(paginaAdmin: Page, email: string): Promise<string> {
  await paginaAdmin.goto('/config')
  await expect(paginaAdmin.getByRole('heading', { name: 'Configuração', level: 1 })).toBeVisible()

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

async function aceitarConvite(paginaConvidado: Page, link: string, nome: string, email: string) {
  await paginaConvidado.goto(link)
  await paginaConvidado.getByRole('link', { name: 'Criar conta' }).click()
  await paginaConvidado.getByPlaceholder('seu nome', { exact: true }).fill(nome)
  await paginaConvidado.getByPlaceholder('email', { exact: true }).fill(email)
  await paginaConvidado.getByPlaceholder('senha (min. 8 caracteres)', { exact: true }).fill(SENHA)
  await paginaConvidado.getByRole('button', { name: 'Criar conta' }).click()
  await expect(paginaConvidado).toHaveURL(/\/funil/)
}

test.describe('disparo de WhatsApp da ficha do lead', () => {
  test('admin conecta, submete o template e dispara com o texto exato do preview; lacuna bloqueia; vendedor dispara mas nao submete', async ({
    browser,
  }) => {
    const contextoAdmin = await browser.newContext()
    const contextoVendedor = await browser.newContext()

    try {
      const paginaAdmin = await contextoAdmin.newPage()
      await criarConta(paginaAdmin)

      // --- Passo 1: conexao de WhatsApp da conta ---
      await conectarWhatsApp(paginaAdmin)

      // --- Passo 2: script da etapa do lead, com duas variaveis ---
      const tituloScript = `Disparo ${carimbo()}`
      const conteudo = 'Olá {{primeiro_nome}}, tudo bem na {{empresa}}?'
      await paginaAdmin.goto('/scripts/novo')
      await expect(
        paginaAdmin.getByRole('heading', { name: 'Novo script', level: 1 }),
      ).toBeVisible()

      await paginaAdmin.getByLabel('Título').fill(tituloScript)
      // exact: true — a lista "clique para inserir" tem um botao
      // aria-label="Inserir etapa", que casa por substring com 'Etapa'.
      await paginaAdmin
        .getByLabel('Etapa', { exact: true })
        .selectOption({ label: ETAPA_DO_LEAD })
      await paginaAdmin.getByLabel('Conteúdo').fill(conteudo)
      await paginaAdmin.getByRole('button', { name: 'Salvar' }).click()
      await paginaAdmin.waitForURL(/\/scripts\/[0-9a-f-]{36}$/)

      // --- Passo 3: submissao ao Meta (a falsa aprova por default) ---
      await paginaAdmin.getByRole('button', { name: 'Submeter ao WhatsApp' }).click()
      await expect(paginaAdmin.getByText('Aprovado')).toBeVisible()

      // --- Passo 4: lead COM telefone e empresa ---
      const nomeLead = `Cliente Disparo ${carimbo()}`
      const empresa = `Loja ${carimbo()}`
      await criarLeadCompleto(paginaAdmin, {
        nome: nomeLead,
        telefone: '(83) 99999-1234',
        empresa,
      })
      await coluna(paginaAdmin, ETAPA_DO_LEAD).getByRole('link', { name: nomeLead }).click()
      await expect(
        paginaAdmin.getByRole('heading', { name: nomeLead, exact: true, level: 1 }),
      ).toBeVisible()
      const urlFicha = paginaAdmin.url()

      // O texto esperado, montado AQUI a partir dos dados do lead — e' a
      // igualdade com ele que prova que o preview, o Copiar e o que saiu pelo
      // Graph vieram todos da mesma gramatica.
      const primeiroNome = nomeLead.split(' ')[0]
      const textoEsperado = `Olá ${primeiroNome}, tudo bem na ${empresa}?`
      await expect(
        paginaAdmin.getByRole('region', { name: `Prévia de ${tituloScript}` }),
      ).toHaveText(textoEsperado)

      // --- Passo 5: disparo, com confirmacao ---
      const enviar = paginaAdmin.getByRole('button', { name: 'Enviar WhatsApp' })
      await expect(enviar).toBeEnabled()
      await enviar.click()
      // O primeiro clique so abre a confirmacao: e' mensagem de verdade.
      await expect(
        paginaAdmin.getByRole('dialog', { name: 'Enviar WhatsApp' }),
      ).toBeVisible()
      await paginaAdmin.getByRole('button', { name: 'Confirmar envio' }).click()

      // Transitorio (2.5s): a asercao comeca a esperar ANTES de a action
      // responder, entao ela ve a janela inteira em vez de correr contra ela.
      await expect(paginaAdmin.getByText('Enviado ✓')).toBeVisible()

      // --- Passo 6: a timeline mostra o texto EXATO que foi enviado ---
      await paginaAdmin.reload()
      const linhaEvento = paginaAdmin
        .locator('li')
        .filter({ hasText: 'WhatsApp enviado:' })
        .locator('p')
        .first()
      await expect(linhaEvento).toHaveText(`WhatsApp enviado: ${textoEsperado}`)

      // --- Passo 7: lead SEM empresa — o mesmo botao, bloqueado com motivo ---
      const nomeLeadSemEmpresa = `Cliente Sem Empresa ${carimbo()}`
      await criarLeadCompleto(paginaAdmin, {
        nome: nomeLeadSemEmpresa,
        telefone: '(83) 99999-4321',
      })
      await coluna(paginaAdmin, ETAPA_DO_LEAD)
        .getByRole('link', { name: nomeLeadSemEmpresa })
        .click()
      await expect(
        paginaAdmin.getByRole('heading', { name: nomeLeadSemEmpresa, exact: true, level: 1 }),
      ).toBeVisible()

      // Positiva primeiro: o contador acusa a lacuna que bloqueia o envio.
      await expect(paginaAdmin.getByText('1 variável sem valor')).toBeVisible()
      const bloqueado = paginaAdmin.getByRole('button', { name: 'Enviar WhatsApp' })
      await expect(bloqueado).toBeDisabled()
      await expect(bloqueado).toHaveAttribute(
        'title',
        'Faltam dados do lead para preencher o template.',
      )

      // --- Passo 8: vendedor dispara, mas nao submete ---
      const emailVendedor = `vendedor-${carimbo()}@exemplo.com`
      const link = await convidarVendedor(paginaAdmin, emailVendedor)
      const paginaVendedor = await contextoVendedor.newPage()
      await aceitarConvite(paginaVendedor, link, 'Vendedor Disparo E2E', emailVendedor)

      // O lead precisa ser DELE: a RLS de leads so mostra ao vendedor o que
      // esta sob a responsabilidade dele.
      await paginaAdmin.goto(urlFicha)
      await paginaAdmin
        .getByLabel('Responsável')
        .selectOption({ label: 'Vendedor Disparo E2E' })
      await expect(paginaAdmin.getByText('Responsável alterado para')).toBeVisible()

      await paginaVendedor.goto(urlFicha)
      await expect(
        paginaVendedor.getByRole('heading', { name: nomeLead, exact: true, level: 1 }),
      ).toBeVisible()
      // Positiva: ele DISPARA — o botao existe e esta habilitado para ele.
      await expect(
        paginaVendedor.getByRole('button', { name: 'Enviar WhatsApp' }),
      ).toBeEnabled()
      // Negativa: nenhum caminho de submissao aparece para ele em lugar nenhum
      // da ficha (a tela que submete, /scripts/[id], nem abre — 404 coberto em
      // scripts.spec.ts).
      await expect(
        paginaVendedor.getByRole('button', { name: /submeter ao whatsapp/i }),
      ).toHaveCount(0)
    } finally {
      await contextoAdmin.close()
      await contextoVendedor.close()
    }
  })
})
