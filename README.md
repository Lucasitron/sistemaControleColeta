# 🏆 Cobrança Copa FabLab

Painel web para gerenciar a contribuição da copa do FabLab. Controla participantes, cobranças via WhatsApp, campanhas de arrecadação e relatórios financeiros.

## Funcionalidades

- **Gestão de participantes** — cadastro, edição e categorização (professores, bolsistas, usuários frequentes)
- **Cobrança individual via WhatsApp** — envia lembrete personalizado com valor devido e chave PIX
- **Campanha de coleta** — dispara mensagens e enquetes no grupo alvo automaticamente
- **Cobrança automática** — nos dias 10 e 15 de cada mês, cobra automaticamente os pendentes
- **Dashboard financeiro** — acompanhamento mensal de arrecadação, despesas e saldo
- **Relatório financeiro** — envio de resumo do mês para o grupo
- **Importação de grupos** — carrega participantes direto de grupos do WhatsApp
- **Autenticação via QR Code** — escaneie com o WhatsApp para conectar

## Tecnologias

- **Runtime:** Node.js 22
- **Framework:** Express 5
- **WhatsApp:** whatsapp-web.js + Puppeteer + Chromium
- **Banco:** SQLite3
- **Frontend:** HTML + CSS + JavaScript vanilla

## Estrutura

```
├── public/              # Frontend (HTML, CSS, JS)
├── src/
│   ├── config/          # Configuração padrão
│   ├── controllers/     # Handlers das rotas HTTP
│   ├── db/              # Camada de banco SQLite
│   ├── middleware/       # Middlewares Express
│   ├── routes/          # Definição das rotas
│   ├── services/        # Lógica de negócio
│   ├── utils/           # Utilitários
│   ├── validators/      # Validações
│   ├── app.js           # Configuração do Express
│   └── server.js        # Ponto de entrada
├── data/                # Banco SQLite (gerado)
├── .wwebjs_auth_nova/   # Sessão do WhatsApp (gerado)
├── .wwebjs_cache/       # Cache do WhatsApp (gerado)
├── Dockerfile
├── docker-compose.yml
└── enquete_copa_fablab.js  # Script CLI alternativo
```

## Quick Start

### Com Node local

```bash
npm install
npm start
# Acesse http://localhost:1213
```

### Com Docker

```bash
docker compose up -d --build
# Acesse http://localhost:1213
```

## Uso

1. Acesse a interface em `http://localhost:1213`
2. Clique em **"Iniciar WhatsApp"** e escaneie o QR Code
3. Conectado, use **"Listar Grupos"** para selecionar o grupo alvo
4. **"Importar Contatos"** carrega participantes do grupo
5. Configure valores, PIX e mensagens nas configurações
6. Dispare **"Campanha"** ou **"Cobranças Individuais"**

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `1213` | Porta do servidor HTTP |

## Rotas da API

### Configuração
- `GET /api/config` — configuração inicial (settings, participantes, campanhas, dashboard)
- `PUT /api/settings` — atualizar configurações

### Participantes
- `POST /api/participants` — criar participante
- `PUT /api/participants/:id` — atualizar participante
- `DELETE /api/participants/:id` — remover participante

### Financeiro
- `GET /api/dashboard?month=YYYY-MM` — dashboard mensal
- `POST /api/payments` — registrar pagamento
- `PUT /api/payments/:id` — atualizar pagamento
- `DELETE /api/payments/:id` — remover pagamento
- `POST /api/purchases` — registrar despesa
- `GET /api/purchases` — listar despesas
- `PUT /api/purchases/:id` — atualizar despesa
- `DELETE /api/purchases/:id` — remover despesa
- `POST /api/justifications` — alternar justificativa de participante

### WhatsApp
- `GET /api/bot/status` — status da conexão
- `POST /api/bot/start` — iniciar conexão WhatsApp
- `GET /api/bot/groups` — listar grupos do WhatsApp
- `GET /api/bot/group-participants?groupId=X` — participantes de um grupo
- `POST /api/bot/charge` — enviar cobrança individual
- `POST /api/bot/campaign` — iniciar campanha de coleta
- `POST /api/bot/report` — enviar relatório financeiro
- `POST /api/bot/clear-session` — limpar sessão do WhatsApp

## Licença

ISC
