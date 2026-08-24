import { FormularioLogin } from './formulario'

// Server Component so para ler ?convite= e ?erro= e passar adiante como props
// (ver signup/page.tsx). O ?erro=sem_conta chega aqui vindo do redirect de
// (app)/layout.tsx: usuario autenticado sem nenhuma membership.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string | string[]; erro?: string | string[] }>
}) {
  const { convite, erro } = await searchParams
  const token = Array.isArray(convite) ? convite[0] : convite
  const codigoErro = Array.isArray(erro) ? erro[0] : erro
  return (
    <FormularioLogin convite={token?.trim() || null} semConta={codigoErro === 'sem_conta'} />
  )
}
