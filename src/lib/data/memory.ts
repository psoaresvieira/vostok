import { randomUUID } from 'node:crypto'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { normalizarNomeEtiqueta } from '@/lib/domain/normalizacao'
import type { NovoLead } from '@/lib/domain/lead'
import type { AplicacaoEtiqueta, LinhaCoorte } from '@/lib/domain/metricas'
import type {
  ColunaDoFunil,
  Conta,
  Etapa,
  Etiqueta,
  EventoLead,
  Lead,
  LeadDoFunil,
  Membro,
  MotivoPerda,
  Perfil,
  Pipeline,
} from '@/lib/domain/tipos'
import type { CrmStore, FiltroFunil, FiltroLeads, FiltroMetricas } from './store'

const ETAPAS_PADRAO: { nome: string; tipo: Etapa['tipo'] }[] = [
  { nome: 'Novo lead', tipo: 'aberta' },
  { nome: 'Contato feito', tipo: 'aberta' },
  { nome: 'Qualificação', tipo: 'aberta' },
  { nome: 'Proposta', tipo: 'aberta' },
  { nome: 'Fechamento', tipo: 'aberta' },
  { nome: 'Ganho', tipo: 'ganho' },
  { nome: 'Perdido', tipo: 'perdido' },
]

const MOTIVOS_PADRAO = [
  'Preço',
  'Sem orçamento',
  'Sem resposta',
  'Comprou do concorrente',
  'Fora do perfil',
]

type LeadTag = { leadId: string; tagId: string; stageIdNoMomento: string }

/** Test double do CrmStore. Nao simula RLS — isso so o Postgres testa. */
export class InMemoryCrmStore implements CrmStore {
  private conta: Conta | null = null
  private usuarioAtual = 'user-1'
  private membrosLista: Membro[] = []
  /** Ordem do array = ordem de criacao (a padrao nasce primeiro no semear).
   * listarPipelines() reordena so na leitura, poe a padrao na frente. */
  private pipelines: Pipeline[] = []
  /** Flat entre todas as pipelines — cada Etapa ja carrega pipelineId. */
  private etapas: Etapa[] = []
  private motivos: MotivoPerda[] = []
  private leads: Lead[] = []
  private tags: Etiqueta[] = []
  private leadTags: LeadTag[] = []
  private eventos: EventoLead[] = []
  /** Espelha stage_history. Sem ele, ordemMax so enxergaria a etapa atual e
   * lead que voltou de etapa perderia a profundidade que ja alcancou. */
  private movimentos: { leadId: string; origem: string | null; destino: string }[] = []

  semear(nomeConta: string, usuarioId: string): void {
    this.usuarioAtual = usuarioId
    const accountId = randomUUID()
    this.conta = { id: accountId, nome: nomeConta }
    this.membrosLista = [
      { id: usuarioId, nome: 'Admin', email: 'admin@teste.com', papel: 'admin' },
    ]
    const pipelinePadrao: Pipeline = { id: randomUUID(), nome: 'Funil de vendas', isDefault: true }
    this.pipelines = [pipelinePadrao]
    this.etapas = ETAPAS_PADRAO.map((e, i) => ({
      id: randomUUID(),
      pipelineId: pipelinePadrao.id,
      nome: e.nome,
      ordem: i + 1,
      tipo: e.tipo,
      slaHoras: null,
    }))
    this.motivos = MOTIVOS_PADRAO.map((nome) => ({ id: randomUUID(), nome, ativo: true }))
  }

  /** Só para teste: qual etapa ficou no snapshot da etiqueta. */
  etapaDaEtiqueta(leadId: string, nomeTag: string): string | null {
    const tag = this.acharTag(nomeTag)
    if (!tag) return null
    const rel = this.leadTags.find((lt) => lt.leadId === leadId && lt.tagId === tag.id)
    return rel?.stageIdNoMomento ?? null
  }

  private acharTag(nome: string): Etiqueta | undefined {
    const alvo = normalizarNomeEtiqueta(nome).toLowerCase()
    return this.tags.find((t) => t.nome.toLowerCase() === alvo)
  }

  private etapaPorId(id: string): Etapa | undefined {
    return this.etapas.find((e) => e.id === id)
  }

  async contaAtiva(): Promise<Resultado<Conta | null>> {
    return ok(this.conta)
  }

  async perfilAtual(): Promise<Resultado<Perfil | null>> {
    const eu = this.membrosLista.find((m) => m.id === this.usuarioAtual)
    return ok(eu ? { id: eu.id, nome: eu.nome, email: eu.email } : null)
  }

  async membros(): Promise<Resultado<Membro[]>> {
    return ok([...this.membrosLista])
  }

  async pipelinePadrao(): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>> {
    const pipeline = this.pipelines.find((p) => p.isDefault)
    if (!pipeline) return falha('pipeline_nao_encontrado')
    return this.pipelinePorId(pipeline.id)
  }

  async listarPipelines(): Promise<Resultado<Pipeline[]>> {
    const padrao = this.pipelines.filter((p) => p.isDefault)
    const demais = this.pipelines.filter((p) => !p.isDefault)
    return ok([...padrao, ...demais])
  }

  async listarPipelinesComEtapas(): Promise<
    Resultado<{ pipeline: Pipeline; etapas: Etapa[] }[]>
  > {
    const lista = await this.listarPipelines()
    if (!lista.ok) return falha(lista.erro)
    return ok(
      lista.valor.map((pipeline) => ({
        pipeline,
        etapas: this.etapas
          .filter((e) => e.pipelineId === pipeline.id)
          .sort((a, b) => a.ordem - b.ordem),
      })),
    )
  }

  async pipelinePorId(
    pipelineId: string,
  ): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>> {
    const pipeline = this.pipelines.find((p) => p.id === pipelineId)
    if (!pipeline) return falha('pipeline_nao_encontrado')
    const etapas = this.etapas
      .filter((e) => e.pipelineId === pipelineId)
      .sort((a, b) => a.ordem - b.ordem)
    return ok({ pipeline, etapas })
  }

  async criarPipeline(nome: string, etapasAbertas: string[]): Promise<Resultado<string>> {
    const id = randomUUID()
    this.pipelines.push({ id, nome, isDefault: false })
    const abertas: Etapa[] = etapasAbertas.map((nomeEtapa, i) => ({
      id: randomUUID(),
      pipelineId: id,
      nome: nomeEtapa,
      ordem: i + 1,
      tipo: 'aberta',
      slaHoras: null,
    }))
    const encerramento: Etapa[] = [
      {
        id: randomUUID(),
        pipelineId: id,
        nome: 'Ganho',
        ordem: abertas.length + 1,
        tipo: 'ganho',
        slaHoras: null,
      },
      {
        id: randomUUID(),
        pipelineId: id,
        nome: 'Perdido',
        ordem: abertas.length + 2,
        tipo: 'perdido',
        slaHoras: null,
      },
    ]
    this.etapas.push(...abertas, ...encerramento)
    return ok(id)
  }

  async renomearPipeline(pipelineId: string, nome: string): Promise<Resultado<void>> {
    const pipeline = this.pipelines.find((p) => p.id === pipelineId)
    if (!pipeline) return falha('pipeline_nao_encontrado')
    pipeline.nome = nome
    return ok(undefined)
  }

  async excluirPipeline(pipelineId: string): Promise<Resultado<void>> {
    const pipeline = this.pipelines.find((p) => p.id === pipelineId)
    if (!pipeline) return falha('pipeline_nao_encontrado')
    if (pipeline.isDefault) return falha('pipeline_padrao_nao_exclui')
    if (this.leads.some((l) => l.pipelineId === pipelineId)) return falha('pipeline_com_leads')
    this.pipelines = this.pipelines.filter((p) => p.id !== pipelineId)
    this.etapas = this.etapas.filter((e) => e.pipelineId !== pipelineId)
    return ok(undefined)
  }

  async motivosPerda(): Promise<Resultado<MotivoPerda[]>> {
    return ok(this.motivos.filter((m) => m.ativo))
  }

  async listarLeads(filtro: FiltroLeads): Promise<Resultado<Lead[]>> {
    let saida = [...this.leads]
    if (filtro.pipelineId) {
      saida = saida.filter((l) => l.pipelineId === filtro.pipelineId)
    }
    if (filtro.responsavelId) {
      saida = saida.filter((l) => l.responsavelId === filtro.responsavelId)
    }
    if (filtro.origem) {
      saida = saida.filter((l) => l.origem === filtro.origem)
    }
    if (filtro.desde) {
      saida = saida.filter((l) => l.criadoEm >= filtro.desde!)
    }
    if (filtro.busca) {
      const alvo = filtro.busca.toLowerCase()
      saida = saida.filter(
        (l) =>
          l.nome.toLowerCase().includes(alvo) ||
          (l.telefoneE164 ?? '').includes(alvo) ||
          (l.emailNorm ?? '').includes(alvo),
      )
    }
    // criado_em desc com id como desempate: mesma ordem do SELECT_LEAD do
    // store do Supabase e da RPC leads_do_funil, para os dois stores
    // paginarem igual.
    saida.sort((a, b) => {
      const porData = b.criadoEm.getTime() - a.criadoEm.getTime()
      return porData !== 0 ? porData : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    })
    return ok(filtro.limite != null ? saida.slice(0, filtro.limite) : saida)
  }

  /**
   * Espelho em memoria de `leads_do_funil` (migration 0027): o mesmo recorte,
   * a mesma ordem e a mesma regra de `somaCents` null quando nenhum lead da
   * coluna tem valor.
   */
  async leadsDoFunil(filtro: FiltroFunil): Promise<Resultado<ColunaDoFunil[]>> {
    const todos = await this.listarLeads({
      pipelineId: filtro.pipelineId,
      responsavelId: filtro.responsavelId,
      origem: filtro.origem,
      desde: filtro.desde,
      busca: filtro.busca,
    })
    if (!todos.ok) return falha(todos.erro)

    const offset = filtro.offset ?? 0
    const alvo = filtro.etapaId ?? null
    const porEtapa = new Map<string, Lead[]>()
    for (const lead of todos.valor) {
      if (alvo !== null && lead.stageId !== alvo) continue
      const lista = porEtapa.get(lead.stageId)
      if (lista) lista.push(lead)
      else porEtapa.set(lead.stageId, [lead])
    }

    const paraCartao = (l: Lead): LeadDoFunil => ({
      id: l.id,
      nome: l.nome,
      stageId: l.stageId,
      responsavelId: l.responsavelId,
      valorCents: l.valorCents,
      entrouNaEtapaEm: l.entrouNaEtapaEm,
      telefoneE164: l.telefoneE164,
      criadoEm: l.criadoEm,
      etiquetas: l.etiquetas,
    })

    return ok(
      [...porEtapa.entries()].map(([etapaId, leads]) => ({
        etapaId,
        leads: leads.slice(offset, offset + filtro.limite).map(paraCartao),
        total: leads.length,
        somaCents: leads.some((l) => l.valorCents !== null)
          ? leads.reduce((acc, l) => acc + (l.valorCents ?? 0), 0)
          : null,
      })),
    )
  }

  async buscarLead(leadId: string): Promise<Resultado<Lead | null>> {
    return ok(this.leads.find((l) => l.id === leadId) ?? null)
  }

  async criarLead(
    dados: NovoLead & { pipelineId: string; stageId: string },
  ): Promise<Resultado<string>> {
    if (!this.conta) return falha('sem_conta')
    const agora = new Date()
    const lead: Lead = {
      id: randomUUID(),
      accountId: this.conta.id,
      nome: dados.nome,
      telefone: dados.telefone,
      telefoneE164: dados.telefoneE164,
      email: dados.email,
      emailNorm: dados.emailNorm,
      empresa: dados.empresa,
      origem: 'manual',
      pipelineId: dados.pipelineId,
      stageId: dados.stageId,
      responsavelId: dados.responsavelId,
      status: 'aberto',
      valorCents: dados.valorCents,
      lossReasonId: null,
      entrouNaEtapaEm: agora,
      criadoEm: agora,
      atualizadoEm: agora,
      etiquetas: [],
    }
    this.leads.push(lead)
    this.eventos.push({
      id: randomUUID(),
      leadId: lead.id,
      tipo: 'lead_criado',
      payload: { origem: 'manual' },
      atorId: this.usuarioAtual,
      criadoEm: agora,
    })
    return ok(lead.id)
  }

  async possiveisDuplicados(
    telefoneE164: string | null,
    emailNorm: string | null,
  ): Promise<Resultado<Lead[]>> {
    if (!telefoneE164 && !emailNorm) return ok([])
    return ok(
      this.leads.filter(
        (l) =>
          (telefoneE164 !== null && l.telefoneE164 === telefoneE164) ||
          (emailNorm !== null && l.emailNorm === emailNorm),
      ),
    )
  }

  /**
   * Nucleo compartilhado por moverEtapa e moverParaPipeline: valida motivo de
   * perda, grava o movimento (stage_history) e muta o lead. Cada chamador
   * cuida das suas proprias guardas e do seu proprio evento — este metodo nao
   * empurra evento nenhum.
   */
  private aplicarMovimento(
    lead: Lead,
    destino: Etapa,
    lossReasonId?: string | null,
  ): Resultado<{ origem: string; agora: Date }> {
    if (destino.tipo === 'perdido') {
      if (!lossReasonId) return falha('motivo_perda_obrigatorio')
      if (!this.motivos.some((m) => m.id === lossReasonId && m.ativo)) {
        return falha('motivo_perda_invalido')
      }
    }

    const origem = lead.stageId
    const agora = new Date()
    // Espelha stage_history: metricasDaCoorte precisa da uniao de toda etapa
    // que o lead ja ocupou, nao so da atual.
    this.movimentos.push({ leadId: lead.id, origem, destino: destino.id })
    lead.pipelineId = destino.pipelineId
    lead.stageId = destino.id
    lead.status = destino.tipo === 'aberta' ? 'aberto' : destino.tipo
    lead.lossReasonId = destino.tipo === 'perdido' ? lossReasonId! : null
    lead.entrouNaEtapaEm = agora
    lead.atualizadoEm = agora
    return ok({ origem, agora })
  }

  async moverEtapa(
    leadId: string,
    stageDestino: string,
    lossReasonId?: string | null,
  ): Promise<Resultado<void>> {
    const lead = this.leads.find((l) => l.id === leadId)
    if (!lead) return falha('lead_nao_encontrado')
    const destino = this.etapaPorId(stageDestino)
    if (!destino) return falha('etapa_invalida')
    // Espelha move_lead_stage (0032): etapa de outra pipeline e' invalida
    // aqui — trocar de funil e' trabalho de moverParaPipeline.
    if (destino.pipelineId !== lead.pipelineId) return falha('etapa_invalida')

    const r = this.aplicarMovimento(lead, destino, lossReasonId)
    if (!r.ok) return r

    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'etapa_alterada',
      payload: { de: r.valor.origem, para: destino.id, loss_reason_id: lossReasonId ?? null },
      atorId: this.usuarioAtual,
      criadoEm: r.valor.agora,
    })
    return ok(undefined)
  }

  async moverParaPipeline(
    leadId: string,
    stageDestino: string,
    lossReasonId?: string | null,
  ): Promise<Resultado<void>> {
    const lead = this.leads.find((l) => l.id === leadId)
    if (!lead) return falha('lead_nao_encontrado')
    const destino = this.etapaPorId(stageDestino)
    if (!destino) return falha('etapa_invalida')
    // Espelha a RPC mover_lead_pipeline (0032): mover dentro do mesmo funil e'
    // trabalho de moverEtapa, nao um segundo caminho por aqui.
    if (destino.pipelineId === lead.pipelineId) return falha('mesma_pipeline')

    const pipelineOrigem = lead.pipelineId
    const r = this.aplicarMovimento(lead, destino, lossReasonId)
    if (!r.ok) return r

    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'pipeline_alterada',
      payload: {
        de_pipeline: pipelineOrigem,
        para_pipeline: destino.pipelineId,
        de: r.valor.origem,
        para: destino.id,
        loss_reason_id: lossReasonId ?? null,
      },
      atorId: this.usuarioAtual,
      criadoEm: r.valor.agora,
    })
    return ok(undefined)
  }

  async atribuirResponsavel(
    leadId: string,
    responsavelId: string | null,
  ): Promise<Resultado<void>> {
    const lead = this.leads.find((l) => l.id === leadId)
    if (!lead) return falha('lead_nao_encontrado')
    const anterior = lead.responsavelId
    lead.responsavelId = responsavelId
    lead.atualizadoEm = new Date()
    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'responsavel_alterado',
      payload: { de: anterior, para: responsavelId },
      atorId: this.usuarioAtual,
      criadoEm: new Date(),
    })
    return ok(undefined)
  }

  async etiquetasDaConta(): Promise<Resultado<Etiqueta[]>> {
    return ok([...this.tags])
  }

  async aplicarEtiquetas(leadId: string, nomes: string[]): Promise<Resultado<void>> {
    const lead = this.leads.find((l) => l.id === leadId)
    if (!lead) return falha('lead_nao_encontrado')

    for (const bruto of nomes) {
      const nome = normalizarNomeEtiqueta(bruto)
      if (nome.length === 0) continue
      let tag = this.acharTag(nome)
      if (!tag) {
        tag = { id: randomUUID(), nome }
        this.tags.push(tag)
      }
      if (this.leadTags.some((lt) => lt.leadId === leadId && lt.tagId === tag.id)) continue
      // Snapshot: a etapa em que o lead estava quando a etiqueta foi aplicada.
      this.leadTags.push({ leadId, tagId: tag.id, stageIdNoMomento: lead.stageId })
      lead.etiquetas.push(tag)
      this.eventos.push({
        id: randomUUID(),
        leadId,
        tipo: 'etiqueta_aplicada',
        payload: { tag: tag.nome, etapa: lead.stageId },
        atorId: this.usuarioAtual,
        criadoEm: new Date(),
      })
    }
    return ok(undefined)
  }

  async removerEtiqueta(leadId: string, tagId: string): Promise<Resultado<void>> {
    const lead = this.leads.find((l) => l.id === leadId)
    if (!lead) return falha('lead_nao_encontrado')

    const indice = this.leadTags.findIndex((lt) => lt.leadId === leadId && lt.tagId === tagId)
    // Idempotente de proposito — ver o comentario do port em store.ts.
    if (indice === -1) return ok(undefined)

    const tag = this.tags.find((t) => t.id === tagId)
    this.leadTags.splice(indice, 1)
    lead.etiquetas = lead.etiquetas.filter((e) => e.id !== tagId)
    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'etiqueta_removida',
      payload: { tag: tag?.nome ?? '?' },
      atorId: this.usuarioAtual,
      criadoEm: new Date(),
    })
    return ok(undefined)
  }

  async eventosDoLead(leadId: string, limite?: number): Promise<Resultado<EventoLead[]>> {
    const ordenados =
      this.eventos
        // Guarda o indice de insercao antes de filtrar/ordenar: e o desempate
        // quando dois eventos nascem no mesmo milissegundo (new Date() so tem
        // 1ms de resolucao, entao duas mutacoes seguidas sem await no meio —
        // comum em teste, e possivel em producao — colidem no timestamp).
        .map((e, indice) => ({ e, indice }))
        .filter(({ e }) => e.leadId === leadId)
        .sort((a, b) => {
          const porData = b.e.criadoEm.getTime() - a.e.criadoEm.getTime()
          // Em empate, quem foi inserido depois e mais novo e vem primeiro —
          // sort() e estavel, entao sem isso o empate cai na ordem de insercao
          // (mais antigo primeiro), o oposto do contrato "mais recente primeiro".
          return porData !== 0 ? porData : b.indice - a.indice
        })
        .map(({ e }) => e)

    return ok(limite != null ? ordenados.slice(0, limite) : ordenados)
  }

  async registrarNota(leadId: string, texto: string): Promise<Resultado<void>> {
    if (!this.leads.some((l) => l.id === leadId)) return falha('lead_nao_encontrado')
    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'nota',
      payload: { texto },
      atorId: this.usuarioAtual,
      criadoEm: new Date(),
    })
    return ok(undefined)
  }

  async registrarEnvioWhatsApp(
    leadId: string,
    d: { template: string; texto: string },
  ): Promise<Resultado<void>> {
    if (!this.leads.some((l) => l.id === leadId)) return falha('lead_nao_encontrado')
    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'whatsapp_enviado',
      // Snapshot do que o cliente recebeu, como no Supabase store.
      payload: { template: d.template, texto: d.texto },
      atorId: this.usuarioAtual,
      criadoEm: new Date(),
    })
    return ok(undefined)
  }

  async metricasDaCoorte(f: FiltroMetricas): Promise<Resultado<LinhaCoorte[]>> {
    const ordemDe = new Map(this.etapas.map((e) => [e.id, e]))
    const linhas = this.leads
      .filter(
        (l) =>
          l.pipelineId === f.pipelineId &&
          l.criadoEm >= f.de &&
          l.criadoEm < f.ate &&
          (f.responsavelId == null || l.responsavelId === f.responsavelId),
      )
      .map((l) => {
        // Mesma uniao do SQL: stage atual + toda origem e destino do
        // historico, filtrando so etapa aberta.
        const ocupadas = new Set<string>([l.stageId])
        for (const m of this.movimentos.filter((m) => m.leadId === l.id)) {
          if (m.origem) ocupadas.add(m.origem)
          ocupadas.add(m.destino)
        }
        const ordens = [...ocupadas]
          .map((id) => ordemDe.get(id))
          .filter((e) => e?.tipo === 'aberta')
          .map((e) => e!.ordem)
        return {
          leadId: l.id,
          criadoEm: l.criadoEm,
          origem: l.origem,
          status: l.status,
          responsavelId: l.responsavelId,
          campanhaId: null,
          campanhaNome: null,
          conjuntoId: null,
          conjuntoNome: null,
          anuncioId: null,
          anuncioNome: null,
          ordemMax: ordens.length > 0 ? Math.max(...ordens) : 0,
        }
      })
    return ok(linhas)
  }

  async etiquetasDaCoorte(f: FiltroMetricas): Promise<Resultado<AplicacaoEtiqueta[]>> {
    const ordemDe = new Map(this.etapas.map((e) => [e.id, e.ordem]))
    const naJanela = new Set(
      this.leads
        .filter(
          (l) =>
            l.pipelineId === f.pipelineId &&
            l.criadoEm >= f.de &&
            l.criadoEm < f.ate &&
            (f.responsavelId == null || l.responsavelId === f.responsavelId),
        )
        .map((l) => l.id),
    )
    const porId = new Map(this.tags.map((t) => [t.id, t.nome]))
    return ok(
      this.leadTags
        .filter((lt) => naJanela.has(lt.leadId))
        .map((lt) => ({
          leadId: lt.leadId,
          tagId: lt.tagId,
          tagNome: porId.get(lt.tagId) ?? '',
          stageIdNoMomento: lt.stageIdNoMomento,
          ordemNoMomento: ordemDe.get(lt.stageIdNoMomento) ?? 0,
        })),
    )
  }
}
