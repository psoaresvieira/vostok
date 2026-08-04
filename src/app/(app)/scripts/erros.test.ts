import { describe, it, expect } from 'vitest'
import { mensagemDeErroScript } from './erros'
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
})
