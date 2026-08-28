'use client'

import { useCallback, useMemo, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Drawer } from '@/components/ui/drawer'
import { formatarMoeda, formatarTelefone } from '@/lib/domain/formato'
import type { LeadOrigem } from '@/lib/domain/tipos'
// `import type`, e nunca valor: `carregar.ts` alcanca `next/headers` pela
// cadeia do store, e um import de valor arrastaria o modulo inteiro para o
// pacote do cliente (erro de build do Next). O tipo e' apagado na compilacao.
import type { DadosDoDrawer } from './carregar'
import { mapasDoLead } from './mapas'
import { hrefDoFunil } from '../params'
import { Abas } from './abas'
import { CabecalhoLead } from './cabecalho'
import { SeletorEtapa } from './seletor-etapa'
import { AcoesLead } from './acoes-lead'
import { FormularioNota } from './nota'
import { PainelTarefas } from './tarefas'
import { Timeline } from './timeline'

const ROTULO_ORIGEM: Record<LeadOrigem, string> = {
  manual: 'Manual',
  meta: 'Meta Ads',
  google: 'Google Ads',
  indicacao: 'Indicação',
  organico: 'Orgânico',
}

/** Uma linha do <dl> da aba Principal. */
function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="hairline flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{rotulo}</dt>
      {/* break-all so' no email: um endereco longo nao tem espaco onde quebrar
          e empurraria a coluna inteira. */}
      <dd className={`min-w-0 text-right ${rotulo === 'Email' ? 'break-all' : ''}`}>{children}</dd>
    </div>
  )
}

/**
 * O lead como painel lateral do funil — o que era a ficha `/leads/[id]` antes
 * da spec 2026-08-28. Quem decide se ele existe e' a URL (`?lead=`), entao
 * fechar e' `router.push` para a mesma URL sem essa chave, e nao estado local:
 * assim o botao "voltar" do navegador fecha o drawer, e um link para o lead
 * (do sino, de /tarefas, da timeline) o abre.
 *
 * `blocoScripts` chega pronto do servidor (um <Suspense> com o BlocoScripts
 * dentro): e' um server component embrulhado por este componente de cliente,
 * o mesmo padrao que a ficha ja usava.
 */
export function DrawerLead({
  dados,
  hrefFechar,
  queryAtual,
  blocoScripts,
}: {
  dados: DadosDoDrawer
  hrefFechar: string
  /** searchParams da pagina, ja serializados — o seletor de etapa parte daqui
   * para levar o funil ate a pipeline nova SEM perder os filtros. */
  queryAtual: string
  blocoScripts: ReactNode
}) {
  const router = useRouter()
  const { lead } = dados

  // `scroll: false` porque o quadro atras do drawer nao deve pular para o
  // topo quando o painel fecha — o cartao de origem tem que continuar onde
  // estava.
  const fechar = useCallback(
    () => router.push(hrefFechar, { scroll: false }),
    [router, hrefFechar],
  )

  const { nomeEtapa, nomePessoa, nomePipeline } = useMemo(
    () => mapasDoLead(dados.pipelines, dados.membros),
    [dados.pipelines, dados.membros],
  )

  const daPipeline = dados.pipelines.find((p) => p.pipeline.id === lead.pipelineId) ?? null

  const tituloId = `titulo-lead-${lead.id}`

  /**
   * Depois de o servidor confirmar o movimento feito pelo seletor.
   *
   * Mesma pipeline: `router.refresh()` — o quadro atras e o cabecalho do painel
   * voltam a ler o servidor, e a URL continua descrevendo a mesma tela.
   *
   * Outra pipeline: o lead saiu do funil que esta na tela, entao a URL tem que
   * acompanha-lo — senao o painel fica aberto sobre um quadro onde o cartao
   * nao existe mais. `hrefDoFunil` preserva filtros e `?lead=`; `pipeline`
   * some quando o destino e' a pipeline PADRAO, que e' o que `/funil` sem
   * parametro ja mostra.
   */
  const aoMover = useCallback(
    (destino: { pipelineId: string; stageId: string }) => {
      if (destino.pipelineId === lead.pipelineId) {
        router.refresh()
        return
      }
      const nova = dados.pipelines.find((p) => p.pipeline.id === destino.pipelineId)
      router.push(
        hrefDoFunil(queryAtual, {
          pipeline: nova?.pipeline.isDefault ? null : destino.pipelineId,
          lead: lead.id,
        }),
        { scroll: false },
      )
    },
    [router, queryAtual, lead.id, lead.pipelineId, dados.pipelines],
  )

  const principal = (
    <div className="flex flex-col gap-5">
      <dl className="text-sm">
        <Linha rotulo="Responsável">
          <AcoesLead
            lead={lead}
            membros={dados.membros}
            podeTrocarResponsavel={dados.papel !== 'vendedor'}
          />
        </Linha>
        <Linha rotulo="Venda">
          <span className="tabular">{formatarMoeda(lead.valorCents)}</span>
        </Linha>
        <Linha rotulo="Telefone">
          {lead.telefoneE164 ? (
            // <a href="tel:"> e nao Link do Next: o destino nao e' uma rota da
            // aplicacao, e' o discador do aparelho.
            <a className="tabular underline" href={`tel:${lead.telefoneE164}`}>
              {formatarTelefone(lead.telefoneE164)}
            </a>
          ) : (
            '—'
          )}
        </Linha>
        <Linha rotulo="Email">{lead.email ?? '—'}</Linha>
        <Linha rotulo="Empresa">{lead.empresa ?? '—'}</Linha>
        <Linha rotulo="Origem">{ROTULO_ORIGEM[lead.origem]}</Linha>
      </dl>
      {blocoScripts}
    </div>
  )

  const historico = (
    <div className="flex flex-col gap-4">
      <FormularioNota leadId={lead.id} />
      <Timeline
        eventos={dados.eventos}
        nomeEtapa={nomeEtapa}
        nomePessoa={nomePessoa}
        nomePipeline={nomePipeline}
      />
      {/* Nao e' um "carregar mais": a janela existe para o drawer nao
          serializar a historia inteira, e quem precisa do registro antigo
          precisa dele por inteiro, num lugar que nao seja esta lista. Dizer
          que ha mais e' honesto; fingir que a lista e' completa nao. */}
      {dados.temMaisEventos && (
        <p className="text-xs text-muted-foreground">
          Mostrando os {dados.eventos.length} eventos mais recentes.
        </p>
      )}
    </div>
  )

  return (
    <Drawer
      titulo={lead.nome}
      tituloId={tituloId}
      aoFechar={fechar}
      cabecalho={
        daPipeline && (
          <CabecalhoLead
            lead={lead}
            tituloId={tituloId}
            pipeline={daPipeline.pipeline}
            etapas={daPipeline.etapas}
            etiquetasConhecidas={dados.etiquetasConhecidas}
            gatilhoEtapa={
              <SeletorEtapa
                lead={lead}
                pipelines={dados.pipelines}
                motivos={dados.motivos}
                etiquetasConhecidas={dados.etiquetasConhecidas}
                aoMover={aoMover}
              />
            }
          />
        )
      }
    >
      <Abas
        abas={[
          { id: 'principal', rotulo: 'Principal', conteudo: principal },
          {
            id: 'tarefas',
            rotulo: 'Tarefas',
            conteudo: (
              <PainelTarefas leadId={lead.id} tarefas={dados.tarefas} agora={new Date()} />
            ),
          },
          { id: 'historico', rotulo: 'Histórico', conteudo: historico },
        ]}
      />
    </Drawer>
  )
}
