with esperado(nome, anon, auth) as (values
  ('accounts','',              'select,update'),
  ('ingestion_config','',      ''),
  ('integration_log','',       ''),
  ('invites','',               'select,insert,update,delete'),
  ('lead_events','',           'select,insert,update,delete'),
  ('lead_sources','',          'select'),
  ('lead_tags','',             'select,insert,delete'),
  ('leads','',                 'select,insert,update'),
  ('loss_reasons','',          'select,insert,update,delete'),
  ('memberships','',           'select,insert,update,delete'),
  ('notifications','',         'select'),
  ('pipelines','',             'select,insert,update,delete'),
  ('platform_owners','',       ''),
  ('profiles','',              'select,update'),
  ('scripts','',               'select,insert,update,delete'),
  ('source_credentials','',    ''),
  ('stage_history','',         'select,insert,update,delete'),
  ('stages','',                'select,insert,update,delete'),
  ('tags','',                  'select,insert'),
  ('tasks','',                 'select,insert,update,delete'),
  ('whatsapp_connections','',  'select'),
  ('whatsapp_credentials','',  ''),
  ('whatsapp_templates','',    'select,insert,update,delete')),
priv(p, ord) as (values ('select',1),('insert',2),('update',3),('delete',4),('references',5),('trigger',6),('maintain',7)),
real as (
  select c.relname::text as nome, papel,
         coalesce(string_agg(pr.p, ',' order by pr.ord)
           filter (where has_table_privilege(papel, c.oid, pr.p)), '') as privs
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'),('authenticated')) as r(papel)
   cross join priv pr
   where n.nspname = 'public' and c.relkind in ('r','p')
   group by 1,2)
select 'DIVERGENCIA' as tipo, coalesce(e.nome, ra.nome) as tabela, ra.papel,
       coalesce(ra.privs,'(tabela ausente)') as encontrado,
       case ra.papel when 'anon' then e.anon else e.auth end as esperado
  from real ra full join esperado e on e.nome = ra.nome
 where e.nome is null or ra.nome is null
    or ra.privs is distinct from (case ra.papel when 'anon' then e.anon else e.auth end)
union all
select 'SEQUENCIA', c.relname::text, r.papel,
       concat_ws(',', case when has_sequence_privilege(r.papel,c.oid,'usage')  then 'usage'  end,
                      case when has_sequence_privilege(r.papel,c.oid,'select') then 'select' end,
                      case when has_sequence_privilege(r.papel,c.oid,'update') then 'update' end),
       case when c.relname='lead_events_seq_seq' and r.papel='authenticated' then 'usage' else '' end
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 cross join (values ('anon'),('authenticated')) as r(papel)
 where n.nspname='public' and c.relkind='S'
   and concat_ws(',', case when has_sequence_privilege(r.papel,c.oid,'usage')  then 'usage'  end,
                      case when has_sequence_privilege(r.papel,c.oid,'select') then 'select' end,
                      case when has_sequence_privilege(r.papel,c.oid,'update') then 'update' end)
     is distinct from (case when c.relname='lead_events_seq_seq' and r.papel='authenticated' then 'usage' else '' end)
union all
select 'COLUNA', cp.table_name::text, cp.grantee::text, lower(cp.privilege_type)||' '||cp.column_name::text, '(nenhum p/ anon)'
  from information_schema.column_privileges cp
 where cp.table_schema='public' and cp.grantee='anon'
union all
select 'COLUNA payload_bruto', 'integration_log', 'authenticated',
       has_column_privilege('authenticated','public.integration_log','payload_bruto','select')::text, 'false'
 where has_column_privilege('authenticated','public.integration_log','payload_bruto','select')
union all
select 'DEFAULT ACL', 'postgres/public', d.defaclobjtype::text, item, '(sem anon/authenticated/PUBLIC)'
  from pg_default_acl d
  join pg_roles r on r.oid=d.defaclrole join pg_namespace n on n.oid=d.defaclnamespace,
       unnest(d.defaclacl::text[]) as item
 where r.rolname='postgres' and n.nspname='public'
   and (item like 'anon=%' or item like 'authenticated=%' or (d.defaclobjtype='f' and item like '=%'))
order by 1,2,3;
