// 车辆：程序化建模 + 街机物理
import * as THREE from 'three';

const _f = new THREE.Vector3(), _r = new THREE.Vector3();

// 上窄下宽的盒子（车顶/座舱）
function taperedBox(w, h, d, sx = 0.8, sz = 0.85, frontBias = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * sx);
      p.setZ(i, p.getZ(i) * sz + frontBias);
    }
  }
  g.computeVertexNormals();
  return g;
}

const MAT_CACHE = {};
function mat(key, factory) { return MAT_CACHE[key] || (MAT_CACHE[key] = factory()); }

export class Vehicle {
  /**
   * @param def 车型定义（data.js CARS）
   * @param opts { isPolice, color, name, isPlayer }
   */
  constructor(def, opts = {}) {
    this.def = def;
    this.spec = def.spec;
    this.isPolice = !!opts.isPolice;
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || def.name;
    this.color = opts.color ?? def.color;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.angVel = 0;
    this.input = { throttle: 0, steer: 0, handbrake: false };
    this.tires = [true, true, true, true];
    this.health = 100;
    this.alive = true;
    this.wheelSpin = 0;
    this.lastCollision = 0;
    this.stoppedTime = 0;
    this.dmgCooldown = 0;
    this.mass = this.spec.mass;
    this.inertia = this.mass * (this.spec.len ** 2 + this.spec.wid ** 2) / 12;
    this.radius = this.spec.wid * 0.56;
    this.axleOffset = this.spec.len * 0.27;
    this.flashT = 0;
    this.ai = null;
    this.tag = opts.tag || (this.isPolice ? 'police' : 'civil');
    this.withLights = !!opts.lights;

    this.mesh = this.buildMesh();
  }

  get speed() { return this.vel.dot(this.forward()); }
  get kmh() { return Math.abs(this.speed) * 3.6; }
  get flatTires() { return this.tires.filter(t => !t).length; }

  forward(out = _f) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = _r) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  // 碰撞圆心（前后两个）
  circles() {
    const f = this.forward(new THREE.Vector3());
    return [
      { x: this.pos.x + f.x * this.axleOffset, z: this.pos.z + f.z * this.axleOffset, r: this.radius },
      { x: this.pos.x - f.x * this.axleOffset, z: this.pos.z - f.z * this.axleOffset, r: this.radius },
    ];
  }

  setPose(x, z, yaw) {
    this.pos.set(x, 0, z); this.yaw = yaw; this.vel.set(0, 0, 0); this.angVel = 0;
    this.syncMesh();
  }

  // ---------- 建模 ----------
  buildMesh() {
    const s = this.spec; const g = new THREE.Group();
    const isPolice = this.isPolice;
    const paint = new THREE.MeshStandardMaterial({
      color: isPolice ? 0xf4f4f4 : this.color, metalness: 0.65, roughness: 0.32,
    });
    const black = mat('black', () => new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.5, roughness: 0.5 }));
    const glass = mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.92 }));
    const chrome = mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xcfd4dc, metalness: 1, roughness: 0.25 }));
    const rubber = mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.95 }));
    const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 1.6 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2020, emissiveIntensity: 0.6 });
    this.tailMat = tail;

    const L = s.len, W = s.wid, H = s.h;
    const body = this.def.body;
    // 车身主体
    let bodyH = H * 0.42, cabinLen = L * 0.5, cabinH = H * 0.5, cabinZ = -L * 0.05, cabinTaper = 0.78;
    if (body === 'muscle') { bodyH = H * 0.46; cabinLen = L * 0.42; cabinH = H * 0.46; cabinZ = -L * 0.1; cabinTaper = 0.75; }
    if (body === 'sports') { bodyH = H * 0.44; cabinLen = L * 0.4; cabinH = H * 0.5; cabinZ = -L * 0.08; cabinTaper = 0.7; }
    if (body === 'suv') { bodyH = H * 0.42; cabinLen = L * 0.62; cabinH = H * 0.56; cabinZ = -L * 0.03; cabinTaper = 0.86; }
    const clearance = 0.34;

    const bodyGeo = taperedBox(W, bodyH, L, 0.94, 0.97);
    const bodyMesh = new THREE.Mesh(bodyGeo, paint);
    bodyMesh.position.y = clearance + bodyH / 2;
    bodyMesh.castShadow = true; g.add(bodyMesh);

    // 座舱（玻璃 + 车顶）
    const cabin = new THREE.Mesh(taperedBox(W * 0.9, cabinH, cabinLen, cabinTaper, 0.72, -cabinLen * 0.06), glass);
    cabin.position.set(0, clearance + bodyH + cabinH / 2 - 0.02, cabinZ);
    cabin.castShadow = true; g.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9 * cabinTaper, 0.06, cabinLen * 0.72), isPolice ? black : paint);
    roof.position.set(0, clearance + bodyH + cabinH - 0.01, cabinZ - cabinLen * 0.06); g.add(roof);

    // 警车涂装：黑色引擎盖和车门 + 警灯条
    if (isPolice) {
      const hood = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.04, L * 0.28), black);
      hood.position.set(0, clearance + bodyH + 0.01, L * 0.3); g.add(hood);
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.04, L * 0.2), black);
      trunk.position.set(0, clearance + bodyH + 0.01, -L * 0.36); g.add(trunk);
      for (const side of [-1, 1]) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, bodyH * 0.8, L * 0.36), black);
        door.position.set(side * (W / 2 - 0.01), clearance + bodyH * 0.5, -L * 0.02); g.add(door);
      }
      // 灯条
      const barBase = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.12, 0.3), black);
      barBase.position.set(0, clearance + bodyH + cabinH + 0.06, cabinZ + cabinLen * 0.1); g.add(barBase);
      this.redMat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 2.5 });
      this.blueMat = new THREE.MeshStandardMaterial({ color: 0x2a6bff, emissive: 0x0044ff, emissiveIntensity: 0.2 });
      const red = new THREE.Mesh(new THREE.BoxGeometry(W * 0.38, 0.16, 0.28), this.redMat);
      red.position.set(-W * 0.2, clearance + bodyH + cabinH + 0.2, cabinZ + cabinLen * 0.1); g.add(red);
      const blue = new THREE.Mesh(new THREE.BoxGeometry(W * 0.38, 0.16, 0.28), this.blueMat);
      blue.position.set(W * 0.2, clearance + bodyH + cabinH + 0.2, cabinZ + cabinLen * 0.1); g.add(blue);
      // 车顶灯光晕（红蓝点光，仅少数车辆启用以控制光源数量）
      if (this.withLights) {
        this.lightRed = new THREE.PointLight(0xff2020, 0, 16, 1.6);
        this.lightRed.position.set(-W * 0.2, clearance + bodyH + cabinH + 0.5, cabinZ);
        this.lightBlue = new THREE.PointLight(0x2050ff, 0, 16, 1.6);
        this.lightBlue.position.set(W * 0.2, clearance + bodyH + cabinH + 0.5, cabinZ);
        g.add(this.lightRed, this.lightBlue);
      }
    }

    // 大灯 / 尾灯
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(W * 0.22, 0.12, 0.08), head);
      hl.position.set(side * W * 0.32, clearance + bodyH * 0.65, L / 2 - 0.02); g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(W * 0.26, 0.1, 0.08), tail);
      tl.position.set(side * W * 0.3, clearance + bodyH * 0.7, -L / 2 + 0.02); g.add(tl);
    }
    // 保险杠 / 格栅
    const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, bodyH * 0.35, 0.06), black);
    grille.position.set(0, clearance + bodyH * 0.35, L / 2 + 0.01); g.add(grille);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(W * 1.02, 0.12, L * 1.01), body === 'sports' ? paint : black);
    bumper.position.set(0, clearance + 0.06, 0); g.add(bumper);
    if (body === 'muscle') {
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(W * 0.3, 0.08, L * 0.22), black);
      scoop.position.set(0, clearance + bodyH + 0.04, L * 0.3); g.add(scoop);
    }
    if (body === 'sports') {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.05, 0.3), black);
      spoiler.position.set(0, clearance + bodyH + 0.18, -L / 2 + 0.2); g.add(spoiler);
    }
    // 车轮
    this.wheels = [];
    const wr = body === 'suv' ? 0.4 : 0.34;
    const tireGeo = new THREE.CylinderGeometry(wr, wr, 0.26, 14); tireGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(wr * 0.62, wr * 0.62, 0.27, 8); rimGeo.rotateZ(Math.PI / 2);
    const wheelPos = [
      [-W / 2 + 0.08, L * 0.32], [W / 2 - 0.08, L * 0.32],
      [-W / 2 + 0.08, -L * 0.32], [W / 2 - 0.08, -L * 0.32],
    ];
    wheelPos.forEach(([x, z]) => {
      const wg = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, rubber); tire.castShadow = true;
      const rim = new THREE.Mesh(rimGeo, chrome);
      wg.add(tire, rim); wg.position.set(x, wr, z);
      g.add(wg); this.wheels.push(wg);
    });
    this.wheelRadius = wr;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // ---------- 物理 ----------
  update(dt) {
    const s = this.spec;
    const f = this.forward(new THREE.Vector3());
    const r = this.right(new THREE.Vector3());
    let vf = this.vel.dot(f);
    let vr = this.vel.dot(r);
    const flats = this.flatTires;
    const topSpeed = s.topSpeed * (1 - 0.12 * flats) * (this.health < 30 ? 0.85 : 1);
    const k = s.accel / topSpeed;
    const { throttle, steer, handbrake } = this.input;

    // 纵向：发动机 / 刹车 / 倒车
    if (throttle > 0.01) {
      vf += (s.accel * throttle - k * Math.max(0, vf)) * dt;
      if (vf > topSpeed) vf = THREE.MathUtils.lerp(vf, topSpeed, dt * 2);
    } else if (throttle < -0.01) {
      if (vf > 0.5) vf -= s.brake * -throttle * dt;
      else vf = Math.max(vf - s.accel * 0.5 * -throttle * dt, -s.topSpeed * 0.25);
    } else {
      // 滑行阻力
      const dec = (1.6 + k * Math.abs(vf) * 0.6) * dt;
      vf = Math.abs(vf) < dec ? 0 : vf - Math.sign(vf) * dec;
    }
    if (handbrake) {
      const dec = 14 * dt;
      vf = Math.abs(vf) < dec ? 0 : vf - Math.sign(vf) * dec;
    }

    // 横向抓地：侧滑速度指数衰减
    let grip = s.grip * Math.pow(0.72, flats);
    if (handbrake) grip *= 0.22;
    vr *= Math.exp(-grip * dt);

    // 转向
    const sp = Math.abs(vf);
    const steerFactor = THREE.MathUtils.clamp(sp / 6, 0, 1) / (1 + sp / 38);
    let yawRate = steer * s.steer * steerFactor * (handbrake ? 1.35 : 1) * Math.sign(vf || 1);
    this.yaw += (yawRate + this.angVel) * dt;
    this.angVel *= Math.exp(-2.8 * dt);
    if (Math.abs(this.angVel) > 0.05 && sp > 3) vf *= Math.exp(-0.25 * dt * Math.abs(this.angVel));

    // 重组速度并积分
    this.forward(f); this.right(r);
    this.vel.copy(f).multiplyScalar(vf).addScaledVector(r, vr);
    this.pos.addScaledVector(this.vel, dt);

    // 停车计时（用于泰瑟/抓捕判定）
    if (this.vel.length() < 3) this.stoppedTime += dt; else this.stoppedTime = 0;
    this.dmgCooldown = Math.max(0, this.dmgCooldown - dt);

    // 视觉
    this.wheelSpin += vf / this.wheelRadius * dt;
    this.flashT += dt;
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.yaw, 0);
    // 车身侧倾 / 俯仰
    const r = this.right(new THREE.Vector3());
    const vr = this.vel.dot(r);
    this.mesh.rotation.z = THREE.MathUtils.clamp(vr * 0.006, -0.06, 0.06);
    this.mesh.rotation.x = THREE.MathUtils.clamp(-this.input.throttle * 0.012, -0.02, 0.02);
    const steerAngle = this.input.steer * 0.45;
    this.wheels.forEach((w, i) => {
      w.rotation.x = this.wheelSpin;
      w.rotation.y = i < 2 ? steerAngle : 0;
      w.rotation.order = 'YXZ';
      const flat = !this.tires[i];
      w.scale.y = flat ? 0.75 : 1; w.position.y = this.wheelRadius * (flat ? 0.75 : 1);
    });
    if (this.tailMat) this.tailMat.emissiveIntensity = this.input.throttle < -0.01 || this.input.handbrake ? 3.0 : 0.6;
    if (this.isPolice && this.redMat) {
      const phase = Math.floor(this.flashT * 8) % 2 === 0;
      this.redMat.emissiveIntensity = phase ? 3.2 : 0.15;
      this.blueMat.emissiveIntensity = phase ? 0.15 : 3.2;
      if (this.lightRed) {
        this.lightRed.intensity = phase ? 14 : 0;
        this.lightBlue.intensity = phase ? 0 : 14;
      }
    }
  }

  // 施加冲量（世界坐标点、冲量向量）→ 线速度 + 角速度
  applyImpulse(px, pz, ix, iz) {
    this.vel.x += ix / this.mass; this.vel.z += iz / this.mass;
    const rx = px - this.pos.x, rz = pz - this.pos.z;
    const torque = -(rx * iz - rz * ix);
    this.angVel += torque / this.inertia;
    this.angVel = THREE.MathUtils.clamp(this.angVel, -5, 5);
  }

  damage(amount) {
    if (amount <= 0 || this.dmgCooldown > 0) return;
    this.dmgCooldown = 0.35;   // 持续接触不重复计伤
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.alive = false;
  }

  puncture() {
    let changed = false;
    // 通常压爆同侧或前轴的 1~3 个轮胎
    this.tires = this.tires.map(t => { if (t && Math.random() < 0.6) { changed = true; return false; } return t; });
    if (!changed && this.tires.some(Boolean)) { this.tires[this.tires.indexOf(true)] = false; changed = true; }
    return changed;
  }

  dispose() {
    this.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
}
