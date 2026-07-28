'use client'

import { startTransition, useOptimistic, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import type { Etapa, Etiqueta, Lead, Membro, MotivoPerda } from '@/lib/domain/tipos'
import { Cartao } from './cartao'
import { ModalMovimento, type PedidoMovimento } from './modal-movimento'
import { moverEtapaAction } from './acoes'

const MENSAGENS: Record<string, string> = {
  motivo_perda_obrigatorio: 'Escolha o motivo da perda.',
  motivo_perda_invalido: 'Esse motivo de perda não pertence à sua conta.',
  etapa_invalida: 'Essa etapa não pertence ao seu funil.',
  lead_nao_encontrado: 'Você não tem acesso a esse lead.',
  movimento_falhou_etiquetas_salvas:
    'As etiquetas foram salvas, mas o lead continua na etapa anterior. Tente mover de novo.',
}

// Move um unico lead: patches concorrentes se acumulam em vez de se sobrescreverem.
type MovimentoOtimista = { leadId: string; stageId: string }

function aplicarMovimento(atual: Lead[], patch: MovimentoOtimista): Lead[] {
  return atual.map((l) => (l.id === patch.leadId ? { ...l, stageId: patch.stageId } : l))
}

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
        <span className="text-xs text-neutral-500">{total}</span>
      </header>
      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-col gap-2 rounded p-2 ${
          isOver ? 'bg-neutral-200' : 'bg-neutral-50'
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
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const nomePorId = new Map(membros.map((m) => [m.id, m.nome]))

  function aoSoltar(evento: DragEndEvent) {
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
      const r = await moverEtapaAction(atual.leadId, atual.destino.id, lossReasonId, etiquetas)
      if (!r.ok) setErro(MENSAGENS[r.erro] ?? r.erro)
    })
  }

  return (
    <>
      {erro && (
        <p className="mx-6 mt-3 rounded bg-red-50 p-2 text-sm text-red-700" role="alert">
          {erro}
        </p>
      )}
      <DndContext sensors={sensores} onDragEnd={aoSoltar}>
        <div className="flex gap-4 overflow-x-auto p-6">
          {etapas.map((etapa) => {
            const daEtapa = posicoes.filter((l) => l.stageId === etapa.id)
            return (
              <Coluna key={etapa.id} etapa={etapa} total={daEtapa.length}>
                {daEtapa.map((lead) => (
                  <CartaoArrastavel
                    key={lead.id}
                    lead={lead}
                    nomeResponsavel={
                      lead.responsavelId ? nomePorId.get(lead.responsavelId) ?? null : null
                    }
                  />
                ))}
              </Coluna>
            )
          })}
        </div>
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
