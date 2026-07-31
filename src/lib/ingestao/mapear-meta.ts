import { normalizarEmail, normalizarTelefone } from '@/lib/domain/normalizacao'
import type { LeadDoMeta } from '@/lib/integracoes/meta'
import type { DadosDoLead } from './dados'

// Nomes de campo padrao do formulario de leadgen do Meta. Qualquer `name`
// fora desta lista e pergunta de qualificacao que o dono do anuncio escreveu
// no Ads Manager, e o schema dela e livre — por isso ela vai para `extras`
// em vez de tentar um mapeamento que nao existe.
const CAMPO_NOME_COMPLETO = 'full_name'
const CAMPO_PRIMEIRO_NOME = 'first_name'
const CAMPO_SOBRENOME = 'last_name'
const CAMPO_EMAIL = 'email'
const CAMPO_TELEFONE = 'phone_number'
const CAMPO_EMPRESA = 'company_name'

const CAMPOS_CONHECIDOS: ReadonlySet<string> = new Set([
  CAMPO_NOME_COMPLETO,
  CAMPO_PRIMEIRO_NOME,
  CAMPO_SOBRENOME,
  CAMPO_EMAIL,
  CAMPO_TELEFONE,
  CAMPO_EMPRESA,
])

type CampoDoMeta = LeadDoMeta['campos'][number]

/** `values` pode vir ausente ou `[]` — o Graph API real omite a chave para
 * pergunta nao respondida. Nunca inventa string vazia: vira nulo. */
function primeiroValor(campo: CampoDoMeta | undefined): string | null {
  const v = campo?.values?.[0]
  return v && v.length > 0 ? v : null
}

/** full_name manda; sem ele, junta first_name + last_name com um espaco.
 * Sem nenhum dos tres, fica nulo — o fallback 'Lead sem nome' e' do banco
 * (migration 0011), nao deste mapeador. */
function montarNome(nomeCompleto: string | null, primeiroNome: string | null, sobrenome: string | null): string | null {
  if (nomeCompleto) return nomeCompleto
  const partes = [primeiroNome, sobrenome].filter((p): p is string => p !== null)
  return partes.length > 0 ? partes.join(' ') : null
}

export function mapearLeadDoMeta(
  lead: LeadDoMeta,
  extra: { campanha: string | null; formulario: string | null }
): DadosDoLead {
  const porNome = new Map(lead.campos.map((c) => [c.name, c]))

  const telefoneCru = primeiroValor(porNome.get(CAMPO_TELEFONE))
  const emailCru = primeiroValor(porNome.get(CAMPO_EMAIL))

  // Nada e descartado: todo campo que nao esta na lista de conhecidos vai
  // para extras com o proprio nome como chave, para chegar na timeline do
  // lead mesmo sem mapeamento dedicado.
  const extras: Record<string, string> = {}
  for (const campo of lead.campos) {
    if (CAMPOS_CONHECIDOS.has(campo.name)) continue
    // Sem valor, a chave nem entra em extras — extras guarda respostas, e uma
    // pergunta sem resposta nao tem resposta para guardar. Escrever '' aqui
    // afirmaria na timeline do lead que ele respondeu em branco, o que e um
    // fato diferente de nao ter respondido. O payload bruto (integration_log)
    // continua guardando que a pergunta foi feita. Nao "simplificar" para
    // `?? ''`.
    const valor = campo.values?.[0]
    if (valor) extras[campo.name] = valor
  }

  return {
    nome: montarNome(
      primeiroValor(porNome.get(CAMPO_NOME_COMPLETO)),
      primeiroValor(porNome.get(CAMPO_PRIMEIRO_NOME)),
      primeiroValor(porNome.get(CAMPO_SOBRENOME))
    ),
    telefone: telefoneCru,
    telefoneE164: normalizarTelefone(telefoneCru),
    email: emailCru,
    emailNorm: normalizarEmail(emailCru),
    empresa: primeiroValor(porNome.get(CAMPO_EMPRESA)),
    campanhaOrigem: extra.campanha,
    formularioOrigem: extra.formulario,
    extras,
  }
}
