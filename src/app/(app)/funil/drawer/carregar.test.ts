import { describe, it, expect, vi } from 'vitest'
import { InMemoryCrmStore } from '@/lib/data/memory'
import { leadSchema } from '@/lib/domain/lead'
import { ok } from '@/lib/domain/resultado'

// O painel de tarefas do drawer nao e' o que estes casos verificam: o store de
// tarefas fala com Supabase, entao entra aqui como lista vazia.
vi.mock('@/lib/data/tarefas', () => ({
  criarTarefaStoreDoServidor: async () => ok({ doLead: async () => ok([]) }),
}))

import { carregarDrawer, LIMITE_EVENTOS } from './carregar'

function novoLead(nome: string, extras: Record<string, unknown> = {}) {
  return leadSchema.parse({ nome, ...extras })
}

async function comDuasPipelines() {
  const store = new InMemoryCrmStore()
  store.semear('Empresa Exemplo', 'user-1')

  const b2b = await store.criarPipeline('B2B', ['Contato', 'Negociação'])
  if (!b2b.ok) throw new Error(b2b.erro)
  const info = await store.pipelinePorId(b2b.valor)
  if (!info.ok) throw new Error(info.erro)

  const criado = await store.criarLead({
    ...novoLead('Carlos'),
    pipelineId: b2b.valor,
    stageId: info.valor.etapas[0].id,
  })
  if (!criado.ok) throw new Error(criado.erro)

  return { store, pipelineB2B: b2b.valor, leadId: criado.valor }
}

describe('carregarDrawer', () => {
  it('devolve TODAS as pipelines da conta com suas etapas, nao so a do lead', async () => {
    const { store, pipelineB2B, leadId } = await comDuasPipelines()

    const r = await carregarDrawer(store, 'admin', leadId)
    if (!r.ok) throw new Error(r.erro)
    if (!r.valor) throw new Error('esperava dados do lead')

    const nomes = r.valor.pipelines.map((p) => p.pipeline.nome)
    expect(nomes).toEqual(['Funil de vendas', 'B2B'])

    // Cada pipeline vem com as etapas dela — e' o que permite nomear a etapa
    // de ORIGEM de um `pipeline_alterada` na timeline.
    const daB2B = r.valor.pipelines.find((p) => p.pipeline.id === pipelineB2B)
    expect(daB2B?.etapas.map((e) => e.nome)).toEqual([
      'Contato',
      'Negociação',
      'Ganho',
      'Perdido',
    ])
    const daPadrao = r.valor.pipelines.find((p) => p.pipeline.isDefault)
    expect(daPadrao?.etapas.length).toBeGreaterThan(0)
  })

  it('devolve lead, membros, motivos, etiquetas e papel de quem pediu', async () => {
    const { store, leadId } = await comDuasPipelines()

    const r = await carregarDrawer(store, 'vendedor', leadId)
    if (!r.ok) throw new Error(r.erro)
    if (!r.valor) throw new Error('esperava dados do lead')

    expect(r.valor.lead.id).toBe(leadId)
    expect(r.valor.lead.nome).toBe('Carlos')
    expect(r.valor.membros.map((m) => m.nome)).toEqual(['Admin'])
    expect(r.valor.motivos.length).toBeGreaterThan(0)
    expect(r.valor.etiquetasConhecidas).toEqual([])
    expect(r.valor.tarefas).toEqual([])
    expect(r.valor.papel).toBe('vendedor')
  })

  it('lead inexistente (ou escondido pela RLS) e ok(null), nunca falha', async () => {
    const { store } = await comDuasPipelines()

    const r = await carregarDrawer(store, 'admin', '00000000-0000-4000-8000-000000000000')
    expect(r).toEqual(ok(null))
  })

  it('temMaisEventos so quando passa do limite, e a lista fica no limite', async () => {
    const { store, leadId } = await comDuasPipelines()

    for (let i = 0; i < LIMITE_EVENTOS + 3; i++) {
      const n = await store.registrarNota(leadId, `nota ${i}`)
      if (!n.ok) throw new Error(n.erro)
    }

    const r = await carregarDrawer(store, 'admin', leadId)
    if (!r.ok) throw new Error(r.erro)
    if (!r.valor) throw new Error('esperava dados do lead')

    expect(r.valor.temMaisEventos).toBe(true)
    expect(r.valor.eventos.length).toBe(LIMITE_EVENTOS)
  })
})
