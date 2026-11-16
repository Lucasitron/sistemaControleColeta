const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const defaultConfig = require('../config/defaultConfig');
const db = require('../db/database');
const commandService = require('./commandService');

class ColetaCopaBot {
    constructor(options = {}) {
        console.log('[BOT] Construtor chamado');
        this.sessionDir = path.join(__dirname, '..', '..', '.wwebjs_auth_nova');
        console.log(`[BOT] sessionDir: ${this.sessionDir}`);
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
            console.log('[BOT] Diretorio de sessao criado');
        }

        this.config = options.config || defaultConfig;
        this.autoStartCampaign = options.autoStartCampaign || false;
        this.headless = options.headless !== undefined ? options.headless : true;
        this.isAuthenticated = false;
        this.isReady = false;
        this.isInitializing = false;
        this.isCampaignRunning = false;
        this.lastQrAt = null;
        this.lastQr = null;
        this.lastQrDataUrl = null;
        this.lastError = null;
        this.logs = [];
        this.statusText = 'parado';
        this._outgoingMessageIds = new Set();
        this._processedMessageIds = new Set();
        this._pollSyncTimer = null;
        this._pollSyncRunning = false;

        console.log(`[BOT] Criando client com headless=${this.headless}`);
        this._createClient();
        this.setupEvents();
        console.log('[BOT] Construtor concluido');
    }

    _createClient() {
        console.log('[BOT] _createClient()');
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'coleta-copa-bot',
                dataPath: this.sessionDir
            }),
            puppeteer: {
                headless: this.headless,
                timeout: 120000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--disable-gpu',
                    '--disable-features=Vulkan',
                    '--window-size=1280,720'
                ]
            }
        });
    }

    _killOrphanChrome() {
        const sessionBotDir = path.join(this.sessionDir, 'session-coleta-copa-bot');
        console.log(`[BOT] _killOrphanChrome: ${sessionBotDir}`);
        try {
            const lockFile = path.join(sessionBotDir, 'SingletonLock');
            if (fs.existsSync(lockFile)) {
                fs.rmSync(lockFile, { force: true });
                console.log('[BOT] SingletonLock removido');
                this.log('Lock do navegador anterior removido.', 'warn');
            }
            try {
                execSync(`pkill -f "${sessionBotDir}"`, { timeout: 5000, stdio: 'ignore' });
                console.log('[BOT] Processos Chrome orfaos finalizados');
                this.log('Processos Chrome orfaos finalizados.', 'warn');
            } catch (_) {
                console.log('[BOT] Nenhum processo Chrome orfao encontrado');
            }
            return new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.log(`[BOT] Erro ao limpar processos: ${error.message}`);
            this.log(`Aviso ao limpar processos anteriores: ${error.message}`, 'warn');
            return Promise.resolve();
        }
    }

    setupEvents() {
        console.log('[BOT] setupEvents()');

        this.client.on('qr', (qr) => {
            console.log('[BOT_EVENT] QR Code recebido');
            this.log('QR Code recebido. Escaneie pelo WhatsApp para autenticar.');
            console.log('\nEscaneie o QR Code abaixo com o WhatsApp:');
            qrcodeTerminal.generate(qr, { small: true });
            this.lastQrAt = new Date().toISOString();
            this.lastQr = qr;
            this.lastQrDataUrl = null;
            this.isAuthenticated = false;
            this.isReady = false;
            this.statusText = 'aguardando_qrcode';

            qrcodeImage.toDataURL(qr, {
                margin: 1,
                width: 280,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            }).then((dataUrl) => {
                this.lastQrDataUrl = dataUrl;
                this.log('QR Code disponivel na interface web.');
            }).catch((error) => {
                this.lastError = error.message;
                this.log(`Erro ao gerar QR Code para interface: ${error.message}`, 'error');
            });
        });

        this.client.on('ready', () => {
            console.log('[BOT_EVENT] READY - WhatsApp conectado!');
            this.log('WhatsApp conectado e pronto.');
            this.isReady = true;
            this.isInitializing = false;
            this.lastQr = null;
            this.lastQrDataUrl = null;
            this.statusText = 'conectado';
            console.log('[BOT_EVENT] Status atualizado para conectado');

            this._startPollSync();

            if (this.autoStartCampaign) {
                console.log('[BOT_EVENT] autoStartCampaign ativo, iniciando processo...');
                this.startProcess();
            }
        });

        this.client.on('authenticated', () => {
            console.log('[BOT_EVENT] AUTHENTICATED');
            this.log('WhatsApp autenticado.');
            this.isAuthenticated = true;
            this.lastQr = null;
            this.lastQrDataUrl = null;
            this.statusText = 'autenticado';
        });

        this.client.on('auth_failure', (message) => {
            console.log(`[BOT_EVENT] AUTH_FAILURE: ${message}`);
            this.log(`Falha na autenticacao: ${message}`, 'error');
            this.lastError = message;
            this.isAuthenticated = false;
            this.isReady = false;
            this.isInitializing = false;
            this.statusText = 'falha_autenticacao';
        });

        this.client.on('disconnected', (reason) => {
            console.log(`[BOT_EVENT] DISCONNECTED: ${reason}`);
            this.log(`WhatsApp desconectado: ${reason}`, 'warn');
            this.lastError = reason;
            this.isReady = false;
            this.isAuthenticated = false;
            this.isInitializing = false;
            this.statusText = 'desconectado';
        });

        this.client.on('loading_screen', (percent, message) => {
            console.log(`[BOT_EVENT] LOADING: ${percent}% - ${message}`);
            this.log(`Carregando WhatsApp: ${percent}% - ${message}`);
            if (!this.isReady) {
                this.statusText = 'carregando';
            }
        });

        // Votos das enquetes (cobranca e confirmacao de pagamento).
        this.client.on('vote_update', (vote) => {
            this._onVoteUpdate(vote).catch(error => {
                this.log(`Erro ao processar voto de enquete: ${error.message}`, 'error');
            });
        });

        // Mensagens recebidas: usadas para capturar o motivo da ausencia,
        // valor personalizado e valor pago quando o bot pergunta no privado.
        this.client.on('message', (message) => {
            this._onIncomingMessage(message).catch(error => {
                this.log(`Erro ao processar mensagem recebida: ${error.message}`, 'error');
            });
        });

        // Mensagens criadas pela propria conta. O chat "voce mesmo" e usado
        // como central de comandos (registrar compra, pagamento, etc.).
        this.client.on('message_create', (message) => {
            this._onMessageCreate(message).catch(error => {
                this.log(`Erro ao processar comando no chat pessoal: ${error.message}`, 'error');
            });
        });
    }

    _startPollSync() {
        if (this._pollSyncTimer) {
            clearInterval(this._pollSyncTimer);
        }
        this._pollSyncTimer = setInterval(() => {
            this.syncOpenPolls().catch(error => {
                this.log(`Erro ao sincronizar enquetes: ${error.message}`, 'warn');
            });
        }, 2 * 60 * 1000);

        setTimeout(() => {
            this.syncOpenPolls().catch(error => {
                this.log(`Erro ao sincronizar enquetes: ${error.message}`, 'warn');
            });
        }, 10 * 1000);
    }

    async _send(chatId, content, options = {}) {
        const message = await this.client.sendMessage(chatId, content, options);
        const messageId = message?.id?._serialized;
        if (messageId) {
            this._outgoingMessageIds.add(messageId);
            if (this._outgoingMessageIds.size > 500) {
                const first = this._outgoingMessageIds.values().next().value;
                this._outgoingMessageIds.delete(first);
            }
        }
        return message;
    }

    log(message, level = 'info') {
        const entry = {
            at: new Date().toISOString(),
            level,
            message
        };

        this.logs.push(entry);
        this.logs = this.logs.slice(-40);

        const line = `[WhatsApp] ${message}`;
        if (level === 'error') {
            console.error(line);
        } else if (level === 'warn') {
            console.warn(line);
        } else {
            console.log(line);
        }
    }

    setConfig(config) {
        this.config = config;
    }

    getStatus() {
        return {
            status: this.isReady ? 'conectado' : this.statusText,
            isAuthenticated: this.isAuthenticated,
            isReady: this.isReady,
            isInitializing: this.isInitializing,
            isCampaignRunning: this.isCampaignRunning,
            lastQrAt: this.lastQrAt,
            qrDataUrl: this.lastQrDataUrl,
            lastError: this.lastError
        };
    }

    getLogs() {
        return this.logs;
    }

    async iniciar() {
        console.log(`[BOT] iniciar() chamado. isReady=${this.isReady} isInitializing=${this.isInitializing}`);
        if (this.isReady || this.isInitializing) {
            console.log('[BOT] Ja esta pronto ou inicializando, retornando status atual');
            return this.getStatus();
        }

        this.isInitializing = true;
        this.statusText = 'inicializando';
        const hasSession = fs.existsSync(this.sessionDir) && fs.readdirSync(this.sessionDir).length > 0;
        console.log(`[BOT] ${hasSession ? 'Sessao encontrada' : 'Nova sessao'} em ${this.sessionDir}`);
        this.log(hasSession ? 'Sessao encontrada. Restaurando WhatsApp...' : 'Nova sessao. Aguardando QR Code.');

        const maxRetries = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            console.log(`[BOT] Tentativa ${attempt}/${maxRetries} modo ${this.headless ? 'headless' : 'com navegador'}`);
            this.log(`Inicializando cliente WhatsApp (tentativa ${attempt}/${maxRetries}) em modo ${this.headless ? 'headless' : 'com navegador'}.`);

            try {
                await this._killOrphanChrome();

                if (attempt > 1) {
                    console.log('[BOT] Recriando client (retry)');
                    this._createClient();
                    this.setupEvents();
                }

                console.log('[BOT] Chamando client.initialize()...');
                await this.client.initialize();
                lastError = null;
                console.log('[BOT] client.initialize() concluido com sucesso');
                break;
            } catch (error) {
                lastError = error;
                console.log(`[BOT] Erro na tentativa ${attempt}: ${error.message}`);
                this.log(`Erro ao inicializar WhatsApp (tentativa ${attempt}): ${error.message}`, 'error');

                // Try to destroy the client gracefully before retrying
                try {
                    await this.client.destroy();
                } catch (_) {
                    // Ignore destroy errors
                }

                const isNetworkError =
                    error.message.includes('ERR_INTERNET_DISCONNECTED') ||
                    error.message.includes('ERR_NAME_NOT_RESOLVED') ||
                    error.message.includes('ERR_CONNECTION') ||
                    error.message.includes('ERR_NETWORK') ||
                    error.message.includes('ERR_TIMED_OUT') ||
                    error.message.includes('net::');

                const isRecoverable =
                    isNetworkError ||
                    error.message.includes('Execution context was destroyed') ||
                    error.message.includes('already running') ||
                    error.message.includes('Protocol error') ||
                    error.message.includes('Navigation failed') ||
                    error.message.includes('Target closed');

                if (!isRecoverable || attempt === maxRetries) {
                    // Nunca apagar a sessao por erro de rede: isso destruiria uma
                    // sessao valida e forcaria novo QR Code sem necessidade. O
                    // container pode ficar sem internet temporariamente; ao
                    // voltar, a sessao existente reconecta sozinha.
                    if (isRecoverable && !isNetworkError && attempt === maxRetries) {
                        this.log('Todas as tentativas falharam. Limpando sessao corrompida...', 'warn');
                        try {
                            await this.limparSessao();
                        } catch (clearError) {
                            this.log(`Nao foi possivel limpar a sessao: ${clearError.message}`, 'warn');
                        }
                    }
                    break;
                }

                // Wait before retrying (exponential backoff)
                const waitMs = attempt * 3000;
                this.log(`Aguardando ${waitMs / 1000}s antes da proxima tentativa...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }

        if (lastError) {
            this.isInitializing = false;
            this.lastError = lastError.message;
            this.statusText = 'erro';
            throw lastError;
        }

        return this.getStatus();
    }

    dividirArray(array, tamanhoChunk) {
        const chunks = [];
        for (let i = 0; i < array.length; i += tamanhoChunk) {
            chunks.push(array.slice(i, i + tamanhoChunk));
        }
        return chunks;
    }

    _extractChatId(chat) {
        if (chat.id) {
            if (typeof chat.id === 'string') return chat.id;
            if (chat.id._serialized) return chat.id._serialized;
            if (chat.id.user) return `${chat.id.user}@${chat.id.server || 'c.us'}`;
        }
        return null;
    }

    _extractChatName(chat) {
        return chat.name || chat.formattedTitle || chat.pushname || null;
    }

    _isGroupChat(chat) {
        if (typeof chat.isGroup === 'boolean') return chat.isGroup;
        const id = this._extractChatId(chat);
        return id ? id.endsWith('@g.us') : false;
    }

    async _getChatByIdSafe(chatId, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`[BOT] _getChatByIdSafe tentativa ${attempt}/${retries} para ${chatId}`);
                const chat = await this.client.getChatById(chatId);
                console.log(`[BOT] _getChatByIdSafe sucesso: "${chat.name}"`);
                return chat;
            } catch (err) {
                console.log(`[BOT] _getChatByIdSafe tentativa ${attempt} falhou: ${err.message}`);

                if (attempt < retries) {
                    console.log('[BOT] Tentando fallback: buscar chat ja carregado...');
                    try {
                        const allChats = await this.client.getChats();
                        const found = allChats.find(c => {
                            const id = this._extractChatId(c);
                            return id === chatId;
                        });
                        if (found) {
                            console.log(`[BOT] Fallback encontrou chat: "${found.name}"`);
                            return found;
                        }
                        console.log(`[BOT] Chat ${chatId} nao encontrado entre ${allChats.length} chats carregados`);
                    } catch (fallbackErr) {
                        console.log(`[BOT] Fallback getChats() tambem falhou: ${fallbackErr.message}`);
                    }

                    const waitMs = attempt * 2000;
                    console.log(`[BOT] Aguardando ${waitMs / 1000}s antes da proxima tentativa...`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                }
            }
        }
        throw new Error(`Nao foi possivel obter o chat ${chatId} apos ${retries} tentativas`);
    }

    async listarGrupos() {
        console.log('[BOT] listarGrupos()');
        if (!this.isReady) {
            console.log('[BOT] listarGrupos ERRO: WhatsApp nao esta pronto');
            throw new Error('WhatsApp ainda nao esta pronto.');
        }

        let chats;
        try {
            console.log('[BOT] Chamando client.getChats()...');
            chats = await this.client.getChats();
            console.log(`[BOT] getChats() retornou ${chats.length} chats`);
            if (chats.length > 0) {
                const sample = chats[0];
                console.log('[BOT] Amostra do primeiro chat:', JSON.stringify({
                    id: sample.id,
                    idType: typeof sample.id,
                    idSerialized: sample.id?._serialized,
                    idUser: sample.id?.user,
                    idServer: sample.id?.server,
                    name: sample.name,
                    isGroup: sample.isGroup,
                    isGroupType: typeof sample.isGroup,
                    keys: Object.keys(sample).slice(0, 15)
                }));
            }
        } catch (error) {
            console.log('[BOT] getChats() regular falhou, tentando fallback via evaluate direto...');
            console.log('[BOT] Erro:', error.message);

            let rawChats;
            let fbPage = this.client.pupPage;
            const tryGetChatsFallback = async () => {
                await fbPage.evaluate('1+1');
                return await fbPage.evaluate(() => {
                    function serializeChat(c) {
                        let m;
                        if (typeof c.serialize === 'function') {
                            m = c.serialize();
                        } else {
                            m = typeof c.toJSON === 'function' ? c.toJSON() : c;
                        }
                        m.__x_isGroup = m.__x_isGroup || c.__x_isGroup || c.attributes?.__x_isGroup;
                        m.name = m.name || c.name || c.attributes?.name || m.formattedTitle;
                        return m;
                    }
                    try {
                        const coll = window.require('WAWebCollections').Chat;
                        if (typeof coll.getModelsArray === 'function') {
                            return coll.getModelsArray().map(c => {
                                const rawId = (c.id?._serialized) || (typeof c.id === 'string' ? c.id : null);
                                const m = serializeChat(c);
                                return {
                                    id: rawId || (m.id?._serialized),
                                    name: m.name || m.formattedTitle || c.name || 'Sem nome',
                                    isGroup: rawId ? rawId.endsWith('@g.us') : false,
                                    participants: m.groupMetadata?.participants?.length
                                };
                            });
                        }
                        if (typeof coll.get === 'function' && coll.models) {
                            return coll.models.map(c => {
                                const rawId = (c.id?._serialized) || (typeof c.id === 'string' ? c.id : null);
                                const attrs = typeof c.toJSON === 'function' ? c.toJSON() : c;
                                return {
                                    id: rawId || (attrs.id?._serialized),
                                    name: attrs.name || attrs.formattedTitle || 'Sem nome',
                                    isGroup: rawId ? rawId.endsWith('@g.us') : false,
                                    participants: attrs.groupMetadata?.participants?.length
                                };
                            });
                        }
                        if (typeof coll === 'object') {
                            const keys = Object.keys(coll);
                            const items = keys.filter(k => coll[k] && coll[k].id);
                            return items.map(k => ({
                                id: (coll[k].id._serialized || coll[k].id),
                                name: coll[k].name || coll[k].formattedTitle || 'Sem nome',
                                isGroup: (coll[k].id._serialized || coll[k].id).endsWith('@g.us'),
                                participants: coll[k].groupMetadata?.participants?.length
                            }));
                        }
                    } catch(e) {
                        return { error: e.message || String(e) };
                    }
                    return { error: 'Nenhum metodo de acesso a chats funcionou' };
                });
            };

            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    rawChats = await tryGetChatsFallback();
                    console.log(`[BOT] Fallback tentativa ${attempt + 1}:`, rawChats?.error ? `ERRO: ${rawChats.error}` : `${rawChats?.length || 0} chats`);
                    if (rawChats && !rawChats.error) break;
                } catch (e) {
                    console.log(`[BOT] Tentativa fallback ${attempt + 1} falhou: ${e.message}`);
                    if (attempt < 2) {
                        try {
                            const pages = await this.client.pupBrowser.pages();
                            fbPage = pages[pages.length - 1];
                            if (!fbPage) throw new Error('sem pagina');
                        } catch (e2) {
                            console.log('[BOT] Nao foi possivel renovar pagina');
                        }
                    }
                }
            }
            if (!rawChats || rawChats.error) {
                throw new Error(rawChats?.error || 'Fallback nao retornou dados');
            }
            chats = rawChats;
        }

        const allChats = chats.map(chat => ({
            id: this._extractChatId(chat),
            name: this._extractChatName(chat),
            isGroup: this._isGroupChat(chat),
            raw: chat
        }));

        const nonGroup = allChats.filter(c => !c.isGroup);
        console.log(`[BOT] ${allChats.length} chats totais: ${allChats.filter(c => c.isGroup).length} grupos, ${nonGroup.length} privados`);

        if (nonGroup.length > 0) {
            console.log('[BOT] Exemplos de chats privados:');
            nonGroup.slice(0, 3).forEach(c => console.log(`  - id=${c.id} name=${c.name}`));
        }

        const grupos = allChats
            .filter(chat => chat.isGroup)
            .map(chat => ({
                id: chat.id,
                name: chat.name || 'Sem nome',
                participants: chat.raw?.participants ? chat.raw.participants.length : null
            }))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        console.log(`[BOT] ${grupos.length} grupos filtrados`);
        if (grupos.length > 0) {
            grupos.slice(0, 10).forEach(g => console.log(`  - "${g.name}" (${g.id}) [${g.participants ?? '?'} participantes]`));
            if (grupos.length > 10) console.log(`  ... e mais ${grupos.length - 10}`);
        }
        return grupos;
    }

    async encontrarGrupoCopaFabLab(grupoAlvo = null) {
        const alvoOriginal = String(grupoAlvo || this.config.grupoAlvo || '').trim();
        console.log(`[BOT] encontrarGrupoCopaFabLab alvo="${alvoOriginal}"`);

        if (!alvoOriginal) {
            console.log('[BOT] Nenhum grupo alvo configurado');
            return null;
        }

        if (alvoOriginal.endsWith('@g.us')) {
            console.log('[BOT] Alvo e um ID direto @g.us, buscando por ID...');
            try {
                const grupo = await this._getChatByIdSafe(alvoOriginal);
                console.log(`[BOT] Grupo encontrado por ID: "${grupo.name}"`);
                return grupo;
            } catch (err) {
                console.log(`[BOT] Erro ao buscar por ID ${alvoOriginal}: ${err.message}`);
                return null;
            }
        }

        const grupos = await this.listarGrupos();
        const alvo = alvoOriginal.toLowerCase();
        console.log(`[BOT] Buscando grupo com nome "${alvoOriginal}" entre ${grupos.length} grupos...`);

        const grupoInfo = grupos.find(grupo => (grupo.name || '').toLowerCase() === alvo);

        if (grupoInfo) {
            console.log(`[BOT] Match EXATO: "${grupoInfo.name}" (${grupoInfo.id})`);
        } else {
            const partial = grupos.find(grupo => (grupo.name || '').toLowerCase().includes(alvo));
            if (partial) {
                console.log(`[BOT] Match PARCIAL: "${partial.name}" (${partial.id})`);
            } else {
                console.log('[BOT] Nenhum match por nome. Todos os nomes de grupos:');
                grupos.forEach(g => console.log(`  - "${g.name}"`));
                return null;
            }
        }

        const match = grupoInfo || grupos.find(grupo => (grupo.name || '').toLowerCase().includes(alvo));
        console.log(`[BOT] Buscando Chat por ID: ${match.id}...`);
        try {
            const grupo = await this._getChatByIdSafe(match.id);
            console.log(`[BOT] Chat obtido: "${grupo.name}"`);
            return grupo;
        } catch (err) {
            console.log(`[BOT] Erro ao obter chat ${match.id}: ${err.message}`);
            return null;
        }
    }

    /**
     * Lista os participantes (contatos) de um grupo do WhatsApp.
     *
     * Passo a passo:
     * 1. Exige `isReady` (bot conectado); senão lança erro.
     * 2. Resolve o ID alvo: usa `groupId` ou `_resolveGroupId()` (grupo da config).
     * 3. Localiza o chat via `getChats()` (com fallback para `getChatById`).
     * 4. Se a lib não devolver participantes, usa `_fetchGroupParticipantsRaw`
     *    (evaluate direto no contexto da página), que contorna o caso em que
     *    os wrappers falham e o grupo parecia "não encontrado".
     * 5. Para cada `participant`, resolve o nome via `getContactById`
     *    (fallback para o próprio número em caso de falha).
     *
     * @param {string|null} [groupId] ID serializado do grupo ("...@g.us").
     * @returns {Promise<Array<{id: string, number: string, name: string, isAdmin: boolean}>>}
     *   Lista ordenada por nome.
     */
    async listarParticipantesGrupo(groupId = null) {
        console.log(`[BOT] listarParticipantesGrupo groupId=${groupId}`);
        if (!this.isReady) {
            console.log('[BOT] listarParticipantesGrupo ERRO: WhatsApp nao esta pronto');
            throw new Error('WhatsApp ainda nao esta pronto.');
        }

        const targetId = groupId || await this._resolveGroupId();
        if (!targetId) {
            console.log(`[BOT] Grupo "${this.config.grupoAlvo}" nao encontrado`);
            throw new Error(`Grupo "${this.config.grupoAlvo}" nao encontrado.`);
        }

        console.log(`[BOT] Buscando participantes do grupo ${targetId}...`);

        let grupoChat = null;
        try {
            const allChats = await this.client.getChats();
            grupoChat = allChats.find(c => {
                const id = this._extractChatId(c);
                return id === targetId;
            });
            if (grupoChat) {
                console.log(`[BOT] Grupo encontrado via getChats(): "${grupoChat.name}"`);
            }
        } catch (err) {
            console.log(`[BOT] getChats() falhou ao buscar grupo: ${err.message}`);
        }

        if (!grupoChat) {
            try {
                grupoChat = await this._getChatByIdSafe(targetId);
            } catch (err) {
                console.log(`[BOT] _getChatByIdSafe tambem falhou: ${err.message}`);
            }
        }

        // Etapa 3: participantes via API do whatsapp-web.js (chat.participants).
        let participantes = (grupoChat && grupoChat.participants) || [];

        // Etapa 4: fallback via evaluate direto. Necessario quando os wrappers
        // da lib falham no contexto da pagina (mesmo cenario em que
        // `listarGrupos()` precisa do fallback para listar grupos), o que
        // antes fazia esta funcao lancar "Grupo ... nao encontrado" mesmo
        // existindo.
        if (!participantes.length) {
            console.log('[BOT] Participantes vazios via API. Tentando fallback via evaluate...');
            participantes = await this._fetchGroupParticipantsRaw(targetId);
            if (participantes.length) {
                console.log(`[BOT] Fallback retornou ${participantes.length} participantes`);
            }
        }

        if (!grupoChat && !participantes.length) {
            throw new Error(`Grupo "${targetId}" nao encontrado.`);
        }

        console.log(`[BOT] ${participantes.length} participantes no grupo`);

        const contatos = await Promise.all(participantes.map(async (participant) => {
            const { id, number } = this._normalizeParticipant(participant);

            if (!id) {
                return null;
            }

            try {
                const contact = await this.client.getContactById(id);
                return {
                    id,
                    number,
                    name: contact.pushname || contact.name || contact.shortName || number,
                    isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin)
                };
            } catch (error) {
                console.log(`[BOT] Erro ao buscar contato ${id}: ${error.message}`);
                return {
                    id,
                    number,
                    name: number,
                    isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin)
                };
            }
        }));

        const validos = contatos.filter(Boolean);
        console.log(`[BOT] ${validos.length} contatos processados`);
        return validos.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    /**
     * Normaliza um participante de grupo (que pode vir como Wid da lib,
     * como string serializada ou ja no formato `{ id, number, isAdmin }`)
     * para `{ id, number }`, onde `id` e o JID serializado ("...@c.us").
     * @param {object|string} participant
     * @returns {{id: string|null, number: string|null}}
     */
    _normalizeParticipant(participant) {
        if (!participant) return { id: null, number: null };

        if (typeof participant === 'string') {
            return { id: participant, number: participant.split('@')[0] };
        }

        if (participant.idSerialized) {
            return { id: participant.idSerialized, number: participant.number || participant.idSerialized.split('@')[0] };
        }

        const rawId = participant.id;
        if (typeof rawId === 'string') {
            return { id: rawId, number: participant.number || rawId.split('@')[0] };
        }
        if (rawId && rawId._serialized) {
            return { id: rawId._serialized, number: participant.number || rawId.user || rawId._serialized.split('@')[0] };
        }
        if (rawId && rawId.user) {
            return { id: `${rawId.user}@${rawId.server || 'c.us'}`, number: participant.number || rawId.user };
        }

        return { id: participant.number ? `${participant.number}@c.us` : null, number: participant.number || null };
    }

    /**
     * Busca os participantes de um grupo direto no contexto do navegador
     * (`pupPage.evaluate`), sem depender dos wrappers de `getChats()`/`getChatById()`.
     * Usado como ultimo recurso por `listarParticipantesGrupo`.
     * @param {string} targetId ID serializado do grupo ("...@g.us").
     * @returns {Promise<Array<{id: string, number: string, isAdmin: boolean}>>}
     */
    async _fetchGroupParticipantsRaw(targetId) {
        const page = this.client.pupPage;
        if (!page) {
            console.log('[BOT] _fetchGroupParticipantsRaw: pagina do navegador indisponivel');
            return [];
        }

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const result = await page.evaluate(async (chatId) => {
                    try {
                        const wid = window.require('WAWebWidFactory').createWid(chatId);
                        let chat = window.require('WAWebCollections').Chat.get(wid);
                        if (!chat) {
                            const res = await window.require('WAWebFindChatAction').findOrCreateLatestChat(wid);
                            chat = res && res.chat;
                        }
                        if (!chat || !chat.groupMetadata) {
                            return { error: 'groupMetadata indisponivel' };
                        }

                        const metadata = chat.groupMetadata.serialize();
                        let toPn = null;
                        try {
                            toPn = window.require('WAWebLidMigrationUtils').toPn;
                        } catch (_) {
                            toPn = null;
                        }

                        const participants = (metadata.participants || []).map((p) => {
                            const pid = (toPn ? toPn(p.id) : null) || p.id;
                            const serialized = pid && pid._serialized
                                ? pid._serialized
                                : (typeof pid === 'string' ? pid : null);
                            return {
                                id: serialized,
                                number: pid && pid.user ? pid.user : (serialized ? serialized.split('@')[0] : null),
                                isAdmin: Boolean(p.isAdmin || p.isSuperAdmin)
                            };
                        }).filter(p => p.id);

                        return { participants };
                    } catch (e) {
                        return { error: e.message || String(e) };
                    }
                }, targetId);

                if (result && !result.error) {
                    return result.participants || [];
                }
                console.log(`[BOT] _fetchGroupParticipantsRaw tentativa ${attempt}: ${result ? result.error : 'sem resposta'}`);
            } catch (error) {
                console.log(`[BOT] _fetchGroupParticipantsRaw tentativa ${attempt} falhou: ${error.message}`);
            }

            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            }
        }

        return [];
    }

    formatarValor(valor) {
        const numero = Number(valor || 0);
        return numero.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
    }

    normalizarDestinoWhatsapp(numero) {
        const texto = String(numero || '').trim();
        if (!texto) {
            throw new Error('Numero de WhatsApp nao informado.');
        }

        if (texto.includes('@')) {
            return texto;
        }

        const digits = texto.replace(/\D/g, '');
        if (!digits) {
            throw new Error('Numero de WhatsApp invalido.');
        }

        return `${digits}@c.us`;
    }

    _montarOpcoesCobranca() {
        const valores = (this.config.valoresContribuicao || [])
            .map(value => String(value || '').trim())
            .filter(value => value && !/outro/i.test(value));
        const opcoes = [];
        const seen = new Set();
        for (const valor of valores) {
            const key = commandService.normalize(valor);
            if (!seen.has(key)) {
                seen.add(key);
                opcoes.push(valor);
            }
        }
        opcoes.push('Outro valor / insumos');
        opcoes.push('Justificar ausência');
        return opcoes.slice(0, 12);
    }

    _montarOpcoesValorPago(amount = 0) {
        const opcoes = [];
        const seen = new Set();
        const add = (value) => {
            const text = String(value || '').trim();
            const key = commandService.normalize(text);
            if (!text || seen.has(key)) return;
            seen.add(key);
            opcoes.push(text);
        };

        if (Number(amount) > 0) {
            add(this.formatarValor(amount));
        } else {
            add('Insumos (sem valor)');
        }

        for (const valor of this.config.valoresContribuicao || []) {
            if (!/outro/i.test(String(valor || ''))) add(valor);
        }
        add('Outro valor / insumos');
        return opcoes.slice(0, 12);
    }

    _privateChatId(record) {
        if (record?.chatId) return record.chatId;
        if (record?.participantNumber) {
            return this.normalizarDestinoWhatsapp(record.participantNumber);
        }
        return null;
    }

    _resolverOpcoesDoVoto(vote) {
        const pollOptions = vote?.parentMessage?.pollOptions || [];
        return (vote?.selectedOptions || []).map(option => {
            if (option.name) return option.name;
            const found = pollOptions.find(item => item.localId === option.localId);
            return found ? found.name : `Opção ${Number(option.localId) + 1}`;
        });
    }

    /**
     * Envia a cobranca individual (texto + enquete de valores).
     * A enquete fica registrada em `poll_tracking` para que o voto seja
     * correlacionado ao participante e ao mes.
     */
    async enviarCobrancaIndividual({ number, name, amountDue, message, participantId, monthYear, monthLabel }) {
        console.log(`[BOT] enviarCobrancaIndividual para ${number} (${name}) valor=${amountDue}`);
        if (!this.isReady) {
            console.log('[BOT] enviarCobrancaIndividual ERRO: WhatsApp nao esta pronto');
            throw new Error('WhatsApp ainda nao esta pronto. Inicie e autentique o bot primeiro.');
        }

        const destino = this.normalizarDestinoWhatsapp(number);
        const nome = String(name || 'tudo bem?').trim();
        const valor = Number(amountDue || 0);
        const valorTexto = valor > 0 ? this.formatarValor(valor) : 'sua contribuicao pendente';
        const mes = monthLabel || monthYear || new Date().toISOString().slice(0, 7);
        const textoBase = message || `Ola, ${nome}! Passando para lembrar da contribuicao da coleta FabLab deste mes (${mes}).\n\nValor de referencia: ${valorTexto}.\n\nDepois de pagar, marque na enquete abaixo o valor que voce contribuiu. Se contribuiu com insumos ou valor diferente, escolha "Outro valor / insumos". Se nao puder contribuir este mes, escolha "Justificar ausencia" e informe o motivo.`;
        const temPix = textoBase.toLowerCase().includes('pix');
        const texto = temPix
            ? textoBase
            : `${textoBase}\n\nPIX: ${this.config.pix.chave}\n${this.config.pix.copiaCola || ''}`.trim();

        console.log(`[BOT] Enviando mensagem para ${destino}...`);
        await this._send(destino, texto);

        let participant = null;
        if (participantId) {
            participant = await db.getParticipant(participantId);
        }
        if (!participant) {
            participant = await db.findParticipantByWhatsapp(number);
        }

        const opcoes = this._montarOpcoesCobranca();
        const titulo = `COBRANCA ${mes} - ${nome}`.slice(0, 200);
        const poll = new Poll(titulo, opcoes, { allowMultipleAnswers: false });
        let pollMessage = null;
        try {
            pollMessage = await this._send(destino, poll);
        } catch (error) {
            this.log(`Falha ao enviar enquete de valores para ${nome}: ${error.message}`, 'warn');
            const flowKey = `charge:${participant ? participant.id : destino}:${monthYear || new Date().toISOString().slice(0, 7)}:${Date.now()}`;
            const fallback = await db.createPollTracking({
                messageId: `manual:${destino}:${Date.now()}`,
                chatId: destino,
                participantId: participant ? participant.id : null,
                participantNumber: String(number).replace(/\D/g, ''),
                monthYear: monthYear || new Date().toISOString().slice(0, 7),
                kind: 'charge_value',
                flowKey,
                status: 'answered',
                selectedOption: 'resposta_manual'
            });
            await db.setBotState({
                chatId: destino,
                participantId: participant ? participant.id : null,
                monthYear: monthYear || new Date().toISOString().slice(0, 7),
                action: 'awaiting_custom_amount',
                payload: { flowKey, pollId: fallback.id }
            });
            await this._send(destino, 'Nao consegui enviar a enquete. Responda esta mensagem com o valor contribuido (ex: 20,00) ou descreva os insumos entregues.');
            return;
        }

        const messageId = pollMessage?.id?._serialized;
        if (messageId) {
            const flowKey = `charge:${participant ? participant.id : destino}:${monthYear || new Date().toISOString().slice(0, 7)}:${Date.now()}`;
            await db.createPollTracking({
                messageId,
                chatId: destino,
                participantId: participant ? participant.id : null,
                participantNumber: String(number).replace(/\D/g, ''),
                monthYear: monthYear || new Date().toISOString().slice(0, 7),
                kind: 'charge_value',
                flowKey,
                status: 'open'
            });
        }
        console.log('[BOT] Mensagem e enquete enviadas');
    }

    /**
     * Avisa o grupo antes da cobranca, mencionando todos os participantes.
     */
    async avisarCobrancaNoGrupo({ pending = [], monthYear, monthLabel } = {}) {
        if (!this.isReady) {
            throw new Error('WhatsApp ainda nao esta pronto.');
        }
        const chatId = await this._resolveGroupId();
        if (!chatId) {
            throw new Error(`Grupo "${this.config.grupoAlvo}" nao encontrado para o aviso de cobranca.`);
        }

        const mes = monthLabel || monthYear || new Date().toISOString().slice(0, 7);
        const lista = pending.length
            ? pending.slice(0, 40).map(p => `- ${p.name}${Number(p.amountDue || 0) > 0 ? ` (${this.formatarValor(p.amountDue)})` : ''}`).join('\n')
            : 'Todos ja estao em dia. Obrigado!';

        const texto = `🔔 *COBRANCA DA COPA - ${mes}*\n\n@todos\n\nAtencao, pessoal! Vou iniciar agora a cobranca individual no privado. Cada pessoa recebera a chave PIX e a enquete para marcar o valor contribuido.\n\n*Pendencias deste mes (${pending.length}):*\n${lista}\n\nAssim que pagar, marque o valor na enquete. Se contribuiu com insumos ou valor diferente, escolha *Outro valor / insumos*. Se nao puder contribuir, escolha *Justificar ausencia* e informe o motivo.\n\n_Equipe Copa FabLab_`;

        let participants = [];
        try {
            participants = await this.listarParticipantesGrupo(chatId);
        } catch (error) {
            this.log(`Nao foi possivel listar participantes para marcar todos: ${error.message}`, 'warn');
        }
        const mentions = participants.map(p => p.id).filter(Boolean);

        try {
            await this._send(chatId, texto, {
                mentions,
                groupMentions: [{ subject: 'todos', id: chatId }]
            });
        } catch (error) {
            this.log(`Envio com mencao falhou, reenviando sem mencao: ${error.message}`, 'warn');
            await this._send(chatId, texto.replace('@todos\n\n', ''));
        }
        console.log(`[BOT] Aviso de cobranca enviado ao grupo ${chatId} mencionando ${mentions.length} participantes.`);
    }

    async _onVoteUpdate(vote) {
        const messageId = vote?.parentMessage?.id?._serialized;
        if (!messageId) return;
        const record = await db.getPollTrackingByMessageId(messageId);
        if (!record) return;
        const options = this._resolverOpcoesDoVoto(vote);
        if (!options.length) return;
        await this._processPollVote(record, options);
    }

    async _processPollVote(record, optionNames) {
        if (!record || record.status === 'completed' || record.status === 'cancelled') {
            return;
        }

        if (record.kind === 'charge_value') {
            if (record.status !== 'open') return;
            await this._handleChargeValue(record, optionNames);
            return;
        }

        if (record.kind === 'payment_confirmed') {
            if (record.status === 'yes' || record.status === 'no') return;
            await this._handlePaymentConfirmed(record, optionNames[0]);
            return;
        }

        if (record.kind === 'payment_amount') {
            if (record.status === 'answered') return;
            await this._handlePaymentAmount(record, optionNames[0]);
        }
    }

    async _handleChargeValue(record, optionNames) {
        const option = String(optionNames[0] || '').trim();
        const normalized = commandService.normalize(option);
        const chatId = this._privateChatId(record);
        if (!chatId) return;

        await db.updatePollTracking(record.id, {
            selected_option: option,
            status: 'answered'
        });

        if (normalized.includes('justificar')) {
            await db.setBotState({
                chatId,
                participantId: record.participantId,
                monthYear: record.monthYear,
                action: 'awaiting_absence_reason',
                payload: { flowKey: record.flowKey, pollId: record.id }
            });
            await this._send(chatId, `Entendido. Qual o motivo da sua ausencia neste mes (${record.monthYear})?\n\nResponda esta mensagem com o motivo. Ele ficara registrado na lista de arrecadacao.`);
            return;
        }

        if (normalized.includes('outro') || normalized.includes('insumo')) {
            await db.setBotState({
                chatId,
                participantId: record.participantId,
                monthYear: record.monthYear,
                action: 'awaiting_custom_amount',
                payload: { flowKey: record.flowKey, pollId: record.id }
            });
            await this._send(chatId, 'Voce escolheu outro valor ou contribuicao com insumos.\n\nResponda esta mensagem com o valor contribuido (ex: 25,00) e, se quiser, descreva os insumos. Se contribuiu apenas com insumos, descreva o que levou.');
            return;
        }

        const amount = commandService.parseAmount(option);
        if (!amount || amount <= 0) {
            await db.setBotState({
                chatId,
                participantId: record.participantId,
                monthYear: record.monthYear,
                action: 'awaiting_custom_amount',
                payload: { flowKey: record.flowKey, pollId: record.id }
            });
            await this._send(chatId, `Nao consegui identificar o valor de "${option}". Responda esta mensagem com o valor contribuido (ex: 20,00).`);
            return;
        }

        await this._startPaymentConfirmation(record, amount, option, '');
    }

    async _startPaymentConfirmation(record, amount, selectedLabel, note = '') {
        const chatId = this._privateChatId(record);
        if (!chatId) return;

        const participant = record.participantId ? await db.getParticipant(record.participantId) : null;
        const monthYear = record.monthYear;
        const flowKey = record.flowKey;
        const valor = Number(amount) || 0;

        await db.updatePollTracking(record.id, {
            status: 'awaiting_confirmation',
            amount: valor,
            note: note || null
        });

        const current = participant ? await db.getMonthlyStatus(participant.id, monthYear) : null;
        if (participant && (!current || !['paid', 'justified'].includes(current.status))) {
            await db.upsertMonthlyStatus({
                participantId: participant.id,
                monthYear,
                status: 'awaiting_confirmation',
                amountPaid: 0,
                amountExpected: valor,
                note: note || '',
                source: 'whatsapp_enquete'
            });
        }

        const resumo = valor > 0
            ? `Voce marcou *${selectedLabel || this.formatarValor(valor)}*.\n\nAgora preciso confirmar: o pagamento ja foi realizado?`
            : `Voce marcou *${selectedLabel || 'insumos'}*.\n\nConfirme abaixo a entrega/contribuicao.`;

        await this._send(chatId, `${resumo}\n\nResponda as duas enquetes abaixo. A lista de arrecadacao so sera atualizada como *pago* depois que voce confirmar o pagamento.`);

        const confirmOptions = ['Sim, já paguei', 'Ainda não paguei'];
        const confirmPoll = new Poll(`Pagamento realizado? - ${monthYear}`, confirmOptions, { allowMultipleAnswers: false });
        try {
            const confirmMessage = await this._send(chatId, confirmPoll);
            if (confirmMessage?.id?._serialized) {
                await db.createPollTracking({
                    messageId: confirmMessage.id._serialized,
                    chatId,
                    participantId: record.participantId,
                    participantNumber: record.participantNumber,
                    monthYear,
                    kind: 'payment_confirmed',
                    flowKey,
                    status: 'open',
                    amount: valor
                });
            }
        } catch (error) {
            this.log(`Falha ao enviar enquete de confirmacao para ${participant?.name || chatId}: ${error.message}`, 'warn');
        }

        await new Promise(resolve => setTimeout(resolve, 800));

        const amountOptions = this._montarOpcoesValorPago(valor);
        const amountPoll = new Poll(`Qual valor voce pagou? - ${monthYear}`, amountOptions, { allowMultipleAnswers: false });
        try {
            const amountMessage = await this._send(chatId, amountPoll);
            if (amountMessage?.id?._serialized) {
                await db.createPollTracking({
                    messageId: amountMessage.id._serialized,
                    chatId,
                    participantId: record.participantId,
                    participantNumber: record.participantNumber,
                    monthYear,
                    kind: 'payment_amount',
                    flowKey,
                    status: 'open',
                    amount: valor,
                    note: note || null
                });
            }
        } catch (error) {
            this.log(`Falha ao enviar enquete de valor pago para ${participant?.name || chatId}: ${error.message}`, 'warn');
        }
    }

    async _handlePaymentConfirmed(record, option) {
        const normalized = commandService.normalize(option);
        const yes = normalized.startsWith('sim') || normalized.includes('paguei') || normalized.includes('realizado');
        const selection = yes ? 'Sim, já paguei' : 'Ainda não paguei';
        await db.updatePollTracking(record.id, {
            status: yes ? 'yes' : 'no',
            selected_option: selection
        });

        if (!yes) {
            const chatId = this._privateChatId(record);
            if (chatId) {
                await this._send(chatId, 'Sem problemas. Assim que o pagamento for feito, marque novamente a enquete *Pagamento realizado?* com a opcao *Sim, já paguei* para que eu atualize sua lista.');
            }
            return;
        }

        await this._maybeConfirmPayment(record.flowKey);
    }

    async _handlePaymentAmount(record, option) {
        const normalized = commandService.normalize(option);
        const chatId = this._privateChatId(record);

        if (normalized.includes('outro')) {
            await db.updatePollTracking(record.id, {
                status: 'awaiting_amount',
                selected_option: option
            });
            if (chatId) {
                await db.setBotState({
                    chatId,
                    participantId: record.participantId,
                    monthYear: record.monthYear,
                    action: 'awaiting_paid_amount',
                    payload: { flowKey: record.flowKey, pollId: record.id }
                });
                await this._send(chatId, 'Qual foi o valor pago? Responda esta mensagem apenas com o valor (ex: 22,50).');
            }
            return;
        }

        let amount = commandService.parseAmount(option);
        let note = '';
        if (normalized.includes('insumo') || normalized.includes('sem valor')) {
            amount = 0;
            note = option;
        }
        if (amount === null) {
            if (chatId) {
                await db.setBotState({
                    chatId,
                    participantId: record.participantId,
                    monthYear: record.monthYear,
                    action: 'awaiting_paid_amount',
                    payload: { flowKey: record.flowKey, pollId: record.id }
                });
                await this._send(chatId, `Nao consegui identificar o valor de "${option}". Responda apenas com o valor pago (ex: 20,00).`);
            }
            return;
        }

        await db.updatePollTracking(record.id, {
            status: 'answered',
            selected_option: option,
            amount,
            note: note || null
        });
        await this._maybeConfirmPayment(record.flowKey);
    }

    async _maybeConfirmPayment(flowKey) {
        const rows = await db.getPollsByFlow(flowKey);
        if (!rows.length) return;
        if (rows.every(row => row.status === 'completed')) return;

        const confirm = rows.find(row => row.kind === 'payment_confirmed');
        const amountRow = rows.find(row => row.kind === 'payment_amount');
        if (!confirm || confirm.status !== 'yes') return;
        if (!amountRow || amountRow.status !== 'answered') return;

        const reference = `poll:${flowKey}`;
        const existing = await db.getPaymentByReference(reference);
        const participant = confirm.participantId ? await db.getParticipant(confirm.participantId) : null;
        const amount = Number(amountRow.amount || 0);

        if (!existing && participant) {
            const now = new Date().toISOString();
            if (amount > 0) {
                await db.createPayment({
                    participantId: participant.id,
                    participantName: participant.name,
                    amount,
                    paidAt: now,
                    source: 'whatsapp_enquete',
                    reference
                });
            } else {
                await db.upsertMonthlyStatus({
                    participantId: participant.id,
                    monthYear: confirm.monthYear,
                    status: 'paid',
                    amountPaid: 0,
                    amountExpected: 0,
                    note: amountRow.note || 'Contribuicao em insumos',
                    source: 'whatsapp_enquete',
                    confirmedAt: now
                });
            }
        }

        for (const row of rows) {
            await db.updatePollTracking(row.id, { status: 'completed' });
        }

        const chatId = this._privateChatId(confirm);
        if (chatId) {
            await db.clearBotState(chatId);
            const resumoValor = amount > 0 ? this.formatarValor(amount) : 'contribuicao em insumos';
            await this._send(chatId, `✅ *Pagamento confirmado!*\n\n${participant ? participant.name : 'Contribuicao'}: ${resumoValor} (${confirm.monthYear}).\nSua lista de arrecadacao foi atualizada para *PAGO*. Obrigado! 💚`);
        }
        console.log(`[BOT] Pagamento confirmado via enquete: ${participant?.name || confirm.participantNumber} ${amount}`);
    }

    async _onIncomingMessage(message) {
        if (!message || message.isStatus) return;
        if (message.fromMe) {
            if (this._isSelfChat(message)) {
                await this._onMessageCreate(message);
            }
            return;
        }
        const chatId = message.from;
        if (!chatId || chatId.endsWith('@g.us')) return;

        const state = await db.getBotState(chatId);
        if (!state) return;

        const body = String(message.body || '').trim();
        if (!body) return;

        if (state.action === 'awaiting_absence_reason') {
            const reason = body;
            await db.setJustification(state.participantId, state.monthYear, reason, 'whatsapp_enquete');
            await db.clearBotState(chatId);
            if (state.payload?.flowKey) {
                const rows = await db.getPollsByFlow(state.payload.flowKey);
                for (const row of rows) {
                    await db.updatePollTracking(row.id, { status: 'completed' });
                }
            }
            await this._send(chatId, `✅ *Justificativa registrada* (${state.monthYear}):\n${reason}\n\nSua lista de arrecadacao foi atualizada para *JUSTIFICADO*. Obrigado por avisar!`);
            return;
        }

        if (state.action === 'awaiting_custom_amount') {
            const record = state.payload?.pollId ? await db.getPollTracking(state.payload.pollId) : null;
            if (!record) {
                await db.clearBotState(chatId);
                return;
            }
            const amount = commandService.parseAmount(body);
            await db.clearBotState(chatId);
            if (amount && amount > 0) {
                await this._startPaymentConfirmation(record, amount, this.formatarValor(amount), body);
            } else {
                await this._startPaymentConfirmation(record, 0, 'Insumos', body);
            }
            return;
        }

        if (state.action === 'awaiting_paid_amount') {
            const record = state.payload?.pollId ? await db.getPollTracking(state.payload.pollId) : null;
            const amount = commandService.parseAmount(body);
            if (!record || amount === null) {
                await this._send(chatId, 'Nao consegui identificar o valor. Responda apenas com o valor pago (ex: 20,00).');
                return;
            }
            await db.clearBotState(chatId);
            await db.updatePollTracking(record.id, {
                status: 'answered',
                selected_option: this.formatarValor(amount),
                amount
            });
            await this._maybeConfirmPayment(record.flowKey);
        }
    }

    _getSelfId() {
        const wid = this.client?.info?.wid;
        if (!wid) return null;
        return wid._serialized || (wid.user ? `${wid.user}@c.us` : null);
    }

    _isSelfChat(message) {
        if (!message) return false;
        if (message.fromMe && message.from && message.from === message.to) return true;
        const selfId = this._getSelfId();
        if (!selfId) return false;
        const chatId = message.id?.remote || message.to || '';
        return message.to === selfId || chatId === selfId;
    }

    async _onMessageCreate(message) {
        if (!message || !message.fromMe) return;
        if (!this._isSelfChat(message)) return;

        const messageId = message.id?._serialized;
        if (messageId && this._outgoingMessageIds.has(messageId)) return;
        if (messageId && this._processedMessageIds.has(messageId)) return;

        const body = String(message.body || '').trim();
        if (!body || body.startsWith('🤖')) return;

        if (messageId) {
            this._processedMessageIds.add(messageId);
            if (this._processedMessageIds.size > 500) {
                const first = this._processedMessageIds.values().next().value;
                this._processedMessageIds.delete(first);
            }
        }

        const result = await commandService.execute(body, {
            monthYear: new Date().toISOString().slice(0, 7),
            source: 'whatsapp_comando'
        });
        if (!result.handled) return;

        const target = message.to || this._getSelfId();
        if (target) {
            await this._send(target, `🤖 ${result.reply}`);
        }
    }

    /**
     * Le as enquetes abertas para recuperar votos que aconteceram enquanto o
     * bot estava offline ou que nao geraram evento `vote_update`.
     */
    async syncOpenPolls() {
        if (!this.isReady || this._pollSyncRunning) {
            return { checked: 0, processed: 0 };
        }
        this._pollSyncRunning = true;
        let processed = 0;
        try {
            const rows = await db.getOpenPolls(30);
            for (const row of rows) {
                if (!row.messageId) continue;
                try {
                    const votes = await this.client.getPollVotes(row.messageId);
                    if (!votes.length) continue;
                    const voterNumber = String(row.participantNumber || '').replace(/\D/g, '');
                    const vote = votes.slice().reverse().find(v => {
                        const digits = String(v.voter || '').replace(/\D/g, '');
                        return voterNumber && digits && (digits.endsWith(voterNumber) || voterNumber.endsWith(digits));
                    }) || votes[votes.length - 1];
                    const options = this._resolverOpcoesDoVoto(vote);
                    if (!options.length) continue;
                    const fresh = await db.getPollTracking(row.id);
                    await this._processPollVote(fresh, options);
                    processed++;
                } catch (error) {
                    // Enquetes antigas podem nao existir mais no WhatsApp.
                    this.log(`Nao foi possivel ler a enquete ${row.id}: ${error.message}`, 'warn');
                }
            }
            if (processed > 0) {
                this.log(`${processed} enquete(s) sincronizada(s) pelo WhatsApp.`);
            }
            return { checked: rows.length, processed };
        } finally {
            this._pollSyncRunning = false;
        }
    }

    async _resolveGroupId(grupoAlvo = null) {
        const alvo = String(grupoAlvo || this.config.grupoAlvo || '').trim();
        console.log(`[BOT] _resolveGroupId alvo="${alvo}"`);

        if (!alvo) return null;

        if (alvo.endsWith('@g.us')) {
            console.log('[BOT] ID direto @g.us');
            return alvo;
        }

        const grupos = await this.listarGrupos();
        const match = grupos.find(g => (g.name || '').toLowerCase() === alvo.toLowerCase())
            || grupos.find(g => (g.name || '').toLowerCase().includes(alvo.toLowerCase()));

        if (match) {
            console.log(`[BOT] Grupo resolvido: "${match.name}" -> ${match.id}`);
            return match.id;
        }

        console.log(`[BOT] Grupo "${alvo}" nao encontrado entre ${grupos.length} grupos`);
        return null;
    }

    async enviarMensagemGrupo(nomeOuId, mensagem) {
        console.log(`[BOT] enviarMensagemGrupo para "${nomeOuId}"`);
        if (!this.isReady) {
            console.log('[BOT] enviarMensagemGrupo ERRO: WhatsApp nao esta pronto');
            throw new Error('WhatsApp ainda nao esta pronto. Inicie e autentique o bot primeiro.');
        }

        const chatId = await this._resolveGroupId(nomeOuId);
        if (!chatId) {
            console.log(`[BOT] Grupo "${nomeOuId || this.config.grupoAlvo}" nao encontrado`);
            throw new Error(`Grupo "${nomeOuId || this.config.grupoAlvo}" nao encontrado.`);
        }

        console.log(`[BOT] Enviando mensagem para ${chatId}...`);
        await this.client.sendMessage(chatId, mensagem);
        console.log('[BOT] Mensagem enviada para o grupo');
    }

    gerarDatasMensal() {
        const agora = new Date();
        const mesAtual = agora.getMonth() + 1;
        const anoAtual = agora.getFullYear();

        return {
            abertura: `01/${String(mesAtual).padStart(2, '0')}/${anoAtual}`,
            fechamento: `15/${String(mesAtual).padStart(2, '0')}/${anoAtual}`,
            compras: `10/${String(mesAtual).padStart(2, '0')}/${anoAtual}`
        };
    }

    async enviarCampanha(chatId) {
        const datas = this.gerarDatasMensal();
        this.isCampaignRunning = true;

        try {
            try { await this.client.sendSeen(chatId); } catch (_) { /* pode nao suportar */ }
            await new Promise(resolve => setTimeout(resolve, 2000));

            await this.client.sendMessage(chatId, `*COPA FABLAB - CAMPANHA DE COLETA*

Ola, pessoal! Chegou o momento de renovarmos nossos insumos essenciais na copa.

*DATAS IMPORTANTES:*
Abertura: ${datas.abertura}
Fechamento: ${datas.fechamento}
Compras: ate ${datas.compras}

*Quem pode contribuir:*
- Bolsistas
- Professores
- Usuarios frequentes

*Como funciona:*
1. Faca o pagamento via PIX ou cartao
2. Escolha o valor na enquete de contribuicao
3. Selecione seu nome na enquete de identificacao

Vamos juntos manter nossa copa sempre abastecida. @todos`);

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreMensagens));

            await this.client.sendMessage(chatId, `*PAGAMENTO VIA PIX*

*Chave PIX:*`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.client.sendMessage(chatId, this.config.pix.chave);
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.client.sendMessage(chatId, this.config.pix.copiaCola);

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreMensagens));

            const devedores = this.config.nomes.devedores.length
                ? this.config.nomes.devedores.map(nome => `- ${nome}`).join('\n')
                : 'Sem devedores cadastrados.';

            await this.client.sendMessage(chatId, `*NAO DE NEM AGUA*

${devedores}

*Atencao aos devedores com 2 meses ou mais acumulados serao chamados no RH @todos*`);

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreMensagens));

            await this._criarMultiplasEnquetes(chatId,
                'PROFESSORES - CONFIRME SEU NOME',
                this.config.nomes.professores,
                false
            );

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));

            await this._criarMultiplasEnquetes(chatId,
                'BOLSISTAS - CONFIRME SEU NOME',
                this.config.nomes.bolsistas,
                false
            );

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));

            await this._criarMultiplasEnquetes(chatId,
                'USUARIOS FREQUENTES E VOLUNTARIOS - CONFIRME SEU NOME',
                this.config.nomes.usuariosFrequentes,
                false
            );

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));

            await this._criarEnquete(chatId,
                'SELECIONE O VALOR DA SUA CONTRIBUICAO',
                this.config.valoresContribuicao,
                false
            );

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));

            await this.client.sendMessage(chatId, `*INFORMACOES IMPORTANTES*

Todo valor sera usado para reposicao de insumos.
Comprovante sera enviado no grupo.
Duvidas? Chama no particular.
Marque seu nome e o valor apenas apos mandar a coleta.

Vamos manter a copa abastecida!`);
        } finally {
            this.isCampaignRunning = false;
        }
    }

    async _criarEnquete(chatId, titulo, opcoes, allowMultipleAnswers = false) {
        try {
            const poll = new Poll(titulo, opcoes, { allowMultipleAnswers });
            return await this.client.sendMessage(chatId, poll);
        } catch (error) {
            console.error('Erro ao criar enquete. Enviando formato manual:', error.message);
            return await this._criarEnqueteFallback(chatId, titulo, opcoes);
        }
    }

    async _criarEnqueteFallback(chatId, titulo, opcoes) {
        const opcoesFormatadas = opcoes.map((opcao, index) => `${index + 1}. ${opcao}`).join('\n');
        return await this.client.sendMessage(chatId, `*${titulo}*\n\n${opcoesFormatadas}\n\n_Use os numeros para votar_`);
    }

    async _criarMultiplasEnquetes(chatId, tituloBase, listaNomes, allowMultipleAnswers = false) {
        const chunks = this.dividirArray(listaNomes, this.config.maxOpcoesPorEnquete);

        for (let i = 0; i < chunks.length; i++) {
            if (chunks[i].length < 2) continue;

            const titulo = chunks.length > 1 ? `${tituloBase} (${i + 1}/${chunks.length})` : tituloBase;
            await this._criarEnquete(chatId, titulo, chunks[i], allowMultipleAnswers);

            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));
            }
        }
    }

    async iniciarColeta() {
        console.log('[BOT] iniciarColeta()');
        if (!this.isReady) {
            console.log('[BOT] iniciarColeta ERRO: WhatsApp nao esta pronto');
            throw new Error('WhatsApp ainda nao esta pronto. Inicie e autentique o bot primeiro.');
        }

        console.log(`[BOT] Buscando grupo alvo: "${this.config.grupoAlvo}"...`);
        const chatId = await this._resolveGroupId();
        if (!chatId) {
            console.log(`[BOT] Grupo "${this.config.grupoAlvo}" nao encontrado`);
            throw new Error(`Grupo "${this.config.grupoAlvo}" nao encontrado.`);
        }

        console.log(`[BOT] Iniciando campanha no grupo ${chatId}...`);
        await this.enviarCampanha(chatId);
        console.log('[BOT] Campanha concluida');
        return chatId;
    }

    async startProcess() {
        console.log('[BOT] startProcess: aguardando 5s...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('[BOT] startProcess: iniciando coleta...');
        return await this.iniciarColeta();
    }

    async fecharNavegador() {
        console.log('[BOT] fecharNavegador()');
        if (this._pollSyncTimer) {
            clearInterval(this._pollSyncTimer);
            this._pollSyncTimer = null;
        }
        try {
            await this.client.destroy();
            console.log('[BOT] Client destruido');
        } catch (error) {
            console.log(`[BOT] Aviso ao fechar navegador: ${error.message}`);
            this.log(`Aviso ao fechar navegador: ${error.message}`, 'warn');
        }
        await this._killOrphanChrome();
        this.isReady = false;
        this.isAuthenticated = false;
        this.isInitializing = false;
        this.statusText = 'parado';
        console.log('[BOT] Navegador fechado');
    }

    /**
     * Apaga a sessao salva do WhatsApp, forcando novo QR Code.
     *
     * Importante: `this.sessionDir` e o ponto de montagem de um volume Docker
     * (`./.wwebjs_auth_nova:/app/.wwebjs_auth_nova`). Remover o proprio
     * diretorio de montagem falha com `EBUSY`, por isso limpamos apenas o
     * conteudo. O navegador tambem e encerrado antes, pois pode estar segurando
     * arquivos (ex: `SingletonLock`).
     * @returns {Promise<boolean>} true se havia algo para limpar.
     */
    async limparSessao() {
        console.log(`[BOT] limparSessao: ${this.sessionDir}`);

        try {
            await this.client.destroy();
        } catch (_) {
            // Ignorado: o cliente pode nao estar inicializado.
        }
        await this._killOrphanChrome();

        if (!fs.existsSync(this.sessionDir)) {
            console.log('[BOT] Diretorio de sessao nao existe');
            return false;
        }

        console.log('[BOT] Removendo conteudo da sessao...');
        const entries = fs.readdirSync(this.sessionDir);
        for (const entry of entries) {
            const target = path.join(this.sessionDir, entry);
            await this._removeWithRetry(target);
        }
        console.log('[BOT] Sessao limpa');
        return true;
    }

    /**
     * Remove arquivo/diretorio tolerando `EBUSY`/`ENOTEMPTY` transitorios
     * (comum quando o Chrome acabou de ser encerrado e ainda solta arquivos).
     * @param {string} target Caminho absoluto a remover.
     */
    async _removeWithRetry(target) {
        const delays = [0, 200, 500, 1000];
        for (let i = 0; i < delays.length; i++) {
            if (delays[i]) {
                await new Promise(resolve => setTimeout(resolve, delays[i]));
            }
            try {
                fs.rmSync(target, { recursive: true, force: true });
                return;
            } catch (error) {
                if (i === delays.length - 1) {
                    console.warn(`[BOT] Falha ao remover ${target}: ${error.message}`);
                }
            }
        }
    }
}

module.exports = ColetaCopaBot;
