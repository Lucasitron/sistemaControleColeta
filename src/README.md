# `src/` — Backend

Código do servidor Express. Organizado em camadas: controllers, services, database, routes.

## Arquitetura

```
Request HTTP
  → Routes (apiRoutes.js)
    → Controllers (validação de request/response)
      → Services (lógica de negócio)
        → Database (SQLite)
```

## `server.js`

Ponto de entrada da aplicação. Inicializa o banco, o servidor HTTP e o job de cobrança automática.

```
PORT=1213 node src/server.js
```

## `app.js`

Cria e configura a instância do Express:
- `express.json()` — parsing de JSON
- Log de requisições no terminal
- Static files em `public/`
- Rotas em `/api`
- Fallback para SPA (index.html)
- Error handler

## `routes/apiRoutes.js`

Centraliza todas as rotas da API. Cada rota é envolvida com `asyncHandler` para capturar erros assíncronos.

### Grupos de rotas

| Prefixo | Controller | Descrição |
|---------|-----------|-----------|
| `GET/PUT /config, /settings` | `configController` | Configuração inicial e atualização |
| `GET /dashboard` | `financialController` | Dashboard financeiro mensal |
| `POST/PUT/DELETE /participants` | `participantController` | CRUD de participantes |
| `POST/PUT/DELETE /payments` | `financialController` | CRUD de pagamentos |
| `POST/PUT/DELETE /purchases` | `financialController` | CRUD de despesas |
| `POST /justifications` | `financialController` | Justificativas de participante |
| `GET/POST /bot/*` | `botController` | Operações do WhatsApp |

## `controllers/`

Handlers que recebem `request` e `response` do Express. Cada função:
1. Extrai dados do request (`body`, `params`, `query`)
2. Chama o service correspondente
3. Retorna a resposta HTTP (`json`, `status(201)`, `status(204)`)

### Arquivos

| Arquivo | Funções |
|---------|---------|
| `botController.js` | `getStatus`, `startBot`, `listGroups`, `listGroupParticipants`, `sendIndividualCharge`, `startCampaign`, `sendReport`, `clearSession` |
| `configController.js` | `getConfig`, `updateSettings` |
| `financialController.js` | `getDashboard`, CRUD payments, CRUD purchases, `toggleJustification` |
| `participantController.js` | CRUD participants |

## `services/`

Camada de lógica de negócio. Orquestra operações entre o banco e o WhatsApp.

| Arquivo | Responsabilidade |
|---------|-----------------|
| `ColetaCopaBot.js` | Classe principal do bot WhatsApp. Gerencia conexão, sessão, envio de mensagens, criação de enquetes, listagem de grupos e campanhas |
| `botManager.js` | Singleton do bot. Cria e reutiliza a instância do `ColetaCopaBot` |
| `botService.js` | Fachada entre controllers e o bot. Cobre status, start, listagem, cobranças, campanhas e relatórios |
| `configService.js` | Carrega e atualiza configurações do banco, sincroniza com o bot |
| `financialService.js` | Repassa operações financeiras para o banco |
| `participantService.js` | Valida e repassa operações de participantes |
| `reportService.js` | Constrói relatório financeiro formatado para WhatsApp |
| `autoChargeService.js` | Job que roda a cada hora e dispara cobranças automáticas nos dias 10 e 15 |

## `db/database.js`

Camada de acesso a dados com SQLite. Gerencia:
- Inicialização e migração das tabelas
- CRUD de participantes, pagamentos, despesas, campanhas, justificativas
- Dashboard com agregados mensais
- Configuração do bot (chave/valor)

### Schema

```sql
settings (key TEXT PK, value TEXT)
participants (id INTEGER PK, name, category, is_debtor, whatsapp_number, amount_due, created_at)
campaigns (id INTEGER PK, group_name, status, message, started_at, finished_at)
payments (id INTEGER PK, participant_id FK, participant_name, amount, paid_at, source)
purchases (id INTEGER PK, description, amount, purchase_date)
justifications (participant_id PK FK, month_year PK)
```

## `middleware/errorHandler.js`

Captura erros lançados nas rotas e retorna `{ error: mensagem }` com o status code apropriado.

## `utils/asyncHandler.js`

Wrapper para funções assíncronas do Express. Captura rejeições e encaminha para o `next(error)`.

## `validators/participantValidator.js`

Valida dados de participante: nome obrigatório, categoria válida e valor em aberto não negativo.

## `config/defaultConfig.js`

Configuração padrão com delays, lista de nomes por categoria, valores de contribuição, chave PIX e grupo alvo.
