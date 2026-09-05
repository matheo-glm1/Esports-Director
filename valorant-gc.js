/* ============================================================
   VALORANT-GC.JS, code strictement exclusif à la section Valostrike GC
   (Game Changers). Chargé après valorant.js (voir index.html), dans le
   même contexte global classique (pas de modules ES) : toutes les
   fonctions et constantes ci-dessous restent appelables depuis script.js
   exactement comme si elles y étaient toujours définies, et peuvent
   elles-mêmes référencer des constantes de valorant.js (VALORANT_RANKED_
   REGIONS, VCT_REGION_LABELS...) puisqu'il est chargé juste avant.

   Ce que la GC PARTAGE avec Valostrike classique (aucune duplication,
   voir script.js/valorant.js) : le pool de maps actives, le pool
   d'agents et leurs stats/overrides, le système de patch, un seul méta
   pour toute la famille Valostrike (voir isValorantFamily, script.js).
   Le ladder Ranked GC réutilise aussi le même moteur que Valostrike
   classique, généralisé dans valorant.js (collectRankedPool/
   computeRegionalLadder/renderValorantRankedTab/rankedUIState prennent
   désormais un paramètre gameId) plutôt que dupliqué ici, seule la
   DONNÉE diffère (vivier de joueuses indépendant), pas la mécanique.

   Ce que ce fichier contient, propre à la GC : le pool de prénoms dédié
   (aucun recoupement avec le pool Valostrike classique) et la cellule de
   staff dédiée GC (state.valorantGCStaff), sur le modèle de la cellule
   Valostrike (valorant.js) et de Rocket Champ (rocketleague.js), un
   staff totalement indépendant, ses propres coachs à recruter.

   Pas de moteur de Split/Championship GC ici (pas de state.vctGC / World
   Hub GC) : ce format reste à préciser. En revanche cette section
   contient désormais deux briques réelles du circuit GC, indépendantes
   d'un Split, voir le plan "rosters orgless + Cash Cup EMEA" :
   - Les rosters SANS organisation (state.gcTeamPool) : une équipe GC peut
     exister sous son propre nom, être adoptée par une organisation
     (rachat du stack entier, voir adoptGCRoster, c'est la façon de
     rejoindre la GC via un roster déjà formé plutôt qu'à vide) et
     redevenir orgless sous un nouveau nom si l'organisation abandonne son
     programme (abandonGCProgram), aucune joueuse ne disparaît jamais.
   - Le Cash Cup EMEA (state.gcCashCupEmea) : tournoi mensuel ouvert à
     toutes les équipes (org ou orgless), poules round-robin + playoffs à
     élimination simple, entièrement indépendant d'un Split/Championship.
   ============================================================ */

/* ---- Pool de prénoms dédié à la GC (féminin/inclusif) — noms de
   famille et pseudos restent partagés avec les pools génériques
   (LAST_NAMES/NICKNAMES, script.js), ni l'un ni l'autre n'étant
   intrinsèquement genrés. Répartition géographique cohérente avec
   NATIONALITIES (script.js). ---- */
const VALORANT_GC_FIRST_NAMES = [
  // France
  'Camille','Chloe','Manon','Lea','Ines','Sarah','Julie','Emma','Louise','Alice',
  'Zoe','Jade','Lucie','Margaux','Charlotte','Amelie','Celine','Marion','Elise','Anais',
  // Allemagne / Autriche / Suisse
  'Greta','Lena','Hanna','Frieda','Klara','Mila','Nele','Sophie','Marlene','Ronja',
  // Angleterre / Royaume-Uni
  'Amelia','Poppy','Freya','Grace','Isla','Ruby','Millie','Evie','Daisy','Willow',
  // Espagne
  'Sofia','Valeria','Lucia','Martina','Paula','Carmen','Alba','Nerea','Irene','Aitana',
  // Suede / Danemark / Finlande / Norvege
  'Freja','Signe','Astrid','Ingrid','Saga','Alma','Elin','Vilma','Ronja','Selma',
  // Coree du Sud
  'Yuna','Seoyeon','Jiwoo','Haeun','Soojin','Minji','Yerin','Chaewon','Hyejin','Nayeon',
  // USA / Canada
  'Madison','Olivia','Ava','Harper','Ella','Riley','Aubrey','Zoey','Layla','Peyton',
  // Bresil / Argentine / Mexique
  'Beatriz','Larissa','Fernanda','Isabela','Camila','Valentina','Ximena','Renata','Bianca','Gabriela',
  // Pologne
  'Zuzanna','Julia','Wiktoria','Oliwia','Amelia','Kinga','Natalia','Aleksandra','Karolina','Marta',
  // Pays-Bas
  'Fleur','Sanne','Noa','Anne','Femke','Roos','Suze','Lotte','Iris','Merel',
  // Chine / Japon / Philippines / Indonesie / Thailande / Inde
  'Mei','Xinyi','Yuki','Sakura','Hana','Aiko','Mika','Ling','Anh','Kanya',
  'Priya','Ananya','Divya','Aditi','Nisha','Reyna','Dara','Bella','Cinta','Putri',
  // Turquie / Russie
  'Elif','Deniz','Zeynep','Ayse','Ceren','Anastasia','Ekaterina','Polina','Kira','Vera',
  // Australie
  'Charlotte','Mia','Georgia','Matilda','Sienna','Chloe','Piper','Abbey','Bridget','Tahlia',
];

/* ---- Cellule de staff dédiée Valostrike GC (indépendante du staff
   partagé d'organisation ET de la cellule Valostrike classique, voir
   state.valorantGCStaff) ---- */
const VALORANT_GC_STAFF_ROLES = ['Head Coach','Assistant Coach','Recruteur','Médecin','Psychologue Sportif'];

function ensureValorantGCStaff(){
  if(!state.valorantGCStaff) state.valorantGCStaff = {};
  backfillHiredStaffGender(state.valorantGCStaff);
  return state.valorantGCStaff;
}

// Bonus concret de victoire apporté par le staff GC dédié — même mécanique
// que valorantStaffMatchBonus, appliquée à ce roster-ci.
function valorantGCStaffMatchBonus(gameId, staffOverride){
  if(gameId!=='valorant_gc') return 0;
  const staff = staffOverride || ensureValorantGCStaff();
  const coach = staff['Head Coach'];
  const psy = staff['Psychologue Sportif'];
  let bonus = 0;
  if(coach) bonus += (staffEffectivePower(coach, ['Leadership','Stratégie'])/100) * 0.08; // jusqu'à +8%
  if(psy) bonus += (staffEffectivePower(psy, ['Motivation','Cohésion'])/100) * 0.04;      // jusqu'à +4% supplémentaires
  return bonus;
}
// Réduction de fatigue quotidienne apportée par le Médecin (0 à 30% de
// réduction selon son niveau).
function valorantGCMedecinFatigueReduction(){
  const m = ensureValorantGCStaff()['Médecin'];
  return m ? (staffEffectivePower(m, ['Récupération','Prévention des blessures'])/100) * 0.3 : 0;
}

function valorantGCStaffCard(role){
  const store = ensureValorantGCStaff();
  const m = store[role];
  const displayName = staffRoleDisplayName(role);
  if(!m){
    return `
      <div class="staff-empty-slot" data-role="${escapeAttr(role)}">
        <i class="fa-solid fa-user-plus" style="font-size:20px;"></i>
        <div style="font-weight:600;font-size:13px;">${displayName}</div>
        <button class="btn btn-sm goto-section-tab-btn" data-game="valorant_gc" data-tab="mercato"><i class="fa-solid fa-cart-shopping"></i> Voir sur le marché</button>
      </div>
    `;
  }
  const tier = staffTierLabel(m.level);
  const tierClass = staffTierBadgeClass(m.level);
  const attrs = m.attributes || {};
  return `
    <div class="card staff-card">
      <div class="staff-card-top">
        <div class="staff-avatar">${initials(m.name)}</div>
        <div style="flex:1;min-width:0;">
          <div class="staff-name">${staffNameLinkHired(role, m.name, 'valorant_gc')}</div>
          <div class="staff-role">${displayName}${m.nationality?` · ${flagImg(m.nationality,13)}`:''}</div>
        </div>
        <span class="badge ${tierClass}">${tier}</span>
      </div>
      ${Object.entries(attrs).map(([name,val])=>`
        <div class="info-row" style="padding:5px 0;border-bottom:none;">
          <span style="font-size:12px;">${name}</span>
          <span style="display:flex;align-items:center;gap:8px;">${ratingBar(val*5)}<b style="font-size:12px;">${val}</b></span>
        </div>
      `).join('')}
      <div class="staff-stats">
        <span>Expérience <b style="color:var(--text-primary)">${m.xp} ans</b></span>
        <span>Salaire <b style="color:var(--text-primary)">${formatMoney(m.salary)}/mois</b></span>
      </div>
      <div class="staff-actions">
        <button class="btn btn-danger btn-sm valorant-gc-staff-fire-btn" data-role="${escapeAttr(role)}"><i class="fa-solid fa-user-minus"></i> Licencier</button>
      </div>
    </div>
  `;
}

function fireValorantGCStaff(role){
  const store = ensureValorantGCStaff();
  const m = store[role];
  if(!m) return;
  const severance = Math.round(m.salary * 2);
  if(sectionBudget('valorant_gc') < severance){
    toast(`Budget alloué à Valostrike GC insuffisant pour l'indemnité de départ (${formatMoney(severance)} nécessaires).`, 'error');
    return;
  }
  openConfirmActionModal({
    title: 'Licencier ce membre du staff ?',
    body: `Licencier <b>${m.name}</b> coûtera une indemnité de départ de <b>${formatMoney(severance)}</b> (2 mois de salaire).`,
    confirmLabel: '<i class="fa-solid fa-user-minus"></i> Licencier',
    onConfirm: ()=>{
      state.budget -= severance;
      spendFromSectionBudgetIfActive('valorant_gc', severance);
      recordTransaction('valorant_gc', 'severance', `Indemnité de départ, ${m.name}`, -severance);
      pushNotification(`${m.name} quitte la cellule Valostrike GC (indemnité : ${formatMoney(severance)}).`);
      pushNews(`${m.name} quitte ${state.org.name} après son licenciement.`);
      toast(`${m.name} licencié(e).`, 'info');
      delete store[role];
      saveState();
      renderTopbar();
      renderSectionPage('valorant_gc', 'staff');
    },
  });
}

// Marché dédié à la cellule de staff GC — LIÉ au marché Valostrike
// classique (voir ensureValorantFamilyStaffMarket, script.js) : même bassin
// partagé, un candidat repéré côté GC reste recrutable côté classique et
// inversement. Ce wrapper ne sert plus qu'à garder les nombreux appels
// existants (dedicatedStaffMarket, etc.) inchangés.
function ensureValorantGCStaffMarket(){
  return ensureValorantFamilyStaffMarket();
}

const VALORANT_GC_STAFF_SORT_OPTIONS = VALORANT_GC_STAFF_ROLES;
// Rendu des cartes du marché du staff GC (même gabarit visuel que
// renderValorantStaffMarketCards/renderRocketleagueStaffMarketCards, mais
// rôles et libellés propres à la cellule GC).
function renderValorantGCStaffMarketCards(filterQuery='', pageKey='valorantGCStaffMercato'){
  const market = ensureValorantGCStaffMarket();
  const q = (filterQuery||'').toLowerCase();
  const roleFilter = getStaffRoleFilter(pageKey);
  let filtered = q ? market.filter(c=>{
    const displayName = (c.pseudo||c.name) || '';
    return displayName.toLowerCase().includes(q) || staffRoleDisplayName(c.role).toLowerCase().includes(q);
  }) : market;
  if(roleFilter!=='all') filtered = filtered.filter(c=>staffRoleFilterMatches(c.role, roleFilter));
  const extraFilters = getStaffExtraFilters(pageKey);
  filtered = filtered.filter(c=>staffMatchesExtraFilters(c, extraFilters));
  filtered = sortMercatoRows(filtered, (c,key)=>c[key], mercatoStaffUIState.sortKey, mercatoStaffUIState.sortDir);
  const { items, page, totalPages, total } = paginate(filtered, pageKey, STAFF_CARDS_PAGE_SIZE);
  const rowsHtml = items.map(c=>{
    const displayName = c.pseudo || c.name;
    const currentHolder = ensureValorantGCStaff()[c.role] ? ensureValorantGCStaff()[c.role].name : null;
    return staffMarketRowHtml('valorant_gc', c, displayName, staffRoleDisplayName(c.role), currentHolder, 'buy-valorant-gc-staff-btn');
  }).join('');
  return {
    cardsHtml: staffMarketListHtml(rowsHtml),
    paginationHtml: renderPaginationBar(pageKey, page, totalPages, total, STAFF_CARDS_PAGE_SIZE),
    sortBarHtml: renderStaffRoleSortBar(pageKey, VALORANT_GC_STAFF_SORT_OPTIONS, VALORANT_GC_STAFF_ROLES),
  };
}

function bindValorantGCStaffMarketBuyButtons(onDone, pageKey='valorantGCStaffMercato'){
  document.querySelectorAll('.buy-valorant-gc-staff-btn').forEach(btn=>{
    btn.onclick = ()=> openStaffNegotiation('valorant_gc', btn.dataset.id);
  });
  bindPaginationBar(pageKey, onDone);
  bindStaffRoleSortBar(pageKey, onDone, VALORANT_GC_STAFF_SORT_OPTIONS, VALORANT_GC_STAFF_ROLES);
}

// Région choisie à l'inscription (voir renderSlotsPage/bindSlotsEvents,
// gcJoinRegionChoice) et conservée telle quelle ensuite (state.gcRegion) —
// gouverne le Kickoff/Cash Cup/Stage 1 ET le ladder Ranked régional (voir
// collectRankedPool/computeRegionalLadder, valorant.js). Repli sur EMEA
// pour les sauvegardes antérieures à l'introduction du choix de région
// (jamais de state.gcRegion enregistré) — même principe que
// myValorantRegion() côté Valostrike classique. Volontairement indépendante
// de myValorantRegion() pour ne jamais suivre la région VST de la section
// classique si les deux sont actives dans la même organisation.
function myValorantGCRegion(){
  return state.gcRegion || 'emea';
}
const GC_REGION_LABELS = { emea:'EMEA', americas:'Americas', pacific:'Pacific', china:'China' };
function gcRegionLabel(region){
  return GC_REGION_LABELS[region || myValorantGCRegion()] || 'EMEA';
}
// Organisations affiliées de la région ACTUELLE du joueur (voir
// GC_TEAMS_BY_REGION) — remplace les anciennes références en dur à
// GC_TEAMS_EMEA dans le reste du fichier, pour que Cash Cup/Stage 1/Kickoff
// utilisent la bonne liste quelle que soit la région choisie.
function myGCAffiliatedTeams(){
  return GC_TEAMS_BY_REGION[myValorantGCRegion()] || GC_TEAMS_EMEA;
}

/* ============================================================
   ROSTERS ORGLESS — vivier d'équipes GC réelles/orgless (state.gcTeamPool)
   ============================================================ */

// Base réelle 2026 (non-exhaustive) — 4 régions VST (EMEA/Americas/Pacific/
// China), 10 organisations affiliées chacune (voir prompt du chantier :
// "adapte le kick off pour qu'il y ait 10 équipes en VST GC dans chaque
// région"). China n'a pas encore de circuit GC stable/identifiable au même
// niveau que les 3 autres régions à l'heure où ce chantier est écrit — ses
// 10 entrées restent donc des rosters génériques (façon GC_ORGLESS_NAME_POOL),
// jamais présentés comme de vraies organisations, contrairement aux 3 autres
// régions où chaque nom correspond à une organisation réellement affiliée.
// Les 4 régions sont câblées dans le même circuit complet (Kickoff, Cash
// Cup, Stage 1/2/3, Promotion/Relegation, points de Championship) — voir
// myValorantGCRegion, choisie librement à la création de l'organisation
// (et modifiable ensuite). Americas/Pacific/China démarrent juste avec
// moins d'organisations réellement affiliées qu'EMEA, le Kickoff comble le
// reste de leur plateau à 10 exactement comme pour EMEA.
// Uniquement les organisations RÉELLEMENT affiliées (celles données par le
// joueur, sources Liquipedia/thespike.gg/valorantesports.com/zetadivision.com)
// — déjà "en VST GC" sans rien avoir à prouver. Le reste du plateau de 10
// par région se gagne chaque année via le Kickoff (voir
// gcKickoffQualifiersNeeded/catchUpGCKickoff plus bas) : jamais une liste
// statique inventée en plus de celles-ci.
const GC_TEAMS_EMEA = ['Gentle Mates GC','G2 Gozen','GIANTX GC','Karmine Corp GC'];
const GC_TEAMS_AMERICAS = ['Shopify Rebellion Gold','Cloud9 GC','KRÜ Blaze','Team Liquid Visa','MIBR GC'];
const GC_TEAMS_PACIFIC = ['ZETA DIVISION GC','Falcons Vega','FENNEL GC'];
const GC_TEAMS_CHINA = [];
const GC_TEAMS_BY_REGION = { emea:GC_TEAMS_EMEA, americas:GC_TEAMS_AMERICAS, pacific:GC_TEAMS_PACIFIC, china:GC_TEAMS_CHINA };
// Nombre de places encore à pourvoir par région pour atteindre les 10
// équipes de VST GC — c'est très exactement ce nombre que le Kickoff fait
// gagner chaque année (voir buildGCKickoffField/gcKickoffCompletedRoster).
const GC_VCT_GC_ROSTER_SIZE = 10;
function gcKickoffQualifiersNeeded(region){
  return Math.max(0, GC_VCT_GC_ROSTER_SIZE - (GC_TEAMS_BY_REGION[region]||[]).length);
}

// Pool de noms génériques pour les rosters orgless (Cash Cup au-delà des
// noms réels ci-dessus, et renommage d'un roster qui redevient orgless
// après abandon — voir abandonGCProgram) — consonance esport scrappy,
// façon "Puppy Thieves"/"Wadadaa"/"No Sweat Blossom".
const GC_ORGLESS_NAME_POOL = ['Velvet Foxes','Glitch Bunnies','Midnight Sirens',
  'Rowdy Peaches','Static Hive','Feral Kittens','Loose Cannons','Paper Tigers',
  'Neon Alley Cats','Wildflower Five','Copper Vipers','Sleepy Owls','Rogue Petals',
  'Frostbite Kittens','Runaway Comets','Tiny Terrors','Salt Mine','Honeybadgers United',
  'Crooked Halo','Sugar Rush GC','Ivory Wolves','Backyard Bandits','Moonlit Ferals',
  'Chaos Theory','Windup Toys','Bramble Squad','Nightshade Five','Lucky Strays',
  'Paper Cranes','Renegade Blossoms','Static Kittens','Half Moon Collective',
  'Snapdragon Five','Wanderlight','Crimson Tumbleweeds','Featherweight Five',
  'Broken Compass','Spare Change GC','Velvet Thorns','Second Wind',
  // Ajouts pour couvrir le remplissage orgless des 3 régions non-EMEA (voir
  // ensureGCTeamPool) — même style scrappy, aucune prétention de nom réel.
  'Gravel Road Five','Copperhead Collective','Lone Star Ferals','Dust Devils GC',
  'Midwest Marigolds','Backlot Bandits','Highway Hornets','Static Fern',
  'Rustbelt Renegades','Cactus Crown','Solar Flare Five','Pixel Coyotes',
  'Skyline Ferals','Neon Bayou','Driftwood Collective','Tumbleweed Tactics',
  'Harbor Lights GC','Cherry Blossom Five','Rice Paper Renegades','Bamboo Static',
  'Origami Foxes','Lantern Static','Monsoon Collective','Paper Crane Tactics',
  'Iron Rickshaw','Riverbend Ferals','Willow Static','Tidewater Five',
  'Copper Lantern','Jade Compass',
  // Marge supplémentaire pour le Kickoff (voir gcKickoffQualifiersNeeded) —
  // un champ plus large que le seul nombre de places à pourvoir, région par
  // région, sans jamais dépendre d'un vivier trop juste.
  'Amber Static','Blue Ridge Five','Canyon Wren Collective','Driftless Foxes',
  'Ember Static Five','Frontier Blossoms','Granite Static','Hollow Reed Five',
  'Ironwood Renegades','Juniper Static','Kestrel Collective','Lowland Static',
  'Marrow Static Five','Nightjar Collective','Overgrowth Static','Prairie Static Five',
  'Quartz Renegades','Redwood Static','Sable Static Five','Thistledown Collective',
  // Nouvelle marge (voir targetOrglessByRegion, ensureGCTeamPool) — les 3
  // régions non-EMEA disputent maintenant les mêmes compétitions que EMEA
  // (Stage 1 Promotion/Relegation, Stage 2, Stage 3 + Play-Ins), qui
  // consomment chacune leur propre lot de candidates hors champ Stage 1 :
  // sans cet ajout, le vivier total (90 noms) ne suffisait plus à couvrir
  // la somme des 4 cibles régionales relevées (116).
  'Umber Static Five','Vellum Renegades','Wraith Static','Xeno Collective',
  'Yarrow Static Five','Zephyr Renegades','Alkali Static','Basalt Collective',
  'Cinder Static Five','Driftglass Renegades','Ember Hollow Collective','Foxglove Static',
  'Graywater Five','Hushwind Collective','Inkwell Static','Jetstream Renegades',
  'Kelpshore Five','Lichgate Static','Mothlight Collective','Nettlecross Five',
  'Opaline Static','Palefire Renegades','Quillfeather Five','Rustwater Collective',
  'Sagebrush Static','Tallowlight Five','Underglow Collective','Verdant Static Five',
  'Whistlecreek Renegades','Xylowisp Static'];

// state.gcTeamPool : équipes GC réelles/orgless connues du monde du jeu —
// même forme que makeWorldTeam (script.js) + champs propres à la GC.
// Seedée une fois : les 10 organisations affiliées de CHAQUE région (voir
// GC_TEAMS_BY_REGION — déjà "sous organisation", leur nom porte la marque
// d'un org) + assez de rosters orgless génériques pour alimenter le Cash
// Cup EMEA sans jamais manquer de monde (seule région avec une compétition
// vraiment active côté joueur pour l'instant — voir myValorantGCRegion).
// state.gcUsedTeamNames retient TOUS les noms déjà attribués un jour (même
// après qu'une entrée ait quitté le pool — ex. adoptGCRoster qui la
// supprime du pool car reprise par le joueur) : sans ça, un nom adopté
// réapparaissait comme "nouveau" roster orgless au prochain appel de cette
// fonction (le remplissage ne regardait que le pool ACTUEL, pas l'historique).
function ensureGCTeamPool(){
  if(!state.gcTeamPool) state.gcTeamPool = {};
  if(!state.gcUsedTeamNames) state.gcUsedTeamNames = {};
  const pool = state.gcTeamPool;
  const used = state.gcUsedTeamNames;
  Object.entries(GC_TEAMS_BY_REGION).forEach(([region, names])=>{
    names.forEach(name=>{
      if(!pool[name] && !used[name]){
        pool[name] = { ...makeWorldTeam(name), region, orgless:false, ownerOrgName:name };
        used[name] = true;
      }
    });
  });
  // Cible par région : EMEA a besoin d'un grand vivier (Cash Cup, tournoi
  // ouvert avec un champ de plusieurs dizaines d'équipes chaque mois — voir
  // buildGCCashCupField) ; les 3 autres régions n'ont pour l'instant que le
  // champ du Kickoff (voir gcKickoffQualifiersNeeded/buildGCKickoffField —
  // needed+6 de marge), toujours plus petit mais variable selon combien
  // d'organisations réelles sont déjà affiliées dans cette région.
  // Cibles relevées (au-delà du seul besoin Kickoff d'origine) : Stage 1
  // Promotion/Relegation (Group Stage à 16 candidates) et Stage 3 (Play-Ins,
  // repli vivier) tournent maintenant dans les 4 régions comme en EMEA — un
  // vivier trop juste dégraderait silencieusement ces champs sans planter
  // (voir les .slice()/while() associés), mais un vivier plus large reste
  // préférable pour éviter de trop répéter les mêmes noms d'une compétition
  // à l'autre. Total (réelles + orgless) volontairement comparable entre
  // régions malgré des comptes d'organisations réelles très différents.
  const targetOrglessByRegion = { emea:30, americas:26, pacific:28, china:32 };
  let available = GC_ORGLESS_NAME_POOL.filter(n=>!used[n]);
  Object.entries(targetOrglessByRegion).forEach(([region, target])=>{
    let current = Object.values(pool).filter(t=>t.orgless && t.region===region).length;
    while(current < target && available.length){
      const name = available.shift();
      if(used[name]) continue;
      pool[name] = { ...makeWorldTeam(name), region, orgless:true, ownerOrgName:null };
      used[name] = true;
      current++;
    }
  });
  return pool;
}

// Force d'une équipe GC (joueur ou IA) — même convention que
// rlcsTeamStrength (script.js) : l'effectif réel du joueur compte, les
// fiches IA de fond utilisent leur force fixe + adaptation méta.
function gcTeamStrength(name){
  if(name===state.org.name){
    const squad = state.squads.valorant_gc || [];
    if(!squad.length) return 55;
    return squad.reduce((s,p)=>s+(p.level||60),0)/squad.length;
  }
  const pool = ensureGCTeamPool();
  const t = pool[name];
  return t ? (t.strength||65) + (t.metaAdaptation||0) : 65;
}

// Prix d'adoption d'un roster orgless — dérivé de sa force (échelle
// randInt(42,88) de makeWorldTeam, script.js), borné entre 10 000 $ et
// 50 000 $ sur toute la plage de force réaliste [40,90] : un roster tout
// juste correct coûte le plancher, un roster déjà costaud coûte le
// plafond, jamais au-delà.
function gcRosterAdoptionPrice(team){
  const s = Math.max(40, Math.min(90, team.strength||65));
  const ratio = (s-40)/50;
  return Math.round((10000 + ratio*40000)/500)*500;
}

// Adopte un roster orgless en un seul rachat (jamais joueuse par joueuse) —
// devient la section Valostrike GC officielle de l'organisation. Réutilise
// unlockGameSection (script.js) pour toute la mécanique générique
// d'ouverture de section (frais, standings, calendrier, sponsors...), ne
// fait que substituer l'effectif/staff vides par ceux, réels, du roster
// adopté — même principe que le "boughtTeam" de unlockGameSection pour
// Valostrike/Rocket Champ, appliqué au vivier GC plutôt qu'au World Hub.
function adoptGCRoster(teamName){
  const pool = ensureGCTeamPool();
  const team = pool[teamName];
  if(!team){ toast('Ce roster n\'est plus disponible.', 'error'); return; }
  const price = gcRosterAdoptionPrice(team);
  const total = price + sectionUnlockCost();
  if(state.budget < total){
    toast(`Budget insuffisant pour adopter ce roster (${formatMoney(total)} nécessaires).`, 'error');
    return;
  }
  const roster = ensureTeamRoster('valorant_gc', team).slice();
  const staff = { ...ensureTeamStaff(team, 'valorant_gc') };
  delete pool[teamName];
  unlockGameSection('valorant_gc', null, null, 0);
  state.squads.valorant_gc = roster;
  if(Object.keys(staff).length) Object.assign(ensureValorantGCStaff(), staff);
  state.budget -= price;
  recordTransaction('valorant_gc', 'infrastructure', `Adoption du roster ${teamName}`, -price);
  saveState();
  renderTopbar();
  toast(`Roster ${teamName} adopté, ${roster.length} joueuse${roster.length>1?'s':''} reprise${roster.length>1?'s':''} !`, 'success');
}

// Envoi d'une joueuse GC vers Valostrike classique — jugement du manager
// (comme la promotion Centre de Formation, script.js), aucun palier de
// niveau imposé par le système. Bascule DÉFINITIVEMENT sur le barème
// classique (p.economyScale, voir computePlayerSalary/recalcPlayerMarketValue,
// script.js) : sa valeur marchande grimpe immédiatement, ses futures
// demandes salariales (askingSalary/negotiatedSalary, mises en cache — on
// les vide pour qu'elles se recalculent au nouveau barème) suivent. Le
// barème classique reste acquis même si elle repasse par la suite en GC
// (voir releaseSquadPlayer/removeMercatoFreeAgent, script.js) — une
// ex-joueuse classique ne va pas soudainement accepter d'être payée 20 fois
// moins parce qu'un club GC s'intéresse à elle.
function promoteGCPlayerToClassic(playerId){
  const squad = state.squads.valorant_gc || [];
  const idx = squad.findIndex(p=>p.id===playerId);
  if(idx===-1) return;
  if(!state.sections.includes('valorant')){
    toast('Rejoignez Valostrike classique pour pouvoir y envoyer une joueuse.', 'error');
    return;
  }
  const player = squad[idx];
  state.squads.valorant = state.squads.valorant || [];
  if(!canSignImport(state.squads.valorant, player)){
    toast(`Limite de ${IMPORT_MAX_PER_TEAM} imports atteinte pour Valostrike classique.`, 'error');
    return;
  }
  squad.splice(idx, 1);
  const oldValue = player.marketValue||0;
  player.economyScale = 1;
  player.gcOrigin = true; // se souvient qu'elle vient de GC — voir releaseSquadPlayer/removeMercatoFreeAgent
  player.yearsAtClub = 0; // nouvelle signature côté section classique, pas un simple transfert interne
  delete player.askingSalary;
  delete player.negotiatedSalary;
  recalcPlayerMarketValue(player);
  state.squads.valorant.push({ ...player, ...contractFieldsForNewSignature(2),
    transferHistory:[...(player.transferHistory||[]), { year:state.date.year, type:'promoted', team:state.org.name }] });
  pushNotification(`${playerPseudo(player.name)} rejoint Valostrike classique, sa valeur marchande grimpe de ${formatMoney(oldValue)} à ${formatMoney(player.marketValue)}.`);
  toast(`${playerPseudo(player.name)} envoyée en Valostrike classique !`, 'success');
  saveState();
  renderTopbar();
}

// Abandon du programme GC : la section ferme, mais le roster ne disparaît
// JAMAIS — il redevient orgless sous un nom inédit (state.gcTeamPool) et
// continue la saison en solo (ex. Cash Cup EMEA). Réutilise finalizeSlotSale
// (script.js) pour tout le nettoyage générique de fermeture de section.
// saleValue : 0 pour un abandon pur (bouton "Abandonner le programme",
// aucune contrepartie), ou le montant d'une offre de rachat acceptée
// (voir acceptSlotOffer, script.js, spécialisé pour la GC — la vente
// générique de finalizeSlotSale archiverait le roster au lieu de le
// laisser continuer en solo, ce que la GC ne fait jamais). Dans les deux
// cas, le roster ne disparaît jamais : il redevient orgless sous un
// nouveau nom (state.gcTeamPool), exactement comme un abandon classique.
function abandonGCProgram(saleValue=0){
  const roster = (state.squads.valorant_gc||[]).slice();
  const staff = { ...ensureValorantGCStaff() };
  if(roster.length || Object.keys(staff).length){
    const pool = ensureGCTeamPool();
    const used = state.gcUsedTeamNames || (state.gcUsedTeamNames = {});
    const available = GC_ORGLESS_NAME_POOL.filter(n=>!used[n]);
    const name = available.length ? choice(available) : `${choice(GC_ORGLESS_NAME_POOL)} ${randInt(2,99)}`;
    const strength = roster.length ? Math.round(roster.reduce((s,p)=>s+(p.level||60),0)/roster.length) : randInt(42,88);
    pool[name] = { ...makeWorldTeam(name), region:myValorantGCRegion(), orgless:true, ownerOrgName:null, strength, roster, staff };
    used[name] = true;
    pushNotification(saleValue>0
      ? `Le roster quitte votre organisation (vendu pour ${formatMoney(saleValue)}) mais continue la saison en solo, sous le nom ${name}.`
      : `Le roster quitte votre organisation mais continue la saison en solo, sous le nom ${name}.`);
  } else {
    pushNotification(`Programme Valostrike GC fermé.`);
  }
  state.valorantGCStaff = {};
  finalizeSlotSale('valorant_gc', saleValue);
}

// Narration légère d'ownership IA (aucune simulation économique réelle,
// juste un renommage + une actu) — un roster orgless peut se faire
// "adopter" par un nom d'org généré, et à l'inverse une équipe déjà
// adoptée peut redevenir orgless. Appelée une fois par mois (voir
// runMonthlyFinances, script.js).
function tickGCRosterOwnershipNarrative(){
  const pool = ensureGCTeamPool();
  const used = state.gcUsedTeamNames || (state.gcUsedTeamNames = {});
  if(Math.random() < 0.15){
    const orglessTeams = Object.values(pool).filter(t=>t.orgless);
    if(orglessTeams.length){
      const team = choice(orglessTeams);
      const newName = `${choice(ORG_NAME_CORES)} ${choice(ORG_NAME_SUFFIXES)} GC`;
      if(!used[newName]){
        const oldName = team.name;
        delete pool[oldName];
        team.name = newName; team.orgless = false; team.ownerOrgName = newName;
        pool[newName] = team;
        used[newName] = true;
        pushNews(`${newName} reprend le roster ${oldName} et rejoint la scène Cash Cup ${gcRegionLabel(team.region)} sous ses couleurs.`, 'buyout', 'valorant_gc');
      }
    }
  }
  if(Math.random() < 0.08){
    const ownedTeams = Object.values(pool).filter(t=>!t.orgless);
    if(ownedTeams.length){
      const team = choice(ownedTeams);
      const available = GC_ORGLESS_NAME_POOL.filter(n=>!used[n]);
      const newName = available.length ? choice(available) : `${choice(GC_ORGLESS_NAME_POOL)} ${randInt(2,99)}`;
      const oldName = team.name;
      delete pool[oldName];
      team.name = newName; team.orgless = true; team.ownerOrgName = null;
      pool[newName] = team;
      used[newName] = true;
      pushNews(`${oldName} met fin à son programme Valostrike GC, le roster continue en solo sous le nom ${newName}.`, 'buyout', 'valorant_gc');
    }
  }
}

/* ============================================================
   CASH CUP EMEA — tournoi mensuel, ouvert à toutes les équipes GC (org ou
   orgless), indépendant de tout Split/Championship. Format réel : 12
   groupes de 5 + 4 groupes de 4 (~76 équipes), Bo3 round-robin, puis
   playoffs à élimination simple ; petite dotation (~2000€). Champ réduit
   ici à 6 groupes de 5 + 2 groupes de 4 (38 équipes) pour rester gérable
   en simulation longue durée (même logique de scaling déjà appliquée par
   ce jeu aux Opens RLCS — champ réel bien plus large que celui simulé),
   mêmes proportions et même format.
   ============================================================ */

const GC_CASHCUP_GROUP_SIZES = [5,5,5,5,5,5,4,4]; // 38 équipes, 8 groupes
const GC_CASHCUP_PRIZE = 2000;

// Calendrier fixe mensuel (identique tous les mois, voir prompt du
// chantier) — un CRÉNEAU plutôt qu'un jour unique par phase, pour garder
// l'auto-réparation déjà en place (voir catchUpGCCashCupEmea plus bas) :
// une résolution bloquée un jour (collision avec la ligue domestique GC,
// voir tryScheduleSelfGCCashCupMatch) se rattrape le lendemain SANS jamais
// dépasser la borne de fin de créneau — si le temps manque à l'approche de
// la borne, plusieurs rounds se résolvent le même jour pour tenir les
// délais plutôt que de déborder sur la phase suivante.
const GC_CASHCUP_QUALIFIER_WINDOW = [1,2];
const GC_CASHCUP_GROUPS_WINDOW = [6,8];
const GC_CASHCUP_PLAYOFFS_WINDOW = [13,15];
const GC_CASHCUP_DEAD_WINDOW_START = 16;

function gcCashCupFieldSize(){ return GC_CASHCUP_GROUP_SIZES.reduce((s,n)=>s+n,0); }

// Tirage du format du mois — décidé au moment de l'invitation (voir
// sendGCCashCupInviteMail) pour que le mail annonce déjà le format retenu.
// hasQualifier active la phase Open Qualifier (jour 1-2) ; groupFormat
// détermine la phase de groupes (jour 6-8) : Bo3/Bo1 en round-robin
// classique, ou Swiss (appariement par bilan, voir pairGCCashCupSwissRound).
function rollGCCashCupFormat(){
  const r = Math.random();
  const groupFormat = r<0.4 ? 'bo3' : r<0.7 ? 'bo1' : 'swiss';
  const hasQualifier = groupFormat==='swiss' || Math.random()<0.35;
  return { groupFormat, hasQualifier };
}
function gcCashCupFormatLabel(format){
  return format.groupFormat==='swiss' ? 'système Suisse'
    : format.groupFormat==='bo1' ? 'groupes en Bo1'
    : 'groupes en Bo3';
}

// --- Invitation (7 à 10 jours avant le début de la phase de groupes) ---
// Décidée par rapport au jour 6 (début de la fenêtre de groupes, la seule
// phase systématique tous les mois — voir GC_CASHCUP_GROUPS_WINDOW),
// jamais par rapport à l'Open Qualifier (optionnel selon le format).
function nextGCCashCupCycleTarget(){
  const d = state.date;
  let y=d.year, m=d.month;
  if(d.day > GC_CASHCUP_GROUPS_WINDOW[0]){ m++; if(m>11){ m=0; y++; } }
  return { year:y, month:m };
}
function daysUntilGCCashCupGroupsStart(){
  const d = state.date;
  const today = new Date(d.year, d.month, d.day);
  const t = nextGCCashCupCycleTarget();
  const target = new Date(t.year, t.month, GC_CASHCUP_GROUPS_WINDOW[0]);
  return Math.round((target - today) / 86400000);
}
// Les organisations déjà affiliées VST Game Changers (GC_TEAMS_EMEA) sont
// prioritaires : qualifiées d'office pour la phase de groupes, jamais
// besoin de passer par l'Open Qualifier — voir buildGCCashCupQualifier.
// Le mail d'invitation le rappelle explicitement.
function sendGCCashCupInviteMail(target, format){
  state.gcCashCupPending = { year:target.year, month:target.month, format, participating:null };
  const label = gcCashCupFormatLabel(format);
  const region = gcRegionLabel();
  pushMail('valorant_gc', {
    category:'COMPETITION', priority:'important', sender:`Organisation Cash Cup ${region}`,
    subject:`Invitation, Cash Cup ${region}`,
    preview:`Votre place pour le Cash Cup ${region} de ${MONTH_NAMES[target.month]} vous est proposée.`,
    body:`
      <p>Le circuit Cash Cup ${region} vous propose une place pour l'édition de <b>${MONTH_NAMES[target.month]} ${target.year}</b>.</p>
      <p>Cette édition se jouera en ${label}${format.hasQualifier ? ", précédée d'un Open Qualifier (jour 1-2 du mois)" : ''}. Les organisations déjà affiliées VST Game Changers sont prioritaires et qualifiées d'office pour la phase de groupes ; les autres devront, le cas échéant, passer par l'Open Qualifier.</p>
      <p>Dotation : <b>${formatMoney(GC_CASHCUP_PRIZE)}</b> pour l'équipe championne.</p>
    `,
    actions:[
      { key:'accept-gc-cashcup-invite', label:'Accepter', style:'primary', icon:'fa-check' },
      { key:'decline-gc-cashcup-invite', label:'Refuser', style:'danger', icon:'fa-xmark' },
    ],
  });
}
// Vérifiée chaque jour (voir advanceDay, script.js) : envoie l'invitation
// une seule fois par cycle, dès que le compte à rebours vers le début de
// la phase de groupes entre dans la fenêtre [7,10] jours.
function checkGCCashCupInvite(){
  if(!state.sections.includes('valorant_gc')) return;
  const days = daysUntilGCCashCupGroupsStart();
  if(days < 7 || days > 10) return;
  const t = nextGCCashCupCycleTarget();
  const key = `${t.year}-${t.month}`;
  if(state.gcCashCupInviteSentFor === key) return;
  state.gcCashCupInviteSentFor = key;
  sendGCCashCupInviteMail(t, rollGCCashCupFormat());
}
// Aucune réponse d'ici le début de la phase de groupes : participation
// acceptée par défaut (voir catchUpGCCashCupEmea) — l'invitation sert à
// pouvoir refuser, pas à devoir confirmer activement chaque mois.
function acceptGCCashCupInvite(gameId, mail){
  if(state.gcCashCupPending) state.gcCashCupPending.participating = true;
  const monthLabel = state.gcCashCupPending ? MONTH_NAMES[state.gcCashCupPending.month] : 'ce mois';
  const region = gcRegionLabel();
  finalizeMailDecision(mail, `Participation confirmée, vous disputerez le Cash Cup ${region} de ${monthLabel}.`);
  toast(`Invitation Cash Cup ${region} acceptée.`, 'success');
}
function declineGCCashCupInvite(gameId, mail){
  if(state.gcCashCupPending) state.gcCashCupPending.participating = false;
  const monthLabel = state.gcCashCupPending ? MONTH_NAMES[state.gcCashCupPending.month] : 'ce mois';
  const region = gcRegionLabel();
  finalizeMailDecision(mail, `Invitation déclinée, votre organisation ne participera pas au Cash Cup ${region} de ${monthLabel}.`);
  toast(`Invitation Cash Cup ${region} refusée.`, 'info');
}

// --- Statistiques individuelles Cash Cup / Stage 1 (onglet Statistiques,
// renderGCSeasonHub) --- Accumulateur "roulant" par ÉDITION (un Cash Cup =
// un mois, un Stage 1 = une année) — se réinitialise tout seul dès qu'il
// détecte un changement d'édition (voir ensureCurrentGCCashCupStatsBucket),
// en figeant au passage l'édition précédente dans l'archive, sans dépendre
// d'un point d'accroche précis dans catchUpGCCashCupEmea (fragile : facile
// d'oublier un des nombreux points de transition de phase). Alimenté
// uniquement par les matchs IA-vs-IA (voir resolveGCCashCupMatch ci-dessous)
// — contrairement à Valostrike classique, le propre match du joueur ici
// passe par un tirage pondéré simplifié (jamais le moteur manche par
// manche), donc son propre effectif n'apparaîtra pas dans ces classements
// tant que ça reste le cas (signalé dans l'UI, voir renderGCStatsPanel).
function currentGCStatsEditionKey(){
  if(isGCStage1Window(state.date)) return `stage1_${state.date.year}`;
  const cup = state.gcCashCupEmea;
  return cup ? `cashcup_${cup.year}_${cup.month}` : `cashcup_${state.date.year}_${state.date.month}`;
}
function ensureCurrentGCCashCupStatsBucket(){
  const key = currentGCStatsEditionKey();
  if(!state.gcCashCupStats || state.gcCashCupStats.editionKey!==key){
    if(state.gcCashCupStats && Object.keys(state.gcCashCupStats.byPlayer).length){
      state.gcCashCupStatsArchive = state.gcCashCupStatsArchive || {};
      state.gcCashCupStatsArchive[state.gcCashCupStats.editionKey] = state.gcCashCupStats.byPlayer;
    }
    state.gcCashCupStats = { editionKey:key, byPlayer:{} };
  }
  return state.gcCashCupStats;
}
function bumpGCCashCupStat(p, teamName, entry, mapsCount, won, isMvp){
  const bucket = ensureCurrentGCCashCupStatsBucket();
  if(!bucket) return;
  if(!bucket.byPlayer[p.id]) bucket.byPlayer[p.id] = {
    playerId:p.id, name:p.name, teamName, matches:0, mapsPlayed:0, wins:0, losses:0,
    kills:0, deaths:0, assists:0, firstKills:0, clutchesWon:0, mvp:0,
    acsSum:0, ratingSum:0, hsSum:0,
  };
  const e = bucket.byPlayer[p.id];
  e.name = p.name; e.teamName = teamName;
  e.matches += 1; e.mapsPlayed += mapsCount;
  if(won) e.wins += 1; else e.losses += 1;
  e.kills += entry.kills||0; e.deaths += entry.deaths||0; e.assists += entry.assists||0;
  e.firstKills += entry.firstKills||0; e.clutchesWon += entry.clutchesWon||0;
  e.acsSum += (entry.avgAcs||0) * mapsCount;
  e.ratingSum += (entry.avgRating||0) * mapsCount;
  e.hsSum += (entry.avgHs||0) * mapsCount;
  if(isMvp) e.mvp += 1;
}
function applyGCCashCupPhaseStats(series, teamAName, teamBName){
  try{
    const aggregate = aggregateSeriesStats(series, 'valorant_gc');
    aggregate.everyone.forEach(entry=>{
      const p = entry.player;
      if(!p) return;
      const teamWon = (entry.team==='A') === series.aWinsSeries;
      const isMvp = !!(aggregate.mvp && aggregate.mvp.player.id===p.id);
      bumpGCCashCupStat(p, entry.team==='A' ? teamAName : teamBName, entry, aggregate.mapsCount||1, teamWon, isMvp);
    });
  } catch(e){ /* stats individuelles best-effort, jamais bloquant pour le résultat du match */ }
}

// Résout un match Cash Cup — même convention que resolveRLCSMatch
// (script.js) : le joueur (s'il est impliqué) via un tirage pondéré par
// force (pas d'engagement du moteur manche par manche pour son propre
// match, exactement comme RLCS le fait déjà pour ses brackets), les
// équipes IA via le vrai moteur partagé (simulateSeries, déjà générique
// par isValorantFamily) sur un roster matérialisé à la volée.
function resolveGCCashCupMatch(nameA, nameB, format='bo3'){
  const needed = format==='bo5' ? 3 : format==='bo3' ? 2 : 1;
  if(nameA===state.org.name || nameB===state.org.name){
    const selfIsA = nameA===state.org.name;
    const oppName = selfIsA ? nameB : nameA;
    const p = matchupWinProbability(gcTeamStrength(state.org.name), gcTeamStrength(oppName));
    let winsSelf=0, winsOpp=0;
    while(winsSelf<needed && winsOpp<needed){ if(Math.random()<p) winsSelf++; else winsOpp++; }
    const selfWon = winsSelf>winsOpp;
    const winner = selfWon ? state.org.name : oppName;
    const loser = selfWon ? oppName : state.org.name;
    return selfIsA ? { winner, loser, scoreA:winsSelf, scoreB:winsOpp } : { winner, loser, scoreA:winsOpp, scoreB:winsSelf };
  }
  const pool = ensureGCTeamPool();
  const teamA = pool[nameA], teamB = pool[nameB];
  if(!teamA || !teamB){
    // Filet de sécurité (ex. un nom vient d'être retiré du vivier via
    // adoptGCRoster entre la construction du champ et sa résolution) :
    // repli sur le même tirage pondéré par force que pour le joueur.
    const p = matchupWinProbability(gcTeamStrength(nameA), gcTeamStrength(nameB));
    let winsA=0, winsB=0;
    while(winsA<needed && winsB<needed){ if(Math.random()<p) winsA++; else winsB++; }
    const winner = winsA>winsB ? nameA : nameB;
    const loser = winner===nameA?nameB:nameA;
    maybeGenerateSocialWorldMatchResult('valorant_gc', { home:winner, away:loser, sh:Math.max(winsA,winsB), sa:Math.min(winsA,winsB) });
    return { winner, loser, scoreA:winsA, scoreB:winsB };
  }
  ensureTeamRoster('valorant_gc', teamA); ensureTeamRoster('valorant_gc', teamB);
  const series = simulateSeries('valorant_gc', teamA, teamB, format);
  const winner = series.aWinsSeries ? nameA : nameB;
  applyGCCashCupPhaseStats(series, nameA, nameB);
  const loser = winner===nameA?nameB:nameA;
  maybeGenerateSocialWorldMatchResult('valorant_gc', { home:winner, away:loser, sh:Math.max(series.winsA,series.winsB), sa:Math.min(series.winsA,series.winsB) });
  return { winner, loser, scoreA:series.winsA, scoreB:series.winsB };
}

// Champ du mois : les 10 organisations affiliées de TA région + toi (si ta
// section GC est active) + assez de rosters du vivier (state.gcTeamPool,
// même région) pour compléter jusqu'à la taille de champ retenue.
// includeSelf=false quand l'invitation a été refusée (voir
// declineGCCashCupInvite/catchUpGCCashCupEmea) — le Cash Cup a bien lieu
// pour tout le monde, seule votre organisation n'y figure pas ce mois-ci.
function buildGCCashCupField(includeSelf=true){
  const region = myValorantGCRegion();
  const pool = ensureGCTeamPool();
  const names = new Set(myGCAffiliatedTeams());
  if(includeSelf && state.sections.includes('valorant_gc')) names.add(state.org.name);
  const target = gcCashCupFieldSize();
  // Uniquement des équipes de TA région (le vivier state.gcTeamPool couvre
  // les 4 régions depuis GC_TEAMS_BY_REGION, voir ensureGCTeamPool) — sans
  // ce filtre, une organisation affiliée à une AUTRE région se retrouverait
  // à tort dans ton champ de Cash Cup.
  const fillers = shuffle(Object.keys(pool).filter(n=>!names.has(n) && pool[n].region===region));
  let i=0;
  while(names.size<target && i<fillers.length) names.add(fillers[i++]);
  return shuffle([...names]);
}

// --- Open Qualifier (jour 1-2, mois où le format tiré au sort l'inclut) --
// Les organisations VST Game Changers (GC_TEAMS_EMEA) et le joueur (s'il
// participe) sont qualifiés d'office pour la phase de groupes — le joueur
// ne dispute donc jamais l'Open Qualifier lui-même, seule l'issue des
// autres équipes du champ y est en jeu. Le reste se départage en UN seul
// round à élimination simple en Bo1 (simplification assumée pour tenir
// dans la fenêtre de 2 jours plutôt que plusieurs tours "précoces/décisifs"
// complets) : la moitié survit et rejoint la phase de groupes, l'autre est
// éliminée avant même d'y goûter — exactement comme un vrai Open Qualifier
// réduit un vivier plus large que le nombre de places disponibles.
function buildGCCashCupQualifier(field){
  const preQualified = field.filter(n=> myGCAffiliatedTeams().includes(n) || n===state.org.name);
  const rest = shuffle(field.filter(n=> !preQualified.includes(n)));
  const matches = [];
  for(let i=0;i<rest.length-1;i+=2) matches.push({ a:rest[i], b:rest[i+1], winner:null });
  const bye = rest.length%2===1 ? rest[rest.length-1] : null;
  return { preQualified, matches, bye, resolved:false };
}
function resolveGCCashCupQualifier(qual){
  if(qual.resolved) return;
  qual.matches.forEach(m=>{
    if(m.winner) return;
    const r = resolveGCCashCupMatch(m.a, m.b, 'bo1');
    m.winner = r.winner;
  });
  if(qual.matches.every(m=>m.winner)) qual.resolved = true;
}
function gcCashCupQualifierSurvivors(qual){
  const winners = qual.matches.map(m=>m.winner).filter(Boolean);
  return [...qual.preQualified, ...winners, ...(qual.bye?[qual.bye]:[])];
}

// Répartit une liste d'équipes (champ complet, ou survivantes de l'Open
// Qualifier — taille variable selon le format du mois) en groupes de 4-5,
// le dernier groupe absorbant le reste plutôt que de laisser un groupe non
// viable de 1-2 équipes.
// Toujours exactement 8 groupes (GC_CASHCUP_GROUP_SIZES.length), quelle
// que soit la taille du champ (38 en temps normal, moins après un Open
// Qualifier qui a éliminé la moitié du reste) — buildGCCashCupPlayoffBracket/
// resolveGCCashCupRound16 supposent 16 qualifiées (2 par groupe → un
// bracket round16 à taille fixe) : seule la TAILLE de chaque groupe varie
// (3 à 5 selon le champ), jamais leur NOMBRE.
function bucketIntoGCCashCupGroups(teamNames){
  const shuffled = shuffle([...teamNames]);
  const total = shuffled.length;
  const groupCount = GC_CASHCUP_GROUP_SIZES.length;
  const groups = {};
  let idx = 0;
  for(let gi=0; gi<groupCount; gi++){
    const remainingGroups = groupCount - gi;
    const remainingTeams = total - idx;
    const size = gi===groupCount-1 ? remainingTeams : Math.max(2, Math.round(remainingTeams / remainingGroups));
    const key = String.fromCharCode(65+gi);
    const names = shuffled.slice(idx, idx+size);
    groups[key] = { teams: names.map(name=>({ name, w:0, l:0, mapsFor:0, mapsAgainst:0 })), roundIndex:0 };
    idx += names.length;
  }
  return groups;
}
// groupFormat détermine le calendrier des groupes : round-robin classique
// précalculé (Bo3/Bo1) ou Suisse — apparié dynamiquement round par round
// selon le bilan (voir pairGCCashCupSwissRound), donc jamais précalculé ici.
function initGCCashCupGroups(teamNames, groupFormat){
  const groups = bucketIntoGCCashCupGroups(teamNames);
  if(groupFormat!=='swiss'){
    Object.values(groups).forEach(g=>{ g.rounds = generateRoundRobinRounds(g.teams.map(t=>t.name)); });
  }
  return groups;
}
// Nombre de rounds Suisse pour un groupe donné — plafonné à 3 pour tenir
// dans la fenêtre jour 6-8 (voir GC_CASHCUP_GROUPS_WINDOW), toujours
// inférieur au round-robin complet (n-1 rounds) : c'est tout l'intérêt du
// Suisse, un classement fiable en moins de rencontres.
function gcCashCupSwissRoundsTarget(group){
  if(group.swissRoundsTarget===undefined) group.swissRoundsTarget = Math.max(1, Math.min(3, group.teams.length-1));
  return group.swissRoundsTarget;
}
// Appariement Suisse standard : trie par bilan (victoires desc, défaites
// asc), apparie les équipes adjacentes en évitant les revanches déjà
// jouées ce mois-ci (group.swissPlayed) — repli sur un appariement direct
// si aucun adversaire inédit n'est disponible (groupes réduits à 4-5
// équipes, un croisement répété devient vite inévitable).
function pairGCCashCupSwissRound(group){
  const played = group.swissPlayed || (group.swissPlayed = {});
  const sorted = [...group.teams].sort((a,b)=> b.w-a.w || a.l-b.l);
  const used = new Set();
  const pairs = [];
  sorted.forEach((t,i)=>{
    if(used.has(t.name)) return;
    let opp = null;
    for(let j=i+1;j<sorted.length;j++){
      const o = sorted[j];
      if(used.has(o.name)) continue;
      const key = [t.name,o.name].sort().join('|');
      if(!played[key]){ opp = o; break; }
    }
    if(!opp){
      for(let j=i+1;j<sorted.length;j++){ const o=sorted[j]; if(!used.has(o.name)){ opp=o; break; } }
    }
    if(opp){
      used.add(t.name); used.add(opp.name);
      played[[t.name,opp.name].sort().join('|')] = true;
      pairs.push([t.name, opp.name]);
    }
  });
  return pairs;
}
// Source commune des paires du round en cours — round-robin précalculé, ou
// appariement Suisse mis en cache le temps que le round se termine (le
// même round ne doit pas se ré-apparier au hasard entre deux appels du
// même jour, voir resolveGCCashCupGroupRound/completePendingGCCashCupMatch).
function currentGCCashCupGroupPairs(group, groupFormat){
  if(groupFormat==='swiss') return group.swissCurrentPairs || (group.swissCurrentPairs = pairGCCashCupSwissRound(group));
  return (group.rounds && group.rounds[group.roundIndex]) || [];
}
function gcCashCupGroupRoundTarget(group, groupFormat){
  return groupFormat==='swiss' ? gcCashCupSwissRoundsTarget(group) : (group.rounds ? group.rounds.length : 0);
}
function allGCCashCupGroupsDone(groups, groupFormat){
  return Object.values(groups).every(g=> g.roundIndex >= gcCashCupGroupRoundTarget(g, groupFormat));
}

function gcCashCupGroupStandings(group){
  return [...group.teams].sort((a,b)=> (b.w-a.w) || ((b.mapsFor-b.mapsAgainst)-(a.mapsFor-a.mapsAgainst)) || (b.mapsFor-a.mapsFor));
}

function applyGCCashCupGroupResult(group, nameA, nameB, result){
  const ta = group.teams.find(t=>t.name===nameA), tb = group.teams.find(t=>t.name===nameB);
  if(!ta || !tb) return;
  if(result.winner===nameA){ ta.w++; tb.l++; } else { tb.w++; ta.l++; }
  ta.mapsFor += result.scoreA; ta.mapsAgainst += result.scoreB;
  tb.mapsFor += result.scoreB; tb.mapsAgainst += result.scoreA;
}

// Programme le match du jour du joueur (Cash Cup) — même idiome que
// tryScheduleSelfRLCSMatch (script.js) : un vrai événement calendrier,
// bloquant l'avancée du jour tant qu'il n'est pas joué. La GC garde AUSSI
// sa propre ligue domestique générique (state.standings.valorant_gc, voir
// generateStandings) avec ses propres jours de match seedés par
// seedCalendarForMonth — un jour de checkpoint Cash Cup peut donc tomber
// sur un jour déjà occupé par un match de championnat classique. Dans ce
// cas on NE POSE PAS pendingMatch (sinon il resterait bloqué pour de bon,
// sans événement calendrier réel pour le débloquer) : on renvoie false, le
// round reste non résolu et sera retenté au prochain jour de checkpoint.
function tryScheduleSelfGCCashCupMatch(stage, key, extra){
  const cup = state.gcCashCupEmea;
  if(cup.pendingMatch) return true;
  const evKey = eventKey('valorant_gc', state.date.year, state.date.month, state.date.day);
  const existingMatch = (state.calendarEvents[evKey]||[]).find(e=>e.type==='match');
  if(existingMatch) return false; // jour déjà pris par la ligue domestique GC — on réessaiera plus tard
  let opponentName, mapsToWin;
  if(stage==='groups'){
    opponentName = extra;
    mapsToWin = cup.format.groupFormat==='bo3' ? 2 : 1; // Bo1 en Suisse comme en groupes Bo1
    cup.pendingMatch = { stage, groupKey:key, opponentName, mapsToWin };
  } else {
    const m = extra.m;
    opponentName = m.a===state.org.name ? m.b : m.a;
    mapsToWin = m.mapsToWin || 2;
    cup.pendingMatch = { stage, round:key, idx:extra.idx, opponentName, mapsToWin };
  }
  state.calendarEvents[evKey] = state.calendarEvents[evKey] || [];
  state.calendarEvents[evKey].push({ type:'match', label:`vs ${opponentName}`, opponent:opponentName, played:false, gcCashCupRef:true });
  pushNotification(`🏆 Votre match Cash Cup ${gcRegionLabel()} contre ${opponentName} est prêt, cliquez sur "Jouer le match" !`);
  return true;
}

function resolveGCCashCupGroupRound(groups, groupFormat){
  const matchFormat = groupFormat==='bo3' ? 'bo3' : 'bo1'; // Bo1 en Suisse comme en groupes Bo1
  Object.entries(groups).forEach(([key, group])=>{
    if(group.roundIndex >= gcCashCupGroupRoundTarget(group, groupFormat)) return;
    const pairs = currentGCCashCupGroupPairs(group, groupFormat);
    const myPair = pairs.find(p=>p.includes(state.org.name));
    if(myPair){
      if(!state.gcCashCupEmea.pendingMatch){
        tryScheduleSelfGCCashCupMatch('groups', key, myPair[0]===state.org.name?myPair[1]:myPair[0]);
      }
      return; // ce groupe n'avance pas tant que le match du joueur n'est pas joué
    }
    pairs.forEach(([a,b])=>{
      const r = resolveGCCashCupMatch(a, b, matchFormat);
      applyGCCashCupGroupResult(group, a, b, r);
    });
    group.roundIndex++;
    if(groupFormat==='swiss') delete group.swissCurrentPairs; // round suivant : nouvel appariement à recalculer selon le bilan à jour
  });
}

function resolveGCCashCupRound16(bracket){
  bracket.round16.forEach((m,idx)=>{
    if(!m.a || !m.b || m.winner) return;
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCCashCupMatch('playoffs', 'round16', {idx,m}); return; }
    Object.assign(m, resolveGCCashCupMatch(m.a, m.b, 'bo3'));
  });
  if(bracket.round16.some(m=>m.a && m.b && !m.winner)) return;
  for(let i=0;i<4;i++){
    bracket.quarters[i].a = bracket.round16[i*2].winner;
    bracket.quarters[i].b = bracket.round16[i*2+1].winner;
  }
}
function resolveGCCashCupQuarters(bracket){
  bracket.quarters.forEach((m,idx)=>{
    if(!m.a || !m.b || m.winner) return;
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCCashCupMatch('playoffs', 'quarters', {idx,m}); return; }
    Object.assign(m, resolveGCCashCupMatch(m.a, m.b, 'bo3'));
  });
  if(bracket.quarters.some(m=>m.a && m.b && !m.winner)) return;
  bracket.semis[0].a=bracket.quarters[0].winner; bracket.semis[0].b=bracket.quarters[1].winner;
  bracket.semis[1].a=bracket.quarters[2].winner; bracket.semis[1].b=bracket.quarters[3].winner;
}
function resolveGCCashCupSemis(bracket){
  bracket.semis.forEach((m,idx)=>{
    if(!m.a || !m.b || m.winner) return;
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCCashCupMatch('playoffs', 'semis', {idx,m}); return; }
    Object.assign(m, resolveGCCashCupMatch(m.a, m.b, 'bo3'));
  });
  if(bracket.semis.some(m=>!m.winner)) return;
  bracket.final.a = bracket.semis[0].winner; bracket.final.b = bracket.semis[1].winner;
}
function resolveGCCashCupFinal(bracket){
  const m = bracket.final;
  if(!m.a || !m.b) return;
  if(!m.winner){
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCCashCupMatch('playoffs', 'final', {idx:0,m}); return; }
    Object.assign(m, resolveGCCashCupMatch(m.a, m.b, 'bo5'));
  }
  if(bracket.champion) return;
  bracket.champion = m.winner;
  bracket.viceChampion = m.winner===m.a ? m.b : m.a;
}
function resolveGCCashCupPlayoffRound(cup){
  resolveGCCashCupRound16(cup.bracket);
  resolveGCCashCupQuarters(cup.bracket);
  resolveGCCashCupSemis(cup.bracket);
  resolveGCCashCupFinal(cup.bracket);
}

function buildGCCashCupPlayoffBracket(groups){
  const qualifiers = [];
  Object.values(groups).forEach(g=> qualifiers.push(...gcCashCupGroupStandings(g).slice(0,2).map(t=>t.name)));
  const seeded = [...qualifiers].sort((a,b)=> gcTeamStrength(b)-gcTeamStrength(a));
  const mk = (mapsToWin=2)=>({ a:null, b:null, scoreA:null, scoreB:null, winner:null, loser:null, mapsToWin });
  const n = seeded.length;
  const round16 = [];
  for(let i=0;i<n/2;i++){ const m=mk(); m.a=seeded[i]; m.b=seeded[n-1-i]; round16.push(m); }
  return { seeds:seeded, round16, quarters:[mk(),mk(),mk(),mk()], semis:[mk(),mk()], final:mk(3), champion:null, viceChampion:null };
}

// Archive légère des champions GC (Cash Cup + Stage 1), consultée par
// l'onglet Histoire du Season Hub (voir renderGCSeasonHubHistory) — même
// principe que state.vct.historyLog côté Valostrike classique, mais réduit
// au strict nécessaire (année, compétition, champion) puisque GC n'a pas
// encore de classement de saison à archiver dessus.
function pushGCCompetitionHistory(entry){
  state.gcCompetitionHistory = state.gcCompetitionHistory || [];
  state.gcCompetitionHistory.unshift(entry);
}
function awardGCCashCupPrize(cup){
  if(cup.prizeAwarded) return;
  cup.prizeAwarded = true;
  awardGCCashCupSeasonPoints(cup);
  const champion = cup.bracket.champion;
  const region = gcRegionLabel();
  pushGCCompetitionHistory({ year:cup.year, month:cup.month, competition:`Cash Cup ${region}`, label:`Cash Cup, ${MONTH_NAMES[cup.month]} ${cup.year}`, champion, isSelf: champion===state.org.name });
  if(champion===state.org.name){
    state.budget += GC_CASHCUP_PRIZE;
    recordTransaction('valorant_gc', 'other', `Cash Cup ${region}, prime de victoire`, GC_CASHCUP_PRIZE);
    state.reputation = Math.min(100, (state.reputation||0) + 2);
    pushNotification(`🏆 ${state.org.name} remporte le Cash Cup ${region} ! Prime : ${formatMoney(GC_CASHCUP_PRIZE)}.`);
    pushNews(`${state.org.name} sacré champion du Cash Cup ${region} (Valostrike GC).`, 'result', 'valorant_gc');
  } else {
    pushNews(`${champion} remporte le Cash Cup ${region} (Valostrike GC) ce mois-ci.`);
  }
}

// Complète le match Cash Cup du joueur une fois joué (voir playMatchNow/
// finalizeMatchResult, script.js) — même idiome que
// completePendingRLCSBracketMatch : applique le résultat réel à la bonne
// case (groupe ou bracket de playoffs), puis relance la résolution.
function completePendingGCCashCupMatch(matchResult){
  const cup = state.gcCashCupEmea;
  const pending = cup && cup.pendingMatch;
  if(!pending) return;
  const selfWon = !!matchResult.won;
  const winner = selfWon ? state.org.name : pending.opponentName;
  const loser = selfWon ? pending.opponentName : state.org.name;
  let selfWins = matchResult.dayMatch ? matchResult.dayMatch.sh : (selfWon?pending.mapsToWin:0);
  let oppWins = matchResult.dayMatch ? matchResult.dayMatch.sa : (selfWon?0:pending.mapsToWin);
  const need = pending.mapsToWin||2;
  if(selfWon && selfWins<need) selfWins = need;
  if(!selfWon && oppWins<need) oppWins = need;

  if(pending.stage==='groups'){
    const group = cup.groups[pending.groupKey];
    if(group){
      applyGCCashCupGroupResult(group, state.org.name, pending.opponentName, { winner, scoreA:selfWins, scoreB:oppWins });
      const matchFormat = cup.format.groupFormat==='bo3' ? 'bo3' : 'bo1';
      const pairs = currentGCCashCupGroupPairs(group, cup.format.groupFormat);
      pairs.forEach(([a,b])=>{
        if(a===state.org.name || b===state.org.name) return;
        const r = resolveGCCashCupMatch(a, b, matchFormat);
        applyGCCashCupGroupResult(group, a, b, r);
      });
      group.roundIndex++;
      if(cup.format.groupFormat==='swiss') delete group.swissCurrentPairs;
    }
  } else {
    const bracket = cup.bracket;
    const m = pending.round==='final' ? bracket.final : (bracket && bracket[pending.round] && bracket[pending.round][pending.idx]);
    if(m){
      if(m.a===state.org.name){ m.scoreA=selfWins; m.scoreB=oppWins; } else { m.scoreA=oppWins; m.scoreB=selfWins; }
      m.winner = winner;
      if('loser' in m) m.loser = loser;
    }
  }
  cup.pendingMatch = null;
  if(pending.stage==='playoffs'){
    resolveGCCashCupPlayoffRound(cup);
    if(cup.bracket && cup.bracket.champion) awardGCCashCupPrize(cup);
  }
}

function ensureGCCashCupEmea(){
  return state.gcCashCupEmea;
}
// Calendrier fixe mensuel (voir GC_CASHCUP_*_WINDOW plus haut) — chaque
// phase reste gardée par sa fenêtre de jours, mais garde l'esprit
// "auto-réparation" de la version précédente : un round bloqué un jour
// (collision avec la ligue domestique GC) se rattrape le lendemain, et si
// la fenêtre est sur le point de se refermer sans que tout soit joué, on
// enchaîne les rounds restants le même jour (guard anti-boucle infinie)
// plutôt que de déborder sur la phase suivante ou de rester bloqué pour de
// bon. Le seul cas où on attend vraiment, c'est un match du JOUEUR encore
// en attente (jamais résolu automatiquement, voir pendingMatch).
function catchUpGCCashCupEmea(){
  // Le Cash Cup EMEA n'est qu'un tournoi de comblement HORS stage (voir
  // prompt du chantier) — se met en pause pendant toute la fenêtre
  // hivernale (voir isGCCashCupOffSeason : début novembre jusqu'à la fin
  // du Stage 1, qui prend le relais comme compétition principale du 26
  // janvier au 22 février). Se remet en route automatiquement le 23
  // février : cup.month/cup.year!==d.month/d.year déclenche alors un
  // nouveau cycle normalement.
  if(isGCCashCupOffSeason(state.date)) return;
  checkGCCashCupInvite();
  const d = state.date;
  let cup = state.gcCashCupEmea;

  if(!cup || cup.month!==d.month || cup.year!==d.year){
    // Nouveau mois : reprend le format/la participation décidés à
    // l'invitation (voir sendGCCashCupInviteMail) si elle correspond bien
    // à ce mois ; sinon (section rejointe en cours de partie sans être
    // passée par une invitation, ex. via Slots) valeurs par défaut —
    // format tiré à la volée, participation acceptée d'office.
    const pending = state.gcCashCupPending;
    const usesPending = pending && pending.year===d.year && pending.month===d.month;
    const format = usesPending ? pending.format : rollGCCashCupFormat();
    const participating = !(usesPending && pending.participating===false);
    cup = state.gcCashCupEmea = {
      month:d.month, year:d.year, format, participating,
      phase: format.hasQualifier ? 'qualifier' : 'groups',
      qualifier:null, groups:null, bracket:null,
      prizeAwarded:false, pendingMatch:null, deadWindowNoticeSent:false,
    };
    if(usesPending) state.gcCashCupPending = null;
  }

  if(cup.phase==='qualifier'){
    if(d.day < GC_CASHCUP_QUALIFIER_WINDOW[0]) return; // pas encore ouvert
    if(!cup.qualifier) cup.qualifier = buildGCCashCupQualifier(buildGCCashCupField(cup.participating));
    resolveGCCashCupQualifier(cup.qualifier);
    const overdue = d.day > GC_CASHCUP_QUALIFIER_WINDOW[1];
    if(cup.qualifier.resolved || overdue){
      if(!cup.qualifier.resolved){
        // Filet de sécurité : la fenêtre se referme, force les derniers matchs.
        cup.qualifier.matches.forEach(m=>{ if(!m.winner){ const r=resolveGCCashCupMatch(m.a,m.b,'bo1'); m.winner=r.winner; } });
        cup.qualifier.resolved = true;
      }
      cup.groups = initGCCashCupGroups(gcCashCupQualifierSurvivors(cup.qualifier), cup.format.groupFormat);
      cup.phase = 'groups';
    }
    return;
  }

  if(cup.phase==='groups'){
    if(d.day < GC_CASHCUP_GROUPS_WINDOW[0]) return; // pas encore ouvert (n'arrive que si le mois n'a pas d'Open Qualifier)
    if(!cup.groups) cup.groups = initGCCashCupGroups(buildGCCashCupField(cup.participating), cup.format.groupFormat);
    resolveGCCashCupGroupRound(cup.groups, cup.format.groupFormat);
    const overdue = d.day > GC_CASHCUP_GROUPS_WINDOW[1];
    if(overdue){
      let guard = 0;
      while(!allGCCashCupGroupsDone(cup.groups, cup.format.groupFormat) && !cup.pendingMatch && guard<12){
        resolveGCCashCupGroupRound(cup.groups, cup.format.groupFormat);
        guard++;
      }
    }
    if(allGCCashCupGroupsDone(cup.groups, cup.format.groupFormat)){
      cup.bracket = buildGCCashCupPlayoffBracket(cup.groups);
      cup.phase = 'playoffs';
    }
    return;
  }

  if(cup.phase==='playoffs'){
    if(d.day < GC_CASHCUP_PLAYOFFS_WINDOW[0]) return;
    resolveGCCashCupPlayoffRound(cup);
    const overdue = d.day > GC_CASHCUP_PLAYOFFS_WINDOW[1];
    if(overdue){
      let guard = 0;
      while(!(cup.bracket && cup.bracket.champion) && !cup.pendingMatch && guard<8){
        resolveGCCashCupPlayoffRound(cup);
        guard++;
      }
    }
    // Le champion peut être décidé sans que le joueur ait joué la toute
    // dernière rencontre (déjà éliminé plus tôt, ou finale 100% IA) — sans
    // cet appel ici (en plus de celui, redondant mais nécessaire, dans
    // completePendingGCCashCupMatch pour le cas où c'est justement LE
    // joueur qui vient de jouer la finale), la prime ne serait jamais
    // distribuée et la phase resterait bloquée sur 'playoffs' pour de bon.
    // awardGCCashCupPrize est idempotente (garde prizeAwarded), sûr d'appeler deux fois.
    if(cup.bracket && cup.bracket.champion) awardGCCashCupPrize(cup);
    if(cup.bracket && cup.bracket.champion && cup.prizeAwarded) cup.phase = 'done';
    return;
  }

  // Fenêtre morte (jour 16-fin) : aucune activité Cash Cup, place au Split/
  // à la ligue domestique GC. Signalée une seule fois (léger clin d'œil
  // scouting, aucune mécanique de recrutement dédiée — les rosters
  // repérés restent recrutables via les canaux existants : Mercato,
  // adoption de rosters orgless).
  if(cup.phase==='done' && !cup.deadWindowNoticeSent && d.day>=GC_CASHCUP_DEAD_WINDOW_START){
    cup.deadWindowNoticeSent = true;
    pushNews(`Fenêtre de recrutement post-Cash Cup ${gcRegionLabel()} ouverte : plusieurs rosters repérés ce mois-ci attirent l'attention des recruteurs.`);
  }
}

/* ============================================================
   CASH CUP DES AUTRES RÉGIONS — simulation d'arrière-plan pour les 3
   régions GC que le joueur ne joue pas (voir demande explicite : "je veux
   le classement des autres régions en temps réel"). Jusqu'ici, seule LA
   région choisie par le joueur (myValorantGCRegion) tournait — les 3
   autres n'avaient tout simplement aucun état. Réutilise EXACTEMENT le
   même moteur de résolution que le Cash Cup du joueur
   (initGCCashCupGroups/resolveGCCashCupGroupRound/allGCCashCupGroupsDone/
   buildGCCashCupPlayoffBracket/resolveGCCashCupPlayoffRound) plutôt que
   d'en écrire une copie : ces fonctions vérifient déjà `m.a===state.org.name`
   avant de programmer un match du joueur (tryScheduleSelfGCCashCupMatch) —
   comme l'organisation du joueur n'apparaît JAMAIS dans le champ d'une
   AUTRE région (buildGCCashCupFieldForRegion ne l'ajoute jamais), cette
   branche ne se déclenche simplement jamais ici : chaque match se résout
   directement en IA-vs-IA, aucun état "en attente" possible, donc aucun
   risque de bloquer la partie sur une de ces 3 régions.
   Volontairement scopé au Cash Cup mensuel (seule compétition GC dont le
   format est déjà générique par région) — Kickoff/Stage 1/Promo-Relégation
   restent hors périmètre (cohérent avec le reste de la session : chantier
   séparé si un jour demandé). */
function buildGCCashCupFieldForRegion(region){
  const pool = ensureGCTeamPool();
  const names = new Set(GC_TEAMS_BY_REGION[region] || []);
  const target = gcCashCupFieldSize();
  const fillers = shuffle(Object.keys(pool).filter(n=>!names.has(n) && pool[n].region===region));
  let i=0;
  while(names.size<target && i<fillers.length) names.add(fillers[i++]);
  return shuffle([...names]);
}
// Points de saison Cash Cup, scopés par région (jamais mélangés à
// state.gcCashCupSeasonPoints, réservé à la région du joueur — sinon des
// équipes d'autres régions viendraient polluer l'onglet "Cash Cup (saison)"
// de la région du joueur). Pas de prime/réputation/historique ici : ces
// conséquences n'ont de sens que pour une région où le joueur a réellement
// une organisation.
function awardGCOtherRegionCashCupPoints(cup, region){
  if(!cup.bracket || !cup.bracket.champion || cup.pointsAwarded) return;
  cup.pointsAwarded = true;
  if(!state.gcOtherRegionsCashCupPoints) state.gcOtherRegionsCashCupPoints = {};
  const bucket = state.gcOtherRegionsCashCupPoints[region] = state.gcOtherRegionsCashCupPoints[region] || {};
  const add = (name, pts)=>{ if(name) bucket[name] = (bucket[name]||0) + pts; };
  const b = cup.bracket;
  add(b.champion, GC_CASHCUP_POINTS_BY_TIER.champion);
  add(b.final.loser, GC_CASHCUP_POINTS_BY_TIER.finalist);
  b.semis.forEach(m=> add(m.loser, GC_CASHCUP_POINTS_BY_TIER.semifinalist));
  b.quarters.forEach(m=> add(m.loser, GC_CASHCUP_POINTS_BY_TIER.quarterfinalist));
  b.round16.forEach(m=> add(m.loser, GC_CASHCUP_POINTS_BY_TIER.round16));
  const playoffTeams = new Set(b.seeds);
  Object.values(cup.groups||{}).forEach(g=>{
    gcCashCupGroupStandings(g).forEach(t=>{ if(!playoffTeams.has(t.name)) add(t.name, GC_CASHCUP_POINTS_BY_TIER.groups); });
  });
}
// Même idiome "fenêtre + rattrapage" que catchUpGCCashCupEmea, mais sans
// aucun des mécanismes propres au joueur (invitation par mail, participation,
// pendingMatch/événement calendrier, prime en budget, notification) —
// une région où le joueur n'a pas d'organisation continue simplement de
// vivre en arrière-plan.
function catchUpGCOtherRegionsCashCupForRegion(region){
  if(isGCCashCupOffSeason(state.date)) return;
  if(!state.gcOtherRegionsCashCup) state.gcOtherRegionsCashCup = {};
  const d = state.date;
  let cup = state.gcOtherRegionsCashCup[region];

  if(!cup || cup.month!==d.month || cup.year!==d.year){
    cup = state.gcOtherRegionsCashCup[region] = {
      month:d.month, year:d.year, format: rollGCCashCupFormat(),
      phase:'groups', groups:null, bracket:null, pointsAwarded:false,
    };
  }

  if(cup.phase==='groups'){
    if(d.day < GC_CASHCUP_GROUPS_WINDOW[0]) return;
    if(!cup.groups) cup.groups = initGCCashCupGroups(buildGCCashCupFieldForRegion(region), cup.format.groupFormat);
    resolveGCCashCupGroupRound(cup.groups, cup.format.groupFormat);
    if(d.day > GC_CASHCUP_GROUPS_WINDOW[1]){
      let guard = 0;
      while(!allGCCashCupGroupsDone(cup.groups, cup.format.groupFormat) && guard<12){
        resolveGCCashCupGroupRound(cup.groups, cup.format.groupFormat);
        guard++;
      }
    }
    if(allGCCashCupGroupsDone(cup.groups, cup.format.groupFormat)){
      cup.bracket = buildGCCashCupPlayoffBracket(cup.groups);
      cup.phase = 'playoffs';
    }
    return;
  }

  if(cup.phase==='playoffs'){
    if(d.day < GC_CASHCUP_PLAYOFFS_WINDOW[0]) return;
    resolveGCCashCupPlayoffRound(cup);
    if(d.day > GC_CASHCUP_PLAYOFFS_WINDOW[1]){
      let guard = 0;
      while(!(cup.bracket && cup.bracket.champion) && guard<8){
        resolveGCCashCupPlayoffRound(cup);
        guard++;
      }
    }
    if(cup.bracket && cup.bracket.champion){
      awardGCOtherRegionCashCupPoints(cup, region);
      cup.phase = 'done';
    }
  }
}
function catchUpGCOtherRegionsCashCup(){
  const myRegion = myValorantGCRegion();
  Object.keys(GC_REGION_LABELS).forEach(region=>{
    if(region===myRegion) return;
    catchUpGCOtherRegionsCashCupForRegion(region);
  });
}

/* ============================================================
   STAGE 1 DES AUTRES RÉGIONS — même principe que le Cash Cup des autres
   régions ci-dessus : simulation d'arrière-plan du Stage 1 pour les 3
   régions GC que le joueur ne joue pas (demande explicite : "j'ai pas la
   vision sur les VST 1/2/3" puis "créer les VST pour les autres régions").
   Réutilise TEL QUEL le moteur déjà générique du Stage 1 EMEA
   (resolveGCStage1GroupRound/resolveGCStage1PlayoffRound/buildGCStage1Bracket/
   gcStage1Standings/gcStage1Placements ne touchent state.gcStage1Emea QUE
   dans la branche "c'est le match du joueur", qui ne se déclenche jamais
   ici puisque l'org du joueur n'apparaît jamais dans le champ d'une autre
   région) — seule la plomberie propre à CE state (champ, cycle quotidien,
   points de circuit) est dupliquée, région par région.
   Simplification assumée (signalée) : le Stage 1 du joueur tire son champ
   des qualifiés du Kickoff de l'année (buildGCStage1Field) — le Kickoff
   n'est PAS simulé pour les 3 autres régions (comme le Cash Cup avant ce
   chantier ; chantier séparé, non demandé ici). Le champ des autres
   régions est donc construit directement à partir de leurs organisations
   affiliées réelles + du vivier régional (même principe que
   buildGCCashCupFieldForRegion), sans étape de qualification Kickoff.
   ============================================================ */
function buildGCStage1FieldForRegion(region){
  const pool = ensureGCTeamPool();
  const names = new Set(GC_TEAMS_BY_REGION[region] || []);
  const fillers = shuffle(Object.keys(pool).filter(n=>!names.has(n) && pool[n].region===region));
  let i=0;
  while(names.size<GC_VCT_GC_ROSTER_SIZE && i<fillers.length) names.add(fillers[i++]);
  return shuffle([...names]);
}
// Points de circuit Stage 1/2/3, scopés par région ET par année — jamais
// mélangés à state.gcEmeaSeasonPoints, réservé à la région du joueur
// (même raison que awardGCOtherRegionCashCupPoints ci-dessus).
function ensureGCOtherRegionPointsYear(region, year){
  if(!state.gcOtherRegionsSeasonPoints) state.gcOtherRegionsSeasonPoints = {};
  if(!state.gcOtherRegionsSeasonPoints[region]) state.gcOtherRegionsSeasonPoints[region] = {};
  const byRegion = state.gcOtherRegionsSeasonPoints[region];
  if(!byRegion[year]) byRegion[year] = { totals:{}, byStage:{ stage1:{}, stage2:{}, stage3:{} } };
  return byRegion[year];
}
function awardGCOtherRegionStagePoints(stageKey, region, year, placements){
  const bucket = ensureGCOtherRegionPointsYear(region, year);
  const table = GC_STAGE_POINTS_TABLE[stageKey];
  (placements||[]).slice(0,6).forEach((name, idx)=>{
    if(!name) return;
    const rank = idx+1;
    const pts = table[rank]!==undefined ? table[rank] : (rank>=5 ? table['5-6'] : undefined);
    if(pts===undefined) return;
    bucket.totals[name] = (bucket.totals[name]||0) + pts;
    bucket.byStage[stageKey][name] = pts;
  });
}
function catchUpGCOtherRegionsStage1ForRegion(region){
  const d = state.date;
  if(!isGCStage1Window(d)) return;
  if(!state.gcOtherRegionsStage1) state.gcOtherRegionsStage1 = {};
  let s1 = state.gcOtherRegionsStage1[region];
  if(!s1 || s1.year!==d.year){
    const field = buildGCStage1FieldForRegion(region);
    s1 = state.gcOtherRegionsStage1[region] = {
      year:d.year, phase:'groups',
      stage: { teams: field.map(name=>({name,w:0,l:0,mapsFor:0,mapsAgainst:0})), rounds: generateRoundRobinRounds(field), roundIndex:0 },
      bracket:null, prizeAwarded:false,
    };
  }
  if(s1.phase==='groups'){
    resolveGCStage1GroupRound(s1.stage);
    if(s1.stage.roundIndex >= s1.stage.rounds.length){
      s1.bracket = buildGCStage1Bracket(s1.stage);
      s1.phase = 'playoffs';
    }
    return;
  }
  if(s1.phase==='playoffs'){
    resolveGCStage1PlayoffRound(s1);
    if(s1.bracket.champion && !s1.prizeAwarded){
      s1.prizeAwarded = true;
      awardGCOtherRegionStagePoints('stage1', region, s1.year, gcStage1Placements(s1));
      s1.phase = 'done';
    }
  }
}
function catchUpGCOtherRegionsStage1(){
  const myRegion = myValorantGCRegion();
  Object.keys(GC_REGION_LABELS).forEach(region=>{
    if(region===myRegion) return;
    catchUpGCOtherRegionsStage1ForRegion(region);
  });
}
// Panneau Stage 1 EN DIRECT d'une autre région GC — même présentation que
// renderGCStage1Panel (Stage 1 de la région du joueur), alimentée par
// state.gcOtherRegionsStage1[region].
function renderGCOtherRegionStage1Panel(region){
  const label = GC_REGION_LABELS[region] || region;
  const s1 = (state.gcOtherRegionsStage1||{})[region];
  if(!s1){
    return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-trophy"></i><div>Le Stage 1 ${label} n'a pas encore commencé.</div></div>`;
  }
  if(s1.phase==='groups'){
    return `
      <div class="card info-card">
        <div style="font-weight:700;margin-bottom:8px;">Stage 1 ${label} — Classement, phase de groupe</div>
        ${gcStage1Standings(s1.stage).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
      </div>
    `;
  }
  if(s1.phase==='playoffs'){
    return renderKickoffBracketColumns([
      { label:'Demi-finales', matches: s1.bracket.semis },
      { label:'Finale', matches:[s1.bracket.final] },
    ]);
  }
  return `
    <div class="card info-card" style="text-align:center;padding:24px;">
      <i class="fa-solid fa-trophy" style="font-size:28px;color:var(--info);margin-bottom:10px;"></i>
      <div style="font-weight:700;font-size:16px;">${kickoffTeamCell(s1.bracket ? s1.bracket.champion : '—')}, Champion du Stage 1 ${label}</div>
    </div>
  `;
}
// Pendants "autre région" de renderGCStage2Panel/renderGCStage3Panel —
// même gabarit exact, alimentés par state.gcOtherRegionsStage2/3[region].
function renderGCOtherRegionStage2Panel(region){
  const label = GC_REGION_LABELS[region] || region;
  const s2 = (state.gcOtherRegionsStage2||{})[region];
  if(!s2) return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-trophy"></i><div>Le Stage 2 ${label} se joue chaque année d'avril à mai, une fois la Promotion/Relegation Stage 1 terminée.</div></div>`;
  if(s2.phase==='groups'){
    return `
      <div class="card info-card">
        <div style="font-weight:700;margin-bottom:8px;">Stage 2 ${label} — Classement, groupe unique</div>
        ${gcStage2Standings(s2.stage).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
      </div>
    `;
  }
  const b = s2.bracket;
  if(s2.phase==='playoffs'){
    return `
      ${renderKickoffBracketColumns([{ label:'Knockout Round', matches:b.knockout }])}
      ${renderKickoffBracketColumns([
        { label:'Upper Bracket Semifinals', matches:b.ubsf },
        { label:'Upper Bracket Final', matches:[b.ubfinal] },
      ])}
      ${renderKickoffBracketColumns([
        { label:'Lower Bracket Semifinals', matches:[b.lbsf] },
        { label:'Lower Bracket Final', matches:[b.lbfinal] },
      ])}
      ${renderKickoffBracketColumns([{ label:'Grande Finale', matches:[b.grandfinal] }])}
    `;
  }
  return `
    <div class="card info-card" style="text-align:center;padding:24px;">
      <i class="fa-solid fa-trophy" style="font-size:28px;color:var(--info);margin-bottom:10px;"></i>
      <div style="font-weight:700;font-size:16px;">${kickoffTeamCell(b ? b.champion : '—')}, Champion du Stage 2 ${label}</div>
    </div>
  `;
}
function renderGCOtherRegionStage3Panel(region){
  const label = GC_REGION_LABELS[region] || region;
  const s3 = (state.gcOtherRegionsStage3||{})[region];
  if(!s3) return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-trophy"></i><div>Le Stage 3 ${label} se joue chaque année de juillet à août, une fois la Promotion/Relegation Stage 2 terminée.</div></div>`;
  if(s3.phase==='groups'){
    return `
      <div class="card info-card">
        <div style="font-weight:700;margin-bottom:8px;">Stage 3 ${label} — Classement, groupe unique</div>
        ${gcStage2Standings(s3.stage).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)} <span style="color:${i<6?'var(--success)':'var(--warning)'};font-size:12px;">${i<6?'Playoffs':'Play-Ins'}</span></span><span>${t.w}V-${t.l}D</span></div>`).join('')}
      </div>
    `;
  }
  if(s3.phase==='playins-wait'){
    return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-hourglass-half"></i><div>Phase de groupe terminée. En attente des qualifiées Cash Cup (points cumulés) pour former les Play-Ins.</div></div>`;
  }
  if(s3.phase==='playins'){
    return `
      ${renderKickoffBracketColumns([{ label:'Play-Ins, bracket A', matches:[...s3.playIns.bracketA.semis, s3.playIns.bracketA.final] }])}
      ${renderKickoffBracketColumns([{ label:'Play-Ins, bracket B', matches:[...s3.playIns.bracketB.semis, s3.playIns.bracketB.final] }])}
    `;
  }
  const b = s3.bracket;
  if(s3.phase==='playoffs'){
    return `
      ${renderKickoffBracketColumns([{ label:'Upper Bracket Quarterfinals', matches:b.ubqf }])}
      ${renderKickoffBracketColumns([
        { label:'Upper Bracket Semifinals', matches:b.ubsf },
        { label:'Upper Bracket Final', matches:[b.ubfinal] },
      ])}
      ${renderKickoffBracketColumns([{ label:'Lower Bracket Round 1', matches:b.lbr1 }])}
      ${renderKickoffBracketColumns([
        { label:'Lower Bracket Round 2', matches:b.lbr2 },
        { label:'Lower Bracket Semifinale', matches:[b.lbsemis] },
        { label:'Lower Bracket Final', matches:[b.lbfinal] },
      ])}
      ${renderKickoffBracketColumns([{ label:'Grande Finale', matches:[b.grandfinal] }])}
    `;
  }
  return `
    <div class="card info-card" style="text-align:center;padding:24px;">
      <i class="fa-solid fa-trophy" style="font-size:28px;color:var(--info);margin-bottom:10px;"></i>
      <div style="font-weight:700;font-size:16px;">${kickoffTeamCell(b ? b.champion : '—')}, Champion du Stage 3 ${label}</div>
      <div style="margin-top:6px;color:var(--text-secondary);">Qualification directe au Championship ${label}.</div>
    </div>
  `;
}

/* ============================================================
   STAGE 1 PROMOTION/RELEGATION, STAGE 2, STAGE 2 PROMOTION/RELEGATION ET
   STAGE 3 DES AUTRES RÉGIONS — suite directe du chantier Stage 1 ci-dessus
   (demande explicite : "créer les VST pour les autres régions", en réponse
   à l'ensemble EMEA Stage1→PromoRel1→Stage2→PromoRel2→Stage3). Réutilise
   TEL QUEL le moteur déjà générique de chaque système EMEA
   (resolveGCPromoRelGroupRound/resolvePromoRelPlayoffRoundIndex/
   resolveGCStage2GroupRound/resolveGCStage2PlayoffRound/
   resolveGCStage3GroupRound/resolveGCStage3PlayInsBracket/
   resolveGCStage3PlayoffRound ne touchent leur state.gcXxxEmea respectif
   QUE dans la branche "c'est le match du joueur", qui ne se déclenche
   jamais ici puisque l'org du joueur n'apparaît jamais dans le champ d'une
   autre région) — seule la plomberie propre à CE state (champ, cycle
   quotidien, points de circuit) est dupliquée, région par région.
   Deux briques EMEA-spécifiques ne sont PAS réutilisables telles quelles
   et sont dupliquées ci-dessous, paramétrées par région :
   - buildGCPromoRelFinalStandings (myGCAffiliatedTeams() lit la région DU
     JOUEUR pour la règle d'exemption VST — mauvaise région pour le
     classement d'une AUTRE région) → buildGCPromoRelFinalStandingsForRegion.
   - gcCashCupPointsInRange (seeds "Lower Mid"/Play-Ins par points Cash Cup
     sur une fenêtre de mois précise, alimentée par state.gcCashCupPointsLog,
     qui n'existe QUE pour la région du joueur) → simplifié en un tri par
     points Cash Cup CUMULÉS de la saison (gcCashCupPointsForRegion) —
     approximation assumée et signalée, plutôt qu'une fenêtre datée précise.
   gcPromotedThisYear/gcPromotedThisYear2 (globaux, EMEA) deviennent
   state.gcOtherRegionsPromotedThisYear[region]/...ThisYear2[region].
   ============================================================ */
function gcAffiliatedTeamsForRegion(region){
  return GC_TEAMS_BY_REGION[region] || GC_TEAMS_EMEA;
}
function buildGCPromoRelFinalStandingsForRegion(ev, region){
  const b = ev.playoffBracket;
  const promoted = [b.ubfinal.winner, b.umfinal.winner, b.lmfinal.winner, b.lbfinal.winner].filter(Boolean);
  const bottomCandidates = [b.lbfinal.loser, b.lbsf.loser, b.lbr2.loser, b.lbr1.loser].filter(Boolean);
  const affiliated = gcAffiliatedTeamsForRegion(region);
  const relegated = bottomCandidates.filter(name=> !affiliated.includes(name) && !promoted.includes(name));
  relegated.forEach(name=>{ state.gcRelegatedUntil[name] = ev.year + 1; });
  const order = [...promoted, ...bottomCandidates];
  ev.finalStandings = order.map((name,i)=>({ name, place:i+1, promoted:promoted.includes(name), relegated:relegated.includes(name) }));
}

// --- Stage 1 Promotion/Relegation (mars) ---
function catchUpGCOtherRegionsStage1PromoRelegationForRegion(region){
  const d = state.date;
  if(!state.gcOtherRegionsStage1PromoRelegation) state.gcOtherRegionsStage1PromoRelegation = {};
  let ev = state.gcOtherRegionsStage1PromoRelegation[region];
  if(ev && ev.year===d.year && ev.phase==='done') return;
  if(!ev || ev.year!==d.year){
    if(d.month!==GC_STAGE1_PROMOREL_MONTH) return;
    ev = state.gcOtherRegionsStage1PromoRelegation[region] = {
      year:d.year, phase:'groups',
      groupStage:null, qualifiers:null, upperSeeds:null,
      playoffBracket:null, finalStandings:null, prizeAwarded:false,
    };
  }
  const pastMarch = d.month!==GC_STAGE1_PROMOREL_MONTH;
  if(ev.phase==='groups'){
    if(!ev.groupStage){
      const s1Field = buildGCStage1FieldForRegion(region);
      ev.upperSeeds = [...s1Field].sort((a,b)=> gcTeamStrength(b)-gcTeamStrength(a)).slice(0,4);
      const usedNames = new Set(s1Field);
      const pool = ensureGCTeamPool();
      const groupFieldNames = shuffle(Object.values(pool).filter(t=> t.region===region && !usedNames.has(t.name)).map(t=>t.name)).slice(0,16);
      ev.groupStage = initGCPromoRelGroupStage(groupFieldNames);
    }
    resolveGCPromoRelGroupRound(ev, ev.groupStage);
    if(pastMarch || d.day > GC_STAGE1_PROMOREL_GROUPS_WINDOW[1]){
      let guard=0;
      while(!allGCPromoRelGroupsDone(ev.groupStage) && guard<8){ resolveGCPromoRelGroupRound(ev, ev.groupStage); guard++; }
    }
    if(allGCPromoRelGroupsDone(ev.groupStage)){
      ev.qualifiers = Object.values(ev.groupStage.groups).map(g=> gcPromoRelGroupStandings(g)[0].name);
      const lowerSeeds = [...ev.qualifiers].sort((a,b)=> gcTeamStrength(b)-gcTeamStrength(a));
      ev.playoffBracket = initGCPromoRelPlayoffBracket(ev.upperSeeds, lowerSeeds);
      ev.phase = 'playoffs';
    }
    return;
  }
  if(ev.phase==='playoffs'){
    if(!pastMarch && d.day < GC_STAGE1_PROMOREL_PLAYOFFS_WINDOW[0]) return;
    resolvePromoRelPlayoffRoundIndex(ev, 'stage1');
    if(pastMarch || d.day > GC_STAGE1_PROMOREL_PLAYOFFS_WINDOW[1]){
      let guard=0;
      while(!gcPromoRelBracketDone(ev.playoffBracket) && guard<20){ resolvePromoRelPlayoffRoundIndex(ev, 'stage1'); guard++; }
    }
    if(gcPromoRelBracketDone(ev.playoffBracket) && !ev.finalStandings){
      buildGCPromoRelFinalStandingsForRegion(ev, region);
      if(!state.gcOtherRegionsPromotedThisYear) state.gcOtherRegionsPromotedThisYear = {};
      const baseField = new Set(ev.upperSeeds||[]);
      state.gcOtherRegionsPromotedThisYear[region] = ev.finalStandings.filter(e=>e.promoted && !baseField.has(e.name)).map(e=>e.name);
      ev.prizeAwarded = true; // pas de prime/réputation/historique : région sans organisation du joueur
      ev.phase = 'done';
    }
  }
}
function catchUpGCOtherRegionsStage1PromoRelegation(){
  const myRegion = myValorantGCRegion();
  Object.keys(GC_REGION_LABELS).forEach(region=>{ if(region!==myRegion) catchUpGCOtherRegionsStage1PromoRelegationForRegion(region); });
}

// --- Stage 2 (avril-mai) ---
function buildGCStage2FieldForRegion(region){
  const base = buildGCStage1FieldForRegion(region);
  const promoted = ((state.gcOtherRegionsPromotedThisYear||{})[region]||[]);
  return shuffle([...new Set([...base, ...promoted])].slice(0, GC_VCT_GC_ROSTER_SIZE));
}
function catchUpGCOtherRegionsStage2ForRegion(region){
  const d = state.date;
  if(!state.gcOtherRegionsStage2) state.gcOtherRegionsStage2 = {};
  let s2 = state.gcOtherRegionsStage2[region];
  if(s2 && s2.year===d.year && s2.phase==='done') return;
  if(!s2 || s2.year!==d.year){
    if(!isGCStage2Window(d)) return;
    const field = buildGCStage2FieldForRegion(region);
    s2 = state.gcOtherRegionsStage2[region] = {
      year:d.year, phase:'groups',
      stage:{ teams: field.map(n=>({name:n,w:0,l:0,mapsFor:0,mapsAgainst:0})), rounds: generateRoundRobinRounds(field), roundIndex:0 },
      bracket:null, relegationCandidates:null, prizeAwarded:false,
    };
  }
  const cur = new Date(d.year, d.month, d.day).getTime();
  const pastGroups = cur > gcDateTs(d.year, GC_STAGE2_GROUPS_END);
  const pastPlayoffs = cur > gcDateTs(d.year, GC_STAGE2_PLAYOFFS_END);
  if(s2.phase==='groups'){
    resolveGCStage2GroupRound(s2.stage);
    if(pastGroups){
      let guard=0;
      while(s2.stage.roundIndex<s2.stage.rounds.length && guard<12){ resolveGCStage2GroupRound(s2.stage); guard++; }
    }
    if(s2.stage.roundIndex>=s2.stage.rounds.length){
      s2.bracket = buildGCStage2PlayoffBracket(s2.stage);
      s2.relegationCandidates = gcStage2Standings(s2.stage).slice(-4).map(t=>t.name);
      s2.phase = 'playoffs';
    }
    return;
  }
  if(s2.phase==='playoffs'){
    if(cur < gcDateTs(d.year, GC_STAGE2_PLAYOFFS_START) && !pastGroups) return;
    resolveGCStage2PlayoffRound(s2);
    if(pastPlayoffs){
      let guard=0;
      while(!s2.bracket.champion && guard<12){ resolveGCStage2PlayoffRound(s2); guard++; }
    }
    if(s2.bracket.champion && !s2.prizeAwarded){
      awardGCOtherRegionStagePoints('stage2', region, s2.year, gcStage2Placements(s2));
      s2.prizeAwarded = true;
      s2.phase = 'done';
    }
  }
}
function catchUpGCOtherRegionsStage2(){
  const myRegion = myValorantGCRegion();
  Object.keys(GC_REGION_LABELS).forEach(region=>{ if(region!==myRegion) catchUpGCOtherRegionsStage2ForRegion(region); });
}

// --- Stage 2 Promotion/Relegation (juin) ---
function catchUpGCOtherRegionsStage2PromoRelegationForRegion(region){
  const d = state.date;
  if(!state.gcOtherRegionsStage2PromoRelegation) state.gcOtherRegionsStage2PromoRelegation = {};
  let ev = state.gcOtherRegionsStage2PromoRelegation[region];
  if(ev && ev.year===d.year && ev.phase==='done') return;
  if(!ev || ev.year!==d.year){
    const s2 = (state.gcOtherRegionsStage2||{})[region];
    if(!(s2 && s2.year===d.year && s2.phase==='done' && s2.relegationCandidates)) return;
    if(d.month < GC_STAGE2_PROMOREL_MONTH) return;
    const points = gcCashCupPointsForRegion(region);
    const lowerSeeds = Object.entries(points).sort((a,b)=>b[1]-a[1]).map(([name])=>name).filter(n=>!s2.relegationCandidates.includes(n)).slice(0,4);
    if(lowerSeeds.length<4){
      const pool = ensureGCTeamPool();
      const filler = shuffle(Object.keys(pool).filter(n=>pool[n].region===region && !s2.relegationCandidates.includes(n) && !lowerSeeds.includes(n)));
      while(lowerSeeds.length<4 && filler.length) lowerSeeds.push(filler.shift());
    }
    ev = state.gcOtherRegionsStage2PromoRelegation[region] = {
      year:d.year, phase:'playoffs',
      upperSeeds: s2.relegationCandidates,
      playoffBracket: initGCPromoRelPlayoffBracket(s2.relegationCandidates, lowerSeeds),
      finalStandings:null, prizeAwarded:false,
    };
  }
  if(ev.phase==='playoffs'){
    resolvePromoRelPlayoffRoundIndex(ev, 'stage2');
    let guard=0;
    while(!gcPromoRelBracketDone(ev.playoffBracket) && guard<20){ resolvePromoRelPlayoffRoundIndex(ev, 'stage2'); guard++; }
    if(gcPromoRelBracketDone(ev.playoffBracket) && !ev.finalStandings){
      buildGCPromoRelFinalStandingsForRegion(ev, region);
      if(!state.gcOtherRegionsPromotedThisYear2) state.gcOtherRegionsPromotedThisYear2 = {};
      const baseField = new Set(ev.upperSeeds||[]);
      state.gcOtherRegionsPromotedThisYear2[region] = ev.finalStandings.filter(e=>e.promoted && !baseField.has(e.name)).map(e=>e.name);
      ev.prizeAwarded = true;
      ev.phase = 'done';
    }
  }
}
function catchUpGCOtherRegionsStage2PromoRelegation(){
  const myRegion = myValorantGCRegion();
  Object.keys(GC_REGION_LABELS).forEach(region=>{ if(region!==myRegion) catchUpGCOtherRegionsStage2PromoRelegationForRegion(region); });
}

// --- Stage 3 (juillet-août) ---
function buildGCStage3FieldForRegion(region){
  const base = buildGCStage2FieldForRegion(region);
  const promoted = ((state.gcOtherRegionsPromotedThisYear2||{})[region]||[]);
  return shuffle([...new Set([...base, ...promoted])].slice(0, GC_VCT_GC_ROSTER_SIZE));
}
function catchUpGCOtherRegionsStage3ForRegion(region){
  const d = state.date;
  if(!state.gcOtherRegionsStage3) state.gcOtherRegionsStage3 = {};
  let s3 = state.gcOtherRegionsStage3[region];
  if(s3 && s3.year===d.year && s3.phase==='done') return;
  const cur = new Date(d.year, d.month, d.day).getTime();
  if(!s3 || s3.year!==d.year){
    // Bornes basse ET haute (contrairement à Stage 1/Stage 2/Kickoff, qui
    // utilisent tous une vraie fenêtre isGCXWindow() des deux côtés) : sans
    // la borne haute, une sauvegarde/région dont Stage 3 n'a jamais démarré
    // avant le 6 août "rattrapait" et lançait tout l'évènement n'importe
    // quand plus tard dans l'année (ex. décembre) au lieu de l'ignorer pour
    // cette année — bug remonté par un joueur ("j'ai des matchs en décembre
    // en GC ?").
    if(cur < gcDateTs(d.year, GC_STAGE3_GROUPS_START) || cur > gcDateTs(d.year, GC_STAGE3_PLAYOFFS_END)) return;
    const field = buildGCStage3FieldForRegion(region);
    s3 = state.gcOtherRegionsStage3[region] = {
      year:d.year, phase:'groups',
      stage:{ teams: field.map(n=>({name:n,w:0,l:0,mapsFor:0,mapsAgainst:0})), rounds: generateRoundRobinRounds(field), roundIndex:0 },
      groupQualifiers:null, playInsGroupSeeds:null, playIns:null, bracket:null, prizeAwarded:false,
    };
  }
  const pastGroups = cur > gcDateTs(d.year, GC_STAGE3_GROUPS_END);
  const pastPlayIns = cur > gcDateTs(d.year, GC_STAGE3_PLAYINS_END);
  const pastPlayoffs = cur > gcDateTs(d.year, GC_STAGE3_PLAYOFFS_END);
  if(s3.phase==='groups'){
    resolveGCStage3GroupRound(s3.stage);
    if(pastGroups){
      let guard=0;
      while(s3.stage.roundIndex<s3.stage.rounds.length && guard<12){ resolveGCStage3GroupRound(s3.stage); guard++; }
    }
    if(s3.stage.roundIndex>=s3.stage.rounds.length){
      const standings = gcStage2Standings(s3.stage);
      s3.groupQualifiers = standings.slice(0,6).map(t=>t.name);
      s3.playInsGroupSeeds = standings.slice(-4).map(t=>t.name);
      s3.phase = 'playins-wait';
    }
    return;
  }
  if(s3.phase==='playins-wait'){
    if(cur < gcDateTs(d.year, GC_STAGE3_PLAYINS_START) && !pastGroups) return;
    const points = gcCashCupPointsForRegion(region);
    const usedNames = new Set([...s3.groupQualifiers, ...s3.playInsGroupSeeds]);
    const cashCupSeeds = Object.entries(points).sort((a,b)=>b[1]-a[1]).map(([name])=>name).filter(n=>!usedNames.has(n)).slice(0,4);
    if(cashCupSeeds.length<4){
      const pool = ensureGCTeamPool();
      const filler = shuffle(Object.values(pool).filter(t=> t.region===region && !usedNames.has(t.name) && !cashCupSeeds.includes(t.name)).map(t=>t.name));
      while(cashCupSeeds.length<4 && filler.length) cashCupSeeds.push(filler.pop());
    }
    const eight = [...s3.playInsGroupSeeds, ...cashCupSeeds];
    const sorted = [...eight].sort((a,b)=>gcTeamStrength(b)-gcTeamStrength(a));
    s3.playIns = {
      bracketA: buildGCStage3PlayInsMiniBracket([sorted[0],sorted[3],sorted[4],sorted[7]]),
      bracketB: buildGCStage3PlayInsMiniBracket([sorted[1],sorted[2],sorted[5],sorted[6]]),
    };
    s3.phase = 'playins';
  }
  if(s3.phase==='playins'){
    resolveGCStage3PlayInsBracket(s3,'bracketA');
    resolveGCStage3PlayInsBracket(s3,'bracketB');
    if(pastPlayIns){
      let guard=0;
      while((!s3.playIns.bracketA.champion || !s3.playIns.bracketB.champion) && guard<10){
        resolveGCStage3PlayInsBracket(s3,'bracketA'); resolveGCStage3PlayInsBracket(s3,'bracketB'); guard++;
      }
    }
    if(s3.playIns.bracketA.champion && s3.playIns.bracketB.champion){
      const eight = [...s3.groupQualifiers, s3.playIns.bracketA.champion, s3.playIns.bracketB.champion];
      s3.bracket = buildGCStage3PlayoffBracket(eight);
      s3.phase = 'playoffs';
    }
    return;
  }
  if(s3.phase==='playoffs'){
    if(cur < gcDateTs(d.year, GC_STAGE3_PLAYOFFS_START) && !pastPlayIns) return;
    resolveGCStage3PlayoffRound(s3);
    if(pastPlayoffs){
      let guard=0;
      while(!s3.bracket.champion && guard<16){ resolveGCStage3PlayoffRound(s3); guard++; }
    }
    if(s3.bracket.champion && !s3.prizeAwarded){
      awardGCOtherRegionStagePoints('stage3', region, s3.year, gcStage3Placements(s3));
      s3.prizeAwarded = true;
      s3.phase = 'done';
    }
  }
}
function catchUpGCOtherRegionsStage3(){
  const myRegion = myValorantGCRegion();
  Object.keys(GC_REGION_LABELS).forEach(region=>{ if(region!==myRegion) catchUpGCOtherRegionsStage3ForRegion(region); });
}

/* ============================================================
   CHAMPIONS GC — tournoi mondial de fin de saison (5-20 novembre, juste
   avant la fenêtre morte du Cash Cup — voir isGCCashCupOffSeason),
   réclamé explicitement : "les 3 équipes avec le plus de points lors des
   VST GC de chaque région [...] 2 groupes de 6, les 2 premières de chaque
   groupe qualifiées pour les playoffs dans un bracket en upper et les 3e
   de chaque groupe dans le lower des playoffs directs".
   Qualification : 3 organisations par région (12 au total) classées sur
   leurs points Cash Cup cumulés de la saison — SEULE donnée de classement
   qui existe aujourd'hui pour LES 4 régions (voir
   catchUpGCOtherRegionsCashCup/gcOtherRegionsCashCupPoints, chantier
   précédent) ; la route Championship/Stage 1-2-3 reste, elle, propre à la
   région du joueur.
   Bracket de playoffs (6 équipes) : format "GSL-style" à double
   élimination standard — 2 demi-finales Upper Bracket (croisées entre
   groupes), les 2 perdants tombent en Lower Bracket À DES MOMENTS
   DIFFÉRENTS (le perdant de la 1ère demi-finale retrouve tout de suite le
   vainqueur du match direct des 3e de groupe ; le perdant de la 2e demi-
   finale attend directement la Petite Finale) — point non détaillé dans
   la demande, choix assumé faute de diagramme officiel fourni : à ajuster
   si tu as une vraie référence sous les yeux.
   Réutilise volontairement les briques déjà génériques du Cash Cup
   (generateRoundRobinRounds, resolveGCCashCupMatch, applyGCCashCupGroupResult,
   gcCashCupGroupStandings) plutôt que de dupliquer leur logique — seule la
   plomberie "match du joueur en attente" est propre à ce nouvel évènement
   (state.gcChampions.pendingMatch), exactement comme chaque autre
   compétition GC de ce fichier.
   ============================================================ */
const GC_CHAMPIONS_MONTH = 10; // novembre (0-indexé, comme MONTH_NAMES)
const GC_CHAMPIONS_GROUPS_WINDOW = [5,12];
const GC_CHAMPIONS_PLAYOFFS_WINDOW = [13,20];
const GC_CHAMPIONS_PRIZE = 150000;

// Points de qualification d'une région donnée : les tiens (state.gcCashCupSeasonPoints)
// si c'est ta région, ceux simulés en arrière-plan sinon (voir
// catchUpGCOtherRegionsCashCup) — jamais les deux mélangés.
function gcCashCupPointsForRegion(region){
  if(region===myValorantGCRegion()) return state.gcCashCupSeasonPoints || {};
  return (state.gcOtherRegionsCashCupPoints||{})[region] || {};
}
// Champ des Champions : les 3 meilleures organisations aux points Cash Cup
// de CHAQUE région. Filet de sécurité si une région n'a pas encore 3
// organisations créditées de points (tout début de partie, avant la
// première Cash Cup complète) : complète avec des rosters du vivier de
// cette région plutôt que de réduire le champ sous 12.
function buildGCChampionsField(){
  const pool = ensureGCTeamPool();
  const teams = [];
  Object.keys(GC_REGION_LABELS).forEach(region=>{
    const points = gcCashCupPointsForRegion(region);
    const chosen = Object.entries(points).sort((a,b)=>b[1]-a[1]).map(([name])=>name).slice(0,3);
    if(chosen.length<3){
      const filler = shuffle(Object.keys(pool).filter(n=>pool[n].region===region && !chosen.includes(n)));
      while(chosen.length<3 && filler.length) chosen.push(filler.shift());
    }
    teams.push(...chosen);
  });
  return teams;
}
function buildGCChampionsGroups(field){
  const shuffled = shuffle([...field]);
  const mkGroup = names=>({ teams: names.map(name=>({name,w:0,l:0,mapsFor:0,mapsAgainst:0})), roundIndex:0 });
  const groups = { A: mkGroup(shuffled.slice(0,6)), B: mkGroup(shuffled.slice(6,12)) };
  groups.A.rounds = generateRoundRobinRounds(groups.A.teams.map(t=>t.name));
  groups.B.rounds = generateRoundRobinRounds(groups.B.teams.map(t=>t.name));
  return groups;
}
function allGCChampionsGroupsDone(groups){
  return Object.values(groups).every(g=> g.roundIndex >= g.rounds.length);
}
// Programme le match du jour du joueur (Champions) — même idiome que
// tryScheduleSelfGCCashCupMatch, circuit isolé (state.gcChampions.pendingMatch).
function tryScheduleSelfGCChampionsMatch(stage, roundKey, extra){
  const champ = state.gcChampions;
  if(champ.pendingMatch) return true;
  const evKey = eventKey('valorant_gc', state.date.year, state.date.month, state.date.day);
  const existingMatch = (state.calendarEvents[evKey]||[]).find(e=>e.type==='match');
  if(existingMatch) return false;
  let opponentName, mapsToWin;
  if(stage==='groups'){
    opponentName = extra;
    mapsToWin = 2; // groupes en Bo3
    champ.pendingMatch = { stage, groupKey:roundKey, opponentName, mapsToWin };
  } else {
    const m = extra.m;
    opponentName = m.a===state.org.name ? m.b : m.a;
    mapsToWin = m.mapsToWin || 2;
    champ.pendingMatch = { stage, round:roundKey, opponentName, mapsToWin };
  }
  state.calendarEvents[evKey] = state.calendarEvents[evKey] || [];
  state.calendarEvents[evKey].push({ type:'match', label:`vs ${opponentName}`, opponent:opponentName, played:false, gcChampionsRef:true });
  pushNotification(`🏆 Votre match Champions GC contre ${opponentName} est prêt, cliquez sur "Jouer le match" !`);
  return true;
}
function resolveGCChampionsGroupRound(groups){
  Object.entries(groups).forEach(([key, group])=>{
    if(group.roundIndex >= group.rounds.length) return;
    const pairs = group.rounds[group.roundIndex] || [];
    const myPair = pairs.find(p=>p.includes(state.org.name));
    if(myPair){
      if(!state.gcChampions.pendingMatch){
        tryScheduleSelfGCChampionsMatch('groups', key, myPair[0]===state.org.name?myPair[1]:myPair[0]);
      }
      return; // ce groupe n'avance pas tant que le match du joueur n'est pas joué
    }
    pairs.forEach(([a,b])=>{
      const r = resolveGCCashCupMatch(a, b, 'bo3');
      applyGCCashCupGroupResult(group, a, b, r);
    });
    group.roundIndex++;
  });
}
function gcChampionsMatchByRound(bracket, round){
  if(round==='ubSemi0') return bracket.ubSemis[0];
  if(round==='ubSemi1') return bracket.ubSemis[1];
  if(round==='ubFinal') return bracket.ubFinal;
  if(round==='lbR1') return bracket.lbR1;
  if(round==='lbR2') return bracket.lbR2;
  if(round==='lbFinal') return bracket.lbFinal;
  if(round==='grandFinal') return bracket.grandFinal;
  return null;
}
// Bracket de playoffs — seeds Upper Bracket croisées entre groupes (1er de
// A contre 2e de B, 1er de B contre 2e de A), seeds Lower Bracket = 3e de
// chaque groupe, qui s'affrontent directement (voir commentaire d'en-tête).
function buildGCChampionsBracket(groups){
  const standA = gcCashCupGroupStandings(groups.A);
  const standB = gcCashCupGroupStandings(groups.B);
  const mk = (mapsToWin=2)=>({ a:null, b:null, scoreA:null, scoreB:null, winner:null, loser:null, mapsToWin });
  const ubSemis = [mk(2), mk(2)];
  ubSemis[0].a = standA[0].name; ubSemis[0].b = standB[1].name;
  ubSemis[1].a = standB[0].name; ubSemis[1].b = standA[1].name;
  const lbR1 = mk(2); lbR1.a = standA[2].name; lbR1.b = standB[2].name;
  return {
    upperSeeds:[standA[0].name, standB[1].name, standB[0].name, standA[1].name],
    lowerSeeds:[standA[2].name, standB[2].name],
    ubSemis, ubFinal: mk(2),
    lbR1, lbR2: mk(2), lbFinal: mk(2),
    grandFinal: mk(3),
    champion:null, viceChampion:null,
  };
}
function resolveGCChampionsUB(bracket){
  bracket.ubSemis.forEach((m,idx)=>{
    if(!m.a || !m.b || m.winner) return;
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCChampionsMatch('playoffs', `ubSemi${idx}`, {m}); return; }
    Object.assign(m, resolveGCCashCupMatch(m.a, m.b, 'bo3'));
  });
  if(bracket.ubSemis.some(m=>!m.winner)) return;
  const uf = bracket.ubFinal;
  if(!uf.a){ uf.a = bracket.ubSemis[0].winner; uf.b = bracket.ubSemis[1].winner; }
  if(!uf.winner){
    if(uf.a===state.org.name || uf.b===state.org.name){ tryScheduleSelfGCChampionsMatch('playoffs', 'ubFinal', {m:uf}); return; }
    Object.assign(uf, resolveGCCashCupMatch(uf.a, uf.b, 'bo3'));
  }
}
function resolveGCChampionsLB(bracket){
  const r1 = bracket.lbR1;
  if(!r1.winner){
    if(r1.a===state.org.name || r1.b===state.org.name){ tryScheduleSelfGCChampionsMatch('playoffs', 'lbR1', {m:r1}); return; }
    Object.assign(r1, resolveGCCashCupMatch(r1.a, r1.b, 'bo3'));
  }
  if(!r1.winner || bracket.ubSemis.some(m=>!m.winner)) return;
  const r2 = bracket.lbR2;
  if(!r2.a){ r2.a = r1.winner; r2.b = bracket.ubSemis[0].loser; }
  if(!r2.winner){
    if(r2.a===state.org.name || r2.b===state.org.name){ tryScheduleSelfGCChampionsMatch('playoffs', 'lbR2', {m:r2}); return; }
    Object.assign(r2, resolveGCCashCupMatch(r2.a, r2.b, 'bo3'));
  }
  if(!r2.winner) return;
  const lf = bracket.lbFinal;
  if(!lf.a){ lf.a = r2.winner; lf.b = bracket.ubSemis[1].loser; }
  if(!lf.winner){
    if(lf.a===state.org.name || lf.b===state.org.name){ tryScheduleSelfGCChampionsMatch('playoffs', 'lbFinal', {m:lf}); return; }
    Object.assign(lf, resolveGCCashCupMatch(lf.a, lf.b, 'bo3'));
  }
}
function resolveGCChampionsGrandFinal(bracket){
  if(!bracket.ubFinal.winner || !bracket.lbFinal.winner) return;
  const gf = bracket.grandFinal;
  if(!gf.a){ gf.a = bracket.ubFinal.winner; gf.b = bracket.lbFinal.winner; }
  if(!gf.winner){
    if(gf.a===state.org.name || gf.b===state.org.name){ tryScheduleSelfGCChampionsMatch('playoffs', 'grandFinal', {m:gf}); return; }
    Object.assign(gf, resolveGCCashCupMatch(gf.a, gf.b, 'bo5'));
  }
  if(!bracket.champion && gf.winner){
    bracket.champion = gf.winner;
    bracket.viceChampion = gf.winner===gf.a ? gf.b : gf.a;
  }
}
function resolveGCChampionsPlayoffRound(bracket){
  resolveGCChampionsUB(bracket);
  resolveGCChampionsLB(bracket);
  resolveGCChampionsGrandFinal(bracket);
}
function awardGCChampionsPrize(champ){
  if(champ.prizeAwarded) return;
  champ.prizeAwarded = true;
  const champion = champ.bracket.champion;
  pushGCCompetitionHistory({ year:champ.year, month:GC_CHAMPIONS_MONTH, competition:'Champions GC', label:`Champions GC ${champ.year}`, champion, isSelf: champion===state.org.name });
  if(champion===state.org.name){
    state.budget += GC_CHAMPIONS_PRIZE;
    recordTransaction('valorant_gc', 'other', `Champions GC, prime de victoire`, GC_CHAMPIONS_PRIZE);
    state.reputation = Math.min(100, (state.reputation||0) + 15);
    pushNotification(`🏆 ${state.org.name} remporte les Champions GC ! Prime : ${formatMoney(GC_CHAMPIONS_PRIZE)}.`);
    pushNews(`${state.org.name} sacré championne du monde Game Changers (Champions GC).`, 'result', 'valorant_gc');
  } else {
    pushNews(`${champion} remporte les Champions GC ${champ.year}.`);
  }
}
// Complète le match Champions du joueur une fois joué — même idiome que
// completePendingGCCashCupMatch.
function completePendingGCChampionsMatch(matchResult){
  const champ = state.gcChampions;
  const pending = champ && champ.pendingMatch;
  if(!pending) return;
  const selfWon = !!matchResult.won;
  const winner = selfWon ? state.org.name : pending.opponentName;
  const loser = selfWon ? pending.opponentName : state.org.name;
  let selfWins = matchResult.dayMatch ? matchResult.dayMatch.sh : (selfWon?pending.mapsToWin:0);
  let oppWins = matchResult.dayMatch ? matchResult.dayMatch.sa : (selfWon?0:pending.mapsToWin);
  const need = pending.mapsToWin||2;
  if(selfWon && selfWins<need) selfWins = need;
  if(!selfWon && oppWins<need) oppWins = need;

  if(pending.stage==='groups'){
    const group = champ.groups[pending.groupKey];
    if(group){
      applyGCCashCupGroupResult(group, state.org.name, pending.opponentName, { winner, scoreA:selfWins, scoreB:oppWins });
      const pairs = (group.rounds[group.roundIndex]||[]);
      pairs.forEach(([a,b])=>{
        if(a===state.org.name || b===state.org.name) return;
        const r = resolveGCCashCupMatch(a, b, 'bo3');
        applyGCCashCupGroupResult(group, a, b, r);
      });
      group.roundIndex++;
    }
  } else {
    const m = gcChampionsMatchByRound(champ.bracket, pending.round);
    if(m){
      if(m.a===state.org.name){ m.scoreA=selfWins; m.scoreB=oppWins; } else { m.scoreA=oppWins; m.scoreB=selfWins; }
      m.winner = winner;
      m.loser = loser;
    }
  }
  champ.pendingMatch = null;
  if(pending.stage==='playoffs'){
    resolveGCChampionsPlayoffRound(champ.bracket);
    if(champ.bracket.champion) awardGCChampionsPrize(champ);
  }
}
// Cycle quotidien (voir advanceDay, script.js) — même idiome "fenêtre +
// rattrapage" que catchUpGCCashCupEmea, hors fenêtre le 5-20 novembre ne
// fait rien.
function catchUpGCChampions(){
  const d = state.date;
  if(d.month!==GC_CHAMPIONS_MONTH || d.day<GC_CHAMPIONS_GROUPS_WINDOW[0] || d.day>GC_CHAMPIONS_PLAYOFFS_WINDOW[1]) return;
  let champ = state.gcChampions;
  if(!champ || champ.year!==d.year){
    champ = state.gcChampions = {
      year:d.year, phase:'groups',
      groups: buildGCChampionsGroups(buildGCChampionsField()),
      bracket:null, pendingMatch:null, prizeAwarded:false,
    };
  }
  if(champ.phase==='groups'){
    resolveGCChampionsGroupRound(champ.groups);
    if(d.day > GC_CHAMPIONS_GROUPS_WINDOW[1]){
      let guard = 0;
      while(!allGCChampionsGroupsDone(champ.groups) && !champ.pendingMatch && guard<10){
        resolveGCChampionsGroupRound(champ.groups);
        guard++;
      }
    }
    if(allGCChampionsGroupsDone(champ.groups)){
      champ.bracket = buildGCChampionsBracket(champ.groups);
      champ.phase = 'playoffs';
    }
    return;
  }
  if(champ.phase==='playoffs'){
    if(d.day < GC_CHAMPIONS_PLAYOFFS_WINDOW[0]) return;
    resolveGCChampionsPlayoffRound(champ.bracket);
    if(d.day >= GC_CHAMPIONS_PLAYOFFS_WINDOW[1]){
      let guard = 0;
      while(!(champ.bracket && champ.bracket.champion) && !champ.pendingMatch && guard<10){
        resolveGCChampionsPlayoffRound(champ.bracket);
        guard++;
      }
    }
    if(champ.bracket.champion) awardGCChampionsPrize(champ);
    if(champ.bracket.champion && champ.prizeAwarded) champ.phase = 'done';
  }
}
// Colonnes de bracket Champions pour renderKickoffBracketColumns.
function gcChampionsBracketColumns(bracket){
  return [
    { label:'Lower Bracket, Round 1', matches:[bracket.lbR1] },
    { label:'Upper Bracket, Demi-finales', matches: bracket.ubSemis },
    { label:'Lower Bracket, Round 2', matches:[bracket.lbR2] },
    { label:'Upper Bracket, Finale', matches:[bracket.ubFinal] },
    { label:'Petite Finale', matches:[bracket.lbFinal] },
    { label:'Grande Finale', matches:[bracket.grandFinal] },
  ];
}
// Panneau Champions GC — groupes (12 équipes, 3 par région) pendant la
// phase de groupes, bracket double élimination pendant les playoffs, même
// présentation que les autres compétitions GC (renderGCStandingsPanel/
// renderGCStage1Panel).
function renderGCChampionsPanel(){
  const champ = state.gcChampions;
  if(!champ){
    return `<div class="empty-state" style="padding:24px;"><i class="fa-solid fa-globe"></i><div>Les Champions GC démarrent le 5 novembre, avec les 3 meilleures organisations aux points Cash Cup de chaque région (12 au total).</div></div>`;
  }
  const groupBlock = (key, group)=>`
    <div class="card info-card">
      <div style="font-weight:700;margin-bottom:8px;">Groupe ${key}</div>
      ${gcCashCupGroupStandings(group).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}${i<2?' <span class="badge badge-green" style="margin-left:4px;">Upper</span>':i===2?' <span class="badge badge-orange" style="margin-left:4px;">Lower</span>':''}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
    </div>
  `;
  if(champ.phase==='groups'){
    return `
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">Phase de groupes : les 2 premières de chaque groupe rejoignent l'Upper Bracket, la 3e rejoint directement le Lower Bracket.</p>
      <div class="card-grid two">${groupBlock('A', champ.groups.A)}${groupBlock('B', champ.groups.B)}</div>
    `;
  }
  return `
    <div style="overflow-x:auto;">
      ${champ.bracket && champ.bracket.champion ? `<div class="sh-qualif-badge qualified" style="margin-bottom:14px;">🏆 Championne du monde : ${champ.bracket.champion}</div>` : ''}
      ${champ.bracket ? renderKickoffBracketColumns(gcChampionsBracketColumns(champ.bracket)) : ''}
    </div>
  `;
}

// Colonnes de bracket pour renderKickoffBracketColumns (script.js) — même
// gabarit que rlcsSingleElimBracketColumns, zéro nouveau CSS nécessaire.
function cashCupBracketColumns(bracket){
  return [
    { label:'Round de 16', matches: bracket.round16 },
    { label:'Quarts de finale', matches: bracket.quarters },
    { label:'Demi-finales', matches: bracket.semis },
    { label:'Finale', matches:[bracket.final] },
  ];
}

// Season Hub GC — même langage visuel "premium" que le Season Hub
// Valostrike/RLCS (classes .sh-* déjà génériques, voir style.css et
// renderRLCSSeasonHub script.js : header/progression/KPIs), plutôt que le
// renderSeasonTabSimple générique utilisé jusqu'ici (de simples cartes
// stat + un encart "Prochain évènement", nettement plus pauvre que les
// deux autres jeux). GC n'a qu'UNE compétition pour l'instant (Cash Cup
// EMEA, mensuelle) — pas de multi-onglets Split/Masters façon VST, juste
// une frise de progression Intersaison→Groupes→Playoffs→Terminé et les 4
// KPIs les plus pertinents, le panneau Cash Cup existant (renderGCCashCupPanel)
// servant de corps principal.
// Étapes de la frise — l'Open Qualifier n'apparaît que les mois où le
// format tiré au sort en a un (voir cup.format.hasQualifier). "Terminé"
// couvre la fenêtre morte (jour 16-fin) : ce n'est pas une fin définitive,
// juste l'état jusqu'au prochain cycle mensuel.
function gcSeasonHubSteps(cup){
  const steps = [];
  if(cup && cup.format && cup.format.hasQualifier) steps.push({ key:'qualifier', label:'Open Qualifier' });
  steps.push({ key:'groups', label:'Phase de groupes' });
  steps.push({ key:'playoffs', label:'Playoffs' });
  steps.push({ key:'done', label:'Fenêtre morte' });
  return steps;
}
// --- Panneau Statistiques : classements individuels par édition
// (Cash Cup du mois / Stage 1 de l'année), voir bumpGCCashCupStat plus haut
// pour l'accumulateur. Réutilise SEASON_HUB_STAT_CARDS (script.js) — même
// jeu de 7 classements que Valostrike classique, générique par nature
// (ne dépend que de la forme {kills,deaths,...,acsSum,ratingSum,hsSum,
// mapsPlayed}), aucune duplication nécessaire.
let gcStatsEditionView = null;
function gcStatsEditionLabel(key){
  if(key.startsWith('stage1_')) return `Stage 1 ${gcRegionLabel()}, ${key.split('_')[1]}`;
  const m = key.match(/^cashcup_(\d+)_(\d+)$/);
  if(m) return `Cash Cup, ${MONTH_NAMES[Number(m[2])]} ${m[1]}`;
  return key;
}
function gcStatsEditionSortValue(key){
  if(key.startsWith('stage1_')) return Number(key.split('_')[1])*100 + 13; // après tous les mois d'une même année
  const m = key.match(/^cashcup_(\d+)_(\d+)$/);
  return m ? Number(m[1])*100 + Number(m[2]) : 0;
}
// Onglet Vue d'ensemble / Classement, partagé par le hub Cash Cup et le hub
// Stage 1 — même bouton, contenu différent selon la compétition active
// (voir renderGCStandingsPanel).
let gcSeasonHubView = 'overview';
// Sous-onglet actif de l'onglet "Classement" du hub GC (voir
// renderGCSeasonHubBody/renderGCClassementBody) — même esprit visuel que
// le hub Classement de Valostrike classique (WORLD_HUB_TABS, onglets côte
// à côte façon .worldhub-tabs), mais adapté aux VRAIES compétitions de la
// GC (Cash Cup / Stage 1 / route Championship) plutôt qu'à des régions
// géographiques : la GC ne simule pas les 3 autres régions en arrière-plan
// (voir le plan de session), donc "parcourir d'autres régions" n'a pas de
// sens ici — on parcourt plutôt les différentes compétitions de LA sienne.
let gcClassementView = 'current';
// Sous-onglet actif du groupe "VST EMEA" (Stage 1/2/3, voir gcVstSubTabs) —
// regroupés sous un seul onglet parent plutôt que 3 onglets à plat
// (demande explicite : "met les en sous onglet de VST EMEA").
let gcClassementSubView = 'stage1';
// Labels statiques sauf 'cashcup'/'stage1', calculés à l'affichage (voir
// renderGCSeasonHubNav) pour refléter la région choisie — un const évalué
// une seule fois au chargement ne pourrait jamais s'adapter dynamiquement.
const GC_SEASON_HUB_TABS = [
  { key:'overview',   label:"Vue d'ensemble" },
  { key:'calendar',   label:'Calendrier' },
  { key:'classement', label:'Classement' },
  { key:'kickoff',    label:'Kickoff' },
  { key:'cashcup',    label:null },
  { key:'stage1',     label:null },
  { key:'promorel',   label:'Promo/Rel S1' },
  { key:'stage2',     label:null },
  { key:'promorel2',  label:'Promo/Rel S2' },
  { key:'stage3',     label:null },
  { key:'champions',  label:'Champions' },
  { key:'history',    label:'Histoire' },
];
function renderGCSeasonHubNav(){
  const region = gcRegionLabel();
  const labelFor = t=> t.key==='cashcup' ? `Cash Cup ${region}` : t.key==='stage1' ? `Stage 1 ${region}` : t.key==='stage2' ? `Stage 2 ${region}` : t.key==='stage3' ? `Stage 3 ${region}` : t.label;
  return `<div class="sh-nav">${GC_SEASON_HUB_TABS.map(t=>`<div class="sh-nav-item ${gcSeasonHubView===t.key?'active':''}" data-gcshview="${t.key}">${labelFor(t)}</div>`).join('')}</div>`;
}
// Points de circuit Cash Cup, par palier de CLASSEMENT FINAL (jamais par
// victoire individuelle — voir prompt du chantier) : même barème pour
// n'importe quelle équipe du champ, du champion jusqu'à une élimination en
// poules. Cumulés d'édition en édition dans state.gcCashCupSeasonPoints —
// jamais remis à zéro pour l'instant (la cadence de remise à zéro reste à
// définir, voir awardGCCashCupSeasonPoints).
const GC_CASHCUP_POINTS_BY_TIER = {
  champion: 500,
  finalist: 350,
  semifinalist: 250,
  quarterfinalist: 150,
  round16: 75,
  groups: 25,
};
// Appelée depuis awardGCCashCupPrize (déjà idempotente via cup.prizeAwarded
// — jamais besoin d'un second garde-fou ici) une fois le champion connu :
// lit les "loser" déjà renseignés à chaque case du bracket (voir
// completePendingGCCashCupMatch/resolveGCCashCupPlayoffRound) pour
// retrouver précisément qui s'est arrêté à quel tour, sans avoir à
// retracer le bracket a posteriori.
// Journal daté des points attribués (year/month/name/points) — en plus du
// cumul brut state.gcCashCupSeasonPoints, permet de recalculer un total
// sur une FENÊTRE précise (ex. avril-juin, voir gcCashCupPointsInRange) au
// lieu du cumul depuis toujours : nécessaire pour la qualification à la
// Promotion/Relegation de Stage 2, basée uniquement sur les points gagnés
// dans cette fenêtre-là, pas le classement cumulé à vie.
function awardGCCashCupSeasonPoints(cup){
  if(!cup.bracket || !cup.bracket.champion) return;
  state.gcCashCupSeasonPoints = state.gcCashCupSeasonPoints || {};
  state.gcCashCupPointsLog = state.gcCashCupPointsLog || [];
  const add = (name, pts)=>{
    if(!name) return;
    state.gcCashCupSeasonPoints[name] = (state.gcCashCupSeasonPoints[name]||0) + pts;
    state.gcCashCupPointsLog.push({ year:cup.year, month:cup.month, name, points:pts });
  };
  const b = cup.bracket;
  add(b.champion, GC_CASHCUP_POINTS_BY_TIER.champion);
  add(b.final.loser, GC_CASHCUP_POINTS_BY_TIER.finalist);
  b.semis.forEach(m=> add(m.loser, GC_CASHCUP_POINTS_BY_TIER.semifinalist));
  b.quarters.forEach(m=> add(m.loser, GC_CASHCUP_POINTS_BY_TIER.quarterfinalist));
  b.round16.forEach(m=> add(m.loser, GC_CASHCUP_POINTS_BY_TIER.round16));
  const playoffTeams = new Set(b.seeds);
  Object.values(cup.groups||{}).forEach(g=>{
    gcCashCupGroupStandings(g).forEach(t=>{ if(!playoffTeams.has(t.name)) add(t.name, GC_CASHCUP_POINTS_BY_TIER.groups); });
  });
}
// Somme des points gagnés par équipe entre (fromYear,fromMonth) et
// (toYear,toMonth) inclus — voir gcCashCupPointsLog. Utilisé pour désigner
// les seeds "Cash Cup" de la Promotion/Relegation Stage 2 (points d'avril
// à juin uniquement, pas le cumul à vie).
function gcCashCupPointsInRange(fromYear, fromMonth, toYear, toMonth){
  const fromTs = fromYear*12+fromMonth, toTs = toYear*12+toMonth;
  const totals = {};
  (state.gcCashCupPointsLog||[]).forEach(e=>{
    const ts = e.year*12+e.month;
    if(ts<fromTs || ts>toTs) return;
    totals[e.name] = (totals[e.name]||0) + e.points;
  });
  return totals;
}
// Classement EMEA Championship (Stage 1/2/3 cumulés, barème officiel) —
// table à vraies colonnes (.sh-table.sh-standings, déjà générique) plutôt
// que le style stat-leaderboard-* (une seule valeur par ligne) utilisé pour
// le classement Cash Cup, puisqu'ici il y a un vrai détail par stage à
// montrer. La colonne Stage 3 (voir GC_STAGE_POINTS_TABLE.stage3 et
// awardGCStage3Prizes) reste à "—" pour une équipe tant qu'aucun point n'y
// a été enregistré pour elle cette année-là (pas encore jouée, ou éliminée
// avant un palier qui rapporte des points) — même logique que Stage 1/2.
function renderGCEmeaStandingsPanel(){
  const year = state.date.year;
  const bucket = (state.gcEmeaSeasonPoints||{})[year];
  if(!bucket || !Object.keys(bucket.totals).length) return '';
  const rows = Object.entries(bucket.totals).sort((a,b)=>b[1]-a[1]);
  return `
    <div class="sh-panel" style="margin-bottom:16px;overflow-x:auto;">
      <div class="sh-panel-title"><i class="fa-solid fa-ranking-star"></i> Classement ${gcRegionLabel()} — route vers Championship (${year})</div>
      <table class="sh-table sh-standings">
        <thead><tr><th>#</th><th>Équipe</th><th>Total</th><th>Stage 1</th><th>Stage 2</th><th>Stage 3</th></tr></thead>
        <tbody>
          ${rows.map(([name,total],i)=>`
            <tr class="${name===state.org.name?'self':''}">
              <td>${i+1}</td>
              <td>${kickoffTeamCell(name)}</td>
              <td><b>${total}</b></td>
              <td>${bucket.byStage.stage1[name] ?? '—'}</td>
              <td>${bucket.byStage.stage2[name] ?? '—'}</td>
              <td>${bucket.byStage.stage3[name] ?? '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
/* ============================================================
   STAGE 1 PROMOTION/RELEGATION — évènement annuel de mars, juste après la
   fenêtre Stage 1 (voir GC_STAGE1_WINDOW_*) : Group Stage (16 équipes du
   vivier Cash Cup EMEA n'ayant pas participé au Stage 1, 4 groupes de 4,
   round-robin Bo3, 1re place qualifiée) puis Playoffs — Upper Bracket
   (champ Stage 1, "Quadruple-Elimination") et Lower-Mid Bracket (les 4
   qualifiées du Group Stage, "Double-Elimination"), qui convergent en une
   finale unique. Simplification volontaire des deux brackets (voir
   initGCPromoRelPlayoffBracket ci-dessous) : reconstruit CASE PAR CASE
   d'après le diagramme officiel fourni pour cet évènement — Upper Bracket
   (4 seeds Stage 1) → Upper Mid → Lower Mid (4 seeds Group Stage,
   convergeant avec les repêchés de l'Upper Mid) → Lower Bracket, 4
   qualifiées pour Stage 2 (une par piste), reste du champ classé par
   profondeur d'élimination dans le Lower Bracket pour la relégation.
   ============================================================ */
const GC_STAGE1_PROMOREL_MONTH = 2; // mars (index 0 = janvier)
const GC_STAGE1_PROMOREL_GROUPS_WINDOW = [20,22];
const GC_STAGE1_PROMOREL_PLAYOFFS_WINDOW = [25,29];

// --- Bracket des Playoffs (8 équipes : 4 seeds Upper + 4 seeds Lower Mid,
// 4 qualifiées pour Stage 2) — topologie fixe reconstruite du diagramme
// officiel, même esprit "cases pré-construites + repêchage en cascade" que
// simulateKickoffFormat/initKickoffBracket (script.js), adapté à cette
// forme précise (Upper→Upper Mid→Lower Mid→Lower, pas de Upper/Mid/Lower
// classique) :
//   UBSF (2) -> UBFinal (qualifiée #1) + perdants -> UpperMidSF
//   UpperMidSF -> UpperMidFinal (avec le perdant de UBFinal) (qualifiée #2)
//   LMR1 (2, seeds Lower Mid) -> LMR2 -> LowerMidSF (avec le perdant
//     d'UpperMidSF) -> LowerMidFinal (avec le perdant d'UpperMidFinal) (qualifiée #3)
//   perdants LMR1 -> LBR1 -> LBR2 (avec le perdant de LMR2) -> LBSF (avec
//     le perdant de LowerMidSF) -> LBFinal (avec le perdant de
//     LowerMidFinal) (qualifiée #4)
// 5 rounds au total (voir GC_PROMOREL_PLAYOFF_ROUNDS), un par jour de la
// fenêtre Playoffs (25-29 mars) dans le cas normal.
function initGCPromoRelPlayoffBracket(upperSeeds, lowerSeeds){
  const slot = (a,b)=>({ a:a||null, b:b||null, winner:null, loser:null, scoreA:null, scoreB:null, mapsToWin:2 });
  return {
    ubsf: [ slot(upperSeeds[0], upperSeeds[3]), slot(upperSeeds[1], upperSeeds[2]) ],
    ubfinal: slot(),
    umsf: slot(),
    umfinal: slot(),
    lmr1: [ slot(lowerSeeds[0], lowerSeeds[3]), slot(lowerSeeds[1], lowerSeeds[2]) ],
    lmr2: slot(),
    lmsf: slot(),
    lmfinal: slot(),
    lbr1: slot(),
    lbr2: slot(),
    lbsf: slot(),
    lbfinal: slot(),
    qualified: [], // rempli au fur et à mesure (ordre : Upper, Upper Mid, Lower Mid, Lower)
  };
}
const GC_PROMOREL_PLAYOFF_ROUNDS = ['r1','r2','r3','r4','r5'];
// ids de case -> chemin dans le bracket, pour retrouver/compléter le match
// du joueur (voir tryScheduleSelfGCPromoRelMatch/completePendingGCPromoRelMatch).
function getGCPromoRelMatch(bracket, matchId){
  if(matchId==='ubsf0') return bracket.ubsf[0];
  if(matchId==='ubsf1') return bracket.ubsf[1];
  if(matchId==='lmr1a') return bracket.lmr1[0];
  if(matchId==='lmr1b') return bracket.lmr1[1];
  return bracket[matchId] || null;
}
function gcPromoRelBracketDone(bracket){ return bracket.qualified.length >= 4; }
// Résout un round nommé du bracket : joue chaque case déjà "ouverte" (ses
// deux adversaires connus) de ce round via resolveGCCashCupMatch (silencieux,
// IA comme joueur — sauf le match du joueur, intercepté à part), puis
// alimente les cases du round suivant avec les vainqueurs/perdants.
// Renvoie {blocked:true} si le match du joueur fait partie de ce round et
// reste à jouer (round entier gelé jusqu'à ce qu'il soit joué, même
// principe que resolveGCCashCupGroupRound).
function resolveGCPromoRelPlayoffRound(ev, roundKey, promoRelStage){
  const b = ev.playoffBracket;
  let blocked = false;
  const play = (m, matchId)=>{
    if(!m || !m.a || !m.b || m.winner) return;
    if(m.a===state.org.name || m.b===state.org.name){
      blocked = true;
      if(!ev.pendingMatch) tryScheduleSelfGCPromoRelMatch(ev, promoRelStage, 'bracket', { matchId });
      return;
    }
    const r = resolveGCCashCupMatch(m.a, m.b, 'bo3');
    m.winner = r.winner; m.loser = r.loser; m.scoreA = r.scoreA; m.scoreB = r.scoreB;
  };
  if(roundKey==='r1'){
    play(b.ubsf[0],'ubsf0'); play(b.ubsf[1],'ubsf1'); play(b.lmr1[0],'lmr1a'); play(b.lmr1[1],'lmr1b');
  } else if(roundKey==='r2'){
    if(b.ubsf[0].winner && b.ubsf[1].winner){
      b.ubfinal.a = b.ubsf[0].winner; b.ubfinal.b = b.ubsf[1].winner;
      b.umsf.a = b.ubsf[0].loser; b.umsf.b = b.ubsf[1].loser;
    }
    if(b.lmr1[0].winner && b.lmr1[1].winner){
      b.lmr2.a = b.lmr1[0].winner; b.lmr2.b = b.lmr1[1].winner;
      b.lbr1.a = b.lmr1[0].loser; b.lbr1.b = b.lmr1[1].loser;
    }
    play(b.ubfinal,'ubfinal'); play(b.umsf,'umsf'); play(b.lmr2,'lmr2'); play(b.lbr1,'lbr1');
  } else if(roundKey==='r3'){
    if(b.ubfinal.winner && b.umsf.winner){ b.umfinal.a = b.ubfinal.loser; b.umfinal.b = b.umsf.winner; }
    if(b.umsf.winner && b.lmr2.winner){ b.lmsf.a = b.umsf.loser; b.lmsf.b = b.lmr2.winner; }
    if(b.lmr2.winner && b.lbr1.winner){ b.lbr2.a = b.lmr2.loser; b.lbr2.b = b.lbr1.winner; }
    play(b.umfinal,'umfinal'); play(b.lmsf,'lmsf'); play(b.lbr2,'lbr2');
  } else if(roundKey==='r4'){
    if(b.umfinal.winner && b.lmsf.winner){ b.lmfinal.a = b.umfinal.loser; b.lmfinal.b = b.lmsf.winner; }
    if(b.lmsf.winner && b.lbr2.winner){ b.lbsf.a = b.lmsf.loser; b.lbsf.b = b.lbr2.winner; }
    play(b.lmfinal,'lmfinal'); play(b.lbsf,'lbsf');
  } else if(roundKey==='r5'){
    if(b.lmfinal.winner && b.lbsf.winner){ b.lbfinal.a = b.lmfinal.loser; b.lbfinal.b = b.lbsf.winner; }
    play(b.lbfinal,'lbfinal');
  }
  [b.ubfinal, b.umfinal, b.lmfinal, b.lbfinal].forEach(m=>{ if(m.winner && !b.qualified.includes(m.winner)) b.qualified.push(m.winner); });
  return { blocked };
}
function resolvePromoRelPlayoffRoundIndex(ev, promoRelStage){
  const b = ev.playoffBracket;
  for(let i=0;i<GC_PROMOREL_PLAYOFF_ROUNDS.length;i++){
    const key = GC_PROMOREL_PLAYOFF_ROUNDS[i];
    const res = resolveGCPromoRelPlayoffRound(ev, key, promoRelStage);
    if(res.blocked) return;
    if(gcPromoRelBracketDone(b)) return;
  }
}

// --- Group Stage (qualification vers les seeds Lower Mid) --------------
function initGCPromoRelGroupStage(teamNames){
  const shuffled = shuffle([...teamNames]);
  const groups = {};
  for(let i=0;i<4;i++){
    const key = String.fromCharCode(65+i);
    const names = shuffled.slice(i*4,(i+1)*4);
    groups[key] = { teams: names.map(n=>({name:n,w:0,l:0,mapsFor:0,mapsAgainst:0})), rounds: generateRoundRobinRounds(names), roundIndex:0 };
  }
  return { groups };
}
function gcPromoRelGroupStandings(group){
  return [...group.teams].sort((a,b)=> (b.w-a.w) || ((b.mapsFor-b.mapsAgainst)-(a.mapsFor-a.mapsAgainst)) || (b.mapsFor-a.mapsFor));
}
function allGCPromoRelGroupsDone(groupStage){
  return Object.values(groupStage.groups).every(g=> g.roundIndex >= g.rounds.length);
}
// Même idiome que resolveGCCashCupGroupRound : un groupe contenant le
// joueur reste entièrement gelé (pas d'avancée de roundIndex, pas de
// résolution des AUTRES paires de ce round) tant que son match n'est pas
// joué — voir completePendingGCPromoRelMatch, qui débloque tout d'un coup.
function resolveGCPromoRelGroupRound(ev, groupStage){
  Object.values(groupStage.groups).forEach(g=>{
    if(g.roundIndex >= g.rounds.length) return;
    const pairs = g.rounds[g.roundIndex] || [];
    const myPair = pairs.find(p=>p.includes(state.org.name));
    if(myPair){
      if(!ev.pendingMatch){
        tryScheduleSelfGCPromoRelMatch(ev, 'stage1', 'groups', myPair[0]===state.org.name?myPair[1]:myPair[0]);
      }
      return;
    }
    pairs.forEach(([a,b])=>{
      const r = resolveGCCashCupMatch(a,b,'bo3');
      applyGCCashCupGroupResult(g,a,b,r);
    });
    g.roundIndex++;
  });
}

// --- Match du joueur (Group Stage ou bracket) — même idiome pendingMatch/
// calendrier que tryScheduleSelfGCCashCupMatch. Générique sur `ev`/
// `promoRelStage` ('stage1'|'stage2') pour être réutilisé tel quel par la
// Promotion/Relegation de Stage 2 (même moteur de bracket, voir
// initGCPromoRelPlayoffBracket) sans dupliquer cette logique. -------------
function tryScheduleSelfGCPromoRelMatch(ev, promoRelStage, stage, extra){
  if(ev.pendingMatch) return true;
  const evKey = eventKey('valorant_gc', state.date.year, state.date.month, state.date.day);
  const existingMatch = (state.calendarEvents[evKey]||[]).find(e=>e.type==='match');
  if(existingMatch) return false;
  let opponentName;
  if(stage==='groups'){
    opponentName = extra;
    ev.pendingMatch = { stage, opponentName, mapsToWin:2 };
  } else {
    const m = getGCPromoRelMatch(ev.playoffBracket, extra.matchId);
    opponentName = m.a===state.org.name ? m.b : m.a;
    ev.pendingMatch = { stage:'bracket', matchId:extra.matchId, opponentName, mapsToWin:2 };
  }
  state.calendarEvents[evKey] = state.calendarEvents[evKey] || [];
  state.calendarEvents[evKey].push({ type:'match', label:`vs ${opponentName}`, opponent:opponentName, played:false, gcPromoRelRef:promoRelStage });
  const stageLabel = promoRelStage==='stage2' ? 'Stage 2' : 'Stage 1';
  pushNotification(`🏆 Votre match ${stageLabel} Promotion/Relegation ${gcRegionLabel()} contre ${opponentName} est prêt, cliquez sur "Jouer le match" !`);
  return true;
}
function completePendingGCPromoRelMatch(promoRelStage, matchResult){
  const ev = promoRelStage==='stage2' ? state.gcStage2PromoRelegation : state.gcStage1PromoRelegation;
  const pending = ev && ev.pendingMatch;
  if(!pending) return;
  const selfWon = !!matchResult.won;
  const winner = selfWon ? state.org.name : pending.opponentName;
  let selfWins = matchResult.dayMatch ? matchResult.dayMatch.sh : (selfWon?2:0);
  let oppWins = matchResult.dayMatch ? matchResult.dayMatch.sa : (selfWon?0:2);
  if(selfWon && selfWins<2) selfWins=2;
  if(!selfWon && oppWins<2) oppWins=2;

  if(pending.stage==='groups'){
    const group = Object.values(ev.groupStage.groups).find(g=> g.teams.some(t=>t.name===state.org.name));
    if(group){
      applyGCCashCupGroupResult(group, state.org.name, pending.opponentName, { winner, scoreA:selfWins, scoreB:oppWins });
      (group.rounds[group.roundIndex]||[]).forEach(([a,b])=>{
        if(a===state.org.name || b===state.org.name) return;
        const r = resolveGCCashCupMatch(a,b,'bo3');
        applyGCCashCupGroupResult(group,a,b,r);
      });
      group.roundIndex++;
    }
  } else {
    const m = getGCPromoRelMatch(ev.playoffBracket, pending.matchId);
    m.winner = winner; m.loser = winner===m.a ? m.b : m.a;
    m.scoreA = m.a===state.org.name ? selfWins : oppWins;
    m.scoreB = m.a===state.org.name ? oppWins : selfWins;
  }
  ev.pendingMatch = null;
  if(promoRelStage==='stage2') catchUpGCStage2PromoRelegation(); else catchUpGCStage1PromoRelegation();
}
// Classement final (8 équipes) : les 4 qualifiées pour Stage 2 (promues,
// classées Upper > Upper Mid > Lower Mid > Lower selon la piste d'où elles
// viennent, cohérent avec la hiérarchie du bracket), puis les 4 équipes
// réellement sorties du Lower Bracket (places 5-8, classées par
// profondeur d'élimination — perdant de LBFinal = 5e, jusqu'au perdant de
// LBR1 = 8e) — reléguées sous réserve de la règle d'exemption VST : toute
// organisation GC_TEAMS_EMEA est protégée, jamais réellement reléguée
// (moins de 4 places réellement pourvues ce cycle-là si l'une s'y trouve,
// jamais remplacée par une équipe mieux classée).
function buildGCPromoRelFinalStandings(ev){
  const b = ev.playoffBracket;
  const promoted = [b.ubfinal.winner, b.umfinal.winner, b.lmfinal.winner, b.lbfinal.winner].filter(Boolean);
  const bottomCandidates = [b.lbfinal.loser, b.lbsf.loser, b.lbr2.loser, b.lbr1.loser].filter(Boolean);
  // myGCAffiliatedTeams() plutôt que GC_TEAMS_EMEA en dur : cette fonction
  // est réutilisée pour les 4 régions (Stage 1 ET Stage 2 Promotion/
  // Relegation) — la règle d'exemption VST doit protéger les organisations
  // RÉELLEMENT affiliées de la région EN COURS, pas toujours celles d'EMEA.
  const relegated = bottomCandidates.filter(name=> !myGCAffiliatedTeams().includes(name) && !promoted.includes(name));
  relegated.forEach(name=>{ state.gcRelegatedUntil[name] = ev.year + 1; });
  const order = [...promoted, ...bottomCandidates];
  ev.finalStandings = order.map((name,i)=>({ name, place:i+1, promoted:promoted.includes(name), relegated:relegated.includes(name) }));
}
// stageLabel : 'Stage 1' ou 'Stage 2' — même fonction réutilisée telle
// quelle pour les deux Promotion/Relegation (même moteur de bracket, seul
// le libellé et le point d'ancrage dans l'historique changent).
function awardGCStage1PromoRelPrize(ev, stageLabel){
  if(ev.prizeAwarded) return;
  ev.prizeAwarded = true;
  const region = gcRegionLabel();
  const champion = ev.playoffBracket.ubfinal.winner;
  const eventLabel = `${stageLabel} Promotion/Relegation`;
  pushGCCompetitionHistory({ year:ev.year, competition:`${eventLabel} ${region}`, label:`${eventLabel} ${region}, ${ev.year}`, champion, isSelf: champion===state.org.name });
  const selfEntry = ev.finalStandings.find(e=>e.name===state.org.name);
  if(selfEntry && selfEntry.promoted){
    const prize = GC_CASHCUP_PRIZE*2;
    state.budget += prize;
    recordTransaction('valorant_gc', 'other', `${eventLabel} ${region}, promotion (#${selfEntry.place})`, prize);
    state.reputation = Math.min(100, (state.reputation||0)+4);
    pushNotification(`📈 ${state.org.name} termine #${selfEntry.place} au ${eventLabel} ${region} ! Prime : ${formatMoney(prize)}.`);
    pushNews(`${state.org.name} termine #${selfEntry.place} au ${eventLabel} ${region}.`, 'result', 'valorant_gc');
  } else if(selfEntry && selfEntry.relegated){
    state.reputation = Math.max(0, (state.reputation||0)-4);
    pushNotification(`📉 ${state.org.name} termine #${selfEntry.place} au ${eventLabel} ${region} et perd sa place affiliée pour la saison prochaine.`);
    pushNews(`${state.org.name} est reléguée à l'issue du ${eventLabel} ${region}.`, 'result', 'valorant_gc');
  } else if(selfEntry){
    pushNotification(`${state.org.name} termine #${selfEntry.place} au ${eventLabel} ${region}.`);
  }
  if(champion!==state.org.name) pushNews(`${champion} remporte le ${eventLabel} ${region} (Valostrike GC).`);
}
// Point d'entrée quotidien (voir advanceDay), même idiome d'auto-réparation
// par fenêtre de jours que catchUpGCCashCupEmea.
function catchUpGCStage1PromoRelegation(){
  const d = state.date;
  let ev = state.gcStage1PromoRelegation;
  if(ev && ev.year===d.year && ev.phase==='done') return; // déjà terminé cette année
  if(!ev || ev.year!==d.year){
    if(d.month!==GC_STAGE1_PROMOREL_MONTH) return; // ne démarre qu'en mars
    ev = state.gcStage1PromoRelegation = {
      year:d.year, phase:'groups',
      groupStage:null, qualifiers:null, upperSeeds:null,
      playoffBracket:null, finalStandings:null,
      prizeAwarded:false, pendingMatch:null,
    };
  }
  if(d.month===GC_STAGE1_PROMOREL_MONTH && d.day < GC_STAGE1_PROMOREL_GROUPS_WINDOW[0]) return;
  // Une fois démarré, continue de se résoudre même après la fin de mars (un
  // champ réduit, ex. Kickoff pas encore joué cette année, peut avoir
  // besoin de plus de rounds que mars n'a de jours, surtout si le joueur
  // bloque un round par jour au maximum) : jamais bloqué pour de bon comme
  // le serait un simple retour anticipé sur le mois, seule la phase 'done'
  // arrête vraiment la fonction (voir plus haut).
  const pastMarch = d.month!==GC_STAGE1_PROMOREL_MONTH;

  if(ev.phase==='groups'){
    if(!ev.groupStage){
      // 4 seeds Upper = le TOP 4 du champ Stage 1 par force — le diagramme
      // officiel n'aligne que 4 équipes côté Upper Bracket, pas les 10 du
      // champ Stage 1 complet.
      const stage1Field = buildGCStage1Field(true);
      ev.upperSeeds = [...stage1Field].sort((a,b)=> gcTeamStrength(b)-gcTeamStrength(a)).slice(0,4);
      const usedNames = new Set(stage1Field);
      const pool = ensureGCTeamPool();
      const candidates = shuffle(Object.values(pool).filter(t=> t.region===myValorantGCRegion() && !usedNames.has(t.name)).map(t=>t.name));
      const groupFieldNames = candidates.slice(0,16);
      if(state.sections.includes('valorant_gc') && !usedNames.has(state.org.name) && !groupFieldNames.includes(state.org.name) && groupFieldNames.length){
        groupFieldNames[randInt(0,groupFieldNames.length-1)] = state.org.name;
      }
      ev.groupStage = initGCPromoRelGroupStage(groupFieldNames);
    }
    resolveGCPromoRelGroupRound(ev, ev.groupStage);
    if(pastMarch || d.day > GC_STAGE1_PROMOREL_GROUPS_WINDOW[1]){
      let guard=0;
      while(!allGCPromoRelGroupsDone(ev.groupStage) && !ev.pendingMatch && guard<8){ resolveGCPromoRelGroupRound(ev, ev.groupStage); guard++; }
    }
    if(allGCPromoRelGroupsDone(ev.groupStage)){
      ev.qualifiers = Object.values(ev.groupStage.groups).map(g=> gcPromoRelGroupStandings(g)[0].name);
      const lowerSeeds = [...ev.qualifiers].sort((a,b)=> gcTeamStrength(b)-gcTeamStrength(a));
      ev.playoffBracket = initGCPromoRelPlayoffBracket(ev.upperSeeds, lowerSeeds);
      ev.phase = 'playoffs';
    }
    return;
  }

  if(ev.phase==='playoffs'){
    if(!pastMarch && d.day < GC_STAGE1_PROMOREL_PLAYOFFS_WINDOW[0]) return;
    resolvePromoRelPlayoffRoundIndex(ev, 'stage1');
    if(pastMarch || d.day > GC_STAGE1_PROMOREL_PLAYOFFS_WINDOW[1]){
      let guard=0;
      while(!gcPromoRelBracketDone(ev.playoffBracket) && !ev.pendingMatch && guard<20){ resolvePromoRelPlayoffRoundIndex(ev, 'stage1'); guard++; }
    }
    if(gcPromoRelBracketDone(ev.playoffBracket) && !ev.finalStandings){
      buildGCPromoRelFinalStandings(ev);
      // Une équipe promue qui n'était pas déjà dans le champ Stage 1 de
      // base (venue du Group Stage / vivier Cash Cup) rejoint le vivier
      // "promue cette année" — lu par buildGCStage2Field pour que Stage 2
      // parte bien du roster mis à jour par cette Promotion/Relegation.
      const baseField = new Set([...(ev.upperSeeds||[]), state.org.name]);
      state.gcPromotedThisYear = ev.finalStandings.filter(e=>e.promoted && !baseField.has(e.name)).map(e=>e.name);
      awardGCStage1PromoRelPrize(ev, 'Stage 1');
      ev.phase = 'done';
    }
    return;
  }
}

/* ============================================================
   STAGE 2 (avril-mai) — même roster que le champ Stage 1, mis à jour par
   la Promotion/Relegation de mars (voir buildGCStage2Field) : UN groupe de
   10 en round-robin, puis Playoffs Top 6 (2 byes + Knockout Round pour les
   seeds 3-6, élimination simple, puis double-élimination classique à 4
   jusqu'à la Grande Finale Bo5) — format réel confirmé par capture d'écran.
   ============================================================ */
const GC_STAGE2_GROUPS_START = { month:3, day:27 };  // 27 avril
const GC_STAGE2_GROUPS_END   = { month:4, day:14 };  // 14 mai
const GC_STAGE2_PLAYOFFS_START = { month:4, day:20 };
const GC_STAGE2_PLAYOFFS_END   = { month:4, day:24 };
const GC_STAGE2_PRIZE_POOL = 33000; // même ordre de grandeur que Stage 1, Riot ne publie pas de barème détaillé pour ce stage non plus
function gcDateTs(year, ref){ return new Date(year, ref.month, ref.day).getTime(); }
function isGCStage2Window(d){
  const cur = new Date(d.year, d.month, d.day).getTime();
  return cur >= gcDateTs(d.year, GC_STAGE2_GROUPS_START) && cur <= gcDateTs(d.year, GC_STAGE2_PLAYOFFS_END);
}
// Champ Stage 2 : le champ Stage 1 de l'année (déjà à jour des exclusions
// gcRelegatedUntil) UNIONNÉ aux équipes promues cette année par la
// Promotion/Relegation de mars mais pas déjà dedans (voir
// state.gcPromotedThisYear, alimenté dans catchUpGCStage1PromoRelegation) —
// jamais plus de 10 équipes, cohérent avec le format réel à un seul groupe.
function buildGCStage2Field(includeSelf){
  const base = buildGCStage1Field(includeSelf);
  const promoted = (state.gcPromotedThisYear||[]).filter(n=> includeSelf || n!==state.org.name);
  const names = [...new Set([...base, ...promoted])].slice(0,10);
  return shuffle(names);
}
function gcStage2Standings(stage){
  return [...stage.teams].sort((a,b)=> (b.w-a.w) || ((b.mapsFor-b.mapsAgainst)-(a.mapsFor-a.mapsAgainst)) || (b.mapsFor-a.mapsFor));
}
function tryScheduleSelfGCStage2Match(stage, extra){
  const s2 = state.gcStage2Emea;
  if(s2.pendingMatch) return true;
  const evKey = eventKey('valorant_gc', state.date.year, state.date.month, state.date.day);
  const existingMatch = (state.calendarEvents[evKey]||[]).find(e=>e.type==='match');
  if(existingMatch) return false;
  let opponentName, mapsToWin;
  if(stage==='groups'){
    opponentName = extra; mapsToWin = 2;
    s2.pendingMatch = { stage, opponentName, mapsToWin };
  } else {
    const m = extra.m;
    opponentName = m.a===state.org.name ? m.b : m.a;
    mapsToWin = m.mapsToWin || 2;
    s2.pendingMatch = { stage, matchId:extra.matchId, opponentName, mapsToWin };
  }
  state.calendarEvents[evKey] = state.calendarEvents[evKey] || [];
  state.calendarEvents[evKey].push({ type:'match', label:`vs ${opponentName}`, opponent:opponentName, played:false, gcStage2Ref:true });
  pushNotification(`🏆 Votre match VST Game Changers ${gcRegionLabel()} (Stage 2) contre ${opponentName} est prêt, cliquez sur "Jouer le match" !`);
  return true;
}
function resolveGCStage2GroupRound(stage){
  if(stage.roundIndex >= stage.rounds.length) return;
  const pairs = stage.rounds[stage.roundIndex];
  const myPair = pairs.find(p=>p.includes(state.org.name));
  if(myPair){
    if(!state.gcStage2Emea.pendingMatch) tryScheduleSelfGCStage2Match('groups', myPair[0]===state.org.name?myPair[1]:myPair[0]);
    return;
  }
  pairs.forEach(([a,b])=>{
    const r = resolveGCCashCupMatch(a, b, 'bo3');
    applyGCCashCupGroupResult(stage, a, b, r);
  });
  stage.roundIndex++;
}
// Playoffs : Knockout Round (seeds 3-6, ÉLIMINATION SIMPLE — un perdant ici
// est directement hors du top 6, pas de repêchage) -> les 2 vainqueurs
// rejoignent les seeds 1-2 (byes) en Upper Bracket Semifinals -> UB Final +
// Lower Bracket Semifinals (perdants UB Semis) -> Lower Bracket Final
// (perdant UB Final + vainqueur LB Semis) -> Grande Finale (Bo5), double-
// élimination classique à 4 à partir de là.
function buildGCStage2PlayoffBracket(stage){
  const top6 = gcStage2Standings(stage).slice(0,6).map(t=>t.name);
  const slot = (a,b,mapsToWin=2)=>({ a:a||null, b:b||null, winner:null, loser:null, scoreA:null, scoreB:null, mapsToWin });
  return {
    seeds: top6,
    knockout: [ slot(top6[2], top6[5]), slot(top6[3], top6[4]) ],
    ubsf: [ slot(top6[0]), slot(top6[1]) ],
    ubfinal: slot(),
    lbsf: slot(),
    lbfinal: slot(null,null,3),
    grandfinal: slot(null,null,3),
    champion:null, viceChampion:null,
  };
}
function getGCStage2Match(bracket, matchId){
  if(matchId==='knockout0') return bracket.knockout[0];
  if(matchId==='knockout1') return bracket.knockout[1];
  if(matchId==='ubsf0') return bracket.ubsf[0];
  if(matchId==='ubsf1') return bracket.ubsf[1];
  return bracket[matchId] || null;
}
function resolveGCStage2PlayoffRound(s2){
  const b = s2.bracket;
  const play = (m, matchId)=>{
    if(!m || !m.a || !m.b || m.winner) return;
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCStage2Match('playoffs', { matchId, m }); return; }
    const r = resolveGCCashCupMatch(m.a, m.b, m.mapsToWin>=3?'bo5':'bo3');
    m.winner = r.winner; m.loser = r.loser; m.scoreA = r.scoreA; m.scoreB = r.scoreB;
  };
  play(b.knockout[0],'knockout0'); play(b.knockout[1],'knockout1');
  if(b.knockout[0].winner) b.ubsf[0].b = b.knockout[0].winner;
  if(b.knockout[1].winner) b.ubsf[1].b = b.knockout[1].winner;
  play(b.ubsf[0],'ubsf0'); play(b.ubsf[1],'ubsf1');
  if(b.ubsf[0].winner && b.ubsf[1].winner){
    b.ubfinal.a = b.ubsf[0].winner; b.ubfinal.b = b.ubsf[1].winner;
    b.lbsf.a = b.ubsf[0].loser; b.lbsf.b = b.ubsf[1].loser;
  }
  play(b.ubfinal,'ubfinal'); play(b.lbsf,'lbsf');
  if(b.ubfinal.winner && b.lbsf.winner){ b.lbfinal.a = b.ubfinal.loser; b.lbfinal.b = b.lbsf.winner; }
  play(b.lbfinal,'lbfinal');
  if(b.ubfinal.winner && b.lbfinal.winner){ b.grandfinal.a = b.ubfinal.winner; b.grandfinal.b = b.lbfinal.winner; }
  play(b.grandfinal,'grandfinal');
  if(b.grandfinal.winner && !b.champion){ b.champion = b.grandfinal.winner; b.viceChampion = b.grandfinal.loser; }
}
function completePendingGCStage2Match(matchResult){
  const s2 = state.gcStage2Emea;
  const pending = s2 && s2.pendingMatch;
  if(!pending) return;
  const selfWon = !!matchResult.won;
  const winner = selfWon ? state.org.name : pending.opponentName;
  const need = pending.mapsToWin || 2;
  let selfWins = matchResult.dayMatch ? matchResult.dayMatch.sh : (selfWon?need:0);
  let oppWins = matchResult.dayMatch ? matchResult.dayMatch.sa : (selfWon?0:need);
  if(selfWon && selfWins<need) selfWins=need;
  if(!selfWon && oppWins<need) oppWins=need;

  if(pending.stage==='groups'){
    applyGCCashCupGroupResult(s2.stage, state.org.name, pending.opponentName, { winner, scoreA:selfWins, scoreB:oppWins });
    (s2.stage.rounds[s2.stage.roundIndex]||[]).forEach(([a,b])=>{
      if(a===state.org.name || b===state.org.name) return;
      const r = resolveGCCashCupMatch(a,b,'bo3');
      applyGCCashCupGroupResult(s2.stage,a,b,r);
    });
    s2.stage.roundIndex++;
  } else {
    const m = getGCStage2Match(s2.bracket, pending.matchId);
    m.winner = winner; m.loser = winner===m.a ? m.b : m.a;
    m.scoreA = m.a===state.org.name ? selfWins : oppWins;
    m.scoreB = m.a===state.org.name ? oppWins : selfWins;
  }
  s2.pendingMatch = null;
  catchUpGCStage2();
  if(s2.bracket && s2.bracket.champion) awardGCStage2Prizes(s2);
}
// Reconstruit l'ordre 1er→6e de Stage 2 à partir du bracket (voir
// buildGCStage2PlayoffBracket) — profondeur d'élimination exacte, même
// principe que le classement 5-8 de la Promotion/Relegation : perdant de
// Lower Bracket Final = 3e (sorti le plus tard), perdant de Lower Bracket
// Semifinal = 4e, les 2 perdants du Knockout Round (éliminés au premier
// tour, jamais repêchés) partagent la 5e-6e place.
function gcStage2Placements(s2){
  const b = s2.bracket;
  return [b.champion, b.viceChampion, b.lbfinal.loser, b.lbsf.loser, ...b.knockout.map(m=>m.loser)].filter(Boolean);
}
function awardGCStage2Prizes(s2){
  if(s2.prizeAwarded) return;
  s2.prizeAwarded = true;
  const b = s2.bracket;
  const champion = b.champion, runnerUp = b.viceChampion;
  const region = gcRegionLabel();
  pushGCCompetitionHistory({ year:s2.year, competition:`Stage 2 ${region}`, label:`Stage 2 ${region}, ${s2.year}`, champion, isSelf: champion===state.org.name });
  awardGCStagePoints('stage2', s2.year, gcStage2Placements(s2));
  const shareOf = (pct)=> Math.round(GC_STAGE2_PRIZE_POOL * pct);
  if(champion===state.org.name || runnerUp===state.org.name){
    const prize = champion===state.org.name ? shareOf(GC_STAGE1_PRIZE_SHARES.champion) : shareOf(GC_STAGE1_PRIZE_SHARES.runnerUp);
    state.budget += prize;
    recordTransaction('valorant_gc', 'other', `Stage 2 ${region}, cashprize`, prize);
    state.reputation = Math.min(100, (state.reputation||0) + (champion===state.org.name?6:3));
    pushNotification(`🏆 ${state.org.name} ${champion===state.org.name?'remporte':'termine finaliste au'} Stage 2 ${region} ! Prime : ${formatMoney(prize)}.`);
    pushNews(`${state.org.name} ${champion===state.org.name?'sacré champion':'finaliste'} du Stage 2 ${region} (Valostrike GC).`, 'result', 'valorant_gc');
  } else if(champion!==state.org.name){
    pushNews(`${champion} remporte le Stage 2 ${region} (Valostrike GC).`);
  }
}
// Point d'entrée quotidien — même idiome d'auto-réparation par fenêtre de
// jours que catchUpGCCashCupEmea/catchUpGCStage1PromoRelegation.
function catchUpGCStage2(){
  const d = state.date;
  let s2 = state.gcStage2Emea;
  if(s2 && s2.year===d.year && s2.phase==='done') return;
  if(!s2 || s2.year!==d.year){
    if(!isGCStage2Window(d)) return; // ne démarre que dans la fenêtre officielle
    const field = buildGCStage2Field(true);
    s2 = state.gcStage2Emea = {
      year:d.year, phase:'groups',
      stage:{ teams: field.map(n=>({name:n,w:0,l:0,mapsFor:0,mapsAgainst:0})), rounds: generateRoundRobinRounds(field), roundIndex:0 },
      bracket:null, relegationCandidates:null, prizeAwarded:false, pendingMatch:null,
    };
  }
  const cur = new Date(d.year, d.month, d.day).getTime();
  const pastGroups = cur > gcDateTs(d.year, GC_STAGE2_GROUPS_END);
  const pastPlayoffs = cur > gcDateTs(d.year, GC_STAGE2_PLAYOFFS_END);

  if(s2.phase==='groups'){
    resolveGCStage2GroupRound(s2.stage);
    if(pastGroups){
      let guard=0;
      while(s2.stage.roundIndex<s2.stage.rounds.length && !s2.pendingMatch && guard<12){ resolveGCStage2GroupRound(s2.stage); guard++; }
    }
    if(s2.stage.roundIndex>=s2.stage.rounds.length){
      s2.bracket = buildGCStage2PlayoffBracket(s2.stage);
      // Bottom 4 du groupe : relégués vers la Promotion/Relegation Stage 2
      // (voir catchUpGCStage2PromoRelegation, seeds "Upper") — mémorisé
      // dès maintenant, indépendant du résultat des Playoffs.
      s2.relegationCandidates = gcStage2Standings(s2.stage).slice(-4).map(t=>t.name);
      s2.phase = 'playoffs';
    }
    return;
  }
  if(s2.phase==='playoffs'){
    if(cur < gcDateTs(d.year, GC_STAGE2_PLAYOFFS_START) && !pastGroups) return;
    resolveGCStage2PlayoffRound(s2);
    if(pastPlayoffs){
      let guard=0;
      while(!s2.bracket.champion && !s2.pendingMatch && guard<12){ resolveGCStage2PlayoffRound(s2); guard++; }
    }
    if(s2.bracket.champion){
      awardGCStage2Prizes(s2);
      s2.phase = 'done';
    }
  }
}

/* ============================================================
   STAGE 2 PROMOTION/RELEGATION (juin) — même moteur de bracket que Stage 1
   (voir initGCPromoRelPlayoffBracket), mais sans Group Stage dédié : les
   seeds "Upper" sont les 4 reléguées du groupe Stage 2
   (s2.relegationCandidates), les seeds "Lower Mid" sont les 4 meilleures
   équipes au classement des points Cash Cup gagnés entre avril et juin
   (voir gcCashCupPointsInRange) — c'est très exactement le mécanisme de
   qualification que tu as décrit.
   ============================================================ */
const GC_STAGE2_PROMOREL_MONTH = 5; // juin (index 0 = janvier)
function catchUpGCStage2PromoRelegation(){
  const d = state.date;
  let ev = state.gcStage2PromoRelegation;
  if(ev && ev.year===d.year && ev.phase==='done') return;
  if(!ev || ev.year!==d.year){
    // Ne démarre qu'une fois le Stage 2 lui-même terminé cette année (ses
    // 4 reléguées sont le seul ingrédient manquant) — pas de fenêtre de
    // calendrier fixe au jour près comme Stage 1 (le vrai évènement, 25
    // juin-5 juillet, arrive de toute façon après la clôture de Stage 2).
    const s2 = state.gcStage2Emea;
    if(!(s2 && s2.year===d.year && s2.phase==='done' && s2.relegationCandidates)) return;
    if(d.month < GC_STAGE2_PROMOREL_MONTH) return;
    const pointsRange = gcCashCupPointsInRange(d.year, 3, d.year, 5); // avril à juin
    const lowerSeeds = Object.entries(pointsRange).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([name])=>name);
    if(lowerSeeds.length < 4) return; // pas encore assez d'éditions Cash Cup résolues ce trimestre, réessaie les jours suivants
    ev = state.gcStage2PromoRelegation = {
      year:d.year, phase:'playoffs',
      upperSeeds: s2.relegationCandidates,
      playoffBracket: initGCPromoRelPlayoffBracket(s2.relegationCandidates, lowerSeeds),
      finalStandings:null, prizeAwarded:false, pendingMatch:null,
    };
  }
  if(ev.phase==='playoffs'){
    resolvePromoRelPlayoffRoundIndex(ev, 'stage2');
    // Toujours en rattrapage agressif (pas de fenêtre de jours dédiée à
    // faire respecter ici, contrairement à Stage 1) : dès que possible.
    let guard=0;
    while(!gcPromoRelBracketDone(ev.playoffBracket) && !ev.pendingMatch && guard<20){ resolvePromoRelPlayoffRoundIndex(ev, 'stage2'); guard++; }
    if(gcPromoRelBracketDone(ev.playoffBracket) && !ev.finalStandings){
      buildGCPromoRelFinalStandings(ev);
      // Même principe que gcPromotedThisYear côté Stage 1 (voir
      // catchUpGCStage1PromoRelegation) : une équipe promue ici et pas déjà
      // dans le champ Stage 2 de base rejoint le vivier lu par
      // buildGCStage3Field — bucket SÉPARÉ (suffixe 2) puisque les deux
      // Promotion/Relegation alimentent des champs différents à des moments
      // différents de l'année.
      const baseField = new Set([...(ev.upperSeeds||[]), state.org.name]);
      state.gcPromotedThisYear2 = ev.finalStandings.filter(e=>e.promoted && !baseField.has(e.name)).map(e=>e.name);
      awardGCStage1PromoRelPrize(ev, 'Stage 2');
      ev.phase = 'done';
    }
  }
}

// Panneau "Promo/Rel" du Season Hub — pour la phase 'playoffs' et 'done',
// vrai bracket-diagramme (renderKickoffBracketColumns, déjà générique en
// nombre de colonnes) ; pour la phase 'groups', simple liste de standings.
function renderGCPromoRelPanel(stageKey){
  const ev = stageKey==='stage2' ? state.gcStage2PromoRelegation : state.gcStage1PromoRelegation;
  const region = gcRegionLabel();
  const stageLabel = stageKey==='stage2' ? 'Stage 2' : 'Stage 1';
  if(!ev){
    const hint = stageKey==='stage2'
      ? `Le ${stageLabel} Promotion/Relegation ${region} se joue en juin, une fois le Stage 2 terminé et les points Cash Cup d'avril à juin comptabilisés.`
      : `Le ${stageLabel} Promotion/Relegation ${region} se joue chaque année en mars, juste après la fenêtre Stage 1.`;
    return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-arrow-right-arrow-left"></i><div>${hint}</div></div></div>`;
  }
  if(ev.phase==='groups'){
    return `
      <div class="sh-panel">
        <div class="sh-panel-title"><i class="fa-solid fa-arrow-right-arrow-left"></i> ${stageLabel} Promotion/Relegation ${region} — Group Stage</div>
        <div class="card-grid two">
          ${Object.entries(ev.groupStage.groups).map(([key,g])=>`
            <div class="card info-card">
              <div style="font-weight:700;margin-bottom:8px;">Groupe ${key}</div>
              ${gcPromoRelGroupStandings(g).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  if(ev.phase==='playoffs'){
    const b = ev.playoffBracket;
    return `
      <div class="sh-panel">
        <div class="sh-panel-title"><i class="fa-solid fa-arrow-right-arrow-left"></i> ${stageLabel} Promotion/Relegation ${region} — Playoffs</div>
        ${renderKickoffBracketColumns([
          { label:'Upper Bracket Semifinals', matches:b.ubsf },
          { label:'Upper Bracket Final', matches:[b.ubfinal] },
        ])}
        ${renderKickoffBracketColumns([
          { label:'Upper Mid Semifinal', matches:[b.umsf] },
          { label:'Upper Mid Final', matches:[b.umfinal] },
        ])}
        ${renderKickoffBracketColumns([
          { label:'Lower Mid Round 1', matches:b.lmr1 },
          { label:'Lower Mid Round 2', matches:[b.lmr2] },
          { label:'Lower Mid Semifinal', matches:[b.lmsf] },
          { label:'Lower Mid Final', matches:[b.lmfinal] },
        ])}
        ${renderKickoffBracketColumns([
          { label:'Lower Bracket Round 1', matches:[b.lbr1] },
          { label:'Lower Bracket Round 2', matches:[b.lbr2] },
          { label:'Lower Bracket Semifinals', matches:[b.lbsf] },
          { label:'Lower Bracket Final', matches:[b.lbfinal] },
        ])}
      </div>
    `;
  }
  return `
    <div class="sh-panel">
      <div class="sh-panel-title"><i class="fa-solid fa-trophy"></i> ${stageLabel} Promotion/Relegation ${region} — Résultat ${ev.year}</div>
      <div class="stat-leaderboard-card">
        ${(ev.finalStandings||[]).map(e=>`
          <div class="stat-leaderboard-row ${e.name===state.org.name?'self':''}">
            <span class="stat-leaderboard-rank">#${e.place}</span>
            <span class="stat-leaderboard-name">${kickoffTeamCell(e.name)}</span>
            <span class="stat-leaderboard-value">${e.promoted?'Promue':e.relegated?'Reléguée':''}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Classement — groupes du Cash Cup EMEA en cours (ou du Stage 1 pendant sa
// fenêtre) : réutilise les mêmes fonctions de classement que les panneaux
// Vue d'ensemble (gcCashCupGroupStandings/gcStage1Standings) pour ne jamais
// désynchroniser les deux vues, juste présentées ici en onglet dédié plutôt
// que noyées dans le récap de la compétition.
function renderGCStandingsPanel(){
  const region = gcRegionLabel();
  if(isGCStage1Window(state.date)){
    const s1 = state.gcStage1Emea;
    if(!s1){
      return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-ranking-star"></i><div>Le Stage 1 n'a pas encore commencé.</div></div></div>`;
    }
    if(s1.participating===false){
      return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-calendar-xmark"></i><div>Vous avez décliné l'invitation, le Stage 1 ${region} se joue sans votre organisation.</div></div></div>`;
    }
    return `
      <div class="sh-panel">
        <div class="sh-panel-title"><i class="fa-solid fa-ranking-star"></i> Classement, Stage 1 ${region}</div>
        ${gcStage1Standings(s1.stage).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
      </div>
    `;
  }
  const cup = state.gcCashCupEmea;
  if(!cup){
    return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-ranking-star"></i><div>Le prochain Cash Cup ${region} démarre en début de mois.</div></div></div>`;
  }
  if(cup.participating===false){
    return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-calendar-xmark"></i><div>Vous avez décliné l'invitation ce mois-ci, le Cash Cup ${region} se joue sans votre organisation.</div></div></div>`;
  }
  if(!cup.groups){
    return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-ranking-star"></i><div>Les groupes ne sont pas encore constitués (${cup.phase==='qualifier' ? "Open Qualifier en cours" : "en attente de l'ouverture de la phase de groupes"}).</div></div></div>`;
  }
  return `
    <div class="sh-panel">
      <div class="sh-panel-title"><i class="fa-solid fa-ranking-star"></i> Classement, Cash Cup ${region} (${MONTH_NAMES[cup.month]})</div>
      <div class="card-grid two">
        ${Object.entries(cup.groups).map(([key,g])=>`
          <div class="card info-card">
            <div style="font-weight:700;margin-bottom:8px;">Groupe ${key}</div>
            ${gcCashCupGroupStandings(g).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderGCStatsPanel(){
  const archive = state.gcCashCupStatsArchive || {};
  const live = state.gcCashCupStats;
  const keys = new Set(Object.keys(archive));
  if(live && Object.keys(live.byPlayer).length) keys.add(live.editionKey);
  const available = [...keys].sort((a,b)=>gcStatsEditionSortValue(b)-gcStatsEditionSortValue(a));
  if(!available.length){
    return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-chart-column"></i><div>Aucune statistique individuelle disponible pour l'instant, reviens une fois quelques journées de Cash Cup disputées.</div></div></div>`;
  }
  if(!gcStatsEditionView || !available.includes(gcStatsEditionView)) gcStatsEditionView = available[0];
  const selected = gcStatsEditionView;
  const byPlayer = (live && live.editionKey===selected) ? live.byPlayer : (archive[selected]||{});
  const rows = Object.values(byPlayer);
  const nav = `
    <div class="sh-panel">
      <div class="sh-panel-title"><i class="fa-solid fa-chart-column"></i> Statistiques individuelles</div>
      <p style="color:var(--text-secondary);font-size:12.5px;margin:-4px 0 12px;">Uniquement les matchs IA-vs-IA du Cash Cup / Stage 1, simulés en détail, ton propre match, résolu par tirage pondéré plutôt que manche par manche, n'alimente pas encore ces classements.</p>
      <div class="stat-comp-pills">
        ${available.map(k=>`<div class="stat-comp-pill ${k===selected?'active':''}" data-gcstatedition="${k}">${gcStatsEditionLabel(k)}</div>`).join('')}
      </div>
    </div>
  `;
  if(!rows.length){
    return `${nav}<div class="sh-panel"><div class="empty-state" style="padding:24px;"><div>Pas encore de statistiques pour cette édition.</div></div></div>`;
  }
  const body = `
    <div class="stat-leaderboard-grid">
      ${SEASON_HUB_STAT_CARDS.map(c=>{
        const top = rows.slice().sort((a,b)=>c.val(b)-c.val(a)).slice(0,10);
        return `
          <div class="stat-leaderboard-card">
            <div class="stat-leaderboard-title"><i class="fa-solid ${c.icon}"></i> ${c.label}</div>
            ${top.map((e,i)=>`
              <div class="stat-leaderboard-row ${e.teamName===state.org.name?'self':''}">
                <span class="stat-leaderboard-rank">#${i+1}</span>
                <span class="stat-leaderboard-name">${e.name}<span class="stat-leaderboard-team"> · ${e.teamName}</span></span>
                <span class="stat-leaderboard-value">${c.val(e)}${c.unit}</span>
              </div>
            `).join('')}
          </div>
        `;
      }).join('')}
    </div>
  `;
  return nav + body;
}
const GC_STAGE1_HUB_STEPS = [
  { key:'groups', label:'Phase de groupe' },
  { key:'playoffs', label:'Playoffs' },
  { key:'done', label:'Terminé' },
];
// Calendrier — fenêtre de la compétition ACTIVE (Stage 1 s'il est en
// cours, sinon le mois du Cash Cup EMEA courant) : même principe que
// renderSeasonHubCalendar (Valostrike classique), mais GC n'a qu'UNE
// compétition active à la fois (jamais de Split/Masters en parallèle),
// donc pas besoin de retrouver une phase VST — juste la fenêtre du jour.
function renderGCSeasonHubCalendar(){
  const gameId = 'valorant_gc';
  const region = gcRegionLabel();
  const today = new Date(state.date.year, state.date.month, state.date.day);
  let start, end, label;
  if(isGCStage1Window(state.date)){
    label = `Stage 1 ${region}`;
    start = new Date(state.date.year, GC_STAGE1_WINDOW_START.month, GC_STAGE1_WINDOW_START.day);
    end = new Date(state.date.year, GC_STAGE1_WINDOW_END.month, GC_STAGE1_WINDOW_END.day);
  } else if(isGCKickoffWindow(state.date)){
    label = 'Kickoff';
    start = new Date(state.date.year, GC_KICKOFF_WINDOW_START.month, GC_KICKOFF_WINDOW_START.day);
    end = new Date(state.date.year, GC_KICKOFF_WINDOW_END.month, GC_KICKOFF_WINDOW_END.day);
  } else if(state.gcCashCupEmea){
    const cup = state.gcCashCupEmea;
    label = `Cash Cup ${region}, ${MONTH_NAMES[cup.month]}`;
    start = new Date(cup.year, cup.month, 1);
    end = new Date(cup.year, cup.month, GC_CASHCUP_DEAD_WINDOW_START);
  } else {
    return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-calendar-days"></i><div>Aucune compétition en cours, le calendrier s'affichera dès l'ouverture du prochain Cash Cup ${region} ou du Stage 1.</div></div></div>`;
  }
  const seededMonths = new Set();
  for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
    const mk = `${d.getFullYear()}-${d.getMonth()}`;
    if(!seededMonths.has(mk)){ seedCalendarForMonth(d.getFullYear(), d.getMonth()); seededMonths.add(mk); }
  }
  const rows = [];
  for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
    const key = eventKey(gameId, d.getFullYear(), d.getMonth(), d.getDate());
    const ev = (state.calendarEvents[key]||[]).find(e=>e.type==='match');
    if(ev) rows.push({ y:d.getFullYear(), m:d.getMonth(), d:d.getDate(), opponent:ev.opponent, time:ev.time, competition:ev.competition||ev.label, played:ev.played });
  }
  return `
    <div class="sh-panel">
      <div class="sh-panel-title"><i class="fa-solid fa-calendar-days"></i> Calendrier, ${label}</div>
      <table class="sh-table sh-calendar">
        <thead><tr><th>Date</th><th>Heure</th><th>Compétition</th><th>Adversaire</th><th>Statut</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(r=>{
            const rowDate = new Date(r.y, r.m, r.d);
            const isToday = rowDate.getTime()===today.getTime();
            const isPast = rowDate < today;
            const playableToday = isToday && !r.played;
            return `<tr class="${isToday?'self':''}">
              <td>${r.d}/${r.m+1}</td><td>${r.time||'—'}</td><td>${r.competition}</td><td>${r.opponent||'—'}</td>
              <td>${playableToday
                ? `<button class="btn btn-primary btn-sm play-match-btn" data-game="valorant_gc"><i class="fa-solid fa-play"></i> Jouer le match</button>`
                : (isPast?'Terminé':(isToday?"Aujourd'hui":'À venir'))}</td>
            </tr>`;
          }).join('') : `<tr><td colspan="5">Aucun match programmé pour l'instant sur cette période.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}
// Historique — palmarès Cash Cup EMEA / Stage 1, alimenté au fil de la
// partie par pushGCCompetitionHistory (voir awardGCCashCupPrize/
// awardGCStage1Prizes) : même vide au départ que state.vct.historyLog côté
// Valostrike classique, se remplit édition après édition.
function renderGCSeasonHubHistory(){
  const history = state.gcCompetitionHistory || [];
  return `
    <div class="sh-panel">
      <div class="sh-panel-title"><i class="fa-solid fa-clock-rotate-left"></i> Historique</div>
      ${history.length ? history.map(h=>`
        <div class="info-row"><span>${h.label}</span><span>${h.isSelf ? `<b style="color:var(--accent);">${h.champion}</b>` : h.champion}, Champion</span></div>
      `).join('') : `<div class="empty-state" style="padding:16px;"><div>Aucun historique pour le moment.</div></div>`}
    </div>
  `;
}
// Contenu d'un sous-onglet du hub "Classement" GC — voir gcClassementView.
// L'onglet 'championship' peut ne pas avoir encore de données cette saison
// (renderGCEmeaStandingsPanel renvoie '' dans ce cas) : un empty-state
// dédié remplace la chaîne vide plutôt que de laisser l'onglet blanc.
function renderGCClassementBody(view){
  if(view.startsWith('region:')) return renderGCOtherRegionCashCupPanel(view.slice(7));
  if(view==='championship'){
    return renderGCEmeaStandingsPanel() || `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-ranking-star"></i><div>Aucun point de Championship enregistré pour le moment cette saison.</div></div></div>`;
  }
  if(view.startsWith('vst:')){
    const region = view.slice(4);
    const isMyRegion = region===myValorantGCRegion();
    const sub = gcVstSubTabs().some(t=>t.key===gcClassementSubView) ? gcClassementSubView : 'stage1';
    const label = GC_REGION_LABELS[region] || region;
    const body = sub==='stage1' ? (isMyRegion ? renderGCStage1Panel() : renderGCOtherRegionStage1Panel(region))
      : sub==='stage2' ? (isMyRegion ? renderGCStage2Panel() : renderGCOtherRegionStage2Panel(region))
      : (isMyRegion ? renderGCStage3Panel() : renderGCOtherRegionStage3Panel(region));
    const stageTitle = { stage1:'Stage 1', stage2:'Stage 2', stage3:'Stage 3' }[sub];
    return `<div class="sh-panel" style="overflow-x:auto;"><div class="section-title" style="margin-top:0;"><i class="fa-solid fa-trophy"></i> ${stageTitle} ${label}</div>${body}</div>`;
  }
  return renderGCStandingsPanel();
}
// Les 3 sous-onglets du groupe "VST EMEA" — Stage 1/2/3, consultables à
// tout moment (pas seulement pendant leur propre fenêtre).
function gcVstSubTabs(){
  return [
    { key:'stage1', label:'Stage 1' },
    { key:'stage2', label:'Stage 2' },
    { key:'stage3', label:'Stage 3' },
  ];
}
// Classement Cash Cup EN DIRECT d'une autre région GC (Americas/Pacific/
// China) — simulée en arrière-plan (voir catchUpGCOtherRegionsCashCup)
// même si le joueur n'y participe jamais, pour un vrai classement "temps
// réel" façon WORLD_HUB_TABS côté Valostrike classique. Même présentation
// que renderGCStandingsPanel (Cash Cup de la région du joueur), juste
// alimentée par state.gcOtherRegionsCashCup[region].
function renderGCOtherRegionCashCupPanel(region){
  const label = GC_REGION_LABELS[region] || region;
  const cup = (state.gcOtherRegionsCashCup||{})[region];
  if(!cup){
    return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-ranking-star"></i><div>Le prochain Cash Cup ${label} démarre en début de mois.</div></div></div>`;
  }
  if(!cup.groups){
    return `<div class="sh-panel"><div class="empty-state" style="padding:24px;"><i class="fa-solid fa-ranking-star"></i><div>Les groupes ne sont pas encore constitués (en attente de l'ouverture de la phase de groupes).</div></div></div>`;
  }
  if(cup.phase==='playoffs' || cup.phase==='done'){
    return `
      <div class="sh-panel" style="overflow-x:auto;">
        <div class="sh-panel-title"><i class="fa-solid fa-ranking-star"></i> Cash Cup ${label} (${MONTH_NAMES[cup.month]})${cup.bracket && cup.bracket.champion ? ` — Champion : <b style="color:var(--s-accent2);">${cup.bracket.champion}</b>` : ' — Playoffs'}</div>
        ${cup.bracket ? renderKickoffBracketColumns(cashCupBracketColumns(cup.bracket)) : ''}
      </div>
    `;
  }
  return `
    <div class="sh-panel">
      <div class="sh-panel-title"><i class="fa-solid fa-ranking-star"></i> Cash Cup ${label} (${MONTH_NAMES[cup.month]}) — Phase de groupes</div>
      <div class="card-grid two">
        ${Object.entries(cup.groups).map(([key,g])=>`
          <div class="card info-card">
            <div style="font-weight:700;margin-bottom:8px;">Groupe ${key}</div>
            ${gcCashCupGroupStandings(g).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
// Liste des sous-onglets du hub Classement GC — même gabarit visuel que le
// hub Classement de Valostrike classique (.worldhub-tabs, voir
// renderStandingsTab) mais dont les onglets pointent vers les VRAIES
// compétitions de la GC (Cash Cup en cours / Cash Cup saison / route
// Championship) plutôt que vers d'autres régions géographiques — la GC ne
// simule pas les 3 autres régions en arrière-plan (voir gcClassementView).
function gcClassementTabs(){
  const myRegion = myValorantGCRegion();
  const otherRegions = Object.keys(GC_REGION_LABELS).filter(r=>r!==myRegion);
  return [
    // Groupe "Cash Cup" : ta région d'abord (même libellé que les 3
    // autres, "Cash Cup <région>", au lieu du générique "Cash Cup en
    // cours"/"Cash Cup (saison)" fusionnés ici en un seul onglet), puis
    // les 3 autres régions.
    { key:'current', label:`Cash Cup ${GC_REGION_LABELS[myRegion]}` },
    ...otherRegions.map(r=>({ key:`region:${r}`, label:`Cash Cup ${GC_REGION_LABELS[r]}` })),
    { key:'championship', label:'Route Championship' },
    // Groupe "VST" : les 4 régions côte à côte (voir gcVstSubTabs pour les
    // sous-onglets Stage 1/2/3 communs aux 4) — même traitement pour
    // toutes, plus de traitement à part pour la tienne.
    { key:`vst:${myRegion}`, label:`VST ${GC_REGION_LABELS[myRegion]}` },
    ...otherRegions.map(r=>({ key:`vst:${r}`, label:`VST ${GC_REGION_LABELS[r]}` })),
  ];
}
// Page Classement dédiée pour Valostrike GC — pendant de renderStandingsTab
// (Valostrike classique) : atteinte via le bouton "Classement" du hub
// (vraie navigation, voir bindSeasonHubEvents/btnGCSeasonHubGlobalRanking)
// plutôt qu'un simple changement de vue interne au hub Saison. Réutilisée
// telle quelle par renderGCSeasonHubBody pour l'onglet 'classement' du hub,
// afin de ne jamais faire diverger les deux points d'entrée.
function renderGCStandingsTab(){
  const classTabs = gcClassementTabs();
  const activeClassView = classTabs.some(t=>t.key===gcClassementView) ? gcClassementView : 'current';
  const subTabs = activeClassView.startsWith('vst:') ? gcVstSubTabs() : null;
  const activeSubView = subTabs && subTabs.some(t=>t.key===gcClassementSubView) ? gcClassementSubView : 'stage1';
  return `
    <div class="section-title" style="margin-top:0;">Classement</div>
    <p style="color:var(--text-secondary);font-size:13px;margin-bottom:14px;">
      Suivez les compétitions de votre région Valostrike GC sans quitter votre ligue.
    </p>
    <div class="worldhub-tabs" id="gcClassementTabs">${classTabs.map(t=>`<button type="button" class="worldhub-tab ${activeClassView===t.key?'active':''}" data-gcclassview="${t.key}">${t.label}</button>`).join('')}</div>
    ${subTabs ? `<div class="worldhub-tabs" id="gcClassementSubTabs" style="margin-top:-6px;">${subTabs.map(t=>`<button type="button" class="worldhub-tab ${activeSubView===t.key?'active':''}" data-gcclasssubview="${t.key}">${t.label}</button>`).join('')}</div>` : ''}
    <div id="gcClassementBody" style="margin-top:12px;">${renderGCClassementBody(activeClassView)}</div>
  `;
}
function renderGCSeasonHubBody(view){
  if(view==='calendar')   return renderGCSeasonHubCalendar();
  if(view==='classement') return renderGCStandingsTab();
  if(view==='kickoff')    return `<div class="sh-panel"><div class="section-title" style="margin-top:0;"><i class="fa-solid fa-flag-checkered"></i> Kickoff</div>${renderGCKickoffPanel()}</div>`;
  if(view==='cashcup')    return `<div class="sh-panel">${renderGCCashCupPanel()}</div>`;
  if(view==='stage1')     return `<div class="sh-panel"><div class="section-title" style="margin-top:0;"><i class="fa-solid fa-trophy"></i> Stage 1 ${gcRegionLabel()}</div>${renderGCStage1Panel()}</div>`;
  if(view==='promorel')   return renderGCPromoRelPanel('stage1');
  if(view==='stage2')     return `<div class="sh-panel"><div class="section-title" style="margin-top:0;"><i class="fa-solid fa-trophy"></i> Stage 2 ${gcRegionLabel()}</div>${renderGCStage2Panel()}</div>`;
  if(view==='promorel2')  return renderGCPromoRelPanel('stage2');
  if(view==='stage3')     return `<div class="sh-panel"><div class="section-title" style="margin-top:0;"><i class="fa-solid fa-trophy"></i> Stage 3 ${gcRegionLabel()}</div>${renderGCStage3Panel()}</div>`;
  if(view==='champions')  return `<div class="sh-panel"><div class="section-title" style="margin-top:0;"><i class="fa-solid fa-globe"></i> Champions GC</div>${renderGCChampionsPanel()}</div>`;
  if(view==='history')    return renderGCSeasonHubHistory();
  if(isGCStage1Window(state.date)) return `<div class="sh-panel"><div class="section-title" style="margin-top:0;"><i class="fa-solid fa-trophy"></i> Stage 1 ${gcRegionLabel()}</div>${renderGCStage1Panel()}</div>`;
  if(isGCKickoffWindow(state.date)) return `<div class="sh-panel"><div class="section-title" style="margin-top:0;"><i class="fa-solid fa-flag-checkered"></i> Kickoff</div>${renderGCKickoffPanel()}</div>`;
  return `<div class="sh-panel">${renderGCCashCupPanel()}</div>`;
}
// Un seul hub, quelle que soit la compétition active (Cash Cup ou Stage 1)
// — en-tête/progression adaptés à celle-ci, mais la nav d'onglets et le
// contenu des onglets restent les mêmes (voir renderGCSeasonHubBody),
// contrairement à l'ancienne version qui bifurquait entre deux hubs
// séparés dès l'en-tête.
function renderGCSeasonHub(){
  const inStage1 = isGCStage1Window(state.date);
  const inKickoff = !inStage1 && isGCKickoffWindow(state.date);
  const nextEvent = findNextEvent();
  const hasNextEvent = nextEvent && nextEvent.gameId==='valorant_gc';
  const view = GC_SEASON_HUB_TABS.some(t=>t.key===gcSeasonHubView) ? gcSeasonHubView : 'overview';

  let title, subtitle, steps, currentIdx, kpis;
  if(inKickoff){
    const k = state.gcKickoff;
    const needed = k ? k.qualifiersNeeded : gcKickoffQualifiersNeeded(myValorantGCRegion());
    // Groupes (le plus long des groupes fixe le nombre de rounds à afficher,
    // ils tournent en parallèle) + 2 étapes Playoffs (demi-finales, finale) —
    // voir splitIntoGCKickoffGroups/initGCKickoffPlayoffBracket.
    const maxGroupRounds = k ? Math.max(1, ...k.groups.map(g=>g.rounds.length)) : 1;
    const roundsTotal = maxGroupRounds + 2;
    steps = Array.from({length:roundsTotal}, (_,i)=> i<maxGroupRounds
      ? { key:`g${i}`, label:`Groupes, round ${i+1}` }
      : { key: i===maxGroupRounds ? 'sf' : 'final', label: i===maxGroupRounds ? 'Demi-finales' : 'Finale' });
    if(!k) currentIdx = 0;
    else if(k.phase==='groups') currentIdx = Math.min(...k.groups.map(g=>g.roundIndex));
    else if(k.phase==='playoffs'){
      const b = k.playoffBracket;
      currentIdx = maxGroupRounds + (b.final.winner ? 1 : (b.sf[0].winner && b.sf[1].winner ? 1 : 0));
    } else currentIdx = roundsTotal-1;
    title = `SAISON ${state.date.year}`;
    subtitle = `Valostrike GC • Kickoff, qualification pour le Stage 1${k ? ` (${k.qualified.length}/${needed} qualifiées)` : ''}`;
    kpis = `
      <div class="sh-kpi">
        <div class="sh-kpi-icon"><i class="fa-solid fa-flag-checkered"></i></div>
        <div class="sh-kpi-label">Places à pourvoir</div>
        <div class="sh-kpi-value">${needed} / ${GC_VCT_GC_ROSTER_SIZE}</div>
        <div class="sh-kpi-sub">${myGCAffiliatedTeams().length} déjà affiliées, phase de groupe</div>
      </div>
    `;
  } else if(inStage1){
    const s1 = state.gcStage1Emea;
    const currentKey = s1 ? s1.phase : 'groups';
    steps = GC_STAGE1_HUB_STEPS;
    currentIdx = Math.max(0, steps.findIndex(s=>s.key===currentKey));
    const phaseLabel = (steps.find(s=>s.key===currentKey)||steps[0]).label;
    const notParticipating = s1 && s1.participating===false;
    title = `SAISON ${state.date.year}`;
    subtitle = `Valostrike GC • ${notParticipating ? 'Vous ne participez pas cette année (Stage 1)' : `Stage 1 ${gcRegionLabel()}, ${phaseLabel}`}`;
    kpis = `
      <div class="sh-kpi">
        <div class="sh-kpi-icon"><i class="fa-solid fa-trophy"></i></div>
        <div class="sh-kpi-label">Dotation Stage 1</div>
        <div class="sh-kpi-value">${formatMoney(GC_STAGE1_PRIZE_POOL)}</div>
        <div class="sh-kpi-sub">${GC_VCT_GC_ROSTER_SIZE} organisations en lice</div>
      </div>
    `;
  } else {
    const cup = state.gcCashCupEmea;
    steps = gcSeasonHubSteps(cup);
    const currentKey = cup ? cup.phase : 'groups';
    currentIdx = Math.max(0, steps.findIndex(s=>s.key===currentKey));
    const phaseLabel = (steps.find(s=>s.key===currentKey)||steps[0]).label;
    const notParticipating = cup && cup.participating===false;
    title = `SAISON ${state.date.year}`;
    subtitle = `Valostrike GC • ${notParticipating ? 'Vous ne participez pas ce mois-ci' : `Cash Cup ${gcRegionLabel()}, ${phaseLabel}`}${cup ? ` • ${gcCashCupFormatLabel(cup.format)}` : ''}`;
    kpis = `
      <div class="sh-kpi">
        <div class="sh-kpi-icon"><i class="fa-solid fa-trophy"></i></div>
        <div class="sh-kpi-label">Dotation Cash Cup</div>
        <div class="sh-kpi-value">${formatMoney(GC_CASHCUP_PRIZE)}</div>
        <div class="sh-kpi-sub">${gcCashCupFieldSize()} équipes en lice</div>
      </div>
    `;
  }

  return `
    <div class="season-hub">
      <div class="sh-header">
        <div>
          <div class="sh-title">${title}</div>
          <div class="sh-subtitle">${subtitle}</div>
        </div>
        <div class="sh-header-right">
          <div class="sh-date">${state.date.day} ${MONTH_NAMES[state.date.month]} ${state.date.year}</div>
          <div class="sh-header-actions">
            <button class="sh-btn" id="btnGCSeasonHubGlobalRanking"><i class="fa-solid fa-ranking-star"></i> Classement</button>
            <button class="sh-btn" data-gcshview="history"><i class="fa-solid fa-box-archive"></i> Archives</button>
          </div>
        </div>
      </div>
      <div class="sh-progress-wrap">
        <div class="sh-progress-track">
          ${steps.map((s,i)=>`<div class="sh-progress-step ${i===currentIdx?'active':(i<currentIdx?'done':'')}">${s.label}</div>`).join('')}
        </div>
      </div>
      <div class="sh-kpi-grid">
        ${kpis}
        <div class="sh-kpi">
          <div class="sh-kpi-icon"><i class="fa-solid fa-calendar-day"></i></div>
          <div class="sh-kpi-label">Prochain évènement</div>
          <div class="sh-kpi-value" style="font-size:15px;">${hasNextEvent ? nextEvent.label : 'Aucun'}</div>
          <div class="sh-kpi-sub">${hasNextEvent ? `${nextEvent.day}/${nextEvent.month+1}` : '—'}</div>
        </div>
      </div>
      ${renderGCSeasonHubNav()}
      ${renderGCSeasonHubBody(view)}
    </div>
  `;
}

function renderGCCashCupPanel(){
  const cup = state.gcCashCupEmea;
  const region = gcRegionLabel();
  if(!cup){
    return `
      <div class="section-title"><i class="fa-solid fa-trophy"></i> Cash Cup ${region}</div>
      <div class="empty-state" style="padding:20px;"><i class="fa-solid fa-trophy"></i><div>Le prochain Cash Cup ${region} démarre en début de mois.</div></div>
    `;
  }
  const monthLabel = MONTH_NAMES[cup.month];
  if(cup.participating===false){
    return `
      <div class="section-title"><i class="fa-solid fa-trophy"></i> Cash Cup ${region} <span class="profile-section-sub">${monthLabel}, invitation déclinée</span></div>
      <div class="empty-state" style="padding:20px;"><i class="fa-solid fa-calendar-xmark"></i><div>Vous avez décliné l'invitation ce mois-ci, le Cash Cup ${region} se joue sans votre organisation. Une nouvelle invitation arrivera pour l'édition suivante.</div></div>
    `;
  }
  if(cup.phase==='qualifier'){
    const qual = cup.qualifier;
    const rowsHtml = !qual ? '' : qual.matches.map(m=>`
      <div class="info-row"><span>${kickoffTeamCell(m.a)} vs ${kickoffTeamCell(m.b)}</span><span>${m.winner ? `${kickoffTeamCell(m.winner)} qualifié` : 'à venir'}</span></div>
    `).join('');
    return `
      <div class="section-title"><i class="fa-solid fa-trophy"></i> Cash Cup ${region} <span class="profile-section-sub">${monthLabel}, Open Qualifier</span></div>
      <p style="color:var(--text-secondary);font-size:12.5px;margin-bottom:12px;">Votre organisation est qualifiée d'office pour la phase de groupes (priorité VST Game Changers), seule l'issue des autres équipes se joue ici.</p>
      <div class="card info-card">${rowsHtml || `<div class="empty-state" style="padding:12px;">Tirage en cours.</div>`}</div>
    `;
  }
  if(cup.phase==='groups' && !cup.groups){
    // cup.phase passe à 'groups' dès la création de l'édition (formats sans
    // Open Qualifier, voir catchUpGCCashCupEmea) mais cup.groups lui-même
    // n'est construit qu'à l'ouverture réelle de la fenêtre — cet écart
    // provoquait un crash (Object.entries sur null) si la page se
    // re-rendait entre les deux (ex. juste après avoir accepté
    // l'invitation, avant l'ouverture de la fenêtre de groupes).
    return `
      <div class="section-title"><i class="fa-solid fa-trophy"></i> Cash Cup ${region} <span class="profile-section-sub">${monthLabel}</span></div>
      <div class="empty-state" style="padding:20px;"><i class="fa-solid fa-hourglass-half"></i><div>La phase de groupes n'a pas encore commencé.</div></div>
    `;
  }
  if(cup.phase==='groups'){
    const groupsHtml = Object.entries(cup.groups).map(([key,g])=>`
      <div class="card info-card" style="margin-bottom:10px;">
        <div style="font-weight:700;margin-bottom:8px;">Groupe ${key}</div>
        ${gcCashCupGroupStandings(g).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
      </div>
    `).join('');
    return `
      <div class="section-title"><i class="fa-solid fa-trophy"></i> Cash Cup ${region} <span class="profile-section-sub">${monthLabel}, ${gcCashCupFormatLabel(cup.format)}</span></div>
      <div class="card-grid two">${groupsHtml}</div>
    `;
  }
  if(cup.phase==='playoffs'){
    return `
      <div class="section-title"><i class="fa-solid fa-trophy"></i> Cash Cup ${region} <span class="profile-section-sub">${monthLabel}, playoffs</span></div>
      ${renderKickoffBracketColumns(cashCupBracketColumns(cup.bracket))}
    `;
  }
  return `
    <div class="section-title"><i class="fa-solid fa-trophy"></i> Cash Cup ${region} <span class="profile-section-sub">${monthLabel}, terminé</span></div>
    <div class="card info-card" style="text-align:center;padding:24px;">
      <i class="fa-solid fa-trophy" style="font-size:28px;color:var(--info);margin-bottom:10px;"></i>
      <div style="font-weight:700;font-size:16px;">${kickoffTeamCell(cup.bracket ? cup.bracket.champion : '—')}, Champion</div>
    </div>
    <p style="color:var(--text-secondary);font-size:12px;margin-top:10px;">Fenêtre morte jusqu'au prochain cycle, place aux matchs de championnat et au recrutement des rosters repérés.</p>
  `;
}

/* ============================================================
   KICKOFF — tournoi qui complète le plateau des 10 organisations "VST GC"
   de chaque région (voir gcKickoffQualifiersNeeded) : les organisations
   réellement affiliées (GC_TEAMS_BY_REGION) sont déjà dedans sans y
   participer — le Kickoff détermine SEULEMENT qui vient compléter le
   plateau jusqu'à 10. Format : phase de groupe unique en round-robin
   (Bo3), les N premières places qualifient — N variable selon la région
   (6 pour EMEA — 4 déjà affiliées —, 5 pour Americas, 7 pour Pacific, 10
   pour China, qui n'a encore aucune organisation affiliée). Un round-robin
   généralise proprement à N variable, contrairement à un bracket à
   élimination dont la forme impose un nombre de qualifiés fixe. Réutilise
   generateRoundRobinRounds/applyGCCashCupGroupResult (déjà génériques,
   déjà utilisés par le Stage 1) et resolveGCCashCupMatch pour chaque match
   (probabiliste pour ton propre match, moteur détaillé réel pour les
   matchs IA-vs-IA).
   ============================================================ */
// Fenêtre réelle (5 → 18 janvier, juste avant le Stage 1 qui démarre le 26 —
// voir GC_STAGE1_WINDOW_START), reconduite chaque année.
const GC_KICKOFF_WINDOW_START = { month:0, day:5 };
const GC_KICKOFF_WINDOW_END   = { month:0, day:18 };
function isGCKickoffWindow(d){
  const cur = new Date(d.year, d.month, d.day).getTime();
  const start = new Date(d.year, GC_KICKOFF_WINDOW_START.month, GC_KICKOFF_WINDOW_START.day).getTime();
  const end = new Date(d.year, GC_KICKOFF_WINDOW_END.month, GC_KICKOFF_WINDOW_END.day).getTime();
  return cur >= start && cur <= end;
}
// Champ du Kickoff : UNIQUEMENT des outsiders (jamais les organisations
// déjà affiliées, voir GC_TEAMS_BY_REGION — elles n'ont rien à prouver) +
// toi (si ta section GC est active et dans cette région) — un champ plus
// large que le strict nombre de places à pourvoir (+4, au moins 8), plafonné
// pour que le round-robin (N-1 rounds si N pair, N rounds si N impair) tienne
// toujours dans la fenêtre de 14 jours du Kickoff (5-18 janvier) à raison
// d'un round par jour réel — le pire cas (Chine, needed=10) donne un champ de
// 14 équipes → 13 rounds, avec de la marge (voir catchUpGCKickoff).
function buildGCKickoffField(region, includeSelf){
  const pool = ensureGCTeamPool();
  const needed = gcKickoffQualifiersNeeded(region);
  const target = Math.max(needed + 4, 8);
  const affiliated = new Set(GC_TEAMS_BY_REGION[region] || []);
  const names = new Set();
  if(includeSelf && state.sections.includes('valorant_gc') && myValorantGCRegion()===region) names.add(state.org.name);
  const fillers = shuffle(Object.keys(pool).filter(n=>!names.has(n) && !affiliated.has(n) && pool[n].region===region));
  let i=0;
  while(names.size<target && i<fillers.length) names.add(fillers[i++]);
  return [...names];
}
// Répartit le champ en groupes de 4 (dernier groupe plus petit si le
// champ n'est pas multiple de 4) — le champ est déjà mélangé par
// buildGCKickoffField (shuffle), une distribution simple par indice
// suffit donc à ne pas regrouper systématiquement les mêmes forces.
function splitIntoGCKickoffGroups(field){
  const groupCount = Math.max(1, Math.ceil(field.length/4));
  const buckets = Array.from({length:groupCount}, ()=>[]);
  field.forEach((name,i)=> buckets[i%groupCount].push(name));
  return buckets.map(teamNames=>({
    teams: teamNames.map(name=>({ name, w:0, l:0, mapsFor:0, mapsAgainst:0 })),
    rounds: generateRoundRobinRounds(teamNames),
    roundIndex: 0,
  }));
}
function gcKickoffStandingsForGroup(g){
  return [...g.teams].sort((a,b)=> (b.w-a.w) || ((b.mapsFor-b.mapsAgainst)-(a.mapsFor-a.mapsAgainst)) || (b.mapsFor-a.mapsFor));
}
// Le champ (9 à 14 équipes selon la région, voir buildGCKickoffField) donne
// TOUJOURS 3 ou 4 groupes de 4 (Math.ceil(N/4)) — jamais plus. Les Playoffs
// n'ont donc jamais besoin de gérer plus de 4 têtes de série : demi-finales
// (bye pour la meilleure graine s'il n'y a que 3 groupes) puis finale.
function initGCKickoffPlayoffBracket(seededNames){
  const slot = (a,b)=>({ a:a||null, b:b||null, winner:null, loser:null, scoreA:null, scoreB:null, mapsToWin:2 });
  const seeds = [...seededNames].sort((a,b)=> gcTeamStrength(b) - gcTeamStrength(a));
  const [s1,s2,s3,s4] = seeds; // s4 absent (3 groupes) -> bye pour la meilleure graine
  return {
    sf: [ slot(s1, s4), slot(s2, s3) ],
    final: slot(),
    champion:null, runnerUp:null,
  };
}
function getGCKickoffPlayoffMatch(bracket, matchId){
  if(matchId==='sf0') return bracket.sf[0];
  if(matchId==='sf1') return bracket.sf[1];
  return bracket[matchId] || null;
}
function tryScheduleSelfGCKickoffMatch(opponentName, groupIndex){
  const k = state.gcKickoff;
  if(k.pendingMatch) return true;
  const evKey = eventKey('valorant_gc', state.date.year, state.date.month, state.date.day);
  const existingMatch = (state.calendarEvents[evKey]||[]).find(e=>e.type==='match');
  if(existingMatch) return false;
  k.pendingMatch = { kind:'group', opponentName, groupIndex };
  state.calendarEvents[evKey] = state.calendarEvents[evKey] || [];
  state.calendarEvents[evKey].push({ type:'match', label:`vs ${opponentName}`, opponent:opponentName, played:false, gcKickoffRef:true });
  pushNotification(`🏆 Votre match Kickoff VST Game Changers ${gcRegionLabel()} contre ${opponentName} est prêt, cliquez sur "Jouer le match" !`);
  return true;
}
function tryScheduleSelfGCKickoffPlayoffMatch(opponentName, matchId){
  const k = state.gcKickoff;
  if(k.pendingMatch) return true;
  const evKey = eventKey('valorant_gc', state.date.year, state.date.month, state.date.day);
  const existingMatch = (state.calendarEvents[evKey]||[]).find(e=>e.type==='match');
  if(existingMatch) return false;
  k.pendingMatch = { kind:'playoff', opponentName, matchId };
  state.calendarEvents[evKey] = state.calendarEvents[evKey] || [];
  state.calendarEvents[evKey].push({ type:'match', label:`vs ${opponentName}`, opponent:opponentName, played:false, gcKickoffRef:true });
  pushNotification(`🏆 Playoffs du Kickoff VST Game Changers ${gcRegionLabel()} : votre match contre ${opponentName} est prêt, cliquez sur "Jouer le match" !`);
  return true;
}
// Bascule Groupes -> Playoffs : c'est ICI que la qualification pour le
// Stage 1 est réellement tranchée (jamais à la fin des Playoffs, qui ne
// servent qu'à départager les vainqueurs de groupe entre eux). Chaque
// vainqueur de groupe est qualifié d'office (le nombre de groupes ne
// dépasse jamais qualifiersNeeded, voir le commentaire au-dessus du
// bracket) ; les places restantes reviennent aux meilleurs 2e de groupe,
// classés tous groupes confondus par bilan.
function finalizeGCKickoffGroupsPhase(k){
  const groupWinners = k.groups.map(g=> gcKickoffStandingsForGroup(g)[0].name);
  const runnersUp = k.groups.flatMap(g=> gcKickoffStandingsForGroup(g).slice(1));
  runnersUp.sort((a,b)=> (b.w-a.w) || ((b.mapsFor-b.mapsAgainst)-(a.mapsFor-a.mapsAgainst)) || (b.mapsFor-a.mapsFor));
  const extraNeeded = Math.max(0, k.qualifiersNeeded - groupWinners.length);
  const extraQualifiers = runnersUp.slice(0, extraNeeded).map(t=>t.name);

  k.groupWinners = groupWinners;
  k.qualified = [...groupWinners, ...extraQualifiers];
  k.phase = 'playoffs';
  k.playoffBracket = initGCKickoffPlayoffBracket(groupWinners);

  if(k.qualified.includes(state.org.name)){
    pushNotification(`🎟️ ${state.org.name} se qualifie pour le Stage 1 VST Game Changers via le Kickoff !`);
    pushNews(`${state.org.name} valide son ticket pour le Stage 1 en se qualifiant via le Kickoff.`);
  } else if(state.sections.includes('valorant_gc') && myValorantGCRegion()===k.region){
    pushNotification(`${state.org.name} ne se qualifie pas pour le Stage 1 cette année, élimination au Kickoff.`);
  }
}
function resolveGCKickoffGroupsRound(k){
  k.groups.forEach((g, groupIndex)=>{
    if(g.roundIndex >= g.rounds.length) return; // ce groupe a déjà fini son round-robin
    const pairs = g.rounds[g.roundIndex];
    const myPair = pairs.find(p=>p.includes(state.org.name));
    if(myPair){
      if(!k.pendingMatch) tryScheduleSelfGCKickoffMatch(myPair[0]===state.org.name?myPair[1]:myPair[0], groupIndex);
      return;
    }
    pairs.forEach(([a,b])=>{
      const r = resolveGCCashCupMatch(a, b, 'bo3');
      applyGCCashCupGroupResult(g, a, b, r);
    });
    g.roundIndex++;
  });
  if(k.groups.every(g=>g.roundIndex >= g.rounds.length)) finalizeGCKickoffGroupsPhase(k);
}
function finalizeGCKickoffPlayoffsIfDone(k){
  const b = k.playoffBracket;
  if(!b.final.winner) return;
  b.champion = b.final.winner;
  b.runnerUp = b.final.loser;
  k.phase = 'done';
  k.done = true;
  pushNotification(`🏆 ${b.champion} remporte les Playoffs du Kickoff VST Game Changers ${gcRegionLabel()} !`);
}
function resolveGCKickoffPlayoffRound(k, roundKey){
  const b = k.playoffBracket;
  const play = (m, matchId)=>{
    if(!m || !m.a || m.winner) return; // case pas encore ouverte, ou déjà jouée
    if(!m.b){ m.winner = m.a; m.loser = null; m.scoreA = 2; m.scoreB = 0; return; } // bye (3 groupes seulement)
    if(m.a===state.org.name || m.b===state.org.name){
      if(!k.pendingMatch) tryScheduleSelfGCKickoffPlayoffMatch(m.a===state.org.name?m.b:m.a, matchId);
      return;
    }
    const r = resolveGCCashCupMatch(m.a, m.b, 'bo3');
    m.winner = r.winner; m.loser = r.loser; m.scoreA = r.scoreA; m.scoreB = r.scoreB;
  };
  if(roundKey==='sf'){
    play(b.sf[0], 'sf0'); play(b.sf[1], 'sf1');
  } else if(roundKey==='final'){
    if(b.sf[0].winner && b.sf[1].winner && !b.final.a){
      b.final.a = b.sf[0].winner; b.final.b = b.sf[1].winner;
    }
    play(b.final, 'final');
  }
  finalizeGCKickoffPlayoffsIfDone(k);
}
function catchUpGCKickoffPlayoffsOneStep(k){
  const b = k.playoffBracket;
  if(!b.sf[0].winner || !b.sf[1].winner) resolveGCKickoffPlayoffRound(k, 'sf');
  else resolveGCKickoffPlayoffRound(k, 'final');
}
function completePendingGCKickoffMatch(matchResult){
  const k = state.gcKickoff;
  const pending = k && k.pendingMatch;
  if(!pending) return;
  const selfWon = !!matchResult.won;
  const winner = selfWon ? state.org.name : pending.opponentName;
  let selfWins = matchResult.dayMatch ? matchResult.dayMatch.sh : (selfWon?2:0);
  let oppWins = matchResult.dayMatch ? matchResult.dayMatch.sa : (selfWon?0:2);
  if(selfWon && selfWins<2) selfWins = 2;
  if(!selfWon && oppWins<2) oppWins = 2;

  if(pending.kind==='playoff'){
    const m = getGCKickoffPlayoffMatch(k.playoffBracket, pending.matchId);
    if(m){
      m.winner = winner; m.loser = selfWon ? pending.opponentName : state.org.name;
      m.scoreA = m.a===state.org.name ? selfWins : oppWins;
      m.scoreB = m.a===state.org.name ? oppWins : selfWins;
    }
    k.pendingMatch = null;
    finalizeGCKickoffPlayoffsIfDone(k);
    return;
  }

  const g = k.groups[pending.groupIndex];
  applyGCCashCupGroupResult(g, state.org.name, pending.opponentName, { winner, scoreA:selfWins, scoreB:oppWins });
  const pairs = g.rounds[g.roundIndex] || [];
  pairs.forEach(([a,b])=>{
    if(a===state.org.name || b===state.org.name) return;
    const r = resolveGCCashCupMatch(a, b, 'bo3');
    applyGCCashCupGroupResult(g, a, b, r);
  });
  g.roundIndex++;
  k.pendingMatch = null;
  if(k.groups.every(gr=>gr.roundIndex >= gr.rounds.length)) finalizeGCKickoffGroupsPhase(k);
}
function initGCKickoffEvent(region){
  const field = buildGCKickoffField(region, true);
  return {
    region, year: state.date.year,
    qualifiersNeeded: gcKickoffQualifiersNeeded(region),
    phase: 'groups',
    groups: splitIntoGCKickoffGroups(field),
    groupWinners: [], playoffBracket: null,
    qualified: [], done:false, pendingMatch:null,
  };
}
// Filet de sécurité quotidien (même principe que catchUpGCCashCupEmea) :
// rattrape tout round dont le jour prévu est déjà passé mais qui n'a pas
// encore été résolu — un round par jour dans la fenêtre (5-18 janvier),
// jusqu'à ce que Groupes puis Playoffs soient intégralement joués ou que la
// fenêtre se referme (dans ce cas, plusieurs rounds d'un coup pour ne
// jamais laisser le Kickoff inachevé).
function catchUpGCKickoff(){
  if(!state.sections.includes('valorant_gc')) return;
  if(!isGCKickoffWindow(state.date)) return;
  const region = myValorantGCRegion();
  const d = state.date;
  let k = state.gcKickoff;
  if(!k || k.year!==d.year || k.region!==region){
    k = state.gcKickoff = initGCKickoffEvent(region);
  }
  if(k.done) return;
  const step = ()=>{ if(k.phase==='groups') resolveGCKickoffGroupsRound(k); else if(k.phase==='playoffs') catchUpGCKickoffPlayoffsOneStep(k); };
  step();
  const overdue = d.day >= GC_KICKOFF_WINDOW_END.day;
  if(overdue){
    let guard = 0;
    while(!k.done && !k.pendingMatch && guard<20){ step(); guard++; }
  }
}
function gcKickoffBracketColumns(bracket){
  const cols = [
    { label:'Demi-finales', matches: bracket.sf },
    { label:'Finale', matches: [bracket.final] },
  ];
  if(bracket.champion) cols.push({ label:'Champion des Playoffs', matches:[{ qualifiedOnly:true, name:bracket.champion }] });
  return cols;
}
function renderGCKickoffPanel(){
  const k = state.gcKickoff;
  if(!k){
    return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-flag-checkered"></i><div>Le Kickoff n'a pas encore commencé.</div></div>`;
  }
  const groupLetters = 'ABCDEFGH';
  const groupsHtml = `
    <div class="card-grid two">
      ${k.groups.map((g,i)=>`
        <div class="card info-card">
          <div style="font-weight:700;margin-bottom:8px;">Groupe ${groupLetters[i]||i+1}</div>
          ${gcKickoffStandingsForGroup(g).map((t,r)=>`<div class="info-row"><span>${r+1}. ${kickoffTeamCell(t.name)}${(r===0 && k.phase!=='groups')?' <span style="color:var(--accent);font-size:11px;">· 1er, qualifié</span>':''}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
        </div>
      `).join('')}
    </div>
  `;
  if(k.phase==='groups') return groupsHtml;

  const playoffsHtml = `
    <div class="section-title">Playoffs — têtes de série : vainqueurs de groupe</div>
    ${renderKickoffBracketColumns(gcKickoffBracketColumns(k.playoffBracket))}
  `;
  const qualifiedHtml = `
    <div class="card info-card" style="margin-top:14px;">
      <div style="font-weight:700;margin-bottom:8px;">Qualifiés pour le Stage 1 (${k.qualified.length}/${k.qualifiersNeeded})</div>
      ${k.qualified.map(n=>`<div class="info-row"><span>${kickoffTeamCell(n)}</span>${n===state.org.name?'<span><b style="color:var(--accent);">Toi !</b></span>':'<span></span>'}</div>`).join('')}
    </div>
  `;
  return `${groupsHtml}${playoffsHtml}${qualifiedHtml}`;
}

/* ============================================================
   VST GAME CHANGERS EMEA — STAGE 1
   Premier étage du vrai circuit VST GC (voir prompt du chantier) —
   distinct du Cash Cup EMEA, qui reste un tournoi de comblement joué
   uniquement HORS des fenêtres de stage (voir isGCStage1Window, appelé
   depuis catchUpGCCashCupEmea pour se mettre en pause pendant Stage 1).
   Champ scope : les 4 régions (Stage 1/2/3, Promotion/Relegation et
   points de Championship câblés partout, voir myValorantGCRegion).
   Réutilise au maximum le moteur déjà construit pour le Cash Cup :
   resolveGCCashCupMatch (probabiliste pour votre match, simulateSeries
   réel pour les IA), generateRoundRobinRounds, renderKickoffBracketColumns,
   kickoffTeamCell, le pattern pendingMatch/tryScheduleSelf.
   ============================================================ */
// Fenêtre réelle Liquipedia (26 janvier → 22 février), reconduite chaque
// année plutôt que verrouillée sur 2026 — même principe que les gabarits
// de saison VST classique (script.js), qui se répètent d'année en année.
const GC_STAGE1_WINDOW_START = { month:0, day:26 };
const GC_STAGE1_WINDOW_END   = { month:1, day:22 };
const GC_STAGE1_PRIZE_POOL = 33000;
// Répartition simplifiée (Riot ne publie pas de barème détaillé par
// palier pour ce stage) : champion/finaliste/demi-finalistes seulement,
// cohérent avec la plupart des circuits Contenders/Game Changers réels.
const GC_STAGE1_PRIZE_SHARES = { champion:0.5, runnerUp:0.25, semis:0.125 };

function isGCStage1Window(d){
  const cur = new Date(d.year, d.month, d.day).getTime();
  const start = new Date(d.year, GC_STAGE1_WINDOW_START.month, GC_STAGE1_WINDOW_START.day).getTime();
  const end = new Date(d.year, GC_STAGE1_WINDOW_END.month, GC_STAGE1_WINDOW_END.day).getTime();
  return cur >= start && cur <= end;
}
// Pause hivernale du Cash Cup EMEA — vrai calendrier VST Game Changers :
// le circuit s'arrête début novembre (fin de la saison régulière), laisse
// la place aux fêtes puis au Stage 1 officiel (26 janvier - 22 février,
// voir isGCStage1Window ci-dessus, entièrement inclus dans cette fenêtre),
// et ne reprend qu'une fois celui-ci terminé (23 février). Comparaison
// mois/jour directe plutôt que des Date à cheval sur deux années civiles
// (novembre-décembre d'une année, janvier-février de la suivante) : plus
// simple et sans piège de bord d'année.
function isGCCashCupOffSeason(d){
  if(d.month===10 || d.month===11 || d.month===0) return true; // nov, déc, janv
  if(d.month===1 && d.day<=22) return true; // février jusqu'à la fin du Stage 1
  return false;
}
function nextGCStage1Target(d){
  let y = d.year;
  const cur = new Date(d.year, d.month, d.day).getTime();
  let start = new Date(y, GC_STAGE1_WINDOW_START.month, GC_STAGE1_WINDOW_START.day).getTime();
  if(cur > start){ y++; start = new Date(y, GC_STAGE1_WINDOW_START.month, GC_STAGE1_WINDOW_START.day).getTime(); }
  return { year:y };
}
function daysUntilGCStage1Start(){
  const d = state.date;
  const cur = new Date(d.year, d.month, d.day).getTime();
  const t = nextGCStage1Target(d);
  const start = new Date(t.year, GC_STAGE1_WINDOW_START.month, GC_STAGE1_WINDOW_START.day).getTime();
  return Math.round((start - cur) / 86400000);
}

// --- Invitation (même mécanique que le Cash Cup, voir plus haut) -------
function sendGCStage1InviteMail(target){
  state.gcStage1Pending = { year:target.year, participating:null };
  const region = gcRegionLabel();
  pushMail('valorant_gc', {
    category:'COMPETITION', priority:'important', sender:`VST Game Changers ${region}`,
    subject:`Invitation, VST Game Changers ${region}, Stage 1`,
    preview:`Votre place pour le Stage 1 ${region} (${MONTH_NAMES[GC_STAGE1_WINDOW_START.month]}-${MONTH_NAMES[GC_STAGE1_WINDOW_END.month]} ${target.year}) vous est proposée.`,
    body:`
      <p>Le circuit officiel VST Game Changers ${region} vous propose une place pour le <b>Stage 1</b>, du 26 ${MONTH_NAMES[GC_STAGE1_WINDOW_START.month]} au 22 ${MONTH_NAMES[GC_STAGE1_WINDOW_END.month]} ${target.year}, tournoi en ligne réunissant les organisations affiliées de la région.</p>
      <p>Format : phase de groupe unique en round-robin (Bo3), les 4 premières équipes disputent les playoffs (demi-finales, finale en Bo5).</p>
      <p>Dotation totale : <b>${formatMoney(GC_STAGE1_PRIZE_POOL)}</b>.</p>
    `,
    actions:[
      { key:'accept-gc-stage1-invite', label:'Accepter', style:'primary', icon:'fa-check' },
      { key:'decline-gc-stage1-invite', label:'Refuser', style:'danger', icon:'fa-xmark' },
    ],
  });
}
function checkGCStage1Invite(){
  if(!state.sections.includes('valorant_gc')) return;
  const days = daysUntilGCStage1Start();
  if(days < 7 || days > 10) return;
  const t = nextGCStage1Target(state.date);
  if(state.gcStage1InviteSentFor === t.year) return;
  state.gcStage1InviteSentFor = t.year;
  sendGCStage1InviteMail(t);
}
function acceptGCStage1Invite(gameId, mail){
  if(state.gcStage1Pending) state.gcStage1Pending.participating = true;
  const region = gcRegionLabel();
  finalizeMailDecision(mail, `Participation confirmée, vous disputerez le Stage 1 ${region}.`);
  toast(`Invitation Stage 1 ${region} acceptée.`, 'success');
}
function declineGCStage1Invite(gameId, mail){
  if(state.gcStage1Pending) state.gcStage1Pending.participating = false;
  const region = gcRegionLabel();
  finalizeMailDecision(mail, `Invitation déclinée, vous ne disputerez pas le Stage 1 ${region}.`);
  toast(`Invitation Stage 1 ${region} refusée.`, 'info');
}

// --- Champ et déroulé -----------------------------------------------
// Le champ du Stage 1 = les organisations RÉELLEMENT affiliées (toujours
// dedans, voir GC_TEAMS_BY_REGION) + les équipes qui ont complété le
// plateau à 10 via le Kickoff (voir catchUpGCKickoff/GC_KICKOFF_WINDOW_*,
// résolu juste avant — 5-18 janvier, Stage 1 à partir du 26) — ton
// organisation n'y figure QUE si elle s'est réellement qualifiée au
// Kickoff (elle n'est jamais dans GC_TEAMS_BY_REGION), ou pas du tout si
// tu as décliné l'invitation Stage 1 malgré une qualification. Filet de
// sécurité si le Kickoff n'a pas eu lieu cette année (section rejointe
// après coup, ou sauvegarde plus ancienne sans Kickoff encore résolu) :
// retombe sur les organisations affiliées + toi, comme avant l'introduction
// du Kickoff (plateau alors incomplet, mais jamais vide).
// Une équipe reléguée via la Promotion/Relégation de mars (voir
// catchUpGCStage1PromoRelegation) reste exclue du champ Stage 1 tant que
// l'année en cours n'a pas dépassé state.gcRelegatedUntil[nom] — jamais les
// organisations réellement affiliées (GC_TEAMS_EMEA), protégées par la
// règle d'exemption VST et donc jamais ajoutées à cette liste.
function isGCTeamRelegatedThisYear(name){
  const until = (state.gcRelegatedUntil||{})[name];
  return until!==undefined && state.date.year <= until;
}
function buildGCStage1Field(includeSelf){
  const region = myValorantGCRegion();
  const k = state.gcKickoff;
  let names;
  if(k && k.done && k.qualified.length && k.year===state.date.year && k.region===region){
    names = [...myGCAffiliatedTeams(), ...k.qualified];
    if(!includeSelf) names = names.filter(n=>n!==state.org.name);
  } else {
    names = [...myGCAffiliatedTeams()];
    if(includeSelf && state.sections.includes('valorant_gc')) names.push(state.org.name);
  }
  names = names.filter(n=> n===state.org.name || !isGCTeamRelegatedThisYear(n));
  return shuffle(names);
}
function gcStage1Standings(stage){
  return [...stage.teams].sort((a,b)=> (b.w-a.w) || ((b.mapsFor-b.mapsAgainst)-(a.mapsFor-a.mapsAgainst)) || (b.mapsFor-a.mapsFor));
}
function tryScheduleSelfGCStage1Match(stage, extra){
  const s1 = state.gcStage1Emea;
  if(s1.pendingMatch) return true;
  const evKey = eventKey('valorant_gc', state.date.year, state.date.month, state.date.day);
  const existingMatch = (state.calendarEvents[evKey]||[]).find(e=>e.type==='match');
  if(existingMatch) return false;
  let opponentName, mapsToWin;
  if(stage==='groups'){
    opponentName = extra;
    mapsToWin = 2;
    s1.pendingMatch = { stage, opponentName, mapsToWin };
  } else {
    const m = extra.m;
    opponentName = m.a===state.org.name ? m.b : m.a;
    mapsToWin = m.mapsToWin || 2;
    s1.pendingMatch = { stage, round:extra.round, idx:extra.idx, opponentName, mapsToWin };
  }
  state.calendarEvents[evKey] = state.calendarEvents[evKey] || [];
  state.calendarEvents[evKey].push({ type:'match', label:`vs ${opponentName}`, opponent:opponentName, played:false, gcStage1Ref:true });
  pushNotification(`🏆 Votre match VST Game Changers ${gcRegionLabel()} (Stage 1) contre ${opponentName} est prêt, cliquez sur "Jouer le match" !`);
  return true;
}
function resolveGCStage1GroupRound(stage){
  if(stage.roundIndex >= stage.rounds.length) return;
  const pairs = stage.rounds[stage.roundIndex];
  const myPair = pairs.find(p=>p.includes(state.org.name));
  if(myPair){
    if(!state.gcStage1Emea.pendingMatch) tryScheduleSelfGCStage1Match('groups', myPair[0]===state.org.name?myPair[1]:myPair[0]);
    return;
  }
  pairs.forEach(([a,b])=>{
    const r = resolveGCCashCupMatch(a, b, 'bo3');
    applyGCCashCupGroupResult(stage, a, b, r);
  });
  stage.roundIndex++;
}
// Playoffs — top 4 uniquement (demi-finales puis finale), plus léger que
// le bracket 16 équipes du Cash Cup (voir cashCupBracketColumns/
// resolveGCCashCupRound16) car le champ Stage 1 est volontairement réduit
// à un seul groupe de ~10-11 équipes plutôt que 8 groupes séparés.
function buildGCStage1Bracket(stage){
  const top4 = gcStage1Standings(stage).slice(0,4).map(t=>t.name);
  const mk = (mapsToWin=2)=>({ a:null, b:null, scoreA:null, scoreB:null, winner:null, loser:null, mapsToWin });
  const semis = [mk(), mk()];
  semis[0].a = top4[0]; semis[0].b = top4[3];
  semis[1].a = top4[1]; semis[1].b = top4[2];
  return { seeds:top4, semis, final:mk(3), champion:null, viceChampion:null };
}
function resolveGCStage1Semis(bracket){
  bracket.semis.forEach((m,idx)=>{
    if(!m.a || !m.b || m.winner) return;
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCStage1Match('playoffs', {round:'semis', idx, m}); return; }
    Object.assign(m, resolveGCCashCupMatch(m.a, m.b, 'bo3'));
  });
  if(bracket.semis.some(m=>!m.winner)) return;
  bracket.final.a = bracket.semis[0].winner; bracket.final.b = bracket.semis[1].winner;
}
function resolveGCStage1Final(bracket){
  const m = bracket.final;
  if(!m.a || !m.b) return;
  if(!m.winner){
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCStage1Match('playoffs', {round:'final', idx:0, m}); return; }
    Object.assign(m, resolveGCCashCupMatch(m.a, m.b, 'bo5'));
  }
  if(bracket.champion) return;
  bracket.champion = m.winner;
  bracket.viceChampion = m.winner===m.a ? m.b : m.a;
}
function resolveGCStage1PlayoffRound(s1){
  resolveGCStage1Semis(s1.bracket);
  resolveGCStage1Final(s1.bracket);
}
function completePendingGCStage1Match(matchResult){
  const s1 = state.gcStage1Emea;
  const pending = s1 && s1.pendingMatch;
  if(!pending) return;
  const selfWon = !!matchResult.won;
  const winner = selfWon ? state.org.name : pending.opponentName;
  const loser = selfWon ? pending.opponentName : state.org.name;
  let selfWins = matchResult.dayMatch ? matchResult.dayMatch.sh : (selfWon?pending.mapsToWin:0);
  let oppWins = matchResult.dayMatch ? matchResult.dayMatch.sa : (selfWon?0:pending.mapsToWin);
  const need = pending.mapsToWin||2;
  if(selfWon && selfWins<need) selfWins = need;
  if(!selfWon && oppWins<need) oppWins = need;

  if(pending.stage==='groups'){
    applyGCCashCupGroupResult(s1.stage, state.org.name, pending.opponentName, { winner, scoreA:selfWins, scoreB:oppWins });
    const pairs = s1.stage.rounds[s1.stage.roundIndex] || [];
    pairs.forEach(([a,b])=>{
      if(a===state.org.name || b===state.org.name) return;
      const r = resolveGCCashCupMatch(a, b, 'bo3');
      applyGCCashCupGroupResult(s1.stage, a, b, r);
    });
    s1.stage.roundIndex++;
  } else {
    const m = pending.round==='final' ? s1.bracket.final : s1.bracket[pending.round][pending.idx];
    if(m){
      if(m.a===state.org.name){ m.scoreA=selfWins; m.scoreB=oppWins; } else { m.scoreA=oppWins; m.scoreB=selfWins; }
      m.winner = winner;
      if('loser' in m) m.loser = loser;
    }
  }
  s1.pendingMatch = null;
  if(pending.stage==='playoffs'){
    resolveGCStage1PlayoffRound(s1);
    if(s1.bracket.champion) awardGCStage1Prizes(s1);
  }
}
// --- Points de circuit EMEA (Stage 1/2/3, classement cumulé menant à
// Championship) — DISTINCT du système de points Cash Cup
// (GC_CASHCUP_POINTS_BY_TIER) : celui-ci récompense le classement FINAL de
// chaque Stage, sur le barème fourni. Stage 3 n'a pas de valeur "1re
// place" (qualification directe à Championship plutôt que des points
// supplémentaires, voir awardGCStage3Prizes) — barème volontairement plus
// généreux que Stage 1/2 puisque Stage 3 est la dernière ligne droite avant
// Championship.
const GC_STAGE_POINTS_TABLE = {
  stage1: { 1:60, 2:45, 3:30, 4:20, '5-6':10 },
  stage2: { 1:90, 2:65, 3:45, 4:30, '5-6':20 },
  stage3: { 2:85, 3:60, 4:40, '5-6':30 },
};
function ensureGCEmeaPointsYear(year){
  state.gcEmeaSeasonPoints = state.gcEmeaSeasonPoints || {};
  if(!state.gcEmeaSeasonPoints[year]) state.gcEmeaSeasonPoints[year] = { totals:{}, byStage:{ stage1:{}, stage2:{}, stage3:{} } };
  return state.gcEmeaSeasonPoints[year];
}
// `placements` : noms dans l'ordre 1er→6e (les 2 dernières entrées, 5e et
// 6e, partagent le même palier "5-6" du barème) — une place non atteinte
// (ex. équipe non qualifiée) doit simplement être omise, pas remplie de null.
function awardGCStagePoints(stageKey, year, placements){
  const bucket = ensureGCEmeaPointsYear(year);
  const table = GC_STAGE_POINTS_TABLE[stageKey];
  (placements||[]).slice(0,6).forEach((name, idx)=>{
    if(!name) return;
    const rank = idx+1;
    // Le repli sur le palier "5-6" ne doit jouer QUE pour les rangs 5 et 6 —
    // sinon la 1re place de Stage 3 (absente de la table, qualification
    // directe au Championship plutôt que des points) hériterait à tort des
    // points du palier 5-6 au lieu d'être ignorée (voir table.stage3 ci-dessus).
    const pts = table[rank]!==undefined ? table[rank] : (rank>=5 ? table['5-6'] : undefined);
    if(pts===undefined) return; // 1re place Stage 3 : qualification directe, pas de points ici
    bucket.totals[name] = (bucket.totals[name]||0) + pts;
    bucket.byStage[stageKey][name] = pts;
  });
}
// Reconstruit l'ordre 1er→6e de Stage 1 à partir du bracket (voir
// buildGCStage1Bracket) — les deux perdants de demi-finale (pas de match de
// 3e place dans ce format) sont départagés par leur classement de la phase
// de groupe, seule donnée qui les distingue.
function gcStage1Placements(s1){
  const b = s1.bracket;
  const champion = b.champion, runnerUp = b.viceChampion;
  const semiLosers = b.semis.map(m=> m.winner===m.a?m.b:m.a).filter(Boolean);
  const standingsOrder = gcStage1Standings(s1.stage).map(t=>t.name);
  const orderedSemiLosers = semiLosers.slice().sort((a,b2)=> standingsOrder.indexOf(a)-standingsOrder.indexOf(b2));
  const rest = standingsOrder.filter(n=> n!==champion && n!==runnerUp && !semiLosers.includes(n));
  return [champion, runnerUp, ...orderedSemiLosers, ...rest.slice(0,2)];
}
function awardGCStage1Prizes(s1){
  if(s1.prizeAwarded) return;
  s1.prizeAwarded = true;
  const b = s1.bracket;
  const champion = b.champion, runnerUp = b.viceChampion;
  const region = gcRegionLabel();
  pushGCCompetitionHistory({ year:s1.year, month:GC_STAGE1_WINDOW_END.month, competition:`Stage 1 ${region}`, label:`Stage 1 ${region}, ${s1.year}`, champion, isSelf: champion===state.org.name });
  awardGCStagePoints('stage1', s1.year, gcStage1Placements(s1));
  const semiLosers = b.semis.map(m=> m.winner===m.a ? m.b : m.a).filter(Boolean);
  const shareOf = (pct)=> Math.round(GC_STAGE1_PRIZE_POOL * pct);
  if(champion===state.org.name){
    const amount = shareOf(GC_STAGE1_PRIZE_SHARES.champion);
    state.budget += amount;
    recordTransaction('valorant_gc', 'tournament_prize', `Stage 1 ${region}, champion`, amount);
    state.reputation = Math.min(100, (state.reputation||0) + 6);
    pushNotification(`🏆 ${state.org.name} remporte le Stage 1 VST Game Changers ${region} ! Prime : ${formatMoney(amount)}.`);
    pushNews(`${state.org.name} sacré champion du Stage 1 VST Game Changers ${region}.`, 'result', 'valorant_gc');
  } else if(runnerUp===state.org.name){
    const amount = shareOf(GC_STAGE1_PRIZE_SHARES.runnerUp);
    state.budget += amount;
    recordTransaction('valorant_gc', 'tournament_prize', `Stage 1 ${region}, finaliste`, amount);
    state.reputation = Math.min(100, (state.reputation||0) + 3);
    pushNotification(`🥈 ${state.org.name} finit finaliste du Stage 1 VST Game Changers ${region}. Prime : ${formatMoney(amount)}.`);
  } else if(semiLosers.includes(state.org.name)){
    const amount = shareOf(GC_STAGE1_PRIZE_SHARES.semis);
    state.budget += amount;
    recordTransaction('valorant_gc', 'tournament_prize', `Stage 1 ${region}, demi-finale`, amount);
    state.reputation = Math.min(100, (state.reputation||0) + 1);
    pushNotification(`${state.org.name} s'arrête en demi-finale du Stage 1 VST Game Changers ${region}. Prime : ${formatMoney(amount)}.`);
  }
  if(champion!==state.org.name) pushNews(`${champion} remporte le Stage 1 VST Game Changers ${region}.`);
}
// Calendrier : gardé par la fenêtre réelle (isGCStage1Window) — appelée
// depuis advanceDay (script.js) UNIQUEMENT quand la fenêtre est ouverte ;
// catchUpGCCashCupEmea se met lui-même en pause pendant ce temps (voir
// plus haut, checkGCCashCupInvite/catchUpGCCashCupEmea).
function catchUpGCStage1Emea(){
  checkGCStage1Invite();
  const d = state.date;
  if(!isGCStage1Window(d)) return;
  let s1 = state.gcStage1Emea;
  if(!s1 || s1.year!==d.year){
    const pending = state.gcStage1Pending;
    const usesPending = pending && pending.year===d.year;
    const participating = !(usesPending && pending.participating===false);
    const field = buildGCStage1Field(participating);
    s1 = state.gcStage1Emea = {
      year:d.year, phase:'groups', participating,
      stage: { teams: field.map(name=>({name,w:0,l:0,mapsFor:0,mapsAgainst:0})), rounds: generateRoundRobinRounds(field), roundIndex:0 },
      bracket:null, prizeAwarded:false, pendingMatch:null,
    };
    if(usesPending) state.gcStage1Pending = null;
  }
  if(s1.phase==='groups'){
    resolveGCStage1GroupRound(s1.stage);
    if(s1.stage.roundIndex >= s1.stage.rounds.length){
      s1.bracket = buildGCStage1Bracket(s1.stage);
      s1.phase = 'playoffs';
    }
    return;
  }
  if(s1.phase==='playoffs'){
    resolveGCStage1PlayoffRound(s1);
    if(s1.bracket.champion) awardGCStage1Prizes(s1);
    if(s1.bracket.champion && s1.prizeAwarded) s1.phase = 'done';
  }
}
function renderGCStage1Panel(){
  const s1 = state.gcStage1Emea;
  if(!s1) return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-trophy"></i><div>Le Stage 1 n'a pas encore commencé.</div></div>`;
  if(s1.participating===false){
    return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-calendar-xmark"></i><div>Vous avez décliné l'invitation, le Stage 1 ${gcRegionLabel()} se joue sans votre organisation.</div></div>`;
  }
  if(s1.phase==='groups'){
    return `
      <div class="card info-card">
        <div style="font-weight:700;margin-bottom:8px;">Classement, phase de groupe</div>
        ${gcStage1Standings(s1.stage).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
      </div>
    `;
  }
  if(s1.phase==='playoffs'){
    return renderKickoffBracketColumns([
      { label:'Demi-finales', matches: s1.bracket.semis },
      { label:'Finale', matches:[s1.bracket.final] },
    ]);
  }
  return `
    <div class="card info-card" style="text-align:center;padding:24px;">
      <i class="fa-solid fa-trophy" style="font-size:28px;color:var(--info);margin-bottom:10px;"></i>
      <div style="font-weight:700;font-size:16px;">${kickoffTeamCell(s1.bracket ? s1.bracket.champion : '—')}, Champion du Stage 1</div>
    </div>
  `;
}
function renderGCStage2Panel(){
  const s2 = state.gcStage2Emea;
  if(!s2) return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-trophy"></i><div>Le Stage 2 se joue chaque année d'avril à mai, une fois la Promotion/Relegation Stage 1 terminée.</div></div>`;
  if(s2.phase==='groups'){
    return `
      <div class="card info-card">
        <div style="font-weight:700;margin-bottom:8px;">Classement, groupe unique</div>
        ${gcStage2Standings(s2.stage).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)}</span><span>${t.w}V-${t.l}D</span></div>`).join('')}
      </div>
    `;
  }
  const b = s2.bracket;
  if(s2.phase==='playoffs'){
    return `
      ${renderKickoffBracketColumns([{ label:'Knockout Round', matches:b.knockout }])}
      ${renderKickoffBracketColumns([
        { label:'Upper Bracket Semifinals', matches:b.ubsf },
        { label:'Upper Bracket Final', matches:[b.ubfinal] },
      ])}
      ${renderKickoffBracketColumns([
        { label:'Lower Bracket Semifinals', matches:[b.lbsf] },
        { label:'Lower Bracket Final', matches:[b.lbfinal] },
      ])}
      ${renderKickoffBracketColumns([{ label:'Grande Finale', matches:[b.grandfinal] }])}
    `;
  }
  return `
    <div class="card info-card" style="text-align:center;padding:24px;">
      <i class="fa-solid fa-trophy" style="font-size:28px;color:var(--info);margin-bottom:10px;"></i>
      <div style="font-weight:700;font-size:16px;">${kickoffTeamCell(b ? b.champion : '—')}, Champion du Stage 2</div>
    </div>
  `;
}

/* ============================================================
   STAGE 3 (juillet-août) — champ Stage 2 mis à jour par la
   Promotion/Relegation de juin (voir buildGCStage3Field) : un groupe de 10
   en round-robin, TOP 6 direct en Playoffs, les 4 derniers tombent en
   Play-Ins où ils affrontent 4 équipes qualifiées par leurs points Cash Cup
   de MAI À JUILLET (voir gcCashCupPointsInRange) — c'est très exactement le
   canal "les Cash Cup de mai à juillet qualifient aux Play-Ins" demandé :
   toutes les Cash Cup jouées après juillet (jusqu'à la pause de novembre,
   voir isGCCashCupOffSeason) continuent de tourner normalement mais
   n'alimentent plus aucune fenêtre de qualification, purement pour le
   plaisir de jeu/exposition des joueuses une fois la course aux Stages
   terminée pour l'année — aucun code dédié requis pour ce cas, il suffit
   qu'aucune fenêtre ne les lise (déjà le cas, aucune autre fenêtre
   n'existe après celle-ci).
   Play-Ins : 8 équipes scindées en DEUX mini-brackets à élimination simple
   de 4 (Round 1 puis Final chacun), le champion de chaque mini-bracket
   qualifié pour les Playoffs — format confirmé par capture d'écran (Round
   1 à 4 matches, Round 2 à 2 matches produisant directement les 2
   qualifiées, pas de vraie "finale" unique des Play-Ins).
   Playoffs : double-élimination classique à 8 équipes (Upper Bracket
   Quarterfinals/Semifinals/Final, Lower Bracket Round 1/Round 2/Semifinale/
   Final, Grande Finale Bo5) — topologie standard, la perdante de l'Upper
   Bracket Final rejoint la Lower Bracket Final (seul point d'entrée déjà
   réduit à 1 adversaire à ce stade). Le vrai format laisse la seed #1 du
   groupe choisir son adversaire parmi les 2 qualifiées Play-Ins ; simplifié
   ici en un appariement de seeding standard (1v8/4v5/2v7/3v6) plutôt qu'un
   choix interactif, à réévaluer si demandé explicitement.
   ============================================================ */
const GC_STAGE3_GROUPS_START   = { month:6, day:20 }; // 20 juillet
const GC_STAGE3_GROUPS_END     = { month:7, day:6 };  // 6 août
const GC_STAGE3_PLAYINS_START  = { month:7, day:8 };
const GC_STAGE3_PLAYINS_END    = { month:7, day:10 };
const GC_STAGE3_PLAYOFFS_START = { month:7, day:13 };
const GC_STAGE3_PLAYOFFS_END   = { month:7, day:30 };
const GC_STAGE3_PRIZE_POOL = 33000; // même ordre de grandeur que Stage 1/2, Riot ne publie pas de barème détaillé

// Champ Stage 3 : le champ Stage 2 de l'année (déjà à jour de la
// Promotion/Relegation de mars) UNIONNÉ aux équipes promues cette année par
// la Promotion/Relegation de JUIN (state.gcPromotedThisYear2, alimenté dans
// catchUpGCStage2PromoRelegation) — même principe que buildGCStage2Field,
// bucket "promues" séparé puisqu'il s'agit d'un cycle Promo/Rel différent.
function buildGCStage3Field(includeSelf){
  const base = buildGCStage2Field(includeSelf);
  const promoted = (state.gcPromotedThisYear2||[]).filter(n=> includeSelf || n!==state.org.name);
  const names = [...new Set([...base, ...promoted])].slice(0,10);
  return shuffle(names);
}
function resolveGCStage3GroupRound(stage){
  if(stage.roundIndex >= stage.rounds.length) return;
  const pairs = stage.rounds[stage.roundIndex];
  const myPair = pairs.find(p=>p.includes(state.org.name));
  if(myPair){
    if(!state.gcStage3Emea.pendingMatch) tryScheduleSelfGCStage3Match('groups', myPair[0]===state.org.name?myPair[1]:myPair[0]);
    return;
  }
  pairs.forEach(([a,b])=>{
    const r = resolveGCCashCupMatch(a, b, 'bo3');
    applyGCCashCupGroupResult(stage, a, b, r);
  });
  stage.roundIndex++;
}
function tryScheduleSelfGCStage3Match(stage, extra){
  const s3 = state.gcStage3Emea;
  if(s3.pendingMatch) return true;
  const evKey = eventKey('valorant_gc', state.date.year, state.date.month, state.date.day);
  const existingMatch = (state.calendarEvents[evKey]||[]).find(e=>e.type==='match');
  if(existingMatch) return false;
  let opponentName, mapsToWin;
  if(stage==='groups'){
    opponentName = extra; mapsToWin = 2;
    s3.pendingMatch = { stage, opponentName, mapsToWin };
  } else if(stage==='playins'){
    const m = extra.m;
    opponentName = m.a===state.org.name ? m.b : m.a;
    mapsToWin = m.mapsToWin || 2;
    s3.pendingMatch = { stage, bracketKey:extra.bracketKey, matchId:extra.matchId, opponentName, mapsToWin };
  } else {
    const m = extra.m;
    opponentName = m.a===state.org.name ? m.b : m.a;
    mapsToWin = m.mapsToWin || 2;
    s3.pendingMatch = { stage, matchId:extra.matchId, opponentName, mapsToWin };
  }
  state.calendarEvents[evKey] = state.calendarEvents[evKey] || [];
  state.calendarEvents[evKey].push({ type:'match', label:`vs ${opponentName}`, opponent:opponentName, played:false, gcStage3Ref:true });
  pushNotification(`🏆 Votre match VST Game Changers ${gcRegionLabel()} (Stage 3) contre ${opponentName} est prêt, cliquez sur "Jouer le match" !`);
  return true;
}
// Mini-bracket à élimination simple de 4 équipes, réutilisé DEUX fois côté
// Play-Ins (bracketA/bracketB, voir catchUpGCStage3) — même forme que
// buildGCStage1Bracket (semis + finale), juste sans classement de groupe en
// amont puisque les seeds sont déjà connues (voir catchUpGCStage3).
function buildGCStage3PlayInsMiniBracket(seeds){
  const mk = (mapsToWin=2)=>({ a:null, b:null, winner:null, loser:null, scoreA:null, scoreB:null, mapsToWin });
  const semis = [mk(), mk()];
  semis[0].a = seeds[0]; semis[0].b = seeds[3];
  semis[1].a = seeds[1]; semis[1].b = seeds[2];
  return { seeds, semis, final: mk(), champion:null };
}
function resolveGCStage3PlayInsBracket(s3, key){
  const bracket = s3.playIns[key];
  const play = (m, matchId)=>{
    if(!m || !m.a || !m.b || m.winner) return;
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCStage3Match('playins', { bracketKey:key, matchId, m }); return; }
    const r = resolveGCCashCupMatch(m.a, m.b, 'bo3');
    m.winner = r.winner; m.loser = r.loser; m.scoreA = r.scoreA; m.scoreB = r.scoreB;
  };
  play(bracket.semis[0], 'semis0'); play(bracket.semis[1], 'semis1');
  if(bracket.semis[0].winner && bracket.semis[1].winner){ bracket.final.a = bracket.semis[0].winner; bracket.final.b = bracket.semis[1].winner; }
  play(bracket.final, 'final');
  if(bracket.final.winner) bracket.champion = bracket.final.winner;
}
// Playoffs — double-élimination classique à 8 équipes (voir commentaire
// d'en-tête pour la topologie complète). Seeding standard 1v8/4v5/2v7/3v6
// sur les 8 qualifiées (top 6 groupe + 2 championnes Play-Ins), triées par
// force avant appariement (même principe que le reste du fichier, ex.
// GC_STAGE1_PROMOREL upperSeeds).
function buildGCStage3PlayoffBracket(seeds){
  const slot = (a,b,mapsToWin=2)=>({ a:a||null, b:b||null, winner:null, loser:null, scoreA:null, scoreB:null, mapsToWin });
  return {
    seeds,
    ubqf: [ slot(seeds[0],seeds[7]), slot(seeds[3],seeds[4]), slot(seeds[1],seeds[6]), slot(seeds[2],seeds[5]) ],
    ubsf: [ slot(), slot() ],
    ubfinal: slot(),
    lbr1: [ slot(), slot() ],
    lbr2: [ slot(), slot() ],
    lbsemis: slot(),
    lbfinal: slot(null,null,3),
    grandfinal: slot(null,null,3),
    champion:null, viceChampion:null,
  };
}
function getGCStage3Match(bracket, matchId){
  if(matchId.startsWith('ubqf')) return bracket.ubqf[+matchId.slice(4)];
  if(matchId.startsWith('ubsf')) return bracket.ubsf[+matchId.slice(4)];
  if(matchId.startsWith('lbr1')) return bracket.lbr1[+matchId.slice(4)];
  if(matchId.startsWith('lbr2')) return bracket.lbr2[+matchId.slice(4)];
  return bracket[matchId] || null; // lbsemis, lbfinal, ubfinal, grandfinal
}
function resolveGCStage3PlayoffRound(s3){
  const b = s3.bracket;
  const play = (m, matchId)=>{
    if(!m || !m.a || !m.b || m.winner) return;
    if(m.a===state.org.name || m.b===state.org.name){ tryScheduleSelfGCStage3Match('playoffs', { matchId, m }); return; }
    const r = resolveGCCashCupMatch(m.a, m.b, m.mapsToWin>=3?'bo5':'bo3');
    m.winner = r.winner; m.loser = r.loser; m.scoreA = r.scoreA; m.scoreB = r.scoreB;
  };
  b.ubqf.forEach((m,i)=>play(m,`ubqf${i}`));
  if(b.ubqf[0].winner && b.ubqf[1].winner){
    b.ubsf[0].a = b.ubqf[0].winner; b.ubsf[0].b = b.ubqf[1].winner;
    b.lbr1[0].a = b.ubqf[0].loser; b.lbr1[0].b = b.ubqf[1].loser;
  }
  if(b.ubqf[2].winner && b.ubqf[3].winner){
    b.ubsf[1].a = b.ubqf[2].winner; b.ubsf[1].b = b.ubqf[3].winner;
    b.lbr1[1].a = b.ubqf[2].loser; b.lbr1[1].b = b.ubqf[3].loser;
  }
  play(b.ubsf[0],'ubsf0'); play(b.ubsf[1],'ubsf1');
  play(b.lbr1[0],'lbr10'); play(b.lbr1[1],'lbr11');
  // Croisé pour éviter une revanche immédiate entre équipes déjà opposées :
  // la perdante de l'UBSF d'un côté affronte la gagnante du LBR1 de l'autre côté.
  if(b.lbr1[1].winner && b.ubsf[0].winner){ b.lbr2[0].a = b.lbr1[1].winner; b.lbr2[0].b = b.ubsf[0].loser; }
  if(b.lbr1[0].winner && b.ubsf[1].winner){ b.lbr2[1].a = b.lbr1[0].winner; b.lbr2[1].b = b.ubsf[1].loser; }
  play(b.lbr2[0],'lbr20'); play(b.lbr2[1],'lbr21');
  if(b.ubsf[0].winner && b.ubsf[1].winner){ b.ubfinal.a = b.ubsf[0].winner; b.ubfinal.b = b.ubsf[1].winner; }
  play(b.ubfinal,'ubfinal');
  if(b.lbr2[0].winner && b.lbr2[1].winner){ b.lbsemis.a = b.lbr2[0].winner; b.lbsemis.b = b.lbr2[1].winner; }
  play(b.lbsemis,'lbsemis');
  // La perdante de l'Upper Bracket Final n'a qu'une seule défaite : elle
  // rejoint la Lower Bracket Final directement (dernier point d'entrée côté
  // Lower Bracket), face à la gagnante de la Lower Bracket Semifinale.
  if(b.ubfinal.winner && b.lbsemis.winner){ b.lbfinal.a = b.ubfinal.loser; b.lbfinal.b = b.lbsemis.winner; }
  play(b.lbfinal,'lbfinal');
  if(b.ubfinal.winner && b.lbfinal.winner){ b.grandfinal.a = b.ubfinal.winner; b.grandfinal.b = b.lbfinal.winner; }
  play(b.grandfinal,'grandfinal');
  if(b.grandfinal.winner && !b.champion){ b.champion = b.grandfinal.winner; b.viceChampion = b.grandfinal.loser; }
}
function completePendingGCStage3Match(matchResult){
  const s3 = state.gcStage3Emea;
  const pending = s3 && s3.pendingMatch;
  if(!pending) return;
  const selfWon = !!matchResult.won;
  const winner = selfWon ? state.org.name : pending.opponentName;
  const need = pending.mapsToWin || 2;
  let selfWins = matchResult.dayMatch ? matchResult.dayMatch.sh : (selfWon?need:0);
  let oppWins = matchResult.dayMatch ? matchResult.dayMatch.sa : (selfWon?0:need);
  if(selfWon && selfWins<need) selfWins=need;
  if(!selfWon && oppWins<need) oppWins=need;

  if(pending.stage==='groups'){
    applyGCCashCupGroupResult(s3.stage, state.org.name, pending.opponentName, { winner, scoreA:selfWins, scoreB:oppWins });
    (s3.stage.rounds[s3.stage.roundIndex]||[]).forEach(([a,b])=>{
      if(a===state.org.name || b===state.org.name) return;
      const r = resolveGCCashCupMatch(a,b,'bo3');
      applyGCCashCupGroupResult(s3.stage,a,b,r);
    });
    s3.stage.roundIndex++;
  } else if(pending.stage==='playins'){
    const bracket = s3.playIns[pending.bracketKey];
    const m = pending.matchId==='final' ? bracket.final : bracket.semis[+pending.matchId.slice(5)];
    m.winner = winner; m.loser = winner===m.a ? m.b : m.a;
    m.scoreA = m.a===state.org.name ? selfWins : oppWins;
    m.scoreB = m.a===state.org.name ? oppWins : selfWins;
  } else {
    const m = getGCStage3Match(s3.bracket, pending.matchId);
    m.winner = winner; m.loser = winner===m.a ? m.b : m.a;
    m.scoreA = m.a===state.org.name ? selfWins : oppWins;
    m.scoreB = m.a===state.org.name ? oppWins : selfWins;
  }
  s3.pendingMatch = null;
  catchUpGCStage3();
  if(s3.bracket && s3.bracket.champion) awardGCStage3Prizes(s3);
}
// Reconstruit l'ordre 1er→6e à partir du bracket Playoffs — la 1re place
// (qualification directe au Championship, voir GC_STAGE_POINTS_TABLE.stage3
// sans entrée "1") n'est PAS incluse dans les points, seulement dans
// l'affichage de champion (voir renderGCStage3Panel/awardGCStage3Prizes).
function gcStage3Placements(s3){
  const b = s3.bracket;
  const champion = b.champion, runnerUp = b.viceChampion;
  const third = b.lbfinal.loser;
  const fourth = b.lbsemis.loser;
  const fifthSixth = [b.lbr2[0].loser, b.lbr2[1].loser].filter(Boolean);
  return [champion, runnerUp, third, fourth, ...fifthSixth].filter(Boolean);
}
function awardGCStage3Prizes(s3){
  if(s3.prizeAwarded) return;
  s3.prizeAwarded = true;
  const b = s3.bracket;
  const champion = b.champion, runnerUp = b.viceChampion;
  const region = gcRegionLabel();
  pushGCCompetitionHistory({ year:s3.year, competition:`Stage 3 ${region}`, label:`Stage 3 ${region}, ${s3.year}`, champion, isSelf: champion===state.org.name });
  awardGCStagePoints('stage3', s3.year, gcStage3Placements(s3));
  const shareOf = (pct)=> Math.round(GC_STAGE3_PRIZE_POOL * pct);
  if(champion===state.org.name || runnerUp===state.org.name){
    const prize = champion===state.org.name ? shareOf(GC_STAGE1_PRIZE_SHARES.champion) : shareOf(GC_STAGE1_PRIZE_SHARES.runnerUp);
    state.budget += prize;
    recordTransaction('valorant_gc', 'other', `Stage 3 ${region}, cashprize`, prize);
    state.reputation = Math.min(100, (state.reputation||0) + (champion===state.org.name?6:3));
    pushNotification(`🏆 ${state.org.name} ${champion===state.org.name?'remporte':'termine finaliste au'} Stage 3 ${region} ! Prime : ${formatMoney(prize)}.${champion===state.org.name?` Qualification directe au Championship ${region} !`:''}`);
    pushNews(`${state.org.name} ${champion===state.org.name?'sacré champion':'finaliste'} du Stage 3 ${region} (Valostrike GC).`, 'result', 'valorant_gc');
  } else if(champion!==state.org.name){
    pushNews(`${champion} remporte le Stage 3 ${region} (Valostrike GC) et se qualifie directement pour le Championship.`);
  }
}
// Point d'entrée quotidien — même idiome d'auto-réparation par fenêtre de
// jours que catchUpGCStage2. Phase intermédiaire 'playins-wait' entre la fin
// du groupe et le tirage des Play-Ins : le champ Play-Ins a besoin des
// points Cash Cup de mai-juillet (gcCashCupPointsInRange), qui peuvent ne
// pas encore compter 4 éditions résolues pile au jour J — la fonction
// réessaie simplement les jours suivants plutôt que de forcer un champ
// incomplet.
function catchUpGCStage3(){
  const d = state.date;
  let s3 = state.gcStage3Emea;
  if(s3 && s3.year===d.year && s3.phase==='done') return;
  const cur = new Date(d.year, d.month, d.day).getTime();
  if(!s3 || s3.year!==d.year){
    // Bornes basse ET haute — voir catchUpGCOtherRegionsStage3ForRegion pour
    // le détail du bug (sans la borne haute, Stage 3 pouvait démarrer
    // n'importe quand après le 20 juillet, y compris en plein hiver, sur
    // une sauvegarde/section rejointe après coup).
    if(cur < gcDateTs(d.year, GC_STAGE3_GROUPS_START) || cur > gcDateTs(d.year, GC_STAGE3_PLAYOFFS_END)) return;
    const field = buildGCStage3Field(true);
    s3 = state.gcStage3Emea = {
      year:d.year, phase:'groups',
      stage:{ teams: field.map(n=>({name:n,w:0,l:0,mapsFor:0,mapsAgainst:0})), rounds: generateRoundRobinRounds(field), roundIndex:0 },
      groupQualifiers:null, playInsGroupSeeds:null, playIns:null, bracket:null,
      prizeAwarded:false, pendingMatch:null,
    };
  }
  const pastGroups = cur > gcDateTs(d.year, GC_STAGE3_GROUPS_END);
  const pastPlayIns = cur > gcDateTs(d.year, GC_STAGE3_PLAYINS_END);
  const pastPlayoffs = cur > gcDateTs(d.year, GC_STAGE3_PLAYOFFS_END);

  if(s3.phase==='groups'){
    resolveGCStage3GroupRound(s3.stage);
    if(pastGroups){
      let guard=0;
      while(s3.stage.roundIndex<s3.stage.rounds.length && !s3.pendingMatch && guard<12){ resolveGCStage3GroupRound(s3.stage); guard++; }
    }
    if(s3.stage.roundIndex>=s3.stage.rounds.length){
      const standings = gcStage2Standings(s3.stage); // comparateur générique, même forme d'équipe
      s3.groupQualifiers = standings.slice(0,6).map(t=>t.name);
      s3.playInsGroupSeeds = standings.slice(-4).map(t=>t.name);
      s3.phase = 'playins-wait';
    }
    return;
  }
  if(s3.phase==='playins-wait'){
    if(cur < gcDateTs(d.year, GC_STAGE3_PLAYINS_START) && !pastGroups) return;
    const pointsRange = gcCashCupPointsInRange(d.year, 4, d.year, 6); // mai à juillet
    const usedNames = new Set([...s3.groupQualifiers, ...s3.playInsGroupSeeds]);
    const cashCupSeeds = Object.entries(pointsRange).sort((a,b)=>b[1]-a[1]).map(([name])=>name).filter(n=>!usedNames.has(n)).slice(0,4);
    if(cashCupSeeds.length < 4){
      if(!pastPlayIns) return; // pas encore assez d'éditions Cash Cup résolues sur la fenêtre, réessaie les jours suivants
      // Fenêtre Play-Ins entièrement dépassée sans 4 qualifiées Cash Cup
      // distinctes (ex. section rejointe en cours de saison) : complète avec
      // les meilleures équipes du vivier régional encore libres, jamais de champ
      // à moins de 8 équipes.
      const pool = ensureGCTeamPool();
      const filler = shuffle(Object.values(pool).filter(t=> t.region===myValorantGCRegion() && !usedNames.has(t.name) && !cashCupSeeds.includes(t.name)).map(t=>t.name));
      while(cashCupSeeds.length<4 && filler.length) cashCupSeeds.push(filler.pop());
    }
    const eight = [...s3.playInsGroupSeeds, ...cashCupSeeds];
    const sorted = [...eight].sort((a,b)=>gcTeamStrength(b)-gcTeamStrength(a));
    s3.playIns = {
      bracketA: buildGCStage3PlayInsMiniBracket([sorted[0],sorted[3],sorted[4],sorted[7]]),
      bracketB: buildGCStage3PlayInsMiniBracket([sorted[1],sorted[2],sorted[5],sorted[6]]),
    };
    s3.phase = 'playins';
  }
  if(s3.phase==='playins'){
    resolveGCStage3PlayInsBracket(s3,'bracketA');
    resolveGCStage3PlayInsBracket(s3,'bracketB');
    if(pastPlayIns){
      let guard=0;
      while((!s3.playIns.bracketA.champion || !s3.playIns.bracketB.champion) && !s3.pendingMatch && guard<10){
        resolveGCStage3PlayInsBracket(s3,'bracketA'); resolveGCStage3PlayInsBracket(s3,'bracketB'); guard++;
      }
    }
    if(s3.playIns.bracketA.champion && s3.playIns.bracketB.champion){
      const eight = [...s3.groupQualifiers, s3.playIns.bracketA.champion, s3.playIns.bracketB.champion];
      s3.bracket = buildGCStage3PlayoffBracket(eight);
      s3.phase = 'playoffs';
    }
    return;
  }
  if(s3.phase==='playoffs'){
    if(cur < gcDateTs(d.year, GC_STAGE3_PLAYOFFS_START) && !pastPlayIns) return;
    resolveGCStage3PlayoffRound(s3);
    if(pastPlayoffs){
      let guard=0;
      while(!s3.bracket.champion && !s3.pendingMatch && guard<16){ resolveGCStage3PlayoffRound(s3); guard++; }
    }
    if(s3.bracket.champion){
      awardGCStage3Prizes(s3);
      s3.phase = 'done';
    }
  }
}
function renderGCStage3Panel(){
  const s3 = state.gcStage3Emea;
  if(!s3) return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-trophy"></i><div>Le Stage 3 se joue chaque année de juillet à août, une fois la Promotion/Relegation Stage 2 terminée.</div></div>`;
  if(s3.phase==='groups'){
    return `
      <div class="card info-card">
        <div style="font-weight:700;margin-bottom:8px;">Classement, groupe unique</div>
        ${gcStage2Standings(s3.stage).map((t,i)=>`<div class="info-row"><span>${i+1}. ${kickoffTeamCell(t.name)} <span style="color:${i<6?'var(--success)':'var(--warning)'};font-size:12px;">${i<6?'Playoffs':'Play-Ins'}</span></span><span>${t.w}V-${t.l}D</span></div>`).join('')}
      </div>
    `;
  }
  if(s3.phase==='playins-wait'){
    return `<div class="empty-state" style="padding:20px;"><i class="fa-solid fa-hourglass-half"></i><div>Phase de groupe terminée. En attente des qualifiées Cash Cup (points de mai à juillet) pour former les Play-Ins.</div></div>`;
  }
  if(s3.phase==='playins'){
    return `
      ${renderKickoffBracketColumns([{ label:'Play-Ins, bracket A', matches:[...s3.playIns.bracketA.semis, s3.playIns.bracketA.final] }])}
      ${renderKickoffBracketColumns([{ label:'Play-Ins, bracket B', matches:[...s3.playIns.bracketB.semis, s3.playIns.bracketB.final] }])}
    `;
  }
  const b = s3.bracket;
  if(s3.phase==='playoffs'){
    return `
      ${renderKickoffBracketColumns([{ label:'Upper Bracket Quarterfinals', matches:b.ubqf }])}
      ${renderKickoffBracketColumns([
        { label:'Upper Bracket Semifinals', matches:b.ubsf },
        { label:'Upper Bracket Final', matches:[b.ubfinal] },
      ])}
      ${renderKickoffBracketColumns([{ label:'Lower Bracket Round 1', matches:b.lbr1 }])}
      ${renderKickoffBracketColumns([
        { label:'Lower Bracket Round 2', matches:b.lbr2 },
        { label:'Lower Bracket Semifinale', matches:[b.lbsemis] },
        { label:'Lower Bracket Final', matches:[b.lbfinal] },
      ])}
      ${renderKickoffBracketColumns([{ label:'Grande Finale', matches:[b.grandfinal] }])}
    `;
  }
  return `
    <div class="card info-card" style="text-align:center;padding:24px;">
      <i class="fa-solid fa-trophy" style="font-size:28px;color:var(--info);margin-bottom:10px;"></i>
      <div style="font-weight:700;font-size:16px;">${kickoffTeamCell(b ? b.champion : '—')}, Champion du Stage 3</div>
      <div style="margin-top:6px;color:var(--text-secondary);">Qualification directe au Championship ${gcRegionLabel()}.</div>
    </div>
  `;
}
