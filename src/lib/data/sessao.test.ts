import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUserMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/lib/supabase/servidor', () => ({
  criarClienteServidor: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  }),
}))

import { sessaoDoServidor, contextoDaConta } from './sessao'

/** Encadeamento minimo de `from('memberships').select().eq().order().limit().maybeSingle()`. */
function memberships(resposta: { data: unknown; error: unknown }) {
  const cadeia = {
    select: () => cadeia,
    eq: () => cadeia,
    order: () => cadeia,
    limit: () => cadeia,
    maybeSingle: async () => resposta,
  }
  return cadeia
}

describe('sessaoDoServidor / contextoDaConta', () => {
  beforeEach(() => {
    getUserMock.mockReset()
    fromMock.mockReset()
  })

  it('caso 1 — sem usuario vira sem_sessao, e nao uma excecao', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })

    expect(await sessaoDoServidor()).toEqual({ ok: false, erro: 'sem_sessao' })
  })

  it('caso 2 — com usuario devolve cliente e id', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    const r = await sessaoDoServidor()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.usuarioId).toBe('user-1')
  })

  it('caso 3 — contextoDaConta encaminha o codigo de sem_conta sem traduzir', async () => {
    // Codigo do resolvedor, e nao mensagem de tela: quem chama e' que decide
    // como contar isso ao usuario (o layout redireciona para /signup).
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    fromMock.mockReturnValue(memberships({ data: null, error: null }))

    expect(await contextoDaConta()).toEqual({ ok: false, erro: 'sem_conta' })
  })

  it('caso 4 — contextoDaConta devolve conta, papel e usuario juntos', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    fromMock.mockReturnValue(
      memberships({
        data: { papel: 'gestor', criado_em: '2026-01-01', accounts: { id: 'acc-1', nome: 'Acme' } },
        error: null,
      }),
    )

    const r = await contextoDaConta()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor).toMatchObject({
      usuarioId: 'user-1',
      papel: 'gestor',
      conta: { id: 'acc-1', nome: 'Acme' },
    })
  })

  it('caso 5 — sem sessao, contextoDaConta nem consulta memberships', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })

    expect(await contextoDaConta()).toEqual({ ok: false, erro: 'sem_sessao' })
    expect(fromMock).not.toHaveBeenCalled()
  })
})
