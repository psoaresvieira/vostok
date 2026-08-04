import type { Resultado } from '@/lib/domain/resultado'

/** O que o Meta diz sobre um numero de WhatsApp Business, direto do Graph. */
export type DadosDoNumero = { numeroExibicao: string; nomeVerificado: string }

/**
 * Prova, antes de gravar credencial nenhuma, que `token` de fato le
 * `phoneNumberId` no Graph. Port, e nao fetch espalhado, para que nenhum
 * teste automatizado (nem o E2E) toque a rede — mesma razao de existir que
 * `MetaGraph` em meta.ts.
 */
export interface WhatsAppGraph {
  /**
   * Prova que `token` le `phoneNumberId` e devolve o que o Meta diz sobre o
   * numero. Falhas viram codigo: 'token_whatsapp_invalido' (o Graph recusou a
   * credencial ou o id) ou 'whatsapp_indisponivel' (rede/5xx).
   */
  dadosDoNumero(token: string, phoneNumberId: string): Promise<Resultado<DadosDoNumero>>
}
