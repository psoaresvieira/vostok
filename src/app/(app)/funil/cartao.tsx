'use client'
import Link from 'next/link'
import type { LeadDoFunil } from '@/lib/domain/tipos'
import { formatarDataCurta, horasNaEtapa, rotuloTempoNaEtapa } from '@/lib/domain/lead'
import { formatarTelefone } from '@/lib/domain/formato'
import { Selo } from '@/components/ui/selo'

/**
 * Cartao no formato de referencia (Kommo): tres linhas, ~70px. O VALOR saiu
 * daqui de proposito (spec 2026-08-28-crm-funil-kommo): mora no cabecalho do
 * drawer. O tempo parado virou a bolinha de status — a regra (72h) e' a mesma.
 */
export function Cartao({ lead, nomeResponsavel, href }: { lead: LeadDoFunil; nomeResponsavel: string | null; href: string }) {
  const horas = horasNaEtapa(lead.entrouNaEtapaEm, new Date())
  const parado = horas >= 72
  const rotuloStatus = parado ? `Parado há ${rotuloTempoNaEtapa(horas)}` : `Na etapa há ${rotuloTempoNaEtapa(horas)}`
  return (
    <article className="surface pressable group rounded-2xl p-2.5 hover:border-primary/40">
      <div className="flex items-center justify-between gap-2">
        <Link href={href} scroll={false} className="min-w-0 truncate text-sm font-semibold text-foreground group-hover:text-primary">
          {lead.nome}
        </Link>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="tabular">{formatarDataCurta(lead.criadoEm)}</span>
          <span role="img" aria-label={rotuloStatus} title={rotuloStatus}
            className={`inline-block h-2 w-2 rounded-full ${parado ? 'bg-destructive' : 'bg-muted-foreground/40'}`} />
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="tabular truncate text-foreground/80">{lead.telefoneE164 ? formatarTelefone(lead.telefoneE164) : 'sem telefone'}</span>
        <span className="truncate text-muted-foreground">{nomeResponsavel ?? 'sem responsável'}</span>
      </div>
      {lead.etiquetas.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {lead.etiquetas.map((e) => (<li key={e.id}><Selo tom="primario">{e.nome}</Selo></li>))}
        </ul>
      )}
    </article>
  )
}
