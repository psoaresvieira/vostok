import { test, expect, type Locator, type Page } from '@playwright/test'
import { criarConta, criarLead, coluna } from './apoio'

/** Nome fixo da pipeline padrão, gravado pela RPC de signup (0002_pipeline.sql:93). */
const PIPELINE_PADRAO = 'Funil de vendas'

/** As 7 etapas da pipeline padrão, na ordem gravada pela mesma RPC. */
const ETAPAS_PADRAO = [
  'Novo lead',
  'Contato feito',
  'Qualificação',
  'Proposta',
  'Fechamento',
  'Ganho',
  'Perdido',
]

/**
 * Os headings das colunas do quadro, na ordem em que aparecem na tela.
 * `section h2` é exclusivo do Quadro (componente `Coluna` em quadro.tsx)
 * nesta página — nenhum modal usa `<section>`, então a lista reflete só a
 * pipeline ativa, mesmo com um modal aberto por cima.
 */
function colunas(page: Page): Locator {
  return page.locator('section h2')
}

test('múltiplas pipelines: criar, isolar leads, ficha e exclusão bloqueada', async ({ page }) => {
  await criarConta(page)

  // 1. criar pipeline pela barra: nome + remover 3 das 5 etapas sugeridas.
  // Os aria-label dos botões "Remover" são o NOME da etapa, não a posição —
  // removê-las por texto sobrevive à lista reindexando a cada clique.
  await page.getByRole('button', { name: 'Nova pipeline', exact: true }).click()
  await page.getByLabel('Nome da pipeline').fill('Outbound')
  await page.getByRole('button', { name: 'Remover Contato feito', exact: true }).click()
  await page.getByRole('button', { name: 'Remover Proposta', exact: true }).click()
  await page.getByRole('button', { name: 'Remover Fechamento', exact: true }).click()
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()

  // A action redireciona para `/funil?pipeline=<id>` e o quadro mostra as
  // colunas da nova pipeline: as 2 etapas que sobraram + Ganho + Perdido
  // (adicionadas automaticamente, nessa ordem).
  await expect(page).toHaveURL(/\/funil\?pipeline=/)
  await expect(colunas(page)).toHaveText(['Novo lead', 'Qualificação', 'Ganho', 'Perdido'])

  const nav = page.getByRole('navigation', { name: 'Pipelines' })
  await expect(nav.getByRole('link', { name: 'Outbound' })).toHaveAttribute('aria-current', 'page')

  // 2. lead nasce na pipeline ativa (Outbound). A primeira coluna se chama
  // "Novo lead" nas duas pipelines — o isolamento de verdade só fica provado
  // no passo 3, quando a padrão não mostra este card.
  await criarLead(page, 'Lead Outbound')
  await expect(coluna(page, 'Novo lead').getByRole('link', { name: 'Lead Outbound' })).toBeVisible()

  // Invariante do controlador: trocar um filtro (origem) enquanto está na
  // pipeline NOVA não pode derrubar `pipeline=` da URL — Filtros parte de
  // `useSearchParams()`, que já contém `pipeline`, e só adiciona/remove a
  // chave do próprio filtro (filtros.tsx:33-37). O select de origem é achado
  // pela option "meta" (value único nesta página — outros selects usam id de
  // membro/etapa, nunca esse literal).
  const filtroOrigem = page.locator('select:has(option[value="meta"])')
  await filtroOrigem.selectOption('manual')
  await expect(page).toHaveURL(/[?&]pipeline=/)
  await expect(page).toHaveURL(/[?&]origem=manual/)
  // Limpa o filtro: o resto do fluxo não deve herdar "só origem manual".
  await filtroOrigem.selectOption('')
  await expect(page).toHaveURL(/[?&]pipeline=/)
  await expect(page).not.toHaveURL(/origem=/)

  // 3. a padrão não vê o lead da Outbound: 7 colunas, sem o card.
  await nav.getByRole('link', { name: PIPELINE_PADRAO, exact: true }).click()
  await expect(page).not.toHaveURL(/pipeline=/)
  await expect(colunas(page)).toHaveText(ETAPAS_PADRAO)
  await expect(page.getByRole('link', { name: 'Lead Outbound' })).toHaveCount(0)

  // 4. ficha mostra as etapas da Outbound: volta pra Outbound, abre o card.
  await nav.getByRole('link', { name: 'Outbound' }).click()
  await expect(page).toHaveURL(/\/funil\?pipeline=/)
  await page.getByRole('link', { name: 'Lead Outbound' }).click()
  await expect(
    page.getByRole('heading', { name: 'Lead Outbound', exact: true, level: 1 }),
  ).toBeVisible()

  const opcoesMoverPara = await page.getByLabel('Mover para').locator('option').allTextContents()
  expect(opcoesMoverPara).toEqual(['Novo lead', 'Qualificação', 'Ganho', 'Perdido'])

  // Voltar pelo link da ficha retorna ao funil preservando `?pipeline=` — a
  // ficha sabe que o lead é da Outbound (pipeline.valor.pipeline.isDefault é
  // false) e monta o href com o id (page.tsx:138-142).
  // A seta virou icone aria-hidden na revisao de telas; o nome acessivel do
  // link e so "Voltar ao funil" — dai o regex, como o comentario da propria
  // ficha recomenda.
  await page.getByRole('link', { name: /voltar ao funil/i }).click()
  await expect(page).toHaveURL(/\/funil\?pipeline=/)

  // 5. excluir bloqueada com leads: kebab → Excluir → Confirmar exclusão.
  await nav.getByRole('button', { name: 'Opções de Outbound' }).click()
  await page.getByRole('button', { name: 'Excluir', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click()

  // Frase exata de `mensagemDePipeline('pipeline_com_leads')` em erros.ts.
  await expect(
    page.getByText(/^Essa pipeline ainda tem leads\. Mova ou exclua os leads antes\.$/),
  ).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Outbound' })).toBeVisible()
})
