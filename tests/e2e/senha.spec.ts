import { test, expect } from '@playwright/test'
import { SENHA, criarConta } from './apoio'

// Ciclo real de troca de senha (Task 4): trocar -> sair -> entrar com a nova.
// NUNCA usa o DONO aqui — trocar a senha dele quebraria os specs seguintes,
// ja que o banco local nao e limpo entre arquivos de E2E.
test('troca a senha, sai e entra so com a nova', async ({ page }) => {
  const { email } = await criarConta(page)
  const senhaNova = SENHA + '-nova'

  await page.getByRole('link', { name: 'Trocar senha' }).click()
  await expect(page).toHaveURL(/\/senha/)

  await page.getByPlaceholder('nova senha (min. 8 caracteres)').fill(senhaNova)
  await page.getByPlaceholder('confirme a nova senha', { exact: true }).fill(senhaNova)
  await page.getByRole('button', { name: 'Trocar senha' }).click()
  await expect(page.getByText('Senha trocada ✓')).toBeVisible()

  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/login/)

  // Senha antiga nao entra mais.
  await page.getByPlaceholder('email', { exact: true }).fill(email)
  await page.getByPlaceholder('senha', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('credenciais_invalidas')).toBeVisible()

  // Senha nova entra. O form action reseta os campos (uncontrolled) apos a
  // tentativa anterior, entao o email precisa ser preenchido de novo.
  await page.getByPlaceholder('email', { exact: true }).fill(email)
  await page.getByPlaceholder('senha', { exact: true }).fill(senhaNova)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/funil/)
})
