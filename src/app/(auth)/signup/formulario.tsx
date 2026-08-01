'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cadastrar } from '../acoes'
import { mensagemDeErro } from '../erros'

export function FormularioCadastro({ convite }: { convite: string | null }) {
  const [erro, setErro] = useState<string | null>(null)

  async function acao(formData: FormData) {
    const r = await cadastrar(formData)
    if (!r.ok) setErro(mensagemDeErro(r.erro))
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Criar conta</h1>
      {convite && (
        <p className="text-sm text-muted-foreground">
          Você foi convidado para uma conta que já existe. Use o email que recebeu o convite.
        </p>
      )}
      <form action={acao} className="flex flex-col gap-3">
        {/* O token viaja no proprio formulario: a Server Action nao enxerga a
            query string da pagina. Sem ele o cadastro volta a abrir uma conta
            nova e o convite nunca e resgatado. */}
        {convite && <input type="hidden" name="convite" value={convite} />}
        <input name="nome" placeholder="seu nome" required className="rounded border p-2" />
        {/* Convidado nao nomeia empresa nenhuma — ele entra na de quem convidou. */}
        {!convite && (
          <input
            name="nomeConta"
            placeholder="nome da empresa"
            required
            className="rounded border p-2"
          />
        )}
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
          placeholder="senha (min. 8 caracteres)"
          required
          className="rounded border p-2"
        />
        <button type="submit" className="rounded bg-primary p-2 text-primary-foreground">
          Criar conta
        </button>
      </form>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <Link
        href={convite ? `/login?convite=${encodeURIComponent(convite)}` : '/login'}
        className="text-sm underline"
      >
        Já tenho conta
      </Link>
    </main>
  )
}
