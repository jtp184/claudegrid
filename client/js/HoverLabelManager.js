import * as THREE from 'three';

export class HoverLabelManager {
  constructor(canvas, camera, options = {}) {
    this.canvas = canvas;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoveredBit = null;

    // Optional callbacks
    this.getSessionName = options.getSessionName || null;
    this.onBitClick = options.onBitClick || null;

    // Create label container
    this.container = document.createElement('div');
    this.container.id = 'hover-labels';
    this.canvas.parentElement.appendChild(this.container);

    // Create label elements
    this.cwdLabel = document.createElement('div');
    this.cwdLabel.className = 'hover-label';
    this.cwdLabel.dataset.type = 'cwd';
    this.cwdLabel.style.display = 'none';
    this.container.appendChild(this.cwdLabel);

    this.contextLabel = document.createElement('div');
    this.contextLabel.className = 'hover-label';
    this.contextLabel.dataset.type = 'context';
    this.contextLabel.style.display = 'none';
    this.container.appendChild(this.contextLabel);

    // Bind event handlers
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onClick = this.onClick.bind(this);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('click', this.onClick);
  }

  onMouseMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  onClick() {
    if (this.hoveredBit && this.onBitClick) {
      this.onBitClick(this.hoveredBit.sessionId);
    }
  }

  update(sessions) {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Collect all bit meshes and their parent bits
    const meshes = [];
    const bitMap = new Map();

    for (const session of sessions.values()) {
      const bit = session.bit;
      if (!bit.isShattered && bit.bitMesh) {
        meshes.push(bit.bitMesh);
        bitMap.set(bit.bitMesh.uuid, bit);
      }

      // Check subagents
      for (const subBit of session.subagents.values()) {
        if (!subBit.isShattered && subBit.bitMesh) {
          meshes.push(subBit.bitMesh);
          bitMap.set(subBit.bitMesh.uuid, subBit);
        }
      }
    }

    // Perform raycast
    const intersects = this.raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const bit = bitMap.get(hit.object.uuid);

      if (bit && bit.eventData) {
        this.hoveredBit = bit;
        this.showLabels(bit);
        return;
      }
    }

    // No hit or no event data
    this.hoveredBit = null;
    this.hideLabels();
  }

  showLabels(bit) {
    const eventData = bit.eventData;

    // Get bit world position
    const worldPos = new THREE.Vector3();
    bit.group.getWorldPosition(worldPos);

    // Project to screen coordinates
    const screenPos = worldPos.clone().project(this.camera);
    const canvasRect = this.canvas.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    // Calculate position relative to container (not canvas)
    const x = (screenPos.x * 0.5 + 0.5) * canvasRect.width + (canvasRect.left - containerRect.left);
    const y = (-screenPos.y * 0.5 + 0.5) * canvasRect.height + (canvasRect.top - containerRect.top);

    // Upper label: managed session name if available, otherwise cwd
    let upperText = null;
    if (this.getSessionName) {
      upperText = this.getSessionName(bit.sessionId);
    }
    if (!upperText && eventData.cwd) {
      upperText = eventData.cwd;
    }

    if (upperText) {
      this.cwdLabel.textContent = upperText;
      this.cwdLabel.style.display = 'block';
      this.cwdLabel.style.left = `${x}px`;
      this.cwdLabel.style.top = `${y - 90}px`;
      this.cwdLabel.style.transform = 'translateX(-50%)';
    } else {
      this.cwdLabel.style.display = 'none';
    }

    // Lower label: just the file path from last tool, nothing if no filepath
    let filePath = bit.lastToolFilePath;
    if (filePath) {
      // Make path relative to cwd if possible
      const cwd = eventData.cwd;
      if (cwd && filePath.startsWith(cwd)) {
        filePath = filePath.slice(cwd.length);
        // Remove leading slash if present
        if (filePath.startsWith('/')) {
          filePath = filePath.slice(1);
        }
        // Show ./ for files in the cwd
        if (filePath) {
          filePath = './' + filePath;
        }
      }

      // Truncate long paths
      const maxLen = 60;
      const displayPath = filePath.length > maxLen
        ? '...' + filePath.slice(-maxLen)
        : filePath;
      this.contextLabel.textContent = displayPath;
      this.contextLabel.style.display = 'block';
      this.contextLabel.style.left = `${x}px`;
      this.contextLabel.style.top = `${y + 70}px`;
      this.contextLabel.style.transform = 'translateX(-50%)';
    } else {
      this.contextLabel.style.display = 'none';
    }
  }

  hideLabels() {
    this.cwdLabel.style.display = 'none';
    this.contextLabel.style.display = 'none';
  }

  dispose() {
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('click', this.onClick);
    this.container.remove();
  }
}
