/* Demo pages: run a game from play/ in a seamless frame and keep it in step with the site.
 *
 * - The frame starts with the site's theme and colours in its URL hash (#theme=…&palette=…), which
 *   the game reads at load.
 * - A theme or colour picked in the site header goes to the game's own controls; one picked in the
 *   game's panel (or with its T key) comes back to the site, so header and game always match.
 * - The frame spans the window.  From 1000px of frame width the game shows its three columns and
 *   fits the window, so the frame reaches the bottom of the window (style.css).
 * - On a computer (any device whose main pointer is not a touch screen) the game always shows its
 *   three columns, as in Full screen: in a window too narrow for them, the frame is drawn 1000px
 *   wide and scaled down.
 * - On a phone or tablet narrower than that, the game is one long column: the frame takes the
 *   game's full height, so the page scrolls as one, with no scroll box inside.
 *
 * - data-frame-css on the frame names a stylesheet (the site's own) to add inside the game, for
 *   touches that only matter when it runs here.
 *
 * The game must be served from the same site (it is: play/ next to this page).  Over file:// the
 * browser walls the frame off; the game still plays, at the CSS height and with its own theme. */
(function () {
  'use strict';

  var frame = document.querySelector('.game-frame');
  if (!frame || !window.Site) return;

  var WIDE = 1000;   // the game's breakpoint for its three-column layout (its style.css)
  var wrap = frame.parentNode;
  // phones and tablets: a touch screen is the main pointer.  Anything else counts as a computer.
  var touch = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
  // Colour themes the game knows (data-palettes, its default first); a site theme the game lacks
  // shows as the game's default.
  var GAME_PALETTES = (frame.getAttribute('data-palettes') || 'mint').split(/\s+/);
  function gamePalette(id) {
    return GAME_PALETTES.indexOf(id) >= 0 ? id : GAME_PALETTES[0];
  }
  function themeHash() {
    return '#theme=' + Site.theme() + '&palette=' + gamePalette(Site.palette());
  }

  var win = null, doc = null;

  /* ---------- size ---------- */
  // Height of what the game shows: its in-flow top-level boxes, top of the first to bottom of the
  // last.  (The game centres itself vertically, so empty space can sit above and below.)
  function contentHeight() {
    var top = Infinity, bottom = -Infinity;
    Array.prototype.forEach.call(doc.body.children, function (el) {
      var cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.position === 'fixed' || cs.position === 'absolute') return;
      var r = el.getBoundingClientRect();
      if (!r.height) return;
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    });
    return bottom > top ? Math.ceil(bottom - top) : 0;
  }

  function fit() {
    var width = wrap.clientWidth;
    // a computer with less than WIDE: draw the three columns at WIDE and scale them down to fit
    var scale = width < WIDE && !(touch && touch.matches) ? width / WIDE : 1;
    frame.style.width = scale < 1 ? WIDE + 'px' : '';
    frame.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
    if (scale === 1 && width < WIDE) {
      // one long column: the frame takes the game's whole height
      if (doc) {
        var h = Math.ceil(doc.documentElement.getBoundingClientRect().height);
        if (h > 0 && Math.abs(frame.offsetHeight - h) > 1) frame.style.height = h + 'px';
      } else {
        frame.style.height = '';
      }
    } else {
      // three columns: as tall as the window allows (CSS), but no taller than the game when the
      // game is limited by the width instead.  The game sizes its board from the frame's height, so
      // trimming the frame to the game leaves the board as it was.  (Heights in the game's pixels.)
      frame.style.height = '';
      var room = frame.offsetHeight / scale, used = doc ? contentHeight() : 0;
      if (used > 0 && used < room - 2) room = used + 2;
      if (scale < 1 || room < frame.offsetHeight - 1) frame.style.height = room + 'px';
    }
    // a scaled frame still takes its unscaled size in the page: the box around it takes the drawn one
    wrap.style.height = scale < 1 ? Math.ceil(frame.offsetHeight * scale) + 'px' : '';
  }

  /* ---------- theme: game -> site ---------- */
  function fromGame() {
    if (!doc) return;
    var r = doc.documentElement;
    var t = r.getAttribute('data-theme') || 'auto';
    var p = r.getAttribute('data-palette') || GAME_PALETTES[0];
    if (t !== Site.theme()) Site.setTheme(t);
    // The game showing its default for a site theme it lacks is not a change.
    if (p !== gamePalette(Site.palette())) Site.setPalette(p);
  }

  /* ---------- theme: site -> game ---------- */
  // Through the game's own Theme and Colors radios (name="theme", name="palette"), as if picked
  // there: the game applies them at once, so quick successive changes can't cross.  A hash change
  // is the fallback for a game without those radios (the game handles it asynchronously).
  function toGame() {
    if (!doc) return;
    var r = doc.documentElement;
    var want = { theme: Site.theme(), palette: gamePalette(Site.palette()) };
    var have = { theme: r.getAttribute('data-theme') || 'auto', palette: r.getAttribute('data-palette') || GAME_PALETTES[0] };
    var viaHash = false;
    ['theme', 'palette'].forEach(function (name) {
      if (want[name] === have[name]) return;
      var input = doc.querySelector('input[type="radio"][name="' + name + '"][value="' + want[name] + '"]');
      if (!input) { viaHash = true; return; }
      input.checked = true;
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
    });
    if (!viaHash) return;
    try {
      // replace(): a hash change that adds no entry to the browser history
      win.location.replace(win.location.href.split('#')[0] + themeHash());
    } catch (e) { /* frame walled off */ }
  }

  /* ---------- the site's style touches inside the game (data-frame-css) ---------- */
  var extraCss = frame.getAttribute('data-frame-css');
  function addFrameCss(d) {
    if (!extraCss || !d.head || d.querySelector('link[data-site-frame-css]')) return;
    var link = d.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL(extraCss, location.href).href;
    link.setAttribute('data-site-frame-css', '');
    link.addEventListener('load', fit);
    d.head.appendChild(link);
  }
  // Add it as soon as the game's document has a head, before the game first paints, rather than
  // at the frame's load event: otherwise the phone layout would flash uncorrected.
  function addFrameCssEarly(tries) {
    var d = null;
    try { d = frame.contentDocument; } catch (e) { return; }   // walled off: nothing to add
    if (d && d.URL !== 'about:blank' && d.head) { addFrameCss(d); return; }
    if (tries > 0) requestAnimationFrame(function () { addFrameCssEarly(tries - 1); });
  }

  function connect() {
    try {
      win = frame.contentWindow;
      doc = frame.contentDocument;
      if (!doc || !doc.documentElement || !doc.body) throw new Error('no access');
    } catch (e) {
      win = doc = null;   // file:// or another origin: CSS height, the game's own theme
      return;
    }
    addFrameCss(doc);   // in case the early pass missed it
    var RO = win.ResizeObserver || window.ResizeObserver;
    if (RO) new RO(fit).observe(doc.documentElement);
    var MO = win.MutationObserver || window.MutationObserver;
    new MO(fromGame).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
    toGame();
    fit();
  }

  frame.addEventListener('load', connect);
  window.addEventListener('resize', fit);
  if (touch && touch.addEventListener) touch.addEventListener('change', fit);
  Site.onChange(toGame);

  fit();
  frame.src = frame.getAttribute('data-src') + themeHash();
  addFrameCssEarly(600);   // about ten seconds of frames
})();
