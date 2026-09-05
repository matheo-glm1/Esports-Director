/**
 * ============================================================
 * AI AGENTS — Définition des agents Valorant
 * ============================================================
 * 
 * Classe Agent avec :
 * - Statistiques (aim, réaction, game sense, etc.)
 * - Position et orientation 3D
 * - Santé et armure
 * - Inventaire (armes, utilitaires)
 * - État (idle, moving, aiming, etc.)
 * - Pathfinding
 */

'use strict';

/**
 * Agent — Un joueur IA dans le match
 */
class Agent {
  constructor(id, name, role, navGraph, side) {
    this.id = id;
    this.name = name;
    this.role = role;               // 'Duelist', 'Initiator', etc.
    this.navGraph = navGraph;
    this.side = side;               // 'ATTACK' | 'DEFENSE'

    // ========== PHYSICAL STATE ==========
    this.position = new THREE.Vector3(0, 1, 0);    // Spawn position
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.rotation = new THREE.Euler(0, 0, 0);      // Yaw, Pitch, Roll
    this.moveDirection = new THREE.Vector3(0, 0, 0);
    this.movingToward = null;        // THREE.Vector3 (target)
    
    // ========== HEALTH ==========
    this.maxHp = 100;
    this.hp = 100;
    this.maxShield = 25;
    this.shield = 0;
    this.alive = true;
    
    // ========== WEAPONS & UTILITIES ==========
    this.weapon = {
      name: 'Classic',              // Arme actuelle
      ammo: 30,
      maxAmmo: 30,
      damage: 22,                   // Dégâts par balle
      rof: 15,                       // Tir par seconde
      accuracy: 0.85,               // Précision de base (0-1)
      recoil: 0.5,
    };
    this.utilities = [
      // { name: 'Smoke', charges: 2, cooldown: 0 }
    ];
    this.credits = 0;
    
    // ========== STATISTICS (0-100 scale) ==========
    this.stats = {
      aim: 65,                       // Précision brute
      reaction: 70,                  // Temps de réaction
      gameSense: 60,                 // Compréhension du jeu
      aggression: 55,                // Tendance à chercher duels
      discipline: 65,                // Respect des strats
      communication: 70,             // Partage d'info
      clutch: 50,                    // Performance 1vX
      utility: 60,                   // Maîtrise des utilitaires
    };
    
    // ========== PATHFINDING ==========
    this.path = [];                 // Chemin actuel (array de {pos, climbing})
    this.currentPathIndex = 0;
    this.pathUpdateInterval = 30;   // Update le path tous les 30 ticks
    this.lastPathUpdateTick = 0;

    // ========== VERTICALITÉ (échelles / plateformes / franchissement) ==========
    this.baseGroundY = 0;           // Altitude du niveau actuel (0 = sol, 3 = plateforme, etc.)
    this.climbing = null;           // { fromY, toY, elapsed, duration } pendant une escalade
    this.vaulting = null;           // { elapsed, duration, height } pendant un saut par-dessus un obstacle bas
    
    // ========== VISION & AWARENESS ==========
    this.fov = Math.PI * 0.75;      // Field of view (radians)
    this.viewDistance = 50;         // Distance de détection
    this.enemiesSpotted = [];       // Enemies currently visible
    this.lastEnemyInfo = [];        // Recent enemy info from teammates
    this.visionLines = [];          // Pour debug
    
    // ========== COMBAT ==========
    this.combat = new CombatSystem(this);
    this.targetEnemy = null;        // Ennemi actuellement en duel
    
    // ========== MEMORY ==========
    this.memory = {
      lastSeenEnemies: {},          // { agentId: { pos: Vec3, tick: N } }
      dangerZones: [],              // Zones dangereuses observées
      strategicHabits: {},           // Habitudes des ennemis
    };
    
    // ========== ANIMATION ==========
    this.meshGroup = null;          // Three.js Group pour cet agent
    this.headSprite = null;         // Sprite avec la tête / lettre
    this.isAnimating = false;
    
    console.log(`✅ Agent created: ${name} (${role}) on team ${side}`);
  }

  /**
   * Mettre à jour l'agent à chaque tick
   */
  update(tick, myTeam, enemyTeam) {
    if (!this.alive) return;
    
    this.stateTime++;
    
    // 1. Mettre à jour le pathfinding
    if (tick - this.lastPathUpdateTick >= this.pathUpdateInterval) {
      this.updatePath();
      this.lastPathUpdateTick = tick;
    }
    
    // 2. Détecter les ennemis visibles
    this.updateVision(enemyTeam);
    
    // 3. Mettre à jour le mouvement
    this.updateMovement();
    
    // 4. Appliquer la physique
    this.applyPhysics();
    
    // 5. Gestion d'état (décisions)
    this.updateState(tick, myTeam, enemyTeam);
  }

  /**
   * Mettre à jour le chemin vers la destination
   */
  updatePath() {
    if (!this.movingToward) {
      this.path = [];
      this.currentPathIndex = 0;
      return;
    }
    
    // Utiliser A* du navGraph (chaque waypoint est {pos, climbing})
    if (this.navGraph) {
      this.path = this.navGraph.findPath(this.position, this.movingToward);
      this.currentPathIndex = 0;
    } else {
      // Fallback : ligne droite
      this.path = [{ pos: this.movingToward.clone(), climbing: false }];
      this.currentPathIndex = 0;
    }
  }

  /**
   * Mettre à jour la vision (FOV + line of sight)
   */
  updateVision(enemyTeam) {
    this.enemiesSpotted = [];
    
    for (const enemy of enemyTeam.agents) {
      if (!enemy.alive) continue;
      
      const dist = this.position.distanceTo(enemy.position);
      if (dist > this.viewDistance) continue;  // Trop loin
      
      // Vérifier le FOV
      const toEnemy = enemy.position.clone().sub(this.position).normalize();
      const forward = new THREE.Vector3(0, 0, -1)
        .applyEuler(this.rotation);
      
      const angle = Math.acos(Math.max(-1, Math.min(1, toEnemy.dot(forward))));
      if (angle > this.fov / 2) continue;  // Hors FOV
      
      // Vérifier line-of-sight (obstacle detection)
      if (!this.hasLineOfSight(enemy.position)) continue;
      
      // Ennemi visible !
      this.enemiesSpotted.push({
        agent: enemy,
        distance: dist,
        angle: angle,
        lastSeenPos: enemy.position.clone(),
        seenTick: window.simulator?.state.tick || 0,
      });
    }
    
    // Mettre à jour la mémoire
    this.enemiesSpotted.forEach(spotted => {
      this.memory.lastSeenEnemies[spotted.agent.id] = {
        pos: spotted.lastSeenPos,
        tick: spotted.seenTick,
      };
    });
  }

  /**
   * Vérifier s'il y a une ligne de visée claire
   */
  hasLineOfSight(targetPos) {
    const cs = window.simulator?.collisionSystem;
    if (!cs) return true; // géométrie pas encore chargée : repli permissif
    return !cs.raycastBlocked(this.position, targetPos);
  }

  /**
   * Mettre à jour le mouvement (suivre le path)
   */
  updateMovement() {
    // Une escalade est en cours : pas de mouvement horizontal, applyPhysics gère la montée
    if (this.climbing) {
      this.moveDirection.set(0, 0, 0);
      this.velocity.set(0, 0, 0);
      return;
    }

    if (!this.path || this.path.length === 0) {
      this.moveDirection.set(0, 0, 0);
      return;
    }
    
    const waypoint = this.path[this.currentPathIndex];
    const target = waypoint.pos;
    const toTargetXZ = new THREE.Vector3(target.x - this.position.x, 0, target.z - this.position.z);
    const distXZ = toTargetXZ.length();
    
    // Si on a atteint le waypoint (en x/z), passer au suivant — ou démarrer l'escalade
    const waypointThreshold = waypoint.climbing ? 0.6 : 0.5;
    if (distXZ < waypointThreshold) {
      if (waypoint.climbing && Math.abs(this.position.y - target.y) > 0.15) {
        // Arrivé au pied (ou au sommet) de l'échelle : démarrer l'escalade
        const distance = Math.abs(target.y - this.position.y);
        this.climbing = {
          fromY: this.position.y,
          toY: target.y,
          elapsed: 0,
          duration: Math.max(0.6, distance * 0.4),  // grimper prend du temps
        };
        this.moveDirection.set(0, 0, 0);
        return;
      }
      this.currentPathIndex++;
      if (this.currentPathIndex >= this.path.length) {
        this.path = [];
        this.moveDirection.set(0, 0, 0);
        return;
      }
      return;
    }
    
    // Calculer la direction de mouvement (horizontale)
    this.moveDirection = toTargetXZ.normalize();

    // Franchir un mini-mur / une caisse basse sans détour de pathfinding :
    // on détecte l'obstacle "vault" devant l'agent et on déclenche un hop visuel
    if (!this.vaulting && window.simulator?.collisionSystem) {
      const obstacle = window.simulator.collisionSystem.findVaultableAhead(this.position, this.moveDirection);
      if (obstacle) {
        this.vaulting = {
          elapsed: 0,
          duration: 0.45,
          height: Math.min(1.3, (obstacle.yTop - obstacle.yBase) + 0.15),
        };
      }
    }
    
    // Appliquer les stats (aggression affecte la vitesse)
    let speedFactor = 1.0;
    if (this.state === 'COMBAT' && this.targetEnemy) {
      speedFactor = 0.7;  // Plus lent en combat
    }
    if (this.stats.aggression > 70) {
      speedFactor *= 1.15;  // Agressifs vont plus vite
    }
    if (this.vaulting) {
      speedFactor *= 0.6;  // ralenti pendant le saut
    }
    
    this.velocity = this.moveDirection.multiplyScalar(
      window.simulator?.config?.agentMoveSpeedBase * speedFactor || 5.5
    );
  }

  /**
   * Appliquer la physique et mettre à jour la position
   */
  applyPhysics() {
    // ========== ESCALADE (échelle) ==========
    if (this.climbing) {
      this.climbing.elapsed += 1 / 60;
      const t = Math.min(1, this.climbing.elapsed / this.climbing.duration);
      this.position.y = this.climbing.fromY + (this.climbing.toY - this.climbing.fromY) * t;

      if (t >= 1) {
        this.position.y = this.climbing.toY;
        this.baseGroundY = this.climbing.toY;
        this.climbing = null;
        this.currentPathIndex++;
        if (!this.path || this.currentPathIndex >= this.path.length) {
          this.path = [];
        }
      }
      return; // pas de déplacement horizontal pendant l'escalade
    }

    // Appliquer la vélocité horizontale
    this.position.add(this.velocity.clone().multiplyScalar(1 / 60));  // Normaliser pour 60 FPS

    // ========== SAUT PAR-DESSUS UN OBSTACLE BAS (mini-mur, caisse) ==========
    if (this.vaulting) {
      this.vaulting.elapsed += 1 / 60;
      const t = Math.min(1, this.vaulting.elapsed / this.vaulting.duration);
      const arc = Math.sin(t * Math.PI) * this.vaulting.height;
      this.position.y = this.baseGroundY + arc;

      if (t >= 1) {
        this.position.y = this.baseGroundY;
        this.vaulting = null;
      }
    } else {
      this.position.y = this.baseGroundY;
    }

    // ========== COLLISIONS (repousser hors des murs bloquants) ==========
    if (window.simulator?.collisionSystem) {
      window.simulator.collisionSystem.resolveCollision(this.position, this.velocity, 0.35);
    }
    
    // Faire face à la direction de mouvement (si on bouge)
    if (this.velocity.length() > 0.1) {
      const targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
      this.smoothRotateToward(targetYaw, 0.1);
    }
  }

  /**
   * Rotation fluide vers un angle (interpolation)
   */
  smoothRotateToward(targetYaw, speed) {
    const diff = targetYaw - this.rotation.y;
    const shortestAngle = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.rotation.y += shortestAngle * speed;
  }

  /**
   * Gestion de l'état et des décisions
   */
  updateState(tick, myTeam, enemyTeam) {
    switch (this.state) {
      case 'IDLE':
        this.stateIdle(tick, myTeam, enemyTeam);
        break;
      case 'MOVING':
        this.stateMoving(tick, myTeam, enemyTeam);
        break;
      case 'COMBAT':
        this.stateCombat(tick, myTeam, enemyTeam);
        break;
      case 'DEAD':
        // Reste mort
        break;
    }
  }

  /**
   * État IDLE — pas d'action
   */
  stateIdle(tick, myTeam, enemyTeam) {
    // Si on voit un ennemi, passer en COMBAT
    if (this.enemiesSpotted.length > 0) {
      this.targetEnemy = this.enemiesSpotted[0].agent;
      this.state = 'COMBAT';
      return;
    }
    
    // Sinon, choisir une destination tactique
    if (this.stateTime > 300 && Math.random() < 0.3) {
      const strategyPoint = this.chooseStrategicPosition(myTeam, enemyTeam);
      this.movingToward = strategyPoint;
      this.state = 'MOVING';
    }
  }

  /**
   * État MOVING — en déplacement
   */
  stateMoving(tick, myTeam, enemyTeam) {
    // Si on voit un ennemi, combattre
    if (this.enemiesSpotted.length > 0) {
      this.targetEnemy = this.enemiesSpotted[0].agent;
      this.state = 'COMBAT';
      this.movingToward = null;
      return;
    }
    
    // Si on a atteint la destination, revenir à IDLE
    if (!this.movingToward || 
        this.position.distanceTo(this.movingToward) < 1.0) {
      this.movingToward = null;
      this.state = 'IDLE';
      this.stateTime = 0;
    }
  }

  /**
   * État COMBAT — en duel
   */
  stateCombat(tick, myTeam, enemyTeam) {
    if (!this.targetEnemy || !this.targetEnemy.alive) {
      this.targetEnemy = null;
      // Regarder si d'autres ennemis sont visibles
      if (this.enemiesSpotted.length > 0) {
        this.targetEnemy = this.enemiesSpotted[0].agent;
      } else {
        this.state = 'IDLE';
        this.stateTime = 0;
      }
      return;
    }
    
    // Se tourner vers l'ennemi
    const toEnemy = this.targetEnemy.position.clone()
      .sub(this.position)
      .normalize();
    const targetYaw = Math.atan2(toEnemy.x, toEnemy.z);
    this.smoothRotateToward(targetYaw, 0.2);
    
    // Tirer si l'angle est bon
    if (this.canShoot()) {
      this.shoot(this.targetEnemy);
    }
  }

  /**
   * Peut-on tirer sur la cible ?
   */
  canShoot() {
    if (!this.targetEnemy) return false;
    
    const toEnemy = this.targetEnemy.position.clone()
      .sub(this.position)
      .normalize();
    const forward = new THREE.Vector3(0, 0, -1)
      .applyEuler(this.rotation);
    
    const angle = Math.acos(Math.max(-1, Math.min(1, toEnemy.dot(forward))));
    return angle < 0.1;  // Dans un petit cône devant
  }

  /**
   * Tirer sur un ennemi
   */
  shoot(target) {
    const currentTick = window.simulator?.state?.tick || 0;
    this.combat.shootAt(target, currentTick);
  }

  /**
   * Prendre des dégâts
   */
  takeDamage(amount) {
    if (!this.alive) return;
    
    let remaining = amount;
    
    // Soustraction d'abord de l'armure
    if (this.shield > 0) {
      const shieldDamage = Math.min(this.shield, remaining);
      this.shield -= shieldDamage;
      remaining -= shieldDamage;
    }
    
    // Puis de la vie
    if (remaining > 0) {
      this.hp -= remaining;
      if (this.hp <= 0) {
        this.die();
      }
    }
  }

  /**
   * Mourir
   */
  die() {
    this.alive = false;
    this.state = 'DEAD';
    this.velocity.set(0, 0, 0);
    console.log(`☠️ ${this.name} is dead`);
  }

  /**
   * Choisir une position stratégique basée sur les stats et la phase
   */
  chooseStrategicPosition(myTeam, enemyTeam) {
    // Pour l'instant, position aléatoire
    const x = Math.random() * 40 - 20;
    const z = Math.random() * 40 - 20;
    return new THREE.Vector3(x, 0, z);
  }

  /**
   * Spawn l'agent (respawn à la fin du round)
   */
  spawn(spawnPoint) {
    this.position = spawnPoint.clone();
    this.baseGroundY = spawnPoint.y;
    this.climbing = null;
    this.vaulting = null;
    this.hp = this.maxHp;
    this.shield = this.maxShield;
    this.alive = true;
    this.state = 'IDLE';
    this.stateTime = 0;
    this.velocity.set(0, 0, 0);
  }

  /**
   * Créer la représentation visuelle 3D
   */
  createMesh() {
    this.meshGroup = new THREE.Group();
    
    // Corps (cylindre)
    const bodyGeo = new THREE.CapsuleGeometry(0.35, 1.6, 4, 8);
    const teamColor = this.side === 'ATTACK' ? 0xff6a6a : 0x4ecdc4;
    const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    this.meshGroup.add(body);
    
    // Tête (sphère + lettre)
    const headGeo = new THREE.SphereGeometry(0.25, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ 
      color: teamColor,
      emissive: teamColor,
      emissiveIntensity: 0.3
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.1;
    head.castShadow = true;
    this.meshGroup.add(head);
    
    // Label texte
    const letter = this.name.charAt(0).toUpperCase();
    this.headSprite = this.createTextSprite(letter, 
      this.side === 'ATTACK' ? '#ff6a6a' : '#4ecdc4', 
      '#fff'
    );
    this.headSprite.position.y = 1.1;
    this.meshGroup.add(this.headSprite);
    
    this.meshGroup.position.copy(this.position);
    
    return this.meshGroup;
  }

  /**
   * Créer un sprite texte 3D
   */
  createTextSprite(text, bgColor, textColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Fond
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    
    // Texte
    ctx.fillStyle = textColor;
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, sizeAttenuation: true })
    );
    sprite.scale.set(0.5, 0.5, 1);
    
    return sprite;
  }
}
