import { test, expect, type Page } from '@playwright/test'
import { SENHA, carimbo, criarConta, criarLead, coluna } from './apoio'
import { FUSO_PADRAO } from '@/lib/domain/tarefa'

/**
 * O percurso do brief da Task 7, ponta a ponta: vendedor agenda uma tarefa
 * para amanha, ve ela em "Proximos 7 dias", agenda uma segunda para ontem, ve
 * ela em "Atrasadas", conclui a atrasada (some da lista) e volta ao lead para
 * ver "Tarefa concluida" na timeline. Mais as duas propriedades que o
 * criterio de aceite do plano exige e que esses seis passos nao cobrem: um
 * segundo vendedor da mesma conta nao ve nenhuma dessas tarefas, e o admin ve
 * as dele por padrao e chega as dos outros pelo filtro.
 *
 * A Task 8 do Plano 13 (remodelada) removeu o link "Tarefas" e o badge de
 * urgentes do header — a rota /tarefas em si continua de pe, so deixou de
 * estar listada na navegacao. Este arquivo ja navegava por URL direta
 * (`page.goto('/tarefas')`), nunca clicando o link do header, entao os passos
 * abaixo continuam validos tal como estao; so as asercoes que liam o
 * accessible name do link/badge do header saíram.
 */

// --- datas relativas ao dia civil em FUSO_PADRAO, nunca ao relogio da
// maquina que roda o teste: mesma logica de dominio/tarefa.ts (diaCivil +
// somarDias), duplicada aqui de proposito. Importar a funcao privada nao da
// (nao e exportada), e reimplementar o mesmo calculo evita que o teste dependa
// do fuso local do executor — que pode nao ser America/Sao_Paulo — para
// escolher "ontem" e "amanha" corretamente perto da virada de meia-noite.

function diaCivil(data: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(data)
}

function somarDias(diaCivilBase: string, dias: number): string {
  const [ano, mes, dia] = diaCivilBase.split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  d.setUTCDate(d.getUTCDate() + dias)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(d)
}

function datetimeLocal(diaCivilAlvo: string, horaMinuto: string): string {
  return `${diaCivilAlvo}T${horaMinuto}`
}

// --- convite: mesmo padrao de sino-isolamento.spec.ts e convite.spec.ts (a
// tela de configuracao chega por navegacao de documento inteiro, e um clique
// disparado antes do React anexar o onClick se perde; "Convidar" com o campo
// vazio devolve email_invalido sem escrever nada e serve de sonda).

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

// --- localizadores das telas de tarefa ---

/** A secao de um balde em /tarefas ou no painel do lead: `<h2>`/`<h3>` do
 * rotulo seguido da `<ul>` de itens, os dois dentro do mesmo `<section>`. */
function secaoBalde(page: Page, rotulo: string): import('@playwright/test').Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: rotulo, exact: true }) })
}

function itemDaTarefa(secao: import('@playwright/test').Locator, texto: string) {
  return secao.locator('li').filter({ hasText: texto })
}

async function abrirLead(page: Page, nomeDoLead: string) {
  await page.getByRole('link', { name: nomeDoLead }).click()
  await expect(page.getByRole('heading', { name: nomeDoLead, exact: true, level: 1 })).toBeVisible()
}

async function criarTarefaNaFicha(
  page: Page,
  titulo: string,
  venceEmLocal: string,
): Promise<void> {
  await page.getByPlaceholder('título da tarefa').fill(titulo)
  await page.locator('input[type="datetime-local"]').fill(venceEmLocal)
  const resposta = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/leads/'),
  )
  await page.getByRole('button', { name: 'Criar tarefa' }).click()
  await resposta
}

test.describe('ciclo de vida de uma tarefa, da ficha do lead a lista de /tarefas', () => {
  test('vendedor agenda, ve nos baldes certos, conclui e a timeline registra — isolado de outro vendedor, visivel ao admin pelo filtro', async ({
    browser,
  }) => {
    const contextoAdmin = await browser.newContext()
    const contextoVendedorA = await browser.newContext()
    const contextoVendedorB = await browser.newContext()

    try {
      const paginaAdmin = await contextoAdmin.newPage()
      await criarConta(paginaAdmin)

      const emailA = `vendedor-a-${carimbo()}@exemplo.com`
      const linkA = await convidarVendedor(paginaAdmin, emailA)
      const paginaA = await contextoVendedorA.newPage()
      await aceitarConvite(paginaA, linkA, 'Vendedor A E2E', emailA)

      // --- Passo 1: vendedor abre um lead dele ---
      const nomeLead = `Lead Tarefa ${carimbo()}`
      await criarLead(paginaA, nomeLead)
      await abrirLead(paginaA, nomeLead)

      // --- Passo 2: "Ligar para negociar", prazo amanha as 14h ---
      const hoje = diaCivil(new Date(), FUSO_PADRAO)
      const amanha = somarDias(hoje, 1)
      const ontem = somarDias(hoje, -1)
      const tituloUrgente = 'Ligar para negociar'
      await criarTarefaNaFicha(paginaA, tituloUrgente, datetimeLocal(amanha, '14:00'))

      // Positiva na propria ficha, antes de sair dela: a tarefa aberta
      // aparece na secao "Abertas" do painel.
      await expect(
        itemDaTarefa(secaoBalde(paginaA, 'Abertas'), tituloUrgente),
      ).toBeVisible()

      // --- Passo 3: /tarefas, sob "Proximos 7 dias", com o nome do lead ---
      await paginaA.goto('/tarefas')
      await expect(
        itemDaTarefa(secaoBalde(paginaA, 'Próximos 7 dias'), `${nomeLead} · ${tituloUrgente}`),
      ).toBeVisible()

      // --- Passo 4: segunda tarefa, prazo ontem, sob "Atrasadas" ---
      await abrirLead(paginaA, nomeLead)
      const tituloAtrasado = 'Confirmar orçamento'
      await criarTarefaNaFicha(paginaA, tituloAtrasado, datetimeLocal(ontem, '09:00'))
      await expect(
        itemDaTarefa(secaoBalde(paginaA, 'Abertas'), tituloAtrasado),
      ).toBeVisible()

      await paginaA.goto('/tarefas')
      const secaoAtrasadas = secaoBalde(paginaA, 'Atrasadas')
      await expect(itemDaTarefa(secaoAtrasadas, `${nomeLead} · ${tituloAtrasado}`)).toBeVisible()

      // --- Passo 5: concluir a atrasada. ---
      await itemDaTarefa(secaoAtrasadas, `${nomeLead} · ${tituloAtrasado}`)
        .getByRole('button', { name: 'Concluir' })
        .click()

      // A linha atrasada some da secao depois de concluida. O badge da
      // navegacao que costumava confirmar essa mesma contagem por outro
      // angulo saiu com a Task 8 (Plano 13 remodelada) — o link "Tarefas" do
      // header nao existe mais, so a rota /tarefas em si (que continua de
      // pe); a garantia aqui passa a ser so sobre a propria lista.
      await expect(itemDaTarefa(secaoAtrasadas, `${nomeLead} · ${tituloAtrasado}`)).toHaveCount(0)

      // --- Passo 6: voltar ao lead, ver "Tarefa concluída" na timeline ---
      await abrirLead(paginaA, nomeLead)
      await expect(
        paginaA.getByText(`Tarefa concluída: ${tituloAtrasado}`, { exact: true }),
      ).toBeVisible()

      // ================================================================
      // Propriedades extras do criterio de aceite do plano: isolamento entre
      // vendedores, e o admin vendo as suas por padrao e as dos outros pelo
      // filtro.
      // ================================================================

      // --- Segundo vendedor da mesma conta: nao ve nenhuma das tarefas
      // acima em /tarefas. ---
      const emailB = `vendedor-b-${carimbo()}@exemplo.com`
      const linkB = await convidarVendedor(paginaAdmin, emailB)
      const paginaB = await contextoVendedorB.newPage()
      await aceitarConvite(paginaB, linkB, 'Vendedor B E2E', emailB)

      await paginaB.goto('/tarefas')
      // Positiva primeiro: a tela do vendedor B carregou de verdade (nao uma
      // pagina quebrada que por acaso nao lista nada).
      await expect(paginaB.getByRole('heading', { name: 'Tarefas', level: 1 })).toBeVisible()
      await expect(paginaB.getByText('Nenhuma tarefa aberta.')).toBeVisible()
      // So agora a negativa: nem o lead nem o titulo da tarefa remanescente
      // (a de amanha, ainda aberta) aparecem para o vendedor B.
      await expect(paginaB.getByText(nomeLead)).toHaveCount(0)
      await expect(paginaB.getByText(tituloUrgente)).toHaveCount(0)

      // --- Admin: ve as dele por padrao (nao as de todo mundo), e chega as
      // do vendedor A pelo filtro. ---
      const nomeLeadAdmin = `Lead do Admin ${carimbo()}`
      await paginaAdmin.goto('/funil')
      await paginaAdmin.getByRole('button', { name: 'Novo lead' }).click()
      await paginaAdmin.getByPlaceholder('nome', { exact: true }).fill(nomeLeadAdmin)
      await paginaAdmin.getByPlaceholder('telefone', { exact: true }).fill('(83) 99999-1234')
      await paginaAdmin.getByPlaceholder('valor em reais', { exact: true }).fill('1.500,00')
      // O quadro do funil sempre renderiza 3 outros <select> (filtros.tsx),
      // entao getByRole('combobox') sem escopo bate em 4 elementos. Escopar
      // pelo <form> que contem o placeholder exato "nome" isola o combobox
      // do modal "Novo lead", o unico que tem esse input.
      const formNovoLead = paginaAdmin
        .locator('form')
        .filter({ has: paginaAdmin.getByPlaceholder('nome', { exact: true }) })
      // Admin escolhe a si mesmo como responsavel — sem isto o lead fica
      // "sem responsável" e nao apareceria em /tarefas por padrao para
      // ninguem, o que provaria isolamento por acidente, nao por filtro.
      await formNovoLead.getByRole('combobox').selectOption({ label: 'Pedro E2E' })
      await paginaAdmin.getByRole('button', { name: 'Salvar' }).click()
      await expect(
        coluna(paginaAdmin, 'Novo lead').getByRole('link', { name: nomeLeadAdmin }),
      ).toBeVisible()

      await abrirLead(paginaAdmin, nomeLeadAdmin)
      const tituloDoAdmin = 'Follow-up do admin'
      await criarTarefaNaFicha(paginaAdmin, tituloDoAdmin, datetimeLocal(amanha, '10:00'))

      // Positiva: por padrao (sem filtro), o admin ve a tarefa dele proprio.
      await paginaAdmin.goto('/tarefas')
      await expect(
        itemDaTarefa(secaoBalde(paginaAdmin, 'Próximos 7 dias'), `${nomeLeadAdmin} · ${tituloDoAdmin}`),
      ).toBeVisible()
      // Negativa, so depois da positiva acima: por padrao, nao a do
      // vendedor A.
      await expect(paginaAdmin.getByText(nomeLead)).toHaveCount(0)

      // Filtro para o vendedor A: agora sim a tarefa dele aparece. O
      // formulario de /tarefas (page.tsx) e' HTML simples sem onChange -
      // <form action="/tarefas"> sem method e' GET por padrao -, entao e'
      // uma navegacao de documento inteiro disparada pelo clique em
      // "Filtrar", nao uma Server Action por POST (diferente do combobox de
      // responsavel padrao em /config, que sino.spec.ts espera por POST).
      await paginaAdmin.getByRole('combobox').selectOption({ label: 'Vendedor A E2E' })
      await paginaAdmin.getByRole('button', { name: 'Filtrar' }).click()
      await paginaAdmin.waitForURL(/\/tarefas\?responsavel=/)
      await expect(
        itemDaTarefa(secaoBalde(paginaAdmin, 'Próximos 7 dias'), `${nomeLead} · ${tituloUrgente}`),
      ).toBeVisible()
    } finally {
      await contextoAdmin.close()
      await contextoVendedorA.close()
      await contextoVendedorB.close()
    }
  })
})
