import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { criarClienteServidor } from '@/lib/supabase/servidor'

export type TipoTarefa = 'ligacao' | 'whatsapp' | 'reuniao' | 'proposta' | 'outro'

export type Tarefa = {
  id: string
  leadId: string
  leadNome: string
  titulo: string
  tipo: TipoTarefa
  venceEm: Date
  concluidaEm: Date | null
  concluidaPor: string | null
  criadoPor: string | null
  criadoEm: Date
}

/** Tarefa e' filha de lead, sem dono proprio (ver 0015_tarefas.sql): as
 * quatro policies de tasks sao pode_ver_lead_id, a mesma que lead_tags e
 * stage_history ja usam. Por isso minhasAbertas precisa filtrar
 * leads.responsavel_id explicitamente — a RLS sozinha e' permissiva para
 * admin/gestor de proposito (pode_ver_lead), e devolveria tarefa de conta
 * inteira em vez de so as do responsavel pedido. */
export interface TarefaStore {
  doLead(leadId: string): Promise<Resultado<Tarefa[]>>
  minhasAbertas(responsavelId: string | null): Promise<Resultado<Tarefa[]>>
  criar(d: {
    leadId: string
    titulo: string
    tipo: TipoTarefa
    venceEm: Date
  }): Promise<Resultado<string>>
  concluir(id: string): Promise<Resultado<void>>
  reabrir(id: string): Promise<Resultado<void>>
  excluir(id: string): Promise<Resultado<void>>
}

const SELECT_TAREFA =
  'id, lead_id, titulo, tipo, vence_em, concluida_em, concluida_por, criado_por, criado_em, leads(nome)'

type LinhaTarefa = {
  id: string
  lead_id: string
  titulo: string
  tipo: TipoTarefa
  vence_em: string
  concluida_em: string | null
  concluida_por: string | null
  criado_por: string | null
  criado_em: string
  // Embed simples, sem defesa contra null: diferente de notifications, a
  // policy tasks_select ja exige pode_ver_lead_id, entao uma linha de tasks
  // so chega aqui se o lead dela tambem estiver visivel. Uma tarefa cujo
  // lead saiu do alcance nao aparece — nao aparece com leads null.
  leads: { nome: string }
}

function paraTarefa(l: LinhaTarefa): Tarefa {
  return {
    id: l.id,
    leadId: l.lead_id,
    leadNome: l.leads.nome,
    titulo: l.titulo,
    tipo: l.tipo,
    venceEm: new Date(l.vence_em),
    concluidaEm: l.concluida_em ? new Date(l.concluida_em) : null,
    concluidaPor: l.concluida_por,
    criadoPor: l.criado_por,
    criadoEm: new Date(l.criado_em),
  }
}

export class SupabaseTarefaStore implements TarefaStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly usuarioId: string,
  ) {}

  async doLead(leadId: string): Promise<Resultado<Tarefa[]>> {
    const { data, error } = await this.cliente
      .from('tasks')
      .select(SELECT_TAREFA)
      .eq('lead_id', leadId)
      // vence_em asc, com desempate criado_em asc, id asc: sem desempate
      // explicito dois vence_em identicos ficam em ordem indefinida — o
      // Plano 3 gastou uma task inteira (lead_events.seq) por essa licao.
      .order('vence_em', { ascending: true })
      .order('criado_em', { ascending: true })
      .order('id', { ascending: true })
    if (error) return falha(error.message)
    return ok((data as unknown as LinhaTarefa[]).map(paraTarefa))
  }

  async minhasAbertas(responsavelId: string | null): Promise<Resultado<Tarefa[]>> {
    // !inner troca o embed de LEFT para INNER join, o que e' o que permite ao
    // PostgREST filtrar linhas de tasks pela coluna embutida leads.responsavel_id
    // em vez de so filtrar o conteudo do embed. Sem isso o filtro abaixo nao
    // reduziria as linhas de tasks devolvidas — exatamente o defeito que este
    // metodo existe para nao ter: pode_ver_lead_id ja deixa o admin ver toda
    // tarefa da conta, entao o filtro por responsavel_id tem que ser explicito
    // e incondicional, nao uma condicionalidade emprestada da RLS.
    let query = this.cliente
      .from('tasks')
      .select(
        'id, lead_id, titulo, tipo, vence_em, concluida_em, concluida_por, criado_por, criado_em, leads!inner(nome, responsavel_id)',
      )
      .is('concluida_em', null)
      .order('vence_em', { ascending: true })
      .order('criado_em', { ascending: true })
      .order('id', { ascending: true })

    query =
      responsavelId === null
        ? query.is('leads.responsavel_id', null)
        : query.eq('leads.responsavel_id', responsavelId)

    const { data, error } = await query
    if (error) return falha(error.message)
    return ok((data as unknown as LinhaTarefa[]).map(paraTarefa))
  }

  async criar(d: {
    leadId: string
    titulo: string
    tipo: TipoTarefa
    venceEm: Date
  }): Promise<Resultado<string>> {
    const { data, error } = await this.cliente
      .from('tasks')
      .insert({
        lead_id: d.leadId,
        titulo: d.titulo,
        tipo: d.tipo,
        vence_em: d.venceEm.toISOString(),
        criado_por: this.usuarioId,
      })
      .select('id')
      .single()
    if (error) return falha(error.message)
    return ok(data.id)
  }

  async concluir(id: string): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('tasks')
      .update({
        concluida_em: new Date().toISOString(),
        concluida_por: this.usuarioId,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id')
    if (error) return falha(error.message)
    // Zero linhas depois da RLS e' "nao encontrado" — id inexistente OU
    // tarefa fora do alcance, indistinguiveis daqui, mesma convencao de
    // marcarLida em notificacoes.ts. Nunca um sucesso mudo.
    if (!data || data.length === 0) return falha('tarefa_nao_encontrada')
    return ok(undefined)
  }

  async reabrir(id: string): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('tasks')
      .update({
        concluida_em: null,
        concluida_por: null,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id')
    if (error) return falha(error.message)
    if (!data || data.length === 0) return falha('tarefa_nao_encontrada')
    return ok(undefined)
  }

  async excluir(id: string): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('tasks')
      .delete()
      .eq('id', id)
      .select('id')
    if (error) return falha(error.message)
    if (!data || data.length === 0) return falha('tarefa_nao_encontrada')
    return ok(undefined)
  }
}

export async function criarTarefaStoreDoServidor(): Promise<Resultado<TarefaStore>> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  if (!sessao.user) return falha('sem_sessao')
  return ok(new SupabaseTarefaStore(cliente, sessao.user.id))
}
