# CommitTime

Sistema web de gerenciamento de tempo estilo Clockify, com múltiplos usuários, workspaces, projetos, equipes e relatórios.

Repositório: [github.com/kristianbernard/CommitTime](https://github.com/kristianbernard/CommitTime)

## Funcionalidades

- **Autenticação** — registro e login com sessão
- **Workspaces** — múltiplas equipes/organizações por usuário
- **Timer** — iniciar/parar cronômetro em tempo real
- **Entradas de tempo** — criar, editar e excluir registros
- **Projetos** — cores, faturável, taxa horária, arquivar/restaurar
- **Equipe** — convidar membros, papéis (Owner, Admin, Member)
- **Relatórios** — resumo por projeto, usuário ou dia
- **Exportação** — download em CSV ou PDF

## Requisitos

- Node.js 14+
- PostgreSQL (ex.: [Neon](https://neon.tech))

## Instalação

```bash
npm install
cp .env.example .env
# Edite .env com sua DATABASE_URL
npm run db:migrate
npm start
```

Acesse: http://localhost:3000

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | String de conexão PostgreSQL |
| `SESSION_SECRET` | Segredo para sessões |
| `PORT` | Porta do servidor (padrão: 3000) |

## Deploy na Vercel

1. Importe o repositório no [Vercel](https://vercel.com)
2. Configure as **Environment Variables**:
   - `DATABASE_URL` — string de conexão Neon (use a URL com **pooler**)
   - `SESSION_SECRET` — string aleatória longa
   - `NODE_ENV` — `production`
3. Faça deploy e rode a migração uma vez (local ou CI):

```bash
npm run db:migrate
```

4. Teste a conexão: `https://seu-app.vercel.app/api/health`

Deve retornar `{"ok":true,"db":"connected"}`.

> **Importante:** a Vercel é serverless — sessões precisam ficar no PostgreSQL (já configurado). Sem `DATABASE_URL` na Vercel, o login não funciona.

## Estrutura

```
├── server.js          # Servidor Express
├── lib/               # Exportação de relatórios
├── db/                # Pool e migrações
├── routes/            # API REST
├── middleware/        # Autenticação
└── public/            # Frontend e assets
```
