(() => {
  const SOURCE = 'participation-import';
  const VERSION = 1;
  let enhancing = false;
  let importDraft = null;

  const norm = value => String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const normId = value => String(value ?? '').trim().replace(/\.0$/, '');
  const normEmail = value => String(value ?? '').trim().toLowerCase();
  const nhead = value => norm(value).replace(/\s+/g, '_');
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const qualityLabel = score => score >= 4 ? 'strong' : score <= 2 ? 'limited' : 'standard';

  function detectColumns(headers) {
    const by = new Map(headers.map(h => [nhead(h), h]));
    const find = (...names) => {
      for (const name of names) if (by.has(name)) return by.get(name);
      return '';
    };
    return {
      externalId: find('student_id','studentid','id','id_alumno','student_number'),
      email: find('email','e_mail','username','correo'),
      firstName: find('first_name','firstname','nombre','given_name'),
      lastName: find('last_name','lastname','surname','apellidos','apellido','family_name'),
      interventions: find('interventions','substantive_interventions','contributions','participations','number_of_interventions','n_interventions'),
      qualityScore: find('quality_score','quality','score','quality_1_5','quality_score_1_5'),
      confidence: find('confidence','identification_confidence'),
      comment: find('comment','comments','assessment','main_contributions','notes','summary'),
      sessionTitle: find('session_title','session','class_title'),
      sessionStart: find('session_start','session_datetime','started_at','start'),
      sessionEnd: find('session_end','ended_at','end'),
      sessionDate: find('session_date','date','class_date')
    };
  }

  async function parseFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let headers, data;
    if (ext === 'csv') {
      const rows = csvParse(await file.text());
      if (!rows.length) throw new Error('The participation file is empty.');
      headers = rows.shift().map(x => String(x ?? '').trim());
      data = rows.filter(r => r.some(x => String(x ?? '').trim())).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
    } else if (['xlsx','xls'].includes(ext)) {
      if (typeof XLSX === 'undefined') throw new Error('Excel reader unavailable. Reload once with an internet connection.');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false, cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (!matrix.length) throw new Error('The participation workbook is empty.');
      headers = matrix.shift().map((x, i) => String(x || `Column ${i + 1}`).trim());
      data = matrix.filter(r => r.some(x => String(x ?? '').trim())).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
    } else {
      throw new Error('Use .xlsx, .xls or .csv.');
    }
    const map = detectColumns(headers);
    if (!map.interventions || !map.qualityScore) throw new Error('Required columns: Interventions and Quality Score. Add Student ID or exact First Name + Last Name for matching.');
    if (!map.externalId && !(map.firstName && map.lastName) && !map.email) throw new Error('Matching requires Student ID, email, or exact First Name + Last Name.');
    return { headers, data, map, fileName: file.name };
  }

  function rowValue(row, key, map) {
    return map[key] ? String(row[map[key]] ?? '').trim() : '';
  }

  function strictMatch(row, map, students) {
    const ext = normId(rowValue(row, 'externalId', map));
    if (ext) {
      const hits = students.filter(s => normId(s.externalId) === ext);
      if (hits.length === 1) return { student: hits[0], method: 'Student ID' };
      if (hits.length > 1) return { student: null, method: 'duplicate Student ID' };
    }
    const email = normEmail(rowValue(row, 'email', map));
    if (email) {
      const hits = students.filter(s => normEmail(s.email) === email);
      if (hits.length === 1) return { student: hits[0], method: 'email' };
      if (hits.length > 1) return { student: null, method: 'duplicate email' };
    }
    const first = norm(rowValue(row, 'firstName', map));
    const last = norm(rowValue(row, 'lastName', map));
    if (first && last) {
      const hits = students.filter(s => norm(s.firstName) === first && norm(s.lastName) === last);
      if (hits.length === 1) return { student: hits[0], method: 'exact name' };
      if (hits.length > 1) return { student: null, method: 'duplicate exact name' };
    }
    return { student: null, method: 'no exact match' };
  }

  function parseDateLike(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const d = new Date(`${raw}T12:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  async function resolveTargetSession(parsed, explicitSessionId = null) {
    if (explicitSessionId) {
      const sess = await get('sessions', explicitSessionId);
      if (!sess || sess.courseId !== state.courseId) throw new Error('Target session not found in this course.');
      return { session: sess, created: false };
    }
    const first = parsed.data[0] || {};
    const title = rowValue(first, 'sessionTitle', parsed.map);
    const startRaw = rowValue(first, 'sessionStart', parsed.map) || rowValue(first, 'sessionDate', parsed.map);
    const start = parseDateLike(startRaw);
    const sessions = (await all('sessions')).filter(s => s.courseId === state.courseId);
    let candidates = sessions;
    if (title) candidates = candidates.filter(s => norm(s.title) === norm(title));
    if (start) {
      const day = start.toISOString().slice(0, 10);
      candidates = candidates.filter(s => String(s.startedAt || '').slice(0, 10) === day);
    }
    if (candidates.length === 1) return { session: candidates[0], created: false };
    if (candidates.length > 1) throw new Error('More than one session matches this file. Open the correct completed session and import the file there.');
    if (!start) throw new Error('No unique target session. Import from inside an existing session, or include Session Start / Session Date in the file.');

    const course = await get('courses', state.courseId);
    const rosters = await all('rosters');
    const activeRoster = rosters.find(r => r.id === course.activeRosterId);
    const students = await getCourseStudents(state.courseId);
    const layout = course.activeLayoutId ? await get('layouts', course.activeLayoutId) : null;
    const positions = Array.isArray(layout?.positions) && layout.positions.length
      ? layout.positions
      : students.slice().sort((a,b)=>(a.seat??0)-(b.seat??0)).map((s,i)=>({ studentId:s.id, position:i }));
    const endRaw = rowValue(first, 'sessionEnd', parsed.map);
    const end = parseDateLike(endRaw) || new Date(start.getTime() + 75 * 60000);
    const sess = {
      id: uuid(), courseId: state.courseId,
      title: title || `Imported ${start.toLocaleDateString()}`,
      startedAt: start.toISOString(), endedAt: end.toISOString(), status: 'ended',
      rosterIdSnapshot: course.activeRosterId || null,
      rosterNameSnapshot: activeRoster?.name || '',
      layoutNameSnapshot: layout?.name || 'Imported roster order',
      layoutSnapshot: positions,
      panelOrderSnapshot: course.panelOrder || 'manual',
      importCreated: true
    };
    await put('sessions', sess);
    return { session: sess, created: true };
  }

  async function buildDraft(file, explicitSessionId = null) {
    const parsed = await parseFile(file);
    const { session, created } = await resolveTargetSession(parsed, explicitSessionId);
    const course = await get('courses', state.courseId);
    const studentsAll = await all('students');
    const students = session.rosterIdSnapshot
      ? studentsAll.filter(s => s.rosterId === session.rosterIdSnapshot)
      : studentsAll.filter(s => s.courseId === state.courseId && (!course.activeRosterId || s.rosterId === course.activeRosterId));
    const rows = parsed.data.map((row, index) => {
      const match = strictMatch(row, parsed.map, students);
      const interventions = Math.max(0, Math.round(Number(rowValue(row, 'interventions', parsed.map).replace(',', '.')) || 0));
      const qualityScore = clamp(Math.round(Number(rowValue(row, 'qualityScore', parsed.map).replace(',', '.')) || 0), 0, 5);
      const confidence = rowValue(row, 'confidence', parsed.map);
      const comment = rowValue(row, 'comment', parsed.map);
      const inputName = [rowValue(row, 'firstName', parsed.map), rowValue(row, 'lastName', parsed.map)].filter(Boolean).join(' ') || rowValue(row, 'email', parsed.map) || rowValue(row, 'externalId', parsed.map) || `Row ${index + 2}`;
      const valid = Boolean(match.student && interventions > 0 && qualityScore >= 1 && qualityScore <= 5);
      return { index, inputName, match, interventions, qualityScore, confidence, comment, valid };
    });
    return { fileName: file.name, parsed, session, created, rows };
  }

  function previewModal(draft) {
    const matched = draft.rows.filter(r => r.valid);
    const unmatched = draft.rows.filter(r => !r.valid);
    const total = matched.reduce((a, r) => a + r.interventions, 0);
    const rows = draft.rows.map(r => `<tr>
      <td>${esc(r.inputName)}</td>
      <td>${r.match.student ? esc(fullName(r.match.student)) : '<span style="font-weight:700">Unmatched</span>'}</td>
      <td>${esc(r.match.method)}</td>
      <td>${r.interventions || '—'}</td>
      <td>${r.qualityScore || '—'}</td>
      <td>${r.valid ? 'Ready' : 'Skipped'}</td>
    </tr>`).join('');
    state.modal = `<div class="modalback"><div class="modal wide">
      <div class="row"><div><h2>Import participation</h2><div class="muted small">${esc(draft.fileName)} → ${esc(draft.session.title)}</div></div><button class="btn" id="cancelParticipationImport">Cancel</button></div>
      <div class="hint"><strong>Strict matching:</strong> Student ID → email → exact first name + surname. Unmatched rows are skipped. Re-importing replaces only previous file-imported events in this session; manual taps are preserved.</div>
      <div class="stats" style="margin:10px 0"><div class="card stat"><strong>${matched.length}</strong><span>Matched students</span></div><div class="card stat"><strong>${unmatched.length}</strong><span>Skipped rows</span></div><div class="card stat"><strong>${total}</strong><span>Contributions</span></div></div>
      <div class="tablewrap"><table class="table"><thead><tr><th>Input</th><th>Roster match</th><th>Method</th><th>Interventions</th><th>Quality 1–5</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row" style="margin-top:12px"><div class="muted small">${draft.created ? 'A completed session will be kept for this import.' : 'Existing session selected.'}</div><button class="btn primary" id="confirmParticipationImport" ${matched.length ? '' : 'disabled'}>Import matched rows</button></div>
    </div></div>`;
    render();
  }

  async function confirmImport() {
    if (!importDraft) return;
    const draft = importDraft;
    const sessionId = draft.session.id;
    const existing = (await all('events')).filter(e => e.sessionId === sessionId && e.source === SOURCE && !e.deletedAt);
    for (const e of existing) await del('events', e.id);

    const batchId = uuid();
    const importedAt = nowISO();
    const base = new Date(draft.session.startedAt || importedAt).getTime();
    let seq = 0;
    for (const r of draft.rows.filter(x => x.valid)) {
      for (let i = 0; i < r.interventions; i++) {
        seq += 1;
        await put('events', {
          id: uuid(), sessionId, studentId: r.match.student.id,
          occurredAt: new Date(base + seq * 1000).toISOString(),
          quality: qualityLabel(r.qualityScore), qualityScore: r.qualityScore,
          confidence: r.confidence || 'Confirmed', comment: r.comment || '',
          source: SOURCE, importBatchId: batchId, importedAt,
          assessmentVersion: VERSION, deletedAt: null
        });
      }
    }
    const count = draft.rows.filter(x => x.valid).reduce((a, r) => a + r.interventions, 0);
    importDraft = null;
    state.modal = null;
    state.sessionId = sessionId;
    state.view = 'session';
    state.sessionEditAction = 'add';
    toast(`Imported ${count} contributions`);
    await render();
    setTimeout(enhance, 30);
  }

  async function startImport(file, explicitSessionId = null) {
    try {
      importDraft = await buildDraft(file, explicitSessionId);
      previewModal(importDraft);
    } catch (err) {
      importDraft = null;
      alert(err.message || String(err));
    }
  }

  function addHiddenInput(host, id, explicitSessionId = null) {
    if (document.getElementById(id)) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xls,.csv'; input.hidden = true; input.id = id;
    input.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) startImport(file, explicitSessionId);
      e.target.value = '';
    });
    host.appendChild(input);
  }

  async function addQualityBadges() {
    if (state.view !== 'session' || !state.sessionId) return;
    const events = (await all('events')).filter(e => e.sessionId === state.sessionId && e.source === SOURCE && !e.deletedAt && Number(e.qualityScore));
    const by = new Map();
    for (const e of events) if (!by.has(e.studentId)) by.set(e.studentId, e);
    for (const [studentId, e] of by) {
      const card = document.querySelector(`.student[data-student="${CSS.escape(studentId)}"]`);
      if (!card || card.querySelector('.import-quality-badge')) continue;
      const badge = document.createElement('span');
      badge.className = 'badge import-quality-badge';
      badge.textContent = `Q${e.qualityScore}`;
      badge.title = `Imported quality ${e.qualityScore}/5${e.confidence ? ` · ${e.confidence}` : ''}${e.comment ? ` · ${e.comment}` : ''}`;
      badge.style.cssText = 'position:absolute;right:6px;bottom:6px;font-size:11px;z-index:3';
      card.style.position = 'relative';
      card.appendChild(badge);
    }
  }

  async function addAnalyticsQuality() {
    if (state.view !== 'analytics') return;
    const table = document.querySelector('.tablewrap table.table');
    if (!table || table.dataset.qualityEnhanced === '1') return;
    const sessions = (await all('sessions')).filter(s => s.courseId === state.courseId && s.status === 'ended');
    const ids = new Set(sessions.map(s => s.id));
    const events = (await all('events')).filter(e => ids.has(e.sessionId) && e.source === SOURCE && !e.deletedAt && Number(e.qualityScore));
    const perStudentSession = new Map();
    for (const e of events) {
      const k = `${e.studentId}|${e.sessionId}`;
      if (!perStudentSession.has(k)) perStudentSession.set(k, e.qualityScore);
    }
    const values = new Map();
    for (const [k, q] of perStudentSession) {
      const studentId = k.split('|')[0];
      if (!values.has(studentId)) values.set(studentId, []);
      values.get(studentId).push(Number(q));
    }
    const head = table.querySelector('thead tr');
    const th = document.createElement('th'); th.textContent = 'Avg Q (1–5)';
    head.insertBefore(th, head.children[2] || null);
    for (const tr of table.querySelectorAll('tbody tr[data-id]')) {
      const qs = values.get(tr.dataset.id) || [];
      const td = document.createElement('td');
      td.textContent = qs.length ? (qs.reduce((a,b)=>a+b,0)/qs.length).toFixed(1) : '—';
      tr.insertBefore(td, tr.children[2] || null);
    }
    table.dataset.qualityEnhanced = '1';
  }

  async function enhance() {
    if (enhancing || typeof state === 'undefined') return;
    enhancing = true;
    try {
      if (state.view === 'session' && state.sessionId) {
        const sess = await get('sessions', state.sessionId);
        if (sess?.status === 'ended') {
          const toolbar = document.querySelector('.sessionbar .toolbar');
          if (toolbar && !document.getElementById('importParticipationSessionBtn')) {
            const btn = document.createElement('button');
            btn.className = 'btn primary'; btn.id = 'importParticipationSessionBtn'; btn.textContent = 'Import participation';
            addHiddenInput(toolbar, 'participationSessionFile', state.sessionId);
            btn.addEventListener('click', () => document.getElementById('participationSessionFile')?.click());
            toolbar.insertBefore(btn, toolbar.firstChild);
          }
        }
        await addQualityBadges();
      }
      if (state.view === 'course' && state.courseId) {
        const toolbar = document.querySelector('.stack > .card .toolbar');
        if (toolbar && !document.getElementById('importParticipationCourseBtn')) {
          const btn = document.createElement('button');
          btn.className = 'btn'; btn.id = 'importParticipationCourseBtn'; btn.textContent = 'Import participation file';
          addHiddenInput(toolbar, 'participationCourseFile', null);
          btn.addEventListener('click', () => document.getElementById('participationCourseFile')?.click());
          toolbar.insertBefore(btn, toolbar.firstChild);
        }
      }
      await addAnalyticsQuality();

      const confirm = document.getElementById('confirmParticipationImport');
      if (confirm && !confirm.dataset.bound) { confirm.dataset.bound = '1'; confirm.addEventListener('click', confirmImport); }
      const cancel = document.getElementById('cancelParticipationImport');
      if (cancel && !cancel.dataset.bound) {
        cancel.dataset.bound = '1'; cancel.addEventListener('click', async () => {
          if (importDraft?.created) {
            const evs = (await all('events')).filter(e => e.sessionId === importDraft.session.id);
            if (!evs.length) await del('sessions', importDraft.session.id);
          }
          importDraft = null; state.modal = null; render();
        });
      }
    } finally {
      enhancing = false;
    }
  }

  window.importParticipationFile = startImport;
  const observer = new MutationObserver(() => enhance());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance, { once: true });
  else enhance();
})();
