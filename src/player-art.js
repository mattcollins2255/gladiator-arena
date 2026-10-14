import { Container, Graphics } from 'pixi.js';
import { shade } from './colors.js';
import { tools, solveElbow } from './sprite-tools.js';

// The player's gladiator, seen from above and built from simple shapes. It faces +x and the game
// rotates it with the body. This is only the picture: the collision circle is unchanged, and the
// weapon is still its own physics body.
//
// The picture is a few layers so it can move while swinging: the torso and shoulder armor twist
// toward the weapon, the head and upper body lean into the swing, and the arms are redrawn every
// frame so both hands stay on the weapon's handle (see `pose`).
//
// Shapes are drawn in "sprite metres" (+x forward, +y to the gladiator's right), which are SIZE
// times bigger than real metres, so the picture is a little larger than the hitbox.

const SIZE = 1.25;
// Half-extents (real metres) of the player's shadow on the floor, which main.js draws.
export const PLAYER_SHADOW = { rx: 0.28, ry: 0.54 };

const TWIST = 0.28; // shoulders turn this fraction of the weapon's angle from straight ahead
const LEAN_FORWARD = 0.06; // sprite metres the upper body shifts forward in a swing...
const LEAN_SIDE = 0.05; // ...and toward the side the swing is going
const LEAN_IN_RATE = 30; // how quickly the lean builds at the start of a swing (per second)
const LEAN_OUT_RATE = 9; // and how slowly it relaxes afterwards
const UPPER_ARM = 0.25;
const FOREARM = 0.27;
const GRIP = [0.05, 0.15]; // real metres along the handle from the pin: left hand (back), right hand (front)

const SKIN = 0xb98a68;
const LEATHER = 0x4a2e1c;
const BRONZE = [0x5f5038, 0x7d6a4a, 0x9a8660]; // outer plate to inner plate: darkest to brightest
const RIVET = 0xd9c48a;
const BLOOD = 0x5a1a14;

export function makePlayerGfx({ scale, pixel, color }) {
  const S = scale * SIZE; // drawing units per sprite metre
  const px = pixel / S; // one low-res pixel, in sprite metres

  // The torso and the shoulder armor both turn about the middle of the chest.
  const turning = () => {
    const c = new Container();
    c.pivot.set(-0.02 * S, 0);
    c.position.set(-0.02 * S, 0);
    return c;
  };
  const torso = turning();
  const torsoG = new Graphics();
  torso.addChild(torsoG);
  const armsG = new Graphics();
  const pauldrons = turning();
  const pauldronG = new Graphics();
  pauldrons.addChild(pauldronG);
  const head = new Container();
  const headG = new Graphics();
  head.addChild(headG);
  const root = new Container();
  root.addChild(torso, armsG, pauldrons, head);

  // ----- Torso: a leather tunic in the player's teal, with crossed harness straps -----
  {
    const g = torsoG;
    const { seg, dot } = tools(g, S);
    g.ellipse(-0.02 * S, 0, 0.2 * S, 0.34 * S).fill(shade(color, 0.6));
    g.ellipse(-0.02 * S, 0, 0.2 * S, 0.34 * S).stroke({ width: pixel, color: 0x000000, alpha: 0.5 });
    seg(-0.1, -0.28, 0.1, 0.28, 0.05, LEATHER);
    seg(-0.1, 0.28, 0.1, -0.28, 0.05, LEATHER);
    dot(0, 0, 0.035, RIVET); // the buckle where the straps cross
  }

  // ----- Shoulder armor: three overlapping bronze plates a side, outermost first, with teal
  // trim, rivets, scratches and the odd splash of blood. The left shoulder's is a bit bigger. -----
  {
    const g = pauldronG;
    const { seg, dot } = tools(g, S);
    for (const side of [-1, 1]) {
      const k = side < 0 ? 1.12 : 1;
      const plates = [
        { y: 0.3, rx: 0.17, ry: 0.12, c: BRONZE[0] },
        { y: 0.26, rx: 0.15, ry: 0.11, c: BRONZE[1] },
        { y: 0.21, rx: 0.13, ry: 0.1, c: BRONZE[2] },
      ];
      // The armor's shadow falls on the arm and chest beneath it.
      g.ellipse(0.02 * S, side * 0.3 * S + 0.04 * S, 0.17 * k * S, 0.13 * k * S).fill({ color: 0x000000, alpha: 0.3 });
      plates.forEach((p, i) => {
        const cx = -0.02 * S;
        const cy = side * p.y * S;
        g.ellipse(cx, cy, p.rx * k * S, p.ry * k * S).fill(p.c);
        g.ellipse(cx, cy, p.rx * k * S, p.ry * k * S)
          .stroke({ width: pixel * (i === 0 ? 1.4 : 1), color: i === 0 ? color : 0x000000, alpha: i === 0 ? 1 : 0.55 });
      });
      for (const x of [-0.1, -0.02, 0.06]) dot(x, side * 0.26, px * 0.7, RIVET);
      seg(-0.08, side * 0.27, 0.03, side * 0.31, px, 0xcfc2a0, 0.5); // scratches
      seg(-0.05, side * 0.2, 0.05, side * 0.23, px, 0xcfc2a0, 0.4);
    }
    dot(0.04, 0.3, 0.035, BLOOD, 0.85);
    dot(-0.06, 0.34, 0.025, BLOOD, 0.85);
  }

  // ----- Bald head with ears, a nose to show which way it is facing, and an old scar -----
  {
    const g = headG;
    const { seg, dot } = tools(g, S);
    g.ellipse(0.07 * S, 0.04 * S, 0.15 * S, 0.15 * S).fill({ color: 0x000000, alpha: 0.3 }); // its shadow on the shoulders
    dot(0, -0.15, 0.045, shade(SKIN, 0.85));
    dot(0, 0.15, 0.045, shade(SKIN, 0.85));
    g.circle(0.03 * S, 0, 0.15 * S).fill(shade(SKIN, 1.08));
    g.circle(0.03 * S, 0, 0.15 * S).stroke({ width: pixel, color: 0x000000, alpha: 0.45 });
    g.ellipse(0.02 * S, 0, 0.07 * S, 0.05 * S).fill({ color: 0xe3b890, alpha: 0.55 }); // shine on the crown
    g.poly([0.14 * S, -0.035 * S, 0.21 * S, 0, 0.14 * S, 0.035 * S]).fill(shade(SKIN, 0.8));
    seg(-0.08, -0.1, 0.06, 0.06, px, 0x7a3a30, 0.85);
  }

  // ----- Arms, redrawn each frame -----
  const arms = tools(armsG, S);
  function drawArm(sx, sy, hx, hy, side) {
    const { seg, dot } = arms;
    const [ex, ey] = solveElbow(sx, sy, hx, hy, side, UPPER_ARM, FOREARM);
    seg(sx, sy, ex, ey, 0.21 + px * 1.5, 0x000000, 0.5); // each bone: dark outline, then skin
    seg(sx, sy, ex, ey, 0.21, shade(SKIN, 0.85));
    seg(ex, ey, hx, hy, 0.17 + px * 1.5, 0x000000, 0.5);
    seg(ex, ey, hx, hy, 0.17, SKIN);
    dot(ex + (hx - ex) * 0.3, ey + (hy - ey) * 0.3, 0.1, shade(SKIN, 1.1)); // forearm muscle
    seg(sx, sy, ex, ey, 0.07, shade(SKIN, 1.2), 0.3); // sheen along the top of the arm

    // Leather wristband: a short thick strip across the forearm, with a stud.
    const len = Math.hypot(hx - ex, hy - ey) || 1;
    const nx = -(hy - ey) / len; // across the arm
    const ny = (hx - ex) / len;
    const cx = ex + (hx - ex) * 0.78;
    const cy = ey + (hy - ey) * 0.78;
    seg(cx - nx * 0.1, cy - ny * 0.1, cx + nx * 0.1, cy + ny * 0.1, 0.07, LEATHER);
    dot(cx + nx * 0.04, cy + ny * 0.04, px * 0.6, RIVET);

    dot(hx, hy, 0.075, shade(SKIN, 1.1)); // fist
  }

  let lean = 0; // 0 = standing, 1 = fully into a swing
  let leanDir = 1; // which way the last swing went

  // Poses the gladiator. `pinX, pinY` is where the weapon's handle is, in real metres from the
  // body's centre in the body's own frame; `rel` is the weapon's angle from straight ahead;
  // `swinging` is true during a swing, `dir` is +1 for clockwise and -1 for counter-clockwise.
  root.pose = ({ pinX, pinY, rel, swinging, dir, dt }) => {
    if (swinging) leanDir = dir;
    const target = swinging ? 1 : 0;
    lean += (target - lean) * (1 - Math.exp(-dt * (target > lean ? LEAN_IN_RATE : LEAN_OUT_RATE)));
    const lx = LEAN_FORWARD * lean;
    const ly = LEAN_SIDE * leanDir * lean;
    const twist = rel * TWIST;

    for (const part of [torso, pauldrons]) {
      part.position.set((-0.02 + lx) * S, ly * S);
      part.rotation = twist;
    }
    head.position.set(lx * 1.6 * S, ly * 1.6 * S); // the head leads the body into the swing

    // Both hands hold the handle: left hand at the back, right hand in front of it. The shoulders
    // have turned with the torso, so work out where they are now.
    const cos = Math.cos(twist);
    const sin = Math.sin(twist);
    armsG.clear();
    for (const side of [-1, 1]) {
      const along = GRIP[side < 0 ? 0 : 1];
      const hx = (pinX + Math.cos(rel) * along) / SIZE;
      const hy = (pinY + Math.sin(rel) * along) / SIZE;
      const offset = side * 0.28; // shoulder's distance from the middle of the chest
      drawArm(-0.02 + lx - offset * sin, ly + offset * cos, hx, hy, side);
    }
  };
  root.pose({ pinX: 0.4, pinY: 0, rel: 1.5, swinging: false, dir: 1, dt: 0 });

  return root;
}
