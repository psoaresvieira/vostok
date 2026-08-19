import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/**
 * Etiqueta pequena — tag de lead, status de entrega, papel de membro. Pill
 * completa (rounded-full), que e' a forma que o iOS usa para qualquer rotulo
 * nao-interativo.
 *
 * Os tons semanticos saem dos tokens que ja existiam (--success, --warning,
 * --destructive) em cima de um fundo de 12%, e nao da cor cheia: texto branco
 * sobre #35d0a5 nao passa contraste, enquanto o proprio verde sobre um fundo
 * verde translucido passa com folga e ainda le como "sutil", que e' o papel de
 * um selo.
 */

type Tom = 'neutro' | 'primario' | 'sucesso' | 'aviso' | 'perigo'

const TONS: Record<Tom, string> = {
  neutro: 'bg-muted text-muted-foreground',
  primario: 'bg-primary/12 text-primary',
  sucesso: 'bg-success/12 text-success',
  aviso: 'bg-warning/12 text-warning',
  perigo: 'bg-destructive/12 text-destructive',
}

export function Selo({
  tom = 'neutro',
  className,
  ...props
}: ComponentProps<'span'> & { tom?: Tom }) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5',
        TONS[tom],
        className,
      )}
    />
  )
}
