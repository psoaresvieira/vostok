import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unidade: AdminStore mockado por vi.mock de '@/lib/data/admin' — mesmo
 * padrao dos demais acoes.test.ts do app.
 */

const adminMock = {
  criarMotivo: vi.fn(),
  alternarMotivo: vi.fn(),
  convidar: vi.fn(),
  revogarConvite: vi.fn(),
}

const criarAdminStoreDoServidorMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/data/admin', () => ({
  criarAdminStoreDoServidor: (...args: unknown[]) => criarAdminStoreDoServidorMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import { criarMotivoAction, alternarMotivoAction, convidarAction, revogarConviteAction } from './acoes'

function contextoFeliz() {
  criarAdminStoreDoServidorMock.mockResolvedValue({ ok: true, valor: { admin: adminMock } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('criarMotivoAction', () => {
  it('nome so de espacos falha com nome_obrigatorio sem tocar o store', async () => {
    contextoFeliz()

    const r = await criarMotivoAction('   ')

    expect(r).toEqual({ ok: false, erro: 'nome_obrigatorio' })
    expect(adminMock.criarMotivo).not.toHaveBeenCalled()
  })

  it('nome e trimado e /config revalidada', async () => {
    contextoFeliz()
    adminMock.criarMotivo.mockResolvedValue({ ok: true, valor: undefined })

    const r = await criarMotivoAction('  Sem orçamento  ')

    expect(adminMock.criarMotivo).toHaveBeenCalledWith('Sem orçamento')
    expect(revalidatePathMock).toHaveBeenCalledWith('/config')
    expect(r.ok).toBe(true)
  })

  it('sem permissao de admin: propaga o erro do contexto', async () => {
    criarAdminStoreDoServidorMock.mockResolvedValue({ ok: false, erro: 'sem_permissao' })

    const r = await criarMotivoAction('Sem orçamento')

    expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(adminMock.criarMotivo).not.toHaveBeenCalled()
  })
})

describe('alternarMotivoAction', () => {
  it('delega id e flag ao store e revalida', async () => {
    contextoFeliz()
    adminMock.alternarMotivo.mockResolvedValue({ ok: true, valor: undefined })

    const r = await alternarMotivoAction('motivo-1', false)

    expect(adminMock.alternarMotivo).toHaveBeenCalledWith('motivo-1', false)
    expect(revalidatePathMock).toHaveBeenCalledWith('/config')
    expect(r.ok).toBe(true)
  })

  it('falha do store propaga e nao revalida', async () => {
    contextoFeliz()
    adminMock.alternarMotivo.mockResolvedValue({ ok: false, erro: 'motivo_nao_encontrado' })

    const r = await alternarMotivoAction('motivo-1', true)

    expect(r).toEqual({ ok: false, erro: 'motivo_nao_encontrado' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('convidarAction', () => {
  it('email invalido falha com email_invalido sem tocar o store', async () => {
    contextoFeliz()

    const r = await convidarAction('nao-e-email', 'vendedor')

    expect(r).toEqual({ ok: false, erro: 'email_invalido' })
    expect(adminMock.convidar).not.toHaveBeenCalled()
  })

  it('email e trimado e minusculado antes da validacao e do store', async () => {
    contextoFeliz()
    adminMock.convidar.mockResolvedValue({ ok: true, valor: 'token-1' })

    const r = await convidarAction('  Maria@Empresa.COM  ', 'gestor')

    expect(adminMock.convidar).toHaveBeenCalledWith('maria@empresa.com', 'gestor')
    expect(revalidatePathMock).toHaveBeenCalledWith('/config')
    expect(r).toEqual({ ok: true, valor: 'token-1' })
  })

  it('convite duplicado: erro do store propaga sem revalidar', async () => {
    contextoFeliz()
    adminMock.convidar.mockResolvedValue({ ok: false, erro: 'convite_duplicado' })

    const r = await convidarAction('maria@empresa.com', 'vendedor')

    expect(r).toEqual({ ok: false, erro: 'convite_duplicado' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('revogarConviteAction', () => {
  it('delega ao store e revalida /config', async () => {
    contextoFeliz()
    adminMock.revogarConvite.mockResolvedValue({ ok: true, valor: undefined })

    const r = await revogarConviteAction('convite-1')

    expect(adminMock.revogarConvite).toHaveBeenCalledWith('convite-1')
    expect(revalidatePathMock).toHaveBeenCalledWith('/config')
    expect(r.ok).toBe(true)
  })
})
