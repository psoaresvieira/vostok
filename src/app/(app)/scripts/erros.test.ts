import { describe, it, expect } from 'vitest'
import { codigoDoErroDoPainel, mensagemDeErroScript } from './erros'
import { FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'

/**
 * Os codigos aqui sao os que as tres Server Actions de scripts/acoes.ts e o
 * SupabaseScriptStore (lib/data/scripts.ts) realmente devolvem. A lista e'
 * literal de proposito, como o mapa: se uma chave sumir do mapa, este teste
 * fica vermelho em vez de a tela passar a mostrar o codigo cru.
 */
const CODIGOS = [
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
