import { randomUUID } from 'node:crypto'
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
  Pipeline,
} from '@/lib/domain/tipos'
import type { CrmStore, FiltroLeads } from './store'

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
  private pipeline: Pipeline | null = null
  private etapas: Etapa[] = []
  private motivos: MotivoPerda[] = []
  private leads: Lead[] = []
  private tags: Etiqueta[] = []
  private leadTags: LeadTag[] = []
  private eventos: EventoLead[] = []

  semear(nomeConta: string, usuarioId: string): void {
    this.usuarioAtual = usuarioId
    const accountId = randomUUID()
    this.conta = { id: accountId, nome: nomeConta }
    this.membrosLista = [
      { id: usuarioId, nome: 'Admin', email: 'admin@teste.com', papel: 'admin' },
    ]
    this.pipeline = { id: randomUUID(), nome: 'Funil de vendas', isDefault: true }
    this.etapas = ETAPAS_PADRAO.map((e, i) => ({
      id: randomUUID(),
      pipelineId: this.pipeline!.id,
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

  async membros(): Promise<Resultado<Membro[]>> {
    return ok([...this.membrosLista])
  }

  async pipelinePadrao(): Promise<Resultado<{ pipeline: Pipeline; etapas: Etapa[] }>> {
    if (!this.pipeline) return falha('pipeline_nao_encontrado')
    return ok({ pipeline: this.pipeline, etapas: [...this.etapas] })
  }

  async motivosPerda(): Promise<Resultado<MotivoPerda[]>> {
    return ok(this.motivos.filter((m) => m.ativo))
  }

  async listarLeads(filtro: FiltroLeads): Promise<Resultado<Lead[]>> {
    let saida = [...this.leads]
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
    return ok(saida)
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

  async moverEtapa(
    leadId: string,
    stageDestino: string,
    lossReasonId?: string | null,
  ): Promise<Resultado<void>> {
    const lead = this.leads.find((l) => l.id === leadId)
    if (!lead) return falha('lead_nao_encontrado')
    const destino = this.etapaPorId(stageDestino)
    if (!destino) return falha('etapa_invalida')

    if (destino.tipo === 'perdido') {
      if (!lossReasonId) return falha('motivo_perda_obrigatorio')
      if (!this.motivos.some((m) => m.id === lossReasonId && m.ativo)) {
        return falha('motivo_perda_invalido')
      }
    }

    const origem = lead.stageId
    const agora = new Date()
    lead.stageId = destino.id
    lead.status = destino.tipo === 'aberta' ? 'aberto' : destino.tipo
    lead.lossReasonId = destino.tipo === 'perdido' ? lossReasonId! : null
    lead.entrouNaEtapaEm = agora
    lead.atualizadoEm = agora

    this.eventos.push({
      id: randomUUID(),
      leadId,
      tipo: 'etapa_alterada',
      payload: { de: origem, para: destino.id, loss_reason_id: lossReasonId ?? null },
      atorId: this.usuarioAtual,
      criadoEm: agora,
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

  async eventosDoLead(leadId: string): Promise<Resultado<EventoLead[]>> {
    return ok(
      this.eventos
        .filter((e) => e.leadId === leadId)
        .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime()),
    )
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
}
