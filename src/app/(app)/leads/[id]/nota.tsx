'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import { chamarAcao, FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'
import { Botao } from '@/components/ui/botao'
import { AreaDeTexto } from '@/components/ui/campo'
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
      {/* Era um <textarea> com `rows={2}` E `h-10` ao mesmo tempo: a altura
          fixa de 40px vencia o rows e o campo nascia raso demais para duas
          linhas de nota. Agora a altura vem so' do min-h do componente. */}
      <AreaDeTexto
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="registrar uma nota"
        rows={3}
        className="min-h-20"
      />
      <Botao type="button" tamanho="sm" onClick={salvar} className="self-start">
        <Send size={14} strokeWidth={2} aria-hidden="true" />
        Salvar nota
      </Botao>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </div>
  )
}
