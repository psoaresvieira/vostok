// Mensagens dos codigos que o fluxo de autenticacao devolve. Mesma convencao do
// funil (ver funil/erros.ts): traduzir o codigo aqui, nunca no componente.
//
// O mapa vivia dentro de convite/[token]/page.tsx. Saiu de la porque agora ha
// tres telas capazes de terminar num erro de convite — a propria pagina do
// convite, o cadastro com ?convite= e o login com ?convite= — e a mensagem tem
// que ser a mesma nas tres.
//
// Vive fora de acoes.ts porque 'use server' exige que todo export daquele
// arquivo seja uma Server Action assincrona.
const MENSAGENS_ERRO: Record<string, string> = {
  credenciais_invalidas: 'Email ou senha incorretos.',
  cadastro_fechado: 'O cadastro é feito por convite. Peça o link ao administrador.',
  convite_invalido: 'Convite não encontrado.',
  convite_expirado: 'Este convite expirou. Peça um novo ao administrador.',
  convite_ja_aceito: 'Este convite já foi usado.',
  convite_de_outro_email:
    'Este convite foi enviado para outro email. Entre com o email convidado para aceitá-lo.',
  sem_email: 'Sua conta não tem email. Entre novamente para aceitar o convite.',
  sem_sessao: 'Crie sua conta ou entre para aceitar o convite.',
  email_ja_cadastrado: 'Este email já tem conta. Entre com sua senha para aceitar o convite.',
  confirmacao_pendente:
    'Confirme seu email pelo link que enviamos e depois entre para aceitar o convite.',
  cadastro_indisponivel: 'Não foi possível criar sua conta. Tente de novo em instantes.',
  erro_ao_aceitar_convite: 'Não foi possível aceitar o convite. Tente de novo.',
}

export function mensagemDeErro(codigo: string): string {
  return MENSAGENS_ERRO[codigo] ?? codigo
}

/**
 * Acha no erro do accept_invite um codigo do vocabulario deste mapa, ou o
 * generico. Derivado das CHAVES do proprio mapa — mesma disciplina dos
 * codigoDoErroDo* de scripts/erros.ts: uma lista paralela mantida a mao
 * derivaria do mapa com o tempo, e o codigo novo com traducao registrada
 * seria colapsado no generico sem nenhum teste falhar.
 */
export function codigoDoErroDoConvite(mensagem: string): string {
  for (const codigo of Object.keys(MENSAGENS_ERRO)) {
    if (mensagem.includes(codigo)) return codigo
  }
  return 'erro_ao_aceitar_convite'
}
