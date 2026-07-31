This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Antes de expor em produção

**O Plano 3 (conexão de fontes via Meta OAuth, `conectar_fonte_meta`) não pode ser exposto em URL pública até o Plano 4 entregar o caminho de reivindicação de Page.** Risco aceito conscientemente, com dono: qualquer pessoa pode fazer signup, criar a própria conta e travar a Page de um concorrente para si (`page_id` é público e o Plano 3 não valida posse contra o Graph API). Detalhe completo, e o runbook de operador para o caso de isso acontecer antes do Plano 4, em `docs/superpowers/specs/2026-07-29-crm-ingestao-webhooks-design.md`, seção "Risco nomeado: squat de Page ID em `conectar_fonte_meta`".

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
