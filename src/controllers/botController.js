const botService = require('../services/botService');

async function getStatus(request, response) {
    console.log('[CONTROLLER] GET /bot/status');
    try {
        const result = await botService.getStatus();
        console.log('[CONTROLLER] Status retornado:', result.status);
        response.json(result);
    } catch (error) {
        console.error('[CONTROLLER] Erro em getStatus:', error.message);
        throw error;
    }
}

async function startBot(request, response) {
    console.log('[CONTROLLER] POST /bot/start');
    try {
        const result = await botService.startBot();
        console.log('[CONTROLLER] Start concluido, status:', result.status);
        response.json(result);
    } catch (error) {
        console.error('[CONTROLLER] Erro em startBot:', error.message);
        throw error;
    }
}

async function listGroups(request, response) {
    console.log('[CONTROLLER] GET /bot/groups');
    try {
        const result = await botService.listGroups();
        console.log(`[CONTROLLER] ${result.length} grupos retornados`);
        response.json(result);
    } catch (error) {
        console.error('[CONTROLLER] Erro em listGroups:', error.message);
        throw error;
    }
}

async function listGroupParticipants(request, response) {
    console.log('[CONTROLLER] GET /bot/group-participants:', request.query.groupId);
    try {
        const result = await botService.listGroupParticipants(request.query.groupId);
        console.log(`[CONTROLLER] ${result.length} participantes retornados`);
        response.json(result);
    } catch (error) {
        console.error('[CONTROLLER] Erro em listGroupParticipants:', error.message);
        throw error;
    }
}

async function sendIndividualCharge(request, response) {
    console.log('[CONTROLLER] POST /bot/charge:', request.body.number);
    try {
        const result = await botService.sendIndividualCharge(request.body);
        console.log('[CONTROLLER] Cobranca enviada:', result.ok);
        response.json(result);
    } catch (error) {
        console.error('[CONTROLLER] Erro em sendIndividualCharge:', error.message);
        throw error;
    }
}

async function startCampaign(request, response) {
    console.log('[CONTROLLER] POST /bot/campaign');
    try {
        const result = await botService.startCampaign();
        console.log('[CONTROLLER] Campanha iniciada ID:', result.campaignId);
        response.status(202).json(result);
    } catch (error) {
        console.error('[CONTROLLER] Erro em startCampaign:', error.message);
        throw error;
    }
}

async function sendReport(request, response) {
    console.log('[CONTROLLER] POST /bot/report mes:', request.body.month);
    try {
        const result = await botService.sendReport(request.body.month);
        console.log('[CONTROLLER] Relatorio enviado');
        response.json(result);
    } catch (error) {
        console.error('[CONTROLLER] Erro em sendReport:', error.message);
        throw error;
    }
}

async function clearSession(request, response) {
    console.log('[CONTROLLER] POST /bot/clear-session');
    try {
        const result = await botService.clearSession();
        console.log('[CONTROLLER] Sessao limpa');
        response.json(result);
    } catch (error) {
        console.error('[CONTROLLER] Erro em clearSession:', error.message);
        throw error;
    }
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
