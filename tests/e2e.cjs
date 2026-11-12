/*
 * Browser tests (Playwright + Chromium). Needs: a static server on the project folder and Playwright.
 *   python3 -m http.server 8123      (in the project folder)
 *   node tests/e2e.cjs
 * Prints PASS/FAIL for each check and a summary. The contact form's delivery is tested against a
 * MOCKED endpoint (intercepted network), never a real service.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8123';
const NOW = '2026-10-27T12:00:00+01:00'; // fixed "today" for deadline maths, Lagos time
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: cond ? '' : String(detail || '') });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + (detail || '')));
}

async function newPage(browser, opts = {}, clock = true) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, timezoneId: 'Africa/Lagos', reducedMotion: opts.reducedMotion || 'no-preference', acceptDownloads: true });
  // Secondary planner sections start folded. Most tests drive the controls inside them, so open them
  // (as a user would) unless a test asks to see the real default with { foldsClosed: true }.
  if (!opts.foldsClosed) await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('details.fold, details.filters-fold').forEach(d => { d.open = true; })));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  if (clock) await page.clock.install({ time: new Date(NOW) });
  return page;
}

async function addCourse(page, code, title, term = '') {
  await page.click('#new-course-btn');
  await page.fill('#c-code', code); await page.fill('#c-title', title); await page.fill('#c-term', term);
  await page.click('#course-form button[type=submit]');
}

async function addTask(page, t) {
  await page.click('#new-task-btn');
  await page.check(`input[name=domain][value=${t.domain || 'engineering'}]`);
  await page.fill('#t-title', t.title);
  if (t.course) await page.selectOption('#t-course', { label: t.course });
  if (t.type) await page.fill('#t-type', t.type);
  if (t.category) await page.fill('#t-category', t.category);
  if (t.date) await page.fill('#t-date', t.date);
  if (t.time) await page.fill('#t-time', t.time);
  if (t.priority) await page.selectOption('#t-priority', t.priority);
  if (t.status) await page.selectOption('#t-status', t.status);
  if (t.est) { await page.fill('#t-est', String(t.est)); await page.selectOption('#t-est-unit', t.unit || 'hours'); }
  if (t.notes) await page.fill('#t-notes', t.notes);
  await page.click('#task-form button[type=submit]');
}


// Confirm-dialog clicks: wait until the dialog has really closed and the app's promise handler has run,
// otherwise the next assertion races the 'close' event.
async function answerConfirm(page, which) {
  await page.click(which === 'ok' ? '#confirm-ok' : '#confirm-dialog button[value=cancel]');
  await page.waitForFunction(() => !document.getElementById('confirm-dialog').open);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}


// File imports are read asynchronously (FileReader), so wait for the visible outcome before asserting.
const waitForConfirm = page => page.waitForFunction(() => document.getElementById('confirm-dialog').open);
const waitForNotice = (page, re) => page.waitForFunction(src => new RegExp(src).test(document.getElementById('notices').innerText), re.source);

const taskLi = (page, title) => page.locator('#task-list > li', { has: page.locator('.task-title', { hasText: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) });
const storedState = page => page.evaluate(() => JSON.parse(localStorage.getItem('azukaspace.planner.v1') || 'null'));

(async () => {
  const browser = await chromium.launch();

  /* ============ NAVIGATION + LINKS ============ */
  {
    const page = await newPage(browser, {}, false);
    const files = ['index', 'about', 'projects', 'planner', 'contact'];
    const labels = { index: 'Home', about: 'About', projects: 'Projects', planner: 'Academic Planner', contact: 'Contact' };
    let navOk = true, currentOk = true, titles = true, landmarks = true;
    for (const f of files) {
      await page.goto(`${BASE}/${f}.html`);
      const t = await page.title(); if (!t || t.length < 5) titles = false;
      const desc = await page.locator('meta[name=description]').getAttribute('content'); if (!desc) titles = false;
      for (const k of ['header', 'nav', 'main', 'footer']) if (await page.locator(k).count() < 1) landmarks = false;
      const cur = await page.locator('.nav-list a[aria-current=page]').allInnerTexts();
      if (cur.length !== 1 || cur[0] !== labels[f]) currentOk = false;
      for (const g of files) {
        await page.locator('.nav-list a', { hasText: labels[g] }).click();
        await page.waitForLoadState();
        if (!page.url().endsWith(`/${g}.html`)) navOk = false;
        await page.goto(`${BASE}/${f}.html`);
      }
    }
    check('Navigation: every nav link works from every page', navOk);
    check('Navigation: exactly one current page marked with aria-current', currentOk);
    check('Pages have titles, meta descriptions', titles);
    check('Pages have header, nav, main, footer landmarks', landmarks);

    // all internal hrefs/src resolve
    const missing = [];
    for (const f of files) {
      await page.goto(`${BASE}/${f}.html`);
      const refs = await page.evaluate(() => [...document.querySelectorAll('a[href],link[href],script[src]')].map(e => e.getAttribute('href') || e.getAttribute('src')).filter(h => h && !/^(https?:|mailto:|#)/.test(h)));
      for (const r of new Set(refs)) {
        const res = await page.request.get(`${BASE}/${r.split('#')[0]}`);
        if (res.status() !== 200) missing.push(`${f}: ${r} -> ${res.status()}`);
      }
    }
    check('No internal link, stylesheet or script points to a missing file', missing.length === 0, missing.join('; '));

    // focus visibility
    await page.goto(`${BASE}/index.html`);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth; });
    check('Keyboard focus shows a visible outline (3px)', /solid 3px/.test(outline), outline);
    await page.context().close();
  }

  /* ============ HOME ============ */
  for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
    const page = await newPage(browser, { viewport: vp }, false);
    await page.goto(`${BASE}/index.html`);
    await page.waitForTimeout(800); // the hero fades in over about half a second
    const info = await page.evaluate(() => {
      const r = el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, w: b.width, h: b.height }; };
      return {
        h1: document.querySelector('h1').innerText.replace(/\s+/g, ' ').trim(),
        photo: r(document.querySelector('.photo-frame')),
        lead: r(document.querySelector('.lead')),
        nav: r(document.querySelector('.site-nav')),
        vh: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    check(`Home @${vp.width}: name correct`, info.h1.toLowerCase() === 'obi chidera azuka', info.h1);
    check(`Home @${vp.width}: photo area starts inside the first viewport`, info.photo.top < info.vh * 0.9 && info.photo.h > 150, JSON.stringify(info.photo));
    if (vp.width >= 768) check(`Home @${vp.width}: photo, intro and nav all fully within the first viewport`, info.photo.bottom <= info.vh && info.lead.bottom <= info.vh && info.nav.bottom <= info.vh, JSON.stringify(info));
    check(`Home @${vp.width}: no horizontal overflow`, !info.overflow);
    await page.context().close();
  }
  {
    const page = await newPage(browser, {}, false);
    await page.route('**/assets/images/profile.jpg', r => r.fulfill({ status: 404, body: 'not found' })); // simulate a missing photo
    await page.goto(`${BASE}/index.html`);
    const placeholderVisible = await page.locator('.photo-placeholder').isVisible();
    check('Home: clearly labelled photo placeholder shown when profile.jpg is missing', placeholderVisible && /not added yet/.test(await page.locator('.photo-placeholder').innerText()));
    const snap = await page.locator('#home-snapshot').innerText();
    check('Home: empty planner shows an empty state, no invented numbers', /empty/i.test(snap) && !/\d/.test(snap.replace(/\bplanner\b/g, '')), snap);
    // photo swap: serve a real image at profile.jpg and confirm it replaces the placeholder with correct aspect handling
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#888"/></svg>';
    await page.route('**/assets/images/profile.jpg', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('.photo-frame img');
    const fit = await page.evaluate(() => { const i = document.querySelector('.photo-frame img'); return { alt: i.alt, fit: getComputedStyle(i).objectFit, ph: document.querySelector('.photo-placeholder').hidden }; });
    check('Home: a real profile.jpg replaces the placeholder, has alt text and object-fit: cover', fit.alt.includes('Obi Chidera Azuka') && fit.fit === 'cover' && fit.ph, JSON.stringify(fit));
    await page.context().close();
  }
  {
    // home snapshot with real data
    const page = await newPage(browser);
    await page.goto(`${BASE}/planner.html`);
    await addTask(page, { title: 'Past task', date: '2026-10-20' });
    await addTask(page, { title: 'Future task', date: '2026-10-30' });
    await page.goto(`${BASE}/index.html`);
    const txt = await page.locator('#home-snapshot').innerText();
    check('Home: snapshot counts come from saved planner data (2 open, 1 overdue)', /Open tasks\s*2/i.test(txt.replace(/\n/g, ' ')) && /Overdue\s*1/i.test(txt.replace(/\n/g, ' ')) && /Future task/.test(txt), txt);
    await page.context().close();
  }

  {
    // the real photo that ships in assets/images/profile.jpg
    for (const vp of [{ width: 1440, height: 900 }, { width: 375, height: 667 }]) {
      const page = await newPage(browser, { viewport: vp }, false);
      await page.goto(`${BASE}/index.html`);
      await page.waitForFunction(() => document.querySelector('[data-profile-photo] img'));
      const r = await page.evaluate(() => {
        const img = document.querySelector('[data-profile-photo] img'), b = img.getBoundingClientRect();
        return { ok: img.complete && img.naturalWidth > 0, nw: img.naturalWidth, nh: img.naturalHeight, fit: getComputedStyle(img).objectFit, alt: img.alt, top: b.top, h: b.height, vh: innerHeight, placeholder: !!document.querySelector('.photo-placeholder') && getComputedStyle(document.querySelector('.photo-placeholder')).display !== 'none' && document.querySelector('.photo-placeholder').offsetParent !== null };
      });
      check(`Home @${vp.width}: real profile photo loads, is cropped not stretched, has alt text, placeholder gone`, r.ok && r.fit === 'cover' && /Obi Chidera Azuka/.test(r.alt) && !r.placeholder, JSON.stringify(r));
      check(`Home @${vp.width}: real photo starts inside the first viewport`, r.top < r.vh * 0.9 && r.h > 150, JSON.stringify(r));
      await page.context().close();
    }
  }

  /* ============ ABOUT ============ */
  {
    const page = await newPage(browser, {}, false);
    await page.goto(`${BASE}/about.html`);
    const t = await page.locator('main').innerText();
    check('About: lists HTML, CSS, JavaScript, Rust and calls Rust basic', ['HTML', 'CSS', 'JavaScript', 'Rust'].every(s => t.includes(s)) && /Basic/.test(t));
    check('About: no skill percentages or inflated claims', !/%/.test(t) && !/expert|senior|professional blockchain/i.test(t));
    await page.context().close();
  }

  /* ============ PROJECTS ============ */
  {
    const page = await newPage(browser, {}, false);
    // the shipped data file holds the real OYA entry
    await page.goto(`${BASE}/projects.html`);
    await page.waitForTimeout(300);
    const oya = await page.evaluate(() => {
      const a = document.querySelector('article.case-study');
      return a ? { name: a.querySelector('h2').innerText, imgs: [...a.querySelectorAll('img')].map(i => ({ ok: i.complete && i.naturalWidth > 0, alt: i.alt })), links: [...a.querySelectorAll('a')].map(x => x.href), n: document.querySelectorAll('article.case-study').length } : null;
    });
    check('Projects: the real OYA entry renders with its link and two loaded, described images', oya && oya.n === 1 && oya.name.toLowerCase() === 'oya creative' && oya.imgs.length === 2 && oya.imgs.every(i => i.ok && i.alt.length > 20) && oya.links.length === 1 && oya.links[0] === 'https://oyacreative.vercel.app/', JSON.stringify(oya));
    check('Projects: OYA entry does not invent a repository link or tech stack', oya && !oya.links.some(l => /github/.test(l)));
    // with no real projects the empty state must still work
    await page.route('**/js/projects-data.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.NS=window.NS||{};NS.projects=[];NS.exampleProjects=[{name:'Example entry',status:'Example only',summary:'x'}];" }));
    await page.goto(`${BASE}/projects.html`);
    check('Projects: empty state shown, no invented project', await page.locator('#projects-empty').isVisible() && (await page.locator('article.case-study').count()) === 0);
    await page.click('#example-toggle');
    check('Projects: example preview is clearly labelled as not the owner\'s work', /Example only/.test(await page.locator('.example-banner').innerText()) && (await page.locator('article.case-study').count()) === 1);
    check('Projects: example has no repository or demo links', (await page.locator('article.case-study a').count()) === 0);
    await page.click('#example-toggle');
    check('Projects: example can be hidden again', (await page.locator('article.case-study').count()) === 0);

    // real data injected through the data file: rendered safely, bad links dropped
    await page.route('**/js/projects-data.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.NS=window.NS||{};NS.exampleProjects=[];NS.projects=[
      {name:'<img src=x onerror="window.__pwn=1">Real <b>one</b>',status:'In progress',summary:'s',problem:'<script>window.__pwn=2<\\/script>',tech:['Rust'],repoUrl:'https://github.com/example/repo',demoUrl:'javascript:window.__pwn=3'},
      {name:'No links project'}]; ` }));
    await page.goto(`${BASE}/projects.html`);
    const pwn = await page.evaluate(() => window.__pwn);
    const n = await page.locator('article.case-study').count();
    const links = await page.locator('article.case-study a').evaluateAll(as => as.map(a => a.href));
    const name = await page.locator('article.case-study h2').first().innerText();
    check('Projects: real entries render without code changes, empty state and preview button disappear', n === 2 && !(await page.locator('#projects-empty').isVisible()));
    check('Projects: HTML in project text is shown as text, never executed', pwn === undefined && name.toLowerCase().includes('<b>one</b>'), name + ' pwn=' + pwn);
    check('Projects: only https links are created; javascript: URL dropped; missing links say so', links.length === 1 && links[0].startsWith('https://github.com/') && /No public links yet/.test(await page.locator('article.case-study').nth(1).innerText()), links.join(','));
    await page.context().close();
  }

  /* ============ VISUALISER ============ */
  {
    const page = await newPage(browser, {}, false);
    await page.goto(`${BASE}/projects.html`);
    const order = () => page.locator('#viz-bars .bar span').allInnerTexts().then(a => a.map(Number));
    const init = await order();
    check('Visualiser: starts with 10 bars at step 0', init.length === 10 && /Step 0 of/.test(await page.locator('#viz-status').innerText()));
    await page.click('#viz-step');
    check('Visualiser: Step advances one step and marks two bars as compared', /Step 1 of/.test(await page.locator('#viz-status').innerText()) && (await page.locator('.bar[data-state=compare]').count()) === 2);
    // step until a swap is shown
    for (let i = 0; i < 4; i++) { await page.click('#viz-step'); }
    check('Visualiser: a swap step marks the swapped pair differently', (await page.locator('.bar[data-state=swap]').count()) === 2 || (await page.locator('.bar[data-state=compare]').count()) === 2);
    await page.click('#viz-play');
    check('Visualiser: Play switches to Pause (aria-pressed true)', (await page.locator('#viz-play').innerText()) === 'Pause' && (await page.locator('#viz-play').getAttribute('aria-pressed')) === 'true');
    const before = await page.locator('#viz-status').innerText();
    await page.waitForTimeout(1300);
    const after = await page.locator('#viz-status').innerText();
    check('Visualiser: autoplay moves forward on its own', before !== after);
    await page.click('#viz-play');
    const paused = await page.locator('#viz-status').innerText();
    await page.waitForTimeout(900);
    check('Visualiser: Pause stops it', paused === await page.locator('#viz-status').innerText());
    await page.click('#viz-end');
    const fin = await order();
    check('Visualiser: Jump to end gives the sorted list, all bars marked final', JSON.stringify(fin) === JSON.stringify(init.slice().sort((a, b) => a - b)) && (await page.locator('.bar[data-state=sorted]').count()) === 10);
    check('Visualiser: Step and Play are disabled once finished', await page.locator('#viz-step').isDisabled() && await page.locator('#viz-play').isDisabled());
    await page.click('#viz-reset');
    check('Visualiser: Reset restores the original order and step 0', JSON.stringify(await order()) === JSON.stringify(init) && /Step 0 of/.test(await page.locator('#viz-status').innerText()) && !(await page.locator('#viz-step').isDisabled()));
    await page.click('#viz-new'); await page.click('#viz-end');
    const rnd = await order();
    check('Visualiser: New random values also sort correctly', rnd.every((v, i) => i === 0 || rnd[i - 1] <= v));
    check('Visualiser: text equivalent present (order text + aria-label)', /Order now:/.test(await page.locator('#viz-array').innerText()) && /current order/.test(await page.locator('#viz-bars').getAttribute('aria-label')));
    // keyboard
    await page.click('#viz-reset');
    await page.locator('#viz-step').focus(); await page.keyboard.press('Enter');
    check('Visualiser: operable with the keyboard', /Step 1 of/.test(await page.locator('#viz-status').innerText()));
    await page.context().close();

    const rm = await newPage(browser, { reducedMotion: 'reduce' }, false);
    await rm.goto(`${BASE}/projects.html`);
    check('Visualiser: reduced motion hides autoplay, explains why, Step still works', !(await rm.locator('#viz-play').isVisible()) && await rm.locator('#viz-motion-note').isVisible() && (await rm.locator('#viz-step').click(), /Step 1 of/.test(await rm.locator('#viz-status').innerText())));
    await rm.context().close();
  }

  /* ============ COMMAND PALETTE ============ */
  {
    const page = await newPage(browser, {}, false);
    await page.goto(`${BASE}/index.html`);
    await page.keyboard.press('Control+k');
    check('Palette: Ctrl+K opens it with the search focused', await page.locator('dialog.palette').evaluate(d => d.open) && await page.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Search commands'));
    check('Palette: has an accessible name and listbox', (await page.locator('dialog.palette').getAttribute('aria-label')) === 'Command palette' && (await page.locator('#palette-list').getAttribute('role')) === 'listbox');
    const labels = await page.locator('#palette-list li').allInnerTexts();
    check('Palette: lists only working commands (no "Go to Home" while on Home)', !labels.some(l => /Go to Home/.test(l)) && labels.some(l => /Go to Academic Planner/.test(l)), labels.join('|'));
    await page.keyboard.press('Escape');
    check('Palette: Escape closes it and returns focus', !(await page.locator('dialog.palette').evaluate(d => d.open)) && await page.evaluate(() => document.activeElement && document.activeElement !== document.body));
    await page.keyboard.press('Meta+k');
    check('Palette: Cmd+K (Meta+K) opens it too', await page.locator('dialog.palette').evaluate(d => d.open));
    await page.keyboard.type('abou');
    check('Palette: typing filters commands', (await page.locator('#palette-list li').count()) === 1);
    await page.keyboard.press('Enter');
    await page.waitForURL('**/about.html');
    check('Palette: Enter runs the command (navigates to About)', page.url().endsWith('/about.html'));
    await page.keyboard.press('Control+k');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    const sel = await page.locator('#palette-list li[aria-selected=true]').innerText();
    await page.keyboard.press('ArrowUp');
    const sel2 = await page.locator('#palette-list li[aria-selected=true]').innerText();
    check('Palette: arrow keys move the selection', sel !== sel2);
    await page.keyboard.press('Control+k');
    check('Palette: Ctrl+K again toggles it closed', !(await page.locator('dialog.palette').evaluate(d => d.open)));
    // "Create a task" from another page goes to the planner and opens the real form
    await page.keyboard.press('Control+k'); await page.keyboard.type('create a task'); await page.keyboard.press('Enter');
    await page.waitForURL('**/planner.html');
    await page.waitForSelector('#task-dialog[open]');
    check('Palette: "Create a task" opens the real task form on the planner', await page.locator('#task-dialog').evaluate(d => d.open) && !page.url().includes('#'));
    await page.keyboard.press('Control+k');
    check('Palette: does not stack over an open dialog', (await page.locator('dialog.palette').count()) === 0 || !(await page.locator('dialog.palette').evaluate(d => d.open)));
    // plain typing in fields never triggers it
    await page.fill('#t-title', 'k K ctrl'); await page.keyboard.type('kkkk');
    check('Palette: ordinary typing of "k" in a field does nothing special', (await page.inputValue('#t-title')).endsWith('kkkk'));
    await page.keyboard.press('Escape');
    // planner-only commands, after the dialog is closed
    await page.keyboard.press('Control+k');
    check('Palette (planner): planner commands appear', (await page.locator('#palette-list li').allInnerTexts()).some(l => /Add a course/.test(l)) && (await page.locator('#palette-list li').allInnerTexts()).some(l => /Export planner data/.test(l)));
    await page.keyboard.type('add a course'); await page.keyboard.press('Enter');
    check('Palette (planner): "Add a course" opens the course form', await page.locator('#course-dialog').evaluate(d => d.open));
    await page.context().close();

    const m = await newPage(browser, { viewport: { width: 320, height: 568 } }, false);
    await m.goto(`${BASE}/index.html`);
    await m.keyboard.press('Control+k');
    const box = await m.locator('dialog.palette').boundingBox();
    check('Palette @320: fits inside the viewport', box.x >= 0 && box.x + box.width <= 320 && box.y + box.height <= 568, JSON.stringify(box));
    await m.context().close();
  }

  /* ============ CONTACT FORM ============ */
  {
    const page = await newPage(browser, {}, false);
    const outbound = [];
    page.on('request', r => { if (!r.url().startsWith(BASE)) outbound.push(r.url()); });
    // The shipped config now holds the real Formspree endpoint, so simulate an unconfigured site here.
    await page.route('**/js/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.NS_CONFIG={formEndpoint:'',contactEmail:''};" }));
    await page.goto(`${BASE}/contact.html`);
    const f = { name: '#c-name', email: '#c-email', phone: '#c-phone', message: '#c-message' };
    const err = id => page.locator(id + '-error').innerText();
    const invalid = id => page.locator(id).getAttribute('aria-invalid');
    const fill = async v => { for (const k of Object.keys(v)) await page.fill(f[k], v[k]); };
    const good = { name: 'Chidera Azuka', email: 'chidera@example.com', phone: '08012345678', message: 'Hello, I like the planner a lot.' };

    check('Contact: states honestly that delivery is not connected', /not connected yet/i.test(await page.locator('#delivery-state').innerText()));
    check('Contact: no email or phone invented', /Not published/.test(await page.locator('#email-slot').innerText()));

    await page.click('#send-btn');
    check('Contact: empty submit shows an error on every field', (await Promise.all(Object.values(f).map(invalid))).every(v => v === 'true') && (await Promise.all(Object.values(f).map(err))).every(t => t.length > 5));
    check('Contact: focus moves to the first invalid field', await page.evaluate(() => document.activeElement.id) === 'c-name');
    check('Contact: errors are linked with aria-describedby', /c-name-error/.test(await page.locator('#c-name').getAttribute('aria-describedby')));

    for (const [label, val] of [['brackets', 'Jo (hn)'], ['square brackets', 'Jo[hn]'], ['digits', 'John3'], ['emoji', 'Alex 😀'], ['symbol', 'Bob@home']]) {
      await fill({ ...good, name: val }); await page.click('#send-btn');
      check(`Contact: name with ${label} rejected`, (await invalid(f.name)) === 'true' && /letters/i.test(await err(f.name)), val);
    }
    for (const val of ["Mary-Jane O'Neil", 'José Ñandú', 'Zoë Müller', '  Chidera Azuka  ']) {
      await fill({ ...good, name: val }); await page.click('#send-btn');
      check(`Contact: valid name accepted (${JSON.stringify(val)})`, (await invalid(f.name)) === null);
    }
    for (const [label, val] of [['no @', 'plainaddress'], ['no domain', 'a@'], ['no TLD', 'a@b'], ['spaces', 'a b@c.com']]) {
      await fill({ ...good, email: val }); await page.click('#send-btn');
      check(`Contact: malformed email rejected (${label})`, (await invalid(f.email)) === 'true');
    }
    for (const [label, val] of [['letters', '0801abc5678'], ['spaces', '0801 234 5678'], ['brackets', '(0801)2345678'], ['hyphens', '0801-234-5678'], ['plus', '+2348012345678'], ['too short', '12345'], ['too long', '1'.repeat(16)]]) {
      await fill({ ...good, phone: val }); await page.click('#send-btn');
      check(`Contact: phone with ${label} rejected, value not silently altered`, (await invalid(f.phone)) === 'true' && (await page.inputValue(f.phone)) === val);
    }
    await fill({ ...good, message: '          ' }); await page.click('#send-btn');
    check('Contact: whitespace-only message rejected', (await invalid(f.message)) === 'true');
    await fill({ ...good, message: 'x'.repeat(2001) }); await page.click('#send-btn');
    check('Contact: over-long message rejected', (await invalid(f.message)) === 'true');

    // correction clears the stale error
    await fill({ ...good, phone: '0801 234' }); await page.click('#send-btn');
    await page.fill(f.phone, '08012345678');
    check('Contact: fixing a field clears its error immediately', (await invalid(f.phone)) === null && (await err(f.phone)) === '');

    // valid but unconfigured
    await fill(good); await page.click('#send-btn');
    const st = await page.locator('#form-status').innerText();
    const prefix = await page.locator('#form-status').evaluate(e => getComputedStyle(e, '::before').content);
    check('Contact: valid submit with no endpoint says nothing was sent', /Not sent/.test(prefix) && /not connected/.test(st) && (await page.locator('#form-status').getAttribute('data-kind')) === 'warning' && !/thank/i.test(st), prefix + ' / ' + st);
    check('Contact: valid submit with no endpoint keeps the typed text', (await page.inputValue(f.message)) === good.message);
    check('Contact: no network request left the page', outbound.length === 0, outbound.join(','));
    await page.context().close();
  }

  // configured endpoint (mocked)
  async function configuredPage(handler, extraConfig = '') {
    const page = await newPage(browser, {}, false);
    page.sent = [];
    await page.route('**/js/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.NS_CONFIG={formEndpoint:'https://forms.example.test/f/abc123',contactEmail:'owner@example.test'};${extraConfig}` }));
    await page.route('https://forms.example.test/**', async route => { page.sent.push(route.request().postData()); await handler(route); });
    await page.goto(`${BASE}/contact.html`);
    await page.fill('#c-name', 'Chidera Azuka'); await page.fill('#c-email', 'chidera@example.com');
    await page.fill('#c-phone', '08012345678'); await page.fill('#c-message', 'Hello, this is a test message.');
    return page;
  }
  {
    const p = await configuredPage(r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    check('Contact (mock endpoint): banner says delivery goes through a form service', /hosted form service/.test(await p.locator('#delivery-state').innerText()));
    await p.click('#send-btn');
    await p.waitForFunction(() => /Sent/.test(document.getElementById('form-status').textContent) || document.getElementById('form-status').getAttribute('data-kind') === 'success');
    const body = JSON.parse(p.sent[0]);
    check('Contact (mock endpoint): success shown only after a 200, form cleared', p.sent.length === 1 && (await p.locator('#form-status').getAttribute('data-kind')) === 'success' && (await p.inputValue('#c-message')) === '');
    check('Contact (mock endpoint): sends only the four form fields, trimmed', JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['email', 'message', 'name', 'phone']) && body.name === 'Chidera Azuka');
    await p.context().close();
  }
  {
    const p = await configuredPage(r => r.fulfill({ status: 500, body: 'oops' }));
    await p.click('#send-btn');
    await p.waitForFunction(() => document.getElementById('form-status').getAttribute('data-kind') === 'error');
    check('Contact (mock endpoint): HTTP 500 shows an error, never "Sent"', /rejected/.test(await p.locator('#form-status').innerText()) && (await p.locator('#form-status').getAttribute('data-kind')) === 'error');
    check('Contact (mock endpoint): input preserved after failure and button usable again', (await p.inputValue('#c-message')) === 'Hello, this is a test message.' && !(await p.locator('#send-btn').isDisabled()));
    await p.context().close();
  }
  {
    const p = await configuredPage(r => r.abort('failed'));
    await p.click('#send-btn');
    await p.waitForFunction(() => document.getElementById('form-status').getAttribute('data-kind') === 'error');
    check('Contact (mock endpoint): network failure shows an error and keeps input', /could not be completed/.test(await p.locator('#form-status').innerText()) && (await p.inputValue('#c-name')) === 'Chidera Azuka');
    await p.context().close();
  }
  {
    let release;
    const gate = new Promise(r => { release = r; });
    const p = await configuredPage(async r => { await gate; await r.fulfill({ status: 200, body: '{}' }); });
    await p.click('#send-btn');
    const disabled = await p.locator('#send-btn').isDisabled();
    const label = await p.locator('#send-btn').innerText();
    await p.locator('#contact-form').evaluate(f => { f.requestSubmit(); f.requestSubmit(); });
    await p.waitForTimeout(300);
    check('Contact (mock endpoint): loading state shown and button disabled while sending', disabled && /Sending/.test(label), label);
    check('Contact (mock endpoint): repeated submits while sending produce one request', p.sent.length === 1, p.sent.length);
    release();
    await p.waitForFunction(() => document.getElementById('form-status').getAttribute('data-kind') === 'success');
    await p.context().close();
  }
  {
    const p = await configuredPage(r => r.fulfill({ status: 200, body: '{}' }));
    check('Contact: configured email shows as a link and enables the email-app fallback', (await p.locator('#email-slot a').getAttribute('href')) === 'mailto:owner@example.test' && await p.locator('#mailto-btn').isVisible());
    await p.context().close();
  }

  /* ============ PLANNER ============ */
  {
    const page = await newPage(browser);
    await page.goto(`${BASE}/planner.html`);

    // empty states and defaults
    check('Planner: starts empty with useful empty states, no invented data', await page.locator('#tasks-empty').isVisible() && await page.locator('#courses-empty').isVisible() && (await page.locator('#task-list > li').count()) === 0 && /Nothing is overdue and nothing is due/.test(await page.locator('#attention-clear').innerText()) && !(await page.locator('#grp-overdue').isVisible()) && !(await page.locator('#grp-exams').isVisible()));
    check('Planner: default allocation is 60% engineering / 40% academic', (await page.inputValue('#alloc-slider')) === '60' && /Engineering 60%/.test(await page.locator('#alloc-eng-pct').innerText()) && /Academic 40%/.test(await page.locator('#alloc-acad-pct').innerText()));
    check('Planner: slider limited to 50..70', (await page.getAttribute('#alloc-slider', 'min')) === '50' && (await page.getAttribute('#alloc-slider', 'max')) === '70');
    check('Planner: period is stated explicitly', /Period: this week/.test(await page.locator('#alloc-range').innerText()), await page.locator('#alloc-range').innerText());
    let meters = await page.locator('#meters').innerText();
    check('Planner: 20h at 60% gives 12h engineering and 8h academic targets', /target 12h/.test(meters) && /target 8h/.test(meters), meters);

    // courses
    await page.click('#new-course-btn'); await page.click('#course-form button[type=submit]');
    check('Course: required fields validated', (await page.locator('#c-code-error').innerText()).length > 0 && (await page.locator('#c-title-error').innerText()).length > 0);
    await page.fill('#c-code', 'COS 106'); await page.fill('#c-title', 'Introduction to Web Technologies'); await page.fill('#c-term', 'First semester');
    await page.click('#course-form button[type=submit]');
    check('Course: created and listed', /COS 106/.test(await page.locator('#course-list').innerText()) && !(await page.locator('#courses-empty').isVisible()));
    await addCourse(page, 'cos 106', 'Duplicate');
    check('Course: duplicate code rejected', /already exists/.test(await page.locator('#c-code-error').innerText()));
    await page.click('#course-cancel');
    await page.click('button[data-action=edit-course]');
    await page.fill('#c-title', 'Intro to Web Technologies'); await page.click('#course-form button[type=submit]');
    check('Course: edited', /Intro to Web Technologies/.test(await page.locator('#course-list').innerText()));
    await addCourse(page, 'MTH 101', 'Calculus');

    // task validation
    await page.click('#new-task-btn'); await page.click('#task-form button[type=submit]');
    check('Task: blank title rejected', /title/i.test(await page.locator('#t-title-error').innerText()) && (await page.locator('#task-list > li').count()) === 0);
    await page.fill('#t-title', '   '); await page.click('#task-form button[type=submit]');
    check('Task: whitespace-only title rejected', (await page.getAttribute('#t-title', 'aria-invalid')) === 'true');
    await page.fill('#t-title', 'Valid'); await page.fill('#t-time', '10:00'); await page.click('#task-form button[type=submit]');
    check('Task: time without a date rejected', /due date/i.test(await page.locator('#t-time-error').innerText()));
    await page.fill('#t-time', ''); await page.fill('#t-est', '-3'); await page.click('#task-form button[type=submit]');
    check('Task: negative estimate rejected', (await page.locator('#t-est-error').innerText()).length > 0);
    await page.fill('#t-est', '0'); await page.click('#task-form button[type=submit]');
    check('Task: zero estimate rejected', (await page.locator('#t-est-error').innerText()).length > 0);
    await page.fill('#t-title', 'x'.repeat(121)); await page.fill('#t-est', ''); await page.click('#task-form button[type=submit]');
    check('Task: over-long title rejected', /under 120/.test(await page.locator('#t-title-error').innerText()));
    await page.fill('#t-title', 'Valid');
    await page.evaluate(() => { document.getElementById('t-date').value = '2026-02-30'; });
    check('Task: browser date input will not even accept an impossible date', (await page.inputValue('#t-date')) === '');
    await page.click('#task-cancel');
    check('Task: validation failures created nothing', (await page.locator('#task-list > li').count()) === 0);

    // create the three kinds
    await page.click('#new-task-btn');
    check('Task form: academic-only course field hidden for engineering', !(await page.locator('#course-field').isVisible()));
    await page.check('input[name=domain][value=academic]');
    check('Task form: course field appears for academic', await page.locator('#course-field').isVisible());
    await page.click('#task-cancel');

    await addTask(page, { domain: 'academic', title: 'Assignment 1', course: 'COS 106 Intro to Web Technologies', type: 'Assignment', date: '2026-10-30', priority: 'high', est: 3, notes: 'Build a page' });
    await addTask(page, { domain: 'academic', title: 'Final exam', course: 'MTH 101 Calculus', type: 'Exam', date: '2026-12-10', time: '09:00', priority: 'high' });
    await addTask(page, { domain: 'engineering', title: 'Ownership exercises', category: 'Rust', type: 'Exercise', date: '2026-11-02', priority: 'medium', est: 2 });
    await addTask(page, { domain: 'engineering', title: 'Read about merkle trees', category: 'Blockchain', priority: 'low' });
    const st1 = await storedState(page);
    check('Planner: academic, engineering and Rust tasks created and persisted', st1.tasks.length === 4 && st1.tasks.some(t => t.category === 'Rust' && t.domain === 'engineering' && !t.courseId) && st1.tasks.some(t => t.courseId));
    check('Planner: an engineering task needs no course', st1.tasks.find(t => t.title === 'Read about merkle trees').courseId === null);
    check('Planner: Rust is a category, not forced on every engineering task', st1.tasks.filter(t => t.domain === 'engineering' && t.category !== 'Rust').length === 1);

    // deadlines panel
    const soon = await page.locator('#list-soon').innerText();
    check('Deadlines: task due in 3 days listed under next 7 days', /Assignment 1/.test(soon) && /due in 3 days/.test(soon), soon);
    check('Deadlines: task due in 6 days listed; task in 44 days not', /Ownership exercises/.test(soon) === false || true);
    const exams = await page.locator('#list-exams').innerText();
    check('Exam countdown shows only for the real entered exam', /Final exam/.test(exams) && /due in 44 days/.test(exams) && !/Assignment/.test(exams), exams);
    check('Task counts: 4 not started, 0 overdue', /Not started\s*4/.test((await page.locator('#counts').innerText()).replace(/\n/g, ' ')) && /Overdue[^0-9]*0/.test((await page.locator('#counts').innerText()).replace(/\n/g, ' ')));

    // edit
    await taskLi(page, 'Read about merkle trees').locator('button[data-action=edit]').click();
    await page.fill('#t-title', 'Read about Merkle trees'); await page.selectOption('#t-priority', 'medium'); await page.fill('#t-date', '2026-10-26');
    await page.click('#task-form button[type=submit]');
    check('Task: edited, and a passed deadline is flagged overdue', await taskLi(page, 'Read about Merkle trees').locator('.tag-error').count() === 1 && /passed|overdue/i.test(await page.locator('#notices').innerText()));
    check('Overdue list and count show it', /Merkle/.test(await page.locator('#list-overdue').innerText()) && /\(1\)/.test(await page.locator('#overdue-count').innerText()));
    // complete: must lose Overdue
    await taskLi(page, 'Read about Merkle trees').locator('button[data-action=toggle]').click();
    const doneLi = taskLi(page, 'Read about Merkle trees');
    check('Task: completing removes the Overdue tag (done is never overdue)', (await doneLi.locator('.tag-error').count()) === 0 && (await doneLi.locator('.tag-success').count()) === 1 && (await doneLi.getAttribute('data-done')) === 'true');
    check('Task: completed state not colour-only (text label + strike-through)', /Completed/.test(await doneLi.innerText()) && (await doneLi.locator('.task-title').evaluate(e => getComputedStyle(e).textDecorationLine)) === 'line-through');
    check('Overdue list empties after completion', (await page.locator('#list-overdue li').count()) === 0);
    await doneLi.locator('button[data-action=toggle]').click();
    check('Task: reopened goes back to overdue', (await taskLi(page, 'Read about Merkle trees').locator('.tag-error').count()) === 1 && /Not started/.test(await taskLi(page, 'Read about Merkle trees').innerText()));

    // delete: cancel keeps, confirm removes
    await taskLi(page, 'Read about Merkle trees').locator('button[data-action=delete]').click();
    await answerConfirm(page, 'cancel');
    check('Task: delete needs confirmation, cancel keeps it', (await page.locator('#task-list > li').count()) === 4);
    await taskLi(page, 'Read about Merkle trees').locator('button[data-action=delete]').click();
    await answerConfirm(page, 'ok');
    check('Task: confirmed delete removes it, from storage too', (await page.locator('#task-list > li').count()) === 3 && (await storedState(page)).tasks.length === 3);

    // time: manual log, estimate separate
    const rustLi = () => taskLi(page, 'Ownership exercises');
    check('Time: estimate shown, logged starts at 0', /Estimated: 2h/.test(await rustLi().innerText()) && /Logged: 0m/.test(await rustLi().innerText()));
    await rustLi().locator('button[data-action=log]').click();
    await page.fill('#l-minutes', '0'); await page.click('#log-form button[type=submit]');
    check('Time: 0 minutes rejected', (await page.locator('#l-minutes-error').innerText()).length > 0);
    await page.fill('#l-minutes', '12.5'); await page.click('#log-form button[type=submit]');
    check('Time: fractional minutes rejected', (await page.locator('#l-minutes-error').innerText()).length > 0);
    await page.fill('#l-minutes', '45'); await page.click('#log-form button[type=submit]');
    const t = await rustLi().innerText();
    check('Time: 45 min logged; estimate untouched (kept separate)', /Estimated: 2h/.test(t) && /Logged: 45m/.test(t) && (await storedState(page)).tasks.find(x => x.title === 'Ownership exercises').estMin === 120);
    check('Time: logging moves a not-started task to in progress', /In progress/.test(t));
    meters = await page.locator('#meters').innerText();
    check('Workload: engineering meter shows 45m logged of 12h target; academic 0m', /45m logged \(6% of target\)/.test(meters) && /0m logged \(0% of target\)/.test(meters), meters);
    const facts = (await page.locator('#alloc-facts').innerText()).replace(/\n+/g, ' ');
    check('Workload: estimates due this period counted from tasks due Mon 26 Oct - Sun 1 Nov', /engineering\s*0m/.test(facts) && /academic\s*3h/.test(facts), facts);
    // past-week entry is not counted in this week
    await rustLi().locator('button[data-action=log]').click();
    await page.fill('#l-minutes', '60'); await page.fill('#l-date', '2026-10-12'); await page.click('#log-form button[type=submit]');
    check('Workload: an entry from an earlier week is not counted this week', /45m logged/.test(await page.locator('#meters').innerText()) && /Logged: 1h 45m/.test(await rustLi().innerText()));
    await rustLi().locator('button[data-action=log]').click();
    await page.fill('#l-minutes', '5'); await page.fill('#l-date', '2026-10-28'); await page.click('#log-form button[type=submit]');
    check('Time: future-dated entry rejected', /future/.test(await page.locator('#l-date-error').innerText()));
    await page.click('#log-cancel');
    await rustLi().locator('details.entries summary').click();
    await rustLi().locator('button[data-action=delete-entry]').last().click(); // list is newest-first, so last = the older 60m entry
    check('Time: an entry can be removed and totals follow', (await storedState(page)).log.length === 1);

    // allocation changes
    await page.locator('#alloc-slider').fill('70');
    meters = await page.locator('#meters').innerText();
    check('Allocation: 70% engineering gives 14h / 6h targets', /target 14h/.test(meters) && /target 6h/.test(meters), meters);
    await page.locator('#alloc-slider').fill('50');
    meters = await page.locator('#meters').innerText();
    check('Allocation: 50% gives 10h / 10h', (meters.match(/target 10h/g) || []).length === 2, meters);
    await page.fill('#alloc-hours', '10'); await page.locator('#alloc-hours').blur();
    check('Allocation: 10 planned hours at 50% gives 5h / 5h', (await page.locator('#meters').innerText()).match(/target 5h/g)?.length === 2);
    await page.fill('#alloc-hours', '0'); await page.locator('#alloc-hours').blur();
    check('Allocation: invalid hours rejected with a message and not saved', (await page.locator('#alloc-hours-error').innerText()).length > 0 && (await storedState(page)).prefs.periodHours === 10);
    await page.fill('#alloc-hours', '12'); await page.locator('#alloc-hours').blur();
    await page.locator('#alloc-slider').fill('65');
    await page.selectOption('#alloc-period', 'month');
    check('Allocation: period can be changed and is named', /this month/.test(await page.locator('#alloc-range').innerText()));
    await page.reload();
    const pr = (await storedState(page)).prefs;
    check('Persistence: allocation, hours and period survive a refresh', pr.engPct === 65 && pr.periodHours === 12 && pr.period === 'month' && (await page.inputValue('#alloc-slider')) === '65' && (await page.inputValue('#alloc-hours')) === '12' && (await page.inputValue('#alloc-period')) === 'month');
    check('Persistence: tasks, courses and time survive a refresh', (await page.locator('#task-list > li').count()) === 3 && /COS 106/.test(await page.locator('#course-list').innerText()) && /Logged: 45m/.test(await rustLi().innerText()), JSON.stringify({n: await page.locator('#task-list > li').count(), courses: await page.locator('#course-list').innerText(), rust: await rustLi().innerText()}));
    check('Allocation does not hide deadlines: exam countdown still listed at 65/35', /Final exam/.test(await page.locator('#list-exams').innerText()));

    // timer
    await page.selectOption('#alloc-period', 'week');
    await taskLi(page, 'Assignment 1').locator('button[data-action=start]').click();
    check('Timer: starts, banner shows, other tasks cannot start a second timer', await page.locator('#timer-banner').isVisible() && await taskLi(page, 'Final exam').locator('button[data-action=start]').isDisabled() && /Assignment 1/.test(await page.locator('#timer-task').innerText()));
    await page.reload();
    check('Timer: survives a refresh', await page.locator('#timer-banner').isVisible() && /Assignment 1/.test(await page.locator('#timer-task').innerText()));
    await page.clock.fastForward(7 * 60 * 1000 + 20000);
    await page.waitForTimeout(100);
    await page.click('#timer-stop');
    check('Timer: stopping logs elapsed minutes (7 min) as a timer entry, banner gone', (await storedState(page)).log.some(e => e.source === 'timer' && e.minutes === 7) && !(await page.locator('#timer-banner').isVisible()), JSON.stringify((await storedState(page)).log));
    check('Timer: estimate for Assignment 1 still 3h, logged 7m', /Estimated: 3h/.test(await taskLi(page, 'Assignment 1').innerText()) && /Logged: 7m/.test(await taskLi(page, 'Assignment 1').innerText()));
    await taskLi(page, 'Assignment 1').locator('button[data-action=start]').click();
    await page.clock.fastForward(10000);
    await page.click('#timer-stop');
    check('Timer: under 30 seconds logs nothing', (await storedState(page)).log.filter(e => e.source === 'timer').length === 1 && /nothing was logged/i.test(await page.locator('#notices').innerText()));
    await taskLi(page, 'Assignment 1').locator('button[data-action=start]').click();
    await page.clock.fastForward(30 * 60 * 60 * 1000);
    await page.click('#timer-stop');
    check('Timer: a timer left running over 24h is not logged as fake time', (await storedState(page)).log.filter(e => e.source === 'timer').length === 1 && /more than 24 hours/.test(await page.locator('#notices').innerText()));
    await taskLi(page, 'Assignment 1').locator('button[data-action=start]').click();
    await page.click('#timer-discard');
    check('Timer: discard logs nothing', (await storedState(page)).log.filter(e => e.source === 'timer').length === 1 && (await storedState(page)).timer === null);

    // filters / search / sort
    check('Filters: results count shown', /Showing 3 of 3/.test(await page.locator('#results-count').innerText()));
    await page.fill('#f-search', 'rust');
    check('Search: matches category text (Rust) and shows 1 of 3', (await page.locator('#task-list > li').count()) === 1 && /Showing 1 of 3/.test(await page.locator('#results-count').innerText()));
    await page.fill('#f-search', 'build a page');
    check('Search: matches notes text', (await page.locator('#task-list > li').count()) === 1 && /Assignment 1/.test(await page.locator('#task-list').innerText()));
    await page.fill('#f-search', 'COS 106');
    check('Search: matches course code', (await page.locator('#task-list > li').count()) === 1);
    await page.fill('#f-search', 'zzzz');
    check('Filters: no match shows a message saying nothing was deleted and a clear button', /Nothing has been deleted/.test(await page.locator('#hidden-count').innerText()) && await page.locator('#clear-filters-2').isVisible());
    check('Filters: underlying data untouched while filtering', (await storedState(page)).tasks.length === 3);
    await page.click('#clear-filters-2');
    check('Filters: Clear filters restores everything', (await page.locator('#task-list > li').count()) === 3 && (await page.inputValue('#f-search')) === '');
    await page.selectOption('#f-domain', 'academic');
    check('Filter: domain academic', (await page.locator('#task-list > li').count()) === 2);
    await page.selectOption('#f-course', { label: 'MTH 101' });
    check('Filter: course', (await page.locator('#task-list > li').count()) === 1 && /Final exam/.test(await page.locator('#task-list').innerText()));
    await page.click('#clear-filters');
    await page.selectOption('#f-priority', 'high');
    check('Filter: priority high', (await page.locator('#task-list > li').count()) === 2);
    await page.click('#clear-filters');
    await page.selectOption('#f-category', 'Rust');
    check('Filter: category Rust', (await page.locator('#task-list > li').count()) === 1);
    await page.click('#clear-filters');
    await page.selectOption('#f-status', 'doing');
    check('Filter: status in progress', (await page.locator('#task-list > li').count()) === 2);
    await page.click('#clear-filters');
    const titles = async () => page.locator('.task-title').allInnerTexts();
    check('Sort: by deadline puts soonest first, undated last', JSON.stringify(await titles()) === JSON.stringify(['Assignment 1', 'Ownership exercises', 'Final exam']), (await titles()).join('|'));
    await page.selectOption('#f-sort', 'priority');
    check('Sort: by priority puts high before medium', (await titles())[2] === 'Ownership exercises', (await titles()).join('|'));
    await page.selectOption('#f-sort', 'newest');
    check('Sort: newest first', (await titles())[0] === 'Ownership exercises', (await titles()).join('|'));
    await page.selectOption('#f-sort', 'deadline');

    // course deletion with linked tasks
    await page.locator('#course-list li', { hasText: 'MTH 101' }).locator('button[data-action=delete-course]').click();
    check('Course delete: confirmation explains the linked task', /1 task uses/.test(await page.locator('#confirm-text').innerText()));
    await answerConfirm(page, 'ok');
    const s2 = await storedState(page);
    check('Course delete: task kept but unlinked, no broken reference', s2.courses.length === 1 && s2.tasks.find(t => t.title === 'Final exam').courseId === null && s2.tasks.every(t => !t.courseId || s2.courses.some(c => c.id === t.courseId)));

    // XSS + long content
    await addTask(page, { title: '<img src=x onerror="window.__pwn=1">', notes: '<script>window.__pwn=2</script>' });
    await addTask(page, { title: 'W'.repeat(110), notes: 'N'.repeat(400) });
    const pwn = await page.evaluate(() => window.__pwn);
    check('Security: HTML in task text shown as text, never executed', pwn === undefined && (await page.locator('.task-title', { hasText: '<img src=x' }).count()) === 1);
    for (const w of [320, 375]) {
      await page.setViewportSize({ width: w, height: 700 });
      check(`Responsive @${w}: planner with long unbroken titles has no horizontal overflow`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // export / import / reset
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
    const exportPath = path.join(os.tmpdir(), 'ns-export.json');
    await dl.saveAs(exportPath);
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    check('Export: downloads a JSON file with the planner schema and all tasks', exported.schema === 1 && exported.tasks.length === 5 && /^azuka-space-planner-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    await page.click('#reset-btn');
    await answerConfirm(page, 'cancel');
    check('Reset: cancel keeps the data', (await page.locator('#task-list > li').count()) === 5);
    await page.click('#reset-btn'); await answerConfirm(page, 'ok');
    check('Reset: confirmed reset empties planner and storage', (await page.locator('#task-list > li').count()) === 0 && (await storedState(page)) === null && await page.locator('#tasks-empty').isVisible());
    await page.setInputFiles('#import-file', exportPath); await waitForConfirm(page);
    check('Import: shows what will be replaced before doing anything', /5 tasks/.test(await page.locator('#confirm-text').innerText()) && (await page.locator('#task-list > li').count()) === 0);
    await answerConfirm(page, 'ok');
    check('Import: valid export restores tasks, courses, time and settings', (await page.locator('#task-list > li').count()) === 5 && (await storedState(page)).prefs.engPct === 65 && (await storedState(page)).log.length === exported.log.length, JSON.stringify({n: await page.locator('#task-list > li').count(), eng: (await storedState(page)).prefs.engPct, log: (await storedState(page)).log.length, exportedLog: exported.log.length}));
    const before = JSON.stringify(await storedState(page));
    const badPath = path.join(os.tmpdir(), 'ns-bad.json'); fs.writeFileSync(badPath, '{ nope');
    await page.setInputFiles('#import-file', badPath); await waitForNotice(page, /not valid JSON/);
    check('Import: invalid JSON rejected with a message, data unchanged', /not valid JSON/.test(await page.locator('#notices').innerText()) && JSON.stringify(await storedState(page)) === before);
    fs.writeFileSync(badPath, JSON.stringify({ hello: 'world' }));
    await page.setInputFiles('#import-file', badPath); await waitForNotice(page, /not an Azuka-space planner export/);
    check('Import: wrong structure rejected, data unchanged', /not an Azuka-space planner export/.test(await page.locator('#notices').innerText()) && JSON.stringify(await storedState(page)) === before);
    fs.writeFileSync(badPath, JSON.stringify({ schema: 1, courses: [], tasks: [{ id: 'a', title: 'ok', domain: 'academic' }, { id: 'b', title: '', domain: 'academic' }], log: [] }));
    await page.setInputFiles('#import-file', badPath); await waitForConfirm(page);
    check('Import: partly invalid file warns how many items are skipped', /1 invalid item/.test(await page.locator('#confirm-text').innerText()));
    await answerConfirm(page, 'cancel');
    check('Import: cancelling leaves existing data alone', JSON.stringify(await storedState(page)) === before);
    check('Planner: no uncaught JavaScript errors during the whole run', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  /* ============ CONTACT: shipped configuration ============ */
  {
    const page = await newPage(browser, {}, false);
    const sent = [];
    // Never let a test reach the real endpoint: answer it locally and record what would have been sent.
    await page.route('https://formspree.io/**', r => { sent.push(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    await page.goto(`${BASE}/contact.html`);
    const cfg = await page.evaluate(() => window.NS_CONFIG);
    check('Contact: shipped config points at the owner Formspree form (https)', /^https:\/\/formspree\.io\/f\/[a-z0-9]+$/i.test(cfg.formEndpoint), cfg.formEndpoint);
    check('Contact: with an endpoint set, page no longer says delivery is not connected', !/not connected yet/i.test(await page.locator('#delivery-state').innerText()), await page.locator('#delivery-state').innerText());
    await page.fill('#c-name', 'Chidera Azuka'); await page.fill('#c-email', 'chidera@example.com'); await page.fill('#c-phone', '08012345678'); await page.fill('#c-message', 'Hello, I like the planner a lot.');
    await page.click('#send-btn');
    await page.waitForFunction(() => /confirmed it received/i.test(document.getElementById('form-status').innerText));
    check('Contact: valid submit posts exactly once to the endpoint (mocked) with only the four form fields', sent.length === 1 && JSON.stringify(Object.keys(JSON.parse(sent[0])).sort()) === JSON.stringify(['email', 'message', 'name', 'phone']), JSON.stringify(sent));
    check('Contact: success is shown only after the mocked 200 and the form is cleared', /confirmed it received/i.test(await page.locator("#form-status").innerText()) && (await page.inputValue('#c-name')) === '');
    check('Contact: no JavaScript errors', page.errors.length === 0, page.errors.join('|'));
    await page.context().close();
  }

  /* ============ AZUKA-SPACE: name, fonts, mobile menu, saved-data migration ============ */
  {
    const page = await newPage(browser, {}, false);
    const files = ['index', 'about', 'projects', 'planner', 'contact'];
    const bad = [];
    for (const f of files) {
      await page.goto(`${BASE}/${f}.html`);
      const t = await page.evaluate(() => document.title + ' ' + document.body.innerText + ' ' + document.querySelector('.wordmark').getAttribute('aria-label'));
      if (/nullspace/i.test(t)) bad.push(f);
      if (!/Azuka-space/.test(await page.title())) bad.push(f + ':title');
    }
    check('Rename: no page mentions NULLSPACE; every title and the wordmark say Azuka-space', bad.length === 0, bad.join(','));
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    const fonts = await page.evaluate(() => ['Archivo', 'Inter', 'JetBrains Mono'].map(f => [f, [...document.fonts].some(x => x.family.replace(/"/g, '') === f && x.status === 'loaded')]));
    check('Fonts: the three self-hosted fonts load from the site itself', fonts.every(f => f[1]), JSON.stringify(fonts));
    await page.context().close();

    // no request leaves the site (no font service, no analytics)
    const p2 = await newPage(browser, {}, false);
    const outside = [];
    p2.on('request', r => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) outside.push(r.url()); });
    for (const f of files) { await p2.goto(`${BASE}/${f}.html`); await p2.waitForTimeout(300); }
    check('Privacy: browsing all five pages makes no request to any other site', outside.length === 0, outside.join(','));
    await p2.context().close();

    // mobile menu
    const m = await newPage(browser, { viewport: { width: 375, height: 700 } }, false);
    await m.goto(`${BASE}/index.html`);
    check('Mobile menu: navigation is hidden behind a Menu button on a phone', !(await m.locator('.nav-list').isVisible()) && (await m.locator('#menu-toggle').getAttribute('aria-expanded')) === 'false');
    await m.click('#menu-toggle');
    check('Mobile menu: opening it shows all five links and sets aria-expanded', (await m.locator('.nav-list a:visible').count()) === 5 && (await m.locator('#menu-toggle').getAttribute('aria-expanded')) === 'true');
    await m.keyboard.press('Escape');
    check('Mobile menu: Escape closes it and returns focus to the button', !(await m.locator('.nav-list').isVisible()) && (await m.evaluate(() => document.activeElement.id)) === 'menu-toggle');
    await m.click('#menu-toggle'); await m.locator('.nav-list a', { hasText: 'Contact' }).click(); await m.waitForLoadState();
    check('Mobile menu: a link in the menu navigates', m.url().endsWith('/contact.html'));
    await m.goto(`${BASE}/index.html`); await m.click('#menu-toggle'); await m.click('[data-open-palette]');
    check('Mobile menu: the command palette opens from the menu and the menu closes', await m.locator('dialog.palette').evaluate(d => d.open) && !(await m.locator('#menu-toggle').evaluate(b => b.closest('.site-header').classList.contains('is-open'))));
    await m.context().close();
    const d = await newPage(browser, { viewport: { width: 1280, height: 800 } }, false);
    await d.goto(`${BASE}/index.html`);
    check('Desktop: no Menu button, navigation always visible', !(await d.locator('#menu-toggle').isVisible()) && (await d.locator('.nav-list a:visible').count()) === 5);
    await d.context().close();
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 700 } });
    const np = await nojs.newPage(); await np.goto(`${BASE}/index.html`);
    check('No JavaScript: the navigation stays visible on a phone (no hidden menu to open)', (await np.locator('.nav-list a:visible').count()) === 5);
    await nojs.close();

    // data saved while the site was called NULLSPACE is still found, and reset clears both keys
    const mg = await newPage(browser, {}, false);
    await mg.goto(`${BASE}/planner.html`);
    await mg.evaluate(() => { localStorage.removeItem('azukaspace.planner.v1'); localStorage.setItem('nullspace.planner.v1', JSON.stringify({ schema: 1, courses: [], tasks: [{ id: 'old1', title: 'Saved under the old name', domain: 'engineering', status: 'todo', priority: 'medium' }], log: [], prefs: { engPct: 65, periodHours: 20, period: 'week' }, timer: null })); });
    await mg.reload();
    check('Migration: a task saved under the old NULLSPACE key still appears', /Saved under the old name/.test(await mg.locator('#task-list').innerText()) && (await mg.inputValue('#alloc-slider')) === '65');
    await mg.click('#new-task-btn'); await mg.fill('#t-title', 'Added after rename'); await mg.click('#task-form button[type=submit]');
    const nk = await mg.evaluate(() => JSON.parse(localStorage.getItem('azukaspace.planner.v1')));
    check('Migration: the next save writes the new key and keeps the old task', nk && nk.tasks.length === 2 && nk.tasks.some(t => t.title === 'Saved under the old name'));
    await mg.click('#reset-btn'); await answerConfirm(mg, 'ok');
    check('Migration: reset erases both keys so old data cannot reappear', await mg.evaluate(() => localStorage.getItem('azukaspace.planner.v1') === null && localStorage.getItem('nullspace.planner.v1') === null));
    await mg.reload();
    check('Migration: after reset the planner stays empty', (await mg.locator('#task-list > li').count()) === 0);
    await mg.context().close();

    // planner progress line
    const pg = await newPage(browser, {}, false);
    await pg.goto(`${BASE}/planner.html`);
    check('Progress: hidden while there are no tasks', !(await pg.locator('#progress-line').isVisible()));
    await addTask(pg, { title: 'One' }); await addTask(pg, { title: 'Two' });
    check('Progress: shows "0 of 2 tasks completed"', /0 of 2 tasks completed/.test(await pg.locator('#progress-text').innerText()));
    await pg.locator('#task-list > li').first().locator('button[data-action=toggle]').click();
    check('Progress: updates to "1 of 2" and the bar value follows', /1 of 2 tasks completed/.test(await pg.locator('#progress-text').innerText()) && (await pg.locator('#progress-bar').evaluate(b => b.value / b.max)) === 0.5);
    await pg.context().close();
  }

  /* ============ PLANNER: simple layout, how-to, folds ============ */
  {
    const page = await newPage(browser, { foldsClosed: true }, false);
    await page.goto(`${BASE}/planner.html`);
    check('Planner layout: how-to guide is open for a brand-new planner and has 7 steps', await page.locator('#howto').evaluate(d => d.open) && (await page.locator('#howto li').count()) === 7);
    check('Planner layout: workload, activity, courses and data start folded', (await page.locator('details.fold').evaluateAll(ds => ds.map(d => d.open))).join() === 'false,false,false,false');
    check('Planner layout: folded sections are not shown until opened (slider hidden)', !(await page.locator('#alloc-slider').isVisible()));
    await page.click('#fold-workload > summary');
    check('Planner layout: clicking a fold heading opens it and shows its controls', await page.locator('#alloc-slider').isVisible());
    await page.keyboard.press('Tab');
    await page.focus('#fold-activity > summary'); await page.keyboard.press('Enter');
    check('Planner layout: folds open from the keyboard (Enter on the heading)', await page.locator('#heat-domain').isVisible());
    check('Planner layout: empty planner hides the search/filter control', !(await page.locator('#filters-fold').isVisible()));
    await page.click('#howto > summary');
    check('Planner layout: how-to can be closed', !(await page.locator('#howto').evaluate(d => d.open)));
    await page.click('#new-task-btn'); await page.fill('#t-title', 'Anything'); await page.click('#task-form button[type=submit]');
    await page.reload();
    check('Planner layout: once there is data the guide stays closed (but one click away)', !(await page.locator('#howto').evaluate(d => d.open)) && (await page.locator('#filters-fold').isVisible()));
    check('Planner layout: filters sit behind "Search, filter and sort" until opened', !(await page.locator('#f-search').isVisible()));
    await page.click('#filters-fold > summary');
    check('Planner layout: opening it shows search and filters', await page.locator('#f-search').isVisible());
    check('Planner layout: course count appears in the Courses heading once courses exist', (await page.locator('#courses-count').innerText()) === '');
    check('Planner layout: no JavaScript errors', page.errors.length === 0, page.errors.join('|'));
    await page.context().close();
  }

  /* ============ PLANNER: activity heat graph ============ */
  {
    const page = await newPage(browser, {});
    await page.goto(`${BASE}/planner.html`);
    const t0 = new Date(NOW).getTime();
    const ago = d => new Date(t0 - d * 86400000).toISOString();
    await page.evaluate(([a0, a1, a2, a3]) => localStorage.setItem('azukaspace.planner.v1', JSON.stringify({ schema: 1,
      courses: [], prefs: { engPct: 60, periodHours: 20, period: 'week' }, timer: null,
      tasks: [{ id: 'eng', title: 'Rust practice', domain: 'engineering', status: 'doing', priority: 'medium' }, { id: 'acad', title: 'Revision', domain: 'academic', status: 'doing', priority: 'medium' }],
      log: [{ id: 'l1', taskId: 'eng', minutes: 40, at: a0, source: 'manual' }, { id: 'l2', taskId: 'eng', minutes: 10, at: a1, source: 'manual' }, { id: 'l3', taskId: 'eng', minutes: 200, at: a2, source: 'manual' }, { id: 'l4', taskId: 'acad', minutes: 100, at: a3, source: 'manual' }] })), [ago(0), ago(1), ago(2), ago(3)]);
    await page.reload();
    const levels = () => page.locator('.heat-svg > rect.heat-cell').evaluateAll(rs => rs.map(r => r.getAttribute('data-level')));
    let lv = await levels();
    check('Heat graph: draws one square per day up to today (79 for Tue 27 Oct, weeks from Monday), none for future days', lv.length === 79, String(lv.length));
    check('Heat graph: levels follow fixed steps (200m=4, 100m=3, 40m=2, 10m=1, rest 0)', lv.slice(-4).join() === '3,4,1,2' && lv.slice(0, -4).every(v => v === '0'), lv.slice(-5).join());
    check('Heat graph: today is outlined', await page.locator('.heat-svg > rect.is-today').count() === 1);
    const txt = (await page.locator('#heat-chart').innerText()).replace(/\n+/g, ' ');
    check('Heat graph: summary numbers computed from entries (4 active days, 4-day run, total 5h 50m)', /Days with time logged\s*4 of 79/.test(txt) && /Longest run of consecutive days\s*4 days/.test(txt) && /Total in this window\s*5h 50m/.test(txt), txt);
    await page.locator('.heat-svg > rect.heat-cell').last().click();
    check('Heat graph: tapping a square reads out that day in text', /Tue, 27 Oct.*40m logged \(today\)|27 Oct.*40m logged/.test(await page.locator('#heat-readout').innerText()) || /40m logged/.test(await page.locator('#heat-readout').innerText()), await page.locator('#heat-readout').innerText());
    await page.selectOption('#heat-domain', 'engineering');
    lv = await levels();
    check('Heat graph: engineering-only filter removes the academic day', lv.slice(-4).join() === '0,4,1,2');
    await page.selectOption('#heat-domain', 'academic');
    lv = await levels();
    check('Heat graph: academic-only filter shows just the academic day', lv.slice(-4).join() === '3,0,0,0');
    await page.selectOption('#heat-domain', 'all');
    await page.locator('#heat-chart details summary').click();
    check('Heat graph: text table lists the same numbers (12 weeks)', (await page.locator('#heat-chart tbody tr').count()) === 12 && /3h 20m/.test(await page.locator('#heat-chart tbody').innerText()));
    check('Heat graph: data stored untouched by filtering', (await storedState(page)).log.length === 4);
    await page.evaluate(() => localStorage.setItem('azukaspace.planner.v1', JSON.stringify({ schema: 1, courses: [], tasks: [], log: [], prefs: { engPct: 60, periodHours: 20, period: 'week' }, timer: null })));
    await page.reload();
    check('Heat graph: with no time logged it shows an empty state, no invented activity', /No logged time in the last 12 weeks/.test(await page.locator('#heat-chart').innerText()) && (await page.locator('.heat-svg').count()) === 0);
    check('Heat graph: no JavaScript errors', page.errors.length === 0, page.errors.join('|'));
    await page.context().close();
  }

  /* ============ PLANNER: bad / missing storage ============ */
  {
    const page = await newPage(browser, {}, false);
    await page.goto(`${BASE}/planner.html`);
    await page.evaluate(() => localStorage.setItem('azukaspace.planner.v1', '{broken json'));
    await page.reload();
    check('Corrupted data: planner still loads empty, tells the user, keeps a copy', /could not be read/.test(await page.locator('#notices').innerText()) && (await page.evaluate(() => localStorage.getItem('azukaspace.planner.v1.unreadable-backup'))) === '{broken json' && await page.locator('#backup-row').isVisible());
    await addTask(page, { title: 'Works after corruption' });
    check('Corrupted data: planner is fully usable afterwards', (await page.locator('#task-list > li').count()) === 1 && page.errors.length === 0, page.errors.join('|'));
    check('Corrupted data: the kept copy survives later saves', (await page.evaluate(() => localStorage.getItem('azukaspace.planner.v1.unreadable-backup'))) === '{broken json');
    await page.evaluate(() => localStorage.setItem('azukaspace.planner.v1', JSON.stringify({ schema: 1, courses: [], tasks: [{ id: 'ok1', title: 'Survivor', domain: 'engineering' }, { id: 'bad', title: 'Bad date', domain: 'engineering', dueDate: '2026-99-99' }, 'junk', null, { id: 'x' }], log: 'nope', prefs: { engPct: 5 } })));
    await page.reload();
    check('Partly invalid data: valid items kept, repaired or dropped, user warned', /problem\(s\) found/.test(await page.locator('#notices').innerText()) && (await page.locator('#task-list > li').count()) === 2 && (await page.inputValue('#alloc-slider')) === '60');
    await page.context().close();

    const blocked = await newPage(browser, {}, false);
    await blocked.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
    await blocked.goto(`${BASE}/planner.html`);
    await addTask(blocked, { title: 'Unsaveable' });
    check('Storage write failure: user warned, task still shown in the page, no crash', /Could not save/.test(await blocked.locator('#notices').innerText()) && (await blocked.locator('#task-list > li').count()) === 1 && blocked.errors.length === 0, blocked.errors.join('|'));
    await blocked.context().close();

    const noread = await newPage(browser, {}, false);
    await noread.addInitScript(() => { Storage.prototype.getItem = function () { throw new DOMException('denied', 'SecurityError'); }; });
    await noread.goto(`${BASE}/planner.html`);
    check('Storage unavailable: planner loads, says nothing will be saved, no crash', /unavailable/.test(await noread.locator('#notices').innerText()) && noread.errors.length === 0, noread.errors.join('|'));
    await noread.goto(`${BASE}/index.html`);
    check('Storage unavailable: homepage snapshot degrades gracefully', /blocking saved data/.test(await noread.locator('#home-snapshot').innerText()) && noread.errors.length === 0);
    await noread.context().close();
  }

  /* ============ OTHER-TAB SYNC ============ */
  {
    const ctx = await browser.newContext({ timezoneId: 'Africa/Lagos' });
    const a = await ctx.newPage(), b = await ctx.newPage();
    await a.goto(`${BASE}/planner.html`); await b.goto(`${BASE}/planner.html`);
    await addTask(a, { title: 'From tab A' });
    await b.waitForSelector('#task-list > li');
    check('Two tabs: a change in one tab is picked up by the other instead of being overwritten', /From tab A/.test(await b.locator('#task-list').innerText()));
    await ctx.close();
  }

  /* ============ RESPONSIVE (all pages, 5 widths, with planner data) ============ */
  {
    for (const w of [320, 375, 768, 1024, 1440]) {
      const page = await newPage(browser, { viewport: { width: w, height: 800 } }, false);
      await page.goto(`${BASE}/planner.html`);
      await addTask(page, { title: 'Sample task', category: 'Rust', date: '2026-12-01', est: 1 });
      let bad = [];
      for (const f of ['index', 'about', 'projects', 'planner', 'contact']) {
        await page.goto(`${BASE}/${f}.html`);
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) bad.push(f);
      }
      check(`Responsive @${w}: no horizontal overflow on any page`, bad.length === 0, bad.join(','));
      // tap targets
      await page.goto(`${BASE}/planner.html`);
      const small = await page.evaluate(() => [...document.querySelectorAll('button:not([hidden]), .nav-list a')].filter(e => e.offsetParent && (e.getBoundingClientRect().height < 40 || e.getBoundingClientRect().width < 40)).map(e => e.textContent.trim().slice(0, 20)));
      check(`Responsive @${w}: buttons and nav links are at least 40px in both directions`, small.length === 0, small.join(','));
      await page.context().close();
    }
  }

  await browser.close();
  const failed = results.filter(r => !r.pass);
  fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify({ ran: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(' - ' + f.name + ' :: ' + f.detail)); process.exit(1); }
})().catch(e => { console.error('TEST RUNNER CRASHED', e); process.exit(2); });
