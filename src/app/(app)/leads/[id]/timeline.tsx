import type { EventoLead } from '@/lib/domain/tipos'

const FORMATO = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export function rotuloEvento(
  evento: EventoLead,
  nomeEtapa: Map<string, string>,
  nomePessoa: Map<string, string>,
): string {
  const p = evento.payload
  switch (evento.tipo) {
    case 'lead_criado':
      return `Lead criado (origem: ${String(p.origem ?? 'manual')})`
    case 'etapa_alterada': {
      const de = p.de ? nomeEtapa.get(String(p.de)) ?? '?' : 'início'
      const para = nomeEtapa.get(String(p.para)) ?? '?'
      return `Etapa alterada: ${de} → ${para}`
    }
    case 'etiqueta_aplicada':
      return `Etiqueta "${String(p.tag ?? '?')}" aplicada em ${nomeEtapa.get(String(p.etapa)) ?? '?'}`
    case 'responsavel_alterado': {
      const para = p.para ? nomePessoa.get(String(p.para)) ?? '?' : 'ninguém'
      return `Responsável alterado para ${para}`
    }
    case 'nota':
      return String(p.texto ?? '(sem texto)')
    default:
      return evento.tipo
  }
}

export function Timeline({
  eventos,
  nomeEtapa,
  nomePessoa,
}: {
  eventos: EventoLead[]
  nomeEtapa: Map<string, string>
  nomePessoa: Map<string, string>
}) {
  if (eventos.length === 0) {
    return <p className="text-sm text-neutral-500">Nada aconteceu ainda.</p>
  }

  return (
    <ol className="flex flex-col gap-3">
      {eventos.map((e) => (
        <li key={e.id} className="border-l-2 pl-3">
          <p className="text-sm">{rotuloEvento(e, nomeEtapa, nomePessoa)}</p>
          <p className="text-xs text-neutral-500">
            {FORMATO.format(e.criadoEm)}
            {e.atorId ? ` · ${nomePessoa.get(e.atorId) ?? ''}` : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}
