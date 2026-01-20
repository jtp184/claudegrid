import * as THREE from 'three';

// Visual states
export const States = {
  NEUTRAL: 'neutral',
  IDLE: 'idle',
  THINKING: 'thinking',
  YES: 'yes',
  NO: 'no',
  ENDING: 'ending'
};

// Colors for each state
const StateColors = {
  neutral: new THREE.Color(0x44ddff),   // Cyan
  idle: new THREE.Color(0x44ddff),      // Cyan (dimmed via shader)
  thinking: new THREE.Color(0x44ddff),  // Cyan (fast rotation)
  yes: new THREE.Color(0xffdd44),       // Yellow
  no: new THREE.Color(0xff4422),        // Orange
  ending: new THREE.Color(0x44ddff)     // Cyan (shatter)
};

// Rotation speeds
const RotationSpeeds = {
  neutral: 0.5,
  idle: 0.15,
  thinking: 3.0,
  yes: 1.0,
  no: 1.0,
  ending: 0.5
};

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
  // Map states to geometry types
  const geoState = (state === States.THINKING || state === States.IDLE) ? States.NEUTRAL : state;

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
  constructor(toolUseId, toolName) {
    this.toolUseId = toolUseId;
    this.toolName = toolName;
    this.scale = 0.2;

    // Use a seeded pseudo-random based on toolUseId for consistency
    const seed = this.hashCode(toolUseId);
    const rand = (offset) => {
      const x = Math.sin(seed + offset) * 10000;
      return x - Math.floor(x);
    };

    // Vary orbit parameters for each bit
    this.orbitRadius = 1.2 + rand(1) * 0.4;
    this.orbitSpeed = 1.5 + rand(2) * 1.0;
    this.orbitAngle = rand(3) * Math.PI * 2;

    // Orbital inclination - tilt the orbit plane
    this.orbitInclination = (rand(4) - 0.5) * Math.PI * 0.6;
    this.orbitAscendingNode = rand(5) * Math.PI * 2;

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

    this.group.scale.setScalar(0.01);
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  startDespawn() {
    this.isDespawning = true;
    this.targetScale = 0;
  }

  update(delta, elapsed) {
    if (this.isFinished) return;

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

    const flatX = Math.cos(this.orbitAngle) * this.orbitRadius;
    const flatZ = Math.sin(this.orbitAngle) * this.orbitRadius;

    const inclinedY = flatZ * Math.sin(this.orbitInclination);
    const inclinedZ = flatZ * Math.cos(this.orbitInclination);

    const cosAN = Math.cos(this.orbitAscendingNode);
    const sinAN = Math.sin(this.orbitAscendingNode);
    this.group.position.x = flatX * cosAN - inclinedZ * sinAN;
    this.group.position.z = flatX * sinAN + inclinedZ * cosAN;
    this.group.position.y = inclinedY;

    this.group.scale.setScalar(Math.max(0.01, this.currentScale));

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
    this.scale = isSubagent ? 0.4 : 1.0;

    // Track if session has done work
    this.hasWorked = false;

    // Scale transition state
    this.morphProgress = 1;
    this.morphSpeed = 4;
    this.pendingGeometry = null;
    this.geometrySwapped = false;

    // Current/target color for smooth transitions
    this.currentColor = StateColors.neutral.clone();
    this.targetColor = StateColors.neutral.clone();

    // Dimming state
    this.currentDim = 0;
    this.targetDim = 0;

    // Shatter particles
    this.shatterParticles = null;
    this.isShattered = false;

    // YES revert timer
    this.yesRevertTimer = null;

    // Event data for hover labels
    this.eventData = null;

    // Tool bits for active tool uses
    this.toolBits = new Map();

    this.group = new THREE.Group();
    this.group.scale.setScalar(this.scale);

    // Inner group for main bit mesh/edges - this gets scaled during morphs
    this.bitGroup = new THREE.Group();
    this.group.add(this.bitGroup);

    this.createBit();
  }

  createBit() {
    const geometry = getGeometry(States.NEUTRAL);

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
    this.bitGroup.add(this.bitMesh);

    const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
    this.bitEdges = new THREE.LineSegments(edgesGeo, this.edgeMaterial);
    this.bitGroup.add(this.bitEdges);
  }

  /**
   * Main event handler - implements the state machine
   */
  handleEvent(event) {
    const { hook_event_name, tool_use_id, tool_name, tool_use_blocked, notification_type } = event;

    // Clear YES revert timer on any new event
    if (this.yesRevertTimer) {
      clearTimeout(this.yesRevertTimer);
      this.yesRevertTimer = null;
    }

    switch (hook_event_name) {
      case 'SessionStart':
        this.setState(States.NEUTRAL);
        break;

      case 'Notification':
        if (notification_type === 'idle_prompt') {
          this.setDimmed(true);
          this.setState(States.IDLE);
        } else {
          this.setState(States.NO);
        }
        break;

      case 'UserPromptSubmit':
        this.setDimmed(false);
        this.hasWorked = true;
        this.setState(States.THINKING);
        break;

      case 'PreToolUse':
        this.addToolBit(tool_use_id, tool_name);
        break;

      case 'PostToolUse':
        this.removeToolBit(tool_use_id);
        if (tool_use_blocked) {
          this.setState(States.NO);
        } else {
          this.setState(States.YES);
          this.yesRevertTimer = setTimeout(() => {
            this.yesRevertTimer = null;
            this.setState(States.THINKING);
          }, 600);
        }
        break;

      case 'PermissionRequest':
        this.setState(States.NO);
        break;

      case 'Stop':
      case 'SubagentStop':
        this.clearAllToolBits();
        this.setState(States.NEUTRAL);
        break;

      case 'SessionEnd':
        this.shatter();
        break;
    }

    this.setEventData(event);
  }

  setState(newState) {
    if (this.isShattered) return;
    if (newState === this.state && this.morphProgress >= 1) return;

    const oldGeoState = this.getGeoState(this.state);
    const newGeoState = this.getGeoState(newState);

    this.state = newState;
    this.targetColor = StateColors[newState].clone();
    this.targetDim = newState === States.IDLE ? 1 : 0;

    // Check if geometry needs to change
    if (oldGeoState !== newGeoState) {
      this.pendingGeometry = getGeometry(newState);
      this.geometrySwapped = false;
      this.morphProgress = 0;
    }
  }

  getGeoState(state) {
    if (state === States.THINKING || state === States.IDLE) return States.NEUTRAL;
    return state;
  }

  setDimmed(dimmed) {
    this.targetDim = dimmed ? 1 : 0;
  }

  setEventData(event) {
    this.eventData = {
      cwd: event.cwd,
      tool_name: event.tool_name,
      tool_input: event.tool_input,
      message: event.message,
      hook_event_name: event.hook_event_name
    };
  }

  shatter() {
    if (this.isShattered) return;
    this.isShattered = true;

    const positions = this.bitMesh.geometry.attributes.position.array;
    const particleCount = positions.length / 3;

    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const velocities = [];

    for (let i = 0; i < positions.length; i += 3) {
      particlePositions[i] = positions[i];
      particlePositions[i + 1] = positions[i + 1];
      particlePositions[i + 2] = positions[i + 2];

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
      color: this.currentColor,
      size: 0.1,
      transparent: true,
      opacity: 1
    });

    this.shatterParticles = new THREE.Points(particleGeo, particleMat);
    this.shatterParticles.userData.velocities = velocities;
    this.shatterParticles.userData.startTime = Date.now();

    this.bitMesh.visible = false;
    this.bitEdges.visible = false;

    this.group.add(this.shatterParticles);
  }

  addToolBit(toolUseId, toolName) {
    if (this.toolBits.has(toolUseId)) return;
    if (this.state === States.NO) return;

    const toolBit = new ToolBit(toolUseId, toolName);
    this.toolBits.set(toolUseId, toolBit);
    this.group.add(toolBit.group);
  }

  removeToolBit(toolUseId) {
    const toolBit = this.toolBits.get(toolUseId);
    if (!toolBit) return;
    toolBit.startDespawn();
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

    this.bitMaterial.uniforms.uTime.value = elapsed;
    this.edgeMaterial.uniforms.uTime.value = elapsed;

    // Smooth color transition
    this.currentColor.lerp(this.targetColor, delta * 5);
    this.bitMaterial.uniforms.uColor.value.copy(this.currentColor);
    this.edgeMaterial.uniforms.uColor.value.copy(this.currentColor);

    // Smooth dim transition
    const dimDiff = this.targetDim - this.currentDim;
    if (Math.abs(dimDiff) > 0.01) {
      this.currentDim += dimDiff * delta * 3;
    } else {
      this.currentDim = this.targetDim;
    }
    this.bitMaterial.uniforms.uDim.value = this.currentDim;
    this.edgeMaterial.uniforms.uDim.value = this.currentDim;

    // Update scale morph (geometry swap at midpoint)
    this.updateMorph(delta);

    // Rotation based on state
    let rotSpeed = RotationSpeeds[this.state] || 0.5;
    if (this.hasWorked && this.state === States.NEUTRAL) {
      rotSpeed *= 2.0;
    }
    this.group.rotation.y += delta * rotSpeed;
    this.group.rotation.x = Math.sin(elapsed * 0.3) * 0.1;

    // Bobbing motion
    const bob = Math.sin(elapsed * 2) * 0.1;
    this.group.position.y = (this.group.userData.baseY ?? 0) + bob;

    // Update tool bits
    for (const [toolUseId, toolBit] of this.toolBits) {
      toolBit.update(delta, elapsed);

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

    // Scale down, swap geometry at midpoint, scale up
    let morphScale;
    if (this.morphProgress < 0.5) {
      morphScale = 1 - this.morphProgress * 2;
    } else {
      if (!this.geometrySwapped && this.pendingGeometry) {
        this.geometrySwapped = true;
        this.bitGroup.remove(this.bitMesh);
        this.bitGroup.remove(this.bitEdges);

        const geometry = this.pendingGeometry.clone();
        this.bitMesh = new THREE.Mesh(geometry, this.bitMaterial);
        this.bitGroup.add(this.bitMesh);

        const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
        this.bitEdges = new THREE.LineSegments(edgesGeo, this.edgeMaterial);
        this.bitGroup.add(this.bitEdges);
      }
      morphScale = (this.morphProgress - 0.5) * 2;
    }

    // Only scale the inner bitGroup, not the tool bits
    this.bitGroup.scale.setScalar(Math.max(0.01, morphScale));

    if (this.morphProgress >= 1) {
      this.bitGroup.scale.setScalar(1);
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

      velocities[i].y -= delta * 2;
    }

    this.shatterParticles.geometry.attributes.position.needsUpdate = true;
    this.shatterParticles.material.opacity = Math.max(0, 1 - elapsed);
  }

  isFinished() {
    if (!this.isShattered) return false;
    const elapsed = (Date.now() - this.shatterParticles.userData.startTime) / 1000;
    return elapsed > 2;
  }

  dispose() {
    if (this.yesRevertTimer) {
      clearTimeout(this.yesRevertTimer);
    }

    this.bitMesh.geometry.dispose();
    this.bitMaterial.dispose();
    this.bitEdges.geometry.dispose();
    this.edgeMaterial.dispose();

    if (this.shatterParticles) {
      this.shatterParticles.geometry.dispose();
      this.shatterParticles.material.dispose();
    }

    for (const toolBit of this.toolBits.values()) {
      this.group.remove(toolBit.group);
      toolBit.dispose();
    }
    this.toolBits.clear();
  }
}
