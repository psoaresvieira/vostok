'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import type { Etapa, Etiqueta, MotivoPerda } from '@/lib/domain/tipos'

export type PedidoMovimento = { leadId: string; nomeLead: string; destino: Etapa }

export function ModalMovimento({
  pedido,
  motivos,
  etiquetasConhecidas,
  onCancelar,
  onConfirmar,
  enviando,
  erro,
}: {
  pedido: PedidoMovimento
  motivos: MotivoPerda[]
  etiquetasConhecidas: Etiqueta[]
  onCancelar: () => void
  onConfirmar: (lossReasonId: string | null, etiquetas: string[]) => void
  /** Opcional e' proposito: o Quadro fecha este modal ANTES do await (o
   *  movimento la' e' otimista, o cartao ja pulou de coluna), entao ele nunca
   *  tem um "enviando" para mostrar. So' quem mantem o modal montado durante
   *  o await — o SeletorEtapa do drawer — passa isto. */
  enviando?: boolean
  /** Erro do movimento anterior, mostrado DENTRO do modal para sobreviver ao
   *  reabrir: motivo e etiquetas que o usuario ja preencheu continuam na
   *  tela junto com a explicacao da recusa. */
  erro?: string | null
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      {/* .surface (utilitario ja portado, sem consumidor ate aqui) da o
          hairline e a sombra que bg-card sozinho nao tem: sobre o scrim de
          bg-black/40, bg-card (#0e1526) compoe para ~1.12:1 contra o fundo —
          o painel praticamente nao tem borda visivel. */}
      <div className="surface fade-in w-full max-w-md rounded-3xl p-6">
        <h2 className="text-lg font-semibold">
          {pedido.nomeLead} → {pedido.destino.nome}
        </h2>

        {erro && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {erro}
          </p>
        )}

        {exigeMotivo && (
          <label className="mt-3 block text-sm">
            Motivo da perda <span className="text-destructive">*</span>
            <select
              value={motivoId}
              onChange={(e) => setMotivoId(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-border bg-muted/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary focus:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
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
            className="mt-1 h-10 w-full rounded-xl border border-border bg-muted/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary focus:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
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
                <li
                  key={e}
                  className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                >
                  {e}
                  <button
                    type="button"
                    onClick={() => setEscolhidas(escolhidas.filter((x) => x !== e))}
                    className="pressable -mr-1 rounded-full p-0.5 hover:bg-black/20"
                    aria-label={`remover ${e}`}
                  >
                    <X size={12} strokeWidth={2.5} aria-hidden="true" />
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
            disabled={(exigeMotivo && !motivoId) || enviando}
            onClick={() => onConfirmar(exigeMotivo ? motivoId : null, escolhidas)}
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-40"
          >
            {enviando ? 'Movendo…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
