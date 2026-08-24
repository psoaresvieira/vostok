import { z } from 'zod'

export const credenciaisSchema = z.object({
  // z.email() e a forma atual do zod v4; o pipe preserva o trim/lowercase antes
  // da validacao de formato.
  email: z.string().trim().toLowerCase().pipe(z.email('email_invalido')),
  senha: z.string().min(8, 'senha_curta'),
})

// Quem chega por convite entra numa conta que ja existe: nao ha empresa para
// nomear. Exigir nomeConta aqui era o que empurrava o convidado para criar_conta
// e virar admin de uma conta vazia, deixando o convite sem resgate.
export const cadastroPorConviteSchema = credenciaisSchema.extend({
  nome: z.string().trim().min(1, 'nome_obrigatorio'),
  convite: z.string().trim().min(1, 'convite_invalido'),
})
