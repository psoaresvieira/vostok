import { createHmac } from 'node:crypto'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { criarConta, criarLead, coluna, carimbo } from './apoio'
import { comoServico } from '../integration/helpers/db'

/**
 * Segredo local do webhook do Meta, valido so para este arquivo. Tem que ser
 * IDENTICO ao META_APP_SECRET que playwright.config.ts injeta no processo do
 * `npm run dev` (ver comentario la): assinaturaValida (src/lib/ingestao/hmac.ts)
 * confere o HMAC contra esse valor e falha FECHADO quando ele esta vazio — o
 * default de .env.local.example, porque META_FAKE=1 nunca precisou de
 * credencial real do Meta. Sem fixar os dois lados no mesmo literal, a rota
 * devolveria 401 para qualquer corpo, mesmo assinado certo, e este seria o
 * primeiro E2E do repo incapaz de provar o caminho do Meta (os outros so
 * testam Google, que nao exige assinatura — ver comentario de ingestao.spec.ts).
 */
const SEGREDO_META_E2E = 'segredo-webhook-meta-e2e'

/** `sha256=<hex>`, o formato que X-Hub-Signature-256 exige — mesmo calculo
 * que a rota faz (hmac.ts), sobre o MESMO texto cru que vira o corpo do
 * POST. Nunca serializar de novo depois de assinar: a rota le `req.text()`
 * byte a byte, e reserializar mudaria os bytes assinados. */
function assinar(corpoCru: string): string {
  return `sha256=${createHmac('sha256', SEGREDO_META_E2E).update(corpoCru, 'utf8').digest('hex')}`
}

// --- arrastar-e-soltar, copiado de funil.spec.ts (mesmo motivo la: o
// PointerSensor do dnd-kit so ativa depois que o ponteiro anda mais de 5px,
// e o destino so e calculado nos movimentos POSTERIORES a ativacao) ---

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
// document que chama stopPropagation, entao o primeiro clique em "Confirmar"
// pode ser engolido. Clicar ate o modal fechar e seguro: o clique engolido
// nao muda estado nenhum.
async function clicarConfirmar(page: Page) {
  const confirmar = page.getByRole('button', { name: 'Confirmar' })
  await expect(async () => {
    await confirmar.click()
    await expect(confirmar).toBeHidden({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

function respostaDoMovimento(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/funil',
  )
}

// O cartao chega no destino pelo useOptimistic ANTES de o servidor gravar.
// Esperar a resposta evita seguir com o movimento ainda em voo.
async function confirmarMovimento(page: Page) {
  const resposta = respostaDoMovimento(page)
  await clicarConfirmar(page)
  await resposta
}

// --- localizadores da tela de metricas ---

function secaoFunil(page: Page): Locator {
  return page.locator('section').filter({ hasText: 'Funil da coorte' })
}

function totalDaCoorte(page: Page): Locator {
  // 'no período' (nao 'leads criados no período'): desde o item 7 do review
  // final, a tela concorda o singular/plural com a contagem ("1 lead criado"
  // vs "2 leads criados"), e este teste passa por exatamente essa fronteira
  // (linha 268, coorte com 1 lead so). Um texto fixo no plural quebraria ali.
  return secaoFunil(page)
    .locator('p')
    .filter({ hasText: 'no período' })
    .locator('span.tabular')
}

/** O span do NUMERO do degrau (o primeiro `span.tabular` da linha — o
 * segundo e o percentual). `nomeEtapa` casa por substring dentro do `<li>`,
 * seguro porque nenhum nome de etapa do pipeline padrao e substring de
 * outro. */
function contagemDoDegrau(page: Page, nomeEtapa: string): Locator {
  return secaoFunil(page).locator('li').filter({ hasText: nomeEtapa }).locator('span.tabular').first()
}

function secaoCanais(page: Page): Locator {
  return page.locator('section').filter({ hasText: 'Canais' })
}

/** `canais.tsx` renderiza a arvore como `<tr>` irmaos (nao aninhados) numa
 * unica `<tbody>`, indentados por `padding-left`. Por texto, nao por
 * posicao: cada rotulo usado aqui e unico na tela. */
function linhaDoCanal(page: Page, texto: string): Locator {
  return secaoCanais(page).locator('tr').filter({ hasText: texto })
}

async function expandir(linha: Locator) {
  await linha.getByRole('button', { name: 'Expandir' }).click()
}

/**
 * Um lead manual arrastado ate uma etapa do meio, mais um lead chegando pelo
 * webhook do Meta com a arvore de anuncio completa — e as duas perguntas que
 * a aba de Metricas existe para responder: o funil bate com o que foi
 * criado, e o canal Meta expande ate o anuncio.
 */
test('do lead manual e do webhook ate o anuncio, no funil e no canal', async ({ page, request }) => {
  const { email, empresa } = await criarConta(page)

  // accountId e o id do admin nao existem em lugar nenhum que a UI exponha
  // depois do signup. A fonte Meta desta conta nasce direto no banco (mesmo
  // padrao "operador" de tests/integration/helpers/ingestao.ts, e do proprio
  // global-setup.ts, que ja importa deste mesmo modulo), nunca pela tela de
  // Integracoes: aquele fluxo ja tem cobertura em integracoes.spec.ts, e
  // reusar ali uma das 3 Pages falsas fixas arriscaria colidir com a conta
  // que integracoes.spec.ts ja deixou conectada nesta mesma rodada (o
  // indice de lead_sources e GLOBAL). Um external_id aleatorio por rodada
  // (carimbo()) evita esse problema de raiz, em vez de conviver com ele.
  const accountId = await comoServico(async (c) => {
    const r = await c.query<{ id: string }>('select id from public.accounts where nome = $1', [empresa])
    return r.rows[0].id
  })
  const adminId = await comoServico(async (c) => {
    const r = await c.query<{ id: string }>('select id from public.profiles where email = $1', [email])
    return r.rows[0].id
  })

  const pageId = `page-metricas-${carimbo()}`
  await comoServico(async (c) => {
    const fonte = await c.query<{ id: string }>(
      `insert into public.lead_sources (account_id, provedor, external_id, nome, responsavel_padrao_id, ativo)
       values ($1, 'meta', $2, $3, $4, true) returning id`,
      [accountId, pageId, `Fonte Meta E2E ${carimbo()}`, adminId],
    )
    await c.query(
      `insert into public.source_credentials (source_id, meta_page_token) values ($1, 'tok-metricas-e2e')`,
      [fonte.rows[0].id],
    )
  })

  // --- lead manual, arrastado ate uma etapa do meio ---
  const nomeManual = `Lead Manual ${carimbo()}`
  await criarLead(page, nomeManual)

  const cartaoManual = page.getByRole('link', { name: nomeManual })
  await arrastar(page, cartaoManual, coluna(page, 'Qualificação'))
  await expect(
    page.getByRole('heading', { name: `${nomeManual} → Qualificação`, exact: true }),
  ).toBeVisible()
  await confirmarMovimento(page)

  // Positiva primeiro — so ela vale no estado pos-mudanca —, e so depois a
  // negativa. Mesma disciplina que funil.spec.ts ja usa para o mesmo tipo de
  // movimento.
  await expect(coluna(page, 'Qualificação').getByRole('link', { name: nomeManual })).toBeVisible()
  await expect(coluna(page, 'Novo lead').getByRole('link', { name: nomeManual })).toHaveCount(0)

  // --- lead do webhook do Meta, com arvore de anuncio completa ---
  const leadgenId = `leadgen-${carimbo()}`
  const corpoWebhook = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: pageId,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: 'leadgen',
            value: {
              leadgen_id: leadgenId,
              page_id: pageId,
              form_id: 'form-metricas-e2e',
              ad_id: 'ad-metricas-e2e',
            },
          },
        ],
      },
    ],
  })
  const respostaWebhook = await request.post('/api/webhooks/meta', {
    data: corpoWebhook,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': assinar(corpoWebhook) },
  })
  expect(respostaWebhook.ok()).toBe(true)

  // MetaGraphFalso nao tem este leadgenId semeado (so os testes unitarios
  // conseguem chamar `leads.set`, que nao e alcancavel por HTTP), entao
  // buscarLead cai no LEAD_PADRAO fixo: nome "Fulano de Tal", adId
  // "ad-padrao". E por isso que o `ad_id` mandado no corpo acima nunca
  // aparece na arvore — quem decide o anuncio e o Graph (real ou falso) que
  // RESOLVE o leadgenId, nao o payload de notificacao do webhook.
  // arvoreDoAnuncio('ad-padrao') e deterministica no proprio id
  // (meta-falso.ts), entao toda rodada deste teste produz os mesmos tres
  // nomes: "Campanha ad-padrao" / "Conjunto ad-padrao" / "Anuncio ad-padrao".
  //
  // Asserção positiva com timeout generoso, ANTES de qualquer leitura de
  // /metricas: `after()` (route.ts) processa a entrega DEPOIS do 200, entao
  // ha uma janela real entre o POST voltar e o lead existir. Reload em loop
  // — nao um `expect` so — porque o card so aparece depois que Graph ->
  // mapeia -> ingerir_lead termina de verdade, e a pagina atual e um
  // snapshot de antes do POST.
  await expect(async () => {
    await page.reload()
    await expect(coluna(page, 'Novo lead').getByRole('link', { name: 'Fulano de Tal' })).toBeVisible()
  }).toPass({ timeout: 20_000 })

  // --- /metricas: funil decrescendo, batendo com os dois leads ---
  await page.goto('/metricas')

  // ordemMax do lead manual e 3 (Qualificação — "lead que pulou etapa conta
  // nos degraus que pulou", mesmo sem passar por Contato feito). O do lead
  // do webhook e 1 (nunca saiu de Novo lead). Total da coorte: 2.
  await expect(totalDaCoorte(page)).toHaveText('2')
  await expect(contagemDoDegrau(page, 'Novo lead')).toHaveText('2')
  await expect(contagemDoDegrau(page, 'Contato feito')).toHaveText('1')
  await expect(contagemDoDegrau(page, 'Qualificação')).toHaveText('1')
  await expect(contagemDoDegrau(page, 'Proposta')).toHaveText('0')
  await expect(contagemDoDegrau(page, 'Fechamento')).toHaveText('0')

  // --- canal: Meta Ads -> campanha -> anuncio. A pergunta que fez o
  // sub-projeto existir. ---
  const linhaMeta = linhaDoCanal(page, 'Meta Ads')
  await expect(linhaMeta).toBeVisible()
  await expandir(linhaMeta)

  const linhaCampanha = linhaDoCanal(page, 'Campanha ad-padrao')
  await expect(linhaCampanha).toBeVisible()
  await expect(linhaCampanha.locator('td').nth(1)).toHaveText('1')
  await expandir(linhaCampanha)

  const linhaAnuncio = linhaDoCanal(page, 'Anuncio ad-padrao')
  await expect(linhaAnuncio).toBeVisible()
  await expect(linhaAnuncio.locator('td').nth(1)).toHaveText('1')

  // --- o lead manual, sem rastreamento nenhum, cai em (sem campanha) ---
  const linhaManual = linhaDoCanal(page, 'Manual')
  await expect(linhaManual).toBeVisible()
  await expandir(linhaManual)

  const linhaSemCampanha = linhaDoCanal(page, '(sem campanha)')
  await expect(linhaSemCampanha).toBeVisible()
  await expect(linhaSemCampanha.locator('td').nth(1)).toHaveText('1')

  // --- trocar o periodo muda o numero ---
  // Empurra so o lead do webhook para fora da janela de 7 dias, sem tocar no
  // lead manual: com ?dias=7 a coorte cai de 2 para 1. Update direto no
  // banco (mesmo padrao de tests/integration/0014_metricas.test.ts), porque
  // nao ha caminho de produto para editar criado_em.
  await comoServico(async (c) => {
    await c.query(
      `update public.leads set criado_em = now() - interval '10 days'
        where account_id = $1 and origem = 'meta'`,
      [accountId],
    )
  })

  await page.goto('/metricas?dias=7')
  await expect(totalDaCoorte(page)).toHaveText('1')
})
