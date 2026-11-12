/*
 * visualiser.js — bubble sort, one step at a time.
 *
 * buildSteps() runs the real algorithm once and records every comparison and swap as a
 * snapshot. The screen then just walks through those snapshots, so what you see is the
 * actual execution, not a canned animation. buildSteps is also exported for Node tests.
 */
(function (root) {
  'use strict';

  function buildSteps(input) {
    var a = input.slice();
    var n = a.length;
    var steps = [];
    var compares = 0, swaps = 0;

    function snap(cmp, swapped, sortedFrom, msg) {
      steps.push({ arr: a.slice(), cmp: cmp, swapped: swapped, sortedFrom: sortedFrom, compares: compares, swaps: swaps, msg: msg });
    }

    snap(null, false, n, 'Start. ' + n + ' values, not sorted yet.');
    var end = n; // everything at index >= end is already in its final place
    while (end > 1) {
      var swappedThisPass = false;
      for (var i = 0; i < end - 1; i++) {
        compares++;
        snap([i, i + 1], false, end, 'Compare ' + a[i] + ' and ' + a[i + 1] + '. ' + (a[i] > a[i + 1] ? 'The left one is bigger, so they swap.' : 'Already in order, no swap.'));
        if (a[i] > a[i + 1]) {
          var tmp = a[i]; a[i] = a[i + 1]; a[i + 1] = tmp;
          swaps++;
          swappedThisPass = true;
          snap([i, i + 1], true, end, 'Swapped. ' + a[i] + ' now sits before ' + a[i + 1] + '.');
        }
      }
      end--;
      if (!swappedThisPass) { end = 0; break; } // a pass with no swaps means the list is sorted
    }
    snap(null, false, 0, 'Done. Sorted after ' + compares + ' comparisons and ' + swaps + ' swaps.');
    return steps;
  }

  var api = { buildSteps: buildSteps };
  root.NS = root.NS || {};
  root.NS.visualiser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  /* ---------- page wiring (skipped in Node) ---------- */
  if (typeof document === 'undefined') return;
  var barsEl = document.getElementById('viz-bars');
  if (!barsEl) return;

  var statusEl = document.getElementById('viz-status');
  var arrayEl = document.getElementById('viz-array');
  var countsEl = document.getElementById('viz-counts');
  var stepBtn = document.getElementById('viz-step');
  var playBtn = document.getElementById('viz-play');
  var endBtn = document.getElementById('viz-end');
  var resetBtn = document.getElementById('viz-reset');
  var newBtn = document.getElementById('viz-new');
  var speedSel = document.getElementById('viz-speed');
  var motionNote = document.getElementById('viz-motion-note');

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var initial = [34, 12, 27, 5, 40, 19, 8, 31, 22, 15];
  var steps = buildSteps(initial);
  var index = 0;
  var timer = null;

  function stateOf(step, i) {
    if (i >= step.sortedFrom) return 'sorted';
    if (step.cmp && (step.cmp[0] === i || step.cmp[1] === i)) return step.swapped ? 'swap' : 'compare';
    return 'default';
  }

  function paint() {
    var step = steps[index];
    var max = Math.max.apply(null, step.arr);
    barsEl.textContent = '';
    step.arr.forEach(function (v, i) {
      var bar = document.createElement('div');
      bar.className = 'bar';
      bar.setAttribute('data-state', stateOf(step, i));
      var label = document.createElement('span');
      label.textContent = String(v);
      var fill = document.createElement('i');
      fill.style.height = (v / max * 10) + 'rem';
      bar.appendChild(label);
      bar.appendChild(fill);
      barsEl.appendChild(bar);
    });
    var order = step.arr.join(', ');
    barsEl.setAttribute('aria-label', 'Bar chart of the current order: ' + order);
    arrayEl.textContent = 'Order now: ' + order;
    statusEl.textContent = 'Step ' + index + ' of ' + (steps.length - 1) + '. ' + step.msg;
    countsEl.textContent = 'So far in this run: ' + step.compares + ' comparisons, ' + step.swaps + ' swaps.';
    var atEnd = index >= steps.length - 1;
    stepBtn.disabled = atEnd;
    endBtn.disabled = atEnd;
    if (atEnd) stop();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    playBtn.textContent = 'Play';
    playBtn.setAttribute('aria-pressed', 'false');
    playBtn.disabled = index >= steps.length - 1;
  }

  function advance() { if (index < steps.length - 1) { index++; paint(); } }

  function play() {
    if (timer || index >= steps.length - 1) return;
    playBtn.textContent = 'Pause';
    playBtn.setAttribute('aria-pressed', 'true');
    timer = setInterval(advance, +speedSel.value);
  }

  function load(values) {
    stop();
    initial = values;
    steps = buildSteps(initial);
    index = 0;
    paint();
    playBtn.disabled = false;
  }

  stepBtn.addEventListener('click', function () { stop(); advance(); });
  playBtn.addEventListener('click', function () { if (timer) stop(); else play(); });
  endBtn.addEventListener('click', function () { stop(); index = steps.length - 1; paint(); });
  resetBtn.addEventListener('click', function () { load(initial); });
  newBtn.addEventListener('click', function () {
    var vals = [];
    for (var i = 0; i < 10; i++) vals.push(1 + Math.floor(Math.random() * 40));
    load(vals);
  });
  speedSel.addEventListener('change', function () { if (timer) { stop(); play(); } });

  if (reduce) {
    // Reduced motion: no autoplay. The person steps through at their own pace.
    playBtn.hidden = true;
    speedSel.closest('.speed').hidden = true;
    if (motionNote) { motionNote.hidden = false; }
  }
  paint();
})(typeof window !== 'undefined' ? window : globalThis);
