/*
 * projects.js — renders NS.projects into case-study layouts.
 * All text goes in through textContent, and links are only created for https:// URLs.
 */
(function () {
  'use strict';
  var root = document.getElementById('projects-root');
  if (!root || !window.NS) return;

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function isHttps(u) {
    try { return new URL(u).protocol === 'https:'; } catch (e) { return false; }
  }

  function isLocalImage(src) {
    return typeof src === 'string' && /^assets\/images\/[\w\-./]+$/.test(src) && src.indexOf('..') < 0;
  }

  function linkItem(label, url) {
    var a = h('a', '', label);
    a.href = url;
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    var sr = h('span', 'visually-hidden', ' (opens in a new tab)');
    a.appendChild(sr);
    return a;
  }

  function metaPair(dl, term, valueNode) {
    dl.appendChild(h('dt', '', term));
    var dd = h('dd');
    dd.appendChild(valueNode);
    dl.appendChild(dd);
  }

  function section(body, heading, text) {
    if (!text) return;
    body.appendChild(h('h3', '', heading));
    body.appendChild(h('p', '', String(text)));
  }

  function renderProject(p, index) {
    var art = h('article', 'case-study' + (index === 0 ? ' featured' : ''));

    var head = h('header', 'case-head');
    head.appendChild(h('span', 'case-index', String(index + 1).padStart(2, '0')));
    head.appendChild(h('h2', '', String(p.name || 'Untitled project')));
    if (p.summary) head.appendChild(h('p', 'case-summary', String(p.summary)));
    art.appendChild(head);

    var grid = h('div', 'case-grid');
    var meta = h('div', 'case-meta');
    var dl = h('dl');
    if (p.status) metaPair(dl, 'Status', h('span', '', String(p.status)));
    if (Array.isArray(p.tech) && p.tech.length) {
      var ul = h('ul', 'tech-list');
      p.tech.forEach(function (t) { ul.appendChild(h('li', 'tag', String(t))); });
      metaPair(dl, 'Built with', ul);
    }
    var links = h('span');
    var any = false;
    if (isHttps(p.repoUrl)) { links.appendChild(linkItem('Source code', p.repoUrl)); any = true; }
    if (isHttps(p.demoUrl)) { if (any) links.appendChild(document.createTextNode(' and ')); links.appendChild(linkItem('Live site', p.demoUrl)); any = true; }
    metaPair(dl, 'Links', any ? links : h('span', '', 'No public links yet'));
    meta.appendChild(dl);

    var body = h('div', 'case-body');
    section(body, 'The problem', p.problem);
    section(body, 'Approach', p.approach);
    section(body, 'What I did', p.contribution);
    section(body, 'Lessons and next steps', p.lessons);
    grid.appendChild(meta);
    grid.appendChild(body);
    art.appendChild(grid);

    var shots = Array.isArray(p.images) ? p.images.filter(function (im) { return im && isLocalImage(im.src) && im.alt; }) : [];
    if (shots.length) {
      var media = h('div', 'case-media');
      shots.forEach(function (im) {
        var fig = h('figure');
        var img = document.createElement('img');
        img.src = im.src;
        img.alt = String(im.alt);
        img.loading = 'lazy';
        // Optional width and height let the browser reserve the space before the image loads.
        if (im.width > 0 && im.height > 0) { img.width = Math.round(im.width); img.height = Math.round(im.height); }
        fig.appendChild(img);
        if (im.caption) fig.appendChild(h('figcaption', '', String(im.caption)));
        media.appendChild(fig);
      });
      art.appendChild(media);
    }
    return art;
  }

  var list = h('div');
  var emptyBox = document.getElementById('projects-empty');
  var toggle = document.getElementById('example-toggle');
  var exampleOn = false;

  function paint() {
    list.textContent = '';
    var real = Array.isArray(NS.projects) ? NS.projects : [];
    real.forEach(function (p, i) {
      if (i === 1) list.appendChild(h('p', 'section-label archive-label', 'Archive'));
      list.appendChild(renderProject(p, i));
    });
    if (emptyBox) emptyBox.hidden = real.length > 0;
    if (toggle) toggle.hidden = real.length > 0;
    if (!real.length && exampleOn) {
      var banner = h('p', 'example-banner');
      banner.appendChild(h('strong', '', 'Example only. '));
      banner.appendChild(document.createTextNode('The entry below is not my work. It shows where each part of a real project will go.'));
      list.appendChild(banner);
      (NS.exampleProjects || []).forEach(function (p, i) { list.appendChild(renderProject(p, i)); });
    }
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      exampleOn = !exampleOn;
      toggle.setAttribute('aria-expanded', String(exampleOn));
      toggle.textContent = exampleOn ? 'Hide the example layout' : 'Preview the layout with an example';
      paint();
    });
  }

  root.appendChild(list);
  paint();
})();
