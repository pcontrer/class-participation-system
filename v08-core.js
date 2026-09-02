(() => {
  const OWNER_ID = 'personal';
  const SESSION_STORES = new Set(['sessions', 'events', 'attendance', 'transcriptSegments']);
  const OWNED_STORES = new Set(['courses', 'rosters', 'sessions']);
  const DIAG_KEY = 'class-participation-sync-diagnostics-v08';
  window.CPS_VERSION = '0.8.0';
  window.CPS_FEATURES = Object.freeze({ evidenceAssistedGrading: false });
  window.CPS_OWNER_ID = OWNER_ID;

  const iso = () => new Date().toISOString();
  const parseTime = value => {
    const t = Date.parse(value || '');
    return Number.isFinite(t) ? t : 0;
  };
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const compactValue = value => {
    if (value == null) return value;
    if (typeof value !== 'object') return value;
    const text = JSON.stringify(value);
    return text.length <= 1600 ? value : `${text.slice(0, 1550)}…`;
  };

  function appendDiagnostic(entry) {
    try {
      const list = JSON.parse(localStorage.getItem(DIAG_KEY) || '[]');
      list.push({ at: iso(), ...entry });
      localStorage.setItem(DIAG_KEY, JSON.stringify(list.slice(-200)));
    } catch (_) {}
  }
  window.getSyncDiagnosticsV08 = () => {
    try { return JSON.parse(localStorage.getItem(DIAG_KEY) || '[]'); }
    catch (_) { return []; }
  };
  window.clearSyncDiagnosticsV08 = () => localStorage.removeItem(DIAG_KEY);

  function auditEntry(field, previousValue, newValue, action = 'edit') {
    return {
      id: crypto.randomUUID(),
      action,
      field,
      previousValue: compactValue(clone(previousValue)),
      newValue: compactValue(clone(newValue)),
      editedAt: iso(),
      owner_id: OWNER_ID
    };
  }

  function diffClosedSession(before, after) {
    if (!before || before.status !== 'ended') return [];
    const ignored = new Set(['updatedAt', 'auditHistory', 'owner_id']);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const out = [];
    for (const key of keys) {
      if (ignored.has(key)) continue;
      const a = JSON.stringify(before[key] ?? null);
      const b = JSON.stringify(after[key] ?? null);
      if (a !== b) out.push(auditEntry(key, before[key] ?? null, after[key] ?? null));
    }
    return out;
  }

  async function sessionIdFor(store, id, payload) {
    if (store === 'sessions') return payload?.id || id;
    if (payload?.sessionId) return payload.sessionId;
    if (!SESSION_STORES.has(store)) return null;
    try { return (await get(store, id))?.sessionId || null; }
    catch (_) { return null; }
  }

  async function queueMutation(store, op, id, payload, sessionId = null, sessionUpdatedAt = null) {
    if (applyingRemote || !SYNC_STORES.includes(store)) return;
    await rawPut('syncQueue', {
      qid: crypto.randomUUID(), store, op, id, payload,
      clientAt: iso(), owner_id: OWNER_ID,
      scope_session_id: sessionId,
      session_updated_at: sessionUpdatedAt
    });
    scheduleSync();
  }

  async function writeTouchedSession(sessionId, childAudit = null) {
    if (!sessionId) return null;
    const sess = await get('sessions', sessionId);
    if (!sess) return null;
    const stamp = iso();
    sess.owner_id = sess.owner_id || OWNER_ID;
    sess.updatedAt = stamp;
    sess.auditHistory = Array.isArray(sess.auditHistory) ? sess.auditHistory : [];
    if (sess.status === 'ended' && childAudit) sess.auditHistory = [...sess.auditHistory, childAudit];
    await rawPut('sessions', sess);
    await queueMutation('sessions', 'put', sess.id, sess, sess.id, stamp);
    return stamp;
  }

  put = async function v08Put(store, object) {
    const value = { ...object };
    if (OWNED_STORES.has(store)) value.owner_id = value.owner_id || OWNER_ID;

    if (store === 'sessions') {
      const before = await get('sessions', value.id);
      value.auditHistory = Array.isArray(before?.auditHistory) ? [...before.auditHistory] : (Array.isArray(value.auditHistory) ? [...value.auditHistory] : []);
      const changes = diffClosedSession(before, value);
      if (changes.length) value.auditHistory.push(...changes);
      value.updatedAt = iso();
      const out = await rawPut(store, value);
      await queueMutation(store, 'put', value.id, value, value.id, value.updatedAt);
      return out;
    }

    if (SESSION_STORES.has(store)) {
      const sessionId = await sessionIdFor(store, value.id, value);
      let childAudit = null;
      if (sessionId) {
        const sess = await get('sessions', sessionId);
        if (sess?.status === 'ended') {
          const before = await get(store, value.id);
          childAudit = auditEntry(
            `${store}:${before ? 'update' : 'add'}`,
            before || null,
            value,
            before ? 'update-child-record' : 'add-child-record'
          );
        }
      }
      const sessionUpdatedAt = await writeTouchedSession(sessionId, childAudit);
      const out = await rawPut(store, value);
      await queueMutation(store, 'put', value.id, value, sessionId, sessionUpdatedAt);
      return out;
    }

    const out = await rawPut(store, value);
    await queueMutation(store, 'put', value.id, value, null, null);
    return out;
  };

  del = async function v08Del(store, id) {
    const before = await get(store, id);
    const sessionId = await sessionIdFor(store, id, before);
    let sessionUpdatedAt = null;
    if (sessionId) {
      const sess = await get('sessions', sessionId);
      const childAudit = sess?.status === 'ended'
        ? auditEntry(`${store}:remove`, before || null, null, 'remove-child-record')
        : null;
      sessionUpdatedAt = await writeTouchedSession(sessionId, childAudit);
    }
    await rawDel(store, id);
    await queueMutation(store, 'delete', id, null, sessionId, sessionUpdatedAt);
  };

  enqueueSync = queueMutation;

  function mutationFromQueue(q) {
    return {
      store: q.store,
      op: q.op,
      id: q.id,
      payload: q.payload,
      client_at: q.clientAt || iso(),
      owner_id: OWNER_ID,
      scope_session_id: q.scope_session_id || (q.store === 'sessions' ? q.id : q.payload?.sessionId || null),
      session_updated_at: q.session_updated_at || (q.store === 'sessions' ? q.payload?.updatedAt : null)
    };
  }

  async function snapshotMutationsV08() {
    const out = [];
    for (const store of SYNC_STORES) {
      for (const item of await all(store)) {
        let sessionId = null;
        let sessionUpdatedAt = null;
        if (store === 'sessions') {
          sessionId = item.id;
          sessionUpdatedAt = item.updatedAt || item.endedAt || item.startedAt || iso();
        } else if (item.sessionId) {
          sessionId = item.sessionId;
          const sess = await get('sessions', sessionId);
          sessionUpdatedAt = sess?.updatedAt || sess?.endedAt || sess?.startedAt || null;
        }
        out.push({
          store, op: 'put', id: item.id, payload: item,
          client_at: item.updatedAt || item.createdAt || iso(), owner_id: OWNER_ID,
          scope_session_id: sessionId, session_updated_at: sessionUpdatedAt
        });
      }
    }
    return out;
  }

  applyRemoteRecords = async function v08ApplyRemoteRecords(records) {
    const bySession = new Map();
    const unscoped = [];
    for (const rec of records || []) {
      if (!SYNC_STORES.includes(rec.entity_type)) continue;
      const sid = rec.scope_session_id || (rec.entity_type === 'sessions' ? rec.entity_id : rec.payload?.sessionId || null);
      if (!sid) unscoped.push(rec);
      else {
        if (!bySession.has(sid)) bySession.set(sid, []);
        bySession.get(sid).push(rec);
      }
    }

    const downloadedSessions = [];
    const ignoredSessions = [];
    applyingRemote = true;
    try {
      for (const [sid, group] of bySession) {
        const localSession = await get('sessions', sid);
        const remoteSessionRecord = group.find(r => r.entity_type === 'sessions' && r.entity_id === sid && !r.deleted);
        const remoteStamp = remoteSessionRecord?.payload?.updatedAt || group.map(r => r.session_updated_at || r.client_updated_at).sort().at(-1) || '';
        const localStamp = localSession?.updatedAt || localSession?.endedAt || localSession?.startedAt || '';
        if (localSession && parseTime(localStamp) > parseTime(remoteStamp)) {
          ignoredSessions.push(sid);
          continue;
        }
        if (!localSession || parseTime(remoteStamp) > parseTime(localStamp)) downloadedSessions.push(sid);
        for (const rec of group) {
          if (rec.deleted) await rawDel(rec.entity_type, rec.entity_id);
          else if (rec.payload) await rawPut(rec.entity_type, rec.payload);
        }
      }
      for (const rec of unscoped) {
        if (rec.deleted) await rawDel(rec.entity_type, rec.entity_id);
        else if (rec.payload) await rawPut(rec.entity_type, rec.payload);
      }
    } finally {
      applyingRemote = false;
    }
    return { downloadedSessions, ignoredSessions };
  };

  syncNow = async function v08SyncNow(showToast = false) {
    if (!navigator.onLine) { state.syncStatus = 'offline'; render(); return; }
    if (!accessKey()) { state.syncStatus = 'locked'; render(); return; }
    state.syncStatus = 'syncing'; render();
    try {
      const q = await all('syncQueue');
      const remote = await cloudRequest('GET');
      let mutations = q.map(mutationFromQueue);
      if ((remote.records || []).length === 0) {
        const snapshot = await snapshotMutationsV08();
        const keyed = new Map(snapshot.map(m => [`${m.store}:${m.id}`, m]));
        for (const m of mutations) keyed.set(`${m.store}:${m.id}`, m);
        mutations = [...keyed.values()];
      }
      const uploadedSessions = [...new Set(mutations.map(m => m.scope_session_id).filter(Boolean))];
      const data = mutations.length ? await cloudRequest('POST', { mutations }) : remote;
      for (const item of q) await rawDel('syncQueue', item.qid);
      const applied = await applyRemoteRecords(data.records || []);
      appendDiagnostic({
        type: 'sync',
        uploadedSessions,
        downloadedSessions: applied.downloadedSessions,
        conflictsResolved: data.conflicts || [],
        ignoredLocalNewerSessions: applied.ignoredSessions,
        uploadedRecords: mutations.length,
        remoteRecords: (data.records || []).length
      });
      state.syncStatus = 'synced';
      if (showToast) toast(`Cloud sync complete${(data.conflicts || []).length ? ` · ${(data.conflicts || []).length} conflict(s) resolved` : ''}`);
      else render();
    } catch (e) {
      appendDiagnostic({ type: 'sync-error', message: e.message || String(e) });
      state.syncStatus = e.code === 401 ? 'locked' : 'error';
      render();
      if (showToast) alert(e.message);
    }
  };

  window.ensureV08DataModel = async function ensureV08DataModel() {
    for (const store of ['courses', 'rosters', 'sessions']) {
      for (const item of await all(store)) {
        let changed = false;
        if (!item.owner_id) { item.owner_id = OWNER_ID; changed = true; }
        if (store === 'sessions') {
          if (!item.updatedAt) { item.updatedAt = item.endedAt || item.startedAt || iso(); changed = true; }
          if (!Array.isArray(item.auditHistory)) { item.auditHistory = []; changed = true; }
        }
        if (changed) await rawPut(store, item);
      }
    }
  };
})();
