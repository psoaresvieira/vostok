import { notFound } from 'next/navigation'
import { souDonoDaPlataforma, contasDaPlataforma } from '@/lib/data/plataforma'
import { NovaConta } from './nova-conta'
import { ListaContas } from './lista-contas'

export default async function AdminPage() {
  // notFound e nao redirect: para quem nao e o dono esta pagina nao existe,
  // e um 404 nao confirma nada a quem sair fucando por rotas.
  if (!(await souDonoDaPlataforma())) notFound()

  const contas = await contasDaPlataforma()
  if (!contas.ok) throw new Error(contas.erro)

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Admin da plataforma</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Crie a conta do cliente e envie o link de convite. O cliente define a própria senha.
      </p>
      <NovaConta />
      <ListaContas contas={contas.valor} />
    </div>
  )
}
