const ColetaCopaBot = require('./ColetaCopaBot');

let bot = null;

function getBot(config) {
    if (!bot) {
        console.log('[BOT] Criando nova instancia do bot');
        bot = new ColetaCopaBot({ config, headless: true });
        return bot;
    }

    if (config) {
        console.log('[BOT] Reutilizando instancia existente, atualizando config');
        bot.setConfig(config);
    } else {
        console.log('[BOT] Reutilizando instancia existente');
    }

    return bot;
}

async function resetBot() {
    console.log('[BOT] Resetando bot...');
    if (bot) {
        await bot.fecharNavegador();
        console.log('[BOT] Navegador fechado');
    }

    bot = null;
    console.log('[BOT] Bot resetado');
}

module.exports = {
    getBot,
    resetBot
};
