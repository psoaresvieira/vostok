'use client'

import { useState } from 'react'
import Link from 'next/link'
import { entrar } from '../acoes'
import { mensagemDeErro } from '../erros'

export function FormularioLogin({ convite }: { convite: string | null }) {
  const [erro, setErro] = useState<string | null>(null)

  async function acao(formData: FormData) {
    const r = await entrar(formData)
    if (!r.ok) setErro(mensagemDeErro(r.erro))
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Entrar</h1>
      {convite && (
        <p className="text-sm text-muted-foreground">
          Entre com o email que recebeu o convite para aceitá-lo.
        </p>
      )}
      <form action={acao} className="flex flex-col gap-3">
        {/* O token viaja no formulario: a Server Action nao le a query string. */}
        {convite && <input type="hidden" name="convite" value={convite} />}
        <input
          name="email"
          type="email"
          placeholder="email"
          required
          className="rounded border p-2"
        />
        <input
          name="senha"
          type="password"
          placeholder="senha"
          required
          className="rounded border p-2"
        />
        <button type="submit" className="rounded bg-primary p-2 text-primary-foreground">
          Entrar
        </button>
      </form>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <Link
        href={convite ? `/signup?convite=${encodeURIComponent(convite)}` : '/signup'}
        className="text-sm underline"
      >
        Criar uma conta
      </Link>
    </main>
  )
}
