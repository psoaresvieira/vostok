'use client'

import { useState } from 'react'
import Link from 'next/link'
import { entrar } from '../acoes'

export default function LoginPage() {
  const [erro, setErro] = useState<string | null>(null)

  async function acao(formData: FormData) {
    const r = await entrar(formData)
    if (!r.ok) setErro(r.erro)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Entrar</h1>
      <form action={acao} className="flex flex-col gap-3">
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
        <button type="submit" className="rounded bg-black p-2 text-white">
          Entrar
        </button>
      </form>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <Link href="/signup" className="text-sm underline">
        Criar uma conta
      </Link>
    </main>
  )
}
