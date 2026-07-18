const db = require('../db/database');

async function getDashboard(month) {
    return await db.getDashboard(month);
}

async function createPayment(data) {
    return await db.createPayment(data);
}

async function updatePayment(id, data) {
    return await db.updatePayment(id, data);
}

async function deletePayment(id) {
    return await db.deletePayment(id);
}

async function createPurchase(data) {
    return await db.createPurchase(data);
}

async function getPurchases() {
    return await db.getPurchases();
}

async function updatePurchase(id, data) {
    return await db.updatePurchase(id, data);
}

async function deletePurchase(id) {
    return await db.deletePurchase(id);
}

async function toggleJustification(participantId, monthYear) {
    if (!participantId || !monthYear) {
        throw new Error('participantId e monthYear sao obrigatorios.');
    }

    return await db.toggleJustification(participantId, monthYear);
}

module.exports = {
    getDashboard,
    createPayment,
    updatePayment,
    deletePayment,
    createPurchase,
    getPurchases,
    updatePurchase,
    deletePurchase,
    toggleJustification
};
