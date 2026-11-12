/*
 * planner.js — the planner page: rendering and user actions.
 * Data rules, dates and persistence live in store.js (NS.store); this file only draws
 * the page and turns clicks into changes. All user text is inserted with textContent.
 */
(function () {
  'use strict';
  if (!document.body || document.body.getAttribute('data-page') !== 'planner' || !window.NS || !NS.store) return;
  var S = NS.store;

  /* ---------- tiny DOM helpers ---------- */
  function $(id) { return document.getElementById(id); }

  // h('button', {class:'btn', text:'Edit', 'data-action':'edit'}, [children])
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') el.textContent = props[k];
      else if (k === 'class') el.className = props[k];
      else if (props[k] !== false && props[k] !== null && props[k] !== undefined) el.setAttribute(k, props[k] === true ? '' : props[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function option(value, label) { return h('option', { value: value, text: label }); }

  function fillSelect(sel, items, keep) {
    var prev = keep === undefined ? sel.value : keep;
    sel.textContent = '';
    items.forEach(function (it) { sel.appendChild(option(it[0], it[1])); });
    var has = items.some(function (it) { return it[0] === prev; });
    sel.value = has ? prev : items[0][0];
  }

  /* ---------- state ---------- */
  var loaded = S.loadState({ backup: true });
  var state = loaded.state;
  var filters = { q: '', domain: 'all', course: 'all', status: 'all', priority: 'all', category: 'all', sort: 'deadline' };
  var tickHandle = null;

  var TYPE_HINTS = {
    academic: ['Assignment', 'Quiz or test', 'Exam', 'Revision', 'Practical', 'Reading', 'Other'],
    engineering: ['Exercise', 'Project work', 'Study', 'Debugging', 'Reading', 'Other']
  };
  var CATEGORY_HINTS = {
    academic: [],
    engineering: ['Rust', 'Systems programming', 'Blockchain', 'Zero-knowledge', 'Web (HTML, CSS, JS)', 'Quantitative trading']
  };
  var PRIORITY_LABEL = { low: 'Low priority', medium: 'Medium priority', high: 'High priority' };
  var STATUS_LABEL = { todo: 'Not started', doing: 'In progress', done: 'Completed' };
  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  var STATUS_RANK = { doing: 0, todo: 1, done: 2 };

  /* ---------- notices ---------- */
  var noticeBox = $('notices');
  function notify(kind, text) {
    noticeBox.textContent = '';
    noticeBox.appendChild(h('p', { class: 'notice-' + kind, text: text }));
  }
  loaded.notices.forEach(function (n) { notify(n.kind, n.text); });

  function commit(successText) {
    var r = S.saveState(state);
    if (!r.ok) {
      notify('error', 'Could not save to this browser, so this change will be lost when you close the page. Use Export to keep a copy.');
    } else if (successText) {
      notify('success', successText);
    }
    renderAll();
  }

  /* ---------- derived helpers ---------- */
  function now() { return new Date(); }
  function courseById(id) { return state.courses.filter(function (c) { return c.id === id; })[0] || null; }
  function taskById(id) { return state.tasks.filter(function (t) { return t.id === id; })[0] || null; }
  function courseLabel(c) { return c.code + ' ' + c.title; }
  function hoursText(min) { return S.formatMinutes(min); }
  function longDate(dateStr) {
    var d = S.parseDateOnly(dateStr);
    return d ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }
  function isExam(t) { return /exam/i.test(t.type || ''); }

  /* ---------- confirm dialog (replaces window.confirm) ---------- */
  function confirmAction(opts) {
    var dlg = $('confirm-dialog');
    $('confirm-title').textContent = opts.title;
    $('confirm-text').textContent = opts.text;
    var ok = $('confirm-ok');
    ok.textContent = opts.confirmLabel;
    ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    return new Promise(function (resolve) {
      function done() { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok'); }
      dlg.returnValue = 'cancel';
      dlg.addEventListener('close', done);
      dlg.showModal();
    });
  }

  /* ---------- rendering: allocation + workload ---------- */
  function renderAllocation() {
    var p = state.prefs;
    $('alloc-period').value = p.period;
    $('alloc-hours').value = String(p.periodHours);
    $('alloc-slider').value = String(p.engPct);
    $('alloc-eng-pct').textContent = 'Engineering ' + p.engPct + '%';
    $('alloc-acad-pct').textContent = 'Academic ' + (100 - p.engPct) + '%';

    var range = S.periodRange(p.period, now());
    var last = new Date(range.end.getTime() - 1);
    var fmt = { day: 'numeric', month: 'short' };
    var label = p.period === 'day'
      ? range.start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
      : range.start.toLocaleDateString(undefined, fmt) + ' to ' + last.toLocaleDateString(undefined, fmt);
    $('alloc-range').textContent = 'Period: this ' + p.period + ' (' + label + '). Weeks start on Monday.';

    var t = S.computeTargets(p);
    var rows = $('meters');
    rows.textContent = '';
    [['engineering', 'Independent engineering', t.engineeringMin], ['academic', 'Academic', t.academicMin]].forEach(function (d) {
      var logged = S.loggedInRange(state, range, d[0]);
      var target = d[2];
      var pct = target > 0 ? Math.round(logged / target * 100) : 0;
      var remaining = Math.max(0, target - logged);
      var id = 'meter-' + d[0];
      var row = h('div', { class: 'meter-row' });
      row.appendChild(h('div', { class: 'meter-head' }, [
        h('strong', { text: d[1] }),
        h('span', { text: 'target ' + hoursText(target) })
      ]));
      row.appendChild(h('progress', { id: id, max: String(Math.max(target, 1)), value: String(Math.min(logged, Math.max(target, 1))), 'aria-label': d[1] + ' time logged against target' }));
      var over = logged > target ? ' That is ' + hoursText(logged - target) + ' over target.' : ' ' + hoursText(remaining) + ' left to reach target.';
      row.appendChild(h('p', { class: 'hint', text: hoursText(logged) + ' logged (' + pct + '% of target).' + over }));
      rows.appendChild(row);
    });

    // Estimated effort of tasks whose deadline falls in this period (any status).
    var est = { engineering: 0, academic: 0 };
    state.tasks.forEach(function (tk) {
      var dl = S.deadlineOf(tk);
      if (dl && tk.estMin && dl >= range.start && dl < range.end) est[tk.domain] += tk.estMin;
    });
    // Estimated vs logged, completed tasks that have an estimate.
    var done = state.tasks.filter(function (tk) { return tk.status === 'done' && tk.estMin; });
    var estDone = 0, actDone = 0;
    done.forEach(function (tk) { estDone += tk.estMin; actDone += S.taskLoggedMin(state, tk.id); });

    var facts = $('alloc-facts');
    facts.textContent = '';
    function fact(dt, dd) { facts.appendChild(h('div', {}, [h('dt', { text: dt }), h('dd', { text: dd })])); }
    fact('Estimates due this period, engineering', hoursText(est.engineering));
    fact('Estimates due this period, academic', hoursText(est.academic));
    fact('Completed tasks with an estimate', String(done.length));
    fact('Their estimated total', hoursText(estDone));
    fact('Their logged total', hoursText(actDone));
  }

  /* ---------- rendering: activity heat graph (inline SVG + text equivalents) ---------- */
  var heatDomain = 'all';
  var HEAT_WEEKS = 12;
  function renderHeat() {
    var box = $('heat-chart');
    if (!box) return;
    box.textContent = '';
    var n = now();
    var today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    var mondayOffset = (today.getDay() + 6) % 7;                       // weeks start on Monday
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset - (HEAT_WEEKS - 1) * 7);
    var cells = S.dailyMinutes(state, start, HEAT_WEEKS * 7, heatDomain);
    var visible = cells.filter(function (c) { return c.date <= today; });
    var total = visible.reduce(function (sum, c) { return sum + c.minutes; }, 0);
    var scope = heatDomain === 'all' ? 'logged time' : (heatDomain === 'engineering' ? 'engineering time' : 'academic time');
    if (!total) {
      box.appendChild(h('p', { class: 'empty-note', text: 'No ' + scope + ' in the last 12 weeks. Log time on a task, or run its timer, and the squares fill in here.' }));
      return;
    }

    var NS_SVG = 'http://www.w3.org/2000/svg';
    function s(tag, attrs) { var el = document.createElementNS(NS_SVG, tag); Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); }); return el; }
    var CELL = 18, GAP = 4, left = 34, top = 20, W = left + HEAT_WEEKS * (CELL + GAP), H = top + 7 * (CELL + GAP);
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Heat graph of ' + scope + ' per day over the last ' + HEAT_WEEKS + ' weeks. The same numbers are in the table below.', class: 'heat-svg' });
    ['Mon', 'Wed', 'Fri'].forEach(function (d, i) {
      var t = s('text', { x: left - 6, y: top + (i * 2) * (CELL + GAP) + CELL - 4, 'text-anchor': 'end', 'font-size': '11', fill: 'var(--color-text-muted)' });
      t.textContent = d; svg.appendChild(t);
    });
    var lastMonth = -1;
    for (var wk = 0; wk < HEAT_WEEKS; wk++) {
      var mon = cells[wk * 7].date;
      if (mon.getMonth() !== lastMonth) {
        lastMonth = mon.getMonth();
        var ml = s('text', { x: left + wk * (CELL + GAP), y: 12, 'font-size': '11', fill: 'var(--color-text-muted)' });
        ml.textContent = mon.toLocaleDateString(undefined, { month: 'short' }); svg.appendChild(ml);
      }
    }
    var readout = h('p', { class: 'heat-readout', id: 'heat-readout', 'aria-live': 'polite', text: 'Tap or hover a square to see that day.' });
    function describe(c) {
      return c.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + (c.minutes ? hoursText(c.minutes) + ' logged' : 'nothing logged');
    }
    cells.forEach(function (c, i) {
      if (c.date > today) return;                                          // future days are not drawn
      var lvl = S.heatLevel(c.minutes);
      var isToday = c.date.getTime() === today.getTime();
      var r = s('rect', {
        x: left + Math.floor(i / 7) * (CELL + GAP), y: top + (i % 7) * (CELL + GAP), width: CELL, height: CELL,
        'data-level': String(lvl), class: 'heat-cell' + (isToday ? ' is-today' : '')
      });
      var show = function () { readout.textContent = describe(c) + (isToday ? ' (today)' : '') + '.'; };
      r.addEventListener('mouseenter', show); r.addEventListener('click', show);
      svg.appendChild(r);
    });
    box.appendChild(svg);
    box.appendChild(readout);

    // legend: the thresholds are fixed, so a colour always means the same amount of time
    var legend = h('div', { class: 'heat-legend' });
    legend.appendChild(h('span', { text: 'Less' }));
    var key = s('svg', { viewBox: '0 0 ' + (5 * 18) + ' 14', width: String(5 * 18), height: '14', 'aria-hidden': 'true' });
    for (var l = 0; l < 5; l++) key.appendChild(s('rect', { x: l * 18, y: 0, width: 14, height: 14, 'data-level': String(l), class: 'heat-cell' }));
    legend.appendChild(key);
    legend.appendChild(h('span', { text: 'More' }));
    legend.appendChild(h('span', { class: 'hint', text: 'Steps: none, under 30m, under 1h 30m, under 3h, 3h or more per day. Today has a thicker outline.' }));
    box.appendChild(legend);

    // summary numbers, all computed from the entries
    var active = visible.filter(function (c) { return c.minutes > 0; });
    var run = 0, longest = 0;
    visible.forEach(function (c) { run = c.minutes > 0 ? run + 1 : 0; if (run > longest) longest = run; });
    var best = active.reduce(function (b, c) { return !b || c.minutes > b.minutes ? c : b; }, null);
    var facts = h('dl', { class: 'facts' });
    function fact(dt, dd) { facts.appendChild(h('div', {}, [h('dt', { text: dt }), h('dd', { text: dd })])); }
    fact('Days with time logged', active.length + ' of ' + visible.length);
    fact('Total in this window', hoursText(total));
    fact('Longest run of consecutive days', longest + (longest === 1 ? ' day' : ' days'));
    fact('Busiest day', best ? describe(best).replace(': ', ', ').replace(' logged', '') : 'none');
    box.appendChild(facts);

    // text equivalent: one row per week
    var det = h('details', { class: 'entries' }, [h('summary', { text: 'Show the numbers as a table' })]);
    var tbl = h('table', { class: 'plain-table' });
    var head = h('tr', {}, [h('th', { scope: 'col', text: 'Week of' })]);
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) { head.appendChild(h('th', { scope: 'col', text: d })); });
    tbl.appendChild(h('thead', {}, [head]));
    var tb = h('tbody');
    for (var w2 = HEAT_WEEKS - 1; w2 >= 0; w2--) {
      var tr = h('tr', {}, [h('th', { scope: 'row', text: cells[w2 * 7].date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })]);
      for (var d2 = 0; d2 < 7; d2++) {
        var cc = cells[w2 * 7 + d2];
        tr.appendChild(h('td', { text: cc.date > today ? '' : (cc.minutes ? hoursText(cc.minutes) : '-') }));
      }
      tb.appendChild(tr);
    }
    tbl.appendChild(tb); det.appendChild(tbl); box.appendChild(det);
  }
  var heatSel = $('heat-domain');
  if (heatSel) heatSel.addEventListener('change', function () { heatDomain = heatSel.value; renderHeat(); });

  /* ---------- rendering: counts + deadlines ---------- */
  function renderCounts() {
    var n = now();
    var c = { todo: 0, doing: 0, done: 0, overdue: 0 };
    state.tasks.forEach(function (t) {
      c[t.status]++;
      if (S.isOverdue(t, n)) c.overdue++;
    });
    var total = state.tasks.length;
    var line = $('progress-line');
    if (line) {
      line.hidden = total === 0;
      if (total) {
        $('progress-text').textContent = c.done + ' of ' + total + (total === 1 ? ' task' : ' tasks') + ' completed';
        $('progress-bar').max = total;
        $('progress-bar').value = c.done;
      }
    }
    var box = $('counts');
    box.textContent = '';
    [['Not started', c.todo], ['In progress', c.doing], ['Completed', c.done], ['Overdue (open, deadline passed)', c.overdue], ['All tasks', state.tasks.length]].forEach(function (r) {
      box.appendChild(h('div', {}, [h('dt', { text: r[0] }), h('dd', { text: String(r[1]) })]));
    });
  }

  function attentionItem(t, n) {
    var li = h('li', {});
    li.appendChild(h('span', { text: t.title }));
    var when = S.describeDeadline(t, n) + ', ' + longDate(t.dueDate) + (t.dueTime ? ' at ' + t.dueTime : '');
    var dom = t.domain === 'academic' ? 'Academic' : 'Engineering';
    li.appendChild(h('span', { class: 'when', text: dom + ': ' + when }));
    return li;
  }

  function renderAttention() {
    var n = now();
    var open = state.tasks.filter(function (t) { return t.status !== 'done' && S.deadlineOf(t); });
    function byDeadline(a, b) { return S.deadlineOf(a) - S.deadlineOf(b); }
    var overdue = open.filter(function (t) { return S.isOverdue(t, n); }).sort(byDeadline);
    var weekEnd = new Date(n.getTime() + 7 * 86400000);
    var soon = open.filter(function (t) { var d = S.deadlineOf(t); return d >= n && d <= weekEnd; }).sort(byDeadline);
    var exams = open.filter(function (t) { return isExam(t) && S.deadlineOf(t) >= n; }).sort(byDeadline);

    function fillList(id, groupId, items) {
      var ul = $(id);
      ul.textContent = '';
      items.forEach(function (t) { ul.appendChild(attentionItem(t, n)); });
      $(groupId).hidden = items.length === 0;
    }
    fillList('list-overdue', 'grp-overdue', overdue);
    fillList('list-soon', 'grp-soon', soon);
    fillList('list-exams', 'grp-exams', exams);
    $('attention-clear').hidden = overdue.length + soon.length + exams.length > 0;
    $('overdue-count').textContent = overdue.length ? '(' + overdue.length + ')' : '';
  }

  /* ---------- rendering: filters ---------- */
  function renderFilterOptions() {
    var courseItems = [['all', 'All courses'], ['none', 'No course']].concat(state.courses.map(function (c) { return [c.id, c.code]; }));
    fillSelect($('f-course'), courseItems, filters.course);
    filters.course = $('f-course').value;

    var cats = {};
    state.tasks.forEach(function (t) { if (t.category) cats[t.category] = true; });
    var catItems = [['all', 'All categories']].concat(Object.keys(cats).sort().map(function (c) { return [c, c]; }));
    fillSelect($('f-category'), catItems, filters.category);
    filters.category = $('f-category').value;
  }

  function matches(t) {
    var n = now();
    if (filters.domain !== 'all' && t.domain !== filters.domain) return false;
    if (filters.course === 'none' && t.courseId) return false;
    if (filters.course !== 'all' && filters.course !== 'none' && t.courseId !== filters.course) return false;
    if (filters.status === 'overdue') { if (!S.isOverdue(t, n)) return false; }
    else if (filters.status !== 'all' && t.status !== filters.status) return false;
    if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
    if (filters.category !== 'all' && t.category !== filters.category) return false;
    if (filters.q) {
      var c = courseById(t.courseId);
      var hay = [t.title, t.notes, t.category, t.type, c ? c.code + ' ' + c.title : ''].join(' ').toLowerCase();
      if (hay.indexOf(filters.q.toLowerCase()) < 0) return false;
    }
    return true;
  }

  function compareTasks(a, b) {
    var da = S.deadlineOf(a), db = S.deadlineOf(b);
    function byDeadline() {
      if (da && db) return da - db;
      if (da) return -1;
      if (db) return 1;
      return 0;
    }
    function openFirst() { return (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0); }
    var r = 0;
    if (filters.sort === 'priority') r = (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || openFirst() || byDeadline();
    else if (filters.sort === 'status') r = (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || byDeadline();
    else if (filters.sort === 'newest') r = new Date(b.createdAt) - new Date(a.createdAt);
    else r = openFirst() || byDeadline();
    return r || a.title.localeCompare(b.title);
  }

  /* ---------- rendering: task list ---------- */
  function taskItem(t, n, timerTaskId) {
    var overdue = S.isOverdue(t, n);
    var logged = S.taskLoggedMin(state, t.id);
    var course = courseById(t.courseId);
    var li = h('li', { class: 'task', 'data-id': t.id, 'data-done': String(t.status === 'done') });

    li.appendChild(h('h3', { class: 'task-title', tabindex: '-1', text: t.title }));

    var meta = h('div', { class: 'task-meta' });
    meta.appendChild(h('span', { class: 'tag tag-strong', text: t.domain === 'academic' ? 'Academic' : 'Engineering' }));
    if (course) meta.appendChild(h('span', { class: 'tag', text: course.code }));
    if (t.category) meta.appendChild(h('span', { class: 'tag', text: t.category }));
    if (t.type) meta.appendChild(h('span', { class: 'tag', text: t.type }));
    meta.appendChild(h('span', { class: 'tag', text: PRIORITY_LABEL[t.priority] }));
    meta.appendChild(h('span', { class: 'tag', text: STATUS_LABEL[t.status] }));
    if (overdue) meta.appendChild(h('span', { class: 'tag tag-error', text: 'Overdue' }));
    if (t.status === 'done') meta.appendChild(h('span', { class: 'tag tag-success', text: 'Completed' }));
    li.appendChild(meta);

    if (t.dueDate) {
      var due = 'Due ' + longDate(t.dueDate) + (t.dueTime ? ' at ' + t.dueTime : ', end of day');
      if (t.status !== 'done') due += ' (' + S.describeDeadline(t, n) + ')';
      li.appendChild(h('p', { class: 'task-meta', text: due }));
    } else {
      li.appendChild(h('p', { class: 'task-meta', text: 'No deadline' }));
    }

    li.appendChild(h('p', { class: 'task-effort', text: 'Estimated: ' + (t.estMin ? hoursText(t.estMin) : 'not set') + '   Logged: ' + hoursText(logged) }));
    if (t.notes) li.appendChild(h('p', { class: 'task-notes', text: t.notes }));

    var actions = h('div', { class: 'task-actions' });
    actions.appendChild(h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'toggle', text: t.status === 'done' ? 'Reopen' : 'Mark complete' }));
    if (t.status !== 'done') {
      var running = timerTaskId === t.id;
      actions.appendChild(h('button', {
        type: 'button', class: 'btn btn-small btn-quiet', 'data-action': running ? 'stop' : 'start',
        disabled: !running && !!timerTaskId, text: running ? 'Stop timer' : 'Start timer',
        title: !running && timerTaskId ? 'Another timer is running. Stop it first.' : false
      }));
    }
    actions.appendChild(h('button', { type: 'button', class: 'btn btn-small btn-quiet', 'data-action': 'log', text: 'Log time' }));
    actions.appendChild(h('button', { type: 'button', class: 'btn btn-small btn-quiet', 'data-action': 'edit', text: 'Edit' }));
    actions.appendChild(h('button', { type: 'button', class: 'btn btn-small btn-quiet btn-quiet-danger', 'data-action': 'delete', text: 'Delete' }));
    li.appendChild(actions);

    var entries = state.log.filter(function (e) { return e.taskId === t.id; }).sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    if (entries.length) {
      var det = h('details', { class: 'entries' }, [h('summary', { text: 'Time entries (' + entries.length + ')' })]);
      var ul = h('ul', { class: 'log-list' });
      entries.forEach(function (e) {
        var when = new Date(e.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        ul.appendChild(h('li', {}, [
          h('span', { text: hoursText(e.minutes) + ' on ' + when + (e.source === 'timer' ? ' (timer)' : ' (added by hand)') }),
          h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'delete-entry', 'data-entry': e.id, text: 'Remove entry' })
        ]));
      });
      det.appendChild(ul);
      li.appendChild(det);
    }
    return li;
  }

  function renderTasks() {
    var n = now();
    var list = $('task-list');
    list.textContent = '';
    var shown = state.tasks.filter(matches).sort(compareTasks);
    var timerId = state.timer ? state.timer.taskId : null;
    shown.forEach(function (t) { list.appendChild(taskItem(t, n, timerId)); });

    var total = state.tasks.length;
    $('results-count').textContent = total ? 'Showing ' + shown.length + ' of ' + total : '';
    $('tasks-empty').hidden = total > 0;
    $('tasks-filtered-empty').hidden = !(total > 0 && shown.length === 0);
    $('filters-fold').hidden = total === 0;
    if (total > 0 && shown.length === 0) {
      $('hidden-count').textContent = total + (total === 1 ? ' task is' : ' tasks are') + ' hidden by the filters. Nothing has been deleted.';
    }
  }

  /* ---------- rendering: courses ---------- */
  function renderCourses() {
    var ul = $('course-list');
    ul.textContent = '';
    state.courses.forEach(function (c) {
      var used = state.tasks.filter(function (t) { return t.courseId === c.id; }).length;
      var info = h('div', { class: 'course-name' }, [
        h('strong', { text: c.code }), document.createTextNode(' ' + c.title),
        c.term ? h('span', { class: 'note', text: '  ' + c.term }) : null,
        h('span', { class: 'note', text: '  ' + used + (used === 1 ? ' task' : ' tasks') })
      ]);
      var actions = h('div', { class: 'task-actions' }, [
        h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'edit-course', 'data-id': c.id, text: 'Edit', 'aria-label': 'Edit course ' + c.code }),
        h('button', { type: 'button', class: 'btn btn-small btn-danger', 'data-action': 'delete-course', 'data-id': c.id, text: 'Delete', 'aria-label': 'Delete course ' + c.code })
      ]);
      ul.appendChild(h('li', {}, [info, actions]));
      if (c.notes) ul.lastChild.appendChild(h('p', { class: 'note', text: c.notes }));
    });
    $('courses-empty').hidden = state.courses.length > 0;
    $('courses-count').textContent = state.courses.length ? '(' + state.courses.length + ')' : '';
  }

  /* ---------- rendering: timer ---------- */
  function elapsedText(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  function tickTimer() {
    if (!state.timer) return;
    $('timer-elapsed').textContent = elapsedText(Date.now() - new Date(state.timer.startedAt).getTime());
  }

  function renderTimer() {
    var banner = $('timer-banner');
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    if (!state.timer) { banner.hidden = true; return; }
    var t = taskById(state.timer.taskId);
    $('timer-task').textContent = t ? t.title : 'a task';
    banner.hidden = false;
    tickTimer();
    tickHandle = setInterval(tickTimer, 1000);
  }

  /* ---------- rendering: data panel ---------- */
  function renderData() {
    var hasBackup = false;
    try { hasBackup = window.localStorage.getItem(S.BACKUP_KEY) !== null; } catch (e) { hasBackup = false; }
    $('backup-row').hidden = !hasBackup;
  }

  function renderAll() {
    renderFilterOptions();
    renderAllocation();
    renderHeat();
    renderCounts();
    renderAttention();
    renderTasks();
    renderCourses();
    renderTimer();
    renderData();
  }

  /* ---------- focus helper ---------- */
  function focusAfter(id, action) {
    var li = document.querySelector('#task-list li[data-id="' + id + '"]');
    var el = li && (li.querySelector('[data-action="' + action + '"]') || li.querySelector('.task-title'));
    if (el) el.focus();
  }

  /* ---------- field helpers for dialogs ---------- */
  function setErr(input, msg) {
    var box = $(input.id + '-error');
    if (msg) { input.setAttribute('aria-invalid', 'true'); box.textContent = msg; }
    else { input.removeAttribute('aria-invalid'); box.textContent = ''; }
    return !msg;
  }

  function clearErrors(form) {
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (i) { i.removeAttribute('aria-invalid'); });
    Array.prototype.forEach.call(form.querySelectorAll('.field-error'), function (p) { p.textContent = ''; });
  }

  /* ---------- task dialog ---------- */
  var taskDlg = $('task-dialog');
  var taskForm = $('task-form');

  function currentDomain() { return taskForm.elements.domain.value; }

  function syncDomainFields() {
    var dom = currentDomain();
    $('course-field').hidden = dom !== 'academic';
    var types = $('type-options'), cats = $('category-options');
    types.textContent = ''; cats.textContent = '';
    TYPE_HINTS[dom].forEach(function (v) { types.appendChild(option(v, v)); });
    CATEGORY_HINTS[dom].forEach(function (v) { cats.appendChild(option(v, v)); });
    $('t-category-hint').textContent = dom === 'engineering'
      ? 'The technology or area, for example Rust. Not every engineering task is Rust, so leave it blank if it does not fit.'
      : 'Optional, for example Revision topic.';
  }

  function openTaskDialog(task) {
    taskForm.reset();
    clearErrors(taskForm);
    fillSelect($('t-course'), [['', 'No course']].concat(state.courses.map(function (c) { return [c.id, courseLabel(c)]; })), '');
    $('task-dialog-title').textContent = task ? 'Edit task' : 'New task';
    $('t-id').value = task ? task.id : '';
    taskForm.elements.domain.value = task ? task.domain : 'engineering';
    syncDomainFields();
    if (task) {
      $('t-title').value = task.title;
      $('t-course').value = task.courseId || '';
      $('t-type').value = task.type;
      $('t-category').value = task.category;
      $('t-date').value = task.dueDate || '';
      $('t-time').value = task.dueTime || '';
      $('t-priority').value = task.priority;
      $('t-status').value = task.status;
      if (task.estMin) {
        var useHours = task.estMin % 60 === 0;
        $('t-est').value = String(useHours ? task.estMin / 60 : task.estMin);
        $('t-est-unit').value = useHours ? 'hours' : 'minutes';
      }
      $('t-notes').value = task.notes;
    } else {
      $('t-priority').value = 'medium';
      $('t-status').value = 'todo';
    }
    taskDlg.showModal();
    $('t-title').focus();
  }

  function parseEstimate() {
    var raw = $('t-est').value.trim();
    if (raw === '') return { ok: true, value: null };
    var num = Number(raw);
    var min = $('t-est-unit').value === 'hours' ? num * 60 : num;
    if (!isFinite(num) || num <= 0 || Math.round(min) < 1 || Math.round(min) > S.LIMITS.maxEstimateMin) {
      return { ok: false, msg: 'Enter an estimate above zero, up to ' + (S.LIMITS.maxEstimateMin / 60) + ' hours, or leave it blank.' };
    }
    return { ok: true, value: Math.round(min) };
  }

  function validateTask() {
    var okAll = true, first = null;
    function check(input, msg) { var ok = setErr(input, msg); if (!ok && !first) first = input; okAll = okAll && ok; }

    var title = $('t-title').value.trim();
    check($('t-title'), !title ? 'Give the task a title.' : title.length > S.LIMITS.title ? 'Keep the title under ' + S.LIMITS.title + ' characters.' : '');
    check($('t-type'), $('t-type').value.trim().length > S.LIMITS.type ? 'Keep the type under ' + S.LIMITS.type + ' characters.' : '');
    check($('t-category'), $('t-category').value.trim().length > S.LIMITS.category ? 'Keep the category under ' + S.LIMITS.category + ' characters.' : '');

    var date = $('t-date').value, time = $('t-time').value;
    check($('t-date'), date && !S.parseDateOnly(date) ? 'Enter a real date between 2000 and 2100.' : '');
    check($('t-time'), time && !date ? 'Add a due date for this time, or clear the time.' : time && !S.parseTime(time) ? 'Enter a valid time.' : '');
    var est = parseEstimate();
    check($('t-est'), est.ok ? '' : est.msg);
    check($('t-notes'), $('t-notes').value.length > S.LIMITS.notes ? 'Keep notes under ' + S.LIMITS.notes + ' characters.' : '');
    return { ok: okAll, first: first, estimate: est.value };
  }

  Array.prototype.forEach.call(taskForm.querySelectorAll('input[name="domain"]'), function (r) { r.addEventListener('change', syncDomainFields); });

  taskForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = validateTask();
    if (!v.ok) { v.first.focus(); return; }

    var id = $('t-id').value;
    var existing = id ? taskById(id) : null;
    var domain = currentDomain();
    var status = $('t-status').value;
    var task = existing || { id: S.newId(), createdAt: new Date().toISOString(), completedAt: null };
    task.title = $('t-title').value.trim();
    task.domain = domain;
    task.courseId = domain === 'academic' && $('t-course').value ? $('t-course').value : null;
    task.type = $('t-type').value.trim();
    task.category = $('t-category').value.trim();
    task.dueDate = $('t-date').value || null;
    task.dueTime = task.dueDate && $('t-time').value ? $('t-time').value : null;
    task.priority = $('t-priority').value;
    task.estMin = v.estimate;
    task.notes = $('t-notes').value.trim();
    if (status === 'done' && task.status !== 'done') task.completedAt = new Date().toISOString();
    if (status !== 'done') task.completedAt = null;
    task.status = status;
    if (!existing) state.tasks.push(task);

    taskDlg.close();
    var late = S.isOverdue(task, now()) ? ' Its deadline has already passed, so it shows as overdue.' : '';
    commit((existing ? 'Task updated.' : 'Task added.') + late);
    focusAfter(task.id, 'edit');
  });

  $('task-cancel').addEventListener('click', function () { taskDlg.close(); });

  /* ---------- course dialog ---------- */
  var courseDlg = $('course-dialog');
  var courseForm = $('course-form');

  function openCourseDialog(course) {
    courseForm.reset();
    clearErrors(courseForm);
    $('course-dialog-title').textContent = course ? 'Edit course' : 'New course';
    $('c-id').value = course ? course.id : '';
    if (course) {
      $('c-code').value = course.code; $('c-title').value = course.title;
      $('c-term').value = course.term; $('c-notes').value = course.notes;
    }
    courseDlg.showModal();
    $('c-code').focus();
  }

  courseForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = $('c-id').value;
    var code = $('c-code').value.trim(), title = $('c-title').value.trim();
    var term = $('c-term').value.trim(), notes = $('c-notes').value.trim();
    var first = null;
    function check(input, msg) { var ok = setErr(input, msg); if (!ok && !first) first = input; }
    var dupe = state.courses.some(function (c) { return c.id !== id && c.code.toLowerCase() === code.toLowerCase(); });
    check($('c-code'), !code ? 'Enter the course code.' : code.length > S.LIMITS.code ? 'Keep the code under ' + S.LIMITS.code + ' characters.' : dupe ? 'A course with this code already exists.' : '');
    check($('c-title'), !title ? 'Enter the course title.' : title.length > S.LIMITS.courseTitle ? 'Keep the title under ' + S.LIMITS.courseTitle + ' characters.' : '');
    check($('c-term'), term.length > S.LIMITS.term ? 'Keep this under ' + S.LIMITS.term + ' characters.' : '');
    check($('c-notes'), notes.length > S.LIMITS.courseNotes ? 'Keep notes under ' + S.LIMITS.courseNotes + ' characters.' : '');
    if (first) { first.focus(); return; }

    var existing = id ? courseById(id) : null;
    var course = existing || { id: S.newId() };
    course.code = code; course.title = title; course.term = term; course.notes = notes;
    if (!existing) state.courses.push(course);
    courseDlg.close();
    commit(existing ? 'Course updated.' : 'Course added.');
    $('new-course-btn').focus();
  });
  $('course-cancel').addEventListener('click', function () { courseDlg.close(); });

  $('course-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var course = courseById(btn.getAttribute('data-id'));
    if (!course) return;
    if (btn.getAttribute('data-action') === 'edit-course') { openCourseDialog(course); return; }
    var used = state.tasks.filter(function (t) { return t.courseId === course.id; });
    confirmAction({
      title: 'Delete ' + course.code + '?',
      text: used.length
        ? used.length + (used.length === 1 ? ' task uses' : ' tasks use') + ' this course. They stay in your planner but are no longer linked to a course.'
        : 'No tasks use this course. This cannot be undone.',
      confirmLabel: 'Delete course', danger: true
    }).then(function (yes) {
      if (!yes) return;
      used.forEach(function (t) { t.courseId = null; });
      state.courses = state.courses.filter(function (c) { return c.id !== course.id; });
      commit('Course deleted.' + (used.length ? ' ' + used.length + ' task(s) were unlinked.' : ''));
      $('new-course-btn').focus();
    });
  });

  /* ---------- time logging ---------- */
  var logDlg = $('log-dialog');
  var logForm = $('log-form');

  function openLogDialog(task) {
    logForm.reset();
    clearErrors(logForm);
    $('l-task').value = task.id;
    $('log-task-name').textContent = task.title;
    $('l-date').value = S.toDateInputValue(now());
    $('l-date').max = S.toDateInputValue(now());
    logDlg.showModal();
    $('l-minutes').focus();
  }

  logForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var task = taskById($('l-task').value);
    if (!task) { logDlg.close(); return; }
    var raw = $('l-minutes').value.trim(), mins = Number(raw);
    var first = null;
    function check(input, msg) { var ok = setErr(input, msg); if (!ok && !first) first = input; }
    check($('l-minutes'), !raw || !isFinite(mins) || mins < 1 || mins > S.LIMITS.maxLogMin || Math.round(mins) !== mins
      ? 'Enter whole minutes from 1 to ' + S.LIMITS.maxLogMin + '.' : '');
    var dateStr = $('l-date').value;
    var day = S.parseDateOnly(dateStr);
    check($('l-date'), !day ? 'Enter the date you did the work.' : day > S.startOfDay(now()) ? 'The date cannot be in the future.' : '');
    if (first) { first.focus(); return; }

    var today = S.toDateInputValue(now()) === dateStr;
    var at = today ? new Date() : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0);
    state.log.push({ id: S.newId(), taskId: task.id, minutes: mins, at: at.toISOString(), source: 'manual' });
    if (task.status === 'todo') task.status = 'doing';
    logDlg.close();
    commit('Logged ' + hoursText(mins) + ' on "' + task.title + '".');
    focusAfter(task.id, 'log');
  });
  $('log-cancel').addEventListener('click', function () { logDlg.close(); });

  function startTimer(task) {
    if (state.timer) { notify('warning', 'A timer is already running. Stop it before starting another.'); return; }
    state.timer = { taskId: task.id, startedAt: new Date().toISOString() };
    if (task.status === 'todo') task.status = 'doing';
    commit('Timer started on "' + task.title + '".');
    focusAfter(task.id, 'stop');
  }

  function stopTimer(discard) {
    var tm = state.timer;
    if (!tm) return;
    var task = taskById(tm.taskId);
    var ms = Date.now() - new Date(tm.startedAt).getTime();
    var mins = Math.round(ms / 60000);
    state.timer = null;
    if (discard) { commit('Timer discarded. Nothing was logged.'); return; }
    if (ms < 0) { commit('The device clock moved backwards, so the timer could not be measured. Nothing was logged.'); return; }
    if (mins < 1) { commit('Under 30 seconds, so nothing was logged.'); return; }
    if (mins > S.LIMITS.maxLogMin) {
      commit('The timer ran for more than 24 hours, which usually means it was left on. Nothing was logged. Use Log time to add the real amount.');
      return;
    }
    state.log.push({ id: S.newId(), taskId: tm.taskId, minutes: mins, at: new Date().toISOString(), source: 'timer' });
    commit('Logged ' + hoursText(mins) + (task ? ' on "' + task.title + '".' : '.'));
    if (task) focusAfter(task.id, 'start');
  }

  $('timer-stop').addEventListener('click', function () { stopTimer(false); });
  $('timer-discard').addEventListener('click', function () { stopTimer(true); });

  /* ---------- task list actions (event delegation) ---------- */
  $('task-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var li = btn.closest('li[data-id]');
    var task = li && taskById(li.getAttribute('data-id'));
    if (!task) return;
    var action = btn.getAttribute('data-action');

    if (action === 'toggle') {
      if (task.status === 'done') {
        task.status = S.taskLoggedMin(state, task.id) > 0 ? 'doing' : 'todo';
        task.completedAt = null;
        commit('Reopened "' + task.title + '".');
      } else {
        task.status = 'done';
        task.completedAt = new Date().toISOString();
        if (state.timer && state.timer.taskId === task.id) { stopTimer(false); }
        commit('Completed "' + task.title + '".');
      }
      focusAfter(task.id, 'toggle');
    } else if (action === 'edit') openTaskDialog(task);
    else if (action === 'log') openLogDialog(task);
    else if (action === 'start') startTimer(task);
    else if (action === 'stop') stopTimer(false);
    else if (action === 'delete-entry') {
      var entryId = btn.getAttribute('data-entry');
      state.log = state.log.filter(function (en) { return en.id !== entryId; });
      commit('Time entry removed.');
      focusAfter(task.id, 'log');
    } else if (action === 'delete') {
      var n = S.taskLoggedMin(state, task.id);
      confirmAction({
        title: 'Delete this task?',
        text: '"' + task.title + '"' + (n ? ' and its ' + hoursText(n) + ' of logged time' : '') + ' will be removed. This cannot be undone.',
        confirmLabel: 'Delete task', danger: true
      }).then(function (yes) {
        if (!yes) return;
        if (state.timer && state.timer.taskId === task.id) state.timer = null;
        state.tasks = state.tasks.filter(function (t) { return t.id !== task.id; });
        state.log = state.log.filter(function (en) { return en.taskId !== task.id; });
        commit('Task deleted.');
        $('new-task-btn').focus();
      });
    }
  });

  /* ---------- filters ---------- */
  var filterMap = { 'f-search': 'q', 'f-domain': 'domain', 'f-course': 'course', 'f-status': 'status', 'f-priority': 'priority', 'f-category': 'category', 'f-sort': 'sort' };
  Object.keys(filterMap).forEach(function (id) {
    $(id).addEventListener(id === 'f-search' ? 'input' : 'change', function (e) {
      filters[filterMap[id]] = e.target.value;
      renderTasks();
    });
  });
  $('filters').addEventListener('submit', function (e) { e.preventDefault(); });

  function clearFilters() {
    filters = { q: '', domain: 'all', course: 'all', status: 'all', priority: 'all', category: 'all', sort: filters.sort };
    $('f-search').value = '';
    ['f-domain', 'f-status', 'f-priority'].forEach(function (id) { $(id).value = 'all'; });
    renderFilterOptions();
    renderTasks();
  }
  $('clear-filters').addEventListener('click', clearFilters);
  $('clear-filters-2').addEventListener('click', clearFilters);

  /* ---------- allocation controls ---------- */
  $('alloc-slider').addEventListener('input', function (e) {
    var v = +e.target.value;
    $('alloc-eng-pct').textContent = 'Engineering ' + v + '%';
    $('alloc-acad-pct').textContent = 'Academic ' + (100 - v) + '%';
  });
  $('alloc-slider').addEventListener('change', function (e) {
    state.prefs.engPct = Math.min(70, Math.max(50, Math.round(+e.target.value)));
    commit();
  });
  $('alloc-period').addEventListener('change', function (e) {
    if (S.PERIODS.indexOf(e.target.value) >= 0) { state.prefs.period = e.target.value; commit(); }
  });
  $('alloc-hours').addEventListener('change', function (e) {
    var v = Number(e.target.value);
    var ok = e.target.value.trim() !== '' && isFinite(v) && v >= 1 && v <= 500;
    setErr(e.target, ok ? '' : 'Enter planned hours from 1 to 500.');
    if (ok) { state.prefs.periodHours = Math.round(v * 4) / 4; commit(); }
  });

  /* ---------- data: export, import, reset, backup ---------- */
  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportData() {
    download('azuka-space-planner-' + S.toDateInputValue(now()) + '.json', JSON.stringify(state, null, 2));
    notify('success', 'Exported ' + state.tasks.length + ' tasks and ' + state.courses.length + ' courses to a JSON file.');
  }
  $('export-btn').addEventListener('click', exportData);

  $('import-btn').addEventListener('click', function () { $('import-file').click(); });
  $('import-file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify('error', 'That file is over 2 MB, which is far more than a planner export. Nothing was imported.'); return; }
    var reader = new FileReader();
    reader.onerror = function () { notify('error', 'The file could not be read. Nothing was imported.'); };
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch (err) { notify('error', 'That file is not valid JSON. Nothing was imported.'); return; }
      var result = S.sanitize(parsed);
      if (result.fatal) { notify('error', 'That file is not an Azuka-space planner export (' + result.problems[0] + ') Nothing was imported.'); return; }
      var inc = result.state;
      var skipped = result.problems.length ? ' ' + result.problems.length + ' invalid item(s) in the file will be skipped.' : '';
      confirmAction({
        title: 'Replace your planner with this file?',
        text: 'The file holds ' + inc.tasks.length + ' tasks, ' + inc.courses.length + ' courses and ' + inc.log.length + ' time entries. Your current planner has ' + state.tasks.length + ' tasks and ' + state.courses.length + ' courses, and it will be replaced.' + skipped + ' Export first if you want to keep the current data.',
        confirmLabel: 'Replace with file', danger: true
      }).then(function (yes) {
        if (!yes) return;
        state = inc;
        commit('Imported ' + inc.tasks.length + ' tasks and ' + inc.courses.length + ' courses.');
      });
    };
    reader.readAsText(file);
  });

  $('reset-btn').addEventListener('click', function () {
    confirmAction({
      title: 'Delete all planner data?',
      text: 'All courses, tasks, time entries and settings in this browser will be erased and cannot be recovered. Export first if you might want them back.',
      confirmLabel: 'Delete everything', danger: true
    }).then(function (yes) {
      if (!yes) return;
      var r = S.clearState();
      state = S.defaultState();
      filters = { q: '', domain: 'all', course: 'all', status: 'all', priority: 'all', category: 'all', sort: 'deadline' };
      $('f-search').value = '';
      renderAll();
      notify(r.ok ? 'success' : 'error', r.ok ? 'All planner data was deleted from this browser.' : 'Could not clear browser storage.');
    });
  });

  $('backup-download').addEventListener('click', function () {
    var raw = null;
    try { raw = window.localStorage.getItem(S.BACKUP_KEY); } catch (e) { raw = null; }
    if (raw === null) { renderData(); return; }
    download('azuka-space-unreadable-backup.json', raw);
  });
  $('backup-discard').addEventListener('click', function () {
    confirmAction({ title: 'Discard the saved copy?', text: 'The unreadable data kept from an earlier visit will be deleted.', confirmLabel: 'Discard copy', danger: true })
      .then(function (yes) {
        if (!yes) return;
        try { window.localStorage.removeItem(S.BACKUP_KEY); } catch (e) { notify('error', 'Could not remove the copy.'); }
        renderData();
        notify('success', 'The saved copy was discarded.');
      });
  });

  /* ---------- top-level buttons, palette, other tabs ---------- */
  $('new-task-btn').addEventListener('click', function () { openTaskDialog(null); });
  $('new-course-btn').addEventListener('click', function () { openCourseDialog(null); });
  $('empty-new-task').addEventListener('click', function () { openTaskDialog(null); });
  $('empty-new-course').addEventListener('click', function () { openCourseDialog(null); });

  [taskDlg, courseDlg, logDlg, $('confirm-dialog')].forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
  });

  if (NS.palette) {
    NS.palette.register({ id: 'new-task', label: 'Create a task', hint: 'Planner', run: function () { openTaskDialog(null); } });
    NS.palette.register({ id: 'new-course', label: 'Add a course', hint: 'Planner', run: function () { openCourseDialog(null); } });
    NS.palette.register({ id: 'clear-filters', label: 'Clear task filters', hint: 'Planner', run: clearFilters });
    NS.palette.register({ id: 'export', label: 'Export planner data (JSON)', hint: 'Planner', run: exportData });
  }

  // Another tab changed the saved planner: reload it instead of overwriting it with stale data.
  window.addEventListener('storage', function (e) {
    if (e.key !== S.STORAGE_KEY) return;
    var again = S.loadState();
    state = again.state;
    renderAll();
    notify('info', 'The planner was changed in another tab, so this page reloaded the latest data.');
  });

  // Overdue and "due in" wording depends on the clock, so refresh when the tab comes back.
  (function openGuideForNewUsers() {
    var guide = $('howto');
    if (guide && state.tasks.length === 0 && state.courses.length === 0) guide.open = true;
  })();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) renderAll(); });

  renderAll();
  if (window.location.hash === '#new-task') {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    openTaskDialog(null);
  }
})();
