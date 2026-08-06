import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Política de Privacidade — Vostok',
}

// Pagina publica exigida pelo painel do Meta (Configuracoes -> Basico): sem
// URL de politica de privacidade o Login do Facebook fica indisponivel para o
// app. A ancora #exclusao-de-dados e a URL de "instrucoes de exclusao de
// dados" do mesmo painel — mudar o id quebra o cadastro la.
export default function PrivacidadePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6 py-12">
      <p className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Vostok
      </p>
      <h1 className="text-2xl font-semibold">Política de Privacidade</h1>
      <p className="text-sm text-muted-foreground">Última atualização: 6 de agosto de 2026</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Quem somos</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          O Vostok é um CRM para negócios que investem em tráfego pago. Ele recebe leads gerados
          em campanhas de Meta Ads e Google Ads e os organiza em um funil de vendas para as
          empresas clientes da plataforma.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Dados que tratamos</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <strong>Dados de conta:</strong> nome, email e senha (armazenada de forma criptografada)
          das pessoas que usam o Vostok.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <strong>Dados de leads:</strong> nome, telefone, email e a campanha de origem de pessoas
          que preencheram um formulário de anúncio (Meta Lead Ads ou Google Ads) de uma empresa
          cliente. Esses dados chegam ao Vostok por integração autorizada pela própria empresa e
          pertencem a ela — o Vostok os trata em nome dela.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <strong>Credenciais de integração:</strong> tokens de acesso que a empresa cliente
          conecta (página do Facebook, WhatsApp Business). São armazenados com acesso restrito e
          usados somente para operar a integração autorizada.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Para que usamos</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Exclusivamente para operar o produto: receber leads, montar o funil, registrar
          histórico de atendimento, tarefas e métricas, e enviar mensagens de WhatsApp que a
          empresa cliente dispara. Não vendemos dados, não fazemos publicidade com eles e não os
          compartilhamos com terceiros fora da infraestrutura necessária ao serviço.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Onde os dados ficam</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A aplicação roda na Vercel e os dados são armazenados no Supabase (Postgres), com
          isolamento por conta: cada empresa cliente só acessa os próprios dados. O envio de
          mensagens usa a API oficial do WhatsApp (Meta), sujeita às políticas de privacidade da
          própria Meta.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Seus direitos (LGPD)</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018), você pode solicitar
          confirmação de tratamento, acesso, correção ou exclusão dos seus dados. Se seus dados
          chegaram aqui por um formulário de anúncio, a controladora é a empresa que anunciou — o
          pedido pode ser feito a ela ou diretamente a nós, pelo contato abaixo.
        </p>
      </section>

      <section id="exclusao-de-dados" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Exclusão de dados</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Para excluir seus dados do Vostok — seja uma conta de usuário, seja um lead recebido
          por formulário —, envie um email para{' '}
          <a className="underline" href="mailto:psoaresvieira2005@gmail.com">
            psoaresvieira2005@gmail.com
          </a>{' '}
          com o assunto <strong>&quot;Exclusão de dados&quot;</strong>, informando o email ou
          telefone cadastrado. A exclusão é concluída em até 7 dias e confirmada por resposta no
          mesmo email.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Contato</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Dúvidas sobre esta política:{' '}
          <a className="underline" href="mailto:psoaresvieira2005@gmail.com">
            psoaresvieira2005@gmail.com
          </a>
          .
        </p>
      </section>

      <Link href="/login" className="text-sm underline">
        Voltar ao Vostok
      </Link>
    </main>
  )
}
