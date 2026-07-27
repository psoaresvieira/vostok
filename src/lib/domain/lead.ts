import { z } from 'zod'
import { normalizarEmail, normalizarTelefone } from './normalizacao'

export const leadSchema = z
  .object({
    nome: z.string().trim().min(1, 'nome_obrigatorio'),
    telefone: z.string().trim().nullish(),
    email: z.string().trim().nullish(),
    empresa: z.string().trim().nullish(),
    valorCents: z.number().int().min(0).nullish(),
    responsavelId: z.string().uuid().nullish(),
  })
  .transform((dados) => ({
    ...dados,
    telefone: dados.telefone || null,
    email: dados.email || null,
    empresa: dados.empresa || null,
    valorCents: dados.valorCents ?? null,
    responsavelId: dados.responsavelId ?? null,
    telefoneE164: normalizarTelefone(dados.telefone ?? null),
    emailNorm: normalizarEmail(dados.email ?? null),
  }))

export type NovoLead = z.output<typeof leadSchema>

export function horasNaEtapa(entrouEm: Date, agora: Date): number {
  const ms = agora.getTime() - entrouEm.getTime()
  if (ms <= 0) return 0
  return Math.floor(ms / 3_600_000)
}

export function rotuloTempoNaEtapa(horas: number): string {
  if (horas < 1) return 'agora'
  if (horas < 24) return `${horas}h`
  return `${Math.floor(horas / 24)}d`
}
