import { describe, it, expect } from 'vitest'
import { formatarSegmentos } from './whatsapp-formato'
import { interpolar, textoPlano, type ContextoScript, type Segmento } from './script'

const CONTEXTO: ContextoScript = {
  nome_lead: 'Maria da Silva',
  primeiro_nome: 'Maria',
  empresa: 'Acme',
  email: 'maria@acme.com',
  telefone: '(11) 91234-5678',
  responsavel: 'João',
  etapa: 'Qualificação',
}

/** Segmento único de texto puro, sem passar por interpolar — atalho para
 * casos que não envolvem variável nenhuma. */
function segTexto(texto: string): Segmento[] {
  return [{ tipo: 'texto', texto }]
}

/** Confere a invariante normativa: a concatenação dos trechos formatados é
 * byte a byte igual a textoPlano(segs) — a formatação reparticiona, nunca
 * altera. */
function checaInvariante(segs: Segmento[]) {
  const trechos = formatarSegmentos(segs)
  expect(trechos.map((t) => t.texto).join('')).toBe(textoPlano(segs))
}

describe('formatarSegmentos', () => {
  it('1. *negrito* numa linha só: texto completo, miolo com estilo negrito, invariante fecha', () => {
    const segs = segTexto('*negrito*')
    const trechos = formatarSegmentos(segs)
    expect(trechos.map((t) => t.texto).join('')).toBe('*negrito*')
    const comEstilo = trechos.find(
      (t) => t.texto.includes('negrito') && (t.tipo === 'texto' || t.tipo === 'valor') && t.estilos.includes('negrito'),
    )
    expect(comEstilo).toBeDefined()
    checaInvariante(segs)
  })

  it('2. * negrito* (espaço encostado no delimitador) → um trecho único sem estilos', () => {
    const segs = segTexto('* negrito*')
    const trechos = formatarSegmentos(segs)
    expect(trechos).toEqual([{ tipo: 'texto', texto: '* negrito*', estilos: [] }])
    checaInvariante(segs)
  })

  it('3. *aberto sem fechar → literal, sem estilos', () => {
    const segs = segTexto('*aberto sem fechar')
    const trechos = formatarSegmentos(segs)
    expect(trechos).toEqual([{ tipo: 'texto', texto: '*aberto sem fechar', estilos: [] }])
    checaInvariante(segs)
  })

  it('4. *a\\nb* (par cruzando linha) → literal', () => {
    const segs = segTexto('*a\nb*')
    const trechos = formatarSegmentos(segs)
    expect(trechos).toEqual([{ tipo: 'texto', texto: '*a\nb*', estilos: [] }])
    checaInvariante(segs)
  })

  it('5. _italico_, ~riscado~, ```mono``` → cada um com seu estilo', () => {
    const casos: Array<[string, 'italico' | 'riscado' | 'mono']> = [
      ['_italico_', 'italico'],
      ['~riscado~', 'riscado'],
      ['```mono```', 'mono'],
    ]
    for (const [entrada, estilo] of casos) {
      const segs = segTexto(entrada)
      const trechos = formatarSegmentos(segs)
      expect(trechos).toEqual([{ tipo: 'texto', texto: entrada, estilos: [estilo] }])
      checaInvariante(segs)
    }
  })

  it('6. ```tem *asterisco* dentro``` → mono, e o *asterisco* interno sem negrito', () => {
    const entrada = '```tem *asterisco* dentro```'
    const segs = segTexto(entrada)
    const trechos = formatarSegmentos(segs)
    expect(trechos).toEqual([{ tipo: 'texto', texto: entrada, estilos: ['mono'] }])
    // nenhum trecho separado carrega 'negrito' — o asterisco interno não foi interpretado
    expect(trechos.some((t) => t.tipo === 'texto' && t.estilos.includes('negrito'))).toBe(false)
    checaInvariante(segs)
  })

  it('7. *_dois_* → miolo com [negrito, italico]; *_~tres~_* (dois níveis) → literal', () => {
    const segsUmNivel = segTexto('*_dois_*')
    const trechosUmNivel = formatarSegmentos(segsUmNivel)
    const miolo = trechosUmNivel.find((t) => t.texto.includes('dois'))
    expect(miolo).toBeDefined()
    expect(miolo).toMatchObject({ estilos: ['negrito', 'italico'] })
    checaInvariante(segsUmNivel)

    const segsDoisNiveis = segTexto('*_~tres~_*')
    const trechosDoisNiveis = formatarSegmentos(segsDoisNiveis)
    expect(trechosDoisNiveis).toEqual([
      { tipo: 'texto', texto: '*_~tres~_*', estilos: [] },
    ])
    checaInvariante(segsDoisNiveis)
  })

  it('8. composição com variável: valor preenchido carrega negrito; lacuna sai sem estilos mantendo o par ao redor', () => {
    const preenchido = interpolar('*Olá {{primeiro_nome}}*', CONTEXTO)
    const trechosPreenchido = formatarSegmentos(preenchido)
    const trechoValor = trechosPreenchido.find((t) => t.tipo === 'valor')
    expect(trechoValor).toBeDefined()
    expect(trechoValor).toMatchObject({ tipo: 'valor', texto: 'Maria', nome: 'primeiro_nome', estilos: ['negrito'] })
    checaInvariante(preenchido)

    const comLacuna = interpolar('*Olá {{primeiro_nome}}*', { ...CONTEXTO, primeiro_nome: null })
    const trechosLacuna = formatarSegmentos(comLacuna)
    const trechoLacuna = trechosLacuna.find((t) => t.tipo === 'lacuna')
    expect(trechoLacuna).toEqual({ tipo: 'lacuna', texto: '{{primeiro_nome}}', nome: 'primeiro_nome' })
    // o texto ao redor (os asteriscos) mantém o par: continuam com estilo negrito
    const textosAoRedor = trechosLacuna.filter((t) => t.tipo === 'texto')
    expect(textosAoRedor.every((t) => t.estilos.includes('negrito'))).toBe(true)
    checaInvariante(comLacuna)
  })

  it('9. texto sem delimitador nenhum → passthrough: um trecho por segmento, estilos: [], byte-idêntico', () => {
    const segs = interpolar('Oi {{primeiro_nome}}, vi a {{empresa}}', CONTEXTO)
    const trechos = formatarSegmentos(segs)
    expect(trechos.length).toBe(segs.length)
    for (let i = 0; i < segs.length; i++) {
      expect(trechos[i].texto).toBe(segs[i].texto)
      if (trechos[i].tipo === 'texto' || trechos[i].tipo === 'valor') {
        expect((trechos[i] as { estilos: string[] }).estilos).toEqual([])
      }
    }
    checaInvariante(segs)
  })

  it('10. invariante de concatenação sobre todos os casos acima, mais uma varredura própria', () => {
    const casosAdicionais: Segmento[][] = [
      segTexto('*negrito*'),
      segTexto('* negrito*'),
      segTexto('*aberto sem fechar'),
      segTexto('*a\nb*'),
      segTexto('_italico_'),
      segTexto('~riscado~'),
      segTexto('```mono```'),
      segTexto('```tem *asterisco* dentro```'),
      segTexto('*_dois_*'),
      segTexto('*_~tres~_*'),
      interpolar('*Olá {{primeiro_nome}}*', CONTEXTO),
      interpolar('*Olá {{primeiro_nome}}*', { ...CONTEXTO, primeiro_nome: null }),
      interpolar('Oi {{primeiro_nome}}, vi a {{empresa}}', CONTEXTO),
      interpolar('use o cupom {{cupom}}: *aproveite*', CONTEXTO),
      segTexto(''),
      segTexto('sem nenhum delimitador aqui, só texto normal.'),
      segTexto('múltiplas *linhas*\ncom *negrito* em cada\numa ~riscada~ também'),
    ]
    for (const segs of casosAdicionais) checaInvariante(segs)
  })

  // --- Fixes do code review (RULING do dono do plano: bytes de tag
  // ({{lacuna}}/{{desconhecida}}) são conteúdo OPACO — podem ficar DENTRO
  // de um par que o usuário escreveu ao redor, mas os caracteres da própria
  // tag nunca abrem/fecham um par.) ---

  it('11. RULING: "_" dentro do nome da tag não abre par italico — duas lacunas não filtradas não estilizam nada', () => {
    const ctx = { ...CONTEXTO, primeiro_nome: null, nome_lead: null }
    const segs = interpolar('Oi {{primeiro_nome}} da {{nome_lead}}, tudo bem?', ctx)
    const trechos = formatarSegmentos(segs)
    const algumEstilizado = trechos.some(
      (t) => (t.tipo === 'texto' || t.tipo === 'valor') && t.estilos.length > 0,
    )
    expect(algumEstilizado).toBe(false)
    checaInvariante(segs)
  })

  it('12. RULING (guarda de regressão): a tag ainda pode ficar DENTRO de um par escrito pelo usuário — *Olá {{primeiro_nome}}* com lacuna mantém negrito ao redor', () => {
    const comLacuna = interpolar('*Olá {{primeiro_nome}}*', { ...CONTEXTO, primeiro_nome: null })
    const trechos = formatarSegmentos(comLacuna)
    const lacuna = trechos.find((t) => t.tipo === 'lacuna')
    expect(lacuna).toEqual({ tipo: 'lacuna', texto: '{{primeiro_nome}}', nome: 'primeiro_nome' })
    const textos = trechos.filter((t) => t.tipo === 'texto')
    expect(textos.length).toBeGreaterThan(0)
    expect(textos.every((t) => t.estilos.includes('negrito'))).toBe(true)
    checaInvariante(comLacuna)
  })

  it('13. *\\tnegrito* (tab encostado no delimitador) → literal, tab tratado como espaço', () => {
    const segs = segTexto('*\tnegrito*')
    const trechos = formatarSegmentos(segs)
    expect(trechos).toEqual([{ tipo: 'texto', texto: '*\tnegrito*', estilos: [] }])
    checaInvariante(segs)
  })
})
