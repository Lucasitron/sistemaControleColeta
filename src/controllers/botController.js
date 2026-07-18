const botService = require('../services/botService');

async function getStatus(request, response) {
    response.json(await botService.getStatus());
}

async function startBot(request, response) {
    response.json(await botService.startBot());
}

async function listGroups(request, response) {
    response.json(await botService.listGroups());
}

async function listGroupParticipants(request, response) {
    response.json(await botService.listGroupParticipants(request.query.groupId));
}

async function sendIndividualCharge(request, response) {
    response.json(await botService.sendIndividualCharge(request.body));
}

async function startCampaign(request, response) {
    response.status(202).json(await botService.startCampaign());
}

async function sendReport(request, response) {
    response.json(await botService.sendReport(request.body.month));
}

async function clearSession(request, response) {
    response.json(await botService.clearSession());
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
