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
    <article className="rounded border bg-white p-3 shadow-sm">
      <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
        {lead.nome}
      </Link>
      <p className="mt-1 text-sm text-neutral-600">{formatarMoeda(lead.valorCents)}</p>
      {lead.etiquetas.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {lead.etiquetas.map((e) => (
            <li key={e.id} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
              {e.nome}
            </li>
          ))}
        </ul>
      )}
      <footer className="mt-2 flex items-center justify-between text-xs text-neutral-500">
        <span>{nomeResponsavel ?? 'sem responsável'}</span>
        <span className={parado ? 'font-medium text-red-600' : undefined}>
          {rotuloTempoNaEtapa(horas)}
        </span>
      </footer>
    </article>
  )
}
