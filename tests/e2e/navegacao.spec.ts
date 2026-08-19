import { test, expect, type Page } from '@playwright/test'
import { SENHA, carimbo, criarConta } from './apoio'

/**
 * A FORMA da navegacao. Reescrito junto com a barra lateral: o <header>
 * horizontal de tres abas deixou de existir, e a navegacao virou uma barra
 * lateral (<aside>, role=complementary) com QUATRO itens — Funil, Metricas,
 * Disparo e Tarefas.
 *
 * O que mudou em relacao a Task 8 do Plano 13, e por que:
 * - Tarefas VOLTOU a ser um link. Ela tinha saido por falta de espaco
 *   horizontal no header; numa barra vertical esse motivo nao existe. A
 *   asercao virou positiva (antes era `toHaveCount(0)`).
 * - "Disparo de WPP" encolheu para "Disparo": o logo do WhatsApp ao lado ja
 *   diz de que canal se trata. O <h1> da propria tela segue "Disparo de
 *   WhatsApp", e os specs que o checam por heading nao mudaram.
 * - As buscas ancoradas em `page.locator('header')` viraram
 *   `barraLateral(page)`. ATENCAO: nao basta trocar o seletor por causa das
 *   asercoes NEGATIVAS — `header.getByRole(...)` com `toHaveCount(0)` passava
 *   vacuamente depois da mudanca (o <header> nao existe mais, logo nada dentro
 *   dele existe), ou seja, deixaria de provar qualquer coisa em silencio.
 *
 * Scripts continua ausente da navegacao (a rota /scripts existe, mas nao e'
 * listada). O conteudo de cada rota segue coberto pelos specs proprios
 * (funil.spec.ts, metricas.spec.ts, disparo-whatsapp.spec.ts, tarefas.spec.ts).
 */

/** Copiado do padrao de convite.spec.ts / sino-isolamento.spec.ts de proposito
 * (varios specs ja carregam a mesma copia): a tela de configuracao chega por
 * navegacao de documento inteiro, e um clique disparado antes de o React
 * anexar o onClick se perde. "Convidar" com o campo vazio devolve
 * email_invalido sem escrever nada e serve de sonda ate a hidratacao
 * acontecer. */
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

/** A navegacao principal: um <nav> proprio, escopado para nao pegar o resto
 * da barra (sino, sair, engrenagem) na contagem de links. */
function navPrincipal(page: Page) {
  return page.getByRole('navigation', { name: 'Navegação principal' })
}

/** A barra lateral inteira — <aside>, que expoe role=complementary. Escopo
 * das asercoes que precisam olhar FORA do <nav> (a engrenagem e o sair moram
 * no rodape dela, nao na navegacao). */
function barraLateral(page: Page) {
  return page.getByRole('complementary')
}

test.describe('barra lateral: quatro itens, sem Scripts, engrenagem so para admin', () => {
  test('admin ve exatamente os quatro links e a engrenagem; vendedor ve os quatro links sem a engrenagem', async ({
    browser,
  }) => {
    const contextoAdmin = await browser.newContext()
    const contextoVendedor = await browser.newContext()

    try {
      const paginaAdmin = await contextoAdmin.newPage()
      await criarConta(paginaAdmin)

      // --- admin: exatamente os quatro links, na ordem, dentro do <nav> ---
      const navAdmin = navPrincipal(paginaAdmin)
      await expect(navAdmin.getByRole('link')).toHaveCount(4)
      await expect(navAdmin.getByRole('link', { name: 'Funil', exact: true })).toBeVisible()
      await expect(navAdmin.getByRole('link', { name: 'Métricas', exact: true })).toBeVisible()
      await expect(navAdmin.getByRole('link', { name: 'Disparo', exact: true })).toBeVisible()
      await expect(navAdmin.getByRole('link', { name: 'Tarefas', exact: true })).toBeVisible()

      // A negativa que sobrou: Scripts nao aparece em lugar nenhum da barra,
      // nem so' no <nav> escopado.
      const barraAdmin = barraLateral(paginaAdmin)
      await expect(barraAdmin.getByRole('link', { name: 'Scripts', exact: true })).toHaveCount(0)

      // Engrenagem: visivel para admin, pelo aria-label, e navega para /config.
      const engrenagemAdmin = barraAdmin.getByRole('link', { name: 'Configuração' })
      await expect(engrenagemAdmin).toBeVisible()
      await engrenagemAdmin.click()
      await expect(
        paginaAdmin.getByRole('heading', { name: 'Configuração', level: 1 }),
      ).toBeVisible()

      // --- vendedor: os mesmos tres links, engrenagem ausente ---
      const emailVendedor = `vendedor-nav-${carimbo()}@exemplo.com`
      const link = await convidarVendedor(paginaAdmin, emailVendedor)
      const paginaVendedor = await contextoVendedor.newPage()
      await aceitarConvite(paginaVendedor, link, 'Vendedor Nav E2E', emailVendedor)

      const navVendedor = navPrincipal(paginaVendedor)
      await expect(navVendedor.getByRole('link')).toHaveCount(4)
      await expect(navVendedor.getByRole('link', { name: 'Funil', exact: true })).toBeVisible()
      await expect(navVendedor.getByRole('link', { name: 'Métricas', exact: true })).toBeVisible()
      await expect(navVendedor.getByRole('link', { name: 'Disparo', exact: true })).toBeVisible()
      await expect(navVendedor.getByRole('link', { name: 'Tarefas', exact: true })).toBeVisible()

      const barraVendedor = barraLateral(paginaVendedor)
      await expect(barraVendedor.getByRole('link', { name: 'Scripts', exact: true })).toHaveCount(0)
      await expect(barraVendedor.getByRole('link', { name: 'Configuração' })).toHaveCount(0)
    } finally {
      await contextoAdmin.close()
      await contextoVendedor.close()
    }
  })
})
