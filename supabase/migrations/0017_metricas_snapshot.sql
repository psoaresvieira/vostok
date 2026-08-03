-- As duas leituras de /metricas deixam de fazer join em stages e passam a ler
-- o snapshot da 0016. Antes, apagar uma etapa reescrevia o passado em
-- silencio: o max() de metricas_coorte colapsava e o inner join de
-- metricas_etiquetas engolia a linha. Agora o passado e do snapshot; stages
-- so responde pela etapa ATUAL do lead, que a guarda de excluir_etapa (0018)
-- garante existir.
--
-- Mesmas assinaturas, mesmo SECURITY INVOKER e pelo mesmo motivo de 0014:
-- o recorte por papel e o que pode_ver_lead ja faz, e definer o desligaria.

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
    -- A uniao das etapas que o lead JA ocupou: origem e destino de todo
    -- movimento (pelo SNAPSHOT — a etapa pode nao existir mais) e a etapa
    -- atual (por stages — esta existe, a guarda de excluir_etapa impede a
    -- exclusao com lead dentro). O comentario da 0014 dizia que a uniao "e
    -- completa sem backfill nenhum"; desde a 0016 isso NAO e mais verdade —
    -- o backfill da 0016 e pre-requisito destas leituras.
    --
    -- O filtro por tipo 'aberta' NAO e detalhe: Ganho e Perdido tem ordem
    -- maior que toda etapa aberta. Sem ele, todo lead perdido sairia com a
    -- profundidade maxima do funil. Para o historico o tipo vem do snapshot,
    -- congelado no momento do movimento.
    --
    -- coalesce 0: lead que nunca ocupou etapa aberta entra no total da coorte
    -- e em nenhum degrau.
    coalesce((
      select max(f.ordem)
        from (
          select sh.stage_origem_ordem as ordem
            from public.stage_history sh
           where sh.lead_id = l.id
             and sh.stage_origem_tipo = 'aberta'
          union all
          select sh.stage_destino_ordem
            from public.stage_history sh
           where sh.lead_id = l.id
             and sh.stage_destino_tipo = 'aberta'
          union all
          select s.ordem
            from public.stages s
           where s.id = l.stage_id
             and s.tipo = 'aberta'
        ) f
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
  -- O join em stages sumiu, e com ele o modo de falha: a ordem vem do
  -- snapshot, e stage_id_no_momento pode vir nulo — significa "a etapa foi
  -- excluida", e o dominio ja trata null como "nao pertence a etapa nenhuma".
  select lt.lead_id, t.id, t.nome, lt.stage_id_no_momento, lt.stage_ordem_no_momento
    from public.lead_tags lt
    join public.tags t on t.id = lt.tag_id
    join public.leads l on l.id = lt.lead_id
   where l.pipeline_id = p_pipeline_id
     and l.criado_em >= p_de
     and l.criado_em < p_ate
     and (p_responsavel_id is null or l.responsavel_id = p_responsavel_id);
$$;

-- Mesmas assinaturas de 0014, entao create or replace substitui de verdade
-- (nao cria sobrecarga) e os grants existentes sobrevivem. Reafirmados por
-- clareza — o custo e zero e a leitura da migration fica autossuficiente.
grant execute on function public.metricas_coorte(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.metricas_etiquetas(uuid, timestamptz, timestamptz, uuid) to authenticated;
