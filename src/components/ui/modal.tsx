'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

/**
 * Sheet no formato do iOS: fundo borrado (nao so escurecido), cantos bem
 * arredondados e entrada com escala. Substitui o par
 * `fixed inset-0 ... bg-black/40` + `surface ... rounded p-5` que estava
 * copiado em cinco telas (renomear pipeline, excluir pipeline, movimento de
 * lead, nova pipeline, editar etapas).
 *
 * O que NAO ha aqui, de proposito: foco preso (focus trap) e `inert` no resto
 * da pagina. Um dialogo acessivel de verdade precisa dos dois, e fazer isso
 * direito pede <dialog> nativo ou uma dependencia de headless UI — decisao
 * grande demais para vir de carona numa mudanca de visual. O que este
 * componente ADICIONA sobre o que existia: Escape fecha e o clique no fundo
 * fecha, dois comportamentos que nenhuma das cinco copias tinha. O foco
 * continua livre para sair do modal por Tab, como ja era antes.
 */
export function Modal({
  titulo,
  descricao,
  aoFechar,
  largura = 'sm',
  children,
}: {
  titulo: string
  descricao?: string
  /** Ausente = modal so fecha pelos proprios botoes (Escape e fundo ficam inertes). */
  aoFechar?: () => void
  largura?: 'sm' | 'md' | 'lg'
  children: ReactNode
}) {
  /**
   * O portal so pode existir depois da montagem no cliente: `document` nao
   * existe no render do servidor. Renderizar null na primeira passada e' de
   * proposito — o conteudo do modal nao precisa vir no HTML inicial (ele so
   * abre por interacao), e assim nao ha divergencia de hidratacao.
   */
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])

  useEffect(() => {
    if (!aoFechar) return
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') aoFechar!()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aoFechar])

  const larguras = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' }

  if (!montado) return null

  /**
   * PORTAL PARA O <body>, e isto NAO e' preferencia de organizacao: sem ele o
   * modal aparecia deslocado, preso a um pedaco da tela em vez de centrado.
   *
   * O motivo e' que `position: fixed` deixa de se ancorar no viewport quando
   * algum ancestral cria um containing block, e `backdrop-filter` cria um —
   * exatamente como `transform` e `filter`. A barra de filtros do funil usa a
   * classe `.vibrancy` (backdrop-filter: blur+saturate), e o botao "Novo lead"
   * mora dentro dela: o `inset-0` do overlay passava a medir aquela faixa de
   * ~60px de altura, nao a janela.
   *
   * Portanto: se este portal for removido, o bug volta — e volta so' nos modais
   * abertos de dentro de um ancestral com backdrop-filter/transform, que e' o
   * pior tipo de regressao (parece aleatorio).
   */
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      // O fundo so fecha quando o clique NASCE nele: sem a checagem de target,
      // um arrasto que comeca dentro do modal e termina fora (selecionar texto
      // de um campo, por exemplo) fechava o dialogo no meio da selecao.
      onClick={aoFechar ? (e) => e.target === e.currentTarget && aoFechar() : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={cn(
          'surface fade-in w-full rounded-3xl p-6 shadow-2xl',
          larguras[largura],
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{titulo}</h2>
            {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
          </div>
          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="pressable -mr-1 -mt-1 shrink-0 rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Rodape de acoes do modal, alinhado a direita. Existe so para o espacamento
 * (`gap-2`, `mt-6`) parar de ser redigitado em cada dialogo — era o lugar onde
 * as copias mais divergiam entre si (mt-2, mt-4, sem mt).
 */
export function AcoesDoModal({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex items-center justify-end gap-2">{children}</div>
}
