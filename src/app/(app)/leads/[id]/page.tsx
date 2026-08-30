import { redirect } from 'next/navigation'
import { hrefDoFunil } from '@/app/(app)/funil/params'

/**
 * A ficha virou o drawer do funil (spec 2026-08-28). Links antigos (sino,
 * tarefas, timeline, URL salva) continuam validos por este redirect.
 *
 * Sem consulta nenhuma aqui: `/funil?lead=` resolve sozinho a pipeline do
 * lead (redireciona para `?pipeline=` quando ele nao esta na padrao), pede
 * login se nao ha sessao e mostra o proprio aviso quando o lead nao existe
 * ou a RLS o esconde. Antes esta rota lia o lead e a pipeline so' para montar
 * a URL — duas consultas a mais num caminho que o funil ja percorre.
 */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(hrefDoFunil('', { lead: id }))
}
