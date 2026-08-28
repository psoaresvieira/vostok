'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Lead, Membro } from '@/lib/domain/tipos'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErro } from '../erros'
import { trocarResponsavel } from './acoes'

/**
 * O responsavel do lead, dentro da aba Principal do drawer.
 *
 * O <select> "Mover para" saiu daqui (spec 2026-08-28): a etapa passa a mudar
 * pelo cabecalho colorido do drawer, que e' onde ela e' lida. Manter os dois
 * caminhos deixaria a mesma acao em dois lugares da mesma tela.
 */
export function AcoesLead({
  lead,
  membros,
  podeTrocarResponsavel,
}: {
  lead: Lead
  membros: Membro[]
  podeTrocarResponsavel: boolean
}) {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)

  if (!podeTrocarResponsavel) {
    const atual = membros.find((m) => m.id === lead.responsavelId)
    return <span>{atual?.nome ?? '—'}</span>
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={lead.responsavelId ?? ''}
        aria-label="Responsável"
        onChange={async (e) => {
          const r = await chamarAcao(trocarResponsavel(lead.id, e.target.value || null))
          if (!r.ok) setErro(mensagemDeErro(r.erro))
          else {
            setErro(null)
            router.refresh()
          }
        }}
        className="h-9 w-full rounded-xl border border-border bg-muted/60 px-2 text-sm text-foreground transition-colors focus:border-primary focus:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
      >
        <option value="">sem responsável</option>
        {membros.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nome}
          </option>
        ))}
      </select>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </div>
  )
}
