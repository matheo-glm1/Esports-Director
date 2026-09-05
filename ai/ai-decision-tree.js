/**
 * AI DECISION TREE — Arbre de décision pour actions individuelles
 */

'use strict';

class DecisionTree {
  constructor(agent) {
    this.agent = agent;
  }

  decide(myTeam, enemyTeam, strategy) {
    // Arbre de décision basé sur les stats et l'environnement
    return 'IDLE';
  }

  shouldChallengeDuel(enemyDistance, enemyWeapon) {
    // Basé sur l'agressivité et l'aim
    const aggressionThreshold = (this.agent.stats.aggression - 50) / 50;
    return Math.random() < (0.5 + aggressionThreshold * 0.3);
  }

  shouldWaitForTeam() {
    // Basé sur la discipline
    return this.agent.stats.discipline > 65;
  }
}
