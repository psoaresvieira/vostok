import { z } from 'zod'

// Mesmo piso de 8 caracteres do credenciaisSchema de (auth)/esquemas.ts —
// nao inventar outro numero aqui. O refine roda depois da validacao de cada
// campo, entao 'senhas_diferentes' so aparece quando a senha ja passou do
// minimo (as duas causas nunca competem pelo issues[0] do mesmo parse).
export const trocaDeSenhaSchema = z
  .object({
    senha: z.string().min(8, 'senha_curta'),
    confirmacao: z.string(),
  })
  .refine((dados) => dados.senha === dados.confirmacao, {
    message: 'senhas_diferentes',
    path: ['confirmacao'],
  })
