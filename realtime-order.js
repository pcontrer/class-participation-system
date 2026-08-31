(() => {
  const OPTIONS = [
    ['manual', 'Manual layout'],
    ['first_asc', 'First name · A → Z'],
    ['first_desc', 'First name · Z → A'],
    ['last_asc', 'Surname · A → Z'],
    ['last_desc', 'Surname · Z → A'],
  ];

  let enhancing = false;

  async function enhanceSessionOrder() {
    if (enhancing || typeof state === 'undefined' || state.view !== 'session' || !state.sessionId) return;
    const bar = document.querySelector('.sessionbar');
    if (!bar || bar.querySelector('#livePanelOrder')) return;

    enhancing = true;
    try {
      const sess = await get('sessions', state.sessionId);
      if (!sess || sess.status === 'ended') return;
      const course = await get('courses', sess.courseId);
      if (!course) return;

      const toolbar = bar.querySelector('.toolbar');
      if (!toolbar || toolbar.querySelector('#livePanelOrder')) return;

      const wrap = document.createElement('label');
      wrap.className = 'live-order-control';
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '6px';
      wrap.innerHTML = '<span class="muted small">Order</span>';

      const select = document.createElement('select');
      select.id = 'livePanelOrder';
      select.className = 'input compact';
      for (const [value, label] of OPTIONS) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = (course.panelOrder || 'manual') === value || (course.panelOrder === 'alphabetical' && value === 'last_asc');
        select.appendChild(option);
      }

      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          const currentCourse = await get('courses', sess.courseId);
          currentCourse.panelOrder = select.value;
          await put('courses', currentCourse);
          if (select.value === 'manual') await ensureDefaultLayout(currentCourse.id);
          if (typeof toast === 'function') toast(`Panel order: ${orderLabel(select.value)}`);
          await render();
        } finally {
          select.disabled = false;
        }
      });

      wrap.appendChild(select);
      toolbar.prepend(wrap);
    } finally {
      enhancing = false;
    }
  }

  const observer = new MutationObserver(() => enhanceSessionOrder());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceSessionOrder, { once: true });
  } else {
    enhanceSessionOrder();
  }
})();
