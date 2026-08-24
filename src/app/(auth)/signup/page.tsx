import { redirect } from 'next/navigation'
import { FormularioCadastro } from './formulario'

// Server Component so para ler ?convite= e passar como prop. Sem convite nao
// ha cadastro: conta nasce pela mao do dono da plataforma (/admin), e o
// visitante que digitou /signup na mao volta para a porta de entrada.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string | string[] }>
}) {
  const { convite } = await searchParams
  const token = (Array.isArray(convite) ? convite[0] : convite)?.trim()
  if (!token) redirect('/login')
  return <FormularioCadastro convite={token} />
}
