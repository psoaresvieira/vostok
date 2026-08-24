import { test, expect } from '@playwright/test'
import { criarConta } from './apoio'

test('/signup sem convite volta para o login: cadastro aberto nao existe mais', async ({ page }) => {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/login/)
})

test('/admin e 404 para um admin de conta comum', async ({ page }) => {
  await criarConta(page)
  await page.goto('/admin')
  await expect(page.getByText('404')).toBeVisible()
})
