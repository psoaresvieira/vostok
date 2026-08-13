// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { TemplateWhatsApp } from './template-whatsapp'
import { ok, falha } from '@/lib/domain/resultado'
import type { Resultado } from '@/lib/domain/resultado'
import type { TemplateWhatsApp as Template } from '@/lib/data/templates'

// Mesmo motivo de lista.test.tsx: o cleanup automatico do
// @testing-library/react so se registra com globals: true, e este
// vitest.config nao liga de proposito.
afterEach(cleanup)

const AGORA = new Date('2026-08-04T12:00:00Z')

function template(overrides: Partial<Template> = {}): Template {
  return {
    id: 'template-1',
    scriptId: 'script-1',
    nomeMeta: 'abordagem_inicial_aaaaaaaa',
    idioma: 'pt_BR',
    categoria: 'marketing',
    corpoPosicional: 'Olá {{1}}',
    mapa: ['primeiro_nome'],
    status: 'approved',
    motivoRejeicao: null,
    statusConsultadoEm: null,
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  }
}

/** Stub de acao que so registra as chamadas recebidas — arranjo de
 * config/whatsapp.test.tsx. */
function stubRegistrando<A extends unknown[], T>(
  resultado: Resultado<T>,
): { fn: (...args: A) => Promise<Resultado<T>>; chamadas: A[] } {
  const chamadas: A[] = []
  const fn = async (...args: A): Promise<Resultado<T>> => {
    chamadas.push(args)
    return resultado
  }
  return { fn, chamadas }
}

type ArgsSubmeter = [string, 'marketing' | 'utility']

describe('TemplateWhatsApp', () => {
  describe('caso 6 — os quatro estados renderizam o que devem', () => {
    it('sem template: select de categoria com default marketing, explicacao e botao de submeter', async () => {
      const { fn: submeter, chamadas } = stubRegistrando<ArgsSubmeter, void>(ok(undefined))

      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={null}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
          submeter={submeter}
        />,
      )

      const select = screen.getByLabelText('Categoria') as HTMLSelectElement
      expect(select.value).toBe('marketing')
      // A linha que explica a escolha: sem ela o usuario chuta a categoria e o
      // Meta recusa (ou cobra) o que ele nao quis.
      expect(screen.getByText(/o Meta cobra e aprova as duas de forma diferente/i)).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Submeter ao WhatsApp' }))

      await waitFor(() => expect(chamadas).toHaveLength(1))
      expect(chamadas[0]).toEqual(['script-1', 'marketing'])
    })

    it('sem template: a categoria escolhida e a que vai para a action', async () => {
      const { fn: submeter, chamadas } = stubRegistrando<ArgsSubmeter, void>(ok(undefined))

      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={null}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
          submeter={submeter}
        />,
      )

      fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'utility' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submeter ao WhatsApp' }))

      await waitFor(() => expect(chamadas).toHaveLength(1))
      expect(chamadas[0]).toEqual(['script-1', 'utility'])
    })

    it('pending: chip "Em análise" e "consultado há X" a partir de statusConsultadoEm', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({
            status: 'pending',
            statusConsultadoEm: new Date('2026-08-04T10:00:00Z'),
          })}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
        />,
      )

      expect(screen.getByText('Em análise')).toBeTruthy()
      expect(screen.getByText(/consultado há 2 horas/i)).toBeTruthy()
      // Nada de re-submeter enquanto o Meta analisa: a action recusaria.
      expect(screen.queryByRole('button', { name: /re-submeter/i })).toBeNull()
    })

    it('pending nunca consultado: diz isso em vez de "há 56 anos"', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({ status: 'pending', statusConsultadoEm: null })}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
        />,
      )

      expect(screen.getByText('Em análise')).toBeTruthy()
      expect(screen.getByText(/ainda não consultado/i)).toBeTruthy()
    })

    it('approved: chip "Aprovado" e nenhum botao de submissao', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({ status: 'approved' })}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
        />,
      )

      expect(screen.getByText('Aprovado')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /submeter/i })).toBeNull()
    })

    it('rejected: chip "Recusado", o motivo do Meta e o botao de re-submeter', async () => {
      const { fn: submeter, chamadas } = stubRegistrando<ArgsSubmeter, void>(ok(undefined))

      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({
            status: 'rejected',
            categoria: 'utility',
            motivoRejeicao: 'INVALID_FORMAT: o corpo tem variavel no inicio',
          })}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
          submeter={submeter}
        />,
      )

      expect(screen.getByText('Recusado')).toBeTruthy()
      expect(screen.getByText(/INVALID_FORMAT/)).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Re-submeter ao WhatsApp' }))

      await waitFor(() => expect(chamadas).toHaveLength(1))
      // Re-submissao reusa a categoria ja registrada — nao ha select aqui.
      expect(chamadas[0]).toEqual(['script-1', 'utility'])
    })

    it('sem conexao e sem template: a area de submissao vira a linha para /config', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={null}
          desatualizado={false}
          semConexao
          agora={AGORA}
        />,
      )

      const link = screen.getByRole('link', { name: /configuração/i })
      expect(link.getAttribute('href')).toBe('/config')
      // Sem o formulario: clicar submeteria contra uma conexao que nao existe.
      expect(screen.queryByRole('button', { name: /submeter/i })).toBeNull()
      expect(screen.queryByLabelText('Categoria')).toBeNull()
    })

    it('sem conexao COM template aprovado: o chip sobrevive; so a submissao vira a linha', () => {
      // "Sem conexao" pode ser falha transitoria da RPC de credencial — a
      // pagina nao distingue. Engolir o bloco inteiro diria "conecte um numero"
      // a quem tem um template aprovado, sumindo com fatos que estao gravados
      // no banco e continuam verdadeiros com o Meta fora do ar.
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({ status: 'approved' })}
          desatualizado={false}
          semConexao
          agora={AGORA}
        />,
      )

      expect(screen.getByText('Aprovado')).toBeTruthy()
      expect(screen.getByText('abordagem_inicial_aaaaaaaa')).toBeTruthy()
      expect(screen.getByRole('link', { name: /configuração/i }).getAttribute('href')).toBe(
        '/config',
      )
      expect(screen.queryByRole('button', { name: /submeter/i })).toBeNull()
    })

    it('sem conexao COM template recusado: chip, motivo e nota seguem; o re-submeter da lugar a linha', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({ status: 'rejected', motivoRejeicao: 'INVALID_FORMAT' })}
          desatualizado
          semConexao
          agora={AGORA}
        />,
      )

      expect(screen.getByText('Recusado')).toBeTruthy()
      expect(screen.getByText('INVALID_FORMAT')).toBeTruthy()
      expect(
        screen.getByText('O script mudou desde a submissão — re-submeta para atualizar'),
      ).toBeTruthy()
      expect(screen.queryByRole('button', { name: /re-submeter/i })).toBeNull()
      expect(screen.getByRole('link', { name: /configuração/i })).toBeTruthy()
    })
  })

  describe('caso 7 — desatualizado mostra a nota e o re-submeter', () => {
    it('aprovado mas desatualizado: nota e botao, mesmo com o chip de aprovado', async () => {
      const { fn: submeter, chamadas } = stubRegistrando<ArgsSubmeter, void>(ok(undefined))

      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({ status: 'approved' })}
          desatualizado
          semConexao={false}
          agora={AGORA}
          submeter={submeter}
        />,
      )

      expect(screen.getByText('Aprovado')).toBeTruthy()
      expect(
        screen.getByText('O script mudou desde a submissão — re-submeta para atualizar'),
      ).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Re-submeter ao WhatsApp' }))

      await waitFor(() => expect(chamadas).toHaveLength(1))
      expect(chamadas[0]).toEqual(['script-1', 'marketing'])
    })

    it('em analise e desatualizado: a nota aparece, mas o re-submeter nao (o Meta ainda analisa)', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({ status: 'pending' })}
          desatualizado
          semConexao={false}
          agora={AGORA}
        />,
      )

      expect(
        screen.getByText('O script mudou desde a submissão — re-submeta para atualizar'),
      ).toBeTruthy()
      expect(screen.queryByRole('button', { name: /re-submeter/i })).toBeNull()
    })
  })

  describe('caso 8 — recusa traduzida pelo mapa', () => {
    it('sem_conexao_whatsapp vira a frase do mapa, nunca o codigo', async () => {
      const { fn: submeter } = stubRegistrando<ArgsSubmeter, void>(falha('sem_conexao_whatsapp'))

      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={null}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
          submeter={submeter}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Submeter ao WhatsApp' }))

      await waitFor(() =>
        expect(
          screen.getByText(
            'Conecte um número de WhatsApp em Configuração antes de usar templates.',
          ),
        ).toBeTruthy(),
      )
      expect(screen.queryByText('sem_conexao_whatsapp')).toBeNull()
    })

    it('excecao de transporte vira a mensagem de falha de conexao, nao um erro mudo', async () => {
      const submeter = async (): Promise<Resultado<void>> => {
        throw new Error('fetch failed')
      }

      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={null}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
          submeter={submeter}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Submeter ao WhatsApp' }))

      await waitFor(() =>
        expect(
          screen.getByText(
            'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.',
          ),
        ).toBeTruthy(),
      )
    })

    it('status desconhecido do Meta nao vira "aprovado" nem chip vazio', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({ status: 'paused' })}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
        />,
      )

      expect(screen.getByText('paused')).toBeTruthy()
      expect(screen.queryByText('Aprovado')).toBeNull()
      // Estado que nao e enviavel: re-submeter e a saida.
      expect(screen.getByRole('button', { name: 'Re-submeter ao WhatsApp' })).toBeTruthy()
    })
  })

  describe('excluir template — o caminho "exclua e submeta"', () => {
    type ArgsExcluir = [string]

    it('com template: o botao existe, o dialogo pede confirmacao, e confirmar chama a action com o scriptId', async () => {
      const { fn: excluir, chamadas } = stubRegistrando<ArgsExcluir, void>(ok(undefined))

      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template()}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
          excluir={excluir}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Excluir template' }))

      // Nada foi excluido ainda: abrir o dialogo nao e' consentir.
      expect(chamadas).toHaveLength(0)
      const dialogo = screen.getByRole('dialog', { name: 'Excluir template' })
      expect(dialogo.textContent).toMatch(/nova submissão e aprovação do Meta/i)

      fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão do template' }))

      await waitFor(() => expect(chamadas).toHaveLength(1))
      expect(chamadas[0]).toEqual(['script-1'])
    })

    it('cancelar fecha o dialogo sem chamar a action', () => {
      const { fn: excluir, chamadas } = stubRegistrando<ArgsExcluir, void>(ok(undefined))

      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template()}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
          excluir={excluir}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Excluir template' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar exclusão do template' }))

      expect(screen.queryByRole('dialog', { name: 'Excluir template' })).toBeNull()
      expect(chamadas).toHaveLength(0)
    })

    it('template em analise: o dialogo AVISA que a analise esta em curso, para o bypass ser consciente', () => {
      // Excluir + submeter do zero e' um contorno legitimo de dois cliques do
      // template_ja_pendente — mas so se o usuario souber que esta abandonando
      // uma analise em andamento.
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template({ status: 'pending' })}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Excluir template' }))

      const dialogo = screen.getByRole('dialog', { name: 'Excluir template' })
      expect(dialogo.textContent).toMatch(/ainda está em análise no Meta/i)
    })

    it('template aprovado: o dialogo NAO fala de analise em curso', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template()}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Excluir template' }))

      const dialogo = screen.getByRole('dialog', { name: 'Excluir template' })
      expect(dialogo.textContent).not.toMatch(/em análise/i)
    })

    it('sem template nao ha o que excluir: o botao nao existe', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={null}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
        />,
      )

      expect(screen.queryByRole('button', { name: 'Excluir template' })).toBeNull()
    })

    it('sem conexao o excluir CONTINUA existindo: a exclusao comeca no banco e nao depende do Meta', () => {
      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template()}
          desatualizado={false}
          semConexao={true}
          agora={AGORA}
        />,
      )

      expect(screen.getByRole('button', { name: 'Excluir template' })).toBeTruthy()
    })

    it('erro da action aparece na tela com a mensagem mapeada', async () => {
      const { fn: excluir } = stubRegistrando<ArgsExcluir, void>(
        falha('template_nao_encontrado'),
      )

      render(
        <TemplateWhatsApp
          scriptId="script-1"
          template={template()}
          desatualizado={false}
          semConexao={false}
          agora={AGORA}
          excluir={excluir}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Excluir template' }))
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão do template' }))

      await waitFor(() =>
        expect(screen.getByText('Esse template não existe mais. Recarregue a página.')).toBeTruthy(),
      )
    })
  })
})
