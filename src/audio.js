// 程序化音效：引擎、警笛、直升机、撞击、鼓点小曲
export class AudioSys {
  constructor() {
    this.ctx = null; this.muted = false; this.started = false;
  }
  ensure() {
    if (this.started) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return false; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.6; this.master.connect(c.destination);

    // 引擎：锯齿波 + 低通
    this.engineOsc = c.createOscillator(); this.engineOsc.type = 'sawtooth';
    this.engineOsc2 = c.createOscillator(); this.engineOsc2.type = 'square';
    this.engineFilter = c.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 600;
    this.engineGain = c.createGain(); this.engineGain.gain.value = 0.0;
    this.engineOsc.connect(this.engineFilter); this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start(); this.engineOsc2.start();

    // 警笛：双音扫频
    this.sirenOsc = c.createOscillator(); this.sirenOsc.type = 'triangle';
    this.sirenGain = c.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.sirenT = 0;

    // 直升机：低频噪声脉冲
    const bufLen = c.sampleRate * 2;
    const buf = c.createBuffer(1, bufLen, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(i / c.sampleRate * Math.PI * 2 * 17));
    this.heliSrc = c.createBufferSource(); this.heliSrc.buffer = buf; this.heliSrc.loop = true;
    this.heliFilter = c.createBiquadFilter(); this.heliFilter.type = 'lowpass'; this.heliFilter.frequency.value = 220;
    this.heliGain = c.createGain(); this.heliGain.gain.value = 0;
    this.heliSrc.connect(this.heliFilter); this.heliFilter.connect(this.heliGain); this.heliGain.connect(this.master);
    this.heliSrc.start();

    // 噪声缓存（撞击用）
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // 鼓点：128 BPM
    this.beatGain = c.createGain(); this.beatGain.gain.value = 0.35; this.beatGain.connect(this.master);
    this.nextBeat = c.currentTime + 0.1; this.beatIdx = 0;
    this.bpm = 128;

    this.started = true;
    return true;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.6; }

  /** @param speedRatio 0..1  @param throttle -1..1 */
  updateEngine(speedRatio, throttle) {
    if (!this.started) return;
    const rpm = 0.25 + speedRatio * 0.75 + Math.max(0, throttle) * 0.08;
    const f = 55 + rpm * 190;
    this.engineOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(f * 0.5, this.ctx.currentTime, 0.05);
    this.engineFilter.frequency.setTargetAtTime(400 + rpm * 1400, this.ctx.currentTime, 0.05);
    this.engineGain.gain.setTargetAtTime(0.10 + Math.max(0, throttle) * 0.08 + speedRatio * 0.04, this.ctx.currentTime, 0.05);
  }
  /** 警笛音量按最近警车距离 */
  updateSiren(dt, nearestDist, active) {
    if (!this.started) return;
    this.sirenT += dt;
    const wail = 650 + 450 * (0.5 + 0.5 * Math.sin(this.sirenT * 2.2 * Math.PI));
    this.sirenOsc.frequency.setTargetAtTime(wail, this.ctx.currentTime, 0.02);
    const vol = active ? Math.max(0, 0.16 * (1 - nearestDist / 140)) : 0;
    this.sirenGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
  }
  updateHeli(dist, active) {
    if (!this.started) return;
    const vol = active ? Math.max(0, 0.6 * (1 - dist / 220)) : 0;
    this.heliGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.2);
  }
  impact(strength) {
    if (!this.started || strength < 1.5) return;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const g = c.createGain(); const v = Math.min(1, strength / 18) * 0.7;
    g.gain.setValueAtTime(v, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25 + Math.min(0.4, strength / 40));
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }
  blip(freq = 880, dur = 0.12, type = 'square', vol = 0.25) {
    if (!this.started) return;
    const c = this.ctx; const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur);
  }
  taser() {
    if (!this.started) return;
    for (let i = 0; i < 10; i++) setTimeout(() => this.blip(2200 + Math.random() * 1500, 0.05, 'sawtooth', 0.15), i * 60);
  }
  // 鼓点小曲（调度）
  updateBeat(intensity = 1) {
    if (!this.started) return;
    const c = this.ctx; const step = 60 / this.bpm / 2; // 八分音符
    while (this.nextBeat < c.currentTime + 0.2) {
      const t = this.nextBeat; const i = this.beatIdx % 16;
      // 底鼓
      if (i % 4 === 0 || (i === 10)) this.kick(t);
      // 军鼓
      if (i % 8 === 4) this.snare(t);
      // 踩镫
      if (i % 2 === 1) this.hat(t, 0.06 * intensity);
      // 低音线
      if (i % 4 === 0) this.bass(t, [55, 55, 65.4, 49][Math.floor(this.beatIdx / 4) % 4]);
      this.nextBeat += step; this.beatIdx++;
    }
  }
  kick(t) {
    const c = this.ctx; const o = c.createOscillator(); const g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.beatGain); o.start(t); o.stop(t + 0.3);
  }
  snare(t) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const g = c.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
    s.connect(f); f.connect(g); g.connect(this.beatGain); s.start(t); s.stop(t + 0.2);
  }
  hat(t, vol) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    s.connect(f); f.connect(g); g.connect(this.beatGain); s.start(t); s.stop(t + 0.06);
  }
  bass(t, freq) {
    const c = this.ctx; const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.4);
    const g = c.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(f); f.connect(g); g.connect(this.beatGain); o.start(t); o.stop(t + 0.5);
  }
  stopAll() {
    if (!this.started) return;
    this.engineGain.gain.value = 0; this.sirenGain.gain.value = 0; this.heliGain.gain.value = 0;
  }
}
