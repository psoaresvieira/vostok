# Sweep de grants de tabela — spec (2026-08-28)

## Problema

O default ACL do role `postgres` na nuvem Supabase (e na imagem local `postgres:17.6.1.147`, puxada em 2026-08-28) concede a `anon`, `authenticated` e `service_role`, em **toda tabela nova**, `select/insert/update/delete/references/trigger/maintain` (`arwdxtm`), e em toda função nova `EXECUTE`. As migrations 0001–0032 foram escritas contra a imagem local antiga, que não tinha esse default: cada uma declara `grant … to authenticated` com a intenção de que **só aquilo** exista, e `revoke … from public` quando quis fechar. Nenhum dos dois toca o grant explícito que o default ACL já deu.

Resultado em produção (`jmxadynyastrwyngkqdt`, sondado por SQL read-only em 2026-08-28): **19 tabelas** com `anon=arwdxtm` e `authenticated=arwdxtm` — incluindo `leads`, `accounts`, `integration_log` (o `payload_bruto` que a 0009 escondeu por grant de coluna está legível), `notifications` (a 0009 concedeu só `update (lida_em)`), `lead_sources` (a 0008 concedeu update em 4 colunas), `whatsapp_connections` (a 0019 concedeu só `select`). Só `whatsapp_credentials`, `source_credentials`, `ingestion_config` e `platform_owners` estão fechadas, porque suas migrations fizeram `revoke all … from anon, authenticated` explicitamente. Hoje quem segura as 19 é **apenas a RLS**.

Cinco testes de integração afirmam a matriz pretendida e ficam vermelhos na imagem nova (0008 update de `external_id`; 0009 `select *` em `integration_log` e insert em `notifications`; 0019 `whatsapp_*` por sessão; entregas-recentes `payload_bruto`): esperam `permission denied` e recebem `violates row-level security policy` — a RLS segura, o grant não.

A metade "funções" já foi fechada no Plano 17 (0031/0032: `revoke … from public, anon`; sweep 0024 Caso 3 verde). Esta spec fecha a metade "tabelas" e o default para o futuro. Registro da regra: memória `supabase-guardas-silenciosas` nº 9.

## Decisões

1. **Escopo: sweep completo + default fechado** (decisão do Pedro, 2026-08-28). Não só as 5 tabelas dos testes.
2. **`anon` não recebe grant nenhum de tabela nem de sequência.** Todo caminho sem sessão do produto (webhooks Meta/Google, cron de reprocesso, disparo WhatsApp) passa por RPC `security definer` gateada por segredo (`ingerir_lead`, `registrar_entrega`, `registrar_falha`, `entregas_pendentes`, `credencial_whatsapp`, `atualizar_status_template`), que roda como dona das tabelas — a 0021 já provou que revogar tudo de `anon` em tabela não quebra RPC definer.
3. **`service_role` fica como está.** Não é usado pelo produto (0024 comenta: BYPASSRLS, grant não é o que o contém); mexer nele é assunto da plataforma Supabase.
4. **A matriz pretendida é a soma literal dos `grant … to authenticated` das migrations 0001–0032**, sem interpretar. Se um caminho de sessão só funcionava porque o default abriu a tabela, a correção é **declarar o grant** (nova linha na 0033, com comentário), nunca afrouxar o sweep.
5. **Default privileges fechados para tabelas, sequências e funções**, para `anon` e `authenticated` (e `public` nas funções). Toda migration futura precisa do grant explícito — que já é a convenção do repo (0024, 0028, 0031, 0032). Função sem grant é pega pelo sweep 0024 no `db reset`; tabela sem grant, pelo teste desta spec.

## Migration `supabase/migrations/0033_sweep_grants_tabela.sql`

Uma transação (o `db push` já garante). Ordem:

1. Cabeçalho em português: o achado (default ACL da nuvem; `revoke from public` não remove grant explícito de `anon`; a 0029 só cobriu TRUNCATE por default privilege), a decisão 2 e a regra 5.
2. `revoke all on all tables in schema public from anon, authenticated;`
   `revoke all on all sequences in schema public from anon, authenticated;`
3. Re-emissão **byte-fiel** de cada grant declarado (ordem alfabética por tabela, um bloco por tabela, comentando a migration de origem):

   | Tabela | authenticated |
   |---|---|
   | accounts | select, update (0001) |
   | integration_log | select (id, account_id, source_id, provedor, external_id, status, erro, tentativas, ultima_tentativa_em, lead_id, criado_em, processado_em) (0009) — **sem `payload_bruto`** |
   | invites | select, insert, update, delete (0001) |
   | lead_events | select, insert, update, delete (0003) |
   | lead_sources | select, update (nome, responsavel_padrao_id, ativo, atualizado_em) (0008) |
   | lead_tags | select, insert, delete (0003) |
   | leads | select, insert, update (0003) |
   | loss_reasons | select, insert, update, delete (0002) |
   | memberships | select, insert, update, delete (0001) |
   | notifications | select, update (lida_em) (0009) |
   | pipelines | select, insert, update, delete (0002) |
   | profiles | select, update (0001) |
   | scripts | select, insert, update, delete (0020) |
   | stage_history | select, insert, update, delete (0003) |
   | stages | select, insert, update, delete (0002) |
   | tags | select, insert (0003) |
   | tasks | select, insert, update, delete (0015) |
   | whatsapp_connections | select (0019) |
   | whatsapp_templates | select, insert, update, delete (0022) |
   | ingestion_config, platform_owners, source_credentials, whatsapp_credentials | **nada** (0021, 0028, 0019) |

   Sequências: nenhuma concedida (o repo usa `gen_random_uuid()`; o implementador confirma com `select relname from pg_class where relkind = 'S'` e, se existir sequência que um insert por sessão precise, declara `usage` com comentário).
4. Default privileges do role que roda as migrations (`postgres`), no schema `public`:

   ```sql
   alter default privileges in schema public revoke all on tables from anon, authenticated;
   alter default privileges in schema public revoke all on sequences from anon, authenticated;
   alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
   ```

   Limite conhecido (já documentado na 0029): isso edita só o default ACL de `postgres`; o de `supabase_admin` é inalcançável e cobre objetos criados pela plataforma, não por migration.

Não há mudança de app, nem de RLS, nem de RPC.

## Teste `tests/integration/0033_sweep_grants_tabela.test.ts`

Espelho do `0024_sweep_grants_rpc.test.ts`, lendo o catálogo com `comoServico`:

- **Caso 1 — igualdade total da matriz de tabela.** Para cada tabela de `pg_class` (`relkind in ('r','p')`, schema `public`), o conjunto de privilégios de `anon` e de `authenticated` (via `has_table_privilege` para os sete privilégios) tem que ser **exatamente** o do mapa acima. Tabela fora do mapa reprova; privilégio a mais reprova; a menos reprova.
- **Caso 2 — grants de coluna.** Para `integration_log`, `lead_sources` e `notifications`, `information_schema.column_privileges` de `authenticated` é exatamente a lista declarada (e `payload_bruto` não aparece).
- **Caso 3 — `anon` sem nada.** Nenhuma linha em `information_schema.role_table_grants` nem `column_privileges` com `grantee = 'anon'`; nenhuma sequência com privilégio de `anon`/`authenticated`.
- **Caso 4 — default fechado.** `pg_default_acl` do role `postgres` no schema `public` não contém `anon` nem `authenticated` em nenhum `defaclobjtype` (`r`, `S`, `f`), e o de funções não contém `=X/` (PUBLIC).
- Os 5 testes hoje vermelhos voltam a verde **sem edição** — eles são a prova de que a matriz pretendida bateu; editá-los seria mascarar.

## Ensaio local e rollout

Local (a imagem `17.6.1.147` reproduz o default ACL da nuvem, então o ensaio é fiel):

1. `npx supabase db reset` → `npm run test:integration` **352/352** (hoje 347/352).
2. `npm run db:reset` → `npm run test:e2e` completo (24/24).
3. Smoke manual no `next dev` com `.env` local: webhook Meta de teste (`ingerir_lead` como anon+segredo), reprocesso (`entregas_pendentes`), disparo WhatsApp (`credencial_whatsapp`), e por sessão: `/admin` (invites), `/config` fontes (`lead_sources` update), sino (`notifications` update de `lida_em`), funil, tarefas, scripts.

Produção:

4. `npx supabase db push` (só a 0033). Um `GRANT/REVOKE` dispara o reload de schema do PostgREST — janela de segundos; aplicar em horário de baixo tráfego.
5. Sonda read-only via MCP: `relacl` das 23 tabelas, `column_privileges` das 3 tabelas de coluna, `pg_default_acl` — comparar com a matriz.
6. Smoke no ar: login, funil, abrir lead, sino, `/admin`, `/config`.
7. Rollback (só se a sonda ou o smoke falhar): `supabase/rollback/0033_rollback.sql`, **fora** da pasta de migrations, que re-concede a `anon, authenticated` `select, insert, update, delete, references, trigger, maintain` nas 19 tabelas e restaura os três default privileges. Aplicado à mão pelo SQL editor; nunca por `db push`.

Sem deploy Vercel; nenhum commit de app precisa acompanhar.

## Fora do escopo

- Revisar se cada grant declarado é o **mínimo** (ex.: `lead_events` com `update, delete` para `authenticated`; `invites` com `delete`). A matriz é copiada, não julgada — julgá-la é outra spec, com a RLS de cada tabela na mesa.
- `service_role` e o default ACL de `supabase_admin`.
- Grants de função (já fechados na 0031/0032; o sweep 0024 continua sendo o guarda).

## Critério de pronto

- 0033 aplicada localmente e em produção; `npx supabase migration list` 33/33.
- `npm run test:integration` 352/352 + o novo teste (4 casos); E2E 24/24.
- Sonda de produção igual à matriz; smoke no ar sem regressão.
- Memória `crm-projeto` e `supabase-guardas-silenciosas` atualizadas (a nº 9 ganha "fechado pela 0033; default privileges cobertos").
