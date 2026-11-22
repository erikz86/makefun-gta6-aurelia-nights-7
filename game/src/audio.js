// Procedural WebAudio only — no sound files. Everything is guarded: in Node (or
// before the first user gesture) there is no AudioContext and every call is a no-op,
// so importing this module in a headless test is safe.

import { RADIO } from './config.js';

const NOTE = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let muted = false;
  let radioStation = 0;
  let radioStep = 0;
  let radioTimer = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  /** Call from a user gesture (start button): unlocks audio on browsers that need it. */
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function beep(freq, dur, type, vol, when) {
    if (!ensure() || muted) return;
    try {
      const t = ctx.currentTime + (when || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol || 0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch {
      // Audio is best-effort; a failure never breaks the game.
    }
  }

  function engine(speed01) {
    if (!ensure() || muted) return;
    try {
      if (!engineOsc) {
        engineOsc = ctx.createOscillator();
        engineGain = ctx.createGain();
        engineOsc.type = 'sawtooth';
        engineGain.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        engineOsc.connect(filter);
        filter.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
      }
      engineOsc.frequency.value = 55 + speed01 * 130;
      engineGain.gain.value = 0.02 + speed01 * 0.05;
    } catch {
      // Ignore.
    }
  }

  function siren(on) {
    if (!ensure() || muted) {
      if (sirenGain) sirenGain.gain.value = 0;
      return;
    }
    try {
      if (!sirenOsc) {
        sirenOsc = ctx.createOscillator();
        sirenGain = ctx.createGain();
        sirenOsc.type = 'triangle';
        sirenOsc.frequency.value = 700;
        sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain);
        sirenGain.connect(master);
        sirenOsc.start();
      }
      sirenGain.gain.value = on ? 0.045 : 0;
      if (on) {
        sirenTimer += 1;
        sirenOsc.frequency.value = sirenTimer % 40 < 20 ? 700 : 950;
      }
    } catch {
      // Ignore.
    }
  }

  return {
    unlock,
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    isMuted() {
      return muted;
    },
    chime() {
      beep(880, 0.12, 'sine', 0.22);
      beep(1318, 0.18, 'sine', 0.18, 0.07);
    },
    thud() {
      beep(90, 0.18, 'triangle', 0.3);
    },
    shoot(weapon) {
      if (weapon === 0) beep(160, 0.08, 'square', 0.15);
      else beep(weapon === 1 ? 1200 : 900, 0.06, 'square', 0.16);
    },
    sting() {
      beep(523, 0.16, 'triangle', 0.2);
      beep(659, 0.16, 'triangle', 0.2, 0.12);
      beep(784, 0.3, 'triangle', 0.22, 0.24);
    },
    engine,
    siren,
    setRadio(station) {
      radioStation = station;
      radioStep = 0;
      radioTimer = 0;
    },
    /** Call each frame with dt: schedules the radio station's procedural loop. */
    radioTick(dt) {
      if (!ensure() || muted) return;
      const station = RADIO[radioStation];
      radioTimer -= dt;
      if (radioTimer > 0) return;
      radioTimer += 60 / station.bpm / 2;
      const step = radioStep % 16;
      radioStep += 1;
      const scale = station.scale;
      const degree = scale[step % scale.length] + 12 * Math.floor(step / scale.length / 2);
      const freq = NOTE(station.base + degree);
      if (step % 4 === 0) beep(NOTE(station.base - 24), 0.22, 'triangle', 0.16);
      if (step % 2 === 0) beep(freq, 0.14, 'square', 0.05);
      if (step === 0 || step === 8) beep(NOTE(station.base + 12), 0.3, 'sine', 0.08);
    },
  };
}
