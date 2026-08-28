import { parseArgs } from 'node:util'
import { falha, ok, type Resultado } from '@/lib/domain/resultado'

export type ArgumentosOperador = {
  conta: string
  page: string
  responsavel: string | null
  reivindicar: boolean
  env: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const OPCOES = {
  conta: { type: 'string' },
  page: { type: 'string' },
  responsavel: { type: 'string' },
  env: { type: 'string' },
  reivindicar: { type: 'boolean', default: false },
} as const

export function lerArgumentos(argv: string[]): Resultado<ArgumentosOperador> {
  let values: ReturnType<typeof parseArgs<{ args: string[]; options: typeof OPCOES; strict: true }>>['values']
  try {
    ;({ values } = parseArgs({ args: argv, options: OPCOES, strict: true }))
  } catch {
    return falha('argumentos_invalidos')
  }
  if (!values.conta || !UUID.test(values.conta)) return falha('conta_invalida')
  if (!values.page || values.page.trim().length === 0) return falha('page_invalida')
  if (values.responsavel !== undefined && !UUID.test(values.responsavel)) return falha('responsavel_invalido')
  if (!values.env) return falha('env_invalido')
  return ok({
    conta: values.conta,
    page: values.page.trim(),
    responsavel: values.responsavel ?? null,
    reivindicar: values.reivindicar ?? false,
    env: values.env,
  })
}

export type EnvsOperador = {
  url: string
  anonKey: string
  segredo: string
  email: string
  senha: string
  tokenMeta: string
}

const MAPA: [keyof EnvsOperador, string][] = [
  ['url', 'NEXT_PUBLIC_SUPABASE_URL'],
  ['anonKey', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  ['segredo', 'INGESTAO_SEGREDO'],
  ['email', 'OPERADOR_EMAIL'],
  ['senha', 'OPERADOR_SENHA'],
  ['tokenMeta', 'META_TOKEN_SYSTEM_USER'],
]

/**
 * Falha fechado ANTES de tocar o Graph: sem INGESTAO_SEGREDO a RPC recusaria
 * depois de `assinarLeadgen` ja ter rodado, e a compensacao deixaria rastro
 * de assinar/desassinar numa Page de terceiro (mesma razao da guarda
 * `ingestao_nao_configurada` da action).
 */
export function envsObrigatorias(env: NodeJS.ProcessEnv): Resultado<EnvsOperador> {
  const saida = {} as EnvsOperador
  for (const [chave, nome] of MAPA) {
    const v = env[nome]
    if (!v || v.length === 0) return falha(`env_ausente:${nome}`)
    saida[chave] = v
  }
  return ok(saida)
}
