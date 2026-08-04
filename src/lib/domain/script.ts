import { formatarTelefone } from '@/lib/domain/formato'
import { falha, ok, type Resultado } from '@/lib/domain/resultado'
import type { Lead } from '@/lib/domain/tipos'

export const VARIAVEIS = [
  'nome_lead', 'primeiro_nome', 'empresa', 'email', 'telefone', 'responsavel', 'etapa',
] as const

export type Variavel = (typeof VARIAVEIS)[number]
export type ContextoScript = Record<Variavel, string | null>

export type Segmento =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'valor'; texto: string; nome: Variavel }
  | { tipo: 'lacuna'; texto: string; nome: Variavel }
  | { tipo: 'desconhecida'; texto: string; nome: string }

const CATALOGO = new Set<string>(VARIAVEIS)

// Minusculas apenas (spec §4.4): '{{Empresa}}' e demais formas com
// maiuscula ficam de fora do casamento e caem no fallback de texto literal
// mais abaixo, junto com chaves soltas e nomes com caracteres invalidos.
//
// Gramatica apertada (divida do Plano 10, spec §4.1): '[ \t]*', nao '\s*' —
// so espaco horizontal ao redor do nome. '{{\n empresa }}' (quebra de linha
// colada dentro das chaves, tipica de copiar/colar) fica de fora do
// casamento e cai no fallback literal abaixo, em vez de interpolar como se
// a quebra fosse so mais um espaco.
const PADRAO_TAG = /\{\{[ \t]*([a-z_][a-z0-9_]*)[ \t]*\}\}/g

/**
 * Varre o conteudo com um regex global e alterna entre o texto entre
 * casamentos (segmento 'texto') e o proprio casamento, classificado por
 * pertencer ao catalogo e ter valor. O texto de 'lacuna'/'desconhecida' e
 * sempre a tag original ('{{nome}}'), nunca vazio ou substituido — e essa
 * preservacao que sustenta textoPlano como unico caminho de render.
 */
export function interpolar(conteudo: string, ctx: ContextoScript): Segmento[] {
  const segmentos: Segmento[] = []
  let cursor = 0
  let casamento: RegExpExecArray | null

  PADRAO_TAG.lastIndex = 0
  while ((casamento = PADRAO_TAG.exec(conteudo)) !== null) {
    if (casamento.index > cursor) {
      segmentos.push({ tipo: 'texto', texto: conteudo.slice(cursor, casamento.index) })
    }

    const tagLiteral = casamento[0]
    const nome = casamento[1]

    if (!CATALOGO.has(nome)) {
      segmentos.push({ tipo: 'desconhecida', texto: tagLiteral, nome })
    } else {
      const valor = ctx[nome as Variavel]
      // String so de espacos conta como ausencia — spec §4.4: "espacos contam
      // como valor" e o defeito que essa checagem existe para barrar.
      if (valor === null || valor.trim() === '') {
        segmentos.push({ tipo: 'lacuna', texto: tagLiteral, nome: nome as Variavel })
      } else {
        segmentos.push({ tipo: 'valor', texto: valor, nome: nome as Variavel })
      }
    }

    cursor = casamento.index + tagLiteral.length
  }

  if (cursor < conteudo.length) {
    segmentos.push({ tipo: 'texto', texto: conteudo.slice(cursor) })
  }

  return segmentos
}

/**
 * Concatena seg.texto de todos os segmentos, sem excecao. Preview e texto
 * enviado passam pela mesma funcao — nao existe segundo caminho de render
 * que possa divergir e mascarar uma lacuna.
 */
export function textoPlano(segs: Segmento[]): string {
  return segs.map((s) => s.texto).join('')
}

export function contarPendencias(segs: Segmento[]): { lacunas: number; desconhecidas: number } {
  let lacunas = 0
  let desconhecidas = 0
  for (const s of segs) {
    if (s.tipo === 'lacuna') lacunas++
    else if (s.tipo === 'desconhecida') desconhecidas++
  }
  return { lacunas, desconhecidas }
}

const LIMITE_TAG = 40

/**
 * trim -> minuscula -> descarta vazia -> corta em 40 -> dedup apos o corte
 * (para 'a'.repeat(41) e 'a'.repeat(40) nao duplicarem). Sem limite de
 * quantidade aqui: 10 tags e regra de validacao (Task 4, erro
 * 'tags_demais'), nao truncamento silencioso — engolir a 11a em silencio e
 * a mesma classe de defeito que a spec §2 decidiu evitar.
 */
export function normalizarTags(brutas: string[]): string[] {
  const vistas = new Set<string>()
  const resultado: string[] = []
  for (const bruta of brutas) {
    const normalizada = bruta.trim().toLowerCase().slice(0, LIMITE_TAG)
    if (!normalizada) continue
    if (vistas.has(normalizada)) continue
    vistas.add(normalizada)
    resultado.push(normalizada)
  }
  return resultado
}

/**
 * telefone usa `lead.telefoneE164 ? formatarTelefone(...) : null` — nunca
 * `formatarTelefone(null)`, que devolve '—' e mascararia a lacuna como se
 * fosse um valor presente (a mesma classe de bug que a lacuna 'literal'
 * acima existe para evitar).
 */
export function contextoDoLead(
  lead: Lead,
  nomeEtapa: Map<string, string>,
  nomePessoa: Map<string, string>,
): ContextoScript {
  return {
    nome_lead: lead.nome,
    primeiro_nome: lead.nome.trim().split(' ')[0],
    empresa: lead.empresa,
    email: lead.email,
    telefone: lead.telefoneE164 ? formatarTelefone(lead.telefoneE164) : null,
    responsavel: lead.responsavelId ? (nomePessoa.get(lead.responsavelId) ?? null) : null,
    etapa: nomeEtapa.get(lead.stageId) ?? null,
  }
}

/**
 * Exige telefoneE164 nao nulo por assinatura — quem decide nao renderizar
 * o link sem telefone e a tela, nao esta funcao.
 */
export function linkWhatsApp(telefoneE164: string, texto: string): string {
  const digitos = telefoneE164.replace(/\D/g, '')
  return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`
}

// PADRAO_TAG so casa nome comecando com [a-z_], entao '{{1}}'/'{{01}}'/
// '{{ 2 }}' nunca casam ali — caem no trecho literal do loop abaixo, como
// qualquer outro texto do usuario. Sem a checagem contra este padrao,
// esse literal sobrevive intocado ate preencherPosicional, que NAO
// distingue placeholder emitido pela propria traducao de texto que o
// usuario digitou por acaso igual a um: '{{1}}' vira alvo de substituicao
// pelo valor do slot 1, e se o numero coincidir com uma posicao real do
// mapa (ou ficar orfao, sem slot correspondente) o corpo que o Meta
// registrou diverge do que o envio manda — o proprio Meta tambem
// renderizaria esse literal como parametro do lado dele. Por isso
// traduzirParaPosicional recusa na fonte, com um codigo dedicado (nao
// 'template_variavel_desconhecida': o usuario precisa saber que a forma
// '{{N}}' e reservada, nao que errou o nome de uma variavel).
const PADRAO_POSICIONAL_LITERAL = /\{\{[ \t]*\d+[ \t]*\}\}/

/**
 * Mesmo PADRAO_TAG de interpolar — e por isso que a comutacao com
 * textoPlano(interpolar(...)) vale byte a byte: o que casa e o que fica
 * literal (grafia invalida, quebra de linha dentro das chaves) e
 * identico nos dois caminhos, DESDE que a traducao nao aceite um literal
 * '{{N}}' que colidiria com um placeholder emitido por ela mesma (ver
 * PADRAO_POSICIONAL_LITERAL abaixo) — a recusa e o que fecha essa lacuna
 * entre os dois caminhos, nao uma garantia automatica da regex
 * compartilhada. Variavel de nome valido mas fora do catalogo aborta a
 * traducao inteira (nao ha "corpo parcial"), porque um template com
 * variavel desconhecida nao pode virar um envio silencioso faltando
 * pedaco.
 *
 * Cada variavel DISTINTA ganha a posicao da sua primeira ocorrencia
 * (mapa[0] é '{{1}}'); repeticoes da mesma variavel reusam o mesmo
 * numero — e assim que o Meta exige (parametros posicionais nao tem
 * nome), e e o motivo de existir posicaoDe: sem ele, cada ocorrencia
 * ganharia um numero novo e {{primeiro_nome}} repetido viraria dois
 * slots que a WhatsApp API cobraria em duplicidade do chamador.
 */
export function traduzirParaPosicional(
  conteudo: string,
): Resultado<{ corpo: string; mapa: Variavel[] }> {
  const mapa: Variavel[] = []
  const posicaoDe = new Map<Variavel, number>()
  let corpo = ''
  let cursor = 0
  let casamento: RegExpExecArray | null

  PADRAO_TAG.lastIndex = 0
  while ((casamento = PADRAO_TAG.exec(conteudo)) !== null) {
    const literal = conteudo.slice(cursor, casamento.index)
    if (PADRAO_POSICIONAL_LITERAL.test(literal)) return falha('template_posicional_reservado')
    corpo += literal

    const nome = casamento[1]
    if (!CATALOGO.has(nome)) return falha('template_variavel_desconhecida')
    const variavel = nome as Variavel

    let posicao = posicaoDe.get(variavel)
    if (posicao === undefined) {
      mapa.push(variavel)
      posicao = mapa.length
      posicaoDe.set(variavel, posicao)
    }
    corpo += `{{${posicao}}}`

    cursor = casamento.index + casamento[0].length
  }
  const cauda = conteudo.slice(cursor)
  if (PADRAO_POSICIONAL_LITERAL.test(cauda)) return falha('template_posicional_reservado')
  corpo += cauda

  return ok({ corpo, mapa })
}

/**
 * Le o contexto na ordem do mapa (posicao N do mapa == valores[N-1], o
 * pedido posicional do Meta). Null ou so-espacos em QUALQUER posicao
 * aborta com 'whatsapp_lacunas' em vez de devolver um array parcial —
 * um envio com menos valores que {{N}} no corpo desalinha todo slot
 * seguinte, silenciosamente, no lado do Meta. Contagem/listagem das
 * lacunas para a tela e responsabilidade de quem chama (ja tem
 * contarPendencias do Plano 10 sobre o mesmo mapa).
 */
export function valoresPosicionais(
  mapa: Variavel[],
  ctx: ContextoScript,
): Resultado<string[]> {
  const valores: string[] = []
  for (const variavel of mapa) {
    const valor = ctx[variavel]
    if (valor === null || valor.trim() === '') return falha('whatsapp_lacunas')
    valores.push(valor)
  }
  return ok(valores)
}

/**
 * Regex literal recriada a cada chamada (nao um const de modulo): nao ha
 * lastIndex compartilhado para vazar entre chamadas concorrentes, ao
 * contrario de PADRAO_TAG. So {{1}}..{{n}} sao alvo — texto que sobrou
 * do fallback literal de traduzirParaPosicional (chaves soltas, grafia
 * invalida) nunca bate '\{\{(\d+)\}\}' e atravessa intocado.
 */
export function preencherPosicional(corpo: string, valores: string[]): string {
  return corpo.replace(/\{\{(\d+)\}\}/g, (tagLiteral, indice: string) => {
    const posicao = Number(indice)
    if (posicao < 1 || posicao > valores.length) return tagLiteral
    return valores[posicao - 1]
  })
}

const LIMITE_META_NOME = 40

/**
 * normalize('NFD') decompoe acento em base + marca combinante, que o
 * strip abaixo remove — mas so decomposicao CANONICA: caracteres com
 * decomposicao de COMPATIBILIDADE (ex.: 'ª' ordinal feminino) nao
 * decompoem em NFD e caem no filtro [^a-z0-9_] como qualquer outro
 * simbolo, virando '_' em vez de 'a'. Bordas de '_' aparadas antes do
 * sufixo: sem isso, um titulo terminado em simbolo (`msg!`) geraria
 * '_' + '_${sufixo}' — dois separadores em vez de um — quebrando o pino
 * exato que o nome do template precisa bater sempre que reconstruido.
 */
export function nomeMetaDoTitulo(titulo: string, sufixo: string): string {
  const REGEX_MARCA_COMBINANTE = new RegExp('[\\u0300-\\u036f]', 'g')
  const semAcento = titulo
    .toLowerCase()
    .normalize('NFD')
    .replace(REGEX_MARCA_COMBINANTE, '')
  const somenteValidos = semAcento.replace(/[^a-z0-9_]/g, '_')
  const colapsado = somenteValidos.replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  const truncado = colapsado.slice(0, LIMITE_META_NOME).replace(/^_+|_+$/g, '')
  return `${truncado}_${sufixo}`
}
