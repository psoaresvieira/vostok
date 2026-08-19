import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ROTAS_PUBLICAS = [
  '/login',
  '/signup',
  '/convite',
  // O painel do Meta exige a URL da politica de privacidade publica e a valida
  // sem sessao; atras do portao, o Login do Facebook fica "indisponivel".
  '/privacidade',
  // Webhook nao tem sessao por definicao: quem chama e o Meta, o Google ou o
  // cron da Vercel, nunca um navegador logado. "Publico no middleware" aqui
  // significa so "nao passa pelo portao de sessao" -- nunca "nao autenticado".
  // A autorizacao real de cada rota de webhook e outra e mais forte: HMAC no
  // Meta (assinaturaValida, ver src/lib/ingestao/hmac.ts), token secreto na
  // URL no Google, e CRON_SECRET no reprocessamento. Sem esta entrada, um
  // POST do Meta sem cookie de sessao era redirecionado para /login antes de
  // chegar no route handler; o Meta trata o redirect como falha de entrega e,
  // apos reprovacoes repetidas, desinscreve o app da Page.
  '/api/webhooks/',
]

/**
 * Rotas que nao tem sessao NENHUMA a renovar — os webhooks. Quem chama e' o
 * Meta, o Google ou o cron da Vercel, com HMAC/token/segredo e sem cookie.
 *
 * Vale a distincao porque `auth.getUser()` abaixo nao le cookie local: e' um
 * round-trip HTTP ao GoTrue para validar o token. Numa rajada de entregas do
 * Meta isso era uma chamada de rede por webhook, para um usuario que nao
 * existe e uma resposta que ninguem usa — o handler autoriza por HMAC e
 * autentica no banco com o cliente anon+segredo, nunca pela sessao.
 *
 * As outras rotas publicas (/login, /signup, /privacidade, /convite) NAO
 * entram aqui de proposito: por elas passa navegador com cookie, e e'
 * justamente `getUser()` no middleware que renova o token antes de ele vencer.
 */
const ROTAS_SEM_SESSAO = ['/api/webhooks/']

export async function middleware(request: NextRequest) {
  let resposta = NextResponse.next({ request })

  const caminho = request.nextUrl.pathname
  if (ROTAS_SEM_SESSAO.some((r) => caminho.startsWith(r))) return resposta

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          resposta = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            resposta.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const publica = ROTAS_PUBLICAS.some((r) => caminho.startsWith(r))

  if (!user && !publica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return resposta
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
