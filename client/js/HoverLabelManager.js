import * as THREE from 'three';

export class HoverLabelManager {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoveredBit = null;

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
    this.canvas.addEventListener('mousemove', this.onMouseMove);
  }

  onMouseMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  getContextText(eventData) {
    if (!eventData) return null;

    // Permission request or notification - show message
    if (eventData.message) {
      return eventData.message;
    }

    // Tool use - show tool name with file path if present
    if (eventData.tool_name) {
      let text = eventData.tool_name;

      // Extract file path from tool_input if present
      if (eventData.tool_input) {
        const filePath = eventData.tool_input.file_path ||
                         eventData.tool_input.path ||
                         eventData.tool_input.command;
        if (filePath) {
          // Truncate long paths
          const maxLen = 50;
          const displayPath = filePath.length > maxLen
            ? '...' + filePath.slice(-maxLen)
            : filePath;
          text += ': ' + displayPath;
        }
      }

      return text;
    }

    return null;
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
    const rect = this.canvas.getBoundingClientRect();
    const x = (screenPos.x * 0.5 + 0.5) * rect.width;
    const y = (-screenPos.y * 0.5 + 0.5) * rect.height;

    // Show cwd label above
    if (eventData.cwd) {
      this.cwdLabel.textContent = eventData.cwd;
      this.cwdLabel.style.display = 'block';
      this.cwdLabel.style.left = `${x}px`;
      this.cwdLabel.style.top = `${y - 90}px`;
      this.cwdLabel.style.transform = 'translateX(-50%)';
    } else {
      this.cwdLabel.style.display = 'none';
    }

    // Show context label below
    const contextText = this.getContextText(eventData);
    if (contextText) {
      this.contextLabel.textContent = contextText;
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
    this.container.remove();
  }
}
