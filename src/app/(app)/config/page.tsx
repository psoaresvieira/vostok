import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { Etapas } from './etapas'
import { Motivos } from './motivos'
import { Usuarios } from './usuarios'

export default async function ConfigPage() {
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  if (contexto.valor.papel !== 'admin') {
    return <p className="p-6 text-sm">Só administradores acessam a configuração.</p>
  }

  const adminContexto = await criarAdminStoreDoServidor()
  if (!adminContexto.ok) throw new Error(adminContexto.erro)

  const { store } = contexto.valor
  const [pipeline, membros, convites] = await Promise.all([
    store.pipelinePadrao(),
    store.membros(),
    adminContexto.valor.admin.convitesPendentes(),
  ])
  if (!pipeline.ok) throw new Error(pipeline.erro)
  if (!membros.ok) throw new Error(membros.erro)
  if (!convites.ok) throw new Error(convites.erro)

  // store.motivosPerda() so devolve ativos, que e o certo para o modal de perda.
  // A configuracao precisa dos inativos tambem, para poder reativar.
  const motivos = await adminContexto.valor.admin.todosMotivos()
  if (!motivos.ok) throw new Error(motivos.erro)

  const cabecalhos = await headers()
  const origem = `${cabecalhos.get('x-forwarded-proto') ?? 'http'}://${cabecalhos.get('host')}`

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold">Configuração</h1>
      <Etapas etapas={pipeline.valor.etapas} />
      <Motivos motivos={motivos.valor} />
      <Usuarios membros={membros.valor} convites={convites.valor} origem={origem} />
    </div>
  )
}
