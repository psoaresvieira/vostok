import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { hrefDoFunil } from '@/app/(app)/funil/params'

/**
 * A ficha virou o drawer do funil (spec 2026-08-28). Links antigos (sino,
 * tarefas, timeline) continuam validos por este redirect.
 *
 * Lead inexistente ou escondido pela RLS nao e' 404: e' o funil sem painel
 * nenhum. O `?pipeline=` so' entra quando o lead NAO esta na pipeline padrao —
 * sem ele a URL fica curta e o funil resolve a padrao sozinho.
 */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const lead = await contexto.valor.store.buscarLead(id)
  // Falha do store (conexao, RLS quebrada) e' outra coisa que "lead nao
  // existe": manda pro funil JA com `?lead=`, que tenta carregar de novo e,
  // numa segunda falha, mostra o proprio aviso da tela em vez de engolir o
  // erro em silencio como um redirect puro faria.
  if (!lead.ok) redirect(hrefDoFunil('', { lead: id }))
  if (!lead.valor) redirect('/funil')
  const pipeline = await contexto.valor.store.pipelinePorId(lead.valor.pipelineId)
  const pipelineParam = pipeline.ok && !pipeline.valor.pipeline.isDefault ? lead.valor.pipelineId : null
  redirect(hrefDoFunil('', { pipeline: pipelineParam, lead: id }))
}
