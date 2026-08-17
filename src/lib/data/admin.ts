import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta, MotivoPerda, Papel } from '@/lib/domain/tipos'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { resolverContaAtiva } from './conta'

/**
 * Sem `token` de proposito: a listagem de pendentes vai inteira para um
 * componente client, entao qualquer campo aqui acaba no payload RSC e no HTML.
 * O token so e devolvido por `convidar`, no momento em que o link e gerado.
 */
export type Convite = {
  id: string
  email: string
  papel: Papel
  expiraEm: Date
}

export interface AdminStore {
  criarMotivo(nome: string): Promise<Resultado<string>>
  alternarMotivo(motivoId: string, ativo: boolean): Promise<Resultado<void>>
  /** Inclui os inativos — a tela de configuracao precisa deles para reativar. */
  todosMotivos(): Promise<Resultado<MotivoPerda[]>>
  convidar(email: string, papel: Papel): Promise<Resultado<string>>
  convitesPendentes(): Promise<Resultado<Convite[]>>
  revogarConvite(conviteId: string): Promise<Resultado<void>>
}

const DIAS_DE_VALIDADE = 7

export class SupabaseAdminStore implements AdminStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly accountId: string,
    private readonly usuarioId: string,
  ) {}

  async criarMotivo(nome: string): Promise<Resultado<string>> {
    const { data, error } = await this.cliente
      .from('loss_reasons')
      .insert({ account_id: this.accountId, nome })
      .select('id')
      .single()
    if (error) return falha(error.message)
    return ok(data.id)
  }

  async alternarMotivo(motivoId: string, ativo: boolean): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('loss_reasons')
      .update({ ativo })
      .eq('id', motivoId)
      .select('id')
    if (error) return falha(error.message)
    if (!data || data.length === 0) return falha('nao_encontrado')
    return ok(undefined)
  }

  async todosMotivos(): Promise<Resultado<MotivoPerda[]>> {
    const { data, error } = await this.cliente
      .from('loss_reasons')
      .select('id, nome, ativo')
      .eq('account_id', this.accountId)
      .order('nome')
    if (error) return falha(error.message)
    return ok(data ?? [])
  }

  async convidar(email: string, papel: Papel): Promise<Resultado<string>> {
    const token = randomUUID().replace(/-/g, '')
    const expiraEm = new Date(Date.now() + DIAS_DE_VALIDADE * 86_400_000)

    const { data, error } = await this.cliente
      .from('invites')
      .insert({
        account_id: this.accountId,
        email: email.trim().toLowerCase(),
        papel,
        token,
        expira_em: expiraEm.toISOString(),
        criado_por: this.usuarioId,
      })
      .select('token')
      .single()
    if (error) return falha(error.message)
    return ok(data.token)
  }

  async convitesPendentes(): Promise<Resultado<Convite[]>> {
    const { data, error } = await this.cliente
      .from('invites')
      .select('id, email, papel, expira_em')
      .eq('account_id', this.accountId)
      .is('aceito_em', null)
      .order('criado_em', { ascending: false })
    if (error) return falha(error.message)
    return ok(
      (data ?? []).map((i) => ({
        id: i.id,
        email: i.email,
        papel: i.papel as Papel,
        expiraEm: new Date(i.expira_em),
      })),
    )
  }

  async revogarConvite(conviteId: string): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('invites')
      .delete()
      .eq('id', conviteId)
      .select('id')
    if (error) return falha(error.message)
    if (!data || data.length === 0) return falha('nao_encontrado')
    return ok(undefined)
  }
}

export async function criarAdminStoreDoServidor(): Promise<
  Resultado<{ admin: SupabaseAdminStore; conta: Conta }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  if (!sessao.user) return falha('sem_sessao')

  // Mesmo resolvedor de criarStoreDoServidor, de proposito: config/page.tsx
  // chama os dois na mesma renderizacao, e duas resolucoes independentes
  // podiam cair em contas diferentes para quem tem duas memberships.
  const ativa = await resolverContaAtiva(cliente, sessao.user.id)
  if (!ativa.ok) return falha(ativa.erro)
  if (ativa.valor.papel !== 'admin') return falha('sem_permissao')

  return ok({
    admin: new SupabaseAdminStore(cliente, ativa.valor.conta.id, sessao.user.id),
    conta: ativa.valor.conta,
  })
}
