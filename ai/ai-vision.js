/**
 * AI VISION — Système de vision, FOV, ligne de vue
 */

'use strict';

class VisionSystem {
  constructor(agent) {
    this.agent = agent;
  }

  updateVisibleEnemies(enemyTeam) {
    // Implémenté dans Agent.updateVision()
  }

  checkLineOfSight(from, to, obstacles = []) {
    // Vérifier la ligne de vue
    return true;
  }

  inFOV(agentPos, agentRotation, targetPos, fov) {
    // Vérifier si la cible est dans le FOV
    return true;
  }
}
