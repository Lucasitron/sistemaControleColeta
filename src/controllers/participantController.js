const participantService = require('../services/participantService');

async function createParticipant(request, response) {
    const participant = await participantService.createParticipant(request.body);
    response.status(201).json(participant);
}

async function updateParticipant(request, response) {
    const participant = await participantService.updateParticipant(request.params.id, request.body);
    response.json(participant);
}

async function deleteParticipant(request, response) {
    await participantService.deleteParticipant(request.params.id);
    response.status(204).send();
}

module.exports = {
    createParticipant,
    updateParticipant,
    deleteParticipant
};
