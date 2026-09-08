const VALID_CATEGORIES = ['professores', 'bolsistas', 'usuariosFrequentes'];

function validateParticipant(data) {
    if (!data.name || !data.name.trim()) {
        throw new Error('Nome e obrigatorio.');
    }

    if (!VALID_CATEGORIES.includes(data.category)) {
        throw new Error('Categoria invalida.');
    }

    if (data.amountDue !== undefined && (!Number.isFinite(Number(data.amountDue)) || Number(data.amountDue) < 0)) {
        throw new Error('Valor em aberto invalido.');
    }

    if (data.isDebtor !== undefined && typeof data.isDebtor !== 'boolean') {
        throw new Error('Campo devedor invalido.');
    }
}

module.exports = {
    validateParticipant
};
