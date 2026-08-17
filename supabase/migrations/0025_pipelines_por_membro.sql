-- Plano 14: qualquer membro cria, renomeia e exclui pipelines (decisao de
-- produto, 2026-08-16). As regras de exclusao moram AQUI, nao so no store:
-- com a escrita aberta a membros, PostgREST direto alcanca o delete, e
-- leads.pipeline_id NAO cascateia (a FK em 0003_leads.sql nao tem on delete,
-- entao o default e' NO ACTION) — sem a policy, apagar uma pipeline com leads
-- estouraria 23503 (violacao de FK) crua atraves do PostgREST em vez de uma
-- recusa limpa. A policy e' o lugar certo pra essa recusa.

-- Guarda 5 (memoria supabase-guardas-silenciosas): subquery de leads dentro
-- da policy rodaria sob a RLS do CHAMADOR, e a RLS de leads esconde leads de
-- colegas do vendedor — ele conseguiria excluir pipeline com leads dos
-- outros. O helper e' definer para enxergar todos os leads da pipeline.
create or replace function public.pipeline_tem_leads(p_pipeline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.leads l where l.pipeline_id = p_pipeline_id);
$$;

-- Guarda 7: default ACL da EXECUTE a PUBLIC em funcao nova. Revoke + grant
-- explicito, e o mapa em 0024_sweep_grants_rpc.test.ts ganha a entrada.
revoke execute on function public.pipeline_tem_leads(uuid) from public;
grant execute on function public.pipeline_tem_leads(uuid) to authenticated;

drop policy pipelines_admin_write on public.pipelines;

create policy pipelines_membro_insert on public.pipelines
  for insert with check (public.is_member_of(account_id));

create policy pipelines_membro_update on public.pipelines
  for update using (public.is_member_of(account_id))
  with check (public.is_member_of(account_id));

create policy pipelines_membro_delete on public.pipelines
  for delete using (
    public.is_member_of(account_id)
    and not is_default
    and not public.pipeline_tem_leads(id)
  );

drop policy stages_admin_write on public.stages;

create policy stages_membro_write on public.stages
  for all using (public.is_member_of(public.conta_do_pipeline(pipeline_id)))
  with check (public.is_member_of(public.conta_do_pipeline(pipeline_id)));
