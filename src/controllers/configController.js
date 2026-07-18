const configService = require('../services/configService');

async function getConfig(request, response) {
    response.json(await configService.getInitialConfig());
}

async function updateSettings(request, response) {
    const settings = await configService.updateSettings(request.body);
    response.json({ ok: true, settings });
}

module.exports = {
    getConfig,
    updateSettings
};
