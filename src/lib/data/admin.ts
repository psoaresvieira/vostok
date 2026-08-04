import { randomUUID } from 'node:crypto'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta, MotivoPerda, Papel, StageTipo } from '@/lib/domain/tipos'
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

export type ResumoEtapa = {
  etapaId: string
  leadsNaEtapa: number
  leadsPassaram: number
}

export interface AdminStore {
  criarEtapa(nome: string, tipo: StageTipo): Promise<Resultado<string>>
  renomearEtapa(etapaId: string, nome: string): Promise<Resultado<void>>
  excluirEtapa(etapaId: string): Promise<Resultado<void>>
  reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>>
  resumoEtapas(): Promise<Resultado<ResumoEtapa[]>>
  criarMotivo(nome: string): Promise<Resultado<string>>
  alternarMotivo(motivoId: string, ativo: boolean): Promise<Resultado<void>>
  /** Inclui os inativos — a tela de configuracao precisa deles para reativar. */
  todosMotivos(): Promise<Resultado<MotivoPerda[]>>
  convidar(email: string, papel: Papel): Promise<Resultado<string>>
  convitesPendentes(): Promise<Resultado<Convite[]>>
  revogarConvite(conviteId: string): Promise<Resultado<void>>
}

const DIAS_DE_VALIDADE = 7

/**
 * Traduz o erro do PostgREST para um dos codigos que excluir_etapa e
 * reordenar_etapas levantam. Mesmo padrao de codigoDoErroPostgres em
 * supabase.ts:465 (privada la, repetida aqui porque a lista de codigos e
 * outra): as strings sao nossas, cassar por `error.message.includes` e
 * seguro e independente de locale.
 */
const CODIGOS_CONHECIDOS_DE_ETAPA = [
  'etapa_nao_encontrada',
  'etapa_tem_leads',
  'ultima_etapa_do_tipo',
  'ordem_invalida',
  'sem_permissao',
]

function codigoDoErroDeEtapa(erro: Pick<PostgrestError, 'message' | 'code'>): string {
  const achado = CODIGOS_CONHECIDOS_DE_ETAPA.find((c) => erro.message.includes(c))
  if (achado) return achado
  // leads.stage_id e NOT NULL / NO ACTION: se um lead entrar na etapa entre a
  // contagem da guarda em excluir_etapa e o delete, a FK estoura 23503 em vez
  // de levantar etapa_tem_leads — para quem esta na tela e a mesma recusa.
  if (erro.code === '23503') return 'etapa_tem_leads'
  return erro.message
}

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
    // Zero linhas depois da RLS significa "nao encontrado", nunca erro de
    // permissao: um id de outra conta simplesmente nao casa e o update volta
    // vazio sem error. Sem o select abaixo a tela mostraria sucesso num no-op.
    const { data, error } = await this.cliente
      .from('stages')
      .update({ nome })
      .eq('id', etapaId)
      .select('id')
    if (error) return falha(error.message)
    if (!data || data.length === 0) return falha('nao_encontrado')
    return ok(undefined)
  }

  async excluirEtapa(etapaId: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.rpc('excluir_etapa', { p_stage_id: etapaId })
    if (error) return falha(codigoDoErroDeEtapa(error))
    return ok(undefined)
  }

  async reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>> {
    // A transacao (validacao + as duas fases de update contra o indice unico
    // de ordem) vive inteira na RPC — ver reordenar_etapas na 0018. Falha em
    // qualquer ponto desfaz tudo; daqui so traduzimos o erro.
    const { error } = await this.cliente.rpc('reordenar_etapas', {
      p_ids_na_ordem: idsNaOrdem,
    })
    if (error) return falha(codigoDoErroDeEtapa(error))
    return ok(undefined)
  }

  async resumoEtapas(): Promise<Resultado<ResumoEtapa[]>> {
    const { data, error } = await this.cliente.rpc('resumo_etapas', {
      p_pipeline_id: this.pipelineId,
    })
    if (error) return falha(codigoDoErroDeEtapa(error))
    const linhas = (data ?? []) as {
      stage_id: string
      leads_na_etapa: number
      leads_passaram: number
    }[]
    return ok(
      linhas.map((linha) => ({
        etapaId: linha.stage_id,
        // O supabase-js entrega bigint como number; Number() e so defesa
        // contra um driver que devolva string, sem custo no caminho comum.
        leadsNaEtapa: Number(linha.leads_na_etapa),
        leadsPassaram: Number(linha.leads_passaram),
      })),
    )
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

  const { data: pipeline, error: erroPipeline } = await cliente
    .from('pipelines')
    .select('id')
    .eq('account_id', ativa.valor.conta.id)
    .eq('is_default', true)
    .maybeSingle()
  if (erroPipeline) return falha(erroPipeline.message)
  if (!pipeline) return falha('pipeline_nao_encontrado')

  return ok({
    admin: new SupabaseAdminStore(
      cliente,
      ativa.valor.conta.id,
      sessao.user.id,
      pipeline.id,
    ),
    conta: ativa.valor.conta,
  })
}
