import { formatarTelefone } from '@/lib/domain/formato'
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
const PADRAO_TAG = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g

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
