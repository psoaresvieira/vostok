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

/** O que `carregarDrawer` le: so' o que depende do lead. */
export type DadosDoLead = {
  lead: Lead
  tarefas: Tarefa[]
  eventos: EventoLead[]
  temMaisEventos: boolean
}

/**
 * Tudo que o drawer recebe. `DadosDoLead` mais o que a pagina do funil JA
 * carrega para o quadro (pipelines com etapas, membros, motivos, etiquetas) —
 * o drawer nao le nada disso de novo; e' a pagina que junta as duas metades.
 */
export type DadosDoDrawer = DadosDoLead & {
  /**
   * TODAS as pipelines da conta, cada uma com as proprias etapas — e nao so a
   * pipeline atual do lead. Duas razoes: a timeline precisa nomear a etapa de
   * ORIGEM de um `pipeline_alterada` (que mora em outra pipeline), e o seletor
   * de etapa do cabecalho oferece mover o lead entre pipelines.
   */
  pipelines: { pipeline: Pipeline; etapas: Etapa[] }[]
  membros: Membro[]
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
  papel: Papel
}

/**
 * O que o drawer do lead precisa ALEM do que a pagina do funil ja tem: a
 * linha do lead, as tarefas dele e a timeline.
 *
 * Membros, motivos, etiquetas e pipelines com etapas ficavam aqui tambem
 * (Plano 17) e eram lidos DUAS vezes por render — uma para o quadro, outra
 * para o painel —, mais um `pipelinePorId` por pipeline da conta. Agora a
 * pagina passa os dela para o drawer (`DadosDoDrawer`).
 *
 * `ok(null)` quando o lead nao existe OU a RLS o esconde: quem chama e' a
 * pagina do funil, que mostra um aviso acima do quadro em vez de 404 (o quadro
 * ao lado continua valido; derrubar a tela inteira por um `?lead=` velho
 * seria trocar um aviso por uma pagina de erro).
 */
export async function carregarDrawer(
  store: CrmStore,
  leadId: string,
): Promise<Resultado<DadosDoLead | null>> {
  // As tres leituras saem juntas, e nao em serie: tarefas e timeline so'
  // precisam do `leadId`. Se o lead nao existir (ou a RLS o esconder), as
  // duas ao lado terao sido feitas a toa — um `?lead=` invalido e' raro o
  // bastante para valer o corte de latencia em todos os outros.
  //
  // `LIMITE_EVENTOS + 1` de proposito: a linha extra e' so' o sinal de que ha
  // historia mais antiga (a lista desenha `LIMITE_EVENTOS`), e sai mais barato
  // que um count exato numa tabela cuja policy roda por linha.
  const [lead, eventos, tarefas] = await Promise.all([
    store.buscarLead(leadId),
    store.eventosDoLead(leadId, LIMITE_EVENTOS + 1),
    (async () => {
      const tarefaStore = await criarTarefaStoreDoServidor()
      // Encaminha o codigo do store em vez de lancar aqui dentro: uma excecao
      // dentro do Promise.all rejeitaria a rodada inteira e perderia os erros
      // das outras leituras.
      if (!tarefaStore.ok) return falha<Tarefa[]>(tarefaStore.erro)
      return tarefaStore.valor.doLead(leadId)
    })(),
  ])
  if (!lead.ok) return falha(lead.erro)
  // Zero linhas por RLS chega aqui como null: e "nao encontrado", nunca 403.
  if (!lead.valor) return ok(null)
  if (!eventos.ok) return falha(eventos.erro)
  if (!tarefas.ok) return falha(tarefas.erro)

  const temMaisEventos = eventos.valor.length > LIMITE_EVENTOS

  return ok({
    lead: lead.valor,
    tarefas: tarefas.valor,
    eventos: temMaisEventos ? eventos.valor.slice(0, LIMITE_EVENTOS) : eventos.valor,
    temMaisEventos,
  })
}
