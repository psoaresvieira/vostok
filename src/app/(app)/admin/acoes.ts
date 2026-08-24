'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { criarContaCliente, reemitirConvite } from '@/lib/data/plataforma'

const novaContaSchema = z.object({
  nome: z.string().trim().min(1, 'nome_obrigatorio'),
  email: z.string().trim().toLowerCase().pipe(z.email('email_invalido')),
})

export async function criarContaClienteAction(formData: FormData): Promise<Resultado<string>> {
  const parsed = novaContaSchema.safeParse({
    nome: formData.get('nome'),
    email: formData.get('email'),
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const r = await criarContaCliente(parsed.data.nome, parsed.data.email)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/admin')
  return ok(r.valor)
}

export async function reemitirConviteAction(conviteId: string): Promise<Resultado<string>> {
  const id = conviteId.trim()
  if (!id) return falha('convite_invalido')

  const r = await reemitirConvite(id)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/admin')
  return ok(r.valor)
}
