// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PreviaSegmentos } from './previa'
import { interpolar, type ContextoScript, type Segmento } from '@/lib/domain/script'

// Mesmo motivo de editor.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

const CONTEXTO: ContextoScript = {
  nome_lead: 'Maria da Silva',
  primeiro_nome: 'Maria',
  empresa: null,
  email: 'maria@exemplo.com.br',
  telefone: '(11) 91234-5678',
  responsavel: 'Você',
  etapa: 'Qualificação',
}

function segTexto(texto: string): Segmento[] {
  return [{ tipo: 'texto', texto }]
}

describe('PreviaSegmentos', () => {
  it('1. lacuna renderiza <mark> com o sr-only identico ao dos painters atuais', () => {
    const segmentos = interpolar('Sobre a {{empresa}}.', CONTEXTO)
    render(<PreviaSegmentos segmentos={segmentos} />)

    // Pelo TEXTO exposto, e nao por aria-label: o papel ARIA de <mark> e'
    // name-prohibited (Plano 10) — o rotulo tem que estar no textContent, num
    // <span class="sr-only"> DENTRO da marca.
    const rotulo = screen.getByText(/empresa sem valor/)
    const lacuna = rotulo.closest('mark')
    expect(lacuna).not.toBeNull()
    expect(lacuna!.firstChild?.textContent).toBe('{{empresa}}')
    expect(rotulo.className).toContain('sr-only')
  })

  it('2. *negrito* aparece com font-bold e os asteriscos visiveis', () => {
    const segmentos = segTexto('Isto é *negrito* de verdade.')
    const { container } = render(<PreviaSegmentos segmentos={segmentos} />)

    expect(container.textContent).toContain('*negrito*')
    const comEstilo = screen.getByText('*negrito*')
    expect(comEstilo.className).toContain('font-bold')
  })

  it('3. valor preenchido dentro de par formatado herda o estilo', () => {
    const segmentos = interpolar('Olá *{{primeiro_nome}}*, tudo bem?', CONTEXTO)
    render(<PreviaSegmentos segmentos={segmentos} />)

    const valor = screen.getByText('Maria')
    expect(valor.className).toContain('font-bold')
  })

  it('4. textContent da previa contem o rotulo sr-only (documenta por que Copiar nunca le o DOM)', () => {
    const segmentos = interpolar('Oi {{primeiro_nome}}, sobre a {{empresa}}.', CONTEXTO)
    const { container } = render(<PreviaSegmentos segmentos={segmentos} />)

    // O textContent inclui o rotulo escondido junto do literal — e por isso
    // que Copiar usa textoPlano(segmentos), nunca o DOM da previa.
    expect(container.textContent).toContain('empresa sem valor')
    expect(container.textContent).toContain('{{empresa}}')
  })
})
