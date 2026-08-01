import { after, type NextRequest } from 'next/server'
import { criarIngestaoStore, type EntregaParaProcessar } from '@/lib/data/ingestao'
import { processarEntrega } from '@/lib/ingestao/processar'
import { metaGraph } from '@/lib/integracoes/fabrica'

type RotaComToken = { params: Promise<{ token: string }> }

/** 256 KiB e generoso para um formulario de lead (Achado 5 do review final).
 * Diferente do Meta, esta rota nao tem prova de origem antes de gravar --
 * so o segredo dentro de registrar_entrega, e esse so entra depois que a
 * conta ja foi resolvida. Um corpo grande demais viraria payload_bruto
 * gigante gravado em integration_log sem limite, sem rate limit, e sem dono
 * (account_id fica nulo pra fonte desconhecida) -- disk-fill contra um banco
 * compartilhado por todo tenant. */
const LIMITE_CORPO_BYTES = 256 * 1024

/** Le o corpo respeitando LIMITE_CORPO_BYTES sem nunca bufferizar mais do que
 * isso mais um chunk: `req.text()` sozinho ja teria lido o corpo inteiro na
 * memoria antes de qualquer checagem, o que so resolve a metade do problema
 * (a linha em integration_log) e nao a outra (o handler aceitando um corpo
 * arbitrariamente grande na memoria do processo). */
async function lerCorpoLimitado(req: NextRequest): Promise<{ ok: true; texto: string } | { ok: false }> {
  const reader = req.body?.getReader()
  if (!reader) return { ok: true, texto: await req.text() }

  const decoder = new TextDecoder()
  let texto = ''
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > LIMITE_CORPO_BYTES) {
      await reader.cancel()
      return { ok: false }
    }
    texto += decoder.decode(value, { stream: true })
  }
  texto += decoder.decode()
  return { ok: true, texto }
}

/**
 * Webhook do Google Ads (lead form extensions). Diferente do Meta: um
 * request carrega um lead so, sem lote, e nao ha assinatura para verificar --
 * quem autoriza e' o token secreto do caminho. A conferencia do `google_key`
 * do corpo acontece DENTRO de `registrar_entrega` (migration 0010), no mesmo
 * lugar que resolve a conta pelo hash do token: duplicar essa conferencia
 * aqui criaria duas copias que divergem, e so a de dentro do banco enxerga o
 * hash guardado.
 *
 * O token nunca entra na resposta, em nenhum branch -- e o segredo que
 * resolve a conta, e a rota so devolve `Response(null, ...)` em todo caminho
 * por isso mesmo (nunca ecoa params, corpo ou erro no texto da resposta).
 */
export async function POST(req: NextRequest, { params }: RotaComToken) {
  const { token } = await params

  const lido = await lerCorpoLimitado(req)
  if (!lido.ok) {
    // 413, nunca 200/500: corpo grande demais nao e falha transitoria nem
    // sucesso, e' o chamador mandando algo fora do que um formulario de lead
    // jamais produz. Nada foi gravado.
    return new Response(null, { status: 413 })
  }

  let corpo: unknown
  try {
    corpo = JSON.parse(lido.texto)
  } catch {
    // Corpo torto de um chamador que ja tem o token certo (ele so chega aqui
    // com a rota resolvida) nunca vira valido em retentativa, e 500 faria o
    // Google marcar a integracao como quebrada e martelar reenvios.
    return new Response(null, { status: 200 })
  }

  const store = criarIngestaoStore()
  if (!store.ok) {
    // Diferente do corpo invalido: aqui a culpa e nossa (env var ausente) e
    // e transitoria. 200 diria ao Google "recebido e guardado" para um lead
    // que foi jogado fora -- e o Google nunca reenvia um 200. 500 faz o
    // Google retentar, o suficiente para o operador corrigir o env antes do
    // lead se perder. Loga o codigo: e o unico rastro que essa falha deixa,
    // porque nada foi gravado em integration_log.
    console.error('webhook google: store de ingestao indisponivel', store.erro)
    return new Response(null, { status: 500 })
  }
  const ingestao = store.valor

  const objeto = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {}
  const leadId = typeof objeto.lead_id === 'string' ? objeto.lead_id : ''

  if (leadId === '') {
    // Sem lead_id nao ha external_id, e sem external_id nao ha chave de
    // idempotencia: inventar uma faria um reenvio do mesmo lead virar card
    // duplicado. A RPC recusaria com external_id_invalido de qualquer forma,
    // so depois de ja ter gravado a tentativa -- melhor nem chamar.
    return new Response(null, { status: 200 })
  }

  const googleKey = typeof objeto.google_key === 'string' ? objeto.google_key : null

  // registrar_entrega decide sozinha se a fonte existe, se e' lead de teste
  // (is_test) e se google_key bate com o hash guardado -- em qualquer desses
  // casos ela devolve sucesso com status 'ignorado', nunca erro. Um 404 aqui
  // seria oraculo de quais tokens de URL estao ativos.
  const resultado = await ingestao.registrarEntrega({
    provedor: 'google',
    externalId: leadId,
    payload: objeto,
    chaveDaFonte: token,
    googleKey,
  })

  if (!resultado.ok) {
    console.error('webhook google: registrarEntrega falhou', resultado.erro, leadId)
    // external_id_invalido e a RPC recusando ANTES de gravar por um corpo que
    // nunca vai ficar valido em retentativa: leadId ja passou pelo guard de
    // string vazia acima, mas ainda pode ser so espaco em branco (a RPC faz
    // btrim; esta checagem aqui nao) -- 200 e o certo, reenviar bateria na
    // mesma recusa para sempre. Qualquer outro erro (banco inalcancavel, pool
    // esgotado, PostgREST fora do ar) e transitorio: NADA foi gravado, e 200
    // diria ao Google "recebido e guardado" para um lead que sumiu com so
    // este console.error atras. 500 faz o Google retentar (ele so retenta em
    // cima de 5xx), a tempo do operador corrigir o que quer que tenha caido.
    const status = resultado.erro === 'external_id_invalido' ? 200 : 500
    return new Response(null, { status })
  }

  // Responde 200 ANTES de qualquer processamento: o Google nao pode ficar
  // esperando, e o payload ja esta gravado (reprocessavel pelo cron mesmo se
  // o mapeamento falhar).
  const resposta = new Response(null, { status: 200 })

  if (resultado.valor.status === 'pendente' && resultado.valor.logId) {
    const entrega: EntregaParaProcessar = {
      logId: resultado.valor.logId,
      provedor: 'google',
      payload: objeto,
      token: resultado.valor.token,
    }
    const graph = metaGraph()
    after(async () => {
      await processarEntrega(entrega, { ingestao, graph })
    })
  }

  return resposta
}
