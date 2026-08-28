'use client'

import { useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import type { Etapa, Etiqueta, Lead, Pipeline } from '@/lib/domain/tipos'
import { formatarMoeda } from '@/lib/domain/formato'
import { corDaEtapa } from '@/lib/domain/etapa-cor'
import { Selo } from '@/components/ui/selo'
import { EditorEtiquetas } from './etiquetas'

/**
 * O cabecalho colorido do drawer do lead, no formato do print de referencia
 * (Kommo): nome e valor em cima, etiquetas, o nome da pipeline com o gatilho
 * de etapa ao lado, e a barra de progresso do funil embaixo.
 *
 * `gatilhoEtapa` entra como slot em vez de ser construido aqui: na Task 4 e'
 * um <span> que so' informa a etapa e ha quanto tempo o lead esta nela; na
 * Task 5 vira o botao que abre o seletor de etapa/pipeline. Trocar um pelo
 * outro nao pode mexer no layout do cabecalho.
 *
 * O `<h2 id={tituloId}>` daqui e' o nome ACESSIVEL do dialogo: o `titulo` que
 * o `Drawer` renderiza fica `sr-only` justamente para nao repetir este.
 */
export function CabecalhoLead({
  lead,
  tituloId,
  pipeline,
  etapas,
  etiquetasConhecidas,
  gatilhoEtapa,
}: {
  lead: Lead
  tituloId: string
  pipeline: Pipeline
  etapas: Etapa[]
  etiquetasConhecidas: Etiqueta[]
  gatilhoEtapa: ReactNode
}) {
  const [editandoEtiquetas, setEditandoEtiquetas] = useState(false)

  // So as ABERTAS viram faixa: 'ganho' e 'perdido' sao desfecho, nao caminho.
  // O indice dentro DESTA lista (0-based) e' o que `corDaEtapa` espera —
  // `etapa.ordem` comeca em 1 e contaria as fechadas.
  const abertas = etapas.filter((e) => e.tipo === 'aberta').sort((a, b) => a.ordem - b.ordem)
  const etapaAtual = etapas.find((e) => e.id === lead.stageId) ?? null
  const indiceAtual = abertas.findIndex((e) => e.id === lead.stageId)
  // Lead ganho ou perdido nao esta em nenhuma faixa: ele atravessou o funil
  // inteiro, entao nenhuma faixa fica apagada (apagar todas diria que ele nao
  // saiu do lugar).
  const ate = indiceAtual >= 0 ? indiceAtual : abertas.length - 1
  const rotuloBarra =
    indiceAtual >= 0
      ? `Etapa ${indiceAtual + 1} de ${abertas.length}: ${etapaAtual?.nome ?? '—'}`
      : `Etapa: ${etapaAtual?.nome ?? '—'}`

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-primary p-3 text-primary-foreground">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={tituloId} className="min-w-0 truncate text-lg font-semibold">
          {lead.nome}
        </h2>
        <span className="tabular shrink-0 text-sm font-semibold">
          {formatarMoeda(lead.valorCents)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {/* Com o editor aberto os chips dele (que tem o botao de remover)
            substituem os selos — dois conjuntos das mesmas etiquetas lado a
            lado so' confundiriam qual deles responde ao clique. */}
        {!editandoEtiquetas &&
          lead.etiquetas.map((e) => (
            <Selo key={e.id} className="bg-primary-foreground/15 text-primary-foreground">
              {e.nome}
            </Selo>
          ))}
        <button
          type="button"
          onClick={() => setEditandoEtiquetas((v) => !v)}
          aria-label={editandoEtiquetas ? 'Fechar etiquetas' : 'Editar etiquetas'}
          aria-expanded={editandoEtiquetas}
          className="pressable rounded-full p-1 text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground"
        >
          {editandoEtiquetas ? (
            <X size={14} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      </div>
      {editandoEtiquetas && (
        <EditorEtiquetas
          leadId={lead.id}
          atuais={lead.etiquetas}
          conhecidas={etiquetasConhecidas}
        />
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-primary-foreground/70">{pipeline.nome}</span>
        {gatilhoEtapa}
      </div>

      {abertas.length > 0 && (
        <div role="img" aria-label={rotuloBarra} className="flex gap-1">
          {abertas.map((e, i) => (
            <span
              key={e.id}
              className={`h-1.5 flex-1 rounded-full ${corDaEtapa(i, 'aberta').fundo} ${
                i > ate ? 'opacity-30' : ''
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
