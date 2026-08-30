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

  const lead = await store.buscarLead(criado.valor)
  if (!lead.ok || !lead.valor) throw new Error('lead recem-criado nao encontrado')

  return { store, leadId: criado.valor, lead: lead.valor }
}

describe('carregarDrawer', () => {
  it('devolve SO o que depende do lead: lead, tarefas e timeline — pipelines, membros, motivos e etiquetas vem da pagina', async () => {
    const { store, leadId, lead } = await comDuasPipelines()

    const r = await carregarDrawer(store, lead)
    if (!r.ok) throw new Error(r.erro)

    expect(r.valor.lead.id).toBe(leadId)
    expect(r.valor.lead.nome).toBe('Carlos')
    expect(r.valor.tarefas).toEqual([])
    expect(r.valor.eventos.length).toBeGreaterThan(0)
    expect(r.valor.temMaisEventos).toBe(false)
    // O que a pagina do funil ja carrega para o quadro NAO e' lido de novo
    // aqui (era o 15+2N do Plano 17): o resultado nem tem essas chaves.
    expect(Object.keys(r.valor).sort()).toEqual(['eventos', 'lead', 'tarefas', 'temMaisEventos'])
  })

  it('temMaisEventos so quando passa do limite, e a lista fica no limite', async () => {
    const { store, leadId, lead } = await comDuasPipelines()

    for (let i = 0; i < LIMITE_EVENTOS + 3; i++) {
      const n = await store.registrarNota(leadId, `nota ${i}`)
      if (!n.ok) throw new Error(n.erro)
    }

    const r = await carregarDrawer(store, lead)
    if (!r.ok) throw new Error(r.erro)

    expect(r.valor.temMaisEventos).toBe(true)
    expect(r.valor.eventos.length).toBe(LIMITE_EVENTOS)
  })
})
