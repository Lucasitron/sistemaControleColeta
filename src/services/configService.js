const db = require('../db/database');
const { getBot } = require('./botManager');

async function getInitialConfig() {
    const [settings, participants, botConfig, campaigns, dashboard] = await Promise.all([
        db.getSettings(),
        db.getParticipants(),
        db.getBotConfig(),
        db.getCampaigns(),
        db.getDashboard()
    ]);

    return {
        settings: {
            grupoAlvo: settings.grupoAlvo || botConfig.grupoAlvo,
            pixChave: settings.pixChave || botConfig.pix.chave,
            pixCopiaCola: settings.pixCopiaCola || botConfig.pix.copiaCola,
            maxOpcoesPorEnquete: botConfig.maxOpcoesPorEnquete,
            valoresContribuicao: botConfig.valoresContribuicao
        },
        participants,
        campaigns,
        dashboard
    };
}

async function updateSettings(settings) {
    await db.updateSettings(settings);
    const config = await db.getBotConfig();
    getBot(config).setConfig(config);
    return config;
}

module.exports = {
    getInitialConfig,
    updateSettings
};
