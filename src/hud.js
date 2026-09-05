// HUD：星级、速度、小地图、解说、能力栏
export class HUD {
  constructor() {
    this.$ = id => document.getElementById(id);
    this.root = this.$('hud');
    this.minimap = this.$('minimap'); this.mctx = this.minimap.getContext('2d');
    this.commentT = 0; this.noticeT = 0;
    this.abilityEls = {};
  }
  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setMapName(n) { this.$('mapName').textContent = n; }

  setStars(stars, blinking, heat, evade, label) {
    let html = '';
    for (let i = 0; i < 5; i++) html += `<span class="${i < stars ? 'on' : ''} ${blinking && i === stars - 1 ? 'blink' : ''}">★</span>`;
    this.$('stars').innerHTML = html;
    this.$('heatBar').style.width = `${Math.round(heat * 100)}%`;
    this.$('evadeBar').style.width = `${Math.round(evade * 100)}%`;
    this.$('wantedLabel').textContent = label;
  }

  setSpeed(kmh, hp, tires) {
    this.$('speed').textContent = Math.round(kmh);
    const hpEl = this.$('hp'); hpEl.style.width = `${hp}%`;
    hpEl.style.background = hp > 50 ? 'linear-gradient(90deg,#7dffb3,#35c6f4)' : (hp > 25 ? '#f7c948' : '#ff3b3b');
    this.$('tires').innerHTML = tires.map(t => `<span class="${t ? '' : 'flat'}">●</span>`).join(' ');
  }

  setTimer(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    this.$('timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  comment(text, dur = 3.5) {
    const el = this.$('commentary'); el.textContent = text; el.classList.add('show'); this.commentT = dur;
  }
  notice(text, dur = 2.2) {
    const el = this.$('notice'); el.textContent = text; el.classList.add('show'); this.noticeT = dur;
  }

  setAbilities(list) {
    const wrap = this.$('abilities'); wrap.innerHTML = ''; this.abilityEls = {};
    for (const a of list) {
      const el = document.createElement('div'); el.className = 'ability';
      el.innerHTML = `<kbd>${a.key}</kbd><span>${a.name}</span><div class="cd"><div></div></div>`;
      wrap.appendChild(el); this.abilityEls[a.id] = el;
    }
  }
  updateAbility(id, ratio, ready, off = false) {
    const el = this.abilityEls[id]; if (!el) return;
    el.querySelector('.cd > div').style.width = `${Math.round(ratio * 100)}%`;
    el.classList.toggle('ready', ready && !off); el.classList.toggle('off', off);
  }

  update(dt) {
    if (this.commentT > 0) { this.commentT -= dt; if (this.commentT <= 0) this.$('commentary').classList.remove('show'); }
    if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT <= 0) this.$('notice').classList.remove('show'); }
  }

  /** 小地图：以玩家为中心，正北朝上 */
  drawMinimap(game) {
    const ctx = this.mctx, W = this.minimap.width, H = this.minimap.height;
    const p = game.player; const world = game.world;
    const scale = 0.45; // px / m
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1b1c26'; ctx.fillRect(0, 0, W, H);
    const toX = x => W / 2 + (x - p.pos.x) * scale;
    const toY = z => H / 2 - (z - p.pos.z) * scale;
    // 街区
    ctx.fillStyle = '#2e3040';
    const inner = world.block - world.road;
    for (let i = 0; i < world.size - 1; i++) for (let j = 0; j < world.size - 1; j++) {
      const cx = (world.coords[i] + world.coords[i + 1]) / 2, cz = (world.coords[j] + world.coords[j + 1]) / 2;
      if (Math.abs(cx - p.pos.x) > 300 || Math.abs(cz - p.pos.z) > 300) continue;
      ctx.fillRect(toX(cx - inner / 2), toY(cz + inner / 2), inner * scale, inner * scale);
    }
    // 高架桥盲区
    ctx.fillStyle = 'rgba(125,255,179,0.22)';
    for (const b of world.blindZones) ctx.fillRect(toX(b.minX), toY(b.maxZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
    // 破胎器
    ctx.fillStyle = '#ff7700';
    for (const s of game.spikes) { ctx.beginPath(); ctx.arc(toX(s.x), toY(s.z), 3, 0, Math.PI * 2); ctx.fill(); }
    // 车辆
    for (const v of game.vehicles) {
      if (v === p) continue;
      let color = '#8a8f9c', r = 2.4;
      if (v.tag === 'police') { color = Math.floor(performance.now() / 250) % 2 ? '#ff4040' : '#4070ff'; r = 3.4; }
      if (v.tag === 'fugitive') { color = '#ffd23f'; r = 3.6; if (game.role === 'police' && !game.fugitiveVisible) continue; }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(toX(v.pos.x), toY(v.pos.z), r, 0, Math.PI * 2); ctx.fill();
    }
    // 直升机
    if (game.heli && game.heli.state !== 'away') {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      const hx = toX(game.heli.pos.x), hy = toY(game.heli.pos.z);
      ctx.beginPath(); ctx.moveTo(hx - 6, hy); ctx.lineTo(hx + 6, hy); ctx.moveTo(hx, hy - 6); ctx.lineTo(hx, hy + 6); ctx.stroke();
    }
    // 玩家箭头
    ctx.translate(W / 2, H / 2); ctx.rotate(-p.yaw);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
