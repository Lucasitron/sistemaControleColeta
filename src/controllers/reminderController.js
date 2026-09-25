const reminderService = require('../services/reminderService');

async function listReminders(request, response) {
    response.json(await reminderService.listReminders());
}

async function createReminder(request, response) {
    const result = await reminderService.createReminder(request.body);
    response.status(201).json(result);
}

async function updateReminder(request, response) {
    const result = await reminderService.updateReminder(request.params.id, request.body);
    response.json(result);
}

async function deleteReminder(request, response) {
    response.json(await reminderService.deleteReminder(request.params.id));
}

async function sendReminderNow(request, response) {
    const result = await reminderService.sendReminderNow(request.params.id);
    response.json(result);
}

module.exports = {
    listReminders,
    createReminder,
    updateReminder,
    deleteReminder,
    sendReminderNow
};
