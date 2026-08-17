// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { InMemoryCrmStore } from '@/lib/data/memory'
import { leadSchema } from '@/lib/domain/lead'
import { ok, falha } from '@/lib/domain/resultado'

// Mesmo motivo de disparar.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

const criarStoreDoServidorMock = vi.fn()
vi.mock('@/lib/data/supabase', () => ({
  criarStoreDoServidor: (...args: unknown[]) => criarStoreDoServidorMock(...args),
}))

// A ficha so precisa que o painel de tarefas resolva — o conteudo dele nao e'
// o que estes casos verificam.
vi.mock('@/lib/data/tarefas', () => ({
  criarTarefaStoreDoServidor: async () => ok({ doLead: async () => ok([]) }),
}))

// Falha proposital: com scripts.length === 0 (nenhum script chega da etapa),
// templatesDoPainel devolve [] sem tocar em '@/lib/data/templates' — o painel
// de scripts degrada para aviso, exatamente como page.tsx ja prevê para
// biblioteca fora do ar. Evita ter que simular Supabase real de templates.
vi.mock('@/lib/data/scripts', () => ({
  criarScriptStoreDoServidor: async () => falha('sem_conta'),
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound chamado inesperadamente')
  },
  redirect: () => {
    throw new Error('redirect chamado inesperadamente')
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))

import LeadPage from './page'

function novoLead(nome: string, extras: Record<string, unknown> = {}) {
  return leadSchema.parse({ nome, ...extras })
}

async function montarFicha(store: InMemoryCrmStore, leadId: string) {
  criarStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { store, conta: { id: 'conta-1' }, usuarioId: 'user-1', papel: 'admin' },
  })
  const jsx = await LeadPage({ params: Promise.resolve({ id: leadId }) })
  return render(jsx)
}

describe('LeadPage (ficha) — pipeline do lead', () => {
  it('caso 2 — seletor de etapas mostra as etapas da pipeline do lead, nao as da padrao', async () => {
    const store = new InMemoryCrmStore()
    store.semear('Empresa Exemplo', 'user-1')

    const pipelineB2B = await store.criarPipeline('B2B', ['Contato', 'Negociação'])
    if (!pipelineB2B.ok) throw new Error(pipelineB2B.erro)
    const infoB2B = await store.pipelinePorId(pipelineB2B.valor)
    if (!infoB2B.ok) throw new Error(infoB2B.erro)

    const criado = await store.criarLead({
      ...novoLead('Carlos'),
      pipelineId: pipelineB2B.valor,
      stageId: infoB2B.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    await montarFicha(store, criado.valor)

    const seletor = screen.getByLabelText('Mover para') as HTMLSelectElement
    const opcoes = within(seletor)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(opcoes).toEqual(['Contato', 'Negociação', 'Ganho', 'Perdido'])
  })

  it('caso 3 — link de voltar carrega a pipeline quando o lead nao esta na padrao', async () => {
    const store = new InMemoryCrmStore()
    store.semear('Empresa Exemplo', 'user-1')

    const pipelineB2B = await store.criarPipeline('B2B', ['Contato'])
    if (!pipelineB2B.ok) throw new Error(pipelineB2B.erro)
    const infoB2B = await store.pipelinePorId(pipelineB2B.valor)
    if (!infoB2B.ok) throw new Error(infoB2B.erro)

    const criado = await store.criarLead({
      ...novoLead('Carlos'),
      pipelineId: pipelineB2B.valor,
      stageId: infoB2B.valor.etapas[0].id,
    })
    if (!criado.ok) throw new Error(criado.erro)

    await montarFicha(store, criado.valor)

    const link = screen.getByRole('link', { name: /voltar ao funil/i })
    expect(link.getAttribute('href')).toBe(`/funil?pipeline=${pipelineB2B.valor}`)
  })
})
