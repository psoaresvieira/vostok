import { falha, ok, type Resultado } from '@/lib/domain/resultado'
import type { MetaGraph, PaginaDoMeta } from './meta'

export type GravarFonte = (pagina: PaginaDoMeta) => Promise<Resultado<string>>

export type EntradaOperador = {
  graph: MetaGraph
  gravar: GravarFonte
  pageId: string
  /** Token de System User (ou de usuario) que administra a Page. */
  tokenDoUsuario: string
  /** true usa a gravacao que toma a Page de outra conta (reivindicar_fonte_meta). */
  reivindicar: boolean
}

/**
 * Orquestracao do modo operador (0030): o dono da plataforma conecta uma
 * Page ao tenant de um cliente. E a MESMA sequencia de
 * `conectarOuReivindicar` em app/(app)/config/acoes-fontes.ts, duplicada de
 * proposito — a action e amarrada a cookie e a conta ativa da sessao, e o
 * dono nao e membro da conta do cliente (0028). Se a regra mudar la, muda
 * aqui; o teste desta funcao pina a regra.
 */
export async function conectarPaginaComoOperador(e: EntradaOperador): Promise<Resultado<string>> {
  // Buscar a Page pela listagem, nunca confiar num token de Page vindo de
  // fora: o token da Page e o que vai para source_credentials.
  const paginas = await e.graph.listarPaginas(e.tokenDoUsuario)
  if (!paginas.ok) return falha(paginas.erro)
  const pagina = paginas.valor.find((p) => p.id === e.pageId)
  if (!pagina) return falha('pagina_nao_encontrada')

  // Posse ANTES de qualquer escrita ou assinatura (Task 10 do Plano 4).
  const posse = await e.graph.posseDaPagina(pagina.id, pagina.token)
  if (!posse.ok) return falha(posse.erro)

  // Assinar ANTES de gravar: fonte gravada sem inscricao nunca recebe webhook.
  const assinou = await e.graph.assinarLeadgen(pagina.id, pagina.token)
  if (!assinou.ok) return falha(assinou.erro)

  const r = await e.gravar(pagina)
  if (!r.ok) {
    // So desfaz a assinatura que ESTA chamada criou. `assinarLeadgen` e
    // idempotente no Meta: numa reivindicacao a Page ja estava inscrita, e
    // `page_ja_conectada` e prova de que pertencia a outra conta. Desassinar
    // nesses casos derrubaria a inscricao de que o outro tenant depende.
    const assinaturaEraDestaChamada = !e.reivindicar && r.erro !== 'page_ja_conectada'
    if (assinaturaEraDestaChamada) {
      await e.graph.desassinarLeadgen(pagina.id, pagina.token)
    }
    return falha(r.erro)
  }
  return ok(r.valor)
}
