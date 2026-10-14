import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import { shade } from './colors.js';

// Blood and bodies. This file draws them two ways:
//   - the arena's starting corpses (arena-art.js) use drawBloodPool / drawFallenBody directly;
//   - during play, createGore keeps a floor-sized texture that stains and fresh corpses are
//     painted onto. Painting is a one-off cost, so a floor covered in gore costs nothing extra to
//     draw each frame, however much piles up.
//
// All shapes are in metres. `rnd` is a random function (0..1), so the arena can pass its seeded one.

const TAU = Math.PI * 2;

// A random function (0..1) that gives the same sequence for the same seed.
export function makeRng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SKIN = [0xc99a7a, 0xa87a5a, 0x8a5a3e, 0xd8b08c];
export const BLOOD = 0x4f1613; // dried
export const BLOOD_FRESH = 0x6b1d18;

// A pool of blood with splatter and sometimes a drag mark, centred near (x, y).
export function drawBloodPool(g, x, y, rnd, px) {
  const range = (a, b) => a + rnd() * (b - a);
  const size = range(0.8, 1.4);
  const cx = x + range(-0.2, 0.2);
  const cy = y + range(-0.2, 0.2);
  for (let i = 0; i < 5; i++) {
    g.circle(cx + range(-0.4, 0.4) * size, cy + range(-0.4, 0.4) * size, range(0.3, 0.6) * size).fill({ color: BLOOD, alpha: 0.92 });
  }
  for (let i = 0; i < 3; i++) {
    g.circle(cx + range(-0.25, 0.25) * size, cy + range(-0.25, 0.25) * size, range(0.15, 0.3) * size).fill({ color: BLOOD_FRESH, alpha: 0.9 });
  }
  for (let i = 0; i < 9; i++) { // splatter
    const a = range(0, TAU);
    const d = range(0.8, 1.7);
    g.rect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, px * range(1, 2.5), px * range(1, 2.5)).fill({ color: BLOOD, alpha: 0.9 });
  }
  if (rnd() < 0.4) { // a smear where it was dragged
    const a = range(0, TAU);
    for (let i = 1; i <= 6; i++) g.circle(cx + Math.cos(a) * i * 0.25, cy + Math.sin(a) * i * 0.25, 0.2 - i * 0.02).fill({ color: BLOOD, alpha: 0.9 });
  }
}

// Drawing in a fighter's own frame: (u, v) is u metres forward and v metres to its right, where
// `ang` is the way it faces. `px` is one low-res pixel in metres.
function frame(g, x, y, ang, px) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const flat = (pts) => pts.flatMap(([u, v]) => [x + c * u - s * v, y + s * u + c * v]);
  return {
    px,
    seg(u1, v1, u2, v2, w, col, a = 1) {
      const [ax, ay] = flat([[u1, v1]]);
      const [bx, by] = flat([[u2, v2]]);
      g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: w, color: col, alpha: a, cap: 'round' });
    },
    dot(u, v, r, col, a = 1) {
      const [cx, cy] = flat([[u, v]]);
      g.circle(cx, cy, r).fill({ color: col, alpha: a });
    },
    ell(u, v, ru, rv, col, a = 1) {
      const pts = flat(Array.from({ length: 16 }, (_, i) => [u + Math.cos((i / 16) * TAU) * ru, v + Math.sin((i / 16) * TAU) * rv]));
      g.poly(pts).fill({ color: col, alpha: a });
      g.poly(pts).stroke({ width: px, color: 0x000000, alpha: 0.4 });
    },
    poly(pts, col, a = 1, rim) {
      g.poly(flat(pts)).fill({ color: col, alpha: a });
      if (rim) g.poly(flat(pts)).stroke({ width: px, color: rim, alpha: 0.5 });
    },
  };
}

const BONE = 0xd2cbb0;
const RAW = 0x7a2f2a;

// Each of these lays out one kind of fighter's corpse: limbs flung out, the head, and the kit it
// died in. They take the `rnd` function so a given seed always gives the same corpse.

// Spearman: a grey, withered walking corpse in cracked leather.
function zombieCorpse(f, type, rnd) {
  const range = (a, b) => a + rnd() * (b - a);
  const FLESH = 0x7c8768;
  const FLESH_D = 0x5a6650;
  const k = 1.1;
  for (const side of [-1, 1]) {
    const a = side * range(1.5, 2.6); // an arm flung out, bone showing
    const u = Math.cos(a) * 0.7 * k;
    const v = Math.sin(a) * 0.7 * k;
    f.seg(0, 0, u, v, 0.11 * k, FLESH);
    f.seg(u * 0.45, v * 0.45, u * 0.8, v * 0.8, 0.03, BONE);
    f.dot(u, v, 0.06 * k, BONE);
    const l = Math.PI + side * range(0.2, 0.6); // a leg trailing, in rag trousers
    const lu = Math.cos(l) * 0.65 * k;
    const lv = Math.sin(l) * 0.65 * k;
    f.seg(0, 0, lu, lv, 0.14 * k, 0x4a4036);
    f.dot(lu, lv, 0.07 * k, FLESH_D);
  }
  f.ell(0, 0, 0.21 * k, 0.33 * k, 0x4a3320);
  f.ell(-0.08 * k, 0.07 * k, 0.07 * k, 0.1 * k, RAW);
  for (let i = 0; i < 3; i++) f.seg(-0.14 * k, (0.03 + i * 0.045) * k, -0.03 * k, (0.03 + i * 0.045) * k, f.px, BONE);
  for (const side of [-1, 1]) f.ell(0, side * 0.31 * k, 0.13 * k, 0.09 * k, 0x2e1f12);
  f.ell(0.26 * k, 0, 0.14 * k, 0.14 * k, FLESH);
  f.dot(0.24 * k, -0.03 * k, 0.055 * k, BONE);
  for (let i = 0; i < 3; i++) f.seg(0.17 * k, (-0.06 + i * 0.06) * k, 0.1 * k, (-0.07 + i * 0.07) * k, f.px, 0x2c2a24, 0.8);
  f.dot(0.26 * k, 0.15 * k, 0.03 * k, RAW);
}

// Swordsman: a black knight in a heap of plate, his torn cloak spread out under him.
function knightCorpse(f, type, rnd) {
  const range = (a, b) => a + rnd() * (b - a);
  const STEEL_D = 0x15151a;
  const STEEL = 0x1d1d23;
  const STEEL_L = 0x2a2a33;
  const RIM = 0x4a4a58;
  const k = 1.15;
  const sc = (pts) => pts.map(([u, v]) => [u * k, v * k]);
  f.poly(sc([[-0.1, -0.45], [-0.5, -0.62], [-0.78, -0.38], [-0.68, -0.1], [-0.88, 0.14], [-0.62, 0.5], [-0.3, 0.66], [-0.05, 0.45]]), 0x2a1216, 1, 0x5a4a7a);
  f.poly(sc([[-0.15, -0.3], [-0.5, -0.35], [-0.6, -0.1], [-0.5, 0.2], [-0.3, 0.4], [-0.1, 0.3]]), 0x3d1a20, 0.8);
  for (const side of [-1, 1]) {
    const a = side * range(1.5, 2.6); // armoured arms
    const u = Math.cos(a) * 0.75 * k;
    const v = Math.sin(a) * 0.75 * k;
    f.seg(0, 0, u, v, 0.17 * k, STEEL);
    f.dot(u, v, 0.08 * k, STEEL_L);
    const l = Math.PI + side * range(0.2, 0.6); // greaves
    const lu = Math.cos(l) * 0.8 * k;
    const lv = Math.sin(l) * 0.8 * k;
    f.seg(0, 0, lu, lv, 0.18 * k, STEEL_D);
    f.dot(lu * 0.5, lv * 0.5, 0.06 * k, RIM, 0.7);
  }
  f.ell(0, 0, 0.25 * k, 0.4 * k, STEEL);
  for (const u of [-0.1, 0, 0.1]) f.seg(u * k, -0.3 * k, u * k, 0.3 * k, f.px, RIM, 0.35);
  for (const side of [-1, 1]) {
    f.poly(sc([[-0.12, side * 0.44], [-0.02, side * 0.57], [0.08, side * 0.44]]), STEEL_L, 1, RIM);
    f.ell(0, side * 0.36 * k, 0.2 * k, 0.15 * k, STEEL_D);
  }
  for (const side of [-1, 1]) f.poly(sc([[0.3, side * 0.14], [0.1, side * 0.33], [0.2, side * 0.11]]), STEEL_L, 1, RIM); // horns
  f.ell(0.3 * k, 0, 0.19 * k, 0.16 * k, STEEL);
  f.seg(0.15 * k, 0, 0.47 * k, 0, 0.035 * k, STEEL_L);
  f.seg(0.44 * k, -0.08 * k, 0.44 * k, 0.08 * k, 0.035 * k, 0x000000);
}

// Archer: a scrawny goblin, ears splayed, quiver and arrows spilled beside it.
function goblinCorpse(f, type, rnd) {
  const range = (a, b) => a + rnd() * (b - a);
  const GOB = 0x7f9140;
  const GOB_D = 0x5d6d30;
  for (const side of [-1, 1]) {
    const a = side * range(1.5, 2.6); // long skinny arms
    const u = Math.cos(a) * 0.7;
    const v = Math.sin(a) * 0.7;
    f.seg(0, 0, u, v, 0.07, GOB);
    f.dot(u, v, 0.055, GOB_D);
    const l = Math.PI + side * range(0.2, 0.6);
    f.seg(0, 0, Math.cos(l) * 0.55, Math.sin(l) * 0.55, 0.07, GOB);
    f.dot(Math.cos(l) * 0.55, Math.sin(l) * 0.55, 0.05, GOB_D);
  }
  const q = rnd() < 0.5 ? -1 : 1; // the quiver, tipped out on one side
  f.poly([[-0.2, q * 0.3], [0.15, q * 0.3], [0.15, q * 0.39], [-0.2, q * 0.39]], 0x5a3d26, 1, 0x000000);
  for (let i = 0; i < 3; i++) {
    const a = range(-0.7, 0.7);
    const u = 0.15 + Math.cos(a) * 0.45;
    const v = q * 0.35 + Math.sin(a) * 0.45;
    f.seg(0.15, q * 0.35, u, v, f.px * 1.5, 0xcfc7b0);
    f.dot(u, v, f.px, 0x7a2a2a);
  }
  f.ell(0, 0, 0.15, 0.22, 0x5b5240);
  f.dot(-0.06, -0.06, 0.05, 0x3f382c, 0.8);
  for (const side of [-1, 1]) { // ears, splayed flat
    f.poly([[0.16, side * 0.14], [0.1, side * 0.46], [0.28, side * 0.15]], GOB_D, 1, 0x000000);
    f.poly([[0.17, side * 0.17], [0.13, side * 0.36], [0.24, side * 0.17]], 0xa88a72, 0.8);
  }
  f.ell(0.24, 0, 0.18, 0.17, GOB);
  f.dot(0.2, 0.08, 0.03, 0xc9c07a);
  f.dot(0.28, -0.09, 0.025, 0xc9c07a);
  f.dot(0.32, 0.07, 0.035, 0xa05a3a, 0.9);
  f.poly([[0.4, -0.045], [0.54, 0.005], [0.4, 0.05]], GOB_D, 1, 0x000000);
}

// The player's gladiator: teal tunic, bronze shoulder plates, bald head, leather wristbands.
function gladiatorCorpse(f, type, rnd) {
  const range = (a, b) => a + rnd() * (b - a);
  const SKIN_C = 0xb98a68;
  const LEATHER = 0x4a2e1c;
  const BRONZE = 0x7d6a4a;
  const k = 1.15;
  for (const side of [-1, 1]) {
    const a = side * range(1.5, 2.6); // bulky arms, with a leather wristband
    const u = Math.cos(a) * 0.75 * k;
    const v = Math.sin(a) * 0.75 * k;
    f.seg(0, 0, u, v, 0.17 * k, shade(SKIN_C, 0.85));
    f.seg(u * 0.78 + Math.sin(a) * 0.09, v * 0.78 - Math.cos(a) * 0.09, u * 0.78 - Math.sin(a) * 0.09, v * 0.78 + Math.cos(a) * 0.09, 0.06 * k, LEATHER);
    f.dot(u, v, 0.07 * k, shade(SKIN_C, 1.1));
    const l = Math.PI + side * range(0.2, 0.6);
    const lu = Math.cos(l) * 0.7 * k;
    const lv = Math.sin(l) * 0.7 * k;
    f.seg(0, 0, lu, lv, 0.16 * k, shade(SKIN_C, 0.8));
    f.dot(lu, lv, 0.07 * k, LEATHER);
  }
  f.ell(0, 0, 0.2 * k, 0.34 * k, shade(type.color, 0.6));
  f.seg(-0.1 * k, -0.28 * k, 0.1 * k, 0.28 * k, 0.05 * k, LEATHER);
  f.seg(-0.1 * k, 0.28 * k, 0.1 * k, -0.28 * k, 0.05 * k, LEATHER);
  for (const side of [-1, 1]) {
    f.ell(0, side * 0.3 * k, 0.17 * k, 0.12 * k, shade(BRONZE, 0.75));
    f.ell(0, side * 0.26 * k, 0.14 * k, 0.1 * k, BRONZE);
  }
  f.ell(0.27 * k, 0, 0.15 * k, 0.15 * k, shade(SKIN_C, 1.05));
  f.seg(0.2 * k, -0.1 * k, 0.32 * k, 0.06 * k, f.px, 0x7a3a30, 0.85);
}

const CORPSES = { zombie: zombieCorpse, knight: knightCorpse, goblin: goblinCorpse, gladiator: gladiatorCorpse };

// A fighter lying where it fell, facing `ang`: limbs flung out, the kit it died in (chosen by the
// type's `corpse` style), a wound, maybe an arrow.
export function drawFallenBody(g, x, y, ang, type, rnd, px) {
  const range = (a, b) => a + rnd() * (b - a);
  const f = frame(g, x, y, ang, px);
  (CORPSES[type.corpse] || gladiatorCorpse)(f, type, rnd);
  f.dot(range(-0.12, 0.12), range(-0.12, 0.12), range(0.12, 0.22), BLOOD_FRESH, 0.85);
  if (rnd() < 0.35) { // an arrow still in it
    const a = range(0, TAU);
    const x0 = Math.cos(a) * 0.1;
    const y0 = Math.sin(a) * 0.1;
    f.seg(x0, y0, x0 + Math.cos(a) * 0.6, y0 + Math.sin(a) * 0.6, px * 1.5, 0xcdbf99);
  }
}

// The floor's layer of blood and bodies from play. Things are queued with splat / droplet / corpse
// and painted onto the texture together by flush(), which the game calls once a frame.
export function createGore({ renderer, layer, scale, pixel, width, height }) {
  const px = pixel / scale;
  const range = (a, b) => a + Math.random() * (b - a);

  const texture = RenderTexture.create({ width: Math.ceil(width * scale), height: Math.ceil(height * scale) });
  texture.source.scaleMode = 'nearest';
  layer.addChild(new Sprite(texture));

  // What is waiting to be painted: shapes in metres, and dropped weapons (already in pixels).
  const pending = new Container();
  const metres = new Container();
  metres.scale.set(scale);
  const pixels = new Container();
  pending.addChild(metres, pixels);
  let g = null;
  const gfx = () => g || (g = metres.addChild(new Graphics()));

  const discardPending = () => {
    for (const box of [metres, pixels]) for (const c of box.removeChildren()) c.destroy({ children: true });
    g = null;
  };

  return {
    // A splash where something was hit. `size` is about 1 for an ordinary hit.
    splat(x, y, size) {
      const s = gfx();
      for (let i = 0; i < 3; i++) {
        s.circle(x + range(-0.15, 0.15) * size, y + range(-0.15, 0.15) * size, range(0.1, 0.22) * size).fill({ color: BLOOD, alpha: 0.9 });
      }
      s.circle(x, y, range(0.06, 0.12) * size).fill({ color: BLOOD_FRESH, alpha: 0.9 });
    },

    // A single drop landing.
    droplet(x, y) {
      gfx().circle(x, y, range(0.04, 0.09)).fill({ color: BLOOD, alpha: 0.9 });
    },

    // A corpse as a sprite, centred on (0, 0) and facing +x, to be moved and turned like a live
    // fighter's. The same `seed` always draws the same corpse, so it can be swapped for the one
    // painted onto the floor (see `corpse`) without anything changing.
    makeCorpseGfx(type, seed) {
      const root = new Container();
      const inner = new Container();
      inner.scale.set(scale);
      const body = new Graphics();
      drawFallenBody(body, 0, 0, 0, type, makeRng(seed), px);
      inner.addChild(body);
      root.addChild(inner);
      return root;
    },

    // Leaves a corpse on the floor (the one `makeCorpseGfx` makes for this seed), with its pool of
    // blood. `weaponGfx` (optional) is its dropped weapon, already placed in pixel coordinates.
    corpse(x, y, ang, type, seed, weaponGfx) {
      drawBloodPool(gfx(), x, y, Math.random, px);
      const lying = this.makeCorpseGfx(type, seed);
      lying.position.set(x * scale, y * scale);
      lying.rotation = ang;
      pixels.addChild(lying);
      if (weaponGfx) pixels.addChild(weaponGfx);
    },

    // Paints everything queued onto the floor texture.
    flush() {
      if (!g && !pixels.children.length) return;
      renderer.render({ container: pending, target: texture, clear: false });
      discardPending();
    },

    // Wipes the floor clean (for a new game).
    clear() {
      discardPending();
      renderer.render({ container: new Container(), target: texture, clear: true, clearColor: [0, 0, 0, 0] });
    },
  };
}
