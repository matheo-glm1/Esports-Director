/**
 * AI DEBUG — Interface de debug et visualisation
 */

'use strict';

class DebugRenderer {
  constructor(scene) {
    this.scene = scene;
    this.debugObjects = [];
    this.enabled = false;
  }

  toggle() {
    this.enabled = !this.enabled;
    this.debugObjects.forEach(obj => obj.visible = this.enabled);
  }

  drawPath(agent, pathPoints, color = 0x00ff00) {
    // Dessiner le chemin
  }

  drawFOV(agent, color = 0xff0000) {
    // Dessiner le FOV
  }

  drawVisionLine(agent, targetPos, canSee = true) {
    // Dessiner une ligne vers les ennemis visibles
  }

  drawStats(agent) {
    // Afficher les stats
  }
}
