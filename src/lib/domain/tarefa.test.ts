import { describe, it, expect } from 'vitest'
import { FUSO_PADRAO, classificar, instanteDeDatetimeLocal } from './tarefa'

describe('classificar', () => {
  it('um milissegundo antes de agora e atrasada', () => {
    const agora = new Date('2026-08-02T12:00:00-03:00')
    const venceEm = new Date(agora.getTime() - 1)
    expect(classificar(venceEm, agora, FUSO_PADRAO)).toBe('atrasada')
  })

  it('hoje mais tarde e hoje; hoje mais cedo e atrasada, mesmo dia civil', () => {
    const agora = new Date('2026-08-02T12:00:00-03:00')
    const maisTarde = new Date('2026-08-02T18:00:00-03:00')
    const maisCedo = new Date('2026-08-02T08:00:00-03:00')
    expect(classificar(maisTarde, agora, FUSO_PADRAO)).toBe('hoje')
    expect(classificar(maisCedo, agora, FUSO_PADRAO)).toBe('atrasada')
  })

  it('caso que so o fuso resolve: mesmo dia em UTC, dias civis diferentes em America/Sao_Paulo', () => {
    // agora = 2026-08-03T02:00:00Z = 2026-08-02T23:00:00-03:00 (dia 2)
    // venceEm = 2026-08-03T03:00:00Z = 2026-08-03T00:00:00-03:00 (dia 3, meia-noite)
    // Em UTC os dois caem no dia 3; no fuso do produto sao dias civis diferentes.
    const agora = new Date('2026-08-03T02:00:00Z')
    const venceEm = new Date('2026-08-03T03:00:00Z')
    expect(classificar(venceEm, agora, FUSO_PADRAO)).toBe('proximos7')
  })

  it('vinte e tres horas e meia de distancia pode ser proximos7', () => {
    // agora 23h30 no fuso, venceEm no dia seguinte as 23h00: menos de 24h de
    // diferenca, mas dias civis diferentes.
    const agora = new Date('2026-08-02T23:30:00-03:00')
    const venceEm = new Date('2026-08-03T23:00:00-03:00')
    expect(classificar(venceEm, agora, FUSO_PADRAO)).toBe('proximos7')
  })

  it('fronteira dos sete dias: amanha+6 e proximos7, amanha+7 e depois', () => {
    const agora = new Date('2026-08-02T12:00:00-03:00')
    const amanhaMais6 = new Date('2026-08-09T12:00:00-03:00')
    const amanhaMais7 = new Date('2026-08-10T12:00:00-03:00')
    expect(classificar(amanhaMais6, agora, FUSO_PADRAO)).toBe('proximos7')
    expect(classificar(amanhaMais7, agora, FUSO_PADRAO)).toBe('depois')
  })
})

describe('instanteDeDatetimeLocal', () => {
  it('caso que so o fuso resolve: a mesma string naive vira instantes diferentes em fusos diferentes', () => {
    // Este e o caso que fica vermelho se a implementacao usar
    // `new Date(naive)` cru: sem aplicar o fuso, as duas chamadas devolveriam
    // o MESMO instante (o do fuso da maquina que roda o teste), e uma
    // maquina em qualquer fuso derruba pelo menos uma das duas asserções.
    const naive = '2026-08-10T14:30'
    expect(instanteDeDatetimeLocal(naive, 'America/Sao_Paulo')).toBe('2026-08-10T17:30:00.000Z')
    expect(instanteDeDatetimeLocal(naive, 'America/Manaus')).toBe('2026-08-10T18:30:00.000Z')
  })

  it('faz round-trip: reformatado no mesmo fuso, devolve a hora digitada', () => {
    const iso = instanteDeDatetimeLocal('2026-01-05T09:07', FUSO_PADRAO)
    expect(iso).not.toBeNull()
    const devolta = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_PADRAO,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso!))
    expect(devolta).toBe('09:07')
  })

  it('respeita horario de verao do fuso pedido, nao um deslocamento fixo', () => {
    // 2026-03-08 e a virada para EDT em New York (UTC-5 -> UTC-4). Meio-dia
    // depois da virada e 16:00Z; um deslocamento fixo de -5h daria 17:00Z.
    expect(instanteDeDatetimeLocal('2026-03-08T12:00', 'America/New_York')).toBe(
      '2026-03-08T16:00:00.000Z',
    )
    expect(instanteDeDatetimeLocal('2026-01-08T12:00', 'America/New_York')).toBe(
      '2026-01-08T17:00:00.000Z',
    )
  })

  it('entrada vazia devolve null, sem lancar', () => {
    expect(instanteDeDatetimeLocal('', FUSO_PADRAO)).toBeNull()
    expect(instanteDeDatetimeLocal('   ', FUSO_PADRAO)).toBeNull()
  })

  it('entrada malformada devolve null, sem lancar', () => {
    // Nunca lancar e o ponto: o chamador e componente cliente, e um
    // RangeError na construcao do argumento cai fora do try do chamarAcao.
    expect(instanteDeDatetimeLocal('nao e data', FUSO_PADRAO)).toBeNull()
    expect(instanteDeDatetimeLocal('2026-08-10', FUSO_PADRAO)).toBeNull()
    // Formato certo, calendario errado: Date.UTC transbordaria em silencio.
    expect(instanteDeDatetimeLocal('2026-02-31T10:00', FUSO_PADRAO)).toBeNull()
    expect(instanteDeDatetimeLocal('2026-08-10T10:99', FUSO_PADRAO)).toBeNull()
    expect(instanteDeDatetimeLocal('2026-13-10T10:00', FUSO_PADRAO)).toBeNull()
    // Segundo fora de faixa transborda em silencio como os demais campos:
    // ':99' viraria +1min39s se so ano/mes/dia/hora/minuto fossem conferidos.
    expect(instanteDeDatetimeLocal('2026-08-10T10:00:99', FUSO_PADRAO)).toBeNull()
  })
})
