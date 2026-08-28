// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Etapa, Etiqueta, Lead, Pipeline } from '@/lib/domain/tipos'
import { corDaEtapa } from '@/lib/domain/etapa-cor'
import { CabecalhoLead } from './cabecalho'

// Mesmo motivo de cartao.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

// O editor de etiquetas fala com o servidor no submit; aqui so precisamos que
// ele monte quando o "+" o revela.
vi.mock('./acoes', () => ({
  adicionarEtiquetas: async () => ({ ok: true, valor: undefined }),
  removerEtiqueta: async () => ({ ok: true, valor: undefined }),
}))

const PIPELINE: Pipeline = { id: 'pipe-1', nome: 'Funil de vendas', isDefault: true }

function etapa(id: string, nome: string, ordem: number, tipo: Etapa['tipo'] = 'aberta'): Etapa {
  return { id, pipelineId: PIPELINE.id, nome, ordem, tipo, slaHoras: null }
}

// Quatro abertas + ganho + perdido — a forma de uma pipeline real.
const ETAPAS: Etapa[] = [
  etapa('e1', 'Novo lead', 1),
  etapa('e2', 'Qualificação', 2),
  etapa('e3', 'Proposta', 3),
  etapa('e4', 'Negociação', 4),
  etapa('e5', 'Ganho', 5, 'ganho'),
  etapa('e6', 'Perdido', 6, 'perdido'),
]

function lead(extras: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    accountId: 'conta-1',
    nome: 'Kariny',
    telefone: null,
    telefoneE164: '+5583999990000',
    email: null,
    emailNorm: null,
    empresa: null,
    origem: 'manual',
    pipelineId: PIPELINE.id,
    stageId: 'e2',
    responsavelId: null,
    status: 'aberto',
    valorCents: 150_000,
    lossReasonId: null,
    entrouNaEtapaEm: new Date('2026-08-28T12:00:00Z'),
    criadoEm: new Date('2026-08-20T12:00:00Z'),
    atualizadoEm: new Date('2026-08-28T12:00:00Z'),
    etiquetas: [],
    ...extras,
  }
}

const CONHECIDAS: Etiqueta[] = [{ id: 'tag-1', nome: 'Preço alto' }]

function montar(l: Lead, etapas: Etapa[] = ETAPAS) {
  return render(
    <CabecalhoLead
      lead={l}
      tituloId="titulo-drawer"
      pipeline={PIPELINE}
      etapas={etapas}
      etiquetasConhecidas={CONHECIDAS}
      gatilhoEtapa={<span>Qualificação · agora</span>}
    />,
  )
}

/** As faixas da barra de progresso, na ordem em que aparecem. */
function faixas(nomeDaBarra: RegExp): HTMLElement[] {
  const barra = screen.getByRole('img', { name: nomeDaBarra })
  return Array.from(barra.children) as HTMLElement[]
}

describe('CabecalhoLead', () => {
  it('nome no h2 com o id que o dialogo aponta, e o valor formatado', () => {
    montar(lead())

    const titulo = screen.getByRole('heading', { name: 'Kariny', level: 2 })
    expect(titulo.getAttribute('id')).toBe('titulo-drawer')
    expect(screen.getByText('R$ 1.500,00')).toBeTruthy()
  })

  it('mostra o nome da pipeline e o gatilho de etapa que recebeu', () => {
    montar(lead())

    expect(screen.getByText('Funil de vendas')).toBeTruthy()
    expect(screen.getByText('Qualificação · agora')).toBeTruthy()
  })

  it('barra: uma faixa por etapa ABERTA, apagadas so as posteriores a atual', () => {
    montar(lead({ stageId: 'e2' }))

    const barra = faixas(/^Etapa 2 de 4: Qualificação$/)
    // Ganho e Perdido nao viram faixa: nao sao caminho do funil, sao desfecho.
    expect(barra).toHaveLength(4)
    expect(barra.map((f) => f.className.includes('opacity-30'))).toEqual([
      false,
      false,
      true,
      true,
    ])
  })

  it('cada faixa carrega a cor da POSICAO dela entre as abertas (indice 0-based)', () => {
    montar(lead({ stageId: 'e1' }))

    const barra = faixas(/^Etapa 1 de 4: Novo lead$/)
    // As classes vem de corDaEtapa e nao sao repetidas aqui: o que este caso
    // fixa e' o ARGUMENTO — o indice 0-based dentro das abertas. Passar
    // `etapa.ordem` (que comeca em 1) deslocaria as quatro cores.
    expect(barra.map((f) => f.className.includes(corDaEtapa(0, 'aberta').fundo))).toEqual([
      true,
      false,
      false,
      false,
    ])
    expect(barra[1].className).toContain(corDaEtapa(1, 'aberta').fundo)
    expect(barra[2].className).toContain(corDaEtapa(2, 'aberta').fundo)
    expect(barra[3].className).toContain(corDaEtapa(3, 'aberta').fundo)
  })

  it('lead ganho: nenhuma faixa apagada, e o rotulo nomeia o desfecho', () => {
    montar(lead({ stageId: 'e5', status: 'ganho' }))

    const barra = faixas(/^Etapa: Ganho$/)
    expect(barra).toHaveLength(4)
    expect(barra.every((f) => !f.className.includes('opacity-30'))).toBe(true)
  })

  it('etiquetas do lead aparecem como selo; o editor so abre pelo botao', () => {
    montar(lead({ etiquetas: [{ id: 'tag-1', nome: 'Preço alto' }] }))

    expect(screen.getByText('Preço alto')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/nova etiqueta/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Editar etiquetas' }))
    expect(screen.getByPlaceholderText(/nova etiqueta/i)).toBeTruthy()
  })
})
