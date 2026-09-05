/* ============================================================
   VALORANT.JS, code strictement exclusif à la section Valorant.
   Chargé après script.js (voir index.html), dans le même contexte
   global classique (pas de modules ES) : toutes les fonctions et
   constantes ci-dessous restent appelables depuis script.js exactement
   comme si elles y étaient toujours définies.

   Ce fichier ne contient QUE du code vérifié comme n'ayant aucune
   dépendance depuis les autres sections (LoL / CS2 / Rocket League) :
   la cellule de staff dédiée Valorant, son marché de recrutement, la
   vue des patch notes et le classement Ranked Solo Queue.

   Attention : beaucoup d'autres systèmes de script.js portent aussi
   "Valorant" dans leur nom (le calendrier VST complet, le moteur de
   simulation manche par manche, le World Hub...) mais restent dans
   script.js car ils sont imbriqués avec des données ou fonctions
   génériques partagées par tous les jeux (ex. le World Hub simule
   aussi les ligues de fond de Rocket League/LoL/CS2). Les séparer à
   l'aveugle risquerait de casser ces dépendances croisées, voir la
   discussion en fin de conversation pour le détail de ce qui reste où.
   ============================================================ */

/* ---- Cellule de staff dédiée Valorant (indépendante du staff partagé
   d'organisation, voir state.valorantStaff) ---- */
const VALORANT_STAFF_ROLES = ['Head Coach','Assistant Coach','Recruteur','Médecin','Psychologue Sportif'];
/* ---- Staff dédié Valorant (Head Coach, Assistant Coach, Analyste, 2 Recruteurs) ---- */
function ensureValorantStaff(){
  if(!state.valorantStaff) state.valorantStaff = {};
  // Migration : les parties créées avant la fusion des postes de recruteur
  // (Recruteur 1 / Recruteur 2 → un seul "Recruteur") gardent le meilleur
  // des deux titulaires ; l'autre repart sur le marché du staff Valorant.
  const legacy1 = state.valorantStaff['Recruteur 1'];
  const legacy2 = state.valorantStaff['Recruteur 2'];
  if(legacy1 || legacy2){
    const keep = (legacy1 && legacy2) ? (legacy1.level>=legacy2.level ? legacy1 : legacy2) : (legacy1 || legacy2);
    const released = (legacy1 && legacy2) ? (keep===legacy1 ? legacy2 : legacy1) : null;
    if(!state.valorantStaff['Recruteur']) state.valorantStaff['Recruteur'] = keep;
    delete state.valorantStaff['Recruteur 1'];
    delete state.valorantStaff['Recruteur 2'];
    if(released){
      ensureValorantStaffMarket();
      valorantFamilyStaffMarket.push({
        id: uid(), name:released.name, pseudo:released.pseudo, age:released.age, nationality:released.nationality,
        level:released.level, potential:released.potential, xp:released.xp, salary:released.salary,
        attributes:released.attributes, personality:released.personality, morale:released.morale,
        role:'Recruteur', careerHistory:released.careerHistory||[], transferHistory:released.transferHistory||[],
      });
    }
  }
  // Migration : le poste "Analyste" est supprimé, ses missions (rapports
  // de scouting adverse) sont reprises par l'Assistant Coach — un ancien
  // titulaire du poste rejoint Assistant Coach si le poste est vacant,
  // sinon on garde le meilleur des deux et l'autre repart sur le marché.
  const legacyAnalyst = state.valorantStaff['Analyste'];
  if(legacyAnalyst){
    const currentAssistant = state.valorantStaff['Assistant Coach'];
    const keep = (currentAssistant && currentAssistant.level>=legacyAnalyst.level) ? currentAssistant : legacyAnalyst;
    const released = (currentAssistant && keep!==currentAssistant) ? currentAssistant : (keep!==legacyAnalyst ? legacyAnalyst : null);
    state.valorantStaff['Assistant Coach'] = keep;
    delete state.valorantStaff['Analyste'];
    if(released){
      ensureValorantStaffMarket();
      valorantFamilyStaffMarket.push({
        id: uid(), name:released.name, pseudo:released.pseudo, age:released.age, nationality:released.nationality,
        level:released.level, potential:released.potential, xp:released.xp, salary:released.salary,
        attributes:released.attributes, personality:released.personality, morale:released.morale,
        role:'Assistant Coach', careerHistory:released.careerHistory||[], transferHistory:released.transferHistory||[],
      });
    }
  }
  backfillHiredStaffGender(state.valorantStaff);
  return state.valorantStaff;
}

// Bonus concret de victoire apporté par le staff Valorant dédié : le Head
// Coach (stratégie/performance) et le Psychologue Sportif (stabilité
// mentale) augmentent réellement la probabilité de victoire en match.
function valorantStaffMatchBonus(gameId, staffOverride){
  if(gameId!=='valorant') return 0;
  const staff = staffOverride || ensureValorantStaff();
  const coach = staff['Head Coach'];
  const psy = staff['Psychologue Sportif'];
  let bonus = 0;
  // Puissance pondérée par les attributs pertinents (voir
  // staffEffectivePower) plutôt que le seul niveau brut : Leadership +
  // Stratégie pour le Head Coach, Motivation + Cohésion pour le Psychologue.
  if(coach) bonus += (staffEffectivePower(coach, ['Leadership','Stratégie'])/100) * 0.08; // jusqu'à +8%
  if(psy) bonus += (staffEffectivePower(psy, ['Motivation','Cohésion'])/100) * 0.04;      // jusqu'à +4% supplémentaires
  return bonus;
}
// Réduction de fatigue quotidienne apportée par le Médecin (0 à 30% de
// réduction selon son niveau).
function valorantMedecinFatigueReduction(){
  const m = ensureValorantStaff()['Médecin'];
  return m ? (staffEffectivePower(m, ['Récupération','Prévention des blessures'])/100) * 0.3 : 0;
}

function valorantStaffCard(role){
  const store = ensureValorantStaff();
  const m = store[role];
  const displayName = staffRoleDisplayName(role);
  if(!m){
    return `
      <div class="staff-empty-slot" data-role="${escapeAttr(role)}">
        <i class="fa-solid fa-user-plus" style="font-size:20px;"></i>
        <div style="font-weight:600;font-size:13px;">${displayName}</div>
        <button class="btn btn-sm goto-section-tab-btn" data-game="valorant" data-tab="mercato"><i class="fa-solid fa-cart-shopping"></i> Voir sur le marché</button>
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
          <div class="staff-name">${staffNameLinkHired(role, m.name, 'valorant')}</div>
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
        <button class="btn btn-danger btn-sm valorant-staff-fire-btn" data-role="${escapeAttr(role)}"><i class="fa-solid fa-user-minus"></i> Licencier</button>
      </div>
    </div>
  `;
}

function fireValorantStaff(role){
  const store = ensureValorantStaff();
  const m = store[role];
  if(!m) return;
  const severance = Math.round(m.salary * 2);
  if(state.budget < severance){
    toast(`Indemnité de départ insuffisante (${formatMoney(severance)} nécessaires).`, 'error');
    return;
  }
  openConfirmActionModal({
    title: 'Licencier ce membre du staff ?',
    body: `Licencier <b>${m.name}</b> coûtera une indemnité de départ de <b>${formatMoney(severance)}</b> (2 mois de salaire).`,
    confirmLabel: '<i class="fa-solid fa-user-minus"></i> Licencier',
    onConfirm: ()=>{
      state.budget -= severance;
      recordTransaction('valorant', 'severance', `Indemnité de départ, ${m.name}`, -severance);
      pushNotification(`${m.name} quitte la cellule Valorant (indemnité : ${formatMoney(severance)}).`);
      pushNews(`${m.name} quitte ${state.org.name} après son licenciement.`);
      toast(`${m.name} licencié(e).`, 'info');
      delete store[role];
      saveState();
      renderTopbar();
      renderSectionPage('valorant', 'staff');
    },
  });
}

// Marché dédié à la cellule de staff Valorant (Head Coach, Assistant Coach,
// Recruteur, Médecin, Psychologue Sportif) — LIÉ au marché GC (voir
// ensureValorantFamilyStaffMarket, script.js) : un même bassin de candidats
// partagé entre Valostrike classique et Valostrike GC, recrutable depuis
// l'une ou l'autre section. Ce wrapper ne sert plus qu'à garder les
// nombreux appels existants (dedicatedStaffMarket, etc.) inchangés.
function ensureValorantStaffMarket(){
  const market = ensureValorantFamilyStaffMarket();
  // Migration : anciens candidats générés sous Recruteur 1 / Recruteur 2,
  // désormais fusionnés en un seul poste "Recruteur".
  market.forEach(c=>{ if(c.role==='Recruteur 1' || c.role==='Recruteur 2') c.role = 'Recruteur'; });
  return market;
}

const VALORANT_STAFF_SORT_OPTIONS = VALORANT_STAFF_ROLES;
// Rendu des cartes du marché du staff Valorant (même gabarit visuel que
// renderStaffMarketCards, mais rôles et libellés propres à la cellule Valorant).
function renderValorantStaffMarketCards(filterQuery='', pageKey='valorantStaffMercato'){
  const market = ensureValorantStaffMarket();
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
    const currentHolder = ensureValorantStaff()[c.role] ? ensureValorantStaff()[c.role].name : null;
    return staffMarketRowHtml('valorant', c, displayName, staffRoleDisplayName(c.role), currentHolder, 'buy-valorant-staff-btn');
  }).join('');
  return {
    cardsHtml: staffMarketListHtml(rowsHtml),
    paginationHtml: renderPaginationBar(pageKey, page, totalPages, total, STAFF_CARDS_PAGE_SIZE),
    sortBarHtml: renderStaffRoleSortBar(pageKey, VALORANT_STAFF_SORT_OPTIONS, VALORANT_STAFF_ROLES),
  };
}

function bindValorantStaffMarketBuyButtons(onDone, pageKey='valorantStaffMercato'){
  document.querySelectorAll('.buy-valorant-staff-btn').forEach(btn=>{
    btn.onclick = ()=> openStaffNegotiation('valorant', btn.dataset.id);
  });
  bindPaginationBar(pageKey, onDone);
  bindStaffRoleSortBar(pageKey, onDone, VALORANT_STAFF_SORT_OPTIONS, VALORANT_STAFF_ROLES);
}

// Onglet "Notes de patch" dynamique pour Valorant : version en vigueur,
// prochain patch planifié (avec statut de l'annonce), puis l'historique
// complet — le plus récent en premier — avec type, date, changements
// Agents, changements Maps, résumé et journal des emails envoyés.
function renderValorantPatchNotesView(){
  const ps = ensurePatchSystem();
  if(!ps.firstSplitDone){
    return `
      <div class="empty-state">
        <i class="fa-solid fa-code-branch"></i>
        <div>Aucun patch n'a encore été publié.</div>
      </div>
    `;
  }
  const nextEntry = ps.scheduled.find(s=>!s.applied);
  return `
    <div class="opt-note" style="margin-bottom:14px;"><i class="fa-solid fa-code-branch"></i><span>Version actuellement en vigueur : <b>${ps.version}</b></span></div>
    <div class="card-grid two">
      ${ps.history.map(p=>`
        <div class="patch-note-card ${p.type==='Majeur'?'major':'minor'}">
          <div class="patch-note-header">
            <div class="patch-note-version"><i class="fa-solid fa-code-branch"></i> Version ${p.version}</div>
            <span class="badge ${p.type==='Majeur'?'badge-blue':'badge-grey'}">${p.type}</span>
          </div>
          <div class="patch-note-date">${p.date}</div>
          <ul class="patch-note-summary">
            ${p.summary.map(s=>`<li>${s}</li>`).join('')}
          </ul>
          <div class="patch-note-footer">
            <i class="fa-regular fa-envelope"></i> Annonce ${p.emails.announcement?`envoyée le ${p.emails.announcement}`:'non envoyée'} · Déploiement ${p.emails.deployment?`envoyé le ${p.emails.deployment}`:'non envoyé'}
          </div>
        </div>
      `).join('') || `<div class="empty-state"><i class="fa-solid fa-code-branch"></i><div>Aucune note de patch disponible pour le moment.</div></div>`}
    </div>
  `;
}


// Une entrée par jeu de la famille Valostrike (voir isValorantFamily,
// script.js) : sinon changer de région/page sur l'onglet Ranked GC
// pollue aussi la sélection de l'onglet Ranked Valostrike classique.
let rankedUIState = { valorant:{region:'emea',page:1}, valorant_gc:{region:'emea',page:1} };
const RANKED_PAGE_SIZE = 15;

function renderValorantRankedTab(gameId='valorant'){
  const ui = rankedUIState[gameId];
  const region = ui.region;
  const ladder = computeRegionalLadder(gameId, region);
  const mine = ladder.filter(r=>r.isMine);
  const totalPages = Math.max(1, Math.ceil(ladder.length / RANKED_PAGE_SIZE));
  ui.page = Math.min(Math.max(1, ui.page), totalPages);
  const pageStart = (ui.page-1)*RANKED_PAGE_SIZE;
  const pageRows = ladder.slice(pageStart, pageStart+RANKED_PAGE_SIZE);

  // Grille à colonnes fixes façon .mercato-wide/.squad-list (voir style.css)
  // plutôt qu'un <table> grillagé — même refonte "épurée" appliquée à
  // Mail/Effectif/Mercato cette session.
  const cols = '36px 168px 46px minmax(170px,1.4fr) 120px 112px 76px 64px 64px minmax(150px,1fr)';
  const headHtml = `
    <div class="ranked-list-head">
      <div class="ranked-col-center">#</div>
      <div>Rang</div>
      <div class="ranked-col-center">Nat.</div>
      <div>Pseudo</div>
      <div>Équipe</div>
      <div>Rôle</div>
      <div class="ranked-col-center">Winrate</div>
      <div class="ranked-col-center">KDA</div>
      <div class="ranked-col-center">Rating</div>
      <div>Agents</div>
    </div>
  `;
  const renderRow = (r)=>{
    const p = r.player;
    const stats = rankedStatsDisplay(p);
    const flag = flagImg(p.nationality);
    const residency = playerResidencyStatus(p, region);
    const agents = topAgents(p, 2);
    return `
      <div class="ranked-row ${r.isMine?'ranked-row-mine':''}">
        <div class="ranked-col-center ranked-rank-num">${r.regionalRank}</div>
        <div><span class="badge ${valorantRankBadgeClass(r.displayTier.tier)}">${rankLabel(r.displayTier)} · ${Math.max(0,Math.round(r.rr))} RR</span></div>
        <div class="ranked-col-center">${flag}</div>
        <div><div class="player-name-cell">${playerNameLink(p)}<span class="badge ${residency.cls}" style="margin-left:6px;">${residency.label}</span></div></div>
        <div><span class="badge ${r.isMine?'badge-blue':'badge-purple'}" data-team-link="${escapeAttr(r.teamName)}" style="cursor:pointer;">${r.teamName}</span></div>
        <div><span class="badge ${roleBadgeClass(p.role)}">${p.role}</span></div>
        <div class="ranked-col-center">${stats.wr}%</div>
        <div class="ranked-col-center">${stats.kda.toFixed(2)}</div>
        <div class="ranked-col-center">${stats.rating.toFixed(2)}</div>
        <div class="ranked-agents">${agents.length ? agents.map(a=>`${a.name} ×${a.count}`).join(', ') : '—'}</div>
      </div>
    `;
  };

  const regionTabs = VALORANT_RANKED_REGIONS.map(r=>`
    <button class="subnav-tab-btn ranked-region-btn ${r===region?'active':''}" data-region="${r}">${VCT_REGION_LABELS[r]||r}</button>
  `).join('');

  const pagination = totalPages>1 ? `
    <div class="ranked-pagination">
      <button class="btn btn-sm ranked-page-btn" data-dir="-1" ${ui.page<=1?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button>
      <span>Page ${ui.page} / ${totalPages}</span>
      <button class="btn btn-sm ranked-page-btn" data-dir="1" ${ui.page>=totalPages?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button>
    </div>
  ` : '';

  return `
    <div class="section-title" style="margin-top:0;">Ranked</div>
    <div class="subnav-tabs">${regionTabs}</div>

    ${mine.length ? `
      <div class="section-title">Vos joueurs</div>
      <div class="ranked-scroll" style="margin-bottom:24px;">
        <div class="ranked-list" style="--ranked-cols:${cols};">
          ${headHtml}
          ${mine.map(renderRow).join('')}
        </div>
      </div>
    ` : ''}

    <div class="ranked-scroll">
      <div class="ranked-list" style="--ranked-cols:${cols};">
        ${headHtml}
        ${pageRows.length ? pageRows.map(renderRow).join('') : `<div class="empty-state">Aucun joueur classé pour le moment.</div>`}
      </div>
    </div>
    ${pagination}
  `;
}

function bindRankSoloEvents(gameId){
  if(!isValorantFamily(gameId)) return;
  const ui = rankedUIState[gameId];
  document.querySelectorAll('.ranked-region-btn').forEach(btn=>{
    btn.onclick = ()=>{
      ui.region = btn.dataset.region;
      ui.page = 1;
      renderSectionPage(gameId, 'ranksolo');
    };
  });
  document.querySelectorAll('.ranked-page-btn').forEach(btn=>{
    btn.onclick = ()=>{
      ui.page += parseInt(btn.dataset.dir, 10);
      renderSectionPage(gameId, 'ranksolo');
    };
  });
}


/* ---- Pool de cartes Valorant (voir ensureMapPool / rotateMapPoolForMajorPatch) ---- */
// Pool complet de 10 cartes existantes ; seules 7 sont actives en rotation
// à un instant donné (3 hors rotation), avec une rotation annuelle dont
// l'historique est conservé (voir ensureMapPool / rotateMapPoolForMajorPatch).
const VALORANT_MAP_POOL = ['Meridian','Foundry','Zenith','Outpost','Refuge','Crescent','Vertex','Hollow','Blackwater','Aurora','Quai IX'];
// Thème et style de jeu de chaque carte — purement descriptif, affiché dans
// l'onglet Patch aux côtés du statut actif/inactif et de la rotation.
const MAP_INFO = {
  Meridian: { sites:3, theme:"Carte équilibrée à trois sites, propice aux stratégies polyvalentes." },
  Foundry:  { sites:2, theme:"Ancienne usine reconvertie, couloirs étroits favorisant les duels rapprochés." },
  Zenith:   { sites:2, theme:"Style japonais, environnement urbain avec de nombreuses structures." },
  Outpost:  { sites:2, theme:"Poste avancé désertique, larges zones ouvertes et lignes de mire dégagées." },
  Refuge:   { sites:2, theme:"Bunker souterrain labyrinthique, favorise l'utilité et le contrôle de zone." },
  Crescent: { sites:3, theme:"Carte en arc de cercle, rotations rapides entre les sites." },
  Vertex:   { sites:2, theme:"Complexe technologique à plusieurs niveaux, forte verticalité." },
  Hollow:   { sites:2, theme:"Cavernes naturelles, visibilité réduite et embuscades fréquentes." },
  Blackwater:{ sites:2, theme:"Carte défensive à couloirs multiples, favorise les Sentinelles." },
  Aurora:   { sites:3, theme:"Site glacial à ciel ouvert, longues lignes de mire et jeu de précision." },
  'Quai IX':{ sites:2, theme:"Port commercial nocturne, contraste entre quai ouvert à longues lignes de mire et entrepôt cloisonné au combat rapproché." },
};
function ensureMapPool(){
  if(!state.mapPool){
    const shuffled = shuffle(VALORANT_MAP_POOL);
    state.mapPool = {
      active: shuffled.slice(0,7),
      inactive: shuffled.slice(7),
      lastRotationYear: state.date ? state.date.year : 2026,
      history: [],
    };
  }
  return state.mapPool;
}
// Rotation du pool actif, déclenchée uniquement par un patch MAJEUR (voir
// applyScheduledPatch) : fait tourner jusqu'à 2 cartes actives vers
// l'inactif et en réintroduit jusqu'à 2 autres, en conservant l'historique
// complet des rotations passées. Toute carte présente dans
// VALORANT_MAP_POOL mais encore inconnue du pool actif/inactif est
// considérée comme "nouvellement créée depuis le dernier patch majeur" :
// elle rejoint d'abord le hors-rotation, puis ne devient éligible au tirage
// actif qu'au patch majeur SUIVANT (jamais le même patch que sa création).
function rotateMapPoolForMajorPatch(){
  const pool = ensureMapPool();
  const known = new Set([...pool.active, ...pool.inactive]);
  const brandNew = VALORANT_MAP_POOL.filter(m=>!known.has(m));
  brandNew.forEach(m=>{ if(!pool.inactive.includes(m)) pool.inactive.push(m); });

  // Le pool actif ne doit JAMAIS rétrécir : on ne retire jamais plus de
  // cartes qu'on ne peut vraiment en remettre (eligibleIn.length). Sans
  // cette limite, des rotations répétées sur une longue partie pouvaient
  // faire fondre le pool actif sous 7 cartes — or le véto BO3 (ban,ban,
  // pick,pick,ban,ban = 6 étapes) a besoin d'au moins 7 cartes actives pour
  // qu'il en reste toujours une comme "decider map" : sous ce seuil, une
  // série pouvait se retrouver bloquée à 1-1 sans 3e carte pour la
  // départager (le "FINAL" tombait directement sur une égalité).
  const eligibleIn = pool.inactive.filter(m=>!brandNew.includes(m));
  const rotateOutCount = Math.min(2, pool.active.length, eligibleIn.length);
  const rotatingOut = shuffle(pool.active).slice(0, rotateOutCount);
  const rotatingIn = shuffle(eligibleIn).slice(0, rotateOutCount);

  pool.history.push({ version: state.patchSystem ? state.patchSystem.version : null, active:[...pool.active], inactive:[...pool.inactive] });
  pool.active = pool.active.filter(m=>!rotatingOut.includes(m)).concat(rotatingIn);
  pool.inactive = pool.inactive.filter(m=>!rotatingIn.includes(m)).concat(rotatingOut);
  return { added: rotatingIn, removed: rotatingOut, newlyEligible: brandNew };
}
// Alias rétro-compatible : le reste du code (méta, cartes fortes/faibles...)
// continue de piocher uniquement dans les cartes actuellement actives.
// Dès les playoffs d'un split, une carte du hors-rotation remplace
// temporairement la carte active la moins utilisée dans le pool compétitif
// — un détail de format VST, sans toucher à la rotation "officielle"
// (state.mapPool), qui ne change qu'au patch majeur suivant.
function VALORANT_MAPS_ACTIVE(){
  const pool = ensureMapPool();
  const phase = state.vct ? state.vct.phase : null;
  if((phase==='playoffs_split1' || phase==='playoffs_split2') && pool.inactive.length && pool.active.length){
    const swapIn = pool.inactive[0];
    const swapOut = pool.active[pool.active.length-1];
    return pool.active.filter(m=>m!==swapOut).concat(swapIn);
  }
  return pool.active;
}
const VALORANT_MAPS = VALORANT_MAP_POOL.slice(0,8); // legacy fallback si state indisponible

/* ---------------------------------------------------------
   3quater. VALORANT, RANKED SOLO QUEUE (indépendant des compétitions
   officielles). 4 régions (EMEA / Americas / Pacific / China), chacune
   avec son propre ladder, son propre Top 50 et son propre plafond
   Radiant. Système de RR sur 25 échelons, simulé chaque jour.
   --------------------------------------------------------- */
const VALORANT_RANKED_REGIONS = ['emea','americas','pacific','china'];

const RANK_TIER_NAMES = ['Iron','Bronze','Silver','Gold','Platinum','Diamond','Ascendant','Immortal'];

// Chaque division = 100 RR. Immortal 1 démarre à 1800 RR (point de départ
// de chaque nouvelle saison) ; Radiant commence juste au-dessus d'Immortal 3.
function buildRankLadder(){
  const ladder = [];
  const divisionsBeforeImmortal = (RANK_TIER_NAMES.length-1) * 3; // Iron..Ascendant = 7 tiers * 3
  const immortal1Floor = 1800;
  const baseFloor = immortal1Floor - divisionsBeforeImmortal*100;
  RANK_TIER_NAMES.forEach((tier, tierIdx)=>{
    for(let division=1; division<=3; division++){
      const globalIdx = tierIdx*3 + (division-1);
      ladder.push({ tier, division, floor: baseFloor + globalIdx*100 });
    }
  });
  ladder.push({ tier:'Radiant', division:null, floor: baseFloor + RANK_TIER_NAMES.length*3*100 });
  return ladder;
}
const RANK_LADDER = buildRankLadder();

function rankTierForRR(rr){
  for(let i=RANK_LADDER.length-1;i>=0;i--){
    if(rr >= RANK_LADDER[i].floor) return RANK_LADDER[i];
  }
  return RANK_LADDER[0];
}
function rankLabel(tierEntry){
  if(!tierEntry) return '—';
  return tierEntry.division ? `${tierEntry.tier} ${tierEntry.division}` : tierEntry.tier;
}
function valorantRankBadgeClass(tier){
  if(tier==='Radiant') return 'badge-radiant';
  if(tier==='Immortal') return 'badge-red';
  if(tier==='Ascendant') return 'badge-green';
  if(tier==='Diamond') return 'badge-purple';
  if(tier==='Platinum' || tier==='Gold') return 'badge-orange';
  return 'badge-blue'; // Silver / Bronze / Iron
}

const VALORANT_AGENTS_BY_ROLE = {
  'Duelliste':  ['Kaidan','Rhoven','Ignis','Vexal','Solmara','Drakko','Halcyon'],
  'Initiateur': ['Sondra','Pryzm','Kestrix','Marrow','Voltane','Ashra'],
  'Contrôleur': ['Nimbus','Verdane','Grael','Mistara','Obscura','Corvane'],
  'Sentinelle': ['Sentra','Warden','Bastian','Locke','Thorne'],
  'Flex':       ['Kaidan','Sondra','Nimbus','Sentra','Rhoven','Pryzm','Verdane','Warden','Vexal','Kestrix'],
};

// Kit complet de chaque agent : titre, et ses 4 compétences (Signature/A/B/
// Ultimate) avec nom, description, et des statistiques chiffrées que les
// patchs (voir applyScheduledPatch) peuvent buffer ou nerfer au fil du
// temps. currentAgentStat() renvoie toujours la valeur EFFECTIVE (base +
// éventuel ajustement de patch en vigueur) — jamais la valeur de base seule.
const AGENT_KITS = {
  // --- DUELLISTES ---
  'Kaidan': { title:'Assassin Spectral', abilities:{
    signature:{ name:'Shadow Dash', desc:"Traverse rapidement une courte distance sous forme spectrale.", stats:{'Distance (m)':12,'Recharge (s)':35} },
    a:{ name:'Phantom Blade', desc:"Lance une lame d'ombre qui marque la cible.", stats:{'Dégâts':15,'Coût':200} },
    b:{ name:'Void Flash', desc:"Explosion spectrale aveuglant les ennemis regardant l'impact.", stats:{'Durée aveuglement (s)':1.5,'Coût':200} },
    ultimate:{ name:'Eclipse Reaper', desc:"Entre en forme spectrale, gagne de la vitesse et se soigne sur élimination.", stats:{'Points requis':7,'Soin par élim.':30} },
  }},
  'Rhoven': { title:'Prédateur', abilities:{
    signature:{ name:'Blood Trail', desc:"Les ennemis blessés laissent une trace visible.", stats:{'Durée trace (s)':5,'Recharge (s)':30} },
    a:{ name:'Predator Leap', desc:"Bond agressif vers une position ciblée.", stats:{'Distance (m)':10,'Coût':250} },
    b:{ name:'Savage Fang', desc:"Projectile perforant infligeant des dégâts croissants selon la distance.", stats:{'Dégâts max':60,'Coût':200} },
    ultimate:{ name:'Apex Instinct', desc:"Vision de chasse améliorée et vitesse augmentée pendant plusieurs secondes.", stats:{'Points requis':6,'Durée (s)':8} },
  }},
  'Ignis': { title:'Maître du Feu', abilities:{
    signature:{ name:'Fire Rush', desc:"Dash laissant une traînée incendiaire.", stats:{'Dégâts traînée':10,'Recharge (s)':40} },
    a:{ name:'Ember Grenade', desc:"Grenade créant une zone de feu.", stats:{'Dégâts/s':15,'Coût':200} },
    b:{ name:'Burn Mark', desc:"Marque un ennemi et amplifie les dégâts qu'il subit.", stats:{'Amplification (%)':15,'Coût':150} },
    ultimate:{ name:'Inferno Core', desc:"Déchaîne une immense vague de flammes traversant une zone.", stats:{'Points requis':8,'Dégâts':120} },
  }},
  'Vexal': { title:'Manipulateur du Néant', abilities:{
    signature:{ name:'Rift Step', desc:"Téléportation courte laissant un clone trompeur.", stats:{'Distance (m)':8,'Recharge (s)':40} },
    a:{ name:'Distortion Orb', desc:"Orbe perturbant la vision et les sons.", stats:{'Durée (s)':3,'Coût':200} },
    b:{ name:'Void Spike', desc:"Pic énergétique ralentissant les ennemis.", stats:{'Ralentissement (%)':30,'Coût':200} },
    ultimate:{ name:'Dimension Collapse', desc:"Crée une zone où les ennemis voient leurs positions décalées.", stats:{'Points requis':7,'Durée (s)':10} },
  }},
  'Solmara': { title:'Guerrière Solaire', abilities:{
    signature:{ name:'Sunflare Dash', desc:"Ruée lumineuse aveuglante.", stats:{'Distance (m)':10,'Recharge (s)':35} },
    a:{ name:'Solar Spear', desc:"Lance un javelot solaire explosif.", stats:{'Dégâts':70,'Coût':250} },
    b:{ name:'Radiant Pulse', desc:"Onde lumineuse révélant brièvement les ennemis.", stats:{'Durée révélation (s)':2,'Coût':200} },
    ultimate:{ name:'Solar Ascension', desc:"S'envole temporairement et projette des rayons solaires destructeurs.", stats:{'Points requis':8,'Dégâts/rayon':50} },
  }},
  'Drakko': { title:'Berserker Draconique', abilities:{
    signature:{ name:'Dragon Rush', desc:"Charge destructrice.", stats:{'Distance (m)':11,'Recharge (s)':35} },
    a:{ name:'Scale Burst', desc:"Explosion de fragments draconiques.", stats:{'Dégâts':55,'Coût':200} },
    b:{ name:'Roar', desc:"Cri réduisant temporairement la précision ennemie.", stats:{'Réduction précision (%)':20,'Coût':150} },
    ultimate:{ name:'Dragon Form', desc:"Transformation améliorant dégâts, vitesse et résistance.", stats:{'Points requis':8,'Durée (s)':12} },
  }},
  'Halcyon': { title:'Danseur des Tempêtes', abilities:{
    signature:{ name:'Sky Step', desc:"Bond aérien contrôlé.", stats:{'Distance (m)':10,'Recharge (s)':30} },
    a:{ name:'Gale Slash', desc:"Lame de vent traversante.", stats:{'Dégâts':50,'Coût':200} },
    b:{ name:'Vapor Screen', desc:"Nuage de vapeur instantané.", stats:{'Durée (s)':4,'Coût':200} },
    ultimate:{ name:'Zenith Storm', desc:"Déchaîne une tempête amplifiant sa mobilité et ses dégâts.", stats:{'Points requis':7,'Durée (s)':10} },
  }},
  // --- INITIATEURS ---
  'Sondra': { title:'Maîtresse Sismique', abilities:{
    signature:{ name:'Seismic Pulse', desc:"Onde révélant les ennemis en mouvement.", stats:{'Durée révélation (s)':3,'Recharge (s)':35} },
    a:{ name:'Fault Breaker', desc:"Fissure du sol qui étourdit.", stats:{'Durée étourdissement (s)':1.75,'Coût':250} },
    b:{ name:'Tremor Beacon', desc:"Balise produisant plusieurs secousses.", stats:{'Nombre de secousses':3,'Coût':200} },
    ultimate:{ name:'Cataclysm', desc:"Séisme massif traversant le terrain.", stats:{'Points requis':7,'Dégâts':100} },
  }},
  'Pryzm': { title:'Contrôle de Lumière', abilities:{
    signature:{ name:'Prism Scan', desc:"Cristal révélateur.", stats:{'Durée révélation (s)':5,'Recharge (s)':30} },
    a:{ name:'Refract', desc:"Flash rebondissant sur les surfaces.", stats:{'Durée aveuglement (s)':1.4,'Coût':200} },
    b:{ name:'Spectrum Link', desc:"Relie deux zones pour transmettre l'information détectée.", stats:{'Portée (m)':25,'Coût':200} },
    ultimate:{ name:'Aurora Field', desc:"Champ lumineux révélant périodiquement tous les ennemis présents.", stats:{'Points requis':7,'Durée (s)':10} },
  }},
  'Kestrix': { title:'Fauconnier Tactique', abilities:{
    signature:{ name:'Hawk Drone', desc:"Faucon mécanique contrôlable.", stats:{'Durée vol (s)':8,'Recharge (s)':40} },
    a:{ name:'Talon Strike', desc:"Projectiles plongeants.", stats:{'Dégâts':30,'Coût':200} },
    b:{ name:'Screech', desc:"Cri sonique désorientant.", stats:{'Durée désorientation (s)':2,'Coût':200} },
    ultimate:{ name:'Sky Dominion', desc:"Escadron de drones révélant une vaste zone.", stats:{'Points requis':7,'Nombre de drones':5} },
  }},
  'Marrow': { title:'Nécromancien', abilities:{
    signature:{ name:'Bone Eye', desc:"Œil d'ossements révélateur.", stats:{'Durée révélation (s)':4,'Recharge (s)':35} },
    a:{ name:'Grave Chain', desc:"Chaîne spectrale immobilisante.", stats:{'Durée immobilisation (s)':1.5,'Coût':250} },
    b:{ name:'Soul Echo', desc:"Fantôme qui suit la dernière position connue d'un ennemi.", stats:{'Durée suivi (s)':6,'Coût':200} },
    ultimate:{ name:'Death Recall', desc:"Révèle tous les ennemis ayant infligé ou subi des dégâts récemment.", stats:{'Points requis':6,'Durée révélation (s)':5} },
  }},
  'Voltane': { title:'Éclaireur Électrique', abilities:{
    signature:{ name:'Arc Drone', desc:"Drone de reconnaissance électrique.", stats:{'Durée vol (s)':10,'Recharge (s)':35} },
    a:{ name:'Chain Spark', desc:"Éclair rebondissant entre cibles proches.", stats:{'Dégâts':25,'Coût':200} },
    b:{ name:'Static Cage', desc:"Zone ralentissante électrifiée.", stats:{'Ralentissement (%)':35,'Coût':200} },
    ultimate:{ name:'Thunder Network', desc:"Réseau d'éclairs révélant et perturbant tous les ennemis touchés.", stats:{'Points requis':7,'Durée (s)':8} },
  }},
  'Ashra': { title:'Prophétesse des Cendres', abilities:{
    signature:{ name:'Ash Vision', desc:"Révèle les traces de déplacement récentes.", stats:{'Durée révélation (s)':4,'Recharge (s)':30} },
    a:{ name:'Cinder Flash', desc:"Flash explosant après un délai.", stats:{'Délai (s)':1.2,'Coût':200} },
    b:{ name:'Scorch Mark', desc:"Marque une zone et détecte tout ennemi qui la traverse.", stats:{'Durée (s)':8,'Coût':200} },
    ultimate:{ name:'Ashen Eclipse', desc:"Tempête de cendres réduisant fortement la vision ennemie.", stats:{'Points requis':7,'Durée (s)':9} },
  }},
  // --- CONTRÔLEURS ---
  'Nimbus': { title:'Seigneur des Tempêtes', abilities:{
    signature:{ name:'Storm Cloud', desc:"Fumigène contrôlable.", stats:{'Durée (s)':15,'Recharge (s)':40} },
    a:{ name:'Wind Wall', desc:"Mur de vent.", stats:{'Durée (s)':10,'Coût':200} },
    b:{ name:'Cyclone Orb', desc:"Mini tornade ralentissante.", stats:{'Ralentissement (%)':25,'Coût':200} },
    ultimate:{ name:'Tempest Domain', desc:"Immense tempête divisant le champ de bataille.", stats:{'Points requis':8,'Durée (s)':12} },
  }},
  'Verdane': { title:'Gardien de la Nature', abilities:{
    signature:{ name:'Bloom Fog', desc:"Brume végétale opaque.", stats:{'Durée (s)':15,'Recharge (s)':40} },
    a:{ name:'Root Field', desc:"Zone de racines ralentissantes.", stats:{'Ralentissement (%)':30,'Coût':200} },
    b:{ name:'Thorn Hedge', desc:"Barrière végétale temporaire.", stats:{'Durée (s)':12,'Coût':200} },
    ultimate:{ name:'Wild Expansion', desc:"La végétation envahit un large secteur.", stats:{'Points requis':8,'Durée (s)':14} },
  }},
  'Grael': { title:'Seigneur Minéral', abilities:{
    signature:{ name:'Stone Veil', desc:"Fumée minérale solide.", stats:{'Durée (s)':15,'Recharge (s)':40} },
    a:{ name:'Earth Wall', desc:"Mur de roche segmenté.", stats:{'Durée (s)':13,'Coût':200} },
    b:{ name:'Shatter Zone', desc:"Terrain instable ralentissant.", stats:{'Ralentissement (%)':25,'Coût':200} },
    ultimate:{ name:'Mountain Rise', desc:"Fait émerger plusieurs structures rocheuses massives.", stats:{'Points requis':8,'Nombre de structures':3} },
  }},
  'Mistara': { title:'Reine des Brumes', abilities:{
    signature:{ name:'Veil Mist', desc:"Nuage de brouillard dense.", stats:{'Durée (s)':16,'Recharge (s)':40} },
    a:{ name:'Haze Drift', desc:"Déplacement furtif dans la brume.", stats:{'Distance (m)':8,'Coût':200} },
    b:{ name:'Blur Field', desc:"Champ réduisant fortement la vision.", stats:{'Durée (s)':10,'Coût':200} },
    ultimate:{ name:'Endless Fog', desc:"Recouvre plusieurs secteurs de brouillard.", stats:{'Points requis':8,'Durée (s)':15} },
  }},
  'Obscura': { title:'Maîtresse des Ombres', abilities:{
    signature:{ name:'Dark Sphere', desc:"Sphère obscure traversable.", stats:{'Durée (s)':14,'Recharge (s)':40} },
    a:{ name:'Shadow Gate', desc:"Portail à courte portée.", stats:{'Distance (m)':9,'Coût':200} },
    b:{ name:'Blind Abyss', desc:"Puits d'ombre obscurcissant la vue.", stats:{'Durée aveuglement (s)':1.5,'Coût':250} },
    ultimate:{ name:'Nightfall', desc:"Plonge toute la zone dans l'obscurité.", stats:{'Points requis':8,'Durée (s)':13} },
  }},
  'Corvane': { title:'Corbeau Noir', abilities:{
    signature:{ name:'Raven Smoke', desc:"Fumée mobile guidée par un corbeau spectral.", stats:{'Durée (s)':14,'Recharge (s)':40} },
    a:{ name:'Fear Pulse', desc:"Onde réduisant la précision ennemie.", stats:{'Réduction précision (%)':20,'Coût':200} },
    b:{ name:'Crow Watch', desc:"Corbeau révélateur stationnaire.", stats:{'Durée révélation (s)':6,'Coût':200} },
    ultimate:{ name:'Black Flight', desc:"Nuée de corbeaux révélant et affaiblissant les ennemis.", stats:{'Points requis':7,'Durée (s)':9} },
  }},
  // --- SENTINELLES ---
  'Sentra': { title:'Ingénieure Défensive', abilities:{
    signature:{ name:'Guardian Turret', desc:"Tourelle automatique.", stats:{'Dégâts/tir':20,'Recharge (s)':40} },
    a:{ name:'Sensor Mine', desc:"Mine détectrice.", stats:{'Durée révélation (s)':5,'Coût':200} },
    b:{ name:'Barrier Grid', desc:"Mur énergétique modulable.", stats:{'Durée (s)':20,'Coût':200} },
    ultimate:{ name:'Fortress Protocol', desc:"Déploie automatiquement plusieurs systèmes défensifs.", stats:{'Points requis':7,'Nombre de systèmes':3} },
  }},
  'Warden': { title:'Protecteur', abilities:{
    signature:{ name:'Bulwark Shield', desc:"Bouclier déployable.", stats:{'Points de vie bouclier':80,'Recharge (s)':35} },
    a:{ name:'Shock Restraint', desc:"Piège immobilisant.", stats:{'Durée immobilisation (s)':3,'Coût':200} },
    b:{ name:'Sentinel Mark', desc:"Marque les intrus traversant une zone.", stats:{'Durée révélation (s)':6,'Coût':150} },
    ultimate:{ name:'Last Bastion', desc:"Fortification renforçant les alliés proches.", stats:{'Points requis':7,'Bonus armure':25} },
  }},
  'Bastian': { title:'Expert en Sécurité', abilities:{
    signature:{ name:'Surveillance Node', desc:"Caméra tactique.", stats:{'Portée vision (m)':30,'Recharge (s)':40} },
    a:{ name:'Alarm Net', desc:"Filet de détection.", stats:{'Durée (s)':25,'Coût':200} },
    b:{ name:'Pulse Barrier', desc:"Barrière de ralentissement.", stats:{'Ralentissement (%)':30,'Coût':200} },
    ultimate:{ name:'Lockdown Matrix', desc:"Verrouille une vaste zone défensive.", stats:{'Points requis':8,'Durée (s)':8} },
  }},
  'Locke': { title:'Geôlier Tactique', abilities:{
    signature:{ name:'Capture Trap', desc:"Piège immobilisant.", stats:{'Durée immobilisation (s)':2.5,'Recharge (s)':35} },
    a:{ name:'Containment Wall', desc:"Mur énergétique.", stats:{'Durée (s)':18,'Coût':200} },
    b:{ name:'Detention Beacon', desc:"Balise révélant les ennemis approchant.", stats:{'Durée révélation (s)':6,'Coût':200} },
    ultimate:{ name:'Maximum Security', desc:"Empêche temporairement l'utilisation des compétences dans une zone.", stats:{'Points requis':8,'Durée (s)':7} },
  }},
  'Thorne': { title:'Gardien Sauvage', abilities:{
    signature:{ name:'Root Trap', desc:"Piège de racines.", stats:{'Durée immobilisation (s)':2,'Recharge (s)':35} },
    a:{ name:'Thorn Patch', desc:"Zone de dégâts continus.", stats:{'Dégâts/s':10,'Coût':200} },
    b:{ name:'Vine Wall', desc:"Mur végétal bloquant la vision.", stats:{'Durée (s)':15,'Coût':200} },
    ultimate:{ name:'Overgrowth', desc:"Immenses racines immobilisant tous les ennemis touchés.", stats:{'Points requis':8,'Durée immobilisation (s)':3} },
  }},
};
// Rôle "principal" de chaque agent (le premier rôle non-Flex dans lequel il
// apparaît), utilisé pour l'affichage groupé et l'historique d'équilibrage.
const AGENT_ROLE_LOOKUP = {};
['Duelliste','Initiateur','Contrôleur','Sentinelle'].forEach(role=>{
  VALORANT_AGENTS_BY_ROLE[role].forEach(name=>{ if(!AGENT_ROLE_LOOKUP[name]) AGENT_ROLE_LOOKUP[name] = role; });
});
function agentBaseStat(agent, abilityKey, statName){
  const kit = AGENT_KITS[agent];
  return kit && kit.abilities[abilityKey] ? kit.abilities[abilityKey].stats[statName] : undefined;
}
// Store des ajustements de patch en vigueur : { "Agent.abilityKey.statName": valeur }
function ensureAgentBalance(){
  const meta = ensureMeta();
  if(!meta.agentOverrides) meta.agentOverrides = {};
  if(!meta.balanceChanges) meta.balanceChanges = [];
  return meta;
}
// Valeur EFFECTIVE d'une statistique de sort : la valeur de base, sauf si
// un patch l'a modifiée depuis (voir applyScheduledPatch).
function currentAgentStat(agent, abilityKey, statName){
  const meta = ensureAgentBalance();
  const key = `${agent}.${abilityKey}.${statName}`;
  return meta.agentOverrides[key]!==undefined ? meta.agentOverrides[key] : agentBaseStat(agent, abilityKey, statName);
}

/* ---- Roster d'agents disponibles ----
   Au lancement d'une partie, seuls 3 à 4 agents par rôle sont disponibles
   (tirage aléatoire, différent à chaque nouvelle partie) ; les autres
   rejoignent une réserve et sont ajoutés au roster un par un, à chaque
   patch MAJEUR (voir releaseNextAgent / applyScheduledPatch). */
const AGENT_ROSTER_ROLES = ['Duelliste','Initiateur','Contrôleur','Sentinelle'];
function initAgentRoster(){
  const released = [];
  const pending = [];
  AGENT_ROSTER_ROLES.forEach(role=>{
    const pool = shuffle([...VALORANT_AGENTS_BY_ROLE[role]]);
    const count = Math.min(pool.length, randInt(3,4));
    released.push(...pool.slice(0,count));
    pending.push(...pool.slice(count));
  });
  state.agentRoster = { released, pending: shuffle(pending) };
}
// Migration : les parties déjà en cours avant l'introduction de ce système
// conservent tous les agents disponibles (rien ne doit se reverrouiller
// sous un effectif déjà constitué).
function ensureAgentRoster(){
  if(!state.agentRoster){
    state.agentRoster = { released: Object.keys(AGENT_KITS), pending: [] };
  }
  return state.agentRoster;
}
function isAgentReleased(name){ return ensureAgentRoster().released.includes(name); }
// Fait rejoindre le roster disponible au prochain agent de la réserve (le
// tirage a déjà été mélangé une fois pour toutes à initAgentRoster) —
// renvoie son nom, ou null si tous les agents sont déjà sortis.
function releaseNextAgent(){
  const roster = ensureAgentRoster();
  if(!roster.pending.length) return null;
  const name = roster.pending.shift();
  roster.released.push(name);
  return name;
}
function agentPoolForRole(role){
  const pool = VALORANT_AGENTS_BY_ROLE[role] || VALORANT_AGENTS_BY_ROLE['Flex'];
  const roster = ensureAgentRoster();
  const releasedPool = pool.filter(a=>roster.released.includes(a));
  return releasedPool.length ? releasedPool : pool;
}

// Mappe une nationalité vers l'une des 4 régions VST (indépendant du
// mapping continental utilisé pour la règle imports/résidents des clubs).
const NATIONALITY_TO_VCT_REGION = {
  'France':'emea','Allemagne':'emea','Angleterre':'emea','Espagne':'emea','Suède':'emea','Danemark':'emea','Pologne':'emea','Finlande':'emea','Pays-Bas':'emea','Turquie':'emea','Russie':'emea',
  'Corée du Sud':'pacific','Japon':'pacific','Chine':'china','USA':'americas','Canada':'americas','Brésil':'americas',
  'Mexique':'americas','Argentine':'americas',
  'Indonésie':'pacific','Philippines':'pacific','Inde':'pacific','Australie':'pacific','Thaïlande':'pacific',
};
function nationalityVCTRegion(nationality){
  const clean = (nationality||'').replace(/^\S+\s/, '');
  return NATIONALITY_TO_VCT_REGION[clean] || 'emea';
}
// Répartition des nationalités par région VST (déduite de la table
// ci-dessus) — sert à générer un ladder mondial dont la nationalité des
// joueurs correspond réellement à la région qui leur est assignée. Sans
// cela, tirer une nationalité totalement au hasard (majoritairement
// européenne dans la liste) videbait presque toutes les régions autres
// que l'EMEA du classement Ranked, la nationalité ne correspondant que
// rarement à la région du ladder.
const NATIONALITIES_BY_VCT_REGION = (()=>{
  const map = { emea:[], americas:[], pacific:[], china:[] };
  NATIONALITIES.forEach(n=>{
    const region = nationalityVCTRegion(n);
    (map[region] || map.emea).push(n);
  });
  return map;
})();

function emptyRankedStats(){ return { matches:0, wins:0, losses:0, kills:0, deaths:0, assists:0 }; }

// RR de départ dérivé du NIVEAU réel du joueur plutôt qu'un point de départ
// unique (1800 = Immortal 1) pour tout le monde — demande explicite : le
// ladder doit rester cohérent avec le niveau, pas un tirage au sort par-
// dessus un point de départ identique pour un scrub de niveau 15 et une
// star de niveau 95. -300 = plancher Iron 1, +2400 = Radiant (voir
// buildRankLadder) : mappe linéairement le niveau (1-99) sur cette
// amplitude, avec un peu de bruit (±120) pour éviter que deux joueurs de
// même niveau démarrent pile sur la même valeur. Une fois ce point de
// départ posé, la simulation quotidienne (simulateRankedMatchForPlayer)
// continue de faire évoluer la RR de façon réaliste au fil des parties —
// c'est elle qui gérait TOUT l'écart avant ce correctif, ce qui demandait
// des mois de parties simulées pour qu'un vrai pro dépasse un agent libre
// médiocre parti de la même case.
function seedRankedRRFromLevel(level){
  const base = -300 + ((level||50)/99)*2400;
  return Math.max(-300, Math.round(base + randInt(-120,120)));
}
function ensurePlayerRanked(p){
  if(!p.ranked){
    p.ranked = { region: choice(VALORANT_RANKED_REGIONS), rr:seedRankedRRFromLevel(p.level), stats:emptyRankedStats(), agents:{}, tier1RegionYears:0 };
  }
  return p.ranked;
}

// Simule un match de Ranked Solo Queue pour un joueur donné, avec une
// probabilité de jouer ce jour-là (les agents libres jouent plus souvent
// que les joueurs pros sous contrat, cf. playProbability appelant).
function simulateRankedMatchForPlayer(p, playProbability){
  ensurePlayerRanked(p);
  if(Math.random() > playProbability) return;
  const r = p.ranked;
  // Plage de compétence resserrée vers le bas pour Valostrike GC
  // (p.economyScale<1, voir genPlayer) — pas seulement les quelques profils
  // d'élite plafonnés plus tôt : LA MAJORITÉ des joueuses GC (celles au
  // niveau modeste, comme la majorité du vivier — voir WORLD_LEVEL_TIERS_GC,
  // script.js, qui rend déjà les hauts niveaux nettement plus rares côté
  // GC) restent aussi statistiquement moins performantes en Ranked que
  // l'équivalent Valostrike classique, pas seulement les meilleures.
  // Ensemble, ces deux réglages produisent l'écart de compétitivité voulu :
  // beaucoup plus dur pour une joueuse GC d'atteindre le sommet du ladder
  // unifié, sans jamais l'exclure — juste beaucoup moins probable.
  const isGC = p.economyScale && p.economyScale<1;
  const skillMin = isGC ? 0.15 : 0.25;
  const skillMax = isGC ? 0.55 : 0.85;
  const skill = Math.max(skillMin, Math.min(skillMax, ((p.level||60)-40)/80));
  const win = Math.random() < (0.42 + skill*0.22);
  const delta = win ? randInt(18,26) : -randInt(14,22);
  r.rr = Math.max(-300, r.rr + delta);
  r.stats.matches += 1;
  if(win) r.stats.wins += 1; else r.stats.losses += 1;
  // Même comportement en jeu que les matchs officiels (voir
  // VALORANT_ROLE_MODIFIERS) : un Duelliste sort plus de kills, un
  // Initiateur plus d'assists, une Sentinelle meurt moins souvent, etc. —
  // avant, le Ranked ignorait complètement le rôle du joueur.
  const mod = VALORANT_ROLE_MODIFIERS[p.role] || VALORANT_ROLE_MODIFIERS.Flex;
  r.stats.kills += Math.max(0, Math.round(randInt(10,24) * (0.6+skill) * mod.killsMult));
  r.stats.deaths += Math.max(0, Math.round(randInt(9,19) * mod.deathsMult));
  r.stats.assists += Math.max(0, Math.round(randInt(2,9) * mod.assistsMult));
  const agent = choice(agentPoolForRole(p.role));
  r.agents[agent] = (r.agents[agent]||0) + 1;
}

// Simulation quotidienne de la Solo Queue pour l'ensemble de l'écosystème
// Valorant connu (votre effectif, l'académie, les rosters rivaux, le
// ladder mondial et les agents libres déjà scoutés) — et pour Valostrike
// GC de la même façon, à l'exception des rosters rivaux : la GC n'a pas
// (encore) de ligue/state.vct assignant une équipe rivale à une région.
function simulateRankedSoloQueueDay(){
  if(!state.sections) return;
  ['valorant','valorant_gc'].forEach(gameId=>{
    if(!state.sections.includes(gameId)) return;
    (state.squads[gameId]||[]).forEach(p=> simulateRankedMatchForPlayer(p, 0.25));
    (state.academies[gameId]||[]).forEach(p=> simulateRankedMatchForPlayer(p, 0.3));
    if(gameId==='valorant'){
      (state.standings.valorant||[]).filter(t=>!t.self).forEach(t=>{
        (t.roster||[]).forEach(p=> simulateRankedMatchForPlayer(p, 0.25));
      });
      // Pros Tier 1 déjà signés (voir ensureSignedProPool) : jouent le
      // ranked comme entraînement à peu près aussi souvent qu'un joueur
      // rival sous contrat (même probabilité que la ligne au-dessus).
      ensureSignedProPool().forEach(p=> simulateRankedMatchForPlayer(p, 0.25));
    }
    ensureWorldLadder(gameId).forEach(p=> simulateRankedMatchForPlayer(p, 0.65));
  });
}

function rankedStatsDisplay(p){
  const s = (p.ranked && p.ranked.stats) || emptyRankedStats();
  const wr = s.matches>0 ? Math.round((s.wins/s.matches)*100) : 0;
  const kda = s.deaths>0 ? +((s.kills+s.assists)/s.deaths).toFixed(2) : +(s.kills+s.assists).toFixed(2);
  const rating = s.matches>0 ? +(1 + ((s.kills-s.deaths)/Math.max(1,s.matches))/8).toFixed(2) : 1.00;
  return { ...s, wr, kda, rating };
}
// Contrairement à rankedStatsDisplay (Ranked Solo Queue, indépendant des
// compétitions officielles), ceci calcule le rating/KDA à partir des seules
// statistiques accumulées en matchs officiels (p.seasonStats).
function officialStatsDisplay(p){
  const s = p.seasonStats || emptySeasonStats();
  const kda = s.deaths>0 ? +((s.kills+s.assists)/s.deaths).toFixed(2) : +(s.kills+s.assists).toFixed(2);
  const rawRating = s.matches>0 ? 1 + ((s.kills-s.deaths)/s.matches)/10 + (s.mvp/s.matches)*0.3 : 1.00;
  const rating = +Math.max(0.10, rawRating).toFixed(2);
  return { ...s, kda, rating };
}
function topAgents(p, n=3){
  const agents = (p.ranked && p.ranked.agents) || {};
  return Object.entries(agents).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([name,count])=>({ name, count }));
}
// Classement complet des agents d'un joueur (Ranked Solo Queue), par nombre
// de parties jouées — soit filtré sur son rôle (roleFilter), soit tous
// agents confondus. Un joueur Flex n'a pas de rôle fixe : seul le
// classement général a du sens pour lui (voir renderProfileTabContent).
function agentRankingForPlayer(p, roleFilter=null){
  const agents = (p.ranked && p.ranked.agents) || {};
  let entries = Object.entries(agents);
  if(roleFilter) entries = entries.filter(([name])=> (VALORANT_AGENTS_BY_ROLE[roleFilter]||[]).includes(name));
  return entries.sort((a,b)=>b[1]-a[1]).map(([name,count],i)=>({ rank:i+1, name, count }));
}
function renderAgentRankingTable(rows, icon, title, sub, showRole=false){
  return `
    <div class="profile-section-title" style="margin-top:14px;"><i class="fa-solid ${icon}"></i> ${title}${sub ? ` <span class="profile-section-sub">${sub}</span>` : ''}</div>
    ${rows.length ? `
      <div class="agent-ranking-list">
        ${rows.map(r=>`
          <div class="agent-ranking-row ${r.rank===1?'top':''}">
            <span class="agent-ranking-rank">#${r.rank}</span>
            <span class="agent-ranking-name">${r.name}</span>
            ${showRole ? `<span class="badge ${roleBadgeClass(agentRoleByName(r.name))}">${agentRoleByName(r.name)}</span>` : ''}
            <span class="agent-ranking-count">${r.count} partie${r.count>1?'s':''}</span>
          </div>
        `).join('')}
      </div>
    ` : `<div class="empty-state" style="padding:16px;"><div>Aucune partie jouée pour l'instant.</div></div>`}
  `;
}

// Statut visuel natif / import / résident pour une région donnée. Un
// joueur devient résident après 2 années complètes en club VST Tier 1
// dans cette région, et ne compte alors plus comme import.
function playerResidencyStatus(p, region){
  if(nationalityVCTRegion(p.nationality) === region) return { label:'Natif', cls:'badge-green' };
  if((p.ranked && p.ranked.tier1RegionYears>=2)) return { label:'Résident', cls:'badge-blue' };
  return { label:'Import', cls:'badge-orange' };
}

function myValorantRegion(){
  if(!state.vct) return 'emea';
  return state.vct.tier===1 ? state.vct.region : 'emea';
}
// Détermine la région VST Tier 1 d'une équipe rivale d'après les rosters
// officiels ; les ligues Challengers (Tier 2) actuellement implémentées
// sont toutes rattachées à l'EMEA.
function rivalValorantRegion(teamName){
  for(const region of VALORANT_RANKED_REGIONS){
    if((VCT_TIER1[region]||[]).includes(teamName)) return region;
  }
  return 'emea';
}

// Vivier de joueurs déjà SIGNÉS en équipe VST International (Tier 1) —
// demande explicite : le haut du ladder Ranked doit être dominé par des
// pros sous contrat (~95%), le reste étant SOUVENT (pas systématiquement)
// de jeunes agents libres/pépites. Avant ce vivier, le ladder ne pouvait
// tirer de "pros" que du roster rival du joueur (une poignée d'équipes
// Challengers, niveau modeste) — les 300 agents libres du vivier mondial
// (voir ensureWorldLadder), bien plus nombreux, finissaient de facto par
// dominer le sommet malgré leur niveau globalement plus faible, juste par
// la loi des grands nombres (quelques pépites naturelles sur 300 tirages).
// Contrairement à ensureWorldLadder, ce vivier n'alimente JAMAIS
// mercatoFreeAgentPool (qui ne lit que state.worldLadders) : ces joueurs
// sont déjà sous contrat ailleurs, seulement AFFICHÉS dans le ladder,
// jamais recrutables. Pas d'effectif complet par équipe (staff, etc.) —
// juste assez de joueurs pour peupler le ladder, comme les équipes de
// fond du World Hub (voir makeWorldTeam) qui n'ont pas non plus de vrai
// roster pour les mêmes raisons de coût.
const VCT_TIER1_PRO_LEVEL_TIERS = [
  { range:[62,70], weight:10 },  // pro Tier 1 en délicatesse
  { range:[71,80], weight:35 },  // pro solide, coeur de la distribution
  { range:[81,88], weight:35 },  // très bon pro / élite
  { range:[89,95], weight:16 },  // top du circuit
  { range:[96,99], weight:4 },   // superstar mondiale
];
function genTier1ProLevel(){
  const tier = pickWeightedTier(VCT_TIER1_PRO_LEVEL_TIERS);
  return randInt(tier.range[0], tier.range[1]);
}
function ensureSignedProPool(){
  if(!state.signedProPools) state.signedProPools = {};
  if(!state.signedProPools.valorant){
    const players = [];
    VALORANT_RANKED_REGIONS.forEach(region=>{
      (VCT_TIER1[region]||[]).forEach(teamName=>{
        for(let i=0;i<5;i++){
          const nationality = choice(NATIONALITIES_BY_VCT_REGION[region]);
          const p = genPlayer('valorant', choice(GAMES.valorant.roles), [18,30], genTier1ProLevel(), nationality);
          ensurePlayerRanked(p);
          p.ranked.region = region;
          p.teamName = teamName;
          players.push(p);
        }
      });
    });
    state.signedProPools.valorant = players;
  }
  state.signedProPools.valorant.forEach(p=>{ if(!p.gender) p.gender = genPlayerGender('valorant'); });
  return state.signedProPools.valorant;
}

// Ladder Ranked UNIFIÉ Valostrike/Valostrike GC — un seul et même
// classement quelle que soit la section depuis laquelle on le consulte
// (voir renderValorantRankedTab, appelé avec gameId='valorant' ou
// 'valorant_gc' : les deux affichent désormais exactement les mêmes
// lignes), cohérent avec le vrai jeu — le matchmaking Ranked de Valorant
// est unique, la Game Changers n'est qu'un circuit esport à côté, jamais
// un serveur ranked séparé. `gameId` ne sert donc plus qu'à retrouver
// l'état d'UI propre à la page appelante (région sélectionnée), plus à
// filtrer les données elles-mêmes.
// Les joueuses GC y apparaissent avec un niveau généré nettement plus bas
// (voir WORLD_LEVEL_TIERS_GC, script.js) : elles grimpent donc beaucoup
// moins facilement vers le haut du ladder, sans jamais en être exclues —
// exactement l'écart de compétitivité demandé entre les deux circuits.
function collectRankedPool(gameId, region){
  ensureWorldLadder('valorant');
  ensureWorldLadder('valorant_gc');
  const rows = [];
  if(state.sections.includes('valorant') && myValorantRegion()===region){
    (state.squads.valorant||[]).forEach(p=>{
      ensurePlayerRanked(p);
      rows.push({ player:p, teamName:state.org.name, isMine:true, context:'squad' });
    });
  }
  if(state.sections.includes('valorant_gc') && myValorantGCRegion()===region){
    (state.squads.valorant_gc||[]).forEach(p=>{
      ensurePlayerRanked(p);
      rows.push({ player:p, teamName:state.org.name, isMine:true, context:'squad' });
    });
  }
  // Rosters rivaux : Valostrike classique uniquement — sans state.vct/ligue
  // GC, il n'existe pas encore de notion d'équipe rivale rattachée à une
  // région pour la GC (voir le plan de ce chantier).
  (state.standings.valorant||[]).filter(t=>!t.self).forEach(t=>{
    if(rivalValorantRegion(t.name)!==region) return;
    // ensureTeamRoster : sans cet appel, une équipe rivale jamais consultée
    // (aucun clic sur sa fiche) garde un roster vide et contribue ZÉRO
    // joueur au ladder — c'est ce qui laissait le ladder Ranked sans aucun
    // pro local tant que le joueur n'avait pas ouvert chaque fiche d'équipe.
    ensureTeamRoster('valorant', t);
    (t.roster||[]).forEach(p=>{
      ensurePlayerRanked(p);
      rows.push({ player:p, teamName:t.name, isMine:false, context:'rival' });
    });
  });
  // Pros Tier 1 déjà signés (voir ensureSignedProPool ci-dessus) — c'est
  // eux qui doivent dominer le sommet du ladder, pas les agents libres.
  ensureSignedProPool().forEach(p=>{
    if(p.ranked.region!==region) return;
    rows.push({ player:p, teamName:p.teamName, isMine:false, context:'signedPro' });
  });
  ['valorant','valorant_gc'].forEach(gid=>{
    ensureWorldLadder(gid).forEach(p=>{
      ensurePlayerRanked(p);
      if(p.ranked.region!==region) return;
      // Tous les agents libres du mercato mondial assignés à cette région
      // apparaissent dans son ladder Ranked, quelle que soit leur nationalité.
      rows.push({ player:p, teamName:p.teamName||'Agent libre', isMine:false, context:'world' });
    });
  });
  return rows;
}

// Construit le ladder complet d'une région, triée par RR, avec calcul du
// rang régional et de la règle Radiant (RR suffisant ET Top 50 régional
// requis — sinon retombée automatique à Immortal 3).
function computeRegionalLadder(gameId, region){
  const rows = collectRankedPool(gameId, region);
  rows.forEach(r=> r.rr = r.player.ranked.rr);
  rows.sort((a,b)=> b.rr - a.rr);
  rows.forEach((r,i)=>{
    r.regionalRank = i+1;
    const raw = rankTierForRR(r.rr);
    r.displayTier = (raw.tier==='Radiant' && r.regionalRank>50)
      ? { tier:'Immortal', division:3, floor:raw.floor }
      : raw;
  });
  return rows;
}

