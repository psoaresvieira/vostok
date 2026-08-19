'use server'

import { criarStoreDoServidor } from '@/lib/data/supabase'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { LeadDoFunil } from '@/lib/domain/tipos'
import {
  LIMITE_CARTOES_POR_ETAPA,
  LIMITE_MAXIMO_POR_PEDIDO,
  filtroDoFunil,
  type FiltrosDaUrl,
} from './paginacao'

/**
 * A proxima pagina de UMA coluna do funil.
 *
 * Existe para o "carregar mais" nao repaginar as outras colunas: o quadro
 * inteiro custa uma consulta que conta e soma a pipeline toda, e clicar em
 * "carregar mais" numa coluna nao e' motivo para pagar isso de novo nas
 * demais.
 *
 * `pipelineId` vem do cliente e NAO e' verificado contra a conta aqui de
 * proposito — `leads_do_funil` e' `security invoker`, entao a RLS de `leads`
 * decide: id de outra conta devolve zero linhas, exatamente como devolveria um
 * id inexistente. Nada a distinguir, nada a vazar.
 *
 * `offset` e `pipelineId` chegam por rede, entao os dois passam por sanidade
 * antes de virar consulta: offset negativo ou nao-inteiro viraria `posicao >
 * -5` na RPC (a pagina 1 de novo, cartoes duplicados na tela), e um offset
 * gigante e' um scan inutil.
 */
export async function maisLeadsDaEtapaAction(
  pipelineId: string,
  etapaId: string,
  offset: number,
  params: FiltrosDaUrl,
): Promise<Resultado<LeadDoFunil[]>> {
  if (!pipelineId || !etapaId) return falha('etapa_invalida')
  if (!Number.isSafeInteger(offset) || offset < 0) return falha('etapa_invalida')

  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const colunas = await contexto.valor.store.leadsDoFunil(
    filtroDoFunil(pipelineId, params, Math.min(LIMITE_CARTOES_POR_ETAPA, LIMITE_MAXIMO_POR_PEDIDO), {
      etapaId,
      offset,
    }),
  )
  if (!colunas.ok) return falha(colunas.erro)

  // Com `etapaId` setado a RPC devolve no maximo uma coluna; zero colunas
  // significa "essa etapa nao tem mais nada visivel para voce", que aqui e'
  // lista vazia e nao erro — o botao simplesmente desaparece.
  return ok(colunas.valor[0]?.leads ?? [])
}
