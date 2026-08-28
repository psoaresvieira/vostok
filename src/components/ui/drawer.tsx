'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Painel lateral (drawer) para o lead do funil (Task 4) e outros usos
 * futuros. Mesmo padrao de portal do `Modal` (`montado` + `createPortal`
 * para `document.body`, listener de Escape) — ver `modal.tsx:36-52` para o
 * porque do portal (backdrop-filter/transform de um ancestral quebraria
 * `position: fixed`).
 *
 * Duas coisas que o `Modal` NAO tem e este componente precisa, por ser um
 * painel que ocupa a borda da tela (nao um dialogo centrado, facil de nao
 * perceber onde o foco foi parar):
 *
 * 1. Foco inicial no botao Fechar ao montar, e devolucao do foco ao elemento
 *    que estava focado ANTES de montar, ao desmontar — sem isso, quem abre o
 *    drawer por teclado (Tab/Enter num cartao do funil) perderia a posicao
 *    do cursor de foco ao fechar.
 * 2. Backdrop e painel como IRMAOS (nao painel dentro do backdrop): o
 *    backdrop cobre a tela inteira atras do painel, entao um clique nele
 *    fecha sem precisar da checagem `target === currentTarget` que o Modal
 *    usa — o painel nunca e' alvo do clique do backdrop porque nao esta
 *    dentro dele.
 */
export function Drawer({
  titulo,
  tituloId,
  aoFechar,
  cabecalho,
  children,
}: {
  titulo: string
  tituloId: string
  aoFechar: () => void
  cabecalho?: ReactNode
  children: ReactNode
}) {
  // Mesmo motivo do Modal: o portal so pode existir depois da montagem no
  // cliente, e renderizar null na primeira passada evita divergencia de
  // hidratacao (o drawer so abre por interacao).
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])

  const fecharRef = useRef<HTMLButtonElement>(null)
  const elementoAnteriorRef = useRef<Element | null>(null)

  // Guarda o foco de origem na montagem e o devolve no desmonte — roda uma
  // unica vez (deps vazias), entao o cleanup so dispara quando o Drawer
  // inteiro sai da arvore, nao a cada re-render.
  useEffect(() => {
    elementoAnteriorRef.current = document.activeElement
    return () => {
      if (elementoAnteriorRef.current instanceof HTMLElement) {
        elementoAnteriorRef.current.focus()
      }
    }
  }, [])

  // So depois que `montado` vira true o botao Fechar existe de fato no DOM
  // (o portal so' renderiza a partir dai) — por isso este efeito depende de
  // `montado` em vez de rodar so' na primeira passada.
  useEffect(() => {
    if (montado) fecharRef.current?.focus()
  }, [montado])

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') aoFechar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aoFechar])

  if (!montado) return null

  return createPortal(
    // Um `div` (nao fragmento) envolve backdrop + painel de proposito: o
    // portal precisa de um NO real para os dois filhos irmaos anexarem — um
    // fragmento os deixaria soltos direto em `document.body`, misturados com
    // outros elementos que ja estejam la.
    <div>
      <div className="fixed inset-0 z-30 bg-foreground/30" onClick={aoFechar} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="fixed inset-y-0 right-0 z-40 flex h-dvh w-[min(560px,100vw)] flex-col bg-background shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            {/* O <h2> so' existe quando NAO ha `cabecalho`. Um cabecalho
                proprio ja traz o nome visivel do painel, e e' ele que carrega
                `id={tituloId}` (o alvo do aria-labelledby): renderizar a copia
                sr-only junto criaria DOIS elementos com o mesmo id — HTML
                invalido, e `getElementById` resolveria para o errado — alem de
                anunciar o mesmo titulo duas vezes na navegacao por cabecalhos.
                Sem `cabecalho`, esta linha e' a unica fonte do nome. */}
            {cabecalho ?? (
              <h2 id={tituloId} className="sr-only">
                {titulo}
              </h2>
            )}
          </div>
          <button
            ref={fecharRef}
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="pressable shrink-0 rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
