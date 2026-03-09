import { useState, useEffect, useRef, useCallback } from "react";

class ConductorEngine {
  constructor() {
    this.ctx = null; this.nodes = {}; this.running = false;
    this.pulseTimer = null;
    this.params = { x: 0.5, y: 0.5, speed: 0, quadrant: 0 };
    this.noteIndex = 0;
    this.scales = {
      0: [261.63, 311.13, 349.23, 392.00, 466.16, 523.25],
      1: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25],
      2: [261.63, 293.66, 349.23, 392.00, 466.16, 523.25],
      3: [261.63, 311.13, 392.00, 466.16, 587.33, 622.25],
    };
  }
  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = this.ctx;
    this.nodes.filter = ctx.createBiquadFilter();
    this.nodes.filter.type = "lowpass";
    this.nodes.filter.frequency.value = 800;
    this.nodes.filter.Q.value = 2;
    this.nodes.reverb = ctx.createConvolver();
    this.nodes.reverb.buffer = this._makeReverb(ctx, 2.5);
    this.nodes.reverbGain = ctx.createGain(); this.nodes.reverbGain.gain.value = 0.3;
    this.nodes.dryGain = ctx.createGain(); this.nodes.dryGain.gain.value = 0.7;
    this.nodes.compressor = ctx.createDynamicsCompressor();
    this.nodes.compressor.threshold.value = -18; this.nodes.compressor.ratio.value = 4;
    this.nodes.masterGain = ctx.createGain(); this.nodes.masterGain.gain.value = 0.8;
    this.nodes.filter.connect(this.nodes.dryGain);
    this.nodes.filter.connect(this.nodes.reverb);
    this.nodes.reverb.connect(this.nodes.reverbGain);
    this.nodes.dryGain.connect(this.nodes.compressor);
    this.nodes.reverbGain.connect(this.nodes.compressor);
    this.nodes.compressor.connect(this.nodes.masterGain);
    this.nodes.masterGain.connect(ctx.destination);
    this.nodes.droneGain = ctx.createGain(); this.nodes.droneGain.gain.value = 0.15;
    this.nodes.droneGain.connect(this.nodes.filter);
    const d1 = ctx.createOscillator(); d1.type = "sawtooth"; d1.frequency.value = 65.41;
    const d2 = ctx.createOscillator(); d2.type = "sawtooth"; d2.frequency.value = 65.67;
    d1.connect(this.nodes.droneGain); d2.connect(this.nodes.droneGain);
    d1.start(); d2.start();
    this.nodes.sub = ctx.createOscillator(); this.nodes.sub.type = "sine"; this.nodes.sub.frequency.value = 32.7;
    this.nodes.subGain = ctx.createGain(); this.nodes.subGain.gain.value = 0.2;
    this.nodes.sub.connect(this.nodes.subGain); this.nodes.subGain.connect(this.nodes.filter);
    this.nodes.sub.start();
    this.running = true; this._schedulePulse();
  }
  _makeReverb(ctx, dur) {
    const len = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/len,2); }
    return buf;
  }
  _schedulePulse() {
    if (!this.running) return;
    const bpm = 40 + this.params.y * 100;
    this._triggerNote();
    this.pulseTimer = setTimeout(() => this._schedulePulse(), (60/bpm)*1000);
  }
  _triggerNote() {
    if (!this.ctx || !this.running) return;
    const ctx = this.ctx; const { x, y, speed, quadrant } = this.params;
    const scale = this.scales[quadrant];
    if (speed > 0.5) this.noteIndex = Math.floor(Math.random()*scale.length);
    else this.noteIndex = (this.noteIndex+1)%scale.length;
    const freq = scale[this.noteIndex] * Math.pow(2, Math.floor(y*2));
    const osc = ctx.createOscillator(); osc.type = speed>0.6?"square":"triangle"; osc.frequency.value = freq;
    const env = ctx.createGain(); const now = ctx.currentTime;
    const att=0.02, sus=0.1+(1-y)*0.3, rel=0.15+(1-speed)*0.4;
    env.gain.setValueAtTime(0,now); env.gain.linearRampToValueAtTime(0.3+speed*0.2,now+att);
    env.gain.setValueAtTime(0.2,now+att+sus); env.gain.exponentialRampToValueAtTime(0.001,now+att+sus+rel);
    osc.connect(env); env.connect(this.nodes.filter); osc.start(now); osc.stop(now+att+sus+rel+0.05);
    if (speed>0.45 && Math.random()>0.5) this._triggerPerc(speed);
  }
  _triggerPerc(speed) {
    const ctx = this.ctx; const now = ctx.currentTime;
    const len = ctx.sampleRate*0.12; const buf = ctx.createBuffer(1,len,ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3);
    const src = ctx.createBufferSource(); src.buffer=buf;
    const filt = ctx.createBiquadFilter(); filt.type="bandpass"; filt.frequency.value=1000+speed*3000;
    const env = ctx.createGain(); env.gain.setValueAtTime(speed*0.35,now); env.gain.exponentialRampToValueAtTime(0.001,now+0.12);
    src.connect(filt); filt.connect(env); env.connect(this.nodes.compressor); src.start(now);
  }
  update(x, y, speed) {
    if (!this.ctx||!this.running) return;
    const ctx=this.ctx; const now=ctx.currentTime;
    const quadrant=(x>0.5?1:0)+(y>0.5?2:0);
    this.params={x,y,speed:Math.min(speed,1),quadrant};
    this.nodes.filter.frequency.setTargetAtTime(200+x*x*7800,now,0.08);
    this.nodes.filter.Q.setTargetAtTime(1+Math.abs(x-0.5)*8,now,0.12);
    this.nodes.sub.frequency.setTargetAtTime(32.7+y*16,now,0.3);
    const wet=0.15+speed*0.6;
    this.nodes.reverbGain.gain.setTargetAtTime(Math.min(wet,0.85),now,0.15);
    this.nodes.dryGain.gain.setTargetAtTime(1-wet*0.35,now,0.15);
    this.nodes.droneGain.gain.setTargetAtTime(speed<0.1?0.25:0.12,now,0.4);
  }
  resume() { if(this.ctx?.state==="suspended") this.ctx.resume(); }
  stop() { this.running=false; clearTimeout(this.pulseTimer); this.ctx?.close(); this.ctx=null; }
}

const QUADRANT_NAMES = ["Shadows","Clarity","Depths","Storm"];
const QUADRANT_COLORS = ["#6366f1","#f59e0b","#10b981","#ef4444"];
const QUADRANT_DESC = ["dark · resonant · minor","bright · open · major","fluid · slow · dorian","tense · erratic · phrygian"];

export default function Conductor() {
  const engineRef = useRef(null);
  const canvasRef = useRef(null);
  const trailRef = useRef([]);
  const animRef = useRef(null);
  const containerRef = useRef(null);
  const smoothRef = useRef({x:0.5,y:0.5,speed:0});
  const lastAccRef = useRef({x:0,y:0,z:0});
  const lastTouchRef = useRef({x:0.5,y:0.5,t:Date.now()});

  const [started, setStarted] = useState(false);
  const [pos, setPos] = useState({x:0.5,y:0.5});
  const [speed, setSpeed] = useState(0);
  const [quadrant, setQuadrant] = useState(0);
  const [params, setParams] = useState({filter:50,tempo:50,reverb:0,force:0});
  const [inputMode, setInputMode] = useState("motion");

  const applyMotion = useCallback((x, y, spd) => {
    engineRef.current?.resume();
    engineRef.current?.update(x, y, spd);
    const q = (x>0.5?1:0)+(y>0.5?2:0);
    setPos({x,y}); setSpeed(spd); setQuadrant(q);
    setParams({filter:Math.round(x*100),tempo:Math.round(y*100),reverb:Math.round(spd*100),force:Math.round(spd*100)});
    const container = containerRef.current;
    if (container) {
      trailRef.current = [...trailRef.current.slice(-50), {px:x*container.clientWidth,py:y*container.clientHeight,q,speed:spd}];
    }
  }, []);

  const attachMotionListeners = useCallback(() => {
    const orientationHandler = (e) => {
      const gamma = Math.max(-60, Math.min(60, e.gamma||0));
      const beta  = Math.max(-60, Math.min(60, (e.beta||0)-45));
      const x = (gamma+60)/120;
      const y = (beta+60)/120;
      smoothRef.current.x += (x - smoothRef.current.x) * 0.2;
      smoothRef.current.y += (y - smoothRef.current.y) * 0.2;
      applyMotion(smoothRef.current.x, smoothRef.current.y, smoothRef.current.speed);
    };
    const motionHandler = (e) => {
      const acc = e.accelerationIncludingGravity || e.acceleration || {};
      const ax=acc.x||0, ay=acc.y||0, az=acc.z||0;
      const last = lastAccRef.current;
      const jerk = Math.sqrt((ax-last.x)**2+(ay-last.y)**2+(az-last.z)**2);
      lastAccRef.current = {x:ax,y:ay,z:az};
      const normSpd = Math.min(jerk/10, 1);
      smoothRef.current.speed += (normSpd - smoothRef.current.speed)*0.3;
    };
    window.addEventListener("deviceorientation", orientationHandler, true);
    window.addEventListener("devicemotion", motionHandler, true);
    return () => {
      window.removeEventListener("deviceorientation", orientationHandler, true);
      window.removeEventListener("devicemotion", motionHandler, true);
    };
  }, [applyMotion]);

  // Speed decay
  useEffect(() => {
    const iv = setInterval(() => { smoothRef.current.speed *= 0.88; }, 50);
    return () => clearInterval(iv);
  }, []);

  // Canvas trail
  const drawTrail = useCallback(() => {
    const canvas = canvasRef.current; const container = containerRef.current;
    if (canvas && container) {
      const W=container.clientWidth, H=container.clientHeight;
      if (canvas.width!==W||canvas.height!==H) { canvas.width=W; canvas.height=H; }
      const ctx=canvas.getContext("2d"); ctx.clearRect(0,0,W,H);
      const trail=trailRef.current;
      for (let i=1;i<trail.length;i++) {
        const alpha=(i/trail.length)*0.65;
        const pt=trail[i], prev=trail[i-1];
        const hex=Math.floor(alpha*255).toString(16).padStart(2,"0");
        ctx.beginPath(); ctx.strokeStyle=QUADRANT_COLORS[pt.q]+hex;
        ctx.lineWidth=2+pt.speed*5; ctx.lineCap="round";
        ctx.moveTo(prev.px,prev.py); ctx.lineTo(pt.px,pt.py); ctx.stroke();
      }
    }
    animRef.current = requestAnimationFrame(drawTrail);
  }, []);

  useEffect(() => { animRef.current=requestAnimationFrame(drawTrail); return ()=>cancelAnimationFrame(animRef.current); }, [drawTrail]);
  useEffect(() => () => engineRef.current?.stop(), []);

  const processTouch = useCallback((clientX, clientY) => {
    const container=containerRef.current; if(!container) return;
    const rect=container.getBoundingClientRect();
    const x=Math.max(0,Math.min(1,(clientX-rect.left)/rect.width));
    const y=Math.max(0,Math.min(1,(clientY-rect.top)/rect.height));
    const now=Date.now(); const last=lastTouchRef.current;
    const dt=Math.max(now-last.t,16);
    const rawSpd=Math.sqrt((x-last.x)**2+(y-last.y)**2)/(dt/1000);
    lastTouchRef.current={x,y,t:now};
    applyMotion(x, y, Math.min(rawSpd*1.5,1));
  }, [applyMotion]);

  const handleStart = useCallback(async (mode) => {
    engineRef.current = new ConductorEngine();
    await engineRef.current.init();
    setInputMode(mode);
    setStarted(true);
    if (mode === "motion") {
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        try {
          const state = await DeviceOrientationEvent.requestPermission();
          if (state === "granted") { try { await DeviceMotionEvent.requestPermission(); } catch(e){} attachMotionListeners(); }
        } catch(e) { setInputMode("touch"); }
      } else {
        attachMotionListeners();
      }
    }
  }, [attachMotionListeners]);

  const qColor = QUADRANT_COLORS[quadrant];

  if (!started) {
    return (
      <div style={{minHeight:"100dvh",background:"#050508",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"Georgia,serif",color:"#e2e8f0",padding:"32px 24px",textAlign:"center",userSelect:"none"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:"radial-gradient(circle at 35% 35%, #a78bfa, #4f46e5, #1e1b4b)",marginBottom:28,boxShadow:"0 0 60px #6366f133"}} />
        <div style={{fontSize:10,letterSpacing:"0.3em",color:"#6366f1",textTransform:"uppercase",marginBottom:10}}>PostListener · Prototype</div>
        <h1 style={{fontSize:26,fontWeight:400,marginBottom:10,lineHeight:1.3}}>The Conductor</h1>
        <p style={{fontSize:13,color:"#94a3b8",maxWidth:280,lineHeight:1.75,marginBottom:36}}>
          Move your phone through the air. The music follows. You are not in control — you are being read.
        </p>
        <div style={{display:"flex",flexDirection:"column",gap:12,width:"100%",maxWidth:280}}>
          <button onClick={()=>handleStart("motion")} style={{background:"transparent",border:"1px solid #6366f1",color:"#a5b4fc",padding:"16px 20px",borderRadius:2,fontSize:13,letterSpacing:"0.12em",textTransform:"uppercase",cursor:"pointer",fontFamily:"Georgia,serif",width:"100%"}}>
            🎶 Move Phone to Conduct
            <span style={{display:"block",fontSize:10,color:"#a5b4fc88",marginTop:4,letterSpacing:"0.05em",textTransform:"none"}}>tilt &amp; shake · uses gyroscope</span>
          </button>
          <button onClick={()=>handleStart("touch")} style={{background:"transparent",border:"1px solid #334155",color:"#64748b",padding:"16px 20px",borderRadius:2,fontSize:13,letterSpacing:"0.12em",textTransform:"uppercase",cursor:"pointer",fontFamily:"Georgia,serif",width:"100%"}}>
            👆 Touch / Drag
            <span style={{display:"block",fontSize:10,color:"#33334588",marginTop:4,letterSpacing:"0.05em",textTransform:"none"}}>drag finger across screen</span>
          </button>
        </div>
        <div style={{fontSize:11,color:"#1e293b",marginTop:32,lineHeight:2.2}}>
          tilt left/right → filter brightness<br/>
          tilt forward/back → tempo<br/>
          shake → reverb + chaos
        </div>
      </div>
    );
  }

  return (
    <div style={{position:"fixed",inset:0,background:"#050508",overflow:"hidden",userSelect:"none",touchAction:"none"}}>
      <canvas ref={canvasRef} style={{position:"absolute",inset:0,pointerEvents:"none"}} />
      <div ref={containerRef} style={{position:"absolute",inset:0}}
        onMouseMove={(e)=>{if(inputMode==="touch"&&e.buttons===1)processTouch(e.clientX,e.clientY);}}
        onTouchMove={(e)=>{e.preventDefault();if(inputMode==="touch")processTouch(e.touches[0].clientX,e.touches[0].clientY);}}
        onTouchStart={(e)=>{e.preventDefault();if(inputMode==="touch")processTouch(e.touches[0].clientX,e.touches[0].clientY);}}>
        {[{label:"Shadows",lx:"6%",ly:"90%",q:0},{label:"Clarity",lx:"72%",ly:"90%",q:1},{label:"Depths",lx:"6%",ly:"6%",q:2},{label:"Storm",lx:"80%",ly:"6%",q:3}].map(({label,lx,ly,q})=>(
          <div key={label} style={{position:"absolute",left:lx,top:ly,fontSize:9,letterSpacing:"0.2em",color:QUADRANT_COLORS[q]+"55",textTransform:"uppercase",fontFamily:"monospace",pointerEvents:"none"}}>{label}</div>
        ))}
        <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:"#ffffff07",pointerEvents:"none"}} />
        <div style={{position:"absolute",top:"50%",left:0,right:0,height:1,background:"#ffffff07",pointerEvents:"none"}} />
        <div style={{position:"absolute",left:`${pos.x*100}%`,top:`${pos.y*100}%`,transform:"translate(-50%,-50%)",width:60+speed*28,height:60+speed*28,borderRadius:"50%",background:`radial-gradient(circle at 35% 35%, ${qColor}cc, ${qColor}44, transparent)`,boxShadow:`0 0 ${18+speed*55}px ${qColor}99, 0 0 ${50+speed*40}px ${qColor}22`,border:`1px solid ${qColor}55`,transition:"left 0.08s ease-out,top 0.08s ease-out,width 0.12s,height 0.12s,background 0.4s,box-shadow 0.08s",pointerEvents:"none",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:"#fff",opacity:0.9}} />
        </div>
      </div>
      <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"16px 20px 28px",background:"linear-gradient(transparent, #05050888 30%, #050508ee)",pointerEvents:"none"}}>
        <div style={{textAlign:"center",marginBottom:10}}>
          <span style={{fontSize:10,letterSpacing:"0.3em",textTransform:"uppercase",color:qColor,fontFamily:"monospace",transition:"color 0.3s"}}>{QUADRANT_NAMES[quadrant]}</span>
          <span style={{color:"#ffffff11",margin:"0 8px"}}>·</span>
          <span style={{fontSize:10,color:"#475569",fontFamily:"monospace"}}>{QUADRANT_DESC[quadrant]}</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
          {[{label:"FILTER",val:params.filter,color:"#f59e0b"},{label:"TEMPO",val:params.tempo,color:"#10b981"},{label:"REVERB",val:params.reverb,color:"#6366f1"},{label:"FORCE",val:params.force,color:"#ef4444"}].map(({label,val,color})=>(
            <div key={label} style={{textAlign:"center"}}>
              <div style={{fontSize:8,color:"#475569",letterSpacing:"0.15em",marginBottom:4,fontFamily:"monospace"}}>{label}</div>
              <div style={{height:3,background:"#1e293b",borderRadius:2}}>
                <div style={{height:"100%",width:`${val}%`,background:color,borderRadius:2,transition:"width 0.1s ease-out,background 0.3s"}} />
              </div>
              <div style={{fontSize:9,color:color,marginTop:3,fontFamily:"monospace"}}>{val}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{position:"absolute",top:16,left:0,right:0,textAlign:"center",pointerEvents:"none"}}>
        <span style={{fontSize:9,letterSpacing:"0.25em",color:"#1e293b",textTransform:"uppercase",fontFamily:"monospace"}}>
          {inputMode==="motion"?"move your phone":"drag to conduct"}
        </span>
      </div>
      <button onClick={()=>{const next=inputMode==="motion"?"touch":"motion";setInputMode(next);if(next==="motion")attachMotionListeners();}}
        style={{position:"absolute",top:12,right:16,background:"transparent",border:"1px solid #1e293b",color:"#475569",fontSize:9,padding:"5px 10px",borderRadius:2,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"monospace",cursor:"pointer"}}>
        {inputMode==="motion"?"touch":"motion"}
      </button>
    </div>
  );
}
