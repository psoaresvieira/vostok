'use client'

import { useState } from 'react'
import type { Membro, Papel } from '@/lib/domain/tipos'
import type { Convite } from '@/lib/data/admin'
import { convidarAction, revogarConviteAction } from './acoes'
import { mensagemDeErro } from './erros'

export function Usuarios({
  membros,
  convites,
  origem,
}: {
  membros: Membro[]
  convites: Convite[]
  origem: string
}) {
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Papel>('vendedor')
  const [link, setLink] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  return (
    <section>
      <h2 className="mb-2 font-semibold">Usuários</h2>
      <ul className="flex flex-col gap-1">
        {membros.map((m) => (
          <li key={m.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span>
              {m.nome} <span className="text-neutral-500">({m.email})</span>
            </span>
            <span className="text-xs text-neutral-500">{m.papel}</span>
          </li>
        ))}
      </ul>

      {convites.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-medium">Convites pendentes</h3>
          <ul className="flex flex-col gap-1">
            {convites.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded border border-dashed p-2 text-sm"
              >
                <span>
                  {c.email} <span className="text-xs text-neutral-500">({c.papel})</span>
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    const r = await revogarConviteAction(c.id)
                    if (!r.ok) setErro(mensagemDeErro(r.erro))
                  }}
                  className="text-xs underline"
                >
                  revogar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email do convidado"
          className="rounded border px-2 py-1 text-sm"
        />
        <select
          value={papel}
          onChange={(e) => setPapel(e.target.value as Papel)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="vendedor">vendedor</option>
          <option value="gestor">gestor</option>
          <option value="admin">admin</option>
        </select>
        <button
          type="button"
          onClick={async () => {
            const r = await convidarAction(email, papel)
            if (!r.ok) {
              setErro(mensagemDeErro(r.erro))
              return
            }
            setErro(null)
            setEmail('')
            setLink(`${origem}/convite/${r.valor}`)
          }}
          className="rounded bg-black px-3 py-1 text-sm text-white"
        >
          Convidar
        </button>
      </div>

      {link && (
        <p className="mt-2 rounded bg-neutral-100 p-2 text-sm">
          Envie este link ao convidado: <code className="break-all">{link}</code>
        </p>
      )}
      {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
    </section>
  )
}
