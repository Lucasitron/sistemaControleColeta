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

        await this.ensureColumn('justifications', 'reason', 'TEXT');
        await this.ensureColumn('justifications', 'source', "TEXT NOT NULL DEFAULT 'manual'");
        await this.ensureColumn('justifications', 'updated_at', 'TEXT');

        // Status mensal explicito: permite que o bot marque "aguardando
        // confirmacao", "pago" ou "justificado" sem depender apenas da
        // existencia de um pagamento. Tambem e a base da lista de arrecadacao
        // que pode ser editada manualmente pela interface.
        await this.run(`
            CREATE TABLE IF NOT EXISTS monthly_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_id INTEGER NOT NULL,
                month_year TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'awaiting_confirmation', 'paid', 'justified')),
                amount_paid REAL NOT NULL DEFAULT 0,
                amount_expected REAL NOT NULL DEFAULT 0,
                justification_reason TEXT,
                note TEXT,
                source TEXT NOT NULL DEFAULT 'manual',
                confirmed_at TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(participant_id, month_year),
                FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
            )
        `);

        // Cada enquete enviada (cobranca ou confirmacao de pagamento) fica
        // registrada para que o bot consiga correlacionar o voto recebido
        // pela lib com o participante/mes certos.
        await this.run(`
            CREATE TABLE IF NOT EXISTS poll_tracking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT UNIQUE,
                chat_id TEXT NOT NULL DEFAULT '',
                participant_id INTEGER,
                participant_number TEXT,
                month_year TEXT NOT NULL,
                kind TEXT NOT NULL,
                flow_key TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                selected_option TEXT,
                amount REAL,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
            )
        `);

        // Estado de conversa (ex: aguardando motivo da ausencia ou valor
        // personalizado). Expira para nao prender a pessoa em um fluxo antigo.
        await this.run(`
            CREATE TABLE IF NOT EXISTS bot_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                participant_id INTEGER,
                month_year TEXT NOT NULL DEFAULT '',
                action TEXT NOT NULL,
                payload TEXT,
                expires_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(chat_id, action),
                FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
            )
        `);

        await this.ensureColumn('payments', 'reference', 'TEXT');
        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference) WHERE reference IS NOT NULL');

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
        await this.saveSetting('diasCobranca', String(defaultConfig.diasCobranca || '10,15'));
        await this.saveSetting('horarioCobranca', String(defaultConfig.horarioCobranca || '08:00'));

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
        const allowedKeys = ['grupoAlvo', 'grupoColeta', 'grupoLembretes', 'pixChave', 'pixCopiaCola', 'maxOpcoesPorEnquete', 'valoresContribuicao', 'diasCobranca', 'horarioCobranca'];
        if (Object.prototype.hasOwnProperty.call(settings, 'diasCobranca')) {
            const days = String(settings.diasCobranca || '')
                .split(/[,\s;]+/)
                .map(Number)
                .filter(day => Number.isInteger(day) && day >= 1 && day <= 31);
            if (!days.length) {
                throw new Error('Informe ao menos um dia valido (1 a 31) para a cobranca automatica.');
            }
            settings = { ...settings, diasCobranca: [...new Set(days)].sort((a, b) => a - b).join(',') };
        }
        if (Object.prototype.hasOwnProperty.call(settings, 'horarioCobranca')) {
            const time = String(settings.horarioCobranca || '').trim();
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
                throw new Error('Horario da cobranca invalido. Use HH:MM (ex: 08:00).');
            }
            settings = { ...settings, horarioCobranca: time };
        }
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

    normalizeContributionValues(list) {
        const items = (Array.isArray(list) ? list : String(list || '').split(/[;,]/))
            .map(value => String(value || '').trim())
            .filter(Boolean);
        const merged = [];
        for (const item of items) {
            const previous = merged[merged.length - 1];
            if (/^\d{2}$/.test(item) && previous && /r\$\s*\d+[.,]?$/i.test(previous)) {
                merged[merged.length - 1] = `${previous.replace(/[.,]$/, '')},${item}`;
                continue;
            }
            merged.push(item);
        }
        return merged.filter(item => item !== '00');
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
            valoresContribuicao: this.normalizeContributionValues(
                settings.valoresContribuicao
                    ? JSON.parse(settings.valoresContribuicao)
                    : defaultConfig.valoresContribuicao
            ),
            diasCobranca: settings.diasCobranca || String(defaultConfig.diasCobranca || '10,15'),
            horarioCobranca: settings.horarioCobranca || String(defaultConfig.horarioCobranca || '08:00')
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

    monthKeyFromDate(value = new Date()) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) {
            return new Date().toISOString().slice(0, 7);
        }
        return date.toISOString().slice(0, 7);
    }

    monthBounds(monthYear) {
        const value = String(monthYear || this.monthKeyFromDate());
        const [year, month] = value.split('-').map(Number);
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        return {
            value,
            start: `${value}-01T00:00:00.000Z`,
            end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`
        };
    }

    normalizeName(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    async findParticipantByName(name) {
        const participants = await this.getParticipants();
        const target = this.normalizeName(name);
        if (!target) return null;
        return participants.find(p => this.normalizeName(p.name) === target)
            || participants.find(p => this.normalizeName(p.name).startsWith(target))
            || participants.find(p => this.normalizeName(p.name).includes(target))
            || participants.find(p => target.includes(this.normalizeName(p.name)))
            || null;
    }

    async findParticipantByWhatsapp(number) {
        const digits = String(number || '').replace(/\D/g, '');
        if (!digits) return null;
        const participants = await this.getParticipants();
        return participants.find(p => String(p.whatsappNumber || '').replace(/\D/g, '') === digits)
            || participants.find(p => {
                const pDigits = String(p.whatsappNumber || '').replace(/\D/g, '');
                return pDigits && (pDigits.endsWith(digits) || digits.endsWith(pDigits));
            })
            || null;
    }

    async getMonthlyStatus(participantId, monthYear) {
        return await this.get(
            `SELECT id,
                    participant_id AS participantId,
                    month_year AS monthYear,
                    status,
                    amount_paid AS amountPaid,
                    amount_expected AS amountExpected,
                    justification_reason AS justificationReason,
                    note,
                    source,
                    confirmed_at AS confirmedAt,
                    updated_at AS updatedAt
             FROM monthly_status
             WHERE participant_id = ? AND month_year = ?`,
            [participantId, monthYear]
        );
    }

    async listMonthlyStatus(monthYear) {
        return await this.all(
            `SELECT id,
                    participant_id AS participantId,
                    month_year AS monthYear,
                    status,
                    amount_paid AS amountPaid,
                    amount_expected AS amountExpected,
                    justification_reason AS justificationReason,
                    note,
                    source,
                    confirmed_at AS confirmedAt,
                    updated_at AS updatedAt
             FROM monthly_status
             WHERE month_year = ?`,
            [monthYear]
        );
    }

    async upsertMonthlyStatus(data) {
        const participantId = Number(data.participantId);
        const monthYear = String(data.monthYear || '').trim();
        const status = String(data.status || 'pending');
        const allowed = ['pending', 'awaiting_confirmation', 'paid', 'justified'];
        if (!Number.isInteger(participantId) || participantId <= 0) {
            throw new Error('Participante invalido para status mensal.');
        }
        if (!/^\d{4}-\d{2}$/.test(monthYear)) {
            throw new Error('Mes invalido. Use o formato YYYY-MM.');
        }
        if (!allowed.includes(status)) {
            throw new Error('Status mensal invalido.');
        }

        const current = await this.getMonthlyStatus(participantId, monthYear);
        const amountPaid = data.amountPaid !== undefined
            ? Math.max(0, Number(data.amountPaid) || 0)
            : (current ? current.amountPaid : 0);
        const amountExpected = data.amountExpected !== undefined
            ? Math.max(0, Number(data.amountExpected) || 0)
            : (current ? current.amountExpected : 0);
        const reason = data.justificationReason !== undefined
            ? String(data.justificationReason || '')
            : (current ? current.justificationReason : '');
        const note = data.note !== undefined
            ? String(data.note || '')
            : (current ? current.note : '');
        const source = data.source !== undefined
            ? String(data.source || 'manual')
            : (current ? current.source : 'manual');
        const confirmedAt = data.confirmedAt !== undefined
            ? data.confirmedAt
            : (current ? current.confirmedAt : null);

        await this.run(
            `INSERT INTO monthly_status
                (participant_id, month_year, status, amount_paid, amount_expected,
                 justification_reason, note, source, confirmed_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(participant_id, month_year) DO UPDATE SET
                status = excluded.status,
                amount_paid = excluded.amount_paid,
                amount_expected = excluded.amount_expected,
                justification_reason = excluded.justification_reason,
                note = excluded.note,
                source = excluded.source,
                confirmed_at = excluded.confirmed_at,
                updated_at = CURRENT_TIMESTAMP`,
            [participantId, monthYear, status, amountPaid, amountExpected, reason, note, source, confirmedAt]
        );
        return await this.getMonthlyStatus(participantId, monthYear);
    }

    /**
     * Recalcula o status mensal a partir das fontes de verdade (pagamentos e
     * justificativas), preservando "aguardando confirmacao" quando o bot ja
     * recebeu a marcacao mas a pessoa ainda nao confirmou o pagamento.
     */
    async recalculateMonthlyStatus(participantId, monthYear) {
        const bounds = this.monthBounds(monthYear);
        const totalRow = await this.get(
            `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
             FROM payments
             WHERE participant_id = ? AND paid_at >= ? AND paid_at < ?`,
            [participantId, bounds.start, bounds.end]
        );
        const justification = await this.get(
            'SELECT reason FROM justifications WHERE participant_id = ? AND month_year = ?',
            [participantId, monthYear]
        );
        const current = await this.getMonthlyStatus(participantId, monthYear);

        if (Number(totalRow?.count || 0) > 0) {
            return await this.upsertMonthlyStatus({
                participantId,
                monthYear,
                status: 'paid',
                amountPaid: Number(totalRow.total || 0),
                amountExpected: current ? current.amountExpected : 0,
                justificationReason: '',
                note: current ? current.note : '',
                source: current ? current.source : 'payment',
                confirmedAt: current?.confirmedAt || new Date().toISOString()
            });
        }

        if (justification) {
            return await this.upsertMonthlyStatus({
                participantId,
                monthYear,
                status: 'justified',
                amountPaid: 0,
                amountExpected: current ? current.amountExpected : 0,
                justificationReason: justification.reason || (current ? current.justificationReason : ''),
                note: current ? current.note : '',
                source: current ? current.source : 'manual',
                confirmedAt: current?.confirmedAt || new Date().toISOString()
            });
        }

        if (current && current.status === 'awaiting_confirmation') {
            return current;
        }

        return await this.upsertMonthlyStatus({
            participantId,
            monthYear,
            status: 'pending',
            amountPaid: 0,
            amountExpected: current ? current.amountExpected : 0,
            justificationReason: '',
            note: current ? current.note : '',
            source: current ? current.source : 'manual',
            confirmedAt: null
        });
    }

    async setMonthlyStatus(data) {
        const participantId = Number(data.participantId);
        const monthYear = String(data.monthYear || '').trim();
        if (!/^\d{4}-\d{2}$/.test(monthYear)) {
            throw new Error('Mes invalido. Use o formato YYYY-MM.');
        }
        if (data.status === 'paid') {
            const bounds = this.monthBounds(monthYear);
            const payments = await this.get(
                `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
                 FROM payments
                 WHERE participant_id = ? AND paid_at >= ? AND paid_at < ?`,
                [participantId, bounds.start, bounds.end]
            );
            let amountPaid = data.amountPaid !== undefined
                ? Number(data.amountPaid) || 0
                : Number(payments?.total || 0);

            if (Number(payments?.count || 0) > 0) {
                amountPaid = Number(payments.total || 0);
            }

            // Edicao manual da lista: se ainda nao existe pagamento registrado
            // no mes, cria a arrecadacao para que os totais do dashboard
            // tambem reflitam o valor informado.
            if (Number(payments?.count || 0) === 0 && amountPaid > 0) {
                const participant = await this.getParticipant(participantId);
                if (!participant) {
                    throw new Error('Participante nao encontrado.');
                }
                const paidAt = monthYear === this.monthKeyFromDate()
                    ? new Date().toISOString()
                    : `${monthYear}-15T12:00:00.000Z`;
                await this.createPayment({
                    participantId,
                    participantName: participant.name,
                    amount: amountPaid,
                    paidAt,
                    source: data.source || 'manual',
                    reference: `manual-status:${participantId}:${monthYear}`
                });
                return await this.getMonthlyStatus(participantId, monthYear);
            }

            return await this.upsertMonthlyStatus({
                ...data,
                participantId,
                status: 'paid',
                amountPaid: amountPaid || Number(payments?.total || 0),
                confirmedAt: data.confirmedAt || new Date().toISOString()
            });
        }
        // Edicao manual "voltar para pendente": remove o que foi criado pela
        // propria edicao manual (pagamento manual-status e justificativa) para
        // que a lista reflita o status escolhido. Pagamentos reais e de
        // enquete sao preservados de proposito.
        if (data.status === 'pending') {
            await this.run(
                'DELETE FROM payments WHERE participant_id = ? AND reference = ?',
                [participantId, `manual-status:${participantId}:${monthYear}`]
            );
            await this.removeJustification(participantId, monthYear);
            return await this.upsertMonthlyStatus({
                ...data,
                participantId,
                status: 'pending',
                amountPaid: 0,
                justificationReason: '',
                confirmedAt: null
            });
        }
        return await this.upsertMonthlyStatus({ ...data, participantId });
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

        const paidAt = data.paidAt || new Date().toISOString();
        const result = await this.run(
            `INSERT INTO payments (participant_id, participant_name, amount, paid_at, source, reference)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                participant ? participant.id : null,
                participantName,
                amount,
                paidAt,
                data.source || 'manual',
                data.reference || null
            ]
        );

        if (participant) {
            await this.recalculateMonthlyStatus(participant.id, this.monthKeyFromDate(paidAt));
        }

        return await this.get(
            `SELECT id,
                    participant_id AS participantId,
                    participant_name AS participantName,
                    amount,
                    paid_at AS paidAt,
                    source,
                    reference
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
                    source,
                    reference
             FROM payments
             WHERE id = ?`,
            [id]
        );
    }

    async getPaymentByReference(reference) {
        if (!reference) return null;
        return await this.get(
            `SELECT id,
                    participant_id AS participantId,
                    participant_name AS participantName,
                    amount,
                    paid_at AS paidAt,
                    source,
                    reference
             FROM payments
             WHERE reference = ?`,
            [reference]
        );
    }

    async updatePayment(id, data) {
        const current = await this.getPayment(id);
        if (!current) {
            throw new Error('Arrecadacao nao encontrada.');
        }

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
                 source = ?,
                 reference = ?
             WHERE id = ?`,
            [
                participant ? participant.id : null,
                participantName,
                amount,
                data.paidAt || new Date().toISOString(),
                data.source || 'manual',
                data.reference !== undefined ? data.reference : (current.reference || null),
                id
            ]
        );

        const payment = await this.getPayment(id);
        if (!payment) {
            throw new Error('Arrecadacao nao encontrada.');
        }

        if (current.participantId) {
            await this.recalculateMonthlyStatus(current.participantId, this.monthKeyFromDate(current.paidAt));
        }
        if (payment.participantId) {
            await this.recalculateMonthlyStatus(payment.participantId, this.monthKeyFromDate(payment.paidAt));
        }

        return payment;
    }

    async deletePayment(id) {
        const current = await this.getPayment(id);
        const result = await this.run('DELETE FROM payments WHERE id = ?', [id]);
        if (!result.changes) {
            throw new Error('Arrecadacao nao encontrada.');
        }
        if (current && current.participantId) {
            await this.recalculateMonthlyStatus(current.participantId, this.monthKeyFromDate(current.paidAt));
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

    async setJustification(participantId, monthYear, reason = '', source = 'manual') {
        const participant = await this.getParticipant(participantId);
        if (!participant) {
            throw new Error('Participante nao encontrado.');
        }
        await this.run('DELETE FROM justifications WHERE participant_id = ? AND month_year = ?', [participantId, monthYear]);
        await this.run(
            `INSERT INTO justifications (participant_id, month_year, reason, source, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [participantId, monthYear, String(reason || '').trim(), source]
        );
        await this.recalculateMonthlyStatus(participantId, monthYear);
        return { justified: true, reason: String(reason || '').trim() };
    }

    async removeJustification(participantId, monthYear) {
        await this.run('DELETE FROM justifications WHERE participant_id = ? AND month_year = ?', [participantId, monthYear]);
        await this.recalculateMonthlyStatus(participantId, monthYear);
        return { justified: false };
    }

    async toggleJustification(participantId, monthYear, reason = '') {
        const existing = await this.get(
            'SELECT * FROM justifications WHERE participant_id = ? AND month_year = ?',
            [participantId, monthYear]
        );
        if (existing) {
            return await this.removeJustification(participantId, monthYear);
        }
        return await this.setJustification(participantId, monthYear, reason, 'manual');
    }

    async createPollTracking(data) {
        if (!data.messageId) {
            throw new Error('Enquete sem messageId nao pode ser rastreada.');
        }
        const result = await this.run(
            `INSERT OR IGNORE INTO poll_tracking
                (message_id, chat_id, participant_id, participant_number, month_year,
                 kind, flow_key, status, selected_option, amount, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.messageId,
                data.chatId || '',
                data.participantId || null,
                data.participantNumber || null,
                data.monthYear,
                data.kind,
                data.flowKey || '',
                data.status || 'open',
                data.selectedOption || null,
                data.amount !== undefined && data.amount !== null ? Number(data.amount) : null,
                data.note || null
            ]
        );
        if (result.id) {
            return await this.getPollTracking(result.id);
        }
        return await this.getPollTrackingByMessageId(data.messageId);
    }

    mapPollTrackingRow(row) {
        if (!row) return row;
        return {
            ...row,
            amount: row.amount === null || row.amount === undefined ? null : Number(row.amount)
        };
    }

    async getPollTracking(id) {
        const row = await this.get(
            `SELECT id,
                    message_id AS messageId,
                    chat_id AS chatId,
                    participant_id AS participantId,
                    participant_number AS participantNumber,
                    month_year AS monthYear,
                    kind,
                    flow_key AS flowKey,
                    status,
                    selected_option AS selectedOption,
                    amount,
                    note,
                    created_at AS createdAt,
                    updated_at AS updatedAt
             FROM poll_tracking
             WHERE id = ?`,
            [id]
        );
        return this.mapPollTrackingRow(row);
    }

    async getPollTrackingByMessageId(messageId) {
        const row = await this.get(
            `SELECT id,
                    message_id AS messageId,
                    chat_id AS chatId,
                    participant_id AS participantId,
                    participant_number AS participantNumber,
                    month_year AS monthYear,
                    kind,
                    flow_key AS flowKey,
                    status,
                    selected_option AS selectedOption,
                    amount,
                    note,
                    created_at AS createdAt,
                    updated_at AS updatedAt
             FROM poll_tracking
             WHERE message_id = ?`,
            [messageId]
        );
        return this.mapPollTrackingRow(row);
    }

    async getPollsByFlow(flowKey) {
        const rows = await this.all(
            `SELECT id,
                    message_id AS messageId,
                    chat_id AS chatId,
                    participant_id AS participantId,
                    participant_number AS participantNumber,
                    month_year AS monthYear,
                    kind,
                    flow_key AS flowKey,
                    status,
                    selected_option AS selectedOption,
                    amount,
                    note,
                    created_at AS createdAt,
                    updated_at AS updatedAt
             FROM poll_tracking
             WHERE flow_key = ?
             ORDER BY id ASC`,
            [flowKey]
        );
        return rows.map(row => this.mapPollTrackingRow(row));
    }

    async updatePollTracking(id, data) {
        const allowed = ['status', 'selected_option', 'amount', 'note', 'chat_id'];
        const sets = [];
        const params = [];
        for (const key of allowed) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                sets.push(`${key} = ?`);
                params.push(data[key]);
            }
        }
        if (!sets.length) {
            return await this.getPollTracking(id);
        }
        params.push(id);
        await this.run(
            `UPDATE poll_tracking SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            params
        );
        return await this.getPollTracking(id);
    }

    async getOpenPolls(days = 30) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const rows = await this.all(
            `SELECT id,
                    message_id AS messageId,
                    chat_id AS chatId,
                    participant_id AS participantId,
                    participant_number AS participantNumber,
                    month_year AS monthYear,
                    kind,
                    flow_key AS flowKey,
                    status,
                    selected_option AS selectedOption,
                    amount,
                    note,
                    created_at AS createdAt,
                    updated_at AS updatedAt
             FROM poll_tracking
             WHERE created_at >= ?
               AND status NOT IN ('completed', 'cancelled')
             ORDER BY id ASC`,
            [since]
        );
        return rows.map(row => this.mapPollTrackingRow(row));
    }

    async setBotState(data) {
        const expiresAt = data.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await this.run(
            `INSERT INTO bot_states (chat_id, participant_id, month_year, action, payload, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(chat_id, action) DO UPDATE SET
                participant_id = excluded.participant_id,
                month_year = excluded.month_year,
                payload = excluded.payload,
                expires_at = excluded.expires_at`,
            [
                data.chatId,
                data.participantId || null,
                data.monthYear || '',
                data.action,
                typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload || {}),
                expiresAt
            ]
        );
        return await this.getBotState(data.chatId, data.action);
    }

    async getBotState(chatId, action = null) {
        const params = [chatId];
        let sql = `SELECT id,
                          chat_id AS chatId,
                          participant_id AS participantId,
                          month_year AS monthYear,
                          action,
                          payload,
                          expires_at AS expiresAt
                   FROM bot_states
                   WHERE chat_id = ?`;
        if (action) {
            sql += ' AND action = ?';
            params.push(action);
        }
        sql += ' ORDER BY id DESC LIMIT 1';
        const row = await this.get(sql, params);
        if (!row) return null;
        if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
            await this.clearBotState(row.chatId, row.action);
            return null;
        }
        try {
            row.payload = row.payload ? JSON.parse(row.payload) : {};
        } catch (_) {
            row.payload = {};
        }
        return row;
    }

    async clearBotState(chatId, action = null) {
        if (action) {
            await this.run('DELETE FROM bot_states WHERE chat_id = ? AND action = ?', [chatId, action]);
        } else {
            await this.run('DELETE FROM bot_states WHERE chat_id = ?', [chatId]);
        }
    }

    async getDashboard(monthParam) {
        // monthParam should be 'YYYY-MM'. If not provided, use current month.
        const monthYearStr = /^\d{4}-\d{2}$/.test(String(monthParam || ''))
            ? String(monthParam)
            : new Date().toISOString().slice(0, 7);
        const bounds = this.monthBounds(monthYearStr);
        const monthStart = bounds.start;
        const monthEnd = bounds.end;
        const targetDate = new Date(`${monthYearStr}-01T12:00:00Z`);

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

        // Sobra de meses anteriores: tudo o que entrou antes do mes atual
        // menos tudo o que foi gasto antes dele. O valor transita mes a mes,
        // sem duplicar (sempre acumulado ate o inicio do mes selecionado).
        const carryRow = await this.get(
            `SELECT
                (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE paid_at < ?) AS collectedBefore,
                (SELECT COALESCE(SUM(amount), 0) FROM purchases WHERE purchase_date < ?) AS purchasesBefore`,
            [monthStart, monthStart]
        );
        const carryOver = Number(carryRow?.collectedBefore || 0) - Number(carryRow?.purchasesBefore || 0);

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

        // Status do mes: pagamento registrado, justificativa ou o status
        // explicito salvo em monthly_status (inclusive "aguardando confirmacao").
        const allParticipants = await this.getParticipants();

        const paymentsInMonth = await this.all(
            `SELECT participant_id, COALESCE(SUM(amount), 0) AS total
             FROM payments
             WHERE paid_at >= ? AND paid_at < ? AND participant_id IS NOT NULL
             GROUP BY participant_id`,
            [monthStart, monthEnd]
        );
        const paidTotals = new Map(paymentsInMonth.map(p => [p.participant_id, Number(p.total || 0)]));
        const paidParticipantIds = new Set(paymentsInMonth.map(p => p.participant_id));

        const justifications = await this.all(
            `SELECT participant_id, reason FROM justifications WHERE month_year = ?`,
            [monthYearStr]
        );
        const justificationMap = new Map(justifications.map(j => [j.participant_id, j.reason || '']));

        const monthlyRows = await this.listMonthlyStatus(monthYearStr);
        const monthlyMap = new Map(monthlyRows.map(row => [row.participantId, row]));

        const debtors = [];
        const pendingForQuickPay = [];
        const awaitingConfirmation = [];

        for (const p of allParticipants) {
            const monthly = monthlyMap.get(p.id) || null;
            const hasPaid = paidParticipantIds.has(p.id) || monthly?.status === 'paid';
            const isJustified = justificationMap.has(p.id) || monthly?.status === 'justified';
            const isAwaiting = !hasPaid && !isJustified && monthly?.status === 'awaiting_confirmation';

            p.status = hasPaid
                ? 'paid'
                : (isJustified ? 'justified' : (isAwaiting ? 'awaiting_confirmation' : 'pending'));
            p.amountPaid = paidTotals.get(p.id) || Number(monthly?.amountPaid || 0);
            p.amountExpected = Number(monthly?.amountExpected || p.amountDue || 0);
            p.justificationReason = justificationMap.get(p.id) || monthly?.justificationReason || '';
            p.monthlyStatusSource = monthly?.source || null;

            if (isAwaiting) {
                awaitingConfirmation.push(p);
            }

            if (p.status === 'pending') {
                debtors.push(p);
                pendingForQuickPay.push(p);
            }
        }

        const totalCollected = Number(totalRow.total || 0);
        const totalPurchases = Number(purchasesRow.total || 0);

        return {
            month: {
                label: targetDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
                value: monthYearStr,
                totalCollected,
                totalPurchases,
                carryOver,
                totalAvailable: carryOver + totalCollected,
                netBalance: carryOver + totalCollected - totalPurchases,
                payments: totalRow.count || 0
            },
            paidRanking: paidRanking.slice(0, 8),
            payments,
            purchases,
            debtors: debtors.sort((a, b) => b.amountDue - a.amountDue).slice(0, 8),
            pendingParticipants: pendingForQuickPay,
            awaitingConfirmation,
            allParticipants
        };
    }
}

module.exports = new Database();
