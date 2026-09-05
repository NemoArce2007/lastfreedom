// AI：警方追击 / 逃犯逃逸 / 路人车流
import { segmentHitsAABB } from './world.js';

const TAU = Math.PI * 2;
function wrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

// 网格 BFS：返回下一步节点
function bfsNext(world, from, to) {
  if (from.i === to.i && from.j === to.j) return null;
  const n = world.size, key = (i, j) => i * n + j;
  const prev = new Int16Array(n * n).fill(-1);
  const q = [from]; prev[key(from.i, from.j)] = key(from.i, from.j);
  while (q.length) {
    const c = q.shift();
    if (c.i === to.i && c.j === to.j) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = c.i + di, nj = c.j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      if (prev[key(ni, nj)] !== -1) continue;
      prev[key(ni, nj)] = key(c.i, c.j);
      q.push({ i: ni, j: nj });
    }
  }
  // 回溯到 from 的下一步
  let cur = key(to.i, to.j);
  if (prev[cur] === -1) return null;
  const start = key(from.i, from.j);
  while (prev[cur] !== start && prev[cur] !== cur) cur = prev[cur];
  return { i: Math.floor(cur / n), j: cur % n };
}

export class BaseAI {
  constructor(vehicle, game) {
    this.v = vehicle; this.game = game; this.world = game.world;
    this.stuckT = 0; this.reverseT = 0; this.reverseSteer = 1;
    this.feelerBlocked = [false, false, false];
  }

  // 朝目标点转向；返回 {steer, angle}
  aim(tx, tz) {
    const dx = tx - this.v.pos.x, dz = tz - this.v.pos.z;
    const want = Math.atan2(dx, dz);
    const diff = wrap(want - this.v.yaw);
    return { steer: Math.max(-1, Math.min(1, diff * 2.2)), angle: diff, dist: Math.hypot(dx, dz) };
  }

  // 触须避障：返回转向修正与是否需要减速
  avoid() {
    const v = this.v; const sp = Math.max(0, v.speed);
    const len = 7 + sp * 0.75;
    const cands = this.game.grid.query(v.pos.x, v.pos.z, len + 4, []);
    const angles = [0, 0.42, -0.42];
    let correction = 0, brake = false;
    for (let k = 0; k < 3; k++) {
      const a = v.yaw + angles[k];
      const l = k === 0 ? len : len * 0.7;
      const ex = v.pos.x + Math.sin(a) * l, ez = v.pos.z + Math.cos(a) * l;
      let hit = false;
      for (const o of cands) {
        if (o.type === 'tree') continue;
        if (segmentHitsAABB(v.pos.x, v.pos.z, ex, ez, o)) { hit = true; break; }
      }
      this.feelerBlocked[k] = hit;
    }
    const [c, l, r] = this.feelerBlocked;
    if (c) { brake = sp > 14; correction = l && !r ? -1 : (r && !l ? 1 : (this.reverseSteer)); }
    else if (l) correction = -0.6;
    else if (r) correction = 0.6;
    return { correction, brake };
  }

  // 卡住检测：低速且油门在踩 → 倒车
  handleStuck(dt, wantsMove) {
    const v = this.v;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      v.input.throttle = -1; v.input.steer = this.reverseSteer; v.input.handbrake = false;
      return true;
    }
    if (wantsMove && Math.abs(v.speed) < 1.2) this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 1.6) {
      this.stuckT = 0; this.reverseT = 1.1 + Math.random() * 0.5;
      this.reverseSteer = Math.random() < 0.5 ? -1 : 1;
    }
    return false;
  }

  driveTo(tx, tz, speedScale = 1) {
    const v = this.v;
    const { steer, angle, dist } = this.aim(tx, tz);
    const av = this.avoid();
    let s = steer + av.correction * 0.9;
    s = Math.max(-1, Math.min(1, s));
    let throttle = 1 * speedScale;
    const sp = Math.abs(v.speed);
    if (Math.abs(angle) > 1.1 && sp > 12) throttle = -0.3;         // 大角度：刹车调头
    else if (Math.abs(angle) > 0.5 && sp > 22) throttle = 0.1;
    if (av.brake) throttle = Math.min(throttle, -0.2);
    v.input.steer = s; v.input.throttle = throttle; v.input.handbrake = Math.abs(angle) > 1.6 && sp > 15;
    return dist;
  }
}

// ---------------- 警方 ----------------
export class PoliceAI extends BaseAI {
  constructor(vehicle, game, opts = {}) {
    super(vehicle, game);
    this.skill = opts.skill || 1;
    this.mode = opts.mode || 'pursue';   // pursue | block
    this.pitCooldown = 3 + Math.random() * 3;
    this.pitSide = Math.random() < 0.5 ? -1 : 1;
    this.pitT = 0;
    this.blockTimer = 0;
    this.hasLOS = false;
    this.lastKnown = null;
  }

  update(dt, target) {
    const v = this.v;
    if (!target) { v.input.throttle = 0; return; }
    if (this.mode === 'block') {
      // 路障：停住等待，目标经过后转入追击
      this.blockTimer += dt;
      v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true;
      const d = Math.hypot(target.pos.x - v.pos.x, target.pos.z - v.pos.z);
      if (this.blockTimer > 2 && (d < 18 || this.blockTimer > 25)) { this.mode = 'pursue'; v.input.handbrake = false; }
      return;
    }
    if (this.handleStuck(dt, true)) return;
    const dx = target.pos.x - v.pos.x, dz = target.pos.z - v.pos.z;
    const dist = Math.hypot(dx, dz);
    this.hasLOS = dist < 140 && !this.world.lineBlocked(v.pos.x, v.pos.z, target.pos.x, target.pos.z);
    if (this.hasLOS || dist < 30) this.lastKnown = { x: target.pos.x, z: target.pos.z };
    this.pitCooldown -= dt;

    // 直接追击（有视线）
    if (this.hasLOS || dist < 40) {
      // PIT：接近且速度接近时瞄准目标后轮侧面
      const relSpeed = Math.abs(v.speed - target.speed);
      if (this.pitT > 0) {
        this.pitT -= dt;
        const f = target.forward(); const r = target.right();
        const px = target.pos.x - f.x * target.spec.len * 0.32 + r.x * this.pitSide * target.spec.wid * 0.35;
        const pz = target.pos.z - f.z * target.spec.len * 0.32 + r.z * this.pitSide * target.spec.wid * 0.35;
        this.driveTo(px, pz, 1);
        v.input.throttle = 1;
        return;
      }
      if (dist < 11 && relSpeed < 12 && target.speed > 8 && this.pitCooldown <= 0 && Math.random() < 0.02 * this.skill) {
        this.pitT = 1.6; this.pitCooldown = 6 / this.skill + Math.random() * 4;
        // 从哪侧来就顶哪侧
        const r = target.right();
        this.pitSide = Math.sign((v.pos.x - target.pos.x) * r.x + (v.pos.z - target.pos.z) * r.z) || 1;
        this.game.onEvent('pitAttempt', v);
      }
      // 拦截点预测
      const lead = Math.min(1.2, dist / 40) * (0.6 + 0.4 * this.skill);
      let tx = target.pos.x + target.vel.x * lead, tz = target.pos.z + target.vel.z * lead;
      // 距离很近时就贴着车尾，避免超车过头
      if (dist < 7 && target.speed > 5) { const f = target.forward(); tx = target.pos.x - f.x * 3; tz = target.pos.z - f.z * 3; }
      this.driveTo(tx, tz, 1);
      // 靠近且目标很慢：贴上去（泰瑟）
      if (dist < 12 && target.speed < 6) { v.input.throttle = dist > 5 ? 0.5 : -0.5; }
      return;
    }
    // 无视线：先去最后已知位置；到达后仍无视线 → 无线电通报，按目标当前位置寻路
    if (this.lastKnown && Math.hypot(this.lastKnown.x - v.pos.x, this.lastKnown.z - v.pos.z) < 25) this.lastKnown = null;
    const goal = this.lastKnown || { x: target.pos.x, z: target.pos.z };
    this.navigateTo(goal.x, goal.z, 0.95);
  }

  // 沿路网导航：位于通往下一节点的道路上时直奔下一节点，否则先到当前路口
  navigateTo(gx, gz, speedScale) {
    const v = this.v; const w = this.world;
    const from = w.nearestNode(v.pos.x, v.pos.z);
    const to = w.nearestNode(gx, gz);
    const next = bfsNext(w, from, to);
    const cur = w.nodePos(from.i, from.j);
    if (!next) { this.driveTo(gx, gz, speedScale); return; }
    const p = w.nodePos(next.i, next.j);
    const alongX = next.i !== from.i;                        // 下一段路沿 x 方向
    const perp = alongX ? Math.abs(v.pos.z - cur.z) : Math.abs(v.pos.x - cur.x);
    if (perp < w.road * 0.6) this.driveTo(p.x, p.z, speedScale);
    else this.driveTo(cur.x, cur.z, speedScale * 0.85);
  }
}

// ---------------- 逃犯 ----------------
export class FugitiveAI extends BaseAI {
  constructor(vehicle, game) {
    super(vehicle, game);
    this.node = this.world.nearestNode(vehicle.pos.x, vehicle.pos.z);
    this.prev = null;
    this.target = null;
    this.pickNext();
    this.panic = 0;
  }

  pickNext() {
    const w = this.world; const n = w.size;
    const cur = this.node;
    const police = this.game.policeUnits();
    const opts = [];
    const f = this.v.forward();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = cur.i + di, nj = cur.j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      if (this.prev && this.prev.i === ni && this.prev.j === nj) continue;
      const p = w.nodePos(ni, nj);
      let score = Math.random() * 8;
      // 远离警察
      let minD = Infinity;
      for (const c of police) minD = Math.min(minD, Math.hypot(c.pos.x - p.x, c.pos.z - p.z));
      score += Math.min(minD, 200) * 0.25;
      // 顺着当前方向（少急转）
      const dot = f.x * di + f.z * dj;
      score += dot * 10;
      // 高架桥盲区加分
      if (w.inBlindZone(p.x, p.z)) score += 18;
      // 避免地图边缘
      if (ni === 0 || nj === 0 || ni === n - 1 || nj === n - 1) score -= 12;
      opts.push({ i: ni, j: nj, score });
    }
    if (!opts.length) { opts.push({ i: this.prev.i, j: this.prev.j, score: 0 }); }
    opts.sort((a, b) => b.score - a.score);
    this.prev = cur;
    this.node = { i: opts[0].i, j: opts[0].j };
    this.target = w.nodePos(this.node.i, this.node.j);
  }

  update(dt) {
    const v = this.v;
    if (this.handleStuck(dt, true)) return;
    const d = Math.hypot(this.target.x - v.pos.x, this.target.z - v.pos.z);
    if (d < 10) this.pickNext();
    // 破胎器规避：前方 35m 内有钉刺 → 偏移目标点
    let tx = this.target.x, tz = this.target.z;
    const f = v.forward();
    for (const s of this.game.spikes) {
      const sx = s.x - v.pos.x, sz = s.z - v.pos.z;
      const ahead = sx * f.x + sz * f.z;
      if (ahead > 4 && ahead < 40 && Math.abs(sx * f.z - sz * f.x) < 9 && Math.random() < 0.7) {
        const r = v.right();
        const side = Math.sign(sx * r.x + sz * r.z) || 1;
        tx = v.pos.x + f.x * 20 - r.x * side * 9; tz = v.pos.z + f.z * 20 - r.z * side * 9;
      }
    }
    // 逼近的警车：轻微规避防 PIT
    let near = null, nd = Infinity;
    for (const c of this.game.policeUnits()) { const dd = Math.hypot(c.pos.x - v.pos.x, c.pos.z - v.pos.z); if (dd < nd) { nd = dd; near = c; } }
    let speedScale = 1;
    if (near && nd < 8) {
      const r = v.right();
      const side = Math.sign((near.pos.x - v.pos.x) * r.x + (near.pos.z - v.pos.z) * r.z) || 1;
      tx += -r.x * side * 4; tz += -r.z * side * 4;
    }
    this.driveTo(tx, tz, speedScale);
  }
}

// ---------------- 路人车流 ----------------
export class TrafficAI extends BaseAI {
  constructor(vehicle, game) {
    super(vehicle, game);
    this.node = this.world.nearestNode(vehicle.pos.x, vehicle.pos.z);
    this.prev = null; this.cruise = 11 + Math.random() * 6;
    this.pickNext();
  }
  pickNext() {
    const n = this.world.size; const cur = this.node; const opts = [];
    const f = this.v.forward();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = cur.i + di, nj = cur.j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      if (this.prev && this.prev.i === ni && this.prev.j === nj) continue;
      const straight = f.x * di + f.z * dj > 0.5;
      opts.push({ i: ni, j: nj, w: straight ? 3 : 1 });
    }
    if (!opts.length) opts.push({ ...this.prev, w: 1 });
    let total = opts.reduce((a, o) => a + o.w, 0), r = Math.random() * total;
    let pick = opts[0]; for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    this.prev = cur; this.node = { i: pick.i, j: pick.j };
    const p = this.world.nodePos(pick.i, pick.j);
    // 右侧车道偏移
    const di = pick.i - cur.i, dj = pick.j - cur.j;
    const lane = this.world.road * 0.25;
    this.target = { x: p.x + dj * lane, z: p.z - di * lane };
  }
  update(dt, vehicles) {
    const v = this.v;
    const d = Math.hypot(this.target.x - v.pos.x, this.target.z - v.pos.z);
    if (d < 6) this.pickNext();
    const { steer, angle } = this.aim(this.target.x, this.target.z);
    // 前车检测
    const f = v.forward(); let blocked = false;
    for (const o of vehicles) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const ahead = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
      if (ahead > 0 && ahead < 14 && side < 2.6) { blocked = true; break; }
    }
    v.input.steer = Math.max(-1, Math.min(1, steer));
    const sp = v.speed;
    if (blocked) v.input.throttle = sp > 2 ? -0.8 : 0;
    else if (Math.abs(angle) > 0.6) v.input.throttle = sp > 6 ? -0.3 : 0.4;
    else v.input.throttle = sp < this.cruise ? 0.6 : 0;
    v.input.handbrake = false;
  }
}
