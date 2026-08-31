(() => {
  let enhancing = false;

  const safeFile = s => String(s || 'course')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'course';

  const localDate = iso => iso ? new Date(iso).toLocaleDateString() : '';
  const localDateTime = iso => iso ? new Date(iso).toLocaleString() : '';

  function autosize(ws, rows, max = 36) {
    if (!rows?.length) return;
    const keys = Object.keys(rows[0] || {});
    ws['!cols'] = keys.map(k => {
      let len = String(k).length;
      for (const r of rows.slice(0, 250)) len = Math.max(len, String(r[k] ?? '').length);
      return { wch: Math.min(max, Math.max(10, len + 2)) };
    });
    if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
  }

  function addSheet(wb, name, rows) {
    const data = rows?.length ? rows : [{ Information: 'No data available' }];
    const ws = XLSX.utils.json_to_sheet(data);
    autosize(ws, data);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }

  async function exportCourseExcel(courseId) {
    if (typeof XLSX === 'undefined') {
      alert('Excel export library is unavailable. Reload the application with an internet connection and try again.');
      return;
    }

    const course = await get('courses', courseId);
    if (!course) return alert('Course not found.');

    const [sessionsAll, studentsAll, rostersAll, eventsAll, attendanceAll, notesAll, gradesAll] = await Promise.all([
      all('sessions'), all('students'), all('rosters'), all('events'), all('attendance'), all('notes'), all('grades')
    ]);

    const sessions = sessionsAll
      .filter(s => s.courseId === courseId && s.status === 'ended')
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    const sessionIds = new Set(sessions.map(s => s.id));
    const students = studentsAll.filter(s => s.courseId === courseId);
    const rosters = rostersAll.filter(r => r.courseId === courseId);
    const rosterById = new Map(rosters.map(r => [r.id, r]));
    const studentById = new Map(students.map(s => [s.id, s]));
    const events = eventsAll.filter(e => sessionIds.has(e.sessionId) && !e.deletedAt);
    const attendance = attendanceAll.filter(a => sessionIds.has(a.sessionId));
    const notes = notesAll.filter(n => n.courseId === courseId);
    const grades = gradesAll.filter(g => g.courseId === courseId);

    const eventsBySession = new Map();
    for (const e of events) {
      if (!eventsBySession.has(e.sessionId)) eventsBySession.set(e.sessionId, []);
      eventsBySession.get(e.sessionId).push(e);
    }
    const absentBySession = new Map();
    for (const a of attendance.filter(a => a.status === 'absent')) {
      if (!absentBySession.has(a.sessionId)) absentBySession.set(a.sessionId, new Set());
      absentBySession.get(a.sessionId).add(a.studentId);
    }

    const activeRoster = rosterById.get(course.activeRosterId);
    const activeStudents = students.filter(s => !course.activeRosterId || s.rosterId === course.activeRosterId);

    const summaryRows = [
      { Metric: 'Course', Value: course.name || '' },
      { Metric: 'Course code', Value: course.code || '' },
      { Metric: 'Participation weight (%)', Value: course.participationWeight ?? '' },
      { Metric: 'Active roster', Value: activeRoster?.name || '' },
      { Metric: 'Students in active roster', Value: activeStudents.length },
      { Metric: 'Completed sessions', Value: sessions.length },
      { Metric: 'Total participation events', Value: events.length },
      { Metric: 'Strong contributions', Value: events.filter(e => e.quality === 'strong').length },
      { Metric: 'Limited contributions', Value: events.filter(e => e.quality === 'limited').length },
      { Metric: 'Report generated', Value: new Date().toLocaleString() },
    ];

    const sessionRows = sessions.map((s, i) => {
      const ev = eventsBySession.get(s.id) || [];
      const speakers = new Set(ev.map(e => e.studentId));
      const abs = absentBySession.get(s.id) || new Set();
      return {
        'Session #': i + 1,
        'Session title': s.title || `Session ${i + 1}`,
        'Date': localDate(s.startedAt),
        'Start': localDateTime(s.startedAt),
        'End': localDateTime(s.endedAt),
        'Roster': s.rosterNameSnapshot || rosterById.get(s.rosterIdSnapshot)?.name || '',
        'Layout': s.layoutNameSnapshot || '',
        'Contributions': ev.length,
        'Students participating': speakers.size,
        'Strong': ev.filter(e => e.quality === 'strong').length,
        'Standard': ev.filter(e => !e.quality || e.quality === 'standard').length,
        'Limited': ev.filter(e => e.quality === 'limited').length,
        'Absent': abs.size,
      };
    });

    const sessionColumns = sessions.map((s, i) => ({ id: s.id, label: `${String(i + 1).padStart(2, '0')} ${s.title || 'Session'}` }));
    const activeStudentRows = activeStudents
      .slice()
      .sort((a, b) => String(a.lastName || '').localeCompare(String(b.lastName || '')) || String(a.firstName || '').localeCompare(String(b.firstName || '')))
      .map(st => {
        const row = {
          'Student ID': st.externalId || '',
          'First name': st.firstName || '',
          'Surname': st.lastName || '',
          'Email': st.email || '',
        };
        let total = 0, strong = 0, limited = 0, participatedSessions = 0, attendedSessions = 0;
        for (const sc of sessionColumns) {
          const session = sessions.find(s => s.id === sc.id);
          const belongs = !session?.rosterIdSnapshot || session.rosterIdSnapshot === st.rosterId;
          const absent = (absentBySession.get(sc.id) || new Set()).has(st.id);
          const ev = events.filter(e => e.sessionId === sc.id && e.studentId === st.id);
          row[sc.label] = belongs ? (absent ? 'ABS' : ev.length) : '';
          if (belongs && !absent) attendedSessions++;
          if (ev.length) participatedSessions++;
          total += ev.length;
          strong += ev.filter(e => e.quality === 'strong').length;
          limited += ev.filter(e => e.quality === 'limited').length;
        }
        row['Total'] = total;
        row['Strong'] = strong;
        row['Limited'] = limited;
        row['Sessions participated'] = participatedSessions;
        row['Sessions attended'] = attendedSessions;
        row['Coverage %'] = attendedSessions ? Math.round(participatedSessions / attendedSessions * 1000) / 10 : 0;
        const grade = grades.find(g => g.studentId === st.id);
        row['Final participation grade'] = grade?.professorGrade ?? '';
        return row;
      });

    const eventRows = events
      .slice()
      .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)))
      .map(e => {
        const s = sessions.find(x => x.id === e.sessionId);
        const st = studentById.get(e.studentId);
        return {
          'Session': s?.title || '',
          'Session date': localDate(s?.startedAt),
          'Timestamp': localDateTime(e.occurredAt),
          'Student ID': st?.externalId || '',
          'First name': st?.firstName || '',
          'Surname': st?.lastName || '',
          'Quality': e.quality || 'standard',
          'Source': e.source || '',
        };
      });

    const attendanceRows = [];
    for (const s of sessions) {
      const rosterId = s.rosterIdSnapshot || course.activeRosterId;
      const rosterStudents = students.filter(st => !rosterId || st.rosterId === rosterId);
      const abs = absentBySession.get(s.id) || new Set();
      for (const st of rosterStudents) {
        attendanceRows.push({
          'Session': s.title || '',
          'Date': localDate(s.startedAt),
          'Student ID': st.externalId || '',
          'First name': st.firstName || '',
          'Surname': st.lastName || '',
          'Attendance': abs.has(st.id) ? 'Absent' : 'Present',
        });
      }
    }

    const notesRows = notes.map(n => {
      const st = studentById.get(n.studentId);
      const s = sessions.find(x => x.id === n.sessionId);
      return {
        'Student ID': st?.externalId || '',
        'First name': st?.firstName || '',
        'Surname': st?.lastName || '',
        'Session': s?.title || '',
        'Note': n.body || '',
        'Created': localDateTime(n.createdAt),
      };
    });

    const wb = XLSX.utils.book_new();
    addSheet(wb, 'Course Summary', summaryRows);
    addSheet(wb, 'Sessions', sessionRows);
    addSheet(wb, 'Student x Session', activeStudentRows);
    addSheet(wb, 'Participation Events', eventRows);
    addSheet(wb, 'Attendance', attendanceRows);
    addSheet(wb, 'Professor Notes', notesRows);

    const dateTag = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `${safeFile(course.name)}-participation-report-${dateTag}.xlsx`, { compression: true });
    if (typeof toast === 'function') toast('Excel course report exported');
  }

  async function enhanceExcelReport() {
    if (enhancing || typeof state === 'undefined' || !state.courseId) return;
    enhancing = true;
    try {
      if (state.view === 'course') {
        const toolbar = document.querySelector('.stack > .card .toolbar');
        if (toolbar && !toolbar.querySelector('#exportCourseExcel')) {
          const btn = document.createElement('button');
          btn.id = 'exportCourseExcel';
          btn.className = 'btn';
          btn.textContent = 'Export Excel report';
          btn.addEventListener('click', () => exportCourseExcel(state.courseId));
          toolbar.insertBefore(btn, toolbar.querySelector('#deleteCourse') || null);
        }
      }
      if (state.view === 'analytics') {
        const toolbar = document.querySelector('.stack > .card .toolbar');
        if (toolbar && !toolbar.querySelector('#exportCourseExcel')) {
          const btn = document.createElement('button');
          btn.id = 'exportCourseExcel';
          btn.className = 'btn primary';
          btn.textContent = 'Export Excel report';
          btn.addEventListener('click', () => exportCourseExcel(state.courseId));
          toolbar.prepend(btn);
        }
      }
    } finally {
      enhancing = false;
    }
  }

  window.exportCourseExcel = exportCourseExcel;
  const observer = new MutationObserver(() => enhanceExcelReport());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceExcelReport, { once: true });
  else enhanceExcelReport();
})();
