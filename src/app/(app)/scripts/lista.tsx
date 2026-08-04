import Link from 'next/link'
import type { Script } from '@/lib/data/scripts'

/**
 * Os cards da biblioteca. Extraido de page.tsx (que e' server component e nao
 * da pra montar no jsdom) so para a decisao link-vs-texto ser testavel — mesma
 * separacao de tarefas/lista.tsx. Sem estado e sem action: nao precisa de
 * 'use client'.
 *
 * `podeEditar = false` (vendedor) tira o LINK, nao o card: a biblioteca segue
 * listavel e filtravel por ele. O titulo linkado para os tres papeis era um
 * beco sem saida — /scripts/[id] responde notFound() para vendedor, entao o
 * clique so podia dar 404. Isto e' nao oferecer um caminho que a rota nao
 * cumpre; a guarda continua sendo o notFound() da propria rota.
 */
export function ListaDeScripts({
  scripts,
  nomeDaEtapa,
  podeEditar,
}: {
  scripts: Script[]
  nomeDaEtapa: Map<string, string>
  podeEditar: boolean
}) {
  return (
    <ul className="flex flex-col gap-2">
      {scripts.map((s) => (
        <li key={s.id} className="flex flex-col gap-1 rounded border border-border p-3">
          {podeEditar ? (
            <Link href={`/scripts/${s.id}`} className="font-medium underline">
              {s.titulo}
            </Link>
          ) : (
            <span className="font-medium">{s.titulo}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {s.stageId === null
              ? 'Qualquer etapa'
              : // A FK e' `on delete set null`, entao stage_id apontando para
                // etapa inexistente nao acontece hoje; o fallback cobre o
                // script de um pipeline que nao e o padrao, sem mentir dizendo
                // "Qualquer etapa".
                (nomeDaEtapa.get(s.stageId) ?? 'Etapa de outro funil')}
          </span>
          {s.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {s.tags.map((t) => (
                <li key={t} className="rounded bg-muted px-2 py-0.5 text-xs">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
