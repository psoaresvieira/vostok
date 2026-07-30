import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { MetaGraph, PaginaDoMeta } from './meta'

const PAGINAS_PADRAO: PaginaDoMeta[] = [
  { id: '100000000000001', nome: 'SE7E Marketing', token: 'token-da-pagina-1' },
  { id: '100000000000002', nome: 'SE7E Imóveis', token: 'token-da-pagina-2' },
]

/**
 * Test double do MetaGraph. Guarda o que foi chamado para que o teste possa
 * asserir efeito (a Page ficou inscrita em leadgen?) e nao so retorno.
 */
export class MetaGraphFalso implements MetaGraph {
  readonly assinadas: string[] = []
  readonly desassinadas: string[] = []
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
    this.falharEm = null
  }

  private barrado(metodo: keyof MetaGraph): boolean {
    return this.falharEm === metodo
  }

  async trocarCodePorTokenLongo(code: string, _redirectUri: string): Promise<Resultado<string>> {
    if (this.barrado('trocarCodePorTokenLongo')) return falha('meta_indisponivel')
    return ok(`token-longo-para-${code}`)
  }

  async listarPaginas(_tokenDoUsuario: string): Promise<Resultado<PaginaDoMeta[]>> {
    if (this.barrado('listarPaginas')) return falha('meta_indisponivel')
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
}
