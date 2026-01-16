from flask import Flask, render_template, request, jsonify
import math

app = Flask(__name__)

class CCRSimulator:
    def __init__(self):
        # State
        self.depth_m = 10.0
        self.loop_volume = 6.0
        self.po2 = 1.0  # Normalized (0-1 approx, actually ATA)
        self.cells = [1.0, 1.0, 1.0]
        self.computer_sp = 1.2
        self.mode = 'manual' # manual, cmf, needle, solenoid, hybrid
        
        # Gas settings
        self.diluent_fo2 = 0.21
        self.diluent_fhe = 0.0
        self.metabolism = 1.0 # L/min O2 consumption
        
        # Injection settings
        self.cmf_rate = 0.8
        self.needle_base = 0.8
        self.needle_uncompensated = False
        
        # Solenoid
        self.solenoid_timer = 0
        self.solenoid_active = False
        
        # Status
        self.hypoxia = False
        self.hyperoxia = False
        self.dead = False
        
        # Inputs (Received from client)
        self.inputs = {
            'mav_o2': False,
            'mav_dil': False
        }

    def update(self, dt):
        # 1. Physics Constants
        depth_ata = 1.0 + self.depth_m / 10.0
        
        # 2. Consumption (Metabolism)
        o2_consumed = (self.metabolism / 60.0) * dt # Liters
        # Convert Liter consumption to PPO2 drop
        # PPO2 drop = (O2 consumed / Loop Volume) 
        # But Loop Volume is pressurized? Simplification: PPO2 change relates to fraction change * Pressure
        # Standard approximation: Drop in PPO2 per tick.
        # At 1 ATA and 6L Loop, consuming 1L O2 drops FO2 by ~0.16.
        # Formula: delta_ppo2 = - (metabolism_l_per_sec * dt) / loop_volume * P_atm? 
        # Let's use the simple model from JS:
        drop = (self.metabolism / 60.0 * dt) / self.loop_volume
        self.po2 -= drop

        # 3. Passive Diffusion / Mixing (Simplification)
        # Not implementing full gas mixing physics here for simplicity, focusing on injections.
        
        # 4. Injections
        
        # MAV O2
        if self.inputs.get('mav_o2'):
            # Inject O2: Adds pure O2 gas
            # Rise rate: 30 L/min -> 0.5 L/sec -> per tick
            rate = 30.0 / 60.0 * dt
            rise = rate / self.loop_volume
            self.po2 += rise

        # MAV Diluent
        if self.inputs.get('mav_dil'):
            # Diluent flush toward Diluent PPO2
            speed = 0.05 # Mixing speed
            target = self.diluent_fo2 * depth_ata
            self.po2 += (target - self.po2) * speed

        # CMF (Constant Mass Flow)
        if self.mode in ['cmf', 'hybrid']:
            # Adds O2 at fixed rate independent of depth (up to IP limit)
            rate = (self.cmf_rate / 60.0) * dt
            self.po2 += rate / self.loop_volume

        # Needle Valve
        if self.mode in ['needle']:
            flow = self.needle_base
            if self.needle_uncompensated:
                # Flow drops as ambient pressure rises (simplified)
                # IP fixed, Ambient rises -> drive pressure drops
                # IP ~ 10 bar. Delta = 10 - Ambient.
                ip = 10.0
                drive = max(0, ip - depth_ata)
                flow = self.needle_base * (drive / 9.0) # Normalized to surface logic
            
            rate = (flow / 60.0) * dt
            self.po2 += rate / self.loop_volume

        # Solenoid (eCCR)
        self.solenoid_active = False
        if self.mode in ['solenoid', 'hybrid']:
            # Check SP
            if self.po2 < self.computer_sp - 0.03: # Hysteresis
                # Fire logic
                if self.solenoid_timer <= 0:
                    self.solenoid_active = True
                    # Solenoid pulse (e.g. 0.2s duration adding small amount)
                    self.solenoid_timer = 0.2 # Fire for 0.2s
                
        if self.solenoid_timer > 0:
             self.solenoid_active = True
             self.solenoid_timer -= dt
             rate = (10.0 / 60.0) * dt # Solenoid flow ~10-15 L/min
             self.po2 += rate / self.loop_volume

        # 5. Physics Limits
        # Cannot exceed pure O2 at depth
        max_po2 = 1.0 * depth_ata
        self.po2 = min(self.po2, max_po2)
        # Cannot go below 0
        self.po2 = max(0.0, self.po2)

        # 6. Sensor Simulation
        import random
        self.cells = [
            max(0, self.po2 + random.uniform(-0.02, 0.02)),
            max(0, self.po2 + random.uniform(-0.02, 0.02)),
            max(0, self.po2 + random.uniform(-0.02, 0.02))
        ]
        
        # 7. Safety Status
        self.hypoxia = self.po2 < 0.16
        self.hyperoxia = self.po2 > 2.0 # Convulsion limit
        if self.hypoxia or self.hyperoxia:
            self.dead = True
        else:
            self.dead = False

    def to_dict(self):
        return {
            'po2': self.po2,
            'cells': self.cells,
            'depth': self.depth_m,
            'sp': self.computer_sp,
            'solenoid_active': self.solenoid_active,
            'hypoxia': self.hypoxia,
            'hyperoxia': self.hyperoxia,
            'dead': self.dead,
            'end': (self.depth_m + 10) * (1 - self.diluent_fhe) - 10,
            'mod': 1.4 / self.diluent_fo2 * 10 - 10
        }

sim = CCRSimulator()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/tick', methods=['POST'])
def tick():
    data = request.json
    dt = data.get('dt', 0.016) # Default 60Hz-ish
    inputs = data.get('inputs', {})
    
    # Update Simulator State
    sim.inputs = inputs
    if 'set_depth' in inputs:
        sim.depth_m = float(inputs['set_depth'])
    if 'set_sp' in inputs:
        sim.computer_sp = float(inputs['set_sp'])
    if 'set_mode' in inputs:
        sim.mode = inputs['set_mode']
    if 'set_vo2' in inputs:
        sim.metabolism = float(inputs['set_vo2'])
    if 'set_dil' in inputs:
        sim.diluent_fo2 = float(inputs['set_dil']['fo2'])
        sim.diluent_fhe = float(inputs['set_dil']['fhe'])
    if 'set_cmf' in inputs:
        sim.cmf_rate = float(inputs['set_cmf'])
    if 'set_needle' in inputs:
        sim.needle_base = float(inputs['set_needle'])
    if 'set_uncomp' in inputs:
        sim.needle_uncompensated = inputs['set_uncomp']
        
    sim.update(dt)
    
    return jsonify(sim.to_dict())

@app.route('/api/reset', methods=['POST'])
def reset():
    global sim
    sim = CCRSimulator()
    return jsonify({'status': 'reset'})

if __name__ == '__main__':
    print("CCR Simulator Backend Running...")
    app.run(host='0.0.0.0', port=5000, debug=True)
