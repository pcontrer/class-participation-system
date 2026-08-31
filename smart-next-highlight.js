(() => {
  let scheduled = false;

  function norm(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function applyHighlights() {
    scheduled = false;
    if (typeof state === 'undefined' || state.view !== 'session' || state.arrangeMode) return;

    const chips = [...document.querySelectorAll('.nextchip')];
    const suggested = new Set(chips.map(c => norm(c.textContent)).filter(Boolean));

    for (const card of document.querySelectorAll('.student')) {
      card.classList.remove('nextcall-highlight');
      card.querySelector('.nextcall-marker')?.remove();

      if (!suggested.size) continue;
      const name = norm(card.getAttribute('title') || card.querySelector('.name')?.textContent);
      if (!suggested.has(name)) continue;

      card.classList.add('nextcall-highlight');
      const marker = document.createElement('span');
      marker.className = 'nextcall-marker';
      marker.textContent = 'NEXT';
      marker.setAttribute('aria-label', 'Suggested next call');
      card.appendChild(marker);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyHighlights);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }
})();
