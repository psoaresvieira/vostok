import { redirect } from 'next/navigation'
import Link from 'next/link'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { aceitarConvite } from '../../acoes'

const MENSAGENS: Record<string, string> = {
  convite_invalido: 'Convite não encontrado.',
  convite_expirado: 'Este convite expirou. Peça um novo ao administrador.',
  convite_ja_aceito: 'Este convite já foi usado.',
  convite_de_outro_email:
    'Este convite foi enviado para outro email. Entre com o email convidado para aceitá-lo.',
  sem_email: 'Sua conta não tem email. Entre novamente para aceitar o convite.',
  sem_sessao: 'Crie sua conta ou entre para aceitar o convite.',
}

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const cliente = await criarClienteServidor()
  const {
    data: { user },
  } = await cliente.auth.getUser()

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Você foi convidado</h1>
        <p className="text-sm">Crie sua conta ou entre para aceitar o convite.</p>
        <Link href="/signup" className="underline">
          Criar conta
        </Link>
        <Link href="/login" className="underline">
          Entrar
        </Link>
      </main>
    )
  }

  const r = await aceitarConvite(token)
  if (r.ok) redirect('/funil')

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Convite não aceito</h1>
      <p className="text-sm text-red-600">{MENSAGENS[r.erro] ?? r.erro}</p>
    </main>
  )
}
