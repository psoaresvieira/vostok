/**
 * Feedback instantaneo da navegacao: sem este arquivo, clicar em "Funil" nao
 * muda NADA na tela ate o servidor devolver a pagina inteira — com a cadeia
 * de leituras do quadro, segundos de aparente travamento. O App Router mostra
 * este fallback no instante do clique, dentro do layout que persiste.
 */
export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center py-24" aria-busy="true">
      <p className="text-sm text-muted-foreground">Carregando funil…</p>
    </div>
  )
}
