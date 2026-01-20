import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BitVisualizer, States } from './BitVisualizer.js';
import { HoverLabelManager } from './HoverLabelManager.js';

export class SessionGrid {
  constructor(canvas) {
    this.canvas = canvas;
    this.sessions = new Map(); // session_id -> { bit, subagents: Map }
    this.spacing = 4;
    this.scheduler = null; // Set by main.js after construction

    this.initScene();
    this.initPostProcessing();
    this.initBackground();

    // Initialize hover label manager
    this.hoverLabelManager = new HoverLabelManager(this.canvas, this.camera);

    this.clock = new THREE.Clock();

    // Camera smoothing
    this.targetCameraZ = 6;
    this.cameraLerpSpeed = 2.0;

    // Handle resize
    window.addEventListener('resize', () => this.onResize());
  }

  /**
   * Set the event scheduler reference for cleanup coordination
   */
  setScheduler(scheduler) {
    this.scheduler = scheduler;
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
  }

  initPostProcessing() {
    const rect = this.canvas.getBoundingClientRect();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(rect.width, rect.height),
      1.5,  // strength
      0.4,  // radius
      0.85  // threshold
    );
    this.composer.addPass(this.bloomPass);
  }

  initBackground() {
    // Grid helper
    const gridHelper = new THREE.GridHelper(30, 60, 0x004466, 0x002233);
    gridHelper.position.y = -3;
    this.scene.add(gridHelper);

    // Ambient particles
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
      return this.sessions.get(sessionId);
    }

    const isSubagent = parentId !== null;
    const bit = new BitVisualizer(sessionId, isSubagent);

    if (isSubagent && this.sessions.has(parentId)) {
      // Add as subagent to parent
      const parent = this.sessions.get(parentId);
      parent.subagents.set(sessionId, bit);
      parent.bit.group.add(bit.group);

      // Position in orbit around parent
      this.updateSubagentPositions(parentId);
    } else {
      // Add as root session
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
    // Notify scheduler to clear any pending events for this session
    if (this.scheduler) {
      this.scheduler.clearSession(sessionId);
    }

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
      // Remove all subagents and their pending events
      for (const [subId, subBit] of session.subagents) {
        if (this.scheduler) {
          this.scheduler.clearSession(subId);
        }
        subBit.dispose();
      }
      session.subagents.clear();

      this.scene.remove(session.bit.group);
      session.bit.dispose();
      this.sessions.delete(sessionId);
      this.updateGridLayout();
    }
  }

  getSession(sessionId) {
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

    // Arrange all bits in a horizontal line (same z position)
    let i = 0;
    for (const session of this.sessions.values()) {
      const x = (i - (count - 1) / 2) * this.spacing;

      session.bit.group.position.x = x;
      session.bit.group.position.z = 0;
      session.bit.group.userData.baseY = 0;

      i++;
    }

    // Adjust camera distance based on session count
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
      bit.group.position.x = Math.cos(angle) * orbitRadius;
      bit.group.position.z = Math.sin(angle) * orbitRadius;
      bit.group.position.y = 0.5; // Slightly above parent
      bit.group.userData.baseY = 0.5;
    });
  }

  handleEvent(eventData) {
    const { session_id, type, state, event } = eventData;

    let bit = this.getSession(session_id);

    switch (type) {
      case 'create':
        const parentId = event?.parent_session_id || null;
        bit = this.createSession(session_id, parentId);
        bit.setState(state);
        bit.setEventData(eventData);
        break;

      case 'state':
        if (bit) {
          bit.setState(state, eventData.autoRevert, eventData.revertDelay);
          bit.setEventData(eventData);
          // Clear dimming if undim flag is set (activity resumed)
          if (eventData.undim) {
            bit.setDimmed(false);
          }
        }
        break;

      case 'pulse':
        if (bit) {
          bit.pulse();
          bit.setEventData(eventData);
        }
        break;

      case 'tool_start':
        if (bit) {
          bit.addToolBit(eventData.tool_use_id, eventData.tool_name);
          bit.pulse();
          bit.setEventData(eventData);
        }
        break;

      case 'tool_end':
        if (bit) {
          bit.removeToolBit(eventData.tool_use_id);
          bit.setEventData(eventData);
          // State is now managed by BitVisualizer based on tool count
        }
        break;

      case 'dim':
        if (bit) {
          bit.setDimmed(eventData.dimmed);
        }
        break;

      case 'end':
        if (bit) {
          bit.shatter();
          // Session will be removed after shatter animation
          setTimeout(() => this.removeSession(session_id), 2000);
        }
        break;
    }

    return bit;
  }

  initFromSessions(sessions) {
    // Clear existing
    for (const session of this.sessions.values()) {
      this.scene.remove(session.bit.group);
      session.bit.dispose();
    }
    this.sessions.clear();

    // Create from tree structure
    for (const session of sessions) {
      const bit = this.createSession(session.id);

      // Apply state from server
      if (session.state) {
        if (session.state !== 'neutral' && session.state !== 'ending') {
          bit.hasWorked = true;  // Assume worked if not neutral
        }
        if (session.state !== 'neutral') {
          bit.setState(session.state);
        }
      }

      // Apply dimmed state from server
      if (session.isDimmed) {
        bit.setDimmed(true);
      }

      // Restore active tools from server
      if (session.activeTools && session.activeTools.length > 0) {
        for (const tool of session.activeTools) {
          bit.addToolBit(tool.tool_use_id, tool.tool_name);
        }
      }

      if (session.subagents) {
        for (const subagent of session.subagents) {
          const subBit = this.createSession(subagent.id, session.id);
          if (subagent.state) {
            if (subagent.state !== 'neutral' && subagent.state !== 'ending') {
              subBit.hasWorked = true;
            }
            if (subagent.state !== 'neutral') {
              subBit.setState(subagent.state);
            }
          }
          // Apply dimmed state from server
          if (subagent.isDimmed) {
            subBit.setDimmed(true);
          }
          // Restore active tools from server
          if (subagent.activeTools && subagent.activeTools.length > 0) {
            for (const tool of subagent.activeTools) {
              subBit.addToolBit(tool.tool_use_id, tool.tool_name);
            }
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

    // Smoothly interpolate camera position
    const cameraDiff = this.targetCameraZ - this.camera.position.z;
    if (Math.abs(cameraDiff) > 0.01) {
      this.camera.position.z += cameraDiff * Math.min(1, delta * this.cameraLerpSpeed);
    }

    // Update all Bits
    for (const session of this.sessions.values()) {
      session.bit.update(delta, elapsed);

      // Update subagent orbits
      for (const subBit of session.subagents.values()) {
        subBit.update(delta, elapsed);
      }
    }

    // Slowly rotate particles
    if (this.particles) {
      this.particles.rotation.y += delta * 0.02;
    }

    // Update hover labels
    this.hoverLabelManager.update(this.sessions);

    // Render with post-processing
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
