const state = {
    participants: [],
    purchases: [],
    groups: [],
    groupContacts: [],
    campaigns: [],
    dashboard: null,
    currentMonth: new Date().toISOString().substring(0, 7) // 'YYYY-MM'
};

const labels = {
    professores: 'Professor',
    bolsistas: 'Bolsista',
    usuariosFrequentes: 'Usuario frequente'
};

const elements = {
    statusBadge: document.querySelector('#statusBadge'),
    statusDetails: document.querySelector('#statusDetails'),
    settingsForm: document.querySelector('#settingsForm'),
    participantForm: document.querySelector('#participantForm'),
    purchaseForm: document.querySelector('#purchaseForm'),
    purchasesTable: document.querySelector('#purchasesTable'),
    purchaseCount: document.querySelector('#purchaseCount'),
    groupSelect: document.querySelector('#groupSelect'),
    groupContactsPreview: document.querySelector('#groupContactsPreview'),
    chargeForm: document.querySelector('#chargeForm'),
    participantsTable: document.querySelector('#participantsTable'),
    participantCount: document.querySelector('#participantCount'),
    paidRanking: document.querySelector('#paidRanking'),
    debtorRanking: document.querySelector('#debtorRanking'),
    toast: document.querySelector('#toast')
};

async function api(path, options = {}) {
    const response = await fetch(path, {
        headers: {
            'Content-Type': 'application/json'
        },
        ...options
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Erro na requisicao.');
    }

    if (response.status === 204) {
        return null;
    }

    return await response.json();
}

function showToast(message) {
    const messageElement = elements.toast.querySelector('.toast-message');
    if (messageElement) {
        messageElement.textContent = message;
    } else {
        elements.toast.textContent = message;
    }
    elements.toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3200);
}

async function withLoading(button, loadingText, action) {
    if (!button) return await action();
    const originalText = button.innerHTML;
    button.disabled = true;
    button.textContent = loadingText;
    try {
        return await action();
    } finally {
        button.disabled = false;
        button.innerHTML = originalText;
    }
}

function currency(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function setStatus(status) {
    const badge = elements.statusBadge;
    badge.textContent = status.isReady ? 'conectado' : (status.status || 'desconhecido');
    badge.classList.toggle('ready', Boolean(status.isReady));
    badge.classList.toggle('error', ['erro', 'falha_autenticacao', 'desconectado'].includes(status.status));

    const qrText = status.lastQrAt ? ` QR gerado em ${new Date(status.lastQrAt).toLocaleString('pt-BR')}.` : '';
    const errorText = status.lastError ? ` Ultimo erro: ${status.lastError}` : '';
    elements.statusDetails.textContent = status.isReady
        ? 'WhatsApp pronto para enviar campanhas e relatórios.'
        : `Quando necessario, o QR Code aparece abaixo e no terminal do servidor.${qrText}${errorText}`;

    const qrPanel = document.querySelector('#qrPanel');
    const qrImage = document.querySelector('#whatsappQr');
    if (status.qrDataUrl && !status.isReady) {
        qrImage.src = status.qrDataUrl;
        qrPanel.hidden = false;
    } else {
        qrImage.removeAttribute('src');
        qrPanel.hidden = true;
    }

    renderBotLogs(status.logs || []);
}

function fillSettings(settings) {
    document.querySelector('#grupoAlvo').value = settings.grupoAlvo || '';
    document.querySelector('#pixChave').value = settings.pixChave || '';
    document.querySelector('#pixCopiaCola').value = settings.pixCopiaCola || '';
    document.querySelector('#maxOpcoesPorEnquete').value = settings.maxOpcoesPorEnquete || 10;
    
    let valoresText = settings.valoresContribuicao || [];
    if(Array.isArray(valoresText)) valoresText = valoresText.join(', ');
    document.querySelector('#valoresContribuicao').value = valoresText;
}

function readSettingsPayload() {
    const valores = document.querySelector('#valoresContribuicao').value
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

    return {
        grupoAlvo: document.querySelector('#grupoAlvo').value,
        pixChave: document.querySelector('#pixChave').value,
        pixCopiaCola: document.querySelector('#pixCopiaCola').value,
        maxOpcoesPorEnquete: document.querySelector('#maxOpcoesPorEnquete').value,
        valoresContribuicao: valores
    };
}

function filteredParticipants() {
    const search = document.querySelector('#searchParticipants').value.trim().toLowerCase();
    const category = document.querySelector('#categoryFilter').value;

    return state.participants.filter((participant) => {
        const matchesSearch = [participant.name, participant.whatsappNumber]
            .filter(Boolean)
            .some(value => String(value).toLowerCase().includes(search));
        const matchesCategory = category === 'todos' || participant.category === category;
        return matchesSearch && matchesCategory;
    });
}

function renderDashboard() {
    const dashboard = state.dashboard;
    if (!dashboard) return;

    document.querySelector('#monthDisplay').textContent = dashboard.month.label;
    document.querySelector('#monthCollected').textContent = currency(dashboard.month.totalCollected);
    document.querySelector('#monthPurchases').textContent = currency(dashboard.month.totalPurchases);
    
    const balanceEl = document.querySelector('#monthBalance');
    balanceEl.textContent = currency(dashboard.month.netBalance);
    const balanceCard = document.querySelector('#balanceCard');
    if(dashboard.month.netBalance < 0) {
        balanceCard.classList.add('alert');
    } else {
        balanceCard.classList.remove('alert');
    }

    document.querySelector('#monthPayments').textContent = `${dashboard.month.payments || 0} pagamentos registrados`;
    document.querySelector('#totalDebtors').textContent = dashboard.debtors.length;

    renderRanking(elements.paidRanking, dashboard.paidRanking, 'Sem arrecadacoes neste mes.', item => ({
        title: item.name,
        meta: `${item.payments} pagamento(s)`,
        value: currency(item.total)
    }));

    renderRanking(elements.debtorRanking, dashboard.debtors, 'Nenhum pendente neste mes.', item => ({
        title: item.name,
        meta: labels[item.category] || 'Participante',
        value: Number(item.amountDue || 0) > 0 ? currency(item.amountDue) : 'Pendente'
    }));

    renderPendingPayments();
    renderPurchases();
    
    const select = document.querySelector('#chargeParticipant');
    select.innerHTML = '<option value="todos">Todos os pendentes do mês</option>' + 
        dashboard.pendingParticipants.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

function renderBotLogs(logs) {
    const container = document.querySelector('#botLogs');
    const recentLogs = logs.slice(-6).reverse();
    if (!recentLogs.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = recentLogs.map((log) => `
        <div class="bot-log ${escapeHtml(log.level)}">
            <span>${new Date(log.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <p>${escapeHtml(log.message)}</p>
        </div>
    `).join('');
}

function renderRanking(container, rows, emptyText, mapper) {
    if (!rows || !rows.length) {
        container.className = 'ranking-list empty-state';
        container.innerHTML = `<i class="ph ph-empty"></i> ${emptyText}`;
        return;
    }

    container.className = 'ranking-list';
    container.innerHTML = rows.map((row, index) => {
        const item = mapper(row);
        return `
            <article class="ranking-item">
                <span class="rank">${index + 1}</span>
                <div>
                    <strong>${escapeHtml(item.title)}</strong>
                    <small>${escapeHtml(item.meta)}</small>
                </div>
                <b>${escapeHtml(item.value)}</b>
            </article>
        `;
    }).join('');
}

function renderPendingPayments() {
    const container = document.querySelector('#pendingPaymentsList');
    const pending = state.dashboard.pendingParticipants || [];
    if (!pending.length) {
        container.innerHTML = '<div class="insight-row"><i class="ph ph-check-circle" style="color:var(--ok);font-size:1.5rem;"></i> Todos já pagaram este mês.</div>';
        return;
    }
    
    const valoresStr = document.querySelector('#valoresContribuicao').value || '10, 20';
    const values = valoresStr.split(',').map(v => Number(v.replace(/[^0-9.-]+/g,""))).filter(v => v > 0);
    if (!values.length) values.push(10); 
    
    container.innerHTML = pending.map(p => {
        const defaultVal = p.amountDue || values[0];
        let options = values.map(v => `<option value="${v}" ${v==defaultVal?'selected':''}>${currency(v)}</option>`).join('');
        if (!values.includes(defaultVal)) {
            options = `<option value="${defaultVal}" selected>${currency(defaultVal)}</option>` + options;
        }

        return `
        <article class="list-item" style="padding:12px; margin-bottom:8px;">
            <div style="flex:1;">
                <strong>${escapeHtml(p.name)}</strong>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                <select id="quickVal_${p.id}" style="width: auto; padding: 6px; font-size: 0.9rem; border-radius:8px; background:rgba(0,0,0,0.3);">
                    ${options}
                </select>
                <button type="button" class="primary" style="padding: 6px 12px; border-radius:8px;" onclick="quickPay(${p.id})">
                    <i class="ph ph-check"></i>
                </button>
            </div>
        </article>
    `}).join('');
}

window.quickPay = async function(participantId) {
    const amount = document.querySelector('#quickVal_' + participantId).value;
    try {
        await api('/api/payments', {
            method: 'POST',
            body: JSON.stringify({
                participantId,
                amount: amount,
                paidAt: new Date().toISOString()
            })
        });
        showToast('Arrecadação registrada.');
        refreshDashboard();
    } catch(err) {
        showToast(err.message);
    }
};

window.toggleJustify = async function(participantId) {
    try {
        await api('/api/justifications', {
            method: 'POST',
            body: JSON.stringify({ participantId, monthYear: state.dashboard.month.value })
        });
        showToast('Status mensal atualizado.');
        refreshDashboard();
    } catch(err) {
        showToast(err.message);
    }
};

function renderParticipants() {
    const rows = filteredParticipants();
    elements.participantCount.textContent = `${state.participants.length} nomes`;

    if (!rows.length) {
        elements.participantsTable.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state" style="text-align: center;"><i class="ph ph-empty"></i> Nenhum participante encontrado.</td>
            </tr>
        `;
        return;
    }

    elements.participantsTable.innerHTML = rows.map(participant => {
        let statusPill = '<span class="pill due"><i class="ph-fill ph-warning-circle"></i> Pendente</span>';
        if (participant.status === 'paid') {
            statusPill = '<span class="pill"><i class="ph-fill ph-check-circle"></i> Em dia</span>';
        } else if (participant.status === 'justified') {
            statusPill = '<span class="pill" style="background:rgba(59, 130, 246, 0.15); color:#60a5fa; border-color:rgba(59, 130, 246, 0.3);"><i class="ph-fill ph-shield-check"></i> Justificado</span>';
        }

        return `
        <tr>
            <td><strong>${escapeHtml(participant.name)}</strong></td>
            <td>${labels[participant.category]}</td>
            <td>${participant.whatsappNumber ? escapeHtml(participant.whatsappNumber) : '<span class="muted">Sem numero</span>'}</td>
            <td>${currency(participant.amountDue)}</td>
            <td>${statusPill}</td>
            <td class="actions">
                <button data-action="toggleJustify" data-id="${participant.id}" title="Justificar Ausência neste Mês"><i class="ph ph-shield-check"></i></button>
                <button data-action="edit" data-id="${participant.id}" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                <button class="danger" data-action="delete" data-id="${participant.id}" title="Excluir"><i class="ph ph-trash"></i></button>
            </td>
        </tr>
    `}).join('');
}

function renderPurchases() {
    if (!elements.purchasesTable) return;

    elements.purchaseCount.textContent = `${state.purchases.length} compras`;
    if (!state.purchases.length) {
        elements.purchasesTable.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state" style="text-align: center;"><i class="ph ph-empty"></i> Nenhuma compra registrada.</td>
            </tr>
        `;
        return;
    }

    elements.purchasesTable.innerHTML = state.purchases.map((purchase) => `
        <tr>
            <td>${formatDate(purchase.purchaseDate)}</td>
            <td><strong>${escapeHtml(purchase.description)}</strong></td>
            <td>${currency(purchase.amount)}</td>
            <td class="actions">
                <button data-action="editPurchase" data-id="${purchase.id}" title="Editar compra"><i class="ph ph-pencil-simple"></i></button>
            </td>
        </tr>
    `).join('');
}

function renderGroups() {
    if (!elements.groupSelect) return;

    if (!state.groups.length) {
        elements.groupSelect.innerHTML = '<option value="">Nenhum grupo carregado</option>';
        return;
    }

    elements.groupSelect.innerHTML = '<option value="">Selecione um grupo</option>' + state.groups.map((group) => {
        const count = group.participants === null ? '' : ` (${group.participants})`;
        return `<option value="${escapeHtml(group.id)}" data-name="${escapeHtml(group.name)}">${escapeHtml(group.name)}${count}</option>`;
    }).join('');
}

function renderGroupContacts() {
    if (!elements.groupContactsPreview) return;

    if (!state.groupContacts.length) {
        elements.groupContactsPreview.className = 'contacts-preview empty-state';
        elements.groupContactsPreview.innerHTML = '<i class="ph ph-users"></i> Nenhum contato carregado.';
        return;
    }

    elements.groupContactsPreview.className = 'contacts-preview';
    elements.groupContactsPreview.innerHTML = `
        <div class="contacts-preview-header">
            <strong>${state.groupContacts.length} contatos carregados</strong>
            <span>${state.groupContacts.filter(contact => contact.isAdmin).length} admins</span>
        </div>
        <div class="contact-chip-list">
            ${state.groupContacts.slice(0, 30).map((contact) => `
                <span class="contact-chip" title="${escapeHtml(contact.number)}">
                    ${escapeHtml(contact.name)}
                </span>
            `).join('')}
        </div>
        ${state.groupContacts.length > 30 ? `<small class="muted">+${state.groupContacts.length - 30} contatos ocultos na prévia</small>` : ''}
    `;
}

function selectedGroup() {
    const groupId = elements.groupSelect.value;
    return state.groups.find(group => group.id === groupId) || null;
}

async function listGroups() {
    const status = await api('/api/bot/status');
    setStatus(status);

    if (!status.isReady) {
        const nextStatus = status.isInitializing
            ? status
            : await api('/api/bot/start', { method: 'POST' });
        setStatus(nextStatus);
        throw new Error('WhatsApp iniciando. Escaneie o QR Code e aguarde ficar conectado para listar grupos.');
    }

    state.groups = await api('/api/bot/groups');
    renderGroups();
    showToast(`${state.groups.length} grupos encontrados.`);
}

async function loadGroupContacts() {
    const status = await api('/api/bot/status');
    setStatus(status);
    if (!status.isReady) {
        throw new Error('WhatsApp ainda nao esta conectado. Aguarde antes de carregar contatos.');
    }

    const group = selectedGroup();
    if (!group) {
        throw new Error('Selecione um grupo primeiro.');
    }

    state.groupContacts = await api(`/api/bot/group-participants?groupId=${encodeURIComponent(group.id)}`);
    renderGroupContacts();
    showToast(`${state.groupContacts.length} contatos carregados.`);
}

async function importGroupContacts() {
    if (!state.groupContacts.length) {
        throw new Error('Carregue os contatos do grupo primeiro.');
    }

    const category = document.querySelector('#importCategory').value;
    const existingKeys = new Set(state.participants.flatMap((participant) => [
        String(participant.name || '').trim().toLowerCase(),
        String(participant.whatsappNumber || '').replace(/\D/g, '')
    ].filter(Boolean)));

    let imported = 0;
    let skipped = 0;

    for (const contact of state.groupContacts) {
        const name = String(contact.name || contact.number || '').trim();
        const number = String(contact.number || '').replace(/\D/g, '');
        const isDuplicate = existingKeys.has(name.toLowerCase()) || existingKeys.has(number);

        if (!name || isDuplicate) {
            skipped++;
            continue;
        }

        await api('/api/participants', {
            method: 'POST',
            body: JSON.stringify({
                name,
                category,
                whatsappNumber: number,
                amountDue: 0
            })
        });

        existingKeys.add(name.toLowerCase());
        if (number) existingKeys.add(number);
        imported++;
    }

    await refreshDashboard();
    showToast(`${imported} contatos importados. ${skipped} ignorados.`);
}

function formatDate(value) {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('pt-BR');
}

function dateInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resetPurchaseForm() {
    document.querySelector('#purchaseId').value = '';
    document.querySelector('#purchaseDesc').value = '';
    document.querySelector('#purchaseAmount').value = '';
    document.querySelector('#purchaseDate').value = '';
    document.querySelector('#purchaseFormTitle').textContent = 'Registrar Despesa';
    document.querySelector('#cancelPurchaseEdit').hidden = true;
}

function editPurchase(id) {
    const purchase = state.purchases.find(item => item.id === Number(id));
    if (!purchase) return;

    document.querySelector('#purchaseId').value = purchase.id;
    document.querySelector('#purchaseDesc').value = purchase.description;
    document.querySelector('#purchaseAmount').value = purchase.amount;
    document.querySelector('#purchaseDate').value = dateInputValue(purchase.purchaseDate);
    document.querySelector('#purchaseFormTitle').textContent = 'Editar Despesa';
    document.querySelector('#cancelPurchaseEdit').hidden = false;
    document.querySelector('#purchaseDesc').focus();
    document.querySelector('#caixa').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetParticipantForm() {
    document.querySelector('#participantId').value = '';
    document.querySelector('#participantName').value = '';
    document.querySelector('#participantCategory').value = 'professores';
    document.querySelector('#participantWhatsapp').value = '';
    document.querySelector('#participantAmountDue').value = '';
}

function editParticipant(id) {
    const participant = state.participants.find(item => item.id === Number(id));
    if (!participant) return;

    document.querySelector('#participantId').value = participant.id;
    document.querySelector('#participantName').value = participant.name;
    document.querySelector('#participantCategory').value = participant.category;
    document.querySelector('#participantWhatsapp').value = participant.whatsappNumber || '';
    document.querySelector('#participantAmountDue').value = participant.amountDue || '';
    document.querySelector('#participantName').focus();
    document.querySelector('#participantes').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteParticipant(id) {
    if(!confirm("Excluir este participante definitivamente?")) return;
    await api(`/api/participants/${id}`, { method: 'DELETE' });
    showToast('Participante removido.');
    refreshDashboard();
}

async function refreshDashboard() {
    const [dashboard, purchases] = await Promise.all([
        api(`/api/dashboard?month=${state.currentMonth}`),
        api('/api/purchases')
    ]);
    state.dashboard = dashboard;
    state.purchases = purchases;
    state.participants = state.dashboard.allParticipants;
    renderDashboard();
    renderParticipants();
}

async function loadConfig() {
    const payload = await api('/api/config');
    fillSettings(payload.settings);
    await refreshDashboard();
}

async function refreshStatus() {
    const status = await api('/api/bot/status');
    setStatus(status);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

document.querySelector('#prevMonth').addEventListener('click', () => {
    let [year, month] = state.currentMonth.split('-');
    let date = new Date(year, month - 2, 1); 
    state.currentMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    refreshDashboard();
});

document.querySelector('#nextMonth').addEventListener('click', () => {
    let [year, month] = state.currentMonth.split('-');
    let date = new Date(year, month, 1); 
    state.currentMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    refreshDashboard();
});

document.querySelector('#startWhatsapp').addEventListener('click', async () => {
    try {
        await withLoading(document.querySelector('#startWhatsapp'), 'Iniciando...', async () => {
            const status = await api('/api/bot/start', { method: 'POST' });
            setStatus(status);
            showToast('WhatsApp iniciando. Verifique o QR Code no terminal.');
        });
    } catch (error) {
        showToast(error.message);
    }
});

document.querySelector('#sendCampaign').addEventListener('click', async () => {
    try {
        await withLoading(document.querySelector('#sendCampaign'), 'Enviando...', async () => {
            const result = await api('/api/bot/campaign', { method: 'POST' });
            showToast(result.message);
        });
    } catch (error) {
        showToast(error.message);
    }
});

document.querySelector('#btnSendReport').addEventListener('click', async (e) => {
    try {
        await withLoading(e.target, '<i class="ph ph-spinner ph-spin"></i> Enviando...', async () => {
            const res = await api('/api/bot/report', { 
                method: 'POST', 
                body: JSON.stringify({ month: state.currentMonth }) 
            });
            showToast(res.message);
        });
    } catch(err) {
        showToast(err.message);
    }
});

elements.settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(readSettingsPayload())
    });

    showToast('Configuracoes salvas.');
});

document.querySelector('#btnListGroups').addEventListener('click', async (event) => {
    try {
        await withLoading(event.currentTarget, 'Buscando...', listGroups);
    } catch (error) {
        showToast(error.message);
    }
});

document.querySelector('#btnSelectGroup').addEventListener('click', async (event) => {
    try {
        await withLoading(event.currentTarget, 'Salvando...', async () => {
            const group = selectedGroup();
            if (!group) {
                throw new Error('Selecione um grupo primeiro.');
            }

            document.querySelector('#grupoAlvo').value = group.name;
            await api('/api/settings', {
                method: 'PUT',
                body: JSON.stringify(readSettingsPayload())
            });
            showToast(`Grupo selecionado: ${group.name}`);
        });
    } catch (error) {
        showToast(error.message);
    }
});

document.querySelector('#btnLoadGroupContacts').addEventListener('click', async (event) => {
    try {
        await withLoading(event.currentTarget, 'Carregando...', loadGroupContacts);
    } catch (error) {
        showToast(error.message);
    }
});

document.querySelector('#btnImportGroupContacts').addEventListener('click', async (event) => {
    try {
        await withLoading(event.currentTarget, 'Importando...', importGroupContacts);
    } catch (error) {
        showToast(error.message);
    }
});

elements.purchaseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await withLoading(e.submitter, 'Salvando...', async () => {
            const id = document.querySelector('#purchaseId').value;
            let pDate = document.querySelector('#purchaseDate').value;
            await api(id ? `/api/purchases/${id}` : '/api/purchases', {
                method: id ? 'PUT' : 'POST',
                body: JSON.stringify({
                    description: document.querySelector('#purchaseDesc').value,
                    amount: document.querySelector('#purchaseAmount').value,
                    purchaseDate: pDate ? new Date(pDate + "T12:00:00").toISOString() : new Date().toISOString()
                })
            });
            showToast('Despesa salva.');
            resetPurchaseForm();
            refreshDashboard();
        });
    } catch(err) {
        showToast(err.message);
    }
});

elements.chargeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const target = document.querySelector('#chargeParticipant').value;
    
    await withLoading(event.submitter, 'Enviando...', async () => {
        if (target === 'todos') {
            const pending = state.dashboard.pendingParticipants || [];
            if(pending.length === 0) {
                showToast("Ninguém pendente neste mês.");
                return;
            }
            let sent = 0;
            for(const p of pending) {
                if(p.whatsappNumber) {
                    await api('/api/bot/charge', {
                        method: 'POST',
                        body: JSON.stringify({
                            number: p.whatsappNumber,
                            name: p.name,
                            amountDue: p.amountDue
                        })
                    }).catch(e => console.error("Erro ao cobrar", p.name, e));
                    sent++;
                }
            }
            showToast(`${sent} cobranças enviadas.`);
        } else {
            const p = state.participants.find(x => x.id === Number(target));
            if(p && p.whatsappNumber) {
                await api('/api/bot/charge', {
                    method: 'POST',
                    body: JSON.stringify({
                        number: p.whatsappNumber,
                        name: p.name,
                        amountDue: p.amountDue
                    })
                });
                showToast(`Cobrança enviada para ${p.name}.`);
            } else {
                showToast("Participante sem número de WhatsApp.");
            }
        }
    });
});

elements.participantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.querySelector('#participantId').value;
    const payload = {
        name: document.querySelector('#participantName').value,
        category: document.querySelector('#participantCategory').value,
        whatsappNumber: document.querySelector('#participantWhatsapp').value,
        amountDue: document.querySelector('#participantAmountDue').value
    };

    await withLoading(event.submitter, 'Salvando...', () => api(id ? `/api/participants/${id}` : '/api/participants', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
    }));

    resetParticipantForm();
    await refreshDashboard();
    showToast('Participante salvo.');
});

document.querySelector('#cancelEdit').addEventListener('click', resetParticipantForm);
document.querySelector('#cancelPurchaseEdit').addEventListener('click', resetPurchaseForm);
document.querySelector('#searchParticipants').addEventListener('input', renderParticipants);
document.querySelector('#categoryFilter').addEventListener('change', renderParticipants);

elements.participantsTable.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.dataset.action === 'toggleJustify') {
        window.toggleJustify(button.dataset.id);
    }

    if (button.dataset.action === 'edit') {
        editParticipant(button.dataset.id);
    }

    if (button.dataset.action === 'delete') {
        await deleteParticipant(button.dataset.id);
    }
});

elements.purchasesTable.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.dataset.action === 'editPurchase') {
        editPurchase(button.dataset.id);
    }
});

loadConfig()
    .then(refreshStatus)
    .catch(error => showToast(error.message));

window.setInterval(refreshStatus, 6000);
