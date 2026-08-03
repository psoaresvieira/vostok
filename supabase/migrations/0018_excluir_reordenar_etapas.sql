-- As guardas vivem AQUI, nao na tela: as funcoes sao alcancaveis direto pelo
-- PostgREST, e guarda que mora so na interface nao e guarda.
--
-- SECURITY INVOKER nas tres, e e o inverso do habito: definer desligaria a
-- RLS de stages (as tabelas sao de postgres, nenhuma migration usa force row
-- level security) e qualquer membro apagaria etapa de outra conta. O teste de
-- prosecdef em 0018_*.test.ts transforma essa letra em asserção.

create or replace function public.excluir_etapa(p_stage_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_stage public.stages;
  v_leads bigint;
  v_mesmo_tipo bigint;
begin
  -- Leitura SEM lock primeiro, de proposito: sob RLS, SELECT ... FOR UPDATE
  -- exige que a linha passe TAMBEM pela policy de update (stages_admin_write,
  -- admin-only) — com o lock aqui, o vendedor nunca alcancaria o guard de
  -- papel logo abaixo e receberia "nao existe" para uma etapa que ele enxerga
  -- na tela. Quem nao enxerga a linha nem por select (outra conta) recebe
  -- "nao existe" — e nao "sem permissao", de proposito: nao vaza que o id e
  -- real.
  select * into v_stage from public.stages where id = p_stage_id;
  if v_stage.id is null then
    raise exception 'etapa_nao_encontrada';
  end if;

  -- O select acima passa para qualquer membro (stages_select e is_member_of);
  -- sem este guard, o delete la embaixo afetaria zero linhas pela RLS e a
  -- funcao devolveria sucesso mentindo.
  if public.papel_na_conta(public.conta_do_pipeline(v_stage.pipeline_id)) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;

  -- Agora sim o lock: o chamador provou ser admin, entao a policy de update
  -- devolve a linha. Serializa contra outra exclusao/reordenacao da mesma
  -- etapa. A etapa pode ter sumido entre as duas leituras — dai o recheck.
  select * into v_stage from public.stages where id = p_stage_id for update;
  if v_stage.id is null then
    raise exception 'etapa_nao_encontrada';
  end if;

  -- Guarda 1: lead dentro. Como o chamador ja provou ser admin, a RLS de
  -- leads nao esconde nada dele nesta conta. leads.stage_id continua NOT NULL
  -- e NO ACTION: se um lead entrar na etapa entre esta contagem e o delete, a
  -- FK estoura (23503) e a Task 4 traduz para o mesmo etapa_tem_leads.
  select count(*) into v_leads from public.leads l where l.stage_id = p_stage_id;
  if v_leads > 0 then
    raise exception 'etapa_tem_leads';
  end if;

  -- Guarda 2: ultima etapa do tipo. Sem etapa 'aberta' a ingestao do Meta e
  -- do Google nao teria onde por lead; a regra vale para os tres tipos.
  select count(*) into v_mesmo_tipo
    from public.stages s
   where s.pipeline_id = v_stage.pipeline_id
     and s.tipo = v_stage.tipo;
  if v_mesmo_tipo <= 1 then
    raise exception 'ultima_etapa_do_tipo';
  end if;

  -- Exclusao real. O historico sobrevive pelo snapshot da 0016; as FKs de
  -- stage_history e lead_tags viram null via on delete set null.
  delete from public.stages where id = p_stage_id;
end;
$$;

create or replace function public.reordenar_etapas(p_ids_na_ordem uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pipelines uuid[];
  v_pipeline uuid;
  v_total bigint;
  v_distintos bigint;
  v_encontrados bigint;
begin
  if p_ids_na_ordem is null or coalesce(array_length(p_ids_na_ordem, 1), 0) = 0 then
    raise exception 'ordem_invalida';
  end if;

  -- Todos os ids tem que resolver para UM pipeline visivel. Id de outra conta
  -- e invisivel pela RLS, entao cai aqui como permutacao que nao fecha.
  select array_agg(distinct s.pipeline_id) into v_pipelines
    from public.stages s
   where s.id = any (p_ids_na_ordem);
  if v_pipelines is null or array_length(v_pipelines, 1) <> 1 then
    raise exception 'ordem_invalida';
  end if;
  v_pipeline := v_pipelines[1];

  if public.papel_na_conta(public.conta_do_pipeline(v_pipeline)) is distinct from 'admin' then
    raise exception 'sem_permissao';
  end if;

  -- Serializa reordenacoes concorrentes do mesmo pipeline. order by id para
  -- ordem de lock deterministica (duas concorrentes se enfileiram em vez de
  -- se abracarem em deadlock).
  perform 1 from public.stages s where s.pipeline_id = v_pipeline order by s.id for update;

  -- Permutacao EXATA: mesmo tamanho, sem repeticao, e CADA id resolvendo para
  -- uma etapa deste pipeline. A terceira contagem nao e redundante com o
  -- array_agg la de cima: array_agg agrega so as linhas que casaram, entao uma
  -- lista com um id inexistente (ou invisivel pela RLS) no lugar de um real
  -- ainda resolve para um pipeline so e fecha as outras duas contagens — e o
  -- update aplicaria uma ordem que nao corresponde a lista pedida, ou
  -- estouraria 23505 cru no indice unico.
  select count(*) into v_total from public.stages s where s.pipeline_id = v_pipeline;
  select count(distinct x) into v_distintos from unnest(p_ids_na_ordem) as x;
  select count(*) into v_encontrados
    from public.stages s
   where s.id = any (p_ids_na_ordem)
     and s.pipeline_id = v_pipeline;
  if v_total <> array_length(p_ids_na_ordem, 1)
     or v_distintos <> array_length(p_ids_na_ordem, 1)
     or v_encontrados <> array_length(p_ids_na_ordem, 1) then
    raise exception 'ordem_invalida';
  end if;

  -- Duas fases DENTRO da transacao da funcao: stages_ordem_por_pipeline e um
  -- indice unico nao-deferivel, e um update que permuta valores pode colidir
  -- no meio do proprio statement. A faixa 1000+ e livre (ordens reais sao
  -- pequenas) e distinta entre si. Diferente da implementacao antiga em JS,
  -- falha em qualquer ponto desfaz TUDO — nunca sobra linha na faixa alta.
  update public.stages s
     set ordem = 1000 + t.i
    from unnest(p_ids_na_ordem) with ordinality as t(id, i)
   where s.id = t.id;

  update public.stages s
     set ordem = t.i
    from unnest(p_ids_na_ordem) with ordinality as t(id, i)
   where s.id = t.id;
end;
$$;

-- Leitura para a tela: quantos leads estao em cada etapa (a mensagem de
-- recusa mostra o numero) e quantos ja passaram por ela (o dialogo de
-- confirmacao mostra antes de excluir). SECURITY INVOKER: as contagens
-- respeitam a RLS de quem chama; a tela e admin-only e o admin enxerga a
-- conta inteira.
create or replace function public.resumo_etapas(p_pipeline_id uuid)
returns table (stage_id uuid, leads_na_etapa bigint, leads_passaram bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id,
    (select count(*) from public.leads l where l.stage_id = s.id),
    (select count(distinct passou.lead_id)
       from (
         select sh.lead_id
           from public.stage_history sh
          where sh.stage_origem = s.id or sh.stage_destino = s.id
         union all
         select l.id from public.leads l where l.stage_id = s.id
       ) passou)
  from public.stages s
  where s.pipeline_id = p_pipeline_id;
$$;

-- Grant explicito: o default ACL do schema public nesta imagem da a
-- anon/authenticated so Dxtm. Sem isto a chamada morre em permission denied
-- antes de qualquer guarda rodar.
grant execute on function public.excluir_etapa(uuid) to authenticated;
grant execute on function public.reordenar_etapas(uuid[]) to authenticated;
grant execute on function public.resumo_etapas(uuid) to authenticated;
