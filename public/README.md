# `public/` — Frontend

Interface web single-page (SPA) em HTML, CSS e JavaScript vanilla. Consumida diretamente pelo Express como arquivos estáticos.

## Arquivos

| Arquivo | Descrição |
|---------|-----------|
| `index.html` | Estrutura da página com sidebar, painéis, formulários e logs |
| `styles.css` | Estilos com design system glassmorphism, temas claro/escuro e responsividade |
| `app.js` | Lógica da interface: estado, renderização, chamadas à API e eventos |

## `index.html`

Layout principal com:
- **Sidebar** — navegação entre seções (Dashboard, Config, etc.)
- **Status do WhatsApp** — badge de conexão, detalhes e QR Code
- **Dashboard financeiro** — cards de arrecadação, despesas e saldo; rankings de pagantes e devedores
- **Gestão de Participantes** — tabela com cadastro, edição e exclusão
- **Configurações** — formulário de grupo alvo, PIX e valores
- **Conexão WhatsApp** — botões para iniciar, limpar sessão, listar grupos e importar contatos
- **Ações** — campanha, cobranças individuais e relatório financeiro
- **Logs do bot** — exibe os últimos eventos do WhatsApp
- **Toast** — notificações no canto inferior direito

## `styles.css`

Design system com:
- Variáveis CSS para cores, bordas e sombras
- Tema claro (padrão) e escuro (via `prefers-color-scheme`)
- Componentes: sidebar, cards glassmorphism, tabelas, formulários, botões, badges, ranking, toast, logs
- Animações suaves em hover, transições e spinner
- Responsivo para mobile

## `app.js`

Gerencia o estado da aplicação e a renderização dinâmica.

### Estado global (`state`)

```javascript
{
  participants,     // Array de participantes
  purchases,        // Array de despesas
  groups,           // Lista de grupos do WhatsApp
  groupContacts,    // Contatos do grupo selecionado
  campaigns,        // Histórico de campanhas
  dashboard,        // Dados do dashboard mensal
  currentMonth      // Mês ativo no formato 'YYYY-MM'
}
```

### Funções principais

| Função | Descrição |
|--------|-----------|
| `api(path, options)` | Wrapper fetch com tratamento de erro |
| `withLoading(button, text, action)` | Desativa botão durante ação assíncrona |
| `showToast(message)` | Notificação temporária |
| `setStatus(status)` | Atualiza badge, detalhes, QR Code e logs do bot |
| `loadConfig()` | Carrega configuração inicial e dashboard |
| `refreshStatus()` | Polling do status do WhatsApp a cada 6s |
| `refreshDashboard()` | Atualiza dashboard e lista de participantes |
| `renderParticipants()` | Renderiza tabela de participantes |
| `renderDashboard()` | Renderiza cards e rankings |
| `renderBotLogs(logs)` | Renderiza últimos logs do bot |
| `fillSettings(settings)` | Preenche formulário de configurações |
| `listGroups()` | Busca e popula select de grupos |
| `loadGroupContacts()` | Carrega contatos do grupo selecionado |
| `importGroupContacts()` | Importa contatos como participantes |
| `sendIndividualCharges()` | Dispara cobranças em lote |

### Eventos

Os event listeners são registrados no carregamento da página para:
- Navegação entre abas (sidebar)
- Formulários (participante, compra, configurações, importação)
- Botões de ação (iniciar WhatsApp, campanha, cobrança, relatório)
- Navegação entre meses no dashboard
