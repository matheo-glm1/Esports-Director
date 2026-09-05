/**
 * AI STRATEGY — Stratégies par round (rush, default, split, etc.)
 * 
 * Système de sélection variée pour éviter la répétition mécanique.
 * Basé sur :
 * - Économie (full buy, light buy, save)
 * - Score actuel (panique à 0-11 ? À 12-11 ? Casual ?)
 * - Résultat du round précédent
 * - Historique des stratégies (ne pas répéter 3x identique)
 * - Agressivité moyenne de l'équipe
 */

'use strict';

const ROUND_STRATEGIES = {
  RUSH_A: { 
    name: 'Rush A', 
    intensity: 'high', 
    sites: ['A'],
    description: 'Tous au site A rapidement',
    minimumEconomy: 3000  // Besoin d'armes
  },
  RUSH_B: { 
    name: 'Rush B', 
    intensity: 'high', 
    sites: ['B'],
    description: 'Tous au site B rapidement',
    minimumEconomy: 3000
  },
  DEFAULT: { 
    name: 'Default', 
    intensity: 'medium', 
    sites: ['A', 'B'],
    description: 'Contrôle de la map puis décision',
    minimumEconomy: 4000
  },
  SPLIT_AB: { 
    name: 'Split A/B', 
    intensity: 'medium', 
    sites: ['A', 'B'],
    description: 'Division 3-2 ou 2-3 entre les sites',
    minimumEconomy: 5000
  },
  FAKE_A_B: { 
    name: 'Fake A → B', 
    intensity: 'medium', 
    sites: ['A', 'B'],
    description: 'Push A pour étirer la défense, puis rotation B',
    minimumEconomy: 4000
  },
  FAKE_B_A: { 
    name: 'Fake B → A', 
    intensity: 'medium', 
    sites: ['A', 'B'],
    description: 'Push B pour étirer la défense, puis rotation A',
    minimumEconomy: 4000
  },
  MID_CONTROL: { 
    name: 'Mid Control', 
    intensity: 'medium', 
    sites: ['mid'],
    description: 'Contrôler la mid et choisir l\'attaque',
    minimumEconomy: 4000
  },
  LURK_A: { 
    name: 'Lurk + A', 
    intensity: 'low', 
    sites: ['A', 'lurk'],
    description: 'Un joueur en lurk pendant que 4 attaquent A',
    minimumEconomy: 3500
  },
  LURK_B: { 
    name: 'Lurk + B', 
    intensity: 'low', 
    sites: ['B', 'lurk'],
    description: 'Un joueur en lurk pendant que 4 attaquent B',
    minimumEconomy: 3500
  },
  ECO_RUSH: { 
    name: 'Eco Rush', 
    intensity: 'high', 
    sites: ['A'],
    description: 'Rush mal équipés (save next round)',
    minimumEconomy: 1500
  },
};

class StrategyEngine {
  constructor(team) {
    this.team = team;
    this.currentStrategy = null;
    this.strategyHistory = [];  // Strategies des 10 derniers rounds
    this.strategyResults = {};  // { 'Strategy Name': { wins: N, losses: N } }
    this.strategyHasChanged = false;
  }

  /**
   * Sélectionner une stratégie variée
   */
  selectStrategy(roundNumber, economy, previousRoundResult, scoreTallyMyTeam, scoreTallyEnemy) {
    // Initialiser les stats de la strat si nécessaire
    if (!this.strategyResults[this.currentStrategy?.name]) {
      Object.keys(ROUND_STRATEGIES).forEach(key => {
        if (!this.strategyResults[ROUND_STRATEGIES[key].name]) {
          this.strategyResults[ROUND_STRATEGIES[key].name] = { wins: 0, losses: 0 };
        }
      });
    }
    
    // Enregistrer le résultat du round précédent
    if (this.currentStrategy && previousRoundResult) {
      const resultKey = previousRoundResult === 'WIN' ? 'wins' : 'losses';
      this.strategyResults[this.currentStrategy.name][resultKey]++;
    }
    
    // Calculer les probabilités de chaque stratégie
    const strategyOptions = this.calculateStrategyWeights(
      roundNumber, economy, scoreTallyMyTeam, scoreTallyEnemy
    );
    
    // Choisir selon les probabilités pondérées
    const selectedStrategy = this.selectWeighted(strategyOptions);
    
    // Vérifier si la stratégie a changé
    this.strategyHasChanged = !this.currentStrategy || 
                             selectedStrategy.name !== this.currentStrategy.name;
    
    this.currentStrategy = selectedStrategy;
    this.strategyHistory.push(selectedStrategy.name);
    
    // Limiter l'historique à 10 rounds
    if (this.strategyHistory.length > 10) {
      this.strategyHistory.shift();
    }
    
    console.log(`🎯 Strategy for round ${roundNumber}: ${selectedStrategy.name}`);
    return selectedStrategy;
  }

  /**
   * Calculer les poids de chaque stratégie
   */
  calculateStrategyWeights(roundNumber, economy, myScore, enemyScore) {
    const weights = {};
    
    Object.entries(ROUND_STRATEGIES).forEach(([key, strategy]) => {
      let weight = 1.0;
      
      // 1. Filtre économique
      if (economy < strategy.minimumEconomy) {
        weight *= 0.3;  // Très peu probable si pas assez d'argent
      }
      
      // 2. Éviter la répétition
      const lastThree = this.strategyHistory.slice(-3);
      const timesRecentlyUsed = lastThree.filter(s => s === strategy.name).length;
      weight *= Math.pow(0.6, timesRecentlyUsed);  // 1.0 → 0.6 → 0.36 → 0.216
      
      // 3. Basé sur les résultats historiques
      const stats = this.strategyResults[strategy.name];
      if (stats) {
        const winRate = stats.wins / (stats.wins + stats.losses + 1);
        weight *= (0.5 + winRate);  // Entre 0.5 et 1.5
      }
      
      // 4. Agressivité moyenne de l'équipe
      const avgAggression = this.team.agents.reduce((sum, a) => 
        sum + a.stats.aggression, 0) / this.team.agents.length;
      
      if (strategy.intensity === 'high' && avgAggression > 60) {
        weight *= 1.3;  // Équipes agressives préfèrent les rush
      }
      if (strategy.intensity === 'low' && avgAggression < 50) {
        weight *= 1.2;  // Équipes défensives préfèrent les lurks
      }
      
      // 5. Adaptation au score
      if (myScore === 0 && enemyScore > 5) {
        // Perdant largement → push agressif
        if (strategy.intensity === 'high') weight *= 1.4;
      }
      if (myScore > 10 && enemyScore < 5) {
        // Largement devant → défendre (jouer default/split)
        if (strategy.intensity === 'medium') weight *= 1.2;
      }
      
      weights[strategy.name] = Math.max(0.1, weight);
    });
    
    return weights;
  }

  /**
   * Sélectionner une option selon poids pondérés
   */
  selectWeighted(weightMap) {
    const entries = Object.entries(weightMap);
    const totalWeight = entries.reduce((sum, [_, w]) => sum + w, 0);
    
    let random = Math.random() * totalWeight;
    
    for (const [strategyName, weight] of entries) {
      random -= weight;
      if (random <= 0) {
        return ROUND_STRATEGIES[Object.keys(ROUND_STRATEGIES).find(
          k => ROUND_STRATEGIES[k].name === strategyName
        )];
      }
    }
    
    // Fallback
    return ROUND_STRATEGIES.DEFAULT;
  }

  /**
   * Retourner l'historique des stratégies
   */
  getStrategyHistory() {
    return this.strategyHistory;
  }

  /**
   * Retourner les stats de victoire/défaite par stratégie
   */
  getStrategyStats() {
    return this.strategyResults;
  }
}
