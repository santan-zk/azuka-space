/*
 * main.js — runs on every page.
 *  0. Mobile menu toggle
 *  1. Profile photo loader (shows a labelled placeholder until assets/images/profile.jpg exists)
 *  2. Command palette (Ctrl+K / Cmd+K)
 * Pages can add their own commands with NS.palette.register({...}).
 */
(function () {
  'use strict';
  window.NS = window.NS || {};

  var isApple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

  /* ---------- 0. mobile menu ----------
     Below 52rem the navigation sits behind a Menu button. Without JavaScript the html element never
     gets the "js" class, so the full navigation stays visible. */
  (function menu() {
    var header = document.querySelector('.site-header');
    var toggle = document.getElementById('menu-toggle');
    if (!header || !toggle) return;
    function setOpen(open) {
      header.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', function () { setOpen(!header.classList.contains('is-open')); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('is-open') && !document.querySelector('dialog[open]')) {
        setOpen(false);
        toggle.focus();
      }
    });
    // Opening the command palette from the menu closes the menu so it does not sit behind the dialog.
    document.querySelectorAll('[data-open-palette]').forEach(function (b) { b.addEventListener('click', function () { setOpen(false); }); });
  })();

  /* ---------- 1. profile photo ---------- */
  function loadProfilePhoto() {
    var frame = document.querySelector('[data-profile-photo]');
    if (!frame) return;
    var placeholder = frame.querySelector('.photo-placeholder');
    var status = document.querySelector('[data-photo-status]');
    var probe = new Image();
    probe.onload = function () {
      var img = document.createElement('img');
      img.src = probe.src;
      img.alt = frame.getAttribute('data-alt') || '';
      img.width = probe.naturalWidth;
      img.height = probe.naturalHeight;
      frame.appendChild(img);
      if (placeholder) placeholder.hidden = true;
      if (status) status.textContent = 'Photo';
    };
    // onerror: nothing to do, the placeholder is already visible.
    probe.src = frame.getAttribute('data-src');
  }

  /* ---------- 2. command palette ---------- */
  var registry = {};
  var order = [];

  function register(cmd) {
    if (!cmd || !cmd.id || typeof cmd.run !== 'function') return;
    if (!registry[cmd.id]) order.push(cmd.id);
    registry[cmd.id] = cmd;
  }

  var currentPage = (document.body && document.body.getAttribute('data-page')) || '';
  [
    ['home', 'Go to Home', 'index.html'],
    ['about', 'Go to About', 'about.html'],
    ['projects', 'Go to Projects', 'projects.html'],
    ['planner', 'Go to Academic Planner', 'planner.html'],
    ['contact', 'Go to Contact', 'contact.html']
  ].forEach(function (p) {
    register({
      id: 'go-' + p[0], label: p[1], hint: 'Page',
      when: function () { return currentPage !== p[0]; },
      run: function () { window.location.href = p[2]; }
    });
  });
  // On the planner page, planner.js replaces this with a command that opens the form directly.
  register({ id: 'new-task', label: 'Create a task', hint: 'Planner', run: function () { window.location.href = 'planner.html#new-task'; } });

  var dlg = null, input = null, list = null, empty = null;
  var active = 0, shown = [], lastFocus = null;

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'palette';
    dlg.setAttribute('aria-label', 'Command palette');

    input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', 'Search commands');
    input.setAttribute('aria-controls', 'palette-list');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('autocomplete', 'off');
    input.placeholder = 'Type a command';

    list = document.createElement('ul');
    list.id = 'palette-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Commands');

    empty = document.createElement('p');
    empty.className = 'palette-empty';
    empty.setAttribute('role', 'status');
    empty.hidden = true;
    empty.textContent = 'No command matches. Clear the search to see them all.';

    var hint = document.createElement('p');
    hint.className = 'palette-hint';
    hint.textContent = 'Up and down arrows to move, Enter to run, Escape to close.';

    dlg.appendChild(input);
    dlg.appendChild(list);
    dlg.appendChild(empty);
    dlg.appendChild(hint);
    document.body.appendChild(dlg);

    input.addEventListener('input', refresh);
    input.addEventListener('keydown', onKey);
    list.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-index]');
      if (li) runIndex(+li.getAttribute('data-index'));
    });
    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest('li[data-index]');
      if (li && +li.getAttribute('data-index') !== active) { active = +li.getAttribute('data-index'); paintActive(); }
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () {
      var ae = document.activeElement;
      if (ae && ae !== document.body && !dlg.contains(ae)) return; // a command already moved focus on purpose
      var usable = lastFocus && lastFocus !== document.body && document.contains(lastFocus);
      var target = usable ? lastFocus : document.querySelector('[data-open-palette]');
      if (target) target.focus();
    });
  }

  function refresh() {
    var q = input.value.trim().toLowerCase();
    shown = order.map(function (id) { return registry[id]; }).filter(function (c) {
      if (c.when && !c.when()) return false;
      return !q || c.label.toLowerCase().indexOf(q) >= 0;
    });
    list.textContent = '';
    shown.forEach(function (c, i) {
      var li = document.createElement('li');
      li.id = 'palette-opt-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('data-index', String(i));
      var label = document.createElement('span');
      label.textContent = c.label;
      var hint = document.createElement('span');
      hint.className = 'note';
      hint.textContent = c.hint || '';
      li.appendChild(label);
      li.appendChild(hint);
      list.appendChild(li);
    });
    active = 0;
    empty.hidden = shown.length > 0;
    paintActive();
  }

  function paintActive() {
    Array.prototype.forEach.call(list.children, function (li, i) {
      li.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    if (shown.length) {
      input.setAttribute('aria-activedescendant', 'palette-opt-' + active);
      var el = list.children[active];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function runIndex(i) {
    var cmd = shown[i];
    if (!cmd) return;
    dlg.close();
    cmd.run();
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { active = (active + 1) % shown.length; paintActive(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { active = (active - 1 + shown.length) % shown.length; paintActive(); } }
    else if (e.key === 'Enter') { e.preventDefault(); runIndex(active); }
  }

  function open() {
    if (document.querySelector('dialog[open]')) return; // never stack on top of another dialog
    if (!dlg) build();
    lastFocus = document.activeElement;
    input.value = '';
    refresh();
    dlg.showModal();
    input.focus();
  }

  function close() { if (dlg && dlg.open) dlg.close(); }

  document.addEventListener('keydown', function (e) {
    // Only the modifier combination is handled, so plain typing in any field is never touched.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (dlg && dlg.open) close(); else open();
    }
  });

  document.querySelectorAll('[data-open-palette]').forEach(function (btn) { btn.addEventListener('click', open); });
  document.querySelectorAll('[data-palette-key]').forEach(function (k) { k.textContent = isApple ? '⌘K' : 'Ctrl K'; });

  window.NS.palette = { register: register, open: open, close: close };

  loadProfilePhoto();
})();
