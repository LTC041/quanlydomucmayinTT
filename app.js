(() => {
  'use strict';

  const STORE_KEY = 'printer-toner-tracker:v2';
  const LEGACY_KEY = 'printer-toner-tracker:v1';
  const DEFAULT_SETTINGS = { threshold: 2, theme: 'light' };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const els = {
    topbar: $('#topbar'),
    search: $('#search'),
    statusFilter: $('#statusFilter'),
    roomFilter: $('#roomFilter'),
    monthFilter: $('#monthFilter'),
    yearFilter: $('#yearFilter'),
    sortBy: $('#sortBy'),
    clearFilters: $('#clearFilters'),
    tbody: $('#tbody'),
    mobileList: $('#mobileList'),
    emptyState: $('#emptyState'),
    dropZone: $('#dropZone'),
    countAll: $('#countAll'),
    countOk: $('#countOk'),
    countWarn: $('#countWarn'),
    countDanger: $('#countDanger'),
    resultInfo: $('#resultInfo'),
    thresholdHint: $('#thresholdHint'),
    addPrinter: $('#addPrinter'),
    emptyAddBtn: $('#emptyAddBtn'),
    themeToggle: $('#themeToggle'),
    themeIcon: $('#themeIcon'),
    importBtn: $('#importBtn'),
    importInput: $('#importInput'),
    exportExcelBtn: $('#exportExcelBtn'),
    moreBtn: $('#moreBtn'),
    moreMenu: $('#moreMenu'),
    restoreInput: $('#restoreInput'),
    roomsList: $('#roomsList'),
    toastRegion: $('#toastRegion'),
    editDialog: $('#editDialog'),
    printerForm: $('#printerForm'),
    editTitle: $('#editTitle'),
    editKicker: $('#editKicker'),
    fRoom: $('#fRoom'),
    fAssetCode: $('#fAssetCode'),
    fModel: $('#fModel'),
    fCartridge: $('#fCartridge'),
    fRefillCnt: $('#fRefillCnt'),
    fLastReplace: $('#fLastReplace'),
    fNote: $('#fNote'),
    formError: $('#formError'),
    historyDialog: $('#historyDialog'),
    historyTitle: $('#historyTitle'),
    historySubtitle: $('#historySubtitle'),
    historySummary: $('#historySummary'),
    historyList: $('#historyList'),
    historyEmpty: $('#historyEmpty'),
    importDialog: $('#importDialog'),
    importDescription: $('#importDescription'),
    confirmImport: $('#confirmImport'),
    settingsDialog: $('#settingsDialog'),
    settingsForm: $('#settingsForm'),
    fThreshold: $('#fThreshold'),
    confirmDialog: $('#confirmDialog'),
    confirmIcon: $('#confirmIcon'),
    confirmTitle: $('#confirmTitle'),
    confirmMessage: $('#confirmMessage'),
    confirmAccept: $('#confirmAccept'),
    confirmCancel: $('#confirmCancel'),
  };

  let migratedFromLegacy = false;
  let state = loadStore();
  let editingId = null;
  let pendingImportRows = [];
  let pendingConfirm = null;
  let lastUndo = null;

  function safeUUID() {
    return globalThis.crypto?.randomUUID?.() || `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function nowLocalISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function todayISO() {
    return nowLocalISO().slice(0, 10);
  }

  function normalizeDate(value) {
    if (!value) return '';
    const text = String(value).trim();
    const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      const [, y, m, d] = match;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const vn = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (vn) {
      const [, d, m, y] = vn;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return '';
  }

  function parseLocalDate(value) {
    const date = normalizeDate(value);
    if (!date) return null;
    const [y, m, d] = date.split('-').map(Number);
    const result = new Date(y, m - 1, d);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function parseDateTime(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
      const [datePart, timePart = '00:00:00'] = text.split('T');
      const [y, m, d] = datePart.split('-').map(Number);
      const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number);
      const result = new Date(y, m - 1, d, hh, mm, ss);
      return Number.isNaN(result.getTime()) ? null : result;
    }
    return parseLocalDate(text);
  }

  function formatDate(value) {
    const d = parseLocalDate(value);
    if (!d) return 'Chưa có';
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }

  function formatDateTime(value) {
    const d = parseDateTime(value);
    if (!d) return 'Chưa có';
    const hasTime = String(value).includes('T');
    return new Intl.DateTimeFormat('vi-VN', hasTime
      ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }

  function dateValue(value) {
    const d = parseDateTime(value);
    return d ? d.getTime() : 0;
  }

  function coerceNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
  }

  function cleanText(value, max = 500) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
      .map((entry) => ({
        id: cleanText(entry?.id, 80) || safeUUID(),
        ts: cleanText(entry?.ts, 40) || todayISO(),
        action: ['refill', 'replace', 'info'].includes(entry?.action) ? entry.action : 'info',
        note: cleanText(entry?.note, 500),
      }))
      .filter((entry) => entry.ts);
  }

  function normalizePrinter(raw) {
    const result = {
      id: cleanText(raw?.id, 100) || safeUUID(),
      room: cleanText(raw?.room, 120),
      assetCode: cleanText(raw?.assetCode ?? raw?.printerCode ?? '', 80),
      model: cleanText(raw?.model, 160),
      cartridge: cleanText(raw?.cartridge, 100),
      refillCnt: coerceNumber(raw?.refillCnt, 0),
      lastReplace: normalizeDate(raw?.lastReplace),
      note: cleanText(raw?.note, 500),
      history: normalizeHistory(raw?.history),
      createdAt: cleanText(raw?.createdAt, 40) || nowLocalISO(),
      updatedAt: cleanText(raw?.updatedAt, 40) || nowLocalISO(),
    };
    return result;
  }

  function normalizeSettings(raw) {
    const threshold = Math.min(10, Math.max(1, coerceNumber(raw?.threshold, DEFAULT_SETTINGS.threshold)));
    const theme = raw?.theme === 'dark' ? 'dark' : 'light';
    return { threshold, theme };
  }

  function readStoredData(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.rows) ? parsed.rows : null);
      if (!rows) return null;
      return {
        rows: rows.map(normalizePrinter),
        settings: normalizeSettings(parsed?.settings),
      };
    } catch (error) {
      console.warn(`Không thể đọc dữ liệu cục bộ từ ${key}.`, error);
      return null;
    }
  }

  function loadStore() {
    const current = readStoredData(STORE_KEY);
    const legacy = readStoredData(LEGACY_KEY);

    // Ưu tiên dữ liệu phiên bản mới khi đã có danh sách máy in.
    if (current?.rows?.length) return current;

    // Bảo vệ dữ liệu cũ: nếu bản v2 đang trống nhưng bản v1 còn máy in,
    // tự lấy bản v1 để hiển thị và chép sang v2 ngay trong lần khởi động này.
    if (legacy?.rows?.length) {
      migratedFromLegacy = true;
      return {
        rows: legacy.rows,
        settings: current?.settings ?? { ...DEFAULT_SETTINGS },
      };
    }

    if (current) return current;
    return { rows: [], settings: { ...DEFAULT_SETTINGS } };
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 2, rows: state.rows, settings: state.settings, savedAt: nowLocalISO() }));
    } catch (error) {
      console.error(error);
      toast('Không thể lưu dữ liệu do bộ nhớ trình duyệt đã đầy.', 'error');
    }
  }

  function setTheme(theme) {
    state.settings.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = state.settings.theme;
    els.themeIcon.textContent = state.settings.theme === 'dark' ? '☀' : '☾';
    els.themeToggle.title = state.settings.theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
    saveStore();
  }

  function statusOf(printer) {
    const count = coerceNumber(printer.refillCnt, 0);
    const threshold = state.settings.threshold;
    if (count >= threshold) return { key: 'danger', label: 'Đến hạn thay', detail: `Từ ${threshold} lần đổ` };
    if (count === threshold - 1) return { key: 'warn', label: 'Cần lưu ý', detail: `Còn 1 lần trước khi thay` };
    return { key: 'ok', label: 'Đang bình thường', detail: 'Chưa cần xử lý' };
  }

  function latestHistory(printer) {
    const history = normalizeHistory(printer.history);
    if (!history.length) return null;
    return [...history].sort((a, b) => dateValue(b.ts) - dateValue(a.ts))[0];
  }

  function hasActivityInPeriod(printer, month, year) {
    if (month === 'all' && year === 'all') return true;
    const candidates = [...normalizeHistory(printer.history).map((h) => h.ts), printer.lastReplace].filter(Boolean);
    return candidates.some((value) => {
      const d = parseDateTime(value);
      if (!d) return false;
      const monthMatches = month === 'all' || d.getMonth() + 1 === Number(month);
      const yearMatches = year === 'all' || d.getFullYear() === Number(year);
      return monthMatches && yearMatches;
    });
  }

  function printerMatchesSearch(printer, query) {
    if (!query) return true;
    const haystack = [printer.room, printer.assetCode, printer.model, printer.cartridge, printer.note]
      .join(' ').toLocaleLowerCase('vi-VN');
    return haystack.includes(query.toLocaleLowerCase('vi-VN'));
  }

  function getFilters() {
    // Một số trình duyệt khôi phục giá trị cũ của biểu mẫu sau khi tải lại.
    // Chuẩn hóa giá trị rỗng về "all" để danh sách không bị lọc thành rỗng.
    return {
      query: cleanText(els.search.value, 200),
      status: els.statusFilter.value || 'all',
      room: els.roomFilter.value || 'all',
      month: els.monthFilter.value || 'all',
      year: els.yearFilter.value || 'all',
      sortBy: els.sortBy.value || 'priority',
    };
  }

  function priorityValue(printer) {
    const status = statusOf(printer).key;
    return status === 'danger' ? 3 : status === 'warn' ? 2 : 1;
  }

  function getFilteredRows() {
    const filters = getFilters();
    const rows = state.rows.filter((printer) => {
      if (!printerMatchesSearch(printer, filters.query)) return false;
      if (filters.status !== 'all' && statusOf(printer).key !== filters.status) return false;
      if (filters.room !== 'all' && printer.room !== filters.room) return false;
      if (!hasActivityInPeriod(printer, filters.month, filters.year)) return false;
      return true;
    });

    return rows.sort((a, b) => {
      const latestA = Math.max(dateValue(a.updatedAt), dateValue(latestHistory(a)?.ts), dateValue(a.lastReplace));
      const latestB = Math.max(dateValue(b.updatedAt), dateValue(latestHistory(b)?.ts), dateValue(b.lastReplace));
      if (filters.sortBy === 'updated') return latestB - latestA || a.model.localeCompare(b.model, 'vi');
      if (filters.sortBy === 'room') return a.room.localeCompare(b.room, 'vi') || a.model.localeCompare(b.model, 'vi');
      if (filters.sortBy === 'model') return a.model.localeCompare(b.model, 'vi') || a.room.localeCompare(b.room, 'vi');
      return priorityValue(b) - priorityValue(a) || latestB - latestA || a.model.localeCompare(b.model, 'vi');
    });
  }

  function escapeHtml(value = '') {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value).replace(/[&<>"']/g, (char) => map[char]);
  }

  function renderRoomOptions() {
    const currentFilter = els.roomFilter.value;
    const currentFormValue = els.fRoom.value;
    const rooms = [...new Set(state.rows.map((r) => r.room).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    const options = rooms.map((room) => `<option value="${escapeHtml(room)}">${escapeHtml(room)}</option>`).join('');

    els.roomFilter.innerHTML = `<option value="all">Tất cả phòng / bộ phận</option>${options}`;
    els.roomFilter.value = rooms.includes(currentFilter) ? currentFilter : 'all';

    // Phòng/bộ phận trong biểu mẫu là danh sách lựa chọn để tránh nhập sai tên phòng.
    els.fRoom.innerHTML = `<option value="">— Chọn phòng / bộ phận —</option>${options}`;
    els.fRoom.value = rooms.includes(currentFormValue) ? currentFormValue : '';

    // Giữ datalist cũ để tương thích với các bản HTML trước đó (nếu có bộ nhớ đệm trình duyệt).
    if (els.roomsList) {
      els.roomsList.innerHTML = rooms.map((room) => `<option value="${escapeHtml(room)}"></option>`).join('');
    }
  }

  function renderYearOptions() {
    const current = els.yearFilter.value;
    const years = new Set([new Date().getFullYear()]);
    state.rows.forEach((printer) => {
      [printer.lastReplace, printer.createdAt, printer.updatedAt, ...normalizeHistory(printer.history).map((h) => h.ts)].forEach((value) => {
        const d = parseDateTime(value);
        if (d) years.add(d.getFullYear());
      });
    });
    const values = [...years].sort((a, b) => b - a);
    els.yearFilter.innerHTML = `<option value="all">Tất cả năm</option>${values.map((year) => `<option value="${year}">${year}</option>`).join('')}`;
    els.yearFilter.value = values.includes(Number(current)) ? current : 'all';
  }

  function statusBadge(status) {
    return `<span class="status-badge badge-${status.key}" title="${escapeHtml(status.detail)}">${escapeHtml(status.label)}</span>`;
  }

  function actionButtons(printer) {
    return `<div class="row-actions">
      <button class="action-btn refill" type="button" data-action="refill" data-id="${escapeHtml(printer.id)}" title="Ghi nhận đã đổ mực">+ Đổ</button>
      <button class="action-btn replace" type="button" data-action="replace" data-id="${escapeHtml(printer.id)}" title="Ghi nhận đã thay hộp mực">✓ Thay</button>
      <button class="action-btn" type="button" data-action="history" data-id="${escapeHtml(printer.id)}">Lịch sử</button>
      <button class="action-btn" type="button" data-action="edit" data-id="${escapeHtml(printer.id)}" aria-label="Sửa ${escapeHtml(printer.model)}">Sửa</button>
      <button class="action-btn danger" type="button" data-action="delete" data-id="${escapeHtml(printer.id)}" aria-label="Xóa ${escapeHtml(printer.model)}">×</button>
    </div>`;
  }

  function renderRows(rows) {
    els.tbody.innerHTML = rows.map((printer, index) => {
      const status = statusOf(printer);
      const latest = latestHistory(printer);
      const countClass = status.key === 'danger' ? 'is-danger' : status.key === 'warn' ? 'is-warn' : '';
      return `<tr>
        <td class="row-index">${index + 1}</td>
        <td><div class="main-cell"><span class="primary-line">${escapeHtml(printer.room || 'Chưa phân loại')}</span><span class="secondary-line">${escapeHtml(printer.note || 'Không có ghi chú')}</span></div></td>
        <td>${printer.assetCode ? `<span class="mono">${escapeHtml(printer.assetCode)}</span>` : '<span class="muted">—</span>'}</td>
        <td><div class="main-cell"><span class="primary-line">${escapeHtml(printer.model || 'Chưa cập nhật')}</span></div></td>
        <td><span class="mono">${escapeHtml(printer.cartridge || '—')}</span></td>
        <td class="center"><span class="count-bubble ${countClass}">${printer.refillCnt}</span></td>
        <td class="date-cell">${printer.lastReplace ? formatDate(printer.lastReplace) : '<span class="muted">Chưa có</span>'}</td>
        <td class="date-cell">${latest ? `<div class="main-cell"><span class="primary-line">${latest.action === 'replace' ? 'Thay hộp mực' : latest.action === 'refill' ? 'Đổ mực' : 'Cập nhật'}</span><span class="secondary-line">${formatDateTime(latest.ts)}</span></div>` : '<span class="muted">Chưa phát sinh</span>'}</td>
        <td>${statusBadge(status)}</td>
        <td>${actionButtons(printer)}</td>
      </tr>`;
    }).join('');

    els.mobileList.innerHTML = rows.map((printer) => {
      const status = statusOf(printer);
      const latest = latestHistory(printer);
      const lastText = latest ? `${latest.action === 'replace' ? 'Thay hộp mực' : latest.action === 'refill' ? 'Đổ mực' : 'Cập nhật'} · ${formatDateTime(latest.ts)}` : 'Chưa phát sinh';
      return `<article class="mobile-card">
        <div class="mobile-card-top">
          <div><h3>${escapeHtml(printer.model || 'Chưa cập nhật')}</h3><p class="room-line">${escapeHtml(printer.room || 'Chưa phân loại')}${printer.assetCode ? ` · ${escapeHtml(printer.assetCode)}` : ''}</p></div>
          ${statusBadge(status)}
        </div>
        <div class="mobile-meta">
          <div class="mobile-meta-item"><span class="mobile-meta-label">Mã hộp mực</span><span class="mobile-meta-value mono">${escapeHtml(printer.cartridge || '—')}</span></div>
          <div class="mobile-meta-item"><span class="mobile-meta-label">Số lần đổ</span><span class="mobile-meta-value">${printer.refillCnt} lần</span></div>
          <div class="mobile-meta-item"><span class="mobile-meta-label">Lần thay gần nhất</span><span class="mobile-meta-value">${printer.lastReplace ? formatDate(printer.lastReplace) : 'Chưa có'}</span></div>
          <div class="mobile-meta-item"><span class="mobile-meta-label">Cập nhật gần nhất</span><span class="mobile-meta-value">${escapeHtml(lastText)}</span></div>
        </div>
        ${actionButtons(printer)}
      </article>`;
    }).join('');
  }

  function renderSummary() {
    const counts = state.rows.reduce((acc, printer) => {
      acc.all += 1;
      acc[statusOf(printer).key] += 1;
      return acc;
    }, { all: 0, ok: 0, warn: 0, danger: 0 });
    els.countAll.textContent = counts.all;
    els.countOk.textContent = counts.ok;
    els.countWarn.textContent = counts.warn;
    els.countDanger.textContent = counts.danger;
    els.thresholdHint.textContent = `Từ ${state.settings.threshold} lần đổ`;
  }

  function render() {
    renderRoomOptions();
    renderYearOptions();
    const rows = getFilteredRows();
    renderSummary();
    renderRows(rows);
    els.resultInfo.textContent = state.rows.length ? `Hiển thị ${rows.length}/${state.rows.length} máy` : 'Chưa có dữ liệu';
    els.emptyState.hidden = rows.length > 0;
    $$('.summary-card').forEach((card) => {
      const active = card.dataset.statusCard === els.statusFilter.value;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-pressed', String(active));
    });
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  function toast(message, type = 'success', actionLabel = '', action = null) {
    const item = document.createElement('div');
    item.className = `toast ${type === 'error' ? 'is-error' : ''}`;
    const icon = type === 'error' ? '!' : '✓';
    item.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(message)}</span>${actionLabel ? `<button type="button">${escapeHtml(actionLabel)}</button>` : ''}`;
    if (actionLabel && action) $('button', item).addEventListener('click', () => { action(); item.remove(); });
    els.toastRegion.appendChild(item);
    window.setTimeout(() => item.remove(), actionLabel ? 8500 : 4200);
  }

  function confirmAction({ title, message, acceptLabel = 'Xác nhận', danger = true, icon = '?' }) {
    return new Promise((resolve) => {
      pendingConfirm = resolve;
      els.confirmTitle.textContent = title;
      els.confirmMessage.textContent = message;
      els.confirmIcon.textContent = icon;
      els.confirmIcon.style.color = danger ? 'var(--danger)' : 'var(--primary)';
      els.confirmIcon.style.background = danger ? 'var(--danger-soft)' : 'var(--primary-soft)';
      els.confirmAccept.textContent = acceptLabel;
      els.confirmAccept.className = `button ${danger ? 'button-danger' : 'button-primary'}`;
      openDialog(els.confirmDialog);
    });
  }

  function finishConfirm(value) {
    closeDialog(els.confirmDialog);
    const resolve = pendingConfirm;
    pendingConfirm = null;
    if (resolve) resolve(value);
  }

  function findPrinter(id) {
    return state.rows.find((printer) => printer.id === id);
  }

  function updatePrinter(id, updater) {
    state.rows = state.rows.map((printer) => printer.id === id ? normalizePrinter(updater({ ...printer })) : printer);
    saveStore();
    render();
  }

  function snapshotState() {
    return JSON.stringify(state.rows);
  }

  function restoreSnapshot(snapshot) {
    try {
      const rows = JSON.parse(snapshot);
      state.rows = Array.isArray(rows) ? rows.map(normalizePrinter) : state.rows;
      saveStore();
      render();
      toast('Đã hoàn tác thao tác gần nhất.');
    } catch (error) {
      toast('Không thể hoàn tác thao tác.', 'error');
    }
  }

  function setUndo(snapshot, message) {
    lastUndo = snapshot;
    toast(message, 'success', 'Hoàn tác', () => {
      if (lastUndo === snapshot) restoreSnapshot(snapshot);
      lastUndo = null;
    });
  }

  function recordRefill(id) {
    const printer = findPrinter(id);
    if (!printer) return;
    const before = snapshotState();
    const nextCount = printer.refillCnt + 1;
    const history = [...printer.history, { id: safeUUID(), ts: nowLocalISO(), action: 'refill', note: `Đổ mực lần ${nextCount} kể từ lần thay hộp mực gần nhất.` }];
    updatePrinter(id, (current) => ({ ...current, refillCnt: nextCount, history, updatedAt: nowLocalISO() }));
    const status = statusOf(findPrinter(id));
    setUndo(before, status.key === 'danger' ? `Đã ghi nhận đổ mực lần ${nextCount}. Máy đã đến hạn thay hộp mực.` : `Đã ghi nhận đổ mực lần ${nextCount}.`);
  }

  async function recordReplace(id) {
    const printer = findPrinter(id);
    if (!printer) return;
    const accepted = await confirmAction({ title: 'Xác nhận thay hộp mực', message: `Ghi nhận đã thay hộp mực cho máy “${printer.model || 'chưa cập nhật'}”? Số lần đổ sẽ được đặt lại về 0.`, acceptLabel: 'Xác nhận thay', danger: false, icon: '✓' });
    if (!accepted) return;
    const before = snapshotState();
    const previous = printer.lastReplace ? ` Lần thay trước: ${formatDate(printer.lastReplace)}.` : '';
    const history = [...printer.history, { id: safeUUID(), ts: nowLocalISO(), action: 'replace', note: `Thay hộp mực mới.${previous}` }];
    updatePrinter(id, (current) => ({ ...current, refillCnt: 0, lastReplace: todayISO(), history, updatedAt: nowLocalISO() }));
    setUndo(before, 'Đã ghi nhận thay hộp mực và đặt lại số lần đổ về 0.');
  }

  function openEdit(id = null) {
    editingId = id;
    renderRoomOptions();
    els.formError.hidden = true;
    els.formError.textContent = '';
    if (id) {
      const printer = findPrinter(id);
      if (!printer) return;
      els.editKicker.textContent = 'CẬP NHẬT THIẾT BỊ';
      els.editTitle.textContent = 'Sửa thông tin máy in';
      els.fRoom.value = printer.room;
      els.fAssetCode.value = printer.assetCode;
      els.fModel.value = printer.model;
      els.fCartridge.value = printer.cartridge;
      els.fRefillCnt.value = printer.refillCnt;
      els.fLastReplace.value = printer.lastReplace;
      els.fNote.value = printer.note;
    } else {
      els.editKicker.textContent = 'THIẾT BỊ MỚI';
      els.editTitle.textContent = 'Thêm máy in';
      els.printerForm.reset();
      els.fRefillCnt.value = 0;
    }
    openDialog(els.editDialog);
    window.setTimeout(() => els.fRoom.focus(), 40);
  }

  function saveForm(event) {
    event.preventDefault();
    const data = {
      room: cleanText(els.fRoom.value, 120),
      assetCode: cleanText(els.fAssetCode.value, 80),
      model: cleanText(els.fModel.value, 160),
      cartridge: cleanText(els.fCartridge.value, 100),
      refillCnt: coerceNumber(els.fRefillCnt.value, 0),
      lastReplace: normalizeDate(els.fLastReplace.value),
      note: cleanText(els.fNote.value, 500),
    };
    if (!data.room || !data.model) {
      els.formError.textContent = 'Vui lòng chọn Phòng/Bộ phận và nhập Tên máy/Model.';
      els.formError.hidden = false;
      return;
    }
    const before = snapshotState();
    if (editingId) {
      updatePrinter(editingId, (current) => ({ ...current, ...data, updatedAt: nowLocalISO() }));
      closeDialog(els.editDialog);
      setUndo(before, 'Đã cập nhật thông tin máy in.');
    } else {
      const newRow = normalizePrinter({ id: safeUUID(), ...data, history: [], createdAt: nowLocalISO(), updatedAt: nowLocalISO() });
      state.rows = [newRow, ...state.rows];
      saveStore();
      render();
      closeDialog(els.editDialog);
      setUndo(before, 'Đã thêm máy in mới.');
    }
  }

  function openHistory(id) {
    const printer = findPrinter(id);
    if (!printer) return;
    const history = [...normalizeHistory(printer.history)].sort((a, b) => dateValue(b.ts) - dateValue(a.ts));
    els.historyTitle.textContent = 'Lịch sử thao tác';
    els.historySubtitle.textContent = `${printer.room || 'Chưa phân loại'} · ${printer.model || 'Chưa cập nhật'}${printer.assetCode ? ` · ${printer.assetCode}` : ''}`;
    const status = statusOf(printer);
    els.historySummary.innerHTML = `<span class="pill">Mã mực: ${escapeHtml(printer.cartridge || '—')}</span><span class="pill">Đổ mực hiện tại: ${printer.refillCnt} lần</span><span class="pill">${escapeHtml(status.label)}</span><span class="pill">Thay gần nhất: ${printer.lastReplace ? formatDate(printer.lastReplace) : 'Chưa có'}</span>`;
    els.historyEmpty.hidden = history.length > 0;
    els.historyList.innerHTML = history.map((entry) => {
      const symbol = entry.action === 'replace' ? '✓' : entry.action === 'refill' ? '+' : 'i';
      const label = entry.action === 'replace' ? 'Thay hộp mực' : entry.action === 'refill' ? 'Đổ mực' : 'Cập nhật thông tin';
      return `<article class="history-item"><span class="history-symbol ${entry.action}">${symbol}</span><div><h3>${label}</h3><p>${escapeHtml(entry.note || 'Không có ghi chú')}</p></div><time class="history-time">${formatDateTime(entry.ts)}</time></article>`;
    }).join('');
    openDialog(els.historyDialog);
  }

  async function removePrinter(id) {
    const printer = findPrinter(id);
    if (!printer) return;
    const accepted = await confirmAction({ title: 'Xóa máy in', message: `Bạn có chắc muốn xóa “${printer.model || 'máy in này'}” và toàn bộ lịch sử thao tác? Dữ liệu chỉ có thể khôi phục bằng nút Hoàn tác ngay sau đó hoặc từ bản sao lưu.`, acceptLabel: 'Xóa máy in', danger: true, icon: '!' });
    if (!accepted) return;
    const before = snapshotState();
    state.rows = state.rows.filter((item) => item.id !== id);
    saveStore();
    render();
    setUndo(before, 'Đã xóa máy in và lịch sử liên quan.');
  }

  function csvCell(value) {
    const text = String(value ?? '');
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadCsvTemplate() {
    const headers = ['Phòng/Bộ phận', 'Mã quản lý', 'Tên máy/Model', 'Mã hộp mực', 'Lần đổ mực', 'Ngày thay gần nhất', 'Ghi chú'];
    const rows = [headers, ['Phòng Kế hoạch', 'MIP-KH-01', 'HP LaserJet Pro M404dn', 'CF258A', 0, '2026-06-26', 'Dữ liệu mẫu - có thể xóa dòng này']];
    const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8' }), 'mau_nhap_quan_ly_muc_may_in.csv');
    toast('Đã tải mẫu nhập CSV.');
  }

  function csvHeadersMap(headers) {
    const normalized = headers.map((header) => cleanText(header).toLocaleLowerCase('vi-VN'));
    const find = (...names) => normalized.findIndex((header) => names.includes(header));
    return {
      room: find('phòng/bộ phận', 'phòng / bộ phận', 'phòng', 'room'),
      assetCode: find('mã quản lý', 'mã máy', 'mã tài sản', 'assetcode', 'printercode'),
      model: find('tên máy/model', 'tên máy / model', 'model', 'tên máy'),
      cartridge: find('mã hộp mực', 'cartridge', 'mã mực'),
      refillCnt: find('lần đổ mực', 'số lần đổ', 'refillcnt'),
      lastReplace: find('ngày thay gần nhất', 'lần thay gần nhất', 'ngày thay', 'lastreplace'),
      note: find('ghi chú', 'note'),
    };
  }

  function parseCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const matrix = [];
    let row = [], cell = '', inQuotes = false;
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      const next = source[i + 1];
      if (inQuotes) {
        if (char === '"' && next === '"') { cell += '"'; i += 1; }
        else if (char === '"') inQuotes = false;
        else cell += char;
      } else if (char === '"') inQuotes = true;
      else if (char === ',') { row.push(cell); cell = ''; }
      else if (char === '\n') { row.push(cell.replace(/\r$/, '')); matrix.push(row); row = []; cell = ''; }
      else cell += char;
    }
    if (cell || row.length) { row.push(cell.replace(/\r$/, '')); matrix.push(row); }
    const nonEmpty = matrix.filter((r) => r.some((v) => cleanText(v)));
    if (nonEmpty.length < 2) return [];
    const map = csvHeadersMap(nonEmpty[0]);
    if (map.room === -1 || map.model === -1 || map.cartridge === -1) return [];
    const pick = (rowData, index) => index >= 0 ? rowData[index] || '' : '';
    return nonEmpty.slice(1).map((rowData) => normalizePrinter({
      room: pick(rowData, map.room),
      assetCode: pick(rowData, map.assetCode),
      model: pick(rowData, map.model),
      cartridge: pick(rowData, map.cartridge),
      refillCnt: pick(rowData, map.refillCnt),
      lastReplace: pick(rowData, map.lastReplace),
      note: pick(rowData, map.note),
      history: [],
      createdAt: nowLocalISO(),
      updatedAt: nowLocalISO(),
    })).filter((rowData) => rowData.room && rowData.model && rowData.cartridge);
  }

  function printerKey(printer) {
    if (printer.assetCode) return `asset:${printer.assetCode.toLocaleLowerCase('vi-VN')}`;
    return `fallback:${[printer.room, printer.model, printer.cartridge].map((v) => cleanText(v).toLocaleLowerCase('vi-VN')).join('|')}`;
  }

  function applyImport(mode) {
    if (!pendingImportRows.length) return;
    const before = snapshotState();
    if (mode === 'merge') {
      const byKey = new Map(state.rows.map((printer) => [printerKey(printer), printer]));
      pendingImportRows.forEach((incoming) => {
        const key = printerKey(incoming);
        const existing = byKey.get(key);
        if (existing) {
          const updated = normalizePrinter({ ...existing, ...incoming, id: existing.id, history: existing.history, createdAt: existing.createdAt, updatedAt: nowLocalISO() });
          byKey.set(key, updated);
        } else {
          byKey.set(key, incoming);
        }
      });
      state.rows = [...byKey.values()];
    } else {
      state.rows = [...pendingImportRows, ...state.rows];
    }
    pendingImportRows = [];
    saveStore();
    render();
    closeDialog(els.importDialog);
    setUndo(before, mode === 'merge' ? 'Đã cập nhật dữ liệu từ tệp CSV.' : 'Đã bổ sung dữ liệu từ tệp CSV.');
  }

  async function handleImportFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      toast('Vui lòng chọn tệp định dạng CSV.', 'error');
      return;
    }
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) {
        toast('Tệp CSV chưa đúng mẫu hoặc không có dữ liệu hợp lệ.', 'error');
        return;
      }
      pendingImportRows = rows;
      els.importDescription.textContent = `Đã đọc ${rows.length} dòng dữ liệu hợp lệ từ tệp “${file.name}”. Chọn cách nhập phù hợp trước khi tiếp tục.`;
      openDialog(els.importDialog);
    } catch (error) {
      console.error(error);
      toast('Không thể đọc tệp CSV.', 'error');
    }
  }

  function backupData() {
    const content = JSON.stringify({ version: 2, exportedAt: nowLocalISO(), rows: state.rows, settings: state.settings }, null, 2);
    downloadBlob(new Blob([content], { type: 'application/json;charset=utf-8' }), `sao_luu_quan_ly_muc_may_in_${fileTime()}.json`);
    toast('Đã tạo bản sao lưu dữ liệu.');
  }

  async function restoreBackup(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
      if (!Array.isArray(rows)) throw new Error('Không đúng cấu trúc dữ liệu');
      const accepted = await confirmAction({ title: 'Khôi phục dữ liệu', message: `Bản sao lưu có ${rows.length} máy in. Thao tác này sẽ thay thế toàn bộ dữ liệu hiện tại trên trình duyệt này.`, acceptLabel: 'Khôi phục', danger: true, icon: '↺' });
      if (!accepted) return;
      const before = snapshotState();
      state.rows = rows.map(normalizePrinter);
      state.settings = normalizeSettings(parsed?.settings ?? state.settings);
      saveStore();
      setTheme(state.settings.theme);
      render();
      setUndo(before, 'Đã khôi phục dữ liệu từ bản sao lưu.');
    } catch (error) {
      console.error(error);
      toast('Tệp sao lưu không hợp lệ hoặc không thể đọc.', 'error');
    }
  }

  function fileTime() {
    return nowLocalISO().replace(/[-:T]/g, '').slice(0, 12);
  }

  function getFilterLabel() {
    const f = getFilters();
    const parts = [];
    if (f.status !== 'all') parts.push(`Trạng thái: ${statusLabel(f.status)}`);
    if (f.room !== 'all') parts.push(`Phòng/Bộ phận: ${f.room}`);
    if (f.month !== 'all') parts.push(`Tháng: ${f.month}`);
    if (f.year !== 'all') parts.push(`Năm: ${f.year}`);
    if (f.query) parts.push(`Từ khóa: ${f.query}`);
    return parts.length ? parts.join(' | ') : 'Không áp dụng bộ lọc';
  }

  function statusLabel(key) {
    return key === 'ok' ? 'Đang bình thường' : key === 'warn' ? 'Cần lưu ý' : key === 'danger' ? 'Đến hạn thay' : 'Tất cả';
  }

  function filteredHistory(rows) {
    const f = getFilters();
    return rows.flatMap((printer) => normalizeHistory(printer.history).map((entry) => ({ printer, entry })))
      .filter(({ entry }) => {
        if (f.month === 'all' && f.year === 'all') return true;
        const d = parseDateTime(entry.ts);
        if (!d) return false;
        return (f.month === 'all' || d.getMonth() + 1 === Number(f.month)) && (f.year === 'all' || d.getFullYear() === Number(f.year));
      })
      .sort((a, b) => dateValue(b.entry.ts) - dateValue(a.entry.ts));
  }

  // ------------------ XLSX export (pure browser JavaScript, no CDN dependency) ------------------
  // Generates an Office Open XML workbook using stored ZIP entries, keeping the site fully self-contained.
  function xmlEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
  }

  function excelSafe(value) {
    const text = String(value ?? '');
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  }

  function colName(index) {
    let n = index + 1;
    let out = '';
    while (n > 0) {
      const mod = (n - 1) % 26;
      out = String.fromCharCode(65 + mod) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function isNumeric(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function cellXml(value, rowIndex, colIndex, style = 5) {
    const ref = `${colName(colIndex)}${rowIndex}`;
    const cell = value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'value') ? value : { value, style };
    const actualStyle = cell.style ?? style;
    const actualValue = cell.value ?? '';
    if (actualValue === null || actualValue === undefined || actualValue === '') return `<c r="${ref}" s="${actualStyle}"/>`;
    if (isNumeric(actualValue)) return `<c r="${ref}" s="${actualStyle}" t="n"><v>${actualValue}</v></c>`;
    return `<c r="${ref}" s="${actualStyle}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(excelSafe(actualValue))}</t></is></c>`;
  }

  function worksheetXml(sheet) {
    const rows = sheet.rows || [];
    const maxCols = Math.max(1, ...rows.map((row) => row.cells.length));
    const lastRow = Math.max(1, rows.length);
    const dimension = `A1:${colName(maxCols - 1)}${lastRow}`;
    const sheetViews = `<sheetViews><sheetView workbookViewId="0">${sheet.freezeRows ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>` : ''}</sheetView></sheetViews>`;
    const cols = (sheet.widths || []).map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
    const colsXml = cols ? `<cols>${cols}</cols>` : '';
    const rowsXml = rows.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const height = row.height ? ` ht="${row.height}" customHeight="1"` : '';
      const cells = row.cells.map((cell, colIndex) => cellXml(cell, rowNumber, colIndex)).join('');
      return `<row r="${rowNumber}"${height}>${cells}</row>`;
    }).join('');
    const merges = (sheet.merges || []).map((ref) => `<mergeCell ref="${ref}"/>`).join('');
    const mergeXml = merges ? `<mergeCells count="${sheet.merges.length}">${merges}</mergeCells>` : '';
    const autoFilter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="${dimension}"/>
  ${sheetViews}
  <sheetFormatPr defaultRowHeight="18"/>
  ${colsXml}
  <sheetData>${rowsXml}</sheetData>
  ${mergeXml}
  ${autoFilter}
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="${sheet.landscape ? 'landscape' : 'portrait'}" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  }

  function xlsxStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="0"/>
  <fonts count="5">
    <font><sz val="10"/><color rgb="FF243447"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/><family val="2"/></font>
    <font><i/><sz val="10"/><color rgb="FF5E6E82"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF243447"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="11">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F4C5C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE6F7ED"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF3DD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF0ED"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDFF5F1"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF2F5F8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD8E2EA"/></left><right style="thin"><color rgb="FFD8E2EA"/></right><top style="thin"><color rgb="FFD8E2EA"/></top><bottom style="thin"><color rgb="FFD8E2EA"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="15">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="7" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function crc32(bytes) {
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }

  function u16(n) { return [n & 255, (n >>> 8) & 255]; }
  function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => { out.set(part, offset); offset += part.length; });
    return out;
  }

  function makeZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
      const crc = crc32(dataBytes);
      const localHeader = new Uint8Array([
        ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(dataBytes.length), ...u32(dataBytes.length), ...u16(nameBytes.length), ...u16(0),
      ]);
      localParts.push(localHeader, nameBytes, dataBytes);
      const centralHeader = new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(dataBytes.length), ...u32(dataBytes.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]);
      centralParts.push(centralHeader, nameBytes);
      offset += localHeader.length + nameBytes.length + dataBytes.length;
    });
    const centralDirectory = concatBytes(centralParts);
    const end = new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralDirectory.length), ...u32(offset), ...u16(0),
    ]);
    return concatBytes([...localParts, centralDirectory, end]);
  }

  function workbookXml(sheets) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="0"/>
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
</workbook>`;
  }

  function workbookRelsXml(sheets) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  }

  function contentTypesXml(sheets) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheets.map((sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`;
  }

  function rootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  }

  function corePropsXml() {
    const iso = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Quản lý mực máy in</dc:creator><cp:lastModifiedBy>Quản lý mực máy in</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>
</cp:coreProperties>`;
  }

  function appPropsXml(sheetCount) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Quản lý mực máy in</Application><Worksheets>${sheetCount}</Worksheets></Properties>`;
  }

  function buildXlsxBlob(sheets) {
    const files = [
      { name: '[Content_Types].xml', content: contentTypesXml(sheets) },
      { name: '_rels/.rels', content: rootRelsXml() },
      { name: 'docProps/core.xml', content: corePropsXml() },
      { name: 'docProps/app.xml', content: appPropsXml(sheets.length) },
      { name: 'xl/workbook.xml', content: workbookXml(sheets) },
      { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml(sheets) },
      { name: 'xl/styles.xml', content: xlsxStylesXml() },
      ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: worksheetXml(sheet) })),
    ];
    return new Blob([makeZip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function exportExcel() {
    const rows = getFilteredRows();
    const history = filteredHistory(rows);
    const allCounts = state.rows.reduce((acc, printer) => { acc.all += 1; acc[statusOf(printer).key] += 1; return acc; }, { all: 0, ok: 0, warn: 0, danger: 0 });
    const exportedAt = formatDateTime(nowLocalISO());
    const filterText = getFilterLabel();

    const overviewRows = [
      { height: 30, cells: [{ value: 'BÁO CÁO QUẢN LÝ THAY/ĐỔ MỰC MÁY IN', style: 1 }] },
      { height: 19, cells: [{ value: `Thời điểm xuất: ${exportedAt}`, style: 2 }] },
      { cells: [] },
      { height: 22, cells: [{ value: 'TỔNG QUAN', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }] },
      { height: 24, cells: [{ value: 'Chỉ tiêu', style: 4 }, { value: 'Số lượng', style: 11 }, { value: 'Chỉ tiêu', style: 4 }, { value: 'Số lượng', style: 11 }, { value: 'Chỉ tiêu', style: 4 }, { value: 'Số lượng', style: 11 }] },
      { cells: [{ value: 'Tổng số máy', style: 5 }, { value: allCounts.all, style: 13 }, { value: 'Đang bình thường', style: 5 }, { value: allCounts.ok, style: 6 }, { value: 'Cần lưu ý', style: 5 }, { value: allCounts.warn, style: 7 }] },
      { cells: [{ value: `Đến hạn thay (từ ${state.settings.threshold} lần đổ)`, style: 5 }, { value: allCounts.danger, style: 8 }, { value: 'Máy theo bộ lọc hiện tại', style: 5 }, { value: rows.length, style: 13 }, { value: 'Dòng lịch sử xuất', style: 5 }, { value: history.length, style: 13 }] },
      { cells: [] },
      { height: 22, cells: [{ value: 'PHẠM VI BÁO CÁO', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }] },
      { height: 34, cells: [{ value: filterText, style: 12 }] },
      { cells: [] },
      { height: 22, cells: [{ value: 'GHI CHÚ', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }, { value: '', style: 3 }] },
      { height: 32, cells: [{ value: 'Báo cáo được tạo từ dữ liệu đang lưu trên trình duyệt. Trạng thái “Đến hạn thay” được xác định theo ngưỡng số lần đổ mực đã thiết lập trong hệ thống.', style: 12 }] },
    ];
    const overview = { name: 'Tổng quan', widths: [31, 14, 28, 14, 28, 14], rows: overviewRows, merges: ['A1:F1', 'A2:F2', 'A4:F4', 'A9:F9', 'A10:F10', 'A12:F12', 'A13:F13'], landscape: false };

    const listHeaders = ['#', 'Phòng / bộ phận', 'Mã quản lý', 'Tên máy / Model', 'Mã hộp mực', 'Số lần đổ', 'Lần thay gần nhất', 'Cập nhật gần nhất', 'Trạng thái', 'Ghi chú'];
    const listRows = [
      { height: 30, cells: [{ value: 'DANH SÁCH MÁY IN VÀ TÌNH TRẠNG HỘP MỰC', style: 1 }] },
      { cells: [{ value: `Thời điểm xuất: ${exportedAt}`, style: 2 }] },
      { cells: [{ value: `Bộ lọc: ${filterText}`, style: 2 }] },
      { cells: [] },
      { height: 31, cells: listHeaders.map((header) => ({ value: header, style: 3 })) },
      ...rows.map((printer, index) => {
        const status = statusOf(printer);
        const latest = latestHistory(printer);
        const statusStyle = status.key === 'ok' ? 6 : status.key === 'warn' ? 7 : 8;
        return { height: 29, cells: [
          { value: index + 1, style: 14 },
          { value: printer.room || 'Chưa phân loại', style: 5 },
          { value: printer.assetCode || '—', style: 5 },
          { value: printer.model || 'Chưa cập nhật', style: 5 },
          { value: printer.cartridge || '—', style: 5 },
          { value: printer.refillCnt, style: 13 },
          { value: printer.lastReplace ? formatDate(printer.lastReplace) : 'Chưa có', style: 14 },
          { value: latest ? `${latest.action === 'replace' ? 'Thay hộp mực' : latest.action === 'refill' ? 'Đổ mực' : 'Cập nhật'} - ${formatDateTime(latest.ts)}` : 'Chưa phát sinh', style: 5 },
          { value: status.label, style: statusStyle },
          { value: printer.note || '', style: 5 },
        ] };
      }),
    ];
    const lastListRow = Math.max(5, listRows.length);
    const list = { name: 'Danh sách máy in', widths: [6, 25, 16, 31, 18, 12, 18, 27, 18, 35], rows: listRows, merges: ['A1:J1', 'A2:J2', 'A3:J3'], freezeRows: 5, autoFilter: `A5:J${lastListRow}`, landscape: true };

    const historyHeaders = ['#', 'Thời điểm', 'Phòng / bộ phận', 'Mã quản lý', 'Tên máy / Model', 'Mã hộp mực', 'Hành động', 'Ghi chú'];
    const historyRows = [
      { height: 30, cells: [{ value: 'LỊCH SỬ ĐỔ MỰC / THAY HỘP MỰC', style: 1 }] },
      { cells: [{ value: `Thời điểm xuất: ${exportedAt}`, style: 2 }] },
      { cells: [{ value: `Bộ lọc: ${filterText}`, style: 2 }] },
      { cells: [] },
      { height: 31, cells: historyHeaders.map((header) => ({ value: header, style: 3 })) },
      ...history.map(({ printer, entry }, index) => ({ height: 29, cells: [
        { value: index + 1, style: 14 },
        { value: formatDateTime(entry.ts), style: 14 },
        { value: printer.room || 'Chưa phân loại', style: 5 },
        { value: printer.assetCode || '—', style: 5 },
        { value: printer.model || 'Chưa cập nhật', style: 5 },
        { value: printer.cartridge || '—', style: 5 },
        { value: entry.action === 'replace' ? 'Thay hộp mực' : entry.action === 'refill' ? 'Đổ mực' : 'Cập nhật', style: entry.action === 'replace' ? 6 : entry.action === 'refill' ? 7 : 11 },
        { value: entry.note || '', style: 5 },
      ] })),
    ];
    const lastHistoryRow = Math.max(5, historyRows.length);
    const historySheet = { name: 'Lịch sử', widths: [6, 20, 25, 16, 30, 18, 19, 46], rows: historyRows, merges: ['A1:H1', 'A2:H2', 'A3:H3'], freezeRows: 5, autoFilter: `A5:H${lastHistoryRow}`, landscape: true };

    const guide = {
      name: 'Hướng dẫn', widths: [28, 82], landscape: false,
      rows: [
        { height: 30, cells: [{ value: 'HƯỚNG DẪN SỬ DỤNG BÁO CÁO', style: 1 }] },
        { cells: [] },
        { height: 23, cells: [{ value: 'Nội dung', style: 3 }, { value: 'Hướng dẫn', style: 3 }] },
        { height: 34, cells: [{ value: 'Tổng quan', style: 4 }, { value: 'Tóm tắt số máy theo tình trạng và phạm vi dữ liệu đã chọn khi xuất báo cáo.', style: 5 }] },
        { height: 34, cells: [{ value: 'Danh sách máy in', style: 4 }, { value: 'Danh sách thiết bị theo bộ lọc hiện tại. Có thể dùng bộ lọc ngay trong Excel ở hàng tiêu đề.', style: 5 }] },
        { height: 34, cells: [{ value: 'Lịch sử', style: 4 }, { value: 'Nhật ký các lần đổ mực và thay hộp mực thuộc những thiết bị đã được xuất.', style: 5 }] },
        { height: 34, cells: [{ value: 'Quy tắc trạng thái', style: 4 }, { value: `Đang bình thường: dưới ${Math.max(0, state.settings.threshold - 1)} lần đổ; Cần lưu ý: ${Math.max(0, state.settings.threshold - 1)} lần đổ; Đến hạn thay: từ ${state.settings.threshold} lần đổ.`, style: 5 }] },
        { height: 34, cells: [{ value: 'An toàn dữ liệu', style: 4 }, { value: 'Dữ liệu được lưu cục bộ trên trình duyệt. Nên sử dụng chức năng Sao lưu dữ liệu (.json) định kỳ trước khi xóa lịch sử trình duyệt hoặc đổi thiết bị.', style: 5 }] },
      ],
      merges: ['A1:B1'], freezeRows: 3, autoFilter: 'A3:B8',
    };

    const blob = buildXlsxBlob([overview, list, historySheet, guide]);
    downloadBlob(blob, `bao_cao_quan_ly_muc_may_in_${fileTime()}.xlsx`);
    toast(`Đã xuất báo cáo Excel gồm ${rows.length} máy in và ${history.length} dòng lịch sử.`);
  }

  function applyDefaultFilters() {
    els.search.value = '';
    els.statusFilter.value = 'all';
    els.roomFilter.value = 'all';
    els.monthFilter.value = 'all';
    els.yearFilter.value = 'all';
    els.sortBy.value = 'priority';
  }

  function clearFilters() {
    applyDefaultFilters();
    render();
  }

  function handleRowAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'refill') recordRefill(id);
    if (action === 'replace') recordReplace(id);
    if (action === 'history') openHistory(id);
    if (action === 'edit') openEdit(id);
    if (action === 'delete') removePrinter(id);
  }

  function openSettings() {
    els.fThreshold.value = state.settings.threshold;
    openDialog(els.settingsDialog);
  }

  function resetData() {
    confirmAction({ title: 'Xóa toàn bộ dữ liệu', message: 'Toàn bộ danh sách máy in và lịch sử thao tác sẽ bị xóa khỏi trình duyệt này. Hãy sao lưu dữ liệu trước khi tiếp tục.', acceptLabel: 'Xóa toàn bộ', danger: true, icon: '!' }).then((accepted) => {
      if (!accepted) return;
      const before = snapshotState();
      state.rows = [];
      saveStore();
      render();
      setUndo(before, 'Đã xóa toàn bộ dữ liệu.');
    });
  }

  function setupEvents() {
    els.addPrinter.addEventListener('click', () => openEdit());
    els.emptyAddBtn.addEventListener('click', () => openEdit());
    els.printerForm.addEventListener('submit', saveForm);
    els.tbody.addEventListener('click', handleRowAction);
    els.mobileList.addEventListener('click', handleRowAction);

    [els.statusFilter, els.roomFilter, els.monthFilter, els.yearFilter, els.sortBy].forEach((control) => control.addEventListener('change', render));
    let typingTimer;
    els.search.addEventListener('input', () => { clearTimeout(typingTimer); typingTimer = setTimeout(render, 100); });
    els.clearFilters.addEventListener('click', clearFilters);
    $$('.summary-card').forEach((card) => card.addEventListener('click', () => { els.statusFilter.value = card.dataset.statusCard; render(); }));

    els.themeToggle.addEventListener('click', () => setTheme(state.settings.theme === 'dark' ? 'light' : 'dark'));
    els.importBtn.addEventListener('click', () => els.importInput.click());
    els.importInput.addEventListener('change', (event) => { handleImportFile(event.target.files?.[0]); event.target.value = ''; });
    els.confirmImport.addEventListener('click', () => applyImport($('input[name="importMode"]:checked', els.importDialog)?.value || 'append'));
    els.exportExcelBtn.addEventListener('click', exportExcel);

    els.moreBtn.addEventListener('click', () => {
      const open = els.moreMenu.hidden;
      els.moreMenu.hidden = !open;
      els.moreBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.menu-wrap')) { els.moreMenu.hidden = true; els.moreBtn.setAttribute('aria-expanded', 'false'); }
    });
    els.moreMenu.addEventListener('click', (event) => {
      const target = event.target.closest('[data-menu-action]');
      if (!target) return;
      els.moreMenu.hidden = true;
      els.moreBtn.setAttribute('aria-expanded', 'false');
      const action = target.dataset.menuAction;
      if (action === 'download-template') downloadCsvTemplate();
      if (action === 'backup') backupData();
      if (action === 'settings') openSettings();
      if (action === 'reset') resetData();
    });
    els.restoreInput.addEventListener('change', (event) => { restoreBackup(event.target.files?.[0]); event.target.value = ''; });

    els.settingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const next = Math.min(10, Math.max(1, coerceNumber(els.fThreshold.value, state.settings.threshold)));
      state.settings.threshold = next;
      saveStore();
      render();
      closeDialog(els.settingsDialog);
      toast(`Đã cập nhật ngưỡng thay hộp mực: từ ${next} lần đổ.`);
    });

    $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog($(`#${button.dataset.closeDialog}`))));
    els.confirmAccept.addEventListener('click', () => finishConfirm(true));
    els.confirmCancel.addEventListener('click', () => finishConfirm(false));
    els.confirmDialog.addEventListener('cancel', (event) => { event.preventDefault(); finishConfirm(false); });

    ['dragenter', 'dragover'].forEach((name) => els.dropZone.addEventListener(name, (event) => { event.preventDefault(); els.dropZone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((name) => els.dropZone.addEventListener(name, (event) => { event.preventDefault(); els.dropZone.classList.remove('dragover'); }));
    els.dropZone.addEventListener('drop', (event) => handleImportFile(event.dataTransfer?.files?.[0]));

    document.addEventListener('keydown', (event) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const typing = ['input', 'textarea', 'select'].includes(tag);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); els.search.focus(); }
      if (!typing && event.key.toLowerCase() === 'n') { event.preventDefault(); openEdit(); }
      if (event.key === 'Escape') { els.moreMenu.hidden = true; els.moreBtn.setAttribute('aria-expanded', 'false'); }
    });

    window.addEventListener('resize', setStickyHeaderOffset);
    if ('ResizeObserver' in window) new ResizeObserver(setStickyHeaderOffset).observe(els.topbar);
  }

  function init() {
    document.documentElement.dataset.theme = state.settings.theme;
    els.themeIcon.textContent = state.settings.theme === 'dark' ? '☀' : '☾';

    // Luôn mở trang ở chế độ "xem tất cả". Điều này ngăn bộ lọc cũ của
    // trình duyệt làm danh sách trống sau khi người dùng tải lại trang.
    applyDefaultFilters();
    setupEvents();
    render();

    // Đảm bảo giao diện được vẽ lại sau khi trình duyệt hoàn tất khôi phục
    // trạng thái biểu mẫu/bộ nhớ đệm khi tải lại trang.
    requestAnimationFrame(render);

    if (migratedFromLegacy) {
      saveStore();
      toast('Đã tự động khôi phục và chuyển dữ liệu từ phiên bản cũ sang phiên bản nâng cấp.');
    }
  }

  init();
})();
