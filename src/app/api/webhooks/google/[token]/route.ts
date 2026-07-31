import { after, type NextRequest } from 'next/server'
import { criarIngestaoStore, type EntregaParaProcessar } from '@/lib/data/ingestao'
import { processarEntrega } from '@/lib/ingestao/processar'
import { metaGraph } from '@/lib/integracoes/fabrica'

type RotaComToken = { params: Promise<{ token: string }> }

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

  let corpo: unknown
  try {
    corpo = JSON.parse(await req.text())
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

  // Responde 200 ANTES de qualquer processamento: o Google nao pode ficar
  // esperando, e o payload ja esta gravado (reprocessavel pelo cron mesmo se
  // o mapeamento falhar).
  const resposta = new Response(null, { status: 200 })

  if (!resultado.ok) {
    // Uma entrega que falha ao registrar nao pode virar 500: diferente do
    // store indisponivel, aqui o lead JA foi tentado, e o Google so retenta
    // 5xx -- o mesmo corpo tortuoso voltaria para sempre. Fica so o log.
    console.error('webhook google: registrarEntrega falhou', resultado.erro, leadId)
    return resposta
  }

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
