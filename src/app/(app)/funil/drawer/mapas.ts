import type { Etapa, Membro, Pipeline } from '@/lib/domain/tipos'

/**
 * Os tres mapas de id → nome que a timeline e o contexto de script do lead
 * consomem.
 *
 * `nomeEtapa` cobre as etapas de TODAS as pipelines da conta, e nao so' as da
 * pipeline atual do lead. A ficha antiga montava esse mapa a partir de uma
 * pipeline so', e por isso todo evento `pipeline_alterada` exibia "etapa
 * removida" no lugar da etapa de ORIGEM — que existe, viva, na pipeline de
 * onde o lead saiu.
 *
 * Puro e sem dependencia de servidor de proposito: o drawer (componente de
 * cliente) e a pagina (servidor) montam os mesmos mapas pela mesma funcao.
 */
export function mapasDoLead(
  pipelines: { pipeline: Pipeline; etapas: Etapa[] }[],
  membros: Membro[],
): {
  nomeEtapa: Map<string, string>
  nomePessoa: Map<string, string>
  nomePipeline: Map<string, string>
} {
  return {
    nomeEtapa: new Map(pipelines.flatMap((p) => p.etapas.map((e) => [e.id, e.nome] as const))),
    nomePessoa: new Map(membros.map((m) => [m.id, m.nome])),
    nomePipeline: new Map(pipelines.map((p) => [p.pipeline.id, p.pipeline.nome])),
  }
}
