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
const PREFIXOS = 'bg|text|border|ring|fill|stroke|from|via|to|divide|outline|accent|caret|shadow'
const ESCALAS =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

const PADROES: RegExp[] = [
  new RegExp(`\\b(?:${PREFIXOS})-(?:${ESCALAS})-\\d{2,3}\\b`, 'g'),
  /\b(?:bg|text|border|ring|fill|stroke)-white\b/g,
  /\b(?:text|border|ring|fill|stroke)-black\b/g,
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
    const amostra = 'className="bg-white text-gray-600 bg-black/40 bg-black"'
    const achados = PADROES.flatMap((p) => [...amostra.matchAll(p)].map((m) => m[0]))
    expect(achados.sort()).toEqual(['bg-black', 'bg-white', 'text-gray-600'])
  })
})
