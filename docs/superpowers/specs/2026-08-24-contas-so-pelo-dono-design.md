# Contas criadas só pelo dono da plataforma

Data: 2026-08-24
Status: aprovado em conversa; aguardando revisão do texto

## Contexto

Hoje o `/signup` é aberto: qualquer pessoa cria uma conta e vira admin dela
(`cadastrarAbrindoConta` → `criar_conta`). O modelo de negócio do Vostok é
outro: **o Pedro (dono da plataforma) é o único que cria contas**; os clientes
recebem acesso a uma conta já criada, por link de convite.

O fluxo de convites já existe e funciona (`invites` + `accept_invite` +
`/signup?convite=` e `/login?convite=`). O que falta é fechar a porta aberta e
dar ao dono uma ferramenta para criar contas.

## Objetivo

1. Ninguém além do dono da plataforma consegue criar conta — garantido no
   banco, não só na interface.
2. O dono cria conta + convite inicial numa página `/admin` própria e recebe o
   link pronto para enviar ao cliente.
3. O cliente define o próprio nome e senha ao abrir o link (ninguém manuseia
   senha de ninguém).

## Design

### Banco (migration 0014)

**`platform_owners (user_id uuid primary key references auth.users)`**
- Uma linha: o usuário do Pedro. Seed idempotente por email
  (`insert … select id from auth.users where email = 'psoaresvieira2005@gmail.com'
  on conflict do nothing`) — em ambiente onde o email não existe, não insere nada.
- RLS ligada com **nenhuma policy**: tabela invisível e imutável via API.
  Só funções `security definer` a consultam.

**`criar_conta(p_nome)` — restringida**
- Passa a exigir `auth.uid()` presente em `platform_owners`; senão
  `raise exception 'sem_permissao'`.
- Continua criando account + membership admin do chamador + pipeline padrão +
  motivos de perda (comportamento atual, agora restrito ao dono).

**`criar_conta_cliente(p_nome, p_email) returns text` — nova, security definer**
- Guarda: `auth.uid()` em `platform_owners`, senão `sem_permissao`.
- Cria a conta com o mesmo seed de `criar_conta` (pipeline "Funil de vendas",
  7 etapas, 5 motivos de perda), **sem** membership para o chamador — o dono
  não é membro das contas dos clientes (a "conta ativa" do app é a membership
  mais antiga; virar membro só poluiria a resolução).
- Cria um convite em `invites` com papel `admin`, email normalizado
  (trim/lowercase), token no mesmo formato do fluxo de convites existente e a
  mesma expiração.
- Retorna o token do convite.

**`reemitir_convite(p_invite_id) returns text` — nova, security definer**
- Guarda: dono da plataforma.
- Só para convite ainda não aceito (`aceito_em is null`); senão
  `convite_ja_aceito`.
- Gera token e expiração novos, retorna o token novo.

A migration segue o checklist de guardas silenciosas do Supabase (search_path
fixado nas funções, RLS explícita, sem policy de delete permissiva etc.).

### Server actions — `(auth)/acoes.ts`

- `cadastrar` perde o caminho sem convite: sem token no formulário, retorna
  `falha('cadastro_fechado')`. A função `cadastrarAbrindoConta` e o
  `cadastroSchema` (com `nomeConta`) são removidos.
- `entrar` não muda.
- Novo módulo de actions do admin (`(app)/admin/acoes.ts`):
  - `criarContaCliente(formData)` → valida nome + email (zod), chama a RPC,
    devolve o link completo `/signup?convite=<token>`.
  - `reemitirConvite(inviteId)` → chama a RPC, devolve o link novo.
  - Ambas retornam `Resultado`, no padrão das actions existentes.

### UI

**`/signup`**
- Sem `?convite=` não vazio: `redirect('/login')` no server component.
- Com convite: formulário atual do caminho de convite (nome, email, senha —
  sem campo de empresa). O aviso "você foi convidado…" já existe.
- Validade real do token continua sendo julgada no aceite (`accept_invite`),
  como hoje — token inválido/expirado mostra a mensagem de erro no formulário.

**`/login`**
- O link "Criar uma conta" só aparece quando há `?convite=` na URL (hoje
  aparece sempre).

**`/admin` — página nova no grupo `(app)`**
- Guarda server-side: consulta se o usuário logado é dono da plataforma (via
  RPC leve `sou_dono_da_plataforma()` security definer, ou select equivalente);
  quem não é recebe `notFound()` — 404, a página não revela que existe.
- Não entra na barra lateral para os demais; para o dono, aparece um item
  "Admin".
- Conteúdo:
  - Formulário **nome da conta + email do cliente** → cria e mostra o link de
    convite com botão copiar.
  - Lista de contas (nome, criada em) com o estado do convite inicial
    (pendente/aceito/expirado) e botão **reemitir** quando pendente ou
    expirado.
- A listagem é servida por uma RPC `contas_da_plataforma()` (security definer,
  só dono) — o dono não tem membership nas contas, então RLS comum não o
  atende.

## O que não muda

- Login e logout.
- Fluxo de convites de equipe em Config → Usuários (admin do cliente convida
  o próprio time).
- Aceite de convite por usuário existente (`/login?convite=`).
- As duas contas reais existentes e seus usuários.

## Casos de borda

- **Email do cliente já tem usuário**: o link de convite funciona pelo caminho
  `/login?convite=` (fluxo existente); o `/signup?convite=` falharia no
  `signUp` com email duplicado, e o formulário mostra o erro — comportamento
  atual, aceitável.
- **Convite expirado antes do uso**: reemitir no `/admin`.
- **Convite pendente + segunda conta para o mesmo email**: permitido; convites
  são por conta.
- **Dev local**: `supabase/seed.sql` cria o usuário do Pedro no auth local
  (senha conhecida de dev) e a linha em `platform_owners` — sem isso o
  ambiente local não teria como criar contas depois desta mudança.

## Testes (TDD)

- `(auth)/acoes.test.ts`: `cadastrar` sem convite → `cadastro_fechado`; com
  convite segue o fluxo atual (specs existentes do caminho aberto morrem junto
  com o código).
- Actions do admin: validação de entrada, mapeamento de erros das RPCs
  (`sem_permissao`, `convite_ja_aceito`), montagem do link.
- Página `/admin`: 404 para não-dono; render para dono (mock da guarda).
- `/signup` sem token: redireciona.
- RPCs: exercitadas contra o banco local após a migration (criação de conta
  sem membership, convite gerado, guarda de permissão para usuário comum).

## Fora de escopo

- Troca de conta ativa / o dono ver os funis dos clientes.
- Recuperação de senha ("esqueci minha senha").
- Cobrança, planos, suspensão de conta.
- Remoção da RPC `criar_conta` (fica, restrita — o app não a chama mais, mas
  a restrição no banco é a guarda real).
