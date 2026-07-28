import { z } from 'zod'

export const credenciaisSchema = z.object({
  // z.email() e a forma atual do zod v4; o pipe preserva o trim/lowercase antes
  // da validacao de formato.
  email: z.string().trim().toLowerCase().pipe(z.email('email_invalido')),
  senha: z.string().min(8, 'senha_curta'),
})

export const cadastroSchema = credenciaisSchema.extend({
  nome: z.string().trim().min(1, 'nome_obrigatorio'),
  nomeConta: z.string().trim().min(1, 'nome_conta_obrigatorio'),
})
