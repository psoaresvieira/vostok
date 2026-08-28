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

  // Disparo de WhatsApp (Plano 11). Moram no MESMO mapa, e nao num
  // template/erros.ts proprio, porque as duas telas que os mostram — o bloco de
  // /scripts/[id] e o painel de scripts da ficha do lead — ja traduzem codigo de
  // script pelo mesmo caminho, e um segundo mapa faria cada tela ter que saber
  // de qual vocabulario o codigo veio antes de escolher o tradutor.
  sem_conexao_whatsapp: 'Conecte um número de WhatsApp em Configuração antes de usar templates.',
  template_variavel_desconhecida:
    'O script usa uma variável que o CRM não conhece. Confira os nomes.',
  template_posicional_reservado:
    'O script contém {{número}}, forma reservada dos templates do Meta. Troque por uma variável nomeada.',
  // Fora da lista do brief: guarda de `submeterTemplate` contra payload
  // forjado. A assinatura da action e' 'marketing' | 'utility', mas o tipo nao
  // sobrevive ao POST — e sem esta recusa a categoria invalida so pararia no
  // check da 0022, DEPOIS de o Meta ja ter registrado um template orfao.
  template_categoria_invalida: 'Escolha marketing ou utilidade antes de submeter.',
  template_ja_pendente: 'Este script já tem um template em análise no Meta. Aguarde a resposta.',
  template_ja_existe: 'Este script já tem um template. Recarregue a página.',
  template_recusado_pelo_meta: 'O Meta recusou a submissão. Tente de novo em alguns minutos.',
  template_nao_encontrado: 'Esse template não existe mais. Recarregue a página.',
  template_nao_aprovado: 'O template deste script ainda não foi aprovado pelo Meta.',
  template_desatualizado: 'O script mudou depois da aprovação. Re-submeta o template para enviar.',
  // Mesma frase dos outros tres mapas do app (funil/erros.ts,
  // tarefas/erros.ts, funil/drawer/etiquetas.tsx): o codigo vem da guarda de
  // `enviarWhatsApp` quando o lead nao existe OU a RLS o esconde — daqui os
  // dois sao indistinguiveis, e a acao do usuario e' a mesma.
  lead_nao_encontrado: 'Você não tem acesso a esse lead.',
  whatsapp_sem_telefone: 'Este lead não tem telefone.',
  whatsapp_lacunas: 'Faltam dados do lead para preencher o template.',
  envio_recusado: 'O Meta recusou o envio. Confira o template e tente de novo.',
  whatsapp_indisponivel: 'O Meta não respondeu. Tente de novo em alguns minutos.',
  whatsapp_enviado_sem_evento:
    'Mensagem enviada. Não conseguimos registrá-la na linha do tempo do lead.',
  erro_ao_salvar_template: 'Não foi possível salvar o template. Tente de novo.',
  erro_ao_carregar_templates: 'Não foi possível carregar os templates. Tente de novo.',
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

/** Generico de escrita do lado do template, o mesmo que o
 * SupabaseTemplateStore devolve (ERRO_AO_SALVAR_TEMPLATE em
 * lib/data/templates.ts). */
const ERRO_AO_SALVAR_TEMPLATE = 'erro_ao_salvar_template'

/**
 * Mesma normalizacao de `codigoDoErroDaAcao`, mas com o generico do TEMPLATE:
 * `submeterTemplate` (acoes-template.ts) encaminha codigo de tres origens que
 * nao falam de template nenhum — `resolverContaAtiva` (`falha(error.message)`
 * cru do Postgres, ou 'sem_conta'), `criarDisparoServico`
 * ('ingestao_nao_configurada') e a propria RPC ('segredo_invalido'). Nenhum
 * esta no mapa.
 *
 * Existe separada de `codigoDoErroDaAcao` porque o fallback dela diria "não foi
 * possível salvar o SCRIPT" para quem clicou em "Submeter ao WhatsApp" — o
 * script nem foi tocado, e a frase mandaria o usuario procurar o problema no
 * lugar errado. Lista de permissao, como as outras duas.
 */
export function codigoDoErroDoTemplate(codigo: string): string {
  return Object.prototype.hasOwnProperty.call(MENSAGENS_ERRO, codigo)
    ? codigo
    : ERRO_AO_SALVAR_TEMPLATE
}
