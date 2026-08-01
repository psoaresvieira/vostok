import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { criarFonteStoreDoServidor } from '@/lib/data/fontes'
import { Etapas } from './etapas'
import { Motivos } from './motivos'
import { Usuarios } from './usuarios'
import { Integracoes } from './integracoes'

/** Quantas entregas recentes o painel de diagnostico de Integracoes mostra. */
const LIMITE_ENTREGAS = 20

export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string }>
}) {
  const { meta } = await searchParams

  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  if (contexto.valor.papel !== 'admin') {
    return <p className="p-6 text-sm">Só administradores acessam a configuração.</p>
  }

  const adminContexto = await criarAdminStoreDoServidor()
  if (!adminContexto.ok) throw new Error(adminContexto.erro)

  const fonteContexto = await criarFonteStoreDoServidor()
  if (!fonteContexto.ok) throw new Error(fonteContexto.erro)

  const { store } = contexto.valor
  const [pipeline, membros, convites, fontes, entregas] = await Promise.all([
    store.pipelinePadrao(),
    store.membros(),
    adminContexto.valor.admin.convitesPendentes(),
    fonteContexto.valor.fontes.listar(),
    fonteContexto.valor.fontes.entregasRecentes(LIMITE_ENTREGAS),
  ])
  if (!pipeline.ok) throw new Error(pipeline.erro)
  if (!membros.ok) throw new Error(membros.erro)
  if (!convites.ok) throw new Error(convites.erro)
  if (!fontes.ok) throw new Error(fontes.erro)
  if (!entregas.ok) throw new Error(entregas.erro)

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
      <Integracoes
        fontes={fontes.valor}
        membros={membros.valor}
        origem={origem}
        etapa={meta ?? null}
        entregas={entregas.valor}
      />
    </div>
  )
}
