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

  metricasDaCoorte(f: FiltroMetricas): Promise<Resultado<LinhaCoorte[]>>
  etiquetasDaCoorte(f: FiltroMetricas): Promise<Resultado<AplicacaoEtiqueta[]>>
}
