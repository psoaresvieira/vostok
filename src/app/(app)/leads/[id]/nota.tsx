'use client'

import { useState } from 'react'
import { adicionarNota } from './acoes'

export function FormularioNota({ leadId }: { leadId: string }) {
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    const r = await adicionarNota(leadId, texto)
    if (!r.ok) setErro(r.erro === 'nota_vazia' ? 'Escreva algo antes de salvar.' : r.erro)
    else {
      setErro(null)
      setTexto('')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="registrar uma nota"
        rows={2}
        className="rounded border p-2 text-sm"
      />
      <button
        type="button"
        onClick={salvar}
        className="self-start rounded bg-black px-3 py-1 text-sm text-white"
      >
        Salvar nota
      </button>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  )
}
