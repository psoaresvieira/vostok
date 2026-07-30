import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { MetaGraph, PaginaDoMeta } from './meta'

const VERSAO = process.env.META_API_VERSION ?? 'v21.0'
const BASE = `https://graph.facebook.com/${VERSAO}`

/** Nenhum fetch fica pendurado alem disso — a plataforma mataria o route handler de qualquer forma. */
const TIMEOUT_MS = 10_000

type RespostaErro = { error?: { message?: string; code?: number } }

/**
 * Traduz qualquer falha do Graph API num codigo unico. A mensagem do Meta e
 * util em log, nunca na tela: ela vem em ingles, muda de texto sem aviso e as
 * vezes cita id interno de app.
 */
async function corpo<T>(r: Response): Promise<Resultado<T>> {
  const dados = (await r.json().catch(() => ({}))) as T & RespostaErro
  if (!r.ok || dados.error) {
    console.error('graph api', r.status, dados.error?.code, dados.error?.message)
    return falha('meta_indisponivel')
  }
  return ok(dados)
}

/**
 * Envolve fetch + corpo num try/catch. O undici do Node levanta `TypeError:
 * fetch failed` em falha de DNS, conexao resetada, TLS ou timeout de socket —
 * nada disso e uma resposta HTTP, entao `corpo()` nunca chega a rodar. Sem
 * este helper a excecao subia crua ate o route handler e virava 500 em vez de
 * `/config?meta=indisponivel`, contradizendo o contrato que o proprio port
 * declara (meta.ts: "Todo metodo devolve Resultado"). O Graph ficar
 * inalcancavel e de longe a falha mais provavel que este codigo vai ver.
 *
 * `AbortSignal.timeout` entra aqui, e nao em cada chamada: um Graph pendurado
 * (sem recusar nem responder) nao e coberto pelo catch de rejeicao — ele so
 * nunca resolve — e sem prazo o route handler ficaria preso ate a plataforma
 * matar o processo.
 */
async function chamar<T>(url: URL, init?: RequestInit): Promise<Resultado<T>> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    return await corpo<T>(r)
  } catch (e) {
    // So o nome do erro, igual a disciplina de corpo() duas funcoes acima
    // (que loga so status/codigo/mensagem, nunca o objeto cru). Nenhuma
    // versao conhecida do undici embute a URL completa — que aqui carrega
    // client_secret e access_token na query string — no TypeError nem no
    // DOMException de AbortSignal.timeout, entao nada vaza hoje; e
    // consistencia com o resto do arquivo, nao correcao de vazamento.
    console.error('graph api inalcancavel', e instanceof Error ? e.name : 'desconhecido')
    return falha('meta_indisponivel')
  }
}

export class MetaGraphReal implements MetaGraph {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  async trocarCodePorTokenLongo(
    code: string,
    redirectUri: string,
  ): Promise<Resultado<string>> {
    // O dialog devolve um token curto; `fb_exchange_token` o converte no longo.
    // Token de PAGINA derivado de um token de usuario longo nao expira, e e por
    // isso que essa etapa nao pode ser pulada.
    const url = new URL(`${BASE}/oauth/access_token`)
    url.searchParams.set('client_id', this.appId)
    url.searchParams.set('client_secret', this.appSecret)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('code', code)

    const curto = await chamar<{ access_token: string }>(url)
    if (!curto.ok) return falha(curto.erro)

    const troca = new URL(`${BASE}/oauth/access_token`)
    troca.searchParams.set('grant_type', 'fb_exchange_token')
    troca.searchParams.set('client_id', this.appId)
    troca.searchParams.set('client_secret', this.appSecret)
    troca.searchParams.set('fb_exchange_token', curto.valor.access_token)

    const longo = await chamar<{ access_token: string }>(troca)
    if (!longo.ok) return falha(longo.erro)
    return ok(longo.valor.access_token)
  }

  async listarPaginas(tokenDoUsuario: string): Promise<Resultado<PaginaDoMeta[]>> {
    const url = new URL(`${BASE}/me/accounts`)
    url.searchParams.set('fields', 'id,name,access_token')
    url.searchParams.set('access_token', tokenDoUsuario)

    const r = await chamar<{ data: { id: string; name: string; access_token: string }[] }>(url)
    if (!r.ok) return falha(r.erro)
    // Resposta 200 sem `error` mas com formato inesperado (ex.: corpo vazio)
    // e possivel — o Graph tambem falha assim, nao so com status != 2xx.
    // Sem esta guarda, `.map` num `undefined` levantava TypeError e a
    // excecao escapava do mesmo jeito que um fetch rejeitado.
    if (!Array.isArray(r.valor.data)) return falha('meta_indisponivel')
    return ok(r.valor.data.map((p) => ({ id: p.id, nome: p.name, token: p.access_token })))
  }

  async assinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>> {
    const url = new URL(`${BASE}/${pageId}/subscribed_apps`)
    url.searchParams.set('subscribed_fields', 'leadgen')
    url.searchParams.set('access_token', tokenDaPagina)

    const r = await chamar<{ success: boolean }>(url, { method: 'POST' })
    if (!r.ok) return falha(r.erro)
    return ok(undefined)
  }

  async desassinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>> {
    const url = new URL(`${BASE}/${pageId}/subscribed_apps`)
    url.searchParams.set('access_token', tokenDaPagina)

    const r = await chamar<{ success: boolean }>(url, { method: 'DELETE' })
    if (!r.ok) return falha(r.erro)
    return ok(undefined)
  }
}
