import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Termos de Uso — Vostok',
}

// Pagina publica, par da /privacidade: cliente convidado precisa poder ler os
// termos ANTES de criar a conta, e o painel do Meta tambem aceita a URL como
// termos de servico do app.
export default function TermosPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6 py-12">
      <p className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Vostok
      </p>
      <h1 className="text-[26px] font-semibold">Termos de Uso</h1>
      <p className="text-sm text-muted-foreground">Última atualização: 25 de agosto de 2026</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">O serviço</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          O Vostok é um CRM para negócios que investem em tráfego pago: recebe leads gerados em
          campanhas de Meta Ads e Google Ads, organiza o funil de vendas e permite o envio de
          mensagens de WhatsApp pela API oficial do Meta. Ao criar uma conta ou aceitar um
          convite, você concorda com estes termos.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Contas e acesso</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Contas são criadas pela equipe do Vostok e o acesso da sua equipe entra por convite do
          administrador da conta. Você é responsável por manter suas credenciais em sigilo e por
          tudo que for feito com elas. Cada conta acessa somente os próprios dados.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Responsabilidades do cliente</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Os leads recebidos pelas integrações pertencem à empresa cliente, que é a controladora
          desses dados nos termos da LGPD — o Vostok os trata em nome dela. Cabe ao cliente:
          (a) ter base legal para tratar os dados dos seus leads; (b) usar o disparo de WhatsApp
          conforme as políticas do WhatsApp Business e do Meta, apenas com templates aprovados;
          (c) não usar o serviço para spam, conteúdo ilícito ou dados de terceiros sem
          autorização.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Integrações de terceiros</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          As integrações com Meta (leads e WhatsApp) e Google dependem de serviços operados por
          essas empresas, sujeitos aos termos e à disponibilidade delas. Mudanças, limitações ou
          indisponibilidade dessas plataformas não são de responsabilidade do Vostok.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Disponibilidade</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          O Vostok está em fase beta: o serviço é fornecido no estado em que se encontra, sem
          garantia de disponibilidade contínua. Trabalhamos para manter o serviço estável e
          avisar sobre mudanças relevantes com antecedência razoável.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Dados e encerramento</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Os dados da conta pertencem ao cliente. Ao encerrar o contrato, o cliente pode
          solicitar a exportação e a exclusão dos seus dados pelo contato abaixo — a exclusão
          segue o processo descrito na{' '}
          <Link className="underline" href="/privacidade#exclusao-de-dados">
            Política de Privacidade
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Alterações destes termos</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Estes termos podem ser atualizados; a data no topo indica a versão vigente. Mudanças
          relevantes serão comunicadas aos administradores das contas. Estes termos são regidos
          pelas leis brasileiras.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Contato</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Dúvidas sobre estes termos:{' '}
          <a className="underline" href="mailto:psoaresvieira2005@gmail.com">
            psoaresvieira2005@gmail.com
          </a>
          .
        </p>
      </section>

      <div className="flex gap-4">
        <Link href="/privacidade" className="text-sm underline">
          Política de Privacidade
        </Link>
        <Link href="/login" className="text-sm underline">
          Voltar ao Vostok
        </Link>
      </div>
    </main>
  )
}
