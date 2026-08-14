import { describe, it, expect, vi, beforeEach } from 'vitest'
import { contextoDoLead } from '@/lib/domain/script'
import type { Lead } from '@/lib/domain/tipos'

/**
 * Unidade, na forma de scripts/acoes.test.ts e leads/[id]/acoes-whatsapp.test.ts:
 * store mockado por vi.mock de '@/lib/data/supabase' — sem Supabase de verdade.
 */

const storeMock = {
  listarLeads: vi.fn(),
  pipelinePadrao: vi.fn(),
  membros: vi.fn(),
}

const criarStoreDoServidorMock = vi.fn()

vi.mock('@/lib/data/supabase', () => ({
  criarStoreDoServidor: (...args: unknown[]) => criarStoreDoServidorMock(...args),
}))

import { buscarLeadsParaDisparo } from './acoes'

const CONTA_ID = 'conta-1'
const ETAPAS = [{ id: 'etapa-1', nome: 'Novo lead' }]
const MEMBROS = [{ id: 'user-1', nome: 'Pedro' }]

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    accountId: CONTA_ID,
    nome: 'Maria da Silva',
    telefone: '(11) 91234-5678',
    telefoneE164: '+5511912345678',
    email: 'maria@exemplo.com.br',
    emailNorm: 'maria@exemplo.com.br',
    empresa: 'Loja da Maria',
    origem: 'manual',
    pipelineId: 'pipe-1',
    stageId: 'etapa-1',
    responsavelId: 'user-1',
    status: 'aberto',
    valorCents: 150000,
    lossReasonId: null,
    entrouNaEtapaEm: new Date('2026-08-01T00:00:00Z'),
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    atualizadoEm: new Date('2026-08-01T00:00:00Z'),
    etiquetas: [],
    ...overrides,
  }
}

function cenarioFeliz(leads: Lead[] = [lead()]) {
  criarStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { store: storeMock, conta: { id: CONTA_ID }, usuarioId: 'user-1', papel: 'admin' },
  })
  storeMock.listarLeads.mockResolvedValue({ ok: true, valor: leads })
  storeMock.pipelinePadrao.mockResolvedValue({
    ok: true,
    valor: { pipeline: { id: 'pipe-1', nome: 'Padrão' }, etapas: ETAPAS },
  })
  storeMock.membros.mockResolvedValue({ ok: true, valor: MEMBROS })
}

describe('buscarLeadsParaDisparo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caso 1 — termo em branco: ok([]) sem consulta nenhuma', async () => {
    const r = await buscarLeadsParaDisparo('   ')

    expect(r).toEqual({ ok: true, valor: [] })
    expect(criarStoreDoServidorMock).not.toHaveBeenCalled()
    expect(storeMock.listarLeads).not.toHaveBeenCalled()
  })

  it('caso 1b — termo vazio (string vazia): mesmo resultado', async () => {
    const r = await buscarLeadsParaDisparo('')

    expect(r).toEqual({ ok: true, valor: [] })
    expect(storeMock.listarLeads).not.toHaveBeenCalled()
  })

  it('caso 2 — caminho feliz: campos e contexto montado com os mapas de etapa/pessoa', async () => {
    cenarioFeliz()

    const r = await buscarLeadsParaDisparo('maria')

    expect(storeMock.listarLeads).toHaveBeenCalledWith({ busca: 'maria' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor).toHaveLength(1)
    const esperado = contextoDoLead(
      lead(),
      new Map(ETAPAS.map((e) => [e.id, e.nome])),
      new Map(MEMBROS.map((m) => [m.id, m.nome])),
    )
    expect(r.valor[0]).toEqual({
      id: 'lead-1',
      nome: 'Maria da Silva',
      telefoneE164: '+5511912345678',
      etapa: 'Novo lead',
      contexto: esperado,
    })
  })

  it('caso 3 — falha do store propaga', async () => {
    cenarioFeliz()
    storeMock.listarLeads.mockResolvedValue({ ok: false, erro: 'erro_ao_carregar_leads' })

    const r = await buscarLeadsParaDisparo('maria')

    expect(r).toEqual({ ok: false, erro: 'erro_ao_carregar_leads' })
  })

  it('caso 3b — falha na construcao do store propaga', async () => {
    criarStoreDoServidorMock.mockResolvedValue({ ok: false, erro: 'sem_sessao' })

    const r = await buscarLeadsParaDisparo('maria')

    expect(r).toEqual({ ok: false, erro: 'sem_sessao' })
  })

  it('caso 4 — corte em 10: 12 leads devolvidos, so os 10 primeiros voltam', async () => {
    const leads = Array.from({ length: 12 }, (_, i) =>
      lead({ id: `lead-${i}`, nome: `Lead ${i}` }),
    )
    cenarioFeliz(leads)

    const r = await buscarLeadsParaDisparo('lead')

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor).toHaveLength(10)
    expect(r.valor.map((l) => l.id)).toEqual(leads.slice(0, 10).map((l) => l.id))
  })
})
