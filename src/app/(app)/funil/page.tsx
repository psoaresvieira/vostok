import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import type { Lead } from '@/lib/domain/tipos'
import { Filtros } from './filtros'
import { Quadro } from './quadro'

export default async function FunilPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const { store, papel } = contexto.valor

  const pipeline = await store.pipelinePadrao()
  if (!pipeline.ok) throw new Error(pipeline.erro)

  const dias = params.dias ? Number(params.dias) : null
  const leads = await store.listarLeads({
    responsavelId: params.responsavel ?? null,
    origem: (params.origem as Lead['origem']) || null,
    desde: dias ? new Date(Date.now() - dias * 86_400_000) : null,
    busca: params.busca ?? null,
  })
  if (!leads.ok) throw new Error(leads.erro)

  const membros = await store.membros()
  if (!membros.ok) throw new Error(membros.erro)

  return (
    <>
      <Filtros membros={membros.valor} podeFiltrarPorResponsavel={papel !== 'vendedor'} />
      <Quadro etapas={pipeline.valor.etapas} leads={leads.valor} membros={membros.valor} />
    </>
  )
}
