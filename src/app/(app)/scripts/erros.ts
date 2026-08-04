import { FALHA_DE_CONEXAO, MENSAGEM_FALHA_DE_CONEXAO } from '@/lib/ui/acao'

// Mapa unico dos codigos de scripts/acoes.ts e do SupabaseScriptStore,
// importado pelo editor (editor.tsx) e pela biblioteca (page.tsx). Vive fora de
// acoes.ts pelo mesmo motivo de tarefas/erros.ts: 'use server' exige que todo
// export de la seja uma Server Action assincrona, entao nao da pra exportar um
// mapa dali. Chaves literais, e nunca importadas de lib/data/scripts.ts: este
// arquivo e' importado por componente cliente, e importar valor daquele modulo
// arrastaria next/headers (via supabase/servidor) para o bundle do browser.
const MENSAGENS_ERRO: Record<string, string> = {
  titulo_vazio: 'Escreva um título antes de salvar.',
  conteudo_vazio: 'Escreva o conteúdo do script antes de salvar.',
  tags_demais: 'No máximo 10 tags por script.',
  etapa_invalida:
    'Essa etapa não existe mais — pode ter sido excluída. Recarregue a página e escolha outra.',
  script_nao_encontrado: 'Esse script não existe mais ou você não tem acesso a ele.',
  sem_permissao: 'Só administradores e gestores editam scripts.',
  sem_sessao: 'Sua sessão expirou. Entre novamente.',
  erro_ao_salvar_script: 'Não foi possível salvar o script. Tente de novo.',
  erro_ao_carregar_scripts: 'Não foi possível carregar os scripts. Tente de novo.',
  [FALHA_DE_CONEXAO]: MENSAGEM_FALHA_DE_CONEXAO,
}

export function mensagemDeErroScript(codigo: string): string {
  // hasOwnProperty.call, e nunca o indice cru: MENSAGENS_ERRO['toString']
  // encontraria o toString herdado de Object.prototype (funcao, nunca
  // undefined), entao o `?? codigo` no indice cru nunca dispararia e a tela
  // receberia uma Function onde espera string. Mesmo guard de
  // codigoDoErroDoPainel logo abaixo.
  return Object.prototype.hasOwnProperty.call(MENSAGENS_ERRO, codigo)
    ? MENSAGENS_ERRO[codigo]
    : codigo
}

/** Codigo generico de leitura, o mesmo que o SupabaseScriptStore devolve. */
const ERRO_AO_CARREGAR_SCRIPTS = 'erro_ao_carregar_scripts'

/** Codigo generico de escrita, o mesmo que o SupabaseScriptStore devolve
 * (ERRO_AO_SALVAR_SCRIPT em lib/data/scripts.ts). */
const ERRO_AO_SALVAR_SCRIPT = 'erro_ao_salvar_script'

/**
 * Normaliza para o generico de leitura qualquer codigo que o mapa acima nao
 * conheca, para o painel de scripts da ficha do lead.
 *
 * Existe porque a falha pode vir de DOIS lugares com vocabularios diferentes. A
 * CONSULTA (`paraEtapa`) so devolve codigo do store, sempre mapeado. Mas a
 * CONSTRUCAO do store (`criarScriptStoreDoServidor`) falha por caminhos que nao
 * falam de script nenhum: `resolverContaAtiva` devolve `falha(error.message)` —
 * a mensagem CRUA do Postgres/PostgREST — e `falha('sem_conta')`. Nenhum dos
 * dois esta no mapa, e `mensagemDeErroScript` ecoa o codigo que nao conhece:
 * sem esta normalizacao, texto de banco de dados apareceria na ficha do lead.
 *
 * Lista de permissao, e nao lista de proibicao: cobre tambem o codigo novo que
 * um caminho futuro invente sem passar por aqui. O preco e' perder a distincao
 * de causas que o usuario nao poderia acionar de qualquer forma — a mesma
 * troca que `codigoDoErroAoGravarScript` (lib/data/scripts.ts) ja faz.
 */
export function codigoDoErroDoPainel(codigo: string): string {
  // `hasOwnProperty.call`, e nunca `codigo in MENSAGENS_ERRO`: o `in` percorre
  // a cadeia de prototipos, entao 'constructor', 'toString' e 'valueOf'
  // passariam por chaves conhecidas — e o objeto literal acima tem
  // Object.prototype na cadeia.
  return Object.prototype.hasOwnProperty.call(MENSAGENS_ERRO, codigo)
    ? codigo
    : ERRO_AO_CARREGAR_SCRIPTS
}

/**
 * Mesma normalizacao de codigoDoErroDoPainel, mas para o lado da escrita: as
 * tres Server Actions (criarScript, atualizarScript, excluirScript, em
 * acoes.ts) encaminham `contexto.erro` quando `criarScriptStoreDoServidor`
 * falha ANTES de existir store — e esse erro pode vir de
 * `resolverContaAtiva` como `falha(error.message)`, a mensagem CRUA do
 * Postgres/PostgREST, ou como `falha('sem_conta')`. Nenhum dos dois esta no
 * mapa acima, e sem esta normalizacao o editor (que chama
 * mensagemDeErroScript direto no resultado da action) ecoaria texto de banco
 * de dados. Lista de permissao, como a do painel: cobre tambem codigo novo
 * que um caminho futuro invente sem passar por aqui.
 */
export function codigoDoErroDaAcao(codigo: string): string {
  return Object.prototype.hasOwnProperty.call(MENSAGENS_ERRO, codigo)
    ? codigo
    : ERRO_AO_SALVAR_SCRIPT
}
