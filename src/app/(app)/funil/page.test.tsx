import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryCrmStore } from '@/lib/data/memory'
import { leadSchema } from '@/lib/domain/lead'
import { ok } from '@/lib/domain/resultado'

const criarStoreDoServidorMock = vi.fn()
vi.mock('@/lib/data/supabase', () => ({
  criarStoreDoServidor: (...args: unknown[]) => criarStoreDoServidorMock(...args),
}))
// O resumo das etapas e o store de tarefas falam com Supabase; aqui entram
// como listas vazias — nao sao o que estes casos verificam.
vi.mock('@/lib/data/etapas', () => ({
  criarEtapaStoreDoServidor: async () => ok({ etapas: { resumoEtapas: async () => ok([]) } }),
}))
vi.mock('@/lib/data/tarefas', () => ({
  criarTarefaStoreDoServidor: async () => ok({ doLead: async () => ok([]) }),
}))

// `redirect` do Next LANCA para interromper o render. O mock preserva esse
// contrato e carrega o destino na mensagem.
class Redirecionou extends Error {
  constructor(readonly destino: string) {
    super(`redirect:${destino}`)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionou(destino)
  },
}))

import FunilPage from './page'

function novoLead(nome: string, extras: Record<string, unknown> = {}) {
  return leadSchema.parse({ nome, ...extras })
}

async function cenario() {
  const store = new InMemoryCrmStore()
  store.semear('Empresa Exemplo', 'user-1')
  const padrao = await store.pipelinePadrao()
  if (!padrao.ok) throw new Error(padrao.erro)
  const b2b = await store.criarPipeline('B2B', ['Contato'])
  if (!b2b.ok) throw new Error(b2b.erro)
  const infoB2B = await store.pipelinePorId(b2b.valor)
  if (!infoB2B.ok) throw new Error(infoB2B.erro)

  const naPadrao = await store.criarLead({
    ...novoLead('Carlos'),
    pipelineId: padrao.valor.pipeline.id,
    stageId: padrao.valor.etapas[0].id,
  })
  const naB2B = await store.criarLead({
    ...novoLead('Beatriz'),
    pipelineId: b2b.valor,
    stageId: infoB2B.valor.etapas[0].id,
  })
  if (!naPadrao.ok || !naB2B.ok) throw new Error('falha ao criar leads')

  criarStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { store, conta: { id: 'conta-1' }, usuarioId: 'user-1', papel: 'admin' },
  })
  return { store, pipelineB2B: b2b.valor, leadNaPadrao: naPadrao.valor, leadNaB2B: naB2B.valor }
}

/** Renderiza a pagina; devolve o destino se ela redirecionar, null se nao. */
async function destinoDe(params: Record<string, string | undefined>): Promise<string | null> {
  try {
    await FunilPage({ searchParams: Promise.resolve(params) })
  } catch (e) {
    if (e instanceof Redirecionou) return e.destino
    throw e
  }
  return null
}

beforeEach(() => {
  criarStoreDoServidorMock.mockReset()
})

describe('/funil?lead= — a pipeline do lead', () => {
  it('sem ?pipeline=, lead de OUTRA pipeline: redireciona para a pipeline dele, preservando os filtros', async () => {
    const { pipelineB2B, leadNaB2B } = await cenario()

    expect(await destinoDe({ busca: 'bea', lead: leadNaB2B })).toBe(
      `/funil?busca=bea&lead=${leadNaB2B}&pipeline=${pipelineB2B}`,
    )
  })

  it('sem ?pipeline=, lead da pipeline PADRAO: nao redireciona', async () => {
    const { leadNaPadrao } = await cenario()

    expect(await destinoDe({ lead: leadNaPadrao })).toBeNull()
  })

  it('COM ?pipeline= explicito a URL manda, mesmo que o lead esteja em outra', async () => {
    const { pipelineB2B, leadNaPadrao } = await cenario()

    expect(await destinoDe({ pipeline: pipelineB2B, lead: leadNaPadrao })).toBeNull()
  })

  it('?pipeline= INVALIDO (cai na padrao) + lead em outra pipeline: sem redirect — a URL manda, e nunca ha loop', async () => {
    const { leadNaB2B } = await cenario()

    expect(await destinoDe({ pipeline: 'pipeline-que-nao-existe', lead: leadNaB2B })).toBeNull()
  })

  it('o redirect e decidido ANTES de carregar o quadro: leadsDoFunil nao e chamado', async () => {
    const { store, leadNaB2B } = await cenario()
    const leadsDoFunil = vi.spyOn(store, 'leadsDoFunil')

    expect(await destinoDe({ lead: leadNaB2B })).toMatch(/pipeline=/)
    expect(leadsDoFunil).not.toHaveBeenCalled()
  })

  it('?lead= inexistente: nada de redirect, a pagina mostra o aviso', async () => {
    await cenario()

    expect(await destinoDe({ lead: '00000000-0000-4000-8000-000000000000' })).toBeNull()
  })
})
