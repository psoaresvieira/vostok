// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { Etapa, EventoLead, Lead, Membro, Pipeline } from '@/lib/domain/tipos'
import type { DadosDoDrawer } from './carregar'
import { DrawerLead } from './drawer-lead'

// Mesmo motivo de cartao.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

const empurroes: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (destino: string) => empurroes.push(destino),
    replace: () => {},
    refresh: () => {},
  }),
}))

vi.mock('./acoes', () => ({
  adicionarNota: async () => ({ ok: true, valor: undefined }),
  adicionarEtiquetas: async () => ({ ok: true, valor: undefined }),
  removerEtiqueta: async () => ({ ok: true, valor: undefined }),
  trocarResponsavel: async () => ({ ok: true, valor: undefined }),
}))

const PADRAO: Pipeline = { id: 'pipe-1', nome: 'Funil de vendas', isDefault: true }
const B2B: Pipeline = { id: 'pipe-2', nome: 'Onboarding', isDefault: false }

function etapa(id: string, pipelineId: string, nome: string, ordem: number): Etapa {
  return { id, pipelineId, nome, ordem, tipo: 'aberta', slaHoras: null }
}

const MEMBROS: Membro[] = [
  { id: 'user-1', nome: 'Ana', email: 'ana@teste.com', papel: 'admin' },
]

const LEAD: Lead = {
  id: 'lead-1',
  accountId: 'conta-1',
  nome: 'Kariny',
  telefone: null,
  telefoneE164: '+5583999990000',
  email: 'kariny@teste.com',
  emailNorm: 'kariny@teste.com',
  empresa: 'Padaria Sol',
  origem: 'meta',
  pipelineId: PADRAO.id,
  stageId: 'p1-e1',
  responsavelId: 'user-1',
  status: 'aberto',
  valorCents: 150_000,
  lossReasonId: null,
  entrouNaEtapaEm: new Date('2026-08-28T12:00:00Z'),
  criadoEm: new Date('2026-08-20T12:00:00Z'),
  atualizadoEm: new Date('2026-08-28T12:00:00Z'),
  etiquetas: [],
}

function dados(extras: Partial<DadosDoDrawer> = {}): DadosDoDrawer {
  return {
    lead: LEAD,
    pipelines: [
      {
        pipeline: PADRAO,
        etapas: [etapa('p1-e1', PADRAO.id, 'Novo lead', 1), etapa('p1-e2', PADRAO.id, 'Proposta', 2)],
      },
      {
        pipeline: B2B,
        etapas: [etapa('p2-e1', B2B.id, 'Implantação', 1)],
      },
    ],
    membros: MEMBROS,
    motivos: [],
    etiquetasConhecidas: [],
    tarefas: [],
    eventos: [],
    temMaisEventos: false,
    papel: 'admin',
    ...extras,
  }
}

function montar(d: DadosDoDrawer = dados()) {
  return render(
    <DrawerLead dados={d} hrefFechar="/funil?busca=kar" blocoScripts={<p>bloco de scripts</p>} />,
  )
}

describe('DrawerLead', () => {
  it('abre um dialogo nomeado pelo lead, com as tres abas e a Principal ativa', async () => {
    montar()

    const dialogo = await screen.findByRole('dialog')
    expect(dialogo.getAttribute('aria-modal')).toBe('true')
    // O nome acessivel do dialogo e' o <h2> do cabecalho, ligado por
    // aria-labelledby — nao um titulo separado.
    const titulo = within(dialogo).getByRole('heading', { name: 'Kariny', level: 2 })
    expect(dialogo.getAttribute('aria-labelledby')).toBe(titulo.getAttribute('id'))

    expect(within(dialogo).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Principal',
      'Tarefas',
      'Histórico',
    ])
    // Principal ativa: telefone (com link tel:), empresa, origem e o bloco de
    // scripts que o servidor montou.
    expect(within(dialogo).getByRole('link', { name: '(83) 99999-0000' }).getAttribute('href')).toBe(
      'tel:+5583999990000',
    )
    expect(within(dialogo).getByText('Padaria Sol')).toBeTruthy()
    expect(within(dialogo).getByText('bloco de scripts')).toBeTruthy()
  })

  it('aba Histórico mostra a linha do tempo — vazia, o aviso de que nada aconteceu', async () => {
    montar()
    const dialogo = await screen.findByRole('dialog')

    fireEvent.click(within(dialogo).getByRole('tab', { name: 'Histórico' }))
    expect(within(dialogo).getByText('Nada aconteceu ainda.')).toBeTruthy()
    // A aba Principal saiu do DOM junto com o painel dela.
    expect(within(dialogo).queryByText('bloco de scripts')).toBeNull()
  })

  it('aba Tarefas mostra o painel de tarefas do lead', async () => {
    montar()
    const dialogo = await screen.findByRole('dialog')

    fireEvent.click(within(dialogo).getByRole('tab', { name: 'Tarefas' }))
    expect(within(dialogo).getByPlaceholderText('título da tarefa')).toBeTruthy()
  })

  it('evento pipeline_alterada nomeia as etapas das DUAS pipelines, nao so a atual', async () => {
    const movimento: EventoLead = {
      id: 'ev-1',
      leadId: LEAD.id,
      tipo: 'pipeline_alterada',
      payload: {
        de_pipeline: PADRAO.id,
        para_pipeline: B2B.id,
        de: 'p1-e2',
        para: 'p2-e1',
      },
      atorId: null,
      criadoEm: new Date('2026-08-28T13:00:00Z'),
    }
    montar(dados({ eventos: [movimento] }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.click(within(dialogo).getByRole('tab', { name: 'Histórico' }))
    // "etapa removida" aqui seria o bug da ficha antiga, que so' carregava as
    // etapas da pipeline ATUAL do lead: a etapa de ORIGEM vive na outra.
    expect(
      within(dialogo).getByText('Movido de Funil de vendas · Proposta para Onboarding · Implantação'),
    ).toBeTruthy()
  })

  it('avisa quando a janela de eventos foi cortada, contando os que estao na tela', async () => {
    const nota = (id: string, texto: string): EventoLead => ({
      id,
      leadId: LEAD.id,
      tipo: 'nota',
      payload: { texto },
      atorId: null,
      criadoEm: new Date('2026-08-28T13:00:00Z'),
    })
    montar(dados({ eventos: [nota('a', 'primeira'), nota('b', 'segunda')], temMaisEventos: true }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.click(within(dialogo).getByRole('tab', { name: 'Histórico' }))
    // O numero e' o tamanho da lista desenhada, e nao uma constante repetida:
    // dizer "60" com dois eventos na tela seria mentira.
    expect(within(dialogo).getByText('Mostrando os 2 eventos mais recentes.')).toBeTruthy()
  })

  it('fechar leva a URL sem o lead, sem rolar a pagina', async () => {
    montar()
    const dialogo = await screen.findByRole('dialog')
    empurroes.length = 0

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Fechar' }))
    expect(empurroes).toEqual(['/funil?busca=kar'])
  })

  // Fix wave 1 (review da Task 4): sem `key={lead.id}` em quem monta o
  // DrawerLead, trocar de `?lead=` so troca as PROPS do mesmo componente
  // montado, e o estado local dos filhos (aba ativa, rascunho de nota)
  // sobrevive de um lead para o outro. Os dois testes abaixo simulam a `key`
  // trocando diretamente aqui — `rerender` do Testing Library preserva a
  // raiz, mas uma `key` diferente entre uma renderizacao e outra ainda faz o
  // React desmontar e montar de novo, exatamente como acontece dentro do
  // <div> de page.tsx quando a URL troca de lead.
  describe('troca de lead via key (fix wave 1)', () => {
    const LEAD_B: Lead = { ...LEAD, id: 'lead-2', nome: 'Bruno' }

    it('a aba ativa nao sobrevive a troca de lead', async () => {
      const { rerender } = render(
        <DrawerLead key={LEAD.id} dados={dados()} hrefFechar="/funil" blocoScripts={<p>bloco</p>} />,
      )
      let dialogo = await screen.findByRole('dialog')
      fireEvent.click(within(dialogo).getByRole('tab', { name: 'Histórico' }))
      expect(
        within(dialogo).getByRole('tab', { name: 'Histórico' }).getAttribute('aria-selected'),
      ).toBe('true')

      rerender(
        <DrawerLead
          key={LEAD_B.id}
          dados={dados({ lead: LEAD_B })}
          hrefFechar="/funil"
          blocoScripts={<p>bloco</p>}
        />,
      )
      dialogo = await screen.findByRole('dialog')
      expect(
        within(dialogo).getByRole('tab', { name: 'Principal' }).getAttribute('aria-selected'),
      ).toBe('true')
      expect(
        within(dialogo).getByRole('tab', { name: 'Histórico' }).getAttribute('aria-selected'),
      ).toBe('false')
    })

    it('um rascunho de nota digitado para o lead A nao aparece no formulario do lead B', async () => {
      const { rerender } = render(
        <DrawerLead key={LEAD.id} dados={dados()} hrefFechar="/funil" blocoScripts={<p>bloco</p>} />,
      )
      let dialogo = await screen.findByRole('dialog')
      fireEvent.click(within(dialogo).getByRole('tab', { name: 'Histórico' }))
      const campoA = within(dialogo).getByPlaceholderText('registrar uma nota') as HTMLTextAreaElement
      fireEvent.change(campoA, { target: { value: 'nota digitada para o lead A, nunca enviada' } })
      expect(campoA.value).toBe('nota digitada para o lead A, nunca enviada')

      rerender(
        <DrawerLead
          key={LEAD_B.id}
          dados={dados({ lead: LEAD_B })}
          hrefFechar="/funil"
          blocoScripts={<p>bloco</p>}
        />,
      )
      dialogo = await screen.findByRole('dialog')
      fireEvent.click(within(dialogo).getByRole('tab', { name: 'Histórico' }))
      // Sem a key, este seria o MESMO <textarea> React com o rascunho do lead
      // A ainda dentro — um clique em "Salvar nota" aqui gravaria a nota
      // errada no lead B.
      const campoB = within(dialogo).getByPlaceholderText('registrar uma nota') as HTMLTextAreaElement
      expect(campoB.value).toBe('')
    })
  })
})
