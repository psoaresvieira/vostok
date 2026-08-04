import { Client } from 'pg'
import { exigirHostLocal } from '../integration/helpers/guarda-host'
import { NUMERO_FALSO_PADRAO } from '@/lib/integracoes/whatsapp-falso'

/**
 * Achado do review final de branch: `npm run test:e2e` falhava na segunda
 * rodada sem `npx supabase db reset`. `integracoes.spec.ts` conecta as Pages
 * falsas 001 e 003 e nunca desconecta (só o teste da 002 é idempotente); o
 * índice único de `lead_sources` é GLOBAL (`0008:40`), então a segunda rodada
 * bate em `page_ja_conectada`, a fonte nunca renderiza, e o teste falha por um
 * motivo que não tem nada a ver com a mudança de quem estiver rodando.
 *
 * `globalSetup`, e não os testes desconectando ao fim, de proposito: sobrevive
 * a um teste que morre no meio (o dangling connect não fica pendurado
 * esperando um "afterEach" que nunca roda). Roda uma vez por invocação de
 * `playwright test`, antes de qualquer teste e antes do `webServer` aceitar
 * tráfego — não precisa de sessão nem de RLS, é conexão direta de operador
 * contra o Postgres local, no mesmo padrão de `tests/integration/helpers/db.ts`.
 */

// exigirHostLocal lanca se SUPABASE_DB_URL apontar para fora de
// 127.0.0.1/localhost — o delete abaixo por id fixo e destrutivo do mesmo
// jeito que limparBanco() em tests/integration/helpers/db.ts. Ver comentario
// completo em tests/integration/helpers/guarda-host.ts.
const CONN = exigirHostLocal(
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
)

/** As três Pages falsas fixas de `meta-falso.ts` (PAGINAS_PADRAO). */
const PAGE_IDS_FALSAS = ['100000000000001', '100000000000002', '100000000000003']

/**
 * Prefixo fixo que `ingestao.spec.ts` usa no nome de toda fonte Google que
 * cria (nome completo e `${PREFIXO_FONTE_GOOGLE_E2E}${carimbo()}`). Ao
 * contrario das Pages falsas do Meta, essas fontes nao colidem entre rodadas
 * — external_id fica nulo e o carimbo() garante nome unico — entao nao
 * IMPEDEM a suite de passar duas vezes seguidas. Apagamos mesmo assim: sem
 * isto cada `npm run test:e2e` deixa uma fonte Google orfa a mais no banco
 * local, para sempre.
 */
export const PREFIXO_FONTE_GOOGLE_E2E = 'Ingestão E2E '

/**
 * O numero que `disparo-whatsapp.spec.ts` conecta em /config — a CONSTANTE do
 * duplo, importada, e nunca o literal repetido: uma copia aqui sobreviveria
 * calada a uma troca do par padrao, e a limpeza passaria a apagar um numero que
 * ninguem mais usa. O sintoma so apareceria na SEGUNDA rodada da suite, na
 * conexao, com "numero ja conectado a outra conta" — longe da mudanca que o
 * causou.
 *
 * Mesmo motivo das Pages falsas acima: `whatsapp_connections_numero_idx` e
 * unico GLOBAL (0019:33), entao a segunda rodada bateria na conta que a rodada
 * ANTERIOR criou — nada a ver com a mudanca de quem estiver rodando.
 */
const PHONE_NUMBER_ID_FALSO = NUMERO_FALSO_PADRAO.phoneNumberId

export default async function globalSetup(): Promise<void> {
  const client = new Client({ connectionString: CONN })
  await client.connect()
  try {
    // on delete cascade em source_credentials.source_id cuida da credencial
    // junto — não precisa de segundo delete.
    await client.query(
      `delete from public.lead_sources where provedor = 'meta' and external_id = any($1)`,
      [PAGE_IDS_FALSAS],
    )
    await client.query(
      `delete from public.lead_sources where provedor = 'google' and nome like $1`,
      [`${PREFIXO_FONTE_GOOGLE_E2E}%`],
    )
    await client.query(`delete from public.whatsapp_connections where phone_number_id = $1`, [
      PHONE_NUMBER_ID_FALSO,
    ])
  } finally {
    await client.end()
  }
}
