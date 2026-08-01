import { normalizarEmail, normalizarTelefone } from '@/lib/domain/normalizacao'
import type { DadosDoLead } from './dados'

// column_id padrao do formulario de lead do Google Ads. Qualquer column_id
// fora desta lista e pergunta de qualificacao definida pelo anunciante, sem
// schema fixo — vai para `extras`, igual ao mapeador do Meta.
const CAMPO_NOME_COMPLETO = 'FULL_NAME'
const CAMPO_PRIMEIRO_NOME = 'FIRST_NAME'
const CAMPO_SOBRENOME = 'LAST_NAME'
const CAMPO_EMAIL = 'EMAIL'
const CAMPO_TELEFONE = 'PHONE_NUMBER'
const CAMPO_EMPRESA = 'COMPANY_NAME'

const CAMPOS_CONHECIDOS: ReadonlySet<string> = new Set([
  CAMPO_NOME_COMPLETO,
  CAMPO_PRIMEIRO_NOME,
  CAMPO_SOBRENOME,
  CAMPO_EMAIL,
  CAMPO_TELEFONE,
  CAMPO_EMPRESA,
])

/** Uma linha de `user_column_data`. O payload chega como `unknown` (webhook
 * de terceiro, sem schema garantido em compilacao), entao todo campo aqui e
 * opcional e cada leitura confere o tipo antes de usar. */
type ColunaDoGoogle = { column_id?: unknown; string_value?: unknown; column_name?: unknown }

function textoOuNulo(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return v.length > 0 ? v : null
}

/** O Google manda id como numero. Vira texto porque as colunas sao text — e
 * porque o mesmo id chegando ora numero ora string criaria dois grupos
 * distintos na metrica. */
function idOuNulo(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string' && v.length > 0) return v
  return null
}

/** full_name manda; sem ele, junta first_name + last_name com um espaco. */
function montarNome(nomeCompleto: string | null, primeiroNome: string | null, sobrenome: string | null): string | null {
  if (nomeCompleto) return nomeCompleto
  const partes = [primeiroNome, sobrenome].filter((p): p is string => p !== null)
  return partes.length > 0 ? partes.join(' ') : null
}

export function mapearLeadDoGoogle(payload: Record<string, unknown>): DadosDoLead {
  // Payload torto (chave ausente, ou presente com tipo errado) nao pode
  // derrubar a rota do webhook: vira lista vazia, e tudo cai em nulo abaixo.
  const bruto = payload.user_column_data
  const colunas: ColunaDoGoogle[] = Array.isArray(bruto) ? (bruto as ColunaDoGoogle[]) : []

  const porId = new Map<string, ColunaDoGoogle>()
  for (const col of colunas) {
    if (typeof col.column_id === 'string') porId.set(col.column_id, col)
  }

  const telefoneCru = textoOuNulo(porId.get(CAMPO_TELEFONE)?.string_value)
  const emailCru = textoOuNulo(porId.get(CAMPO_EMAIL)?.string_value)

  // Nada e descartado: column_id desconhecido vai para extras. column_name e'
  // o texto que o cliente digitou ao criar a pergunta no formulario — chave
  // mais legivel na timeline do que o column_id numerico/interno. Cai para
  // column_id só quando o Google nao manda column_name.
  const extras: Record<string, string> = {}
  for (const col of colunas) {
    const id = typeof col.column_id === 'string' ? col.column_id : null
    if (id !== null && CAMPOS_CONHECIDOS.has(id)) continue
    const nomeLegivel = typeof col.column_name === 'string' && col.column_name.length > 0 ? col.column_name : null
    const chave = nomeLegivel ?? id
    // Sem column_id nem column_name nao ha chave honesta para essa coluna —
    // inventar 'campo_desconhecido' faz duas colunas assim colidirem no mesmo
    // slot do Record e uma apagar a outra, perdendo dado. Melhor pular: o
    // payload bruto (integration_log) preserva a coluna inteira mesmo assim.
    if (chave === null) continue
    // Sem valor, a chave nem entra em extras — extras guarda respostas, e uma
    // pergunta sem resposta nao tem resposta para guardar. Escrever '' aqui
    // afirmaria na timeline do lead que ele respondeu em branco, o que e um
    // fato diferente de nao ter respondido. Nao "simplificar" para `?? ''`.
    if (typeof col.string_value === 'string' && col.string_value.length > 0) {
      extras[chave] = col.string_value
    }
  }

  return {
    nome: montarNome(
      textoOuNulo(porId.get(CAMPO_NOME_COMPLETO)?.string_value),
      textoOuNulo(porId.get(CAMPO_PRIMEIRO_NOME)?.string_value),
      textoOuNulo(porId.get(CAMPO_SOBRENOME)?.string_value)
    ),
    telefone: telefoneCru,
    telefoneE164: normalizarTelefone(telefoneCru),
    email: emailCru,
    emailNorm: normalizarEmail(emailCru),
    empresa: textoOuNulo(porId.get(CAMPO_EMPRESA)?.string_value),
    campanhaOrigem: null,
    formularioOrigem: idOuNulo(payload.form_id),
    campanhaId: idOuNulo(payload.campaign_id),
    campanhaNome: null,
    conjuntoId: idOuNulo(payload.adgroup_id),
    conjuntoNome: null,
    anuncioId: idOuNulo(payload.creative_id),
    anuncioNome: null,
    formularioId: idOuNulo(payload.form_id),
    clickId: idOuNulo(payload.gcl_id),
    extras,
  }
}
