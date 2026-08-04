import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type {
  DadosDoNumero,
  StatusTemplate,
  TemplateSubmetido,
  WhatsAppGraph,
} from './whatsapp'

/** Estado de um template dentro da falsa — nasce approved (ver `submeterTemplate`). */
type TemplateFalso = {
  status: string
  motivo: string | null
  corpo: string
  categoria: 'marketing' | 'utility'
}

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

  /**
   * Estado dos templates, por nome — mutavel diretamente pelos testes (ex.:
   * `g.templates.set('x', { status: 'rejected', motivo: '...', ... })`) para
   * exercitar pending/rejected sem precisar de uma rota de seed.
   */
  readonly templates: Map<string, TemplateFalso> = new Map()
  /** Toda chamada a `submeterTemplate`, com todos os argumentos. */
  readonly submetidos: {
    token: string
    wabaId: string
    nome: string
    idioma: string
    categoria: 'marketing' | 'utility'
    corpo: string
  }[] = []
  /**
   * Toda chamada a `statusDoTemplate`. Nome distinto de `consultados`
   * (que ja e de `dadosDoNumero`, com outra forma) para nao colidir com ele.
   */
  readonly templatesConsultados: { token: string; wabaId: string; nome: string }[] = []
  /** Toda chamada a `apagarTemplate`, com todos os argumentos. */
  readonly apagados: { token: string; wabaId: string; nome: string }[] = []
  /** Toda chamada a `enviarTemplate`, inclusive as recusadas. */
  readonly enviados: {
    token: string
    phoneNumberId: string
    e164Destino: string
    nome: string
    valores: string[]
  }[] = []

  reiniciar(): void {
    this.numeros.clear()
    this.tokensAceitos.clear()
    this.consultados.length = 0
    this.templates.clear()
    this.submetidos.length = 0
    this.templatesConsultados.length = 0
    this.apagados.length = 0
    this.enviados.length = 0
  }

  async dadosDoNumero(token: string, phoneNumberId: string): Promise<Resultado<DadosDoNumero>> {
    this.consultados.push({ token, phoneNumberId })
    if (!this.tokensAceitos.has(token)) return falha('token_whatsapp_invalido')
    const dados = this.numeros.get(phoneNumberId)
    if (!dados) return falha('token_whatsapp_invalido')
    return ok({ ...dados })
  }

  async submeterTemplate(
    token: string,
    wabaId: string,
    d: { nome: string; idioma: string; categoria: 'marketing' | 'utility'; corpo: string },
  ): Promise<Resultado<TemplateSubmetido>> {
    this.submetidos.push({
      token,
      wabaId,
      nome: d.nome,
      idioma: d.idioma,
      categoria: d.categoria,
      corpo: d.corpo,
    })
    // Nasce approved de proposito: e o que deixa o E2E fluir sem rota de
    // seed. Testes de pending/rejected configuram `templates` diretamente.
    this.templates.set(d.nome, {
      status: 'approved',
      motivo: null,
      corpo: d.corpo,
      categoria: d.categoria,
    })
    return ok({ idMeta: `template-falso-${d.nome}`, status: 'approved' })
  }

  async statusDoTemplate(
    token: string,
    wabaId: string,
    nome: string,
  ): Promise<Resultado<StatusTemplate>> {
    this.templatesConsultados.push({ token, wabaId, nome })
    const t = this.templates.get(nome)
    if (!t) return falha('template_nao_encontrado')
    return ok({ status: t.status, motivo: t.motivo })
  }

  async apagarTemplate(token: string, wabaId: string, nome: string): Promise<Resultado<void>> {
    this.apagados.push({ token, wabaId, nome })
    this.templates.delete(nome)
    return ok(undefined)
  }

  async enviarTemplate(
    token: string,
    phoneNumberId: string,
    e164Destino: string,
    d: { nome: string; idioma: string; valores: string[] },
  ): Promise<Resultado<{ idMensagem: string }>> {
    this.enviados.push({
      token,
      phoneNumberId,
      e164Destino,
      nome: d.nome,
      valores: d.valores,
    })
    // Reproduz a ultima guarda do Graph: recusa template inexistente ou nao
    // aprovado, sem distinguir os dois casos (o Graph tambem nao distingue
    // na pratica — os dois viram "nao pode enviar isso").
    const t = this.templates.get(d.nome)
    if (!t || t.status !== 'approved') return falha('envio_recusado')
    return ok({ idMensagem: `wamid.falso-${this.enviados.length}` })
  }
}
