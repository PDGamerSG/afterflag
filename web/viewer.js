(() => {
  const panels = new Map(Array.from(document.querySelectorAll('[data-event]'), (panel) => [panel.dataset.event, panel]));
  if (!panels.size) return;
  const groups = Array.from(document.querySelectorAll('[data-selection-group]'), (element) => ({
    element,
    options: Array.from(element.querySelectorAll('[data-select]'))
  }));
  const chartSelection = document.querySelector('[data-chart-selection]');
  const inspect = document.querySelector('[data-inspect]');
  const initial = [...panels.values()].find((panel) => !panel.hidden).dataset.event;
  let current = initial;

  function revealRow(group, button) {
    if (!group.classList.contains('event-list')) return;
    const top = button.offsetTop;
    const bottom = top + button.offsetHeight;
    if (top < group.scrollTop) group.scrollTop = top;
    if (bottom > group.scrollTop + group.clientHeight) group.scrollTop = bottom - group.clientHeight;
  }

  function select(key) {
    if (!panels.has(key)) return false;
    current = key;
    const panel = panels.get(current);
    for (const [id, event] of panels) event.hidden = id !== current;
    for (const { element, options } of groups) {
      const selected = options.find((option) => option.dataset.select === current);
      const tabStop = selected ?? options.find((option) => option.tabIndex === 0) ?? options[0];
      for (const option of options) {
        option.setAttribute('aria-pressed', String(option === selected));
        option.tabIndex = option === tabStop ? 0 : -1;
      }
      if (selected) revealRow(element, selected);
    }
    chartSelection.textContent = panel.dataset.label;
    inspect.href = '#' + panel.id;
    return true;
  }

  function openEvent(key) {
    if (!select(key)) return;
    const panel = panels.get(key);
    const hash = '#' + panel.id;
    if (location.hash !== hash) history.pushState(null, '', hash);
    panel.querySelector('[data-event-heading]').focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'start' });
  }

  function readHash() {
    const key = /^#event-(\d+)$/.exec(location.hash)?.[1];
    if (key) select(key);
    else if (!location.hash) select(initial);
  }

  document.addEventListener('click', (event) => {
    const control = event.target.closest('[data-select], [data-evidence-link], [data-inspect]');
    if (!control) return;
    if (control.dataset.select) {
      select(control.dataset.select);
    } else if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      openEvent(control.dataset.evidenceLink ?? current);
    }
  });
  for (const { element, options } of groups) {
    element.addEventListener('keydown', (event) => {
      const index = options.indexOf(event.target);
      if (index < 0) return;
      const next = {
        ArrowLeft: index - 1,
        ArrowUp: index - 1,
        ArrowRight: index + 1,
        ArrowDown: index + 1,
        Home: 0,
        End: options.length - 1
      }[event.key];
      if (next == null) return;
      event.preventDefault();
      const target = options[Math.min(options.length - 1, Math.max(0, next))];
      select(target.dataset.select);
      target.focus();
    });
  }
  window.addEventListener('hashchange', readHash);
  select(current);
  readHash();
})();
