export type Provedor = 'meta' | 'google'

export type Fonte = {
  id: string
  provedor: Provedor
  /** page_id no Meta; sempre nulo no Google, que se identifica pela URL. */
  externalId: string | null
  nome: string
  responsavelPadraoId: string | null
  ativo: boolean
  criadoEm: Date
}

/** Espelha public.status_entrega (migration 0009). */
export type StatusEntrega = 'pendente' | 'processado' | 'ignorado' | 'falhou'

/**
 * Uma linha do painel de diagnostico da tela de Integracoes: o que o painel
 * mostra sobre uma entrega de integration_log. `erro` carrega tanto codigos
 * estaveis que o banco escreve (fonte_nao_encontrada, chave_invalida,
 * lead_de_teste — 0010/0011) quanto texto livre truncado do provedor
 * (registrar_falha). payload_bruto nunca aparece aqui: esta fora do grant da
 * 0009 e o painel nao precisa dele.
 */
export type Entrega = {
  id: string
  provedor: Provedor
  externalId: string
  status: StatusEntrega
  erro: string | null
  tentativas: number
  leadId: string | null
  criadoEm: Date
  processadoEm: Date | null
}
