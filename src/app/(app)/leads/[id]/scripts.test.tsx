// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { PainelScripts } from './scripts'
import type { Script } from '@/lib/data/scripts'
import { linkWhatsApp, type ContextoScript } from '@/lib/domain/script'

// Mesmo motivo de tarefas.test.tsx e editor.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este vitest.config
// nao liga de proposito. Sem o registro manual o document do jsdom persiste
// entre os it() e as consultas acham no render velho.
afterEach(cleanup)

const TELEFONE = '+5511912345678'

/** O lead de teste NAO tem empresa — a lacuna e' o ponto de todo este arquivo. */
const CONTEXTO: ContextoScript = {
  nome_lead: 'Maria da Silva',
  primeiro_nome: 'Maria',
  empresa: null,
  email: 'maria@exemplo.com.br',
  telefone: '(11) 91234-5678',
  responsavel: 'Pedro',
  etapa: 'Proposta',
}

function script(overrides: Partial<Script> = {}): Script {
  return {
    id: 'script-1',
    titulo: 'Abordagem inicial',
    conteudo: 'Olá {{primeiro_nome}}, sobre a {{empresa}} — falo com {{responsavel}}.',
    stageId: 'etapa-1',
    tags: ['frio'],
    criadoEm: new Date('2026-01-01T00:00:00Z'),
    atualizadoEm: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

/** O texto que os TRES caminhos (previa, Copiar e wa.me) tem que produzir a
 * partir do mesmo Segmento[]: valores interpolados, lacuna literal preservada. */
const TEXTO_ESPERADO = 'Olá Maria, sobre a {{empresa}} — falo com Pedro.'

/** Stub de navigator.clipboard: o jsdom nao implementa a Clipboard API, entao a
 * propriedade nem existe e so da pra instalar por defineProperty. Devolve a
 * lista de textos escritos. */
function espionarClipboard(): string[] {
  const escritos: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async (t: string) => void escritos.push(t) },
    configurable: true,
  })
  return escritos
}

describe('PainelScripts', () => {
  it('Caso 1: previa interpolada com a lacuna pintada e o contador de pendencias', () => {
    render(
      <PainelScripts scripts={[script()]} contexto={CONTEXTO} telefoneE164={TELEFONE} />,
    )

    // Pelo texto exposto, e nao por aria-label nem por classe: o papel ARIA de
    // <mark> e' name-prohibited (ver o comentario longo em scripts/editor.tsx),
    // entao o rotulo tem que ser texto visualmente escondido DENTRO da marca.
    const rotulo = screen.getByText(/empresa sem valor/)
    const lacuna = rotulo.closest('mark')
    expect(lacuna).not.toBeNull()
    // O literal visivel continua sendo o primeiro no da marca: o rotulo
    // escondido nao substituiu nem embaralhou o {{empresa}} que se le na tela.
    expect(lacuna!.firstChild?.textContent).toBe('{{empresa}}')

    const previa = screen.getByLabelText('Prévia de Abordagem inicial')
    // Vermelho se a previa apagar a lacuna: um buraco invisivel vira mensagem
    // com buraco enviada a um lead de verdade.
    expect(previa.textContent).toContain('{{empresa}}')
    // Nao-vacuo: o que TEM valor foi mesmo interpolado com ESTE lead.
    expect(previa.textContent).toContain('Olá Maria,')
    expect(previa.textContent).toContain('falo com Pedro.')
    expect(previa.textContent).not.toContain('{{primeiro_nome}}')

    expect(screen.getByText('1 variável sem valor')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Abordagem inicial' })).toBeTruthy()
  })

  it('Caso 2: Copiar escreve o texto plano do dominio, com a lacuna literal e sem o rotulo escondido', async () => {
    const escritos = espionarClipboard()
    render(
      <PainelScripts scripts={[script()]} contexto={CONTEXTO} telefoneE164={TELEFONE} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))

    await waitFor(() => expect(escritos).toHaveLength(1))
    // Igualdade exata, e nao "contem": e' ela que tranca o modo de falha que
    // este caso existe para pegar. A previa pinta as lacunas com <mark> e um
    // <span class="sr-only"> dentro, entao o textContent do DOM renderizado e'
    // "Olá Maria, sobre a {{empresa}} empresa sem valor — ...". Um Copiar que
    // lesse o DOM (innerText/textContent) mandaria esse rotulo para o
    // WhatsApp do lead. O unico caminho honesto e'
    // textoPlano(interpolar(conteudo, contexto)).
    expect(escritos[0]).toBe(TEXTO_ESPERADO)
    expect(escritos[0]).not.toContain('sem valor')

    // Feedback transitorio, padrao do "Salvo ✓" de config/etapas.tsx.
    expect(await screen.findByText('Copiado ✓')).toBeTruthy()
    // O nome acessivel do botao NAO muda com o feedback: quem navega por
    // teclado nao pode perder o alvo depois de usa-lo uma vez.
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy()

    // Copiar continua liberado COM pendencia (spec §4.4): o aviso e' o
    // contador, a decisao e' do vendedor.
    expect(screen.getByText('1 variável sem valor')).toBeTruthy()
  })

  it('Caso 3: com telefone o WhatsApp e um link wa.me com o mesmo texto; sem telefone e botao desabilitado', () => {
    render(
      <PainelScripts scripts={[script()]} contexto={CONTEXTO} telefoneE164={TELEFONE} />,
    )

    const link = screen.getByRole('link', { name: 'WhatsApp' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(
      `https://wa.me/5511912345678?text=${encodeURIComponent(TEXTO_ESPERADO)}`,
    )
    // Redundante de proposito com a linha acima: se linkWhatsApp mudar de
    // formato, as duas mudam juntas — o que esta trancado aqui e' que a TELA
    // usa a funcao do dominio e o MESMO texto do Copiar.
    expect(link.getAttribute('href')).toBe(linkWhatsApp(TELEFONE, TEXTO_ESPERADO))
    expect(link.getAttribute('href')).toContain('%7B%7Bempresa%7D%7D')
    expect(link.getAttribute('target')).toBe('_blank')

    cleanup()

    render(<PainelScripts scripts={[script()]} contexto={CONTEXTO} telefoneE164={null} />)

    // Positiva primeiro: o controle existe e explica por que nao da.
    const botao = screen.getByRole('button', { name: 'WhatsApp' }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(botao.getAttribute('title')).toBe('Este lead não tem telefone')
    // So agora a negativa: nunca um link morto para wa.me sem numero.
    expect(screen.queryByRole('link', { name: 'WhatsApp' })).toBeNull()
  })

  it('Caso 4: estado vazio com o link para a biblioteca', () => {
    render(<PainelScripts scripts={[]} contexto={CONTEXTO} telefoneE164={TELEFONE} />)

    expect(screen.getByText('Nenhum script para esta etapa.')).toBeTruthy()
    const link = screen.getByRole('link', { name: /scripts/i }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/scripts')
    // A ficha nao cria script — e' so o caminho para a biblioteca.
    expect(screen.queryByRole('button', { name: 'Copiar' })).toBeNull()
  })

  it('falha de carga vira aviso traduzido no lugar do estado vazio, nunca um "nenhum script" mentiroso', () => {
    render(
      <PainelScripts
        scripts={[]}
        contexto={CONTEXTO}
        telefoneE164={TELEFONE}
        erro="erro_ao_carregar_scripts"
      />,
    )

    expect(
      screen.getByText('Não foi possível carregar os scripts. Tente de novo.'),
    ).toBeTruthy()
    // "Nenhum script para esta etapa" seria uma afirmacao FALSA: ninguem sabe
    // se ha script, a consulta nem respondeu.
    expect(screen.queryByText('Nenhum script para esta etapa.')).toBeNull()
    // E nunca o codigo cru na tela.
    expect(screen.queryByText('erro_ao_carregar_scripts')).toBeNull()
  })
})
