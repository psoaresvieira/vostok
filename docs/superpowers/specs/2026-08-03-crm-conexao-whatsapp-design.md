# Conexão do WhatsApp + autoatendimento beta — design

**Data:** 2026-08-03
**Estado:** aprovado no brainstorming, pronto para virar plano
**Irmãs:** `2026-07-29-crm-ingestao-webhooks-design.md` (define `lead_sources`/`source_credentials`, cujo padrão este design replica) · o futuro design do sub-projeto 5 (disparo), que consome o contrato da §4.3

## 1. O problema

O sub-projeto 5 (disparo de WhatsApp) precisa de uma credencial do WhatsApp Cloud API por conta — e não existe lugar para ela nascer. E a tela de integrações, que já conecta Meta (OAuth → Page) e Google (URL secreta), recebe o cliente beta com um erro cru do Facebook quando ele tenta o OAuth antes do App Review passar.

## 2. Decisões do brainstorming

| Pergunta | Escolha |
|---|---|
| Fronteira com o sub-projeto 5 | Este design cobre a **conexão** dos três provedores; o disparo (template, envio, webhook de resposta) fica inteiro no sub-projeto 5, que encontra a credencial pronta |
| Mecanismo de conexão do WhatsApp no MVP | **Colar credencial** (token de System User + `phone_number_id` + `waba_id`); Embedded Signup fica para depois do App Review, como caminho futuro nomeado e não desenhado |
| Cliente externo no Meta antes do App Review | **Mensagem honesta + onboarding concierge** (nota beta ligada por env var; operador convida como tester) — sem UI descartável |
| Modelagem | **Tabelas próprias** (`whatsapp_connections` + credencial gêmea sem grant). WhatsApp não é fonte de lead: entrar no enum `provedor_lead` contaminaria os caminhos de ingestão que ramificam por provedor |
| Números por conta | **Um** (unique em `account_id`) — limitação declarada do MVP |

Alternativas recusadas com custo comparado: reusar `lead_sources` com `provedor = 'whatsapp'` (menos DDL, mas o enum é castado para `lead_origem` na ingestão e o índice único global de `external_id` passaria a servir dois significados); tabela genérica `channel_connections` (YAGNI — um canal de saída no horizonte).

## 3. O que já existe e não muda

- Meta lead ads: OAuth → escolher Page → responsável padrão, com reivindicação de squat. Intacto.
- Google: URL secreta + chave de uso único. Já é autosserviço para qualquer cliente (não depende de review). Intacto.
- O padrão de credencial: tabela gêmea **sem grant**, escrita só por RPC `security definer` que exige o **segredo de ingestão** (o servidor prova que é ele — decisão do Plano 4, Task 10). Este design o replica, não o reinventa.

## 4. Banco — migration `0019`

### 4.1 Tabelas

`whatsapp_connections`: `id`, `account_id` (**unique**, FK cascade — um número por conta), `phone_number_id` (**unique global**), `waba_id`, `numero_exibicao`, `nome_verificado`, `criado_em`, `atualizado_em`.

O unique global de `phone_number_id` existe **agora** porque o webhook de resposta (fase 2 do sub-projeto 5) resolve a conta pelo número: dois tenants com o mesmo número seria ambiguidade sem desempate. Falhar na conexão com mensagem clara é melhor que decidir depois.

`whatsapp_credentials`: `connection_id` (PK, FK cascade), `token`, `atualizado_em`. **Nenhum grant, RLS ligada sem policy** — cinto e suspensório, como `source_credentials`: um grant acidental numa migration futura não pode abrir a tabela. Se o token fosse coluna da tabela de cima, qualquer `select *` da tela o traria para o payload RSC.

Em `whatsapp_connections`: grant só de `select` para `authenticated`, policy admin-only (`papel_na_conta(account_id) = 'admin'`), como `lead_sources_admin_select`. Insert e delete não têm grant — passam pelas RPCs.

### 4.2 RPCs — todas `security definer`, todas exigindo o segredo de ingestão

`security definer` aqui é o padrão certo (o inverso do Plano 8, e pelos mesmos critérios): as tabelas de credencial não têm grant nenhum, então `invoker` não alcançaria nada; o que escopa é o segredo + a checagem explícita de papel dentro do corpo.

- **`conectar_whatsapp(p_segredo, p_account_id, p_phone_number_id, p_waba_id, p_numero_exibicao, p_nome_verificado, p_token)`** — valida segredo, sessão, admin da conta, campos não-vazios (`btrim`), e insere as duas linhas na mesma transação. Traduções: conta que já tem número → `whatsapp_ja_conectado`; `unique_violation` do número global → `numero_ja_conectado`. Nunca nome de índice cru.
- **`desconectar_whatsapp(p_segredo, p_connection_id)`** — segredo + admin da conta dona; a credencial cai pelo cascade.
- **`credencial_whatsapp(p_segredo, p_account_id)`** — devolve `token`, `phone_number_id` e `waba_id`. **É o contrato do sub-projeto 5.** Sem sessão envolvida: quem chama é o servidor (Server Action do disparo), que se identifica pelo segredo — sem esta RPC, o token teria que ser alcançável por sessão de vendedor, que é exatamente o que a tabela sem grant impede.

Códigos novos, todos traduzidos em `config/erros.ts`: `whatsapp_ja_conectado`, `numero_ja_conectado`, `token_whatsapp_invalido`, `whatsapp_indisponivel` (os dois últimos vêm da validação da §5, não do banco).

### 4.3 O que fica explicitamente fora

Nenhuma coluna de template, status de envio ou webhook. O sub-projeto 5 traz as suas.

## 5. Porta `WhatsAppGraph`

Um método: `dadosDoNumero(token, phoneNumberId): Promise<Resultado<{ numeroExibicao: string; nomeVerificado: string }>>`, via `GET /{phone_number_id}?fields=display_phone_number,verified_name`.

Implementação real + falsa, escolhidas pela mesma fábrica de `lib/integracoes` (`META_FAKE`) — **nenhum teste automatizado toca rede**, como no resto do repo. A falsa registra chamadas para os testes afirmarem sobre o estado do duplo, no padrão de `MetaGraphFalso.listadas`.

A Server Action de conectar valida **antes** de gravar: chama `dadosDoNumero` com o que o usuário colou; token que não lê o número → `token_whatsapp_invalido`, Graph fora do ar → `whatsapp_indisponivel`, e nada é gravado. `numero_exibicao` e `nome_verificado` gravados vêm **da resposta do Graph**, nunca do formulário. O `waba_id` é colado e não é validável por esta chamada (o Graph do número não o devolve) — vai como o usuário deu, e o sub-projeto 5 o prova de verdade na submissão de template.

É o padrão `posseDaPagina`, com a mesma honestidade sobre o limite: a validação prova que o token **lê** o número — não que envia mensagem. Quem prova envio é o sub-projeto 5.

## 6. Tela

Bloco novo "WhatsApp" na seção Integrações de `/config` (admin-only como a seção inteira):

- **Desconectado:** três campos — token, `phone_number_id`, `waba_id` — e "Conectar". Texto curto dizendo onde encontrar os três no painel do Meta.
- **Conectado:** card com `numero_exibicao`, `nome_verificado` e `waba_id`, e "Desconectar" com confirmação. **O token nunca volta à tela** depois de gravado — mesmo contrato do segredo do Google ("copie agora, não mostramos de novo", exceto que aqui nem o "agora" existe: o usuário já o tem, foi ele quem colou).
- Trocar de número no MVP = desconectar e conectar de novo.

Toda ação passa por `chamarAcao`; todo código de erro pelo mapa de `config/erros.ts`.

## 7. Beta do Meta — a nota e o runbook

Env `META_MODO_BETA` (ausente = desligada). Ligada, a tela renderiza uma nota fixa junto ao botão "Conectar Facebook": conexão liberada por convite durante o beta, com o canal de contato. Desligada (dia em que o App Review passar), a nota some — nenhuma UI descartável, nenhum estado novo.

O README ganha o runbook do operador: adicionar o usuário do cliente como tester no painel do Meta, o que ele precisa aceitar, e o que acompanhar na primeira conexão. O Embedded Signup (autoatendimento real do WhatsApp, popup do Meta que cria WABA e devolve token) fica **nomeado como caminho pós-App-Review e não desenhado** — depende do onboarding de Tech Provider, cujos detalhes mudam até lá.

## 8. Testes

**Integração contra Postgres real:** credencial inalcançável por `authenticated` (permission denied, não zero linhas); segredo errado recusa nas três RPCs; vendedor recusado (`sem_permissao`) com o estado sobrevivendo; admin de outra conta não desconecta o que não é dele; `whatsapp_ja_conectado` e `numero_ja_conectado` cada um com o caso que passa e o que recusa, e a linha original intacta depois da recusa; `credencial_whatsapp` devolve o que `conectar_whatsapp` gravou.

**Unidade:** a porta falsa (incluindo o registro de chamadas) e qualquer mapeador puro que o plano introduza.

**Componente:** o bloco nos dois estados; recusa com mensagem traduzida; a nota beta aparecendo só com a env ligada.

**Verificação manual, bloqueada em credencial real** (entra na §9 do progresso junto com as outras): `conectar_whatsapp` contra o Graph real com um número da SE7E — o teste automatizado prova que chamamos o endpoint certo, não que o Meta responde como presumimos.

Todo teste novo com RED demonstrado. Nenhuma contagem de teste neste documento.

## 9. Riscos aceitos

1. **Token em claro no banco** — mesmo status do `meta_page_token`, aceito conscientemente; criptografia de coluna é design próprio se um dia doer.
2. **Um número por conta** — limitação declarada; a coluna unique torna o dia de relaxá-la uma migration, não uma reescrita.
3. **`waba_id` entra sem validação** — o Graph do número não o devolve; a submissão de template (sub-projeto 5) é quem o prova.
4. **A validação de conexão não prova capacidade de envio** — prova leitura. Registrado na tela? Não: seria explicar limitação de implementação ao usuário; o envio real é provado a um sub-projeto de distância.

## 10. Critério de aceite

Um admin abre `/config`, cola token, `phone_number_id` e `waba_id` de um número da SE7E, e o card passa a mostrar o número e o nome verificado que o **Meta** devolveu. Cola um token errado e nada é gravado, com mensagem clara. Uma segunda conta do CRM tenta conectar o mesmo número e é recusada dizendo por quê. Um vendedor não vê o bloco, e nenhuma sessão — nem de admin — alcança o token pelo PostgREST. Com `META_MODO_BETA` ligada, a nota do beta aparece junto ao botão do Facebook; desligada, some. E o sub-projeto 5, quando chegar, lê a credencial por `credencial_whatsapp` sem precisar de nenhuma migration nova.
