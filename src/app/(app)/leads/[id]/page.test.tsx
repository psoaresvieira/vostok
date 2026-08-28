import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryCrmStore } from '@/lib/data/memory'
import { leadSchema } from '@/lib/domain/lead'

const criarStoreDoServidorMock = vi.fn()
vi.mock('@/lib/data/supabase', () => ({
  criarStoreDoServidor: (...args: unknown[]) => criarStoreDoServidorMock(...args),
}))

// `redirect` do Next LANCA para interromper o render — quem chama nunca ve o
// retorno. O mock preserva esse contrato (uma funcao que so' registrasse o
// destino deixaria a pagina seguir executando linhas que o produto nunca roda)
// e carrega o destino na mensagem.
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

import LeadPage from './page'

function novoLead(nome: string, extras: Record<string, unknown> = {}) {
  return leadSchema.parse({ nome, ...extras })
}

/** Para onde a rota manda o navegador. Falha se ela NAO redirecionar. */
async function destinoDe(store: InMemoryCrmStore, leadId: string): Promise<string> {
  criarStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { store, conta: { id: 'conta-1' }, usuarioId: 'user-1', papel: 'admin' },
  })
  try {
    await LeadPage({ params: Promise.resolve({ id: leadId }) })
  } catch (e) {
    if (e instanceof Redirecionou) return e.destino
    throw e
  }
  throw new Error('a rota nao redirecionou')
}

beforeEach(() => {
  criarStoreDoServidorMock.mockReset()
})

describe('/leads/[id] — a ficha virou o drawer do funil', () => {
  it('lead da pipeline PADRAO: abre o drawer no funil padrao, sem ?pipeline=', async () => {
    const store = new InMemoryCrmStore()
    store.semear('Empresa Exemplo', 'user-1')
    const padrao = await store.pipelinePadrao()
    if (!padrao.ok) throw new Error(padrao.erro)

    const criado = await store.criarLead({
      ...novoLead('Carlos'),
      pipelineId: padrao.valor.pipeline.id,
      stageId: padrao.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    expect(await destinoDe(store, criado.valor)).toBe(`/funil?lead=${criado.valor}`)
  })

  it('lead de OUTRA pipeline: carrega a pipeline junto, senao o funil abriria a padrao', async () => {
    const store = new InMemoryCrmStore()
    store.semear('Empresa Exemplo', 'user-1')

    const b2b = await store.criarPipeline('B2B', ['Contato'])
    if (!b2b.ok) throw new Error(b2b.erro)
    const info = await store.pipelinePorId(b2b.valor)
    if (!info.ok) throw new Error(info.erro)

    const criado = await store.criarLead({
      ...novoLead('Carlos'),
      pipelineId: b2b.valor,
      stageId: info.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    expect(await destinoDe(store, criado.valor)).toBe(
      `/funil?pipeline=${b2b.valor}&lead=${criado.valor}`,
    )
  })

  it('lead inexistente (ou escondido pela RLS): funil sem painel, nunca 404', async () => {
    const store = new InMemoryCrmStore()
    store.semear('Empresa Exemplo', 'user-1')

    expect(await destinoDe(store, '00000000-0000-4000-8000-000000000000')).toBe('/funil')
  })

  it('sem sessao: vai para o login antes de tocar no store', async () => {
    criarStoreDoServidorMock.mockResolvedValue({ ok: false, erro: 'sem_sessao' })
    await expect(LeadPage({ params: Promise.resolve({ id: 'lead-1' }) })).rejects.toThrow(
      'redirect:/login',
    )
  })
})
