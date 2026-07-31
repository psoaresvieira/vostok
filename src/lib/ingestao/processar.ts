import { falha, ok, type Resultado } from '@/lib/domain/resultado'
import type { EntregaParaProcessar, IngestaoStore } from '@/lib/data/ingestao'
import type { MetaGraph } from '@/lib/integracoes/meta'
import type { DadosDoLead } from './dados'
import { mapearLeadDoGoogle } from './mapear-google'
import { mapearLeadDoMeta } from './mapear-meta'

/** Le uma chave string do payload cru do webhook. Payload de terceiro, sem
 * schema garantido em compilacao -- toda leitura confere o tipo antes de
 * usar, igual aos mapeadores (Task 6). */
function textoDoPayload(payload: Record<string, unknown>, chave: string): string | null {
  const v = payload[chave]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Chama ingerirLead e converte falha em registrarFalha (transacao
 * separada). Contrato da Task 4 (migration 0011): todo `raise` de
 * ingerir_lead aborta a transacao inteira sem incrementar `tentativas` nem
 * carimbar `ultima_tentativa_em` -- sem este passo em transacao a parte,
 * uma entrega quebrada seria varrida pelo cron para sempre, sem backoff e
 * sem desistencia (0010, entregas_pendentes).
 *
 * `ja_processado` NAO cai aqui como falha: `ingerirLead` devolve `ok` com
 * esse status, e o caminho normal e' so devolver sucesso. Registra-lo como
 * falha subiria o contador de tentativas sozinho ate o give-up, para uma
 * entrega que ja tinha resolvido -- o caminho normal de uma corrida entre o
 * after() da rota e a varredura do cron sobre a mesma linha.
 */
async function ingerirOuFalhar(
  ingestao: IngestaoStore,
  logId: string,
  dados: DadosDoLead,
): Promise<Resultado<void>> {
  const resultado = await ingestao.ingerirLead(logId, dados)
  if (!resultado.ok) {
    await ingestao.registrarFalha(logId, resultado.erro)
    return falha(resultado.erro)
  }
  return ok(undefined)
}

/**
 * Caminho unico de processamento de uma entrega, chamado pela rota (via
 * after()) e pelo cron de reprocessamento (Task 9) -- por isso recebe as
 * dependencias como argumento em vez de montar IngestaoStore/MetaGraph
 * sozinha: testavel com InMemoryIngestaoStore + MetaGraphFalso, sem banco e
 * sem rede.
 *
 * Ordem, e ela e o entregavel: Graph (so no Meta) -> mapeia -> campanha
 * best-effort -> ingerirLead. Qualquer falha antes de ingerirLead termina em
 * registrarFalha e retorna -- nunca ingere com dado pela metade.
 */
export async function processarEntrega(
  e: EntregaParaProcessar,
  deps: { ingestao: IngestaoStore; graph: MetaGraph },
): Promise<Resultado<void>> {
  if (e.provedor === 'google') {
    // O payload do Google ja traz tudo (user_column_data): sem chamada
    // externa nenhuma, ao contrario do Meta.
    const dados = mapearLeadDoGoogle(e.payload)
    return ingerirOuFalhar(deps.ingestao, e.logId, dados)
  }

  // Sem token e configuracao quebrada (fonte sem credencial de Page), nunca
  // payload malformado -- por isso vira falha, e nao ignorado em silencio.
  // Sem este guard, buscarLead bateria no Graph com credencial vazia.
  if (!e.token) {
    await deps.ingestao.registrarFalha(e.logId, 'token_ausente')
    return falha('token_ausente')
  }

  // Sem leadgen_id nao ha o que buscar: chamar o Graph com id vazio devolve
  // 400 real, que sem este guard vira o generico 'meta_indisponivel' (o
  // codigo de erro de rede/HTTP do double e do cliente real) e esconde o
  // diagnostico verdadeiro do operador.
  const leadgenId = textoDoPayload(e.payload, 'leadgen_id')
  if (!leadgenId) {
    await deps.ingestao.registrarFalha(e.logId, 'leadgen_id_ausente')
    return falha('leadgen_id_ausente')
  }
  const resultadoBusca = await deps.graph.buscarLead(leadgenId, e.token)
  if (!resultadoBusca.ok) {
    await deps.ingestao.registrarFalha(e.logId, resultadoBusca.erro)
    return falha(resultadoBusca.erro)
  }
  const lead = resultadoBusca.valor

  // Mapeia com o ad_id cru como campanha de partida: e o fallback que a
  // etapa "campanha e best-effort" abaixo promete quando a segunda chamada
  // falhar, ou nem rodar (sem ad_id).
  const dados = mapearLeadDoMeta(lead, { campanha: lead.adId, formulario: lead.formId })

  if (lead.adId) {
    const resultadoCampanha = await deps.graph.campanhaDoAnuncio(lead.adId, e.token)
    // So promove o nome real por cima do ad_id cru se a chamada deu certo.
    // Falha aqui nunca vira registrarFalha: nenhum lead se perde por causa
    // do nome da campanha.
    if (resultadoCampanha.ok) dados.campanhaOrigem = resultadoCampanha.valor
  }

  return ingerirOuFalhar(deps.ingestao, e.logId, dados)
}
