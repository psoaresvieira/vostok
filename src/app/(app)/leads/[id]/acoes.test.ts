import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unidade, mesmo padrao de funil/acoes.test.ts: store mockado por vi.mock de
 * '@/lib/data/supabase' — sem Supabase de verdade.
 */

const storeMock = {
  registrarNota: vi.fn(),
  aplicarEtiquetas: vi.fn(),
  atribuirResponsavel: vi.fn(),
}

const criarStoreDoServidorMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/data/supabase', () => ({
  criarStoreDoServidor: (...args: unknown[]) => criarStoreDoServidorMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import { adicionarNota, adicionarEtiquetas, trocarResponsavel } from './acoes'

function contextoFeliz(papel: 'admin' | 'gestor' | 'vendedor' = 'admin') {
  criarStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { store: storeMock, conta: { id: 'conta-1' }, usuarioId: 'user-1', papel },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('adicionarNota', () => {
  it('nota vazia (so espacos) falha com nota_vazia antes de abrir contexto', async () => {
    const r = await adicionarNota('lead-1', '   ')

    expect(r).toEqual({ ok: false, erro: 'nota_vazia' })
    expect(criarStoreDoServidorMock).not.toHaveBeenCalled()
  })

  it('texto e trimado antes de ir ao store e a ficha e revalidada', async () => {
    contextoFeliz()
    storeMock.registrarNota.mockResolvedValue({ ok: true, valor: undefined })

    const r = await adicionarNota('lead-1', '  ligou de volta  ')

    expect(storeMock.registrarNota).toHaveBeenCalledWith('lead-1', 'ligou de volta')
    expect(revalidatePathMock).toHaveBeenCalledWith('/leads/lead-1')
    expect(r.ok).toBe(true)
  })

  it('falha do store propaga o codigo e nao revalida', async () => {
    contextoFeliz()
    storeMock.registrarNota.mockResolvedValue({ ok: false, erro: 'lead_nao_encontrado' })

    const r = await adicionarNota('lead-1', 'oi')

    expect(r).toEqual({ ok: false, erro: 'lead_nao_encontrado' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('adicionarEtiquetas', () => {
  it('sem sessao: propaga o erro do contexto sem tocar o store', async () => {
    criarStoreDoServidorMock.mockResolvedValue({ ok: false, erro: 'sem_sessao' })

    const r = await adicionarEtiquetas('lead-1', ['quente'])

    expect(r).toEqual({ ok: false, erro: 'sem_sessao' })
    expect(storeMock.aplicarEtiquetas).not.toHaveBeenCalled()
  })

  it('caminho feliz: repassa nomes ao store e revalida a ficha', async () => {
    contextoFeliz()
    storeMock.aplicarEtiquetas.mockResolvedValue({ ok: true, valor: undefined })

    const r = await adicionarEtiquetas('lead-1', ['quente', 'indicação'])

    expect(storeMock.aplicarEtiquetas).toHaveBeenCalledWith('lead-1', ['quente', 'indicação'])
    expect(revalidatePathMock).toHaveBeenCalledWith('/leads/lead-1')
    expect(r.ok).toBe(true)
  })

  it('falha do store propaga o codigo e nao revalida', async () => {
    contextoFeliz()
    storeMock.aplicarEtiquetas.mockResolvedValue({ ok: false, erro: 'lead_nao_encontrado' })

    const r = await adicionarEtiquetas('lead-1', ['quente'])

    expect(r).toEqual({ ok: false, erro: 'lead_nao_encontrado' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('trocarResponsavel', () => {
  it('vendedor nao troca responsavel: sem_permissao antes de tocar o store', async () => {
    contextoFeliz('vendedor')

    const r = await trocarResponsavel('lead-1', 'user-2')

    expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(storeMock.atribuirResponsavel).not.toHaveBeenCalled()
  })

  it('admin troca e revalida ficha E funil (o cartao mostra o avatar)', async () => {
    contextoFeliz('admin')
    storeMock.atribuirResponsavel.mockResolvedValue({ ok: true, valor: undefined })

    const r = await trocarResponsavel('lead-1', 'user-2')

    expect(storeMock.atribuirResponsavel).toHaveBeenCalledWith('lead-1', 'user-2')
    expect(revalidatePathMock).toHaveBeenCalledWith('/leads/lead-1')
    expect(revalidatePathMock).toHaveBeenCalledWith('/funil')
    expect(r.ok).toBe(true)
  })

  it('null remove o responsavel (repassado como null, nao string vazia)', async () => {
    contextoFeliz('gestor')
    storeMock.atribuirResponsavel.mockResolvedValue({ ok: true, valor: undefined })

    const r = await trocarResponsavel('lead-1', null)

    expect(storeMock.atribuirResponsavel).toHaveBeenCalledWith('lead-1', null)
    expect(r.ok).toBe(true)
  })
})
