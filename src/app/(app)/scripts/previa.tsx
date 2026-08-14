import type { ReactElement } from 'react'
import type { Segmento } from '@/lib/domain/script'
import { formatarSegmentos, type EstiloWhatsApp } from '@/lib/domain/whatsapp-formato'

const CLASSE_POR_ESTILO: Record<EstiloWhatsApp, string> = {
  negrito: 'font-bold',
  italico: 'italic',
  riscado: 'line-through',
  mono: 'font-mono',
}

function classesDeEstilo(estilos: EstiloWhatsApp[]): string | undefined {
  if (estilos.length === 0) return undefined
  return estilos.map((e) => CLASSE_POR_ESTILO[e]).join(' ')
}

/**
 * Previa compartilhada dos dois lugares que pintam segmentos interpolados: o
 * editor de script e o painter da ficha do lead (Plano 13, Task 2 — paga o
 * backlog do Plano 10 de nao duplicar essa pintura).
 *
 * So recebe `Segmento[]`, nunca texto cru: quem interpola e' o chamador — uma
 * interpolacao por script, a mesma que alimenta Copiar/wa.me/envio, e' o que
 * garante que a previa nunca diverge do que sai por esses outros caminhos.
 *
 * Roda `formatarSegmentos` (Task 1) por cima e pinta o resultado. lacuna e
 * desconhecida continuam <mark> com o rotulo num <span class="sr-only">
 * DENTRO da marca — nao um aria-label nela, porque o papel ARIA de <mark> e'
 * name-prohibited (Plano 10) e a tecnologia assistiva ignora aria-label ali.
 * A grafia dos rotulos e' a mesma que os dois painters ja usavam.
 */
export function PreviaSegmentos({ segmentos }: { segmentos: Segmento[] }): ReactElement {
  const trechos = formatarSegmentos(segmentos)

  return (
    <>
      {trechos.map((t, i) => {
        if (t.tipo === 'lacuna') {
          return (
            <mark key={i} className="rounded bg-warning/25 px-0.5 text-warning">
              {t.texto}
              <span className="sr-only">{` ${t.nome} sem valor`}</span>
            </mark>
          )
        }
        if (t.tipo === 'desconhecida') {
          return (
            <mark
              key={i}
              className="rounded bg-destructive/25 px-0.5 text-destructive underline decoration-dotted"
            >
              {t.texto}
              <span className="sr-only">{` ${t.nome} não é uma variável`}</span>
            </mark>
          )
        }
        const classe = classesDeEstilo(t.estilos)
        return classe ? (
          <span key={i} className={classe}>
            {t.texto}
          </span>
        ) : (
          <span key={i}>{t.texto}</span>
        )
      })}
    </>
  )
}
