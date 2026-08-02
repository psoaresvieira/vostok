import type { Funil as DadosFunil } from '@/lib/domain/metricas'

export function Funil({ funil }: { funil: DadosFunil }) {
  const maior = funil.degraus[0]?.alcancaram ?? 0
  return (
    <section className="surface rounded-lg p-6">
      <p className="eyebrow">Funil da coorte</p>
      <p className="mb-4 text-sm text-muted-foreground">
        <span className="tabular">{funil.totalDaCoorte}</span>{' '}
        {funil.totalDaCoorte === 1 ? 'lead criado' : 'leads criados'} no período.
        Lead recente ainda está descendo o funil — o período corrente sempre parece
        pior que um já fechado.
      </p>
      <ul className="flex flex-col gap-2">
        {funil.degraus.map((d, i) => (
          <li key={d.etapaId} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-sm">{d.nome}</span>
            <div className="h-6 flex-1 rounded bg-muted">
              <div
                className="h-6 rounded"
                style={{
                  width: `${maior === 0 ? 0 : (d.alcancaram / maior) * 100}%`,
                  background: 'var(--chart-1)',
                }}
              />
            </div>
            <span className="tabular w-12 text-right text-sm">{d.alcancaram}</span>
            <span className="tabular w-16 text-right text-sm text-muted-foreground">
              {/* funilDaCoorte fixa o primeiro degrau em 100% de si mesmo (e
                  correto quando ha lead) — mas com contagem zero isso lia
                  "0 | 100%" pra quem acabou de conectar a conta. Sem
                  degrau anterior pra comparar, zero nao tem percentual. */}
              {i === 0 && d.alcancaram === 0 ? '—' : `${Math.round(d.percentualDoAnterior)}%`}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          { rotulo: 'Ganhos', valor: funil.ganhos },
          { rotulo: 'Perdidos', valor: funil.perdidos },
          { rotulo: 'Ainda abertos', valor: funil.abertos },
        ].map((c) => (
          <div key={c.rotulo} className="surface rounded-lg p-4">
            <p className="eyebrow">{c.rotulo}</p>
            <p className="tabular text-2xl">{c.valor}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
