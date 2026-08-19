import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/**
 * Controles de formulario. O padrao antigo era `rounded border p-2` — borda
 * cheia sobre fundo transparente, que num tema escuro le como "caixa vazia
 * desenhada com linha". Aqui o campo e' uma SUPERFICIE (fundo proprio, borda
 * quase invisivel), que e' como o iOS desenha entrada de texto: o preenchimento
 * separa do fundo, nao o contorno.
 *
 * Nenhum destes componentes toca em `placeholder`, `name` ou `aria-label` — as
 * suites E2E e de componente selecionam por esses atributos
 * (`getByPlaceholder('nome da empresa')`, por exemplo), entao eles passam
 * direto do consumidor para o elemento nativo.
 */

const BASE_CONTROLE =
  'w-full rounded-xl border border-border bg-muted/60 px-3 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/70 ' +
  'transition-[background-color,border-color,box-shadow] duration-150 ' +
  'hover:border-border/80 ' +
  // focus-visible nao serve para campo de texto: quem clica num input espera
  // ver o foco (diferente de um botao), e :focus-visible nao dispara no clique
  // de mouse em alguns navegadores. Aqui e' :focus mesmo, de proposito.
  'focus:border-primary focus:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export function Campo({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cn(BASE_CONTROLE, 'h-10', className)} />
}

/**
 * `resize-none`: a alca de redimensionar do canto e' a unica parte de um
 * <textarea> que o usuario pode arrastar para FORA do layout — esticada, ela
 * atravessa o card vizinho e a coluna ao lado, e nada volta ao lugar sem
 * recarregar. A altura util vem de `rows`/`min-h-*` de quem monta o campo.
 */
export function AreaDeTexto({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      {...props}
      className={cn(BASE_CONTROLE, 'min-h-24 resize-none py-2 leading-relaxed', className)}
    />
  )
}

/**
 * A seta nativa do <select> e' pintada pelo navegador e ignora o tema; num
 * fundo escuro ela some. `appearance-none` mata a seta nativa e o SVG inline
 * (data URI, para nao virar mais um request) redesenha o chevron na cor do
 * texto secundario. O `pr-9` reserva o espaco dela — sem isso o texto de uma
 * opcao longa passa por baixo do chevron.
 *
 * O popup de opcoes em si continua sendo do navegador e nao aceita CSS nosso;
 * quem o mantem legivel e' o `color-scheme: dark` no html (ver globals.css).
 */
export function Selecao({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={cn(
        BASE_CONTROLE,
        'h-10 cursor-pointer appearance-none bg-no-repeat pr-9',
        '[background-position:right_0.65rem_center] [background-size:1.1rem]',
        "[background-image:url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238496b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
    />
  )
}

/**
 * Rotulo de campo. Bloco, com o controle dentro ou referenciado por htmlFor —
 * os dois formatos aparecem nas telas e nenhum e' imposto aqui.
 */
export function Rotulo({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      {...props}
      className={cn('flex flex-col gap-1.5 text-[13px] font-medium text-muted-foreground', className)}
    />
  )
}
