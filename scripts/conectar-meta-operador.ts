/**
 * Modo operador (0030): conecta uma Page do Meta ao tenant de um cliente,
 * com token de System User do BM da Vostok. Uso:
 *
 *   npm run meta:conectar -- --env .env.prod --conta <account_id> --page <page_id> [--responsavel <user_id>] [--reivindicar]
 *
 * `.env.prod` = `vercel env pull .env.prod --environment=production` mais
 * OPERADOR_EMAIL, OPERADOR_SENHA e META_TOKEN_SYSTEM_USER. Nunca commitar
 * (use nome comecando com .env, coberto pelo .gitignore).
 *
 * META_API_VERSION e lida na CARGA de meta-real.ts, antes do dotenv abaixo:
 * o script usa o default do modulo (v21.0, o mesmo da Vercel). Para outra
 * versao, exporte a variavel no shell.
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { mensagemDeErro } from '@/app/(app)/config/erros'
import { codigo } from '@/lib/data/fontes'
import { envsObrigatorias, lerArgumentos } from '@/lib/integracoes/argumentos-operador'
import { conectarPaginaComoOperador } from '@/lib/integracoes/conectar-pagina-operador'
import { MetaGraphReal } from '@/lib/integracoes/meta-real'

function sair(erro: string): never {
  console.error(`erro: ${mensagemDeErro(erro)} (${erro})`)
  process.exit(1)
}

async function main() {
  const args = lerArgumentos(process.argv.slice(2))
  if (!args.ok) sair(args.erro)
  const a = args.valor

  // dotenv nao falha em arquivo inexistente (so devolve { error } e segue
  // com o process.env do shell) — sem esse cheque, um --env digitado errado
  // rodaria com envs de uma sessao anterior do terminal, silenciosamente.
  const carregado = config({ path: a.env, override: true, quiet: true })
  if (carregado.error) sair(`env_arquivo_nao_encontrado:${a.env}`)
  const envs = envsObrigatorias(process.env)
  if (!envs.ok) sair(envs.erro)
  const e = envs.valor

  const supabase = createClient(e.url, e.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await supabase.auth.signInWithPassword({ email: e.email, password: e.senha })
  if (login.error) {
    console.error(`login: ${login.error.message}`)
    sair('credenciais_invalidas')
  }

  // Falha fechado ANTES do Graph: a 0030 dispensa o dono de bater contra
  // account_sources quando p_responsavel e nulo, entao um --conta digitado
  // errado so estouraria no INSERT da RPC, depois de assinarLeadgen ja ter
  // rodado contra a Page real (assinar/desassinar deixa rastro numa Page de
  // cliente por um id que nao existe). contas_da_plataforma e RPC de dono
  // (a mesma de lib/data/plataforma.ts) — se ela falhar, quem logou nao e dono.
  const contas = await supabase.rpc('contas_da_plataforma')
  if (contas.error) {
    console.error(`contas_da_plataforma: ${contas.error.message}`)
    await supabase.auth.signOut()
    sair('sem_permissao')
  }
  const contaExiste = (contas.data as { conta_id: string }[] | null)?.some((c) => c.conta_id === a.conta)
  if (!contaExiste) {
    await supabase.auth.signOut()
    sair('conta_nao_encontrada')
  }

  const rpc = a.reivindicar ? 'reivindicar_fonte_meta' : 'conectar_fonte_meta'
  const r = await conectarPaginaComoOperador({
    // appId/appSecret so sao usados por trocarCodePorTokenLongo (OAuth), que
    // este script nunca chama: a orquestracao aqui so usa listarPaginas,
    // posseDaPagina, assinarLeadgen e desassinarLeadgen. Por isso strings
    // vazias sao seguras. Se algum dia entrar aqui uma chamada ao Graph que
    // precise delas, elas precisam entrar em envsObrigatorias.
    graph: new MetaGraphReal(process.env.META_APP_ID ?? '', process.env.META_APP_SECRET ?? ''),
    pageId: a.page,
    tokenDoUsuario: e.tokenMeta,
    reivindicar: a.reivindicar,
    gravar: async (pagina) => {
      const { data, error } = await supabase.rpc(rpc, {
        p_segredo: e.segredo,
        p_account_id: a.conta,
        p_page_id: pagina.id,
        p_nome: pagina.nome,
        p_token: pagina.token,
        p_responsavel: a.responsavel,
      })
      if (error) return { ok: false as const, erro: codigo(error) }
      return { ok: true as const, valor: data as string }
    },
  })
  await supabase.auth.signOut()
  if (!r.ok) sair(r.erro)
  console.log(`conectada: source_id=${r.valor} page=${a.page} conta=${a.conta}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
