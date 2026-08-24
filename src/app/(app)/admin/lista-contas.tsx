'use client'

import { useState } from 'react'
import type { ContaDaPlataforma } from '@/lib/data/plataforma'
import { reemitirConviteAction } from './acoes'
import { mensagemDeErro } from './erros'

function estadoDoConvite(c: ContaDaPlataforma['convite']): string {
  if (!c) return '—'
  if (c.aceitoEm) return 'Aceito'
  if (c.expiraEm.getTime() < Date.now()) return 'Expirado'
  return 'Pendente'
}

export function ListaContas({ contas }: { contas: ContaDaPlataforma[] }) {
  const [erro, setErro] = useState<string | null>(null)
  const [links, setLinks] = useState<Record<string, string>>({})

  return (
    <section className="surface mt-6 rounded-2xl p-5">
      <h2 className="text-lg font-medium">Contas</h2>
      {contas.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">Nenhuma conta ainda.</p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {contas.map((conta) => {
          const estado = estadoDoConvite(conta.convite)
          return (
            <li key={conta.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
              <span className="font-medium">{conta.nome}</span>
              <span className="text-muted-foreground">{conta.convite?.email ?? 'sem convite'}</span>
              <span className="text-muted-foreground">{estado}</span>
              {conta.convite && !conta.convite.aceitoEm && (
                <button
                  type="button"
                  className="ml-auto rounded-lg border border-border px-2 py-1 hover:bg-muted"
                  onClick={async () => {
                    const r = await reemitirConviteAction(conta.convite!.id)
                    if (!r.ok) {
                      setErro(mensagemDeErro(r.erro))
                      return
                    }
                    setErro(null)
                    setLinks((atual) => ({
                      ...atual,
                      [conta.id]: `${window.location.origin}/convite/${r.valor}`,
                    }))
                  }}
                >
                  Reemitir convite
                </button>
              )}
              {links[conta.id] && <code className="w-full break-all text-xs">{links[conta.id]}</code>}
            </li>
          )
        })}
      </ul>
      {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}
    </section>
  )
}
