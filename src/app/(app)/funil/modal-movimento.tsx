'use client'

import { useState } from 'react'
import type { Etapa, Etiqueta, MotivoPerda } from '@/lib/domain/tipos'

export type PedidoMovimento = { leadId: string; nomeLead: string; destino: Etapa }

export function ModalMovimento({
  pedido,
  motivos,
  etiquetasConhecidas,
  onCancelar,
  onConfirmar,
}: {
  pedido: PedidoMovimento
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
  onCancelar: () => void
  onConfirmar: (lossReasonId: string | null, etiquetas: string[]) => void
}) {
  const exigeMotivo = pedido.destino.tipo === 'perdido'
  const [motivoId, setMotivoId] = useState('')
  const [entrada, setEntrada] = useState('')
  const [escolhidas, setEscolhidas] = useState<string[]>([])

  function adicionar(nome: string) {
    const limpo = nome.trim()
    if (!limpo) return
    if (escolhidas.some((e) => e.toLowerCase() === limpo.toLowerCase())) return
    setEscolhidas([...escolhidas, limpo])
    setEntrada('')
  }

  const sugestoes = etiquetasConhecidas
    .filter((e) => e.nome.toLowerCase().includes(entrada.toLowerCase()))
    .filter((e) => !escolhidas.some((x) => x.toLowerCase() === e.nome.toLowerCase()))
    .slice(0, 6)

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded bg-card p-5">
        <h2 className="text-lg font-semibold">
          {pedido.nomeLead} → {pedido.destino.nome}
        </h2>

        {exigeMotivo && (
          <label className="mt-3 block text-sm">
            Motivo da perda <span className="text-destructive">*</span>
            <select
              value={motivoId}
              onChange={(e) => setMotivoId(e.target.value)}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="">selecione</option>
              {motivos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-3 text-sm">
          <span>Etiquetas {exigeMotivo ? '' : '(opcional)'}</span>
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                adicionar(entrada)
              }
            }}
            placeholder="digite e pressione Enter"
            className="mt-1 w-full rounded border p-2"
          />
          {sugestoes.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1">
              {sugestoes.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => adicionar(s.nome)}
                    className="rounded bg-muted px-2 py-0.5 text-xs hover:bg-secondary"
                  >
                    {s.nome}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {escolhidas.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {escolhidas.map((e) => (
                <li key={e} className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  {e}
                  <button
                    type="button"
                    onClick={() => setEscolhidas(escolhidas.filter((x) => x !== e))}
                    className="ml-1"
                    aria-label={`remover ${e}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="px-3 py-1 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={exigeMotivo && !motivoId}
            onClick={() => onConfirmar(exigeMotivo ? motivoId : null, escolhidas)}
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-40"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
