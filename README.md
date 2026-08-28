# Vostok

CRM multi-tenant para negócios que rodam tráfego pago: lead do Meta e do Google Ads cai direto no funil por webhook nativo, com scripts de venda interpolados na ficha do lead e disparo de WhatsApp pelo Cloud API. Next.js 15 (App Router) + Supabase (Auth/Postgres/RLS/Realtime) + Vercel.

## Antes de expor em produção

**Histórico — risco aceito e fechado.** O Plano 3 (conexão de fontes via Meta OAuth, `conectar_fonte_meta`) foi ao ar com um risco aceito conscientemente, com dono: `p_page_id` era texto arbitrário, Facebook Page IDs são informação pública, e uma função Postgres nasce com `execute` para `public` — então qualquer pessoa que fizesse signup podia travar a Page de um concorrente para sempre, direto pelo PostgREST, sem passar por tela nenhuma. A vítima recebia `page_ja_conectada` para sempre e não tinha recurso: não enxergava nem apagava a linha do invasor. Detalhe completo em `docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md`, seção "Risco nomeado: squat de Page ID em `conectar_fonte_meta`".

**O que fechou o risco (Plano 4, Task 10).** O conserto tem duas metades, e nenhuma sozinha bastava:

1. **`conectar_fonte_meta` e `reivindicar_fonte_meta` (migration `0012_posse_da_page.sql`) passam a exigir o segredo de ingestão** (`p_segredo`, primeiro argumento) além das checagens de sessão/admin que já existiam. Isso não prova posse — o banco não tem como chamar o Graph API — mas tira a RPC do alcance de quem só tem uma sessão válida via PostgREST; só o servidor (que conhece `INGESTAO_SEGREDO`) chama.
2. **A Server Action prova posse contra o Graph antes de gravar.** `conectarPaginaAction` e `reivindicarPaginaAction` (`src/app/(app)/config/acoes-fontes.ts`) chamam `MetaGraph.posseDaPagina`, que compara `GET /me` (com o token da Page) contra o `page_id` pedido, **antes** de assinar o leadgen e antes de chamar a RPC. Uma gravação recusada por posse não provada nunca assina leadgen nem toca a RPC.

Trocar só uma das metades reabre o buraco: sem (1), qualquer um com sessão chama a RPC direto; sem (2), o segredo autoriza um squat idêntico, só que pela tela.

`conectar_fonte_google` **não** ganhou segredo — decisão registrada, não esquecimento: `external_id` é sempre nulo lá, o índice único global nem alcança essas linhas, e o token da URL é gerado no servidor. Não há Page de terceiro para travar.

**O caminho de reivindicação.** Quem prova, contra o Graph, que administra uma Page já conectada a outra conta do CRM pode reivindicá-la: a tela oferece o botão "Reivindicar esta página" quando uma tentativa de conectar volta `page_ja_conectada`, com aviso explícito do que acontece (a Page sai da outra conta e passa a entregar leads para esta). Qualquer admin da conta que prove posse pode reivindicar — é a única saída para uma Page squattada antes desta migration existir.

**O que continua sendo pré-requisito de produção**, nada disto sai de graça:

- `INGESTAO_SEGREDO` **definido por SQL direto no painel do Supabase em produção, nunca versionado, e de alta entropia.** O valor em `supabase/seed.sql` é público (está neste repo) e serve só para desenvolvimento/CI local — subir para produção com esse valor equivale a não ter segredo nenhum. Alta entropia não é opcional: este segredo gateia todo o caminho de escrita sem sessão (`segredo_confere`, migration `0010`), `hash_segredo` é SHA-256 sem salt, e as RPCs gateadas por ele necessariamente respondem diferente para um palpite certo e um errado (`segredo_invalido` vs. sucesso) — a resistência a força bruta é inteiramente a entropia do segredo. Gere com `openssl rand -hex 32`.
- `META_VERIFY_TOKEN` e `CRON_SECRET` configurados (webhook do Meta e a rota de reprocessamento, respectivamente).
- `META_FAKE` **ausente** no ambiente de produção. Se essa variável subir por engano, o CRM passa a aceitar qualquer credencial do Meta sem validar nada contra o Graph real — ver `usarFalso()` em `src/lib/integracoes/fabrica.ts`.

**O runbook de operador continua válido como saída de emergência** (não some com o fechamento do risco): se uma Page tiver sido squattada antes desta task existir, o dono legítimo agora tem o caminho de reivindicação pela própria tela, sem precisar de intervenção manual no banco. O runbook documentado na spec (seção citada acima) permanece como referência para diagnosticar o caso, mesmo que a ação corretiva principal hoje seja self-service.

**Risco aceito e nomeado — disk-fill não autenticado via `/api/webhooks/google/[token]` (achado 5 do review final).** Diferente do webhook do Meta (que exige `X-Hub-Signature-256` válido antes de qualquer escrita), o webhook do Google não tem prova de origem antes de gravar em `integration_log`: qualquer request com um corpo JSON sintaticamente válido contendo `lead_id` string grava uma linha, com `payload_bruto` controlado pelo chamador. Isso é intencional — a linha é o único rastro do operador para uma entrega de fonte desconhecida — mas a combinação com "sem limite de tamanho" seria uma forma de encher o disco de um banco compartilhado por todo tenant. O mitigado hoje: a rota rejeita com `413` qualquer corpo acima de 256 KiB, antes de fazer parse ou gravar. O que continua em aberto, aceito conscientemente: não há rate limit por IP/token nem pruning de linhas antigas de fonte desconhecida (`account_id is null`) — um chamador pode gravar muitas linhas pequenas repetidamente variando `lead_id` (o índice único não bloqueia isso). Sem dono declarado para endereçar antes do merge; para produção considerar rate limiting na borda (Vercel/WAF) e um job de retenção para linhas antigas sem `account_id`.

## Reprocessamento de leads (cron)

`GET /api/webhooks/reprocessar`, gateada por `Authorization: Bearer ${CRON_SECRET}`, varre entregas `pendente`/`falhou` e reprocessa cada uma com backoff (a RPC `entregas_pendentes` decide o quê e quando). `vercel.json` declara a cadência de 10 minutos, mas **no plano Hobby da Vercel o cron roda no máximo uma vez por dia, independentemente do que estiver escrito nesse arquivo** — os 10 minutos só valem a partir do plano Pro. A rota continua invocável à mão com o `CRON_SECRET`, e é assim que se esvazia a fila num incidente antes de existir um plano pago.

## Reprocessamento manual de entregas (achado 4 do review final)

`ignorado` e `falhou`-com-5-tentativas são **estados terminais**: nada no sistema hoje move uma entrega de volta para `pendente` nem zera `tentativas`. Isso é esperado para a maioria de `ignorado` (`lead_de_teste`, `fonte_nao_encontrada` de tráfego alheio) — mas dois casos reais ficam presos sem saída automática:

- **`chave_invalida`**: o cliente colou a chave errada no Ativo de formulário do Google Ads. Todo lead que chegou nesse período foi gravado como `ignorado`, o `payload_bruto` inteiro está no banco (migration `0010` é explícita: o payload é reprocessável), mas nada o reprocessa sozinho depois que o admin corrige a chave.
- **`meta_indisponivel`** além da quinta tentativa: uma instabilidade do Graph API mais longa que ~2h (a janela de backoff é 3+9+27+81 minutos) esgota as tentativas e a linha fica `falhou` para sempre, mesmo que o Graph volte a responder normalmente minutos depois.

A ação de reprocessar pela tela é backlog — hoje a saída é manual, direto no banco:

```sql
update public.integration_log
   set status = 'pendente',
       tentativas = 0,
       ultima_tentativa_em = null
 where account_id = '<uuid da conta>'         -- sempre escopar por conta antes de rodar
   and erro = 'chave_invalida'                -- ou 'meta_indisponivel', ou o código relevante
   and criado_em >= '<timestamp do incidente>' -- e por janela de tempo, para não reabrir entregas antigas e já investigadas
returning id;
```

Depois do update a próxima varredura do cron (ou uma chamada manual à rota de reprocessamento) pega essas linhas normalmente — `entregas_pendentes` não distingue uma linha reaberta à mão de uma que nunca falhou. **Sempre escope por `account_id`, `erro` e janela de tempo** antes de rodar: a tabela é compartilhada por todos os tenants, e um `update` sem `where` reabriria entregas de outras contas e de incidentes já resolvidos.

## Onboarding beta do Meta (operador)

Antes do App Review do WhatsApp/Facebook passar, todo cliente que precisa testar a conexão com o Meta (Page do Facebook ou número do WhatsApp Cloud API) só consegue se for cadastrado como tester no app do Meta — o OAuth recusa qualquer conta fora dessa lista com um erro cru do próprio Facebook. O runbook abaixo é a saída manual até o App Review sair.

1. **Adicionar o tester.** No [painel do Meta for Developers](https://developers.facebook.com/apps/), abra o app do CRM → **Funções do app** (App roles) → **Testadores** (Testers) → adicione o email ou o usuário do Facebook da pessoa do cliente que vai testar.
2. **O que o cliente precisa aceitar.** A pessoa recebe um convite pendente em `developers.facebook.com` (canto superior direito, sino de notificações, ou diretamente em Configurações → Funções). Ela precisa **aceitar esse convite logada com a própria conta do Facebook** antes de tentar conectar pelo CRM — sem aceitar, o OAuth do Facebook recusa mesmo com o email já cadastrado como tester.
3. **O que conferir na primeira conexão.**
   - Depois do fluxo "Conectar Facebook", a Page do cliente aparece na lista de páginas oferecidas (`/config?meta=escolher`) — se não aparecer, o tester provavelmente não é administrador dessa Page especificamente, não só do app.
   - Depois de escolher a Page, um lead de teste enviado por um formulário Meta real chega em `/funil` — é a prova de ponta a ponta de que a assinatura de leadgen (`assinarLeadgen`) funcionou, não só o OAuth.
   - Para o WhatsApp: depois de colar token, `phone_number_id` e `waba_id` no bloco de Integrações, o card passa a mostrar o número e o nome verificado que o **Meta devolveu** (não o que foi digitado) — se o card não aparecer, o token ou o número provavelmente não pertencem à mesma WABA que o tester administra.
4. **O token do WhatsApp tem que ser permanente, não o de 24h.** A página "Configuração da API" (WhatsApp → Introdução, no painel do app) mostra, de cara, um token **temporário que expira em 24 horas** — serve só para um teste rápido de `curl`, nunca para colar no CRM: a conexão para de funcionar no dia seguinte, sem aviso nenhum na tela até a próxima tentativa de envio. Para o token que vai ficar valendo, gere um **permanente de System User**: no painel da empresa (`business.facebook.com`) → **Configurações do negócio** (Business Settings) → **Usuários** → **Usuários do sistema** (System Users) → crie ou escolha um usuário de sistema → **Gerar novo token** → selecione o app do CRM, marque o ativo do WhatsApp Business e a permissão `whatsapp_business_messaging` → gere sem prazo de expiração. Esse é o token que vai no formulário de conexão.
5. **A nota da tela.** `META_MODO_BETA=1` liga um aviso fixo junto do botão "Conectar Facebook" (`Durante o beta, a conexão com o Facebook é liberada por convite — fale com a gente para habilitar sua conta.`) — é só texto, sem estado nem migration: **desligue a variável (vazio ou ausente) assim que o App Review passar**, e a nota some sozinha no próximo deploy.

O Embedded Signup (autoatendimento real do WhatsApp — popup do Meta que cria a WABA e devolve o token sem o cliente precisar copiar nada à mão) fica como caminho **futuro e não desenhado**: depende do onboarding de Tech Provider do Meta, cujos detalhes mudam até o App Review sair. O MVP é colar credencial mesmo.

## Conectar Page de cliente (modo operador)

A implantação de cliente é manual do dono da plataforma (migration `0030`). O script abaixo conecta uma Page ao tenant do cliente com token de **System User** — sem OAuth pelo navegador.

Pré-condições, nesta ordem:

1. **App do Meta** dentro do BM da Vostok, com Webhooks → Page → `leadgen` apontando para `https://vostok-beta.vercel.app/api/webhooks/meta` e verificado com o `META_VERIFY_TOKEN` da Vercel. Conferir com `GET /{app-id}/subscriptions?access_token={app-id}|{app-secret}`.
2. **System User** no BM da Vostok com a Page do cliente **atribuída** e token permanente com `pages_show_list`, `pages_manage_metadata`, `leads_retrieval`, gerado para esse app.
3. O cliente **aceitou o convite** e é membro do tenant (senão `responsavel_invalido` ao passar `--responsavel`).

Execução:

```bash
vercel env pull prod.env --environment=production --yes
# acrescente ao prod.env: OPERADOR_EMAIL, OPERADOR_SENHA (login do dono), META_TOKEN_SYSTEM_USER
npm run meta:conectar -- --env prod.env --conta <account_id> --page <page_id> [--responsavel <user_id>] [--reivindicar]
```

`META_API_VERSION` é lida na carga do módulo do Graph, antes do arquivo de env: exporte-a no shell se precisar de versão diferente de `v21.0`. Segunda execução para a mesma Page devolve `page_ja_conectada` e para — tomar a Page de outra conta é ato explícito (`--reivindicar`). Apague `prod.env` ao terminar.

Prova ponta a ponta: Lead Ads Testing Tool (`developers.facebook.com/tools/lead-ads-testing`) na Page → lead no `/funil` do cliente com campanha/conjunto/anúncio; reenvio do mesmo lead não duplica.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
