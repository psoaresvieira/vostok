import Link from 'next/link'
import type { RankingEtiquetas } from '@/lib/domain/metricas'
import type { Etapa } from '@/lib/domain/tipos'

/**
 * Seletor de etapa por link (searchParams `?etapa=<id>`), nunca por estado de
 * cliente: a tela continua inteiramente server-rendered, o filtro sobrevive a
 * recarregar a pagina e a URL pode ser compartilhada com o filtro embutido.
 * Oferece TODAS as etapas, inclusive Ganho e Perdido — a visao serve tanto
 * para entender perda quanto ganho, e escondendo os desfechos so metade da
 * pergunta teria resposta.
 */
export function Etiquetas({
  ranking,
  etapas,
  escolhida,
}: {
  ranking: RankingEtiquetas
  etapas: Etapa[]
  escolhida: Etapa
}) {
  return (
    <section className="surface rounded-lg p-6">
      <p className="eyebrow">Etiquetas por etapa</p>
      <nav className="my-3 flex flex-wrap gap-2">
        {etapas.map((e) => (
          <Link
            key={e.id}
            href={`/metricas?etapa=${e.id}`}
            className={
              e.id === escolhida.id
                ? 'rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                : 'rounded border border-border px-3 py-1.5 text-sm text-muted-foreground'
            }
          >
            {e.nome}
          </Link>
        ))}
      </nav>
      {/* O denominador vem no cabecalho: sem ele, o percentual de cada barra
          fica solto e nao se sabe sobre qual base ele foi calculado. */}
      <p className="mb-4 text-sm text-muted-foreground">
        <span className="tabular">{ranking.denominador}</span> leads chegaram em{' '}
        {escolhida.nome}. A soma das barras pode passar de 100% porque um
        mesmo lead pode carregar várias etiquetas.
      </p>
      {ranking.linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma etiqueta foi aplicada nesta etapa.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ranking.linhas.map((l) => (
            <li key={l.tagId} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm">{l.nome}</span>
              <div className="h-6 flex-1 rounded bg-muted">
                <div
                  className="h-6 rounded"
                  style={{ width: `${l.percentual}%`, background: 'var(--chart-1)' }}
                />
              </div>
              <span className="tabular w-12 text-right text-sm">{l.leads}</span>
              <span className="tabular w-16 text-right text-sm text-muted-foreground">
                {Math.round(l.percentual)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
