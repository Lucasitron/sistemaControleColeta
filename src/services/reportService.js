function formatCurrency(value) {
    return Number(value || 0).toFixed(2);
}

function buildFinancialReport(data) {
    return `*RELATÓRIO FINANCEIRO - COPA FABLAB*\nMês: ${data.month.label}\n\n` +
        `💰 *Arrecadado:* R$ ${formatCurrency(data.month.totalCollected)}\n` +
        `🛒 *Despesas:* R$ ${formatCurrency(data.month.totalPurchases)}\n` +
        `💵 *Saldo Líquido:* R$ ${formatCurrency(data.month.netBalance)}\n\n` +
        `⚠️ *Pendentes:* ${data.debtors.length}\n` +
        (data.debtors.length > 0 ? data.debtors.map(d => `- ${d.name}`).join('\n') + '\n\n' : '\n') +
        `✅ *Maiores Contribuições:*\n` +
        (data.paidRanking.length > 0 ? data.paidRanking.slice(0, 5).map(r => `- ${r.name}: R$ ${formatCurrency(r.total)}`).join('\n') : 'Nenhuma');
}

module.exports = {
    buildFinancialReport
};
