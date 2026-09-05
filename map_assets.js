// map_assets.js — Bibliothèque d'assets 3D partagée entre l'éditeur de
// carte (map_editor.html) et les moteurs de match 3D (valorant_ai_match.html/
// _outpost.html). Extrait de map_editor.html (section "1. REGISTRE
// D'ASSETS") pour que les deux mondes utilisent EXACTEMENT la même
// géométrie procédurale détaillée (joints, signalétique, vitrages...) au
// lieu de la resucée bien plus pauvre que chaque moteur de match
// maintenait séparément (buildAsset()/SIZE, désormais supprimés) — toute
// carte construite dans l'éditeur s'affiche donc avec le même niveau de
// détail en match, et tout nouvel asset ajouté ici devient disponible
// PARTOUT sans portage manuel.
//
// N'expose QUE MapAssets.ASSETS (et le reste ci-dessous) sur window — les
// moteurs de match ont leurs PROPRES mkBox/mkCyl (signatures différentes,
// voir valorant_ai_match.html) : ne jamais les déstructurer globalement
// là-bas, seul MapAssets.ASSETS[i].build(color) doit y être appelé.
window.MapAssets = (function(){
  "use strict";

  /* ============================================================
     1. REGISTRE D'ASSETS — chaque asset est une fonction génératrice qui
     retourne un THREE.Group prêt à être cloné dans la scène, plus des
     métadonnées (catégorie, icône de palette, couleur par défaut,
     dimensions de base pour l'affichage "Longueur/Largeur/Hauteur/Volume").
     Tout est procédural (boîtes/cylindres) — aucun asset externe requis,
     donc la bibliothèque fonctionne immédiatement en double-clic, sans
     dépendre de fichiers de modèles qui n'existent pas.
     ============================================================ */
  const ASSET_CATS = [
    { id:'biomes', label:'Biomes', icon:'🗺️' },
    { id:'zones', label:'Sites & Spawns', icon:'◎' },
    { id:'floors', label:'Sols', icon:'▭' },
    { id:'walls', label:'Murs', icon:'▦' },
    { id:'covers', label:'Couvertures', icon:'▣' },
    { id:'structures', label:'Structures', icon:'⌂' },
    { id:'nature', label:'Nature', icon:'❀' },
    { id:'props', label:'Décoration', icon:'✦' },
    { id:'tactical', label:'Éléments tactiques', icon:'◈' },
    { id:'vertical', label:'Verticalité', icon:'⌇' },
    { id:'prefabs', label:'Prefabs', icon:'★' },
  ];
  // Sous-catégories : regroupent une partie des assets d'UNE catégorie
  // parente sous un panneau repliable séparé (ex: les murs modulaires
  // sous "Murs"), plutôt que de les mélanger à plat avec le reste.
  // Sous-catégories : regroupent les variantes modulaires d'une matière
  // SOUS la tuile de ce matériau (ex: les modulaires béton sous "Béton"),
  // plutôt qu'à plat avec le reste — repliées par défaut, dépliées via
  // le chevron sur la tuile du matériau.
  const ASSET_SUBCATS = {
    concrete: { label:'Modulaire — Béton' },
    steel: { label:'Modulaire — Acier' },
    lab: { label:'Modulaire — Laboratoire' },
    industrial: { label:'Modulaire — Industriel' },
    military: { label:'Modulaire — Militaire' },
    futuristic: { label:'Modulaire — Futuriste' },
  };

  /* ============================================================
     GÉNÉRATEURS DE TEXTURES PROCÉDURALES (canvas -> CanvasTexture) — pour
     de vraies surfaces texturées au lieu de simples aplats de couleur.
     Mises en cache par (type+couleur) : générées une seule fois puis
     réutilisées sur tous les exemplaires du même asset, pour ne pas
     recréer un canvas à chaque placement.
     ============================================================ */
  const _texCache = {};
  function cachedTexture(key, generator){
    if(!_texCache[key]) _texCache[key] = generator();
    return _texCache[key];
  }
  function mkRepeatTex(tex, rx, ry){
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    return tex;
  }
  // Vignette douce (assombrit légèrement les bords du canvas) : casse
  // l'effet "aplat plastique" d'une texture procédurale répétée en lui
  // donnant un soupçon de profondeur/occlusion, comme une vraie surface
  // photographiée sous un éclairage ambiant.
  function addVignette(ctx, size, strength=0.16){
    const grad = ctx.createRadialGradient(size/2,size/2,size*0.15,size/2,size/2,size*0.72);
    grad.addColorStop(0,'rgba(0,0,0,0)');
    grad.addColorStop(1,'rgba(0,0,0,'+strength+')');
    ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
  }
  // Variation organique de teinte (pas seulement de luminosité) : les
  // matériaux naturels (terre, herbe, sable, bois) ne sont jamais
  // uniformément plus clairs/sombres, leur teinte dérive aussi un peu —
  // ça évite l'effet "photocopie" d'un multiplyScalar seul.
  function hueJitter(color, hueAmt=0.02, satAmt=0.12, lightAmt=0.16){
    const hsl = {h:0,s:0,l:0}; color.getHSL(hsl);
    const c2 = new THREE.Color();
    c2.setHSL(
      (hsl.h + (Math.random()-0.5)*hueAmt + 1) % 1,
      Math.max(0,Math.min(1, hsl.s + (Math.random()-0.5)*satAmt)),
      Math.max(0,Math.min(1, hsl.l + (Math.random()-0.5)*lightAmt))
    );
    return c2;
  }
  // Béton/crépi : grain moucheté + coulures verticales discrètes
  function texConcrete(baseHex){
    return cachedTexture('concrete_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<2200;i++){
        const shade = base.clone().multiplyScalar(0.82+Math.random()*0.34);
        ctx.globalAlpha = 0.12+Math.random()*0.18;
        ctx.fillStyle = '#'+shade.getHexString();
        const s=1+Math.random()*2.2;
        ctx.fillRect(Math.random()*256,Math.random()*256,s,s);
      }
      ctx.globalAlpha=1;
      for(let i=0;i<6;i++){
        ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth=2+Math.random()*3;
        ctx.beginPath(); const x=Math.random()*256;
        ctx.moveTo(x,0); ctx.lineTo(x+(Math.random()-0.5)*24,256); ctx.stroke();
      }
      // grain fin supplémentaire (échelle sub-pixel) pour casser l'aspect
      // "aplat" et suggérer une surface rugueuse de près
      for(let i=0;i<3500;i++){
        ctx.globalAlpha = 0.05+Math.random()*0.06;
        ctx.fillStyle = Math.random()<0.5 ? '#000' : '#fff';
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.14);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Brique : rangs décalés + joints de mortier clairs
  function texBrick(baseHex){
    return cachedTexture('brick_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#c9c2b0'; ctx.fillRect(0,0,256,256); // mortier
      const bw=32, bh=14, gap=3;
      for(let row=0; row*bh<256+bh; row++){
        const offset = (row%2===0) ? 0 : bw/2;
        for(let col=-1; col*bw<256+bw; col++){
          const shade = base.clone().multiplyScalar(0.85+Math.random()*0.3);
          ctx.fillStyle = '#'+shade.getHexString();
          ctx.fillRect(col*bw+offset+gap/2, row*bh+gap/2, bw-gap, bh-gap);
        }
      }
      return new THREE.CanvasTexture(cv);
    });
  }
  // Panneau métallique corrugué : alternance de bandes claires/sombres
  function texCorrugated(baseHex){
    return cachedTexture('corrugated_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=512; cv.height=128;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = new THREE.Color(baseHex);
      for(let x=0;x<256;x+=8){
        const shade = base.clone().multiplyScalar(x%16===0 ? 0.78 : 1.12);
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(x,0,8,64);
      }
      return new THREE.CanvasTexture(cv);
    });
  }
  // Vitrage rideau (façade bureau/tour) : grille de vitres + reflet dégradé
  function texGlassCurtain(baseHex){
    return cachedTexture('glass_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const grad = ctx.createLinearGradient(0,0,256,256);
      const base = new THREE.Color(baseHex);
      grad.addColorStop(0, '#'+base.clone().multiplyScalar(1.25).getHexString());
      grad.addColorStop(0.5, '#'+base.getHexString());
      grad.addColorStop(1, '#'+base.clone().multiplyScalar(0.8).getHexString());
      ctx.fillStyle = grad; ctx.fillRect(0,0,256,256);
      ctx.strokeStyle = 'rgba(20,25,30,0.5)'; ctx.lineWidth=3;
      for(let i=0;i<=8;i++){ ctx.beginPath(); ctx.moveTo(i*32,0); ctx.lineTo(i*32,256); ctx.stroke(); }
      for(let i=0;i<=8;i++){ ctx.beginPath(); ctx.moveTo(0,i*32); ctx.lineTo(256,i*32); ctx.stroke(); }
      return new THREE.CanvasTexture(cv);
    });
  }
  // Pierre de taille / stuc urbain : blocs irréguliers avec liserés
  function texStuc(baseHex){
    return cachedTexture('stuc_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth=2;
      for(let y=0;y<256;y+=42){
        const offset = (y/42)%2===0 ? 0 : 30;
        for(let x=-30;x<256+60;x+=60){
          ctx.strokeRect(x+offset,y,60,42);
        }
      }
      for(let i=0;i<600;i++){
        const shade = base.clone().multiplyScalar(0.9+Math.random()*0.2);
        ctx.globalAlpha=0.1; ctx.fillStyle='#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,2,2);
      }
      ctx.globalAlpha=1;
      return new THREE.CanvasTexture(cv);
    });
  }
  // Bois : lattes horizontales avec fibre du bois (traits fins irréguliers) + nœuds
  function texWoodFloor(baseHex){
    return cachedTexture('woodfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      for(let row=0;row<8;row++){
        const shade = hueJitter(base, 0.015, 0.08, 0.2);
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(0,row*32,256,32);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(0,row*32); ctx.lineTo(256,row*32); ctx.stroke();
        // plusieurs passes de fibres à densité/opacité variables — une
        // seule passe uniforme trahit trop vite le motif procédural
        for(let i=0;i<9;i++){
          ctx.strokeStyle = 'rgba(0,0,0,'+(0.04+Math.random()*0.08)+')'; ctx.lineWidth=0.4+Math.random()*0.8;
          ctx.beginPath(); const y=row*32+2+Math.random()*28;
          ctx.moveTo(0,y); ctx.bezierCurveTo(80,y+(Math.random()-0.5)*8,180,y+(Math.random()-0.5)*8,256,y); ctx.stroke();
        }
        // léger lustre longitudinal (variation de réflexion du bois ciré)
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0,row*32+2,256,6);
        ctx.globalAlpha = 1;
        if(Math.random()<0.5){
          const kx=Math.random()*256, ky=row*32+16;
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath(); ctx.ellipse(kx,ky,4,6,0,0,Math.PI*2); ctx.fill();
        }
      }
      addVignette(ctx,256,0.15);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Herbe : moucheté vert dense (base de la pelouse, sous les touffes 3D)
  function texGrassFloor(baseHex){
    return cachedTexture('grassfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      // touffes claires/sombres à large échelle (variation d'humidité du
      // gazon) avant le mouchetis fin, pour éviter l'aspect "bruit uniforme"
      for(let i=0;i<26;i++){
        const patch = hueJitter(base, 0.03, 0.15, 0.12);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#'+patch.getHexString();
        const r = 14+Math.random()*22;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.7,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<4000;i++){
        const shade = base.clone().multiplyScalar(0.7+Math.random()*0.55);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1.5,1.5);
      }
      // brins d'herbe individuels (petits traits courts orientés
      // aléatoirement) en surimpression du mouchetis, à densité modérée
      for(let i=0;i<900;i++){
        const shade = base.clone().multiplyScalar(0.55+Math.random()*0.7);
        ctx.strokeStyle = '#'+shade.getHexString();
        ctx.globalAlpha = 0.4+Math.random()*0.3;
        ctx.lineWidth = 0.6;
        const x=Math.random()*256, y=Math.random()*256, len=2+Math.random()*3, ang=Math.random()*Math.PI;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+Math.cos(ang)*len,y-Math.sin(ang)*len); ctx.stroke();
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.16);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Sable : grain fin + ondulations douces
  function texSandFloor(baseHex){
    return cachedTexture('sandfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<3000;i++){
        const shade = base.clone().multiplyScalar(0.85+Math.random()*0.3);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      for(let i=0;i<10;i++){
        ctx.strokeStyle = 'rgba(0,0,0,0.04)'; ctx.lineWidth=3+Math.random()*3;
        ctx.beginPath(); const y=Math.random()*256;
        ctx.moveTo(0,y); ctx.bezierCurveTo(85,y+10,170,y-10,256,y); ctx.stroke();
      }
      // quelques grains plus gros et plus foncés (débris/coquillages
      // broyés) épars pour casser l'uniformité du sable fin
      for(let i=0;i<80;i++){
        const shade = base.clone().multiplyScalar(0.55+Math.random()*0.3);
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.globalAlpha = 0.5;
        ctx.fillRect(Math.random()*256,Math.random()*256,1.5+Math.random()*1.5,1.5+Math.random()*1.5);
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.13);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Sable du désert : dunes chaudes (ocre/orangé), rides de vent plus
  // marquées et courbes que le sable de plage, pas de coquillages, un
  // soupçon de craquelures sèches par endroits.
  function texDesertSandFloor(baseHex){
    return cachedTexture('desertsand_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      // zones de dune (plus claires côté "vent", plus sombres côté "abri")
      for(let i=0;i<16;i++){
        const patch = hueJitter(base, 0.02, 0.15, 0.18);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#'+patch.getHexString();
        const r = 20+Math.random()*30;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.5,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<2800;i++){
        const shade = base.clone().multiplyScalar(0.82+Math.random()*0.32);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      // rides de vent : bandes courbes régulières et marquées, plus
      // resserrées que les ondulations de plage
      for(let i=0;i<16;i++){
        ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth=2+Math.random()*2;
        const y = i*17 + Math.random()*6;
        ctx.beginPath(); ctx.moveTo(0,y);
        ctx.bezierCurveTo(64,y+14,192,y-14,256,y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.moveTo(0,y+2);
        ctx.bezierCurveTo(64,y+16,192,y-12,256,y+2);
        ctx.stroke();
      }
      addVignette(ctx,256,0.15);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Sable fin clair : grain très fin et régulier, presque poudreux,
  // couleur pâle — sol "propre" (bac à sable, allée...) sans relief marqué.
  function texFineSandFloor(baseHex){
    return cachedTexture('finesand_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<5000;i++){
        const shade = base.clone().multiplyScalar(0.92+Math.random()*0.16);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      // quelques petites empreintes/creux subtils (marche, ratissage léger)
      for(let i=0;i<4;i++){
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = '#000';
        const r = 8+Math.random()*6;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.6,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.1);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Sable rocailleux : sable grossier mêlé de nombreux galets/graviers de
  // tailles variées, comme une plage de galets ou un lit de rivière sec.
  function texRockySandFloor(baseHex){
    return cachedTexture('rockysand_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<2600;i++){
        const shade = base.clone().multiplyScalar(0.8+Math.random()*0.35);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      // galets de tailles et tons variés, avec ombre portée
      for(let i=0;i<95;i++){
        const x=Math.random()*256, y=Math.random()*256, r=1.5+Math.random()*4.5;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath(); ctx.ellipse(x+0.8,y+1,r*1.05,r*0.8,0,0,Math.PI*2); ctx.fill();
        const tone = Math.random()<0.6
          ? base.clone().multiplyScalar(0.55+Math.random()*0.4)
          : new THREE.Color(0x9a958a).multiplyScalar(0.7+Math.random()*0.5);
        ctx.fillStyle = '#'+tone.getHexString();
        ctx.beginPath(); ctx.ellipse(x,y,r,r*0.8,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth=0.6;
        ctx.beginPath(); ctx.ellipse(x-r*0.25,y-r*0.25,r*0.4,r*0.25,0,0,Math.PI*2); ctx.stroke();
      }
      addVignette(ctx,256,0.16);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Carrelage : grille nette + très léger lustre
  function texTileFloor(baseHex){
    return cachedTexture('tilefloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      const grad = ctx.createLinearGradient(0,0,256,256);
      grad.addColorStop(0,'rgba(255,255,255,0.12)'); grad.addColorStop(1,'rgba(0,0,0,0.05)');
      ctx.fillStyle = grad; ctx.fillRect(0,0,256,256);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth=2.5;
      for(let i=0;i<=4;i++){ ctx.beginPath(); ctx.moveTo(i*64,0); ctx.lineTo(i*64,256); ctx.stroke(); }
      for(let i=0;i<=4;i++){ ctx.beginPath(); ctx.moveTo(0,i*64); ctx.lineTo(256,i*64); ctx.stroke(); }
      // légères taches d'usure/salissure sur quelques carreaux, pour ne
      // pas avoir un carrelage neuf immaculé partout
      for(let i=0;i<5;i++){
        ctx.globalAlpha = 0.06+Math.random()*0.06;
        ctx.fillStyle = '#000';
        const r = 6+Math.random()*10;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.6,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.1);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Métal / caillebotis : trame croisée avec reflets
  function texMetalFloor(baseHex){
    return cachedTexture('metalfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.clone().multiplyScalar(0.85).getHexString(); ctx.fillRect(0,0,256,256);
      for(let x=0;x<256;x+=16){
        const shade = base.clone().multiplyScalar(x%32===0 ? 1.3 : 0.75);
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(x,0,4,256);
      }
      for(let y=0;y<256;y+=16){
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0,y,256,3);
      }
      // traces de rouille/usure éparses — un métal parfaitement propre
      // sonne toujours artificiel dans une scène industrielle
      for(let i=0;i<220;i++){
        ctx.globalAlpha = 0.08+Math.random()*0.12;
        ctx.fillStyle = Math.random()<0.6 ? '#8a4a24' : '#000';
        ctx.fillRect(Math.random()*256,Math.random()*256,1+Math.random()*2,1+Math.random()*2);
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.18);
      return new THREE.CanvasTexture(cv);
    });
  }
  // ---- Sols "terre" (mode terre) ----
  // Terre battue : sol de terre compactée, mouchetis brun/ocre à large
  // échelle (mottes) + grain fin, quelques cailloux et un réseau de
  // fissures fines dues au tassement.
  function texDirtFloor(baseHex){
    return cachedTexture('dirtfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      // mottes de terre (large échelle, teinte variable)
      for(let i=0;i<34;i++){
        const patch = hueJitter(base, 0.02, 0.18, 0.2);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#'+patch.getHexString();
        const r = 10+Math.random()*20;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*(0.6+Math.random()*0.4),Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      // grain fin dense
      for(let i=0;i<3800;i++){
        const shade = base.clone().multiplyScalar(0.65+Math.random()*0.6);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1+Math.random(),1+Math.random());
      }
      ctx.globalAlpha=1;
      // petits cailloux sombres épars
      for(let i=0;i<40;i++){
        const shade = base.clone().multiplyScalar(0.35+Math.random()*0.25);
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,1+Math.random()*1.8,1+Math.random()*1.3,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      // fines fissures de tassement
      for(let i=0;i<7;i++){
        ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth=0.8+Math.random();
        let x=Math.random()*256,y=Math.random()*256; ctx.beginPath(); ctx.moveTo(x,y);
        for(let s=0;s<4;s++){ x+=(Math.random()-0.5)*40; y+=(Math.random()-0.5)*40; ctx.lineTo(x,y); }
        ctx.stroke();
      }
      addVignette(ctx,256,0.18);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Boue : terre détrempée sombre avec flaques luisantes et
  // éclaboussures ; contraste fort entre zones sèches et zones humides.
  function texMudFloor(baseHex){
    return cachedTexture('mudfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.clone().multiplyScalar(0.8).getHexString(); ctx.fillRect(0,0,256,256);
      // zones plus sombres/humides à large échelle
      for(let i=0;i<24;i++){
        const patch = base.clone().multiplyScalar(0.55+Math.random()*0.5);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#'+patch.getHexString();
        const r = 16+Math.random()*26;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.65,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<2600;i++){
        const shade = base.clone().multiplyScalar(0.55+Math.random()*0.55);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1.3,1.3);
      }
      ctx.globalAlpha=1;
      // flaques : disque sombre + reflet clair en croissant (aspect mouillé)
      for(let i=0;i<5;i++){
        const px=Math.random()*256, py=Math.random()*256, pr=8+Math.random()*16;
        ctx.fillStyle = 'rgba(10,12,10,0.45)';
        ctx.beginPath(); ctx.ellipse(px,py,pr,pr*0.55,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.ellipse(px-pr*0.2,py-pr*0.15,pr*0.35,pr*0.16,0.4,0,Math.PI*2); ctx.fill();
      }
      addVignette(ctx,256,0.2);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Terre craquelée (sécheresse) : argile claire couverte d'un réseau de
  // fissures façon lit de rivière asséché.
  function texCrackedEarthFloor(baseHex){
    return cachedTexture('crackedearth_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<20;i++){
        const patch = hueJitter(base, 0.015, 0.12, 0.14);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#'+patch.getHexString();
        const r = 14+Math.random()*22;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.7,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<2800;i++){
        const shade = base.clone().multiplyScalar(0.75+Math.random()*0.4);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      // réseau de fissures façon plaques (marches aléatoires ramifiées
      // depuis quelques points de départ, avec branches secondaires)
      const seams = base.clone().multiplyScalar(0.42).getHexString();
      function crackBranch(x,y,len,width){
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = width;
        let ang = Math.random()*Math.PI*2;
        ctx.beginPath(); ctx.moveTo(x,y);
        for(let s=0;s<len;s++){
          ang += (Math.random()-0.5)*0.9;
          x += Math.cos(ang)*8; y += Math.sin(ang)*8;
          ctx.lineTo(x,y);
          if(Math.random()<0.18 && width>0.6) crackBranch(x,y,len*0.5,width*0.6);
        }
        ctx.stroke();
      }
      for(let i=0;i<9;i++) crackBranch(Math.random()*256,Math.random()*256, 6+Math.random()*6, 1.6);
      void seams;
      addVignette(ctx,256,0.15);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Chemin de terre caillouteux : terre battue parsemée de nombreux
  // petits cailloux/graviers de tons variés, avec ombre portée sommaire
  // sous chacun pour suggérer le relief.
  function texGravelDirtFloor(baseHex){
    return cachedTexture('graveldirt_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<28;i++){
        const patch = hueJitter(base, 0.02, 0.15, 0.18);
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#'+patch.getHexString();
        const r = 12+Math.random()*18;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.7,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<3200;i++){
        const shade = base.clone().multiplyScalar(0.65+Math.random()*0.55);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1+Math.random(),1+Math.random());
      }
      ctx.globalAlpha=1;
      // gravier : ombre + galet, tons gris/brun variés
      for(let i=0;i<130;i++){
        const x=Math.random()*256, y=Math.random()*256, r=1.2+Math.random()*2.6;
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.ellipse(x+0.7,y+0.9,r*1.05,r*0.85,0,0,Math.PI*2); ctx.fill();
        const tone = Math.random()<0.5
          ? base.clone().multiplyScalar(0.5+Math.random()*0.3)
          : new THREE.Color(0x8a877e).multiplyScalar(0.7+Math.random()*0.5);
        ctx.fillStyle = '#'+tone.getHexString();
        ctx.beginPath(); ctx.ellipse(x,y,r,r*0.85,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      addVignette(ctx,256,0.17);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Pavé (pierre taillée) : dallage de pavés irréguliers séparés par des
  // joints de mortier sombres, chaque pavé ayant sa propre teinte et un
  // léger biseau clair/sombre pour suggérer le relief entre les blocs.
  function texPaveFloor(baseHex){
    return cachedTexture('pavefloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      // fond = couleur des joints (mortier/sable entre les pavés)
      ctx.fillStyle = '#'+base.clone().multiplyScalar(0.45).getHexString();
      ctx.fillRect(0,0,256,256);
      const rows = 7, cols = 7, cw = 256/cols, ch = 256/rows, joint = 2.6;
      for(let row=-1; row<rows+1; row++){
        const offset = (row%2===0) ? 0 : cw/2;
        for(let col=-1; col<cols+1; col++){
          const jx = (Math.random()-0.5)*3, jy = (Math.random()-0.5)*3;
          const x = col*cw + offset + joint/2 + jx;
          const y = row*ch + joint/2 + jy;
          const w = cw - joint + (Math.random()-0.5)*3;
          const h = ch - joint + (Math.random()-0.5)*3;
          const stone = hueJitter(base, 0.02, 0.15, 0.22);
          ctx.fillStyle = '#'+stone.getHexString();
          ctx.beginPath();
          if(ctx.roundRect) ctx.roundRect(x,y,w,h,2); else ctx.rect(x,y,w,h);
          ctx.fill();
          // biseau : liseré clair en haut/gauche, sombre en bas/droite
          ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth=1.4;
          ctx.beginPath(); ctx.moveTo(x+1,y+h-1); ctx.lineTo(x+1,y+1); ctx.lineTo(x+w-1,y+1); ctx.stroke();
          ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth=1.4;
          ctx.beginPath(); ctx.moveTo(x+w-1,y+1); ctx.lineTo(x+w-1,y+h-1); ctx.lineTo(x+1,y+h-1); ctx.stroke();
          // grain de pierre à l'intérieur du pavé
          for(let g=0;g<10;g++){
            ctx.globalAlpha = 0.08+Math.random()*0.1;
            ctx.fillStyle = Math.random()<0.5 ? '#000' : '#fff';
            ctx.fillRect(x+Math.random()*w, y+Math.random()*h, 1, 1);
          }
          ctx.globalAlpha=1;
        }
      }
      addVignette(ctx,256,0.16);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Neige : blanc cassé avec renflements doux (congères) et un léger
  // scintillement (petits points plus clairs/plus sombres épars, pas de
  // motif dur) — reste crédible même sous le soleil du cycle jour/nuit.
  function texSnowFloor(baseHex){
    return cachedTexture('snowfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<20;i++){
        const patch = base.clone().multiplyScalar(0.94+Math.random()*0.12);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#'+patch.getHexString();
        const r = 18+Math.random()*26;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.65,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<3500;i++){
        const shade = base.clone().multiplyScalar(0.9+Math.random()*0.2);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      // ombres bleutées douces dans les creux (la neige n'est jamais un
      // blanc plat — elle capte le bleu du ciel dans ses ombres)
      for(let i=0;i<8;i++){
        ctx.globalAlpha = 0.05+Math.random()*0.05;
        ctx.fillStyle = '#2a5ca0';
        const r = 12+Math.random()*16;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.5,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      // scintillement épars (quelques pixels très clairs, façon cristaux)
      for(let i=0;i<60;i++){
        ctx.globalAlpha = 0.4+Math.random()*0.4;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.1);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Glace : surface lisse avec de longues fissures blanchâtres
  // (fractures internes typiques d'un lac gelé) et un voile clair
  // simulant la réflexion diffuse de la lumière sur la surface.
  function texIceFloor(baseHex){
    return cachedTexture('icefloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<14;i++){
        const patch = hueJitter(base, 0.02, 0.1, 0.1);
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#'+patch.getHexString();
        const r = 20+Math.random()*30;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.6,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      // fractures internes (traits fins blanchâtres, en réseau anguleux)
      for(let i=0;i<7;i++){
        let x=Math.random()*256, y=Math.random()*256, ang=Math.random()*Math.PI*2;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth=0.8+Math.random();
        ctx.beginPath(); ctx.moveTo(x,y);
        for(let s=0;s<5;s++){
          ang += (Math.random()-0.5)*1.1;
          x += Math.cos(ang)*18; y += Math.sin(ang)*18;
          ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
      // voile de lumière diffuse (grand halo doux décentré)
      const glow = ctx.createRadialGradient(90,80,10,90,80,150);
      glow.addColorStop(0,'rgba(255,255,255,0.25)');
      glow.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle = glow; ctx.fillRect(0,0,256,256);
      addVignette(ctx,256,0.14);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Pierre naturelle : blocs irréguliers de tailles variées + joints de
  // mortier clairs (contrairement à texStuc, plus taillé/régulier).
  function texStoneBlock(baseHex){
    return cachedTexture('stoneblock_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#8f8878'; ctx.fillRect(0,0,256,256);
      let y=0;
      while(y<256){
        const bh=28+Math.random()*18; let x=-Math.random()*40;
        while(x<256){
          const bw=40+Math.random()*45;
          const shade = base.clone().multiplyScalar(0.8+Math.random()*0.4);
          ctx.fillStyle = '#'+shade.getHexString();
          ctx.fillRect(x+2,y+2,bw-4,bh-4);
          x+=bw;
        }
        y+=bh;
      }
      for(let i=0;i<500;i++){ ctx.globalAlpha=0.08; ctx.fillStyle=Math.random()<0.5?'#000':'#fff'; ctx.fillRect(Math.random()*256,Math.random()*256,2,2); }
      ctx.globalAlpha=1; addVignette(ctx,256,0.16);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Marbre : fond clair + réseau de veines fines organiques.
  function texMarble(baseHex){
    return cachedTexture('marble_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<9;i++){
        let x=Math.random()*256, y=0;
        ctx.strokeStyle = 'rgba(120,120,130,0.35)'; ctx.lineWidth=0.6+Math.random()*1.6;
        ctx.beginPath(); ctx.moveTo(x,y);
        for(let s=0;s<10;s++){ x+=(Math.random()-0.5)*40; y+=26; ctx.lineTo(x,y); }
        ctx.stroke();
      }
      addVignette(ctx,256,0.1);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Granit : mouchetis dense clair/sombre à petite échelle.
  function texGranite(baseHex){
    return cachedTexture('granite_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<2600;i++){
        ctx.globalAlpha = 0.15+Math.random()*0.25;
        ctx.fillStyle = Math.random()<0.5?'#1a1a1a':(Math.random()<0.5?'#cfcfcf':'#8a8070');
        const s=1+Math.random()*2.4;
        ctx.fillRect(Math.random()*256,Math.random()*256,s,s);
      }
      ctx.globalAlpha=1; addVignette(ctx,256,0.14);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Obsidienne : verre volcanique sombre, reflet diagonal + fractures nettes.
  function texObsidian(baseHex){
    return cachedTexture('obsidian_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.clone().multiplyScalar(0.6).getHexString(); ctx.fillRect(0,0,256,256);
      const glow = ctx.createLinearGradient(0,0,256,256);
      glow.addColorStop(0,'rgba(255,255,255,0.12)'); glow.addColorStop(0.5,'rgba(255,255,255,0)'); glow.addColorStop(1,'rgba(120,80,255,0.08)');
      ctx.fillStyle = glow; ctx.fillRect(0,0,256,256);
      for(let i=0;i<6;i++){
        let x=Math.random()*256, y=Math.random()*256, ang=Math.random()*Math.PI*2;
        ctx.strokeStyle = 'rgba(180,160,255,0.4)'; ctx.lineWidth=0.6;
        ctx.beginPath(); ctx.moveTo(x,y);
        for(let s=0;s<6;s++){ ang+=(Math.random()-0.5)*1.4; x+=Math.cos(ang)*16; y+=Math.sin(ang)*16; ctx.lineTo(x,y); }
        ctx.stroke();
      }
      return new THREE.CanvasTexture(cv);
    });
  }
  // Cuivre : plaques verticales + coulures de patine verte.
  function texCopper(baseHex){
    return cachedTexture('copper_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let x=0;x<256;x+=20){ ctx.fillStyle='rgba(0,0,0,0.08)'; ctx.fillRect(x,0,2,256); }
      for(let i=0;i<10;i++){
        const x=Math.random()*256;
        const grad = ctx.createLinearGradient(x,0,x+8,256);
        grad.addColorStop(0,'rgba(80,150,120,0)'); grad.addColorStop(0.5,'rgba(80,150,120,0.35)'); grad.addColorStop(1,'rgba(80,150,120,0.5)');
        ctx.fillStyle = grad; ctx.fillRect(x,0,10+Math.random()*14,256);
      }
      addVignette(ctx,256,0.14);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Métal rouillé : base sombre + longues coulées de rouille orangée.
  function texRust(baseHex){
    return cachedTexture('rust_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.clone().multiplyScalar(0.8).getHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<16;i++){
        const x=Math.random()*256;
        const grad = ctx.createLinearGradient(x,0,x,256);
        const rustCol = Math.random()<0.5 ? '140,60,20' : '110,45,15';
        grad.addColorStop(0,`rgba(${rustCol},0)`); grad.addColorStop(0.4,`rgba(${rustCol},0.55)`); grad.addColorStop(1,`rgba(${rustCol},0.75)`);
        ctx.fillStyle = grad; ctx.fillRect(x,0,6+Math.random()*16,256);
      }
      for(let i=0;i<900;i++){ ctx.globalAlpha=0.1; ctx.fillStyle='#3a1c0a'; ctx.fillRect(Math.random()*256,Math.random()*256,2,2); }
      ctx.globalAlpha=1; addVignette(ctx,256,0.18);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Bambou : lattes verticales avec reflet + nœuds horizontaux sombres.
  function texBamboo(baseHex){
    return cachedTexture('bamboo_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      const sw=256/8;
      for(let i=0;i<8;i++){
        const shade = base.clone().multiplyScalar(0.85+Math.random()*0.3);
        ctx.fillStyle = '#'+shade.getHexString();
        ctx.fillRect(i*sw+1,0,sw-2,256);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(i*sw+2,0,2,256);
      }
      for(let y=20;y<256;y+=48){ ctx.fillStyle='rgba(60,50,20,0.4)'; ctx.fillRect(0,y,256,4); }
      return new THREE.CanvasTexture(cv);
    });
  }
  // Ruines : pierre irrégulière endommagée + trous d'impact + grandes fissures.
  function texRuins(baseHex){
    return cachedTexture('ruins_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#8f8878'; ctx.fillRect(0,0,256,256);
      let y=0;
      while(y<256){
        const bh=26+Math.random()*20; let x=-Math.random()*40;
        while(x<256){
          const bw=36+Math.random()*40;
          const shade = base.clone().multiplyScalar(0.7+Math.random()*0.5);
          ctx.fillStyle = '#'+shade.getHexString();
          ctx.fillRect(x+2,y+2,bw-4,bh-4);
          x+=bw;
        }
        y+=bh;
      }
      for(let i=0;i<5;i++){
        ctx.fillStyle = 'rgba(10,10,8,0.55)';
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,10+Math.random()*18,6+Math.random()*10,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      for(let i=0;i<4;i++){
        let x=Math.random()*256, y=Math.random()*256, ang=Math.random()*Math.PI*2;
        ctx.strokeStyle = 'rgba(10,10,8,0.5)'; ctx.lineWidth=1.4;
        ctx.beginPath(); ctx.moveTo(x,y);
        for(let s=0;s<6;s++){ ang+=(Math.random()-0.5)*1.2; x+=Math.cos(ang)*18; y+=Math.sin(ang)*18; ctx.lineTo(x,y); }
        ctx.stroke();
      }
      addVignette(ctx,256,0.2);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Temple : pierre claire gravée de bandeaux/caissons réguliers.
  function texTemple(baseHex){
    return cachedTexture('temple_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      ctx.fillStyle = '#'+base.getHexString(); ctx.fillRect(0,0,256,256);
      for(let y=0;y<256;y+=32){
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(256,y); ctx.stroke();
        for(let x=8;x<256;x+=32){ ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.strokeRect(x,y+6,20,20); }
      }
      addVignette(ctx,256,0.14);
      return new THREE.CanvasTexture(cv);
    });
  }
  // Grillage : lignes losangées dessinées sur fond transparent (canvas non
  // rempli), pour un effet grillage/clôture ajouré via alphaTest.
  function texChainlink(baseHex){
    return cachedTexture('chainlink_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      ctx.clearRect(0,0,256,256);
      const col = '#'+new THREE.Color(baseHex).getHexString();
      ctx.strokeStyle = col; ctx.lineWidth=1.4; ctx.globalAlpha=0.85;
      const step=16;
      for(let x=-256;x<256*2;x+=step){
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x+256,256); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x,256); ctx.lineTo(x+256,0); ctx.stroke();
      }
      ctx.globalAlpha=1;
      return new THREE.CanvasTexture(cv);
    });
  }

  // Variation de teinte par défaut, appliquée à chaque instance de
  // mkBox/mkCyl (sauf texture ou opts.noJitter) : casse l'effet "aplat
  // plastique identique partout" sur les assets qui n'ont pas encore de
  // détail de surface dédié (texture procédurale ou géométrie irrégulière) —
  // volontairement bien plus discret que le hueJitter utilisé DANS les
  // textures (voir texConcrete etc.), qui teinte des patchs, pas un mesh entier.
  function jitterInstanceColor(color, opts={}){
    if(color==null || opts.map || opts.noJitter) return color;
    return hueJitter(new THREE.Color(color), 0.01, 0.05, 0.06).getHex();
  }
  function mkBox(w,h,d,color,opts={}){
    const geo = new THREE.BoxGeometry(w,h,d);
    const mat = new THREE.MeshStandardMaterial({ color:jitterInstanceColor(color,opts), roughness:opts.roughness??0.85, metalness:opts.metalness??0.1, transparent:!!opts.opacity, opacity:opts.opacity??1 });
    if(opts.map){
      // Clone impératif : la texture vient du cache partagé (voir
      // cachedTexture) — sans clone, régler .repeat ici changerait le
      // rendu de TOUS les autres objets qui réutilisent cette même
      // texture, puisque .repeat vit sur l'objet Texture partagé.
      const tex = opts.map.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(opts.repeatX??1, opts.repeatY??1);
      mat.map = tex;
      mat.color.set(0xffffff); // laisse la texture porter la couleur, évite un double-teintage
    }
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    m.position.y = h/2;
    return m;
  }
  function mkCyl(rt,rb,h,color,segs=12,noJitter=false){
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,segs), new THREE.MeshStandardMaterial({ color:jitterInstanceColor(color,{noJitter}), roughness:0.8 }));
    m.castShadow = true; m.receiveShadow = true;
    m.position.y = h/2;
    return m;
  }
  // ---- AAA STYLIZED UPGRADE ----------------------------------------------
  // Boîte à ARÊTES RÉELLEMENT BISEAUTÉES (pas une texture de faux-biseau) :
  // on construit un rectangle 2D (w × h) qu'on extrude sur la profondeur d
  // avec bevelEnabled, ce qui chanfreine géométriquement tout le pourtour
  // aux deux extrémités de l'extrusion — exactement l'équivalent du
  // modifier "Bevel" de Blender appliqué à un cube. C'est ce chanfrein qui
  // capte une ligne de lumière/ombre nette sous n'importe quel angle FPS et
  // évite l'effet "bloc gris/prototype" décrit dans le brief Valorant-style.
  function mkBevelBox(w,h,d,color,opts={}){
    const bevel = Math.min(opts.bevel ?? Math.min(w,h,d)*0.09, Math.min(w,h,d)*0.4);
    const hw=w/2, hh=h/2;
    const shape = new THREE.Shape();
    shape.moveTo(-hw,-hh); shape.lineTo(hw,-hh); shape.lineTo(hw,hh); shape.lineTo(-hw,hh); shape.lineTo(-hw,-hh);
    const coreDepth = Math.max(0.005, d - bevel*2);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: coreDepth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel*0.92,
      bevelSegments: opts.bevelSegments ?? 2,
      curveSegments: 1
    });
    geo.translate(0,0,-d/2);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color, roughness:opts.roughness??0.55, metalness:opts.metalness??0.2, transparent:!!opts.opacity, opacity:opts.opacity??1 });
    if(opts.map){
      const tex = opts.map.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(opts.repeatX??1, opts.repeatY??1);
      mat.map = tex;
      mat.color.set(0xffffff);
    }
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    m.position.y = h/2;
    return m;
  }
  // Matériau "stylisé Valorant" : gradient doux vertical (plus clair en
  // haut, plus sombre en bas — lecture cohérente sous éclairage ambiant
  // + faux contact-AO) et usure PEINTE concentrée sur les bords/coins
  // (jamais un bruit uniforme sur toute la surface, ce qui casserait la
  // lisibilité silhouette en jeu). Mise en cache comme les autres textures
  // procédurales du fichier.
  function texStylizedPanel(baseHex, wearHex=0x2e3238){
    return cachedTexture('stylpanel_'+baseHex+'_'+wearHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2); // grain/détail 2x plus fin sans toucher aux coordonnées 0-256 déjà utilisées partout dans ces générateurs
      const base = new THREE.Color(baseHex);
      const top = base.clone().multiplyScalar(1.14);
      const bottom = base.clone().multiplyScalar(0.85);
      const grad = ctx.createLinearGradient(0,0,0,256);
      grad.addColorStop(0, '#'+top.getHexString());
      grad.addColorStop(1, '#'+bottom.getHexString());
      ctx.fillStyle = grad; ctx.fillRect(0,0,256,256);
      // écaillures de peinture localisées près des bords (zones de contact/impact
      // réalistes), jamais réparties uniformément sur toute la surface
      const wear = new THREE.Color(wearHex);
      for(let i=0;i<60;i++){
        const edge = Math.floor(Math.random()*4);
        let x,y;
        if(edge===0){ x=Math.random()*256; y=Math.random()*16; }
        else if(edge===1){ x=Math.random()*256; y=256-Math.random()*16; }
        else if(edge===2){ x=Math.random()*16; y=Math.random()*256; }
        else { x=256-Math.random()*16; y=Math.random()*256; }
        ctx.globalAlpha = 0.25+Math.random()*0.35;
        ctx.fillStyle = '#'+wear.getHexString();
        const s=1.5+Math.random()*3;
        ctx.fillRect(x,y,s,s);
      }
      ctx.globalAlpha = 1;
      addVignette(ctx,256,0.18);
      return new THREE.CanvasTexture(cv);
    });
  }
  function group(...children){
    const g = new THREE.Group();
    children.forEach(c=> g.add(c));
    return g;
  }
  // Étiquette flottante (canvas -> texture -> Sprite) : toujours face
  // caméra, utilisée pour les lettres de site ("A", "B"...) et les
  // libellés de spawn — bien plus lisible qu'un texte 3D modélisé.
  function mkTextSprite(text, bgColor, textColor='#0a0e16', size=1.6){
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bgColor; ctx.beginPath();
    ctx.arc(64,64,60,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.font = '800 64px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map:tex, depthTest:false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(size,size,1);
    sprite.renderOrder = 999;
    return sprite;
  }
  // Zone au sol (site/spawn) : disque plat coloré + anneau + étiquette
  // flottante au-dessus — jamais d'ombre projetée (marqueur, pas un vrai
  // volume), reçoit celle des objets posés dessus.
  function mkZonePad(radius, color, letter, letterBg){
    const g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,0.05,32), new THREE.MeshStandardMaterial({ color, transparent:true, opacity:0.35, roughness:0.9 }));
    pad.position.y = 0.03; pad.receiveShadow = true; pad.castShadow = false;
    g.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius-0.15,radius,32), new THREE.MeshBasicMaterial({ color, side:THREE.DoubleSide }));
    ring.rotation.x = -Math.PI/2; ring.position.y = 0.06;
    g.add(ring);
    if(letter){
      const label = mkTextSprite(letter, letterBg||('#'+color.toString(16).padStart(6,'0')));
      label.position.y = 2.4;
      g.add(label);
    }
    return g;
  }

  // Chaque définition : { id, cat, label, icon, color, size:[l,w,h], build(color) }
  // build() reçoit la couleur COURANTE (modifiable depuis l'inspecteur) et
  // reconstruit la géométrie — nécessaire puisque changer juste .color sur
  // un matériau partagé affecterait tous les clones du même asset.
  const ASSETS = [];
  // ---- Biomes : pas des objets qu'on pose un par un comme le reste de
  // la palette — un clic régénère tout l'anneau de terrain autour de la
  // carte avec CE biome à 100% (voir regenerateBiomeRing() plus bas,
  // déclenché depuis mkAssetItem() via le flag isBiome). "Mixte" est le
  // comportement par défaut (les 11 biomes mélangés avec des transitions
  // douces) ; les autres couvrent tout l'anneau d'un seul biome. Les clés
  // (biomeKey) correspondent exactement aux entrées de BIOME_NAMES dans
  // regenerateBiomeRing() plus bas — les deux listes doivent rester
  // synchronisées.
  const BIOME_ASSET_DEFS = [
    { biomeKey:'mixed',     label:'Mixte (par défaut)',        icon:'🗺️', color:0x5c8a4a },
    { biomeKey:'tropical',  label:'Forêt tropicale',           icon:'🌴', color:0x1f6b3a },
    { biomeKey:'desert',    label:'Désert',                    icon:'🏜️', color:0xdba653 },
    { biomeKey:'savanna',   label:'Savane',                    icon:'🌾', color:0xb9a052 },
    { biomeKey:'tundra',    label:'Toundra',                   icon:'❄️', color:0xc7d1cc },
    { biomeKey:'taiga',     label:'Taïga (forêt boréale)',     icon:'🌲', color:0x2e4d38 },
    { biomeKey:'mountain',  label:'Montagne',                  icon:'⛰️', color:0x8a8578 },
    { biomeKey:'swamp',     label:'Marais / zone humide',      icon:'🌿', color:0x4a5a3a },
    { biomeKey:'canyon',    label:'Canyon rocheux',            icon:'🪨', color:0xa8623f },
    { biomeKey:'prairie',   label:'Prairie / plaine fleurie',  icon:'🌸', color:0x5fa347 },
    { biomeKey:'city',      label:'Ville futuriste',           icon:'🏙️', color:0x6b6e73 },
    { biomeKey:'temperate', label:'Forêt tempérée',            icon:'🌲', color:0x3f6b32 },
  ];
  BIOME_ASSET_DEFS.forEach(def=>{
    // build() renvoie un Group vide (rien à afficher/sélectionner dans le
    // viewport) : ce marqueur ne sert qu'à faire voyager le choix de
    // biome à travers serializeMap()/loadMapFromJson()/MAP_DATA sans
    // toucher au format d'export ni à la logique de placement existante
    // — le moteur de match (buildAsset) le repère par son id et l'utilise
    // pour choisir la couleur du sol et le décor autour de la carte, voir
    // valorant_ai_match.html/_outpost.html.
    ASSETS.push({ id:'biome_'+def.biomeKey, cat:'biomes', label:def.label, icon:def.icon, color:def.color, size:[1,1,1], isBiome:true, biomeKey:def.biomeKey, build:()=> new THREE.Group() });
  });
  function registerAsset(def){ ASSETS.push(def); return def; }

  // Petit utilitaire : ajoute des lignes/rainures fines en surépaisseur sur
  // une face (panneaux, joints de coffrage, lattes de palette...) sans
  // dépendre de textures — juste des boîtes très fines superposées.
  // Grille de fenêtres sur UNE face d'un bâtiment (vue depuis +Z par
  // défaut) : cadre clair + vitrage teinté, répété en grille cols×rows.
  // `face` choisit quelle face habiller ('z','-z','x','-x') pour couvrir
  // plusieurs côtés d'un même bâtiment sans dupliquer le code.
  function addWindowGrid(parent, cols, rows, faceW, faceH, depth, face='z', winColor=0x9dd8e0){
    const marginX = faceW*0.12;
    const usableW = faceW - marginX*2, usableH = faceH*0.62;
    const cw = usableW/cols, ch = usableH/rows;
    // Épaisseur FIXE du cadre/vitrage (jamais liée à la profondeur du
    // bâtiment !) — c'était le vrai bug : `depth` servait à la fois de
    // décalage vers la façade ET d'épaisseur de la boîte elle-même, donc
    // passer la profondeur du bâtiment (ex: 10) créait des fenêtres
    // ÉPAISSES DE 10 UNITÉS qui traversaient tout le bâtiment de part en
    // part et dépassaient largement à l'extérieur.
    const thickness = 0.12;
    for(let ix=0; ix<cols; ix++) for(let iy=0; iy<rows; iy++){
      const wx = -faceW/2 + marginX + cw*(ix+0.5);
      const wy = faceH*0.2 + ch*(iy+0.5);
      const frame = mkBox(cw*0.82, ch*0.72, thickness, 0x2a2e33);
      const glass = mkBox(cw*0.7, ch*0.58, thickness+0.02, winColor, {opacity:0.55,metalness:0.1,roughness:0.08});
      frame.castShadow = false; glass.castShadow = false;
      // `depth` reste bien le paramètre "profondeur totale du bâtiment sur
      // cet axe + petite marge" passé par l'appelant — /2 donne la vraie
      // distance du centre à la face, seule utilisation légitime de cette
      // valeur (la boîte elle-même ne s'en sert plus, voir `thickness`).
      const faceOffset = depth/2;
      const offset = face==='z' ? [wx, wy, faceOffset] : face==='-z' ? [wx, wy, -faceOffset]
                   : face==='x' ? [faceOffset, wy, wx] : [-faceOffset, wy, wx];
      frame.position.set(offset[0], offset[1], offset[2]);
      glass.position.set(offset[0], offset[1], offset[2]);
      if(face==='x'||face==='-x'){ frame.rotation.y = Math.PI/2; glass.rotation.y = Math.PI/2; }
      parent.add(frame, glass);
    }
  }
  function addSeams(parent, count, w, h, d, axis, color, thickness=0.02){
    for(let i=1;i<count;i++){
      const t = i/count;
      if(axis==='y'){
        const seam = mkBox(w+0.02, thickness, d+0.02, color);
        seam.position.y = h*t + 0.001; // ligne horizontale à la hauteur t du mur (mkBox grounde le mur en 0..h, pas -h/2..h/2 — l'ancienne formule plaçait les joints jusqu'à h/2 sous le sol)
        seam.castShadow = false;
        parent.add(seam);
      } else {
        const seam = mkBox(thickness, h+0.02, d+0.02, color);
        seam.position.set(w*t - w/2, h/2, 0); // ligne verticale à la position t sur la largeur
        seam.castShadow = false;
        parent.add(seam);
      }
    }
  }

  // ---- MURS ---- chaque mur combine plusieurs volumes (panneau principal
  // + détails : joints, rivets, vitrage, tuyauterie, sacs de sable...)
  // plutôt qu'une seule boîte plate, pour une lecture beaucoup plus riche
  // en jeu tout en restant procédural (aucune texture externe requise).
  registerAsset({ id:'wall_concrete', cat:'walls', family:'Modulaire', subKey:'concrete', label:'Béton', icon:'🧱', color:0x8a8a86, size:[4,0.4,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.4,c,{map:texConcrete(c),repeatX:2,repeatY:1.5}));
      addSeams(g, 4, 4, 3, 0.4, 'y', 0x6f6f6b, 0.025); // joints de coffrage horizontaux
      addSeams(g, 3, 4, 3, 0.4, 'x', 0x6f6f6b, 0.02);
      // éclat/impact visible sur un des panneaux + coulure d'humidité
      const chip = mkBox(0.35,0.25,0.42,0x76766f); chip.position.set(1.1,0.6,0); chip.rotation.y=0.2; g.add(chip);
      const stain = mkBox(0.18,1.1,0.42,0x5f5f57,{opacity:0.35}); stain.position.set(-1.3,2.1,0); g.add(stain);
      // panneau de signalisation + boulons d'ancrage aux 4 coins + mousse/lichen en pied
      const sign = mkBox(0.6,0.6,0.03,0xf0c020); sign.position.set(0,2.3,0.21); g.add(sign);
      const signMark = mkBox(0.4,0.06,0.035,0x1c1c1c); signMark.position.set(0,2.3,0.225); g.add(signMark);
      [[-1.9,0.2],[1.9,0.2],[-1.9,2.8],[1.9,2.8]].forEach(([bx,by])=>{
        const bolt = mkCyl(0.05,0.05,0.05,0x3a3a3a,8);
        bolt.rotation.x = Math.PI/2; bolt.position.set(bx,by,0.21);
        g.add(bolt);
      });
      const moss = mkBox(0.9,0.4,0.42,0x4f6a3a,{opacity:0.4});
      moss.position.set(1.4,0.2,0); moss.castShadow=false; g.add(moss);
      return g;
    }});
  registerAsset({ id:'wall_steel', cat:'walls', family:'Modulaire', subKey:'steel', label:'Acier', icon:'🔩', color:0x5c6470, size:[4,0.3,3],
    build:(c)=>{
      const wall = mkBox(4,3,0.3,c,{metalness:0.7,roughness:0.35,map:texMetalFloor(c),repeatX:2,repeatY:1.5});
      const g = group(wall);
      // rivets aux 4 coins de chaque plaque (grille 3x2)
      for(let ix=0; ix<4; ix++) for(let iy=0; iy<3; iy++){
        const rivet = mkCyl(0.04,0.04,0.04,0x2a2e33,6);
        rivet.rotation.x = Math.PI/2;
        rivet.position.set(-1.7+ix*1.13, 0.5+iy*1, 0.17);
        g.add(rivet);
      }
      addSeams(g, 4, 4, 3, 0.3, 'x', 0x333a42, 0.025);
      // bande de signalisation jaune/noire en pied de mur
      for(let i=0;i<10;i++){
        const stripe = mkBox(0.2,0.28,0.32, i%2===0?0xf0c020:0x1c1c1c);
        stripe.position.set(-1.9+i*0.42, 0.14, 0.02);
        stripe.castShadow = false;
        g.add(stripe);
      }
      // panneau électrique + conduit de câble + poignée de manutention
      const panel = mkBox(0.5,0.7,0.06,0x2a2e33); panel.position.set(1.5,1.8,0.18); g.add(panel);
      const panelLed = new THREE.Mesh(new THREE.SphereGeometry(0.025,6,6), new THREE.MeshStandardMaterial({ color:0xff3b1a, emissive:0xff3b1a, emissiveIntensity:1 }));
      panelLed.position.set(1.65,2.05,0.22); g.add(panelLed);
      const conduit = mkCyl(0.05,0.05,3,0x1c1c1c,8); conduit.position.set(-1.85,1.5,0.19); g.add(conduit);
      const carryHandle = mkBox(0.3,0.06,0.34,0x1c1c1c); carryHandle.position.set(0,2.7,0.02); g.add(carryHandle);
      return g;
    }});
  registerAsset({ id:'wall_lab', cat:'walls', family:'Modulaire', subKey:'lab', label:'Laboratoire', icon:'🧪', color:0xe8ecef, size:[4,0.3,3],
    build:(c)=>{
      const wall = mkBox(4,3,0.3,c,{metalness:0.05,roughness:0.25,map:texTileFloor(c),repeatX:3,repeatY:2});
      const glass = mkBox(2.6,1.1,0.34,0x9dd8e0,{opacity:0.45,metalness:0.1,roughness:0.05});
      glass.position.set(0,1.7,0);
      const frame = mkBox(2.7,1.2,0.32,0xc9d2d6);
      frame.position.set(0,1.7,0);
      const g = group(wall, frame, glass);
      // porte coulissante technique + voyant d'accès
      const door = mkBox(1,2.2,0.32,0xd6dde0); door.position.set(-1.4,1.1,0); g.add(door);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.04,6,6), new THREE.MeshStandardMaterial({ color:0x4ade80, emissive:0x4ade80, emissiveIntensity:1 }));
      led.position.set(-1.05,2,0.17); g.add(led);
      // lecteur de badge + étagère technique + grille d'aération basse
      const reader = mkBox(0.15,0.22,0.04,0x33373d); reader.position.set(-1.05,1.5,0.17); g.add(reader);
      const shelf = mkBox(1.2,0.05,0.15,0xc9d2d6); shelf.position.set(1.2,2.4,0.18); g.add(shelf);
      const ventGrille = mkBox(0.7,0.25,0.04,0xb9c2c6); ventGrille.position.set(1.2,0.3,0.17); g.add(ventGrille);
      return g;
    }});
  registerAsset({ id:'wall_industrial', cat:'walls', family:'Modulaire', subKey:'industrial', label:'Industriel', icon:'🏭', color:0x4a4f57, size:[4,0.4,3.4],
    build:(c)=>{
      const wall = mkBox(4,3.4,0.4,c,{metalness:0.2,map:texCorrugated(c),repeatX:6,repeatY:1});
      const g = group(wall);
      const pipe1 = mkCyl(0.08,0.08,3.4,0x2e3238,8); pipe1.rotation.x=Math.PI/2; pipe1.position.set(-1.6,2.8,0.28);
      const pipe2 = mkCyl(0.08,0.08,3.4,0x2e3238,8); pipe2.rotation.x=Math.PI/2; pipe2.position.set(-1.2,2.8,0.28);
      g.add(pipe1, pipe2);
      addSeams(g, 5, 4, 3.4, 0.4, 'x', 0x33373d, 0.02);
      // volants de vanne sur les tuyaux
      [-1.6,-1.2].forEach(px=>{
        const valve = new THREE.Mesh(new THREE.TorusGeometry(0.14,0.025,6,10), new THREE.MeshStandardMaterial({ color:0xc0472b, metalness:0.4 }));
        valve.rotation.y = Math.PI/2; valve.position.set(px,2.8,0.34);
        g.add(valve);
      });
      // jauge de pression + coulures de rouille + collier de fixation des tuyaux
      const gauge = mkCyl(0.12,0.12,0.06,0xd9d9d9,10); gauge.rotation.x=Math.PI/2; gauge.position.set(1.3,2,0.32); g.add(gauge);
      const needle = mkBox(0.09,0.01,0.02,0x1c1c1c); needle.position.set(1.33,2.02,0.36); needle.rotation.z=0.6; g.add(needle);
      const rust = mkBox(0.08,1.2,0.42,0x6b3820,{opacity:0.5}); rust.position.set(0.6,1.6,0); rust.castShadow=false; g.add(rust);
      [1,2].forEach(fy=>{
        const clamp = mkBox(0.5,0.05,0.36,0x1c1c1c); clamp.position.set(-1.4,fy,0.28); g.add(clamp);
      });
      return g;
    }});
  registerAsset({ id:'wall_military', cat:'walls', family:'Modulaire', subKey:'military', label:'Militaire', icon:'🎖️', color:0x53603f, size:[4,0.4,3.4],
    build:(c)=>{
      const wall = mkBox(4,2.6,0.4,c,{map:texConcrete(c),repeatX:2,repeatY:1.3});
      const g = group(wall);
      // rangée de sacs de sable en pied de mur
      for(let i=0;i<6;i++){
        const bag = mkCyl(0.28,0.32,0.5,0x8a7a52,8);
        bag.rotation.z = Math.PI/2;
        bag.position.set(-1.75+i*0.7, 0.28, 0.32);
        g.add(bag);
      }
      // meurtrière d'observation + tache de camouflage
      const slit = mkBox(0.9,0.16,0.42,0x1c1e18); slit.position.set(0.8,1.8,0); g.add(slit);
      const camo = mkBox(1,0.6,0.42,0x3f4a2e,{opacity:0.6}); camo.position.set(-1,2,0); camo.rotation.y=0.3; g.add(camo);
      // barbelés au sommet + fanion + caisse de munitions au sol
      for(let i=0;i<7;i++){
        const wire = mkCyl(0.012,0.012,0.35,0x2a2a2a,5);
        wire.rotation.z = 0.9; wire.position.set(-1.7+i*0.6, 2.75, 0);
        g.add(wire);
      }
      const flagPole = mkCyl(0.02,0.02,1,0x3a3a3a,6); flagPole.position.set(1.9,3.1,0); g.add(flagPole);
      const flag = mkBox(0.5,0.32,0.02,0x53603f); flag.position.set(2.15,3.45,0); g.add(flag);
      const ammoBox = mkBox(0.5,0.35,0.4,0x3f4a2e); ammoBox.position.set(1.6,0.18,0.35); g.add(ammoBox);
      return g;
    }});
  registerAsset({ id:'wall_futuristic', cat:'walls', family:'Modulaire', subKey:'futuristic', label:'Futuriste', icon:'✨', color:0x2a3550, size:[4,0.3,3.2],
    build:(c)=>{
      const wall = mkBox(4,3.2,0.3,c,{metalness:0.5,roughness:0.2,map:texMetalFloor(c),repeatX:3,repeatY:2});
      const g = group(wall);
      const trimTop = mkBox(4.05,0.06,0.32, 0x4ecdc4); trimTop.position.y = 3.2;
      const trimMid = mkBox(4.05,0.03,0.32, 0x4ecdc4); trimMid.position.y = 1.6;
      [trimTop, trimMid].forEach(t=>{ t.material.emissive=new THREE.Color(0x4ecdc4); t.material.emissiveIntensity=1.2; g.add(t); });
      // balises d'angle lumineuses aux 2 coins bas
      [-1.95,1.95].forEach(px=>{
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06,8,8), new THREE.MeshStandardMaterial({ color:0xff6a39, emissive:0xff6a39, emissiveIntensity:1.3 }));
        beacon.position.set(px,0.2,0.17); g.add(beacon);
      });
      // panneau holographique + lignes de circuit gravées + vitrage teinté central
      const hud = mkBox(0.9,0.55,0.02,0x4ecdc4); hud.position.set(0,2.1,0.16);
      hud.material.emissive = new THREE.Color(0x4ecdc4); hud.material.emissiveIntensity = 0.5; hud.material.transparent=true; hud.material.opacity=0.6;
      g.add(hud);
      for(let i=0;i<3;i++){
        const circuit = mkBox(0.02,0.9,0.32,0x4ecdc4);
        circuit.material.emissive = new THREE.Color(0x4ecdc4); circuit.material.emissiveIntensity = 0.6;
        circuit.position.set(-1.6+i*0.5,0.8,0); circuit.castShadow=false;
        g.add(circuit);
      }
      const coreGlass = mkBox(0.6,1.4,0.32,0x1a2540,{opacity:0.5,metalness:0.2,roughness:0.05});
      coreGlass.position.set(1.4,1.5,0); g.add(coreGlass);
      return g;
    }});

  // ---- MURS MODULAIRES ---- chaque famille de matière (béton, acier,
  // laboratoire, industriel, militaire, futuriste) est déclinée dans les
  // 5 mêmes formes (droit / angle en L / demi-mur / porte / fenêtre), en
  // reprenant les détails caractéristiques du mur plein correspondant
  // (rivets, sacs de sable, vitrage, tuyauterie...), pour pouvoir bâtir
  // des lignes de murs cohérentes visuellement dans le style choisi.
  function addModularPlinth(parent, w, d, color){
    const plinth = mkBox(w+0.02, 0.3, d+0.02, color);
    plinth.position.y = 0.15; plinth.castShadow = false;
    parent.add(plinth);
  }
  // Détail générique réutilisable — un mélange aléatoire (éclat de coin,
  // fissure, coulure/tache, boulons) posé sur un mur w×h×d déjà grondé en
  // 0..h (comme mkBox). Pensé pour les murs "matière brute" qui n'avaient
  // qu'1-2 détails (voire aucun, ex. wall_obsidian) contre 8-10 pour les
  // murs modulaires phares — un seul appel relève sensiblement le niveau
  // de détail sans avoir à composer chaque élément à la main par mur.
  function addWeathering(parent, w, h, d, opts={}){
    if(Math.random()<0.85){
      const chip = mkBox(0.22+Math.random()*0.18, 0.18+Math.random()*0.14, d+0.02, opts.chipColor||0x000000);
      chip.material.color.multiplyScalar(0.4+Math.random()*0.25);
      chip.position.set((Math.random()<0.5?-1:1)*(w/2-0.35-Math.random()*0.3), 0.3+Math.random()*(h-0.9), 0);
      chip.rotation.y = (Math.random()-0.5)*0.4; chip.castShadow=false;
      parent.add(chip);
    }
    if(Math.random()<0.65){
      const crackH = h*(0.28+Math.random()*0.32);
      const crack = mkBox(0.04,crackH,d+0.015,0x151412);
      crack.position.set((Math.random()-0.5)*w*0.55, crackH/2+Math.random()*(h-crackH), 0);
      crack.rotation.z = (Math.random()-0.5)*0.12; crack.castShadow=false;
      parent.add(crack);
    }
    if(Math.random()<0.6){
      const stainH = h*(0.22+Math.random()*0.18);
      const stain = mkBox(0.45+Math.random()*0.35, stainH, d+0.015, opts.stainColor||0x4f6a3a, {opacity:0.32});
      stain.position.set((Math.random()-0.5)*w*0.55, stainH/2+Math.random()*0.3, 0);
      stain.castShadow=false;
      parent.add(stain);
    }
    if(Math.random()<0.7){
      const n = Math.random()<0.5?2:4;
      for(let i=0;i<n;i++){
        const bolt = mkCyl(0.032,0.032,0.035,opts.boltColor||0x2a2a2a,6);
        bolt.rotation.x = Math.PI/2;
        bolt.position.set((Math.random()-0.5)*w*0.7, 0.3+Math.random()*(h-0.6), d/2+0.005);
        parent.add(bolt);
      }
    }
  }

  // ===== BÉTON — panneau de coffrage, éclat, coulure, panneau de
  // signalisation boulonné, mousse en pied (repris de wall_concrete) =====
  (function(){
    const TRIM = 0x6f6f6b;
    const H = 3, D = 0.35;
    function panel(w,h,d,c){ return mkBox(w,h,d,c,{map:texConcrete(c),repeatX:w/2,repeatY:h/2}); }
    function details(g, w, h, d, c){
      const chip = mkBox(0.3,0.22,d+0.02,0x76766f); chip.position.set(w*0.28,h*0.2,0); chip.rotation.y=0.2; g.add(chip);
      const stain = mkBox(0.16,h*0.36,d+0.02,0x5f5f57,{opacity:0.35}); stain.position.set(-w*0.32,h*0.7,0); g.add(stain);
      [[-w/2+0.15,0.2],[w/2-0.15,0.2],[-w/2+0.15,h-0.2],[w/2-0.15,h-0.2]].forEach(([bx,by])=>{
        const bolt = mkCyl(0.05,0.05,0.05,0x3a3a3a,8);
        bolt.rotation.x = Math.PI/2; bolt.position.set(bx,by,d/2+0.01);
        g.add(bolt);
      });
      const moss = mkBox(w*0.22,h*0.13,d+0.02,0x4f6a3a,{opacity:0.4});
      moss.position.set(w*0.34,h*0.07,0); moss.castShadow=false; g.add(moss);
    }
    registerAsset({ id:'wall_modular_concrete_straight', cat:'walls', family:'Modulaire', sub:'concrete', label:'Modulaire Béton — Droit', icon:'🧱', color:0x8a8a86, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        addSeams(g, 4, 4, H, D, 'y', TRIM, 0.02);
        details(g, 4, H, D, c);
        const sign = mkBox(0.5,0.5,0.03,0xf0c020); sign.position.set(0,H*0.78,D/2+0.01); g.add(sign);
        return g;
      }});
    registerAsset({ id:'wall_modular_concrete_corner', cat:'walls', family:'Modulaire', sub:'concrete', label:'Modulaire Béton — Angle', icon:'📐', color:0x8a8a86, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.175);
        const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.175,H/2,0);
        g.add(legA, legB);
        const cornerPost = mkBox(0.4,H,0.4,0x76766f); cornerPost.position.set(-1.825,H/2,-1.825); g.add(cornerPost);
        addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
        details(legA, 4, H, D, c);
        return g;
      }});
    registerAsset({ id:'wall_modular_concrete_half', cat:'walls', family:'Modulaire', sub:'concrete', label:'Modulaire Béton — Demi-mur', icon:'🧱', color:0x8a8a86, size:[4,D,1.2],
      build:(c)=>{
        const g = group(panel(4,1.2,D,c));
        addModularPlinth(g, 4, D, TRIM);
        const cap = mkBox(4.08,0.08,D+0.08,0x76766f); cap.position.y = 1.24; g.add(cap);
        details(g, 4, 1.2, D, c);
        return g;
      }});
    registerAsset({ id:'wall_modular_concrete_door', cat:'walls', family:'Modulaire', sub:'concrete', label:'Modulaire Béton — Porte', icon:'🚪', color:0x8a8a86, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
        const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); g.add(pierL);
        const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); g.add(pierR);
        const lintel = mkBox(doorW,lintelH,D,c,{map:texConcrete(c),repeatX:0.9,repeatY:0.3}); lintel.position.y = H - lintelH/2; g.add(lintel);
        const doorPanel = mkBox(doorW-0.1,H*0.75,0.06,0x3a3a3a,{metalness:0.3,roughness:0.5}); doorPanel.position.set(0,H*0.375,0.02); g.add(doorPanel);
        const handle = mkCyl(0.03,0.03,0.22,0xd9d9d9,8); handle.rotation.z=Math.PI/2; handle.position.set(doorW/2-0.55,H*0.37,0.07); g.add(handle);
        addModularPlinth(pierL, pierW, D, TRIM); addModularPlinth(pierR, pierW, D, TRIM);
        details(pierL, pierW, H, D, c); details(pierR, pierW, H, D, c);
        return g;
      }});
    registerAsset({ id:'wall_modular_concrete_window', cat:'walls', family:'Modulaire', sub:'concrete', label:'Modulaire Béton — Fenêtre', icon:'🪟', color:0x8a8a86, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        addSeams(g, 4, 4, H, D, 'y', TRIM, 0.02);
        addWindowGrid(g, 2, 1, 4, H, D, 'z', 0x9dd8e0);
        details(g, 4, H, D, c);
        return g;
      }});
  })();

  // ===== ACIER — plaques rivetées, bande de signalisation, panneau
  // électrique + LED, conduit de câble (repris de wall_steel) =====
  (function(){
    const TRIM = 0x333a42;
    const H = 3, D = 0.3;
    function panel(w,h,d,c){ return mkBox(w,h,d,c,{metalness:0.7,roughness:0.35,map:texMetalFloor(c),repeatX:w/2,repeatY:h/2}); }
    function rivets(g, w, h, d, cols, rows){
      for(let ix=0; ix<cols; ix++) for(let iy=0; iy<rows; iy++){
        const rivet = mkCyl(0.04,0.04,0.04,0x2a2e33,6);
        rivet.rotation.x = Math.PI/2;
        rivet.position.set(-w/2+0.2+ix*(w-0.4)/(cols-1||1), h*0.15+iy*(h*0.7)/(rows-1||1), d/2+0.01);
        g.add(rivet);
      }
    }
    function hazardStripe(g, w, d, y=0.14){
      const n = Math.max(4, Math.round(w/0.42));
      for(let i=0;i<n;i++){
        const stripe = mkBox(0.2,0.28,d+0.02, i%2===0?0xf0c020:0x1c1c1c);
        stripe.position.set(-w/2+0.2+i*(w-0.4)/(n-1||1), y, d/2-0.13);
        stripe.castShadow = false; g.add(stripe);
      }
    }
    registerAsset({ id:'wall_modular_steel_straight', cat:'walls', family:'Modulaire', sub:'steel', label:'Modulaire Acier — Droit', icon:'🔩', color:0x5c6470, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        rivets(g, 4, H, D, 4, 3);
        hazardStripe(g, 4, D);
        const panelBox = mkBox(0.5,0.7,0.06,0x2a2e33); panelBox.position.set(1.5,H*0.6,D/2+0.03); g.add(panelBox);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.025,6,6), new THREE.MeshStandardMaterial({ color:0xff3b1a, emissive:0xff3b1a, emissiveIntensity:1 }));
        led.position.set(1.65,H*0.68,D/2+0.07); g.add(led);
        return g;
      }});
    registerAsset({ id:'wall_modular_steel_corner', cat:'walls', family:'Modulaire', sub:'steel', label:'Modulaire Acier — Angle', icon:'📐', color:0x5c6470, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.15);
        const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.15,H/2,0);
        g.add(legA, legB);
        const cornerPost = mkBox(0.4,H,0.4,0x2e3238); cornerPost.position.set(-1.825,H/2,-1.825); g.add(cornerPost);
        addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
        rivets(legA, 4, H, D, 4, 3); hazardStripe(legA, 4, D);
        return g;
      }});
    registerAsset({ id:'wall_modular_steel_half', cat:'walls', family:'Modulaire', sub:'steel', label:'Modulaire Acier — Demi-mur', icon:'🔩', color:0x5c6470, size:[4,D,1.2],
      build:(c)=>{
        const g = group(panel(4,1.2,D,c));
        addModularPlinth(g, 4, D, TRIM);
        const cap = mkBox(4.08,0.08,D+0.08,0x2e3238); cap.position.y = 1.24; g.add(cap);
        rivets(g, 4, 1.2, D, 4, 2);
        hazardStripe(g, 4, D);
        return g;
      }});
    registerAsset({ id:'wall_modular_steel_door', cat:'walls', family:'Modulaire', sub:'steel', label:'Modulaire Acier — Porte', icon:'🚪', color:0x5c6470, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
        const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); g.add(pierL);
        const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); g.add(pierR);
        const lintel = mkBox(doorW,lintelH,D,c,{metalness:0.7,roughness:0.35,map:texMetalFloor(c),repeatX:0.9,repeatY:0.3}); lintel.position.y = H - lintelH/2; g.add(lintel);
        const doorPanel = mkBox(doorW-0.1,H*0.75,0.06,0x2a2e33,{metalness:0.6,roughness:0.4}); doorPanel.position.set(0,H*0.375,0.02); g.add(doorPanel);
        const handle = mkCyl(0.03,0.03,0.22,0xd9d9d9,8); handle.rotation.z=Math.PI/2; handle.position.set(doorW/2-0.55,H*0.37,0.07); g.add(handle);
        addModularPlinth(pierL, pierW, D, TRIM); addModularPlinth(pierR, pierW, D, TRIM);
        rivets(pierL, pierW, H, D, 2, 3); rivets(pierR, pierW, H, D, 2, 3);
        return g;
      }});
    registerAsset({ id:'wall_modular_steel_window', cat:'walls', family:'Modulaire', sub:'steel', label:'Modulaire Acier — Fenêtre', icon:'🪟', color:0x5c6470, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        rivets(g, 4, H, D, 4, 3);
        addWindowGrid(g, 2, 1, 4, H, D, 'z', 0x9dd8e0);
        return g;
      }});
  })();

  // ===== LABORATOIRE — carrelage clair, vitrage teinté, porte
  // coulissante + lecteur de badge, grille d'aération (repris de wall_lab) =====
  (function(){
    const TRIM = 0xb9c2c6;
    const H = 3, D = 0.3;
    function panel(w,h,d,c){ return mkBox(w,h,d,c,{metalness:0.05,roughness:0.25,map:texTileFloor(c),repeatX:w*0.75,repeatY:h*0.67}); }
    function accessLed(g,x,y,z){
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.04,6,6), new THREE.MeshStandardMaterial({ color:0x4ade80, emissive:0x4ade80, emissiveIntensity:1 }));
      led.position.set(x,y,z); g.add(led);
    }
    registerAsset({ id:'wall_modular_lab_straight', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Droit', icon:'🧪', color:0xe8ecef, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        const shelf = mkBox(1.2,0.05,0.15,TRIM); shelf.position.set(1.2,H*0.8,D/2+0.02); g.add(shelf);
        const ventGrille = mkBox(0.7,0.25,0.04,TRIM); ventGrille.position.set(-1.2,0.3,D/2+0.02); g.add(ventGrille);
        return g;
      }});
    registerAsset({ id:'wall_modular_lab_corner', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Angle', icon:'📐', color:0xe8ecef, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.15);
        const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.15,H/2,0);
        g.add(legA, legB);
        const cornerPost = mkBox(0.4,H,0.4,0xc9d2d6); cornerPost.position.set(-1.825,H/2,-1.825); g.add(cornerPost);
        addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
        return g;
      }});
    registerAsset({ id:'wall_modular_lab_half', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Demi-mur', icon:'🧪', color:0xe8ecef, size:[4,D,1.2],
      build:(c)=>{
        const g = group(panel(4,1.2,D,c));
        addModularPlinth(g, 4, D, TRIM);
        const cap = mkBox(4.08,0.08,D+0.08,0xc9d2d6); cap.position.y = 1.24; g.add(cap);
        return g;
      }});
    registerAsset({ id:'wall_modular_lab_door', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Porte', icon:'🚪', color:0xe8ecef, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        const door = mkBox(1.4,H*0.75,D+0.02,0xd6dde0); door.position.set(-1,H*0.375,0); g.add(door);
        accessLed(g, -0.25, H*0.6, D/2+0.02);
        const reader = mkBox(0.15,0.22,0.04,0x33373d); reader.position.set(-0.25,H*0.45,D/2+0.02); g.add(reader);
        return g;
      }});
    registerAsset({ id:'wall_modular_lab_window', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Fenêtre', icon:'🪟', color:0xe8ecef, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        const glass = mkBox(2.6,H*0.37,D+0.04,0x9dd8e0,{opacity:0.45,metalness:0.1,roughness:0.05}); glass.position.set(0,H*0.57,0); g.add(glass);
        const frame = mkBox(2.7,H*0.4,D+0.02,0xc9d2d6); frame.position.set(0,H*0.57,0); frame.renderOrder=-1; g.add(frame);
        return g;
      }});
  })();

  // ===== INDUSTRIEL — tôle ondulée, tuyaux + vannes, jauge de pression,
  // coulures de rouille (repris de wall_industrial) =====
  (function(){
    const TRIM = 0x33373d;
    const H = 3.4, D = 0.4;
    function panel(w,h,d,c){ return mkBox(w,h,d,c,{metalness:0.2,map:texCorrugated(c),repeatX:w*1.5,repeatY:h/3.4}); }
    function pipes(g, w, h, d){
      const pipe1 = mkCyl(0.08,0.08,h,0x2e3238,8); pipe1.rotation.x=Math.PI/2; pipe1.position.set(-w*0.4,h*0.82,d/2-0.12);
      const pipe2 = mkCyl(0.08,0.08,h,0x2e3238,8); pipe2.rotation.x=Math.PI/2; pipe2.position.set(-w*0.3,h*0.82,d/2-0.12);
      g.add(pipe1, pipe2);
      [-w*0.4,-w*0.3].forEach(px=>{
        const valve = new THREE.Mesh(new THREE.TorusGeometry(0.14,0.025,6,10), new THREE.MeshStandardMaterial({ color:0xc0472b, metalness:0.4 }));
        valve.rotation.y = Math.PI/2; valve.position.set(px,h*0.82,d/2-0.06);
        g.add(valve);
      });
    }
    registerAsset({ id:'wall_modular_industrial_straight', cat:'walls', family:'Modulaire', sub:'industrial', label:'Modulaire Industriel — Droit', icon:'🏭', color:0x4a4f57, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        pipes(g, 4, H, D);
        const gauge = mkCyl(0.12,0.12,0.06,0xd9d9d9,10); gauge.rotation.x=Math.PI/2; gauge.position.set(1.3,H*0.59,D/2+0.02); g.add(gauge);
        const rust = mkBox(0.08,H*0.35,D+0.02,0x6b3820,{opacity:0.5}); rust.position.set(0.6,H*0.47,0); rust.castShadow=false; g.add(rust);
        return g;
      }});
    registerAsset({ id:'wall_modular_industrial_corner', cat:'walls', family:'Modulaire', sub:'industrial', label:'Modulaire Industriel — Angle', icon:'📐', color:0x4a4f57, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.2);
        const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.2,H/2,0);
        g.add(legA, legB);
        const cornerPost = mkBox(0.42,H,0.42,0x2e3238); cornerPost.position.set(-1.825,H/2,-1.825); g.add(cornerPost);
        addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
        pipes(legA, 4, H, D);
        return g;
      }});
    registerAsset({ id:'wall_modular_industrial_half', cat:'walls', family:'Modulaire', sub:'industrial', label:'Modulaire Industriel — Demi-mur', icon:'🏭', color:0x4a4f57, size:[4,D,1.2],
      build:(c)=>{
        const g = group(panel(4,1.2,D,c));
        addModularPlinth(g, 4, D, TRIM);
        const cap = mkBox(4.08,0.08,D+0.08,0x2e3238); cap.position.y = 1.24; g.add(cap);
        const clamp = mkBox(0.5,0.05,D+0.02,0x1c1c1c); clamp.position.set(-1.4,0.9,0); g.add(clamp);
        return g;
      }});
    registerAsset({ id:'wall_modular_industrial_door', cat:'walls', family:'Modulaire', sub:'industrial', label:'Modulaire Industriel — Porte', icon:'🚪', color:0x4a4f57, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
        const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); g.add(pierL);
        const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); g.add(pierR);
        const lintel = mkBox(doorW,lintelH,D,c,{metalness:0.2,map:texCorrugated(c),repeatX:doorW*1.5,repeatY:0.2}); lintel.position.y = H - lintelH/2; g.add(lintel);
        const doorPanel = mkBox(doorW-0.1,H*0.66,0.06,0x2e3238,{metalness:0.5,roughness:0.5}); doorPanel.position.set(0,H*0.33,0.02); g.add(doorPanel);
        addModularPlinth(pierL, pierW, D, TRIM); addModularPlinth(pierR, pierW, D, TRIM);
        const clamp = mkBox(0.5,0.05,D+0.02,0x1c1c1c); clamp.position.set(0,H*0.85,0); g.add(clamp);
        return g;
      }});
    registerAsset({ id:'wall_modular_industrial_window', cat:'walls', family:'Modulaire', sub:'industrial', label:'Modulaire Industriel — Fenêtre', icon:'🪟', color:0x4a4f57, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        pipes(g, 4, H, D);
        addWindowGrid(g, 2, 1, 4, H, D, 'z', 0x9dd8e0);
        return g;
      }});
  })();

  // ===== MILITAIRE — sacs de sable en pied de mur, meurtrière, tache de
  // camouflage, barbelés au sommet (repris de wall_military) =====
  (function(){
    const TRIM = 0x3f4a2e;
    const H = 3, D = 0.4;
    function panel(w,h,d,c){ return mkBox(w,h,d,c,{map:texConcrete(c),repeatX:w/2,repeatY:h/2.3}); }
    function sandbags(g, w, d, count){
      for(let i=0;i<count;i++){
        const bag = mkCyl(0.28,0.32,0.5,0x8a7a52,8);
        bag.rotation.z = Math.PI/2;
        bag.position.set(-w/2+0.35+i*(w-0.7)/(count-1||1), 0.28, d/2-0.08);
        g.add(bag);
      }
    }
    function barbwire(g, w, y){
      const n = Math.max(3, Math.round(w/0.6));
      for(let i=0;i<n;i++){
        const wire = mkCyl(0.012,0.012,0.35,0x2a2a2a,5);
        wire.rotation.z = 0.9; wire.position.set(-w/2+0.2+i*(w-0.4)/(n-1||1), y, 0);
        g.add(wire);
      }
    }
    registerAsset({ id:'wall_modular_military_straight', cat:'walls', family:'Modulaire', sub:'military', label:'Modulaire Militaire — Droit', icon:'🎖️', color:0x53603f, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        sandbags(g, 4, D, 6);
        const slit = mkBox(0.9,0.16,D+0.02,0x1c1e18); slit.position.set(0.8,H*0.62,0); g.add(slit);
        const camo = mkBox(1,0.6,D+0.02,0x3f4a2e,{opacity:0.6}); camo.position.set(-1,H*0.7,0); camo.rotation.y=0.3; g.add(camo);
        barbwire(g, 4, H-0.05);
        return g;
      }});
    registerAsset({ id:'wall_modular_military_corner', cat:'walls', family:'Modulaire', sub:'military', label:'Modulaire Militaire — Angle', icon:'📐', color:0x53603f, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.2);
        const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.2,H/2,0);
        g.add(legA, legB);
        const cornerPost = mkBox(0.42,H,0.42,0x4a5539); cornerPost.position.set(-1.825,H/2,-1.825); g.add(cornerPost);
        addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
        sandbags(legA, 4, D, 6); barbwire(legA, 4, H-0.05);
        return g;
      }});
    registerAsset({ id:'wall_modular_military_half', cat:'walls', family:'Modulaire', sub:'military', label:'Modulaire Militaire — Demi-mur', icon:'🎖️', color:0x53603f, size:[4,D,1.2],
      build:(c)=>{
        const g = group(panel(4,1.2,D,c));
        addModularPlinth(g, 4, D, TRIM);
        const cap = mkBox(4.08,0.08,D+0.08,0x4a5539); cap.position.y = 1.24; g.add(cap);
        sandbags(g, 4, D, 6);
        return g;
      }});
    registerAsset({ id:'wall_modular_military_door', cat:'walls', family:'Modulaire', sub:'military', label:'Modulaire Militaire — Porte', icon:'🚪', color:0x53603f, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
        const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); g.add(pierL);
        const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); g.add(pierR);
        const lintel = mkBox(doorW,lintelH,D,c,{map:texConcrete(c),repeatX:0.9,repeatY:0.3}); lintel.position.y = H - lintelH/2; g.add(lintel);
        const doorPanel = mkBox(doorW-0.1,H*0.75,0.06,0x2e3320,{metalness:0.2,roughness:0.7}); doorPanel.position.set(0,H*0.375,0.02); g.add(doorPanel);
        addModularPlinth(pierL, pierW, D, TRIM); addModularPlinth(pierR, pierW, D, TRIM);
        sandbags(pierL, pierW, D, 2); sandbags(pierR, pierW, D, 2);
        const ammoBox = mkBox(0.5,0.35,0.4,0x3f4a2e); ammoBox.position.set(doorW/2+pierW*0.5,0.18,D/2-0.05); g.add(ammoBox);
        return g;
      }});
    registerAsset({ id:'wall_modular_military_window', cat:'walls', family:'Modulaire', sub:'military', label:'Modulaire Militaire — Fenêtre', icon:'🪟', color:0x53603f, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        sandbags(g, 4, D, 6);
        addWindowGrid(g, 2, 1, 4, H, D, 'z', 0x9dd8e0);
        barbwire(g, 4, H-0.05);
        return g;
      }});
  })();

  // ===== FUTURISTE — bandeaux lumineux, balises d'angle, panneau
  // holographique, lignes de circuit gravées (repris de wall_futuristic) =====
  (function(){
    const TRIM = 0x1a2540;
    const H = 3.2, D = 0.3;
    function panel(w,h,d,c){ return mkBox(w,h,d,c,{metalness:0.5,roughness:0.2,map:texMetalFloor(c),repeatX:w*0.75,repeatY:h*0.6}); }
    function trims(g, w, h, d){
      const trimTop = mkBox(w+0.05,0.06,d+0.02, 0x4ecdc4); trimTop.position.y = h;
      const trimMid = mkBox(w+0.05,0.03,d+0.02, 0x4ecdc4); trimMid.position.y = h*0.5;
      [trimTop, trimMid].forEach(t=>{ t.material.emissive=new THREE.Color(0x4ecdc4); t.material.emissiveIntensity=1.2; g.add(t); });
    }
    function beacons(g, w){
      [-w/2+0.05,w/2-0.05].forEach(px=>{
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06,8,8), new THREE.MeshStandardMaterial({ color:0xff6a39, emissive:0xff6a39, emissiveIntensity:1.3 }));
        beacon.position.set(px,0.2,0.17); g.add(beacon);
      });
    }
    registerAsset({ id:'wall_modular_futuristic_straight', cat:'walls', family:'Modulaire', sub:'futuristic', label:'Modulaire Futuriste — Droit', icon:'✨', color:0x2a3550, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        trims(g, 4, H, D); beacons(g, 4);
        const hud = mkBox(0.9,0.55,0.02,0x4ecdc4); hud.position.set(0,H*0.66,D/2+0.01);
        hud.material.emissive = new THREE.Color(0x4ecdc4); hud.material.emissiveIntensity = 0.5; hud.material.transparent=true; hud.material.opacity=0.6;
        g.add(hud);
        return g;
      }});
    registerAsset({ id:'wall_modular_futuristic_corner', cat:'walls', family:'Modulaire', sub:'futuristic', label:'Modulaire Futuriste — Angle', icon:'📐', color:0x2a3550, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.15);
        const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.15,H/2,0);
        g.add(legA, legB);
        const cornerPost = mkBox(0.4,H,0.4,0x1a2540); cornerPost.position.set(-1.825,H/2,-1.825); g.add(cornerPost);
        addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
        trims(legA, 4, H, D); beacons(legA, 4);
        return g;
      }});
    registerAsset({ id:'wall_modular_futuristic_half', cat:'walls', family:'Modulaire', sub:'futuristic', label:'Modulaire Futuriste — Demi-mur', icon:'✨', color:0x2a3550, size:[4,D,1.2],
      build:(c)=>{
        const g = group(panel(4,1.2,D,c));
        addModularPlinth(g, 4, D, TRIM);
        const cap = mkBox(4.08,0.08,D+0.08,0x4ecdc4); cap.position.y = 1.24;
        cap.material.emissive=new THREE.Color(0x4ecdc4); cap.material.emissiveIntensity=0.8; g.add(cap);
        beacons(g, 4);
        return g;
      }});
    registerAsset({ id:'wall_modular_futuristic_door', cat:'walls', family:'Modulaire', sub:'futuristic', label:'Modulaire Futuriste — Porte', icon:'🚪', color:0x2a3550, size:[4,D,H],
      build:(c)=>{
        const g = new THREE.Group();
        const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
        const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); g.add(pierL);
        const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); g.add(pierR);
        const lintel = mkBox(doorW,lintelH,D,c,{metalness:0.5,roughness:0.2,map:texMetalFloor(c),repeatX:doorW*0.75,repeatY:0.3}); lintel.position.y = H - lintelH/2; g.add(lintel);
        const doorPanel = mkBox(doorW-0.1,H*0.7,0.06,0x1a2540,{metalness:0.4,roughness:0.3}); doorPanel.position.set(0,H*0.35,0.02); g.add(doorPanel);
        doorPanel.material.emissive = new THREE.Color(0x4ecdc4); doorPanel.material.emissiveIntensity = 0.15;
        addModularPlinth(pierL, pierW, D, TRIM); addModularPlinth(pierR, pierW, D, TRIM);
        beacons(g, doorW+pierW*2);
        return g;
      }});
    registerAsset({ id:'wall_modular_futuristic_window', cat:'walls', family:'Modulaire', sub:'futuristic', label:'Modulaire Futuriste — Fenêtre', icon:'🪟', color:0x2a3550, size:[4,D,H],
      build:(c)=>{
        const g = group(panel(4,H,D,c));
        addModularPlinth(g, 4, D, TRIM);
        trims(g, 4, H, D);
        addWindowGrid(g, 2, 1, 4, H, D, 'z', 0x9dd8e0);
        return g;
      }});
  })();

  // ---- MURS SUPPLÉMENTAIRES (thème/matériau) ----
  registerAsset({ id:'wall_stone', cat:'walls', family:'Matériaux naturels', label:'Pierre', icon:'🪨', color:0x8c8578, size:[4,0.45,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.45,c,{map:texStoneBlock(c),repeatX:2,repeatY:1.5,roughness:0.95}));
      const moss = mkBox(1.1,0.5,0.47,0x4f6a3a,{opacity:0.4}); moss.position.set(-1.2,0.25,0); moss.castShadow=false; g.add(moss);
      const crack = mkBox(0.05,1.6,0.47,0x2c2a24); crack.position.set(0.6,1.4,0); g.add(crack);
      return g;
    }});
  registerAsset({ id:'wall_brick', cat:'walls', family:'Matériaux naturels', label:'Brique', icon:'🧱', color:0xa8543f, size:[4,0.35,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.35,c,{map:texBrick(c),repeatX:2,repeatY:1.5}));
      const cap = mkBox(4.1,0.15,0.42,0x6f6a5c); cap.position.y=3.02; g.add(cap);
      addSeams(g,4,4,3,0.35,'x',0x6b5c4a,0.02);
      addWeathering(g,4,3,0.35,{stainColor:0x3a2a1e});
      return g;
    }});
  registerAsset({ id:'wall_wood', cat:'walls', family:'Matériaux naturels', label:'Bois', icon:'🪵', color:0x8a5a34, size:[4,0.3,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.3,c,{map:texWoodFloor(c),repeatX:1,repeatY:2}));
      const beamTop = mkBox(4.1,0.15,0.36,0x4a3420); beamTop.position.y=2.92; g.add(beamTop);
      const beamBot = mkBox(4.1,0.15,0.36,0x4a3420); beamBot.position.y=0.08; g.add(beamBot);
      addSeams(g,7,4,3,0.3,'x',0x5a3f26,0.015);
      addWeathering(g,4,3,0.3,{stainColor:0x3f5a2c});
      return g;
    }});
  registerAsset({ id:'wall_castle', cat:'walls', family:'Historique', label:'Château', icon:'🏰', color:0x9a9284, size:[4,0.6,3.6],
    build:(c)=>{
      const g = group(mkBox(4,3.2,0.6,c,{map:texStoneBlock(c),repeatX:2,repeatY:1.8,roughness:0.95}));
      for(let i=0;i<5;i++){
        const merlon = mkBox(0.55,0.4,0.6,c,{map:texStoneBlock(c)});
        merlon.position.set(-1.8+i*0.9,3.4,0); g.add(merlon);
      }
      const slit = mkBox(0.1,0.7,0.64,0x1c1a16); slit.position.set(0,1.8,0); g.add(slit);
      return g;
    }});
  registerAsset({ id:'wall_medieval', cat:'walls', family:'Historique', label:'Médiéval', icon:'🏚️', color:0x7a6a52, size:[4,0.5,3.2],
    build:(c)=>{
      const g = group(mkBox(4,2.8,0.5,c,{map:texStoneBlock(c),repeatX:2,repeatY:1.6,roughness:0.95}));
      const beamA = mkBox(4.6,0.22,0.56,0x4a3420); beamA.rotation.z=0.42; beamA.position.set(0,1.4,0); g.add(beamA);
      const beamB = mkBox(4.6,0.22,0.56,0x4a3420); beamB.rotation.z=-0.42; beamB.position.set(0,1.4,0); g.add(beamB);
      [[-1.9,0.3],[1.9,0.3],[-1.9,2.5],[1.9,2.5]].forEach(([bx,by])=>{
        const stud = mkCyl(0.05,0.05,0.06,0x2a2a2a,8); stud.rotation.x=Math.PI/2; stud.position.set(bx,by,0.26); g.add(stud);
      });
      return g;
    }});
  registerAsset({ id:'wall_palisade', cat:'walls', family:'Historique', label:'Palissade', icon:'🪓', color:0x6b4a2c, size:[4,0.3,2.6],
    build:(c)=>{
      const g = new THREE.Group();
      for(let i=0;i<9;i++){
        const x=-1.9+i*0.475;
        const trunk = mkCyl(0.14,0.16,2.3,c,8); trunk.position.set(x,1.15,0); g.add(trunk);
        const tip = mkCyl(0,0.14,0.3,c,8); tip.position.set(x,2.3,0); g.add(tip);
      }
      const railTop = mkBox(4,0.1,0.08,0x4a3420); railTop.position.set(0,1.6,0.12); g.add(railTop);
      return g;
    }});
  registerAsset({ id:'fence_chainlink', cat:'walls', family:'Clôtures & barrières', label:'Grillage', icon:'🔲', color:0x8a9099, size:[4,0.1,2.3],
    build:(c)=>{
      const g = new THREE.Group();
      const tex = texChainlink(c); tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(3,1.5);
      const mat = new THREE.MeshStandardMaterial({ map:tex, color:0xffffff, transparent:true, alphaTest:0.3, side:THREE.DoubleSide, roughness:0.6, metalness:0.4 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4,2.2), mat);
      mesh.position.set(0,1.1,0); mesh.castShadow=true; mesh.receiveShadow=true; g.add(mesh);
      [-2,2].forEach(x=>{ const post = mkCyl(0.06,0.06,2.3,0x555555,8); post.position.set(x,1.15,0); g.add(post); });
      const rail = mkBox(4.1,0.05,0.05,0x555555); rail.position.y=2.25; g.add(rail);
      return g;
    }});
  registerAsset({ id:'wall_ice', cat:'walls', family:'Climat', label:'Glace', icon:'🧊', color:0xbfe6f0, size:[4,0.4,3],
    build:(c)=>{
      const wall = mkBox(4,3,0.4,c,{map:texIceFloor(c),roughness:0.15,metalness:0.05,opacity:0.85});
      const g = group(wall);
      for(let i=0;i<3;i++){
        const icicle = mkCyl(0.12,0,0.6,c,8); icicle.position.set(-1.4+i*1.4,-0.3,0.15);
        icicle.material.transparent=true; icicle.material.opacity=0.8; g.add(icicle);
      }
      return g;
    }});
  registerAsset({ id:'wall_lava', cat:'walls', family:'Climat', label:'Lave', icon:'🌋', color:0x241c18, size:[4,0.4,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.4,c,{roughness:0.95}));
      for(let i=0;i<6;i++){
        const crackMat = new THREE.MeshStandardMaterial({ color:0xff5a1a, emissive:0xff4400, emissiveIntensity:1.4 });
        const crack = new THREE.Mesh(new THREE.BoxGeometry(0.05+Math.random()*0.05,1+Math.random()*1.2,0.42), crackMat);
        crack.position.set(-1.7+Math.random()*3.4, 0.6+Math.random()*1.6, 0);
        crack.rotation.z = (Math.random()-0.5)*0.5; crack.castShadow=false; g.add(crack);
      }
      return g;
    }});
  registerAsset({ id:'wall_bamboo', cat:'walls', family:'Matériaux naturels', label:'Bambou', icon:'🎍', color:0x7fae4a, size:[4,0.25,3],
    build:(c)=>{
      const g = new THREE.Group();
      for(let i=0;i<11;i++){
        const x=-2+i*0.4;
        const pole = mkCyl(0.13,0.15,3,c,10); pole.position.set(x,1.5,0); g.add(pole);
        for(let n=0;n<3;n++){
          const node = mkCyl(0.16,0.16,0.06,0x5a7d34,10); node.position.set(x,0.7+n*0.9,0); g.add(node);
        }
      }
      return g;
    }});
  registerAsset({ id:'wall_japanese', cat:'walls', family:'Historique', label:'Japonais', icon:'⛩️', color:0xece3d0, size:[4,0.2,3],
    build:(c)=>{
      const g = new THREE.Group();
      const paper = mkBox(3.8,2.8,0.1,c,{roughness:0.9,opacity:0.92}); paper.position.set(0,1.5,0); g.add(paper);
      [[0,2.9,4,0.15],[0,0.05,4,0.15]].forEach(([fx,fy,fw,fh])=>{ const bar=mkBox(fw,fh,0.14,0x4a3420); bar.position.set(fx,fy,0.02); g.add(bar); });
      [-1.95,-0.98,0,0.98,1.95].forEach(fx=>{ const bar=mkBox(0.15,3,0.14,0x4a3420); bar.position.set(fx,1.5,0.02); g.add(bar); });
      return g;
    }});
  registerAsset({ id:'wall_fortress', cat:'walls', family:'Historique', label:'Forteresse', icon:'🏯', color:0x8a8478, size:[4,0.7,3.8],
    build:(c)=>{
      const g = group(mkBox(4,3.4,0.7,c,{map:texStoneBlock(c),repeatX:2,repeatY:2,roughness:0.95}));
      for(let i=0;i<5;i++){
        const merlon = mkBox(0.6,0.5,0.7,c,{map:texStoneBlock(c)});
        merlon.position.set(-1.8+i*0.9,3.65,0); g.add(merlon);
      }
      const slit1 = mkBox(0.12,0.9,0.74,0x151412); slit1.position.set(-1,1.9,0); g.add(slit1);
      const slit2 = slit1.clone(); slit2.position.x=1; g.add(slit2);
      return g;
    }});
  registerAsset({ id:'wall_marble', cat:'walls', family:'Matériaux naturels', label:'Marbre', icon:'⬜', color:0xe8e5db, size:[4,0.4,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.4,c,{map:texMarble(c),repeatX:1.5,repeatY:1.2,roughness:0.25,metalness:0.05}));
      const base = mkBox(4.1,0.2,0.5,0xcfc9ba); base.position.y=0.1; g.add(base);
      const cap = mkBox(4.1,0.2,0.5,0xcfc9ba); cap.position.y=2.9; g.add(cap);
      addWeathering(g,4,3,0.4,{stainColor:0x8a8478,chipColor:0xd8d2c2});
      return g;
    }});
  registerAsset({ id:'wall_granite', cat:'walls', family:'Matériaux naturels', label:'Granit', icon:'⬛', color:0x4a4844, size:[4,0.4,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.4,c,{map:texGranite(c),repeatX:2,repeatY:1.5,roughness:0.6}));
      addSeams(g,4,4,3,0.4,'y',0x2c2a26,0.02);
      addWeathering(g,4,3,0.4,{stainColor:0x2c2a26,chipColor:0x6a655a});
      return g;
    }});
  registerAsset({ id:'wall_obsidian', cat:'walls', family:'Matériaux naturels', label:'Obsidienne', icon:'🔮', color:0x14101a, size:[4,0.35,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.35,c,{map:texObsidian(c),repeatX:1.5,repeatY:1.2,roughness:0.15,metalness:0.3}));
      // Panneau nu à l'origine (0 détail, contrairement au reste de la
      // famille) — veines cristallines luminescentes + éclats de verre
      // volcanique en saillie, cohérent avec le rendu "obsidienne magique"
      // (déjà utilisé ailleurs dans le fichier pour cristal_bleu/rouge/vert).
      const veinMat = new THREE.MeshStandardMaterial({ color:0x6a3fb8, emissive:0x8a5fe0, emissiveIntensity:0.7, roughness:0.3 });
      for(let i=0;i<3;i++){
        const veinH = 0.9+Math.random()*0.8;
        const vein = mkBox(0.025,veinH,0.37,0x000000);
        vein.material = veinMat;
        vein.position.set(-1.4+i*1.4+(Math.random()-0.5)*0.3, veinH/2+Math.random()*(3-veinH-0.3), 0);
        vein.rotation.z = (Math.random()-0.5)*0.2; vein.castShadow=false;
        g.add(vein);
      }
      for(let i=0;i<4;i++){
        const shard = new THREE.Mesh(new THREE.ConeGeometry(0.06+Math.random()*0.05,0.22+Math.random()*0.15,5),
          new THREE.MeshPhysicalMaterial({ color:0x1c1424, roughness:0.1, metalness:0.2, transmission:0.2, thickness:0.3 }));
        shard.position.set((Math.random()-0.5)*3.4, 0.3+Math.random()*2.2, 0.18+Math.random()*0.04);
        shard.rotation.x = Math.PI/2 + (Math.random()-0.5)*0.6; shard.rotation.z = Math.random()*Math.PI*2;
        shard.castShadow=false;
        g.add(shard);
      }
      return g;
    }});
  registerAsset({ id:'wall_copper', cat:'walls', family:'Industriel', label:'Cuivre', icon:'🟠', color:0xb5713a, size:[4,0.25,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.25,c,{map:texCopper(c),repeatX:2,repeatY:1.5,metalness:0.6,roughness:0.4}));
      for(let ix=0; ix<4; ix++) for(let iy=0; iy<3; iy++){
        const rivet = mkCyl(0.035,0.035,0.03,0x8a5a2e,6); rivet.rotation.x=Math.PI/2; rivet.position.set(-1.7+ix*1.13,0.5+iy*1,0.13); g.add(rivet);
      }
      return g;
    }});
  registerAsset({ id:'wall_rusty', cat:'walls', family:'Industriel', label:'Rouillé', icon:'🟤', color:0x6b5a4a, size:[4,0.3,3],
    build:(c)=>{
      const g = group(mkBox(4,3,0.3,c,{map:texRust(c),repeatX:2,repeatY:1.5,metalness:0.3,roughness:0.75}));
      const hole = mkBox(0.3,0.3,0.34,0x1c1a16); hole.position.set(1.3,2.1,0); g.add(hole);
      addSeams(g,4,4,3,0.3,'x',0x3a2c1e,0.02);
      addWeathering(g,4,3,0.3,{stainColor:0x8a4a20,chipColor:0x3a2c1e});
      return g;
    }});
  registerAsset({ id:'wall_prison', cat:'walls', family:'Industriel', label:'Prison', icon:'🔒', color:0x8f8f88, size:[4,0.4,3.2],
    build:(c)=>{
      const g = group(mkBox(4,3.2,0.4,c,{map:texConcrete(c),repeatX:2,repeatY:1.6}));
      for(let i=0;i<6;i++){
        const bar = mkCyl(0.04,0.04,1.6,0x2a2a2a,8); bar.position.set(-0.9+i*0.36,1.9,0.24); g.add(bar);
      }
      const barFrame = mkBox(2.3,1.7,0.06,0x1c1c1c); barFrame.position.set(0.075,1.9,0.28); g.add(barFrame);
      return g;
    }});
  registerAsset({ id:'wall_bunker', cat:'walls', family:'Industriel', label:'Bunker', icon:'🪖', color:0x6b6b60, size:[4,0.6,2.6],
    build:(c)=>{
      const g = group(mkBox(4,2.6,0.6,c,{map:texConcrete(c),repeatX:2,repeatY:1.3}));
      for(let i=0;i<9;i++){
        const bag = mkBox(0.5,0.28,0.7,0x8a7550); bag.position.set(-2+i*0.5,0.14,0.5); bag.rotation.y=(Math.random()-0.5)*0.15; g.add(bag);
      }
      const slit = mkBox(1.4,0.3,0.64,0x151412); slit.position.set(0,1.8,0); g.add(slit);
      return g;
    }});
  registerAsset({ id:'wall_ruins', cat:'walls', family:'Historique', label:'Ruines', icon:'🏚️', color:0x8c8578, size:[4,0.45,2.4],
    build:(c)=>{
      const g = new THREE.Group();
      const left = mkBox(1.6,2.4,0.45,c,{map:texRuins(c),repeatX:1,repeatY:1.4}); left.position.x=-1.2; g.add(left);
      const right = mkBox(1.3,1.5,0.45,c,{map:texRuins(c),repeatX:1,repeatY:1}); right.position.x=1.35; g.add(right);
      for(let i=0;i<4;i++){
        const rebar = mkCyl(0.02,0.02,0.6,0x3a3a3a,6); rebar.rotation.z=Math.PI/2.3;
        rebar.position.set(-1.2+(Math.random()-0.5)*1.2, 2.2+Math.random()*0.3, 0); g.add(rebar);
      }
      const rubble = mkBox(0.6,0.3,0.5,0x77705f); rubble.position.set(0.1,0.15,0.1); g.add(rubble);
      return g;
    }});
  registerAsset({ id:'wall_temple', cat:'walls', family:'Historique', label:'Temple', icon:'🛕', color:0xd8cdb0, size:[4,0.5,3.4],
    build:(c)=>{
      const g = group(mkBox(4,3,0.5,c,{map:texTemple(c),repeatX:1.5,repeatY:1.2,roughness:0.7}));
      const col1 = mkCyl(0.22,0.24,3.2,c,10); col1.position.set(-1.85,1.6,0.3); g.add(col1);
      const col2 = mkCyl(0.22,0.24,3.2,c,10); col2.position.set(1.85,1.6,0.3); g.add(col2);
      const pediment = mkBox(4.2,0.3,0.6,0xc7bb9c); pediment.position.y=3.15; g.add(pediment);
      addWeathering(g,4,3,0.5,{stainColor:0x7a8a6a,chipColor:0xc2b89a});
      return g;
    }});
  registerAsset({ id:'wall_rampart', cat:'walls', family:'Historique', label:'Rempart', icon:'🏰', color:0x8f897a, size:[4,0.9,4.2],
    build:(c)=>{
      const g = group(mkBox(4,3.8,0.9,c,{map:texStoneBlock(c),repeatX:2,repeatY:2.2,roughness:0.95}));
      const walkway = mkBox(4.2,0.2,1.1,0x6f6a5c); walkway.position.y=3.9; g.add(walkway);
      for(let i=0;i<5;i++){
        const merlon = mkBox(0.6,0.6,0.9,c,{map:texStoneBlock(c)});
        merlon.position.set(-1.8+i*0.9,4.3,0); g.add(merlon);
      }
      return g;
    }});
  registerAsset({ id:'fence_wood', cat:'walls', family:'Clôtures & barrières', label:'Clôture bois', icon:'🪵', color:0x8a5a34, size:[4,0.15,1.2],
    build:(c)=>{
      const g = new THREE.Group();
      [-1.95,1.95].forEach(x=>{ const post = mkBox(0.14,1.3,0.14,c,{map:texWoodFloor(c)}); post.position.x=x; g.add(post); });
      for(let i=0;i<3;i++){
        const rail = mkBox(4,0.14,0.06,c,{map:texWoodFloor(c)}); rail.position.set(0,0.3+i*0.4,0); g.add(rail);
      }
      return g;
    }});
  registerAsset({ id:'fence_metal', cat:'walls', family:'Clôtures & barrières', label:'Clôture métal', icon:'🔗', color:0x5c6470, size:[4,0.1,1.4],
    build:(c)=>{
      const g = new THREE.Group();
      [-1.95,1.95].forEach(x=>{ const post = mkCyl(0.06,0.06,1.5,c,8); post.position.x=x; g.add(post); });
      for(let i=0;i<9;i++){
        const bar = mkCyl(0.025,0.025,1.3,c,6); bar.position.set(-1.8+i*0.45,0.65,0); g.add(bar);
      }
      const railTop = mkBox(4,0.05,0.05,c); railTop.position.y=1.35; g.add(railTop);
      return g;
    }});
  registerAsset({ id:'barrier_construction', cat:'walls', family:'Clôtures & barrières', label:'Barrière de chantier', icon:'🚧', color:0xe8a020, size:[2.4,0.15,1.0],
    build:(c)=>{
      const g = new THREE.Group();
      for(let i=0;i<6;i++){
        const stripe = mkBox(2.4/6,0.8,0.1, i%2===0?0xe8a020:0x1c1c1c);
        stripe.position.set(-1+i*0.4,0.4,0); g.add(stripe);
      }
      [-1.1,1.1].forEach(x=>{ const leg = mkBox(0.08,0.9,0.4,0x2a2a2a); leg.rotation.x=0.5; leg.position.set(x,0.45,0.15); g.add(leg); });
      return g;
    }});
  registerAsset({ id:'barrier_military', cat:'walls', family:'Clôtures & barrières', label:'Barrière militaire', icon:'🎖️', color:0x53603f, size:[4,0.5,1.1],
    build:(c)=>{
      const g = new THREE.Group();
      for(let i=0;i<9;i++){
        const bag1 = mkBox(0.5,0.26,0.5,c); bag1.position.set(-2+i*0.5,0.13,0); bag1.rotation.y=(Math.random()-0.5)*0.2; g.add(bag1);
        const bag2 = mkBox(0.5,0.26,0.5,c); bag2.position.set(-2+i*0.5,0.39,0); bag2.rotation.y=(Math.random()-0.5)*0.2; g.add(bag2);
      }
      const coil = mkCyl(0.22,0.22,4,0x9aa0a4,10); coil.rotation.z=Math.PI/2; coil.position.set(0,0.85,0); g.add(coil);
      return g;
    }});
  registerAsset({ id:'barrier_futuristic', cat:'walls', family:'Clôtures & barrières', label:'Barrière futuriste', icon:'✨', color:0x2a3550, size:[4,0.15,1.3],
    build:(c)=>{
      const g = new THREE.Group();
      [-1.95,1.95].forEach(x=>{ const post = mkBox(0.15,1.4,0.15,c); post.position.x=x; g.add(post); });
      const panelMat = new THREE.MeshStandardMaterial({ color:0x1a2540, emissive:0x00d4ff, emissiveIntensity:0.9, transparent:true, opacity:0.55 });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.6,1.1,0.06), panelMat); panel.position.set(0,0.75,0); g.add(panel);
      for(let i=0;i<4;i++){
        const line = new THREE.Mesh(new THREE.BoxGeometry(3.6,0.02,0.07), new THREE.MeshStandardMaterial({ color:0x00d4ff, emissive:0x00d4ff, emissiveIntensity:1.4 }));
        line.position.set(0,0.3+i*0.27,0.01); g.add(line);
      }
      return g;
    }});
  registerAsset({ id:'gate_stone', cat:'walls', family:'Portails', label:'Portail pierre', icon:'⛩️', color:0x8c8578, size:[4,0.6,3.6],
    build:(c)=>{
      const g = new THREE.Group();
      const pillarL = mkBox(0.5,3.6,0.6,c,{map:texStoneBlock(c)}); pillarL.position.x=-1.9; g.add(pillarL);
      const pillarR = mkBox(0.5,3.6,0.6,c,{map:texStoneBlock(c)}); pillarR.position.x=1.9; g.add(pillarR);
      const lintel = mkBox(4,0.5,0.6,c,{map:texStoneBlock(c)}); lintel.position.y=3.4; g.add(lintel);
      [-0.9,0.9].forEach(x=>{
        const door = mkBox(1.6,3.1,0.15,0x5c5850); door.position.set(x,1.55,0.05); g.add(door);
        const handle = mkCyl(0.04,0.04,0.3,0x2a2a2a,8); handle.rotation.z=Math.PI/2; handle.position.set(x+(x<0?0.7:-0.7),1.6,0.14); g.add(handle);
      });
      return g;
    }});
  registerAsset({ id:'gate_metal', cat:'walls', family:'Portails', label:'Portail métal', icon:'🚪', color:0x4a4f57, size:[4,0.5,3],
    build:(c)=>{
      const g = new THREE.Group();
      const pillarL = mkBox(0.35,3,0.5,c); pillarL.position.x=-1.9; g.add(pillarL);
      const pillarR = mkBox(0.35,3,0.5,c); pillarR.position.x=1.9; g.add(pillarR);
      const topBar = mkBox(4,0.15,0.5,c); topBar.position.y=3; g.add(topBar);
      [-0.9,0.9].forEach(leafX=>{
        for(let i=0;i<6;i++){
          const bar = mkCyl(0.03,0.03,2.7,0x2a2e33,8); bar.position.set(leafX-0.65+i*0.26,1.35,0); g.add(bar);
        }
        const spike = mkCyl(0,0.05,0.2,0x2a2e33,6); spike.position.set(leafX,2.8,0); g.add(spike);
      });
      return g;
    }});

  // ---- COUVERTURES ---- même logique : volumes secondaires (lattes,
  // nervures, renforts, roues...) plutôt qu'un simple pavé.
  registerAsset({ id:'cover_crate', cat:'covers', label:'Caisse', icon:'📦', color:0x8a6a3f, size:[1.4,1.4,1.4],
    build:(c)=>{
      const g = group(mkBox(1.4,1.4,1.4,c,{map:texWoodFloor(c),repeatX:1.5,repeatY:1.5}));
      // cornières aux 4 arêtes verticales
      for(const [sx,sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
        const edge = mkBox(0.08,1.42,0.08,0x5a4025);
        edge.position.set(sx*0.66, 0.71, sz*0.66);
        g.add(edge);
      }
      // étiquette de pochoir (marquage de transport) sur la face avant
      const stencil = mkBox(0.7,0.35,0.02,0xd9c9a3);
      stencil.position.set(0,0.9,0.71); stencil.castShadow=false; g.add(stencil);
      const stencilBar = mkBox(0.5,0.06,0.03,0x3a2f1e);
      stencilBar.position.set(0,0.9,0.72); stencilBar.castShadow=false; g.add(stencilBar);
      // poignée de corde encastrée sur le dessus
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.14,0.025,6,12), new THREE.MeshStandardMaterial({ color:0x4a3a26 }));
      handle.rotation.x = Math.PI/2; handle.position.y = 1.41; g.add(handle);
      // planches latérales visibles (rainures) sur la face droite
      // petit numéro de lot pochoir sur le côté (second marquage)
      const stencil2 = mkBox(0.35,0.18,0.02,0xd9c9a3);
      stencil2.position.set(0.71,0.35,0.4); stencil2.rotation.y=Math.PI/2; stencil2.castShadow=false;
      g.add(stencil2);
      // rustines/patchs de réparation + coin écaillé + symbole fragile
      const patch = mkBox(0.3,0.3,0.03,0x6b5330); patch.position.set(-0.4,0.35,0.71); patch.castShadow=false; g.add(patch);
      const wornCorner = mkBox(0.22,0.22,0.22,0x76603a); wornCorner.position.set(0.66,1.28,0.66); wornCorner.rotation.y=0.3; g.add(wornCorner);
      const fragile = mkCyl(0.09,0.09,0.02,0xd6342a,3); fragile.rotation.x=Math.PI/2; fragile.position.set(0.35,0.5,0.71); fragile.castShadow=false; g.add(fragile);
      return g;
    }});
  registerAsset({ id:'cover_pallet', cat:'covers', label:'Palette', icon:'🟫', color:0x9a7a4a, size:[1.6,1.2,0.3],
    build:(c)=>{
      const g = new THREE.Group();
      const cCol = new THREE.Color(c);
      for(let i=0;i<5;i++){
        const shade = cCol.clone().multiplyScalar(i%2===0 ? 1 : 0.88).getHex();
        const slat = mkBox(1.6,0.06,0.18,shade,{map:texWoodFloor(shade),repeatX:1.6,repeatY:0.3});
        slat.position.set(0,0.22,-0.48+i*0.24);
        g.add(slat);
      }
      const base1=mkBox(1.6,0.16,0.18,0x7a5f38); base1.position.z=-0.5; g.add(base1);
      const base2=mkBox(1.6,0.16,0.18,0x7a5f38); base2.position.z=0.5; g.add(base2);
      // blocs d'appui sous les lattes (3 plots, comme une vraie palette Europe)
      for(const bx of [-0.7,0,0.7]){
        const block = mkBox(0.16,0.16,1.0,0x6b5330);
        block.position.set(bx,0.08,0); block.castShadow=false;
        g.add(block);
      }
      // clous visibles à chaque intersection latte/plot
      for(const bx of [-0.7,0,0.7]) for(let i=0;i<5;i++){
        const nail = mkCyl(0.012,0.012,0.02,0x2a2a2a,5);
        nail.rotation.x = Math.PI/2;
        nail.position.set(bx, 0.25, -0.48+i*0.24);
        nail.castShadow = false;
        g.add(nail);
      }
      // marquage de traitement thermique + fissure sur une latte + éclisse de renfort
      const stamp = mkBox(0.3,0.14,0.01,0x4a3a26); stamp.position.set(0.5,0.26,0); stamp.rotation.x=-Math.PI/2; stamp.castShadow=false; g.add(stamp);
      const crackP = mkBox(0.4,0.01,0.03,0x5a4530); crackP.position.set(-0.4,0.26,-0.24); crackP.castShadow=false; g.add(crackP);
      const splint = mkBox(0.5,0.08,0.2,0x8a6a3f); splint.position.set(0,0.26,-0.5); splint.castShadow=false; g.add(splint);
      return g;
    }});
  registerAsset({ id:'cover_container', cat:'covers', label:'Container', icon:'🚢', color:0xc0472b, size:[6,2.5,2.4],
    build:(c)=>{
      const g = group(mkBox(6,2.5,2.4,c,{metalness:0.3,map:texCorrugated(c),repeatX:8,repeatY:1}));
      for(let i=1;i<12;i++){ // nervures corruguées le long du container
        const rib = mkBox(0.06,2.5,2.42,0x9a3820);
        rib.position.x = -3 + i*0.5;
        rib.castShadow = false;
        g.add(rib);
      }
      const doorFrame = mkBox(0.1,2.5,2.42,0x6b2414); doorFrame.position.x=3; g.add(doorFrame);
      // barres de verrouillage + charnières visibles sur la porte
      for(const dy of [-1,1]){
        const rod = mkBox(0.05,2.2,0.04,0x2a2a2a);
        rod.position.set(3.06, 1.1, dy*0.5); g.add(rod);
      }
      for(const hy of [-1,0,1]){
        const hinge = mkBox(0.08,0.18,0.06,0x1a1a1a);
        hinge.position.set(3.1, 1.25+hy*0.9, 1.15); g.add(hinge);
      }
      // bande logo décorative
      const stripe = mkBox(6.02,0.3,0.02,0xf0f0f0);
      stripe.position.set(0,0.2,1.22); stripe.castShadow=false; g.add(stripe);
      // coulures de rouille sous les nervures (usure réaliste)
      for(let i=0;i<4;i++){
        const rust = mkBox(0.1,0.9,0.03,0x6b2414,{opacity:0.55});
        rust.position.set(-2+i*1.3, 1.5, 1.22); rust.castShadow=false;
        g.add(rust);
      }
      // numéro d'identification ISO + cadenas de sécurité + coin renforcé
      const idPlate = mkBox(1.2,0.3,0.02,0xf0f0f0); idPlate.position.set(-1.5,2.2,1.22); idPlate.castShadow=false; g.add(idPlate);
      const idText = mkBox(1,0.15,0.025,0x1c1c1c); idText.position.set(-1.5,2.2,1.23); idText.castShadow=false; g.add(idText);
      const lock = mkBox(0.15,0.2,0.08,0x2a2a2a); lock.position.set(3.1,1.25,1.15); g.add(lock);
      for(const cy of [-1.2,1.2]){
        const cornerCast = mkBox(0.2,0.2,2.42,0x1c1c1c); cornerCast.position.set(cy*2.5,0.1,0); g.add(cornerCast);
      }
      return g;
    }});
  registerAsset({ id:'cover_barrier', cat:'covers', label:'Barrière', icon:'🚧', color:0xd6a020, size:[2.4,1.1,0.3],
    build:(c)=>{
      const g = new THREE.Group();
      const top = mkBox(2.4,0.18,0.3,c); top.position.y=0.95; g.add(top);
      const bot = mkBox(2.4,0.18,0.3,c); bot.position.y=0.25; g.add(bot);
      // rayures diagonales alternées noir/jaune sur les deux panneaux
      [0.95,0.25].forEach(py=>{
        for(let i=0;i<5;i++){
          const stripe = mkBox(0.16,0.19,0.32,0x1c1c1c);
          stripe.rotation.z = 0.5;
          stripe.position.set(-0.9+i*0.45, py, 0);
          stripe.castShadow = false;
          g.add(stripe);
        }
      });
      for(const sx of [-1,1]){
        const leg = mkBox(0.12,1.1,0.3,0x2a2a2a);
        leg.position.x = sx*1.1;
        g.add(leg);
      }
      const brace1 = mkBox(0.1,1.3,0.06,0x2a2a2a); brace1.rotation.z=0.6; g.add(brace1);
      const brace2 = mkBox(0.1,1.3,0.06,0x2a2a2a); brace2.rotation.z=-0.6; g.add(brace2);
      // gyrophare d'avertissement au sommet
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8), new THREE.MeshStandardMaterial({ color:0xff3b1a, emissive:0xff3b1a, emissiveIntensity:1 }));
      beacon.position.set(0,1.12,0); g.add(beacon);
      // catadioptres réfléchissants aux extrémités
      [-1.15,1.15].forEach(px=>{
        const reflector = mkBox(0.06,0.14,0.32,0xff3b1a);
        reflector.material.emissive = new THREE.Color(0xff3b1a);
        reflector.material.emissiveIntensity = 0.4;
        reflector.position.set(px,0.6,0); g.add(reflector);
      });
      // panneau "danger" + base en béton + chaîne de délimitation
      const dangerSign = mkBox(0.5,0.5,0.03,0xf0f0f0); dangerSign.position.set(0,0.6,0.17); g.add(dangerSign);
      const dangerText = mkBox(0.36,0.08,0.035,0x1c1c1c); dangerText.position.set(0,0.6,0.185); g.add(dangerText);
      [-1.1,1.1].forEach(sx=>{
        const foot = mkBox(0.35,0.12,0.5,0x6e6e6a); foot.position.set(sx,0.06,0); g.add(foot);
      });
      return g;
    }});
  registerAsset({ id:'cover_bunker', cat:'covers', label:'Bunker', icon:'🛡️', color:0x6b6b60, size:[3,1.6,3],
    build:(c)=>{
      const g = group(mkBox(3,1.6,3,c,{map:texConcrete(c),repeatX:2,repeatY:1}), (()=>{ const t=mkBox(3.2,0.3,3.2,c); t.position.y=1.6; return t; })());
      // ceinture de sacs de sable tout autour de la base
      const positions = [];
      for(let i=0;i<5;i++) positions.push([-1.5+i*0.75,-1.55]);
      for(let i=0;i<5;i++) positions.push([-1.5+i*0.75, 1.55]);
      for(let i=0;i<3;i++) positions.push([-1.55,-1.1+i*1.1]);
      for(let i=0;i<3;i++) positions.push([1.55,-1.1+i*1.1]);
      positions.forEach(([x,z])=>{
        const bag = mkCyl(0.24,0.28,0.4,0x8a7a52,8);
        bag.rotation.z = Math.PI/2;
        bag.position.set(x,0.24,z);
        g.add(bag);
      });
      // meurtrière de tir sur la face avant
      const slit = mkBox(1.4,0.22,0.1,0x14161a);
      slit.position.set(0,1.1,1.52); slit.castShadow=false; g.add(slit);
      // antenne radio sur le toit
      const mast = mkCyl(0.02,0.03,1.1,0x2a2a2a,6); mast.position.set(1,1.9,1); g.add(mast);
      // porte d'accès arrière + marquage de rang + périscope
      const doorB = mkBox(0.8,1.4,0.1,0x3a3a36); doorB.position.set(0,0.7,-1.52); g.add(doorB);
      const rank = mkBox(0.3,0.3,0.02,0x8a7a52); rank.position.set(-1.2,1.3,1.51); rank.castShadow=false; g.add(rank);
      const periscope = mkCyl(0.04,0.04,0.5,0x2a2a2a,6); periscope.position.set(-0.8,1.9,0.6); g.add(periscope);
      return g;
    }});
  registerAsset({ id:'cover_vehicle', cat:'covers', label:'Véhicule', icon:'🚙', color:0x3a4a5a, size:[4.2,1.6,2],
    build:(c)=>{
      const g = group(mkBox(4.2,1.3,2,c), (()=>{ const cab=mkBox(2,0.9,1.9,c); cab.position.set(-0.3,1.3,0); return cab; })());
      const glass = mkBox(1.8,0.6,1.95,0x9dd8e0,{opacity:0.4,roughness:0.05}); glass.position.set(-0.3,1.55,0); g.add(glass);
      for(const [sx,sz] of [[-1.7,-1],[-1.7,1],[1.7,-1],[1.7,1]]){
        const wheel = mkCyl(0.42,0.42,0.3,0x1a1a1a,14);
        wheel.rotation.z = Math.PI/2;
        wheel.position.set(sx, 0.42, sz*0.95);
        g.add(wheel);
      }
      // phares avant + feux arrière
      const headlightMat = new THREE.MeshStandardMaterial({ color:0xfff3c8, emissive:0xfff3c8, emissiveIntensity:0.8 });
      for(const sz of [-0.7,0.7]){
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.1,8,8), headlightMat);
        light.position.set(2.05, 0.75, sz); g.add(light);
      }
      const tailMat = new THREE.MeshStandardMaterial({ color:0xff3b1a, emissive:0xff3b1a, emissiveIntensity:0.7 });
      for(const sz of [-0.7,0.7]){
        const light = mkBox(0.06,0.18,0.14,0xff3b1a);
        light.material = tailMat; light.position.set(-2.05,0.75,sz); g.add(light);
      }
      // pare-chocs + rétroviseurs
      const bumper = mkBox(0.3,0.35,2.05,0x1c2128); bumper.position.set(2.1,0.55,0); g.add(bumper);
      for(const sz of [-1,1]){
        const mirror = mkBox(0.06,0.14,0.22,0x1c2128);
        mirror.position.set(0.6,1.55,sz*1.0); g.add(mirror);
      }
      // pot d'échappement arrière
      const exhaust = mkCyl(0.06,0.06,0.3,0x3a3a3a,8); exhaust.rotation.z=Math.PI/2; exhaust.position.set(-2.15,0.35,0.6); g.add(exhaust);
      // galerie de toit + plaque d'immatriculation + poignées de portière
      const roofRack = new THREE.Group();
      for(const rz of [-0.7,0.7]){ const bar = mkBox(1.6,0.05,0.05,0x1c2128); bar.position.set(-0.3,2.05,rz); roofRack.add(bar); }
      g.add(roofRack);
      const plate = mkBox(0.4,0.15,0.02,0xe8e8e8); plate.position.set(2.11,0.5,0); plate.castShadow=false; g.add(plate);
      for(const sz of [-1,1]){
        const doorHandle = mkBox(0.15,0.04,0.03,0x1c2128); doorHandle.position.set(0.2,0.85,sz*1.01); g.add(doorHandle);
      }
      return g;
    }});

  registerAsset({ id:'cover_sandbags', cat:'covers', label:'Sacs de sable', icon:'🟫', color:0x9c8a5e, size:[1.8,0.7,0.8],
    build:(c)=>{
      const g = new THREE.Group();
      const rows = 2, perRow = 4;
      for(let row=0; row<rows; row++){
        for(let i=0; i<perRow; i++){
          const sag = mkBox(0.46,0.32,0.46,c,{roughness:0.95});
          sag.position.set(-0.75+i*0.5+(row%2?0.25:0), 0.16+row*0.32, 0);
          sag.rotation.y = (i%2?0.06:-0.06);
          g.add(sag);
        }
      }
      return g;
    }});
  registerAsset({ id:'cover_concrete_block', cat:'covers', label:'Bloc de béton', icon:'⬛', color:0x8a8a86,
    size:[1.6,0.6,0.6],
    build:(c)=>{ const g = group(mkBox(1.6,0.6,0.6,c,{roughness:0.9})); addWeathering(g,1.6,0.6,0.6,{stainColor:0x3a3a34}); return g; }});
  registerAsset({ id:'cover_metal_barricade', cat:'covers', label:'Muret métallique', icon:'🚧', color:0x5c6470,
    size:[1.8,0.9,0.15],
    build:(c)=>{
      const g = group(mkBox(1.8,0.9,0.1,c,{metalness:0.4,roughness:0.5}));
      for(const sx of [-0.75,0.75]){ const leg = mkBox(0.08,0.9,0.3,0x2a2e33); leg.position.set(sx,0.45,0); g.add(leg); }
      const stripe = mkBox(1.7,0.12,0.11,0xf0c020); stripe.position.y=0.15; g.add(stripe);
      return g;
    }});
  registerAsset({ id:'cover_dumpster', cat:'covers', label:'Benne à déchets', icon:'🗑️', color:0x4a6a4a,
    size:[1.6,1.1,1.0],
    build:(c)=>{
      const g = group(mkBox(1.6,1.0,1.0,c,{roughness:0.8}));
      const lid = mkBox(1.7,0.08,1.05,c,{roughness:0.7}); lid.position.y=0.54; lid.rotation.z=0.12; g.add(lid);
      for(const sx of [-0.6,0.6]){ const wheel = mkCyl(0.1,0.1,0.06,0x1a1a1a,10); wheel.rotation.x=Math.PI/2; wheel.position.set(sx,0.1,0.45); g.add(wheel); }
      return g;
    }});

  // ---- STRUCTURES ---- chaque bâtiment combine volume principal + toit/
  // corniche + fenêtres en grille + porte, plutôt qu'un simple pavé —
  // même logique de détail que Murs/Couvertures.
  registerAsset({ id:'struct_building', cat:'structures', family:'Urbain & commercial', label:'Bâtiment', icon:'🏢', color:0xb9ac8e, size:[10,8,10],
    build:(c)=>{
      const g = group(mkBox(10,8,10,c,{map:texStuc(c), repeatX:4, repeatY:3}));
      const parapet = mkBox(10.3,0.5,10.3,0x9a8f76); parapet.position.y=8; g.add(parapet);
      addWindowGrid(g, 4, 3, 10, 8, 10.05, 'z');
      addWindowGrid(g, 4, 3, 10, 8, 10.05, '-z');
      const door = mkBox(1.6,2.4,0.15,0x3a3025); door.position.set(0,1.2,5.02); g.add(door);
      // auvent d'entrée + climatiseurs de toit
      const awning = mkBox(2.4,0.12,1,0x5c6470); awning.position.set(0,2.5,5.5); g.add(awning);
      for(const ax of [-2.5,1.5]){
        const ac = mkBox(1,0.6,1,0x8f9499); ac.position.set(ax,8.3,-2); g.add(ac);
      }
      // château d'eau sur le toit — silhouette urbaine typique
      const tankLegs = new THREE.Group();
      for(const [lx,lz] of [[-0.4,-0.4],[0.4,-0.4],[-0.4,0.4],[0.4,0.4]]){
        const leg = mkBox(0.1,1.2,0.1,0x4a3a26); leg.position.set(lx,0.6,lz); tankLegs.add(leg);
      }
      const tankBody = mkCyl(0.9,0.9,1.3,0x6b5a45,10); tankBody.position.y=1.85;
      tankLegs.add(tankBody);
      tankLegs.position.set(-3,8.3,2.5);
      g.add(tankLegs);
      // corniche décorative en bas de façade + caméra de surveillance + numéro de rue
      const cornice2 = mkBox(10.3,0.25,10.3,0x9a8f76); cornice2.position.y=0.3; g.add(cornice2);
      const camera = mkBox(0.15,0.15,0.3,0x1c1c1c); camera.position.set(2,4.5,5.05); camera.rotation.x=0.3; g.add(camera);
      const cameraLens = new THREE.Mesh(new THREE.SphereGeometry(0.04,6,6), new THREE.MeshStandardMaterial({ color:0x111111, metalness:0.6 }));
      cameraLens.position.set(2,4.4,5.2); g.add(cameraLens);
      const streetNum = mkBox(0.4,0.3,0.02,0x3a3025); streetNum.position.set(1.2,2.2,5.02); streetNum.castShadow=false; g.add(streetNum);
      // garde-corps de toit + parabole satellite + coffret électrique mural
      for(let i=0;i<4;i++){
        const rail = mkBox(0.05,0.7,0.05,0x2a2a2a);
        rail.position.set(-4+i*2.6, 8.6, 4.9); g.add(rail);
      }
      const railTop = mkBox(10,0.05,0.05,0x2a2a2a); railTop.position.set(0,8.95,4.9); g.add(railTop);
      const dishB = new THREE.Mesh(new THREE.SphereGeometry(0.35,10,8,0,Math.PI*2,0,Math.PI/2), new THREE.MeshStandardMaterial({ color:0xd9d9d9, side:THREE.DoubleSide }));
      dishB.rotation.x = Math.PI*0.8; dishB.position.set(3.5,8.4,-3); g.add(dishB);
      const meterBox = mkBox(0.35,0.5,0.12,0x3a3f45); meterBox.position.set(-4.6,1.3,5.06); g.add(meterBox);
      return g;
    }});
  registerAsset({ id:'struct_garage', cat:'structures', family:'Urbain & commercial', label:'Garage', icon:'🚗', color:0x8a8378, size:[7,3.2,6],
    build:(c)=>{
      const g = group(mkBox(7,3.2,6,c,{map:texConcrete(c), repeatX:3, repeatY:1.5}));
      // Cadre en RETRAIT (posé presque à fleur du mur), lattes clairement
      // EN AVANT de ce cadre — un vrai espacement en Z entre les deux
      // évite le scintillement/chevauchement visuel qu'on avait avant
      // (cadre et lattes occupaient la même tranche de profondeur).
      const frame = mkBox(3.4,2.9,0.06,0x33373d); frame.position.set(-1.2,1.5,3.0); g.add(frame);
      for(let i=0;i<6;i++){
        const slat = mkBox(3.2,0.42,0.1,0x5c6470);
        slat.position.set(-1.2, 0.3+i*0.46, 3.1);
        slat.castShadow = false;
        g.add(slat);
      }
      addWindowGrid(g, 2, 1, 7, 3.2, 6.05, '-z');
      // débord de toit + gouttière + applique lumineuse
      const overhang = mkBox(7.6,0.15,6.6,0x6b6459); overhang.position.y=3.2; g.add(overhang);
      const gutter = mkBox(7.6,0.08,0.1,0x3a3a3a); gutter.position.set(0,3.1,3.3); g.add(gutter);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1,8,8), new THREE.MeshStandardMaterial({ color:0xfff3c8, emissive:0xfff3c8, emissiveIntensity:0.9 }));
      lamp.position.set(-1.2,2.95,3.2); g.add(lamp);
      // grille de ventilation latérale
      const vent = mkBox(0.6,0.6,0.05,0x2a2e33); vent.position.set(3.02,2,0); vent.rotation.y=Math.PI/2; g.add(vent);
      // descente de gouttière + tuyau d'arrosage enroulé + plaque numérotée
      const downspout = mkBox(0.08,3,0.08,0x3a3a3a); downspout.position.set(3.4,1.5,2.9); g.add(downspout);
      const hoseReel = mkCyl(0.18,0.18,0.1,0x2a5a3a,10); hoseReel.rotation.z=Math.PI/2; hoseReel.position.set(3.02,0.5,-2); g.add(hoseReel);
      const plateNum = mkBox(0.3,0.2,0.02,0xe8e8e8); plateNum.position.set(-2.9,1.6,3.04); plateNum.castShadow=false; g.add(plateNum);
      // pile de pneus + tache d'huile au sol devant la porte
      for(let i=0;i<3;i++){
        const tire = mkCyl(0.35,0.35,0.22,0x1c1c1c,14); tire.rotation.x=Math.PI/2;
        tire.position.set(3.0,0.22+i*0.22,-2); g.add(tire);
      }
      const oilStain = new THREE.Mesh(new THREE.CircleGeometry(0.7,10), new THREE.MeshStandardMaterial({ color:0x141414, roughness:1 }));
      oilStain.rotation.x=-Math.PI/2; oilStain.position.set(-1.2,0.02,4.2); oilStain.castShadow=false; g.add(oilStain);
      return g;
    }});
  registerAsset({ id:'struct_hangar', cat:'structures', family:'Urbain & commercial', label:'Hangar', icon:'🛩️', color:0x717a82, size:[12,6,9],
    build:(c)=>{
      const g = group(mkBox(12,6,9,c,{map:texCorrugated(c), repeatX:8, repeatY:1}), (()=>{ const r=mkBox(12.4,0.8,9.4,0x4a4f57); r.position.y=6; return r; })());
      // panneaux corrugués verticaux sur les grands côtés
      for(let i=1;i<16;i++){
        const rib = mkBox(0.05,5.8,9.02,0x5c6470);
        rib.position.set(-6+i*0.75, 3, 0);
        rib.castShadow = false;
        g.add(rib);
      }
      const bigDoor = mkBox(6,4.6,0.15,0x33373d); bigDoor.position.set(0,2.3,4.55); g.add(bigDoor);
      const doorSeam = mkBox(0.08,4.6,0.06,0x1e2124); doorSeam.position.set(0,2.3,4.68); g.add(doorSeam);
      // petite porte piétonne + évents latéraux + faîtage de toit
      const sideDoor = mkBox(1,2.2,0.12,0x2a2e33); sideDoor.position.set(5.02,1.1,-2); sideDoor.rotation.y=Math.PI/2; g.add(sideDoor);
      for(const vy of [2,4]){
        const vent = mkBox(0.6,0.5,0.15,0x3a3f45);
        vent.position.set(-5.5,vy,4.53); g.add(vent);
      }
      const ridge = mkBox(0.5,0.3,9.5,0x33373d); ridge.position.y=6.4; g.add(ridge);
      // contreforts extérieurs le long des grands côtés
      for(let i=0;i<3;i++){
        const strut = mkBox(0.3,6,0.4,0x3a3f45);
        strut.position.set(-4+i*4, 3, 4.7); g.add(strut);
      }
      // manche à air + projecteur d'approche + numéro de hangar peint
      const windsockPole = mkCyl(0.03,0.03,2,0x8f9499,6); windsockPole.position.set(5.5,7,-4); g.add(windsockPole);
      const windsock = mkCyl(0.15,0.03,0.8,0xf0c020,8); windsock.rotation.z=Math.PI/2; windsock.position.set(5.9,7.9,-4); g.add(windsock);
      const spotlight = mkBox(0.4,0.3,0.3,0x2a2e33); spotlight.position.set(0,5.6,4.65); g.add(spotlight);
      const hangarNum = mkBox(1.2,1,0.03,0xf0f0f0); hangarNum.position.set(-4.5,4,4.56); hangarNum.castShadow=false; g.add(hangarNum);
      // fûts de carburant + cônes de sécurité + échelle d'accès au toit
      for(let i=0;i<3;i++){
        const drum = mkCyl(0.35,0.35,0.9,i%2===0?0xc0472b:0x2a5a3a,12);
        drum.position.set(5.4,0.45,-3.6+i*0.8); g.add(drum);
      }
      for(let i=0;i<3;i++){
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18,0.5,8), new THREE.MeshStandardMaterial({ color:0xd9a03c }));
        cone.position.set(-5.6+i*0.5,0.25,4.9); g.add(cone);
      }
      const roofLadder = mkBox(0.4,3.4,0.05,0x3a3f45); roofLadder.position.set(-5.4,4.7,4.5); g.add(roofLadder);
      return g;
    }});
  registerAsset({ id:'struct_office', cat:'structures', family:'Urbain & commercial', label:'Bureau', icon:'🏬', color:0xcdd6db, size:[8,9,8],
    build:(c)=>{
      const g = group(mkBox(8,9,8,c,{metalness:0.1,roughness:0.3,map:texConcrete(c),repeatX:4,repeatY:4}));
      addWindowGrid(g, 5, 5, 8, 9, 8.05, 'z', 0x8fc4d6);
      addWindowGrid(g, 5, 5, 8, 9, 8.05, '-z', 0x8fc4d6);
      addWindowGrid(g, 5, 5, 8, 9, 8.05, 'x', 0x8fc4d6);
      addWindowGrid(g, 5, 5, 8, 9, 8.05, '-x', 0x8fc4d6);
      const cap = mkBox(8.2,0.3,8.2,0xa9b2b8); cap.position.y=9; g.add(cap);
      // rez-de-chaussée vitrine (bandeau vitré pleine hauteur) + auvent d'entrée
      const storefront = mkBox(8.02,1.8,0.05,0x8fc4d6,{opacity:0.5,roughness:0.05});
      storefront.position.set(0,0.9,4.03); storefront.castShadow=false; g.add(storefront);
      const canopy = mkBox(3,0.15,1.4,0x33373d); canopy.position.set(0,2,4.7); g.add(canopy);
      for(const rx of [-2.5,2.5]){
        const hvac = mkBox(1.2,0.7,1.2,0x8f9499); hvac.position.set(rx,9.35,-2); g.add(hvac);
      }
      // enseigne lumineuse sur le toit
      const sign = mkBox(3,0.6,0.15,0x1c2128); sign.position.set(0,9.6,0); g.add(sign);
      const signGlow = mkBox(2.6,0.35,0.02,0x4ecdc4); signGlow.position.set(0,9.6,0.09);
      signGlow.material.emissive = new THREE.Color(0x4ecdc4); signGlow.material.emissiveIntensity = 1;
      g.add(signGlow);
      // drapeau d'entreprise + jardinières en pied de vitrine + rampe d'accès PMR
      const flagPoleO = mkCyl(0.03,0.03,3,0x8f9499,6); flagPoleO.position.set(-3,1.5,4.5); g.add(flagPoleO);
      const flagO = mkBox(0.7,0.45,0.02,0x4ecdc4); flagO.position.set(-2.6,2.7,4.5); g.add(flagO);
      const planterO = mkBox(3,0.5,0.4,0x6b5330); planterO.position.set(2.5,0.25,4.4); g.add(planterO);
      const ramp = mkBox(2,0.1,1.5,0x8f9499); ramp.rotation.x=-0.15; ramp.position.set(-1.5,0.1,4.9); g.add(ramp);
      // antennes de toit + range-vélos + banc d'entrée
      for(let i=0;i<3;i++){
        const antO = mkCyl(0.025,0.025,0.9+i*0.3,0x2a2a2a,6);
        antO.position.set(-1+i*0.8,9.15+ (0.45+i*0.15),-3); g.add(antO);
      }
      for(let i=0;i<4;i++){
        const rackBar = mkBox(0.03,0.35,0.5,0x3a3a3a); rackBar.position.set(1.5+i*0.3,0.18,4.7); g.add(rackBar);
      }
      const benchO = mkBox(1.4,0.4,0.4,0x5c6470); benchO.position.set(1.5,0.2,3.6); g.add(benchO);
      return g;
    }});
  registerAsset({ id:'struct_tower', cat:'structures', family:'Urbain & commercial', label:'Tour', icon:'🗼', color:0x9aa2a8, size:[5,16,5],
    build:(c)=>{
      const PODIUM_H = 1.6;
      const podium = mkBox(6.6,PODIUM_H,6.6,new THREE.Color(c).multiplyScalar(0.85).getHex());
      const towerGroup = new THREE.Group();
      towerGroup.add(mkBox(5,16,5,c,{map:texStuc(c),repeatX:3,repeatY:8}));
      addWindowGrid(towerGroup, 2, 7, 5, 16, 5.05, 'z', 0x8fc4d6);
      addWindowGrid(towerGroup, 2, 7, 5, 16, 5.05, '-z', 0x8fc4d6);
      const antenna = mkCyl(0.05,0.08,3,0x2a2a2a,6); antenna.position.y=16+1.5; towerGroup.add(antenna);
      const roofEquip = mkBox(1.4,0.6,1.4,0x5c6470); roofEquip.position.set(1,16.3,1); towerGroup.add(roofEquip);
      // balise clignotante au sommet de l'antenne
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8), new THREE.MeshStandardMaterial({ color:0xff3b1a, emissive:0xff3b1a, emissiveIntensity:1.2 }));
      beacon.position.y = 16+3; towerGroup.add(beacon);
      // ceintures techniques horizontales tous les ~5m (casse la
      // silhouette trop lisse d'une simple tour rectangulaire)
      for(let i=1;i<3;i++){
        const belt = mkBox(5.3,0.25,5.3,0x7a828a);
        belt.position.y = i*5; towerGroup.add(belt);
      }
      // parabole de télécommunication + nacelle de nettoyage + porte d'entrée au podium
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.6,10,8,0,Math.PI*2,0,Math.PI/2), new THREE.MeshStandardMaterial({ color:0xd9d9d9, side:THREE.DoubleSide }));
      dish.rotation.x = Math.PI; dish.position.set(-1.5,15.6,0);
      towerGroup.add(dish);
      const gondola = mkBox(0.5,0.8,0.3,0x2a2e33); gondola.position.set(2.6,10,0); towerGroup.add(gondola);
      // porte d'entrée sur la façade du podium (podium centré en Y, sa face
      // avant est à z=3.3 et sa base locale à y=-PODIUM_H/2)
      const podiumDoor = mkBox(1.4,1.5,0.15,0x2a2e33);
      podiumDoor.position.set(0,-PODIUM_H/2+0.75,3.32);
      podium.add(podiumDoor);
      // trappe d'accès sur le toit + jardinières au pied du podium
      const hatch = mkBox(0.8,0.15,0.8,0x3a3f45); hatch.position.set(-1.5,16.35,-1.5); towerGroup.add(hatch);
      for(const px of [-2.6,2.6]){
        const planterT = mkBox(2,0.5,0.5,0x6b5330); planterT.position.set(px,-PODIUM_H/2+0.25,2.9); podium.add(planterT);
      }
      // toute la tour (corps + fenêtres + toit) posée en un bloc SUR le
      // podium, en décalant le groupe entier plutôt que chaque enfant un
      // par un — évite tout risque d'oubli/désynchronisation des offsets.
      towerGroup.position.y = PODIUM_H;
      const g = group(podium, towerGroup);
      return g;
    }});
  registerAsset({ id:'struct_warehouse', cat:'structures', family:'Urbain & commercial', label:'Entrepôt', icon:'🏚️', color:0xa39a80, size:[14,7,11],
    build:(c)=>{
      const g = group(mkBox(14,7,11,c,{map:texCorrugated(c),repeatX:10,repeatY:1.5}));
      const roof = mkBox(14.3,0.4,11.3,0x7a7160); roof.position.y=7; g.add(roof);
      // quais de chargement (3 portes) sur la face avant — nettement en
      // saillie de la façade (et donc de la grille de fenêtres générée
      // automatiquement juste derrière) pour ne jamais s'y chevaucher.
      for(let i=0;i<3;i++){
        const dock = mkBox(2.4,3.4,0.15,0x33373d);
        dock.position.set(-4.4+i*4.4, 1.7, 5.65);
        g.add(dock);
      }
      // évents de toit + lanterneaux vitrés + bandeau de fenêtres hautes
      for(let i=0;i<3;i++){
        const vent = mkBox(0.8,0.5,0.8,0x5c6470);
        vent.position.set(-4+i*4, 7.4, 0);
        g.add(vent);
      }
      for(let i=0;i<4;i++){
        const skylight = mkBox(1.4,0.1,1.4,0x8fc4d6,{opacity:0.55,roughness:0.05});
        skylight.position.set(-5+i*3.3, 7.25, 3); skylight.castShadow=false;
        g.add(skylight);
      }
      addWindowGrid(g, 6, 1, 14, 7, 11.05, 'z', 0x8fc4d6);
      // escalier extérieur métallique vers une porte latérale
      for(let i=0;i<6;i++){
        const step = mkBox(1,0.1,0.4,0x3a3f45);
        step.position.set(-7.3,0.15+i*0.3,-3+i*0.4); step.castShadow=false;
        g.add(step);
      }
      const sideDoor2 = mkBox(1,2.1,0.12,0x2a2e33); sideDoor2.position.set(-7.05,2.75,-0.6); g.add(sideDoor2);
      // quai de plain-pied + auvent des quais + panneau de numérotation
      const dockPlatform = mkBox(14.3,0.6,1.4,0x6e6e6a); dockPlatform.position.set(0,0.3,6.2); g.add(dockPlatform);
      const dockCanopy = mkBox(9,0.15,2,0x33373d); dockCanopy.position.set(0,3.8,6); g.add(dockCanopy);
      for(let i=0;i<3;i++){
        const dockNum = mkBox(0.4,0.4,0.02,0xf0c020); dockNum.position.set(-4.4+i*4.4,3.2,5.73); dockNum.castShadow=false; g.add(dockNum);
      }
      // pile de palettes chargées + coffret électrique + rangée de panneaux solaires sur le toit
      for(let i=0;i<3;i++){
        const palletStack = mkBox(1.2,0.15,1,0x9a7a4a); palletStack.position.set(6,0.15+i*0.5,-4.5); g.add(palletStack);
        const boxOnPallet = mkBox(0.9,0.35,0.8,0x8a6a3f); boxOnPallet.position.set(6,0.4+i*0.5,-4.5); g.add(boxOnPallet);
      }
      const elecBox = mkBox(0.5,0.7,0.15,0x3a3f45); elecBox.position.set(-6.85,1.5,-5.2); g.add(elecBox);
      for(let i=0;i<5;i++){
        const panel = mkBox(1.6,0.06,1,0x1c2530); panel.rotation.z=0.15;
        panel.position.set(-5+i*2.6,7.55,-3); g.add(panel);
      }
      return g;
    }});

  // ---- 10 STRUCTURES SUPPLÉMENTAIRES — même niveau de détail (volume
  // principal texturé + accessoires) que les 6 premières.
  registerAsset({ id:'struct_kiosk', cat:'structures', family:'Urbain & commercial', label:'Kiosque', icon:'🏪', color:0x6b4a2e, size:[2.6,3,2.6],
    build:(c)=>{
      const base = mkCyl(1.3,1.3,2.2,c,8);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6,1,8), new THREE.MeshStandardMaterial({ color:0x8a5a2a }));
      roof.position.y = 2.7; roof.castShadow=false;
      const g = group(base, roof);
      const counter = mkBox(1.6,0.9,0.15,0x3a3025); counter.position.set(0,0.6,1.2); g.add(counter);
      const window1 = mkBox(1.4,1,0.1,0x9dd8e0,{opacity:0.5}); window1.position.set(0,1.7,1.25); window1.castShadow=false; g.add(window1);
      const awning = mkBox(1.8,0.08,0.8,0xc0472b); awning.rotation.x=-0.3; awning.position.set(0,2.2,1.7); g.add(awning);
      // panneau de menu + guirlande lumineuse sous l'auvent + tabouret + enseigne boisson
      const menuBoard = mkBox(0.7,0.9,0.05,0x2a2a2a); menuBoard.position.set(-1.0,1.1,1.3); g.add(menuBoard);
      for(let i=0;i<7;i++){
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03,6,6), new THREE.MeshStandardMaterial({ color:0xfff3c8, emissive:0xfff3c8, emissiveIntensity:0.8 }));
        bulb.position.set(-0.8+i*0.27,2.05,1.95); g.add(bulb);
      }
      const stool = mkCyl(0.18,0.18,0.5,0x3a3025,10); stool.position.set(1.1,0.25,1.6); g.add(stool);
      const drinkSign = mkBox(0.5,0.7,0.05,0xf0f0f0); drinkSign.rotation.y=0.3; drinkSign.position.set(1.35,2.1,0.9); g.add(drinkSign);
      const drinkSignGlow = mkBox(0.4,0.25,0.02,0xff6a39); drinkSignGlow.position.set(1.35+Math.sin(0.3)*0.03,2.1,0.9+Math.cos(0.3)*0.03);
      drinkSignGlow.rotation.y=0.3; drinkSignGlow.material.emissive=new THREE.Color(0xff6a39); drinkSignGlow.material.emissiveIntensity=0.9; g.add(drinkSignGlow);
      return g;
    }});
  registerAsset({ id:'struct_gasstation', cat:'structures', family:'Urbain & commercial', label:'Station-service', icon:'⛽', color:0xf0f0f0, size:[10,4.5,6],
    build:(c)=>{
      const canopy = mkBox(10,0.4,6,c,{map:texConcrete(c),repeatX:3,repeatY:2}); canopy.position.y=4.1;
      const g = group(canopy);
      [[-4,-2],[4,-2],[-4,2],[4,2]].forEach(([px,pz])=>{
        const pillar = mkBox(0.4,4.1,0.4,0xd9d9d9); pillar.position.set(px,2.05,pz); g.add(pillar);
      });
      [-1.5,1.5].forEach(px=>{
        const island = mkBox(0.6,0.3,2,0x8f9499); island.position.set(px,0.15,0); g.add(island);
        const pump = mkBox(0.5,1.4,0.4,0x2a5ca0); pump.position.set(px,1,0); g.add(pump);
        const pumpScreen = mkBox(0.3,0.3,0.02,0x4ecdc4); pumpScreen.position.set(px,1.2,0.21);
        pumpScreen.material.emissive=new THREE.Color(0x4ecdc4); pumpScreen.material.emissiveIntensity=0.8;
        g.add(pumpScreen);
      });
      const signPole = mkCyl(0.08,0.08,3.5,0x2a2a2a,6); signPole.position.set(-4.5,1.75,3.5); g.add(signPole);
      const priceSign = mkBox(1.4,1.6,0.15,0xf0f0f0); priceSign.position.set(-4.5,4,3.5); g.add(priceSign);
      // poubelle + station de gonflage + panneau pression pneus + cônes
      const trashBinG = mkCyl(0.25,0.22,0.6,0x2a5a3a,10); trashBinG.position.set(3.8,0.3,2.5); g.add(trashBinG);
      const airPump = mkBox(0.4,1,0.3,0xf0f0f0); airPump.position.set(-3.8,0.5,2.2); g.add(airPump);
      const airPumpHose = mkCyl(0.03,0.03,0.7,0x1c1c1c,6); airPumpHose.rotation.z=Math.PI/2.5; airPumpHose.position.set(-3.5,0.7,2.4); g.add(airPumpHose);
      const psiSign = mkBox(0.3,0.2,0.02,0x2a5ca0); psiSign.position.set(-3.8,1.05,2.36); psiSign.castShadow=false; g.add(psiSign);
      for(let i=0;i<2;i++){
        const coneG = new THREE.Mesh(new THREE.ConeGeometry(0.16,0.45,8), new THREE.MeshStandardMaterial({ color:0xd9a03c }));
        coneG.position.set(4.5,0.22,-2+i*1); g.add(coneG);
      }
      return g;
    }});
  registerAsset({ id:'struct_silo', cat:'structures', family:'Urbain & commercial', label:'Silo', icon:'🌾', color:0xc9c2b0, size:[4,10,4],
    build:(c)=>{
      const body = mkCyl(2,2,8,c,16);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2,1.6,16), new THREE.MeshStandardMaterial({ color:0x8f9499 }));
      cap.position.y = 8.8; cap.castShadow=false;
      const g = group(body, cap);
      for(let i=0;i<3;i++){
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.02,0.05,6,20), new THREE.MeshStandardMaterial({ color:0x8f9499 }));
        ring.rotation.x = Math.PI/2; ring.position.y = 2+i*2.5; g.add(ring);
      }
      const ladder = mkBox(0.4,8,0.06,0x2a2a2a); ladder.position.set(0,4,2.02); g.add(ladder);
      for(const [lx,lz] of [[-1.6,-1.6],[1.6,-1.6],[-1.6,1.6],[1.6,1.6]]){
        const leg = mkBox(0.25,1,0.25,0x5c6470); leg.position.set(lx,0.5,lz); g.add(leg);
      }
      // goulotte de déchargement + coffret de commande + bande d'avertissement au pied
      const chute = mkCyl(0.15,0.25,1.4,0x5c6470,10); chute.rotation.z=0.6; chute.position.set(1.7,0.65,0); g.add(chute);
      const controlPanel = mkBox(0.4,0.5,0.2,0x2a2a2a); controlPanel.position.set(0,0.5,2.05); g.add(controlPanel);
      for(let i=0;i<8;i++){
        const stripe = mkBox(0.35,0.15,0.02, i%2===0?0x1c1c1c:0xf0c020);
        const ang = (i/8)*Math.PI*2;
        stripe.position.set(Math.sin(ang)*2.01, 0.08, Math.cos(ang)*2.01);
        stripe.rotation.y = ang; g.add(stripe);
      }
      return g;
    }});
  registerAsset({ id:'struct_parking', cat:'structures', family:'Urbain & commercial', label:'Parking étagé', icon:'🅿️', color:0xa9b2b8, size:[16,8,12],
    build:(c)=>{
      const g = new THREE.Group();
      const LEVELS = 3, LVL_H = 2.7;
      const colXZ = [[-7.5,-5.5],[7.5,-5.5],[-7.5,5.5],[7.5,5.5],[0,-5.5],[0,5.5]];
      const concreteTex = texConcrete(c);
      const railPaint = texStylizedPanel(0xf0c020, 0x8a6a1a);
      for(let lvl=0;lvl<LEVELS;lvl++){
        const y = lvl*LVL_H;
        const slab = mkBox(16,0.3,12,c,{map:concreteTex,repeatX:5,repeatY:4});
        slab.position.y = y; g.add(slab);
        // Colonnes chanfreinées (mkBevelBox) : lecture nette de la lumière
        // sur les arêtes, plutôt que des pavés plats sans relief.
        for(const [px,pz] of colXZ){
          const col = mkBevelBox(0.42,LVL_H,0.42,0x8f9499,{bevel:0.03,roughness:0.75,metalness:0.12});
          col.position.set(px,y+LVL_H/2,pz); g.add(col);
        }
        // Marquage au sol : lignes de places + flèche de circulation —
        // vendent l'usage "parking" bien mieux qu'une dalle nue.
        for(let i=0;i<5;i++){
          const stripe = mkBox(0.07,0.02,9.5,0xeef0f0); stripe.position.set(-6+i*3,y+0.16,0); stripe.castShadow=false; g.add(stripe);
        }
        const arrow = mkBox(0.45,0.02,1.1,0xf0c020); arrow.position.set(2.6,y+0.17,-4.2); arrow.castShadow=false; g.add(arrow);
        const arrowHead = mkBox(0.9,0.02,0.45,0xf0c020); arrowHead.position.set(2.6,y+0.17,-3.65); arrowHead.castShadow=false; g.add(arrowHead);
        // Réglette lumineuse suspendue au plafond du niveau au-dessus
        // (ou au ciel pour le dernier) — casse la monotonie des dalles vides.
        for(const lx of [-4.5,0,4.5]){
          const fixture = mkBox(0.7,0.06,0.18,0xf0f0f0); fixture.position.set(lx,y+LVL_H-0.22,0); fixture.castShadow=false; g.add(fixture);
          const glow = mkBox(0.55,0.02,0.1,0xfff3c8); glow.position.set(lx,y+LVL_H-0.26,0); glow.castShadow=false;
          glow.material.emissive=new THREE.Color(0xfff3c8); glow.material.emissiveIntensity=0.9; g.add(glow);
        }
      }
      // Rampes reliant réellement chaque niveau au suivant (comme un vrai
      // silo à rampes en zig-zag), au lieu d'une seule dalle inclinée
      // flottant sans toucher ni le sol ni l'étage — l'angle et la longueur
      // sont calculés à partir de la hauteur d'étage pour que le haut et le
      // bas de chaque rampe affleurent exactement les dalles qu'elle relie.
      const rampRun = 5.4, rampWidth = 3.2;
      const rampAngle = Math.atan2(LVL_H, rampRun);
      const rampLen = Math.hypot(LVL_H, rampRun);
      for(let lvl=0; lvl<LEVELS-1; lvl++){
        const side = lvl%2===0 ? 1 : -1; // alterne le côté à chaque étage : montée en zig-zag
        const yMid = lvl*LVL_H + LVL_H/2;
        const ramp = mkBevelBox(rampWidth,0.22,rampLen,0x9aa0a6,{bevel:0.025,map:concreteTex,repeatX:1,repeatY:2,roughness:0.8});
        ramp.rotation.x = -rampAngle;
        ramp.position.set(6.3*side, yMid, 0);
        g.add(ramp);
        // chevrons peints indiquant le sens de montée
        for(let i=-1;i<=1;i+=2){
          const chevron = mkBox(0.9,0.02,0.14,0xf0f0f0);
          chevron.position.set(6.3*side, yMid + i*0.55, i*1.15);
          chevron.rotation.x = -rampAngle; chevron.castShadow=false; g.add(chevron);
        }
        // Garde-corps métalliques de part et d'autre de la pente, alignés
        // sur son inclinaison — élément qui manquait totalement avant et
        // qui vend la cohérence structurelle de la rampe.
        for(const zSide of [-1,1]){
          const rail = mkBevelBox(0.08,0.55,rampLen,0xf0c020,{bevel:0.01,map:railPaint,roughness:0.5,metalness:0.3});
          rail.rotation.x = -rampAngle;
          rail.position.set(6.3*side + zSide*rampWidth/2, yMid+0.32, 0);
          g.add(rail);
        }
      }
      for(let i=0;i<4;i++){
        const rail = mkBox(16,0.6,0.06,0xf0c020); rail.position.set(0,i*2.7,6); g.add(rail);
      }
      const pLetter = mkBox(1,1,0.05,0x2a5ca0); pLetter.position.set(0,1.5,6.03); pLetter.material.emissive=new THREE.Color(0x2a5ca0); pLetter.material.emissiveIntensity=0.6; g.add(pLetter);
      // caméra de sécurité à l'entrée + dos d'âne + panneaux de niveau
      const camP = mkBox(0.15,0.15,0.3,0x1c1c1c); camP.position.set(6,2.5,5.9); camP.rotation.x=0.3; g.add(camP);
      const speedBump = mkBox(3,0.08,0.3,0xf0c020); speedBump.position.set(0,0.04,0.5); g.add(speedBump);
      for(let lvl=0;lvl<3;lvl++){
        const levelSign = mkBox(0.7,0.5,0.03,0x1c2128); levelSign.position.set(-7.5,lvl*2.7+2,6.03); g.add(levelSign);
      }
      return g;
    }});
  registerAsset({ id:'struct_guardpost', cat:'structures', family:'Urbain & commercial', label:'Poste de garde', icon:'💂', color:0xe8e2d0, size:[2,2.6,2],
    build:(c)=>{
      const g = group(mkBox(2,2.3,2,c));
      const roof = mkBox(2.3,0.2,2.3,0x5c6470); roof.position.y=2.4; g.add(roof);
      for(let i=0;i<3;i++){
        const win = mkBox(0.5,0.8,0.03,0x9dd8e0,{opacity:0.5}); win.position.set(-0.7+i*0.7,1.4,1.02); win.castShadow=false; g.add(win);
      }
      const barrierPole = mkCyl(0.08,0.08,0.6,0x2a2a2a,6); barrierPole.position.set(1.3,0.3,1.3); g.add(barrierPole);
      const barrierArm = mkBox(3,0.1,0.15, 0xf0c020); barrierArm.position.set(2.8,0.6,1.3); g.add(barrierArm);
      for(let i=0;i<4;i++){
        const stripe = mkBox(0.4,0.1,0.16, i%2===0?0x1c1c1c:0xf0c020); stripe.position.set(1.4+i*0.7,0.6,1.3); g.add(stripe);
      }
      // sacs de sable empilés + projecteur de toit + mât à drapeau
      for(let i=0;i<3;i++){
        const sandbag = new THREE.Mesh(new THREE.SphereGeometry(0.22,8,6), new THREE.MeshStandardMaterial({ color:0x9a8a6a, roughness:1 }));
        sandbag.scale.set(1.3,0.7,1);
        sandbag.position.set(-1.15,0.2+Math.floor(i/2)*0.35,-0.7+ (i%2)*0.5); g.add(sandbag);
      }
      const spotlightG = mkBox(0.3,0.2,0.2,0x2a2a2a); spotlightG.position.set(-0.8,2.55,0.8); g.add(spotlightG);
      const flagPoleG = mkCyl(0.03,0.03,2.2,0x8f9499,6); flagPoleG.position.set(0.9,1.1,-0.9); g.add(flagPoleG);
      const flagG = mkBox(0.5,0.35,0.02,0x4ecdc4); flagG.position.set(1.15,1.9,-0.9); g.add(flagG);
      return g;
    }});
  registerAsset({ id:'struct_watertower', cat:'structures', family:'Urbain & commercial', label:"Château d'eau", icon:'🗼', color:0x6b5a45, size:[5,12,5],
    build:(c)=>{
      const g = new THREE.Group();
      for(const [lx,lz] of [[-1.3,-1.3],[1.3,-1.3],[-1.3,1.3],[1.3,1.3]]){
        const leg = mkBox(0.35,9,0.35,0x4a3a26); leg.position.set(lx,4.5,lz); leg.rotation.z=Math.atan2(lx,9)*0.5; g.add(leg);
      }
      for(let i=0;i<3;i++){
        const brace = mkBox(3,0.1,0.1,0x4a3a26); brace.position.set(0,2+i*2.5,1.3); g.add(brace);
        const brace2 = mkBox(0.1,0.1,3,0x4a3a26); brace2.position.set(1.3,2+i*2.5,0); g.add(brace2);
      }
      const tank = mkCyl(2.2,2.2,3.4,c,14); tank.position.y=10.7; g.add(tank);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3,1,14), new THREE.MeshStandardMaterial({ color:0x4a3a26 }));
      roof.position.y=13; roof.castShadow=false; g.add(roof);
      const ladder2 = mkBox(0.3,9,0.05,0x2a2a2a); ladder2.position.set(1.3,4.5,1.3); g.add(ladder2);
      // arceaux de sécurité autour de l'échelle + plateforme au sommet + conduite verticale
      for(let i=0;i<5;i++){
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.35,0.02,6,12,Math.PI), new THREE.MeshStandardMaterial({ color:0x2a2a2a }));
        hoop.rotation.y = Math.PI/2; hoop.position.set(1.3,1.5+i*1.7,1.3); g.add(hoop);
      }
      const topPlatform = mkCyl(2.5,2.5,0.06,0x4a4a44,14); topPlatform.position.y=9.05; g.add(topPlatform);
      const platRail = new THREE.Mesh(new THREE.TorusGeometry(2.5,0.03,6,20), new THREE.MeshStandardMaterial({ color:0x2a2a2a }));
      platRail.rotation.x=Math.PI/2; platRail.position.y=9.4; g.add(platRail);
      const standpipe = mkCyl(0.12,0.12,7,0x4a4a44,8); standpipe.position.set(0,3.5,2.1); g.add(standpipe);
      return g;
    }});
  registerAsset({ id:'struct_greenhouse', cat:'structures', family:'Urbain & commercial', label:'Serre', icon:'🌿', color:0xd6dde0, size:[8,4,10],
    build:(c)=>{
      const walls = mkBox(8,2.6,10,c,{opacity:0.4,roughness:0.1,metalness:0.15});
      const g = group(walls);
      for(let i=1;i<8;i++){
        const frameV = mkBox(0.06,2.6,10.02,0x3a4a52); frameV.position.set(-4+i,1.3,0); frameV.castShadow=false; g.add(frameV);
      }
      const roofL = mkBox(4.2,0.06,10.2,0xc9d2d6,{opacity:0.4}); roofL.rotation.z=0.5; roofL.position.set(-2,3.8,0); roofL.castShadow=false; g.add(roofL);
      const roofR = mkBox(4.2,0.06,10.2,0xc9d2d6,{opacity:0.4}); roofR.rotation.z=-0.5; roofR.position.set(2,3.8,0); roofR.castShadow=false; g.add(roofR);
      const ridge2 = mkBox(0.15,0.15,10.2,0x3a4a52); ridge2.position.y=4.65; g.add(ridge2);
      for(let i=0;i<4;i++){
        const plantBed = mkBox(1.2,0.5,8,0x4f7a3a); plantBed.position.set(-3+i*2,0.25,0); plantBed.castShadow=false; g.add(plantBed);
      }
      // tuyaux d'irrigation le long des bacs + pots à l'entrée + trappe d'aération au toit
      for(let i=0;i<4;i++){
        const irrigPipe = mkCyl(0.02,0.02,7.8,0x2a5a3a,6); irrigPipe.rotation.x=Math.PI/2;
        irrigPipe.position.set(-3+i*2,0.52,0); g.add(irrigPipe);
      }
      for(const px of [-3.2,3.2]){
        const pot = mkCyl(0.25,0.2,0.35,0x8a6a3f,10); pot.position.set(px,0.18,4.7); g.add(pot);
        const plantTop = new THREE.Mesh(new THREE.SphereGeometry(0.22,7,6), new THREE.MeshStandardMaterial({ color:0x4f7a3a })); plantTop.position.set(px,0.5,4.7); g.add(plantTop);
      }
      const roofVentG = mkBox(1,0.15,0.6,0xc9d2d6,{opacity:0.4}); roofVentG.rotation.z=0.4; roofVentG.position.set(0,4.55,3.5); roofVentG.castShadow=false; g.add(roofVentG);
      return g;
    }});
  registerAsset({ id:'struct_mall', cat:'structures', family:'Urbain & commercial', label:'Centre commercial', icon:'🏬', color:0xd9d2bc, size:[20,6,14],
    build:(c)=>{
      const g = group(mkBox(20,6,14,c,{map:texStuc(c),repeatX:6,repeatY:2}));
      const entranceGlass = mkBox(8,4,0.1,0x8fc4d6,{opacity:0.5,roughness:0.05}); entranceGlass.position.set(0,2,7.05); entranceGlass.castShadow=false; g.add(entranceGlass);
      const entranceCanopy = mkBox(9,0.2,2.5,0x33373d); entranceCanopy.position.set(0,4.2,8); g.add(entranceCanopy);
      const mallSign = mkBox(5,1,0.2,0x1c2128); mallSign.position.set(0,5.3,7.2); g.add(mallSign);
      const mallSignGlow = mkBox(4.6,0.7,0.02,0xff6a39); mallSignGlow.position.set(0,5.3,7.31);
      mallSignGlow.material.emissive=new THREE.Color(0xff6a39); mallSignGlow.material.emissiveIntensity=1; g.add(mallSignGlow);
      for(let i=0;i<8;i++){
        const stripe = mkBox(0.15,0.02,3,0xf0f0f0); stripe.position.set(-9+i*2.4,0.02,10); stripe.castShadow=false; g.add(stripe);
      }
      // borne ATM extérieure + poubelles jumelles + jardinières d'entrée
      const atm = mkBox(0.5,1.4,0.4,0x2a2a2a); atm.position.set(-6,0.7,7.2); g.add(atm);
      const atmScreen = mkBox(0.3,0.25,0.02,0x4ecdc4); atmScreen.position.set(-6,1.1,7.41);
      atmScreen.material.emissive=new THREE.Color(0x4ecdc4); atmScreen.material.emissiveIntensity=0.7; g.add(atmScreen);
      for(const px of [-3.5,3.5]){
        const binM = mkCyl(0.25,0.22,0.6,0x3a3f45,10); binM.position.set(px,0.3,7.5); g.add(binM);
      }
      for(const px of [-6.5,6.5]){
        const planterM = mkBox(2.2,0.5,0.5,0x6b5330); planterM.position.set(px,0.25,7.3); g.add(planterM);
      }
      return g;
    }});
  registerAsset({ id:'struct_factory', cat:'structures', family:'Urbain & commercial', label:'Usine', icon:'🏗️', color:0x6a6a62, size:[12,9,10],
    build:(c)=>{
      const g = group(mkBox(12,9,10,c,{map:texConcrete(c),repeatX:4,repeatY:3}));
      const stack = mkCyl(0.8,1,7,0x4a4a44,12); stack.position.set(-4,9,-3); g.add(stack);
      const stackTop = mkCyl(0.9,0.8,0.6,0x2a2a24,12); stackTop.position.set(-4,12.8,-3); g.add(stackTop);
      addWindowGrid(g, 6, 2, 12, 9, 10.05, 'z', 0xd9a03c);
      const pipeF = mkCyl(0.15,0.15,6,0x5c6470,8); pipeF.rotation.z=Math.PI/2; pipeF.position.set(2,7,5.05); g.add(pipeF);
      // réseau de tuyaux verticaux + cuve de stockage + bande d'avertissement au pied de la cheminée
      for(let i=0;i<3;i++){
        const vpipe = mkCyl(0.1,0.1,7,0x5c6470,8); vpipe.position.set(-5.5+i*0.4,3.5,5.05); g.add(vpipe);
      }
      const tankF = mkCyl(1.1,1.1,3,0x8f9499,14); tankF.rotation.z=Math.PI/2; tankF.position.set(5.2,2,-3.5); g.add(tankF);
      for(let i=0;i<3;i++){
        const tankRing = new THREE.Mesh(new THREE.TorusGeometry(1.12,0.03,6,16), new THREE.MeshStandardMaterial({ color:0x4a4a44 }));
        tankRing.rotation.y=Math.PI/2; tankRing.position.set(4.3+i*0.9,2,-3.5); g.add(tankRing);
      }
      for(let i=0;i<6;i++){
        const stackStripe = mkBox(0.42, 0.18, 0.42, i%2===0?0x1c1c1c:0xf0c020);
        const ang=(i/6)*Math.PI*2;
        stackStripe.position.set(-4+Math.sin(ang)*0.5, 0.2, -3+Math.cos(ang)*0.5);
        g.add(stackStripe);
      }
      return g;
    }});
  registerAsset({ id:'struct_busshelter', cat:'structures', family:'Urbain & commercial', label:'Abri bus', icon:'🚏', color:0xb9b2a0, size:[3,2.6,1.5],
    build:(c)=>{
      const g = new THREE.Group();
      const roofBus = mkBox(3,0.1,1.5,0x5c6470); roofBus.position.y=2.5; g.add(roofBus);
      const backGlass = mkBox(3,2,0.06,0x9dd8e0,{opacity:0.4}); backGlass.position.set(0,1.2,-0.7); backGlass.castShadow=false; g.add(backGlass);
      const sideGlass = mkBox(0.06,2,1.4,0x9dd8e0,{opacity:0.4}); sideGlass.position.set(-1.45,1.2,0); sideGlass.castShadow=false; g.add(sideGlass);
      for(const px of [-1.45,1.45]){
        const post = mkBox(0.1,2.5,0.1,0x3a3a3a); post.position.set(px,1.25,-0.65); g.add(post);
      }
      const bench = mkBox(2.6,0.4,0.4,0x5c6470); bench.position.set(0,0.4,0.4); g.add(bench);
      const routeSign = mkBox(0.4,0.6,0.05,0x2a5ca0); routeSign.position.set(1.6,2,0); g.add(routeSign);
      // poubelle + panneau d'horaires + applique lumineuse sous l'auvent
      const trashBinBus = mkCyl(0.18,0.16,0.5,0x3a3f45,10); trashBinBus.position.set(-1.6,0.25,0.5); g.add(trashBinBus);
      const timetable = mkBox(0.5,0.6,0.03,0xf0f0f0); timetable.position.set(-1.42,1.5,-0.4); timetable.rotation.y=Math.PI/2; g.add(timetable);
      const shelterLamp = new THREE.Mesh(new THREE.SphereGeometry(0.06,8,8), new THREE.MeshStandardMaterial({ color:0xfff3c8, emissive:0xfff3c8, emissiveIntensity:0.9 }));
      shelterLamp.position.set(0,2.42,0); g.add(shelterLamp);
      return g;
    }});
  // Structure métallique stylisée AAA (garde-corps/portique) : rupture de
  // section poteau carré chanfreiné / barre cylindrique, manchons de
  // jonction, embases élargies boulonnées, peinture mate + accent métal
  // exposé aux collerettes — voir l'analyse "structure métallique avec
  // barre horizontale" du brief.
  registerAsset({ id:'struct_railing_metal', cat:'structures', family:'Urbain & commercial', label:'Garde-corps métallique (AAA)', icon:'🚧', color:0x2e3a4a, size:[2.4,1.1,0.15],
    build:(c)=>{
      const g = new THREE.Group();
      const paintTex = texStylizedPanel(c, 0x9aa0a6);
      const postH = 1.05, postW = 0.09, barY = postH*0.92;
      const postXs = [-1.1, 1.1];
      postXs.forEach(px=>{
        const post = mkBevelBox(postW, postH, postW, c, {bevel:0.015, roughness:0.55, metalness:0.4, map:paintTex});
        post.position.x = px; g.add(post);
        // embase élargie boulonnée au sol (platine de fixation)
        const plate = mkBevelBox(0.24,0.035,0.24,0x4a4e55,{bevel:0.006, roughness:0.5, metalness:0.45});
        plate.position.x = px; g.add(plate);
        [[-0.09,-0.09],[0.09,-0.09],[-0.09,0.09],[0.09,0.09]].forEach(([bx,bz])=>{
          const bolt = mkCyl(0.014,0.014,0.035,0x2a2e33,6);
          bolt.rotation.x = Math.PI/2; bolt.position.set(px+bx,0.02,bz); g.add(bolt);
        });
        // manchon de jonction poteau/barre (casse la monotonie du tube, lecture FPS)
        const collar = mkCyl(0.065,0.065,0.09,0x9aa0a6,10);
        collar.rotation.x = Math.PI/2; collar.position.set(px,barY,0); g.add(collar);
      });
      // barre horizontale — diamètre légèrement exagéré pour rester lisible
      // à distance (règle stylisée : +15-25% par rapport au réalisme brut)
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045,0.045,2.3,12),
        new THREE.MeshStandardMaterial({ color:c, roughness:0.5, metalness:0.45, map:paintTex.clone() })
      );
      bar.material.map.wrapS = bar.material.map.wrapT = THREE.RepeatWrapping;
      bar.material.map.repeat.set(3,1);
      bar.rotation.z = Math.PI/2; bar.position.y = barY;
      bar.castShadow = true; bar.receiveShadow = true;
      g.add(bar);
      // cordons de soudure suggérés aux jonctions (détail tertiaire, coût quasi nul)
      postXs.forEach(px=>{
        const weld = mkCyl(0.07,0.07,0.02,0x9aa0a6,10);
        weld.rotation.x = Math.PI/2; weld.position.set(px,barY,0); g.add(weld);
      });
      return g;
    }});

  // ---- NATURE — décor environnemental (rochers, végétation, petits
  // détails) construits avec les mêmes primitives procédurales que le
  // reste de l'éditeur, pas d'assets externes. Le feuillage (buisson,
  // fougère, fleurs) reçoit un léger balancement au vent via addSway().
  // ---- Rochers : 3 variantes de taille/forme via une géométrie
  // dodécaèdre légèrement écrasée pour un aspect naturel non lisse.
  function buildRock(baseSize, colorHex){
    const g = new THREE.Group();
    const geo = new THREE.DodecahedronGeometry(baseSize, 0);
    const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color:colorHex, roughness:0.95, flatShading:true }));
    rock.scale.set(1, 0.7+Math.random()*0.15, 0.85+Math.random()*0.2);
    rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    rock.position.y = baseSize*0.55;
    rock.castShadow = true; rock.receiveShadow = true;
    g.add(rock);
    // petit rocher compagnon, casse la silhouette trop parfaite d'un seul bloc
    const rock2 = new THREE.Mesh(new THREE.DodecahedronGeometry(baseSize*0.45,0), rock.material);
    rock2.position.set(baseSize*0.6, baseSize*0.3, baseSize*0.3);
    rock2.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,0);
    rock2.castShadow = true;
    g.add(rock2);
    return g;
  }
  registerAsset({ id:'nat_rock_s', cat:'nature', family:'Roches & minéraux', label:'Rocher (petit)', icon:'🪨', color:0x8a897e, size:[0.9,0.6,0.9],
    build:(c)=> buildRock(0.5, c) });
  registerAsset({ id:'nat_rock_m', cat:'nature', family:'Roches & minéraux', label:'Rocher (moyen)', icon:'🪨', color:0x82806f, size:[1.5,1.0,1.5],
    build:(c)=> buildRock(0.85, c) });
  registerAsset({ id:'nat_rock_l', cat:'nature', family:'Roches & minéraux', label:'Rocher (grand)', icon:'🪨', color:0x76746a, size:[2.4,1.6,2.2],
    build:(c)=>{
      const g = buildRock(1.4, c);
      const moss = new THREE.Mesh(new THREE.SphereGeometry(0.5,8,6,0,Math.PI*2,0,Math.PI*0.4), new THREE.MeshStandardMaterial({ color:0x5c7a3e, roughness:1 }));
      moss.position.set(0.3,1.9,0.2); moss.scale.set(1.3,0.4,1.1); moss.castShadow=false;
      g.add(moss);
      return g;
    }});
  registerAsset({ id:'nat_bush', cat:'nature', family:'Végétation basse', label:'Buisson dense', icon:'🌳', color:0x4f7a3a, size:[1.2,1,1.2],
    build:(c)=>{
      const g = new THREE.Group();
      for(let i=0;i<4;i++){
        const lobe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35+Math.random()*0.12,0), new THREE.MeshStandardMaterial({ color:new THREE.Color(c).multiplyScalar(0.85+Math.random()*0.3).getHex(), roughness:1, flatShading:true }));
        lobe.position.set((Math.random()-0.5)*0.5, 0.35+Math.random()*0.2, (Math.random()-0.5)*0.5);
        lobe.castShadow = true;
        g.add(lobe);
      }
      addSway(g, 0.035, 1.1);
      return g;
    }});
  registerAsset({ id:'nat_fern', cat:'nature', family:'Végétation basse', label:'Fougère haute', icon:'🌿', color:0x3f6b32, size:[0.7,0.5,0.7],
    build:(c)=>{
      const g = new THREE.Group();
      for(let i=0;i<6;i++){
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.09,0.5,4), new THREE.MeshStandardMaterial({ color:c, roughness:1 }));
        const ang = (i/6)*Math.PI*2;
        frond.position.set(Math.sin(ang)*0.1, 0.25, Math.cos(ang)*0.1);
        frond.rotation.z = Math.sin(ang)*0.5; frond.rotation.x = Math.cos(ang)*0.5+0.3;
        frond.castShadow = false;
        g.add(frond);
      }
      addSway(g, 0.05, 1.6);
      return g;
    }});
  registerAsset({ id:'nat_flowers', cat:'nature', family:'Végétation basse', label:'Parterre de fleurs', icon:'🌸', color:0x4f7a3a, size:[1,0.3,1],
    build:(c)=>{
      const g = new THREE.Group();
      const base = mkCyl(0.45,0.5,0.05,c,10); base.position.y=0.02; base.castShadow=false; g.add(base);
      const petalColors = [0xe85d75, 0xf0c020, 0xffffff, 0xb15de0];
      for(let i=0;i<10;i++){
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01,0.01,0.18,4), new THREE.MeshStandardMaterial({ color:0x3f6b32 }));
        const ang = Math.random()*Math.PI*2, dist = Math.random()*0.35;
        stem.position.set(Math.sin(ang)*dist, 0.11, Math.cos(ang)*dist);
        stem.castShadow=false;
        g.add(stem);
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.045,6,5), new THREE.MeshStandardMaterial({ color: petalColors[i%petalColors.length] }));
        bloom.position.set(stem.position.x, 0.2, stem.position.z);
        bloom.castShadow=false;
        g.add(bloom);
      }
      addSway(g, 0.04, 2.0);
      return g;
    }});
  registerAsset({ id:'nat_mushroom', cat:'nature', family:'Champignons & bois mort', label:'Champignons', icon:'🍄', color:0xc0472b, size:[0.4,0.3,0.4],
    build:(c)=>{
      const g = new THREE.Group();
      for(let i=0;i<3;i++){
        const s = 0.6+Math.random()*0.5;
        const stem = mkCyl(0.025*s,0.03*s,0.12*s,0xe8dcc0,6); stem.position.set((i-1)*0.1,0.06*s,(i%2)*0.06); stem.castShadow=false;
        g.add(stem);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06*s,8,6,0,Math.PI*2,0,Math.PI*0.55), new THREE.MeshStandardMaterial({ color:c, roughness:0.8 }));
        cap.position.set(stem.position.x, 0.12*s, stem.position.z); cap.castShadow=true;
        g.add(cap);
        for(let d=0;d<4;d++){
          const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008*s,5), new THREE.MeshStandardMaterial({ color:0xf0f0f0 }));
          dot.position.set(cap.position.x+(Math.random()-0.5)*0.07*s, cap.position.y+0.045*s, cap.position.z+(Math.random()-0.5)*0.07*s);
          dot.rotation.x = -Math.PI/2.3; dot.castShadow=false;
          g.add(dot);
        }
      }
      return g;
    }});
  registerAsset({ id:'nat_deadtree', cat:'nature', family:'Champignons & bois mort', label:'Arbre mort noueux', icon:'🌲', color:0x5c4a3a, size:[1.2,4,1.2],
    build:(c)=>{
      const g = new THREE.Group();
      const trunk = mkCyl(0.16,0.24,3.2,c,8); trunk.position.y=1.6; trunk.rotation.z=0.06; trunk.castShadow=true;
      g.add(trunk);
      const branchColors = c;
      for(let i=0;i<5;i++){
        const len = 0.7+Math.random()*0.6;
        const branch = mkCyl(0.03,0.06,len,branchColors,6);
        const h = 1.6+Math.random()*1.4, ang = Math.random()*Math.PI*2, tilt = 0.6+Math.random()*0.7;
        branch.position.set(Math.sin(ang)*0.15, h, Math.cos(ang)*0.15);
        branch.rotation.z = tilt*(Math.random()<0.5?1:-1);
        branch.rotation.y = ang;
        branch.castShadow = true;
        g.add(branch);
      }
      return g;
    }});
  registerAsset({ id:'nat_log', cat:'nature', family:'Champignons & bois mort', label:'Tronc au sol', icon:'🪵', color:0x6b5330, size:[2.2,0.5,0.6],
    build:(c)=>{
      const g = new THREE.Group();
      const log = mkCyl(0.28,0.28,2.2,c,10); log.rotation.z=Math.PI/2; log.position.y=0.28; log.castShadow=true; log.receiveShadow=true;
      g.add(log);
      const endCap = mkCyl(0.27,0.27,0.03,0xe8dcc0,10); endCap.rotation.z=Math.PI/2; endCap.position.set(1.1,0.28,0); endCap.castShadow=false;
      g.add(endCap);
      // anneaux de croissance (cercles concentriques sur la coupe)
      for(let i=0;i<3;i++){
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.06*i+0.03,0.06*i+0.05,16), new THREE.MeshStandardMaterial({ color:0xb08a5a, side:THREE.DoubleSide }));
        ring.rotation.y=Math.PI/2; ring.position.set(1.115,0.28,0); ring.castShadow=false;
        g.add(ring);
      }
      for(let i=0;i<3;i++){
        const moss = new THREE.Mesh(new THREE.SphereGeometry(0.12,7,5,0,Math.PI*2,0,Math.PI*0.4), new THREE.MeshStandardMaterial({ color:0x5c7a3e, roughness:1 }));
        moss.position.set(-0.7+i*0.6, 0.5, 0); moss.scale.set(1.4,0.4,1.1); moss.castShadow=false;
        g.add(moss);
      }
      return g;
    }});


  // ============================================================
  // NATURE ÉTENDUE — arbres, végétation basse, minéraux, eau, terrain
  // Fonctions utilitaires partagées pour garder ~57 assets lisibles sans
  // dupliquer la construction géométrie/matériau à chaque fois.
  // ============================================================
  function buildTreeAsset(trunkColor, trunkH, trunkR, canopyType, canopyColor, canopyR){
    const g = new THREE.Group();
    if(canopyType!=='bamboo' && canopyType!=='baobab'){
      const trunk = mkCyl(trunkR*0.68, trunkR, trunkH, trunkColor, 7);
      trunk.castShadow=true; trunk.receiveShadow=true; g.add(trunk);
      // Évasement des racines au pied — un tronc parfaitement cylindrique
      // du sol jusqu'en haut est le signal "primitive procédurale" le plus
      // net, avant même la forme de la frondaison.
      const flare = mkCyl(trunkR, trunkR*1.55, trunkH*0.1, trunkColor, 7);
      flare.castShadow=false; g.add(flare);
    }
    const canopyMat = new THREE.MeshStandardMaterial({ color:canopyColor, roughness:0.9, flatShading:true });
    if(canopyType==='cone'){
      // 4 étages dégressifs plutôt que 2 gros cônes empilés — un vrai
      // conifère a plusieurs couronnes de branches qui se chevauchent,
      // pas juste deux formes géométriques distinctes.
      const tiers = 4;
      let cy = trunkH + canopyR*0.35;
      for(let i=0;i<tiers;i++){
        const t = i/(tiers-1);
        const rTier = canopyR*(1.05-t*0.55)*(0.92+Math.random()*0.16);
        const hTier = canopyR*(1.05-t*0.3);
        const tierMat = new THREE.MeshStandardMaterial({ color:hueJitter(new THREE.Color(canopyColor),0.015,0.08,0.1), roughness:0.9, flatShading:true });
        const tier = new THREE.Mesh(new THREE.ConeGeometry(rTier, hTier, 8), tierMat);
        tier.position.set((Math.random()-0.5)*0.06,cy+hTier*0.4,(Math.random()-0.5)*0.06);
        tier.rotation.y = Math.random()*Math.PI; tier.castShadow=true; g.add(tier);
        cy += hTier*0.62;
      }
    } else if(canopyType==='round'){
      // Un seul blob sphérique identique pour chêne/bouleau/cerisier/érable
      // (4 essences différentes rendues avec exactement la même silhouette
      // "sucette") — cassé en 1 masse principale + 2-3 touffes secondaires
      // décalées, chacune avec sa propre teinte (hueJitter), pour une
      // silhouette de frondaison bien moins parfaitement sphérique.
      const cy = trunkH + canopyR*0.75;
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(canopyR,1), canopyMat);
      top.position.y = cy; top.scale.y = 0.85; top.castShadow=true; g.add(top);
      const lobeCount = 2+Math.floor(Math.random()*2);
      for(let i=0;i<lobeCount;i++){
        const lobeR = canopyR*(0.4+Math.random()*0.2);
        const lobeMat = new THREE.MeshStandardMaterial({ color:hueJitter(new THREE.Color(canopyColor),0.02,0.1,0.12), roughness:0.9, flatShading:true });
        const lobe = new THREE.Mesh(new THREE.IcosahedronGeometry(lobeR,1), lobeMat);
        const ang = (i/lobeCount)*Math.PI*2 + Math.random()*0.6;
        lobe.position.set(Math.sin(ang)*canopyR*0.65, cy+(Math.random()-0.5)*canopyR*0.5, Math.cos(ang)*canopyR*0.65);
        lobe.castShadow=true; g.add(lobe);
      }
    } else if(canopyType==='palm'){
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.22,6,5), canopyMat);
      crown.position.y = trunkH; g.add(crown);
      for(let i=0;i<7;i++){
        // Palme en 2 segments (tige droite + pointe qui retombe) plutôt
        // qu'une seule planche rigide — les palmes réelles s'affaissent
        // sous leur propre poids, une boîte bien droite ne le suggère pas.
        const frondGroup = new THREE.Group();
        const base = mkBox(0.2,0.035,canopyR*1.3,canopyColor);
        base.position.z = canopyR*0.65; frondGroup.add(base);
        const tip = mkBox(0.16,0.03,canopyR*0.9,canopyColor);
        tip.position.z = canopyR*1.3; tip.rotation.x = -0.35; frondGroup.add(tip);
        frondGroup.position.set(0,trunkH+0.05,0);
        frondGroup.rotation.y = i/7*Math.PI*2 + (Math.random()-0.5)*0.15;
        frondGroup.rotation.z = -0.45+(Math.random()-0.5)*0.1;
        g.add(frondGroup);
      }
      for(let i=0;i<3;i++){
        const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.09,7,6), new THREE.MeshStandardMaterial({color:0x4a3420,roughness:0.9}));
        const ang = Math.random()*Math.PI*2;
        coconut.position.set(Math.sin(ang)*0.18,trunkH-0.1,Math.cos(ang)*0.18); coconut.castShadow=false; g.add(coconut);
      }
    } else if(canopyType==='weeping'){
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(canopyR,1), canopyMat);
      top.position.y = trunkH + canopyR*0.5; top.scale.set(1.35,0.65,1.35); top.castShadow=true; g.add(top);
      const lobeCount2 = 2+Math.floor(Math.random()*2);
      for(let i=0;i<lobeCount2;i++){
        const lobeR = canopyR*(0.35+Math.random()*0.2);
        const lobeMat = new THREE.MeshStandardMaterial({ color:hueJitter(new THREE.Color(canopyColor),0.02,0.1,0.12), roughness:0.9, flatShading:true });
        const lobe = new THREE.Mesh(new THREE.IcosahedronGeometry(lobeR,1), lobeMat);
        const ang = (i/lobeCount2)*Math.PI*2 + Math.random()*0.6;
        lobe.position.set(Math.sin(ang)*canopyR*0.7, trunkH+canopyR*0.5+(Math.random()-0.5)*canopyR*0.4, Math.cos(ang)*canopyR*0.7);
        lobe.castShadow=true; g.add(lobe);
      }
      for(let i=0;i<16;i++){
        const strand = mkCyl(0.02,0.025, 1.0+Math.random()*0.9, canopyColor, 4);
        const ang = Math.random()*Math.PI*2, dist = canopyR*Math.random()*0.85;
        strand.position.set(Math.cos(ang)*dist, trunkH+canopyR*0.35+(Math.random()-0.5)*0.3, Math.sin(ang)*dist);
        strand.rotation.set((Math.random()-0.5)*0.15,0,(Math.random()-0.5)*0.15);
        strand.castShadow=false; g.add(strand);
      }
    } else if(canopyType==='baobab'){
      // Tronc propre au baobab, bien plus massif que le tronc générique
      // partagé — le tronc démesurément épais EST le trait qui définit
      // un baobab, un simple cylindre fin comme les autres essences ne
      // pouvait pas se lire comme tel.
      const trunkBaobab = mkCyl(trunkR*2.6, trunkR*3.4, trunkH*0.72, trunkColor, 9);
      trunkBaobab.castShadow=true; trunkBaobab.receiveShadow=true; g.add(trunkBaobab);
      const neckBaobab = mkCyl(trunkR*1.1, trunkR*2.4, trunkH*0.28, trunkColor, 8);
      neckBaobab.position.y = trunkH*0.72; neckBaobab.castShadow=true; g.add(neckBaobab);
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(canopyR,0), canopyMat);
      top.position.y = trunkH + canopyR*0.55; top.castShadow=true; g.add(top);
      for(let i=0;i<3;i++){
        const branch = mkCyl(0.12,0.18,canopyR*0.9,trunkColor,5);
        branch.position.y = trunkH; branch.rotation.z = 0.9+i*0.1; branch.rotation.y = i*2.1;
        g.add(branch);
      }
    } else if(canopyType==='bamboo'){
      // Cannes bien plus épaisses qu'avant (0.06-0.08 → filiforme et
      // méconnaissable à l'échelle d'un arbre) + noeuds annelés (le trait
      // le plus reconnaissable du bambou, absent jusqu'ici) + léger
      // dévers organique par canne + feuillage en petites touffes
      // angulaires plutôt qu'un seul cône plein.
      const nodeMat = new THREE.MeshStandardMaterial({ color:trunkColor, roughness:0.55, metalness:0.05 });
      for(let i=0;i<6;i++){
        const h = trunkH*(0.85+Math.random()*0.3);
        const lean = (Math.random()-0.5)*0.1;
        const stalk = mkCyl(0.07,0.09,h,trunkColor,8);
        stalk.position.x = (Math.random()-0.5)*0.7; stalk.position.z = (Math.random()-0.5)*0.7; // garde le y=h/2 posé par mkCyl (sinon la canne se retrouve à moitié enterrée)
        stalk.rotation.z = lean; stalk.rotation.x = (Math.random()-0.5)*0.1;
        stalk.castShadow=true; g.add(stalk);
        const nodeCount = 4+Math.floor(Math.random()*2);
        for(let n=1;n<nodeCount;n++){
          const node = new THREE.Mesh(new THREE.TorusGeometry(0.085,0.012,5,10), nodeMat);
          node.rotation.x = Math.PI/2;
          node.position.set(stalk.position.x + Math.sin(lean)*h*(n/nodeCount), (n/nodeCount)*h, stalk.position.z);
          node.castShadow=false;
          g.add(node);
        }
        for(let leaf=0;leaf<3;leaf++){
          const blade = new THREE.Mesh(new THREE.ConeGeometry(0.09,0.5,4), canopyMat);
          const leafAng = Math.random()*Math.PI*2;
          blade.position.set(stalk.position.x+Math.sin(lean)*h, h*(0.78+leaf*0.07), stalk.position.z);
          blade.rotation.z = Math.PI/2.3 * (leaf%2===0?1:-1) + (Math.random()-0.5)*0.3;
          blade.rotation.y = leafAng;
          blade.castShadow=false;
          g.add(blade);
        }
      }
    }
    // Léger dévers organique sur l'arbre ENTIER (groupe, pas juste le
    // tronc — sinon la frondaison, positionnée en coordonnées absolues,
    // se détache visuellement d'un tronc penché) : aucun arbre naturel
    // n'est parfaitement vertical, contrairement à tous les avant.
    g.rotation.z = (Math.random()-0.5)*0.07; g.rotation.x = (Math.random()-0.5)*0.07;
    return g;
  }
  function buildRockAsset(color, radius, jaggedness, count){
    const g = new THREE.Group();
    for(let i=0;i<(count||1);i++){
      const r = radius*(i===0?1:0.4+Math.random()*0.4);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r,0), new THREE.MeshStandardMaterial({ color, roughness:0.95, flatShading:true }));
      rock.position.set(i===0?0:(Math.random()-0.5)*radius*1.6, r*0.6, i===0?0:(Math.random()-0.5)*radius*1.6);
      rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      rock.scale.set(1, 0.75+Math.random()*0.3, 1);
      rock.castShadow=true; rock.receiveShadow=true;
      g.add(rock);
    }
    // Mousse/lichen au pied + galets épars — un seul gros dodécaèdre isolé
    // (le cas count=1, ex. nat_rock2) rendait un "caillou flottant" trop
    // net ; ça l'ancre visuellement dans le sol comme une vraie roche.
    const moss = new THREE.Mesh(new THREE.CircleGeometry(radius*0.7,10), new THREE.MeshStandardMaterial({ color:0x5c7a3e, roughness:1, transparent:true, opacity:0.5 }));
    moss.rotation.x=-Math.PI/2; moss.position.set(radius*0.25,0.015,radius*0.15); moss.castShadow=false; g.add(moss);
    for(let i=0;i<3;i++){
      const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(radius*(0.08+Math.random()*0.08),0), new THREE.MeshStandardMaterial({ color, roughness:0.95, flatShading:true }));
      const ang = Math.random()*Math.PI*2, dist = radius*(0.8+Math.random()*0.5);
      pebble.position.set(Math.sin(ang)*dist, radius*0.07, Math.cos(ang)*dist);
      pebble.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);
      pebble.castShadow=false;
      g.add(pebble);
    }
    return g;
  }
  function buildCrystalAsset(color, height){
    const g = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color, roughness:0.15, metalness:0, transmission:0.55, thickness:0.6, transparent:true, opacity:0.92, emissive:color, emissiveIntensity:0.12 });
    for(let i=0;i<4;i++){
      const h = height*(0.5+Math.random()*0.6);
      const shard = new THREE.Mesh(new THREE.ConeGeometry(height*0.16,h,5), mat);
      shard.position.set((Math.random()-0.5)*height*0.5, h/2, (Math.random()-0.5)*height*0.5);
      shard.rotation.set((Math.random()-0.5)*0.3,Math.random()*Math.PI,(Math.random()-0.5)*0.3);
      shard.castShadow=true;
      g.add(shard);
    }
    return g;
  }
  function buildWaterPatch(color, w, d, opts){
    opts = opts||{};
    const mat = new THREE.MeshStandardMaterial({ color, roughness:0.12, metalness:0.05, transparent:true, opacity:opts.opacity||0.82 });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1,20), mat);
    mesh.scale.set(w/2,d/2,1); mesh.rotation.x=-Math.PI/2; mesh.position.y=0.05;
    return group(mesh);
  }
  function buildGroundPatch(color, w, d, h, opts){
    opts = opts||{};
    const patch = mkBox(w, h||0.15, d, color, opts.texOpts||{});
    return group(patch);
  }

  // -- Arbres (10) --
  registerAsset({ id:'nat_oak', cat:'nature', family:'Arbres', label:'Chêne', icon:'🌳', color:0x5c4a30, size:[3,5,3],
    build:()=> buildTreeAsset(0x5c4a30, 3.2, 0.32, 'round', 0x4a7a3a, 1.7) });
  registerAsset({ id:'nat_fir', cat:'nature', family:'Arbres', label:'Sapin', icon:'🌲', color:0x2f5c34, size:[2.2,6,2.2],
    build:()=> buildTreeAsset(0x4a3a2a, 3.6, 0.24, 'cone', 0x2f5c34, 1.1) });
  registerAsset({ id:'nat_pine', cat:'nature', family:'Arbres', label:'Pin', icon:'🌲', color:0x3a6b3f, size:[2,5.5,2],
    build:()=> buildTreeAsset(0x5c4530, 3.4, 0.2, 'cone', 0x3a6b3f, 0.9) });
  registerAsset({ id:'nat_birch', cat:'nature', family:'Arbres', label:'Bouleau', icon:'🌳', color:0xe8e2d0, size:[2.4,5,2.4],
    build:()=> buildTreeAsset(0xe8e2d0, 3.4, 0.2, 'round', 0x8fc060, 1.3) });
  registerAsset({ id:'nat_palm', cat:'nature', family:'Arbres', label:'Palmier', icon:'🌴', color:0x8a6a3f, size:[1.6,5.5,1.6],
    build:()=> buildTreeAsset(0x8a6a3f, 4, 0.22, 'palm', 0x2f7a3a, 1.4) });
  registerAsset({ id:'nat_baobab', cat:'nature', family:'Arbres', label:'Baobab', icon:'🌳', color:0x9a8060, size:[2.6,4.5,2.6],
    build:()=> buildTreeAsset(0x9a8060, 2.6, 0.75, 'baobab', 0x7a8a3a, 1.5) });
  registerAsset({ id:'nat_cherry', cat:'nature', family:'Arbres', label:'Cerisier', icon:'🌸', color:0xf0a8c0, size:[2.4,4,2.4],
    build:()=> buildTreeAsset(0x5c4a3a, 2.6, 0.22, 'round', 0xf0a8c0, 1.5) });
  registerAsset({ id:'nat_maple', cat:'nature', family:'Arbres', label:'Érable', icon:'🍁', color:0xc0562f, size:[2.6,4.5,2.6],
    build:()=> buildTreeAsset(0x5c4a3a, 2.8, 0.26, 'round', 0xc0562f, 1.6) });
  registerAsset({ id:'nat_willow', cat:'nature', family:'Arbres', label:'Saule', icon:'🌳', color:0x8fae5a, size:[2.8,4.2,2.8],
    build:()=> buildTreeAsset(0x5c4a3a, 2.2, 0.28, 'weeping', 0x8fae5a, 1.8) });
  registerAsset({ id:'nat_bamboo', cat:'nature', family:'Arbres', label:'Bambou', icon:'🎋', color:0x6a9a48, size:[1,4,1],
    build:()=> buildTreeAsset(0x6a9a48, 3.4, 0.08, 'bamboo', 0x8fc060, 0.3) });

  // -- Végétation basse (7) --
  registerAsset({ id:'nat_bush2', cat:'nature', family:'Végétation basse', label:'Buisson clairsemé', icon:'🌿', color:0x4f7a3a, size:[1.2,1,1.2],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<3;i++){ const lobe=new THREE.Mesh(new THREE.IcosahedronGeometry(0.4+Math.random()*0.15,0), new THREE.MeshStandardMaterial({color:c,roughness:1,flatShading:true})); lobe.position.set((Math.random()-0.5)*0.5,0.35+Math.random()*0.15,(Math.random()-0.5)*0.5); lobe.castShadow=true; g.add(lobe);} return g; }});
  registerAsset({ id:'nat_flowerbush', cat:'nature', family:'Végétation basse', label:'Arbuste fleuri', icon:'🌺', color:0x4f7a3a, size:[1.2,1,1.2],
    build:()=>{ const g=new THREE.Group(); const base=new THREE.Mesh(new THREE.IcosahedronGeometry(0.45,0), new THREE.MeshStandardMaterial({color:0x4f7a3a,roughness:1,flatShading:true})); base.position.y=0.4; g.add(base);
      const petalColors=[0xe85d75,0xf0c020,0xffffff]; for(let i=0;i<6;i++){ const petal=new THREE.Mesh(new THREE.IcosahedronGeometry(0.09,0), new THREE.MeshStandardMaterial({color:petalColors[i%3]})); const ang=Math.random()*Math.PI*2, dist=0.3+Math.random()*0.2; petal.position.set(Math.cos(ang)*dist,0.4+Math.random()*0.3,Math.sin(ang)*dist); g.add(petal);} return g; }});
  registerAsset({ id:'nat_tallgrass', cat:'nature', family:'Végétation basse', label:'Herbe haute', icon:'🌾', color:0x6a9a48, size:[0.8,0.9,0.8],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<7;i++){ const bh=0.55+Math.random()*0.35; const blade=mkCyl(0.02,0.05,bh,c,4); const ang=Math.random()*Math.PI*2, dist=Math.random()*0.25; blade.position.set(Math.cos(ang)*dist,bh/2,Math.sin(ang)*dist); blade.rotation.z=(Math.random()-0.5)*0.4; g.add(blade);} return g; }});
  registerAsset({ id:'nat_fern2', cat:'nature', family:'Végétation basse', label:'Fougère basse', icon:'🌿', color:0x3f6b32, size:[0.7,0.5,0.7],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<6;i++){ const frond=mkBox(0.08,0.02,0.5,c); frond.position.y=0.15; frond.rotation.y=i/6*Math.PI*2; frond.rotation.x=-0.5; g.add(frond);} return g; }});
  registerAsset({ id:'nat_flower_red', cat:'nature', family:'Végétation basse', label:'Fleur rouge', icon:'🌹', color:0xd8384a, size:[0.3,0.35,0.3],
    build:()=>{ const g=new THREE.Group(); const stem=mkCyl(0.02,0.025,0.3,0x3f6b32); g.add(stem); const bloom=new THREE.Mesh(new THREE.IcosahedronGeometry(0.09,0), new THREE.MeshStandardMaterial({color:0xd8384a})); bloom.position.y=0.32; g.add(bloom); return g; }});
  registerAsset({ id:'nat_flower_blue', cat:'nature', family:'Végétation basse', label:'Fleur bleue', icon:'💠', color:0x3f6fd8, size:[0.3,0.35,0.3],
    build:()=>{ const g=new THREE.Group(); const stem=mkCyl(0.02,0.025,0.3,0x3f6b32); g.add(stem); const bloom=new THREE.Mesh(new THREE.IcosahedronGeometry(0.09,0), new THREE.MeshStandardMaterial({color:0x3f6fd8})); bloom.position.y=0.32; g.add(bloom); return g; }});
  registerAsset({ id:'nat_flower_yellow', cat:'nature', family:'Végétation basse', label:'Fleur jaune', icon:'🌼', color:0xf0c020, size:[0.3,0.35,0.3],
    build:()=>{ const g=new THREE.Group(); const stem=mkCyl(0.02,0.025,0.3,0x3f6b32); g.add(stem); const bloom=new THREE.Mesh(new THREE.IcosahedronGeometry(0.09,0), new THREE.MeshStandardMaterial({color:0xf0c020})); bloom.position.y=0.32; g.add(bloom); return g; }});

  // -- Champignons, bois mort, lianes (6) --
  registerAsset({ id:'nat_mushroom2', cat:'nature', family:'Champignons & bois mort', label:'Champignon', icon:'🍄', color:0xc0472b, size:[0.3,0.25,0.3],
    build:()=>{ const g=new THREE.Group(); const stalk=mkCyl(0.04,0.05,0.18,0xe8ddc0); g.add(stalk); const cap=new THREE.Mesh(new THREE.SphereGeometry(0.11,8,6,0,Math.PI*2,0,Math.PI*0.55), new THREE.MeshStandardMaterial({color:0xc0472b})); cap.position.y=0.18; g.add(cap); return g; }});
  registerAsset({ id:'nat_mushroom_giant', cat:'nature', family:'Champignons & bois mort', label:'Champignon géant', icon:'🍄', color:0xa8382a, size:[1.2,1.4,1.2],
    build:()=>{ const g=new THREE.Group(); const stalk=mkCyl(0.22,0.28,1,0xe8ddc0); g.add(stalk); const cap=new THREE.Mesh(new THREE.SphereGeometry(0.65,10,7,0,Math.PI*2,0,Math.PI*0.55), new THREE.MeshStandardMaterial({color:0xa8382a})); cap.position.y=1; cap.castShadow=true; g.add(cap);
      for(let i=0;i<5;i++){ const spot=new THREE.Mesh(new THREE.CircleGeometry(0.07,8), new THREE.MeshStandardMaterial({color:0xf0e8d8})); const ang=Math.random()*Math.PI*2, r=Math.random()*0.4; spot.position.set(Math.cos(ang)*r,1.35,Math.sin(ang)*r); spot.rotation.x=-Math.PI/2; g.add(spot);} return g; }});
  registerAsset({ id:'nat_stump', cat:'nature', family:'Champignons & bois mort', label:'Souche', icon:'🪵', color:0x6b5330, size:[0.7,0.5,0.7],
    build:(c)=>{ const g=group(mkCyl(0.32,0.36,0.45,c,10)); const ring=new THREE.Mesh(new THREE.CircleGeometry(0.3,16), new THREE.MeshStandardMaterial({color:0xb08a5a})); ring.rotation.x=-Math.PI/2; ring.position.y=0.451; g.add(ring); return g; }});
  registerAsset({ id:'nat_log2', cat:'nature', family:'Champignons & bois mort', label:'Tronc tombé', icon:'🪵', color:0x6b5330, size:[2.4,0.5,0.6],
    build:(c)=>{ const g=group(); const log=mkCyl(0.26,0.3,2.4,c,10); log.rotation.z=Math.PI/2; log.position.y=0.28; log.castShadow=true; log.receiveShadow=true; g.add(log);
      const endCap=mkCyl(0.25,0.25,0.03,0xe8dcc0,10); endCap.rotation.z=Math.PI/2; endCap.position.set(1.2,0.28,0); endCap.castShadow=false; g.add(endCap);
      const moss=mkBox(0.7,0.14,0.35,0x4f6a3a,{opacity:0.4}); moss.position.set(-0.3,0.42,0); moss.rotation.x=0.3; moss.castShadow=false; g.add(moss);
      for(let i=0;i<3;i++){ const stem=mkCyl(0.015*0.8,0.02*0.8,0.09*0.8,0xe8dcc0,6); stem.rotation.z=Math.PI/2; stem.position.set(-0.6+i*0.35,0.44+0.045*0.8,0.08); stem.castShadow=false; g.add(stem);
        const cap=new THREE.Mesh(new THREE.SphereGeometry(0.045*0.8,7,5,0,Math.PI*2,0,Math.PI*0.55), new THREE.MeshStandardMaterial({color:0xc0472b,roughness:0.8})); cap.rotation.z=-Math.PI/2; cap.position.set(stem.position.x+0.06*0.8,stem.position.y,stem.position.z); cap.castShadow=true; g.add(cap); }
      return g; }});
  registerAsset({ id:'nat_liana', cat:'nature', family:'Champignons & bois mort', label:'Liane', icon:'🌿', color:0x3f6b32, size:[0.2,3,0.2],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<3;i++){ const seg=mkCyl(0.02,0.025,1,c,4); seg.position.set((Math.random()-0.5)*0.2,i*0.95+0.5,(Math.random()-0.5)*0.2); seg.rotation.z=(Math.random()-0.5)*0.2; g.add(seg);} return g; }});
  registerAsset({ id:'nat_vine', cat:'nature', family:'Champignons & bois mort', label:'Vigne', icon:'🍇', color:0x4a7a3a, size:[0.3,2,0.3],
    build:(c)=>{ const g=new THREE.Group(); const stem=mkCyl(0.03,0.04,2,c); g.add(stem); for(let i=0;i<4;i++){ const grape=new THREE.Mesh(new THREE.IcosahedronGeometry(0.07,0), new THREE.MeshStandardMaterial({color:0x5c3a6b})); grape.position.set((Math.random()-0.5)*0.2, 0.3+i*0.4, (Math.random()-0.5)*0.2); g.add(grape);} return g; }});

  // -- Cactus (2) --
  registerAsset({ id:'nat_cactus', cat:'nature', family:'Cactus', label:'Cactus', icon:'🌵', color:0x3f7a4a, size:[0.6,1.2,0.6],
    build:(c)=>{ const g=new THREE.Group(); const body=mkCyl(0.18,0.22,1.1,c,8); g.add(body); const arm1=mkCyl(0.09,0.1,0.5,c,6); arm1.position.set(0.2,0.6,0); arm1.rotation.z=-0.9; g.add(arm1);
      const spineMat = new THREE.MeshStandardMaterial({color:0xe8dcc0,roughness:0.6});
      for(let i=0;i<14;i++){ const spine=new THREE.Mesh(new THREE.ConeGeometry(0.012,0.06,4), spineMat);
        const ang=Math.random()*Math.PI*2, hy=0.15+Math.random()*0.8;
        spine.position.set(Math.sin(ang)*0.19,hy,Math.cos(ang)*0.19); spine.rotation.z=Math.PI/2; spine.rotation.y=-ang; spine.castShadow=false; g.add(spine); }
      for(let i=0;i<2;i++){ const flower=new THREE.Mesh(new THREE.IcosahedronGeometry(0.05,0), new THREE.MeshStandardMaterial({color:0xe85d75}));
        flower.position.set(Math.sin(i*3)*0.2,1.05+i*0.03,Math.cos(i*3)*0.2); flower.castShadow=false; g.add(flower); }
      return g; }});
  registerAsset({ id:'nat_cactus_giant', cat:'nature', family:'Cactus', label:'Cactus géant', icon:'🌵', color:0x2f6b3a, size:[1.4,3,1.4],
    build:(c)=>{ const g=new THREE.Group(); const body=mkCyl(0.4,0.5,2.8,c,10); g.add(body); const arm1=mkCyl(0.2,0.24,1.1,c,8); arm1.position.set(0.45,1.4,0); arm1.rotation.z=-0.9; g.add(arm1);
      const arm2=mkCyl(0.18,0.22,0.9,c,8); arm2.position.set(-0.4,1.9,0); arm2.rotation.z=1; g.add(arm2); return g; }});

  // -- Roches & minéraux (7) --
  registerAsset({ id:'nat_rock2', cat:'nature', family:'Roches & minéraux', label:'Roche', icon:'🪨', color:0x847f70, size:[0.8,0.6,0.8],
    build:(c)=> buildRockAsset(c, 0.45, 0.5, 1) });
  registerAsset({ id:'nat_bigrock', cat:'nature', family:'Roches & minéraux', label:'Grand rocher', icon:'🪨', color:0x7a756a, size:[2.2,1.8,2.2],
    build:(c)=> buildRockAsset(c, 1.1, 0.6, 3) });
  registerAsset({ id:'nat_cliff', cat:'nature', family:'Roches & minéraux', label:'Falaise', icon:'⛰️', color:0x6f6a5f, size:[4,5,3],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<5;i++){ const block=new THREE.Mesh(new THREE.BoxGeometry(1+Math.random(),2+Math.random()*3,1.4+Math.random()), new THREE.MeshStandardMaterial({color:c,roughness:0.97,flatShading:true})); block.position.set(i*0.8-1.6, block.geometry.parameters.height/2, (Math.random()-0.5)*0.6); block.rotation.y=(Math.random()-0.5)*0.3; block.castShadow=true; g.add(block);} return g; }});
  registerAsset({ id:'nat_spire', cat:'nature', family:'Roches & minéraux', label:'Pic rocheux', icon:'🗻', color:0x8a8578, size:[1.5,6,1.5],
    build:(c)=>{ const g=new THREE.Group(); let curY=0, curR=0.9; for(let i=0;i<4;i++){ const h=1.4+Math.random()*1; const seg=new THREE.Mesh(new THREE.DodecahedronGeometry(curR,0), new THREE.MeshStandardMaterial({color:c,roughness:0.95,flatShading:true})); seg.scale.set(1,h/curR,1); seg.position.set((Math.random()-0.5)*0.3,curY+h*0.5,(Math.random()-0.5)*0.3); seg.rotation.y=Math.random()*Math.PI; seg.castShadow=true; g.add(seg); curY+=h*0.75; curR*=0.65;} return g; }});
  registerAsset({ id:'nat_crystal_blue', cat:'nature', family:'Roches & minéraux', label:'Cristal bleu', icon:'🔷', color:0x4a9ad8, size:[0.8,1.4,0.8],
    build:()=> buildCrystalAsset(0x4a9ad8, 1.4) });
  registerAsset({ id:'nat_crystal_red', cat:'nature', family:'Roches & minéraux', label:'Cristal rouge', icon:'🔺', color:0xd84a5a, size:[0.8,1.4,0.8],
    build:()=> buildCrystalAsset(0xd84a5a, 1.4) });
  registerAsset({ id:'nat_crystal_green', cat:'nature', family:'Roches & minéraux', label:'Cristal vert', icon:'🔻', color:0x4ad86a, size:[0.8,1.4,0.8],
    build:()=> buildCrystalAsset(0x4ad86a, 1.4) });

  // -- Points d'eau (8) --
  registerAsset({ id:'nat_geyser', cat:'nature', family:"Points d'eau", label:'Geyser', icon:'💦', color:0xcfe8f0, size:[1,3,1],
    build:()=>{ const g=new THREE.Group(); const base=mkCyl(0.6,0.75,0.3,0x7a756a,10); g.add(base);
      const jet=new THREE.Mesh(new THREE.ConeGeometry(0.18,2.6,8), new THREE.MeshStandardMaterial({color:0xdff2f7,transparent:true,opacity:0.55,roughness:0.2}));
      jet.position.y=1.6; jet.rotation.x=Math.PI; g.add(jet); return g; }});
  registerAsset({ id:'nat_waterfall', cat:'nature', family:"Points d'eau", label:'Cascade', icon:'🌊', color:0x2f6f8f, size:[2,4,0.6],
    build:()=>{ const g=new THREE.Group(); const sheet=mkBox(1.8,3.6,0.15,0x2f6f8f,{opacity:0.72}); sheet.position.y=1.8; g.add(sheet);
      const pool=buildWaterPatch(0x2f6f8f,2.6,1.6); pool.position.y=-0; g.add(pool); return g; }});
  registerAsset({ id:'nat_river', cat:'nature', family:"Points d'eau", label:'Rivière', icon:'🏞️', color:0x2f6f8f, size:[6,0.2,2.4],
    build:()=>{ const g=new THREE.Group(); const strip=mkBox(6,0.1,2.2,0x2f6f8f,{opacity:0.78}); strip.position.y=0.06; g.add(strip); return g; }});
  registerAsset({ id:'nat_lake', cat:'nature', family:"Points d'eau", label:'Lac', icon:'🏞️', color:0x2f6f8f, size:[8,0.2,6],
    build:()=> buildWaterPatch(0x2f6f8f, 8, 6) });
  registerAsset({ id:'nat_pond', cat:'nature', family:"Points d'eau", label:'Étang', icon:'🟦', color:0x3a7a8a, size:[3,0.2,2.4],
    build:()=> buildWaterPatch(0x3a7a8a, 3, 2.4) });
  registerAsset({ id:'nat_lily', cat:'nature', family:"Points d'eau", label:'Nénuphar', icon:'🪷', color:0x4a8a4a, size:[0.5,0.1,0.5],
    build:()=>{ const g=new THREE.Group(); const pad=new THREE.Mesh(new THREE.CircleGeometry(0.24,12), new THREE.MeshStandardMaterial({color:0x4a8a4a})); pad.rotation.x=-Math.PI/2; pad.position.y=0.04; g.add(pad);
      const bloom=new THREE.Mesh(new THREE.IcosahedronGeometry(0.07,0), new THREE.MeshStandardMaterial({color:0xf0a8c0})); bloom.position.set(0.05,0.08,0.05); g.add(bloom); return g; }});
  registerAsset({ id:'nat_reed', cat:'nature', family:"Points d'eau", label:'Roseau', icon:'🌾', color:0x8a9a4a, size:[0.4,1.4,0.4],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<5;i++){ const bh=1+Math.random()*0.4; const blade=mkCyl(0.02,0.03,bh,c,4); const ang=Math.random()*Math.PI*2,dist=Math.random()*0.15; blade.position.set(Math.cos(ang)*dist,bh/2,Math.sin(ang)*dist); blade.rotation.z=(Math.random()-0.5)*0.25; g.add(blade);} return g; }});
  registerAsset({ id:'nat_swamp', cat:'nature', family:"Points d'eau", label:'Marécage', icon:'🟫', color:0x4a5a3a, size:[3,0.2,3],
    build:()=>{ const g=new THREE.Group(); const mud=mkBox(3,0.12,3,0x4a5a3a); g.add(mud); const water=buildWaterPatch(0x3a4a3a,2,2,{opacity:0.6}); water.position.y=0.08; g.add(water); return g; }});

  // -- Terrain praticable (4) + volcanisme (2) --
  registerAsset({ id:'nat_sand', cat:'nature', family:'Terrain & volcanisme', label:'Sable', icon:'🟨', color:0xd9c48a, size:[3,0.15,3],
    build:(c)=> buildGroundPatch(c,3,3,0.12) });
  registerAsset({ id:'nat_dune2', cat:'nature', family:'Terrain & volcanisme', label:'Dune', icon:'🏜️', color:0xd9a35c, size:[3,1.2,3],
    build:(c)=>{ const g=new THREE.Group(); const mound=new THREE.Mesh(new THREE.SphereGeometry(1.6,14,8,0,Math.PI*2,0,Math.PI/2), new THREE.MeshStandardMaterial({color:c,roughness:1})); mound.position.y=0; mound.scale.set(1,0.5,0.8); g.add(mound); return g; }});
  registerAsset({ id:'nat_icefloe', cat:'nature', family:'Terrain & volcanisme', label:'Banquise', icon:'🧊', color:0xd8ecf2, size:[3,0.3,3],
    build:(c)=> buildGroundPatch(c,3,3,0.25) });
  registerAsset({ id:'nat_iceblock', cat:'nature', family:'Terrain & volcanisme', label:'Bloc de glace', icon:'🧊', color:0xcfe8f0, size:[1,1.2,1],
    build:(c)=> group(mkBox(1,1.2,1,c,{opacity:0.75})) });
  registerAsset({ id:'nat_volcano', cat:'nature', family:'Terrain & volcanisme', label:'Volcan', icon:'🌋', color:0x4a3a34, size:[5,4,5],
    build:()=>{ const g=new THREE.Group(); const cone=new THREE.Mesh(new THREE.ConeGeometry(2.5,4,10), new THREE.MeshStandardMaterial({color:0x4a3a34,roughness:0.95,flatShading:true})); cone.position.y=2; cone.castShadow=true; g.add(cone);
      const lava=new THREE.Mesh(new THREE.CircleGeometry(0.7,12), new THREE.MeshStandardMaterial({color:0xff5a1e,emissive:0xff3a0a,emissiveIntensity:0.9})); lava.rotation.x=-Math.PI/2; lava.position.y=3.98; g.add(lava); return g; }});
  registerAsset({ id:'nat_crater', cat:'nature', family:'Terrain & volcanisme', label:'Cratère', icon:'🕳️', color:0x4a3a34, size:[3,0.6,3],
    build:(c)=>{ const g=new THREE.Group(); const rim=new THREE.Mesh(new THREE.TorusGeometry(1.3,0.3,8,16), new THREE.MeshStandardMaterial({color:c,roughness:0.95,flatShading:true})); rim.rotation.x=Math.PI/2; rim.position.y=0.2; g.add(rim);
      const floor=new THREE.Mesh(new THREE.CircleGeometry(1.1,16), new THREE.MeshStandardMaterial({color:0x2a1e1a})); floor.rotation.x=-Math.PI/2; floor.position.y=-0.15; g.add(floor); return g; }});

  // -- Divers (11) --
  registerAsset({ id:'nat_drybush', cat:'nature', family:'Divers', label:'Buisson sec', icon:'🥀', color:0x8a7a4a, size:[1,0.8,1],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<4;i++){ const twig=mkCyl(0.02,0.03,0.4+Math.random()*0.2,c,4); const ang=Math.random()*Math.PI*2; twig.position.set(0,0.2,0); twig.rotation.z=Math.PI/2-0.6+Math.random()*0.4; twig.rotation.y=ang; g.add(twig);} return g; }});
  registerAsset({ id:'nat_coral', cat:'nature', family:'Divers', label:'Corail', icon:'🪸', color:0xe86a7a, size:[0.7,0.7,0.7],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<5;i++){ const branch=mkCyl(0.03,0.06,0.35+Math.random()*0.25,c,5); branch.position.set((Math.random()-0.5)*0.3,0.17,(Math.random()-0.5)*0.3); branch.rotation.z=(Math.random()-0.5)*0.6; g.add(branch);} return g; }});
  registerAsset({ id:'nat_algae', cat:'nature', family:'Divers', label:'Algues', icon:'🌿', color:0x2f7a5a, size:[0.5,0.6,0.5],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<4;i++){ const blade=mkBox(0.06,0.5,0.02,c); blade.position.set((Math.random()-0.5)*0.3,0.25,(Math.random()-0.5)*0.3); blade.rotation.z=(Math.random()-0.5)*0.5; g.add(blade);} return g; }});
  registerAsset({ id:'nat_mangrove', cat:'nature', family:'Divers', label:'Mangrove', icon:'🌳', color:0x3f5a3a, size:[2,3,2],
    build:()=>{ const g=buildTreeAsset(0x3f5a3a,2,0.22,'round',0x4a7a4a,1.2);
      for(let i=0;i<4;i++){ const root=mkCyl(0.05,0.09,1,0x3f5a3a,5); const ang=i/4*Math.PI*2; root.position.set(Math.cos(ang)*0.3,0.5,Math.sin(ang)*0.3); root.rotation.z=0.3*Math.cos(ang); root.rotation.x=0.3*Math.sin(ang); g.add(root);} return g; }});
  registerAsset({ id:'nat_leafpile', cat:'nature', family:'Divers', label:'Tas de feuilles', icon:'🍂', color:0xb87a3a, size:[0.9,0.3,0.9],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<5;i++){ const leaf=new THREE.Mesh(new THREE.IcosahedronGeometry(0.16+Math.random()*0.1,0), new THREE.MeshStandardMaterial({color:c,roughness:1,flatShading:true})); leaf.position.set((Math.random()-0.5)*0.5,0.1,(Math.random()-0.5)*0.5); leaf.scale.y=0.4; g.add(leaf);} return g; }});
  registerAsset({ id:'nat_snowpile', cat:'nature', family:'Divers', label:'Tas de neige', icon:'❄️', color:0xf2f6f8, size:[0.9,0.4,0.9],
    build:(c)=>{ const g=new THREE.Group(); const mound=new THREE.Mesh(new THREE.SphereGeometry(0.45,10,6,0,Math.PI*2,0,Math.PI/2), new THREE.MeshStandardMaterial({color:c,roughness:0.85})); mound.scale.set(1,0.55,1); g.add(mound);
      const sparkMat = new THREE.MeshStandardMaterial({color:0xdff2f7,emissive:0xdff2f7,emissiveIntensity:0.4,roughness:0.1,metalness:0.1});
      for(let i=0;i<5;i++){ const spark=new THREE.Mesh(new THREE.OctahedronGeometry(0.025+Math.random()*0.02,0), sparkMat);
        const ang=Math.random()*Math.PI*2, dist=Math.random()*0.35;
        spark.position.set(Math.sin(ang)*dist,0.18+Math.random()*0.1,Math.cos(ang)*dist); spark.castShadow=false; g.add(spark); }
      return g; }});
  registerAsset({ id:'nat_glacier', cat:'nature', family:'Divers', label:'Glacier', icon:'🧊', color:0xcfe8f2, size:[4,2.5,3],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<4;i++){ const shard=new THREE.Mesh(new THREE.ConeGeometry(0.8+Math.random()*0.4,1.6+Math.random()*1.2,6), new THREE.MeshPhysicalMaterial({color:c,roughness:0.1,transmission:0.4,thickness:0.8,transparent:true,opacity:0.9})); shard.position.set(i*1-1.5,shard.geometry.parameters.height/2,(Math.random()-0.5)*0.5); shard.rotation.z=(Math.random()-0.5)*0.2; shard.castShadow=true; g.add(shard);} return g; }});
  registerAsset({ id:'nat_deadtree2', cat:'nature', family:'Divers', label:'Arbre mort décharné', icon:'🌲', color:0x5c4a3a, size:[1.2,4,1.2],
    build:(c)=>{ const g=new THREE.Group(); const trunk=mkCyl(0.12,0.22,3.2,c,7); g.add(trunk);
      for(let i=0;i<4;i++){ const branch=mkCyl(0.03,0.07,0.9+Math.random()*0.5,c,5); branch.position.y=1.6+i*0.5; branch.rotation.z=0.9+Math.random()*0.4; branch.rotation.y=i*1.6; g.add(branch);} return g; }});
  registerAsset({ id:'nat_bramble', cat:'nature', family:'Divers', label:'Ronce', icon:'🌿', color:0x4a5a2a, size:[0.9,0.6,0.9],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<6;i++){ const vine=mkCyl(0.02,0.03,0.5+Math.random()*0.3,c,4); const ang=Math.random()*Math.PI*2; vine.position.set(0,0.2,0); vine.rotation.z=Math.PI/2-0.4+Math.random()*0.5; vine.rotation.y=ang; g.add(vine);
      const thorn=new THREE.Mesh(new THREE.ConeGeometry(0.03,0.08,4), new THREE.MeshStandardMaterial({color:0x2a2a1a})); thorn.position.copy(vine.position); g.add(thorn);} return g; }});
  registerAsset({ id:'nat_prairie2', cat:'nature', family:'Divers', label:'Prairie fleurie', icon:'🌸', color:0x6a9a48, size:[3,0.5,3],
    build:()=>{ const g=new THREE.Group(); const base=mkBox(3,0.1,3,0x5f9a48); g.add(base);
      const petal=[0xe85d75,0xf0c020,0xffffff,0xb15de0]; for(let i=0;i<14;i++){ const stem=mkCyl(0.015,0.02,0.25,0x4a7a3a); const x=(Math.random()-0.5)*2.6, z=(Math.random()-0.5)*2.6; stem.position.set(x,0.05,z); g.add(stem);
        const bloom=new THREE.Mesh(new THREE.IcosahedronGeometry(0.06,0), new THREE.MeshStandardMaterial({color:petal[i%4]})); bloom.position.set(x,0.28,z); g.add(bloom);} return g; }});
  registerAsset({ id:'nat_sunflower', cat:'nature', family:'Divers', label:'Tournesol', icon:'🌻', color:0xf0c020, size:[0.5,1.4,0.5],
    build:()=>{ const g=new THREE.Group(); const stem=mkCyl(0.04,0.05,1.2,0x4a7a3a); g.add(stem);
      const center=new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.06,12), new THREE.MeshStandardMaterial({color:0x5c4530})); center.rotation.x=Math.PI/2; center.position.y=1.24; g.add(center);
      for(let i=0;i<10;i++){ const petal=mkBox(0.1,0.03,0.16,0xf0c020); const ang=i/10*Math.PI*2; petal.position.set(Math.cos(ang)*0.2,1.24,Math.sin(ang)*0.2); petal.rotation.y=ang; g.add(petal);} return g; }});


  // ============================================================
  // BÂTIMENTS THÉMATIQUES — 49 structures, construites à partir de
  // quelques familles de formes partagées pour rester lisible.
  // ============================================================
  function buildSimpleHouse(wallColor, roofColor, w,d,h, roofStyle){
    const g = new THREE.Group();
    const walls = mkBox(w,h,d,wallColor,{roughness:0.9}); g.add(walls);
    if(roofStyle==='pitched'){
      const span=w*0.6, depth=d*0.85;
      const rA=mkBox(span,0.14,depth,roofColor); rA.position.set(-w*0.24,h+span*0.42,0); rA.rotation.z=0.55; g.add(rA);
      const rB=mkBox(span,0.14,depth,roofColor); rB.position.set(w*0.24,h+span*0.42,0); rB.rotation.z=-0.55; g.add(rB);
      const chimney=mkBox(w*0.13,h*0.5,w*0.13,0x5c5850); chimney.position.set(w*0.26,h+span*0.42*1.35,d*0.18); g.add(chimney);
    } else if(roofStyle==='flat'){
      const roof=mkBox(w*1.05,0.2,d*1.05,roofColor); roof.position.y=h+0.1; g.add(roof);
    } else if(roofStyle==='dome'){
      const dome=new THREE.Mesh(new THREE.SphereGeometry(w*0.55,14,10,0,Math.PI*2,0,Math.PI/2), new THREE.MeshStandardMaterial({color:roofColor,roughness:0.4,metalness:0.2}));
      dome.position.y=h; g.add(dome);
    } else if(roofStyle==='cone'){
      const roof=new THREE.Mesh(new THREE.ConeGeometry(w*0.75,h*0.6,10), new THREE.MeshStandardMaterial({color:roofColor,roughness:0.7}));
      roof.position.y=h+h*0.3; g.add(roof);
      const chimney=mkBox(w*0.11,h*0.45,w*0.11,0x5c5850); chimney.position.set(w*0.2,h+h*0.4,0); g.add(chimney);
    }
    const door=mkBox(0.8,1.5,0.08,0x2e1f14); door.position.set(0,0.75,d/2+0.02); g.add(door);
    // Fenêtres (grandes maisons seulement, pour ne pas les tasser sur une
    // cabane/hutte étroite) + marche devant la porte — avant ça, une
    // "maison" n'était que 3 boîtes (murs/toit/porte), rien qui suggère
    // un intérieur habité.
    if(w>=3.3 && h>=2.4){
      [-w*0.28,w*0.28].forEach(wx=>{
        const frame = mkBox(0.6,0.6,0.06,0x2e1f14); frame.position.set(wx,h*0.55,d/2+0.02); g.add(frame);
        const glass = mkBox(0.46,0.46,0.02,0x9dd8e0,{opacity:0.6,roughness:0.1}); glass.position.set(wx,h*0.55,d/2+0.05); g.add(glass);
      });
    }
    const step = mkBox(Math.min(1.1,w*0.3),0.1,0.3,0x8a8578); step.position.set(0,0.05,d/2+0.2); g.add(step);
    return g;
  }
  function buildTower(baseColor, w, h, capType){
    const g=new THREE.Group();
    const shaft=mkCyl(w*0.42,w*0.5,h,baseColor,10); g.add(shaft);
    if(capType==='cone'){ const cap=new THREE.Mesh(new THREE.ConeGeometry(w*0.55,h*0.35,10), new THREE.MeshStandardMaterial({color:0x4a3a2a})); cap.position.y=h+h*0.17; g.add(cap); }
    else if(capType==='crenel'){ for(let i=0;i<8;i++){ const merlon=mkBox(0.3,0.4,0.3,baseColor); const ang=i/8*Math.PI*2; merlon.position.set(Math.cos(ang)*w*0.45,h+0.2,Math.sin(ang)*w*0.45); g.add(merlon);} }
    else if(capType==='glow'){ const orb=new THREE.Mesh(new THREE.SphereGeometry(w*0.3,10,8), new THREE.MeshStandardMaterial({color:0x8a4ad8,emissive:0x8a4ad8,emissiveIntensity:0.8,transparent:true,opacity:0.85})); orb.position.y=h+0.4; g.add(orb); }
    return g;
  }
  function buildBridgeSpan(color, len, railColor){
    const g=new THREE.Group();
    const deck=mkBox(len,0.3,2.6,color); deck.position.y=2; g.add(deck);
    for(const sx of [-1.25,1.25]){ const rail=mkBox(len*0.96,0.5,0.1,railColor||color); rail.position.set(0,2.4,sx); g.add(rail); }
    for(let i=0;i<3;i++){ const pillar=mkCyl(0.3,0.4,2,color,8); pillar.position.set((i-1)*len*0.32,1,0); g.add(pillar); }
    return g;
  }

  // -- Maisons régionales (9) --
  registerAsset({ id:'bld_woodhouse', cat:'structures', family:'Maisons régionales', label:'Maison en bois', icon:'🏠', color:0x6b4a2e, size:[4,3,3.2],
    build:()=> buildSimpleHouse(0x6b4a2e,0x3a2a1e,4,3.2,2.6,'pitched') });
  registerAsset({ id:'bld_stonehouse', cat:'structures', family:'Maisons régionales', label:'Maison en pierre', icon:'🏠', color:0x7a776c, size:[4,3,3.2],
    build:()=> buildSimpleHouse(0x7a776c,0x4a4842,4,3.2,2.6,'flat') });
  registerAsset({ id:'bld_chalet', cat:'structures', family:'Maisons régionales', label:'Chalet', icon:'🏔️', color:0x8a6a4a, size:[4.2,3.4,3.6],
    build:()=>{ const g=buildSimpleHouse(0x8a6a4a,0x3a2a1e,4.2,3.6,2.8,'pitched'); const balcony=mkBox(3.6,0.15,0.7,0x6b4a2e); balcony.position.set(0,1.4,1.85); g.add(balcony); return g; }});
  registerAsset({ id:'bld_cabin2', cat:'structures', family:'Maisons régionales', label:'Cabane', icon:'🏚️', color:0x6b4a2e, size:[3,2.4,2.6],
    build:()=> buildSimpleHouse(0x6b4a2e,0x3a2a1e,3,2.6,2.2,'pitched') });
  registerAsset({ id:'bld_hut', cat:'structures', family:'Maisons régionales', label:'Hutte', icon:'🛖', color:0x9a8060, size:[2.6,2.2,2.6],
    build:()=> buildSimpleHouse(0x9a8060,0x6b5a3a,2.6,2.6,1.8,'cone') });
  registerAsset({ id:'bld_asianhouse', cat:'structures', family:'Maisons régionales', label:'Maison asiatique', icon:'🏯', color:0xb03a3a, size:[4,3,3.4],
    build:()=>{ const g=buildSimpleHouse(0xd8c8a0,0xb03a3a,4,3.4,2.4,'flat'); const eave=mkBox(4.6,0.12,3.8,0xb03a3a); eave.position.y=2.5; g.add(eave); return g; }});
  registerAsset({ id:'bld_nordichouse', cat:'structures', family:'Maisons régionales', label:'Maison nordique', icon:'🏠', color:0x5c4530, size:[4,3.2,3.4],
    build:()=>{ const g=buildSimpleHouse(0x5c4530,0x2a2a2a,4,3.4,2.6,'pitched'); const carving=mkBox(0.15,1.2,0.15,0xc0a060); carving.position.set(0,3.2,1.7); g.add(carving); return g; }});
  registerAsset({ id:'bld_deserthouse', cat:'structures', family:'Maisons régionales', label:'Maison désertique', icon:'🏠', color:0xd9c290, size:[4,2.8,3.4],
    build:()=> buildSimpleHouse(0xd9c290,0xc9a96a,4,3.4,2.4,'flat') });
  registerAsset({ id:'bld_medvillage', cat:'structures', family:'Maisons régionales', label:'Village médiéval', icon:'🏘️', color:0x8a6a4a, size:[9,3.5,7],
    build:()=>{ const g=new THREE.Group(); const positions=[[-2.6,-1.6,0],[2.4,-1.8,0.4],[0,1.8,-0.2]];
      positions.forEach(([x,z,ry])=>{ const h=buildSimpleHouse(0x8a6a4a,0x3a2a1e,2.6,2.2,2,'pitched'); h.position.set(x,0,z); h.rotation.y=ry; g.add(h); });
      return g; }});

  // -- Défense (4) --
  registerAsset({ id:'bld_tower', cat:'structures', family:'Défense', label:'Tour', icon:'🗼', color:0x7a776c, size:[2.4,7,2.4],
    build:()=> buildTower(0x7a776c,2.4,6.4,'crenel') });
  registerAsset({ id:'bld_watchtower', cat:'structures', family:'Défense', label:'Tour de garde', icon:'🗼', color:0x6b4a2e, size:[2,6,2],
    build:()=>{ const g=buildTower(0x6b4a2e,1.6,5,null); const roof=mkBox(2.2,0.15,2.2,0x3a2a1e); roof.position.y=5.4; g.add(roof);
      for(const sx of [-1,1]) for(const sz of [-1,1]){ const post=mkCyl(0.05,0.05,0.9,0x3a2a1e); post.position.set(sx*0.9,5.4,sz*0.9); g.add(post);} return g; }});
  registerAsset({ id:'bld_castle', cat:'structures', family:'Défense', label:'Château', icon:'🏰', color:0x8a8578, size:[10,7,10],
    build:()=>{ const g=new THREE.Group(); const keep=mkBox(5,5,5,0x8a8578); g.add(keep);
      for(const [x,z] of [[-4,-4],[4,-4],[-4,4],[4,4]]){ const t=buildTower(0x8a8578,1.8,6,'crenel'); t.position.set(x,0,z); g.add(t); }
      for(let i=0;i<10;i++){ const merlon=mkBox(0.4,0.5,0.4,0x8a8578); const ang=i/10*Math.PI*2; merlon.position.set(Math.cos(ang)*2.6,5.25,Math.sin(ang)*2.6); g.add(merlon);} return g; }});
  registerAsset({ id:'bld_fort', cat:'structures', family:'Défense', label:'Fort', icon:'🏯', color:0x6b6a5f, size:[8,4,8],
    build:()=>{ const g=new THREE.Group(); const wallN=mkBox(8,3,0.5,0x6b6a5f); wallN.position.set(0,1.5,-4); g.add(wallN);
      const wallS=mkBox(8,3,0.5,0x6b6a5f); wallS.position.set(0,1.5,4); g.add(wallS);
      const wallE=mkBox(0.5,3,8,0x6b6a5f); wallE.position.set(4,1.5,0); g.add(wallE);
      const wallW=mkBox(0.5,3,8,0x6b6a5f); wallW.position.set(-4,1.5,0); g.add(wallW);
      const barracks=buildSimpleHouse(0x6b4a2e,0x3a2a1e,3,2.6,2.2,'flat'); g.add(barracks); return g; }});

  // -- Religieux (4) --
  registerAsset({ id:'bld_temple', cat:'structures', family:'Religieux', label:'Temple', icon:'🛕', color:0xd8c8a0, size:[6,4,5],
    build:()=>{ const g=new THREE.Group(); const base=mkBox(6,0.4,5,0xc0a970); g.add(base);
      for(let i=0;i<6;i++){ const col=mkCyl(0.22,0.22,3,0xe8ddc0,10); col.position.set(-2.4+i*0.96,1.9,2.1); g.add(col);}
      const roof=mkBox(6.4,0.4,5.4,0xb03a3a); roof.position.y=3.6; g.add(roof);
      const pediment=new THREE.Mesh(new THREE.ConeGeometry(3.4,1,3), new THREE.MeshStandardMaterial({color:0xd8c8a0})); pediment.rotation.y=Math.PI/2; pediment.rotation.z=Math.PI/2; pediment.position.set(0,4.3,2.1); g.add(pediment); return g; }});
  registerAsset({ id:'bld_church', cat:'structures', family:'Religieux', label:'Église', icon:'⛪', color:0xd8d0c0, size:[5,6,4],
    build:()=>{ const g=buildSimpleHouse(0xd8d0c0,0x4a4a4a,5,4,3,'pitched'); const spire=new THREE.Mesh(new THREE.ConeGeometry(0.9,2.4,4), new THREE.MeshStandardMaterial({color:0x4a4a4a})); spire.position.y=4.2; g.add(spire);
      const cross=mkBox(0.08,0.5,0.08,0x2a2a2a); cross.position.y=5.5; g.add(cross); const crossbar=mkBox(0.3,0.08,0.08,0x2a2a2a); crossbar.position.y=5.35; g.add(crossbar); return g; }});
  registerAsset({ id:'bld_cathedral', cat:'structures', family:'Religieux', label:'Cathédrale', icon:'⛪', color:0xc8c0b0, size:[8,10,6],
    build:()=>{ const g=buildSimpleHouse(0xc8c0b0,0x4a4a4a,8,6,5,'pitched');
      for(const sx of [-2.6,2.6]){ const tower=buildTower(0xc8c0b0,1.4,4,'cone'); tower.position.set(sx,5,-2); g.add(tower); }
      const rose=new THREE.Mesh(new THREE.CircleGeometry(1,16), new THREE.MeshStandardMaterial({color:0x3a6fa0,emissive:0x2a4a6a,emissiveIntensity:0.3})); rose.position.set(0,3.5,3.01); g.add(rose); return g; }});
  registerAsset({ id:'bld_pagoda', cat:'structures', family:'Religieux', label:'Pagode', icon:'🏯', color:0xb03a3a, size:[4,7,4],
    build:()=>{ const g=new THREE.Group(); let w=3.4,y=0; for(let i=0;i<4;i++){ const tier=mkBox(w,1.1,w,0xd8c8a0); tier.position.y=y+0.55; g.add(tier);
        const roof=mkBox(w*1.25,0.15,w*1.25,0xb03a3a); roof.position.y=y+1.15; g.add(roof); y+=1.25; w*=0.78; }
      const spire=mkCyl(0.04,0.1,1,0xc0a060); spire.position.y=y+0.5; g.add(spire); return g; }});

  // -- Rural / industriel (7) --
  registerAsset({ id:'bld_mill', cat:'structures', family:'Rural & industriel', label:'Moulin', icon:'🏚️', color:0xd8c8a0, size:[3,5,3],
    build:()=>{ const g=buildTower(0xd8c8a0,2.2,3.6,'cone'); const hub=mkCyl(0.15,0.15,0.3,0x3a2a1e); hub.rotation.z=Math.PI/2; hub.position.set(0,3.4,1.2); g.add(hub);
      for(let i=0;i<4;i++){ const blade=mkBox(0.15,1.8,0.05,0x6b4a2e); blade.position.set(0,3.4,1.2); blade.rotation.z=i*Math.PI/2; blade.position.y+=Math.sin(i*Math.PI/2)*0.9; blade.position.x+=Math.cos(i*Math.PI/2)*0; g.add(blade);} return g; }});
  registerAsset({ id:'bld_barn', cat:'structures', family:'Rural & industriel', label:'Grange', icon:'🏚️', color:0xa03a2a, size:[5,3.4,4],
    build:()=> buildSimpleHouse(0xa03a2a,0x3a2a1e,5,4,3,'pitched') });
  registerAsset({ id:'bld_warehouse2', cat:'structures', family:'Rural & industriel', label:'Entrepôt', icon:'🏭', color:0x6b6e73, size:[8,4,6],
    build:()=> buildSimpleHouse(0x6b6e73,0x4a4d52,8,6,3.6,'flat') });
  registerAsset({ id:'bld_factory2', cat:'structures', family:'Rural & industriel', label:'Usine', icon:'🏭', color:0x5a5d62, size:[7,5,6],
    build:()=>{ const g=buildSimpleHouse(0x5a5d62,0x3a3d42,7,6,4,'flat'); const chimney=mkCyl(0.5,0.6,4,0x3a3d42,10); chimney.position.set(2.5,4,-2); g.add(chimney); return g; }});
  registerAsset({ id:'bld_mine', cat:'structures', family:'Rural & industriel', label:'Mine', icon:'⛏️', color:0x4a4238, size:[4,3,3],
    build:()=>{ const g=new THREE.Group(); const frameL=mkBox(0.3,3,0.3,0x4a3a28); frameL.position.set(-1.2,1.5,0); g.add(frameL);
      const frameR=mkBox(0.3,3,0.3,0x4a3a28); frameR.position.set(1.2,1.5,0); g.add(frameR);
      const top=mkBox(2.7,0.3,0.4,0x4a3a28); top.position.y=3; g.add(top);
      const hole=new THREE.Mesh(new THREE.CircleGeometry(0.9,12), new THREE.MeshStandardMaterial({color:0x0a0a0a})); hole.position.set(0,1.3,0.16); g.add(hole); return g; }});
  registerAsset({ id:'bld_bunker2', cat:'structures', family:'Rural & industriel', label:'Bunker', icon:'🏢', color:0x5c5c54, size:[4,1.6,4],
    build:(c)=>{ const g=new THREE.Group(); const dome=new THREE.Mesh(new THREE.SphereGeometry(2,12,8,0,Math.PI*2,0,Math.PI/2.4), new THREE.MeshStandardMaterial({color:c,roughness:0.95,flatShading:true})); dome.scale.y=0.6; g.add(dome);
      const slit=mkBox(1,0.2,0.1,0x0a0a0a); slit.position.set(0,0.8,1.9); g.add(slit); return g; }});
  registerAsset({ id:'bld_barracks', cat:'structures', family:'Rural & industriel', label:'Caserne', icon:'🏢', color:0x5c6a4a, size:[6,3,4],
    build:()=> buildSimpleHouse(0x5c6a4a,0x3a4530,6,4,2.8,'flat') });

  // -- Transport (4) --
  registerAsset({ id:'bld_station', cat:'structures', family:'Transport', label:'Gare', icon:'🚉', color:0x8a6a4a, size:[7,4,5],
    build:()=>{ const g=buildSimpleHouse(0xd8c8a0,0x8a6a4a,7,5,3.2,'flat'); const canopy=mkBox(8,0.15,2,0x4a3a2a); canopy.position.set(0,3.6,3.4); g.add(canopy);
      for(const x of [-3,0,3]){ const post=mkCyl(0.08,0.1,1.4,0x2a2a2a); post.position.set(x,2.9,4.3); g.add(post);} return g; }});
  registerAsset({ id:'bld_dock', cat:'structures', family:'Transport', label:'Quai', icon:'🛥️', color:0x6b5a40, size:[6,0.4,2.4],
    build:(c)=>{ const g=group(mkBox(6,0.3,2.4,c)); for(let i=0;i<5;i++){ const pile=mkCyl(0.12,0.14,1,c); pile.position.set(-2.6+i*1.3,-0.5,0); g.add(pile);} return g; }});
  registerAsset({ id:'bld_port', cat:'structures', family:'Transport', label:'Port', icon:'⚓', color:0x5c6a72, size:[8,3,5],
    build:()=>{ const g=new THREE.Group(); const dock=mkBox(8,0.3,4,0x6b5a40); g.add(dock);
      const crane=mkCyl(0.2,0.25,3,0x8a6a2a,8); crane.position.set(-2.6,1.5,0); g.add(crane);
      const arm=mkBox(3,0.2,0.2,0x8a6a2a); arm.position.set(-1,3,0); g.add(arm); return g; }});
  registerAsset({ id:'bld_lighthouse', cat:'structures', family:'Transport', label:'Phare', icon:'🗼', color:0xe8e0d0, size:[2.4,8,2.4],
    build:()=>{ const g=buildTower(0xe8e0d0,2,7,null); const lamp=new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.6,0.8,10), new THREE.MeshStandardMaterial({color:0xfff3c0,emissive:0xffdc7a,emissiveIntensity:0.6})); lamp.position.y=7.4; g.add(lamp);
      const cap=new THREE.Mesh(new THREE.ConeGeometry(0.7,0.6,10), new THREE.MeshStandardMaterial({color:0xb03a2a})); cap.position.y=8.1; g.add(cap);
      for(let i=0;i<4;i++){ const stripe=mkBox(0.05,1.5,2.05,0xb03a2a); stripe.position.y=1+i*1.5; stripe.rotation.y=i*Math.PI/4; g.add(stripe);} return g; }});

  // -- Ponts (3) --
  registerAsset({ id:'bld_woodbridge', cat:'structures', family:'Ponts', label:'Pont en bois', icon:'🌉', color:0x6b4a2e, size:[8,2.5,2.6],
    build:()=> buildBridgeSpan(0x6b4a2e,8) });
  registerAsset({ id:'bld_stonebridge', cat:'structures', family:'Ponts', label:'Pont de pierre', icon:'🌉', color:0x8a8578, size:[8,2.5,2.6],
    build:()=>{ const g=buildBridgeSpan(0x8a8578,8,0x8a8578); for(let i=0;i<2;i++){ const arch=new THREE.Mesh(new THREE.TorusGeometry(1.1,0.25,8,12,Math.PI), new THREE.MeshStandardMaterial({color:0x8a8578,roughness:0.9})); arch.position.set((i-0.5)*4,0,0); arch.rotation.x=Math.PI/2; g.add(arch);} return g; }});
  registerAsset({ id:'bld_suspbridge', cat:'structures', family:'Ponts', label:'Pont suspendu', icon:'🌉', color:0x5c5c54, size:[10,4,2.6],
    build:()=>{ const g=buildBridgeSpan(0x6b6b64,10,0x5c5c54); for(const sx of [-4.5,4.5]){ const tower=mkBox(0.4,3.5,0.4,0x5c5c54); tower.position.set(sx,3.7,0); g.add(tower);
        const cable=mkBox(10.2,0.08,0.08,0x2a2a2a); cable.position.set(0,3.6,0); g.add(cable);} return g; }});

  // -- Structurel (3) --
  registerAsset({ id:'bld_stairs', cat:'structures', family:'Structurel', label:'Escalier', icon:'🪜', color:0x8a8578, size:[1.4,2,3],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<8;i++){ const step=mkBox(1.4,0.2,0.4,c); step.position.set(0,0.1+i*0.24,-1.4+i*0.4); g.add(step);} return g; }});
  registerAsset({ id:'bld_ramp', cat:'structures', family:'Structurel', label:'Rampe', icon:'📐', color:0x6b6a5f, size:[2,1.5,4],
    build:(c)=>{ const g=new THREE.Group();
      const ramp=new THREE.Mesh(new THREE.BoxGeometry(2,0.3,4), new THREE.MeshStandardMaterial({color:c,roughness:0.85})); ramp.rotation.x=-0.35; ramp.position.y=0.75; ramp.castShadow=true; ramp.receiveShadow=true; g.add(ramp);
      // Bandes antidérapantes + garde-corps ajoutés comme ENFANTS du
      // plan incliné (pas du groupe) : ils héritent directement de sa
      // rotation, pas besoin de refaire la trigonométrie à la main.
      for(let i=0;i<5;i++){ const strip=new THREE.Mesh(new THREE.BoxGeometry(1.9,0.03,0.12), new THREE.MeshStandardMaterial({color:0xf0c020,roughness:0.6}));
        strip.position.set(0, 0.165, -1.6+i*0.8); strip.castShadow=false; ramp.add(strip); }
      for(const sx of [-1.02,1.02]){ const rail=new THREE.Mesh(new THREE.BoxGeometry(0.06,1.4,4.02), new THREE.MeshStandardMaterial({color:0x3a3a3a,metalness:0.4,roughness:0.5}));
        rail.position.set(sx,0.7,0); rail.castShadow=false; ramp.add(rail); }
      return g; }});
  registerAsset({ id:'bld_column', cat:'structures', family:'Structurel', label:'Colonne', icon:'🏛️', color:0xe8ddc0, size:[0.6,3.5,0.6],
    build:(c)=>{ const g=new THREE.Group(); const base=mkCyl(0.32,0.36,0.2,c); g.add(base); const shaft=mkCyl(0.24,0.24,3,c,12); shaft.position.y=1.7; g.add(shaft); const cap=mkCyl(0.32,0.28,0.2,c); cap.position.y=3.3; g.add(cap); return g; }});

  // -- Monuments (4) --
  registerAsset({ id:'bld_pyramid', cat:'structures', family:'Monuments', label:'Pyramide', icon:'🔺', color:0xd9c290, size:[6,4,6],
    build:(c)=>{ const g=new THREE.Group();
      const p=new THREE.Mesh(new THREE.ConeGeometry(4,4,4), new THREE.MeshStandardMaterial({color:c,roughness:0.9,flatShading:true})); p.rotation.y=Math.PI/4; p.position.y=2; p.castShadow=true; g.add(p);
      // Pierre de faîte distincte + entrée basse — un cône à 4 faces tout
      // seul se lit comme une simple forme géométrique, pas un monument.
      const cap=new THREE.Mesh(new THREE.ConeGeometry(0.35,0.45,4), new THREE.MeshStandardMaterial({color:0xc9a970,roughness:0.4,metalness:0.15}));
      cap.rotation.y=Math.PI/4; cap.position.y=3.85; cap.castShadow=false; g.add(cap);
      const doorway=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.9,0.5), new THREE.MeshStandardMaterial({color:0x1c1a16}));
      doorway.position.set(0,0.45,2.55); doorway.castShadow=false; g.add(doorway);
      return g; }});
  registerAsset({ id:'bld_obelisk', cat:'structures', family:'Monuments', label:'Obélisque', icon:'🗿', color:0xc9a970, size:[1,5,1],
    build:(c)=>{ const g=new THREE.Group(); const shaft=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.4,4.4,4), new THREE.MeshStandardMaterial({color:c,roughness:0.85,flatShading:true})); shaft.position.y=2.2; g.add(shaft);
      const tip=new THREE.Mesh(new THREE.ConeGeometry(0.3,0.6,4), new THREE.MeshStandardMaterial({color:c})); tip.position.y=4.7; g.add(tip); return g; }});
  registerAsset({ id:'bld_ruins2', cat:'structures', family:'Monuments', label:'Ruine antique', icon:'🏛️', color:0xc9c0a8, size:[5,3,4],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<4;i++){ const h=1.5+Math.random()*1.8; const col=mkCyl(0.22,0.22,h,c,10); col.position.set(-2+i*1.3,h/2,0); g.add(col);}
      const rubble=new THREE.Mesh(new THREE.DodecahedronGeometry(0.5,0), new THREE.MeshStandardMaterial({color:c,flatShading:true})); rubble.position.set(1.5,0.25,1); g.add(rubble); return g; }});
  registerAsset({ id:'bld_arc', cat:'structures', family:'Monuments', label:'Arc de triomphe', icon:'🏛️', color:0xd8c8a0, size:[5,5,2],
    build:(c)=>{ const g=new THREE.Group(); const pillarL=mkBox(1,4.5,1.6,c); pillarL.position.x=-1.7; g.add(pillarL);
      const pillarR=mkBox(1,4.5,1.6,c); pillarR.position.x=1.7; g.add(pillarR);
      const top=mkBox(4.4,1,1.8,c); top.position.y=5; g.add(top); return g; }});

  // -- Portails (2) --
  registerAsset({ id:'bld_castlegate', cat:'structures', family:'Portails', label:'Porte de château', icon:'🚪', color:0x7a776c, size:[3,4,1.2],
    build:(c)=>{ const g=new THREE.Group(); const towerL=buildTower(c,1.2,4,'crenel'); towerL.position.x=-1.6; g.add(towerL);
      const towerR=buildTower(c,1.2,4,'crenel'); towerR.position.x=1.6; g.add(towerR);
      const arch=mkBox(2,1,1,c); arch.position.y=3.3; g.add(arch);
      const gate=mkBox(1.6,2.6,0.15,0x3a2a1e); gate.position.y=1.3; g.add(gate); return g; }});
  registerAsset({ id:'bld_magicgate', cat:'structures', family:'Portails', label:'Portail magique', icon:'🌀', color:0x5c3a8a, size:[3,4,0.6],
    build:()=>{ const g=new THREE.Group(); const frame=new THREE.Mesh(new THREE.TorusGeometry(1.5,0.25,10,20), new THREE.MeshStandardMaterial({color:0x5c3a8a,roughness:0.5,metalness:0.3})); frame.position.y=1.6; g.add(frame);
      const veil=new THREE.Mesh(new THREE.CircleGeometry(1.3,20), new THREE.MeshStandardMaterial({color:0x8a4ad8,emissive:0x8a4ad8,emissiveIntensity:0.7,transparent:true,opacity:0.55})); veil.position.y=1.6; g.add(veil); return g; }});

  // -- Points d'eau bâtis (2) --
  registerAsset({ id:'bld_well', cat:'structures', family:"Points d'eau bâtis", label:'Puits', icon:'⛲', color:0x8a8578, size:[1.4,1.5,1.4],
    build:(c)=>{ const g=new THREE.Group(); const wall=mkCyl(0.6,0.65,0.8,c,12); g.add(wall);
      const water=new THREE.Mesh(new THREE.CircleGeometry(0.5,12), new THREE.MeshStandardMaterial({color:0x2f6f8f})); water.rotation.x=-Math.PI/2; water.position.y=0.81; g.add(water);
      const postL=mkCyl(0.05,0.05,1.2,0x6b4a2e); postL.position.set(-0.5,0.8,0); g.add(postL);
      const postR=mkCyl(0.05,0.05,1.2,0x6b4a2e); postR.position.set(0.5,0.8,0); g.add(postR);
      const roof=new THREE.Mesh(new THREE.ConeGeometry(0.8,0.5,6), new THREE.MeshStandardMaterial({color:0x3a2a1e})); roof.position.y=1.65; g.add(roof); return g; }});
  registerAsset({ id:'bld_fountain2', cat:'structures', family:"Points d'eau bâtis", label:'Fontaine', icon:'⛲', color:0xc9c0a8, size:[2.4,2,2.4],
    build:(c)=>{ const g=new THREE.Group(); const basin=mkCyl(1.1,1.2,0.4,c,16); g.add(basin);
      const water=new THREE.Mesh(new THREE.CircleGeometry(1,16), new THREE.MeshStandardMaterial({color:0x2f6f8f,transparent:true,opacity:0.8})); water.rotation.x=-Math.PI/2; water.position.y=0.41; g.add(water);
      const pedestal=mkCyl(0.2,0.25,1.2,c,10); pedestal.position.y=0.4; g.add(pedestal);
      const top=mkCyl(0.35,0.35,0.15,c,10); top.position.y=1.62; g.add(top); return g; }});

  // -- Camps (2) --
  registerAsset({ id:'bld_tent', cat:'structures', family:'Camps', label:'Tente', icon:'⛺', color:0x8a6a4a, size:[2.2,1.6,2.2],
    build:(c)=>{ const g=new THREE.Group();
      const cone=new THREE.Mesh(new THREE.ConeGeometry(1.3,1.6,8), new THREE.MeshStandardMaterial({color:c,roughness:0.9})); cone.position.y=0.8; cone.castShadow=true; g.add(cone);
      const flap=new THREE.Mesh(new THREE.ConeGeometry(0.35,1.55,3,1,true), new THREE.MeshStandardMaterial({color:new THREE.Color(c).multiplyScalar(0.65),roughness:0.9,side:THREE.DoubleSide}));
      flap.position.set(0,0.78,1.05); flap.castShadow=false; g.add(flap);
      for(const ang of [Math.PI*0.28,Math.PI*0.72,Math.PI*1.28,Math.PI*1.72]){
        const stakeX=Math.sin(ang)*1.55, stakeZ=Math.cos(ang)*1.55;
        const rope=mkCyl(0.012,0.012,1.0,0xc9c0a0,4); rope.rotation.z=Math.PI/2; rope.rotation.y=-ang;
        rope.position.set(stakeX*0.5,0.55,stakeZ*0.5); rope.castShadow=false; g.add(rope);
        const stake=mkCyl(0.02,0.03,0.18,0x4a3a2a,5); stake.rotation.x=0.3;
        stake.position.set(stakeX,0.09,stakeZ); stake.castShadow=false; g.add(stake);
      }
      return g; }});
  registerAsset({ id:'bld_camp', cat:'structures', family:'Camps', label:'Campement', icon:'🏕️', color:0x8a6a4a, size:[5,1.8,5],
    build:()=>{ const g=new THREE.Group(); const t1=new THREE.Mesh(new THREE.ConeGeometry(1.1,1.5,8), new THREE.MeshStandardMaterial({color:0x8a6a4a})); t1.position.set(-1.4,0.75,0); g.add(t1);
      const t2=new THREE.Mesh(new THREE.ConeGeometry(1,1.3,8), new THREE.MeshStandardMaterial({color:0x6b7a4a})); t2.position.set(1.6,0.65,0.6); g.add(t2);
      const fire=mkCyl(0.25,0.3,0.15,0x3a2a1e); fire.position.set(0,0.08,-1); g.add(fire);
      const flame=new THREE.Mesh(new THREE.ConeGeometry(0.15,0.35,6), new THREE.MeshStandardMaterial({color:0xff8a2a,emissive:0xff5a1e,emissiveIntensity:0.8})); flame.position.set(0,0.3,-1); g.add(flame); return g; }});

  // -- Spéciaux (7) --
  registerAsset({ id:'bld_magictower', cat:'structures', family:'Spéciaux', label:'Tour magique', icon:'🧙', color:0x5c3a8a, size:[2.4,7,2.4],
    build:()=> buildTower(0x5c3a8a,2.2,6.2,'glow') });
  registerAsset({ id:'bld_library', cat:'structures', family:'Spéciaux', label:'Bibliothèque', icon:'📚', color:0xc9a970, size:[6,3.5,5],
    build:()=>{ const g=buildSimpleHouse(0xc9a970,0x4a3a2a,6,5,3,'flat'); for(let i=0;i<3;i++){ const col=mkCyl(0.18,0.18,3,0xe8ddc0,8); col.position.set(-2+i*2,1.5,2.55); g.add(col);} return g; }});
  registerAsset({ id:'bld_lab', cat:'structures', family:'Spéciaux', label:'Laboratoire', icon:'🧪', color:0x8a8f95, size:[5,3,4],
    build:()=>{ const g=buildSimpleHouse(0x8a8f95,0x5a5f65,5,4,2.8,'flat'); const tank=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,1.6,10), new THREE.MeshPhysicalMaterial({color:0x4ad8c0,roughness:0.1,transmission:0.5,transparent:true,opacity:0.85})); tank.position.set(1.6,0.8,2.2); g.add(tank); return g; }});
  registerAsset({ id:'bld_observatory', cat:'structures', family:'Spéciaux', label:'Observatoire', icon:'🔭', color:0xc9c0a8, size:[3.2,4,3.2],
    build:()=>{ const g=buildTower(0xc9c0a8,3,3,null); const dome=new THREE.Mesh(new THREE.SphereGeometry(1.6,14,10,0,Math.PI*2,0,Math.PI/2), new THREE.MeshStandardMaterial({color:0x4a5568,roughness:0.4,metalness:0.3})); dome.position.y=3; g.add(dome);
      const scope=mkBox(0.2,0.2,1.4,0x2a2a2a); scope.position.set(0,3.6,0.4); scope.rotation.x=-0.6; g.add(scope); return g; }});
  registerAsset({ id:'bld_futuredome', cat:'structures', family:'Spéciaux', label:'Dôme futuriste', icon:'🏙️', color:0x6b7078, size:[6,3.5,6],
    build:()=>{ const g=new THREE.Group(); const base=mkCyl(3,3,0.5,0x6b7078,16); g.add(base);
      const dome=new THREE.Mesh(new THREE.SphereGeometry(2.8,20,12,0,Math.PI*2,0,Math.PI/2), new THREE.MeshPhysicalMaterial({color:0x8ad0e8,roughness:0.05,transmission:0.6,thickness:0.5,transparent:true,opacity:0.6})); dome.position.y=0.5; g.add(dome);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(2.85,0.08,8,24), new THREE.MeshStandardMaterial({color:0x1a2530,emissive:0x37eaff,emissiveIntensity:1})); ring.rotation.x=Math.PI/2; ring.position.y=0.55; g.add(ring); return g; }});
  registerAsset({ id:'bld_hangar', cat:'structures', family:'Spéciaux', label:'Hangar', icon:'🏭', color:0x5c6068, size:[9,4,7],
    build:(c)=>{ const g=new THREE.Group(); const arch=new THREE.Mesh(new THREE.CylinderGeometry(3.5,3.5,9,16,1,false,0,Math.PI), new THREE.MeshStandardMaterial({color:c,roughness:0.7,metalness:0.2}));
      arch.rotation.z=Math.PI/2; arch.position.y=0; g.add(arch);
      const doorL=mkBox(0.1,3.4,3.4,0x3a3d42); doorL.position.set(-1.7,1.7,3.5); g.add(doorL);
      const doorR=mkBox(0.1,3.4,3.4,0x3a3d42); doorR.position.set(1.7,1.7,3.5); g.add(doorR); return g; }});


  // ============================================================
  // DÉCORATION — 29 petits objets d'ambiance (mobilier, éclairage,
  // statuaire, signalétique). Nouvelle catégorie "props" dans la palette.
  // ============================================================
  registerAsset({ id:'prop_bench', cat:'props', label:'Banc', icon:'🪑', color:0x6b4a2e, size:[1.4,0.5,0.5],
    build:(c)=>{ const g=new THREE.Group(); const seat=mkBox(1.4,0.08,0.4,c); seat.position.y=0.42; g.add(seat);
      const back=mkBox(1.4,0.4,0.06,c); back.position.set(0,0.65,-0.18); g.add(back);
      for(const x of [-0.6,0.6]){ const leg=mkBox(0.08,0.42,0.4,0x3a2a1e); leg.position.set(x,0.21,0); g.add(leg);} return g; }});
  registerAsset({ id:'prop_table', cat:'props', label:'Table', icon:'🪵', color:0x6b4a2e, size:[1.4,0.8,0.9],
    build:(c)=>{ const g=new THREE.Group(); const top=mkBox(1.4,0.08,0.9,c); top.position.y=0.76; g.add(top);
      for(const [x,z] of [[-0.6,-0.4],[0.6,-0.4],[-0.6,0.4],[0.6,0.4]]){ const leg=mkBox(0.08,0.76,0.08,0x3a2a1e); leg.position.set(x,0.38,z); g.add(leg);} return g; }});
  registerAsset({ id:'prop_chair', cat:'props', label:'Chaise', icon:'🪑', color:0x6b4a2e, size:[0.5,0.9,0.5],
    build:(c)=>{ const g=new THREE.Group(); const seat=mkBox(0.45,0.06,0.45,c); seat.position.y=0.45; g.add(seat);
      const back=mkBox(0.45,0.45,0.05,c); back.position.set(0,0.7,-0.2); g.add(back);
      for(const [x,z] of [[-0.18,-0.18],[0.18,-0.18],[-0.18,0.18],[0.18,0.18]]){ const leg=mkBox(0.05,0.45,0.05,0x3a2a1e); leg.position.set(x,0.225,z); g.add(leg);} return g; }});
  registerAsset({ id:'prop_barrel', cat:'props', label:'Tonneau', icon:'🛢️', color:0x8a6a3f, size:[0.6,0.8,0.6],
    build:(c)=>{ const g = group(mkCyl(0.3,0.3,0.8,c,12));
      for(const hy of [0.15,0.4,0.65]){ const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.305,0.02,5,14), new THREE.MeshStandardMaterial({color:0x3a3a3a,metalness:0.6,roughness:0.4}));
        hoop.rotation.x=Math.PI/2; hoop.position.y=hy; hoop.castShadow=false; g.add(hoop); }
      const lid = new THREE.Mesh(new THREE.CircleGeometry(0.28,12), new THREE.MeshStandardMaterial({color:0x3a3a3a,metalness:0.3,roughness:0.6}));
      lid.rotation.x=-Math.PI/2; lid.position.y=0.801; g.add(lid);
      return g; }});
  registerAsset({ id:'prop_crate', cat:'props', label:'Caisse', icon:'📦', color:0x8a6a3f, size:[0.6,0.6,0.6],
    build:(c)=>{ const g = group(mkBox(0.6,0.6,0.6,c));
      for(const [sx,sz] of [[-0.28,-0.28],[0.28,-0.28],[-0.28,0.28],[0.28,0.28]]){
        const edge = mkBox(0.05,0.62,0.05,0x4a3520); edge.position.set(sx,0.31,sz); edge.castShadow=false; g.add(edge);
      }
      return g; }});
  registerAsset({ id:'prop_chest', cat:'props', label:'Coffre', icon:'🧰', color:0x6b4a2e, size:[0.8,0.55,0.5],
    build:(c)=>{ const g=new THREE.Group(); const base=mkBox(0.8,0.35,0.5,c); g.add(base);
      const lid=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,0.5,10,1,false,0,Math.PI), new THREE.MeshStandardMaterial({color:c,roughness:0.9}));
      lid.rotation.z=Math.PI/2; lid.position.set(0,0.35,0); g.add(lid);
      const lock=mkBox(0.08,0.1,0.05,0xd0a020); lock.position.set(0,0.35,0.26); g.add(lock); return g; }});
  registerAsset({ id:'prop_bed', cat:'props', label:'Lit', icon:'🛏️', color:0x8a8a90, size:[1.4,0.6,2],
    build:()=>{ const g=new THREE.Group(); const frame=mkBox(1.4,0.3,2,0x6b4a2e); g.add(frame);
      const mattress=mkBox(1.3,0.2,1.9,0xe8e0d0); mattress.position.y=0.4; g.add(mattress);
      const pillow=mkBox(0.5,0.12,0.35,0xffffff); pillow.position.set(0,0.55,-0.75); g.add(pillow); return g; }});
  registerAsset({ id:'prop_fireplace', cat:'props', label:'Cheminée', icon:'🔥', color:0x7a776c, size:[1.2,1.8,0.6],
    build:(c)=>{ const g=new THREE.Group(); const body=mkBox(1.2,1.8,0.6,c); g.add(body);
      const hearth=mkBox(0.9,0.15,0.5,0x2a2a2a); hearth.position.set(0,0.3,0.05); g.add(hearth);
      const flame=new THREE.Mesh(new THREE.ConeGeometry(0.18,0.4,6), new THREE.MeshStandardMaterial({color:0xff8a2a,emissive:0xff5a1e,emissiveIntensity:0.9})); flame.position.set(0,0.5,0.1); g.add(flame); return g; }});
  registerAsset({ id:'prop_lamp', cat:'props', label:'Lampe', icon:'💡', color:0x2a2a2a, size:[0.3,1.6,0.3],
    build:()=>{ const g=new THREE.Group(); const pole=mkCyl(0.05,0.06,1.4,0x2a2a2a); g.add(pole);
      const shade=new THREE.Mesh(new THREE.ConeGeometry(0.22,0.3,10), new THREE.MeshStandardMaterial({color:0xf0e8c0,emissive:0xfff0b0,emissiveIntensity:0.6})); shade.position.y=1.5; g.add(shade); return g; }});
  registerAsset({ id:'prop_lantern', cat:'props', label:'Lanterne', icon:'🏮', color:0xb03a2a, size:[0.4,0.6,0.4],
    build:()=>{ const g=new THREE.Group(); const body=mkCyl(0.18,0.18,0.4,0xb03a2a,10); body.material.emissive=new THREE.Color(0xff6a2a); body.material.emissiveIntensity=0.5; g.add(body);
      const top=mkCyl(0.02,0.1,0.1,0x3a2a1e); top.position.y=0.25; g.add(top); const bottom=mkCyl(0.1,0.02,0.1,0x3a2a1e); bottom.position.y=-0.25; g.add(bottom); return g; }});
  registerAsset({ id:'prop_torch', cat:'props', label:'Torche', icon:'🔥', color:0x6b4a2e, size:[0.15,1.2,0.15],
    build:()=>{ const g=new THREE.Group(); const stick=mkCyl(0.03,0.04,1,0x6b4a2e); g.add(stick);
      const flame=new THREE.Mesh(new THREE.ConeGeometry(0.09,0.22,6), new THREE.MeshStandardMaterial({color:0xff8a2a,emissive:0xff5a1e,emissiveIntensity:0.9})); flame.position.y=0.6; g.add(flame); return g; }});
  registerAsset({ id:'prop_statue', cat:'props', label:'Statue', icon:'🗿', color:0xa8a29a, size:[0.8,2,0.6],
    build:(c)=>{ const g=new THREE.Group(); const base=mkBox(0.9,0.3,0.7,c); g.add(base);
      const body=mkCyl(0.28,0.34,1.4,c,10); body.position.y=1; g.add(body);
      const head=new THREE.Mesh(new THREE.IcosahedronGeometry(0.24,1), new THREE.MeshStandardMaterial({color:c,flatShading:true})); head.position.y=1.85; g.add(head); return g; }});
  registerAsset({ id:'prop_statue_giant', cat:'props', label:'Statue géante', icon:'🗿', color:0x8a857a, size:[2,6,1.6],
    build:(c)=>{ const g=new THREE.Group(); const base=mkBox(2.2,0.6,1.8,c); g.add(base);
      const body=mkCyl(0.7,0.9,4,c,12); body.position.y=2.6; g.add(body);
      const head=new THREE.Mesh(new THREE.IcosahedronGeometry(0.6,1), new THREE.MeshStandardMaterial({color:c,flatShading:true})); head.position.y=5; g.add(head); return g; }});
  registerAsset({ id:'prop_sign', cat:'props', label:'Panneau', icon:'🪧', color:0x6b4a2e, size:[0.9,1.2,0.1],
    build:()=>{ const g=new THREE.Group(); const post=mkCyl(0.05,0.06,1,0x6b4a2e); g.add(post);
      const board=mkBox(0.8,0.5,0.05,0xd8c8a0); board.position.y=1.05; g.add(board); return g; }});
  registerAsset({ id:'prop_dirsign', cat:'props', label:'Panneau directionnel', icon:'➡️', color:0x6b4a2e, size:[1,1.4,0.1],
    build:()=>{ const g=new THREE.Group(); const post=mkCyl(0.05,0.06,1.3,0x6b4a2e); g.add(post);
      const arrow1=mkBox(0.6,0.2,0.04,0xd8c8a0); arrow1.position.set(0.2,1.1,0); g.add(arrow1);
      const arrow2=mkBox(0.5,0.2,0.04,0xd8c8a0); arrow2.position.set(-0.15,0.85,0); arrow2.rotation.z=0.3; g.add(arrow2); return g; }});
  registerAsset({ id:'prop_flag', cat:'props', label:'Drapeau', icon:'🚩', color:0xd8384a, size:[0.6,1.8,0.05],
    build:()=>{ const g=new THREE.Group(); const pole=mkCyl(0.03,0.04,1.8,0x2a2a2a); g.add(pole);
      const cloth=mkBox(0.5,0.35,0.03,0xd8384a); cloth.position.set(0.28,0.75,0); g.add(cloth); return g; }});
  registerAsset({ id:'prop_banner', cat:'props', label:'Bannière', icon:'🎏', color:0x3a5cb0, size:[0.5,2,0.05],
    build:()=>{ const g=new THREE.Group(); const cloth=mkBox(0.5,1.8,0.04,0x3a5cb0); g.add(cloth);
      const emblem=new THREE.Mesh(new THREE.CircleGeometry(0.14,10), new THREE.MeshStandardMaterial({color:0xf0c020})); emblem.position.set(0,0.4,0.03); g.add(emblem); return g; }});
  registerAsset({ id:'prop_clock', cat:'props', label:'Horloge', icon:'🕐', color:0x3a2a1e, size:[0.6,0.6,0.15],
    build:()=>{ const g=new THREE.Group(); const face=mkCyl(0.3,0.3,0.08,0xe8e0d0,16); face.rotation.z=Math.PI/2; g.add(face);
      const rim=new THREE.Mesh(new THREE.TorusGeometry(0.3,0.03,6,16), new THREE.MeshStandardMaterial({color:0x3a2a1e})); rim.rotation.y=Math.PI/2; g.add(rim); return g; }});
  registerAsset({ id:'prop_bell', cat:'props', label:'Cloche', icon:'🔔', color:0xc0a030, size:[0.5,0.6,0.5],
    build:(c)=>{ const g=new THREE.Group(); const bell=new THREE.Mesh(new THREE.ConeGeometry(0.28,0.4,10,1,true), new THREE.MeshStandardMaterial({color:c,metalness:0.7,roughness:0.3,side:THREE.DoubleSide})); bell.position.y=0.3; g.add(bell);
      const clapper=new THREE.Mesh(new THREE.SphereGeometry(0.05,8,6), new THREE.MeshStandardMaterial({color:0x3a2a1e})); clapper.position.y=0.08; g.add(clapper); return g; }});
  registerAsset({ id:'prop_flowerpot', cat:'props', label:'Pot de fleurs', icon:'🪴', color:0xb0623a, size:[0.4,0.5,0.4],
    build:()=>{ const g=new THREE.Group(); const pot=mkCyl(0.16,0.2,0.28,0xb0623a,10); g.add(pot);
      const plant=new THREE.Mesh(new THREE.IcosahedronGeometry(0.16,0), new THREE.MeshStandardMaterial({color:0x4f7a3a,flatShading:true})); plant.position.y=0.35; g.add(plant); return g; }});
  registerAsset({ id:'prop_decofountain', cat:'props', label:'Fontaine décorative', icon:'⛲', color:0xc9c0a8, size:[1.6,1.4,1.6],
    build:(c)=>{ const g=new THREE.Group(); const basin=mkCyl(0.75,0.8,0.3,c,16); g.add(basin);
      const water=new THREE.Mesh(new THREE.CircleGeometry(0.65,16), new THREE.MeshStandardMaterial({color:0x2f6f8f,transparent:true,opacity:0.8})); water.rotation.x=-Math.PI/2; water.position.y=0.31; g.add(water);
      const pedestal=mkCyl(0.14,0.18,0.9,c,10); pedestal.position.y=0.3; g.add(pedestal); return g; }});
  registerAsset({ id:'prop_cart', cat:'props', label:'Chariot', icon:'🛒', color:0x6b4a2e, size:[1.4,0.9,0.9],
    build:(c)=>{ const g=new THREE.Group(); const bed=mkBox(1.4,0.4,0.9,c); bed.position.y=0.5; g.add(bed);
      for(const x of [-0.5,0.5]){ const wheel=new THREE.Mesh(new THREE.TorusGeometry(0.28,0.06,8,14), new THREE.MeshStandardMaterial({color:0x3a2a1e})); wheel.rotation.y=Math.PI/2; wheel.position.set(x,0.28,0.5); g.add(wheel);}
      return g; }});
  registerAsset({ id:'prop_brokenwheel', cat:'props', label:'Roue cassée', icon:'☸️', color:0x5c4530, size:[0.7,0.15,0.7],
    build:(c)=>{ const wheel=new THREE.Mesh(new THREE.TorusGeometry(0.32,0.05,6,12,Math.PI*1.5), new THREE.MeshStandardMaterial({color:c,roughness:0.9})); wheel.rotation.x=Math.PI/2; wheel.position.y=0.32; wheel.rotation.z=0.4;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,0.06,8), new THREE.MeshStandardMaterial({color:0x3a2a1a,roughness:0.9})); hub.rotation.x=Math.PI/2; hub.castShadow=false; wheel.add(hub);
      for(let i=0;i<3;i++){ const spokeLen=0.12+Math.random()*0.06; const spoke=new THREE.Mesh(new THREE.BoxGeometry(0.03,spokeLen,0.02), new THREE.MeshStandardMaterial({color:c,roughness:0.9}));
        const ang=(i/3)*Math.PI*2+0.3; spoke.position.set(Math.sin(ang)*spokeLen*0.5,0,Math.cos(ang)*spokeLen*0.5); spoke.rotation.z=-ang; spoke.castShadow=false; hub.add(spoke); }
      return group(wheel); }});
  registerAsset({ id:'prop_cage', cat:'props', label:'Cage', icon:'🔒', color:0x3a3a3a, size:[0.8,1.2,0.8],
    build:(c)=>{ const g=new THREE.Group(); for(let i=0;i<8;i++){ const bar=mkCyl(0.02,0.02,1.1,c,6); const ang=i/8*Math.PI*2; bar.position.set(Math.cos(ang)*0.36,0.55,Math.sin(ang)*0.36); g.add(bar);}
      const top=mkCyl(0.38,0.38,0.03,c,12); top.position.y=1.1; g.add(top); const bottom=mkCyl(0.38,0.38,0.03,c,12); bottom.position.y=0.02; g.add(bottom); return g; }});
  registerAsset({ id:'prop_throne', cat:'props', label:'Trône', icon:'👑', color:0xc0a030, size:[1,2,1],
    build:(c)=>{ const g=new THREE.Group(); const seat=mkBox(0.8,0.15,0.8,c); seat.position.y=0.6; g.add(seat);
      const back=mkBox(0.8,1.4,0.15,c); back.position.set(0,1.1,-0.35); g.add(back);
      for(const [x,z] of [[-0.35,-0.35],[0.35,-0.35],[-0.35,0.35],[0.35,0.35]]){ const leg=mkBox(0.1,0.6,0.1,c); leg.position.set(x,0.3,z); g.add(leg);}
      const gem=new THREE.Mesh(new THREE.IcosahedronGeometry(0.08,0), new THREE.MeshStandardMaterial({color:0xd8384a,emissive:0x8a1a2a,emissiveIntensity:0.4})); gem.position.set(0,1.7,-0.32); g.add(gem); return g; }});
  registerAsset({ id:'prop_carpet', cat:'props', label:'Tapis', icon:'🟥', color:0x9a2a2a, size:[2,0.05,1.2],
    build:(c)=>{ const g = group(mkBox(2,0.03,1.2,c));
      const border = new THREE.Color(c).multiplyScalar(0.6).getHex();
      const inset = mkBox(1.7,0.032,0.9,border,{opacity:1}); inset.position.y=0.001; inset.castShadow=false; g.add(inset);
      const center = mkBox(1.2,0.033,0.55,c); center.position.y=0.002; center.castShadow=false; g.add(center);
      return g; }});
  registerAsset({ id:'prop_altar', cat:'props', label:'Autel', icon:'🕯️', color:0x8a8578, size:[1.4,1,0.8],
    build:(c)=>{ const g=new THREE.Group(); const base=mkBox(1.4,0.8,0.8,c); g.add(base);
      const slab=mkBox(1.6,0.15,1,c); slab.position.y=0.47; g.add(slab);
      for(const x of [-0.5,0.5]){ const candle=mkCyl(0.04,0.04,0.3,0xe8e0d0); candle.position.set(x,0.7,0); g.add(candle);
        const flame=new THREE.Mesh(new THREE.ConeGeometry(0.03,0.08,6), new THREE.MeshStandardMaterial({color:0xff8a2a,emissive:0xff5a1e,emissiveIntensity:0.9})); flame.position.set(x,0.9,0); g.add(flame);} return g; }});
  registerAsset({ id:'prop_decocrystal', cat:'props', label:'Cristal décoratif', icon:'💎', color:0x8a4ad8, size:[0.5,0.8,0.5],
    build:()=> buildCrystalAsset(0x8a4ad8, 0.8) });
  registerAsset({ id:'prop_campfire', cat:'props', label:'Feu de camp', icon:'🔥', color:0x4a3a2a, size:[0.8,0.6,0.8],
    build:()=>{ const g=new THREE.Group(); for(let i=0;i<5;i++){ const log=mkCyl(0.05,0.06,0.6,0x4a3a2a,6); log.rotation.z=Math.PI/2; log.rotation.y=i/5*Math.PI; log.position.y=0.06; g.add(log);}
      const flame=new THREE.Mesh(new THREE.ConeGeometry(0.2,0.5,8), new THREE.MeshStandardMaterial({color:0xff8a2a,emissive:0xff5a1e,emissiveIntensity:1})); flame.position.y=0.35; g.add(flame);
      const flame2=new THREE.Mesh(new THREE.ConeGeometry(0.12,0.3,8), new THREE.MeshStandardMaterial({color:0xffd020,emissive:0xffb020,emissiveIntensity:1})); flame2.position.y=0.4; g.add(flame2); return g; }});


  // ---- ÉLÉMENTS TACTIQUES ----
  registerAsset({ id:'tac_headshot', cat:'tactical', label:'Caisse headshot', icon:'🎯', color:0x8a6a3f, size:[1.2,0.9,1.2],
    build:(c)=> mkBox(1.2,0.9,1.2,c) });
  registerAsset({ id:'tac_half', cat:'tactical', label:'Half cover', icon:'◐', color:0x8a6a3f, size:[1.6,1.3,1.4],
    build:(c)=> mkBox(1.6,1.3,1.4,c) });
  registerAsset({ id:'tac_full', cat:'tactical', label:'Full cover', icon:'◼', color:0x8a6a3f, size:[1.8,2.2,1.4],
    build:(c)=> mkBox(1.8,2.2,1.4,c) });
  registerAsset({ id:'tac_peek', cat:'tactical', label:'Angle de peek', icon:'◣', color:0x9a8a6a, size:[2,2.4,0.4],
    build:(c)=>{ const w = mkBox(2,2.4,0.4,c); w.rotation.y = 0.5; return w; }});
  registerAsset({ id:'tac_divider', cat:'tactical', label:'Mur de séparation', icon:'❘', color:0x9a8a6a, size:[0.3,2.4,3],
    build:(c)=> mkBox(0.3,2.4,3,c) });
  registerAsset({ id:'tac_door', cat:'tactical', label:'Porte', icon:'🚪', color:0x5a4530, size:[1.2,2.4,0.15],
    build:(c)=> mkBox(1.2,2.4,0.15,c) });
  registerAsset({ id:'tac_window', cat:'tactical', label:'Fenêtre', icon:'🪟', color:0x9db9c9, size:[1.4,1.2,0.1],
    build:(c)=> mkBox(1.4,1.2,0.1,c,{opacity:0.5,metalness:0.1,roughness:0.1}) });
  registerAsset({ id:'tac_smokehole', cat:'tactical', label:'Smoke hole', icon:'◌', color:0x2a2a2a, size:[0.8,0.15,0.8],
    build:(c)=> mkCyl(0.4,0.4,0.15,c,16) });
  // Panneau signalétique mural stylisé AAA : cadre biseauté en léger
  // surplomb (capte l'ombre de contact) + plaque interne bombée en léger
  // retrait, gradient doux + usure peinte aux coins, vis de fixation —
  // voir l'analyse "panneau mural blanc" du brief.
  registerAsset({ id:'tac_signage_panel', cat:'tactical', label:'Panneau signalétique (AAA)', icon:'🪧', color:0xeae6da, size:[0.62,0.62,0.09],
    build:(c)=>{
      const g = new THREE.Group();
      const frameColor = 0x6b7178;
      const frame = mkBevelBox(0.62,0.62,0.05, frameColor, {bevel:0.012, roughness:0.4, metalness:0.35, map:texStylizedPanel(frameColor)});
      g.add(frame);
      const plaque = mkBevelBox(0.46,0.46,0.03, c, {bevel:0.008, roughness:0.5, metalness:0.08, map:texStylizedPanel(c, 0x8a7255)});
      plaque.position.y = frame.position.y; // recentre verticalement sur le cadre
      plaque.position.z = -0.006; // léger retrait par rapport au cadre en surplomb
      g.add(plaque);
      // motif/numéro gravé (accent ocre désaturé, cf. brief)
      const mark = mkBox(0.22,0.05,0.02,0x8a7255); mark.position.set(0,frame.position.y,0.015); g.add(mark);
      // 4 vis de fixation aux coins
      [[-0.26,-0.26],[0.26,-0.26],[-0.26,0.26],[0.26,0.26]].forEach(([bx,by])=>{
        const bolt = mkCyl(0.014,0.014,0.02,0x3a3d42,8);
        bolt.rotation.x = Math.PI/2; bolt.position.set(bx, frame.position.y+by, 0.026); g.add(bolt);
      });
      // écaillure de peinture ponctuelle sur un coin (usure géométrique, pas que texture)
      const chip = mkBox(0.05,0.04,0.052,0x3a3d42); chip.position.set(0.24,frame.position.y+0.24,0); chip.rotation.z=0.3; g.add(chip);
      return g;
    }});
  // Plaque au sol stylisée AAA : chanfrein périphérique prononcé (seul
  // élément 3D porteur de lecture vue en plongée), joint sombre encaissé,
  // rainures antidérapantes, boulons de fixation — voir l'analyse "plaque
  // au sol" du brief.
  registerAsset({ id:'tac_floor_plaque', cat:'tactical', label:'Plaque au sol (AAA)', icon:'▧', color:0xb8b0a0, size:[1.0,0.07,1.0],
    build:(c)=>{
      const g = new THREE.Group();
      // joint périphérique sombre encaissé (base légèrement plus large, visible en liseré)
      const joint = mkBox(1.06,0.02,1.06,0x5a5248); joint.castShadow=false; g.add(joint);
      // plaque avec chanfrein périphérique prononcé (capte la lumière rasante)
      const plaque = mkBevelBox(1.0,0.05,1.0, c, {bevel:0.028, bevelSegments:3, roughness:0.62, metalness:0.06, map:texStylizedPanel(c, 0x5a5248)});
      plaque.position.y += 0.02; g.add(plaque);
      // rainures antidérapantes (pattern chevron, relief très faible)
      for(let i=-2;i<=2;i++){
        const groove = mkBox(0.62,0.006,0.035,0x5a5248);
        groove.position.set(0, plaque.position.y+0.05, i*0.16);
        groove.rotation.y = 0.78; groove.castShadow=false; g.add(groove);
      }
      // boulons de fixation en périphérie
      [[-0.42,-0.42],[0.42,-0.42],[-0.42,0.42],[0.42,0.42]].forEach(([bx,bz])=>{
        const bolt = mkCyl(0.02,0.02,0.02,0x3a3d42,8);
        bolt.rotation.x = Math.PI/2; bolt.position.set(bx, plaque.position.y+0.04, bz); g.add(bolt);
      });
      return g;
    }});

  registerAsset({ id:'tac_explosive_barrel', cat:'tactical', label:'Baril explosif', icon:'🛢️', color:0xc23a2a, size:[0.6,0.9,0.6],
    build:(c)=>{
      const g = group(mkCyl(0.3,0.3,0.85,c,{roughness:0.55,metalness:0.35}));
      const band = mkCyl(0.31,0.31,0.1,0x2a2a2a,16); band.position.y=0.15; g.add(band);
      const skull = mkBox(0.22,0.22,0.02,0xf0d020); skull.position.set(0,0,0.31); g.add(skull);
      return g;
    }});
  registerAsset({ id:'tac_ammo_crate', cat:'tactical', label:'Caisse de munitions', icon:'📦', color:0x5a6a4a, size:[0.7,0.45,0.5],
    build:(c)=>{
      const g = group(mkBox(0.7,0.4,0.5,c,{roughness:0.75}));
      const lid = mkBox(0.72,0.06,0.52,new THREE.Color(c).multiplyScalar(0.8).getHex(),{roughness:0.7}); lid.position.y=0.23; g.add(lid);
      for(const sx of [-0.28,0.28]){ const clasp = mkBox(0.06,0.08,0.03,0x2a2a2a); clasp.position.set(sx,0.2,0.26); g.add(clasp); }
      return g;
    }});
  registerAsset({ id:'tac_ac_unit', cat:'tactical', label:'Générateur / climatiseur', icon:'⚙️', color:0x8a9098, size:[0.9,0.8,0.6],
    build:(c)=>{
      const g = group(mkBox(0.9,0.75,0.6,c,{metalness:0.4,roughness:0.5}));
      for(let i=0;i<3;i++){ const vent = mkBox(0.7,0.03,0.02,0x3a3d42); vent.position.set(0,0.15+i*0.12,0.31); g.add(vent); }
      const fan = mkCyl(0.16,0.16,0.05,0x2a2a2a,16); fan.rotation.x=Math.PI/2; fan.position.set(0,-0.1,0.32); g.add(fan);
      return g;
    }});
  registerAsset({ id:'tac_team_banner', cat:'tactical', label:"Banderole d'équipe", icon:'🚩', color:0xd83a3a, size:[1.0,2.2,0.06],
    build:(c)=>{
      const g = new THREE.Group();
      const pole = mkCyl(0.04,0.04,2.4,0x2a2a2a,8); pole.position.y=1.2; g.add(pole);
      const banner = mkBox(1.0,1.6,0.03,c,{roughness:0.8}); banner.position.set(0.52,1.6,0); g.add(banner);
      return g;
    }});
  registerAsset({ id:'tac_signal_cone', cat:'tactical', label:'Cône de signalisation', icon:'🔺', color:0xff7a1a, size:[0.35,0.5,0.35],
    build:(c)=>{
      // Pas de mk* pour un cône (mkCyl impose un rayon haut ET bas) — même
      // convention manuelle que mkBox/mkCyl : ombre portée + reçue,
      // origine ramenée à la base (sinon la moitié du cône passerait sous
      // le sol, ConeGeometry étant centrée par défaut).
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.2,0.5,10), new THREE.MeshStandardMaterial({ color:c, roughness:0.65 }));
      m.castShadow = true; m.receiveShadow = true; m.position.y = 0.25;
      return m;
    }});

  // ---- VERTICALITÉ ----
  registerAsset({ id:'vert_stairs', cat:'vertical', label:'Escalier', icon:'🪜', color:0x8a8378, size:[1.6,2.4,3],
    build:(c)=>{
      const g = new THREE.Group();
      const steps = 8;
      for(let i=0;i<steps;i++){
        const s = mkBox(1.6,2.4/steps,3/steps,c);
        s.position.set(0, (i+0.5)*(2.4/steps), -1.5+(i+0.5)*(3/steps));
        g.add(s);
      }
      return g;
    }});
  registerAsset({ id:'vert_ramp', cat:'vertical', label:'Rampe', icon:'📐', color:0x8a8378, size:[2,2,4.2],
    build:(c)=>{ const r = mkBox(2,0.3,4.2,c); r.rotation.x = -0.45; r.position.y = 1;
      for(let i=0;i<5;i++){ const strip=new THREE.Mesh(new THREE.BoxGeometry(1.9,0.03,0.12), new THREE.MeshStandardMaterial({color:0xf0c020,roughness:0.6}));
        strip.position.set(0, 0.165, -1.68+i*0.84); strip.castShadow=false; r.add(strip); }
      for(const sx of [-1.02,1.02]){ const rail=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.5,4.22), new THREE.MeshStandardMaterial({color:0x3a3a3a,metalness:0.4,roughness:0.5}));
        rail.position.set(sx,0.4,0); rail.castShadow=false; r.add(rail); }
      return r; }});
  registerAsset({ id:'vert_ladder', cat:'vertical', label:'Échelle', icon:'🪛', color:0x3a3a3a, size:[0.6,3,0.15],
    build:(c)=>{
      const g = new THREE.Group();
      const rail1 = mkBox(0.06,3,0.06,c); rail1.position.x=-0.25;
      const rail2 = mkBox(0.06,3,0.06,c); rail2.position.x=0.25;
      g.add(rail1, rail2);
      for(let i=0;i<7;i++){ const rung = mkBox(0.56,0.05,0.05,c); rung.position.y = 0.3+i*0.4; g.add(rung); }
      return g;
    }});
  registerAsset({ id:'vert_elevator', cat:'vertical', label:'Ascenseur', icon:'🛗', color:0x6a6a6a, size:[2,0.2,2],
    build:(c)=>{ const base = mkBox(2,0.2,2,c,{metalness:0.4});
      for(const [sx,sz] of [[-0.95,0],[0.95,0],[0,-0.95],[0,0.95]]){
        const post = mkBox(0.08,1,0.08,0x3a3a3a); post.position.set(sx,0.6,sz); post.castShadow=false; base.add(post);
      }
      const rail1 = mkBox(1.9,0.05,0.05,0x3a3a3a); rail1.position.set(0,1.08,0.95); rail1.castShadow=false; base.add(rail1);
      const rail2 = rail1.clone(); rail2.position.z=-0.95; base.add(rail2);
      const rail3 = mkBox(0.05,0.05,1.9,0x3a3a3a); rail3.position.set(0.95,1.08,0); rail3.castShadow=false; base.add(rail3);
      const panel = mkBox(0.25,0.35,0.06,0x2a2a2a); panel.position.set(-0.95,0.5,0.95); panel.castShadow=false; base.add(panel);
      const btn = new THREE.Mesh(new THREE.CircleGeometry(0.03,8), new THREE.MeshStandardMaterial({color:0xf0c020,emissive:0xf0c020,emissiveIntensity:0.6}));
      btn.position.set(-0.95,0.5,0.99); base.add(btn);
      return base; }});
  registerAsset({ id:'vert_rope', cat:'vertical', label:'Corde', icon:'🪢', color:0x8a6a3f, size:[0.08,4,0.08],
    build:(c)=> mkCyl(0.05,0.05,4,c,6) });
  registerAsset({ id:'vert_walkway', cat:'vertical', label:'Passerelle', icon:'🌉', color:0x5c6470, size:[1.6,0.15,5],
    build:(c)=>{
      const g = new THREE.Group();
      const deck = mkBox(1.6,0.15,5,c,{metalness:0.3}); g.add(deck);
      const rail1 = mkBox(0.06,0.9,5,0x3a3a3a); rail1.position.set(-0.77,0.9,0); g.add(rail1);
      const rail2 = mkBox(0.06,0.9,5,0x3a3a3a); rail2.position.set(0.77,0.9,0); g.add(rail2);
      return g;
    }});
  registerAsset({ id:'vert_balcony', cat:'vertical', label:'Balcon', icon:'🏗️', color:0xb9ac8e, size:[3,0.2,1.6],
    build:(c)=>{
      const g = new THREE.Group();
      const floor = mkBox(3,0.2,1.6,c); g.add(floor);
      const rail = mkBox(3,0.8,0.08,0x3a3a3a); rail.position.set(0,0.8,0.76); g.add(rail);
      return g;
    }});
  registerAsset({ id:'vert_access_ramp', cat:'vertical', label:"Rampe d'accès", icon:'📐', color:0x8a8a86, size:[4,1.5,3],
    build:(c)=>{
      const shape = new THREE.Shape();
      shape.moveTo(-2,0); shape.lineTo(2,0); shape.lineTo(2,1.5); shape.lineTo(-2,0);
      const ramp = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth:3, bevelEnabled:false }), new THREE.MeshStandardMaterial({ color:c, roughness:0.85 }));
      ramp.rotation.y = Math.PI/2; ramp.position.set(0,0,-1.5); ramp.castShadow=true; ramp.receiveShadow=true;
      // Bandes antidérapantes, en enfants de `ramp` (donc dans le repère
      // LOCAL du triangle avant rotation) : à x fixé, la pente extrudée le
      // long de Z garde un y constant — une bande simplement posée à
      // (x, y(x), z) tombe pile sur la surface, sans recalcul trigo.
      const stripMat = new THREE.MeshStandardMaterial({ color:0xf0c020, roughness:0.6 });
      [-1.2,-0.4,0.4,1.2].forEach(x=>{
        const y = 1.5*(x+2)/4;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15,0.03,2.8), stripMat);
        strip.position.set(x, y+0.02, 1.5); strip.castShadow=false;
        ramp.add(strip);
      });
      const g = group(ramp);
      return g;
    }});
  registerAsset({ id:'vert_platform', cat:'vertical', label:'Plateforme surélevée', icon:'🔲', color:0x6b6f76, size:[3,1.2,3],
    build:(c)=>{
      const g = group(mkBox(3,0.2,3,c,{roughness:0.8}));
      for(const [sx,sz] of [[-1.3,-1.3],[1.3,-1.3],[-1.3,1.3],[1.3,1.3]]){
        const leg = mkBox(0.18,1.2,0.18,0x3a3a3a); leg.position.set(sx,-0.6,sz); g.add(leg);
      }
      return g;
    }});
  registerAsset({ id:'vert_hatch', cat:'vertical', label:'Trappe au sol', icon:'⬜', color:0x4a4f57, size:[1.2,0.08,1.2],
    build:(c)=>{
      const g = group(mkBox(1.2,0.06,1.2,c,{metalness:0.5,roughness:0.4}));
      for(let i=1;i<4;i++){ const seam = mkBox(1.15,0.01,0.02,0x2a2e33); seam.position.set(0,0.035,-0.6+i*0.3); g.add(seam); }
      const handle = mkCyl(0.03,0.03,0.12,0x1a1a1a,8); handle.rotation.x=Math.PI/2; handle.position.set(0,0.08,0.4); g.add(handle);
      return g;
    }});
  registerAsset({ id:'vert_watchtower', cat:'vertical', label:"Tour d'observation", icon:'🗼', color:0x6b5a3f, size:[2,4.5,2],
    build:(c)=>{
      const g = new THREE.Group();
      for(const [sx,sz] of [[-0.85,-0.85],[0.85,-0.85],[-0.85,0.85],[0.85,0.85]]){
        const leg = mkBox(0.14,4.2,0.14,c,{roughness:0.85}); leg.position.set(sx,2.1,sz); g.add(leg);
      }
      const deck = mkBox(2,0.15,2,c,{roughness:0.8}); deck.position.y=4.2; g.add(deck);
      const rail = mkBox(2,0.6,0.06,0x3a3a3a);
      [[0,4.5,1],[0,4.5,-1],[1,4.5,0,Math.PI/2],[-1,4.5,0,Math.PI/2]].forEach(([px,py,pz,ry])=>{
        const r = rail.clone(); r.position.set(px,py,pz); if(ry) r.rotation.y=ry; g.add(r);
      });
      return g;
    }});

  // ---- SITES & SPAWNS ---- zones de gameplay (pas des volumes de
  // couverture) : un disque au sol + une étiquette flottante toujours
  // face caméra. Se posent et se déplacent exactement comme n'importe
  // quel autre asset (glisser-déposer, snap, inspecteur).
  registerAsset({ id:'zone_siteA', cat:'zones', label:'Site A', icon:'🅰️', color:0xff6a39, size:[9,0.1,9],
    build:(c)=> mkZonePad(4.5, c, 'A') });
  registerAsset({ id:'zone_siteB', cat:'zones', label:'Site B', icon:'🅱️', color:0xff6a39, size:[9,0.1,9],
    build:(c)=> mkZonePad(4.5, c, 'B') });
  registerAsset({ id:'zone_siteC', cat:'zones', label:'Site C', icon:'🇨', color:0xff6a39, size:[9,0.1,9],
    build:(c)=> mkZonePad(4.5, c, 'C') });
  registerAsset({ id:'zone_spawn_atk', cat:'zones', label:'Spawn Attaque', icon:'▶', color:0xff3b3b, size:[10,0.1,10],
    build:(c)=> mkZonePad(5, c, '▶', '#ff3b3b') });
  registerAsset({ id:'zone_spawn_def', cat:'zones', label:'Spawn Défense', icon:'◀', color:0x4ecdc4, size:[10,0.1,10],
    build:(c)=> mkZonePad(5, c, '◀', '#4ecdc4') });

  // ---- SOLS ---- dalles de 4×4m posables librement (snap sur la grille)
  // pour construire un vrai sol personnalisé plutôt que de dépendre du
  // sol par défaut uniforme de la scène — chacune a un motif de surface
  // distinct (joints, lattes, caillebotis...) pour rester lisible même
  // sans texture externe.
  function mkFloorTile(size, color, pattern, tex){
    const g = new THREE.Group();
    const baseMat = new THREE.MeshStandardMaterial({ color, roughness:0.85 });
    if(tex){
      // Même précaution que mkBox : cloner avant de régler .repeat, la
      // texture vient du cache partagé (voir cachedTexture) et deux
      // dalles voisines ne doivent jamais se marcher dessus visuellement.
      const t = tex.clone(); t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2,2);
      baseMat.map = t; baseMat.color.set(0xffffff);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(size,0.15,size), baseMat);
    base.position.y = 0.075; base.receiveShadow = true; base.castShadow = false;
    g.add(base);
    // Liseré clair sur le pourtour de CHAQUE dalle (4 fines bandes) — aide
    // à distinguer une dalle de la suivante une fois plusieurs posées côte
    // à côte, quel que soit le motif de surface choisi.
    const edgeColor = new THREE.Color(color).multiplyScalar(1.18).getHex();
    [[0,-size/2+0.03,'x'],[0,size/2-0.03,'x'],[-size/2+0.03,0,'z'],[size/2-0.03,0,'z']].forEach(([ex,ez,ax])=>{
      const edge = ax==='x' ? mkBox(size-0.1,0.008,0.06,edgeColor) : mkBox(0.06,0.008,size-0.1,edgeColor);
      edge.position.set(ex,0.154,ez); edge.castShadow=false;
      g.add(edge);
    });
    if(pattern==='seams'){
      // Grille de joints de dalle (lignes dans les deux directions X et Z)
      const seamColor = new THREE.Color(color).multiplyScalar(0.78).getHex();
      for(let i=1;i<4;i++){
        const lineX = mkBox(size, 0.006, 0.025, seamColor);
        lineX.position.set(0, 0.153, -size/2 + i*(size/4));
        lineX.castShadow = false;
        g.add(lineX);
        const lineZ = mkBox(0.025, 0.006, size, seamColor);
        lineZ.position.set(-size/2 + i*(size/4), 0.153, 0);
        lineZ.castShadow = false;
        g.add(lineZ);
      }
      // boulons d'ancrage aux 4 coins
      [[-size/2+0.3,-size/2+0.3],[size/2-0.3,-size/2+0.3],[-size/2+0.3,size/2-0.3],[size/2-0.3,size/2-0.3]].forEach(([bx,bz])=>{
        const bolt = mkCyl(0.05,0.05,0.02,0x3a3a3a,8);
        bolt.position.set(bx,0.161,bz); bolt.castShadow=false;
        g.add(bolt);
      });
      // fissure fine (usure)
      const crack = mkBox(0.02,0.006,size*0.4, new THREE.Color(color).multiplyScalar(0.6).getHex());
      crack.position.set(size*0.22,0.153,-size*0.15); crack.rotation.y=0.4; crack.castShadow=false;
      g.add(crack);
      // grille d'évacuation d'eau au centre
      const drain = mkCyl(0.22,0.22,0.02,0x1c1e22,16);
      drain.position.set(0,0.161,0); drain.castShadow=false;
      g.add(drain);
    }
    if(pattern==='planks'){
      for(let i=1;i<8;i++){
        const seam = mkBox(size, 0.005, 0.03, new THREE.Color(color).multiplyScalar(0.75).getHex());
        seam.position.set(0, 0.153, -size/2 + i*(size/8));
        seam.castShadow = false;
        g.add(seam);
      }
      // légère variation de teinte entre lattes, pour casser l'uniformité
      for(let i=0;i<8;i++){
        if(i%2===0) continue;
        const tint = mkBox(size, 0.152, size/8-0.03, new THREE.Color(color).multiplyScalar(0.93).getHex());
        tint.position.set(0, 0.076, -size/2 + (i+0.5)*(size/8));
        tint.castShadow = false;
        g.add(tint);
      }
      // nœuds de bois (petits ovales sombres)
      [[-0.9,-1],[1.1,0.6],[0.3,1.4]].forEach(([kx,kz])=>{
        const knot = mkCyl(0.06,0.06,0.008,new THREE.Color(color).multiplyScalar(0.55).getHex(),8);
        knot.position.set(kx,0.154,kz); knot.castShadow=false;
        g.add(knot);
      });
      // têtes de clous en ligne au centre de chaque latte
      for(let i=0;i<8;i++){
        const nail = mkCyl(0.014,0.014,0.006,0x2a2a2a,6);
        nail.position.set(-size/2+0.3,0.154,-size/2+(i+0.5)*(size/8)); nail.castShadow=false;
        g.add(nail);
      }
    }
    if(pattern==='grate'){
      base.material.color.multiplyScalar(0.9);
      for(let i=1;i<10;i++){
        const bar = mkBox(0.04,0.1,size,0x1c1e22);
        bar.position.set(-size/2+i*(size/10), 0.1, 0);
        bar.castShadow = false;
        g.add(bar);
      }
      // traverses perpendiculaires (vraie grille de caillebotis)
      for(let i=1;i<5;i++){
        const cross = mkBox(size,0.03,0.05,0x14161a);
        cross.position.set(0,0.155,-size/2+i*(size/5)); cross.castShadow=false;
        g.add(cross);
      }
      // boulons de fixation aux 4 coins + reflet métallique bas
      [[-size/2+0.25,-size/2+0.25],[size/2-0.25,size/2-0.25]].forEach(([bx,bz])=>{
        const bolt = mkCyl(0.05,0.05,0.03,0x555b62,8);
        bolt.position.set(bx,0.17,bz); bolt.castShadow=false;
        g.add(bolt);
      });
    }
    if(pattern==='tile'){
      for(let i=1;i<4;i++){
        const s1 = mkBox(size,0.005,0.025,0xffffff); s1.position.set(0,0.153,-size/2+i*(size/4)); s1.castShadow=false; g.add(s1);
        const s2 = mkBox(0.025,0.005,size,0xffffff); s2.position.set(-size/2+i*(size/4),0.153,0); s2.castShadow=false; g.add(s2);
      }
      // carreau ébréché (usure) + grille de sol centrale + léger lustre
      const chip = mkBox(0.3,0.14,0.3, new THREE.Color(color).multiplyScalar(0.85).getHex());
      chip.position.set(-size*0.25,0.005,size*0.2); chip.castShadow=false;
      g.add(chip);
      const drain2 = mkBox(0.3,0.02,0.3,0x8f9499);
      drain2.position.set(0,0.161,0); drain2.castShadow=false;
      g.add(drain2);
    }
    if(pattern==='grass'){
      // touffes d'herbe éparses (petits cônes fins), position pseudo-
      // aléatoire mais déterministe pour un rendu stable d'un chargement à l'autre
      let seed = 42;
      const rnd = ()=>{ seed = (seed*9301+49297)%233280; return seed/233280; };
      for(let i=0;i<22;i++){
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05,0.22,5), new THREE.MeshStandardMaterial({ color:new THREE.Color(color).multiplyScalar(0.7+rnd()*0.5).getHex() }));
        tuft.position.set((rnd()-0.5)*(size-0.3), 0.15+0.09, (rnd()-0.5)*(size-0.3));
        tuft.rotation.y = rnd()*Math.PI;
        tuft.castShadow = false;
        g.add(tuft);
      }
      // petites fleurs + galets épars + patch de terre nue
      for(let i=0;i<4;i++){
        const flower = new THREE.Mesh(new THREE.SphereGeometry(0.035,6,6), new THREE.MeshStandardMaterial({ color:[0xffe08a,0xffffff,0xff9ab8][i%3] }));
        flower.position.set((rnd()-0.5)*(size-0.4), 0.2, (rnd()-0.5)*(size-0.4));
        flower.castShadow = false;
        g.add(flower);
      }
      for(let i=0;i<5;i++){
        const pebble = new THREE.Mesh(new THREE.SphereGeometry(0.04+rnd()*0.03,6,5), new THREE.MeshStandardMaterial({ color:0x8a8a82 }));
        pebble.position.set((rnd()-0.5)*(size-0.3), 0.16, (rnd()-0.5)*(size-0.3));
        pebble.castShadow = false;
        g.add(pebble);
      }
      const dirt = mkCyl(0.5,0.5,0.01,0x5a4a35,10);
      dirt.position.set(size*0.2,0.156,-size*0.2); dirt.castShadow=false;
      g.add(dirt);
    }
    if(pattern==='ripples'){
      // ondulations de sable : fines bandes légèrement plus sombres, en arc
      for(let i=0;i<4;i++){
        const ripple = mkBox(size*0.75, 0.008, 0.1, new THREE.Color(color).multiplyScalar(0.85).getHex());
        ripple.position.set(0, 0.153, -size/2 + 0.5 + i*(size/4));
        ripple.rotation.y = 0.15*(i%2===0?1:-1);
        ripple.castShadow = false;
        g.add(ripple);
      }
      // coquillages + galets clairs + petit monticule
      let seed2 = 7;
      const rnd2 = ()=>{ seed2 = (seed2*9301+49297)%233280; return seed2/233280; };
      for(let i=0;i<4;i++){
        const shell = new THREE.Mesh(new THREE.ConeGeometry(0.05,0.03,6), new THREE.MeshStandardMaterial({ color:0xf0e6d2 }));
        shell.rotation.x = Math.PI/2;
        shell.position.set((rnd2()-0.5)*(size-0.4), 0.16, (rnd2()-0.5)*(size-0.4));
        shell.castShadow = false;
        g.add(shell);
      }
      const mound = mkCyl(0.4,0.6,0.1,new THREE.Color(color).multiplyScalar(1.05).getHex(),10);
      mound.position.set(-size*0.25,0.155,size*0.25); mound.castShadow=false;
      g.add(mound);
    }
    if(pattern==='dunes'){
      // sable du désert : rides de vent plus nombreuses et plus
      // resserrées que le sable de plage, pas de coquillages, une
      // dune surélevée et quelques cailloux secs épars
      for(let i=0;i<7;i++){
        const ripple = mkBox(size*0.85, 0.006, 0.07, new THREE.Color(color).multiplyScalar(0.82).getHex());
        ripple.position.set(0, 0.153, -size/2 + 0.28 + i*(size/7));
        ripple.rotation.y = 0.1*(i%2===0?1:-1);
        ripple.castShadow = false;
        g.add(ripple);
      }
      let seedDn = 19;
      const rndDn = ()=>{ seedDn = (seedDn*9301+49297)%233280; return seedDn/233280; };
      for(let i=0;i<5;i++){
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.03+rndDn()*0.02,0), new THREE.MeshStandardMaterial({ color:new THREE.Color(color).multiplyScalar(0.45+rndDn()*0.2).getHex(), roughness:1 }));
        rock.position.set((rndDn()-0.5)*(size-0.3), 0.16, (rndDn()-0.5)*(size-0.3));
        rock.rotation.set(rndDn()*Math.PI,rndDn()*Math.PI,0);
        rock.castShadow = false;
        g.add(rock);
      }
      const dune = mkCyl(0.55,0.85,0.14,new THREE.Color(color).multiplyScalar(1.06).getHex(),12);
      dune.position.set(size*0.22,0.155,-size*0.2); dune.castShadow=false;
      g.add(dune);
    }
    if(pattern==='finesand'){
      // sable fin : quasiment plat, juste une très légère ride et un
      // petit creux, pour rester "propre" sans relief marqué
      const ripple = mkBox(size*0.6, 0.004, 0.05, new THREE.Color(color).multiplyScalar(0.92).getHex());
      ripple.position.set(0, 0.153, size*0.1); ripple.rotation.y = 0.08; ripple.castShadow=false;
      g.add(ripple);
      const dimple = mkCyl(0.3,0.3,0.006,new THREE.Color(color).multiplyScalar(0.9).getHex(),16);
      dimple.position.set(-size*0.2,0.153,-size*0.18); dimple.castShadow=false;
      g.add(dimple);
    }
    if(pattern==='rockysand'){
      // sable rocailleux : sable de base + nombreux galets de tailles
      // et tons variés, densité élevée comme une plage de galets
      let seedR = 53;
      const rndR = ()=>{ seedR = (seedR*9301+49297)%233280; return seedR/233280; };
      for(let i=0;i<32;i++){
        const tone = rndR()<0.55
          ? new THREE.Color(color).multiplyScalar(0.45+rndR()*0.35).getHex()
          : new THREE.Color(0x9a958a).multiplyScalar(0.65+rndR()*0.55).getHex();
        const pebble = new THREE.Mesh(new THREE.SphereGeometry(0.03+rndR()*0.06,7,6), new THREE.MeshStandardMaterial({ color:tone, roughness:0.75 }));
        pebble.scale.y = 0.55+rndR()*0.25;
        pebble.position.set((rndR()-0.5)*(size-0.25), 0.158, (rndR()-0.5)*(size-0.25));
        pebble.rotation.y = rndR()*Math.PI;
        pebble.castShadow = false;
        g.add(pebble);
      }
    }
    if(pattern==='dirt'){
      // terre battue : petits cailloux épars + touffe d'herbe rare +
      // motte surélevée, déterministe pour un rendu stable
      let seedD = 11;
      const rndD = ()=>{ seedD = (seedD*9301+49297)%233280; return seedD/233280; };
      for(let i=0;i<10;i++){
        const pebble = new THREE.Mesh(new THREE.SphereGeometry(0.03+rndD()*0.04,6,5), new THREE.MeshStandardMaterial({ color:new THREE.Color(color).multiplyScalar(0.4+rndD()*0.3).getHex(), roughness:0.95 }));
        pebble.position.set((rndD()-0.5)*(size-0.3), 0.156, (rndD()-0.5)*(size-0.3));
        pebble.castShadow = false;
        g.add(pebble);
      }
      for(let i=0;i<3;i++){
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.035,0.14,5), new THREE.MeshStandardMaterial({ color:0x6f7f3c }));
        tuft.position.set((rndD()-0.5)*(size-0.4), 0.15+0.06, (rndD()-0.5)*(size-0.4));
        tuft.rotation.y = rndD()*Math.PI;
        tuft.castShadow = false;
        g.add(tuft);
      }
      const mound2 = mkCyl(0.35,0.45,0.03,new THREE.Color(color).multiplyScalar(1.08).getHex(),10);
      mound2.position.set(size*0.22,0.156,-size*0.22); mound2.castShadow=false;
      g.add(mound2);
    }
    if(pattern==='mud'){
      // boue : flaques (disques sombres semi-brillants légèrement en
      // creux) + éclaboussures + planche de traversée rudimentaire
      let seedM = 5;
      const rndM = ()=>{ seedM = (seedM*9301+49297)%233280; return seedM/233280; };
      [[-size*0.2,-size*0.15,0.55],[size*0.28,size*0.1,0.4],[0.05,size*0.3,0.32]].forEach(([px,pz,pr])=>{
        const puddle = new THREE.Mesh(new THREE.CylinderGeometry(pr,pr,0.012,16), new THREE.MeshStandardMaterial({ color:0x2c2418, roughness:0.15, metalness:0.05 }));
        puddle.position.set(px,0.153,pz); puddle.castShadow=false; puddle.receiveShadow=true;
        g.add(puddle);
      });
      for(let i=0;i<14;i++){
        const splat = new THREE.Mesh(new THREE.CircleGeometry(0.02+rndM()*0.04,6), new THREE.MeshStandardMaterial({ color:new THREE.Color(color).multiplyScalar(0.4).getHex(), roughness:1 }));
        splat.rotation.x = -Math.PI/2;
        splat.position.set((rndM()-0.5)*(size-0.3), 0.154, (rndM()-0.5)*(size-0.3));
        splat.castShadow = false;
        g.add(splat);
      }
      const plank = mkBox(size*0.28,0.04,0.9,0x5a4326);
      plank.position.set(-size*0.32,0,size*0.05); plank.rotation.y = 0.15; plank.castShadow=false;
      g.add(plank);
    }
    if(pattern==='crackedearth'){
      // argile craquelée : réseau de fissures en relief creux (fines
      // rainures sombres) rayonnant depuis quelques points, + éclats
      // de plaque légèrement soulevés sur les bords
      let seedC = 23;
      const rndC = ()=>{ seedC = (seedC*9301+49297)%233280; return seedC/233280; };
      for(let n=0;n<3;n++){
        let x=(rndC()-0.5)*(size-0.6), z=(rndC()-0.5)*(size-0.6), ang=rndC()*Math.PI*2;
        for(let s=0;s<5;s++){
          const len = 0.28+rndC()*0.18;
          const crack = mkBox(len,0.01,0.02, new THREE.Color(color).multiplyScalar(0.3).getHex());
          crack.position.set(x+Math.cos(ang)*len/2, 0.152, z+Math.sin(ang)*len/2);
          crack.rotation.y = -ang; crack.castShadow=false;
          g.add(crack);
          x += Math.cos(ang)*len; z += Math.sin(ang)*len; ang += (rndC()-0.5)*1.1;
        }
      }
      for(let i=0;i<3;i++){
        const flake = mkBox(0.4+rndC()*0.3,0.02,0.4+rndC()*0.3, new THREE.Color(color).multiplyScalar(1.05).getHex());
        flake.position.set((rndC()-0.5)*(size-0.6),0.16,(rndC()-0.5)*(size-0.6));
        flake.rotation.y = rndC()*Math.PI; flake.castShadow=false;
        g.add(flake);
      }
    }
    if(pattern==='graveldirt'){
      // chemin de terre caillouteux : nombreux petits galets de tons
      // gris/brun mêlés, densité plus élevée qu'un simple sol de terre
      let seedG = 71;
      const rndG = ()=>{ seedG = (seedG*9301+49297)%233280; return seedG/233280; };
      for(let i=0;i<26;i++){
        const tone = rndG()<0.5
          ? new THREE.Color(color).multiplyScalar(0.4+rndG()*0.35).getHex()
          : new THREE.Color(0x8a877e).multiplyScalar(0.7+rndG()*0.5).getHex();
        const pebble = new THREE.Mesh(new THREE.SphereGeometry(0.025+rndG()*0.05,6,5), new THREE.MeshStandardMaterial({ color:tone, roughness:0.9 }));
        pebble.position.set((rndG()-0.5)*(size-0.25), 0.157, (rndG()-0.5)*(size-0.25));
        pebble.castShadow = false;
        g.add(pebble);
      }
      const rut1 = mkBox(size*0.18,0.01,size*0.85, new THREE.Color(color).multiplyScalar(0.55).getHex());
      rut1.position.set(-size*0.22,0.153,0); rut1.castShadow=false;
      g.add(rut1);
      const rut2 = mkBox(size*0.18,0.01,size*0.85, new THREE.Color(color).multiplyScalar(0.55).getHex());
      rut2.position.set(size*0.22,0.153,0); rut2.castShadow=false;
      g.add(rut2);
    }
    if(pattern==='pave'){
      // pavés : petits blocs légèrement surélevés en quinconce, hauteur
      // et teinte individuelles variables pour un vrai relief de pavage
      // (pas juste une texture plate), + quelques mauvaises herbes dans
      // les joints et un pavé descellé pour l'usure
      let seedP = 31;
      const rndP = ()=>{ seedP = (seedP*9301+49297)%233280; return seedP/233280; };
      const cols = 6, rows = 6, cw = size/cols, ch = size/rows;
      for(let row=0; row<rows; row++){
        const offset = (row%2===0) ? 0 : cw/2;
        for(let col=-1; col<cols; col++){
          const px = -size/2 + (col+0.5)*cw + offset;
          const pz = -size/2 + (row+0.5)*ch;
          if(px < -size/2+0.05 || px > size/2-0.05) continue;
          const stoneH = 0.04 + rndP()*0.03;
          const tint = new THREE.Color(color).multiplyScalar(0.82+rndP()*0.36).getHex();
          const stone = mkBox(cw-0.06+(rndP()-0.5)*0.03, stoneH, ch-0.06+(rndP()-0.5)*0.03, tint, {roughness:0.9});
          stone.position.set(px, 0.15+stoneH/2, pz);
          stone.rotation.y = (rndP()-0.5)*0.05;
          stone.castShadow = true; stone.receiveShadow = true;
          g.add(stone);
        }
      }
      for(let i=0;i<4;i++){
        const weed = new THREE.Mesh(new THREE.ConeGeometry(0.025,0.1,5), new THREE.MeshStandardMaterial({ color:0x5c7a34 }));
        weed.position.set((rndP()-0.5)*(size-0.3), 0.15+0.19+0.03, (rndP()-0.5)*(size-0.3));
        weed.rotation.y = rndP()*Math.PI;
        weed.castShadow = false;
        g.add(weed);
      }
    }
    if(pattern==='snow'){
      // neige : monticule doux + quelques empreintes de pas (creux peu
      // profonds, en paire alternée façon trace de passage)
      const drift = mkCyl(0.5,0.7,0.08,new THREE.Color(color).multiplyScalar(1.03).getHex(),12);
      drift.position.set(-size*0.22,0.155,size*0.2); drift.castShadow=false;
      g.add(drift);
      let seedSn = 41;
      const rndSn = ()=>{ seedSn = (seedSn*9301+49297)%233280; return seedSn/233280; };
      let fx = -size*0.3, fz = -size*0.35, fang = 0.4;
      for(let i=0;i<5;i++){
        const step = new THREE.Mesh(new THREE.CircleGeometry(0.09,10), new THREE.MeshStandardMaterial({ color:new THREE.Color(color).multiplyScalar(0.8).getHex(), roughness:1 }));
        step.rotation.x=-Math.PI/2;
        step.position.set(fx + (i%2===0?0.08:-0.08), 0.153, fz);
        step.castShadow=false;
        g.add(step);
        fx += Math.cos(fang)*0.32; fz += Math.sin(fang)*0.32+0.2;
      }
      void rndSn;
    }
    if(pattern==='ice'){
      // glace : flaque gelée légèrement bombée et brillante au centre +
      // arête de fracture surélevée (plaque de glace qui a un peu bougé)
      const puddle = mkCyl(0.9,0.9,0.02,new THREE.Color(color).multiplyScalar(1.08).getHex(),16);
      puddle.position.set(0,0.153,0); puddle.castShadow=false;
      puddle.material.roughness = 0.08; puddle.material.metalness = 0.05;
      g.add(puddle);
      const ridge = mkBox(size*0.7,0.03,0.06, new THREE.Color(color).multiplyScalar(1.1).getHex());
      ridge.position.set(size*0.05,0.16,-size*0.15); ridge.rotation.y=0.5; ridge.castShadow=false;
      g.add(ridge);
    }
    return g;
  }
  registerAsset({ id:'floor_concrete', cat:'floors', label:'Sol béton', icon:'◻️', color:0x6e6e6a, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'seams',texConcrete(c)) });
  registerAsset({ id:'floor_snow', cat:'floors', label:'Sol neige', icon:'⬜', color:0xf2f5f8, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'snow',texSnowFloor(c)) });
  registerAsset({ id:'floor_ice', cat:'floors', label:'Sol glace', icon:'🧊', color:0xbfe0e8, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'ice',texIceFloor(c)) });
  registerAsset({ id:'floor_pave', cat:'floors', label:'Sol pavé', icon:'🧱', color:0x9a978d, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'pave',texPaveFloor(c)) });
  registerAsset({ id:'floor_wood', cat:'floors', label:'Sol bois', icon:'🟫', color:0x8a6a3f, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'planks',texWoodFloor(c)) });
  registerAsset({ id:'floor_metal', cat:'floors', label:'Caillebotis', icon:'▦', color:0x5c6470, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'grate',texMetalFloor(c)) });
  registerAsset({ id:'floor_grass', cat:'floors', label:'Sol herbe', icon:'🟩', color:0x4f7a3a, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'grass',texGrassFloor(c)) });
  registerAsset({ id:'floor_sand', cat:'floors', label:'Sable de plage', icon:'🟨', color:0xd4b485, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'ripples',texSandFloor(c)) });
  registerAsset({ id:'floor_sand_desert', cat:'floors', label:'Sable du désert', icon:'🏜️', color:0xd9a35c, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'dunes',texDesertSandFloor(c)) });
  registerAsset({ id:'floor_sand_fine', cat:'floors', label:'Sable fin clair', icon:'⬜', color:0xe6d9b8, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'finesand',texFineSandFloor(c)) });
  registerAsset({ id:'floor_sand_rocky', cat:'floors', label:'Sable rocailleux', icon:'🪨', color:0xb8a988, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'rockysand',texRockySandFloor(c)) });
  registerAsset({ id:'floor_tile', cat:'floors', label:'Carrelage', icon:'⬜', color:0xc9c2b0, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'tile',texTileFloor(c)) });
  // ---- Sols "terre" (mode terre) ----
  registerAsset({ id:'floor_dirt', cat:'floors', label:'Sol terre battue', icon:'🟤', color:0x7a5c3e, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'dirt',texDirtFloor(c)) });
  registerAsset({ id:'floor_mud', cat:'floors', label:'Sol boueux', icon:'🟫', color:0x4a3b28, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'mud',texMudFloor(c)) });
  registerAsset({ id:'floor_cracked_earth', cat:'floors', label:'Terre craquelée', icon:'🟠', color:0xc79a5f, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'crackedearth',texCrackedEarthFloor(c)) });
  registerAsset({ id:'floor_gravel_dirt', cat:'floors', label:'Chemin de terre', icon:'🟥', color:0x8a6b46, size:[4,0.15,4],
    build:(c)=> mkFloorTile(4,c,'graveldirt',texGravelDirtFloor(c)) });

  // ---- Vent : léger balancement des feuillages (utilisé par les assets
  // Nature ci-dessus, ex. buildTreeAsset) — appartenait à l'origine à la
  // scène de l'éditeur (2. SCÈNE / RENDU) mais est appelé DEPUIS des
  // build() de cette bibliothèque (arbres/plantes), donc doit vivre ici
  // pour rester utilisable par les moteurs de match aussi. updateSway
  // doit être appelée depuis la boucle de rendu de l'appelant (voir
  // map_editor.html) pour faire réellement bouger les objets enregistrés.
  const swayingObjects = [];
  function addSway(obj, amp=0.06, speed=1.4){
    obj.userData._swayPhase = Math.random()*Math.PI*2;
    obj.userData._swayAmp = amp;
    obj.userData._swaySpeed = speed;
    obj.userData._swayBaseRotZ = obj.rotation.z;
    swayingObjects.push(obj);
  }
  function updateSway(elapsed){
    for(let i=swayingObjects.length-1;i>=0;i--){
      const o = swayingObjects[i];
      if(!o.parent){ swayingObjects.splice(i,1); continue; } // objet supprimé entretemps
      o.rotation.z = o.userData._swayBaseRotZ + Math.sin(elapsed*o.userData._swaySpeed + o.userData._swayPhase)*o.userData._swayAmp;
    }
  }

  return {
ASSETS, ASSET_CATS, ASSET_SUBCATS, BIOME_ASSET_DEFS, addModularPlinth, addSeams, addSway, addVignette, addWindowGrid, buildBridgeSpan, buildCrystalAsset, buildGroundPatch, buildRock, buildRockAsset, buildSimpleHouse, buildTower, buildTreeAsset, buildWaterPatch, cachedTexture, group, hueJitter, mkBevelBox, mkBox, mkCyl, mkFloorTile, mkRepeatTex, mkTextSprite, mkZonePad, registerAsset, swayingObjects, texBamboo, texBrick, texChainlink, texConcrete, texCopper, texCorrugated, texCrackedEarthFloor, texDesertSandFloor, texDirtFloor, texFineSandFloor, texGlassCurtain, texGranite, texGrassFloor, texGravelDirtFloor, texIceFloor, texMarble, texMetalFloor, texMudFloor, texObsidian, texPaveFloor, texRockySandFloor, texRuins, texRust, texSandFloor, texSnowFloor, texStoneBlock, texStuc, texStylizedPanel, texTemple, texTileFloor, texWoodFloor, updateSway,
  };
})();
