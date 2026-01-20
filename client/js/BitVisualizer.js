import * as THREE from 'three';

// Visual states
export const States = {
  NEUTRAL: 'neutral',
  THINKING: 'thinking',
  YES: 'yes',
  NO: 'no',
  ENDING: 'ending'
};

// Colors for each state
const StateColors = {
  neutral: new THREE.Color(0x44ddff),   // Cyan
  thinking: new THREE.Color(0x44ddff),  // Cyan (fast rotation)
  yes: new THREE.Color(0xffdd44),       // Yellow
  no: new THREE.Color(0xff4422),        // Orange
  ending: new THREE.Color(0x44ddff)     // Cyan (shatter)
};

// Rotation speeds
const RotationSpeeds = {
  neutral: 0.5,
  thinking: 3.0,
  yes: 1.0,
  no: 1.0,
  ending: 0.5
};

// Multiplier for rotation after session has done work
const WORKED_ROTATION_MULTIPLIER = 2.0;

// Shader for Tron glow effect
const bitVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const bitFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uDim;

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, 2.0);

    float pulse = 0.8 + 0.2 * sin(uTime * 3.0);

    // Apply dimming - reduce brightness and pulse when dimmed
    float dimFactor = 1.0 - uDim * 0.7;
    float dimmedPulse = mix(pulse, 0.9, uDim);

    vec3 color = uColor * (0.5 + fresnel * 1.5) * dimmedPulse * dimFactor;
    float alpha = (uOpacity + fresnel * 0.7) * dimFactor;

    gl_FragColor = vec4(color, alpha);
  }
`;

const edgeVertexShader = `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const edgeFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uDim;

  void main() {
    float pulse = 0.9 + 0.1 * sin(uTime * 4.0);
    // Apply dimming to edges
    float dimFactor = 1.0 - uDim * 0.7;
    float dimmedPulse = mix(pulse, 0.95, uDim);
    gl_FragColor = vec4(uColor * 2.0 * dimmedPulse * dimFactor, 1.0);
  }
`;

// Geometry cache
const geometryCache = {};

function createStarburstGeometry(radius) {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const indices = [];

  const innerGeo = new THREE.IcosahedronGeometry(radius * 0.5, 0).toNonIndexed();
  const innerPos = innerGeo.attributes.position.array;

  const uniqueVerts = [];
  const vertexMap = new Map();
  const faceIndices = [];

  for (let i = 0; i < innerPos.length; i += 3) {
    const key = `${innerPos[i].toFixed(6)},${innerPos[i+1].toFixed(6)},${innerPos[i+2].toFixed(6)}`;
    if (!vertexMap.has(key)) {
      vertexMap.set(key, uniqueVerts.length / 3);
      uniqueVerts.push(innerPos[i], innerPos[i+1], innerPos[i+2]);
    }
    faceIndices.push(vertexMap.get(key));
  }

  for (let i = 0; i < uniqueVerts.length; i++) {
    vertices.push(uniqueVerts[i]);
  }

  for (let i = 0; i < faceIndices.length; i += 3) {
    const i0 = faceIndices[i];
    const i1 = faceIndices[i + 1];
    const i2 = faceIndices[i + 2];

    const cx = (uniqueVerts[i0*3] + uniqueVerts[i1*3] + uniqueVerts[i2*3]) / 3;
    const cy = (uniqueVerts[i0*3+1] + uniqueVerts[i1*3+1] + uniqueVerts[i2*3+1]) / 3;
    const cz = (uniqueVerts[i0*3+2] + uniqueVerts[i1*3+2] + uniqueVerts[i2*3+2]) / 3;

    const len = Math.sqrt(cx*cx + cy*cy + cz*cz);
    const spikeLen = radius * 1.85;
    const sx = cx / len * spikeLen;
    const sy = cy / len * spikeLen;
    const sz = cz / len * spikeLen;

    const spikeIdx = vertices.length / 3;
    vertices.push(sx, sy, sz);

    indices.push(i0, i1, spikeIdx);
    indices.push(i1, i2, spikeIdx);
    indices.push(i2, i0, spikeIdx);
  }

  for (let i = 0; i < faceIndices.length; i++) {
    indices.push(faceIndices[i]);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

function getGeometry(state) {
  // Map thinking to neutral geometry
  const geoState = state === States.THINKING ? States.NEUTRAL : state;

  if (geometryCache[geoState]) {
    return geometryCache[geoState];
  }

  let geometry;
  switch (geoState) {
    case States.NEUTRAL:
      geometry = new THREE.IcosahedronGeometry(1, 0);
      break;
    case States.YES:
      geometry = new THREE.OctahedronGeometry(1.2, 0);
      break;
    case States.NO:
      geometry = createStarburstGeometry(1);
      break;
    default:
      geometry = new THREE.IcosahedronGeometry(1, 0);
  }

  geometryCache[geoState] = geometry;
  return geometry;
}

// Tool bit color (white)
const ToolBitColor = new THREE.Color(0xffffff);

// Simple shader for tool bits
const toolBitVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const toolBitFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, 2.0);

    float pulse = 0.9 + 0.1 * sin(uTime * 5.0);

    vec3 color = uColor * (0.6 + fresnel * 1.2) * pulse;
    float alpha = uOpacity * (0.8 + fresnel * 0.5);

    gl_FragColor = vec4(color, alpha);
  }
`;

class ToolBit {
  constructor(toolUseId, toolName, orbitIndex = 0, totalTools = 1) {
    this.toolUseId = toolUseId;
    this.toolName = toolName;
    this.orbitIndex = orbitIndex;
    this.totalTools = totalTools;

    this.scale = 0.2;

    // Each bit gets a unique orbital configuration based on its index
    // Use a seeded pseudo-random based on toolUseId for consistency
    const seed = this.hashCode(toolUseId);
    const rand = (offset) => {
      const x = Math.sin(seed + offset) * 10000;
      return x - Math.floor(x);
    };

    // Vary orbit parameters for each bit
    this.orbitRadius = 1.2 + rand(1) * 0.4;        // 1.2 to 1.6
    this.orbitSpeed = 1.5 + rand(2) * 1.0;         // 1.5 to 2.5 rad/sec
    this.orbitAngle = rand(3) * Math.PI * 2;       // Random starting angle

    // Orbital inclination - tilt the orbit plane
    this.orbitInclination = (rand(4) - 0.5) * Math.PI * 0.6;  // -54° to +54° tilt
    this.orbitAscendingNode = rand(5) * Math.PI * 2;          // Random orientation of tilt

    // Animation state
    this.currentScale = 0;
    this.targetScale = this.scale;
    this.opacity = 1;
    this.isDespawning = false;
    this.isFinished = false;

    this.group = new THREE.Group();
    this.createMesh();
  }

  createMesh() {
    const geometry = new THREE.IcosahedronGeometry(1, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: ToolBitColor.clone() },
        uTime: { value: 0 },
        uOpacity: { value: 1 }
      },
      vertexShader: toolBitVertexShader,
      fragmentShader: toolBitFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.group.add(this.mesh);

    // Add edges
    const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
    this.edgeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: ToolBitColor.clone() },
        uTime: { value: 0 },
        uOpacity: { value: 1 }
      },
      vertexShader: `
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uOpacity;

        void main() {
          float pulse = 0.9 + 0.1 * sin(uTime * 6.0);
          gl_FragColor = vec4(uColor * 2.0 * pulse, uOpacity);
        }
      `,
      transparent: true
    });

    this.edges = new THREE.LineSegments(edgesGeo, this.edgeMaterial);
    this.group.add(this.edges);

    // Initial scale
    this.group.scale.setScalar(0.01);
  }

  // Simple hash function for consistent pseudo-random values
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  updateOrbitPosition(orbitIndex, totalTools) {
    this.orbitIndex = orbitIndex;
    this.totalTools = totalTools;
  }

  startDespawn() {
    this.isDespawning = true;
    this.targetScale = 0;
  }

  update(delta, elapsed) {
    if (this.isFinished) return;

    // Update shader time
    this.material.uniforms.uTime.value = elapsed;
    this.edgeMaterial.uniforms.uTime.value = elapsed;

    // Animate scale
    const scaleDiff = this.targetScale - this.currentScale;
    if (Math.abs(scaleDiff) > 0.001) {
      this.currentScale += scaleDiff * Math.min(1, delta * 8);
    } else {
      this.currentScale = this.targetScale;
    }

    // Animate opacity during despawn
    if (this.isDespawning) {
      this.opacity -= delta * 4;
      if (this.opacity <= 0) {
        this.opacity = 0;
        this.isFinished = true;
      }
      this.material.uniforms.uOpacity.value = this.opacity;
      this.edgeMaterial.uniforms.uOpacity.value = this.opacity;
    }

    // Update orbit position
    this.orbitAngle += delta * this.orbitSpeed;

    // Calculate position on tilted orbital plane
    // Start with position in the flat orbital plane
    const flatX = Math.cos(this.orbitAngle) * this.orbitRadius;
    const flatZ = Math.sin(this.orbitAngle) * this.orbitRadius;

    // Apply orbital inclination (tilt around the X axis)
    const inclinedY = flatZ * Math.sin(this.orbitInclination);
    const inclinedZ = flatZ * Math.cos(this.orbitInclination);

    // Apply ascending node rotation (rotate the tilted plane around Y axis)
    const cosAN = Math.cos(this.orbitAscendingNode);
    const sinAN = Math.sin(this.orbitAscendingNode);
    this.group.position.x = flatX * cosAN - inclinedZ * sinAN;
    this.group.position.z = flatX * sinAN + inclinedZ * cosAN;
    this.group.position.y = inclinedY;

    // Apply scale
    this.group.scale.setScalar(Math.max(0.01, this.currentScale));

    // Spin on own axis
    this.group.rotation.y += delta * 3;
    this.group.rotation.x += delta * 2;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.edges.geometry.dispose();
    this.edgeMaterial.dispose();
  }
}

export class BitVisualizer {
  constructor(sessionId, isSubagent = false) {
    this.sessionId = sessionId;
    this.isSubagent = isSubagent;
    this.state = States.NEUTRAL;
    this.targetState = States.NEUTRAL;
    this.scale = isSubagent ? 0.4 : 1.0;

    // Track if session has done work (entered THINKING state)
    this.hasWorked = false;

    // Morphing state
    this.morphProgress = 1;
    this.morphSpeed = 3;
    this.sourceColor = null;
    this.targetColor = null;
    this.useScaleTransition = false;
    this.geometrySwapped = false;
    this.pendingGeometry = null;

    // Pulse effect
    this.pulseIntensity = 0;

    // Dimming state (for idle)
    this.isDimmed = false;
    this.currentDim = 0;
    this.targetDim = 0;
    this.dimSpeed = 2; // How fast to transition dim

    // Shatter particles
    this.shatterParticles = null;
    this.isShattered = false;

    // Auto-revert timer
    this.revertTimeout = null;

    // Event data for hover labels
    this.eventData = null;

    // Tool bits for active tool uses
    this.toolBits = new Map();

    this.group = new THREE.Group();
    this.group.scale.setScalar(this.scale);

    this.createBit();
  }

  createBit() {
    const geometry = getGeometry(States.NEUTRAL);

    // Main mesh material
    this.bitMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: StateColors.neutral.clone() },
        uTime: { value: 0 },
        uOpacity: { value: 0.3 },
        uDim: { value: 0 }
      },
      vertexShader: bitVertexShader,
      fragmentShader: bitFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    // Edge material
    this.edgeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: StateColors.neutral.clone() },
        uTime: { value: 0 },
        uDim: { value: 0 }
      },
      vertexShader: edgeVertexShader,
      fragmentShader: edgeFragmentShader
    });

    this.bitMesh = new THREE.Mesh(geometry.clone(), this.bitMaterial);
    this.group.add(this.bitMesh);

    const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
    this.bitEdges = new THREE.LineSegments(edgesGeo, this.edgeMaterial);
    this.group.add(this.bitEdges);
  }

  setState(newState, autoRevert = null, revertDelay = 1500) {
    if (this.isShattered) return;

    // Clear any pending revert
    if (this.revertTimeout) {
      clearTimeout(this.revertTimeout);
      this.revertTimeout = null;
    }

    if (newState === this.state && this.morphProgress >= 1) return;

    // Track if session has done work
    if (newState === States.THINKING) {
      this.hasWorked = true;
    }

    // Clear tool-related event data when reverting to neutral/thinking
    if ((newState === States.NEUTRAL || newState === States.THINKING) && this.eventData) {
      this.eventData.tool_name = null;
      this.eventData.tool_input = null;
      this.eventData.message = null;
    }

    // Despawn all orbiting tool bits when entering NO state
    if (newState === States.NO) {
      for (const toolBit of this.toolBits.values()) {
        if (!toolBit.isDespawning) {
          toolBit.startDespawn();
        }
      }
    }

    // Use targetState if mid-morph, since that's what geometry is transitioning toward
    const effectiveCurrentState = this.morphProgress < 1 ? this.targetState : this.state;

    this.targetState = newState;
    this.sourceColor = this.getCurrentColor().clone();
    this.targetColor = StateColors[newState].clone();

    const currentGeoState = effectiveCurrentState === States.THINKING ? States.NEUTRAL : effectiveCurrentState;
    const targetGeoState = newState === States.THINKING ? States.NEUTRAL : newState;

    // Check if geometry needs to change
    if (currentGeoState !== targetGeoState) {
      const sourcePositions = this.bitMesh.geometry.attributes.position;
      const targetGeo = getGeometry(newState);
      const targetPositions = targetGeo.attributes.position;

      if (sourcePositions.count !== targetPositions.count) {
        this.useScaleTransition = true;
        this.geometrySwapped = false;
        this.pendingGeometry = targetGeo;
      } else {
        this.useScaleTransition = false;
        this.sourcePositions = new Float32Array(sourcePositions.array);
        this.targetPositions = new Float32Array(targetPositions.array);
      }
    } else {
      this.useScaleTransition = false;
    }

    this.morphProgress = 0;

    // Set up auto-revert if specified
    if (autoRevert) {
      this.revertTimeout = setTimeout(() => {
        this.setState(autoRevert);
      }, revertDelay);
    }
  }

  pulse(intensity = 1.0) {
    // Additive pulse - multiple rapid pulses combine instead of resetting
    this.pulseIntensity = Math.min(1.5, this.pulseIntensity + intensity * 0.7);
  }

  /**
   * Get current animation state for scheduler coordination
   */
  getAnimationState() {
    let hasSpawningTools = false;
    let hasDespawningTools = false;

    for (const toolBit of this.toolBits.values()) {
      if (!toolBit.isDespawning && Math.abs(toolBit.currentScale - toolBit.targetScale) > 0.01) {
        hasSpawningTools = true;
      }
      if (toolBit.isDespawning && !toolBit.isFinished) {
        hasDespawningTools = true;
      }
    }

    return {
      morphProgress: this.morphProgress,
      isMorphing: this.morphProgress < 1,
      hasSpawningTools,
      hasDespawningTools,
      isAnimating: this.morphProgress < 1 || hasSpawningTools || hasDespawningTools,
      state: this.state,
      targetState: this.targetState
    };
  }

  setDimmed(dimmed) {
    this.isDimmed = dimmed;
    this.targetDim = dimmed ? 1 : 0;
  }

  setEventData(eventData) {
    if (eventData?.event) {
      const e = eventData.event;
      this.eventData = {
        cwd: e.cwd,
        tool_name: e.tool_name,
        tool_input: e.tool_input,
        message: e.message,
        hook_event_name: e.hook_event_name
      };
    }
  }

  getCurrentColor() {
    return this.bitMaterial.uniforms.uColor.value;
  }

  shatter() {
    if (this.isShattered) return;
    this.isShattered = true;

    // Get current positions
    const positions = this.bitMesh.geometry.attributes.position.array;
    const particleCount = positions.length / 3;

    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const velocities = [];

    for (let i = 0; i < positions.length; i += 3) {
      particlePositions[i] = positions[i];
      particlePositions[i + 1] = positions[i + 1];
      particlePositions[i + 2] = positions[i + 2];

      // Random outward velocity
      const dir = new THREE.Vector3(
        positions[i],
        positions[i + 1],
        positions[i + 2]
      ).normalize();

      velocities.push({
        x: dir.x * (1 + Math.random()) * 2,
        y: dir.y * (1 + Math.random()) * 2,
        z: dir.z * (1 + Math.random()) * 2
      });
    }

    particleGeo.setAttribute('position', new THREE.Float32BufferAttribute(particlePositions, 3));

    const particleMat = new THREE.PointsMaterial({
      color: this.getCurrentColor(),
      size: 0.1,
      transparent: true,
      opacity: 1
    });

    this.shatterParticles = new THREE.Points(particleGeo, particleMat);
    this.shatterParticles.userData.velocities = velocities;
    this.shatterParticles.userData.startTime = Date.now();

    // Hide original mesh
    this.bitMesh.visible = false;
    this.bitEdges.visible = false;

    this.group.add(this.shatterParticles);
  }

  addToolBit(toolUseId, toolName) {
    if (this.toolBits.has(toolUseId)) return;
    // Don't add orbiting bits during NO state
    if (this.state === States.NO || this.targetState === States.NO) return;

    const totalTools = this.toolBits.size + 1;
    const toolBit = new ToolBit(toolUseId, toolName, this.toolBits.size, totalTools);
    this.toolBits.set(toolUseId, toolBit);
    this.group.add(toolBit.group);

    // Update orbit positions for all tool bits to distribute evenly
    this.updateToolBitOrbits();

    // Set parent to YES when tools are active
    if (this.toolBits.size >= 1) {
      this.setState(States.YES);
    }
  }

  removeToolBit(toolUseId) {
    const toolBit = this.toolBits.get(toolUseId);
    if (!toolBit) return;

    toolBit.startDespawn();
    // Update orbit positions for remaining active tools
    this.updateToolBitOrbits();

    // Manage state based on remaining active tools
    const activeCount = Array.from(this.toolBits.values())
      .filter(tb => !tb.isDespawning).length;

    if (activeCount === 0) {
      // No tools remaining - return to THINKING
      this.setState(States.THINKING);
    }
  }

  updateToolBitOrbits() {
    // Count only non-despawning tool bits for distribution
    const activeTools = Array.from(this.toolBits.values()).filter(tb => !tb.isDespawning);
    const totalActive = activeTools.length;

    activeTools.forEach((toolBit, index) => {
      toolBit.updateOrbitPosition(index, totalActive);
    });
  }

  clearAllToolBits() {
    for (const toolBit of this.toolBits.values()) {
      if (!toolBit.isDespawning) {
        toolBit.startDespawn();
      }
    }
  }

  update(delta, elapsed) {
    if (this.isShattered) {
      this.updateShatter(delta);
      return;
    }

    // Update shader time
    this.bitMaterial.uniforms.uTime.value = elapsed;
    this.edgeMaterial.uniforms.uTime.value = elapsed;

    // Update dimming smoothly
    if (this.currentDim !== this.targetDim) {
      const dimDiff = this.targetDim - this.currentDim;
      this.currentDim += dimDiff * Math.min(1, delta * this.dimSpeed);
      if (Math.abs(dimDiff) < 0.01) {
        this.currentDim = this.targetDim;
      }
      this.bitMaterial.uniforms.uDim.value = this.currentDim;
      this.edgeMaterial.uniforms.uDim.value = this.currentDim;
    }

    // Update morphing
    this.updateMorph(delta);

    // Rotation based on state (faster if session has worked, slower if dimmed)
    let rotSpeed = RotationSpeeds[this.state] || 1.0;
    if (this.hasWorked && this.state !== States.THINKING) {
      rotSpeed *= WORKED_ROTATION_MULTIPLIER;
    }
    // Slow rotation when dimmed
    rotSpeed *= (1 - this.currentDim * 0.7);
    this.group.rotation.y += delta * rotSpeed;
    this.group.rotation.x = Math.sin(elapsed * 0.3) * 0.1;

    // Bobbing motion
    const bob = Math.sin(elapsed * 2) * 0.1;
    this.group.position.y = this.group.userData.baseY !== undefined
      ? this.group.userData.baseY + bob
      : bob;

    // Pulse effect decay
    if (this.pulseIntensity > 0) {
      this.pulseIntensity -= delta * 3;
      if (this.pulseIntensity < 0) this.pulseIntensity = 0;

      const pulseScale = this.scale * (1 + this.pulseIntensity * 0.3);
      this.group.scale.setScalar(pulseScale);
    } else if (this.morphProgress >= 1) {
      this.group.scale.setScalar(this.scale);
    }

    // Update tool bits
    for (const [toolUseId, toolBit] of this.toolBits) {
      toolBit.update(delta, elapsed);

      // Clean up finished tool bits
      if (toolBit.isFinished) {
        this.group.remove(toolBit.group);
        toolBit.dispose();
        this.toolBits.delete(toolUseId);
      }
    }
  }

  updateMorph(delta) {
    if (this.morphProgress >= 1) return;

    this.morphProgress += delta * this.morphSpeed;
    if (this.morphProgress > 1) this.morphProgress = 1;

    // Smooth easing
    const t = this.morphProgress < 0.5
      ? 4 * this.morphProgress * this.morphProgress * this.morphProgress
      : 1 - Math.pow(-2 * this.morphProgress + 2, 3) / 2;

    if (this.useScaleTransition) {
      let morphScale;
      if (this.morphProgress < 0.5) {
        morphScale = 1 - (t * 2);
      } else {
        if (!this.geometrySwapped) {
          this.geometrySwapped = true;
          this.group.remove(this.bitMesh);
          this.group.remove(this.bitEdges);

          const geometry = this.pendingGeometry.clone();
          this.bitMesh = new THREE.Mesh(geometry, this.bitMaterial);
          this.group.add(this.bitMesh);

          const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
          this.bitEdges = new THREE.LineSegments(edgesGeo, this.edgeMaterial);
          this.group.add(this.bitEdges);
        }
        morphScale = (t - 0.5) * 2;
      }
      this.group.scale.setScalar(Math.max(0.01, morphScale) * this.scale);
    } else if (this.sourcePositions && this.targetPositions) {
      const pos = this.bitMesh.geometry.attributes.position;
      for (let i = 0; i < pos.array.length; i++) {
        pos.array[i] = this.sourcePositions[i] + (this.targetPositions[i] - this.sourcePositions[i]) * t;
      }
      pos.needsUpdate = true;
      this.bitMesh.geometry.computeVertexNormals();

      this.group.remove(this.bitEdges);
      const edgesGeo = new THREE.EdgesGeometry(this.bitMesh.geometry, 15);
      this.bitEdges = new THREE.LineSegments(edgesGeo, this.edgeMaterial);
      this.group.add(this.bitEdges);
    }

    // Interpolate colors
    // For scale transitions, sync color change with geometry swap to prevent
    // showing wrong geometry+color combinations (e.g., Octahedron with Cyan)
    if (this.sourceColor && this.targetColor) {
      let colorT = t;
      if (this.useScaleTransition) {
        // Keep source color during shrink phase (0-0.5), lerp during grow phase (0.5-1.0)
        colorT = this.morphProgress < 0.5 ? 0 : (this.morphProgress - 0.5) * 2;
      }
      const lerpedColor = this.sourceColor.clone().lerp(this.targetColor, colorT);
      this.bitMaterial.uniforms.uColor.value.copy(lerpedColor);
      this.edgeMaterial.uniforms.uColor.value.copy(lerpedColor);
    }

    if (this.morphProgress >= 1) {
      this.state = this.targetState;
      this.bitMaterial.uniforms.uColor.value.copy(StateColors[this.state]);
      this.edgeMaterial.uniforms.uColor.value.copy(StateColors[this.state]);
      if (this.useScaleTransition) {
        this.group.scale.setScalar(this.scale);
      }
    }
  }

  updateShatter(delta) {
    if (!this.shatterParticles) return;

    const positions = this.shatterParticles.geometry.attributes.position.array;
    const velocities = this.shatterParticles.userData.velocities;
    const elapsed = (Date.now() - this.shatterParticles.userData.startTime) / 1000;

    for (let i = 0; i < velocities.length; i++) {
      const idx = i * 3;
      positions[idx] += velocities[i].x * delta;
      positions[idx + 1] += velocities[i].y * delta;
      positions[idx + 2] += velocities[i].z * delta;

      // Apply gravity
      velocities[i].y -= delta * 2;
    }

    this.shatterParticles.geometry.attributes.position.needsUpdate = true;

    // Fade out
    this.shatterParticles.material.opacity = Math.max(0, 1 - elapsed);
  }

  isFinished() {
    if (!this.isShattered) return false;
    const elapsed = (Date.now() - this.shatterParticles.userData.startTime) / 1000;
    return elapsed > 2;
  }

  dispose() {
    if (this.revertTimeout) {
      clearTimeout(this.revertTimeout);
    }

    this.bitMesh.geometry.dispose();
    this.bitMaterial.dispose();
    this.bitEdges.geometry.dispose();
    this.edgeMaterial.dispose();

    if (this.shatterParticles) {
      this.shatterParticles.geometry.dispose();
      this.shatterParticles.material.dispose();
    }

    // Clean up tool bits
    for (const toolBit of this.toolBits.values()) {
      this.group.remove(toolBit.group);
      toolBit.dispose();
    }
    this.toolBits.clear();
  }
}
