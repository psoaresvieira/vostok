-- Sub-projeto 2, Plano 4: a transacao que decide se a entrega vira card ou
-- vira aviso no card que ja existe.
--
-- ATENCAO ao modelo de privilegio: esta funcao e SECURITY DEFINER e roda como
-- postgres, dono das tabelas, e nenhuma migration usa `force row level
-- security` — logo a RLS NAO e avaliada aqui dentro. E o que permite escrever
-- sem auth.uid(). O preco e que toda garantia que mora em policy precisa ser
-- reafirmada a mao neste corpo; ver e_membro_da_conta mais abaixo.
create or replace function public.ingerir_lead(
  p_segredo text,
  p_log_id uuid,
  p_dados jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.integration_log;
  v_account uuid;
  v_resp_padrao uuid;
  v_pipeline uuid;
  v_stage uuid;
  v_tel text;
  v_email text;
  v_lead uuid;
  v_dono uuid;
  v_evento jsonb;
begin
  if not public.segredo_confere(p_segredo) then
    raise exception 'segredo_invalido';
  end if;

  -- `for update` serializa a entrega. O after() da rota e a varredura do cron
  -- podem pegar a mesma linha ao mesmo tempo, e sem a trava as duas passariam
  -- pelo teste de status e criariam um card cada.
  select * into v_log from public.integration_log where id = p_log_id for update;
  if v_log.id is null then
    raise exception 'log_nao_encontrado';
  end if;

  -- 'falhou' entra junto de 'pendente' de proposito: e o estado que o cron
  -- reprocessa. 'processado' e 'ignorado' caem no ja_processado, que e a
  -- idempotencia que a spec pede.
  if v_log.status not in ('pendente', 'falhou') then
    return jsonb_build_object('status', 'ja_processado', 'lead_id', v_log.lead_id);
  end if;
  if v_log.source_id is null then
    raise exception 'fonte_nao_encontrada';
  end if;

  select ls.account_id, ls.responsavel_padrao_id
    into v_account, v_resp_padrao
    from public.lead_sources ls
   where ls.id = v_log.source_id;

  -- A RLS nao nos alcanca aqui, entao o with check da 0007 tambem nao. Sem esta
  -- reafirmacao, um responsavel padrao que saiu da conta (membership revogada
  -- depois de a fonte ter sido configurada) produziria lead invisivel para todo
  -- vendedor — leads_select exige responsavel_id = auth.uid() para vendedor —
  -- e sem erro nenhum. E exatamente o backlog #4 voltando por outra porta.
  -- Nulo e o destino certo: e o estado legitimo da fila que gestor e admin veem.
  if not public.e_membro_da_conta(v_account, v_resp_padrao) then
    v_resp_padrao := null;
  end if;

  select p.id into v_pipeline
    from public.pipelines p
   where p.account_id = v_account and p.is_default;
  if v_pipeline is null then
    raise exception 'pipeline_nao_encontrado';
  end if;

  -- Primeira etapa ABERTA, e nao `ordem = 1`: leads.status e derivado do tipo
  -- da etapa dentro de move_lead_stage, entao se a conta reordenar e puser uma
  -- etapa de ganho na frente, o lead nasceria ganho sem ninguem ter vendido
  -- nada.
  select s.id into v_stage
    from public.stages s
   where s.pipeline_id = v_pipeline and s.tipo = 'aberta'
   order by s.ordem asc
   limit 1;
  if v_stage is null then
    raise exception 'etapa_invalida';
  end if;

  v_tel := nullif(btrim(coalesce(p_dados ->> 'telefone_e164', '')), '');
  v_email := nullif(btrim(coalesce(p_dados ->> 'email_norm', '')), '');

  -- O que a timeline vai contar. `extras` sao os campos do formulario que
  -- nenhum mapeador conhece — as perguntas de qualificacao que o cliente
  -- escreveu. Sao o motivo de o payload cru nunca ser descartado.
  v_evento := jsonb_build_object(
    'provedor', v_log.provedor,
    'external_id', v_log.external_id,
    'campanha', p_dados ->> 'campanha_origem',
    'formulario', p_dados ->> 'formulario_origem',
    'extras', coalesce(p_dados -> 'extras', '{}'::jsonb)
  );

  -- Dedup so contra lead ABERTO, e e por isso que isto nunca virou constraint
  -- unica: com o card sendo o Lead, recompra e lead novo. Lead ganho ou perdido
  -- nao conta.
  if v_tel is not null or v_email is not null then
    select l.id, l.responsavel_id
      into v_lead, v_dono
      from public.leads l
     where l.account_id = v_account
       and l.status = 'aberto'
       and (
         (v_tel is not null and l.telefone_e164 = v_tel)
         or (v_email is not null and l.email_norm = v_email)
       )
     order by l.criado_em desc
     limit 1;
  end if;

  if v_lead is not null then
    insert into public.lead_events (lead_id, tipo, payload, ator_id)
    values (v_lead, 'reingestao', v_evento, null);

    -- Notifica quem ja cuida do lead, e nao o responsavel padrao da fonte: e
    -- essa pessoa que precisa saber que a mesma pessoa voltou.
    if v_dono is not null then
      insert into public.notifications (account_id, usuario_id, lead_id, tipo)
      values (v_account, v_dono, v_lead, 'lead_reincidente');
    end if;

    update public.integration_log
       set status = 'processado',
           lead_id = v_lead,
           processado_em = now(),
           ultima_tentativa_em = now(),
           erro = null
     where id = p_log_id;

    return jsonb_build_object('status', 'reincidente', 'lead_id', v_lead);
  end if;

  insert into public.leads (
    account_id, nome, telefone, telefone_e164, email, email_norm, empresa,
    origem, campanha_origem, formulario_origem,
    pipeline_id, stage_id, responsavel_id
  ) values (
    v_account,
    -- leads.nome e not null. Perder o lead por falta de nome seria o pior
    -- desfecho possivel: o payload cru fica no log, e o nome se corrige depois.
    coalesce(nullif(btrim(coalesce(p_dados ->> 'nome', '')), ''), 'Lead sem nome'),
    p_dados ->> 'telefone',
    v_tel,
    p_dados ->> 'email',
    v_email,
    p_dados ->> 'empresa',
    -- provedor_lead e lead_origem sao enums diferentes com os mesmos rotulos
    -- 'meta' e 'google'; o cast tem que passar por text.
    v_log.provedor::text::public.lead_origem,
    p_dados ->> 'campanha_origem',
    p_dados ->> 'formulario_origem',
    v_pipeline, v_stage, v_resp_padrao
  ) returning id into v_lead;

  insert into public.stage_history (lead_id, stage_origem, stage_destino, movido_por)
  values (v_lead, null, v_stage, null);

  insert into public.lead_events (lead_id, tipo, payload, ator_id)
  values (v_lead, 'criado_por_webhook', v_evento, null);

  if v_resp_padrao is not null then
    insert into public.notifications (account_id, usuario_id, lead_id, tipo)
    values (v_account, v_resp_padrao, v_lead, 'novo_lead');
  end if;

  update public.integration_log
     set status = 'processado',
         lead_id = v_lead,
         processado_em = now(),
         ultima_tentativa_em = now(),
         erro = null
   where id = p_log_id;

  return jsonb_build_object('status', 'criado', 'lead_id', v_lead);
end;
$$;
