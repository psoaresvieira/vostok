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
