import type { CrmStore } from '@/lib/data/store'
import { criarTarefaStoreDoServidor, type Tarefa } from '@/lib/data/tarefas'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import type {
  Etapa,
  Etiqueta,
  EventoLead,
  Lead,
  Membro,
  MotivoPerda,
  Papel,
  Pipeline,
} from '@/lib/domain/tipos'

/**
 * Quantos eventos a linha do tempo carrega.
 *
 * A consulta nao tinha teto: um lead antigo (dezenas de movimentos, notas,
 * etiquetas e envios) serializava a historia INTEIRA no payload, e cada linha
 * de `lead_events` passa pela policy `lead_events_select`, que roda
 * `pode_ver_lead_id` por linha. 60 e' mais do que a janela que alguem le de
 * uma vez; o aviso abaixo da lista conta quando ha mais.
 */
export const LIMITE_EVENTOS = 60

export type DadosDoDrawer = {
  lead: Lead
  /**
   * TODAS as pipelines da conta, cada uma com as proprias etapas — e nao so a
   * pipeline atual do lead. Duas razoes: a timeline precisa nomear a etapa de
   * ORIGEM de um `pipeline_alterada` (que mora em outra pipeline), e o seletor
   * de etapa do cabecalho (Task 5) oferece mover o lead entre pipelines.
   */
  pipelines: { pipeline: Pipeline; etapas: Etapa[] }[]
  membros: Membro[]
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
  tarefas: Tarefa[]
  eventos: EventoLead[]
  temMaisEventos: boolean
  papel: Papel
}

/**
 * Tudo que o drawer do lead precisa, numa funcao so — o que era o corpo de
 * `leads/[id]/page.tsx` antes de a ficha virar painel do funil.
 *
 * `ok(null)` quando o lead nao existe OU a RLS o esconde: quem chama e' a
 * pagina do funil, que mostra um aviso acima do quadro em vez de 404 (o quadro
 * ao lado continua valido; derrubar a tela inteira por um `?lead=` velho
 * seria trocar um aviso por uma pagina de erro).
 */
export async function carregarDrawer(
  store: CrmStore,
  papel: Papel,
  leadId: string,
): Promise<Resultado<DadosDoDrawer | null>> {
  // TUDO que nao depende da linha do lead sai junto com ela, e nao depois:
  // membros, etiquetas, motivos, tarefas e timeline so' precisam do `leadId`.
  // Em serie seriam duas latencias somadas no caminho critico do painel.
  //
  // Se o lead nao existir (ou a RLS o esconder), as leituras ao lado terao
  // sido feitas a toa — um `?lead=` invalido e' raro o bastante para valer o
  // corte de latencia em todos os outros.
  //
  // `tarefaStore.doLead` vinha numa SEGUNDA rodada, encadeada depois da
  // construcao do store; aqui a construcao e a consulta moram na mesma funcao
  // interna e a latencia das duas nao se soma a das demais.
  //
  // `LIMITE_EVENTOS + 1` de proposito: a linha extra e' so' o sinal de que ha
  // historia mais antiga (a lista desenha `LIMITE_EVENTOS`), e sai mais barato
  // que um count exato numa tabela cuja policy roda por linha.
  const [lead, membros, eventos, etiquetas, motivos, tarefas, pipelines] = await Promise.all([
    store.buscarLead(leadId),
    store.membros(),
    store.eventosDoLead(leadId, LIMITE_EVENTOS + 1),
    store.etiquetasDaConta(),
    store.motivosPerda(),
    (async () => {
      const tarefaStore = await criarTarefaStoreDoServidor()
      // Encaminha o codigo do store em vez de lancar aqui dentro: uma excecao
      // dentro do Promise.all rejeitaria a rodada inteira e perderia os erros
      // das outras cinco leituras.
      if (!tarefaStore.ok) return falha<Tarefa[]>(tarefaStore.erro)
      return tarefaStore.valor.doLead(leadId)
    })(),
    store.listarPipelines(),
  ])
  if (!lead.ok) return falha(lead.erro)
  // Zero linhas por RLS chega aqui como null: e "nao encontrado", nunca 403.
  if (!lead.valor) return ok(null)
  if (!membros.ok) return falha(membros.erro)
  if (!eventos.ok) return falha(eventos.erro)
  if (!etiquetas.ok) return falha(etiquetas.erro)
  if (!motivos.ok) return falha(motivos.erro)
  if (!tarefas.ok) return falha(tarefas.erro)
  if (!pipelines.ok) return falha(pipelines.erro)

  // As etapas de cada pipeline. Depende de `listarPipelines`, entao nao cabia
  // no Promise.all acima; entre si sao independentes e saem juntas.
  const detalhadas = await Promise.all(pipelines.valor.map((p) => store.pipelinePorId(p.id)))
  const comEtapas: { pipeline: Pipeline; etapas: Etapa[] }[] = []
  for (const d of detalhadas) {
    if (!d.ok) return falha(d.erro)
    comEtapas.push(d.valor)
  }

  const temMaisEventos = eventos.valor.length > LIMITE_EVENTOS

  return ok({
    lead: lead.valor,
    pipelines: comEtapas,
    membros: membros.valor,
    motivos: motivos.valor,
    etiquetasConhecidas: etiquetas.valor,
    tarefas: tarefas.valor,
    eventos: temMaisEventos ? eventos.valor.slice(0, LIMITE_EVENTOS) : eventos.valor,
    temMaisEventos,
    papel,
  })
}
