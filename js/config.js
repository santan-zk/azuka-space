/*
 * config.js — the two things only the site owner can supply.
 * Nothing here is a secret: a form endpoint URL is meant to be public.
 * Do NOT put passwords or private API keys in this file.
 */
window.NS_CONFIG = {
  // A hosted form endpoint, e.g. "https://formspree.io/f/xxxxxxxx". See README, "Contact form".
  // While this is empty the form validates input but says plainly that nothing can be sent.
  formEndpoint: 'https://formspree.io/f/meaadrad',

  // Optional public email address shown on the Contact page and used for the "open in email app" fallback.
  // Leave empty if you do not want one displayed.
  contactEmail: ''
};
