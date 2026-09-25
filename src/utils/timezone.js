// Todos os agendamentos (lembretes e cobranca automatica) usam este fuso,
// independente do timezone do servidor/container (que costuma ser UTC).
// Sobrescreva com a variavel de ambiente APP_TIMEZONE se necessario.
const TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

const WEEKDAY_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});

    return {
        timeZone: TIMEZONE,
        hhmm: `${parts.hour}:${parts.minute}`,
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        weekday: WEEKDAY_NUM[parts.weekday],
        dayOfMonth: Number(parts.day)
    };
}

module.exports = {
    TIMEZONE,
    zonedParts
};
