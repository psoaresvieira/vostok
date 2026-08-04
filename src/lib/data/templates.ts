import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type { Variavel } from '@/lib/domain/script'
import type { Papel } from '@/lib/domain/tipos'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { resolverContaAtiva } from './conta'

/**
 * O template do WhatsApp de um script (0022_whatsapp_templates.sql).
 *
 * `corpoPosicional` e `mapa` sao SNAPSHOT da submissao: o script pode ser
 * editado depois, e o que foi ao Meta nao muda. Quem envia compara a traducao
 * do conteudo ATUAL com este snapshot e so habilita o envio quando batem —
 * por isso os dois viajam juntos em toda leitura, nunca um sem o outro.
 */
export type TemplateWhatsApp = {
  id: string
  scriptId: string
  nomeMeta: string
  idioma: string
  categoria: 'marketing' | 'utility'
  corpoPosicional: string
  mapa: Variavel[]
  status: string
  motivoRejeicao: string | null
  statusConsultadoEm: Date | null
  criadoEm: Date
}

export type DadosTemplate = {
  scriptId: string
  nomeMeta: string
  idioma: string
  categoria: 'marketing' | 'utility'
  corpoPosicional: string
  mapa: Variavel[]
  status: string
  templateIdMeta: string | null
}

/**
 * Mesmo desenho de `ScriptStore` (scripts.ts): a policy de leitura e'
 * `is_member_of(account_id)` — permissiva de proposito, porque todo membro
 * precisa ver o status para o botao de envio existir. Por isso TODA consulta
 * aqui filtra `account_id` explicitamente por cima da RLS: quem e' membro de
 * duas contas veria o template da outra na conta ativa.
 */
export interface TemplateStore {
  doScript(scriptId: string): Promise<Resultado<TemplateWhatsApp | null>>
  dosScripts(scriptIds: string[]): Promise<Resultado<TemplateWhatsApp[]>>
  criar(d: DadosTemplate): Promise<Resultado<string>>
  substituir(id: string, d: DadosTemplate): Promise<Resultado<void>>
  excluir(id: string): Promise<Resultado<void>>
}

const SELECT_TEMPLATE =
  'id, script_id, nome_meta, idioma, categoria, corpo_posicional, mapa, status, ' +
  'motivo_rejeicao, status_consultado_em, criado_em'

/** Codigos genericos de leitura e escrita, pelo mesmo motivo de
 * ERRO_AO_CARREGAR_SCRIPTS: nao ha decisao do usuario que mude o resultado, e
 * `error.message` cru na tela e' o defeito que este repo ja pagou uma vez. */
const ERRO_AO_CARREGAR_TEMPLATES = 'erro_ao_carregar_templates'
const ERRO_AO_SALVAR_TEMPLATE = 'erro_ao_salvar_template'

/**
 * Traduz o erro de insert/update em whatsapp_templates para um codigo estavel.
 *
 * 23505 (unique_violation) cobre os DOIS indices unicos da tabela
 * (`script_id`, e `account_id + nome_meta`) e conta a mesma historia ao
 * usuario: ja existe template para este script — quase sempre a dupla
 * submissao (dois cliques, duas abas) que a checagem previa da action nao
 * pega, porque a corrida acontece depois dela. Codigo proprio
 * `template_ja_existe`, e nao `template_ja_pendente`: este ultimo e' a recusa
 * DELIBERADA da action quando ha analise em curso, e colapsar os dois faria a
 * tela dizer "aguarde a resposta do Meta" para um template ja aprovado.
 *
 * 42501 (insufficient_privilege) e' a negacao do with check de
 * whatsapp_templates_insert/update, que engloba papel vendedor e `script_id`
 * de outra conta. A action pre-checa o papel antes de chamar o store, entao o
 * que sobra aqui e' quem escapou do pre-check — e para esse, "sem permissao"
 * e' a verdade. `script_id` alheio so chega por id forjado, e a mensagem
 * tambem serve.
 */
function codigoDoErroAoGravarTemplate(erro: Pick<PostgrestError, 'code'>): string {
  if (erro.code === '23505') return 'template_ja_existe'
  if (erro.code === '42501') return 'sem_permissao'
  return ERRO_AO_SALVAR_TEMPLATE
}

type LinhaTemplate = {
  id: string
  script_id: string
  nome_meta: string
  idioma: string
  categoria: string
  corpo_posicional: string
  mapa: string[] | null
  status: string
  motivo_rejeicao: string | null
  status_consultado_em: string | null
  criado_em: string
}

/**
 * `mapa` e' `text[]` no banco e `Variavel[]` aqui. O cast e' assercao, nao
 * validacao, DE PROPOSITO: filtrar nomes fora do catalogo encurtaria o array e
 * desalinharia todo `{{N}}` seguinte do corpo — o Meta receberia menos valores
 * que placeholders e o cliente leria a mensagem errada em silencio. Quem grava
 * e' `traduzirParaPosicional`, que so emite nomes do catalogo; se um dia um
 * nome sair de la, o lugar de descobrir isso e' a comparacao com o snapshot
 * (que falha fechado), nao um filtro mudo aqui.
 */
function paraTemplate(l: LinhaTemplate): TemplateWhatsApp {
  return {
    id: l.id,
    scriptId: l.script_id,
    nomeMeta: l.nome_meta,
    idioma: l.idioma,
    categoria: l.categoria as 'marketing' | 'utility',
    corpoPosicional: l.corpo_posicional,
    mapa: (l.mapa ?? []) as Variavel[],
    status: l.status,
    motivoRejeicao: l.motivo_rejeicao,
    // Colunas nullable: `new Date(null)` viraria 1970 e a tela mostraria
    // "consultado ha 56 anos" em vez de "nunca consultado".
    statusConsultadoEm: l.status_consultado_em ? new Date(l.status_consultado_em) : null,
    criadoEm: new Date(l.criado_em),
  }
}

export class SupabaseTemplateStore implements TemplateStore {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly contaId: string,
  ) {}

  /**
   * `maybeSingle` porque o indice unico de `script_id` garante no maximo uma
   * linha; zero linhas — por RLS, por conta errada ou por script sem template
   * — e' `ok(null)`, o estado inicial de todo script (a tela renderiza
   * "Submeter ao WhatsApp"), nunca uma falha.
   *
   * Sem o tratamento de 22P02 que `buscarScript` tem: aqui o `scriptId` vem de
   * um script JA resolvido pelo chamador (a pagina busca o script antes e
   * responde notFound() para id invalido), nao do texto cru da rota.
   */
  async doScript(scriptId: string): Promise<Resultado<TemplateWhatsApp | null>> {
    const { data, error } = await this.cliente
      .from('whatsapp_templates')
      .select(SELECT_TEMPLATE)
      .eq('script_id', scriptId)
      .eq('account_id', this.contaId)
      .maybeSingle()
    if (error) return falha(ERRO_AO_CARREGAR_TEMPLATES)
    return ok(data ? paraTemplate(data as unknown as LinhaTemplate) : null)
  }

  async dosScripts(scriptIds: string[]): Promise<Resultado<TemplateWhatsApp[]>> {
    // Curto-circuito antes da consulta: `.in('script_id', [])` monta `in.()` no
    // PostgREST, uma borda que nao vale exercitar por uma resposta que ja se
    // sabe. A ficha sem scripts no painel cai exatamente aqui.
    if (scriptIds.length === 0) return ok([])

    const { data, error } = await this.cliente
      .from('whatsapp_templates')
      .select(SELECT_TEMPLATE)
      // `.in` com ids vindos do banco (os scripts que o painel ja carregou),
      // nao do que o usuario digitou; o filtro de conta por cima e' o que
      // impede o template da outra conta de entrar para quem e' membro das
      // duas — a RLS sozinha aprovaria.
      .eq('account_id', this.contaId)
      .in('script_id', scriptIds)
    if (error) return falha(ERRO_AO_CARREGAR_TEMPLATES)
    return ok((data as unknown as LinhaTemplate[]).map(paraTemplate))
  }

  async criar(d: DadosTemplate): Promise<Resultado<string>> {
    const { data, error } = await this.cliente
      .from('whatsapp_templates')
      .insert({
        account_id: this.contaId,
        script_id: d.scriptId,
        nome_meta: d.nomeMeta,
        idioma: d.idioma,
        categoria: d.categoria,
        corpo_posicional: d.corpoPosicional,
        mapa: d.mapa,
        // Minusculizado aqui como `atualizar_status_template` faz com `lower()`
        // (0022): a coluna e' texto livre SEM check, e o contrato de que o
        // status mora em minusculas so vale se os DOIS escritores o cumprirem —
        // senao 'APPROVED' vindo do Graph nao casaria com o 'approved' que a
        // RPC grava, e o mesmo template seria enviavel ou nao conforme o
        // caminho que escreveu por ultimo.
        status: d.status.toLowerCase(),
        template_id_meta: d.templateIdMeta,
      })
      .select('id')
      .single()
    if (error) return falha(codigoDoErroAoGravarTemplate(error))
    return ok(data.id)
  }

  /**
   * Re-submissao: a linha inteira vira funcao de `d`, porque o template no
   * Meta e' OUTRO (nome novo, corpo novo, id novo). Dai `motivo_rejeicao` e
   * `status_consultado_em` voltarem a null: sao fatos do template anterior, e
   * mante-los faria a tela mostrar "recusado porque X" ao lado de um `pending`
   * novo — o motivo antigo sobrevivendo a analise que ele nao descreve.
   */
  async substituir(id: string, d: DadosTemplate): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('whatsapp_templates')
      .update({
        script_id: d.scriptId,
        nome_meta: d.nomeMeta,
        idioma: d.idioma,
        categoria: d.categoria,
        corpo_posicional: d.corpoPosicional,
        mapa: d.mapa,
        // Mesma minusculizacao do `criar`, pelo mesmo contrato da 0022.
        status: d.status.toLowerCase(),
        template_id_meta: d.templateIdMeta,
        motivo_rejeicao: null,
        status_consultado_em: null,
        // Carimbado pela aplicacao: este repo nao tem trigger de
        // atualizado_em (ver scripts.ts / tarefas.ts).
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', this.contaId)
      .select('id')
    if (error) return falha(codigoDoErroAoGravarTemplate(error))
    // Zero linhas depois da RLS: id inexistente, template de outra conta, ou
    // vendedor barrado pelo `using` — indistinguiveis daqui e sem acao
    // diferente a tomar (recarregue a pagina). Nunca um sucesso mudo.
    if (!data || data.length === 0) return falha('template_nao_encontrado')
    return ok(undefined)
  }

  async excluir(id: string): Promise<Resultado<void>> {
    const { data, error } = await this.cliente
      .from('whatsapp_templates')
      .delete()
      .eq('id', id)
      .eq('account_id', this.contaId)
      .select('id')
    // Generico direto, sem passar por codigoDoErroAoGravarTemplate: delete nao
    // tem `with check`, entao 23505 nao existe aqui e a negacao por papel vira
    // zero linhas, abaixo.
    if (error) return falha(ERRO_AO_SALVAR_TEMPLATE)
    if (!data || data.length === 0) return falha('template_nao_encontrado')
    return ok(undefined)
  }
}

/**
 * Segue `criarScriptStoreDoServidor` (scripts.ts:286) SEM gate de papel: a
 * leitura do status e' de todo membro, porque e' ela que faz o botao de envio
 * existir na ficha do lead. O `papel` sobe junto para as telas gatearem o bloco
 * de submissao; quem barra a escrita de verdade e' a RLS de
 * whatsapp_templates_insert/update/delete mais o pre-check da action.
 *
 * `contaId` sobe junto porque `DisparoServico.credencial(accountId)` precisa
 * dele e NAO passa pela sessao (cliente anonimo + segredo). Sem isto, todo
 * chamador teria que resolver a conta ativa uma segunda vez por outro caminho,
 * e as duas resolucoes poderiam discordar — sendo que a que discordasse seria
 * justamente a que escolhe de qual conta sai o token do WhatsApp.
 */
export async function criarTemplateStoreDoServidor(): Promise<
  Resultado<{ templates: SupabaseTemplateStore; papel: Papel; contaId: string }>
> {
  const cliente = await criarClienteServidor()
  const { data: sessao } = await cliente.auth.getUser()
  if (!sessao.user) return falha('sem_sessao')

  const ativa = await resolverContaAtiva(cliente, sessao.user.id)
  if (!ativa.ok) return falha(ativa.erro)

  return ok({
    templates: new SupabaseTemplateStore(cliente, ativa.valor.conta.id),
    papel: ativa.valor.papel,
    contaId: ativa.valor.conta.id,
  })
}

/**
 * O lado do SERVIDOR do disparo: as duas chamadas que nao podem passar pela
 * sessao do usuario.
 *
 * - `credencial` le o token do WhatsApp, que nenhuma sessao alcanca
 *   (whatsapp_credentials nao tem grant nenhum; a RPC e' security definer com
 *   segredo, 0019).
 * - `atualizarStatus` grava o status fresco do Meta quando QUALQUER membro
 *   renderiza a tela — inclusive vendedor, que nao tem (e nao deve ter)
 *   escrita na tabela. Fosse pela sessao, ou o status nao persistiria para o
 *   vendedor, ou a escrita abriria para ele forjar 'approved'.
 */
export interface DisparoServico {
  credencial(
    accountId: string,
  ): Promise<Resultado<{ token: string; phoneNumberId: string; wabaId: string }>>
  atualizarStatus(templateId: string, status: string, motivo: string | null): Promise<Resultado<void>>
}

/**
 * Nomes que credencial_whatsapp (0019) e atualizar_status_template (0022)
 * levantam com `raise exception`, e o codigo com que este port os conta para
 * cima. Mesmo desenho de codigoDoErro (ingestao.ts) e codigo() (whatsapp.ts):
 * casar string nossa e' seguro em qualquer locale, a mensagem crua do
 * PostgREST nao — e nenhuma delas sobe para a tela como veio.
 *
 * `whatsapp_nao_encontrado` vira `sem_conexao_whatsapp` porque a acao do
 * usuario e' outra: nao e' "esse template sumiu", e' "conecte um numero em
 * Configuracao" (a chave que a Task 5 mapeia para essa frase).
 */
const CODIGOS_RPC: [string, string][] = [
  ['whatsapp_nao_encontrado', 'sem_conexao_whatsapp'],
  ['template_nao_encontrado', 'template_nao_encontrado'],
  ['segredo_invalido', 'segredo_invalido'],
]

function codigoDaRpc(erro: { message: string }, generico: string): string {
  const achado = CODIGOS_RPC.find(([bruto]) => erro.message.includes(bruto))
  return achado ? achado[1] : generico
}

class SupabaseDisparoServico implements DisparoServico {
  constructor(
    private readonly cliente: SupabaseClient,
    private readonly segredo: string,
  ) {}

  async credencial(
    accountId: string,
  ): Promise<Resultado<{ token: string; phoneNumberId: string; wabaId: string }>> {
    const { data, error } = await this.cliente.rpc('credencial_whatsapp', {
      p_segredo: this.segredo,
      p_account_id: accountId,
    })
    if (error) return falha(codigoDaRpc(error, ERRO_AO_CARREGAR_TEMPLATES))

    // `returns table` chega como array. A RPC ja levanta
    // whatsapp_nao_encontrado quando nao ha conexao, entao a lista vazia e'
    // backstop — e um backstop que nao pode virar `data[0].token` de
    // undefined dentro da pagina.
    const linhas = (data ?? []) as { token: string; phone_number_id: string; waba_id: string }[]
    if (linhas.length === 0) return falha('sem_conexao_whatsapp')
    return ok({
      token: linhas[0].token,
      phoneNumberId: linhas[0].phone_number_id,
      wabaId: linhas[0].waba_id,
    })
  }

  async atualizarStatus(
    templateId: string,
    status: string,
    motivo: string | null,
  ): Promise<Resultado<void>> {
    const { error } = await this.cliente.rpc('atualizar_status_template', {
      p_segredo: this.segredo,
      p_template_id: templateId,
      p_status: status,
      p_motivo: motivo,
    })
    if (error) return falha(codigoDaRpc(error, ERRO_AO_SALVAR_TEMPLATE))
    return ok(undefined)
  }
}

/**
 * Monta o servico com um cliente Supabase ANONIMO e SEM COOKIES —
 * `createClient(url, anonKey)` de `@supabase/supabase-js`, nunca
 * `criarClienteServidor`, que carrega a sessao do usuario logado. Mesmo padrao
 * (e mesmos motivos) de `criarIngestaoStore` (ingestao.ts:156): a autorizacao
 * inteira destas chamadas e' o segredo, que `segredo_confere` confere dentro
 * de cada RPC — e o contrato do Plano 9 e' que a credencial do WhatsApp seja
 * inalcancavel por qualquer sessao.
 *
 * Falha ANTES de montar o cliente quando `INGESTAO_SEGREDO` esta vazio, em vez
 * de devolver um servico que ia bater `segredo_invalido` em toda chamada: o
 * erro tem que apontar para a configuracao do servidor, nao para o banco, que
 * responderia igualzinho a um segredo digitado errado. As env vars do Supabase
 * levam a mesma guarda em vez de `!`, para a falta virar `Resultado` e nao uma
 * excecao dentro do render da pagina.
 */
export function criarDisparoServico(): Resultado<DisparoServico> {
  const segredo = process.env.INGESTAO_SEGREDO ?? ''
  if (segredo.length === 0) return falha('ingestao_nao_configurada')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (url.length === 0 || anonKey.length === 0) return falha('ingestao_nao_configurada')

  // Sem sessao para persistir e sem refresh para agendar: as duas coisas
  // declaradas como `false` tornam o client "sem estado de auth" um invariante
  // do codigo, e nao um acidente dos defaults do supabase-js.
  const cliente = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return ok(new SupabaseDisparoServico(cliente, segredo))
}
