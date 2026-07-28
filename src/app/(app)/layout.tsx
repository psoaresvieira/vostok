import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { sair } from '../(auth)/acoes'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const r = await criarStoreDoServidor()
  if (!r.ok) {
    if (r.erro === 'sem_sessao') redirect('/login')
    if (r.erro === 'sem_conta') redirect('/signup')
    throw new Error(r.erro)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">{r.valor.conta.nome}</span>
        <form action={sair}>
          <button type="submit" className="text-sm underline">
            Sair
          </button>
        </form>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
