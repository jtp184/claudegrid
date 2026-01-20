import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BitVisualizer, States } from './BitVisualizer.js';
import { HoverLabelManager } from './HoverLabelManager.js';

// Configuration constants
const CONFIG = {
  DEBOUNCE_THRESHOLD: 0.001,  // position lerp threshold
  SESSION_REMOVAL_DELAY: 2000, // ms after SessionEnd before removal
  POSITION_LERP_SPEED: 4.0,
  CAMERA_LERP_SPEED: 2.0,
};

export class SessionGrid {
  constructor(canvas) {
    this.canvas = canvas;
    this.sessions = new Map(); // session_id -> { bit, subagents: Map }
    this.spacing = 4;

    this.initScene();
    this.initPostProcessing();
    this.initBackground();

    this.hoverLabelManager = new HoverLabelManager(this.canvas, this.camera);

    this.clock = new THREE.Clock();

    // Camera smoothing
    this.targetCameraZ = 6;
    this.cameraLerpSpeed = CONFIG.CAMERA_LERP_SPEED;

    // Position smoothing for sessions
    this.positionLerpSpeed = CONFIG.POSITION_LERP_SPEED;

    window.addEventListener('resize', () => this.onResize());
  }

  initScene() {
    this.scene = new THREE.Scene();

    const rect = this.canvas.getBoundingClientRect();
    this.camera = new THREE.PerspectiveCamera(
      75,
      rect.width / rect.height,
      0.1,
      1000
    );
    this.camera.position.z = 6;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true
    });
    this.renderer.setSize(rect.width, rect.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ReinhardToneMapping;

    this.controls = new OrbitControls(this.camera, this.canvas);

    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };

    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.controls.enablePan = false;
    this.controls.enableZoom = true;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 50;

    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.minPolarAngle = Math.PI * 0.15;
  }

  initPostProcessing() {
    const rect = this.canvas.getBoundingClientRect();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(rect.width, rect.height),
      1.5,
      0.4,
      0.85
    );
    this.composer.addPass(this.bloomPass);
  }

  initBackground() {
    // Custom grid with fade-out gradient
    const gridSize = 100;
    const gridGeometry = new THREE.PlaneGeometry(gridSize, gridSize);
    gridGeometry.rotateX(-Math.PI / 2);

    const gridMaterial = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uColor1: { value: new THREE.Color(0x004466) },
        uColor2: { value: new THREE.Color(0x002233) },
        uGridSize: { value: gridSize },
        uLineWidth: { value: 0.02 },
        uFadeStart: { value: 0.3 },
        uFadeEnd: { value: 0.9 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        uniform float uGridSize;
        uniform float uLineWidth;
        uniform float uFadeStart;
        uniform float uFadeEnd;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          // Grid lines
          float cellSize = uGridSize / 60.0;
          vec2 grid = abs(fract(vWorldPos.xz / cellSize - 0.5) - 0.5) / fwidth(vWorldPos.xz / cellSize);
          float line = min(grid.x, grid.y);
          float gridLine = 1.0 - min(line, 1.0);

          // Major grid lines (every 5 cells)
          float majorCellSize = cellSize * 5.0;
          vec2 majorGrid = abs(fract(vWorldPos.xz / majorCellSize - 0.5) - 0.5) / fwidth(vWorldPos.xz / majorCellSize);
          float majorLine = min(majorGrid.x, majorGrid.y);
          float majorGridLine = 1.0 - min(majorLine, 1.0);

          // Distance-based fade
          float dist = length(vWorldPos.xz) / (uGridSize * 0.5);
          float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);

          // Combine colors
          vec3 color = mix(uColor2, uColor1, majorGridLine * 0.5 + gridLine * 0.3);
          float alpha = max(gridLine * 0.4, majorGridLine * 0.7) * fade;

          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const gridMesh = new THREE.Mesh(gridGeometry, gridMaterial);
    gridMesh.position.y = -3;
    this.scene.add(gridMesh);

    const particleCount = 150;
    const particlesGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePos[i] = (Math.random() - 0.5) * 30;
      particlePos[i + 1] = (Math.random() - 0.5) * 20;
      particlePos[i + 2] = (Math.random() - 0.5) * 30;
    }

    particlesGeo.setAttribute('position', new THREE.Float32BufferAttribute(particlePos, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x446688,
      size: 0.02,
      transparent: true,
      opacity: 0.6
    });
    this.particles = new THREE.Points(particlesGeo, particleMat);
    this.scene.add(this.particles);
  }

  createSession(sessionId, parentId = null) {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId).bit;
    }

    const isSubagent = parentId !== null;
    const bit = new BitVisualizer(sessionId, isSubagent);

    if (isSubagent && this.sessions.has(parentId)) {
      const parent = this.sessions.get(parentId);
      parent.subagents.set(sessionId, bit);
      parent.bit.group.add(bit.group);

      this.updateSubagentPositions(parentId);
    } else {
      this.sessions.set(sessionId, {
        bit,
        subagents: new Map()
      });
      this.scene.add(bit.group);
      this.updateGridLayout();
    }

    return bit;
  }

  removeSession(sessionId) {
    // Check if it's a subagent
    for (const [parentId, session] of this.sessions) {
      if (session.subagents.has(sessionId)) {
        const subBit = session.subagents.get(sessionId);
        session.bit.group.remove(subBit.group);
        subBit.dispose();
        session.subagents.delete(sessionId);
        this.updateSubagentPositions(parentId);
        return;
      }
    }

    // Remove root session
    const session = this.sessions.get(sessionId);
    if (session) {
      for (const [subId, subBit] of session.subagents) {
        subBit.dispose();
      }
      session.subagents.clear();

      this.scene.remove(session.bit.group);
      session.bit.dispose();
      this.sessions.delete(sessionId);
      this.updateGridLayout();
    }
  }

  getBit(sessionId) {
    // Check root sessions
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId).bit;
    }

    // Check subagents
    for (const session of this.sessions.values()) {
      if (session.subagents.has(sessionId)) {
        return session.subagents.get(sessionId);
      }
    }

    return null;
  }

  updateGridLayout() {
    const count = this.sessions.size;
    if (count === 0) return;

    let i = 0;
    for (const session of this.sessions.values()) {
      const x = (i - (count - 1) / 2) * this.spacing;

      // Set target positions for smooth lerping
      session.bit.group.userData.targetX = x;
      session.bit.group.userData.targetZ = 0;
      session.bit.group.userData.baseY = 0;

      // Initialize position immediately if not yet set (new session)
      if (session.bit.group.userData.positionInitialized !== true) {
        session.bit.group.position.x = x;
        session.bit.group.position.z = 0;
        session.bit.group.userData.positionInitialized = true;
      }

      i++;
    }

    const width = (count - 1) * this.spacing;
    this.targetCameraZ = Math.max(6, 4 + width * 0.5);
  }

  updateSubagentPositions(parentId) {
    const session = this.sessions.get(parentId);
    if (!session) return;

    const subagents = Array.from(session.subagents.values());
    const count = subagents.length;
    if (count === 0) return;

    const orbitRadius = 1.5;

    subagents.forEach((bit, i) => {
      const angle = (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * orbitRadius;
      const z = Math.sin(angle) * orbitRadius;

      // Set target positions for smooth lerping
      bit.group.userData.targetX = x;
      bit.group.userData.targetZ = z;
      bit.group.userData.baseY = 0.5;

      // Initialize position immediately if not yet set (new subagent)
      if (bit.group.userData.positionInitialized !== true) {
        bit.group.position.x = x;
        bit.group.position.z = z;
        bit.group.position.y = 0.5;
        bit.group.userData.positionInitialized = true;
      }
    });
  }

  lerpPosition(group, delta) {
    const userData = group.userData;
    if (userData.targetX === undefined || userData.targetZ === undefined) return;

    const lerpFactor = Math.min(1, delta * this.positionLerpSpeed);

    const dx = userData.targetX - group.position.x;
    const dz = userData.targetZ - group.position.z;

    // Only lerp if there's a significant difference
    if (Math.abs(dx) > CONFIG.DEBOUNCE_THRESHOLD) {
      group.position.x += dx * lerpFactor;
    } else {
      group.position.x = userData.targetX;
    }

    if (Math.abs(dz) > CONFIG.DEBOUNCE_THRESHOLD) {
      group.position.z += dz * lerpFactor;
    } else {
      group.position.z = userData.targetZ;
    }
  }

  /**
   * Handle incoming event - routes to appropriate bit
   */
  handleEvent(eventData) {
    const { session_id, hook_event_name, parent_session_id } = eventData;

    // Handle SessionEnd - shatter and schedule removal (only if bit exists)
    if (hook_event_name === 'SessionEnd') {
      const bit = this.getBit(session_id);
      if (bit) {
        bit.handleEvent(eventData);
        setTimeout(() => this.removeSession(session_id), CONFIG.SESSION_REMOVAL_DELAY);
      }
      return;
    }

    // Get or create the bit for any other event
    let bit = this.getBit(session_id);
    if (!bit) {
      bit = this.createSession(session_id, parent_session_id);
    }
    bit.handleEvent(eventData);
  }

  initFromSessions(sessions) {
    // Preserve existing sessions on reconnect - server is stateless and sends
    // empty init. A future enhancement could add explicit session expiry.
    if (sessions.length === 0 && this.sessions.size > 0) {
      return;
    }

    // Clear existing
    for (const session of this.sessions.values()) {
      this.scene.remove(session.bit.group);
      session.bit.dispose();
    }
    this.sessions.clear();

    // Create from tree structure (if server sends state)
    for (const session of sessions) {
      const bit = this.createSession(session.id);

      if (session.state && session.state !== 'neutral') {
        bit.hasWorked = true;
      }

      if (session.subagents) {
        for (const subagent of session.subagents) {
          const subBit = this.createSession(subagent.id, session.id);
          if (subagent.state && subagent.state !== 'neutral') {
            subBit.hasWorked = true;
          }
        }
      }
    }
  }

  getSessionCount() {
    let count = this.sessions.size;
    for (const session of this.sessions.values()) {
      count += session.subagents.size;
    }
    return count;
  }

  update() {
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    this.controls.update();

    // Auto-zoom based on session count
    const currentDistance = this.camera.position.distanceTo(this.controls.target);
    const distanceDiff = this.targetCameraZ - currentDistance;

    if (Math.abs(distanceDiff) > 0.01) {
      const direction = new THREE.Vector3()
        .subVectors(this.camera.position, this.controls.target)
        .normalize();
      const newDistance = currentDistance + distanceDiff * Math.min(1, delta * this.cameraLerpSpeed);
      this.camera.position.copy(this.controls.target).addScaledVector(direction, newDistance);
    }

    // Update all Bits
    for (const session of this.sessions.values()) {
      // Smooth position lerping for root sessions
      this.lerpPosition(session.bit.group, delta);
      session.bit.update(delta, elapsed);

      for (const subBit of session.subagents.values()) {
        // Smooth position lerping for subagents
        this.lerpPosition(subBit.group, delta);
        subBit.update(delta, elapsed);
      }
    }

    if (this.particles) {
      this.particles.rotation.y += delta * 0.02;
    }

    this.hoverLabelManager.update(this.sessions);

    this.composer.render();
  }

  onResize() {
    const rect = this.canvas.getBoundingClientRect();

    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(rect.width, rect.height);
    this.composer.setSize(rect.width, rect.height);
  }
}
