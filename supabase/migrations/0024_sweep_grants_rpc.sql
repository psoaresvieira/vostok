-- Sweep de grants de RPC (backlog do review final do Plano 11, item a).
--
-- O default ACL desta imagem deixa EXECUTE para PUBLIC em toda funcao nova.
-- Ate aqui isso significava que quase toda RPC do repo era executavel por
-- `anon` — conectar_fonte_meta, move_lead_stage, ate hash_segredo. Nenhuma
-- era explorabilidade direta (definer confere segredo/sessao por dentro,
-- invoker esbarra na RLS), mas a autorizacao ficava implicita e fragil nos
-- dois sentidos: um grant a mais que ninguem decidiu, e a dependencia
-- invisivel no default que a 0023 documentou (um revoke de endurecimento
-- derrubaria o disparo em producao apontando o sintoma para o lugar errado).
--
-- A regra que esta migration instala, e que o teste 0024 tranca para toda
-- funcao futura: EXECUTE revogado de PUBLIC em TODA funcao do schema public,
-- e grant explicito so para o papel que o codigo de producao usa.
--
--   anon           -> clientes anon+segredo: webhooks (criarIngestaoStore,
--                     lib/data/ingestao.ts) e disparo (criarDisparoServico,
--                     lib/data/templates.ts)
--   authenticated  -> stores DoServidor e Server Actions com sessao, mais os
--                     helpers avaliados pela RLS na pele do consultante
--   nenhum         -> funcao interna: trigger nao checa EXECUTE ao disparar,
--                     e helper chamado dentro de definer roda como a dona
--
-- `credencial_whatsapp` e `atualizar_status_template` perdem o grant de
-- `authenticated` que tinham da 0019/0022: nenhum caminho de producao as
-- chama com sessao (so o cliente anonimo do disparo), e grant sem chamador
-- e exatamente a classe que este sweep existe para eliminar.

-- 1. Zera: revoga EXECUTE de PUBLIC e dos dois papeis de cliente em todas as
-- 34 funcoes, materializando o proacl (proacl nulo = "vale o default", e o
-- default e PUBLIC).
revoke execute on function public.accept_invite(text) from public, anon, authenticated;
revoke execute on function public.atualizar_status_template(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.backfill_snapshot_etapas() from public, anon, authenticated;
revoke execute on function public.compartilha_conta(uuid) from public, anon, authenticated;
revoke execute on function public.conectar_fonte_google(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.conectar_fonte_meta(text, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.conectar_whatsapp(text, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.conta_do_pipeline(uuid) from public, anon, authenticated;
revoke execute on function public.credencial_whatsapp(text, uuid) from public, anon, authenticated;
revoke execute on function public.criar_conta(text) from public, anon, authenticated;
revoke execute on function public.desconectar_fonte(uuid) from public, anon, authenticated;
revoke execute on function public.desconectar_whatsapp(text, uuid) from public, anon, authenticated;
revoke execute on function public.e_membro_da_conta(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.entregas_pendentes(text, integer) from public, anon, authenticated;
revoke execute on function public.excluir_etapa(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.hash_segredo(text) from public, anon, authenticated;
revoke execute on function public.ingerir_lead(text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.is_member_of(uuid) from public, anon, authenticated;
revoke execute on function public.metricas_coorte(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.metricas_etiquetas(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.move_lead_stage(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.papel_na_conta(uuid) from public, anon, authenticated;
revoke execute on function public.pode_ver_lead(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.pode_ver_lead_id(uuid) from public, anon, authenticated;
revoke execute on function public.registrar_entrega(text, public.provedor_lead, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.registrar_falha(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.reivindicar_fonte_meta(text, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.reordenar_etapas(uuid[]) from public, anon, authenticated;
revoke execute on function public.resumo_etapas(uuid) from public, anon, authenticated;
revoke execute on function public.segredo_confere(text) from public, anon, authenticated;
revoke execute on function public.snapshot_lead_tags() from public, anon, authenticated;
revoke execute on function public.snapshot_stage_history() from public, anon, authenticated;
revoke execute on function public.stage_da_conta(uuid, uuid) from public, anon, authenticated;

-- 2. Reabre so o que o codigo de producao chama.

-- Clientes anon + segredo (webhooks e disparo).
grant execute on function public.atualizar_status_template(text, uuid, text, text) to anon;
grant execute on function public.credencial_whatsapp(text, uuid) to anon;
grant execute on function public.entregas_pendentes(text, integer) to anon;
grant execute on function public.ingerir_lead(text, uuid, jsonb) to anon;
grant execute on function public.registrar_entrega(text, public.provedor_lead, text, jsonb, text, text) to anon;
grant execute on function public.registrar_falha(text, uuid, text) to anon;

-- RPCs de sessao.
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.conectar_fonte_google(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.conectar_fonte_meta(text, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.conectar_whatsapp(text, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.criar_conta(text) to authenticated;
grant execute on function public.desconectar_fonte(uuid) to authenticated;
grant execute on function public.desconectar_whatsapp(text, uuid) to authenticated;
grant execute on function public.excluir_etapa(uuid) to authenticated;
grant execute on function public.metricas_coorte(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.metricas_etiquetas(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.move_lead_stage(uuid, uuid, uuid) to authenticated;
grant execute on function public.reivindicar_fonte_meta(text, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.reordenar_etapas(uuid[]) to authenticated;
grant execute on function public.resumo_etapas(uuid) to authenticated;

-- Helpers de RLS, avaliados na pele do papel que consulta.
grant execute on function public.compartilha_conta(uuid) to authenticated;
grant execute on function public.conta_do_pipeline(uuid) to authenticated;
grant execute on function public.e_membro_da_conta(uuid, uuid) to authenticated;
grant execute on function public.is_member_of(uuid) to authenticated;
grant execute on function public.papel_na_conta(uuid) to authenticated;
grant execute on function public.pode_ver_lead(uuid, uuid) to authenticated;
grant execute on function public.pode_ver_lead_id(uuid) to authenticated;
grant execute on function public.stage_da_conta(uuid, uuid) to authenticated;

-- backfill_snapshot_etapas, handle_new_user, hash_segredo, segredo_confere,
-- snapshot_lead_tags e snapshot_stage_history ficam sem grant nenhum, de
-- proposito: sao internas.
