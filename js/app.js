/* ═══════════════════════════════════════════════════════════
   CYTATY APP — main application
   Vanilla JS, no framework, no build step
═══════════════════════════════════════════════════════════ */

const App = (() => {

  /* ─────────────────────────────────────────
     CONFIG & CONSTANTS
  ───────────────────────────────────────── */
  const SRS = {
    1: { days: 1,  label: 'jutro' },
    2: { days: 5,  label: 'za 5 dni' },
    3: { days: 14, label: 'za 14 dni' },
  };

  const EVAL_MAP = {
    DOKLADNIE:  { score: 3, label: 'Dokładnie!',       cls: 'dokladnie',  msg: 'Wiernie oddałeś sens. Poziom 3 — wróci za 14 dni.' },
    PARAFRAZA:  { score: 2, label: 'Z grubsza.',       cls: 'parafraza',  msg: 'Dobra parafraza. Poziom 2 — wróci za 5 dni.' },
    NIEZGODNE:  { score: 1, label: 'Nietrafiłeś.',     cls: 'niezgodne',  msg: 'Sens się nie zgadza. Poziom 1 — wróci jutro.' },
  };

  /* ─────────────────────────────────────────
     STATE
  ───────────────────────────────────────── */
  let state = {
    settings: {},
    quotes: [],        // all from Airtable
    history: [],       // all from Historia table
    todayQueue: [],    // quotes due today
    currentQuote: null,
    currentView: 'today',
    editingQuoteId: null,
    filterLevel: 'all',
    filterTag: 'all',
    searchQuery: '',
    recognition: null,
    transcript: '',
  };

  /* ─────────────────────────────────────────
     STORAGE
  ───────────────────────────────────────── */
  const Storage = {
    get: (k, def = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    clear: (k) => localStorage.removeItem(k),
  };

  /* ─────────────────────────────────────────
     AIRTABLE API
  ───────────────────────────────────────── */

  // Extract base ID from full URL or plain ID
  function parseBaseId(input) {
    if (!input) return '';
    const match = input.match(/(app[A-Za-z0-9]{14,})/);
    return match ? match[1] : input.trim();
  }

  const AT = {
    base: () => `https://api.airtable.com/v0/${state.settings.baseId}`,
    headers: () => ({ 'Authorization': `Bearer ${state.settings.token}`, 'Content-Type': 'application/json' }),

    async _checkRes(res) {
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          msg = body.error?.message || body.error?.type || msg;
        } catch {}
        throw new Error(msg);
      }
      return res.json();
    },

    async fetchAll(table) {
      let records = [], offset = null;
      do {
        const url = new URL(`${AT.base()}/${encodeURIComponent(table)}`);
        url.searchParams.set('pageSize', '100');
        if (offset) url.searchParams.set('offset', offset);
        const res = await fetch(url, { headers: AT.headers() });
        const data = await AT._checkRes(res);
        records.push(...data.records);
        offset = data.offset;
      } while (offset);
      return records;
    },

    async updateRecord(table, id, fields) {
      const res = await fetch(`${AT.base()}/${encodeURIComponent(table)}/${id}`, {
        method: 'PATCH',
        headers: AT.headers(),
        body: JSON.stringify({ fields }),
      });
      return AT._checkRes(res);
    },

    async createRecord(table, fields) {
      const res = await fetch(`${AT.base()}/${encodeURIComponent(table)}`, {
        method: 'POST',
        headers: AT.headers(),
        body: JSON.stringify({ fields }),
      });
      return AT._checkRes(res);
    },

    async testConnection(onStep) {
      // Step 1: token valid?
      onStep?.('Sprawdzam token…');
      const r1 = await fetch('https://api.airtable.com/v0/meta/whoami', { headers: AT.headers() });
      if (!r1.ok) {
        const b = await r1.json().catch(() => ({}));
        throw new Error(`Token nieprawidłowy (${r1.status}): ${b.error?.message || b.message || 'sprawdź Access Token'}`);
      }

      // Step 2: base accessible?
      onStep?.('Sprawdzam bazę…');
      const r2 = await fetch(`${AT.base()}/Cytaty?maxRecords=1`, { headers: AT.headers() });
      if (!r2.ok) {
        const b = await r2.json().catch(() => ({}));
        const msg = b.error?.message || b.error?.type || `HTTP ${r2.status}`;
        throw new Error(`Nie można otworzyć tabeli Cytaty: ${msg}`);
      }
      return true;
    },
  };

  /* ─────────────────────────────────────────
     DATA HELPERS
  ───────────────────────────────────────── */
  function today() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  function addDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function isDue(q) {
    const next = q.fields['Następna powtórka'];
    if (!next) return true; // no date = new quote, show immediately
    return next <= today();
  }

  function getLevel(q) {
    return q.fields['Poziom'] || 1;
  }

  /* ─────────────────────────────────────────
     LOAD DATA
  ───────────────────────────────────────── */
  async function loadData() {
    const [quotes, history] = await Promise.all([
      AT.fetchAll('Cytaty'),
      AT.fetchAll('Historia').catch(() => []),
    ]);
    state.quotes = quotes;
    state.history = history;
    Storage.set('quotes_cache', quotes);
    Storage.set('history_cache', history);
    buildTodayQueue();
  }

  function buildTodayQueue() {
    state.todayQueue = state.quotes
      .filter(isDue)
      .sort((a, b) => {
        const da = a.fields['Następna powtórka'] || '0000-00-00';
        const db = b.fields['Następna powtórka'] || '0000-00-00';
        return da.localeCompare(db);
      });
    state.currentQuote = state.todayQueue[0] || null;
  }

  /* ─────────────────────────────────────────
     SRS — update after evaluation
  ───────────────────────────────────────── */
  async function applyEvaluation(quote, score) {
    const nextDate = addDays(SRS[score].days);
    // Optimistic update in local state
    quote.fields['Poziom'] = score;
    quote.fields['Następna powtórka'] = nextDate;
    // Remove from today's queue
    state.todayQueue = state.todayQueue.filter(q => q.id !== quote.id);

    // Write to Airtable (parallel)
    const [, histRecord] = await Promise.all([
      AT.updateRecord('Cytaty', quote.id, {
        'Poziom': score,
        'Następna powtórka': nextDate,
      }),
      AT.createRecord('Historia', {
        'Cytat': `https://airtable.com/${state.settings.baseId}/Cytaty/${quote.id}`,
        'Ocena': score,
        'Data': today(),
      }),
    ]);

    // Update local history cache
    state.history.push(histRecord);
    Storage.set('history_cache', state.history);
    Storage.set('quotes_cache', state.quotes);
  }

  /* ─────────────────────────────────────────
     CLAUDE EVALUATION
  ───────────────────────────────────────── */
  async function evaluateWithClaude(original, transcript) {
    if (!state.settings.claudeKey) throw new Error('Brak klucza Claude API');
    const prompt = `Oceniasz odpowiedź ucznia który miał zapamiętać cytat.

ORYGINAŁ:
"${original}"

ODPOWIEDŹ UCZNIA (transkrypcja głosowa):
"${transcript}"

Zasady oceny:
- DOKLADNIE: sens i większość słów zachowane, dopuszczalne drobne różnice w sformułowaniu
- PARAFRAZA: sens główny zachowany, ale inne słowa lub uproszczenie
- NIEZGODNE: sens zmieniony, niekompletny lub wypowiedź nie na temat

Odpowiedz JEDNYM słowem: DOKLADNIE lub PARAFRAZA lub NIEZGODNE`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': state.settings.claudeKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude API error ${res.status}`);
    }

    const data = await res.json();
    const answer = data.content[0].text.trim().toUpperCase();
    if (answer.includes('DOKLADNIE')) return 'DOKLADNIE';
    if (answer.includes('PARAFRAZA')) return 'PARAFRAZA';
    return 'NIEZGODNE';
  }

  /* ─────────────────────────────────────────
     WEB SPEECH API
  ───────────────────────────────────────── */
  function startRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Twoja przeglądarka nie obsługuje nagrywania głosu');
      return;
    }

    state.transcript = '';
    const r = new SpeechRecognition();
    r.lang = 'pl-PL';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      state.transcript = final || interim;
      const el = document.getElementById('recording-transcript');
      if (el) el.textContent = state.transcript;
    };

    r.onerror = (e) => {
      console.error('Speech recognition error', e.error);
      if (e.error !== 'aborted') showToast('Błąd nagrywania: ' + e.error);
    };

    r.onend = () => { /* user taps stop — handled by btn-stop */ };

    r.start();
    state.recognition = r;
  }

  function stopRecognition() {
    if (state.recognition) {
      state.recognition.stop();
      state.recognition = null;
    }
  }

  /* ─────────────────────────────────────────
     TODAY VIEW — VOICE FLOW
  ───────────────────────────────────────── */
  function showReadPhase() {
    const q = state.currentQuote;
    if (!q) { setPhase('empty'); renderEmpty(); return; }

    const f = q.fields;
    setText('today-author', f['Autor'] || '');
    const srcEl = document.getElementById('today-source');
    srcEl.textContent = f['Źródło'] || '';
    srcEl.href = f['URL'] || '#';

    document.getElementById('today-quote').textContent = f['Cytat'] || '';
    setPhase('read');
  }

  function setPhase(phase) {
    document.getElementById('view-today').dataset.phase = phase;
  }

  async function handleRecord() {
    // iOS mic permission check
    if (navigator.mediaDevices?.getUserMedia) {
      try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {
        showToast('Zezwól na dostęp do mikrofonu w ustawieniach');
        return;
      }
    }
    setPhase('recording');
    document.getElementById('recording-transcript').textContent = '';
    startRecognition();
  }

  async function handleStop() {
    stopRecognition();
    const transcript = state.transcript.trim();

    if (!transcript) {
      showToast('Nie zarejestrowano mowy — spróbuj ponownie');
      setPhase('read');
      return;
    }

    setPhase('analyzing');

    try {
      const q = state.currentQuote;
      const original = q.fields['Cytat'];
      const verdict = await evaluateWithClaude(original, transcript);
      const ev = EVAL_MAP[verdict];

      // Show result
      setText('result-author', q.fields['Autor'] || '');
      const rSrc = document.getElementById('result-source');
      rSrc.textContent = q.fields['Źródło'] || '';
      rSrc.href = q.fields['URL'] || '#';
      document.getElementById('result-quote').textContent = original;

      const badge = document.getElementById('result-badge');
      badge.textContent = ev.label;
      badge.className = `result__badge result__badge--${ev.cls}`;
      document.getElementById('result-msg').textContent = ev.msg;

      setPhase('result');

      // Apply to Airtable in background
      await applyEvaluation(q, ev.score);

      // Advance next quote pointer
      state.currentQuote = state.todayQueue[0] || null;

    } catch (err) {
      console.error(err);
      showToast('Błąd analizy: ' + err.message);
      setPhase('read');
    }
  }

  function handleNext() {
    showReadPhase();
  }

  function handlePostpone() {
    state.todayQueue = state.todayQueue.filter(q => q.id !== state.currentQuote?.id);
    state.currentQuote = state.todayQueue[0] || null;
    showReadPhase();
    showToast('Odłożono — wróci przy następnym otwarciu');
  }

  function renderEmpty() {
    const nextQuote = state.quotes
      .filter(q => !isDue(q))
      .sort((a, b) => (a.fields['Następna powtórka'] || '').localeCompare(b.fields['Następna powtórka'] || ''))
    [0];

    const el = document.getElementById('empty-next');
    if (nextQuote) {
      const d = formatDate(nextQuote.fields['Następna powtórka']);
      const count = state.quotes.filter(q => q.fields['Następna powtórka'] === nextQuote.fields['Następna powtórka']).length;
      el.textContent = `Następna powtórka: ${d}`;
    } else {
      el.textContent = 'Dodaj nowe cytaty w zakładce Wszystkie';
    }
  }

  /* ─────────────────────────────────────────
     PROGRESS VIEW
  ───────────────────────────────────────── */
  function renderProgress() {
    const quotes = state.quotes;
    const history = state.history;

    // Streak
    const streak = calcStreak(history);
    const record = Storage.get('streak_record', 0);
    const newRecord = Math.max(record, streak);
    Storage.set('streak_record', newRecord);
    setText('stat-streak', streak);
    setText('stat-record', `Rekord: ${newRecord} ${pluralDni(newRecord)}`);
    renderWeek(history);

    // Mastery
    const lv3 = quotes.filter(q => getLevel(q) === 3).length;
    const pct = quotes.length ? Math.round((lv3 / quotes.length) * 100) : 0;
    setText('stat-mastery', pct + '%');
    setText('stat-total', quotes.length);
    setText('stat-reviews', history.length);

    const dueToday = quotes.filter(isDue).length;
    setText('stat-today-count', dueToday);

    // Level bars
    const lv1 = quotes.filter(q => getLevel(q) === 1).length;
    const lv2 = quotes.filter(q => getLevel(q) === 2).length;
    const max = Math.max(lv1, lv2, lv3, 1);
    setBar('bar-lv1', lv1, max); setText('count-lv1', lv1);
    setBar('bar-lv2', lv2, max); setText('count-lv2', lv2);
    setBar('bar-lv3', lv3, max); setText('count-lv3', lv3);

    // Heatmap
    renderHeatmap(history);
  }

  function calcStreak(history) {
    const days = new Set(history.map(h => h.fields['Data']).filter(Boolean));
    let streak = 0;
    let d = new Date();
    // if no review today yet, start from yesterday
    if (!days.has(today())) d.setDate(d.getDate() - 1);
    while (true) {
      const key = d.toISOString().split('T')[0];
      if (!days.has(key)) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function renderWeek(history) {
    const days = new Set(history.map(h => h.fields['Data']).filter(Boolean));
    const labels = ['Pn','Wt','Śr','Cz','Pt','So','Nd'];
    const container = document.getElementById('streak-week');
    container.innerHTML = '';

    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 0=Mon

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const done = days.has(key);
      const isToday = key === today();
      const dayIdx = (d.getDay() + 6) % 7;

      const div = document.createElement('div');
      div.className = 'streak-day';
      const circle = document.createElement('div');
      circle.className = 'streak-day__circle' + (done ? ' streak-day__circle--done' : '') + (isToday && !done ? ' streak-day__circle--today' : '');
      const label = document.createElement('div');
      label.className = 'streak-day__label';
      label.textContent = labels[dayIdx];
      div.appendChild(circle);
      div.appendChild(label);
      container.appendChild(div);
    }
  }

  function setBar(id, val, max) {
    const el = document.getElementById(id);
    if (el) el.style.width = (max > 0 ? (val / max * 100) : 0) + '%';
  }

  function renderHeatmap(history) {
    const counts = {};
    history.forEach(h => {
      const d = h.fields['Data'];
      if (d) counts[d] = (counts[d] || 0) + 1;
    });

    const grid = document.getElementById('heatmap-grid');
    const monthsEl = document.getElementById('heatmap-months');
    grid.innerHTML = '';
    monthsEl.innerHTML = '';

    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);

    // Pad to Monday
    const startDow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - startDow);

    const weeks = Math.ceil(((end - start) / 86400000 + 1) / 7);
    grid.style.gridTemplateColumns = `repeat(${weeks}, 10px)`;

    const monthLabels = {};
    let d = new Date(start);
    while (d <= end) {
      const key = d.toISOString().split('T')[0];
      const c = counts[key] || 0;
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell' + (c === 0 ? '' : c === 1 ? ' heatmap-cell--1' : c <= 3 ? ' heatmap-cell--2' : ' heatmap-cell--3');
      cell.title = `${key}: ${c} powtórek`;
      grid.appendChild(cell);

      // Track month labels
      const mKey = `${d.getFullYear()}-${d.getMonth()}`;
      if (!monthLabels[mKey]) {
        monthLabels[mKey] = d.toLocaleDateString('pl-PL', { month: 'short' });
      }
      d.setDate(d.getDate() + 1);
    }

    // Render month labels
    const uniqueMonths = Object.values(monthLabels);
    // show every 2nd month to avoid crowding
    uniqueMonths.filter((_, i) => i % 2 === 0).forEach(m => {
      const span = document.createElement('span');
      span.className = 'heatmap-month-label';
      span.textContent = m;
      monthsEl.appendChild(span);
    });
  }

  function pluralDni(n) {
    if (n === 1) return 'dzień';
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'dni';
    return 'dni';
  }

  /* ─────────────────────────────────────────
     ALL QUOTES VIEW
  ───────────────────────────────────────── */
  function renderAll() {
    renderFilterChips();
    renderQuoteList();
  }

  function renderFilterChips() {
    const container = document.getElementById('filter-chips');
    const tags = [...new Set(state.quotes.map(q => q.fields['Tag']).filter(Boolean))];

    const chips = [
      { id: 'all',    label: 'Wszystkie' },
      { id: 'due',    label: 'Na dziś' },
      { id: 'lv1',    label: 'Poziom 1' },
      { id: 'lv2',    label: 'Poziom 2' },
      { id: 'lv3',    label: 'Poziom 3' },
      ...tags.map(t => ({ id: 'tag:' + t, label: t })),
    ];

    container.innerHTML = chips.map(c => `
      <div class="chip ${state.filterLevel === c.id ? 'active' : ''}" data-filter="${c.id}">${c.label}</div>
    `).join('');

    container.querySelectorAll('.chip').forEach(el => {
      el.addEventListener('click', () => {
        state.filterLevel = el.dataset.filter;
        renderAll();
      });
    });
  }

  function renderQuoteList() {
    const container = document.getElementById('quotes-list');
    const q = state.searchQuery.toLowerCase();
    const filter = state.filterLevel;

    let quotes = state.quotes.filter(quote => {
      const f = quote.fields;
      // Search
      if (q && !`${f['Cytat']} ${f['Autor']}`.toLowerCase().includes(q)) return false;
      // Filter
      if (filter === 'due') return isDue(quote);
      if (filter === 'lv1') return getLevel(quote) === 1;
      if (filter === 'lv2') return getLevel(quote) === 2;
      if (filter === 'lv3') return getLevel(quote) === 3;
      if (filter.startsWith('tag:')) return f['Tag'] === filter.slice(4);
      return true;
    });

    if (quotes.length === 0) {
      container.innerHTML = '<div style="padding:32px 16px; text-align:center; color:var(--w4); font-size:12px;">Brak cytatów</div>';
      return;
    }

    container.innerHTML = quotes.map(q => {
      const f = q.fields;
      const lv = getLevel(q);
      const text = (f['Cytat'] || '').substring(0, 120);
      return `
        <div class="quote-card" data-id="${q.id}">
          <div class="quote-card__header">
            <span class="quote-card__author">${f['Autor'] || '—'}</span>
            <span class="level-dot level-dot--lv${lv}"></span>
          </div>
          <p class="quote-card__text">${text}${f['Cytat']?.length > 120 ? '…' : ''}</p>
          ${f['Tag'] ? `<div class="quote-card__meta">${f['Tag']}</div>` : ''}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.quote-card').forEach(el => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
    });
  }

  /* ─────────────────────────────────────────
     DETAIL OVERLAY
  ───────────────────────────────────────── */
  function openDetail(id) {
    const quote = state.quotes.find(q => q.id === id);
    if (!quote) return;
    const f = quote.fields;
    const lv = getLevel(quote);

    setText('detail-author', f['Autor'] || '');
    const srcEl = document.getElementById('detail-source');
    srcEl.textContent = f['Źródło'] || '';
    srcEl.href = f['URL'] || '#';
    document.getElementById('detail-quote').textContent = f['Cytat'] || '';
    document.getElementById('detail-tag').textContent = f['Tag'] || '';
    document.getElementById('detail-tag').style.display = f['Tag'] ? '' : 'none';
    document.getElementById('detail-comment').textContent = f['Komentarz'] || '';

    const dot = document.getElementById('detail-level-dot');
    dot.className = `level-dot level-dot--lv${lv}`;
    setText('detail-level-label', `Poziom ${lv} — ${SRS[lv].label}`);

    const next = f['Następna powtórka'];
    setText('detail-next', next ? `Następna powtórka: ${formatDate(next)}` : 'Do powtórki dzisiaj');

    // History
    const histRows = state.history
      .filter(h => h.fields['Cytat']?.includes(id))
      .sort((a, b) => b.fields['Data']?.localeCompare(a.fields['Data'] || '') || 0)
      .slice(0, 10);

    const histLabels = { 1: 'Nie pamiętałem', 2: 'Z trudem', 3: 'Zapamiętałem' };
    document.getElementById('detail-history-list').innerHTML = histRows.length
      ? histRows.map(h => `
          <div class="history-row">
            <span class="history-row__date">${formatDate(h.fields['Data'])}</span>
            <span class="history-badge history-badge--${h.fields['Ocena']}">${histLabels[h.fields['Ocena']] || ''}</span>
          </div>
        `).join('')
      : '<div style="font-size:11px;color:var(--w4);padding:8px 0;">Brak historii</div>';

    document.getElementById('detail-history').style.display = histRows.length ? '' : 'none';

    // Edit button
    document.getElementById('btn-edit-detail').onclick = () => { closeOverlay('detail'); openForm(id); };

    openOverlay('detail');
  }

  /* ─────────────────────────────────────────
     FORM OVERLAY (add / edit)
  ───────────────────────────────────────── */
  function openForm(editId = null) {
    state.editingQuoteId = editId;
    document.getElementById('form-title').textContent = editId ? 'Edytuj cytat' : 'Nowy cytat';

    if (editId) {
      const q = state.quotes.find(x => x.id === editId);
      const f = q?.fields || {};
      document.getElementById('f-quote').value   = f['Cytat']    || '';
      document.getElementById('f-author').value  = f['Autor']    || '';
      document.getElementById('f-source').value  = f['Źródło']   || '';
      document.getElementById('f-url').value     = f['URL']      || '';
      document.getElementById('f-tag').value     = f['Tag']      || '';
      document.getElementById('f-comment').value = f['Komentarz']|| '';
    } else {
      ['f-quote','f-author','f-source','f-url','f-tag','f-comment'].forEach(id => {
        document.getElementById(id).value = '';
      });
    }

    document.getElementById('form-error').textContent = '';

    // Tag suggestions
    const tags = [...new Set(state.quotes.map(q => q.fields['Tag']).filter(Boolean))];
    const sug = document.getElementById('tag-suggestions');
    sug.innerHTML = tags.map(t => `<div class="chip" data-tag="${t}">${t}</div>`).join('');
    sug.querySelectorAll('.chip').forEach(el => {
      el.addEventListener('click', () => { document.getElementById('f-tag').value = el.dataset.tag; });
    });

    openOverlay('form');
  }

  async function saveQuote() {
    const quote   = document.getElementById('f-quote').value.trim();
    const author  = document.getElementById('f-author').value.trim();
    const source  = document.getElementById('f-source').value.trim();
    const url     = document.getElementById('f-url').value.trim();
    const tag     = document.getElementById('f-tag').value.trim();
    const comment = document.getElementById('f-comment').value.trim();

    if (!quote || !author) {
      document.getElementById('form-error').textContent = 'Cytat i Autor są wymagane.';
      return;
    }

    const btn = document.getElementById('btn-save-quote');
    btn.disabled = true;
    btn.textContent = 'Zapisuję…';

    try {
      const fields = {
        'Cytat': quote,
        'Autor': author,
        'Źródło': source || undefined,
        'URL': url || undefined,
        'Tag': tag || undefined,
        'Komentarz': comment || undefined,
        'Poziom': state.editingQuoteId
          ? undefined // keep existing level
          : 1,
        'Następna powtórka': state.editingQuoteId
          ? undefined
          : today(),
      };
      // Remove undefined keys
      Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k]);

      if (state.editingQuoteId) {
        const updated = await AT.updateRecord('Cytaty', state.editingQuoteId, fields);
        const idx = state.quotes.findIndex(q => q.id === state.editingQuoteId);
        if (idx >= 0) state.quotes[idx] = updated;
      } else {
        const created = await AT.createRecord('Cytaty', fields);
        state.quotes.push(created);
      }

      buildTodayQueue();
      Storage.set('quotes_cache', state.quotes);
      closeOverlay('form');
      renderAll();
      showToast(state.editingQuoteId ? 'Cytat zaktualizowany' : 'Cytat dodany');
    } catch (err) {
      document.getElementById('form-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Zapisz do Airtable';
    }
  }

  /* ─────────────────────────────────────────
     SETTINGS VIEW
  ───────────────────────────────────────── */
  function renderSettings() {
    const s = state.settings;
    document.getElementById('s-base-id').value = s.baseId || '';
    document.getElementById('s-token').value   = s.token  || '';
    document.getElementById('s-claude').value  = s.claudeKey || '';
    document.getElementById('notif-time').value = s.notifTime || '08:00';
    document.getElementById('notif-toggle').checked = s.notifEnabled || false;
  }

  function saveSettings() {
    state.settings = {
      ...state.settings,
      baseId:      document.getElementById('s-base-id').value.trim(),
      token:       document.getElementById('s-token').value.trim(),
      claudeKey:   document.getElementById('s-claude').value.trim(),
      notifTime:   document.getElementById('notif-time').value,
      notifEnabled: document.getElementById('notif-toggle').checked,
    };
    Storage.set('settings', state.settings);
    if (state.settings.notifEnabled) requestNotifPermission();
    showToast('Ustawienia zapisane');
  }

  async function testConnection() {
    const btn = document.getElementById('btn-test');
    const status = document.getElementById('test-status');
    btn.disabled = true;
    status.textContent = 'Łączę…';
    status.className = 'settings__status';

    const saved = { ...state.settings };
    state.settings = {
      ...saved,
      baseId: parseBaseId(document.getElementById('s-base-id').value.trim()),
      token:  document.getElementById('s-token').value.trim(),
    };

    try {
      await AT.testConnection((step) => { status.textContent = step; });
      status.textContent = '✓ Połączenie działa';
      status.className = 'settings__status success';
    } catch (err) {
      status.textContent = '✗ ' + err.message;
      status.className = 'settings__status error';
    } finally {
      state.settings = saved;
      btn.disabled = false;
    }
  }

  /* ─────────────────────────────────────────
     NOTIFICATIONS
  ───────────────────────────────────────── */
  async function requestNotifPermission() {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') scheduleNotification();
  }

  function scheduleNotification() {
    if (!('serviceWorker' in navigator)) return;
    const time = state.settings.notifTime || '08:00';
    const [h, m] = time.split(':').map(Number);
    const now = new Date();
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const delay = target - now;

    setTimeout(() => {
      const due = state.quotes.filter(isDue);
      if (due.length === 0) return;
      const q = due[0].fields;
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          author: q['Autor'] || '',
          quote: (q['Cytat'] || '').substring(0, 100),
          source: q['Źródło'] || '',
        });
      } else if (Notification.permission === 'granted') {
        new Notification(q['Autor'] || 'Cytat', {
          body: (q['Cytat'] || '').substring(0, 80) + '…',
          icon: 'icons/app/icon-192.png',
        });
      }
    }, delay);
  }

  /* ─────────────────────────────────────────
     ROUTER / NAVIGATION
  ───────────────────────────────────────── */
  function navigate(view) {
    state.currentView = view;

    // Hide all main views
    document.querySelectorAll('.view--main').forEach(el => el.classList.remove('view--active'));
    // Show target
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.add('view--active');

    // Update nav
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === view);
    });

    // Show/hide nav
    document.getElementById('nav-bar').classList.toggle('nav-bar--hidden', false);

    // Render view-specific content
    if (view === 'today') showReadPhase();
    if (view === 'progress') renderProgress();
    if (view === 'all') renderAll();
    if (view === 'settings') renderSettings();
  }

  function openOverlay(name) {
    const el = document.getElementById(`overlay-${name}`);
    if (!el) return;
    el.style.display = 'flex';
    requestAnimationFrame(() => el.classList.add('overlay--active'));
    document.getElementById('nav-bar').classList.add('nav-bar--hidden');
  }

  function closeOverlay(name) {
    const el = document.getElementById(`overlay-${name}`);
    if (!el) return;
    el.classList.remove('overlay--active');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    document.getElementById('nav-bar').classList.remove('nav-bar--hidden');
  }

  /* ─────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────── */
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function showToast(msg, duration = 2500) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('toast--visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('toast--visible'), duration);
  }

  /* ─────────────────────────────────────────
     ONBOARDING
  ───────────────────────────────────────── */
  async function handleOnboardingSubmit() {
    const baseId    = document.getElementById('ob-base-id').value.trim();
    const token     = document.getElementById('ob-token').value.trim();
    const claudeKey = document.getElementById('ob-claude').value.trim();
    const status    = document.getElementById('ob-status');
    const btn       = document.getElementById('ob-submit');

    if (!baseId || !token || !claudeKey) {
      status.textContent = 'Wypełnij wszystkie pola';
      status.className = 'onboarding__status error';
      return;
    }

    status.textContent = 'Łączę…';
    status.className = 'onboarding__status';
    btn.disabled = true;

    const parsedBaseId = parseBaseId(baseId);
    console.log('[Onboarding] baseId input:', baseId, '→ parsed:', parsedBaseId);
    state.settings = { baseId: parsedBaseId, token: token.trim(), claudeKey: claudeKey.trim(), notifTime: '08:00', notifEnabled: false };

    try {
      await AT.testConnection((step) => { status.textContent = step; });
      Storage.set('settings', state.settings);
      Storage.set('onboarded', true);
      await initApp();
    } catch (err) {
      console.error('[Onboarding] error:', err);
      status.textContent = '✗ ' + err.message;
      status.className = 'onboarding__status error';
      btn.disabled = false;
    }
  }

  /* ─────────────────────────────────────────
     INIT
  ───────────────────────────────────────── */
  async function initApp() {
    // Hide onboarding
    document.getElementById('view-onboarding').classList.remove('view--active');
    document.getElementById('nav-bar').style.display = '';

    // Show loading state
    setPhase('analyzing');
    document.getElementById('view-today').classList.add('view--active');
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === 'today');
    });

    try {
      // Try cache first for speed
      const cachedQuotes = Storage.get('quotes_cache');
      const cachedHistory = Storage.get('history_cache');
      if (cachedQuotes) {
        state.quotes = cachedQuotes;
        state.history = cachedHistory || [];
        buildTodayQueue();
        showReadPhase();
        // Refresh in background
        loadData().then(() => { if (state.currentView === 'today') showReadPhase(); });
      } else {
        await loadData();
        showReadPhase();
      }

      if (state.settings.notifEnabled) scheduleNotification();
    } catch (err) {
      showToast('Błąd ładowania danych: ' + err.message);
      setPhase('empty');
    }
  }

  async function boot() {
    const settings = Storage.get('settings');
    const onboarded = Storage.get('onboarded');

    if (!onboarded || !settings?.baseId || !settings?.token) {
      // Show onboarding
      document.getElementById('view-onboarding').classList.add('view--active');
      document.getElementById('nav-bar').style.display = 'none';
      return;
    }

    state.settings = settings;
    await initApp();
  }

  /* ─────────────────────────────────────────
     EVENT LISTENERS
  ───────────────────────────────────────── */
  function bindEvents() {
    // Nav tabs
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.nav));
    });

    // Today — voice flow
    document.getElementById('btn-record').addEventListener('click', handleRecord);
    document.getElementById('btn-stop').addEventListener('click', handleStop);
    document.getElementById('btn-next').addEventListener('click', handleNext);
    document.getElementById('btn-postpone').addEventListener('click', handlePostpone);

    // All — search
    document.getElementById('search-input').addEventListener('input', e => {
      state.searchQuery = e.target.value;
      renderQuoteList();
    });

    // All — add quote
    document.getElementById('btn-add').addEventListener('click', () => openForm());

    // Form — save
    document.getElementById('btn-save-quote').addEventListener('click', saveQuote);

    // Settings
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-test').addEventListener('click', testConnection);

    // Onboarding
    document.getElementById('ob-submit').addEventListener('click', handleOnboardingSubmit);

    // iOS install hint
    document.getElementById('btn-ios-install').addEventListener('click', () => {
      showToast('Stuknij "Udostępnij" → "Dodaj do ekranu głównego"', 4000);
    });

    // Service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(console.error);
    }
  }

  /* ─────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────── */
  return {
    navigate,
    openOverlay,
    closeOverlay,
    init() {
      bindEvents();
      boot();
    },
  };

})();

document.addEventListener('DOMContentLoaded', () => App.init());
