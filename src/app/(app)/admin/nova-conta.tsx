'use client'

import { useState } from 'react'
import { criarContaClienteAction } from './acoes'
import { mensagemDeErro } from './erros'
import { Botao } from '@/components/ui/botao'
import { Campo } from '@/components/ui/campo'

export function NovaConta() {
  const [erro, setErro] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  async function acao(formData: FormData) {
    const r = await criarContaClienteAction(formData)
    if (!r.ok) {
      setErro(mensagemDeErro(r.erro))
      setLink(null)
      return
    }
    setErro(null)
    setCopiado(false)
    // Mesmo formato do convite de equipe (config/usuarios.tsx): o link
    // canonico e' /convite/<token>, que sabe encaminhar para signup ou login.
    setLink(`${window.location.origin}/convite/${r.valor}`)
  }

  return (
    <section className="surface mt-6 rounded-2xl p-5">
      <h2 className="text-lg font-medium">Nova conta</h2>
      <form action={acao} className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Campo name="nome" placeholder="nome da conta" required />
        <Campo name="email" type="email" placeholder="email do cliente" required />
        <Botao type="submit" className="shrink-0">
          Criar conta
        </Botao>
      </form>
      {link && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded bg-muted p-2 text-sm">
          Envie este link ao cliente: <code className="break-all">{link}</code>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs hover:bg-background"
            onClick={async () => {
              await navigator.clipboard.writeText(link)
              setCopiado(true)
            }}
          >
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </p>
      )}
      {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}
    </section>
  )
}
