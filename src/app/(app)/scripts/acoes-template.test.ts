import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WhatsAppGraphFalso } from '@/lib/integracoes/whatsapp-falso'
import type { TemplateSubmetido, WhatsAppGraph } from '@/lib/integracoes/whatsapp'
import type { Resultado } from '@/lib/domain/resultado'

/**
 * Unidade, na forma de scripts/acoes.test.ts: stores mockados por vi.mock e o
 * WhatsAppGraph FALSO de verdade (nao um spy) no lugar da fabrica. As asercoes
 * sao sobre o estado do duplo — `submetidos`, `apagados` —, que e' o que prova
 * ordem e ausencia de IO sem espionar chamada nenhuma.
 */

const scriptsStoreMock = {
  listar: vi.fn(),
  buscar: vi.fn(),
  paraEtapa: vi.fn(),
  criar: vi.fn(),
  atualizar: vi.fn(),
  excluir: vi.fn(),
  tagsDaConta: vi.fn(),
}

const templatesStoreMock = {
  doScript: vi.fn(),
  dosScripts: vi.fn(),
  criar: vi.fn(),
  substituir: vi.fn(),
  excluir: vi.fn(),
}

const disparoMock = {
  credencial: vi.fn(),
  atualizarStatus: vi.fn(),
}

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

const criarScriptStoreDoServidorMock = vi.fn()
const criarTemplateStoreDoServidorMock = vi.fn()
const criarDisparoServicoMock = vi.fn()

vi.mock('@/lib/data/scripts', () => ({
  criarScriptStoreDoServidor: (...args: unknown[]) => criarScriptStoreDoServidorMock(...args),
}))

vi.mock('@/lib/data/templates', () => ({
  criarTemplateStoreDoServidor: (...args: unknown[]) => criarTemplateStoreDoServidorMock(...args),
  criarDisparoServico: (...args: unknown[]) => criarDisparoServicoMock(...args),
}))

/**
 * `falso` e' o duplo compartilhado; `graph` e' o que a fabrica devolve — um
 * envelope fino em volta dele que registra a SEQUENCIA das chamadas em `ordem`
 * (os registros do duplo sao um array por metodo, e sozinhos nao diriam se o
 * apagar veio antes ou depois do submeter) e deixa `submissao` sobrescrever a
 * resposta da submissao nos casos que a falsa nao produz.
 */
let falso = new WhatsAppGraphFalso()
let ordem: string[] = []
let submissao: Resultado<TemplateSubmetido> | null = null

const graph: WhatsAppGraph = {
  dadosDoNumero: (t, p) => falso.dadosDoNumero(t, p),
  statusDoTemplate: (t, w, n) => falso.statusDoTemplate(t, w, n),
  enviarTemplate: (t, p, e, d) => falso.enviarTemplate(t, p, e, d),
  async apagarTemplate(token, wabaId, nome) {
    ordem.push('apagar')
    return falso.apagarTemplate(token, wabaId, nome)
  },
  async submeterTemplate(token, wabaId, d) {
    ordem.push('submeter')
    if (submissao) {
      falso.submetidos.push({ token, wabaId, ...d })
      return submissao
    }
    return falso.submeterTemplate(token, wabaId, d)
  },
}

vi.mock('@/lib/integracoes/fabrica', () => ({
  whatsappGraph: () => graph,
}))

import { excluirTemplate, submeterTemplate } from './acoes-template'

const CONTA_ID = 'conta-1'
const CREDENCIAL = { token: 'tok-1', phoneNumberId: 'phone-1', wabaId: 'waba-1' }

function script(overrides: Record<string, unknown> = {}) {
  return {
    id: 'script-1',
    titulo: 'Abordagem inicial',
    conteudo: 'Olá {{primeiro_nome}}, aqui é {{responsavel}}. Falo com {{primeiro_nome}}?',
    stageId: null,
    tags: [],
    criadoEm: new Date('2026-01-01T00:00:00Z'),
    atualizadoEm: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    scriptId: 'script-1',
    nomeMeta: 'abordagem_inicial_aaaaaaaa',
    idioma: 'pt_BR',
    categoria: 'marketing' as const,
    corpoPosicional: 'Olá {{1}}',
    mapa: ['primeiro_nome'],
    status: 'approved',
    motivoRejeicao: null,
    statusConsultadoEm: null,
    criadoEm: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

const CORPO_TRADUZIDO = 'Olá {{1}}, aqui é {{2}}. Falo com {{1}}?'

/** Estado feliz: admin, script existente, sem template, credencial ok. */
function cenarioFeliz(papel: 'admin' | 'gestor' | 'vendedor' = 'admin') {
  criarScriptStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { scripts: scriptsStoreMock, papel },
  })
  criarTemplateStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { templates: templatesStoreMock, papel, contaId: CONTA_ID },
  })
  criarDisparoServicoMock.mockReturnValue({ ok: true, valor: disparoMock })
  scriptsStoreMock.buscar.mockResolvedValue({ ok: true, valor: script() })
  templatesStoreMock.doScript.mockResolvedValue({ ok: true, valor: null })
  templatesStoreMock.criar.mockResolvedValue({ ok: true, valor: 'template-novo' })
  templatesStoreMock.substituir.mockResolvedValue({ ok: true, valor: undefined })
  disparoMock.credencial.mockResolvedValue({ ok: true, valor: CREDENCIAL })
}

describe('submeterTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    falso = new WhatsAppGraphFalso()
    ordem = []
    submissao = null
  })

  it('caso 1 — vendedor recebe sem_permissao e nenhum IO acontece', async () => {
    cenarioFeliz('vendedor')

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
    // Nem o script foi lido, nem o Graph tocado, nem o store escrito.
    expect(scriptsStoreMock.buscar).not.toHaveBeenCalled()
    expect(templatesStoreMock.doScript).not.toHaveBeenCalled()
    expect(disparoMock.credencial).not.toHaveBeenCalled()
    expect(falso.submetidos).toEqual([])
    expect(falso.apagados).toEqual([])
    expect(templatesStoreMock.criar).not.toHaveBeenCalled()
  })

  it('caso 2 — variavel desconhecida recusa ANTES do Graph e antes da credencial', async () => {
    cenarioFeliz()
    scriptsStoreMock.buscar.mockResolvedValue({
      ok: true,
      valor: script({ conteudo: 'Olá {{nome_do_cachorro}}' }),
    })

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: false, erro: 'template_variavel_desconhecida' })
    // O duplo nao registrou chamada nenhuma: a recusa e' de dominio, e nao
    // pode custar um round-trip ao Meta.
    expect(falso.submetidos).toEqual([])
    expect(falso.apagados).toEqual([])
    expect(disparoMock.credencial).not.toHaveBeenCalled()
    expect(templatesStoreMock.criar).not.toHaveBeenCalled()
  })

  it('caso 2b — {{N}} literal recusa com template_posicional_reservado, tambem antes do Graph', async () => {
    cenarioFeliz()
    scriptsStoreMock.buscar.mockResolvedValue({
      ok: true,
      valor: script({ conteudo: 'Desconto de {{1}} real para {{primeiro_nome}}' }),
    })

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: false, erro: 'template_posicional_reservado' })
    expect(falso.submetidos).toEqual([])
    expect(disparoMock.credencial).not.toHaveBeenCalled()
  })

  it('caso 3 — template pending devolve template_ja_pendente sem tocar o Graph', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({
      ok: true,
      valor: template({ status: 'pending' }),
    })

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: false, erro: 'template_ja_pendente' })
    expect(falso.submetidos).toEqual([])
    expect(falso.apagados).toEqual([])
    expect(disparoMock.credencial).not.toHaveBeenCalled()
    expect(templatesStoreMock.substituir).not.toHaveBeenCalled()
  })

  it('caso 4 — fluxo feliz grava o corpo/mapa DA TRADUCAO e o status que o Graph devolveu', async () => {
    cenarioFeliz()

    const r = await submeterTemplate('script-1', 'utility')

    expect(r).toEqual({ ok: true, valor: undefined })

    // O que foi ao Meta: corpo posicional, nunca o conteudo com {{nome}}.
    expect(falso.submetidos).toHaveLength(1)
    const enviado = falso.submetidos[0]
    expect(enviado.token).toBe('tok-1')
    expect(enviado.wabaId).toBe('waba-1')
    expect(enviado.categoria).toBe('utility')
    expect(enviado.idioma).toBe('pt_BR')
    expect(enviado.corpo).toBe(CORPO_TRADUZIDO)
    // nomeMetaDoTitulo(titulo, sufixo): prefixo pinado, sufixo aleatorio.
    expect(enviado.nome).toMatch(/^abordagem_inicial_[a-z0-9]+$/)

    // O que foi gravado: o MESMO corpo/mapa que foi ao Meta (snapshot), o
    // status devolvido pelo Graph, e o nome que o Graph recebeu.
    expect(templatesStoreMock.criar).toHaveBeenCalledTimes(1)
    expect(templatesStoreMock.substituir).not.toHaveBeenCalled()
    expect(templatesStoreMock.criar.mock.calls[0][0]).toEqual({
      scriptId: 'script-1',
      nomeMeta: enviado.nome,
      idioma: 'pt_BR',
      categoria: 'utility',
      corpoPosicional: CORPO_TRADUZIDO,
      mapa: ['primeiro_nome', 'responsavel'],
      status: 'approved',
      templateIdMeta: `template-falso-${enviado.nome}`,
    })
  })

  it('caso 4b — status do Graph em maiuscula chega minusculo ao store', async () => {
    cenarioFeliz()
    submissao = { ok: true, valor: { idMeta: 'id-1', status: 'PENDING' } }

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r.ok).toBe(true)
    expect(templatesStoreMock.criar.mock.calls[0][0].status).toBe('pending')
  })

  it('caso 5 — re-submissao substitui a linha e apaga o nome antigo DEPOIS de gravar', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({
      ok: true,
      valor: template({ status: 'rejected', nomeMeta: 'nome_antigo_11111111' }),
    })

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: true, valor: undefined })
    expect(falso.apagados).toEqual([
      { token: 'tok-1', wabaId: 'waba-1', nome: 'nome_antigo_11111111' },
    ])
    // A ORDEM e' o contrato (emenda ao plano): apagar antes de submeter deixaria
    // a linha antiga 'approved' no banco apontando para um nome que ja nao
    // existe na WABA, se o Meta recusasse a nova.
    expect(ordem).toEqual(['submeter', 'apagar'])
    expect(templatesStoreMock.substituir).toHaveBeenCalledTimes(1)
    expect(templatesStoreMock.substituir.mock.calls[0][0]).toBe('template-1')
    expect(templatesStoreMock.criar).not.toHaveBeenCalled()
  })

  it('caso 5b — falha do apagar NAO bloqueia a re-submissao ja gravada', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({
      ok: true,
      valor: template({ status: 'rejected', nomeMeta: 'nome_antigo_11111111' }),
    })
    falso.apagaresQueFalham.add('nome_antigo_11111111')

    const r = await submeterTemplate('script-1', 'marketing')

    // Higiene da WABA que nao deu certo nao pode virar erro de uma submissao
    // que deu: a linha nova ja esta gravada quando o apagar acontece.
    expect(r).toEqual({ ok: true, valor: undefined })
    expect(falso.apagados).toHaveLength(1)
    expect(falso.submetidos).toHaveLength(1)
    expect(ordem).toEqual(['submeter', 'apagar'])
    expect(templatesStoreMock.substituir).toHaveBeenCalledTimes(1)
  })

  it('caso 5c — Meta recusa a re-submissao: a linha antiga fica intacta e o nome antigo NAO e apagado', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({
      ok: true,
      valor: template({ status: 'approved', nomeMeta: 'nome_antigo_11111111' }),
    })
    submissao = { ok: false, erro: 'template_recusado_pelo_meta' }

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: false, erro: 'template_recusado_pelo_meta' })
    // O template que o usuario TEM continua valendo: nada foi gravado por cima
    // e o nome dele continua registrado no Meta. Fosse o apagar antes, a linha
    // seguiria 'approved' — estado FINAL, que a atualizacao sob demanda nunca
    // reconsulta — apontando para um nome ja removido da WABA, e todo envio
    // daria 'envio_recusado' sem nada na tela explicando por que.
    expect(falso.apagados).toEqual([])
    expect(ordem).toEqual(['submeter'])
    expect(templatesStoreMock.substituir).not.toHaveBeenCalled()
    expect(templatesStoreMock.criar).not.toHaveBeenCalled()
  })

  it('sem conexao de WhatsApp devolve sem_conexao_whatsapp sem tocar o Graph', async () => {
    cenarioFeliz()
    disparoMock.credencial.mockResolvedValue({ ok: false, erro: 'sem_conexao_whatsapp' })

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: false, erro: 'sem_conexao_whatsapp' })
    expect(falso.submetidos).toEqual([])
    expect(falso.apagados).toEqual([])
  })

  it('script inexistente devolve script_nao_encontrado', async () => {
    cenarioFeliz()
    scriptsStoreMock.buscar.mockResolvedValue({ ok: true, valor: null })

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: false, erro: 'script_nao_encontrado' })
    expect(falso.submetidos).toEqual([])
  })

  it('categoria forjada e recusada antes de qualquer IO', async () => {
    cenarioFeliz()

    const r = await submeterTemplate('script-1', 'promo' as unknown as 'marketing')

    expect(r).toEqual({ ok: false, erro: 'template_categoria_invalida' })
    expect(criarScriptStoreDoServidorMock).not.toHaveBeenCalled()
    expect(falso.submetidos).toEqual([])
  })

  it('recusa do Meta na submissao nao grava nada no store', async () => {
    cenarioFeliz()
    submissao = { ok: false, erro: 'template_recusado_pelo_meta' }

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: false, erro: 'template_recusado_pelo_meta' })
    expect(templatesStoreMock.criar).not.toHaveBeenCalled()
    expect(templatesStoreMock.substituir).not.toHaveBeenCalled()
  })

  it('erro de vocabulario alheio na construcao do store vira erro_ao_salvar_template', async () => {
    cenarioFeliz()
    criarTemplateStoreDoServidorMock.mockResolvedValue({
      ok: false,
      erro: 'permission denied for table memberships',
    })

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: false, erro: 'erro_ao_salvar_template' })
  })
})

/**
 * Exclusao e' o que abre o caminho "exclua e submeta" que a re-submissao
 * deliberadamente nao cobre: trocar a categoria exige comecar do zero, e ate
 * aqui o TemplateStore.excluir existia sem nenhum chamador na UI.
 */
describe('excluirTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    falso = new WhatsAppGraphFalso()
    ordem = []
    submissao = null
    templatesStoreMock.excluir.mockImplementation(async () => {
      // Mesmo registro de sequencia do envelope do Graph: os arrays por metodo
      // nao diriam se o banco apagou antes ou depois da WABA.
      ordem.push('excluir-local')
      return { ok: true, valor: undefined }
    })
    templatesStoreMock.doScript.mockResolvedValue({ ok: true, valor: template() })
  })

  it('caso 1 — vendedor recebe sem_permissao e nada e apagado, nem local nem no Meta', async () => {
    cenarioFeliz('vendedor')

    const r = await excluirTemplate('script-1')

    expect(r).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(templatesStoreMock.doScript).not.toHaveBeenCalled()
    expect(templatesStoreMock.excluir).not.toHaveBeenCalled()
    expect(falso.apagados).toEqual([])
  })

  it('caso 2 — script sem template devolve template_nao_encontrado sem tocar o Graph', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({ ok: true, valor: null })

    const r = await excluirTemplate('script-1')

    expect(r).toEqual({ ok: false, erro: 'template_nao_encontrado' })
    expect(templatesStoreMock.excluir).not.toHaveBeenCalled()
    expect(falso.apagados).toEqual([])
  })

  it('caso 3 — fluxo feliz: apaga no banco ANTES da WABA, e o Graph recebe o nomeMeta gravado', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({ ok: true, valor: template() })

    const r = await excluirTemplate('script-1')

    expect(r).toEqual({ ok: true, valor: undefined })
    expect(templatesStoreMock.excluir).toHaveBeenCalledTimes(1)
    expect(templatesStoreMock.excluir.mock.calls[0][0]).toBe('template-1')
    expect(falso.apagados).toEqual([
      { token: 'tok-1', wabaId: 'waba-1', nome: 'abordagem_inicial_aaaaaaaa' },
    ])
    // Local primeiro: o pedido do usuario e' tirar o template do CRM, e ele
    // nao pode ficar refem do Meta fora do ar. A WABA e' higiene best-effort.
    expect(ordem).toEqual(['excluir-local', 'apagar'])
  })

  it('caso 4 — falha do Graph nao desfaz nem falha: o banco ja apagou e a acao devolve ok', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({ ok: true, valor: template() })
    falso.apagaresQueFalham.add('abordagem_inicial_aaaaaaaa')

    const r = await excluirTemplate('script-1')

    expect(r).toEqual({ ok: true, valor: undefined })
    expect(templatesStoreMock.excluir).toHaveBeenCalledTimes(1)
    expect(falso.apagados).toHaveLength(1)
  })

  it('caso 5 — sem credencial a exclusao local vale e o Graph nem e chamado', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({ ok: true, valor: template() })
    disparoMock.credencial.mockResolvedValue({ ok: false, erro: 'sem_conexao_whatsapp' })

    const r = await excluirTemplate('script-1')

    expect(r).toEqual({ ok: true, valor: undefined })
    expect(templatesStoreMock.excluir).toHaveBeenCalledTimes(1)
    expect(falso.apagados).toEqual([])
  })

  it('caso 6 — falha do store propaga e a WABA fica intacta', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({ ok: true, valor: template() })
    templatesStoreMock.excluir.mockResolvedValue({ ok: false, erro: 'template_nao_encontrado' })

    const r = await excluirTemplate('script-1')

    expect(r).toEqual({ ok: false, erro: 'template_nao_encontrado' })
    expect(falso.apagados).toEqual([])
  })
})
