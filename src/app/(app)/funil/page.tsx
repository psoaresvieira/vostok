import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import type { CrmStore } from '@/lib/data/store'
import type { Lead } from '@/lib/domain/tipos'
import { BarraPipelines } from './barra-pipelines'
import { NovaPipeline } from './nova-pipeline'
import { Filtros } from './filtros'
import { NovoLead } from './novo-lead'
import { Quadro } from './quadro'

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

  const pipelines = await store.listarPipelines()
  if (!pipelines.ok) throw new Error(pipelines.erro)

  const dias = params.dias ? Number(params.dias) : null
  const leads = await store.listarLeads({
    pipelineId: pipeline.valor.pipeline.id,
    responsavelId: params.responsavel ?? null,
    origem: (params.origem as Lead['origem']) || null,
    desde: dias ? new Date(Date.now() - dias * 86_400_000) : null,
    busca: params.busca ?? null,
  })
  if (!leads.ok) throw new Error(leads.erro)

  const membros = await store.membros()
  if (!membros.ok) throw new Error(membros.erro)

  const motivos = await store.motivosPerda()
  if (!motivos.ok) throw new Error(motivos.erro)

  const etiquetas = await store.etiquetasDaConta()
  if (!etiquetas.ok) throw new Error(etiquetas.erro)

  // Serializa os searchParams tal como chegaram (menos undefined, que
  // URLSearchParams nao aceita) — BarraPipelines parte daqui para montar o
  // href de cada item preservando os demais filtros.
  const queryAtual = new URLSearchParams(
    Object.entries(params).filter((par): par is [string, string] => par[1] !== undefined),
  ).toString()

  return (
    <div className="flex flex-1">
      <div className="flex flex-col">
        <BarraPipelines
          pipelines={pipelines.valor}
          pipelineAtivaId={pipeline.valor.pipeline.id}
          queryAtual={queryAtual}
        />
        <div className="border-r border-border p-2">
          <NovaPipeline />
        </div>
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-6 py-3">
          <Filtros membros={membros.valor} podeFiltrarPorResponsavel={papel !== 'vendedor'} />
          <NovoLead
            membros={membros.valor}
            podeEscolherResponsavel={papel !== 'vendedor'}
            pipelineId={pipeline.valor.pipeline.id}
          />
        </div>
        <Quadro
          etapas={pipeline.valor.etapas}
          leads={leads.valor}
          membros={membros.valor}
          motivos={motivos.valor}
          etiquetasConhecidas={etiquetas.valor}
        />
      </div>
    </div>
  )
}
