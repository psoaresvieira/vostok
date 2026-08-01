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
 * mostra sobre uma entrega de integration_log. `erro` carrega codigos
 * estaveis, nunca texto livre do provedor: os que o banco escreve direto
 * (fonte_nao_encontrada, chave_invalida, lead_de_teste — 0010/0011), os que
 * processar.ts e MetaGraphReal registram via registrar_falha
 * (token_ausente, leadgen_id_ausente, meta_indisponivel), e um fallback raro
 * com a mensagem crua de excecao do Postgres quando codigoDoErro
 * (lib/data/ingestao.ts) nao reconhece o codigo — truncada em 500 chars por
 * registrar_falha, e tratada como cru na tela mesmo assim (ver o comentario
 * de mensagemDeErro em config/entregas.tsx). registrar_falha nunca recebe
 * texto livre do provedor: achado corrigido de uma rodada anterior do
 * review, este comentario presumia o contrario. payload_bruto nunca aparece
 * aqui: esta fora do grant da 0009 e o painel nao precisa dele.
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
