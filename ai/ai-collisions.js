/**
 * ============================================================
 * AI COLLISIONS — Gestion des collisions et hauteurs
 * ============================================================
 *
 * Chaque collider a désormais une hauteur réelle et un "type" :
 * - 'block' : mur plein, bâtiment... bloque le déplacement et le pathfinding.
 * - 'vault' : mini-mur, caisse, muret bas... l'agent peut sauter par-dessus
 *   sans détour de pathfinding (juste un petit hop visuel).
 *
 * Le seuil VAULT_HEIGHT_MAX détermine la limite entre les deux catégories.
 */

'use strict';

const VAULT_HEIGHT_MAX = 1.5; // hauteur max (m) qu'un agent peut franchir d'un saut

class CollisionSystem {
  constructor() {
    this.colliders = []; // { pos, size, rotY, yBase, yTop, type }
  }

  /**
   * Ajouter un collider. size.y = hauteur réelle de l'objet.
   * opts.yBase = altitude de la base (par défaut pos.y).
   */
  addCollider(pos, size, opts = {}) {
    const yBase = opts.yBase !== undefined ? opts.yBase : pos.y;
    const height = size.y;
    const collider = {
      pos,
      size,
      rotY: opts.rotY || 0,
      yBase,
      yTop: yBase + height,
      type: opts.type || (height <= VAULT_HEIGHT_MAX ? 'vault' : 'block'),
    };
    this.colliders.push(collider);
    return collider;
  }

  /**
   * Colliders bloquants qui existent au niveau vertical donné
   * (le pied de l'agent). Un mur au sol ne bloque pas un agent
   * sur une plateforme au-dessus, et inversement.
   */
  blockersAt(yLevel) {
    return this.colliders.filter(
      c => c.type === 'block' && yLevel >= c.yBase - 0.15 && yLevel < c.yTop
    );
  }

  /**
   * Collision cercle (agent) vs box (collider), avec rotation Y du collider.
   */
  checkCollision(pos, radius = 0.35) {
    return this.blockersAt(pos.y).some(c => this._circleIntersectsBox(pos, radius, c));
  }

  _circleIntersectsBox(pos, radius, c) {
    const dx = pos.x - c.pos.x;
    const dz = pos.z - c.pos.z;
    const cos = Math.cos(-c.rotY), sin = Math.sin(-c.rotY);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;

    const hx = c.size.x / 2, hz = c.size.z / 2;
    const closestX = Math.max(-hx, Math.min(hx, lx));
    const closestZ = Math.max(-hz, Math.min(hz, lz));
    const distX = lx - closestX;
    const distZ = lz - closestZ;
    return (distX * distX + distZ * distZ) < radius * radius;
  }

  /**
   * Repousse la position hors des colliders bloquants (résolution simple,
   * suffisante pour des agents qui suivent déjà un chemin valide).
   */
  resolveCollision(pos, velocity, radius = 0.35) {
    for (const c of this.blockersAt(pos.y)) {
      if (!this._circleIntersectsBox(pos, radius, c)) continue;

      const dx = pos.x - c.pos.x;
      const dz = pos.z - c.pos.z;
      const cos = Math.cos(-c.rotY), sin = Math.sin(-c.rotY);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const hx = c.size.x / 2, hz = c.size.z / 2;
      const closestX = Math.max(-hx, Math.min(hx, lx));
      const closestZ = Math.max(-hz, Math.min(hz, lz));

      let awayLocal = new THREE.Vector2(lx - closestX, lz - closestZ);
      if (awayLocal.lengthSq() < 0.0001) awayLocal.set(1, 0);
      awayLocal.normalize();

      // Reprojeter dans l'espace monde
      const cos2 = Math.cos(c.rotY), sin2 = Math.sin(c.rotY);
      const awayWorldX = awayLocal.x * cos2 - awayLocal.y * sin2;
      const awayWorldZ = awayLocal.x * sin2 + awayLocal.y * cos2;

      pos.x += awayWorldX * 0.12;
      pos.z += awayWorldZ * 0.12;

      if (velocity) {
        const dot = velocity.x * awayWorldX + velocity.z * awayWorldZ;
        if (dot < 0) {
          velocity.x -= dot * awayWorldX;
          velocity.z -= dot * awayWorldZ;
        }
      }
    }
    return pos;
  }

  /**
   * Cherche un obstacle franchissable (mini-mur, caisse) devant l'agent,
   * dans son cône de déplacement. Utilisé pour déclencher un "hop" visuel
   * sans passer par un détour de pathfinding.
   */
  findVaultableAhead(pos, moveDir, lookAhead = 1.2) {
    if (!moveDir || moveDir.lengthSq() < 0.0001) return null;
    const dir = moveDir.clone().normalize();

    let best = null;
    let bestDist = Infinity;

    for (const c of this.colliders) {
      if (c.type !== 'vault') continue;
      if (pos.y < c.yBase - 0.3 || pos.y > c.yTop + 0.3) continue; // mauvais niveau

      const toC = new THREE.Vector3(c.pos.x - pos.x, 0, c.pos.z - pos.z);
      const dist = toC.length();
      const reach = lookAhead + Math.max(c.size.x, c.size.z) / 2;
      if (dist > reach || dist < 0.0001) continue;

      const facing = toC.clone().normalize().dot(dir);
      if (facing < 0.55) continue; // pas vraiment devant l'agent

      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    return best;
  }

  /**
   * Ligne de visée bloquée entre deux points ? Seuls les colliders 'block'
   * (vrais murs) bloquent la vue — les 'vault' (caisses, mini-murs) sont
   * volontairement ignorés, cohérent avec le fait qu'on peut voir par-dessus
   * un obstacle assez bas pour être sauté.
   */
  raycastBlocked(from, to) {
    const segYMin = Math.min(from.y, to.y);
    const segYMax = Math.max(from.y, to.y);
    for (const c of this.colliders) {
      if (c.type !== 'block') continue;
      if (segYMax < c.yBase || segYMin > c.yTop) continue; // pas au même niveau
      if (this._segmentIntersectsBoxXZ(from, to, c)) return true;
    }
    return false;
  }

  /**
   * Segment (vu du dessus, X/Z) vs box rotée : reprojette le segment dans
   * l'espace local du collider (annule sa rotation Y), puis test slab AABB
   * standard. Même repère local que _circleIntersectsBox ci-dessus.
   */
  _segmentIntersectsBoxXZ(from, to, c) {
    const cos = Math.cos(-c.rotY), sin = Math.sin(-c.rotY);
    const toLocal = (p) => {
      const dx = p.x - c.pos.x, dz = p.z - c.pos.z;
      return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
    };
    const p0 = toLocal(from), p1 = toLocal(to);
    const hx = c.size.x / 2, hz = c.size.z / 2;
    const dx = p1.x - p0.x, dz = p1.z - p0.z;

    let tmin = 0, tmax = 1;
    const axes = [[p0.x, dx, -hx, hx], [p0.z, dz, -hz, hz]];
    for (const [p, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) return false; // segment parallèle à cet axe, hors du couloir
        continue;
      }
      let t1 = (lo - p) / d, t2 = (hi - p) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
    return true;
  }
}
