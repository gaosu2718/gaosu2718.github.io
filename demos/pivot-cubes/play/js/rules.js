/* Pivot rules for the game: "free leapfrog", the project's move rule (docs/cube-model.md), a
 * relaxation of cube/moves.py's strict leapfrog.
 *
 * Connectivity: a shape is connected when every split of it into two parts leaves them sharing
 * an edge or touching at two or more corners (a pincer or a lambda holds; a single corner does
 * not).  A pivot rotates one cube by 90 or 180 degrees about one of its corners, and is legal iff
 *
 *   (P) a hinge cube touches the pivot corner: for a quarter turn either the edge-neighbour
 *       sharing that corner (the anchor, as in cube/) or the diagonal neighbour across it; a
 *       half turn ends on that diagonal cell, so it needs the anchor;
 *   (S) every swept cell, destination included, is empty;
 *   (C) the shape is connected with the cube lifted and after it lands.
 *
 * The table holds the 8 rotations (corner x sense) of a cube at (0,0); each may stop at 90 or
 * carry on to 180 degrees.  Sweeps come from cube.moves._canonical_pivots ("leapfrog", keeping
 * the 16 physical labels whose anchor lies outside the sweep).  The diagonal cell across a
 * rotation's corner is its 180-degree destination, dst180.
 *
 * A drag in direction d means "roll that way": the two rotations whose quarter turn moves the
 * cube by d, one hinged on each side; at most one has a hinge and a clear quarter sweep.  That
 * rotation stops at 90 degrees if the cube lands holding on (an edge, or two corners), else rolls
 * on to 180 degrees around the corner, whose extra sweep is then always clear.  So each drag
 * gives at most one move, and fails only when the cube is a cut, has no hinge, or is blocked.  tools/crosscheck.py checks this against an independent Python
 * implementation (tools/free_model.py) and checks that it contains every move of cube.moves'
 * leapfrog model.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeRules = api;
})(this, function () {
  'use strict';

  var ROTATIONS = [
    {corner:[0,0], sense:-1, anchor:[-1,0], dst90:[0,-1], swept90:[[0,-1],[1,-1],[1,0]], dst180:[-1,-1], swept180:[[-1,-2],[-1,-1],[0,-2],[0,-1],[1,-1],[1,0]]},
    {corner:[0,0], sense:1, anchor:[0,-1], dst90:[-1,0], swept90:[[-1,0],[-1,1],[0,1]], dst180:[-1,-1], swept180:[[-2,-1],[-2,0],[-1,-1],[-1,0],[-1,1],[0,1]]},
    {corner:[0,1], sense:-1, anchor:[0,1], dst90:[-1,0], swept90:[[-1,-1],[-1,0],[0,-1]], dst180:[-1,1], swept180:[[-2,0],[-2,1],[-1,-1],[-1,0],[-1,1],[0,-1]]},
    {corner:[0,1], sense:1, anchor:[-1,0], dst90:[0,1], swept90:[[0,1],[1,0],[1,1]], dst180:[-1,1], swept180:[[-1,1],[-1,2],[0,1],[0,2],[1,0],[1,1]]},
    {corner:[1,0], sense:-1, anchor:[0,-1], dst90:[1,0], swept90:[[0,1],[1,0],[1,1]], dst180:[1,-1], swept180:[[0,1],[1,-1],[1,0],[1,1],[2,-1],[2,0]]},
    {corner:[1,0], sense:1, anchor:[1,0], dst90:[0,-1], swept90:[[-1,-1],[-1,0],[0,-1]], dst180:[1,-1], swept180:[[-1,-1],[-1,0],[0,-2],[0,-1],[1,-2],[1,-1]]},
    {corner:[1,1], sense:-1, anchor:[1,0], dst90:[0,1], swept90:[[-1,0],[-1,1],[0,1]], dst180:[1,1], swept180:[[-1,0],[-1,1],[0,1],[0,2],[1,1],[1,2]]},
    {corner:[1,1], sense:1, anchor:[0,1], dst90:[1,0], swept90:[[0,-1],[1,-1],[1,0]], dst180:[1,1], swept180:[[0,-1],[1,-1],[1,0],[1,1],[2,0],[2,1]]},
  ];

  var DIRS = {
    L: [-1, 0],
    R: [1, 0],
    U: [0, 1],
    D: [0, -1],
  };
  var DIR_NAMES = ['L', 'R', 'U', 'D'];
  var EDGE = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var NEIGH8 = EDGE.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  var MODEL = 'leapfrog-free';

  // direction -> the two rotations whose quarter turn moves the cube that way
  var ROLLS = {};
  DIR_NAMES.forEach(function (d) {
    ROLLS[d] = ROTATIONS.filter(function (r) {
      return r.dst90[0] === DIRS[d][0] && r.dst90[1] === DIRS[d][1];
    });
  });

  function key(x, y) { return x + ',' + y; }
  function parseKey(k) {
    var i = k.indexOf(',');
    return [+k.slice(0, i), +k.slice(i + 1)];
  }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }

  // --- connectivity ----------------------------------------------------------------------------
  //
  // A shape is connected when every split of it into two non-empty parts leaves the parts sharing
  // an edge or touching at two or more corner points.  A part hanging on a single corner is loose
  // (it could swing about that point); a pincer or a lambda holds.  Cells that share an edge form
  // one edge-component, and distinct edge-components can only meet at corner points, where
  // exactly one diagonal pair of cells is occupied.  So the shape is connected iff the graph of
  // edge-components, weighted by shared corner points, is connected and has no bridge of weight
  // one: a split held by a single point is exactly such a bridge.

  /** Edge-components of `occ` (a Set or Map keyed by "x,y") minus `removeKey`, as key arrays. */
  function components(occ, removeKey) {
    var seen = new Set();
    var out = [];
    occ.forEach(function (_v, k) {
      if (k === removeKey || seen.has(k)) return;
      var comp = [k];
      seen.add(k);
      for (var i = 0; i < comp.length; i++) {
        var c = parseKey(comp[i]);
        for (var e = 0; e < 4; e++) {
          var nk = key(c[0] + EDGE[e][0], c[1] + EDGE[e][1]);
          if (nk !== removeKey && occ.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            comp.push(nk);
          }
        }
      }
      out.push(comp);
    });
    return out;
  }

  // The tests below run on an integer view of the shape (cell index -> edge neighbours, plus
  // the list of diagonal pairs), built once per call, so the per-cube tests in cutVertices
  // stay cheap at n = 50.

  function cellGraph(occ) {
    var keys = [], index = new Map();
    occ.forEach(function (_v, k) { index.set(k, keys.length); keys.push(k); });
    var adj = [], diag = [];
    for (var i = 0; i < keys.length; i++) {
      var c = parseKey(keys[i]), a = [];
      for (var e = 0; e < 4; e++) {
        var j = index.get(key(c[0] + EDGE[e][0], c[1] + EDGE[e][1]));
        if (j !== undefined) a.push(j);
      }
      adj.push(a);
      var d1 = index.get(key(c[0] + 1, c[1] + 1)), d2 = index.get(key(c[0] + 1, c[1] - 1));
      if (d1 !== undefined) diag.push(i, d1);           // each diagonal pair, hence each point, once
      if (d2 !== undefined) diag.push(i, d2);
    }
    return {n: keys.length, keys: keys, index: index, adj: adj, diag: diag};
  }

  /** Edge-component label of every cell except `skip` (-1 for none): {comp, count}. */
  function edgeLabels(G, skip) {
    var comp = new Int32Array(G.n).fill(-1), count = 0, stack = [];
    for (var s = 0; s < G.n; s++) {
      if (s === skip || comp[s] !== -1) continue;
      comp[s] = count;
      stack.push(s);
      while (stack.length) {
        var a = G.adj[stack.pop()];
        for (var t = 0; t < a.length; t++) {
          if (a[t] !== skip && comp[a[t]] === -1) { comp[a[t]] = count; stack.push(a[t]); }
        }
      }
      count++;
    }
    return {comp: comp, count: count};
  }

  /** Does the shape minus cell index `skip` hold together (no split held by under 2 points)? */
  function graphHolds(G, skip) {
    var L = edgeLabels(G, skip), count = L.count, comp = L.comp;
    if (count <= 1) return true;
    var weight = new Map();                              // component pair -> shared corner points
    for (var d = 0; d < G.diag.length; d += 2) {
      var a = G.diag[d], b = G.diag[d + 1];
      if (a === skip || b === skip || comp[a] === comp[b]) continue;
      var pk = Math.min(comp[a], comp[b]) * count + Math.max(comp[a], comp[b]);
      weight.set(pk, (weight.get(pk) || 0) + 1);
    }
    // Connected, and no bridge of weight one (Tarjan bridges on the component graph).
    var nbrs = [];
    for (var i = 0; i < count; i++) nbrs.push([]);
    weight.forEach(function (w, pk) {
      var u = Math.floor(pk / count), v = pk % count;
      nbrs[u].push(v, w);
      nbrs[v].push(u, w);
    });
    var disc = new Int32Array(count).fill(-1), low = new Int32Array(count), time = 0, weak = false;
    (function dfs(u, parent) {
      disc[u] = low[u] = time++;
      for (var t = 0; t < nbrs[u].length; t += 2) {
        var v = nbrs[u][t];
        if (disc[v] === -1) {
          dfs(v, u);
          low[u] = Math.min(low[u], low[v]);
          if (low[v] > disc[u] && nbrs[u][t + 1] === 1) weak = true;
        } else if (v !== parent) {
          low[u] = Math.min(low[u], disc[v]);
        }
      }
    })(0, -1);
    return time === count && !weak;
  }

  /** Is `occ` minus `removeKey` connected (an edge, or two corners, across every split)? */
  function connectedWithout(occ, removeKey) {
    var G = cellGraph(occ), skip = removeKey === null || removeKey === undefined ? -1 : G.index.get(removeKey);
    return graphHolds(G, skip === undefined ? -1 : skip);
  }

  function isConnected(occ) { return connectedWithout(occ, null); }

  /** True if lifting the cube at `k` would leave the rest of the shape loose. */
  function isCutVertex(occ, k) { return occ.size > 2 && !connectedWithout(occ, k); }

  /** Articulation points of the edge-adjacency graph (Tarjan over every edge-component). */
  function edgeArticulations(G) {
    var disc = new Int32Array(G.n).fill(-1), low = new Int32Array(G.n), time = 0, art = [];
    function dfs(u, parent) {
      disc[u] = low[u] = time++;
      var children = 0, isArt = false;
      G.adj[u].forEach(function (v) {
        if (disc[v] === -1) {
          children++;
          dfs(v, u);
          low[u] = Math.min(low[u], low[v]);
          if (parent !== -1 && low[v] >= disc[u]) isArt = true;
        } else if (v !== parent) {
          low[u] = Math.min(low[u], disc[v]);
        }
      });
      if ((parent === -1 && children > 1) || isArt) art.push(u);
    }
    for (var r = 0; r < G.n; r++) if (disc[r] === -1) dfs(r, -1);
    return art;
  }

  /**
   * Every cube whose lifting would leave the rest loose, as a Set of keys.  Only cubes that
   * split their own edge-component or take part in a corner contact between components can
   * change the component graph, so only those get the full test.
   */
  function cutVertices(occ) {
    var cut = new Set();
    if (occ.size <= 2) return cut;
    var G = cellGraph(occ), i;
    if (!graphHolds(G, -1)) {
      for (i = 0; i < G.n; i++) if (!graphHolds(G, i)) cut.add(G.keys[i]);
      return cut;
    }
    var suspect = new Uint8Array(G.n);
    edgeArticulations(G).forEach(function (u) { suspect[u] = 1; });
    var comp = edgeLabels(G, -1).comp;
    for (var d = 0; d < G.diag.length; d += 2) {
      if (comp[G.diag[d]] !== comp[G.diag[d + 1]]) { suspect[G.diag[d]] = 1; suspect[G.diag[d + 1]] = 1; }
    }
    for (i = 0; i < G.n; i++) if (suspect[i] && !graphHolds(G, i)) cut.add(G.keys[i]);
    return cut;
  }

  /**
   * The cubes that would come loose without `removeKey`.  Dropping every bridge of weight one
   * from the component graph leaves groups that each hold together (removing a bridge creates
   * no new bridge inside either side); the group with the largest edge-component is the body,
   * and every other group hangs on a single corner somewhere.
   */
  function looseCells(occ, removeKey) {
    var G = cellGraph(occ), skip = G.index.has(removeKey) ? G.index.get(removeKey) : -1;
    var L = edgeLabels(G, skip), count = L.count, comp = L.comp, size = new Int32Array(count);
    for (var c = 0; c < G.n; c++) if (c !== skip) size[comp[c]]++;
    var weight = new Map();
    for (var d = 0; d < G.diag.length; d += 2) {
      var a = G.diag[d], b = G.diag[d + 1];
      if (a === skip || b === skip || comp[a] === comp[b]) continue;
      var pk = Math.min(comp[a], comp[b]) * count + Math.max(comp[a], comp[b]);
      weight.set(pk, (weight.get(pk) || 0) + 1);
    }
    var nbrs = [];
    for (var i = 0; i < count; i++) nbrs.push([]);
    weight.forEach(function (w, pk) {
      var u = Math.floor(pk / count), v = pk % count;
      nbrs[u].push(v, w);
      nbrs[v].push(u, w);
    });
    var disc = new Int32Array(count).fill(-1), low = new Int32Array(count), time = 0, weak = new Set();
    function dfs(u, parent) {
      disc[u] = low[u] = time++;
      for (var t = 0; t < nbrs[u].length; t += 2) {
        var v = nbrs[u][t];
        if (disc[v] === -1) {
          dfs(v, u);
          low[u] = Math.min(low[u], low[v]);
          if (low[v] > disc[u] && nbrs[u][t + 1] === 1) weak.add(Math.min(u, v) * count + Math.max(u, v));
        } else if (v !== parent) {
          low[u] = Math.min(low[u], disc[v]);
        }
      }
    }
    for (var r = 0; r < count; r++) if (disc[r] === -1) dfs(r, -1);
    var group = new Int32Array(count).fill(-1), groups = 0, biggest = 0, best = -1, stack = [];
    for (var s = 0; s < count; s++) {
      if (group[s] !== -1) continue;
      group[s] = groups;
      stack.push(s);
      while (stack.length) {
        var u = stack.pop();
        if (size[u] > biggest) { biggest = size[u]; best = groups; }
        for (var t = 0; t < nbrs[u].length; t += 2) {
          var v = nbrs[u][t];
          if (group[v] === -1 && !weak.has(Math.min(u, v) * count + Math.max(u, v))) { group[v] = groups; stack.push(v); }
        }
      }
      groups++;
    }
    var out = [];
    for (c = 0; c < G.n; c++) if (c !== skip && group[comp[c]] !== best) out.push(parseKey(G.keys[c]));
    return out;
  }

  /** Would `cell` hold on to the rest (lifted mover `srcKey` excluded): an edge, or 2+ corners? */
  function holds(occ, cell, srcKey) {
    var corners = 0;
    for (var e = 0; e < 8; e++) {
      var nk = key(cell[0] + NEIGH8[e][0], cell[1] + NEIGH8[e][1]);
      if (nk === srcKey || !occ.has(nk)) continue;
      if (e < 4) return true;
      corners++;
    }
    return corners >= 2;
  }

  function occupied(occ, src, rel) {
    var out = [];
    for (var i = 0; i < rel.length; i++) {
      var c = add(src, rel[i]);
      if (occ.has(key(c[0], c[1]))) out.push(c);
    }
    return out;
  }

  function cmpCell(a, b) { return a[0] - b[0] || a[1] - b[1]; }

  function makeMove(src, rot, quarter, hinge) {
    var dst = quarter === 1 ? rot.dst90 : rot.dst180;
    var swept = quarter === 1 ? rot.swept90 : rot.swept180;
    return {
      src: [src[0], src[1]],
      dst: add(src, dst),
      corner: add(src, rot.corner),
      anchor: add(src, hinge),
      swept: swept.map(function (c) { return add(src, c); }).sort(cmpCell),
      turns: rot.sense * quarter,
    };
  }

  function roll(occ, src, dir, cut) {
    var srcKey = key(src[0], src[1]);
    if (cut) {
      return {ok: false, reason: 'cut', blockers: [], dependents: looseCells(occ, srcKey), hinge: null};
    }
    var fails = [];
    var rots = ROLLS[dir];
    for (var i = 0; i < rots.length; i++) {
      var rot = rots[i];
      var anchor = add(src, rot.anchor), diag = add(src, rot.dst180);
      var hasAnchor = occ.has(key(anchor[0], anchor[1])), hasDiag = occ.has(key(diag[0], diag[1]));
      if (!hasAnchor && !hasDiag) {                                       // (P)
        fails.push({reason: 'nohinge', rot: rot, blockers: []});
        continue;
      }
      var b90 = occupied(occ, src, rot.swept90);                         // (S): dst is swept
      if (b90.length) {
        fails.push({reason: 'blocked', rot: rot, blockers: b90});        // swept90 within swept180
        continue;
      }
      var dst90 = add(src, rot.dst90);
      if (holds(occ, dst90, srcKey)) {                                   // (C): lands holding on
        return {ok: true, move: makeMove(src, rot, 1, hasAnchor ? rot.anchor : rot.dst180)};
      }
      // It would hang on its hinge's corner alone, so the diagonal is empty and the anchor is
      // the hinge: roll on around the corner.  That sweep is always clear here, because every
      // cell the half turn sweeps beyond the quarter turn touches the 90-degree cell (the
      // selftest checks the table), so an occupied one would have made the cube hold there.
      return {ok: true, move: makeMove(src, rot, 2, rot.anchor)};
    }
    var hinged = fails.filter(function (f) { return f.reason !== 'nohinge'; });
    if (!hinged.length) return {ok: false, reason: 'nohinge', blockers: [], hinge: null};
    var seen = new Set();
    var blockers = [];
    var hinges = [];
    hinged.forEach(function (f) {
      f.blockers.forEach(function (c) {
        var k = key(c[0], c[1]);
        if (!seen.has(k)) { seen.add(k); blockers.push(c); }
      });
      [f.rot.anchor, f.rot.dst180].forEach(function (rel) {
        var c = add(src, rel);
        if (occ.has(key(c[0], c[1]))) hinges.push(c);
      });
    });
    var first = hinged[0];
    return {
      ok: false,
      reason: first.reason,
      blockers: blockers,
      anchors: hinges,
      ghost: first.ghost || null,
      hinge: {corner: add(src, first.rot.corner), sense: first.rot.sense},
    };
  }

  /**
   * The move a drag of the cube at `src` in direction `dir` ('L','R','U','D') produces:
   * {ok:true, move} or {ok:false, reason, blockers, ...} with reason one of
   * 'cut' | 'nohinge' | 'blocked'.  `move.anchor` is the hinge cube, edge or diagonal.
   */
  function rollMove(occ, src, dir) {
    var k = key(src[0], src[1]);
    if (!occ.has(k)) throw new Error('no cube at ' + k);
    return roll(occ, src, dir, isCutVertex(occ, k));
  }

  /** The game's move set: the union of rollMove over all cubes and directions. */
  function legalMoves(occ) {
    var out = [], cut = cutVertices(occ);
    occ.forEach(function (_v, k) {
      var src = parseKey(k);
      if (cut.has(k)) return;
      for (var d = 0; d < 4; d++) {
        var r = roll(occ, src, DIR_NAMES[d], false);
        if (r.ok) out.push(r.move);
      }
    });
    return out;
  }

  /** Copy of `cells` ([[x,y],...]) after `move`. */
  function applyMove(cells, move) {
    return cells.map(function (c) {
      return c[0] === move.src[0] && c[1] === move.src[1] ? [move.dst[0], move.dst[1]] : [c[0], c[1]];
    });
  }

  function occOf(cells) {
    var s = new Set();
    cells.forEach(function (c) { s.add(key(c[0], c[1])); });
    return s;
  }

  function normalize(cells) {
    var x0 = Infinity, y0 = Infinity;
    cells.forEach(function (c) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); });
    return cells.map(function (c) { return [c[0] - x0, c[1] - y0]; }).sort(cmpCell);
  }

  /** Translation-free shape key; two shapes match iff their keys are equal. */
  function normKey(cells) {
    return normalize(cells).map(function (c) { return c[0] + ',' + c[1]; }).join(';');
  }

  function moveSignature(m) {
    return [m.src, m.dst, m.corner, m.anchor, m.turns].join('|');
  }

  /** Direction ('L','R','U','D') whose drag produces `move` (the direction of its 90-degree step). */
  function dirOf(move) {
    var rel = [move.corner[0] - move.src[0], move.corner[1] - move.src[1]];
    var sense = move.turns > 0 ? 1 : -1;
    var rot = ROTATIONS.filter(function (r) {
      return r.corner[0] === rel[0] && r.corner[1] === rel[1] && r.sense === sense;
    })[0];
    for (var i = 0; i < DIR_NAMES.length; i++) {
      var v = DIRS[DIR_NAMES[i]];
      if (v[0] === rot.dst90[0] && v[1] === rot.dst90[1]) return DIR_NAMES[i];
    }
    return null;
  }

  return {
    MODEL: MODEL,
    ROTATIONS: ROTATIONS,
    ROLLS: ROLLS,
    DIRS: DIRS,
    DIR_NAMES: DIR_NAMES,
    key: key,
    parseKey: parseKey,
    components: components,
    isConnected: isConnected,
    isCutVertex: isCutVertex,
    cutVertices: cutVertices,
    looseCells: looseCells,
    rollMove: rollMove,
    legalMoves: legalMoves,
    applyMove: applyMove,
    occOf: occOf,
    normalize: normalize,
    normKey: normKey,
    moveSignature: moveSignature,
    dirOf: dirOf,
  };
});
