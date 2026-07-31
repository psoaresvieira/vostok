import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ROTAS_PUBLICAS = [
  '/login',
  '/signup',
  '/convite',
  // Webhook nao tem sessao por definicao: quem chama e o Meta, o Google ou o
  // cron da Vercel, nunca um navegador logado. "Publico no middleware" aqui
  // significa so "nao passa pelo portao de sessao" -- nunca "nao autenticado".
  // A autorizacao real de cada rota de webhook e outra e mais forte: HMAC no
  // Meta (assinaturaValida, ver src/lib/ingestao/hmac.ts), token secreto na
  // URL no Google, e CRON_SECRET no reprocessamento. Sem esta entrada, um
  // POST do Meta sem cookie de sessao era redirecionado para /login antes de
  // chegar no route handler; o Meta trata o redirect como falha de entrega e,
  // apos reprovacoes repetidas, desinscreve o app da Page.
  '/api/webhooks',
]

export async function middleware(request: NextRequest) {
  let resposta = NextResponse.next({ request })

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

  const caminho = request.nextUrl.pathname
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
