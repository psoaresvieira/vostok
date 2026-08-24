'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cadastrar } from '../acoes'
import { mensagemDeErro } from '../erros'
import { Botao } from '@/components/ui/botao'
import { Campo } from '@/components/ui/campo'

export function FormularioCadastro({ convite }: { convite: string }) {
  const [erro, setErro] = useState<string | null>(null)

  async function acao(formData: FormData) {
    const r = await cadastrar(formData)
    if (!r.ok) setErro(mensagemDeErro(r.erro))
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      {/* Cartao centrado no lugar da coluna solta: e' a forma que uma tela de
          entrada tem no iOS/macOS — um painel com peso proprio sobre o fundo,
          e nao campos flutuando no vazio. */}
      <div className="surface fade-in rounded-3xl p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden="true"
            className="grid size-12 place-items-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground"
          >
            V
          </span>
          <div>
            <h1 className="text-[26px] font-semibold">Criar conta</h1>
            <p className="mt-1 text-sm text-muted-foreground">Vostok</p>
          </div>
        </div>

        <p className="mb-4 rounded-xl bg-primary/10 px-3 py-2 text-sm text-muted-foreground">
          Você foi convidado para uma conta que já existe. Use o email que recebeu o convite.
        </p>
        <form action={acao} className="flex flex-col gap-3">
          {/* O token viaja no proprio formulario: a Server Action nao enxerga a
              query string da pagina. Sem ele o cadastro volta a abrir uma conta
              nova e o convite nunca e resgatado. */}
          <input type="hidden" name="convite" value={convite} />
          <Campo name="nome" placeholder="seu nome" required />
          <Campo name="email" type="email" placeholder="email" required />
          <Campo name="senha" type="password" placeholder="senha (min. 8 caracteres)" required />
          <Botao type="submit" tamanho="lg" className="mt-2 w-full">
            Criar conta
          </Botao>
        </form>
        {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}
        <Link
          href={`/login?convite=${encodeURIComponent(convite)}`}
          className="mt-6 block text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Já tenho conta
        </Link>
      </div>
    </main>
  )
}
