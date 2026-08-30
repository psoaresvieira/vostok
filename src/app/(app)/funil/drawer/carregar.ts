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
 * O que o drawer do lead precisa ALEM do que a pagina do funil ja tem: as
 * tarefas do lead e a timeline.
 *
 * Recebe o `Lead` ja lido, e nao o id: a pagina do funil le a linha do lead
 * ANTES de resolver o quadro (e' ela que decide, pela pipeline do lead, se
 * redireciona para `?pipeline=`), e ler de novo aqui seria a mesma consulta
 * duas vezes. Por isso "lead nao encontrado" tambem e' decisao da pagina —
 * esta funcao so' roda quando o lead existe.
 *
 * Membros, motivos, etiquetas e pipelines com etapas ficavam aqui tambem
 * (Plano 17) e eram lidos DUAS vezes por render — uma para o quadro, outra
 * para o painel —, mais um `pipelinePorId` por pipeline da conta. Agora a
 * pagina passa os dela para o drawer (`DadosDoDrawer`).
 */
export async function carregarDrawer(store: CrmStore, lead: Lead): Promise<Resultado<DadosDoLead>> {
  // As duas leituras saem juntas, e nao em serie: so' precisam do id.
  //
  // `LIMITE_EVENTOS + 1` de proposito: a linha extra e' so' o sinal de que ha
  // historia mais antiga (a lista desenha `LIMITE_EVENTOS`), e sai mais barato
  // que um count exato numa tabela cuja policy roda por linha.
  const [eventos, tarefas] = await Promise.all([
    store.eventosDoLead(lead.id, LIMITE_EVENTOS + 1),
    (async () => {
      const tarefaStore = await criarTarefaStoreDoServidor()
      // Encaminha o codigo do store em vez de lancar aqui dentro: uma excecao
      // dentro do Promise.all rejeitaria a rodada inteira e perderia o erro
      // da outra leitura.
      if (!tarefaStore.ok) return falha<Tarefa[]>(tarefaStore.erro)
      return tarefaStore.valor.doLead(lead.id)
    })(),
  ])
  if (!eventos.ok) return falha(eventos.erro)
  if (!tarefas.ok) return falha(tarefas.erro)

  const temMaisEventos = eventos.valor.length > LIMITE_EVENTOS

  return ok({
    lead,
    tarefas: tarefas.valor,
    eventos: temMaisEventos ? eventos.valor.slice(0, LIMITE_EVENTOS) : eventos.valor,
    temMaisEventos,
  })
}
