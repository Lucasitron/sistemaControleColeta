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

        await this.seedDefaults();
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
        const allowedKeys = ['grupoAlvo', 'pixChave', 'pixCopiaCola', 'maxOpcoesPorEnquete', 'valoresContribuicao'];
        for (const key of allowedKeys) {
            if (Object.prototype.hasOwnProperty.call(settings, key)) {
                const value = Array.isArray(settings[key]) ? JSON.stringify(settings[key]) : String(settings[key]);
                await this.saveSetting(key, value);
            }
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
                data.isDebtor ? 1 : 0,
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

        return {
            delays: defaultConfig.delays,
            nomes,
            maxOpcoesPorEnquete: Number(settings.maxOpcoesPorEnquete || defaultConfig.maxOpcoesPorEnquete),
            grupoAlvo: settings.grupoAlvo || defaultConfig.grupoAlvo,
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
        
        const monthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1).toISOString();
        const nextMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 1).toISOString();

        const totalRow = await this.get(
            `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
             FROM payments
             WHERE paid_at >= ? AND paid_at < ?`,
            [monthStart, nextMonth]
        );

        const purchasesRow = await this.get(
            `SELECT COALESCE(SUM(amount), 0) AS total
             FROM purchases
             WHERE purchase_date >= ? AND purchase_date < ?`,
            [monthStart, nextMonth]
        );

        const purchases = await this.all(
            `SELECT id, description, amount, purchase_date AS purchaseDate
             FROM purchases
             WHERE purchase_date >= ? AND purchase_date < ?
             ORDER BY purchase_date DESC`,
            [monthStart, nextMonth]
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
            [monthStart, nextMonth]
        );

        const paidRanking = await this.all(
            `SELECT participant_name AS name,
                    COALESCE(SUM(amount), 0) AS total,
                    COUNT(*) AS payments
             FROM payments
             WHERE paid_at >= ? AND paid_at < ?
             GROUP BY COALESCE(participant_id, participant_name), participant_name
             ORDER BY total DESC, participant_name ASC`,
            [monthStart, nextMonth]
        );

        // Find pending participants dynamically for the selected month
        // A participant is pending if they haven't paid in the selected month AND are not justified.
        const allParticipants = await this.getParticipants();
        
        const paymentsInMonth = await this.all(
            `SELECT DISTINCT participant_id 
             FROM payments 
             WHERE paid_at >= ? AND paid_at < ? AND participant_id IS NOT NULL`,
            [monthStart, nextMonth]
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
