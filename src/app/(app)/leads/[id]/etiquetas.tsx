'use client'

import { useState } from 'react'
import type { Etiqueta } from '@/lib/domain/tipos'
import { adicionarEtiquetas } from './acoes'

export function EditorEtiquetas({
  leadId,
  atuais,
  conhecidas,
}: {
  leadId: string
  atuais: Etiqueta[]
  conhecidas: Etiqueta[]
}) {
  const [entrada, setEntrada] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const sugestoes = conhecidas
    .filter((c) => c.nome.toLowerCase().includes(entrada.toLowerCase()))
    .filter((c) => !atuais.some((a) => a.nome.toLowerCase() === c.nome.toLowerCase()))
    .slice(0, 6)

  async function aplicar(nome: string) {
    const limpo = nome.trim()
    if (!limpo) return
    const r = await adicionarEtiquetas(leadId, [limpo])
    if (!r.ok) setErro(r.erro)
    else {
      setErro(null)
      setEntrada('')
    }
  }

  return (
    <div>
      <ul className="flex flex-wrap gap-1">
        {atuais.map((e) => (
          <li key={e.id} className="rounded bg-neutral-100 px-2 py-0.5 text-xs">
            {e.nome}
          </li>
        ))}
      </ul>
      <input
        value={entrada}
        onChange={(e) => setEntrada(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            aplicar(entrada)
          }
        }}
        placeholder="nova etiqueta (Enter para aplicar)"
        className="mt-2 w-full rounded border p-2 text-sm"
      />
      {sugestoes.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {sugestoes.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => aplicar(s.nome)}
                className="rounded bg-neutral-100 px-2 py-0.5 text-xs hover:bg-neutral-200"
              >
                {s.nome}
              </button>
            </li>
          ))}
        </ul>
      )}
      {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
    </div>
  )
}
