// SEC-05: Extracted from inline <script> to allow removing 'unsafe-inline' from CSP script-src
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      console.warn('SW registration failed:', err);
    });
  });
}
// PWA standalone mode detection (A10-03)
if (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches) {
  document.body.classList.add('pwa-standalone');
}
