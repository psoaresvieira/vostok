import { describe, expect, it } from 'vitest'
import type { Etapa } from '@/lib/domain/tipos'
import { funilDaCoorte, type LinhaCoorte } from './metricas'

const ETAPAS: Etapa[] = [
  { id: 'e1', pipelineId: 'p', nome: 'Novo lead', ordem: 1, tipo: 'aberta', slaHoras: null },
  { id: 'e2', pipelineId: 'p', nome: 'Contato feito', ordem: 2, tipo: 'aberta', slaHoras: null },
  { id: 'e3', pipelineId: 'p', nome: 'Proposta', ordem: 3, tipo: 'aberta', slaHoras: null },
  { id: 'g', pipelineId: 'p', nome: 'Ganho', ordem: 6, tipo: 'ganho', slaHoras: null },
  { id: 'x', pipelineId: 'p', nome: 'Perdido', ordem: 7, tipo: 'perdido', slaHoras: null },
]

function linha(over: Partial<LinhaCoorte> = {}): LinhaCoorte {
  return {
    leadId: 'l1',
    criadoEm: new Date('2026-07-01T00:00:00Z'),
    origem: 'meta',
    status: 'aberto',
    responsavelId: null,
    campanhaId: null,
    campanhaNome: null,
    conjuntoId: null,
    conjuntoNome: null,
    anuncioId: null,
    anuncioNome: null,
    ordemMax: 1,
    ...over,
  }
}

describe('funilDaCoorte', () => {
  it('so monta degrau para etapa aberta — Ganho e Perdido saem da escala', () => {
    // Ganho tem ordem 6 e Perdido 7, MAIORES que toda etapa aberta. Se
    // entrassem na escala, todo lead perdido apareceria como tendo alcancado
    // o fundo do funil.
    const f = funilDaCoorte([linha()], ETAPAS)
    expect(f.degraus.map((d) => d.etapaId)).toEqual(['e1', 'e2', 'e3'])
  })

  it('lead que pulou etapa conta nos degraus que pulou', () => {
    // Arrastar de Novo lead direto para Proposta poe ordemMax em 3. O lead
    // atravessou o funil ate ali, e a etapa pulada nao pode parecer morta.
    const f = funilDaCoorte([linha({ ordemMax: 3 })], ETAPAS)
    expect(f.degraus.map((d) => d.alcancaram)).toEqual([1, 1, 1])
  })

  // "Lead que voltou de etapa" NAO tem teste aqui, e nao e esquecimento:
  // LinhaCoorte carrega so ordemMax, o maximo ja alcancado, entao pular para
  // frente e voltar depois sao a MESMA entrada nesta camada. Quem discrimina
  // os dois e o teste de integracao da RPC, onde a uniao sobre stage_origem e
  // stage_destino e o que faz o trabalho.

  it('lead que parou no degrau 2 nao aparece no 3', () => {
    const f = funilDaCoorte([linha({ ordemMax: 2 })], ETAPAS)
    expect(f.degraus.map((d) => d.alcancaram)).toEqual([1, 1, 0])
  })

  it('percentual e sobre o degrau anterior, e o primeiro e 100 de si mesmo', () => {
    const linhas = [
      linha({ leadId: 'a', ordemMax: 3 }),
      linha({ leadId: 'b', ordemMax: 2 }),
      linha({ leadId: 'c', ordemMax: 2 }),
      linha({ leadId: 'd', ordemMax: 1 }),
    ]
    const f = funilDaCoorte(linhas, ETAPAS)
    expect(f.degraus.map((d) => d.alcancaram)).toEqual([4, 3, 1])
    expect(f.degraus.map((d) => Math.round(d.percentualDoAnterior))).toEqual([100, 75, 33])
  })

  it('degrau anterior zerado nao vira NaN nem Infinity', () => {
    // Coorte inteira com ordemMax 0: dividir por zero produziria NaN, que a
    // UI renderizaria como "NaN%" sem nenhum teste reclamar.
    const f = funilDaCoorte([linha({ ordemMax: 0 })], ETAPAS)
    expect(f.degraus.map((d) => d.percentualDoAnterior)).toEqual([100, 0, 0])
    expect(f.degraus.every((d) => Number.isFinite(d.percentualDoAnterior))).toBe(true)
  })

  it('ordemMax 0 entra no total da coorte e em nenhum degrau', () => {
    // Estado de um lead criado direto em Ganho ou Perdido: nunca ocupou etapa
    // aberta. Some do funil, mas nao pode sumir da contagem da coorte.
    const f = funilDaCoorte([linha({ ordemMax: 0, status: 'perdido' })], ETAPAS)
    expect(f.totalDaCoorte).toBe(1)
    expect(f.degraus[0]?.alcancaram).toBe(0)
  })

  it('os desfechos saem de status, nao da etapa', () => {
    const linhas = [
      linha({ leadId: 'a', status: 'ganho', ordemMax: 3 }),
      linha({ leadId: 'b', status: 'perdido', ordemMax: 2 }),
      linha({ leadId: 'c', status: 'aberto', ordemMax: 1 }),
    ]
    const f = funilDaCoorte(linhas, ETAPAS)
    expect({ g: f.ganhos, p: f.perdidos, a: f.abertos }).toEqual({ g: 1, p: 1, a: 1 })
  })

  it('etapas fora de ordem no argumento saem ordenadas por ordem', () => {
    // pipelinePadrao() ordena hoje, mas o funil nao pode depender disso: uma
    // etapa reordenada pelo admin trocaria o sentido do funil em silencio.
    const embaralhadas = [ETAPAS[2]!, ETAPAS[0]!, ETAPAS[1]!]
    const f = funilDaCoorte([linha({ ordemMax: 3 })], embaralhadas)
    expect(f.degraus.map((d) => d.ordem)).toEqual([1, 2, 3])
  })

  it('coorte vazia devolve degraus zerados, nao lista vazia', () => {
    // A tela precisa desenhar o funil do pipeline mesmo sem lead nenhum,
    // senao conta nova mostra uma area em branco sem explicacao.
    const f = funilDaCoorte([], ETAPAS)
    expect(f.totalDaCoorte).toBe(0)
    expect(f.degraus).toHaveLength(3)
    expect(f.degraus.every((d) => d.alcancaram === 0)).toBe(true)
  })
})
