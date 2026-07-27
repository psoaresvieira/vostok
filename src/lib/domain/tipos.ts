export type Papel = 'admin' | 'gestor' | 'vendedor'
export type StageTipo = 'aberta' | 'ganho' | 'perdido'
export type LeadStatus = 'aberto' | 'ganho' | 'perdido'
export type LeadOrigem = 'meta' | 'google' | 'manual' | 'indicacao' | 'organico'

export type Conta = { id: string; nome: string }

export type Perfil = { id: string; nome: string; email: string }

export type Membro = Perfil & { papel: Papel }

export type Pipeline = { id: string; nome: string; isDefault: boolean }

export type Etapa = {
  id: string
  pipelineId: string
  nome: string
  ordem: number
  tipo: StageTipo
  slaHoras: number | null
}

export type MotivoPerda = { id: string; nome: string; ativo: boolean }

export type Etiqueta = { id: string; nome: string }

export type Lead = {
  id: string
  accountId: string
  nome: string
  telefone: string | null
  telefoneE164: string | null
  email: string | null
  emailNorm: string | null
  empresa: string | null
  origem: LeadOrigem
  pipelineId: string
  stageId: string
  responsavelId: string | null
  status: LeadStatus
  valorCents: number | null
  lossReasonId: string | null
  entrouNaEtapaEm: Date
  criadoEm: Date
  atualizadoEm: Date
  etiquetas: Etiqueta[]
}

export type EventoLead = {
  id: string
  leadId: string
  tipo: string
  payload: Record<string, unknown>
  atorId: string | null
  criadoEm: Date
}
