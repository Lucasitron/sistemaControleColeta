const READY_WAIT_MS = 90 * 1000;
const READY_POLL_MS = 2000;

async function ensureBotReadyForSend(bot, options = {}) {
    const label = options.label || 'Envio';
    const waitMs = options.waitMs || READY_WAIT_MS;

    if (bot.getStatus().isReady) {
        return;
    }

    console.log(`[${label}] WhatsApp nao esta pronto. Iniciando antes do envio...`);
    try {
        await bot.iniciar();
    } catch (error) {
        console.log(`[${label}] Falha ao iniciar WhatsApp: ${error.message}`);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < waitMs) {
        if (bot.getStatus().isReady) {
            console.log(`[${label}] WhatsApp pronto para envio.`);
            return;
        }
        await new Promise(resolve => setTimeout(resolve, READY_POLL_MS));
    }

    const error = new Error('WhatsApp ainda nao esta pronto. Clique em Iniciar WhatsApp, escaneie o QR Code e tente novamente.');
    error.statusCode = 409;
    throw error;
}

module.exports = {
    ensureBotReadyForSend
};
