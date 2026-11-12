/*
 * home.js — the "Planner right now" snapshot on the homepage.
 * Reads the visitor's own saved planner from this browser. Nothing is sent anywhere,
 * and when there is no data it says so instead of showing a number.
 */
(function () {
  'use strict';
  var mount = document.getElementById('home-snapshot');
  if (!mount || !window.NS || !NS.store) return;
  var S = NS.store;

  function add(parent, tag, text, cls) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function figure(dl, label, value) {
    var wrap = document.createElement('div');
    add(wrap, 'dt', label);
    add(wrap, 'dd', value);
    dl.appendChild(wrap);
  }

  var loaded = S.loadState();
  var tasks = loaded.state.tasks;
  mount.textContent = '';

  if (!loaded.storageOk) {
    add(mount, 'p', 'This browser is blocking saved data, so the planner snapshot is unavailable here.', 'note');
    return;
  }
  if (!tasks.length) {
    var box = add(mount, 'div', '', 'empty');
    add(box, 'h3', 'The planner is empty');
    add(box, 'p', 'No tasks have been added in this browser yet, so there is nothing to count. Add courses and tasks in the planner and the numbers appear here.');
    var link = add(box, 'a', 'Open the planner', 'btn');
    link.href = 'planner.html';
    return;
  }

  var now = new Date();
  var open = tasks.filter(function (t) { return t.status !== 'done'; });
  var overdue = open.filter(function (t) { return S.isOverdue(t, now); });
  var upcoming = open.filter(function (t) { return S.deadlineOf(t) && !S.isOverdue(t, now); })
    .sort(function (a, b) { return S.deadlineOf(a) - S.deadlineOf(b); });

  var dl = document.createElement('dl');
  dl.className = 'snapshot-figures';
  figure(dl, 'Open tasks', String(open.length));
  figure(dl, 'Overdue', String(overdue.length));
  figure(dl, 'Done', String(tasks.length - open.length));
  mount.appendChild(dl);

  var line = upcoming.length
    ? 'Next deadline: ' + upcoming[0].title + ' (' + S.describeDeadline(upcoming[0], now) + ').'
    : 'No open task has a deadline.';
  add(mount, 'p', line);
  add(mount, 'p', 'Counted from the planner saved in this browser on this device. Open means not completed; overdue means open with a deadline that has passed.', 'note');
})();
