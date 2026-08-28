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

import { criarLeadAction, moverParaPipelineAction } from './acoes'
import { InMemoryCrmStore } from '@/lib/data/memory'
import { codigoEtiquetasSalvas } from './erros'
import { leadSchema } from '@/lib/domain/lead'

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

/**
 * moverParaPipelineAction contra o InMemoryCrmStore de verdade — nao um
 * `vi.fn()`. O que este bloco precisa provar e' ESTADO (o snapshot da etiqueta
 * ficou na etapa de ORIGEM, o lead terminou na pipeline nova), e um mock so'
 * provaria que a action chamou dois metodos na ordem em que ela mesma os
 * chama.
 */
describe('moverParaPipelineAction', () => {
  let store: InMemoryCrmStore

  async function cenario() {
    store = new InMemoryCrmStore()
    store.semear('Empresa Exemplo', 'user-1')
    criarStoreDoServidorMock.mockResolvedValue({
      ok: true,
      valor: { store, conta: { id: 'conta-1' }, usuarioId: 'user-1', papel: 'admin' },
    })

    const padrao = await store.pipelinePadrao()
    if (!padrao.ok) throw new Error(padrao.erro)
    const origem = padrao.valor.etapas[2]
    const lead = await store.criarLead({
      ...leadSchema.parse({ nome: 'Ana' }),
      pipelineId: padrao.valor.pipeline.id,
      stageId: origem.id,
    })
    if (!lead.ok) throw new Error(lead.erro)

    const nova = await store.criarPipeline('Pós-venda', ['Onboarding', 'Ativo'])
    if (!nova.ok) throw new Error(nova.erro)
    const destino = await store.pipelinePorId(nova.valor)
    if (!destino.ok) throw new Error(destino.erro)

    return { leadId: lead.valor, origem, novaPipelineId: nova.valor, destino: destino.valor.etapas }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aplica as etiquetas com o snapshot da etapa de ORIGEM e leva o lead para a pipeline nova', async () => {
    const { leadId, origem, novaPipelineId, destino } = await cenario()

    const r = await moverParaPipelineAction(leadId, destino[0].id, null, ['Cliente novo'])

    expect(r).toEqual({ ok: true, valor: undefined })
    // O snapshot e' o da etapa onde a qualificacao aconteceu, nao o do destino:
    // por isso a action aplica as etiquetas ANTES de mover.
    expect(store.etapaDaEtiqueta(leadId, 'Cliente novo')).toBe(origem.id)

    const lead = await store.buscarLead(leadId)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.pipelineId).toBe(novaPipelineId)
    expect(lead.valor.stageId).toBe(destino[0].id)
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
  })

  it('etapa da mesma pipeline: devolve mesma_pipeline sem tocar no lead', async () => {
    const { leadId, origem } = await cenario()
    const padrao = await store.pipelinePadrao()
    if (!padrao.ok) throw new Error(padrao.erro)

    const r = await moverParaPipelineAction(leadId, padrao.valor.etapas[3].id, null, [])

    expect(r).toEqual({ ok: false, erro: 'mesma_pipeline' })
    const lead = await store.buscarLead(leadId)
    if (!lead.ok || !lead.valor) throw new Error('lead sumiu')
    expect(lead.valor.stageId).toBe(origem.id)
  })

  it('movimento falho com etiquetas ja gravadas carrega a causa no codigo', async () => {
    // Mesma rede de seguranca de moverEtapaAction: sem transacao cobrindo as
    // duas chamadas, as etiquetas ficam no banco quando o movimento recusa.
    const { leadId, destino } = await cenario()
    const perdido = destino.find((e) => e.tipo === 'perdido')!

    const r = await moverParaPipelineAction(leadId, perdido.id, null, ['Sem verba'])

    expect(r).toEqual({ ok: false, erro: codigoEtiquetasSalvas('motivo_perda_obrigatorio') })
    expect(store.etapaDaEtiqueta(leadId, 'Sem verba')).not.toBeNull()
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
  })
})
