'use client'

import { useState } from 'react'
import { chamarAcao, FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'
import { adicionarNota } from './acoes'

// Mesma convencao dos vizinhos (etiquetas.tsx, funil/novo-lead.tsx): mapa local
// + `?? r.erro`. Era um ternario de um caso so; virou mapa porque agora ha dois.
const MENSAGENS: Record<string, string> = {
  nota_vazia: 'Escreva algo antes de salvar.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

export function FormularioNota({ leadId }: { leadId: string }) {
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    const r = await chamarAcao(adicionarNota(leadId, texto))
    if (!r.ok) setErro(MENSAGENS[r.erro] ?? r.erro)
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
        className="self-start rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
      >
        Salvar nota
      </button>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </div>
  )
}
