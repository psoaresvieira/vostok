'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { Etapa, Etiqueta, Lead, MotivoPerda, Pipeline } from '@/lib/domain/tipos'
import { corDaEtapa } from '@/lib/domain/etapa-cor'
import { horasNaEtapa, rotuloTempoNaEtapa } from '@/lib/domain/lead'
import { chamarAcao } from '@/lib/ui/acao'
import { moverEtapaAction, moverParaPipelineAction } from '../acoes'
import { mensagemDeErro } from '../erros'
import { ModalMovimento, type PedidoMovimento } from '../modal-movimento'

/** O pedido de movimento mais a pipeline de DESTINO, num estado so'. Separados
 *  em dois `useState` eles poderiam divergir entre um render e outro — e e'
 *  exatamente essa dupla que decide qual das duas actions vai ser chamada. */
type Escolha = { pedido: PedidoMovimento; pipelineDestinoId: string }

/**
 * As etapas de uma pipeline na ordem em que o seletor as oferece: abertas por
 * `ordem`, depois os desfechos (ganho e perdido). A cor de cada uma vem do
 * INDICE entre as abertas — `corDaEtapa` conta a partir de 0 e `etapa.ordem`
 * comeca em 1 e ainda conta as fechadas.
 */
function ordenarParaOSeletor(etapas: Etapa[]): { etapa: Etapa; indiceAberta: number }[] {
  const porOrdem = [...etapas].sort((a, b) => a.ordem - b.ordem)
  const abertas = porOrdem.filter((e) => e.tipo === 'aberta')
  const fechadas = porOrdem.filter((e) => e.tipo !== 'aberta')
  return [
    ...abertas.map((etapa, indiceAberta) => ({ etapa, indiceAberta })),
    // `0` e' ignorado por `corDaEtapa` quando o tipo e' ganho/perdido.
    ...fechadas.map((etapa) => ({ etapa, indiceAberta: 0 })),
  ]
}

/**
 * O gatilho de etapa do cabecalho do drawer: mostra em que etapa o lead esta e
 * ha quanto tempo, e abre o seletor de etapa/pipeline.
 *
 * Uma lista so' para os dois movimentos porque, para quem usa, e' um so': "levar
 * este lead para outro lugar do funil". Quem decide se isso e' `moverEtapaAction`
 * ou `moverParaPipelineAction` e' a pipeline da etapa escolhida — o banco recusa
 * a troca (`move_lead_stage` nao atravessa pipelines, `mover_lead_pipeline`
 * exige que atravesse), entao errar aqui vira erro na cara do usuario.
 *
 * `aoMover` sobe para o drawer em vez de este componente navegar: quem sabe a
 * URL do funil (filtros, `?lead=`, `?pipeline=`) e' o drawer, nao o seletor.
 */
export function SeletorEtapa({
  lead,
  pipelines,
  motivos,
  etiquetasConhecidas,
  aoMover,
}: {
  lead: Lead
  pipelines: { pipeline: Pipeline; etapas: Etapa[] }[]
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
  /** Chamado SO' depois de o servidor confirmar o movimento. */
  aoMover: (destino: { pipelineId: string; stageId: string }) => void
}) {
  const [aberto, setAberto] = useState(false)
  // Uma pipeline expandida por vez: a lista inteira de todas as etapas de todas
  // as pipelines seria uma parede de nomes repetidos ("Novo lead", "Ganho",
  // "Perdido" existem em todas).
  const [expandida, setExpandida] = useState(lead.pipelineId)
  const [escolha, setEscolha] = useState<Escolha | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const caixaRef = useRef<HTMLDivElement>(null)

  const grupos = useMemo(
    () =>
      pipelines.map(({ pipeline, etapas }) => ({
        pipeline,
        itens: ordenarParaOSeletor(etapas),
      })),
    [pipelines],
  )

  const etapaAtual =
    pipelines
      .find((p) => p.pipeline.id === lead.pipelineId)
      ?.etapas.find((e) => e.id === lead.stageId) ?? null
  const horas = horasNaEtapa(lead.entrouNaEtapaEm, new Date())

  // Escape e clique fora fecham SO' o popover. Os dois listeners sao nativos e
  // em captura no document de proposito: o Drawer que envolve este componente
  // tambem escuta Escape no document e fecharia o painel inteiro junto —
  // `stopPropagation` na captura da raiz encerra o despacho antes disso.
  useEffect(() => {
    if (!aberto) return

    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setAberto(false)
    }
    function aoApontar(e: MouseEvent) {
      if (e.target instanceof Node && caixaRef.current?.contains(e.target)) return
      setAberto(false)
    }

    document.addEventListener('keydown', aoTeclar, true)
    document.addEventListener('mousedown', aoApontar)
    return () => {
      document.removeEventListener('keydown', aoTeclar, true)
      document.removeEventListener('mousedown', aoApontar)
    }
  }, [aberto])

  function escolher(pipelineDestinoId: string, destino: Etapa) {
    setAberto(false)
    setErro(null)
    // Escolher onde o lead ja esta e' desistir do movimento, nao move-lo para
    // ele mesmo: nenhuma action, nenhum modal.
    if (destino.id === lead.stageId) return
    setEscolha({
      pedido: { leadId: lead.id, nomeLead: lead.nome, destino },
      pipelineDestinoId,
    })
  }

  async function confirmar(lossReasonId: string | null, etiquetas: string[]) {
    if (!escolha) return
    const { pedido, pipelineDestinoId } = escolha
    setEscolha(null)
    setErro(null)

    // chamarAcao cobre a falha de TRANSPORTE (mesmo motivo do Quadro): sem ela
    // a rejeicao do fetch por baixo da Server Action escapa para o error
    // reporting do React e a tela fica muda.
    const r = await chamarAcao(
      pipelineDestinoId === lead.pipelineId
        ? moverEtapaAction(lead.id, pedido.destino.id, lossReasonId, etiquetas)
        : moverParaPipelineAction(lead.id, pedido.destino.id, lossReasonId, etiquetas),
    )
    if (!r.ok) {
      setErro(mensagemDeErro(r.erro))
      return
    }
    aoMover({ pipelineId: pipelineDestinoId, stageId: pedido.destino.id })
  }

  return (
    <div ref={caixaRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        onClick={() => {
          // A mensagem do movimento anterior morre aqui: ela e o popover
          // ocupam o MESMO lugar (ancorados sob o gatilho), e mexer no seletor
          // de novo ja e' dizer que a recusa antiga foi lida.
          setErro(null)
          setAberto((v) => !v)
        }}
        className="pressable rounded-full bg-primary-foreground/15 px-2 py-0.5 font-medium text-primary-foreground hover:bg-primary-foreground/25"
      >
        {etapaAtual?.nome ?? '—'} · {horas < 1 ? 'agora' : `há ${rotuloTempoNaEtapa(horas)}`}
      </button>

      {aberto && (
        <div
          role="listbox"
          aria-label="Etapa do lead"
          // `absolute` ancorado no gatilho, e alinhado a direita porque o
          // gatilho mora na ponta direita do cabecalho — alinhado a esquerda a
          // lista sairia da borda do painel.
          className="surface absolute right-0 top-full z-40 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl bg-popover p-1 text-left text-popover-foreground"
        >
          {grupos.map(({ pipeline, itens }) => (
            <div key={pipeline.id} role="group" aria-label={pipeline.nome}>
              <button
                type="button"
                aria-expanded={expandida === pipeline.id}
                onClick={() => setExpandida(pipeline.id)}
                className="w-full truncate rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {pipeline.nome}
              </button>
              {expandida === pipeline.id && (
                <ul className="flex flex-col gap-0.5 pb-1">
                  {itens.map(({ etapa, indiceAberta }) => {
                    const cor = corDaEtapa(indiceAberta, etapa.tipo)
                    const atual = etapa.id === lead.stageId
                    return (
                      <li key={etapa.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={atual}
                          onClick={() => escolher(pipeline.id, etapa)}
                          className={`pressable flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${cor.fundo} ${cor.texto}`}
                        >
                          <span className="truncate">{etapa.nome}</span>
                          {atual && <Check size={14} strokeWidth={2.5} aria-hidden="true" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {erro && (
        // Ancorado como o popover, e nao no fluxo: o cabecalho e' uma linha so'
        // e uma frase inteira dentro dela empurraria o nome da pipeline para
        // fora da tela.
        <p
          role="alert"
          className="surface absolute right-0 top-full z-40 mt-1 w-64 rounded-xl bg-popover p-2 text-xs text-destructive"
        >
          {erro}
        </p>
      )}

      {escolha && (
        <ModalMovimento
          pedido={escolha.pedido}
          motivos={motivos}
          etiquetasConhecidas={etiquetasConhecidas}
          onCancelar={() => setEscolha(null)}
          onConfirmar={confirmar}
        />
      )}
    </div>
  )
}
