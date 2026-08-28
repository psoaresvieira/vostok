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

    const resultado = rotuloEvento(e, nomeEtapa, nomePessoa, new Map())

    expect(resultado).toContain('Novo Lead')
    expect(resultado).toContain('Qualificado')
  })

  it('traduz etiqueta_removida com o nome da etiqueta do payload', () => {
    const e = evento({ tipo: 'etiqueta_removida', payload: { tag: 'Preço alto' } })

    const resultado = rotuloEvento(e, new Map(), new Map(), new Map())

    expect(resultado).toBe('Etiqueta "Preço alto" removida')
  })

  it('traduz tarefa_concluida lendo o titulo do payload', () => {
    // O payload guarda o titulo como snapshot de proposito: a tarefa pode ser
    // excluida depois e a historia do lead nao pode apontar para o vazio.
    const e = evento({
      tipo: 'tarefa_concluida',
      payload: { titulo: 'Ligar para confirmar reuniao', tipo: 'ligacao' },
    })

    const resultado = rotuloEvento(e, new Map(), new Map(), new Map())

    expect(resultado).toBe('Tarefa concluída: Ligar para confirmar reuniao')
  })

  it('tarefa_concluida sem titulo no payload cai no fallback, nao em undefined', () => {
    // lead_events e append-only e o payload e jsonb livre: linha antiga ou
    // gravada por outro caminho pode nao ter titulo. A timeline mostra '?',
    // nunca 'undefined' nem quebra.
    const e = evento({ tipo: 'tarefa_concluida', payload: {} })

    const resultado = rotuloEvento(e, new Map(), new Map(), new Map())

    expect(resultado).toBe('Tarefa concluída: ?')
  })

  it('caso 8: traduz whatsapp_enviado com o texto do payload — o snapshot do que foi enviado', () => {
    // O texto e' snapshot pelo mesmo motivo do titulo de tarefa_concluida, com
    // uma razao a mais: o script pode ser editado (e o template re-submetido)
    // depois do envio, e a linha do tempo tem que continuar mostrando o que o
    // cliente REALMENTE recebeu, nao o que o script diz hoje.
    const e = evento({
      tipo: 'whatsapp_enviado',
      payload: {
        template: 'abordagem_inicial_aaaaaaaa',
        texto: 'Olá Maria, tudo bem na Loja da Maria?',
      },
    })

    const resultado = rotuloEvento(e, new Map(), new Map(), new Map())

    expect(resultado).toBe('WhatsApp enviado: Olá Maria, tudo bem na Loja da Maria?')
  })

  it('whatsapp_enviado sem texto no payload cai no fallback, nao em undefined', () => {
    // lead_events e append-only e o payload e jsonb livre: linha gravada por
    // outro caminho pode nao ter texto.
    const e = evento({ tipo: 'whatsapp_enviado', payload: {} })

    expect(rotuloEvento(e, new Map(), new Map(), new Map())).toBe('WhatsApp enviado: ?')
  })

  it('traduz pipeline_alterada nomeando as duas pipelines e as duas etapas', () => {
    const nomeEtapa = new Map([
      ['etapa-origem', 'Qualificação'],
      ['etapa-destino', 'Onboarding'],
    ])
    const nomePipeline = new Map([
      ['pipe-comercial', 'Comercial'],
      ['pipe-pos', 'Pós-venda'],
    ])
    const e = evento({
      tipo: 'pipeline_alterada',
      payload: {
        de_pipeline: 'pipe-comercial',
        para_pipeline: 'pipe-pos',
        de: 'etapa-origem',
        para: 'etapa-destino',
        loss_reason_id: null,
      },
    })

    const resultado = rotuloEvento(e, nomeEtapa, new Map(), nomePipeline)

    expect(resultado).toBe('Movido de Comercial · Qualificação para Pós-venda · Onboarding')
  })

  it('pipeline_alterada com a etapa de origem ja apagada nao mostra undefined', () => {
    // lead_events e append-only: a etapa de onde o lead saiu pode ter sido
    // excluida depois, e a ficha so' carrega os nomes da pipeline ATUAL do
    // lead — o nome da etapa antiga costuma faltar mesmo com ela viva.
    const e = evento({
      tipo: 'pipeline_alterada',
      payload: {
        de_pipeline: 'pipe-comercial',
        para_pipeline: 'pipe-pos',
        de: 'etapa-sumida',
        para: 'etapa-destino',
      },
    })

    const resultado = rotuloEvento(
      e,
      new Map([['etapa-destino', 'Onboarding']]),
      new Map(),
      new Map([['pipe-pos', 'Pós-venda']]),
    )

    expect(resultado).toBe('Movido de ? · etapa removida para Pós-venda · Onboarding')
  })

  it('cai no default para tipo desconhecido', () => {
    // 'tarefa_concluida' ganhou case proprio na Task 5 — trocado por um tipo
    // que continua nao existindo, preservando a intencao original do teste:
    // provar que o default protege a timeline de tipos futuros.
    const e = evento({ tipo: 'tipo_que_nao_existe', payload: {} })

    const resultado = rotuloEvento(e, new Map(), new Map(), new Map())

    expect(resultado).toBe('tipo_que_nao_existe')
  })
})

describe('Timeline', () => {
  it('renderiza o estado vazio quando não há eventos', () => {
    render(
      <Timeline
        eventos={[]}
        nomeEtapa={new Map()}
        nomePessoa={new Map()}
        nomePipeline={new Map()}
      />,
    )

    screen.getByText('Nada aconteceu ainda.')
  })

  it('repassa nomePipeline para o rotulo de pipeline_alterada', () => {
    render(
      <Timeline
        eventos={[
          evento({
            tipo: 'pipeline_alterada',
            payload: {
              de_pipeline: 'pipe-comercial',
              para_pipeline: 'pipe-pos',
              de: 'etapa-origem',
              para: 'etapa-destino',
            },
          }),
        ]}
        nomeEtapa={
          new Map([
            ['etapa-origem', 'Qualificação'],
            ['etapa-destino', 'Onboarding'],
          ])
        }
        nomePessoa={new Map()}
        nomePipeline={
          new Map([
            ['pipe-comercial', 'Comercial'],
            ['pipe-pos', 'Pós-venda'],
          ])
        }
      />,
    )

    screen.getByText('Movido de Comercial · Qualificação para Pós-venda · Onboarding')
  })
})
