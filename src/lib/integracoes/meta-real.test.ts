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
