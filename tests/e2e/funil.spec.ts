import { test, expect, type Locator, type Page } from '@playwright/test'

// Email unico por execucao: o banco local nao e limpo entre rodadas de E2E.
const carimbo = Date.now()
const EMAIL = `e2e-${carimbo}@se7e.com`
const SENHA = 'segredo123'

// O PointerSensor do dnd-kit so ativa depois que o ponteiro anda mais de 5px, e
// o destino so e calculado nos movimentos POSTERIORES a ativacao. Um unico pulo
// da origem ao destino nao arrasta nada: e preciso andar em passos.
async function arrastar(page: Page, cartao: Locator, coluna: Locator) {
  const origem = await cartao.boundingBox()
  const destino = await coluna.boundingBox()
  if (!origem || !destino) throw new Error('cartao ou coluna sem bounding box')

  const xOrigem = origem.x + origem.width / 2
  const yOrigem = origem.y + origem.height / 2
  const xDestino = destino.x + destino.width / 2
  const yDestino = destino.y + destino.height / 2

  await page.mouse.move(xOrigem, yOrigem)
  await page.mouse.down()
  await page.mouse.move(xOrigem + 12, yOrigem, { steps: 6 })
  await page.mouse.move(xDestino, yDestino, { steps: 20 })
  await page.mouse.move(xDestino, yDestino)
  await page.mouse.up()
  // Ao soltar, o dnd-kit deixa por 50ms um listener de `click` em capture no
  // document que chama stopPropagation — o React 19 do App Router escuta no
  // proprio document, entao o primeiro clique nesse intervalo nunca chega ao
  // handler. Sem esta espera o clique em "Confirmar" simplesmente some.
  await page.waitForTimeout(150)
}

// O cartao chega no destino pelo useOptimistic ANTES de o servidor ter gravado.
// Esperar a resposta da Server Action (POST na propria rota, do jeito que o
// Next despacha) evita seguir para a ficha com o movimento ainda em voo.
async function confirmarMovimento(page: Page) {
  const resposta = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/funil',
  )
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await resposta
}

function coluna(page: Page, nome: string): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: nome, exact: true, level: 2 }) })
}

test('do signup ate a perda com motivo, com a timeline contando a historia', async ({ page }) => {
  await page.goto('/signup')
  await page.getByPlaceholder('seu nome', { exact: true }).fill('Pedro E2E')
  await page.getByPlaceholder('nome da empresa', { exact: true }).fill(`SE7E ${carimbo}`)
  await page.getByPlaceholder('email', { exact: true }).fill(EMAIL)
  await page.getByPlaceholder('senha (min. 8 caracteres)', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Criar conta' }).click()

  await expect(page).toHaveURL(/\/funil/)
  await expect(page.getByRole('heading', { name: 'Novo lead', exact: true, level: 2 })).toBeVisible()

  await page.getByRole('button', { name: 'Novo lead' }).click()
  // exact: true e obrigatorio — o filtro do quadro tem placeholder
  // "buscar por nome, telefone ou email", que casa por substring com os tres.
  await page.getByPlaceholder('nome', { exact: true }).fill('Cliente Teste')
  await page.getByPlaceholder('telefone', { exact: true }).fill('(83) 99999-1234')
  await page.getByPlaceholder('valor em reais', { exact: true }).fill('1.500,00')
  await page.getByRole('button', { name: 'Salvar' }).click()

  const cartao = page.getByRole('link', { name: 'Cliente Teste' })
  await expect(cartao).toBeVisible()
  await expect(coluna(page, 'Novo lead').getByRole('link', { name: 'Cliente Teste' })).toBeVisible()

  // Arrastar de "Novo lead" para "Qualificação", etiquetando na passagem.
  await arrastar(page, cartao, coluna(page, 'Qualificação'))

  await expect(page.getByRole('heading', { name: 'Cliente Teste → Qualificação' })).toBeVisible()
  const entradaEtiqueta = page.getByPlaceholder('digite e pressione Enter')
  await entradaEtiqueta.fill('Preço alto')
  await entradaEtiqueta.press('Enter')
  await confirmarMovimento(page)

  // A etiqueta so aparece no cartao depois que o revalidatePath traz os dados do
  // servidor: e o sinal de que o movimento otimista foi conciliado, e nao apenas
  // pintado na tela.
  const naQualificacao = coluna(page, 'Qualificação')
  await expect(naQualificacao.getByRole('link', { name: 'Cliente Teste' })).toBeVisible()
  await expect(naQualificacao.getByText('Preço alto')).toBeVisible()
  await expect(coluna(page, 'Novo lead').getByRole('link', { name: 'Cliente Teste' })).toHaveCount(0)

  // Arrastar para "Perdido": o Confirmar so libera depois de escolher o motivo.
  await arrastar(page, page.getByRole('link', { name: 'Cliente Teste' }), coluna(page, 'Perdido'))

  await expect(page.getByRole('heading', { name: 'Cliente Teste → Perdido' })).toBeVisible()
  const confirmar = page.getByRole('button', { name: 'Confirmar' })
  await expect(confirmar).toBeDisabled()
  // getByRole('combobox').first() pegaria o filtro de responsavel do quadro, que
  // continua no DOM atras do modal.
  await page.getByLabel(/Motivo da perda/).selectOption({ label: 'Preço' })
  await expect(confirmar).toBeEnabled()
  await confirmarMovimento(page)

  await expect(coluna(page, 'Perdido').getByRole('link', { name: 'Cliente Teste' })).toBeVisible()

  await page.getByRole('link', { name: 'Cliente Teste' }).click()
  await expect(page.getByRole('heading', { name: 'Cliente Teste', level: 1 })).toBeVisible()
  await expect(page.getByText('Etapa alterada: Qualificação → Perdido')).toBeVisible()
  await expect(page.getByText('Etapa alterada: Novo lead → Qualificação')).toBeVisible()
  await expect(page.getByText('Etiqueta "Preço alto" aplicada em Novo lead')).toBeVisible()
  await expect(page.getByText('Lead criado (origem: manual)')).toBeVisible()

  // A perda gravou o motivo e o valor sobreviveu ao caminho inteiro.
  // Scoped em <dd>: "Perdido" tambem e uma <option> do seletor "Mover para".
  await expect(page.getByRole('definition').filter({ hasText: /^Perdido$/ })).toBeVisible()
  await expect(page.getByText('R$ 1.500,00')).toBeVisible()
})
