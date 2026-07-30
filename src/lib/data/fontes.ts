import { randomUUID } from 'node:crypto'
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta } from '@/lib/domain/tipos'
import type { Fonte, Provedor } from '@/lib/domain/fonte'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { resolverContaAtiva } from './conta'

/** O que a tela de Integracoes precisa. Escrita sempre por RPC. */
export interface FonteStore {
  listar(): Promise<Resultado<Fonte[]>>
  conectarMeta(
    pageId: string,
    nome: string,
    tokenDaPagina: string,
    responsavelId: string | null,
  ): Promise<Resultado<string>>
  /** Devolve a URL e a chave em claro UMA vez; depois so o hash existe. */
  conectarGoogle(
    nome: string,
    responsavelId: string | null,
  ): Promise<Resultado<{ id: string; urlToken: string; googleKey: string }>>
  definirResponsavel(sourceId: string, responsavelId: string | null): Promise<Resultado<void>>
  desconectar(sourceId: string): Promise<Resultado<void>>
}

type LinhaFonte = {
  id: string
  provedor: Provedor
  external_id: string | null
  nome: string
  responsavel_padrao_id: string | null
  ativo: boolean
  criado_em: string
}

/** Nomes que as funcoes da 0008 levantam com raise exception. */
const CODIGOS = [
  'sem_sessao',
  'sem_permissao',
  'page_ja_conectada',
  'page_id_invalido',
  'fonte_nao_encontrada',
  'responsavel_invalido',
  'segredo_vazio',
]

/**
 * Duas fontes de "codigo", como em codigoDoErroPostgres (supabase.ts) — o
 * mesmo desenho, pelo mesmo motivo, decidido na Task 4.
 *
 * Os nomes de CODIGOS sao nossos: nos escrevemos `raise exception
 * 'page_ja_conectada'` na 0008, entao o texto e estavel e casar por ele e
 * seguro em qualquer locale.
 *
 * Negacao de RLS nao tem nome: a policy so nega e o PostgREST devolve o texto
 * padrao do servidor, que muda com o lc_messages do Postgres. Casar esse texto
 * (ex.: /row-level security policy/i) vaza a mensagem crua assim que o locale
 * nao for ingles. Use o SQLSTATE, que nao muda com locale.
 *
 * RESSALVA que nao existe em leads: o grant de update em lead_sources e por
 * coluna. Update numa coluna sem grant tambem devolve 42501 e cairia aqui
 * rotulado como responsavel_invalido — o sintoma seria "responsavel invalido"
 * para um responsavel valido. Hoje a tela so escreve colunas concedidas
 * (responsavel_padrao_id e atualizado_em); se isso mudar, o rotulo mente.
 */
function codigo(erro: Pick<PostgrestError, 'message' | 'code'>): string {
  const achado = CODIGOS.find((c) => erro.message.includes(c))
  if (achado) return achado
  if (erro.code === '42501') return 'responsavel_invalido'
  return erro.message
}

export class SupabaseFonteStore implements FonteStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly accountId: string,
  ) {}

  async listar(): Promise<Resultado<Fonte[]>> {
    const { data, error } = await this.cliente
      .from('lead_sources')
      .select('id, provedor, external_id, nome, responsavel_padrao_id, ativo, criado_em')
      .eq('account_id', this.accountId)
      .order('criado_em', { ascending: true })
    if (error) return falha(error.message)
    return ok(
      ((data ?? []) as LinhaFonte[]).map((l) => ({
        id: l.id,
        provedor: l.provedor,
        externalId: l.external_id,
        nome: l.nome,
        responsavelPadraoId: l.responsavel_padrao_id,
        ativo: l.ativo,
        criadoEm: new Date(l.criado_em),
      })),
    )
  }

  async conectarMeta(
    pageId: string,
    nome: string,
    tokenDaPagina: string,
    responsavelId: string | null,
  ): Promise<Resultado<string>> {
    const { data, error } = await this.cliente.rpc('conectar_fonte_meta', {
      p_account_id: this.accountId,
      p_page_id: pageId,
      p_nome: nome,
      p_token: tokenDaPagina,
      p_responsavel: responsavelId,
    })
    if (error) return falha(codigo(error))
    return ok(data as string)
  }

  async conectarGoogle(
    nome: string,
    responsavelId: string | null,
  ): Promise<Resultado<{ id: string; urlToken: string; googleKey: string }>> {
    // Gerados aqui, e nao no banco: sao os unicos valores que precisam voltar
    // em claro para a tela, e o banco so guarda o hash dos dois.
    const urlToken = randomUUID().replace(/-/g, '')
    const googleKey = randomUUID().replace(/-/g, '')

    const { data, error } = await this.cliente.rpc('conectar_fonte_google', {
      p_account_id: this.accountId,
      p_nome: nome,
      p_url_token: urlToken,
      p_google_key: googleKey,
      p_responsavel: responsavelId,
    })
    if (error) return falha(codigo(error))
    return ok({ id: data as string, urlToken, googleKey })
  }

  async definirResponsavel(
    sourceId: string,
    responsavelId: string | null,
  ): Promise<Resultado<void>> {
    // Update direto: a policy lead_sources_admin_update ja exige admin e ja
    // valida que o responsavel e membro da conta.
    const { data, error } = await this.cliente
      .from('lead_sources')
      .update({ responsavel_padrao_id: responsavelId, atualizado_em: new Date().toISOString() })
      .eq('id', sourceId)
      .eq('account_id', this.accountId)
      .select('id')
    if (error) return falha(codigo(error))
    // Zero linhas depois da RLS e "nao encontrado", nunca erro de permissao.
    if (!data || data.length === 0) return falha('fonte_nao_encontrada')
    return ok(undefined)
  }

  async desconectar(sourceId: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.rpc('desconectar_fonte', { p_source_id: sourceId })
    if (error) return falha(codigo(error))
    return ok(undefined)
  }
}

export async function criarFonteStoreDoServidor(): Promise<
  Resultado<{ fontes: SupabaseFonteStore; conta: Conta }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  if (!sessao.user) return falha('sem_sessao')

  const ativa = await resolverContaAtiva(cliente, sessao.user.id)
  if (!ativa.ok) return falha(ativa.erro)
  if (ativa.valor.papel !== 'admin') return falha('sem_permissao')

  return ok({
    fontes: new SupabaseFonteStore(cliente, ativa.valor.conta.id),
    conta: ativa.valor.conta,
  })
}
