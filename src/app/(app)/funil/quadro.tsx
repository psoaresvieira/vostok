'use client'

import type { Etapa, Lead, Membro } from '@/lib/domain/tipos'
import { Cartao } from './cartao'

export function Quadro({
  etapas,
  leads,
  membros,
}: {
  etapas: Etapa[]
  leads: Lead[]
  membros: Membro[]
}) {
  const nomePorId = new Map(membros.map((m) => [m.id, m.nome]))

  return (
    <div className="flex gap-4 overflow-x-auto p-6">
      {etapas.map((etapa) => {
        const daEtapa = leads.filter((l) => l.stageId === etapa.id)
        return (
          <section key={etapa.id} className="flex w-72 shrink-0 flex-col gap-2">
            <header className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{etapa.nome}</h2>
              <span className="text-xs text-neutral-500">{daEtapa.length}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-2 rounded bg-neutral-50 p-2">
              {daEtapa.map((lead) => (
                <Cartao
                  key={lead.id}
                  lead={lead}
                  nomeResponsavel={lead.responsavelId ? nomePorId.get(lead.responsavelId) ?? null : null}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
