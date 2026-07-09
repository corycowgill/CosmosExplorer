// Entry point. Boots the game once the DOM is ready and surfaces any fatal
// initialization error to the loader screen instead of failing silently.

import { Game } from './Game.js';

function boot() {
  try {
    // Expose for debugging in the console.
    window.game = new Game();
  } catch (err) {
    console.error('Cosmos Explorer failed to start:', err);
    const loader = document.getElementById('loader');
    if (loader) {
      loader.classList.remove('hidden', 'fade-out');
      loader.innerHTML =
        '<div class="loader-inner"><div class="loader-text" style="color:#ff5b7a">LAUNCH FAILURE</div>' +
        '<div class="loader-text" style="margin-top:10px;max-width:80vw">' +
        (err && err.message ? err.message : 'Unknown error') +
        '</div><div class="loader-text" style="margin-top:14px">Try a modern browser with WebGL enabled.</div></div>';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
