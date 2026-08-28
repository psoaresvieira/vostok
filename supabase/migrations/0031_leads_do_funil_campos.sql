-- Cartao compacto do funil (spec 2026-08-28-crm-funil-kommo): o cartao passa
-- a mostrar telefone e data de criacao do lead, e nenhum dos dois vinha da
-- RPC leads_do_funil (0027) — so' id, nome, stage_id, responsavel_id,
-- valor_cents, entrou_na_etapa_em, etiquetas, total_na_etapa e
-- soma_cents_na_etapa.
--
-- Postgres recusa `create or replace function` quando o `returns table`
-- muda, entao a funcao precisa ser derrubada antes. Isso tambem derruba os
-- grants (guarda 7, 0024_sweep_grants_rpc.sql) — por isso o revoke/grant no
-- fim, identico ao que a 0027 ja fazia.
--
-- O corpo abaixo e' o mesmo da 0027, byte a byte, com tres acrescimos:
-- `l.criado_em` no CTE `filtrados` (que ja existia so' para ordenar/paginar,
-- nunca saia no select), e `telefone_e164`/`criado_em` no `returns table` e
-- no select final.
drop function public.leads_do_funil(
  uuid, integer, integer, uuid, uuid, public.lead_origem, timestamptz, text
);

create function public.leads_do_funil(
  p_pipeline_id uuid,
  p_limite integer default 50,
  p_offset integer default 0,
  p_stage_id uuid default null,
  p_responsavel_id uuid default null,
  p_origem public.lead_origem default null,
  p_desde timestamptz default null,
  p_busca text default null
)
returns table (
  id uuid,
  nome text,
  stage_id uuid,
  responsavel_id uuid,
  valor_cents integer,
  entrou_na_etapa_em timestamptz,
  telefone_e164 text,
  criado_em timestamptz,
  etiquetas jsonb,
  total_na_etapa bigint,
  soma_cents_na_etapa bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with alvo as (
    select case
      when p_busca is null or btrim(p_busca) = '' then null
      else '%' || replace(replace(replace(p_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as padrao
  ),
  filtrados as (
    select
      l.id,
      l.nome,
      l.stage_id,
      l.responsavel_id,
      l.valor_cents,
      l.entrou_na_etapa_em,
      l.telefone_e164,
      l.criado_em
    from public.leads l, alvo a
    where l.pipeline_id = p_pipeline_id
      and (p_stage_id is null or l.stage_id = p_stage_id)
      and (p_responsavel_id is null or l.responsavel_id = p_responsavel_id)
      and (p_origem is null or l.origem = p_origem)
      and (p_desde is null or l.criado_em >= p_desde)
      and (
        a.padrao is null
        or l.nome ilike a.padrao
        or l.telefone_e164 ilike a.padrao
        or l.email_norm ilike a.padrao
      )
  ),
  numerados as (
    select
      f.*,
      -- id como desempate: sem ele dois leads criados no mesmo instante
      -- (importacao em lote) trocam de posicao entre a primeira pagina e o
      -- "carregar mais", e o mesmo cartao aparece duas vezes ou nenhuma.
      row_number() over (
        partition by f.stage_id order by f.criado_em desc, f.id desc
      ) as posicao,
      count(*) over (partition by f.stage_id) as total,
      sum(f.valor_cents) over (partition by f.stage_id) as soma
    from filtrados f
  )
  select
    n.id,
    n.nome,
    n.stage_id,
    n.responsavel_id,
    n.valor_cents,
    n.entrou_na_etapa_em,
    n.telefone_e164,
    n.criado_em,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome) order by t.nome)
        from public.lead_tags lt
        join public.tags t on t.id = lt.tag_id
        where lt.lead_id = n.id
      ),
      '[]'::jsonb
    ) as etiquetas,
    n.total,
    n.soma
  from numerados n
  where n.posicao > p_offset
    and n.posicao <= p_offset + p_limite
  order by n.stage_id, n.posicao;
$$;

-- Guarda 7 (ver 0024_sweep_grants_rpc.sql): o default ACL da EXECUTE a PUBLIC
-- em funcao nova, e o drop acima levou junto o grant explicito que a 0027
-- tinha feito. A assinatura (tipos dos parametros) nao mudou — so' o
-- returns table — entao a entrada do mapa em 0024_sweep_grants_rpc.test.ts
-- continua valendo sem edicao.
--
-- `from public, anon`, nao so' `from public`: o ACL padrao do papel postgres
-- nesta imagem/nuvem ja concede EXECUTE explicitamente a anon, authenticated
-- e service_role em toda funcao nova — `revoke ... from public` so remove a
-- entrada `=X/`, e `anon=X/postgres` sobrevive. Sem o `anon` aqui, o Caso 3
-- de 0024_sweep_grants_rpc.test.ts (has_function_privilege('anon', …)) acha
-- anon com EXECUTE onde o mapa espera false.
revoke execute on function public.leads_do_funil(
  uuid, integer, integer, uuid, uuid, public.lead_origem, timestamptz, text
) from public, anon;
grant execute on function public.leads_do_funil(
  uuid, integer, integer, uuid, uuid, public.lead_origem, timestamptz, text
) to authenticated;
