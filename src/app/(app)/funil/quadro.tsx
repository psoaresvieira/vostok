'use client'

import { useState } from 'react'
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
  const [posicoes, setPosicoes] = useState<Lead[]>(leads)
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

  async function confirmar(lossReasonId: string | null, etiquetas: string[]) {
    if (!pedido) return
    const anterior = posicoes
    // Otimista: o card muda de coluna antes da resposta do servidor.
    setPosicoes(
      posicoes.map((l) => (l.id === pedido.leadId ? { ...l, stageId: pedido.destino.id } : l)),
    )
    setPedido(null)
    setErro(null)

    const r = await moverEtapaAction(pedido.leadId, pedido.destino.id, lossReasonId, etiquetas)
    if (!r.ok) {
      setPosicoes(anterior)
      setErro(MENSAGENS[r.erro] ?? r.erro)
    }
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
