import { randomUUID } from 'node:crypto'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Provedor } from '@/lib/domain/fonte'
import type { DadosDoLead } from '@/lib/ingestao/dados'
import type { EntregaParaProcessar, IngestaoStore, ResultadoEntrega } from './ingestao'

type StatusLog = 'pendente' | 'processado' | 'ignorado' | 'falhou'

type LinhaLog = {
  id: string
  provedor: Provedor
  externalId: string
  payload: Record<string, unknown>
  token: string | null
  status: StatusLog
  leadId: string | null
  tentativas: number
}

/**
 * Test double do IngestaoStore. Nao simula RLS nem o unique index do Postgres
 * (integration_log_provedor_external_idx da 0009) -- so o banco testa isso,
 * mesma fronteira do InMemoryCrmStore (data/memory.ts).
 *
 * Guarda tudo em Map/array e expoe o que aconteceu (`entregas`, `ingeridos`,
 * `falhas`) para o teste asseverar sobre ESTADO do duplo -- nunca com spy,
 * regra do projeto inteiro.
 */
export class InMemoryIngestaoStore implements IngestaoStore {
  private logs = new Map<string, LinhaLog>()

  readonly entregas: {
    provedor: Provedor
    externalId: string
    payload: Record<string, unknown>
    chaveDaFonte: string
    googleKey: string | null
  }[] = []
  readonly ingeridos: { logId: string; dados: DadosDoLead }[] = []
  readonly falhas: { logId: string; erro: string }[] = []

  /**
   * So para teste: injeta um log pronto sem passar por `registrarEntrega`.
   * E o jeito direto de simular o estado que a rota ou o cron encontrariam --
   * por exemplo um log ja 'processado' por uma corrida entre o after() da
   * rota e a varredura do cron, o cenario que prova que `ja_processado` nao
   * e falha (Task 7, caso 8).
   */
  semearLog(
    logId: string,
    status: StatusLog = 'pendente',
    leadId: string | null = null,
    extra?: Partial<Pick<LinhaLog, 'provedor' | 'externalId' | 'payload' | 'token' | 'tentativas'>>,
  ): void {
    this.logs.set(logId, {
      id: logId,
      provedor: extra?.provedor ?? 'meta',
      externalId: extra?.externalId ?? `externo-${logId}`,
      payload: extra?.payload ?? {},
      token: extra?.token ?? null,
      status,
      leadId,
      tentativas: extra?.tentativas ?? 0,
    })
  }

  async registrarEntrega(e: {
    provedor: Provedor
    externalId: string
    payload: Record<string, unknown>
    chaveDaFonte: string
    googleKey?: string | null
  }): Promise<Resultado<ResultadoEntrega>> {
    this.entregas.push({ ...e, googleKey: e.googleKey ?? null })

    // Mesma regra do indice unico da 0009: reenvio do provedor (mesmo par
    // provedor+externalId) e no-op, nunca card duplicado.
    const existente = [...this.logs.values()].find(
      (l) => l.provedor === e.provedor && l.externalId === e.externalId,
    )
    if (existente) return ok({ logId: null, status: 'duplicado', token: null })

    const logId = randomUUID()
    // Sem fonte real para resolver (isso e trabalho do banco na 0010), o
    // duplo aceita toda entrega nova como pendente.
    const token = e.provedor === 'meta' ? 'token-de-teste' : null
    this.logs.set(logId, {
      id: logId,
      provedor: e.provedor,
      externalId: e.externalId,
      payload: e.payload,
      token,
      status: 'pendente',
      leadId: null,
      tentativas: 0,
    })
    return ok({ logId, status: 'pendente', token })
  }

  async ingerirLead(
    logId: string,
    dados: DadosDoLead,
  ): Promise<Resultado<{ status: string; leadId: string | null }>> {
    const log = this.logs.get(logId)
    if (!log) return falha('log_nao_encontrado')

    // Espelha o `if v_log.status not in ('pendente', 'falhou')` da 0011: um
    // log que ja virou lead (ou foi ignorado) nao processa de novo -- e a
    // idempotencia que impede a corrida after()/cron de duplicar o card.
    if (log.status !== 'pendente' && log.status !== 'falhou') {
      this.ingeridos.push({ logId, dados })
      return ok({ status: 'ja_processado', leadId: log.leadId })
    }

    const leadId = randomUUID()
    log.status = 'processado'
    log.leadId = leadId
    this.ingeridos.push({ logId, dados })
    return ok({ status: 'criado', leadId })
  }

  async registrarFalha(logId: string, erro: string): Promise<Resultado<void>> {
    this.falhas.push({ logId, erro })
    const log = this.logs.get(logId)
    // Espelha o `where ... and status in ('pendente', 'falhou')` da 0010: uma
    // retentativa tardia nao pode rebaixar um log que ja virou lead.
    if (log && (log.status === 'pendente' || log.status === 'falhou')) {
      log.status = 'falhou'
      log.tentativas += 1
    }
    return ok(undefined)
  }

  async entregasPendentes(limite: number): Promise<Resultado<EntregaParaProcessar[]>> {
    const saida = [...this.logs.values()]
      .filter((l) => l.status === 'pendente' || (l.status === 'falhou' && l.tentativas < 5))
      .slice(0, limite)
      .map((l) => ({ logId: l.id, provedor: l.provedor, payload: l.payload, token: l.token }))
    return ok(saida)
  }
}
