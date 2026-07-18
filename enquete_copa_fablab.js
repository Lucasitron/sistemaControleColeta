const ColetaCopaBot = require('./src/services/ColetaCopaBot');
const db = require('./src/db/database');

async function main() {
    await db.init();
    const config = await db.getBotConfig();
    const bot = new ColetaCopaBot({
        config,
        autoStartCampaign: !process.argv.includes('--manual'),
        headless: process.argv.includes('--browser') ? false : true
    });

    process.on('SIGINT', async () => {
        console.log('\nInterrompendo o bot...');
        await bot.fecharNavegador();
        process.exit(0);
    });

    if (process.argv.includes('--limpar')) {
        await bot.limparSessao();
        console.log('Sessao limpa. Execute novamente para gerar um novo QR Code.');
        process.exit(0);
    }

    await bot.iniciar();
}

if (require.main === module) {
    main().catch((error) => {
        console.error('Erro critico:', error);
        process.exit(1);
    });
}

module.exports = ColetaCopaBot;
