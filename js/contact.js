/*
 * contact.js — validation and honest delivery for the contact form.
 *
 * - The rules live in validators.js. This file wires them to the page.
 * - Delivery only happens when NS_CONFIG.formEndpoint is a real https:// URL.
 *   Until then the form checks input and says plainly that nothing can be sent.
 * - "Sent" is only ever shown after the endpoint answers with a success status.
 */
(function () {
  'use strict';
  var form = document.getElementById('contact-form');
  if (!form || !window.NS || !NS.validators) return;

  var V = NS.validators;
  var cfg = window.NS_CONFIG || {};
  var endpoint = typeof cfg.formEndpoint === 'string' ? cfg.formEndpoint.trim() : '';
  var email = typeof cfg.contactEmail === 'string' ? cfg.contactEmail.trim() : '';
  var endpointOk = false;
  try { endpointOk = new URL(endpoint).protocol === 'https:'; } catch (e) { endpointOk = false; }

  var fields = [
    { el: document.getElementById('c-name'), check: V.validateName },
    { el: document.getElementById('c-email'), check: V.validateEmail },
    { el: document.getElementById('c-phone'), check: V.validatePhone },
    { el: document.getElementById('c-message'), check: V.validateMessage }
  ];
  var statusEl = document.getElementById('form-status');
  var sendBtn = document.getElementById('send-btn');
  var delivery = document.getElementById('delivery-state');
  var countEl = document.getElementById('c-message-count');
  var mailBtn = document.getElementById('mailto-btn');
  var sending = false;

  function errorEl(f) { return document.getElementById(f.el.id + '-error'); }

  function showError(f, msg) {
    var box = errorEl(f);
    f.el.setCustomValidity(msg || '');
    if (msg) {
      f.el.setAttribute('aria-invalid', 'true');
      box.textContent = msg;
    } else {
      f.el.removeAttribute('aria-invalid');
      box.textContent = '';
    }
  }

  function validateField(f) {
    var msg = f.check(f.el.value);
    showError(f, msg);
    return !msg;
  }

  function setStatus(kind, text) {
    statusEl.textContent = text || '';
    if (kind) statusEl.setAttribute('data-kind', kind); else statusEl.removeAttribute('data-kind');
  }

  function values() {
    return {
      name: fields[0].el.value.trim(),
      email: fields[1].el.value.trim(),
      phone: fields[2].el.value,
      message: fields[3].el.value.trim()
    };
  }

  /* delivery banner + optional email fallback */
  if (endpointOk) {
    delivery.setAttribute('data-connected', 'true');
    delivery.textContent = 'Messages are sent through a hosted form service. You will only see "Sent" once the service confirms it received yours.';
  } else {
    delivery.textContent = 'Message delivery is not connected yet. This form checks your details but cannot send them until the site owner adds a form endpoint.';
  }
  var emailSlot = document.getElementById('email-slot');
  if (email && emailSlot) {
    var a = document.createElement('a');
    a.href = 'mailto:' + email;
    a.textContent = email;
    emailSlot.textContent = '';
    emailSlot.appendChild(a);
    if (mailBtn) mailBtn.hidden = false;
  }

  /* live feedback: validate when leaving a field, and re-check as soon as an invalid field is edited */
  fields.forEach(function (f) {
    f.el.addEventListener('blur', function () { if (f.el.value !== '' || f.el.hasAttribute('aria-invalid')) validateField(f); });
    f.el.addEventListener('input', function () { if (f.el.hasAttribute('aria-invalid')) validateField(f); });
  });
  fields[3].el.addEventListener('input', function () {
    countEl.textContent = fields[3].el.value.trim().length + ' of ' + V.RULES.messageMax + ' characters';
  });

  function validateAll() {
    var firstBad = null;
    fields.forEach(function (f) { if (!validateField(f) && !firstBad) firstBad = f; });
    return firstBad;
  }

  function finishSending() {
    sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send message';
    form.removeAttribute('aria-busy');
  }

  function deliver(data) {
    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    setStatus('', 'Sending your message…');

    var ctl = new AbortController();
    var timeout = setTimeout(function () { ctl.abort(); }, 15000);
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data),
      signal: ctl.signal
    }).then(function (res) {
      clearTimeout(timeout);
      if (res.ok) {
        form.reset();
        countEl.textContent = '0 of ' + V.RULES.messageMax + ' characters';
        fields.forEach(function (f) { showError(f, ''); });
        setStatus('success', 'The form service confirmed it received your message.');
      } else {
        setStatus('error', 'The form service rejected the message (status ' + res.status + '). Your text is still in the form, so you can try again.');
      }
    }).catch(function (err) {
      clearTimeout(timeout);
      var why = err && err.name === 'AbortError' ? 'The request took longer than 15 seconds.' : 'The request could not be completed. Check your connection.';
      setStatus('error', why + ' Your text is still in the form, so you can try again.');
    }).then(finishSending);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    var bad = validateAll();
    if (bad) {
      setStatus('error', 'Fix the highlighted fields and try again.');
      bad.el.focus();
      return;
    }
    if (!endpointOk) {
      setStatus('warning', 'Your details are valid, but message delivery is not connected yet, so there is nowhere to send them. Your text is still in the form.');
      return;
    }
    deliver(values());
  });

  if (mailBtn) {
    mailBtn.addEventListener('click', function () {
      var bad = validateAll();
      if (bad) { setStatus('error', 'Fix the highlighted fields first.'); bad.el.focus(); return; }
      var d = values();
      var body = 'Name: ' + d.name + '\nEmail: ' + d.email + '\nPhone: ' + d.phone + '\n\n' + d.message;
      window.location.href = 'mailto:' + email + '?subject=' + encodeURIComponent('Message from the Azuka-space contact form') + '&body=' + encodeURIComponent(body);
      setStatus('', 'Your email app should open with the message filled in. Nothing is sent until you send it from there.');
    });
  }
})();
