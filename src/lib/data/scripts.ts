import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { normalizarTags } from '@/lib/domain/script'
import type { Papel } from '@/lib/domain/tipos'
import { padraoIlike } from './filtro'
import { contextoDaConta } from './sessao'

export type Script = {
  id: string
  titulo: string
  conteudo: string
  stageId: string | null
  tags: string[]
  criadoEm: Date
  atualizadoEm: Date
}

export type DadosScript = {
  titulo: string
  conteudo: string
  stageId: string | null
  tags: string[]
}

/**
 * Script nao e' filho de lead: e' conhecimento da conta (0020_scripts.sql).
 * A policy de leitura e' `is_member_of(account_id)` — permissiva de proposito,
 * porque a biblioteca serve a todo membro. Por isso TODA consulta aqui filtra
 * `account_id` explicitamente por cima da RLS, inclusive `buscar`: quem e'
 * membro de duas contas veria a biblioteca da outra na conta ativa. E' o mesmo
 * ponto nao-obvio de `minhasAbertas` em tarefas.ts, so que a coluna e' outra.
 */
export interface ScriptStore {
  listar(f: {
    busca?: string | null
    tag?: string | null
    stageId?: string | null
  }): Promise<Resultado<Script[]>>
  buscar(id: string): Promise<Resultado<Script | null>>
  paraEtapa(stageId: string): Promise<Resultado<Script[]>>
  criar(d: DadosScript): Promise<Resultado<string>>
  atualizar(id: string, d: DadosScript): Promise<Resultado<void>>
  excluir(id: string): Promise<Resultado<void>>
  tagsDaConta(): Promise<Resultado<string[]>>
}

const SELECT_SCRIPT = 'id, titulo, conteudo, stage_id, tags, criado_em, atualizado_em'

/** Codigo generico de leitura: nao ha decisao do usuario que mude o resultado,
 * entao nunca vale distinguir a causa Postgres na tela — e nunca
 * `error.message` cru, o defeito que `aplicarEtiquetas` (supabase.ts) ja pagou
 * uma vez. Mesma regra de ERRO_AO_CARREGAR_TAREFAS. */
const ERRO_AO_CARREGAR_SCRIPTS = 'erro_ao_carregar_scripts'

/** Codigo generico de escrita, pelo mesmo motivo. */
const ERRO_AO_SALVAR_SCRIPT = 'erro_ao_salvar_script'

/**
 * Traduz o erro de insert/update em scripts para um codigo estavel.
 *
 * 42501 (insufficient_privilege) e' a negacao do `with check` de
 * scripts_insert/scripts_update, e ele engloba TRES historias que contam a
 * mesma coisa a quem preenche o formulario: etapa de outra conta, etapa
 * inexistente, e etapa excluida entre o render do select e o submit —
 * `stage_da_conta` devolve `false` para as tres (0020, casos 4 e 5). Nao ha
 * acao diferente a tomar entre elas: escolha outra etapa. Dai um codigo so.
 *
 * 23503 (foreign_key_violation) colapsa no mesmo codigo como backstop. Pelo
 * PostgREST ele e' inalcancavel — o `with check` roda antes da FK e ja matou o
 * insert —, mas custa um `||` e cobre qualquer caminho futuro que escreva sem
 * passar pela RLS.
 *
 * O papel (vendedor tentando escrever) NAO cai aqui como caso previsto: a
 * action da Task 4 pre-checa antes de chamar o store, e um vendedor que
 * escapasse do pre-check bateria no mesmo 42501 — a tela diria "etapa
 * invalida" em vez de "sem permissao", que e' o preco de nao poder distinguir
 * dois `with check` negados pelo mesmo SQLSTATE.
 */
function codigoDoErroAoGravarScript(erro: Pick<PostgrestError, 'code'>): string {
  if (erro.code === '42501' || erro.code === '23503') return 'etapa_invalida'
  return ERRO_AO_SALVAR_SCRIPT
}

type LinhaScript = {
  id: string
  titulo: string
  conteudo: string
  stage_id: string | null
  tags: string[] | null
  criado_em: string
  atualizado_em: string
}

function paraScript(l: LinhaScript): Script {
  return {
    id: l.id,
    titulo: l.titulo,
    conteudo: l.conteudo,
    stageId: l.stage_id,
    // A coluna e' `not null default '{}'`, mas o `?? []` mantem o mapeamento
    // total: um `null` vindo de um caminho futuro vira lista vazia, nunca um
    // `.map` de undefined na tela.
    tags: l.tags ?? [],
    criadoEm: new Date(l.criado_em),
    atualizadoEm: new Date(l.atualizado_em),
  }
}

export class SupabaseScriptStore implements ScriptStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly contaId: string,
    private readonly usuarioId: string,
  ) {}

  async listar(f: {
    busca?: string | null
    tag?: string | null
    stageId?: string | null
  }): Promise<Resultado<Script[]>> {
    let q = this.cliente
      .from('scripts')
      .select(SELECT_SCRIPT)
      .eq('account_id', this.contaId)
      // titulo asc com desempate id asc: sem o desempate dois titulos iguais
      // ficam em ordem indefinida e duas cargas da mesma tela podem trocar as
      // linhas de lugar. O Plano 3 gastou uma task inteira (lead_events.seq)
      // por essa licao.
      .order('titulo', { ascending: true })
      .order('id', { ascending: true })

    if (f.busca) {
      // padraoIlike, e nunca `%${busca}%`: o texto do usuario iria cru para o
      // PostgREST, entao a virgula abriria condicao OR extra e `%`/`_`
      // virariam curinga (buscar "100%" casaria com "100 leads"). O helper ja
      // devolve o valor entre aspas — nao envolver de novo.
      const alvo = padraoIlike(f.busca)
      q = q.or(`titulo.ilike.${alvo},conteudo.ilike.${alvo}`)
    }
    // `.contains` monta o operador de array no proprio supabase-js; uma string
    // `{tag}` montada a mao aqui teria o mesmo problema de escape do `.or`.
    if (f.tag) q = q.contains('tags', [f.tag])
    if (f.stageId) q = q.eq('stage_id', f.stageId)

    const { data, error } = await q
    if (error) return falha(ERRO_AO_CARREGAR_SCRIPTS)
    return ok((data as unknown as LinhaScript[]).map(paraScript))
  }

  async buscar(id: string): Promise<Resultado<Script | null>> {
    const { data, error } = await this.cliente
      .from('scripts')
      .select(SELECT_SCRIPT)
      .eq('id', id)
      // O filtro de conta e' o que separa "script da conta ativa" de "script
      // que a RLS deixa ver": para quem e' membro de duas contas, is_member_of
      // aprovaria o script da outra. Zero linhas aqui — por RLS, por conta
      // errada ou por id inexistente — e' ok(null), e a pagina responde
      // notFound(), nunca 403. Mesma convencao de buscarLead.
      .eq('account_id', this.contaId)
      .maybeSingle()
    // uuid invalido e' "nao encontrado", nao falha tecnica: /scripts/abc chega
    // aqui como texto que o Postgres recusa no `=` da coluna uuid (22P02,
    // invalid_text_representation). Tratado como erro generico, a pagina
    // renderizaria "Nao foi possivel carregar os scripts" para um link velho ou
    // uma digitacao errada; devolvendo ok(null) ela responde notFound(), que e'
    // a verdade e a mesma convencao do id inexistente logo abaixo.
    if (error?.code === '22P02') return ok(null)
    if (error) return falha(ERRO_AO_CARREGAR_SCRIPTS)
    return ok(data ? paraScript(data as unknown as LinhaScript) : null)
  }

  async paraEtapa(stageId: string): Promise<Resultado<Script[]>> {
    const { data, error } = await this.cliente
      .from('scripts')
      .select(SELECT_SCRIPT)
      .eq('account_id', this.contaId)
      // Sem escape: o uuid vem do banco (a etapa do lead aberto), nao do que o
      // usuario digitou — diferente de `busca` em listar. Uma consulta so, e
      // nao duas somadas em TS, para a ordenacao valer sobre o conjunto todo.
      .or(`stage_id.eq.${stageId},stage_id.is.null`)
      .order('titulo', { ascending: true })
      .order('id', { ascending: true })
    if (error) return falha(ERRO_AO_CARREGAR_SCRIPTS)

    const linhas = (data as unknown as LinhaScript[]).map(paraScript)
    // Particao ESTAVEL: os da etapa primeiro, os "serve em qualquer etapa"
    // depois, preservando dentro de cada grupo a ordem que o banco devolveu.
    // Dois `filter` em vez de um `sort` por chave justamente porque `sort` do
    // JS so e' estavel por especificacao, e aqui a estabilidade e' a regra —
    // nao um efeito colateral que se le no engine.
    return ok([
      ...linhas.filter((s) => s.stageId !== null),
      ...linhas.filter((s) => s.stageId === null),
    ])
  }

  async criar(d: DadosScript): Promise<Resultado<string>> {
    const { data, error } = await this.cliente
      .from('scripts')
      .insert({
        account_id: this.contaId,
        titulo: d.titulo,
        conteudo: d.conteudo,
        stage_id: d.stageId,
        // A normalizacao mora no dominio e o store e' o unico caminho de
        // escrita: aplicar aqui e' o que garante que nenhuma tela grave tag
        // crua. O limite de 10 e' validado pela action ANTES (codigo
        // 'tags_demais'); o check do banco e' backstop, nao fluxo.
        tags: normalizarTags(d.tags),
        criado_por: this.usuarioId,
      })
      .select('id')
      .single()
    if (error) return falha(codigoDoErroAoGravarScript(error))
    return ok(data.id)
  }

  async atualizar(id: string, d: DadosScript): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('scripts')
      .update({
        titulo: d.titulo,
        conteudo: d.conteudo,
        stage_id: d.stageId,
        tags: normalizarTags(d.tags),
        // Carimbado pela aplicacao: este repo nao tem trigger de
        // atualizado_em (ver tarefas.ts / supabase.ts:259) e este plano nao
        // introduz o primeiro.
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', this.contaId)
      .select('id')
    if (error) return falha(codigoDoErroAoGravarScript(error))
    // Zero linhas depois da RLS: id inexistente, script de outra conta, ou
    // vendedor barrado pelo `using` de scripts_update — indistinguiveis daqui
    // e sem acao diferente a tomar. Mesma convencao de `concluir` em
    // tarefas.ts. Nunca um sucesso mudo.
    if (!data || data.length === 0) return falha('script_nao_encontrado')
    return ok(undefined)
  }

  async excluir(id: string): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('scripts')
      .delete()
      .eq('id', id)
      .eq('account_id', this.contaId)
      .select('id')
    // Codigo generico direto, sem passar por codigoDoErroAoGravarScript:
    // delete nao tem `with check`, entao 42501 nao e' "etapa invalida" aqui —
    // seria uma mensagem falsa. A negacao por papel vira zero linhas, abaixo.
    if (error) return falha(ERRO_AO_SALVAR_SCRIPT)
    if (!data || data.length === 0) return falha('script_nao_encontrado')
    return ok(undefined)
  }

  async tagsDaConta(): Promise<Resultado<string[]>> {
    const { data, error } = await this.cliente
      .from('scripts')
      .select('tags')
      .eq('account_id', this.contaId)
    if (error) return falha(ERRO_AO_CARREGAR_SCRIPTS)

    const unicas = new Set<string>()
    for (const linha of data as unknown as { tags: string[] | null }[]) {
      for (const tag of linha.tags ?? []) unicas.add(tag)
    }
    // localeCompare pt-BR e nao `.sort()` cru: as tags sao minusculas mas
    // acentuadas ('objeção'), e o sort por code point jogaria toda acentuada
    // para depois do 'z'. Mesmo criterio de desempate por rotulo de
    // metricas.ts.
    return ok([...unicas].sort((a, b) => a.localeCompare(b, 'pt-BR')))
  }
}

/**
 * Segue `criarWhatsAppStoreDoServidor` (whatsapp.ts:119) SEM o gate de admin:
 * a leitura da biblioteca e' de todo membro. O `papel` sobe junto para as
 * telas gatearem o botao "Novo script"; quem barra a escrita de verdade e' a
 * RLS de scripts_insert/update/delete mais o pre-check da action — nunca o
 * esconder do botao sozinho.
 */
export async function criarScriptStoreDoServidor(): Promise<
  Resultado<{ scripts: SupabaseScriptStore; papel: Papel }>
> {
  const ctx = await contextoDaConta()
  if (!ctx.ok) return falha(ctx.erro)

  return ok({
    scripts: new SupabaseScriptStore(ctx.valor.cliente, ctx.valor.conta.id, ctx.valor.usuarioId),
    papel: ctx.valor.papel,
  })
}
