# 🎮 Valorant AI Simulator — Quick Start Guide

## 🚀 Démarrage Rapide

### 1. Ouvrir le Simulateur
```
Ouvrir dans votre navigateur :
→ ai-simulator.html
```

### 2. Initialisation
- Page se charge avec le message "✅ Simulateur prêt !"
- Vous verrez :
  - **Header** : Round, Phase, Tick, Score
  - **Viewport** : Carte 3D avec les agents (Rouge = Attaque, Cyan = Défense)
  - **Right Panel** : Rosters des 2 équipes avec HP en temps réel
  - **Bottom Bar** : Event log et contrôle de vitesse

### 3. Lancer une Simulation
1. Cliquer **Play** (vert en haut)
2. La simulation commence
3. Les agents se déploient selon la stratégie choisie
4. Les rounds s'enchaînent automatiquement

### 4. Contrôles
- **Play/Pause** : Lance ou met en pause
- **Reset** : Recommencer une nouvelle partie
- **Debug** : Voir les chemins et FOV (à implémenter)
- **Speed Slider** : Vitesse (0.1x à 5x)

---

## 📊 Qu'observez-vous ?

### Round Flow
```
WAITING (1s)      → Spawn des agents
    ↓
BUY (3s)          → Sélection stratégie
    ↓
SETUP (2s)        → Positionnement
    ↓
EXECUTION (100s)  → Combat réel
    ↓
RESULT (8s)       → Affichage gagnant
    ↓
(Repeat...)
```

### Chaque Agent
- **Position** : Se déplace via pathfinding A*
- **Rotation** : Fait face à la direction de mouvement
- **Vision** : Détecte les ennemis dans FOV (120°)
- **Combat** : Tire avec imprécision + headshot
- **Santé** : Perd HP et shield quand touché

---

## 🎯 Les Stratégies (Rounds Variés)

L'IA sélectionne une stratégie différente chaque round :

| Stratégie | Intensité | Description |
|-----------|-----------|-------------|
| **Rush A** | Haute | Tous au site A rapidement |
| **Rush B** | Haute | Tous au site B rapidement |
| **Default** | Moyenne | Contrôle map puis décision |
| **Split A/B** | Moyenne | Division 3-2 entre sites |
| **Fake A→B** | Moyenne | Push A pour étirer, rotation B |
| **Mid Control** | Moyenne | Contrôler la mid |
| **Lurk+A/B** | Basse | 1 lurk, 4 attaquent |

**La répétition est évitée automatiquement** :
- Chaque stratégie a un score (wins/losses)
- Les stratégies perdantes sont moins probables
- Les stratégies répétées 3x de suite sont moins probables

---

## 👥 Les Statistiques des Agents

Chaque agent a 8 stats (0-100) qui influencent son comportement :

```
AIM        = Précision des tirs, spread control
REACTION   = Vitesse d'engagement
GAME SENSE = Décisions tactiques
AGGRESSION = Tendance à rush, challenger des duels
DISCIPLINE = Suivre les stratégies d'équipe
COMMUNICATION = Partage d'info
CLUTCH     = Performance 1vX
UTILITY    = Maîtrise des capacités (futur)
```

**Exemple** : Un agent avec `AGGRESSION: 80` cherchera plus souvent les duels et ira plus vite.

---

## 🎬 Combat Réaliste

Quand deux agents se croisent :

1. **Vision** : Vérifier si l'ennemi est en FOV + ligne de vue
2. **Aim** : L'agent vise selon sa stat AIM
3. **Tir** : Calcul du spread (imprécision)
4. **Damage** :
   - **Headshot** : 2.5x dégâts
   - **Body** : 1x dégâts
   - **Legs** : 0.75x dégâts
   - **Distance Falloff** : Moins d'effet à loin

---

## 🐛 Débogage

### Logs en Console (F12)
- Tous les événements sont loggés
- Cherchez les erreurs JavaScript
- Utilisez `window.simulator` pour accéder à l'état

### Event Log (Bottom Bar)
- Affiche le dernier événement
- Couleur rouge = kill/round end
- Couleur bleue = info

### Stats en Temps Réel
- **Right Panel** : HP et shield de chaque agent
- **Header** : Round numéro et phase actuelle

---

## 📈 Métriques à Observer

1. **Qui gagne ?** 
   - Attaques ou Défenses ?
   - Y a-t-il des tendances ?

2. **Variabilité des Stratégies**
   - Les rounds sont-ils tous différents ?
   - Quelle stratégie gagne le plus ?

3. **Duels Individuels**
   - Les agents agressifs gagnent-ils plus ?
   - L'aim affecte-t-il les résultats ?

4. **Rotations**
   - Les équipes bougent-elles réalistes ?
   - Changent-elles de site ?

---

## ⚙️ Configuration

Pour modifier la difficulté ou le comportement :

### Fichier : `ai/ai-agents.js`

```javascript
// Modifier les stats d'un agent
this.stats = {
  aim: 65,           // ← Augmenter pour plus précis
  reaction: 70,      // ← Augmenter pour plus réactif
  aggression: 55,    // ← Augmenter pour plus agressif
  discipline: 65,    // ← Augmenter pour suivre stratégies
  // ...
};
```

### Fichier : `ai/ai-core.js`

```javascript
// Modifier la durée des phases
this.config = {
  roundDurationSec: 100,    // ← Durée du round
  agentMoveSpeedBase: 5.5,  // ← Vitesse de déplacement
  // ...
};
```

---

## 📚 Prochaines Étapes

1. **Affichage des chemins** (Debug visualization)
2. **Callouts vocaux** (Afficher qui dit quoi)
3. **Replay system** (Rejouer les rounds)
4. **Statistiques** (KDA, headshot %, winrate)
5. **Utilitaires** (Smoke, flash, murs)

---

## 🎮 Questions ?

1. **"Pourquoi un agent reste-t-il passif ?"**
   - C'est peut-être un Sentinel avec basse AGGRESSION
   - Ou il attend ses coéquipiers (DISCIPLINE)

2. **"Comment les agents communiquent-ils ?"**
   - Pour l'instant, via la vision (spotting)
   - Bientôt : callouts textes/vocaux

3. **"Pourquoi la même stratégie revient ?"**
   - Les poids sont pondérés, pas interdits
   - Peut être une bonne stratégie pour cette équipe

4. **"Can I watch different camera angles ?"**
   - À implémenter (camera control)
   - Pour l'instant : vue spectateur fixe

---

## 🔗 Fichiers à Connaître

```
ai-simulator.html     ← Point d'entrée (ouvrir ce fichier)
ai/ai-core.js         ← Moteur du match
ai/ai-agents.js       ← Classe Agent avec stats
ai/ai-strategy.js     ← Sélection des stratégies
ai/ai-combat.js       ← Système de combat réaliste
ai/ai-navigation.js   ← Pathfinding A*
```

---

Bon match ! 🎮🎯
