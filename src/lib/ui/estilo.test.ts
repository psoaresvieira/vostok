// src/lib/ui/estilo.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '..', '..')

// Depois do porte dos tokens, cor no CRM vem de token semantico (bg-card,
// text-muted-foreground, ...). A escala numerica do Tailwind ignora o tema:
// um text-gray-600 chumbado fica ilegivel sobre o fundo navy, e o sintoma so
// aparece para quem abrir aquela tela. Este portao existe porque o repo nao
// tem teste de componente para pegar isso de outro jeito.
const PREFIXOS_SEM_BG = 'text|border|ring|fill|stroke|from|via|to|divide|outline|accent|caret|shadow'
const PREFIXOS = `bg|${PREFIXOS_SEM_BG}`
const ESCALAS =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

const PADROES: RegExp[] = [
  new RegExp(`\\b(?:${PREFIXOS})-(?:${ESCALAS})-\\d{2,3}\\b`, 'g'),
  new RegExp(`\\b(?:${PREFIXOS})-white\\b`, 'g'),
  // Todo prefixo MENOS bg: `bg-black` tem padrao proprio logo abaixo, porque
  // `bg-black/40` e scrim de modal e nao pode ser flagrado.
  new RegExp(`\\b(?:${PREFIXOS_SEM_BG})-black\\b`, 'g'),
  // `bg-black/40` e scrim de modal, nao cor de paleta: um veu continua preto
  // no tema escuro, e trocar por bg-foreground/40 o pintaria de branco. O
  // lookahead libera SO a forma com opacidade — `bg-black` puro continua
  // barrado, porque ali ele e cor de botao.
  /\bbg-black\b(?!\/)/g,
]

function arquivosDeTela(dir: string): string[] {
  const achados: string[] = []
  for (const entrada of readdirSync(dir)) {
    const caminho = path.join(dir, entrada)
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivosDeTela(caminho))
    } else if (entrada.endsWith('.tsx')) {
      achados.push(caminho)
    }
  }
  return achados
}

describe('portao de estilo', () => {
  it('nenhum .tsx em src/ usa classe de paleta crua do Tailwind', () => {
    const violacoes: string[] = []

    for (const arquivo of arquivosDeTela(SRC)) {
      const conteudo = readFileSync(arquivo, 'utf8')
      const linhas = conteudo.split('\n')
      linhas.forEach((linha, i) => {
        for (const padrao of PADROES) {
          for (const achado of linha.matchAll(padrao)) {
            violacoes.push(`${path.relative(SRC, arquivo)}:${i + 1}  ${achado[0]}`)
          }
        }
      })
    }

    // Mensagem com a lista inteira, e nao so a contagem: quem roda isto
    // vermelho precisa da lista para converter, e uma contagem obrigaria a
    // rodar um grep a mais para descobrir onde.
    expect(violacoes, `classes cruas encontradas:\n${violacoes.join('\n')}`).toEqual([])
  })

  it('o portao de fato reconhece uma classe crua', () => {
    // Sem este caso, um erro na regex (grupo trocado, escape errado) deixaria
    // o teste acima verde para sempre, e ele pareceria estar protegendo o
    // repo enquanto nao olha para nada. Discriminacao provada aqui, no lugar
    // de assumida.
    const amostra = 'className="bg-white text-gray-600 bg-black/40 bg-black outline-white"'
    const achados = PADROES.flatMap((p) => [...amostra.matchAll(p)].map((m) => m[0]))
    expect(achados.sort()).toEqual(['bg-black', 'bg-white', 'outline-white', 'text-gray-600'])
  })
})

describe('layout.tsx: variaveis de fonte no escopo certo', () => {
  it('inter.variable e spaceGrotesk.variable aparecem na mesma linha que <html>', () => {
    // As variaveis de fonte devem estar no <html> porque globals.css aplica
    // `@apply font-sans` no nivel do html. A classe font-sans resolve para
    // var(--font-sans), e essa variavel so e definida no elemento <html> por
    // next/font. Se estiverem no <body> (filho do <html>), a variavel fica
    // fora do escopo onde e usada, e a pagina cai silenciosamente para serif
    // padrao do navegador.
    //
    // spaceGrotesk.variable tem o mesmo defeito em potencial e o mesmo
    // sintoma silencioso: se migrar para o <body>, --font-display sai de
    // escopo, font-heading (item 4, @layer base) cai para a serif padrao do
    // navegador em h1/h2/h3, e nenhuma suite alem desta pegaria a regressao.
    const layoutPath = path.resolve(SRC, 'app', 'layout.tsx')
    const conteudo = readFileSync(layoutPath, 'utf8')
    const linhas = conteudo.split('\n')

    let htmlLineIndex = -1
    for (let i = 0; i < linhas.length; i++) {
      if (linhas[i].includes('<html')) {
        htmlLineIndex = i
        break
      }
    }

    expect(htmlLineIndex, 'nao encontrou linha com <html').toBeGreaterThanOrEqual(0)

    const htmlLine = linhas[htmlLineIndex]
    expect(htmlLine, `inter.variable nao esta na linha <html. Sem ela, font-sans esta fora de escopo e a pagina renderiza em serif (veja screenshots): ${htmlLine}`).toContain(
      'inter.variable'
    )
    expect(htmlLine, `spaceGrotesk.variable nao esta na linha <html. Sem ela, --font-display fica fora de escopo e todo h1/h2/h3 (font-heading, aplicado na base layer) cai para a serif padrao do navegador: ${htmlLine}`).toContain(
      'spaceGrotesk.variable'
    )
  })
})
