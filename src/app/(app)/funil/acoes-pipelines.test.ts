import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unidade, mesmo padrao de disparo/acoes.test.ts: store mockado por
 * vi.mock de '@/lib/data/supabase' — sem Supabase de verdade.
 */

const storeMock = {
  criarPipeline: vi.fn(),
  renomearPipeline: vi.fn(),
  excluirPipeline: vi.fn(),
}

const criarStoreDoServidorMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/data/supabase', () => ({
  criarStoreDoServidor: (...args: unknown[]) => criarStoreDoServidorMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import { criarPipelineAction, renomearPipelineAction, excluirPipelineAction } from './acoes-pipelines'

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

describe('criarPipelineAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caso 1 — criacao feliz: nome + 3 etapas chegam ao store na ordem digitada; devolve o id', async () => {
    contextoFeliz()
    storeMock.criarPipeline.mockResolvedValue({ ok: true, valor: 'pipeline-novo' })

    const r = await criarPipelineAction(
      formData({ nome: 'Pipeline B2B', etapas: JSON.stringify(['Contato', 'Qualificação', 'Proposta']) }),
    )

    expect(storeMock.criarPipeline).toHaveBeenCalledWith('Pipeline B2B', [
      'Contato',
      'Qualificação',
      'Proposta',
    ])
    expect(r).toEqual({ ok: true, valor: 'pipeline-novo' })
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
  })

  it('caso 2 — etapas em branco somem antes do store', async () => {
    contextoFeliz()
    storeMock.criarPipeline.mockResolvedValue({ ok: true, valor: 'pipeline-novo' })

    await criarPipelineAction(
      formData({ nome: 'Pipeline B2B', etapas: JSON.stringify(['', '  ', 'Contato']) }),
    )

    expect(storeMock.criarPipeline).toHaveBeenCalledWith('Pipeline B2B', ['Contato'])
  })

  it('caso 3 — zero etapas uteis: etapas_minimo_uma e o store NAO e chamado', async () => {
    contextoFeliz()

    const r = await criarPipelineAction(formData({ nome: 'Pipeline B2B', etapas: JSON.stringify(['', '  ']) }))

    expect(r).toEqual({ ok: false, erro: 'etapas_minimo_uma' })
    expect(storeMock.criarPipeline).not.toHaveBeenCalled()
  })

  it('caso 4 — nome vazio: nome_obrigatorio, store nao chamado', async () => {
    contextoFeliz()

    const r = await criarPipelineAction(formData({ nome: '   ', etapas: JSON.stringify(['Contato']) }))

    expect(r).toEqual({ ok: false, erro: 'nome_obrigatorio' })
    expect(storeMock.criarPipeline).not.toHaveBeenCalled()
  })

  it('propaga o codigo de erro do store sem alteracao', async () => {
    contextoFeliz()
    storeMock.criarPipeline.mockResolvedValue({ ok: false, erro: 'algo_deu_errado' })

    const r = await criarPipelineAction(formData({ nome: 'Pipeline B2B', etapas: JSON.stringify(['Contato']) }))

    expect(r).toEqual({ ok: false, erro: 'algo_deu_errado' })
  })
})

describe('renomearPipelineAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('nome vazio: nome_obrigatorio, store nao chamado', async () => {
    contextoFeliz()

    const r = await renomearPipelineAction('pipeline-1', '   ')

    expect(r).toEqual({ ok: false, erro: 'nome_obrigatorio' })
    expect(storeMock.renomearPipeline).not.toHaveBeenCalled()
  })

  it('sucesso: revalida /funil e devolve ok', async () => {
    contextoFeliz()
    storeMock.renomearPipeline.mockResolvedValue({ ok: true, valor: undefined })

    const r = await renomearPipelineAction('pipeline-1', 'Novo nome')

    expect(storeMock.renomearPipeline).toHaveBeenCalledWith('pipeline-1', 'Novo nome')
    expect(r).toEqual({ ok: true, valor: undefined })
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
  })
})

describe('excluirPipelineAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('repassa o codigo do store sem alteracao', async () => {
    contextoFeliz()
    storeMock.excluirPipeline.mockResolvedValue({ ok: false, erro: 'pipeline_com_leads' })

    const r = await excluirPipelineAction('pipeline-1')

    expect(r).toEqual({ ok: false, erro: 'pipeline_com_leads' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('sucesso: revalida /funil e devolve ok', async () => {
    contextoFeliz()
    storeMock.excluirPipeline.mockResolvedValue({ ok: true, valor: undefined })

    const r = await excluirPipelineAction('pipeline-1')

    expect(r).toEqual({ ok: true, valor: undefined })
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
  })
})
