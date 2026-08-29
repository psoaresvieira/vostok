-- supabase/rollback/0033_rollback.sql
-- Desfaz a 0033 restaurando o default ACL que a nuvem tinha dado. So' para
-- rodar A MAO no SQL editor se a sonda ou o smoke pos-push falhar; nunca por
-- `db push` (esta fora de supabase/migrations de proposito). Depois de rodar,
-- `npx supabase migration repair --status reverted 0033`.
grant select, insert, update, delete, references, trigger, maintain
  on all tables in schema public to anon, authenticated;
grant usage, select, update on all sequences in schema public to anon, authenticated;
-- As tabelas que ja eram fechadas ANTES da 0033 voltam a ser fechadas:
revoke all on public.ingestion_config, public.source_credentials,
              public.whatsapp_credentials, public.platform_owners from anon, authenticated;
revoke truncate on all tables in schema public from anon, authenticated; -- 0029
alter default privileges in schema public grant select, insert, update, delete, references, trigger, maintain on tables to anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated; -- 0029
alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to public, anon, authenticated;
