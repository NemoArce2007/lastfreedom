// 入口：菜单 → 战力展示 → 对局 → 结算
import * as THREE from 'three';
import { ROLES, MAPS, CARS, pick } from './data.js';
import { Game } from './game.js';
import { HUD } from './hud.js';
import { AudioSys } from './audio.js';

const $ = id => document.getElementById(id);
const sel = { role: 'fugitive', map: 'la', car: 'charger' };

// ---------- 渲染器（全局复用） ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;

const hud = new HUD();
const audio = new AudioSys();
let game = null;

// ---------- 菜单 ----------
function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }
function statBar(label, v) {
  return `<div class="stat"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.round(v * 100)}%"></div></div></div>`;
}
function renderCards() {
  $('roleList').innerHTML = ROLES.map(r => `
    <div class="card ${sel.role === r.id ? 'active' : ''}" data-k="role" data-v="${r.id}">
      <div class="name">${r.name}</div><div class="sub">${r.sub}</div>
    </div>`).join('');
  $('mapList').innerHTML = MAPS.map(m => `
    <div class="card ${sel.map === m.id ? 'active' : ''}" data-k="map" data-v="${m.id}">
      <div class="name">${m.name}</div><div class="sub">${m.sub}</div>
    </div>`).join('');
  $('carList').innerHTML = CARS.map(c => `
    <div class="card ${sel.car === c.id ? 'active' : ''}" data-k="car" data-v="${c.id}">
      <div class="name"><span class="swatch" style="background:#${c.color.toString(16).padStart(6, '0')}"></span>${c.name}</div>
      <div class="sub">${c.sub}</div>
      ${statBar('极速', c.spec.topSpeed / 76)}${statBar('加速', c.spec.accel / 19)}${statBar('抓地', c.spec.grip / 6)}
    </div>`).join('');
  $('roleHint').textContent = ' · ' + ROLES.find(r => r.id === sel.role).hint;
  document.querySelectorAll('.card').forEach(el => el.addEventListener('click', () => {
    sel[el.dataset.k] = el.dataset.v; renderCards(); audio.ensure(); audio.blip(700, 0.06, 'square', 0.12);
  }));
}
renderCards();

// ---------- 战力展示 → 开局 ----------
function showPowerCard(role, map, car) {
  const isFug = role === 'fugitive';
  const rivalCar = isFug ? CARS[0] : pick(CARS.filter(c => c.id !== car.id));
  const left = { who: isFug ? '大佬' : '阿sir', car: car.name, rating: car.rating, tag: isFug ? '目标：消星逃脱' : '目标：匹配成功' };
  const right = { who: isFug ? '阿sir' : '大佬', car: isFug ? `${rivalCar.name} 警用版 ×N` : '未知车型（现场确认）', rating: isFug ? 4 + (map.theme.elite ? 1 : 0) : rivalCar.rating, tag: isFug ? (map.theme.elite ? map.theme.elite.name + ' 待命' : '直升机 / 破胎器 / 队友') : '熟悉本地路况' };
  const side = s => `<div class="who">${s.who}</div><div class="car">${s.car}</div><div class="rating">${stars(s.rating)}</div><span class="tag">${s.tag}</span>`;
  $('powerLeft').innerHTML = side(left); $('powerRight').innerHTML = side(right);
  $('powerQuote').textContent = `${map.name} · ${map.sub}`;
  $('powerCard').classList.remove('hidden');
  let n = 3; $('powerCount').textContent = n;
  return new Promise(res => {
    const t = setInterval(() => {
      n--; if (n <= 0) { clearInterval(t); $('powerCard').classList.add('hidden'); res(); }
      else { $('powerCount').textContent = n; audio.blip(600, 0.08); }
    }, 900);
  });
}

async function startGame() {
  audio.ensure(); audio.resume();
  const role = sel.role, map = MAPS.find(m => m.id === sel.map), car = CARS.find(c => c.id === sel.car);
  $('menu').classList.add('hidden');
  if (game) { game.dispose(); game = null; }
  const cardDone = showPowerCard(role, map, car);
  // 倒计时期间构建世界
  await new Promise(r => setTimeout(r, 50));
  game = new Game({ renderer, role, map, car, audio, hud, onEnd: showResult });
  game.resize();
  await cardDone;
  game.begin();
}

function showResult({ win, title, sub, stats }) {
  hud.hide();
  const t = $('resultTitle'); t.textContent = title; t.classList.toggle('lose', !win);
  $('resultSub').textContent = sub;
  const m = Math.floor(stats.time / 60), s = Math.floor(stats.time % 60);
  $('resultStats').innerHTML = [
    ['追逐时长', `${m}:${String(s).padStart(2, '0')}`],
    ['最高时速', `${Math.round(stats.topSpeed)} km/h`],
    ['里程', `${(stats.dist / 1000).toFixed(1)} km`],
    ['PIT 次数', stats.pits],
    ['破胎命中', stats.spikes],
    ['最高星级', stars(stats.maxStars)],
    ['出动警力', stats.units],
    ['结局', win ? '胜利' : '失败'],
    ...(stats.role === 'fugitive' ? [
      ['推倒树木', stats.smashed],
      ['撞飞警车', stats.launched],
      ['混乱值', stats.smashed * 10 + stats.launched * 50],
    ] : []),
  ].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');
  $('result').classList.remove('hidden');
}

function backToMenu() {
  if (game) { game.dispose(); game = null; }
  audio.stopAll();
  $('result').classList.add('hidden'); $('pause').classList.add('hidden');
  $('menu').classList.remove('hidden');
}

$('startBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', backToMenu);
$('quitBtn').addEventListener('click', backToMenu);
$('resumeBtn').addEventListener('click', () => { if (game) { game.paused = false; $('pause').classList.add('hidden'); } });

// 调试钩子（控制台可用：__lf.game）
window.__lf = { get game() { return game; }, start: startGame, sel };

// ---------- 循环 ----------
let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (game) game.frame(dt);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  if (game) game.resize();
});
