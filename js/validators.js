/*
 * validators.js — contact form rules as pure functions.
 * Each returns an error message string, or null when the value is valid.
 */
(function (root) {
  'use strict';

  // Letters (any script, accents included) in parts separated by one space, hyphen or apostrophe.
  var NAME_RE = /^[\p{L}\p{M}]+(?:[ '’-][\p{L}\p{M}]+)*$/u;
  var EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

  var RULES = {
    nameMin: 2, nameMax: 80,
    phoneMin: 7, phoneMax: 15,
    messageMin: 10, messageMax: 2000
  };

  function validateName(value) {
    var t = String(value).trim();
    if (!t) return 'Enter your name.';
    if (t.length < RULES.nameMin) return 'Your name needs at least ' + RULES.nameMin + ' characters.';
    if (t.length > RULES.nameMax) return 'Your name can be at most ' + RULES.nameMax + ' characters.';
    if (!NAME_RE.test(t)) return 'Use letters only. Spaces, hyphens and apostrophes are fine between parts of a name. No digits, brackets, emoji or other symbols.';
    return null;
  }

  function validateEmail(value) {
    var t = String(value).trim();
    if (!t) return 'Enter your email address.';
    var local = t.split('@')[0];
    if (t.length > 254 || !EMAIL_RE.test(t) || local.charAt(0) === '.' || local.slice(-1) === '.' || t.indexOf('..') >= 0) {
      return 'Enter a valid email address, like name@example.com.';
    }
    return null;
  }

  // Digits only. The value is deliberately not trimmed: a stray space is an error, not something to fix silently.
  function validatePhone(value) {
    var v = String(value);
    if (!v) return 'Enter your phone number.';
    if (/\D/.test(v)) return 'Digits only: no letters, spaces, brackets, hyphens or + sign. Example: 08012345678.';
    if (v.length < RULES.phoneMin || v.length > RULES.phoneMax) return 'Use ' + RULES.phoneMin + ' to ' + RULES.phoneMax + ' digits.';
    return null;
  }

  function validateMessage(value) {
    var t = String(value).trim();
    if (!t) return 'Write a message. Spaces alone do not count.';
    if (t.length < RULES.messageMin) return 'Say a little more: at least ' + RULES.messageMin + ' characters.';
    if (t.length > RULES.messageMax) return 'Keep the message under ' + RULES.messageMax + ' characters.';
    return null;
  }

  var api = { RULES: RULES, validateName: validateName, validateEmail: validateEmail, validatePhone: validatePhone, validateMessage: validateMessage };
  root.NS = root.NS || {};
  root.NS.validators = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
