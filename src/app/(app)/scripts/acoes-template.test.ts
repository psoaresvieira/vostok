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
 * `falso` e' o duplo compartilhado do teste; `graph` e' o que a fabrica
 * devolve. Os dois apontam para o mesmo objeto por padrao — os dois casos que
 * precisam de uma resposta que a falsa nao produz (status em maiuscula, recusa
 * do Meta) trocam so `graph`, e continuam podendo afirmar sobre `falso`.
 */
let falso = new WhatsAppGraphFalso()
let graph: WhatsAppGraph = falso

vi.mock('@/lib/integracoes/fabrica', () => ({
  whatsappGraph: () => graph,
}))

import { submeterTemplate } from './acoes-template'

/** Graph que delega tudo a `falso` menos a submissao. */
function graphComSubmissao(
  resposta: Resultado<TemplateSubmetido>,
): WhatsAppGraph {
  return {
    dadosDoNumero: (t, p) => falso.dadosDoNumero(t, p),
    statusDoTemplate: (t, w, n) => falso.statusDoTemplate(t, w, n),
    apagarTemplate: (t, w, n) => falso.apagarTemplate(t, w, n),
    enviarTemplate: (t, p, e, d) => falso.enviarTemplate(t, p, e, d),
    async submeterTemplate(token, wabaId, d) {
      falso.submetidos.push({ token, wabaId, ...d })
      return resposta
    },
  }
}

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
    graph = falso
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
    graph = graphComSubmissao({ ok: true, valor: { idMeta: 'id-1', status: 'PENDING' } })

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r.ok).toBe(true)
    expect(templatesStoreMock.criar.mock.calls[0][0].status).toBe('pending')
  })

  it('caso 5 — re-submissao apaga o nome antigo no Meta e substitui a linha', async () => {
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
    expect(templatesStoreMock.substituir).toHaveBeenCalledTimes(1)
    expect(templatesStoreMock.substituir.mock.calls[0][0]).toBe('template-1')
    expect(templatesStoreMock.criar).not.toHaveBeenCalled()
  })

  it('caso 5b — falha do apagar NAO bloqueia a re-submissao', async () => {
    cenarioFeliz()
    templatesStoreMock.doScript.mockResolvedValue({
      ok: true,
      valor: template({ status: 'rejected', nomeMeta: 'nome_antigo_11111111' }),
    })
    falso.apagaresQueFalham.add('nome_antigo_11111111')

    const r = await submeterTemplate('script-1', 'marketing')

    expect(r).toEqual({ ok: true, valor: undefined })
    expect(falso.apagados).toHaveLength(1)
    // A submissao seguiu mesmo com o delete recusado: o nome novo nunca colide.
    expect(falso.submetidos).toHaveLength(1)
    expect(templatesStoreMock.substituir).toHaveBeenCalledTimes(1)
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
    graph = graphComSubmissao({ ok: false, erro: 'template_recusado_pelo_meta' })

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
