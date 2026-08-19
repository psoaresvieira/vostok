import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { StageTipo } from '@/lib/domain/tipos'
import { sessaoDoServidor } from './sessao'

export type ResumoEtapa = {
  etapaId: string
  leadsNaEtapa: number
  leadsPassaram: number
}

export interface EtapaStore {
  criarEtapa(nome: string, tipo: StageTipo): Promise<Resultado<string>>
  renomearEtapa(etapaId: string, nome: string): Promise<Resultado<void>>
  excluirEtapa(etapaId: string): Promise<Resultado<void>>
  reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>>
  resumoEtapas(): Promise<Resultado<ResumoEtapa[]>>
}

/**
 * Traduz o erro do PostgREST para um dos cinco codigos nomeados que
 * excluir_etapa, reordenar_etapas e resumo_etapas podem levantar por
 * excecao. Mesmo padrao de codigoDoErroPostgres em supabase.ts:465 (privada
 * la, repetida aqui porque a lista de codigos e outra): as strings sao
 * nossas, cassar por `error.message.includes` e seguro e independente de
 * locale. NAO cobre 23503 (FK de leads.stage_id) de proposito — esse SQLSTATE
 * so faz sentido tratado em excluirEtapa, que trata antes de chegar aqui; nas
 * outras duas chamadas um 23503 cairia no fallback `erro.message` mesmo.
 */
const CODIGOS_CONHECIDOS_DE_ETAPA = [
  'etapa_nao_encontrada',
  'etapa_tem_leads',
  'ultima_etapa_do_tipo',
  'ordem_invalida',
  'sem_permissao',
]

function codigoDoErroDeEtapa(erro: Pick<PostgrestError, 'message'>): string {
  const achado = CODIGOS_CONHECIDOS_DE_ETAPA.find((c) => erro.message.includes(c))
  return achado ?? erro.message
}

export class SupabaseEtapaStore implements EtapaStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly pipelineId: string,
  ) {}

  async criarEtapa(nome: string, tipo: StageTipo): Promise<Resultado<string>> {
    const { data: ultima, error: erroMax } = await this.cliente
      .from('stages')
      .select('ordem')
      .eq('pipeline_id', this.pipelineId)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (erroMax) return falha(erroMax.message)

    const { data, error } = await this.cliente
      .from('stages')
      .insert({
        pipeline_id: this.pipelineId,
        nome,
        tipo,
        ordem: (ultima?.ordem ?? 0) + 1,
      })
      .select('id')
      .single()
    if (error) {
      // Emenda pos-review-final: este era o unico dos cinco metodos que
      // devolvia a mensagem crua do Postgres, e a superficie nova (todo
      // membro, toda pipeline, abas concorrentes) tornou dois SQLSTATEs
      // alcancaveis pela tela. Ambos so' aparecem DURANTE uma corrida — com
      // ela resolvida, este mesmo caminho devolve outra coisa.
      //
      // 23503: a pipeline foi excluida em outra aba entre o `with check` da
      // RLS (que ainda a enxergou) e a checagem da FK. Para quem esta na tela
      // e' "esse funil nao existe mais" — nao_encontrado ja diz "recarregue".
      if (error.code === '23503') return falha('nao_encontrado')
      // 23505: dois membros adicionando etapa ao mesmo tempo leem o mesmo max
      // de ordem e colidem no indice unico (pipeline_id, ordem). ordem_invalida
      // ja instrui "recarregue a pagina e tente de novo", que e' exatamente a
      // saida — na releitura o max ja inclui a etapa do colega.
      if (error.code === '23505') return falha('ordem_invalida')
      // 42501: terceira emenda pos-review-final. O caso realista de pipeline
      // excluida COMMITADA em outra aba nem chega na FK — morre antes no
      // `with check` da RLS (is_member_of(conta_do_pipeline(id-morto)) =
      // false), e o Postgres estoura a mensagem crua "new row violates
      // row-level security policy...". O MESMO with check e o MESMO caminho
      // tambem recusam um pipelineId forjado de outra conta — aqui
      // nao_encontrado e' o fail-closed certo, mesma convencao das RPCs
      // (excluir_etapa/reordenar_etapas): nao vaza se o id e' real ou nao.
      if (error.code === '42501') return falha('nao_encontrado')
      return falha(error.message)
    }
    return ok(data.id)
  }

  async renomearEtapa(etapaId: string, nome: string): Promise<Resultado<void>> {
    // Zero linhas depois da RLS significa "nao encontrado", nunca erro de
    // permissao: um id de outra conta simplesmente nao casa e o update volta
    // vazio sem error. Sem o select abaixo a tela mostraria sucesso num no-op.
    const { data, error } = await this.cliente
      .from('stages')
      .update({ nome })
      .eq('id', etapaId)
      .select('id')
    if (error) return falha(error.message)
    if (!data || data.length === 0) return falha('nao_encontrado')
    return ok(undefined)
  }

  async excluirEtapa(etapaId: string): Promise<Resultado<void>> {
    const { error } = await this.cliente.rpc('excluir_etapa', { p_stage_id: etapaId })
    if (error) {
      // leads.stage_id e NOT NULL / NO ACTION: se um lead entrar na etapa
      // entre a contagem da guarda dentro de excluir_etapa e o delete, a FK
      // estoura 23503 em vez da excecao nomeada etapa_tem_leads — mas para
      // quem esta na tela e a mesma recusa. Tratado aqui, e so aqui: e o
      // unico dos tres RPCs que apaga uma etapa, entao e o unico onde esse
      // SQLSTATE pode aparecer com este significado.
      if (error.code === '23503') return falha('etapa_tem_leads')
      return falha(codigoDoErroDeEtapa(error))
    }
    return ok(undefined)
  }

  async reordenarEtapas(idsNaOrdem: string[]): Promise<Resultado<void>> {
    // A transacao (validacao + as duas fases de update contra o indice unico
    // de ordem) vive inteira na RPC — ver reordenar_etapas na 0018. Falha em
    // qualquer ponto desfaz tudo; daqui so traduzimos o erro.
    const { error } = await this.cliente.rpc('reordenar_etapas', {
      p_ids_na_ordem: idsNaOrdem,
    })
    if (error) return falha(codigoDoErroDeEtapa(error))
    return ok(undefined)
  }

  async resumoEtapas(): Promise<Resultado<ResumoEtapa[]>> {
    const { data, error } = await this.cliente.rpc('resumo_etapas', {
      p_pipeline_id: this.pipelineId,
    })
    if (error) return falha(codigoDoErroDeEtapa(error))
    const linhas = (data ?? []) as {
      stage_id: string
      leads_na_etapa: number
      leads_passaram: number
    }[]
    return ok(
      linhas.map((linha) => ({
        etapaId: linha.stage_id,
        // O supabase-js entrega bigint como number; Number() e so defesa
        // contra um driver que devolva string, sem custo no caminho comum.
        leadsNaEtapa: Number(linha.leads_na_etapa),
        leadsPassaram: Number(linha.leads_passaram),
      })),
    )
  }
}

/**
 * Sem checagem de papel e sem resolucao de pipeline, de proposito: mesmo
 * padrao de acoes-pipelines.ts (o cliente manda o id da pipeline, o banco —
 * RLS + RPCs da migration 0026 — decide se ela e' visivel e se a operacao e'
 * permitida). Pipeline de outra conta morre na RLS/RPC, nao aqui.
 */
export async function criarEtapaStoreDoServidor(
  pipelineId: string,
): Promise<Resultado<{ etapas: SupabaseEtapaStore }>> {
  const sessao = await sessaoDoServidor()
  if (!sessao.ok) return falha(sessao.erro)

  return ok({ etapas: new SupabaseEtapaStore(sessao.valor.cliente, pipelineId) })
}
