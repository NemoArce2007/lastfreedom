// 程序化地图生成：路网、街区建筑、树木、高架桥（视野盲区）、天空光照
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- 随机数（可复现） ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 建筑立面贴图 ----------
function makeFacadeTextures(emissiveStrength, night) {
  const size = 256;
  const base = document.createElement('canvas'); base.width = base.height = size;
  const emi = document.createElement('canvas'); emi.width = emi.height = size;
  const b = base.getContext('2d'); const e = emi.getContext('2d');
  b.fillStyle = '#d9d6d0'; b.fillRect(0, 0, size, size);
  e.fillStyle = '#000000'; e.fillRect(0, 0, size, size);
  // 4x4 窗格，每格 64px；窗户约占 60%
  const cell = 64;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const wx = x * cell + 12, wy = y * cell + 10, ww = 40, wh = 44;
      b.fillStyle = 'rgba(28,36,52,0.95)'; b.fillRect(wx, wy, ww, wh);
      b.fillStyle = 'rgba(255,255,255,0.22)'; b.fillRect(wx + 3, wy + 3, ww - 6, 9);
      const lit = Math.random() < (night ? 0.55 : 0.2);
      if (lit) {
        const warm = Math.random() < 0.7;
        e.fillStyle = warm ? `rgba(255,${180 + Math.random() * 60 | 0},120,${emissiveStrength})` : `rgba(160,220,255,${emissiveStrength})`;
        e.fillRect(wx, wy, ww, wh);
      }
    }
  }
  const map = new THREE.CanvasTexture(base);
  const emissiveMap = new THREE.CanvasTexture(emi);
  for (const t of [map, emissiveMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  map.colorSpace = THREE.SRGBColorSpace; emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

// 让 Box 的 UV 按真实尺寸重复（每 4m 一组窗）
function boxWithScaledUV(w, h, d, tile = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // 面顺序 px nx py ny pz nz，各 4 顶点
  const faceRepeat = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [ru, rv] = faceRepeat[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * ru / tile, uv.getY(i) * rv / tile);
    }
  }
  return g;
}

function colorAttr(geometry, color) {
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

export class World {
  constructor(scene, renderer, theme, seed = 7) {
    this.scene = scene;
    this.theme = theme;
    this.rand = mulberry32(seed);
    this.group = new THREE.Group();
    scene.add(this.group);

    const { size, block, road } = theme;
    this.size = size; this.block = block; this.road = road;
    this.coords = [];
    for (let i = 0; i < size; i++) this.coords.push((i - (size - 1) / 2) * block);
    this.half = ((size - 1) / 2) * block + block / 2;

    this.obstacles = [];   // {minX,maxX,minZ,maxZ,h,type}
    this.blindZones = [];  // {minX,maxX,minZ,maxZ}
    this.overpassLines = [];
    this.disposables = [];

    this.buildSkyAndLights(renderer);
    this.buildGround();
    this.buildBlocks();
    this.buildOverpasses();
    this.buildTrees();
    this.buildLamps();
  }

  // ---------- 天空 / 光照 ----------
  buildSkyAndLights(renderer) {
    const t = this.theme;
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    u.turbidity.value = t.sky.turbidity;
    u.rayleigh.value = t.sky.rayleigh;
    u.mieCoefficient.value = t.sky.mie;
    u.mieDirectionalG.value = 0.8;
    const phi = THREE.MathUtils.degToRad(90 - t.sky.elevation);
    const theta = THREE.MathUtils.degToRad(t.sky.azimuth);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sunDir);
    this.group.add(sky);
    this.sky = sky;

    this.scene.fog = new THREE.FogExp2(t.fog, t.fogDensity);

    const hemi = new THREE.HemisphereLight(t.ambient, t.ground, t.ambientIntensity ?? 0.5);
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(t.sun, t.sunIntensity);
    const sunPos = sunDir.clone().multiplyScalar(160);
    if (sunPos.y < 40) sunPos.y = 40;
    sun.position.copy(sunPos);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 420;
    const s = 110;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s; sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    this.group.add(sun); this.group.add(sun.target);
    this.sun = sun; this.sunOffset = sunPos;

    // 环境贴图（让金属车漆有反射）
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const skyCopy = new Sky(); skyCopy.scale.setScalar(4500);
    Object.keys(u).forEach(k => { if (skyCopy.material.uniforms[k]) skyCopy.material.uniforms[k].value = u[k].value; });
    skyCopy.material.uniforms.showSunDisc.value = 0;   // 太阳由 DirectionalLight 表示，避免环境贴图过曝
    envScene.add(skyCopy);
    const envRT = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = envRT.texture;
    // 太阳越高天空越亮，环境光按仰角衰减，避免正午地图过曝
    const elev = THREE.MathUtils.degToRad(t.sky.elevation || 10);
    this.scene.environmentIntensity = t.envIntensity ?? (t.night ? 0.3 : 0.3 * Math.min(1, 0.35 / Math.max(0.15, Math.sin(elev))));
    this.disposables.push(() => { envRT.dispose(); pmrem.dispose(); skyCopy.material.dispose(); });
  }

  // 阴影相机跟随玩家
  followSun(target) {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
  }

  // ---------- 地面 & 路网 ----------
  buildGround() {
    const t = this.theme;
    const ext = 12000;   // 足够大，避免看到地平面边缘
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ext, ext),
      new THREE.MeshStandardMaterial({ color: t.ground, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    this.group.add(ground);

    // 道路：沿 x 与沿 z 的长条
    const roadGeos = [], markGeos = [], edgeGeos = [];
    const len = this.half * 2 + this.road;
    for (const c of this.coords) {
      const gx = new THREE.PlaneGeometry(len, this.road); gx.rotateX(-Math.PI / 2); gx.translate(0, 0.01, c); roadGeos.push(gx);
      const gz = new THREE.PlaneGeometry(this.road, len); gz.rotateX(-Math.PI / 2); gz.translate(c, 0.01, 0); roadGeos.push(gz);
      // 中央黄虚线
      for (let p = -this.half; p < this.half; p += 8) {
        const m1 = new THREE.PlaneGeometry(4, 0.25); m1.rotateX(-Math.PI / 2); m1.translate(p + 2, 0.02, c); markGeos.push(m1);
        const m2 = new THREE.PlaneGeometry(0.25, 4); m2.rotateX(-Math.PI / 2); m2.translate(c, 0.02, p + 2); markGeos.push(m2);
      }
      // 白色边线
      for (const s of [-1, 1]) {
        const e1 = new THREE.PlaneGeometry(len, 0.2); e1.rotateX(-Math.PI / 2); e1.translate(0, 0.02, c + s * (this.road / 2 - 0.5)); edgeGeos.push(e1);
        const e2 = new THREE.PlaneGeometry(0.2, len); e2.rotateX(-Math.PI / 2); e2.translate(c + s * (this.road / 2 - 0.5), 0.02, 0); edgeGeos.push(e2);
      }
    }
    // 外围护栏（可见边界）
    this.bounds = this.half + this.road / 2 - 1.5;
    const B = this.bounds + 1.2, wallLen = B * 2 + 2;
    const barrierGeos = [];
    for (const s of [-1, 1]) {
      const g1 = new THREE.BoxGeometry(wallLen, 1.1, 0.8); g1.translate(0, 0.55, s * B); barrierGeos.push(g1);
      const g2 = new THREE.BoxGeometry(0.8, 1.1, wallLen); g2.translate(s * B, 0.55, 0); barrierGeos.push(g2);
    }
    const barrier = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(barrierGeos), new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.9 }));
    barrier.castShadow = true; barrier.receiveShadow = true;
    this.group.add(barrier);
    barrierGeos.forEach(g => g.dispose());

    const roadMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(roadGeos), new THREE.MeshStandardMaterial({ color: t.roadColor, roughness: 0.9 }));
    roadMesh.receiveShadow = true;
    this.group.add(roadMesh);
    this.group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(markGeos), new THREE.MeshStandardMaterial({ color: 0xe8c14a, roughness: 0.8 })));
    this.group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(edgeGeos), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.8 })));
    roadGeos.concat(markGeos, edgeGeos).forEach(g => g.dispose());
  }

  // ---------- 街区：人行道 + 建筑 ----------
  buildBlocks() {
    const t = this.theme; const rand = this.rand;
    const { emissiveWindows, night } = t;
    const tex = makeFacadeTextures(Math.max(0.05, emissiveWindows), night);
    const bGeos = [], sGeos = [];
    const palette = t.buildings.palette.map(c => new THREE.Color(c));
    const inner = this.block - this.road;       // 街区净宽
    const walk = 3.0;                             // 人行道宽

    for (let i = 0; i < this.size - 1; i++) {
      for (let j = 0; j < this.size - 1; j++) {
        const cx = (this.coords[i] + this.coords[i + 1]) / 2;
        const cz = (this.coords[j] + this.coords[j + 1]) / 2;
        // 人行道台面
        const sw = new THREE.BoxGeometry(inner, 0.18, inner); sw.translate(cx, 0.09, cz);
        colorAttr(sw, new THREE.Color(t.sidewalk)); sGeos.push(sw);

        // 中心街区留出广场，避免全图一样
        const isPlaza = rand() < 0.08;
        if (isPlaza) continue;

        // 地块划分
        const lots = t.buildings.hMax > 30 ? (rand() < 0.5 ? 2 : 3) : (rand() < 0.5 ? 3 : 4);
        const lotSize = (inner - walk * 2) / lots;
        for (let a = 0; a < lots; a++) {
          for (let b = 0; b < lots; b++) {
            if (rand() > t.buildings.density) continue;
            const margin = 1.2 + rand() * 2.0;
            const w = Math.max(4, lotSize - margin * 2 - rand() * lotSize * 0.25);
            const d = Math.max(4, lotSize - margin * 2 - rand() * lotSize * 0.25);
            // 高度：偏向低楼，少量高楼（更像真实城市）
            const r = Math.pow(rand(), 2.2);
            let h = t.buildings.hMin + (t.buildings.hMax - t.buildings.hMin) * r;
            // 市中心（离原点近）更高
            const dist = Math.hypot(cx, cz) / this.half;
            h *= THREE.MathUtils.lerp(1.25, 0.55, Math.min(1, dist));
            h = Math.max(t.buildings.hMin * 0.8, h);
            const x = cx - inner / 2 + walk + lotSize * (a + 0.5) + (rand() - 0.5) * margin;
            const z = cz - inner / 2 + walk + lotSize * (b + 0.5) + (rand() - 0.5) * margin;
            const g = boxWithScaledUV(w, h, d);
            g.translate(x, 0.18 + h / 2, z);
            colorAttr(g, palette[Math.floor(rand() * palette.length)]);
            bGeos.push(g);
            this.obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h, type: 'building' });
            // 顶部小结构
            if (h > 25 && rand() < 0.6) {
              const rw = w * 0.4, rh = 2 + rand() * 4, rd = d * 0.4;
              const rg = boxWithScaledUV(rw, rh, rd); rg.translate(x, 0.18 + h + rh / 2, z);
              colorAttr(rg, palette[Math.floor(rand() * palette.length)].clone().multiplyScalar(0.8)); bGeos.push(rg);
            }
          }
        }
      }
    }
    const bMat = new THREE.MeshStandardMaterial({
      map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: night ? 0.9 : 0.12,
      vertexColors: true, roughness: 0.85, metalness: 0.05,
    });
    if (bGeos.length) {
      const bMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(bGeos), bMat);
      bMesh.castShadow = true; bMesh.receiveShadow = true;
      this.group.add(bMesh);
    }
    const sMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(sGeos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    sMesh.receiveShadow = true;
    this.group.add(sMesh);
    bGeos.concat(sGeos).forEach(g => g.dispose());
  }

  // ---------- 高架桥（视野盲区） ----------
  buildOverpasses() {
    const t = this.theme; const n = t.overpasses;
    if (!n) return;
    const geos = []; const pillarGeos = [];
    const deckW = this.road + 5, deckH = 1.1, deckY = 7.5;
    const len = this.half * 2 + 40;
    // 选择不同的路线：交替沿 x / 沿 z，避开最外圈
    const candidates = [];
    for (let k = 1; k < this.size - 1; k++) candidates.push(k);
    for (let o = 0; o < n; o++) {
      const idx = candidates.splice(Math.floor(this.rand() * candidates.length), 1)[0];
      const c = this.coords[idx];
      const alongX = o % 2 === 0;
      this.overpassLines.push({ alongX, c });
      // 桥面
      const deck = alongX ? new THREE.BoxGeometry(len, deckH, deckW) : new THREE.BoxGeometry(deckW, deckH, len);
      deck.translate(alongX ? 0 : c, deckY, alongX ? c : 0);
      geos.push(deck);
      // 护栏
      for (const s of [-1, 1]) {
        const rail = alongX ? new THREE.BoxGeometry(len, 1.0, 0.3) : new THREE.BoxGeometry(0.3, 1.0, len);
        rail.translate(alongX ? 0 : c + s * (deckW / 2 - 0.15), deckY + deckH / 2 + 0.5, alongX ? c + s * (deckW / 2 - 0.15) : 0);
        geos.push(rail);
      }
      // 桥面上的静态车流（装饰）
      // 立柱：每 18m，一对，落在人行道边缘；在十字路口附近跳过
      const pw = 1.4;
      for (let p = -this.half; p <= this.half; p += 18) {
        const nearJunction = this.coords.some(cc => Math.abs(cc - p) < this.road / 2 + 3);
        if (nearJunction) continue;
        for (const s of [-1, 1]) {
          const off = c + s * (this.road / 2 + 1.5);
          const x = alongX ? p : off, z = alongX ? off : p;
          const pg = new THREE.BoxGeometry(pw, deckY, pw); pg.translate(x, deckY / 2, z);
          pillarGeos.push(pg);
          this.obstacles.push({ minX: x - pw / 2, maxX: x + pw / 2, minZ: z - pw / 2, maxZ: z + pw / 2, h: deckY, type: 'pillar' });
        }
      }
      // 盲区范围（桥面投影）
      const hw = deckW / 2;
      this.blindZones.push(alongX
        ? { minX: -this.half, maxX: this.half, minZ: c - hw, maxZ: c + hw }
        : { minX: c - hw, maxX: c + hw, minZ: -this.half, maxZ: this.half });
    }
    const concrete = new THREE.MeshStandardMaterial({ color: 0x75726c, roughness: 0.95 });
    const deckMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), concrete);
    deckMesh.castShadow = true; deckMesh.receiveShadow = true;
    this.group.add(deckMesh);
    if (pillarGeos.length) {
      const pm = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(pillarGeos), new THREE.MeshStandardMaterial({ color: 0x6a6762, roughness: 0.95 }));
      pm.castShadow = true; pm.receiveShadow = true;
      this.group.add(pm);
    }
    geos.concat(pillarGeos).forEach(g => g.dispose());
  }

  // ---------- 树木（Instanced） ----------
  buildTrees() {
    const t = this.theme; const rand = this.rand;
    const isPalm = t.trees.type === 'palm';
    const positions = [];
    // 沿人行道外缘种树
    const inner = this.block - this.road;
    for (let i = 0; i < this.size - 1; i++) {
      for (let j = 0; j < this.size - 1; j++) {
        const cx = (this.coords[i] + this.coords[i + 1]) / 2;
        const cz = (this.coords[j] + this.coords[j + 1]) / 2;
        const edge = inner / 2 - 1.2;
        const step = 12 / t.trees.density;
        for (let p = -edge + 4; p < edge - 4; p += step) {
          if (rand() < 0.55) positions.push([cx + p, cz - edge]);
          if (rand() < 0.55) positions.push([cx + p, cz + edge]);
          if (rand() < 0.55) positions.push([cx - edge, cz + p]);
          if (rand() < 0.55) positions.push([cx + edge, cz + p]);
        }
      }
    }
    // 郊外（地图外圈）随机树
    if (!isPalm) {
      // 地图是正方形，圆环采样会落进城内，需按切比雪夫距离剔除
      const minR = this.half + this.road / 2 + 6;
      for (let k = 0; k < 500; k++) {
        const a = rand() * Math.PI * 2, r = minR + rand() * 260;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (Math.max(Math.abs(x), Math.abs(z)) < minR) continue;
        positions.push([x, z]);
      }
    }
    if (!positions.length) return;
    const trunkGeo = new THREE.CylinderGeometry(isPalm ? 0.22 : 0.3, isPalm ? 0.3 : 0.45, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const crownGeo = isPalm ? new THREE.SphereGeometry(1, 7, 5) : new THREE.ConeGeometry(1, 1, 7);
    if (!isPalm) crownGeo.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: isPalm ? 0x8b6b45 : 0x5a3d26, roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: isPalm ? 0x3f8f3a : 0x2c6b34, roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, positions.length);
    trunks.castShadow = crowns.castShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const tint = new THREE.Color();
    positions.forEach(([x, z], k) => {
      const h = isPalm ? 6 + rand() * 5 : 8 + rand() * 7;
      const lean = isPalm ? (rand() - 0.5) * 0.25 : 0;
      q.setFromEuler(new THREE.Euler(lean, rand() * Math.PI * 2, lean * 0.6));
      pos.set(x, 0.18, z); scl.set(1, h, 1);
      m.compose(pos, q, scl); trunks.setMatrixAt(k, m);
      if (isPalm) {
        pos.set(x + lean * h * 0.5, 0.18 + h, z + lean * 0.6 * h * 0.5); scl.set(2.6, 1.2, 2.6);
      } else {
        // 树冠底部抬高到 5m 以上，避免追尾相机钻进树冠
        const base = Math.max(5.2, h * 0.4);
        pos.set(x, 0.18 + base, z); scl.set(2.0 + rand() * 0.8, h - base + 2, 2.0 + rand() * 0.8);
      }
      q.identity(); m.compose(pos, q, scl); crowns.setMatrixAt(k, m);
      tint.setHSL(isPalm ? 0.3 : 0.33, 0.45, 0.28 + rand() * 0.12); crowns.setColorAt(k, tint);
      this.obstacles.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, h: 2, type: 'tree' });
    });
    trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true; crowns.instanceColor.needsUpdate = true;
    this.group.add(trunks, crowns);
  }

  // ---------- 路灯（夜晚发光） ----------
  buildLamps() {
    const t = this.theme;
    const pts = [];
    for (const c of this.coords) {
      for (let p = -this.half + 20; p < this.half; p += 40) {
        pts.push([p, c + this.road / 2 + 0.6]);
        pts.push([c - this.road / 2 - 0.6, p]);
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 7, 5); poleGeo.translate(0, 3.5, 0);
    const headGeo = new THREE.BoxGeometry(0.6, 0.25, 1.2); headGeo.translate(0, 7, 0.5);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.6, roughness: 0.5 }), pts.length);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd080, emissiveIntensity: t.night ? 3.0 : 0.2 }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([x, z], k) => { m.makeTranslation(x, 0.18, z); poles.setMatrixAt(k, m); heads.setMatrixAt(k, m); });
    poles.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    this.group.add(poles, heads);
  }

  // ---------- 查询工具 ----------
  nodePos(i, j) { return { x: this.coords[i], z: this.coords[j] }; }
  nearestNode(x, z) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < this.size; i++) {
      const dx = Math.abs(this.coords[i] - x);
      if (dx < bd) { bd = dx; bi = i; }
    }
    bd = Infinity;
    for (let j = 0; j < this.size; j++) {
      const dz = Math.abs(this.coords[j] - z);
      if (dz < bd) { bd = dz; bj = j; }
    }
    return { i: bi, j: bj };
  }
  // 把点吸附到最近的道路中心线上
  snapToRoad(x, z) {
    let bx = this.coords[0], bz = this.coords[0], bdx = Infinity, bdz = Infinity;
    for (const c of this.coords) {
      if (Math.abs(c - x) < bdx) { bdx = Math.abs(c - x); bx = c; }
      if (Math.abs(c - z) < bdz) { bdz = Math.abs(c - z); bz = c; }
    }
    return bdx < bdz ? { x: bx, z, alongZ: true } : { x, z: bz, alongZ: false };
  }
  isOnRoad(x, z) {
    for (const c of this.coords) {
      if (Math.abs(c - x) < this.road / 2 || Math.abs(c - z) < this.road / 2) return true;
    }
    return false;
  }
  inBlindZone(x, z) {
    for (const b of this.blindZones) if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    return false;
  }
  // 线段是否被建筑遮挡（视线检测）
  lineBlocked(x1, z1, x2, z2) {
    for (const o of this.obstacles) {
      if (o.type === 'tree') continue;
      if (segmentHitsAABB(x1, z1, x2, z2, o)) return true;
    }
    return false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(mm => { for (const k of ['map', 'emissiveMap']) if (mm[k]) mm[k].dispose(); mm.dispose(); });
      }
    });
    this.disposables.forEach(fn => fn());
    this.scene.environment = null;
    this.scene.fog = null;
  }
}

// 2D 线段与 AABB 相交（slab 法）
export function segmentHitsAABB(x1, z1, x2, z2, b) {
  const dx = x2 - x1, dz = z2 - z1;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) { if (x1 < b.minX || x1 > b.maxX) return false; }
  else {
    let t1 = (b.minX - x1) / dx, t2 = (b.maxX - x1) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (z1 < b.minZ || z1 > b.maxZ) return false; }
  else {
    let t1 = (b.minZ - z1) / dz, t2 = (b.maxZ - z1) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}
