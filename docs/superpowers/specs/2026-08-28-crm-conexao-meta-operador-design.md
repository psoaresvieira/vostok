# Conexão do Meta pelo operador — primeira conta de anúncio real

**Data:** 2026-08-28 · **Estado:** aprovado pelo Pedro em conversa · **Escopo:** implantação da primeira Page real de um cliente no Vostok, no tenant do cliente, feita pelo dono da plataforma.

## Contexto

O código da integração Meta Lead Ads está completo desde os Planos 3/4 (OAuth, escolha de Page, `posseDaPagina`, `assinarLeadgen`, webhook com HMAC, ingestão com dedup, reprocessamento), mas nunca foi provado contra o Graph real. A migration `0030` deu ao dono da plataforma bypass na guarda de papel das seis RPCs de conexão (modo operador: toda implantação de cliente é manual do Pedro), porém **não existe caller**: a Server Action da UI (`acoes-fontes.ts`) grava sempre na conta ativa da sessão, e o dono não pode ser membro da conta do cliente (`0028`).

Decisões tomadas na conversa:

- A Page/conta de anúncio é **do cliente**, mas mora no **Business Manager da Vostok** — o Pedro administra o ativo.
- O lead vai cair no **tenant do cliente** no Vostok (o cliente tem login próprio e verá o funil dele).
- O app do Meta hoje cadastrado na Vercel será **substituído por um app novo criado dentro do BM da Vostok** (Business Verification e App Review pertencem ao Business que assina).
- Token: **System User** permanente do BM da Vostok, não OAuth pelo navegador. Em modo de desenvolvimento do app, token de System User do BM dono vale para ativos do próprio BM.

## Parte 1 — Meta e Vercel (operacional, sem código)

1. App novo, tipo Business, no BM da Vostok → App ID / App Secret.
2. Produto **Webhooks**: objeto **Page**, campo `leadgen`, URL de callback `https://vostok-beta.vercel.app/api/webhooks/meta`, verify token gerado com `openssl rand -hex 32`. A verificação só passa depois do redeploy da Vercel com o token novo (passo 4).
3. Produto **Login do Facebook**: URI de redirecionamento `https://vostok-beta.vercel.app/api/integracoes/meta/retorno`. Configurado para o futuro; esta implantação não passa por ele.
4. **System User** no BM da Vostok, com a Page do cliente **atribuída** ao System User, e token permanente (sem expiração) com `pages_show_list`, `pages_manage_metadata`, `leads_retrieval`, gerado para o app novo.
5. Vercel (Production): trocar `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` → redeploy → voltar ao painel e verificar o webhook (o GET de prod já devolve 403 para token errado; com o certo ecoa o `hub.challenge` cru).
6. Verificação independente: `GET /{app-id}/subscriptions?access_token={app-id}|{app-secret}` lista `page` com `leadgen` e a URL de callback.

## Parte 2 — Script de operador (código)

`scripts/conectar-meta-operador.ts`, executado localmente contra o Supabase de produção. Executor: `tsx` como devDependency (o alias `@/` do repo exige resolução de `paths`; `node --experimental-strip-types` não resolve alias). Script em `package.json`: `"meta:conectar": "tsx scripts/conectar-meta-operador.ts"`.

### Entradas

Argumentos: `--conta <account_id uuid>` (obrigatório), `--page <page_id>` (obrigatório), `--responsavel <user_id uuid>` (opcional; nulo é válido — `e_membro_da_conta(conta, null)` é verdadeiro por definição, mesmo contrato da UI), `--reivindicar` (flag; usa `reivindicar_fonte_meta` em vez de `conectar_fonte_meta`).

Variáveis de ambiente (lidas de um arquivo passado em `--env <caminho>`, tipicamente o `vercel env pull` de produção mais as três abaixo): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `INGESTAO_SEGREDO`, `META_API_VERSION`; `OPERADOR_EMAIL` e `OPERADOR_SENHA` (login do dono — a RPC exige `auth.uid()` não nulo e `sou_dono_da_plataforma()`); `META_TOKEN_SYSTEM_USER`.

O script falha fechado, antes de tocar o Graph, se qualquer variável obrigatória estiver vazia — a mesma razão da guarda `ingestao_nao_configurada` da action: `assinarLeadgen` rodaria e a gravação falharia depois, deixando assinatura/desassinatura de uma Page de terceiro como rastro.

### Sequência (idêntica à action da UI, reusando `MetaGraphReal`)

1. `signInWithPassword` com `@supabase/supabase-js` (client anon, `persistSession: false`) → sessão do dono.
2. `listarPaginas(META_TOKEN_SYSTEM_USER)` (`/me/accounts` do System User devolve as Pages atribuídas a ele, cada uma com token de Page) → localiza `--page`; ausente → `pagina_nao_encontrada` (mensagem: a Page não está atribuída ao System User).
3. `posseDaPagina(pageId, tokenDaPagina)` — prova contra o Graph; é a primeira vez que essa afirmação de segurança é validada fora do duplo.
4. `assinarLeadgen(pageId, tokenDaPagina)`.
5. `rpc('conectar_fonte_meta' | 'reivindicar_fonte_meta', { p_segredo, p_account_id: --conta, p_page_id, p_nome, p_token: tokenDaPagina, p_responsavel })`.
6. Se a gravação falhar: compensação com `desassinarLeadgen` **somente** quando a assinatura foi desta chamada — isto é, não é reivindicação e o erro não é `page_ja_conectada` (a mesma regra e o mesmo comentário da action; a razão é a escalada de negação de serviço contra o tenant legítimo).
7. Sai com código 0 e imprime o `source_id`; erro imprime o código do domínio (`sem_permissao`, `responsavel_invalido`, `page_ja_conectada`, `posse_nao_comprovada`, `meta_indisponivel`…) traduzido pela tabela de `erros.ts` quando existir.

### Fatoração

A orquestração (passos 2–6) vira uma função pura de dependências, `conectarPagina({ graph, gravar, pageId, tokenDoUsuario, reivindicar })`, em `src/lib/integracoes/conectar-pagina-operador.ts`; o script só faz parsing de argumentos, login e injeção. A action da UI **não** é refatorada nesta entrega para não arrastar seus testes — o script duplica a sequência conscientemente, com nota apontando para a action como fonte da regra.

### Testes

Unitário de `conectarPagina` com `MetaGraphFalso` e `gravar` falso: ordem posse→assinar→gravar (uma falha em posse não chega a assinar; afirmado sobre o estado do duplo, não spy); compensação executada quando gravar falha com erro genérico numa conexão; **não** executada quando é reivindicação ou quando o erro é `page_ja_conectada`; Page inexistente devolve `pagina_nao_encontrada` sem chamar posse. A permissão do dono no banco já está coberta por `tests/integration/0030_conexoes_pelo_dono.test.ts`. Nenhum teste toca a rede (constraint da spec de ingestão continua valendo).

## Parte 3 — Prova ponta a ponta

Pré-condição operacional: o cliente **aceitou o convite** e é membro do tenant (senão `responsavel_invalido` se passado como responsável).

1. Rodar o script → `source_id`; `/config` do cliente mostra a Page conectada.
2. Lead Ads Testing Tool (`developers.facebook.com/tools/lead-ads-testing`) na Page do cliente, com um formulário real → lead em `/funil` do tenant do cliente com campanha/conjunto/anúncio e notificação ao responsável.
3. Reenviar o mesmo lead → um lead só (dedup por `leadgen_id`).
4. `integration_log` sem entrega pendente; se houver, o cron/pg_cron de reprocessamento a consome em até 10 min.

## Fora de escopo

WhatsApp real (Passo 3), App Review, Embedded Signup, refatoração da action da UI para compartilhar a orquestração, Google Ads.
