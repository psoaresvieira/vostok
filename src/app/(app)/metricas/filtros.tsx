'use client'

import { useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Membro } from '@/lib/domain/tipos'

// Nomes de parametro exatamente os que interpretarPeriodo le — dias, de e
// ate — senao a URL montada aqui e a que a pagina interpreta divergiriam em
// silencio.
const PERIODOS = [
  { dias: '7', rotulo: '7 dias' },
  { dias: '30', rotulo: '30 dias' },
  { dias: '90', rotulo: '90 dias' },
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
  // Refs, nao useState controlado: os campos de data so precisam ser lidos
  // no clique de "Aplicar" (mesmo padrao do campo de busca em
  // funil/filtros.tsx, que le o DOM em vez de copiar prop/URL para estado).
  const deRef = useRef<HTMLInputElement>(null)
  const ateRef = useRef<HTMLInputElement>(null)

  function irPara(entradas: Record<string, string | null>) {
    const novos = new URLSearchParams(params.toString())
    for (const [chave, valor] of Object.entries(entradas)) {
      if (valor) novos.set(chave, valor)
      else novos.delete(chave)
    }
    router.push(`/metricas?${novos.toString()}`)
  }

  // Um preset so aparece marcado quando nao ha intervalo customizado em
  // vigor — senao os dois controles disputariam qual esta escolhido. Sem
  // parametro nenhum o padrao e 30 dias, o mesmo default de interpretarPeriodo.
  const temIntervalo = Boolean(params.get('de') || params.get('ate'))
  const diasAtivo = temIntervalo ? null : (params.get('dias') || '30')

  function aplicarIntervalo() {
    const de = deRef.current?.value
    const ate = ateRef.current?.value
    // So aplica quando as duas pontas estao preenchidas: um intervalo pela
    // metade cairia em periodo_invalido (Invalid Date do lado vazio) sem o
    // usuario ter pedido isso.
    if (!de || !ate) return
    // 'YYYY-MM-DD' compara certo como string (ordem lexicografica == ordem
    // cronologica). Barra aqui o erro mais comum — data final antes da
    // inicial — antes de gerar um load de pagina inteiro so pra mostrar
    // periodo_invalido; a pagina de metricas continua validando de novo, pra
    // quem chegar direto por link com parametros manuais.
    if (de >= ate) return
    irPara({ de, ate, dias: null })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {PERIODOS.map((p) => (
          <button
            key={p.dias}
            type="button"
            className={
              diasAtivo === p.dias
                ? 'rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                : 'rounded border border-border px-3 py-1.5 text-sm'
            }
            onClick={() => irPara({ dias: p.dias, de: null, ate: null })}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 text-sm">
        <label className="flex items-center gap-1">
          de
          <input
            ref={deRef}
            type="date"
            defaultValue={params.get('de') ?? ''}
            className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
          />
        </label>
        <label className="flex items-center gap-1">
          até
          <input
            ref={ateRef}
            type="date"
            defaultValue={params.get('ate') ?? ''}
            className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
          />
        </label>
        <button
          type="button"
          className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
          onClick={aplicarIntervalo}
        >
          Aplicar
        </button>
      </div>
      {podeFiltrarPorResponsavel && (
        <select
          defaultValue={params.get('responsavel') ?? ''}
          className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-sm"
          onChange={(e) => irPara({ responsavel: e.target.value || null })}
        >
          <option value="">Todos os responsáveis</option>
          {membros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
