'use client'

import { useId, useRef, useState, type ReactNode } from 'react'

export type AbaDoDrawer = { id: string; rotulo: string; conteudo: ReactNode }

/**
 * Tablist do padrao WAI-ARIA, no minimo que o drawer do lead precisa.
 *
 * Duas decisoes que valem registro:
 *
 * 1. So o painel SELECIONADO existe no DOM (nao ha painel escondido com
 *    `hidden`). O conteudo de "Principal" inclui o bloco de scripts, que fala
 *    com o Graph do Meta; montar as tres abas de uma vez faria trabalho que
 *    ninguem pediu, e o drawer inteiro so' vive enquanto `?lead=` estiver na
 *    URL.
 * 2. Roving tabindex: apenas a aba selecionada tem `tabIndex=0`, as demais
 *    `-1`. E' o que faz o Tab pular a tablist inteira num salto (chegando ao
 *    painel) em vez de parar em cada aba — a navegacao entre elas e' pelas
 *    SETAS, que movem selecao e foco juntos.
 */
export function Abas({ abas }: { abas: AbaDoDrawer[] }) {
  const [ativa, setAtiva] = useState(0)
  // useId (e nao o `id` de cada aba) para que dois drawers/tablists na mesma
  // pagina nunca colidam nos ids que ligam aba e painel.
  const prefixo = useId()
  const botoesRef = useRef<(HTMLButtonElement | null)[]>([])

  function irPara(indice: number) {
    setAtiva(indice)
    botoesRef.current[indice]?.focus()
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLButtonElement>, indice: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      irPara((indice + 1) % abas.length)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      irPara((indice - 1 + abas.length) % abas.length)
    }
  }

  const aba = abas[ativa]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-4">
        {abas.map((a, i) => (
          <button
            key={a.id}
            ref={(no) => {
              botoesRef.current[i] = no
            }}
            type="button"
            role="tab"
            id={`${prefixo}-aba-${a.id}`}
            aria-selected={i === ativa}
            aria-controls={`${prefixo}-painel-${a.id}`}
            tabIndex={i === ativa ? 0 : -1}
            onClick={() => setAtiva(i)}
            onKeyDown={(e) => aoTeclar(e, i)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              i === ativa
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${prefixo}-painel-${aba.id}`}
        aria-labelledby={`${prefixo}-aba-${aba.id}`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {aba.conteudo}
      </div>
    </div>
  )
}
