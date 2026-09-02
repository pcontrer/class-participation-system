(() => {
  const STORAGE_KEY = 'class-participation-roster-view';
  const VALID = new Set(['names', 'photos']);

  function getMode() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return VALID.has(saved) ? saved : 'photos';
  }

  function applyMode(mode) {
    const normalized = VALID.has(mode) ? mode : 'photos';
    document.documentElement.dataset.rosterView = normalized;
    localStorage.setItem(STORAGE_KEY, normalized);
    document.querySelectorAll('[data-roster-view]').forEach(button => {
      const active = button.dataset.rosterView === normalized;
      button.classList.toggle('primary', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function buildToggle() {
    const group = document.createElement('div');
    group.className = 'roster-view-toggle';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Student roster view');

    const label = document.createElement('span');
    label.className = 'roster-view-label';
    label.textContent = 'View';
    group.appendChild(label);

    const names = document.createElement('button');
    names.type = 'button';
    names.className = 'btn roster-view-btn';
    names.dataset.rosterView = 'names';
    names.textContent = 'Names';
    names.addEventListener('click', () => applyMode('names'));

    const photos = document.createElement('button');
    photos.type = 'button';
    photos.className = 'btn roster-view-btn';
    photos.dataset.rosterView = 'photos';
    photos.textContent = 'Photos + names';
    photos.addEventListener('click', () => applyMode('photos'));

    group.append(names, photos);
    return group;
  }

  function enhanceSessionView() {
    const grid = document.querySelector('.grid');
    const sessionBar = document.querySelector('.sessionbar');
    if (!grid || !sessionBar || document.querySelector('.roster-view-toggle')) return;

    grid.classList.add('responsive-roster-grid');
    const toolbar = sessionBar.querySelector('.toolbar');
    const toggle = buildToggle();
    if (toolbar) sessionBar.insertAdjacentElement('afterend', toggle);
    else sessionBar.appendChild(toggle);
    applyMode(getMode());
  }

  applyMode(getMode());
  enhanceSessionView();

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceSessionView();
      applyMode(getMode());
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
