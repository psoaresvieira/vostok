'use server'

import { criarClienteServidor } from '@/lib/supabase/servidor'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { trocaDeSenhaSchema } from './esquemas'

export async function trocarSenha(formData: FormData): Promise<Resultado<void>> {
  const parsed = trocaDeSenhaSchema.safeParse({
    senha: formData.get('senha'),
    confirmacao: formData.get('confirmacao'),
  })
  if (!parsed.success) return falha(parsed.error.issues[0].message)

  const cliente = await criarClienteServidor()
  const { error } = await cliente.auth.updateUser({ password: parsed.data.senha })
  if (error) {
    // Mensagem do GoTrue nunca vai crua para a tela — mesma disciplina de
    // criarUsuario em (auth)/acoes.ts. O `code` e' a API estavel (mensagens
    // sao reescritas sem versao); o substring fica de reserva.
    if (
      error.code === 'same_password' ||
      error.message.toLowerCase().includes('different from the old')
    ) {
      return falha('senha_igual')
    }
    if (error.message.toLowerCase().includes('session')) {
      return falha('sem_sessao')
    }
    console.error('updateUser recusado pelo gotrue', error.message)
    return falha('erro_ao_trocar_senha')
  }
  // Sem redirect: a pagina mostra confirmacao inline em vez de navegar.
  return ok(undefined)
}
