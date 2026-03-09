import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO ENGINE
// X axis  → filter cutoff (dark/muffled ↔ bright/open)
// Y axis  → tempo / pulse density (slow ↔ fast)
// Speed   → reverb wet / intensity / harmonic complexity
// Quadrant → which harmonic mode is active (4 distinct moods)
// ─────────────────────────────────────────────────────────────────────────────

class ConductorEngine {
  constructor() {
    this.ctx = null;
    this.nodes = {};
    this.running = false;
    this.pulseTimer = null;
    this.params = { x: 0.5, y: 0.5, speed: 0, quadrant: 0 };
    this.noteIndex = 0;
    this.scales = {
      0: [261.63, 311.13, 349.23, 392.00, 466.16, 523.25], // C minor (dark)
      1: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25], // C major (bright)
      2: [261.63, 293.66, 349.23, 392.00, 466.16, 523.25], // C dorian (fluid)
      3: [261.63, 311.13, 392.00, 466.16, 587.33, 622.25], // C phrygian (tense)
    };
  }

  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = this.ctx;

    // Master chain: filter → convolver (reverb) → compressor → out
    this.nodes.filter = ctx.createBiquadFilter();
    this.nodes.filter.type = "lowpass";
    this.nodes.filter.frequency.value = 800;
    this.nodes.filter.Q.value = 2;

    this.nodes.reverb = ctx.createConvolver();
    this.nodes.reverbGain = ctx.createGain();
    this.nodes.reverbGain.gain.value = 0.4;
    this.nodes.dryGain = ctx.createGain();
    this.nodes.dryGain.gain.value = 0.7;

    // Build impulse response for reverb
    const reverbBuffer = this._makeReverb(ctx, 2.5);
    this.nodes.reverb.buffer = reverbBuffer;

    this.nodes.compressor = ctx.createDynamicsCompressor();
    this.nodes.compressor.threshold.value = -18;
    this.nodes.compressor.ratio.value = 4;
    this.nodes.masterGain = ctx.createGain();
    this.nodes.masterGain.gain.value = 0.75;

    // Routing
    this.nodes.filter.connect(this.nodes.dryGain);
    this.nodes.filter.connect(this.nodes.reverb);
    this.nodes.reverb.connect(this.nodes.reverbGain);
    this.nodes.dryGain.connect(this.nodes.compressor);
    this.nodes.reverbGain.connect(this.nodes.compressor);
    this.nodes.compressor.connect(this.nodes.masterGain);
    this.nodes.masterGain.connect(ctx.destination);

    // Drone pad (2 detuned oscillators)
    this.nodes.drone1 = this._makePad(ctx, 65.41, 0);   // C2
    this.nodes.drone2 = this._makePad(ctx, 65.41 * 1.003, -3); // slightly detuned
    this.nodes.droneGain = ctx.createGain();
    this.nodes.droneGain.gain.value = 0.18;
    this.nodes.drone1.connect(this.nodes.droneGain);
    this.nodes.drone2.connect(this.nodes.droneGain);
    this.nodes.droneGain.connect(this.nodes.filter);

    // Sub bass
    this.nodes.sub = ctx.createOscillator();
    this.nodes.sub.type = "sine";
    this.nodes.sub.frequency.value = 32.7; // C1
    this.nodes.subGain = ctx.createGain();
    this.nodes.subGain.gain.value = 0.22;
    this.nodes.sub.connect(this.nodes.subGain);
    this.nodes.subGain.connect(this.nodes.filter);
    this.nodes.sub.start();

    this.running = true;
    this._schedulePulse();
  }

  _makePad(ctx, freq, detune) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.detune.value = detune;

    // Shape the sawtooth with a waveshaper for warmth
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._softClip();

    osc.connect(shaper);
    osc.start();
    return shaper;
  }

  _softClip() {
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = (3 * x) / (2 * (1 + Math.abs(x)));
    }
    return curve;
  }

  _makeReverb(ctx, duration) {
    const rate = ctx.sampleRate;
    const length = rate * duration;
    const buffer = ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    return buffer;
  }

  _schedulePulse() {
    if (!this.running) return;
    const { y, speed, quadrant } = this.params;

    // BPM: Y axis controls tempo 40–140 BPM
    const bpm = 40 + y * 100;
    const interval = (60 / bpm) * 1000;

    this._triggerNote();

    this.pulseTimer = setTimeout(() => this._schedulePulse(), interval);
  }

  _triggerNote() {
    if (!this.ctx || !this.running) return;
    const ctx = this.ctx;
    const { x, y, speed, quadrant } = this.params;

    const scale = this.scales[quadrant];
    const noteFreq = scale[this.noteIndex % scale.length];

    // Note selection: high speed = random jumps, low speed = stepwise
    if (speed > 0.5) {
      this.noteIndex = Math.floor(Math.random() * scale.length);
    } else {
      this.noteIndex = (this.noteIndex + 1) % scale.length;
    }

    // Transpose based on Y (higher position = higher register)
    const octaveShift = Math.floor(y * 2);
    const freq = noteFreq * Math.pow(2, octaveShift);

    // Create note
    const osc = ctx.createOscillator();
    osc.type = speed > 0.6 ? "square" : "triangle";
    osc.frequency.value = freq;

    const env = ctx.createGain();
    const now = ctx.currentTime;
    const attackTime = 0.02;
    const sustainTime = 0.1 + (1 - y) * 0.3;
    const releaseTime = 0.15 + (1 - speed) * 0.4;

    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.3 + speed * 0.2, now + attackTime);
    env.gain.setValueAtTime(0.2 + speed * 0.15, now + attackTime + sustainTime);
    env.gain.exponentialRampToValueAtTime(0.001, now + attackTime + sustainTime + releaseTime);

    osc.connect(env);
    env.connect(this.nodes.filter);

    osc.start(now);
    osc.stop(now + attackTime + sustainTime + releaseTime + 0.05);

    // Occasional percussion hit when moving fast
    if (speed > 0.4 && Math.random() > 0.5) {
      this._triggerPercussion(speed);
    }
  }

  _triggerPercussion(speed) {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Noise burst
    const bufLen = ctx.sampleRate * 0.12;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 3);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 1000 + speed * 3000;
    filt.Q.value = 1;

    const env = ctx.createGain();
    env.gain.setValueAtTime(speed * 0.4, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    src.connect(filt);
    filt.connect(env);
    env.connect(this.nodes.compressor);
    src.start(now);
  }

  update(x, y, speed) {
    if (!this.ctx || !this.running) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Determine quadrant (0=bottom-left, 1=bottom-right, 2=top-left, 3=top-right)
    const quadrant = (x > 0.5 ? 1 : 0) + (y > 0.5 ? 2 : 0);

    this.params = { x, y, speed: Math.min(speed, 1), quadrant };

    // Filter cutoff: X axis 200Hz – 8000Hz
    const cutoff = 200 + x * x * 7800;
    this.nodes.filter.frequency.setTargetAtTime(cutoff, now, 0.1);

    // Filter resonance: more at edges
    const q = 1 + Math.abs(x - 0.5) * 8;
    this.nodes.filter.Q.setTargetAtTime(q, now, 0.15);

    // Drone pitch shifts with Y
    const droneFreq = 55 + y * 33; // A1 to ~C2
    this.nodes.drone1.connect && null; // drone is waveshaper, can't set freq directly
    // sub bass pitch
    this.nodes.sub.frequency.setTargetAtTime(32.7 + y * 16, now, 0.3);

    // Reverb wet: more reverb when moving fast
    const wet = 0.2 + speed * 0.5;
    this.nodes.reverbGain.gain.setTargetAtTime(Math.min(wet, 0.8), now, 0.2);
    this.nodes.dryGain.gain.setTargetAtTime(1 - wet * 0.4, now, 0.2);

    // Drone gain: swell when still
    const droneTarget = speed < 0.1 ? 0.28 : 0.14;
    this.nodes.droneGain.gain.setTargetAtTime(droneTarget, now, 0.5);
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.pulseTimer);
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REACT UI
// ─────────────────────────────────────────────────────────────────────────────

const QUADRANT_NAMES = ["Shadows", "Clarity", "Depths", "Storm"];
const QUADRANT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444"];
const QUADRANT_DESC = [
  "dark · resonant · low",
  "bright · open · sharp",
  "deep · slow · drifting",
  "tense · erratic · dense",
];

export default function Conductor() {
  const engineRef = useRef(null);
  const containerRef = useRef(null);
  const orbRef = useRef(null);
  const trailRef = useRef([]);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);

  const [started, setStarted] = useState(false);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [speed, setSpeed] = useState(0);
  const [quadrant, setQuadrant] = useState(0);
  const [params, setParams] = useState({
    filter: 50, tempo: 50, reverb: 20, intensity: 0,
  });

  const lastPosRef = useRef({ x: 0.5, y: 0.5, t: Date.now() });

  const handleStart = useCallback(async () => {
    if (!engineRef.current) {
      engineRef.current = new ConductorEngine();
    }
    await engineRef.current.init();
    setStarted(true);
  }, []);

  // Draw trail on canvas
  const drawTrail = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const W = container.clientWidth;
    const H = container.clientHeight;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const trail = trailRef.current;
    if (trail.length < 2) return;

    // Draw fading trail
    for (let i = 1; i < trail.length; i++) {
      const alpha = (i / trail.length) * 0.6;
      const pt = trail[i];
      const prev = trail[i - 1];
      const color = QUADRANT_COLORS[pt.q] + Math.floor(alpha * 255).toString(16).padStart(2, "0");

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 + pt.speed * 4;
      ctx.lineCap = "round";
      ctx.moveTo(prev.px, prev.py);
      ctx.lineTo(pt.px, pt.py);
      ctx.stroke();
    }

    animFrameRef.current = requestAnimationFrame(drawTrail);
  }, []);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(drawTrail);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drawTrail]);

  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  const processMove = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const x = Math.max(0, Math.min(1, px / rect.width));
    const y = Math.max(0, Math.min(1, py / rect.height));

    const now = Date.now();
    const last = lastPosRef.current;
    const dt = Math.max(now - last.t, 16);
    const dx = x - last.x;
    const dy = y - last.y;
    const rawSpeed = Math.sqrt(dx * dx + dy * dy) / (dt / 1000);
    const normSpeed = Math.min(rawSpeed * 1.5, 1);

    lastPosRef.current = { x, y, t: now };

    const q = (x > 0.5 ? 1 : 0) + (y < 0.5 ? 2 : 0);

    // Update trail
    trailRef.current = [
      ...trailRef.current.slice(-40),
      { px, py, q, speed: normSpeed }
    ];

    setPos({ x, y });
    setSpeed(normSpeed);
    setQuadrant(q);
    setParams({
      filter: Math.round(x * 100),
      tempo: Math.round(y * 100),
      reverb: Math.round(normSpeed * 100),
      intensity: Math.round(normSpeed * 100),
    });

    engineRef.current?.resume();
    engineRef.current?.update(x, y, normSpeed);
  }, []);

  const handleTouchMove = useCallback((e) => {
    e.preventDefault();
    const touch = e.touches[0];
    processMove(touch.clientX, touch.clientY);
  }, [processMove]);

  const handleMouseMove = useCallback((e) => {
    if (e.buttons !== 1) return;
    processMove(e.clientX, e.clientY);
  }, [processMove]);

  const handleTouchStart = useCallback((e) => {
    e.preventDefault();
    const touch = e.touches[0];
    processMove(touch.clientX, touch.clientY);
  }, [processMove]);

  // Decay speed when not moving
  useEffect(() => {
    const interval = setInterval(() => {
      setSpeed(s => {
        const next = s * 0.85;
        if (engineRef.current) engineRef.current.params.speed = next;
        return next;
      });
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const qColor = QUADRANT_COLORS[quadrant];
  const orbX = `${pos.x * 100}%`;
  const orbY = `${pos.y * 100}%`;

  if (!started) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#050508",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Georgia', serif",
        color: "#e2e8f0",
        padding: "32px",
        textAlign: "center",
        userSelect: "none",
      }}>
        <div style={{
          width: 80, height: 80,
          borderRadius: "50%",
          background: "radial-gradient(circle at 35% 35%, #a78bfa, #4f46e5, #1e1b4b)",
          marginBottom: 32,
          boxShadow: "0 0 60px #6366f144",
        }} />
        <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#6366f1", textTransform: "uppercase", marginBottom: 12 }}>
          PostListener · Prototype
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 400, marginBottom: 12, lineHeight: 1.3 }}>
          The Conductor
        </h1>
        <p style={{ fontSize: 14, color: "#94a3b8", maxWidth: 280, lineHeight: 1.7, marginBottom: 40 }}>
          Drag your finger across the screen. The music follows. You are not in control — you are being read.
        </p>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 32, lineHeight: 2 }}>
          ← → <span style={{ color: "#94a3b8" }}>filter · brightness</span><br />
          ↑ ↓ <span style={{ color: "#94a3b8" }}>tempo · density</span><br />
          speed <span style={{ color: "#94a3b8" }}>reverb · chaos</span>
        </div>
        <button
          onClick={handleStart}
          style={{
            background: "transparent",
            border: "1px solid #6366f1",
            color: "#a5b4fc",
            padding: "14px 40px",
            borderRadius: 2,
            fontSize: 13,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "'Georgia', serif",
          }}
        >
          Begin
        </button>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "#050508",
      overflow: "hidden",
      userSelect: "none",
      touchAction: "none",
    }}>
      {/* Trail canvas */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />

      {/* Touch surface */}
      <div
        ref={containerRef}
        style={{ position: "absolute", inset: 0 }}
        onMouseMove={handleMouseMove}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
      >
        {/* Quadrant labels */}
        {[
          { label: "Shadows", x: "8%", y: "92%", q: 0 },
          { label: "Clarity", x: "75%", y: "92%", q: 1 },
          { label: "Depths", x: "8%", y: "8%", q: 2 },
          { label: "Storm", x: "78%", y: "8%", q: 3 },
        ].map(({ label, x, y, q }) => (
          <div key={label} style={{
            position: "absolute", left: x, top: y,
            fontSize: 9, letterSpacing: "0.2em",
            color: QUADRANT_COLORS[q] + "66",
            textTransform: "uppercase",
            fontFamily: "monospace",
            transform: "translateY(-50%)",
            pointerEvents: "none",
          }}>
            {label}
          </div>
        ))}

        {/* Grid lines */}
        <div style={{
          position: "absolute", left: "50%", top: 0, bottom: 0,
          width: 1, background: "#ffffff08", pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", top: "50%", left: 0, right: 0,
          height: 1, background: "#ffffff08", pointerEvents: "none",
        }} />

        {/* The Orb */}
        <div
          ref={orbRef}
          style={{
            position: "absolute",
            left: orbX,
            top: orbY,
            transform: "translate(-50%, -50%)",
            width: 64 + speed * 24,
            height: 64 + speed * 24,
            borderRadius: "50%",
            background: `radial-gradient(circle at 35% 35%, ${qColor}cc, ${qColor}44, transparent)`,
            boxShadow: `0 0 ${20 + speed * 60}px ${qColor}88, 0 0 ${60 + speed * 40}px ${qColor}22`,
            border: `1px solid ${qColor}66`,
            transition: "left 0.05s ease-out, top 0.05s ease-out, width 0.1s, height 0.1s, background 0.4s, box-shadow 0.1s",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#fff",
            opacity: 0.9,
          }} />
        </div>
      </div>

      {/* HUD — bottom strip */}
      <div style={{
        position: "absolute",
        bottom: 0, left: 0, right: 0,
        padding: "16px 20px 20px",
        background: "linear-gradient(transparent, #05050888 40%, #050508ee)",
        pointerEvents: "none",
      }}>
        {/* Mode label */}
        <div style={{
          textAlign: "center",
          marginBottom: 12,
        }}>
          <span style={{
            fontSize: 10,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: qColor,
            fontFamily: "monospace",
            transition: "color 0.3s",
          }}>
            {QUADRANT_NAMES[quadrant]}
          </span>
          <span style={{ color: "#33334488", margin: "0 8px" }}>·</span>
          <span style={{ fontSize: 10, color: "#475569", fontFamily: "monospace" }}>
            {QUADRANT_DESC[quadrant]}
          </span>
        </div>

        {/* Param bars */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {[
            { label: "FILTER", val: params.filter, color: "#f59e0b" },
            { label: "TEMPO", val: params.tempo, color: "#10b981" },
            { label: "REVERB", val: params.reverb, color: "#6366f1" },
            { label: "FORCE", val: params.intensity, color: "#ef4444" },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "#475569", letterSpacing: "0.15em", marginBottom: 4, fontFamily: "monospace" }}>
                {label}
              </div>
              <div style={{ height: 3, background: "#1e293b", borderRadius: 2 }}>
                <div style={{
                  height: "100%",
                  width: `${val}%`,
                  background: color,
                  borderRadius: 2,
                  transition: "width 0.1s ease-out, background 0.3s",
                }} />
              </div>
              <div style={{ fontSize: 9, color: color, marginTop: 3, fontFamily: "monospace" }}>
                {val}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top hint */}
      <div style={{
        position: "absolute",
        top: 16, left: 0, right: 0,
        textAlign: "center",
        pointerEvents: "none",
      }}>
        <span style={{
          fontSize: 9, letterSpacing: "0.25em",
          color: "#1e293b",
          textTransform: "uppercase",
          fontFamily: "monospace",
        }}>
          drag to conduct
        </span>
      </div>
    </div>
  );
}
