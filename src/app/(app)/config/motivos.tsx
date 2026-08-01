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
          <li key={m.id} className="flex items-center justify-between rounded border p-2 text-sm">
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
          className="rounded border px-2 py-1 text-sm"
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
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
        >
          Adicionar
        </button>
      </div>
      {erro && <p className="mt-1 text-sm text-destructive">{erro}</p>}
    </section>
  )
}
