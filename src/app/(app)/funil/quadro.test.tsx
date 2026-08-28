// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react'
import type { ColunaDoFunil, Etapa, LeadDoFunil } from '@/lib/domain/tipos'
import { ok, falha } from '@/lib/domain/resultado'

// Cleanup manual: este vitest.config nao liga globals, entao o afterEach
// automatico do @testing-library nao se registra sozinho (ver cartao.test.tsx).
afterEach(cleanup)

const maisLeadsMock = vi.fn()
vi.mock('./acoes-paginacao', () => ({
  maisLeadsDaEtapaAction: (...args: unknown[]) => maisLeadsMock(...args),
}))
vi.mock('./acoes', () => ({
  moverEtapaAction: async () => ok(undefined),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

import { Quadro } from './quadro'

const ETAPAS: Etapa[] = [
  { id: 'e1', pipelineId: 'p1', nome: 'Novo lead', ordem: 1, tipo: 'aberta', slaHoras: null },
  { id: 'e2', pipelineId: 'p1', nome: 'Contato feito', ordem: 2, tipo: 'aberta', slaHoras: null },
]

function lead(id: string, stageId: string, valorCents: number | null = null): LeadDoFunil {
  return {
    id,
    nome: `Lead ${id}`,
    stageId,
    responsavelId: null,
    valorCents,
    entrouNaEtapaEm: new Date(Date.now() - 3_600_000),
    telefoneE164: null,
    criadoEm: new Date(),
    etiquetas: [],
  }
}

function montar(colunas: ColunaDoFunil[], queryAtual = '') {
  return render(
    <Quadro
      etapas={ETAPAS}
      colunas={colunas}
      membros={[]}
      motivos={[]}
      etiquetasConhecidas={[]}
      pipelineId="p1"
      filtros={{}}
      queryAtual={queryAtual}
    />,
  )
}

/** O <section> da coluna, achado pelo titulo da etapa. */
function coluna(nome: string): HTMLElement {
  return screen.getByRole('heading', { name: nome }).closest('section') as HTMLElement
}

describe('Quadro — paginacao por coluna', () => {
  it('caso 1 — o cabecalho conta a etapa INTEIRA, nao a pagina carregada', () => {
    montar([
      { etapaId: 'e1', leads: [lead('a', 'e1', 1000), lead('b', 'e1', 2000)], total: 128, somaCents: 500000 },
    ])

    // Dois cartoes na tela, 128 no cabecalho: e' o numero do banco.
    expect(within(coluna('Novo lead')).getByText(/128 leads/)).toBeTruthy()
    expect(within(coluna('Novo lead')).getAllByRole('link')).toHaveLength(2)
  })

  it('o cartao aponta para o drawer (?lead=) preservando os filtros da URL', () => {
    montar(
      [{ etapaId: 'e1', leads: [lead('a', 'e1')], total: 1, somaCents: null }],
      'pipeline=p1&busca=kar',
    )

    // Nao e' mais /leads/<id>: o lead abre como painel do proprio funil, entao
    // o href e a URL de agora mais a chave `lead`.
    const link = within(coluna('Novo lead')).getByRole('link')
    expect(link.getAttribute('href')).toBe('/funil?pipeline=p1&busca=kar&lead=a')
  })

  it('caso 2 — soma omitida quando nenhum lead da etapa tem valor', () => {
    montar([{ etapaId: 'e1', leads: [lead('a', 'e1', null)], total: 1, somaCents: null }])

    const texto = within(coluna('Novo lead')).getByText(/1 lead/).textContent ?? ''
    // Nao e' que valem zero, e' que ninguem preencheu — "R$ 0,00" seria falso.
    expect(texto).not.toMatch(/R\$/)
  })

  it('caso 3 — "carregar mais" so aparece quando o banco diz que sobrou algo', () => {
    const { rerender } = montar([
      { etapaId: 'e1', leads: [lead('a', 'e1')], total: 1, somaCents: null },
    ])
    expect(within(coluna('Novo lead')).queryByRole('button', { name: /carregar mais/i })).toBeNull()

    rerender(
      <Quadro
        etapas={ETAPAS}
        colunas={[{ etapaId: 'e1', leads: [lead('a', 'e1')], total: 4, somaCents: null }]}
        membros={[]}
        motivos={[]}
        etiquetasConhecidas={[]}
        pipelineId="p1"
        filtros={{}}
        queryAtual=""
      />,
    )
    expect(
      within(coluna('Novo lead')).getByRole('button', { name: /carregar mais \(3\)/i }),
    ).toBeTruthy()
  })

  it('caso 4 — "carregar mais" pede a proxima pagina DAQUELA etapa, com o offset certo', async () => {
    maisLeadsMock.mockResolvedValue(ok([lead('c', 'e1'), lead('d', 'e1')]))
    montar([
      { etapaId: 'e1', leads: [lead('a', 'e1'), lead('b', 'e1')], total: 4, somaCents: null },
      { etapaId: 'e2', leads: [lead('z', 'e2')], total: 1, somaCents: null },
    ])

    fireEvent.click(within(coluna('Novo lead')).getByRole('button', { name: /carregar mais/i }))

    // offset = 2 (o que ja veio DESTA coluna), etapa 'e1', e nunca a outra.
    expect(maisLeadsMock).toHaveBeenCalledWith('p1', 'e1', 2, {})
    await waitFor(() =>
      expect(within(coluna('Novo lead')).getAllByRole('link')).toHaveLength(4),
    )
    // A coluna vizinha nao foi tocada.
    expect(within(coluna('Contato feito')).getAllByRole('link')).toHaveLength(1)
    // Nada mais falta: o botao some.
    expect(within(coluna('Novo lead')).queryByRole('button', { name: /carregar mais/i })).toBeNull()
  })

  it('caso 5 — pagina vazia encerra a coluna em vez de reoferecer o botao para sempre', async () => {
    // `total` e a pagina vem de consultas diferentes: entre uma e outra os
    // leads que faltavam podem ter mudado de etapa. Sem esta guarda o botao
    // continuaria dizendo "carregar mais (8)" e nao traria nada, para sempre.
    maisLeadsMock.mockResolvedValue(ok([]))
    montar([{ etapaId: 'e1', leads: [lead('a', 'e1')], total: 9, somaCents: null }])

    fireEvent.click(within(coluna('Novo lead')).getByRole('button', { name: /carregar mais/i }))

    await waitFor(() =>
      expect(
        within(coluna('Novo lead')).queryByRole('button', { name: /carregar mais/i }),
      ).toBeNull(),
    )
  })

  it('caso 6 — falha ao carregar mais vira mensagem, nao pagina quebrada', async () => {
    maisLeadsMock.mockResolvedValue(falha('lead_nao_encontrado'))
    montar([{ etapaId: 'e1', leads: [lead('a', 'e1')], total: 9, somaCents: null }])

    fireEvent.click(within(coluna('Novo lead')).getByRole('button', { name: /carregar mais/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    // O cartao que ja estava continua la.
    expect(within(coluna('Novo lead')).getAllByRole('link')).toHaveLength(1)
  })
})
