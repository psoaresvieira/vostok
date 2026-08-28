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
  const [expandida, setExpandida] = useState<string | null>(lead.pipelineId)
  const [escolha, setEscolha] = useState<Escolha | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const caixaRef = useRef<HTMLDivElement>(null)
  // Guarda de reentrancia SINCRONA: dois cliques em "Confirmar" disparados no
  // mesmo tick (sem um await entre eles) chegam aqui com o MESMO `confirmar`
  // fechado sobre o `enviando` da ultima renderizacao — o `setEnviando(true)`
  // do primeiro clique so' fica visivel numa renderizacao futura, entao ler
  // o estado nao barra o segundo clique. Uma ref muda na hora, fora do ciclo
  // de render, e por isso e' o segundo clique — nao o `disabled` do botao —
  // quem a le e desiste.
  const enviandoRef = useRef(false)

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

  // Escape fecha SO' a camada de cima (o modal, se ele estiver aberto; senao
  // o popover) — nunca o Drawer. O listener e' nativo e em CAPTURA no
  // document de proposito: o Drawer que envolve este componente tambem
  // escuta Escape no document (fase de bolha) e fecharia o painel inteiro
  // junto, perdendo o motivo/etiquetas que o usuario digitou no
  // `ModalMovimento` — `stopPropagation` na captura da raiz encerra o
  // despacho antes que a fase de bolha chegue la'. O clique fora so' cuida
  // do popover: o modal e' um overlay full-screen, clicar fora dele nao
  // significa nada.
  useEffect(() => {
    if (!aberto && !escolha) return

    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      // O modal, se estiver aberto, ganha do popover: e' a camada de cima.
      if (escolha) {
        setEscolha(null)
        return
      }
      setAberto(false)
    }
    document.addEventListener('keydown', aoTeclar, true)
    return () => document.removeEventListener('keydown', aoTeclar, true)
  }, [aberto, escolha])

  useEffect(() => {
    if (!aberto) return

    function aoApontar(e: MouseEvent) {
      if (e.target instanceof Node && caixaRef.current?.contains(e.target)) return
      setAberto(false)
    }

    document.addEventListener('mousedown', aoApontar)
    return () => document.removeEventListener('mousedown', aoApontar)
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
    // Reentrancia: um segundo clique em "Confirmar" enquanto o primeiro ainda
    // esta no ar nao pode disparar a action de novo — o servidor pode mover o
    // lead duas vezes (ou a segunda chamada recusar por o lead ja nao estar
    // mais onde a primeira o deixou). `enviandoRef`, nao `enviando`: ver o
    // comentario dela.
    if (!escolha || enviandoRef.current) return
    enviandoRef.current = true
    const { pedido, pipelineDestinoId } = escolha
    setEnviando(true)
    setErro(null)

    // chamarAcao cobre a falha de TRANSPORTE (mesmo motivo do Quadro): sem ela
    // a rejeicao do fetch por baixo da Server Action escapa para o error
    // reporting do React e a tela fica muda.
    const r = await chamarAcao(
      pipelineDestinoId === lead.pipelineId
        ? moverEtapaAction(lead.id, pedido.destino.id, lossReasonId, etiquetas)
        : moverParaPipelineAction(lead.id, pedido.destino.id, lossReasonId, etiquetas),
    )
    enviandoRef.current = false
    setEnviando(false)
    if (!r.ok) {
      // O modal continua montado, com o motivo/etiquetas que o usuario ja
      // preencheu: `setEscolha(null)` aqui apagaria os dois no primeiro erro,
      // obrigando a preencher tudo de novo so' porque o servidor recusou.
      setErro(mensagemDeErro(r.erro))
      return
    }
    setEscolha(null)
    aoMover({ pipelineId: pipelineDestinoId, stageId: pedido.destino.id })
  }

  return (
    <div ref={caixaRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        // Desabilitado durante o envio: e' o mesmo movimento que o Confirmar
        // do modal esta processando, e reabrir o popover no meio do caminho
        // deixaria escolher OUTRO destino enquanto o primeiro ainda esta a
        // caminho do servidor.
        disabled={enviando}
        onClick={() => {
          // A mensagem do movimento anterior morre aqui: ela e o popover
          // ocupam o MESMO lugar (ancorados sob o gatilho), e mexer no seletor
          // de novo ja e' dizer que a recusa antiga foi lida.
          setErro(null)
          setAberto((v) => !v)
        }}
        className="pressable rounded-full bg-primary-foreground/15 px-2 py-0.5 font-medium text-primary-foreground hover:bg-primary-foreground/25 disabled:opacity-60"
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
          {grupos.map(({ pipeline, itens }) => {
            const expandido = expandida === pipeline.id
            return (
              // O cabecalho da pipeline mora FORA do `role="group"`: um
              // listbox so' pode ter groups e options como filhos diretos, e
              // um botao de expandir/recolher no meio quebraria essa
              // ownership. Este `div` sem role e' so' o agrupamento visual
              // dos dois — leitor de tela nenhum enxerga ele.
              <div key={pipeline.id}>
                <button
                  type="button"
                  aria-expanded={expandido}
                  onClick={() => setExpandida(expandido ? null : pipeline.id)}
                  className="w-full truncate rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {pipeline.nome}
                </button>
                {/* Um `group` por pipeline SEMPRE existe (vazio quando
                    recolhida) — e' o que da' "um grupo por pipeline" pra
                    quem le a arvore de acessibilidade mesmo antes de
                    expandir. Filhos diretos: so' `role="option"`, sem
                    `ul`/`li` no meio — a arvore de acessibilidade de um
                    `group` so' reconhece um `option` como filho quando ele
                    e' filho DIRETO no DOM. */}
                <div role="group" aria-label={pipeline.nome} className="flex flex-col gap-0.5 pb-1">
                  {expandido &&
                    itens.map(({ etapa, indiceAberta }) => {
                      const cor = corDaEtapa(indiceAberta, etapa.tipo)
                      const atual = etapa.id === lead.stageId
                      return (
                        <button
                          key={etapa.id}
                          type="button"
                          role="option"
                          aria-selected={atual}
                          onClick={() => escolher(pipeline.id, etapa)}
                          className={`pressable flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${cor.fundo} ${cor.texto}`}
                        >
                          <span className="truncate">{etapa.nome}</span>
                          {atual && <Check size={14} strokeWidth={2.5} aria-hidden="true" />}
                        </button>
                      )
                    })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* `erro` so' fica truthy enquanto `escolha` tambem esta (confirmar()
          exige `escolha` para roda-lo, e o cancelar limpa os dois juntos) —
          a mensagem sempre mora DENTRO do `ModalMovimento` abaixo, nunca
          solta aqui fora dele. */}

      {escolha && (
        <ModalMovimento
          pedido={escolha.pedido}
          motivos={motivos}
          etiquetasConhecidas={etiquetasConhecidas}
          enviando={enviando}
          erro={erro}
          onCancelar={() => {
            setEscolha(null)
            setErro(null)
          }}
          onConfirmar={confirmar}
        />
      )}
    </div>
  )
}
