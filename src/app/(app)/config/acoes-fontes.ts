'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { criarFonteStoreDoServidor, type FonteStore } from '@/lib/data/fontes'
import { COOKIE_TOKEN } from '@/lib/integracoes/estado-oauth'
import { metaGraph } from '@/lib/integracoes/fabrica'
import type { PaginaDoMeta } from '@/lib/integracoes/meta'

export type PaginaOferecida = { id: string; nome: string }

/**
 * A Task 6 grava o COOKIE_TOKEN como `${conta.id}:${token}`, nao so o token.
 * Sem separar e conferir o prefixo aqui, um cookie deixado por OUTRA sessao
 * de admin no mesmo navegador (troca de sessao numa maquina compartilhada,
 * dentro da janela de 15 minutos) seria aceito de olhos fechados, e listaria
 * ou conectaria as Pages de quem nao e o admin desta requisicao. Cookie de
 * conta errada e cookie invalido, nao "confia e tenta" — por isso devolve
 * `null` e nao so o token cru.
 *
 * Recebe o jar e nao so o valor porque, ao recusar, ele **apaga** o cookie. Sem
 * isso o token de usuario do Meta de outro admin fica pegando carona em todo
 * request pelo resto dos 15 minutos, ja tendo sido reconhecido como imprestavel.
 *
 * A comparacao e `!==` simples de proposito. `conta.id` e identificador, nao
 * segredo portador, e o cookie e `httpOnly` — nao ha segredo cujo prefixo um
 * canal de tempo pudesse revelar aqui. Nao troque por comparacao de tempo
 * constante achando que e endurecimento; seria ruido.
 */
function tokenDaConta(jar: Awaited<ReturnType<typeof cookies>>, contaId: string): string | null {
  const valorDoCookie = jar.get(COOKIE_TOKEN)?.value
  if (!valorDoCookie) return null

  const recusar = () => {
    jar.delete(COOKIE_TOKEN)
    return null
  }

  const i = valorDoCookie.indexOf(':')
  // Sem `:` e cookie do formato antigo, anterior a amarracao por conta. Falha
  // fechado: melhor mandar reconectar do que adivinhar de quem e o token.
  if (i < 0) return recusar()
  const conta = valorDoCookie.slice(0, i)
  // `slice` a partir do primeiro `:`, e nao `split`, para que token com `:`
  // dentro chegue inteiro.
  const token = valorDoCookie.slice(i + 1)
  if (conta !== contaId || !token) return recusar()
  return token
}

/**
 * Lista as Pages sem o token de cada uma. O token e segredo de servidor: se
 * fosse devolvido aqui, iria para o payload RSC e para o HTML.
 */
export async function listarPaginasDoMetaAction(): Promise<Resultado<PaginaOferecida[]>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const jar = await cookies()
  // Mesmo codigo de erro para "sem cookie" e "cookie de outra conta" de
  // proposito: distinguir os dois na tela vazaria que outra sessao esteve
  // ativa neste navegador.
  const token = tokenDaConta(jar, contexto.valor.conta.id)
  if (!token) return falha('conexao_expirada')

  const r = await metaGraph().listarPaginas(token)
  if (!r.ok) return falha(r.erro)
  return ok(r.valor.map((p) => ({ id: p.id, nome: p.nome })))
}

/**
 * Sequencia comum a conectar e a reivindicar: as duas sao a mesma acao
 * ("gravar esta Page para mim"), diferindo so em qual RPC grava por baixo —
 * `conectarMeta` recusa dono anterior, `reivindicarMeta` o substitui. Extrair
 * o corpo evita que a prova de posse (o ponto inteiro da Task 10) precise ser
 * copiada e mantida igual em dois lugares.
 *
 * `gravar` recebe a Page ja resolvida contra o Graph (id e token verdadeiros,
 * nunca o que o cliente mandou) e devolve o Resultado da RPC especifica.
 *
 * `ehReivindicacao` diferencia as duas so para decidir a compensacao (ver
 * abaixo, no ramo de falha de `gravar`) — em tudo mais as duas acoes sao
 * identicas.
 */
async function conectarOuReivindicar(
  pageId: string,
  ehReivindicacao: boolean,
  gravar: (fontes: FonteStore, pagina: PaginaDoMeta) => Promise<Resultado<string>>,
): Promise<Resultado<void>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const jar = await cookies()
  const token = tokenDaConta(jar, contexto.valor.conta.id)
  if (!token) return falha('conexao_expirada')

  // Achado 1 do review (rodada 1) da Task 10, parte 3: falhar ANTES de tocar
  // o Graph quando o segredo de ingestao nao esta configurado. Sem isto, um
  // deploy que subiu sem INGESTAO_SEGREDO faz `segredo_confere` (0010) falhar
  // fechado em TODA chamada de `gravar` la na frente — e como `assinarLeadgen`
  // ja teria rodado antes dessa falha, cada clique em Conectar assinaria e
  // depois desassinaria a Page de um terceiro, na cara de quem so via
  // "a ingestao nao esta configurada" na tela. Mesmo codigo que
  // `criarIngestaoStore` (lib/data/ingestao.ts) ja usa para o mesmo problema
  // visto do lado do webhook.
  if ((process.env.INGESTAO_SEGREDO ?? '').length === 0) return falha('ingestao_nao_configurada')

  // Buscar de novo em vez de confiar no que veio do cliente: o token da Page
  // nunca passou pelo navegador, e o nome tambem vem da fonte da verdade.
  const paginas = await metaGraph().listarPaginas(token)
  if (!paginas.ok) return falha(paginas.erro)
  const pagina = paginas.valor.find((p) => p.id === pageId)
  if (!pagina) return falha('pagina_nao_encontrada')

  // Prova de posse ANTES de qualquer escrita ou assinatura — a metade da
  // aplicacao do fechamento do squat (Task 10). A migration 0012 tira a RPC
  // do alcance de quem so tem sessao valida; isto aqui prova, contra o Graph,
  // que quem chama de fato administra esta Page. Sem isto a acao confiaria
  // cegamente no pageId que veio do clique, exatamente o buraco que a 0012
  // fechou do lado do banco. Forward do erro original (nao um codigo fixo):
  // pode ser `posse_nao_comprovada` (id nao bate) ou `meta_indisponivel`
  // (Graph fora do ar), e sao mensagens diferentes na tela.
  const posse = await metaGraph().posseDaPagina(pagina.id, pagina.token)
  if (!posse.ok) return falha(posse.erro)

  // Assinar ANTES de gravar: uma fonte gravada sem inscricao em leadgen nunca
  // receberia webhook, e a tela diria que esta tudo certo.
  const assinou = await metaGraph().assinarLeadgen(pagina.id, pagina.token)
  if (!assinou.ok) return falha(assinou.erro)

  const r = await gravar(contexto.valor.fontes, pagina)
  if (!r.ok) {
    // Achado 1 do review (rodada 1) da Task 10, partes 1 e 2: a compensacao
    // so desfaz a assinatura quando ESTA CHAMADA e quem a criou.
    // `assinarLeadgen` e idempotente do lado do Meta — se a Page ja estava
    // inscrita antes de chegarmos aqui, a chamada acima nao criou nada, e
    // desassinar incondicionalmente derrubaria uma inscricao que pertence a
    // outra conta (o dono legitimo, ou o incumbente que a reivindicacao vai
    // substituir), sem nada ficar vermelho em lugar nenhum — a mesma escalada
    // de negacao de servico para roubo de lead que a compensacao existe para
    // evitar, so que mirada na vitima. Dois casos em que a assinatura nunca e
    // "desta chamada":
    //   1. `ehReivindicacao`: a premissa inteira de reivindicar e que a Page
    //      ja tem dono, entao ela ja estava inscrita antes deste clique.
    //   2. `r.erro === 'page_ja_conectada'`: esse codigo SO existe porque a
    //      Page ja pertencia a outra conta antes desta chamada — e prova
    //      disso, nao suposicao.
    // NAO troque por incondicional achando que e simplificacao: e o buraco
    // que este achado fechou.
    const assinaturaEraDestaChamada = !ehReivindicacao && r.erro !== 'page_ja_conectada'
    if (assinaturaEraDestaChamada) {
      // Best-effort: se a desinscricao tambem falhar, o erro original de
      // `gravar` e o que importa para quem esta na tela.
      await metaGraph().desassinarLeadgen(pagina.id, pagina.token)
    }
    return falha(r.erro)
  }

  jar.delete(COOKIE_TOKEN)
  revalidatePath('/config')
  return ok(undefined)
}

export async function conectarPaginaAction(pageId: string): Promise<Resultado<void>> {
  return conectarOuReivindicar(pageId, false, (fontes, pagina) =>
    fontes.conectarMeta(pagina.id, pagina.nome, pagina.token, null),
  )
}

/**
 * O caminho que o portao de deploy do README exige: quem prova posse contra
 * o Graph toma a linha de quem estava la antes, inclusive de outra conta. E
 * a unica saida para uma Page squattada antes da migration 0012 existir —
 * antes desta acao, a vitima nao tinha recurso nenhum.
 */
export async function reivindicarPaginaAction(pageId: string): Promise<Resultado<void>> {
  return conectarOuReivindicar(pageId, true, (fontes, pagina) =>
    fontes.reivindicarMeta(pagina.id, pagina.nome, pagina.token, null),
  )
}

export type SegredoDoGoogle = { url: string; chave: string }

export async function conectarGoogleAction(
  nome: string,
  origem: string,
): Promise<Resultado<SegredoDoGoogle>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)
  const limpo = nome.trim()
  if (!limpo) return falha('nome_obrigatorio')

  const r = await contexto.valor.fontes.conectarGoogle(limpo, null)
  if (!r.ok) return falha(r.erro)

  revalidatePath('/config')
  return ok({
    url: `${origem}/api/webhooks/google/${r.valor.urlToken}`,
    chave: r.valor.googleKey,
  })
}

export async function definirResponsavelAction(
  sourceId: string,
  responsavelId: string | null,
): Promise<Resultado<void>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.fontes.definirResponsavel(sourceId, responsavelId)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}

export async function desconectarFonteAction(sourceId: string): Promise<Resultado<void>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const r = await contexto.valor.fontes.desconectar(sourceId)
  if (!r.ok) return falha(r.erro)
  revalidatePath('/config')
  return ok(undefined)
}
