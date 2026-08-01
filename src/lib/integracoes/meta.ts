import type { Resultado } from '@/lib/domain/resultado'

/** Uma Page do Facebook que o usuario administra, com o token dela. */
export type PaginaDoMeta = { id: string; nome: string; token: string }

/**
 * Um lead do formulario de leadgen, como o Graph API devolve. `campos` fica
 * cru (nome/valores, sem achatar num objeto) porque o formulario e definido
 * pelo usuario final do Meta Ads Manager: perguntas de qualificacao tem nome
 * arbitrario e o CRM nao pode assumir um schema fixo alem dos campos padrao.
 */
export type LeadDoMeta = {
  campos: { name: string; values: string[] }[]
  adId: string | null
  formId: string | null
  criadoEm: string | null
}

/**
 * Os tres niveis da arvore de um anuncio do Meta. Id e nome andam em par
 * porque a metrica agrupa pelo ID (renomear campanha no gerenciador e rotina
 * e nao pode partir o historico em duas linhas) e exibe o NOME. Nome nulo e
 * estado legitimo: o Google nunca manda nome nenhum, e o Meta pode omitir um
 * nivel numa resposta parcial.
 */
export type ArvoreDeAnuncio = {
  anuncioId: string
  anuncioNome: string | null
  conjuntoId: string | null
  conjuntoNome: string | null
  campanhaId: string | null
  campanhaNome: string | null
}

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
  /** O corpo do lead que chegou no webhook: campos do formulario, ad e form de origem. */
  buscarLead(leadgenId: string, tokenDaPagina: string): Promise<Resultado<LeadDoMeta>>
  /** Nome da campanha dona do anuncio. Substituido por arvoreDoAnuncio; sai no fim deste plano. */
  campanhaDoAnuncio(adId: string, tokenDaPagina: string): Promise<Resultado<string>>
  /**
   * Anuncio, conjunto e campanha numa ida so ao Graph. Substitui
   * campanhaDoAnuncio: mesma chamada, mesmo custo, tres niveis em vez de um
   * nome — e com os ids, que sao o que a metrica agrupa.
   */
  arvoreDoAnuncio(adId: string, tokenDaPagina: string): Promise<Resultado<ArvoreDeAnuncio>>
  /**
   * Prova que `tokenDaPagina` administra `pageId`. Fecha o buraco de
   * squatting: sem isto, qualquer um que soubesse o id publico de uma Page
   * concorrente poderia reivindica-la no CRM.
   */
  posseDaPagina(pageId: string, tokenDaPagina: string): Promise<Resultado<void>>
}
