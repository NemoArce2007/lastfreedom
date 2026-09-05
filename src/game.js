// 游戏主控：场景/回合规则/相机/输入
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Vehicle } from './car.js';
import { ObstacleGrid, collideWorld, collideVehicles } from './physics.js';
import { PoliceAI, FugitiveAI, TrafficAI } from './ai.js';
import { Helicopter, SpikeStrip, Particles } from './support.js';
import { CARS, QUOTES, pick } from './data.js';

const CIVIL_COLORS = [0xcfd3d8, 0x2c2f36, 0x7a1f1f, 0x1f4d7a, 0xb8b8b8, 0x5a6b3a, 0xe0e0e0, 0x8a4b2a];

// 狂暴（逃犯消星奖励）：可囤积道具，手动触发
export const RAGE = {
  dur: 15, maxCharges: 2,
  speedMul: 1.2, accelMul: 1.3, massMul: 2.5,
  heatMul: 1.5,          // 狂暴期被追踪时热度涨速
  heatPerSmash: 0.03,    // 每推倒一物
  heatPerLaunch: 0.04,   // 每撞飞一辆警车
};

export class Game {
  constructor({ renderer, role, map, car, audio, hud, onEnd }) {
    this.renderer = renderer; this.role = role; this.map = map; this.carDef = car;
    this.audio = audio; this.hud = hud; this.onEnd = onEnd;
    this.theme = map.theme;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 2500);
    this.camMode = 0;
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.keys = {};
    this.time = 0; this.over = false; this.paused = false;
    this.vehicles = []; this.police = []; this.traffic = []; this.spikes = [];
    this.heli = null;
    this.stars = 2; this.heat = 0; this.evade = 0; this.seen = true; this.seenT = 0;
    this.lostT = 0; this.fugitiveVisible = true;
    this.stats = { pits: 0, spikes: 0, topSpeed: 0, maxStars: 2, units: 0, dist: 0, smashed: 0, launched: 0 };
    this.rage = { charges: 0, t: 0 };   // t>0 表示狂暴中
    this.spawnT = 0; this.spikeT = 20; this.blockT = 30; this.commentT = 0; this.eliteSpawned = false;
    this.cool = { heli: 0, spike: 0, backup: 0, taser: 0 }; this.heliActiveT = 0;
    this.shake = 0;

    const t0 = performance.now();
    this.world = new World(this.scene, renderer, this.theme, 1000 + Math.floor(Math.random() * 999));
    this.grid = new ObstacleGrid(this.world.obstacles);
    console.info(`[world] ${map.name} 构建 ${Math.round(performance.now() - t0)}ms · 障碍 ${this.world.obstacles.length}`);
    this.particles = new Particles(this.scene);
    this.setupPost();
    this.setupActors();
    this.setupInput();
    this.paused = true; this.started = false;   // 等待战力展示结束后 begin()
    this.hud.setMapName(map.name);
    this.hud.setAbilities(role === 'police'
      ? [{ id: 'heli', key: 'H', name: '空中支援' }, { id: 'spike', key: 'B', name: '破胎器' }, { id: 'backup', key: 'U', name: '地面队友' }, { id: 'taser', key: 'T', name: '泰瑟枪' }]
      : [{ id: 'rage', key: 'Shift', name: '狂暴 ×0' }]);
    if (this.theme.elite && role === 'police') this.spawnPolice(true, { elite: true, partner: true });
    this.updateCamera(0.1);
    this.render();   // 预热着色器
  }

  begin() {
    this.started = true; this.paused = false;
    this.hud.show();
    this.hud.comment(pick(QUOTES.intro), 4);
    this.hud.drawMinimap(this);
  }

  // ---------- 渲染管线 ----------
  setupPost() {
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), this.theme.night ? 0.35 : 0.12, 0.4, this.theme.night ? 0.7 : 1.15);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.composer.setSize(innerWidth, innerHeight);
  }

  // ---------- 角色 ----------
  setupActors() {
    const w = this.world;
    // 出生朝向：面向太阳所在的道路方向（落日观感），四向取整
    const yaw = Math.round(this.theme.sky.azimuth / 90) * Math.PI / 2;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const at = (ahead, side) => ({ x: fx * ahead + rx * side, z: fz * ahead + rz * side });
    if (this.role === 'fugitive') {
      this.player = this.addVehicle(this.carDef, { isPlayer: true, tag: 'fugitive', name: '大佬' }, 0, 0, yaw);
      this.fugitive = this.player;
      let p = at(-95, -3); this.spawnPolice(false, { x: p.x, z: p.z, yaw });
      p = at(-115, 3); this.spawnPolice(false, { x: p.x, z: p.z, yaw });
    } else {
      let p = at(-55, 0);
      this.player = this.addVehicle(this.carDef, { isPlayer: true, isPolice: true, tag: 'police', name: '阿sir', lights: true }, p.x, p.z, yaw);
      const pool = CARS.filter(c => c.id !== this.carDef.id);
      const fdef = pool[Math.floor(Math.random() * pool.length)];
      p = at(45, 0);
      this.fugitive = this.addVehicle(fdef, { tag: 'fugitive', name: '大佬', color: pick([0xb02020, 0x111111, 0x2b4a9f, 0xf2c11f, 0xe8e8ee, 0x1f7a4d]) }, p.x, p.z, yaw);
      this.fugitive.ai = new FugitiveAI(this.fugitive, this);
      p = at(-66, -4); this.spawnPolice(false, { x: p.x, z: p.z, yaw, partner: true });
      this.stars = 3;
    }
    // 路人车流
    const n = 14;
    for (let i = 0; i < n; i++) {
      const def = CARS[Math.floor(Math.random() * CARS.length)];
      const node = { i: Math.floor(Math.random() * w.size), j: Math.floor(Math.random() * w.size) };
      const p = w.nodePos(node.i, node.j);
      const alongZ = Math.random() < 0.5;
      const off = (Math.random() < 0.5 ? -1 : 1) * w.block * (0.2 + Math.random() * 0.3);
      const x = alongZ ? p.x + w.road * 0.25 : p.x + off;
      const z = alongZ ? p.z + off : p.z - w.road * 0.25;
      if (Math.hypot(x, z) < 90) continue;
      const v = this.addVehicle(def, { tag: 'civil', color: pick(CIVIL_COLORS) }, x, z, alongZ ? 0 : Math.PI / 2);
      v.ai = new TrafficAI(v, this); this.traffic.push(v);
    }
  }

  addVehicle(def, opts, x, z, yaw) {
    const v = new Vehicle(def, opts);
    v.setPose(x, z, yaw);
    this.scene.add(v.mesh); this.vehicles.push(v);
    return v;
  }

  policeUnits() { return this.police; }

  /** 生成警车。fromAhead=true 时在目标前方远处生成 */
  spawnPolice(ahead, opts = {}) {
    if (this.police.length >= 9) return null;
    const w = this.world; const t = this.fugitive;
    let x, z, yaw;
    if (opts.x !== undefined) { x = opts.x; z = opts.z; yaw = opts.yaw; }
    else {
      // 在目标 120~180m 外的道路上、优先无视线处生成
      let best = null;
      for (let k = 0; k < 12; k++) {
        const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 60;
        let px = t.pos.x + Math.cos(a) * d, pz = t.pos.z + Math.sin(a) * d;
        px = THREE.MathUtils.clamp(px, -w.half + 10, w.half - 10); pz = THREE.MathUtils.clamp(pz, -w.half + 10, w.half - 10);
        const s = w.snapToRoad(px, pz);
        const blocked = w.lineBlocked(s.x, s.z, t.pos.x, t.pos.z);
        const score = (blocked ? 1 : 0) + Math.random() * 0.2;
        if (!best || score > best.score) best = { x: s.x, z: s.z, alongZ: s.alongZ, score };
      }
      x = best.x; z = best.z;
      yaw = Math.atan2(t.pos.x - x, t.pos.z - z);
    }
    let def = CARS[0]; // 充电器为默认警车
    const r = Math.random();
    if (r > 0.7) def = CARS[1]; else if (r > 0.55) def = CARS[4]; else if (r > 0.5) def = CARS[2];
    if (opts.elite) def = { ...CARS[0], spec: { ...CARS[0].spec, topSpeed: CARS[0].spec.topSpeed * 1.1, accel: CARS[0].spec.accel * 1.15, grip: 6.2 } };
    const v = this.addVehicle(def, { isPolice: true, tag: 'police', name: opts.elite ? this.theme.elite.name : '阿sir', lights: this.police.length < 2 }, x, z, yaw);
    v.ai = new PoliceAI(v, this, { skill: opts.elite ? this.theme.elite.skill : 0.85 + Math.random() * 0.35, mode: opts.block ? 'block' : 'pursue' });
    v.isElite = !!opts.elite; v.isPartner = !!opts.partner;
    this.police.push(v); this.stats.units++;
    if (opts.elite) { this.eliteSpawned = true; this.hud.comment(pick(QUOTES.elite)); }
    return v;
  }

  /** 路障：在目标前方 ~150m 的路上横放两辆车 */
  spawnRoadblock() {
    const t = this.fugitive; const f = t.forward(new THREE.Vector3());
    const w = this.world;
    const px = THREE.MathUtils.clamp(t.pos.x + f.x * 150, -w.half + 10, w.half - 10);
    const pz = THREE.MathUtils.clamp(t.pos.z + f.z * 150, -w.half + 10, w.half - 10);
    const s = w.snapToRoad(px, pz);
    const yaw = s.alongZ ? Math.PI / 2 : 0;
    const dx = s.alongZ ? 1 : 0, dz = s.alongZ ? 0 : 1;
    const a = this.spawnPolice(true, { x: s.x - dx * 3.2, z: s.z - dz * 3.2, yaw, block: true });
    const b = this.spawnPolice(true, { x: s.x + dx * 3.2, z: s.z + dz * 3.2, yaw, block: true });
    if (a || b) this.hud.comment(pick(QUOTES.roadblock));
  }

  deploySpike(byPlayer = false) {
    const t = this.fugitive; const f = t.forward(new THREE.Vector3()); const w = this.world;
    const dist = 55 + Math.random() * 25;
    let px = t.pos.x + f.x * dist, pz = t.pos.z + f.z * dist;
    px = THREE.MathUtils.clamp(px, -w.half + 10, w.half - 10); pz = THREE.MathUtils.clamp(pz, -w.half + 10, w.half - 10);
    const s = w.snapToRoad(px, pz);
    const strip = new SpikeStrip(this.scene, s.x, s.z, s.alongZ);
    this.spikes.push(strip);
    this.hud.comment(byPlayer ? '地面部队已在前方路口布设破胎器！' : '阿sir呼叫地面部队：前方布设破胎器。');
    this.audio.blip(520, 0.15);
  }

  callHeli() {
    if (this.heli) return;
    this.heli = new Helicopter(this.scene, this.theme.night);
    this.hud.comment(pick(QUOTES.heli));
  }

  // ---------- 输入 ----------
  setupInput() {
    this.onKeyDown = e => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyC') this.camMode = (this.camMode + 1) % 3;
      if (e.code === 'KeyM') this.audio.setMuted(!this.audio.muted);
      if (e.code === 'Escape' && !this.over && this.started) { this.paused = !this.paused; document.getElementById('pause').classList.toggle('hidden', !this.paused); }
      if (this.role === 'police' && !this.over && !this.paused) this.policeAbility(e.code);
      if (this.role === 'fugitive' && !this.over && !this.paused && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) this.activateRage();
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    };
    this.onKeyUp = e => { this.keys[e.code] = false; };
    addEventListener('keydown', this.onKeyDown); addEventListener('keyup', this.onKeyUp);
  }

  policeAbility(code) {
    const c = this.cool;
    if (code === 'KeyH') {
      if (c.heli > 0 || this.heli) { this.audio.blip(200, 0.1); return; }
      this.callHeli(); this.heliActiveT = 60; c.heli = 100;
    } else if (code === 'KeyB') {
      if (c.spike > 0) { this.audio.blip(200, 0.1); return; }
      this.deploySpike(true); c.spike = 22;
    } else if (code === 'KeyU') {
      if (c.backup > 0) { this.audio.blip(200, 0.1); return; }
      const f = this.player.forward(new THREE.Vector3());
      const r = this.player.right(new THREE.Vector3());
      for (const s of [-1, 1]) this.spawnPolice(false, { x: this.player.pos.x - f.x * 14 + r.x * s * 3, z: this.player.pos.z - f.z * 14 + r.z * s * 3, yaw: this.player.yaw });
      this.hud.comment(pick(QUOTES.backup)); c.backup = 40; this.audio.blip(660, 0.15);
    } else if (code === 'KeyT') {
      if (c.taser > 0) return;
      const d = this.player.pos.distanceTo(this.fugitive.pos);
      if (d < 8 && Math.abs(this.fugitive.speed) < 9) {
        this.audio.taser(); this.hud.comment(pick(QUOTES.taser));
        this.particles.burst(this.fugitive.pos.x, 1, this.fugitive.pos.z, 60, 0x9fdfff, 8, 0.7);
        this.finish(true, '匹配成功', pick(QUOTES.arrested));
      } else { this.audio.blip(180, 0.15); this.hud.notice('泰瑟：需贴近低速目标', 1.2); c.taser = 1.5; }
    }
  }

  // ---------- 狂暴（逃犯） ----------
  get rageActive() { return this.rage.t > 0; }

  gainRage() {
    if (this.rage.charges >= RAGE.maxCharges) { this.hud.notice('狂暴已满', 1.6); return; }
    this.rage.charges++;
    this.hud.notice(`获得 狂暴 ×${this.rage.charges}`, 2.2);
    this.hud.comment(pick(QUOTES.rageGain), 3);
    this.audio.blip(660, 0.12, 'sawtooth', 0.2); setTimeout(() => this.audio.blip(990, 0.18, 'sawtooth', 0.2), 110);
  }

  activateRage() {
    if (this.rageActive || this.rage.charges <= 0) { this.audio.blip(200, 0.1); return; }
    this.rage.charges--; this.rage.t = RAGE.dur;
    const p = this.player;
    p.speedMul = RAGE.speedMul; p.accelMul = RAGE.accelMul; p.mass = p.spec.mass * RAGE.massMul;
    document.body.classList.add('rage');
    this.bloom.strength += 0.25;
    this.hud.notice('狂 暴 !', 1.8); this.hud.comment(pick(QUOTES.rage), 3.5);
    this.audio.blip(160, 0.5, 'sawtooth', 0.35); this.audio.impact(12);
    this.shake = 0.6;
  }

  endRage() {
    this.rage.t = 0;
    const p = this.player;
    p.speedMul = 1; p.accelMul = 1; p.mass = p.spec.mass;
    document.body.classList.remove('rage');
    this.bloom.strength -= 0.25;
    this.hud.notice('狂暴结束', 1.4); this.hud.comment(pick(QUOTES.rageEnd), 3);
    this.audio.blip(330, 0.25, 'triangle');
  }

  updateRage(dt) {
    if (this.role !== 'fugitive') return;
    if (this.rageActive) { this.rage.t -= dt; if (this.rage.t <= 0) this.endRage(); }
    const r = this.rage;
    this.hud.updateAbility('rage', this.rageActive ? r.t / RAGE.dur : (r.charges > 0 ? 1 : 0), r.charges > 0 && !this.rageActive, r.charges === 0 && !this.rageActive);
    this.hud.setAbilityName('rage', this.rageActive ? `狂暴中 ${Math.ceil(r.t)}s` : `狂暴 ×${r.charges}`);
  }

  readPlayerInput() {
    const k = this.keys; const inp = this.player.input;
    const up = k.KeyW || k.ArrowUp, down = k.KeyS || k.ArrowDown, left = k.KeyA || k.ArrowLeft, right = k.KeyD || k.ArrowRight;
    inp.throttle = (up ? 1 : 0) - (down ? 1 : 0);
    // yaw 为右手系绕 +Y 旋转，yaw 增大 = 车头向左；steer 正值对应左转
    const target = (left ? 1 : 0) - (right ? 1 : 0);
    inp.steer = THREE.MathUtils.lerp(inp.steer, target, 0.22);
    if (Math.abs(inp.steer) < 0.02 && target === 0) inp.steer = 0;
    inp.handbrake = !!k.Space;
  }

  // ---------- 事件 ----------
  onEvent(type, v) {
    if (type === 'pitAttempt' && Math.random() < 0.5) this.hud.comment(v.isElite ? '马修斯准备 PIT，教科书要翻页了。' : pick(QUOTES.pit), 2.5);
  }

  // ---------- 主循环 ----------
  frame(dt) {
    if (this.paused) { this.render(); return; }
    dt = Math.min(dt, 0.05);
    if (!this.over) {
      this.time += dt;
      if (!this.autopilot) this.readPlayerInput();
      this.updateAI(dt);
      // 物理（两次子步提升稳定性）
      const sub = 2, h = dt / sub;
      for (let s = 0; s < sub; s++) {
        for (const v of this.vehicles) v.update(h);
        this.collisions(h);
      }
      this.updateSupport(dt);
      this.updateRage(dt);
      this.updateRules(dt);
      this.updateStats(dt);
    }
    this.particles.update(dt);
    this.updateCamera(dt);
    this.world.followSun(this.player.pos);
    this.updateAudio(dt);
    this.hud.update(dt);
    this.hud.setTimer(this.time);
    this.hud.setSpeed(this.player.kmh, this.player.health, this.player.tires);
    if (this.frameCount++ % 3 === 0) this.hud.drawMinimap(this);
    this.render();
  }
  frameCount = 0;

  render() { this.composer.render(); }

  // 调试：玩家车交给 AI（逃犯或警方）
  setAutopilot(on) {
    this.autopilot = on;
    if (on) this.player.ai = this.role === 'fugitive' ? new FugitiveAI(this.player, this) : new PoliceAI(this.player, this, { skill: 1 });
    else this.player.ai = null;
  }

  updateAI(dt) {
    for (const p of this.police) if (p.ai) p.ai.update(dt, this.fugitive);
    if (this.fugitive.ai) this.fugitive.ai.update(dt);
    if (this.autopilot && this.player.ai && this.role === 'police') this.player.ai.update(dt, this.fugitive);
    for (const t of this.traffic) t.ai.update(dt, this.vehicles);
  }

  /** 狂暴期：玩家碾过的树直接推倒（不产生碰撞反力） */
  smashTrees() {
    const p = this.player; let n = 0;
    for (const c of p.circles()) {
      for (const o of this.grid.query(c.x, c.z, c.r + 0.6)) {
        if (o.type !== 'tree') continue;
        const nx = Math.max(o.minX, Math.min(c.x, o.maxX)), nz = Math.max(o.minZ, Math.min(c.z, o.maxZ));
        if (Math.hypot(c.x - nx, c.z - nz) >= c.r + 0.4) continue;
        if (!this.world.removeTree(o)) continue;
        this.grid.remove(o); n++;
        const cx = (o.minX + o.maxX) / 2, cz = (o.minZ + o.maxZ) / 2;
        this.particles.burst(cx, 2.5, cz, 30, 0x3f8f3a, 7, 0.9);
        this.particles.burst(cx, 1.0, cz, 14, 0x8b6b45, 5, 0.7);
      }
    }
    if (!n) return;
    this.stats.smashed += n;
    this.heat = Math.min(1, this.heat + RAGE.heatPerSmash * n);
    p.vel.multiplyScalar(Math.pow(0.96, n));
    this.shake = Math.max(this.shake, 0.35);
    this.audio.impact(6);
    if (this.time - (this.smashCommentT || -9) > 5) { this.smashCommentT = this.time; this.hud.comment(pick(QUOTES.smash), 2.5); }
  }

  collisions(dt) {
    const vs = this.vehicles;
    const rage = this.rageActive;
    if (rage) this.smashTrees();
    for (const v of vs) {
      const imp = collideWorld(v, this.grid, this.world.bounds);
      if (imp > 2.5) {
        const dmg = Math.min(30, (imp - 2.5) * (v.isPlayer || v === this.fugitive || v.tag === 'police' ? 0.45 : 0.3));
        const shielded = rage && v.isPlayer;   // 狂暴期撞墙免伤
        if (!shielded) v.damage(dmg);
        if (imp > 4) { this.particles.burst(v.pos.x, 0.8, v.pos.z, Math.min(40, imp * (shielded ? 5 : 3)), shielded ? 0xff7a3d : 0xffc266, imp * 0.8, 0.6); this.audio.impact(imp * (v.isPlayer ? 1 : 0.4)); }
        if (v.isPlayer) { this.shake = Math.min(1, imp / (shielded ? 20 : 12)); if (!shielded && imp > 10 && Math.random() < 0.5) this.hud.comment(pick(QUOTES.crash), 2.5); }
      }
    }
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i], b = vs[j];
      const imp = collideVehicles(a, b);
      if (imp > 2) {
        const dmg = Math.min(20, (imp - 2) * 0.35);
        const hitter = rage && (a.isPlayer ? a : (b.isPlayer ? b : null));   // 狂暴中的玩家
        if (hitter) {
          // 玩家免伤，对方吃双倍
          const other = hitter === a ? b : a;
          other.damage(dmg * 2);
          other.angVel += (Math.random() < 0.5 ? -1 : 1) * Math.min(2.5, imp * 0.12);
        } else { a.damage(dmg); b.damage(dmg); }
        const cx = (a.pos.x + b.pos.x) / 2, cz = (a.pos.z + b.pos.z) / 2;
        if (imp > 3) { this.particles.burst(cx, 0.9, cz, Math.min(30, imp * 2.5), hitter ? 0xff7a3d : 0xffd27a, imp * 0.6, 0.5); this.audio.impact(imp * (a.isPlayer || b.isPlayer ? 1 : 0.35)); }
        if (a.isPlayer || b.isPlayer) this.shake = Math.max(this.shake, Math.min(1, imp / 12));
        // 警车撞逃犯：热度上升 + PIT 统计
        const pol = a.tag === 'police' ? a : (b.tag === 'police' ? b : null);
        const fug = a === this.fugitive ? a : (b === this.fugitive ? b : null);
        if (pol && fug) {
          if (this.role === 'fugitive') this.heat = Math.min(1, this.heat + imp * 0.005);
          if (hitter && imp > 4 && this.time - (pol.launchT || -9) > 1.5) {
            // 狂暴反撞：撞飞警车
            pol.launchT = this.time; this.stats.launched++;
            this.heat = Math.min(1, this.heat + RAGE.heatPerLaunch);
            this.hud.notice('撞 飞 !', 1.2); this.hud.comment(pick(QUOTES.launch), 2.5);
            this.audio.blip(120, 0.3, 'sawtooth', 0.3);
          } else if (!hitter && Math.abs(fug.angVel) > 1.6 && imp > 3 && this.time - (this.lastPitT || 0) > 3) {
            this.lastPitT = this.time; this.stats.pits++;
            this.hud.notice('PIT!', 1.4); this.hud.comment(pick(QUOTES.pit), 2.5);
          }
        }
      }
    }
    // 破胎器
    for (const s of this.spikes) {
      const hit = s.check(this.vehicles);
      if (hit) {
        if (hit.puncture()) {
          this.particles.burst(hit.pos.x, 0.4, hit.pos.z, 40, 0xffee88, 6, 0.6);
          this.audio.impact(8);
          if (hit === this.fugitive) { this.stats.spikes++; this.hud.notice('破胎器命中', 1.6); this.hud.comment(pick(QUOTES.spike)); }
          else if (hit.tag === 'police') this.hud.comment(pick(QUOTES.spikeSelf));
        }
      }
    }
  }

  updateSupport(dt) {
    const w = this.world;
    // 破胎器寿命
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i]; s.life -= dt;
      if (s.life <= 0) { s.dispose(); this.spikes.splice(i, 1); }
    }
    // 直升机
    if (this.heli) {
      const prev = this.heli.state;
      this.heli.update(dt, this.fugitive, w);
      if (prev === 'tracking' && this.heli.state === 'leaving') this.hud.comment(pick(QUOTES.heliRefuel));
      if (prev === 'arriving' && this.heli.state === 'tracking') this.hud.notice('空中支援到场', 1.6);
      if (this.role === 'police') {
        this.heliActiveT -= dt;
        if (this.heliActiveT <= 0 && this.heli.state !== 'leaving' && this.heli.state !== 'away') this.heli.state = 'leaving';
        if (this.heli.state === 'away') { this.heli.dispose(); this.heli = null; }
      }
    }
    // 移除报废的路人车 / 警车
    for (let i = this.police.length - 1; i >= 0; i--) {
      const p = this.police[i];
      if (!p.alive) {
        this.particles.burst(p.pos.x, 1, p.pos.z, 80, 0x333333, 4, 1.5);
        this.removeVehicle(p); this.police.splice(i, 1);
        if (this.role === 'fugitive') this.hud.comment('一辆警车报废退场，阿sir：我还能打。', 2.5);
      }
    }
    // 冷却
    for (const k in this.cool) this.cool[k] = Math.max(0, this.cool[k] - dt);
    if (this.role === 'police') {
      this.hud.updateAbility('heli', this.heli ? 1 : 1 - this.cool.heli / 100, !this.heli && this.cool.heli <= 0, !!this.heli);
      this.hud.updateAbility('spike', 1 - this.cool.spike / 22, this.cool.spike <= 0);
      this.hud.updateAbility('backup', 1 - this.cool.backup / 40, this.cool.backup <= 0, this.police.length >= 9);
      const d = this.player.pos.distanceTo(this.fugitive.pos);
      this.hud.updateAbility('taser', d < 8 && Math.abs(this.fugitive.speed) < 9 ? 1 : 0, d < 8 && Math.abs(this.fugitive.speed) < 9);
    }
  }

  removeVehicle(v) {
    this.scene.remove(v.mesh); v.dispose();
    const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1);
  }

  // 是否有警方视线
  computeSeen() {
    const f = this.fugitive; const w = this.world;
    const inBlind = w.inBlindZone(f.pos.x, f.pos.z);
    let seen = false;
    for (const p of this.police) {
      const d = p.pos.distanceTo(f.pos);
      if (d < 22) { seen = true; break; }
      if (d < 130 && !w.lineBlocked(p.pos.x, p.pos.z, f.pos.x, f.pos.z)) { seen = true; break; }
    }
    if (this.role === 'police') {
      const d = this.player.pos.distanceTo(f.pos);
      if (d < 22 || (d < 150 && !w.lineBlocked(this.player.pos.x, this.player.pos.z, f.pos.x, f.pos.z))) seen = true;
    }
    if (!seen && this.heli && this.heli.seesTarget) seen = true;
    return { seen, inBlind };
  }

  updateRules(dt) {
    const f = this.fugitive;
    const { seen, inBlind } = this.computeSeen();
    this.seen = seen;
    if (this.role === 'fugitive') {
      // ---- 逃犯规则 ----
      if (seen) {
        this.seenT += dt;
        this.heat = Math.min(1, this.heat + dt / (34 + this.stars * 8) * (this.rageActive ? RAGE.heatMul : 1));
        this.evade = Math.max(0, this.evade - dt * 0.6);
        if (this.heat >= 1 && this.stars < 5) {
          this.stars++; this.heat = 0; this.stats.maxStars = Math.max(this.stats.maxStars, this.stars);
          this.hud.notice(`晋级：${this.stars} 星大佬`, 2); this.hud.comment(pick(QUOTES.starUp));
          this.audio.blip(880, 0.2); setTimeout(() => this.audio.blip(1320, 0.25), 130);
        }
      } else {
        this.evade += dt / (9 + this.stars * 5) * (inBlind ? 1.8 : 1);
        if (inBlind && Math.random() < dt * 0.15) this.hud.comment(pick(QUOTES.blind), 2.5);
        if (this.evade >= 1) {
          this.stars--; this.evade = 0; this.heat = 0;
          if (this.stars <= 0) { this.finish(true, '最后的自由', pick(QUOTES.escaped)); return; }
          this.hud.notice(`消星：${this.stars} 星`, 2); this.hud.comment(pick(QUOTES.starDown));
          this.audio.blip(440, 0.25, 'triangle');
          setTimeout(() => { if (!this.over && !this.disposed) this.gainRage(); }, 900);   // 消星奖励：狂暴道具
          // 消星后远处警车撤离一部分
          const far = this.police.filter(p => p.pos.distanceTo(f.pos) > 150);
          for (const p of far.slice(0, 2)) { this.removeVehicle(p); this.police.splice(this.police.indexOf(p), 1); }
        }
      }
      // 警力目标数
      this.spawnT -= dt;
      const want = Math.min(9, 1 + this.stars + (this.stars >= 4 ? 1 : 0));
      if (this.police.length < want && this.spawnT <= 0) {
        const elite = this.theme.elite && this.stars >= 3 && !this.eliteSpawned;
        this.spawnPolice(false, { elite }); this.spawnT = 6;
      }
      // 直升机
      const heliStars = this.map.heliDefault ? 2 : 3;
      if (!this.heli && this.stars >= heliStars && this.time > 12) this.callHeli();
      // 破胎器 & 路障
      this.spikeT -= dt; this.blockT -= dt;
      if (this.stars >= 2 && this.spikeT <= 0 && seen && f.speed > 10) { this.deploySpike(); this.spikeT = 26 - this.stars * 2; }
      if (this.stars >= 4 && this.blockT <= 0 && seen) { this.spawnRoadblock(); this.blockT = 45; }
      // 抓捕判定
      const near = this.police.some(p => p.pos.distanceTo(f.pos) < 7.5);
      if (near && f.stoppedTime > 3 && this.time > 8) { this.audio.taser(); this.finish(false, '匹配成功', pick(QUOTES.arrested)); return; }
      this.warnT = Math.max(0, (this.warnT || 0) - dt);
      if (near && f.stoppedTime > 1.5 && this.time > 8 && this.warnT <= 0) { this.hud.notice('阿sir逼近！快跑', 0.6); this.warnT = 0.7; }
      if (!f.alive) { this.finish(false, '车辆报废', '大佬的车冒烟了，阿sir慢慢走过来……'); return; }
      const label = seen ? (inBlind ? '盲区中 · 阿sir仍有视线' : '被追踪中') : (inBlind ? '高架桥盲区 · 消星中' : '脱离视线 · 消星中');
      this.hud.setStars(this.stars, !seen, this.heat, this.evade, label);
    } else {
      // ---- 警方规则 ----
      this.fugitiveVisible = seen;
      if (seen) this.lostT = Math.max(0, this.lostT - dt * 2); else this.lostT += dt;
      const escapeT = 30;
      if (this.lostT >= escapeT) { this.finish(false, '大佬拉爆全场', pick(QUOTES.fugitiveEscaped)); return; }
      const near = [...this.police, this.player].some(p => p.pos.distanceTo(f.pos) < 8);
      if (near && f.stoppedTime > 3.5 && this.time > 8) { this.audio.taser(); this.finish(true, '匹配成功', pick(QUOTES.arrested)); return; }
      if (!f.alive) { this.finish(true, '车辆报废', '大佬的车拉爆了自己，阿sir上前收工。'); return; }
      if (!this.player.alive) { this.finish(false, '警车报废', '阿sir的车先扛不住了，局长表示很遗憾。'); return; }
      // 逃犯热度：跑得越久星级越高（仅展示）
      this.heat = Math.min(1, this.heat + dt / 60);
      if (this.heat >= 1 && this.stars < 5) { this.stars++; this.heat = 0; this.hud.comment(pick(QUOTES.starUp)); }
      const label = seen ? `目标在视线内 · ${Math.round(this.player.pos.distanceTo(f.pos))} m` : `视线丢失 ${Math.ceil(escapeT - this.lostT)} s 后目标逃脱`;
      this.hud.setStars(this.stars, !seen, this.heat, this.lostT / escapeT, label);
    }
  }

  updateStats(dt) {
    this.stats.topSpeed = Math.max(this.stats.topSpeed, this.player.kmh);
    this.stats.maxStars = Math.max(this.stats.maxStars, this.stars);
    this.stats.dist += this.player.vel.length() * dt;
  }

  // ---------- 相机 ----------
  updateCamera(dt) {
    const p = this.player; const f = p.forward(new THREE.Vector3());
    const sp = Math.abs(p.speed);
    let desired, look;
    if (this.camMode === 2 && this.heli) {
      desired = this.heli.pos.clone().add(new THREE.Vector3(0, -3, 0));
      look = this.fugitive.pos.clone();
    } else if (this.camMode === 1) {
      // 引擎盖视角
      desired = p.pos.clone().addScaledVector(f, 0.6).add(new THREE.Vector3(0, 1.35, 0));
      look = p.pos.clone().addScaledVector(f, 30).add(new THREE.Vector3(0, 1.0, 0));
      this.camPos.copy(desired);
    } else {
      const back = 8.5 + sp * 0.05, up = 3.4 + sp * 0.02;
      desired = p.pos.clone().addScaledVector(f, -back).add(new THREE.Vector3(0, up, 0));
      look = p.pos.clone().addScaledVector(f, 6).add(new THREE.Vector3(0, 1.2, 0));
    }
    const k = this.camMode === 1 ? 1 : 1 - Math.exp(-dt * (this.camMode === 2 ? 3 : 6));
    this.camPos.lerp(desired, k);
    this.camLook.lerp(look, 1 - Math.exp(-dt * 10));
    // 撞击抖动
    if (this.shake > 0.001) {
      this.camPos.x += (Math.random() - 0.5) * this.shake * 0.6; this.camPos.y += (Math.random() - 0.5) * this.shake * 0.4;
      this.shake *= Math.exp(-dt * 6);
    }
    this.camera.position.copy(this.camPos);
    if (this.camera.position.y < 0.8) this.camera.position.y = 0.8;
    this.camera.lookAt(this.camLook);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 62 + sp * 0.28, 0.1);
    this.camera.updateProjectionMatrix();
  }

  updateAudio(dt) {
    const a = this.audio; if (!a.started) return;
    const p = this.player;
    a.updateEngine(Math.min(1, Math.abs(p.speed) / p.spec.topSpeed), this.over ? 0 : p.input.throttle);
    let nearest = Infinity;
    for (const c of this.police) nearest = Math.min(nearest, c.pos.distanceTo(this.camera.position));
    if (this.role === 'police') nearest = 0;
    a.updateSiren(dt, nearest, !this.over && (this.police.length > 0 || this.role === 'police'));
    a.updateHeli(this.heli ? this.heli.pos.distanceTo(this.camera.position) : 999, !!this.heli && this.heli.state !== 'away');
    a.updateBeat(this.seen ? 1 : 0.5);
  }

  // ---------- 结束 ----------
  finish(win, title, sub) {
    if (this.over) return;
    this.over = true;
    this.hud.comment(sub, 8);
    this.audio.stopAll();
    setTimeout(() => this.onEnd({ win, title, sub, stats: { ...this.stats, time: this.time, stars: this.stars, role: this.role } }), 1800);
  }

  dispose() {
    removeEventListener('keydown', this.onKeyDown); removeEventListener('keyup', this.onKeyUp);
    this.disposed = true; document.body.classList.remove('rage');
    for (const v of this.vehicles) { this.scene.remove(v.mesh); v.dispose(); }
    for (const s of this.spikes) s.dispose();
    if (this.heli) this.heli.dispose();
    this.particles.dispose();
    this.world.dispose();
    this.composer.dispose();
    this.hud.hide();
  }
}
