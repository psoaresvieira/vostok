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
  /** Nome do metodo que deve falhar, para exercitar o caminho de erro. */
  falharEm: string | null = null

  constructor(private paginas: PaginaDoMeta[] = PAGINAS_PADRAO) {}

  reiniciar(): void {
    this.assinadas.length = 0
    this.desassinadas.length = 0
    this.falharEm = null
  }

  private barrado(metodo: string): boolean {
    return this.falharEm === metodo
  }

  async trocarCodePorTokenLongo(code: string, _redirectUri: string): Promise<Resultado<string>> {
    if (this.barrado('trocarCodePorTokenLongo')) return falha('meta_indisponivel')
    return ok(`token-longo-para-${code}`)
  }

  async listarPaginas(_tokenDoUsuario: string): Promise<Resultado<PaginaDoMeta[]>> {
    if (this.barrado('listarPaginas')) return falha('meta_indisponivel')
    return ok([...this.paginas])
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
