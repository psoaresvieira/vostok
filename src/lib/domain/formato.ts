const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatarMoeda(centavos: number | null): string {
  if (centavos === null || centavos === undefined) return '—'
  return MOEDA.format(centavos / 100).replace(/ /g, ' ')
}

export function formatarTelefone(e164: string | null): string {
  if (!e164) return '—'
  if (!e164.startsWith('+55')) return e164
  const d = e164.slice(3)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return e164
}
