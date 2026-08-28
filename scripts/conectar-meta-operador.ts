/**
 * Modo operador (0030): conecta uma Page do Meta ao tenant de um cliente,
 * com token de System User do BM da Vostok. Uso:
 *
 *   npm run meta:conectar -- --env prod.env --conta <account_id> --page <page_id> [--responsavel <user_id>] [--reivindicar]
 *
 * `prod.env` = `vercel env pull prod.env --environment=production` mais
 * OPERADOR_EMAIL, OPERADOR_SENHA e META_TOKEN_SYSTEM_USER. Nunca commitar
 * (.gitignore ja cobre `.env*`; use nome terminado em .env).
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

  config({ path: a.env, override: true })
  const envs = envsObrigatorias(process.env)
  if (!envs.ok) sair(envs.erro)
  const e = envs.valor

  const supabase = createClient(e.url, e.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const login = await supabase.auth.signInWithPassword({ email: e.email, password: e.senha })
  if (login.error) sair('credenciais_invalidas')

  const rpc = a.reivindicar ? 'reivindicar_fonte_meta' : 'conectar_fonte_meta'
  const r = await conectarPaginaComoOperador({
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
