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

/**
 * O lead como o CARTAO do funil precisa dele — e nada mais.
 *
 * O quadro carregava `Lead` inteiro: email, email_norm, telefone cru,
 * empresa, origem, status, loss_reason_id, criado_em, atualizado_em,
 * account_id, pipeline_id. Nenhum desses campos aparece no cartao, e todos
 * eles atravessavam o banco, o payload RSC e a memoria do navegador
 * multiplicados pelo numero de leads da pipeline.
 *
 * Manter um tipo proprio (em vez de `Pick<Lead, ...>`) e' de proposito: o dia
 * em que `Lead` ganhar um campo caro, o cartao nao o herda sem alguem
 * decidir.
 */
export type LeadDoFunil = {
  id: string
  nome: string
  stageId: string
  responsavelId: string | null
  valorCents: number | null
  entrouNaEtapaEm: Date
  etiquetas: Etiqueta[]
}

/**
 * Uma coluna do quadro: a pagina de cartoes carregada, mais o total e a soma
 * da etapa INTEIRA — o cabecalho continua contando os leads todos mesmo com
 * so' a primeira pagina na tela.
 *
 * `somaCents` e' null quando nenhum lead da etapa tem valor preenchido, e nao
 * zero: "R$ 0,00" ali seria a afirmacao falsa de que os leads valem zero.
 */
export type ColunaDoFunil = {
  etapaId: string
  leads: LeadDoFunil[]
  total: number
  somaCents: number | null
}

export type EventoLead = {
  id: string
  leadId: string
  tipo: string
  payload: Record<string, unknown>
  atorId: string | null
  criadoEm: Date
}
