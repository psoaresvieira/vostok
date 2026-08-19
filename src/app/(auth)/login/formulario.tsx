'use client'

import { useState } from 'react'
import Link from 'next/link'
import { entrar } from '../acoes'
import { mensagemDeErro } from '../erros'
import { Botao } from '@/components/ui/botao'
import { Campo } from '@/components/ui/campo'

export function FormularioLogin({ convite }: { convite: string | null }) {
  const [erro, setErro] = useState<string | null>(null)

  async function acao(formData: FormData) {
    const r = await entrar(formData)
    if (!r.ok) setErro(mensagemDeErro(r.erro))
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      {/* Mesmo cartao do cadastro — as duas telas sao a mesma porta e nao
          podem ter pesos diferentes. */}
      <div className="surface fade-in rounded-3xl p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden="true"
            className="grid size-12 place-items-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground"
          >
            V
          </span>
          <div>
            <h1 className="text-[26px] font-semibold">Entrar</h1>
            <p className="mt-1 text-sm text-muted-foreground">Vostok</p>
          </div>
        </div>

        {convite && (
          <p className="mb-4 rounded-xl bg-primary/10 px-3 py-2 text-sm text-muted-foreground">
            Entre com o email que recebeu o convite para aceitá-lo.
          </p>
        )}
        <form action={acao} className="flex flex-col gap-3">
          {/* O token viaja no formulario: a Server Action nao le a query string. */}
          {convite && <input type="hidden" name="convite" value={convite} />}
          <Campo name="email" type="email" placeholder="email" required />
          <Campo name="senha" type="password" placeholder="senha" required />
          <Botao type="submit" tamanho="lg" className="mt-2 w-full">
            Entrar
          </Botao>
        </form>
        {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}
        <Link
          href={convite ? `/signup?convite=${encodeURIComponent(convite)}` : '/signup'}
          className="mt-6 block text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Criar uma conta
        </Link>
      </div>
    </main>
  )
}
