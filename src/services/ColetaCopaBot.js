const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const defaultConfig = require('../config/defaultConfig');

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
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
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

                const isRecoverable = 
                    error.message.includes('Execution context was destroyed') ||
                    error.message.includes('already running') ||
                    error.message.includes('Protocol error') ||
                    error.message.includes('Navigation failed') ||
                    error.message.includes('Target closed');

                if (!isRecoverable || attempt === maxRetries) {
                    // On last attempt for recoverable errors, try clearing session
                    if (isRecoverable && attempt === maxRetries) {
                        this.log('Todas as tentativas falharam. Limpando sessao corrompida...', 'warn');
                        await this.limparSessao();
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

        if (!grupoChat) {
            throw new Error(`Grupo "${targetId}" nao encontrado.`);
        }

        const participantes = grupoChat.participants || [];
        console.log(`[BOT] ${participantes.length} participantes no grupo`);

        const contatos = await Promise.all(participantes.map(async (participant) => {
            const id = participant.id && participant.id._serialized
                ? participant.id._serialized
                : `${participant.id.user}@${participant.id.server || 'c.us'}`;

            try {
                const contact = await this.client.getContactById(id);
                return {
                    id,
                    number: participant.id.user,
                    name: contact.pushname || contact.name || contact.shortName || participant.id.user,
                    isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin)
                };
            } catch (error) {
                console.log(`[BOT] Erro ao buscar contato ${id}: ${error.message}`);
                return {
                    id,
                    number: participant.id.user,
                    name: participant.id.user,
                    isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin)
                };
            }
        }));

        console.log(`[BOT] ${contatos.length} contatos processados`);
        return contatos.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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

    async enviarCobrancaIndividual({ number, name, amountDue, message }) {
        console.log(`[BOT] enviarCobrancaIndividual para ${number} (${name}) valor=${amountDue}`);
        if (!this.isReady) {
            console.log('[BOT] enviarCobrancaIndividual ERRO: WhatsApp nao esta pronto');
            throw new Error('WhatsApp ainda nao esta pronto. Inicie e autentique o bot primeiro.');
        }

        const destino = this.normalizarDestinoWhatsapp(number);
        const nome = String(name || 'tudo bem?').trim();
        const valor = Number(amountDue || 0);
        const valorTexto = valor > 0 ? this.formatarValor(valor) : 'sua contribuicao pendente';
        const textoBase = message || `Ola, ${nome}! Passando para lembrar da contribuicao da coleta FabLab.\n\nObrigado por ajudar a manter a copa abastecida.`;
        const temPix = textoBase.toLowerCase().includes('pix');
        const texto = temPix
            ? textoBase
            : `${textoBase}\n\nPIX: ${this.config.pix.chave}`;

        console.log(`[BOT] Enviando mensagem para ${destino}...`);
        await this.client.sendMessage(destino, texto);
        console.log('[BOT] Mensagem enviada');
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

    async limparSessao() {
        console.log(`[BOT] limparSessao: ${this.sessionDir}`);
        if (fs.existsSync(this.sessionDir)) {
            console.log('[BOT] Removendo diretorio de sessao...');
            fs.rmSync(this.sessionDir, { recursive: true, force: true });
            fs.mkdirSync(this.sessionDir, { recursive: true });
            console.log('[BOT] Sessao limpa');
            return true;
        }

        console.log('[BOT] Diretorio de sessao nao existe');
        return false;
    }
}

module.exports = ColetaCopaBot;
