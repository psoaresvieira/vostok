import { describe, it, expect, vi, afterEach } from 'vitest'
import { MetaGraphReal } from './meta-real'

/**
 * meta.ts:11-13 declara o contrato do port: "Todo metodo devolve Resultado
 * ... [as falhas do Graph API] precisam virar mensagem na tela". Antes desta
 * task, todo `await fetch(...)` em meta-real.ts rodava sem try/catch. O
 * undici do Node levanta `TypeError: fetch failed` em falha de DNS, conexao
 * resetada, TLS ou timeout de socket — nada disso e resposta HTTP, entao
 * `corpo()` nunca chegava a rodar; a excecao subia crua ate o route handler e
 * virava 500 em vez de `/config?meta=indisponivel`. Nenhum destes testes toca
 * rede de verdade: `global.fetch` e substituido por um double que rejeita ou
 * devolve corpo malformado, exercitando exatamente os dois jeitos como um
 * Graph inalcancavel ou instavel se manifesta.
 */
describe('MetaGraphReal — falhas de rede nao escapam do contrato do port', () => {
  const fetchOriginal = global.fetch

  afterEach(() => {
    global.fetch = fetchOriginal
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('devolve meta_indisponivel quando o fetch rejeita (DNS/conexao/TLS/timeout)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.trocarCodePorTokenLongo('code', 'http://localhost/retorno')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
  })

  it('devolve meta_indisponivel quando assinarLeadgen tambem enfrenta fetch rejeitado', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.assinarLeadgen('42', 'token-da-pagina')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
  })

  it('devolve meta_indisponivel quando a resposta 200 nao traz "data" como array', async () => {
    // Resposta bem formada (r.ok true, sem campo "error"), mas com formato
    // que o codigo nao espera. Sem a guarda Array.isArray, `.map` levantaria
    // TypeError e o erro escaparia como 500 do mesmo jeito que o fetch
    // rejeitado.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.listarPaginas('token-de-usuario')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
  })

  it('resolve para meta_indisponivel quando a requisicao trava alem do prazo do port', async () => {
    // Versao anterior deste teste so espiava a chamada
    // (`toHaveBeenCalledTimes` + inspecionar `init.signal`): provava que
    // "algum" AbortSignal foi anexado, mas nao que o prazo e de 10s, nao que
    // uma requisicao realmente pendurada aborta, e nao que o abort vira
    // `falha('meta_indisponivel')` em vez de excecao. Uma regressao que
    // anexasse o signal com duracao errada, ou que engolisse o abort,
    // passaria verde do mesmo jeito.
    //
    // `vi.useFakeTimers()` sozinho NAO adianta aqui — confirmado
    // empiricamente: o timer que AbortSignal.timeout() agenda por baixo dos
    // panos e interno ao Node (nao passa por globalThis.setTimeout), entao
    // avancar o relogio falso do vitest nunca dispara o abort de um
    // AbortSignal.timeout real. Por isso substituimos o metodo estatico
    // AbortSignal.timeout por uma versao equivalente apoiada em setTimeout,
    // que o relogio falso ja controla. O resto do mecanismo real continua de
    // pe sem nenhuma modificacao: chamar() em meta-real.ts chama
    // AbortSignal.timeout(TIMEOUT_MS) sem saber que foi substituido, passa o
    // signal resultante para fetch, e o fetch (aqui, um double que nunca
    // resolve sozinho) so rejeita quando esse signal aborta.
    vi.useFakeTimers()
    const chamadas: number[] = []
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      chamadas.push(ms)
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('TimeoutError', 'TimeoutError')), ms)
      return controller.signal
    })

    // Um fetch que nunca resolve por conta propria: e exatamente como uma
    // requisicao pendurada de verdade se comporta (header nunca chega, ou
    // corpo trava). So reage ao abort do signal recebido.
    global.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'))
        })
      })
    })

    const g = new MetaGraphReal('app-id', 'app-secret')
    const promessa = g.listarPaginas('token-de-usuario')

    await vi.advanceTimersByTimeAsync(10_000)
    const r = await promessa

    // Prova o prazo exato, e nao so "algum" prazo.
    expect(chamadas).toEqual([10_000])
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
  })
})

describe('MetaGraphReal — buscarLead, arvoreDoAnuncio e posseDaPagina', () => {
  const fetchOriginal = global.fetch

  afterEach(() => {
    global.fetch = fetchOriginal
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('buscarLead mapeia field_data para campos e extrai ad_id/form_id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        field_data: [
          { name: 'full_name', values: ['Fulano de Tal'] },
          { name: 'email', values: ['fulano@example.com'] },
        ],
        ad_id: 'ad-1',
        form_id: 'form-1',
        created_time: '2026-01-01T00:00:00+0000',
      }),
    })
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.buscarLead('leadgen-1', 'token-da-pagina')
    if (!r.ok) throw new Error(r.erro)
    expect(r.valor.campos).toEqual([
      { name: 'full_name', values: ['Fulano de Tal'] },
      { name: 'email', values: ['fulano@example.com'] },
    ])
    expect(r.valor.adId).toBe('ad-1')
    expect(r.valor.formId).toBe('form-1')
    expect(r.valor.criadoEm).toBe('2026-01-01T00:00:00+0000')
  })

  it('buscarLead com resposta 200 sem field_data devolve meta_indisponivel em vez de estourar', async () => {
    // Mesma guarda que listarPaginas ja tem em meta-real.ts:100: resposta bem
    // formada (r.ok true, sem "error"), mas em formato que o codigo nao
    // espera. Sem a guarda, ler .map de undefined levantaria TypeError e a
    // excecao escaparia do mesmo jeito que um fetch rejeitado.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.buscarLead('leadgen-1', 'token-da-pagina')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
  })

  it('buscarLead devolve meta_indisponivel quando o fetch rejeita', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.buscarLead('leadgen-1', 'token-da-pagina')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
  })

  it('arvoreDoAnuncio pede os tres niveis numa chamada so', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'ad-1',
        name: 'Anuncio Video 15s',
        adset: { id: 'adset-9', name: 'Conjunto Interesse' },
        campaign: { id: 'camp-7', name: 'Campanha de Verao' },
      }),
    })
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.arvoreDoAnuncio('ad-1', 'token-da-pagina')

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor).toEqual({
      anuncioId: 'ad-1',
      anuncioNome: 'Anuncio Video 15s',
      conjuntoId: 'adset-9',
      conjuntoNome: 'Conjunto Interesse',
      campanhaId: 'camp-7',
      campanhaNome: 'Campanha de Verao',
    })
    // Uma ida ao Graph, nao tres: a arvore inteira cabe num `fields`. Tres
    // chamadas por lead multiplicariam a latencia do webhook por tres e
    // dariam tres chances de falha parcial.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const url = String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    // Afirma sobre o valor decodificado, para o teste nao quebrar se a
    // codificacao de `{` e `,` mudar entre versoes de URL.
    expect(decodeURIComponent(url)).toContain('fields=name,adset{id,name},campaign{id,name}')
  })

  it('arvoreDoAnuncio devolve os niveis ausentes como nulo, sem inventar valor', async () => {
    // Anuncio orfao de campanha nao existe no Meta hoje, mas resposta 200 com
    // campo faltando existe (permissao parcial, objeto apagado). O contrato e
    // nulo — nunca string vazia, que na coluna viraria "campanha sem nome" e
    // agruparia leads de campanhas diferentes no mesmo balde.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'ad-2', name: 'So o anuncio' }),
    })
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.arvoreDoAnuncio('ad-2', 'token-da-pagina')

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor).toEqual({
      anuncioId: 'ad-2',
      anuncioNome: 'So o anuncio',
      conjuntoId: null,
      conjuntoNome: null,
      campanhaId: null,
      campanhaNome: null,
    })
  })

  it('arvoreDoAnuncio devolve meta_indisponivel quando o fetch rejeita', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('rede caiu'))
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.arvoreDoAnuncio('ad-1', 'token-da-pagina')

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
  })

  it('posseDaPagina devolve ok quando /me responde com o mesmo id, e chama GET /me — nunca /{page_id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '100000000000001' }),
    })
    global.fetch = fetchMock
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.posseDaPagina('100000000000001', 'token-da-pagina')
    expect(r.ok).toBe(true)

    // Achado 6 do review final: a substancia inteira do fechamento do
    // squat de Page (README, secao "O que fechou o risco") e esta rota
    // chamar /me, nunca /{page_id} — um token de pagina consegue ler campos
    // publicos de QUALQUER pagina via GET /{page_id}?fields=id, entao essa
    // chamada teria sucesso mesmo com o token errado e nao provaria posse
    // nenhuma. So GET /me sempre responde como a propria pagina dona do
    // token. Sem esta asserção de URL, uma regressao para /{page_id} passa
    // verde em todo teste deste arquivo (inclusive o de baixo, que so
    // confere o `id` devolvido) e reabre o squat silenciosamente.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const urlChamada = new URL(fetchMock.mock.calls[0][0] as string | URL)
    expect(urlChamada.pathname).toBe('/v21.0/me')
    expect(urlChamada.pathname).not.toContain('100000000000001')
  })

  it('posseDaPagina devolve posse_nao_comprovada quando /me responde com id diferente', async () => {
    // O caso mais importante deste arquivo: um token de pagina so prova posse
    // da propria pagina. GET /{page_id}?fields=id NAO serviria de prova — um
    // token de pagina consegue ler campos publicos de OUTRAS paginas, entao
    // essa chamada teria sucesso mesmo com o token errado. GET /me e diferente:
    // ele sempre responde como a propria pagina do token, nunca como outra.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '999999999999999' }),
    })
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.posseDaPagina('100000000000001', 'token-de-outra-pagina')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('posse_nao_comprovada')
  })

  it('posseDaPagina devolve meta_indisponivel quando o fetch rejeita', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const g = new MetaGraphReal('app-id', 'app-secret')

    const r = await g.posseDaPagina('100000000000001', 'token-da-pagina')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('meta_indisponivel')
  })
})
