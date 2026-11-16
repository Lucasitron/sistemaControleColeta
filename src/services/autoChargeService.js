const db = require('../db/database');
const { getBot } = require('./botManager');
const { ensureBotReadyForSend } = require('./whatsappReady');
const { zonedParts } = require('../utils/timezone');

const CHECK_INTERVAL_MS = 30 * 1000;
const CHARGE_GRACE_MINUTES = 120;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function hhmmToMinutes(value) {
    const [hours, minutes] = String(value || '00:00').split(':').map(Number);
    return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function parseChargeDays(value) {
    return new Set(
        String(value || '')
            .split(/[,\s;]+/)
            .map(Number)
            .filter(day => Number.isInteger(day) && day >= 1 && day <= 31)
    );
}

function normalizeTime(value) {
    const text = String(value || '').trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : '08:00';
}

/**
 * Dispara a cobranca automatica no horario configurado (padrao 08:00) dos
 * dias configurados (padrao 10 e 15). Antes das mensagens individuais,
 * avisa o grupo marcando todos. O marcador fica no banco para nao repetir
 * depois de um restart no mesmo dia.
 */
async function runAutomaticCharge(state = {}) {
    const now = new Date();
    const { hhmm, dateKey, dayOfMonth } = zonedParts(now);
    const config = await db.getBotConfig();
    const days = parseChargeDays(config.diasCobranca);
    const chargeTime = normalizeTime(config.horarioCobranca);

    if (!days.has(dayOfMonth)) {
        return;
    }
    // Enquanto nao chegar o horario, nao faz nada. Depois dele, qualquer
    // verificacao (a cada 30s) dispara a cobranca caso ainda nao tenha sido
    // enviada hoje — assim um restart as 08:05 nao perde o dia. A janela de
    // tolerancia evita cobrar a noite se o servidor ficou fora o dia inteiro.
    const currentMinutes = hhmmToMinutes(hhmm);
    const targetMinutes = hhmmToMinutes(chargeTime);
    if (currentMinutes < targetMinutes) {
        return;
    }
    if (currentMinutes > targetMinutes + CHARGE_GRACE_MINUTES) {
        return;
    }

    const settings = await db.getSettings();
    if (settings.ultimaCobrancaAutomatica === dateKey) {
        return;
    }
    if (state.sentDates && state.sentDates.has(dateKey)) {
        return;
    }

    const bot = getBot(config);
    try {
        await ensureBotReadyForSend(bot, { label: 'Auto-Cobranca' });
    } catch (error) {
        if (error.statusCode === 409) {
            console.log(`[Auto-Cobranca] WhatsApp indisponivel as ${hhmm} do dia ${dayOfMonth}. Tenta de novo na proxima verificacao.`);
            return;
        }
        throw error;
    }

    const monthYear = dateKey.slice(0, 7);
    const data = await db.getDashboard(monthYear);
    const pending = data.pendingParticipants || [];

    try {
        await bot.avisarCobrancaNoGrupo({
            pending,
            monthYear,
            monthLabel: data.month.label
        });
    } catch (error) {
        console.error(`[Auto-Cobranca] Falha ao avisar o grupo antes da cobranca: ${error.message}`);
    }

    let sent = 0;
    for (const participant of pending) {
        if (!participant.whatsappNumber) {
            console.log(`[Auto-Cobranca] ${participant.name} sem WhatsApp cadastrado; ignorado.`);
            continue;
        }
        try {
            await bot.enviarCobrancaIndividual({
                number: participant.whatsappNumber,
                name: participant.name,
                amountDue: participant.amountDue,
                participantId: participant.id,
                monthYear,
                monthLabel: data.month.label
            });
            sent++;
        } catch (error) {
            console.error(`[Auto-Cobranca] Erro ao cobrar ${participant.name}:`, error.message);
        }
        await wait(2000);
    }

    await db.saveSetting('ultimaCobrancaAutomatica', dateKey);
    if (state.sentDates) state.sentDates.add(dateKey);
    console.log(`[Auto-Cobranca] Executada as ${hhmm} do dia ${dayOfMonth}: ${sent}/${pending.length} cobrancas enviadas.`);
}

function startAutoChargeJob() {
    const state = { sentDates: new Set(), running: false };

    const timer = setInterval(async () => {
        if (state.running) {
            return;
        }
        state.running = true;
        try {
            await runAutomaticCharge(state);
        } catch (error) {
            console.error('[Auto-Cobranca] Erro:', error);
        } finally {
            state.running = false;
        }
    }, CHECK_INTERVAL_MS);

    console.log('[Auto-Cobranca] Agendador iniciado (verificacao a cada 30s, horario configuravel, padrao 08:00).');
    return timer;
}

module.exports = {
    startAutoChargeJob,
    runAutomaticCharge,
    parseChargeDays,
    normalizeTime
};
