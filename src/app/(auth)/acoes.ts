'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { cadastroSchema, cadastroPorConviteSchema, credenciaisSchema } from './esquemas'

/** Token do convite carregado pelo formulario, ou null quando nao ha convite. */
function tokenDoConvite(formData: FormData): string | null {
  const bruto = String(formData.get('convite') ?? '').trim()
  return bruto.length > 0 ? bruto : null
}

export async function entrar(formData: FormData): Promise<Resultado<void>> {
  const parsed = credenciaisSchema.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)
  const convite = tokenDoConvite(formData)

  const cliente = await criarClienteServidor()
  const { error } = await cliente.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.senha,
  })
  if (error) return falha('credenciais_invalidas')

  // Quem ja tinha conta e clicou no link do convite entra e resgata na mesma
  // ida. Sem isso o token se perdia no login e o convite ficava pendente para
  // sempre.
  if (convite) {
    const r = await aceitarConvite(convite)
    if (!r.ok) return falha(r.erro)
  }

  redirect('/funil')
}

export async function cadastrar(formData: FormData): Promise<Resultado<void>> {
  const convite = tokenDoConvite(formData)
  // Dois caminhos de verdade diferentes, nao um if no meio de um so: com convite
  // o usuario ENTRA numa conta existente; sem convite ele ABRE uma conta e vira
  // admin dela. Chamar criar_conta no caminho do convite era o bug — o convidado
  // caia numa empresa vazia sua e o convite nunca era resgatado.
  return convite ? cadastrarComConvite(formData, convite) : cadastrarAbrindoConta(formData)
}

async function cadastrarAbrindoConta(formData: FormData): Promise<Resultado<void>> {
  const parsed = cadastroSchema.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
    nome: formData.get('nome'),
    nomeConta: formData.get('nomeConta'),
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const cliente = await criarClienteServidor()
  const criado = await criarUsuario(cliente, parsed.data)
  if (!criado.ok) return falha(criado.erro)

  // criar_conta roda como DEFINER e usa auth.uid(): precisa da sessao ja ativa.
  const { error: erroConta } = await cliente.rpc('criar_conta', {
    p_nome: parsed.data.nomeConta,
  })
  if (erroConta) return falha(erroConta.message)

  redirect('/funil')
}

async function cadastrarComConvite(
  formData: FormData,
  convite: string,
): Promise<Resultado<void>> {
  const parsed = cadastroPorConviteSchema.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
    nome: formData.get('nome'),
    convite,
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const cliente = await criarClienteServidor()
  const criado = await criarUsuario(cliente, parsed.data)
  if (!criado.ok) return falha(criado.erro)

  // accept_invite tambem roda como DEFINER lendo auth.uid()/auth.jwt(): so
  // funciona com a sessao do signUp ja ativa. Se o email do cadastro nao for o
  // do convite, volta 'convite_de_outro_email' e o formulario mostra a mensagem
  // em vez de mandar o usuario para um funil que ele nao tem.
  const r = await aceitarConvite(convite)
  if (!r.ok) return falha(r.erro)

  redirect('/funil')
}

async function criarUsuario(
  cliente: SupabaseClient,
  dados: { email: string; senha: string; nome: string },
): Promise<Resultado<void>> {
  const { error } = await cliente.auth.signUp({
    email: dados.email,
    password: dados.senha,
    options: { data: { nome: dados.nome } },
  })
  if (error) return falha(error.message)
  return ok(undefined)
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
