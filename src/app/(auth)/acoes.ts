'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { criarClienteServidor } from '@/lib/supabase/servidor'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { cadastroPorConviteSchema, credenciaisSchema } from './esquemas'
import { codigoDoErroDoConvite } from './erros'

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
  // O cadastro aberto morreu com o modelo de negocio: conta nasce pela mao do
  // dono da plataforma (/admin), e quem chega aqui sem convite nao tem o que
  // cadastrar. A guarda de verdade esta no banco (criar_conta exige dono);
  // esta e' so a traducao educada.
  if (!convite) return falha('cadastro_fechado')
  return cadastrarComConvite(formData, convite)
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
  const { data, error } = await cliente.auth.signUp({
    email: dados.email,
    password: dados.senha,
    options: { data: { nome: dados.nome } },
  })
  if (error) {
    // Mensagem do GoTrue nunca vai crua para a tela — mesma disciplina dos
    // codigoDoErroDo* de scripts/erros.ts. So o "ja registrado" tem acao clara
    // para o usuario; o resto vira o generico. O `code` e' a API estavel
    // (mensagens sao reescritas sem versao); o substring fica de reserva.
    if (
      error.code === 'user_already_exists' ||
      error.code === 'email_exists' ||
      error.message.toLowerCase().includes('already registered')
    ) {
      return falha('email_ja_cadastrado')
    }
    console.error('signup recusado pelo gotrue', error.message)
    return falha('cadastro_indisponivel')
  }
  // Anti-enumeracao do GoTrue: com confirmacao de email ligada, signUp de um
  // email JA registrado devolve sucesso com user ofuscado (identities vazio) e
  // sem sessao. Sem esta guarda cairia no confirmacao_pendente abaixo — e o
  // email prometido nunca chegaria.
  if (data.user && data.user.identities?.length === 0) {
    return falha('email_ja_cadastrado')
  }
  // signUp sem sessao = confirmacao de email ligada no projeto. accept_invite
  // exige auth.uid(), entao seguir adiante devolveria 'sem_sessao' — mensagem
  // errada para quem acabou de se cadastrar e so precisa confirmar o email.
  if (!data.session) return falha('confirmacao_pendente')
  return ok(undefined)
}

export async function aceitarConvite(token: string): Promise<Resultado<void>> {
  const cliente = await criarClienteServidor()
  const { error } = await cliente.rpc('accept_invite', { p_token: token })
  if (error) {
    // O tradutor deriva do mapa de mensagens: codigo conhecido passa, mensagem
    // crua do Postgres/PostgREST vira o generico em vez de ecoar na tela.
    const codigo = codigoDoErroDoConvite(error.message)
    if (codigo === 'erro_ao_aceitar_convite') {
      console.error('accept_invite falhou fora do vocabulario', error.message)
    }
    return falha(codigo)
  }
  return ok(undefined)
}

export async function sair(): Promise<void> {
  const cliente = await criarClienteServidor()
  await cliente.auth.signOut()
  redirect('/login')
}
