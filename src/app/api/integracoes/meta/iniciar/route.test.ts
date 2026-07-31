import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Achado do review final de branch: `iniciar/route.ts` nao tinha teste nenhum.
 * O `retorno/route.test.ts` promete, no proprio docblock, pegar regressao em
 * httpOnly/sameSite/secure/path/maxAge dos cookies do fluxo, mas so afirmava
 * httpOnly — e o atributo estruturalmente mais importante dos dois cookies do
 * OAuth e o `sameSite: 'lax'` gravado aqui (`:25`), porque `'strict'` nao
 * sobrevive ao retorno vindo de facebook.com (o comentario ao lado da linha ja
 * registra isso). Mesmo desenho de mock de `retorno/route.test.ts`: `cookies()`
 * como Map capturando as opcoes, `redirect()` lancando para poder inspecionar o
 * destino sem seguir a navegacao de verdade.
 */

type OpcoesCookie = {
  httpOnly?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  secure?: boolean
  path?: string
  maxAge?: number
}

const cookieStore = new Map<string, { value: string; opcoes?: OpcoesCookie }>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string, opcoes?: OpcoesCookie) => {
      cookieStore.set(name, { value, opcoes })
    },
    delete: (name: string) => {
      cookieStore.delete(name)
    },
  }),
}))

class RedirectSinalizado extends Error {
  constructor(public readonly destino: string) {
    super(`redirect:${destino}`)
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string): never => {
    throw new RedirectSinalizado(url)
  },
}))

const adminMock = vi.fn()
vi.mock('@/lib/data/admin', () => ({
  criarAdminStoreDoServidor: () => adminMock(),
}))

import { GET } from './route'
import { COOKIE_ESTADO } from '@/lib/integracoes/estado-oauth'

describe('GET /api/integracoes/meta/iniciar', () => {
  beforeEach(() => {
    cookieStore.clear()
    adminMock.mockReset()
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('fecha a rota pra quem nao tem sessao de admin, sem gravar COOKIE_ESTADO', async () => {
    adminMock.mockResolvedValue({ ok: false, erro: 'sem_sessao' })

    await expect(GET()).rejects.toMatchObject({ destino: '/login' })

    expect(cookieStore.has(COOKIE_ESTADO)).toBe(false)
  })

  it('com sessao de admin, grava o COOKIE_ESTADO com sameSite lax', async () => {
    adminMock.mockResolvedValue({
      ok: true,
      valor: { conta: { id: 'conta-xyz', nome: 'Conta X' }, admin: {} },
    })

    // So interessa o cookie gravado antes do redirect final — nao importa se
    // ele aponta para o retorno falso ou para o dialogo real do facebook.com.
    await expect(GET()).rejects.toThrow()

    const cookie = cookieStore.get(COOKIE_ESTADO)
    expect(cookie?.value).toMatch(/^[0-9a-f]{64}$/)
    expect(cookie?.opcoes?.httpOnly).toBe(true)
    // O atributo que importa: 'strict' quebraria o retorno vindo de
    // facebook.com (comentario ao lado de iniciar/route.ts:25).
    expect(cookie?.opcoes?.sameSite).toBe('lax')
    expect(cookie?.opcoes?.path).toBe('/')
    expect(cookie?.opcoes?.maxAge).toBe(600)
  })
})
