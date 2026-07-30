import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { MetaGraph, PaginaDoMeta } from './meta'

const VERSAO = process.env.META_API_VERSION ?? 'v21.0'
const BASE = `https://graph.facebook.com/${VERSAO}`

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

    const curto = await corpo<{ access_token: string }>(await fetch(url))
    if (!curto.ok) return falha(curto.erro)

    const troca = new URL(`${BASE}/oauth/access_token`)
    troca.searchParams.set('grant_type', 'fb_exchange_token')
    troca.searchParams.set('client_id', this.appId)
    troca.searchParams.set('client_secret', this.appSecret)
    troca.searchParams.set('fb_exchange_token', curto.valor.access_token)

    const longo = await corpo<{ access_token: string }>(await fetch(troca))
    if (!longo.ok) return falha(longo.erro)
    return ok(longo.valor.access_token)
  }

  async listarPaginas(tokenDoUsuario: string): Promise<Resultado<PaginaDoMeta[]>> {
    const url = new URL(`${BASE}/me/accounts`)
    url.searchParams.set('fields', 'id,name,access_token')
    url.searchParams.set('access_token', tokenDoUsuario)

    const r = await corpo<{ data: { id: string; name: string; access_token: string }[] }>(
      await fetch(url),
    )
    if (!r.ok) return falha(r.erro)
    return ok(r.valor.data.map((p) => ({ id: p.id, nome: p.name, token: p.access_token })))
  }

  async assinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>> {
    const url = new URL(`${BASE}/${pageId}/subscribed_apps`)
    url.searchParams.set('subscribed_fields', 'leadgen')
    url.searchParams.set('access_token', tokenDaPagina)

    const r = await corpo<{ success: boolean }>(await fetch(url, { method: 'POST' }))
    if (!r.ok) return falha(r.erro)
    return ok(undefined)
  }

  async desassinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>> {
    const url = new URL(`${BASE}/${pageId}/subscribed_apps`)
    url.searchParams.set('access_token', tokenDaPagina)

    const r = await corpo<{ success: boolean }>(await fetch(url, { method: 'DELETE' }))
    if (!r.ok) return falha(r.erro)
    return ok(undefined)
  }
}
