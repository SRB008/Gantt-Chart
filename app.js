(() => {
  const WEEK_COL_WIDTH = 90;
  const MONTH_COL_WIDTH = 160;
  const QUARTER_COL_WIDTH = 220;
  const ROW_HEIGHT = 46;
  const LABEL_WIDTH = 240;
  const HEADER_HEIGHT = 40;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MIN_VISIBLE_WEEKS = 10;
  const PADDING_WEEKS_AFTER = 2;
  const DEFAULT_COLOR_1 = '#5b8cff';
  const DEFAULT_COLOR_2 = '#7c5cff';
  const PRESET_COLORS = [
    { name: 'Red', hex: '#FF4853' },
    { name: 'Orange', hex: '#FF8B3E' },
    { name: 'Yellow', hex: '#FFD505' },
    { name: 'Green', hex: '#4FCE65' },
    { name: 'Blue', hex: '#5B8CFF' },
    { name: 'Purple', hex: '#DC60C3' },
  ];
  const VIEW_MODES = ['week', 'month', 'quarter'];
  const DEFAULT_VIEW_MODE = 'week';
  const VIEW_STORAGE_KEY = 'roadmap-gantt-view-mode';
  const ZOOM_STORAGE_KEY = 'roadmap-gantt-zoom';
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.5;
  const ZOOM_STEP = 0.25;
  const DEFAULT_ZOOM = 1;
  const THEME_STORAGE_KEY = 'roadmap-gantt-theme';
  const DATES_STORAGE_KEY = 'roadmap-gantt-dates-visible';
  const TIMELINE_START_STORAGE_KEY = 'roadmap-gantt-timeline-start';
  const TITLE_STORAGE_KEY = 'roadmap-gantt-title';
  const CSV_HEADERS = ['id', 'name', 'startDate', 'durationWeeks', 'order', 'color'];
  const PRINT_PAGE_WIDTH_PX = 1050; // approx usable width for a landscape page at 96dpi
  const DB_NAME = 'roadmap-gantt';
  const DB_STORE = 'handles';
  const DB_KEY = 'roadmapFileHandle';

  const sprintHeaderEl = document.getElementById('sprint-header');
  const taskRowsEl = document.getElementById('task-rows');
  const addTaskBtn = document.getElementById('add-task-btn');
  const exportPngBtn = document.getElementById('export-png-btn');
  const exportPdfBtn = document.getElementById('export-pdf-btn');
  const autosortBtn = document.getElementById('autosort-btn');
  const openFileBtn = document.getElementById('open-file-btn');
  const newFileBtn = document.getElementById('new-file-btn');
  const saveStatusEl = document.getElementById('save-status');
  const fileStatusEl = document.getElementById('file-status');
  const unsupportedBanner = document.getElementById('unsupported-banner');
  const emptyState = document.getElementById('empty-state');
  const ganttEl = document.getElementById('gantt');
  const viewButtons = Array.from(document.querySelectorAll('.view-btn'));

  const editDialog = document.getElementById('edit-dialog');
  const editForm = document.getElementById('edit-form');
  const editNameInput = document.getElementById('edit-name');
  const editStartInput = document.getElementById('edit-start');
  const editDurationInput = document.getElementById('edit-duration');
  const editColorInput = document.getElementById('edit-color');
  const editColorPresetsEl = document.getElementById('edit-color-presets');
  const editCancelBtn = document.getElementById('edit-cancel-btn');
  const pageTitleEl = document.getElementById('page-title');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const zoomLevelEl = document.getElementById('zoom-level');
  const datesToggleBtn = document.getElementById('dates-toggle-btn');
  const timelineStartInput = document.getElementById('timeline-start-input');

  let tasks = [];
  let saveTimer = null;
  let rowRefs = new Map(); // id -> { rowEl, barEl }
  let fileHandle = null;
  let editingTaskId = null;

  let viewMode = DEFAULT_VIEW_MODE;
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (VIEW_MODES.includes(stored)) viewMode = stored;
  } catch (err) {
    // localStorage unavailable (e.g. private mode) — fall back to the default view.
  }

  let zoomLevel = DEFAULT_ZOOM;
  try {
    const storedZoom = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY));
    if (!Number.isNaN(storedZoom) && storedZoom >= ZOOM_MIN && storedZoom <= ZOOM_MAX) zoomLevel = storedZoom;
  } catch (err) {
    // localStorage unavailable — fall back to the default zoom.
  }

  let theme = 'dark';
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') theme = storedTheme;
  } catch (err) {
    // localStorage unavailable — fall back to the default theme.
  }

  let datesVisible = true;
  try {
    const storedDatesVisible = localStorage.getItem(DATES_STORAGE_KEY);
    if (storedDatesVisible === 'true' || storedDatesVisible === 'false') {
      datesVisible = storedDatesVisible === 'true';
    }
  } catch (err) {
    // localStorage unavailable — fall back to the default (dates on).
  }

  function firstOfCurrentMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  let timelineStartDate = firstOfCurrentMonth();
  try {
    const storedTimelineStart = localStorage.getItem(TIMELINE_START_STORAGE_KEY);
    const parsedTimelineStart = storedTimelineStart ? parseISODate(storedTimelineStart) : null;
    if (parsedTimelineStart) timelineStartDate = parsedTimelineStart;
  } catch (err) {
    // localStorage unavailable — fall back to the default timeline start.
  }

  const supportsFSA = 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;

  // ---------- Date helpers ----------
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function mondayOf(d) {
    const date = startOfDay(d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
  }

  function formatISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseISODate(str) {
    const parts = String(str || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatShort(date) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---------- Timeline / view-mode geometry ----------
  function pxPerDay() {
    let base;
    if (viewMode === 'month') base = MONTH_COL_WIDTH / 30.4368;
    else if (viewMode === 'quarter') base = QUARTER_COL_WIDTH / 91.3105;
    else base = WEEK_COL_WIDTH / 7;
    return base * zoomLevel;
  }

  function computeTimelineRange() {
    let maxEnd = null;
    tasks.forEach((t) => {
      const start = parseISODate(t.startDate);
      if (!start) return;
      const end = addDays(start, t.durationWeeks * 7);
      if (!maxEnd || end > maxEnd) maxEnd = end;
    });

    // The chosen timeline start is a hard edge: tasks that begin earlier are
    // clipped to it and rendered showing only their remaining duration.
    let rangeStart = mondayOf(timelineStartDate);

    if (!maxEnd) maxEnd = addDays(rangeStart, MIN_VISIBLE_WEEKS * 7);

    let rangeEnd = addDays(mondayOf(addDays(maxEnd, PADDING_WEEKS_AFTER * 7)), 7);

    const minEnd = addDays(rangeStart, MIN_VISIBLE_WEEKS * 7);
    if (rangeEnd < minEnd) rangeEnd = minEnd;

    if (viewMode === 'month') {
      rangeStart = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      rangeEnd = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, 1);
    } else if (viewMode === 'quarter') {
      const startQMonth = Math.floor(rangeStart.getMonth() / 3) * 3;
      rangeStart = new Date(rangeStart.getFullYear(), startQMonth, 1);
      const endQMonth = Math.floor(rangeEnd.getMonth() / 3) * 3 + 3;
      rangeEnd = new Date(rangeEnd.getFullYear(), endQMonth, 1);
    }

    return { start: rangeStart, end: rangeEnd };
  }

  function buildColumns(range) {
    const ppd = pxPerDay();
    const cols = [];

    if (viewMode === 'week') {
      let cur = range.start;
      while (cur < range.end) {
        const next = addDays(cur, 7);
        cols.push({ start: cur, end: next, label: formatShort(cur) });
        cur = next;
      }
    } else if (viewMode === 'month') {
      let cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
      while (cur < range.end) {
        const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        cols.push({ start: cur, end: next, label: cur.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) });
        cur = next;
      }
    } else {
      let cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
      while (cur < range.end) {
        const next = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
        const q = Math.floor(cur.getMonth() / 3) + 1;
        cols.push({ start: cur, end: next, label: `Q${q} ${cur.getFullYear()}` });
        cur = next;
      }
    }

    return cols.map((c) => ({ ...c, widthPx: daysBetween(c.start, c.end) * ppd }));
  }

  function timelineWidthPx(range) {
    return daysBetween(range.start, range.end) * pxPerDay();
  }

  function xForDate(range, date) {
    return daysBetween(range.start, date) * pxPerDay();
  }

  // Tasks starting before the visible range are clipped to its left edge and
  // drawn showing only their remaining duration, rather than being hidden.
  function visibleStart(range, start) {
    return start < range.start ? range.start : start;
  }

  function barLeftPx(range, task) {
    const start = parseISODate(task.startDate);
    return xForDate(range, visibleStart(range, start)) + 4;
  }

  function barWidthPx(range, task) {
    const start = parseISODate(task.startDate);
    const end = addDays(start, task.durationWeeks * 7);
    // Tasks ending before the range start are filtered out by visibleTasks()
    // before reaching here; clamp remains as a safety net against negative
    // widths (which would crash the canvas rounded-rect export).
    return Math.max(0, daysBetween(visibleStart(range, start), end) * pxPerDay() - 8);
  }

  function formatBarLabel(task) {
    const start = parseISODate(task.startDate);
    const end = addDays(start, task.durationWeeks * 7 - 1);
    return `${formatShort(start)} – ${formatShort(end)}`;
  }

  function snapDaysDeltaToWeek(px) {
    const days = px / pxPerDay();
    return Math.round(days / 7) * 7;
  }

  // ---------- Color ----------
  function darkenColor(hex, amount) {
    const clean = String(hex || '').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return hex;
    let r = (num >> 16) & 0xff;
    let g = (num >> 8) & 0xff;
    let b = num & 0xff;
    r = Math.max(0, Math.round(r * (1 - amount)));
    g = Math.max(0, Math.round(g * (1 - amount)));
    b = Math.max(0, Math.round(b * (1 - amount)));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function barColors(task) {
    if (task.color) return [task.color, darkenColor(task.color, 0.25)];
    return [DEFAULT_COLOR_1, DEFAULT_COLOR_2];
  }

  function applyBarColor(bar, task) {
    const [c1] = barColors(task);
    bar.style.background = c1;
  }

  // ---------- IndexedDB (persist the file handle across reloads) ----------
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- CSV ----------
  function csvEscape(value) {
    const str = String(value ?? '');
    if (/[",\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function parseCsvLine(line) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        fields.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    fields.push(cur);
    return fields;
  }

  function csvHeaders(text) {
    const raw = text.replace(/\r\n/g, '\n').trim();
    if (!raw) return [];
    return parseCsvLine(raw.split('\n')[0]);
  }

  function isLegacyCsv(text) {
    const headers = csvHeaders(text);
    return headers.includes('startSprint') && !headers.includes('startDate');
  }

  function parseCsv(text) {
    const raw = text.replace(/\r\n/g, '\n').trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const headers = parseCsvLine(lines[0]);
    const legacy = headers.includes('startSprint') && !headers.includes('startDate');
    const legacyAnchor = mondayOf(new Date());

    const result = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const fields = parseCsvLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => (row[h] = fields[idx]));

      let startDate;
      let durationWeeks;
      if (legacy) {
        // Old format stored an abstract "sprint" index/length; reinterpret each
        // sprint as one week, anchored to the current week so relative spacing
        // between tasks is preserved exactly.
        const sprintNum = parseInt(row.startSprint, 10) || 1;
        startDate = formatISODate(addDays(legacyAnchor, (sprintNum - 1) * 7));
        durationWeeks = Math.max(1, parseInt(row.duration, 10) || 1);
      } else {
        const parsed = parseISODate(row.startDate) || legacyAnchor;
        startDate = formatISODate(mondayOf(parsed));
        durationWeeks = Math.max(1, parseInt(row.durationWeeks, 10) || 1);
      }

      result.push({
        id: row.id,
        name: row.name || '',
        startDate,
        durationWeeks,
        order: parseInt(row.order, 10) || 0,
        color: row.color || '',
      });
    }
    result.sort((a, b) => a.order - b.order);
    return result;
  }

  function serializeCsv(list) {
    const sorted = [...list].sort((a, b) => a.order - b.order);
    const lines = [CSV_HEADERS.join(',')];
    sorted.forEach((t) => {
      lines.push(CSV_HEADERS.map((h) => csvEscape(t[h])).join(','));
    });
    return lines.join('\n') + '\n';
  }

  const SEED_TASKS = [
    { name: 'Discovery & Requirements', startWeekOffset: 0, durationWeeks: 2 },
    { name: 'UX Design', startWeekOffset: 2, durationWeeks: 2 },
    { name: 'Backend API', startWeekOffset: 4, durationWeeks: 3 },
    { name: 'Frontend Build', startWeekOffset: 6, durationWeeks: 3 },
    { name: 'Integration Testing', startWeekOffset: 10, durationWeeks: 2 },
    { name: 'Launch', startWeekOffset: 12, durationWeeks: 1 },
  ];

  function buildSeedCsv() {
    const anchor = mondayOf(new Date());
    const seedTasks = SEED_TASKS.map((t, idx) => ({
      id: String(idx + 1),
      name: t.name,
      startDate: formatISODate(addDays(anchor, t.startWeekOffset * 7)),
      durationWeeks: t.durationWeeks,
      order: idx,
      color: '',
    }));
    return serializeCsv(seedTasks);
  }

  // ---------- File connection ----------
  function setFileStatus(text, cls) {
    fileStatusEl.textContent = text;
    fileStatusEl.className = 'file-status' + (cls ? ' ' + cls : '');
  }

  function showGantt(show) {
    emptyState.hidden = show;
    ganttEl.hidden = !show;
    addTaskBtn.disabled = !show;
    exportPngBtn.disabled = !show;
    exportPdfBtn.disabled = !show;
    autosortBtn.disabled = !show;
  }

  async function verifyPermission(handle, mode) {
    const opts = { mode };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  async function connectHandle(handle, { seedIfEmpty } = {}) {
    const ok = await verifyPermission(handle, 'readwrite');
    if (!ok) {
      setFileStatus('Permission denied', 'error');
      return false;
    }
    fileHandle = handle;
    await idbSet(DB_KEY, handle);

    const file = await fileHandle.getFile();
    let text = await file.text();
    if (!text.trim() && seedIfEmpty) {
      text = buildSeedCsv();
      await writeFile(text);
    }

    const needsMigration = isLegacyCsv(text);
    tasks = parseCsv(text);
    setFileStatus('Connected: ' + fileHandle.name, 'connected');
    showGantt(true);
    render();

    // Persist the migrated date-based format immediately so the anchor date
    // doesn't keep drifting forward every time this file is reopened unsaved.
    if (needsMigration) {
      await writeFile(serializeCsv(tasks));
    }
    return true;
  }

  async function writeFile(text) {
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function openExisting() {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
        suggestedName: 'project.csv',
      });
      await connectHandle(handle);
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  }

  async function createNew() {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'project.csv',
        types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
      });
      await connectHandle(handle, { seedIfEmpty: true });
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  }

  async function tryRestoreHandle() {
    try {
      const handle = await idbGet(DB_KEY);
      if (!handle) return;

      // If the browser already granted permission in a prior session, no user
      // gesture is needed — reopen it immediately without waiting for a click.
      const alreadyGranted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
      if (alreadyGranted) {
        await connectHandle(handle);
        return;
      }

      setFileStatus('Reconnect to ' + handle.name + ' to resume', '');
      fileStatusEl.textContent += ' ';
      const reconnectBtn = document.createElement('button');
      reconnectBtn.className = 'btn';
      reconnectBtn.textContent = 'Reconnect';
      reconnectBtn.addEventListener('click', async () => {
        reconnectBtn.remove();
        await connectHandle(handle);
      });
      fileStatusEl.after(reconnectBtn);
    } catch (err) {
      console.error(err);
    }
  }

  // ---------- View mode ----------
  function syncViewButtons() {
    viewButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewMode));
  }

  function setViewMode(mode) {
    if (!VIEW_MODES.includes(mode) || mode === viewMode) return;
    viewMode = mode;
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
    } catch (err) {
      // ignore — persistence is a convenience, not a requirement
    }
    syncViewButtons();
    render();
  }

  // ---------- Zoom ----------
  function syncZoomButtons() {
    zoomLevelEl.textContent = Math.round(zoomLevel * 100) + '%';
    zoomOutBtn.disabled = zoomLevel <= ZOOM_MIN;
    zoomInBtn.disabled = zoomLevel >= ZOOM_MAX;
  }

  function setZoom(level) {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
    if (clamped === zoomLevel) return;
    zoomLevel = clamped;
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomLevel));
    } catch (err) {
      // ignore — persistence is a convenience, not a requirement
    }
    syncZoomButtons();
    render();
  }

  function zoomIn() {
    setZoom(zoomLevel + ZOOM_STEP);
  }

  function zoomOut() {
    setZoom(zoomLevel - ZOOM_STEP);
  }

  // ---------- Theme ----------
  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    themeToggleBtn.textContent = theme === 'dark' ? 'Theme: Dark' : 'Theme: Light';
    themeToggleBtn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (err) {
      // ignore — persistence is a convenience, not a requirement
    }
    applyTheme();
  }

  // ---------- Dates on bars ----------
  function syncDatesButton() {
    datesToggleBtn.textContent = datesVisible ? 'Dates: On' : 'Dates: Off';
    datesToggleBtn.classList.toggle('active', datesVisible);
  }

  function toggleDatesVisible() {
    datesVisible = !datesVisible;
    try {
      localStorage.setItem(DATES_STORAGE_KEY, String(datesVisible));
    } catch (err) {
      // ignore — persistence is a convenience, not a requirement
    }
    syncDatesButton();
    render();
  }

  // ---------- Timeline start date ----------
  function syncTimelineStartInput() {
    timelineStartInput.value = formatISODate(timelineStartDate);
  }

  function setTimelineStartDate(date) {
    timelineStartDate = startOfDay(date);
    try {
      localStorage.setItem(TIMELINE_START_STORAGE_KEY, formatISODate(timelineStartDate));
    } catch (err) {
      // ignore — persistence is a convenience, not a requirement
    }
    render();
  }

  // ---------- Page title ----------
  function loadPageTitle() {
    let saved = '';
    try {
      saved = localStorage.getItem(TITLE_STORAGE_KEY) || '';
    } catch (err) {
      // ignore — persistence is a convenience, not a requirement
    }
    if (saved) {
      pageTitleEl.textContent = saved;
      document.title = saved;
    }
  }

  function savePageTitle() {
    const text = pageTitleEl.textContent.replace(/\s+/g, ' ').trim();
    pageTitleEl.textContent = text || 'Project';
    document.title = pageTitleEl.textContent;
    try {
      localStorage.setItem(TITLE_STORAGE_KEY, pageTitleEl.textContent);
    } catch (err) {
      // ignore — persistence is a convenience, not a requirement
    }
  }

  // ---------- Rendering ----------
  function uid() {
    return 't' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function sortedTasks() {
    return [...tasks].sort((a, b) => a.order - b.order);
  }

  // Tasks that end before the visible range starts have no remaining
  // duration to show, so they're left out of the timeline entirely.
  function visibleTasks(range) {
    return sortedTasks().filter((t) => {
      const start = parseISODate(t.startDate);
      if (!start) return false;
      const end = addDays(start, t.durationWeeks * 7);
      return end > range.start;
    });
  }

  function renderColumnCells(container, columns, withLabel) {
    container.innerHTML = '';
    columns.forEach((col) => {
      const el = document.createElement('div');
      el.className = withLabel ? 'grid-col sprint-col' : 'grid-col';
      el.style.width = col.widthPx + 'px';
      if (withLabel) el.textContent = col.label;
      container.appendChild(el);
    });
  }

  function render() {
    const range = computeTimelineRange();
    const columns = buildColumns(range);
    const totalWidth = timelineWidthPx(range);

    renderColumnCells(sprintHeaderEl, columns, true);
    sprintHeaderEl.style.width = totalWidth + 'px';

    taskRowsEl.innerHTML = '';
    rowRefs = new Map();

    visibleTasks(range).forEach((task) => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.dataset.id = task.id;

      const label = document.createElement('div');
      label.className = 'task-label';

      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.title = 'Drag the bar to move it in time or reorder rows';
      handle.textContent = '⋮⋮';
      label.appendChild(handle);

      const nameInput = document.createElement('input');
      nameInput.className = 'task-name';
      nameInput.value = task.name;
      nameInput.addEventListener('input', () => {
        task.name = nameInput.value;
        scheduleSave();
      });
      label.appendChild(nameInput);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'edit-btn';
      editBtn.textContent = '✎';
      editBtn.title = 'Edit name, start date, duration, and color';
      editBtn.addEventListener('click', () => openEditDialog(task));
      label.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'delete-btn';
      delBtn.textContent = '×';
      delBtn.title = 'Delete task';
      delBtn.addEventListener('click', () => deleteTask(task.id));
      label.appendChild(delBtn);

      row.appendChild(label);

      const track = document.createElement('div');
      track.className = 'row-track';
      track.style.width = totalWidth + 'px';
      renderColumnCells(track, columns, false);

      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.left = barLeftPx(range, task) + 'px';
      bar.style.width = barWidthPx(range, task) + 'px';
      applyBarColor(bar, task);

      if (datesVisible) {
        const barLabel = document.createElement('span');
        barLabel.className = 'bar-label';
        barLabel.textContent = formatBarLabel(task);
        bar.appendChild(barLabel);
      }

      const leftHandle = document.createElement('div');
      leftHandle.className = 'resize-handle left';
      bar.appendChild(leftHandle);

      const rightHandle = document.createElement('div');
      rightHandle.className = 'resize-handle right';
      bar.appendChild(rightHandle);

      track.appendChild(bar);
      row.appendChild(track);
      taskRowsEl.appendChild(row);

      rowRefs.set(task.id, { rowEl: row, barEl: bar });

      leftHandle.addEventListener('mousedown', (e) => startResize(e, task, 'left', range));
      rightHandle.addEventListener('mousedown', (e) => startResize(e, task, 'right', range));
      bar.addEventListener('mousedown', (e) => {
        if (e.target === leftHandle || e.target === rightHandle) return;
        startMove(e, task, range);
      });
    });
  }

  // --- Move + reorder ---
  function startMove(e, task, range) {
    e.preventDefault();
    const { rowEl, barEl } = rowRefs.get(task.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const origStart = parseISODate(task.startDate);

    const order = visibleTasks(range);
    const startIndex = order.findIndex((t) => t.id === task.id);
    const origIndexMap = new Map(order.map((t, i) => [t.id, i]));
    let workingOrder = order.map((t) => t.id);

    rowEl.classList.add('dragging');
    barEl.classList.add('dragging');
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      // Horizontal: move in time, snapped to whole weeks
      const deltaDays = snapDaysDeltaToWeek(dx);
      const newStart = addDays(origStart, deltaDays);
      const previewTask = { startDate: formatISODate(newStart), durationWeeks: task.durationWeeks };
      barEl.style.left = barLeftPx(range, previewTask) + 'px';
      barEl.style.width = barWidthPx(range, previewTask) + 'px';
      task._pendingStartDate = formatISODate(newStart);

      // Vertical: reorder
      const targetIndex = Math.max(
        0,
        Math.min(order.length - 1, startIndex + Math.round(dy / ROW_HEIGHT))
      );
      const curIndex = workingOrder.indexOf(task.id);
      if (targetIndex !== curIndex) {
        workingOrder.splice(curIndex, 1);
        workingOrder.splice(targetIndex, 0, task.id);
      }

      workingOrder.forEach((id) => {
        if (id === task.id) return;
        const refs = rowRefs.get(id);
        if (!refs) return;
        const newIdx = workingOrder.indexOf(id);
        const origIdx = origIndexMap.get(id);
        refs.rowEl.style.transform = `translateY(${(newIdx - origIdx) * ROW_HEIGHT}px)`;
      });
      rowEl.style.transform = `translateY(${dy}px)`;
      rowEl.style.zIndex = 50;

      task._pendingOrder = workingOrder;
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';

      if (task._pendingStartDate) {
        task.startDate = task._pendingStartDate;
        delete task._pendingStartDate;
      }
      if (task._pendingOrder) {
        task._pendingOrder.forEach((id, idx) => {
          const t = tasks.find((tt) => tt.id === id);
          if (t) t.order = idx;
        });
        delete task._pendingOrder;
      }

      render();
      scheduleSave();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // --- Resize ---
  function startResize(e, task, side, range) {
    e.preventDefault();
    e.stopPropagation();
    const { barEl } = rowRefs.get(task.id);
    const startX = e.clientX;
    const origStart = parseISODate(task.startDate);
    const origDurationWeeks = task.durationWeeks;

    barEl.classList.add('dragging');
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const deltaWeeks = snapDaysDeltaToWeek(dx) / 7;

      let newStart = origStart;
      let newDurationWeeks = origDurationWeeks;

      if (side === 'right') {
        newDurationWeeks = Math.max(1, origDurationWeeks + deltaWeeks);
      } else {
        const maxDelta = origDurationWeeks - 1;
        const clampedDelta = Math.min(maxDelta, deltaWeeks);
        newStart = addDays(origStart, clampedDelta * 7);
        newDurationWeeks = origDurationWeeks - clampedDelta;
      }

      const previewTask = { startDate: formatISODate(newStart), durationWeeks: newDurationWeeks };
      barEl.style.left = barLeftPx(range, previewTask) + 'px';
      barEl.style.width = barWidthPx(range, previewTask) + 'px';

      task._pendingStartDate = formatISODate(newStart);
      task._pendingDurationWeeks = newDurationWeeks;
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';

      if (task._pendingStartDate) task.startDate = task._pendingStartDate;
      if (task._pendingDurationWeeks) task.durationWeeks = task._pendingDurationWeeks;
      delete task._pendingStartDate;
      delete task._pendingDurationWeeks;

      render();
      scheduleSave();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function deleteTask(id) {
    tasks = tasks.filter((t) => t.id !== id);
    sortedTasks().forEach((t, idx) => (t.order = idx));
    render();
    scheduleSave();
  }

  function autoSortTasks() {
    tasks
      .slice()
      .sort((a, b) => {
        const startCmp = parseISODate(a.startDate) - parseISODate(b.startDate);
        if (startCmp !== 0) return startCmp;
        const durCmp = a.durationWeeks - b.durationWeeks;
        if (durCmp !== 0) return durCmp;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      })
      .forEach((t, idx) => (t.order = idx));
    render();
    scheduleSave();
  }

  function addTask() {
    const newTask = {
      id: uid(),
      name: 'New Task',
      startDate: formatISODate(mondayOf(new Date())),
      durationWeeks: 1,
      order: tasks.length,
      color: '',
    };
    tasks.push(newTask);
    render();
    scheduleSave();
    const refs = rowRefs.get(newTask.id);
    if (refs) {
      const input = refs.rowEl.querySelector('.task-name');
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  // ---------- Edit dialog ----------
  function buildColorPresets() {
    editColorPresetsEl.innerHTML = '';
    PRESET_COLORS.forEach(({ name, hex }) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = hex;
      swatch.title = name;
      swatch.setAttribute('aria-label', name);
      swatch.addEventListener('click', () => {
        editColorInput.value = hex;
      });
      editColorPresetsEl.appendChild(swatch);
    });
  }

  function openEditDialog(task) {
    editingTaskId = task.id;
    editNameInput.value = task.name;
    editStartInput.value = task.startDate;
    editDurationInput.value = task.durationWeeks;
    editColorInput.value = task.color || DEFAULT_COLOR_1;
    editDialog.showModal();
    editNameInput.focus();
  }

  buildColorPresets();

  editCancelBtn.addEventListener('click', () => editDialog.close());

  editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const task = tasks.find((t) => t.id === editingTaskId);
    editDialog.close();
    if (!task) return;

    task.name = editNameInput.value.trim() || 'Untitled';
    const chosen = parseISODate(editStartInput.value);
    if (chosen) task.startDate = formatISODate(mondayOf(chosen));
    task.durationWeeks = Math.max(1, parseInt(editDurationInput.value, 10) || 1);
    task.color = editColorInput.value || '';

    render();
    scheduleSave();
  });

  // ---------- Export ----------
  function baseFileName() {
    return fileHandle ? fileHandle.name.replace(/\.csv$/i, '') : 'project';
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function truncateToWidth(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '…';
  }

  function drawGanttToCanvas() {
    const range = computeTimelineRange();
    const order = visibleTasks(range);
    const columns = buildColumns(range);
    const width = LABEL_WIDTH + timelineWidthPx(range);
    const height = HEADER_HEIGHT + order.length * ROW_HEIGHT;

    const scale = 2; // render at 2x for a crisp export
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = Math.max(height, 1) * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    const colors = {
      bg: '#ffffff',
      panelAlt: '#f4f5f7',
      border: '#d7dae0',
      text: '#16181d',
      muted: '#5b6472',
    };

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = colors.panelAlt;
    ctx.fillRect(0, 0, width, HEADER_HEIGHT);

    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT + 0.5);
    ctx.lineTo(width, HEADER_HEIGHT + 0.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(LABEL_WIDTH + 0.5, 0);
    ctx.lineTo(LABEL_WIDTH + 0.5, height);
    ctx.stroke();

    ctx.fillStyle = colors.muted;
    ctx.font = "600 11px -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('TASK', 12, HEADER_HEIGHT / 2);

    let colX = LABEL_WIDTH;
    columns.forEach((col) => {
      ctx.strokeStyle = colors.border;
      ctx.beginPath();
      ctx.moveTo(colX + col.widthPx + 0.5, 0);
      ctx.lineTo(colX + col.widthPx + 0.5, HEADER_HEIGHT);
      ctx.stroke();

      ctx.fillStyle = colors.muted;
      ctx.font = "600 12px -apple-system, 'Segoe UI', Roboto, sans-serif";
      ctx.textAlign = 'left';
      ctx.fillText(col.label, colX + 4, HEADER_HEIGHT / 2);
      colX += col.widthPx;
    });

    order.forEach((task, idx) => {
      const y = HEADER_HEIGHT + idx * ROW_HEIGHT;

      ctx.strokeStyle = colors.border;
      ctx.beginPath();
      ctx.moveTo(0, y + ROW_HEIGHT + 0.5);
      ctx.lineTo(width, y + ROW_HEIGHT + 0.5);
      ctx.stroke();

      let gx = LABEL_WIDTH;
      columns.forEach((col) => {
        gx += col.widthPx;
        ctx.beginPath();
        ctx.moveTo(gx + 0.5, y);
        ctx.lineTo(gx + 0.5, y + ROW_HEIGHT);
        ctx.stroke();
      });

      ctx.fillStyle = colors.text;
      ctx.font = "13px -apple-system, 'Segoe UI', Roboto, sans-serif";
      ctx.textBaseline = 'middle';
      const name = truncateToWidth(ctx, task.name || '', LABEL_WIDTH - 24);
      ctx.fillText(name, 16, y + ROW_HEIGHT / 2);

      const barX = LABEL_WIDTH + barLeftPx(range, task);
      const barY = y + 7;
      const barW = barWidthPx(range, task);
      const barH = ROW_HEIGHT - 14;
      const [c1] = barColors(task);

      ctx.fillStyle = c1;
      roundRectPath(ctx, barX, barY, barW, barH, 6);
      ctx.fill();

      if (datesVisible) {
        ctx.save();
        roundRectPath(ctx, barX, barY, barW, barH, 6);
        ctx.clip();
        ctx.fillStyle = '#ffffff';
        ctx.font = "600 12px -apple-system, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(formatBarLabel(task), barX + 10, y + ROW_HEIGHT / 2);
        ctx.restore();
      }
    });

    return canvas;
  }

  function exportPng() {
    const canvas = drawGanttToCanvas();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = baseFileName() + '.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  function exportPdf() {
    const range = computeTimelineRange();
    const ganttWidth = LABEL_WIDTH + timelineWidthPx(range);
    const scale = Math.min(1, PRINT_PAGE_WIDTH_PX / ganttWidth);
    document.documentElement.style.setProperty('--print-scale', scale);

    const prevTitle = document.title;
    document.title = baseFileName();

    function restoreTitle() {
      document.title = prevTitle;
      window.removeEventListener('afterprint', restoreTitle);
    }
    window.addEventListener('afterprint', restoreTitle);

    window.print();
  }

  // ---------- Saving ----------
  function scheduleSave() {
    if (!fileHandle) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveStatusEl.textContent = 'Saving...';
    saveStatusEl.className = 'save-status saving';
    saveTimer = setTimeout(saveTasks, 400);
  }

  async function saveTasks() {
    if (!fileHandle) return;
    try {
      await writeFile(serializeCsv(tasks));
      saveStatusEl.textContent = 'Saved';
      saveStatusEl.className = 'save-status';
    } catch (err) {
      console.error(err);
      saveStatusEl.textContent = 'Save error';
      saveStatusEl.className = 'save-status error';
    }
  }

  // ---------- Init ----------
  addTaskBtn.addEventListener('click', addTask);
  autosortBtn.addEventListener('click', autoSortTasks);
  openFileBtn.addEventListener('click', openExisting);
  newFileBtn.addEventListener('click', createNew);
  exportPngBtn.addEventListener('click', exportPng);
  exportPdfBtn.addEventListener('click', exportPdf);
  viewButtons.forEach((btn) => btn.addEventListener('click', () => setViewMode(btn.dataset.view)));
  syncViewButtons();

  zoomInBtn.addEventListener('click', zoomIn);
  zoomOutBtn.addEventListener('click', zoomOut);
  syncZoomButtons();

  themeToggleBtn.addEventListener('click', toggleTheme);
  applyTheme();

  datesToggleBtn.addEventListener('click', toggleDatesVisible);
  syncDatesButton();

  timelineStartInput.addEventListener('change', () => {
    const parsed = parseISODate(timelineStartInput.value);
    if (parsed) {
      setTimelineStartDate(parsed);
    } else {
      syncTimelineStartInput();
    }
  });
  syncTimelineStartInput();

  pageTitleEl.addEventListener('blur', savePageTitle);
  pageTitleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      pageTitleEl.blur();
    }
  });
  loadPageTitle();

  if (!supportsFSA) {
    unsupportedBanner.hidden = false;
    openFileBtn.disabled = true;
    newFileBtn.disabled = true;
    setFileStatus('File System Access not supported', 'error');
  } else {
    tryRestoreHandle();
  }
})();
