-- Mover um lead para OUTRA pipeline (spec 2026-08-28-crm-funil-kommo, Parte 3).
-- move_lead_stage (0004) so' trocava stage_id e nunca conferia a pipeline da
-- etapa de destino: uma etapa de outra pipeline da mesma conta passava e
-- deixava pipeline_id/stage_id inconsistentes. Esta migration (1) cria a RPC
-- que troca os dois juntos e (2) fecha o buraco na antiga.

create or replace function public.mover_lead_pipeline(
  p_lead_id uuid,
  p_stage_destino uuid,
  p_loss_reason_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.leads;
  v_stage public.stages;
  v_origem uuid;
  v_pipeline_origem uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'lead_nao_encontrado';
  end if;

  select s.* into v_stage
  from public.stages s
  join public.pipelines p on p.id = s.pipeline_id
  where s.id = p_stage_destino and p.account_id = v_lead.account_id;

  if v_stage.id is null then
    raise exception 'etapa_invalida';
  end if;

  -- Mesma pipeline e' trabalho de move_lead_stage; esta funcao existe para a
  -- troca de pipeline e nao deve virar um segundo caminho para o mesmo
  -- movimento.
  if v_stage.pipeline_id = v_lead.pipeline_id then
    raise exception 'mesma_pipeline';
  end if;

  if v_stage.tipo = 'perdido' then
    if p_loss_reason_id is null then
      raise exception 'motivo_perda_obrigatorio';
    end if;
    if not exists (
      select 1 from public.loss_reasons lr
      where lr.id = p_loss_reason_id
        and lr.account_id = v_lead.account_id
        and lr.ativo
    ) then
      raise exception 'motivo_perda_invalido';
    end if;
  end if;

  v_origem := v_lead.stage_id;
  v_pipeline_origem := v_lead.pipeline_id;

  update public.leads set
    pipeline_id = v_stage.pipeline_id,
    stage_id = p_stage_destino,
    -- status nunca e escrito pela aplicacao: e derivado do tipo da etapa.
    status = (case v_stage.tipo
                when 'ganho' then 'ganho'
                when 'perdido' then 'perdido'
                else 'aberto'
              end)::public.lead_status,
    loss_reason_id = case when v_stage.tipo = 'perdido' then p_loss_reason_id else null end,
    entrou_na_etapa_em = now(),
    atualizado_em = now()
  where id = p_lead_id;

  insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
  values (p_lead_id, v_origem, p_stage_destino, auth.uid());

  insert into public.lead_events (lead_id, tipo, payload, ator_id)
  values (
    p_lead_id,
    'pipeline_alterada',
    jsonb_build_object(
      'de_pipeline', v_pipeline_origem,
      'para_pipeline', v_stage.pipeline_id,
      'de', v_origem,
      'para', p_stage_destino,
      'loss_reason_id', p_loss_reason_id
    ),
    auth.uid()
  );
end;
$$;

-- Guarda 7 (ver 0024_sweep_grants_rpc.sql): o default ACL desta imagem da
-- EXECUTE a PUBLIC em funcao nova, e o ACL padrao do papel postgres ainda
-- concede EXECUTE EXPLICITAMENTE a anon/authenticated/service_role — entao
-- `from public` sozinho remove a entrada `=X/` e deixa `anon=X/postgres` de
-- pe. Por isso `from public, anon`.
revoke execute on function public.mover_lead_pipeline(uuid, uuid, uuid) from public, anon;
grant execute on function public.mover_lead_pipeline(uuid, uuid, uuid) to authenticated;

-- (2) move_lead_stage passa a exigir etapa da MESMA pipeline. Corpo copiado
-- da 0004 com uma unica linha a mais no where.
create or replace function public.move_lead_stage(
  p_lead_id uuid,
  p_stage_destino uuid,
  p_loss_reason_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.leads;
  v_stage public.stages;
  v_origem uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'lead_nao_encontrado';
  end if;

  select s.* into v_stage
  from public.stages s
  join public.pipelines p on p.id = s.pipeline_id
  where s.id = p_stage_destino
    and p.account_id = v_lead.account_id
    and s.pipeline_id = v_lead.pipeline_id; -- 0032: etapa de outra pipeline e' invalida aqui

  if v_stage.id is null then
    raise exception 'etapa_invalida';
  end if;

  if v_stage.tipo = 'perdido' then
    if p_loss_reason_id is null then
      raise exception 'motivo_perda_obrigatorio';
    end if;
    if not exists (
      select 1 from public.loss_reasons lr
      where lr.id = p_loss_reason_id
        and lr.account_id = v_lead.account_id
        and lr.ativo
    ) then
      raise exception 'motivo_perda_invalido';
    end if;
  end if;

  v_origem := v_lead.stage_id;

  update public.leads set
    stage_id = p_stage_destino,
    -- status nunca e escrito pela aplicacao: e derivado do tipo da etapa.
    status = (case v_stage.tipo
                when 'ganho' then 'ganho'
                when 'perdido' then 'perdido'
                else 'aberto'
              end)::public.lead_status,
    loss_reason_id = case when v_stage.tipo = 'perdido' then p_loss_reason_id else null end,
    entrou_na_etapa_em = now(),
    atualizado_em = now()
  where id = p_lead_id;

  insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
  values (p_lead_id, v_origem, p_stage_destino, auth.uid());

  insert into public.lead_events (lead_id, tipo, payload, ator_id)
  values (
    p_lead_id,
    'etapa_alterada',
    jsonb_build_object('de', v_origem, 'para', p_stage_destino, 'loss_reason_id', p_loss_reason_id),
    auth.uid()
  );
end;
$$;

-- `create or replace` com a MESMA assinatura preserva o ACL, entao os grants
-- da 0024 continuam valendo. Reemitidos assim mesmo, por simetria com a RPC
-- nova acima: quem le esta migration nao precisa abrir a 0024 para saber
-- quem pode chamar move_lead_stage.
revoke execute on function public.move_lead_stage(uuid, uuid, uuid) from public, anon;
grant execute on function public.move_lead_stage(uuid, uuid, uuid) to authenticated;

-- Higiene: os cinco helpers das 0025/0026 nasceram com `revoke ... from
-- public` sem o `anon`, e por isso o grant EXPLICITO do ACL padrao do papel
-- postgres (`anon=X/postgres`) sobreviveu — em producao os cinco estao
-- executaveis por anon ate hoje. Nenhum e' explorabilidade direta (os tres
-- primeiros sao definer fail-closed para nao-membro, pipeline_tem_leads
-- idem, e a guarda so' faz sentido disparada por trigger), mas o mapa da
-- 0024_sweep_grants_rpc.test.ts diz `anon: false` para todos e a realidade
-- dizia o contrario. guarda_ultima_etapa_do_tipo perde tambem o
-- `authenticated`: e' funcao de trigger, o mapa a marca como interna, e
-- trigger nao checa EXECUTE ao disparar.
revoke execute on function public.etapa_tem_leads(uuid) from anon;
revoke execute on function public.etapa_ultima_do_tipo(uuid) from anon;
revoke execute on function public.etapa_imutaveis_ok(uuid, public.stage_tipo, uuid) from anon;
revoke execute on function public.pipeline_tem_leads(uuid) from anon;
revoke execute on function public.guarda_ultima_etapa_do_tipo() from anon, authenticated;
