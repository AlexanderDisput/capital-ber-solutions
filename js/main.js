/**
 * Capital BER Solutions — site interactivity
 * Pushes semantic events to window.dataLayer for GTM triggers/tags
 * (Google Ads conversion tracking is configured in the GTM dashboard
 * against these event names, not hard-coded here).
 */
(function () {
  window.dataLayer = window.dataLayer || [];

  function pushEvent(eventName, extra) {
    window.dataLayer.push(Object.assign({ event: eventName }, extra || {}));
  }

  document.addEventListener('DOMContentLoaded', function () {
    var phoneBtn = document.getElementById('hero-phone-btn');
    if (phoneBtn) {
      phoneBtn.addEventListener('click', function () {
        pushEvent('phone_click', { cta_id: 'hero-phone-btn' });
      });
    }

    var quoteForm = document.getElementById('quote-enquiry-form');
    if (quoteForm) {
      quoteForm.addEventListener('submit', function () {
        pushEvent('form_submit', { form_id: 'quote-enquiry-form' });
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
