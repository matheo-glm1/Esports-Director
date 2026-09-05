/**
 * AI RENDERER — Rendu Three.js des agents
 */

'use strict';

class RenderSystem {
  constructor(scene) {
    this.scene = scene;
    this.agentMeshes = {};
    this.projectiles = [];
  }

  addAgent(agent) {
    const mesh = agent.createMesh();
    this.scene.add(mesh);
    this.agentMeshes[agent.id] = mesh;
  }

  updateAgent(agent) {
    const mesh = this.agentMeshes[agent.id];
    if (!mesh) return;
    
    mesh.position.copy(agent.position);
    mesh.rotation.copy(agent.rotation);
  }

  removeAgent(agent) {
    const mesh = this.agentMeshes[agent.id];
    if (mesh) {
      this.scene.remove(mesh);
      delete this.agentMeshes[agent.id];
    }
  }

  addProjectile(startPos, direction, owner) {
    // Créer les projectiles
  }

  updateProjectiles() {
    // Update positions
  }
}
