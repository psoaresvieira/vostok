import { FormularioLogin } from './formulario'

// Server Component so para ler ?convite= e passar como prop (ver signup/page.tsx).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>
}) {
  const { convite } = await searchParams
  return <FormularioLogin convite={convite?.trim() || null} />
}
