import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type {
  DadosDoNumero,
  StatusTemplate,
  TemplateSubmetido,
  WhatsAppGraph,
} from './whatsapp'

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

type RespostaErro = { error?: { message?: string; code?: number } }

type RespostaSubmissao = { id?: string; status?: string } & RespostaErro
type RespostaStatus = {
  data?: { name?: string; status?: string; rejected_reason?: string }[]
  paging?: { next?: string }
} & RespostaErro
type RespostaApagar = { success?: boolean } & RespostaErro
type RespostaEnvio = { messages?: { id?: string }[] } & RespostaErro

/**
 * fetch + timeout + captura de rejeicao (DNS/conexao/TLS/timeout), na mesma
 * disciplina de `dadosDoNumero` alguns metodos abaixo: nunca deixa a excecao
 * do undici subir crua ate o route handler. So o nome do erro no log — nunca
 * o objeto cru, porque a URL carrega o token na query string.
 */
async function buscar(
  url: URL,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<Resultado<Response>> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    return ok(r)
  } catch (e) {
    console.error('whatsapp graph inalcancavel', e instanceof Error ? e.name : 'desconhecido')
    return falha('whatsapp_indisponivel')
  }
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

  async submeterTemplate(
    token: string,
    wabaId: string,
    d: { nome: string; idioma: string; categoria: 'marketing' | 'utility'; corpo: string },
  ): Promise<Resultado<TemplateSubmetido>> {
    const url = new URL(`${BASE}/${wabaId}/message_templates`)
    url.searchParams.set('access_token', token)

    const busca = await buscar(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: d.nome,
        language: d.idioma,
        // Categoria em MAIUSCULAS no fio — o Graph exige — mas o tipo TS
        // fica minusculo, que e como o resto do CRM trata a categoria.
        category: d.categoria.toUpperCase(),
        components: [{ type: 'BODY', text: d.corpo }],
      }),
    })
    if (!busca.ok) return busca
    const r = busca.valor

    if (r.status >= 500) {
      console.error('whatsapp graph indisponivel', r.status)
      return falha('whatsapp_indisponivel')
    }
    const dados = (await r.json().catch(() => ({}))) as RespostaSubmissao
    // 4xx com corpo de erro: o Graph recusou o template submetido.
    if (!r.ok || dados.error) {
      console.error('whatsapp graph recusou submissao', r.status, dados.error?.code, dados.error?.message)
      return falha('template_recusado_pelo_meta')
    }
    // 200 sem "error" mas em formato inesperado (falta id/status) e possivel
    // — o Graph tambem falha assim, nao so recusando. Isso nao e uma recusa
    // de submissao (mesma guarda de dadosDoNumero acima).
    if (!dados.id || !dados.status) {
      console.error('whatsapp graph formato inesperado na submissao', r.status)
      return falha('whatsapp_indisponivel')
    }
    return ok({ idMeta: dados.id, status: dados.status.toLowerCase() })
  }

  async statusDoTemplate(
    token: string,
    wabaId: string,
    nome: string,
  ): Promise<Resultado<StatusTemplate>> {
    let url = new URL(`${BASE}/${wabaId}/message_templates`)
    url.searchParams.set('name', nome)
    url.searchParams.set('fields', 'name,status,rejected_reason')
    url.searchParams.set('access_token', token)

    // O `name=` e prefix-match e a resposta e paginada: com orfaos de
    // re-submissao acumulados (o apagar e best-effort), o template exato pode
    // cair fora da primeira pagina. O teto existe para uma WABA patologica
    // nao virar um loop de rede dentro do request; 10 paginas cobrem centenas
    // de templates com o MESMO prefixo, que o sufixo aleatorio ja torna raro.
    const PAGINAS_MAX = 10
    // O prazo e' AGREGADO: TIMEOUT_MS para a paginacao inteira, nao por pagina
    // — 10 paginas lentas somariam 100s, e a plataforma mata o route handler
    // muito antes disso. Cada pagina recebe so o que sobrou do orcamento.
    const inicio = Date.now()
    for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
      const restante = TIMEOUT_MS - (Date.now() - inicio)
      if (restante <= 0) {
        console.error('whatsapp graph estourou o prazo total na consulta de status')
        return falha('whatsapp_indisponivel')
      }
      const busca = await buscar(url, undefined, restante)
      if (!busca.ok) return busca
      const r = busca.valor

      if (r.status >= 500) {
        console.error('whatsapp graph indisponivel', r.status)
        return falha('whatsapp_indisponivel')
      }
      const dados = (await r.json().catch(() => ({}))) as RespostaStatus
      // 4xx com corpo de erro, ou 200 em formato inesperado (sem "data" como
      // array): nenhum codigo mais especifico foi definido para este caso, so
      // "zero resultados" (abaixo) e rede/5xx (acima) tem traducao propria.
      if (!r.ok || dados.error || !Array.isArray(dados.data)) {
        console.error('whatsapp graph recusou consulta de status', r.status, dados.error?.code, dados.error?.message)
        return falha('whatsapp_indisponivel')
      }
      // Match EXATO de nome — o mesmo cuidado de posseDaPagina em meta-real.ts
      // (que compara o id devolvido em vez de confiar so no que foi pedido).
      // Sem este `find`, uma resposta cuja primeira linha e de outro template
      // levaria silenciosamente o status errado para a tela.
      const item = dados.data.find((t) => t.name === nome)
      if (item) {
        // O Graph devolve rejected_reason: 'NONE' quando o template nao foi
        // rejeitado — 'NONE' na tela seria pior que nulo, entao normaliza para
        // null junto com o caso de campo ausente.
        const motivo =
          item.rejected_reason && item.rejected_reason !== 'NONE' ? item.rejected_reason : null
        return ok({ status: (item.status ?? '').toLowerCase(), motivo })
      }

      const proxima = dados.paging?.next
      // Fim das paginas sem match: agora sim "nao existe" e afirmacao provada.
      if (!proxima) return falha('template_nao_encontrado')
      try {
        url = new URL(proxima)
      } catch {
        console.error('whatsapp graph paging.next malformado na consulta de status')
        return falha('whatsapp_indisponivel')
      }
    }
    // Teto atingido com paginas restantes: "nao encontrado" seria afirmacao
    // sem prova, e a tela trata indisponivel como transitorio — que e o que
    // isso e.
    console.error('whatsapp graph paginacao excedida na consulta de status')
    return falha('whatsapp_indisponivel')
  }

  async apagarTemplate(token: string, wabaId: string, nome: string): Promise<Resultado<void>> {
    const url = new URL(`${BASE}/${wabaId}/message_templates`)
    url.searchParams.set('name', nome)
    url.searchParams.set('access_token', token)

    const busca = await buscar(url, { method: 'DELETE' })
    if (!busca.ok) return busca
    const r = busca.valor

    if (r.status >= 500) {
      console.error('whatsapp graph indisponivel', r.status)
      return falha('whatsapp_indisponivel')
    }
    const dados = (await r.json().catch(() => ({}))) as RespostaApagar
    if (!r.ok || dados.error) {
      console.error('whatsapp graph recusou remocao', r.status, dados.error?.code, dados.error?.message)
      return falha('whatsapp_indisponivel')
    }
    return ok(undefined)
  }

  async enviarTemplate(
    token: string,
    phoneNumberId: string,
    e164Destino: string,
    d: { nome: string; idioma: string; valores: string[] },
  ): Promise<Resultado<{ idMensagem: string }>> {
    const url = new URL(`${BASE}/${phoneNumberId}/messages`)
    url.searchParams.set('access_token', token)

    // A chave `components` so entra quando ha valor para mandar: o Graph
    // REJEITA `parameters: []` (erro #100, "Invalid parameter"), e template sem
    // variavel nenhuma — que e' template legitimo e comum, um aviso fixo — deve
    // ir SEM components. Montado fora do JSON.stringify de proposito: um
    // `components: undefined` inline seria omitido pelo stringify hoje e
    // sobreviveria a qualquer refatoracao que troque o serializador por um que
    // emita `null`. Sem esta guarda, todo envio de template sem placeholder
    // falharia para sempre com 'envio_recusado', e a tela nao teria como
    // explicar por que.
    const template: {
      name: string
      language: { code: string }
      components?: { type: string; parameters: { type: string; text: string }[] }[]
    } = {
      name: d.nome,
      language: { code: d.idioma },
    }
    if (d.valores.length > 0) {
      template.components = [
        {
          type: 'body',
          parameters: d.valores.map((v) => ({ type: 'text', text: v })),
        },
      ]
    }

    const busca = await buscar(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        // Sem "+" — mesmo formato que o link wa.me usa.
        to: e164Destino.replace(/^\+/, ''),
        type: 'template',
        template,
      }),
    })
    if (!busca.ok) return busca
    const r = busca.valor

    if (r.status >= 500) {
      console.error('whatsapp graph indisponivel', r.status)
      return falha('whatsapp_indisponivel')
    }
    const dados = (await r.json().catch(() => ({}))) as RespostaEnvio
    // 4xx com corpo de erro: o Graph recusou o envio (ex.: template nao
    // aprovado).
    if (!r.ok || dados.error) {
      console.error('whatsapp graph recusou envio', r.status, dados.error?.code, dados.error?.message)
      return falha('envio_recusado')
    }
    const idMensagem = dados.messages?.[0]?.id
    // 200 sem "error" mas sem o id da mensagem e formato inesperado, nao
    // recusa — e crucial nao rotular isso de "recusado": a mensagem pode ja
    // ter sido enviada do lado do Meta, e um reenvio duplicaria o disparo.
    if (!idMensagem) {
      console.error('whatsapp graph formato inesperado no envio', r.status)
      return falha('whatsapp_indisponivel')
    }
    return ok({ idMensagem })
  }
}
