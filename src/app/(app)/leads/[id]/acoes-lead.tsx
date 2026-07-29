'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Etapa, Etiqueta, Lead, Membro, MotivoPerda } from '@/lib/domain/tipos'
import { ModalMovimento, type PedidoMovimento } from '@/app/(app)/funil/modal-movimento'
import { moverEtapaAction } from '@/app/(app)/funil/acoes'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErro } from '@/app/(app)/funil/erros'
import { trocarResponsavel } from './acoes'

export function AcoesLead({
  lead,
  etapas,
  membros,
  motivos,
  etiquetasConhecidas,
  podeTrocarResponsavel,
}: {
  lead: Lead
  etapas: Etapa[]
  membros: Membro[]
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
  podeTrocarResponsavel: boolean
}) {
  const router = useRouter()
  const [pedido, setPedido] = useState<PedidoMovimento | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function confirmar(lossReasonId: string | null, etiquetas: string[]) {
    if (!pedido) return
    const r = await chamarAcao(
      moverEtapaAction(pedido.leadId, pedido.destino.id, lossReasonId, etiquetas),
    )
    setPedido(null)
    if (!r.ok) setErro(mensagemDeErro(r.erro))
    else {
      setErro(null)
      router.refresh()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm">
        Mover para
        <select
          value={lead.stageId}
          onChange={(e) => {
            const destino = etapas.find((x) => x.id === e.target.value)
            if (destino && destino.id !== lead.stageId) {
              setPedido({ leadId: lead.id, nomeLead: lead.nome, destino })
            }
          }}
          className="mt-1 w-full rounded border p-2"
        >
          {etapas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
      </label>

      {podeTrocarResponsavel && (
        <label className="text-sm">
          Responsável
          <select
            value={lead.responsavelId ?? ''}
            onChange={async (e) => {
              const r = await trocarResponsavel(lead.id, e.target.value || null)
              if (!r.ok) setErro(mensagemDeErro(r.erro))
              else {
                setErro(null)
                router.refresh()
              }
            }}
            className="mt-1 w-full rounded border p-2"
          >
            <option value="">sem responsável</option>
            {membros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {pedido && (
        <ModalMovimento
          pedido={pedido}
          motivos={motivos}
          etiquetasConhecidas={etiquetasConhecidas}
          onCancelar={() => setPedido(null)}
          onConfirmar={confirmar}
        />
      )}
    </div>
  )
}
