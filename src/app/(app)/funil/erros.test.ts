import { describe, it, expect } from 'vitest'
import { mensagemDeErro, codigoEtiquetasSalvas, mensagemDePipeline } from './erros'
import { FALHA_DE_CONEXAO } from '@/lib/ui/acao'

describe('mensagemDeErro', () => {
  it('traduz os codigos conhecidos', () => {
    expect(mensagemDeErro('motivo_perda_obrigatorio')).toBe('Escolha o motivo da perda.')
    expect(mensagemDeErro('lead_nao_encontrado')).toBe('Você não tem acesso a esse lead.')
    expect(mensagemDeErro('mesma_pipeline')).toBe(
      'Esse lead já está nessa pipeline. Escolha uma etapa.',
    )
  })

  it('devolve o codigo cru quando nao conhece a mensagem', () => {
    expect(mensagemDeErro('coisa_estranha')).toBe('coisa_estranha')
  })

  it('tem mensagem propria para a falha de transporte', () => {
    expect(mensagemDeErro(FALHA_DE_CONEXAO)).toBe(
      'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.',
    )
  })
})

describe('movimento que falhou com as etiquetas ja salvas', () => {
  it('explica a causa deterministica em vez de mandar tentar de novo', () => {
    expect(mensagemDeErro(codigoEtiquetasSalvas('etapa_invalida'))).toBe(
      'As etiquetas foram salvas, mas o lead continua na etapa anterior. Essa etapa não pertence ao seu funil.',
    )
    expect(mensagemDeErro(codigoEtiquetasSalvas('motivo_perda_invalido'))).toBe(
      'As etiquetas foram salvas, mas o lead continua na etapa anterior. Esse motivo de perda não pertence à sua conta.',
    )
  })

  it('manda tentar de novo quando a causa pode ser passageira', () => {
    const esperado =
      'As etiquetas foram salvas, mas o lead continua na etapa anterior. Tente mover de novo.'
    expect(mensagemDeErro(codigoEtiquetasSalvas(FALHA_DE_CONEXAO))).toBe(esperado)
    expect(mensagemDeErro(codigoEtiquetasSalvas('deadlock detected'))).toBe(esperado)
  })

  it('nunca some com o aviso de que as etiquetas foram salvas', () => {
    for (const causa of ['etapa_invalida', 'qualquer_coisa', '']) {
      expect(mensagemDeErro(codigoEtiquetasSalvas(causa))).toContain(
        'As etiquetas foram salvas, mas o lead continua na etapa anterior.',
      )
    }
  })
})

describe('mensagemDePipeline', () => {
  it('traduz os codigos conhecidos das actions de pipeline', () => {
    expect(mensagemDePipeline('pipeline_nao_encontrado')).toBe(
      'Essa pipeline não existe mais. Recarregue a página.',
    )
    expect(mensagemDePipeline('pipeline_padrao_nao_exclui')).toBe(
      'A pipeline padrão não pode ser excluída.',
    )
    expect(mensagemDePipeline('pipeline_com_leads')).toBe(
      'Essa pipeline ainda tem leads. Mova ou exclua os leads antes.',
    )
    expect(mensagemDePipeline('nome_obrigatorio')).toBe('Dê um nome antes de salvar.')
    expect(mensagemDePipeline('etapas_minimo_uma')).toBe(
      'Adicione ao menos uma etapa aberta.',
    )
  })

  it('tem mensagem propria para a falha de transporte', () => {
    expect(mensagemDePipeline(FALHA_DE_CONEXAO)).toBe(
      'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.',
    )
  })

  it('devolve o codigo cru quando nao conhece a mensagem', () => {
    expect(mensagemDePipeline('coisa_estranha')).toBe('coisa_estranha')
  })
})
