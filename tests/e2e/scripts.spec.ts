import { test, expect, type Page } from '@playwright/test'
import { SENHA, carimbo, criarConta, criarLead } from './apoio'

/**
 * O percurso da spec §7 do Plano 10, ponta a ponta: o admin escreve um script
 * amarrado a etapa em que o lead de teste esta, abre a ficha desse lead e ve o
 * script ja interpolado — com a lacuna de `{{empresa}}` visivel e contada —,
 * copia e o que foi para a area de transferencia e o texto do DOMINIO, nao o
 * do DOM. Mais o gate de papel: o vendedor da mesma conta le a biblioteca mas
 * nao recebe "Novo script", e /scripts/novo responde 404 para ele.
 *
 * O que este arquivo tranca e que os testes de componente nao conseguem: que a
 * interpolacao acontece com o lead DE VERDADE do banco (contextoDoLead sobre a
 * linha do Postgres, e nao sobre um fixture), e que o Copiar atravessa a
 * Clipboard API do navegador de verdade — no jsdom ela e um stub.
 */

// Copiado de tarefas.spec.ts / sino-isolamento.spec.ts de proposito (os dois ja
// carregam a mesma copia): a tela de configuracao chega por navegacao de
// documento inteiro, e um clique disparado antes de o React anexar o onClick se
// perde. "Convidar" com o campo vazio devolve email_invalido sem escrever nada
// e serve de sonda ate a hidratacao acontecer.
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

// A etapa em que `criarLead` deixa o lead — a mesma coluna do funil onde ele
// aparece. E' a etapa que o script vai amarrar, e o valor de {{etapa}}.
const ETAPA_DO_LEAD = 'Novo lead'

test.describe('scripts na ficha do lead', () => {
  test('admin escreve um script da etapa, ve na ficha com a lacuna contada e copia o texto do dominio; vendedor le a biblioteca mas nao escreve', async ({
    browser,
  }) => {
    const contextoAdmin = await browser.newContext()
    const contextoVendedor = await browser.newContext()
    // Sem isto o `navigator.clipboard.readText()` do passo de verificacao e
    // recusado por permissao — o writeText do produto ate funcionaria (o
    // Chromium libera escrita para a aba em foco), mas o teste nao teria como
    // olhar o que foi escrito. Chromium; e o unico navegador desta suite.
    await contextoAdmin.grantPermissions(['clipboard-read', 'clipboard-write'])

    try {
      const paginaAdmin = await contextoAdmin.newPage()
      await criarConta(paginaAdmin)

      // --- Passo 0: um lead SEM empresa ---
      // `criarLead` preenche nome, telefone e valor e deixa o campo "empresa"
      // em branco de proposito: e' a ausencia dela que faz {{empresa}} virar
      // lacuna la na frente. A ficha confirma isso abaixo com um "—" — a
      // garantia e' AFIRMADA, nao assumida, senao o teste inteiro poderia
      // passar a medir outra coisa no dia em que o helper mudar.
      const nomeLead = `Lead Script ${carimbo()}`
      await criarLead(paginaAdmin, nomeLead)

      // --- Passo 1: script novo, amarrado a etapa do lead, com {{empresa}} ---
      const tituloScript = `Abordagem ${carimbo()}`
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
      await paginaAdmin.getByLabel('Tags').fill('objeção')
      // Duas variaveis COM valor cercando a que nao tem: sem elas o teste
      // passaria num painel que nao interpola nada e so ecoa o conteudo cru.
      await paginaAdmin
        .getByLabel('Conteúdo')
        .fill('Olá {{primeiro_nome}}, sobre a {{empresa}} — você está em {{etapa}}.')
      await paginaAdmin.getByRole('button', { name: 'Salvar' }).click()
      // Criar navega para /scripts/[id] com o id que a action devolveu.
      await paginaAdmin.waitForURL(/\/scripts\/[0-9a-f-]{36}$/)

      // --- Passo 2: a ficha do lead mostra o script interpolado ---
      await paginaAdmin.goto('/funil')
      await paginaAdmin.getByRole('link', { name: nomeLead }).click()
      await expect(
        paginaAdmin.getByRole('heading', { name: nomeLead, exact: true, level: 1 }),
      ).toBeVisible()

      // A garantia do passo 0, afirmada na propria ficha.
      const linhaEmpresa = paginaAdmin.locator('div').filter({ hasText: /^Empresa—$/ })
      await expect(linhaEmpresa).toHaveCount(1)

      const previa = paginaAdmin.getByRole('region', { name: `Prévia de ${tituloScript}` })
      await expect(previa).toBeVisible()
      // O primeiro nome do lead e o nome da etapa saem interpolados...
      const primeiroNome = nomeLead.split(' ')[0]
      await expect(previa).toContainText(`Olá ${primeiroNome},`)
      await expect(previa).toContainText(`você está em ${ETAPA_DO_LEAD}.`)
      // ...e a lacuna continua literal, dentro de um <mark> com o rotulo
      // escondido que leitor de tela le (o destaque nao pode ser so cor).
      await expect(previa.locator('mark')).toHaveText(/\{\{empresa\}\}/)
      await expect(previa.locator('mark')).toContainText('empresa sem valor')
      // O contador acusa exatamente uma pendencia: {{empresa}}.
      await expect(paginaAdmin.getByText('1 variável sem valor')).toBeVisible()

      // --- Passo 3: Copiar poe na area de transferencia o texto do dominio ---
      // Copiar continua liberado COM a pendencia acima: o aviso e' o contador,
      // a decisao e' do vendedor (spec §4.4). Se o botao estivesse bloqueado,
      // o clique abaixo falharia.
      await paginaAdmin.getByRole('button', { name: 'Copiar' }).click()
      await expect(paginaAdmin.getByText('Copiado ✓')).toBeVisible()

      const copiado = await paginaAdmin.evaluate(() => navigator.clipboard.readText())
      expect(copiado).toBe(
        `Olá ${primeiroNome}, sobre a {{empresa}} — você está em ${ETAPA_DO_LEAD}.`,
      )
      // A asercao que so um navegador de verdade prova: o rotulo visualmente
      // escondido do <mark> ("empresa sem valor") esta no textContent da previa
      // e NAO pode estar no que o vendedor vai colar no WhatsApp do lead. Um
      // Copiar que lesse o DOM passaria em tudo acima e falharia aqui.
      expect(copiado).not.toContain('sem valor')

      // O link do WhatsApp sai do MESMO texto — o telefone que `criarLead`
      // digita, (83) 99999-1234, normalizado para E.164.
      await expect(paginaAdmin.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
        'href',
        `https://wa.me/5583999991234?text=${encodeURIComponent(copiado)}`,
      )

      // --- Passo 4: o vendedor le a biblioteca, mas nao escreve ---
      const emailVendedor = `vendedor-${carimbo()}@se7e.com`
      const link = await convidarVendedor(paginaAdmin, emailVendedor)
      const paginaVendedor = await contextoVendedor.newPage()
      await aceitarConvite(paginaVendedor, link, 'Vendedor Script E2E', emailVendedor)

      await paginaVendedor.goto('/scripts')
      // Positiva primeiro: a biblioteca carregou de verdade e o script esta la
      // (a policy de leitura e' de todo membro) — nao uma tela quebrada que por
      // acaso tambem nao tem o botao.
      await expect(paginaVendedor.getByRole('heading', { name: 'Scripts', level: 1 })).toBeVisible()
      await expect(paginaVendedor.getByText(tituloScript)).toBeVisible()
      // So agora a negativa: nenhum caminho de escrita oferecido.
      await expect(paginaVendedor.getByRole('link', { name: 'Novo script' })).toHaveCount(0)

      // E o caminho digitado a mao nao existe: notFound(), nunca 403 — para o
      // vendedor a tela de edicao simplesmente nao esta la. A guarda de verdade
      // continua sendo a RLS da 0020 mais o pre-check da action.
      const resposta = await paginaVendedor.goto('/scripts/novo')
      expect(resposta?.status()).toBe(404)
      await expect(
        paginaVendedor.getByRole('heading', { name: 'Novo script', level: 1 }),
      ).toHaveCount(0)
    } finally {
      await contextoAdmin.close()
      await contextoVendedor.close()
    }
  })
})
