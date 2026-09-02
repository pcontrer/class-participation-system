(() => {
  const CACHE_DB = 'class-participation-photo-cache-v2';
  const CACHE_STORE = 'photos';
  const objectUrls = new Map();
  let cacheDbPromise;
  let unlockedPassphrase = null;

  function openCacheDB() {
    if (cacheDbPromise) return cacheDbPromise;
    cacheDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(CACHE_DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(CACHE_STORE)) d.createObjectStore(CACHE_STORE, { keyPath: 'studentId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return cacheDbPromise;
  }

  async function cacheGet(studentId) {
    const d = await openCacheDB();
    return new Promise((resolve, reject) => {
      const r = d.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(studentId);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }

  async function cachePut(record) {
    const d = await openCacheDB();
    return new Promise((resolve, reject) => {
      const r = d.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).put(record);
      r.onsuccess = () => resolve(record);
      r.onerror = () => reject(r.error);
    });
  }

  function bytesToB64(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(s);
  }

  function b64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function deriveKey(passphrase, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptBlob(blob, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const plain = new Uint8Array(await blob.arrayBuffer());
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    return { v: 1, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(cipher) };
  }

  async function decryptEnvelope(envelope, passphrase, mime = 'image/jpeg') {
    const salt = b64ToBytes(envelope.salt);
    const iv = b64ToBytes(envelope.iv);
    const cipher = b64ToBytes(envelope.data);
    const key = await deriveKey(passphrase, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new Blob([plain], { type: mime });
  }

  async function optimizeImage(blob) {
    if (!blob.type.startsWith('image/')) return blob;
    try {
      const bmp = await createImageBitmap(blob);
      const max = 360;
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      const out = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      return out || blob;
    } catch {
      return blob;
    }
  }

  function accessKey() {
    return localStorage.getItem('class-participation-access-key') || '';
  }

  function passphrase() {
    if (unlockedPassphrase) return unlockedPassphrase;
    const p = prompt('Enter the private photo passphrase for this device. It is never sent to the server and is not stored after this page is closed.');
    if (!p || p.length < 12) throw new Error('Photo passphrase must contain at least 12 characters.');
    unlockedPassphrase = p;
    return p;
  }

  async function vaultKey(studentId) {
    const courseId = window.state?.courseId || '';
    return sha256Hex(`photo-v1|${courseId}|${studentId}`);
  }

  async function vaultRequest(method, studentId, body = null) {
    const key = accessKey();
    if (!key) throw new Error('Cloud access key required. Connect cloud first.');
    const k = await vaultKey(studentId);
    const r = await fetch(`/api/photos?k=${encodeURIComponent(k)}`, {
      method,
      headers: { 'X-App-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    if (r.status === 404) return null;
    if (r.status === 401) throw new Error('Invalid cloud access key.');
    if (!r.ok) throw new Error(`Photo vault request failed (${r.status}).`);
    return method === 'GET' ? r.json() : r.json().catch(() => ({}));
  }

  async function uploadEncrypted(studentId, blob) {
    const optimized = await optimizeImage(blob);
    const envelope = await encryptBlob(optimized, passphrase());
    await vaultRequest('PUT', studentId, envelope);
    await cachePut({ studentId, blob: optimized, updatedAt: new Date().toISOString(), source: 'vault' });
    const old = objectUrls.get(studentId);
    if (old) URL.revokeObjectURL(old);
    objectUrls.delete(studentId);
  }

  async function downloadEncrypted(studentId) {
    const cached = await cacheGet(studentId);
    if (cached?.blob) return cached.blob;
    const envelope = await vaultRequest('GET', studentId);
    if (!envelope) return null;
    let blob;
    try {
      blob = await decryptEnvelope(envelope, passphrase(), 'image/jpeg');
    } catch {
      throw new Error('Unable to decrypt student photos. Check that the same private photo passphrase is being used on this device.');
    }
    await cachePut({ studentId, blob, updatedAt: new Date().toISOString(), source: 'vault' });
    return blob;
  }

  async function vaultPhotoUrl(studentId) {
    if (objectUrls.has(studentId)) return objectUrls.get(studentId);
    const blob = await downloadEncrypted(studentId);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    objectUrls.set(studentId, url);
    return url;
  }

  async function applyVaultPhotos() {
    const cards = [...document.querySelectorAll('.student[data-student]')];
    await Promise.all(cards.map(async card => {
      const id = card.dataset.student;
      const avatar = card.querySelector('.avatar');
      if (!avatar) return;
      let url = '';
      try { url = await vaultPhotoUrl(id); } catch (e) { return; }
      if (!url) return;
      let img = avatar.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        avatar.replaceChildren(img);
      }
      img.src = url;
      card.dataset.photoSource = 'encrypted-vault';
    }));
  }

  async function migrateLocalPhotosToVault() {
    if (!window.StudentPhotoStorage || typeof getCourseStudents !== 'function') return alert('Local photo storage is unavailable.');
    const students = await getCourseStudents(state.courseId);
    let uploaded = 0;
    for (const s of students) {
      const rec = await (async () => {
        try {
          const dbReq = indexedDB.open('class-participation-photos-v1');
          const d = await new Promise((resolve, reject) => { dbReq.onsuccess = () => resolve(dbReq.result); dbReq.onerror = () => reject(dbReq.error); });
          if (!d.objectStoreNames.contains('photos')) return null;
          return new Promise((resolve, reject) => {
            const r = d.transaction('photos', 'readonly').objectStore('photos').get(s.id);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
          });
        } catch { return null; }
      })();
      if (rec?.blob) {
        await uploadEncrypted(s.id, rec.blob);
        uploaded++;
      }
    }
    alert(`${uploaded} local student photos uploaded to the encrypted private vault.`);
    await applyVaultPhotos();
  }

  function enhanceControls() {
    if (!window.state?.courseId || document.querySelector('#photoVaultSync')) return;
    const rosterInput = document.querySelector('#rosterFile');
    if (!rosterInput) return;
    const toolbar = rosterInput.closest('.toolbar');
    if (!toolbar) return;

    const sync = document.createElement('button');
    sync.type = 'button';
    sync.id = 'photoVaultSync';
    sync.className = 'btn';
    sync.textContent = 'Sync private photos';
    sync.title = 'Encrypt local photos in this browser and upload only ciphertext to the private Netlify vault.';
    sync.addEventListener('click', async () => {
      try { await migrateLocalPhotosToVault(); } catch (e) { alert(e.message || String(e)); }
    });

    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'btn ghost';
    lock.textContent = 'Lock photos';
    lock.title = 'Forget the photo decryption passphrase on this device until entered again.';
    lock.addEventListener('click', () => {
      unlockedPassphrase = null;
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      objectUrls.clear();
      if (typeof render === 'function') render();
    });

    toolbar.append(sync, lock);

    const note = document.createElement('div');
    note.className = 'muted small';
    note.style.marginTop = '6px';
    note.textContent = 'Private photo vault: photos are resized locally, metadata is discarded by re-encoding, then encrypted in your browser with AES-256-GCM before upload. The photo passphrase never leaves the device and is not stored persistently.';
    toolbar.closest('.card')?.appendChild(note);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(async () => {
      scheduled = false;
      enhanceControls();
      await applyVaultPhotos();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  enhanceControls();
  applyVaultPhotos();

  window.StudentPhotoVault = { applyVaultPhotos, uploadEncrypted, vaultPhotoUrl, lock: () => { unlockedPassphrase = null; } };
})();
