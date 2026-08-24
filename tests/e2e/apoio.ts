import { expect, type Locator, type Page } from '@playwright/test'

export const SENHA = 'segredo123'

/** Dono da plataforma semeado por supabase/seed.sql — so existe em local. */
export const DONO = { email: 'dono@local.dev', senha: 'segredo123' }

async function entrarComoDono(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByPlaceholder('email', { exact: true }).fill(DONO.email)
  await page.getByPlaceholder('senha', { exact: true }).fill(DONO.senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/funil/)
}

async function sairDaSessao(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/login/)
}

// Email unico por conta: o banco local nao e limpo entre rodadas de E2E, e cada
// teste cria pelo menos uma conta. O contador sobrevive a --repeat-each, que
// reusaria o mesmo Date.now() dentro da mesma execucao; o sufixo aleatorio cobre
// o caso de dois arquivos rodarem em workers paralelos e caírem no mesmo
// milissegundo com o contador no mesmo valor (cada worker tem seu proprio modulo,
// logo seu proprio contador).
let contas = 0
export function carimbo(): string {
  contas += 1
  return `${Date.now()}-${contas}-${Math.random().toString(36).slice(2, 7)}`
}

export type ContaCriada = { email: string; empresa: string }

export async function criarConta(page: Page): Promise<ContaCriada> {
  const id = carimbo()
  const empresa = `Empresa ${id}`
  const email = `e2e-${id}@exemplo.com`

  // O cadastro aberto morreu: a conta nasce no /admin do dono e o "cliente"
  // termina o proprio cadastro pelo link de convite — o caminho real do
  // produto, exercitado em todo teste que precisa de uma conta.
  await entrarComoDono(page)
  await page.goto('/admin')
  await page.getByPlaceholder('nome da conta', { exact: true }).fill(empresa)
  await page.getByPlaceholder('email do cliente', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Criar conta' }).click()
  const codigoDoLink = page.locator('code')
  await expect(codigoDoLink).toBeVisible()
  const link = (await codigoDoLink.textContent())?.trim()
  if (!link) throw new Error('link do convite nao apareceu')
  await sairDaSessao(page)

  await page.goto(link)
  await page.getByRole('link', { name: 'Criar conta' }).click()
  await page.getByPlaceholder('seu nome', { exact: true }).fill('Cliente E2E')
  await page.getByPlaceholder('email', { exact: true }).fill(email)
  await page.getByPlaceholder('senha (min. 8 caracteres)', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Criar conta' }).click()

  await expect(page).toHaveURL(/\/funil/)
  await expect(page.getByRole('heading', { name: 'Novo lead', exact: true, level: 2 })).toBeVisible()
  return { email, empresa }
}

export async function criarLead(page: Page, nome: string): Promise<void> {
  await page.getByRole('button', { name: 'Novo lead' }).click()
  // exact: true e obrigatorio — o filtro do quadro tem placeholder
  // "buscar por nome, telefone ou email", que casa por substring com os tres.
  await page.getByPlaceholder('nome', { exact: true }).fill(nome)
  await page.getByPlaceholder('telefone', { exact: true }).fill('(83) 99999-1234')
  await page.getByPlaceholder('valor em reais', { exact: true }).fill('1.500,00')
  await page.getByRole('button', { name: 'Salvar' }).click()

  await expect(coluna(page, 'Novo lead').getByRole('link', { name: nome })).toBeVisible()
}

export function coluna(page: Page, nome: string): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: nome, exact: true, level: 2 }) })
}
