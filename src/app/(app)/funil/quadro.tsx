'use client'

import { memo, startTransition, useCallback, useMemo, useOptimistic, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { ColunaDoFunil, Etapa, Etiqueta, LeadDoFunil, Membro, MotivoPerda } from '@/lib/domain/tipos'
import { formatarMoeda } from '@/lib/domain/formato'
import { chamarAcao } from '@/lib/ui/acao'
import { Cartao } from './cartao'
import { ModalMovimento, type PedidoMovimento } from './modal-movimento'
import { moverEtapaAction } from './acoes'
import { maisLeadsDaEtapaAction } from './acoes-paginacao'
import { mensagemDeErro } from './erros'
import type { FiltrosDaUrl } from './paginacao'

// Move um unico lead: patches concorrentes se acumulam em vez de se sobrescreverem.
type MovimentoOtimista = { leadId: string; stageId: string }

function aplicarMovimento(atual: LeadDoFunil[], patch: MovimentoOtimista): LeadDoFunil[] {
  return atual.map((l) => (l.id === patch.leadId ? { ...l, stageId: patch.stageId } : l))
}

// Destino provisorio do link do cartao ate a Task 4 trocar por ?lead= (drawer).
const hrefDoCartao = (id: string) => `/leads/${id}`

// O cartao de origem fica onde esta, esmaecido, marcando de onde o lead saiu.
// Quem segue o ponteiro e a copia no DragOverlay (ver Quadro).
//
// Deliberadamente NAO aplicamos `transform` neste elemento. Alem de o cartao
// sair recortado pelo `overflow-x` do quadro, mover o proprio no faz o mousedown
// e o mouseup cairem no mesmo <a> do cartao — o browser dispara um `click` de
// verdade e navega para a ficha do lead em vez de abrir o modal de movimento. O
// dnd-kit so chama stopPropagation nesse click (nunca preventDefault), entao a
// navegacao acontece de qualquer jeito. Com o overlay, mousedown e mouseup caem
// em elementos diferentes e nao ha click nenhum.
//
// memo() nao e' cosmetico aqui: `setArrastandoId` re-renderiza o Quadro a cada
// pegada e a cada soltada, e sem isto TODO cartao carregado re-renderizava
// junto. Com props estaveis (o objeto do lead so muda quando o servidor manda
// outro) so' o cartao afetado re-renderiza.
const CartaoArrastavel = memo(function CartaoArrastavel({
  lead,
  nomeResponsavel,
}: {
  lead: LeadDoFunil
  nomeResponsavel: string | null
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-40' : undefined}
      // content-visibility: o navegador PULA layout, estilo e paint dos
      // cartoes fora da area visivel da coluna. Numa coluna cheia isso e' a
      // diferenca entre pintar 50 cartoes (com sombra de 40px de blur cada,
      // ver .surface) e pintar os 6 que aparecem. contain-intrinsic-size da o
      // tamanho presumido do que foi pulado, senao a barra de rolagem da
      // coluna salta enquanto se rola. 72px: altura do cartao compacto novo
      // (era 92px no cartao de tres blocos anterior).
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 72px' }}
    >
      <Cartao lead={lead} nomeResponsavel={nomeResponsavel} href={hrefDoCartao(lead.id)} />
    </div>
  )
})

/**
 * Filete colorido no topo da coluna, por tipo de etapa. Vem do print de
 * referencia (Kommo), onde cada coluna do funil carrega a propria faixa — e'
 * o que deixa "onde fecha" e "onde perde" legivel de relance, sem ler os
 * nomes. As cores sao os tokens que ja existiam, nenhuma nova.
 */
const FILETE: Record<Etapa['tipo'], string> = {
  aberta: 'bg-primary/60',
  ganho: 'bg-success/70',
  perdido: 'bg-destructive/60',
}

function Coluna({
  etapa,
  children,
  total,
  soma,
  faltam,
  carregando,
  onCarregarMais,
}: {
  etapa: Etapa
  children: React.ReactNode
  total: number
  soma: number | null
  faltam: number
  carregando: boolean
  onCarregarMais: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id })
  return (
    <section className="flex w-72 shrink-0 flex-col gap-2">
      <header className="flex flex-col gap-1.5">
        <span aria-hidden="true" className={`h-1 w-full rounded-full ${FILETE[etapa.tipo]}`} />
        <div className="flex items-baseline justify-between gap-2 px-0.5">
          <h2 className="truncate text-[13px] font-semibold uppercase tracking-wide text-foreground">
            {etapa.nome}
          </h2>
          <span className="tabular shrink-0 text-[11px] text-muted-foreground">
            {total} {total === 1 ? 'lead' : 'leads'}
            {/* Soma da coluna: e' o dado que o print de referencia mostra no
                cabecalho de cada etapa e que o funil nao tinha. Omitida quando
                nenhum lead da coluna tem valor — "R$ 0,00" ali seria uma
                afirmacao falsa (nao e' que valem zero, e' que ninguem
                preencheu). O numero vem do banco e conta a coluna INTEIRA,
                nao so' os cartoes carregados. */}
            {soma !== null && `: ${formatarMoeda(soma)}`}
          </span>
        </div>
      </header>
      <div
        ref={setNodeRef}
        className={`flex min-h-[55vh] flex-col gap-2 rounded-2xl border p-2 transition-colors ${
          // bg-secondary (#17223c) vs bg-muted (#131d33) e uma diferenca de
          // uns 4-9 niveis de sRGB — quase invisivel. O ring da o sinal real
          // de que a coluna e o alvo do drop, sem depender so do fundo.
          isOver
            ? 'border-primary bg-secondary ring-2 ring-primary/40'
            : 'border-transparent bg-muted/50'
        }`}
      >
        {children}
        {/* Só aparece quando o banco disse que sobrou algo nesta coluna. O
            numero vai no rotulo porque "carregar mais" sozinho nao diz se
            faltam 3 ou 3000 — e com 3000 a escolha certa e' filtrar. */}
        {faltam > 0 && (
          <button
            type="button"
            onClick={onCarregarMais}
            disabled={carregando}
            className="pressable mt-1 rounded-xl border border-border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {carregando ? 'carregando…' : `carregar mais (${faltam})`}
          </button>
        )}
      </div>
    </section>
  )
}

export function Quadro({
  etapas,
  colunas,
  membros,
  motivos,
  etiquetasConhecidas,
  pipelineId,
  filtros,
}: {
  etapas: Etapa[]
  colunas: ColunaDoFunil[]
  membros: Membro[]
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
  pipelineId: string
  filtros: FiltrosDaUrl
}) {
  const [pedido, setPedido] = useState<PedidoMovimento | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // Qual lead esta em voo: e o que o DragOverlay desenha sob o ponteiro.
  const [arrastandoId, setArrastandoId] = useState<string | null>(null)
  // Paginas extras que o "carregar mais" trouxe, por etapa. Vive no cliente
  // porque nao ha URL que as descreva — e some sozinha na navegacao por
  // filtro, que remonta o Quadro (ver a `key` em page.tsx).
  const [extras, setExtras] = useState<Record<string, LeadDoFunil[]>>({})
  const [carregando, setCarregando] = useState<string | null>(null)
  // Colunas que ja devolveram pagina VAZIA. `total` vem de uma consulta e a
  // pagina de outra: entre as duas alguem pode ter movido ou perdido acesso
  // aos leads que faltavam, e ai o botao ficaria eternamente oferecendo mais
  // e trazendo nada. Uma pagina vazia encerra a coluna.
  const [esgotadas, setEsgotadas] = useState<ReadonlySet<string>>(new Set())
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // O que o servidor mandou para cada coluna, mais o que o "carregar mais"
  // acrescentou. Estes numeros NAO mudam com movimento otimista, e e' o que
  // permite o cabecalho continuar honesto durante o arrasto (ver `resto`).
  const carregadosPorEtapa = useMemo(() => {
    const mapa = new Map<string, LeadDoFunil[]>()
    for (const c of colunas) mapa.set(c.etapaId, c.leads)
    for (const [etapaId, mais] of Object.entries(extras)) {
      if (mais.length === 0) continue
      mapa.set(etapaId, [...(mapa.get(etapaId) ?? []), ...mais])
    }
    return mapa
  }, [colunas, extras])

  const todos = useMemo(() => [...carregadosPorEtapa.values()].flat(), [carregadosPorEtapa])

  // Deriva do prop: revalidatePath e navegacao por filtro chegam sozinhos, e o
  // patch otimista e descartado quando a transicao termina (rollback automatico).
  const [posicoes, moverOtimista] = useOptimistic(todos, aplicarMovimento)

  // Agrupa UMA vez por render. Antes era `posicoes.filter(...)` dentro do
  // `etapas.map`, ou seja etapas x leads comparacoes a cada re-render — e o
  // Quadro re-renderiza a cada pegada e a cada soltada do arrasto.
  const porEtapa = useMemo(() => {
    const mapa = new Map<string, LeadDoFunil[]>()
    for (const e of etapas) mapa.set(e.id, [])
    for (const lead of posicoes) {
      const lista = mapa.get(lead.stageId)
      // Etapa fora da pipeline atual (movimento otimista para uma etapa que
      // sumiu, por exemplo) simplesmente nao e' desenhada.
      if (lista) lista.push(lead)
    }
    return mapa
  }, [posicoes, etapas])

  /**
   * O que existe na coluna e NAO esta carregado: total e soma do banco menos o
   * que o servidor entregou para aquela coluna.
   *
   * Deriva dos dados do SERVIDOR, nunca de `posicoes`: assim o cabecalho soma
   * "resto + cartoes que estao na coluna agora" e continua certo no meio de um
   * movimento otimista — o cartao que saiu para outra coluna sai da contagem
   * daqui e entra na de la, exatamente como o usuario ve.
   */
  const resto = useMemo(() => {
    const mapa = new Map<string, { total: number; soma: number | null }>()
    for (const c of colunas) {
      const carregados = carregadosPorEtapa.get(c.etapaId) ?? []
      const somaCarregados = carregados.reduce((acc, l) => acc + (l.valorCents ?? 0), 0)
      mapa.set(c.etapaId, {
        total: Math.max(0, c.total - carregados.length),
        // null quando o banco disse que NENHUM lead da coluna tem valor: nesse
        // caso nao ha resto a somar, e o cabecalho volta a decidir por si.
        soma: c.somaCents === null ? null : c.somaCents - somaCarregados,
      })
    }
    return mapa
  }, [colunas, carregadosPorEtapa])

  const nomePorId = useMemo(() => new Map(membros.map((m) => [m.id, m.nome])), [membros])
  const nomeDoResponsavel = useCallback(
    (lead: LeadDoFunil) => (lead.responsavelId ? nomePorId.get(lead.responsavelId) ?? null : null),
    [nomePorId],
  )
  const arrastando = arrastandoId ? posicoes.find((l) => l.id === arrastandoId) ?? null : null

  function aoPegar(evento: DragStartEvent) {
    setArrastandoId(String(evento.active.id))
  }

  function aoSoltar(evento: DragEndEvent) {
    setArrastandoId(null)
    const leadId = String(evento.active.id)
    const destinoId = evento.over ? String(evento.over.id) : null
    if (!destinoId) return

    const lead = posicoes.find((l) => l.id === leadId)
    const destino = etapas.find((e) => e.id === destinoId)
    if (!lead || !destino || lead.stageId === destino.id) return

    setPedido({ leadId, nomeLead: lead.nome, destino })
  }

  async function carregarMais(etapaId: string) {
    setCarregando(etapaId)
    setErro(null)
    // offset = o que ESTA carregado desta coluna pelo servidor, nao o que
    // esta desenhado nela: um lead movido para outra coluna nao muda a
    // paginacao do banco, que ordena por criado_em.
    const offset = (carregadosPorEtapa.get(etapaId) ?? []).length
    const r = await chamarAcao(maisLeadsDaEtapaAction(pipelineId, etapaId, offset, filtros))
    setCarregando(null)
    if (!r.ok) {
      setErro(mensagemDeErro(r.erro))
      return
    }
    if (r.valor.length === 0) {
      setEsgotadas((atual) => new Set(atual).add(etapaId))
      return
    }
    setExtras((atual) => ({ ...atual, [etapaId]: [...(atual[etapaId] ?? []), ...r.valor] }))
  }

  function confirmar(lossReasonId: string | null, etiquetas: string[]) {
    if (!pedido) return
    const atual = pedido
    setPedido(null)
    setErro(null)

    // O dispatch otimista e o await moram dentro da mesma transicao: o React so
    // descarta o patch quando ela termina, entao o card nao volta antes da resposta.
    startTransition(async () => {
      moverOtimista({ leadId: atual.leadId, stageId: atual.destino.id })
      // chamarAcao cobre a falha de TRANSPORTE: se o fetch por baixo da Server
      // Action rejeita, o await lanca, a excecao escapa para o error reporting
      // global do React e o setErro abaixo nunca roda — o cartao voltava para a
      // coluna de origem sem uma palavra de explicacao. Recusa do servidor ja
      // vinha como Resultado e continua vindo.
      const r = await chamarAcao(
        moverEtapaAction(atual.leadId, atual.destino.id, lossReasonId, etiquetas),
      )
      if (!r.ok) setErro(mensagemDeErro(r.erro))
    })
  }

  return (
    <>
      {erro && (
        <p
          className="mx-6 mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {erro}
        </p>
      )}
      <DndContext
        sensors={sensores}
        onDragStart={aoPegar}
        onDragEnd={aoSoltar}
        onDragCancel={() => setArrastandoId(null)}
      >
        <div className="flex gap-4 overflow-x-auto p-6">
          {etapas.map((etapa) => {
            const daEtapa = porEtapa.get(etapa.id) ?? []
            const sobra = resto.get(etapa.id) ?? { total: 0, soma: null }
            const comValor = daEtapa.some((l) => l.valorCents !== null)
            // `0` legitimo (um lead com valorCents = 0) conta como preenchido
            // e some com a checagem de `some`, nao de total.
            const soma =
              sobra.soma !== null || comValor
                ? (sobra.soma ?? 0) + daEtapa.reduce((acc, l) => acc + (l.valorCents ?? 0), 0)
                : null
            return (
              <Coluna
                key={etapa.id}
                etapa={etapa}
                total={sobra.total + daEtapa.length}
                soma={soma}
                faltam={esgotadas.has(etapa.id) ? 0 : sobra.total}
                carregando={carregando === etapa.id}
                onCarregarMais={() => void carregarMais(etapa.id)}
              >
                {daEtapa.map((lead) => (
                  <CartaoArrastavel
                    key={lead.id}
                    lead={lead}
                    nomeResponsavel={nomeDoResponsavel(lead)}
                  />
                ))}
              </Coluna>
            )
          })}
        </div>
        {/* A copia que acompanha o ponteiro. O dnd-kit core nao move nada
            sozinho: sem isto (ou sem aplicar `transform` no cartao de origem) o
            cartao ficava parado e a unica pista do arrasto era a coluna de
            destino mudando de cor — invisivel num monitor onde as 7 colunas nao
            cabem na tela e a coluna comeca a auto-rolar. O overlay e renderizado
            em position: fixed, entao tambem nao e recortado pelo overflow-x do
            quadro. */}
        {/* dropAnimation={null}: com a animacao padrao o dnd-kit mantem a copia
            montada por mais uns 250ms depois do drop, e nesse intervalo o mesmo
            lead existe duas vezes no DOM (dois links com o mesmo nome). Aqui a
            animacao nem faria sentido — ela devolveria o cartao a posicao antiga
            enquanto o modal de movimento ja esta abrindo. */}
        <DragOverlay dropAnimation={null}>
          {arrastando && (
            <div className="cursor-grabbing shadow-lg">
              <Cartao
                lead={arrastando}
                nomeResponsavel={nomeDoResponsavel(arrastando)}
                href={hrefDoCartao(arrastando.id)}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {pedido && (
        <ModalMovimento
          pedido={pedido}
          motivos={motivos}
          etiquetasConhecidas={etiquetasConhecidas}
          onCancelar={() => setPedido(null)}
          onConfirmar={confirmar}
        />
      )}
    </>
  )
}
