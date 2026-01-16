// Client-Side Logic for CCR Simulator (Flask Edition)

/**
 * Audio Manager - Handles all Web Audio API synthesis
 * (Direct port from original v12.3)
 */
const audioManager = {
    ctx: null, masterGain: null, oceanGain: null, hissGain: null, dpvGain: null, noiseBuffer: null,

    init() {
        if (this.ctx) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.8;
        this.masterGain.connect(this.ctx.destination);

        // Generate Noise Buffer
        const bufferSize = this.ctx.sampleRate * 2;
        this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856; b4 = 0.55000 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.0168980;
            data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362; data[i] *= 0.11; b6 = white * 0.115926;
        }

        this.createOcean();
        this.createHiss();
        this.createDPV();
    },

    toggle(on) {
        if (on) this.init();
        if (this.ctx) this.ctx.resume();
        this.masterGain.gain.setTargetAtTime(on ? document.getElementById('audio-volume').value : 0, this.ctx.currentTime, 0.1);
    },

    setVolume(v) { if (this.masterGain) this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); },

    createOcean() {
        const noise = this.ctx.createBufferSource(); noise.buffer = this.noiseBuffer; noise.loop = true;
        this.oceanGain = this.ctx.createGain(); this.oceanGain.gain.value = 0.2;
        const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 350;
        noise.connect(filter); filter.connect(this.oceanGain); this.oceanGain.connect(this.masterGain); noise.start();
    },

    playClick() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
        osc.type = 'square'; osc.frequency.setValueAtTime(1800, now); osc.frequency.exponentialRampToValueAtTime(100, now + 0.01);
        g.gain.setValueAtTime(0.3, now); g.gain.exponentialRampToValueAtTime(0.01, now + 0.01);
        osc.connect(g); g.connect(this.masterGain); osc.start(now); osc.stop(now + 0.015);
    },

    createHiss() {
        const noise = this.ctx.createBufferSource(); noise.buffer = this.noiseBuffer; noise.loop = true;
        this.hissGain = this.ctx.createGain(); this.hissGain.gain.value = 0;
        const filter = this.ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1000; filter.Q.value = 1.0;
        noise.connect(filter); filter.connect(this.hissGain); this.hissGain.connect(this.masterGain); noise.start();
    },
    setHiss(on) { if (this.hissGain) this.hissGain.gain.setTargetAtTime(on ? 0.2 : 0, this.ctx.currentTime, 0.1); },

    // --- Seacraft Magnetic Drive Sound Simulation ---
    createDPV() {
        this.dpvGain = this.ctx.createGain();
        this.dpvGain.gain.value = 0;

        // 1. Magnetic Motor Whine - 400Hz triangle wave
        this.dpvOsc = this.ctx.createOscillator(); this.dpvOsc.type = 'triangle'; this.dpvOsc.frequency.value = 400;
        const motorVol = this.ctx.createGain(); motorVol.gain.value = 0.05;
        const motorFilter = this.ctx.createBiquadFilter(); motorFilter.type = 'lowpass'; motorFilter.frequency.value = 1200;
        this.dpvOsc.connect(motorFilter); motorFilter.connect(motorVol); motorVol.connect(this.dpvGain);

        // 2. Inverter Harmonics - 2500Hz sine wave
        const inverterOsc = this.ctx.createOscillator(); inverterOsc.type = 'sine'; inverterOsc.frequency.value = 2500;
        const inverterVol = this.ctx.createGain(); inverterVol.gain.value = 0.01;
        inverterOsc.connect(inverterVol); inverterVol.connect(this.dpvGain);

        // 3. Prop Wash - 800Hz bandpass noise
        const waterNoise = this.ctx.createBufferSource(); waterNoise.buffer = this.noiseBuffer; waterNoise.loop = true;
        const waterFilter = this.ctx.createBiquadFilter(); waterFilter.type = 'bandpass'; waterFilter.frequency.value = 800; waterFilter.Q.value = 0.5;
        const waterVol = this.ctx.createGain(); waterVol.gain.value = 0.15;
        waterNoise.connect(waterFilter); waterFilter.connect(waterVol); waterVol.connect(this.dpvGain);

        this.dpvGain.connect(this.masterGain);
        this.dpvOsc.start(); inverterOsc.start(); waterNoise.start();
        this.dpvMotorRef = this.dpvOsc;
    },

    setDPV(on) {
        if (!this.dpvGain) return;
        const now = this.ctx.currentTime;
        if (on) {
            this.dpvGain.gain.cancelScheduledValues(now); this.dpvGain.gain.setValueAtTime(0, now); this.dpvGain.gain.linearRampToValueAtTime(0.3, now + 0.2);
            if (this.dpvMotorRef) { this.dpvMotorRef.frequency.cancelScheduledValues(now); this.dpvMotorRef.frequency.setValueAtTime(200, now); this.dpvMotorRef.frequency.exponentialRampToValueAtTime(400, now + 0.3); }
        } else {
            this.dpvGain.gain.cancelScheduledValues(now); this.dpvGain.gain.setTargetAtTime(0, now, 0.1);
            if (this.dpvMotorRef) { this.dpvMotorRef.frequency.cancelScheduledValues(now); this.dpvMotorRef.frequency.setTargetAtTime(100, now, 0.2); }
        }
    },

    // --- Advanced Breathing Simulation ---
    breathGain: null, breathFilter: null, breathOsc: null,
    breathTimer: null, isBreathing: false, breathState: 'inhale',

    createBreath() {
        if (this.breathGain) return;
        this.breathGain = this.ctx.createGain(); this.breathGain.gain.value = 0; this.breathGain.connect(this.masterGain);
        const noise = this.ctx.createBufferSource(); noise.buffer = this.noiseBuffer; noise.loop = true;

        this.breathFilter = this.ctx.createBiquadFilter();
        const formant = this.ctx.createBiquadFilter(); formant.type = 'peaking'; formant.frequency.value = 1200; formant.Q.value = 0.5; formant.gain.value = 2;
        const lowCut = this.ctx.createBiquadFilter(); lowCut.type = 'highpass'; lowCut.frequency.value = 100;

        noise.connect(lowCut); lowCut.connect(this.breathFilter); this.breathFilter.connect(formant); formant.connect(this.breathGain);
        noise.start();
    },

    playValveClick() {
        // Simulates the "Crack" of the demand valve opening
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator(); const g = this.ctx.createGain();
        osc.frequency.setValueAtTime(800, t); osc.frequency.exponentialRampToValueAtTime(100, t + 0.05);
        g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
        osc.connect(g); g.connect(this.masterGain);
        osc.start(t); osc.stop(t + 0.06);
    },

    setBreath(on) {
        if (on) {
            this.createBreath(); this.isBreathing = true; this.breathState = 'inhale'; this.breathLoop();
        } else {
            this.isBreathing = false;
            if (this.breathTimer) clearTimeout(this.breathTimer);
            if (this.breathGain) this.breathGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
        }
    },

    breathLoop() {
        if (!this.isBreathing || !this.ctx) return;
        const now = this.ctx.currentTime;
        if (this.breathState === 'inhale') {
            this.playValveClick();
            this.breathFilter.type = 'lowpass'; this.breathFilter.Q.value = 0.5;
            this.breathFilter.frequency.cancelScheduledValues(now); this.breathFilter.frequency.setValueAtTime(200, now); this.breathFilter.frequency.exponentialRampToValueAtTime(1500, now + 1.2);
            this.breathGain.gain.cancelScheduledValues(now); this.breathGain.gain.setValueAtTime(0, now); this.breathGain.gain.linearRampToValueAtTime(0.2, now + 0.1); this.breathGain.gain.linearRampToValueAtTime(0.15, now + 1.2); this.breathGain.gain.linearRampToValueAtTime(0, now + 1.6);
            this.breathState = 'exhale'; this.breathTimer = setTimeout(() => this.breathLoop(), 2000);
        } else {
            this.breathFilter.type = 'lowpass'; this.breathFilter.Q.value = 0.5;
            this.breathFilter.frequency.cancelScheduledValues(now); this.breathFilter.frequency.setValueAtTime(600, now);
            this.breathGain.gain.cancelScheduledValues(now); this.breathGain.gain.setValueAtTime(0, now); this.breathGain.gain.linearRampToValueAtTime(0.25, now + 0.1);
            const duration = 2.0; const steps = 10;
            for (let i = 0; i < steps; i++) {
                let t = now + 0.1 + (i / steps) * duration;
                let val = 0.15 + Math.random() * 0.2;
                this.breathGain.gain.linearRampToValueAtTime(val, t);
            }
            this.breathGain.gain.linearRampToValueAtTime(0, now + 2.5);
            this.breathState = 'inhale'; this.breathTimer = setTimeout(() => this.breathLoop(), 3000);
        }
    }
};

// --- Input State ---
const inputs = {
    mav_o2: false,
    mav_dil: false,
    // Other settings synchronized on change
};

// --- UI Logic ---
const history = []; const maxHistory = 400;

function updateUI(data) {
    if (!data) return;

    // Update Text Values
    document.getElementById('disp-po2').innerText = data.po2.toFixed(2);
    document.getElementById('cell-1').innerText = data.cells[0].toFixed(2);
    document.getElementById('cell-2').innerText = data.cells[1].toFixed(2);
    document.getElementById('cell-3').innerText = data.cells[2].toFixed(2);
    document.getElementById('disp-setpoint').innerText = data.sp.toFixed(2);
    document.getElementById('disp-depth').innerText = data.depth + "m";
    document.getElementById('disp-end').innerText = data.end.toFixed(0) + "m";
    document.getElementById('disp-mod').innerText = "MOD (1.4): ~ " + data.mod.toFixed(0) + " m";

    // Alarms / Colors
    applyDcColor(document.getElementById('disp-po2'), data.po2);
    applyDcColor(document.getElementById('cell-1'), data.cells[0]);
    applyDcColor(document.getElementById('cell-2'), data.cells[1]);
    applyDcColor(document.getElementById('cell-3'), data.cells[2]);

    // Depth Alarm
    const depthEl = document.getElementById('disp-depth');
    if (data.mod < data.depth) depthEl.classList.add('val-alarm-red');
    else depthEl.classList.remove('val-alarm-red');

    // Diver Visual & Audio Linkage
    const visual = document.getElementById('diver-visual');
    const panel = document.getElementById('hud-alert-panel');
    const title = document.getElementById('alert-title');
    const list = document.getElementById('alert-list');

    if (data.dead) {
        // Hypoxia or Hyperoxia
        const breathToggle = document.getElementById('breath-toggle');

        if (data.hyperoxia) {
            visual.className = 'diver-visual-wrapper state-hyperoxia';
            panel.className = 'hud-screen hud-right status-high';
            title.innerText = "CNS TOXICITY"; title.style.color = "var(--danger-high)";
            list.innerHTML = "<li>Twitching (Face/Lips)</li><li>Visual/Ear Disturbance</li><li style='color:#ff5555; font-weight:bold;'>CONVULSIONS (DEATH)</li>";

            // Audio Cut
            if (breathToggle && breathToggle.checked) {
                breathToggle.checked = false;
                audioManager.setBreath(false);
            }
        } else if (data.hypoxia) {
            visual.className = 'diver-visual-wrapper state-hypoxia';
            panel.className = 'hud-screen hud-right status-low';
            title.innerText = "HYPOXIA"; title.style.color = "var(--danger-low)";
            list.innerHTML = "<li>Confusion / Euphoria</li><li>Loss of Coordination</li><li style='color:#e0aaff; font-weight:bold;'>BLACKOUT (DEATH)</li>";

            // Audio Cut
            if (breathToggle && breathToggle.checked) {
                breathToggle.checked = false;
                audioManager.setBreath(false);
            }
        }
    } else if (data.end > 40) {
        visual.className = 'diver-visual-wrapper state-narcosis';
        panel.className = 'hud-screen hud-right status-narc';
        title.innerText = "NARCOSIS"; title.style.color = "var(--danger-narc)";
        list.innerHTML = "<li>Slowed Reaction</li><li>Impaired Judgment</li><li style='color:#ff88ff'>Stupor / Anesthesia</li>";
    } else {
        visual.className = 'diver-visual-wrapper';
        panel.className = 'hud-screen hud-right status-ok';
        title.innerText = "STATUS: OK"; title.style.color = "var(--accent-green)";
        list.innerHTML = "<li>Life Support Normal</li>";
    }

    // Solenoid Visual
    const solBox = document.getElementById('vis-solenoid');
    if (data.solenoid_active) solBox.classList.add('active-injection');
    else solBox.classList.remove('active-injection');

    // Chart
    history.push(data.po2);
    if (history.length > maxHistory) history.shift();
    drawChart(data);
}

function applyDcColor(el, val) {
    el.classList.remove('val-alarm-red', 'val-alarm-purple');
    if (val > 1.60 || (val < 0.40 && val > 0.01)) el.classList.add('val-alarm-red');
    else if (val <= 0.16) el.classList.add('val-alarm-purple');
}

// --- Chart Draw ---
const ctx = document.getElementById('chartCanvas').getContext('2d');
function drawChart(data) {
    const w = ctx.canvas.width = ctx.canvas.clientWidth, h = ctx.canvas.height = ctx.canvas.clientHeight;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.font = '10px Segoe UI'; ctx.fillStyle = '#eee'; ctx.textAlign = 'right';
    [1.8, 1.6, 1.4, 1.2, 1.0, 0.8, 0.6, 0.4, 0.2].forEach(v => {
        let y = h - (v / 2.0) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillText(v.toFixed(1), w - 5, y + 3);
    });
    ctx.fillStyle = 'rgba(255,0,0,0.15)'; ctx.fillRect(0, 0, w, h - (1.6 / 2.0) * h);
    ctx.fillStyle = 'rgba(150,0,255,0.15)'; ctx.fillRect(0, h - (0.16 / 2.0) * h, w, (0.16 / 2.0) * h);

    // Target SP line
    const spY = h - (data.sp / 2.0) * h;
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 4]); ctx.beginPath(); ctx.moveTo(0, spY); ctx.lineTo(w, spY); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#00e5ff'; ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'left';
    ctx.fillText(" [ TARGET SP: " + data.sp.toFixed(2) + " ]", 10, spY - 6);

    // History
    if (history.length > 1) {
        ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = '#00ff41';
        history.forEach((v, i) => {
            let x = (i / maxHistory) * w, y = h - (v / 2.0) * h;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
}

// --- Interaction (Sending synced state to server) ---
function sendUpdate(key, value) {
    const payload = { inputs: {} };
    payload.inputs[key] = value;

    // Fire and forget (or queue), loop will sync state anyway.
    // For sliders, we want immediate update.
    fetch('/api/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

// --- MAV Visuals ---
function startInject(gas) {
    if (gas === 'o2') {
        document.getElementById('vis-mav-o2').classList.add('active-injection');
        document.getElementById('btn-mav-o2').classList.add('active-key');
        audioManager.setHiss(true);
        inputs.mav_o2 = true;
    } else {
        document.getElementById('vis-mav-dil').classList.add('active-injection');
        document.getElementById('btn-mav-dil').classList.add('active-key');
        audioManager.setHiss(true);
        inputs.mav_dil = true;
    }
}

function stopInject() {
    document.getElementById('vis-mav-o2').classList.remove('active-injection');
    document.getElementById('btn-mav-o2').classList.remove('active-key');
    document.getElementById('vis-mav-dil').classList.remove('active-injection');
    document.getElementById('btn-mav-dil').classList.remove('active-key');
    audioManager.setHiss(false);
    inputs.mav_o2 = false;
    inputs.mav_dil = false;
}

// --- Button Listeners ---
window.setDiluent = (name, fo2, fhe) => {
    document.querySelectorAll('.btn-dil').forEach(b => b.classList.remove('active-dil'));
    event.target.classList.add('active-dil');
    sendUpdate('set_dil', { fo2, fhe });
};
window.setVO2 = (val) => {
    document.querySelectorAll('.btn-vo2').forEach(b => b.classList.remove('active-vo2'));
    event.target.classList.add('active-vo2');
    sendUpdate('set_vo2', val);
};
window.setMode = (mode) => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    sendUpdate('set_mode', mode);
};
window.setComputerSP = (val) => {
    document.querySelectorAll('.btn-sp').forEach(b => b.classList.remove('active-sp'));
    event.target.classList.add('active-sp');
    sendUpdate('set_sp', val);
};
window.setCMF = (val) => {
    document.querySelectorAll('.btn-cmf').forEach(b => b.classList.remove('active-cmf'));
    event.target.classList.add('active-cmf');
    sendUpdate('set_cmf', val);
};

// --- Sliders ---
document.getElementById('slider-depth').oninput = function () {
    document.getElementById('val-depth-display').innerText = this.value;
    sendUpdate('set_depth', this.value);
};
document.getElementById('slider-sp').oninput = function () {
    document.getElementById('val-sp-display').innerText = this.value;
    sendUpdate('set_sp', this.value);
};
document.getElementById('slider-needle').oninput = function () {
    document.getElementById('disp-needle-val').innerText = this.value + " L/m";
    sendUpdate('set_needle', this.value);
};
document.getElementById('chk-uncomp').onchange = function () {
    sendUpdate('set_uncomp', this.checked);
};

// --- Audio Controls ---
document.getElementById('audio-toggle').onchange = function () { audioManager.toggle(this.checked); };
document.getElementById('audio-volume').oninput = function () { audioManager.setVolume(this.value); };
document.getElementById('dpv-toggle').onchange = function () { audioManager.setDPV(this.checked); };
document.getElementById('breath-toggle').onchange = function () { audioManager.setBreath(this.checked); };

// --- Main Loop (Sync with Backend) ---
function loop() {
    // Send current inputs (buttons held down)
    const payload = {
        inputs: inputs,
        dt: 0.05 // 20Hz request rate
    };

    fetch('/api/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(res => res.json())
        .then(data => {
            updateUI(data);
        })
        .catch(err => console.error(err));
}

// Start Interval (20 requests per second)
setInterval(loop, 50);

// Init
window.onload = function () {
    // Show Toast
    const lastMod = new Date().toLocaleString();
    const toast = document.createElement('div');
    toast.style.cssText = "position:fixed; bottom:20px; right:20px; background:rgba(0,40,0,0.9); border:1px solid #0f0; color:#fff; padding:10px 20px; border-radius:4px; font-family:monospace; font-size:12px; z-index:9999; box-shadow:0 0 10px #0f0; opacity:0; transition:opacity 0.5s;";
    toast.innerText = "CONNECTED TO FLASK CORE\nAlgorithm Secure: ON";
    document.body.appendChild(toast);
    setTimeout(() => toast.style.opacity = '1', 100);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => document.body.removeChild(toast), 500); }, 5000);
};
