import { test, expect, type Locator, type Page } from '@playwright/test'
import { criarConta, coluna } from './apoio'

/**
 * Os headings das colunas do quadro, na ordem em que aparecem na tela.
 * Diferente de pipelines.spec.ts, aqui `section h2` NAO basta: o painel
 * «Editar etapas» aberto tambem e' um `<section>` com um `<h2>Etapas do
 * funil</h2>` (etapas.tsx:172), entao esta spec teria dois "matches" para a
 * mesma consulta. `div.overflow-x-auto` e' a faixa rolavel que envolve so' as
 * colunas do quadro (quadro.tsx:155) — classe exclusiva desta pagina (a unica
 * outra ocorrencia no repo e' metricas/canais.tsx, fora do funil).
 */
function colunas(page: Page): Locator {
  return page.locator('div.overflow-x-auto section h2')
}

/**
 * O disclosure «Editar etapas» inteiro (botao + painel, quando aberto) mora
 * num unico <section>, igual as colunas do quadro — filtrar pelo botao
 * (unico com este nome na pagina) isola o painel sem depender de ele estar
 * aberto ou fechado no momento da chamada.
 */
function painelEtapas(page: Page): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('button', { name: 'Editar etapas', exact: true }) })
}

/**
 * Os valores dos inputs de nome, na ordem em que a lista os mostra. O input
 * de cada linha (etapas.tsx) nao tem label nem placeholder — e' o unico
 * controle de texto da linha, ao lado de botoes — entao ler `.value` direto
 * do DOM e' o unico jeito de enumerar as etapas que o painel exibe.
 */
async function nomesNoPainel(painel: Locator): Promise<string[]> {
  return painel
    .locator('ul li input')
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
}

test('gestão de etapas pelo funil: renomear, adicionar e excluir refletem no quadro', async ({
  page,
}) => {
  await criarConta(page)

  // 1. criar a pipeline "Renovação" com 2 etapas abertas — remove 3 das 5
  // sugeridas pelo modal, mesmo padrao de pipelines.spec.ts (remover por
  // texto sobrevive a lista reindexando a cada clique). Ganho e Perdido
  // entram sozinhas: sobram 4 etapas ao todo.
  await page.getByRole('button', { name: '+ Nova pipeline', exact: true }).click()
  await page.getByLabel('Nome da pipeline').fill('Renovação')
  await page.getByRole('button', { name: 'Remover Contato feito', exact: true }).click()
  await page.getByRole('button', { name: 'Remover Proposta', exact: true }).click()
  await page.getByRole('button', { name: 'Remover Fechamento', exact: true }).click()
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()

  await expect(page).toHaveURL(/\/funil\?pipeline=/)
  await expect(colunas(page)).toHaveText(['Novo lead', 'Qualificação', 'Ganho', 'Perdido'])

  // Abre o painel «Editar etapas» da pipeline recem-criada (ela ja e' a ativa
  // — criarPipelineAction redireciona para `/funil?pipeline=<id>`) e confere
  // que ele lista as mesmas 4 etapas do quadro.
  const painel = painelEtapas(page)
  await painel.getByRole('button', { name: 'Editar etapas', exact: true }).click()
  await expect(painel.getByRole('button', { name: 'Editar etapas', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(painel.getByRole('heading', { name: 'Etapas do funil', exact: true })).toBeVisible()
  expect(await nomesNoPainel(painel)).toEqual(['Novo lead', 'Qualificação', 'Ganho', 'Perdido'])

  // 2. renomear a primeira etapa aberta reflete no heading da coluna. O input
  // e' nao controlado e so' dispara a action no blur (etapas.tsx:178) — fill()
  // sozinho, sem blur, nao chama renomearEtapaAction.
  const inputPrimeiraEtapa = painel.locator('ul li').first().locator('input')
  await inputPrimeiraEtapa.fill('Primeiro contato')
  await inputPrimeiraEtapa.blur()
  await expect(colunas(page)).toHaveText(['Primeiro contato', 'Qualificação', 'Ganho', 'Perdido'])

  // 3. adicionar uma etapa aberta vira coluna nova no quadro. criarEtapa
  // grava ordem = max(ordem) + 1 (etapas.ts:65), entao a coluna nova aparece
  // no fim da lista, depois de Perdido — o select de tipo ja nasce em
  // "aberta" (default do componente), nao precisa trocar.
  await painel.getByPlaceholder('nova etapa', { exact: true }).fill('Negociação')
  await painel.getByRole('button', { name: 'Adicionar', exact: true }).click()
  await expect(colunas(page)).toHaveText([
    'Primeiro contato',
    'Qualificação',
    'Ganho',
    'Perdido',
    'Negociação',
  ])

  // 4. lead na primeira etapa bloqueia a exclusao dela: cria pelo botao da
  // pagina (nao usa o helper `criarLead` de apoio.ts porque ele assume a
  // coluna ainda se chamar "Novo lead" — aqui ja foi renomeada no passo 2).
  await page.getByRole('button', { name: 'Novo lead' }).click()
  await page.getByPlaceholder('nome', { exact: true }).fill('Lead Renovação')
  await page.getByPlaceholder('telefone', { exact: true }).fill('(83) 99999-1234')
  await page.getByPlaceholder('valor em reais', { exact: true }).fill('1.500,00')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(
    coluna(page, 'Primeiro contato').getByRole('link', { name: 'Lead Renovação' }),
  ).toBeVisible()

  await painel.getByRole('button', { name: 'Excluir etapa Primeiro contato', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Excluir etapa Primeiro contato', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Confirmar exclusão de Primeiro contato', exact: true })
    .click()

  // A recusa (etapa_tem_leads) veio com o lead ja contado no resumo — a tela
  // troca o texto generico de mensagemDeEtapa por um com o numero real de
  // leads (etapas.tsx:142-148, mensagemMoverLeads).
  await expect(page.getByText('Mova o 1 lead desta etapa antes de excluí-la.')).toBeVisible()
  await expect(coluna(page, 'Primeiro contato')).toBeVisible()
  await expect(colunas(page)).toHaveText([
    'Primeiro contato',
    'Qualificação',
    'Ganho',
    'Perdido',
    'Negociação',
  ])

  // 5. excluir uma etapa vazia some a coluna do quadro.
  await painel.getByRole('button', { name: 'Excluir etapa Negociação', exact: true }).click()
  await page
    .getByRole('button', { name: 'Confirmar exclusão de Negociação', exact: true })
    .click()
  await expect(colunas(page)).toHaveText(['Primeiro contato', 'Qualificação', 'Ganho', 'Perdido'])
})
