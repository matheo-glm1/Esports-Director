/**
 * ============================================================
 * AI CORE — Moteur principal de simulation Valorant
 * ============================================================
 * 
 * Gère :
 * - La boucle de simulation (tick-based, 60 ticks/sec)
 * - L'état global du match (round, phase, économie, etc.)
 * - La création et gestion des équipes
 * - La progression des rounds
 * - Les événements du match
 */

'use strict';

class AISimulator {
  constructor() {
    // ========== CONFIGURATION ==========
    this.config = {
      tickRate: 60,                    // Ticks par seconde
      mapName: 'Zenith',
      maxRounds: 13,
      roundDurationSec: 100,           // Durée max d'un round (hors clutch)
      agentMoveSpeedBase: 5.5,         // m/tick (Valorant ≈ 5.5 m/s)
      agentRotateSpeedRad: 0.1,        // rad/tick (rotation fluide)
    };

    // ========== STATE GLOBAL ==========
    this.state = {
      running: false,
      paused: false,
      tick: 0,
      roundNumber: 0,
      phase: 'WAITING',                // WAITING | BUY | SETUP | EXECUTION | POST_PLANT | RESULT
      
      // Scores
      scoreTallyA: 0,                  // Rounds gagnés Attaque
      scoreTallyD: 0,                  // Rounds gagnés Défense
      
      // Économie
      economyA: { credits: 5000, buys: [] },
      economyD: { credits: 5000, buys: [] },
      
      // Événements
      events: [],
      kills: [],
      
      // Temps
      roundStartTime: 0,
      roundElapsed: 0,
      roundResult: null,               // 'ATK_WIN' | 'DEF_WIN'
    };

    // ========== TEAMS ==========
    this.teamAtk = null;              // Team { agents: [], economy: {} }
    this.teamDef = null;
    
    // ========== THREEJS RENDERER ==========
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.canvas = null;

    // ========== SYSTÈME DE PATHFINDING ==========
    this.navGraph = null;             // NavigationGraph instance
    this.collisionSystem = null;      // CollisionSystem instance
    this.mapColliders = [];
    this.mapLadders = [];
    this.mapFloorLevels = new Set([0]);

    // ========== RENDER SYSTEM ==========
    this.renderSystem = null;

    // ========== TIME CONTROL ==========
    this.timeScale = 1.0;             // 1.0 = vitesse normale
    this.deltaTime = 0;

    // ========== CALLBACKS UI ==========
    this.onStateChanged = null;
    this.onEventLogged = null;

    // Global reference
    window.simulator = this;
  }

  /**
   * Initialisation complète du simulateur
   */
  async init() {
    console.log('🎮 Initialisation du simulateur Valorant...');
    
    try {
      // 1. Initialiser Three.js
      this.initRenderer();
      
      // 2. Charger la carte Zenith (colliders + échelles + niveaux)
      this.loadMapZenith();

      // 2bis. Système de collisions (murs bloquants vs mini-murs/caisses franchissables)
      this.collisionSystem = new CollisionSystem();
      this.collisionSystem.colliders = this.getMapColliders();
      
      // 3. Créer le graphe de navigation (multi-niveaux, relié par les échelles)
      this.navGraph = new NavigationGraph();
      this.navGraph.generateFromMap(this.getMapColliders(), {
        floors: [...this.mapFloorLevels].map(y => ({ y })),
        ladders: this.mapLadders,
      });
      
      // 4. Créer les équipes
      this.createTeams();
      
      // 5. Initialiser le render system
      this.renderSystem = new RenderSystem(this.scene);
      
      // 6. Ajouter les agents au rendu
      this.teamAtk.agents.forEach(agent => this.renderSystem.addAgent(agent));
      this.teamDef.agents.forEach(agent => this.renderSystem.addAgent(agent));
      
      // 7. Attacher les event listeners UI
      this.attachUIListeners();
      
      // 8. Démarrer la boucle de rendu
      this.startRenderLoop();
      
      // 9. Afficher prêt
      this.log('✅ Simulateur prêt !', 'info');
      this.updateUI();
    } catch (e) {
      console.error('❌ Erreur initialisation:', e);
      this.log(`❌ Erreur: ${e.message}`, 'error');
    }
  }

  /**
   * Initialiser le moteur Three.js
   */
  initRenderer() {
    this.canvas = document.getElementById('canvas3d');
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: this.canvas, 
      antialias: true, 
      alpha: false 
    });
    
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x0b0d12);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowShadowMap;
    
    // Scène
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d12);
    this.scene.fog = new THREE.Fog(0x0b0d12, 80, 200);
    
    // Lights
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x1a1a1a, 1.0);
    this.scene.add(hemi);
    
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(60, 100, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.far = 300;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    this.scene.add(sun);
    
    // Caméra (vue spectateur)
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
    this.camera.position.set(15, 35, 45);
    this.camera.lookAt(15, 0, 0);
    
    console.log('✅ Three.js initialized');
  }

  /**
   * Charger la carte Zenith depuis les données réelles (MAP_DATA / zenith.json).
   * Construit à la fois le rendu 3D basique ET les colliders (avec hauteur
   * réelle) utilisés par le pathfinding / les collisions.
   */
  loadMapZenith() {
    // Dimensions de base des assets (issues du catalogue de l'éditeur de map)
    const ASSET_SIZE = {
      floor_pave: [4, 0.15, 4], floor_wood: [4, 0.15, 4], floor_grass: [4, 0.15, 4],
      wall_wood: [4, 3, 0.3], wall_bamboo: [4, 2.6, 0.25],
      cover_crate: [1.4, 1.4, 1.4], prop_crate: [0.6, 0.6, 0.6], prop_barrel: [0.6, 0.8, 0.6],
      vert_ladder: [0.25, 3, 0.25],
    };
    const FLOOR_COLORS = { floor_wood: 0x8a6a4a, floor_grass: 0x4a7a4a, floor_pave: 0x9aa0a8 };

    this.mapColliders = [];   // { pos, size, rotY, yBase, yTop, type: 'block'|'vault' }
    this.mapLadders = [];     // { pos, baseY, topY }
    this.mapFloorLevels = new Set([0]);

    const mapData = (typeof MAP_DATA !== 'undefined' && MAP_DATA.length) ? MAP_DATA : [];

    mapData.forEach(o => {
      const id = o.assetId;
      const base = ASSET_SIZE[id];
      if (!base) return; // props décoratifs (arbres, statues...) ignorés pour la nav/collision

      const scl = o.scl || [1, 1, 1];
      const rotY = (o.rot && o.rot[1]) || 0;
      const pos = new THREE.Vector3(o.pos[0], o.pos[1], o.pos[2]);

      // ---- Sols (définissent les niveaux verticaux marchables) ----
      if (id.startsWith('floor_')) {
        this.mapFloorLevels.add(Math.round(pos.y * 100) / 100);

        const [w, h, d] = base;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(w * scl[0], h, d * scl[2]),
          new THREE.MeshStandardMaterial({ color: o.color || FLOOR_COLORS[id] || 0x888888, roughness: 0.9 })
        );
        mesh.position.copy(pos);
        mesh.rotation.y = rotY;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        return;
      }

      // ---- Échelle (liaison verticale entre deux niveaux) ----
      if (id === 'vert_ladder') {
        const [w, h, d] = base;
        const height = h * scl[1];
        this.mapLadders.push({ pos: pos.clone(), baseY: pos.y, topY: pos.y + height });

        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(w, height, d),
          new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 })
        );
        mesh.position.set(pos.x, pos.y + height / 2, pos.z);
        mesh.rotation.y = rotY;
        this.scene.add(mesh);
        return;
      }

      // ---- Murs / caisses / barils : colliders classés bloquant vs franchissable ----
      if (id.startsWith('wall_') || id === 'cover_crate' || id === 'prop_crate' || id === 'prop_barrel') {
        const [bw, bh, bd] = base;
        const w = bw * scl[0], h = bh * scl[1], d = bd * scl[2];
        const yBase = pos.y;

        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({ color: o.color || 0x8b7355, roughness: 0.8 })
        );
        mesh.position.set(pos.x, yBase + h / 2, pos.z);
        mesh.rotation.y = rotY;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        this.mapColliders.push({
          pos: pos.clone(),
          size: new THREE.Vector3(w, h, d),
          rotY,
          yBase,
          yTop: yBase + h,
          type: h <= VAULT_HEIGHT_MAX ? 'vault' : 'block',
        });
      }
    });

    // Filet de sécurité : si aucune donnée de map n'est disponible, sol + obstacle de test
    if (mapData.length === 0) {
      const groundGeo = new THREE.PlaneGeometry(100, 100);
      const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.95 });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);
      this.addTestObstacles();
    }

    const nBlock = this.mapColliders.filter(c => c.type === 'block').length;
    const nVault = this.mapColliders.filter(c => c.type === 'vault').length;
    console.log(`✅ Map Zenith chargée : ${this.mapColliders.length} colliders (${nBlock} bloquants, ${nVault} franchissables), ${this.mapLadders.length} échelle(s), niveaux: [${[...this.mapFloorLevels].join(', ')}]`);
  }

  /**
   * Ajouter des obstacles de test (caisses, murs simples) — filet de sécurité
   * utilisé uniquement si MAP_DATA est indisponible.
   */
  addTestObstacles() {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1.5, 3),
      new THREE.MeshStandardMaterial({ color: 0x8b7355 })
    );
    crate.position.set(15, 0.75, 0);
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.scene.add(crate);

    this.mapColliders.push({
      pos: new THREE.Vector3(15, 0, 0),
      size: new THREE.Vector3(3, 1.5, 3),
      rotY: 0, yBase: 0, yTop: 1.5, type: 'block',
    });
  }

  /**
   * Retourner les colliders de la map pour le pathfinding
   */
  getMapColliders() {
    return this.mapColliders || [];
  }

  /**
   * Créer les deux équipes (5v5)
   */
  createTeams() {
    this.teamAtk = new Team('Attackers', 'ATTACK');
    this.teamDef = new Team('Defenders', 'DEFENSE');
    
    // Créer les moteurs de stratégie
    this.teamAtk.strategyEngine = new StrategyEngine(this.teamAtk);
    this.teamDef.strategyEngine = new StrategyEngine(this.teamDef);
    
    // Spawn points
    const spawnAtkPoints = [
      new THREE.Vector3(-25, 0, -20),
      new THREE.Vector3(-25, 0, -25),
      new THREE.Vector3(-20, 0, -25),
      new THREE.Vector3(-20, 0, -20),
      new THREE.Vector3(-22.5, 0, -22.5),
    ];
    
    const spawnDefPoints = [
      new THREE.Vector3(25, 0, 20),
      new THREE.Vector3(25, 0, 25),
      new THREE.Vector3(20, 0, 25),
      new THREE.Vector3(20, 0, 20),
      new THREE.Vector3(22.5, 0, 22.5),
    ];
    
    // Créer 5 agents par équipe avec rôles variés
    const roles = ['Duelist', 'Initiator', 'Controller', 'Sentinel', 'Flex'];
    
    for (let i = 0; i < 5; i++) {
      const agentA = new Agent(
        `atk_${i}`,
        `Attacker ${i + 1}`,
        roles[i],
        this.navGraph,
        'ATTACK'
      );
      agentA.spawn(spawnAtkPoints[i]);
      this.teamAtk.addAgent(agentA);
      
      const agentD = new Agent(
        `def_${i}`,
        `Defender ${i + 1}`,
        roles[i],
        this.navGraph,
        'DEFENSE'
      );
      agentD.spawn(spawnDefPoints[i]);
      this.teamDef.addAgent(agentD);
    }
    
    console.log('✅ Équipes créées (5v5)');
  }

  /**
   * Attacher les listeners UI
   */
  attachUIListeners() {
    document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
    document.getElementById('btn-reset').addEventListener('click', () => this.reset());
    document.getElementById('btn-debug').addEventListener('click', () => this.toggleDebug());
    document.getElementById('speed-slider').addEventListener('input', (e) => {
      this.timeScale = parseFloat(e.target.value);
      document.getElementById('speed-display').textContent = this.timeScale.toFixed(1) + 'x';
    });
  }

  /**
   * Boucle de rendu (requestAnimationFrame)
   */
  startRenderLoop() {
    const loop = () => {
      if (!this.state.paused && this.state.running) {
        this.tick();
      }
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /**
   * Une itération de simulation (1 tick)
   */
  tick() {
    this.state.tick++;
    
    // Contrôle de la phase
    switch (this.state.phase) {
      case 'WAITING':
        this.phaseWaiting();
        break;
      case 'BUY':
        this.phaseBuy();
        break;
      case 'SETUP':
        this.phaseSetup();
        break;
      case 'EXECUTION':
        this.phaseExecution();
        break;
      case 'POST_PLANT':
        this.phasePostPlant();
        break;
      case 'RESULT':
        this.phaseResult();
        break;
    }
    
    // Update agents
    this.updateAgents();
    
    // Update render system
    if (this.renderSystem) {
      this.teamAtk.agents.forEach(agent => 
        this.renderSystem.updateAgent(agent)
      );
      this.teamDef.agents.forEach(agent => 
        this.renderSystem.updateAgent(agent)
      );
    }
    
    // Update UI tous les 30 ticks (~2x par sec)
    if (this.state.tick % 30 === 0) {
      this.updateUI();
    }
  }

  /**
   * Phase d'attente (avant un round)
   */
  phaseWaiting() {
    if (this.state.roundNumber >= this.config.maxRounds) {
      this.endMatch();
      return;
    }
    
    this.state.roundNumber++;
    this.state.phase = 'BUY';
    this.state.roundStartTime = this.state.tick;
    
    // Respawn les agents à leurs spawns
    const spawnAtkPoints = [
      new THREE.Vector3(-25, 0, -20),
      new THREE.Vector3(-25, 0, -25),
      new THREE.Vector3(-20, 0, -25),
      new THREE.Vector3(-20, 0, -20),
      new THREE.Vector3(-22.5, 0, -22.5),
    ];
    
    const spawnDefPoints = [
      new THREE.Vector3(25, 0, 20),
      new THREE.Vector3(25, 0, 25),
      new THREE.Vector3(20, 0, 25),
      new THREE.Vector3(20, 0, 20),
      new THREE.Vector3(22.5, 0, 22.5),
    ];
    
    this.teamAtk.agents.forEach((a, i) => a.spawn(spawnAtkPoints[i]));
    this.teamDef.agents.forEach((a, i) => a.spawn(spawnDefPoints[i]));
    
    this.log(`📍 Round ${this.state.roundNumber} started`, 'info');
  }

  /**
   * Phase d'achat d'armes/utilitaires
   */
  phaseBuy() {
    // Pour l'instant, tout le monde achète par défaut
    // Plus tard : logique d'économie réelle
    
    // Après 3 secondes, passer à SETUP
    const elapsed = (this.state.tick - this.state.roundStartTime) / this.config.tickRate;
    if (elapsed >= 3) {
      this.state.phase = 'SETUP';
    }
  }

  /**
   * Phase de setup (spawn + positionnement initial)
   */
  phaseSetup() {
    const elapsed = (this.state.tick - this.state.roundStartTime) / this.config.tickRate;
    
    if (elapsed < 0.5) {
      // Première demi-seconde : sélectionner les stratégies et positionner
      if (this.state.tick === this.state.roundStartTime + 1) {
        // Sélectionner stratégies
        this.teamAtk.currentStrategy = this.teamAtk.strategyEngine.selectStrategy(
          this.state.roundNumber,
          this.state.economyA.credits,
          this.state.roundResult,
          this.state.scoreTallyA,
          this.state.scoreTallyD
        );
        
        this.teamDef.currentStrategy = null;  // Défense réactive
        
        // Positionner les agents selon la stratégie
        this.positionAgentsForStrategy(this.teamAtk);
      }
    }
    
    if (elapsed >= 5) {
      this.state.phase = 'EXECUTION';
      this.log('⚔️ Execution started!', 'info');
    }
  }

  /**
   * Positionner les agents selon la stratégie
   */
  positionAgentsForStrategy(team) {
    if (!team.currentStrategy || !this.navGraph) return;
    
    const strategy = team.currentStrategy;
    const agents = team.agents.filter(a => a.alive);
    
    // Assigner des positions en fonction de la stratégie et du rôle
    agents.forEach((agent, idx) => {
      let targetPos = null;
      
      if (strategy.name.includes('Rush A')) {
        targetPos = this.navGraph.getPositionForSite('A');
      } else if (strategy.name.includes('Rush B')) {
        targetPos = this.navGraph.getPositionForSite('B');
      } else if (strategy.name.includes('Split')) {
        targetPos = idx < 3 ? 
          this.navGraph.getPositionForSite('A') : 
          this.navGraph.getPositionForSite('B');
      } else if (strategy.name.includes('Fake A')) {
        targetPos = idx < 4 ? 
          this.navGraph.getPositionForSite('A') : 
          this.navGraph.getPositionForSite('B');
      } else if (strategy.name.includes('Mid')) {
        targetPos = new THREE.Vector3(0, 0, 0).add(
          new THREE.Vector3((Math.random() - 0.5) * 15, 0, (Math.random() - 0.5) * 15)
        );
      } else {
        // Default : spread positions
        targetPos = this.navGraph.getRandomStrategicPosition();
      }
      
      if (targetPos) {
        agent.movingToward = targetPos;
      }
    });
  }

  /**
   * Phase d'exécution (jeu principal)
   */
  phaseExecution() {
    const elapsed = (this.state.tick - this.state.roundStartTime) / this.config.tickRate;
    
    // Vérifier si quelqu'un a gagné le round
    const atkAlive = this.teamAtk.agents.filter(a => a.alive).length;
    const defAlive = this.teamDef.agents.filter(a => a.alive).length;
    
    // Spike planté ?
    const spikeDown = this.teamAtk.spike?.planted || false;
    
    // Conditions de fin :
    // 1. Tous les défenseurs éliminés
    if (defAlive === 0) {
      this.state.phase = 'RESULT';
      this.endRound('ATK_ELIMINATED_ALL');
      return;
    }
    
    // 2. Tous les attaquants éliminés
    if (atkAlive === 0) {
      this.state.phase = 'RESULT';
      this.endRound('DEF_ELIMINATED_ALL');
      return;
    }
    
    // 3. Temps écoulé ou spike armé
    if (elapsed >= this.config.roundDurationSec) {
      this.state.phase = 'RESULT';
      if (spikeDown) {
        this.endRound('ATK_SPIKE_DETONATED');
      } else {
        this.endRound('DEF_TIME_EXPIRED');
      }
      return;
    }le match
   */
  endMatch() {
    this.state.running = false;
    this.state.paused = true;
    
    let winner = '';
    if (this.state.scoreTallyA > this.state.scoreTallyD) {
      winner = 'ATTACKERS WIN!';
    } else if (this.state.scoreTallyD > this.state.scoreTallyA) {
      winner = 'DEFENDERS WIN!';
    } else {
      winner = 'MATCH TIED!';
    }
    
    this.log(`🏆 MATCH END: ${winner} (${this.state.scoreTallyA}-${this.state.scoreTallyD})`, 'kill');
    document.getElementById('btn-play').textContent = '▶ Play';
    document.getElementById('btn-play').classList.remove('playing
  phaseResult() {
    const elapsed = (this.state.tick - this.state.roundStartTime) / this.config.tickRate;
    if (elapsed >= 8) {
      this.state.phase = 'WAITING';
    }
  }

  /**
   * Terminer un round
   */
  endRound(reason) {
    let winner = '';
    if (reason === 'ATK_ELIMINATED_ALL' || reason === 'ATK_SPIKE_DETONATED') {
      this.state.scoreTallyA++;
      winner = 'ATTACKERS';
      this.state.roundResult = 'ATK_WIN';
    } else {
      this.state.scoreTallyD++;
      winner = 'DEFENDERS';
      this.state.roundResult = 'DEF_WIN';
    }
    
    this.log(`🏆 ${winner} wins round ${this.state.roundNumber}: ${reason}`, 'kill');
  }

  /**
   * Update tous les agents
   */
  updateAgents() {
    this.teamAtk.agents.forEach(agent => {
      if (agent.alive) {
        agent.update(this.state.tick, this.teamAtk, this.teamDef);
      }
    });
    
    this.teamDef.agents.forEach(agent => {
      if (agent.alive) {
        agent.update(this.state.tick, this.teamDef, this.teamAtk);
      }
    });
  }

  /**
   * Rendu Three.js
   */
  render() {
    // Renderer.render(scene, camera)
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Basculer play/pause
   */
  togglePlay() {
    if (!this.state.running) {
      this.state.running = true;
      this.state.paused = false;
      document.getElementById('btn-play').classList.add('playing');
      document.getElementById('btn-play').textContent = '⏸ Pause';
      this.log('▶️ Simulation started', 'info');
    } else if (!this.state.paused) {
      this.state.paused = true;
      document.getElementById('btn-play').classList.remove('playing');
      document.getElementById('btn-play').textContent = '▶ Play';
      this.log('⏸ Simulation paused', 'info');
    } else {
      this.state.paused = false;
      document.getElementById('btn-play').classList.add('playing');
      document.getElementById('btn-play').textContent = '⏸ Pause';
      this.log('▶️ Simulation resumed', 'info');
    }
  }

  /**
   * Réinitialiser la simulation
   */
  reset() {
    this.state = {
      running: false,
      paused: false,
      tick: 0,
      roundNumber: 0,
      phase: 'WAITING',
      scoreTallyA: 0,
      scoreTallyD: 0,
      economyA: { credits: 5000, buys: [] },
      economyD: { credits: 5000, buys: [] },
      events: [],
      kills: [],
      roundStartTime: 0,
      roundElapsed: 0,
      roundResult: null,
    };
    this.createTeams();
    document.getElementById('btn-play').classList.remove('playing');
    document.getElementById('btn-play').textContent = '▶ Play';
    this.log('🔄 Simulation reset', 'info');
    this.updateUI();
  }

  /**
   * Afficher/masquer le debug
   */
  toggleDebug() {
    // À implémenter
    this.log('🐛 Debug toggled', 'info');
  }

  /**
   * Mettre à jour l'interface
   */
  updateUI() {
    // Header stats
    document.getElementById('stat-round').textContent = 
      `${this.state.roundNumber} / ${this.config.maxRounds}`;
    document.getElementById('stat-phase').textContent = this.state.phase;
    document.getElementById('stat-tick').textContent = this.state.tick;
    
    // Scores
    document.getElementById('score-atk').textContent = this.state.scoreTallyA;
    document.getElementById('score-def').textContent = this.state.scoreTallyD;
    document.getElementById('hud-round').textContent = 
      `Round ${this.state.roundNumber} — ${this.state.phase}`;
    
    // Rosters
    this.updateRoster('roster-atk', this.teamAtk);
    this.updateRoster('roster-def', this.teamDef);
  }

  /**
   * Mettre à jour le roster d'une équipe
   */
  updateRoster(elementId, team) {
    const container = document.getElementById(elementId);
    container.innerHTML = team.agents.map(agent => `
      <div class="agent-card">
        <div class="agent-name">${agent.name}</div>
        <div class="agent-role">${agent.role}</div>
        <div class="agent-hp">
          <div class="hp-bar">
            <div class="hp-fill" style="width: ${agent.alive ? (agent.hp / agent.maxHp * 100) : 0}%"></div>
          </div>
          <span>${agent.alive ? agent.hp : '☠'}/${agent.maxHp}</span>
        </div>
      </div>
    `).join('');
  }

  /**
   * Logger un événement
   */
  log(message, type = 'info') {
    const event = { tick: this.state.tick, message, type };
    this.state.events.push(event);
    
    const logEl = document.getElementById('event-log');
    if (logEl) {
      logEl.textContent = message;
      logEl.className = `event-log ${type}`;
    }
    
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

/**
 * ============================================================
 * TEAM — Représente une équipe (5 agents)
 * ============================================================
 */
class Team {
  constructor(name, side) {
    this.name = name;
    this.side = side;                  // 'ATTACK' | 'DEFENSE'
    this.agents = [];
    this.spike = null;                 // { planted: false, location: null, timeRemaining: 0 }
    this.economy = {
      credits: 5000,
      buys: []
    };
    this.currentStrategy = null;       // Stratégie active
    this.strategyEngine = null;        // StrategyEngine instance
  }

  addAgent(agent) {
    this.agents.push(agent);
  }

  getAliveCount() {
    return this.agents.filter(a => a.alive).length;
  }

  getAllDead() {
    return this.agents.every(a => !a.alive);
  }
}
