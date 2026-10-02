/**
 * Capital BER Solutions — site interactivity
 * Pushes semantic events to window.dataLayer for GA4, and fires the
 * Google Ads "Submit lead form" conversion directly via gtag().
 */
(function () {
  window.dataLayer = window.dataLayer || [];

  // Lead-intake worker: the sole backend for the quote form. Verifies
  // Turnstile, logs the enquiry to the dashboard, and sends the owner
  // notification + customer autoresponder emails via Resend.
  var LEADS_WORKER_URL = 'https://capitalber-leads.capitalber.workers.dev/submit';

  function pushEvent(eventName, extra) {
    window.dataLayer.push(Object.assign({ event: eventName }, extra || {}));
  }

  // Google Ads event snippet for the "Submit lead form" conversion.
  // Fired on a successful quote-form submission (not on click) so that
  // failed/aborted submissions aren't counted as conversions. `url` is
  // never passed here since the form shows an inline success message
  // instead of redirecting.
  function gtag_report_conversion(url) {
    var callback = function () {
      if (typeof (url) != 'undefined') {
        window.location = url;
      }
    };
    gtag('event', 'conversion', {
      'send_to': 'AW-18244503915/k4JkCMuG_-YcEOuS1PtD',
      'value': 1.0,
      'currency': 'EUR',
      'event_callback': callback
    });
    return false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Every tel: link on the page shares this class (some pages have more
    // than one "Call Now" CTA, so this can no longer rely on a single id).
    var phoneLinks = document.querySelectorAll('.js-tel-link');
    phoneLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        pushEvent('phone_click', { cta_id: link.id || 'tel-link' });
      });
    });

    var whatsappBtn = document.getElementById('whatsapp-widget-click');
    if (whatsappBtn) {
      whatsappBtn.addEventListener('click', function () {
        pushEvent('whatsapp_widget_chat_start', { cta_id: 'whatsapp-widget-click' });
      });
    }

    // Quote form: submitted via fetch() to our own Worker so the visitor
    // sees an inline confirmation on our own page. Requires JavaScript —
    // the Turnstile bot-check it depends on does too, so there's no
    // meaningful no-JS fallback to preserve here.
    var quoteForm = document.getElementById('quote-enquiry-form');
    if (quoteForm) {
      var quoteSuccess = document.getElementById('quote-success');
      var quoteError = document.getElementById('quote-error');
      var quoteSubmitBtn = quoteForm.querySelector('button[type="submit"]');

      quoteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (quoteError) quoteError.hidden = true;
        if (quoteSubmitBtn) {
          quoteSubmitBtn.disabled = true;
          quoteSubmitBtn.textContent = 'Sending...';
        }

        // A timeout guards against the request hanging indefinitely with no
        // response, which would otherwise leave the button stuck on
        // "Sending..." forever with no feedback to the visitor.
        var timeoutController = ('AbortController' in window) ? new AbortController() : null;
        var timeoutId = timeoutController
          ? setTimeout(function () { timeoutController.abort(); }, 15000)
          : null;

        var formData = new FormData(quoteForm);

        fetch(LEADS_WORKER_URL, {
          method: 'POST',
          body: formData,
          signal: timeoutController ? timeoutController.signal : undefined
        })
          .then(function (response) {
            if (timeoutId) clearTimeout(timeoutId);
            if (!response.ok) throw new Error('Submission failed');
            pushEvent('form_submit', { form_id: 'quote-enquiry-form' });
            gtag_report_conversion();
            quoteForm.hidden = true;
            if (quoteSuccess) quoteSuccess.hidden = false;
          })
          .catch(function () {
            if (timeoutId) clearTimeout(timeoutId);
            if (quoteError) quoteError.hidden = false;
            if (quoteSubmitBtn) {
              quoteSubmitBtn.disabled = false;
              quoteSubmitBtn.textContent = 'Request My Quote';
            }
          });
      });
    }

    var yearEl = document.getElementById('current-year');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }

    var navToggle = document.querySelector('.nav-toggle');
    var mobileNav = document.querySelector('.mobile-nav-panel');
    if (navToggle && mobileNav) {
      navToggle.addEventListener('click', function () {
        var isOpen = mobileNav.classList.toggle('is-open');
        navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    }

    // Scroll-reveal: adds the 'reveal' class in JS (not in the markup) so
    // content stays visible by default if JS fails to load.
    var revealTargets = document.querySelectorAll(
      '.card, .step, .faq-item, .quote-section'
    );

    if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

      revealTargets.forEach(function (el) {
        el.classList.add('reveal');
        observer.observe(el);
      });
    }
  });
})();
