/**
 * AI COMBAT — Duels, calcul des dégâts, aim
 * 
 * Systèmes :
 * - Ballistics réaliste (projectiles)
 * - Aim assist basé sur les statistiques
 * - Prédiction du mouvement des cibles
 * - Dégâts localisés (headshot, chest, legs)
 * - Recoil et spread
 */

'use strict';

class CombatSystem {
  constructor(agent) {
    this.agent = agent;
    this.lastShotTick = 0;
    this.reloadTime = 0;
    this.reloadCooldown = 30;  // Ticks avant de pouvoir tirer à nouveau après reload
    this.ammoInMag = agent.weapon.ammo;
    this.bulletSpread = 0;     // Cumulative spread
  }

  /**
   * Tirer sur une cible
   * Retourne true si le tir a touché
   */
  shootAt(target, currentTick) {
    // Vérifier les conditions de tir
    if (!this.canShoot(currentTick)) return false;
    if (this.ammoInMag <= 0) return this.reload();
    
    this.lastShotTick = currentTick;
    this.ammoInMag--;
    
    // Prédire la position de la cible
    const predictedPos = this.predictTargetPosition(target, 0.05);
    
    // Calculer le spread (imprécision)
    const spread = this.calculateSpread();
    
    // Calculer le point d'impact réel
    const impactPos = predictedPos.clone().add(
      new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread
      )
    );
    
    // Calculer la distance et vérifier le hit
    const distance = impactPos.distanceTo(predictedPos);
    const hitAccuracy = this.calculateHitChance(distance);
    
    if (Math.random() > hitAccuracy) {
      // Manqué !
      return false;
    }
    
    // Déterminer la localisation du hit (head/body/legs)
    const hitLocation = this.determineHitLocation(target, predictedPos, impactPos);
    
    // Calculer les dégâts
    const damage = this.calculateDamage(target, distance, hitLocation);
    
    // Appliquer les dégâts
    target.takeDamage(damage);
    
    // Augmenter le spread pour le prochain tir
    this.bulletSpread = Math.min(1.0, this.bulletSpread + 0.15);
    
    // Logger le hit
    if (window.simulator) {
      window.simulator.log(`💥 ${this.agent.name} hit ${target.name} (${hitLocation} for ${damage.toFixed(1)}HP)`, 'kill');
    }
    
    return true;
  }

  /**
   * Peut-on tirer maintenant ?
   */
  canShoot(currentTick) {
    if (!this.agent.targetEnemy || !this.agent.targetEnemy.alive) return false;
    const fireRate = this.agent.weapon.rof;
    const timeBetweenShots = 1000 / (fireRate * 60);  // Convertir en ticks
    return (currentTick - this.lastShotTick) >= timeBetweenShots;
  }

  /**
   * Calculer le spread (imprécision du spray)
   */
  calculateSpread() {
    const baseSpread = 0.3;
    const aimMod = (this.agent.stats.aim / 100);
    const currentSpread = this.bulletSpread * (1 - aimMod * 0.7);
    return baseSpread + currentSpread;
  }

  /**
   * Calculer la chance de toucher basée sur la distance et l'aim
   */
  calculateHitChance(distance) {
    const baseAccuracy = this.agent.weapon.accuracy;
    const aimFactor = this.agent.stats.aim / 100;
    const distanceFactor = Math.max(0.3, 1 - distance / 50);
    
    return baseAccuracy * aimFactor * distanceFactor;
  }

  /**
   * Prédire la position future de la cible
   */
  predictTargetPosition(target, predictionTime = 0.1) {
    const predicted = target.position.clone();
    predicted.addScaledVector(target.velocity, predictionTime);
    return predicted;
  }

  /**
   * Déterminer la localisation du hit (head/body/legs)
   */
  determineHitLocation(target, predictedPos, impactPos) {
    const relativeY = impactPos.y - target.position.y;
    
    // La tête est entre 1.0 et 1.6
    if (relativeY > 0.9) {
      return 'head';
    }
    // Le corps est entre 0.3 et 0.9
    else if (relativeY > 0.3) {
      return 'body';
    }
    // Les jambes sont en dessous
    else {
      return 'legs';
    }
  }

  /**
   * Calculer les dégâts en fonction de la localisation
   */
  calculateDamage(target, distance, hitLocation = 'body') {
    let baseDamage = this.agent.weapon.damage;
    
    // Multiplicateurs de localisation
    const locationMult = {
      'head': 2.5,      // Headshot critiques
      'body': 1.0,      // Dégâts normaux
      'legs': 0.75      // Moins de dégâts
    };
    
    // Distance falloff (jusqu'à 50m)
    const distanceFalloff = Math.max(0.4, 1 - distance / 50);
    
    // Appliquer les modificateurs
    const damage = baseDamage * locationMult[hitLocation] * distanceFalloff;
    
    return damage;
  }

  /**
   * Recharger
   */
  reload() {
    this.ammoInMag = this.agent.weapon.maxAmmo;
    this.bulletSpread = 0;
    this.reloadTime = this.reloadCooldown;
    return false;
  }

  /**
   * Calculer l'angle optimal pour tirer sur une cible
   */
  calculateOptimalAimAngle(target) {
    const toTarget = target.position.clone().sub(this.agent.position);
    const distance = toTarget.length();
    
    // Lead compensation basée sur la réaction
    const reactionFactor = (this.agent.stats.reaction / 100) * 0.5;
    
    // Prédire où la cible sera
    const leadTime = distance / 15;  // Vitesse des balles
    const predictedPos = target.position.clone().addScaledVector(
      target.velocity,
      leadTime * reactionFactor
    );
    
    return Math.atan2(
      predictedPos.x - this.agent.position.x,
      predictedPos.z - this.agent.position.z
    );
  }
}
