/* ============================================================
   ROCKETLEAGUE.JS, code strictement exclusif à la section Rocket
   League. Chargé après script.js et valorant.js (voir index.html),
   dans le même contexte global classique (pas de modules ES) : toutes
   les fonctions et constantes ci-dessous restent appelables depuis
   script.js exactement comme si elles y étaient toujours définies.

   Construit sur le même modèle que valorant.js : une cellule de staff
   DÉDIÉE à Rocket League (state.rocketleagueStaff), indépendante du
   staff d'organisation et de celle de Valorant. Les 5 intitulés de
   poste (Head Coach, Assistant Coach, Recruteur, Médecin, Psychologue
   Sportif) sont volontairement identiques à ceux de Valorant : leurs
   attributs/impacts (ROLE_META, script.js) sont déjà génériques et
   réutilisables tels quels, inutile de dupliquer cette métadonnée.
   Le "scope" ('rocketleague') suffit à distinguer les deux cellules
   partout où c'est nécessaire (voir dedicatedStaffStore/Market dans
   script.js, ainsi que le data-staff-scope propagé sur les fiches).
   ============================================================ */

/* ---- Cellule de staff dédiée Rocket League (indépendante du staff
   partagé d'organisation ET de la cellule Valorant) ---- */
const ROCKETLEAGUE_STAFF_ROLES = ['Head Coach','Assistant Coach','Recruteur','Médecin','Psychologue Sportif'];

function ensureRocketleagueStaff(){
  if(!state.rocketleagueStaff) state.rocketleagueStaff = {};
  backfillHiredStaffGender(state.rocketleagueStaff);
  return state.rocketleagueStaff;
}

// Bonus concret de victoire apporté par le staff Rocket League dédié : le
// Head Coach (stratégie/performance) et le Psychologue Sportif (stabilité
// mentale) augmentent réellement la probabilité de victoire en match —
// même mécanique que valorantStaffMatchBonus, appliquée à ce roster-ci.
function rocketleagueStaffMatchBonus(gameId, staffOverride){
  if(gameId!=='rocketleague') return 0;
  const staff = staffOverride || ensureRocketleagueStaff();
  const coach = staff['Head Coach'];
  const psy = staff['Psychologue Sportif'];
  let bonus = 0;
  if(coach) bonus += (coach.level/100) * 0.08; // jusqu'à +8% avec un Head Coach niveau 100
  if(psy) bonus += (psy.level/100) * 0.04;      // jusqu'à +4% supplémentaires
  return bonus;
}
// Réduction de fatigue quotidienne apportée par le Médecin (0 à 30% de
// réduction selon son niveau).
function rocketleagueMedecinFatigueReduction(){
  const m = ensureRocketleagueStaff()['Médecin'];
  return m ? (m.level/100) * 0.3 : 0;
}

function rocketleagueStaffCard(role){
  const store = ensureRocketleagueStaff();
  const m = store[role];
  const displayName = staffRoleDisplayName(role);
  if(!m){
    return `
      <div class="staff-empty-slot" data-role="${escapeAttr(role)}">
        <i class="fa-solid fa-user-plus" style="font-size:20px;"></i>
        <div style="font-weight:600;font-size:13px;">${displayName}</div>
        <button class="btn btn-sm goto-section-tab-btn" data-game="rocketleague" data-tab="mercato"><i class="fa-solid fa-cart-shopping"></i> Voir sur le marché</button>
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
          <div class="staff-name">${staffNameLinkHired(role, m.name, 'rocketleague')}</div>
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
        <button class="btn btn-danger btn-sm rocketleague-staff-fire-btn" data-role="${escapeAttr(role)}"><i class="fa-solid fa-user-minus"></i> Licencier</button>
      </div>
    </div>
  `;
}

function fireRocketleagueStaff(role){
  const store = ensureRocketleagueStaff();
  const m = store[role];
  if(!m) return;
  const severance = Math.round(m.salary * 2);
  if(sectionBudget('rocketleague') < severance){
    toast(`Budget alloué à Rocket Champ insuffisant pour l'indemnité de départ (${formatMoney(severance)} nécessaires).`, 'error');
    return;
  }
  openConfirmActionModal({
    title: 'Licencier ce membre du staff ?',
    body: `Licencier <b>${m.name}</b> coûtera une indemnité de départ de <b>${formatMoney(severance)}</b> (2 mois de salaire).`,
    confirmLabel: '<i class="fa-solid fa-user-minus"></i> Licencier',
    onConfirm: ()=>{
      state.budget -= severance;
      spendFromSectionBudgetIfActive('rocketleague', severance);
      recordTransaction('rocketleague', 'severance', `Indemnité de départ, ${m.name}`, -severance);
      pushNotification(`${m.name} quitte la cellule Rocket Champ (indemnité : ${formatMoney(severance)}).`);
      pushNews(`${m.name} quitte ${state.org.name} après son licenciement.`);
      toast(`${m.name} licencié(e).`, 'info');
      delete store[role];
      saveState();
      renderTopbar();
      renderSectionPage('rocketleague', 'staff');
    },
  });
}

// Marché dédié à la cellule de staff Rocket League — indépendant du
// marché du staff d'organisation ET de celui de Valorant, même logique
// de renouvellement et même règle : les candidats restent visibles
// même une fois le poste pourvu.
let rocketleagueStaffMarket = null;

function ensureRocketleagueStaffMarket(){
  if(!rocketleagueStaffMarket) rocketleagueStaffMarket = [];
  ROCKETLEAGUE_STAFF_ROLES.forEach(role=>{
    const existingCount = rocketleagueStaffMarket.filter(c=>c.role===role).length;
    for(let i=existingCount; i<STAFF_MARKET_POOL_SIZE; i++) rocketleagueStaffMarket.push(genStaffCandidate(role));
  });
  backfillStaffMarketGender(rocketleagueStaffMarket);
  return rocketleagueStaffMarket;
}

const ROCKETLEAGUE_STAFF_SORT_OPTIONS = ROCKETLEAGUE_STAFF_ROLES;
// Rendu des cartes du marché du staff Rocket League (même gabarit visuel
// que renderStaffMarketCards / renderValorantStaffMarketCards, mais rôles
// et libellés propres à la cellule Rocket League).
function renderRocketleagueStaffMarketCards(filterQuery='', pageKey='rocketleagueStaffMercato'){
  ensureRocketleagueStaffMarket();
  const q = (filterQuery||'').toLowerCase();
  const roleFilter = getStaffRoleFilter(pageKey);
  let filtered = q ? rocketleagueStaffMarket.filter(c=>{
    const displayName = (c.pseudo||c.name) || '';
    return displayName.toLowerCase().includes(q) || staffRoleDisplayName(c.role).toLowerCase().includes(q);
  }) : rocketleagueStaffMarket;
  if(roleFilter!=='all') filtered = filtered.filter(c=>staffRoleFilterMatches(c.role, roleFilter));
  const extraFilters = getStaffExtraFilters(pageKey);
  filtered = filtered.filter(c=>staffMatchesExtraFilters(c, extraFilters));
  filtered = sortMercatoRows(filtered, (c,key)=>c[key], mercatoStaffUIState.sortKey, mercatoStaffUIState.sortDir);
  const { items, page, totalPages, total } = paginate(filtered, pageKey, STAFF_CARDS_PAGE_SIZE);
  const rowsHtml = items.map(c=>{
    const displayName = c.pseudo || c.name;
    const currentHolder = ensureRocketleagueStaff()[c.role] ? ensureRocketleagueStaff()[c.role].name : null;
    return staffMarketRowHtml('rocketleague', c, displayName, staffRoleDisplayName(c.role), currentHolder, 'buy-rocketleague-staff-btn');
  }).join('');
  return {
    cardsHtml: staffMarketListHtml(rowsHtml),
    paginationHtml: renderPaginationBar(pageKey, page, totalPages, total, STAFF_CARDS_PAGE_SIZE),
    sortBarHtml: renderStaffRoleSortBar(pageKey, ROCKETLEAGUE_STAFF_SORT_OPTIONS, ROCKETLEAGUE_STAFF_ROLES),
  };
}

function bindRocketleagueStaffMarketBuyButtons(onDone, pageKey='rocketleagueStaffMercato'){
  document.querySelectorAll('.buy-rocketleague-staff-btn').forEach(btn=>{
    btn.onclick = ()=> openStaffNegotiation('rocketleague', btn.dataset.id);
  });
  bindPaginationBar(pageKey, onDone);
  bindStaffRoleSortBar(pageKey, onDone, ROCKETLEAGUE_STAFF_SORT_OPTIONS, ROCKETLEAGUE_STAFF_ROLES);
}
