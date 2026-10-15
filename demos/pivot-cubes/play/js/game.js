/* Game state: cube identities and positions, history with undo/redo, win test, schedule export.
 *
 * Undo restores a snapshot instead of applying a reverse pivot: pivots are not always
 * reversible (a quarter turn's hinge is edge-adjacent to its source only).
 */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('./rules.js') : root.CubeRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeGame = api;
})(this, function (Rules) {
  'use strict';

  var key = Rules.key;

  function copyCells(cells) { return cells.map(function (c) { return [c[0], c[1]]; }); }
  function posKey(pos) { return pos.join(';'); }

  /**
   * opts: {start, target, puzzle}.  Cube ids follow the start cells in reading order
   * (top row first, left to right), so a cube keeps its colour for the whole game.
   */
  function Game(opts) {
    this.model = Rules.MODEL;
    this.puzzle = opts.puzzle || {};
    this.start = copyCells(opts.start).sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
    this.target = Rules.normalize(opts.target);
    this.targetKey = Rules.normKey(this.target);
    this.n = this.start.length;
    this.history = [];      // [{id, move}]
    this.snaps = [copyCells(this.start)];
    this.cursor = 0;
    this.lastErased = 0;
    this._load(this.snaps[0]);
  }

  Game.prototype._load = function (pos) {
    this.pos = copyCells(pos);
    this.occ = new Map();
    for (var i = 0; i < this.pos.length; i++) this.occ.set(key(this.pos[i][0], this.pos[i][1]), i);
  };

  Game.prototype.idAt = function (x, y) {
    var id = this.occ.get(key(x, y));
    return id === undefined ? null : id;
  };

  /** What dragging cube `id` in direction `dir` would do (see CubeRules.rollMove). */
  Game.prototype.roll = function (id, dir) {
    return Rules.rollMove(this.occ, this.pos[id], dir);
  };

  /**
   * Apply a move returned by roll(); drops any redo tail.  Returns the moved cube's id.
   *
   * The step count is the loop-erased path: if the move recreates an earlier state exactly
   * (every cube on the same cell), history is cut back to that state and `lastErased` is the
   * number of moves in the erased loop, this one included (so the count shown before this
   * commit was moveCount() + lastErased - 1).  Stepping a cube back where it came from thus
   * counts like an undo.
   */
  Game.prototype.commit = function (move) {
    var id = this.idAt(move.src[0], move.src[1]);
    if (id === null) throw new Error('commit: no cube at ' + move.src);
    this.history.length = this.cursor;
    this.snaps.length = this.cursor + 1;
    this.occ.delete(key(move.src[0], move.src[1]));
    this.occ.set(key(move.dst[0], move.dst[1]), id);
    this.pos[id] = [move.dst[0], move.dst[1]];
    this.lastErased = 0;
    var now = posKey(this.pos);
    for (var j = 0; j < this.cursor; j++) {
      if (posKey(this.snaps[j]) === now) {
        this.lastErased = this.cursor + 1 - j;
        this.cursor = j;
        this.history.length = j;
        this.snaps.length = j + 1;
        return id;
      }
    }
    this.history.push({id: id, move: move});
    this.snaps.push(copyCells(this.pos));
    this.cursor++;
    return id;
  };

  Game.prototype.canUndo = function () { return this.cursor > 0; };
  Game.prototype.canRedo = function () { return this.cursor < this.history.length; };

  /** Step back; returns {id, move} of the undone pivot (for animation) or null. */
  Game.prototype.undo = function () {
    if (!this.canUndo()) return null;
    var h = this.history[this.cursor - 1];
    this.cursor--;
    this._load(this.snaps[this.cursor]);
    return h;
  };

  Game.prototype.redo = function () {
    if (!this.canRedo()) return null;
    var h = this.history[this.cursor];
    this.cursor++;
    this._load(this.snaps[this.cursor]);
    return h;
  };

  /** Back to the start; the moves stay on the redo list. */
  Game.prototype.reset = function () {
    this.cursor = 0;
    this._load(this.snaps[0]);
  };

  Game.prototype.cells = function () { return copyCells(this.pos); };
  Game.prototype.moveCount = function () { return this.cursor; };
  Game.prototype.solved = function () { return Rules.normKey(this.pos) === this.targetKey; };
  Game.prototype.legalMoves = function () { return Rules.legalMoves(this.occ); };
  Game.prototype.stuck = function () { return this.legalMoves().length === 0; };

  /** The moves played so far as a cubes-schedule-v1 document (one pivot per batch). */
  Game.prototype.exportSchedule = function (extraMeta) {
    var sorted = function (cells) { return copyCells(cells).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }); };
    var meta = {
      app: 'cubes-game',
      version: 1,
      model: this.model,
      puzzle: this.puzzle,
      moves: this.cursor,
      solved: this.solved(),
      exportedAt: new Date().toISOString(),
    };
    if (extraMeta) Object.keys(extraMeta).forEach(function (k) { meta[k] = extraMeta[k]; });
    return {
      format: 'cubes-schedule-v1',
      start: sorted(this.start),
      goal: sorted(this.target),
      batches: this.history.slice(0, this.cursor).map(function (h) {
        var m = h.move;
        return [{src: m.src, dst: m.dst, corner: m.corner, anchor: m.anchor, swept: m.swept, turns: m.turns}];
      }),
      meta: meta,
    };
  };

  Game.prototype.serialize = function () {
    return {
      v: 1,
      start: this.start,
      target: this.target,
      model: this.model,
      puzzle: this.puzzle,
      moves: this.history.map(function (h) { return h.move; }),
      cursor: this.cursor,
    };
  };

  /** Rebuild a saved game, re-checking every move; throws on anything that doesn't replay. */
  Game.restore = function (obj) {
    if (!obj || obj.v !== 1) throw new Error('unknown save format');
    if (obj.model !== Rules.MODEL) throw new Error('saved under another move model');
    var g = new Game({start: obj.start, target: obj.target, puzzle: obj.puzzle});
    var tOcc = Rules.occOf(g.target);
    if (g.occ.size !== g.n || tOcc.size !== g.n || !Rules.isConnected(g.occ) || !Rules.isConnected(tOcc)) {
      throw new Error('bad shapes');
    }
    obj.moves.forEach(function (m) {
      var id = g.idAt(m.src[0], m.src[1]);
      if (id === null) throw new Error('bad move');
      var r = g.roll(id, Rules.dirOf(m));
      if (!r.ok || Rules.moveSignature(r.move) !== Rules.moveSignature(m)) throw new Error('illegal move');
      g.commit(r.move);
      if (g.lastErased) throw new Error('saved history has a loop');   // saves predating loop erasure
    });
    var cur = Math.max(0, Math.min(obj.cursor | 0, g.history.length));
    while (g.cursor > cur) g.undo();
    return g;
  };

  return Game;
});
