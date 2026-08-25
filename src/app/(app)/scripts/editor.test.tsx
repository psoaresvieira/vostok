// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from './editor'
import { ok, falha } from '@/lib/domain/resultado'
import type { Resultado } from '@/lib/domain/resultado'
import type { Script, DadosScript } from '@/lib/data/scripts'
import type { Etapa } from '@/lib/domain/tipos'

// Mesmo motivo de whatsapp.test.tsx/etapas.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este vitest.config
// nao liga de proposito. Sem o registro manual o document do jsdom persiste
// entre os it() e as consultas acham no render velho.
afterEach(cleanup)

// O Editor navega para /scripts/[id] depois de criar (useRouter().push). Sem
// provider de App Router no jsdom puro, useRouter() de verdade lanca.
const empurrados: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (url: string) => empurrados.push(url),
    replace: () => {},
    refresh: () => {},
  }),
}))

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

const ETAPAS: Etapa[] = [
  { id: 'etapa-1', pipelineId: 'p1', nome: 'Novo lead', ordem: 1, tipo: 'aberta', slaHoras: null },
  { id: 'etapa-2', pipelineId: 'p1', nome: 'Proposta', ordem: 2, tipo: 'aberta', slaHoras: null },
]

function script(overrides: Partial<Script> = {}): Script {
  return {
    id: 'script-1',
    titulo: 'Abordagem inicial',
    conteudo: 'Olá {{primeiro_nome}}',
    stageId: 'etapa-1',
    tags: ['frio'],
    criadoEm: new Date('2026-01-01T00:00:00Z'),
    atualizadoEm: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function conteudoDe(valor: string) {
  const area = screen.getByLabelText('Conteúdo') as HTMLTextAreaElement
  fireEvent.change(area, { target: { value: valor } })
  return area
}

describe('Editor de script', () => {
  it('Caso 1: a lacuna aparece enquanto se escreve, com destaque acessivel e contador', () => {
    render(<Editor script={null} etapas={ETAPAS} />)

    // LEAD_EXEMPLO tem empresa: null de proposito — a lacuna tem que ser
    // visivel DURANTE a escrita, nao so na hora de enviar.
    conteudoDe('Olá {{primeiro_nome}}, aqui é sobre a {{empresa}}.')

    // Pelo TEXTO exposto, e nao por aria-label nem por classe: o papel ARIA de
    // <mark> e' name-prohibited, entao um aria-label nele nao chega a leitor de
    // tela nenhum — a versao anterior deste teste passava so porque o
    // testing-library casa o atributo, nao o nome exposto de verdade. O rotulo
    // agora e' texto visualmente escondido dentro da propria marca.
    const rotulo = screen.getByText(/empresa sem valor/)
    const lacuna = rotulo.closest('mark')
    expect(lacuna).not.toBeNull()
    // O literal visivel continua sendo o primeiro no da marca — o rotulo
    // escondido nao substituiu nem embaralhou o {{empresa}} que se le na tela.
    expect(lacuna!.firstChild?.textContent).toBe('{{empresa}}')

    // Vermelho se o preview substituir a lacuna por vazio: a tag literal tem
    // que continuar no texto da previa.
    const previa = screen.getByLabelText('Prévia')
    expect(previa.textContent).toContain('{{empresa}}')
    // E o que TEM valor foi mesmo interpolado (nao-vacuo: sem isto o teste
    // passaria num preview que nao interpola nada).
    expect(previa.textContent).toContain('Olá Maria,')
    expect(previa.textContent).not.toContain('{{primeiro_nome}}')

    expect(screen.getByText('1 variável sem valor')).toBeTruthy()
  })

  it('Caso 2: {{Empresa}} com maiuscula fica texto literal — sem destaque e sem pendencia', () => {
    render(<Editor script={null} etapas={ETAPAS} />)

    conteudoDe('Olá {{Empresa}}, tudo bem?')

    const previa = screen.getByLabelText('Prévia')
    // Nenhum <mark>: sem marca nao ha rotulo escondido, entao o textContent da
    // previa e' exatamente o texto visivel. A igualdade exata continua valendo
    // — e a asercao de marks abaixo e' o que a mantem honesta se um dia um
    // rotulo escondido passar a existir aqui.
    expect(previa.querySelectorAll('mark')).toHaveLength(0)
    expect(previa.textContent).toBe('Olá {{Empresa}}, tudo bem?')
    // Nenhum dos dois rotulos escondidos foi para o DOM.
    expect(screen.queryByText(/sem valor/i)).toBeNull()
    expect(screen.queryByText(/não é uma variável/i)).toBeNull()
    expect(screen.queryByText(/variáve(l|is) sem valor/i)).toBeNull()
  })

  it('Caso 3: clicar na variavel da lista insere {{nome}} na posicao do cursor', () => {
    render(<Editor script={null} etapas={ETAPAS} />)

    const area = conteudoDe('Olá , tudo bem?')
    // Cursor no meio: logo depois de 'Olá ' (4 caracteres).
    area.selectionStart = 4
    area.selectionEnd = 4

    fireEvent.click(screen.getByRole('button', { name: 'Inserir empresa' }))

    expect(area.value).toBe('Olá {{empresa}}, tudo bem?')
  })

  it('Caso 3b: sem cursor nunca posicionado, a variavel vai para o FIM e nao para o topo', () => {
    // Um <textarea> que nunca recebeu foco reporta selectionStart 0, e 0 e'
    // indistinguivel de "o usuario pos o cursor no comeco". Abrindo um script
    // que ja tem texto e clicando numa variavel, {{nome}} era enfiado ANTES da
    // primeira letra. A posicao e' forcada para 0 aqui de proposito: e'
    // exatamente o que o navegador reporta na condicao real, e sem isso o teste
    // dependeria do palpite do jsdom para o caret inicial.
    render(<Editor script={script({ conteudo: 'Texto que ja existia.' })} etapas={ETAPAS} />)
    const area = screen.getByLabelText('Conteúdo') as HTMLTextAreaElement
    area.selectionStart = 0
    area.selectionEnd = 0

    fireEvent.click(screen.getByRole('button', { name: 'Inserir empresa' }))

    expect(area.value).toBe('Texto que ja existia.{{empresa}}')

    // E depois do primeiro foco o cursor de verdade volta a mandar: a marca de
    // "nunca tocado" nao pode virar "sempre no fim" para sempre.
    fireEvent.focus(area)
    area.selectionStart = 0
    area.selectionEnd = 0
    fireEvent.click(screen.getByRole('button', { name: 'Inserir email' }))
    expect(area.value).toBe('{{email}}Texto que ja existia.{{empresa}}')
  })

  it('Caso 3c: Negrito com selecao envolve exatamente a selecao', () => {
    render(<Editor script={null} etapas={ETAPAS} />)

    const area = conteudoDe('Olá mundo, tudo bem?')
    // Seleciona exatamente "mundo" (indices 4 a 9).
    area.selectionStart = 4
    area.selectionEnd = 9

    fireEvent.click(screen.getByRole('button', { name: 'Negrito' }))

    expect(area.value).toBe('Olá *mundo*, tudo bem?')
  })

  it('Caso 3d: Negrito sem selecao insere par vazio com o cursor entre os delimitadores', () => {
    render(<Editor script={null} etapas={ETAPAS} />)

    const area = conteudoDe('Olá , tudo bem?')
    // Cursor no meio, sem selecao: logo depois de 'Olá ' (4 caracteres).
    area.selectionStart = 4
    area.selectionEnd = 4

    fireEvent.click(screen.getByRole('button', { name: 'Negrito' }))

    expect(area.value).toBe('Olá **, tudo bem?')
    expect(area.selectionStart).toBe(5)
    expect(area.selectionEnd).toBe(5)
  })

  it('Caso 3e: os tres botoes de formatacao existem por role/name', () => {
    render(<Editor script={null} etapas={ETAPAS} />)

    expect(screen.getByRole('button', { name: 'Negrito' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Itálico' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Riscado' })).toBeTruthy()
  })

  it('Caso 4: salvar envia o que foi editado e traduz a recusa pela mensagem do mapa', async () => {
    const criando = stubRegistrando<[DadosScript], string>(ok('script-novo'))
    render(<Editor script={null} etapas={ETAPAS} criar={criando.fn} />)

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Retomada' } })
    fireEvent.change(screen.getByLabelText('Etapa'), { target: { value: 'etapa-2' } })
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: ' Objeção , PREÇO ' } })
    conteudoDe('Oi {{primeiro_nome}}')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(criando.chamadas).toHaveLength(1))
    expect(criando.chamadas[0][0]).toEqual({
      titulo: 'Retomada',
      conteudo: 'Oi {{primeiro_nome}}',
      stageId: 'etapa-2',
      // Normalizadas: e' o que a tela exibe, entao e' o que ela envia.
      tags: ['objeção', 'preço'],
    })
    // Sucesso em "novo" navega para a ficha do script recem-criado.
    await waitFor(() => expect(empurrados).toContain('/scripts/script-novo'))

    cleanup()

    const recusando = stubRegistrando<[DadosScript], string>(falha('etapa_invalida'))
    render(<Editor script={null} etapas={ETAPAS} criar={recusando.fn} />)
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Retomada' } })
    conteudoDe('Oi')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(
      await screen.findByText(
        'Essa etapa não existe mais — pode ter sido excluída. Recarregue a página e escolha outra.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('etapa_invalida')).toBeNull()
  })

  it('Caso 5: excluir pede confirmacao — cancelar nao chama, confirmar chama com o id', () => {
    const s = script({ id: 'script-9' })

    // Cancela.
    const cancelando = stubRegistrando<[string], void>(ok(undefined))
    render(<Editor script={s} etapas={ETAPAS} excluir={cancelando.fn} />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(cancelando.chamadas).toHaveLength(0)
    cleanup()

    // Confirma.
    const confirmando = stubRegistrando<[string], void>(ok(undefined))
    render(<Editor script={s} etapas={ETAPAS} excluir={confirmando.fn} />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(confirmando.chamadas).toEqual([['script-9']])
  })

  it('nenhum <label> envolve o controle — o nome acessivel nao pode herdar o conteudo', () => {
    // Achado da verificacao no navegador desta task, que o jsdom NAO pega
    // sozinho: o @testing-library resolve getByLabelText('Conteúdo') mesmo com
    // o textarea dentro do <label>, mas o navegador de verdade calcula o nome
    // acessivel como o textContent do label inteiro. Com o textarea dentro, o
    // campo passou a se chamar "Conteúdo Oi Maria, aqui e sobre a..." (React
    // mantem defaultValue em sincronia, e em textarea defaultValue E o
    // textContent); com o <select> dentro, "Etapa Qualquer etapa Novo lead
    // Contato feito ...". A asserção e' estrutural de proposito — e' a
    // estrutura que causa o defeito, e ela e' o que da pra ver no jsdom.
    const { container } = render(<Editor script={script()} etapas={ETAPAS} />)
    const labels = Array.from(container.querySelectorAll('label'))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      expect(label.querySelector('select, textarea, input'), label.textContent ?? '').toBeNull()
      expect(label.getAttribute('for')).toBeTruthy()
    }
  })

  it('modo novo nao oferece excluir', () => {
    render(<Editor script={null} etapas={ETAPAS} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
  })
})

describe('foco ao abrir a confirmacao de exclusao', () => {
  it('move o foco para o Cancelar — a acao menos destrutiva — ao abrir', () => {
    const s = script({ id: 'script-9' })
    const { fn: excluir } = stubRegistrando<[string], void>(ok(undefined))
    render(<Editor script={s} etapas={ETAPAS} excluir={excluir} />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar exclusão' }))
  })
})
