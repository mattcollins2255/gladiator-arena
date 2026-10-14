import { Application, Container, Graphics } from 'pixi.js';
import RAPIER from '@dimforge/rapier2d-compat';
import { startMusic, toggleMute } from './music.js';
import { buildArenaArt } from './arena-art.js';
import { makePlayerGfx, PLAYER_SHADOW } from './player-art.js';
import { createGore } from './gore.js';
import { makeEnemyGfx, ENEMY_SIZE } from './enemy-art.js';

// ---------- Tunables ----------
const SCALE = 50; // pixels per metre
const ARENA_W = 40; // metres
const ARENA_H = 28;
const VIEW_H = 16; // metres visible vertically at normal zoom
const WALL = 2; // metres thick: the physics walls, drawn as stone
const STANDS = 4; // metres of crowd seating beyond the walls
const VIEW_MARGIN = 4; // metres past the arena edge the camera may look, so the walls and stands show

// The game is drawn at a fixed number of pixels tall and scaled up with hard edges, for the pixel look.
const LOWRES_H = 360;
// How many world-drawing units (1/SCALE metre) one low-res pixel covers at normal zoom. Lines are
// sized in these so they stay a whole pixel thick instead of vanishing.
const PIXEL = (VIEW_H * SCALE) / LOWRES_H;

const ARROW_SPEED = 15; // m/s
const ARROW_LIFE = 2.5; // seconds before an arrow gives up
const ARROW_KNOCKBACK = 8; // m/s

// Flick gesture: the player swings when the cursor is whipped sideways around the character.
const FLICK_WINDOW = 100; // ms of cursor history that is examined
const FLICK_MIN_DIST = 80; // px the cursor must travel sideways (around the player) in that window
const FLICK_SPEED = 1500; // px/s the sideways motion must reach
const FLICK_MIN_RADIUS = 40; // px; ignore the cursor when it is practically on top of the player
const PLAYER_ARC = 1.5; // radians either side of straight ahead where a swing starts and ends
const STAMINA_REGEN_DELAY = 0.5; // seconds after a swing before stamina starts coming back
const PARRY_SPIN = 1.5; // rad/s a parried weapon is spun, per point of the attacker's parry stat
const PARRY_BASE_TIME = 0.5; // seconds a parried weapon stays disrupted...
const PARRY_TIME_PER_POINT = 0.1; // ...plus this much per point of the attacker's parry stat
const PARRY_FLING_TIME = 0.15; // seconds it flies free first, before being drawn back behind its owner

// Hit feel
const STAGGER_TIME = 0.35; // seconds the victim can't steer (so it tumbles)
const HITSTOP = 0.08; // seconds the whole simulation freezes on impact
const HIT_SHAKE = 0.7; // screen shake strength (0..1)
const HIT_KICK = 0.5; // metres the camera is shoved along the hit direction
const HIT_ZOOM_PUNCH = 0.06; // fraction the view zooms in on impact
const DEATH_SLIDE = 0.8; // seconds a killed fighter keeps tumbling from the blow before it drops as a corpse

// Everything that differs between fighters lives in this table. These are BASE values: when a
// fighter spawns they are copied into its own `stats` (see makeStats), and the game reads them from
// there. So run upgrades and class perks change `f.stats`, never this table.
//   r, density     body size and weight
//   accel          how hard it pushes itself around (top speed is roughly accel / 5 m/s)
//   cooldown       seconds between attacks;  windup: telegraph time before the attack lands
//   attack         'flick' | 'thrust' | 'arc' | 'whirl' | 'stab' | 'shoot'
//   swingTime      how long the weapon is dangerous;  swingSpeed: spin/sweep rate (rad/s)
//   lunge          m/s forward kick when the attack starts
//   damage         hit points removed;  knockback: m/s the victim is launched at
//   resist         scales knockback received (below 1 = hard to shove)
//   parry          (optional) how hard a swing knocks aside any weapon it hits (0 = not at all)
//   lungeSide      (optional) extra sideways part of a flick's lunge, as a fraction of the forward lunge
//   steady         (optional) the weapon is pinned to a kinematic anchor, so swinging it, or making
//                  it bigger and heavier, never pushes the body around (see createFighter)
//   stamina        (optional) { max, cost per attack, regen per second }; fighters without it
//                  attack freely
//   corpse         which style of corpse it leaves (see gore.js)
//   moves          (optional) several attacks instead of one; the AI picks by name. Each move has
//                  its own attack, windup and swingTime, and may scale the fighter's stats:
//                  lungeMul, cooldownMul, damageMul, knockbackMul (see the swordsman)
//   weapon        collider box (hx, hy half-sizes, ox offset from the handle), where its
//                  handle is pinned on the body (anchor), the resting angle relative to the
//                  body, and how stiffly it is held there
const TYPES = {
  player: {
    r: 0.4, density: 1, color: 0x3d8f8a, hp: 6, accel: 26, cooldown: 0.3, windup: 0,
    attack: 'flick', swingTime: 0.3, swingSpeed: 16, lunge: 5, damage: 1, knockback: 12, resist: 1,
    parry: 4, lungeSide: 0.15, steady: true, stamina: { max: 100, cost: 30, regen: 30 }, corpse: 'gladiator',
    weapon: { hx: 0.65, hy: 0.07, ox: 0.65, density: 2, anchor: { x: 0.4, y: 0 }, rest: PLAYER_ARC, holdGain: 10, holdMax: 15 },
  },
  // Cannon fodder. Slow, keeps its spear thrust out front, and only occasionally dashes at you.
  spearman: {
    r: 0.4, density: 1.2, color: 0x8a2f2f, corpse: 'zombie', hp: 2, accel: 7, cooldown: 3, windup: 0.4,
    attack: 'thrust', swingTime: 0.3, swingSpeed: 0, lunge: 10, damage: 1, knockback: 9, resist: 1,
    weapon: { hx: 0.825, hy: 0.05, ox: 0.825, density: 1, anchor: { x: 0.4, y: 0 }, rest: 0, holdGain: 20, holdMax: 25 },
  },
  // The black knight. Heavy and slow, with two attacks (`moves`). His sword trails behind him when
  // he isn't attacking, which is also when he is weakest (see weakBehind).
  //   whirl: a long wind-up, then a huge dash with the sword spinning round him (swingSpeed). Each pass
  //          of the blade hurts less than a stab, but it can hit again and again. Afterwards he is
  //          slowed to `recoverSlow` of his speed, and his sword hangs useless, for `recover` seconds.
  //   stab:  the sword is held out front, then shoots `reach` metres out from `ready` (the handle's
  //          place on his body) in extendTime, stays out for holdTime, and pulls back in retreatTime.
  //          swingTime, the time it can hurt, is extendTime + holdTime.
  swordsman: {
    r: 0.5, density: 2.5, color: 0x5a4a7a, corpse: 'knight', hp: 4, accel: 9, cooldown: 3.2,
    swingSpeed: 15, lunge: 10, damage: 2, knockback: 20, resist: 0.55, weakBehind: true, steady: true,
    moves: {
      whirl: {
        attack: 'whirl', windup: 0.8, swingTime: 0.9, lungeMul: 2.6, cooldownMul: 1.5,
        damageMul: 0.5, knockbackMul: 0.8, recover: 1, recoverSlow: 0.3,
      },
      stab: {
        attack: 'stab', windup: 0.45, swingTime: 0.18, extendTime: 0.1, holdTime: 0.08, retreatTime: 0.35,
        reach: 2, ready: { x: 0.45, y: 0.2 }, lungeMul: 0.3, cooldownMul: 0.6,
      },
    },
    weapon: { hx: 0.95, hy: 0.13, ox: 0.95, density: 2.5, anchor: { x: 0, y: 0.5 }, rest: Math.PI, holdGain: 7, holdMax: 10 },
  },
  // Keeps its distance, picks spots with a clear shot, and fires arrows.
  archer: {
    r: 0.35, density: 1, color: 0x7a8a3a, corpse: 'goblin', hp: 2, accel: 14, cooldown: 2.4, windup: 0.5,
    attack: 'shoot', swingTime: 0, swingSpeed: 0, lunge: 0, damage: 1, knockback: ARROW_KNOCKBACK, resist: 1.2,
    weapon: { hx: 0.04, hy: 0.4, ox: 0.3, density: 0.6, anchor: { x: 0.35, y: 0 }, rest: 0, holdGain: 20, holdMax: 25 },
  },
};

const PILLARS = [[-5, -3.5], [5, -3.5], [-5, 3.5], [5, 3.5]].map(([dx, dy]) => ({
  x: ARENA_W / 2 + dx,
  y: ARENA_H / 2 + dy,
}));

await RAPIER.init();

const app = new Application();
// The canvas has LOWRES_H real pixels vertically. A resolution below 1 gives that, while autoDensity
// keeps the canvas filling the window; CSS (image-rendering: pixelated) then scales it up crisply.
// Antialiasing is off because soft edges would ruin the look. Everything in the game keeps working
// in screen (CSS) pixels, so the mouse and camera code need no changes.
await app.init({
  width: window.innerWidth,
  height: window.innerHeight,
  background: '#07070a',
  antialias: false,
  resolution: LOWRES_H / window.innerHeight,
  autoDensity: true,
});
document.body.appendChild(app.canvas);
window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight, LOWRES_H / window.innerHeight);
});

// Top-down view: no gravity. Damping on bodies acts as ground friction.
const world = new RAPIER.World({ x: 0, y: 0 });
world.timestep = 1 / 60;
const events = new RAPIER.EventQueue(true);

// Everything in the game world lives in `view`, which the camera moves and zooms.
const view = new Container();
const floorLayer = new Container();
const decalLayer = new Container(); // blood stains and corpses painted on the floor
const shadowGfx = new Graphics(); // drop shadows of fighters and weapons, under everything that moves
const bodyLayer = new Container();
const hudGfx = new Graphics(); // the player's health bar and stamina ring
const aimGfx = new Graphics();
const sparksGfx = new Graphics();
const bloodGfx = new Graphics(); // blood drops in the air
const glowGfx = new Graphics(); // the red glow of a weapon that is about to hurt, or hurting
glowGfx.blendMode = 'add';
view.addChild(floorLayer, decalLayer, shadowGfx, bodyLayer, glowGfx, hudGfx, aimGfx, sparksGfx, bloodGfx);
app.stage.addChild(view);

// ---------- Helpers ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angleDiff = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// ---------- Arena ----------
// The physics here is just the invisible walls and pillars; how the arena looks is in arena-art.js.
function buildArena() {
  // Four walls, placed just outside the floor. (cx, cy, half-width, half-height) in metres.
  const walls = [
    [ARENA_W / 2, -WALL / 2, ARENA_W / 2 + WALL, WALL / 2],
    [ARENA_W / 2, ARENA_H + WALL / 2, ARENA_W / 2 + WALL, WALL / 2],
    [-WALL / 2, ARENA_H / 2, WALL / 2, ARENA_H / 2 + WALL],
    [ARENA_W + WALL / 2, ARENA_H / 2, WALL / 2, ARENA_H / 2 + WALL],
  ];
  for (const [cx, cy, hw, hh] of walls) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy));
    world.createCollider(RAPIER.ColliderDesc.cuboid(hw, hh).setFriction(0.8), body);
  }

  for (const p of PILLARS) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y));
    world.createCollider(RAPIER.ColliderDesc.ball(1).setFriction(0.8), body);
  }

  return buildArenaArt({
    layer: floorLayer, scale: SCALE, width: ARENA_W, height: ARENA_H, wallThickness: WALL,
    standsDepth: STANDS, pixel: PIXEL, pillars: PILLARS, types: TYPES, makeWeaponGfx,
  });
}
const arena = buildArena();
const gore = createGore({
  renderer: app.renderer, layer: decalLayer, scale: SCALE, pixel: PIXEL, width: ARENA_W, height: ARENA_H,
});

// ---------- Fighter graphics ----------
function makeBodyGfx(type) {
  if (type === TYPES.player) return makePlayerGfx({ scale: SCALE, pixel: PIXEL, color: type.color });
  for (const name of Object.keys(ENEMY_SIZE)) {
    if (type === TYPES[name]) return makeEnemyGfx(name, { scale: SCALE, pixel: PIXEL, color: type.color, anchor: type.weapon.anchor });
  }
  const g = new Graphics();
  g.circle(0, 0, type.r * SCALE).fill(type.color);
  g.moveTo(0, 0).lineTo(type.r * SCALE, 0).stroke({ width: PIXEL, color: 0x000000, alpha: 0.5 });
  if (type === TYPES.swordsman) g.circle(0, 0, type.r * SCALE).stroke({ width: PIXEL * 2, color: 0x1c1626 }); // heavy plating
  if (type === TYPES.archer) g.circle(0, 0, type.r * SCALE * 0.55).fill({ color: 0x000000, alpha: 0.3 }); // hood
  return g;
}

// A weapon's origin is its handle pin. Its blade extends along +x from there.
function makeWeaponGfx(type) {
  const S = SCALE;
  const g = new Graphics();
  if (type === TYPES.spearman) {
    g.rect(0, -0.03 * S, 1.5 * S, 0.06 * S).fill(0x6b4a2b);
    g.poly([1.5 * S, -0.08 * S, 1.65 * S, 0, 1.5 * S, 0.08 * S]).fill(0xb8bcc8);
  } else if (type === TYPES.swordsman) {
    g.rect(0, -0.04 * S, 0.22 * S, 0.08 * S).fill(0x4a3526); // grip
    g.rect(0.2 * S, -0.26 * S, 0.08 * S, 0.52 * S).fill(0x3a3a44); // crossguard
    g.rect(0.28 * S, -0.12 * S, 1.45 * S, 0.24 * S).fill(0xa8adb8); // blade
    g.poly([1.73 * S, -0.12 * S, 1.9 * S, 0, 1.73 * S, 0.12 * S]).fill(0xa8adb8); // point
  } else if (type === TYPES.archer) {
    g.moveTo(0.3 * S, -0.4 * S).quadraticCurveTo(0.65 * S, 0, 0.3 * S, 0.4 * S).stroke({ width: PIXEL * 2, color: 0x7a5a33 });
    g.moveTo(0.3 * S, -0.4 * S).lineTo(0.3 * S, 0.4 * S).stroke({ width: PIXEL, color: 0xcccccc });
  } else {
    g.rect(0, -0.07 * S, 1.3 * S, 0.14 * S).fill(0x9a9aa6);
    g.rect(0, -0.07 * S, 0.25 * S, 0.14 * S).fill(0x4a3526);
  }
  return g;
}

// ---------- Fighters ----------
// Each fighter is a round body plus a separate weapon body joined to it by a pin.
const fighters = [];
const arrows = [];
// collider handle -> { kind: 'body' | 'weapon', f } or { kind: 'arrow', arrow }.
// Walls and pillars aren't in here, which is how we recognise them.
const colliderInfo = new Map();

// A fighter's tunable numbers. Gameplay code reads these from `f.stats` (not from the type table),
// so a roguelike upgrade is one line, e.g.  f.stats.cooldown *= 0.9  or  f.stats.damage += 1.
function makeStats(type) {
  return {
    maxHp: type.hp,
    accel: type.accel, // move speed
    cooldown: type.cooldown, // seconds between attacks (lower = faster)
    lunge: type.lunge, // dash speed at the start of an attack (m/s)
    swingSpeed: type.swingSpeed, // how fast the weapon sweeps (rad/s)
    damage: type.damage, // hit points removed per hit
    knockback: type.knockback, // m/s the victim is launched at
    stagger: STAGGER_TIME, // seconds the victim loses control for
    resist: type.resist, // scales knockback received (below 1 = harder to shove)
    maxStamina: type.stamina ? type.stamina.max : 0, // stamina pool
    staminaCost: type.stamina ? type.stamina.cost : 0, // stamina spent per attack
    staminaRegen: type.stamina ? type.stamina.regen : 0, // stamina recovered per second
    lungeSide: type.lungeSide || 0, // sideways part of the lunge, toward the swing's direction
    parry: type.parry || 0, // how hard a swing knocks aside the weapons it hits
    weaponSize: 1, // weapon scale multiplier (1.2 = 20% bigger, and heavier)
  };
}

// Resizes a fighter's weapon to match its `weaponSize` stat: the collider and the picture both scale
// about the handle pin. Called whenever the stat has changed, so any upgrade can use it.
function applyWeaponSize(f) {
  const w = f.type.weapon;
  const s = f.stats.weaponSize;
  f.weaponCol.setHalfExtents({ x: w.hx * s, y: w.hy * s });
  f.weaponCol.setTranslationWrtParent({ x: w.ox * s, y: 0 });
  f.weaponGfx.scale.set(s);
  f.appliedSize = s;
}

function createFighter(typeName, x, y) {
  const type = TYPES[typeName];
  const w = type.weapon;

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setLinearDamping(5).setAngularDamping(4),
  );
  const bodyCol = world.createCollider(
    RAPIER.ColliderDesc.ball(type.r).setDensity(type.density).setFriction(0.4).setRestitution(0.2),
    body,
  );

  const weapon = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x + w.anchor.x, y + w.anchor.y)
      .setRotation(w.rest)
      .setLinearDamping(1)
      .setAngularDamping(0.5)
      .setCcdEnabled(!!type.moves), // a whirling sword is fast: don't let it jump through people
  );
  const weaponCol = world.createCollider(
    RAPIER.ColliderDesc.cuboid(w.hx, w.hy)
      .setTranslation(w.ox, 0)
      .setDensity(w.density)
      .setRestitution(0.3)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    weapon,
  );

  // Pin the weapon handle at the anchor point on the body; the weapon can rotate freely around it.
  let anchor = null;
  if (type.steady) {
    // Pinned to a kinematic "anchor" that is moved to the pin point every step (see driveFighter),
    // instead of to the body itself. The anchor has effectively infinite mass, so whatever the
    // weapon does (swing, size, weight) never pushes or drags the body. The inactive rope joint is
    // there only to switch off contacts between the weapon and its own body.
    anchor = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x + w.anchor.x, y + w.anchor.y),
    );
    world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0 }, { x: 0, y: 0 }), anchor, weapon, true);
    const link = world.createImpulseJoint(RAPIER.JointData.rope(100, { x: 0, y: 0 }, { x: 0, y: 0 }), body, weapon, true);
    link.setContactsEnabled(false);
  } else {
    const joint = world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: w.anchor.x, y: w.anchor.y }, { x: 0, y: 0 }),
      body,
      weapon,
      true,
    );
    joint.setContactsEnabled(false); // a fighter's weapon never collides with its own body
  }

  const gfx = makeBodyGfx(type);
  const weaponGfx = makeWeaponGfx(type);
  bodyLayer.addChild(weaponGfx, gfx);

  const f = {
    typeName, type, body, weapon, weaponCol, anchor, gfx, weaponGfx, isPlayer: typeName === 'player',
    appliedSize: 1, // the weaponSize currently built into the collider and graphics
    stats: makeStats(type),
    hp: type.hp,
    usesStamina: !!type.stamina, // only the player runs out of stamina
    stamina: type.stamina ? type.stamina.max : 0,
    staminaDelayT: 0, // counts down after a swing; stamina regenerates once it reaches zero
    noStaminaT: 0, // set when a swing was attempted without enough stamina (flashes the ring)
    // Intent, filled in each step by the player or the AI:
    move: { x: 0, y: 0 }, aim: 0, wantAttack: false,
    // Timers (seconds):
    attackCd: 0, swingT: 0, windupT: 0, hitCd: 0, flash: 0, stagger: 0,
    disruptT: 0, disruptMax: 0, // weapon knocked aside by a parry: it can't attack until this runs out
    parryCd: 0, // short grace so one clash isn't parried twice
    dead: false,
    // Behaviour state:
    swingTimer: 0.5 + Math.random() * 1.5,
    restRel: w.rest, // where the weapon is held, relative to the body's facing
    pin: { x: w.anchor.x, y: w.anchor.y }, // where the weapon's handle is on the body right now (some attacks move it)
    moveDef: type.moves ? Object.values(type.moves)[0] : type, // the attack in use: one of type.moves, or the type itself
    wantMove: null, // which of type.moves the AI wants to use next
    moveT: Infinity, // seconds since a stab began
    whirling: false, recoverT: 0, recoverSlow: 1, // after a whirlwind: slowed, and no sword, for a while
    flickDir: 1, flickPower: 1, // the player's last flick: +1 clockwise, -1 counter-clockwise
    swooshT: 0, swooshStart: 0, // the player's swing trail
    spot: null, spotT: 0, // archer's chosen safe spot
  };
  colliderInfo.set(bodyCol.handle, { kind: 'body', f });
  colliderInfo.set(weaponCol.handle, { kind: 'weapon', f });
  f.colliderHandles = [bodyCol.handle, weaponCol.handle];
  fighters.push(f);
  return f;
}

function removeFighter(f) {
  world.removeRigidBody(f.body); // this also removes its joint
  world.removeRigidBody(f.weapon);
  if (f.anchor) world.removeRigidBody(f.anchor);
  for (const h of f.colliderHandles) colliderInfo.delete(h);
  f.gfx.destroy({ children: true }); // the player's picture is several layers
  f.weaponGfx.destroy();
  fighters.splice(fighters.indexOf(f), 1);
}

// True when the weapon is in the rear half-circle (so it can't guard the front).
function weaponBehind(f) {
  return Math.abs(angleDiff(f.weapon.rotation(), f.body.rotation())) > Math.PI / 2;
}

// ---------- Arrows ----------
function fireArrow(f) {
  const p = f.body.translation();
  const r = f.body.rotation();
  const a = r + (Math.random() - 0.5) * 0.12; // a little inaccuracy
  const dist = f.type.r + 1.1; // start just beyond the bow
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x + Math.cos(r) * dist, p.y + Math.sin(r) * dist)
      .setRotation(a)
      .setLinvel(Math.cos(a) * ARROW_SPEED, Math.sin(a) * ARROW_SPEED)
      .setCcdEnabled(true), // fast and thin: don't let it tunnel through things
  );
  const col = world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.3, 0.03)
      .setDensity(0.5)
      .setRestitution(0)
      .setCollisionGroups(0x0002fffd) // arrows don't collide with other arrows
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
  const gfx = new Graphics();
  gfx.rect(-0.3 * SCALE, -PIXEL / 2, 0.6 * SCALE, PIXEL).fill(0xd8c9a0);
  gfx.poly([0.3 * SCALE, -4, 0.45 * SCALE, 0, 0.3 * SCALE, 4]).fill(0xcfd3dc);
  bodyLayer.addChild(gfx);

  const arrow = { body, col, gfx, owner: f, life: ARROW_LIFE, dead: false, dx: Math.cos(a), dy: Math.sin(a) };
  colliderInfo.set(col.handle, { kind: 'arrow', arrow });
  arrows.push(arrow);
}

function removeArrow(a) {
  world.removeRigidBody(a.body);
  colliderInfo.delete(a.col.handle);
  a.gfx.destroy();
  arrows.splice(arrows.indexOf(a), 1);
}

// An arrow touched `other` (undefined means a wall or pillar).
function arrowHit(arrow, other) {
  if (arrow.dead) return;
  if (other && (other.kind === 'arrow' || other.f === arrow.owner)) return; // ignore own bow / body
  const p = arrow.body.translation();
  if (other && other.kind === 'body') {
    if (other.f.dead) return;
    arrow.dead = true;
    damage(arrow.owner, other.f, arrow.dx, arrow.dy, arrow.owner.stats.damage, arrow.owner.stats.knockback);
  } else {
    // Hit a wall, or got parried by someone's weapon.
    arrow.dead = true;
    burst(p.x, p.y, -arrow.dx, -arrow.dy, 5);
  }
}

// ---------- Fighter control ----------
// How long a stab lasts from the moment it starts, out and back.
const stabLength = (def) => def.extendTime + def.holdTime + def.retreatTime;

// How far out a stab is, `t` seconds in: 0 is the ready position, 1 fully extended.
function stabExtension(def, t) {
  if (t < def.extendTime) return 1 - (1 - t / def.extendTime) ** 2; // whips out, fastest at first
  if (t < def.extendTime + def.holdTime) return 1;
  return Math.max(0, 1 - (t - def.extendTime - def.holdTime) / def.retreatTime); // then pulls back
}

// How much a fighter's weapon is glowing red: 0 for none. It pulses while an attack charges, and
// stays at full for as long as the attack can hurt. Only fighters with several moves do this.
function dangerLevel(f) {
  if (!f.type.moves || f.dead) return 0;
  if (f.windupT > 0) return 0.45 + 0.35 * Math.sin((performance.now() / 1000) * 24);
  if (f.swingT > 0 || (f.moveDef.attack === 'stab' && f.moveT < stabLength(f.moveDef))) return 1;
  return 0;
}

function startAttack(f) {
  const { body } = f;
  const def = f.moveDef;
  const mass = body.mass();
  const r = body.rotation();
  if (def.attack === 'shoot') {
    fireArrow(f);
    return;
  }
  f.swingT = def.swingTime;
  let lunge = f.stats.lunge * (def.lungeMul || 1);
  if (def.attack === 'whirl') {
    f.whirling = true;
    camera.shake = Math.max(camera.shake, 0.3);
  }
  if (def.attack === 'stab') f.moveT = 0;
  if (def.attack === 'flick') {
    // Sweep from one side to the other. If the weapon isn't already on the starting side, snap it
    // there: its origin is the pin, so rotating it keeps it attached to the body.
    const startRel = -f.flickDir * PLAYER_ARC;
    const rel = angleDiff(f.weapon.rotation(), r);
    if (Math.abs(angleDiff(rel, startRel)) > 0.8) f.weapon.setRotation(r + startRel, true);
    f.swooshStart = f.weapon.rotation();
    f.restRel = f.flickDir * PLAYER_ARC; // afterwards the weapon rests where the swing ended
    lunge *= f.flickPower;
    camera.shake = Math.max(camera.shake, 0.12);
  }
  // Lunge forward. A flick swing also sidesteps a little toward the side the weapon is travelling
  // to (a fraction `lungeSide` of the forward lunge).
  let ix = Math.cos(r) * lunge;
  let iy = Math.sin(r) * lunge;
  if (def.attack === 'flick') {
    const side = r + (f.flickDir * Math.PI) / 2;
    ix += Math.cos(side) * lunge * f.stats.lungeSide;
    iy += Math.sin(side) * lunge * f.stats.lungeSide;
  }
  body.applyImpulse({ x: ix * mass, y: iy * mass }, true);
}

// Applies a fighter's intent (move / aim / attack) to the physics bodies.
function driveFighter(f, dt) {
  const { body, weapon, type } = f;
  f.attackCd -= dt;
  f.swingT -= dt;
  f.hitCd -= dt;
  f.flash -= dt;
  f.stagger -= dt;
  f.swooshT -= dt;
  f.noStaminaT -= dt;
  f.parryCd -= dt;
  f.disruptT -= dt;
  f.moveT += dt;
  f.recoverT -= dt;
  if (f.whirling && f.swingT <= 0) { // the whirlwind is over: he is left slowed, and without his sword
    f.whirling = false;
    f.recoverT = f.moveDef.recover;
    f.recoverSlow = f.moveDef.recoverSlow;
  }
  if (f.appliedSize !== f.stats.weaponSize) applyWeaponSize(f);
  if (f.usesStamina) {
    f.staminaDelayT -= dt;
    if (f.staminaDelayT <= 0) f.stamina = Math.min(f.stats.maxStamina, f.stamina + f.stats.staminaRegen * dt);
  }
  const mass = body.mass();
  const staggered = f.stagger > 0; // just got hit: no steering, so the body tumbles freely
  const winding = f.windupT > 0; // telegraphing an attack: planted on the spot

  if (!staggered) {
    if (!winding) {
      // Move: push toward the intended direction. Damping sets the top speed.
      const push = f.stats.accel * mass * dt * (f.recoverT > 0 ? f.recoverSlow : 1);
      body.applyImpulse({ x: f.move.x * push, y: f.move.y * push }, true);
    }
    // Turn toward the aim angle.
    body.setAngvel(clamp(angleDiff(f.aim, body.rotation()) * 14, -12, 12), true);
  }

  if (winding) {
    f.windupT -= dt;
    if (f.windupT <= 0) startAttack(f);
  } else if (!staggered && f.disruptT <= 0 && f.recoverT <= 0 && f.wantAttack && f.attackCd <= 0 && f.swingT <= 0) {
    f.wantAttack = false;
    if (f.usesStamina && f.stamina < f.stats.staminaCost) {
      f.noStaminaT = 0.3; // too tired: the swing doesn't happen
    } else {
      if (f.usesStamina) {
        f.stamina -= f.stats.staminaCost;
        f.staminaDelayT = STAMINA_REGEN_DELAY;
      }
      f.moveDef = type.moves ? type.moves[f.wantMove] || Object.values(type.moves)[0] : type;
      f.attackCd = f.stats.cooldown * (f.moveDef.cooldownMul || 1) * (f.isPlayer ? 1 : 0.85 + Math.random() * 0.3);
      if (f.moveDef.windup > 0) f.windupT = f.moveDef.windup;
      else startAttack(f);
    }
  }

  const w = type.weapon;
  const def = f.moveDef;
  const stabbing = def.attack === 'stab' && (f.windupT > 0 || f.moveT < stabLength(def));
  if (f.disruptT > 0) {
    // Knocked aside by a parry: the weapon first flies free, then is drawn back to rest behind its
    // owner and held there until the parry wears off.
    if (f.disruptMax - f.disruptT > PARRY_FLING_TIME) {
      const behind = body.rotation() + Math.PI;
      weapon.setAngvel(clamp(angleDiff(behind, weapon.rotation()) * 8, -12, 12), true);
    }
  } else if (f.swingT > 0 && def.attack === 'flick') {
    // Sweep across until the weapon reaches the far side, then the swing is over.
    const rel = angleDiff(weapon.rotation(), body.rotation());
    const endRel = f.flickDir * PLAYER_ARC;
    if (f.flickDir > 0 ? rel >= endRel : rel <= endRel) f.swingT = 0;
    else weapon.setAngvel(body.angvel() + f.flickDir * f.stats.swingSpeed * f.flickPower, true);
    f.swooshT = 0.15;
  } else if (f.swingT > 0 && (def.attack === 'arc' || def.attack === 'whirl')) {
    // A steady sweep relative to the body (a whirlwind just keeps going round).
    weapon.setAngvel(body.angvel() - f.stats.swingSpeed, true);
  } else if (stabbing) {
    // Held straight out in front, ready to stab.
    weapon.setAngvel(clamp(angleDiff(body.rotation(), weapon.rotation()) * 25, -30, 30), true);
  } else if (f.recoverT > 0) {
    // After a whirlwind the sword just hangs behind him.
    weapon.setAngvel(clamp(angleDiff(body.rotation() + Math.PI, weapon.rotation()) * 2, -3, 3), true);
  } else {
    // Hold the weapon at its resting angle (spear forward, sword trailing behind, ...).
    const target = body.rotation() + f.restRel;
    weapon.setAngvel(clamp(angleDiff(target, weapon.rotation()) * w.holdGain, -w.holdMax, w.holdMax), true);
  }

  // Where the weapon's handle sits on the body. Usually that is its resting place; the knight's
  // attacks move it: out in front for the stab, and to his middle for the whirlwind.
  let pinGoal = w.anchor;
  let pinRate = 12;
  if (def.attack === 'stab' && f.windupT > 0) {
    pinGoal = def.ready;
  } else if (def.attack === 'stab' && f.moveT < stabLength(def)) {
    const out = stabExtension(def, f.moveT);
    f.pin.x = def.ready.x + def.reach * out;
    f.pin.y = def.ready.y * (1 - out);
    pinGoal = null;
  } else if (def.attack === 'whirl' && f.swingT > 0) {
    pinGoal = { x: 0, y: 0 };
    pinRate = 20;
  }
  if (pinGoal) {
    const k = 1 - Math.exp(-pinRate * dt);
    f.pin.x += (pinGoal.x - f.pin.x) * k;
    f.pin.y += (pinGoal.y - f.pin.y) * k;
  }

  // Move the kinematic anchor to where the pin will be once this step has moved the body.
  if (f.anchor) {
    const p = body.translation();
    const v = body.linvel();
    const r = body.rotation() + body.angvel() * dt;
    f.anchor.setNextKinematicTranslation({
      x: p.x + v.x * dt + Math.cos(r) * f.pin.x - Math.sin(r) * f.pin.y,
      y: p.y + v.y * dt + Math.sin(r) * f.pin.x + Math.cos(r) * f.pin.y,
    });
  }
}

// ---------- Hit effects ----------
let hitstop = 0; // seconds of simulation freeze remaining
const sparks = [];

function burst(x, y, dirX, dirY, count) {
  const base = Math.atan2(dirY, dirX);
  for (let i = 0; i < count; i++) {
    const a = base + (Math.random() - 0.5) * 1.8;
    const speed = 4 + Math.random() * 9;
    sparks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0.2 + Math.random() * 0.25 });
  }
}

// Blood sprays out of a hit as drops. Each one that lands leaves a small stain on the floor.
const drops = [];

function bloodBurst(x, y, dirX, dirY, count) {
  const base = Math.atan2(dirY, dirX);
  for (let i = 0; i < count; i++) {
    const forward = Math.random() < 0.7; // most sprays along the blow, the rest dribbles out any which way
    const a = forward ? base + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2;
    const speed = forward ? 3 + Math.random() * 8 : 1 + Math.random() * 3;
    drops.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0.25 + Math.random() * 0.4, r: 0.04 + Math.random() * 0.05 });
  }
}

function updateBlood(dt) {
  bloodGfx.clear();
  const drag = Math.pow(0.03, dt);
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.life -= dt;
    if (d.life <= 0) {
      gore.droplet(d.x, d.y);
      drops.splice(i, 1);
      continue;
    }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vx *= drag;
    d.vy *= drag;
    bloodGfx.circle(d.x * SCALE, d.y * SCALE, d.r * SCALE).fill(0xb3261e);
  }
}

// The moment a fighter is killed its picture becomes a corpse, which then slides and tumbles with
// the body. (When it stops, leaveCorpse paints the identical corpse onto the floor.)
function becomeCorpse(f) {
  f.corpseSeed = Math.floor(Math.random() * 1e9);
  const lying = gore.makeCorpseGfx(f.type, f.corpseSeed);
  bodyLayer.addChildAt(lying, 0); // under everything that is still standing
  f.gfx.destroy({ children: true });
  f.gfx = lying;
}

// Leaves a fallen fighter on the floor where it ended up, with its weapon lying beside it.
function leaveCorpse(f) {
  const p = f.body.translation();
  const w = f.weapon.translation();
  const weaponGfx = makeWeaponGfx(f.type);
  weaponGfx.position.set(w.x * SCALE, w.y * SCALE);
  weaponGfx.rotation = f.weapon.rotation();
  weaponGfx.scale.set(f.stats.weaponSize);
  weaponGfx.tint = 0x8a8680;
  gore.corpse(p.x, p.y, f.body.rotation(), f.type, f.corpseSeed, weaponGfx);
}

function updateSparks(dt) {
  sparksGfx.clear();
  const drag = Math.pow(0.02, dt);
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    if (s.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vx *= drag;
    s.vy *= drag;
    sparksGfx
      .moveTo(s.x * SCALE, s.y * SCALE)
      .lineTo((s.x - s.vx * 0.04) * SCALE, (s.y - s.vy * 0.04) * SCALE)
      .stroke({ width: PIXEL, color: 0xffd27a, alpha: Math.min(1, s.life * 5) });
  }
}

// `attacker` is whoever dealt the hit; (dx, dy) is the unit direction the victim is shoved.
function damage(attacker, victim, dx, dy, amount, knockback) {
  // A swordsman's sword is behind it, so it can't guard: hits land for double.
  if (victim.type.weakBehind && weaponBehind(victim)) amount *= 2;

  victim.hp -= amount;
  victim.hitCd = 0.25;
  victim.flash = 0.15;
  victim.stagger = attacker.stats.stagger;
  victim.swingT = 0; // a hit interrupts whatever the victim was doing
  victim.windupT = 0;
  victim.moveT = Infinity;
  const killed = victim.hp <= 0;
  if (killed) {
    victim.dead = true;
    victim.deathT = DEATH_SLIDE;
    becomeCorpse(victim);
  }

  // Launch the victim and send it spinning.
  const launch = knockback * victim.stats.resist * (killed ? 1.4 : 1);
  victim.body.setLinvel({ x: dx * launch, y: dy * launch }, true);
  victim.body.setAngvel((Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 8), true);

  // Impact feedback is strongest when the player is involved, and for heavy hits.
  const involvesPlayer = victim.isPlayer || attacker.isPlayer;
  const power = (involvesPlayer ? 1 : 0.5) * (killed ? 1.4 : 1) * clamp(knockback / 12, 0.6, 1.6);
  hitstop = Math.max(hitstop, HITSTOP * power);
  camera.shake = Math.max(camera.shake, HIT_SHAKE * power);
  camera.kickX += dx * HIT_KICK * power;
  camera.kickY += dy * HIT_KICK * power;
  camera.punch = Math.max(camera.punch, HIT_ZOOM_PUNCH * power);
  const v = victim.body.translation();
  bloodBurst(v.x - dx * victim.type.r, v.y - dy * victim.type.r, dx, dy, killed ? 30 : 14);
  gore.splat(v.x, v.y, killed ? 1.6 : 1);
}

function tryHit(weaponSide, bodySide) {
  if (weaponSide.kind !== 'weapon' || bodySide.kind !== 'body') return;
  const attacker = weaponSide.f;
  const victim = bodySide.f;
  // Only an active attack hurts, never the owner, and victims get a brief grace period.
  if (attacker === victim || victim.dead || attacker.swingT <= 0 || victim.hitCd > 0) return;
  const a = attacker.body.translation();
  const v = victim.body.translation();
  const len = Math.hypot(v.x - a.x, v.y - a.y) || 1;
  let dx = (v.x - a.x) / len;
  let dy = (v.y - a.y) / len;
  let knockback = attacker.stats.knockback * (attacker.moveDef.knockbackMul || 1);
  if (attacker.isPlayer) {
    // The player's hits follow the sweep: victims are flung the way the weapon was travelling
    // (as well as away from you), and a harder flick hits harder.
    const wv = attacker.weapon.linvel();
    const ws = Math.hypot(wv.x, wv.y);
    if (ws > 1) {
      dx += wv.x / ws;
      dy += wv.y / ws;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
    }
    knockback *= attacker.flickPower;
  }
  damage(attacker, victim, dx, dy, attacker.stats.damage * (attacker.moveDef.damageMul || 1), knockback);
}

// A swing that connects with another fighter's weapon knocks it aside. The `parry` stat sets how
// hard (spin given to the weapon, and how long it stays disrupted); it is separate from knockback,
// which acts on bodies. A disrupted weapon flails free and its owner's attack is cancelled.
function tryParry(mine, theirs) {
  if (mine.kind !== 'weapon' || theirs.kind !== 'weapon') return;
  const attacker = mine.f;
  const victim = theirs.f;
  if (attacker === victim || victim.dead || attacker.swingT <= 0 || victim.parryCd > 0) return;
  const parry = attacker.stats.parry;
  if (parry <= 0) return;
  victim.parryCd = 0.25;

  // Spin it the way the swing is travelling: compare the swing's velocity with where the victim's
  // weapon sits relative to its pin. (Falls back to the swing's own rotation if that is ambiguous.)
  const pin = victim.weapon.translation();
  const a = victim.weapon.rotation();
  const reach = victim.type.weapon.ox * victim.stats.weaponSize;
  const arm = { x: Math.cos(a) * reach, y: Math.sin(a) * reach };
  const v = attacker.weapon.linvel();
  const cross = arm.x * v.y - arm.y * v.x;
  const dir = Math.abs(cross) > 0.5 ? Math.sign(cross) : Math.sign(attacker.weapon.angvel()) || 1;

  // Spin the weapon about its pin. Heavier weapons are harder to move. The linear velocity is set to
  // match the rotation (v = omega x arm); spin alone fights the pin and barely moves it.
  const omega = (dir * parry * PARRY_SPIN) / Math.max(1, victim.weapon.mass());
  const bv = victim.body.linvel();
  victim.weapon.setAngvel(omega, true);
  victim.weapon.setLinvel({ x: bv.x - omega * arm.y, y: bv.y + omega * arm.x }, true);
  victim.disruptT = victim.disruptMax = PARRY_BASE_TIME + PARRY_TIME_PER_POINT * parry;
  victim.windupT = 0;
  victim.swingT = 0;
  victim.moveT = Infinity;
  victim.attackCd = Math.max(victim.attackCd, 0.6);

  const tip = { x: pin.x + arm.x, y: pin.y + arm.y };
  burst(tip.x, tip.y, v.x, v.y, 8);
  hitstop = Math.max(hitstop, 0.04);
  if (attacker.isPlayer || victim.isPlayer) camera.shake = Math.max(camera.shake, 0.25);
}

function handleContact(h1, h2) {
  const a = colliderInfo.get(h1);
  const b = colliderInfo.get(h2);
  if (a && a.kind === 'arrow') arrowHit(a.arrow, b);
  else if (b && b.kind === 'arrow') arrowHit(b.arrow, a);
  if (!a || !b) return;
  tryHit(a, b);
  tryHit(b, a);
  tryParry(a, b);
  tryParry(b, a);
}

// ---------- Input ----------
// The cursor steers the player, and flicking it around the player swings the weapon.
// Positions are in CSS pixels. `trail` is the last FLICK_WINDOW ms of cursor movement.
const mouse = { sx: window.innerWidth / 2, sy: window.innerHeight / 2 };
const trail = []; // { t, x, y }
window.addEventListener('pointermove', (e) => {
  mouse.sx = e.clientX;
  mouse.sy = e.clientY;
  if (state === 'playing') trail.push({ t: performance.now(), x: e.clientX, y: e.clientY });
});

// Looks at how the cursor moved around the player (at screen position px, py) recently.
// Returns { dir, power } for a flick: dir is +1 for clockwise, -1 for counter-clockwise on screen,
// and power says how hard it was. Otherwise returns null.
function detectFlick(px, py) {
  const now = performance.now();
  while (trail.length && now - trail[0].t > FLICK_WINDOW) trail.shift();
  if (trail.length < 2) return null;

  // Add up the sideways part of each small movement: how far the cursor travelled *around*
  // the player rather than toward or away from them. Positive is clockwise on screen.
  let around = 0;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const rx = (a.x + b.x) / 2 - px;
    const ry = (a.y + b.y) / 2 - py;
    const radius = Math.hypot(rx, ry);
    if (radius < FLICK_MIN_RADIUS) continue;
    around += (rx * (b.y - a.y) - ry * (b.x - a.x)) / radius;
  }
  const seconds = (trail[trail.length - 1].t - trail[0].t) / 1000;
  if (seconds < 0.02) return null;
  const speed = around / seconds;
  if (Math.abs(around) < FLICK_MIN_DIST || Math.abs(speed) < FLICK_SPEED) return null;

  trail.length = 0; // use up this movement so it can't trigger twice
  return { dir: Math.sign(around), power: clamp(Math.abs(speed) / 2200, 0.8, 1.5) };
}

// Converts the mouse's screen position to world metres, using the current camera.
function mouseWorld() {
  return {
    x: (mouse.sx - view.x) / (view.scale.x * SCALE),
    y: (mouse.sy - view.y) / (view.scale.y * SCALE),
  };
}

// ---------- Game state ----------
const titleEl = document.getElementById('title');
let state = 'title'; // 'title' (waiting for a key), 'playing', or 'paused' (dev stat panel open)
let player = null;
let wave = 0;
let nextWaveTimer = 0;
let restartTimer = 0;

function spawnWave(n) {
  // Every type shows up from wave 1 so they can all be tested; counts grow with the wave.
  const roster = [
    ...Array(2 + n).fill('spearman'),
    ...Array(Math.min(n, 3)).fill('swordsman'),
    ...Array(Math.min(n, 3)).fill('archer'),
  ];
  for (const typeName of roster) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 9 + Math.random() * 2;
    createFighter(typeName, ARENA_W / 2 + Math.cos(angle) * radius, ARENA_H / 2 + Math.sin(angle) * radius);
  }
}

function resetGame() {
  for (const a of [...arrows]) removeArrow(a);
  for (const f of [...fighters]) removeFighter(f);
  sparks.length = 0;
  drops.length = 0;
  gore.clear();
  trail.length = 0;
  hitstop = 0;
  nextWaveTimer = 0;
  restartTimer = 0;
  wave = 1;
  player = createFighter('player', ARENA_W / 2, ARENA_H / 2);
  Object.assign(player.stats, devStats); // keep any stats tuned in the dev panel
  player.hp = player.stats.maxHp;
  player.stamina = player.stats.maxStamina;
  spawnWave(wave);
  const p = player.body.translation();
  camera.x = p.x;
  camera.y = p.y;
  camera.kickX = camera.kickY = camera.shake = camera.punch = 0;
}

// ---------- Developer tool: pause and tune the player's stats ----------
// Press P to pause and open the panel. Changes apply to the live player immediately, and are kept
// when the game restarts (R or dying) until "Reset stats" is pressed. Shift-click moves a stat
// five steps at once. The values shown are the raw stats (so for attack delay, lower is faster).
const STAT_DEFS = [
  { key: 'maxHp', label: 'Max HP', step: 1, min: 1 },
  { key: 'accel', label: 'Move speed', step: 2, min: 2 },
  { key: 'cooldown', label: 'Attack delay (s)', step: 0.02, min: 0.06 },
  { key: 'lunge', label: 'Dash power', step: 1, min: 0 },
  { key: 'lungeSide', label: 'Dash sidestep (x)', step: 0.05, min: 0 },
  { key: 'swingSpeed', label: 'Swing speed', step: 2, min: 4 },
  { key: 'damage', label: 'Damage', step: 1, min: 1 },
  { key: 'knockback', label: 'Swing power', step: 2, min: 0 },
  { key: 'stagger', label: 'Stagger (s)', step: 0.05, min: 0 },
  { key: 'resist', label: 'Knockback taken', step: 0.1, min: 0.1 },
  { key: 'parry', label: 'Parry', step: 1, min: 0 },
  { key: 'weaponSize', label: 'Weapon size (x)', step: 0.1, min: 0.5 },
  { key: 'maxStamina', label: 'Max stamina', step: 10, min: 10 },
  { key: 'staminaCost', label: 'Stamina per swing', step: 5, min: 0 },
  { key: 'staminaRegen', label: 'Stamina regen /s', step: 5, min: 1 },
];
const devStats = {}; // stat key -> value, only for stats changed in the panel
const devPanel = document.getElementById('devpanel');
const devValueEls = {};
const round3 = (v) => Math.round(v * 1000) / 1000;

function devButton(text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', (e) => {
    onClick(e);
    b.blur(); // so a later Space or Enter doesn't "click" it again
  });
  return b;
}

function renderDevPanel() {
  for (const def of STAT_DEFS) {
    devValueEls[def.key].textContent = player ? round3(player.stats[def.key]) : '';
  }
}

function changeStat(def, direction, steps) {
  if (!player) return;
  const old = player.stats[def.key];
  const value = Math.max(def.min, round3(old + direction * def.step * steps));
  player.stats[def.key] = value;
  devStats[def.key] = value;
  // Raising a pool also fills the new part of it; lowering it clamps what's left.
  if (def.key === 'maxHp') player.hp = Math.min(value, player.hp + Math.max(0, value - old));
  if (def.key === 'maxStamina') player.stamina = Math.min(value, player.stamina + Math.max(0, value - old));
  renderDevPanel();
}

function buildDevPanel() {
  const rows = document.getElementById('devrows');
  for (const def of STAT_DEFS) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = def.label;
    const value = document.createElement('span');
    value.className = 'value';
    devValueEls[def.key] = value;
    row.append(
      label,
      devButton('−', (e) => changeStat(def, -1, e.shiftKey ? 5 : 1)),
      value,
      devButton('+', (e) => changeStat(def, 1, e.shiftKey ? 5 : 1)),
    );
    rows.appendChild(row);
  }
  document.getElementById('dev-heal').addEventListener('click', () => {
    if (!player) return;
    player.hp = player.stats.maxHp;
    player.stamina = player.stats.maxStamina;
  });
  document.getElementById('dev-reset').addEventListener('click', () => {
    for (const k of Object.keys(devStats)) delete devStats[k];
    if (!player) return;
    player.stats = makeStats(TYPES.player);
    player.hp = Math.min(player.hp, player.stats.maxHp);
    player.stamina = Math.min(player.stamina, player.stats.maxStamina);
    renderDevPanel();
  });
  document.getElementById('dev-resume').addEventListener('click', () => setPaused(false));
}
buildDevPanel();

function setPaused(paused) {
  state = paused ? 'paused' : 'playing';
  devPanel.style.display = paused ? 'block' : 'none';
  if (paused) renderDevPanel();
  else trail.length = 0; // don't let cursor movement from the panel count as a flick
}

// R resets everything back to the title screen. M mutes the music. P pauses and opens the stat
// panel. Any other key starts the game.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const key = e.key.toLowerCase();
  if (key === 'r') {
    resetGame();
    state = 'title';
    devPanel.style.display = 'none';
    titleEl.style.display = 'flex';
  } else if (key === 'm' && state !== 'title') {
    toggleMute();
  } else if (key === 'p' && state !== 'title') {
    setPaused(state === 'playing');
  } else if (state === 'title') {
    state = 'playing';
    titleEl.style.display = 'none';
    startMusic(); // needs a key press first: browsers block audio until the user interacts
  }
});

// ---------- Thinking: where each fighter wants to go ----------
// The player walks toward the cursor, easing off as it gets close, and faces it. A flick of the
// cursor around the player swings the weapon the same way.
function playerThink(f) {
  const p = f.body.translation();
  const m = mouseWorld();
  const dx = m.x - p.x;
  const dy = m.y - p.y;
  const dist = Math.hypot(dx, dy) || 1;
  const strength = clamp((dist - 0.8) / 1.5, 0, 1);
  f.aim = Math.atan2(dy, dx);
  f.move.x = (dx / dist) * strength;
  f.move.y = (dy / dist) * strength;

  f.wantAttack = false;
  if (f.attackCd <= 0 && f.stagger <= 0) {
    const flick = detectFlick(view.x + p.x * SCALE * view.scale.x, view.y + p.y * SCALE * view.scale.y);
    if (flick) {
      f.flickDir = flick.dir;
      f.flickPower = flick.power;
      f.wantAttack = true;
    }
  }
}

// Info about the player relative to this fighter, or null if there's nobody to chase.
function targetInfo(f) {
  if (!player || player.dead) return null;
  const p = f.body.translation();
  const t = player.body.translation();
  const dx = t.x - p.x;
  const dy = t.y - p.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { p, t, dx, dy, dist, ux: dx / dist, uy: dy / dist };
}

function idle(f) {
  f.move.x = f.move.y = 0;
  f.wantAttack = false;
}

// Spearmen creep up, hold the spear out front, and now and then dash in point-first.
function spearmanThink(f, dt) {
  const t = targetInfo(f);
  if (!t) return idle(f);
  f.aim = Math.atan2(t.dy, t.dx);
  const w = f.type.weapon;
  const reach = w.anchor.x + w.hx * 2 * f.stats.weaponSize; // how far the spear tip is from the centre
  const s = t.dist > reach + 0.4 ? 1 : t.dist < reach - 0.3 ? -0.6 : 0; // hold a spear's length away
  f.move.x = t.ux * s;
  f.move.y = t.uy * s;

  if (t.dist < reach + 1.0) {
    f.swingTimer -= dt;
    if (f.swingTimer <= 0) {
      f.wantAttack = true;
      f.swingTimer = 1.0 + Math.random() * 2.0;
    }
  } else {
    f.wantAttack = false;
  }
}

// The black knight plods toward you. In stab range he stabs (now and then whirling instead); from
// further off he launches into a whirlwind to close the gap. Only when he is ready for an attack:
// not recovering, winding up, or mid-swing.
const KNIGHT_STAB_RANGE = 3.6; // metres: his sword reaches a bit over 4
const KNIGHT_WHIRL_RANGE = 8; // metres: his dash is about 5 and the sword sweeps 2 beyond that
const KNIGHT_WHIRL_CHANCE_CLOSE = 0.25; // chance he whirls instead of stabbing when you are in stab range

function swordsmanThink(f, dt) {
  const t = targetInfo(f);
  if (!t) return idle(f);
  f.aim = Math.atan2(t.dy, t.dx);
  const s = t.dist > 3.2 ? 1 : 0;
  f.move.x = t.ux * s;
  f.move.y = t.uy * s;

  f.wantAttack = false;
  const ready = f.attackCd <= 0 && f.recoverT <= 0 && f.swingT <= 0 && f.windupT <= 0 && f.disruptT <= 0 && f.stagger <= 0;
  if (!ready) return;
  f.swingTimer -= dt; // a short pause between deciding, so he doesn't act the instant he is ready
  if (f.swingTimer > 0) return;
  if (t.dist < KNIGHT_STAB_RANGE) {
    f.wantMove = Math.random() < KNIGHT_WHIRL_CHANCE_CLOSE ? 'whirl' : 'stab';
  } else if (t.dist < KNIGHT_WHIRL_RANGE) {
    f.wantMove = 'whirl';
  } else {
    return;
  }
  f.wantAttack = true;
  f.swingTimer = 0.3 + Math.random() * 0.5;
}

// Is there a clear straight line from `from` to the player? Their own body and weapon don't count.
function lineClear(from, self) {
  const t = player.body.translation();
  const dx = t.x - from.x;
  const dy = t.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.01) return true;
  const ray = new RAPIER.Ray(from, { x: dx / dist, y: dy / dist });
  const hit = world.castRay(ray, dist, true, undefined, undefined, undefined, undefined, (collider) => {
    const info = colliderInfo.get(collider.handle);
    return !(info && (info.f === self || info.f === player));
  });
  return !hit;
}

// Picks the best of a handful of nearby candidate spots: a good shooting distance from the
// player, a clear line of fire, away from other fighters and pillars, and not too far to walk.
function chooseSafeSpot(f) {
  const p = f.body.translation();
  const t = player.body.translation();
  let best = null;
  let bestScore = -Infinity;
  const candidates = [{ x: p.x, y: p.y, bonus: 1.5 }]; // staying put gets a small bonus
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 8;
    candidates.push({
      x: clamp(p.x + Math.cos(a) * r, 2.5, ARENA_W - 2.5),
      y: clamp(p.y + Math.sin(a) * r, 2.5, ARENA_H - 2.5),
      bonus: 0,
    });
  }
  for (const c of candidates) {
    let score = c.bonus - Math.abs(Math.hypot(c.x - t.x, c.y - t.y) - 9); // ideal range: 9 m
    if (lineClear(c, f)) score += 4;
    for (const o of fighters) {
      if (o === f || o.dead) continue;
      const d = Math.hypot(o.body.translation().x - c.x, o.body.translation().y - c.y);
      if (d < 3) score -= (3 - d) * 1.5; // stay out of the crowd
    }
    for (const pil of PILLARS) {
      const d = Math.hypot(pil.x - c.x, pil.y - c.y);
      if (d < 2) score -= (2 - d) * 4; // don't stand inside a pillar
    }
    score -= Math.hypot(c.x - p.x, c.y - p.y) * 0.15; // prefer short walks
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// Archers keep away, lead their shots, and only fire when they have a clear line.
function archerThink(f, dt) {
  const t = targetInfo(f);
  if (!t) return idle(f);

  // Re-pick a safe spot regularly, and much more often when the player is close.
  f.spotT -= dt;
  if (!f.spot || f.spotT <= 0) {
    f.spot = chooseSafeSpot(f);
    f.spotT = t.dist < 5 ? 0.3 : 0.9;
  }
  const sx = f.spot.x - t.p.x;
  const sy = f.spot.y - t.p.y;
  const sd = Math.hypot(sx, sy) || 1;
  const s = clamp((sd - 0.4) / 1.5, 0, 1);
  f.move.x = (sx / sd) * s;
  f.move.y = (sy / sd) * s;

  // Face where the player is about to be.
  const v = player.body.linvel();
  const lead = (t.dist / ARROW_SPEED) * 0.7;
  f.aim = Math.atan2(t.t.y + v.y * lead - t.p.y, t.t.x + v.x * lead - t.p.x);

  // Shoot when settled with a clear shot.
  const own = f.body.linvel();
  f.wantAttack = t.dist < 14 && Math.hypot(own.x, own.y) < 1.6 && lineClear(t.p, f);
}

const AI = { spearman: spearmanThink, swordsman: swordsmanThink, archer: archerThink };

// ---------- Simulation step ----------
function simulate(dt) {
  for (const f of fighters) {
    if (f.dead) continue;
    if (f.isPlayer) playerThink(f);
    else AI[f.typeName](f, dt);
    driveFighter(f, dt);
  }
  for (const a of arrows) {
    a.life -= dt;
    if (a.life <= 0) a.dead = true;
  }

  world.step(events);
  events.drainCollisionEvents((h1, h2, started) => {
    if (started) handleContact(h1, h2);
  });

  for (const a of [...arrows]) if (a.dead) removeArrow(a);
  for (const f of [...fighters]) {
    if (!f.dead) continue;
    if (f === player && restartTimer <= 0) restartTimer = 2.5;
    if (f.corpseDone) continue;
    // A killed fighter isn't driven any more, so its corpse just keeps sliding and tumbling from
    // the blow for a moment (its hit flash has to be ended here too) before it settles.
    f.flash -= dt;
    f.deathT -= dt;
    const v = f.body.linvel();
    if (Math.hypot(v.x, v.y) > 1.5 && Math.random() < 0.6) { // bleeding as it slides
      const p = f.body.translation();
      gore.droplet(p.x + (Math.random() - 0.5) * 0.2, p.y + (Math.random() - 0.5) * 0.2);
    }
    if (f.deathT > 0) continue;
    leaveCorpse(f);
    if (f === player) {
      f.corpseDone = true;
      f.body.setEnabled(false);
      f.weapon.setEnabled(false);
      if (f.anchor) f.anchor.setEnabled(false);
      f.gfx.visible = f.weaponGfx.visible = false;
    } else {
      removeFighter(f);
    }
  }

  const enemiesLeft = fighters.some((f) => !f.isPlayer);
  if (player && !player.dead && !enemiesLeft) {
    nextWaveTimer += dt;
    if (nextWaveTimer > 1.5) {
      nextWaveTimer = 0;
      wave += 1;
      spawnWave(wave);
    }
  }
  if (player && player.dead) {
    restartTimer -= dt;
    if (restartTimer <= 0) resetGame();
  }
}

// ---------- Camera ----------
// The camera drifts toward the player, leaning toward the cursor and the direction of travel.
// It zooms out slightly at speed. Hits shake it, shove it along the hit, and punch the zoom in.
const camera = { x: ARENA_W / 2, y: ARENA_H / 2, zoom: 1, shake: 0, kickX: 0, kickY: 0, punch: 0 };

function updateCamera(dt) {
  const smooth = 1 - Math.exp(-dt * 4);
  let zoomTarget = app.screen.height / (VIEW_H * SCALE);

  if (player && !player.dead) {
    const p = player.body.translation();
    const v = player.body.linvel();
    const m = mouseWorld();
    const targetX = p.x + clamp((m.x - p.x) * 0.35, -4, 4) + v.x * 0.25;
    const targetY = p.y + clamp((m.y - p.y) * 0.35, -4, 4) + v.y * 0.25;
    camera.x += (targetX - camera.x) * smooth;
    camera.y += (targetY - camera.y) * smooth;
    zoomTarget *= 1 - Math.min(Math.hypot(v.x, v.y) * 0.03, 0.15);
  }
  camera.zoom += (zoomTarget - camera.zoom) * smooth;

  // Impact effects decay quickly.
  const kickDecay = Math.exp(-dt * 8);
  camera.kickX *= kickDecay;
  camera.kickY *= kickDecay;
  camera.punch *= Math.exp(-dt * 7);
  camera.shake = Math.max(0, camera.shake - dt * 2.5);

  const zoom = camera.zoom * (1 + camera.punch);

  // Keep the view inside the arena plus VIEW_MARGIN of wall and stands (or centred if that is
  // smaller than the view).
  const halfW = app.screen.width / (2 * zoom * SCALE);
  const halfH = app.screen.height / (2 * zoom * SCALE);
  const cx = halfW * 2 >= ARENA_W + 2 * VIEW_MARGIN
    ? ARENA_W / 2
    : clamp(camera.x + camera.kickX, halfW - VIEW_MARGIN, ARENA_W - halfW + VIEW_MARGIN);
  const cy = halfH * 2 >= ARENA_H + 2 * VIEW_MARGIN
    ? ARENA_H / 2
    : clamp(camera.y + camera.kickY, halfH - VIEW_MARGIN, ARENA_H - halfH + VIEW_MARGIN);

  const shakeX = (Math.random() - 0.5) * camera.shake * 40;
  const shakeY = (Math.random() - 0.5) * camera.shake * 40;

  // Snap the camera to whole low-res pixels (one is `snap` screen pixels wide) so the arena's
  // edges don't shimmer as the camera drifts and shakes.
  const snap = app.screen.height / LOWRES_H;
  view.scale.set(zoom);
  view.position.set(
    Math.round((app.screen.width / 2 - cx * SCALE * zoom + shakeX) / snap) * snap,
    Math.round((app.screen.height / 2 - cy * SCALE * zoom + shakeY) / snap) * snap,
  );
}

// ---------- Drawing ----------
// Soft drop shadows, with the light coming from the upper left (like the pillars' shadows in
// arena-art.js). Bodies are round, the player's is a wide oval, and weapons cast a shadow of
// their collider box. One flat dark shape each.
const SHADOW_X = 0.14; // metres the shadows are shifted right...
const SHADOW_Y = 0.2; // ...and down
const SHADOW_STYLE = { color: 0x000000, alpha: 0.3 };

function drawShadows() {
  shadowGfx.clear();
  for (const f of fighters) {
    if (!f.gfx.visible) continue;
    const t = f.body.translation();
    const cx = t.x + SHADOW_X;
    const cy = t.y + SHADOW_Y;
    if (f.dead) {
      // A corpse is lying flat, so only its weapon still casts a shadow.
    } else if (f.isPlayer) {
      // An oval as wide as the shoulders, turned with the body.
      const r = f.body.rotation();
      const pts = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const ex = Math.cos(a) * PLAYER_SHADOW.rx;
        const ey = Math.sin(a) * PLAYER_SHADOW.ry;
        pts.push((cx + ex * Math.cos(r) - ey * Math.sin(r)) * SCALE, (cy + ex * Math.sin(r) + ey * Math.cos(r)) * SCALE);
      }
      shadowGfx.poly(pts).fill(SHADOW_STYLE);
    } else {
      const size = ENEMY_SIZE[f.typeName] || 1.1; // bigger pictures cast bigger shadows
      shadowGfx.circle(cx * SCALE, cy * SCALE, f.type.r * size * 0.95 * SCALE).fill(SHADOW_STYLE);
    }

    // The weapon: its collider box, which is centred `ox` along the weapon from the handle pin.
    const w = f.type.weapon;
    const s = f.stats.weaponSize;
    const p = f.weapon.translation();
    const a = f.weapon.rotation();
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const mx = p.x + ca * w.ox * s + SHADOW_X;
    const my = p.y + sa * w.ox * s + SHADOW_Y;
    const corner = (u, v) => [(mx + ca * u * w.hx * s - sa * v * w.hy * s) * SCALE, (my + sa * u * w.hx * s + ca * v * w.hy * s) * SCALE];
    shadowGfx.poly([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].flat()).fill(SHADOW_STYLE);
  }
}

function drawFighters(dt) {
  aimGfx.clear();
  glowGfx.clear();
  drawShadows();
  for (const f of fighters) {
    const t = f.body.translation();
    f.gfx.position.set(t.x * SCALE, t.y * SCALE);
    f.gfx.rotation = f.body.rotation();

    // The player's gladiator follows the weapon with their arms and leans into a swing.
    if (f.gfx.pose) {
      const wp = f.weapon.translation();
      const r = f.body.rotation();
      const dx = wp.x - t.x;
      const dy = wp.y - t.y;
      f.gfx.pose({
        pinX: dx * Math.cos(r) + dy * Math.sin(r), // the handle's position in the body's own frame
        pinY: -dx * Math.sin(r) + dy * Math.cos(r),
        rel: angleDiff(f.weapon.rotation(), r),
        swinging: f.swingT > 0,
        dir: f.flickDir,
        dt,
      });
    }
    // A hit makes the victim flash and pop bigger for a moment.
    f.gfx.alpha = f.flash > 0 ? 0.5 : 1;
    f.gfx.scale.set(f.flash > 0 ? 1.3 : 1);

    const w = f.weapon.translation();
    f.weaponGfx.position.set(w.x * SCALE, w.y * SCALE);
    f.weaponGfx.rotation = f.weapon.rotation();

    // The player's swing leaves a fading arc along the path of the weapon tip.
    if (f.isPlayer && f.swooshT > 0) {
      const sweep = ((f.flickDir * (f.weapon.rotation() - f.swooshStart)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (sweep < 4.5) {
        const reach = f.type.weapon.hx * 1.8 * f.stats.weaponSize * SCALE;
        aimGfx
          .moveTo(w.x * SCALE + Math.cos(f.swooshStart) * reach, w.y * SCALE + Math.sin(f.swooshStart) * reach)
          .arc(w.x * SCALE, w.y * SCALE, reach, f.swooshStart, f.swooshStart + f.flickDir * sweep, f.flickDir < 0)
          .stroke({ width: PIXEL * 3, color: 0xbfe8e4, alpha: Math.min(1, f.swooshT / 0.15) * 0.45 });
      }
    }

    // Wind-up telegraph: the weapon glows orange (red, with a halo, for the black knight), and an
    // archer shows its line of fire.
    const glow = dangerLevel(f);
    if (glow > 0) {
      const len = f.type.weapon.hx * 2 * f.stats.weaponSize;
      const tipX = w.x + Math.cos(f.weapon.rotation()) * len;
      const tipY = w.y + Math.sin(f.weapon.rotation()) * len;
      for (const [width, alpha] of [[0.6, 0.12], [0.36, 0.2], [0.2, 0.35]]) {
        glowGfx.moveTo(w.x * SCALE, w.y * SCALE).lineTo(tipX * SCALE, tipY * SCALE)
          .stroke({ width: width * SCALE, color: 0xff2a1a, alpha: alpha * glow, cap: 'round' });
      }
    }
    f.weaponGfx.tint = f.dead ? 0x8a8680 : glow > 0 ? 0xff5040 : f.windupT > 0 ? 0xff9955
      : f.recoverT > 0 ? 0x8a8a96 : f.disruptT > 0 ? 0x88ddff : 0xffffff;
    if (f.windupT > 0 && f.type.attack === 'shoot') {
      const r = f.body.rotation();
      aimGfx
        .moveTo(t.x * SCALE, t.y * SCALE)
        .lineTo((t.x + Math.cos(r) * 10) * SCALE, (t.y + Math.sin(r) * 10) * SCALE)
        .stroke({ width: PIXEL, color: 0xff6644, alpha: 0.35 });
    }
  }
  for (const a of arrows) {
    const t = a.body.translation();
    a.gfx.position.set(t.x * SCALE, t.y * SCALE);
    a.gfx.rotation = a.body.rotation();
  }
}

// A thin health bar under the player, and a stamina ring around it. Both fade back when full.
function drawPlayerHud() {
  hudGfx.clear();
  if (!player || player.dead) return;
  const t = player.body.translation();
  const cx = t.x * SCALE;
  const cy = t.y * SCALE;
  const r = player.type.r;

  const stamina = clamp(player.stamina / player.stats.maxStamina, 0, 1);
  const tired = player.noStaminaT > 0; // tried to swing with nothing left: flash the ring red
  const ringR = (r + 0.22) * SCALE;
  hudGfx.circle(cx, cy, ringR).stroke({ width: PIXEL, color: 0xffffff, alpha: 0.08 });
  if (tired) {
    hudGfx.circle(cx, cy, ringR).stroke({ width: PIXEL * 2, color: 0xd9534f, alpha: 0.85 });
  } else if (stamina > 0.01) {
    // moveTo first: otherwise arc() draws a line to its start from wherever the last path ended.
    hudGfx
      .moveTo(cx, cy - ringR)
      .arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * stamina)
      .stroke({ width: PIXEL * 2, color: 0xe6c35c, alpha: stamina >= 0.999 ? 0.25 : 0.85 });
  }

  const hp = clamp(player.hp / player.stats.maxHp, 0, 1);
  const barW = 1.2 * SCALE;
  const barX = cx - barW / 2;
  const barY = cy + (r + 0.5) * SCALE;
  hudGfx.rect(barX, barY, barW, PIXEL * 2).fill({ color: 0x000000, alpha: 0.45 });
  hudGfx.rect(barX, barY, barW * hp, PIXEL * 2).fill({ color: hp < 0.34 ? 0xc44848 : 0x58c4a8, alpha: hp >= 1 ? 0.35 : 0.9 });
}

const status = document.getElementById('status');

let accumulator = 0;
app.ticker.add((ticker) => {
  const frameDt = Math.min(ticker.deltaMS / 1000, 0.1); // cap so a tab switch doesn't cause a huge jump

  if (state === 'playing') {
    if (hitstop > 0) {
      hitstop -= frameDt; // frozen: physics and timers stand still, camera and sparks keep going
      for (const s of trail) s.t += frameDt * 1000; // and a flick made during the freeze doesn't expire
    } else {
      accumulator += frameDt;
      while (accumulator >= world.timestep) {
        simulate(world.timestep);
        accumulator -= world.timestep;
      }
    }
  }
  if (state !== 'paused') {
    // While paused the cursor is over the stat panel, so the camera must not follow it.
    updateCamera(frameDt);
    updateSparks(frameDt);
    updateBlood(frameDt);
  }
  gore.flush();
  arena.update(performance.now() / 1000);
  drawFighters(state === 'paused' ? 0 : frameDt);
  drawPlayerHud();

  const count = (name) => fighters.filter((f) => f.typeName === name && !f.dead).length;
  const text = state === 'paused'
    ? 'Paused'
    : player && !player.dead
    ? `Wave ${wave}   Spearmen ${count('spearman')}   Swordsmen ${count('swordsman')}   Archers ${count('archer')}`
    : 'You died. Restarting...';
  if (status.textContent !== text) status.textContent = text;
});

resetGame();
