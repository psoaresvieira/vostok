import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta, Papel } from '@/lib/domain/tipos'

export type ContaAtiva = { conta: Conta; usuarioId: string; papel: Papel }

/**
 * Resolucao unica da conta ativa. Antes cada resolvedor tinha a sua copia, e
 * `config/page.tsx` chamava os dois — com duas memberships e sem `order by`,
 * cada chamada podia cair numa conta diferente e a tela misturava as duas.
 *
 * Duas coisas nao sao opcionais aqui:
 *
 * - `.eq('user_id')`: a policy memberships_select libera TODAS as linhas da
 *   conta para qualquer membro (e o que faz a tela de usuarios funcionar), logo
 *   sem o filtro o papel lido pode ser o de outra pessoa.
 * - `.order('criado_em')`: e o que torna a escolha deterministica. `limit(1)`
 *   sozinho deixa a escolha da linha por conta do plano de execucao.
 *
 * Criterio: a membership mais antiga vence. Enquanto nao existir seletor de
 * conta na UI, "a primeira conta em que entrei" e a unica regra que nao muda
 * sozinha entre dois carregamentos da mesma pagina.
 */
export async function resolverContaAtiva(
  cliente: SupabaseClient,
  usuarioId: string,
): Promise<Resultado<ContaAtiva>> {
  const { data, error } = await cliente
    .from('memberships')
    .select('papel, criado_em, accounts(id, nome)')
    .eq('user_id', usuarioId)
    .order('criado_em', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) return falha(error.message)
  if (!data) return falha('sem_conta')

  const linha = data as unknown as {
    papel: Papel
    accounts: { id: string; nome: string } | null
  }
  // accounts vem nulo se a RLS de accounts esconder a linha — trata como
  // "nao encontrado", nunca como erro de permissao.
  if (!linha.accounts) return falha('sem_conta')

  return ok({
    conta: { id: linha.accounts.id, nome: linha.accounts.nome },
    usuarioId,
    papel: linha.papel,
  })
}
