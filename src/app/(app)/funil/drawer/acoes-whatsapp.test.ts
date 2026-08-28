import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WhatsAppGraphFalso } from '@/lib/integracoes/whatsapp-falso'
import {
  contextoDoLead,
  interpolar,
  textoPlano,
  type Variavel,
} from '@/lib/domain/script'
import type { Lead } from '@/lib/domain/tipos'

/**
 * Unidade, na forma de scripts/acoes-template.test.ts: stores mockados por
 * vi.mock e o WhatsAppGraph FALSO de verdade (nao um spy) no lugar da fabrica.
 * As asercoes sao sobre o estado do duplo — `enviados` —, que e' o que prova
 * ordem das guardas e ausencia de IO sem espionar chamada nenhuma.
 */

const storeMock = {
  buscarLead: vi.fn(),
  pipelinePadrao: vi.fn(),
  membros: vi.fn(),
  registrarEnvioWhatsApp: vi.fn(),
}

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

let revalidados: string[] = []
vi.mock('next/cache', () => ({
  revalidatePath: (caminho: string) => {
    revalidados.push(caminho)
  },
}))

const criarStoreDoServidorMock = vi.fn()
const criarScriptStoreDoServidorMock = vi.fn()
const criarTemplateStoreDoServidorMock = vi.fn()
const criarDisparoServicoMock = vi.fn()

vi.mock('@/lib/data/supabase', () => ({
  criarStoreDoServidor: (...args: unknown[]) => criarStoreDoServidorMock(...args),
}))

vi.mock('@/lib/data/scripts', () => ({
  criarScriptStoreDoServidor: (...args: unknown[]) => criarScriptStoreDoServidorMock(...args),
}))

vi.mock('@/lib/data/templates', () => ({
  criarTemplateStoreDoServidor: (...args: unknown[]) => criarTemplateStoreDoServidorMock(...args),
  criarDisparoServico: (...args: unknown[]) => criarDisparoServicoMock(...args),
}))

/** Reatribuido a cada teste; a fabrica le a variavel, e nao uma copia. */
let falso = new WhatsAppGraphFalso()
vi.mock('@/lib/integracoes/fabrica', () => ({
  whatsappGraph: () => falso,
}))

import { enviarWhatsApp } from './acoes-whatsapp'

const CONTA_ID = 'conta-1'
const CREDENCIAL = { token: 'tok-1', phoneNumberId: 'phone-1', wabaId: 'waba-1' }
const NOME_META = 'abordagem_inicial_aaaaaaaa'

const CONTEUDO = 'Olá {{primeiro_nome}}, tudo bem na {{empresa}}? Falo com {{primeiro_nome}}?'
/** O que `traduzirParaPosicional(CONTEUDO)` produz — snapshot da submissao. */
const CORPO_POSICIONAL = 'Olá {{1}}, tudo bem na {{2}}? Falo com {{1}}?'
const MAPA: Variavel[] = ['primeiro_nome', 'empresa']

const ETAPAS = [{ id: 'etapa-1', nome: 'Novo lead' }]
const MEMBROS = [{ id: 'user-1', nome: 'Pedro' }]

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    accountId: CONTA_ID,
    nome: 'Maria da Silva',
    telefone: '(11) 91234-5678',
    telefoneE164: '+5511912345678',
    email: 'maria@exemplo.com.br',
    emailNorm: 'maria@exemplo.com.br',
    empresa: 'Loja da Maria',
    origem: 'manual',
    pipelineId: 'pipe-1',
    stageId: 'etapa-1',
    responsavelId: 'user-1',
    status: 'aberto',
    valorCents: 150000,
    lossReasonId: null,
    entrouNaEtapaEm: new Date('2026-08-01T00:00:00Z'),
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    atualizadoEm: new Date('2026-08-01T00:00:00Z'),
    etiquetas: [],
    ...overrides,
  }
}

function script(overrides: Record<string, unknown> = {}) {
  return {
    id: 'script-1',
    titulo: 'Abordagem inicial',
    conteudo: CONTEUDO,
    stageId: 'etapa-1',
    tags: [],
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    atualizadoEm: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  }
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    scriptId: 'script-1',
    nomeMeta: NOME_META,
    idioma: 'pt_BR',
    categoria: 'marketing' as const,
    corpoPosicional: CORPO_POSICIONAL,
    mapa: MAPA,
    status: 'approved',
    motivoRejeicao: null,
    statusConsultadoEm: null,
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  }
}

/**
 * Estado feliz: lead visivel com telefone, template aprovado batendo com o
 * conteudo atual, credencial ok, e o template registrado como approved na
 * falsa (o Graph tambem recusa envio de template nao aprovado).
 */
function cenarioFeliz(papel: 'admin' | 'gestor' | 'vendedor' = 'admin') {
  criarStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { store: storeMock, conta: { id: CONTA_ID }, usuarioId: 'user-1', papel },
  })
  criarScriptStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { scripts: scriptsStoreMock, papel },
  })
  criarTemplateStoreDoServidorMock.mockResolvedValue({
    ok: true,
    valor: { templates: templatesStoreMock, papel, contaId: CONTA_ID },
  })
  criarDisparoServicoMock.mockReturnValue({ ok: true, valor: disparoMock })

  storeMock.buscarLead.mockResolvedValue({ ok: true, valor: lead() })
  storeMock.pipelinePadrao.mockResolvedValue({
    ok: true,
    valor: { pipeline: { id: 'pipe-1', nome: 'Padrão' }, etapas: ETAPAS },
  })
  storeMock.membros.mockResolvedValue({ ok: true, valor: MEMBROS })
  storeMock.registrarEnvioWhatsApp.mockResolvedValue({ ok: true, valor: undefined })

  scriptsStoreMock.buscar.mockResolvedValue({ ok: true, valor: script() })
  templatesStoreMock.doScript.mockResolvedValue({ ok: true, valor: template() })
  disparoMock.credencial.mockResolvedValue({ ok: true, valor: CREDENCIAL })

  falso.templates.set(NOME_META, {
    status: 'approved',
    motivo: null,
    corpo: CORPO_POSICIONAL,
    categoria: 'marketing',
  })
}

describe('enviarWhatsApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    falso = new WhatsAppGraphFalso()
    revalidados = []
  })

  it('caso 1 — a ordem das guardas: cada recusa com o seu codigo e NENHUMA chamada ao Graph', async () => {
    // Cada cenario desliga exatamente uma guarda do estado feliz, na ordem em
    // que a action as avalia. O que o caso tranca nao e' so o codigo: e' que
    // recusa de dominio (lead, template, snapshot, lacuna) nao custa
    // round-trip ao Meta — `enviados` do duplo continua vazio em todas.
    const cenarios: [string, () => void, string][] = [
      [
        'lead invisivel ou inexistente',
        () => storeMock.buscarLead.mockResolvedValue({ ok: true, valor: null }),
        'lead_nao_encontrado',
      ],
      [
        'lead sem telefone',
        () =>
          storeMock.buscarLead.mockResolvedValue({
            ok: true,
            valor: lead({ telefoneE164: null }),
          }),
        'whatsapp_sem_telefone',
      ],
      [
        'script sem template',
        () => templatesStoreMock.doScript.mockResolvedValue({ ok: true, valor: null }),
        'template_nao_aprovado',
      ],
      [
        'template ainda em analise',
        () =>
          templatesStoreMock.doScript.mockResolvedValue({
            ok: true,
            valor: template({ status: 'pending' }),
          }),
        'template_nao_aprovado',
      ],
      [
        'script editado depois da aprovacao',
        () =>
          scriptsStoreMock.buscar.mockResolvedValue({
            ok: true,
            valor: script({ conteudo: 'Olá {{primeiro_nome}}, outro texto.' }),
          }),
        'template_desatualizado',
      ],
      [
        'lead sem o dado de uma posicao do mapa',
        () =>
          storeMock.buscarLead.mockResolvedValue({ ok: true, valor: lead({ empresa: null }) }),
        'whatsapp_lacunas',
      ],
      [
        'conta sem conexao de WhatsApp',
        () => disparoMock.credencial.mockResolvedValue({ ok: false, erro: 'sem_conexao_whatsapp' }),
        'sem_conexao_whatsapp',
      ],
    ]

    for (const [nome, quebrar, codigo] of cenarios) {
      vi.clearAllMocks()
      falso = new WhatsAppGraphFalso()
      revalidados = []
      cenarioFeliz()
      quebrar()

      const r = await enviarWhatsApp('lead-1', 'script-1')

      expect(r, nome).toEqual({ ok: false, erro: codigo })
      expect(falso.enviados, nome).toEqual([])
      expect(storeMock.registrarEnvioWhatsApp, nome).not.toHaveBeenCalled()
      expect(revalidados, nome).toEqual([])
    }
  })

  it('caso 2 — fluxo feliz: o que foi ao Graph e o texto do evento, byte a byte igual ao do preview', async () => {
    cenarioFeliz()

    const r = await enviarWhatsApp('lead-1', 'script-1')

    expect(r).toEqual({ ok: true, valor: undefined })

    // O que foi ao Meta: credencial da conta ativa, destino E.164 do lead,
    // nome/idioma do template GRAVADO e valores na ordem do mapa.
    expect(falso.enviados).toEqual([
      {
        token: 'tok-1',
        phoneNumberId: 'phone-1',
        e164Destino: '+5511912345678',
        nome: NOME_META,
        valores: ['Maria', 'Loja da Maria'],
      },
    ])

    // A COMUTACAO, que e' o coracao deste caso: o texto gravado na timeline —
    // preencherPosicional(corpo do snapshot, valores) — e' byte a byte o mesmo
    // que o preview e o Copiar produzem por outro caminho,
    // textoPlano(interpolar(conteudo, contexto)). Duas gramaticas que
    // divergissem em um unico caractere fariam o cliente receber algo diferente
    // do que o vendedor leu na tela.
    const contexto = contextoDoLead(
      lead(),
      new Map(ETAPAS.map((e) => [e.id, e.nome])),
      new Map(MEMBROS.map((m) => [m.id, m.nome])),
    )
    const esperado = textoPlano(interpolar(CONTEUDO, contexto))
    expect(esperado).toBe('Olá Maria, tudo bem na Loja da Maria? Falo com Maria?')

    expect(storeMock.registrarEnvioWhatsApp).toHaveBeenCalledTimes(1)
    expect(storeMock.registrarEnvioWhatsApp).toHaveBeenCalledWith('lead-1', {
      template: NOME_META,
      texto: esperado,
    })
    expect(revalidados).toEqual(['/funil'])
  })

  it('caso 3 — envio ok e evento falho vira whatsapp_enviado_sem_evento, COM revalidate', async () => {
    cenarioFeliz()
    storeMock.registrarEnvioWhatsApp.mockResolvedValue({
      ok: false,
      erro: 'erro_ao_salvar_evento',
    })

    const r = await enviarWhatsApp('lead-1', 'script-1')

    // A mensagem FOI para o cliente: nunca um codigo que diga o contrario.
    expect(r).toEqual({ ok: false, erro: 'whatsapp_enviado_sem_evento' })
    expect(falso.enviados).toHaveLength(1)
    // Revalida mesmo assim — o lead mudou de estado no mundo, ainda que a
    // linha do tempo nao registre.
    expect(revalidados).toEqual(['/funil'])
  })

  it('recusa do Graph nao escreve evento nenhum na timeline', async () => {
    cenarioFeliz()
    // Template fora do mapa da falsa: ela recusa como o Graph recusaria.
    falso.templates.delete(NOME_META)

    const r = await enviarWhatsApp('lead-1', 'script-1')

    expect(r).toEqual({ ok: false, erro: 'envio_recusado' })
    expect(falso.enviados).toHaveLength(1)
    expect(storeMock.registrarEnvioWhatsApp).not.toHaveBeenCalled()
    expect(revalidados).toEqual([])
  })

  it('vendedor dispara: nao ha gate de papel neste caminho (so na submissao)', async () => {
    cenarioFeliz('vendedor')

    const r = await enviarWhatsApp('lead-1', 'script-1')

    expect(r).toEqual({ ok: true, valor: undefined })
    expect(falso.enviados).toHaveLength(1)
  })

  it('erro de vocabulario alheio na construcao do store nunca sobe cru', async () => {
    cenarioFeliz()
    criarTemplateStoreDoServidorMock.mockResolvedValue({
      ok: false,
      erro: 'new row violates row-level security policy for table "memberships"',
    })

    const r = await enviarWhatsApp('lead-1', 'script-1')

    expect(r).toEqual({ ok: false, erro: 'erro_ao_salvar_template' })
    expect(falso.enviados).toEqual([])
  })
})
