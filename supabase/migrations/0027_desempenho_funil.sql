-- Desempenho do funil e da ficha do lead.
--
-- Tres frentes, todas sobre consultas que ja existiam e nenhuma sobre regra de
-- negocio:
--
--   1. leads_do_funil(): o quadro passa a pedir uma PAGINA por etapa, com o
--      total e a soma da coluna calculados no banco, em vez de baixar a
--      pipeline inteira e recortar em JS.
--   2. Indices para os predicados que o app realmente usa.
--   3. pode_ver_lead() com UMA busca em memberships em vez de duas, e
--      auth.uid() em subselect para virar InitPlan.
--
-- Nenhuma policy muda de semantica aqui: o que o vendedor ve continua sendo
-- exatamente o lead dele, e o que gestor/admin veem continua sendo a conta.

-- ---------------------------------------------------------------------------
-- 1. Indices
-- ---------------------------------------------------------------------------

-- O funil filtra por pipeline_id e ordena por (criado_em desc, id desc) dentro
-- de cada stage_id — exatamente a particao da window function de
-- leads_do_funil. O indice que existia, (account_id, stage_id), nao cobre nem
-- o filtro (pipeline) nem a ordenacao: toda abertura do quadro pagava um scan
-- + sort da conta inteira.
--
-- `id desc` entra na chave, e nao so' no ORDER BY da consulta, porque e' o
-- desempate da paginacao: sem ele o planner ainda teria que ordenar dentro de
-- cada grupo de criado_em igual (importacao em lote grava dezenas no mesmo
-- instante).
create index if not exists leads_pipeline_stage_criado_idx
  on public.leads (pipeline_id, stage_id, criado_em desc, id desc);

-- resolverContaAtiva() consulta memberships por user_id e ordena por
-- criado_em. A PK e (account_id, user_id), entao user_id sozinho nao tem
-- prefixo de indice: era seq scan a cada request, e agora e' UMA vez por
-- request (ver src/lib/data/sessao.ts) — mas ainda assim uma.
create index if not exists memberships_user_idx
  on public.memberships (user_id, criado_em);

-- O embed de etiquetas do cartao entra por lead_id (prefixo da PK, ja
-- coberto) e sai por tag_id para pegar o nome. Sem este indice o join volta
-- para a tabela tags por seq scan quando a conta acumula etiquetas.
create index if not exists lead_tags_tag_idx
  on public.lead_tags (tag_id);

-- A timeline le lead_events por lead_id ordenando por criado_em desc, seq
-- desc. 0006 ja criou (lead_id, criado_em desc, seq desc); nada a fazer aqui.

-- ---------------------------------------------------------------------------
-- 2. pode_ver_lead: uma unica ida a memberships
-- ---------------------------------------------------------------------------
--
-- A versao anterior chamava is_member_of() E papel_na_conta(), duas funcoes
-- security definer, ou seja DUAS buscas em memberships POR LINHA de leads
-- avaliada pela policy. Num funil de alguns milhares de leads isso e' o custo
-- dominante da consulta.
--
-- A forma abaixo devolve exatamente os mesmos tres casos:
--   nao e' membro          -> nenhuma linha casa       -> false
--   membro e vendedor      -> so casa se o lead e' dele
--   membro, gestor/admin   -> casa sempre              -> true
--
-- auth.uid() em subselect: assim o planner o promove a InitPlan e o avalia uma
-- vez por consulta, em vez de uma vez por linha.
create or replace function public.pode_ver_lead(p_account_id uuid, p_responsavel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.account_id = p_account_id
      and m.user_id = (select auth.uid())
      and (m.papel <> 'vendedor' or p_responsavel_id = (select auth.uid()))
  );
$$;

create or replace function public.is_member_of(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.account_id = p_account_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.papel_na_conta(p_account_id uuid)
returns public.papel
language sql
stable
security definer
set search_path = public
as $$
  select m.papel from public.memberships m
  where m.account_id = p_account_id and m.user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 3. leads_do_funil
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER (como metricas_coorte, 0014): a RLS de leads continua
-- valendo dentro da funcao, entao o vendedor recebe daqui exatamente o que
-- receberia do select direto — inclusive nos totais, que sao contagem do que
-- ELE ve, nunca da conta.
--
-- Devolve, para cada etapa da pipeline, a fatia [p_offset, p_offset+p_limite)
-- dos leads mais novos, mais o total e a soma da coluna INTEIRA repetidos em
-- cada linha (window functions). Duas consequencias que importam:
--
--   - o cabecalho da coluna continua honesto ("128 leads: R$ 340.000") mesmo
--     com so' 50 cartoes carregados;
--   - soma_cents_na_etapa e' NULL quando NENHUM lead da coluna tem valor, e
--     nao zero — sum() sobre so-nulos e' null, que e' precisamente a regra que
--     o quadro ja aplicava em JS ("R$ 0,00 ali seria uma afirmacao falsa").
--
-- p_stage_id recorta a UMA etapa: e' o "carregar mais" de uma coluna so, sem
-- repaginar as outras seis.
--
-- p_busca vai para ILIKE com %, _ e \ escapados. Sem isso o texto do usuario
-- viraria PADRAO: buscar "100%" casaria com "1000 leads" — o mesmo defeito que
-- padraoIlike() (src/lib/data/filtro.ts) corrige do lado do PostgREST.
create or replace function public.leads_do_funil(
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
-- em funcao nova. Revoke + grant explicito, e a entrada correspondente no mapa
-- de 0024_sweep_grants_rpc.test.ts.
revoke execute on function public.leads_do_funil(
  uuid, integer, integer, uuid, uuid, public.lead_origem, timestamptz, text
) from public;
grant execute on function public.leads_do_funil(
  uuid, integer, integer, uuid, uuid, public.lead_origem, timestamptz, text
) to authenticated;
