import type { Resultado } from '@/lib/domain/resultado'
import type { NovoLead } from '@/lib/domain/lead'
import type { AplicacaoEtiqueta, LinhaCoorte } from '@/lib/domain/metricas'
import type {
  ColunaDoFunil,
  Conta,
  Etapa,
  Etiqueta,
  EventoLead,
  Lead,
  Membro,
  MotivoPerda,
  Perfil,
  Pipeline,
} from '@/lib/domain/tipos'

export type FiltroLeads = {
  responsavelId?: string | null
  origem?: Lead['origem'] | null
  desde?: Date | null
  busca?: string | null
  pipelineId?: string | null
  /**
   * Teto de linhas. Existe porque quem chama `listarLeads` sempre teve um: o
   * painel de disparo lia a conta inteira para mostrar 8 resultados, e o
   * recorte acontecia em JS depois de o banco ja ter montado e serializado
   * tudo.
   */
  limite?: number | null
}

/**
 * O que o quadro do funil pede: uma pagina POR ETAPA, nao a pipeline inteira.
 *
 * `etapaId` recorta a uma unica coluna — e' o "carregar mais" de uma coluna
 * so', que nao pode repaginar as outras.
 */
export type FiltroFunil = Omit<FiltroLeads, 'limite' | 'pipelineId'> & {
  pipelineId: string
  etapaId?: string | null
  limite: number
  offset?: number
}

export type FiltroMetricas = {
  pipelineId: string
  /** Inclusivo. */
  de: Date
  /** EXCLUSIVO: dois periodos adjacentes nao contam o mesmo lead duas vezes. */
  ate: Date
  responsavelId?: string | null
}

export interface CrmStore {
  contaAtiva(): Promise<Resultado<Conta | null>>
  membros(): Promise<Resultado<Membro[]>>
  /** O perfil do usuario logado. Ver a nota em SupabaseCrmStore.perfilAtual. */
  perfilAtual(): Promise<Resultado<Perfil | null>>
  pipelinePadrao(): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>>
  listarPipelines(): Promise<Resultado<Pipeline[]>>
  pipelinePorId(pipelineId: string): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>>
  criarPipeline(nome: string, etapasAbertas: string[]): Promise<Resultado<string>>
  renomearPipeline(pipelineId: string, nome: string): Promise<Resultado<void>>
  excluirPipeline(pipelineId: string): Promise<Resultado<void>>
  motivosPerda(): Promise<Resultado<MotivoPerda[]>>

  listarLeads(filtro: FiltroLeads): Promise<Resultado<Lead[]>>
  /**
   * Os cartoes do quadro, paginados por etapa, com total e soma da coluna
   * inteira. Ver `ColunaDoFunil`.
   */
  leadsDoFunil(filtro: FiltroFunil): Promise<Resultado<ColunaDoFunil[]>>
  buscarLead(leadId: string): Promise<Resultado<Lead | null>>
  criarLead(
    dados: NovoLead & { pipelineId: string; stageId: string },
  ): Promise<Resultado<string>>
  possiveisDuplicados(
    telefoneE164: string | null,
    emailNorm: string | null,
  ): Promise<Resultado<Lead[]>>
  moverEtapa(
    leadId: string,
    stageDestino: string,
    lossReasonId?: string | null,
  ): Promise<Resultado<void>>
  atribuirResponsavel(leadId: string, responsavelId: string | null): Promise<Resultado<void>>

  etiquetasDaConta(): Promise<Resultado<Etiqueta[]>>
  aplicarEtiquetas(leadId: string, nomes: string[]): Promise<Resultado<void>>
  /**
   * Desfaz UMA aplicacao de etiqueta no lead. Idempotente: remover o que nao
   * esta aplicado e ok silencioso (o chip ja sumiu da tela; um erro aqui so
   * ensinaria o usuario a ignorar erro). A linha de `tags` fica — o catalogo
   * de sugestoes da conta nao encolhe porque um lead desmarcou. A aplicacao
   * sai da metrica de etiquetas por etapa (e o uso correto: desfazer marcacao
   * errada), mas a timeline guarda o evento `etiqueta_removida`.
   */
  removerEtiqueta(leadId: string, tagId: string): Promise<Resultado<void>>

  /**
   * A timeline do lead, mais recente primeiro. `limite` opcional porque a
   * ficha nunca desenhou mais que uma janela: um lead antigo com centenas de
   * eventos serializava todos eles no payload da pagina para mostrar uma
   * lista que ninguem rola ate o fim.
   */
  eventosDoLead(leadId: string, limite?: number): Promise<Resultado<EventoLead[]>>
  registrarNota(leadId: string, texto: string): Promise<Resultado<void>>
  /**
   * Evento `whatsapp_enviado` da ficha do lead. Vive no store — e nao num
   * `.from('lead_events')` dentro da Server Action — pela mesma razao de
   * `SupabaseTarefaStore.concluir`: neste repo a camada de acoes nunca fala
   * PostgREST direto. O payload e' SNAPSHOT do que o cliente recebeu (nome do
   * template no Meta e texto ja preenchido), porque o script pode ser editado e
   * o template re-submetido depois — e a historia do lead nao pode passar a
   * contar outra versao do que foi dito.
   */
  registrarEnvioWhatsApp(
    leadId: string,
    d: { template: string; texto: string },
  ): Promise<Resultado<void>>

  metricasDaCoorte(f: FiltroMetricas): Promise<Resultado<LinhaCoorte[]>>
  etiquetasDaCoorte(f: FiltroMetricas): Promise<Resultado<AplicacaoEtiqueta[]>>
}
