import { ok, falha, type Resultado } from '@/lib/domain/resultado'
import { clienteDoServidor } from './sessao'

/** Uma conta vista pelo dono da plataforma, com o convite inicial (se houver). */
export type ContaDaPlataforma = {
  id: string
  nome: string
  criadoEm: Date
  convite: { id: string; email: string; expiraEm: Date; aceitoEm: Date | null } | null
}

type LinhaDaRpc = {
  conta_id: string
  nome: string
  criado_em: string
  convite_id: string | null
  convite_email: string | null
  convite_expira_em: string | null
  convite_aceito_em: string | null
}

// Mesmo artificio de aceitarConvite em (auth)/acoes.ts: o postgres embrulha o
// raise exception em prefixos variados, entao procuramos o codigo na mensagem.
const CODIGOS = [
  'sem_sessao',
  'sem_permissao',
  'entrada_invalida',
  'convite_invalido',
  'convite_ja_aceito',
] as const

function codigoDeErro(mensagem: string): string {
  for (const codigo of CODIGOS) if (mensagem.includes(codigo)) return codigo
  return mensagem
}

/** False em qualquer erro: uma guarda que falha aberta nao e' guarda. */
export async function souDonoDaPlataforma(): Promise<boolean> {
  const cliente = await clienteDoServidor()
  const { data, error } = await cliente.rpc('sou_dono_da_plataforma')
  if (error) return false
  return data === true
}

export async function criarContaCliente(nome: string, email: string): Promise<Resultado<string>> {
  const cliente = await clienteDoServidor()
  const { data, error } = await cliente.rpc('criar_conta_cliente', {
    p_nome: nome,
    p_email: email,
  })
  if (error) return falha(codigoDeErro(error.message))
  return ok(data as string)
}

export async function reemitirConvite(conviteId: string): Promise<Resultado<string>> {
  const cliente = await clienteDoServidor()
  const { data, error } = await cliente.rpc('reemitir_convite', { p_convite: conviteId })
  if (error) return falha(codigoDeErro(error.message))
  return ok(data as string)
}

export async function contasDaPlataforma(): Promise<Resultado<ContaDaPlataforma[]>> {
  const cliente = await clienteDoServidor()
  const { data, error } = await cliente.rpc('contas_da_plataforma')
  if (error) return falha(error.message)
  return ok(
    ((data ?? []) as LinhaDaRpc[]).map((l) => ({
      id: l.conta_id,
      nome: l.nome,
      criadoEm: new Date(l.criado_em),
      convite:
        l.convite_id && l.convite_email && l.convite_expira_em
          ? {
              id: l.convite_id,
              email: l.convite_email,
              expiraEm: new Date(l.convite_expira_em),
              aceitoEm: l.convite_aceito_em ? new Date(l.convite_aceito_em) : null,
            }
          : null,
    })),
  )
}
