import { test, expect, type Locator, type Page } from '@playwright/test'
import { criarConta, criarLead, coluna } from './apoio'

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
}

// Ao soltar, o dnd-kit deixa por 50ms um listener de `click` em capture no
// document que chama stopPropagation — o React 19 do App Router escuta no
// proprio document, entao o primeiro clique nesse intervalo nunca chega ao
// handler e o clique em "Confirmar" simplesmente some. Em vez de cronometrar
// esse intervalo com um sleep, clicamos ate o modal fechar: o clique engolido
// nao muda estado nenhum, e assim que ele passa o modal desmonta (setPedido(null)
// roda antes da transicao), entao repetir e seguro e nao dispara dois movimentos.
async function clicarConfirmar(page: Page) {
  const confirmar = page.getByRole('button', { name: 'Confirmar' })
  await expect(async () => {
    await confirmar.click()
    await expect(confirmar).toBeHidden({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

// A Server Action e despachada como POST na propria rota, do jeito que o Next faz.
function respostaDoMovimento(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/funil',
  )
}

// O cartao chega no destino pelo useOptimistic ANTES de o servidor ter gravado.
// Esperar a resposta evita seguir para a ficha com o movimento ainda em voo.
async function confirmarMovimento(page: Page) {
  const resposta = respostaDoMovimento(page)
  await clicarConfirmar(page)
  await resposta
}

test('do signup ate a perda com motivo, com a timeline contando a historia', async ({ page }) => {
  await criarConta(page)
  await criarLead(page, 'Cliente Teste')

  const cartao = page.getByRole('link', { name: 'Cliente Teste' })
  await expect(cartao).toBeVisible()

  // Arrastar de "Novo lead" para "Qualificação", etiquetando na passagem.
  await arrastar(page, cartao, coluna(page, 'Qualificação'))

  await expect(
    page.getByRole('heading', { name: 'Cliente Teste → Qualificação', exact: true }),
  ).toBeVisible()
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

  await expect(
    page.getByRole('heading', { name: 'Cliente Teste → Perdido', exact: true }),
  ).toBeVisible()
  const confirmar = page.getByRole('button', { name: 'Confirmar' })
  await expect(confirmar).toBeDisabled()
  // getByRole('combobox').first() pegaria o filtro de responsavel do quadro, que
  // continua no DOM atras do modal.
  await page.getByLabel(/Motivo da perda/).selectOption({ label: 'Preço' })
  await expect(confirmar).toBeEnabled()
  await confirmarMovimento(page)

  await expect(coluna(page, 'Perdido').getByRole('link', { name: 'Cliente Teste' })).toBeVisible()

  await page.getByRole('link', { name: 'Cliente Teste' }).click()
  await expect(page.getByRole('heading', { name: 'Cliente Teste', exact: true, level: 1 })).toBeVisible()

  // A timeline e um <ol> com um <li> por evento e o rotulo no primeiro <p>. Ler a
  // lista inteira e a unica forma de assegurar ORDEM: getByText casa em qualquer
  // lugar da pagina, entao passaria igual se a timeline viesse invertida — e o
  // mais recente primeiro e um entregavel, ja quebrado uma vez neste plano.
  const linhaDoTempo = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Linha do tempo', exact: true, level: 2 }) })
  const rotulos = linhaDoTempo.locator('ol > li > p:first-child')
  await expect(rotulos.first()).toBeVisible()

  const esperados = [
    'Etapa alterada: Qualificação → Perdido',
    'Etapa alterada: Novo lead → Qualificação',
    'Etiqueta "Preço alto" aplicada em Novo lead',
    'Lead criado (origem: manual)',
  ]
  const lidos = (await rotulos.allTextContents()).map((t) => t.trim())
  // Compara so as linhas que interessam, na ordem em que a pagina as lista: outros
  // eventos podem se intercalar, mas estes quatro tem que vir nesta sequencia.
  expect(lidos.filter((t) => esperados.includes(t))).toEqual(esperados)

  // A perda gravou o motivo e o valor sobreviveu ao caminho inteiro.
  // Scoped em <dd>: "Perdido" tambem e uma <option> do seletor "Mover para".
  await expect(page.getByRole('definition').filter({ hasText: /^Perdido$/ })).toBeVisible()
  await expect(page.getByText('R$ 1.500,00')).toBeVisible()
})

test('movimento recusado pelo servidor: o quadro pinta, volta atras e avisa', async ({ page }) => {
  await criarConta(page)
  await criarLead(page, 'Cliente Rollback')

  // Provocar a falha SEM tocar em codigo de aplicacao: interceptamos o POST da
  // Server Action e trocamos os UUIDs do corpo (o primeiro argumento de
  // moverEtapaAction e o id do lead) por um id que nao existe. O servidor recusa
  // de verdade, pelo caminho de erro do proprio produto — move_lead_stage levanta
  // `lead_nao_encontrado`. O atraso mantem a transicao aberta o suficiente para a
  // pintura otimista ser observavel antes de a resposta chegar.
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
  const INEXISTENTE = '00000000-0000-4000-8000-000000000000'
  const rotaDoFunil = (url: URL) => url.pathname === '/funil'
  await page.route(rotaDoFunil, async (rota) => {
    if (rota.request().method() !== 'POST') return rota.continue()
    const corpo = rota.request().postData() ?? ''
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    await rota.continue({ postData: corpo.replace(UUID, INEXISTENTE) })
  })

  const naQualificacao = coluna(page, 'Qualificação').getByRole('link', { name: 'Cliente Rollback' })
  const noNovoLead = coluna(page, 'Novo lead').getByRole('link', { name: 'Cliente Rollback' })

  await arrastar(page, page.getByRole('link', { name: 'Cliente Rollback' }), coluna(page, 'Qualificação'))
  await expect(
    page.getByRole('heading', { name: 'Cliente Rollback → Qualificação', exact: true }),
  ).toBeVisible()

  const resposta = respostaDoMovimento(page)
  await clicarConfirmar(page)

  // Otimista: o cartao chega no destino com o movimento ainda em voo.
  await expect(naQualificacao).toBeVisible()
  await resposta

  // Rollback: nao ha reversao explicita: o patch do useOptimistic e simplesmente
  // descartado quando a transicao termina, e o quadro volta a refletir o servidor.
  // O Next injeta um role="alert" vazio (#__next-route-announcer__) no fim do body,
  // entao filtrar pelo texto e o que isola o banner do quadro. A regex ancorada
  // mantem a assercao presa a copia real de erros.ts, e nao a um pedaco dela.
  await expect(
    page.getByRole('alert').filter({ hasText: /^Você não tem acesso a esse lead\.$/ }),
  ).toBeVisible()
  await expect(noNovoLead).toBeVisible()
  await expect(naQualificacao).toHaveCount(0)

  // A interceptacao morre com a page fixture, mas soltar a rota deixa explicito
  // que ela nao vale para mais nada depois daqui.
  await page.unroute(rotaDoFunil)
})
