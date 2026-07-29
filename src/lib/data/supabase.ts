import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { normalizarNomeEtiqueta } from '@/lib/domain/normalizacao'
import type { NovoLead } from '@/lib/domain/lead'
import type {
  Conta,
  Etapa,
  Etiqueta,
  EventoLead,
  Lead,
  Membro,
  MotivoPerda,
  Papel,
  Pipeline,
} from '@/lib/domain/tipos'
import type { CrmStore, FiltroLeads } from './store'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { resolverContaAtiva } from './conta'
import { valorPostgrest, padraoIlike } from './filtro'

type LinhaLead = {
  id: string
  account_id: string
  nome: string
  telefone: string | null
  telefone_e164: string | null
  email: string | null
  email_norm: string | null
  empresa: string | null
  origem: Lead['origem']
  pipeline_id: string
  stage_id: string
  responsavel_id: string | null
  status: Lead['status']
  valor_cents: number | null
  loss_reason_id: string | null
  entrou_na_etapa_em: string
  criado_em: string
  atualizado_em: string
  lead_tags?: { tags: { id: string; nome: string } }[]
}

function paraLead(linha: LinhaLead): Lead {
  return {
    id: linha.id,
    accountId: linha.account_id,
    nome: linha.nome,
    telefone: linha.telefone,
    telefoneE164: linha.telefone_e164,
    email: linha.email,
    emailNorm: linha.email_norm,
    empresa: linha.empresa,
    origem: linha.origem,
    pipelineId: linha.pipeline_id,
    stageId: linha.stage_id,
    responsavelId: linha.responsavel_id,
    status: linha.status,
    valorCents: linha.valor_cents,
    lossReasonId: linha.loss_reason_id,
    entrouNaEtapaEm: new Date(linha.entrou_na_etapa_em),
    criadoEm: new Date(linha.criado_em),
    atualizadoEm: new Date(linha.atualizado_em),
    etiquetas: (linha.lead_tags ?? []).map((lt) => ({ id: lt.tags.id, nome: lt.tags.nome })),
  }
}

const SELECT_LEAD =
  '*, lead_tags(tags(id, nome))'

export class SupabaseCrmStore implements CrmStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly accountId: string,
    private readonly usuarioId: string,
  ) {}

  async contaAtiva(): Promise<Resultado<Conta | null>> {
    const { data, error } = await this.cliente
      .from('accounts')
      .select('id, nome')
      .eq('id', this.accountId)
      .maybeSingle()
    if (error) return falha(error.message)
    return ok(data ? { id: data.id, nome: data.nome } : null)
  }

  async membros(): Promise<Resultado<Membro[]>> {
    const { data, error } = await this.cliente
      .from('memberships')
      .select('papel, profiles(id, nome, email)')
      .eq('account_id', this.accountId)
    if (error) return falha(error.message)
    const linhas = (data ?? []) as unknown as {
      papel: Papel
      profiles: { id: string; nome: string; email: string }
    }[]
    return ok(
      linhas.map((l) => ({
        id: l.profiles.id,
        nome: l.profiles.nome,
        email: l.profiles.email,
        papel: l.papel,
      })),
    )
  }

  async pipelinePadrao(): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>> {
    const { data: p, error: erroP } = await this.cliente
      .from('pipelines')
      .select('id, nome, is_default')
      .eq('account_id', this.accountId)
      .eq('is_default', true)
      .maybeSingle()
    if (erroP) return falha(erroP.message)
    if (!p) return falha('pipeline_nao_encontrado')

    const { data: s, error: erroS } = await this.cliente
      .from('stages')
      .select('id, pipeline_id, nome, ordem, tipo, sla_horas')
      .eq('pipeline_id', p.id)
      .order('ordem')
    if (erroS) return falha(erroS.message)

    return ok({
      pipeline: { id: p.id, nome: p.nome, isDefault: p.is_default },
      etapas: (s ?? []).map((e) => ({
        id: e.id,
        pipelineId: e.pipeline_id,
        nome: e.nome,
        ordem: e.ordem,
        tipo: e.tipo,
        slaHoras: e.sla_horas,
      })),
    })
  }

  async motivosPerda(): Promise<Resultado<MotivoPerda[]>> {
    const { data, error } = await this.cliente
      .from('loss_reasons')
      .select('id, nome, ativo')
      .eq('account_id', this.accountId)
      .eq('ativo', true)
      .order('nome')
    if (error) return falha(error.message)
    return ok(data ?? [])
  }

  async listarLeads(filtro: FiltroLeads): Promise<Resultado<Lead[]>> {
    let q = this.cliente
      .from('leads')
      .select(SELECT_LEAD)
      .eq('account_id', this.accountId)
      .order('criado_em', { ascending: false })

    if (filtro.responsavelId) q = q.eq('responsavel_id', filtro.responsavelId)
    if (filtro.origem) q = q.eq('origem', filtro.origem)
    if (filtro.desde) q = q.gte('criado_em', filtro.desde.toISOString())
    if (filtro.busca) {
      // padraoIlike, e nao `%${busca}%`: o texto do usuario ia cru para o
      // PostgREST, entao a virgula abria condicao OR extra e % e _ viravam
      // curinga (buscar "100%" casava com "1000 leads").
      const alvo = padraoIlike(filtro.busca)
      q = q.or(`nome.ilike.${alvo},telefone_e164.ilike.${alvo},email_norm.ilike.${alvo}`)
    }

    const { data, error } = await q
    if (error) return falha(error.message)
    return ok((data as unknown as LinhaLead[]).map(paraLead))
  }

  async buscarLead(leadId: string): Promise<Resultado<Lead | null>> {
    const { data, error } = await this.cliente
      .from('leads')
      .select(SELECT_LEAD)
      .eq('id', leadId)
      .maybeSingle()
    // Com RLS ativa, sem permissao vem zero linhas — nao e erro, e "nao encontrado".
    if (error) return falha(error.message)
    return ok(data ? paraLead(data as unknown as LinhaLead) : null)
  }

  async criarLead(
    dados: NovoLead & { pipelineId: string; stageId: string },
  ): Promise<Resultado<string>> {
    const { data, error } = await this.cliente
      .from('leads')
      .insert({
        account_id: this.accountId,
        nome: dados.nome,
        telefone: dados.telefone,
        telefone_e164: dados.telefoneE164,
        email: dados.email,
        email_norm: dados.emailNorm,
        empresa: dados.empresa,
        origem: 'manual',
        pipeline_id: dados.pipelineId,
        stage_id: dados.stageId,
        responsavel_id: dados.responsavelId,
        valor_cents: dados.valorCents,
      })
      .select('id')
      .single()
    if (error) return falha(codigoDoErroPostgres(error))

    await this.cliente.from('lead_events').insert({
      lead_id: data.id,
      tipo: 'lead_criado',
      payload: { origem: 'manual' },
      ator_id: this.usuarioId,
    })
    return ok(data.id)
  }

  async possiveisDuplicados(
    telefoneE164: string | null,
    emailNorm: string | null,
  ): Promise<Resultado<Lead[]>> {
    if (!telefoneE164 && !emailNorm) return ok([])
    const condicoes: string[] = []
    // Comparacao exata, entao aqui basta neutralizar a pontuacao da sintaxe:
    // um email como "a,b@x.com" abria uma condicao OR a mais.
    if (telefoneE164) condicoes.push(`telefone_e164.eq.${valorPostgrest(telefoneE164)}`)
    if (emailNorm) condicoes.push(`email_norm.eq.${valorPostgrest(emailNorm)}`)

    const { data, error } = await this.cliente
      .from('leads')
      .select(SELECT_LEAD)
      .eq('account_id', this.accountId)
      .or(condicoes.join(','))
    if (error) return falha(error.message)
    return ok((data as unknown as LinhaLead[]).map(paraLead))
  }

  async moverEtapa(
    leadId: string,
    stageDestino: string,
    lossReasonId?: string | null,
  ): Promise<Resultado<void>> {
    const { error } = await this.cliente.rpc('move_lead_stage', {
      p_lead_id: leadId,
      p_stage_destino: stageDestino,
      p_loss_reason_id: lossReasonId ?? null,
    })
    if (error) return falha(codigoDoErroPostgres(error))
    return ok(undefined)
  }

  async atribuirResponsavel(
    leadId: string,
    responsavelId: string | null,
  ): Promise<Resultado<void>> {
    const atual = await this.buscarLead(leadId)
    if (!atual.ok) return falha(atual.erro)
    if (!atual.valor) return falha('lead_nao_encontrado')

    const { error } = await this.cliente
      .from('leads')
      .update({ responsavel_id: responsavelId, atualizado_em: new Date().toISOString() })
      .eq('id', leadId)
    if (error) return falha(codigoDoErroPostgres(error))

    const { error: erroEvento } = await this.cliente.from('lead_events').insert({
      lead_id: leadId,
      tipo: 'responsavel_alterado',
      payload: { de: atual.valor.responsavelId, para: responsavelId },
      ator_id: this.usuarioId,
    })
    if (erroEvento) return falha(erroEvento.message)
    return ok(undefined)
  }

  async etiquetasDaConta(): Promise<Resultado<Etiqueta[]>> {
    const { data, error } = await this.cliente
      .from('tags')
      .select('id, nome')
      .eq('account_id', this.accountId)
      .order('nome')
    if (error) return falha(error.message)
    return ok(data ?? [])
  }

  async aplicarEtiquetas(leadId: string, nomes: string[]): Promise<Resultado<void>> {
    const lead = await this.buscarLead(leadId)
    if (!lead.ok) return falha(lead.erro)
    if (!lead.valor) return falha('lead_nao_encontrado')

    // Uma leitura so das etiquetas da conta, e o casamento acontece aqui em JS
    // por igualdade sem caixa — a mesma regra do InMemoryCrmStore.
    //
    // Antes era .ilike('nome', nome) por etiqueta, o que mandava o texto do
    // usuario como PADRAO: '10%' casava com '100 leads' (uma linha: id errado
    // reusado em silencio, inclusive no snapshot de stage_id_no_momento) e
    // 'lead_frio' casava com 'leadXfrio' (duas ou mais linhas: PGRST116 e a
    // mensagem crua do PostgREST na tela). Escapar %, _ e \ resolveria o
    // casamento, mas continuaria custando uma ida ao banco por etiqueta.
    const existentes = await this.etiquetasDaConta()
    if (!existentes.ok) return falha(existentes.erro)
    const idPorNome = new Map(existentes.valor.map((t) => [t.nome.toLowerCase(), t.id]))

    for (const bruto of nomes) {
      const nome = normalizarNomeEtiqueta(bruto)
      if (nome.length === 0) continue
      const chave = nome.toLowerCase()

      let tagId = idPorNome.get(chave)
      if (!tagId) {
        const { data: nova, error: erroInsert } = await this.cliente
          .from('tags')
          .insert({ account_id: this.accountId, nome, criado_por: this.usuarioId })
          .select('id')
          .single()
        if (erroInsert) return falha(erroInsert.message)
        const criada: string = nova.id
        tagId = criada
        // O mapa e a unica fonte do lote: sem isso, o mesmo nome repetido em
        // `nomes` criaria uma segunda etiqueta identica.
        idPorNome.set(chave, criada)
      }

      const { error: erroRel } = await this.cliente.from('lead_tags').upsert(
        {
          lead_id: leadId,
          tag_id: tagId,
          // Snapshot da etapa no momento da aplicacao — sem isso a metrica mente.
          stage_id_no_momento: lead.valor.stageId,
          criado_por: this.usuarioId,
        },
        { onConflict: 'lead_id,tag_id', ignoreDuplicates: true },
      )
      if (erroRel) return falha(erroRel.message)

      await this.cliente.from('lead_events').insert({
        lead_id: leadId,
        tipo: 'etiqueta_aplicada',
        payload: { tag: nome, etapa: lead.valor.stageId },
        ator_id: this.usuarioId,
      })
    }
    return ok(undefined)
  }

  async eventosDoLead(leadId: string): Promise<Resultado<EventoLead[]>> {
    const { data, error } = await this.cliente
      .from('lead_events')
      .select('id, lead_id, tipo, payload, ator_id, criado_em')
      .eq('lead_id', leadId)
      // Duas colunas de propósito: criado_em e o criterio de negocio, mas ele
      // empata sempre que dois eventos nascem na mesma transacao (now() e
      // constante dentro dela). seq e monotonica e desempata na mesma direcao
      // — mais novo primeiro —, igualando o criterio ao do InMemoryCrmStore.
      .order('criado_em', { ascending: false })
      .order('seq', { ascending: false })
    if (error) return falha(error.message)
    return ok(
      (data ?? []).map((e) => ({
        id: e.id,
        leadId: e.lead_id,
        tipo: e.tipo,
        payload: e.payload as Record<string, unknown>,
        atorId: e.ator_id,
        criadoEm: new Date(e.criado_em),
      })),
    )
  }

  async registrarNota(leadId: string, texto: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.from('lead_events').insert({
      lead_id: leadId,
      tipo: 'nota',
      payload: { texto },
      ator_id: this.usuarioId,
    })
    if (error) return falha(error.message)
    return ok(undefined)
  }
}

/**
 * Extrai o codigo do erro do PostgREST.
 *
 * Duas fontes bem diferentes de "codigo" aqui. As strings da lista abaixo sao
 * nossas: nos mesmas escrevemos `raise exception 'motivo_perda_obrigatorio'`
 * em funcoes como move_lead_stage, entao o texto e estavel e cassar por ele e
 * seguro, independente de locale.
 *
 * A negacao de RLS e outra historia: a policy nao levanta excecao com nome,
 * ela apenas nega, e o PostgREST devolve o texto padrao do servidor — que muda
 * conforme o lc_messages do Postgres. Cassar esse texto (ex.: /row-level
 * security policy/i) vaza a mensagem crua assim que o locale nao for ingles.
 * error.code, por outro lado, e o SQLSTATE: 42501 (insufficient_privilege) e
 * quem o Postgres devolve para negacao de RLS, e SQLSTATE nao muda com
 * locale. Confirmado empiricamente contra o Postgres local (supabase-js
 * devolve exatamente esse code na negacao de leads_insert/leads_update).
 * Em leads, a unica regra do with check que a UI consegue violar por DADO
 * (e nao por permissao) e a do responsavel — quem nao e membro da conta nem
 * chega a essa policy.
 */
function codigoDoErroPostgres(erro: Pick<PostgrestError, 'message' | 'code'>): string {
  const conhecidos = [
    'lead_nao_encontrado',
    'etapa_invalida',
    'motivo_perda_obrigatorio',
    'motivo_perda_invalido',
    'convite_invalido',
    'convite_expirado',
    'convite_ja_aceito',
    'sem_sessao',
  ]
  const achado = conhecidos.find((c) => erro.message.includes(c))
  if (achado) return achado

  if (erro.code === '42501') return 'responsavel_invalido'
  return erro.message
}

/** Resolve a conta ativa do usuario logado e devolve o store pronto. */
export async function criarStoreDoServidor(): Promise<
  Resultado<{ store: SupabaseCrmStore; conta: Conta; usuarioId: string; papel: Papel }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  const usuario = sessao.user
  if (!usuario) return falha('sem_sessao')

  const ativa = await resolverContaAtiva(cliente, usuario.id)
  if (!ativa.ok) return falha(ativa.erro)

  return ok({
    store: new SupabaseCrmStore(cliente, ativa.valor.conta.id, usuario.id),
    conta: ativa.valor.conta,
    usuarioId: usuario.id,
    papel: ativa.valor.papel,
  })
}
