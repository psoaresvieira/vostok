import { test, expect, type Page } from '@playwright/test'
import { SENHA, carimbo, criarConta } from './apoio'

/**
 * O percurso da Task 8 do Plano 13 (remodelada): a navegacao do topo encolhe
 * para tres abas — Funil, Metricas, Disparo de WPP — e perde Tarefas (link e
 * badge) e Scripts (que virou Disparo de WPP). Configuracao deixa de ser um
 * link de texto e vira um icone de engrenagem discreto ao lado do sino,
 * visivel so para admin. Este arquivo tranca a FORMA da navegacao; o
 * conteudo de cada rota continua coberto pelos specs proprios (funil.spec.ts,
 * metricas.spec.ts, disparo-whatsapp.spec.ts, tarefas.spec.ts).
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
 * do header (sino, sair, engrenagem) na contagem de links. */
function navPrincipal(page: Page) {
  return page.getByRole('navigation', { name: 'Navegação principal' })
}

test.describe('navegacao do topo: tres abas, sem Tarefas/Scripts, engrenagem so para admin', () => {
  test('admin ve exatamente os tres links e a engrenagem; vendedor ve os tres links sem a engrenagem', async ({
    browser,
  }) => {
    const contextoAdmin = await browser.newContext()
    const contextoVendedor = await browser.newContext()

    try {
      const paginaAdmin = await contextoAdmin.newPage()
      await criarConta(paginaAdmin)

      // --- admin: exatamente os tres links, na ordem, dentro do <nav> ---
      const navAdmin = navPrincipal(paginaAdmin)
      await expect(navAdmin.getByRole('link')).toHaveCount(3)
      await expect(navAdmin.getByRole('link', { name: 'Funil', exact: true })).toBeVisible()
      await expect(navAdmin.getByRole('link', { name: 'Métricas', exact: true })).toBeVisible()
      await expect(
        navAdmin.getByRole('link', { name: 'Disparo de WPP', exact: true }),
      ).toBeVisible()

      // Positiva (o link novo existe) ja provada acima; agora a negativa —
      // Tarefas e Scripts nao aparecem em lugar nenhum do header, nem so no
      // <nav> escopado.
      const headerAdmin = paginaAdmin.locator('header')
      await expect(headerAdmin.getByRole('link', { name: /^Tarefas/ })).toHaveCount(0)
      await expect(headerAdmin.getByRole('link', { name: 'Scripts', exact: true })).toHaveCount(0)

      // Engrenagem: visivel para admin, pelo aria-label, e navega para /config.
      const engrenagemAdmin = headerAdmin.getByRole('link', { name: 'Configuração' })
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
      await expect(navVendedor.getByRole('link')).toHaveCount(3)
      await expect(navVendedor.getByRole('link', { name: 'Funil', exact: true })).toBeVisible()
      await expect(navVendedor.getByRole('link', { name: 'Métricas', exact: true })).toBeVisible()
      await expect(
        navVendedor.getByRole('link', { name: 'Disparo de WPP', exact: true }),
      ).toBeVisible()

      const headerVendedor = paginaVendedor.locator('header')
      await expect(headerVendedor.getByRole('link', { name: /^Tarefas/ })).toHaveCount(0)
      await expect(headerVendedor.getByRole('link', { name: 'Scripts', exact: true })).toHaveCount(0)
      await expect(headerVendedor.getByRole('link', { name: 'Configuração' })).toHaveCount(0)
    } finally {
      await contextoAdmin.close()
      await contextoVendedor.close()
    }
  })
})
