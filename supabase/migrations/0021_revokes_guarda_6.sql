-- Paga o item 3 da secao 0 do progresso (guarda silenciosa no 6, achada no
-- review do Plano 9): o default ACL desta imagem concede Dxtm
-- (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) a anon/authenticated em toda tabela
-- nova, e TRUNCATE nao passa pela RLS. source_credentials e ingestion_config
-- estao truncaveis por sessao SQL authenticated desde a 0008 — inalcancavel
-- pela superficie do produto (PostgREST nao fala TRUNCATE), mas o comentario
-- da 0008 promete tabela fechada e sem isto a promessa e falsa.
--
-- Nenhuma RPC quebra: as funcoes definer rodam como a dona das tabelas
-- (postgres) e nao dependem de ACL de anon/authenticated. A suite existente
-- de 0008/0010/0011 e a prova executavel.
revoke all on public.source_credentials from anon, authenticated;
revoke all on public.ingestion_config from anon, authenticated;

-- Na 0019 o revoke foi so de TRUNCATE; o review final do Plano 9 apontou o
-- residuo assimetrico (x, t, m do default ACL ficaram). Fecha aqui.
revoke references, trigger, maintain on public.whatsapp_connections from anon, authenticated;
