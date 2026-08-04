import { describe, it, expect } from 'vitest'
import {
  interpolar,
  textoPlano,
  contarPendencias,
  normalizarTags,
  contextoDoLead,
  linkWhatsApp,
  traduzirParaPosicional,
  valoresPosicionais,
  preencherPosicional,
  nomeMetaDoTitulo,
  type ContextoScript,
  type Variavel,
} from './script'
import type { Lead } from './tipos'

const CONTEXTO_COMPLETO: ContextoScript = {
  nome_lead: 'Maria da Silva',
  primeiro_nome: 'Maria',
  empresa: 'Acme',
  email: 'maria@acme.com',
  telefone: '(11) 91234-5678',
  responsavel: 'João',
  etapa: 'Qualificação',
}

describe('interpolar', () => {
  it('interpolação feliz com espaços opcionais', () => {
    const segs = interpolar('Oi {{ primeiro_nome }}, vi a {{empresa}}', CONTEXTO_COMPLETO)
    expect(segs.map((s) => s.tipo)).toEqual(['texto', 'valor', 'texto', 'valor'])
    expect(textoPlano(segs)).toBe('Oi Maria, vi a Acme')
  })

  it('lacuna com null e com string de espaços produzem o mesmo segmento', () => {
    const comNull = interpolar('vi que a {{empresa}} está crescendo', {
      ...CONTEXTO_COMPLETO,
      empresa: null,
    })
    const comEspacos = interpolar('vi que a {{empresa}} está crescendo', {
      ...CONTEXTO_COMPLETO,
      empresa: '  ',
    })
    const lacunaNull = comNull.find((s) => s.tipo === 'lacuna')
    const lacunaEspacos = comEspacos.find((s) => s.tipo === 'lacuna')
    expect(lacunaNull).toBeDefined()
    expect(lacunaEspacos).toBeDefined()
    expect(lacunaNull!.texto).toBe('{{empresa}}')
    expect(lacunaEspacos!.texto).toBe('{{empresa}}')
  })

  it('desconhecida: nome fora do catálogo permanece literal', () => {
    const segs = interpolar('use o cupom {{cupom}}', CONTEXTO_COMPLETO)
    const desconhecida = segs.find((s) => s.tipo === 'desconhecida')
    expect(desconhecida).toBeDefined()
    expect(desconhecida).toMatchObject({ tipo: 'desconhecida', texto: '{{cupom}}', nome: 'cupom' })
  })

  it('o que não casa fica literal, byte a byte', () => {
    const entrada = '{{ }} {{a-b}} {{Empresa}} {{"x"}} solto: {{'
    const segs = interpolar(entrada, CONTEXTO_COMPLETO)
    expect(segs.every((s) => s.tipo === 'texto')).toBe(true)
    expect(textoPlano(segs)).toBe(entrada)
  })

  it('cópia carrega a lacuna: textoPlano nunca vira buraco vazio', () => {
    const segs = interpolar('vi que a {{empresa}} está crescendo', {
      ...CONTEXTO_COMPLETO,
      empresa: null,
    })
    expect(textoPlano(segs)).toBe('vi que a {{empresa}} está crescendo')
  })

  it('gramática apertada: espaço horizontal casa, quebra de linha dentro das chaves fica literal', () => {
    const comEspaco = interpolar('Oi {{ empresa }}', CONTEXTO_COMPLETO)
    expect(textoPlano(comEspaco)).toBe('Oi Acme')

    const comQuebra = interpolar('Oi {{\n empresa }}', CONTEXTO_COMPLETO)
    expect(comQuebra.every((s) => s.tipo === 'texto')).toBe(true)
    expect(textoPlano(comQuebra)).toBe('Oi {{\n empresa }}')

    // O mesmo padrão vale para traduzirParaPosicional: nenhum casamento,
    // corpo idêntico, mapa vazio.
    const traduzida = traduzirParaPosicional('Oi {{\n empresa }}')
    expect(traduzida).toEqual({ ok: true, valor: { corpo: 'Oi {{\n empresa }}', mapa: [] } })
  })
})

describe('contarPendencias', () => {
  it('distingue lacunas de desconhecidas', () => {
    const segs = interpolar('{{empresa}} {{responsavel}} {{cupom}}', {
      ...CONTEXTO_COMPLETO,
      empresa: null,
      responsavel: null,
    })
    expect(contarPendencias(segs)).toEqual({ lacunas: 2, desconhecidas: 1 })
  })
})

describe('normalizarTags', () => {
  it('trim, minúscula, descarta vazia, corta em 40, dedup preservando ordem', () => {
    const tag41 = 'a'.repeat(41)
    const tag40 = 'a'.repeat(40)
    expect(normalizarTags([' Objeção ', 'OBJEÇÃO', '', 'preço'])).toEqual(['objeção', 'preço'])
    expect(normalizarTags([tag41, tag40])).toEqual([tag40])
  })
})

describe('contextoDoLead', () => {
  const leadBase: Lead = {
    id: 'lead-1',
    accountId: 'acc-1',
    nome: 'Maria da Silva',
    telefone: null,
    telefoneE164: null,
    email: null,
    emailNorm: null,
    empresa: null,
    origem: 'manual',
    pipelineId: 'pipe-1',
    stageId: 'stage-1',
    responsavelId: null,
    status: 'aberto',
    valorCents: null,
    lossReasonId: null,
    entrouNaEtapaEm: new Date('2026-08-01T00:00:00Z'),
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    atualizadoEm: new Date('2026-08-01T00:00:00Z'),
    etiquetas: [],
  }
  const nomeEtapa = new Map([['stage-1', 'Qualificação']])
  const nomePessoa = new Map<string, string>()

  it('sem telefone: telefone é null, nunca "—"', () => {
    const ctx = contextoDoLead(leadBase, nomeEtapa, nomePessoa)
    expect(ctx.primeiro_nome).toBe('Maria')
    expect(ctx.telefone).toBeNull()
    expect(ctx.empresa).toBeNull()
    expect(ctx.responsavel).toBeNull()
    expect(ctx.etapa).toBe('Qualificação')
  })

  it('com telefone: formata via formatarTelefone', () => {
    const lead = { ...leadBase, telefoneE164: '+5511912345678' }
    const ctx = contextoDoLead(lead, nomeEtapa, nomePessoa)
    expect(ctx.telefone).toBe('(11) 91234-5678')
  })
})

describe('linkWhatsApp', () => {
  it('monta a URL sem "+" e com o texto url-encodado', () => {
    expect(linkWhatsApp('+5511912345678', 'oi {{empresa}}')).toBe(
      'https://wa.me/5511912345678?text=oi%20%7B%7Bempresa%7D%7D',
    )
  })
})

describe('traduzirParaPosicional', () => {
  it('variável repetida ganha a mesma posição em todas as ocorrências', () => {
    const resultado = traduzirParaPosicional(
      'Oi {{primeiro_nome}}, {{empresa}}… {{primeiro_nome}}',
    )
    expect(resultado).toEqual({
      ok: true,
      valor: { corpo: 'Oi {{1}}, {{2}}… {{1}}', mapa: ['primeiro_nome', 'empresa'] },
    })
  })

  it('nome de forma válida fora do catálogo recusa com o código', () => {
    const resultado = traduzirParaPosicional('use o cupom {{cupom}}')
    expect(resultado).toEqual({ ok: false, erro: 'template_variavel_desconhecida' })
  })

  it('sem variável: corpo idêntico, mapa vazio', () => {
    const resultado = traduzirParaPosicional('mensagem sem variável nenhuma')
    expect(resultado).toEqual({
      ok: true,
      valor: { corpo: 'mensagem sem variável nenhuma', mapa: [] },
    })
  })
})

describe('valoresPosicionais', () => {
  const mapa: Variavel[] = ['primeiro_nome', 'empresa']

  it('lacuna nula em qualquer posição falha com whatsapp_lacunas', () => {
    const resultado = valoresPosicionais(mapa, { ...CONTEXTO_COMPLETO, empresa: null })
    expect(resultado).toEqual({ ok: false, erro: 'whatsapp_lacunas' })
  })

  it('lacuna só-espaços falha com o mesmo código', () => {
    const resultado = valoresPosicionais(mapa, { ...CONTEXTO_COMPLETO, empresa: '   ' })
    expect(resultado).toEqual({ ok: false, erro: 'whatsapp_lacunas' })
  })

  it('feliz devolve os valores na ordem do mapa', () => {
    const resultado = valoresPosicionais(mapa, CONTEXTO_COMPLETO)
    expect(resultado).toEqual({ ok: true, valor: ['Maria', 'Acme'] })
  })
})

describe('comutação: preencherPosicional === textoPlano(interpolar(...))', () => {
  it('conteúdo simples com variável repetida', () => {
    const conteudo = 'Oi {{primeiro_nome}}, vi a {{empresa}} crescendo, {{primeiro_nome}}!'

    const traduzida = traduzirParaPosicional(conteudo)
    if (!traduzida.ok) throw new Error('deveria traduzir')
    const valores = valoresPosicionais(traduzida.valor.mapa, CONTEXTO_COMPLETO)
    if (!valores.ok) throw new Error('deveria ter valores completos')

    const viaPosicional = preencherPosicional(traduzida.valor.corpo, valores.valor)
    const viaInterpolacao = textoPlano(interpolar(conteudo, CONTEXTO_COMPLETO))
    expect(viaPosicional).toBe(viaInterpolacao)
  })

  it('conteúdo multilinha com variável repetida', () => {
    const conteudo =
      'Oi {{primeiro_nome}},\nvi a {{empresa}} crescendo.\nAté breve, {{primeiro_nome}}!'

    const traduzida = traduzirParaPosicional(conteudo)
    if (!traduzida.ok) throw new Error('deveria traduzir')
    const valores = valoresPosicionais(traduzida.valor.mapa, CONTEXTO_COMPLETO)
    if (!valores.ok) throw new Error('deveria ter valores completos')

    const viaPosicional = preencherPosicional(traduzida.valor.corpo, valores.valor)
    const viaInterpolacao = textoPlano(interpolar(conteudo, CONTEXTO_COMPLETO))
    expect(viaPosicional).toBe(viaInterpolacao)
  })
})

describe('nomeMetaDoTitulo', () => {
  it('pino exato: minúsculas, sem acento, inválidos viram _, colapsado, truncado, sufixo', () => {
    expect(nomeMetaDoTitulo('Abertura frio — 1ª msg!', 'k3f2')).toBe('abertura_frio_1_msg_k3f2')
  })
})
