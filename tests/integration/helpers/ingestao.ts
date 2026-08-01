import { comoServico } from './db'

// Segredo local de ingestao, compartilhado entre 0011_ingerir_lead.test.ts e
// 0013_rastreamento.test.ts. Antes vivia duplicado nos dois arquivos: um
// segundo caminho de leitura desse valor divergiria em silencio do outro.
export const SEGREDO = 'segredo-de-ingestao-local'

let contador = 0
/** Sufixo unico por chamada: varios casos disparam varias entregas na mesma conta. */
export function unico(prefixo: string): string {
  contador += 1
  return `${prefixo}-${contador}`
}

export type ResultadoEntrega = {
  log_id: string | null
  status: string
  token: string | null
  externalId: string
}

/** Cria uma fonte Meta direto nas tabelas — nao pela RPC, que muda na Task 10. */
export async function criarFonteMeta(
  c: { accountId: string },
  opts: { responsavelPadraoId?: string | null; ativo?: boolean } = {},
): Promise<{ sourceId: string; externalId: string }> {
  const externalId = unico('page')
  return comoServico(async (cli) => {
    const r = await cli.query<{ id: string }>(
      `insert into public.lead_sources (account_id, provedor, external_id, nome, responsavel_padrao_id, ativo)
       values ($1, 'meta', $2, $3, $4, $5) returning id`,
      [
        c.accountId,
        externalId,
        `Page ${externalId}`,
        opts.responsavelPadraoId ?? null,
        opts.ativo ?? true,
      ],
    )
    await cli.query(
      `insert into public.source_credentials (source_id, meta_page_token) values ($1, 'tok')`,
      [r.rows[0].id],
    )
    return { sourceId: r.rows[0].id, externalId }
  })
}

/** Chama registrar_entrega (Task 3) para gerar o log_id que ingerir_lead consome. */
export async function registrarEntrega(
  chaveDaFonte: string,
  payload: unknown = {},
  segredo = SEGREDO,
): Promise<ResultadoEntrega> {
  const externalId = unico('ext')
  return comoServico(async (cli) => {
    const r = await cli.query<{ resultado: Omit<ResultadoEntrega, 'externalId'> }>(
      `select public.registrar_entrega($1, 'meta', $2, $3, $4) as resultado`,
      [segredo, externalId, JSON.stringify(payload), chaveDaFonte],
    )
    return { ...r.rows[0].resultado, externalId }
  })
}
