/* ============================================================
   character_assets_babylon.js — MODÈLE DE PERSONNAGE PARTAGÉ

   Même rôle que map_assets_babylon.js pour les cartes : un seul endroit qui
   sait fabriquer un personnage, utilisé par l'éditeur (character_editor.html)
   et, à terme, par le moteur de match.

   ------------------------------------------------------------
   POURQUOI L'ANCIENNE SILHOUETTE NE RESSEMBLAIT PAS À UN HUMAIN
   ------------------------------------------------------------
   Le personnage du moteur mesure 1,32 de haut pour 0,56 de large aux
   épaules — soit 42 % de sa hauteur. Un humain réel est à ~24 %. Il lisait
   donc comme un tonneau, avec des bras posés à côté du corps plutôt que
   reliés à lui. Trois autres causes s'ajoutaient :
     - un torse en CÔNE (cylindre 0.27 → 0.22) plus large en haut, alors
       qu'un buste humain se resserre à la taille ;
     - des membres en cylindres à 8 faces, tubes rigides sans articulation ;
     - une échelle de ~4 têtes de haut (proportion d'enfant) au lieu de 7,5.

   La construction ci-dessous repose donc sur un vrai canon anatomique
   (table LANDMARKS). Le tronc, la tête ET les membres sont des surfaces de
   révolution à profil dessiné (voir LIMB_PROFILES) : une seule peau continue
   par segment, dont la masse musculaire est placée au bon endroit et dont
   les articulations sont des RÉTRÉCISSEMENTS. La hauteur totale reste 1,32 :
   c'est la valeur sur laquelle sont calés le cadrage caméra, l'anneau au sol
   et les collisions du moteur, la changer casserait le jeu.

   ------------------------------------------------------------
   ÉTAT DU BRANCHEMENT
   ------------------------------------------------------------
   Le moteur de match n'appelle PAS encore ce module : il tourne toujours sur
   son propre buildMesh(). C'est volontaire — valorant_match_engine.js porte
   du travail en cours non commité, et y faire ce refactor maintenant
   chercherait la collision.

   ATTENTION, ce module n'est plus un portage à l'identique : l'anatomie a
   été refaite. Au rebranchement, l'apparence des agents en match CHANGERA
   (c'est le but), il ne s'agira donc pas d'un simple déplacement de code.

   Autre écart assumé : la teinte de peau. Le moteur la tire au Math.random()
   à chaque construction, donc un agent change de teint à chaque
   reconstruction. Ici elle dérive d'une graine — même personnage, même peau.
   ============================================================ */
window.CharacterAssets = (function(){
  'use strict';

  /* ---------- Couleurs ---------- */
  function hexToColor3(hex){
    if(hex && hex.r !== undefined) return hex;
    return BABYLON.Color3.FromHexString('#'+(hex>>>0).toString(16).padStart(6,'0'));
  }
  function color3ToHex(c){
    const to = v => Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0');
    return '#'+to(c.r)+to(c.g)+to(c.b);
  }
  function colorToHSL(c){
    const r=c.r,g=c.g,b=c.b;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h=0,s=0; const l=(max+min)/2;
    if(max!==min){
      const d=max-min;
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h=(g-b)/d+(g<b?6:0); break;
        case g: h=(b-r)/d+2; break;
        case b: h=(r-g)/d+4; break;
      }
      h/=6;
    }
    return {h,s,l};
  }
  function hslToColor3(h,s,l){
    h=((h%1)+1)%1;
    let r,g,b;
    if(s===0){ r=g=b=l; }
    else {
      const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
      const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
      r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3);
    }
    return new BABYLON.Color3(r,g,b);
  }

  /* ---------- Matériaux ---------- */
  function mkMat(scene, name, color, opts={}){
    const m = new BABYLON.PBRMaterial(name, scene);
    m.albedoColor = hexToColor3(color);
    m.alpha = opts.opacity ?? 1;
    m.roughness = opts.roughness ?? 0.8;
    m.metallic = opts.metalness ?? 0;
    m.metadata = { roughness: m.roughness, metalness: m.metallic };
    return m;
  }
  function mkUnlitMat(scene, name, color, opts={}){
    const m = new BABYLON.StandardMaterial(name, scene);
    m.emissiveColor = hexToColor3(color);
    m.disableLighting = true;
    m.alpha = opts.opacity ?? 1;
    if(opts.doubleSided) m.backFaceCulling = false;
    return m;
  }

  /* ---------- Graine déterministe (mulberry32) ---------- */
  function seededRng(seedStr){
    const s = String(seedStr==null ? '' : seedStr);
    let h = 1779033703 ^ s.length;
    for(let i=0;i<s.length;i++){
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h<<13)|(h>>>19);
    }
    let a = h >>> 0;
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Canon anatomique ----------
     Hauteurs en unités monde, pour une taille totale de 1,32. Sert de
     référence unique : toute pièce (équipement comme accessoire) se
     positionne à partir d'un de ces repères plutôt qu'avec un nombre écrit
     à la main, sinon le moindre ajustement de proportion fait flotter la
     moitié du personnage. */
  const H = 1.32;
  const L = {
    total:      H,
    headTop:    1.320,
    headCenter: 1.222,
    chin:       1.145,
    neck:       1.115,
    shoulder:   1.075,   // ligne d'épaule (centre des deltoïdes)
    chest:      0.985,
    elbow:      0.845,
    navel:      0.800,
    wrist:      0.640,
    /* ARTICULATION de hanche (≈0,53 × la taille chez l'humain), et c'est
       d'elle que part la cuisse — pas de l'entrejambe. La jambe pivotait
       auparavant depuis crotch (0.660), ce qui donnait un fémur de 0.285
       pour un tibia de 0.317 : une cuisse plus courte que le mollet, alors
       que c'est l'inverse chez l'humain. Depuis la hanche, le fémur fait
       0.320, et la jambe balance depuis le bon point en marchant. */
    hipJoint:   0.695,
    crotch:     0.660,   // ligne d'entrejambe visible (bas du short)
    knee:       0.375,
    ankle:      0.058,
    // demi-largeurs
    /* Écart des pivots d'épaule. Ce n'est PAS la largeur d'épaule visible :
       celle-ci vaut 2*(shoulderX + rayon du deltoïde), soit 0.352 ici, donc
       26,7 % de la hauteur — la fourchette humaine (25-27 % deltoïdes
       comprises). À 0.148 comme avant, on obtenait 0.386, soit 29 % : des
       épaules de trois têtes de large, la première chose qui trahissait la
       silhouette avant même de regarder les membres. */
    shoulderX:  0.132,
    chestX:     0.150,
    waistX:     0.122,
    hipX:       0.136,
    legX:       0.072,
  };

  /* ---------- Profils de membre ----------
     Donnés du HAUT vers le BAS, en [demi-largeur monde, t] où t est une
     fraction de la longueur du segment : t=0 au pivot haut (épaule, coude,
     hanche, genou), t=1 au pivot bas. Un t négatif remonte AU-DESSUS du
     pivot, pour que la masse déborde sur l'articulation et se fonde dans la
     pièce voisine (deltoïde sous le trapèze, haut de cuisse sous le bassin).

     Pourquoi ce changement : les membres étaient des CAPSULES, et une
     capsule se termine par une demi-sphère — elle ajoute donc un renflement
     exactement là où un membre humain se rétrécit. Empilées avec une bille
     d'épaule, une bille de coude et une bille de poignet, elles se lisaient
     en chapelet de saucisses. Sur un vrai bras, coude et poignet sont les
     points les PLUS FINS, la masse se trouve entre les deux et elle est
     décalée vers le haut (biceps, mollet). C'est ce dessin-là que suivent
     les profils ci-dessous, et c'est lui qui fait lire un membre.

     Les rayons sont absolus (cm monde) mais les hauteurs relatives : bouger
     un repère du canon (L) rallonge le membre sans le déformer. */
  const LIMB_PROFILES = {
    // Deltoïde compris : l'épaule n'est plus une bille rapportée mais le
    // haut du bras lui-même, ce qui lui rend sa PENTE. Une sphère à cet
    // endroit se détache toujours du fond, quelle que soit sa taille.
    /* Le sommet du deltoïde s'arrête SOUS le haut du trapèze (t=-0.15, soit
       ~3 cm au-dessus du pivot) : en montant plus haut il dépassait la ligne
       d'épaule et donnait une manche ballon. Un deltoïde humain est large
       sur le CÔTÉ, jamais bombé par-dessus l'épaule. */
    upperArm: [
      [0.000,-0.150], [0.024,-0.120], [0.036,-0.070],
      [0.042, 0.000], [0.042, 0.070], [0.040, 0.170],
      [0.038, 0.310], [0.036, 0.460], [0.033, 0.640],
      [0.030, 0.820], [0.028, 0.940], [0.026, 1.000],
    ],
    forearm: [
      [0.025,-0.100], [0.030,-0.020], [0.033, 0.075],
      [0.033, 0.150], [0.031, 0.270], [0.028, 0.430],
      [0.025, 0.600], [0.022, 0.760], [0.020, 0.890],
      [0.019, 0.965], [0.017, 1.000],
    ],
    /* Le haut s'arrête à t=-0.12 : la cuisse partant maintenant de
       l'articulation de hanche (L.hipJoint) et non de l'entrejambe, monter
       plus haut la ferait dépasser du short et former deux bosses à la
       taille. Elle reste donc noyée juste sous le bassin. */
    thigh: [
      [0.020,-0.120], [0.048,-0.080], [0.060,-0.030],
      [0.064, 0.000], [0.063, 0.090], [0.060, 0.230],
      [0.056, 0.390], [0.052, 0.560], [0.048, 0.735],
      [0.045, 0.875], [0.043, 0.958], [0.041, 1.000],
    ],
    // Mollet : masse HAUTE (t≈0.13) puis chute franche vers une cheville
    // fine. Un cône régulier du genou à la cheville, comme avant, donne une
    // patte de meuble.
    calf: [
      [0.036,-0.090], [0.040,-0.020], [0.043, 0.060],
      [0.045, 0.150], [0.044, 0.250], [0.041, 0.360],
      [0.036, 0.490], [0.032, 0.620], [0.028, 0.760],
      [0.025, 0.880], [0.023, 0.960], [0.022, 1.000],
    ],
  };

  /* ---------- Vocabulaire des pièces de silhouette ----------
     Peuple l'interface de l'éditeur. Toute entrée ici doit avoir son bloc
     correspondant dans buildAccessory() — cette table ne doit jamais
     promettre une pièce que le constructeur ne sait pas fabriquer. */
  const ACCESSORY_TYPES = [
    { type:'hood',          label:'Capuche',            icon:'🥷', options:[] },
    { type:'cape',          label:'Cape',               icon:'🦸', options:[
        { key:'light', label:'Tissu léger', kind:'bool', def:false } ] },
    { type:'crest',         label:'Cimier',             icon:'🪶', options:[] },
    { type:'shoulderSpikes',label:'Pointes d\'épaule',  icon:'⚔️', options:[
        { key:'side',  label:'Côté',   kind:'choice', values:['left','right','both'], labels:['Gauche','Droite','Les deux'], def:'right' },
        { key:'count', label:'Nombre', kind:'int', min:1, max:5, def:3 } ] },
    { type:'shoulderPlate', label:'Plaque d\'épaule',   icon:'🛡️', options:[
        { key:'side',  label:'Côté',   kind:'choice', values:['left','right'], labels:['Gauche','Droite'], def:'left' } ] },
    { type:'chestEmblem',   label:'Emblème de poitrine',icon:'🔶', options:[] },
  ];

  /* ---------- Thèmes des 24 agents Valostrike ---------- */
  const AGENT_VISUAL_THEME = {
    Kaidan:  { primary:0x3a2a5c, accent:0x1a1a22, accessories:[{type:'hood'},{type:'cape'}], glow:true },
    Rhoven:  { primary:0x6b1f1f, accent:0x1c1c1c, accessories:[{type:'shoulderSpikes', side:'right', count:3}] },
    Ignis:   { primary:0xc1501f, accent:0x2a2220, accessories:[{type:'shoulderPlate', side:'right'},{type:'chestEmblem'}], glow:true },
    Vexal:   { primary:0x241633, accent:0x8a4fd6, accessories:[{type:'cape'},{type:'chestEmblem'}], glow:true },
    Solmara: { primary:0xd4a017, accent:0xe8dcc0, accessories:[{type:'crest'},{type:'chestEmblem'}], glow:true },
    Drakko:  { primary:0x2e5c3a, accent:0x7a2020, accessories:[{type:'shoulderSpikes', side:'both', count:2},{type:'crest'}] },
    Halcyon: { primary:0x9fd6e0, accent:0xb8c4c8, accessories:[{type:'cape', light:true}] },
    Sondra:  { primary:0x8a5a3a, accent:0xb87333, accessories:[{type:'shoulderPlate', side:'left'}] },
    Pryzm:   { primary:0x3ec9c9, accent:0xe0f0f0, accessories:[{type:'crest'},{type:'chestEmblem'}], glow:true },
    Kestrix: { primary:0x9a8560, accent:0xb5824a, accessories:[{type:'shoulderPlate', side:'left'},{type:'hood'}] },
    Marrow:  { primary:0xd8d0c0, accent:0x1a1a1a, accessories:[{type:'hood'},{type:'chestEmblem'}], glow:true },
    Voltane: { primary:0x2a7fd6, accent:0xe0c020, accessories:[{type:'crest'},{type:'chestEmblem'}], glow:true },
    Ashra:   { primary:0x6a6660, accent:0x8a2a1e, accessories:[{type:'hood'},{type:'cape'}] },
    Nimbus:  { primary:0x5a6b7a, accent:0xd8dee2, accessories:[{type:'cape'},{type:'crest'}] },
    Verdane: { primary:0x3a6b3a, accent:0x5c4530, accessories:[{type:'shoulderPlate', side:'left'},{type:'crest'}] },
    Grael:   { primary:0x6a6a68, accent:0x9a5a30, accessories:[{type:'shoulderSpikes', side:'both', count:2},{type:'shoulderPlate', side:'right'}] },
    Mistara: { primary:0xaebcc4, accent:0xe8eef0, accessories:[{type:'cape', light:true},{type:'hood'}] },
    Obscura: { primary:0x18161c, accent:0x4a2a5c, accessories:[{type:'hood'},{type:'cape'}], glow:true },
    Corvane: { primary:0x1a1a1e, accent:0x2a2e3c, accessories:[{type:'shoulderPlate', side:'left'},{type:'hood'}] },
    Sentra:  { primary:0x6a6e70, accent:0xd6621f, accessories:[{type:'chestEmblem'},{type:'shoulderPlate', side:'right'}] },
  };

  const ROLE_ACCENT_COLOR = { Duelist:0xff9c3d, Initiator:0x3dd6ff, Controller:0xb06dff, Sentinel:0x5ee06a, Flex:0xd8d8d8 };

  /* Pose de repos des bras : le personnage porte une arme à deux mains, donc
     l'épaule descend légèrement vers l'avant et le coude est franchement
     replié. Mémorisée à part car le cycle de marche s'AJOUTE à cette pose
     au lieu de l'écraser (sinon les bras se déplient en marchant). */
  /* Pose de repos des bras. ASYMÉTRIQUE, et c'est voulu : une prise à deux
     mains sur une arme n'est pas symétrique — la main droite tient la
     poignée le long du corps, la gauche traverse vers l'avant pour saisir le
     garde-main. Des bras en miroir laissaient la main gauche de l'autre côté
     du corps, loin de l'arme. Le cycle de marche s'AJOUTE à ces valeurs. */
  const BASE_POSE = {
    rShoulderX:-0.34, rShoulderZ:-0.09, rElbowX:-1.02,
    lShoulderX:-0.85, lShoulderZ: 0.45, lElbowX:-0.35,
    // Arme orientée en travers du corps (port « patrouille ») : tenue droit
    // devant, le garde-main reste hors d'atteinte de la main gauche quel que
    // soit l'angle du bras — vérifié par balayage, l'écart minimal restait
    // bloqué à ~10 cm. En biais il tombe à ~6,7 cm, soit un contact visuel.
    gunYaw:-0.55,
  };

  /* ---------- Constructeur ---------- */
  function buildCharacter(scene, opts={}){
    const theme      = opts.theme || null;
    const teamColor  = opts.teamColor ?? 0xff5f5f;
    const roleColor  = ROLE_ACCENT_COLOR[opts.role] || 0xd8d8d8;
    const rng        = seededRng(opts.seed ?? 'default');
    const withRing   = opts.withRing !== false;
    const withGun    = opts.withGun !== false;

    const g = new BABYLON.TransformNode(opts.name || 'character', scene);
    const mats = {};
    mats.accent = mkMat(scene, 'chAccent', hexToColor3(teamColor).scale(0.42), { roughness:0.75 });
    mats.shirt  = mkMat(scene, 'chShirt', 0x8f8c82, { roughness:0.85 });
    mats.vest   = mkMat(scene, 'chVest', theme ? theme.primary : 0x5c5c46, { roughness:0.85 });
    mats.pants  = mkMat(scene, 'chPants', theme ? hexToColor3(theme.primary).scale(0.62) : hexToColor3(0x8a7a5c), { roughness:0.85 });
    mats.boot   = mkMat(scene, 'chBoot', 0x1c1c1e, { roughness:0.8 });
    mats.role   = mkMat(scene, 'chRole', theme ? theme.accent : roleColor, { roughness:0.5, metalness:0.25 });

    const skinHsl = colorToHSL(hexToColor3(0xd8a87a));
    mats.skin = mkMat(scene, 'chSkin', hslToColor3(
      (skinHsl.h+(rng()-0.5)*0.04+1)%1,
      Math.max(0, Math.min(1, skinHsl.s+(rng()-0.5)*0.15)),
      Math.max(0.15, Math.min(0.85, skinHsl.l+(rng()-0.5)*0.3))
    ), { roughness:0.85 });

    const gunBase = hexToColor3(0x22252a);
    mats.gun = mkMat(scene, 'chGun',
      theme ? gunBase.scale(0.8).add(hexToColor3(theme.accent).scale(0.2)) : gunBase,
      { roughness:0.4, metalness:0.55 });

    /* Fabriques. Toutes centrées sur l'origine locale : on positionne
       ensuite par le CENTRE de la pièce, ce qui rend les hauteurs du canon
       directement utilisables. */
    const mk = m => { m.metadata = { castShadow:true }; m.castShadow = true; m.receiveShadows = true; return m; };
    const caps = (n, rTop, rBot, h, mat, seg)=>{
      const m = BABYLON.MeshBuilder.CreateCapsule(n, {
        radiusTop:rTop, radiusBottom:rBot, height:h,
        tessellation: seg||12, capSubdivisions:5
      }, scene);
      m.material = mat; return mk(m);
    };
    const ell = (n, sx, sy, sz, mat, seg)=>{   // ellipsoïde : sphère unité mise à l'échelle
      const m = BABYLON.MeshBuilder.CreateSphere(n, {diameter:2, segments:seg||12}, scene);
      m.scaling.set(sx, sy, sz); m.material = mat; return mk(m);
    };
    const box = (n, w, h, d, mat)=>{
      const m = BABYLON.MeshBuilder.CreateBox(n, {width:w, height:h, depth:d}, scene);
      m.material = mat; return mk(m);
    };
    /* Cylindre elliptique (demi-dimensions, comme ell) : contour ARRONDI vu
       du dessus mais faces plates dessus/dessous. C'est exactement la forme
       d'une semelle de chaussure — un pied est arrondi de tous les côtés sauf
       là où il touche le sol. Une boîte, elle, donne un sabot. */
    const cyl = (n, sx, sy, sz, mat, seg)=>{
      const m = BABYLON.MeshBuilder.CreateCylinder(n, {diameter:2, height:2, tessellation:seg||26}, scene);
      m.scaling.set(sx, sy, sz); m.material = mat; return mk(m);
    };
    const node = (n, x, y, z)=>{ const t = new BABYLON.TransformNode(n, scene); t.position.set(x,y,z); return t; };
    // Surface de révolution : profil donné en [rayon, hauteur monde], aplati
    // ensuite en Z par flatZ (un corps humain n'est pas cylindrique).
    const lathe = (n, profile, mat, flatZ, seg)=>{
      const shape = profile.map(([r,y])=> new BABYLON.Vector3(r, y, 0));
      const m = BABYLON.MeshBuilder.CreateLathe(n, { shape, tessellation:seg||20, closed:true }, scene);
      m.scaling.z = flatZ ?? 1;
      m.material = mat; return mk(m);
    };
    /* Membre : même surface de révolution, mais le profil est donné en
       fraction de la longueur du segment et de haut en bas (voir
       LIMB_PROFILES), alors qu'un lathe attend des hauteurs monde croissantes
       — d'où la conversion + l'inversion ici. Le membre pend sous son pivot,
       ses hauteurs sont donc négatives. */
    const limbLathe = (n, len, profile, mat, flatZ, seg)=>
      lathe(n, profile.slice().reverse().map(([r,t])=> [r, -t*len]), mat, flatZ, seg||16);

    const parts = {};

    /* ----- TRONC -----
       Trois masses distinctes plutôt qu'un seul cône : cage thoracique
       large et aplatie d'avant en arrière, taille resserrée, bassin qui
       s'élargit à nouveau. C'est ce resserrement à la taille qui fait
       basculer la lecture de « tonneau » à « buste ». */
    /* Une SEULE surface de révolution, pas trois ellipsoïdes empilés.
       Empilés, leurs intersections restent visibles et le buste se lit comme
       un bonhomme de neige. Un profil continu (hanches → taille resserrée →
       cage thoracique → base du cou) donne une silhouette d'un seul tenant.
       Le lathe est radialement symétrique : on l'aplatit ensuite en Z, un
       torse humain étant nettement plus large que profond. */
    parts.chest = lathe('trunk', [
      [0.118, 0.640], [0.132, 0.690], [0.126, 0.745],
      [L.waistX, L.navel],                       // taille, le point qui fait la silhouette
      [0.128, 0.862], [0.144, 0.932],
      [L.chestX, L.chest],                       // poitrine, point le plus large
      // Haut du buste resserré : c'est le DELTOÏDE qui doit marquer le point
      // le plus large de la silhouette, pas la cage thoracique. Trop large
      // ici, le torse arrive au niveau de l'épaule et le bras semble
      // simplement posé contre un mur plat.
      //
      // L'encolure s'arrête aussi PLUS BAS (1.108 au lieu de 1.132) : le col
      // montait à 1 cm du menton, il ne restait donc aucun cou visible et la
      // tête paraissait posée directement sur les épaules. Il y a maintenant
      // ~4 cm de cou dégagé entre le col et la mâchoire.
      [0.140, 1.042], [0.118, 1.080], [0.082, 1.100], [0.050, 1.108],
    ], mats.shirt, 0.66);
    parts.chest.parent = g;

    /* Bassin/short : second profil court, en tissu de pantalon, qui recouvre
       le bas du tronc — la jonction tombe sous la ceinture, donc invisible.

       Le bas RENTRE au lieu de s'arrêter net : le profil s'arrêtait à 0.596
       sur un rayon de 0.108, donc sur un disque plat qui dépassait des
       cuisses devant et derrière — d'où le trait horizontal en travers du
       haut des jambes. En refermant progressivement (0.108 → 0.082), le bord
       passe sous les cuisses et disparaît. */
    /* Le volume du siège vient du PROFIL et de la profondeur du bassin
       (0.76 au lieu de 0.70), pas de fessiers rapportés : essayé en deux
       ellipsoïdes, et comme pour le visage, chaque masse qui émerge d'une
       surface lisse y laisse une arête d'intersection nette — une fesse
       recollée, visible dès qu'on tourne autour. Un bassin plus profond et
       une cuisse qui monte jusque sous lui donnent la même courbe sans
       aucune couture. */
    const pelvis = lathe('pelvis', [
      [0.082, 0.572], [0.110, 0.600], [0.130, 0.642],
      [0.138, 0.688], [0.128, 0.736],
    ], mats.pants, 0.76);
    pelvis.parent = g;

    /* ----- TÊTE -----
       Deux styles : un vrai visage (par défaut) ou la cagoule d'opérateur
       héritée du moteur. Le moteur avait choisi la cagoule au motif qu'en
       caméra isométrique un visage ne se voit pas — vrai en match, faux dans
       un éditeur où l'on juge le personnage de près, et un personnage sans
       visage ne lit pas comme un humain. */
    const headStyle = opts.headStyle || (theme && theme.headStyle) || 'face';
    const masked = headStyle === 'balaclava';
    const headMat = masked ? mats.boot : mats.skin;

    /* Cou en PEAU quand le visage est découvert : en tissu sombre sous une
       tête en peau, il se lisait comme un col et coupait la tête du corps.

       Profil ÉVASÉ (voir NECK_PROFILE) et non plus capsule : un cou humain
       n'est pas un tube de diamètre constant, il s'élargit franchement vers
       le bas pour se fondre dans le trapèze. C'est cet évasement qui relie
       la tête au corps ; sans lui, la tête est posée sur un manche à balai. */
    const neck = lathe('neck', NECK_PROFILE, masked ? mats.boot : mats.skin, 0.96, 20);
    neck.parent = g;

    /* Tête d'un seul tenant (voir HEAD_PROFILE). Une occiput/mâchoire/menton
       en ellipsoïdes rapportés a été essayée puis retirée : exactement le
       même défaut que sur le corps (bras, main, pied, fessiers avant eux) —
       à cette échelle, toute masse qui émerge d'une surface déjà lisse s'en
       détache en bosse au lieu de la modeler. L'asymétrie avant/arrière du
       crâne (que le lathe ne peut pas rendre, étant radialement symétrique)
       reste donc une limite connue plutôt qu'un correctif qui aggrave le
       problème — voir HEAD_PROFILE pour ce qui reste ajustable (largeur du
       menton, des pommettes, des tempes). */
    parts.head = lathe('head', HEAD_PROFILE, headMat, HEAD_DEPTH_RATIO, 36);
    parts.head.parent = g;

    if(masked){
      mats.visor = mkMat(scene, 'chVisor', theme ? theme.accent : teamColor, { roughness:0.3, metalness:0.35 });
      if(theme && theme.glow) mats.visor.emissiveColor = hexToColor3(theme.accent).scale(0.55);
      const visorY = HEAD_CHIN + (HEAD_TOP - HEAD_CHIN)*0.52;
      parts.visor = box('visor', 0.104, 0.036, 0.044, mats.visor);
      parts.visor.position.set(0, visorY, faceSurfaceZ(0, visorY) - 0.006); parts.visor.parent = g;
    }
    // Couleur de cheveux résolue AVANT le visage : les sourcils la
    // reprennent, et buildHair s'exécute après.
    mats.hairColorHex = opts.hairColor ?? HAIR_COLORS[0];
    if(!masked) buildFace(scene, g, { ell, box, caps, mats, L, theme, teamColor, rng, opts });
    buildHair(scene, g, { ell, caps, lathe, mats, L, masked, opts, mkMat });

    /* ----- BRAS -----
       Chaîne épaule → coude → poignet montée sur des pivots : la rotation
       part de l'articulation réelle, et le cycle de marche n'a qu'à tourner
       le pivot d'épaule. */
    parts.armL = node('shoulderL', -L.shoulderX, L.shoulder, 0); parts.armL.parent = g;
    parts.armR = node('shoulderR',  L.shoulderX, L.shoulder, 0); parts.armR.parent = g;
    parts.elbowL = node('elbowL', 0, -(L.shoulder-L.elbow), 0); parts.elbowL.parent = parts.armL;
    parts.elbowR = node('elbowR', 0, -(L.shoulder-L.elbow), 0); parts.elbowR.parent = parts.armR;

    /* Trapèze : masse large et aplatie posée en haut du buste, du cou
       jusqu'au-dessus de chaque épaule. Sans elle, le tronc s'arrête net à
       la base du cou et le bras commence par une boule — il manque la pente
       qui, chez un humain, relie les deux. C'est cette pente qui fait qu'une
       épaule ne se lit pas comme un rond. */
    /* Trapèze en TROIS masses au lieu d'un seul ellipsoïde en travers des
       épaules. Un ellipsoïde unique donne une barre horizontale à sommet
       plat : les épaules partent à angle droit du cou, ce qui lit comme des
       épaulettes de costume. Un trapèze humain forme une PENTE continue,
       haute contre le cou et qui descend jusqu'au point d'épaule.
       D'où un dôme central (base du cou) plus deux masses inclinées qui
       vont mourir dans le deltoïde. */
    const trapMid = ell('trapMid', 0.070, 0.028, 0.058, mats.shirt, 16);
    trapMid.position.set(0, L.shoulder + 0.010, -0.006); trapMid.parent = g;
    for(const sx of [-1, 1]){
      const trap = ell('trapSide', 0.062, 0.022, 0.050, mats.shirt, 14);
      trap.position.set(sx*0.076, L.shoulder + 0.007, -0.004);
      trap.rotation.z = -sx*0.30;   // l'extrémité extérieure descend vers l'épaule
      trap.parent = g;
    }

    const upperLen = L.shoulder - L.elbow, foreLen = L.elbow - L.wrist;
    const HAND_DROP = foreLen + 0.030;   // partagé avec l'ancre de l'arme

    [['L', parts.armL, parts.elbowL, -1], ['R', parts.armR, parts.elbowR, 1]].forEach(([sfx, sh, el, sx])=>{
      /* Bras = DEUX surfaces continues (voir LIMB_PROFILES), plus aucune
         bille rapportée. Le deltoïde fait partie du haut du bras, le coude et
         le poignet sont des étranglements du profil, et c'est le haut de
         l'avant-bras qui déborde par-dessus le coude. */
      const upper = limbLathe('upperArm'+sfx, upperLen, LIMB_PROFILES.upperArm, mats.shirt, 1, 22);
      upper.parent = sh;

      const fore = limbLathe('forearm'+sfx, foreLen, LIMB_PROFILES.forearm, mats.shirt, 0.94, 22);
      fore.parent = el;

      /* Comblement du pli du coude, volontairement PLUS FIN que le bras de
         part et d'autre (0.024 contre 0.026/0.030) : il ne doit jamais
         dépasser de la silhouette, seulement boucher le vide qui s'ouvre à
         l'extérieur du coude quand le bras se plie. C'est l'inverse de
         l'ancienne bille, plus grosse que les deux segments qu'elle reliait. */
      const elbow = ell('elbow'+sfx, 0.024, 0.026, 0.024, mats.shirt, 10);
      elbow.parent = el;

      // Fin de manche : le passage tissu → peau se lit comme un poignet de
      // chemise plutôt que comme une main qui sort d'un tube.
      const wrist = ell('wrist'+sfx, 0.019, 0.016, 0.017, mats.skin, 8);
      wrist.position.set(0, -foreLen - 0.008, 0); wrist.parent = el;

      /* MAIN = paume plate + bloc de doigts refermé, et non une grappe de
         petites sphères (qui se lisait comme un régime de raisin dès qu'on
         s'approchait). Le bloc de doigts est un volume plat incliné vers
         l'avant : c'est exactement la forme d'une main qui se referme sur une
         poignée, et il tombe pile sur l'ancre de l'arme. */
      const palm = ell('palm'+sfx, 0.024, 0.028, 0.016, mats.skin, 12);
      palm.position.set(0, -(foreLen + 0.020), 0); palm.parent = el;
      // Bloc de doigts bombé et LARGEMENT superposé à la paume : les deux
      // masses fusionnent en une seule main. Séparés (ou en boîte), ils se
      // lisaient comme des billes enfilées au bout du bras.
      const fingers = ell('fingers'+sfx, 0.022, 0.026, 0.021, mats.skin, 12);
      fingers.position.set(0, -(foreLen + 0.046), 0.008);
      fingers.rotation.x = -0.30; fingers.parent = el;
      // Pouce : une paume nue reste une palette ; c'est lui qui la fait lire
      // comme une main, même à petite taille.
      const thumb = ell('thumb'+sfx, 0.009, 0.016, 0.009, mats.skin, 8);
      thumb.position.set(sx*-0.019, -(foreLen + 0.030), 0.011);
      thumb.rotation.z = sx*0.6; thumb.rotation.x = -0.3; thumb.parent = el;
    });

    /* ----- JAMBES ----- */
    parts.legPivotL = node('legPivotL', -L.legX, L.hipJoint, 0); parts.legPivotL.parent = g;
    parts.legPivotR = node('legPivotR',  L.legX, L.hipJoint, 0); parts.legPivotR.parent = g;
    parts.kneeL = node('kneeL', 0, -(L.hipJoint-L.knee), 0); parts.kneeL.parent = parts.legPivotL;
    parts.kneeR = node('kneeR', 0, -(L.hipJoint-L.knee), 0); parts.kneeR.parent = parts.legPivotR;

    const thighLen = L.hipJoint - L.knee, calfLen = L.knee - L.ankle;
    [['L', parts.legPivotL, parts.kneeL], ['R', parts.legPivotR, parts.kneeR]].forEach(([sfx, hip, knee])=>{
      /* Même principe que les bras : une peau continue par segment. La
         cuisse remonte au-dessus du pivot pour aller se cacher dans la masse
         du bassin (sinon la jambe commence net au niveau de l'entrejambe,
         comme une patte vissée sous un tronc). */
      const thigh = limbLathe('thigh'+sfx, thighLen, LIMB_PROFILES.thigh, mats.pants, 0.96, 22);
      thigh.parent = hip;
      const calf = limbLathe('calf'+sfx, calfLen, LIMB_PROFILES.calf, mats.pants, 0.94, 22);
      calf.parent = knee;
      // Rotule : comme le coude, plus fine que la jambe de part et d'autre.
      const kneeCap = ell('kneeCap'+sfx, 0.038, 0.040, 0.038, mats.pants, 10);
      kneeCap.parent = knee;

      /* CHAUSSURE — aucune arête vive, c'est tout l'enjeu : un pied humain
         est bombé sur le dessus, arrondi au bout et sur les côtés, et plat
         uniquement dessous. D'où la semelle en cylindre elliptique (contour
         ovale + dessous plat) surmontée de volumes bombés pour le coup de
         pied, le bout et le talon. La boîte précédente donnait un sabot, et
         comme le pied est ce qui ancre le personnage au sol, c'est la
         première chose qui trahissait la silhouette debout.

         Les hauteurs sont calées pour que le dessous de semelle tombe
         EXACTEMENT à y=0 une fois en monde (cheville à L.ankle) : un
         personnage qui flotte d'un centimètre ne se lit plus comme posé. */
      const ankleY = -calfLen;                       // = -L.ankle en monde
      /* Semelle FINE et à peine débordante : trop large ou trop épaisse, elle
         se lit comme une tong à plateau posée sous le pied. */
      const sole = cyl('bootSole'+sfx, 0.037, 0.012, 0.098, mats.boot, 26);
      sole.position.set(0, ankleY - 0.046, 0.036); sole.parent = knee;
      /* UNE seule masse bombée du talon au bout, plutôt que coup de pied +
         bout + talon séparés : chaque intersection entre deux ellipsoïdes
         laisse un pli net, et le pied se lisait en petits pains collés. */
      const foot = ell('boot'+sfx, 0.036, 0.028, 0.098, mats.boot, 18);
      foot.position.set(0, ankleY - 0.008, 0.036); foot.parent = knee;
      // Tige : monte sur la cheville et recouvre le bas du mollet.
      const shaft = ell('bootShaft'+sfx, 0.033, 0.044, 0.036, mats.boot, 14);
      shaft.position.set(0, ankleY + 0.028, -0.006); shaft.parent = knee;
    });

    /* ----- ÉQUIPEMENT -----
       Redimensionné sur le nouveau buste : un gilet taillé pour l'ancien
       torse de 0,54 de large flotterait autour de celui-ci. */
    // Gilet pare-balles : ellipsoïde plaqué sur l'AVANT du buste, pas une
    // boîte englobante. Une boîte aux dimensions du torse voit ses angles
    // dépasser de la courbe du buste sur tout le pourtour, et le personnage
    // n'est plus qu'un bloc — c'était le défaut le plus visible.
    // (Pas de plastron : plaqué sur un buste arrondi, il ne lisait pas comme
    // un gilet mais comme une tache de couleur au milieu du torse. Ni de
    // bretelles, qui passaient pour des pastilles collées aux épaules.
    // La couleur d'identité du personnage porte donc sur le bas de tenue et
    // sur les pièces de silhouette — pas sur un patch au milieu du buste.)
    const backpack = ell('backpack', 0.082, 0.098, 0.045, mats.vest, 12);
    backpack.position.set(0, L.chest + 0.005, -0.100); backpack.parent = g;

    // Ceinture en ellipsoïde APLATI, pas en capsule : une capsule dont la
    // hauteur (0.048) est inférieure à son diamètre (0.268) dégénère en
    // boule — elle rendait un gros bloc noir en travers des hanches.
    // L'ellipsoïde épouse en plus la section du corps, plus large que
    // profonde, ce qu'un cylindre ne fait pas.
    const belt = ell('belt', L.waistX + 0.010, 0.024, 0.084, mats.boot, 14);
    belt.position.set(0, L.navel - 0.058, 0); belt.parent = g;
    /* Poches de ceinture APLATIES et posées en biais sur le devant de la
       hanche. Cubiques (0.066×0.072×0.055) et plantées droit devant comme
       avant, elles ressortaient comme deux dés collés au bassin — le second
       défaut le plus visible de la silhouette après les membres. Une poche
       est un volume plat, plaqué contre le corps et qui en suit la courbe. */
    /* Poche PLATE plaquée sur la hanche, pas un volume en boule : elle est
       deux fois plus large et plus haute qu'épaisse, et ne dépasse de la
       surface du corps que de ~8 mm. Trop épaisse, elle se lit comme un
       pompon accroché à la ceinture ; cubique (sa version d'origine), comme
       un dé collé au bassin. */
    for(const px of [-0.052, 0.052]){
      const pouch = ell('pouch', 0.028, 0.036, 0.010, mats.vest, 12);
      // Sur le DEVANT de la hanche, pas sur son flanc : posées trop à
      // l'extérieur (et pivotées), les poches débordaient de la silhouette
      // et faisaient deux ailerons de part et d'autre du bassin.
      pouch.position.set(px, L.navel - 0.086, 0.078);
      pouch.rotation.y = (px < 0 ? 1 : -1) * 0.16;
      pouch.parent = g;
    }

    // Brassard : porté SUR le bras (enfant du pivot d'épaule), il suit donc
    // le balancement au lieu de rester figé dans le dos.
    /* Marquages d'équipe / de rôle. Ce sont des repères de LISIBILITÉ en
       match (reconnaître un allié d'un coup d'œil), pas des vêtements — d'où
       l'option pour les masquer pendant qu'on dessine une tenue.
       Deux défauts corrigés ici :
         - le brassard était une capsule de hauteur 0.038 pour un diamètre
           0.082, donc dégénérée en boule (même piège que la ceinture) ;
         - l'insigne de rôle était un cube qui dépassait du bras comme une
           boîte collée. Les deux épousent maintenant la forme du bras et
           sont ENFANTS de l'épaule, donc ils suivent le mouvement. */
    if(opts.withTeamMarkings !== false){
      const armband = ell('armband', 0.043, 0.020, 0.043, mats.accent, 12);
      armband.position.set(0, -0.088, 0); armband.castShadow = false; armband.parent = parts.armR;
      const roleBadge = ell('roleBadge', 0.030, 0.030, 0.012, mats.role, 10);
      roleBadge.position.set(-0.030, -0.020, 0.030); roleBadge.castShadow = false; roleBadge.parent = parts.armL;
    }

    /* ----- PIÈCES DE SILHOUETTE ----- */
    parts.accessories = [];
    if(theme && theme.accessories){
      const cache = {};
      const accMat = (key, roughness, metalness)=>{
        if(!cache[key]) cache[key] = mkMat(scene, 'chAcc_'+key, theme.primary, { roughness, metalness });
        return cache[key];
      };
      theme.accessories.forEach(acc=>{
        const made = buildAccessory(scene, acc, g, { caps, ell, box, accMat, L });
        if(made) parts.accessories.push({ acc, meshes: made });
      });
    }

    /* ----- ARME -----
       Le moteur fabrique la sienne selon le palier d'achat. Celle-ci n'est
       qu'une silhouette neutre, pour que les mains ne tiennent pas le vide :
       l'éditeur juge une tenue, pas un arsenal. */
    // Arme ENFANT de l'avant-bras droit, posée à la main : ancrée en
    // coordonnées du corps elle flottait à 14 cm derrière les mains, et
    // surtout elle ne suivait pas le bras pendant la marche. La rotation
    // compense exactement la chaîne épaule+coude (voir BASE_POSE) pour
    // ramener le canon à l'horizontale.
    parts.gunAnchor = node('gunAnchor', 0, -HAND_DROP, 0);
    parts.gunAnchor.rotation.x = -(BASE_POSE.rShoulderX + BASE_POSE.rElbowX);
    parts.gunAnchor.rotation.y = BASE_POSE.gunYaw;
    parts.gunAnchor.parent = parts.elbowR;
    if(withGun){
      // Décalées pour que la POIGNÉE tombe sur l'origine de l'ancre, donc
      // dans la main — et non le milieu de l'arme comme avant.
      const body  = box('gunBody', 0.036, 0.050, 0.285, mats.gun); body.position.set(0, 0.030, 0.082); body.parent = parts.gunAnchor;
      const stock = box('gunStock', 0.032, 0.056, 0.105, mats.gun); stock.position.set(0, 0.025,-0.103); stock.parent = parts.gunAnchor;
      const mag   = box('gunMag', 0.026, 0.088, 0.042, mats.gun); mag.position.set(0,-0.034, 0.088); mag.rotation.x = 0.18; mag.parent = parts.gunAnchor;
      const grip  = box('gunGrip', 0.026, 0.062, 0.034, mats.gun); grip.position.set(0,-0.018, 0); grip.rotation.x = 0.28; grip.parent = parts.gunAnchor;
    }

    if(withRing){
      const ring = BABYLON.MeshBuilder.CreateTorus('ring', {diameter:0.92, thickness:0.08, tessellation:20}, scene);
      ring.material = mkUnlitMat(scene, 'chRing', teamColor, { doubleSided:true });
      ring.position.y = 0.03; ring.parent = g;
      parts.ring = ring;
    }

    // Pose de repos appliquée une fois ; poseWalk s'y ajoute ensuite.
    applyBasePose(parts);
    return { root:g, parts, materials:mats };
  }

  function applyBasePose(parts){
    if(parts.armL){ parts.armL.rotation.x = BASE_POSE.lShoulderX; parts.armL.rotation.z = BASE_POSE.lShoulderZ; }
    if(parts.armR){ parts.armR.rotation.x = BASE_POSE.rShoulderX; parts.armR.rotation.z = BASE_POSE.rShoulderZ; }
    if(parts.elbowL) parts.elbowL.rotation.x = BASE_POSE.lElbowX;
    if(parts.elbowR) parts.elbowR.rotation.x = BASE_POSE.rElbowX;
  }

  /* Fabrique UNE pièce de silhouette. Isolée pour que l'éditeur puisse en
     ajouter/retirer sans reconstruire tout le personnage, et pour que
     ACCESSORY_TYPES ait un seul endroit correspondant à tenir à jour.
     Toutes les hauteurs viennent du canon (L) : réajuster une proportion
     du corps déplace automatiquement les accessoires avec. */
  function buildAccessory(scene, acc, parent, h){
    const { caps, ell, box, accMat, L } = h;
    const made = [];
    if(acc.type==='hood'){
      const hm = accMat('hood', 0.9, 0);
      const hood = ell('hoodPiece', 0.105, 0.112, 0.112, hm, 12);
      hood.position.set(0, L.headCenter + 0.012, -0.016); hood.parent = parent;
      const tip = caps('hoodTip', 0.012, 0.052, 0.125, hm, 8);
      tip.position.set(0, L.headTop + 0.030, -0.062); tip.rotation.x = -0.42; tip.parent = parent;
      made.push(hood, tip);
    } else if(acc.type==='cape'){
      const cm = accMat('cape', 0.85, 0);
      const w = acc.light ? 0.225 : 0.285, alpha = acc.light ? 0.85 : 1;
      const cape = box('cape', w, 0.50, 0.022, cm);
      // alpha sur une COPIE : cape légère et cape pleine partagent sinon le
      // matériau mis en cache, et la dernière construite imposerait sa
      // transparence à l'autre.
      if(alpha < 1){
        cape.material = cm.clone('chAcc_capeLight');
        cape.material.alpha = alpha;
        cape.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      }
      cape.position.set(0, L.chest - 0.055, -0.128); cape.rotation.x = 0.16; cape.parent = parent;
      made.push(cape);
    } else if(acc.type==='crest'){
      const cm = accMat('crest', 0.35, 0.35);
      const crest = caps('crest', 0.006, 0.038, 0.165, cm, 8);
      crest.position.set(0, L.headTop + 0.058, -0.012); crest.parent = parent;
      made.push(crest);
    } else if(acc.type==='shoulderSpikes'){
      const sm = accMat('spikes', 0.55, 0.2);
      const sides = acc.side==='both' ? [-1,1] : acc.side==='left' ? [-1] : [1];
      const count = acc.count||3;
      sides.forEach(sx=>{
        for(let i=0;i<count;i++){
          const spike = caps('spike', 0.004, Math.max(0.010, 0.030-i*0.005), Math.max(0.045, 0.115-i*0.017), sm, 7);
          spike.position.set(sx*(L.shoulderX+0.030), L.shoulder + 0.048 + i*0.026, -0.022 + i*0.030);
          spike.rotation.z = sx*0.48;
          spike.parent = parent;
          made.push(spike);
        }
      });
    } else if(acc.type==='shoulderPlate'){
      const pm = accMat('plate', 0.5, 0.25);
      const sx = acc.side==='left' ? -1 : 1;
      const plate = ell('shoulderPlate', 0.078, 0.052, 0.072, pm, 10);
      plate.position.set(sx*(L.shoulderX+0.012), L.shoulder + 0.022, 0); plate.parent = parent;
      made.push(plate);
    } else if(acc.type==='chestEmblem'){
      const em = accMat('emblem', 0.3, 0.4);
      const emblem = box('chestEmblem', 0.072, 0.072, 0.016, em);
      emblem.position.set(0, L.chest + 0.010, 0.102); emblem.castShadow = false; emblem.parent = parent;
      made.push(emblem);
    }
    return made.length ? made : null;
  }

  /* VISAGE. Traits volontairement peu nombreux mais bien placés : à la
     distance de caméra du jeu, ce qui fait lire un visage n'est pas le
     détail mais la position relative des yeux, du nez et de la bouche. Les
     yeux sont ENFONCÉS dans la surface du crâne (z inférieur au rayon) —
     posés dessus ils ressortiraient comme des billes collées. */
  /* PROFIL DE TÊTE — [demi-largeur, hauteur monde], du menton au sommet.
     Une seule forme continue : crâne et mâchoire étaient auparavant deux
     ellipsoïdes distincts, et l'intersection de deux surfaces convexes
     laisse une arête nette — le « renfoncement » en travers du visage.
     Proportions resserrées au passage : 0,120 de large pour 0,178 de haut
     (rapport 0,67, celui d'un crâne humain) contre 0,172 pour 0,196
     auparavant, soit une tête presque aussi large que haute. */
  /* PROFIL DU COU — [demi-largeur, hauteur monde], du bas vers le haut.
     La base (1.040) est noyée dans le buste et le sommet (1.160) dans la
     tête : seule la partie médiane est visible, entre le col de la chemise
     (qui s'arrête à 1.108) et la mâchoire. L'évasement du bas est ce qui
     raccorde la tête au tronc. */
  const NECK_PROFILE = [
    [0.060, 1.040],
    [0.052, 1.066],
    [0.044, 1.088],
    [0.039, 1.106],
    [0.036, 1.124],
    [0.0345, 1.142],
    [0.034, 1.160],
  ];

  /* Mâchoire RESSERRÉE et menton plus fin que dans la version précédente
     ([0.037,1.157] → [0.031,1.156], [0.049,1.179] → [0.044,1.176]) : le bas
     du visage était presque aussi large que les pommettes, ce qui donne une
     tête carrée d'un bloc. Chez l'humain la largeur maximale est aux
     tempes, puis le visage se rétrécit nettement vers le menton — c'est ce
     rétrécissement qui fait lire un visage plutôt qu'un œuf.
     Le modelé vient d'ici, PAS de volumes collés sur la peau (essayé : voir
     buildFace, ça ressort en grumeaux à cette échelle). */
  const HEAD_PROFILE = [
    [0.014, 1.142],  // menton
    [0.031, 1.156],
    [0.044, 1.176],
    [0.053, 1.202],  // mâchoire → pommette
    [0.059, 1.232],
    [0.060, 1.250],  // tempes, point le plus large
    [0.057, 1.272],
    [0.047, 1.296],
    [0.028, 1.313],
    [0.000, 1.320],  // sommet
  ];
  const HEAD_DEPTH_RATIO = 1.22;   // une tête est plus profonde que large
  const HEAD_TOP = 1.320, HEAD_CHIN = 1.142;

  // Demi-largeur de la tête à une hauteur donnée (interpolation du profil).
  function headRadiusAt(y){
    const P = HEAD_PROFILE;
    if(y <= P[0][1]) return P[0][0];
    if(y >= P[P.length-1][1]) return 0;
    for(let i=1;i<P.length;i++){
      if(y <= P[i][1]){
        const t = (y - P[i-1][1]) / (P[i][1] - P[i-1][1]);
        return P[i-1][0] + t*(P[i][0] - P[i-1][0]);
      }
    }
    return 0;
  }
  /* Profondeur de la surface du visage au point (dx, y). Indispensable :
     placer les traits à une profondeur devinée les enfonce — mesuré sur une
     version précédente, le blanc de l'œil finissait 3 mm SOUS la peau et
     l'iris exactement à ras, donc invisibles, pendant que le nez dépassait
     de 9 mm et faisait une boule. */
  function faceSurfaceZ(dx, y){
    const r = headRadiusAt(y);
    if(r <= 0) return 0;
    const k = 1 - (dx/r)**2;
    return k > 0 ? r*HEAD_DEPTH_RATIO*Math.sqrt(k) : 0;
  }

  function buildFace(scene, parent, h){
    const { ell, box, mats, L, rng } = h;
    const eyeWhite = mkMat(scene, 'chEyeWhite', 0xf2eee6, { roughness:0.35 });
    const IRIS = [0x5a3a22, 0x6b4a2a, 0x4a5a3a, 0x55524c, 0x3a2a1e];
    const iris = mkMat(scene, 'chIris', IRIS[Math.floor(rng()*IRIS.length)], { roughness:0.25 });
    const brow = mkMat(scene, 'chBrow', hexToColor3(mats.hairColorHex ?? 0x3a2a1e), { roughness:0.9 });
    const lips = mkMat(scene, 'chLips', hexToColor3(0xa9705e), { roughness:0.75 });
    const Y = L.headCenter;

    /* Repères du visage en fraction de la hauteur de tête, comptés depuis le
       menton — la façon dont on cadre un visage en dessin, et qui suit
       automatiquement tout changement de proportions du profil. */
    const HH = HEAD_TOP - HEAD_CHIN;
    const at = f => HEAD_CHIN + HH*f;
    const EYE_Y = at(0.50), BROW_Y = at(0.585), NOSE_Y = at(0.335), MOUTH_Y = at(0.185);
    const EYE_X = 0.026;

    /* Pas d'arcade, de pommette ni de paupière en volume rapporté : essayé,
       et c'est à jeter. Sur une tête de 12 cm de large en rendu à facettes,
       un ellipsoïde qui affleure de 5 mm ne MODÈLE pas la surface, il s'en
       détache en grumeau — le visage finit couvert de bosses. Le modelé doit
       venir du profil du crâne lui-même (voir HEAD_PROFILE), les pièces
       rapportées étant réservées aux traits qui, eux, se DOIVENT d'être
       distincts : yeux, sourcils, nez, lèvres, oreilles. */

    for(const sx of [-1, 1]){
      // L'œil est un globe dont le CENTRE reste en retrait : seule sa
      // calotte émerge, comme dans une orbite. Centre posé sur la surface,
      // on obtiendrait une bille collée sur la joue.
      const zEye = faceSurfaceZ(EYE_X, EYE_Y);
      const white = ell('eyeWhite', 0.0125, 0.0092, 0.0085, eyeWhite, 12);
      white.position.set(sx*EYE_X, EYE_Y, zEye - 0.0050); white.parent = parent;
      const pupil = ell('iris', 0.0062, 0.0068, 0.0050, iris, 10);
      pupil.position.set(sx*EYE_X, EYE_Y, zEye + 0.0008); pupil.parent = parent;

      const b = box('brow', 0.027, 0.008, 0.009, brow);
      b.position.set(sx*EYE_X, BROW_Y, faceSurfaceZ(EYE_X, BROW_Y) + 0.001);
      b.rotation.z = sx*0.13; b.parent = parent;

      const ear = ell('ear', 0.009, 0.020, 0.013, mats.skin, 8);
      ear.position.set(sx*(headRadiusAt(EYE_Y) - 0.004), EYE_Y - 0.008, -0.010); ear.parent = parent;
    }

    // Nez étroit et enfoncé davantage : large et saillant, il devient le
    // seul trait qu'on voit et le visage se résume à lui.
    const nose = ell('nose', 0.0095, 0.021, 0.0115, mats.skin, 10);
    nose.position.set(0, NOSE_Y, faceSurfaceZ(0, NOSE_Y) - 0.0075); nose.parent = parent;

    // Lèvres : deux volumes bombés, l'inférieure plus pleine. La boîte
    // unique d'avant faisait un trait collé, sans aucun volume.
    const zMouth = faceSurfaceZ(0, MOUTH_Y);
    const lipTop = ell('lipTop', 0.0135, 0.0040, 0.0062, lips, 10);
    lipTop.position.set(0, MOUTH_Y + 0.0038, zMouth - 0.0034); lipTop.parent = parent;
    const lipBot = ell('lipBot', 0.0125, 0.0048, 0.0068, lips, 10);
    lipBot.position.set(0, MOUTH_Y - 0.0042, zMouth - 0.0028); lipBot.parent = parent;
  }

  /* COIFFURES. Le bonnet de cheveux est un ellipsoïde légèrement décalé vers
     l'ARRIÈRE : son bord avant tombe alors juste en retrait du front, ce qui
     dessine une ligne de cheveux sans masquer le visage. Les styles longs
     ajoutent une masse dans la nuque plutôt que de déformer le bonnet. */
  const HAIR_STYLES = [
    { id:'none',    label:'Aucun' },
    { id:'court',   label:'Court' },
    { id:'milong',  label:'Mi-long' },
    { id:'long',    label:'Long' },
    { id:'chignon', label:'Chignon' },
    { id:'crete',   label:'Crête' },
  ];
  const HAIR_COLORS = [0x2b2118, 0x4a3524, 0x6b4a2a, 0x8a6a3f, 0xb08b4f, 0x6a6660, 0xa9a29a];

  function buildHair(scene, parent, h){
    const { ell, lathe, mats, L, masked, opts, mkMat: mkm } = h;
    if(masked) return;                       // la cagoule couvre déjà le crâne
    const style = opts.hairStyle || 'court';
    if(style === 'none') return;
    const colorHex = opts.hairColor ?? HAIR_COLORS[0];
    mats.hairColorHex = colorHex;
    const hm = mkm(scene, 'chHair', colorHex, { roughness:0.92 });
    // Dimensions redérivées de la tête affinée : la calotte précédente
    // (0.089 de demi-largeur) était taillée pour un crâne 50 % plus large.
    const Y = HEAD_CHIN + (HEAD_TOP - HEAD_CHIN)*0.675;   // ~1.262

    if(style !== 'crete'){
      /* Calotte CALQUÉE sur le profil du crâne, décalée vers l'extérieur, et
         tronquée net à la hauteur de la ligne de cheveux.
         Une ellipsoïde posée par-dessus ne marchait pas : ses deux surfaces
         restaient quasi tangentes sur toute la zone, si bien qu'au centre du
         front elle passait 1,3 mm SOUS la peau et laissait un V de crâne nu,
         avec un bord en dents de scie tout autour. Ici, la calotte reste
         partout à distance constante du crâne et la ligne de cheveux est
         donnée par son bord inférieur — une arête franche, pas une
         intersection rasante. */
      const HAIRLINE = 1.262;
      const capProfile = [];
      for(let y = HAIRLINE; y < HEAD_TOP; y += 0.006){
        capProfile.push([headRadiusAt(y)*1.06 + 0.004, y]);
      }
      capProfile.push([0.004, HEAD_TOP + 0.005]);
      const cap = lathe('hairCap', capProfile, hm, HEAD_DEPTH_RATIO, 36);
      cap.parent = parent;
    }
    if(style === 'milong'){
      const back = ell('hairBack', 0.058, 0.048, 0.042, hm, 12);
      back.position.set(0, Y - 0.070, -0.044); back.parent = parent;
    } else if(style === 'long'){
      const back = ell('hairBack', 0.062, 0.090, 0.046, hm, 12);
      back.position.set(0, Y - 0.110, -0.038); back.parent = parent;
    } else if(style === 'chignon'){
      const bun = ell('hairBun', 0.032, 0.030, 0.030, hm, 10);
      bun.position.set(0, Y + 0.038, -0.072); bun.parent = parent;
    } else if(style === 'crete'){
      const strip = ell('hairCrest', 0.016, 0.042, 0.076, hm, 10);
      strip.position.set(0, Y + 0.032, -0.006); strip.parent = parent;
    }
  }

  /* Cycle de marche — s'AJOUTE à la pose de repos (voir BASE_POSE) : écraser
     rotation.x déplierait les bras dès le premier pas. Les jambes battent
     depuis la hanche, le genou se replie sur la phase arrière, et les bras
     accompagnent en opposition avec une amplitude faible (le personnage
     tient une arme à deux mains, des bras de sprinteur sonneraient faux). */
  function poseWalk(parts, phase, moving){
    if(!parts) return;
    const s = moving ? Math.sin(phase) : 0;
    if(parts.legPivotL) parts.legPivotL.rotation.x =  s*0.52;
    if(parts.legPivotR) parts.legPivotR.rotation.x = -s*0.52;
    // Genou : ne se plie que vers l'arrière (jamais vers l'avant), d'où le
    // max(0, …) — un genou qui s'inverse est le défaut le plus visible d'une
    // marche procédurale.
    if(parts.kneeL) parts.kneeL.rotation.x = -Math.max(0, -s)*0.62;
    if(parts.kneeR) parts.kneeR.rotation.x = -Math.max(0,  s)*0.62;
    if(parts.armL) parts.armL.rotation.x = BASE_POSE.lShoulderX - s*0.10;
    if(parts.armR) parts.armR.rotation.x = BASE_POSE.rShoulderX + s*0.08;
  }

  /* Sérialisation au format EXACT d'AGENT_VISUAL_THEME, pour que l'export
     de l'éditeur se colle tel quel dans le moteur. */
  function themeToSource(name, theme){
    const hex = v => '0x'+(v>>>0).toString(16).padStart(6,'0');
    const accs = (theme.accessories||[]).map(a=>{
      const extra = Object.keys(a).filter(k=>k!=='type')
        .map(k=> k+':'+(typeof a[k]==='string' ? "'"+a[k]+"'" : a[k]));
      return '{type:\''+a.type+'\''+(extra.length?', '+extra.join(', '):'')+'}';
    }).join(',');
    return name+': { primary:'+hex(theme.primary)+', accent:'+hex(theme.accent)
      +', accessories:['+accs+']'+(theme.glow?', glow:true':'')+' },';
  }

  return {
    ACCESSORY_TYPES, AGENT_VISUAL_THEME, ROLE_ACCENT_COLOR, LANDMARKS:L,
    HAIR_STYLES, HAIR_COLORS,
    buildCharacter, buildAccessory, poseWalk, themeToSource,
    hexToColor3, color3ToHex,
  };
})();
