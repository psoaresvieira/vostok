import { test, expect, type Page } from '@playwright/test'
import { SENHA, carimbo, criarConta, criarLead, coluna } from './apoio'

// A tela de configuracao chega por navegacao de documento inteiro (<a href>), e
// um clique disparado antes de o React anexar o onClick simplesmente se perde.
// Em vez de esperar no relogio, sondamos com um clique que nao cria nada:
// "Convidar" com o campo vazio devolve email_invalido e nao escreve no banco.
// Quando a mensagem aparece, o handler esta vivo e o convite de verdade pode ir.
async function esperarBotaoConvidarVivo(page: Page) {
  const convidar = page.getByRole('button', { name: 'Convidar' })
  await expect(async () => {
    await convidar.click()
    await expect(page.getByText('Email inválido.')).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}

async function convidar(page: Page, email: string): Promise<string> {
  await page.getByRole('link', { name: 'Configuração' }).click()
  await expect(page.getByRole('heading', { name: 'Configuração', level: 1 })).toBeVisible()
  await esperarBotaoConvidarVivo(page)

  await page.getByPlaceholder('email do convidado').fill(email)
  await page.getByRole('button', { name: 'Convidar' }).click()

  const codigoDoLink = page.locator('code')
  await expect(codigoDoLink).toBeVisible()
  const link = (await codigoDoLink.textContent())?.trim()
  if (!link) throw new Error('link do convite nao apareceu')
  expect(link).toContain('/convite/')
  return link
}

// O criterio de aceite do plano: "voce cria uma conta, convida um vendedor, ele
// entra e ve apenas os leads dele". A segunda metade e provada pela RLS nos
// testes de integracao; a primeira so existe se o convidado terminar o cadastro
// DENTRO da conta de quem convidou — e nao numa conta nova sua, como admin.
//
// Dois contextos de navegador porque sao duas sessoes simultaneas: reusar a
// mesma page trocaria os cookies e escondsria justamente o que se quer provar.
test('convidado se cadastra pelo link e cai na conta de quem convidou', async ({ browser }) => {
  const contextoAdmin = await browser.newContext()
  const contextoVendedor = await browser.newContext()

  try {
    const paginaAdmin = await contextoAdmin.newPage()
    const { empresa } = await criarConta(paginaAdmin)
    // Um lead do admin: o quadro do vendedor tem que ficar vazio mesmo havendo
    // lead na conta — vazio por RLS, nao por conta nova e sem dados.
    await criarLead(paginaAdmin, 'Lead do Admin')

    const emailVendedor = `vendedor-${carimbo()}@exemplo.com`
    const link = await convidar(paginaAdmin, emailVendedor)

    // Segunda sessao: abre o link sem estar logado.
    const paginaVendedor = await contextoVendedor.newPage()
    await paginaVendedor.goto(link)
    await expect(
      paginaVendedor.getByRole('heading', { name: 'Você foi convidado', exact: true }),
    ).toBeVisible()

    await paginaVendedor.getByRole('link', { name: 'Criar conta' }).click()
    await expect(paginaVendedor).toHaveURL(/\/signup\?convite=/)

    // Convidado nao abre empresa nenhuma: o campo some junto com a exigencia.
    await expect(paginaVendedor.getByPlaceholder('nome da empresa', { exact: true })).toHaveCount(0)

    await paginaVendedor.getByPlaceholder('seu nome', { exact: true }).fill('Vendedor E2E')
    await paginaVendedor.getByPlaceholder('email', { exact: true }).fill(emailVendedor)
    await paginaVendedor.getByPlaceholder('senha (min. 8 caracteres)', { exact: true }).fill(SENHA)
    await paginaVendedor.getByRole('button', { name: 'Criar conta' }).click()

    await expect(paginaVendedor).toHaveURL(/\/funil/)

    // Na conta de QUEM CONVIDOU: o nome da empresa no cabecalho e o carimbo unico
    // da conta do admin, entao ver esse nome so e possivel dentro dela.
    await expect(paginaVendedor.locator('header').getByText(empresa)).toBeVisible()

    // Entrou como vendedor, nao como admin da propria conta: sem link de config.
    await expect(paginaVendedor.getByRole('link', { name: 'Configuração' })).toHaveCount(0)

    // Quadro vazio: ve o funil da conta, mas nenhum lead — o do admin nao e dele.
    await expect(
      paginaVendedor.getByRole('heading', { name: 'Novo lead', exact: true, level: 2 }),
    ).toBeVisible()
    await expect(paginaVendedor.getByRole('link', { name: 'Lead do Admin' })).toHaveCount(0)
    await expect(coluna(paginaVendedor, 'Novo lead').getByRole('link')).toHaveCount(0)

    // E o convite deixou de estar pendente para quem convidou.
    await paginaAdmin.reload()
    await expect(paginaAdmin.getByText(emailVendedor)).toBeVisible()
    await expect(paginaAdmin.getByRole('button', { name: 'revogar' })).toHaveCount(0)
  } finally {
    await contextoAdmin.close()
    await contextoVendedor.close()
  }
})

test('convidado que se cadastra com outro email ve a mensagem, sem quebrar', async ({ browser }) => {
  const contextoAdmin = await browser.newContext()
  const contextoOutro = await browser.newContext()

  try {
    const paginaAdmin = await contextoAdmin.newPage()
    await criarConta(paginaAdmin)

    const emailConvidado = `convidado-${carimbo()}@exemplo.com`
    const link = await convidar(paginaAdmin, emailConvidado)

    const paginaOutro = await contextoOutro.newPage()
    await paginaOutro.goto(link)
    await paginaOutro.getByRole('link', { name: 'Criar conta' }).click()
    await paginaOutro.getByPlaceholder('seu nome', { exact: true }).fill('Outro E2E')
    await paginaOutro
      .getByPlaceholder('email', { exact: true })
      .fill(`intruso-${carimbo()}@exemplo.com`)
    await paginaOutro.getByPlaceholder('senha (min. 8 caracteres)', { exact: true }).fill(SENHA)
    await paginaOutro.getByRole('button', { name: 'Criar conta' }).click()

    // Mensagem tratada, em portugues, e sem sair da tela de cadastro.
    await expect(
      paginaOutro.getByText(
        'Este convite foi enviado para outro email. Entre com o email convidado para aceitá-lo.',
      ),
    ).toBeVisible()
    await expect(paginaOutro).toHaveURL(/\/signup/)
  } finally {
    await contextoAdmin.close()
    await contextoOutro.close()
  }
})
