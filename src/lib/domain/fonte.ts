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
