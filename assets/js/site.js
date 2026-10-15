/* Homepage behaviour, shared by every page: the display settings (theme and colours, in the left
 * bar and the header drop-down), the header drop-down itself, abstract/BibTeX toggles and BibTeX
 * copy.  Pages read fine without it: all content is static HTML, and the abstracts and BibTeX stay
 * expanded when this script does not run.
 *
 * window.Site lets other scripts follow the display settings (demos/pivot-cubes keeps the game in
 * step with them):
 *   Site.theme(), Site.palette()           'auto' | 'light' | 'dark', and the colour theme id
 *   Site.setTheme(t), Site.setPalette(id)  apply and remember
 *   Site.onChange(fn)                      fn(theme, palette) after every change */
(function () {
  'use strict';

  var root = document.documentElement;

  /* The same colour themes as Pivot Cubes, Mint first; the tokens live in style.css under
   * [data-palette].  The first entry is the default, which needs no attribute or saved value. */
  var PALETTES = [
    ['mint', 'Mint'], ['indigo', 'Indigo'], ['ocean', 'Ocean'], ['sunset', 'Sunset'],
    ['grape', 'Grape'], ['slate', 'Slate']
  ];
  var DEFAULT_PALETTE = PALETTES[0][0];
  var KEY_THEME = 'homepage.theme';
  var KEY_PALETTE = 'homepage.palette';
  var KEY_DISPLAY_OPEN = 'homepage.displayOpen';   // the left bar's Display section, unfolded
  var BG = { light: '#f2f1ed', dark: '#121419' };

  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* private mode or storage blocked: the choice lasts for this visit */ }
  }

  var state = { theme: 'auto', palette: DEFAULT_PALETTE };
  var listeners = [];
  function cap(word) { return word.charAt(0).toUpperCase() + word.slice(1); }
  function changed() {
    // the folded Display section shows the current choices, e.g. "Auto · Mint"
    var summary = cap(state.theme) + ' · ' + paletteName(state.palette);
    document.querySelectorAll('[data-display-summary]').forEach(function (el) { el.textContent = summary; });
    listeners.forEach(function (fn) {
      try { fn(state.theme, state.palette); } catch (e) { if (window.console) console.error(e); }
    });
  }

  /* ---------- light / dark ---------- */
  function setTheme(theme, persist) {
    if (theme !== 'light' && theme !== 'dark') theme = 'auto';
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    document.querySelectorAll('input[data-theme-opt]').forEach(function (input) {
      input.checked = input.value === theme;
    });
    // Browser chrome follows a forced theme too; in auto the two media-scoped tags take over.
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      var scheme = /dark/.test(meta.media) ? 'dark' : 'light';
      meta.content = BG[theme === 'auto' ? scheme : theme];
    });
    if (persist !== false) save(KEY_THEME, theme === 'auto' ? null : theme);
    var was = state.theme;
    state.theme = theme;
    if (was !== theme) changed();
  }

  /* ---------- colour theme ---------- */
  function paletteName(id) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i][0] === id) return PALETTES[i][1];
    return null;
  }
  function setPalette(id, persist) {
    if (!paletteName(id)) id = DEFAULT_PALETTE;   // includes a saved theme that no longer exists
    if (id === DEFAULT_PALETTE) root.removeAttribute('data-palette');
    else root.setAttribute('data-palette', id);
    document.querySelectorAll('input[data-palette-opt]').forEach(function (input) {
      input.checked = input.value === id;
    });
    document.querySelectorAll('.palette-name').forEach(function (el) { el.textContent = paletteName(id); });
    if (persist !== false) save(KEY_PALETTE, id === DEFAULT_PALETTE ? null : id);
    var was = state.palette;
    state.palette = id;
    if (was !== id) changed();
  }

  // One swatch per colour theme in every .swatches box (radios dressed as chips, as in the game).
  function buildSwatches() {
    document.querySelectorAll('.swatches').forEach(function (box, n) {
      PALETTES.forEach(function (p) {
        var label = document.createElement('label');
        label.className = 'swatch';
        label.setAttribute('data-palette', p[0]);
        label.title = p[1];
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'palette-' + n;
        input.value = p[0];
        input.setAttribute('data-palette-opt', '');
        input.setAttribute('aria-label', p[1]);
        var chip = document.createElement('i');
        chip.className = 'swatch-chip';
        chip.setAttribute('aria-hidden', 'true');
        label.appendChild(input);
        label.appendChild(chip);
        box.appendChild(label);
      });
    });
  }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('[data-theme-opt]')) setTheme(t.value);
    else if (t.matches('[data-palette-opt]')) setPalette(t.value);
  });

  /* ---------- header drop-down (below 1000px, where there is no left bar) ---------- */
  var pop = document.getElementById('site-pop');
  var popButtons = Array.prototype.slice.call(document.querySelectorAll('[data-pop]'));

  function setPop(open, focusBack) {
    if (!pop) return;
    pop.hidden = !open;
    popButtons.forEach(function (b) { b.setAttribute('aria-expanded', String(open)); });
    if (!open && focusBack) {
      var visible = popButtons.filter(function (b) { return b.offsetParent !== null; })[0];
      if (visible) visible.focus();
    }
  }

  popButtons.forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      setPop(pop.hidden);
    });
  });
  document.addEventListener('click', function (e) {
    if (pop && !pop.hidden && !pop.contains(e.target)) setPop(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pop && !pop.hidden) setPop(false, true);
  });
  if (pop) {
    pop.addEventListener('click', function (e) {
      if (e.target.closest('a')) setPop(false);   // a page link: close before leaving
    });
  }
  // On phones the drop-down also holds the page links; close it when the width crosses over.
  var mqNarrow = window.matchMedia ? window.matchMedia('(max-width: 759.98px)') : null;
  if (mqNarrow) {
    var onWidth = function () { setPop(false); };
    if (mqNarrow.addEventListener) mqNarrow.addEventListener('change', onWidth);
    else if (mqNarrow.addListener) mqNarrow.addListener(onWidth);
  }

  /* ---------- toast ---------- */
  var toastTimer = 0;
  function toast(text) {
    var el = document.getElementById('toast');
    if (!el) return;
    document.getElementById('toastText').textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  /* ---------- abstract / BibTeX toggles, copy ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      var panel = document.getElementById(toggle.getAttribute('aria-controls'));
      var open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      if (panel) panel.classList.toggle('open', open);
      return;
    }
    var copy = e.target.closest('[data-copy]');
    if (copy) {
      var src = document.getElementById(copy.getAttribute('data-copy'));
      if (!src) return;
      copyText(src.textContent).then(
        function () { toast('BibTeX copied'); },
        function () { toast('Copy failed: select the text instead'); }
      );
    }
  });

  /* ---------- start ---------- */
  buildSwatches();
  setTheme(load(KEY_THEME), false);
  var saved = load(KEY_PALETTE);
  setPalette(saved, false);
  if (saved && saved !== state.palette) save(KEY_PALETTE, null);   // a theme since removed (Forest)
  changed();   // fill in the Display summaries, whether or not anything differs from the defaults

  // The Display section stays unfolded from page to page once opened.
  document.querySelectorAll('details.side-display').forEach(function (el) {
    el.open = load(KEY_DISPLAY_OPEN) === '1';
    el.addEventListener('toggle', function () { save(KEY_DISPLAY_OPEN, el.open ? '1' : null); });
  });

  window.Site = {
    theme: function () { return state.theme; },
    palette: function () { return state.palette; },
    setTheme: function (t) { setTheme(t); },
    setPalette: function (id) { setPalette(id); },
    onChange: function (fn) { listeners.push(fn); }
  };

  // Enable transitions only after the first frame, so the controls appear in their final state.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { root.classList.add('ready'); });
  });
})();
