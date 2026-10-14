// Small helpers shared by the sprite files (player-art.js, enemy-art.js).

// Drawing helpers for one Graphics. Positions and sizes are in "sprite metres", which `S` turns
// into drawing units. `pixel` (optional) is one low-res pixel in drawing units: given, shapes get
// a thin dark outline.
export function tools(g, S, pixel = 0) {
  return {
    seg: (ax, ay, bx, by, width, c, alpha = 1) =>
      g.moveTo(ax * S, ay * S).lineTo(bx * S, by * S).stroke({ width: width * S, color: c, alpha, cap: 'round' }),
    dot: (x, y, r, c, alpha = 1) => g.circle(x * S, y * S, r * S).fill({ color: c, alpha }),
    ell: (x, y, rx, ry, c, alpha = 1) => {
      g.ellipse(x * S, y * S, rx * S, ry * S).fill({ color: c, alpha });
      if (pixel) g.ellipse(x * S, y * S, rx * S, ry * S).stroke({ width: pixel, color: 0x000000, alpha: 0.5 });
    },
    // `rim` (optional) is { color, alpha } for an outline in another colour.
    poly: (pts, c, alpha = 1, rim) => {
      const flat = pts.flat().map((v) => v * S);
      g.poly(flat).fill({ color: c, alpha });
      if (rim) g.poly(flat).stroke({ width: pixel, color: rim.color, alpha: rim.alpha ?? 1 });
    },
  };
}

// Elbow position for an arm of two bones (`upper`, `fore` long) reaching from the shoulder to the
// hand. The elbow bends outward (away from the body's centre line, `side` is -1 or +1). Out of
// reach, the arm just straightens.
export function solveElbow(sx, sy, hx, hy, side, upper, fore) {
  const d = Math.hypot(hx - sx, hy - sy) || 0.001;
  const ux = (hx - sx) / d;
  const uy = (hy - sy) / d;
  const reach = Math.min(d, upper + fore - 0.001);
  const a = (upper * upper - fore * fore + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(upper * upper - a * a, 0));
  const e1 = [sx + ux * a - uy * h, sy + uy * a + ux * h];
  const e2 = [sx + ux * a + uy * h, sy + uy * a - ux * h];
  return e1[1] * side > e2[1] * side ? e1 : e2;
}
