with esperado(nome) as (values
  ('accounts'),('ingestion_config'),('integration_log'),('invites'),('lead_events'),
  ('lead_sources'),('lead_tags'),('leads'),('loss_reasons'),('memberships'),
  ('notifications'),('pipelines'),('platform_owners'),('profiles'),('scripts'),
  ('source_credentials'),('stage_history'),('stages'),('tags'),('tasks'),
  ('whatsapp_connections'),('whatsapp_credentials'),('whatsapp_templates'),
  ('lead_events_seq_seq')),
obj as (
  select c.oid, c.relkind::text as k, c.relname::text as nome,
         pg_get_userbyid(c.relowner)::text as dono, c.relacl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m','f','S'))
select 'A. BLOQUEIA: objeto em public NAO pertencente a postgres (revoke so avisa e nao remove)' as secao,
       k || ' ' || nome || ' dono=' || dono as detalhe from obj where dono <> 'postgres'
union all
select 'B. BLOQUEIA: objeto em public fora das 23 tabelas + 1 sequencia previstas',
       k || ' ' || nome from obj where nome not in (select nome from esperado)
union all
select 'C. BLOQUEIA: objeto previsto AUSENTE (o grant da 0033 aborta a migration)',
       e.nome from esperado e where not exists (select 1 from obj o where o.nome = e.nome)
union all
select 'D. BLOQUEIA: grant a anon/authenticated com GRANTOR != postgres (o revoke nao o remove)',
       o.nome || ' -> ' || a.acl
  from obj o, unnest(coalesce(o.relacl, '{}'::aclitem[])::text[]) as a(acl)
 where (a.acl like 'anon=%' or a.acl like 'authenticated=%') and a.acl not like '%/postgres'
union all
select 'E. BLOQUEIA: coluna de integration_log fora do grant de select da 0033',
       a.attname::text from pg_attribute a
 where a.attrelid = 'public.integration_log'::regclass and a.attnum > 0 and not a.attisdropped
   and a.attname not in ('id','account_id','source_id','provedor','external_id','status','erro',
        'tentativas','ultima_tentativa_em','lead_id','criado_em','processado_em','payload_bruto')
union all
select 'F. CONFERE: papel da conexao (a 0033 fixa o default ACL DESTE papel)', current_user::text
union all
select 'G. CONFERE: ultima migration aplicada (esperado 0032)',
       max(version)::text from supabase_migrations.schema_migrations
union all
select 'H. INFORMATIVO: default ACL em public de outro papel (fora do alcance da 0033)',
       r.rolname || ' ' || d.defaclobjtype::text || ' ' || d.defaclacl::text
  from pg_default_acl d join pg_roles r on r.oid = d.defaclrole
  join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public' and r.rolname <> 'postgres'
order by 1, 2;
