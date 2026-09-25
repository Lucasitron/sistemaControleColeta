const db = require('../db/database');
const { getBot, resetBot } = require('./botManager');
const { buildFinancialReport } = require('./reportService');

async function getConfiguredBot() {
    console.log('[BOT_SERVICE] getConfiguredBot: buscando config do banco...');
    const config = await db.getBotConfig();
    console.log('[BOT_SERVICE] Config obtida:', JSON.stringify({ grupoAlvo: config.grupoAlvo, pix: config.pix?.chave ? '***' : 'n/a' }));
    const bot = getBot(config);
    return { config, bot };
}

async function getStatus() {
    console.log('[BOT_SERVICE] getStatus');
    const { bot } = await getConfiguredBot();
    const status = bot.getStatus();
    console.log('[BOT_SERVICE] Status:', JSON.stringify({ status: status.status, isReady: status.isReady, isAuthenticated: status.isAuthenticated }));
    return { ...status, logs: bot.getLogs() };
}

async function startBot() {
    console.log('[BOT_SERVICE] startBot: iniciando bot...');
    const { bot } = await getConfiguredBot();
    await bot.iniciar();
    const status = bot.getStatus();
    console.log('[BOT_SERVICE] startBot concluido. Status:', status.status);
    return { ...status, logs: bot.getLogs() };
}

function ensureBotReady(bot) {
    if (!bot.getStatus().isReady) {
        console.log('[BOT_SERVICE] ensureBotReady: WhatsApp NAO esta pronto');
        const error = new Error('WhatsApp ainda nao esta pronto. Clique em Iniciar WhatsApp, escaneie o QR Code e aguarde conectar.');
        error.statusCode = 409;
        throw error;
    }
    console.log('[BOT_SERVICE] ensureBotReady: OK');
}

async function listGroups() {
    console.log('[BOT_SERVICE] listGroups chamado');
    const { bot, config } = await getConfiguredBot();
    console.log(`[BOT_SERVICE] listGroups - isReady=${bot.getStatus().isReady} grupoAlvo="${config.grupoAlvo}"`);
    ensureBotReady(bot);
    try {
        const grupos = await bot.listarGrupos();
        console.log(`[BOT_SERVICE] listGroups: ${grupos.length} grupos retornados`);
        if (grupos.length > 0) {
            grupos.forEach(g => console.log(`[BOT_SERVICE]   - "${g.name}" (${g.id})`));
        }
        return grupos;
    } catch (error) {
        console.error('[BOT_SERVICE] listGroups ERRO:', error.message);
        throw error;
    }
}

async function listGroupParticipants(groupId) {
    console.log(`[BOT_SERVICE] listGroupParticipants chamado com groupId="${groupId}"`);
    const { bot, config } = await getConfiguredBot();
    console.log(`[BOT_SERVICE] listGroupParticipants - isReady=${bot.getStatus().isReady} grupoAlvo="${config.grupoAlvo}"`);
    ensureBotReady(bot);
    try {
        const participantes = await bot.listarParticipantesGrupo(groupId);
        console.log(`[BOT_SERVICE] listGroupParticipants: ${participantes.length} participantes retornados`);
        return participantes;
    } catch (error) {
        console.error('[BOT_SERVICE] listGroupParticipants ERRO:', error.message);
        throw error;
    }
}

async function sendIndividualCharge(data) {
    console.log('[BOT_SERVICE] sendIndividualCharge:', JSON.stringify({ number: data.number, name: data.name, amountDue: data.amountDue }));
    const { bot } = await getConfiguredBot();
    ensureBotReady(bot);
    await bot.enviarCobrancaIndividual(data);
    console.log('[BOT_SERVICE] sendIndividualCharge: enviada');
    return { ok: true, message: 'Cobranca individual enviada.' };
}

async function startCampaign() {
    console.log('[BOT_SERVICE] startCampaign');
    const { bot } = await getConfiguredBot();
    const campaignId = await db.createCampaign('executando', null, 'Campanha iniciada pela interface.');
    console.log('[BOT_SERVICE] Campanha criada ID:', campaignId);

    bot.iniciarColeta()
        .then(async (groupName) => {
            console.log(`[BOT_SERVICE] Campanha ${campaignId} concluida no grupo: ${groupName}`);
            await db.finishCampaign(campaignId, 'concluida', `Campanha enviada para ${groupName}.`, groupName);
        })
        .catch(async (error) => {
            console.error(`[BOT_SERVICE] Campanha ${campaignId} ERRO:`, error);
            await db.finishCampaign(campaignId, 'erro', error.message);
        });

    return {
        ok: true,
        campaignId,
        message: 'Campanha iniciada. Acompanhe os logs do WhatsApp na interface.'
    };
}

async function sendReport(month) {
    console.log('[BOT_SERVICE] sendReport mes:', month);
    const { config, bot } = await getConfiguredBot();
    const data = await db.getDashboard(month);
    console.log('[BOT_SERVICE] Dados do dashboard obtidos');
    await bot.enviarMensagemGrupo(config.grupoColeta || config.grupoAlvo, buildFinancialReport(data));
    console.log('[BOT_SERVICE] Relatorio enviado');
    return { ok: true, message: 'Relatório enviado com sucesso.' };
}

async function clearSession() {
    console.log('[BOT_SERVICE] clearSession');
    const { bot } = await getConfiguredBot();
    ensureBotReady(bot);
    await bot.limparSessao();
    await resetBot();
    console.log('[BOT_SERVICE] Sessao limpa');
    return { ok: true };
}

module.exports = {
    getStatus,
    startBot,
    listGroups,
    listGroupParticipants,
    sendIndividualCharge,
    startCampaign,
    sendReport,
    clearSession
};
