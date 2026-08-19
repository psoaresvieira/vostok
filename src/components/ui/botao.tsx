import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/**
 * Botao unico do app. Antes desta peca existir, o botao primario era remontado
 * a mao em 21 telas (`rounded bg-primary px-3 py-1 text-sm text-primary-foreground
 * disabled:opacity-50`), o que explicava as alturas diferentes de tela para tela:
 * cada copia tinha derivado um pouco.
 *
 * Os `<button>` continuam `<button>` e recebem todas as props nativas — em
 * especial `type`, que NAO ganha default aqui de proposito. Metade dos usos
 * esta dentro de <form> com Server Action, onde `type="submit"` e' o
 * comportamento certo, e a outra metade passa `type="button"` explicito. Um
 * default errado quebraria um dos dois lados em silencio.
 */

type Variante = 'primario' | 'secundario' | 'fantasma' | 'destrutivo' | 'contorno'
type Tamanho = 'sm' | 'md' | 'lg' | 'icone'

/**
 * Altura fixa por tamanho (h-*), e nao padding vertical: e' o que garante que
 * um botao, um <select> e um <input> na mesma linha fiquem alinhados. Com
 * `py-1` a altura passava a depender do line-height do conteudo, e um botao
 * com icone ficava 2px mais alto que o vizinho so com texto.
 */
const TAMANHOS: Record<Tamanho, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-[13px]',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-12 gap-2 rounded-xl px-5 text-[15px]',
  // Quadrado: mesma altura do md, largura igual a altura. Para o kebab, o
  // sino, o fechar de modal — qualquer botao que so carrega um icone.
  icone: 'h-10 w-10 justify-center rounded-xl',
}

const VARIANTES: Record<Variante, string> = {
  primario:
    'bg-primary text-primary-foreground shadow-sm hover:brightness-110 active:brightness-95',
  // Superficie elevada: o botao "de sistema" do iOS, usado em Cancelar quando
  // o par primario esta ao lado.
  secundario: 'bg-secondary text-secondary-foreground hover:bg-accent',
  // Sem caixa ate o hover. E' o default de acao terciaria (Cancelar solto,
  // item de menu) e o que substituiu os `<button className="px-3 py-1 text-sm">`
  // sem fundo nenhum espalhados pelas telas.
  fantasma: 'text-muted-foreground hover:bg-accent hover:text-foreground',
  destrutivo:
    'bg-destructive text-destructive-foreground shadow-sm hover:brightness-110 active:brightness-95',
  contorno: 'border border-border bg-transparent text-foreground hover:bg-accent',
}

const BASE =
  'pressable inline-flex shrink-0 items-center justify-center font-medium ' +
  // O anel de foco fica no :focus-visible e nunca no :focus — senao ele
  // aparece tambem no clique de mouse, o que nao acontece em nenhum controle
  // nativo do macOS/iOS. offset-2 sobre o fundo escuro para o anel nao colar
  // na borda do proprio botao.
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-background ' +
  'disabled:pointer-events-none disabled:opacity-50'

export function Botao({
  variante = 'primario',
  tamanho = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variante?: Variante; tamanho?: Tamanho }) {
  return (
    <button
      {...props}
      className={cn(BASE, TAMANHOS[tamanho], VARIANTES[variante], className)}
    />
  )
}

/**
 * Mesma pele do Botao, em <a>. Existe porque um link que PARECE botao tem que
 * continuar sendo <a> — navegacao por teclado, abrir em nova aba e o menu de
 * contexto do navegador dependem disso, e um <button onClick={router.push}>
 * perde os tres. Aceita href obrigatorio; para <Link> do Next, use `asChild`
 * nao — passe o proprio Link com estas classes via `classesDeBotao`.
 */
export function BotaoLink({
  variante = 'primario',
  tamanho = 'md',
  className,
  ...props
}: ComponentProps<'a'> & { variante?: Variante; tamanho?: Tamanho }) {
  return <a {...props} className={cn(BASE, TAMANHOS[tamanho], VARIANTES[variante], className)} />
}

/**
 * Escape hatch para quando o elemento nao pode ser nosso — o caso real e'
 * o <Link> do next/link, que precisa ser o proprio componente para o
 * prefetch funcionar. Sem isto o consumidor copiaria as strings de variante a
 * mao, que e' exatamente o problema que este arquivo veio resolver.
 */
export function classesDeBotao(variante: Variante = 'primario', tamanho: Tamanho = 'md'): string {
  return cn(BASE, TAMANHOS[tamanho], VARIANTES[variante])
}
