-- Sub-projeto 3, Plano 6: as duas leituras que a aba de Metricas consome.
--
-- SECURITY INVOKER de proposito, nos dois casos. A aba e visivel para os tres
-- papeis, e o recorte por papel e exatamente o que pode_ver_lead ja faz no
-- funil: vendedor so enxerga o que e dele. Marcar como definer aqui desligaria
-- a RLS e devolveria a conta inteira para qualquer chamador — uma letra de
-- diferenca no DDL, sem nenhum erro visivel.
--
-- O que estas funcoes fazem e o que so o SQL faz bem: reduzir stage_history a
-- um numero por lead. Toda regra de negocio (degraus, denominadores,
-- agrupamento por id, nome mais recente) fica em dominio puro, onde o teste
-- roda em milissegundos e sem Docker.

create or replace function public.metricas_coorte(
  p_pipeline_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_responsavel_id uuid default null
)
returns table (
  lead_id uuid,
  criado_em timestamptz,
  origem public.lead_origem,
  status public.lead_status,
  responsavel_id uuid,
  campanha_id text,
  campanha_nome text,
  conjunto_id text,
  conjunto_nome text,
  anuncio_id text,
  anuncio_nome text,
  ordem_max integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.criado_em,
    l.origem,
    l.status,
    l.responsavel_id,
    l.campanha_id,
    l.campanha_nome,
    l.conjunto_id,
    l.conjunto_nome,
    l.anuncio_id,
    l.anuncio_nome,
    -- A uniao das etapas que o lead JA ocupou: o stage_id atual, mais toda
    -- origem e todo destino do historico. Ela e completa sem backfill nenhum
    -- — move_lead_stage e o unico caminho de troca de etapa e sempre grava
    -- historico, entao a etapa inicial de um lead que se moveu aparece como
    -- stage_origem do primeiro movimento, e a de um lead que nunca se moveu e
    -- o proprio stage_id.
    --
    -- `s.tipo = 'aberta'` NAO e detalhe: Ganho e Perdido tem ordem 6 e 7 no
    -- pipeline padrao, maiores que toda etapa aberta. Sem o filtro, todo lead
    -- perdido sairia com a profundidade maxima do funil.
    --
    -- coalesce 0: lead que nunca ocupou etapa aberta entra no total da coorte
    -- e em nenhum degrau.
    coalesce((
      select max(s.ordem)
        from public.stages s
       where s.tipo = 'aberta'
         and s.pipeline_id = l.pipeline_id
         and (
           s.id = l.stage_id
           or exists (
             select 1
               from public.stage_history sh
              where sh.lead_id = l.id
                and (sh.stage_origem = s.id or sh.stage_destino = s.id)
           )
         )
    ), 0)::integer
  from public.leads l
  where l.pipeline_id = p_pipeline_id
    -- Semiaberto: dois periodos adjacentes nunca contam o mesmo lead duas vezes.
    and l.criado_em >= p_de
    and l.criado_em < p_ate
    and (p_responsavel_id is null or l.responsavel_id = p_responsavel_id);
$$;

create or replace function public.metricas_etiquetas(
  p_pipeline_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_responsavel_id uuid default null
)
returns table (
  lead_id uuid,
  tag_id uuid,
  tag_nome text,
  stage_id_no_momento uuid,
  ordem_no_momento integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select lt.lead_id, t.id, t.nome, lt.stage_id_no_momento, s.ordem
    from public.lead_tags lt
    join public.tags t on t.id = lt.tag_id
    join public.stages s on s.id = lt.stage_id_no_momento
    join public.leads l on l.id = lt.lead_id
   where l.pipeline_id = p_pipeline_id
     and l.criado_em >= p_de
     and l.criado_em < p_ate
     and (p_responsavel_id is null or l.responsavel_id = p_responsavel_id);
$$;

-- Grant explicito: o default ACL do schema public nesta imagem (Postgres 17.6)
-- concede a anon/authenticated apenas Dxtm. Sem isto a chamada morre em
-- permission denied antes de a RLS ser sequer avaliada.
grant execute on function public.metricas_coorte(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.metricas_etiquetas(uuid, timestamptz, timestamptz, uuid) to authenticated;
