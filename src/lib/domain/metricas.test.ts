import { describe, expect, it } from 'vitest'
import type { Etapa } from '@/lib/domain/tipos'
import {
  canaisDaCoorte, etiquetasPorEtapa, funilDaCoorte, interpretarPeriodo, SEM_ANUNCIO, SEM_CAMPANHA,
  type AplicacaoEtiqueta, type LinhaCoorte,
} from './metricas'

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

function aplic(over: Partial<AplicacaoEtiqueta> = {}): AplicacaoEtiqueta {
  return {
    leadId: 'l1', tagId: 't1', tagNome: 'Preço alto',
    stageIdNoMomento: 'e3', ordemNoMomento: 3, ...over,
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

describe('etiquetasPorEtapa', () => {
  it('o denominador de etapa aberta e quem alcancou aquela etapa', () => {
    // E exatamente o numero que o funil mostra naquele degrau — as duas
    // visoes tem que concordar, senao a tela se contradiz.
    const linhas = [
      linha({ leadId: 'a', ordemMax: 3 }),
      linha({ leadId: 'b', ordemMax: 3 }),
      linha({ leadId: 'c', ordemMax: 1 }),
    ]
    const r = etiquetasPorEtapa(linhas, [aplic({ leadId: 'a' })], ETAPAS[2]!)
    expect(r.denominador).toBe(2)
    expect(r.linhas[0]).toMatchObject({ nome: 'Preço alto', leads: 1, percentual: 50 })
  })

  it('em etapa de ganho o denominador e o status, nao a ordem', () => {
    // Ganho tem ordem 6, fora da escala de ordemMax: usar ordem aqui daria
    // denominador zero e todo percentual sumiria.
    const linhas = [
      linha({ leadId: 'a', status: 'ganho', ordemMax: 3 }),
      linha({ leadId: 'b', status: 'aberto', ordemMax: 3 }),
    ]
    const r = etiquetasPorEtapa(
      linhas,
      [aplic({ leadId: 'a', stageIdNoMomento: 'g', ordemNoMomento: 6 })],
      ETAPAS[3]!,
    )
    expect(r.denominador).toBe(1)
    expect(r.linhas[0]?.percentual).toBe(100)
  })

  it('em etapa de perda o denominador e o status perdido', () => {
    const linhas = [
      linha({ leadId: 'a', status: 'perdido', ordemMax: 2 }),
      linha({ leadId: 'b', status: 'perdido', ordemMax: 1 }),
      linha({ leadId: 'c', status: 'ganho', ordemMax: 3 }),
    ]
    const r = etiquetasPorEtapa(
      linhas,
      [aplic({ leadId: 'a', stageIdNoMomento: 'x', ordemNoMomento: 7 })],
      ETAPAS[4]!,
    )
    expect(r.denominador).toBe(2)
    expect(r.linhas[0]?.percentual).toBe(50)
  })

  it('so conta aplicacao congelada NAQUELA etapa', () => {
    const linhas = [linha({ leadId: 'a', ordemMax: 3 })]
    const aplicacoes = [
      aplic({ leadId: 'a', tagId: 't1', tagNome: 'Na proposta', stageIdNoMomento: 'e3' }),
      aplic({ leadId: 'a', tagId: 't2', tagNome: 'No contato', stageIdNoMomento: 'e2' }),
    ]
    const r = etiquetasPorEtapa(linhas, aplicacoes, ETAPAS[2]!)
    expect(r.linhas.map((l) => l.nome)).toEqual(['Na proposta'])
  })

  it('conta lead distinto, nao aplicacao', () => {
    const linhas = [linha({ leadId: 'a', ordemMax: 3 }), linha({ leadId: 'b', ordemMax: 3 })]
    const aplicacoes = [
      aplic({ leadId: 'a', tagId: 't1' }),
      aplic({ leadId: 'b', tagId: 't1' }),
      aplic({ leadId: 'b', tagId: 't2', tagNome: 'Outra' }),
    ]
    const r = etiquetasPorEtapa(linhas, aplicacoes, ETAPAS[2]!)
    expect(r.linhas.find((l) => l.tagId === 't1')?.leads).toBe(2)
  })

  it('empate de contagem desempata por nome, sempre na mesma ordem', () => {
    // Empate de ordenacao ja produziu bug neste repo (backlog #10). Sem
    // desempate, duas cargas da mesma tela trocam as linhas de lugar.
    const linhas = [linha({ leadId: 'a', ordemMax: 3 })]
    const aplicacoes = [
      aplic({ leadId: 'a', tagId: 't2', tagNome: 'Zebra' }),
      aplic({ leadId: 'a', tagId: 't1', tagNome: 'Abacate' }),
    ]
    const r = etiquetasPorEtapa(linhas, aplicacoes, ETAPAS[2]!)
    expect(r.linhas.map((l) => l.nome)).toEqual(['Abacate', 'Zebra'])
  })

  it('denominador zero nao vira NaN', () => {
    const r = etiquetasPorEtapa([], [], ETAPAS[2]!)
    expect(r.denominador).toBe(0)
    expect(r.linhas).toEqual([])
  })

  it('aplicacao de lead fora da coorte e ignorada', () => {
    // Defesa de borda: as duas RPCs usam o mesmo filtro, mas se um dia
    // divergirem o percentual passaria de 100 sem nada reclamar.
    const linhas = [linha({ leadId: 'a', ordemMax: 3 })]
    const r = etiquetasPorEtapa(linhas, [aplic({ leadId: 'forasteiro' })], ETAPAS[2]!)
    expect(r.linhas).toEqual([])
  })
})

describe('canaisDaCoorte', () => {
  it('agrupa por origem, depois campanha, depois anuncio', () => {
    const linhas = [
      linha({ leadId: 'a', origem: 'meta', campanhaId: 'c1', campanhaNome: 'Black', anuncioId: 'a1', anuncioNome: 'Video' }),
      linha({ leadId: 'b', origem: 'google', campanhaId: 'c9' }),
    ]
    const canais = canaisDaCoorte(linhas)
    // 'meta' e 'google' empatam em 1 lead cada; o desempate deterministico
    // por rotulo (localeCompare pt-BR, ascendente — o mesmo criterio provado
    // no teste "ordena por leads decrescente, desempatando por rotulo" logo
    // abaixo) poe 'google' antes de 'meta'. O objetivo deste teste e a
    // hierarquia origem→campanha→anuncio, nao a ordem entre os dois.
    expect(canais.map((c) => c.chave)).toEqual(['google', 'meta'])
    const meta = canais.find((c) => c.chave === 'meta')!
    expect(meta.filhos[0]?.rotulo).toBe('Black')
    expect(meta.filhos[0]?.filhos[0]?.rotulo).toBe('Video')
  })

  it('renomear campanha nao parte o historico: agrupa por id, exibe o nome mais recente', () => {
    // O motivo de existirem pares id/nome. Sem isso, "Black Nov" e
    // "Black Nov v2" virariam duas linhas para a mesma campanha.
    const linhas = [
      linha({ leadId: 'a', campanhaId: 'c1', campanhaNome: 'Black Nov', criadoEm: new Date('2026-07-01T00:00:00Z') }),
      linha({ leadId: 'b', campanhaId: 'c1', campanhaNome: 'Black Nov v2', criadoEm: new Date('2026-07-20T00:00:00Z') }),
    ]
    const campanhas = canaisDaCoorte(linhas)[0]!.filhos
    expect(campanhas).toHaveLength(1)
    expect(campanhas[0]).toMatchObject({ rotulo: 'Black Nov v2', leads: 2, ehId: false })
  })

  it('id sem nome nenhum exibe o id, marcado como id', () => {
    // Caso permanente do Google: o payload traz so numeros, e resolver nome
    // exigiria a Google Ads API. A tela mostra o id rotulado como id, nunca
    // um numero numa coluna chamada "nome".
    const linhas = [linha({ origem: 'google', campanhaId: '123456789', campanhaNome: null })]
    const c = canaisDaCoorte(linhas)[0]!.filhos[0]!
    expect(c).toMatchObject({ rotulo: '123456789', ehId: true })
  })

  it('nome nulo numa linha nao apaga o nome que outra linha do mesmo id trouxe', () => {
    const linhas = [
      linha({ leadId: 'a', campanhaId: 'c1', campanhaNome: 'Black', criadoEm: new Date('2026-07-01T00:00:00Z') }),
      linha({ leadId: 'b', campanhaId: 'c1', campanhaNome: null, criadoEm: new Date('2026-07-20T00:00:00Z') }),
    ]
    const c = canaisDaCoorte(linhas)[0]!.filhos[0]!
    expect(c).toMatchObject({ rotulo: 'Black', ehId: false, leads: 2 })
  })

  it('id nulo vira grupo explicito e continua contando no canal', () => {
    // Estado real: lead manual, e lead do Meta cuja arvore do anuncio falhou.
    // Somir com ele faria a soma dos filhos nao bater com o pai.
    const linhas = [
      linha({ leadId: 'a', origem: 'meta', campanhaId: 'c1' }),
      linha({ leadId: 'b', origem: 'meta', campanhaId: null }),
    ]
    const meta = canaisDaCoorte(linhas)[0]!
    expect(meta.leads).toBe(2)
    expect(meta.filhos.map((f) => f.chave)).toContain(SEM_CAMPANHA)
    expect(meta.filhos.reduce((s, f) => s + f.leads, 0)).toBe(meta.leads)
  })

  it('campanha conhecida com anuncio nulo vira (sem anúncio)', () => {
    const linhas = [linha({ campanhaId: 'c1', anuncioId: null })]
    const campanha = canaisDaCoorte(linhas)[0]!.filhos[0]!
    expect(campanha.filhos.map((f) => f.chave)).toEqual([SEM_ANUNCIO])
  })

  it('taxa de ganho e ganhos sobre leads, com os abertos no denominador', () => {
    const linhas = [
      linha({ leadId: 'a', status: 'ganho' }),
      linha({ leadId: 'b', status: 'perdido' }),
      linha({ leadId: 'c', status: 'aberto' }),
      linha({ leadId: 'd', status: 'aberto' }),
    ]
    const c = canaisDaCoorte(linhas)[0]!
    expect(c).toMatchObject({ leads: 4, ganhos: 1, perdidos: 1, abertos: 2, taxaGanho: 25 })
  })

  it('ordena por leads decrescente, desempatando por rotulo', () => {
    const linhas = [
      linha({ leadId: 'a', origem: 'google' }),
      linha({ leadId: 'b', origem: 'meta' }),
      linha({ leadId: 'c', origem: 'manual' }),
      linha({ leadId: 'd', origem: 'manual' }),
    ]
    expect(canaisDaCoorte(linhas).map((c) => c.chave)).toEqual(['manual', 'google', 'meta'])
  })

  it('coorte vazia devolve lista vazia', () => {
    expect(canaisDaCoorte([])).toEqual([])
  })
})

describe('interpretarPeriodo', () => {
  const AGORA = new Date('2026-08-01T12:00:00Z')

  it('sem parametro nenhum, usa os ultimos 30 dias', () => {
    const r = interpretarPeriodo({}, AGORA)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor.ate).toEqual(AGORA)
    expect(r.valor.de).toEqual(new Date('2026-07-02T12:00:00Z'))
  })

  it('dias=7 recorta sete dias', () => {
    const r = interpretarPeriodo({ dias: '7' }, AGORA)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor.de).toEqual(new Date('2026-07-25T12:00:00Z'))
  })

  it('intervalo customizado vence dias', () => {
    const r = interpretarPeriodo({ dias: '7', de: '2026-01-01', ate: '2026-02-01' }, AGORA)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor.de).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })

  it('de depois de ate e periodo_invalido', () => {
    const r = interpretarPeriodo({ de: '2026-02-01', ate: '2026-01-01' }, AGORA)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('periodo_invalido')
  })

  it('de igual a ate e periodo_invalido: a janela e semiaberta e nao pegaria nada', () => {
    const r = interpretarPeriodo({ de: '2026-01-01', ate: '2026-01-01' }, AGORA)
    expect(r.ok).toBe(false)
  })

  it('dias que nao e numero cai no padrao em vez de estourar', () => {
    // O parametro vem da URL: o usuario pode digitar qualquer coisa.
    const r = interpretarPeriodo({ dias: 'abc' }, AGORA)
    if (!r.ok) throw new Error('deveria ter dado certo')
    expect(r.valor.de).toEqual(new Date('2026-07-02T12:00:00Z'))
  })

  it('data mal formada e periodo_invalido, nunca Invalid Date silencioso', () => {
    const r = interpretarPeriodo({ de: 'ontem', ate: '2026-02-01' }, AGORA)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('deveria ter falhado')
    expect(r.erro).toBe('periodo_invalido')
  })
})
