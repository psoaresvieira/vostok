import { after, type NextRequest } from 'next/server'
import { criarIngestaoStore, type EntregaParaProcessar } from '@/lib/data/ingestao'
import { assinaturaValida } from '@/lib/ingestao/hmac'
import { processarEntrega } from '@/lib/ingestao/processar'
import { metaGraph } from '@/lib/integracoes/fabrica'

/**
 * Desafio de inscricao do webhook (feito uma vez, no painel do Meta).
 * `hub.challenge` volta como TEXTO PURO -- o Meta compara byte a byte, e
 * `NextResponse.json(challenge)` embrulharia em aspas e reprovaria a
 * verificacao.
 *
 * Falha fechado: sem META_VERIFY_TOKEN configurado no servidor, 403 sempre,
 * mesmo que o chamador tambem mande verify_token vazio tentando bater com o
 * env vazio por coincidencia.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const esperado = process.env.META_VERIFY_TOKEN ?? ''
  const recebido = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (esperado.length === 0 || recebido !== esperado || challenge === null) {
    return new Response(null, { status: 403 })
  }
  return new Response(challenge, { status: 200 })
}

type ChangeDoMeta = { field?: unknown; value?: unknown }
type EntryDoMeta = { changes?: unknown }

export async function POST(req: NextRequest) {
  // Corpo CRU, e ele sozinho vai para a verificacao de assinatura -- nunca
  // `req.json()` reserializado. Reserializar muda ordem de chave, espacamento
  // e escapes; os bytes deixam de bater com os que o Meta assinou, e a
  // assinatura nunca mais valida. E a falha classica desta integracao: 401
  // em 100% dos webhooks legitimos, nao um caso raro.
  const cru = await req.text()
  if (!assinaturaValida(cru, req.headers.get('x-hub-signature-256'), process.env.META_APP_SECRET ?? '')) {
    return new Response(null, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = JSON.parse(cru)
  } catch {
    // So depois da assinatura ter passado: JSON invalido de um chamador que
    // ja provou conhecer o App Secret nunca vai virar valido em retentativa,
    // e um 500 aqui faria o Meta reenviar em rajada.
    return new Response(null, { status: 200 })
  }

  const store = criarIngestaoStore()
  if (!store.ok) {
    // Diferente do corpo invalido: aqui a culpa e nossa (env var ausente) e
    // e transitoria. 200 diria ao Meta "recebido e guardado" para um lote
    // que foi jogado fora inteiro -- e o Meta nunca reenvia um 200. 500 faz
    // o Meta retentar por horas, o suficiente para o operador corrigir o
    // env e os leads sobreviverem. Loga o codigo: e o unico rastro que essa
    // falha deixa, porque nada foi gravado em integration_log.
    console.error('webhook meta: store de ingestao indisponivel', store.erro)
    return new Response(null, { status: 500 })
  }
  const ingestao = store.valor

  const entries = Array.isArray((corpo as { entry?: unknown })?.entry)
    ? ((corpo as { entry: EntryDoMeta[] }).entry)
    : []

  const pendentes: EntregaParaProcessar[] = []
  // true quando ALGUMA entrega do lote falhou ao registrar por um motivo que
  // nao e external_id_invalido -- ver o `if` dentro do loop, que decide qual
  // e qual.
  let falhaTransitoria = false
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? (entry.changes as ChangeDoMeta[]) : []
    for (const change of changes) {
      // O mesmo webhook do Meta entrega outros campos (comentarios,
      // mensagens etc); tratar qualquer um deles como lead criaria card de
      // nada.
      if (change.field !== 'leadgen') continue
      if (typeof change.value !== 'object' || change.value === null) continue
      const valor = change.value as Record<string, unknown>
      const leadgenId = typeof valor.leadgen_id === 'string' ? valor.leadgen_id : ''
      const pageId = typeof valor.page_id === 'string' ? valor.page_id : ''

      if (leadgenId === '') {
        // Sem leadgen_id nao ha o que registrar: a RPC recusaria com
        // external_id_invalido de qualquer forma, so depois de ja ter
        // gravado a tentativa. Loga aqui, antes de gastar a chamada.
        console.error('webhook meta: leadgen_id ausente no payload', pageId)
        continue
      }

      // Uma entrega que falhe ao registrar nao pode derrubar as outras do
      // mesmo lote: registrarEntrega devolve Resultado, nunca lanca, entao o
      // loop segue por conta propria para o proximo change. Mas a falha nao
      // pode ficar muda -- sem log ela some sem rastro nenhum (nem
      // integration_log tem linha, e exatamente isso que falhou em gravar).
      const resultado = await ingestao.registrarEntrega({
        provedor: 'meta',
        externalId: leadgenId,
        payload: valor,
        chaveDaFonte: pageId,
      })
      if (!resultado.ok) {
        console.error('webhook meta: registrarEntrega falhou', resultado.erro, leadgenId)
        // external_id_invalido e a RPC recusando ANTES de gravar por um
        // corpo que nunca vai ficar valido em retentativa (leadgenId ja foi
        // provado nao-vazio acima) -- reenviar bateria na mesma recusa para
        // sempre, 200 e o certo. Qualquer outro erro (banco inalcancavel,
        // pool esgotado, PostgREST fora do ar) e transitorio: NADA foi
        // gravado para esta entrega, e 200 diria ao Meta "recebido e
        // guardado" para um lead que sumiu com so este console.error atras
        // -- o Meta nunca reenvia um 200, so retenta em cima de 5xx.
        if (resultado.erro !== 'external_id_invalido') falhaTransitoria = true
        continue
      }
      if (resultado.valor.status === 'pendente' && resultado.valor.logId) {
        pendentes.push({
          logId: resultado.valor.logId,
          provedor: 'meta',
          payload: valor,
          token: resultado.valor.token,
        })
      }
    }
  }

  if (falhaTransitoria) {
    // 500 faz o Meta reenviar o LOTE inteiro, nao so a entrega que falhou --
    // o Meta nao tem como pedir so uma parte de volta. Isso e seguro para as
    // entregas que ja registraram nesta mesma passada: o indice unico
    // (provedor, external_id) da 0009 faz o reenvio delas bater em
    // 'duplicado' (registrar_entrega, 0010), sem criar card duplicado nem
    // reprocessar de novo. So a entrega que falhou ganha uma chance real de
    // gravar na proxima tentativa.
    return new Response(null, { status: 500 })
  }

  // Responde 200 ANTES de qualquer chamada externa: o provedor nao pode
  // ficar esperando o Graph API, e o payload ja esta gravado (reprocessavel
  // pelo cron mesmo que o mapeamento falhe).
  const resposta = new Response(null, { status: 200 })

  const graph = metaGraph()
  after(async () => {
    await Promise.all(pendentes.map((entrega) => processarEntrega(entrega, { ingestao, graph })))
  })

  return resposta
}
