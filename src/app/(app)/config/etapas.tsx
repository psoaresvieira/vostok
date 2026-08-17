'use client'

import { useEffect, useRef, useState } from 'react'
import { type Resultado } from '@/lib/domain/resultado'
import type { Etapa, StageTipo } from '@/lib/domain/tipos'
import type { ResumoEtapa } from '@/lib/data/etapas'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErro } from './erros'

/**
 * Task 2 do Plano 15: as quatro actions de etapa sairam de config/acoes.ts —
 * o AdminStore perdeu os metodos de etapa (foram para SupabaseEtapaStore,
 * por pipeline). Este componente ficou orfao de pagina (config/page.tsx nao
 * o renderiza mais) e migra para funil/etapas.tsx na Task 4, la' recebendo
 * as actions de verdade de funil/acoes-etapas.ts (Task 3), com pipelineId.
 * Os quatro stubs abaixo so existem para o arquivo e o teste dele
 * continuarem compilando ate la' — nenhum teste os exercita, e nenhuma
 * pagina real alcanca este componente hoje.
 */
async function criarEtapaIndisponivel(): Promise<Resultado<void>> {
  throw new Error('etapas.tsx orfao ate a Task 4 do Plano 15 religar as actions do funil')
}
async function renomearEtapaIndisponivel(_etapaId: string, _nome: string): Promise<Resultado<void>> {
  throw new Error('etapas.tsx orfao ate a Task 4 do Plano 15 religar as actions do funil')
}
async function excluirEtapaIndisponivel(_etapaId: string): Promise<Resultado<void>> {
  throw new Error('etapas.tsx orfao ate a Task 4 do Plano 15 religar as actions do funil')
}
async function reordenarEtapasIndisponivel(): Promise<Resultado<void>> {
  throw new Error('etapas.tsx orfao ate a Task 4 do Plano 15 religar as actions do funil')
}

/** Quanto tempo o "Salvo ✓" fica visivel antes de sumir sozinho. */
const DURACAO_SALVO_MS = 2_500

function mensagemLeadsPassaram(n: number): string {
  return n === 1 ? '1 lead já passou por ela.' : `${n} leads já passaram por ela.`
}

function mensagemMoverLeads(n: number): string {
  return n === 1
    ? 'Mova o 1 lead desta etapa antes de excluí-la.'
    : `Mova os ${n} leads desta etapa antes de excluí-la.`
}

export function Etapas({
  etapas,
  resumo,
  renomear = renomearEtapaIndisponivel,
  excluir = excluirEtapaIndisponivel,
}: {
  etapas: Etapa[]
  resumo: ResumoEtapa[]
  renomear?: (etapaId: string, nome: string) => Promise<Resultado<void>>
  excluir?: (etapaId: string) => Promise<Resultado<void>>
}) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<StageTipo>('aberta')
  const [erro, setErro] = useState<string | null>(null)
  const [salvoId, setSalvoId] = useState<string | null>(null)
  const [etapaParaExcluir, setEtapaParaExcluir] = useState<Etapa | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  const resumoPorEtapa = new Map(resumo.map((r) => [r.etapaId, r]))

  // O "Salvo" e' um sinal TRANSITORIO: sem o temporizador ele ficava colado
  // na tela para sempre, e uma recusa de exclusao em OUTRA linha (setErro)
  // aparecia ao lado de um "Salvo" de minutos atras, como se os dois
  // fizessem parte do mesmo evento. O ref guarda o id do setTimeout para
  // poder cancelar/reiniciar num re-save antes do prazo, e o cleanup do
  // useEffect evita setState depois de desmontar.
  const timeoutSalvo = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutSalvo.current) clearTimeout(timeoutSalvo.current)
    }
  }, [])

  function marcarSalvo(id: string) {
    if (timeoutSalvo.current) clearTimeout(timeoutSalvo.current)
    setSalvoId(id)
    timeoutSalvo.current = setTimeout(() => {
      setSalvoId(null)
      timeoutSalvo.current = null
    }, DURACAO_SALVO_MS)
  }

  /** Todo erro passa por aqui, nunca por `setErro` direto: um "Salvo" de uma
   * linha nao pode sobreviver a um erro que acabou de aparecer em outra —
   * os dois juntos na tela leem como se fossem o mesmo evento. */
  function reportarErro(mensagem: string) {
    if (timeoutSalvo.current) {
      clearTimeout(timeoutSalvo.current)
      timeoutSalvo.current = null
    }
    setSalvoId(null)
    setErro(mensagem)
  }

  async function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao
    if (destino < 0 || destino >= etapas.length) return
    const ids = etapas.map((e) => e.id)
    ;[ids[indice], ids[destino]] = [ids[destino], ids[indice]]
    const r = await chamarAcao(reordenarEtapasIndisponivel())
    if (!r.ok) reportarErro(mensagemDeErro(r.erro))
  }

  async function renomearCampo(e: Etapa, valor: string) {
    if (valor === e.nome) return
    const r = await chamarAcao(renomear(e.id, valor))
    if (!r.ok) {
      reportarErro(mensagemDeErro(r.erro))
    } else {
      setErro(null)
      marcarSalvo(e.id)
    }
  }

  async function confirmarExclusao() {
    const alvo = etapaParaExcluir
    if (!alvo || excluindo) return
    setExcluindo(true)
    const r = await chamarAcao(excluir(alvo.id))
    setExcluindo(false)
    setEtapaParaExcluir(null)
    if (!r.ok) {
      // O codigo do erro manda; o numero do resumo so ilustra quando ele
      // bate com o que a etapa tem agora. Sem resumo (busca falhou ou nao
      // ha linha para esta etapa) ou com leadsNaEtapa zerado (resumo
      // defasado — um lead entrou na etapa depois do dialogo abrir, a RPC
      // ja enxerga e recusa, mas o resumo carregado antes ainda mostra 0),
      // cai no texto generico de config/erros.ts: compor "Mova os 0 leads..."
      // seria uma frase que contradiz a propria recusa.
      if (r.erro === 'etapa_tem_leads') {
        const res = resumoPorEtapa.get(alvo.id)
        reportarErro(
          res && res.leadsNaEtapa > 0
            ? mensagemMoverLeads(res.leadsNaEtapa)
            : mensagemDeErro('etapa_tem_leads'),
        )
      } else if (r.erro === 'ultima_etapa_do_tipo') {
        reportarErro(`Esta é a última etapa do tipo ${alvo.tipo}.`)
      } else {
        reportarErro(mensagemDeErro(r.erro))
      }
    } else {
      setErro(null)
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-semibold">Etapas do funil</h2>
      <ul className="flex flex-col gap-1">
        {etapas.map((e, i) => (
          <li key={e.id} className="flex items-center gap-2 rounded border p-2 text-sm">
            <input
              defaultValue={e.nome}
              onBlur={(ev) => {
                void renomearCampo(e, ev.target.value)
              }}
              className="flex-1 rounded border px-2 py-1"
            />
            {salvoId === e.id && (
              <span className="text-xs text-success">Salvo ✓</span>
            )}
            <span className="text-xs text-muted-foreground">{e.tipo}</span>
            <button type="button" onClick={() => mover(i, -1)} aria-label="subir">
              ↑
            </button>
            <button type="button" onClick={() => mover(i, 1)} aria-label="descer">
              ↓
            </button>
            <button
              type="button"
              onClick={() => setEtapaParaExcluir(e)}
              aria-label={`Excluir etapa ${e.nome}`}
              className="text-xs text-destructive underline"
            >
              Excluir
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="nova etapa"
          className="rounded border px-2 py-1 text-sm"
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as StageTipo)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="aberta">aberta</option>
          <option value="ganho">ganho</option>
          <option value="perdido">perdido</option>
        </select>
        <button
          type="button"
          onClick={async () => {
            const r = await chamarAcao(criarEtapaIndisponivel())
            if (!r.ok) reportarErro(mensagemDeErro(r.erro))
            else {
              setErro(null)
              setNome('')
            }
          }}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
        >
          Adicionar
        </button>
      </div>
      {erro && <p className="mt-1 text-sm text-destructive">{erro}</p>}

      {etapaParaExcluir && (
        <div
          role="dialog"
          aria-label={`Excluir etapa ${etapaParaExcluir.nome}`}
          className="mt-3 flex flex-col gap-2 rounded border p-3 text-sm"
        >
          <p>
            Excluir a etapa &quot;{etapaParaExcluir.nome}&quot;?
            {resumoPorEtapa.has(etapaParaExcluir.id) &&
              ` ${mensagemLeadsPassaram(resumoPorEtapa.get(etapaParaExcluir.id)!.leadsPassaram)}`}
          </p>
          <p>O histórico e as métricas desta etapa serão preservados.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void confirmarExclusao()}
              disabled={excluindo}
              aria-label={`Confirmar exclusão de ${etapaParaExcluir.nome}`}
              className="rounded bg-destructive px-3 py-1 text-primary-foreground disabled:opacity-50"
            >
              Confirmar exclusão
            </button>
            <button
              type="button"
              onClick={() => setEtapaParaExcluir(null)}
              aria-label="Cancelar exclusão"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
