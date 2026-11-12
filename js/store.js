/*
 * store.js — planner data model, validation, persistence and date logic.
 * No DOM code here, so it can be tested in Node (see tests/).
 *
 * Date rules (also in the README):
 *  - dueDate is a plain "YYYY-MM-DD" string, dueTime an optional "HH:MM".
 *  - Both are read as LOCAL time on the device. No timezone conversion.
 *  - A task with a date but no time is due at the END of that day (23:59:59).
 *  - A task is overdue only if it is not completed and its deadline has passed.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'azukaspace.planner.v1';
  var BACKUP_KEY = 'azukaspace.planner.v1.unreadable-backup';
  // The site was first called NULLSPACE. Planner data saved under that name is still read (never deleted
  // by a read), so renaming the site does not lose anyone's tasks. The next save writes the new key.
  var LEGACY_STORAGE_KEY = 'nullspace.planner.v1';
  var SCHEMA = 1;

  var DOMAINS = ['academic', 'engineering'];
  var PRIORITIES = ['low', 'medium', 'high'];
  var STATUSES = ['todo', 'doing', 'done'];
  var PERIODS = ['day', 'week', 'month'];
  var LIMITS = {
    title: 120, category: 40, type: 40, notes: 1000,
    code: 20, courseTitle: 100, term: 40, courseNotes: 500,
    maxEstimateMin: 60000, maxLogMin: 1440
  };

  function defaultState() {
    return {
      schema: SCHEMA,
      courses: [],
      tasks: [],
      log: [],
      prefs: { engPct: 60, periodHours: 20, period: 'week' },
      timer: null
    };
  }

  function newId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- dates ---------- */

  function parseDateOnly(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 2000 || y > 2100) return null;
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function parseTime(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{2}):(\d{2})$/.exec(s);
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return { h: h, mi: mi };
  }

  function deadlineOf(task) {
    var d = parseDateOnly(task.dueDate);
    if (!d) return null;
    var t = parseTime(task.dueTime);
    if (t) d.setHours(t.h, t.mi, 0, 0);
    else d.setHours(23, 59, 59, 999);
    return d;
  }

  function isOverdue(task, now) {
    if (task.status === 'done') return false;
    var dl = deadlineOf(task);
    return !!dl && dl.getTime() < now.getTime();
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function toDateInputValue(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /* Range is [start, end). Weeks start on Monday. */
  function periodRange(period, now) {
    var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    if (period === 'day') return { start: new Date(y, m, d), end: new Date(y, m, d + 1) };
    if (period === 'month') return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
    var dow = (now.getDay() + 6) % 7;
    return { start: new Date(y, m, d - dow), end: new Date(y, m, d - dow + 7) };
  }

  /* ---------- formatting ---------- */

  function formatMinutes(min) {
    min = Math.round(min);
    if (!isFinite(min) || min <= 0) return '0m';
    var h = Math.floor(min / 60), r = min % 60;
    if (h && r) return h + 'h ' + r + 'm';
    return h ? h + 'h' : r + 'm';
  }

  function shortDur(min) {
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h';
  }

  /* Human wording for how far away a deadline is. */
  function describeDeadline(task, now) {
    var dl = deadlineOf(task);
    if (!dl) return '';
    var hasTime = !!parseTime(task.dueTime);
    var dayDiff = Math.round((startOfDay(dl) - startOfDay(now)) / 86400000);
    var diffMin = Math.round(Math.abs(dl - now) / 60000);
    if (hasTime && dayDiff === 0) {
      return dl < now ? 'overdue by ' + shortDur(diffMin) : 'due in ' + shortDur(diffMin);
    }
    if (dayDiff === 0) return 'due today';
    if (dayDiff === 1) return 'due tomorrow';
    if (dayDiff > 1) return 'due in ' + dayDiff + ' days';
    if (dayDiff === -1) return 'overdue since yesterday';
    return 'overdue by ' + Math.abs(dayDiff) + ' days';
  }

  /* ---------- derived numbers ---------- */

  function taskLoggedMin(state, taskId) {
    var total = 0;
    state.log.forEach(function (e) { if (e.taskId === taskId) total += e.minutes; });
    return total;
  }

  function loggedInRange(state, range, domain) {
    var byId = {};
    state.tasks.forEach(function (t) { byId[t.id] = t; });
    var total = 0;
    state.log.forEach(function (e) {
      var t = byId[e.taskId];
      if (!t || t.domain !== domain) return;
      var at = new Date(e.at).getTime();
      if (at >= range.start.getTime() && at < range.end.getTime()) total += e.minutes;
    });
    return total;
  }

  /* hours in the period split by the engineering percentage, in whole minutes */
  function computeTargets(prefs) {
    var totalMin = Math.round(prefs.periodHours * 60);
    var eng = Math.round(totalMin * prefs.engPct / 100);
    return { totalMin: totalMin, engineeringMin: eng, academicMin: totalMin - eng };
  }

  /* ---------- validation / sanitising ---------- */

  function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  /* Returns {state, problems, fatal}. Records that cannot be repaired are dropped. */
  function sanitize(raw) {
    var problems = [];
    var st = defaultState();
    if (!isPlainObject(raw)) return { state: st, problems: ['Data is not an object.'], fatal: true };
    if (raw.schema !== SCHEMA) return { state: st, problems: ['Missing or unsupported schema version.'], fatal: true };

    function text(v, max, label, fallback) {
      if (v === undefined || v === null) return fallback;
      if (typeof v !== 'string') { problems.push(label + ' is not text.'); return fallback; }
      var t = v.trim();
      if (t.length > max) { problems.push(label + ' is longer than ' + max + ' characters.'); return t.slice(0, max); }
      return t;
    }
    function listOf(name) {
      if (raw[name] === undefined) return [];
      if (!Array.isArray(raw[name])) { problems.push(name + ' is not a list.'); return []; }
      return raw[name];
    }

    var courseIds = {};
    listOf('courses').forEach(function (c, i) {
      var label = 'Course #' + (i + 1);
      if (!isPlainObject(c) || typeof c.id !== 'string' || !c.id || courseIds[c.id]) { problems.push(label + ' has a missing or duplicate id.'); return; }
      var code = text(c.code, LIMITS.code, label + ' code', '');
      var title = text(c.title, LIMITS.courseTitle, label + ' title', '');
      if (!code || !title) { problems.push(label + ' needs a code and a title.'); return; }
      courseIds[c.id] = true;
      st.courses.push({
        id: c.id, code: code, title: title,
        term: text(c.term, LIMITS.term, label + ' term', ''),
        notes: text(c.notes, LIMITS.courseNotes, label + ' notes', '')
      });
    });

    var taskIds = {};
    listOf('tasks').forEach(function (t, i) {
      var label = 'Task #' + (i + 1);
      if (!isPlainObject(t) || typeof t.id !== 'string' || !t.id || taskIds[t.id]) { problems.push(label + ' has a missing or duplicate id.'); return; }
      var title = text(t.title, LIMITS.title, label + ' title', '');
      if (!title) { problems.push(label + ' has no title.'); return; }
      if (DOMAINS.indexOf(t.domain) < 0) { problems.push(label + ' has an unknown domain.'); return; }
      var dueDate = null;
      if (t.dueDate !== null && t.dueDate !== undefined && t.dueDate !== '') {
        if (parseDateOnly(t.dueDate)) dueDate = t.dueDate; else problems.push(label + ' has an invalid due date.');
      }
      var dueTime = null;
      if (dueDate && t.dueTime) {
        if (parseTime(t.dueTime)) dueTime = t.dueTime; else problems.push(label + ' has an invalid due time.');
      }
      var est = null;
      if (t.estMin !== null && t.estMin !== undefined) {
        if (typeof t.estMin === 'number' && isFinite(t.estMin) && t.estMin >= 1 && t.estMin <= LIMITS.maxEstimateMin) est = Math.round(t.estMin);
        else problems.push(label + ' has an invalid estimate.');
      }
      var courseId = null;
      if (t.courseId) {
        if (t.domain === 'academic' && courseIds[t.courseId]) courseId = t.courseId;
        else problems.push(label + ' points to a course that does not exist.');
      }
      taskIds[t.id] = true;
      st.tasks.push({
        id: t.id, title: title, domain: t.domain, courseId: courseId,
        category: text(t.category, LIMITS.category, label + ' category', ''),
        type: text(t.type, LIMITS.type, label + ' type', ''),
        dueDate: dueDate, dueTime: dueTime,
        priority: PRIORITIES.indexOf(t.priority) >= 0 ? t.priority : 'medium',
        status: STATUSES.indexOf(t.status) >= 0 ? t.status : 'todo',
        estMin: est,
        notes: text(t.notes, LIMITS.notes, label + ' notes', ''),
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
        completedAt: typeof t.completedAt === 'string' ? t.completedAt : null
      });
    });

    var logIds = {};
    listOf('log').forEach(function (e, i) {
      var label = 'Time entry #' + (i + 1);
      if (!isPlainObject(e) || typeof e.id !== 'string' || !e.id || logIds[e.id]) { problems.push(label + ' has a missing or duplicate id.'); return; }
      if (!taskIds[e.taskId]) { problems.push(label + ' belongs to a task that does not exist.'); return; }
      if (typeof e.minutes !== 'number' || !isFinite(e.minutes) || e.minutes <= 0 || e.minutes > LIMITS.maxLogMin) { problems.push(label + ' has invalid minutes.'); return; }
      if (typeof e.at !== 'string' || isNaN(new Date(e.at).getTime())) { problems.push(label + ' has an invalid date.'); return; }
      logIds[e.id] = true;
      st.log.push({ id: e.id, taskId: e.taskId, minutes: Math.round(e.minutes), at: e.at, source: e.source === 'timer' ? 'timer' : 'manual' });
    });

    if (raw.prefs !== undefined) {
      var p = raw.prefs;
      if (!isPlainObject(p)) problems.push('Preferences are not an object.');
      else {
        if (typeof p.engPct === 'number' && p.engPct >= 50 && p.engPct <= 70) st.prefs.engPct = Math.round(p.engPct);
        else if (p.engPct !== undefined) problems.push('Engineering share must be between 50 and 70.');
        if (typeof p.periodHours === 'number' && p.periodHours >= 1 && p.periodHours <= 500) st.prefs.periodHours = p.periodHours;
        else if (p.periodHours !== undefined) problems.push('Planned hours must be between 1 and 500.');
        if (PERIODS.indexOf(p.period) >= 0) st.prefs.period = p.period;
        else if (p.period !== undefined) problems.push('Unknown planning period.');
      }
    }

    if (raw.timer !== undefined && raw.timer !== null) {
      var tm = raw.timer;
      if (isPlainObject(tm) && taskIds[tm.taskId] && typeof tm.startedAt === 'string' && !isNaN(new Date(tm.startedAt).getTime())) {
        st.timer = { taskId: tm.taskId, startedAt: tm.startedAt };
      } else problems.push('Running timer data was invalid and was dropped.');
    }

    return { state: st, problems: problems, fatal: false };
  }

  /* ---------- persistence ---------- */

  function storageGet(key) { return root.localStorage.getItem(key); }

  function keepBackup(rawText) {
    try { if (storageGet(BACKUP_KEY) === null) root.localStorage.setItem(BACKUP_KEY, rawText); } catch (e) { /* best effort */ }
  }

  /*
   * loadState never throws. opts.backup: keep a copy of data that could not be
   * read cleanly before anything overwrites it (planner page only).
   */
  function loadState(opts) {
    opts = opts || {};
    var rawText;
    try {
      rawText = storageGet(STORAGE_KEY);
      if (rawText === null || rawText === undefined) rawText = storageGet(LEGACY_STORAGE_KEY);
    }
    catch (e) {
      return { state: defaultState(), notices: [{ kind: 'error', text: 'Browser storage is unavailable here (private mode or blocked). The planner works, but nothing will be saved.' }], storageOk: false };
    }
    if (rawText === null || rawText === undefined) return { state: defaultState(), notices: [], storageOk: true };

    var parsed;
    try { parsed = JSON.parse(rawText); }
    catch (e) {
      if (opts.backup) keepBackup(rawText);
      return { state: defaultState(), notices: [{ kind: 'error', text: 'Saved planner data could not be read, so the planner started empty. A copy of the unreadable data was kept in this browser.' }], storageOk: true };
    }
    var result = sanitize(parsed);
    var notices = [];
    if (result.fatal) {
      if (opts.backup) keepBackup(rawText);
      notices.push({ kind: 'error', text: 'Saved planner data had an unsupported format, so the planner started empty. A copy of it was kept in this browser.' });
    } else if (result.problems.length) {
      if (opts.backup) keepBackup(rawText);
      notices.push({ kind: 'warning', text: result.problems.length + ' problem(s) found in saved data; invalid items were skipped or repaired. A copy of the original was kept.' });
    }
    return { state: result.state, notices: notices, storageOk: true, problems: result.problems };
  }

  function saveState(state) {
    try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return { ok: true }; }
    catch (e) { return { ok: false, error: e }; }
  }

  function clearState() {
    try { root.localStorage.removeItem(STORAGE_KEY); root.localStorage.removeItem(LEGACY_STORAGE_KEY); return { ok: true }; }
    catch (e) { return { ok: false, error: e }; }
  }

  /* minutes logged per local calendar day, for `days` days starting at `start` (a local Date at midnight).
     domain: 'all' | 'engineering' | 'academic'. Entries whose task no longer exists are ignored. */
  function dailyMinutes(state, start, days, domain) {
    var byId = {};
    state.tasks.forEach(function (t) { byId[t.id] = t; });
    var out = [];
    for (var i = 0; i < days; i++) out.push({ date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), minutes: 0 });
    state.log.forEach(function (e) {
      var t = byId[e.taskId];
      if (!t || (domain !== 'all' && t.domain !== domain)) return;
      var at = new Date(e.at);
      var idx = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()) - new Date(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
      if (idx >= 0 && idx < days) out[idx].minutes += e.minutes;
    });
    return out;
  }

  /* fixed thresholds so the colour means the same thing every week: 0, <30m, <90m, <180m, 180m+ */
  var HEAT_STEPS = [1, 30, 90, 180];
  function heatLevel(min) {
    if (!(min > 0)) return 0;
    return min < HEAT_STEPS[1] ? 1 : min < HEAT_STEPS[2] ? 2 : min < HEAT_STEPS[3] ? 3 : 4;
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, LEGACY_STORAGE_KEY: LEGACY_STORAGE_KEY, BACKUP_KEY: BACKUP_KEY, SCHEMA: SCHEMA, DOMAINS: DOMAINS, PRIORITIES: PRIORITIES, STATUSES: STATUSES, PERIODS: PERIODS, LIMITS: LIMITS,
    defaultState: defaultState, newId: newId,
    parseDateOnly: parseDateOnly, parseTime: parseTime, deadlineOf: deadlineOf, isOverdue: isOverdue,
    startOfDay: startOfDay, toDateInputValue: toDateInputValue, periodRange: periodRange,
    formatMinutes: formatMinutes, describeDeadline: describeDeadline,
    taskLoggedMin: taskLoggedMin, dailyMinutes: dailyMinutes, heatLevel: heatLevel, loggedInRange: loggedInRange, computeTargets: computeTargets,
    sanitize: sanitize, loadState: loadState, saveState: saveState, clearState: clearState
  };

  root.NS = root.NS || {};
  root.NS.store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
