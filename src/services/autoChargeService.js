const db = require('../db/database');
const { getBot } = require('./botManager');
const { ensureBotReadyForSend } = require('./whatsappReady');

const CHARGE_DAYS = new Set([10, 15]);
const ONE_HOUR = 60 * 60 * 1000;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runAutomaticCharge(sentDates) {
    const today = new Date();
    const day = today.getDate();
    const dateStr = today.toISOString().split('T')[0];

    if (!CHARGE_DAYS.has(day) || sentDates.has(dateStr)) {
        return;
    }

    const config = await db.getBotConfig();
    const bot = getBot(config);
    try {
        await ensureBotReadyForSend(bot, { label: 'Auto-Cobranca' });
    } catch (error) {
        if (error.statusCode === 409) {
            console.log(`[Auto-Cobranca] WhatsApp indisponivel no dia ${day}. Tenta de novo na proxima hora.`);
            return;
        }
        throw error;
    }

    const data = await db.getDashboard();
    const pending = data.pendingParticipants || [];

    for (const participant of pending) {
        if (participant.whatsappNumber) {
            try {
                await bot.enviarCobrancaIndividual({
                    number: participant.whatsappNumber,
                    name: participant.name,
                    amountDue: participant.amountDue
                });
            } catch (error) {
                console.error(`[Auto-Cobranca] Erro ao cobrar ${participant.name}:`, error.message);
            }
            await wait(2000);
        }
    }

    sentDates.add(dateStr);
    console.log(`[Auto-Cobranca] Executada para ${pending.length} pendentes no dia ${day}.`);
}

function startAutoChargeJob() {
    const sentDates = new Set();
    let running = false;

    return setInterval(async () => {
        if (running) {
            return;
        }
        running = true;
        try {
            await runAutomaticCharge(sentDates);
        } catch (error) {
            console.error('[Auto-Cobranca] Erro:', error);
        } finally {
            running = false;
        }
    }, ONE_HOUR);
}

module.exports = {
    startAutoChargeJob,
    runAutomaticCharge
};
