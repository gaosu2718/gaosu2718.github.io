/* Pivot Cubes: the app shell.
 *
 * Builds puzzles from the settings column, attaches the board (render.js) and the drag input
 * (input.js), and owns everything around them: the HUD, the status line, the win card, keyboard
 * shortcuts, the theme, the URL hash and localStorage persistence.  The rules live in rules.js and
 * game.js; this file never decides whether a move is legal.
 *
 * Load order (classic scripts): datasets, rules, shapes, game, render, input, app.
 */
(function () {
  'use strict';

  var Rules = window.CubeRules;
  var Shapes = window.CubeShapes;
  var Game = window.CubeGame;
  var Render = window.CubeRender;
  var Input = window.CubeInput;

  function showError(msg) {
    if (window.pcShowError) window.pcShowError(msg);
    else if (window.console) console.error(msg);
  }

  var missing = [['CubeRules', Rules], ['CubeShapes', Shapes], ['CubeGame', Game],
    ['CubeRender', Render], ['CubeInput', Input]]
    .filter(function (p) { return !p[1]; })
    .map(function (p) { return p[0]; });
  if (!missing.length && typeof Shapes.challenge !== 'function') missing.push('CubeShapes.challenge');
  if (missing.length) {
    showError('Could not load ' + missing.join(', ') + '. Check that every file in game/js/ is present and current.');
    return;
  }

  // --- constants -------------------------------------------------------------------------------

  var SETTINGS_KEY = 'cubesGame.settings.v1';
  var SESSION_KEY = 'cubesGame.session.v1';
  var KEY_VERSION = 'v4';                       // saves from older builds never match this prefix
  var N_MIN = typeof Shapes.N_MIN === 'number' ? Shapes.N_MIN : 10;
  var N_MAX = typeof Shapes.N_MAX === 'number' ? Shapes.N_MAX : 50;
  var CHALLENGES = Array.isArray(Shapes.CHALLENGES) && Shapes.CHALLENGES.length ? Shapes.CHALLENGES : [
    {id: 'easy', label: 'Easy', k: 30, solvable: true, blurb: ''},
    {id: 'hard', label: 'Hard', k: 100, solvable: true, blurb: ''},
    {id: 'mnist', label: 'MNIST', k: null, solvable: false, blurb: ''},
    {id: 'random', label: 'Random', k: null, solvable: false, blurb: ''},
  ];
  var LEVELS = CHALLENGES.map(function (c) { return c.id; });
  var MODES = ['challenge', 'shapes'];
  var THEMES = ['auto', 'light', 'dark'];
  // colour themes, independent of light/dark (style.css holds the colours; the first is the default)
  var PALETTES = [{id: 'mint', label: 'Mint'}, {id: 'indigo', label: 'Indigo'}, {id: 'ocean', label: 'Ocean'},
    {id: 'sunset', label: 'Sunset'}, {id: 'grape', label: 'Grape'}, {id: 'slate', label: 'Slate'}];
  var PALETTE_IDS = PALETTES.map(function (p) { return p.id; });
  var LEVEL_IDS = 2;          // stored settings carry this; without it a stored level uses the old ids
  var NAMES = Object.keys(Shapes.NAMED);
  var SEEDED_SHAPES = ['random', 'mnist', 'vicsek'];   // named shapes that draw from the seed
  // hash keys that make a link name a puzzle ('model', 'style' and 'k' are from older builds: a link
  // carrying them still counts, but their values are ignored or mapped)
  var PUZZLE_PARAMS = ['mode', 'n', 'level', 'seed', 'start', 'target', 'startDigit', 'targetDigit',
    'model', 'style', 'k'];
  var DISPLAY_KEYS = ['ghost', 'grid', 'destPreview', 'animations'];
  var ARROWS = {L: '←', R: '→', U: '↑', D: '↓'};
  var STATUS_MS = 2500;

  var mqDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var mqReduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  var DEFAULTS = {
    mode: 'challenge',
    n: Math.max(N_MIN, Math.min(N_MAX, 30)),
    level: LEVELS[0],
    seed: Shapes.randomSeed(),
    start: 'line',
    target: 'block',
    startDigit: null,
    targetDigit: null,
    ghost: true,
    grid: true,
    destPreview: true,
    animations: !(mqReduce && mqReduce.matches),
    theme: 'auto',
    palette: PALETTE_IDS[0],
    levelIds: LEVEL_IDS,      // marks saved settings as using the current level ids (merge never overwrites it)
  };

  // --- state -----------------------------------------------------------------------------------

  var settings = null;
  var game = null;
  var gameKey = '';
  var firstMoveAt = null;     // ms timestamp of the first step of this puzzle
  var board = null, input = null, thumbStart = null, thumbTarget = null;
  var theme = null;
  var lastHash = null;        // the hash this page last wrote (to ignore our own hashchange)
  var statusTimer = 0, statusSticky = false, holdStatus = false;
  var timers = {};

  var $ = function (id) { return document.getElementById(id); };

  // --- small helpers ---------------------------------------------------------------------------

  function later(name, fn, ms) {
    clearTimeout(timers[name]);
    timers[name] = setTimeout(fn, ms);
  }

  function plural(k, word) { return k + ' ' + word + (k === 1 ? '' : 's'); }

  function clampInt(v, lo, hi) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return null;
    return Math.max(lo, Math.min(hi, n));
  }

  function oneOf(v, allowed) { return allowed.indexOf(v) >= 0 ? v : null; }

  function cleanSeed(v) {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    v = String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
    return v || null;
  }

  /** A digit setting: 0-9, or null for "any".  Returns undefined when `v` is not a valid value. */
  function cleanDigit(v) {
    if (v === null || v === 'any' || v === '') return null;
    if (typeof v === 'number' || (typeof v === 'string' && /^\d$/.test(v))) {
      var d = +v;
      if (d >= 0 && d <= 9 && d === Math.floor(d)) return d;
    }
    return undefined;
  }

  function isDigit(d) { return typeof d === 'number' && d >= 0 && d <= 9; }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'puzzle';
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + ':' + (r < 10 ? '0' : '') + r;
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  function listen(mq, fn) {
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  }

  function paletteOf(id) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
    return PALETTES[0];
  }

  function challengeOf(id) {
    for (var i = 0; i < CHALLENGES.length; i++) if (CHALLENGES[i].id === id) return CHALLENGES[i];
    return CHALLENGES[0];
  }

  // --- storage: every access guarded -----------------------------------------------------------

  function storeGet(key) {
    try {
      var s = window.localStorage.getItem(key);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  function storeSet(key, val) {
    try {
      window.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* private mode, quota, disabled storage: play on without saving */ }
  }

  function saveSettingsNow() {
    if (settings) storeSet(SETTINGS_KEY, settings);
  }

  function saveSessionNow() {
    if (!game || (game.puzzle && game.puzzle.mode === 'custom')) return;   // debug puzzles aren't kept
    storeSet(SESSION_KEY, {v: 1, key: gameKey, game: game.serialize(), firstMoveAt: firstMoveAt});
  }

  function saveSettingsSoon() { later('settings', saveSettingsNow, 300); }
  function saveSessionSoon() { later('session', saveSessionNow, 400); }

  function flushSaves() {
    clearTimeout(timers.settings);
    clearTimeout(timers.session);
    saveSettingsNow();
    saveSessionNow();
  }

  // --- settings --------------------------------------------------------------------------------

  /**
   * `base` overlaid with the valid fields of `src` (a stored object or parsed hash strings).
   * Older builds' values are read gracefully: mode 'scramble' is a challenge, a scramble length `k`
   * without a `level` picks the scramble level nearest to it, level ids from before the rename are
   * mapped (see levelOf; `legacy` marks a stored object from before it), and `model` / `style` are
   * ignored (one model now).
   */
  function merge(base, src, legacy) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    if (!src || typeof src !== 'object') return out;
    var v;
    if ((v = oneOf(src.mode === 'scramble' ? 'challenge' : src.mode, MODES))) out.mode = v;
    if ((v = clampInt(src.n, N_MIN, N_MAX)) !== null) out.n = v;
    if ((v = levelOf(src.level, legacy))) out.level = v;
    else if (src.level === undefined && (v = clampInt(src.k, 1, 100000)) !== null) {
      out.level = levelForK(v);
    }
    if ((v = cleanSeed(src.seed))) out.seed = v;
    if ((v = oneOf(src.start, NAMES))) out.start = v;
    if ((v = oneOf(src.target, NAMES))) out.target = v;
    if ('startDigit' in src && (v = cleanDigit(src.startDigit)) !== undefined) out.startDigit = v;
    if ('targetDigit' in src && (v = cleanDigit(src.targetDigit)) !== undefined) out.targetDigit = v;
    if ((v = oneOf(src.theme, THEMES))) out.theme = v;
    if ((v = oneOf(src.palette, PALETTE_IDS))) out.palette = v;
    DISPLAY_KEYS.forEach(function (k) { if (typeof src[k] === 'boolean') out[k] = src[k]; });
    return out;
  }

  /** The scramble challenge whose length is nearest to k (for links from older builds). */
  function levelForK(k) {
    var best = LEVELS[0], gap = Infinity;
    CHALLENGES.forEach(function (c) {
      if (typeof c.k === 'number' && Math.abs(c.k - k) < gap) { gap = Math.abs(c.k - k); best = c.id; }
    });
    return best;
  }

  /**
   * A level id.  The levels were renamed: 'medium' became 'hard' and the old 'hard' became
   * 'random'.  'medium' always maps; 'hard' maps to 'random' only in a `legacy` object (stored
   * before the rename), so a current 'hard' is never remapped.  Links carry no marker and are read
   * with the current ids.
   */
  function levelOf(v, legacy) {
    if (v === 'medium') return 'hard';
    if (legacy && v === 'hard') return 'random';
    return oneOf(v, LEVELS);
  }

  function usesSeed(s) {
    return s.mode === 'challenge' || SEEDED_SHAPES.indexOf(s.start) >= 0 || SEEDED_SHAPES.indexOf(s.target) >= 0;
  }

  function digitKey(name, d) { return name === 'mnist' ? (isDigit(d) ? String(d) : 'any') : ''; }

  /** Identity of a puzzle: equal keys build the same start and target. */
  function puzzleKey(s) {
    if (s.mode === 'shapes') {
      return [KEY_VERSION, 'shapes', s.n, s.start, digitKey(s.start, s.startDigit),
        s.target, digitKey(s.target, s.targetDigit), usesSeed(s) ? s.seed : ''].join('|');
    }
    return [KEY_VERSION, 'challenge', s.n, s.level, s.seed].join('|');
  }

  /** The URL-hash form of a puzzle (in a stable, readable order). */
  function puzzleParams(s) {
    var p = {mode: s.mode, n: s.n};
    if (s.mode === 'challenge') {
      p.level = s.level;
      p.seed = s.seed;
    } else {
      p.start = s.start;
      if (s.start === 'mnist' && isDigit(s.startDigit)) p.startDigit = s.startDigit;
      p.target = s.target;
      if (s.target === 'mnist' && isDigit(s.targetDigit)) p.targetDigit = s.targetDigit;
      if (usesSeed(s)) p.seed = s.seed;
    }
    return p;
  }

  // --- URL hash --------------------------------------------------------------------------------

  function parseHash() {
    var out = {};
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return out;
    h.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i);
      var v = i < 0 ? '' : kv.slice(i + 1);
      try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* keep raw */ }
      out[k] = v;
    });
    return out;
  }

  function hasPuzzleParams(hash) {
    return PUZZLE_PARAMS.some(function (k) { return Object.prototype.hasOwnProperty.call(hash, k); });
  }

  /** A shared link names its digits explicitly: a missing one means "any", not "as before". */
  function hashSettings(hash) {
    var h = {};
    Object.keys(hash).forEach(function (k) { h[k] = hash[k]; });
    if (hasPuzzleParams(hash)) {
      if (!('startDigit' in h)) h.startDigit = 'any';
      if (!('targetDigit' in h)) h.targetDigit = 'any';
    }
    return h;
  }

  function hashFor(s) {
    var p = puzzleParams(s);
    return Object.keys(p).map(function (k) {
      return k + '=' + encodeURIComponent(p[k]);
    }).join('&');
  }

  /** Keep the address bar on the current puzzle, so a reload or a copied URL reopens it. */
  function syncHash() {
    var h = '#' + hashFor(settings);
    if (location.hash === h) { lastHash = h; return; }
    lastHash = h;
    try {
      history.replaceState(null, '', h);
    } catch (e) {
      try { location.replace(h); } catch (e2) { /* address bar stays as it was */ }
    }
  }

  function shareLink() {
    return location.href.split('#')[0] + '#' + hashFor(settings);
  }

  // --- building puzzles ------------------------------------------------------------------------

  function buildGame(s) {
    if (s.mode === 'shapes') {
      var start = Shapes.named(s.start, s.n, Shapes.rng(s.seed + '|start'),
        {digit: s.start === 'mnist' ? s.startDigit : null});
      var target = Shapes.named(s.target, s.n, Shapes.rng(s.seed + '|target'),
        {digit: s.target === 'mnist' ? s.targetDigit : null});
      var pz = {mode: 'shapes', n: s.n, start: s.start, target: s.target};
      if (s.start === 'mnist' && isDigit(s.startDigit)) pz.startDigit = s.startDigit;
      if (s.target === 'mnist' && isDigit(s.targetDigit)) pz.targetDigit = s.targetDigit;
      if (usesSeed(s)) pz.seed = s.seed;
      return new Game({start: start, target: target, puzzle: pz});
    }
    var p = Shapes.challenge({level: s.level, n: s.n, seed: s.seed});
    var puzzle = {mode: 'challenge', level: s.level, n: s.n, seed: s.seed,
      par: typeof p.par === 'number' ? p.par : null};
    if (p.info) puzzle.info = p.info;
    return new Game({start: p.start, target: p.target, puzzle: puzzle});
  }

  /** Make `g` the current game.  opts: {firstMoveAt} when restoring a saved session. */
  function startPuzzle(g, opts) {
    opts = opts || {};
    cancelDrag();
    closeWin();
    game = g;
    gameKey = puzzleKey(settings);
    firstMoveAt = typeof opts.firstMoveAt === 'number' ? opts.firstMoveAt : null;
    board.setGame(game, {fit: true});
    board.refresh();
    drawThumbs();
    updateHud();
    renderSettings();
    syncHash();
    saveSessionSoon();
    saveSettingsSoon();
    clearStatus(true);
    if (game.stuck()) setStatus('No legal moves from this shape — try another puzzle.', 'warn', true);
  }

  function hasProgress() {
    return !!game && (game.moveCount() > 0 || game.canRedo()) && !game.solved();
  }

  // --- in-page confirm (window.confirm is silently suppressed in sandboxed iframes) -------------

  var pendingConfirm = null;

  /** Ask before throwing away unsolved progress; calls onYes or onNo (maybe immediately). */
  function askDiscard(onYes, onNo) {
    if (!hasProgress()) { onYes(); return; }
    if (pendingConfirm) resolveConfirm(false);
    var m = game.moveCount();
    $('confirmText').textContent = 'Your ' + (m > 0 ? plural(m, 'step') : 'step history') +
      ' on this puzzle will be lost.';
    pendingConfirm = {yes: onYes, no: onNo};
    cancelDrag();
    var el = $('confirm');
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    setTimeout(function () { try { $('confirmYes').focus({preventScroll: true}); } catch (e) { /* old browser */ } }, 30);
  }

  function confirmOpen() { return !!pendingConfirm; }

  function resolveConfirm(ok) {
    var p = pendingConfirm;
    pendingConfirm = null;
    var el = $('confirm');
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    if (el.contains(document.activeElement)) document.activeElement.blur();
    if (p) (ok ? p.yes : p.no)();
  }

  /**
   * Change puzzle settings and regenerate.  `patch` is merged into the settings.  If the player
   * declines to throw away their progress, or the puzzle can't be built, nothing changes, the
   * controls snap back and `opts.onCancel` runs.
   */
  function changePuzzle(patch, opts) {
    opts = opts || {};
    var cancel = function () {
      renderSettings();
      if (opts.onCancel) opts.onCancel();
    };
    var go = function () {
      var next = merge(settings, patch);
      var g;
      try {
        g = buildGame(next);
      } catch (e) {
        showError('Could not build that puzzle: ' + (e && e.message ? e.message : e));
        cancel();
        return;
      }
      settings = next;
      startPuzzle(g);
    };
    if (opts.force) go();
    else askDiscard(go, cancel);
  }

  function newPuzzle(force) {
    var patch = {};
    if (usesSeed(settings)) patch.seed = Shapes.randomSeed();
    return changePuzzle(patch, {force: force});
  }

  // --- board and input -------------------------------------------------------------------------

  function displayOptions() {
    return {
      ghost: settings.ghost,
      grid: settings.grid,
      destPreview: settings.destPreview,
      animations: settings.animations,
    };
  }

  function cancelDrag() {
    if (!input || !input.fsm || typeof input.fsm.cancel !== 'function') return;
    try { input.fsm.cancel(); } catch (e) { /* already idle */ }
  }

  function onCommit(id, move, fromP, animate) {
    var before = game.moveCount();
    game.commit(move);
    if (firstMoveAt === null) firstMoveAt = Date.now();
    board.preview(null);
    if (animate) board.animateMove(id, move, fromP, 1);
    board.refresh();
    // loop erasure: a step that recreates an earlier state rewinds the count instead of adding one
    if (game.lastErased > 0 && !game.solved()) {
      setStatus('Back to an earlier state: steps ' + before + ' → ' + game.moveCount(), 'info');
    }
    afterChange(true);
  }

  function onBlocked(fail, id, dir) {
    var msg = blockMessage(fail, dir);
    if (msg) setStatus(msg, 'warn');
  }

  function onUnblocked() { /* the message fades by itself */ }

  function onHover() { /* attach() already highlights the cube under the pointer */ }

  function blockMessage(fail, dir) {
    var k;
    switch (fail && fail.reason) {
      case 'cut':
        k = (fail.dependents || []).length;
        return 'Lifting this cube would leave ' + plural(k, 'cube') + ' hanging loose.';
      case 'nohinge':
        var horizontal = dir === 'L' || dir === 'R';
        return 'Nothing to pivot on — rolling ' + (ARROWS[dir] || '') + ' needs a cube ' +
          (horizontal ? 'above or below it' : 'beside it') + ', or one diagonally ahead.';
      case 'blocked':
        k = (fail.blockers || []).length;
        return 'Blocked by ' + plural(k, 'cube') + ' in the swing path.';
      default:
        return 'That cube can’t roll that way.';
    }
  }

  /** After any change of game state: HUD, saving, and the win / stuck checks. */
  function afterChange(checkWin) {
    updateHud();
    saveSessionSoon();
    if (checkWin && game.solved()) {
      showWin();
      return;
    }
    if (game.stuck()) setStatus('No legal moves — undo or reset.', 'warn', true);
    else if (statusSticky) clearStatus();
  }

  function undo() {
    cancelDrag();
    if (!game.canUndo()) return;
    closeWin();
    board.snapAnimations();
    var h = game.undo();
    board.preview(null);
    if (h && settings.animations) board.animateMove(h.id, h.move, 1, 0);
    board.refresh();
    afterChange(false);
  }

  function redo() {
    cancelDrag();
    if (!game.canRedo()) return;
    board.snapAnimations();
    var h = game.redo();
    board.preview(null);
    if (h && settings.animations) board.animateMove(h.id, h.move, 0, 1);
    board.refresh();
    afterChange(true);
  }

  function reset() {
    cancelDrag();
    if (!game.canUndo()) return;
    closeWin();
    board.snapAnimations();
    game.reset();
    board.preview(null);
    board.refresh();
    afterChange(false);
    setStatus('Back to the start. Redo replays your steps.', 'info');
  }

  function fitView() { board.fit(!!settings.animations); }

  // --- HUD, puzzle info, thumbnails --------------------------------------------------------------

  function onBoardChange(info) {
    updateHud(info);
    drawTargetThumb(info && info.t);
  }

  function parOf(g) {
    return g.puzzle && typeof g.puzzle.par === 'number' ? g.puzzle.par : null;
  }

  function updateHud(info) {
    if (!game) return;
    var al = info || board.alignment || {matched: 0};
    var matched = al.matched || 0;
    var n = game.n;
    var par = parOf(game);
    $('hudMoves').textContent = game.moveCount();
    $('hudParWrap').hidden = par === null;
    if (par !== null) $('hudPar').textContent = par;
    $('hudMatched').textContent = matched + '/' + n;
    var pct = n ? Math.round(100 * matched / n) : 0;
    var bar = $('hudBar');
    bar.firstElementChild.style.width = pct + '%';
    bar.setAttribute('aria-valuenow', String(pct));
    bar.classList.toggle('done', game.solved());
    renderMeta();
    var d = digits();
    $('capStart').textContent = (isDigit(d[0]) ? 'Digit ' + d[0] + ' · ' : '') + plural(n, 'cube');
    $('capTarget').textContent = (isDigit(d[1]) ? 'Digit ' + d[1] + ' · ' : '') + matched + '/' + n + ' in place';
    $('undoBtn').disabled = !game.canUndo();
    $('redoBtn').disabled = !game.canRedo();
    $('resetBtn').disabled = !game.canUndo();
  }

  /** [start digit, target digit] when the puzzle's shapes are known MNIST digits. */
  function digits() {
    var p = game.puzzle || {};
    if (p.mode === 'challenge' && p.level === 'mnist' && p.info) return [p.info.startDigit, p.info.targetDigit];
    if (p.mode === 'shapes') {
      return [p.start === 'mnist' ? p.startDigit : null, p.target === 'mnist' ? p.targetDigit : null];
    }
    return [null, null];
  }

  function shapeLabel(name, digit) {
    if (name === 'mnist') return isDigit(digit) ? 'MNIST ' + digit : 'MNIST digit';
    return Shapes.NAMED[name] ? Shapes.NAMED[name].label : String(name);
  }

  /** Top-right puzzle info: what this puzzle is, and under which rules. */
  function renderMeta() {
    var p = game.puzzle || {};
    var d = digits();
    var main, sub;
    if (p.mode === 'shapes') {
      main = shapeLabel(p.start, d[0]) + ' → ' + shapeLabel(p.target, d[1]);
      sub = 'Shapes' + (p.seed !== undefined ? ' · seed ' + p.seed : '');
    } else {
      var c = challengeOf(p.level);
      if (p.level === 'mnist') {
        main = isDigit(d[0]) && isDigit(d[1]) ? 'MNIST ' + d[0] + ' → ' + d[1] : 'MNIST digits';
      } else if (typeof c.k === 'number') {
        main = c.label + ' · two-way scramble, ' + Math.floor(c.k / 2) + ' + ' + (c.k - Math.floor(c.k / 2)) + ' steps';
      } else {
        main = c.label + ' · two random shapes';
      }
      sub = 'Seed ' + p.seed;
    }
    if (p.mode === 'custom') {
      main = 'Custom puzzle';
      sub = 'Loaded from the console';
    }
    var el = $('hudMeta');
    el.textContent = '';
    [[main, 'meta-main'], [sub, 'meta-sub']].forEach(function (x) {
      var span = document.createElement('span');
      span.className = x[1];
      span.textContent = x[0];
      span.title = x[0];
      el.appendChild(span);
    });
  }

  function drawThumbs() {
    if (!game || !thumbStart) return;
    thumbStart.draw(game.start, {mode: 'cubes', theme: theme});
    drawTargetThumb();
  }

  function drawTargetThumb(t) {
    if (!game || !thumbTarget) return;
    t = t || (board && board.alignment && board.alignment.t) || [0, 0];
    var matched = new Set();
    game.target.forEach(function (c) {
      if (game.occ.has(Rules.key(c[0] + t[0], c[1] + t[1]))) matched.add(Rules.key(c[0], c[1]));
    });
    thumbTarget.draw(game.target, {mode: 'target', matched: matched, theme: theme});
  }

  // --- status line -----------------------------------------------------------------------------

  /** kind: 'warn' | 'info' | 'ok'.  Sticky messages stay until the state changes. */
  function setStatus(text, kind, sticky) {
    var el = $('status');
    $('statusText').textContent = text;
    el.setAttribute('data-kind', kind || 'info');
    el.classList.add('show');
    statusSticky = !!sticky;
    clearTimeout(statusTimer);
    if (!sticky && !holdStatus) statusTimer = setTimeout(function () { el.classList.remove('show'); }, STATUS_MS);
  }

  function clearStatus(force) {
    if (holdStatus && !force) return;
    clearTimeout(statusTimer);
    statusSticky = false;
    $('status').classList.remove('show');
  }

  // --- win card --------------------------------------------------------------------------------

  function showWin() {
    var m = game.moveCount();
    var par = parOf(game);
    var bits = [];
    if (par !== null) {
      var verdict = m < par ? ' (under par!)' : m === par ? ' (right on par)' : '';
      bits.push('par ≤ ' + par + verdict);
    }
    if (firstMoveAt !== null) bits.push(fmtTime(Date.now() - firstMoveAt));
    $('winTitle').textContent = 'Solved in ' + plural(m, 'step');
    $('winSub').textContent = bits.join(' · ');
    $('winSub').hidden = !bits.length;
    var win = $('win');
    win.classList.add('open');
    win.setAttribute('aria-hidden', 'false');
    board.celebrate();
    clearStatus(true);
    setTimeout(function () { try { $('winNext').focus({preventScroll: true}); } catch (e) { /* old browser */ } }, 60);
  }

  function winOpen() { return $('win').classList.contains('open'); }

  function closeWin() {
    var win = $('win');
    if (!win.classList.contains('open')) return;
    win.classList.remove('open');
    win.setAttribute('aria-hidden', 'true');
    if (win.contains(document.activeElement)) document.activeElement.blur();
  }

  // --- export and share ------------------------------------------------------------------------

  function exportJson() {
    var p = game.puzzle || {};
    var extra = {n: game.n, link: shareLink()};
    if (typeof p.par === 'number') extra.par = p.par;
    if (p.level !== undefined) extra.level = p.level;
    if (p.seed !== undefined) extra.seed = p.seed;
    if (firstMoveAt !== null) extra.elapsedMs = Date.now() - firstMoveAt;
    var doc = game.exportSchedule(extra);
    var text = JSON.stringify(doc, null, 2)
      .replace(/\[\s+(-?\d+),\s+(-?\d+)\s+\]/g, '[$1, $2]') + '\n';
    var d = digits();
    var part = function (name, digit) { return slug(name === 'mnist' && isDigit(digit) ? 'mnist' + digit : name); };
    var name = p.mode === 'shapes'
      ? 'pivot-cubes-' + part(p.start, d[0]) + '-to-' + part(p.target, d[1]) +
        (p.seed !== undefined ? '-' + slug(p.seed) : '') + '-' + game.n + '.json'
      : 'pivot-cubes-' + slug(p.level || 'challenge') + '-' + slug(p.seed) + '-' + game.n + '.json';
    try {
      var url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      setStatus('Exported ' + plural(game.moveCount(), 'step') + ' to ' + name + '.', 'info');
    } catch (e) {
      setStatus('Export failed: ' + e.message, 'warn');
    }
  }

  function copyLink() {
    var link = shareLink();
    var done = function () { setStatus('Puzzle link copied.', 'info'); };
    var fallback = function () {
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = link;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (e) { ok = false; }
      if (ok) done();
      else window.prompt('Copy this puzzle link:', link);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, fallback);
      else fallback();
    } catch (e) {
      fallback();
    }
  }

  // --- theme -----------------------------------------------------------------------------------

  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    var v = function (name) { return cs.getPropertyValue(name).trim(); };
    return {
      board: v('--board'),
      grid: v('--grid'),
      ghostFill: v('--ghost-fill'),
      ghostStroke: v('--ghost-stroke'),
      danger: v('--danger'),
      ok: v('--ok'),
      accent: v('--accent'),
      text: v('--text'),
      shadow: v('--shadow'),
      cubeOn: v('--cube-on'),
      cubeOnLine: v('--cube-on-line'),
      cubeOff: v('--cube-off'),
      cubeOffLine: v('--cube-off-line'),
      textDim: v('--text-dim'),
      panel: v('--panel'),
      bg: v('--bg'),
    };
  }

  /** Put settings.theme (light / dark / auto) and settings.palette (the colour theme) on the page. */
  function applyTheme() {
    var root = document.documentElement, mode = settings.theme;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    root.setAttribute('data-palette', settings.palette);
    themeChanged();
  }

  function themeChanged() {
    theme = readTheme();
    if (board) board.setTheme(theme);
    drawThumbs();
  }

  function setTheme(mode) {
    settings.theme = mode;
    applyTheme();
    renderSettings();
    saveSettingsSoon();
  }

  function setPalette(id) {
    settings.palette = id;
    applyTheme();
    renderSettings();
    saveSettingsSoon();
  }

  // --- settings column -------------------------------------------------------------------------

  function radios(name) {
    return Array.prototype.slice.call(document.querySelectorAll('input[type="radio"][name="' + name + '"]'));
  }

  function setRadio(name, value) {
    radios(name).forEach(function (r) { r.checked = r.value === String(value); });
  }

  function onRadio(name, fn) {
    radios(name).forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) fn(r.value); });
    });
  }

  function setRangeFill(el) {
    var lo = +el.min, hi = +el.max;
    el.style.setProperty('--pct', (100 * (+el.value - lo) / (hi - lo)) + '%');
  }

  /** Push `settings` into every control. */
  function renderSettings() {
    var s = settings;
    $('settings').setAttribute('data-mode', s.mode);
    setRadio('mode', s.mode);
    var nr = $('nRange');
    nr.value = s.n;
    setRangeFill(nr);
    $('nOut').textContent = s.n;

    setRadio('level', s.level);
    var c = challengeOf(s.level);
    var blurb = String(c.blurb || '').replace(/\s*Always solvable\.?\s*$/i, '');
    $('levelBlurb').textContent = blurb;
    $('levelBlurb').hidden = !blurb;
    var solv = $('levelSolv');
    solv.textContent = c.solvable ? 'Always solvable' : 'Solvability not checked';
    solv.classList.toggle('yes', !!c.solvable);

    $('seedInput').value = s.seed;
    $('seedField').hidden = !usesSeed(s);
    $('startSel').value = s.start;
    $('targetSel').value = s.target;
    $('startDigit').hidden = s.start !== 'mnist';
    $('targetDigit').hidden = s.target !== 'mnist';
    $('startDigit').value = isDigit(s.startDigit) ? String(s.startDigit) : 'any';
    $('targetDigit').value = isDigit(s.targetDigit) ? String(s.targetDigit) : 'any';

    $('optGhost').checked = s.ghost;
    $('optGrid').checked = s.grid;
    $('optPreview').checked = s.destPreview;
    $('optAnim').checked = s.animations;
    setRadio('theme', s.theme);
    setRadio('palette', s.palette);
    $('paletteName').textContent = paletteOf(s.palette).label;
    updateShapesNote();
  }

  function updateShapesNote() {
    var note = $('shapesNote');
    var same = game && game.puzzle && game.puzzle.mode === 'shapes' &&
      Rules.normKey(game.start) === Rules.normKey(game.target);
    note.textContent = same
      ? 'Start and target are the same shape up to translation: pick a different target.'
      : 'Solvability not checked: some pairs may be impossible.';
    note.classList.toggle('warn', !!same);
  }

  function setDisplay(key, value) {
    settings[key] = value;
    board.setOptions(displayOptions());
    renderSettings();
    saveSettingsSoon();
  }

  function fillControls() {
    var nr = $('nRange');
    nr.min = N_MIN;
    nr.max = N_MAX;
    $('nMinLabel').textContent = N_MIN;
    $('nMaxLabel').textContent = N_MAX;

    // level labels come from CubeShapes.CHALLENGES (the HTML holds the same four as a fallback)
    var seg = $('levelSeg');
    seg.textContent = '';
    CHALLENGES.forEach(function (c) {
      var lab = document.createElement('label');
      var inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'level';
      inp.value = c.id;
      var span = document.createElement('span');
      span.textContent = c.label;
      lab.title = String(c.blurb || '');
      lab.appendChild(inp);
      lab.appendChild(span);
      seg.appendChild(lab);
    });

    // colour-theme swatches: each carries data-palette, so style.css paints it in its own colours
    var sw = $('paletteSeg');
    sw.textContent = '';
    PALETTES.forEach(function (p) {
      var lab = document.createElement('label');
      lab.className = 'swatch';
      lab.setAttribute('data-palette', p.id);
      lab.title = p.label;
      var inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'palette';
      inp.value = p.id;
      inp.setAttribute('aria-label', p.label);
      var chip = document.createElement('span');
      chip.className = 'chip';
      lab.appendChild(inp);
      lab.appendChild(chip);
      sw.appendChild(lab);
    });

    ['startSel', 'targetSel'].forEach(function (id) {
      var sel = $(id);
      NAMES.forEach(function (name) {
        var o = document.createElement('option');
        o.value = name;
        o.textContent = Shapes.NAMED[name].label;
        sel.appendChild(o);
      });
    });
    ['startDigit', 'targetDigit'].forEach(function (id) {
      var sel = $(id);
      var add = function (value, text) {
        var o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        sel.appendChild(o);
      };
      add('any', 'Any digit');
      for (var d = 0; d <= 9; d++) add(String(d), 'Digit ' + d);
    });
  }

  function bindSettings() {
    fillControls();

    onRadio('mode', function (v) { changePuzzle({mode: v}); });

    var nr = $('nRange');
    nr.addEventListener('input', function () {
      $('nOut').textContent = nr.value;
      setRangeFill(nr);
    });
    nr.addEventListener('change', function () {
      if (+nr.value !== settings.n) changePuzzle({n: +nr.value});
    });

    onRadio('level', function (v) { changePuzzle({level: v}); });

    var si = $('seedInput');
    si.addEventListener('change', function () {
      var seed = cleanSeed(si.value);
      if (!seed) { si.value = settings.seed; return; }
      if (seed !== settings.seed) changePuzzle({seed: seed});
    });
    si.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') si.blur();
      if (e.key === 'Escape') { si.value = settings.seed; si.blur(); }
    });
    $('diceBtn').addEventListener('click', function () { changePuzzle({seed: Shapes.randomSeed()}); });

    $('startSel').addEventListener('change', function () { changePuzzle({start: $('startSel').value}); });
    $('targetSel').addEventListener('change', function () { changePuzzle({target: $('targetSel').value}); });
    $('startDigit').addEventListener('change', function () { changePuzzle({startDigit: $('startDigit').value}); });
    $('targetDigit').addEventListener('change', function () { changePuzzle({targetDigit: $('targetDigit').value}); });

    // a focused <select> would take the arrow keys meant for keyboard rolling: let go after a pick
    ['startSel', 'targetSel', 'startDigit', 'targetDigit'].forEach(function (id) {
      $(id).addEventListener('change', function () { $(id).blur(); });
    });

    $('newBtn').addEventListener('click', function () { newPuzzle(false); });


    $('optGhost').addEventListener('change', function (e) { setDisplay('ghost', e.target.checked); });
    $('optGrid').addEventListener('change', function (e) { setDisplay('grid', e.target.checked); });
    $('optPreview').addEventListener('change', function (e) { setDisplay('destPreview', e.target.checked); });
    $('optAnim').addEventListener('change', function (e) { setDisplay('animations', e.target.checked); });
    onRadio('theme', function (v) { setTheme(v); });
    onRadio('palette', function (v) { setPalette(v); });

    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);
    $('resetBtn').addEventListener('click', reset);
    $('fitBtn').addEventListener('click', fitView);
    $('exportBtn').addEventListener('click', exportJson);
    $('linkBtn').addEventListener('click', copyLink);

    $('confirmYes').addEventListener('click', function () { resolveConfirm(true); });
    $('confirmNo').addEventListener('click', function () { resolveConfirm(false); });
    $('winNext').addEventListener('click', function () { newPuzzle(true); });
    $('winExport').addEventListener('click', exportJson);
    $('winKeep').addEventListener('click', function () { closeWin(); });
  }

  // --- keyboard --------------------------------------------------------------------------------

  function isTyping(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
    if (tag !== 'INPUT') return false;
    var type = (el.type || 'text').toLowerCase();
    return ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color'].indexOf(type) < 0;
  }

  function cycleTheme() {
    var i = THEMES.indexOf(settings.theme);
    var next = THEMES[(i + 1) % THEMES.length];
    setTheme(next);
    setStatus('Theme: ' + next.charAt(0).toUpperCase() + next.slice(1), 'info');
  }

  function onKey(e) {
    if (e.defaultPrevented || isTyping(e.target)) return;
    // no keyboard rolls under a card (input.js skips keys that are already handled)
    if ((confirmOpen() || winOpen()) && typeof Input.keyDir === 'function' && Input.keyDir(e)) {
      e.preventDefault();
      return;
    }
    var key = (e.key || '').toLowerCase();
    var mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      if (confirmOpen()) return;
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) { e.preventDefault(); redo(); }
      return;
    }
    if (mod || e.altKey) return;
    if (confirmOpen()) {
      if (key === 'escape') { e.preventDefault(); resolveConfirm(false); }
      return;
    }
    if (key === 'escape') {
      if (winOpen()) closeWin();
      else cancelDrag();
      return;
    }
    if (e.repeat) return;
    switch (key) {
      case 'r': reset(); break;
      case 'f': fitView(); break;
      case 'n': newPuzzle(winOpen()); break;
      case 'g':
        setDisplay('ghost', !settings.ghost);
        setStatus('Target ghost ' + (settings.ghost ? 'on' : 'off'), 'info');
        break;
      case 't': cycleTheme(); break;
      default: return;
    }
    e.preventDefault();
  }

  // --- debug hooks (headless screenshots) -------------------------------------------------------

  /** `#debug=preview`: hold the first legal quarter turn mid-pivot.  `#debug=blocked`: hold a refused roll. */
  function runDebug(which) {
    if (which === 'preview') {
      var moves = game.legalMoves();
      if (!moves.length) return;
      // prefer a quarter turn: half of a 180-degree roll is axis-aligned and looks like a still cube
      var m = moves.filter(function (mv) { return Math.abs(mv.turns) === 1; })[0] || moves[0];
      board.preview(game.idAt(m.src[0], m.src[1]), m, 0.5);
    } else if (which === 'blocked') {
      // the first refused roll, preferring the reasons that draw the most (blockers, dependents)
      var rank = {blocked: 0, cut: 1, detached: 2, nohinge: 3};
      var best = null;
      for (var id = 0; id < game.n; id++) {
        for (var d = 0; d < Rules.DIR_NAMES.length; d++) {
          var dir = Rules.DIR_NAMES[d];
          var r = game.roll(id, dir);
          if (!r.ok && (!best || rank[r.reason] < rank[best.r.reason])) best = {id: id, dir: dir, r: r};
        }
      }
      if (!best) return;
      holdStatus = true;
      board.showBlocked(best.id, best.r, best.dir);
      setStatus(blockMessage(best.r, best.dir), 'warn', true);
    }
  }

  // --- startup ---------------------------------------------------------------------------------

  /** A saved game is only trusted if both shapes are N distinct, connected cells in range. */
  function soundShapes(g) {
    if (!(g.n >= N_MIN && g.n <= N_MAX) || g.target.length !== g.n) return false;
    var so = Rules.occOf(g.start), to = Rules.occOf(g.target);
    return so.size === g.n && to.size === g.n && Rules.isConnected(so) && Rules.isConnected(to);
  }

  function restoreSession(wantKey) {
    var s = storeGet(SESSION_KEY);
    if (!s || s.v !== 1 || typeof s.key !== 'string' || s.key.indexOf(KEY_VERSION + '|') !== 0) return null;
    if (wantKey && s.key !== wantKey) return null;
    try {
      var g = Game.restore(s.game);
      if (!soundShapes(g)) return null;
      return {game: g, firstMoveAt: typeof s.firstMoveAt === 'number' ? s.firstMoveAt : null};
    } catch (e) {
      return null;
    }
  }

  /** The settings that describe a saved game's puzzle. */
  function settingsOfGame(g) {
    var p = g.puzzle || {};
    var out = {};
    ['mode', 'n', 'level', 'seed', 'start', 'target'].forEach(function (k) {
      if (p[k] !== undefined) out[k] = p[k];
    });
    if (p.mode === 'shapes') {
      out.startDigit = isDigit(p.startDigit) ? p.startDigit : 'any';
      out.targetDigit = isDigit(p.targetDigit) ? p.targetDigit : 'any';
    }
    return out;
  }

  /** Apply a hash the user typed or pasted (not one this page wrote). */
  function onHashChange() {
    if (location.hash === lastHash) return;
    var hash = parseHash();
    if (hash.theme && oneOf(hash.theme, THEMES)) setTheme(hash.theme);
    if (hash.palette && oneOf(hash.palette, PALETTE_IDS)) setPalette(hash.palette);
    var next = merge(settings, hashSettings(hash));
    if (puzzleKey(next) !== gameKey) changePuzzle(hashSettings(hash), {onCancel: syncHash});
    else syncHash();
  }

  function init() {
    var hash = parseHash();
    var stored = storeGet(SETTINGS_KEY);
    settings = merge(merge(DEFAULTS, stored, !!stored && stored.levelIds !== LEVEL_IDS), hashSettings(hash));
    var fromHash = hasPuzzleParams(hash);

    applyTheme();

    var canvas = $('board');
    board = new Render.Board(canvas);
    board.onChange = onBoardChange;
    board.setTheme(theme);
    board.setOptions(displayOptions());
    thumbStart = new Render.Thumb($('thumbStart'));
    thumbTarget = new Render.Thumb($('thumbTarget'));
    input = Input.attach(canvas, board, {
      commit: onCommit,
      onBlocked: onBlocked,
      onUnblocked: onUnblocked,
      onHover: onHover,
    });

    // While the pointer is over the board, W/A/S/D and the arrows belong to the game: swallow the
    // ones input.js didn't use, so they never reach a focused radio or slider (or scroll the page).
    // Registered after attach(), so this window listener runs after input.js's.
    var overBoard = false;
    canvas.addEventListener('pointerenter', function () { overBoard = true; });
    canvas.addEventListener('pointerleave', function () { overBoard = false; });
    window.addEventListener('keydown', function (e) {
      if (overBoard && !e.defaultPrevented && !isTyping(e.target) &&
          typeof Input.keyDir === 'function' && Input.keyDir(e)) e.preventDefault();
    });

    bindSettings();
    $('legendKeys').hidden = !Input.KEY_DIRS;   // keyboard rolling, when input.js offers it

    var restored = restoreSession(fromHash ? puzzleKey(settings) : null);
    if (restored) {
      settings = merge(settings, settingsOfGame(restored.game));
      startPuzzle(restored.game, {firstMoveAt: restored.firstMoveAt});
      if (game.moveCount() > 0 && !game.stuck()) {
        setStatus('Welcome back: ' + plural(game.moveCount(), 'step') + ' restored.', 'info');
      }
    } else {
      var g;
      try {
        g = buildGame(settings);
      } catch (e) {
        // a stored or linked puzzle that can't be built: fall back to the default challenge
        showError('Could not build the requested puzzle (' + (e && e.message ? e.message : e) + '); showing an Easy challenge instead.');
        settings = merge(settings, {mode: 'challenge', level: LEVELS[0]});
        g = buildGame(settings);
      }
      startPuzzle(g);
    }

    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('pagehide', flushSaves);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushSaves();
    });
    listen(mqDark, function () { if (settings.theme === 'auto') themeChanged(); });

    if (hash.debug === 'preview' || hash.debug === 'blocked') runDebug(hash.debug);

    // enable CSS transitions only after the first paint, so controls don't animate into place
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () { raf(function () { document.documentElement.classList.add('ready'); }); });

    window.CubeApp = {
      get game() { return game; },
      get settings() { return settings; },
      board: board,
      input: input,
      newPuzzle: newPuzzle,
      exportSchedule: function () { return game.exportSchedule({}); },
      /** Debugging: play any start/target pair (cell lists), e.g. to try a particular position. */
      debugPuzzle: function (start, target) {
        startPuzzle(new Game({start: start, target: target || start, puzzle: {mode: 'custom', n: start.length}}));
      },
    };
  }

  try {
    init();
  } catch (e) {
    showError('Startup failed: ' + (e && e.message ? e.message : e));
    if (window.console) console.error(e);
  }
})();
