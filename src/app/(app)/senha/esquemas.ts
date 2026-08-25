import { z } from 'zod'
import { credenciaisSchema } from '@/app/(auth)/esquemas'

// Reusa o proprio campo de senha do cadastro — nao redeclarar o piso de 8
// caracteres como literal aqui, senao os dois numeros divergem com o tempo. O
// refine roda depois da validacao de cada campo, entao 'senhas_diferentes' so
// aparece quando a senha ja passou do minimo (as duas causas nunca competem
// pelo issues[0] do mesmo parse).
export const trocaDeSenhaSchema = z
  .object({
    senha: credenciaisSchema.shape.senha,
    confirmacao: z.string(),
  })
  .refine((dados) => dados.senha === dados.confirmacao, {
    message: 'senhas_diferentes',
    path: ['confirmacao'],
  })
