/**
 * Guarda contra o acidente mais perigoso do repo: se `SUPABASE_DB_URL` um dia
 * apontar para um banco real — um `.env` copiado, uma variavel exportada na
 * shell errada — `limparBanco()` (tests/integration/helpers/db.ts) destrói o
 * banco inteiro sem perguntar nada: `truncate` em 14 tabelas mais
 * `delete from auth.users`. O mesmo vale para o `delete` de
 * `tests/e2e/global-setup.ts`. Esta funcao e a unica coisa entre esse
 * acidente e o dano.
 *
 * Lanca em vez de devolver booleano de proposito: os dois consumidores
 * calculam a string de conexao numa constante de modulo, avaliada no
 * `import` — antes de qualquer `connect()`. Um booleano exigiria o chamador
 * lembrar de checar; lancar torna a checagem impossivel de pular.
 *
 * Parse que falha tambem lanca, nunca deixa passar: nao formar opiniao sobre
 * uma string estranha nao e motivo para permitir um default destrutivo.
 */
export function exigirHostLocal(conexao: string): string {
  let host: string
  try {
    host = new URL(conexao).hostname
  } catch (e) {
    // Nunca interpola `conexao` na mensagem (achado 8 do review final): ela
    // carrega a senha do Postgres, e essa mensagem lanca ate a raiz e pousa
    // em log de CI. `{ cause }` preserva o erro de parse original para quem
    // depurar sem reabrir esse vazamento.
    throw new Error('SUPABASE_DB_URL nao e uma URL de conexao valida.', { cause: e })
  }

  if (host !== '127.0.0.1' && host !== 'localhost') {
    // So o host, nunca a string de conexao inteira: ela carrega usuario e
    // senha, e essa e a unica coisa entre esse segredo e o log de CI.
    throw new Error(
      `SUPABASE_DB_URL aponta para um host que nao e local ("${host}"). ` +
        'Operacoes destrutivas de teste (limparBanco, global-setup) so rodam ' +
        'contra 127.0.0.1 ou localhost.',
    )
  }

  return conexao
}
