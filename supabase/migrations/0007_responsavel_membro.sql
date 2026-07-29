-- Backlog #4 do review final do Plano 2.
--
-- As policies de leads checavam is_member_of(account_id), que responde "quem
-- escreve pertence a conta?", e nunca "a pessoa apontada como responsavel
-- pertence a conta?". Com isso um admin podia gravar como responsavel o
-- profiles.id de qualquer usuario do sistema. O efeito nao e so bagunca de
-- dados: leads_select exige responsavel_id = auth.uid() para vendedor, entao o
-- lead com responsavel de fora fica invisivel para todos os vendedores da
-- conta, sem erro nenhum. A aplicacao nao validava isso em lugar nenhum, e o
-- Plano 4 passa a gravar responsavel_id vindo de configuracao, sem humano no
-- meio.

-- Complementa is_member_of, que responde sempre sobre auth.uid(). Esta recebe o
-- usuario explicitamente, que e o que a policy precisa perguntar sobre a
-- coluna. SECURITY DEFINER pelo mesmo motivo de is_member_of: consultar
-- memberships de dentro de uma policy sem isso entra em recursao de avaliacao.
--
-- Nulo e verdadeiro de proposito: lead sem responsavel e estado legitimo (a
-- fila que so gestor e admin enxergam), e o Plano 4 depende disso quando a
-- fonte nao tem responsavel padrao configurado.
create or replace function public.e_membro_da_conta(p_account_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is null or exists (
    select 1 from public.memberships m
    where m.account_id = p_account_id and m.user_id = p_user_id
  );
$$;

-- Recriar as duas policies de escrita. O `using` de leads_update fica igual: ele
-- decide QUAIS linhas podem ser alteradas, e essa regra nao mudou. O que muda e
-- o `with check`, que decide como a linha pode FICAR depois da escrita.
drop policy leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert with check (
    public.is_member_of(account_id)
    and public.e_membro_da_conta(account_id, responsavel_id)
  );

drop policy leads_update on public.leads;
create policy leads_update on public.leads
  for update using (public.pode_ver_lead(account_id, responsavel_id))
  with check (
    public.is_member_of(account_id)
    and public.e_membro_da_conta(account_id, responsavel_id)
  );

-- Sem grant novo: recriar policy nao mexe no ACL da tabela, e a funcao roda
-- como DEFINER (dono postgres).
