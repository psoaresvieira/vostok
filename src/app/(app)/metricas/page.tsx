import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import {
  canaisDaCoorte, etiquetasPorEtapa, funilDaCoorte, interpretarPeriodo,
} from '@/lib/domain/metricas'
import { Canais } from './canais'
import { Etiquetas } from './etiquetas'
import { Funil } from './funil'
import { Filtros } from './filtros'

// Mapa local, e nao reuso de funil/erros.ts: aquele modulo cobre os codigos
// das Server Actions do funil (nome_obrigatorio, ordem_invalida etc, a
// maioria irrelevante aqui) e seus fallbacks devolvem o codigo cru quando nao
// encontram traducao — o oposto do que esta tela exige (nunca mostrar texto
// cru na tela). A frase de pipeline_nao_encontrado abaixo e' PROPRIA desta
// tela, nao copiada: a de funil/erros.ts diz "recarregue a pagina", que aqui
// nao resolve nada — nao "deduplicar" sem notar que os textos divergem de
// proposito.
const MENSAGENS: Record<string, string> = {
  periodo_invalido: 'O período escolhido é inválido: a data inicial tem que vir antes da final.',
  // pipelinePadrao() (supabase.ts, memory.ts, admin.ts) so devolve este
  // codigo — pipeline_invalido nunca existiu do lado do backend.
  pipeline_nao_encontrado: 'Não encontramos o funil da sua conta.',
}

/** Mensagem crua do PostgREST nao chega na tela: o backlog aponta ~30 sitios
 * com esse vazamento, e esta tela nasce certa. */
function mensagem(erro: string): string {
  return MENSAGENS[erro] ?? 'Não foi possível carregar as métricas agora. Tente de novo.'
}

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  const { store, papel } = contexto.valor

  const periodo = interpretarPeriodo(params, new Date())
  if (!periodo.ok) {
    return <p className="p-6 text-destructive">{mensagem(periodo.erro)}</p>
  }

  // Independentes entre si: em serie a tela pagava as duas latencias somadas
  // antes de chegar nas metricas, que sao a parte cara.
  const [pipeline, membros] = await Promise.all([store.pipelinePadrao(), store.membros()])
  if (!pipeline.ok) return <p className="p-6 text-destructive">{mensagem(pipeline.erro)}</p>
  if (!membros.ok) return <p className="p-6 text-destructive">{mensagem(membros.erro)}</p>
  const { etapas } = pipeline.valor

  const filtro = {
    pipelineId: pipeline.valor.pipeline.id,
    de: periodo.valor.de,
    ate: periodo.valor.ate,
    // Vendedor nunca escolhe: a RLS ja o recorta, e oferecer o seletor daria
    // a impressao de que ele poderia ver outra pessoa.
    responsavelId: papel === 'vendedor' ? null : (params.responsavel ?? null),
  }

  const [coorte, aplicacoes] = await Promise.all([
    store.metricasDaCoorte(filtro),
    store.etiquetasDaCoorte(filtro),
  ])
  // Pipeline e membros ja carregaram com sucesso aqui, entao ha o suficiente
  // pra desenhar os filtros: renderiza-los acima do erro deixa o usuario
  // corrigir o periodo/responsavel no lugar, em vez de so poder usar o Voltar
  // do navegador. Os erros ANTES deste ponto (periodo_invalido, pipeline e
  // membros) nao tem isso: ou faltam os dados que Filtros exige (membros), ou
  // o problema e o proprio parametro que os filtros ofereceriam de novo.
  if (!coorte.ok) {
    return (
      <div className="fade-in flex flex-col gap-6 p-6 sm:p-8">
        <Filtros membros={membros.valor} podeFiltrarPorResponsavel={papel !== 'vendedor'} />
        <p className="text-destructive">{mensagem(coorte.erro)}</p>
      </div>
    )
  }
  if (!aplicacoes.ok) {
    return (
      <div className="fade-in flex flex-col gap-6 p-6 sm:p-8">
        <Filtros membros={membros.valor} podeFiltrarPorResponsavel={papel !== 'vendedor'} />
        <p className="text-destructive">{mensagem(aplicacoes.erro)}</p>
      </div>
    )
  }

  const funil = funilDaCoorte(coorte.valor, etapas)
  const etapaEscolhida = etapas.find((e) => e.id === params.etapa) ?? etapas[0]!
  const ranking = etiquetasPorEtapa(coorte.valor, aplicacoes.valor, etapaEscolhida)
  const canais = canaisDaCoorte(coorte.valor)

  return (
    <div className="fade-in flex flex-col gap-6 p-6 sm:p-8">
      <Filtros
        membros={membros.valor}
        podeFiltrarPorResponsavel={papel !== 'vendedor'}
      />
      {funil.totalDaCoorte === 0 ? (
        <p className="surface rounded-lg p-6 text-muted-foreground">
          Nenhum lead entrou nesse período. Conecte uma fonte em Configuração ou
          cadastre um lead no funil — as métricas aparecem no mesmo instante.
        </p>
      ) : (
        <>
          {/* Trackeamento primeiro (Plano 13): a pergunta "de onde vieram os
              leads" abre a tela, antes do funil e das etiquetas. */}
          <Canais raizes={canais} />
          <Funil funil={funil} />
          {/* params completo, nao so `etapa`: o seletor de etapa precisa dos
              demais filtros (dias/de/ate/responsavel) para preserva-los ao
              trocar de etapa — ver urlComEtapa em lib/domain/metricas.ts. */}
          <Etiquetas ranking={ranking} etapas={etapas} escolhida={etapaEscolhida} params={params} />
        </>
      )}
    </div>
  )
}
