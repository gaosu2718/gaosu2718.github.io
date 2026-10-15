/* Board renderer and side-panel thumbnails for the pivot-cube game.
 *
 * World coordinates: cell (x, y) covers [x, x+1] x [y, y+1], y points UP.  The board draws in
 * world units through a y-flipped canvas transform, so a positive rotation is counter-clockwise
 * on screen, matching `move.turns > 0`.  Cube highlights are world-aligned (lit from above), so a
 * cube that ends a pivot at 90 or 180 degrees looks exactly like the static drawing.
 *
 * Cubes carry no identity colour: a cube on a target cell (at the current best alignment) wears
 * the colour theme's main colour, any other cube its contrast colour.
 *
 * Exposes window.CubeRender = {cubeColor, Board, Thumb, DEFAULT_THEME}.  Redraws only on demand: every
 * mutator marks the board dirty and one requestAnimationFrame paints it; the loop keeps running
 * only while something animates.  setGame/setTheme/setOptions/resize/render paint synchronously
 * (headless screenshots are taken at load, before any animation frame is guaranteed).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeRender = api;
})(this, function (root) {
  'use strict';

  // Fallback theme (the light Indigo colour theme); the app passes the live one from style.css.
  var DEFAULT_THEME = {
    board: '#f7f6f2', grid: 'rgba(48,52,72,0.22)', ghostFill: 'rgba(80,88,130,0.07)',
    ghostStroke: 'rgba(80,88,130,0.5)', danger: '#e5484d', ok: '#2f9e68', accent: '#5b67e0',
    text: '#2a2b33', shadow: 'rgba(28,30,50,0.17)',
    cubeOn: '#7d92e8', cubeOnLine: '#4c5da5', cubeOff: '#f8bf6c', cubeOffLine: '#b38236',
  };

  /** Fill and stroke of a cube in theme `th`: the main colour on a target cell, else the contrast one. */
  function cubeColor(th, placed) {
    return placed ? {fill: th.cubeOn, stroke: th.cubeOnLine} : {fill: th.cubeOff, stroke: th.cubeOffLine};
  }

  // Cube geometry (cell units).
  var HALF = 0.44;             // inset 0.06
  var RAD = 0.17;              // corner radius
  var S_MIN = 10, FIT_MAX = 88;
  var FIT_PAD = 1.6;           // cells of room around the framed cubes
  var VIEW_MARGIN = 0.5;       // a cube closer than this to the edge brings the view after it
  // Dashes in world units, sized so each side+corner of the rounded square holds exactly four
  // periods and a dash sits centred on every corner: the outline looks the same on every cell.
  var PERIM_UNIT = 2 * (HALF - RAD) + Math.PI * RAD / 2;
  var DASH_P = PERIM_UNIT / 4, DASH = [DASH_P * 0.58, DASH_P * 0.42];
  var DASH_OFF = DASH[0] / 2 - Math.PI * RAD / 4;
  var QX = [1, 1, -1, -1], QY = [-1, 1, 1, -1];
  var DIRV = {L: [-1, 0], R: [1, 0], U: [0, 1], D: [0, -1]};

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOut(u) { u = 1 - u; return 1 - u * u * u; }
  function easeInOut(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function now() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function assign(dst, src) { if (src) Object.keys(src).forEach(function (k) { if (src[k] != null) dst[k] = src[k]; }); return dst; }
  function raf(cb) { return root.requestAnimationFrame ? root.requestAnimationFrame(cb) : setTimeout(function () { cb(now()); }, 16); }
  function caf(h) { if (root.cancelAnimationFrame) root.cancelAnimationFrame(h); else clearTimeout(h); }
  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function dirVec(dir) {
    if (Array.isArray(dir)) return dir;
    return DIRV[dir] || [0, 0];
  }
  function noShadow(ctx) {
    ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  }
  function setShadow(ctx, color, blur, dy) {
    ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = dy;
  }

  /** Adds a rounded-square subpath centred at (x, y), rotated by `a`, scaled by `k`. */
  function roundSq(ctx, x, y, a, k) {
    // The shape is symmetric under quarter turns: draw those unrotated so an ended pivot is
    // pixel-identical to a resting cube.
    var q = a / (Math.PI / 2);
    if (Math.abs(q - Math.round(q)) < 1e-9) a = 0;
    var h = (HALF - RAD) * k, r = RAD * k, c = Math.cos(a), s = Math.sin(a);
    for (var i = 0; i < 4; i++) {
      var ox = QX[i] * h, oy = QY[i] * h;
      var cx = x + c * ox - s * oy, cy = y + s * ox + c * oy;
      var a0 = -Math.PI / 2 + i * Math.PI / 2 + a;
      if (i === 0) ctx.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
      ctx.arc(cx, cy, r, a0, a0 + Math.PI / 2, false);
    }
    ctx.closePath();
  }

  /** Pose of a cube along `move` at progress p: centre rotated about move.corner. */
  var QUARTER = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  function poseAt(move, p) {
    var qt = p * move.turns, a = qt * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    if (Math.abs(qt - Math.round(qt)) < 1e-9) {        // exact at whole quarter turns
      var e = QUARTER[((Math.round(qt) % 4) + 4) % 4];
      c = e[0]; s = e[1];
    }
    var rx = move.src[0] + 0.5 - move.corner[0], ry = move.src[1] + 0.5 - move.corner[1];
    return {x: move.corner[0] + c * rx - s * ry, y: move.corner[1] + s * rx + c * ry, a: a, lift: Math.sin(Math.PI * clamp(p, 0, 1))};
  }

  /** Fill, world-aligned top highlight and stroke of one cube (path must be built by the caller). */
  function paintBody(ctx, x, y, k, col, px, hover) {
    ctx.fillStyle = col.fill;
    ctx.fill();
    var g = ctx.createLinearGradient(0, y + 0.62 * k, 0, y - 0.62 * k);
    g.addColorStop(0, 'rgba(255,255,255,0.34)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fill();
    if (hover) { ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill(); }
    ctx.lineWidth = 1.25 * px;
    ctx.strokeStyle = col.stroke;
    ctx.stroke();
  }

  /** True for a dark colour; parsed through the canvas's own CSS colour parser. */
  function isDarkColor(ctx, css) {
    try {
      ctx.fillStyle = '#ffffff';
      ctx.fillStyle = css;
      var v = String(ctx.fillStyle), rgb = null, m;
      if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(v))) rgb = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
      else if ((m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(v))) rgb = [+m[1], +m[2], +m[3]];
      if (!rgb) return false;
      return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.42;
    } catch (e) { return false; }
  }

  function watchDpr(cb) {
    var mq = null, handler = null, stopped = false;
    function arm() {
      if (stopped || !root.matchMedia) return;
      try {
        mq = root.matchMedia('(resolution: ' + (root.devicePixelRatio || 1) + 'dppx)');
        handler = function () { if (mq) mq.removeEventListener('change', handler); cb(); arm(); };
        mq.addEventListener('change', handler);
      } catch (e) { mq = null; }
    }
    arm();
    return function () { stopped = true; if (mq && handler) mq.removeEventListener('change', handler); };
  }

  // ===========================================================================================
  // Board
  // ===========================================================================================

  function Board(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = assign({}, DEFAULT_THEME);
    this._dark = false;
    this.options = {ghost: true, grid: true, destPreview: true, animations: true};
    this.camera = {cx: 0, cy: 0, s: 48};
    this.game = null;
    this.alignment = null;
    this.onChange = null;
    this.W = 0; this.H = 0; this.dpr = 1;
    this._prev = null;        // {id, move, p}
    this._anims = [];         // {id, move, from, to, t0, dur, onDone}
    this._blk = null;         // {id, fail, dir, t0, rel, soft:[ids], anchors:[ids], wobble}
    this._hover = null;
    this._keyTarget = null;   // cube id driven by the keyboard (ring), or null
    this._pulse = null;       // {t0, delay: {id: ms}, end}
    this._confetti = [];
    this._confT = 0;
    this._camAnim = null;     // {from, to, t0, dur}
    this._raf = 0;
    this._dirty = false;
    var self = this;
    this._onResize = function () { self.resize(); };
    if (typeof root.ResizeObserver === 'function') {
      this._ro = new root.ResizeObserver(this._onResize);
      this._ro.observe(canvas);
    }
    if (root.addEventListener) root.addEventListener('resize', this._onResize);
    this._unDpr = watchDpr(this._onResize);
    this.resize();
  }

  Board.prototype.destroy = function () {
    if (this._ro) this._ro.disconnect();
    if (root.removeEventListener) root.removeEventListener('resize', this._onResize);
    if (this._unDpr) this._unDpr();
    if (this._raf) caf(this._raf);
    this._raf = 0;
  };

  // --- configuration ----------------------------------------------------------------------

  Board.prototype.setTheme = function (c) {
    assign(this.theme, c);
    this._dark = isDarkColor(this.ctx, this.theme.board);
    this.render();
  };

  Board.prototype.setOptions = function (o) {
    assign(this.options, o);
    if (!this.options.animations) {
      this.snapAnimations();
      this._confetti = [];
      this._pulse = null;
      if (this._camAnim) { assign(this.camera, this._camAnim.to); this._camAnim = null; }
      if (this._blk) { this._blk.wobble = false; if (this._blk.rel != null) this._blk = null; }
    }
    this._keepInView();   // the ghost may just have been switched on
    this.render();
  };

  Board.prototype.setGame = function (game, opts) {
    this.game = game;
    this._prev = null;
    this._anims = [];
    this._blk = null;
    this._hover = null;
    this._keyTarget = null;
    this._pulse = null;
    this._confetti = [];
    this._camAnim = null;
    this.alignment = null;
    if (game) this._align();
    if (!opts || opts.fit !== false) this.fit(false);
    this._emit();
    this.render();
  };

  Board.prototype._align = function () {
    var Shapes = root.CubeShapes;
    var prev = this.alignment ? this.alignment.t : null;
    this.alignment = Shapes.bestAlignment(this.game.cells(), this.game.target, prev);
  };

  Board.prototype._emit = function () {
    if (typeof this.onChange === 'function' && this.game && this.alignment) {
      this.onChange({matched: this.alignment.matched, n: this.game.n, t: this.alignment.t.slice()});
    }
  };

  /** Call after any game state change (commit / undo / redo / reset). */
  Board.prototype.refresh = function () {
    if (!this.game) return;
    this._align();
    this._emit();
    this._keepInView();
    this._invalidate();
  };

  // --- camera ------------------------------------------------------------------------------

  Board.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var W = r.width, H = r.height, dpr = root.devicePixelRatio || 1;
    if (W > 0 && H > 0) {
      var bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
      if (this.canvas.width !== bw) this.canvas.width = bw;
      if (this.canvas.height !== bh) this.canvas.height = bh;
      this.W = W; this.H = H; this.dpr = dpr;
      if (this.game && !this._camAnim) this.fit(false);
    }
    this.render();
  };

  Board.prototype.toScreen = function (x, y) {
    var c = this.camera;
    return [this.W / 2 + (x - c.cx) * c.s, this.H / 2 - (y - c.cy) * c.s];
  };

  Board.prototype.toWorld = function (px, py) {
    var c = this.camera;
    return [c.cx + (px - this.W / 2) / c.s, c.cy - (py - this.H / 2) / c.s];
  };

  // The player has no pan or zoom: the view frames the swarm (fit) and follows it when it nears an
  // edge (_keepInView, after every change).

  /** World box [x0, y0, x1, y1] of the cubes and, when shown, the target ghost. */
  Board.prototype._extent = function () {
    var cells = this.game.cells();
    if (this.options.ghost && this.alignment) {
      var t = this.alignment.t;
      this.game.target.forEach(function (c) { cells.push([c[0] + t[0], c[1] + t[1]]); });
    }
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    cells.forEach(function (c) {
      x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0] + 1); y1 = Math.max(y1, c[1] + 1);
    });
    return [x0, y0, x1, y1];
  };

  /** Frame the current cubes and the target ghost. */
  Board.prototype.fit = function (animate) {
    if (!this.game) return;
    var b = this._extent(), x0 = b[0], y0 = b[1], x1 = b[2], y1 = b[3], pad = FIT_PAD;
    var to = {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: this.camera.s};
    if (this.W > 0 && this.H > 0) {
      to.s = clamp(Math.min(this.W / (x1 - x0 + 2 * pad), this.H / (y1 - y0 + 2 * pad)), S_MIN, FIT_MAX);
    }
    if (animate && this.options.animations) {
      this._camAnim = {from: {cx: this.camera.cx, cy: this.camera.cy, s: this.camera.s}, to: to, t0: now(), dur: 340};
    } else {
      this._camAnim = null;
      assign(this.camera, to);
    }
    this._invalidate();
  };

  /** Frame everything again (animated) if a cube or the ghost is within VIEW_MARGIN of an edge. */
  Board.prototype._keepInView = function () {
    if (!this.game || !(this.W > 0 && this.H > 0)) return;
    var b = this._extent(), c = this._camAnim ? this._camAnim.to : this.camera;
    var hw = this.W / (2 * c.s) - VIEW_MARGIN, hh = this.H / (2 * c.s) - VIEW_MARGIN;
    if (b[0] < c.cx - hw || b[2] > c.cx + hw || b[1] < c.cy - hh || b[3] > c.cy + hh) this.fit(true);
  };

  Board.prototype.cellAt = function (px, py) {
    var w = this.toWorld(px, py);
    return [Math.floor(w[0]), Math.floor(w[1])];
  };

  Board.prototype.cubeAt = function (px, py) {
    if (!this.game) return null;
    var c = this.cellAt(px, py);
    return this.game.idAt(c[0], c[1]);
  };

  // --- transient effects -------------------------------------------------------------------

  /** Draw cube `id` mid-pivot at progress p in [0,1]; preview(null) clears. */
  Board.prototype.preview = function (id, move, p) {
    if (id === null || id === undefined || !move) {
      if (this._prev) { this._prev = null; this._invalidate(); }
      return;
    }
    this._finish(id);
    if (this._blk && this._blk.id === id) this._blk.wobble = false;
    this._prev = {id: id, move: move, p: clamp(+p || 0, 0, 1)};
    this._invalidate();
  };

  /** Animate cube `id` along `move` from progress fromP to toP (ease-out). */
  Board.prototype.animateMove = function (id, move, fromP, toP, onDone) {
    this._finish(id);
    if (this._prev && this._prev.id === id) this._prev = null;
    var span = Math.abs(toP - fromP);
    if (!this.options.animations || span < 1e-6) {
      this._invalidate();
      if (onDone) onDone();
      return;
    }
    var dur = (40 + 200 * span) * (Math.abs(move.turns) === 2 ? 1.6 : 1);
    this._anims.push({id: id, move: move, from: fromP, to: toP, t0: now(), dur: dur, onDone: onDone || null});
    this._invalidate();
  };

  Board.prototype.isAnimating = function (id) {
    for (var i = 0; i < this._anims.length; i++) if (id === undefined || this._anims[i].id === id) return true;
    return false;
  };

  /** Finish running animations of cube `id` (all cubes if id is undefined). */
  Board.prototype._finish = function (id) {
    var done = [], keep = [];
    this._anims.forEach(function (a) { (id === undefined || a.id === id ? done : keep).push(a); });
    if (!done.length) return;
    this._anims = keep;
    this._invalidate();
    done.forEach(function (a) { if (a.onDone) a.onDone(); });
  };

  Board.prototype.snapAnimations = function () {
    if (this._camAnim) { assign(this.camera, this._camAnim.to); this._camAnim = null; this._invalidate(); }
    this._finish();
  };

  /** Red aura on the mover (strong) and on fail.blockers / fail.dependents (soft); short wobble. */
  Board.prototype.showBlocked = function (id, fail, dir) {
    var g = this.game;
    if (!g || id === null || id === undefined) return;
    fail = fail || {};
    var ids = function (cells) {
      var out = [];
      (cells || []).forEach(function (c) { var j = g.idAt(c[0], c[1]); if (j !== null && j !== id && out.indexOf(j) < 0) out.push(j); });
      return out;
    };
    this._blk = {
      id: id, fail: fail, dir: dir, t0: now(), rel: null,
      soft: ids((fail.blockers || []).concat(fail.dependents || [])),
      anchors: ids(fail.anchors),
      wobble: this.options.animations && !reducedMotion(),
    };
    this._invalidate();
  };

  /** Let the aura fade out (~600 ms). */
  Board.prototype.releaseBlocked = function () {
    if (!this._blk || this._blk.rel != null) return;
    if (!this.options.animations) this._blk = null;
    else this._blk.rel = now();
    this._invalidate();
  };

  /** Mark cube `id` as the keyboard target (accent ring), or clear with null. */
  Board.prototype.setKeyTarget = function (id) {
    if (id === undefined) id = null;
    if (id === this._keyTarget) return;
    this._keyTarget = id;
    this._invalidate();
  };

  Board.prototype.setHover = function (id) {
    if (id === undefined) id = null;
    if (id === this._hover) return;
    this._hover = id;
    this._invalidate();
  };

  /** Confetti in the colour theme plus a staggered pulse over the cubes. */
  Board.prototype.celebrate = function () {
    var g = this.game, th = this.theme, colors = [th.cubeOn, th.cubeOff, th.accent];
    if (!g || !this.options.animations || reducedMotion()) return;
    var t = now(), order = [];
    for (var id = 0; id < g.n; id++) order.push(id);
    order.sort(function (a, b) { return (g.pos[a][0] - g.pos[a][1]) - (g.pos[b][0] - g.pos[b][1]) || a - b; });
    var delay = {};
    order.forEach(function (id, i) { delay[id] = i * 45; });
    this._pulse = {t0: t, delay: delay, end: t + order.length * 45 + 420};
    for (var i = 0; i < 130; i++) {
      var cid = i % g.n, c = g.pos[cid], sp = this.toScreen(c[0] + 0.5, c[1] + 0.5);
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.0, v = 240 + Math.random() * 460;
      this._confetti.push({
        x: sp[0] + (Math.random() - 0.5) * 10, y: sp[1] + (Math.random() - 0.5) * 10,
        vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
        rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 10,
        flip: Math.random() * 6.283, vf: 5 + Math.random() * 9,
        w: 5 + Math.random() * 5, h: 3 + Math.random() * 3,
        col: colors[i % colors.length], t0: t, life: 1700 + Math.random() * 900,
      });
    }
    this._confT = t;
    this._invalidate();
  };

  // --- frame loop --------------------------------------------------------------------------

  Board.prototype._invalidate = function () {
    this._dirty = true;
    if (this._raf) return;
    var self = this;
    this._raf = raf(function () { self._raf = 0; self._frame(); });
  };

  /** Paint now (synchronously); keeps the animation loop going if anything is moving. */
  Board.prototype.render = function () { this._frame(); };

  Board.prototype._frame = function () {
    var t = now();
    var done = this._tick(t);
    this._dirty = false;
    this._paint(t);
    if (this._busy(t)) this._invalidate();
    done.forEach(function (a) { if (a.onDone) a.onDone(); });
  };

  Board.prototype._busy = function (t) {
    return this._anims.length > 0 || !!this._camAnim || this._confetti.length > 0 ||
      !!(this._pulse && t < this._pulse.end) ||
      !!(this._blk && (this._blk.rel != null || (this._blk.wobble && t - this._blk.t0 < 350)));
  };

  Board.prototype._tick = function (t) {
    if (this._camAnim) {
      var ca = this._camAnim, u = clamp((t - ca.t0) / ca.dur, 0, 1), e = easeInOut(u);
      this.camera.cx = ca.from.cx + (ca.to.cx - ca.from.cx) * e;
      this.camera.cy = ca.from.cy + (ca.to.cy - ca.from.cy) * e;
      this.camera.s = ca.from.s * Math.pow(ca.to.s / ca.from.s, e);
      if (u >= 1) this._camAnim = null;
    }
    var done = [], keep = [];
    this._anims.forEach(function (a) { (t >= a.t0 + a.dur ? done : keep).push(a); });
    this._anims = keep;
    if (this._blk && this._blk.rel != null && t - this._blk.rel >= 600) this._blk = null;
    if (this._pulse && t >= this._pulse.end) this._pulse = null;
    if (this._confetti.length) {
      var dt = clamp((t - this._confT) / 1000, 0, 0.05), drag = Math.exp(-1.7 * dt);
      this._confT = t;
      this._confetti = this._confetti.filter(function (q) {
        q.vy += 1100 * dt; q.vx *= drag; q.vy *= drag;
        q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt; q.flip += q.vf * dt;
        return t - q.t0 < q.life;
      });
    }
    return done;
  };

  Board.prototype._auraLevel = function (t) {
    var b = this._blk;
    if (!b) return 0;
    if (b.rel == null) return 1;
    var u = clamp((t - b.rel) / 600, 0, 1);
    return (1 - u) * (1 - u);
  };

  Board.prototype._wobblePose = function (t) {
    var b = this._blk;
    if (!b || !b.wobble || !this.game) return null;
    var u = (t - b.t0) / 350;
    if (u < 0 || u >= 1) return null;
    var c = this.game.pos[b.id], x = c[0] + 0.5, y = c[1] + 0.5, env = Math.exp(-3 * u);
    var f = b.fail || {};
    if (f.reason === 'cut') return {x: x + 0.05 * env * Math.sin(6 * Math.PI * u), y: y, a: 0, lift: 0};
    if (f.hinge && f.reason !== 'nohinge') {
      var ang = f.hinge.sense * (12 * Math.PI / 180) * env * Math.sin(3 * Math.PI * u);
      var hx = f.hinge.corner[0], hy = f.hinge.corner[1], cs = Math.cos(ang), sn = Math.sin(ang);
      return {x: hx + cs * (x - hx) - sn * (y - hy), y: hy + sn * (x - hx) + cs * (y - hy), a: ang, lift: 0};
    }
    var v = dirVec(b.dir), m = 0.09 * env * Math.sin(3 * Math.PI * u);
    return {x: x + v[0] * m, y: y + v[1] * m, a: 0, lift: 0};
  };

  Board.prototype._pulseK = function (id, t) {
    var p = this._pulse;
    if (!p) return 1;
    var u = (t - p.t0 - (p.delay[id] || 0)) / 380;
    return u <= 0 || u >= 1 ? 1 : 1 + 0.11 * Math.sin(Math.PI * u);
  };

  // --- painting ----------------------------------------------------------------------------

  Board.prototype._paint = function (t) {
    var ctx = this.ctx, d = this.dpr, W = this.W, H = this.H, cam = this.camera;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    noShadow(ctx);
    ctx.fillStyle = this.theme.board;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!W || !H) return;
    if (this.options.grid) this._paintGrid();
    if (this.game) {
      ctx.save();
      ctx.setTransform(d * cam.s, 0, 0, -d * cam.s, d * (W / 2 - cam.cx * cam.s), d * (H / 2 + cam.cy * cam.s));
      this._paintWorld(t);
      ctx.restore();
    }
    if (this._confetti.length) this._paintConfetti(t);
  };

  /** Thin cell lines, snapped to device pixels so they stay crisp; they fade out when zoomed far out. */
  Board.prototype._paintGrid = function () {
    var ctx = this.ctx, cam = this.camera, s = cam.s, W = this.W, H = this.H, d = this.dpr;
    var alpha = clamp((s - 10) / 12, 0, 1);
    if (alpha <= 0) return;
    var w0 = this.toWorld(0, H), w1 = this.toWorld(W, 0);
    var x0 = Math.floor(w0[0]), x1 = Math.ceil(w1[0]), y0 = Math.floor(w0[1]), y1 = Math.ceil(w1[1]);
    var BW = this.canvas.width, BH = this.canvas.height;
    var lw = Math.max(1, Math.round(d)), off = lw % 2 ? 0.5 : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (var x = x0; x <= x1; x++) {
      var sx = Math.round((W / 2 + (x - cam.cx) * s) * d) + off;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, BH);
    }
    for (var y = y0; y <= y1; y++) {
      var sy = Math.round((H / 2 - (y - cam.cy) * s) * d) + off;
      ctx.moveTo(0, sy); ctx.lineTo(BW, sy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  function dashedCell(ctx, x, y, fill, fillAlpha, stroke, strokeAlpha, px) {
    ctx.beginPath();
    roundSq(ctx, x, y, 0, 1);
    if (fill) { ctx.globalAlpha = fillAlpha; ctx.fillStyle = fill; ctx.fill(); }
    ctx.globalAlpha = strokeAlpha;
    ctx.setLineDash(DASH);
    ctx.lineDashOffset = DASH_OFF;
    ctx.lineWidth = 1.3 * px;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  Board.prototype._paintWorld = function (t) {
    var ctx = this.ctx, th = this.theme, o = this.options, g = this.game;
    var s = this.camera.s, d = this.dpr, px = 1 / s;
    var blk = this._blk, aura = this._auraLevel(t), pv = this._prev, self = this;

    // 1. target ghost
    if (o.ghost && this.alignment) {
      var tt = this.alignment.t;
      ctx.beginPath();
      g.target.forEach(function (c) { roundSq(ctx, c[0] + tt[0] + 0.5, c[1] + tt[1] + 0.5, 0, 1); });
      ctx.fillStyle = th.ghostFill;
      ctx.fill();
      ctx.setLineDash(DASH);
      ctx.lineDashOffset = DASH_OFF;
      ctx.lineWidth = 1.3 * px;
      ctx.strokeStyle = th.ghostStroke;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // cubes on a target cell at the current alignment take the main colour, the others the contrast one
    var placed = new Set();
    if (this.alignment) {
      var ta = this.alignment.t;
      g.target.forEach(function (c) { placed.add((c[0] + ta[0]) + ',' + (c[1] + ta[1])); });
    }
    function colorAt(cell) { return cubeColor(th, placed.has(cell[0] + ',' + cell[1])); }

    // 2. destination ghost of the live preview (coloured as the cube would be there); red ghost of a detached landing
    if (pv && o.destPreview) {
      var pc = colorAt(pv.move.dst), dk = this._dark;
      dashedCell(ctx, pv.move.dst[0] + 0.5, pv.move.dst[1] + 0.5, pc.fill, (dk ? 0.06 : 0.18) + (dk ? 0.12 : 0.28) * pv.p,
        dk ? pc.fill : pc.stroke, 0.6 + 0.4 * pv.p, px);
    }
    if (blk && aura > 0 && blk.fail.ghost) {
      dashedCell(ctx, blk.fail.ghost[0] + 0.5, blk.fail.ghost[1] + 0.5, th.danger, 0.12 * aura, th.danger, 0.85 * aura, px);
    }

    // poses of cubes that are not at rest; `cell` is the pivot end the cube is nearer to, which
    // decides its colour (so the colour flips once, mid-swing, and matches both ends)
    var moving = {}, movingIds = [];
    this._anims.forEach(function (a) {
      var u = clamp((t - a.t0) / a.dur, 0, 1), p = a.from + (a.to - a.from) * easeOut(u);
      if (!moving[a.id]) movingIds.push(a.id);
      moving[a.id] = poseAt(a.move, p);
      moving[a.id].cell = p >= 0.5 ? a.move.dst : a.move.src;
    });
    if (pv) {
      if (!moving[pv.id]) movingIds.push(pv.id);
      moving[pv.id] = poseAt(pv.move, pv.p);
      moving[pv.id].cell = pv.p >= 0.5 ? pv.move.dst : pv.move.src;
    }
    var wob = this._wobblePose(t);
    if (wob && !moving[blk.id]) { wob.cell = g.pos[blk.id]; moving[blk.id] = wob; movingIds.push(blk.id); }

    var keyT = this._keyTarget;

    var auraOf = {};
    if (blk && aura > 0) {
      auraOf[blk.id] = aura;
      blk.soft.forEach(function (j) { auraOf[j] = 0.55 * aura; });
    }

    var stat = [];
    for (var id = 0; id < g.n; id++) if (!moving[id]) stat.push(id);

    // 3. static cubes: one shadow pass under everything, red glows, then bodies on top
    ctx.save();
    setShadow(ctx, th.shadow, 0.17 * s * d, 0.055 * s * d);
    ctx.beginPath();
    stat.forEach(function (j) { var c = g.pos[j]; roundSq(ctx, c[0] + 0.5, c[1] + 0.5, 0, self._pulseK(j, t)); });
    ctx.fillStyle = th.board;
    ctx.fill();
    ctx.restore();

    stat.forEach(function (j) {
      if (!auraOf[j]) return;
      var c = g.pos[j];
      self._glow(c[0] + 0.5, c[1] + 0.5, 0, self._pulseK(j, t), auraOf[j]);
    });

    stat.forEach(function (j) {
      var c = g.pos[j], k = self._pulseK(j, t);
      ctx.beginPath();
      roundSq(ctx, c[0] + 0.5, c[1] + 0.5, 0, k);
      paintBody(ctx, c[0] + 0.5, c[1] + 0.5, k, colorAt(c), px, j === self._hover);
      if (auraOf[j]) self._auraStroke(auraOf[j]);
    });
    // the ring yields to a red aura on the same cube (cross-fades back as the aura fades)
    var ringA = keyT !== null && auraOf[keyT] ? 1 - auraOf[keyT] : 1;
    if (keyT !== null && keyT < g.n && !moving[keyT] && ringA > 0.01) {
      this._ring(g.pos[keyT][0] + 0.5, g.pos[keyT][1] + 0.5, 0, this._pulseK(keyT, t), ringA);
    }

    // 4. soft outline on the hinge cubes of a blocked roll
    if (blk && aura > 0 && blk.anchors.length) {
      ctx.globalAlpha = 0.3 * aura;
      ctx.strokeStyle = th.text;
      ctx.lineWidth = 1.25 * px;
      ctx.beginPath();
      blk.anchors.forEach(function (j) { var c = g.pos[j]; roundSq(ctx, c[0] + 0.5, c[1] + 0.5, 0, 1.085); });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 5. hinge pin of the live preview
    if (pv && o.destPreview) {
      var hc = pv.move.corner, rr = 3.4 * px;
      ctx.beginPath();
      ctx.arc(hc[0], hc[1], rr + 1.6 * px, 0, 2 * Math.PI);
      ctx.fillStyle = th.board;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hc[0], hc[1], rr, 0, 2 * Math.PI);
      ctx.fillStyle = th.text;
      ctx.globalAlpha = 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 6. cubes in motion, lifted, on top
    movingIds.forEach(function (j) {
      var q = moving[j], k = self._pulseK(j, t), col = colorAt(q.cell), lift = q.lift || 0;
      ctx.save();
      setShadow(ctx, th.shadow, (0.17 + 0.2 * lift) * s * d, (0.055 + 0.1 * lift) * s * d);
      ctx.beginPath();
      roundSq(ctx, q.x, q.y, q.a, k);
      ctx.fillStyle = th.board;      // same silhouette as the static pass: identical edges at rest
      ctx.fill();
      ctx.restore();
      if (auraOf[j]) self._glow(q.x, q.y, q.a, k, auraOf[j]);
      ctx.beginPath();
      roundSq(ctx, q.x, q.y, q.a, k);
      paintBody(ctx, q.x, q.y, k, col, px, j === self._hover);
      if (auraOf[j]) self._auraStroke(auraOf[j]);
      if (j === keyT && ringA > 0.01) self._ring(q.x, q.y, q.a, k, ringA);
    });
  };

  /** Keyboard-target ring: a thin accent outline just outside the cube, in the gap to its neighbours. */
  Board.prototype._ring = function (x, y, a, k, alpha) {
    var ctx = this.ctx;
    ctx.beginPath();
    roundSq(ctx, x, y, a, 1.115 * k);
    ctx.globalAlpha = 0.9 * alpha;
    ctx.lineWidth = 1.75 / this.camera.s;
    ctx.strokeStyle = this.theme.accent;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  Board.prototype._glow = function (x, y, a, k, level) {
    var ctx = this.ctx, d = this.dpr;
    ctx.save();
    setShadow(ctx, this.theme.danger, (9 + 9 * level) * d, 0);
    ctx.globalAlpha = Math.min(1, level * 1.1);
    ctx.beginPath();
    roundSq(ctx, x, y, a, k);
    ctx.fillStyle = this.theme.danger;
    ctx.fill();
    ctx.restore();
  };

  /** 2 px danger outline on the current path. */
  Board.prototype._auraStroke = function (level) {
    var ctx = this.ctx;
    ctx.globalAlpha = Math.min(1, level);
    ctx.lineWidth = 2 / this.camera.s;
    ctx.strokeStyle = this.theme.danger;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  Board.prototype._paintConfetti = function (t) {
    var ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._confetti.forEach(function (q) {
      var age = (t - q.t0) / q.life;
      ctx.globalAlpha = age < 0.65 ? 1 : clamp((1 - age) / 0.35, 0, 1);
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(q.flip))));
      ctx.fillStyle = q.col;
      ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
      ctx.restore();
    });
    ctx.restore();
  };

  // ===========================================================================================
  // Thumb: a small auto-fitted drawing of a shape for the side panels.
  // ===========================================================================================

  function Thumb(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._args = null;
    var self = this;
    this._onResize = function () { self._paint(); };
    if (typeof root.ResizeObserver === 'function') {
      this._ro = new root.ResizeObserver(this._onResize);
      this._ro.observe(canvas);
    }
    this._unDpr = watchDpr(this._onResize);
  }

  /**
   * cells: [[x,y],...] (y up).  opts: {mode:'cubes'|'target', matched?: Set of "x,y" keys in the
   * coordinates of `cells` (drawn solid accent in 'target' mode), theme?}.  'cubes' draws every
   * cell as a cube in the theme's main colour.
   */
  Thumb.prototype.draw = function (cells, opts) {
    this._args = {cells: cells || [], opts: opts || {}};
    this._paint();
  };

  Thumb.prototype.redraw = function () { this._paint(); };

  Thumb.prototype.destroy = function () {
    if (this._ro) this._ro.disconnect();
    if (this._unDpr) this._unDpr();
  };

  Thumb.prototype._paint = function () {
    var cv = this.canvas, ctx = this.ctx, r = cv.getBoundingClientRect();
    var W = r.width, H = r.height, d = root.devicePixelRatio || 1;
    if (!(W > 0 && H > 0)) return;
    var bw = Math.max(1, Math.round(W * d)), bh = Math.max(1, Math.round(H * d));
    if (cv.width !== bw) cv.width = bw;
    if (cv.height !== bh) cv.height = bh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    noShadow(ctx);
    ctx.clearRect(0, 0, bw, bh);
    var a = this._args;
    if (!a || !a.cells.length) return;
    var cells = a.cells, o = a.opts, th = assign(assign({}, DEFAULT_THEME), o.theme);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    cells.forEach(function (c) {
      x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0] + 1); y1 = Math.max(y1, c[1] + 1);
    });
    var pad = Math.max(8, 0.08 * Math.min(W, H));
    var cs = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0), Math.min(W, H) / 7);
    if (!(cs > 0)) return;
    var left = (W - (x1 - x0) * cs) / 2, top = (H - (y1 - y0) * cs) / 2;
    ctx.setTransform(d * cs, 0, 0, -d * cs, d * (left - x0 * cs), d * (top + y1 * cs));
    var px = 1 / cs;
    cells.forEach(function (c, i) {
      var x = c[0] + 0.5, y = c[1] + 0.5;
      ctx.beginPath();
      roundSq(ctx, x, y, 0, 1);
      if (o.mode === 'target') {
        var hit = o.matched && o.matched.has(c[0] + ',' + c[1]);
        ctx.fillStyle = th.accent;
        ctx.globalAlpha = hit ? 0.9 : 0.1;
        ctx.fill();
        ctx.globalAlpha = hit ? 1 : 0.75;
        ctx.lineWidth = 1.25 * px;
        ctx.strokeStyle = th.accent;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        paintBody(ctx, x, y, 1, cubeColor(th, true), px, false);
      }
    });
  };

  return {cubeColor: cubeColor, Board: Board, Thumb: Thumb, DEFAULT_THEME: DEFAULT_THEME};
});
