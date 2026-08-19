'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Plus, Settings2, Trash2, X } from 'lucide-react'
import { Botao } from '@/components/ui/botao'
import { Selo } from '@/components/ui/selo'
import { type Resultado } from '@/lib/domain/resultado'
import type { Etapa, StageTipo } from '@/lib/domain/tipos'
import type { ResumoEtapa } from '@/lib/data/etapas'
import { chamarAcao } from '@/lib/ui/acao'
import {
  criarEtapaAction,
  renomearEtapaAction,
  excluirEtapaAction,
  reordenarEtapasAction,
} from './acoes-etapas'
import { mensagemDeEtapa } from './erros'

/**
 * Task 4 do Plano 15: este componente e' o antigo `Etapas` de
 * config/etapas.tsx, movido para o funil — config parou de mostrar etapas
 * (o EtapaStore de Task 2 e' por pipeline, e a costura das quatro actions de
 * Task 3 exige `pipelineId` na frente de toda chamada). A adaptacao e'
 * so essa costura:
 * - as quatro actions vem de './acoes-etapas' (Task 3), nao mais de
 *   stubs `*Indisponivel`;
 * - `mensagemDeEtapa` (funil/erros.ts) no lugar de `mensagemDeErro`
 *   (config/erros.ts) para traduzir codigo de erro em frase;
 * - o componente inteiro agora mora atras de um disclosure fechado por
 *   padrao — `<EditarEtapas />` nasce orfao de pagina e a Task 5 monta o
 *   botao "Editar etapas" direto no funil, sem layout novo para acomodar.
 *
 * `renomear`/`excluir` continuam props injetaveis (testabilidade sem
 * servidor, mesmo desenho de origem); `criarEtapaAction`/
 * `reordenarEtapasAction` continuam importadas direto, como no componente de
 * origem — so os testes as mockam via `vi.mock('./acoes-etapas')`.
 */

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

export function EditarEtapas({
  pipelineId,
  etapas,
  resumo,
  renomear = renomearEtapaAction,
  excluir = excluirEtapaAction,
}: {
  pipelineId: string
  etapas: Etapa[]
  resumo: ResumoEtapa[]
  renomear?: (pipelineId: string, etapaId: string, nome: string) => Promise<Resultado<void>>
  excluir?: (pipelineId: string, etapaId: string) => Promise<Resultado<void>>
}) {
  const [aberto, setAberto] = useState(false)
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
    const r = await chamarAcao(reordenarEtapasAction(pipelineId, ids))
    if (!r.ok) reportarErro(mensagemDeEtapa(r.erro))
  }

  async function renomearCampo(e: Etapa, valor: string) {
    if (valor === e.nome) return
    const r = await chamarAcao(renomear(pipelineId, e.id, valor))
    if (!r.ok) {
      reportarErro(mensagemDeEtapa(r.erro))
    } else {
      setErro(null)
      marcarSalvo(e.id)
    }
  }

  async function confirmarExclusao() {
    const alvo = etapaParaExcluir
    if (!alvo || excluindo) return
    setExcluindo(true)
    const r = await chamarAcao(excluir(pipelineId, alvo.id))
    setExcluindo(false)
    setEtapaParaExcluir(null)
    if (!r.ok) {
      // O codigo do erro manda; o numero do resumo so ilustra quando ele
      // bate com o que a etapa tem agora. Sem resumo (busca falhou ou nao
      // ha linha para esta etapa) ou com leadsNaEtapa zerado (resumo
      // defasado — um lead entrou na etapa depois do dialogo abrir, a RPC
      // ja enxerga e recusa, mas o resumo carregado antes ainda mostra 0),
      // cai no texto generico de funil/erros.ts: compor "Mova os 0 leads..."
      // seria uma frase que contradiz a propria recusa.
      if (r.erro === 'etapa_tem_leads') {
        const res = resumoPorEtapa.get(alvo.id)
        reportarErro(
          res && res.leadsNaEtapa > 0
            ? mensagemMoverLeads(res.leadsNaEtapa)
            : mensagemDeEtapa('etapa_tem_leads'),
        )
      } else if (r.erro === 'ultima_etapa_do_tipo') {
        reportarErro(`Esta é a última etapa do tipo ${alvo.tipo}.`)
      } else {
        reportarErro(mensagemDeEtapa(r.erro))
      }
    } else {
      setErro(null)
    }
  }

  return (
    <section>
      <Botao
        type="button"
        variante="contorno"
        aria-expanded={aberto}
        onClick={() => setAberto((atual) => !atual)}
        className="w-full"
      >
        <Settings2 size={16} strokeWidth={1.75} aria-hidden="true" />
        Editar etapas
      </Botao>

      {aberto && (
        // Overlay, e nao mais um disclosure inline: este componente vive na
        // coluna de 224px do funil, e a linha de cada etapa (campo de nome +
        // tipo + duas setas + excluir) nunca coube ali — os controles
        // atropelavam uns aos outros e o campo de nome ficava com uns 40px.
        //
        // Sem role="dialog" de proposito, seguindo nova-pipeline.tsx: o
        // dialogo de confirmacao de exclusao AQUI DENTRO e' que carrega esse
        // papel, e etapas.test.tsx faz `getByRole('dialog')` no singular e
        // exige zero dialogos depois de cancelar. Um role a mais aqui daria
        // "multiple elements" em quatro testes. Quem anuncia o estado deste
        // painel e' o aria-expanded do botao acima.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="surface fade-in flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl">
            <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold">Etapas do funil</h2>
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar"
                className="pressable rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            {/* Rola so a lista: o cabecalho e o rodape de adicionar ficam
                fixos, senao numa pipeline de 8 etapas o campo "nova etapa"
                nasce fora da area visivel. */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <ul className="flex flex-col gap-2">
                {etapas.map((e, i) => (
                  <li
                    key={e.id}
                    className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-2"
                  >
                    <input
                      defaultValue={e.nome}
                      onBlur={(ev) => {
                        void renomearCampo(e, ev.target.value)
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                    />
                    {salvoId === e.id && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success">
                        <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                        Salvo
                      </span>
                    )}
                    <Selo tom={e.tipo === 'ganho' ? 'sucesso' : e.tipo === 'perdido' ? 'perigo' : 'neutro'}>
                      {e.tipo}
                    </Selo>
                    <button
                      type="button"
                      onClick={() => mover(i, -1)}
                      aria-label="subir"
                      className="pressable shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      aria-label="descer"
                      className="pressable shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEtapaParaExcluir(e)}
                      aria-label={`Excluir etapa ${e.nome}`}
                      className="pressable shrink-0 rounded-lg p-1.5 text-destructive hover:bg-destructive/12"
                    >
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>

              {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}

              {etapaParaExcluir && (
                <div
                  role="dialog"
                  aria-label={`Excluir etapa ${etapaParaExcluir.nome}`}
                  className="mt-3 flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm"
                >
                  <p>
                    Excluir a etapa &quot;{etapaParaExcluir.nome}&quot;?
                    {resumoPorEtapa.has(etapaParaExcluir.id) &&
                      ` ${mensagemLeadsPassaram(resumoPorEtapa.get(etapaParaExcluir.id)!.leadsPassaram)}`}
                  </p>
                  <p className="text-muted-foreground">
                    O histórico e as métricas desta etapa serão preservados.
                  </p>
                  <div className="mt-1 flex gap-2">
                    <Botao
                      type="button"
                      variante="destrutivo"
                      tamanho="sm"
                      onClick={() => void confirmarExclusao()}
                      disabled={excluindo}
                      aria-label={`Confirmar exclusão de ${etapaParaExcluir.nome}`}
                    >
                      Confirmar exclusão
                    </Botao>
                    <Botao
                      type="button"
                      variante="fantasma"
                      tamanho="sm"
                      onClick={() => setEtapaParaExcluir(null)}
                      aria-label="Cancelar exclusão"
                    >
                      Cancelar
                    </Botao>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="nova etapa"
                className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-muted/60 px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as StageTipo)}
                className="h-10 shrink-0 rounded-xl border border-border bg-muted/60 px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="aberta">aberta</option>
                <option value="ganho">ganho</option>
                <option value="perdido">perdido</option>
              </select>
              <Botao
                type="button"
                onClick={async () => {
                  const r = await chamarAcao(criarEtapaAction(pipelineId, nome, tipo))
                  if (!r.ok) reportarErro(mensagemDeEtapa(r.erro))
                  else {
                    setErro(null)
                    setNome('')
                  }
                }}
              >
                <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
                Adicionar
              </Botao>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
