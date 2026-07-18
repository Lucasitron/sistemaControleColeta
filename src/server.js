const createApp = require('./app');
const db = require('./db/database');
const { startAutoChargeJob } = require('./services/autoChargeService');

const PORT = process.env.PORT || 1212;
const app = createApp();

async function startServer() {
    await db.init();

    app.listen(PORT, () => {
        console.log(`Servidor iniciado em http://localhost:${PORT}`);
        console.log('Para conectar o WhatsApp, abra a interface e clique em "Iniciar WhatsApp".');
        console.log('O QR Code sera mostrado na interface web e neste terminal quando necessario.');
    });

    startAutoChargeJob();
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error('Erro ao iniciar servidor:', error);
        process.exit(1);
    });
}

module.exports = app;
