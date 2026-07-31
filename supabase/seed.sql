-- Semente de DESENVOLVIMENTO. Roda depois das migrations em todo
-- `npx supabase db reset`, e nunca em producao — o Supabase so executa seed em
-- reset local.
--
-- O segredo de ingestao e configuracao de OPERADOR: ele existe para o servidor
-- provar que a chamada veio dele, antes de qualquer conta ser resolvida.
-- Nenhuma tela e nenhuma RPC exposta a aplicacao o escreve (a razao completa
-- esta em 0008_fontes_conectadas.sql:69-82). Em desenvolvimento entra aqui,
-- para que `db reset` deixe o ambiente pronto; em producao entra por SQL no
-- painel do Supabase, com um valor que nunca esteve num arquivo versionado.
--
-- Este valor e publico de proposito: esta versionado, esta no
-- .env.local.example, e vale so contra o Postgres em 127.0.0.1. Se ele aparecer
-- em qualquer ambiente alcancavel de fora, o problema e o ambiente.
update public.ingestion_config
   set segredo_hash = public.hash_segredo('segredo-de-ingestao-local'),
       atualizado_em = now()
 where id;
