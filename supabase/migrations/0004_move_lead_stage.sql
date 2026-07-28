-- Unico caminho para trocar a etapa de um lead.
-- SECURITY INVOKER de proposito: a RLS continua valendo, entao um vendedor
-- nao consegue mover lead que nao e dele.
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
  where s.id = p_stage_destino and p.account_id = v_lead.account_id;

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
