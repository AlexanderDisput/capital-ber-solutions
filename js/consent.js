/**
 * Cookie consent banner + Google Consent Mode v2 wiring.
 * The initial default/granted signal is set synchronously in each page's
 * <head> (before gtag.js processes any config calls), read from any prior
 * choice in localStorage. This file renders the banner when no choice has
 * been made yet, and calls gtag('consent', 'update', ...) plus persists the
 * choice when the visitor accepts or rejects.
 */
(function () {
  var STORAGE_KEY = 'cbs_consent';

  function getStoredConsent() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  function storeConsent(granted) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        status: granted ? 'granted' : 'denied',
        ts: Date.now()
      }));
    } catch (e) {}
  }

  function applyConsent(granted) {
    var state = granted ? 'granted' : 'denied';
    window.dataLayer = window.dataLayer || [];
    gtag('consent', 'update', {
      'ad_storage': state,
      'ad_user_data': state,
      'ad_personalization': state,
      'analytics_storage': state
    });
  }

  // index.html sits at the site root; every other page is exactly one
  // folder deep (about/, ber-calculator/, etc.) — no page is nested deeper.
  function privacyPolicyHref() {
    var segments = window.location.pathname.split('/').filter(function (s) {
      return s && s !== 'index.html';
    });
    return segments.length === 0 ? 'privacy-policy/' : '../privacy-policy/';
  }

  function buildBanner() {
    var banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.id = 'cookie-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<div class="cookie-banner-inner">' +
        '<p>We use cookies for site analytics and to measure how our ads are performing. ' +
        'You can accept or reject these at any time &mdash; see our ' +
        '<a href="' + privacyPolicyHref() + '">Privacy &amp; Cookie Policy</a> for details.</p>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="btn btn-secondary" id="cookie-reject-all">Reject All</button>' +
          '<button type="button" class="btn btn-conversion" id="cookie-accept-all">Accept All</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    return banner;
  }

  function hideBanner(banner) {
    if (!banner) return;
    banner.classList.remove('is-visible');
    document.body.classList.remove('cookie-banner-open');
    setTimeout(function () {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    }, 300);
  }

  function showBanner() {
    if (document.getElementById('cookie-banner')) return;
    var banner = buildBanner();
    document.body.classList.add('cookie-banner-open');

    // Defer adding the visible class one frame so the transform transition
    // actually runs, instead of snapping straight to its end state.
    window.requestAnimationFrame(function () {
      banner.classList.add('is-visible');
    });

    document.getElementById('cookie-accept-all').addEventListener('click', function () {
      storeConsent(true);
      applyConsent(true);
      hideBanner(banner);
    });
    document.getElementById('cookie-reject-all').addEventListener('click', function () {
      storeConsent(false);
      applyConsent(false);
      hideBanner(banner);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!getStoredConsent()) {
      showBanner();
    }

    // "Cookie Preferences" footer link lets a visitor change their mind at
    // any time — GDPR requires withdrawing consent to be as easy as giving it.
    document.querySelectorAll('.js-cookie-preferences').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        showBanner();
      });
    });
  });
})();
