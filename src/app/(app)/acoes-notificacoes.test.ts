import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unidade: NotificacaoStore mockado. O contrato importante aqui e o que a
 * acao NAO faz — nenhum revalidatePath (o sino chama router.refresh() por
 * conta propria; ver comentario no modulo).
 */

const notificacaoStoreMock = {
  marcarLida: vi.fn(),
  marcarTodasLidas: vi.fn(),
}

const criarNotificacaoStoreDoServidorMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/data/notificacoes', () => ({
  criarNotificacaoStoreDoServidor: (...args: unknown[]) =>
    criarNotificacaoStoreDoServidorMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import { marcarNotificacaoLidaAction, marcarTodasNotificacoesLidasAction } from './acoes-notificacoes'

function contextoFeliz() {
  criarNotificacaoStoreDoServidorMock.mockResolvedValue({ ok: true, valor: notificacaoStoreMock })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('marcarNotificacaoLidaAction', () => {
  it('sem sessao: propaga o erro do contexto sem tocar o store', async () => {
    criarNotificacaoStoreDoServidorMock.mockResolvedValue({ ok: false, erro: 'sem_sessao' })

    const r = await marcarNotificacaoLidaAction('notif-1')

    expect(r).toEqual({ ok: false, erro: 'sem_sessao' })
    expect(notificacaoStoreMock.marcarLida).not.toHaveBeenCalled()
  })

  it('delega ao store e devolve o Resultado dele como veio', async () => {
    contextoFeliz()
    notificacaoStoreMock.marcarLida.mockResolvedValue({ ok: true, valor: undefined })

    const r = await marcarNotificacaoLidaAction('notif-1')

    expect(notificacaoStoreMock.marcarLida).toHaveBeenCalledWith('notif-1')
    expect(r).toEqual({ ok: true, valor: undefined })
  })

  it('nunca chama revalidatePath — o sino refaz o layout via router.refresh()', async () => {
    contextoFeliz()
    notificacaoStoreMock.marcarLida.mockResolvedValue({ ok: true, valor: undefined })

    await marcarNotificacaoLidaAction('notif-1')

    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('marcarTodasNotificacoesLidasAction', () => {
  it('delega ao store sem revalidatePath', async () => {
    contextoFeliz()
    notificacaoStoreMock.marcarTodasLidas.mockResolvedValue({ ok: true, valor: undefined })

    const r = await marcarTodasNotificacoesLidasAction()

    expect(notificacaoStoreMock.marcarTodasLidas).toHaveBeenCalledWith()
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })
})
