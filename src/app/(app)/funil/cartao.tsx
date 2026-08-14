'use client'

import Link from 'next/link'
import type { Lead } from '@/lib/domain/tipos'
import { horasNaEtapa, rotuloTempoNaEtapa } from '@/lib/domain/lead'
import { formatarMoeda } from '@/lib/domain/formato'

export function Cartao({ lead, nomeResponsavel }: { lead: Lead; nomeResponsavel: string | null }) {
  const horas = horasNaEtapa(lead.entrouNaEtapaEm, new Date())
  // O contador de tempo parado e o que provoca acao; destacamos a partir de 3 dias.
  const parado = horas >= 72

  return (
    <article className="rounded border bg-card p-2 shadow-sm">
      <Link href={`/leads/${lead.id}`} className="text-sm font-medium hover:underline">
        {lead.nome}
      </Link>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{formatarMoeda(lead.valorCents)}</span>
        <span>{nomeResponsavel ?? 'sem responsável'}</span>
        <span className={parado ? 'font-medium text-destructive' : undefined}>
          {rotuloTempoNaEtapa(horas)}
        </span>
      </div>
      {lead.etiquetas.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {lead.etiquetas.map((e) => (
            <li key={e.id} className="rounded bg-muted px-1 py-0 text-[10px]">
              {e.nome}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
