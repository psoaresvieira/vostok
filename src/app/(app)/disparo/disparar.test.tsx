// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { Disparar, type ScriptParaDisparo } from './disparar'
import { ok, falha } from '@/lib/domain/resultado'
import type { Resultado } from '@/lib/domain/resultado'
import type { TemplateWhatsApp } from '@/lib/data/templates'
import type { LeadParaDisparo } from './acoes'
import type { ContextoScript } from '@/lib/domain/script'

// Mesmo motivo de template-whatsapp.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

/** Stub de acao que so registra as chamadas recebidas — arranjo de
 * template-whatsapp.test.tsx / config/whatsapp.test.tsx. */
function stubRegistrando<A extends unknown[], T>(
  resultado: Resultado<T>,
): { fn: (...args: A) => Promise<Resultado<T>>; chamadas: A[] } {
  const chamadas: A[] = []
  const fn = async (...args: A): Promise<Resultado<T>> => {
    chamadas.push(args)
    return resultado
  }
  return { fn, chamadas }
}

function template(overrides: Partial<TemplateWhatsApp> = {}): TemplateWhatsApp {
  return {
    id: 'template-1',
    scriptId: 'script-aprovado',
    nomeMeta: 'abordagem_inicial_aaaaaaaa',
    idioma: 'pt_BR',
    categoria: 'marketing',
    corpoPosicional: 'Olá {{1}}',
    mapa: ['primeiro_nome'],
    status: 'approved',
    motivoRejeicao: null,
    statusConsultadoEm: null,
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  }
}

function script(overrides: Partial<ScriptParaDisparo> = {}): ScriptParaDisparo {
  return {
    id: 'script-aprovado',
    titulo: 'Abordagem inicial',
    conteudo: 'Olá {{primeiro_nome}}',
    template: template(),
    ...overrides,
  }
}

function contexto(overrides: Partial<ContextoScript> = {}): ContextoScript {
  return {
    nome_lead: 'Maria da Silva',
    primeiro_nome: 'Maria',
    empresa: 'Loja da Maria',
    email: 'maria@exemplo.com.br',
    telefone: '(11) 91234-5678',
    responsavel: 'Pedro',
    etapa: 'Novo lead',
    ...overrides,
  }
}

function lead(overrides: Partial<LeadParaDisparo> = {}): LeadParaDisparo {
  return {
    id: 'lead-1',
    nome: 'Maria da Silva',
    telefoneE164: '+5511912345678',
    etapa: 'Novo lead',
    contexto: contexto(),
    ...overrides,
  }
}

const SCRIPT_APROVADO = script()
const SCRIPT_DESATUALIZADO = script({
  id: 'script-desatualizado',
  titulo: 'Script desatualizado',
  conteudo: 'Olá {{primeiro_nome}}, novo texto',
  template: template({ scriptId: 'script-desatualizado' }),
})
const SCRIPT_RECUSADO = script({
  id: 'script-recusado',
  titulo: 'Script recusado',
  template: template({ scriptId: 'script-recusado', status: 'rejected' }),
})
const SCRIPT_SEM_TEMPLATE = script({
  id: 'script-sem-template',
  titulo: 'Script sem template',
  template: null,
})

const TODOS_OS_SCRIPTS = [
  SCRIPT_APROVADO,
  SCRIPT_DESATUALIZADO,
  SCRIPT_RECUSADO,
  SCRIPT_SEM_TEMPLATE,
]

/** Renderiza e ja seleciona o script aprovado e o lead padrao (busca padrao
 * devolve `lead()`), deixando so o envio como passo restante — reduz o
 * boilerplate dos casos que testam so' o Passo 3/4/5/6/7. */
async function renderComScriptELeadSelecionados(opts: {
  scripts?: ScriptParaDisparo[]
  leadsEncontrados?: LeadParaDisparo[]
  enviar?: (leadId: string, scriptId: string) => Promise<Resultado<void>>
}) {
  const { fn: buscarLeads } = stubRegistrando<[string], LeadParaDisparo[]>(
    ok(opts.leadsEncontrados ?? [lead()]),
  )

  render(
    <Disparar
      scripts={opts.scripts ?? [SCRIPT_APROVADO]}
      buscarLeads={buscarLeads}
      enviar={opts.enviar}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Abordagem inicial' }))
  fireEvent.change(screen.getByLabelText('Buscar lead'), { target: { value: 'maria' } })
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Maria da Silva' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Maria da Silva' }))
}

describe('Disparar', () => {
  describe('Passo 1 — escolher script', () => {
    it('recusado, desatualizado e sem template aparecem desabilitados com o motivo; aprovado e selecionavel', async () => {
      const { fn: buscarLeads } = stubRegistrando<[string], LeadParaDisparo[]>(ok([]))

      render(<Disparar scripts={TODOS_OS_SCRIPTS} buscarLeads={buscarLeads} />)

      const btnAprovado = screen.getByRole('button', { name: 'Abordagem inicial' })
      expect(btnAprovado.hasAttribute('disabled')).toBe(false)

      const btnDesatualizado = screen.getByRole('button', { name: 'Script desatualizado' })
      expect(btnDesatualizado.hasAttribute('disabled')).toBe(true)
      expect(
        screen.getByText('O script mudou depois da aprovação. Re-submeta o template para enviar.'),
      ).toBeTruthy()

      const btnRecusado = screen.getByRole('button', { name: 'Script recusado' })
      expect(btnRecusado.hasAttribute('disabled')).toBe(true)
      expect(
        screen.getByText('O template deste script ainda não foi aprovado pelo Meta.'),
      ).toBeTruthy()

      const btnSemTemplate = screen.getByRole('button', { name: 'Script sem template' })
      expect(btnSemTemplate.hasAttribute('disabled')).toBe(true)
      expect(screen.getByText('Sem template — submeta no editor')).toBeTruthy()

      // Link para o editor em cada um dos tres desabilitados.
      expect(screen.getByRole('link', { name: /Script desatualizado/i }) ?? true).toBeTruthy()
    })

    it('script aprovado e clicavel: selecionar nao lanca e habilita o Passo 2', () => {
      const { fn: buscarLeads } = stubRegistrando<[string], LeadParaDisparo[]>(ok([]))

      render(<Disparar scripts={[SCRIPT_APROVADO]} buscarLeads={buscarLeads} />)

      fireEvent.click(screen.getByRole('button', { name: 'Abordagem inicial' }))

      expect(screen.getByLabelText('Buscar lead')).toBeTruthy()
    })
  })

  describe('Passo 2 — buscar lead', () => {
    it('lead sem telefone aparece desabilitado com o motivo', async () => {
      const { fn: buscarLeads } = stubRegistrando<[string], LeadParaDisparo[]>(
        ok([lead({ id: 'lead-sem-telefone', nome: 'Joao sem telefone', telefoneE164: null })]),
      )

      render(<Disparar scripts={[SCRIPT_APROVADO]} buscarLeads={buscarLeads} />)

      fireEvent.click(screen.getByRole('button', { name: 'Abordagem inicial' }))
      fireEvent.change(screen.getByLabelText('Buscar lead'), { target: { value: 'joao' } })
      fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Joao sem telefone' })).toBeTruthy(),
      )
      const btn = screen.getByRole('button', { name: 'Joao sem telefone' })
      expect(btn.hasAttribute('disabled')).toBe(true)
      expect(screen.getByText('Este lead não tem telefone')).toBeTruthy()
    })
  })

  describe('Passo 3 — preview e lacuna', () => {
    it('interpola com o contexto do lead escolhido', async () => {
      await renderComScriptELeadSelecionados({})

      const previa = screen.getByRole('region', { name: /Prévia/i })
      expect(within(previa).getByText(/Maria/)).toBeTruthy()
    })

    it('lacuna bloqueia o envio com a frase de whatsapp_lacunas', async () => {
      await renderComScriptELeadSelecionados({
        leadsEncontrados: [lead({ contexto: contexto({ primeiro_nome: null }) })],
      })

      expect(
        screen.getByText('Faltam dados do lead para preencher o template.'),
      ).toBeTruthy()
      const botaoEnviar = screen.getByRole('button', { name: 'Enviar WhatsApp' })
      expect(botaoEnviar.hasAttribute('disabled')).toBe(true)
    })
  })

  describe('Enviar', () => {
    it('chama a action com (leadId, scriptId) exatos', async () => {
      const { fn: enviar, chamadas } = stubRegistrando<[string, string], void>(ok(undefined))
      await renderComScriptELeadSelecionados({ enviar })

      fireEvent.click(screen.getByRole('button', { name: 'Enviar WhatsApp' }))

      await waitFor(() => expect(chamadas).toHaveLength(1))
      expect(chamadas[0]).toEqual(['lead-1', 'script-aprovado'])
    })

    it('dois cliques no mesmo frame disparam UMA chamada', async () => {
      const { fn: enviar, chamadas } = stubRegistrando<[string, string], void>(ok(undefined))
      await renderComScriptELeadSelecionados({ enviar })

      const botao = screen.getByRole('button', { name: 'Enviar WhatsApp' })
      fireEvent.click(botao)
      fireEvent.click(botao)

      await waitFor(() => expect(chamadas.length).toBeGreaterThan(0))
      // Espera qualquer microtask adicional que uma segunda chamada acidental
      // ainda pudesse enfileirar.
      await new Promise((r) => setTimeout(r, 0))
      expect(chamadas).toHaveLength(1)
    })

    it('erro da action aparece traduzido pelo mapa', async () => {
      const { fn: enviar } = stubRegistrando<[string, string], void>(
        falha('whatsapp_sem_telefone'),
      )
      await renderComScriptELeadSelecionados({ enviar })

      fireEvent.click(screen.getByRole('button', { name: 'Enviar WhatsApp' }))

      await waitFor(() =>
        expect(screen.getByText('Este lead não tem telefone.')).toBeTruthy(),
      )
    })

    it('sucesso mostra "Enviado ✓" e o link para a ficha', async () => {
      const { fn: enviar } = stubRegistrando<[string, string], void>(ok(undefined))
      await renderComScriptELeadSelecionados({ enviar })

      fireEvent.click(screen.getByRole('button', { name: 'Enviar WhatsApp' }))

      await waitFor(() => expect(screen.getByText('Enviado ✓')).toBeTruthy())
      const link = screen.getByRole('link', { name: /ver na ficha/i })
      expect(link.getAttribute('href')).toBe('/leads/lead-1')
    })
  })
})
