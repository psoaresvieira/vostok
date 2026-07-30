import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { COOKIE_ESTADO, COOKIE_TOKEN, conferirEstado } from '@/lib/integracoes/estado-oauth'
import { metaGraph } from '@/lib/integracoes/fabrica'

export async function GET(req: NextRequest) {
  // O cookie de state prova so que UMA sessao de admin existia quando o
  // dialogo do Facebook comecou — nunca que ainda existe, nem que e a mesma.
  // Cenario sem exploit, so troca de sessao: admin A completa o dialogo numa
  // maquina compartilhada e sai sem escolher a Page; o COOKIE_TOKEN fica com
  // o token de usuario de A por 15 minutos; se o usuario B entrar no mesmo
  // navegador dentro da janela, nada aqui provava que o token nao era de B —
  // a Task 7 listaria as Pages de A para B conectar no tenant errado. Por
  // isso este check vem antes de qualquer outra coisa, igual a rota de
  // inicio ja faz.
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) redirect('/login')

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
  //
  // Prefixo `${conta.id}:` amarra o token a identidade do CRM, e nao so ao
  // navegador: o check de admin acima prova a sessao no INICIO deste
  // handler, mas quem LE o cookie depois (Task 7) roda numa request
  // diferente, sem garantia nenhuma de que e a mesma sessao. O consumidor
  // tem que separar o prefixo, comparar com a conta ativa dele, e recusar o
  // cookie inteiro se as contas nao baterem — cookie de conta errada e
  // cookie invalido, nao "confia e tenta".
  jar.set(COOKIE_TOKEN, `${contexto.valor.conta.id}:${troca.valor}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 900,
  })

  redirect('/config?meta=escolher')
}
