import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Provedor } from '@/lib/domain/fonte'
import type { DadosDoLead } from '@/lib/ingestao/dados'
import { paraPayload } from '@/lib/ingestao/dados'

/** O que a varredura do cron (Task 9) precisa para reprocessar uma entrega
 * sem voltar ao banco: o payload cru e, no Meta, o token da Page. Mesma
 * forma que `processarEntrega` (Task 7) recebe direto da rota. */
export type EntregaParaProcessar = {
  logId: string
  provedor: Provedor
  payload: Record<string, unknown>
  token: string | null
}

/** O que `registrar_entrega` (migration 0010) devolve. `status` nunca e
 * 'processado' nem 'falhou' aqui -- esses dois so existem depois que
 * `ingerir_lead`/`registrar_falha` rodam. */
export type ResultadoEntrega = {
  logId: string | null
  status: 'pendente' | 'ignorado' | 'duplicado'
  token: string | null
}

/** Port do lado de dados da ingestao. As tres RPCs de escrita (0010, 0011)
 * sao gateadas por segredo, nao por RLS/auth.uid() -- este e o unico port do
 * projeto que fala com o banco sem sessao de usuario. */
export interface IngestaoStore {
  registrarEntrega(e: {
    provedor: Provedor
    externalId: string
    payload: Record<string, unknown>
    chaveDaFonte: string
    googleKey?: string | null
  }): Promise<Resultado<ResultadoEntrega>>
  ingerirLead(
    logId: string,
    dados: DadosDoLead,
  ): Promise<Resultado<{ status: string; leadId: string | null }>>
  registrarFalha(logId: string, erro: string): Promise<Resultado<void>>
  entregasPendentes(limite: number): Promise<Resultado<EntregaParaProcessar[]>>
}

/** Nomes que as RPCs de ingestao levantam com `raise exception` (0010, 0011).
 * Mesmo desenho de codigoDoErroPostgres (data/supabase.ts) e codigo()
 * (data/fontes.ts): strings nossas sao seguras de casar em qualquer locale,
 * a mensagem crua do PostgREST nao e. */
const CODIGOS = [
  'segredo_invalido',
  'external_id_invalido',
  'log_nao_encontrado',
  'fonte_nao_encontrada',
  'pipeline_nao_encontrado',
  'etapa_invalida',
]

function codigoDoErro(erro: { message: string }): string {
  const achado = CODIGOS.find((c) => erro.message.includes(c))
  return achado ?? erro.message
}

export class SupabaseIngestaoStore implements IngestaoStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly segredo: string,
  ) {}

  async registrarEntrega(e: {
    provedor: Provedor
    externalId: string
    payload: Record<string, unknown>
    chaveDaFonte: string
    googleKey?: string | null
  }): Promise<Resultado<ResultadoEntrega>> {
    const { data, error } = await this.cliente.rpc('registrar_entrega', {
      p_segredo: this.segredo,
      p_provedor: e.provedor,
      p_external_id: e.externalId,
      p_payload: e.payload,
      p_chave_da_fonte: e.chaveDaFonte,
      p_google_key: e.googleKey ?? null,
    })
    if (error) return falha(codigoDoErro(error))
    const linha = data as { log_id: string | null; status: ResultadoEntrega['status']; token: string | null }
    return ok({ logId: linha.log_id, status: linha.status, token: linha.token })
  }

  async ingerirLead(
    logId: string,
    dados: DadosDoLead,
  ): Promise<Resultado<{ status: string; leadId: string | null }>> {
    const { data, error } = await this.cliente.rpc('ingerir_lead', {
      p_segredo: this.segredo,
      p_log_id: logId,
      p_dados: paraPayload(dados),
    })
    if (error) return falha(codigoDoErro(error))
    const linha = data as { status: string; lead_id: string | null }
    return ok({ status: linha.status, leadId: linha.lead_id })
  }

  async registrarFalha(logId: string, erro: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.rpc('registrar_falha', {
      p_segredo: this.segredo,
      p_log_id: logId,
      p_erro: erro,
    })
    if (error) return falha(codigoDoErro(error))
    return ok(undefined)
  }

  async entregasPendentes(limite: number): Promise<Resultado<EntregaParaProcessar[]>> {
    const { data, error } = await this.cliente.rpc('entregas_pendentes', {
      p_segredo: this.segredo,
      p_limite: limite,
    })
    if (error) return falha(codigoDoErro(error))
    const linhas = (data ?? []) as {
      log_id: string
      provedor: Provedor
      payload_bruto: Record<string, unknown>
      token: string | null
    }[]
    return ok(
      linhas.map((l) => ({
        logId: l.log_id,
        provedor: l.provedor,
        payload: l.payload_bruto,
        token: l.token,
      })),
    )
  }
}

/**
 * Monta o store de ingestao com um cliente Supabase ANONIMO e SEM COOKIES --
 * `createClient(url, anonKey)` de `@supabase/supabase-js`, nunca
 * `criarClienteServidor` de `@/lib/supabase/servidor`, que carrega a sessao
 * do usuario logado via cookie. Um webhook nao tem usuario logado; a
 * autorizacao inteira desta chamada e o segredo de ingestao, que a policy
 * `segredo_confere` (0010) confere dentro de cada RPC.
 *
 * Falha ANTES de montar o cliente quando `INGESTAO_SEGREDO` esta vazio, em
 * vez de devolver um store que ia bater `segredo_invalido` em toda chamada:
 * o erro tem que apontar para a configuracao do servidor (env var ausente),
 * nao para o banco, que responderia exatamente da mesma forma para um
 * segredo digitado errado.
 *
 * As env vars do Supabase levam a mesma guarda, em vez de `!` (non-null
 * assertion): um `!` deixaria a var ausente estourar dentro do POST do
 * webhook, virando 500 sem `Resultado` -- e a chamada da Task 7
 * (`criarIngestaoStore()` -> `if (!store.ok) 500`) so sabe responder direito
 * a uma falha que chega como valor, nunca a uma excecao.
 */
export function criarIngestaoStore(): Resultado<IngestaoStore> {
  const segredo = process.env.INGESTAO_SEGREDO ?? ''
  if (segredo.length === 0) return falha('ingestao_nao_configurada')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (url.length === 0 || anonKey.length === 0) return falha('ingestao_nao_configurada')

  // Sem sessao para persistir (webhook nao tem usuario logado, ver acima) e
  // sem refresh para agendar: declarar as duas coisas como `false` torna o
  // client "sem estado de auth" um invariante do codigo, nao um acidente de
  // defaults do supabase-js -- e evita o client montar timers/listeners de
  // refresh a toa a cada chamada deste factory.
  const cliente = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return ok(new SupabaseIngestaoStore(cliente, segredo))
}
