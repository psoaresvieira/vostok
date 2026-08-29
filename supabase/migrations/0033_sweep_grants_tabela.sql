-- supabase/migrations/0033_sweep_grants_tabela.sql
-- Sweep de grants de TABELA e sequencia (spec 2026-08-28-crm-sweep-grants-tabela).
--
-- O default ACL do role postgres na nuvem Supabase (e na imagem local
-- 17.6.1.147 em diante) concede a anon/authenticated arwdxtm em toda tabela
-- nova e rwU em toda sequencia nova. As migrations 0001-0032 escreveram
-- `grant ... to authenticated` como se fosse o UNICO grant, e `revoke ...
-- from public` como se fechasse a tabela — nenhum dos dois remove o grant
-- explicito que o default ja tinha dado. Em producao, 19 tabelas estavam
-- abertas a anon/authenticated e so a RLS as segurava; cinco testes de
-- integracao (0008, 0009, 0019, entregas-recentes) esperam `permission
-- denied` e recebiam `violates row-level security`.
--
-- A 0029 cobriu so TRUNCATE (por default privilege); a 0031/0032 fecharam
-- as FUNCOES. Esta fecha tabelas e sequencias, e o default para o futuro.
--
-- Regras: (1) anon nao recebe grant nenhum — todo caminho sem sessao passa
-- por RPC security definer gateada por segredo, que roda como dona das
-- tabelas (a 0021 provou que revogar tudo de anon nao quebra definer);
-- (2) a matriz de authenticated abaixo e' COPIA literal dos grants das
-- migrations de origem, nao um julgamento — reduzir grant e' outra spec;
-- (3) service_role nao e' tocado.

-- 1. Zera tudo que o default deu.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 2. Re-emite a matriz declarada, byte-fiel, uma tabela por bloco.
-- 0001
grant select, update on public.accounts to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invites to authenticated;
-- 0002
grant select, insert, update, delete on public.pipelines to authenticated;
grant select, insert, update, delete on public.stages to authenticated;
grant select, insert, update, delete on public.loss_reasons to authenticated;
-- 0003
grant select, insert, update on public.leads to authenticated;
grant select, insert on public.tags to authenticated;
grant select, insert, delete on public.lead_tags to authenticated;
grant select, insert, update, delete on public.stage_history to authenticated;
grant select, insert, update, delete on public.lead_events to authenticated;
-- lead_events.seq e' serial: o nextval do default roda como o papel que
-- insere. Sem usage, toda nota/etiqueta por sessao e as RPCs invoker de
-- movimento (move_lead_stage, mover_lead_pipeline) morrem com 42501.
grant usage on sequence public.lead_events_seq_seq to authenticated;
-- 0008 (update so nas colunas editaveis pela UI; external_id fica fora)
grant select, update (nome, responsavel_padrao_id, ativo, atualizado_em) on public.lead_sources to authenticated;
-- 0009 (select por coluna: payload_bruto fica fora; update so de lida_em)
grant select (id, account_id, source_id, provedor, external_id, status, erro,
              tentativas, ultima_tentativa_em, lead_id, criado_em, processado_em)
  on public.integration_log to authenticated;
grant select, update (lida_em) on public.notifications to authenticated;
-- 0015
grant select, insert, update, delete on public.tasks to authenticated;
-- 0019
grant select on public.whatsapp_connections to authenticated;
-- 0020
grant select, insert, update, delete on public.scripts to authenticated;
-- 0022
grant select, insert, update, delete on public.whatsapp_templates to authenticated;
-- Fechadas de proposito, sem grant: ingestion_config e source_credentials
-- (0021), whatsapp_credentials (0019), platform_owners (0028).

-- 3. Default fechado: tabela, sequencia e funcao futuras nascem sem nada
-- para anon/authenticated (e funcao sem EXECUTE para PUBLIC). O grant
-- explicito por migration — ja a convencao do repo — vira obrigatorio; o
-- sweep 0024 pega funcao sem grant e o teste 0033 pega tabela sem grant.
-- Limite (ver 0029): edita so o default ACL de postgres; o de supabase_admin
-- cobre objetos criados pela plataforma, nao por migration.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
