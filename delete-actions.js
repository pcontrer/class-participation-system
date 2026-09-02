(() => {
  let enhancing = false;

  async function deleteSessionCascade(sessionId) {
    const sess = await get('sessions', sessionId);
    if (!sess) return;

    const dependentStores = [
      ['events', x => x.sessionId === sessionId],
      ['attendance', x => x.sessionId === sessionId],
      ['transcriptSegments', x => x.sessionId === sessionId],
    ];

    for (const [store, predicate] of dependentStores) {
      const items = (await all(store)).filter(predicate);
      for (const item of items) await del(store, item.id);
    }

    await del('sessions', sessionId);
  }

  async function deleteCourseCascade(courseId) {
    const sessions = (await all('sessions')).filter(x => x.courseId === courseId);
    for (const sess of sessions) await deleteSessionCascade(sess.id);

    const directStores = [
      ['students', x => x.courseId === courseId],
      ['rosters', x => x.courseId === courseId],
      ['layouts', x => x.courseId === courseId],
      ['notes', x => x.courseId === courseId],
      ['grades', x => x.courseId === courseId],
    ];

    for (const [store, predicate] of directStores) {
      const items = (await all(store)).filter(predicate);
      for (const item of items) await del(store, item.id);
    }

    await del('courses', courseId);
  }

  async function deleteRosterCascade(rosterId) {
    const roster = await get('rosters', rosterId);
    if (!roster) return { deletedStudents: 0, deletedLayouts: 0 };

    const referencedSessions = (await all('sessions')).filter(s => s.rosterIdSnapshot === rosterId);
    if (referencedSessions.length) {
      const names = referencedSessions.slice(0, 5).map(s => s.title).join(', ');
      const more = referencedSessions.length > 5 ? ` and ${referencedSessions.length - 5} more` : '';
      throw new Error(`This roster cannot be deleted because ${referencedSessions.length} saved session(s) depend on it: ${names}${more}. Delete those sessions first if you really want to remove the roster.`);
    }

    const students = (await all('students')).filter(s => s.rosterId === rosterId);
    const studentIds = new Set(students.map(s => s.id));

    const notes = (await all('notes')).filter(n => studentIds.has(n.studentId));
    const grades = (await all('grades')).filter(g => studentIds.has(g.studentId));
    const layouts = (await all('layouts')).filter(l => l.rosterId === rosterId);

    for (const item of notes) await del('notes', item.id);
    for (const item of grades) await del('grades', item.id);
    for (const item of layouts) await del('layouts', item.id);
    for (const student of students) await del('students', student.id);
    await del('rosters', rosterId);

    return { deletedStudents: students.length, deletedLayouts: layouts.length };
  }

  async function enhanceDeleteActions() {
    if (enhancing || typeof state === 'undefined') return;
    enhancing = true;
    try {
      if (state.view === 'session' && state.sessionId) {
        const bar = document.querySelector('.sessionbar .toolbar');
        if (bar && !bar.querySelector('#deleteSession')) {
          const btn = document.createElement('button');
          btn.id = 'deleteSession';
          btn.className = 'btn danger';
          btn.textContent = 'Delete session';
          btn.addEventListener('click', async () => {
            const sess = await get('sessions', state.sessionId);
            if (!sess) return;
            const ok = confirm(`Delete "${sess.title}" permanently?\n\nThis will also delete all participation events, attendance records and Zoom transcript segments for this session.`);
            if (!ok) return;
            const id = sess.id;
            await deleteSessionCascade(id);
            state.sessionId = null;
            state.lastEventId = null;
            state.sessionEditAction = 'add';
            state.arrangeMode = false;
            state.view = 'course';
            toast('Session deleted');
          });
          bar.appendChild(btn);
        }
      }

      if (state.view === 'course' && state.courseId) {
        const firstCardToolbar = document.querySelector('.stack > .card .toolbar');
        if (firstCardToolbar && !firstCardToolbar.querySelector('#deleteCourse')) {
          const btn = document.createElement('button');
          btn.id = 'deleteCourse';
          btn.className = 'btn danger';
          btn.textContent = 'Delete course';
          btn.addEventListener('click', async () => {
            const course = await get('courses', state.courseId);
            if (!course) return;
            const typed = prompt(`Permanent deletion.\n\nThis will delete the course, all rosters, students, sessions, participation, attendance, layouts, notes, grades and Zoom data.\n\nType the exact course name to confirm:\n${course.name}`);
            if (typed === null) return;
            if (typed.trim() !== String(course.name || '').trim()) {
              alert('Course name does not match. Nothing was deleted.');
              return;
            }
            const id = course.id;
            await deleteCourseCascade(id);
            state.courseId = null;
            state.sessionId = null;
            state.lastEventId = null;
            state.view = 'courses';
            toast('Course deleted');
          });
          firstCardToolbar.appendChild(btn);
        }

        const activeRosterSelect = document.querySelector('#activeRoster');
        const rosterToolbar = activeRosterSelect?.closest('.toolbar');
        if (activeRosterSelect && rosterToolbar && !rosterToolbar.querySelector('#deleteRoster')) {
          const btn = document.createElement('button');
          btn.id = 'deleteRoster';
          btn.className = 'btn danger';
          btn.textContent = 'Delete roster';
          btn.disabled = !activeRosterSelect.value;
          btn.addEventListener('click', async () => {
            const rosterId = activeRosterSelect.value;
            if (!rosterId) return;
            const roster = await get('rosters', rosterId);
            if (!roster) return;

            const sessions = (await all('sessions')).filter(s => s.rosterIdSnapshot === rosterId);
            if (sessions.length) {
              alert(`This roster is used by ${sessions.length} saved session(s) and cannot be deleted without damaging historical participation data.\n\nDelete the dependent session(s) first, or keep this roster as historical data.`);
              return;
            }

            const students = (await all('students')).filter(s => s.rosterId === rosterId);
            const typed = prompt(`Permanent roster deletion.\n\nRoster: ${roster.name}\nStudents: ${students.length}\n\nThis will delete the roster, its students, roster-specific layouts, notes and grades. Historical sessions are protected and would block deletion.\n\nType the exact roster name to confirm:`);
            if (typed === null) return;
            if (typed.trim() !== String(roster.name || '').trim()) {
              alert('Roster name does not match. Nothing was deleted.');
              return;
            }

            try {
              await deleteRosterCascade(rosterId);
            } catch (err) {
              alert(err.message || String(err));
              return;
            }

            const course = await get('courses', state.courseId);
            const remaining = (await all('rosters')).filter(r => r.courseId === state.courseId).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            const next = remaining[0] || null;
            course.activeRosterId = next?.id || null;
            course.activeLayoutId = null;
            course.panelOrder = 'manual';
            await put('courses', course);
            if (next) await ensureDefaultLayout(course.id);
            toast(`Roster deleted${next ? ` · active roster: ${next.name}` : ''}`);
            render();
          });
          rosterToolbar.appendChild(btn);
        }
      }
    } finally {
      enhancing = false;
    }
  }

  const observer = new MutationObserver(() => enhanceDeleteActions());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceDeleteActions, { once: true });
  } else {
    enhanceDeleteActions();
  }
})();
