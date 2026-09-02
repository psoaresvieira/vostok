/** Mesmo racional do loading.tsx do funil: feedback no instante do clique. */
export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center py-24" aria-busy="true">
      <p className="text-sm text-muted-foreground">Carregando disparo…</p>
    </div>
  )
}
