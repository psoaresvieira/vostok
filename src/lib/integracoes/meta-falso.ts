import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { ArvoreDeAnuncio, LeadDoMeta, MetaGraph, PaginaDoMeta } from './meta'

const PAGINAS_PADRAO: PaginaDoMeta[] = [
  { id: '100000000000001', nome: 'SE7E Marketing', token: 'token-da-pagina-1' },
  { id: '100000000000002', nome: 'SE7E Imóveis', token: 'token-da-pagina-2' },
  { id: '100000000000003', nome: 'SE7E Consultoria', token: 'token-da-pagina-3' },
]

/**
 * Devolvido para qualquer leadgenId ausente de `leads`. Traz full_name,
 * email, phone_number e uma pergunta de qualificacao custom porque e este
 * lead que a Task 6 (mapeamento de campos) e a Task 7 (ingerir_lead de ponta
 * a ponta) vao exercitar.
 */
const LEAD_PADRAO: LeadDoMeta = {
  campos: [
    { name: 'full_name', values: ['Fulano de Tal'] },
    { name: 'email', values: ['fulano@example.com'] },
    { name: 'phone_number', values: ['+5511999999999'] },
    { name: 'qual_o_seu_orcamento', values: ['Entre R$5.000 e R$10.000'] },
  ],
  adId: 'ad-padrao',
  formId: 'form-padrao',
  criadoEm: '2026-01-01T00:00:00+0000',
}

/**
 * Test double do MetaGraph. Guarda o que foi chamado para que o teste possa
 * asserir efeito (a Page ficou inscrita em leadgen?) e nao so retorno.
 */
export class MetaGraphFalso implements MetaGraph {
  readonly assinadas: string[] = []
  readonly desassinadas: string[] = []
  /**
   * Registra cada `listarPaginas`, guardando o token recebido. Existe para a
   * Task 7 poder afirmar que uma acao recusada **nao** chegou a listar — recusar
   * depois de ja ter gasto o token nao fecha nada. Asercao sobre o estado do
   * duplo, que e o que este projeto aceita, em vez de espionar a chamada.
   */
  readonly listadas: string[] = []
  /** Ids de leadgen buscados com sucesso, mesma razao de existir que `listadas`. */
  readonly buscados: string[] = []
  /** Ids de Page cuja posse foi confirmada (chamada terminou em `ok`). */
  readonly posseConferida: string[] = []
  /**
   * Leads semeados por leadgenId. Quando o id pedido nao esta aqui,
   * `buscarLead` devolve `LEAD_PADRAO` — os testes nao precisam semear um
   * lead so para exercitar o caminho feliz.
   */
  readonly leads: Map<string, LeadDoMeta> = new Map()
  /**
   * Nome do metodo que deve falhar, para exercitar o caminho de erro.
   * `keyof MetaGraph`, e nao `string`: um typo como 'assinarLeadGen' nunca
   * bateria em `barrado()`, e o teste que deveria cobrir o caminho de erro
   * passaria vazio, sem falhar e sem avisar ninguem. Tipar pelo proprio port
   * custa uma linha e transforma o typo em erro de compilacao.
   */
  falharEm: keyof MetaGraph | null = null

  constructor(private paginas: PaginaDoMeta[] = PAGINAS_PADRAO) {}

  reiniciar(): void {
    this.assinadas.length = 0
    this.desassinadas.length = 0
    this.listadas.length = 0
    this.buscados.length = 0
    this.posseConferida.length = 0
    this.leads.clear()
    this.falharEm = null
  }

  private barrado(metodo: keyof MetaGraph): boolean {
    return this.falharEm === metodo
  }

  async trocarCodePorTokenLongo(code: string, _redirectUri: string): Promise<Resultado<string>> {
    if (this.barrado('trocarCodePorTokenLongo')) return falha('meta_indisponivel')
    return ok(`token-longo-para-${code}`)
  }

  async listarPaginas(tokenDoUsuario: string): Promise<Resultado<PaginaDoMeta[]>> {
    if (this.barrado('listarPaginas')) return falha('meta_indisponivel')
    this.listadas.push(tokenDoUsuario)
    // Objeto novo por pagina, nao so array novo: `[...this.paginas]` clonava o
    // array mas mantinha os MESMOS objetos de PAGINAS_PADRAO (ou do array
    // passado no construtor). metaFalso() e singleton de processo, entao um
    // teste que mutasse pagina.nome corromperia a constante para todo teste
    // seguinte, inclusive de outros arquivos.
    return ok(this.paginas.map((p) => ({ ...p })))
  }

  async assinarLeadgen(pageId: string, _tokenDaPagina: string): Promise<Resultado<void>> {
    if (this.barrado('assinarLeadgen')) return falha('meta_indisponivel')
    this.assinadas.push(pageId)
    return ok(undefined)
  }

  async desassinarLeadgen(pageId: string, _tokenDaPagina: string): Promise<Resultado<void>> {
    if (this.barrado('desassinarLeadgen')) return falha('meta_indisponivel')
    this.desassinadas.push(pageId)
    return ok(undefined)
  }

  async buscarLead(leadgenId: string, _tokenDaPagina: string): Promise<Resultado<LeadDoMeta>> {
    if (this.barrado('buscarLead')) return falha('meta_indisponivel')
    this.buscados.push(leadgenId)
    return ok(this.leads.get(leadgenId) ?? LEAD_PADRAO)
  }

  async arvoreDoAnuncio(adId: string, _tokenDaPagina: string): Promise<Resultado<ArvoreDeAnuncio>> {
    if (this.barrado('arvoreDoAnuncio')) return falha('meta_indisponivel')
    // Deterministico no proprio adId, sem estado nem Math.random: o mesmo
    // adId devolve a mesma arvore em chamadas repetidas do mesmo teste.
    return ok({
      anuncioId: adId,
      anuncioNome: `Anuncio ${adId}`,
      conjuntoId: `adset-${adId}`,
      conjuntoNome: `Conjunto ${adId}`,
      campanhaId: `camp-${adId}`,
      campanhaNome: `Campanha ${adId}`,
    })
  }

  async posseDaPagina(pageId: string, tokenDaPagina: string): Promise<Resultado<void>> {
    if (this.barrado('posseDaPagina')) return falha('meta_indisponivel')
    // Espelha o /me da versao real: o token so prova posse da Page a qual
    // ele pertence, nunca de outra so porque o id foi pedido explicitamente.
    const dona = this.paginas.find((p) => p.token === tokenDaPagina)
    if (!dona || dona.id !== pageId) return falha('posse_nao_comprovada')
    this.posseConferida.push(pageId)
    return ok(undefined)
  }
}
