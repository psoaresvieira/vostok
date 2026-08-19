'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import type { Membro } from '@/lib/domain/tipos'
import { Campo, Selecao } from '@/components/ui/campo'

/**
 * Rotulos deliberadamente curtos: a largura de um <select> nativo vem da sua
 * OPCAO MAIS LONGA, nao do padding. Com "Últimos 90 dias" e "Todos os
 * responsáveis" na lista, os quatro controles somados estouravam a barra e
 * criavam scroll lateral. O rotulo da opcao neutra ('') nomeia a DIMENSAO
 * ("Período"), que e' o que um filtro em estado neutro precisa dizer.
 */
const PERIODOS = [
  { valor: '', rotulo: 'Período' },
  { valor: '7', rotulo: '7 dias' },
  { valor: '30', rotulo: '30 dias' },
  { valor: '90', rotulo: '90 dias' },
]

const ORIGENS = [
  { valor: '', rotulo: 'Origem' },
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
    // Uma linha so, sem `flex-wrap`: os quatro controles ficam lado a lado. O
    // que absorve a falta de espaco e' o campo de busca (`min-w-0` + `flex-1`
    // logo abaixo) encolhendo, e nao um select pulando para a linha de baixo —
    // com wrap, a barra mudava de altura sozinha ao estreitar a janela e
    // empurrava o quadro do funil para baixo.
    <div className="flex min-w-0 items-center gap-2">
      {/* A lupa e' decorativa e nao um botao: quem dispara a busca continua
          sendo o Enter no campo, exatamente como antes. Por isso ela e'
          `pointer-events-none` — um clique nela deve cair no input embaixo e
          posicionar o cursor, nao ser engolido pelo icone. */}
      <div className="relative w-52 min-w-28 shrink">
        <Search
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Campo
          defaultValue={params.get('busca') ?? ''}
          placeholder="buscar por nome, telefone ou email"
          className="h-8 w-full pl-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') atualizar('busca', (e.target as HTMLInputElement).value)
          }}
        />
      </div>
      {podeFiltrarPorResponsavel && (
        <Selecao
          defaultValue={params.get('responsavel') ?? ''}
          className="w-36 h-8 shrink-0 px-2.5 pr-7 text-xs [background-position:right_0.5rem_center] [background-size:0.95rem]"
          onChange={(e) => atualizar('responsavel', e.target.value)}
        >
          <option value="">Responsável</option>
          {membros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </Selecao>
      )}
      <Selecao
        defaultValue={params.get('origem') ?? ''}
        className="w-32 h-8 shrink-0 px-2.5 pr-7 text-xs [background-position:right_0.5rem_center] [background-size:0.95rem]"
        onChange={(e) => atualizar('origem', e.target.value)}
      >
        {ORIGENS.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </Selecao>
      <Selecao
        defaultValue={params.get('dias') ?? ''}
        className="w-28 h-8 shrink-0 px-2.5 pr-7 text-xs [background-position:right_0.5rem_center] [background-size:0.95rem]"
        onChange={(e) => atualizar('dias', e.target.value)}
      >
        {PERIODOS.map((p) => (
          <option key={p.valor} value={p.valor}>
            {p.rotulo}
          </option>
        ))}
      </Selecao>
    </div>
  )
}
