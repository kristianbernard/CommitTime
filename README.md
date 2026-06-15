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

## Estrutura

```
├── server.js          # Servidor Express
├── lib/               # Exportação de relatórios
├── db/                # Pool e migrações
├── routes/            # API REST
├── middleware/        # Autenticação
└── public/            # Frontend e assets
```
