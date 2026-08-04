import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta } from '@/lib/domain/tipos'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { resolverContaAtiva } from './conta'

/** A conexao do WhatsApp Cloud API da conta — o que a tela de Integracoes precisa. */
export type ConexaoWhatsApp = {
  id: string
  phoneNumberId: string
  wabaId: string
  numeroExibicao: string
  nomeVerificado: string
  criadoEm: Date
}

/** Store irmao menor de FonteStore (fontes.ts): WhatsApp nao e fonte de lead, e canal de saida. */
export interface WhatsAppStore {
  /** A conexao da conta, ou null — nunca mais de uma (unique de account_id). */
  atual(): Promise<Resultado<ConexaoWhatsApp | null>>
  conectar(d: {
    phoneNumberId: string
    wabaId: string
    numeroExibicao: string
    nomeVerificado: string
    token: string
  }): Promise<Resultado<string>>
  desconectar(id: string): Promise<Resultado<void>>
}

type LinhaConexao = {
  id: string
  phone_number_id: string
  waba_id: string
  numero_exibicao: string
  nome_verificado: string
  criado_em: string
}

/**
 * Nomes que conectar_whatsapp/desconectar_whatsapp (0019) levantam com raise
 * exception. Mesmo desenho de codigo() em fontes.ts:115 — replicado e nao
 * importado, porque os codigos desta task sao outros.
 */
const CODIGOS = [
  'sem_sessao',
  'sem_permissao',
  'segredo_invalido',
  'whatsapp_ja_conectado',
  'numero_ja_conectado',
  'whatsapp_campos_vazios',
  'whatsapp_nao_encontrado',
]

function codigo(erro: Pick<PostgrestError, 'message'>): string {
  const achado = CODIGOS.find((c) => erro.message.includes(c))
  return achado ?? erro.message
}

export class SupabaseWhatsAppStore implements WhatsAppStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly accountId: string,
  ) {}

  async atual(): Promise<Resultado<ConexaoWhatsApp | null>> {
    const { data, error } = await this.cliente
      .from('whatsapp_connections')
      .select('id, phone_number_id, waba_id, numero_exibicao, nome_verificado, criado_em')
      .eq('account_id', this.accountId)
      .maybeSingle()
    if (error) return falha(error.message)
    if (!data) return ok(null)
    const l = data as LinhaConexao
    return ok({
      id: l.id,
      phoneNumberId: l.phone_number_id,
      wabaId: l.waba_id,
      numeroExibicao: l.numero_exibicao,
      nomeVerificado: l.nome_verificado,
      criadoEm: new Date(l.criado_em),
    })
  }

  async conectar(d: {
    phoneNumberId: string
    wabaId: string
    numeroExibicao: string
    nomeVerificado: string
    token: string
  }): Promise<Resultado<string>> {
    // process.env.INGESTAO_SEGREDO direto, sem guarda de "vazio" aqui: se
    // faltar, segredo_confere (0010) recusa com segredo_invalido, que ja tem
    // mensagem de operador em erros.ts — mesmo padrao de conectarMeta em
    // fontes.ts:154.
    const { data, error } = await this.cliente.rpc('conectar_whatsapp', {
      p_segredo: process.env.INGESTAO_SEGREDO ?? '',
      p_account_id: this.accountId,
      p_phone_number_id: d.phoneNumberId,
      p_waba_id: d.wabaId,
      p_numero_exibicao: d.numeroExibicao,
      p_nome_verificado: d.nomeVerificado,
      p_token: d.token,
    })
    if (error) return falha(codigo(error))
    return ok(data as string)
  }

  async desconectar(id: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.rpc('desconectar_whatsapp', {
      p_segredo: process.env.INGESTAO_SEGREDO ?? '',
      p_connection_id: id,
    })
    if (error) return falha(codigo(error))
    return ok(undefined)
  }
}

export async function criarWhatsAppStoreDoServidor(): Promise<
  Resultado<{ whatsapp: SupabaseWhatsAppStore; conta: Conta }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  if (!sessao.user) return falha('sem_sessao')

  const ativa = await resolverContaAtiva(cliente, sessao.user.id)
  if (!ativa.ok) return falha(ativa.erro)
  if (ativa.valor.papel !== 'admin') return falha('sem_permissao')

  return ok({
    whatsapp: new SupabaseWhatsAppStore(cliente, ativa.valor.conta.id),
    conta: ativa.valor.conta,
  })
}
