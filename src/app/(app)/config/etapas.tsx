'use client'

import { useState } from 'react'
import type { Resultado } from '@/lib/domain/resultado'
import type { Etapa, StageTipo } from '@/lib/domain/tipos'
import type { ResumoEtapa } from '@/lib/data/admin'
import {
  criarEtapaAction,
  renomearEtapaAction,
  excluirEtapaAction,
  reordenarEtapasAction,
} from './acoes'
import { chamarAcao } from '@/lib/ui/acao'
import { mensagemDeErro } from './erros'

export function Etapas({
  etapas,
  resumo,
  renomear = renomearEtapaAction,
  excluir = excluirEtapaAction,
}: {
  etapas: Etapa[]
  resumo: ResumoEtapa[]
  renomear?: (etapaId: string, nome: string) => Promise<Resultado<void>>
  excluir?: (etapaId: string) => Promise<Resultado<void>>
}) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<StageTipo>('aberta')
  const [erro, setErro] = useState<string | null>(null)
  const [salvoId, setSalvoId] = useState<string | null>(null)
  const [etapaParaExcluir, setEtapaParaExcluir] = useState<Etapa | null>(null)

  const resumoPorEtapa = new Map(resumo.map((r) => [r.etapaId, r]))

  async function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao
    if (destino < 0 || destino >= etapas.length) return
    const ids = etapas.map((e) => e.id)
    ;[ids[indice], ids[destino]] = [ids[destino], ids[indice]]
    const r = await chamarAcao(reordenarEtapasAction(ids))
    if (!r.ok) setErro(mensagemDeErro(r.erro))
  }

  async function renomearCampo(e: Etapa, valor: string) {
    if (valor === e.nome) return
    setSalvoId(null)
    const r = await chamarAcao(renomear(e.id, valor))
    if (!r.ok) {
      setErro(mensagemDeErro(r.erro))
    } else {
      setErro(null)
      setSalvoId(e.id)
    }
  }

  async function confirmarExclusao() {
    const alvo = etapaParaExcluir
    if (!alvo) return
    const r = await chamarAcao(excluir(alvo.id))
    setEtapaParaExcluir(null)
    if (!r.ok) {
      // O codigo do erro manda; o numero do resumo so ilustra quando ele
      // bate com o que a etapa tem agora. Sem resumo (busca falhou ou nao
      // ha linha para esta etapa), cai no texto generico de config/erros.ts,
      // que ja diz a mesma coisa sem numero.
      if (r.erro === 'etapa_tem_leads') {
        const res = resumoPorEtapa.get(alvo.id)
        setErro(
          res
            ? `Mova os ${res.leadsNaEtapa} leads desta etapa antes de excluí-la.`
            : mensagemDeErro('etapa_tem_leads'),
        )
      } else if (r.erro === 'ultima_etapa_do_tipo') {
        setErro(`Esta é a última etapa do tipo ${alvo.tipo}.`)
      } else {
        setErro(mensagemDeErro(r.erro))
      }
    } else {
      setErro(null)
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-semibold">Etapas do funil</h2>
      <ul className="flex flex-col gap-1">
        {etapas.map((e, i) => (
          <li key={e.id} className="flex items-center gap-2 rounded border p-2 text-sm">
            <input
              defaultValue={e.nome}
              onBlur={(ev) => {
                void renomearCampo(e, ev.target.value)
              }}
              className="flex-1 rounded border px-2 py-1"
            />
            {salvoId === e.id && (
              <span className="text-xs text-success">Salvo ✓</span>
            )}
            <span className="text-xs text-muted-foreground">{e.tipo}</span>
            <button type="button" onClick={() => mover(i, -1)} aria-label="subir">
              ↑
            </button>
            <button type="button" onClick={() => mover(i, 1)} aria-label="descer">
              ↓
            </button>
            <button
              type="button"
              onClick={() => setEtapaParaExcluir(e)}
              aria-label={`Excluir etapa ${e.nome}`}
              className="text-xs text-destructive underline"
            >
              Excluir
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
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
        >
          Adicionar
        </button>
      </div>
      {erro && <p className="mt-1 text-sm text-destructive">{erro}</p>}

      {etapaParaExcluir && (
        <div
          role="dialog"
          aria-label={`Excluir etapa ${etapaParaExcluir.nome}`}
          className="mt-3 flex flex-col gap-2 rounded border p-3 text-sm"
        >
          <p>
            Excluir a etapa &quot;{etapaParaExcluir.nome}&quot;?
            {resumoPorEtapa.has(etapaParaExcluir.id) &&
              ` ${resumoPorEtapa.get(etapaParaExcluir.id)!.leadsPassaram} leads já passaram por ela.`}
          </p>
          <p>O histórico e as métricas desta etapa serão preservados.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmarExclusao}
              aria-label={`Confirmar exclusão de ${etapaParaExcluir.nome}`}
              className="rounded bg-destructive px-3 py-1 text-primary-foreground"
            >
              Confirmar exclusão
            </button>
            <button
              type="button"
              onClick={() => setEtapaParaExcluir(null)}
              aria-label="Cancelar exclusão"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
