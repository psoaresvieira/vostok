import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_ESTADO, COOKIE_TOKEN, conferirEstado } from '@/lib/integracoes/estado-oauth'
import { metaGraph } from '@/lib/integracoes/fabrica'

export async function GET(req: NextRequest) {
  const jar = await cookies()
  const doCookie = jar.get(COOKIE_ESTADO)?.value
  const daUrl = req.nextUrl.searchParams.get('state')

  // O state morre na primeira tentativa, valida ou nao: sem isso ele vira um
  // segredo reutilizavel enquanto o cookie durar.
  jar.delete(COOKIE_ESTADO)

  if (!conferirEstado(doCookie, daUrl)) redirect('/config?meta=estado_invalido')

  // O usuario recusar a permissao no dialog e caminho normal, nao erro.
  if (req.nextUrl.searchParams.get('error')) redirect('/config?meta=recusado')

  const code = req.nextUrl.searchParams.get('code')
  if (!code) redirect('/config?meta=recusado')

  const troca = await metaGraph().trocarCodePorTokenLongo(
    code,
    process.env.META_REDIRECT_URI ?? '',
  )
  if (!troca.ok) redirect('/config?meta=indisponivel')

  // Token de USUARIO, nao de pagina. Vive 15 minutos, o suficiente para
  // escolher a Page na tela seguinte; o token da Page e buscado no servidor no
  // momento de conectar e vai direto para source_credentials.
  jar.set(COOKIE_TOKEN, troca.valor, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 900,
  })

  redirect('/config?meta=escolher')
}
