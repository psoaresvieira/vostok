import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unidade, mesmo padrao de disparo/acoes.test.ts: store mockado por
 * vi.mock de '@/lib/data/supabase' — sem Supabase de verdade.
 */

const storeMock = {
  pipelinePadrao: vi.fn(),
  pipelinePorId: vi.fn(),
  criarLead: vi.fn(),
}

const criarStoreDoServidorMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/data/supabase', () => ({
  criarStoreDoServidor: (...args: unknown[]) => criarStoreDoServidorMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import { criarLeadAction } from './acoes'

const PIPELINE_PADRAO = {
  pipeline: { id: 'pipe-padrao', nome: 'Funil de vendas', isDefault: true },
  etapas: [
    { id: 'etapa-padrao-1', pipelineId: 'pipe-padrao', nome: 'Novo lead', ordem: 1, tipo: 'aberta', slaHoras: null },
  ],
}

const PIPELINE_B2B = {
  pipeline: { id: 'pipe-b2b', nome: 'B2B', isDefault: false },
  etapas: [
    { id: 'etapa-b2b-1', pipelineId: 'pipe-b2b', nome: 'Contato', ordem: 1, tipo: 'aberta', slaHoras: null },
  ],
}

function contextoFeliz() {
  criarStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { store: storeMock, conta: { id: 'conta-1' }, usuarioId: 'user-1', papel: 'admin' },
  })
}

function formData(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor)
  return fd
}

describe('criarLeadAction — pipelineId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caso 5 — com pipelineId: lead nasce na primeira aberta da pipeline pedida, nao da padrao', async () => {
    contextoFeliz()
    storeMock.pipelinePorId.mockResolvedValue({ ok: true, valor: PIPELINE_B2B })
    storeMock.criarLead.mockResolvedValue({ ok: true, valor: 'lead-novo' })

    const r = await criarLeadAction(formData({ nome: 'Maria', pipelineId: 'pipe-b2b' }))

    expect(storeMock.pipelinePorId).toHaveBeenCalledWith('pipe-b2b')
    expect(storeMock.pipelinePadrao).not.toHaveBeenCalled()
    expect(storeMock.criarLead).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: 'pipe-b2b', stageId: 'etapa-b2b-1' }),
    )
    expect(r).toEqual({ ok: true, valor: 'lead-novo' })
  })

  it('caso 6 — pipeline inexistente: pipeline_nao_encontrado', async () => {
    contextoFeliz()
    storeMock.pipelinePorId.mockResolvedValue({ ok: false, erro: 'pipeline_nao_encontrado' })

    const r = await criarLeadAction(formData({ nome: 'Maria', pipelineId: 'pipe-fantasma' }))

    expect(r).toEqual({ ok: false, erro: 'pipeline_nao_encontrado' })
    expect(storeMock.criarLead).not.toHaveBeenCalled()
  })

  it('caso 7 — sem o campo pipelineId: caminho atual intacto (padrao)', async () => {
    contextoFeliz()
    storeMock.pipelinePadrao.mockResolvedValue({ ok: true, valor: PIPELINE_PADRAO })
    storeMock.criarLead.mockResolvedValue({ ok: true, valor: 'lead-novo' })

    const r = await criarLeadAction(formData({ nome: 'Maria' }))

    expect(storeMock.pipelinePadrao).toHaveBeenCalled()
    expect(storeMock.pipelinePorId).not.toHaveBeenCalled()
    expect(storeMock.criarLead).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: 'pipe-padrao', stageId: 'etapa-padrao-1' }),
    )
    expect(r).toEqual({ ok: true, valor: 'lead-novo' })
  })
})
