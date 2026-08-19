import { randomUUID } from 'node:crypto'
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Conta } from '@/lib/domain/tipos'
import type { Entrega, Fonte, Provedor, StatusEntrega } from '@/lib/domain/fonte'
import { contextoDaConta } from './sessao'

/** O que a tela de Integracoes precisa. Escrita sempre por RPC. */
export interface FonteStore {
  listar(): Promise<Resultado<Fonte[]>>
  conectarMeta(
    pageId: string,
    nome: string,
    tokenDaPagina: string,
    responsavelId: string | null,
  ): Promise<Resultado<string>>
  /**
   * Toma a linha de quem estava conectado antes, inclusive de outra conta —
   * a saida da Task 10 para uma Page squattada. Mesma forma de conectarMeta
   * de proposito: e a mesma acao ("gravar esta Page para mim"), so que a RPC
   * por baixo apaga o dono anterior em vez de recusar por unique_violation.
   */
  reivindicarMeta(
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
  /**
   * As ultimas entregas da conta, mais recentes primeiro — o painel de
   * diagnostico da tela de Integracoes. Le integration_log, cujo grant da
   * 0009 e por coluna e exclui payload_bruto; ver o comentario sobre a lista
   * explicita de colunas em `entregasRecentes` abaixo.
   */
  entregasRecentes(limite: number): Promise<Resultado<Entrega[]>>
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

type LinhaEntrega = {
  id: string
  provedor: Provedor
  external_id: string
  status: StatusEntrega
  erro: string | null
  tentativas: number
  lead_id: string | null
  criado_em: string
  processado_em: string | null
}

/**
 * Nomes que as funcoes da 0008 levantam com raise exception, mais os dois que
 * a 0012 (Task 10) acrescentou.
 *
 * segredo_invalido e o que segredo_confere levanta quando p_segredo nao bate
 * com ingestion_config: sem entrar aqui, o texto cru da excecao do Postgres
 * chegaria a tela em vez do codigo estavel.
 *
 * posse_nao_comprovada nunca e levantado pelo Postgres — ele vem pronto do
 * MetaGraph.posseDaPagina (Task 5), na Server Action, e chega a este arquivo
 * ja como Resultado, nunca como PostgrestError. Fica listado aqui do mesmo
 * jeito, ao lado do codigo irmao, para que os dois codigos novos desta task
 * fiquem registrados num unico lugar — e porque codigo() e total: uma
 * chamada futura que por engano fizesse este texto passar por um
 * raise exception ainda seria reconhecida, em vez de vazar crua.
 */
const CODIGOS = [
  'sem_sessao',
  'sem_permissao',
  'page_ja_conectada',
  'page_id_invalido',
  'fonte_nao_encontrada',
  'responsavel_invalido',
  'segredo_vazio',
  'segredo_invalido',
  'posse_nao_comprovada',
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
    // process.env.INGESTAO_SEGREDO direto, sem guarda de "vazio" aqui: se
    // faltar, segredo_confere (0010) recusa com segredo_invalido, que ja tem
    // mensagem de operador em erros.ts. Uma segunda guarda so duplicaria a
    // logica sem mudar o desfecho para quem esta na tela.
    const { data, error } = await this.cliente.rpc('conectar_fonte_meta', {
      p_segredo: process.env.INGESTAO_SEGREDO ?? '',
      p_account_id: this.accountId,
      p_page_id: pageId,
      p_nome: nome,
      p_token: tokenDaPagina,
      p_responsavel: responsavelId,
    })
    if (error) return falha(codigo(error))
    return ok(data as string)
  }

  async reivindicarMeta(
    pageId: string,
    nome: string,
    tokenDaPagina: string,
    responsavelId: string | null,
  ): Promise<Resultado<string>> {
    const { data, error } = await this.cliente.rpc('reivindicar_fonte_meta', {
      p_segredo: process.env.INGESTAO_SEGREDO ?? '',
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

  async entregasRecentes(limite: number): Promise<Resultado<Entrega[]>> {
    // Lista de colunas EXPLICITA, igual a `listar()` acima — nunca `select *`.
    // O grant da 0009 exclui payload_bruto de proposito (e o unico lugar que
    // guarda o corpo cru do provedor); um `select *` aqui devolve 42501 para
    // authenticated. O teste `entregas-recentes.test.ts` existe para pegar
    // quem tentar "simplificar" isto de volta para `*`.
    const { data, error } = await this.cliente
      .from('integration_log')
      .select('id, provedor, external_id, status, erro, tentativas, lead_id, criado_em, processado_em')
      .eq('account_id', this.accountId)
      .order('criado_em', { ascending: false })
      .limit(limite)
    if (error) return falha(error.message)
    return ok(
      ((data ?? []) as LinhaEntrega[]).map((l) => ({
        id: l.id,
        provedor: l.provedor,
        externalId: l.external_id,
        status: l.status,
        erro: l.erro,
        tentativas: l.tentativas,
        leadId: l.lead_id,
        criadoEm: new Date(l.criado_em),
        processadoEm: l.processado_em ? new Date(l.processado_em) : null,
      })),
    )
  }
}

export async function criarFonteStoreDoServidor(): Promise<
  Resultado<{ fontes: SupabaseFonteStore; conta: Conta }>
> {
  const ctx = await contextoDaConta()
  if (!ctx.ok) return falha(ctx.erro)
  if (ctx.valor.papel !== 'admin') return falha('sem_permissao')

  return ok({
    fontes: new SupabaseFonteStore(ctx.valor.cliente, ctx.valor.conta.id),
    conta: ctx.valor.conta,
  })
}
