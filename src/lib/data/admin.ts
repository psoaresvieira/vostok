import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta, MotivoPerda, Papel, StageTipo } from '@/lib/domain/tipos'
import { criarClienteServidor } from '@/lib/supabase/servidor'

export type Convite = {
  id: string
  email: string
  papel: Papel
  token: string
  expiraEm: Date
}

export interface AdminStore {
  criarEtapa(nome: string, tipo: StageTipo): Promise<Resultado<string>>
  renomearEtapa(etapaId: string, nome: string): Promise<Resultado<void>>
  reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>>
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
    private readonly pipelineId: string,
  ) {}

  async criarEtapa(nome: string, tipo: StageTipo): Promise<Resultado<string>> {
    const { data: ultima, error: erroMax } = await this.cliente
      .from('stages')
      .select('ordem')
      .eq('pipeline_id', this.pipelineId)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (erroMax) return falha(erroMax.message)

    const { data, error } = await this.cliente
      .from('stages')
      .insert({
        pipeline_id: this.pipelineId,
        nome,
        tipo,
        ordem: (ultima?.ordem ?? 0) + 1,
      })
      .select('id')
      .single()
    if (error) return falha(error.message)
    return ok(data.id)
  }

  async renomearEtapa(etapaId: string, nome: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.from('stages').update({ nome }).eq('id', etapaId)
    if (error) return falha(error.message)
    return ok(undefined)
  }

  async reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>> {
    // stages_ordem_por_pipeline e um indice unico em (pipeline_id, ordem):
    // escrever as posicoes finais diretamente pode colidir com uma linha que
    // ainda guarda a posicao de destino (ex.: inverter [1..7] tentaria gravar
    // ordem=1 na ultima linha enquanto a primeira ainda esta com ordem=1).
    // Por isso movemos tudo para uma faixa alta e sem uso primeiro — livre de
    // colisao porque os valores 1000+i sao distintos entre si e maiores que
    // qualquer ordem existente — e só então gravamos as posicoes finais,
    // tambem distintas entre si.
    for (let i = 0; i < idsNaOrdem.length; i++) {
      const { error } = await this.cliente
        .from('stages')
        .update({ ordem: 1000 + i })
        .eq('id', idsNaOrdem[i])
      if (error) return falha(error.message)
    }
    for (let i = 0; i < idsNaOrdem.length; i++) {
      const { error } = await this.cliente
        .from('stages')
        .update({ ordem: i + 1 })
        .eq('id', idsNaOrdem[i])
      if (error) return falha(error.message)
    }
    return ok(undefined)
  }

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
    const { error } = await this.cliente
      .from('loss_reasons')
      .update({ ativo })
      .eq('id', motivoId)
    if (error) return falha(error.message)
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
      .select('id, email, papel, token, expira_em')
      .eq('account_id', this.accountId)
      .is('aceito_em', null)
      .order('criado_em', { ascending: false })
    if (error) return falha(error.message)
    return ok(
      (data ?? []).map((i) => ({
        id: i.id,
        email: i.email,
        papel: i.papel as Papel,
        token: i.token,
        expiraEm: new Date(i.expira_em),
      })),
    )
  }

  async revogarConvite(conviteId: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.from('invites').delete().eq('id', conviteId)
    if (error) return falha(error.message)
    return ok(undefined)
  }
}

export async function criarAdminStoreDoServidor(): Promise<
  Resultado<{ admin: SupabaseAdminStore; conta: Conta }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  if (!sessao.user) return falha('sem_sessao')

  const { data, error } = await cliente
    .from('memberships')
    .select('papel, accounts(id, nome)')
    .limit(1)
    .maybeSingle()
  if (error) return falha(error.message)
  if (!data) return falha('sem_conta')

  const linha = data as unknown as { papel: Papel; accounts: { id: string; nome: string } }
  if (linha.papel !== 'admin') return falha('sem_permissao')

  const { data: pipeline, error: erroPipeline } = await cliente
    .from('pipelines')
    .select('id')
    .eq('account_id', linha.accounts.id)
    .eq('is_default', true)
    .maybeSingle()
  if (erroPipeline) return falha(erroPipeline.message)
  if (!pipeline) return falha('pipeline_nao_encontrado')

  return ok({
    admin: new SupabaseAdminStore(cliente, linha.accounts.id, sessao.user.id, pipeline.id),
    conta: { id: linha.accounts.id, nome: linha.accounts.nome },
  })
}
