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
  reivindicarMeta: vi.fn(),
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
import {
  listarPaginasDoMetaAction,
  conectarPaginaAction,
  reivindicarPaginaAction,
} from './acoes-fontes'

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

/**
 * Achado do review final de branch: `conectarPaginaAction` assina o campo
 * leadgen ANTES de gravar a linha (correto — fonte gravada sem inscricao nunca
 * receberia webhook), mas se `conectarMeta` falhar depois — `page_ja_conectada`
 * sendo o caso realista, uma Page squattada por outra conta — a action
 * devolvia o erro sem desfazer a assinatura. O dono legitimo da Page,
 * tentando conectar a propria Page squattada, deixava uma inscricao real de
 * leadgen viva nela; a partir do momento em que o Plano 4 resolve entrega por
 * (provedor, external_id), qualquer caminho que assine aquela Page de novo
 * passa a entregar os leads do dono legitimo na conta do invasor.
 */
describe('acoes-fontes — conectarPaginaAction desfaz a assinatura quando a gravacao falha', () => {
  beforeEach(() => {
    cookieStore.clear()
    metaFalso().reiniciar()
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
    fonteStoreMock.conectarMeta.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('assinatura falhando: devolve o erro do Graph e nunca chega a chamar conectarMeta', async () => {
    cookieStore.set(COOKIE_TOKEN, { value: `${CONTA_ATIVA.id}:token-de-usuario` })
    metaFalso().falharEm = 'assinarLeadgen'

    const r = await conectarPaginaAction('100000000000001')

    expect(r).toEqual({ ok: false, erro: 'meta_indisponivel' })
    expect(fonteStoreMock.conectarMeta).not.toHaveBeenCalled()
    // Nunca assinou de verdade, entao nao ha nada para desfazer.
    expect(metaFalso().desassinadas).toEqual([])
  })

  it('conectarMeta falhando depois de assinar: desfaz a assinatura na Page (nao deixa leadgen vivo)', async () => {
    cookieStore.set(COOKIE_TOKEN, { value: `${CONTA_ATIVA.id}:token-de-usuario` })
    fonteStoreMock.conectarMeta.mockResolvedValueOnce({ ok: false, erro: 'page_ja_conectada' })

    const r = await conectarPaginaAction('100000000000001')

    expect(r).toEqual({ ok: false, erro: 'page_ja_conectada' })
    // Asercao sobre o estado do duplo (MetaGraphFalso.desassinadas), nao
    // espionagem de chamada: prova que a Page realmente saiu inscrita, e nao
    // so que algum metodo foi invocado.
    expect(metaFalso().assinadas).toEqual(['100000000000001'])
    expect(metaFalso().desassinadas).toEqual(['100000000000001'])
  })
})

/**
 * Task 10: a outra metade do fechamento do squat de Page. A migration 0012
 * tira a RPC do alcance de quem so tem sessao (segredo de ingestao); esta
 * metade prova, contra o Graph, que quem chama de fato administra a Page
 * ANTES de gravar. Sem isto a Server Action confiaria cegamente no pageId
 * que veio do clique do usuario, exatamente como a RPC confiava antes da
 * 0012 — so que agora pela tela, nao pelo PostgREST direto.
 */
describe('acoes-fontes — posseDaPagina roda antes de gravar (Task 10)', () => {
  beforeEach(() => {
    cookieStore.clear()
    metaFalso().reiniciar()
    vi.stubEnv('META_FAKE', '1')
    vi.stubEnv('NODE_ENV', 'test')
    fonteStoreMock.conectarMeta.mockReset()
    fonteStoreMock.reivindicarMeta.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('caminho feliz: prova posse antes de gravar, a Page conecta, e a compensacao continua fora do caminho feliz', async () => {
    cookieStore.set(COOKIE_TOKEN, { value: `${CONTA_ATIVA.id}:token-de-usuario` })
    fonteStoreMock.conectarMeta.mockResolvedValueOnce({ ok: true, valor: 'novo-source-id' })

    const r = await conectarPaginaAction('100000000000001')

    expect(r).toEqual({ ok: true, valor: undefined })
    // A posse foi de fato conferida contra o Graph para esta Page, nao so
    // assumida porque o pageId veio do clique.
    expect(metaFalso().posseConferida).toEqual(['100000000000001'])
    expect(fonteStoreMock.conectarMeta).toHaveBeenCalledWith(
      '100000000000001',
      'SE7E Marketing',
      'token-da-pagina-1',
      null,
    )
    // Backlog do Plano 3, fechado aqui: nada ate esta linha provava que a
    // compensacao de desassinarLeadgen (acoes-fontes.ts) fica DENTRO do ramo
    // de falha. Se um refactor a icasse para fora, todo connect bem-sucedido
    // desassinaria o leadgen na hora e nenhum lead chegaria jamais —
    // silenciosamente, sem nada no repo ficando vermelho.
    expect(metaFalso().desassinadas).toEqual([])
  })

  it('posse nao comprovada: recusa com posse_nao_comprovada, nao grava e nao assina leadgen', async () => {
    cookieStore.set(COOKIE_TOKEN, { value: `${CONTA_ATIVA.id}:token-de-usuario` })
    // Forca a resposta do Graph sem tocar rede: isto e ARRANJO (uma unica
    // chamada preparada), nao a asercao — a asercao, abaixo, e sobre o
    // estado do duplo (assinadas), nunca sobre esta chamada ter acontecido.
    vi.spyOn(metaFalso(), 'posseDaPagina').mockResolvedValueOnce({
      ok: false,
      erro: 'posse_nao_comprovada',
    })

    const r = await conectarPaginaAction('100000000000001')

    expect(r).toEqual({ ok: false, erro: 'posse_nao_comprovada' })
    expect(fonteStoreMock.conectarMeta).not.toHaveBeenCalled()
    // O dano que esta task existe para impedir: assinar leadgen de uma Page
    // cuja posse nao foi provada.
    expect(metaFalso().assinadas).toEqual([])
  })

  it('reivindicarPaginaAction exige a mesma prova de posse e recusa com o mesmo codigo quando ela falha', async () => {
    cookieStore.set(COOKIE_TOKEN, { value: `${CONTA_ATIVA.id}:token-de-usuario` })
    vi.spyOn(metaFalso(), 'posseDaPagina').mockResolvedValueOnce({
      ok: false,
      erro: 'posse_nao_comprovada',
    })

    const r = await reivindicarPaginaAction('100000000000001')

    expect(r).toEqual({ ok: false, erro: 'posse_nao_comprovada' })
    expect(fonteStoreMock.reivindicarMeta).not.toHaveBeenCalled()
    expect(metaFalso().assinadas).toEqual([])
  })

  it('desassinarLeadgen falhando na compensacao: o erro que volta e o original de conectarMeta, nao o da compensacao', async () => {
    cookieStore.set(COOKIE_TOKEN, { value: `${CONTA_ATIVA.id}:token-de-usuario` })
    fonteStoreMock.conectarMeta.mockResolvedValueOnce({ ok: false, erro: 'page_ja_conectada' })
    metaFalso().falharEm = 'desassinarLeadgen'

    const r = await conectarPaginaAction('100000000000001')

    // page_ja_conectada e o erro ORIGINAL de conectarMeta. Se a compensacao
    // (best-effort) vazasse seu proprio erro, quem le a tela veria
    // meta_indisponivel por cima de um caso que nao tem nada a ver com o
    // Facebook estar fora do ar.
    expect(r).toEqual({ ok: false, erro: 'page_ja_conectada' })
  })
})
