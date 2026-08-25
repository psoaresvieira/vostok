import { FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'

// Mensagens dos codigos que trocarSenha (acoes.ts) e trocaDeSenhaSchema
// (esquemas.ts) podem devolver. Mesmo padrao de (auth)/erros.ts: traduzir o
// codigo aqui, nunca no componente.
const MENSAGENS_ERRO: Record<string, string> = {
  senha_curta: 'A senha precisa de pelo menos 8 caracteres.',
  senhas_diferentes: 'As duas senhas não conferem.',
  senha_igual: 'A senha nova precisa ser diferente da atual.',
  sem_sessao: 'Sua sessão expirou. Entre novamente.',
  erro_ao_trocar_senha: 'Não foi possível trocar a senha. Tente de novo.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

export function mensagemDeErroSenha(codigo: string): string {
  // hasOwnProperty.call, e nunca o indice cru: MENSAGENS_ERRO['toString']
  // encontraria o toString herdado de Object.prototype (funcao, nunca
  // undefined), entao o `?? codigo` no indice cru nunca dispararia. Mesmo
  // guard de mensagemDeErroScript (scripts/erros.ts).
  return Object.prototype.hasOwnProperty.call(MENSAGENS_ERRO, codigo)
    ? MENSAGENS_ERRO[codigo]
    : codigo
}
