import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { DadosDoNumero, WhatsAppGraph } from './whatsapp'

/**
 * Test double do WhatsAppGraph, na forma de MetaGraphFalso: mapa de dados
 * cadastrados por phoneNumberId, conjunto de tokens aceitos, e registro de
 * chamadas para os testes afirmarem sobre o estado do duplo — nunca spy.
 */
export class WhatsAppGraphFalso implements WhatsAppGraph {
  /** Dados devolvidos por phoneNumberId, semeados pelos testes. */
  readonly numeros: Map<string, DadosDoNumero> = new Map()
  /** Tokens que a falsa aceita. Fora daqui, toda consulta e recusada. */
  readonly tokensAceitos: Set<string> = new Set()
  /**
   * Toda chamada a `dadosDoNumero`, inclusive as recusadas — o registro
   * existe para provar que a chamada aconteceu, mesmo quando o resultado e
   * falha. Asercao sobre o estado do duplo, e nao espionagem da chamada.
   */
  readonly consultados: { token: string; phoneNumberId: string }[] = []

  reiniciar(): void {
    this.numeros.clear()
    this.tokensAceitos.clear()
    this.consultados.length = 0
  }

  async dadosDoNumero(token: string, phoneNumberId: string): Promise<Resultado<DadosDoNumero>> {
    this.consultados.push({ token, phoneNumberId })
    if (!this.tokensAceitos.has(token)) return falha('token_whatsapp_invalido')
    const dados = this.numeros.get(phoneNumberId)
    if (!dados) return falha('token_whatsapp_invalido')
    return ok({ ...dados })
  }
}
