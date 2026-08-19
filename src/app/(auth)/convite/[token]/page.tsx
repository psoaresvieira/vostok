import { redirect } from 'next/navigation'
import Link from 'next/link'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { aceitarConvite } from '../../acoes'
import { mensagemDeErro } from '../../erros'

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const cliente = await criarClienteServidor()
  const {
    data: { user },
  } = await cliente.auth.getUser()

  if (!user) {
    // O token vai junto para o cadastro e para o login. Sem isso ele morria
    // aqui: o convidado criava uma conta propria, virava admin dela, e o
    // convite ficava pendente para sempre.
    const destino = `convite=${encodeURIComponent(token)}`
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-[26px] font-semibold">Você foi convidado</h1>
        <p className="text-sm">Crie sua conta ou entre para aceitar o convite.</p>
        <Link href={`/signup?${destino}`} className="underline">
          Criar conta
        </Link>
        <Link href={`/login?${destino}`} className="underline">
          Entrar
        </Link>
      </main>
    )
  }

  const r = await aceitarConvite(token)
  if (r.ok) redirect('/funil')

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-[26px] font-semibold">Convite não aceito</h1>
      <p className="text-sm text-destructive">{mensagemDeErro(r.erro)}</p>
    </main>
  )
}
