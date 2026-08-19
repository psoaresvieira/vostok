'use client'

import Link from 'next/link'
import { Clock } from 'lucide-react'
import type { LeadDoFunil } from '@/lib/domain/tipos'
import { horasNaEtapa, rotuloTempoNaEtapa } from '@/lib/domain/lead'
import { formatarMoeda } from '@/lib/domain/formato'
import { Selo } from '@/components/ui/selo'

export function Cartao({ lead, nomeResponsavel }: { lead: LeadDoFunil; nomeResponsavel: string | null }) {
  const horas = horasNaEtapa(lead.entrouNaEtapaEm, new Date())
  // O contador de tempo parado e o que provoca acao; destacamos a partir de 3 dias.
  const parado = horas >= 72

  return (
    <article className="surface pressable group rounded-2xl p-3 hover:border-primary/40">
      <Link
        href={`/leads/${lead.id}`}
        className="block truncate text-sm font-semibold text-foreground group-hover:text-primary"
      >
        {lead.nome}
      </Link>

      {/* Valor em destaque e responsavel embaixo, em vez das tres colunas
          apertadas de antes: num cartao de 288px, `justify-between` com tres
          filhos deixava o nome do responsavel truncado em duas letras assim
          que o valor passava de mil. */}
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="tabular text-sm font-semibold text-foreground">
          {formatarMoeda(lead.valorCents)}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 text-[11px] ${
            parado ? 'font-medium text-destructive' : 'text-muted-foreground'
          }`}
        >
          <Clock size={12} strokeWidth={2} aria-hidden="true" />
          {rotuloTempoNaEtapa(horas)}
        </span>
      </div>

      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {nomeResponsavel ?? 'sem responsável'}
      </p>

      {lead.etiquetas.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {lead.etiquetas.map((e) => (
            <li key={e.id}>
              <Selo tom="primario">{e.nome}</Selo>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
