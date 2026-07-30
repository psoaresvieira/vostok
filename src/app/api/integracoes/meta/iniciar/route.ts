import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { COOKIE_ESTADO, gerarEstado } from '@/lib/integracoes/estado-oauth'
import { usarFalso } from '@/lib/integracoes/fabrica'

const VERSAO = process.env.META_API_VERSION ?? 'v21.0'

/**
 * pages_show_list para listar as Pages, pages_manage_metadata para inscrever o
 * app no campo leadgen, leads_retrieval para buscar o lead depois. Menos que
 * isso quebra o Plano 4; mais que isso atrasa o App Review sem beneficio.
 */
const ESCOPOS = ['pages_show_list', 'pages_manage_metadata', 'leads_retrieval'].join(',')

export async function GET() {
  // Rota publica por definicao: quem exige a sessao de admin e este check.
  const contexto = await criarAdminStoreDoServidor()
  if (!contexto.ok) redirect('/login')

  const estado = gerarEstado()
  const jar = await cookies()
  jar.set(COOKIE_ESTADO, estado, {
    httpOnly: true,
    sameSite: 'lax', // 'strict' nao sobrevive ao retorno vindo de facebook.com
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  // Em teste nao existe facebook.com: pula direto para o retorno, que e o
  // trecho do fluxo que o codigo do CRM realmente controla.
  // Usa o mesmo predicado da fabrica de proposito. Se esta rota desviasse para
  // o retorno falso enquanto metaGraph() devolvesse a implementacao real, o
  // fluxo quebraria no meio — duas copias da condicao e como elas divergem.
  if (usarFalso()) {
    redirect(`/api/integracoes/meta/retorno?code=code-falso&state=${estado}`)
  }

  const url = new URL(`https://www.facebook.com/${VERSAO}/dialog/oauth`)
  url.searchParams.set('client_id', process.env.META_APP_ID ?? '')
  url.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI ?? '')
  url.searchParams.set('state', estado)
  url.searchParams.set('scope', ESCOPOS)
  url.searchParams.set('response_type', 'code')
  redirect(url.toString())
}
