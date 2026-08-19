import type { Lead } from '@/lib/domain/tipos'
import type { FiltroFunil } from '@/lib/data/store'

/**
 * Quantos cartoes cada coluna do funil carrega por vez.
 *
 * O quadro baixava a pipeline INTEIRA: `select *` sem `limit`, com as
 * etiquetas embutidas, e depois `posicoes.filter(...)` por coluna em JS. Numa
 * conta com alguns milhares de leads isso e' um payload RSC de megabytes, N
 * componentes cliente montados de uma vez e um `useDraggable` registrado por
 * cartao — a tela travada que se sentia ao abrir o funil.
 *
 * 50 e' folgado para o uso real de uma coluna (o que nao cabe em 50 nao se le
 * rolando, se filtra) e continua enchendo a tela sem clique nenhum. O resto
 * entra por "carregar mais", coluna por coluna.
 */
export const LIMITE_CARTOES_POR_ETAPA = 50

/** Teto por pedido de "carregar mais": trava contra offset/limite forjados. */
export const LIMITE_MAXIMO_POR_PEDIDO = 200

/**
 * Os filtros do funil como chegam da URL, do jeito que o cliente pode
 * reenvia-los na hora de pedir a proxima pagina de uma coluna.
 *
 * Texto puro de proposito: e' o que a Server Action recebe, entao tudo aqui
 * atravessa a rede e nada pode ser confiado sem revalidacao (ver
 * `filtroDoFunil`).
 */
export type FiltrosDaUrl = {
  responsavel?: string
  origem?: string
  dias?: string
  busca?: string
}

const ORIGENS_VALIDAS: ReadonlySet<string> = new Set<Lead['origem']>([
  'manual',
  'meta',
  'google',
  'indicacao',
  'organico',
])

/** Periodos que a barra de filtros oferece. Qualquer outro `dias` e' ignorado. */
const DIAS_VALIDOS: ReadonlySet<number> = new Set([7, 30, 90])

/**
 * Traduz os filtros da URL para o filtro do store, descartando o que nao
 * reconhece.
 *
 * Descartar, e nao recusar: um `?origem=xyz` colado de uma URL velha e' filtro
 * invalido, nao excecao — mesma regra que `resolverPipelineAtiva` ja aplica ao
 * `?pipeline=` de uma pipeline excluida.
 *
 * `responsavelId` NAO e' validado contra a lista de membros aqui, e nao precisa
 * ser: um id de outra conta simplesmente nao casa com lead nenhum que a RLS
 * deixe passar. O recorte do vendedor tambem nao mora aqui — mora na policy
 * `leads_select`, que o `security invoker` de `leads_do_funil` preserva.
 */
export function filtroDoFunil(
  pipelineId: string,
  params: FiltrosDaUrl,
  limite: number,
  extra?: { etapaId?: string; offset?: number },
): FiltroFunil {
  const dias = params.dias ? Number(params.dias) : NaN
  const origem = params.origem ?? ''
  const busca = (params.busca ?? '').trim()

  return {
    pipelineId,
    limite,
    etapaId: extra?.etapaId ?? null,
    offset: extra?.offset ?? 0,
    responsavelId: params.responsavel || null,
    origem: ORIGENS_VALIDAS.has(origem) ? (origem as Lead['origem']) : null,
    desde: DIAS_VALIDOS.has(dias) ? new Date(Date.now() - dias * 86_400_000) : null,
    busca: busca.length > 0 ? busca : null,
  }
}
