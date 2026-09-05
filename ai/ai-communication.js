/**
 * AI COMMUNICATION — Partage d'information entre agents
 */

'use strict';

class CommunicationSystem {
  constructor(team) {
    this.team = team;
    this.messages = [];
  }

  broadcastEnemySeen(agent, enemyPos, count = 1) {
    // Agent rapporte avoir vu des ennemis
    this.messages.push({
      type: 'ENEMY_SEEN',
      from: agent.id,
      enemyPos: enemyPos.clone(),
      count: count,
      tick: window.simulator?.state.tick || 0,
    });
  }

  broadcastPositionSecure(agent, position) {
    // Zone est sécurisée
    this.messages.push({
      type: 'POSITION_SECURE',
      from: agent.id,
      position: position.clone(),
    });
  }

  processMessages() {
    // Distribuer les messages
  }

  getRecentInfo(agentId) {
    // Retourner les informations récentes
    return [];
  }
}
