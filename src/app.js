const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/apiRoutes');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
    const app = express();

    app.use(express.json());
    app.use((req, res, next) => {
        console.log(`[REQ] ${req.method} ${req.path}`, req.query ? Object.keys(req.query).length ? `?${JSON.stringify(req.query)}` : '' : '');
        next();
    });
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use('/api', apiRoutes);

    app.get(/.*/, (request, response) => {
        response.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    });

    app.use(errorHandler);

    return app;
}

module.exports = createApp;
