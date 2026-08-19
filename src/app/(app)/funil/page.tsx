import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarEtapaStoreDoServidor } from '@/lib/data/etapas'
import type { CrmStore } from '@/lib/data/store'
import { BarraPipelines } from './barra-pipelines'
import { NovaPipeline } from './nova-pipeline'
import { EditarEtapas } from './etapas'
import { Filtros } from './filtros'
import { NovoLead } from './novo-lead'
import { Quadro } from './quadro'
import { LIMITE_CARTOES_POR_ETAPA, filtroDoFunil, type FiltrosDaUrl } from './paginacao'

/**
 * Resolve a pipeline ativa a partir de `?pipeline=`. Parametro invalido e'
 * filtro invalido, nao excecao: `pipeline_nao_encontrado` cai em silencio
 * para a padrao (URL copiada de pipeline ja excluida, por exemplo). Qualquer
 * outro erro sobe cru, mesmo padrao do resto da pagina.
 */
async function resolverPipelineAtiva(store: CrmStore, pipelineIdParam: string | undefined) {
  if (!pipelineIdParam) return store.pipelinePadrao()
  const r = await store.pipelinePorId(pipelineIdParam)
  if (!r.ok && r.erro === 'pipeline_nao_encontrado') return store.pipelinePadrao()
  return r
}

export default async function FunilPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const { store, papel } = contexto.valor

  const pipeline = await resolverPipelineAtiva(store, params.pipeline)
  if (!pipeline.ok) throw new Error(pipeline.erro)

  const pipelineId = pipeline.valor.pipeline.id
  const filtros: FiltrosDaUrl = {
    responsavel: params.responsavel,
    origem: params.origem,
    dias: params.dias,
    busca: params.busca,
  }

  // As seis leituras abaixo sao independentes entre si — todas dependem so
  // de `store` e, as duas do funil, do id da pipeline ja resolvido. Em serie
  // (como estavam) a pagina pagava as seis latencias SOMADAS antes de pintar
  // qualquer coisa; em paralelo paga a mais lenta.
  //
  // resumoEtapas() alimenta so o dialogo de exclusao dentro de EditarEtapas
  // com numeros — nao e dado estrutural do funil. Qualquer falha (store ou
  // RPC) degrada para [] em vez de derrubar a pagina inteira: mesmo racional
  // que config/page.tsx aplicava antes de Task 5 (Plano 15) mover as etapas
  // para ca. Por isso ele entra aqui como uma funcao que nunca rejeita, e nao
  // como um Resultado a conferir logo abaixo.
  const [pipelines, colunas, membros, motivos, etiquetas, resumoEtapas] = await Promise.all([
    store.listarPipelines(),
    // Uma pagina por coluna, com total e soma da etapa inteira vindos do
    // banco — nao a pipeline inteira. Ver paginacao.ts.
    store.leadsDoFunil(filtroDoFunil(pipelineId, filtros, LIMITE_CARTOES_POR_ETAPA)),
    store.membros(),
    store.motivosPerda(),
    store.etiquetasDaConta(),
    (async () => {
      const etapaStore = await criarEtapaStoreDoServidor(pipelineId)
      if (!etapaStore.ok) return []
      const resumo = await etapaStore.valor.etapas.resumoEtapas()
      return resumo.ok ? resumo.valor : []
    })(),
  ])
  if (!pipelines.ok) throw new Error(pipelines.erro)
  if (!colunas.ok) throw new Error(colunas.erro)
  if (!membros.ok) throw new Error(membros.erro)
  if (!motivos.ok) throw new Error(motivos.erro)
  if (!etiquetas.ok) throw new Error(etiquetas.erro)

  // Serializa os searchParams tal como chegaram (menos undefined, que
  // URLSearchParams nao aceita) — BarraPipelines parte daqui para montar o
  // href de cada item preservando os demais filtros.
  const queryAtual = new URLSearchParams(
    Object.entries(params).filter((par): par is [string, string] => par[1] !== undefined),
  ).toString()

  return (
    // min-w-0 tambem AQUI, e nao so no <main> e na coluna da direita: este
    // div e' filho flex do <main>, entao sem ele herda min-width:auto e volta
    // a repassar a largura do conteudo para cima — o overflow-x do quadro
    // vazava para a pagina e a janela inteira ganhava scroll lateral.
    <div className="flex min-w-0 flex-1 items-start">
      {/* Coluna de contexto: pipelines + as duas acoes que agem sobre a
          pipeline ativa. `sticky` pelo mesmo motivo da barra lateral global
          (ver layout.tsx) — ela acompanha o scroll vertical das colunas do
          funil em vez de sumir para cima. */}
      <div className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border">
        <BarraPipelines
          pipelines={pipelines.valor}
          pipelineAtivaId={pipelineId}
          queryAtual={queryAtual}
        />
        <div className="mt-auto flex flex-col gap-1 border-t border-border p-2">
          <NovaPipeline />
          <EditarEtapas
            pipelineId={pipelineId}
            etapas={pipeline.valor.etapas}
            resumo={resumoEtapas}
          />
        </div>
      </div>
      {/* min-w-0: mesma armadilha do <main> em layout.tsx — sem isto o
          overflow-x do Quadro empurra a largura desta coluna em vez de rolar
          dentro dela. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <div className="vibrancy sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border px-6 py-3">
          <Filtros membros={membros.valor} podeFiltrarPorResponsavel={papel !== 'vendedor'} />
          <NovoLead
            membros={membros.valor}
            podeEscolherResponsavel={papel !== 'vendedor'}
            pipelineId={pipelineId}
          />
        </div>
        {/* key pelos filtros ATIVOS: o Quadro guarda as paginas extras que o
            "carregar mais" trouxe em estado local, e trocar de filtro ou de
            pipeline invalida todas elas de uma vez. Sem a key, as paginas da
            consulta anterior sobreviveriam a navegacao e apareceriam
            misturadas com o resultado do filtro novo. */}
        <Quadro
          key={`${pipelineId}|${queryAtual}`}
          etapas={pipeline.valor.etapas}
          colunas={colunas.valor}
          membros={membros.valor}
          motivos={motivos.valor}
          etiquetasConhecidas={etiquetas.valor}
          pipelineId={pipelineId}
          filtros={filtros}
        />
      </div>
    </div>
  )
}
