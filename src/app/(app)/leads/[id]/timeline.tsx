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
    // Sem etapa no payload de proposito: o que importa registrar do desfazer e
    // QUAL etiqueta saiu — a etapa da aplicacao ja esta no evento de cima.
    case 'etiqueta_removida':
      return `Etiqueta "${String(p.tag ?? '?')}" removida`
    case 'responsavel_alterado': {
      const para = p.para ? nomePessoa.get(String(p.para)) ?? '?' : 'ninguém'
      return `Responsável alterado para ${para}`
    }
    case 'nota':
      return String(p.texto ?? '(sem texto)')
    case 'tarefa_concluida':
      return `Tarefa concluída: ${String(p.titulo ?? '?')}`
    // O TEXTO do payload, e nunca o conteudo do script de hoje: o script pode
    // ser editado e o template re-submetido depois do envio, e a historia do
    // lead tem que continuar mostrando o que o cliente REALMENTE recebeu. Mesmo
    // motivo do titulo em tarefa_concluida — snapshot, nao referencia.
    case 'whatsapp_enviado':
      return `WhatsApp enviado: ${String(p.texto ?? '?')}`
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
    return <p className="text-sm text-muted-foreground">Nada aconteceu ainda.</p>
  }

  return (
    <ol className="flex flex-col gap-3">
      {eventos.map((e) => (
        <li key={e.id} className="border-l-2 pl-3">
          <p className="text-sm">{rotuloEvento(e, nomeEtapa, nomePessoa)}</p>
          <p className="text-xs text-muted-foreground">
            {FORMATO.format(e.criadoEm)}
            {e.atorId ? ` · ${nomePessoa.get(e.atorId) ?? ''}` : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}
