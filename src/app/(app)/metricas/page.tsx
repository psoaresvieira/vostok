import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import {
  canaisDaCoorte, etiquetasPorEtapa, funilDaCoorte, interpretarPeriodo,
} from '@/lib/domain/metricas'
import { Canais } from './canais'
import { Etiquetas } from './etiquetas'
import { Funil } from './funil'
import { Filtros } from './filtros'

const MENSAGENS: Record<string, string> = {
  periodo_invalido: 'O período escolhido é inválido: a data inicial tem que vir antes da final.',
  pipeline_invalido: 'Esse funil não existe nesta conta.',
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

  const pipeline = await store.pipelinePadrao()
  if (!pipeline.ok) return <p className="p-6 text-destructive">{mensagem(pipeline.erro)}</p>
  const { etapas } = pipeline.valor

  const membros = await store.membros()
  if (!membros.ok) return <p className="p-6 text-destructive">{mensagem(membros.erro)}</p>

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
  if (!coorte.ok) return <p className="p-6 text-destructive">{mensagem(coorte.erro)}</p>
  if (!aplicacoes.ok) return <p className="p-6 text-destructive">{mensagem(aplicacoes.erro)}</p>

  const funil = funilDaCoorte(coorte.valor, etapas)
  const etapaEscolhida = etapas.find((e) => e.id === params.etapa) ?? etapas[0]!
  const ranking = etiquetasPorEtapa(coorte.valor, aplicacoes.valor, etapaEscolhida)
  const canais = canaisDaCoorte(coorte.valor)

  return (
    <div className="flex flex-col gap-6 p-6">
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
          <Funil funil={funil} />
          <Etiquetas ranking={ranking} etapas={etapas} escolhida={etapaEscolhida} />
          <Canais raizes={canais} />
        </>
      )}
    </div>
  )
}
