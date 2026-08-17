import type { Resultado } from '@/lib/domain/resultado'
import type { NovoLead } from '@/lib/domain/lead'
import type { AplicacaoEtiqueta, LinhaCoorte } from '@/lib/domain/metricas'
import type {
  Conta,
  Etapa,
  Etiqueta,
  EventoLead,
  Lead,
  Membro,
  MotivoPerda,
  Pipeline,
} from '@/lib/domain/tipos'

export type FiltroLeads = {
  responsavelId?: string | null
  origem?: Lead['origem'] | null
  desde?: Date | null
  busca?: string | null
  pipelineId?: string | null
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
  pipelinePadrao(): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>>
  listarPipelines(): Promise<Resultado<Pipeline[]>>
  pipelinePorId(pipelineId: string): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>>
  criarPipeline(nome: string, etapasAbertas: string[]): Promise<Resultado<string>>
  renomearPipeline(pipelineId: string, nome: string): Promise<Resultado<void>>
  excluirPipeline(pipelineId: string): Promise<Resultado<void>>
  motivosPerda(): Promise<Resultado<MotivoPerda[]>>

  listarLeads(filtro: FiltroLeads): Promise<Resultado<Lead[]>>
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

  eventosDoLead(leadId: string): Promise<Resultado<EventoLead[]>>
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
