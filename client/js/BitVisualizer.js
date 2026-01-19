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

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, 2.0);

    float pulse = 0.8 + 0.2 * sin(uTime * 3.0);

    vec3 color = uColor * (0.5 + fresnel * 1.5) * pulse;
    float alpha = uOpacity + fresnel * 0.7;

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

  void main() {
    float pulse = 0.9 + 0.1 * sin(uTime * 4.0);
    gl_FragColor = vec4(uColor * 2.0 * pulse, 1.0);
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

export class BitVisualizer {
  constructor(sessionId, isSubagent = false) {
    this.sessionId = sessionId;
    this.isSubagent = isSubagent;
    this.state = States.NEUTRAL;
    this.targetState = States.NEUTRAL;
    this.scale = isSubagent ? 0.4 : 1.0;

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

    // Shatter particles
    this.shatterParticles = null;
    this.isShattered = false;

    // Auto-revert timer
    this.revertTimeout = null;

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
        uOpacity: { value: 0.3 }
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
        uTime: { value: 0 }
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

    this.targetState = newState;
    this.sourceColor = this.getCurrentColor().clone();
    this.targetColor = StateColors[newState].clone();

    const currentGeoState = this.state === States.THINKING ? States.NEUTRAL : this.state;
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

  pulse() {
    this.pulseIntensity = 1.0;
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

  update(delta, elapsed) {
    if (this.isShattered) {
      this.updateShatter(delta);
      return;
    }

    // Update shader time
    this.bitMaterial.uniforms.uTime.value = elapsed;
    this.edgeMaterial.uniforms.uTime.value = elapsed;

    // Update morphing
    this.updateMorph(delta);

    // Rotation based on state
    const rotSpeed = RotationSpeeds[this.state] || 1.0;
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
    if (this.sourceColor && this.targetColor) {
      const lerpedColor = this.sourceColor.clone().lerp(this.targetColor, t);
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
  }
}
