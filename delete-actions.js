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
