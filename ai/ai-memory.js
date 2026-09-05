/**
 * AI MEMORY — Mémoire tactique et apprentissage
 */

'use strict';

class MemorySystem {
  constructor(team) {
    this.team = team;
    this.tactics = [];
    this.patterns = {};
    this.dangerZones = [];
  }

  recordTactic(strategy, roundNumber, result) {
    this.tactics.push({
      strategy: strategy.name,
      roundNumber: roundNumber,
      result: result,
      timestamp: Date.now(),
    });
  }

  shouldRepeatTactic(strategy) {
    // Retourner false si on a perdu trop avec cette strat
    const losses = this.tactics.filter(
      t => t.strategy === strategy.name && t.result === 'LOSS'
    ).length;
    return losses < 3;
  }

  recordEnemyHabit(enemy, position, action) {
    // Mémoriser les habitudes des ennemis
    if (!this.patterns[enemy.id]) {
      this.patterns[enemy.id] = [];
    }
    this.patterns[enemy.id].push({ position, action, tick: Date.now() });
  }

  getEnemyPattern(enemyId) {
    return this.patterns[enemyId] || [];
  }
}
