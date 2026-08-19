import type { SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { sessaoDoServidor } from './sessao'

export type Notificacao = {
  id: string
  leadId: string
  leadNome: string
  tipo: 'novo_lead' | 'lead_reincidente'
  lidaEm: Date | null
  criadoEm: Date
}

/** O que o sino precisa. Escrita restrita a lida_em — quem cria a notificacao
 * e' ingerir_lead (0011), SECURITY DEFINER; a UI so marca como lida. */
export interface NotificacaoStore {
  listar(limite: number): Promise<Resultado<Notificacao[]>>
  naoLidas(): Promise<Resultado<number>>
  marcarLida(id: string): Promise<Resultado<void>>
  marcarTodasLidas(): Promise<Resultado<void>>
}

type LinhaNotificacao = {
  id: string
  lead_id: string
  tipo: 'novo_lead' | 'lead_reincidente'
  lida_em: string | null
  criado_em: string
  // Embed a to-one via a FK notifications.lead_id -> leads.id. Sem hint
  // `!inner`, o PostgREST faz LEFT JOIN: se leads_select negar a linha (o lead
  // saiu do alcance do usuario depois da notificacao ter sido criada), este
  // campo chega null em vez de a linha inteira sumir da resposta.
  leads: { nome: string } | null
}

/** Rotulo generico para quando o join com leads volta null pela RLS — ver
 * comentario de LinhaNotificacao. Nunca falta na tela por causa de um lead
 * que o usuario nao pode mais ver. */
const NOME_LEAD_INVISIVEL = 'Lead sem acesso'

function paraNotificacao(l: LinhaNotificacao): Notificacao {
  return {
    id: l.id,
    leadId: l.lead_id,
    leadNome: l.leads?.nome ?? NOME_LEAD_INVISIVEL,
    tipo: l.tipo,
    lidaEm: l.lida_em ? new Date(l.lida_em) : null,
    criadoEm: new Date(l.criado_em),
  }
}

export class SupabaseNotificacaoStore implements NotificacaoStore {
  constructor(private readonly cliente: SupabaseClient) {}

  async listar(limite: number): Promise<Resultado<Notificacao[]>> {
    // Sem .eq('usuario_id', ...) de proposito: notifications_dono_select ja
    // restringe a auth.uid(), e diferente de leads (onde um usuario pode
    // pertencer a mais de uma conta e account_id escolhe qual) usuario_id =
    // auth.uid() e sempre exatamente "eu" — um filtro aqui repetiria a policy
    // sem mudar uma linha do resultado.
    const { data, error } = await this.cliente
      .from('notifications')
      .select('id, lead_id, tipo, lida_em, criado_em, leads(nome)')
      .order('criado_em', { ascending: false })
      .limit(limite)
    if (error) return falha(error.message)
    return ok((data as unknown as LinhaNotificacao[]).map(paraNotificacao))
  }

  async naoLidas(): Promise<Resultado<number>> {
    const { count, error } = await this.cliente
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('lida_em', null)
    if (error) return falha(error.message)
    return ok(count ?? 0)
  }

  async marcarLida(id: string): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('notifications')
      .update({ lida_em: new Date().toISOString() })
      .eq('id', id)
      .select('id')
    if (error) return falha(error.message)
    // Zero linhas depois da RLS e "nao encontrado" — id inexistente OU
    // notificacao de outro usuario, os dois indistinguiveis daqui, igual ao
    // resto do app (ver definirResponsavel em fontes.ts). Marcar de novo uma
    // notificacao PROPRIA ja lida cai no ramo de cima com sucesso (idempotente);
    // este ramo so existe para nao fingir sucesso quando a RLS negou a linha.
    if (!data || data.length === 0) return falha('notificacao_nao_encontrada')
    return ok(undefined)
  }

  async marcarTodasLidas(): Promise<Resultado<void>> {
    // .is('lida_em', null), sem usuario_id: notifications_dono_update ja
    // restringe as linhas visiveis/atualizaveis a auth.uid() — e a mesma
    // garantia que o Realtime usa para rotear (ver 0009 e sino.tsx).
    const { error } = await this.cliente
      .from('notifications')
      .update({ lida_em: new Date().toISOString() })
      .is('lida_em', null)
    if (error) return falha(error.message)
    return ok(undefined)
  }
}

export async function criarNotificacaoStoreDoServidor(): Promise<Resultado<NotificacaoStore>> {
  const sessao = await sessaoDoServidor()
  if (!sessao.ok) return falha(sessao.erro)
  return ok(new SupabaseNotificacaoStore(sessao.valor.cliente))
}
