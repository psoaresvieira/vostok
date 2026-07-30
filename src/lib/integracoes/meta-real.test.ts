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

  it('limita cada chamada com um AbortSignal de timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })
    global.fetch = fetchMock
    const g = new MetaGraphReal('app-id', 'app-secret')

    await g.listarPaginas('token-de-usuario')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
