import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { contextoDoLead } from '@/lib/domain/script'
import { ok } from '@/lib/domain/resultado'
import { criarEtapaStoreDoServidor } from '@/lib/data/etapas'
import type { CrmStore } from '@/lib/data/store'
import { BarraPipelines } from './barra-pipelines'
import { NovaPipeline } from './nova-pipeline'
import { EditarEtapas } from './etapas'
import { Filtros } from './filtros'
import { NovoLead } from './novo-lead'
import { Quadro } from './quadro'
import { hrefDoFunil } from './params'
import { mensagemDeErro } from './erros'
import { carregarDrawer } from './drawer/carregar'
import { mapasDoLead } from './drawer/mapas'
import { DrawerLead } from './drawer/drawer-lead'
import { BlocoScripts } from './drawer/bloco-scripts'
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
  // O lead do drawer sai na MESMA rodada do quadro: ele nao depende de nada
  // que as outras leituras produzem, e em serie a tela pagaria a latencia das
  // duas etapas somadas so' porque a URL trazia `?lead=`.
  const leadParam = params.lead

  const [pipelines, colunas, membros, motivos, etiquetas, resumoEtapas, drawer] = await Promise.all([
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
    leadParam ? carregarDrawer(store, papel, leadParam) : Promise.resolve(ok(null)),
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

  // A MESMA query SEM `lead`. Duas coisas dependem dela:
  //
  // 1. A `key` do Quadro. Se `lead` entrasse nela, abrir o drawer remontaria o
  //    quadro inteiro e as paginas que o "carregar mais" trouxe (estado local)
  //    sumiriam — o usuario clicaria num cartao da terceira pagina e voltaria
  //    a ver so' a primeira atras do painel.
  // 2. Os links da barra de pipelines: trocar de pipeline com um lead aberto
  //    deve fechar o painel, nao carrega-lo por cima de outro funil.
  const semLead = hrefDoFunil(queryAtual, { lead: null })
  const queryDoQuadro = semLead.includes('?') ? semLead.slice(semLead.indexOf('?') + 1) : ''

  // `?lead=` que nao resolve (lead excluido, de outra conta, escondido pela
  // RLS) e' aviso acima do quadro, e nunca 404: o funil ao lado continua
  // valido, e derrubar a tela inteira por um link velho seria trocar um
  // painel que falhou por uma pagina de erro.
  const avisoDoDrawer =
    leadParam === undefined
      ? null
      : !drawer.ok
        ? mensagemDeErro(drawer.erro)
        : drawer.valor === null
          ? mensagemDeErro('lead_nao_encontrado')
          : null

  // Os mapas de nome vem da MESMA funcao que o drawer usa, entao o contexto do
  // script enxerga as etapas de todas as pipelines, nao so' as da atual.
  const dadosDoDrawer = drawer.ok ? drawer.valor : null
  const contextoScript = dadosDoDrawer
    ? (() => {
        const { nomeEtapa, nomePessoa } = mapasDoLead(
          dadosDoDrawer.pipelines,
          dadosDoDrawer.membros,
        )
        return contextoDoLead(dadosDoDrawer.lead, nomeEtapa, nomePessoa)
      })()
    : null

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
          queryAtual={queryDoQuadro}
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
        {avisoDoDrawer && (
          <p
            className="mx-6 mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {avisoDoDrawer}
          </p>
        )}
        {/* key pelos filtros ATIVOS, mas SEM `lead`: o Quadro guarda as
            paginas extras que o "carregar mais" trouxe em estado local, e
            trocar de filtro ou de pipeline invalida todas elas de uma vez. Sem
            a key, as paginas da consulta anterior sobreviveriam a navegacao e
            apareceriam misturadas com o resultado do filtro novo — e com
            `lead` dentro dela, abrir o drawer jogaria fora as mesmas paginas
            sem que nada no quadro tivesse mudado. */}
        <Quadro
          key={`${pipelineId}|${queryDoQuadro}`}
          etapas={pipeline.valor.etapas}
          colunas={colunas.valor}
          membros={membros.valor}
          motivos={motivos.valor}
          etiquetasConhecidas={etiquetas.valor}
          pipelineId={pipelineId}
          filtros={filtros}
          queryAtual={queryAtual}
        />
      </div>
      {dadosDoDrawer && contextoScript && (
        <DrawerLead
          dados={dadosDoDrawer}
          hrefFechar={semLead}
          // Server component dentro de client component, por children: o unico
          // bloco do painel que fala com a rede EXTERNA (o Graph do Meta, para
          // refrescar status de template nao-final) chega streamado, e o resto
          // do drawer pinta na hora. Mesmo arranjo que a ficha usava.
          blocoScripts={
            <Suspense
              fallback={
                <div className="flex flex-col gap-3" aria-busy="true">
                  <p className="eyebrow">Scripts</p>
                  <p className="text-sm text-muted-foreground">Carregando scripts…</p>
                </div>
              }
            >
              <BlocoScripts
                leadId={dadosDoDrawer.lead.id}
                stageId={dadosDoDrawer.lead.stageId}
                contexto={contextoScript}
                telefoneE164={dadosDoDrawer.lead.telefoneE164}
              />
            </Suspense>
          }
        />
      )}
    </div>
  )
}
