import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unidade, mesmo padrao de funil/acoes.test.ts: store mockado por vi.mock de
 * '@/lib/data/supabase'. filtroDoFunil entra REAL — a traducao de filtros ja
 * tem contrato proprio e o que importa aqui e o que a action passa para ela.
 */

const storeMock = {
  leadsDoFunil: vi.fn(),
}

const criarStoreDoServidorMock = vi.fn()

vi.mock('@/lib/data/supabase', () => ({
  criarStoreDoServidor: (...args: unknown[]) => criarStoreDoServidorMock(...args),
}))

import { maisLeadsDaEtapaAction } from './acoes-paginacao'
import { LIMITE_CARTOES_POR_ETAPA } from './paginacao'

function contextoFeliz() {
  criarStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { store: storeMock, conta: { id: 'conta-1' }, usuarioId: 'user-1', papel: 'admin' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('maisLeadsDaEtapaAction — sanidade da borda', () => {
  it.each([
    ['pipelineId vazio', '', 'etapa-1', 50],
    ['etapaId vazio', 'pipe-1', '', 50],
    ['offset negativo', 'pipe-1', 'etapa-1', -5],
    ['offset fracionario', 'pipe-1', 'etapa-1', 2.5],
    ['offset alem do inteiro seguro', 'pipe-1', 'etapa-1', Number.MAX_SAFE_INTEGER + 1],
  ])('%s falha com etapa_invalida sem abrir contexto', async (_caso, pipelineId, etapaId, offset) => {
    const r = await maisLeadsDaEtapaAction(pipelineId, etapaId, offset, {})

    expect(r).toEqual({ ok: false, erro: 'etapa_invalida' })
    expect(criarStoreDoServidorMock).not.toHaveBeenCalled()
  })
})

describe('maisLeadsDaEtapaAction — consulta', () => {
  it('pede so a coluna da etapa, com offset e limite de uma pagina', async () => {
    contextoFeliz()
    storeMock.leadsDoFunil.mockResolvedValue({ ok: true, valor: [] })

    await maisLeadsDaEtapaAction('pipe-1', 'etapa-1', 100, { origem: 'meta' })

    expect(storeMock.leadsDoFunil).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: 'pipe-1',
        etapaId: 'etapa-1',
        offset: 100,
        limite: LIMITE_CARTOES_POR_ETAPA,
        origem: 'meta',
      }),
    )
  })

  it('devolve os leads da unica coluna que a RPC retorna', async () => {
    contextoFeliz()
    const leads = [{ id: 'lead-1' }, { id: 'lead-2' }]
    storeMock.leadsDoFunil.mockResolvedValue({
      ok: true,
      valor: [{ etapaId: 'etapa-1', leads }],
    })

    const r = await maisLeadsDaEtapaAction('pipe-1', 'etapa-1', 50, {})

    expect(r).toEqual({ ok: true, valor: leads })
  })

  it('zero colunas e lista vazia, nao erro — o botao "carregar mais" so some', async () => {
    contextoFeliz()
    storeMock.leadsDoFunil.mockResolvedValue({ ok: true, valor: [] })

    const r = await maisLeadsDaEtapaAction('pipe-1', 'etapa-1', 50, {})

    expect(r).toEqual({ ok: true, valor: [] })
  })

  it('falha do store propaga o codigo', async () => {
    contextoFeliz()
    storeMock.leadsDoFunil.mockResolvedValue({ ok: false, erro: 'pipeline_nao_encontrada' })

    const r = await maisLeadsDaEtapaAction('pipe-1', 'etapa-1', 50, {})

    expect(r).toEqual({ ok: false, erro: 'pipeline_nao_encontrada' })
  })

  it('sem sessao: propaga o erro do contexto sem consultar', async () => {
    criarStoreDoServidorMock.mockResolvedValue({ ok: false, erro: 'sem_sessao' })

    const r = await maisLeadsDaEtapaAction('pipe-1', 'etapa-1', 0, {})

    expect(r).toEqual({ ok: false, erro: 'sem_sessao' })
    expect(storeMock.leadsDoFunil).not.toHaveBeenCalled()
  })
})
