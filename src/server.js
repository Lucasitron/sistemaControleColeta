const createApp = require('./app');
const db = require('./db/database');
const { startAutoChargeJob } = require('./services/autoChargeService');

const PORT = process.env.PORT || 1213;
const app = createApp();

async function startServer() {
    console.log('[SERVER] Inicializando banco de dados...');
    await db.init();
    console.log('[SERVER] Banco de dados inicializado');

    app.listen(PORT, () => {
        console.log(`[SERVER] Servidor iniciado em http://localhost:${PORT}`);
        console.log('[SERVER] Para conectar o WhatsApp, abra a interface e clique em "Iniciar WhatsApp".');
        console.log('[SERVER] O QR Code sera mostrado na interface web e neste terminal quando necessario.');
    });

    console.log('[SERVER] Iniciando job de cobranca automatica...');
    startAutoChargeJob();
    console.log('[SERVER] Job iniciado');
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error('Erro ao iniciar servidor:', error);
        process.exit(1);
    });
}

module.exports = app;
