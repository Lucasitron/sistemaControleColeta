const db = require('../db/database');
const { getBot, resetBot } = require('./botManager');
const { buildFinancialReport } = require('./reportService');

async function getConfiguredBot() {
    const config = await db.getBotConfig();
    return {
        config,
        bot: getBot(config)
    };
}

async function getStatus() {
    const { bot } = await getConfiguredBot();
    return {
        ...bot.getStatus(),
        logs: bot.getLogs()
    };
}

async function startBot() {
    const { bot } = await getConfiguredBot();
    await bot.iniciar();
    return {
        ...bot.getStatus(),
        logs: bot.getLogs()
    };
}

function ensureBotReady(bot) {
    if (!bot.getStatus().isReady) {
        const error = new Error('WhatsApp ainda nao esta pronto. Clique em Iniciar WhatsApp, escaneie o QR Code e aguarde conectar.');
        error.statusCode = 409;
        throw error;
    }
}

async function listGroups() {
    const { bot } = await getConfiguredBot();
    ensureBotReady(bot);
    return await bot.listarGrupos();
}

async function listGroupParticipants(groupId) {
    const { bot } = await getConfiguredBot();
    ensureBotReady(bot);
    return await bot.listarParticipantesGrupo(groupId);
}

async function sendIndividualCharge(data) {
    const { bot } = await getConfiguredBot();
    ensureBotReady(bot);
    await bot.enviarCobrancaIndividual(data);
    return { ok: true, message: 'Cobranca individual enviada.' };
}

async function startCampaign() {
    const { bot } = await getConfiguredBot();
    const campaignId = await db.createCampaign('executando', null, 'Campanha iniciada pela interface.');

    bot.iniciarColeta()
        .then(async (groupName) => {
            await db.finishCampaign(campaignId, 'concluida', `Campanha enviada para ${groupName}.`, groupName);
        })
        .catch(async (error) => {
            await db.finishCampaign(campaignId, 'erro', error.message);
            console.error('Erro na campanha:', error);
        });

    return {
        ok: true,
        campaignId,
        message: 'Campanha iniciada. Acompanhe os logs do WhatsApp na interface.'
    };
}

async function sendReport(month) {
    const { config, bot } = await getConfiguredBot();
    const data = await db.getDashboard(month);
    await bot.enviarMensagemGrupo(config.grupoAlvo, buildFinancialReport(data));
    return { ok: true, message: 'Relatório enviado com sucesso.' };
}

async function clearSession() {
    const { bot } = await getConfiguredBot();
    ensureBotReady(bot);
    await bot.limparSessao();
    await resetBot();
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
