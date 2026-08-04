import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { criarScriptStoreDoServidor } from '@/lib/data/scripts'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { Editor } from '../editor'

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [contexto, base] = await Promise.all([
    criarScriptStoreDoServidor(),
    criarStoreDoServidor(),
  ])
  if (!contexto.ok) redirect('/login')
  if (!base.ok) redirect('/login')

  // Nao encontrado, nunca 403 — mesma convencao de /scripts/novo. Antes de
  // qualquer leitura: nao ha motivo de ir ao banco por um script que esta tela
  // nao vai mostrar.
  if (contexto.valor.papel === 'vendedor') notFound()

  const [script, pipeline] = await Promise.all([
    contexto.valor.scripts.buscar(id),
    base.valor.store.pipelinePadrao(),
  ])
  if (!script.ok) throw new Error(script.erro)
  // Zero linhas por RLS, conta errada, id inexistente ou id que nem e uuid
  // chegam aqui como null: e "nao encontrado", nunca 403 nem erro tecnico.
  if (!script.valor) notFound()
  if (!pipeline.ok) throw new Error(pipeline.erro)

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Link href="/scripts" className="text-sm underline">
          Scripts
        </Link>
        <h1 className="text-2xl font-semibold">{script.valor.titulo}</h1>
      </div>
      <Editor script={script.valor} etapas={pipeline.valor.etapas} />
    </div>
  )
}
