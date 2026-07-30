import type { Resultado } from '@/lib/domain/resultado'

/** Uma Page do Facebook que o usuario administra, com o token dela. */
export type PaginaDoMeta = { id: string; nome: string; token: string }

/**
 * Tudo que o CRM precisa do Graph API para conectar uma fonte. Port, e nao
 * chamadas de fetch espalhadas, para que nenhum teste automatizado toque a
 * rede: a constraint vale para o E2E tambem.
 *
 * Todo metodo devolve Resultado. O Graph API falha de formas que nao sao
 * excecao de programa (token revogado, permissao faltando, Page ja inscrita em
 * outro app), e essas precisam virar mensagem na tela.
 */
export interface MetaGraph {
  /** Troca o `code` do redirect por um token de usuario de longa duracao. */
  trocarCodePorTokenLongo(code: string, redirectUri: string): Promise<Resultado<string>>
  /** Pages que o usuario administra, cada uma com seu proprio token. */
  listarPaginas(tokenDoUsuario: string): Promise<Resultado<PaginaDoMeta[]>>
  /** Inscreve o app no campo `leadgen` da Page. Sem isto, nenhum webhook chega. */
  assinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>>
  desassinarLeadgen(pageId: string, tokenDaPagina: string): Promise<Resultado<void>>
}
