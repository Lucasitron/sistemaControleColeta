const ColetaCopaBot = require('./ColetaCopaBot');

let bot = null;

function getBot(config) {
    if (!bot) {
        bot = new ColetaCopaBot({ config, headless: true });
        return bot;
    }

    if (config) {
        bot.setConfig(config);
    }

    return bot;
}

async function resetBot() {
    if (bot) {
        await bot.fecharNavegador();
    }

    bot = null;
}

module.exports = {
    getBot,
    resetBot
};
