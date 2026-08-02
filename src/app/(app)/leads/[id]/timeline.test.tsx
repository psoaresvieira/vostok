// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { rotuloEvento, Timeline } from './timeline'
import type { EventoLead } from '@/lib/domain/tipos'

// O cleanup automatico do @testing-library/react so se registra quando
// globals: true esta ligado, e este vitest.config nao liga de proposito — o
// repo importa helper de teste explicitamente em todo lugar. Sem o registro
// manual abaixo, o document do jsdom persiste entre os it() deste arquivo e,
// do segundo render() em diante, as consultas acham no velho ou estouram
// "multiple elements found". Todo teste de componente novo copia esta linha.
afterEach(cleanup)

function evento(overrides: Partial<EventoLead> = {}): EventoLead {
  return {
    id: 'evt-1',
    leadId: 'lead-1',
    tipo: 'lead_criado',
    payload: {},
    atorId: null,
    criadoEm: new Date('2026-07-27T10:00:00Z'),
    ...overrides,
  }
}

describe('rotuloEvento', () => {
  it('traduz etapa_alterada usando os dois mapas', () => {
    const nomeEtapa = new Map([
      ['id-a', 'Novo Lead'],
      ['id-b', 'Qualificado'],
    ])
    const nomePessoa = new Map<string, string>()
    const e = evento({
      tipo: 'etapa_alterada',
      payload: { de: 'id-a', para: 'id-b' },
    })

    const resultado = rotuloEvento(e, nomeEtapa, nomePessoa)

    expect(resultado).toContain('Novo Lead')
    expect(resultado).toContain('Qualificado')
  })

  it('cai no default para tipo desconhecido', () => {
    const e = evento({ tipo: 'tarefa_concluida', payload: {} })

    const resultado = rotuloEvento(e, new Map(), new Map())

    expect(resultado).toBe('tarefa_concluida')
  })
})

describe('Timeline', () => {
  it('renderiza o estado vazio quando não há eventos', () => {
    render(<Timeline eventos={[]} nomeEtapa={new Map()} nomePessoa={new Map()} />)

    screen.getByText('Nada aconteceu ainda.')
  })
})
