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
 * Credencial que a falsa aceita SEM semeadura, no mesmo espirito de
 * PAGINAS_PADRAO em meta-falso.ts: o E2E conecta o WhatsApp pela TELA de
 * /config, dentro do processo do `next dev`, e nao tem como alcancar o duplo
 * para semear `tokensAceitos`/`numeros` antes do clique. Sem um par padrao,
 * `dadosDoNumero` recusaria e nenhum percurso ponta a ponta de template ou
 * disparo seria possivel.
 *
 * Valores com `-falso-` no meio de proposito: se um dia aparecerem num painel
 * do Meta de verdade, a origem e' obvia. Os testes de unidade continuam
 * semeando os seus proprios tokens — este par nao substitui nenhum deles.
 */
export const TOKEN_FALSO_PADRAO = 'token-falso-padrao'
export const NUMERO_FALSO_PADRAO = {
  phoneNumberId: 'phone-number-id-falso',
  wabaId: 'waba-id-falso',
  numeroExibicao: '+55 11 90000-0000',
  nomeVerificado: 'Empresa Falsa',
}

/**
 * Segundo par padrao, para um SEGUNDO consumidor de E2E que tambem precisa
 * conectar o WhatsApp pela tela sem abrir mao do primeiro — mesmo motivo de
 * PAGINAS_PADRAO ter tres Pages em meta-falso.ts, e nao uma so'.
 * `whatsapp_connections_numero_idx` (0019:33) e' unico GLOBAL: dois specs que
 * conectam o MESMO numero, na MESMA rodada de `npm run test:e2e`, sem
 * desconectar entre um e outro, colidem — e o vermelho depende da ORDEM em
 * que os arquivos rodam (achado da Task 9). Um numero fixo por spec elimina o
 * recurso compartilhado em vez de coordenar quem desconecta antes de quem;
 * global-setup.ts limpa OS DOIS (a mesma lista que ja limpa as tres Pages).
 */
export const TOKEN_FALSO_SECUNDARIO = 'token-falso-secundario'
export const NUMERO_FALSO_SECUNDARIO = {
  phoneNumberId: 'phone-number-id-falso-secundario',
  wabaId: 'waba-id-falso-secundario',
  numeroExibicao: '+55 11 90000-0001',
  nomeVerificado: 'Empresa Falsa 2',
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
  /**
   * Nomes de template para os quais `apagarTemplate` deve falhar com
   * `whatsapp_indisponivel` — knob de falha exigido pela Task 5 (o teste
   * mandatorio de falha na remocao precisa de um jeito de configurar isso
   * sem tocar rede).
   */
  readonly apagaresQueFalham: Set<string> = new Set()
  /** Toda chamada a `enviarTemplate`, inclusive as recusadas. */
  readonly enviados: {
    token: string
    phoneNumberId: string
    e164Destino: string
    nome: string
    valores: string[]
  }[] = []

  constructor() {
    this.semearPadrao()
  }

  /** Os dois pares padrao do E2E — ver TOKEN_FALSO_PADRAO/TOKEN_FALSO_SECUNDARIO.
   * Fica fora do corpo do construtor para `reiniciar()` restaurar o MESMO
   * estado inicial: um reiniciar que apagasse os padroes deixaria a falsa num
   * estado que o construtor nunca produz. */
  private semearPadrao(): void {
    this.tokensAceitos.add(TOKEN_FALSO_PADRAO)
    this.numeros.set(NUMERO_FALSO_PADRAO.phoneNumberId, {
      numeroExibicao: NUMERO_FALSO_PADRAO.numeroExibicao,
      nomeVerificado: NUMERO_FALSO_PADRAO.nomeVerificado,
    })
    this.tokensAceitos.add(TOKEN_FALSO_SECUNDARIO)
    this.numeros.set(NUMERO_FALSO_SECUNDARIO.phoneNumberId, {
      numeroExibicao: NUMERO_FALSO_SECUNDARIO.numeroExibicao,
      nomeVerificado: NUMERO_FALSO_SECUNDARIO.nomeVerificado,
    })
  }

  reiniciar(): void {
    this.numeros.clear()
    this.tokensAceitos.clear()
    this.consultados.length = 0
    this.templates.clear()
    this.submetidos.length = 0
    this.templatesConsultados.length = 0
    this.apagados.length = 0
    this.apagaresQueFalham.clear()
    this.enviados.length = 0
    this.semearPadrao()
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
    if (this.apagaresQueFalham.has(nome)) return falha('whatsapp_indisponivel')
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
      // Copia, nao a mesma referencia: sem isso, o chamador poderia mutar
      // `d.valores` depois da chamada e reescrever o registro por baixo dos
      // panos, corrompendo uma asercao feita mais tarde no teste.
      valores: [...d.valores],
    })
    // Reproduz a ultima guarda do Graph: recusa template inexistente ou nao
    // aprovado, sem distinguir os dois casos (o Graph tambem nao distingue
    // na pratica — os dois viram "nao pode enviar isso").
    const t = this.templates.get(d.nome)
    if (!t || t.status !== 'approved') return falha('envio_recusado')
    return ok({ idMensagem: `wamid.falso-${this.enviados.length}` })
  }
}
