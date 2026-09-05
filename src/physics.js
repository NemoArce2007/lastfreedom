// 碰撞：车辆 vs 静态障碍(AABB)、车辆 vs 车辆(双圆胶囊)
const CELL = 40;

export class ObstacleGrid {
  constructor(obstacles) {
    this.cells = new Map();
    for (const o of obstacles) {
      const x0 = Math.floor(o.minX / CELL), x1 = Math.floor(o.maxX / CELL);
      const z0 = Math.floor(o.minZ / CELL), z1 = Math.floor(o.maxZ / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 100003 + z;
        let arr = this.cells.get(k);
        if (!arr) { arr = []; this.cells.set(k, arr); }
        arr.push(o);
      }
    }
  }
  remove(o) {
    const x0 = Math.floor(o.minX / CELL), x1 = Math.floor(o.maxX / CELL);
    const z0 = Math.floor(o.minZ / CELL), z1 = Math.floor(o.maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const arr = this.cells.get(x * 100003 + z);
      if (!arr) continue;
      const i = arr.indexOf(o); if (i >= 0) arr.splice(i, 1);
    }
  }
  query(x, z, r, out = []) {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const arr = this.cells.get(cx * 100003 + cz);
      if (arr) for (const o of arr) if (!out.includes(o)) out.push(o);
    }
    return out;
  }
}

const _tmp = [];

/** 车辆与静态障碍碰撞。返回碰撞强度(相对速度) */
export function collideWorld(v, grid, bounds) {
  let impact = 0;
  const circles = v.circles();
  for (const c of circles) {
    const cands = grid.query(c.x, c.z, c.r + 1, _tmp);
    for (const o of cands) {
      const nx = Math.max(o.minX, Math.min(c.x, o.maxX));
      const nz = Math.max(o.minZ, Math.min(c.z, o.maxZ));
      let dx = c.x - nx, dz = c.z - nz;
      let d = Math.hypot(dx, dz);
      if (d >= c.r) continue;
      if (d < 1e-4) {
        // 圆心在盒内：沿最近的面推出
        const push = [c.x - o.minX, o.maxX - c.x, c.z - o.minZ, o.maxZ - c.z];
        const m = Math.min(...push);
        if (m === push[0]) { dx = -1; dz = 0; } else if (m === push[1]) { dx = 1; dz = 0; } else if (m === push[2]) { dx = 0; dz = -1; } else { dx = 0; dz = 1; }
        d = 0;
      } else { dx /= d; dz /= d; }
      const pen = c.r - d;
      v.pos.x += dx * pen; v.pos.z += dz * pen;
      c.x += dx * pen; c.z += dz * pen;
      const vn = v.vel.x * dx + v.vel.z * dz;
      if (vn < 0) {
        const e = 0.25;
        const j = -(1 + e) * vn * v.mass;
        v.applyImpulse(c.x, c.z, dx * j, dz * j);
        // 切向摩擦
        v.vel.multiplyScalar(0.94);
        impact = Math.max(impact, -vn);
      }
    }
  }
  // 地图边界
  const b = bounds;
  if (v.pos.x < -b) { v.pos.x = -b; if (v.vel.x < 0) { impact = Math.max(impact, -v.vel.x); v.vel.x *= -0.3; } }
  if (v.pos.x > b) { v.pos.x = b; if (v.vel.x > 0) { impact = Math.max(impact, v.vel.x); v.vel.x *= -0.3; } }
  if (v.pos.z < -b) { v.pos.z = -b; if (v.vel.z < 0) { impact = Math.max(impact, -v.vel.z); v.vel.z *= -0.3; } }
  if (v.pos.z > b) { v.pos.z = b; if (v.vel.z > 0) { impact = Math.max(impact, v.vel.z); v.vel.z *= -0.3; } }
  return impact;
}

/** 车辆间碰撞。返回 {impact, hitter} 供 PIT 判定 */
export function collideVehicles(a, b) {
  const dx0 = a.pos.x - b.pos.x, dz0 = a.pos.z - b.pos.z;
  if (dx0 * dx0 + dz0 * dz0 > 64) return 0;
  const ca = a.circles(), cb = b.circles();
  let impact = 0;
  for (const p of ca) for (const q of cb) {
    let dx = p.x - q.x, dz = p.z - q.z;
    let d = Math.hypot(dx, dz);
    const rr = p.r + q.r;
    if (d >= rr) continue;
    if (d < 1e-4) { dx = 1; dz = 0; d = 1e-4; } else { dx /= d; dz /= d; }
    const pen = rr - d;
    const wa = b.mass / (a.mass + b.mass), wb = a.mass / (a.mass + b.mass);
    a.pos.x += dx * pen * wa; a.pos.z += dz * pen * wa;
    b.pos.x -= dx * pen * wb; b.pos.z -= dz * pen * wb;
    const rvx = a.vel.x - b.vel.x, rvz = a.vel.z - b.vel.z;
    const vn = rvx * dx + rvz * dz;
    if (vn < 0) {
      const e = 0.35;
      const j = -(1 + e) * vn / (1 / a.mass + 1 / b.mass);
      const cx = (p.x + q.x) / 2, cz = (p.z + q.z) / 2;
      a.applyImpulse(cx, cz, dx * j, dz * j);
      b.applyImpulse(cx, cz, -dx * j, -dz * j);
      impact = Math.max(impact, -vn);
    }
  }
  return impact;
}

/** 点到线段距离（用于破胎器判定） */
export function pointSegDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz || 1)));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}
