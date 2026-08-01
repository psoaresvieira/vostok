'use client'

import { startTransition, useOptimistic, useState } from 'react'
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
import type { Etapa, Etiqueta, Lead, Membro, MotivoPerda } from '@/lib/domain/tipos'
import { chamarAcao } from '@/lib/ui/acao'
import { Cartao } from './cartao'
import { ModalMovimento, type PedidoMovimento } from './modal-movimento'
import { moverEtapaAction } from './acoes'
import { mensagemDeErro } from './erros'

// Move um unico lead: patches concorrentes se acumulam em vez de se sobrescreverem.
type MovimentoOtimista = { leadId: string; stageId: string }

function aplicarMovimento(atual: Lead[], patch: MovimentoOtimista): Lead[] {
  return atual.map((l) => (l.id === patch.leadId ? { ...l, stageId: patch.stageId } : l))
}

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
function CartaoArrastavel({ lead, nomeResponsavel }: { lead: Lead; nomeResponsavel: string | null }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-40' : undefined}
    >
      <Cartao lead={lead} nomeResponsavel={nomeResponsavel} />
    </div>
  )
}

function Coluna({ etapa, children, total }: { etapa: Etapa; children: React.ReactNode; total: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id })
  return (
    <section className="flex w-72 shrink-0 flex-col gap-2">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{etapa.nome}</h2>
        <span className="text-xs text-muted-foreground">{total}</span>
      </header>
      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-col gap-2 rounded p-2 ${
          // bg-secondary (#17223c) vs bg-muted (#131d33) e uma diferenca de
          // uns 4-9 niveis de sRGB — quase invisivel. O ring da o sinal real
          // de que a coluna e o alvo do drop, sem depender so do fundo.
          isOver ? 'bg-secondary ring-1 ring-primary' : 'bg-muted'
        }`}
      >
        {children}
      </div>
    </section>
  )
}

export function Quadro({
  etapas,
  leads,
  membros,
  motivos,
  etiquetasConhecidas,
}: {
  etapas: Etapa[]
  leads: Lead[]
  membros: Membro[]
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
}) {
  // Deriva do prop: revalidatePath e navegacao por filtro chegam sozinhos, e o
  // patch otimista e descartado quando a transicao termina (rollback automatico).
  const [posicoes, moverOtimista] = useOptimistic(leads, aplicarMovimento)
  const [pedido, setPedido] = useState<PedidoMovimento | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // Qual lead esta em voo: e o que o DragOverlay desenha sob o ponteiro.
  const [arrastandoId, setArrastandoId] = useState<string | null>(null)
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const nomePorId = new Map(membros.map((m) => [m.id, m.nome]))
  const nomeDoResponsavel = (lead: Lead) =>
    lead.responsavelId ? nomePorId.get(lead.responsavelId) ?? null : null
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
        <p className="mx-6 mt-3 rounded bg-destructive/10 p-2 text-sm text-destructive" role="alert">
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
            const daEtapa = posicoes.filter((l) => l.stageId === etapa.id)
            return (
              <Coluna key={etapa.id} etapa={etapa} total={daEtapa.length}>
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
              <Cartao lead={arrastando} nomeResponsavel={nomeDoResponsavel(arrastando)} />
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
