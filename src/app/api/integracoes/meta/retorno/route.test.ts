import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Cenario do review: admin A completa o dialogo do Facebook numa maquina
 * compartilhada e sai sem escolher a Page. O COOKIE_TOKEN guarda o token de
 * usuario do Meta de A por 15 minutos. Se o usuario B entrar no CRM no mesmo
 * navegador dentro da janela, a rota de retorno nao autorizava ninguem — o
 * cookie de state so prova que UMA sessao de admin existia quando o fluxo
 * comecou, nunca que ainda existe nem que e a mesma. Sem o check de sessao
 * aqui, e sem o token amarrado a conta, a Task 7 listaria as Pages de A para
 * B e deixaria B conectar uma delas no tenant errado.
 *
 * Estes testes mockam next/headers, next/navigation e
 * @/lib/data/admin para rodar a rota como funcao pura, sem servidor HTTP nem
 * rede: o Graph e sempre o falso deste processo (metaFalso()), como em
 * qualquer outro teste automatizado deste projeto.
 */

/**
 * O mock anterior de `set` descartava o terceiro argumento (as opcoes do
 * cookie). Consequencia: nenhum teste deste repositorio conseguia pegar
 * regressao em httpOnly/sameSite/secure/path/maxAge em nenhum dos dois
 * cookies do fluxo — justamente os atributos mais escrutinados no primeiro
 * review, e os menos defendidos por teste ate agora.
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
import { COOKIE_ESTADO, COOKIE_TOKEN, gerarEstado } from '@/lib/integracoes/estado-oauth'
import { metaFalso } from '@/lib/integracoes/fabrica'

function requisicao(query: string): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/integracoes/meta/retorno?${query}`) } as unknown as NextRequest
}

describe('GET /api/integracoes/meta/retorno', () => {
  const fetchOriginal = global.fetch

  beforeEach(() => {
    cookieStore.clear()
    adminMock.mockReset()
    metaFalso().reiniciar()
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')

    // A garantia de "sem rede" deste arquivo era incidental: so existia
    // porque META_FAKE=1 estava no beforeEach, e metaGraph() so consulta
    // esse stub em tempo de chamada. Se o stub fosse removido, reordenado, ou
    // se metaGraph() um dia decidisse por outro caminho a instancia real,
    // nada aqui pegaria — o teste dispararia request de verdade contra
    // graph.facebook.com antes de falhar. Mesma tecnica de
    // meta-real.test.ts: substitui fetch por um double que estoura se for
    // chamado, tornando a ausencia de rede estrutural em vez de incidental.
    global.fetch = () => {
      throw new Error('teste tentou tocar rede: metaGraph() nao esta usando o falso')
    }
  })

  afterEach(() => {
    global.fetch = fetchOriginal
    vi.unstubAllEnvs()
  })

  it('fecha a rota pra quem nao tem sessao de admin, mesmo com state valido', async () => {
    adminMock.mockResolvedValue({ ok: false, erro: 'sem_sessao' })
    const estado = gerarEstado()
    cookieStore.set(COOKIE_ESTADO, { value: estado })

    await expect(GET(requisicao(`state=${estado}&code=abc`))).rejects.toMatchObject({
      destino: '/login',
    })

    // Nem chegou a tocar no cookie de OAuth: a autorizacao vem antes de tudo.
    expect(cookieStore.has(COOKIE_TOKEN)).toBe(false)
    expect(cookieStore.get(COOKIE_ESTADO)?.value).toBe(estado)
  })

  it('amarra o COOKIE_TOKEN a conta do admin autenticado', async () => {
    adminMock.mockResolvedValue({
      ok: true,
      valor: { conta: { id: 'conta-xyz', nome: 'Conta X' }, admin: {} },
    })
    const estado = gerarEstado()
    cookieStore.set(COOKIE_ESTADO, { value: estado })

    await expect(GET(requisicao(`state=${estado}&code=algum-code`))).rejects.toMatchObject({
      destino: '/config?meta=escolher',
    })

    const cookie = cookieStore.get(COOKIE_TOKEN)
    expect(cookie?.value).toBe('conta-xyz:token-longo-para-algum-code')
    expect(cookie?.opcoes?.httpOnly).toBe(true)
  })

  it('nao amarra nada quando a autorizacao falha, mesmo com state e code validos', async () => {
    adminMock.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    const estado = gerarEstado()
    cookieStore.set(COOKIE_ESTADO, { value: estado })

    await expect(GET(requisicao(`state=${estado}&code=algum-code`))).rejects.toMatchObject({
      destino: '/login',
    })
    expect(cookieStore.has(COOKIE_TOKEN)).toBe(false)
  })
})
