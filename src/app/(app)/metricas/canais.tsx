'use client'

import { useState } from 'react'
import type { NoCanal } from '@/lib/domain/metricas'

// O dominio emite a chave crua de origem ('meta', 'google', ...) de proposito
// — para nao carregar texto de UI. So o nivel 0 (origem) precisa de traducao:
// campanha e anuncio ja chegam com nome legivel ou com o sentinela
// '(sem campanha)'/'(sem anúncio)', que ja e texto de exibicao.
const NOMES_ORIGEM: Record<string, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  manual: 'Manual',
  indicacao: 'Indicação',
  organico: 'Orgânico',
}

function Linha({
  no,
  nivel,
  caminho,
  expandidos,
  alternar,
}: {
  no: NoCanal
  nivel: number
  /** Caminho completo desde a raiz (ex.: "meta/c1"), nao so `chave`: dois
   * canais diferentes podem ter uma campanha com a mesma chave sentinela
   * '(sem campanha)', e uma chave curta faria expandir um abrir o outro. */
  caminho: string
  expandidos: Set<string>
  alternar: (caminho: string) => void
}) {
  const temFilhos = no.filhos.length > 0
  const expandido = expandidos.has(caminho)
  const rotulo = nivel === 0 ? (NOMES_ORIGEM[no.chave] ?? no.chave) : no.rotulo

  return (
    <>
      <tr className="border-b border-border">
        <td className="py-1.5" style={{ paddingLeft: `${nivel * 1.25}rem` }}>
          <div className="flex items-center gap-2">
            {/* Linha sem filhos nao ganha controle de expansao — o espaco
                fica em branco so para manter o alinhamento das colunas. */}
            {temFilhos ? (
              <button
                type="button"
                onClick={() => alternar(caminho)}
                className="w-4 text-muted-foreground"
                aria-label={expandido ? 'Recolher' : 'Expandir'}
              >
                {expandido ? '▾' : '▸'}
              </button>
            ) : (
              <span className="inline-block w-4" />
            )}
            <span className="text-sm">{rotulo}</span>
            {/* O numero nunca pode se passar por nome: quando nao ha nome
                conhecido, o rotulo e o id cru e a marca "id" fica ao lado. */}
            {no.ehId && <span className="eyebrow">id</span>}
          </div>
        </td>
        <td className="tabular py-1.5 text-right text-sm">{no.leads}</td>
        <td className="tabular py-1.5 text-right text-sm">{no.ganhos}</td>
        <td className="tabular py-1.5 text-right text-sm">{Math.round(no.taxaGanho)}%</td>
        <td className="tabular py-1.5 text-right text-sm">{no.abertos}</td>
      </tr>
      {expandido &&
        no.filhos.map((filho) => (
          <Linha
            key={filho.chave}
            no={filho}
            nivel={nivel + 1}
            caminho={`${caminho}/${filho.chave}`}
            expandidos={expandidos}
            alternar={alternar}
          />
        ))}
    </>
  )
}

export function Canais({ raizes }: { raizes: NoCanal[] }) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  function alternar(caminho: string) {
    setExpandidos((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(caminho)) proximo.delete(caminho)
      else proximo.add(caminho)
      return proximo
    })
  }

  return (
    <section className="surface rounded-lg p-6">
      <p className="eyebrow">Canais</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-normal">Canal</th>
              <th className="py-1.5 text-right font-normal">Leads</th>
              <th className="py-1.5 text-right font-normal">Ganhos</th>
              <th className="py-1.5 text-right font-normal">Taxa</th>
              <th className="py-1.5 text-right font-normal">Abertos</th>
            </tr>
          </thead>
          <tbody>
            {raizes.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-3 text-sm text-muted-foreground">
                  Nenhum lead entrou nesse período.
                </td>
              </tr>
            ) : (
              raizes.map((no) => (
                <Linha
                  key={no.chave}
                  no={no}
                  nivel={0}
                  caminho={no.chave}
                  expandidos={expandidos}
                  alternar={alternar}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
