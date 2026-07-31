'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { criarFonteStoreDoServidor } from '@/lib/data/fontes'
import { COOKIE_TOKEN } from '@/lib/integracoes/estado-oauth'
import { metaGraph } from '@/lib/integracoes/fabrica'

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

export async function conectarPaginaAction(pageId: string): Promise<Resultado<void>> {
  const contexto = await criarFonteStoreDoServidor()
  if (!contexto.ok) return falha(contexto.erro)

  const jar = await cookies()
  const token = tokenDaConta(jar, contexto.valor.conta.id)
  if (!token) return falha('conexao_expirada')

  // Buscar de novo em vez de confiar no que veio do cliente: o token da Page
  // nunca passou pelo navegador, e o nome tambem vem da fonte da verdade.
  const paginas = await metaGraph().listarPaginas(token)
  if (!paginas.ok) return falha(paginas.erro)
  const pagina = paginas.valor.find((p) => p.id === pageId)
  if (!pagina) return falha('pagina_nao_encontrada')

  // Assinar ANTES de gravar: uma fonte gravada sem inscricao em leadgen nunca
  // receberia webhook, e a tela diria que esta tudo certo.
  const assinou = await metaGraph().assinarLeadgen(pagina.id, pagina.token)
  if (!assinou.ok) return falha(assinou.erro)

  const r = await contexto.valor.fontes.conectarMeta(pagina.id, pagina.nome, pagina.token, null)
  if (!r.ok) {
    // Compensa a assinatura de `:88`. Sem isto, o dono legitimo de uma Page
    // squattada por outra conta (o caso realista de `page_ja_conectada` aqui)
    // clica em Conectar, a assinatura em leadgen sobe, a gravacao falha, e a
    // acao devolve o erro deixando a Page real inscrita — a mesma escalada de
    // negacao de servico para roubo de lead que a spec nomeia (ver "Risco
    // nomeado: squat de Page ID"), so que iniciada por quem tem toda razao de
    // clicar em Conectar. Best-effort: se a desinscricao tambem falhar, o erro
    // original de conectarMeta e o que importa para quem esta na tela.
    await metaGraph().desassinarLeadgen(pagina.id, pagina.token)
    return falha(r.erro)
  }

  jar.delete(COOKIE_TOKEN)
  revalidatePath('/config')
  return ok(undefined)
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
