const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const defaultConfig = require('../config/defaultConfig');

class ColetaCopaBot {
    constructor(options = {}) {
        this.sessionDir = path.join(__dirname, '..', '..', '.wwebjs_auth_nova');
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
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

        this._createClient();
        this.setupEvents();
    }

    _createClient() {
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'coleta-copa-bot',
                dataPath: this.sessionDir
            }),
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
            },
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
        try {
            // Remove SingletonLock files that block new browser launches
            const lockFile = path.join(sessionBotDir, 'SingletonLock');
            if (fs.existsSync(lockFile)) {
                fs.rmSync(lockFile, { force: true });
                this.log('Lock do navegador anterior removido.', 'warn');
            }
            // Try to kill any orphan chrome processes using this data dir
            try {
                execSync(`pkill -f "${sessionBotDir}"`, { timeout: 5000, stdio: 'ignore' });
                this.log('Processos Chrome orfaos finalizados.', 'warn');
            } catch (_) {
                // No matching processes — that's fine
            }
            // Small wait to ensure OS releases resources
            return new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            this.log(`Aviso ao limpar processos anteriores: ${error.message}`, 'warn');
            return Promise.resolve();
        }
    }

    setupEvents() {
        this.client.on('qr', (qr) => {
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
            this.log('WhatsApp conectado e pronto.');
            this.isReady = true;
            this.isInitializing = false;
            this.lastQr = null;
            this.lastQrDataUrl = null;
            this.statusText = 'conectado';

            if (this.autoStartCampaign) {
                this.startProcess();
            }
        });

        this.client.on('authenticated', () => {
            this.log('WhatsApp autenticado.');
            this.isAuthenticated = true;
            this.lastQr = null;
            this.lastQrDataUrl = null;
            this.statusText = 'autenticado';
        });

        this.client.on('auth_failure', (message) => {
            this.log(`Falha na autenticacao: ${message}`, 'error');
            this.lastError = message;
            this.isAuthenticated = false;
            this.isReady = false;
            this.isInitializing = false;
            this.statusText = 'falha_autenticacao';
        });

        this.client.on('disconnected', (reason) => {
            this.log(`WhatsApp desconectado: ${reason}`, 'warn');
            this.lastError = reason;
            this.isReady = false;
            this.isAuthenticated = false;
            this.isInitializing = false;
            this.statusText = 'desconectado';
        });

        this.client.on('loading_screen', (percent, message) => {
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
        if (this.isReady || this.isInitializing) {
            return this.getStatus();
        }

        this.isInitializing = true;
        this.statusText = 'inicializando';
        const hasSession = fs.existsSync(this.sessionDir) && fs.readdirSync(this.sessionDir).length > 0;
        this.log(hasSession ? 'Sessao encontrada. Restaurando WhatsApp...' : 'Nova sessao. Aguardando QR Code.');

        const maxRetries = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.log(`Inicializando cliente WhatsApp (tentativa ${attempt}/${maxRetries}) em modo ${this.headless ? 'headless' : 'com navegador'}.`);

            try {
                // Kill any orphan Chrome processes from previous failed attempts
                await this._killOrphanChrome();

                // Re-create client on retry to avoid stale internal state
                if (attempt > 1) {
                    this._createClient();
                    this.setupEvents();
                }

                await this.client.initialize();
                lastError = null;
                break; // Success!
            } catch (error) {
                lastError = error;
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

    async criarEnquete(grupo, titulo, opcoes, allowMultipleAnswers = false) {
        try {
            const poll = new Poll(titulo, opcoes, { allowMultipleAnswers });
            return await grupo.sendMessage(poll);
        } catch (error) {
            console.error('Erro ao criar enquete. Enviando formato manual:', error.message);
            return await this.criarEnqueteFallback(grupo, titulo, opcoes);
        }
    }

    async criarEnqueteFallback(grupo, titulo, opcoes) {
        const opcoesFormatadas = opcoes.map((opcao, index) => `${index + 1}. ${opcao}`).join('\n');
        return await grupo.sendMessage(`*${titulo}*\n\n${opcoesFormatadas}\n\n_Use os numeros para votar_`);
    }

    dividirArray(array, tamanhoChunk) {
        const chunks = [];
        for (let i = 0; i < array.length; i += tamanhoChunk) {
            chunks.push(array.slice(i, i + tamanhoChunk));
        }
        return chunks;
    }

    async criarMultiplasEnquetes(grupo, tituloBase, listaNomes, allowMultipleAnswers = false) {
        const chunks = this.dividirArray(listaNomes, this.config.maxOpcoesPorEnquete);

        for (let i = 0; i < chunks.length; i++) {
            if (chunks[i].length < 2) {
                continue;
            }

            const titulo = chunks.length > 1 ? `${tituloBase} (${i + 1}/${chunks.length})` : tituloBase;
            await this.criarEnquete(grupo, titulo, chunks[i], allowMultipleAnswers);

            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));
            }
        }
    }

    async listarGrupos() {
        if (!this.isReady) {
            throw new Error('WhatsApp ainda nao esta pronto.');
        }

        const chats = await this.client.getChats();
        return chats
            .filter(chat => chat.isGroup)
            .map(chat => ({
                id: chat.id._serialized,
                name: chat.name,
                participants: chat.participants ? chat.participants.length : null
            }))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    async encontrarGrupoCopaFabLab(grupoAlvo = null) {
        const alvoOriginal = String(grupoAlvo || this.config.grupoAlvo || '').trim();

        if (alvoOriginal.endsWith('@g.us')) {
            return await this.client.getChatById(alvoOriginal);
        }

        const grupos = await this.listarGrupos();
        const alvo = alvoOriginal.toLowerCase();
        const grupoInfo = alvo
            ? grupos.find(grupo => (grupo.name || '').toLowerCase() === alvo)
                || grupos.find(grupo => (grupo.name || '').toLowerCase().includes(alvo))
            : grupos.find(grupo => (grupo.name || '').toLowerCase().includes('copa'));

        if (!grupoInfo) {
            return null;
        }

        return await this.client.getChatById(grupoInfo.id);
    }

    async listarParticipantesGrupo(groupId = null) {
        if (!this.isReady) {
            throw new Error('WhatsApp ainda nao esta pronto.');
        }

        const grupo = await this.encontrarGrupoCopaFabLab(groupId);
        if (!grupo) {
            throw new Error(`Grupo "${this.config.grupoAlvo}" nao encontrado.`);
        }

        const participantes = grupo.participants || [];
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
                return {
                    id,
                    number: participant.id.user,
                    name: participant.id.user,
                    isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin)
                };
            }
        }));

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
        if (!this.isReady) {
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

        await this.client.sendMessage(destino, texto);
    }

    async enviarMensagemGrupo(nomeOuId, mensagem) {
        if (!this.isReady) {
            throw new Error('WhatsApp ainda nao esta pronto. Inicie e autentique o bot primeiro.');
        }

        const grupo = await this.encontrarGrupoCopaFabLab(nomeOuId);
        if (!grupo) {
            throw new Error(`Grupo "${nomeOuId || this.config.grupoAlvo}" nao encontrado.`);
        }

        await grupo.sendMessage(mensagem);
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

    async enviarCampanha(grupo) {
        const datas = this.gerarDatasMensal();
        this.isCampaignRunning = true;

        try {
            await grupo.sendSeen();
            await new Promise(resolve => setTimeout(resolve, 2000));

            await grupo.sendMessage(`*COPA FABLAB - CAMPANHA DE COLETA*

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

            await grupo.sendMessage(`*PAGAMENTO VIA PIX*

*Chave PIX:*`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            await grupo.sendMessage(this.config.pix.chave);
            await new Promise(resolve => setTimeout(resolve, 1000));
            await grupo.sendMessage(this.config.pix.copiaCola);

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreMensagens));

            const devedores = this.config.nomes.devedores.length
                ? this.config.nomes.devedores.map(nome => `- ${nome}`).join('\n')
                : 'Sem devedores cadastrados.';

            await grupo.sendMessage(`*NAO DE NEM AGUA*

${devedores}

*Atencao aos devedores com 2 meses ou mais acumulados serao chamados no RH @todos*`);

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreMensagens));

            await this.criarMultiplasEnquetes(
                grupo,
                'PROFESSORES - CONFIRME SEU NOME',
                this.config.nomes.professores,
                false
            );

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));

            await this.criarMultiplasEnquetes(
                grupo,
                'BOLSISTAS - CONFIRME SEU NOME',
                this.config.nomes.bolsistas,
                false
            );

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));

            await this.criarMultiplasEnquetes(
                grupo,
                'USUARIOS FREQUENTES E VOLUNTARIOS - CONFIRME SEU NOME',
                this.config.nomes.usuariosFrequentes,
                false
            );

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));

            await this.criarEnquete(
                grupo,
                'SELECIONE O VALOR DA SUA CONTRIBUICAO',
                this.config.valoresContribuicao,
                false
            );

            await new Promise(resolve => setTimeout(resolve, this.config.delays.entreEnquetes));

            await grupo.sendMessage(`*INFORMACOES IMPORTANTES*

Todo valor sera usado para reposicao de insumos.
Comprovante sera enviado no grupo.
Duvidas? Chama no particular.
Marque seu nome e o valor apenas apos mandar a coleta.

Vamos manter a copa abastecida!`);
        } finally {
            this.isCampaignRunning = false;
        }
    }

    async iniciarColeta() {
        if (!this.isReady) {
            throw new Error('WhatsApp ainda nao esta pronto. Inicie e autentique o bot primeiro.');
        }

        const grupo = await this.encontrarGrupoCopaFabLab();
        if (!grupo) {
            throw new Error(`Grupo "${this.config.grupoAlvo}" nao encontrado.`);
        }

        await this.enviarCampanha(grupo);
        return grupo.name;
    }

    async startProcess() {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return await this.iniciarColeta();
    }

    async fecharNavegador() {
        try {
            await this.client.destroy();
        } catch (error) {
            this.log(`Aviso ao fechar navegador: ${error.message}`, 'warn');
        }
        await this._killOrphanChrome();
        this.isReady = false;
        this.isAuthenticated = false;
        this.isInitializing = false;
        this.statusText = 'parado';
    }

    async limparSessao() {
        if (fs.existsSync(this.sessionDir)) {
            fs.rmSync(this.sessionDir, { recursive: true, force: true });
            fs.mkdirSync(this.sessionDir, { recursive: true });
            return true;
        }

        return false;
    }
}

module.exports = ColetaCopaBot;
