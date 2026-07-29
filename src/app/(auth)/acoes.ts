'use server'

import { redirect } from 'next/navigation'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { cadastroSchema, credenciaisSchema } from './esquemas'

export async function entrar(formData: FormData): Promise<Resultado<void>> {
  const parsed = credenciaisSchema.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const cliente = await criarClienteServidor()
  const { error } = await cliente.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.senha,
  })
  if (error) return falha('credenciais_invalidas')

  redirect('/funil')
}

export async function cadastrar(formData: FormData): Promise<Resultado<void>> {
  const parsed = cadastroSchema.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
    nome: formData.get('nome'),
    nomeConta: formData.get('nomeConta'),
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const cliente = await criarClienteServidor()
  const { error: erroSignup } = await cliente.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.senha,
    options: { data: { nome: parsed.data.nome } },
  })
  if (erroSignup) return falha(erroSignup.message)

  // criar_conta roda como DEFINER e usa auth.uid(): precisa da sessao ja ativa.
  const { error: erroConta } = await cliente.rpc('criar_conta', {
    p_nome: parsed.data.nomeConta,
  })
  if (erroConta) return falha(erroConta.message)

  redirect('/funil')
}

export async function aceitarConvite(token: string): Promise<Resultado<void>> {
  const cliente = await criarClienteServidor()
  const { error } = await cliente.rpc('accept_invite', { p_token: token })
  if (error) {
    for (const codigo of [
      'convite_invalido',
      'convite_expirado',
      'convite_ja_aceito',
      'convite_de_outro_email',
      'sem_email',
      'sem_sessao',
    ]) {
      if (error.message.includes(codigo)) return falha(codigo)
    }
    return falha(error.message)
  }
  return ok(undefined)
}

export async function sair(): Promise<void> {
  const cliente = await criarClienteServidor()
  await cliente.auth.signOut()
  redirect('/login')
}
