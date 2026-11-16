const db = require('../db/database');

const HELP = [
    '🤖 *Comandos da Copa FabLab*',
    '',
    '• `registrar compra café 25,90`',
    '• `registrar pagamento João 20,00`',
    '• `registrar justificativa João: estava de férias`',
    '• `adicionar pessoa Maria 5591999999999 bolsista`',
    '• `retirar pessoa Maria`',
    '• `status` — resumo do mês',
    '',
    'Você também pode usar apenas: `compra`, `pagamento`, `justificativa`, `adicionar pessoa` e `retirar pessoa`.'
].join('\n');

function normalize(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseAmount(raw) {
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? round2(raw) : null;
    }
    let text = String(raw || '')
        .replace(/r\$/gi, '')
        .replace(/\s/g, '')
        .replace(/[^\d,.-]/g, '');
    if (!text) return null;

    const negative = text.startsWith('-');
    text = text.replace(/-/g, '');
    if (!text) return null;

    if (text.includes(',')) {
        text = text.replace(/\./g, '').replace(',', '.');
    } else {
        const parts = text.split('.');
        if (parts.length > 2) {
            text = parts.join('');
        } else if (parts.length === 2 && parts[1].length === 3) {
            // "1.234" costuma ser separador de milhar em texto livre.
            text = parts.join('');
        }
    }

    const value = Number(text);
    if (!Number.isFinite(value)) return null;
    return round2(negative ? -value : value);
}

function extractTrailingAmount(text) {
    const value = String(text || '').trim();
    const match = value.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*$/i);
    if (!match) return null;
    return {
        amount: parseAmount(match[1]),
        raw: match[1],
        rest: value.slice(0, match.index).trim()
    };
}

function extractLeadingAmount(text) {
    const value = String(text || '').trim();
    const match = value.match(/^(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s+(.+)$/i);
    if (!match) return null;
    return {
        amount: parseAmount(match[1]),
        raw: match[1],
        rest: match[2].trim()
    };
}

function currentMonthYear() {
    return new Date().toISOString().slice(0, 7);
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function cleanName(value) {
    return String(value || '')
        .replace(/^(?:para|de|do|da|o|a)\s+/i, '')
        .replace(/^[:\-–]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function resolveParticipant(query) {
    const value = cleanName(query);
    if (!value) return null;
    const byPhone = await db.findParticipantByWhatsapp(value.replace(/\D/g, ''));
    if (byPhone) return byPhone;
    return await db.findParticipantByName(value);
}

function resolveCategory(value) {
    const text = normalize(value);
    if (/\bprofessor(a)?\b/.test(text)) return 'professores';
    if (/\bbolsista\b/.test(text)) return 'bolsistas';
    return 'usuariosFrequentes';
}

function reply(message) {
    return { handled: true, reply: message };
}

function fail(message) {
    return { handled: true, reply: `⚠️ ${message}` };
}

async function registerPurchase(text) {
    const match = String(text).match(/^\s*(?:registrar\s+)?compra\s*[:\-–]?\s*(.+)$/i);
    if (!match) return fail('Use: registrar compra <descrição> <valor>');
    const trailing = extractTrailingAmount(match[1]);
    if (!trailing || !trailing.amount || trailing.amount <= 0) {
        return fail('Informe o valor da compra. Exemplo: registrar compra café 25,90');
    }
    const description = trailing.rest.replace(/^[:\-–]\s*/, '').trim();
    if (!description) {
        return fail('Informe a descrição da compra. Exemplo: registrar compra café 25,90');
    }
    const purchase = await db.createPurchase({
        description,
        amount: trailing.amount,
        purchaseDate: new Date().toISOString()
    });
    return reply(`✅ Compra registrada: *${purchase.description}* — ${formatCurrency(purchase.amount)}.`);
}

async function registerPayment(text, options = {}) {
    const match = String(text).match(/^\s*(?:registrar\s+|marcar\s+)?(?:pagamento|pago|paguei|pagar)\s*[:\-–]?\s*(.+)$/i);
    if (!match) return fail('Use: registrar pagamento <nome> <valor>');
    let rest = match[1].trim();
    let amount = null;

    const trailing = extractTrailingAmount(rest);
    if (trailing && trailing.amount && trailing.amount > 0 && trailing.rest) {
        amount = trailing.amount;
        rest = trailing.rest;
    } else {
        const leading = extractLeadingAmount(rest);
        if (leading && leading.amount && leading.amount > 0 && leading.rest) {
            amount = leading.amount;
            rest = leading.rest;
        }
    }

    const participant = await resolveParticipant(rest);
    if (!participant) {
        return fail(`Não encontrei o participante "${cleanName(rest)}". Confira o nome ou adicione a pessoa primeiro.`);
    }

    const monthYear = options.monthYear || currentMonthYear();
    if (!amount || amount <= 0) {
        const monthly = await db.getMonthlyStatus(participant.id, monthYear);
        amount = Number(monthly?.amountExpected || participant.amountDue || 0);
        if (!amount || amount <= 0) {
            return fail(`Informe o valor pago de ${participant.name}. Exemplo: registrar pagamento ${participant.name} 20,00`);
        }
    }

    const payment = await db.createPayment({
        participantId: participant.id,
        participantName: participant.name,
        amount,
        paidAt: new Date().toISOString(),
        source: options.source || 'whatsapp_comando'
    });

    return reply(`✅ Pagamento registrado: *${participant.name}* — ${formatCurrency(payment.amount)}.\nO status de ${monthYear} foi atualizado para *pago*.`);
}

async function registerJustification(text, options = {}) {
    const match = String(text).match(/^\s*(?:registrar\s+)?(?:justificativa|justificar)\s*[:\-–]?\s*(.+)$/i);
    if (!match) return fail('Use: registrar justificativa <nome>: <motivo>');

    const remainder = match[1].trim();
    let namePart = '';
    let reason = '';

    const separated = remainder.match(/^(.+?)\s*(?::|\s[-–]\s)\s*(.+)$/);
    if (separated) {
        namePart = separated[1];
        reason = separated[2];
    } else {
        const participants = (await db.getParticipants())
            .slice()
            .sort((a, b) => b.name.length - a.name.length);
        const normalized = normalize(remainder);
        const found = participants.find(p => normalized.startsWith(`${normalize(p.name)} `));
        if (found) {
            namePart = found.name;
            reason = remainder.slice(found.name.length).trim();
        } else {
            const parts = remainder.split(/\s+/);
            namePart = parts.shift() || '';
            reason = parts.join(' ');
        }
    }

    const participant = await resolveParticipant(namePart);
    if (!participant) {
        return fail(`Não encontrei o participante "${cleanName(namePart)}".`);
    }
    if (!reason.trim()) {
        return fail(`Informe o motivo da ausência de ${participant.name}. Exemplo: registrar justificativa ${participant.name}: estava de férias`);
    }

    const monthYear = options.monthYear || currentMonthYear();
    await db.setJustification(participant.id, monthYear, reason.trim(), options.source || 'whatsapp_comando');
    return reply(`✅ Justificativa registrada para *${participant.name}* (${monthYear}):\n${reason.trim()}`);
}

async function addParticipant(text) {
    const match = String(text).match(/^\s*(?:adicionar|incluir|cadastrar)\s+(?:pessoa\s+)?(.+)$/i);
    if (!match) return fail('Use: adicionar pessoa <nome> [whatsapp] [categoria]');

    let rest = match[1].trim();
    let category = 'usuariosFrequentes';
    const categoryMatch = rest.match(/\b(professor(?:a)?|bolsista|usu[aá]rio(?:\s+frequente)?|frequentador(?:a)?)\s*$/i);
    if (categoryMatch) {
        category = resolveCategory(categoryMatch[0]);
        rest = rest.slice(0, categoryMatch.index).trim();
    }

    let whatsappNumber = '';
    const phoneMatch = rest.match(/(\+?\d[\d\s().-]{8,}\d)/);
    if (phoneMatch) {
        whatsappNumber = phoneMatch[0].replace(/\D/g, '');
        rest = rest.replace(phoneMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }

    const name = cleanName(rest);
    if (!name) {
        return fail('Informe o nome da pessoa. Exemplo: adicionar pessoa Maria 5591999999999 bolsista');
    }

    const existing = await db.findParticipantByName(name);
    if (existing) {
        return fail(`"${existing.name}" já está cadastrado(a).`);
    }

    const participant = await db.createParticipant({
        name,
        category,
        whatsappNumber,
        amountDue: 0,
        isDebtor: false
    });
    return reply(`✅ Pessoa adicionada: *${participant.name}* (${participant.category})${whatsappNumber ? ` — WhatsApp ${whatsappNumber}` : ''}.`);
}

async function removeParticipant(text) {
    const match = String(text).match(/^\s*(?:retirar|remover|excluir)\s+(?:pessoa\s+)?(.+)$/i);
    if (!match) return fail('Use: retirar pessoa <nome>');
    const participant = await resolveParticipant(match[1]);
    if (!participant) {
        return fail(`Não encontrei o participante "${cleanName(match[1])}".`);
    }
    await db.deleteParticipant(participant.id);
    return reply(`✅ Pessoa retirada: *${participant.name}*.`);
}

async function showStatus() {
    const monthYear = currentMonthYear();
    const dashboard = await db.getDashboard(monthYear);
    const pending = (dashboard.pendingParticipants || []).map(p => p.name);
    return reply([
        `📊 *Resumo de ${dashboard.month.label}*`,
        `Arrecadado: ${formatCurrency(dashboard.month.totalCollected)}`,
        `Sobra anterior: ${formatCurrency(dashboard.month.carryOver)}`,
        `Despesas: ${formatCurrency(dashboard.month.totalPurchases)}`,
        `Saldo: ${formatCurrency(dashboard.month.netBalance)}`,
        `Pendentes: ${pending.length}${pending.length ? ` (${pending.slice(0, 8).join(', ')}${pending.length > 8 ? '...' : ''})` : ''}`,
        `Aguardando confirmação: ${(dashboard.awaitingConfirmation || []).length}`
    ].join('\n'));
}

async function execute(rawText, options = {}) {
    const text = String(rawText || '').trim();
    if (!text) return { handled: false };
    const norm = normalize(text);

    if (norm === 'ajuda' || norm === 'comandos' || norm === 'help' || norm === 'menu') {
        return reply(HELP);
    }

    if (/^(registrar\s+)?compra\b/.test(norm)) {
        return await registerPurchase(text);
    }

    if (/^(registrar\s+|marcar\s+)?(pagamento|pago|paguei|pagar)\b/.test(norm)) {
        return await registerPayment(text, options);
    }

    if (/^(registrar\s+)?(justificativa|justificar)\b/.test(norm)) {
        return await registerJustification(text, options);
    }

    if (/^(adicionar|incluir|cadastrar)\s+(pessoa\s+)?/.test(norm)) {
        return await addParticipant(text);
    }

    if (/^(retirar|remover|excluir)\s+(pessoa\s+)?/.test(norm)) {
        return await removeParticipant(text);
    }

    if (norm === 'status' || norm === 'resumo') {
        return await showStatus();
    }

    return { handled: false };
}

module.exports = {
    execute,
    parseAmount,
    normalize,
    currentMonthYear,
    formatCurrency,
    HELP
};
