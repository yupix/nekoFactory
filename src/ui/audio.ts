import * as THREE from 'three';
import { BUILDINGS, type BuildingType } from '../sim/data';
import type { GameState } from '../sim/state';

/** 全て WebAudio で合成する。BGM・効果音・環境音の 3 系統 */
export type Sfx =
  | 'click' | 'hover' | 'open' | 'close' | 'place' | 'remove' | 'error' | 'research' | 'hire' | 'meow' | 'coin' | 'thud' | 'select' | 'rp' | 'expand' | 'pet'
  | 'bark' | 'horn' | 'siren' | 'fireWater' | 'fireTurret' | 'fireCannon' | 'impact' | 'boom' | 'break' | 'repair' | 'fanfare' | 'lose' | 'sell' | 'robotBoot' | 'sadMeow' | 'happyMeow' | 'splash' | 'craft';
export type Bus = 'bgm' | 'sfx' | 'amb';
export interface AudioSettings {
  bgm: number;
  sfx: number;
  amb: number;
  muted: boolean;
}

const KEY = 'nekoFactory.audio';
const BASE: Record<Bus, number> = { bgm: 0.42, sfx: 0.8, amb: 0.55 };
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

// --- BGM の譜面（C メジャー、104 BPM、16 小節 ≒ 37 秒） ---
const BPM = 104;
const STEP = 60 / BPM / 4;
const C = [60, 64, 67];
const Am = [57, 60, 64];
const F = [53, 57, 60];
const G = [55, 59, 62];
const Em = [52, 55, 59];
const G7 = [55, 59, 62, 65];
const Dm = [50, 53, 57];
/** 小節ごとの和音（前半・後半） */
const CHORDS: [number[], number[]][] = [
  [C, C], [Am, Am], [F, F], [G, G], [C, C], [Em, Em], [F, F], [G7, G7],
  [Am, Am], [F, F], [C, C], [G, G], [F, F], [G, G], [Em, Am], [Dm, G7],
];
/** メロディ: 小節ごとに [16 分の位置, MIDI, 長さ] */
const MELODY: [number, number, number][][] = [
  [[0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 83, 2], [10, 81, 2], [12, 79, 4]],
  [[0, 81, 2], [2, 79, 2], [4, 76, 4], [8, 72, 2], [10, 74, 2], [12, 76, 4]],
  [[0, 77, 2], [2, 81, 2], [4, 84, 2], [6, 81, 2], [8, 79, 4], [12, 77, 4]],
  [[0, 79, 4], [4, 74, 2], [6, 76, 2], [8, 77, 2], [10, 76, 2], [12, 74, 4]],
  [[0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 86, 2], [10, 84, 2], [12, 83, 4]],
  [[0, 83, 2], [2, 79, 2], [4, 76, 4], [8, 79, 4], [12, 83, 4]],
  [[0, 81, 2], [2, 84, 2], [4, 77, 2], [6, 81, 2], [8, 79, 2], [10, 77, 2], [12, 76, 2], [14, 77, 2]],
  [[0, 79, 6], [8, 74, 2], [10, 77, 2], [12, 71, 4]],
  [[0, 84, 4], [4, 83, 2], [6, 81, 2], [8, 76, 4], [12, 81, 4]],
  [[0, 81, 2], [2, 79, 2], [4, 77, 4], [8, 72, 2], [10, 77, 2], [12, 81, 4]],
  [[0, 79, 4], [4, 76, 2], [6, 79, 2], [8, 84, 4], [12, 88, 4]],
  [[0, 86, 6], [6, 83, 2], [8, 79, 4]],
  [[0, 81, 2], [2, 81, 2], [4, 84, 2], [6, 81, 2], [8, 77, 4], [12, 79, 2], [14, 81, 2]],
  [[0, 83, 2], [2, 83, 2], [4, 86, 2], [6, 83, 2], [8, 79, 4]],
  [[0, 79, 2], [2, 76, 2], [4, 71, 4], [8, 72, 2], [10, 76, 2], [12, 81, 4]],
  [[0, 77, 4], [4, 81, 2], [6, 86, 2], [8, 83, 4], [12, 79, 2], [14, 74, 2]],
];
const BARS = CHORDS.length;

// --- 環境音: 系統ごとの粒の間隔（秒）。建物種のほか、リフトの滑車とロボ猫の足音 ---
type Voice = BuildingType | 'lift' | 'robot';
const GRAIN: Partial<Record<Voice, [number, number]>> = {
  fishing: [2.4, 4.5],
  cannery: [0.26, 0.32],
  miner: [0.09, 0.12],
  furnace: [0.12, 0.5],
  assembler: [0.22, 0.5],
  lab: [0.14, 0.42],
  lift: [0.35, 0.6],
  robot: [0.2, 0.26],
};
const AMB_GAIN: Partial<Record<Voice, number>> = { fishing: 0.9, cannery: 0.55, miner: 0.45, furnace: 0.6, assembler: 0.5, lab: 0.6, lift: 0.45, robot: 0.4 };

export function createAudio() {
  const settings: AudioSettings = { bgm: 0.55, sfx: 0.8, amb: 0.6, muted: false };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    /* 壊れた設定は既定値 */
  }

  let ctx: AudioContext | null = null;
  let buses: Record<Bus, GainNode>;
  let reverb: ConvolverNode;
  let noiseBuf: AudioBuffer;
  const voices = new Map<Voice, { gain: GainNode; pan: StereoPannerNode; level: number; next: number }>();
  let scale = 0;
  const layer = [1, 0, 0, 0, 0];
  let step = 0;
  let nextAt = 0;
  let lastCoin = 0;
  let lastHover = 0;
  /** 襲撃中のドラムのレイヤー（0〜1） */
  let raidWant = 0;
  let raidLayer = 0;
  /** 同じ音が重なりすぎないよう、種類ごとの最後に鳴らした時刻 */
  const lastAt = new Map<Sfx, number>();

  function init() {
    const ac = new AudioContext();
    ctx = ac;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    const master = ac.createGain();
    master.gain.value = 0.9;
    master.connect(comp).connect(ac.destination);
    // 小さな部屋鳴り（減衰するノイズのインパルス応答）
    reverb = ac.createConvolver();
    const len = Math.floor(ac.sampleRate * 1.4);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    reverb.buffer = ir;
    const wet = ac.createGain();
    wet.gain.value = 0.22;
    reverb.connect(wet).connect(master);
    buses = { bgm: ac.createGain(), sfx: ac.createGain(), amb: ac.createGain() };
    for (const b of Object.values(buses)) {
      b.gain.value = 0;
      b.connect(master);
    }
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // 環境音の系統（建物種ごとに 1 本）
    for (const t of [...(Object.keys(BUILDINGS) as BuildingType[]), 'lift', 'robot'] as Voice[]) {
      if (!AMB_GAIN[t]) continue;
      const gain = ac.createGain();
      gain.gain.value = 0;
      const pan = ac.createStereoPanner();
      gain.connect(pan).connect(buses.amb);
      voices.set(t, { gain, pan, level: 0, next: 0 });
    }
    // 釣り場の水音・炉の燃える音・ドリルのうなりは途切れない帯域ノイズ
    bed('fishing', 'bandpass', 700, 0.7, 0.05, 0.22);
    bed('furnace', 'lowpass', 320, 0.6, 0.09, 0.6);
    bed('miner', 'bandpass', 180, 3, 0.05, 7);

    applyGains();
    nextAt = ac.currentTime + 0.1;
    setInterval(schedule, 25);
  }

  function bed(t: Voice, type: BiquadFilterType, freq: number, q: number, peak: number, lfoHz: number) {
    const ac = ctx!;
    const v = voices.get(t)!;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.value = peak;
    const lfo = ac.createOscillator();
    lfo.frequency.value = lfoHz;
    const depth = ac.createGain();
    depth.gain.value = peak * 0.7;
    lfo.connect(depth).connect(g.gain);
    src.connect(f).connect(g).connect(v.gain);
    src.start();
    lfo.start();
  }

  function applyGains() {
    if (!ctx) return;
    for (const b of Object.keys(buses) as Bus[]) buses[b].gain.setTargetAtTime(settings.muted ? 0 : settings[b] ** 2 * BASE[b], ctx.currentTime, 0.06);
  }

  function unlock() {
    if (!ctx) init();
    if (ctx!.state === 'suspended' && !document.hidden) void ctx!.resume();
  }
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume().then(() => (nextAt = Math.max(nextAt, ctx!.currentTime + 0.05)));
  });

  // --- 音の部品 ---
  function osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, out: AudioNode, o: { to?: number; attack?: number; send?: number } = {}) {
    const ac = ctx!;
    const n = ac.createOscillator();
    n.type = type;
    n.frequency.setValueAtTime(freq, t);
    if (o.to) n.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ac.createGain();
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    n.connect(g).connect(out);
    if (o.send) g.connect(sendTo(o.send));
    n.start(t);
    n.stop(t + a + dur + 0.02);
  }
  function noise(t: number, dur: number, peak: number, out: AudioNode, type: BiquadFilterType, freq: number, o: { q?: number; to?: number; attack?: number } = {}) {
    const ac = ctx!;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ac.createGain();
    const a = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.8);
    src.stop(t + a + dur + 0.02);
  }
  const sends = new Map<number, GainNode>();
  function sendTo(amount: number) {
    let g = sends.get(amount);
    if (!g) {
      g = ctx!.createGain();
      g.gain.value = amount;
      g.connect(reverb);
      sends.set(amount, g);
    }
    return g;
  }

  // --- 楽器 ---
  const marimba = (m: number, t: number, v: number, dur = 0.55) => {
    const f = mtof(m);
    const out = buses.bgm;
    osc('sine', f, t, dur, 0.22 * v, out, { attack: 0.003, send: 0.5 });
    osc('sine', f * 4, t, dur * 0.12, 0.05 * v, out, { attack: 0.002 });
    osc('triangle', f * 2, t, dur * 0.25, 0.035 * v, out);
  };
  const bell = (m: number, t: number, v: number) => {
    const f = mtof(m);
    osc('sine', f, t, 0.9, 0.08 * v, buses.bgm, { send: 0.8 });
    osc('sine', f * 2.76, t, 0.22, 0.03 * v, buses.bgm);
  };
  const bass = (m: number, t: number, v: number) => {
    const ac = ctx!;
    const n = ac.createOscillator();
    n.type = 'triangle';
    n.frequency.value = mtof(m);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.3);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26 * v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    n.connect(lp).connect(g).connect(buses.bgm);
    n.start(t);
    n.stop(t + 0.42);
  };
  const chip = (m: number, t: number, v: number) => {
    const ac = ctx!;
    const n = ac.createOscillator();
    n.type = 'square';
    n.frequency.value = mtof(m);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.022 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 0.9);
    n.connect(lp).connect(g).connect(buses.bgm);
    n.start(t);
    n.stop(t + STEP);
  };
  const kick = (t: number, v: number) => osc('sine', 130, t, 0.14, 0.32 * v, buses.bgm, { to: 45 });
  const clap = (t: number, v: number) => {
    for (const d of [0, 0.012, 0.026]) noise(t + d, 0.07, 0.07 * v, buses.bgm, 'bandpass', 1500, { q: 0.9 });
  };
  const shaker = (t: number, v: number) => noise(t, 0.035, 0.05 * v, buses.bgm, 'highpass', 6500);
  const wood = (t: number, v: number) => {
    osc('sine', 880, t, 0.05, 0.07 * v, buses.bgm);
    osc('sine', 1680, t, 0.025, 0.035 * v, buses.bgm);
  };

  /** BGM の 16 分音符 1 つ分を予約する */
  function playStep(s: number, t: number) {
    const bar = Math.floor(s / 16) % BARS;
    const pos = s % 16;
    if (pos === 0) {
      // 小節の頭でレイヤーの音量を規模に寄せる
      const want = [1, scale >= 1 ? 1 : 0, scale >= 2 ? 1 : 0, scale >= 3 ? 1 : 0, scale >= 4 ? 1 : 0];
      for (let i = 0; i < want.length; i++) layer[i] += (want[i] - layer[i]) * 0.5;
    }
    const chord = CHORDS[bar][pos < 8 ? 0 : 1];
    const swing = pos % 2 ? STEP * 0.08 : 0;
    const tt = t + swing;
    if (pos % 4 === 0) raidLayer += (raidWant - raidLayer) * 0.35;
    if (raidLayer > 0.05) {
      // 襲撃中: 太鼓の連打とスネアのロール
      const v = raidLayer;
      if (pos === 0 || pos === 3 || pos === 6 || pos === 8 || pos === 11) osc('sine', pos % 8 === 0 ? 92 : 128, tt, 0.22, 0.34 * v, buses.bgm, { to: 48 });
      if (pos === 4 || pos === 12) noise(tt, 0.12, 0.09 * v, buses.bgm, 'bandpass', 1900, { q: 0.8 });
      if (bar % 2 === 1 && pos >= 13) noise(tt, 0.05, 0.05 * v, buses.bgm, 'bandpass', 2600, { q: 1.2 });
      if (pos === 14 && bar % 4 === 3) osc('sawtooth', mtof(chord[0] - 12), tt, 0.3, 0.03 * v, buses.bgm, { to: mtof(chord[0] - 13) });
    }
    for (const [p, m, len] of MELODY[bar]) if (p === pos) marimba(m, tt, 0.95, Math.min(1.2, len * STEP * 1.6));
    // 分散和音（8 分）
    if (pos % 2 === 0) marimba(chord[(pos / 2) % chord.length] + 12, tt, 0.32, 0.35);
    if (layer[1] > 0.05) {
      if (pos % 4 === 2) shaker(tt, layer[1]);
      if (pos === 4 || pos === 12) wood(tt, layer[1] * 0.8);
    }
    if (layer[2] > 0.05 && (pos === 0 || pos === 6 || pos === 8 || pos === 14)) bass(chord[0] - 12 + (pos === 6 || pos === 14 ? 7 : 0), tt, layer[2]);
    if (layer[3] > 0.05) {
      if (pos === 0 || pos === 8 || (pos === 10 && bar % 2)) kick(tt, layer[3]);
      if (pos === 4 || pos === 12) clap(tt, layer[3]);
      if (pos % 4 === 3 && bar % 4 === 3) bell(chord[pos % chord.length] + 24, tt, layer[3]);
    }
    if (layer[4] > 0.05) {
      if (pos % 2 === 1) noise(tt, 0.02, 0.025 * layer[4], buses.bgm, 'highpass', 8000);
      chip(chord[pos % chord.length] + 24, tt, layer[4]);
    }
  }

  // --- 環境音の粒 ---
  function grain(type: Voice, t: number, out: AudioNode) {
    const r = Math.random();
    switch (type) {
      case 'fishing':
        osc('sine', 560 + r * 200, t, 0.09, 0.22, out, { to: 240 });
        noise(t, 0.05, 0.05, out, 'bandpass', 1800, { q: 2 });
        break;
      case 'cannery':
        noise(t, 0.035, 0.22, out, 'bandpass', r < 0.5 ? 1100 : 1500, { q: 5 });
        osc('sine', r < 0.5 ? 300 : 360, t, 0.03, 0.1, out);
        break;
      case 'miner':
        // ドリルの刃が岩を噛むガリガリ
        osc('sawtooth', 95 + r * 25, t, 0.08, 0.05, out, { to: 80 });
        noise(t, 0.05, 0.1, out, 'bandpass', 2400 + r * 1200, { q: 3 });
        break;
      case 'furnace':
        // 炎のはぜる音
        noise(t, 0.012 + r * 0.02, 0.18 * r, out, 'highpass', 2500 + r * 3000);
        break;
      case 'assembler':
        // アームのカチャカチャ
        noise(t, 0.012, 0.16, out, 'bandpass', 3800, { q: 6 });
        osc('square', r < 0.5 ? 1250 : 1600, t + 0.03, 0.02, 0.03, out);
        if (r < 0.3) noise(t + 0.09, 0.012, 0.12, out, 'bandpass', 3000, { q: 6 });
        break;
      case 'lab':
        osc('sine', 260 + r * 180, t, 0.05 + r * 0.03, 0.14, out, { to: 700 + r * 400 });
        break;
      case 'lift':
        // 滑車のキィと、フックが支柱を通るコトッ
        osc('triangle', 1700 + r * 500, t, 0.11, 0.025, out, { to: 1500 + r * 300, attack: 0.03 });
        noise(t + 0.05, 0.02, 0.08, out, 'bandpass', 900, { q: 4 });
        break;
      case 'robot':
        // 金属の足音（カシャ）
        noise(t, 0.018, 0.14, out, 'bandpass', 5200, { q: 5 });
        osc('sine', 820 + r * 120, t, 0.03, 0.04, out, { to: 600 });
        break;
    }
  }

  function schedule() {
    const ac = ctx;
    if (!ac || ac.state !== 'running') return;
    const horizon = ac.currentTime + 0.12;
    if (nextAt < ac.currentTime - 0.2) nextAt = ac.currentTime + 0.02;
    while (nextAt < horizon) {
      playStep(step, nextAt);
      step = (step + 1) % (BARS * 16);
      nextAt += STEP;
    }
    for (const [type, v] of voices) {
      const iv = GRAIN[type];
      if (!iv || v.level < 0.02) {
        v.next = ac.currentTime;
        continue;
      }
      while (v.next < horizon) {
        grain(type, Math.max(v.next, ac.currentTime), v.gain);
        v.next += iv[0] + Math.random() * (iv[1] - iv[0]);
      }
    }
  }

  // --- 効果音 ---
  /** vol は距離による減衰（0〜1） */
  /** 鳴き声: 音の高さ f[0..2] を、鳴き始めからの時刻 0・at[0]・at[1] でたどる（at[1] で鳴き終わる） */
  function meow(t: number, out: AudioNode, f: [number, number, number], at: [number, number], peak = 0.5) {
    const ac = ctx!;
    const n = ac.createOscillator();
    n.type = 'sawtooth';
    const k = 0.9 + Math.random() * 0.25;
    const end = at[1];
    n.frequency.setValueAtTime(f[0] * k, t);
    n.frequency.linearRampToValueAtTime(f[1] * k, t + at[0]);
    n.frequency.linearRampToValueAtTime(f[2] * k, t + end);
    const vib = ac.createOscillator();
    vib.frequency.value = 7;
    const vd = ac.createGain();
    vd.gain.value = 9;
    vib.connect(vd).connect(n.frequency);
    const f1 = ac.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    f1.frequency.setValueAtTime(800, t);
    f1.frequency.linearRampToValueAtTime(1500, t + at[0] + 0.01);
    f1.frequency.linearRampToValueAtTime(900, t + end);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.05);
    g.gain.setValueAtTime(peak, t + end * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + end + 0.03);
    n.connect(f1).connect(g).connect(out);
    n.start(t);
    vib.start(t);
    n.stop(t + end + 0.08);
    vib.stop(t + end + 0.08);
  }

  function play(name: Sfx, vol = 1) {
    if (!ctx || ctx.state !== 'running' || vol < 0.02) return;
    const t = ctx.currentTime + 0.005;
    // 発射・着弾・吠え声は短い間隔では重ねない
    const gap = { bark: 0.25, fireWater: 0.07, fireTurret: 0.05, fireCannon: 0.1, impact: 0.06, boom: 0.12, break: 0.2, sell: 0.18, robotBoot: 0.5 }[name as string];
    if (gap && t - (lastAt.get(name) ?? -9) < gap) return;
    lastAt.set(name, t);
    let out: AudioNode = buses.sfx;
    if (vol < 1) {
      const g = ctx.createGain();
      g.gain.value = vol;
      g.connect(buses.sfx);
      out = g;
      setTimeout(() => g.disconnect(), 4000);
    }
    switch (name) {
      case 'hover':
        if (t - lastHover < 0.06) return;
        lastHover = t;
        osc('sine', 1900, t, 0.03, 0.035, out);
        break;
      case 'click':
        osc('sine', 1250, t, 0.035, 0.12, out, { to: 900 });
        noise(t, 0.012, 0.05, out, 'highpass', 4000);
        break;
      case 'select':
        osc('sine', 700, t, 0.06, 0.16, out, { to: 560 });
        noise(t, 0.02, 0.08, out, 'bandpass', 2200, { q: 3 });
        break;
      case 'open':
        osc('sine', 520, t, 0.12, 0.16, out, { to: 980 });
        osc('sine', 1560, t + 0.06, 0.15, 0.05, out, { send: 0.6 });
        break;
      case 'close':
        osc('sine', 900, t, 0.11, 0.13, out, { to: 480 });
        break;
      case 'place':
        osc('triangle', 520, t, 0.13, 0.26, out, { to: 320 });
        osc('sine', 150, t, 0.16, 0.4, out, { to: 55 });
        noise(t, 0.04, 0.12, out, 'bandpass', 1800, { q: 2 });
        osc('sine', 1040, t + 0.07, 0.18, 0.06, out, { send: 0.5 });
        break;
      case 'remove':
        noise(t, 0.32, 0.22, out, 'lowpass', 3200, { to: 260, attack: 0.01 });
        osc('sine', 420, t, 0.25, 0.14, out, { to: 140 });
        break;
      case 'error':
        osc('square', 190, t, 0.07, 0.07, out);
        osc('square', 160, t + 0.11, 0.09, 0.07, out);
        break;
      case 'research':
        [72, 76, 79, 84, 88].forEach((m, i) => {
          osc('sine', mtof(m), t + i * 0.07, 0.7, 0.14, out, { send: 0.9 });
          osc('triangle', mtof(m) * 2, t + i * 0.07, 0.2, 0.04, out);
        });
        noise(t + 0.3, 0.5, 0.03, out, 'highpass', 7000, { attack: 0.1 });
        break;
      case 'hire':
        osc('triangle', mtof(79), t, 0.1, 0.18, out);
        osc('triangle', mtof(84), t + 0.1, 0.22, 0.2, out, { send: 0.5 });
        break;
      case 'meow':
        meow(t, out, [560, 820, 520], [0.14, 0.42]);
        break;
      case 'sadMeow':
        // 低く長く下がっていく、寂しい鳴き声（2 回）
        meow(t, out, [520, 600, 330], [0.18, 0.75], 0.42);
        meow(t + 0.95, out, [470, 520, 300], [0.15, 0.6], 0.3);
        break;
      case 'happyMeow':
        // 高く跳ね上がる短い鳴き声 2 つと、きらっとした音
        meow(t, out, [700, 1050, 900], [0.08, 0.2]);
        meow(t + 0.24, out, [760, 1150, 980], [0.08, 0.24]);
        osc('sine', 1800, t + 0.05, 0.25, 0.04, out, { to: 2600, send: 0.7 });
        break;
      case 'splash':
        // ちゃぷん（泡の高い音と、水のざわめき）
        noise(t, 0.35, 0.16, out, 'bandpass', 900, { q: 0.8, to: 400, attack: 0.01 });
        for (let i = 0; i < 3; i++) osc('sine', 700 + Math.random() * 500, t + 0.03 + i * 0.07, 0.07, 0.05, out, { to: 1600 + Math.random() * 600 });
        break;
      case 'coin': {
        if (t - lastCoin < 0.09) return;
        lastCoin = t;
        const k = 1 + (Math.random() - 0.5) * 0.04;
        osc('square', 988 * k, t, 0.05, 0.035, out);
        osc('square', 1319 * k, t + 0.055, 0.16, 0.035, out);
        osc('sine', 2637 * k, t + 0.055, 0.12, 0.03, out, { send: 0.4 });
        break;
      }
      case 'craft':
        // 手作業の完成: 小さなとんとんとチリン
        osc('triangle', 660, t, 0.06, 0.12, out, { to: 520 });
        osc('triangle', 880, t + 0.08, 0.06, 0.1, out, { to: 700 });
        osc('sine', 1760, t + 0.16, 0.25, 0.05, out, { send: 0.6 });
        break;
      case 'rp':
        osc('sine', 1400 + Math.random() * 300, t, 0.12, 0.03, out, { to: 2400, send: 0.6 });
        break;
      case 'thud':
        osc('sine', 120, t, 0.18, 0.4, out, { to: 48 });
        noise(t, 0.08, 0.15, out, 'lowpass', 500);
        break;
      case 'expand':
        // 地鳴りと水しぶき、せり上がりきったところでチャイム
        noise(t, 1.9, 0.3, out, 'lowpass', 180, { attack: 0.4, to: 120 });
        osc('sine', 55, t, 1.9, 0.3, out, { attack: 0.5, to: 85 });
        noise(t + 0.25, 1.4, 0.08, out, 'bandpass', 1800, { q: 0.7, attack: 0.3, to: 900 });
        [72, 76, 79, 84].forEach((m, i) => osc('sine', mtof(m), t + 2.0 + i * 0.09, 0.6, 0.1, out, { send: 0.8 }));
        break;
      case 'pet': {
        // ごろごろ（低いノイズを 25Hz でゆらす）＋ うれしい鳴き声
        const ac = ctx;
        const src = ac.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 260;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
        g.gain.setValueAtTime(0.5, t + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
        const am = ac.createGain();
        am.gain.value = 0.5;
        const lfo = ac.createOscillator();
        lfo.frequency.value = 25;
        const depth = ac.createGain();
        depth.gain.value = 0.5;
        lfo.connect(depth).connect(am.gain);
        src.connect(lp).connect(am).connect(g).connect(out);
        src.start(t);
        lfo.start(t);
        src.stop(t + 1.05);
        lfo.stop(t + 1.05);
        osc('sine', 1800, t + 0.05, 0.25, 0.04, out, { to: 2600, send: 0.7 });
        setTimeout(() => play('meow'), 350);
        break;
      }
      case 'bark': {
        // ワン: のこぎり波の短い上下と、口の開きのフォルマント
        const k = 0.85 + Math.random() * 0.35;
        for (const [d, f] of [[0, 1], [0.16, 0.92]] as const) {
          if (d && Math.random() < 0.5) break;
          const ac = ctx;
          const n = ac.createOscillator();
          n.type = 'sawtooth';
          n.frequency.setValueAtTime(260 * k * f, t + d);
          n.frequency.linearRampToValueAtTime(420 * k * f, t + d + 0.04);
          n.frequency.exponentialRampToValueAtTime(180 * k * f, t + d + 0.13);
          const bp = ac.createBiquadFilter();
          bp.type = 'bandpass';
          bp.Q.value = 3;
          bp.frequency.setValueAtTime(700, t + d);
          bp.frequency.linearRampToValueAtTime(1300, t + d + 0.04);
          bp.frequency.linearRampToValueAtTime(600, t + d + 0.13);
          const g = ac.createGain();
          g.gain.setValueAtTime(0.0001, t + d);
          g.gain.exponentialRampToValueAtTime(0.5, t + d + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.15);
          n.connect(bp).connect(g).connect(out);
          n.start(t + d);
          n.stop(t + d + 0.18);
          noise(t + d, 0.05, 0.08, out, 'bandpass', 2400, { q: 1 });
        }
        break;
      }
      case 'horn':
        // 船の警笛: 低い 2 音の長い汽笛
        for (const [d, f] of [[0, 147], [0.9, 131]] as const) {
          osc('sawtooth', f, t + d, 0.75, 0.09, out, { attack: 0.08, send: 0.6 });
          osc('sawtooth', f * 1.5, t + d, 0.75, 0.045, out, { attack: 0.08 });
          osc('sine', f / 2, t + d, 0.8, 0.18, out, { attack: 0.1 });
        }
        break;
      case 'siren': {
        const ac = ctx;
        const n = ac.createOscillator();
        n.type = 'triangle';
        n.frequency.setValueAtTime(520, t);
        n.frequency.linearRampToValueAtTime(980, t + 0.9);
        n.frequency.linearRampToValueAtTime(520, t + 1.8);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.13, t + 0.2);
        g.gain.setValueAtTime(0.13, t + 1.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.85);
        n.connect(g).connect(out);
        g.connect(sendTo(0.5));
        n.start(t);
        n.stop(t + 1.9);
        break;
      }
      case 'fireWater':
        noise(t, 0.16, 0.12, out, 'bandpass', 2600, { q: 0.8, to: 1200, attack: 0.01 });
        osc('sine', 600, t, 0.05, 0.06, out, { to: 900 });
        break;
      case 'fireTurret':
        // 短く乾いたタタッ
        noise(t, 0.035, 0.22, out, 'bandpass', 1800, { q: 1.5 });
        osc('square', 210, t, 0.03, 0.06, out, { to: 120 });
        break;
      case 'fireCannon':
        osc('sine', 90, t, 0.4, 0.55, out, { to: 35 });
        noise(t, 0.45, 0.35, out, 'lowpass', 1600, { to: 160 });
        noise(t, 0.05, 0.2, out, 'highpass', 3000);
        break;
      case 'impact':
        noise(t, 0.14, 0.12, out, 'bandpass', 1500, { q: 1.2, to: 700 });
        osc('sine', 300, t, 0.06, 0.08, out, { to: 140 });
        break;
      case 'boom':
        osc('sine', 70, t, 0.6, 0.5, out, { to: 30 });
        noise(t, 0.7, 0.3, out, 'lowpass', 900, { to: 120, attack: 0.01 });
        break;
      case 'break':
        // バキッと割れて、がらがら崩れる
        noise(t, 0.08, 0.3, out, 'highpass', 1800);
        osc('square', 180, t, 0.1, 0.08, out, { to: 70 });
        for (let i = 0; i < 6; i++) noise(t + 0.08 + i * 0.06 + Math.random() * 0.03, 0.05, 0.1, out, 'bandpass', 600 + Math.random() * 1400, { q: 3 });
        break;
      case 'repair':
        // 金づちで 3 回たたいて、直ったチャイム
        for (let i = 0; i < 3; i++) {
          osc('square', 1400, t + i * 0.14, 0.03, 0.06, out);
          osc('sine', 2900, t + i * 0.14, 0.12, 0.04, out, { send: 0.4 });
          noise(t + i * 0.14, 0.03, 0.1, out, 'bandpass', 3500, { q: 2 });
        }
        [76, 84].forEach((m, i) => osc('sine', mtof(m), t + 0.45 + i * 0.1, 0.4, 0.1, out, { send: 0.7 }));
        break;
      case 'fanfare':
        [[67, 0], [67, 0.12], [67, 0.24], [72, 0.4], [76, 0.7], [79, 0.86], [84, 1.05]].forEach(([m, d]) => {
          osc('square', mtof(m), t + d, m === 84 ? 0.7 : 0.14, 0.05, out, { send: 0.5 });
          osc('triangle', mtof(m - 12), t + d, m === 84 ? 0.7 : 0.14, 0.08, out);
        });
        noise(t + 1.05, 0.8, 0.04, out, 'highpass', 6000, { attack: 0.05 });
        break;
      case 'sell': {
        // レジのチーン（小さく）
        const r = Math.random();
        osc('sine', mtof(88 + Math.floor(r * 3) * 2), t, 0.22, 0.05, out, { send: 0.5 });
        osc('sine', mtof(95), t + 0.06, 0.3, 0.035, out, { send: 0.5 });
        noise(t, 0.03, 0.04, out, 'highpass', 5000);
        break;
      }
      case 'robotBoot':
        // 起動音: 上がっていくうなりと、目が点く電子音
        osc('sawtooth', 110, t, 0.45, 0.05, out, { to: 440, attack: 0.05 });
        noise(t, 0.4, 0.03, out, 'bandpass', 1200, { q: 2, to: 4000 });
        [[84, 0.42], [91, 0.52], [96, 0.62]].forEach(([m, d]) => osc('square', mtof(m), t + d, 0.09, 0.035, out, { send: 0.4 }));
        break;
      case 'lose':
        [[67, 0], [66, 0.25], [65, 0.5], [64, 0.75]].forEach(([m, d]) => osc('triangle', mtof(m - 12), t + d, 0.3, 0.12, out, { send: 0.4 }));
        break;
    }
  }

  const v3 = new THREE.Vector3();
  const sums = new Map<Voice, [number, number]>();
  let ambAt = 0;

  return {
    settings,
    play,
    /** 開発時の確認用 */
    get state() {
      return ctx?.state ?? 'none';
    },
    set(bus: Bus | 'muted', value: number | boolean) {
      if (bus === 'muted') settings.muted = !!value;
      else settings[bus] = value as number;
      localStorage.setItem(KEY, JSON.stringify(settings));
      applyGains();
    },
    /** 工場の規模（BGM のレイヤー数）と稼働中の建物の環境音を更新する */
    update(s: GameState, camera: THREE.Camera, now: number) {
      const n = s.buildings.length;
      const c = s.cats.length;
      raidWant = s.raid?.cur && !s.raid.cur.result ? 1 : 0;
      scale = n >= 70 || c >= 25 ? 4 : n >= 30 || c >= 12 ? 3 : n >= 12 || c >= 5 ? 2 : n >= 4 || c >= 2 ? 1 : 0;
      if (!ctx || now - ambAt < 0.2) return;
      ambAt = now;
      sums.clear();
      const add = (type: Voice, x: number, y: number, k = 1) => {
        v3.set(x + 0.5, 0.3, y + 0.5);
        const d = v3.distanceTo(camera.position);
        v3.project(camera);
        const on = Math.abs(v3.x) < 1.2 && Math.abs(v3.y) < 1.2 ? 1 : 0.2;
        const w = (k * on) / (1 + (d / 14) ** 2);
        const acc = sums.get(type) ?? [0, 0];
        acc[0] += w;
        acc[1] += w * THREE.MathUtils.clamp(v3.x, -1, 1);
        sums.set(type, acc);
      };
      for (const b of s.buildings) if (AMB_GAIN[b.type] && b.running) add(b.type, b.x, b.y);
      // 品が流れているリフト（詰まっていない）と、歩いているロボ猫
      for (const l of s.lifts) if (l.items.length && l.items[0].p < 1) add('lift', l.x, l.y, 0.35);
      for (const c of s.cats) if (c.robot && c.path.length && !c.rest) add('robot', c.x, c.y);
      for (const [type, v] of voices) {
        const [w, p] = sums.get(type) ?? [0, 0];
        v.level = 1 - Math.exp(-w * 1.6);
        v.gain.gain.setTargetAtTime(v.level * AMB_GAIN[type]!, ctx.currentTime, 0.25);
        v.pan.pan.setTargetAtTime(w > 0 ? (p / w) * 0.85 : 0, ctx.currentTime, 0.25);
      }
    },
  };
}
export type GameAudio = ReturnType<typeof createAudio>;
