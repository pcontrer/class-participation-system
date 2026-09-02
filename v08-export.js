(() => {
  const safeFile = s => String(s || 'course').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'course';
  const dt = iso => iso ? new Date(iso).toLocaleString() : '';
  const d = iso => iso ? new Date(iso).toLocaleDateString() : '';
  const elapsed = (session, event) => {
    const a = Date.parse(session?.startedAt || ''), b = Date.parse(event?.occurredAt || '');
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
    const sec = Math.max(0, Math.round((b - a) / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };
  function addSheet(wb, name, rows) {
    const data = rows.length ? rows : [{ Information: 'No data available' }];
    const ws = XLSX.utils.json_to_sheet(data);
    const keys = Object.keys(data[0] || {});
    ws['!cols'] = keys.map(k => ({ wch: Math.min(44, Math.max(12, ...data.slice(0, 300).map(r => String(r[k] ?? '').length + 2), k.length + 2)) }));
    if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }

  async function exportCourseExcelV08(courseId) {
    if (typeof XLSX === 'undefined') return alert('Excel export library is unavailable.');
    const course = await get('courses', courseId);
    if (!course) return;
    const [sessionsAll, studentsAll, eventsAll, attendanceAll, notesAll] = await Promise.all([all('sessions'), all('students'), all('events'), all('attendance'), all('notes')]);
    const sessions = sessionsAll.filter(s => s.courseId === courseId && s.status === 'ended').sort((a,b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    const sessionIds = new Set(sessions.map(s => s.id));
    const students = studentsAll.filter(s => s.courseId === courseId);
    const studentById = new Map(students.map(s => [s.id, s]));
    const sessionById = new Map(sessions.map(s => [s.id, s]));
    const events = eventsAll.filter(e => sessionIds.has(e.sessionId) && !e.deletedAt).sort((a,b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
    const attendance = attendanceAll.filter(a => sessionIds.has(a.sessionId));

    const interventionRows = events.map(e => {
      const s = sessionById.get(e.sessionId), st = studentById.get(e.studentId);
      return {
        'Session ID': e.sessionId,
        'Session': s?.title || '',
        'Session date': d(s?.startedAt),
        'Session start': dt(s?.startedAt),
        'Time in session': elapsed(s, e),
        'Intervention timestamp': dt(e.occurredAt),
        'Student ID': st?.externalId || '',
        'First name': st?.firstName || '',
        'Surname': st?.lastName || '',
        'Quality': e.quality || 'standard',
        'Strong': e.quality === 'strong' ? 1 : 0,
        'Limited': e.quality === 'limited' ? 1 : 0,
        'Source': e.source || ''
      };
    });

    const attendanceRows = attendance.map(a => {
      const s = sessionById.get(a.sessionId), st = studentById.get(a.studentId);
      return {
        'Session ID': a.sessionId,
        'Session': s?.title || '',
        'Session date': d(s?.startedAt),
        'Student ID': st?.externalId || '',
        'First name': st?.firstName || '',
        'Surname': st?.lastName || '',
        'Exception': a.status || '',
        'Justification': a.justification || '',
        'Recorded at': dt(a.recordedAt)
      };
    });

    const auditRows = sessions.flatMap(s => (s.auditHistory || []).map(x => ({
      'Session ID': s.id,
      'Session': s.title || '',
      'Session date': d(s.startedAt),
      'Audit ID': x.id || '',
      'Action': x.action || 'edit',
      'Field modified': x.field || '',
      'Previous value': typeof x.previousValue === 'string' ? x.previousValue : JSON.stringify(x.previousValue ?? null),
      'New value': typeof x.newValue === 'string' ? x.newValue : JSON.stringify(x.newValue ?? null),
      'Edited at': dt(x.editedAt),
      'Owner': x.owner_id || s.owner_id || ''
    })));

    const sessionRows = sessions.map(s => ({
      'Session ID': s.id,
      'Session': s.title || '',
      'Date': d(s.startedAt),
      'Start': dt(s.startedAt),
      'End': dt(s.endedAt),
      'Last modified': dt(s.updatedAt),
      'Owner': s.owner_id || '',
      'Interventions': events.filter(e => e.sessionId === s.id).length,
      'Attendance exceptions': attendance.filter(a => a.sessionId === s.id).length,
      'Post-close edits': (s.auditHistory || []).length
    }));

    const notesRows = notes.filter(n => n.courseId === courseId).map(n => {
      const st = studentById.get(n.studentId), s = sessionById.get(n.sessionId);
      return {
        'Student ID': st?.externalId || '', 'First name': st?.firstName || '', 'Surname': st?.lastName || '',
        'Session': s?.title || '', 'Observation': n.body || '', 'Created at': dt(n.createdAt)
      };
    });

    const wb = XLSX.utils.book_new();
    addSheet(wb, 'Sessions', sessionRows);
    addSheet(wb, 'Interventions', interventionRows);
    addSheet(wb, 'Attendance Exceptions', attendanceRows);
    addSheet(wb, 'Edit History', auditRows);
    addSheet(wb, 'Professor Notes', notesRows);
    XLSX.writeFile(wb, `${safeFile(course.name)}-participation-v08-${new Date().toISOString().slice(0,10)}.xlsx`, { compression: true });
    toast('Complete v0.8 Excel report exported');
  }

  window.exportCourseExcel = exportCourseExcelV08;
  const enhance = () => {
    if (!state?.courseId || !['course','analytics'].includes(state.view)) return;
    const toolbar = document.querySelector('.stack > .card .toolbar');
    if (!toolbar || toolbar.querySelector('#exportCourseExcel')) return;
    const b = document.createElement('button');
    b.id = 'exportCourseExcel'; b.className = state.view === 'analytics' ? 'btn primary' : 'btn'; b.textContent = 'Export complete Excel';
    b.onclick = () => exportCourseExcelV08(state.courseId);
    toolbar.prepend(b);
  };
  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  enhance();
})();
