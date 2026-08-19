'use client'

import { useState } from 'react'
import type { MotivoPerda } from '@/lib/domain/tipos'
import { alternarMotivoAction, criarMotivoAction } from './acoes'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErro } from './erros'

export function Motivos({ motivos }: { motivos: MotivoPerda[] }) {
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  return (
    <section>
      <h2 className="mb-2 font-semibold">Motivos de perda</h2>
      <ul className="flex flex-col gap-1">
        {motivos.map((m) => (
          <li key={m.id} className="surface flex items-center justify-between rounded-xl p-3 text-sm">
            <span className={m.ativo ? undefined : 'text-muted-foreground line-through'}>{m.nome}</span>
            <button
              type="button"
              onClick={async () => {
                const r = await chamarAcao(alternarMotivoAction(m.id, !m.ativo))
                if (!r.ok) setErro(mensagemDeErro(r.erro))
              }}
              className="text-xs underline"
            >
              {m.ativo ? 'desativar' : 'reativar'}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="novo motivo"
          className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={async () => {
            const r = await chamarAcao(criarMotivoAction(nome))
            if (!r.ok) setErro(mensagemDeErro(r.erro))
            else {
              setErro(null)
              setNome('')
            }
          }}
          className="pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground shadow-sm hover:brightness-110"
        >
          Adicionar
        </button>
      </div>
      {erro && <p className="mt-1 text-sm text-destructive">{erro}</p>}
    </section>
  )
}
