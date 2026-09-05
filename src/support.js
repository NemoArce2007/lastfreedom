// 支援单位：直升机、破胎器
import * as THREE from 'three';
import { pointSegDist } from './physics.js';

export class Helicopter {
  constructor(scene, night) {
    this.scene = scene;
    this.alt = 38;
    this.orbit = Math.random() * Math.PI * 2;
    this.state = 'arriving';   // arriving | tracking | leaving | away
    this.fuel = 80;
    this.awayT = 0;
    const a = Math.random() * Math.PI * 2;
    this.pos = new THREE.Vector3(Math.cos(a) * 380, 110, Math.sin(a) * 380);
    this.vel = new THREE.Vector3();
    this.rotorT = 0;
    this.seesTarget = false;

    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2430, metalness: 0.4, roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.3, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), dark); body.scale.set(1, 0.8, 1.7); g.add(body);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.9, roughness: 0.1 }));
    glass.position.set(0, 0.2, 1.6); glass.scale.set(0.9, 0.7, 0.9); g.add(glass);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.45, 5.5, 8), white); boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.3, -4.2); g.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.9), white); fin.position.set(0, 1.0, -6.8); g.add(fin);
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.7 }));
    this.rotor.position.y = 1.6; g.add(this.rotor);
    const rotor2 = this.rotor.clone(); rotor2.rotation.y = Math.PI / 2; this.rotor.add(rotor2);
    this.tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.2), dark); this.tailRotor.position.set(0.3, 1.0, -6.9); g.add(this.tailRotor);
    for (const s of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 6), dark); skid.rotation.x = Math.PI / 2; skid.position.set(s * 1.0, -1.3, 0.3); g.add(skid);
    }
    // 探照灯
    this.spot = new THREE.SpotLight(0xfff2d0, night ? 2500 : 700, 90, 0.28, 0.45, 1.2);
    this.spot.position.set(0, -1.2, 1.2);
    this.spot.castShadow = false;
    g.add(this.spot); g.add(this.spot.target);
    // 光锥（夜晚可见）
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(11, 40, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: night ? 0.10 : 0.035, side: THREE.DoubleSide, depthWrite: false }));
    this.cone.position.set(0, -21, 1.2); g.add(this.cone);
    // 闪灯
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 3 }));
    this.beacon.position.set(0, -1.1, -3.5); g.add(this.beacon);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.mesh = g; scene.add(g);
    this.mesh.position.copy(this.pos);
  }

  update(dt, target, world) {
    this.rotorT += dt * 28;
    this.rotor.rotation.y = this.rotorT; this.tailRotor.rotation.x = this.rotorT * 1.7;
    this.beacon.material.emissiveIntensity = Math.floor(this.rotorT * 0.25) % 2 ? 4 : 0.2;
    let desired;
    if (this.state === 'away') {
      this.awayT -= dt;
      this.seesTarget = false;
      if (this.awayT <= 0) { this.state = 'arriving'; this.fuel = 70; }
      return;
    }
    if (this.state === 'leaving') {
      desired = new THREE.Vector3(this.pos.x * 3 + 500, 140, this.pos.z * 3 + 500);
      this.seesTarget = false;
      if (this.pos.distanceTo(target.pos) > 450) { this.state = 'away'; this.awayT = 35; }
    } else {
      this.orbit += dt * 0.22;
      const R = 26;
      desired = new THREE.Vector3(target.pos.x + Math.cos(this.orbit) * R + target.vel.x * 0.8, this.alt, target.pos.z + Math.sin(this.orbit) * R + target.vel.z * 0.8);
      if (this.state === 'arriving' && this.pos.distanceTo(desired) < 40) this.state = 'tracking';
      if (this.state === 'tracking') {
        this.fuel -= dt;
        if (this.fuel <= 0) this.state = 'leaving';
      }
      const dist2d = Math.hypot(this.pos.x - target.pos.x, this.pos.z - target.pos.z);
      this.seesTarget = this.state === 'tracking' && dist2d < 110 && !world.inBlindZone(target.pos.x, target.pos.z);
    }
    // 追随（带惯性）
    const toD = desired.clone().sub(this.pos);
    const maxSp = this.state === 'arriving' ? 70 : 48;
    const accel = toD.multiplyScalar(0.9);
    this.vel.addScaledVector(accel, dt).multiplyScalar(Math.exp(-0.9 * dt));
    if (this.vel.length() > maxSp) this.vel.setLength(maxSp);
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
    // 机头朝速度方向，机身随加速度倾斜
    const hy = Math.atan2(this.vel.x, this.vel.z);
    this.mesh.rotation.set(THREE.MathUtils.clamp(this.vel.length() * 0.006, 0, 0.25), hy, 0);
    // 探照灯照向目标
    const tgt = new THREE.Vector3(target.pos.x, 0.5, target.pos.z);
    const local = this.mesh.worldToLocal(tgt.clone());
    this.spot.target.position.copy(local);
    this.cone.lookAt(tgt); this.cone.rotateX(-Math.PI / 2);
    const len = this.pos.distanceTo(tgt);
    this.cone.scale.set(1, len / 40, 1);
    this.cone.position.copy(local).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.6, 0.6));
    this.cone.visible = this.state === 'tracking';
    this.spot.visible = this.state === 'tracking';
  }

  dispose() { this.scene.remove(this.mesh); this.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
}

export class SpikeStrip {
  constructor(scene, x, z, alongZ) {
    this.scene = scene; this.x = x; this.z = z; this.alongZ = alongZ;
    this.life = 45; this.used = false;
    const half = 6.5;
    // alongZ 表示道路沿 z 方向 → 钉刺横跨 x
    this.ax = alongZ ? x - half : x; this.az = alongZ ? z : z - half;
    this.bx = alongZ ? x + half : x; this.bz = alongZ ? z : z + half;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 }));
    base.position.y = 0.06; g.add(base);
    const spikeGeo = new THREE.ConeGeometry(0.05, 0.25, 5);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 1, roughness: 0.3 });
    const spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, 40);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) { m.makeTranslation(-half + 0.2 + i * (half * 2 - 0.4) / 39, 0.22, (i % 2 ? 0.12 : -0.12)); spikes.setMatrixAt(i, m); }
    spikes.instanceMatrix.needsUpdate = true; g.add(spikes);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: 0xff7700, emissive: 0xff5500, emissiveIntensity: 1.5 }));
    flag.position.set(half + 0.4, 0.6, 0); g.add(flag);
    g.position.set(x, 0.02, z);
    if (!alongZ) g.rotation.y = Math.PI / 2;
    this.mesh = g; scene.add(g);
  }
  // 返回被刺中的车辆
  check(vehicles) {
    if (this.used) return null;
    for (const v of vehicles) {
      if (Math.abs(v.pos.x - this.x) > 12 || Math.abs(v.pos.z - this.z) > 12) continue;
      for (const c of v.circles()) {
        if (pointSegDist(c.x, c.z, this.ax, this.az, this.bx, this.bz) < c.r * 0.7 && Math.abs(v.speed) > 2) {
          this.used = true; this.life = 6;
          return v;
        }
      }
    }
    return null;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
}

// 撞击火花/烟雾粒子（简单 Points）
export class Particles {
  constructor(scene) {
    this.scene = scene; this.max = 600;
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.max * 3);
    this.colors = new Float32Array(this.max * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(this.geo, this.mat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.items = [];
  }
  burst(x, y, z, n, color, speed = 6, life = 0.8) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      if (this.items.length >= this.max) this.items.shift();
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
      this.items.push({ x, y, z, vx: Math.cos(a) * s, vy: Math.random() * speed * 0.8, vz: Math.sin(a) * s, life, maxLife: life, r: c.r, g: c.g, b: c.b });
    }
  }
  update(dt) {
    let k = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt; if (p.life <= 0) { this.items.splice(i, 1); continue; }
      p.vy -= 6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; }
      this.positions[k * 3] = p.x; this.positions[k * 3 + 1] = p.y; this.positions[k * 3 + 2] = p.z;
      const f = p.life / p.maxLife;
      this.colors[k * 3] = p.r * f; this.colors[k * 3 + 1] = p.g * f; this.colors[k * 3 + 2] = p.b * f;
      k++;
    }
    this.geo.setDrawRange(0, k);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.points); this.geo.dispose(); this.mat.dispose(); }
}
