(() => {
  const PHOTO_DB = 'class-participation-photos-v1';
  const STORE = 'photos';
  const objectUrls = new Map();
  let photoDbPromise;

  function openPhotoDB() {
    if (photoDbPromise) return photoDbPromise;
    photoDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(PHOTO_DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'studentId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return photoDbPromise;
  }

  async function photoGet(studentId) {
    const d = await openPhotoDB();
    return new Promise((resolve, reject) => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(studentId);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }

  async function photoPut(record) {
    const d = await openPhotoDB();
    return new Promise((resolve, reject) => {
      const r = d.transaction(STORE, 'readwrite').objectStore(STORE).put(record);
      r.onsuccess = () => resolve(record);
      r.onerror = () => reject(r.error);
    });
  }

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function stem(fileName) {
    return String(fileName || '').split('/').pop().replace(/\.(jpe?g|png|webp|gif|heic|heif)$/i, '');
  }

  function studentKeys(student) {
    const emailLocal = String(student.email || '').split('@')[0];
    return new Set([
      normalize(emailLocal),
      normalize(student.externalId),
      normalize(`${student.firstName || ''}${student.lastName || ''}`),
      normalize(`${student.lastName || ''}${student.firstName || ''}`),
      normalize(`${student.firstName || ''}_${student.lastName || ''}`)
    ].filter(Boolean));
  }

  async function imageEntriesFromSelection(fileList) {
    const selected = [...fileList];
    const out = [];
    for (const file of selected) {
      if (/\.zip$/i.test(file.name)) {
        if (typeof JSZip === 'undefined') throw new Error('ZIP support is unavailable. Reload while online and try again.');
        const zip = await JSZip.loadAsync(file);
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !/\.(jpe?g|png|webp|gif)$/i.test(entry.name)) continue;
          const blob = await entry.async('blob');
          out.push({ name: entry.name, blob });
        }
      } else if (/^image\//i.test(file.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) {
        out.push({ name: file.name, blob: file });
      }
    }
    return out;
  }

  async function importPhotos(files) {
    if (!window.state?.courseId || typeof getCourseStudents !== 'function') throw new Error('Open a course before importing photos.');
    const students = await getCourseStudents(state.courseId);
    if (!students.length) throw new Error('Import a roster before importing student photos.');

    const entries = await imageEntriesFromSelection(files);
    if (!entries.length) throw new Error('No supported image files were found.');

    const keyMap = new Map();
    students.forEach(s => studentKeys(s).forEach(k => {
      if (!keyMap.has(k)) keyMap.set(k, []);
      keyMap.get(k).push(s);
    }));

    let matched = 0;
    const unmatched = [];
    const ambiguous = [];

    for (const entry of entries) {
      const key = normalize(stem(entry.name));
      const candidates = keyMap.get(key) || [];
      if (candidates.length === 1) {
        const student = candidates[0];
        await photoPut({
          studentId: student.id,
          courseId: student.courseId,
          rosterId: student.rosterId || null,
          fileName: entry.name.split('/').pop(),
          blob: entry.blob,
          updatedAt: new Date().toISOString()
        });
        const old = objectUrls.get(student.id);
        if (old) URL.revokeObjectURL(old);
        objectUrls.delete(student.id);
        matched++;
      } else if (candidates.length > 1) {
        ambiguous.push(entry.name);
      } else {
        unmatched.push(entry.name);
      }
    }

    await applyLocalPhotos();
    const details = [];
    if (unmatched.length) details.push(`${unmatched.length} unmatched`);
    if (ambiguous.length) details.push(`${ambiguous.length} ambiguous`);
    const suffix = details.length ? ` (${details.join(', ')})` : '';
    if (typeof toast === 'function') toast(`${matched} student photos imported${suffix}`);
    else alert(`${matched} student photos imported${suffix}`);

    if (unmatched.length || ambiguous.length) {
      const lines = [
        `Imported: ${matched}/${entries.length}`,
        unmatched.length ? `\nUnmatched:\n${unmatched.slice(0, 20).join('\n')}` : '',
        ambiguous.length ? `\nAmbiguous:\n${ambiguous.slice(0, 20).join('\n')}` : '',
        '\nMatching uses, in order, the image filename stem against the student email local-part, Student ID, or normalized full name.'
      ].filter(Boolean);
      alert(lines.join('\n'));
    }
  }

  async function localPhotoUrl(studentId) {
    if (objectUrls.has(studentId)) return objectUrls.get(studentId);
    const rec = await photoGet(studentId);
    if (!rec?.blob) return '';
    const url = URL.createObjectURL(rec.blob);
    objectUrls.set(studentId, url);
    return url;
  }

  async function applyLocalPhotos() {
    const cards = [...document.querySelectorAll('.student[data-student]')];
    await Promise.all(cards.map(async card => {
      const studentId = card.dataset.student;
      const avatar = card.querySelector('.avatar');
      if (!avatar) return;
      const url = await localPhotoUrl(studentId);
      if (!url) return; // Existing Photo URL or initials remain untouched.
      let img = avatar.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        avatar.replaceChildren(img);
      }
      if (img.src !== url) img.src = url;
      card.dataset.photoSource = 'local';
    }));
  }

  function enhanceRosterControls() {
    if (!window.state?.courseId || document.querySelector('#studentPhotoFiles')) return;
    const rosterInput = document.querySelector('#rosterFile');
    if (!rosterInput) return;
    const toolbar = rosterInput.closest('.toolbar');
    if (!toolbar) return;

    const label = document.createElement('label');
    label.className = 'btn';
    label.textContent = 'Import photos';
    label.title = 'Import JPG/PNG/WebP images or a ZIP. Files are stored privately in this browser and matched to the active roster.';

    const input = document.createElement('input');
    input.id = 'studentPhotoFiles';
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif,.zip';
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', async () => {
      if (!input.files?.length) return;
      label.classList.add('primary');
      const original = label.firstChild?.textContent || 'Import photos';
      label.firstChild.textContent = 'Importing…';
      try {
        await importPhotos(input.files);
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        label.classList.remove('primary');
        label.firstChild.textContent = original;
        input.value = '';
      }
    });
    label.appendChild(input);
    toolbar.appendChild(label);

    const note = document.createElement('div');
    note.className = 'muted small local-photo-note';
    note.textContent = 'Photos: optional. Use Photo URL in the roster, or import local image files/ZIP. Local photos stay on this device; imported files take precedence over Photo URL.';
    const card = toolbar.closest('.card');
    if (card) card.appendChild(note);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(async () => {
      scheduled = false;
      enhanceRosterControls();
      await applyLocalPhotos();
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  enhanceRosterControls();
  applyLocalPhotos();

  window.StudentPhotoStorage = { importPhotos, applyLocalPhotos, localPhotoUrl };
})();
