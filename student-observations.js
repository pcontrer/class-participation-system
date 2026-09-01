(() => {
  const CATEGORIES = ['General', 'Positive', 'Concern', 'Behaviour', 'Academic', 'Follow-up'];
  let enhancing = false;
  let overlay = null;
  let currentStudentId = null;
  let editingNoteId = null;

  const e = s => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
  const catClass = c => `obs-cat-${String(c || 'General').toLowerCase().replace(/[^a-z]+/g, '-')}`;

  function closeObservationModal() {
    overlay?.remove();
    overlay = null;
    currentStudentId = null;
    editingNoteId = null;
  }

  async function observationHistory(studentId) {
    return (await all('notes'))
      .filter(n => n.studentId === studentId && n.courseId === state.courseId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  async function renderObservationModal(studentId, noteId = null) {
    const student = await get('students', studentId);
    if (!student) return;
    const sess = state.sessionId ? await get('sessions', state.sessionId) : null;
    const notes = await observationHistory(studentId);
    const editing = noteId ? notes.find(n => n.id === noteId) : null;
    currentStudentId = studentId;
    editingNoteId = editing?.id || null;

    closeObservationModal();
    currentStudentId = studentId;
    editingNoteId = editing?.id || null;

    overlay = document.createElement('div');
    overlay.className = 'modalback observation-overlay';
    overlay.id = 'observationOverlay';
    overlay.innerHTML = `
      <div class="modal observation-modal">
        <div class="row">
          <div>
            <h2>${e(fullName(student))}</h2>
            <div class="muted small">${sess ? `${e(sess.title)} · ${new Date(sess.startedAt).toLocaleString()}` : 'Course observation'}</div>
          </div>
          <button class="btn" id="closeObservation">Close</button>
        </div>

        <div class="observation-form">
          <label>Category
            <select class="input" id="observationCategory">
              ${CATEGORIES.map(c => `<option value="${c}" ${(editing?.category || 'General') === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
          <label>Observation
            <textarea class="input observation-text" id="observationText" rows="4" placeholder="Record only information relevant to teaching, participation or classroom conduct.">${e(editing?.body || '')}</textarea>
          </label>
          <label class="obs-check"><input type="checkbox" id="observationFollowUp" ${(editing?.followUp || editing?.category === 'Follow-up') ? 'checked' : ''}> Follow-up required</label>
          <div class="row">
            <div class="muted small">This is qualitative evidence. It does not change the participation score automatically.</div>
            <button class="btn primary" id="saveObservation">${editing ? 'Update observation' : 'Save observation'}</button>
          </div>
        </div>

        <div class="obs-history-head"><h3>Observation history</h3><span class="badge">${notes.length}</span></div>
        <div class="observation-history">
          ${notes.length ? notes.map(n => {
            const sessionLabel = n.sessionId ? 'Session-linked' : 'Course note';
            return `<div class="observation-item ${n.followUp && !n.resolved ? 'followup-open' : ''}" data-note-id="${n.id}">
              <div class="row">
                <div class="obs-meta">
                  <span class="obs-category ${catClass(n.category)}">${e(n.category || 'General')}</span>
                  <span class="muted small">${e(sessionLabel)} · ${n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</span>
                  ${n.followUp ? `<span class="badge">${n.resolved ? 'Follow-up resolved' : 'Follow-up pending'}</span>` : ''}
                </div>
                <div class="toolbar">
                  ${n.followUp && !n.resolved ? `<button class="btn obsResolve" data-id="${n.id}">Resolve</button>` : ''}
                  <button class="btn obsEdit" data-id="${n.id}">Edit</button>
                  <button class="btn danger obsDelete" data-id="${n.id}">Delete</button>
                </div>
              </div>
              <div class="observation-body">${e(n.body || '')}</div>
            </div>`;
          }).join('') : '<div class="muted">No observations yet.</div>'}
        </div>
      </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => document.querySelector('#observationText')?.focus());

    document.querySelector('#closeObservation')?.addEventListener('click', closeObservationModal);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) closeObservationModal(); });

    document.querySelector('#saveObservation')?.addEventListener('click', async () => {
      const body = document.querySelector('#observationText')?.value.trim();
      if (!body) return alert('Write an observation before saving.');
      const category = document.querySelector('#observationCategory')?.value || 'General';
      const followUp = !!document.querySelector('#observationFollowUp')?.checked || category === 'Follow-up';
      const existing = editingNoteId ? await get('notes', editingNoteId) : null;
      const note = existing || {
        id: uuid(),
        courseId: state.courseId,
        studentId,
        sessionId: state.sessionId || null,
        createdAt: nowISO(),
        source: state.sessionId ? 'live-class' : 'course',
      };
      note.body = body;
      note.category = category;
      note.followUp = followUp;
      note.updatedAt = nowISO();
      if (!followUp) {
        note.resolved = false;
        note.resolvedAt = null;
      }
      await put('notes', note);
      if (typeof toast === 'function') toast(editingNoteId ? 'Observation updated' : 'Observation saved');
      await renderObservationModal(studentId);
      await refreshObservationMarkers();
    });

    overlay.querySelectorAll('.obsEdit').forEach(btn => btn.addEventListener('click', () => renderObservationModal(studentId, btn.dataset.id)));
    overlay.querySelectorAll('.obsDelete').forEach(btn => btn.addEventListener('click', async () => {
      const note = await get('notes', btn.dataset.id);
      if (!note) return;
      if (!confirm('Delete this observation permanently?')) return;
      await del('notes', note.id);
      if (typeof toast === 'function') toast('Observation deleted');
      await renderObservationModal(studentId);
      await refreshObservationMarkers();
    }));
    overlay.querySelectorAll('.obsResolve').forEach(btn => btn.addEventListener('click', async () => {
      const note = await get('notes', btn.dataset.id);
      if (!note) return;
      note.resolved = true;
      note.resolvedAt = nowISO();
      note.updatedAt = nowISO();
      await put('notes', note);
      if (typeof toast === 'function') toast('Follow-up resolved');
      await renderObservationModal(studentId);
      await refreshObservationMarkers();
    }));
  }

  async function refreshObservationMarkers() {
    if (typeof state === 'undefined' || state.view !== 'session' || !state.sessionId) return;
    const notes = (await all('notes')).filter(n => n.sessionId === state.sessionId && n.courseId === state.courseId);
    const byStudent = new Map();
    for (const n of notes) {
      if (!byStudent.has(n.studentId)) byStudent.set(n.studentId, []);
      byStudent.get(n.studentId).push(n);
    }

    for (const card of document.querySelectorAll('.student')) {
      if (card.querySelector('.obs-trigger')) continue;
      const studentId = card.dataset.student;
      const studentNotes = byStudent.get(studentId) || [];
      const pending = studentNotes.some(n => n.followUp && !n.resolved);
      const trigger = document.createElement('span');
      trigger.className = `obs-trigger ${studentNotes.length ? 'has-observation' : ''} ${pending ? 'has-followup' : ''}`;
      trigger.textContent = studentNotes.length ? `NOTE${studentNotes.length > 1 ? ` ${studentNotes.length}` : ''}` : '+ NOTE';
      trigger.title = studentNotes.length ? 'View or add observations' : 'Add observation';
      trigger.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); });
      trigger.addEventListener('pointerup', ev => { ev.preventDefault(); ev.stopPropagation(); });
      trigger.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        renderObservationModal(studentId);
      });
      card.appendChild(trigger);
    }
  }

  async function enhanceFollowUps() {
    if (typeof state === 'undefined' || state.view !== 'course' || !state.courseId) return;
    const stack = document.querySelector('.stack');
    if (!stack || stack.querySelector('#followUpCard')) return;
    const notes = (await all('notes')).filter(n => n.courseId === state.courseId && n.followUp && !n.resolved);
    if (!notes.length) return;
    const students = await all('students');
    const studentMap = new Map(students.map(s => [s.id, s]));

    const card = document.createElement('div');
    card.id = 'followUpCard';
    card.className = 'card followup-card';
    card.innerHTML = `<div class="row"><div><h3 class="sectiontitle">Follow-up required</h3><div class="muted small">Open observations that you marked for later action.</div></div><span class="badge">${notes.length}</span></div>
      <div class="followup-list">${notes.slice(0, 20).map(n => {
        const st = studentMap.get(n.studentId);
        return `<div class="followup-row"><div><strong>${e(st ? fullName(st) : 'Student')}</strong><div class="muted small">${e(n.category || 'General')} · ${e(n.body || '')}</div></div><button class="btn openObservation" data-student="${n.studentId}">Open</button></div>`;
      }).join('')}</div>`;
    const first = stack.firstElementChild;
    if (first?.nextSibling) stack.insertBefore(card, first.nextSibling); else stack.appendChild(card);
    card.querySelectorAll('.openObservation').forEach(btn => btn.addEventListener('click', () => renderObservationModal(btn.dataset.student)));
  }

  async function enhance() {
    if (enhancing || typeof state === 'undefined') return;
    enhancing = true;
    try {
      await refreshObservationMarkers();
      await enhanceFollowUps();
    } finally {
      enhancing = false;
    }
  }

  window.openStudentObservation = renderObservationModal;

  const observer = new MutationObserver(() => enhance());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance, { once: true });
  else enhance();
})();
