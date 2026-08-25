// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { PainelScripts } from './scripts'
import type { Script } from '@/lib/data/scripts'
import type { TemplateWhatsApp } from '@/lib/data/templates'
import { linkWhatsApp, type ContextoScript } from '@/lib/domain/script'
import { codigoDoErroDoPainel } from '@/app/(app)/scripts/erros'

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
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO}
        telefoneE164={TELEFONE}
      />,
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
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO}
        telefoneE164={TELEFONE}
      />,
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

    // Feedback transitorio, padrao do "Salvo ✓" de funil/etapas.tsx.
    expect(await screen.findByText('Copiado')).toBeTruthy()
    // O nome acessivel do botao NAO muda com o feedback: quem navega por
    // teclado nao pode perder o alvo depois de usa-lo uma vez.
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy()

    // Copiar continua liberado COM pendencia (spec §4.4): o aviso e' o
    // contador, a decisao e' do vendedor.
    expect(screen.getByText('1 variável sem valor')).toBeTruthy()
  })

  it('Caso 3: com telefone o WhatsApp e um link wa.me com o mesmo texto; sem telefone e botao desabilitado', () => {
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO}
        telefoneE164={TELEFONE}
      />,
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

    render(
      <PainelScripts leadId="lead-1" scripts={[script()]} contexto={CONTEXTO} telefoneE164={null} />,
    )

    // Positiva primeiro: o controle existe e explica por que nao da.
    const botao = screen.getByRole('button', { name: 'WhatsApp' }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(botao.getAttribute('title')).toBe('Este lead não tem telefone')
    // So agora a negativa: nunca um link morto para wa.me sem numero.
    expect(screen.queryByRole('link', { name: 'WhatsApp' })).toBeNull()
  })

  it('Caso 4: estado vazio com o link para a biblioteca', () => {
    render(<PainelScripts leadId="lead-1" scripts={[]} contexto={CONTEXTO} telefoneE164={TELEFONE} />)

    expect(screen.getByText('Nenhum script para esta etapa.')).toBeTruthy()
    const link = screen.getByRole('link', { name: /scripts/i }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/disparo')
    // A ficha nao cria script — e' so o caminho para a biblioteca.
    expect(screen.queryByRole('button', { name: 'Copiar' })).toBeNull()
  })

  it('falha de carga vira aviso traduzido no lugar do estado vazio, nunca um "nenhum script" mentiroso', () => {
    render(
      <PainelScripts
        leadId="lead-1"
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

  it('erro de CONSTRUCAO do store, fora do vocabulario de scripts, nunca vaza texto de Postgres na ficha', () => {
    // O modo de falha que este caso tranca: `criarScriptStoreDoServidor` falha
    // ANTES de existir store, e o codigo que ela devolve vem de
    // `resolverContaAtiva`, que faz `falha(error.message)` — a mensagem CRUA do
    // Postgres. `mensagemDeErroScript` ecoa o codigo que nao conhece, entao a
    // ficha do lead mostraria "new row violates row-level security policy for
    // table ..." ao lado do nome do cliente. A decisao mora em
    // `codigoDoErroDoPainel`, e page.tsx aplica ela ao ramo de construcao; aqui
    // a composicao inteira e' exercitada de ponta a ponta.
    const cru = 'new row violates row-level security policy for table "memberships"'

    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[]}
        contexto={CONTEXTO}
        telefoneE164={TELEFONE}
        erro={codigoDoErroDoPainel(cru)}
      />,
    )

    expect(
      screen.getByText('Não foi possível carregar os scripts. Tente de novo.'),
    ).toBeTruthy()
    expect(screen.queryByText(cru)).toBeNull()
    // Nem em pedaco: o texto do Postgres nao pode sobrar em canto nenhum da
    // arvore renderizada.
    expect(document.body.textContent).not.toContain('row-level security')
  })
})

/** Contexto SEM lacuna: e' o unico em que o envio pode ser oferecido. */
const CONTEXTO_COMPLETO: ContextoScript = { ...CONTEXTO, empresa: 'Loja da Maria' }

/** O snapshot que `traduzirParaPosicional` produz do conteudo de `script()`. */
const CORPO_POSICIONAL = 'Olá {{1}}, sobre a {{2}} — falo com {{3}}.'

function template(overrides: Partial<TemplateWhatsApp> = {}): TemplateWhatsApp {
  return {
    id: 'template-1',
    scriptId: 'script-1',
    nomeMeta: 'abordagem_inicial_aaaaaaaa',
    idioma: 'pt_BR',
    categoria: 'marketing',
    corpoPosicional: CORPO_POSICIONAL,
    mapa: ['primeiro_nome', 'empresa', 'responsavel'],
    status: 'approved',
    motivoRejeicao: null,
    statusConsultadoEm: null,
    criadoEm: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function enviarOk() {
  return vi.fn(async () => ({ ok: true as const, valor: undefined }))
}

describe('PainelScripts — disparo de WhatsApp', () => {
  it('caso 4: "Enviar WhatsApp" so aparece com template approved, telefone e snapshot batendo', () => {
    // Positivo primeiro: o estado completo oferece o envio, e habilitado.
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO_COMPLETO}
        telefoneE164={TELEFONE}
        templates={[template()]}
        enviar={enviarOk()}
      />,
    )
    const botao = screen.getByRole('button', { name: 'Enviar WhatsApp' }) as HTMLButtonElement
    expect(botao.disabled).toBe(false)

    // Sem template nenhum: nada a enviar, nem botao.
    cleanup()
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO_COMPLETO}
        telefoneE164={TELEFONE}
        templates={[]}
        enviar={enviarOk()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Enviar WhatsApp' })).toBeNull()

    // Template em analise (ou qualquer status que nao seja approved): idem. O
    // Meta so aceita envio de template aprovado, e um botao que existe para
    // dar erro e' pior do que botao nenhum.
    for (const status of ['pending', 'rejected', 'paused']) {
      cleanup()
      render(
        <PainelScripts
          leadId="lead-1"
          scripts={[script()]}
          contexto={CONTEXTO_COMPLETO}
          telefoneE164={TELEFONE}
          templates={[template({ status })]}
          enviar={enviarOk()}
        />,
      )
      expect(screen.queryByRole('button', { name: 'Enviar WhatsApp' }), status).toBeNull()
    }

    // Sem telefone o botao NEM APARECE: o wa.me ao lado ja explica esse estado
    // com o seu proprio botao desabilitado, e dois controles mortos lado a lado
    // dizendo a mesma coisa e' ruido.
    cleanup()
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO_COMPLETO}
        telefoneE164={null}
        templates={[template()]}
        enviar={enviarOk()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Enviar WhatsApp' })).toBeNull()

    // Template de OUTRO script nao vale para este: a indexacao e' por scriptId.
    cleanup()
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO_COMPLETO}
        telefoneE164={TELEFONE}
        templates={[template({ scriptId: 'outro-script' })]}
        enviar={enviarOk()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Enviar WhatsApp' })).toBeNull()
  })

  it('caso 5: lacuna bloqueia o envio dizendo por que — e o clique nao chama a action', () => {
    const enviar = enviarOk()
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO}
        telefoneE164={TELEFONE}
        templates={[template()]}
        enviar={enviar}
      />,
    )

    const botao = screen.getByRole('button', { name: 'Enviar WhatsApp' }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    // O motivo e' a MESMA frase que a action devolveria ('whatsapp_lacunas'):
    // a tela nao inventa vocabulario proprio para o mesmo fato.
    expect(botao.getAttribute('title')).toBe('Faltam dados do lead para preencher o template.')
    // E o contador que ja existia continua sendo o aviso visivel.
    expect(screen.getByText('1 variável sem valor')).toBeTruthy()

    fireEvent.click(botao)
    expect(enviar).not.toHaveBeenCalled()
    // Nem confirmacao: um dialogo que so pode ser cancelado seria pior.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('caso 6: script editado depois da aprovacao bloqueia e manda re-submeter', () => {
    const enviar = enviarOk()
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO_COMPLETO}
        telefoneE164={TELEFONE}
        // Snapshot de um conteudo que nao e' mais o do script: e' exatamente o
        // que acontece quando alguem edita o script depois da aprovacao.
        templates={[template({ corpoPosicional: 'Olá {{1}}, texto antigo.', mapa: ['primeiro_nome'] })]}
        enviar={enviar}
      />,
    )

    const botao = screen.getByRole('button', { name: 'Enviar WhatsApp' }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(botao.getAttribute('title')).toBe(
      'O script mudou depois da aprovação. Re-submeta o template para enviar.',
    )
    // Texto visivel, e nao so' o title: title nao aparece em toque nem em
    // leitor de tela navegando por texto.
    expect(screen.getByText(/re-submeta/i)).toBeTruthy()

    fireEvent.click(botao)
    expect(enviar).not.toHaveBeenCalled()
  })

  it('caso 7: confirmacao inline — cancelar nao chama; confirmar chama com (leadId, scriptId)', async () => {
    const enviar = enviarOk()
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO_COMPLETO}
        telefoneE164={TELEFONE}
        templates={[template()]}
        enviar={enviar}
      />,
    )

    // Primeiro clique NAO envia: e' mensagem de verdade para o cliente.
    fireEvent.click(screen.getByRole('button', { name: 'Enviar WhatsApp' }))
    expect(enviar).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Enviar WhatsApp' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar envio' }))
    expect(enviar).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Enviar WhatsApp' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar envio' }))

    await waitFor(() => expect(enviar).toHaveBeenCalledTimes(1))
    // O id do lead e o do script, e nada vindo da tela sobre TEMPLATE: quem
    // resolve o template e' o servidor, na conta ativa.
    expect(enviar).toHaveBeenCalledWith('lead-1', 'script-1')

    // Feedback transitorio, padrao do "Copiado ✓".
    expect(await screen.findByText('Enviado')).toBeTruthy()
    // O nome acessivel do botao nao muda depois do uso.
    expect(screen.getByRole('button', { name: 'Enviar WhatsApp' })).toBeTruthy()
  })

  it('caso 9: dois cliques no mesmo frame mandam UMA mensagem', async () => {
    // O modo de falha que este caso tranca custa dinheiro e constrange o
    // cliente: dois cliques rapidos em "Confirmar envio" acontecem antes do
    // re-render, entao o `disabled` do DOM ainda nao valia e um guard lido do
    // ESTADO (`if (enviando) return`) leria `false` nas duas closures — duas
    // mensagens iguais entregues, duas cobradas pelo Meta. So uma trava
    // sincrona (ref) fecha essa janela.
    let liberar: (r: { ok: true; valor: undefined }) => void = () => {}
    const emCurso = new Promise<{ ok: true; valor: undefined }>((res) => {
      liberar = res
    })
    const enviar = vi.fn(() => emCurso)

    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO_COMPLETO}
        telefoneE164={TELEFONE}
        templates={[template()]}
        enviar={enviar}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Enviar WhatsApp' }))
    const confirmar = screen.getByRole('button', { name: 'Confirmar envio' })

    // Os dois cliques DENTRO do mesmo act(), e com .click() nativo em vez de
    // fireEvent: cada fireEvent abre o seu proprio act e FLUSHA o estado entre
    // um e outro, o que faz o `disabled={enviando}` ja valer no segundo — o
    // teste passaria sem provar nada, inclusive com o guard antigo lido do
    // estado (verificado). Num navegador de verdade os dois cliques rapidos
    // chegam antes do re-render, e e' isso que este bloco reproduz.
    await act(async () => {
      confirmar.click()
      confirmar.click()
    })

    expect(enviar).toHaveBeenCalledTimes(1)

    // A chamada em curso termina e o feedback aparece uma vez so.
    liberar({ ok: true, valor: undefined })
    expect(await screen.findByText('Enviado')).toBeTruthy()
    expect(enviar).toHaveBeenCalledTimes(1)
  })

  it('falha da action vira mensagem traduzida, nunca o codigo cru', async () => {
    const enviar = vi.fn(async () => ({ ok: false as const, erro: 'envio_recusado' }))
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO_COMPLETO}
        telefoneE164={TELEFONE}
        templates={[template()]}
        enviar={enviar}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Enviar WhatsApp' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar envio' }))

    expect(
      await screen.findByText('O Meta recusou o envio. Confira o template e tente de novo.'),
    ).toBeTruthy()
    expect(screen.queryByText('envio_recusado')).toBeNull()
    expect(screen.queryByText('Enviado ✓')).toBeNull()
  })
})

describe('foco ao abrir a confirmacao de envio', () => {
  it('move o foco para o Cancelar — a acao menos destrutiva — ao abrir', () => {
    const enviar = enviarOk()
    render(
      <PainelScripts
        leadId="lead-1"
        scripts={[script()]}
        contexto={CONTEXTO_COMPLETO}
        telefoneE164={TELEFONE}
        templates={[template()]}
        enviar={enviar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Enviar WhatsApp' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar envio' }))
  })
})
