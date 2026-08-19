import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarAdminStoreDoServidor } from '@/lib/data/admin'
import { criarFonteStoreDoServidor } from '@/lib/data/fontes'
import { criarWhatsAppStoreDoServidor } from '@/lib/data/whatsapp'
import { Motivos } from './motivos'
import { Usuarios } from './usuarios'
import { Integracoes } from './integracoes'
import { WhatsApp } from './whatsapp'

/** Quantas entregas recentes o painel de diagnostico de Integracoes mostra. */
const LIMITE_ENTREGAS = 20

export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string }>
}) {
  const { meta } = await searchParams

  const contexto = await criarStoreDoServidor()
  if (!contexto.ok) redirect('/login')
  if (contexto.valor.papel !== 'admin') {
    return <p className="p-6 text-sm">Só administradores acessam a configuração.</p>
  }

  // Os tres em paralelo: cada um resolve a MESMA sessao e a MESMA conta ativa
  // (memoizadas por request desde lib/data/sessao.ts), entao encadea-los so
  // somava latencia sem trocar nada de ordem.
  //
  // whatsappContexto e' estrutural do bloco de Integracoes, como os outros
  // dois: throw, nao degradacao — a conexao do WhatsApp nao tem um "estado
  // sem numero" que faca sentido fingir quando a busca falha.
  const [adminContexto, fonteContexto, whatsappContexto] = await Promise.all([
    criarAdminStoreDoServidor(),
    criarFonteStoreDoServidor(),
    criarWhatsAppStoreDoServidor(),
  ])
  if (!adminContexto.ok) throw new Error(adminContexto.erro)
  if (!fonteContexto.ok) throw new Error(fonteContexto.erro)
  if (!whatsappContexto.ok) throw new Error(whatsappContexto.erro)

  const { store } = contexto.valor
  // todosMotivos() entrou nesta rodada: era um sexto `await` em serie DEPOIS
  // dela, e nao depende de nenhum dos outros cinco resultados — so' do store
  // de admin, que ja existe aqui em cima.
  //
  // store.motivosPerda() so devolve ativos, que e o certo para o modal de
  // perda. A configuracao precisa dos inativos tambem, para poder reativar.
  const [membros, convites, fontes, entregas, conexaoWhatsApp, motivos] = await Promise.all([
    store.membros(),
    adminContexto.valor.admin.convitesPendentes(),
    fonteContexto.valor.fontes.listar(),
    fonteContexto.valor.fontes.entregasRecentes(LIMITE_ENTREGAS),
    whatsappContexto.valor.whatsapp.atual(),
    adminContexto.valor.admin.todosMotivos(),
  ])
  if (!membros.ok) throw new Error(membros.erro)
  if (!convites.ok) throw new Error(convites.erro)
  if (!fontes.ok) throw new Error(fontes.erro)
  if (!entregas.ok) throw new Error(entregas.erro)
  if (!conexaoWhatsApp.ok) throw new Error(conexaoWhatsApp.erro)
  if (!motivos.ok) throw new Error(motivos.erro)

  const cabecalhos = await headers()
  const origem = `${cabecalhos.get('x-forwarded-proto') ?? 'http'}://${cabecalhos.get('host')}`

  // Ausente = desligada. Reversivel so por env var — ver README, "Onboarding
  // beta do Meta (operador)".
  const modoBeta = process.env.META_MODO_BETA === '1'

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-6">
      <h1 className="text-[26px] font-semibold">Configuração</h1>
      <Motivos motivos={motivos.valor} />
      <Usuarios membros={membros.valor} convites={convites.valor} origem={origem} />
      <Integracoes
        fontes={fontes.valor}
        membros={membros.valor}
        origem={origem}
        etapa={meta ?? null}
        entregas={entregas.valor}
        modoBeta={modoBeta}
      />
      <WhatsApp conexao={conexaoWhatsApp.valor} />
    </div>
  )
}
