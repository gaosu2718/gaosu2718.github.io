/* Pointer input for the pivot-cube board.
 *
 * DragFSM is a pure state machine (no DOM) so node can test it; attach() wires it to a canvas.
 *
 * States: 'idle' | 'pending' (cube grabbed, inside the dead zone) | 'dragging' (direction locked,
 * legal roll previewed) | 'blocked' (direction locked, roll illegal).
 *
 * The view has no pan or zoom, so a drag always means a cube: the board keeps the swarm in view by
 * itself (CubeRender.Board), and a press on empty space is left alone.
 *
 * A drag of one cell is one full move (90 or 180 degrees alike): p = clamp(along / cellPx, 0, 1).
 * One gesture moves a cube by at most one step: while held, p clamps at 1 (the preview holds the
 * full pivot pose and the player can still pull back); the commit happens only on release, when
 * p >= 0.5 commits (animating the rest) and anything less springs back.
 * Screen y points down: the screen vector of drag direction d is (d.x, -d.y).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeInput = api;
})(this, function (root) {
  'use strict';

  var SCREEN = {L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1]};
  var SIDEWAYS_DRAG = 1.5;     // dragging: unlock when |perp| > max(deadZone, 1.5 * along)
  var SIDEWAYS_BLOCKED = 1.2;  // blocked: nothing moves, so switching direction is cheaper

  function dominant(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'R' : 'L';
    return dy <= 0 ? 'U' : 'D';
  }

  /**
   * env: {hitTest(px,py)->id|null, cellPx()->number, roll(id,dir)->rollMove result,
   *       preview(id,move,p) (preview(null,null,0) clears), commit(id,move,fromP,animate),
   *       springBack(id,move,fromP), blocked(id,fail,dir), unblocked(), snap()}
   */
  function DragFSM(env) {
    this.env = env;
    this.state = 'idle';
    this._clear();
  }

  DragFSM.prototype._clear = function () {
    this.id = null;          // grabbed cube
    this.dir = null;         // locked direction
    this.pivot = null;       // legal move being previewed
    this.fail = null;        // rollMove failure while blocked
    this.p = 0;              // preview progress, clamped to [0, 1]
    this.ox = 0; this.oy = 0;  // gesture origin (pointer-down position)
  };

  DragFSM.prototype.deadZone = function () { return Math.max(6, 0.12 * this.env.cellPx()); };

  /**
   * Pointer down.  button: 0 left, 1 middle, 2 right.  Returns true if the FSM took the pointer,
   * which it does only for a left press on a cube.
   */
  DragFSM.prototype.down = function (px, py, button) {
    if (this.state !== 'idle') return false;
    this._clear();
    if (button !== 0) return false;
    var id = this.env.hitTest(px, py);
    if (id === null || id === undefined) return false;
    if (this.env.snap) this.env.snap();
    this.state = 'pending';
    this.id = id;
    this.ox = px; this.oy = py;
    return true;
  };

  DragFSM.prototype.move = function (px, py) {
    if (this.state === 'idle') return;
    this._track(px, py);
  };

  /**
   * Follow a held cube drag.  At most one unlock + re-lock happens per pointer position: a fresh
   * lock is on the dominant axis, so it never meets its own unlock condition.
   */
  DragFSM.prototype._track = function (px, py) {
    var env = this.env;
    for (var guard = 0; guard < 4; guard++) {
      var dx = px - this.ox, dy = py - this.oy, dz = this.deadZone();
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (this.state === 'pending') {
        if (dist < dz) return;
        this._lock(dominant(dx, dy));
        continue;
      }
      var v = SCREEN[this.dir];
      var along = dx * v[0] + dy * v[1], perp = Math.abs(dx * v[1] - dy * v[0]);
      var k = this.state === 'blocked' ? SIDEWAYS_BLOCKED : SIDEWAYS_DRAG;
      if (dist < dz || along <= 0 || perp > Math.max(dz, k * along)) { this._unlock(); continue; }
      if (this.state === 'blocked') return;
      this.p = Math.min(1, along / env.cellPx());
      env.preview(this.id, this.pivot, this.p);
      return;
    }
  };

  DragFSM.prototype._lock = function (dir) {
    var r = this.env.roll(this.id, dir);
    this.dir = dir;
    this.p = 0;
    if (r && r.ok) {
      this.state = 'dragging';
      this.pivot = r.move;
      this.fail = null;
    } else {
      this.state = 'blocked';
      this.pivot = null;
      this.fail = r;
      this.env.blocked(this.id, r, dir);
    }
  };

  DragFSM.prototype._unlock = function () {
    if (this.state === 'dragging') this.env.preview(null, null, 0);
    else if (this.state === 'blocked') this.env.unblocked();
    this.state = 'pending';
    this.dir = null;
    this.pivot = null;
    this.fail = null;
    this.p = 0;
  };

  /**
   * Pointer up at (px, py) (optional: the last move position is used if omitted).  The only place
   * a gesture commits, so it commits at most once; the FSM is idle afterwards.
   */
  DragFSM.prototype.up = function (px, py) {
    if (this.state === 'idle') return;
    if (px !== undefined && py !== undefined) this.move(px, py);
    var env = this.env, st = this.state;
    if (st === 'dragging') {
      if (this.p >= 0.5) env.commit(this.id, this.pivot, this.p, true);
      else env.springBack(this.id, this.pivot, this.p);
    } else if (st === 'blocked') {
      env.unblocked();
    }
    this.state = 'idle';
    this._clear();
  };

  /** Abort the gesture: spring back, never commit. */
  DragFSM.prototype.cancel = function () {
    var env = this.env, st = this.state;
    if (st === 'dragging') env.springBack(this.id, this.pivot, this.p);
    else if (st === 'blocked') env.unblocked();
    this.state = 'idle';
    this._clear();
  };

  /** Drop the gesture without any env callback (the game it referred to is gone). */
  DragFSM.prototype.abort = function () {
    this.state = 'idle';
    this._clear();
  };

  // ===========================================================================================
  // Keyboard: W/A/S/D or the arrow keys roll the cube under the pointer one step
  // ===========================================================================================

  /** Lower-cased KeyboardEvent.key -> roll direction.  Letters follow the printed key (e.key). */
  var KEY_DIRS = {
    w: 'U', a: 'L', s: 'D', d: 'R',
    arrowup: 'U', arrowleft: 'L', arrowdown: 'D', arrowright: 'R',
  };
  var STICKY_PX = 3;       // the keyboard target stays on a moved cube until the pointer moves this far
  var KEY_BLOCK_MS = 600;  // a refused key move keeps its red aura this long

  /** Direction for a key event ({key, ctrlKey, metaKey, altKey}), or null (unbound or modified). */
  function keyDir(e) {
    if (!e || e.ctrlKey || e.metaKey || e.altKey) return null;
    return KEY_DIRS[String(e.key || '').toLowerCase()] || null;
  }

  /**
   * Pure keyboard driver (no DOM).  env is the DragFSM env (hitTest, roll, commit, blocked, unblocked,
   * snap) plus optional keyTarget(id|null) for the selection ring.  timers: {set(fn, ms), clear(h)}.
   *
   * Target: after a key move the cube usually leaves the pointer, so the target sticks to that cube
   * until the pointer moves more than STICKY_PX or leaves the board; otherwise it is the cube under
   * the pointer.
   */
  function KeyControl(env, timers) {
    this.env = env;
    this.timers = timers || {set: function (fn, ms) { return setTimeout(fn, ms); }, clear: function (h) { clearTimeout(h); }};
    this.inside = false;     // pointer over the board
    this.px = 0; this.py = 0;  // last pointer position
    this.sticky = null;      // cube id the keyboard keeps driving, or null
    this.ax = 0; this.ay = 0;  // pointer position when it became sticky
    this._timer = null;      // pending auto-release of a refused move's aura
  }

  KeyControl.prototype._setSticky = function (id) {
    if (id === this.sticky) return;
    this.sticky = id;
    if (this.env.keyTarget) this.env.keyTarget(id);
  };

  KeyControl.prototype.pointer = function (px, py) {
    this.inside = true;
    this.px = px; this.py = py;
    if (this.sticky !== null) {
      var dx = px - this.ax, dy = py - this.ay;
      if (dx * dx + dy * dy > STICKY_PX * STICKY_PX) this._setSticky(null);
    }
  };

  KeyControl.prototype.leave = function () {
    this.inside = false;
    this._setSticky(null);
  };

  /** Forget the sticky cube (e.g. the game was replaced) and release any pending refusal. */
  KeyControl.prototype.reset = function () {
    this.releaseBlocked();
    this._setSticky(null);
  };

  /** The cube the next key press would roll, or null. */
  KeyControl.prototype.target = function () {
    if (this.sticky !== null) return this.sticky;
    if (!this.inside) return null;
    var id = this.env.hitTest(this.px, this.py);
    return id === undefined ? null : id;
  };

  /** End a refused key move's aura now (also called before any drag starts). */
  KeyControl.prototype.releaseBlocked = function () {
    if (this._timer === null) return;
    this.timers.clear(this._timer);
    this._timer = null;
    this.env.unblocked();
  };

  /**
   * A keydown.  Returns true when the key was consumed (the caller then preventDefaults it):
   * a bound key with a cube targeted.  Auto-repeats are consumed but do nothing (one press, one step).
   */
  KeyControl.prototype.press = function (e) {
    var dir = keyDir(e);
    if (!dir) return false;
    var id = this.target();
    if (id === null) return false;
    if (e.repeat) return true;
    var env = this.env, self = this;
    this.releaseBlocked();
    if (env.snap) env.snap();
    var r = env.roll(id, dir);
    if (r && r.ok) {
      env.commit(id, r.move, 0, true);
    } else {
      env.blocked(id, r, dir);
      this._timer = this.timers.set(function () { self._timer = null; env.unblocked(); }, KEY_BLOCK_MS);
    }
    this.ax = this.px; this.ay = this.py;
    this._setSticky(id);
    return true;
  };

  // ===========================================================================================
  // DOM wiring
  // ===========================================================================================

  var TEXT_INPUTS = {text: 1, search: 1, number: 1, email: 1, url: 1, password: 1, tel: 1};

  /** Text entry has focus: leave the keys alone.  Checkboxes/buttons don't count. */
  function isTyping(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    if (tag === 'input') return !!TEXT_INPUTS[(t.type || 'text').toLowerCase()];
    return tag === 'textarea' || tag === 'select' || !!t.isContentEditable;
  }

  /**
   * Wire pointer and key events of `canvas` to `board` (a CubeRender.Board).
   * handlers: {commit(id, move, fromP, animate), onBlocked(fail, id, dir), onUnblocked(), onHover(id)}.
   * handlers.commit must apply the move to the game; afterwards attach animates the rest of the
   * pivot (if the handler did not start an animation itself) and calls board.refresh().
   * Keys: W/A/S/D or arrows roll the cube under the pointer (or the cube the keyboard just moved)
   * one step through the same commit / blocked paths as a drag, as commit(id, move, 0, true).
   * Returns {detach(), fsm, keys}.
   */
  function attach(canvas, board, handlers) {
    handlers = handlers || {};
    var win = root, Rules = root.CubeRules;
    // A move is committed only if it is still exactly what rolling that cube would do now (the app
    // may have undone / reset under a held drag).
    function stillLegal(id, move) {
      var g = board.game;
      if (!g || g.idAt(move.src[0], move.src[1]) !== id) return false;
      if (!Rules) return true;
      var r = g.roll(id, Rules.dirOf(move));
      return !!(r && r.ok && Rules.moveSignature(r.move) === Rules.moveSignature(move));
    }
    var env = {
      hitTest: function (px, py) { return board.cubeAt(px, py); },
      cellPx: function () { return board.camera.s; },
      roll: function (id, dir) { return board.game.roll(id, dir); },
      preview: function (id, move, p) { board.preview(id, move, p); },
      commit: function (id, move, fromP, animate) {
        board.preview(null);
        if (!stillLegal(id, move)) { board.refresh(); return; }
        if (handlers.commit) handlers.commit(id, move, fromP, animate);
        else board.game.commit(move);
        var g = board.game;
        if (animate && g && g.idAt(move.dst[0], move.dst[1]) === id && !board.isAnimating(id)) {
          board.animateMove(id, move, fromP, 1);
        }
        board.refresh();
      },
      springBack: function (id, move, fromP) {
        board.preview(null);
        board.animateMove(id, move, fromP, 0);
      },
      blocked: function (id, fail, dir) {
        board.showBlocked(id, fail, dir);
        if (handlers.onBlocked) handlers.onBlocked(fail, id, dir);
      },
      unblocked: function () {
        board.releaseBlocked();
        if (handlers.onUnblocked) handlers.onUnblocked();
      },
      snap: function () { board.snapAnimations(); },
      keyTarget: function (id) { board.setKeyTarget(id); },
    };
    var fsm = new DragFSM(env);
    var keys = new KeyControl(env);
    var active = null, hoverId = null, downGame = null;
    var keyGame = board.game;

    /** The app swapped in a new game mid-gesture: drop the gesture quietly. */
    function stale() {
      if (fsm.state === 'idle' || board.game === downGame) return false;
      fsm.abort();
      board.preview(null);
      board.releaseBlocked();
      return true;
    }

    function local(e) {
      var r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    function cursor() {
      var st = fsm.state, c = '';
      if (st !== 'idle') c = 'grabbing';
      else if (hoverId !== null) c = 'grab';
      canvas.style.cursor = c;
    }
    function hover(id) {
      if (id === undefined) id = null;
      if (id === hoverId) return;
      hoverId = id;
      board.setHover(id);
      if (handlers.onHover) handlers.onHover(id);
    }
    function release(e) {
      try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    }
    function cancel() {
      if (!stale() && fsm.state !== 'idle') fsm.cancel();
      active = null;
      cursor();
    }

    function onDown(e) {
      if (active !== null) return;
      var pt = local(e);
      keys.reset();
      if (!fsm.down(pt[0], pt[1], e.button)) return;
      e.preventDefault();
      active = e.pointerId;
      downGame = board.game;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
      hover(null);
      cursor();
    }
    function onMove(e) {
      var pt = local(e);
      keys.pointer(pt[0], pt[1]);
      if (active !== null) {
        if (e.pointerId !== active) return;
        if (!stale()) fsm.move(pt[0], pt[1]);
        cursor();
        return;
      }
      if (e.pointerType === 'touch') return;
      hover(board.cubeAt(pt[0], pt[1]));
      cursor();
    }
    function onUp(e) {
      if (active === null || e.pointerId !== active) return;
      var pt = local(e);
      active = null;
      if (!stale()) fsm.up(pt[0], pt[1]);
      release(e);
      if (e.pointerType !== 'touch') hover(board.cubeAt(pt[0], pt[1]));
      cursor();
    }
    function onCancel(e) {
      if (active === null || e.pointerId !== active) return;
      cancel();
    }
    function onEnter(e) { var pt = local(e); keys.pointer(pt[0], pt[1]); }
    function onLeave() { keys.leave(); if (active === null) { hover(null); cursor(); } }
    function onMenu(e) { e.preventDefault(); }
    function onKeyDown(e) {
      if (!e.defaultPrevented && !isTyping(e.target) && fsm.state === 'idle' && active === null && keyDir(e)) {
        if (board.game !== keyGame) { keys.reset(); keyGame = board.game; }
        if (board.game && keys.press(e)) {
          e.preventDefault();
          if (!e.repeat) { hover(keys.sticky); cursor(); }
        }
        return;
      }
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (fsm.state !== 'idle') cancel();
      }
    }
    function onBlur() { keys.reset(); cancel(); }

    canvas.style.touchAction = 'none';
    var L = [
      [canvas, 'pointerdown', onDown], [canvas, 'pointermove', onMove], [canvas, 'pointerup', onUp],
      [canvas, 'pointercancel', onCancel], [canvas, 'lostpointercapture', onCancel],
      [canvas, 'pointerenter', onEnter], [canvas, 'pointerleave', onLeave], [canvas, 'contextmenu', onMenu],
      [win, 'keydown', onKeyDown], [win, 'blur', onBlur],
    ];
    L.forEach(function (l) { l[0].addEventListener(l[1], l[2], l[3] || false); });

    return {
      fsm: fsm,
      keys: keys,
      detach: function () {
        keys.reset();
        cancel();
        L.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3] || false); });
        hover(null);
        canvas.style.cursor = '';
      },
    };
  }

  return {DragFSM: DragFSM, attach: attach, dominant: dominant, KEY_DIRS: KEY_DIRS, keyDir: keyDir, KeyControl: KeyControl};
});
