'use client'

import { useState } from 'react'
import type { Etapa, StageTipo } from '@/lib/domain/tipos'
import { criarEtapaAction, renomearEtapaAction, reordenarEtapasAction } from './acoes'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErro } from './erros'

export function Etapas({ etapas }: { etapas: Etapa[] }) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<StageTipo>('aberta')
  const [erro, setErro] = useState<string | null>(null)

  async function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao
    if (destino < 0 || destino >= etapas.length) return
    const ids = etapas.map((e) => e.id)
    ;[ids[indice], ids[destino]] = [ids[destino], ids[indice]]
    const r = await chamarAcao(reordenarEtapasAction(ids))
    if (!r.ok) setErro(mensagemDeErro(r.erro))
  }

  return (
    <section>
      <h2 className="mb-2 font-semibold">Etapas do funil</h2>
      <ul className="flex flex-col gap-1">
        {etapas.map((e, i) => (
          <li key={e.id} className="flex items-center gap-2 rounded border p-2 text-sm">
            <input
              defaultValue={e.nome}
              onBlur={async (ev) => {
                if (ev.target.value !== e.nome) {
                  const r = await chamarAcao(renomearEtapaAction(e.id, ev.target.value))
                  if (!r.ok) setErro(mensagemDeErro(r.erro))
                }
              }}
              className="flex-1 rounded border px-2 py-1"
            />
            <span className="text-xs text-neutral-500">{e.tipo}</span>
            <button type="button" onClick={() => mover(i, -1)} aria-label="subir">
              ↑
            </button>
            <button type="button" onClick={() => mover(i, 1)} aria-label="descer">
              ↓
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="nova etapa"
          className="rounded border px-2 py-1 text-sm"
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as StageTipo)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="aberta">aberta</option>
          <option value="ganho">ganho</option>
          <option value="perdido">perdido</option>
        </select>
        <button
          type="button"
          onClick={async () => {
            const r = await chamarAcao(criarEtapaAction(nome, tipo))
            if (!r.ok) setErro(mensagemDeErro(r.erro))
            else {
              setErro(null)
              setNome('')
            }
          }}
          className="rounded bg-black px-3 py-1 text-sm text-white"
        >
          Adicionar
        </button>
      </div>
      {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
    </section>
  )
}
