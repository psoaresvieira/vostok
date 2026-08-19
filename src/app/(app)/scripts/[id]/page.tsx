import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { criarScriptStoreDoServidor } from '@/lib/data/scripts'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarDisparoServico, criarTemplateStoreDoServidor } from '@/lib/data/templates'
import { Editor } from '../editor'
// A MESMA funcao que o painel da ficha do lead usa para desabilitar o botao de
// enviar e que `enviarWhatsApp` usa para recusar. Uma copia local aqui era o
// comeco de tres implementacoes discordando sobre o unico fato que decide se o
// cliente recebe a mensagem certa.
import { estaDesatualizado } from '../desatualizado'
import { templateComStatusFresco, type CredencialDisparo } from '../status-template'
import { TemplateWhatsApp } from '../template-whatsapp'

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [contexto, base, contextoTemplates] = await Promise.all([
    criarScriptStoreDoServidor(),
    criarStoreDoServidor(),
    criarTemplateStoreDoServidor(),
  ])
  if (!contexto.ok) redirect('/login')
  if (!base.ok) redirect('/login')

  // Nao encontrado, nunca 403 — mesma convencao de /scripts/novo. Antes de
  // qualquer leitura: nao ha motivo de ir ao banco por um script que esta tela
  // nao vai mostrar.
  if (contexto.valor.papel === 'vendedor') notFound()

  const [script, pipeline] = await Promise.all([
    contexto.valor.scripts.buscar(id),
    base.valor.store.pipelinePadrao(),
  ])
  if (!script.ok) throw new Error(script.erro)
  // Zero linhas por RLS, conta errada, id inexistente ou id que nem e uuid
  // chegam aqui como null: e "nao encontrado", nunca 403 nem erro tecnico.
  if (!script.valor) notFound()
  if (!pipeline.ok) throw new Error(pipeline.erro)

  // Bloco do WhatsApp: TUDO daqui para baixo degrada para "sem conexao" em vez
  // de derrubar a pagina. O script e' o conteudo principal desta tela, e ele ja
  // carregou — perde-lo porque o Meta esta fora do ar seria trocar uma
  // funcionalidade que falhou por duas.
  const servico = criarDisparoServico()
  let credencial: CredencialDisparo | null = null
  if (contextoTemplates.ok && servico.ok) {
    const lida = await servico.valor.credencial(contextoTemplates.valor.contaId)
    // Falha transitoria da RPC cai no mesmo balde de "sem conexao": as duas
    // levam o usuario a /config, e submeter daqui falharia pelo mesmo motivo.
    if (lida.ok) credencial = { token: lida.valor.token, wabaId: lida.valor.wabaId }
  }

  const template =
    contextoTemplates.ok && servico.ok
      ? await templateComStatusFresco(
          contextoTemplates.valor.templates,
          servico.valor,
          id,
          credencial,
        )
      : null

  return (
    <div className="fade-in flex flex-col gap-6 p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <Link href="/disparo" className="text-sm underline">
          Scripts
        </Link>
        <h1 className="text-[26px] font-semibold">{script.valor.titulo}</h1>
      </div>
      <Editor script={script.valor} etapas={pipeline.valor.etapas} />
      <TemplateWhatsApp
        scriptId={id}
        template={template}
        desatualizado={template !== null && estaDesatualizado(script.valor.conteudo, template)}
        semConexao={credencial === null}
        // Carimbado UMA vez, aqui, e enviado no payload — como PainelTarefas e a
        // Lista de tarefas. Um `new Date()` como default dentro do componente
        // cliente seria lido duas vezes (SSR e hidratacao) em instantes
        // diferentes, e o "Consultado ha X" divergiria entre os dois HTMLs.
        agora={new Date()}
      />
    </div>
  )
}
