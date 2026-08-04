import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WhatsAppGraphFalso } from '@/lib/integracoes/whatsapp-falso'
import type { DisparoServico, TemplateStore, TemplateWhatsApp } from '@/lib/data/templates'
import { templateComStatusFresco } from './status-template'

/**
 * O graph entra por parametro (default `whatsappGraph()`), entao aqui basta a
 * falsa de verdade — sem vi.mock da fabrica.
 */

const templates = {
  doScript: vi.fn(),
  dosScripts: vi.fn(),
  criar: vi.fn(),
  substituir: vi.fn(),
  excluir: vi.fn(),
}

const servico = {
  credencial: vi.fn(),
  atualizarStatus: vi.fn(),
}

const CREDENCIAL = { token: 'tok-1', wabaId: 'waba-1' }

function template(overrides: Partial<TemplateWhatsApp> = {}): TemplateWhatsApp {
  return {
    id: 'template-do-banco',
    scriptId: 'script-1',
    nomeMeta: 'abordagem_inicial_aaaaaaaa',
    idioma: 'pt_BR',
    categoria: 'marketing',
    corpoPosicional: 'Olá {{1}}',
    mapa: ['primeiro_nome'],
    status: 'pending',
    motivoRejeicao: null,
    statusConsultadoEm: null,
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  }
}

function chamar(graph: WhatsAppGraphFalso, credencial = CREDENCIAL as typeof CREDENCIAL | null) {
  return templateComStatusFresco(
    templates as unknown as TemplateStore,
    servico as unknown as DisparoServico,
    'script-1',
    credencial,
    graph,
  )
}

describe('templateComStatusFresco', () => {
  let graph: WhatsAppGraphFalso

  beforeEach(() => {
    vi.clearAllMocks()
    graph = new WhatsAppGraphFalso()
    servico.atualizarStatus.mockResolvedValue({ ok: true, valor: undefined })
  })

  it('script sem template devolve null sem tocar o Graph', async () => {
    templates.doScript.mockResolvedValue({ ok: true, valor: null })

    expect(await chamar(graph)).toBeNull()
    expect(graph.templatesConsultados).toEqual([])
  })

  it('falha de leitura degrada para null, nunca excecao dentro do render', async () => {
    templates.doScript.mockResolvedValue({ ok: false, erro: 'erro_ao_carregar_templates' })

    expect(await chamar(graph)).toBeNull()
    expect(graph.templatesConsultados).toEqual([])
  })

  it('approved e rejected sao finais: nao gastam round-trip por render', async () => {
    for (const status of ['approved', 'rejected']) {
      templates.doScript.mockResolvedValue({ ok: true, valor: template({ status }) })

      const r = await chamar(graph)

      expect(r?.status, status).toBe(status)
      expect(graph.templatesConsultados, status).toEqual([])
      expect(servico.atualizarStatus, status).not.toHaveBeenCalled()
    }
  })

  it('sem credencial devolve o gravado sem consultar', async () => {
    templates.doScript.mockResolvedValue({ ok: true, valor: template() })

    const r = await chamar(graph, null)

    expect(r?.status).toBe('pending')
    expect(graph.templatesConsultados).toEqual([])
  })

  it('pending consultado persiste com o ID DA LINHA LIDA e devolve a linha fresca', async () => {
    templates.doScript.mockResolvedValue({ ok: true, valor: template() })
    graph.templates.set('abordagem_inicial_aaaaaaaa', {
      status: 'REJECTED',
      motivo: 'INVALID_FORMAT',
      corpo: 'Olá {{1}}',
      categoria: 'marketing',
    })

    const r = await chamar(graph)

    expect(graph.templatesConsultados).toEqual([
      { token: 'tok-1', wabaId: 'waba-1', nome: 'abordagem_inicial_aaaaaaaa' },
    ])
    // O id NUNCA vem de request: e' o da linha que doScript acabou de ler na
    // conta ativa. A RPC e' security definer autorizada so pelo segredo e
    // escreve em qualquer linha cujo id receber.
    expect(servico.atualizarStatus).toHaveBeenCalledWith(
      'template-do-banco',
      'rejected',
      'INVALID_FORMAT',
    )
    expect(r?.status).toBe('rejected')
    expect(r?.motivoRejeicao).toBe('INVALID_FORMAT')
    expect(r?.statusConsultadoEm).toBeInstanceOf(Date)
  })

  it('Graph fora do ar degrada para o gravado, sem escrever nada', async () => {
    templates.doScript.mockResolvedValue({ ok: true, valor: template() })
    // Nome nao semeado em `graph.templates`: a falsa devolve falha.

    const r = await chamar(graph)

    expect(r?.status).toBe('pending')
    expect(servico.atualizarStatus).not.toHaveBeenCalled()
  })

  it('RPC que nao gravou devolve o GRAVADO, nao o fresco', async () => {
    templates.doScript.mockResolvedValue({ ok: true, valor: template() })
    graph.templates.set('abordagem_inicial_aaaaaaaa', {
      status: 'approved',
      motivo: null,
      corpo: 'Olá {{1}}',
      categoria: 'marketing',
    })
    servico.atualizarStatus.mockResolvedValue({ ok: false, erro: 'template_nao_encontrado' })

    const r = await chamar(graph)

    // 'approved' na tela com 'pending' no banco faria o botao de envio
    // aparecer num render e sumir no seguinte.
    expect(r?.status).toBe('pending')
  })
})
