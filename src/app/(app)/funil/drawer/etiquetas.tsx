'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import type { Etiqueta } from '@/lib/domain/tipos'
import { chamarAcao, FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'
import { adicionarEtiquetas, removerEtiqueta } from './acoes'

// Codigos possiveis vindos de aplicarEtiquetas sao majoritariamente mensagens
// cruas do Postgres — disjuntos do mapa de moverEtapaAction (Finding 1), entao
// aqui basta um mapinha local seguindo a mesma convencao usada em
// funil/novo-lead.tsx e em convite/[token]/page.tsx (MENSAGENS + `?? r.erro`).
const MENSAGENS: Record<string, string> = {
  lead_nao_encontrado: 'Você não tem acesso a esse lead.',
  sem_sessao: 'Sua sessão expirou. Entre novamente.',
  sem_conta: 'Você não tem uma conta ativa.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

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
    const r = await chamarAcao(adicionarEtiquetas(leadId, [limpo]))
    if (!r.ok) setErro(MENSAGENS[r.erro] ?? r.erro)
    else {
      setErro(null)
      setEntrada('')
    }
  }

  async function remover(tagId: string) {
    const r = await chamarAcao(removerEtiqueta(leadId, tagId))
    if (!r.ok) setErro(MENSAGENS[r.erro] ?? r.erro)
    else setErro(null)
  }

  return (
    <div>
      <ul className="flex flex-wrap gap-1">
        {atuais.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-1 rounded bg-muted py-0.5 pl-2 pr-1 text-xs"
          >
            {e.nome}
            <button
              type="button"
              aria-label={`Remover ${e.nome}`}
              onClick={() => remover(e.id)}
              className="pressable rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
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
                className="rounded bg-muted px-2 py-0.5 text-xs hover:bg-secondary"
              >
                {s.nome}
              </button>
            </li>
          ))}
        </ul>
      )}
      {erro && <p className="mt-1 text-sm text-destructive">{erro}</p>}
    </div>
  )
}
