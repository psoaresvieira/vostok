import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { DadosDoNumero, WhatsAppGraph } from './whatsapp'

// Mesma versao do Graph que meta-real.ts usa — e o mesmo Graph API, so um
// endpoint diferente.
const VERSAO = process.env.META_API_VERSION ?? 'v21.0'
const BASE = `https://graph.facebook.com/${VERSAO}`

/** Nenhum fetch fica pendurado alem disso — a plataforma mataria o route handler de qualquer forma. */
const TIMEOUT_MS = 10_000

type RespostaGraph = {
  display_phone_number?: string
  verified_name?: string
  error?: { message?: string; code?: number }
}

export class WhatsAppGraphReal implements WhatsAppGraph {
  async dadosDoNumero(token: string, phoneNumberId: string): Promise<Resultado<DadosDoNumero>> {
    const url = new URL(`${BASE}/${phoneNumberId}`)
    url.searchParams.set('fields', 'display_phone_number,verified_name')
    url.searchParams.set('access_token', token)

    let r: Response
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (e) {
      // O undici do Node levanta TypeError em falha de DNS/conexao/TLS/timeout
      // — nada disso e resposta HTTP. So o nome do erro no log, nunca o
      // objeto cru: a URL carrega o token na query string.
      console.error('whatsapp graph inalcancavel', e instanceof Error ? e.name : 'desconhecido')
      return falha('whatsapp_indisponivel')
    }

    const dados = (await r.json().catch(() => ({}))) as RespostaGraph

    // 5xx vence mesmo quando o corpo (malformado ou nao) parece um erro do
    // Graph: e o servidor deles caindo, nao a credencial que esta errada.
    if (r.status >= 500) {
      console.error('whatsapp graph indisponivel', r.status)
      return falha('whatsapp_indisponivel')
    }
    // 4xx com corpo de erro do Graph: token ou phone_number_id recusados.
    if (dados.error) {
      console.error('whatsapp graph recusou', r.status, dados.error.code, dados.error.message)
      return falha('token_whatsapp_invalido')
    }
    // Resposta 200 sem "error" mas em formato inesperado (ou !r.ok sem corpo
    // de erro) e possivel — o Graph tambem falha assim, nao so com status.
    if (!r.ok || !dados.display_phone_number || !dados.verified_name) {
      console.error('whatsapp graph formato inesperado', r.status)
      return falha('whatsapp_indisponivel')
    }
    return ok({
      numeroExibicao: dados.display_phone_number,
      nomeVerificado: dados.verified_name,
    })
  }
}
