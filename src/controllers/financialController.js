const financialService = require('../services/financialService');

async function getDashboard(request, response) {
    response.json(await financialService.getDashboard(request.query.month));
}

async function createPayment(request, response) {
    const payment = await financialService.createPayment(request.body);
    response.status(201).json(payment);
}

async function updatePayment(request, response) {
    const payment = await financialService.updatePayment(request.params.id, request.body);
    response.json(payment);
}

async function deletePayment(request, response) {
    await financialService.deletePayment(request.params.id);
    response.status(204).send();
}

async function createPurchase(request, response) {
    const purchase = await financialService.createPurchase(request.body);
    response.status(201).json(purchase);
}

async function getPurchases(request, response) {
    response.json(await financialService.getPurchases());
}

async function updatePurchase(request, response) {
    const purchase = await financialService.updatePurchase(request.params.id, request.body);
    response.json(purchase);
}

async function deletePurchase(request, response) {
    await financialService.deletePurchase(request.params.id);
    response.status(204).send();
}

async function toggleJustification(request, response) {
    const { participantId, monthYear } = request.body;
    response.json(await financialService.toggleJustification(participantId, monthYear));
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
