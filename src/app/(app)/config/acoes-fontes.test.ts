import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Este e o portao que fecha a outra metade do buraco cross-tenant achado no
 * review da Task 6: a Task 6 GRAVA o COOKIE_TOKEN como `${conta.id}:${token}`;
 * esta task e quem RECUSA quando o prefixo nao bate com a conta ativa da
 * requisicao atual. Sem este arquivo, um refactor futuro podia derrubar a
 * checagem em `tokenDaConta` sem nenhum teste ficar vermelho, e o buraco
 * reabriria em silencio.
 *
 * `cookies()` e mockado como um Map, no mesmo desenho de
 * api/integracoes/meta/retorno/route.test.ts. `criarFonteStoreDoServidor` e
 * mockado para devolver sempre a mesma conta ativa ('conta-real'), para que o
 * teste controle so a variavel que importa: o valor do cookie.
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

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

const CONTA_ATIVA = { id: 'conta-real', nome: 'Conta Real' }

const fonteStoreMock = {
  listar: vi.fn(),
  conectarMeta: vi.fn(),
  conectarGoogle: vi.fn(),
  definirResponsavel: vi.fn(),
  desconectar: vi.fn(),
}

vi.mock('@/lib/data/fontes', () => ({
  criarFonteStoreDoServidor: async () => ({
    ok: true,
    valor: { fontes: fonteStoreMock, conta: CONTA_ATIVA },
  }),
}))

import { COOKIE_TOKEN } from '@/lib/integracoes/estado-oauth'
import { metaFalso } from '@/lib/integracoes/fabrica'
import { listarPaginasDoMetaAction, conectarPaginaAction } from './acoes-fontes'

describe('acoes-fontes — amarracao do COOKIE_TOKEN a conta', () => {
  beforeEach(() => {
    cookieStore.clear()
    metaFalso().reiniciar()
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('COOKIE_TOKEN de outra conta: listarPaginasDoMetaAction devolve conexao_expirada e nao lista', async () => {
    cookieStore.set(COOKIE_TOKEN, { value: 'conta-de-outro-admin:token-longo-xyz' })

    const r = await listarPaginasDoMetaAction()

    expect(r).toEqual({ ok: false, erro: 'conexao_expirada' })
    // Asercao sobre o estado do duplo, nao espionagem de chamada: se o token
    // de outra conta tivesse sido usado, listadas teria o token dentro.
    expect(metaFalso().listadas).toEqual([])
  })

  it('COOKIE_TOKEN de outra conta: conectarPaginaAction devolve conexao_expirada e nao lista', async () => {
    cookieStore.set(COOKIE_TOKEN, { value: 'conta-de-outro-admin:token-longo-xyz' })

    const r = await conectarPaginaAction('100000000000001')

    expect(r).toEqual({ ok: false, erro: 'conexao_expirada' })
    expect(metaFalso().listadas).toEqual([])
  })

  it('cookie ausente devolve a mesma mensagem que cookie de outra conta', async () => {
    const semCookie = await listarPaginasDoMetaAction()
    expect(semCookie).toEqual({ ok: false, erro: 'conexao_expirada' })

    cookieStore.set(COOKIE_TOKEN, { value: 'conta-de-outro-admin:token-longo-xyz' })
    const outraConta = await listarPaginasDoMetaAction()
    expect(outraConta).toEqual({ ok: false, erro: 'conexao_expirada' })

    // Divergir aqui vazaria que outra sessao esteve ativa neste navegador.
    expect(semCookie).toEqual(outraConta)
  })

  it('cookie sem ":" (formato anterior a amarracao por conta) devolve conexao_expirada', async () => {
    cookieStore.set(COOKIE_TOKEN, { value: 'token-cru-sem-prefixo-de-conta' })

    const r = await listarPaginasDoMetaAction()

    expect(r).toEqual({ ok: false, erro: 'conexao_expirada' })
    expect(metaFalso().listadas).toEqual([])
  })

  // As tres formas de cookie que fazem tokenDaConta chamar recusar(): conta
  // errada, formato antigo (sem ':') e token vazio depois do ':'. "Cookie
  // ausente" fica de fora de proposito: nesse caso nao ha nada em
  // cookieStore para apagar, entao a asercao seria verdadeira so porque
  // nunca houve cookie — nao prova que a deleção aconteceu.
  it.each([
    ['conta errada', 'conta-de-outro-admin:token-longo-xyz'],
    ['formato antigo, sem ":"', 'token-cru-sem-prefixo-de-conta'],
    ['token vazio depois do ":"', `${CONTA_ATIVA.id}:`],
  ])('recusa por %s apaga o COOKIE_TOKEN', async (_descricao, valorDoCookie) => {
    cookieStore.set(COOKIE_TOKEN, { value: valorDoCookie })

    const r = await listarPaginasDoMetaAction()

    expect(r).toEqual({ ok: false, erro: 'conexao_expirada' })
    expect(cookieStore.has(COOKIE_TOKEN)).toBe(false)
  })

  // Invariante positiva, no caminho feliz: o token de cada Page nunca sai do
  // servidor (iria para o payload RSC e o HTML se saisse). Antes desta task
  // essa garantia so tinha sido conferida uma vez, a mao, no experimento de
  // mutacao do Step 3b — nao pela suite. De quebra, prova que `listadas` E
  // preenchido de verdade num sucesso real, e nao so ausente nas recusas
  // acima.
  it('listarPaginasDoMetaAction nunca devolve o token da Page', async () => {
    const tokenDeUsuario = 'token-de-usuario-valido'
    cookieStore.set(COOKIE_TOKEN, { value: `${CONTA_ATIVA.id}:${tokenDeUsuario}` })

    const r = await listarPaginasDoMetaAction()

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.length).toBeGreaterThan(0)
    expect(r.valor.every((p) => !('token' in p))).toBe(true)
    expect(metaFalso().listadas).toEqual([tokenDeUsuario])
  })
})
