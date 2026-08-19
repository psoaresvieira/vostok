import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { resolverContaAtiva, type ContaAtiva } from './conta'

/**
 * Sessao do servidor resolvida UMA VEZ por request.
 *
 * O problema que este modulo existe para resolver: cada `criar*StoreDoServidor`
 * montava o proprio cliente, chamava `auth.getUser()` e resolvia a conta ativa
 * por conta propria. Uma pagina qualquer usa varios stores — a ficha do lead
 * usa quatro (crm, tarefas, scripts, templates) e o layout usa mais dois —,
 * entao um unico carregamento fazia SETE `auth.getUser()` e QUATRO consultas a
 * `memberships`, todas com a mesma resposta.
 *
 * `auth.getUser()` nao e' leitura local de cookie: e' um round-trip HTTP ao
 * GoTrue para validar o token. Sete deles em serie sao facilmente 700ms de
 * latencia que a pagina nao usa para nada — e' exatamente o "travado" que se
 * sente ao abrir funil e ficha.
 *
 * `cache()` do React memoiza por REQUEST (nao entre requests, nao entre
 * usuarios): o primeiro chamador paga a ida ao servidor, os demais recebem a
 * mesma promise. Nada de seguranca muda — o token continua sendo validado a
 * cada request, so' que uma vez em vez de sete.
 *
 * Nao ha invalidacao a fazer: a sessao e a conta ativa nao mudam no meio de um
 * render, e uma Server Action roda no proprio escopo de cache.
 */
export const clienteDoServidor = cache(
  async (): Promise<SupabaseClient> => criarClienteServidor(),
)

/**
 * O usuario logado, validado contra o GoTrue. `null` quando nao ha sessao —
 * quem chama traduz para 'sem_sessao', que e' o vocabulario dos stores.
 */
export const usuarioDaSessao = cache(async (): Promise<{ id: string } | null> => {
  const cliente = await clienteDoServidor()
  const { data } = await cliente.auth.getUser()
  return data.user ? { id: data.user.id } : null
})

/**
 * Cliente + usuario, o preambulo comum de todo store de sessao.
 */
export async function sessaoDoServidor(): Promise<
  Resultado<{ cliente: SupabaseClient; usuarioId: string }>
> {
  const cliente = await clienteDoServidor()
  const usuario = await usuarioDaSessao()
  if (!usuario) return falha('sem_sessao')
  return ok({ cliente, usuarioId: usuario.id })
}

/**
 * A conta ativa do usuario logado, resolvida uma vez por request.
 *
 * A memoizacao aqui e' mais do que economia: `resolverContaAtiva` escolhe a
 * membership mais antiga, e o comentario em conta.ts ja avisava que duas
 * resolucoes independentes na mesma tela podiam divergir. Com uma resolucao
 * por request, essa classe de bug deixa de existir por construcao.
 */
const contaAtivaMemo = cache(
  async (usuarioId: string): Promise<Resultado<ContaAtiva>> => {
    const cliente = await clienteDoServidor()
    return resolverContaAtiva(cliente, usuarioId)
  },
)

/** Cliente + usuario + conta ativa + papel, tudo resolvido uma vez por request. */
export async function contextoDaConta(): Promise<
  Resultado<{ cliente: SupabaseClient; usuarioId: string; conta: ContaAtiva['conta']; papel: ContaAtiva['papel'] }>
> {
  const sessao = await sessaoDoServidor()
  if (!sessao.ok) return falha(sessao.erro)

  const ativa = await contaAtivaMemo(sessao.valor.usuarioId)
  if (!ativa.ok) return falha(ativa.erro)

  return ok({
    cliente: sessao.valor.cliente,
    usuarioId: sessao.valor.usuarioId,
    conta: ativa.valor.conta,
    papel: ativa.valor.papel,
  })
}
