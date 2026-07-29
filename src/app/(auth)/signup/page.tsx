import { FormularioCadastro } from './formulario'

// Server Component so para ler ?convite= e passar como prop: o formulario e
// client (precisa de estado para o erro), e componente client nao le
// searchParams sem useSearchParams + Suspense.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>
}) {
  const { convite } = await searchParams
  return <FormularioCadastro convite={convite?.trim() || null} />
}
