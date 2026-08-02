import { falha, ok, type Resultado } from '@/lib/domain/resultado'
import type { Etapa, LeadOrigem, LeadStatus } from '@/lib/domain/tipos'

/**
 * Uma linha por lead da coorte, como a RPC metricas_coorte devolve. O unico
 * campo derivado e `ordemMax`: a maior `ordem` entre etapas de tipo 'aberta'
 * que o lead ja ocupou. O SQL o calcula porque em TypeScript isso exigiria
 * trazer o stage_history inteiro; daqui para frente e tudo funcao pura.
 */
export type LinhaCoorte = {
  leadId: string
  criadoEm: Date
  origem: LeadOrigem
  status: LeadStatus
  responsavelId: string | null
  campanhaId: string | null
  campanhaNome: string | null
  conjuntoId: string | null
  conjuntoNome: string | null
  anuncioId: string | null
  anuncioNome: string | null
  /** 0 quando o lead nunca ocupou etapa aberta. */
  ordemMax: number
}

export type DegrauFunil = {
  etapaId: string
  nome: string
  ordem: number
  alcancaram: number
  /** Sobre o degrau anterior. O primeiro degrau e 100 de si mesmo. */
  percentualDoAnterior: number
}

export type Funil = {
  totalDaCoorte: number
  degraus: DegrauFunil[]
  ganhos: number
  perdidos: number
  abertos: number
}

/** Percentual que nunca vira NaN nem Infinity: base zero devolve zero. */
function porcentagem(parte: number, base: number): number {
  return base === 0 ? 0 : (parte / base) * 100
}

export function funilDaCoorte(linhas: LinhaCoorte[], etapas: Etapa[]): Funil {
  // Ganho e Perdido tem ordem MAIOR que toda etapa aberta no pipeline padrao
  // (6 e 7). Sem este filtro, todo lead perdido apareceria como tendo
  // alcancado o fundo do funil.
  // Sort por ordem sem desempate: nao precisa porque stages_ordem_por_pipeline
  // (unico indice na migracao 0002) garante que nenhum pipeline tem duas etapas
  // com a mesma ordem.
  const abertas = etapas.filter((e) => e.tipo === 'aberta').sort((a, b) => a.ordem - b.ordem)

  const degraus: DegrauFunil[] = []
  let anterior = 0
  for (const [i, etapa] of abertas.entries()) {
    const alcancaram = linhas.filter((l) => l.ordemMax >= etapa.ordem).length
    degraus.push({
      etapaId: etapa.id,
      nome: etapa.nome,
      ordem: etapa.ordem,
      percentualDoAnterior: i === 0 ? 100 : porcentagem(alcancaram, anterior),
      alcancaram,
    })
    anterior = alcancaram
  }

  return {
    totalDaCoorte: linhas.length,
    degraus,
    ganhos: linhas.filter((l) => l.status === 'ganho').length,
    perdidos: linhas.filter((l) => l.status === 'perdido').length,
    abertos: linhas.filter((l) => l.status === 'aberto').length,
  }
}

export type AplicacaoEtiqueta = {
  leadId: string
  tagId: string
  tagNome: string
  stageIdNoMomento: string
  ordemNoMomento: number
}

export type LinhaEtiqueta = { tagId: string; nome: string; leads: number; percentual: number }

export type RankingEtiquetas = { etapaId: string; denominador: number; linhas: LinhaEtiqueta[] }

/**
 * Quantos leads da coorte "chegaram" nesta etapa. Para etapa aberta e a mesma
 * profundidade que o funil usa — as duas visoes tem que dar o mesmo numero.
 * Para Ganho e Perdido, ordem nao serve (elas estao fora da escala de
 * ordemMax): quem chegou la e quem terminou naquele status.
 */
function chegaramNaEtapa(linhas: LinhaCoorte[], etapa: Etapa): LinhaCoorte[] {
  if (etapa.tipo === 'ganho') return linhas.filter((l) => l.status === 'ganho')
  if (etapa.tipo === 'perdido') return linhas.filter((l) => l.status === 'perdido')
  return linhas.filter((l) => l.ordemMax >= etapa.ordem)
}

export function etiquetasPorEtapa(
  linhas: LinhaCoorte[],
  aplicacoes: AplicacaoEtiqueta[],
  etapa: Etapa,
): RankingEtiquetas {
  const naCoorte = new Set(linhas.map((l) => l.leadId))
  const chegaram = chegaramNaEtapa(linhas, etapa)
  const denominador = chegaram.length

  // Set por tag: a mesma pessoa nao pode contar duas vezes. Hoje a PK de
  // lead_tags ja impede aplicacao repetida, mas o numero que a tela mostra e
  // "quantos LEADS", e essa frase nao pode depender daquela constraint.
  const leadsPorTag = new Map<string, { nome: string; leads: Set<string> }>()
  for (const a of aplicacoes) {
    if (a.stageIdNoMomento !== etapa.id) continue
    if (!naCoorte.has(a.leadId)) continue
    const atual = leadsPorTag.get(a.tagId) ?? { nome: a.tagNome, leads: new Set<string>() }
    atual.leads.add(a.leadId)
    leadsPorTag.set(a.tagId, atual)
  }

  const linhasRanking: LinhaEtiqueta[] = [...leadsPorTag.entries()].map(([tagId, v]) => ({
    tagId,
    nome: v.nome,
    leads: v.leads.size,
    percentual: porcentagem(v.leads.size, denominador),
  }))
  // Desempate por nome: sem ele, duas cargas da mesma tela podem trocar as
  // linhas de lugar (backlog #10 foi exatamente essa classe).
  linhasRanking.sort((a, b) => b.leads - a.leads || a.nome.localeCompare(b.nome, 'pt-BR'))

  return { etapaId: etapa.id, denominador, linhas: linhasRanking }
}

export const SEM_CAMPANHA = '(sem campanha)'
export const SEM_ANUNCIO = '(sem anúncio)'

export type NoCanal = {
  chave: string
  rotulo: string
  /** true quando nao ha nome conhecido e o rotulo e o id cru — a tela marca. */
  ehId: boolean
  leads: number
  ganhos: number
  perdidos: number
  abertos: number
  taxaGanho: number
  filhos: NoCanal[]
}

/** Nome do lead mais recente que trouxe um nome para este id. Linha sem nome
 * nao apaga o nome que outra trouxe, e renomear no gerenciador do Meta so
 * troca o rotulo — nunca parte o grupo em dois. */
function rotuloMaisRecente(linhas: LinhaCoorte[], nomeDe: (l: LinhaCoorte) => string | null) {
  let escolhido: { nome: string; em: Date } | null = null
  for (const l of linhas) {
    const nome = nomeDe(l)
    if (!nome) continue
    if (!escolhido || l.criadoEm > escolhido.em) escolhido = { nome, em: l.criadoEm }
  }
  return escolhido?.nome ?? null
}

function agrupar(
  linhas: LinhaCoorte[],
  idDe: (l: LinhaCoorte) => string | null,
  nomeDe: (l: LinhaCoorte) => string | null,
  sentinela: string,
  filhosDe: (grupo: LinhaCoorte[]) => NoCanal[],
): NoCanal[] {
  const grupos = new Map<string, LinhaCoorte[]>()
  for (const l of linhas) {
    const chave = idDe(l) ?? sentinela
    grupos.set(chave, [...(grupos.get(chave) ?? []), l])
  }

  const nos = [...grupos.entries()].map(([chave, grupo]) => {
    const nome = chave === sentinela ? null : rotuloMaisRecente(grupo, nomeDe)
    const ganhos = grupo.filter((l) => l.status === 'ganho').length
    return {
      chave,
      rotulo: nome ?? chave,
      ehId: chave !== sentinela && nome === null,
      leads: grupo.length,
      ganhos,
      perdidos: grupo.filter((l) => l.status === 'perdido').length,
      abertos: grupo.filter((l) => l.status === 'aberto').length,
      taxaGanho: porcentagem(ganhos, grupo.length),
      filhos: filhosDe(grupo),
    }
  })
  nos.sort((a, b) => b.leads - a.leads || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  return nos
}

const DIAS_PADRAO = 30

/**
 * Traduz os parametros da URL em janela de coorte. Puro, com o relogio
 * injetado, porque a tela precisa dele testado sem subir servidor — e porque
 * `new Date('ontem')` devolve Invalid Date sem lancar, e uma janela invalida
 * chegaria no banco como null.
 */
export function interpretarPeriodo(
  params: { dias?: string; de?: string; ate?: string },
  agora: Date,
): Resultado<{ de: Date; ate: Date }> {
  if (params.de || params.ate) {
    const de = new Date(params.de ?? '')
    const ate = new Date(params.ate ?? '')
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) return falha('periodo_invalido')
    // Janela semiaberta: de === ate nao pegaria lead nenhum, e a tela ficaria
    // vazia sem dizer por que.
    if (de >= ate) return falha('periodo_invalido')
    return ok({ de, ate })
  }

  const dias = Number(params.dias)
  const efetivos = Number.isFinite(dias) && dias > 0 ? dias : DIAS_PADRAO
  return ok({ de: new Date(agora.getTime() - efetivos * 86_400_000), ate: agora })
}

/**
 * Monta a query string do link de troca de etapa a partir dos parametros
 * atuais da URL (dias/de/ate/responsavel/etapa), trocando so `etapa` — o
 * resto sobrevive ao clique. URLSearchParams em vez de concatenar string a
 * mao: um valor com caractere especial (ex.: id de responsavel) nao corrompe
 * a URL, e set() troca uma `etapa` ja presente em vez de duplicar a chave.
 */
export function urlComEtapa(
  paramsAtuais: Record<string, string | undefined>,
  etapaId: string,
): string {
  const novos = new URLSearchParams()
  for (const [chave, valor] of Object.entries(paramsAtuais)) {
    if (valor !== undefined) novos.set(chave, valor)
  }
  novos.set('etapa', etapaId)
  return `/metricas?${novos.toString()}`
}

export function canaisDaCoorte(linhas: LinhaCoorte[]): NoCanal[] {
  return agrupar(
    linhas,
    (l) => l.origem,
    (l) => l.origem,
    // Origem e enum not null: a sentinela nunca e alcancada neste nivel.
    '(sem origem)',
    (doCanal) =>
      agrupar(
        doCanal,
        (l) => l.campanhaId,
        (l) => l.campanhaNome,
        SEM_CAMPANHA,
        (daCampanha) =>
          agrupar(daCampanha, (l) => l.anuncioId, (l) => l.anuncioNome, SEM_ANUNCIO, () => []),
      ),
  )
}
