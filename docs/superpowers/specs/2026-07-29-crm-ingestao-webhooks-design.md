# Spec — CRM: Ingestão automática de leads (sub-projeto 2)

Data: 2026-07-29
Origem: `Obsidian Vault/CRM/v.0.md` §§2.6, 3, 4 e 6; sub-projeto 1 entregue em `master` (`2dd186f`)
Status: aprovado no brainstorming, pronto para `writing-plans`

---

## 1. Contexto e recorte

O sub-projeto 1 entregou um CRM multi-tenant utilizável **manualmente**: contas, papéis, pipeline, Kanban com drag-and-drop, etiquetas com snapshot de etapa, motivo de perda obrigatório e timeline. O lead entra digitado.

Este sub-projeto entrega a promessa que dá nome ao produto: **o lead do anúncio cai no funil sozinho, sem Zapier e sem planilha**, e alguém é avisado no mesmo instante.

**Escopo:** conexão de fontes de lead (Meta via OAuth, Google via URL secreta), recebimento e processamento dos webhooks, deduplicação contra lead aberto, trilha de auditoria reprocessável, e notificação in-app em tempo real.

**Fora de escopo neste sub-projeto:** push do navegador e email (só in-app via Realtime); detecção automática de "lead respondeu" via WhatsApp Cloud API; automações por gatilho; CPL/CPA via Google Ads API; multi-pipeline; fila gerenciada (pgmq/QStash). Todos são fase 2 na própria `v.0.md`.

### Decomposição em dois planos

Com o OAuth dentro do escopo, são três frentes independentes. Um plano só seria irrevisável — o sub-projeto 1 já precisou de dois. Mesma quebra:

**Plano 3 — Fontes conectadas.** Migration `0006`, fluxo de Facebook Login, tela de Integrações, e os quatro itens do backlog do §9.
*Pronto quando:* um admin conecta a Page do Meta, vê a inscrição em `leadgen` confirmada, escolhe o responsável padrão e copia a URL secreta do Google — tudo isso sem que nenhum lead precise existir.

**Plano 4 — Ingestão e notificações.** As duas rotas de webhook, a RPC `ingerir_lead`, os mapeadores, o dedup, o reprocessamento e o sino em tempo real.
*Pronto quando:* um lead de teste disparado do painel do Meta e outro do Google aparecem no funil sozinhos, atribuídos ao responsável configurado, com o sino acendendo na tela do vendedor.

## 2. Decisões tomadas no brainstorming

| Decisão | Escolha | Razão |
|---|---|---|
| Conexão da fonte | OAuth (Facebook Login) no Meta; URL secreta por conta no Google | Autoatendimento é requisito de SaaS; o Google não tem OAuth para isso, e a URL secreta já resolve |
| Escrita sem sessão | RPC `security definer` gateada por segredo de ingestão | Mantém a regra de zero chave privilegiada; segue o precedente de `move_lead_stage` e `accept_invite` |
| Duplicata de pessoa | Não cria card; anexa evento ao lead aberto e notifica | Evita a explosão de cards repetidos do Kommo; a reincidência é sinal de compra, não ruído |
| Atribuição | Responsável padrão por fonte conectada | Determinístico e testável sem estado compartilhado; rodízio exige trava sob rajada e é fase 2 |
| Notificação | In-app via Realtime, com painel de lida/não lida | RLS faz o roteamento sem código; push e email são frentes próprias |
| Arquitetura | Log primeiro, processa depois (`after()` + cron) | Separa *receber* de *interpretar*: payload cru gravado é reprocessável quando o mapeamento falha |
| Backlog | Só os quatro itens que o webhook toca (#3, #4, #9, #10) | Consertar onde já estamos mexendo, sem virar faxina |

### O que o ambiente impõe

**Webhook exige URL pública HTTPS.** O desenvolvimento roda em stack Supabase local, sem endereço público: a verificação do Meta e o "Enviar dados de teste" do Google não alcançam a máquina. Isso é decisão de arquitetura de testes, não detalhe de execução — Meta e Google entram como **ports com implementação falsa**, e todo teste automatizado roda sem rede. A validação contra o provedor real é verificação manual documentada, em deploy de preview ou túnel.

**OAuth só é autoatendimento depois de App Review.** Com o app e a Business Verification já existentes, o fluxo funciona hoje para Pages que o desenvolvedor administra. Cliente externo exige `leads_retrieval` em acesso avançado — processo do Meta, não código. O design entrega o fluxo pronto; a liberação corre em paralelo.

**Armadilha herdada (continua valendo):** nesta versão do `supabase/postgres` (17.6) o default ACL do schema `public` concede a `anon`/`authenticated` apenas `Dxtm`. Toda tabela nova precisa de `grant` explícito para `authenticated`, ou o erro é `permission denied` e a RLS nem chega a ser avaliada.

## 3. Modelo de dados

Repartido por consumidor, uma migration por propósito, para que nenhum plano crie tabela que ele mesmo não usa: `0006` (`lead_events.seq`) e `0007` (predicado de `responsavel_id`) são os itens de backlog; `0008` traz `lead_sources`, `source_credentials` e `ingestion_config`, tudo consumido pelo Plano 3; `integration_log` e `notifications` ficam para a `0009`, no Plano 4, junto do código que os lê.

```
lead_sources        id, account_id, provedor (meta|google), external_id?,
                    nome, responsavel_padrao_id?, ativo, criado_em, atualizado_em
                    UNIQUE (provedor, external_id)   -- global, ver abaixo

source_credentials  source_id (PK), meta_page_token?, token_expira_em?,
                    google_key_hash?, url_token_hash?, atualizado_em
                    -- SEM grant nenhum para authenticated

integration_log     id, account_id?, source_id?, provedor, external_id,
                    payload_bruto jsonb, status (pendente|processado|ignorado|falhou),
                    erro?, tentativas, lead_id?, criado_em, processado_em
                    UNIQUE (provedor, external_id)

notifications       id, account_id, usuario_id, lead_id,
                    tipo (novo_lead|lead_reincidente), lida_em?, criado_em

ingestion_config    id bool PK default true CHECK (id), segredo_hash?, atualizado_em
                    -- linha única; SEM grant para authenticated

lead_events         + seq bigint generated always as identity
```

Leads ingeridos entram sempre na **primeira etapa do pipeline padrão**. Etapa de destino configurável é YAGNI enquanto só existe um pipeline.

### Por que `unique (provedor, external_id)` é global e não por conta

O webhook do Meta é do **app**, não da conta, e traz só o `page_id`. Se duas contas do CRM reivindicassem a mesma Page, o lead seria ambíguo e não haveria critério para desempatar. Melhor falhar na conexão, com mensagem explícita ("esta Page já está conectada a outra conta"), do que entregar lead para a conta errada.

`external_id` é **anulável de propósito**: no Google não existe identificador estável da fonte no payload — quem resolve a conta é o token da URL. Índice único do Postgres não compara `NULL` com `NULL`, então várias fontes Google convivem na mesma conta sem colidir, enquanto o Meta continua travado a uma Page por conta. Marcar a coluna como `not null` quebraria o Google.

#### Risco nomeado: squat de Page ID em `conectar_fonte_meta`

A justificativa acima parte de "duas contas reivindicam a mesma Page" como disputa entre dois donos legítimos, mas o índice não distingue esse caso do outro: **o segundo a chegar pode ser o dono legítimo, e o primeiro um invasor**. `conectar_fonte_meta` prova só que o chamador é admin da conta que ele mesmo passou — não prova que ele controla `p_page_id`, e `p_token` é texto arbitrário não validado. Como nenhuma migration revoga `execute` de `public` nas funções, a RPC é alcançável direto pelo PostgREST, então qualquer pessoa que faça signup, crie a própria conta e chame `conectar_fonte_meta(minha_conta, '<page id de um concorrente>', 'x', 'x', null)` — Page IDs são públicos — trava a Page para si. A vítima passa a receber `page_ja_conectada` para sempre e não tem recurso: não enxerga nem apaga a linha do invasor. **O risco residual não é só negação de serviço:** quando o `registrar_entrega` do Plano 4 resolver a entrega por `(provedor, external_id)` e devolver o token da Page a quem a possui, qualquer caminho que assine aquela Page — assinatura pré-existente, re-autorização, ou o próprio fluxo de reivindicação — passa a entregar os leads da vítima na conta do invasor, o mesmo "entregar lead para a conta errada" que a seção acima justifica o índice global para prevenir, só que agora por controle de roteamento em vez de ambiguidade.

**Decisão consciente do Plano 3: não consertar aqui.** Consertar direito exige validar o token contra o Graph API — o port que a Task 6 constrói —, e a decisão foi aceitar o risco em troca de escopo, com o produto ainda fora de produção. **Dono: Plano 4**, que passa a ter um caminho de reivindicação — um chamador que apresente token de página válido toma a linha de quem estava lá antes. Esse caminho é portanto controle de roteamento e confidencialidade dos leads, não conveniência de suporte para destravar uma Page presa.

### Por que as credenciais moram em tabela separada

`source_credentials` não recebe `grant`, nem de `select`. Só funções `security definer` a leem. Consequência: uma sessão de admin comprometida não extrai o token da Page nem o segredo do Google. Se esses campos fossem colunas de `lead_sources`, qualquer `select *` da tela os traria para o payload RSC — exatamente a armadilha que a `AdminStore` já documenta para o token de convite.

### Por que `lead_events.seq` entra agora

É o item #10 do backlog, e ele deixa de ser latente exatamente aqui: a ingestão grava lead e evento na mesma transação, então dois eventos com `criado_em` idêntico passam a ser rotina em vez de impossibilidade.

A divergência é de um lado só. O `InMemoryCrmStore` **já** desempata pelo índice de inserção, com o comentário explicando por quê; quem não tem critério é o `SupabaseCrmStore`, que ordena apenas por `criado_em desc` e devolve ordem arbitrária no empate. `seq` dá ao Postgres o mesmo desempate que o fake já tem, e a ordenação passa a `(criado_em desc, seq desc)`. Sem isso a timeline do lead ingerido embaralha de forma não determinística — e, pior, os testes contra o fake continuariam passando enquanto a produção erra.

## 4. Modelo de privilégio

Hoje o projeto tem **zero uso de chave privilegiada** — até a tela de admin usa o cliente da sessão do usuário (`admin.ts`). O webhook é o primeiro caminho de escrita sem `auth.uid()` na história do projeto.

A escrita acontece por funções `security definer` chamadas com o cliente anônimo, autorizadas por um **segredo de ingestão**: `INGESTAO_SEGREDO`, variável de ambiente do servidor, cujo hash vive na linha única de `ingestion_config`. Enquanto `segredo_hash` for nulo, toda função de ingestão recusa — o estado "servidor não registrado" é explícito, não um buraco aberto.

**Esse segredo é configuração de operador, não dado de tenant, e a aplicação não o escreve.** Em desenvolvimento o `seed.sql` grava um valor conhecido, para que `supabase db reset` deixe o ambiente pronto; em produção quem opera o deploy o define por SQL no painel do Supabase.

A primeira versão desta spec previa uma RPC `definir_segredo_ingestao` gateada em `papel_na_conta() = 'admin'`, chamada pela tela de Integrações. **Isso era falha de isolamento entre contas** e foi removido: `ingestion_config` é de linha única e global, qualquer pessoa cria a própria conta por signup e nasce admin dela, então qualquer cliente poderia sobrescrever o segredo de todos os tenants e derrubar a ingestão alheia. O parâmetro `p_account_id` dava aparência de escopo a uma operação sem escopo nenhum. O erro de raciocínio foi tratar como dado de conta algo que existe para o **servidor** se identificar, antes de qualquer conta ser resolvida.

O ganho sobre usar `service_role` é concreto e vale a ceremônia: vazamento do segredo de ingestão permite injetar leads e ler tokens de página; vazamento da `service_role` permite ler e escrever **todas as tabelas de todas as contas**, inclusive `auth`. A superfície da RPC é pequena e auditável.

Superfície completa das funções novas:

| Função | Chamador | Autorização |
|---|---|---|
| `registrar_entrega(segredo, provedor, external_id, payload)` | rota de webhook (anon) | segredo de ingestão |
| `ingerir_lead(segredo, log_id, dados)` | processamento (anon) | segredo de ingestão |
| `entregas_pendentes(segredo, limite)` | cron (anon) | segredo de ingestão |
| `conectar_fonte_meta(...)` / `conectar_fonte_google(...)` | tela de Integrações | sessão + `papel_na_conta() = 'admin'` |
| `desconectar_fonte(source_id)` | tela de Integrações | sessão + `papel_na_conta() = 'admin'` |

`ingestion_config.segredo_hash` não aparece nesta tabela de propósito: nenhuma função exposta à aplicação o escreve. Ver a nota acima.

`registrar_entrega` devolve o token da Page junto do `log_id` quando o provedor é `meta` — não é oráculo de token, porque quem tem o segredo já tem poder de ingestão total.

## 5. Fluxo de ingestão

### Meta

1. `GET /api/webhooks/meta` responde `hub.challenge` quando `hub.verify_token` bate com o env.
2. `POST` lê o **corpo cru** (`await req.text()`) e verifica `X-Hub-Signature-256` = HMAC-SHA256 do corpo com o App Secret, comparação timing-safe. Ler o JSON e reserializar quebra a assinatura — é a falha clássica desta integração.
3. Para cada `entry[].changes[].value`, chama `registrar_entrega('meta', leadgen_id, value)`. Responde **200 imediatamente**, antes de qualquer chamada externa.
4. `after()` processa: `GET /{leadgen_id}?access_token=...` no Graph API → `field_data` → `mapearLeadDoMeta` → `ingerir_lead`.
5. `campanha_origem` sai de uma segunda chamada, `GET /{ad_id}?fields=campaign{name}`, **best-effort**: se falhar, grava o `ad_id` e segue. O sub-projeto 3 precisa do nome, mas nenhum lead se perde por causa dele.

### Google

1. `POST /api/webhooks/google/[token]` resolve a conta pelo token da URL (hash) e confere o `google_key` do corpo.
2. O payload já traz `user_column_data` — sem chamada externa. Mesmo assim passa por `registrar_entrega` + `ingerir_lead`, para que a máquina de reprocessamento cubra os dois provedores por igual.
3. `is_test: true` (o botão "Enviar dados de teste") grava o log como `ignorado` e **não cria card**. Sem isso, todo teste de configuração sujaria o funil do cliente.

### `ingerir_lead` — uma transação

1. Valida o segredo; lê o log; se o status não for `pendente`, devolve `ja_processado` (idempotência).
2. Resolve fonte, conta, responsável padrão, pipeline padrão e primeira etapa.
3. Procura lead com mesmo `telefone_e164` **ou** `email_norm` na conta **e `status = 'aberto'`**.
4. **Achou:** grava `lead_events` tipo `reingestao` com campanha e formulário no payload, cria `notifications` tipo `lead_reincidente` para o responsável do lead existente, marca o log `processado` apontando para ele. Nenhum card novo.
5. **Não achou:** cria o lead (`origem` = provedor, `campanha_origem`, `formulario_origem`, `responsavel_id` = padrão da fonte), grava `stage_history`, grava `lead_events` tipo `criado_por_webhook`, cria `notifications` tipo `novo_lead`, marca o log `processado`.

Lead perdido ou ganho **não** conta como duplicata: recompra é lead novo, e é por isso que o dedup nunca virou constraint única (decisão herdada do sub-projeto 1).

### Reprocessamento

Cron da Vercel chama `/api/webhooks/reprocessar`, gateado por `CRON_SECRET`, que pega os logs `pendente` e `falhou` com `tentativas < 5`, mais antigos primeiro, e reprocessa em lote com backoff por número de tentativas.

## 6. Conexão de fontes

**Meta.** `/api/integracoes/meta/iniciar` redireciona para o diálogo do Facebook com `state` anti-CSRF em cookie assinado e escopos `pages_show_list`, `pages_manage_metadata` e `leads_retrieval`. O retorno valida o `state`, troca `code` → token curto → token longo, lista as Pages em `GET /me/accounts`, e o admin escolhe uma. O CRM então assina o campo `leadgen` (`POST /{page_id}/subscribed_apps`) e grava fonte e credenciais por `conectar_fonte_meta`. Desconectar faz `DELETE /{page_id}/subscribed_apps` e apaga as credenciais.

**Google.** `conectar_fonte_google` cria a fonte e devolve a URL secreta **uma única vez**, no momento da geração — mesmo padrão do `convidar`, pelo mesmo motivo: token que volta em listagem acaba no payload RSC.

**Tela.** `/config` ganha uma quarta seção: fontes conectadas com status, responsável padrão editável, e as últimas entregas do `integration_log`. Essa última parte é o que transforma "não está chegando lead" de mistério em diagnóstico, e é a razão de o log ser visível na UI e não só no banco.

## 7. Notificações

O sino no layout `(app)` faz a consulta inicial no servidor e assina `postgres_changes` em `notifications` por canal privado, com a RLS fazendo o roteamento — cada usuário recebe só o que é dele, sem filtro no cliente. O painel lista as últimas, marca como lida e linka para a ficha do lead.

Quando chega notificação, o quadro se atualiza por `router.refresh()`, **não** inserindo o card no cliente. É a lição do `useState(props)` da Task 1 do Plano 2: componente cliente que copia props do servidor para estado nunca mais reconcilia, e insistir nisso custaria o mesmo bug outra vez.

## 8. Erros

- Assinatura inválida ou ausente → `401`, nada gravado.
- Page desconhecida → **200** com log `ignorado`. Um 404 aqui seria um oráculo de quais Pages estão conectadas ao produto.
- `external_id` repetido → 200, sem efeito. É reenvio do provedor, não erro.
- Falha do Graph API → log `falhou`, `tentativas++`, cron retenta com backoff, desiste em 5.
- Campo de formulário não mapeado → o lead entra com o que deu. O payload cru fica no log, reprocessável depois de corrigir o mapeamento. **Nunca descarta.**
- Erros da tela de Integrações passam pelo `chamarAcao` e pelo mapa `MENSAGENS` que já existem.

## 9. Backlog aberto absorvido

Quatro itens do review final do Plano 2, escolhidos por caírem no código que este sub-projeto reescreve:

- **#10** — desempate de ordenação de `lead_events` sob `criado_em` idêntico. Resolvido pela coluna `seq` do §3.
- **#9** — `possiveisDuplicados` e `listarLeads` interpolam texto do usuário em filtro PostgREST. A função de dedup passa a receber dado de terceiro; sai a interpolação, entram consultas tipadas com escape.
- **#4** — as policies de `leads` não restringem `responsavel_id`. A RPC vai gravar responsável vindo de configuração, então entra predicado de membro no `with check`, além da validação na aplicação.
- **#3** — `.limit(1)` sem `order by` na resolução da conta ativa. A tela de Integrações resolve conta de novo; a resolução vira uma função só, determinística, compartilhada por `criarStoreDoServidor` e `criarAdminStoreDoServidor`.

Os outros 11 itens continuam no ledger, sem alteração de prioridade.

## 10. Testes

**Unitários (sem rede, sem banco):** `mapearLeadDoMeta` e `mapearLeadDoGoogle` — campos ausentes, telefone com e sem DDI, email em maiúsculas, campos customizados do formulário, `is_test`; verificação de HMAC com assinatura válida, inválida, ausente e malformada.

**Integração (Postgres real):** `ingerir_lead` cria o lead com responsável padrão; dedup contra lead aberto anexa evento e não cria card; **não** deduplica contra lead perdido; `external_id` repetido é no-op; `notifications` isola vendedores entre si sob RLS; `source_credentials` é inacessível para `authenticated`; ordenação de eventos estável com `seq`; conectar Page já conectada a outra conta falha pela constraint global.

**E2E (Playwright):** admin gera a URL do Google na tela de Integrações; um POST no endpoint faz o card aparecer no funil do vendedor e o sino acender. O OAuth do Meta é exercitado pela implementação falsa do port.

**Manual, documentado:** verificação do webhook no painel do Meta e "Enviar dados de teste" do Google, contra deploy de preview ou túnel.

## 11. Pronto quando

Um admin conecta a Page do Meta pelo botão, escolhe o vendedor responsável, e cola no Google Ads a URL que o CRM gerou. Um lead preenchido no anúncio aparece no funil daquele vendedor em segundos, com origem e campanha preenchidas, o sino acende na tela dele, e a mesma pessoa preenchendo de novo não vira card duplicado — vira um aviso na timeline do card que já existe.
