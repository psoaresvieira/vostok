import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { criarScriptStoreDoServidor } from '@/lib/data/scripts'
import { criarStoreDoServidor } from '@/lib/data/supabase'
import { criarDisparoServico, criarTemplateStoreDoServidor } from '@/lib/data/templates'
import { traduzirParaPosicional } from '@/lib/domain/script'
import { Editor } from '../editor'
import { templateComStatusFresco, type CredencialDisparo } from '../status-template'
import { TemplateWhatsApp } from '../template-whatsapp'

/**
 * Compara a traducao do conteudo ATUAL com o snapshot da submissao — corpo E
 * mapa, nunca so o corpo: dois scripts podem produzir o mesmo corpo posicional
 * com mapas diferentes ('Olá {{1}}' vale tanto para {{primeiro_nome}} quanto
 * para {{empresa}}), e ai o envio preencheria o slot com o valor errado.
 *
 * Conteudo que nem traduz (variavel desconhecida escrita depois da submissao)
 * conta como desatualizado: o que existe hoje no script comprovadamente nao e'
 * o que o Meta aprovou.
 */
function estaDesatualizado(
  conteudo: string,
  snapshot: { corpoPosicional: string; mapa: string[] },
): boolean {
  const traducao = traduzirParaPosicional(conteudo)
  if (!traducao.ok) return true
  if (traducao.valor.corpo !== snapshot.corpoPosicional) return true
  if (traducao.valor.mapa.length !== snapshot.mapa.length) return true
  return traducao.valor.mapa.some((v, i) => v !== snapshot.mapa[i])
}

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
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Link href="/scripts" className="text-sm underline">
          Scripts
        </Link>
        <h1 className="text-2xl font-semibold">{script.valor.titulo}</h1>
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
