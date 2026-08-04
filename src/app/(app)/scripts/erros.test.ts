import { describe, it, expect } from 'vitest'
import { codigoDoErroDoPainel, codigoDoErroDoTemplate, mensagemDeErroScript } from './erros'
import { FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'

/**
 * Os codigos aqui sao os que as tres Server Actions de scripts/acoes.ts e o
 * SupabaseScriptStore (lib/data/scripts.ts) realmente devolvem. A lista e'
 * literal de proposito, como o mapa: se uma chave sumir do mapa, este teste
 * fica vermelho em vez de a tela passar a mostrar o codigo cru.
 */
const CODIGOS_SCRIPT = [
  'titulo_vazio',
  'conteudo_vazio',
  'tags_demais',
  'etapa_invalida',
  'script_nao_encontrado',
  'sem_permissao',
  'sem_sessao',
  'erro_ao_salvar_script',
  'erro_ao_carregar_scripts',
  FALHA_DE_CONEXAO,
]

/**
 * Os codigos do disparo (Plano 11): o que submeterTemplate (acoes-template.ts),
 * o SupabaseTemplateStore, o DisparoServico e o WhatsAppGraph devolvem. Lista
 * literal pelo mesmo motivo da de cima — e separada porque quem le esta tela
 * precisa saber de qual vocabulario cada chave veio.
 */
const CODIGOS_TEMPLATE = [
  'sem_conexao_whatsapp',
  'template_variavel_desconhecida',
  'template_posicional_reservado',
  'template_categoria_invalida',
  'template_ja_pendente',
  'template_ja_existe',
  'template_recusado_pelo_meta',
  'template_nao_encontrado',
  'template_nao_aprovado',
  'template_desatualizado',
  'lead_nao_encontrado',
  'whatsapp_sem_telefone',
  'whatsapp_lacunas',
  'envio_recusado',
  'whatsapp_indisponivel',
  'whatsapp_enviado_sem_evento',
  'erro_ao_salvar_template',
  'erro_ao_carregar_templates',
]

const CODIGOS = [...CODIGOS_SCRIPT, ...CODIGOS_TEMPLATE]

describe('mensagemDeErroScript', () => {
  it('toda chave conhecida tem mensagem propria — nunca o codigo, nunca o Postgres cru', () => {
    const vistas = new Set<string>()
    for (const codigo of CODIGOS) {
      const mensagem = mensagemDeErroScript(codigo)
      // Nao caiu no fallback que devolve o proprio codigo.
      expect(mensagem, codigo).not.toBe(codigo)
      // Mensagem de gente: comeca com maiuscula e termina em ponto.
      expect(mensagem, codigo).toMatch(/^[A-ZÀ-Ú][\s\S]*\.$/)
      // Nunca a mensagem crua do PostgREST/Postgres.
      expect(mensagem, codigo).not.toMatch(/row-level security|violates|42501|23503|22P02/i)
      // Cada codigo tem a SUA mensagem: duas chaves com o mesmo texto sao um
      // mapa que perdeu a capacidade de dizer o que aconteceu.
      expect(vistas.has(mensagem), `mensagem repetida em ${codigo}`).toBe(false)
      vistas.add(mensagem)
    }
  })

  it('falha de conexao reusa a mensagem unica de lib/ui/acao', () => {
    expect(mensagemDeErroScript(FALHA_DE_CONEXAO)).toBe(MENSAGEM_FALHA_DE_CONEXAO)
  })

  it('codigo desconhecido cai no fallback que devolve o proprio codigo', () => {
    expect(mensagemDeErroScript('codigo_que_nao_existe')).toBe('codigo_que_nao_existe')
  })

  it('propriedade herdada de Object.prototype nao vaza como funcao — devolve o codigo, uma string', () => {
    // MENSAGENS_ERRO['toString'] acha o toString herdado de Object.prototype
    // pelo indice cru: sem o guard de hasOwnProperty (o mesmo que
    // codigoDoErroDoPainel ja usa), o fallback `?? codigo` nunca dispara
    // porque a funcao herdada nao e' undefined, e a tela receberia uma
    // Function onde espera string.
    expect(mensagemDeErroScript('toString')).toBe('toString')
  })
})

describe('codigoDoErroDoPainel', () => {
  it('deixa passar todo codigo conhecido — a causa nao e apagada quando da pra dizer', () => {
    for (const codigo of CODIGOS) {
      expect(codigoDoErroDoPainel(codigo), codigo).toBe(codigo)
    }
  })

  it('troca pelo generico de leitura o que o mapa nao conhece', () => {
    // Os dois casos REAIS que motivam a funcao, os dois vindos de
    // resolverContaAtiva (lib/data/conta.ts) quando
    // criarScriptStoreDoServidor falha ANTES de existir store:
    // `falha(error.message)` com a mensagem crua do Postgres...
    expect(
      codigoDoErroDoPainel(
        'new row violates row-level security policy for table "memberships"',
      ),
    ).toBe('erro_ao_carregar_scripts')
    // ...e 'sem_conta', que e' um codigo de verdade mas de OUTRO vocabulario:
    // nao esta no mapa de scripts e seria ecoado cru na ficha do lead.
    expect(codigoDoErroDoPainel('sem_conta')).toBe('erro_ao_carregar_scripts')

    // O resultado sempre atravessa mensagemDeErroScript sem cair no fallback:
    // e' esta composicao, e nao o valor de retorno sozinho, que garante que a
    // tela nunca mostra codigo.
    expect(mensagemDeErroScript(codigoDoErroDoPainel('qualquer coisa'))).toBe(
      'Não foi possível carregar os scripts. Tente de novo.',
    )
  })

  it('propriedade herdada de Object.prototype nao conta como codigo conhecido', () => {
    // `codigo in MENSAGENS_ERRO` percorreria a cadeia de prototipos e deixaria
    // estes tres passarem como se fossem chaves do mapa — e ai
    // mensagemDeErroScript devolveria uma FUNCAO onde a tela espera texto.
    for (const herdada of ['constructor', 'toString', 'valueOf']) {
      expect(codigoDoErroDoPainel(herdada), herdada).toBe('erro_ao_carregar_scripts')
    }
  })
})

describe('mensagens normativas do disparo (Plano 11)', () => {
  /**
   * As frases sao contrato do brief da Task 5, nao gosto pessoal: a Task 6
   * mapeia os mesmos codigos na ficha do lead, e as duas telas tem que dizer a
   * mesma coisa. Literal aqui para que reescrever uma delas fique vermelho.
   */
  const ESPERADAS: [string, string][] = [
    ['sem_conexao_whatsapp', 'Conecte um número de WhatsApp em Configuração antes de usar templates.'],
    ['template_variavel_desconhecida', 'O script usa uma variável que o CRM não conhece. Confira os nomes.'],
    [
      'template_posicional_reservado',
      'O script contém {{número}}, forma reservada dos templates do Meta. Troque por uma variável nomeada.',
    ],
    ['template_ja_pendente', 'Este script já tem um template em análise no Meta. Aguarde a resposta.'],
    ['template_ja_existe', 'Este script já tem um template. Recarregue a página.'],
    ['template_recusado_pelo_meta', 'O Meta recusou a submissão. Tente de novo em alguns minutos.'],
    ['template_nao_encontrado', 'Esse template não existe mais. Recarregue a página.'],
    ['template_nao_aprovado', 'O template deste script ainda não foi aprovado pelo Meta.'],
    ['template_desatualizado', 'O script mudou depois da aprovação. Re-submeta o template para enviar.'],
    ['whatsapp_sem_telefone', 'Este lead não tem telefone.'],
    ['whatsapp_lacunas', 'Faltam dados do lead para preencher o template.'],
    ['envio_recusado', 'O Meta recusou o envio. Confira o template e tente de novo.'],
    ['whatsapp_indisponivel', 'O Meta não respondeu. Tente de novo em alguns minutos.'],
    [
      'whatsapp_enviado_sem_evento',
      'Mensagem enviada. Não conseguimos registrá-la na linha do tempo do lead.',
    ],
    ['erro_ao_salvar_template', 'Não foi possível salvar o template. Tente de novo.'],
    ['erro_ao_carregar_templates', 'Não foi possível carregar os templates. Tente de novo.'],
  ]

  it('cada codigo do disparo tem exatamente a frase do contrato', () => {
    for (const [codigo, frase] of ESPERADAS) {
      expect(mensagemDeErroScript(codigo), codigo).toBe(frase)
    }
  })
})

describe('codigoDoErroDoTemplate', () => {
  it('deixa passar todo codigo conhecido — inclusive os de script, que a mesma tela mostra', () => {
    for (const codigo of CODIGOS) {
      expect(codigoDoErroDoTemplate(codigo), codigo).toBe(codigo)
    }
  })

  it('troca pelo generico de ESCRITA DE TEMPLATE o que o mapa nao conhece', () => {
    // Os codigos reais que chegam a submeterTemplate por caminhos de OUTRO
    // vocabulario: `criarDisparoServico` recusa deploy sem segredo, a RPC
    // levanta segredo_invalido, e resolverContaAtiva devolve a mensagem crua
    // do Postgres. Nenhum dos tres esta no mapa.
    expect(codigoDoErroDoTemplate('ingestao_nao_configurada')).toBe('erro_ao_salvar_template')
    expect(codigoDoErroDoTemplate('segredo_invalido')).toBe('erro_ao_salvar_template')
    expect(codigoDoErroDoTemplate('sem_conta')).toBe('erro_ao_salvar_template')
    expect(
      codigoDoErroDoTemplate('new row violates row-level security policy for table "memberships"'),
    ).toBe('erro_ao_salvar_template')

    // Composicao: o resultado sempre atravessa mensagemDeErroScript sem cair
    // no fallback que ecoaria o codigo.
    expect(mensagemDeErroScript(codigoDoErroDoTemplate('qualquer coisa'))).toBe(
      'Não foi possível salvar o template. Tente de novo.',
    )
  })

  it('propriedade herdada de Object.prototype nao conta como codigo conhecido', () => {
    for (const herdada of ['constructor', 'toString', 'valueOf']) {
      expect(codigoDoErroDoTemplate(herdada), herdada).toBe('erro_ao_salvar_template')
    }
  })
})
