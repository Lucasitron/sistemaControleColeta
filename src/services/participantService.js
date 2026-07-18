const db = require('../db/database');
const { validateParticipant } = require('../validators/participantValidator');

async function createParticipant(data) {
    validateParticipant(data);
    return await db.createParticipant(data);
}

async function updateParticipant(id, data) {
    validateParticipant(data);
    return await db.updateParticipant(id, data);
}

async function deleteParticipant(id) {
    return await db.deleteParticipant(id);
}

module.exports = {
    createParticipant,
    updateParticipant,
    deleteParticipant
};
