# 🏆 Cobrança Copa FabLab

Painel web para gerenciar a contribuição da copa do FabLab. Controla participantes, cobranças via WhatsApp, campanhas de arrecadação e relatórios financeiros.

## Funcionalidades

- **Gestão de participantes** — cadastro, edição e categorização (professores, bolsistas, usuários frequentes)
- **Cobrança individual via WhatsApp** — mensagem personalizada com valor devido, chave PIX e **enquete de valores** (valor, outro valor/insumos ou justificar ausência)
- **Confirmação de pagamento em duas enquetes** — o bot pergunta se o pagamento foi realizado e qual valor foi pago antes de marcar como pago
- **Justificativa de ausência** — ao escolher "Justificar ausência" no privado, o bot pergunta e armazena o motivo
- **Lista de arrecadação editável** — marque pago, justifique ou volte para pendente manualmente pela interface
- **Cobrança automática às 08:00** — nos dias configurados (padrão 10 e 15), com aviso prévio no grupo marcando todos
- **Sobra de caixa entre meses** — o saldo positivo (ou negativo) de meses anteriores é carregado para o mês atual
- **Campanha de coleta** — dispara mensagens e enquetes no grupo alvo automaticamente
- **Dashboard financeiro** — acompanhamento mensal de arrecadação, despesas, sobra anterior e saldo
- **Relatório financeiro** — envio de resumo do mês para o grupo
- **Comandos no chat pessoal do WhatsApp** — envie mensagens para você mesmo com `registrar compra`, `registrar pagamento`, `registrar justificativa`, `adicionar pessoa`, `retirar pessoa` e `status`
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

### Fluxo de cobrança e confirmação

1. Nos dias configurados, às 08:00, o bot avisa o grupo marcando todos.
2. Em seguida envia no privado a cobrança com a enquete de valores.
3. A pessoa marca o valor, "Outro valor / insumos" ou "Justificar ausência".
4. Se marcou um valor, o bot envia duas enquetes: **Pagamento realizado?** e **Qual valor você pagou?**.
5. Só depois das duas confirmações o pagamento é registrado e o status vira **pago**.
6. Se escolheu justificar, o bot pergunta o motivo e o armazena na lista.
7. Se a pessoa marcou mas não confirmou, você pode editar manualmente na tabela de participantes ou na lista de pendências.

### Comandos no chat "você mesmo"

Envie uma mensagem para o seu próprio contato no WhatsApp:

```text
registrar compra café 25,90
registrar pagamento João 20,00
registrar justificativa João: estava de férias
adicionar pessoa Maria 5591999999999 bolsista
retirar pessoa Maria
status
```

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
- `POST /api/justifications` — alternar justificativa de participante (com motivo)
- `GET /api/monthly-status?month=YYYY-MM` — listar status mensal
- `PUT /api/monthly-status` — editar status mensal manualmente (pago/pendente/justificado)

### WhatsApp
- `GET /api/bot/status` — status da conexão
- `POST /api/bot/start` — iniciar conexão WhatsApp
- `GET /api/bot/groups` — listar grupos do WhatsApp
- `GET /api/bot/group-participants?groupId=X` — participantes de um grupo
- `POST /api/bot/charge` — enviar cobrança individual
- `POST /api/bot/campaign` — iniciar campanha de coleta
- `POST /api/bot/report` — enviar relatório financeiro
- `POST /api/bot/sync-polls` — sincronizar enquetes abertas manualmente
- `POST /api/bot/clear-session` — limpar sessão do WhatsApp

## Licença

ISC
