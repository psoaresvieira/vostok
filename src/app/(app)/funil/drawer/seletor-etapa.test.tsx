// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { Etapa, Lead, Pipeline } from '@/lib/domain/tipos'
import { corDaEtapa } from '@/lib/domain/etapa-cor'

// Mesmo registro manual de cartao.test.tsx: sem globals, o cleanup do
// @testing-library nao se registra sozinho e o document vaza entre os it().
afterEach(cleanup)

// So as duas actions de movimento: componente de cliente nao aceita store
// injetavel, e o que este teste precisa provar e' QUAL das duas foi chamada,
// com quais ids.
const moverEtapaMock = vi.fn()
const moverParaPipelineMock = vi.fn()

vi.mock('../acoes', () => ({
  moverEtapaAction: (...args: unknown[]) => moverEtapaMock(...args),
  moverParaPipelineAction: (...args: unknown[]) => moverParaPipelineMock(...args),
}))

import { SeletorEtapa } from './seletor-etapa'

const PADRAO: Pipeline = { id: 'pipe-1', nome: 'Funil de vendas', isDefault: true }
const POS: Pipeline = { id: 'pipe-2', nome: 'Pós-venda', isDefault: false }

function etapa(
  id: string,
  pipelineId: string,
  nome: string,
  ordem: number,
  tipo: Etapa['tipo'] = 'aberta',
): Etapa {
  return { id, pipelineId, nome, ordem, tipo, slaHoras: null }
}

// As fechadas vem ANTES das abertas na lista crua de proposito: a ordem que o
// seletor mostra (abertas por `ordem`, depois ganho/perdido) tem que ser dele,
// e nao a ordem em que as etapas chegaram.
const ETAPAS_PADRAO: Etapa[] = [
  etapa('p1-ganho', PADRAO.id, 'Ganho', 3, 'ganho'),
  etapa('p1-perdido', PADRAO.id, 'Perdido', 4, 'perdido'),
  etapa('p1-e2', PADRAO.id, 'Proposta', 2),
  etapa('p1-e1', PADRAO.id, 'Novo lead', 1),
]

const ETAPAS_POS: Etapa[] = [
  etapa('p2-e1', POS.id, 'Implantação', 1),
  etapa('p2-e2', POS.id, 'Acompanhamento', 2),
  etapa('p2-ganho', POS.id, 'Ganho', 3, 'ganho'),
  etapa('p2-perdido', POS.id, 'Perdido', 4, 'perdido'),
]

const PIPELINES = [
  { pipeline: PADRAO, etapas: ETAPAS_PADRAO },
  { pipeline: POS, etapas: ETAPAS_POS },
]

// 50h atras: `rotuloTempoNaEtapa` diz "2d", e o rotulo do gatilho e' relativo a
// AGORA — fixar a data absoluta faria o teste envelhecer junto com o relogio.
const HORAS_NA_ETAPA = 50

function lead(extras: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    accountId: 'conta-1',
    nome: 'Kariny',
    telefone: null,
    telefoneE164: null,
    email: null,
    emailNorm: null,
    empresa: null,
    origem: 'manual',
    pipelineId: PADRAO.id,
    stageId: 'p1-e2',
    responsavelId: null,
    status: 'aberto',
    valorCents: 150_000,
    lossReasonId: null,
    entrouNaEtapaEm: new Date(Date.now() - HORAS_NA_ETAPA * 3_600_000),
    criadoEm: new Date(Date.now() - 200 * 3_600_000),
    atualizadoEm: new Date(),
    etiquetas: [],
    ...extras,
  }
}

const aoMover = vi.fn()

function montar(extras: Partial<Lead> = {}) {
  return render(
    <SeletorEtapa
      lead={lead(extras)}
      pipelines={PIPELINES}
      motivos={[{ id: 'motivo-1', nome: 'Preço', ativo: true }]}
      etiquetasConhecidas={[]}
      aoMover={aoMover}
    />,
  )
}

function abrir() {
  fireEvent.click(screen.getByRole('button', { name: /^Proposta ·/ }))
  return screen.getByRole('listbox')
}

/** O clique em "Confirmar" dispara a action: o await do handler tem que
 *  terminar DENTRO do act, senao o React avisa (com razao) que o estado mudou
 *  fora dele. */
async function confirmar() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  moverEtapaMock.mockResolvedValue({ ok: true, valor: undefined })
  moverParaPipelineMock.mockResolvedValue({ ok: true, valor: undefined })
})

describe('SeletorEtapa — o popover', () => {
  it('o gatilho e um botao com a etapa atual e ha quanto tempo o lead esta nela', () => {
    montar()

    const gatilho = screen.getByRole('button', { name: 'Proposta · há 2d' })
    expect(gatilho.getAttribute('aria-haspopup')).toBe('listbox')
    expect(gatilho.getAttribute('aria-expanded')).toBe('false')
    // Fechado ao montar: o painel nem existe no DOM.
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('abre com a pipeline do lead expandida, abertas na ordem e fechadas no fim', () => {
    montar()
    const lista = abrir()

    expect(screen.getByRole('button', { name: /^Proposta ·/ }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    // `ordem` manda, e nao a ordem em que as etapas chegaram; ganho e perdido
    // vao para o fim porque sao desfecho, nao caminho.
    expect(within(lista).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Novo lead',
      'Proposta',
      'Ganho',
      'Perdido',
    ])
    // Um grupo por pipeline, nomeado por ela.
    expect(within(lista).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Funil de vendas',
      'Pós-venda',
    ])
  })

  it('marca so a etapa atual com aria-selected', () => {
    montar()
    const lista = abrir()

    const selecionadas = within(lista)
      .getAllByRole('option')
      .filter((o) => o.getAttribute('aria-selected') === 'true')
    expect(selecionadas.map((o) => o.textContent)).toEqual(['Proposta'])
  })

  it('as outras pipelines aparecem so como cabecalho, ate serem expandidas', () => {
    montar()
    const lista = abrir()

    expect(within(lista).getByRole('button', { name: 'Pós-venda' })).toBeTruthy()
    expect(within(lista).queryByRole('option', { name: 'Implantação' })).toBeNull()

    fireEvent.click(within(lista).getByRole('button', { name: 'Pós-venda' }))

    expect(within(lista).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Implantação',
      'Acompanhamento',
      'Ganho',
      'Perdido',
    ])
    // Uma expandida por vez: as etapas da pipeline anterior saem da lista.
    expect(within(lista).queryByRole('option', { name: 'Novo lead' })).toBeNull()
  })

  it('cada opcao usa a cor do INDICE dela entre as abertas, nao a de `ordem`', () => {
    montar()
    const lista = abrir()

    // Proposta tem ordem 2 e e' a SEGUNDA aberta (indice 1). corDaEtapa(2) e
    // corDaEtapa(1) sao cores diferentes — este teste so passa com o indice.
    const proposta = within(lista).getByRole('option', { name: 'Proposta' })
    expect(proposta.className).toContain(corDaEtapa(1, 'aberta').fundo)
    expect(proposta.className).not.toContain(corDaEtapa(2, 'aberta').fundo)

    // Desfecho ignora a posicao.
    expect(within(lista).getByRole('option', { name: 'Ganho' }).className).toContain(
      corDaEtapa(0, 'ganho').fundo,
    )
    expect(within(lista).getByRole('option', { name: 'Perdido' }).className).toContain(
      corDaEtapa(0, 'perdido').fundo,
    )
  })

  it('Escape fecha o popover', () => {
    montar()
    abrir()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('clique fora fecha o popover', () => {
    montar()
    abrir()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('SeletorEtapa — mover', () => {
  it('etapa da MESMA pipeline: confirma com moverEtapaAction e avisa quem chamou', async () => {
    montar()
    const lista = abrir()

    fireEvent.click(within(lista).getByRole('option', { name: 'Novo lead' }))

    // O popover sai de cena e o modal de movimento assume, com o mesmo
    // cabecalho do quadro.
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Kariny → Novo lead' })).toBeTruthy()

    await confirmar()

    expect(moverEtapaMock).toHaveBeenCalledWith('lead-1', 'p1-e1', null, [])
    expect(moverParaPipelineMock).not.toHaveBeenCalled()
    expect(aoMover).toHaveBeenCalledWith({ pipelineId: 'pipe-1', stageId: 'p1-e1' })
  })

  it('etapa de OUTRA pipeline: confirma com moverParaPipelineAction', async () => {
    montar()
    const lista = abrir()

    fireEvent.click(within(lista).getByRole('button', { name: 'Pós-venda' }))
    fireEvent.click(within(lista).getByRole('option', { name: 'Implantação' }))

    expect(screen.getByRole('heading', { name: 'Kariny → Implantação' })).toBeTruthy()

    await confirmar()

    expect(moverParaPipelineMock).toHaveBeenCalledWith('lead-1', 'p2-e1', null, [])
    expect(moverEtapaMock).not.toHaveBeenCalled()
    expect(aoMover).toHaveBeenCalledWith({ pipelineId: 'pipe-2', stageId: 'p2-e1' })
  })

  it('escolher a etapa ATUAL so fecha: nao ha movimento a confirmar', () => {
    montar()
    const lista = abrir()

    fireEvent.click(within(lista).getByRole('option', { name: 'Proposta' }))

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('heading', { name: /Kariny →/ })).toBeNull()
    expect(moverEtapaMock).not.toHaveBeenCalled()
    expect(moverParaPipelineMock).not.toHaveBeenCalled()
    expect(aoMover).not.toHaveBeenCalled()
  })

  it('recusa do servidor vira mensagem traduzida, e nada de aoMover', async () => {
    moverParaPipelineMock.mockResolvedValue({ ok: false, erro: 'mesma_pipeline' })
    montar()
    const lista = abrir()

    fireEvent.click(within(lista).getByRole('button', { name: 'Pós-venda' }))
    fireEvent.click(within(lista).getByRole('option', { name: 'Implantação' }))
    await confirmar()

    // O texto e' o de funil/erros.ts, e nao o codigo cru.
    expect(screen.getByRole('alert').textContent).toBe(
      'Esse lead já está nessa pipeline. Escolha uma etapa.',
    )
    // Navegar depois de uma falha levaria o usuario para uma pipeline em que o
    // lead nao esta.
    expect(aoMover).not.toHaveBeenCalled()

    // Reabrir o seletor apaga a mensagem: os dois sao ancorados sob o gatilho,
    // e a lista sobre a frase deixaria as duas ilegiveis.
    fireEvent.click(screen.getByRole('button', { name: /^Proposta ·/ }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('perda exige motivo, e ele vai junto na action', async () => {
    montar()
    const lista = abrir()

    fireEvent.click(within(lista).getByRole('option', { name: 'Perdido' }))
    fireEvent.change(screen.getByLabelText(/Motivo da perda/), {
      target: { value: 'motivo-1' },
    })
    await confirmar()

    expect(moverEtapaMock).toHaveBeenCalledWith('lead-1', 'p1-perdido', 'motivo-1', [])
  })
})
