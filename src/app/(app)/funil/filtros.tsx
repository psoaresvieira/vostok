'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { Membro } from '@/lib/domain/tipos'

const PERIODOS = [
  { valor: '', rotulo: 'Todo o período' },
  { valor: '7', rotulo: 'Últimos 7 dias' },
  { valor: '30', rotulo: 'Últimos 30 dias' },
  { valor: '90', rotulo: 'Últimos 90 dias' },
]

const ORIGENS = [
  { valor: '', rotulo: 'Todas as origens' },
  { valor: 'manual', rotulo: 'Manual' },
  { valor: 'meta', rotulo: 'Meta Ads' },
  { valor: 'google', rotulo: 'Google Ads' },
  { valor: 'indicacao', rotulo: 'Indicação' },
  { valor: 'organico', rotulo: 'Orgânico' },
]

export function Filtros({
  membros,
  podeFiltrarPorResponsavel,
}: {
  membros: Membro[]
  podeFiltrarPorResponsavel: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()

  function atualizar(chave: string, valor: string) {
    const novos = new URLSearchParams(params.toString())
    if (valor) novos.set(chave, valor)
    else novos.delete(chave)
    router.push(`/funil?${novos.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
      <input
        defaultValue={params.get('busca') ?? ''}
        placeholder="buscar por nome, telefone ou email"
        className="rounded border px-2 py-1 text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') atualizar('busca', (e.target as HTMLInputElement).value)
        }}
      />
      {podeFiltrarPorResponsavel && (
        <select
          defaultValue={params.get('responsavel') ?? ''}
          className="rounded border px-2 py-1 text-sm"
          onChange={(e) => atualizar('responsavel', e.target.value)}
        >
          <option value="">Todos os responsáveis</option>
          {membros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      )}
      <select
        defaultValue={params.get('origem') ?? ''}
        className="rounded border px-2 py-1 text-sm"
        onChange={(e) => atualizar('origem', e.target.value)}
      >
        {ORIGENS.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
      <select
        defaultValue={params.get('dias') ?? ''}
        className="rounded border px-2 py-1 text-sm"
        onChange={(e) => atualizar('dias', e.target.value)}
      >
        {PERIODOS.map((p) => (
          <option key={p.valor} value={p.valor}>
            {p.rotulo}
          </option>
        ))}
      </select>
    </div>
  )
}
