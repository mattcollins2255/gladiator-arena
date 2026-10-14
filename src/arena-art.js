import { Container, Graphics } from 'pixi.js';
import { shade } from './colors.js';
import { SKIN, drawBloodPool, drawFallenBody, makeRng } from './gore.js';

// All the arena's scenery: a rough flagstone floor, stone walls, tiered crowd stands, pillars and
// fallen gladiators. It is drawn once, so none of it costs anything while playing, and it is pure
// decoration: the physics walls and pillars live in main.js. A fixed seed means the same arena
// every time.
//
// Everything below is drawn in metres (the containers are scaled up by `scale`), so line widths
// are `px`: one low-res pixel, in metres.

const TAU = Math.PI * 2;

const MORTAR = 0x1e1b18;
const FLOOR_STONES = [0x4d4842, 0x524c45, 0x464139, 0x554e46, 0x4a4545];
const WALL_STONE = 0x6f685f;
const STAND_STONE = 0x4a423a;
const CLOTHES = [0x7a3b34, 0x3b5a7a, 0x6f6a3a, 0x5a3b6f, 0x8a7a5a, 0x3f6b57];
const FALLEN = ['spearman', 'spearman', 'swordsman', 'archer']; // who is lying around (spearmen are common)
const FALLEN_COUNT = 30;
const CROWD_GROUPS = 6; // the crowd bobs in this many out-of-step groups
const CROWD_BOB = 1.6; // how far they bob, in low-res pixels
const CROWD_BOB_SPEED = 5; // rad/s for the slowest group (each faster group adds CROWD_BOB_SPREAD)
const CROWD_BOB_SPREAD = 0.6;

export function buildArenaArt({ layer, scale, width: W, height: H, wallThickness: WALL, standsDepth: STANDS, pixel, pillars, types, makeWeaponGfx }) {
  const rnd = makeRng(1337);
  const range = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const px = pixel / scale;

  const art = new Container(); // floor, walls, stands, blood and bodies
  art.scale.set(scale);
  const weapons = new Container(); // dropped weapons: drawn by main.js's weapon art, which is in pixels
  const columns = new Container(); // pillar tops
  columns.scale.set(scale);
  layer.addChild(art, weapons, columns);

  // A flat stone block with a lit top-left edge and a shaded bottom-right edge.
  function stoneRect(g, x, y, w, h, color) {
    g.rect(x + 0.03, y + 0.03, w - 0.06, h - 0.06).fill(shade(color, range(0.9, 1.1)));
    g.moveTo(x + 0.03, y + h - 0.03).lineTo(x + 0.03, y + 0.03).lineTo(x + w - 0.03, y + 0.03)
      .stroke({ width: px, color: 0xffffff, alpha: 0.13 });
    g.moveTo(x + w - 0.03, y + 0.03).lineTo(x + w - 0.03, y + h - 0.03).lineTo(x + 0.03, y + h - 0.03)
      .stroke({ width: px, color: 0x000000, alpha: 0.25 });
  }

  // ---------- Stands ----------
  // Terraces are nested rectangles, outermost first, getting darker with distance. A crowd of
  // heads and shoulders is scattered along each one.
  const stands = new Graphics();
  for (let k = STANDS; k >= 1; k--) {
    const e = WALL + k;
    stands.rect(-e, -e, W + 2 * e, H + 2 * e).fill(shade(STAND_STONE, 0.85 - 0.11 * (k - 1)));
    stands.rect(-e, -e, W + 2 * e, H + 2 * e).stroke({ width: px * 1.5, color: 0x000000, alpha: 0.35 });
  }
  art.addChild(stands);

  // The crowd is split into a few groups. Each is drawn once and then bobbed as a whole (see
  // `update` below), so the animation costs almost nothing.
  const crowdGroups = Array.from({ length: CROWD_GROUPS }, () => new Graphics());
  let person = 0;
  for (let k = 1; k <= STANDS; k++) {
    const e = WALL + k - 0.5;
    const dim = 0.85 - 0.12 * (k - 1);
    const sides = [ // [start x, start y, step x, step y, length]
      [-e, -e, 1, 0, W + 2 * e],
      [W + e, -e, 0, 1, H + 2 * e],
      [W + e, H + e, -1, 0, W + 2 * e],
      [-e, H + e, 0, -1, H + 2 * e],
    ];
    for (const [sx, sy, dx, dy, len] of sides) {
      for (let d = 0; d < len; d += 0.55) {
        if (rnd() < 0.28) continue; // gaps in the crowd
        const x = sx + dx * d + range(-0.12, 0.12);
        const y = sy + dy * d + range(-0.12, 0.12);
        // Which group a person is in comes from a formula, not from rnd(), so adding the
        // animation didn't change the random layout of everything drawn after it.
        const scatter = Math.sin(person++ * 12.9898) * 43758.5453;
        const group = crowdGroups[Math.floor((scatter - Math.floor(scatter)) * CROWD_GROUPS)];
        group.circle(x, y, 0.27).fill(shade(pick(CLOTHES), dim));
        group.circle(x, y, 0.14).fill(shade(pick(SKIN), dim));
      }
    }
  }
  art.addChild(...crowdGroups);

  // ---------- Floor ----------
  // Irregular slabs in staggered rows over dark mortar. Each corner is nudged a little so the
  // joints are uneven, then chips, specks, cracks and dust are scattered on top.
  const floor = new Graphics();
  floor.rect(0, 0, W, H).fill(MORTAR);
  const clampX = (x) => Math.max(0, Math.min(W, x));
  const clampY = (y) => Math.max(0, Math.min(H, y));
  const slab = (x0, y0, x1, y1) => {
    const i = 0.04;
    const j = () => range(-0.07, 0.07);
    const p = [
      [x0 + i + j(), y0 + i + j()], [x1 - i + j(), y0 + i + j()],
      [x1 - i + j(), y1 - i + j()], [x0 + i + j(), y1 - i + j()],
    ].map(([x, y]) => [clampX(x), clampY(y)]);
    floor.poly(p.flat()).fill(shade(pick(FLOOR_STONES), range(0.88, 1.12)));
    floor.moveTo(...p[3]).lineTo(...p[0]).lineTo(...p[1]).stroke({ width: px, color: 0xffffff, alpha: 0.1 });
    floor.moveTo(...p[1]).lineTo(...p[2]).lineTo(...p[3]).stroke({ width: px, color: 0x000000, alpha: 0.25 });
  };
  for (let y = 0; y < H; ) {
    let rowH = range(1.3, 2.1);
    if (H - y - rowH < 0.8) rowH = H - y;
    for (let x = -range(0, 2); x < W; ) {
      let w = range(1.2, 2.8);
      if (W - (x + w) < 0.8) w = W - x;
      slab(Math.max(0, x), y, Math.min(W, x + w), y + rowH);
      x += w;
    }
    y += rowH;
  }

  const specks = (color, alpha, n) => {
    for (let i = 0; i < n; i++) floor.rect(range(0, W), range(0, H), px * range(1, 2), px * range(1, 2));
    floor.fill({ color, alpha });
  };
  specks(0xffffff, 0.14, 1100);
  specks(0x000000, 0.3, 1100);

  for (let i = 0; i < 28; i++) { // cracks, each wandering from a random start
    let x = range(0, W);
    let y = range(0, H);
    let a = range(0, TAU);
    floor.moveTo(x, y);
    for (let s = 0, n = 4 + Math.floor(rnd() * 4); s < n; s++) {
      a += range(-0.7, 0.7);
      x += Math.cos(a) * range(0.3, 0.8);
      y += Math.sin(a) * range(0.3, 0.8);
      floor.lineTo(x, y);
    }
  }
  floor.stroke({ width: px, color: 0x14110f, alpha: 0.6 });

  for (let i = 0; i < 14; i++) { // dust, in three nested rings so it has steps rather than a soft blur
    const x = range(0, W);
    const y = range(0, H);
    const r = range(1.5, 3.5);
    for (const f of [1, 0.65, 0.3]) floor.ellipse(x, y, r * f, r * f * 0.7).fill({ color: 0xb59f78, alpha: 0.06 });
  }

  for (let i = 0; i < 50; i++) { // rubble: little shards of broken stone
    const x = range(0.3, W - 0.3);
    const y = range(0.3, H - 0.3);
    const r = range(0.08, 0.2);
    const a = range(0, TAU);
    const shard = [0, 0.9, 2.4].map((o) => [x + Math.cos(a + o) * r * range(0.7, 1.2), y + Math.sin(a + o) * r * range(0.7, 1.2)]);
    floor.poly(shard.flat()).fill(shade(pick(FLOOR_STONES), 1.35));
    floor.poly(shard.map(([sx, sy]) => [sx + 0.05, sy + 0.05]).flat()).fill({ color: 0x000000, alpha: 0.25 });
  }

  // The walls cast a soft shadow onto the floor along each edge.
  for (const wd of [1.2, 0.9, 0.6, 0.3]) {
    floor.rect(0, 0, W, wd).fill({ color: 0x000000, alpha: 0.09 });
    floor.rect(0, H - wd, W, wd).fill({ color: 0x000000, alpha: 0.09 });
    floor.rect(0, 0, wd, H).fill({ color: 0x000000, alpha: 0.09 });
    floor.rect(W - wd, 0, wd, H).fill({ color: 0x000000, alpha: 0.09 });
  }
  for (const p of pillars) floor.ellipse(p.x + 0.35, p.y + 0.4, 1.05, 1).fill({ color: 0x000000, alpha: 0.3 });
  art.addChild(floor);

  // ---------- Walls ----------
  // Two courses of blocks, the second course staggered. The top and bottom walls run the full
  // width and the side walls fit between them, so the corners aren't drawn twice.
  const walls = new Graphics();
  const wallBlocks = (x0, y0, x1, y1) => {
    const horizontal = x1 - x0 > y1 - y0;
    const [aLo, aHi, bLo] = horizontal ? [x0, x1, y0] : [y0, y1, x0];
    const course = WALL / 2;
    walls.rect(x0, y0, x1 - x0, y1 - y0).fill(MORTAR);
    for (let c = 0; c < 2; c++) {
      const b = bLo + c * course;
      for (let a = aLo - (c ? range(0, 1.2) : 0); a < aHi; ) {
        const len = range(1.3, 2.5);
        const lo = Math.max(a, aLo);
        const hi = Math.min(a + len, aHi);
        if (horizontal) stoneRect(walls, lo, b, hi - lo, course, WALL_STONE);
        else stoneRect(walls, b, lo, course, hi - lo, WALL_STONE);
        a += len;
      }
    }
  };
  wallBlocks(-WALL, -WALL, W + WALL, 0);
  wallBlocks(-WALL, H, W + WALL, H + WALL);
  wallBlocks(-WALL, 0, 0, H);
  wallBlocks(W, 0, W + WALL, H);
  // A dark drop where the wall meets the floor.
  walls.rect(-0.06, -0.06, W + 0.12, H + 0.12).stroke({ width: 0.12, color: 0x24211e });
  art.addChild(walls);

  // ---------- Fallen gladiators ----------
  // Placed in a few loose heaps. Kept clear of the middle (where the player starts) and of the
  // pillars.
  const spots = [];
  for (let tries = 0; spots.length < FALLEN_COUNT && tries < 800; tries++) {
    let x;
    let y;
    if (spots.length && rnd() < 0.55) { // next to an earlier body, so they pile up
      const o = pick(spots);
      const a = range(0, TAU);
      const d = range(0.9, 1.6);
      x = o.x + Math.cos(a) * d;
      y = o.y + Math.sin(a) * d;
    } else {
      x = range(0.8, W - 0.8);
      y = range(0.8, H - 0.8);
    }
    if (x < 0.7 || x > W - 0.7 || y < 0.7 || y > H - 0.7) continue;
    if (Math.hypot(x - W / 2, y - H / 2) < 3.5) continue;
    if (pillars.some((p) => Math.hypot(p.x - x, p.y - y) < 1.9)) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < 0.85)) continue;
    spots.push({ x, y, ang: range(0, TAU), typeName: pick(FALLEN) });
  }

  const blood = new Graphics();
  for (const s of spots) drawBloodPool(blood, s.x, s.y, rnd, px);
  art.addChild(blood);

  const bodies = new Graphics();
  for (const s of spots) drawFallenBody(bodies, s.x, s.y, s.ang, types[s.typeName], rnd, px);
  art.addChild(bodies);

  // Dropped weapons are drawn by main.js's own weapon art, darkened and dulled.
  for (const s of spots) {
    if (rnd() < 0.4) continue;
    const g = makeWeaponGfx(types[s.typeName]);
    const a = range(0, TAU);
    const d = range(0.5, 1.1);
    g.position.set((s.x + Math.cos(a) * d) * scale, (s.y + Math.sin(a) * d) * scale);
    g.rotation = range(0, TAU);
    g.tint = 0x8a8680;
    weapons.addChild(g);
  }

  // ---------- Pillars ----------
  // Seen from above: a round column top with fluting and a lit upper-left edge.
  const tops = new Graphics();
  for (const p of pillars) {
    tops.circle(p.x, p.y, 1).fill(0x38342f);
    tops.circle(p.x, p.y, 0.92).fill(0x6a645b);
    tops.circle(p.x, p.y, 0.7).fill(0x7a746a);
    tops.circle(p.x, p.y, 0.5).fill(0x6a645b);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      tops.moveTo(p.x + Math.cos(a) * 0.52, p.y + Math.sin(a) * 0.52).lineTo(p.x + Math.cos(a) * 0.68, p.y + Math.sin(a) * 0.68);
    }
    tops.stroke({ width: px, color: 0x000000, alpha: 0.25 });
    tops.moveTo(p.x + Math.cos(-2.9) * 0.82, p.y + Math.sin(-2.9) * 0.82).arc(p.x, p.y, 0.82, -2.9, -1.6)
      .stroke({ width: px * 1.5, color: 0xa09a8e, alpha: 0.6 });
    tops.circle(p.x, p.y, 0.12).fill(0x3d3934);
  }
  columns.addChild(tops);

  return {
    // Call every frame with the time in seconds. The crowd bobs up and down, each group at its
    // own pace, in whole low-res pixels so it matches the rest of the pixel art.
    update(seconds) {
      crowdGroups.forEach((group, i) => {
        const bob = Math.sin(seconds * (CROWD_BOB_SPEED + i * CROWD_BOB_SPREAD) + i * 1.9);
        group.y = Math.round(bob * CROWD_BOB) * px;
      });
    },
  };
}
