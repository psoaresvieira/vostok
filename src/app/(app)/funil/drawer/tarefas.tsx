'use client'

import { useState } from 'react'
import type { Tarefa, TipoTarefa } from '@/lib/data/tarefas'
import { classificar, FUSO_PADRAO, instanteDeDatetimeLocal } from '@/lib/domain/tarefa'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErroTarefa } from '@/app/(app)/tarefas/erros'
import {
  criarTarefa,
  concluirTarefa,
  reabrirTarefa,
  excluirTarefa,
} from '@/app/(app)/tarefas/acoes'

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

/** Rotulo de urgencia por cima de `classificar` — so os dois baldes mais
 * urgentes ('atrasada' e 'hoje') ganham texto visivel; os demais ficam mudos
 * para nao poluir a lista com "no prazo" em toda linha. */
function rotuloUrgencia(venceEm: Date, agora: Date): string | null {
  const balde = classificar(venceEm, agora, FUSO_PADRAO)
  if (balde === 'atrasada') return 'Atrasada'
  if (balde === 'hoje') return 'Vence hoje'
  return null
}

function ItemTarefa({
  t,
  agora,
  onConcluir,
  onReabrir,
  onExcluir,
}: {
  t: Tarefa
  agora: Date
  onConcluir: (id: string) => void
  onReabrir: (id: string) => void
  onExcluir: (id: string) => void
}) {
  const urgencia = t.concluidaEm === null ? rotuloUrgencia(t.venceEm, agora) : null

  return (
    <li className="flex items-start justify-between gap-2 border-b py-2 text-sm last:border-0">
      <div>
        <p>
          {t.titulo}
          {urgencia && (
            <span className="ml-2 text-xs font-semibold text-destructive">{urgencia}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {ROTULO_TIPO[t.tipo]} · vence {FORMATO_PRAZO.format(t.venceEm)}
          {t.concluidaEm && ` · concluída ${FORMATO_PRAZO.format(t.concluidaEm)}`}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {t.concluidaEm === null ? (
          <button
            type="button"
            onClick={() => onConcluir(t.id)}
            className="text-xs underline"
          >
            Concluir
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onReabrir(t.id)}
            className="text-xs underline"
          >
            Reabrir
          </button>
        )}
        <button
          type="button"
          onClick={() => onExcluir(t.id)}
          className="text-xs text-destructive underline"
        >
          Excluir
        </button>
      </div>
    </li>
  )
}

export function PainelTarefas({
  leadId,
  tarefas,
  agora,
}: {
  leadId: string
  tarefas: Tarefa[]
  agora: Date
}) {
  const [titulo, setTitulo] = useState('')
  const [tipo, setTipo] = useState<TipoTarefa>('ligacao')
  const [prazo, setPrazo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const abertas = tarefas.filter((t) => t.concluidaEm === null)
  const concluidas = tarefas.filter((t) => t.concluidaEm !== null)

  async function criar() {
    // O <input type="datetime-local"> devolve string naive ('2026-08-10T14:30')
    // e a conversao tem que acontecer no fuso do produto, nunca no da maquina
    // de quem digita — ver instanteDeDatetimeLocal. A funcao devolve null em
    // vez de lancar: `new Date(x).toISOString()` estouraria RangeError aqui, na
    // CONSTRUCAO do argumento, fora do try do chamarAcao (que so protege a
    // promessa ja criada); setErro e setEnviando(false) nunca rodariam e o
    // botao ficaria disabled para sempre. Barrar antes de ligar `enviando`
    // garante que nenhum caminho de erro deixa o botao preso.
    const venceEmISO = instanteDeDatetimeLocal(prazo, FUSO_PADRAO)
    if (venceEmISO === null) {
      setErro(mensagemDeErroTarefa('prazo_invalido'))
      return
    }

    setEnviando(true)
    const r = await chamarAcao(criarTarefa({ leadId, titulo, tipo, venceEmISO }))
    setEnviando(false)
    if (!r.ok) {
      setErro(mensagemDeErroTarefa(r.erro))
      return
    }
    setErro(null)
    setTitulo('')
    setPrazo('')
  }

  async function concluir(id: string) {
    const r = await chamarAcao(concluirTarefa(id, leadId))
    if (!r.ok) setErro(mensagemDeErroTarefa(r.erro))
    else setErro(null)
  }

  async function reabrir(id: string) {
    const r = await chamarAcao(reabrirTarefa(id, leadId))
    if (!r.ok) setErro(mensagemDeErroTarefa(r.erro))
    else setErro(null)
  }

  async function excluir(id: string) {
    const r = await chamarAcao(excluirTarefa(id, leadId))
    if (!r.ok) setErro(mensagemDeErroTarefa(r.erro))
    else setErro(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Tarefas</h2>

      <div className="flex flex-col gap-2 rounded border p-2">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="título da tarefa"
          className="h-10 w-full rounded-xl border border-border bg-muted/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary focus:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
        />
        <div className="flex gap-2">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoTarefa)}
            className="h-10 w-full rounded-xl border border-border bg-muted/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary focus:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
          >
            {Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-muted/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary focus:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={criar}
          disabled={enviando}
          className="self-start pressable inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground shadow-sm hover:brightness-110"
        >
          Criar tarefa
        </button>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </div>

      {tarefas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma tarefa para este lead.</p>
      ) : (
        <>
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground">Abertas</h3>
            {abertas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma tarefa aberta.</p>
            ) : (
              <ul>
                {abertas.map((t) => (
                  <ItemTarefa
                    key={t.id}
                    t={t}
                    agora={agora}
                    onConcluir={concluir}
                    onReabrir={reabrir}
                    onExcluir={excluir}
                  />
                ))}
              </ul>
            )}
          </section>

          {concluidas.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">Concluídas</h3>
              <ul>
                {concluidas.map((t) => (
                  <ItemTarefa
                    key={t.id}
                    t={t}
                    agora={agora}
                    onConcluir={concluir}
                    onReabrir={reabrir}
                    onExcluir={excluir}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
