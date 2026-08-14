'use server'

import { criarStoreDoServidor } from '@/lib/data/supabase'
import { contextoDoLead, type ContextoScript } from '@/lib/domain/script'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'

export type LeadParaDisparo = {
  id: string
  nome: string
  telefoneE164: string | null
  etapa: string | null
  /** Pronto para interpolar — montado no servidor com contextoDoLead. */
  contexto: ContextoScript
}

/**
 * Corte de leitura para a tela de disparo, nunca truncamento silencioso de
 * escrita: quem procura um lead pelo nome refina a busca se o dele nao
 * aparecer entre os 10 primeiros — o mesmo trato que scripts/acoes.ts da' a
 * MAX_TAGS, so' que aqui a paginacao completa e' escopo de outra tela (o
 * funil).
 */
const LIMITE_RESULTADOS = 10

/**
 * Busca leads para o Passo 2 do fluxo de disparo (Task 7).
 *
 * Termo em branco devolve `ok([])` SEM tocar o store: a caixa de busca comeca
 * vazia, e listar a conta inteira a cada render seria uma consulta que
 * ninguem pediu.
 *
 * A RLS de `leads` e' quem recorta o vendedor aos leads dele — a mesma
 * garantia da tela de funil, sem teste novo aqui (task-7-brief.md).
 */
export async function buscarLeadsParaDisparo(
  termo: string,
): Promise<Resultado<LeadParaDisparo[]>> {
  const busca = termo.trim()
  if (busca.length === 0) return ok([])

  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const { store } = contexto.valor

  // Os tres independentes: nenhum depende do outro, e todos resolvem a mesma
  // conta ativa — mesma forma de enviarWhatsApp (leads/[id]/acoes-whatsapp.ts).
  const [leads, pipeline, membros] = await Promise.all([
    store.listarLeads({ busca }),
    store.pipelinePadrao(),
    store.membros(),
  ])
  if (!leads.ok) return falha(leads.erro)
  if (!pipeline.ok) return falha(pipeline.erro)
  if (!membros.ok) return falha(membros.erro)

  const nomeEtapa = new Map(pipeline.valor.etapas.map((e) => [e.id, e.nome]))
  const nomePessoa = new Map(membros.valor.map((m) => [m.id, m.nome]))

  return ok(
    leads.valor.slice(0, LIMITE_RESULTADOS).map((lead) => ({
      id: lead.id,
      nome: lead.nome,
      telefoneE164: lead.telefoneE164,
      etapa: nomeEtapa.get(lead.stageId) ?? null,
      contexto: contextoDoLead(lead, nomeEtapa, nomePessoa),
    })),
  )
}
