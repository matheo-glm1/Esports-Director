/**
 * AI NAVIGATION — Pathfinding et graphe de navigation
 *
 * Utilise A* pour trouver le chemin optimal entre deux points.
 * Supporte désormais plusieurs niveaux verticaux (ex: sol y=0,
 * plateforme y=3) reliés entre eux par des échelles (vert_ladder).
 *
 * - Les nœuds "walk" ne relient que des points du MÊME niveau.
 * - Les nœuds "ladder" relient deux niveaux différents, avec un
 *   coût de traversée plus élevé (le temps de grimper).
 * - Les colliders "vault" (mini-murs, caisses) n'obstruent PAS le
 *   graphe : l'agent les franchit d'un saut (géré côté Agent).
 */

'use strict';

class NavigationGraph {
  constructor() {
    this.nodes = [];          // THREE.Vector3 (y = niveau du nœud)
    this.edges = [];          // adjacency list (indices dans nodes)
    this.edgeCosts = new Map();   // "i-j" -> coût
    this.edgeTypes = new Map();   // "i-j" -> 'walk' | 'ladder'
    this.ladderLinks = [];    // infos brutes des liaisons d'échelle
  }

  /**
   * Générer le graphe à partir des colliders de la carte.
   * options.floors = [{ y }, ...] niveaux verticaux distincts à échantillonner
   * options.ladders = [{ pos, baseY, topY }, ...]
   */
  generateFromMap(colliders, options = {}) {
    const floors = (options.floors && options.floors.length) ? options.floors : [{ y: 0 }];
    const ladders = options.ladders || [];

    this.nodes = [];
    this.edges = [];
    this.edgeCosts = new Map();
    this.edgeTypes = new Map();
    this.ladderLinks = [];

    const gridSize = 8;
    const range = 60;

    // Un niveau par altitude distincte (arrondie) pour éviter les doublons de flottants
    const levels = [...new Set(floors.map(f => Math.round(f.y * 100) / 100))];

    levels.forEach(y => {
      for (let x = -range; x <= range; x += gridSize) {
        for (let z = -range; z <= range; z += gridSize) {
          const p = new THREE.Vector3(x, y, z);
          if (!this.isPointBlocked(p, colliders)) {
            this.nodes.push(p);
          }
        }
      }
    });

    // Waypoints stratégiques importants (sites A/B, mid) au niveau du sol
    if (levels.includes(0)) {
      const importantPoints = [
        new THREE.Vector3(2, 0, 34),      // Site A
        new THREE.Vector3(18, 0, -23.5),  // Site B
        new THREE.Vector3(0, 0, 0),       // Mid
      ];
      importantPoints.forEach(p => {
        if (!this.isPointBlocked(p, colliders)) this.nodes.push(p);
      });
    }

    this.buildAdjacency(colliders);
    this.linkLadders(ladders, colliders);

    console.log(`✅ Navigation graph: ${this.nodes.length} nœuds sur ${levels.length} niveau(x), ${this.ladderLinks.length} échelle(s) liée(s)`);
  }

  /**
   * Un point est bloqué s'il tombe dans un collider "bloquant" présent
   * à SON niveau vertical (un mur au sol ne bloque pas la plateforme au-dessus).
   * Les colliders "vault" (franchissables) n'obstruent jamais le graphe.
   */
  isPointBlocked(point, colliders) {
    return colliders.some(c => {
      if (c.type !== 'block') return false;
      if (point.y < c.yBase - 0.15 || point.y >= c.yTop) return false;

      // Transformer dans l'espace local du collider pour tenir compte de la rotation
      const dx = point.x - c.pos.x;
      const dz = point.z - c.pos.z;
      const rotY = c.rotY || 0;
      const cos = Math.cos(-rotY), sin = Math.sin(-rotY);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;

      return Math.abs(lx) < c.size.x / 2 && Math.abs(lz) < c.size.z / 2;
    });
  }

  /**
   * Construire le graphe d'adjacence (connecter les nœuds proches du même niveau)
   */
  buildAdjacency(colliders) {
    const maxDist = 15;
    this.edges = Array(this.nodes.length).fill(null).map(() => []);

    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        // Ne connecter que des nœuds du même niveau vertical :
        // le passage entre niveaux se fait uniquement via une échelle
        if (Math.abs(this.nodes[i].y - this.nodes[j].y) > 0.3) continue;

        const dist = this.nodes[i].distanceTo(this.nodes[j]);
        if (dist < maxDist && this.canWalkBetween(this.nodes[i], this.nodes[j], colliders)) {
          this.edges[i].push(j);
          this.edges[j].push(i);
          const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
          this.edgeCosts.set(key, dist);
          this.edgeTypes.set(key, 'walk');
        }
      }
    }
  }

  /**
   * Vérifier si on peut marcher entre deux nœuds (pas de murs bloquants)
   */
  canWalkBetween(from, to, colliders) {
    const steps = Math.ceil(from.distanceTo(to) / 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const point = new THREE.Vector3().lerpVectors(from, to, t);
      if (this.isPointBlocked(point, colliders)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Relier les niveaux entre eux via les échelles : on connecte le nœud
   * le plus proche au pied de l'échelle (baseY) au nœud le plus proche
   * en haut (topY), avec un coût de traversée qui représente le temps
   * de grimper (plus lent qu'une marche équivalente).
   */
  linkLadders(ladders, colliders) {
    ladders.forEach(l => {
      const baseNode = this.findNearestNodeAtLevel(l.pos, l.baseY);
      const topNode = this.findNearestNodeAtLevel(l.pos, l.topY);
      if (!baseNode || !topNode) return;

      const i = this.nodes.indexOf(baseNode);
      const j = this.nodes.indexOf(topNode);
      if (i < 0 || j < 0 || i === j) return;

      this.edges[i].push(j);
      this.edges[j].push(i);

      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      const climbCost = Math.abs(l.topY - l.baseY) * 4; // grimper coûte plus cher que marcher
      this.edgeCosts.set(key, climbCost);
      this.edgeTypes.set(key, 'ladder');

      this.ladderLinks.push({ pos: l.pos.clone(), baseY: l.baseY, topY: l.topY, nodeA: i, nodeB: j });
    });
  }

  /**
   * Trouver le nœud le plus proche (distance horizontale) à un niveau vertical donné
   */
  findNearestNodeAtLevel(pos, y) {
    let nearest = null;
    let minDist = Infinity;
    for (const node of this.nodes) {
      if (Math.abs(node.y - y) > 0.3) continue;
      const d = Math.hypot(node.x - pos.x, node.z - pos.z);
      if (d < minDist) {
        minDist = d;
        nearest = node;
      }
    }
    return nearest;
  }

  /**
   * Trouver le chemin entre deux points avec A*.
   * Retourne un tableau de waypoints : { pos: Vector3, climbing: boolean }
   * où climbing=true signifie "grimper une échelle pour atteindre ce waypoint".
   */
  findPath(start, end) {
    const startNode = this.findNearestNode(start);
    const endNode = this.findNearestNode(end);

    if (!startNode || !endNode) {
      return [{ pos: end.clone(), climbing: false }];
    }

    const openSet = [startNode];
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    const heuristic = (a, b) => a.distanceTo(b);

    const startIdx = this.nodes.indexOf(startNode);
    gScore.set(startIdx, 0);
    fScore.set(startIdx, heuristic(startNode, endNode));

    while (openSet.length > 0) {
      let current = openSet[0];
      let currentIdx = 0;
      let bestF = fScore.get(this.nodes.indexOf(openSet[0])) ?? Infinity;

      for (let i = 1; i < openSet.length; i++) {
        const idx = this.nodes.indexOf(openSet[i]);
        const f = fScore.get(idx) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          current = openSet[i];
          currentIdx = i;
        }
      }

      if (current === endNode) {
        // Reconstruire le chemin en marquant les segments d'échelle
        const path = [{ pos: endNode.clone(), climbing: false }];
        let currIdx = this.nodes.indexOf(current);

        while (cameFrom.has(currIdx)) {
          const prev = cameFrom.get(currIdx);
          const prevIdx = this.nodes.indexOf(prev);
          const key = `${Math.min(prevIdx, currIdx)}-${Math.max(prevIdx, currIdx)}`;
          const isLadder = this.edgeTypes.get(key) === 'ladder';

          path[0].climbing = isLadder;
          path.unshift({ pos: prev.clone(), climbing: false });

          current = prev;
          currIdx = prevIdx;
        }

        path.push({ pos: end.clone(), climbing: false });
        return path;
      }

      openSet.splice(currentIdx, 1);

      const currentIdxVal = this.nodes.indexOf(current);
      const neighbors = this.edges[currentIdxVal] || [];

      for (const neighborIdx of neighbors) {
        const neighbor = this.nodes[neighborIdx];
        const key = `${Math.min(currentIdxVal, neighborIdx)}-${Math.max(currentIdxVal, neighborIdx)}`;
        const edgeCost = this.edgeCosts.get(key) ?? current.distanceTo(neighbor);
        const tentativeG = gScore.get(currentIdxVal) + edgeCost;

        if (!gScore.has(neighborIdx) || tentativeG < gScore.get(neighborIdx)) {
          cameFrom.set(neighborIdx, current);
          gScore.set(neighborIdx, tentativeG);
          fScore.set(neighborIdx, tentativeG + heuristic(neighbor, endNode));

          if (!openSet.includes(neighbor)) {
            openSet.push(neighbor);
          }
        }
      }
    }

    // Pas de chemin trouvé, retourner ligne droite
    return [{ pos: end.clone(), climbing: false }];
  }

  /**
   * Trouver le nœud le plus proche d'une position (tous niveaux confondus,
   * en priorisant le niveau le plus proche verticalement)
   */
  findNearestNode(position) {
    let nearest = null;
    let minScore = Infinity;

    for (const node of this.nodes) {
      const dHoriz = Math.hypot(node.x - position.x, node.z - position.z);
      const dVert = Math.abs(node.y - position.y) * 3; // pénaliser un mauvais niveau
      const score = dHoriz + dVert;
      if (score < minScore) {
        minScore = score;
        nearest = node;
      }
    }

    return nearest;
  }

  /**
   * Obtenir une position stratégique au hasard (niveau sol)
   */
  getRandomStrategicPosition() {
    const groundNodes = this.nodes.filter(n => Math.abs(n.y) < 0.3);
    const pool = groundNodes.length ? groundNodes : this.nodes;
    const safeDistance = 5;
    let randomNode = pool[Math.floor(Math.random() * pool.length)];

    return randomNode.clone().add(
      new THREE.Vector3(
        (Math.random() - 0.5) * safeDistance,
        0,
        (Math.random() - 0.5) * safeDistance
      )
    );
  }

  /**
   * Obtenir une position stratégique selon le site
   */
  getPositionForSite(site) {
    if (site === 'A') {
      return new THREE.Vector3(2, 0, 34).add(
        new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10)
      );
    } else if (site === 'B') {
      return new THREE.Vector3(18, 0, -23.5).add(
        new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10)
      );
    } else {
      return this.getRandomStrategicPosition();
    }
  }
}
