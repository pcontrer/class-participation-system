(() => {
  const originalShell = shell;
  shell = function v08Shell(content) {
    let html = originalShell(content);
    if (window.CPS_FEATURES?.evidenceAssistedGrading === false) {
      html = html.replace(/<button class="btn" data-nav="grading">Grading<\/button>/, '');
    }
    html = html.replace('<button class="btn" id="syncNow">Sync now</button>', '<button class="btn" id="syncNow">Sync now</button><button class="btn" id="syncDiagnostics">Diagnostics</button>');
    return html;
  };

  const baseRender = render;
  render = async function v08Render() {
    if (state.view === 'diagnostics') {
      const logs = (window.getSyncDiagnosticsV08?.() || []).slice().reverse();
      const rows = logs.map(x => `<tr><td>${esc(new Date(x.at).toLocaleString())}</td><td>${esc(x.type || '')}</td><td>${esc((x.uploadedSessions || []).join(', '))}</td><td>${esc((x.downloadedSessions || []).join(', '))}</td><td>${esc(JSON.stringify(x.conflictsResolved || []))}</td></tr>`).join('');
      $('#app').innerHTML = shell(`<div class="stack"><div class="card"><div class="row"><div><h2>Synchronization diagnostics</h2><div class="muted">Local technical log for v0.8 session-scoped synchronization.</div></div><button class="btn" id="clearDiagnostics">Clear log</button></div></div><div class="card tablewrap"><table class="table"><thead><tr><th>Time</th><th>Event</th><th>Sessions uploaded</th><th>Sessions downloaded</th><th>Conflicts resolved</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No synchronization events recorded yet.</td></tr>'}</tbody></table></div></div>`);
      bind();
      bindExtras();
      return;
    }
    await baseRender();
    bindExtras();
  };

  function bindExtras() {
    const d = $('#syncDiagnostics');
    if (d) d.onclick = () => { state.view = 'diagnostics'; render(); };
    const c = $('#clearDiagnostics');
    if (c) c.onclick = () => { window.clearSyncDiagnosticsV08?.(); render(); };
  }

  const originalBind = bind;
  bind = function v08Bind() {
    originalBind();
    bindExtras();
    const a = $('#attendanceMode');
    if (a) {
      a.onclick = async () => {
        const { students, absent } = await sessionData();
        const name = prompt('Type surname/name to toggle absence');
        if (!name) return;
        const s = students.find(x => (`${x.lastName} ${x.firstName}`).toLowerCase().includes(name.toLowerCase()));
        if (!s) return alert('Student not found');
        const id = state.sessionId + '_' + s.id;
        if (absent.has(s.id)) await del('attendance', id);
        else {
          const justification = prompt('Absence justification (optional)', '') ?? '';
          await put('attendance', { id, sessionId: state.sessionId, studentId: s.id, status: 'absent', justification: justification.trim(), recordedAt: nowISO() });
        }
        render();
      };
    }
  };

  viewGrading = async function v08ViewGrading() {
    return `<div class="stack"><div class="card"><h2>Participation grading</h2><div class="hint"><strong>Evidence-assisted grading is disabled in v0.8.</strong> Final grading remains a manual academic judgment based on the exported participation record.</div></div></div>`;
  };

  setTimeout(async () => {
    try { await window.ensureV08DataModel?.(); }
    catch (e) { console.error('v0.8 data migration failed', e); }
  }, 0);
})();
