-- accept_invite passa a exigir que o usuario que resgata seja o convidado.
-- Ate aqui a funcao achava o convite pelo token e inseria a membership com
-- v_invite.account_id/v_invite.papel sem nunca olhar v_invite.email: qualquer
-- usuario autenticado de posse do link entrava na conta com o papel do convite,
-- inclusive 'admin', que a tela de configuracao oferece.
--
-- Unica mudanca em relacao a 0001_identidade.sql e a checagem de email. Tudo
-- mais e reproduzido igual de proposito: SECURITY DEFINER continua obrigatorio
-- (o convidado ainda nao e membro de nada e nao le o proprio convite por
-- policy), `set search_path = public` continua fechando o caminho de busca da
-- funcao DEFINER, a assinatura (p_token text) returns uuid continua a mesma
-- para nao quebrar o rpc('accept_invite') do app, e os nomes de erro ja
-- existentes (sem_sessao, convite_invalido, convite_ja_aceito, convite_expirado)
-- seguem identicos porque a UI traduz por codigo.
--
-- Comparacao em lower() nos dois lados: convidar() ja grava o email em
-- minusculas, mas a funcao nao pode depender de quem escreveu a linha.
-- Sem email no JWT o resgate falha (sem_email) em vez de passar direto.
--
-- Nenhum grant novo: substituir o corpo de uma funcao nao mexe no ACL dela nem
-- pede privilegio de tabela adicional (o insert em memberships continua rodando
-- como DEFINER, dono postgres). Conferido com has_function_privilege depois de
-- aplicar.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'sem_sessao';
  end if;

  v_email := auth.jwt() ->> 'email';
  if v_email is null or v_email = '' then
    raise exception 'sem_email';
  end if;

  select * into v_invite from public.invites where token = p_token;

  if v_invite.id is null then
    raise exception 'convite_invalido';
  end if;
  if v_invite.aceito_em is not null then
    raise exception 'convite_ja_aceito';
  end if;
  if v_invite.expira_em < now() then
    raise exception 'convite_expirado';
  end if;
  if lower(v_invite.email) <> lower(v_email) then
    raise exception 'convite_de_outro_email';
  end if;

  insert into public.memberships (account_id, user_id, papel)
  values (v_invite.account_id, auth.uid(), v_invite.papel)
  on conflict (account_id, user_id) do nothing;

  update public.invites set aceito_em = now() where id = v_invite.id;

  return v_invite.account_id;
end;
$$;
