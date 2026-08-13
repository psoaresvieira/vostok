import { textoPlano, type Segmento, type Variavel } from '@/lib/domain/script'

export type EstiloWhatsApp = 'negrito' | 'italico' | 'riscado' | 'mono'

export type TrechoFormatado =
  | { tipo: 'texto'; texto: string; estilos: EstiloWhatsApp[] }
  | { tipo: 'valor'; texto: string; nome: Variavel; estilos: EstiloWhatsApp[] }
  | { tipo: 'lacuna'; texto: string; nome: Variavel }
  | { tipo: 'desconhecida'; texto: string; nome: string }

type Span = { start: number; end: number; estilos: EstiloWhatsApp[] }
type TokenDelim = { tipo: EstiloWhatsApp; delim: string }

// Aninhamento vai ate 2 estilos simultaneos (ex.: negrito+italico em
// '*_x_*'). Tentar um 3o nivel e ambiguo (spec: "mais fundo fica
// literal") — decisao registrada em analisarTrecho, nao aqui.
const LIMITE_ANINHAMENTO = 2

/** Delimitador comecando exatamente em `pos`, sem ultrapassar `fim` (o
 * '```' de mono precisa dos 3 crases inteiras dentro do limite). */
function detectarToken(texto: string, pos: number, fim: number): TokenDelim | null {
  const c = texto[pos]
  if (c === '*') return { tipo: 'negrito', delim: '*' }
  if (c === '_') return { tipo: 'italico', delim: '_' }
  if (c === '~') return { tipo: 'riscado', delim: '~' }
  if (c === '`' && pos + 3 <= fim && texto.slice(pos, pos + 3) === '```') {
    return { tipo: 'mono', delim: '```' }
  }
  return null
}

/** Proxima ocorrencia do mesmo delimitador dentro de [de, fim); -1 se nao
 * achar ou se a ocorrencia mais proxima cair fora do limite (o que, no uso
 * feito aqui, representa "nao fecha nesta linha"). */
function acharFechamento(texto: string, de: number, fim: number, token: TokenDelim): number {
  const idx = texto.indexOf(token.delim, de)
  if (idx === -1) return -1
  if (idx + token.delim.length > fim) return -1
  return idx
}

function mesmosEstilos(a: EstiloWhatsApp[], b: EstiloWhatsApp[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Acrescenta um span a lista, fundindo com o ultimo se forem contiguos e
 * tiverem exatamente os mesmos estilos — e o que garante, por exemplo, que
 * '*negrito*' vire um unico trecho (delimitadores + miolo, mesmo estilo),
 * nao tres. */
function empurrarSpan(lista: Span[], start: number, end: number, estilos: EstiloWhatsApp[]) {
  if (start >= end) return
  const ultimo = lista[lista.length - 1]
  if (ultimo && ultimo.end === start && mesmosEstilos(ultimo.estilos, estilos)) {
    ultimo.end = end
    return
  }
  lista.push({ start, end, estilos: [...estilos] })
}

/**
 * Varre [inicio, fim) — sempre dentro de uma unica linha, pois quem chama
 * (analisarLinhas ou uma recursao de conteudo, que herda o limite da linha
 * de quem a chamou) nunca deixa `fim` cruzar um '\n' — procurando pares de
 * delimitador validos: fecha antes de `fim`, conteudo nao vazio e nao
 * comeca/termina com espaco.
 *
 * `estourou` sinaliza que, em algum ponto dentro deste trecho, um par com
 * forma valida foi recusado so por causa do limite de aninhamento (nao por
 * ficar sem fechar ou por espaco encostado). Quando o filho devolve
 * estourou=true, o pai que tentou abrir o nivel anterior tambem desiste do
 * seu proprio par (vira literal por inteiro) e propaga o estouro para
 * cima — e assim que '*_~tres~_*' (3 niveis) fica totalmente literal, em
 * vez de so o `~riscado~` mais interno falhar e negrito+italico
 * sobreviverem ao redor.
 */
function analisarTrecho(
  texto: string,
  inicio: number,
  fim: number,
  ativos: EstiloWhatsApp[],
): { spans: Span[]; estourou: boolean } {
  const spans: Span[] = []
  let cursor = inicio
  let inicioLiteral = inicio
  let estourou = false

  while (cursor < fim) {
    const token = detectarToken(texto, cursor, fim)
    if (token) {
      const inicioConteudo = cursor + token.delim.length
      const fechamento = acharFechamento(texto, inicioConteudo, fim, token)
      const valido =
        fechamento !== -1 &&
        fechamento > inicioConteudo &&
        texto[inicioConteudo] !== ' ' &&
        texto[fechamento - 1] !== ' '

      if (valido) {
        empurrarSpan(spans, inicioLiteral, cursor, ativos)

        if (ativos.length >= LIMITE_ANINHAMENTO) {
          // Abrir mais um nivel estouraria o limite de 2 — o par inteiro
          // (delimitadores + conteudo) fica literal, sem recursar.
          empurrarSpan(spans, cursor, fechamento + token.delim.length, ativos)
          estourou = true
        } else if (token.tipo === 'mono') {
          // Mono nunca recursa: delimitadores dentro dele nao se
          // interpretam (regra da spec).
          empurrarSpan(spans, cursor, fechamento + token.delim.length, [...ativos, 'mono'])
        } else {
          const novosAtivos: EstiloWhatsApp[] = [...ativos, token.tipo]
          const filho = analisarTrecho(texto, inicioConteudo, fechamento, novosAtivos)
          if (filho.estourou) {
            empurrarSpan(spans, cursor, fechamento + token.delim.length, ativos)
            estourou = true
          } else {
            empurrarSpan(spans, cursor, inicioConteudo, novosAtivos)
            for (const s of filho.spans) empurrarSpan(spans, s.start, s.end, s.estilos)
            empurrarSpan(spans, fechamento, fechamento + token.delim.length, novosAtivos)
          }
        }

        cursor = fechamento + token.delim.length
        inicioLiteral = cursor
        continue
      }
    }
    cursor += 1
  }

  empurrarSpan(spans, inicioLiteral, fim, ativos)
  return { spans, estourou }
}

/** Quebra `texto` em linhas (o '\n' vira seu proprio span, sem estilo) e
 * roda analisarTrecho em cada uma — e essa quebra que impede um par de
 * cruzar linha, sem analisarTrecho precisar saber nada sobre '\n'. */
function analisarLinhas(texto: string): Span[] {
  const spans: Span[] = []
  let pos = 0
  while (pos <= texto.length) {
    const quebra = texto.indexOf('\n', pos)
    const fimLinha = quebra === -1 ? texto.length : quebra
    const { spans: daLinha } = analisarTrecho(texto, pos, fimLinha, [])
    for (const s of daLinha) empurrarSpan(spans, s.start, s.end, s.estilos)
    if (quebra === -1) break
    empurrarSpan(spans, quebra, quebra + 1, [])
    pos = quebra + 1
  }
  return spans
}

/**
 * Roda por cima do resultado de `interpolar` — nunca do texto salvo.
 *
 * Estrategia: analisa textoPlano(segs) inteiro (sem olhar para as bordas de
 * segmento, so para linha) e monta spans de estilo; depois reparticiona
 * cada Segmento original nesses spans. 'lacuna'/'desconhecida' sao a
 * excecao: saem sempre inteiros e sem `estilos`, nunca quebrados no meio,
 * mesmo que um span de estilo os atravesse (os caracteres da tag contam
 * como conteudo do par ao redor, mas o trecho da lacuna em si nao carrega
 * o estilo — o par sobrevive nos delimitadores 'texto' ao redor).
 *
 * A varredura de delimitador e cega ao tipo de segmento (opera direto na
 * string plana), entao um par pode abrir num segmento 'texto' e fechar
 * depois de atravessar um 'valor' ou uma 'lacuna' — e assim que a
 * composicao com variavel do caso 8 funciona.
 */
export function formatarSegmentos(segs: Segmento[]): TrechoFormatado[] {
  const plano = textoPlano(segs)
  const spans = analisarLinhas(plano)

  const saida: TrechoFormatado[] = []
  let cursor = 0
  let si = 0

  for (const seg of segs) {
    const inicioSeg = cursor
    const fimSeg = cursor + seg.texto.length
    cursor = fimSeg

    if (seg.tipo === 'lacuna' || seg.tipo === 'desconhecida') {
      saida.push(
        seg.tipo === 'lacuna'
          ? { tipo: 'lacuna', texto: seg.texto, nome: seg.nome }
          : { tipo: 'desconhecida', texto: seg.texto, nome: seg.nome },
      )
      while (si < spans.length && spans[si].end <= fimSeg) si++
      continue
    }

    let pos = inicioSeg
    while (pos < fimSeg) {
      while (spans[si].end <= pos) si++
      const span = spans[si]
      const fimPedaco = Math.min(span.end, fimSeg)
      const pedaco = plano.slice(pos, fimPedaco)
      saida.push(
        seg.tipo === 'valor'
          ? { tipo: 'valor', texto: pedaco, nome: seg.nome, estilos: [...span.estilos] }
          : { tipo: 'texto', texto: pedaco, estilos: [...span.estilos] },
      )
      pos = fimPedaco
    }
  }

  return saida
}
