import { Container, Graphics } from 'pixi.js';
import { shade } from './colors.js';
import { tools, solveElbow } from './sprite-tools.js';

// The undead enemies, seen from above like the player's gladiator (player-art.js): built from
// simple shapes, facing +x, rotated by the game with the body. Each is drawn once, as a single
// picture. The hands are placed on the weapon's handle (the weapon's pin is `anchor`, in real
// metres), and because the weapon pivots around that pin, the hands stay right while it swings.
//
// Shapes are drawn in "sprite metres" (+x forward, +y to the fighter's right), which are SIZE
// times bigger than real metres, so each picture is a bit larger than its hitbox.

export const ENEMY_SIZE = { spearman: 1.25, swordsman: 1.4, archer: 1.1 };

const BONE = 0xd2cbb0;
const RAW = 0x7a2f2a; // exposed flesh
const STRAP = 0x2a1c12;

// Draws an arm as two bones, each with a dark outline. Points are [x, y]; `w` is [upper, fore] width.
function limb(t, px, s, e, h, w, c1, c2) {
  t.seg(s[0], s[1], e[0], e[1], w[0] + px * 1.5, 0x000000, 0.5);
  t.seg(s[0], s[1], e[0], e[1], w[0], c1);
  t.seg(e[0], e[1], h[0], h[1], w[1] + px * 1.5, 0x000000, 0.5);
  t.seg(e[0], e[1], h[0], h[1], w[1], c2);
}

const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

// ---------- Spearman: a walking corpse in cracked leather armour ----------
function spearman({ scale, pixel, anchor }) {
  const FLESH = 0x7c8768;
  const FLESH_D = 0x5a6650;
  const ROT = 0x4a2e2c;
  const LEATHER = 0x5a3d26;
  const LEATHER_D = 0x3a2718;
  const CLOTH = 0x4a4036;
  const STITCH = 0x9a8460;

  const size = ENEMY_SIZE.spearman;
  const S = scale * size;
  const px = pixel / S;
  const g = new Graphics();
  const t = tools(g, S, pixel);
  const { seg, dot, ell, poly } = t;

  // Rags hanging off the back.
  poly([[-0.18, -0.12], [-0.36, -0.17], [-0.3, -0.07], [-0.42, 0], [-0.3, 0.07], [-0.37, 0.16], [-0.18, 0.12]], CLOTH, 0.9);

  // Leather jerkin with a belt, stitching, and a rip showing the ribs.
  ell(-0.02, 0, 0.21, 0.33, LEATHER);
  seg(0.05, -0.29, 0.05, 0.29, 0.05, STRAP);
  dot(0.05, 0, 0.03, 0x8a7a50);
  for (let i = 0; i < 5; i++) {
    const x = -0.14 + i * 0.06;
    seg(x, -0.27, x + 0.025, -0.27, px, STITCH, 0.8);
    seg(x, 0.27, x + 0.025, 0.27, px, STITCH, 0.8);
  }
  ell(-0.1, 0.08, 0.07, 0.1, RAW);
  for (let i = 0; i < 3; i++) seg(-0.16, 0.03 + i * 0.045, -0.04, 0.03 + i * 0.045, px, BONE);
  dot(-0.08, -0.12, 0.05, ROT, 0.5); // grime and old bruising
  dot(0.0, 0.18, 0.04, ROT, 0.5);

  // Thin, withered arms gripping the spear: the left hand at the back, the right in front.
  const hands = [[(anchor.x + 0.05) / size, anchor.y / size], [(anchor.x + 0.2) / size, anchor.y / size]];
  [-1, 1].forEach((side, i) => {
    const s = [-0.02, side * 0.27];
    const h = hands[i];
    const e = solveElbow(s[0], s[1], h[0], h[1], side, 0.27, 0.29);
    limb(t, px, s, e, h, [0.12, 0.1], FLESH_D, FLESH);
    const patch = lerp(e, h, 0.4);
    dot(patch[0], patch[1], 0.03, ROT, 0.8);
    const b0 = lerp(e, h, 0.45); // bone showing through the forearm
    const b1 = lerp(e, h, 0.7);
    seg(b0[0], b0[1], b1[0], b1[1], 0.03, BONE);
    const w = lerp(e, h, 0.82); // a rag wrapped round the wrist
    const len = Math.hypot(h[0] - e[0], h[1] - e[1]) || 1;
    const nx = -(h[1] - e[1]) / len;
    const ny = (h[0] - e[0]) / len;
    seg(w[0] - nx * 0.07, w[1] - ny * 0.07, w[0] + nx * 0.07, w[1] + ny * 0.07, 0.05, 0x8a7f66);
    dot(h[0], h[1], 0.06, FLESH_D);
    dot(h[0] + 0.05, h[1] - 0.025, 0.018, BONE); // bare finger bones
    dot(h[0] + 0.05, h[1] + 0.025, 0.018, BONE);
  });

  // Cracked leather shoulder pads: a bone spur on the left, a bitten-away patch on the right.
  for (const side of [-1, 1]) {
    ell(-0.02, side * 0.31, 0.14, 0.1, LEATHER_D);
    seg(-0.1, side * 0.31, 0.06, side * 0.31, px, STITCH, 0.8);
    dot(-0.02, side * 0.26, px * 0.7, 0x8a7a50);
  }
  poly([[-0.06, -0.4], [0, -0.52], [0.04, -0.4]], BONE, 1, { color: 0x000000, alpha: 0.4 });
  dot(0.02, 0.34, 0.045, RAW);
  dot(-0.03, 0.36, 0.025, ROT);

  // Head: grey, sunken and patchy, with the skull showing on the crown, one ear torn off and a
  // dark hole where the nose was.
  ell(0.04, 0, 0.15, 0.15, FLESH);
  dot(-0.03, 0.06, 0.04, ROT, 0.7);
  dot(0.08, -0.07, 0.03, ROT, 0.7);
  dot(-0.02, -0.04, 0.065, BONE);
  seg(-0.06, -0.06, 0.02, -0.02, px, 0x6a604a);
  dot(0, -0.16, 0.04, FLESH_D); // the ear that is left
  dot(0, 0.16, 0.035, RAW); // and the torn stump
  for (let i = 0; i < 4; i++) seg(-0.1, -0.09 + i * 0.06, -0.17, -0.1 + i * 0.07, px, 0x2c2a24, 0.8); // thin, lank hair
  dot(0.17, 0, 0.025, 0x1c1410);

  return g;
}

// ---------- Swordsman: a black knight ----------
// Built in layers so his sword arm can be redrawn each frame: it follows the sword's handle as that
// moves to his side, his middle (whirlwind) or out in front (thrust). If the handle is further
// away than the arm can reach, the hand stops at full stretch and the sword slides on out of it.
function swordsman({ scale, pixel, color, anchor }) {
  const STEEL_D = 0x15151a;
  const STEEL = 0x1d1d23;
  const STEEL_L = 0x2a2a33;
  const RIM = 0x4a4a58;
  const CAPE = 0x2a1216;
  const CAPE_L = 0x3d1a20;
  const EMBER = 0xe8742a;
  const REACH = 0.62; // sprite metres from the shoulder: furthest the sword hand goes

  const size = ENEMY_SIZE.swordsman;
  const S = scale * size;
  const px = pixel / S;
  const root = new Container();
  const under = new Graphics(); // cloak, breastplate, left arm
  const shoulders = new Graphics(); // pauldrons
  const swordArm = new Graphics(); // redrawn by `pose`
  const helm = new Graphics();
  root.addChild(under, shoulders, swordArm, helm);

  {
    const g = under;
    const t = tools(g, S, pixel);
    const { seg, ell, poly } = t;
    // A ragged cloak streaming out behind, edged in the knight's dull purple.
    const cape = [
      [-0.05, -0.4], [-0.3, -0.46], [-0.42, -0.34], [-0.36, -0.22], [-0.54, -0.12], [-0.4, -0.02],
      [-0.57, 0.1], [-0.4, 0.2], [-0.47, 0.33], [-0.3, 0.46], [-0.05, 0.4],
    ];
    poly(cape, CAPE, 1, { color, alpha: 0.6 });
    poly([[-0.08, -0.3], [-0.3, -0.3], [-0.38, -0.12], [-0.3, 0.05], [-0.38, 0.2], [-0.28, 0.32], [-0.08, 0.3]], CAPE_L, 0.8);
    seg(-0.1, -0.22, -0.4, -0.1, px, 0x000000, 0.5); // folds
    seg(-0.1, 0.04, -0.42, 0.1, px, 0x000000, 0.5);
    seg(-0.1, 0.22, -0.38, 0.28, px, 0x000000, 0.5);

    // Breastplate, in bands.
    ell(-0.02, 0, 0.25, 0.4, STEEL);
    for (let i = 0; i < 4; i++) {
      const x = -0.18 + i * 0.1;
      seg(x, -0.3, x, 0.3, px, 0x000000, 0.6);
      seg(x + px * 1.2, -0.3, x + px * 1.2, 0.3, px, RIM, 0.25);
    }
    g.ellipse(-0.02 * S, 0, 0.25 * S, 0.4 * S).stroke({ width: pixel, color: RIM, alpha: 0.6 });

    // The left arm hangs bent, gauntlet near the hip.
    limb(t, px, [-0.02, -0.36], [-0.14, -0.52], [0.16, -0.44], [0.18, 0.15], STEEL, STEEL_L);
    t.dot(-0.14, -0.52, 0.05, RIM, 0.7); // elbow guard
  }

  {
    const g = shoulders;
    const { dot, ell, poly } = tools(g, S, pixel);
    // Pauldrons: three heavy black plates a side, with a spike on the outside.
    for (const side of [-1, 1]) {
      poly([[-0.12, side * 0.44], [-0.02, side * 0.57], [0.08, side * 0.44]], STEEL_L, 1, { color: RIM, alpha: 0.7 });
      [
        { y: 0.36, rx: 0.2, ry: 0.15, c: STEEL_D },
        { y: 0.31, rx: 0.18, ry: 0.14, c: STEEL },
        { y: 0.25, rx: 0.15, ry: 0.12, c: STEEL_L },
      ].forEach((p) => {
        ell(-0.02, side * p.y, p.rx, p.ry, p.c);
        g.ellipse(-0.02 * S, side * p.y * S, p.rx * S, p.ry * S).stroke({ width: pixel, color: RIM, alpha: 0.35 });
      });
    }
    dot(0.16, -0.44, 0.08, STEEL_L); // the left gauntlet
  }

  {
    const g = helm;
    const { seg, dot, ell, poly } = tools(g, S, pixel);
    // Great helm: a tattered plume, swept-back horns, a ridge along the crown and two embers in
    // the visor slit.
    poly([[-0.14, -0.03], [-0.36, -0.07], [-0.3, -0.01], [-0.42, 0.03], [-0.3, 0.05], [-0.36, 0.09], [-0.14, 0.04]], 0x5a1a20);
    for (const side of [-1, 1]) poly([[-0.02, side * 0.14], [-0.22, side * 0.33], [-0.1, side * 0.11]], STEEL_L, 1, { color: RIM, alpha: 0.6 });
    ell(0.02, 0, 0.19, 0.16, STEEL);
    g.ellipse(0.02 * S, 0, 0.19 * S, 0.16 * S).stroke({ width: pixel, color: RIM, alpha: 0.6 });
    seg(-0.15, 0, 0.17, 0, 0.035, STEEL_L);
    seg(-0.15, 0, 0.17, 0, px, RIM, 0.5);
    seg(0.15, -0.08, 0.15, 0.08, 0.035, 0x000000);
    dot(0.155, -0.04, px * 0.8, EMBER);
    dot(0.155, 0.04, px * 0.8, EMBER);
  }

  const armT = tools(swordArm, S, pixel);
  // `pinX, pinY`: where the sword's handle is, in real metres from his centre, in his own frame.
  root.pose = ({ pinX, pinY }) => {
    swordArm.clear();
    const s = [-0.02, 0.36]; // the shoulder
    let hx = pinX / size;
    let hy = pinY / size;
    const d = Math.hypot(hx - s[0], hy - s[1]);
    if (d > REACH) {
      hx = s[0] + ((hx - s[0]) * REACH) / d;
      hy = s[1] + ((hy - s[1]) * REACH) / d;
    }
    // With the hand almost on the shoulder (the sword resting at his side) the elbow tucks back.
    const e = d < 0.25 ? [-0.2, 0.5] : solveElbow(s[0], s[1], hx, hy, 1, 0.3, 0.34);
    limb(armT, px, s, e, [hx, hy], [0.18, 0.15], STEEL, STEEL_L);
    armT.dot(e[0], e[1], 0.05, RIM, 0.7);
    armT.dot(hx, hy, 0.09, STEEL_L);
    swordArm.circle(hx * S, hy * S, 0.09 * S).stroke({ width: pixel, color: RIM, alpha: 0.5 });
  };
  root.pose({ pinX: anchor.x, pinY: anchor.y });

  return root;
}

// ---------- Archer: a sickly goblin ----------
function archer({ scale, pixel, anchor }) {
  const GOB = 0x7f9140;
  const GOB_D = 0x5d6d30;
  const GOB_L = 0xa3b25a;
  const SORE = 0xa05a3a;
  const BOIL = 0xc9c07a;
  const RAGS = 0x5b5240;
  const RAGS_D = 0x3f382c;
  const LEATHER = 0x5a3d26;

  const size = ENEMY_SIZE.archer;
  const S = scale * size;
  const px = pixel / S;
  const g = new Graphics();
  const t = tools(g, S, pixel);
  const { seg, dot, ell, poly } = t;

  // A quiver on its back, strapped on diagonally, with the arrows' feathers sticking out.
  const dir = [Math.cos(-2.55), Math.sin(-2.55)]; // along the quiver, toward its far end
  const c = [-0.17, 0.12];
  const side = [-dir[1], dir[0]];
  const hl = 0.17; // half-length and half-width
  const hw = 0.05;
  poly([
    [c[0] - dir[0] * hl - side[0] * hw, c[1] - dir[1] * hl - side[1] * hw],
    [c[0] + dir[0] * hl - side[0] * hw, c[1] + dir[1] * hl - side[1] * hw],
    [c[0] + dir[0] * hl + side[0] * hw, c[1] + dir[1] * hl + side[1] * hw],
    [c[0] - dir[0] * hl + side[0] * hw, c[1] - dir[1] * hl + side[1] * hw],
  ], LEATHER, 1, { color: 0x000000, alpha: 0.5 });
  const top = [c[0] - dir[0] * hl, c[1] - dir[1] * hl];
  [[-0.03, 0xcfc7b0], [0, 0x7a2a2a], [0.03, 0xcfc7b0]].forEach(([o, col]) => {
    seg(top[0] + side[0] * o, top[1] + side[1] * o, top[0] - dir[0] * 0.07 + side[0] * o * 1.6, top[1] - dir[1] * 0.07 + side[1] * o * 1.6, px * 1.5, col);
  });

  // Hunched, scrawny body in rags.
  ell(-0.04, 0, 0.15, 0.22, RAGS);
  dot(-0.1, -0.08, 0.05, RAGS_D, 0.8);
  dot(0.02, 0.1, 0.04, RAGS_D, 0.8);
  seg(0.04, -0.2, -0.08, 0.2, 0.04, STRAP); // quiver strap
  poly([[-0.14, -0.08], [-0.28, -0.1], [-0.22, -0.02], [-0.3, 0.03], [-0.2, 0.08]], RAGS, 0.9);

  // Long, skinny arms: the left holds the bow out in front, the right draws the string.
  const hands = [[(anchor.x + 0.47) / size, anchor.y / size], [(anchor.x + 0.22) / size, anchor.y / size + 0.04]];
  [-1, 1].forEach((sd, i) => {
    const s = [-0.02, sd * 0.2];
    const h = hands[i];
    const e = solveElbow(s[0], s[1], h[0], h[1], sd, 0.35, 0.38);
    limb(t, px, s, e, h, [0.08, 0.07], GOB_D, GOB);
    dot(e[0], e[1], 0.045, GOB_D); // knobbly elbow
    dot(h[0], h[1], 0.065, GOB_D);
  });
  for (const sd of [-1, 1]) ell(-0.02, sd * 0.22, 0.08, 0.06, RAGS_D); // scraps of shoulder rag

  // Head: big, bald and sickly, with huge drooping ears, a long hooked nose, boils and sores.
  for (const sd of [-1, 1]) {
    poly([[0.06, sd * 0.14], [0.0, sd * 0.4], [0.17, sd * 0.15]], GOB_D, 1, { color: 0x000000, alpha: 0.4 });
    poly([[0.08, sd * 0.17], [0.02, sd * 0.33], [0.13, sd * 0.17]], 0xa88a72, 0.8);
  }
  ell(0.1, 0, 0.18, 0.17, GOB);
  dot(0.05, 0.08, 0.03, BOIL);
  dot(0.12, -0.1, 0.025, BOIL);
  dot(0.0, -0.06, 0.02, BOIL);
  dot(0.16, 0.07, 0.035, SORE, 0.9);
  dot(-0.02, 0.0, 0.05, GOB_L, 0.5); // pale, waxy skin on the crown
  seg(-0.05, -0.1, -0.1, -0.02, px, 0x2c2a24, 0.8); // a few stringy hairs
  seg(-0.06, 0.04, -0.12, 0.09, px, 0x2c2a24, 0.8);
  poly([[0.26, -0.045], [0.4, 0.005], [0.26, 0.05]], GOB_D, 1, { color: 0x000000, alpha: 0.4 });
  for (const sd of [-1, 1]) seg(0.2, sd * 0.09, 0.24, sd * 0.05, px * 1.5, shade(GOB_D, 0.7)); // heavy brow

  return g;
}

const DRAW = { spearman, swordsman, archer };

// `opts`: { scale, pixel, color (the type's colour), anchor (the weapon's pin on the body) }.
export function makeEnemyGfx(name, opts) {
  return DRAW[name](opts);
}
