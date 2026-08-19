// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Cartao } from './cartao'
import type { LeadDoFunil } from '@/lib/domain/tipos'

// O cleanup automatico do @testing-library/react so se registra quando
// globals: true esta ligado, e este vitest.config nao liga de proposito — o
// repo importa helper de teste explicitamente em todo lugar. Sem o registro
// manual abaixo, o document do jsdom persiste entre os it() deste arquivo e,
// do segundo render() em diante, as consultas acham no velho ou estouram
// "multiple elements found". Copiado de timeline.test.tsx.
afterEach(cleanup)

// O cartao recebe LeadDoFunil, e nao Lead: a projecao estreita que a RPC do
// funil devolve (ver LeadDoFunil em domain/tipos.ts). A fixture segue o tipo
// real de proposito — se o cartao um dia precisar de um campo que a projecao
// nao tem, e' aqui que o compilador avisa.
function lead(overrides: Partial<LeadDoFunil> = {}): LeadDoFunil {
  return {
    id: 'lead-1',
    nome: 'Maria da Silva',
    stageId: 'etapa-1',
    responsavelId: null,
    valorCents: 150000,
    // horasNaEtapa(entrouNaEtapaEm, new Date()) usa o relogio real dentro do
    // componente (nao ha injecao de "agora") — por isso as fixtures deste
    // arquivo calculam entrouNaEtapaEm relativo a Date.now(), nunca uma data
    // fixa de calendario.
    entrouNaEtapaEm: new Date(Date.now() - 2 * 3_600_000),
    etiquetas: [],
    ...overrides,
  }
}

describe('Cartao', () => {
  it('caso 1: nome, valor formatado, responsavel e tempo parado todos presentes', () => {
    render(<Cartao lead={lead({ valorCents: 150000 })} nomeResponsavel="João" />)

    expect(screen.getByRole('link', { name: 'Maria da Silva' })).toBeTruthy()
    screen.getByText('R$ 1.500,00')
    screen.getByText('João')
    screen.getByText('2h')
  })

  it('caso 1b: sem responsavel mostra "sem responsável"', () => {
    render(<Cartao lead={lead()} nomeResponsavel={null} />)

    screen.getByText('sem responsável')
  })

  it('caso 2: etiquetas renderizam quando existem, e a lista nao existe sem elas', () => {
    const { rerender } = render(
      <Cartao
        lead={lead({ etiquetas: [{ id: 'et-1', nome: 'Quente' }] })}
        nomeResponsavel="João"
      />,
    )

    screen.getByRole('list')
    screen.getByText('Quente')

    rerender(<Cartao lead={lead({ etiquetas: [] })} nomeResponsavel="João" />)

    expect(screen.queryByRole('list')).toBeNull()
  })

  it('caso 3: lead parado ha 73h tem destaque, e o valor mora na mesma linha do tempo', () => {
    // >=72h e o limiar de destaque (ver comentario em cartao.tsx). 73h cai
    // dentro de rotuloTempoNaEtapa como "3d".
    const paradoLead = lead({
      valorCents: 200000,
      entrouNaEtapaEm: new Date(Date.now() - 73 * 3_600_000),
    })
    render(<Cartao lead={paradoLead} nomeResponsavel="Ana" />)

    const tempo = screen.getByText('3d')
    expect(tempo.className).toContain('text-destructive')
    expect(tempo.className).toContain('font-medium')

    // Regra do layout novo (secao 2 do spec): valor, responsavel e tempo
    // dividem a MESMA linha (`flex justify-between text-xs`). Contra o
    // layout atual (valor num <p> proprio, tempo dentro de um <footer>
    // separado) este ancestral comum nao existe e o teste falha por
    // estrutura, nao por conteudo.
    const valor = screen.getByText('R$ 2.000,00')
    expect(valor.parentElement).toBe(tempo.parentElement)
  })

  it('caso 3b: lead parado ha 10h nao tem destaque de atencao', () => {
    const semDestaque = lead({ entrouNaEtapaEm: new Date(Date.now() - 10 * 3_600_000) })
    render(<Cartao lead={semDestaque} nomeResponsavel="Ana" />)

    const tempo = screen.getByText('10h')
    expect(tempo.className).not.toContain('text-destructive')
  })

  it('caso 4: o link do nome aponta para /leads/{id}', () => {
    render(<Cartao lead={lead({ id: 'lead-42' })} nomeResponsavel="João" />)

    const link = screen.getByRole('link', { name: 'Maria da Silva' })
    expect(link.getAttribute('href')).toBe('/leads/lead-42')
  })
})
