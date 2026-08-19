import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { Editor } from '../editor'

// Segmento estatico: no App Router ele vence /scripts/[id], entao `buscar`
// nunca recebe 'novo'.
export default async function NovoScriptPage() {
  // So criarStoreDoServidor: esta tela nao le script nenhum, e o `papel` que
  // ela precisa vem daqui junto com as etapas — resolver o ScriptStore tambem
  // seria um round-trip a mais para o mesmo dado.
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')

  // Nao encontrado, nunca 403: para o vendedor a tela de edicao nem existe.
  // Mesma convencao de buscarLead. A guarda de verdade e a RLS.
  if (contexto.valor.papel === 'vendedor') notFound()

  const pipeline = await contexto.valor.store.pipelinePadrao()
  if (!pipeline.ok) throw new Error(pipeline.erro)

  return (
    <div className="fade-in flex flex-col gap-6 p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <Link href="/disparo" className="text-sm underline">
          Scripts
        </Link>
        <h1 className="text-[26px] font-semibold">Novo script</h1>
      </div>
      <Editor script={null} etapas={pipeline.valor.etapas} />
    </div>
  )
}
