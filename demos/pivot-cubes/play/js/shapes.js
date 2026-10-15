/* Shapes and puzzles: seeded RNG, random, named, MNIST and Vicsek polyominoes, alignment,
 * scramble generator, challenge levels. */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(node ? require('./rules.js') : root.CubeRules, node ? require('./datasets.js') : root.CubeData);
  if (node) module.exports = api;
  else root.CubeShapes = api;
})(this, function (Rules, Data) {
  'use strict';

  var N_MIN = 10, N_MAX = 50;      // bestAlignment's histogram needs N_MAX <= HOFF (64)

  var key = Rules.key;
  var EDGE = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // --- seeded RNG (xmur3 string hash -> mulberry32) ------------------------------------------

  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rng(seed) { return mulberry32(xmur3(String(seed))()); }

  function randomSeed() {
    var words = ['amber', 'basil', 'cedar', 'delta', 'ember', 'fjord', 'glade', 'heron', 'iris',
      'juniper', 'kelp', 'lumen', 'maple', 'nova', 'opal', 'pine', 'quartz', 'reed', 'sage',
      'tide', 'umber', 'vale', 'willow', 'yarrow', 'zephyr'];
    var w = words[Math.floor(Math.random() * words.length)];
    return w + '-' + (100 + Math.floor(Math.random() * 900));
  }

  // --- shapes ----------------------------------------------------------------------------------

  /** Eden growth from (0,0).  gamma < 0 favours stringy shapes, gamma > 0 compact ones. */
  function randomPolyomino(n, rand, gamma) {
    var occ = new Set([key(0, 0)]);
    var cells = [[0, 0]];
    while (cells.length < n) {
      var front = new Map();
      cells.forEach(function (c) {
        EDGE.forEach(function (e) {
          var x = c[0] + e[0], y = c[1] + e[1], k = key(x, y);
          if (occ.has(k) || front.has(k)) return;
          var nb = 0;
          EDGE.forEach(function (f) { if (occ.has(key(x + f[0], y + f[1]))) nb++; });
          front.set(k, {c: [x, y], w: Math.exp(gamma * (nb - 1))});
        });
      });
      var list = Array.from(front.values());
      var total = list.reduce(function (s, f) { return s + f.w; }, 0);
      var r = rand() * total, pick = list[list.length - 1];
      for (var i = 0; i < list.length; i++) {
        r -= list[i].w;
        if (r <= 0) { pick = list[i]; break; }
      }
      occ.add(key(pick.c[0], pick.c[1]));
      cells.push(pick.c);
    }
    return Rules.normalize(cells);
  }

  function line(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push([i, 0]);
    return out;
  }

  function block(n) {
    var w = Math.ceil(Math.sqrt(n)), out = [];
    for (var i = 0; i < n; i++) out.push([i % w, Math.floor(i / w)]);
    return out;
  }

  function ell(n) {
    var a = Math.ceil(n / 2), out = [];
    for (var j = 0; j < a; j++) out.push([0, j]);
    for (var i = 1; i <= n - a; i++) out.push([i, 0]);
    return out;
  }

  function tee(n) {
    var h = 2 * Math.floor((n + 1) / 4) + 1, stem = n - h, out = [];
    var mid = (h - 1) / 2;
    for (var j = 0; j < stem; j++) out.push([mid, j]);
    for (var i = 0; i < h; i++) out.push([i, stem]);
    return out;
  }

  function plus(n) {
    var arms = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    var len = [0, 0, 0, 0], left = n - 1, a = 0;
    while (left > 0) { len[a % 4]++; a++; left--; }
    var out = [[0, 0]];
    arms.forEach(function (d, i) {
      for (var s = 1; s <= len[i]; s++) out.push([d[0] * s, d[1] * s]);
    });
    return out;
  }

  /** Port of cube.compaction.CanonSpec('diag', 2).lines: overlapping 2x2 blocks stepping (1,1). */
  function staircase(n) {
    var K = 2, seen = new Set(), out = [], k = 0;
    while (out.length < n) {
      var path = [];
      if (k === 0) {
        for (var j = 0; j < K; j++) for (var i = 0; i < K; i++) path.push([j % 2 === 0 ? i : K - 1 - i, j]);
      } else {
        for (var j2 = 0; j2 < K; j2++) path.push([k + K - 1, k + j2]);
        for (var i2 = K - 2; i2 >= 0; i2--) path.push([k + i2, k + K - 1]);
      }
      path.forEach(function (c) {
        var ck = key(c[0], c[1]);
        if (!seen.has(ck) && out.length < n) { seen.add(ck); out.push(c); }
      });
      k++;
    }
    return out;
  }

  function ringEven(n) {
    var s = n / 2 + 2, w = Math.ceil(s / 2), h = s - w, out = [];
    for (var x = 0; x < w; x++) for (var y = 0; y < h; y++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) out.push([x, y]);
    }
    return out;
  }

  function ring(n) {
    if (n < 8) {                       // too few cubes to close a loop: a U
      var u = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]];
      return u.slice(0, n);
    }
    if (n % 2 === 0) return ringEven(n);
    var r = ringEven(n - 1);
    return r.concat([[1, -1]]);
  }

  var NAMED = {
    line: {label: 'Line', make: line},
    block: {label: 'Block', make: block},
    L: {label: 'L', make: ell},
    T: {label: 'T', make: tee},
    plus: {label: 'Plus', make: plus},
    staircase: {label: 'Staircase', make: staircase},
    ring: {label: 'Ring', make: ring},
    random: {label: 'Random', make: null},
    mnist: {label: 'MNIST digit', make: null},
    vicsek: {label: 'Vicsek fractal', make: null},
  };

  /** opts.digit (0-9) picks the MNIST label; otherwise `rand` does. */
  function named(name, n, rand, opts) {
    rand = rand || Math.random;
    if (name === 'random') return randomPolyomino(n, rand, STRINGY);
    if (name === 'mnist') {
      var d = opts ? Number(opts.digit) : NaN;
      if (!(opts && opts.digit !== null && opts.digit !== '' && d >= 0 && d <= 9 && d === Math.floor(d))) d = Math.floor(rand() * 10);
      return mnistCells(d, Math.floor(rand() * MNIST_PER_DIGIT), n);
    }
    if (name === 'vicsek') return vicsekCells(n, rand);
    return Rules.normalize(NAMED[name].make(n));
  }

  // --- MNIST -----------------------------------------------------------------------------------
  //
  // spheres/datagen/mnistgen grows an n-pixel region on the 28x28 image, brightest pixel first.
  // At n <= 30 that would be a fragment of one stroke, so the image is first area-averaged onto
  // a coarser grid whose ink count (cells at >= MNIST_TAU of full intensity) is closest to n,
  // and the same grow then runs on that grid: heap key (background?, -intensity,
  // distance-to-ink, row, col), so leftover cells wrap the digit as a tight skin.

  var MNIST_SIZE = Data ? Data.mnist.size : 28;
  var MNIST_PER_DIGIT = Data ? Data.mnist.perDigit : 0;
  var MNIST_TAU = 0.45;
  var mnistImages = {}, mnistShapes = {};

  function decodeBase64(b64) {
    if (typeof atob === 'function') {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  /** The idx-th training image of `label` as 28*28 floats in [0,1], row 0 at the top. */
  function mnistImage(label, idx) {
    var k = label + ':' + idx;
    if (!mnistImages[k]) {
      var raw = decodeBase64(Data.mnist.images[label][idx]), img = new Float64Array(raw.length);
      for (var i = 0; i < raw.length; i++) img[i] = raw[i] / 255;
      mnistImages[k] = img;
    }
    return mnistImages[k];
  }

  /** Area-average the ink bounding box onto a grid with `g` cells along its long side. */
  function coarsen(img, g) {
    var S = MNIST_SIZE, r0 = S, r1 = -1, c0 = S, c1 = -1, r, c;
    for (r = 0; r < S; r++) for (c = 0; c < S; c++) {
      if (img[r * S + c] > 0) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    }
    var H = r1 - r0 + 1, W = c1 - c0 + 1, s = Math.max(H, W) / g;
    var gh = Math.max(1, Math.round(H / s)), gw = Math.max(1, Math.round(W / s));
    var oy = r0 - (gh * s - H) / 2, ox = c0 - (gw * s - W) / 2;
    var v = new Float64Array(gh * gw);
    for (var i = 0; i < gh; i++) for (var j = 0; j < gw; j++) {
      var y0 = oy + i * s, y1 = y0 + s, x0 = ox + j * s, x1 = x0 + s, acc = 0;
      for (r = Math.max(0, Math.floor(y0)); r < Math.min(S, Math.ceil(y1)); r++) {
        var fy = Math.min(y1, r + 1) - Math.max(y0, r);
        if (fy <= 0) continue;
        for (c = Math.max(0, Math.floor(x0)); c < Math.min(S, Math.ceil(x1)); c++) {
          var fx = Math.min(x1, c + 1) - Math.max(x0, c);
          if (fx > 0) acc += img[r * S + c] * fx * fy;
        }
      }
      v[i * gw + j] = acc / (s * s);
    }
    return {v: v, h: gh, w: gw};
  }

  /** mnistgen.square_cells on a grid (padded so the skin can wrap): n cells, y-flipped. */
  function growRegion(grid, n) {
    var pad = 2, h = grid.h + 2 * pad, w = grid.w + 2 * pad, k, q;
    var v = new Float64Array(h * w);
    for (var i = 0; i < grid.h; i++) for (var j = 0; j < grid.w; j++) v[(i + pad) * w + j + pad] = grid.v[i * grid.w + j];
    var ink = [];
    for (k = 0; k < h * w; k++) if (v[k] > 0) ink.push(k);
    var dist = new Float64Array(h * w);
    for (k = 0; k < h * w; k++) {
      if (v[k] > 0) continue;
      var best = Infinity, y = Math.floor(k / w), x = k % w;
      for (q = 0; q < ink.length; q++) {
        var dy = Math.floor(ink[q] / w) - y, dx = ink[q] % w - x;
        best = Math.min(best, dy * dy + dx * dx);
      }
      dist[k] = Math.sqrt(best);
    }
    var keyOf = function (k) { return [v[k] > 0 ? 0 : 1, -v[k], dist[k], Math.floor(k / w), k % w]; };
    var less = function (a, b) {
      for (var t = 0; t < a.length; t++) if (a[t] !== b[t]) return a[t] < b[t];
      return false;
    };
    var start = 0;
    for (k = 1; k < h * w; k++) if (v[k] > v[start]) start = k;
    var sel = new Set([start]), front = new Set();
    var push = function (k) {
      var y = Math.floor(k / w), x = k % w;
      EDGE.forEach(function (e) {
        var ny = y + e[1], nx = x + e[0];
        if (ny >= 0 && ny < h && nx >= 0 && nx < w && !sel.has(ny * w + nx)) front.add(ny * w + nx);
      });
    };
    push(start);
    while (sel.size < n && front.size) {
      var pick = null, pickKey = null;
      front.forEach(function (k) {
        var kk = keyOf(k);
        if (pick === null || less(kk, pickKey)) { pick = k; pickKey = kk; }
      });
      front.delete(pick);
      sel.add(pick);
      push(pick);
    }
    var out = [];
    sel.forEach(function (k) { out.push([k % w, h - 1 - Math.floor(k / w)]); });
    return out;
  }

  /** MNIST digit `label` (training image `idx`) as a connected shape of exactly n cells. */
  function mnistCells(label, idx, n) {
    var k = label + ':' + idx + ':' + n;
    if (!mnistShapes[k]) {
      var img = mnistImage(label, idx), best = null;
      for (var g = 2; g <= MNIST_SIZE; g++) {
        var grid = coarsen(img, g), ink = 0;
        for (var i = 0; i < grid.v.length; i++) if (grid.v[i] >= MNIST_TAU) ink++;
        var miss = Math.abs(ink - n);
        if (!best || miss <= best.miss) best = {miss: miss, grid: grid};   // ties: finer grid
        if (ink > 2 * n) break;
      }
      mnistShapes[k] = Rules.normalize(growRegion(best.grid, n));
    }
    return mnistShapes[k].map(function (c) { return c.slice(); });
  }

  // --- Vicsek fractals -------------------------------------------------------------------------
  //
  // Vicsek fractals from spheres/datagen/vicsekgen, shipped in datasets.js: the incomplete
  // level-2 family with its default single dropped branch per node (n = 16) and the complete
  // level-2 cross (n = 25).  n <= 20 starts from a random 16-cell shape, larger n from the
  // cross; either is turned by a random lattice symmetry and adjusted by a few cells: concave
  // pockets nearest the centre are filled first, the outermost arm tips trimmed first.

  var SYMMETRIES = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0],
    [-1, 0, 0, 1], [1, 0, 0, -1], [0, 1, 1, 0], [0, -1, -1, 0]];

  function neighbourCount(occ, x, y) {
    var nb = 0;
    EDGE.forEach(function (e) { if (occ.has(key(x + e[0], y + e[1]))) nb++; });
    return nb;
  }

  function vicsekCells(n, rand) {
    rand = rand || Math.random;
    var fam = Data.vicsek.filter(function (f) { return f.n === (n <= 20 ? 16 : 25); })[0];
    var m = SYMMETRIES[Math.floor(rand() * 8)];
    var cells = fam.shapes[Math.floor(rand() * fam.shapes.length)].map(function (c) {
      return [m[0] * c[0] + m[1] * c[1], m[2] * c[0] + m[3] * c[1]];
    });
    var occ = Rules.occOf(cells), tie = new Map();
    var jitter = function (k) { if (!tie.has(k)) tie.set(k, rand()); return tie.get(k); };
    while (cells.length !== n) {
      var cen = centroid(cells), best = null, bestKey = null;
      var consider = function (x, y, keyArr) {
        if (best === null || lexGreater(keyArr, bestKey)) { best = [x, y]; bestKey = keyArr; }
      };
      if (cells.length < n) {                       // fill: most neighbours, nearest the centre
        cells.forEach(function (c) {
          EDGE.forEach(function (e) {
            var x = c[0] + e[0], y = c[1] + e[1], k = key(x, y);
            if (occ.has(k)) return;
            var d = (x - cen[0]) * (x - cen[0]) + (y - cen[1]) * (y - cen[1]);
            consider(x, y, [neighbourCount(occ, x, y), -d, jitter(k)]);
          });
        });
        cells.push(best);
        occ.add(key(best[0], best[1]));
      } else {                                      // trim: fewest neighbours, farthest out
        var cut = Rules.cutVertices(occ);
        cells.forEach(function (c) {
          var k = key(c[0], c[1]);
          if (cut.has(k)) return;
          var d = (c[0] - cen[0]) * (c[0] - cen[0]) + (c[1] - cen[1]) * (c[1] - cen[1]);
          consider(c[0], c[1], [-neighbourCount(occ, c[0], c[1]), d, jitter(k)]);
        });
        occ.delete(key(best[0], best[1]));
        cells = cells.filter(function (c) { return c[0] !== best[0] || c[1] !== best[1]; });
      }
    }
    return Rules.normalize(cells);
  }

  // --- alignment -------------------------------------------------------------------------------

  function centroid(cells) {
    var x = 0, y = 0;
    cells.forEach(function (c) { x += c[0]; y += c[1]; });
    return [x / cells.length, y / cells.length];
  }

  /**
   * The translation t maximising |cur ∩ (tgt + t)|, via the histogram of pairwise differences.
   * Ties keep `prevT` (so an overlay doesn't jitter), then prefer the translation that centres
   * tgt on cur.  Returns {t: [dx, dy], matched}.
   */
  // Histogram of pairwise differences, indexed after shifting both shapes to their min corner
  // (so differences stay within +-HOFF for any shape of up to HOFF cells).
  var HOFF = 64, HSIZE = 2 * HOFF;
  var hist = new Int32Array(HSIZE * HSIZE);

  function minCorner(cells) {
    var x0 = Infinity, y0 = Infinity;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][0] < x0) x0 = cells[i][0];
      if (cells[i][1] < y0) y0 = cells[i][1];
    }
    return [x0, y0];
  }

  function bestAlignment(cur, tgt, prevT) {
    var oc = minCorner(cur), og = minCorner(tgt);
    var ox = oc[0] - og[0], oy = oc[1] - og[1];     // t = local difference + (ox, oy)
    var touched = [], best = 0, i, j;
    for (i = 0; i < cur.length; i++) {
      var cx = cur[i][0] - oc[0] + HOFF, cy = cur[i][1] - oc[1] + HOFF;
      for (j = 0; j < tgt.length; j++) {
        var idx = (cx - (tgt[j][0] - og[0])) * HSIZE + (cy - (tgt[j][1] - og[1]));
        var v = ++hist[idx];
        if (v === 1) touched.push(idx);
        if (v > best) best = v;
      }
    }
    var tops = [];
    for (i = 0; i < touched.length; i++) {
      if (hist[touched[i]] === best) {
        tops.push([Math.floor(touched[i] / HSIZE) - HOFF + ox, (touched[i] % HSIZE) - HOFF + oy]);
      }
      hist[touched[i]] = 0;
    }
    if (prevT) {
      for (i = 0; i < tops.length; i++) {
        if (tops[i][0] === prevT[0] && tops[i][1] === prevT[1]) return {t: [prevT[0], prevT[1]], matched: best};
      }
    }
    var cc = centroid(cur), tc = centroid(tgt), pick = null, pickD = Infinity;
    tops.forEach(function (t) {
      var dx = tc[0] + t[0] - cc[0], dy = tc[1] + t[1] - cc[1], d = dx * dx + dy * dy;
      if (d < pickD - 1e-9 || (Math.abs(d - pickD) <= 1e-9 && (t[0] < pick[0] || (t[0] === pick[0] && t[1] < pick[1])))) {
        pick = t;
        pickD = d;
      }
    });
    return {t: pick, matched: best};
  }

  // --- scramble --------------------------------------------------------------------------------

  var STRINGY = -0.8;              // Eden growth bias of every random shape (stringy, not compact)

  function lexGreater(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }

  /**
   * Best overlap of a walking shape with a fixed one, kept incrementally: the histogram of
   * pairwise differences (`bestAlignment`'s) plus how many bins hold each count, so the effect of
   * one candidate pivot costs O(n) instead of O(n^2).  `matched` equals
   * bestAlignment(cells, fixed).matched at all times.
   */
  function OverlapTracker(fixed, cells) {
    this.fixed = fixed;
    this.bins = new Map();
    this.freq = new Int32Array(fixed.length + 2);
    this.matched = 0;
    var self = this;
    cells.forEach(function (c) { self._add(c, 1); });
  }

  OverlapTracker.prototype._bump = function (b, delta) {
    var old = this.bins.get(b) || 0, now = old + delta;
    if (old > 0) this.freq[old]--;
    if (now > 0) { this.freq[now]++; this.bins.set(b, now); } else this.bins.delete(b);
    if (now > this.matched) this.matched = now;
    while (this.matched > 0 && this.freq[this.matched] === 0) this.matched--;
  };

  OverlapTracker.prototype._add = function (c, delta) {
    for (var i = 0; i < this.fixed.length; i++) {
      this._bump((c[0] - this.fixed[i][0] + 1024) * 4096 + (c[1] - this.fixed[i][1] + 1024), delta);
    }
  };

  OverlapTracker.prototype.apply = function (m) { this._add(m.src, -1); this._add(m.dst, 1); };

  /** `matched` after pivot m, leaving the tracker unchanged. */
  OverlapTracker.prototype.matchedAfter = function (m) {
    this.apply(m);
    var out = this.matched;
    this._add(m.dst, -1);
    this._add(m.src, 1);
    return out;
  };

  /** Move `m` translated by (dx, dy). */
  function shiftMove(m, dx, dy) {
    var s = function (c) { return [c[0] + dx, c[1] + dy]; };
    return {src: s(m.src), dst: s(m.dst), corner: s(m.corner), anchor: s(m.anchor), swept: m.swept.map(s), turns: m.turns};
  }

  /**
   * The drag that undoes pivot `m` on `cells` (the shape just after m): the roll from m.dst about
   * the same corner in the opposite sense, as rollMove gives it, so a replay of the path reproduces
   * it exactly.  Every pivot has one under the rule; null would mean it did not.
   */
  function reverseOf(cells, m) {
    var dir = Rules.dirOf({src: m.dst, corner: m.corner, turns: -m.turns});
    var r = dir ? Rules.rollMove(Rules.occOf(cells), m.dst, dir) : null;
    if (!r || !r.ok) return null;
    var b = r.move;
    return b.dst[0] === m.src[0] && b.dst[1] === m.src[1] && b.corner[0] === m.corner[0] &&
      b.corner[1] === m.corner[1] && b.turns === -m.turns ? b : null;
  }

  /**
   * A random walk of up to k legal pivots from `cells` that leans away from the fixed shape `away`
   * and never enters a shape whose normKey is in `visited` (the walk adds its own).  Each step also
   * records the drag move that undoes it.  Returns {cells, moves, undo, matched}, `matched` being the
   * best overlap of the end shape with `away`.
   */
  function walk(cells, k, away, visited, rand) {
    var n = cells.length, overlap = new OverlapTracker(away, cells), moves = [], undo = [], lastDst = null;
    for (var step = 0; step < k; step++) {
      var cands = [];
      Rules.legalMoves(Rules.occOf(cells)).forEach(function (m) {
        var after = Rules.applyMove(cells, m), nk = Rules.normKey(after);
        if (visited.has(nk)) return;
        var diff = n - overlap.matchedAfter(m);
        var same = lastDst && m.src[0] === lastDst[0] && m.src[1] === lastDst[1] ? 1 : 0;
        cands.push({m: m, after: after, nk: nk, score: diff - 0.5 * same + 0.3 * rand()});
      });
      var top = Math.max.apply(null, cands.map(function (c) { return c.score; }));
      var ws = cands.map(function (c) { return Math.exp(1.5 * (c.score - top)); });
      var pick = null, back = null;
      while (cands.length && !pick) {      // sample by weight; a pick with no drag reverse is dropped
        var total = ws.reduce(function (a, b) { return a + b; }, 0);
        var r = rand() * total, i = cands.length - 1;
        for (var j = 0; j < cands.length; j++) {
          r -= ws[j];
          if (r <= 0) { i = j; break; }
        }
        back = reverseOf(cands[i].after, cands[i].m);
        if (back) pick = cands[i];
        else { cands.splice(i, 1); ws.splice(i, 1); }
      }
      if (!pick) break;
      cells = pick.after;
      overlap.apply(pick.m);
      visited.add(pick.nk);
      moves.push(pick.m);
      undo.push(back);
      lastDst = pick.m.dst;
    }
    return {cells: cells, moves: moves, undo: undo, matched: overlap.matched};
  }

  /**
   * A solvable puzzle, scrambled two ways: a random base shape, one walk of k/2 random legal
   * pivots from it to the start, and another of k - k/2 to the target.  Each walk leans away
   * from where it began (the first from the base, the second from the start), and the second
   * never enters a shape the first one passed through, so the two scramble differently and the
   * solution below never repeats a shape.  `path` is the first walk undone (drag reverses, in
   * reverse order) followed by the second walk, in start's coordinates; par = path.length
   * bounds the optimum from above.  Returns {start, target, path, par, diff, base, toBase}:
   * `base` in start's coordinates, reached after the first `toBase` moves of `path`.
   */
  function scramble(spec) {
    var n = spec.n, k = spec.k, k1 = Math.floor(k / 2);
    var rand = rng([spec.seed, n, k, Rules.MODEL].join('|'));
    var need = Math.max(2, Math.min(Math.ceil(k / 3), Math.ceil(n / 2)));
    var best = null;
    for (var attempt = 0; attempt < 20; attempt++) {
      var base = randomPolyomino(n, rand, STRINGY);
      if (Rules.legalMoves(Rules.occOf(base)).length < 3) continue;
      var visited = new Set([Rules.normKey(base)]);
      var toStart = walk(base, k1, base, visited, rand);
      var toTarget = walk(base, k - k1, toStart.cells, visited, rand);
      var o = minCorner(toStart.cells), dx = -o[0], dy = -o[1];
      var path = toStart.undo.slice().reverse().concat(toTarget.moves)
        .map(function (m) { return shiftMove(m, dx, dy); });
      var cand = {
        start: Rules.normalize(toStart.cells), target: Rules.normalize(toTarget.cells), path: path,
        par: path.length, diff: n - toTarget.matched, toBase: toStart.moves.length,
        base: base.map(function (c) { return [c[0] + dx, c[1] + dy]; }),
      };
      // Rank: walks of at least min(k, 3) moves first, then difference only up to `need`
      // (walks on small or tight shapes can saturate below it), then walk length, so a lucky short walk
      // never beats a long one of nearly equal spread.
      var rank = function (c) {
        return [c.par >= Math.min(k, 3) ? 1 : 0, Math.min(c.diff, need), c.par, c.diff];
      };
      if (!best || lexGreater(rank(cand), rank(best))) best = cand;
      // Accept a long walk that spreads far enough; after 5 attempts accept the best long walk
      // (walks on small or tight shapes can saturate below `need`; more attempts rarely help).
      if (best.par >= 0.8 * k && (best.diff >= need || attempt >= 4)) break;
    }
    if (!best) {                       // every base was rigid: fall back to a line, which always moves
      var ln = Rules.normalize(line(n));
      best = {start: ln, target: ln, path: [], par: 0, diff: 0, base: ln, toBase: 0};
    }
    return best;
  }

  // --- challenge levels ------------------------------------------------------------------------

  var CHALLENGES = [
    {id: 'easy', label: 'Easy', k: 30, solvable: true,
      blurb: 'One random shape scrambled two ways, 15 pivots each: one is the start, the other the target.'},
    {id: 'hard', label: 'Hard', k: 100, solvable: true,
      blurb: 'One random shape scrambled two ways, 50 pivots each: one is the start, the other the target.'},
    {id: 'mnist', label: 'MNIST', k: null, solvable: false,
      blurb: 'Morph one handwritten MNIST digit into another.'},
    {id: 'random', label: 'Random', k: null, solvable: false,
      blurb: 'Two independent random shapes.'},
  ];

  function challengeById(id) {
    return CHALLENGES.filter(function (c) { return c.id === id; })[0] || CHALLENGES[0];
  }

  /** A shape that can move at all (one with no legal pivot would be a dead puzzle). */
  function movable(cells) { return Rules.legalMoves(Rules.occOf(cells)).length > 0; }

  /**
   * The puzzle for a challenge level: {start, target, path, par, info}.  Deterministic in
   * (level, n, seed).  path/par are the scramble walk for easy/hard (par bounds
   * the optimum from above) and null for mnist/random, whose solvability is not checked.
   */
  function challenge(spec) {
    var c = challengeById(spec.level), n = spec.n;
    if (c.k) {
      var s = scramble({n: n, k: c.k, seed: spec.seed});
      return {start: s.start, target: s.target, path: s.path, par: s.par, info: {level: c.id, k: c.k}};
    }
    var rand = rng([c.id, spec.seed, n, Rules.MODEL].join('|'));
    var start, target, info = {level: c.id};
    for (var attempt = 0; attempt < 50; attempt++) {
      if (c.id === 'mnist') {
        var la = Math.floor(rand() * 10), lb = (la + 1 + Math.floor(rand() * 9)) % 10;
        var ia = Math.floor(rand() * MNIST_PER_DIGIT), ib = Math.floor(rand() * MNIST_PER_DIGIT);
        start = mnistCells(la, ia, n);
        target = mnistCells(lb, ib, n);
        info = {level: c.id, startDigit: la, targetDigit: lb, startIdx: ia, targetIdx: ib};
      } else {
        start = randomPolyomino(n, rand, STRINGY);
        target = randomPolyomino(n, rand, STRINGY);
      }
      if (Rules.normKey(start) !== Rules.normKey(target) && movable(start)) break;
    }
    return {start: start, target: Rules.normalize(target), path: null, par: null, info: info};
  }

  return {
    N_MIN: N_MIN,
    N_MAX: N_MAX,
    CHALLENGES: CHALLENGES,
    challenge: challenge,
    MNIST_PER_DIGIT: MNIST_PER_DIGIT,
    mnistCells: mnistCells,
    vicsekCells: vicsekCells,
    rng: rng,
    randomSeed: randomSeed,
    randomPolyomino: randomPolyomino,
    NAMED: NAMED,
    named: named,
    centroid: centroid,
    bestAlignment: bestAlignment,
    scramble: scramble,
  };
});
