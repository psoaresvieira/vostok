'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Tarefa, TipoTarefa } from '@/lib/data/tarefas'
import { classificar, FUSO_PADRAO, type Balde } from '@/lib/domain/tarefa'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErroTarefa } from './erros'
import { concluirTarefa } from '@/app/(app)/tarefas/acoes'

const ROTULO_TIPO: Record<TipoTarefa, string> = {
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  outro: 'Outro',
}

const FORMATO_PRAZO = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: FUSO_PADRAO,
})

// Ordem fixa de exibicao — a mesma exigida pelo brief (Atrasadas -> Hoje ->
// Proximos 7 dias -> Depois) e nao a ordem alfabetica nem a de insercao do
// Balde no dominio.
const ORDEM_BALDES: Balde[] = ['atrasada', 'hoje', 'proximos7', 'depois']

const ROTULO_BALDE: Record<Balde, string> = {
  atrasada: 'Atrasadas',
  hoje: 'Hoje',
  proximos7: 'Próximos 7 dias',
  depois: 'Depois',
}

function ItemTarefa({
  t,
  onConcluir,
}: {
  t: Tarefa
  onConcluir: (id: string, leadId: string) => void
}) {
  return (
    <li className="flex items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
      <Link href={`/leads/${t.leadId}`} className="underline">
        {t.leadNome} · {t.titulo}
      </Link>
      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <span>{ROTULO_TIPO[t.tipo]}</span>
        <span>vence {FORMATO_PRAZO.format(t.venceEm)}</span>
        <button
          type="button"
          onClick={() => onConcluir(t.id, t.leadId)}
          className="text-xs underline"
        >
          Concluir
        </button>
      </div>
    </li>
  )
}

/**
 * Recebe `tarefas` e `agora` por prop — nunca chama `new Date()` aqui dentro,
 * senao o teste vira refem do relogio (ver brief da Task 6).
 */
export function Lista({ tarefas, agora }: { tarefas: Tarefa[]; agora: Date }) {
  const [erro, setErro] = useState<string | null>(null)

  async function concluir(id: string, leadId: string) {
    const r = await chamarAcao(concluirTarefa(id, leadId))
    if (!r.ok) setErro(mensagemDeErroTarefa(r.erro))
    else setErro(null)
  }

  const porBalde = new Map<Balde, Tarefa[]>()
  for (const t of tarefas) {
    const balde = classificar(t.venceEm, agora, FUSO_PADRAO)
    const grupo = porBalde.get(balde)
    if (grupo) grupo.push(t)
    else porBalde.set(balde, [t])
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Fora do ramo de lista vazia, de proposito: concluir a ultima tarefa
          aberta pelo caminho TAREFA_CONCLUIDA_SEM_EVENTO seta `erro` e
          revalida /tarefas, que chega aqui de novo com `tarefas` vazio. Se
          este aviso estivesse dentro do `if (tarefas.length === 0)` abaixo,
          a mensagem nunca apareceria exatamente no caso em que ela mais
          importa (achado do review da Task 6). */}
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {tarefas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma tarefa aberta.</p>
      ) : (
        ORDEM_BALDES.map((balde) => {
          const doBalde = porBalde.get(balde)
          if (!doBalde || doBalde.length === 0) return null
          return (
            <section key={balde}>
              <h2 className="mb-1 text-sm font-semibold">{ROTULO_BALDE[balde]}</h2>
              <ul>
                {doBalde.map((t) => (
                  <ItemTarefa key={t.id} t={t} onConcluir={concluir} />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}
