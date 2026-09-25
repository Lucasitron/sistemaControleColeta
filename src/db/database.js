const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const defaultConfig = require('../config/defaultConfig');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'copa.sqlite');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

class Database {
    constructor() {
        ensureDataDir();
        this.db = new sqlite3.Database(DB_PATH);
        this.db.run('PRAGMA foreign_keys = ON');
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function onRun(error) {
                if (error) {
                    reject(error);
                    return;
                }
                resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (error, row) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (error, rows) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(rows);
            });
        });
    }

    async init() {
        await this.run(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL CHECK(category IN ('professores', 'bolsistas', 'usuariosFrequentes')),
                is_debtor INTEGER NOT NULL DEFAULT 0,
                whatsapp_number TEXT,
                amount_due REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await this.ensureColumn('participants', 'whatsapp_number', 'TEXT');
        await this.ensureColumn('participants', 'amount_due', 'REAL NOT NULL DEFAULT 0');

        await this.run(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_name TEXT,
                status TEXT NOT NULL,
                message TEXT,
                started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                finished_at TEXT
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_id INTEGER,
                participant_name TEXT NOT NULL,
                amount REAL NOT NULL,
                paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                source TEXT NOT NULL DEFAULT 'manual',
                FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                purchase_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS justifications (
                participant_id INTEGER NOT NULL,
                month_year TEXT NOT NULL,
                PRIMARY KEY (participant_id, month_year),
                FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slot TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL DEFAULT '',
                time TEXT NOT NULL,
                days TEXT NOT NULL DEFAULT '1,2,3,4,5',
                message TEXT NOT NULL DEFAULT '',
                group_id TEXT NOT NULL DEFAULT '',
                group_name TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await this.ensureColumn('reminders', 'title', "TEXT NOT NULL DEFAULT ''");
        await this.ensureColumn('reminders', 'days', "TEXT NOT NULL DEFAULT '1,2,3,4,5'");
        await this.ensureColumn('reminders', 'group_id', "TEXT NOT NULL DEFAULT ''");
        await this.ensureColumn('reminders', 'group_name', "TEXT NOT NULL DEFAULT ''");
        await this.ensureColumn('reminders', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('reminders', 'updated_at', 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');

        await this.seedReminders();

        await this.seedDefaults();

        await this.migrateGroupSettings();
    }

    async ensureColumn(tableName, columnName, definition) {
        const columns = await this.all(`PRAGMA table_info(${tableName})`);
        const exists = columns.some(column => column.name === columnName);
        if (!exists) {
            await this.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        }
    }

    async seedDefaults() {
        const existing = await this.get('SELECT COUNT(*) AS total FROM participants');
        if (existing.total > 0) {
            return;
        }

        await this.saveSetting('grupoAlvo', defaultConfig.grupoAlvo);
        await this.saveSetting('grupoColeta', defaultConfig.grupoAlvo);
        await this.saveSetting('grupoLembretes', '');
        await this.saveSetting('pixChave', defaultConfig.pix.chave);
        await this.saveSetting('pixCopiaCola', defaultConfig.pix.copiaCola);
        await this.saveSetting('maxOpcoesPorEnquete', String(defaultConfig.maxOpcoesPorEnquete));
        await this.saveSetting('valoresContribuicao', JSON.stringify(defaultConfig.valoresContribuicao));

        for (const category of ['professores', 'bolsistas', 'usuariosFrequentes']) {
            for (const name of defaultConfig.nomes[category]) {
                const isDebtor = defaultConfig.nomes.devedores.includes(name) ? 1 : 0;
                await this.run(
                    'INSERT INTO participants (name, category, is_debtor) VALUES (?, ?, ?)',
                    [name, category, isDebtor]
                );
            }
        }
    }

    async saveSetting(key, value) {
        await this.run(
            `INSERT INTO settings (key, value)
             VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [key, value]
        );
    }

    async getSettings() {
        const rows = await this.all('SELECT key, value FROM settings ORDER BY key');
        return rows.reduce((settings, row) => {
            settings[row.key] = row.value;
            return settings;
        }, {});
    }

    async updateSettings(settings) {
        const allowedKeys = ['grupoAlvo', 'grupoColeta', 'grupoLembretes', 'pixChave', 'pixCopiaCola', 'maxOpcoesPorEnquete', 'valoresContribuicao'];
        for (const key of allowedKeys) {
            if (Object.prototype.hasOwnProperty.call(settings, key)) {
                const value = Array.isArray(settings[key]) ? JSON.stringify(settings[key]) : String(settings[key] ?? '');
                await this.saveSetting(key, value);
            }
        }
        // Compat: grupoAlvo legado espelha o grupo da coleta.
        if (Object.prototype.hasOwnProperty.call(settings, 'grupoColeta')) {
            await this.saveSetting('grupoAlvo', String(settings.grupoColeta ?? ''));
        }
    }

    async migrateGroupSettings() {
        const settings = await this.getSettings();
        if (!settings.grupoColeta) {
            await this.saveSetting('grupoColeta', settings.grupoAlvo || defaultConfig.grupoAlvo);
        }
        if (settings.grupoLembretes === undefined) {
            await this.saveSetting('grupoLembretes', '');
        }
        if (!settings.grupoAlvo && settings.grupoColeta) {
            await this.saveSetting('grupoAlvo', settings.grupoColeta);
        }
    }

    async getParticipants() {
        return await this.all(`
            SELECT id,
                   name,
                   category,
                   is_debtor AS isDebtor,
                   whatsapp_number AS whatsappNumber,
                   amount_due AS amountDue
            FROM participants
            ORDER BY category, name
        `);
    }

    async createParticipant(data) {
        const result = await this.run(
            `INSERT INTO participants (name, category, is_debtor, whatsapp_number, amount_due)
             VALUES (?, ?, ?, ?, ?)`,
            [
                data.name.trim(),
                data.category,
                data.isDebtor ? 1 : 0,
                data.whatsappNumber ? String(data.whatsappNumber).trim() : null,
                Number(data.amountDue || 0)
            ]
        );
        return await this.getParticipant(result.id);
    }

    async getParticipant(id) {
        return await this.get(
            `SELECT id,
                    name,
                    category,
                    is_debtor AS isDebtor,
                    whatsapp_number AS whatsappNumber,
                    amount_due AS amountDue
             FROM participants
             WHERE id = ?`,
            [id]
        );
    }

    async updateParticipant(id, data) {
        const current = await this.getParticipant(id);
        if (!current) {
            throw new Error('Participante nao encontrado.');
        }

        const isDebtor = data.isDebtor !== undefined ? (data.isDebtor ? 1 : 0) : (current.isDebtor ? 1 : 0);

        await this.run(
            `UPDATE participants
             SET name = ?,
                 category = ?,
                 is_debtor = ?,
                 whatsapp_number = ?,
                 amount_due = ?
             WHERE id = ?`,
            [
                data.name.trim(),
                data.category,
                isDebtor,
                data.whatsappNumber ? String(data.whatsappNumber).trim() : null,
                Number(data.amountDue || 0),
                id
            ]
        );
        return await this.getParticipant(id);
    }

    async deleteParticipant(id) {
        return await this.run('DELETE FROM participants WHERE id = ?', [id]);
    }

    normalizeReminderDays(value, fallback = '1,2,3,4,5') {
        let list = value;
        if (typeof list === 'string') {
            list = list.split(',').map(v => v.trim()).filter(v => v !== '');
        }
        if (!Array.isArray(list)) return fallback;
        const days = [...new Set(
            list.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
        )].sort((a, b) => a - b);
        if (!days.length) {
            throw new Error('Selecione ao menos um dia da semana.');
        }
        return days.join(',');
    }

    validateReminderTime(time) {
        const value = String(time || '').trim();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
            throw new Error('Horario invalido. Use o formato HH:MM (ex: 09:00).');
        }
        return value;
    }

    mapReminderRow(row) {
        if (!row) return row;
        return {
            ...row,
            days: String(row.days || '1,2,3,4,5').split(',').map(Number).filter(n => Number.isInteger(n)),
            enabled: Boolean(row.enabled)
        };
    }

    async seedReminders() {
        const defaults = [
            {
                slot: 'manha',
                title: 'Lembrete da manhã',
                time: '09:00',
                days: '1,2,3,4,5',
                message: `☕ *BOM DIA, COPA FABLAB!*\n\nLembrete da manhã: quem ainda não contribuiu este mês, aproveite para fazer o PIX e garantir os insumos da nossa copa. 🙏\n\n_Equipe Copa FabLab_`,
                group_id: '',
                group_name: '',
                enabled: 1
            },
            {
                slot: 'meio-dia',
                title: 'Lembrete do almoço',
                time: '12:00',
                days: '1,2,3,4,5',
                message: `🍽️ *HORA DO ALMOÇO - LEMBRETE DA COPA*\n\nPassando para lembrar: sua contribuição mantém café, açúcar e descartáveis sempre disponíveis.\n\nQuem já pagou, obrigado! Quem ainda não, bora contribuir? 💚`,
                group_id: '',
                group_name: '',
                enabled: 1
            },
            {
                slot: 'tarde',
                title: 'Lembrete da tarde',
                time: '14:00',
                days: '1,2,3,4,5',
                message: `☕ *LEMBRETE DA TARDE - COPA FABLAB*\n\nBoa tarde! Não esqueça da coleta mensal da copa. Sua participação faz a diferença!\n\nQualquer dúvida, chame no particular.`,
                group_id: '',
                group_name: '',
                enabled: 1
            },
            {
                slot: 'fim-tarde',
                title: 'Último lembrete do dia',
                time: '16:50',
                days: '1,2,3,4,5',
                message: `🌙 *ÚLTIMO LEMBRETE DO DIA - COPA FABLAB*\n\nEncerrando o dia! Se ainda falta sua contribuição, aproveite para regularizar ainda hoje.\n\nAmanhã tem mais. Obrigado a todos que já contribuíram! 🙌`,
                group_id: '',
                group_name: '',
                enabled: 1
            }
        ];

        for (const item of defaults) {
            await this.run(
                `INSERT INTO reminders (slot, title, time, days, message, group_id, group_name, enabled)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(slot) DO NOTHING`,
                [item.slot, item.title, item.time, item.days, item.message, item.group_id, item.group_name, item.enabled]
            );
        }
        await this.run(
            `UPDATE reminders SET days = '1,2,3,4,5' WHERE days IS NULL OR TRIM(days) = ''`
        );
        const titles = {
            'manha': 'Lembrete da manhã',
            'meio-dia': 'Lembrete do almoço',
            'tarde': 'Lembrete da tarde',
            'fim-tarde': 'Último lembrete do dia'
        };
        for (const [slot, title] of Object.entries(titles)) {
            await this.run(
                `UPDATE reminders SET title = ? WHERE slot = ? AND (title IS NULL OR TRIM(title) = '')`,
                [title, slot]
            );
        }
    }

    async getReminders() {
        const rows = await this.all(
            `SELECT id,
                    slot,
                    title,
                    time,
                    days,
                    message,
                    group_id AS groupId,
                    group_name AS groupName,
                    enabled AS enabled,
                    updated_at AS updatedAt
             FROM reminders
             ORDER BY time ASC, id ASC`
        );
        return rows.map(r => this.mapReminderRow(r));
    }

    async createReminder(data) {
        const title = String(data.title || '').trim();
        if (!title) {
            throw new Error('Informe um titulo para o lembrete.');
        }
        const time = this.validateReminderTime(data.time);
        const days = this.normalizeReminderDays(data.days);
        const message = String(data.message || '').trim();
        if (!message) {
            throw new Error('Mensagem do lembrete esta vazia.');
        }
        const slot = `custom-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const result = await this.run(
            `INSERT INTO reminders (slot, title, time, days, message, group_id, group_name, enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                slot,
                title,
                time,
                days,
                message,
                String(data.groupId || '').trim(),
                String(data.groupName || '').trim(),
                data.enabled === undefined || data.enabled ? 1 : 0
            ]
        );
        return await this.getReminder(result.id);
    }

    async getReminder(id) {
        const row = await this.get(
            `SELECT id, slot, title, time, days, message,
                    group_id AS groupId, group_name AS groupName,
                    enabled, updated_at AS updatedAt
             FROM reminders WHERE id = ?`,
            [id]
        );
        if (!row) {
            throw new Error('Lembrete nao encontrado.');
        }
        return this.mapReminderRow(row);
    }

    async updateReminder(id, data) {
        const current = await this.get('SELECT * FROM reminders WHERE id = ?', [id]);
        if (!current) {
            throw new Error('Lembrete nao encontrado.');
        }

        const time = data.time !== undefined
            ? this.validateReminderTime(data.time)
            : current.time;
        const days = data.days !== undefined
            ? this.normalizeReminderDays(data.days, current.days || '1,2,3,4,5')
            : (current.days || '1,2,3,4,5');
        const title = data.title !== undefined ? String(data.title).trim() : (current.title || '');
        if (!title) {
            throw new Error('Informe um titulo para o lembrete.');
        }
        const message = data.message !== undefined ? String(data.message) : current.message;
        if (!String(message || '').trim()) {
            throw new Error('Mensagem do lembrete esta vazia.');
        }
        const groupId = data.groupId !== undefined ? String(data.groupId).trim() : (current.group_id || '');
        const groupName = data.groupName !== undefined ? String(data.groupName).trim() : (current.group_name || '');
        const enabled = data.enabled !== undefined ? (data.enabled ? 1 : 0) : current.enabled;

        await this.run(
            `UPDATE reminders
             SET title = ?, time = ?, days = ?, message = ?,
                 group_id = ?, group_name = ?, enabled = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [title, time, days, message, groupId, groupName, enabled, id]
        );

        return await this.getReminder(id);
    }

    async deleteReminder(id) {
        const result = await this.run('DELETE FROM reminders WHERE id = ?', [id]);
        if (!result.changes) {
            throw new Error('Lembrete nao encontrado.');
        }
        return { ok: true };
    }

    async getBotConfig() {
        const settings = await this.getSettings();
        const participants = await this.getParticipants();

        const nomes = {
            professores: [],
            bolsistas: [],
            usuariosFrequentes: [],
            devedores: []
        };

        for (const participant of participants) {
            nomes[participant.category].push(participant.name);
            if (participant.isDebtor) {
                nomes.devedores.push(participant.name);
            }
        }

        const grupoColeta = settings.grupoColeta || settings.grupoAlvo || defaultConfig.grupoAlvo;
        return {
            delays: defaultConfig.delays,
            nomes,
            maxOpcoesPorEnquete: Number(settings.maxOpcoesPorEnquete || defaultConfig.maxOpcoesPorEnquete),
            grupoAlvo: grupoColeta,
            grupoColeta,
            grupoLembretes: settings.grupoLembretes || '',
            pix: {
                chave: settings.pixChave || defaultConfig.pix.chave,
                copiaCola: settings.pixCopiaCola || defaultConfig.pix.copiaCola
            },
            valoresContribuicao: settings.valoresContribuicao
                ? JSON.parse(settings.valoresContribuicao)
                : defaultConfig.valoresContribuicao
        };
    }

    async createCampaign(status, groupName, message) {
        const result = await this.run(
            'INSERT INTO campaigns (status, group_name, message) VALUES (?, ?, ?)',
            [status, groupName || null, message || null]
        );
        return result.id;
    }

    async finishCampaign(id, status, message, groupName = null) {
        await this.run(
            `UPDATE campaigns
             SET status = ?,
                 message = ?,
                 group_name = COALESCE(?, group_name),
                 finished_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [status, message || null, groupName, id]
        );
    }

    async getCampaigns() {
        return await this.all('SELECT * FROM campaigns ORDER BY started_at DESC LIMIT 20');
    }

    async createPayment(data) {
        const amount = Number(data.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Valor da arrecadacao invalido.');
        }

        let participant = null;
        if (data.participantId) {
            participant = await this.getParticipant(data.participantId);
        }

        const participantName = participant
            ? participant.name
            : String(data.participantName || '').trim();

        if (!participantName) {
            throw new Error('Informe o participante da arrecadacao.');
        }

        const result = await this.run(
            `INSERT INTO payments (participant_id, participant_name, amount, paid_at, source)
             VALUES (?, ?, ?, ?, ?)`,
            [
                participant ? participant.id : null,
                participantName,
                amount,
                data.paidAt || new Date().toISOString(),
                data.source || 'manual'
            ]
        );

        return await this.get(
            `SELECT id,
                    participant_id AS participantId,
                    participant_name AS participantName,
                    amount,
                    paid_at AS paidAt,
                    source
             FROM payments
             WHERE id = ?`,
            [result.id]
        );
    }

    async getPayment(id) {
        return await this.get(
            `SELECT id,
                    participant_id AS participantId,
                    participant_name AS participantName,
                    amount,
                    paid_at AS paidAt,
                    source
             FROM payments
             WHERE id = ?`,
            [id]
        );
    }

    async updatePayment(id, data) {
        const amount = Number(data.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Valor da arrecadacao invalido.');
        }

        let participant = null;
        if (data.participantId) {
            participant = await this.getParticipant(data.participantId);
            if (!participant) {
                throw new Error('Participante nao encontrado.');
            }
        }

        const participantName = participant
            ? participant.name
            : String(data.participantName || '').trim();

        if (!participantName) {
            throw new Error('Informe o participante da arrecadacao.');
        }

        await this.run(
            `UPDATE payments
             SET participant_id = ?,
                 participant_name = ?,
                 amount = ?,
                 paid_at = ?,
                 source = ?
             WHERE id = ?`,
            [
                participant ? participant.id : null,
                participantName,
                amount,
                data.paidAt || new Date().toISOString(),
                data.source || 'manual',
                id
            ]
        );

        const payment = await this.getPayment(id);
        if (!payment) {
            throw new Error('Arrecadacao nao encontrada.');
        }

        return payment;
    }

    async deletePayment(id) {
        const result = await this.run('DELETE FROM payments WHERE id = ?', [id]);
        if (!result.changes) {
            throw new Error('Arrecadacao nao encontrada.');
        }
        return result;
    }

    async createPurchase(data) {
        const amount = Number(data.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Valor da compra invalido.');
        }

        const description = String(data.description || '').trim();
        if (!description) {
            throw new Error('Descricao da compra e obrigatoria.');
        }

        const result = await this.run(
            `INSERT INTO purchases (description, amount, purchase_date) VALUES (?, ?, ?)`,
            [description, amount, data.purchaseDate || new Date().toISOString()]
        );
        return await this.getPurchase(result.id);
    }

    async getPurchase(id) {
        return await this.get(
            `SELECT id,
                    description,
                    amount,
                    purchase_date AS purchaseDate
             FROM purchases
             WHERE id = ?`,
            [id]
        );
    }

    async getPurchases() {
        return await this.all(
            `SELECT id,
                    description,
                    amount,
                    purchase_date AS purchaseDate
             FROM purchases
             ORDER BY purchase_date DESC, id DESC`
        );
    }

    async updatePurchase(id, data) {
        const amount = Number(data.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Valor da compra invalido.');
        }

        const description = String(data.description || '').trim();
        if (!description) {
            throw new Error('Descricao da compra e obrigatoria.');
        }

        await this.run(
            `UPDATE purchases
             SET description = ?,
                 amount = ?,
                 purchase_date = ?
             WHERE id = ?`,
            [description, amount, data.purchaseDate || new Date().toISOString(), id]
        );

        const purchase = await this.getPurchase(id);
        if (!purchase) {
            throw new Error('Compra nao encontrada.');
        }

        return purchase;
    }

    async deletePurchase(id) {
        const result = await this.run('DELETE FROM purchases WHERE id = ?', [id]);
        if (!result.changes) {
            throw new Error('Compra nao encontrada.');
        }
        return result;
    }

    async toggleJustification(participantId, monthYear) {
        const existing = await this.get(
            'SELECT * FROM justifications WHERE participant_id = ? AND month_year = ?',
            [participantId, monthYear]
        );
        if (existing) {
            await this.run('DELETE FROM justifications WHERE participant_id = ? AND month_year = ?', [participantId, monthYear]);
            return { justified: false };
        } else {
            await this.run('INSERT INTO justifications (participant_id, month_year) VALUES (?, ?)', [participantId, monthYear]);
            return { justified: true };
        }
    }

    async getDashboard(monthParam) {
        // monthParam should be 'YYYY-MM'. If not provided, use current month.
        const targetDate = monthParam ? new Date(`${monthParam}-01T12:00:00Z`) : new Date();
        const monthYearStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
        
        const monthStart = `${monthYearStr}-01T00:00:00.000Z`;
        const [yearNum, monthNum] = monthYearStr.split('-').map(Number);
        const nextM = monthNum === 12 ? 1 : monthNum + 1;
        const nextY = monthNum === 12 ? yearNum + 1 : yearNum;
        const monthEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00.000Z`;

        const totalRow = await this.get(
            `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
             FROM payments
             WHERE paid_at >= ? AND paid_at < ?`,
            [monthStart, monthEnd]
        );

        const purchasesRow = await this.get(
            `SELECT COALESCE(SUM(amount), 0) AS total
             FROM purchases
             WHERE purchase_date >= ? AND purchase_date < ?`,
            [monthStart, monthEnd]
        );

        const purchases = await this.all(
            `SELECT id, description, amount, purchase_date AS purchaseDate
             FROM purchases
             WHERE purchase_date >= ? AND purchase_date < ?
             ORDER BY purchase_date DESC`,
            [monthStart, monthEnd]
        );

        const payments = await this.all(
            `SELECT id,
                    participant_id AS participantId,
                    participant_name AS participantName,
                    amount,
                    paid_at AS paidAt,
                    source
             FROM payments
             WHERE paid_at >= ? AND paid_at < ?
             ORDER BY paid_at DESC, id DESC`,
            [monthStart, monthEnd]
        );

        const paidRanking = await this.all(
            `SELECT participant_name AS name,
                    COALESCE(SUM(amount), 0) AS total,
                    COUNT(*) AS payments
             FROM payments
             WHERE paid_at >= ? AND paid_at < ?
             GROUP BY COALESCE(participant_id, participant_name), participant_name
             ORDER BY total DESC, participant_name ASC`,
            [monthStart, monthEnd]
        );

        // Find pending participants dynamically for the selected month
        // A participant is pending if they haven't paid in the selected month AND are not justified.
        const allParticipants = await this.getParticipants();
        
        const paymentsInMonth = await this.all(
            `SELECT DISTINCT participant_id 
             FROM payments 
             WHERE paid_at >= ? AND paid_at < ? AND participant_id IS NOT NULL`,
            [monthStart, monthEnd]
        );
        const paidParticipantIds = new Set(paymentsInMonth.map(p => p.participant_id));

        const justifications = await this.all(
            `SELECT participant_id FROM justifications WHERE month_year = ?`,
            [monthYearStr]
        );
        const justifiedIds = new Set(justifications.map(j => j.participant_id));

        const debtors = [];
        const pendingForQuickPay = [];
        
        for (const p of allParticipants) {
            const hasPaid = paidParticipantIds.has(p.id);
            const isJustified = justifiedIds.has(p.id);
            
            p.status = hasPaid ? 'paid' : (isJustified ? 'justified' : 'pending');
            
            if (p.status === 'pending') {
                debtors.push(p);
                pendingForQuickPay.push(p);
            }
        }

        return {
            month: {
                label: targetDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
                value: monthYearStr,
                totalCollected: totalRow.total || 0,
                totalPurchases: purchasesRow.total || 0,
                netBalance: (totalRow.total || 0) - (purchasesRow.total || 0),
                payments: totalRow.count || 0
            },
            paidRanking: paidRanking.slice(0, 8),
            payments,
            purchases,
            debtors: debtors.sort((a, b) => b.amountDue - a.amountDue).slice(0, 8),
            pendingParticipants: pendingForQuickPay,
            allParticipants
        };
    }
}

module.exports = new Database();
