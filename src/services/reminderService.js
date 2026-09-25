const db = require('../db/database');
const { getBot } = require('./botManager');

const CHECK_INTERVAL_MS = 30 * 1000;

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function nowTimeHHMM(date = new Date()) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function todayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function describeDays(days) {
    const list = Array.isArray(days) ? days : [];
    if (list.length === 7) return 'Todos os dias';
    if (list.length === 5 && list.every(d => [1, 2, 3, 4, 5].includes(d))) return 'Seg a Sex';
    return list.map(d => WEEKDAY_SHORT[d]).join(', ');
}

function resolveTarget(reminder, fallbackGroup) {
    return (reminder.groupId || '').trim()
        || (reminder.groupName || '').trim()
        || (fallbackGroup || '').trim();
}

async function listReminders() {
    return await db.getReminders();
}

async function createReminder(data) {
    return await db.createReminder(data);
}

async function updateReminder(id, data) {
    return await db.updateReminder(id, data);
}

async function deleteReminder(id) {
    return await db.deleteReminder(id);
}

async function sendReminderNow(id) {
    const reminder = await db.getReminder(id);
    await dispatchReminder(reminder);
    return { ok: true, message: `Lembrete "${reminder.title || reminder.time}" enviado para "${reminder.groupName || reminder.groupId || 'grupo da coleta'}".` };
}

async function dispatchReminder(reminder) {
    const config = await db.getBotConfig();
    const bot = getBot(config);
    if (!bot.getStatus().isReady) {
        const error = new Error('WhatsApp ainda nao esta pronto. Clique em Iniciar WhatsApp e escaneie o QR Code.');
        error.statusCode = 409;
        throw error;
    }
    const target = resolveTarget(reminder, config.grupoAlvo);
    if (!target) {
        throw new Error('Nenhum grupo definido para o lembrete. Selecione o grupo de envio.');
    }
    if (!reminder.message || !reminder.message.trim()) {
        throw new Error('Mensagem do lembrete esta vazia.');
    }
    await bot.enviarMensagemGrupo(target, reminder.message.trim());
    const label = reminder.title ? `"${reminder.title}"` : reminder.slot;
    console.log(`[Lembretes] Enviado ${label} (${reminder.time}) para "${reminder.groupName || target}".`);
}

async function runReminderCheck(sentKeys, now = new Date()) {
    const hhmm = nowTimeHHMM(now);
    const today = todayKey(now);
    const weekday = now.getDay();

    const reminders = await db.getReminders();
    for (const reminder of reminders) {
        if (!reminder.enabled) continue;
        if (reminder.time !== hhmm) continue;
        if (!reminder.days.includes(weekday)) continue;
        const key = `${today}:${reminder.id}:${reminder.time}`;
        if (sentKeys.has(key)) continue;

        try {
            await dispatchReminder(reminder);
            sentKeys.add(key);
        } catch (error) {
            if (error.statusCode === 409) {
                console.log(`[Lembretes] WhatsApp offline, pulando ${reminder.time} (tenta no proximo minuto).`);
            } else {
                console.error(`[Lembretes] Erro ao enviar ${reminder.time}:`, error.message);
                sentKeys.add(`${key}:erro:${Date.now()}`);
            }
        }
    }
}

function startReminderJob() {
    const sentKeys = new Set();
    console.log('[Lembretes] Agendador iniciado (horarios e dias configuraveis pela interface).');
    return setInterval(async () => {
        try {
            if (sentKeys.size > 500) sentKeys.clear();
            await runReminderCheck(sentKeys);
        } catch (error) {
            console.error('[Lembretes] Erro no job:', error.message);
        }
    }, CHECK_INTERVAL_MS);
}

module.exports = {
    listReminders,
    createReminder,
    updateReminder,
    deleteReminder,
    sendReminderNow,
    startReminderJob,
    runReminderCheck,
    nowTimeHHMM,
    describeDays
};
