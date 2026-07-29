import { FormularioLogin } from './formulario'

// Server Component so para ler ?convite= e passar como prop (ver signup/page.tsx).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string | string[] }>
}) {
  const { convite } = await searchParams
  const token = Array.isArray(convite) ? convite[0] : convite
  return <FormularioLogin convite={token?.trim() || null} />
}
