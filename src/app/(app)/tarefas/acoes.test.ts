import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unidade: TarefaStore mockado por vi.mock de '@/lib/data/tarefas'. A
 * constante TAREFA_CONCLUIDA_SEM_EVENTO vem do modulo real (importActual)
 * para o teste nao inventar uma copia que possa divergir.
 */

const tarefaStoreMock = {
  criar: vi.fn(),
  concluir: vi.fn(),
  reabrir: vi.fn(),
  excluir: vi.fn(),
}

const criarTarefaStoreDoServidorMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/data/tarefas', async (importActual) => {
  const real = await importActual<typeof import('@/lib/data/tarefas')>()
  return {
    ...real,
    criarTarefaStoreDoServidor: (...args: unknown[]) => criarTarefaStoreDoServidorMock(...args),
  }
})

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import { TAREFA_CONCLUIDA_SEM_EVENTO } from '@/lib/data/tarefas'
import { criarTarefa, concluirTarefa, reabrirTarefa, excluirTarefa } from './acoes'

function contextoFeliz() {
  criarTarefaStoreDoServidorMock.mockResolvedValue({ ok: true, valor: tarefaStoreMock })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('criarTarefa', () => {
  it('titulo so de espacos falha com titulo_vazio antes de abrir contexto', async () => {
    const r = await criarTarefa({ leadId: 'lead-1', titulo: '  ', tipo: 'ligacao', venceEmISO: '2026-08-30T12:00:00Z' })

    expect(r).toEqual({ ok: false, erro: 'titulo_vazio' })
    expect(criarTarefaStoreDoServidorMock).not.toHaveBeenCalled()
  })

  it('venceEmISO que nao parseia falha com prazo_invalido na borda, nunca no port', async () => {
    const r = await criarTarefa({ leadId: 'lead-1', titulo: 'Ligar', tipo: 'ligacao', venceEmISO: 'nunca' })

    expect(r).toEqual({ ok: false, erro: 'prazo_invalido' })
    expect(criarTarefaStoreDoServidorMock).not.toHaveBeenCalled()
  })

  it('caminho feliz: titulo trimado, Date construido, e as duas telas revalidadas', async () => {
    contextoFeliz()
    tarefaStoreMock.criar.mockResolvedValue({ ok: true, valor: undefined })

    const r = await criarTarefa({ leadId: 'lead-1', titulo: '  Ligar  ', tipo: 'ligacao', venceEmISO: '2026-08-30T12:00:00Z' })

    expect(tarefaStoreMock.criar).toHaveBeenCalledWith({
      leadId: 'lead-1',
      titulo: 'Ligar',
      tipo: 'ligacao',
      venceEm: new Date('2026-08-30T12:00:00Z'),
    })
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
    expect(revalidatePathMock).toHaveBeenCalledWith('/tarefas')
    expect(r.ok).toBe(true)
  })
})

describe('concluirTarefa', () => {
  it('falha comum do store: propaga sem revalidar (nada mudou no banco)', async () => {
    contextoFeliz()
    tarefaStoreMock.concluir.mockResolvedValue({ ok: false, erro: 'tarefa_nao_encontrada' })

    const r = await concluirTarefa('tarefa-1', 'lead-1')

    expect(r).toEqual({ ok: false, erro: 'tarefa_nao_encontrada' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('excecao unica: concluiu no banco mas o evento falhou — revalida MESMO devolvendo falha', async () => {
    contextoFeliz()
    tarefaStoreMock.concluir.mockResolvedValue({ ok: false, erro: TAREFA_CONCLUIDA_SEM_EVENTO })

    const r = await concluirTarefa('tarefa-1', 'lead-1')

    expect(r).toEqual({ ok: false, erro: TAREFA_CONCLUIDA_SEM_EVENTO })
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
    expect(revalidatePathMock).toHaveBeenCalledWith('/tarefas')
  })

  it('caminho feliz revalida as duas telas', async () => {
    contextoFeliz()
    tarefaStoreMock.concluir.mockResolvedValue({ ok: true, valor: undefined })

    const r = await concluirTarefa('tarefa-1', 'lead-1')

    expect(tarefaStoreMock.concluir).toHaveBeenCalledWith('tarefa-1')
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
    expect(revalidatePathMock).toHaveBeenCalledWith('/tarefas')
    expect(r.ok).toBe(true)
  })
})

describe('reabrirTarefa / excluirTarefa', () => {
  it('reabrir delega ao store e revalida', async () => {
    contextoFeliz()
    tarefaStoreMock.reabrir.mockResolvedValue({ ok: true, valor: undefined })

    const r = await reabrirTarefa('tarefa-1', 'lead-1')

    expect(tarefaStoreMock.reabrir).toHaveBeenCalledWith('tarefa-1')
    expect(revalidatePathMock).toHaveBeenCalledWith('/tarefas')
    expect(r.ok).toBe(true)
  })

  it('excluir com falha propaga e nao revalida', async () => {
    contextoFeliz()
    tarefaStoreMock.excluir.mockResolvedValue({ ok: false, erro: 'tarefa_nao_encontrada' })

    const r = await excluirTarefa('tarefa-1', 'lead-1')

    expect(r).toEqual({ ok: false, erro: 'tarefa_nao_encontrada' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('sem contexto (sessao expirada) nenhuma acao toca o store', async () => {
    criarTarefaStoreDoServidorMock.mockResolvedValue({ ok: false, erro: 'sem_sessao' })

    const r = await excluirTarefa('tarefa-1', 'lead-1')

    expect(r).toEqual({ ok: false, erro: 'sem_sessao' })
    expect(tarefaStoreMock.excluir).not.toHaveBeenCalled()
  })
})
