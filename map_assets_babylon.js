// map_assets_babylon.js — Portage Babylon.js de map_assets.js (Three.js r128).
// Bibliothèque d'assets 3D partagée entre l'éditeur de carte
// (map_editor.html) et les moteurs de match 3D. Voir le plan de migration
// (Phase 1) : même contrat public que l'original (window.MapAssets.ASSETS
// etc.), chaque build(color) retourne maintenant un BABYLON.TransformNode
// (équivalent du THREE.Group) au lieu d'un THREE.Group. Nécessite qu'un
// BABYLON.Scene existant soit passé à window.MapAssets.init(scene) AVANT
// le premier appel à build() — les générateurs de textures/matériaux ont
// besoin d'une scène Babylon (contrairement à Three.js où les objets
// géométrie/texture sont scene-agnostic).
//
// Simplifications assumées pour cette Phase 1 (portage fidèle du
// comportement, PAS encore la passe de réalisme visuel — voir Phase 4
// du plan) :
//  - mkBevelBox : le biseau géométrique réel (THREE.ExtrudeGeometry avec
//    bevelEnabled) est remplacé par une boîte simple (BABYLON.MeshBuilder.
//    CreateBox). Babylon n'a pas d'équivalent direct pour un biseau
//    d'arêtes géométrique sur les 3 axes ; à reconstruire proprement en
//    Phase 4 si l'effet visuel manque.
//  - roughness/metalness (MeshStandardMaterial) : conservés comme
//    métadonnées sur le matériau (mat.metadata) mais pas encore appliqués
//    via PBRMaterial — StandardMaterial est utilisé pour rester cohérent
//    avec l'éclairage actuel (Hemispheric+Directional, sans environment
//    map). Le passage à PBRMaterial + IBL est prévu en Phase 4.
window.MapAssets = (function(){
  "use strict";

  let _scene = null;
  function init(scene){ _scene = scene; }
  // Environnement (IBL) minimal pour que les PBRMaterial (écorce/feuillage,
  // voir mkPbrMat plus bas) ne paraissent pas plus ternes que l'ancien
  // StandardMaterial sous éclairage direct seul — PBRMaterial calcule sa
  // réponse spéculaire/Fresnel à partir de cet environnement, pas des
  // lumières de la scène. Optionnel et idempotent : à appeler UNE FOIS
  // après init(scene) par les consommateurs qui utilisent des assets
  // PBR (aucun effet sur les nombreux StandardMaterial du reste de la
  // bibliothèque, qui n'en ont pas besoin). N'écrase jamais un
  // environnement déjà posé par l'appelant.
  function ensureDefaultEnvironment(scene){
    scene = scene || _scene;
    if(!scene || scene.environmentTexture) return scene && scene.environmentTexture;
    const env = BABYLON.CubeTexture.CreateFromPrefilteredData(
      'https://assets.babylonjs.com/environments/environmentSpecular.env', scene
    );
    scene.environmentTexture = env;
    scene.environmentIntensity = 0.7; // discret : ne doit pas dominer le soleil/l'hémisphérique déjà en place dans les scènes existantes
    return env;
  }

  /* ============================================================
     1. REGISTRE D'ASSETS — chaque asset est une fonction génératrice qui
     retourne un BABYLON.TransformNode prêt à être cloné dans la scène,
     plus des métadonnées (catégorie, icône de palette, couleur par
     défaut, dimensions de base). Tout est procédural (boîtes/cylindres) —
     aucun asset externe requis.
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
  const ASSET_SUBCATS = {
    concrete: { label:'Modulaire — Béton' },
    steel: { label:'Modulaire — Acier' },
    lab: { label:'Modulaire — Laboratoire' },
    industrial: { label:'Modulaire — Industriel' },
    military: { label:'Modulaire — Militaire' },
    futuristic: { label:'Modulaire — Futuriste' },
  };

  /* ============================================================
     COULEUR — Babylon.Color3 n'a pas getHSL/setHSL comme THREE.Color ;
     on réimplémente la conversion HSL standard nous-mêmes pour que
     hueJitter garde EXACTEMENT le même comportement (teinte/saturation/
     LUMINOSITÉ, pas HSV) qu'avec Three.js.
     ============================================================ */
  function hexIntToColor3(hex){
    if(hex instanceof BABYLON.Color3) return hex;
    return BABYLON.Color3.FromHexString('#'+(hex>>>0).toString(16).padStart(6,'0'));
  }
  function color3ToHexInt(c){
    const r = Math.round(Math.max(0,Math.min(1,c.r))*255);
    const g = Math.round(Math.max(0,Math.min(1,c.g))*255);
    const b = Math.round(Math.max(0,Math.min(1,c.b))*255);
    return (r<<16)|(g<<8)|b;
  }
  // Correctif : BABYLON.Color3.toHexString() natif ne clampe PAS ses canaux
  // à [0,1] avant conversion — contrairement à THREE.Color.getHexString(),
  // qui clampait implicitement. Un simple `.scale(f>1)` (fréquent dans les
  // générateurs de texture ci-dessous, ex. surbrillance haut/bas d'un
  // dégradé) peut donc produire une chaîne hex invalide de plus de 6
  // caractères, qui fait planter ctx.fillStyle/addColorStop. Ce correctif
  // restaure le comportement équivalent à Three.js — sans impact quand les
  // canaux sont déjà dans les bornes (délègue alors à l'implémentation
  // d'origine).
  (function patchColor3ToHexStringClamping(){
    const orig = BABYLON.Color3.prototype.toHexString;
    BABYLON.Color3.prototype.toHexString = function(){
      const r = Math.max(0, Math.min(1, this.r));
      const g = Math.max(0, Math.min(1, this.g));
      const b = Math.max(0, Math.min(1, this.b));
      if(r===this.r && g===this.g && b===this.b) return orig.call(this);
      return orig.call(new BABYLON.Color3(r,g,b));
    };
  })();
  // Correctif : BABYLON.StandardMaterial met son specularColor à BLANC PUR
  // (1,1,1) par défaut — contrairement à THREE.MeshStandardMaterial (PBR-ish,
  // pas de reflet spéculaire dur par défaut). Les ~157 StandardMaterial
  // construits directement dans ce fichier (hors mkBox/mkCyl, déjà en
  // PBRMaterial depuis la Phase 4) n'ont jamais réglé specularColor —
  // resucée en Babylon : reflet blanc dur et brillant sous soleil direct,
  // au point de blanchir toute une face exposée (ex. pyramides).
  // `BABYLON.StandardMaterial` est un accesseur en lecture seule (binding
  // de module ES figé par le bundle UMD) : le réassigner échoue
  // silencieusement en mode non-strict et LÈVE une exception en mode
  // strict — ce qui a cassé tout ce module la première fois (assignation
  // tentée ci-dessous initialement). Solution : un helper `mkStdMat()`
  // explicite (voir plus bas, juste avant son premier usage) que TOUS les
  // sites de construction directe de StandardMaterial appellent désormais,
  // plutôt que `new BABYLON.StandardMaterial(...)` — jamais écrasé si un
  // site d'appel règle explicitement specularColor après coup.
  function mkStdMat(name, scene){
    const m = new BABYLON.StandardMaterial(name, scene);
    m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    return m;
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
    else{
      const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
      const q = l<0.5 ? l*(1+s) : l+s-l*s;
      const p = 2*l-q;
      r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3);
    }
    return new BABYLON.Color3(r,g,b);
  }
  // Variation organique de teinte (pas seulement de luminosité) : les
  // matériaux naturels (terre, herbe, sable, bois) ne sont jamais
  // uniformément plus clairs/sombres, leur teinte dérive aussi un peu —
  // ça évite l'effet "photocopie" d'un .scale() seul.
  function hueJitter(colorIn, hueAmt=0.02, satAmt=0.12, lightAmt=0.16){
    const color = hexIntToColor3(colorIn);
    const hsl = colorToHSL(color);
    return hslToColor3(
      hsl.h + (Math.random()-0.5)*hueAmt,
      Math.max(0,Math.min(1, hsl.s + (Math.random()-0.5)*satAmt)),
      Math.max(0,Math.min(1, hsl.l + (Math.random()-0.5)*lightAmt))
    );
  }

  /* ============================================================
     GÉNÉRATEURS DE TEXTURES PROCÉDURALES (canvas -> DynamicTexture) — pour
     de vraies surfaces texturées au lieu de simples aplats de couleur.
     Mises en cache par (type+couleur) : générées une seule fois puis
     réutilisées sur tous les exemplaires du même asset.
     IMPORTANT (piège Babylon vérifié empiriquement) : un DynamicTexture
     construit à partir d'un <canvas> externe déjà dessiné reste "not
     ready"/invisible tant qu'on n'appelle pas .update() une fois après
     construction — TOUJOURS appeler wrapCanvasTexture() plutôt que
     `new BABYLON.DynamicTexture(...)` directement.
     ============================================================ */
  const _texCache = {};
  function cachedTexture(key, generator){
    if(!_texCache[key]) _texCache[key] = generator();
    return _texCache[key];
  }
  function wrapCanvasTexture(key, canvasEl){
    const tex = new BABYLON.DynamicTexture(key, canvasEl, _scene, true);
    tex.update(); // requis : sans ça la texture ne s'affiche jamais (voir note ci-dessus)
    return tex;
  }
  function mkRepeatTex(tex, rx, ry){
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = rx; tex.vScale = ry;
    return tex;
  }
  function addVignette(ctx, size, strength=0.16){
    const grad = ctx.createRadialGradient(size/2,size/2,size*0.15,size/2,size/2,size*0.72);
    grad.addColorStop(0,'rgba(0,0,0,0)');
    grad.addColorStop(1,'rgba(0,0,0,'+strength+')');
    ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
  }

  // Béton/crépi : grain moucheté + coulures verticales discrètes
  function texConcrete(baseHex){
    return cachedTexture('concrete_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<2200;i++){
        const shade = base.scale(0.82+Math.random()*0.34);
        ctx.globalAlpha = 0.12+Math.random()*0.18;
        ctx.fillStyle = shade.toHexString();
        const s=1+Math.random()*2.2;
        ctx.fillRect(Math.random()*256,Math.random()*256,s,s);
      }
      ctx.globalAlpha=1;
      for(let i=0;i<6;i++){
        ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth=2+Math.random()*3;
        ctx.beginPath(); const x=Math.random()*256;
        ctx.moveTo(x,0); ctx.lineTo(x+(Math.random()-0.5)*24,256); ctx.stroke();
      }
      for(let i=0;i<3500;i++){
        ctx.globalAlpha = 0.05+Math.random()*0.06;
        ctx.fillStyle = Math.random()<0.5 ? '#000' : '#fff';
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.14);
      return wrapCanvasTexture('concrete_'+baseHex, cv);
    });
  }
  // Brique : rangs décalés + joints de mortier clairs
  function texBrick(baseHex){
    return cachedTexture('brick_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = '#c9c2b0'; ctx.fillRect(0,0,256,256);
      const bw=32, bh=14, gap=3;
      for(let row=0; row*bh<256+bh; row++){
        const offset = (row%2===0) ? 0 : bw/2;
        for(let col=-1; col*bw<256+bw; col++){
          const shade = base.scale(0.85+Math.random()*0.3);
          ctx.fillStyle = shade.toHexString();
          ctx.fillRect(col*bw+offset+gap/2, row*bh+gap/2, bw-gap, bh-gap);
        }
      }
      return wrapCanvasTexture('brick_'+baseHex, cv);
    });
  }
  function texCorrugated(baseHex){
    return cachedTexture('corrugated_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=512; cv.height=128;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      for(let x=0;x<256;x+=8){
        const shade = base.scale(x%16===0 ? 0.78 : 1.12);
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(x,0,8,64);
      }
      return wrapCanvasTexture('corrugated_'+baseHex, cv);
    });
  }
  function texGlassCurtain(baseHex){
    return cachedTexture('glass_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const grad = ctx.createLinearGradient(0,0,256,256);
      const base = hexIntToColor3(baseHex);
      grad.addColorStop(0, base.scale(1.25).toHexString());
      grad.addColorStop(0.5, base.toHexString());
      grad.addColorStop(1, base.scale(0.8).toHexString());
      ctx.fillStyle = grad; ctx.fillRect(0,0,256,256);
      ctx.strokeStyle = 'rgba(20,25,30,0.5)'; ctx.lineWidth=3;
      for(let i=0;i<=8;i++){ ctx.beginPath(); ctx.moveTo(i*32,0); ctx.lineTo(i*32,256); ctx.stroke(); }
      for(let i=0;i<=8;i++){ ctx.beginPath(); ctx.moveTo(0,i*32); ctx.lineTo(256,i*32); ctx.stroke(); }
      return wrapCanvasTexture('glass_'+baseHex, cv);
    });
  }
  function texStuc(baseHex){
    return cachedTexture('stuc_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth=2;
      for(let y=0;y<256;y+=42){
        const offset = (y/42)%2===0 ? 0 : 30;
        for(let x=-30;x<256+60;x+=60){
          ctx.strokeRect(x+offset,y,60,42);
        }
      }
      for(let i=0;i<600;i++){
        const shade = base.scale(0.9+Math.random()*0.2);
        ctx.globalAlpha=0.1; ctx.fillStyle=shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,2,2);
      }
      ctx.globalAlpha=1;
      return wrapCanvasTexture('stuc_'+baseHex, cv);
    });
  }
  function texWoodFloor(baseHex){
    return cachedTexture('woodfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      for(let row=0;row<8;row++){
        const shade = hueJitter(base, 0.015, 0.08, 0.2);
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(0,row*32,256,32);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(0,row*32); ctx.lineTo(256,row*32); ctx.stroke();
        for(let i=0;i<9;i++){
          ctx.strokeStyle = 'rgba(0,0,0,'+(0.04+Math.random()*0.08)+')'; ctx.lineWidth=0.4+Math.random()*0.8;
          ctx.beginPath(); const y=row*32+2+Math.random()*28;
          ctx.moveTo(0,y); ctx.bezierCurveTo(80,y+(Math.random()-0.5)*8,180,y+(Math.random()-0.5)*8,256,y); ctx.stroke();
        }
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
      return wrapCanvasTexture('woodfloor_'+baseHex, cv);
    });
  }
  function texGrassFloor(baseHex){
    return cachedTexture('grassfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<26;i++){
        const patch = hueJitter(base, 0.03, 0.15, 0.12);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = patch.toHexString();
        const r = 14+Math.random()*22;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.7,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<4000;i++){
        const shade = base.scale(0.7+Math.random()*0.55);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1.5,1.5);
      }
      for(let i=0;i<900;i++){
        const shade = base.scale(0.55+Math.random()*0.7);
        ctx.strokeStyle = shade.toHexString();
        ctx.globalAlpha = 0.4+Math.random()*0.3;
        ctx.lineWidth = 0.6;
        const x=Math.random()*256, y=Math.random()*256, len=2+Math.random()*3, ang=Math.random()*Math.PI;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+Math.cos(ang)*len,y-Math.sin(ang)*len); ctx.stroke();
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.16);
      return wrapCanvasTexture('grassfloor_'+baseHex, cv);
    });
  }
  function texSandFloor(baseHex){
    return cachedTexture('sandfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<3000;i++){
        const shade = base.scale(0.85+Math.random()*0.3);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      for(let i=0;i<10;i++){
        ctx.strokeStyle = 'rgba(0,0,0,0.04)'; ctx.lineWidth=3+Math.random()*3;
        ctx.beginPath(); const y=Math.random()*256;
        ctx.moveTo(0,y); ctx.bezierCurveTo(85,y+10,170,y-10,256,y); ctx.stroke();
      }
      for(let i=0;i<80;i++){
        const shade = base.scale(0.55+Math.random()*0.3);
        ctx.fillStyle = shade.toHexString();
        ctx.globalAlpha = 0.5;
        ctx.fillRect(Math.random()*256,Math.random()*256,1.5+Math.random()*1.5,1.5+Math.random()*1.5);
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.13);
      return wrapCanvasTexture('sandfloor_'+baseHex, cv);
    });
  }
  function texDesertSandFloor(baseHex){
    return cachedTexture('desertsand_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<16;i++){
        const patch = hueJitter(base, 0.02, 0.15, 0.18);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = patch.toHexString();
        const r = 20+Math.random()*30;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.5,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<2800;i++){
        const shade = base.scale(0.82+Math.random()*0.32);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
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
      return wrapCanvasTexture('desertsand_'+baseHex, cv);
    });
  }
  function texFineSandFloor(baseHex){
    return cachedTexture('finesand_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<5000;i++){
        const shade = base.scale(0.92+Math.random()*0.16);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      for(let i=0;i<4;i++){
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = '#000';
        const r = 8+Math.random()*6;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.6,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.1);
      return wrapCanvasTexture('finesand_'+baseHex, cv);
    });
  }
  function texRockySandFloor(baseHex){
    return cachedTexture('rockysand_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<2600;i++){
        const shade = base.scale(0.8+Math.random()*0.35);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      for(let i=0;i<95;i++){
        const x=Math.random()*256, y=Math.random()*256, r=1.5+Math.random()*4.5;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath(); ctx.ellipse(x+0.8,y+1,r*1.05,r*0.8,0,0,Math.PI*2); ctx.fill();
        const tone = Math.random()<0.6
          ? base.scale(0.55+Math.random()*0.4)
          : hexIntToColor3(0x9a958a).scale(0.7+Math.random()*0.5);
        ctx.fillStyle = tone.toHexString();
        ctx.beginPath(); ctx.ellipse(x,y,r,r*0.8,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth=0.6;
        ctx.beginPath(); ctx.ellipse(x-r*0.25,y-r*0.25,r*0.4,r*0.25,0,0,Math.PI*2); ctx.stroke();
      }
      addVignette(ctx,256,0.16);
      return wrapCanvasTexture('rockysand_'+baseHex, cv);
    });
  }
  function texTileFloor(baseHex){
    return cachedTexture('tilefloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      const grad = ctx.createLinearGradient(0,0,256,256);
      grad.addColorStop(0,'rgba(255,255,255,0.12)'); grad.addColorStop(1,'rgba(0,0,0,0.05)');
      ctx.fillStyle = grad; ctx.fillRect(0,0,256,256);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth=2.5;
      for(let i=0;i<=4;i++){ ctx.beginPath(); ctx.moveTo(i*64,0); ctx.lineTo(i*64,256); ctx.stroke(); }
      for(let i=0;i<=4;i++){ ctx.beginPath(); ctx.moveTo(0,i*64); ctx.lineTo(256,i*64); ctx.stroke(); }
      for(let i=0;i<5;i++){
        ctx.globalAlpha = 0.06+Math.random()*0.06;
        ctx.fillStyle = '#000';
        const r = 6+Math.random()*10;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.6,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.1);
      return wrapCanvasTexture('tilefloor_'+baseHex, cv);
    });
  }
  function texMetalFloor(baseHex){
    return cachedTexture('metalfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.scale(0.85).toHexString(); ctx.fillRect(0,0,256,256);
      for(let x=0;x<256;x+=16){
        const shade = base.scale(x%32===0 ? 1.3 : 0.75);
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(x,0,4,256);
      }
      for(let y=0;y<256;y+=16){
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0,y,256,3);
      }
      for(let i=0;i<220;i++){
        ctx.globalAlpha = 0.08+Math.random()*0.12;
        ctx.fillStyle = Math.random()<0.6 ? '#8a4a24' : '#000';
        ctx.fillRect(Math.random()*256,Math.random()*256,1+Math.random()*2,1+Math.random()*2);
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.18);
      return wrapCanvasTexture('metalfloor_'+baseHex, cv);
    });
  }
  function texDirtFloor(baseHex){
    return cachedTexture('dirtfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<34;i++){
        const patch = hueJitter(base, 0.02, 0.18, 0.2);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = patch.toHexString();
        const r = 10+Math.random()*20;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*(0.6+Math.random()*0.4),Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<3800;i++){
        const shade = base.scale(0.65+Math.random()*0.6);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1+Math.random(),1+Math.random());
      }
      ctx.globalAlpha=1;
      for(let i=0;i<40;i++){
        const shade = base.scale(0.35+Math.random()*0.25);
        ctx.fillStyle = shade.toHexString();
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,1+Math.random()*1.8,1+Math.random()*1.3,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      for(let i=0;i<7;i++){
        ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth=0.8+Math.random();
        let x=Math.random()*256,y=Math.random()*256; ctx.beginPath(); ctx.moveTo(x,y);
        for(let s=0;s<4;s++){ x+=(Math.random()-0.5)*40; y+=(Math.random()-0.5)*40; ctx.lineTo(x,y); }
        ctx.stroke();
      }
      addVignette(ctx,256,0.18);
      return wrapCanvasTexture('dirtfloor_'+baseHex, cv);
    });
  }
  function texMudFloor(baseHex){
    return cachedTexture('mudfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.scale(0.8).toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<24;i++){
        const patch = base.scale(0.55+Math.random()*0.5);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = patch.toHexString();
        const r = 16+Math.random()*26;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.65,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<2600;i++){
        const shade = base.scale(0.55+Math.random()*0.55);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1.3,1.3);
      }
      ctx.globalAlpha=1;
      for(let i=0;i<5;i++){
        const px=Math.random()*256, py=Math.random()*256, pr=8+Math.random()*16;
        ctx.fillStyle = 'rgba(10,12,10,0.45)';
        ctx.beginPath(); ctx.ellipse(px,py,pr,pr*0.55,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.ellipse(px-pr*0.2,py-pr*0.15,pr*0.35,pr*0.16,0.4,0,Math.PI*2); ctx.fill();
      }
      addVignette(ctx,256,0.2);
      return wrapCanvasTexture('mudfloor_'+baseHex, cv);
    });
  }
  function texCrackedEarthFloor(baseHex){
    return cachedTexture('crackedearth_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<20;i++){
        const patch = hueJitter(base, 0.015, 0.12, 0.14);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = patch.toHexString();
        const r = 14+Math.random()*22;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.7,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<2800;i++){
        const shade = base.scale(0.75+Math.random()*0.4);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
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
      addVignette(ctx,256,0.15);
      return wrapCanvasTexture('crackedearth_'+baseHex, cv);
    });
  }
  function texGravelDirtFloor(baseHex){
    return cachedTexture('graveldirt_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<28;i++){
        const patch = hueJitter(base, 0.02, 0.15, 0.18);
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = patch.toHexString();
        const r = 12+Math.random()*18;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.7,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<3200;i++){
        const shade = base.scale(0.65+Math.random()*0.55);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1+Math.random(),1+Math.random());
      }
      ctx.globalAlpha=1;
      for(let i=0;i<130;i++){
        const x=Math.random()*256, y=Math.random()*256, r=1.2+Math.random()*2.6;
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.ellipse(x+0.7,y+0.9,r*1.05,r*0.85,0,0,Math.PI*2); ctx.fill();
        const tone = Math.random()<0.5
          ? base.scale(0.5+Math.random()*0.3)
          : hexIntToColor3(0x8a877e).scale(0.7+Math.random()*0.5);
        ctx.fillStyle = tone.toHexString();
        ctx.beginPath(); ctx.ellipse(x,y,r,r*0.85,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      addVignette(ctx,256,0.17);
      return wrapCanvasTexture('graveldirt_'+baseHex, cv);
    });
  }
  function texPaveFloor(baseHex){
    return cachedTexture('pavefloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.scale(0.45).toHexString();
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
          ctx.fillStyle = stone.toHexString();
          ctx.beginPath();
          if(ctx.roundRect) ctx.roundRect(x,y,w,h,2); else ctx.rect(x,y,w,h);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth=1.4;
          ctx.beginPath(); ctx.moveTo(x+1,y+h-1); ctx.lineTo(x+1,y+1); ctx.lineTo(x+w-1,y+1); ctx.stroke();
          ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth=1.4;
          ctx.beginPath(); ctx.moveTo(x+w-1,y+1); ctx.lineTo(x+w-1,y+h-1); ctx.lineTo(x+1,y+h-1); ctx.stroke();
          for(let g=0;g<10;g++){
            ctx.globalAlpha = 0.08+Math.random()*0.1;
            ctx.fillStyle = Math.random()<0.5 ? '#000' : '#fff';
            ctx.fillRect(x+Math.random()*w, y+Math.random()*h, 1, 1);
          }
          ctx.globalAlpha=1;
        }
      }
      addVignette(ctx,256,0.16);
      return wrapCanvasTexture('pavefloor_'+baseHex, cv);
    });
  }
  function texSnowFloor(baseHex){
    return cachedTexture('snowfloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<20;i++){
        const patch = base.scale(0.94+Math.random()*0.12);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = patch.toHexString();
        const r = 18+Math.random()*26;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.65,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<3500;i++){
        const shade = base.scale(0.9+Math.random()*0.2);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      for(let i=0;i<8;i++){
        ctx.globalAlpha = 0.05+Math.random()*0.05;
        ctx.fillStyle = '#2a5ca0';
        const r = 12+Math.random()*16;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.5,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      for(let i=0;i<60;i++){
        ctx.globalAlpha = 0.4+Math.random()*0.4;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.random()*256,Math.random()*256,1,1);
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.1);
      return wrapCanvasTexture('snowfloor_'+baseHex, cv);
    });
  }
  function texIceFloor(baseHex){
    return cachedTexture('icefloor_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<14;i++){
        const patch = hueJitter(base, 0.02, 0.1, 0.1);
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = patch.toHexString();
        const r = 20+Math.random()*30;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.6,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
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
      const glow = ctx.createRadialGradient(90,80,10,90,80,150);
      glow.addColorStop(0,'rgba(255,255,255,0.25)');
      glow.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle = glow; ctx.fillRect(0,0,256,256);
      addVignette(ctx,256,0.14);
      return wrapCanvasTexture('icefloor_'+baseHex, cv);
    });
  }
  function texStoneBlock(baseHex){
    return cachedTexture('stoneblock_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = '#8f8878'; ctx.fillRect(0,0,256,256);
      let y=0;
      while(y<256){
        const bh=28+Math.random()*18; let x=-Math.random()*40;
        while(x<256){
          const bw=40+Math.random()*45;
          const shade = base.scale(0.8+Math.random()*0.4);
          ctx.fillStyle = shade.toHexString();
          ctx.fillRect(x+2,y+2,bw-4,bh-4);
          x+=bw;
        }
        y+=bh;
      }
      for(let i=0;i<500;i++){ ctx.globalAlpha=0.08; ctx.fillStyle=Math.random()<0.5?'#000':'#fff'; ctx.fillRect(Math.random()*256,Math.random()*256,2,2); }
      ctx.globalAlpha=1; addVignette(ctx,256,0.16);
      return wrapCanvasTexture('stoneblock_'+baseHex, cv);
    });
  }
  function texMarble(baseHex){
    return cachedTexture('marble_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<9;i++){
        let x=Math.random()*256, y=0;
        ctx.strokeStyle = 'rgba(120,120,130,0.35)'; ctx.lineWidth=0.6+Math.random()*1.6;
        ctx.beginPath(); ctx.moveTo(x,y);
        for(let s=0;s<10;s++){ x+=(Math.random()-0.5)*40; y+=26; ctx.lineTo(x,y); }
        ctx.stroke();
      }
      addVignette(ctx,256,0.1);
      return wrapCanvasTexture('marble_'+baseHex, cv);
    });
  }
  function texGranite(baseHex){
    return cachedTexture('granite_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<2600;i++){
        ctx.globalAlpha = 0.15+Math.random()*0.25;
        ctx.fillStyle = Math.random()<0.5?'#1a1a1a':(Math.random()<0.5?'#cfcfcf':'#8a8070');
        const s=1+Math.random()*2.4;
        ctx.fillRect(Math.random()*256,Math.random()*256,s,s);
      }
      ctx.globalAlpha=1; addVignette(ctx,256,0.14);
      return wrapCanvasTexture('granite_'+baseHex, cv);
    });
  }
  function texObsidian(baseHex){
    return cachedTexture('obsidian_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.scale(0.6).toHexString(); ctx.fillRect(0,0,256,256);
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
      return wrapCanvasTexture('obsidian_'+baseHex, cv);
    });
  }
  function texCopper(baseHex){
    return cachedTexture('copper_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let x=0;x<256;x+=20){ ctx.fillStyle='rgba(0,0,0,0.08)'; ctx.fillRect(x,0,2,256); }
      for(let i=0;i<10;i++){
        const x=Math.random()*256;
        const grad = ctx.createLinearGradient(x,0,x+8,256);
        grad.addColorStop(0,'rgba(80,150,120,0)'); grad.addColorStop(0.5,'rgba(80,150,120,0.35)'); grad.addColorStop(1,'rgba(80,150,120,0.5)');
        ctx.fillStyle = grad; ctx.fillRect(x,0,10+Math.random()*14,256);
      }
      addVignette(ctx,256,0.14);
      return wrapCanvasTexture('copper_'+baseHex, cv);
    });
  }
  function texRust(baseHex){
    return cachedTexture('rust_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.scale(0.8).toHexString(); ctx.fillRect(0,0,256,256);
      for(let i=0;i<16;i++){
        const x=Math.random()*256;
        const grad = ctx.createLinearGradient(x,0,x,256);
        const rustCol = Math.random()<0.5 ? '140,60,20' : '110,45,15';
        grad.addColorStop(0,`rgba(${rustCol},0)`); grad.addColorStop(0.4,`rgba(${rustCol},0.55)`); grad.addColorStop(1,`rgba(${rustCol},0.75)`);
        ctx.fillStyle = grad; ctx.fillRect(x,0,6+Math.random()*16,256);
      }
      for(let i=0;i<900;i++){ ctx.globalAlpha=0.1; ctx.fillStyle='#3a1c0a'; ctx.fillRect(Math.random()*256,Math.random()*256,2,2); }
      ctx.globalAlpha=1; addVignette(ctx,256,0.18);
      return wrapCanvasTexture('rust_'+baseHex, cv);
    });
  }
  function texBamboo(baseHex){
    return cachedTexture('bamboo_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      const sw=256/8;
      for(let i=0;i<8;i++){
        const shade = base.scale(0.85+Math.random()*0.3);
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(i*sw+1,0,sw-2,256);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(i*sw+2,0,2,256);
      }
      for(let y=20;y<256;y+=48){ ctx.fillStyle='rgba(60,50,20,0.4)'; ctx.fillRect(0,y,256,4); }
      return wrapCanvasTexture('bamboo_'+baseHex, cv);
    });
  }
  function texRuins(baseHex){
    return cachedTexture('ruins_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = '#8f8878'; ctx.fillRect(0,0,256,256);
      let y=0;
      while(y<256){
        const bh=26+Math.random()*20; let x=-Math.random()*40;
        while(x<256){
          const bw=36+Math.random()*40;
          const shade = base.scale(0.7+Math.random()*0.5);
          ctx.fillStyle = shade.toHexString();
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
      return wrapCanvasTexture('ruins_'+baseHex, cv);
    });
  }
  function texTemple(baseHex){
    return cachedTexture('temple_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      for(let y=0;y<256;y+=32){
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(256,y); ctx.stroke();
        for(let x=8;x<256;x+=32){ ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.strokeRect(x,y+6,20,20); }
      }
      addVignette(ctx,256,0.14);
      return wrapCanvasTexture('temple_'+baseHex, cv);
    });
  }
  // Grillage : lignes losangées sur fond transparent, pour un effet
  // grillage/clôture ajouré via l'alpha de la texture.
  function texChainlink(baseHex){
    return cachedTexture('chainlink_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      ctx.clearRect(0,0,256,256);
      const col = hexIntToColor3(baseHex).toHexString();
      ctx.strokeStyle = col; ctx.lineWidth=1.4; ctx.globalAlpha=0.85;
      const step=16;
      for(let x=-256;x<256*2;x+=step){
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x+256,256); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x,256); ctx.lineTo(x+256,0); ctx.stroke();
      }
      ctx.globalAlpha=1;
      const tex = wrapCanvasTexture('chainlink_'+baseHex, cv);
      tex.hasAlpha = true;
      return tex;
    });
  }

  /* ============================================================
     2. HELPERS DE MESH — mkBox/mkCyl/group remplacent THREE.Mesh(geo,mat)
     par le pattern Babylon MeshBuilder.CreateXxx(name,options,scene) +
     assignation .material séparée. THREE.Group -> BABYLON.TransformNode
     (léger, position/rotation/scaling, pas de géométrie propre — les
     enfants s'y attachent via child.parent = group).
     ============================================================ */
  let _meshCounter = 0;
  function _uid(prefix){ return prefix+'_'+(_meshCounter++); }

  function jitterInstanceColor(color, opts={}){
    if(color==null || opts.map || opts.noJitter) return hexIntToColor3(color);
    return hueJitter(color, 0.01, 0.05, 0.06);
  }
  // PBRMaterial pour mkBox/mkCyl (Phase 4, livrable 3) — jusqu'ici
  // StandardMaterial, avec roughness/metalness rangés en simple metadata
  // JAMAIS appliqués au rendu (voir notes Phase 1). Bascule LA PLUS LARGE
  // de la passe de réalisme : ces deux helpers construisent la quasi-
  // totalité de la bibliothèque (murs, structures, props, couvertures...),
  // donc la rugosité désormais RÉELLEMENT physique s'applique d'un coup à
  // ~200 assets. Nécessite l'environnement (IBL) posé par
  // ensureDefaultEnvironment() — déjà branché dans valorant_match_engine.js
  // et map_editor.html pour les arbres/rochers (livrables précédents).
  function mkBox(w,h,d,color,opts={}){
    const m = BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:w, height:h, depth:d}, _scene);
    const mat = new BABYLON.PBRMaterial(_uid('boxMat'), _scene);
    mat.albedoColor = jitterInstanceColor(color, opts);
    mat.alpha = opts.opacity ?? 1;
    mat.roughness = opts.roughness ?? 0.85;
    mat.metallic = opts.metalness ?? 0.1;
    mat.metadata = { roughness: mat.roughness, metalness: mat.metallic };
    if(opts.map){
      // Clone impératif : la texture vient du cache partagé (voir
      // cachedTexture) — sans clone, régler uScale/vScale ici changerait
      // le rendu de TOUS les autres objets qui réutilisent cette texture.
      // MAIS DynamicTexture.clone() NE COPIE PAS le contenu dessiné : le
      // clone démarre avec son propre canvas interne VIERGE (vérifié :
      // après clone()+update(), les pixels du clone sont (0,0,0,0) —
      // entièrement transparent). Avec PBRMaterial, une texture réellement
      // à alpha 0 rend la mesh ENTIÈRE invisible (pas juste mal texturée),
      // contrairement à StandardMaterial qui s'en sortait visuellement
      // par un autre mécanisme de secours. C'est le bug "murs/sols
      // transparents" signalé par l'utilisateur. Le vrai correctif :
      // recopier explicitement le contenu du canvas d'origine sur celui
      // du clone AVANT de l'update() — pas juste appeler update() seul.
      const tex = opts.map.clone();
      tex.getContext().drawImage(opts.map.getContext().canvas, 0, 0);
      tex.update();
      tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
      tex.uScale = opts.repeatX ?? 1; tex.vScale = opts.repeatY ?? 1;
      mat.albedoTexture = tex;
      mat.albedoColor = new BABYLON.Color3(1,1,1); // laisse la texture porter la couleur
    }
    m.material = mat;
    m.receiveShadows = true;
    m.metadata = { castShadow: true };
    m.position.y = h/2;
    return m;
  }
  function mkCyl(rt,rb,h,color,segs=12,noJitter=false){
    const m = BABYLON.MeshBuilder.CreateCylinder(_uid('cyl'), {diameterTop:rt*2, diameterBottom:rb*2, height:h, tessellation:segs}, _scene);
    const mat = new BABYLON.PBRMaterial(_uid('cylMat'), _scene);
    mat.albedoColor = jitterInstanceColor(color, {noJitter});
    mat.roughness = 0.8; mat.metallic = 0;
    mat.metadata = { roughness: 0.8, metalness: 0 };
    m.material = mat;
    m.receiveShadows = true;
    m.metadata = { castShadow: true };
    m.position.y = h/2;
    return m;
  }
  // Boîte biseautée — SIMPLIFICATION PHASE 1 : le vrai biseau géométrique
  // (THREE.ExtrudeGeometry+bevelEnabled) n'a pas d'équivalent direct dans
  // Babylon.MeshBuilder ; on retombe sur une boîte simple pour l'instant
  // (voir note en tête de fichier — à reconstruire en Phase 4 si l'effet
  // visuel manque).
  function mkBevelBox(w,h,d,color,opts={}){
    const m = mkBox(w,h,d,color,opts);
    const rough = opts.roughness ?? 0.55, metal = opts.metalness ?? 0.2;
    m.material.roughness = rough; m.material.metallic = metal; // mkBox pose déjà une valeur par défaut différente : on la corrige réellement, pas seulement en metadata
    m.material.metadata = { roughness: rough, metalness: metal };
    return m;
  }
  function texStylizedPanel(baseHex, wearHex=0x2e3238){
    return cachedTexture('stylpanel_'+baseHex+'_'+wearHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=512;
      const ctx = cv.getContext('2d');
      ctx.scale(2,2);
      const base = hexIntToColor3(baseHex);
      const top = base.scale(1.14);
      const bottom = base.scale(0.85);
      const grad = ctx.createLinearGradient(0,0,0,256);
      grad.addColorStop(0, top.toHexString());
      grad.addColorStop(1, bottom.toHexString());
      ctx.fillStyle = grad; ctx.fillRect(0,0,256,256);
      const wear = hexIntToColor3(wearHex);
      for(let i=0;i<60;i++){
        const edge = Math.floor(Math.random()*4);
        let x,y;
        if(edge===0){ x=Math.random()*256; y=Math.random()*16; }
        else if(edge===1){ x=Math.random()*256; y=256-Math.random()*16; }
        else if(edge===2){ x=Math.random()*16; y=Math.random()*256; }
        else { x=256-Math.random()*16; y=Math.random()*256; }
        ctx.globalAlpha = 0.25+Math.random()*0.35;
        ctx.fillStyle = wear.toHexString();
        const s=1.5+Math.random()*3;
        ctx.fillRect(x,y,s,s);
      }
      ctx.globalAlpha = 1;
      addVignette(ctx,256,0.18);
      return wrapCanvasTexture('stylpanel_'+baseHex+'_'+wearHex, cv);
    });
  }
  function group(...children){
    const g = new BABYLON.TransformNode(_uid('grp'), _scene);
    children.forEach(c=>{ c.parent = g; });
    return g;
  }
  // Étiquette flottante (canvas -> texture -> plan billboard toujours face
  // caméra) : équivalent de THREE.Sprite via un plan + billboardMode.
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
    const tex = wrapCanvasTexture(_uid('textSpriteTex'), canvas);
    tex.hasAlpha = true;
    const plane = BABYLON.MeshBuilder.CreatePlane(_uid('textSprite'), {size}, _scene);
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const mat = mkStdMat(_uid('textSpriteMat'), _scene);
    mat.diffuseTexture = tex; mat.diffuseTexture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveColor = new BABYLON.Color3(1,1,1); // pas affecté par l'éclairage, comme SpriteMaterial
    mat.disableDepthWrite = true;
    plane.material = mat;
    plane.renderingGroupId = 1;
    return plane;
  }
  // Zone au sol (site/spawn) : disque plat coloré + anneau + étiquette
  // flottante au-dessus.
  function mkZonePad(radius, color, letter, letterBg){
    const g = new BABYLON.TransformNode(_uid('zonepad'), _scene);
    const pad = BABYLON.MeshBuilder.CreateCylinder(_uid('pad'), {diameterTop:radius*2, diameterBottom:radius*2, height:0.05, tessellation:32}, _scene);
    const padMat = mkStdMat(_uid('padMat'), _scene);
    padMat.diffuseColor = hexIntToColor3(color); padMat.alpha = 0.35; padMat.metadata = {roughness:0.9};
    pad.material = padMat; pad.position.y = 0.03; pad.receiveShadows = true; pad.metadata = {castShadow:false};
    pad.parent = g;
    const ring = BABYLON.MeshBuilder.CreateTorus(_uid('ring'), {diameter:(radius*2-0.075), thickness:0.15, tessellation:32}, _scene);
    const ringMat = mkStdMat(_uid('ringMat'), _scene);
    ringMat.diffuseColor = hexIntToColor3(color); ringMat.backFaceCulling = false;
    ring.material = ringMat;
    // BABYLON.CreateTorus est déjà plat dans le plan XZ par défaut (contrairement
    // à THREE.TorusGeometry, qui fait face à la caméra dans le plan XY) : la
    // rotation.x héritée du code Three.js d'origine (nécessaire là-bas pour
    // coucher l'anneau à plat) redressait ici l'anneau à la verticale — d'où
    // le "cercle" dressé au-dessus des zones au lieu de rester au sol.
    ring.position.y = 0.06;
    ring.parent = g;
    if(letter){
      const label = mkTextSprite(letter, letterBg||hexIntToColor3(color).toHexString());
      label.position.y = 2.4;
      label.parent = g;
    }
    return g;
  }

  // Chaque définition : { id, cat, label, icon, color, size:[l,w,h], build(color) }
  const ASSETS = [];
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
    ASSETS.push({ id:'biome_'+def.biomeKey, cat:'biomes', label:def.label, icon:def.icon, color:def.color, size:[1,1,1], isBiome:true, biomeKey:def.biomeKey, build:()=> new BABYLON.TransformNode(_uid('biome'), _scene) });
  });
  function registerAsset(def){ ASSETS.push(def); return def; }

  function addWindowGrid(parent, cols, rows, faceW, faceH, depth, face='z', winColor=0x9dd8e0){
    const marginX = faceW*0.12;
    const usableW = faceW - marginX*2, usableH = faceH*0.62;
    const cw = usableW/cols, ch = usableH/rows;
    const thickness = 0.12;
    for(let ix=0; ix<cols; ix++) for(let iy=0; iy<rows; iy++){
      const wx = -faceW/2 + marginX + cw*(ix+0.5);
      const wy = faceH*0.2 + ch*(iy+0.5);
      const frame = mkBox(cw*0.82, ch*0.72, thickness, 0x2a2e33);
      const glass = mkBox(cw*0.7, ch*0.58, thickness+0.02, winColor, {opacity:0.55,metalness:0.1,roughness:0.08});
      frame.metadata = {castShadow:false}; glass.metadata = {castShadow:false};
      const faceOffset = depth/2;
      const offset = face==='z' ? [wx, wy, faceOffset] : face==='-z' ? [wx, wy, -faceOffset]
                   : face==='x' ? [faceOffset, wy, wx] : [-faceOffset, wy, wx];
      frame.position.set(offset[0], offset[1], offset[2]);
      glass.position.set(offset[0], offset[1], offset[2]);
      if(face==='x'||face==='-x'){ frame.rotation.y = Math.PI/2; glass.rotation.y = Math.PI/2; }
      frame.parent = parent; glass.parent = parent;
    }
  }
  function addSeams(parent, count, w, h, d, axis, color, thickness=0.02){
    for(let i=1;i<count;i++){
      const t = i/count;
      if(axis==='y'){
        const seam = mkBox(w+0.02, thickness, d+0.02, color);
        seam.position.y = h*t + 0.001;
        seam.metadata = {castShadow:false};
        seam.parent = parent;
      } else {
        const seam = mkBox(thickness, h+0.02, d+0.02, color);
        seam.position.set(w*t - w/2, h/2, 0);
        seam.metadata = {castShadow:false};
        seam.parent = parent;
      }
    }
  }

// ============================================================
// PORT Three.js -> Babylon.js — map_assets.js lignes 1238-1945
// Catégorie "walls" : murs pleins (béton/acier/labo/industriel/
// militaire/futuriste), murs modulaires (5 formes x 6 matières),
// murs "matériaux naturels"/historique/climat, clôture grillage.
// Contient aussi addModularPlinth / addWeathering (helpers appelés
// par d'autres parties du fichier — noms/signatures inchangés).
// A spliced dans le fichier final avec les autres blocs portés.
// ============================================================

registerAsset({ id:'wall_concrete', cat:'walls', family:'Modulaire', subKey:'concrete', label:'Béton', icon:'🧱', color:0x8a8a86, size:[4,0.4,3],
  build:(c)=>{
    const g = group(mkBox(4,3,0.4,c,{map:texConcrete(c),repeatX:2,repeatY:1.5}));
    addSeams(g, 4, 4, 3, 0.4, 'y', 0x6f6f6b, 0.025); // joints de coffrage horizontaux
    addSeams(g, 3, 4, 3, 0.4, 'x', 0x6f6f6b, 0.02);
    // éclat/impact visible sur un des panneaux + coulure d'humidité
    const chip = mkBox(0.35,0.25,0.42,0x76766f); chip.position.set(1.1,0.6,0); chip.rotation.y=0.2; chip.parent = g;
    const stain = mkBox(0.18,1.1,0.42,0x5f5f57,{opacity:0.35}); stain.position.set(-1.3,2.1,0); stain.parent = g;
    // panneau de signalisation + boulons d'ancrage aux 4 coins + mousse/lichen en pied
    const sign = mkBox(0.6,0.6,0.03,0xf0c020); sign.position.set(0,2.3,0.21); sign.parent = g;
    const signMark = mkBox(0.4,0.06,0.035,0x1c1c1c); signMark.position.set(0,2.3,0.225); signMark.parent = g;
    [[-1.9,0.2],[1.9,0.2],[-1.9,2.8],[1.9,2.8]].forEach(([bx,by])=>{
      const bolt = mkCyl(0.05,0.05,0.05,0x3a3a3a,8);
      bolt.rotation.x = Math.PI/2; bolt.position.set(bx,by,0.21);
      bolt.parent = g;
    });
    const moss = mkBox(0.9,0.4,0.42,0x4f6a3a,{opacity:0.4});
    moss.position.set(1.4,0.2,0); moss.metadata.castShadow=false; moss.parent = g;
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
      rivet.parent = g;
    }
    addSeams(g, 4, 4, 3, 0.3, 'x', 0x333a42, 0.025);
    // bande de signalisation jaune/noire en pied de mur
    for(let i=0;i<10;i++){
      const stripe = mkBox(0.2,0.28,0.32, i%2===0?0xf0c020:0x1c1c1c);
      stripe.position.set(-1.9+i*0.42, 0.14, 0.02);
      stripe.metadata.castShadow = false;
      stripe.parent = g;
    }
    // panneau électrique + conduit de câble + poignée de manutention
    const panel = mkBox(0.5,0.7,0.06,0x2a2e33); panel.position.set(1.5,1.8,0.18); panel.parent = g;
    const panelLed = BABYLON.MeshBuilder.CreateSphere(_uid('panelLed'), {diameter:0.05, segments:6}, _scene);
    const panelLedMat = mkStdMat(_uid('panelLedMat'), _scene);
    panelLedMat.diffuseColor = hexIntToColor3(0xff3b1a);
    panelLedMat.emissiveColor = hexIntToColor3(0xff3b1a).scale(1);
    panelLed.material = panelLedMat;
    panelLed.position.set(1.65,2.05,0.22); panelLed.parent = g;
    const conduit = mkCyl(0.05,0.05,3,0x1c1c1c,8); conduit.position.set(-1.85,1.5,0.19); conduit.parent = g;
    const carryHandle = mkBox(0.3,0.06,0.34,0x1c1c1c); carryHandle.position.set(0,2.7,0.02); carryHandle.parent = g;
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
    const door = mkBox(1,2.2,0.32,0xd6dde0); door.position.set(-1.4,1.1,0); door.parent = g;
    const led = BABYLON.MeshBuilder.CreateSphere(_uid('led'), {diameter:0.08, segments:6}, _scene);
    const ledMat = mkStdMat(_uid('ledMat'), _scene);
    ledMat.diffuseColor = hexIntToColor3(0x4ade80);
    ledMat.emissiveColor = hexIntToColor3(0x4ade80).scale(1);
    led.material = ledMat;
    led.position.set(-1.05,2,0.17); led.parent = g;
    // lecteur de badge + étagère technique + grille d'aération basse
    const reader = mkBox(0.15,0.22,0.04,0x33373d); reader.position.set(-1.05,1.5,0.17); reader.parent = g;
    const shelf = mkBox(1.2,0.05,0.15,0xc9d2d6); shelf.position.set(1.2,2.4,0.18); shelf.parent = g;
    const ventGrille = mkBox(0.7,0.25,0.04,0xb9c2c6); ventGrille.position.set(1.2,0.3,0.17); ventGrille.parent = g;
    return g;
  }});
registerAsset({ id:'wall_industrial', cat:'walls', family:'Modulaire', subKey:'industrial', label:'Industriel', icon:'🏭', color:0x4a4f57, size:[4,0.4,3.4],
  build:(c)=>{
    const wall = mkBox(4,3.4,0.4,c,{metalness:0.2,map:texCorrugated(c),repeatX:6,repeatY:1});
    const g = group(wall);
    const pipe1 = mkCyl(0.08,0.08,3.4,0x2e3238,8); pipe1.rotation.x=Math.PI/2; pipe1.position.set(-1.6,2.8,0.28);
    const pipe2 = mkCyl(0.08,0.08,3.4,0x2e3238,8); pipe2.rotation.x=Math.PI/2; pipe2.position.set(-1.2,2.8,0.28);
    pipe1.parent = g; pipe2.parent = g;
    addSeams(g, 5, 4, 3.4, 0.4, 'x', 0x33373d, 0.02);
    // volants de vanne sur les tuyaux
    [-1.6,-1.2].forEach(px=>{
      const valve = BABYLON.MeshBuilder.CreateTorus(_uid('valve'), {diameter:0.28, thickness:0.05, tessellation:10}, _scene);
      const valveMat = mkStdMat(_uid('valveMat'), _scene);
      valveMat.diffuseColor = hexIntToColor3(0xc0472b);
      valveMat.metadata = { metalness:0.4 };
      valve.material = valveMat;
      valve.rotation.y = Math.PI/2; valve.position.set(px,2.8,0.34);
      valve.parent = g;
    });
    // jauge de pression + coulures de rouille + collier de fixation des tuyaux
    const gauge = mkCyl(0.12,0.12,0.06,0xd9d9d9,10); gauge.rotation.x=Math.PI/2; gauge.position.set(1.3,2,0.32); gauge.parent = g;
    const needle = mkBox(0.09,0.01,0.02,0x1c1c1c); needle.position.set(1.33,2.02,0.36); needle.rotation.z=0.6; needle.parent = g;
    const rust = mkBox(0.08,1.2,0.42,0x6b3820,{opacity:0.5}); rust.position.set(0.6,1.6,0); rust.metadata.castShadow=false; rust.parent = g;
    [1,2].forEach(fy=>{
      const clamp = mkBox(0.5,0.05,0.36,0x1c1c1c); clamp.position.set(-1.4,fy,0.28); clamp.parent = g;
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
      bag.parent = g;
    }
    // meurtrière d'observation + tache de camouflage
    const slit = mkBox(0.9,0.16,0.42,0x1c1e18); slit.position.set(0.8,1.8,0); slit.parent = g;
    const camo = mkBox(1,0.6,0.42,0x3f4a2e,{opacity:0.6}); camo.position.set(-1,2,0); camo.rotation.y=0.3; camo.parent = g;
    // barbelés au sommet + fanion + caisse de munitions au sol
    for(let i=0;i<7;i++){
      const wire = mkCyl(0.012,0.012,0.35,0x2a2a2a,5);
      wire.rotation.z = 0.9; wire.position.set(-1.7+i*0.6, 2.75, 0);
      wire.parent = g;
    }
    const flagPole = mkCyl(0.02,0.02,1,0x3a3a3a,6); flagPole.position.set(1.9,3.1,0); flagPole.parent = g;
    const flag = mkBox(0.5,0.32,0.02,0x53603f); flag.position.set(2.15,3.45,0); flag.parent = g;
    const ammoBox = mkBox(0.5,0.35,0.4,0x3f4a2e); ammoBox.position.set(1.6,0.18,0.35); ammoBox.parent = g;
    return g;
  }});
registerAsset({ id:'wall_futuristic', cat:'walls', family:'Modulaire', subKey:'futuristic', label:'Futuriste', icon:'✨', color:0x2a3550, size:[4,0.3,3.2],
  build:(c)=>{
    const wall = mkBox(4,3.2,0.3,c,{metalness:0.5,roughness:0.2,map:texMetalFloor(c),repeatX:3,repeatY:2});
    const g = group(wall);
    const trimTop = mkBox(4.05,0.06,0.32, 0x4ecdc4); trimTop.position.y = 3.2;
    const trimMid = mkBox(4.05,0.03,0.32, 0x4ecdc4); trimMid.position.y = 1.6;
    [trimTop, trimMid].forEach(t=>{ t.material.emissiveColor = hexIntToColor3(0x4ecdc4).scale(1.2); t.parent = g; });
    // balises d'angle lumineuses aux 2 coins bas
    [-1.95,1.95].forEach(px=>{
      const beacon = BABYLON.MeshBuilder.CreateSphere(_uid('beacon'), {diameter:0.12, segments:8}, _scene);
      const beaconMat = mkStdMat(_uid('beaconMat'), _scene);
      beaconMat.diffuseColor = hexIntToColor3(0xff6a39);
      beaconMat.emissiveColor = hexIntToColor3(0xff6a39).scale(1.3);
      beacon.material = beaconMat;
      beacon.position.set(px,0.2,0.17); beacon.parent = g;
    });
    // panneau holographique + lignes de circuit gravées + vitrage teinté central
    const hud = mkBox(0.9,0.55,0.02,0x4ecdc4); hud.position.set(0,2.1,0.16);
    hud.material.emissiveColor = hexIntToColor3(0x4ecdc4).scale(0.5); hud.material.alpha = 0.6;
    hud.parent = g;
    for(let i=0;i<3;i++){
      const circuit = mkBox(0.02,0.9,0.32,0x4ecdc4);
      circuit.material.emissiveColor = hexIntToColor3(0x4ecdc4).scale(0.6);
      circuit.position.set(-1.6+i*0.5,0.8,0); circuit.metadata.castShadow=false;
      circuit.parent = g;
    }
    const coreGlass = mkBox(0.6,1.4,0.32,0x1a2540,{opacity:0.5,metalness:0.2,roughness:0.05});
    coreGlass.position.set(1.4,1.5,0); coreGlass.parent = g;
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
  plinth.position.y = 0.15; plinth.metadata.castShadow = false;
  plinth.parent = parent;
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
    chip.material.albedoColor = chip.material.albedoColor.scale(0.4+Math.random()*0.25); // mkBox pose désormais un PBRMaterial (albedoColor), plus StandardMaterial (diffuseColor)
    chip.position.set((Math.random()<0.5?-1:1)*(w/2-0.35-Math.random()*0.3), 0.3+Math.random()*(h-0.9), 0);
    chip.rotation.y = (Math.random()-0.5)*0.4; chip.metadata.castShadow=false;
    chip.parent = parent;
  }
  if(Math.random()<0.65){
    const crackH = h*(0.28+Math.random()*0.32);
    const crack = mkBox(0.04,crackH,d+0.015,0x151412);
    crack.position.set((Math.random()-0.5)*w*0.55, crackH/2+Math.random()*(h-crackH), 0);
    crack.rotation.z = (Math.random()-0.5)*0.12; crack.metadata.castShadow=false;
    crack.parent = parent;
  }
  if(Math.random()<0.6){
    const stainH = h*(0.22+Math.random()*0.18);
    const stain = mkBox(0.45+Math.random()*0.35, stainH, d+0.015, opts.stainColor||0x4f6a3a, {opacity:0.32});
    stain.position.set((Math.random()-0.5)*w*0.55, stainH/2+Math.random()*0.3, 0);
    stain.metadata.castShadow=false;
    stain.parent = parent;
  }
  if(Math.random()<0.7){
    const n = Math.random()<0.5?2:4;
    for(let i=0;i<n;i++){
      const bolt = mkCyl(0.032,0.032,0.035,opts.boltColor||0x2a2a2a,6);
      bolt.rotation.x = Math.PI/2;
      bolt.position.set((Math.random()-0.5)*w*0.7, 0.3+Math.random()*(h-0.6), d/2+0.005);
      bolt.parent = parent;
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
    const chip = mkBox(0.3,0.22,d+0.02,0x76766f); chip.position.set(w*0.28,h*0.2,0); chip.rotation.y=0.2; chip.parent = g;
    const stain = mkBox(0.16,h*0.36,d+0.02,0x5f5f57,{opacity:0.35}); stain.position.set(-w*0.32,h*0.7,0); stain.parent = g;
    [[-w/2+0.15,0.2],[w/2-0.15,0.2],[-w/2+0.15,h-0.2],[w/2-0.15,h-0.2]].forEach(([bx,by])=>{
      const bolt = mkCyl(0.05,0.05,0.05,0x3a3a3a,8);
      bolt.rotation.x = Math.PI/2; bolt.position.set(bx,by,d/2+0.01);
      bolt.parent = g;
    });
    const moss = mkBox(w*0.22,h*0.13,d+0.02,0x4f6a3a,{opacity:0.4});
    moss.position.set(w*0.34,h*0.07,0); moss.metadata.castShadow=false; moss.parent = g;
  }
  registerAsset({ id:'wall_modular_concrete_straight', cat:'walls', family:'Modulaire', sub:'concrete', label:'Modulaire Béton — Droit', icon:'🧱', color:0x8a8a86, size:[4,D,H],
    build:(c)=>{
      const g = group(panel(4,H,D,c));
      addModularPlinth(g, 4, D, TRIM);
      addSeams(g, 4, 4, H, D, 'y', TRIM, 0.02);
      details(g, 4, H, D, c);
      const sign = mkBox(0.5,0.5,0.03,0xf0c020); sign.position.set(0,H*0.78,D/2+0.01); sign.parent = g;
      return g;
    }});
  registerAsset({ id:'wall_modular_concrete_corner', cat:'walls', family:'Modulaire', sub:'concrete', label:'Modulaire Béton — Angle', icon:'📐', color:0x8a8a86, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_concrete_corner'), _scene);
      const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.175);
      const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.175,H/2,0);
      legA.parent = g; legB.parent = g;
      const cornerPost = mkBox(0.4,H,0.4,0x76766f); cornerPost.position.set(-1.825,H/2,-1.825); cornerPost.parent = g;
      addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
      details(legA, 4, H, D, c);
      return g;
    }});
  registerAsset({ id:'wall_modular_concrete_half', cat:'walls', family:'Modulaire', sub:'concrete', label:'Modulaire Béton — Demi-mur', icon:'🧱', color:0x8a8a86, size:[4,D,1.2],
    build:(c)=>{
      const g = group(panel(4,1.2,D,c));
      addModularPlinth(g, 4, D, TRIM);
      const cap = mkBox(4.08,0.08,D+0.08,0x76766f); cap.position.y = 1.24; cap.parent = g;
      details(g, 4, 1.2, D, c);
      return g;
    }});
  registerAsset({ id:'wall_modular_concrete_door', cat:'walls', family:'Modulaire', sub:'concrete', label:'Modulaire Béton — Porte', icon:'🚪', color:0x8a8a86, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_concrete_door'), _scene);
      const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
      const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); pierL.parent = g;
      const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); pierR.parent = g;
      const lintel = mkBox(doorW,lintelH,D,c,{map:texConcrete(c),repeatX:0.9,repeatY:0.3}); lintel.position.y = H - lintelH/2; lintel.parent = g;
      const doorPanel = mkBox(doorW-0.1,H*0.75,0.06,0x3a3a3a,{metalness:0.3,roughness:0.5}); doorPanel.position.set(0,H*0.375,0.02); doorPanel.parent = g;
      const handle = mkCyl(0.03,0.03,0.22,0xd9d9d9,8); handle.rotation.z=Math.PI/2; handle.position.set(doorW/2-0.55,H*0.37,0.07); handle.parent = g;
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
      rivet.parent = g;
    }
  }
  function hazardStripe(g, w, d, y=0.14){
    const n = Math.max(4, Math.round(w/0.42));
    for(let i=0;i<n;i++){
      const stripe = mkBox(0.2,0.28,d+0.02, i%2===0?0xf0c020:0x1c1c1c);
      stripe.position.set(-w/2+0.2+i*(w-0.4)/(n-1||1), y, d/2-0.13);
      stripe.metadata.castShadow = false; stripe.parent = g;
    }
  }
  registerAsset({ id:'wall_modular_steel_straight', cat:'walls', family:'Modulaire', sub:'steel', label:'Modulaire Acier — Droit', icon:'🔩', color:0x5c6470, size:[4,D,H],
    build:(c)=>{
      const g = group(panel(4,H,D,c));
      addModularPlinth(g, 4, D, TRIM);
      rivets(g, 4, H, D, 4, 3);
      hazardStripe(g, 4, D);
      const panelBox = mkBox(0.5,0.7,0.06,0x2a2e33); panelBox.position.set(1.5,H*0.6,D/2+0.03); panelBox.parent = g;
      const led = BABYLON.MeshBuilder.CreateSphere(_uid('led'), {diameter:0.05, segments:6}, _scene);
      const ledMat = mkStdMat(_uid('ledMat'), _scene);
      ledMat.diffuseColor = hexIntToColor3(0xff3b1a);
      ledMat.emissiveColor = hexIntToColor3(0xff3b1a).scale(1);
      led.material = ledMat;
      led.position.set(1.65,H*0.68,D/2+0.07); led.parent = g;
      return g;
    }});
  registerAsset({ id:'wall_modular_steel_corner', cat:'walls', family:'Modulaire', sub:'steel', label:'Modulaire Acier — Angle', icon:'📐', color:0x5c6470, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_steel_corner'), _scene);
      const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.15);
      const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.15,H/2,0);
      legA.parent = g; legB.parent = g;
      const cornerPost = mkBox(0.4,H,0.4,0x2e3238); cornerPost.position.set(-1.825,H/2,-1.825); cornerPost.parent = g;
      addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
      rivets(legA, 4, H, D, 4, 3); hazardStripe(legA, 4, D);
      return g;
    }});
  registerAsset({ id:'wall_modular_steel_half', cat:'walls', family:'Modulaire', sub:'steel', label:'Modulaire Acier — Demi-mur', icon:'🔩', color:0x5c6470, size:[4,D,1.2],
    build:(c)=>{
      const g = group(panel(4,1.2,D,c));
      addModularPlinth(g, 4, D, TRIM);
      const cap = mkBox(4.08,0.08,D+0.08,0x2e3238); cap.position.y = 1.24; cap.parent = g;
      rivets(g, 4, 1.2, D, 4, 2);
      hazardStripe(g, 4, D);
      return g;
    }});
  registerAsset({ id:'wall_modular_steel_door', cat:'walls', family:'Modulaire', sub:'steel', label:'Modulaire Acier — Porte', icon:'🚪', color:0x5c6470, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_steel_door'), _scene);
      const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
      const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); pierL.parent = g;
      const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); pierR.parent = g;
      const lintel = mkBox(doorW,lintelH,D,c,{metalness:0.7,roughness:0.35,map:texMetalFloor(c),repeatX:0.9,repeatY:0.3}); lintel.position.y = H - lintelH/2; lintel.parent = g;
      const doorPanel = mkBox(doorW-0.1,H*0.75,0.06,0x2a2e33,{metalness:0.6,roughness:0.4}); doorPanel.position.set(0,H*0.375,0.02); doorPanel.parent = g;
      const handle = mkCyl(0.03,0.03,0.22,0xd9d9d9,8); handle.rotation.z=Math.PI/2; handle.position.set(doorW/2-0.55,H*0.37,0.07); handle.parent = g;
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
    const led = BABYLON.MeshBuilder.CreateSphere(_uid('led'), {diameter:0.08, segments:6}, _scene);
    const ledMat = mkStdMat(_uid('ledMat'), _scene);
    ledMat.diffuseColor = hexIntToColor3(0x4ade80);
    ledMat.emissiveColor = hexIntToColor3(0x4ade80).scale(1);
    led.material = ledMat;
    led.position.set(x,y,z); led.parent = g;
  }
  registerAsset({ id:'wall_modular_lab_straight', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Droit', icon:'🧪', color:0xe8ecef, size:[4,D,H],
    build:(c)=>{
      const g = group(panel(4,H,D,c));
      addModularPlinth(g, 4, D, TRIM);
      const shelf = mkBox(1.2,0.05,0.15,TRIM); shelf.position.set(1.2,H*0.8,D/2+0.02); shelf.parent = g;
      const ventGrille = mkBox(0.7,0.25,0.04,TRIM); ventGrille.position.set(-1.2,0.3,D/2+0.02); ventGrille.parent = g;
      return g;
    }});
  registerAsset({ id:'wall_modular_lab_corner', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Angle', icon:'📐', color:0xe8ecef, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_lab_corner'), _scene);
      const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.15);
      const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.15,H/2,0);
      legA.parent = g; legB.parent = g;
      const cornerPost = mkBox(0.4,H,0.4,0xc9d2d6); cornerPost.position.set(-1.825,H/2,-1.825); cornerPost.parent = g;
      addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
      return g;
    }});
  registerAsset({ id:'wall_modular_lab_half', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Demi-mur', icon:'🧪', color:0xe8ecef, size:[4,D,1.2],
    build:(c)=>{
      const g = group(panel(4,1.2,D,c));
      addModularPlinth(g, 4, D, TRIM);
      const cap = mkBox(4.08,0.08,D+0.08,0xc9d2d6); cap.position.y = 1.24; cap.parent = g;
      return g;
    }});
  registerAsset({ id:'wall_modular_lab_door', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Porte', icon:'🚪', color:0xe8ecef, size:[4,D,H],
    build:(c)=>{
      const g = group(panel(4,H,D,c));
      addModularPlinth(g, 4, D, TRIM);
      const door = mkBox(1.4,H*0.75,D+0.02,0xd6dde0); door.position.set(-1,H*0.375,0); door.parent = g;
      accessLed(g, -0.25, H*0.6, D/2+0.02);
      const reader = mkBox(0.15,0.22,0.04,0x33373d); reader.position.set(-0.25,H*0.45,D/2+0.02); reader.parent = g;
      return g;
    }});
  registerAsset({ id:'wall_modular_lab_window', cat:'walls', family:'Modulaire', sub:'lab', label:'Modulaire Labo — Fenêtre', icon:'🪟', color:0xe8ecef, size:[4,D,H],
    build:(c)=>{
      const g = group(panel(4,H,D,c));
      addModularPlinth(g, 4, D, TRIM);
      const glass = mkBox(2.6,H*0.37,D+0.04,0x9dd8e0,{opacity:0.45,metalness:0.1,roughness:0.05}); glass.position.set(0,H*0.57,0); glass.parent = g;
      const frame = mkBox(2.7,H*0.4,D+0.02,0xc9d2d6); frame.position.set(0,H*0.57,0);
      // TODO-PORT: frame.renderOrder=-1 (aide au tri de transparence contre le vitrage) non répliqué en Babylon
      frame.parent = g;
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
    pipe1.parent = g; pipe2.parent = g;
    [-w*0.4,-w*0.3].forEach(px=>{
      const valve = BABYLON.MeshBuilder.CreateTorus(_uid('valve'), {diameter:0.28, thickness:0.05, tessellation:10}, _scene);
      const valveMat = mkStdMat(_uid('valveMat'), _scene);
      valveMat.diffuseColor = hexIntToColor3(0xc0472b);
      valveMat.metadata = { metalness:0.4 };
      valve.material = valveMat;
      valve.rotation.y = Math.PI/2; valve.position.set(px,h*0.82,d/2-0.06);
      valve.parent = g;
    });
  }
  registerAsset({ id:'wall_modular_industrial_straight', cat:'walls', family:'Modulaire', sub:'industrial', label:'Modulaire Industriel — Droit', icon:'🏭', color:0x4a4f57, size:[4,D,H],
    build:(c)=>{
      const g = group(panel(4,H,D,c));
      addModularPlinth(g, 4, D, TRIM);
      pipes(g, 4, H, D);
      const gauge = mkCyl(0.12,0.12,0.06,0xd9d9d9,10); gauge.rotation.x=Math.PI/2; gauge.position.set(1.3,H*0.59,D/2+0.02); gauge.parent = g;
      const rust = mkBox(0.08,H*0.35,D+0.02,0x6b3820,{opacity:0.5}); rust.position.set(0.6,H*0.47,0); rust.metadata.castShadow=false; rust.parent = g;
      return g;
    }});
  registerAsset({ id:'wall_modular_industrial_corner', cat:'walls', family:'Modulaire', sub:'industrial', label:'Modulaire Industriel — Angle', icon:'📐', color:0x4a4f57, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_industrial_corner'), _scene);
      const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.2);
      const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.2,H/2,0);
      legA.parent = g; legB.parent = g;
      const cornerPost = mkBox(0.42,H,0.42,0x2e3238); cornerPost.position.set(-1.825,H/2,-1.825); cornerPost.parent = g;
      addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
      pipes(legA, 4, H, D);
      return g;
    }});
  registerAsset({ id:'wall_modular_industrial_half', cat:'walls', family:'Modulaire', sub:'industrial', label:'Modulaire Industriel — Demi-mur', icon:'🏭', color:0x4a4f57, size:[4,D,1.2],
    build:(c)=>{
      const g = group(panel(4,1.2,D,c));
      addModularPlinth(g, 4, D, TRIM);
      const cap = mkBox(4.08,0.08,D+0.08,0x2e3238); cap.position.y = 1.24; cap.parent = g;
      const clamp = mkBox(0.5,0.05,D+0.02,0x1c1c1c); clamp.position.set(-1.4,0.9,0); clamp.parent = g;
      return g;
    }});
  registerAsset({ id:'wall_modular_industrial_door', cat:'walls', family:'Modulaire', sub:'industrial', label:'Modulaire Industriel — Porte', icon:'🚪', color:0x4a4f57, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_industrial_door'), _scene);
      const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
      const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); pierL.parent = g;
      const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); pierR.parent = g;
      const lintel = mkBox(doorW,lintelH,D,c,{metalness:0.2,map:texCorrugated(c),repeatX:doorW*1.5,repeatY:0.2}); lintel.position.y = H - lintelH/2; lintel.parent = g;
      const doorPanel = mkBox(doorW-0.1,H*0.66,0.06,0x2e3238,{metalness:0.5,roughness:0.5}); doorPanel.position.set(0,H*0.33,0.02); doorPanel.parent = g;
      addModularPlinth(pierL, pierW, D, TRIM); addModularPlinth(pierR, pierW, D, TRIM);
      const clamp = mkBox(0.5,0.05,D+0.02,0x1c1c1c); clamp.position.set(0,H*0.85,0); clamp.parent = g;
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
      bag.parent = g;
    }
  }
  function barbwire(g, w, y){
    const n = Math.max(3, Math.round(w/0.6));
    for(let i=0;i<n;i++){
      const wire = mkCyl(0.012,0.012,0.35,0x2a2a2a,5);
      wire.rotation.z = 0.9; wire.position.set(-w/2+0.2+i*(w-0.4)/(n-1||1), y, 0);
      wire.parent = g;
    }
  }
  registerAsset({ id:'wall_modular_military_straight', cat:'walls', family:'Modulaire', sub:'military', label:'Modulaire Militaire — Droit', icon:'🎖️', color:0x53603f, size:[4,D,H],
    build:(c)=>{
      const g = group(panel(4,H,D,c));
      addModularPlinth(g, 4, D, TRIM);
      sandbags(g, 4, D, 6);
      const slit = mkBox(0.9,0.16,D+0.02,0x1c1e18); slit.position.set(0.8,H*0.62,0); slit.parent = g;
      const camo = mkBox(1,0.6,D+0.02,0x3f4a2e,{opacity:0.6}); camo.position.set(-1,H*0.7,0); camo.rotation.y=0.3; camo.parent = g;
      barbwire(g, 4, H-0.05);
      return g;
    }});
  registerAsset({ id:'wall_modular_military_corner', cat:'walls', family:'Modulaire', sub:'military', label:'Modulaire Militaire — Angle', icon:'📐', color:0x53603f, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_military_corner'), _scene);
      const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.2);
      const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.2,H/2,0);
      legA.parent = g; legB.parent = g;
      const cornerPost = mkBox(0.42,H,0.42,0x4a5539); cornerPost.position.set(-1.825,H/2,-1.825); cornerPost.parent = g;
      addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
      sandbags(legA, 4, D, 6); barbwire(legA, 4, H-0.05);
      return g;
    }});
  registerAsset({ id:'wall_modular_military_half', cat:'walls', family:'Modulaire', sub:'military', label:'Modulaire Militaire — Demi-mur', icon:'🎖️', color:0x53603f, size:[4,D,1.2],
    build:(c)=>{
      const g = group(panel(4,1.2,D,c));
      addModularPlinth(g, 4, D, TRIM);
      const cap = mkBox(4.08,0.08,D+0.08,0x4a5539); cap.position.y = 1.24; cap.parent = g;
      sandbags(g, 4, D, 6);
      return g;
    }});
  registerAsset({ id:'wall_modular_military_door', cat:'walls', family:'Modulaire', sub:'military', label:'Modulaire Militaire — Porte', icon:'🚪', color:0x53603f, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_military_door'), _scene);
      const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
      const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); pierL.parent = g;
      const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); pierR.parent = g;
      const lintel = mkBox(doorW,lintelH,D,c,{map:texConcrete(c),repeatX:0.9,repeatY:0.3}); lintel.position.y = H - lintelH/2; lintel.parent = g;
      const doorPanel = mkBox(doorW-0.1,H*0.75,0.06,0x2e3320,{metalness:0.2,roughness:0.7}); doorPanel.position.set(0,H*0.375,0.02); doorPanel.parent = g;
      addModularPlinth(pierL, pierW, D, TRIM); addModularPlinth(pierR, pierW, D, TRIM);
      sandbags(pierL, pierW, D, 2); sandbags(pierR, pierW, D, 2);
      const ammoBox = mkBox(0.5,0.35,0.4,0x3f4a2e); ammoBox.position.set(doorW/2+pierW*0.5,0.18,D/2-0.05); ammoBox.parent = g;
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
    [trimTop, trimMid].forEach(t=>{ t.material.emissiveColor = hexIntToColor3(0x4ecdc4).scale(1.2); t.parent = g; });
  }
  function beacons(g, w){
    [-w/2+0.05,w/2-0.05].forEach(px=>{
      const beacon = BABYLON.MeshBuilder.CreateSphere(_uid('beacon'), {diameter:0.12, segments:8}, _scene);
      const beaconMat = mkStdMat(_uid('beaconMat'), _scene);
      beaconMat.diffuseColor = hexIntToColor3(0xff6a39);
      beaconMat.emissiveColor = hexIntToColor3(0xff6a39).scale(1.3);
      beacon.material = beaconMat;
      beacon.position.set(px,0.2,0.17); beacon.parent = g;
    });
  }
  registerAsset({ id:'wall_modular_futuristic_straight', cat:'walls', family:'Modulaire', sub:'futuristic', label:'Modulaire Futuriste — Droit', icon:'✨', color:0x2a3550, size:[4,D,H],
    build:(c)=>{
      const g = group(panel(4,H,D,c));
      addModularPlinth(g, 4, D, TRIM);
      trims(g, 4, H, D); beacons(g, 4);
      const hud = mkBox(0.9,0.55,0.02,0x4ecdc4); hud.position.set(0,H*0.66,D/2+0.01);
      hud.material.emissiveColor = hexIntToColor3(0x4ecdc4).scale(0.5); hud.material.alpha = 0.6;
      hud.parent = g;
      return g;
    }});
  registerAsset({ id:'wall_modular_futuristic_corner', cat:'walls', family:'Modulaire', sub:'futuristic', label:'Modulaire Futuriste — Angle', icon:'📐', color:0x2a3550, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_futuristic_corner'), _scene);
      const legA = panel(4,H,D,c); legA.position.set(0,H/2,-1.825-D*0.5+0.15);
      const legB = panel(4,H,D,c); legB.rotation.y = Math.PI/2; legB.position.set(-1.825-D*0.5+0.15,H/2,0);
      legA.parent = g; legB.parent = g;
      const cornerPost = mkBox(0.4,H,0.4,0x1a2540); cornerPost.position.set(-1.825,H/2,-1.825); cornerPost.parent = g;
      addModularPlinth(legA, 4, D, TRIM); addModularPlinth(legB, 4, D, TRIM);
      trims(legA, 4, H, D); beacons(legA, 4);
      return g;
    }});
  registerAsset({ id:'wall_modular_futuristic_half', cat:'walls', family:'Modulaire', sub:'futuristic', label:'Modulaire Futuriste — Demi-mur', icon:'✨', color:0x2a3550, size:[4,D,1.2],
    build:(c)=>{
      const g = group(panel(4,1.2,D,c));
      addModularPlinth(g, 4, D, TRIM);
      const cap = mkBox(4.08,0.08,D+0.08,0x4ecdc4); cap.position.y = 1.24;
      cap.material.emissiveColor = hexIntToColor3(0x4ecdc4).scale(0.8); cap.parent = g;
      beacons(g, 4);
      return g;
    }});
  registerAsset({ id:'wall_modular_futuristic_door', cat:'walls', family:'Modulaire', sub:'futuristic', label:'Modulaire Futuriste — Porte', icon:'🚪', color:0x2a3550, size:[4,D,H],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('wall_modular_futuristic_door'), _scene);
      const pierW = 1.1, doorW = 1.8, lintelH = 0.7;
      const pierL = panel(pierW,H,D,c); pierL.position.x = -(doorW/2+pierW/2); pierL.parent = g;
      const pierR = panel(pierW,H,D,c); pierR.position.x = (doorW/2+pierW/2); pierR.parent = g;
      const lintel = mkBox(doorW,lintelH,D,c,{metalness:0.5,roughness:0.2,map:texMetalFloor(c),repeatX:doorW*0.75,repeatY:0.3}); lintel.position.y = H - lintelH/2; lintel.parent = g;
      const doorPanel = mkBox(doorW-0.1,H*0.7,0.06,0x1a2540,{metalness:0.4,roughness:0.3}); doorPanel.position.set(0,H*0.35,0.02);
      doorPanel.material.emissiveColor = hexIntToColor3(0x4ecdc4).scale(0.15);
      doorPanel.parent = g;
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
    const moss = mkBox(1.1,0.5,0.47,0x4f6a3a,{opacity:0.4}); moss.position.set(-1.2,0.25,0); moss.metadata.castShadow=false; moss.parent = g;
    const crack = mkBox(0.05,1.6,0.47,0x2c2a24); crack.position.set(0.6,1.4,0); crack.parent = g;
    return g;
  }});
registerAsset({ id:'wall_brick', cat:'walls', family:'Matériaux naturels', label:'Brique', icon:'🧱', color:0xa8543f, size:[4,0.35,3],
  build:(c)=>{
    const g = group(mkBox(4,3,0.35,c,{map:texBrick(c),repeatX:2,repeatY:1.5}));
    const cap = mkBox(4.1,0.15,0.42,0x6f6a5c); cap.position.y=3.02; cap.parent = g;
    addSeams(g,4,4,3,0.35,'x',0x6b5c4a,0.02);
    addWeathering(g,4,3,0.35,{stainColor:0x3a2a1e});
    return g;
  }});
registerAsset({ id:'wall_wood', cat:'walls', family:'Matériaux naturels', label:'Bois', icon:'🪵', color:0x8a5a34, size:[4,0.3,3],
  build:(c)=>{
    const g = group(mkBox(4,3,0.3,c,{map:texWoodFloor(c),repeatX:1,repeatY:2}));
    const beamTop = mkBox(4.1,0.15,0.36,0x4a3420); beamTop.position.y=2.92; beamTop.parent = g;
    const beamBot = mkBox(4.1,0.15,0.36,0x4a3420); beamBot.position.y=0.08; beamBot.parent = g;
    addSeams(g,7,4,3,0.3,'x',0x5a3f26,0.015);
    addWeathering(g,4,3,0.3,{stainColor:0x3f5a2c});
    return g;
  }});
registerAsset({ id:'wall_castle', cat:'walls', family:'Historique', label:'Château', icon:'🏰', color:0x9a9284, size:[4,0.6,3.6],
  build:(c)=>{
    const g = group(mkBox(4,3.2,0.6,c,{map:texStoneBlock(c),repeatX:2,repeatY:1.8,roughness:0.95}));
    for(let i=0;i<5;i++){
      const merlon = mkBox(0.55,0.4,0.6,c,{map:texStoneBlock(c)});
      merlon.position.set(-1.8+i*0.9,3.4,0); merlon.parent = g;
    }
    const slit = mkBox(0.1,0.7,0.64,0x1c1a16); slit.position.set(0,1.8,0); slit.parent = g;
    return g;
  }});
registerAsset({ id:'wall_medieval', cat:'walls', family:'Historique', label:'Médiéval', icon:'🏚️', color:0x7a6a52, size:[4,0.5,3.2],
  build:(c)=>{
    const g = group(mkBox(4,2.8,0.5,c,{map:texStoneBlock(c),repeatX:2,repeatY:1.6,roughness:0.95}));
    const beamA = mkBox(4.6,0.22,0.56,0x4a3420); beamA.rotation.z=0.42; beamA.position.set(0,1.4,0); beamA.parent = g;
    const beamB = mkBox(4.6,0.22,0.56,0x4a3420); beamB.rotation.z=-0.42; beamB.position.set(0,1.4,0); beamB.parent = g;
    [[-1.9,0.3],[1.9,0.3],[-1.9,2.5],[1.9,2.5]].forEach(([bx,by])=>{
      const stud = mkCyl(0.05,0.05,0.06,0x2a2a2a,8); stud.rotation.x=Math.PI/2; stud.position.set(bx,by,0.26); stud.parent = g;
    });
    return g;
  }});
registerAsset({ id:'wall_palisade', cat:'walls', family:'Historique', label:'Palissade', icon:'🪓', color:0x6b4a2c, size:[4,0.3,2.6],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('wall_palisade'), _scene);
    for(let i=0;i<9;i++){
      const x=-1.9+i*0.475;
      const trunk = mkCyl(0.14,0.16,2.3,c,8); trunk.position.set(x,1.15,0); trunk.parent = g;
      const tip = mkCyl(0,0.14,0.3,c,8); tip.position.set(x,2.3,0); tip.parent = g;
    }
    const railTop = mkBox(4,0.1,0.08,0x4a3420); railTop.position.set(0,1.6,0.12); railTop.parent = g;
    return g;
  }});
registerAsset({ id:'fence_chainlink', cat:'walls', family:'Clôtures & barrières', label:'Grillage', icon:'🔲', color:0x8a9099, size:[4,0.1,2.3],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('fence_chainlink'), _scene);
    const chainlinkSrc = texChainlink(c);
    const tex = chainlinkSrc.clone(); // .clone() ne copie pas le contenu dessiné, voir mkBox pour le détail du bug
    tex.getContext().drawImage(chainlinkSrc.getContext().canvas, 0, 0);
    tex.update();
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = 3; tex.vScale = 1.5;
    const mat = mkStdMat(_uid('fenceMat'), _scene);
    mat.diffuseTexture = tex;
    mat.diffuseColor = new BABYLON.Color3(1,1,1);
    mat.diffuseTexture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
    mat.alphaCutOff = 0.3;
    mat.backFaceCulling = false;
    mat.metadata = { roughness:0.6, metalness:0.4 };
    const mesh = BABYLON.MeshBuilder.CreatePlane(_uid('fenceMesh'), {width:4, height:2.2}, _scene);
    mesh.material = mat;
    mesh.position.set(0,1.1,0);
    mesh.receiveShadows = true;
    mesh.metadata = { castShadow:true };
    mesh.parent = g;
    [-2,2].forEach(x=>{ const post = mkCyl(0.06,0.06,2.3,0x555555,8); post.position.set(x,1.15,0); post.parent = g; });
    const rail = mkBox(4.1,0.05,0.05,0x555555); rail.position.y=2.25; rail.parent = g;
    return g;
  }});
registerAsset({ id:'wall_ice', cat:'walls', family:'Climat', label:'Glace', icon:'🧊', color:0xbfe6f0, size:[4,0.4,3],
  build:(c)=>{
    const wall = mkBox(4,3,0.4,c,{map:texIceFloor(c),roughness:0.15,metalness:0.05,opacity:0.85});
    const g = group(wall);
    for(let i=0;i<3;i++){
      const icicle = mkCyl(0.12,0,0.6,c,8); icicle.position.set(-1.4+i*1.4,-0.3,0.15);
      icicle.material.alpha = 0.8; icicle.parent = g;
    }
    return g;
  }});
registerAsset({ id:'wall_lava', cat:'walls', family:'Climat', label:'Lave', icon:'🌋', color:0x241c18, size:[4,0.4,3],
  build:(c)=>{
    const g = group(mkBox(4,3,0.4,c,{roughness:0.95}));
    for(let i=0;i<6;i++){
      const w=0.05+Math.random()*0.05, h=1+Math.random()*1.2;
      const crack = BABYLON.MeshBuilder.CreateBox(_uid('lavacrack'), {width:w, height:h, depth:0.42}, _scene);
      const crackMat = mkStdMat(_uid('lavacrackMat'), _scene);
      crackMat.diffuseColor = hexIntToColor3(0xff5a1a);
      crackMat.emissiveColor = hexIntToColor3(0xff4400).scale(1.4);
      crack.material = crackMat;
      crack.position.set(-1.7+Math.random()*3.4, 0.6+Math.random()*1.6, 0);
      crack.rotation.z = (Math.random()-0.5)*0.5; crack.metadata = { castShadow:false };
      crack.parent = g;
    }
    return g;
  }});
registerAsset({ id:'wall_bamboo', cat:'walls', family:'Matériaux naturels', label:'Bambou', icon:'🎍', color:0x7fae4a, size:[4,0.25,3],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('wall_bamboo'), _scene);
    for(let i=0;i<11;i++){
      const x=-2+i*0.4;
      const pole = mkCyl(0.13,0.15,3,c,10); pole.position.set(x,1.5,0); pole.parent = g;
      for(let n=0;n<3;n++){
        const node = mkCyl(0.16,0.16,0.06,0x5a7d34,10); node.position.set(x,0.7+n*0.9,0); node.parent = g;
      }
    }
    return g;
  }});
registerAsset({ id:'wall_japanese', cat:'walls', family:'Historique', label:'Japonais', icon:'⛩️', color:0xece3d0, size:[4,0.2,3],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('wall_japanese'), _scene);
    const paper = mkBox(3.8,2.8,0.1,c,{roughness:0.9,opacity:0.92}); paper.position.set(0,1.5,0); paper.parent = g;
    [[0,2.9,4,0.15],[0,0.05,4,0.15]].forEach(([fx,fy,fw,fh])=>{ const bar=mkBox(fw,fh,0.14,0x4a3420); bar.position.set(fx,fy,0.02); bar.parent = g; });
    [-1.95,-0.98,0,0.98,1.95].forEach(fx=>{ const bar=mkBox(0.15,3,0.14,0x4a3420); bar.position.set(fx,1.5,0.02); bar.parent = g; });
    return g;
  }});

// map_assets_babylon_partA2.js — Portage Babylon.js de map_assets.js (Three.js r128)
// Plage portée : lignes 1946-2961 de l'original (suite de "walls", puis
// "covers" et "structures"). Voir map_assets_babylon.js pour les helpers
// déjà portés (mkBox/mkCyl/mkBevelBox/group/hueJitter/tex*/registerAsset/
// _scene/_uid...) qui sont appelés ici SANS être redéfinis.
//
// Fonctions utilisées ici mais définies dans une autre plage portée
// (lignes ~1238-1945 de l'original) : addModularPlinth, addWeathering.
// Non redéfinies ici — supposées présentes dans la portée fusionnée finale.
//
// Pas d'IIFE, pas d'import/export : ce fichier n'est qu'une suite de
// registerAsset({...}) à fusionner dans le corps de la fonction-module
// principale (voir INSERT_PART_A dans map_assets_babylon.js).

registerAsset({ id:'wall_fortress', cat:'walls', family:'Historique', label:'Forteresse', icon:'🏯', color:0x8a8478, size:[4,0.7,3.8],
  build:(c)=>{
    const g = group(mkBox(4,3.4,0.7,c,{map:texStoneBlock(c),repeatX:2,repeatY:2,roughness:0.95}));
    for(let i=0;i<5;i++){
      const merlon = mkBox(0.6,0.5,0.7,c,{map:texStoneBlock(c)});
      merlon.position.set(-1.8+i*0.9,3.65,0); merlon.parent=g;
    }
    const slit1 = mkBox(0.12,0.9,0.74,0x151412); slit1.position.set(-1,1.9,0); slit1.parent=g;
    const slit2 = slit1.clone(_uid('wallFortressSlit2')); slit2.position.x=1; slit2.parent=g;
    return g;
  }});
registerAsset({ id:'wall_marble', cat:'walls', family:'Matériaux naturels', label:'Marbre', icon:'⬜', color:0xe8e5db, size:[4,0.4,3],
  build:(c)=>{
    const g = group(mkBox(4,3,0.4,c,{map:texMarble(c),repeatX:1.5,repeatY:1.2,roughness:0.25,metalness:0.05}));
    const base = mkBox(4.1,0.2,0.5,0xcfc9ba); base.position.y=0.1; base.parent=g;
    const cap = mkBox(4.1,0.2,0.5,0xcfc9ba); cap.position.y=2.9; cap.parent=g;
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
    const veinMat = mkStdMat(_uid('wallObsidianVeinMat'), _scene);
    veinMat.diffuseColor = hexIntToColor3(0x6a3fb8);
    veinMat.emissiveColor = hexIntToColor3(0x8a5fe0).scale(0.7);
    veinMat.metadata = { roughness:0.3 };
    for(let i=0;i<3;i++){
      const veinH = 0.9+Math.random()*0.8;
      const vein = mkBox(0.025,veinH,0.37,0x000000);
      vein.material = veinMat;
      vein.position.set(-1.4+i*1.4+(Math.random()-0.5)*0.3, veinH/2+Math.random()*(3-veinH-0.3), 0);
      vein.rotation.z = (Math.random()-0.5)*0.2; vein.metadata={castShadow:false};
      vein.parent=g;
    }
    for(let i=0;i<4;i++){
      // THREE.MeshPhysicalMaterial (transmission/thickness) n'a pas
      // d'équivalent StandardMaterial direct — approximé en alpha + un
      // soupçon de metalness pour garder un aspect vitreux sombre.
      const shardMat = mkStdMat(_uid('wallObsidianShardMat'), _scene);
      shardMat.diffuseColor = hexIntToColor3(0x1c1424);
      shardMat.alpha = 0.85;
      shardMat.metadata = { roughness:0.1, metalness:0.2 };
      const shard = BABYLON.MeshBuilder.CreateCylinder(_uid('wallObsidianShard'), {diameterTop:0, diameterBottom:(0.06+Math.random()*0.05)*2, height:0.22+Math.random()*0.15, tessellation:5}, _scene);
      shard.material = shardMat;
      shard.position.set((Math.random()-0.5)*3.4, 0.3+Math.random()*2.2, 0.18+Math.random()*0.04);
      shard.rotation.x = Math.PI/2 + (Math.random()-0.5)*0.6; shard.rotation.z = Math.random()*Math.PI*2;
      shard.metadata={castShadow:false};
      shard.parent=g;
    }
    return g;
  }});
registerAsset({ id:'wall_copper', cat:'walls', family:'Industriel', label:'Cuivre', icon:'🟠', color:0xb5713a, size:[4,0.25,3],
  build:(c)=>{
    const g = group(mkBox(4,3,0.25,c,{map:texCopper(c),repeatX:2,repeatY:1.5,metalness:0.6,roughness:0.4}));
    for(let ix=0; ix<4; ix++) for(let iy=0; iy<3; iy++){
      const rivet = mkCyl(0.035,0.035,0.03,0x8a5a2e,6); rivet.rotation.x=Math.PI/2; rivet.position.set(-1.7+ix*1.13,0.5+iy*1,0.13); rivet.parent=g;
    }
    return g;
  }});
registerAsset({ id:'wall_rusty', cat:'walls', family:'Industriel', label:'Rouillé', icon:'🟤', color:0x6b5a4a, size:[4,0.3,3],
  build:(c)=>{
    const g = group(mkBox(4,3,0.3,c,{map:texRust(c),repeatX:2,repeatY:1.5,metalness:0.3,roughness:0.75}));
    const hole = mkBox(0.3,0.3,0.34,0x1c1a16); hole.position.set(1.3,2.1,0); hole.parent=g;
    addSeams(g,4,4,3,0.3,'x',0x3a2c1e,0.02);
    addWeathering(g,4,3,0.3,{stainColor:0x8a4a20,chipColor:0x3a2c1e});
    return g;
  }});
registerAsset({ id:'wall_prison', cat:'walls', family:'Industriel', label:'Prison', icon:'🔒', color:0x8f8f88, size:[4,0.4,3.2],
  build:(c)=>{
    const g = group(mkBox(4,3.2,0.4,c,{map:texConcrete(c),repeatX:2,repeatY:1.6}));
    for(let i=0;i<6;i++){
      const bar = mkCyl(0.04,0.04,1.6,0x2a2a2a,8); bar.position.set(-0.9+i*0.36,1.9,0.24); bar.parent=g;
    }
    const barFrame = mkBox(2.3,1.7,0.06,0x1c1c1c); barFrame.position.set(0.075,1.9,0.28); barFrame.parent=g;
    return g;
  }});
registerAsset({ id:'wall_bunker', cat:'walls', family:'Industriel', label:'Bunker', icon:'🪖', color:0x6b6b60, size:[4,0.6,2.6],
  build:(c)=>{
    const g = group(mkBox(4,2.6,0.6,c,{map:texConcrete(c),repeatX:2,repeatY:1.3}));
    for(let i=0;i<9;i++){
      const bag = mkBox(0.5,0.28,0.7,0x8a7550); bag.position.set(-2+i*0.5,0.14,0.5); bag.rotation.y=(Math.random()-0.5)*0.15; bag.parent=g;
    }
    const slit = mkBox(1.4,0.3,0.64,0x151412); slit.position.set(0,1.8,0); slit.parent=g;
    return g;
  }});
registerAsset({ id:'wall_ruins', cat:'walls', family:'Historique', label:'Ruines', icon:'🏚️', color:0x8c8578, size:[4,0.45,2.4],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('wallRuinsGrp'), _scene);
    const left = mkBox(1.6,2.4,0.45,c,{map:texRuins(c),repeatX:1,repeatY:1.4}); left.position.x=-1.2; left.parent=g;
    const right = mkBox(1.3,1.5,0.45,c,{map:texRuins(c),repeatX:1,repeatY:1}); right.position.x=1.35; right.parent=g;
    for(let i=0;i<4;i++){
      const rebar = mkCyl(0.02,0.02,0.6,0x3a3a3a,6); rebar.rotation.z=Math.PI/2.3;
      rebar.position.set(-1.2+(Math.random()-0.5)*1.2, 2.2+Math.random()*0.3, 0); rebar.parent=g;
    }
    const rubble = mkBox(0.6,0.3,0.5,0x77705f); rubble.position.set(0.1,0.15,0.1); rubble.parent=g;
    return g;
  }});
registerAsset({ id:'wall_temple', cat:'walls', family:'Historique', label:'Temple', icon:'🛕', color:0xd8cdb0, size:[4,0.5,3.4],
  build:(c)=>{
    const g = group(mkBox(4,3,0.5,c,{map:texTemple(c),repeatX:1.5,repeatY:1.2,roughness:0.7}));
    const col1 = mkCyl(0.22,0.24,3.2,c,10); col1.position.set(-1.85,1.6,0.3); col1.parent=g;
    const col2 = mkCyl(0.22,0.24,3.2,c,10); col2.position.set(1.85,1.6,0.3); col2.parent=g;
    const pediment = mkBox(4.2,0.3,0.6,0xc7bb9c); pediment.position.y=3.15; pediment.parent=g;
    addWeathering(g,4,3,0.5,{stainColor:0x7a8a6a,chipColor:0xc2b89a});
    return g;
  }});
registerAsset({ id:'wall_rampart', cat:'walls', family:'Historique', label:'Rempart', icon:'🏰', color:0x8f897a, size:[4,0.9,4.2],
  build:(c)=>{
    const g = group(mkBox(4,3.8,0.9,c,{map:texStoneBlock(c),repeatX:2,repeatY:2.2,roughness:0.95}));
    const walkway = mkBox(4.2,0.2,1.1,0x6f6a5c); walkway.position.y=3.9; walkway.parent=g;
    for(let i=0;i<5;i++){
      const merlon = mkBox(0.6,0.6,0.9,c,{map:texStoneBlock(c)});
      merlon.position.set(-1.8+i*0.9,4.3,0); merlon.parent=g;
    }
    return g;
  }});
registerAsset({ id:'fence_wood', cat:'walls', family:'Clôtures & barrières', label:'Clôture bois', icon:'🪵', color:0x8a5a34, size:[4,0.15,1.2],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('fenceWoodGrp'), _scene);
    [-1.95,1.95].forEach(x=>{ const post = mkBox(0.14,1.3,0.14,c,{map:texWoodFloor(c)}); post.position.x=x; post.parent=g; });
    for(let i=0;i<3;i++){
      const rail = mkBox(4,0.14,0.06,c,{map:texWoodFloor(c)}); rail.position.set(0,0.3+i*0.4,0); rail.parent=g;
    }
    return g;
  }});
registerAsset({ id:'fence_metal', cat:'walls', family:'Clôtures & barrières', label:'Clôture métal', icon:'🔗', color:0x5c6470, size:[4,0.1,1.4],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('fenceMetalGrp'), _scene);
    [-1.95,1.95].forEach(x=>{ const post = mkCyl(0.06,0.06,1.5,c,8); post.position.x=x; post.parent=g; });
    for(let i=0;i<9;i++){
      const bar = mkCyl(0.025,0.025,1.3,c,6); bar.position.set(-1.8+i*0.45,0.65,0); bar.parent=g;
    }
    const railTop = mkBox(4,0.05,0.05,c); railTop.position.y=1.35; railTop.parent=g;
    return g;
  }});
registerAsset({ id:'barrier_construction', cat:'walls', family:'Clôtures & barrières', label:'Barrière de chantier', icon:'🚧', color:0xe8a020, size:[2.4,0.15,1.0],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('barrierConstructionGrp'), _scene);
    for(let i=0;i<6;i++){
      const stripe = mkBox(2.4/6,0.8,0.1, i%2===0?0xe8a020:0x1c1c1c);
      stripe.position.set(-1+i*0.4,0.4,0); stripe.parent=g;
    }
    [-1.1,1.1].forEach(x=>{ const leg = mkBox(0.08,0.9,0.4,0x2a2a2a); leg.rotation.x=0.5; leg.position.set(x,0.45,0.15); leg.parent=g; });
    return g;
  }});
registerAsset({ id:'barrier_military', cat:'walls', family:'Clôtures & barrières', label:'Barrière militaire', icon:'🎖️', color:0x53603f, size:[4,0.5,1.1],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('barrierMilitaryGrp'), _scene);
    for(let i=0;i<9;i++){
      const bag1 = mkBox(0.5,0.26,0.5,c); bag1.position.set(-2+i*0.5,0.13,0); bag1.rotation.y=(Math.random()-0.5)*0.2; bag1.parent=g;
      const bag2 = mkBox(0.5,0.26,0.5,c); bag2.position.set(-2+i*0.5,0.39,0); bag2.rotation.y=(Math.random()-0.5)*0.2; bag2.parent=g;
    }
    const coil = mkCyl(0.22,0.22,4,0x9aa0a4,10); coil.rotation.z=Math.PI/2; coil.position.set(0,0.85,0); coil.parent=g;
    return g;
  }});
registerAsset({ id:'barrier_futuristic', cat:'walls', family:'Clôtures & barrières', label:'Barrière futuriste', icon:'✨', color:0x2a3550, size:[4,0.15,1.3],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('barrierFuturisticGrp'), _scene);
    [-1.95,1.95].forEach(x=>{ const post = mkBox(0.15,1.4,0.15,c); post.position.x=x; post.parent=g; });
    const panelMat = mkStdMat(_uid('barrierFuturisticPanelMat'), _scene);
    panelMat.diffuseColor = hexIntToColor3(0x1a2540);
    panelMat.emissiveColor = hexIntToColor3(0x00d4ff).scale(0.9);
    panelMat.alpha = 0.55;
    const panel = BABYLON.MeshBuilder.CreateBox(_uid('barrierFuturisticPanel'), {width:3.6,height:1.1,depth:0.06}, _scene);
    panel.material = panelMat; panel.position.set(0,0.75,0); panel.parent=g;
    for(let i=0;i<4;i++){
      const lineMat = mkStdMat(_uid('barrierFuturisticLineMat'), _scene);
      lineMat.diffuseColor = hexIntToColor3(0x00d4ff);
      lineMat.emissiveColor = hexIntToColor3(0x00d4ff).scale(1.4);
      const line = BABYLON.MeshBuilder.CreateBox(_uid('barrierFuturisticLine'), {width:3.6,height:0.02,depth:0.07}, _scene);
      line.material = lineMat;
      line.position.set(0,0.3+i*0.27,0.01); line.parent=g;
    }
    return g;
  }});
registerAsset({ id:'gate_stone', cat:'walls', family:'Portails', label:'Portail pierre', icon:'⛩️', color:0x8c8578, size:[4,0.6,3.6],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('gateStoneGrp'), _scene);
    const pillarL = mkBox(0.5,3.6,0.6,c,{map:texStoneBlock(c)}); pillarL.position.x=-1.9; pillarL.parent=g;
    const pillarR = mkBox(0.5,3.6,0.6,c,{map:texStoneBlock(c)}); pillarR.position.x=1.9; pillarR.parent=g;
    const lintel = mkBox(4,0.5,0.6,c,{map:texStoneBlock(c)}); lintel.position.y=3.4; lintel.parent=g;
    [-0.9,0.9].forEach(x=>{
      const door = mkBox(1.6,3.1,0.15,0x5c5850); door.position.set(x,1.55,0.05); door.parent=g;
      const handle = mkCyl(0.04,0.04,0.3,0x2a2a2a,8); handle.rotation.z=Math.PI/2; handle.position.set(x+(x<0?0.7:-0.7),1.6,0.14); handle.parent=g;
    });
    return g;
  }});
registerAsset({ id:'gate_metal', cat:'walls', family:'Portails', label:'Portail métal', icon:'🚪', color:0x4a4f57, size:[4,0.5,3],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('gateMetalGrp'), _scene);
    const pillarL = mkBox(0.35,3,0.5,c); pillarL.position.x=-1.9; pillarL.parent=g;
    const pillarR = mkBox(0.35,3,0.5,c); pillarR.position.x=1.9; pillarR.parent=g;
    const topBar = mkBox(4,0.15,0.5,c); topBar.position.y=3; topBar.parent=g;
    [-0.9,0.9].forEach(leafX=>{
      for(let i=0;i<6;i++){
        const bar = mkCyl(0.03,0.03,2.7,0x2a2e33,8); bar.position.set(leafX-0.65+i*0.26,1.35,0); bar.parent=g;
      }
      const spike = mkCyl(0,0.05,0.2,0x2a2e33,6); spike.position.set(leafX,2.8,0); spike.parent=g;
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
      edge.parent = g;
    }
    // étiquette de pochoir (marquage de transport) sur la face avant
    const stencil = mkBox(0.7,0.35,0.02,0xd9c9a3);
    stencil.position.set(0,0.9,0.71); stencil.metadata={castShadow:false}; stencil.parent=g;
    const stencilBar = mkBox(0.5,0.06,0.03,0x3a2f1e);
    stencilBar.position.set(0,0.9,0.72); stencilBar.metadata={castShadow:false}; stencilBar.parent=g;
    // poignée de corde encastrée sur le dessus
    const handleMat = mkStdMat(_uid('coverCrateHandleMat'), _scene);
    handleMat.diffuseColor = hexIntToColor3(0x4a3a26);
    const handle = BABYLON.MeshBuilder.CreateTorus(_uid('coverCrateHandle'), {diameter:0.28, thickness:0.05, tessellation:12}, _scene);
    handle.material = handleMat;
    handle.rotation.x = Math.PI/2; handle.position.y = 1.41; handle.parent=g;
    // planches latérales visibles (rainures) sur la face droite
    // petit numéro de lot pochoir sur le côté (second marquage)
    const stencil2 = mkBox(0.35,0.18,0.02,0xd9c9a3);
    stencil2.position.set(0.71,0.35,0.4); stencil2.rotation.y=Math.PI/2; stencil2.metadata={castShadow:false};
    stencil2.parent=g;
    // rustines/patchs de réparation + coin écaillé + symbole fragile
    const patch = mkBox(0.3,0.3,0.03,0x6b5330); patch.position.set(-0.4,0.35,0.71); patch.metadata={castShadow:false}; patch.parent=g;
    const wornCorner = mkBox(0.22,0.22,0.22,0x76603a); wornCorner.position.set(0.66,1.28,0.66); wornCorner.rotation.y=0.3; wornCorner.parent=g;
    const fragile = mkCyl(0.09,0.09,0.02,0xd6342a,3); fragile.rotation.x=Math.PI/2; fragile.position.set(0.35,0.5,0.71); fragile.metadata={castShadow:false}; fragile.parent=g;
    return g;
  }});
registerAsset({ id:'cover_pallet', cat:'covers', label:'Palette', icon:'🟫', color:0x9a7a4a, size:[1.6,1.2,0.3],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('coverPalletGrp'), _scene);
    const cCol = hexIntToColor3(c);
    for(let i=0;i<5;i++){
      const shade = color3ToHexInt(cCol.scale(i%2===0 ? 1 : 0.88));
      const slat = mkBox(1.6,0.06,0.18,shade,{map:texWoodFloor(shade),repeatX:1.6,repeatY:0.3});
      slat.position.set(0,0.22,-0.48+i*0.24);
      slat.parent = g;
    }
    const base1=mkBox(1.6,0.16,0.18,0x7a5f38); base1.position.z=-0.5; base1.parent=g;
    const base2=mkBox(1.6,0.16,0.18,0x7a5f38); base2.position.z=0.5; base2.parent=g;
    // blocs d'appui sous les lattes (3 plots, comme une vraie palette Europe)
    for(const bx of [-0.7,0,0.7]){
      const block = mkBox(0.16,0.16,1.0,0x6b5330);
      block.position.set(bx,0.08,0); block.metadata={castShadow:false};
      block.parent = g;
    }
    // clous visibles à chaque intersection latte/plot
    for(const bx of [-0.7,0,0.7]) for(let i=0;i<5;i++){
      const nail = mkCyl(0.012,0.012,0.02,0x2a2a2a,5);
      nail.rotation.x = Math.PI/2;
      nail.position.set(bx, 0.25, -0.48+i*0.24);
      nail.metadata = {castShadow:false};
      nail.parent = g;
    }
    // marquage de traitement thermique + fissure sur une latte + éclisse de renfort
    const stamp = mkBox(0.3,0.14,0.01,0x4a3a26); stamp.position.set(0.5,0.26,0); stamp.rotation.x=-Math.PI/2; stamp.metadata={castShadow:false}; stamp.parent=g;
    const crackP = mkBox(0.4,0.01,0.03,0x5a4530); crackP.position.set(-0.4,0.26,-0.24); crackP.metadata={castShadow:false}; crackP.parent=g;
    const splint = mkBox(0.5,0.08,0.2,0x8a6a3f); splint.position.set(0,0.26,-0.5); splint.metadata={castShadow:false}; splint.parent=g;
    return g;
  }});
registerAsset({ id:'cover_container', cat:'covers', label:'Container', icon:'🚢', color:0xc0472b, size:[6,2.5,2.4],
  build:(c)=>{
    const g = group(mkBox(6,2.5,2.4,c,{metalness:0.3,map:texCorrugated(c),repeatX:8,repeatY:1}));
    for(let i=1;i<12;i++){ // nervures corruguées le long du container
      const rib = mkBox(0.06,2.5,2.42,0x9a3820);
      rib.position.x = -3 + i*0.5;
      rib.metadata = {castShadow:false};
      rib.parent = g;
    }
    const doorFrame = mkBox(0.1,2.5,2.42,0x6b2414); doorFrame.position.x=3; doorFrame.parent=g;
    // barres de verrouillage + charnières visibles sur la porte
    for(const dy of [-1,1]){
      const rod = mkBox(0.05,2.2,0.04,0x2a2a2a);
      rod.position.set(3.06, 1.1, dy*0.5); rod.parent=g;
    }
    for(const hy of [-1,0,1]){
      const hinge = mkBox(0.08,0.18,0.06,0x1a1a1a);
      hinge.position.set(3.1, 1.25+hy*0.9, 1.15); hinge.parent=g;
    }
    // bande logo décorative
    const stripe = mkBox(6.02,0.3,0.02,0xf0f0f0);
    stripe.position.set(0,0.2,1.22); stripe.metadata={castShadow:false}; stripe.parent=g;
    // coulures de rouille sous les nervures (usure réaliste)
    for(let i=0;i<4;i++){
      const rust = mkBox(0.1,0.9,0.03,0x6b2414,{opacity:0.55});
      rust.position.set(-2+i*1.3, 1.5, 1.22); rust.metadata={castShadow:false};
      rust.parent = g;
    }
    // numéro d'identification ISO + cadenas de sécurité + coin renforcé
    const idPlate = mkBox(1.2,0.3,0.02,0xf0f0f0); idPlate.position.set(-1.5,2.2,1.22); idPlate.metadata={castShadow:false}; idPlate.parent=g;
    const idText = mkBox(1,0.15,0.025,0x1c1c1c); idText.position.set(-1.5,2.2,1.23); idText.metadata={castShadow:false}; idText.parent=g;
    const lock = mkBox(0.15,0.2,0.08,0x2a2a2a); lock.position.set(3.1,1.25,1.15); lock.parent=g;
    for(const cy of [-1.2,1.2]){
      const cornerCast = mkBox(0.2,0.2,2.42,0x1c1c1c); cornerCast.position.set(cy*2.5,0.1,0); cornerCast.parent=g;
    }
    return g;
  }});
registerAsset({ id:'cover_barrier', cat:'covers', label:'Barrière', icon:'🚧', color:0xd6a020, size:[2.4,1.1,0.3],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('coverBarrierGrp'), _scene);
    const top = mkBox(2.4,0.18,0.3,c); top.position.y=0.95; top.parent=g;
    const bot = mkBox(2.4,0.18,0.3,c); bot.position.y=0.25; bot.parent=g;
    // rayures diagonales alternées noir/jaune sur les deux panneaux
    [0.95,0.25].forEach(py=>{
      for(let i=0;i<5;i++){
        const stripe = mkBox(0.16,0.19,0.32,0x1c1c1c);
        stripe.rotation.z = 0.5;
        stripe.position.set(-0.9+i*0.45, py, 0);
        stripe.metadata = {castShadow:false};
        stripe.parent = g;
      }
    });
    for(const sx of [-1,1]){
      const leg = mkBox(0.12,1.1,0.3,0x2a2a2a);
      leg.position.x = sx*1.1;
      leg.parent = g;
    }
    const brace1 = mkBox(0.1,1.3,0.06,0x2a2a2a); brace1.rotation.z=0.6; brace1.parent=g;
    const brace2 = mkBox(0.1,1.3,0.06,0x2a2a2a); brace2.rotation.z=-0.6; brace2.parent=g;
    // gyrophare d'avertissement au sommet
    const beaconMat = mkStdMat(_uid('coverBarrierBeaconMat'), _scene);
    beaconMat.diffuseColor = hexIntToColor3(0xff3b1a);
    beaconMat.emissiveColor = hexIntToColor3(0xff3b1a);
    const beacon = BABYLON.MeshBuilder.CreateSphere(_uid('coverBarrierBeacon'), {diameter:0.18,segments:8}, _scene);
    beacon.material = beaconMat;
    beacon.position.set(0,1.12,0); beacon.parent=g;
    // catadioptres réfléchissants aux extrémités
    [-1.15,1.15].forEach(px=>{
      const reflector = mkBox(0.06,0.14,0.32,0xff3b1a);
      reflector.material.emissiveColor = hexIntToColor3(0xff3b1a).scale(0.4);
      reflector.position.set(px,0.6,0); reflector.parent=g;
    });
    // panneau "danger" + base en béton + chaîne de délimitation
    const dangerSign = mkBox(0.5,0.5,0.03,0xf0f0f0); dangerSign.position.set(0,0.6,0.17); dangerSign.parent=g;
    const dangerText = mkBox(0.36,0.08,0.035,0x1c1c1c); dangerText.position.set(0,0.6,0.185); dangerText.parent=g;
    [-1.1,1.1].forEach(sx=>{
      const foot = mkBox(0.35,0.12,0.5,0x6e6e6a); foot.position.set(sx,0.06,0); foot.parent=g;
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
      bag.parent = g;
    });
    // meurtrière de tir sur la face avant
    const slit = mkBox(1.4,0.22,0.1,0x14161a);
    slit.position.set(0,1.1,1.52); slit.metadata={castShadow:false}; slit.parent=g;
    // antenne radio sur le toit
    const mast = mkCyl(0.02,0.03,1.1,0x2a2a2a,6); mast.position.set(1,1.9,1); mast.parent=g;
    // porte d'accès arrière + marquage de rang + périscope
    const doorB = mkBox(0.8,1.4,0.1,0x3a3a36); doorB.position.set(0,0.7,-1.52); doorB.parent=g;
    const rank = mkBox(0.3,0.3,0.02,0x8a7a52); rank.position.set(-1.2,1.3,1.51); rank.metadata={castShadow:false}; rank.parent=g;
    const periscope = mkCyl(0.04,0.04,0.5,0x2a2a2a,6); periscope.position.set(-0.8,1.9,0.6); periscope.parent=g;
    return g;
  }});
registerAsset({ id:'cover_vehicle', cat:'covers', label:'Véhicule', icon:'🚙', color:0x3a4a5a, size:[4.2,1.6,2],
  build:(c)=>{
    const g = group(mkBox(4.2,1.3,2,c), (()=>{ const cab=mkBox(2,0.9,1.9,c); cab.position.set(-0.3,1.3,0); return cab; })());
    const glass = mkBox(1.8,0.6,1.95,0x9dd8e0,{opacity:0.4,roughness:0.05}); glass.position.set(-0.3,1.55,0); glass.parent=g;
    for(const [sx,sz] of [[-1.7,-1],[-1.7,1],[1.7,-1],[1.7,1]]){
      const wheel = mkCyl(0.42,0.42,0.3,0x1a1a1a,14);
      wheel.rotation.z = Math.PI/2;
      wheel.position.set(sx, 0.42, sz*0.95);
      wheel.parent = g;
    }
    // phares avant + feux arrière
    const headlightMat = mkStdMat(_uid('coverVehicleHeadlightMat'), _scene);
    headlightMat.diffuseColor = hexIntToColor3(0xfff3c8);
    headlightMat.emissiveColor = hexIntToColor3(0xfff3c8).scale(0.8);
    for(const sz of [-0.7,0.7]){
      const light = BABYLON.MeshBuilder.CreateSphere(_uid('coverVehicleHeadlight'), {diameter:0.2,segments:8}, _scene);
      light.material = headlightMat;
      light.position.set(2.05, 0.75, sz); light.parent=g;
    }
    const tailMat = mkStdMat(_uid('coverVehicleTailMat'), _scene);
    tailMat.diffuseColor = hexIntToColor3(0xff3b1a);
    tailMat.emissiveColor = hexIntToColor3(0xff3b1a).scale(0.7);
    for(const sz of [-0.7,0.7]){
      const light = mkBox(0.06,0.18,0.14,0xff3b1a);
      light.material = tailMat; light.position.set(-2.05,0.75,sz); light.parent=g;
    }
    // pare-chocs + rétroviseurs
    const bumper = mkBox(0.3,0.35,2.05,0x1c2128); bumper.position.set(2.1,0.55,0); bumper.parent=g;
    for(const sz of [-1,1]){
      const mirror = mkBox(0.06,0.14,0.22,0x1c2128);
      mirror.position.set(0.6,1.55,sz*1.0); mirror.parent=g;
    }
    // pot d'échappement arrière
    const exhaust = mkCyl(0.06,0.06,0.3,0x3a3a3a,8); exhaust.rotation.z=Math.PI/2; exhaust.position.set(-2.15,0.35,0.6); exhaust.parent=g;
    // galerie de toit + plaque d'immatriculation + poignées de portière
    const roofRack = new BABYLON.TransformNode(_uid('coverVehicleRoofRack'), _scene);
    for(const rz of [-0.7,0.7]){ const bar = mkBox(1.6,0.05,0.05,0x1c2128); bar.position.set(-0.3,2.05,rz); bar.parent=roofRack; }
    roofRack.parent = g;
    const plate = mkBox(0.4,0.15,0.02,0xe8e8e8); plate.position.set(2.11,0.5,0); plate.metadata={castShadow:false}; plate.parent=g;
    for(const sz of [-1,1]){
      const doorHandle = mkBox(0.15,0.04,0.03,0x1c2128); doorHandle.position.set(0.2,0.85,sz*1.01); doorHandle.parent=g;
    }
    return g;
  }});

registerAsset({ id:'cover_sandbags', cat:'covers', label:'Sacs de sable', icon:'🟫', color:0x9c8a5e, size:[1.8,0.7,0.8],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('coverSandbagsGrp'), _scene);
    const rows = 2, perRow = 4;
    for(let row=0; row<rows; row++){
      for(let i=0; i<perRow; i++){
        const sag = mkBox(0.46,0.32,0.46,c,{roughness:0.95});
        sag.position.set(-0.75+i*0.5+(row%2?0.25:0), 0.16+row*0.32, 0);
        sag.rotation.y = (i%2?0.06:-0.06);
        sag.parent = g;
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
    for(const sx of [-0.75,0.75]){ const leg = mkBox(0.08,0.9,0.3,0x2a2e33); leg.position.set(sx,0.45,0); leg.parent=g; }
    const stripe = mkBox(1.7,0.12,0.11,0xf0c020); stripe.position.y=0.15; stripe.parent=g;
    return g;
  }});
registerAsset({ id:'cover_dumpster', cat:'covers', label:'Benne à déchets', icon:'🗑️', color:0x4a6a4a,
  size:[1.6,1.1,1.0],
  build:(c)=>{
    const g = group(mkBox(1.6,1.0,1.0,c,{roughness:0.8}));
    const lid = mkBox(1.7,0.08,1.05,c,{roughness:0.7}); lid.position.y=0.54; lid.rotation.z=0.12; lid.parent=g;
    for(const sx of [-0.6,0.6]){ const wheel = mkCyl(0.1,0.1,0.06,0x1a1a1a,10); wheel.rotation.x=Math.PI/2; wheel.position.set(sx,0.1,0.45); wheel.parent=g; }
    return g;
  }});

// ---- STRUCTURES ---- chaque bâtiment combine volume principal + toit/
// corniche + fenêtres en grille + porte, plutôt qu'un simple pavé —
// même logique de détail que Murs/Couvertures.
registerAsset({ id:'struct_building', cat:'structures', family:'Urbain & commercial', label:'Bâtiment', icon:'🏢', color:0xb9ac8e, size:[10,8,10],
  build:(c)=>{
    const g = group(mkBox(10,8,10,c,{map:texStuc(c), repeatX:4, repeatY:3}));
    const parapet = mkBox(10.3,0.5,10.3,0x9a8f76); parapet.position.y=8; parapet.parent=g;
    addWindowGrid(g, 4, 3, 10, 8, 10.05, 'z');
    addWindowGrid(g, 4, 3, 10, 8, 10.05, '-z');
    const door = mkBox(1.6,2.4,0.15,0x3a3025); door.position.set(0,1.2,5.02); door.parent=g;
    // auvent d'entrée + climatiseurs de toit
    const awning = mkBox(2.4,0.12,1,0x5c6470); awning.position.set(0,2.5,5.5); awning.parent=g;
    for(const ax of [-2.5,1.5]){
      const ac = mkBox(1,0.6,1,0x8f9499); ac.position.set(ax,8.3,-2); ac.parent=g;
    }
    // château d'eau sur le toit — silhouette urbaine typique
    const tankLegs = new BABYLON.TransformNode(_uid('structBuildingTankLegs'), _scene);
    for(const [lx,lz] of [[-0.4,-0.4],[0.4,-0.4],[-0.4,0.4],[0.4,0.4]]){
      const leg = mkBox(0.1,1.2,0.1,0x4a3a26); leg.position.set(lx,0.6,lz); leg.parent=tankLegs;
    }
    const tankBody = mkCyl(0.9,0.9,1.3,0x6b5a45,10); tankBody.position.y=1.85;
    tankBody.parent = tankLegs;
    tankLegs.position.set(-3,8.3,2.5);
    tankLegs.parent = g;
    // corniche décorative en bas de façade + caméra de surveillance + numéro de rue
    const cornice2 = mkBox(10.3,0.25,10.3,0x9a8f76); cornice2.position.y=0.3; cornice2.parent=g;
    const camera = mkBox(0.15,0.15,0.3,0x1c1c1c); camera.position.set(2,4.5,5.05); camera.rotation.x=0.3; camera.parent=g;
    const cameraLensMat = mkStdMat(_uid('structBuildingCameraLensMat'), _scene);
    cameraLensMat.diffuseColor = hexIntToColor3(0x111111); cameraLensMat.metadata = {metalness:0.6};
    const cameraLens = BABYLON.MeshBuilder.CreateSphere(_uid('structBuildingCameraLens'), {diameter:0.08,segments:6}, _scene);
    cameraLens.material = cameraLensMat;
    cameraLens.position.set(2,4.4,5.2); cameraLens.parent=g;
    const streetNum = mkBox(0.4,0.3,0.02,0x3a3025); streetNum.position.set(1.2,2.2,5.02); streetNum.metadata={castShadow:false}; streetNum.parent=g;
    // garde-corps de toit + parabole satellite + coffret électrique mural
    for(let i=0;i<4;i++){
      const rail = mkBox(0.05,0.7,0.05,0x2a2a2a);
      rail.position.set(-4+i*2.6, 8.6, 4.9); rail.parent=g;
    }
    const railTop = mkBox(10,0.05,0.05,0x2a2a2a); railTop.position.set(0,8.95,4.9); railTop.parent=g;
    // Antenne parabolique : demi-sphère (slice=0.5) avec double face —
    // side:THREE.DoubleSide -> backFaceCulling = false.
    const dishBMat = mkStdMat(_uid('structBuildingDishMat'), _scene);
    dishBMat.diffuseColor = hexIntToColor3(0xd9d9d9); dishBMat.backFaceCulling = false;
    const dishB = BABYLON.MeshBuilder.CreateSphere(_uid('structBuildingDish'), {diameter:0.7,segments:10,slice:0.5}, _scene);
    dishB.material = dishBMat;
    dishB.rotation.x = Math.PI*0.8; dishB.position.set(3.5,8.4,-3); dishB.parent=g;
    const meterBox = mkBox(0.35,0.5,0.12,0x3a3f45); meterBox.position.set(-4.6,1.3,5.06); meterBox.parent=g;
    return g;
  }});
registerAsset({ id:'struct_garage', cat:'structures', family:'Urbain & commercial', label:'Garage', icon:'🚗', color:0x8a8378, size:[7,3.2,6],
  build:(c)=>{
    const g = group(mkBox(7,3.2,6,c,{map:texConcrete(c), repeatX:3, repeatY:1.5}));
    // Cadre en RETRAIT (posé presque à fleur du mur), lattes clairement
    // EN AVANT de ce cadre — un vrai espacement en Z entre les deux
    // évite le scintillement/chevauchement visuel qu'on avait avant
    // (cadre et lattes occupaient la même tranche de profondeur).
    const frame = mkBox(3.4,2.9,0.06,0x33373d); frame.position.set(-1.2,1.5,3.0); frame.parent=g;
    for(let i=0;i<6;i++){
      const slat = mkBox(3.2,0.42,0.1,0x5c6470);
      slat.position.set(-1.2, 0.3+i*0.46, 3.1);
      slat.metadata = {castShadow:false};
      slat.parent = g;
    }
    addWindowGrid(g, 2, 1, 7, 3.2, 6.05, '-z');
    // débord de toit + gouttière + applique lumineuse
    const overhang = mkBox(7.6,0.15,6.6,0x6b6459); overhang.position.y=3.2; overhang.parent=g;
    const gutter = mkBox(7.6,0.08,0.1,0x3a3a3a); gutter.position.set(0,3.1,3.3); gutter.parent=g;
    const lampMat = mkStdMat(_uid('structGarageLampMat'), _scene);
    lampMat.diffuseColor = hexIntToColor3(0xfff3c8); lampMat.emissiveColor = hexIntToColor3(0xfff3c8).scale(0.9);
    const lamp = BABYLON.MeshBuilder.CreateSphere(_uid('structGarageLamp'), {diameter:0.2,segments:8}, _scene);
    lamp.material = lampMat;
    lamp.position.set(-1.2,2.95,3.2); lamp.parent=g;
    // grille de ventilation latérale
    const vent = mkBox(0.6,0.6,0.05,0x2a2e33); vent.position.set(3.02,2,0); vent.rotation.y=Math.PI/2; vent.parent=g;
    // descente de gouttière + tuyau d'arrosage enroulé + plaque numérotée
    const downspout = mkBox(0.08,3,0.08,0x3a3a3a); downspout.position.set(3.4,1.5,2.9); downspout.parent=g;
    const hoseReel = mkCyl(0.18,0.18,0.1,0x2a5a3a,10); hoseReel.rotation.z=Math.PI/2; hoseReel.position.set(3.02,0.5,-2); hoseReel.parent=g;
    const plateNum = mkBox(0.3,0.2,0.02,0xe8e8e8); plateNum.position.set(-2.9,1.6,3.04); plateNum.metadata={castShadow:false}; plateNum.parent=g;
    // pile de pneus + tache d'huile au sol devant la porte
    for(let i=0;i<3;i++){
      const tire = mkCyl(0.35,0.35,0.22,0x1c1c1c,14); tire.rotation.x=Math.PI/2;
      tire.position.set(3.0,0.22+i*0.22,-2); tire.parent=g;
    }
    const oilStainMat = mkStdMat(_uid('structGarageOilStainMat'), _scene);
    oilStainMat.diffuseColor = hexIntToColor3(0x141414); oilStainMat.metadata = {roughness:1};
    const oilStain = BABYLON.MeshBuilder.CreateDisc(_uid('structGarageOilStain'), {radius:0.7,tessellation:10}, _scene);
    oilStain.material = oilStainMat;
    oilStain.rotation.x=-Math.PI/2; oilStain.position.set(-1.2,0.02,4.2); oilStain.metadata={castShadow:false}; oilStain.parent=g;
    return g;
  }});
registerAsset({ id:'struct_hangar', cat:'structures', family:'Urbain & commercial', label:'Hangar', icon:'🛩️', color:0x717a82, size:[12,6,9],
  build:(c)=>{
    const g = group(mkBox(12,6,9,c,{map:texCorrugated(c), repeatX:8, repeatY:1}), (()=>{ const r=mkBox(12.4,0.8,9.4,0x4a4f57); r.position.y=6; return r; })());
    // panneaux corrugués verticaux sur les grands côtés
    for(let i=1;i<16;i++){
      const rib = mkBox(0.05,5.8,9.02,0x5c6470);
      rib.position.set(-6+i*0.75, 3, 0);
      rib.metadata = {castShadow:false};
      rib.parent = g;
    }
    const bigDoor = mkBox(6,4.6,0.15,0x33373d); bigDoor.position.set(0,2.3,4.55); bigDoor.parent=g;
    const doorSeam = mkBox(0.08,4.6,0.06,0x1e2124); doorSeam.position.set(0,2.3,4.68); doorSeam.parent=g;
    // petite porte piétonne + évents latéraux + faîtage de toit
    const sideDoor = mkBox(1,2.2,0.12,0x2a2e33); sideDoor.position.set(5.02,1.1,-2); sideDoor.rotation.y=Math.PI/2; sideDoor.parent=g;
    for(const vy of [2,4]){
      const vent = mkBox(0.6,0.5,0.15,0x3a3f45);
      vent.position.set(-5.5,vy,4.53); vent.parent=g;
    }
    const ridge = mkBox(0.5,0.3,9.5,0x33373d); ridge.position.y=6.4; ridge.parent=g;
    // contreforts extérieurs le long des grands côtés
    for(let i=0;i<3;i++){
      const strut = mkBox(0.3,6,0.4,0x3a3f45);
      strut.position.set(-4+i*4, 3, 4.7); strut.parent=g;
    }
    // manche à air + projecteur d'approche + numéro de hangar peint
    const windsockPole = mkCyl(0.03,0.03,2,0x8f9499,6); windsockPole.position.set(5.5,7,-4); windsockPole.parent=g;
    const windsock = mkCyl(0.15,0.03,0.8,0xf0c020,8); windsock.rotation.z=Math.PI/2; windsock.position.set(5.9,7.9,-4); windsock.parent=g;
    const spotlight = mkBox(0.4,0.3,0.3,0x2a2e33); spotlight.position.set(0,5.6,4.65); spotlight.parent=g;
    const hangarNum = mkBox(1.2,1,0.03,0xf0f0f0); hangarNum.position.set(-4.5,4,4.56); hangarNum.metadata={castShadow:false}; hangarNum.parent=g;
    // fûts de carburant + cônes de sécurité + échelle d'accès au toit
    for(let i=0;i<3;i++){
      const drum = mkCyl(0.35,0.35,0.9,i%2===0?0xc0472b:0x2a5a3a,12);
      drum.position.set(5.4,0.45,-3.6+i*0.8); drum.parent=g;
    }
    for(let i=0;i<3;i++){
      const coneMat = mkStdMat(_uid('structHangarConeMat'), _scene);
      coneMat.diffuseColor = hexIntToColor3(0xd9a03c);
      const cone = BABYLON.MeshBuilder.CreateCylinder(_uid('structHangarCone'), {diameterTop:0, diameterBottom:0.36, height:0.5, tessellation:8}, _scene);
      cone.material = coneMat;
      cone.position.set(-5.6+i*0.5,0.25,4.9); cone.parent=g;
    }
    const roofLadder = mkBox(0.4,3.4,0.05,0x3a3f45); roofLadder.position.set(-5.4,4.7,4.5); roofLadder.parent=g;
    return g;
  }});
registerAsset({ id:'struct_office', cat:'structures', family:'Urbain & commercial', label:'Bureau', icon:'🏬', color:0xcdd6db, size:[8,9,8],
  build:(c)=>{
    const g = group(mkBox(8,9,8,c,{metalness:0.1,roughness:0.3,map:texConcrete(c),repeatX:4,repeatY:4}));
    addWindowGrid(g, 5, 5, 8, 9, 8.05, 'z', 0x8fc4d6);
    addWindowGrid(g, 5, 5, 8, 9, 8.05, '-z', 0x8fc4d6);
    addWindowGrid(g, 5, 5, 8, 9, 8.05, 'x', 0x8fc4d6);
    addWindowGrid(g, 5, 5, 8, 9, 8.05, '-x', 0x8fc4d6);
    const cap = mkBox(8.2,0.3,8.2,0xa9b2b8); cap.position.y=9; cap.parent=g;
    // rez-de-chaussée vitrine (bandeau vitré pleine hauteur) + auvent d'entrée
    const storefront = mkBox(8.02,1.8,0.05,0x8fc4d6,{opacity:0.5,roughness:0.05});
    storefront.position.set(0,0.9,4.03); storefront.metadata={castShadow:false}; storefront.parent=g;
    const canopy = mkBox(3,0.15,1.4,0x33373d); canopy.position.set(0,2,4.7); canopy.parent=g;
    for(const rx of [-2.5,2.5]){
      const hvac = mkBox(1.2,0.7,1.2,0x8f9499); hvac.position.set(rx,9.35,-2); hvac.parent=g;
    }
    // enseigne lumineuse sur le toit
    const sign = mkBox(3,0.6,0.15,0x1c2128); sign.position.set(0,9.6,0); sign.parent=g;
    const signGlow = mkBox(2.6,0.35,0.02,0x4ecdc4); signGlow.position.set(0,9.6,0.09);
    signGlow.material.emissiveColor = hexIntToColor3(0x4ecdc4);
    signGlow.parent=g;
    // drapeau d'entreprise + jardinières en pied de vitrine + rampe d'accès PMR
    const flagPoleO = mkCyl(0.03,0.03,3,0x8f9499,6); flagPoleO.position.set(-3,1.5,4.5); flagPoleO.parent=g;
    const flagO = mkBox(0.7,0.45,0.02,0x4ecdc4); flagO.position.set(-2.6,2.7,4.5); flagO.parent=g;
    const planterO = mkBox(3,0.5,0.4,0x6b5330); planterO.position.set(2.5,0.25,4.4); planterO.parent=g;
    const ramp = mkBox(2,0.1,1.5,0x8f9499); ramp.rotation.x=-0.15; ramp.position.set(-1.5,0.1,4.9); ramp.parent=g;
    // antennes de toit + range-vélos + banc d'entrée
    for(let i=0;i<3;i++){
      const antO = mkCyl(0.025,0.025,0.9+i*0.3,0x2a2a2a,6);
      antO.position.set(-1+i*0.8,9.15+ (0.45+i*0.15),-3); antO.parent=g;
    }
    for(let i=0;i<4;i++){
      const rackBar = mkBox(0.03,0.35,0.5,0x3a3a3a); rackBar.position.set(1.5+i*0.3,0.18,4.7); rackBar.parent=g;
    }
    const benchO = mkBox(1.4,0.4,0.4,0x5c6470); benchO.position.set(1.5,0.2,3.6); benchO.parent=g;
    return g;
  }});
registerAsset({ id:'struct_tower', cat:'structures', family:'Urbain & commercial', label:'Tour', icon:'🗼', color:0x9aa2a8, size:[5,16,5],
  build:(c)=>{
    const PODIUM_H = 1.6;
    const podium = mkBox(6.6,PODIUM_H,6.6,color3ToHexInt(hexIntToColor3(c).scale(0.85)));
    const towerGroup = new BABYLON.TransformNode(_uid('structTowerGrp'), _scene);
    mkBox(5,16,5,c,{map:texStuc(c),repeatX:3,repeatY:8}).parent = towerGroup;
    addWindowGrid(towerGroup, 2, 7, 5, 16, 5.05, 'z', 0x8fc4d6);
    addWindowGrid(towerGroup, 2, 7, 5, 16, 5.05, '-z', 0x8fc4d6);
    const antenna = mkCyl(0.05,0.08,3,0x2a2a2a,6); antenna.position.y=16+1.5; antenna.parent=towerGroup;
    const roofEquip = mkBox(1.4,0.6,1.4,0x5c6470); roofEquip.position.set(1,16.3,1); roofEquip.parent=towerGroup;
    // balise clignotante au sommet de l'antenne
    const beaconMat = mkStdMat(_uid('structTowerBeaconMat'), _scene);
    beaconMat.diffuseColor = hexIntToColor3(0xff3b1a); beaconMat.emissiveColor = hexIntToColor3(0xff3b1a).scale(1.2);
    const beacon = BABYLON.MeshBuilder.CreateSphere(_uid('structTowerBeacon'), {diameter:0.18,segments:8}, _scene);
    beacon.material = beaconMat;
    beacon.position.y = 16+3; beacon.parent=towerGroup;
    // ceintures techniques horizontales tous les ~5m (casse la
    // silhouette trop lisse d'une simple tour rectangulaire)
    for(let i=1;i<3;i++){
      const belt = mkBox(5.3,0.25,5.3,0x7a828a);
      belt.position.y = i*5; belt.parent=towerGroup;
    }
    // parabole de télécommunication + nacelle de nettoyage + porte d'entrée au podium
    const dishMat = mkStdMat(_uid('structTowerDishMat'), _scene);
    dishMat.diffuseColor = hexIntToColor3(0xd9d9d9); dishMat.backFaceCulling = false;
    const dish = BABYLON.MeshBuilder.CreateSphere(_uid('structTowerDish'), {diameter:1.2,segments:10,slice:0.5}, _scene);
    dish.material = dishMat;
    dish.rotation.x = Math.PI; dish.position.set(-1.5,15.6,0);
    dish.parent = towerGroup;
    const gondola = mkBox(0.5,0.8,0.3,0x2a2e33); gondola.position.set(2.6,10,0); gondola.parent=towerGroup;
    // porte d'entrée sur la façade du podium (podium centré en Y, sa face
    // avant est à z=3.3 et sa base locale à y=-PODIUM_H/2)
    const podiumDoor = mkBox(1.4,1.5,0.15,0x2a2e33);
    podiumDoor.position.set(0,-PODIUM_H/2+0.75,3.32);
    podiumDoor.parent = podium;
    // trappe d'accès sur le toit + jardinières au pied du podium
    const hatch = mkBox(0.8,0.15,0.8,0x3a3f45); hatch.position.set(-1.5,16.35,-1.5); hatch.parent=towerGroup;
    for(const px of [-2.6,2.6]){
      const planterT = mkBox(2,0.5,0.5,0x6b5330); planterT.position.set(px,-PODIUM_H/2+0.25,2.9); planterT.parent=podium;
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
    const roof = mkBox(14.3,0.4,11.3,0x7a7160); roof.position.y=7; roof.parent=g;
    // quais de chargement (3 portes) sur la face avant — nettement en
    // saillie de la façade (et donc de la grille de fenêtres générée
    // automatiquement juste derrière) pour ne jamais s'y chevaucher.
    for(let i=0;i<3;i++){
      const dock = mkBox(2.4,3.4,0.15,0x33373d);
      dock.position.set(-4.4+i*4.4, 1.7, 5.65);
      dock.parent = g;
    }
    // évents de toit + lanterneaux vitrés + bandeau de fenêtres hautes
    for(let i=0;i<3;i++){
      const vent = mkBox(0.8,0.5,0.8,0x5c6470);
      vent.position.set(-4+i*4, 7.4, 0);
      vent.parent = g;
    }
    for(let i=0;i<4;i++){
      const skylight = mkBox(1.4,0.1,1.4,0x8fc4d6,{opacity:0.55,roughness:0.05});
      skylight.position.set(-5+i*3.3, 7.25, 3); skylight.metadata={castShadow:false};
      skylight.parent = g;
    }
    addWindowGrid(g, 6, 1, 14, 7, 11.05, 'z', 0x8fc4d6);
    // escalier extérieur métallique vers une porte latérale
    for(let i=0;i<6;i++){
      const step = mkBox(1,0.1,0.4,0x3a3f45);
      step.position.set(-7.3,0.15+i*0.3,-3+i*0.4); step.metadata={castShadow:false};
      step.parent = g;
    }
    const sideDoor2 = mkBox(1,2.1,0.12,0x2a2e33); sideDoor2.position.set(-7.05,2.75,-0.6); sideDoor2.parent=g;
    // quai de plain-pied + auvent des quais + panneau de numérotation
    const dockPlatform = mkBox(14.3,0.6,1.4,0x6e6e6a); dockPlatform.position.set(0,0.3,6.2); dockPlatform.parent=g;
    const dockCanopy = mkBox(9,0.15,2,0x33373d); dockCanopy.position.set(0,3.8,6); dockCanopy.parent=g;
    for(let i=0;i<3;i++){
      const dockNum = mkBox(0.4,0.4,0.02,0xf0c020); dockNum.position.set(-4.4+i*4.4,3.2,5.73); dockNum.metadata={castShadow:false}; dockNum.parent=g;
    }
    // pile de palettes chargées + coffret électrique + rangée de panneaux solaires sur le toit
    for(let i=0;i<3;i++){
      const palletStack = mkBox(1.2,0.15,1,0x9a7a4a); palletStack.position.set(6,0.15+i*0.5,-4.5); palletStack.parent=g;
      const boxOnPallet = mkBox(0.9,0.35,0.8,0x8a6a3f); boxOnPallet.position.set(6,0.4+i*0.5,-4.5); boxOnPallet.parent=g;
    }
    const elecBox = mkBox(0.5,0.7,0.15,0x3a3f45); elecBox.position.set(-6.85,1.5,-5.2); elecBox.parent=g;
    for(let i=0;i<5;i++){
      const panel = mkBox(1.6,0.06,1,0x1c2530); panel.rotation.z=0.15;
      panel.position.set(-5+i*2.6,7.55,-3); panel.parent=g;
    }
    return g;
  }});

// ---- 10 STRUCTURES SUPPLÉMENTAIRES — même niveau de détail (volume
// principal texturé + accessoires) que les 6 premières.
registerAsset({ id:'struct_kiosk', cat:'structures', family:'Urbain & commercial', label:'Kiosque', icon:'🏪', color:0x6b4a2e, size:[2.6,3,2.6],
  build:(c)=>{
    const base = mkCyl(1.3,1.3,2.2,c,8);
    const roofMat = mkStdMat(_uid('structKioskRoofMat'), _scene);
    roofMat.diffuseColor = hexIntToColor3(0x8a5a2a);
    const roof = BABYLON.MeshBuilder.CreateCylinder(_uid('structKioskRoof'), {diameterTop:0, diameterBottom:3.2, height:1, tessellation:8}, _scene);
    roof.material = roofMat;
    roof.position.y = 2.7; roof.metadata={castShadow:false};
    const g = group(base, roof);
    const counter = mkBox(1.6,0.9,0.15,0x3a3025); counter.position.set(0,0.6,1.2); counter.parent=g;
    const window1 = mkBox(1.4,1,0.1,0x9dd8e0,{opacity:0.5}); window1.position.set(0,1.7,1.25); window1.metadata={castShadow:false}; window1.parent=g;
    const awning = mkBox(1.8,0.08,0.8,0xc0472b); awning.rotation.x=-0.3; awning.position.set(0,2.2,1.7); awning.parent=g;
    // panneau de menu + guirlande lumineuse sous l'auvent + tabouret + enseigne boisson
    const menuBoard = mkBox(0.7,0.9,0.05,0x2a2a2a); menuBoard.position.set(-1.0,1.1,1.3); menuBoard.parent=g;
    for(let i=0;i<7;i++){
      const bulbMat = mkStdMat(_uid('structKioskBulbMat'), _scene);
      bulbMat.diffuseColor = hexIntToColor3(0xfff3c8); bulbMat.emissiveColor = hexIntToColor3(0xfff3c8).scale(0.8);
      const bulb = BABYLON.MeshBuilder.CreateSphere(_uid('structKioskBulb'), {diameter:0.06,segments:6}, _scene);
      bulb.material = bulbMat;
      bulb.position.set(-0.8+i*0.27,2.05,1.95); bulb.parent=g;
    }
    const stool = mkCyl(0.18,0.18,0.5,0x3a3025,10); stool.position.set(1.1,0.25,1.6); stool.parent=g;
    const drinkSign = mkBox(0.5,0.7,0.05,0xf0f0f0); drinkSign.rotation.y=0.3; drinkSign.position.set(1.35,2.1,0.9); drinkSign.parent=g;
    const drinkSignGlow = mkBox(0.4,0.25,0.02,0xff6a39); drinkSignGlow.position.set(1.35+Math.sin(0.3)*0.03,2.1,0.9+Math.cos(0.3)*0.03);
    drinkSignGlow.rotation.y=0.3; drinkSignGlow.material.emissiveColor=hexIntToColor3(0xff6a39).scale(0.9); drinkSignGlow.parent=g;
    return g;
  }});
registerAsset({ id:'struct_gasstation', cat:'structures', family:'Urbain & commercial', label:'Station-service', icon:'⛽', color:0xf0f0f0, size:[10,4.5,6],
  build:(c)=>{
    const canopy = mkBox(10,0.4,6,c,{map:texConcrete(c),repeatX:3,repeatY:2}); canopy.position.y=4.1;
    const g = group(canopy);
    [[-4,-2],[4,-2],[-4,2],[4,2]].forEach(([px,pz])=>{
      const pillar = mkBox(0.4,4.1,0.4,0xd9d9d9); pillar.position.set(px,2.05,pz); pillar.parent=g;
    });
    [-1.5,1.5].forEach(px=>{
      const island = mkBox(0.6,0.3,2,0x8f9499); island.position.set(px,0.15,0); island.parent=g;
      const pump = mkBox(0.5,1.4,0.4,0x2a5ca0); pump.position.set(px,1,0); pump.parent=g;
      const pumpScreen = mkBox(0.3,0.3,0.02,0x4ecdc4); pumpScreen.position.set(px,1.2,0.21);
      pumpScreen.material.emissiveColor=hexIntToColor3(0x4ecdc4).scale(0.8);
      pumpScreen.parent=g;
    });
    const signPole = mkCyl(0.08,0.08,3.5,0x2a2a2a,6); signPole.position.set(-4.5,1.75,3.5); signPole.parent=g;
    const priceSign = mkBox(1.4,1.6,0.15,0xf0f0f0); priceSign.position.set(-4.5,4,3.5); priceSign.parent=g;
    // poubelle + station de gonflage + panneau pression pneus + cônes
    const trashBinG = mkCyl(0.25,0.22,0.6,0x2a5a3a,10); trashBinG.position.set(3.8,0.3,2.5); trashBinG.parent=g;
    const airPump = mkBox(0.4,1,0.3,0xf0f0f0); airPump.position.set(-3.8,0.5,2.2); airPump.parent=g;
    const airPumpHose = mkCyl(0.03,0.03,0.7,0x1c1c1c,6); airPumpHose.rotation.z=Math.PI/2.5; airPumpHose.position.set(-3.5,0.7,2.4); airPumpHose.parent=g;
    const psiSign = mkBox(0.3,0.2,0.02,0x2a5ca0); psiSign.position.set(-3.8,1.05,2.36); psiSign.metadata={castShadow:false}; psiSign.parent=g;
    for(let i=0;i<2;i++){
      const coneMat = mkStdMat(_uid('structGasstationConeMat'), _scene);
      coneMat.diffuseColor = hexIntToColor3(0xd9a03c);
      const coneG = BABYLON.MeshBuilder.CreateCylinder(_uid('structGasstationCone'), {diameterTop:0, diameterBottom:0.32, height:0.45, tessellation:8}, _scene);
      coneG.material = coneMat;
      coneG.position.set(4.5,0.22,-2+i*1); coneG.parent=g;
    }
    return g;
  }});
registerAsset({ id:'struct_silo', cat:'structures', family:'Urbain & commercial', label:'Silo', icon:'🌾', color:0xc9c2b0, size:[4,10,4],
  build:(c)=>{
    const body = mkCyl(2,2,8,c,16);
    const capMat = mkStdMat(_uid('structSiloCapMat'), _scene);
    capMat.diffuseColor = hexIntToColor3(0x8f9499);
    const cap = BABYLON.MeshBuilder.CreateCylinder(_uid('structSiloCap'), {diameterTop:0, diameterBottom:4, height:1.6, tessellation:16}, _scene);
    cap.material = capMat;
    cap.position.y = 8.8; cap.metadata={castShadow:false};
    const g = group(body, cap);
    for(let i=0;i<3;i++){
      const ringMat = mkStdMat(_uid('structSiloRingMat'), _scene);
      ringMat.diffuseColor = hexIntToColor3(0x8f9499); ringMat.backFaceCulling = false;
      const ring = BABYLON.MeshBuilder.CreateTorus(_uid('structSiloRing'), {diameter:2.02*2, thickness:0.1, tessellation:20}, _scene);
      ring.material = ringMat;
      ring.rotation.x = Math.PI/2; ring.position.y = 2+i*2.5; ring.parent=g;
    }
    const ladder = mkBox(0.4,8,0.06,0x2a2a2a); ladder.position.set(0,4,2.02); ladder.parent=g;
    for(const [lx,lz] of [[-1.6,-1.6],[1.6,-1.6],[-1.6,1.6],[1.6,1.6]]){
      const leg = mkBox(0.25,1,0.25,0x5c6470); leg.position.set(lx,0.5,lz); leg.parent=g;
    }
    // goulotte de déchargement + coffret de commande + bande d'avertissement au pied
    const chute = mkCyl(0.15,0.25,1.4,0x5c6470,10); chute.rotation.z=0.6; chute.position.set(1.7,0.65,0); chute.parent=g;
    const controlPanel = mkBox(0.4,0.5,0.2,0x2a2a2a); controlPanel.position.set(0,0.5,2.05); controlPanel.parent=g;
    for(let i=0;i<8;i++){
      const stripe = mkBox(0.35,0.15,0.02, i%2===0?0x1c1c1c:0xf0c020);
      const ang = (i/8)*Math.PI*2;
      stripe.position.set(Math.sin(ang)*2.01, 0.08, Math.cos(ang)*2.01);
      stripe.rotation.y = ang; stripe.parent=g;
    }
    return g;
  }});
registerAsset({ id:'struct_parking', cat:'structures', family:'Urbain & commercial', label:'Parking étagé', icon:'🅿️', color:0xa9b2b8, size:[16,8,12],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('structParkingGrp'), _scene);
    const LEVELS = 3, LVL_H = 2.7;
    const colXZ = [[-7.5,-5.5],[7.5,-5.5],[-7.5,5.5],[7.5,5.5],[0,-5.5],[0,5.5]];
    const concreteTex = texConcrete(c);
    const railPaint = texStylizedPanel(0xf0c020, 0x8a6a1a);
    for(let lvl=0;lvl<LEVELS;lvl++){
      const y = lvl*LVL_H;
      const slab = mkBox(16,0.3,12,c,{map:concreteTex,repeatX:5,repeatY:4});
      slab.position.y = y; slab.parent=g;
      // Colonnes chanfreinées (mkBevelBox) : lecture nette de la lumière
      // sur les arêtes, plutôt que des pavés plats sans relief.
      for(const [px,pz] of colXZ){
        const col = mkBevelBox(0.42,LVL_H,0.42,0x8f9499,{bevel:0.03,roughness:0.75,metalness:0.12});
        col.position.set(px,y+LVL_H/2,pz); col.parent=g;
      }
      // Marquage au sol : lignes de places + flèche de circulation —
      // vendent l'usage "parking" bien mieux qu'une dalle nue.
      for(let i=0;i<5;i++){
        const stripe = mkBox(0.07,0.02,9.5,0xeef0f0); stripe.position.set(-6+i*3,y+0.16,0); stripe.metadata={castShadow:false}; stripe.parent=g;
      }
      const arrow = mkBox(0.45,0.02,1.1,0xf0c020); arrow.position.set(2.6,y+0.17,-4.2); arrow.metadata={castShadow:false}; arrow.parent=g;
      const arrowHead = mkBox(0.9,0.02,0.45,0xf0c020); arrowHead.position.set(2.6,y+0.17,-3.65); arrowHead.metadata={castShadow:false}; arrowHead.parent=g;
      // Réglette lumineuse suspendue au plafond du niveau au-dessus
      // (ou au ciel pour le dernier) — casse la monotonie des dalles vides.
      for(const lx of [-4.5,0,4.5]){
        const fixture = mkBox(0.7,0.06,0.18,0xf0f0f0); fixture.position.set(lx,y+LVL_H-0.22,0); fixture.metadata={castShadow:false}; fixture.parent=g;
        const glow = mkBox(0.55,0.02,0.1,0xfff3c8); glow.position.set(lx,y+LVL_H-0.26,0); glow.metadata={castShadow:false};
        glow.material.emissiveColor=hexIntToColor3(0xfff3c8).scale(0.9); glow.parent=g;
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
      ramp.parent = g;
      // chevrons peints indiquant le sens de montée
      for(let i=-1;i<=1;i+=2){
        const chevron = mkBox(0.9,0.02,0.14,0xf0f0f0);
        chevron.position.set(6.3*side, yMid + i*0.55, i*1.15);
        chevron.rotation.x = -rampAngle; chevron.metadata={castShadow:false}; chevron.parent=g;
      }
      // Garde-corps métalliques de part et d'autre de la pente, alignés
      // sur son inclinaison — élément qui manquait totalement avant et
      // qui vend la cohérence structurelle de la rampe.
      for(const zSide of [-1,1]){
        const rail = mkBevelBox(0.08,0.55,rampLen,0xf0c020,{bevel:0.01,map:railPaint,roughness:0.5,metalness:0.3});
        rail.rotation.x = -rampAngle;
        rail.position.set(6.3*side + zSide*rampWidth/2, yMid+0.32, 0);
        rail.parent = g;
      }
    }
    for(let i=0;i<4;i++){
      const rail = mkBox(16,0.6,0.06,0xf0c020); rail.position.set(0,i*2.7,6); rail.parent=g;
    }
    const pLetter = mkBox(1,1,0.05,0x2a5ca0); pLetter.position.set(0,1.5,6.03); pLetter.material.emissiveColor=hexIntToColor3(0x2a5ca0).scale(0.6); pLetter.parent=g;
    // caméra de sécurité à l'entrée + dos d'âne + panneaux de niveau
    const camP = mkBox(0.15,0.15,0.3,0x1c1c1c); camP.position.set(6,2.5,5.9); camP.rotation.x=0.3; camP.parent=g;
    const speedBump = mkBox(3,0.08,0.3,0xf0c020); speedBump.position.set(0,0.04,0.5); speedBump.parent=g;
    for(let lvl=0;lvl<3;lvl++){
      const levelSign = mkBox(0.7,0.5,0.03,0x1c2128); levelSign.position.set(-7.5,lvl*2.7+2,6.03); levelSign.parent=g;
    }
    return g;
  }});
registerAsset({ id:'struct_guardpost', cat:'structures', family:'Urbain & commercial', label:'Poste de garde', icon:'💂', color:0xe8e2d0, size:[2,2.6,2],
  build:(c)=>{
    const g = group(mkBox(2,2.3,2,c));
    const roof = mkBox(2.3,0.2,2.3,0x5c6470); roof.position.y=2.4; roof.parent=g;
    for(let i=0;i<3;i++){
      const win = mkBox(0.5,0.8,0.03,0x9dd8e0,{opacity:0.5}); win.position.set(-0.7+i*0.7,1.4,1.02); win.metadata={castShadow:false}; win.parent=g;
    }
    const barrierPole = mkCyl(0.08,0.08,0.6,0x2a2a2a,6); barrierPole.position.set(1.3,0.3,1.3); barrierPole.parent=g;
    const barrierArm = mkBox(3,0.1,0.15, 0xf0c020); barrierArm.position.set(2.8,0.6,1.3); barrierArm.parent=g;
    for(let i=0;i<4;i++){
      const stripe = mkBox(0.4,0.1,0.16, i%2===0?0x1c1c1c:0xf0c020); stripe.position.set(1.4+i*0.7,0.6,1.3); stripe.parent=g;
    }
    // sacs de sable empilés + projecteur de toit + mât à drapeau
    for(let i=0;i<3;i++){
      const sandbagMat = mkStdMat(_uid('structGuardpostSandbagMat'), _scene);
      sandbagMat.diffuseColor = hexIntToColor3(0x9a8a6a); sandbagMat.metadata = {roughness:1};
      const sandbag = BABYLON.MeshBuilder.CreateSphere(_uid('structGuardpostSandbag'), {diameter:0.44,segments:8}, _scene);
      sandbag.material = sandbagMat;
      sandbag.scaling.set(1.3,0.7,1);
      sandbag.position.set(-1.15,0.2+Math.floor(i/2)*0.35,-0.7+ (i%2)*0.5); sandbag.parent=g;
    }
    const spotlightG = mkBox(0.3,0.2,0.2,0x2a2a2a); spotlightG.position.set(-0.8,2.55,0.8); spotlightG.parent=g;
    const flagPoleG = mkCyl(0.03,0.03,2.2,0x8f9499,6); flagPoleG.position.set(0.9,1.1,-0.9); flagPoleG.parent=g;
    const flagG = mkBox(0.5,0.35,0.02,0x4ecdc4); flagG.position.set(1.15,1.9,-0.9); flagG.parent=g;
    return g;
  }});
registerAsset({ id:'struct_watertower', cat:'structures', family:'Urbain & commercial', label:"Château d'eau", icon:'🗼', color:0x6b5a45, size:[5,12,5],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('structWatertowerGrp'), _scene);
    for(const [lx,lz] of [[-1.3,-1.3],[1.3,-1.3],[-1.3,1.3],[1.3,1.3]]){
      const leg = mkBox(0.35,9,0.35,0x4a3a26); leg.position.set(lx,4.5,lz); leg.rotation.z=Math.atan2(lx,9)*0.5; leg.parent=g;
    }
    for(let i=0;i<3;i++){
      const brace = mkBox(3,0.1,0.1,0x4a3a26); brace.position.set(0,2+i*2.5,1.3); brace.parent=g;
      const brace2 = mkBox(0.1,0.1,3,0x4a3a26); brace2.position.set(1.3,2+i*2.5,0); brace2.parent=g;
    }
    const tank = mkCyl(2.2,2.2,3.4,c,14); tank.position.y=10.7; tank.parent=g;
    const roofMat = mkStdMat(_uid('structWatertowerRoofMat'), _scene);
    roofMat.diffuseColor = hexIntToColor3(0x4a3a26);
    const roof = BABYLON.MeshBuilder.CreateCylinder(_uid('structWatertowerRoof'), {diameterTop:0, diameterBottom:4.6, height:1, tessellation:14}, _scene);
    roof.material = roofMat;
    roof.position.y=13; roof.metadata={castShadow:false}; roof.parent=g;
    const ladder2 = mkBox(0.3,9,0.05,0x2a2a2a); ladder2.position.set(1.3,4.5,1.3); ladder2.parent=g;
    // arceaux de sécurité autour de l'échelle + plateforme au sommet + conduite verticale
    // THREE.TorusGeometry(r,tube,radialSegs,tubularSegs,arc=Math.PI) — un
    // demi-tore. BABYLON.CreateTorus n'a pas de paramètre d'arc ; on garde
    // le tore complet (léger écart visuel accepté, cf. règles de portage).
    for(let i=0;i<5;i++){
      const hoopMat = mkStdMat(_uid('structWatertowerHoopMat'), _scene);
      hoopMat.diffuseColor = hexIntToColor3(0x2a2a2a);
      const hoop = BABYLON.MeshBuilder.CreateTorus(_uid('structWatertowerHoop'), {diameter:0.7, thickness:0.04, tessellation:12}, _scene);
      hoop.material = hoopMat;
      hoop.rotation.y = Math.PI/2; hoop.position.set(1.3,1.5+i*1.7,1.3); hoop.parent=g;
    }
    const topPlatform = mkCyl(2.5,2.5,0.06,0x4a4a44,14); topPlatform.position.y=9.05; topPlatform.parent=g;
    const platRailMat = mkStdMat(_uid('structWatertowerPlatRailMat'), _scene);
    platRailMat.diffuseColor = hexIntToColor3(0x2a2a2a);
    const platRail = BABYLON.MeshBuilder.CreateTorus(_uid('structWatertowerPlatRail'), {diameter:5, thickness:0.06, tessellation:20}, _scene);
    platRail.material = platRailMat;
    platRail.rotation.x=Math.PI/2; platRail.position.y=9.4; platRail.parent=g;
    const standpipe = mkCyl(0.12,0.12,7,0x4a4a44,8); standpipe.position.set(0,3.5,2.1); standpipe.parent=g;
    return g;
  }});
registerAsset({ id:'struct_greenhouse', cat:'structures', family:'Urbain & commercial', label:'Serre', icon:'🌿', color:0xd6dde0, size:[8,4,10],
  build:(c)=>{
    const walls = mkBox(8,2.6,10,c,{opacity:0.4,roughness:0.1,metalness:0.15});
    const g = group(walls);
    for(let i=1;i<8;i++){
      const frameV = mkBox(0.06,2.6,10.02,0x3a4a52); frameV.position.set(-4+i,1.3,0); frameV.metadata={castShadow:false}; frameV.parent=g;
    }
    const roofL = mkBox(4.2,0.06,10.2,0xc9d2d6,{opacity:0.4}); roofL.rotation.z=0.5; roofL.position.set(-2,3.8,0); roofL.metadata={castShadow:false}; roofL.parent=g;
    const roofR = mkBox(4.2,0.06,10.2,0xc9d2d6,{opacity:0.4}); roofR.rotation.z=-0.5; roofR.position.set(2,3.8,0); roofR.metadata={castShadow:false}; roofR.parent=g;
    const ridge2 = mkBox(0.15,0.15,10.2,0x3a4a52); ridge2.position.y=4.65; ridge2.parent=g;
    for(let i=0;i<4;i++){
      const plantBed = mkBox(1.2,0.5,8,0x4f7a3a); plantBed.position.set(-3+i*2,0.25,0); plantBed.metadata={castShadow:false}; plantBed.parent=g;
    }
    // tuyaux d'irrigation le long des bacs + pots à l'entrée + trappe d'aération au toit
    for(let i=0;i<4;i++){
      const irrigPipe = mkCyl(0.02,0.02,7.8,0x2a5a3a,6); irrigPipe.rotation.x=Math.PI/2;
      irrigPipe.position.set(-3+i*2,0.52,0); irrigPipe.parent=g;
    }
    for(const px of [-3.2,3.2]){
      const pot = mkCyl(0.25,0.2,0.35,0x8a6a3f,10); pot.position.set(px,0.18,4.7); pot.parent=g;
      const plantTopMat = mkStdMat(_uid('structGreenhousePlantTopMat'), _scene);
      plantTopMat.diffuseColor = hexIntToColor3(0x4f7a3a);
      const plantTop = BABYLON.MeshBuilder.CreateSphere(_uid('structGreenhousePlantTop'), {diameter:0.44,segments:7}, _scene);
      plantTop.material = plantTopMat;
      plantTop.position.set(px,0.5,4.7); plantTop.parent=g;
    }
    const roofVentG = mkBox(1,0.15,0.6,0xc9d2d6,{opacity:0.4}); roofVentG.rotation.z=0.4; roofVentG.position.set(0,4.55,3.5); roofVentG.metadata={castShadow:false}; roofVentG.parent=g;
    return g;
  }});
registerAsset({ id:'struct_mall', cat:'structures', family:'Urbain & commercial', label:'Centre commercial', icon:'🏬', color:0xd9d2bc, size:[20,6,14],
  build:(c)=>{
    const g = group(mkBox(20,6,14,c,{map:texStuc(c),repeatX:6,repeatY:2}));
    const entranceGlass = mkBox(8,4,0.1,0x8fc4d6,{opacity:0.5,roughness:0.05}); entranceGlass.position.set(0,2,7.05); entranceGlass.metadata={castShadow:false}; entranceGlass.parent=g;
    const entranceCanopy = mkBox(9,0.2,2.5,0x33373d); entranceCanopy.position.set(0,4.2,8); entranceCanopy.parent=g;
    const mallSign = mkBox(5,1,0.2,0x1c2128); mallSign.position.set(0,5.3,7.2); mallSign.parent=g;
    const mallSignGlow = mkBox(4.6,0.7,0.02,0xff6a39); mallSignGlow.position.set(0,5.3,7.31);
    mallSignGlow.material.emissiveColor=hexIntToColor3(0xff6a39); mallSignGlow.parent=g;
    for(let i=0;i<8;i++){
      const stripe = mkBox(0.15,0.02,3,0xf0f0f0); stripe.position.set(-9+i*2.4,0.02,10); stripe.metadata={castShadow:false}; stripe.parent=g;
    }
    // borne ATM extérieure + poubelles jumelles + jardinières d'entrée
    const atm = mkBox(0.5,1.4,0.4,0x2a2a2a); atm.position.set(-6,0.7,7.2); atm.parent=g;
    const atmScreen = mkBox(0.3,0.25,0.02,0x4ecdc4); atmScreen.position.set(-6,1.1,7.41);
    atmScreen.material.emissiveColor=hexIntToColor3(0x4ecdc4).scale(0.7); atmScreen.parent=g;
    for(const px of [-3.5,3.5]){
      const binM = mkCyl(0.25,0.22,0.6,0x3a3f45,10); binM.position.set(px,0.3,7.5); binM.parent=g;
    }
    for(const px of [-6.5,6.5]){
      const planterM = mkBox(2.2,0.5,0.5,0x6b5330); planterM.position.set(px,0.25,7.3); planterM.parent=g;
    }
    return g;
  }});
registerAsset({ id:'struct_factory', cat:'structures', family:'Urbain & commercial', label:'Usine', icon:'🏗️', color:0x6a6a62, size:[12,9,10],
  build:(c)=>{
    const g = group(mkBox(12,9,10,c,{map:texConcrete(c),repeatX:4,repeatY:3}));
    const stack = mkCyl(0.8,1,7,0x4a4a44,12); stack.position.set(-4,9,-3); stack.parent=g;
    const stackTop = mkCyl(0.9,0.8,0.6,0x2a2a24,12); stackTop.position.set(-4,12.8,-3); stackTop.parent=g;
    addWindowGrid(g, 6, 2, 12, 9, 10.05, 'z', 0xd9a03c);
    const pipeF = mkCyl(0.15,0.15,6,0x5c6470,8); pipeF.rotation.z=Math.PI/2; pipeF.position.set(2,7,5.05); pipeF.parent=g;
    // réseau de tuyaux verticaux + cuve de stockage + bande d'avertissement au pied de la cheminée
    for(let i=0;i<3;i++){
      const vpipe = mkCyl(0.1,0.1,7,0x5c6470,8); vpipe.position.set(-5.5+i*0.4,3.5,5.05); vpipe.parent=g;
    }
    const tankF = mkCyl(1.1,1.1,3,0x8f9499,14); tankF.rotation.z=Math.PI/2; tankF.position.set(5.2,2,-3.5); tankF.parent=g;
    for(let i=0;i<3;i++){
      const tankRingMat = mkStdMat(_uid('structFactoryTankRingMat'), _scene);
      tankRingMat.diffuseColor = hexIntToColor3(0x4a4a44);
      const tankRing = BABYLON.MeshBuilder.CreateTorus(_uid('structFactoryTankRing'), {diameter:2.24, thickness:0.06, tessellation:16}, _scene);
      tankRing.material = tankRingMat;
      tankRing.rotation.y=Math.PI/2; tankRing.position.set(4.3+i*0.9,2,-3.5); tankRing.parent=g;
    }
    for(let i=0;i<6;i++){
      const stackStripe = mkBox(0.42, 0.18, 0.42, i%2===0?0x1c1c1c:0xf0c020);
      const ang=(i/6)*Math.PI*2;
      stackStripe.position.set(-4+Math.sin(ang)*0.5, 0.2, -3+Math.cos(ang)*0.5);
      stackStripe.parent=g;
    }
    return g;
  }});
registerAsset({ id:'struct_busshelter', cat:'structures', family:'Urbain & commercial', label:'Abri bus', icon:'🚏', color:0xb9b2a0, size:[3,2.6,1.5],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('structBusshelterGrp'), _scene);
    const roofBus = mkBox(3,0.1,1.5,0x5c6470); roofBus.position.y=2.5; roofBus.parent=g;
    const backGlass = mkBox(3,2,0.06,0x9dd8e0,{opacity:0.4}); backGlass.position.set(0,1.2,-0.7); backGlass.metadata={castShadow:false}; backGlass.parent=g;
    const sideGlass = mkBox(0.06,2,1.4,0x9dd8e0,{opacity:0.4}); sideGlass.position.set(-1.45,1.2,0); sideGlass.metadata={castShadow:false}; sideGlass.parent=g;
    for(const px of [-1.45,1.45]){
      const post = mkBox(0.1,2.5,0.1,0x3a3a3a); post.position.set(px,1.25,-0.65); post.parent=g;
    }
    const bench = mkBox(2.6,0.4,0.4,0x5c6470); bench.position.set(0,0.4,0.4); bench.parent=g;
    const routeSign = mkBox(0.4,0.6,0.05,0x2a5ca0); routeSign.position.set(1.6,2,0); routeSign.parent=g;
    // poubelle + panneau d'horaires + applique lumineuse sous l'auvent
    const trashBinBus = mkCyl(0.18,0.16,0.5,0x3a3f45,10); trashBinBus.position.set(-1.6,0.25,0.5); trashBinBus.parent=g;
    const timetable = mkBox(0.5,0.6,0.03,0xf0f0f0); timetable.position.set(-1.42,1.5,-0.4); timetable.rotation.y=Math.PI/2; timetable.parent=g;
    const shelterLampMat = mkStdMat(_uid('structBusshelterLampMat'), _scene);
    shelterLampMat.diffuseColor = hexIntToColor3(0xfff3c8); shelterLampMat.emissiveColor = hexIntToColor3(0xfff3c8).scale(0.9);
    const shelterLamp = BABYLON.MeshBuilder.CreateSphere(_uid('structBusshelterLamp'), {diameter:0.12,segments:8}, _scene);
    shelterLamp.material = shelterLampMat;
    shelterLamp.position.set(0,2.42,0); shelterLamp.parent=g;
    return g;
  }});
// Structure métallique stylisée AAA (garde-corps/portique) : rupture de
// section poteau carré chanfreiné / barre cylindrique, manchons de
// jonction, embases élargies boulonnées, peinture mate + accent métal
// exposé aux collerettes — voir l'analyse "structure métallique avec
// barre horizontale" du brief.
registerAsset({ id:'struct_railing_metal', cat:'structures', family:'Urbain & commercial', label:'Garde-corps métallique (AAA)', icon:'🚧', color:0x2e3a4a, size:[2.4,1.1,0.15],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('structRailingMetalGrp'), _scene);
    const paintTex = texStylizedPanel(c, 0x9aa0a6);
    const postH = 1.05, postW = 0.09, barY = postH*0.92;
    const postXs = [-1.1, 1.1];
    postXs.forEach(px=>{
      const post = mkBevelBox(postW, postH, postW, c, {bevel:0.015, roughness:0.55, metalness:0.4, map:paintTex});
      post.position.x = px; post.parent=g;
      // embase élargie boulonnée au sol (platine de fixation)
      const plate = mkBevelBox(0.24,0.035,0.24,0x4a4e55,{bevel:0.006, roughness:0.5, metalness:0.45});
      plate.position.x = px; plate.parent=g;
      [[-0.09,-0.09],[0.09,-0.09],[-0.09,0.09],[0.09,0.09]].forEach(([bx,bz])=>{
        const bolt = mkCyl(0.014,0.014,0.035,0x2a2e33,6);
        bolt.rotation.x = Math.PI/2; bolt.position.set(px+bx,0.02,bz); bolt.parent=g;
      });
      // manchon de jonction poteau/barre (casse la monotonie du tube, lecture FPS)
      const collar = mkCyl(0.065,0.065,0.09,0x9aa0a6,10);
      collar.rotation.x = Math.PI/2; collar.position.set(px,barY,0); collar.parent=g;
    });
    // barre horizontale — diamètre légèrement exagéré pour rester lisible
    // à distance (règle stylisée : +15-25% par rapport au réalisme brut)
    const barMat = mkStdMat(_uid('structRailingMetalBarMat'), _scene);
    barMat.diffuseColor = hexIntToColor3(c);
    barMat.metadata = { roughness:0.5, metalness:0.45 };
    const barTex = paintTex.clone(); // .clone() ne copie pas le contenu dessiné, voir mkBox pour le détail du bug
    barTex.getContext().drawImage(paintTex.getContext().canvas, 0, 0);
    barTex.update();
    barTex.wrapU = barTex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    barTex.uScale = 3; barTex.vScale = 1;
    barMat.diffuseTexture = barTex;
    barMat.diffuseColor = new BABYLON.Color3(1,1,1);
    const bar = BABYLON.MeshBuilder.CreateCylinder(_uid('structRailingMetalBar'), {diameterTop:0.09, diameterBottom:0.09, height:2.3, tessellation:12}, _scene);
    bar.material = barMat;
    bar.rotation.z = Math.PI/2; bar.position.y = barY;
    bar.metadata = { castShadow:true }; bar.receiveShadows = true;
    bar.parent = g;
    // cordons de soudure suggérés aux jonctions (détail tertiaire, coût quasi nul)
    postXs.forEach(px=>{
      const weld = mkCyl(0.07,0.07,0.02,0x9aa0a6,10);
      weld.rotation.x = Math.PI/2; weld.position.set(px,barY,0); weld.parent=g;
    });
    return g;
  }});

  // ============================================================
  // NATURE — partie C : végétation basse, champignons/bois mort/lianes,
  // cactus, roches & minéraux, points d'eau, terrain & volcanisme, divers.
  // Portage direct de map_assets.js lignes 3317-3457 (Three.js -> Babylon).
  // Utilise les helpers déjà portés : mkBox, mkCyl, group, hexIntToColor3,
  // _uid, buildTreeAsset, buildRockAsset, buildCrystalAsset, buildWaterPatch,
  // buildGroundPatch, registerAsset, _scene (voir map_assets_babylon.js).
  // ============================================================

  // -- Végétation basse (7) --
  registerAsset({ id:'nat_bush2', cat:'nature', family:'Végétation basse', label:'Buisson clairsemé', icon:'🌿', color:0x4f7a3a, size:[1.2,1,1.2],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('bush2Grp'), _scene);
      for(let i=0;i<3;i++){
        const lobeMat = mkStdMat(_uid('bush2LobeMat'), _scene);
        lobeMat.diffuseColor = hexIntToColor3(c); lobeMat.metadata = {roughness:1};
        const lobe = BABYLON.MeshBuilder.CreatePolyhedron(_uid('bush2Lobe'), {type:3, size:0.4+Math.random()*0.15}, _scene);
        lobe.material = lobeMat;
        lobe.position.set((Math.random()-0.5)*0.5, 0.35+Math.random()*0.15, (Math.random()-0.5)*0.5);
        lobe.metadata = {castShadow:true};
        lobe.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_flowerbush', cat:'nature', family:'Végétation basse', label:'Arbuste fleuri', icon:'🌺', color:0x4f7a3a, size:[1.2,1,1.2],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('flowerbushGrp'), _scene);
      const baseMat = mkStdMat(_uid('flowerbushBaseMat'), _scene);
      baseMat.diffuseColor = hexIntToColor3(0x4f7a3a); baseMat.metadata = {roughness:1};
      const base = BABYLON.MeshBuilder.CreatePolyhedron(_uid('flowerbushBase'), {type:3, size:0.45}, _scene);
      base.material = baseMat; base.position.y = 0.4; base.parent = g;
      const petalColors = [0xe85d75,0xf0c020,0xffffff];
      for(let i=0;i<6;i++){
        const petalMat = mkStdMat(_uid('flowerbushPetalMat'), _scene);
        petalMat.diffuseColor = hexIntToColor3(petalColors[i%3]);
        const petal = BABYLON.MeshBuilder.CreatePolyhedron(_uid('flowerbushPetal'), {type:3, size:0.09}, _scene);
        petal.material = petalMat;
        const ang = Math.random()*Math.PI*2, dist = 0.3+Math.random()*0.2;
        petal.position.set(Math.cos(ang)*dist, 0.4+Math.random()*0.3, Math.sin(ang)*dist);
        petal.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_tallgrass', cat:'nature', family:'Végétation basse', label:'Herbe haute', icon:'🌾', color:0x6a9a48, size:[0.8,0.9,0.8],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('tallgrassGrp'), _scene);
      for(let i=0;i<7;i++){
        const bh = 0.55+Math.random()*0.35;
        const blade = mkCyl(0.02,0.05,bh,c,4);
        const ang = Math.random()*Math.PI*2, dist = Math.random()*0.25;
        blade.position.set(Math.cos(ang)*dist, bh/2, Math.sin(ang)*dist);
        blade.rotation.z = (Math.random()-0.5)*0.4;
        blade.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_fern2', cat:'nature', family:'Végétation basse', label:'Fougère basse', icon:'🌿', color:0x3f6b32, size:[0.7,0.5,0.7],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('fern2Grp'), _scene);
      for(let i=0;i<6;i++){
        const frond = mkBox(0.08,0.02,0.5,c);
        frond.position.y = 0.15;
        frond.rotation.y = i/6*Math.PI*2;
        frond.rotation.x = -0.5;
        frond.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_flower_red', cat:'nature', family:'Végétation basse', label:'Fleur rouge', icon:'🌹', color:0xd8384a, size:[0.3,0.35,0.3],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('flowerRedGrp'), _scene);
      const stem = mkCyl(0.02,0.025,0.3,0x3f6b32);
      stem.parent = g;
      const bloomMat = mkStdMat(_uid('flowerRedBloomMat'), _scene);
      bloomMat.diffuseColor = hexIntToColor3(0xd8384a);
      const bloom = BABYLON.MeshBuilder.CreatePolyhedron(_uid('flowerRedBloom'), {type:3, size:0.09}, _scene);
      bloom.material = bloomMat; bloom.position.y = 0.32; bloom.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_flower_blue', cat:'nature', family:'Végétation basse', label:'Fleur bleue', icon:'💠', color:0x3f6fd8, size:[0.3,0.35,0.3],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('flowerBlueGrp'), _scene);
      const stem = mkCyl(0.02,0.025,0.3,0x3f6b32);
      stem.parent = g;
      const bloomMat = mkStdMat(_uid('flowerBlueBloomMat'), _scene);
      bloomMat.diffuseColor = hexIntToColor3(0x3f6fd8);
      const bloom = BABYLON.MeshBuilder.CreatePolyhedron(_uid('flowerBlueBloom'), {type:3, size:0.09}, _scene);
      bloom.material = bloomMat; bloom.position.y = 0.32; bloom.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_flower_yellow', cat:'nature', family:'Végétation basse', label:'Fleur jaune', icon:'🌼', color:0xf0c020, size:[0.3,0.35,0.3],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('flowerYellowGrp'), _scene);
      const stem = mkCyl(0.02,0.025,0.3,0x3f6b32);
      stem.parent = g;
      const bloomMat = mkStdMat(_uid('flowerYellowBloomMat'), _scene);
      bloomMat.diffuseColor = hexIntToColor3(0xf0c020);
      const bloom = BABYLON.MeshBuilder.CreatePolyhedron(_uid('flowerYellowBloom'), {type:3, size:0.09}, _scene);
      bloom.material = bloomMat; bloom.position.y = 0.32; bloom.parent = g;
      return g;
    }});

  // -- Champignons, bois mort, lianes (6) --
  registerAsset({ id:'nat_mushroom2', cat:'nature', family:'Champignons & bois mort', label:'Champignon', icon:'🍄', color:0xc0472b, size:[0.3,0.25,0.3],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('mushroom2Grp'), _scene);
      const stalk = mkCyl(0.04,0.05,0.18,0xe8ddc0);
      stalk.parent = g;
      const capMat = mkStdMat(_uid('mushroom2CapMat'), _scene);
      capMat.diffuseColor = hexIntToColor3(0xc0472b);
      const cap = BABYLON.MeshBuilder.CreateSphere(_uid('mushroom2Cap'), {diameter:0.22, segmentsW:8, segmentsH:6, slice:0.55}, _scene);
      cap.material = capMat; cap.position.y = 0.18; cap.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_mushroom_giant', cat:'nature', family:'Champignons & bois mort', label:'Champignon géant', icon:'🍄', color:0xa8382a, size:[1.2,1.4,1.2],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('mushroomGiantGrp'), _scene);
      const stalk = mkCyl(0.22,0.28,1,0xe8ddc0);
      stalk.parent = g;
      const capMat = mkStdMat(_uid('mushroomGiantCapMat'), _scene);
      capMat.diffuseColor = hexIntToColor3(0xa8382a);
      const cap = BABYLON.MeshBuilder.CreateSphere(_uid('mushroomGiantCap'), {diameter:1.3, segmentsW:10, segmentsH:7, slice:0.55}, _scene);
      cap.material = capMat; cap.position.y = 1; cap.metadata = {castShadow:true}; cap.parent = g;
      const spotMat = mkStdMat(_uid('mushroomGiantSpotMat'), _scene);
      spotMat.diffuseColor = hexIntToColor3(0xf0e8d8); spotMat.backFaceCulling = false;
      for(let i=0;i<5;i++){
        const spot = BABYLON.MeshBuilder.CreateDisc(_uid('mushroomGiantSpot'), {radius:0.07, tessellation:8}, _scene);
        spot.material = spotMat;
        const ang = Math.random()*Math.PI*2, r = Math.random()*0.4;
        spot.position.set(Math.cos(ang)*r, 1.35, Math.sin(ang)*r);
        spot.rotation.x = -Math.PI/2;
        spot.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_stump', cat:'nature', family:'Champignons & bois mort', label:'Souche', icon:'🪵', color:0x6b5330, size:[0.7,0.5,0.7],
    build:(c)=>{
      const g = group(mkCyl(0.32,0.36,0.45,c,10));
      const ringMat = mkStdMat(_uid('stumpRingMat'), _scene);
      ringMat.diffuseColor = hexIntToColor3(0xb08a5a); ringMat.backFaceCulling = false;
      const ring = BABYLON.MeshBuilder.CreateDisc(_uid('stumpRing'), {radius:0.3, tessellation:16}, _scene);
      ring.material = ringMat; ring.rotation.x = -Math.PI/2; ring.position.y = 0.451;
      ring.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_log2', cat:'nature', family:'Champignons & bois mort', label:'Tronc tombé', icon:'🪵', color:0x6b5330, size:[2.4,0.5,0.6],
    build:(c)=>{
      const g = group();
      const log = mkCyl(0.26,0.3,2.4,c,10);
      log.rotation.z = Math.PI/2; log.position.y = 0.28; log.metadata = {castShadow:true}; log.receiveShadows = true;
      log.parent = g;
      const endCap = mkCyl(0.25,0.25,0.03,0xe8dcc0,10);
      endCap.rotation.z = Math.PI/2; endCap.position.set(1.2,0.28,0); endCap.metadata = {castShadow:false};
      endCap.parent = g;
      const moss = mkBox(0.7,0.14,0.35,0x4f6a3a,{opacity:0.4});
      moss.position.set(-0.3,0.42,0); moss.rotation.x = 0.3; moss.metadata = {castShadow:false};
      moss.parent = g;
      const capMat = mkStdMat(_uid('log2CapMat'), _scene);
      capMat.diffuseColor = hexIntToColor3(0xc0472b); capMat.metadata = {roughness:0.8};
      for(let i=0;i<3;i++){
        const stem = mkCyl(0.015*0.8,0.02*0.8,0.09*0.8,0xe8dcc0,6);
        stem.rotation.z = Math.PI/2; stem.position.set(-0.6+i*0.35, 0.44+0.045*0.8, 0.08); stem.metadata = {castShadow:false};
        stem.parent = g;
        const cap = BABYLON.MeshBuilder.CreateSphere(_uid('log2MushCap'), {diameter:0.09*0.8, segmentsW:7, segmentsH:5, slice:0.55}, _scene);
        cap.material = capMat;
        cap.rotation.z = -Math.PI/2; cap.position.set(stem.position.x+0.06*0.8, stem.position.y, stem.position.z); cap.metadata = {castShadow:true};
        cap.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_liana', cat:'nature', family:'Champignons & bois mort', label:'Liane', icon:'🌿', color:0x3f6b32, size:[0.2,3,0.2],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('lianaGrp'), _scene);
      for(let i=0;i<3;i++){
        const seg = mkCyl(0.02,0.025,1,c,4);
        seg.position.set((Math.random()-0.5)*0.2, i*0.95+0.5, (Math.random()-0.5)*0.2);
        seg.rotation.z = (Math.random()-0.5)*0.2;
        seg.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_vine', cat:'nature', family:'Champignons & bois mort', label:'Vigne', icon:'🍇', color:0x4a7a3a, size:[0.3,2,0.3],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('vineGrp'), _scene);
      const stem = mkCyl(0.03,0.04,2,c);
      stem.parent = g;
      const grapeMat = mkStdMat(_uid('vineGrapeMat'), _scene);
      grapeMat.diffuseColor = hexIntToColor3(0x5c3a6b);
      for(let i=0;i<4;i++){
        const grape = BABYLON.MeshBuilder.CreatePolyhedron(_uid('vineGrape'), {type:3, size:0.07}, _scene);
        grape.material = grapeMat;
        grape.position.set((Math.random()-0.5)*0.2, 0.3+i*0.4, (Math.random()-0.5)*0.2);
        grape.parent = g;
      }
      return g;
    }});

  // -- Cactus (2) --
  registerAsset({ id:'nat_cactus', cat:'nature', family:'Cactus', label:'Cactus', icon:'🌵', color:0x3f7a4a, size:[0.6,1.2,0.6],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('cactusGrp'), _scene);
      const body = mkCyl(0.18,0.22,1.1,c,8);
      body.parent = g;
      const arm1 = mkCyl(0.09,0.1,0.5,c,6);
      arm1.position.set(0.2,0.6,0); arm1.rotation.z = -0.9;
      arm1.parent = g;
      const spineMat = mkStdMat(_uid('cactusSpineMat'), _scene);
      spineMat.diffuseColor = hexIntToColor3(0xe8dcc0); spineMat.metadata = {roughness:0.6};
      for(let i=0;i<14;i++){
        const spine = BABYLON.MeshBuilder.CreateCylinder(_uid('cactusSpine'), {diameterTop:0, diameterBottom:0.024, height:0.06, tessellation:4}, _scene);
        spine.material = spineMat;
        const ang = Math.random()*Math.PI*2, hy = 0.15+Math.random()*0.8;
        spine.position.set(Math.sin(ang)*0.19, hy, Math.cos(ang)*0.19);
        spine.rotation.z = Math.PI/2; spine.rotation.y = -ang; spine.metadata = {castShadow:false};
        spine.parent = g;
      }
      const flowerMat = mkStdMat(_uid('cactusFlowerMat'), _scene);
      flowerMat.diffuseColor = hexIntToColor3(0xe85d75);
      for(let i=0;i<2;i++){
        const flower = BABYLON.MeshBuilder.CreatePolyhedron(_uid('cactusFlower'), {type:3, size:0.05}, _scene);
        flower.material = flowerMat;
        flower.position.set(Math.sin(i*3)*0.2, 1.05+i*0.03, Math.cos(i*3)*0.2);
        flower.metadata = {castShadow:false};
        flower.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_cactus_giant', cat:'nature', family:'Cactus', label:'Cactus géant', icon:'🌵', color:0x2f6b3a, size:[1.4,3,1.4],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('cactusGiantGrp'), _scene);
      const body = mkCyl(0.4,0.5,2.8,c,10);
      body.parent = g;
      const arm1 = mkCyl(0.2,0.24,1.1,c,8);
      arm1.position.set(0.45,1.4,0); arm1.rotation.z = -0.9;
      arm1.parent = g;
      const arm2 = mkCyl(0.18,0.22,0.9,c,8);
      arm2.position.set(-0.4,1.9,0); arm2.rotation.z = 1;
      arm2.parent = g;
      return g;
    }});

  // -- Roches & minéraux (7) --
  registerAsset({ id:'nat_rock2', cat:'nature', family:'Roches & minéraux', label:'Roche', icon:'🪨', color:0x847f70, size:[0.8,0.6,0.8],
    build:(c)=> buildRockAsset(c, 0.45, 0.5, 1) });
  registerAsset({ id:'nat_bigrock', cat:'nature', family:'Roches & minéraux', label:'Grand rocher', icon:'🪨', color:0x7a756a, size:[2.2,1.8,2.2],
    build:(c)=> buildRockAsset(c, 1.1, 0.6, 3) });
  registerAsset({ id:'nat_cliff', cat:'nature', family:'Roches & minéraux', label:'Falaise', icon:'⛰️', color:0x6f6a5f, size:[4,5,3],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('cliffGrp'), _scene);
      const blockMat = mkStdMat(_uid('cliffBlockMat'), _scene);
      blockMat.diffuseColor = hexIntToColor3(c); blockMat.metadata = {roughness:0.97};
      for(let i=0;i<5;i++){
        const bw = 1+Math.random(), bh = 2+Math.random()*3, bd = 1.4+Math.random();
        const block = BABYLON.MeshBuilder.CreateBox(_uid('cliffBlock'), {width:bw, height:bh, depth:bd}, _scene);
        block.material = blockMat;
        block.position.set(i*0.8-1.6, bh/2, (Math.random()-0.5)*0.6);
        block.rotation.y = (Math.random()-0.5)*0.3;
        block.metadata = {castShadow:true};
        block.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_spire', cat:'nature', family:'Roches & minéraux', label:'Pic rocheux', icon:'🗻', color:0x8a8578, size:[1.5,6,1.5],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('spireGrp'), _scene);
      const segMat = mkStdMat(_uid('spireSegMat'), _scene);
      segMat.diffuseColor = hexIntToColor3(c); segMat.metadata = {roughness:0.95};
      let curY = 0, curR = 0.9;
      for(let i=0;i<4;i++){
        const h = 1.4+Math.random()*1;
        const seg = BABYLON.MeshBuilder.CreatePolyhedron(_uid('spireSeg'), {type:2, size:curR}, _scene);
        seg.material = segMat;
        seg.scaling.set(1, h/curR, 1);
        seg.position.set((Math.random()-0.5)*0.3, curY+h*0.5, (Math.random()-0.5)*0.3);
        seg.rotation.y = Math.random()*Math.PI;
        seg.metadata = {castShadow:true};
        seg.parent = g;
        curY += h*0.75; curR *= 0.65;
      }
      return g;
    }});
  registerAsset({ id:'nat_crystal_blue', cat:'nature', family:'Roches & minéraux', label:'Cristal bleu', icon:'🔷', color:0x4a9ad8, size:[0.8,1.4,0.8],
    build:()=> buildCrystalAsset(0x4a9ad8, 1.4) });
  registerAsset({ id:'nat_crystal_red', cat:'nature', family:'Roches & minéraux', label:'Cristal rouge', icon:'🔺', color:0xd84a5a, size:[0.8,1.4,0.8],
    build:()=> buildCrystalAsset(0xd84a5a, 1.4) });
  registerAsset({ id:'nat_crystal_green', cat:'nature', family:'Roches & minéraux', label:'Cristal vert', icon:'🔻', color:0x4ad86a, size:[0.8,1.4,0.8],
    build:()=> buildCrystalAsset(0x4ad86a, 1.4) });

  // -- Points d'eau (8) --
  registerAsset({ id:'nat_geyser', cat:'nature', family:"Points d'eau", label:'Geyser', icon:'💦', color:0xcfe8f0, size:[1,3,1],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('geyserGrp'), _scene);
      const base = mkCyl(0.6,0.75,0.3,0x7a756a,10);
      base.parent = g;
      const jetMat = mkStdMat(_uid('geyserJetMat'), _scene);
      jetMat.diffuseColor = hexIntToColor3(0xdff2f7); jetMat.alpha = 0.55; jetMat.metadata = {roughness:0.2};
      const jet = BABYLON.MeshBuilder.CreateCylinder(_uid('geyserJet'), {diameterTop:0, diameterBottom:0.36, height:2.6, tessellation:8}, _scene);
      jet.material = jetMat;
      jet.position.y = 1.6; jet.rotation.x = Math.PI;
      jet.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_waterfall', cat:'nature', family:"Points d'eau", label:'Cascade', icon:'🌊', color:0x2f6f8f, size:[2,4,0.6],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('waterfallGrp'), _scene);
      const sheet = mkBox(1.8,3.6,0.15,0x2f6f8f,{opacity:0.72});
      sheet.position.y = 1.8;
      sheet.parent = g;
      const pool = buildWaterPatch(0x2f6f8f, 2.6, 1.6);
      pool.position.y = 0;
      pool.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_river', cat:'nature', family:"Points d'eau", label:'Rivière', icon:'🏞️', color:0x2f6f8f, size:[6,0.2,2.4],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('riverGrp'), _scene);
      const strip = mkBox(6,0.1,2.2,0x2f6f8f,{opacity:0.78});
      strip.position.y = 0.06;
      strip.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_lake', cat:'nature', family:"Points d'eau", label:'Lac', icon:'🏞️', color:0x2f6f8f, size:[8,0.2,6],
    build:()=> buildWaterPatch(0x2f6f8f, 8, 6) });
  registerAsset({ id:'nat_pond', cat:'nature', family:"Points d'eau", label:'Étang', icon:'🟦', color:0x3a7a8a, size:[3,0.2,2.4],
    build:()=> buildWaterPatch(0x3a7a8a, 3, 2.4) });
  registerAsset({ id:'nat_lily', cat:'nature', family:"Points d'eau", label:'Nénuphar', icon:'🪷', color:0x4a8a4a, size:[0.5,0.1,0.5],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('lilyGrp'), _scene);
      const padMat = mkStdMat(_uid('lilyPadMat'), _scene);
      padMat.diffuseColor = hexIntToColor3(0x4a8a4a); padMat.backFaceCulling = false;
      const pad = BABYLON.MeshBuilder.CreateDisc(_uid('lilyPad'), {radius:0.24, tessellation:12}, _scene);
      pad.material = padMat; pad.rotation.x = -Math.PI/2; pad.position.y = 0.04;
      pad.parent = g;
      const bloomMat = mkStdMat(_uid('lilyBloomMat'), _scene);
      bloomMat.diffuseColor = hexIntToColor3(0xf0a8c0);
      const bloom = BABYLON.MeshBuilder.CreatePolyhedron(_uid('lilyBloom'), {type:3, size:0.07}, _scene);
      bloom.material = bloomMat; bloom.position.set(0.05,0.08,0.05);
      bloom.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_reed', cat:'nature', family:"Points d'eau", label:'Roseau', icon:'🌾', color:0x8a9a4a, size:[0.4,1.4,0.4],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('reedGrp'), _scene);
      for(let i=0;i<5;i++){
        const bh = 1+Math.random()*0.4;
        const blade = mkCyl(0.02,0.03,bh,c,4);
        const ang = Math.random()*Math.PI*2, dist = Math.random()*0.15;
        blade.position.set(Math.cos(ang)*dist, bh/2, Math.sin(ang)*dist);
        blade.rotation.z = (Math.random()-0.5)*0.25;
        blade.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_swamp', cat:'nature', family:"Points d'eau", label:'Marécage', icon:'🟫', color:0x4a5a3a, size:[3,0.2,3],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('swampGrp'), _scene);
      const mud = mkBox(3,0.12,3,0x4a5a3a);
      mud.parent = g;
      const water = buildWaterPatch(0x3a4a3a, 2, 2, {opacity:0.6});
      water.position.y = 0.08;
      water.parent = g;
      return g;
    }});

  // -- Terrain praticable (4) + volcanisme (2) --
  registerAsset({ id:'nat_sand', cat:'nature', family:'Terrain & volcanisme', label:'Sable', icon:'🟨', color:0xd9c48a, size:[3,0.15,3],
    build:(c)=> buildGroundPatch(c,3,3,0.12) });
  registerAsset({ id:'nat_dune2', cat:'nature', family:'Terrain & volcanisme', label:'Dune', icon:'🏜️', color:0xd9a35c, size:[3,1.2,3],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('dune2Grp'), _scene);
      const moundMat = mkStdMat(_uid('dune2MoundMat'), _scene);
      moundMat.diffuseColor = hexIntToColor3(c); moundMat.metadata = {roughness:1};
      const mound = BABYLON.MeshBuilder.CreateSphere(_uid('dune2Mound'), {diameter:3.2, segmentsW:14, segmentsH:8, slice:0.5}, _scene);
      mound.material = moundMat;
      mound.position.y = 0;
      mound.scaling.set(1,0.5,0.8);
      mound.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_icefloe', cat:'nature', family:'Terrain & volcanisme', label:'Banquise', icon:'🧊', color:0xd8ecf2, size:[3,0.3,3],
    build:(c)=> buildGroundPatch(c,3,3,0.25) });
  registerAsset({ id:'nat_iceblock', cat:'nature', family:'Terrain & volcanisme', label:'Bloc de glace', icon:'🧊', color:0xcfe8f0, size:[1,1.2,1],
    build:(c)=> group(mkBox(1,1.2,1,c,{opacity:0.75})) });
  registerAsset({ id:'nat_volcano', cat:'nature', family:'Terrain & volcanisme', label:'Volcan', icon:'🌋', color:0x4a3a34, size:[5,4,5],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('volcanoGrp'), _scene);
      const coneMat = mkStdMat(_uid('volcanoConeMat'), _scene);
      coneMat.diffuseColor = hexIntToColor3(0x4a3a34); coneMat.metadata = {roughness:0.95};
      const cone = BABYLON.MeshBuilder.CreateCylinder(_uid('volcanoCone'), {diameterTop:0, diameterBottom:5, height:4, tessellation:10}, _scene);
      cone.material = coneMat;
      cone.position.y = 2; cone.metadata = {castShadow:true};
      cone.parent = g;
      const lavaMat = mkStdMat(_uid('volcanoLavaMat'), _scene);
      lavaMat.diffuseColor = hexIntToColor3(0xff5a1e);
      lavaMat.emissiveColor = hexIntToColor3(0xff3a0a).scale(0.9);
      lavaMat.backFaceCulling = false;
      const lava = BABYLON.MeshBuilder.CreateDisc(_uid('volcanoLava'), {radius:0.7, tessellation:12}, _scene);
      lava.material = lavaMat;
      lava.rotation.x = -Math.PI/2; lava.position.y = 3.98;
      lava.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_crater', cat:'nature', family:'Terrain & volcanisme', label:'Cratère', icon:'🕳️', color:0x4a3a34, size:[3,0.6,3],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('craterGrp'), _scene);
      const rimMat = mkStdMat(_uid('craterRimMat'), _scene);
      rimMat.diffuseColor = hexIntToColor3(c); rimMat.metadata = {roughness:0.95};
      const rim = BABYLON.MeshBuilder.CreateTorus(_uid('craterRim'), {diameter:2.6, thickness:0.6, tessellation:16}, _scene);
      rim.material = rimMat;
      rim.rotation.x = Math.PI/2; rim.position.y = 0.2;
      rim.parent = g;
      const floorMat = mkStdMat(_uid('craterFloorMat'), _scene);
      floorMat.diffuseColor = hexIntToColor3(0x2a1e1a); floorMat.backFaceCulling = false;
      const floor = BABYLON.MeshBuilder.CreateDisc(_uid('craterFloor'), {radius:1.1, tessellation:16}, _scene);
      floor.material = floorMat;
      floor.rotation.x = -Math.PI/2; floor.position.y = -0.15;
      floor.parent = g;
      return g;
    }});

  // -- Divers (11) --
  registerAsset({ id:'nat_drybush', cat:'nature', family:'Divers', label:'Buisson sec', icon:'🥀', color:0x8a7a4a, size:[1,0.8,1],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('drybushGrp'), _scene);
      for(let i=0;i<4;i++){
        const twig = mkCyl(0.02,0.03,0.4+Math.random()*0.2,c,4);
        const ang = Math.random()*Math.PI*2;
        twig.position.set(0,0.2,0);
        twig.rotation.z = Math.PI/2-0.6+Math.random()*0.4;
        twig.rotation.y = ang;
        twig.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_coral', cat:'nature', family:'Divers', label:'Corail', icon:'🪸', color:0xe86a7a, size:[0.7,0.7,0.7],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('coralGrp'), _scene);
      for(let i=0;i<5;i++){
        const branch = mkCyl(0.03,0.06,0.35+Math.random()*0.25,c,5);
        branch.position.set((Math.random()-0.5)*0.3, 0.17, (Math.random()-0.5)*0.3);
        branch.rotation.z = (Math.random()-0.5)*0.6;
        branch.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_algae', cat:'nature', family:'Divers', label:'Algues', icon:'🌿', color:0x2f7a5a, size:[0.5,0.6,0.5],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('algaeGrp'), _scene);
      for(let i=0;i<4;i++){
        const blade = mkBox(0.06,0.5,0.02,c);
        blade.position.set((Math.random()-0.5)*0.3, 0.25, (Math.random()-0.5)*0.3);
        blade.rotation.z = (Math.random()-0.5)*0.5;
        blade.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_mangrove', cat:'nature', family:'Divers', label:'Mangrove', icon:'🌳', color:0x3f5a3a, size:[2,3,2],
    build:()=>{
      const g = buildTreeAsset(0x3f5a3a, 2, 0.22, 'round', 0x4a7a4a, 1.2);
      for(let i=0;i<4;i++){
        const root = mkCyl(0.05,0.09,1,0x3f5a3a,5);
        const ang = i/4*Math.PI*2;
        root.position.set(Math.cos(ang)*0.3, 0.5, Math.sin(ang)*0.3);
        root.rotation.z = 0.3*Math.cos(ang);
        root.rotation.x = 0.3*Math.sin(ang);
        root.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_leafpile', cat:'nature', family:'Divers', label:'Tas de feuilles', icon:'🍂', color:0xb87a3a, size:[0.9,0.3,0.9],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('leafpileGrp'), _scene);
      const leafMat = mkStdMat(_uid('leafpileMat'), _scene);
      leafMat.diffuseColor = hexIntToColor3(c); leafMat.metadata = {roughness:1};
      for(let i=0;i<5;i++){
        const leaf = BABYLON.MeshBuilder.CreatePolyhedron(_uid('leafpileLeaf'), {type:3, size:0.16+Math.random()*0.1}, _scene);
        leaf.material = leafMat;
        leaf.position.set((Math.random()-0.5)*0.5, 0.1, (Math.random()-0.5)*0.5);
        leaf.scaling.y = 0.4;
        leaf.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_snowpile', cat:'nature', family:'Divers', label:'Tas de neige', icon:'❄️', color:0xf2f6f8, size:[0.9,0.4,0.9],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('snowpileGrp'), _scene);
      const moundMat = mkStdMat(_uid('snowpileMoundMat'), _scene);
      moundMat.diffuseColor = hexIntToColor3(c); moundMat.metadata = {roughness:0.85};
      const mound = BABYLON.MeshBuilder.CreateSphere(_uid('snowpileMound'), {diameter:0.9, segmentsW:10, segmentsH:6, slice:0.5}, _scene);
      mound.material = moundMat;
      mound.scaling.set(1,0.55,1);
      mound.parent = g;
      const sparkMat = mkStdMat(_uid('snowpileSparkMat'), _scene);
      sparkMat.diffuseColor = hexIntToColor3(0xdff2f7);
      sparkMat.emissiveColor = hexIntToColor3(0xdff2f7).scale(0.4);
      sparkMat.metadata = {roughness:0.1, metalness:0.1};
      for(let i=0;i<5;i++){
        const spark = BABYLON.MeshBuilder.CreatePolyhedron(_uid('snowpileSpark'), {type:1, size:0.025+Math.random()*0.02}, _scene);
        spark.material = sparkMat;
        const ang = Math.random()*Math.PI*2, dist = Math.random()*0.35;
        spark.position.set(Math.sin(ang)*dist, 0.18+Math.random()*0.1, Math.cos(ang)*dist);
        spark.metadata = {castShadow:false};
        spark.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_glacier', cat:'nature', family:'Divers', label:'Glacier', icon:'🧊', color:0xcfe8f2, size:[4,2.5,3],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('glacierGrp'), _scene);
      for(let i=0;i<4;i++){
        const shardH = 1.6+Math.random()*1.2;
        const shardR = 0.8+Math.random()*0.4;
        // MeshPhysicalMaterial(transmission) n'a pas d'équivalent StandardMaterial
        // fidèle sans PBR — approximé par alpha élevé + emissive léger, comme
        // buildCrystalAsset (à reconstruire en Phase 4 avec PBRMaterial).
        const shardMat = mkStdMat(_uid('glacierShardMat'), _scene);
        shardMat.diffuseColor = hexIntToColor3(c);
        shardMat.alpha = 0.9;
        shardMat.emissiveColor = hexIntToColor3(c).scale(0.08);
        shardMat.metadata = {roughness:0.1, metalness:0, transmission:0.4};
        const shard = BABYLON.MeshBuilder.CreateCylinder(_uid('glacierShard'), {diameterTop:0, diameterBottom:shardR*2, height:shardH, tessellation:6}, _scene);
        shard.material = shardMat;
        shard.position.set(i*1-1.5, shardH/2, (Math.random()-0.5)*0.5);
        shard.rotation.z = (Math.random()-0.5)*0.2;
        shard.metadata = {castShadow:true};
        shard.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_deadtree2', cat:'nature', family:'Divers', label:'Arbre mort décharné', icon:'🌲', color:0x5c4a3a, size:[1.2,4,1.2],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('deadtree2Grp'), _scene);
      const trunk = mkCyl(0.12,0.22,3.2,c,7);
      trunk.parent = g;
      for(let i=0;i<4;i++){
        const branch = mkCyl(0.03,0.07,0.9+Math.random()*0.5,c,5);
        branch.position.y = 1.6+i*0.5;
        branch.rotation.z = 0.9+Math.random()*0.4;
        branch.rotation.y = i*1.6;
        branch.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_bramble', cat:'nature', family:'Divers', label:'Ronce', icon:'🌿', color:0x4a5a2a, size:[0.9,0.6,0.9],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('brambleGrp'), _scene);
      const thornMat = mkStdMat(_uid('brambleThornMat'), _scene);
      thornMat.diffuseColor = hexIntToColor3(0x2a2a1a);
      for(let i=0;i<6;i++){
        const vine = mkCyl(0.02,0.03,0.5+Math.random()*0.3,c,4);
        const ang = Math.random()*Math.PI*2;
        vine.position.set(0,0.2,0);
        vine.rotation.z = Math.PI/2-0.4+Math.random()*0.5;
        vine.rotation.y = ang;
        vine.parent = g;
        const thorn = BABYLON.MeshBuilder.CreateCylinder(_uid('brambleThorn'), {diameterTop:0, diameterBottom:0.06, height:0.08, tessellation:4}, _scene);
        thorn.material = thornMat;
        thorn.position.copyFrom(vine.position);
        thorn.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_prairie2', cat:'nature', family:'Divers', label:'Prairie fleurie', icon:'🌸', color:0x6a9a48, size:[3,0.5,3],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('prairie2Grp'), _scene);
      const base = mkBox(3,0.1,3,0x5f9a48);
      base.parent = g;
      const petal = [0xe85d75,0xf0c020,0xffffff,0xb15de0];
      for(let i=0;i<14;i++){
        const stem = mkCyl(0.015,0.02,0.25,0x4a7a3a);
        const x = (Math.random()-0.5)*2.6, z = (Math.random()-0.5)*2.6;
        stem.position.set(x,0.05,z);
        stem.parent = g;
        const bloomMat = mkStdMat(_uid('prairie2BloomMat'), _scene);
        bloomMat.diffuseColor = hexIntToColor3(petal[i%4]);
        const bloom = BABYLON.MeshBuilder.CreatePolyhedron(_uid('prairie2Bloom'), {type:3, size:0.06}, _scene);
        bloom.material = bloomMat;
        bloom.position.set(x,0.28,z);
        bloom.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_sunflower', cat:'nature', family:'Divers', label:'Tournesol', icon:'🌻', color:0xf0c020, size:[0.5,1.4,0.5],
    build:()=>{
      const g = new BABYLON.TransformNode(_uid('sunflowerGrp'), _scene);
      const stem = mkCyl(0.04,0.05,1.2,0x4a7a3a);
      stem.parent = g;
      const centerMat = mkStdMat(_uid('sunflowerCenterMat'), _scene);
      centerMat.diffuseColor = hexIntToColor3(0x5c4530);
      const center = BABYLON.MeshBuilder.CreateCylinder(_uid('sunflowerCenter'), {diameterTop:0.26, diameterBottom:0.26, height:0.06, tessellation:12}, _scene);
      center.material = centerMat;
      center.rotation.x = Math.PI/2; center.position.y = 1.24;
      center.parent = g;
      for(let i=0;i<10;i++){
        const petal = mkBox(0.1,0.03,0.16,0xf0c020);
        const ang = i/10*Math.PI*2;
        petal.position.set(Math.cos(ang)*0.2, 1.24, Math.sin(ang)*0.2);
        petal.rotation.y = ang;
        petal.parent = g;
      }
      return g;
    }});

// map_assets_babylon_partD.js — Portage Babylon.js de map_assets.js lignes 3459-4064.
// BÂTIMENTS THÉMATIQUES (49 structures) + DÉCORATION (props) + ÉLÉMENTS
// TACTIQUES + VERTICALITÉ + SITES & SPAWNS. Fonctions et registerAsset()
// en instructions top-level (pas d'IIFE) — s'appuie sur les helpers déjà
// définis dans map_assets_babylon.js (mkBox, mkCyl, mkBevelBox,
// mkTextSprite, mkZonePad, group, hueJitter, hexIntToColor3,
// color3ToHexInt, cachedTexture, wrapCanvasTexture, mkRepeatTex,
// addVignette, addWindowGrid, addSeams, registerAsset, _scene, _uid,
// buildCrystalAsset, tex* functions).

// ============================================================
// BÂTIMENTS THÉMATIQUES — 49 structures, construites à partir de
// quelques familles de formes partagées pour rester lisible.
// ============================================================
function buildSimpleHouse(wallColor, roofColor, w,d,h, roofStyle){
  const g = new BABYLON.TransformNode(_uid('house'), _scene);
  const walls = mkBox(w,h,d,wallColor,{roughness:0.9}); walls.parent = g;
  if(roofStyle==='pitched'){
    const span=w*0.6, depth=d*0.85;
    const rA=mkBox(span,0.14,depth,roofColor); rA.position.set(-w*0.24,h+span*0.42,0); rA.rotation.z=0.55; rA.parent = g;
    const rB=mkBox(span,0.14,depth,roofColor); rB.position.set(w*0.24,h+span*0.42,0); rB.rotation.z=-0.55; rB.parent = g;
    const chimney=mkBox(w*0.13,h*0.5,w*0.13,0x5c5850); chimney.position.set(w*0.26,h+span*0.42*1.35,d*0.18); chimney.parent = g;
  } else if(roofStyle==='flat'){
    const roof=mkBox(w*1.05,0.2,d*1.05,roofColor); roof.position.y=h+0.1; roof.parent = g;
  } else if(roofStyle==='dome'){
    const dome=BABYLON.MeshBuilder.CreateSphere(_uid('dome'), {diameter:w*0.55*2, segments:10, slice:0.5}, _scene);
    const domeMat = mkStdMat(_uid('mat'), _scene);
    domeMat.diffuseColor = hexIntToColor3(roofColor); domeMat.metadata = {roughness:0.4, metalness:0.2};
    dome.material = domeMat;
    dome.position.y=h; dome.parent = g;
  } else if(roofStyle==='cone'){
    const roof=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:w*0.75*2, height:h*0.6, tessellation:10}, _scene);
    const roofMat = mkStdMat(_uid('mat'), _scene);
    roofMat.diffuseColor = hexIntToColor3(roofColor); roofMat.metadata = {roughness:0.7};
    roof.material = roofMat;
    roof.position.y=h+h*0.3; roof.parent = g;
    const chimney=mkBox(w*0.11,h*0.45,w*0.11,0x5c5850); chimney.position.set(w*0.2,h+h*0.4,0); chimney.parent = g;
  }
  const door=mkBox(0.8,1.5,0.08,0x2e1f14); door.position.set(0,0.75,d/2+0.02); door.parent = g;
  // Fenêtres (grandes maisons seulement, pour ne pas les tasser sur une
  // cabane/hutte étroite) + marche devant la porte — avant ça, une
  // "maison" n'était que 3 boîtes (murs/toit/porte), rien qui suggère
  // un intérieur habité.
  if(w>=3.3 && h>=2.4){
    [-w*0.28,w*0.28].forEach(wx=>{
      const frame = mkBox(0.6,0.6,0.06,0x2e1f14); frame.position.set(wx,h*0.55,d/2+0.02); frame.parent = g;
      const glass = mkBox(0.46,0.46,0.02,0x9dd8e0,{opacity:0.6,roughness:0.1}); glass.position.set(wx,h*0.55,d/2+0.05); glass.parent = g;
    });
  }
  const step = mkBox(Math.min(1.1,w*0.3),0.1,0.3,0x8a8578); step.position.set(0,0.05,d/2+0.2); step.parent = g;
  return g;
}
function buildTower(baseColor, w, h, capType){
  const g = new BABYLON.TransformNode(_uid('tower'), _scene);
  const shaft=mkCyl(w*0.42,w*0.5,h,baseColor,10); shaft.parent = g;
  if(capType==='cone'){
    const cap=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:w*0.55*2, height:h*0.35, tessellation:10}, _scene);
    const capMat = mkStdMat(_uid('mat'), _scene); capMat.diffuseColor = hexIntToColor3(0x4a3a2a);
    cap.material = capMat; cap.position.y=h+h*0.17; cap.parent = g;
  }
  else if(capType==='crenel'){ for(let i=0;i<8;i++){ const merlon=mkBox(0.3,0.4,0.3,baseColor); const ang=i/8*Math.PI*2; merlon.position.set(Math.cos(ang)*w*0.45,h+0.2,Math.sin(ang)*w*0.45); merlon.parent = g;} }
  else if(capType==='glow'){
    const orb=BABYLON.MeshBuilder.CreateSphere(_uid('orb'), {diameter:w*0.3*2, segments:8}, _scene);
    const orbMat = mkStdMat(_uid('mat'), _scene);
    orbMat.diffuseColor = hexIntToColor3(0x8a4ad8); orbMat.emissiveColor = hexIntToColor3(0x8a4ad8).scale(0.8); orbMat.alpha = 0.85;
    orb.material = orbMat; orb.position.y=h+0.4; orb.parent = g;
  }
  return g;
}
function buildBridgeSpan(color, len, railColor){
  const g = new BABYLON.TransformNode(_uid('bridge'), _scene);
  const deck=mkBox(len,0.3,2.6,color); deck.position.y=2; deck.parent = g;
  for(const sx of [-1.25,1.25]){ const rail=mkBox(len*0.96,0.5,0.1,railColor||color); rail.position.set(0,2.4,sx); rail.parent = g; }
  for(let i=0;i<3;i++){ const pillar=mkCyl(0.3,0.4,2,color,8); pillar.position.set((i-1)*len*0.32,1,0); pillar.parent = g; }
  return g;
}

// -- Maisons régionales (9) --
registerAsset({ id:'bld_woodhouse', cat:'structures', family:'Maisons régionales', label:'Maison en bois', icon:'🏠', color:0x6b4a2e, size:[4,3,3.2],
  build:()=> buildSimpleHouse(0x6b4a2e,0x3a2a1e,4,3.2,2.6,'pitched') });
registerAsset({ id:'bld_stonehouse', cat:'structures', family:'Maisons régionales', label:'Maison en pierre', icon:'🏠', color:0x7a776c, size:[4,3,3.2],
  build:()=> buildSimpleHouse(0x7a776c,0x4a4842,4,3.2,2.6,'flat') });
registerAsset({ id:'bld_chalet', cat:'structures', family:'Maisons régionales', label:'Chalet', icon:'🏔️', color:0x8a6a4a, size:[4.2,3.4,3.6],
  build:()=>{ const g=buildSimpleHouse(0x8a6a4a,0x3a2a1e,4.2,3.6,2.8,'pitched'); const balcony=mkBox(3.6,0.15,0.7,0x6b4a2e); balcony.position.set(0,1.4,1.85); balcony.parent = g; return g; }});
registerAsset({ id:'bld_cabin2', cat:'structures', family:'Maisons régionales', label:'Cabane', icon:'🏚️', color:0x6b4a2e, size:[3,2.4,2.6],
  build:()=> buildSimpleHouse(0x6b4a2e,0x3a2a1e,3,2.6,2.2,'pitched') });
registerAsset({ id:'bld_hut', cat:'structures', family:'Maisons régionales', label:'Hutte', icon:'🛖', color:0x9a8060, size:[2.6,2.2,2.6],
  build:()=> buildSimpleHouse(0x9a8060,0x6b5a3a,2.6,2.6,1.8,'cone') });
registerAsset({ id:'bld_asianhouse', cat:'structures', family:'Maisons régionales', label:'Maison asiatique', icon:'🏯', color:0xb03a3a, size:[4,3,3.4],
  build:()=>{ const g=buildSimpleHouse(0xd8c8a0,0xb03a3a,4,3.4,2.4,'flat'); const eave=mkBox(4.6,0.12,3.8,0xb03a3a); eave.position.y=2.5; eave.parent = g; return g; }});
registerAsset({ id:'bld_nordichouse', cat:'structures', family:'Maisons régionales', label:'Maison nordique', icon:'🏠', color:0x5c4530, size:[4,3.2,3.4],
  build:()=>{ const g=buildSimpleHouse(0x5c4530,0x2a2a2a,4,3.4,2.6,'pitched'); const carving=mkBox(0.15,1.2,0.15,0xc0a060); carving.position.set(0,3.2,1.7); carving.parent = g; return g; }});
registerAsset({ id:'bld_deserthouse', cat:'structures', family:'Maisons régionales', label:'Maison désertique', icon:'🏠', color:0xd9c290, size:[4,2.8,3.4],
  build:()=> buildSimpleHouse(0xd9c290,0xc9a96a,4,3.4,2.4,'flat') });
registerAsset({ id:'bld_medvillage', cat:'structures', family:'Maisons régionales', label:'Village médiéval', icon:'🏘️', color:0x8a6a4a, size:[9,3.5,7],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const positions=[[-2.6,-1.6,0],[2.4,-1.8,0.4],[0,1.8,-0.2]];
    positions.forEach(([x,z,ry])=>{ const h=buildSimpleHouse(0x8a6a4a,0x3a2a1e,2.6,2.2,2,'pitched'); h.position.set(x,0,z); h.rotation.y=ry; h.parent = g; });
    return g; }});

// -- Défense (4) --
registerAsset({ id:'bld_tower', cat:'structures', family:'Défense', label:'Tour', icon:'🗼', color:0x7a776c, size:[2.4,7,2.4],
  build:()=> buildTower(0x7a776c,2.4,6.4,'crenel') });
registerAsset({ id:'bld_watchtower', cat:'structures', family:'Défense', label:'Tour de garde', icon:'🗼', color:0x6b4a2e, size:[2,6,2],
  build:()=>{ const g=buildTower(0x6b4a2e,1.6,5,null); const roof=mkBox(2.2,0.15,2.2,0x3a2a1e); roof.position.y=5.4; roof.parent = g;
    for(const sx of [-1,1]) for(const sz of [-1,1]){ const post=mkCyl(0.05,0.05,0.9,0x3a2a1e); post.position.set(sx*0.9,5.4,sz*0.9); post.parent = g;} return g; }});
registerAsset({ id:'bld_castle', cat:'structures', family:'Défense', label:'Château', icon:'🏰', color:0x8a8578, size:[10,7,10],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const keep=mkBox(5,5,5,0x8a8578); keep.parent = g;
    for(const [x,z] of [[-4,-4],[4,-4],[-4,4],[4,4]]){ const t=buildTower(0x8a8578,1.8,6,'crenel'); t.position.set(x,0,z); t.parent = g; }
    for(let i=0;i<10;i++){ const merlon=mkBox(0.4,0.5,0.4,0x8a8578); const ang=i/10*Math.PI*2; merlon.position.set(Math.cos(ang)*2.6,5.25,Math.sin(ang)*2.6); merlon.parent = g;} return g; }});
registerAsset({ id:'bld_fort', cat:'structures', family:'Défense', label:'Fort', icon:'🏯', color:0x6b6a5f, size:[8,4,8],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const wallN=mkBox(8,3,0.5,0x6b6a5f); wallN.position.set(0,1.5,-4); wallN.parent = g;
    const wallS=mkBox(8,3,0.5,0x6b6a5f); wallS.position.set(0,1.5,4); wallS.parent = g;
    const wallE=mkBox(0.5,3,8,0x6b6a5f); wallE.position.set(4,1.5,0); wallE.parent = g;
    const wallW=mkBox(0.5,3,8,0x6b6a5f); wallW.position.set(-4,1.5,0); wallW.parent = g;
    const barracks=buildSimpleHouse(0x6b4a2e,0x3a2a1e,3,2.6,2.2,'flat'); barracks.parent = g; return g; }});

// -- Religieux (4) --
registerAsset({ id:'bld_temple', cat:'structures', family:'Religieux', label:'Temple', icon:'🛕', color:0xd8c8a0, size:[6,4,5],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const base=mkBox(6,0.4,5,0xc0a970); base.parent = g;
    for(let i=0;i<6;i++){ const col=mkCyl(0.22,0.22,3,0xe8ddc0,10); col.position.set(-2.4+i*0.96,1.9,2.1); col.parent = g;}
    const roof=mkBox(6.4,0.4,5.4,0xb03a3a); roof.position.y=3.6; roof.parent = g;
    const pediment=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:3.4*2, height:1, tessellation:3}, _scene);
    const pedimentMat = mkStdMat(_uid('mat'), _scene); pedimentMat.diffuseColor = hexIntToColor3(0xd8c8a0);
    pediment.material = pedimentMat; pediment.rotation.y=Math.PI/2; pediment.rotation.z=Math.PI/2; pediment.position.set(0,4.3,2.1); pediment.parent = g; return g; }});
registerAsset({ id:'bld_church', cat:'structures', family:'Religieux', label:'Église', icon:'⛪', color:0xd8d0c0, size:[5,6,4],
  build:()=>{ const g=buildSimpleHouse(0xd8d0c0,0x4a4a4a,5,4,3,'pitched');
    const spire=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.9*2, height:2.4, tessellation:4}, _scene);
    const spireMat = mkStdMat(_uid('mat'), _scene); spireMat.diffuseColor = hexIntToColor3(0x4a4a4a);
    spire.material = spireMat; spire.position.y=4.2; spire.parent = g;
    const cross=mkBox(0.08,0.5,0.08,0x2a2a2a); cross.position.y=5.5; cross.parent = g; const crossbar=mkBox(0.3,0.08,0.08,0x2a2a2a); crossbar.position.y=5.35; crossbar.parent = g; return g; }});
registerAsset({ id:'bld_cathedral', cat:'structures', family:'Religieux', label:'Cathédrale', icon:'⛪', color:0xc8c0b0, size:[8,10,6],
  build:()=>{ const g=buildSimpleHouse(0xc8c0b0,0x4a4a4a,8,6,5,'pitched');
    for(const sx of [-2.6,2.6]){ const tower=buildTower(0xc8c0b0,1.4,4,'cone'); tower.position.set(sx,5,-2); tower.parent = g; }
    const rose=BABYLON.MeshBuilder.CreateDisc(_uid('disc'), {radius:1, tessellation:16}, _scene);
    const roseMat = mkStdMat(_uid('mat'), _scene);
    roseMat.diffuseColor = hexIntToColor3(0x3a6fa0); roseMat.emissiveColor = hexIntToColor3(0x2a4a6a).scale(0.3);
    rose.material = roseMat; rose.position.set(0,3.5,3.01); rose.parent = g; return g; }});
registerAsset({ id:'bld_pagoda', cat:'structures', family:'Religieux', label:'Pagode', icon:'🏯', color:0xb03a3a, size:[4,7,4],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); let w=3.4,y=0; for(let i=0;i<4;i++){ const tier=mkBox(w,1.1,w,0xd8c8a0); tier.position.y=y+0.55; tier.parent = g;
      const roof=mkBox(w*1.25,0.15,w*1.25,0xb03a3a); roof.position.y=y+1.15; roof.parent = g; y+=1.25; w*=0.78; }
    const spire=mkCyl(0.04,0.1,1,0xc0a060); spire.position.y=y+0.5; spire.parent = g; return g; }});

// -- Rural / industriel (7) --
registerAsset({ id:'bld_mill', cat:'structures', family:'Rural & industriel', label:'Moulin', icon:'🏚️', color:0xd8c8a0, size:[3,5,3],
  build:()=>{ const g=buildTower(0xd8c8a0,2.2,3.6,'cone'); const hub=mkCyl(0.15,0.15,0.3,0x3a2a1e); hub.rotation.z=Math.PI/2; hub.position.set(0,3.4,1.2); hub.parent = g;
    for(let i=0;i<4;i++){ const blade=mkBox(0.15,1.8,0.05,0x6b4a2e); blade.position.set(0,3.4,1.2); blade.rotation.z=i*Math.PI/2; blade.position.y+=Math.sin(i*Math.PI/2)*0.9; blade.position.x+=Math.cos(i*Math.PI/2)*0; blade.parent = g;} return g; }});
registerAsset({ id:'bld_barn', cat:'structures', family:'Rural & industriel', label:'Grange', icon:'🏚️', color:0xa03a2a, size:[5,3.4,4],
  build:()=> buildSimpleHouse(0xa03a2a,0x3a2a1e,5,4,3,'pitched') });
registerAsset({ id:'bld_warehouse2', cat:'structures', family:'Rural & industriel', label:'Entrepôt', icon:'🏭', color:0x6b6e73, size:[8,4,6],
  build:()=> buildSimpleHouse(0x6b6e73,0x4a4d52,8,6,3.6,'flat') });
registerAsset({ id:'bld_factory2', cat:'structures', family:'Rural & industriel', label:'Usine', icon:'🏭', color:0x5a5d62, size:[7,5,6],
  build:()=>{ const g=buildSimpleHouse(0x5a5d62,0x3a3d42,7,6,4,'flat'); const chimney=mkCyl(0.5,0.6,4,0x3a3d42,10); chimney.position.set(2.5,4,-2); chimney.parent = g; return g; }});
registerAsset({ id:'bld_mine', cat:'structures', family:'Rural & industriel', label:'Mine', icon:'⛏️', color:0x4a4238, size:[4,3,3],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const frameL=mkBox(0.3,3,0.3,0x4a3a28); frameL.position.set(-1.2,1.5,0); frameL.parent = g;
    const frameR=mkBox(0.3,3,0.3,0x4a3a28); frameR.position.set(1.2,1.5,0); frameR.parent = g;
    const top=mkBox(2.7,0.3,0.4,0x4a3a28); top.position.y=3; top.parent = g;
    const hole=BABYLON.MeshBuilder.CreateDisc(_uid('disc'), {radius:0.9, tessellation:12}, _scene);
    const holeMat = mkStdMat(_uid('mat'), _scene); holeMat.diffuseColor = hexIntToColor3(0x0a0a0a);
    hole.material = holeMat; hole.position.set(0,1.3,0.16); hole.parent = g; return g; }});
registerAsset({ id:'bld_bunker2', cat:'structures', family:'Rural & industriel', label:'Bunker', icon:'🏢', color:0x5c5c54, size:[4,1.6,4],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene);
    const dome=BABYLON.MeshBuilder.CreateSphere(_uid('dome'), {diameter:2*2, segments:8, slice:1/2.4}, _scene);
    const domeMat = mkStdMat(_uid('mat'), _scene); domeMat.diffuseColor = hexIntToColor3(c); domeMat.metadata = {roughness:0.95};
    dome.material = domeMat; dome.convertToFlatShadedMesh(); dome.scaling.y=0.6; dome.parent = g;
    const slit=mkBox(1,0.2,0.1,0x0a0a0a); slit.position.set(0,0.8,1.9); slit.parent = g; return g; }});
registerAsset({ id:'bld_barracks', cat:'structures', family:'Rural & industriel', label:'Caserne', icon:'🏢', color:0x5c6a4a, size:[6,3,4],
  build:()=> buildSimpleHouse(0x5c6a4a,0x3a4530,6,4,2.8,'flat') });

// -- Transport (4) --
registerAsset({ id:'bld_station', cat:'structures', family:'Transport', label:'Gare', icon:'🚉', color:0x8a6a4a, size:[7,4,5],
  build:()=>{ const g=buildSimpleHouse(0xd8c8a0,0x8a6a4a,7,5,3.2,'flat'); const canopy=mkBox(8,0.15,2,0x4a3a2a); canopy.position.set(0,3.6,3.4); canopy.parent = g;
    for(const x of [-3,0,3]){ const post=mkCyl(0.08,0.1,1.4,0x2a2a2a); post.position.set(x,2.9,4.3); post.parent = g;} return g; }});
registerAsset({ id:'bld_dock', cat:'structures', family:'Transport', label:'Quai', icon:'🛥️', color:0x6b5a40, size:[6,0.4,2.4],
  build:(c)=>{ const g=group(mkBox(6,0.3,2.4,c)); for(let i=0;i<5;i++){ const pile=mkCyl(0.12,0.14,1,c); pile.position.set(-2.6+i*1.3,-0.5,0); pile.parent = g;} return g; }});
registerAsset({ id:'bld_port', cat:'structures', family:'Transport', label:'Port', icon:'⚓', color:0x5c6a72, size:[8,3,5],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const dock=mkBox(8,0.3,4,0x6b5a40); dock.parent = g;
    const crane=mkCyl(0.2,0.25,3,0x8a6a2a,8); crane.position.set(-2.6,1.5,0); crane.parent = g;
    const arm=mkBox(3,0.2,0.2,0x8a6a2a); arm.position.set(-1,3,0); arm.parent = g; return g; }});
registerAsset({ id:'bld_lighthouse', cat:'structures', family:'Transport', label:'Phare', icon:'🗼', color:0xe8e0d0, size:[2.4,8,2.4],
  build:()=>{ const g=buildTower(0xe8e0d0,2,7,null);
    const lamp=BABYLON.MeshBuilder.CreateCylinder(_uid('cyl'), {diameterTop:0.6*2, diameterBottom:0.6*2, height:0.8, tessellation:10}, _scene);
    const lampMat = mkStdMat(_uid('mat'), _scene);
    lampMat.diffuseColor = hexIntToColor3(0xfff3c0); lampMat.emissiveColor = hexIntToColor3(0xffdc7a).scale(0.6);
    lamp.material = lampMat; lamp.position.y=7.4; lamp.parent = g;
    const cap=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.7*2, height:0.6, tessellation:10}, _scene);
    const capMat = mkStdMat(_uid('mat'), _scene); capMat.diffuseColor = hexIntToColor3(0xb03a2a);
    cap.material = capMat; cap.position.y=8.1; cap.parent = g;
    for(let i=0;i<4;i++){ const stripe=mkBox(0.05,1.5,2.05,0xb03a2a); stripe.position.y=1+i*1.5; stripe.rotation.y=i*Math.PI/4; stripe.parent = g;} return g; }});

// -- Ponts (3) --
registerAsset({ id:'bld_woodbridge', cat:'structures', family:'Ponts', label:'Pont en bois', icon:'🌉', color:0x6b4a2e, size:[8,2.5,2.6],
  build:()=> buildBridgeSpan(0x6b4a2e,8) });
registerAsset({ id:'bld_stonebridge', cat:'structures', family:'Ponts', label:'Pont de pierre', icon:'🌉', color:0x8a8578, size:[8,2.5,2.6],
  build:()=>{ const g=buildBridgeSpan(0x8a8578,8,0x8a8578); for(let i=0;i<2;i++){
      const arch=BABYLON.MeshBuilder.CreateTorus(_uid('torus'), {diameter:1.1*2, thickness:0.25*2, tessellation:12, arc:0.5}, _scene);
      const archMat = mkStdMat(_uid('mat'), _scene); archMat.diffuseColor = hexIntToColor3(0x8a8578); archMat.metadata = {roughness:0.9};
      arch.material = archMat; arch.position.set((i-0.5)*4,0,0); arch.rotation.x=Math.PI/2; arch.parent = g;} return g; }});
registerAsset({ id:'bld_suspbridge', cat:'structures', family:'Ponts', label:'Pont suspendu', icon:'🌉', color:0x5c5c54, size:[10,4,2.6],
  build:()=>{ const g=buildBridgeSpan(0x6b6b64,10,0x5c5c54); for(const sx of [-4.5,4.5]){ const tower=mkBox(0.4,3.5,0.4,0x5c5c54); tower.position.set(sx,3.7,0); tower.parent = g;
      const cable=mkBox(10.2,0.08,0.08,0x2a2a2a); cable.position.set(0,3.6,0); cable.parent = g;} return g; }});

// -- Structurel (3) --
registerAsset({ id:'bld_stairs', cat:'structures', family:'Structurel', label:'Escalier', icon:'🪜', color:0x8a8578, size:[1.4,2,3],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); for(let i=0;i<8;i++){ const step=mkBox(1.4,0.2,0.4,c); step.position.set(0,0.1+i*0.24,-1.4+i*0.4); step.parent = g;} return g; }});
registerAsset({ id:'bld_ramp', cat:'structures', family:'Structurel', label:'Rampe', icon:'📐', color:0x6b6a5f, size:[2,1.5,4],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene);
    const ramp=BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:2,height:0.3,depth:4}, _scene);
    const rampMat = mkStdMat(_uid('mat'), _scene); rampMat.diffuseColor = hexIntToColor3(c); rampMat.metadata = {roughness:0.85};
    ramp.material = rampMat; ramp.rotation.x=-0.35; ramp.position.y=0.75; ramp.metadata = {castShadow:true}; ramp.receiveShadows=true; ramp.parent = g;
    // Bandes antidérapantes + garde-corps ajoutés comme ENFANTS du
    // plan incliné (pas du groupe) : ils héritent directement de sa
    // rotation, pas besoin de refaire la trigonométrie à la main.
    for(let i=0;i<5;i++){
      const strip=BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:1.9,height:0.03,depth:0.12}, _scene);
      const stripMat = mkStdMat(_uid('mat'), _scene); stripMat.diffuseColor = hexIntToColor3(0xf0c020); stripMat.metadata = {roughness:0.6};
      strip.material = stripMat; strip.position.set(0, 0.165, -1.6+i*0.8); strip.metadata = {castShadow:false}; strip.parent = ramp; }
    for(const sx of [-1.02,1.02]){
      const rail=BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:0.06,height:1.4,depth:4.02}, _scene);
      const railMat = mkStdMat(_uid('mat'), _scene); railMat.diffuseColor = hexIntToColor3(0x3a3a3a); railMat.metadata = {metalness:0.4, roughness:0.5};
      rail.material = railMat; rail.position.set(sx,0.7,0); rail.metadata = {castShadow:false}; rail.parent = ramp; }
    return g; }});
registerAsset({ id:'bld_column', cat:'structures', family:'Structurel', label:'Colonne', icon:'🏛️', color:0xe8ddc0, size:[0.6,3.5,0.6],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const base=mkCyl(0.32,0.36,0.2,c); base.parent = g; const shaft=mkCyl(0.24,0.24,3,c,12); shaft.position.y=1.7; shaft.parent = g; const cap=mkCyl(0.32,0.28,0.2,c); cap.position.y=3.3; cap.parent = g; return g; }});

// -- Monuments (4) --
registerAsset({ id:'bld_pyramid', cat:'structures', family:'Monuments', label:'Pyramide', icon:'🔺', color:0xd9c290, size:[6,4,6],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene);
    const p=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:4*2, height:4, tessellation:4}, _scene);
    const pMat = mkStdMat(_uid('mat'), _scene); pMat.diffuseColor = hexIntToColor3(c); pMat.metadata = {roughness:0.9};
    p.material = pMat; p.convertToFlatShadedMesh(); p.rotation.y=Math.PI/4; p.position.y=2; p.metadata = {castShadow:true}; p.parent = g;
    // Pierre de faîte distincte + entrée basse — un cône à 4 faces tout
    // seul se lit comme une simple forme géométrique, pas un monument.
    const cap=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.35*2, height:0.45, tessellation:4}, _scene);
    const capMat = mkStdMat(_uid('mat'), _scene); capMat.diffuseColor = hexIntToColor3(0xc9a970); capMat.metadata = {roughness:0.4, metalness:0.15};
    cap.material = capMat; cap.rotation.y=Math.PI/4; cap.position.y=3.85; cap.metadata = {castShadow:false}; cap.parent = g;
    const doorway=BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:0.6,height:0.9,depth:0.5}, _scene);
    const doorwayMat = mkStdMat(_uid('mat'), _scene); doorwayMat.diffuseColor = hexIntToColor3(0x1c1a16);
    doorway.material = doorwayMat; doorway.position.set(0,0.45,2.55); doorway.metadata = {castShadow:false}; doorway.parent = g;
    return g; }});
registerAsset({ id:'bld_obelisk', cat:'structures', family:'Monuments', label:'Obélisque', icon:'🗿', color:0xc9a970, size:[1,5,1],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene);
    const shaft=BABYLON.MeshBuilder.CreateCylinder(_uid('cyl'), {diameterTop:0.25*2, diameterBottom:0.4*2, height:4.4, tessellation:4}, _scene);
    const shaftMat = mkStdMat(_uid('mat'), _scene); shaftMat.diffuseColor = hexIntToColor3(c); shaftMat.metadata = {roughness:0.85};
    shaft.material = shaftMat; shaft.convertToFlatShadedMesh(); shaft.position.y=2.2; shaft.parent = g;
    const tip=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.3*2, height:0.6, tessellation:4}, _scene);
    const tipMat = mkStdMat(_uid('mat'), _scene); tipMat.diffuseColor = hexIntToColor3(c);
    tip.material = tipMat; tip.position.y=4.7; tip.parent = g; return g; }});
registerAsset({ id:'bld_ruins2', cat:'structures', family:'Monuments', label:'Ruine antique', icon:'🏛️', color:0xc9c0a8, size:[5,3,4],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); for(let i=0;i<4;i++){ const h=1.5+Math.random()*1.8; const col=mkCyl(0.22,0.22,h,c,10); col.position.set(-2+i*1.3,h/2,0); col.parent = g;}
    const rubble=BABYLON.MeshBuilder.CreatePolyhedron(_uid('poly'), {type:2, size:0.5}, _scene);
    const rubbleMat = mkStdMat(_uid('mat'), _scene); rubbleMat.diffuseColor = hexIntToColor3(c);
    rubble.material = rubbleMat; rubble.convertToFlatShadedMesh(); rubble.position.set(1.5,0.25,1); rubble.parent = g; return g; }});
registerAsset({ id:'bld_arc', cat:'structures', family:'Monuments', label:'Arc de triomphe', icon:'🏛️', color:0xd8c8a0, size:[5,5,2],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const pillarL=mkBox(1,4.5,1.6,c); pillarL.position.x=-1.7; pillarL.parent = g;
    const pillarR=mkBox(1,4.5,1.6,c); pillarR.position.x=1.7; pillarR.parent = g;
    const top=mkBox(4.4,1,1.8,c); top.position.y=5; top.parent = g; return g; }});

// -- Portails (2) --
registerAsset({ id:'bld_castlegate', cat:'structures', family:'Portails', label:'Porte de château', icon:'🚪', color:0x7a776c, size:[3,4,1.2],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const towerL=buildTower(c,1.2,4,'crenel'); towerL.position.x=-1.6; towerL.parent = g;
    const towerR=buildTower(c,1.2,4,'crenel'); towerR.position.x=1.6; towerR.parent = g;
    const arch=mkBox(2,1,1,c); arch.position.y=3.3; arch.parent = g;
    const gate=mkBox(1.6,2.6,0.15,0x3a2a1e); gate.position.y=1.3; gate.parent = g; return g; }});
registerAsset({ id:'bld_magicgate', cat:'structures', family:'Portails', label:'Portail magique', icon:'🌀', color:0x5c3a8a, size:[3,4,0.6],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene);
    const frame=BABYLON.MeshBuilder.CreateTorus(_uid('torus'), {diameter:1.5*2, thickness:0.25*2, tessellation:20}, _scene);
    const frameMat = mkStdMat(_uid('mat'), _scene); frameMat.diffuseColor = hexIntToColor3(0x5c3a8a); frameMat.metadata = {roughness:0.5, metalness:0.3};
    frame.material = frameMat; frame.position.y=1.6; frame.parent = g;
    const veil=BABYLON.MeshBuilder.CreateDisc(_uid('disc'), {radius:1.3, tessellation:20}, _scene);
    const veilMat = mkStdMat(_uid('mat'), _scene);
    veilMat.diffuseColor = hexIntToColor3(0x8a4ad8); veilMat.emissiveColor = hexIntToColor3(0x8a4ad8).scale(0.7); veilMat.alpha = 0.55;
    veil.material = veilMat; veil.position.y=1.6; veil.parent = g; return g; }});

// -- Points d'eau bâtis (2) --
registerAsset({ id:'bld_well', cat:'structures', family:"Points d'eau bâtis", label:'Puits', icon:'⛲', color:0x8a8578, size:[1.4,1.5,1.4],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const wall=mkCyl(0.6,0.65,0.8,c,12); wall.parent = g;
    const water=BABYLON.MeshBuilder.CreateDisc(_uid('disc'), {radius:0.5, tessellation:12}, _scene);
    const waterMat = mkStdMat(_uid('mat'), _scene); waterMat.diffuseColor = hexIntToColor3(0x2f6f8f);
    water.material = waterMat; water.rotation.x=-Math.PI/2; water.position.y=0.81; water.parent = g;
    const postL=mkCyl(0.05,0.05,1.2,0x6b4a2e); postL.position.set(-0.5,0.8,0); postL.parent = g;
    const postR=mkCyl(0.05,0.05,1.2,0x6b4a2e); postR.position.set(0.5,0.8,0); postR.parent = g;
    const roof=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.8*2, height:0.5, tessellation:6}, _scene);
    const roofMat = mkStdMat(_uid('mat'), _scene); roofMat.diffuseColor = hexIntToColor3(0x3a2a1e);
    roof.material = roofMat; roof.position.y=1.65; roof.parent = g; return g; }});
registerAsset({ id:'bld_fountain2', cat:'structures', family:"Points d'eau bâtis", label:'Fontaine', icon:'⛲', color:0xc9c0a8, size:[2.4,2,2.4],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const basin=mkCyl(1.1,1.2,0.4,c,16); basin.parent = g;
    const water=BABYLON.MeshBuilder.CreateDisc(_uid('disc'), {radius:1, tessellation:16}, _scene);
    const waterMat = mkStdMat(_uid('mat'), _scene); waterMat.diffuseColor = hexIntToColor3(0x2f6f8f); waterMat.alpha = 0.8;
    water.material = waterMat; water.rotation.x=-Math.PI/2; water.position.y=0.41; water.parent = g;
    const pedestal=mkCyl(0.2,0.25,1.2,c,10); pedestal.position.y=0.4; pedestal.parent = g;
    const top=mkCyl(0.35,0.35,0.15,c,10); top.position.y=1.62; top.parent = g; return g; }});

// -- Camps (2) --
registerAsset({ id:'bld_tent', cat:'structures', family:'Camps', label:'Tente', icon:'⛺', color:0x8a6a4a, size:[2.2,1.6,2.2],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene);
    const cone=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:1.3*2, height:1.6, tessellation:8}, _scene);
    const coneMat = mkStdMat(_uid('mat'), _scene); coneMat.diffuseColor = hexIntToColor3(c); coneMat.metadata = {roughness:0.9};
    cone.material = coneMat; cone.position.y=0.8; cone.metadata = {castShadow:true}; cone.parent = g;
    const flap=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.35*2, height:1.55, tessellation:3}, _scene);
    const flapMat = mkStdMat(_uid('mat'), _scene);
    flapMat.diffuseColor = hexIntToColor3(c).scale(0.65); flapMat.metadata = {roughness:0.9}; flapMat.backFaceCulling = false;
    flap.material = flapMat; flap.position.set(0,0.78,1.05); flap.metadata = {castShadow:false}; flap.parent = g;
    for(const ang of [Math.PI*0.28,Math.PI*0.72,Math.PI*1.28,Math.PI*1.72]){
      const stakeX=Math.sin(ang)*1.55, stakeZ=Math.cos(ang)*1.55;
      const rope=mkCyl(0.012,0.012,1.0,0xc9c0a0,4); rope.rotation.z=Math.PI/2; rope.rotation.y=-ang;
      rope.position.set(stakeX*0.5,0.55,stakeZ*0.5); rope.metadata = {castShadow:false}; rope.parent = g;
      const stake=mkCyl(0.02,0.03,0.18,0x4a3a2a,5); stake.rotation.x=0.3;
      stake.position.set(stakeX,0.09,stakeZ); stake.metadata = {castShadow:false}; stake.parent = g;
    }
    return g; }});
registerAsset({ id:'bld_camp', cat:'structures', family:'Camps', label:'Campement', icon:'🏕️', color:0x8a6a4a, size:[5,1.8,5],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene);
    const t1=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:1.1*2, height:1.5, tessellation:8}, _scene);
    const t1Mat = mkStdMat(_uid('mat'), _scene); t1Mat.diffuseColor = hexIntToColor3(0x8a6a4a);
    t1.material = t1Mat; t1.position.set(-1.4,0.75,0); t1.parent = g;
    const t2=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:1*2, height:1.3, tessellation:8}, _scene);
    const t2Mat = mkStdMat(_uid('mat'), _scene); t2Mat.diffuseColor = hexIntToColor3(0x6b7a4a);
    t2.material = t2Mat; t2.position.set(1.6,0.65,0.6); t2.parent = g;
    const fire=mkCyl(0.25,0.3,0.15,0x3a2a1e); fire.position.set(0,0.08,-1); fire.parent = g;
    const flame=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.15*2, height:0.35, tessellation:6}, _scene);
    const flameMat = mkStdMat(_uid('mat'), _scene);
    flameMat.diffuseColor = hexIntToColor3(0xff8a2a); flameMat.emissiveColor = hexIntToColor3(0xff5a1e).scale(0.8);
    flame.material = flameMat; flame.position.set(0,0.3,-1); flame.parent = g; return g; }});

// -- Spéciaux (7) --
registerAsset({ id:'bld_magictower', cat:'structures', family:'Spéciaux', label:'Tour magique', icon:'🧙', color:0x5c3a8a, size:[2.4,7,2.4],
  build:()=> buildTower(0x5c3a8a,2.2,6.2,'glow') });
registerAsset({ id:'bld_library', cat:'structures', family:'Spéciaux', label:'Bibliothèque', icon:'📚', color:0xc9a970, size:[6,3.5,5],
  build:()=>{ const g=buildSimpleHouse(0xc9a970,0x4a3a2a,6,5,3,'flat'); for(let i=0;i<3;i++){ const col=mkCyl(0.18,0.18,3,0xe8ddc0,8); col.position.set(-2+i*2,1.5,2.55); col.parent = g;} return g; }});
registerAsset({ id:'bld_lab', cat:'structures', family:'Spéciaux', label:'Laboratoire', icon:'🧪', color:0x8a8f95, size:[5,3,4],
  build:()=>{ const g=buildSimpleHouse(0x8a8f95,0x5a5f65,5,4,2.8,'flat');
    // MeshPhysicalMaterial (transmission/verre) — pas d'équivalent StandardMaterial direct ;
    // approximé par transparence classique (alpha) avec teinte claire.
    const tank=BABYLON.MeshBuilder.CreateCylinder(_uid('cyl'), {diameterTop:0.5*2, diameterBottom:0.5*2, height:1.6, tessellation:10}, _scene);
    const tankMat = mkStdMat(_uid('mat'), _scene);
    tankMat.diffuseColor = hexIntToColor3(0x4ad8c0); tankMat.metadata = {roughness:0.1}; tankMat.alpha = 0.85;
    tank.material = tankMat; tank.position.set(1.6,0.8,2.2); tank.parent = g; return g; }});
registerAsset({ id:'bld_observatory', cat:'structures', family:'Spéciaux', label:'Observatoire', icon:'🔭', color:0xc9c0a8, size:[3.2,4,3.2],
  build:()=>{ const g=buildTower(0xc9c0a8,3,3,null);
    const dome=BABYLON.MeshBuilder.CreateSphere(_uid('dome'), {diameter:1.6*2, segments:10, slice:0.5}, _scene);
    const domeMat = mkStdMat(_uid('mat'), _scene); domeMat.diffuseColor = hexIntToColor3(0x4a5568); domeMat.metadata = {roughness:0.4, metalness:0.3};
    dome.material = domeMat; dome.position.y=3; dome.parent = g;
    const scope=mkBox(0.2,0.2,1.4,0x2a2a2a); scope.position.set(0,3.6,0.4); scope.rotation.x=-0.6; scope.parent = g; return g; }});
registerAsset({ id:'bld_futuredome', cat:'structures', family:'Spéciaux', label:'Dôme futuriste', icon:'🏙️', color:0x6b7078, size:[6,3.5,6],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const base=mkCyl(3,3,0.5,0x6b7078,16); base.parent = g;
    // MeshPhysicalMaterial (transmission verre) — approximé par transparence StandardMaterial.
    const dome=BABYLON.MeshBuilder.CreateSphere(_uid('dome'), {diameter:2.8*2, segments:12, slice:0.5}, _scene);
    const domeMat = mkStdMat(_uid('mat'), _scene);
    domeMat.diffuseColor = hexIntToColor3(0x8ad0e8); domeMat.metadata = {roughness:0.05}; domeMat.alpha = 0.6;
    dome.material = domeMat; dome.position.y=0.5; dome.parent = g;
    const ring=BABYLON.MeshBuilder.CreateTorus(_uid('torus'), {diameter:2.85*2, thickness:0.08*2, tessellation:24}, _scene);
    const ringMat = mkStdMat(_uid('mat'), _scene);
    ringMat.diffuseColor = hexIntToColor3(0x1a2530); ringMat.emissiveColor = hexIntToColor3(0x37eaff).scale(1);
    ring.material = ringMat; ring.rotation.x=Math.PI/2; ring.position.y=0.55; ring.parent = g; return g; }});
registerAsset({ id:'bld_hangar', cat:'structures', family:'Spéciaux', label:'Hangar', icon:'🏭', color:0x5c6068, size:[9,4,7],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene);
    const arch=BABYLON.MeshBuilder.CreateCylinder(_uid('cyl'), {diameterTop:3.5*2, diameterBottom:3.5*2, height:9, tessellation:16, arc:0.5}, _scene);
    const archMat = mkStdMat(_uid('mat'), _scene); archMat.diffuseColor = hexIntToColor3(c); archMat.metadata = {roughness:0.7, metalness:0.2}; archMat.backFaceCulling = false;
    arch.material = archMat; arch.rotation.z=Math.PI/2; arch.position.y=0; arch.parent = g;
    const doorL=mkBox(0.1,3.4,3.4,0x3a3d42); doorL.position.set(-1.7,1.7,3.5); doorL.parent = g;
    const doorR=mkBox(0.1,3.4,3.4,0x3a3d42); doorR.position.set(1.7,1.7,3.5); doorR.parent = g; return g; }});


// ============================================================
// DÉCORATION — 29 petits objets d'ambiance (mobilier, éclairage,
// statuaire, signalétique). Nouvelle catégorie "props" dans la palette.
// ============================================================
registerAsset({ id:'prop_bench', cat:'props', label:'Banc', icon:'🪑', color:0x6b4a2e, size:[1.4,0.5,0.5],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const seat=mkBox(1.4,0.08,0.4,c); seat.position.y=0.42; seat.parent = g;
    const back=mkBox(1.4,0.4,0.06,c); back.position.set(0,0.65,-0.18); back.parent = g;
    for(const x of [-0.6,0.6]){ const leg=mkBox(0.08,0.42,0.4,0x3a2a1e); leg.position.set(x,0.21,0); leg.parent = g;} return g; }});
registerAsset({ id:'prop_table', cat:'props', label:'Table', icon:'🪵', color:0x6b4a2e, size:[1.4,0.8,0.9],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const top=mkBox(1.4,0.08,0.9,c); top.position.y=0.76; top.parent = g;
    for(const [x,z] of [[-0.6,-0.4],[0.6,-0.4],[-0.6,0.4],[0.6,0.4]]){ const leg=mkBox(0.08,0.76,0.08,0x3a2a1e); leg.position.set(x,0.38,z); leg.parent = g;} return g; }});
registerAsset({ id:'prop_chair', cat:'props', label:'Chaise', icon:'🪑', color:0x6b4a2e, size:[0.5,0.9,0.5],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const seat=mkBox(0.45,0.06,0.45,c); seat.position.y=0.45; seat.parent = g;
    const back=mkBox(0.45,0.45,0.05,c); back.position.set(0,0.7,-0.2); back.parent = g;
    for(const [x,z] of [[-0.18,-0.18],[0.18,-0.18],[-0.18,0.18],[0.18,0.18]]){ const leg=mkBox(0.05,0.45,0.05,0x3a2a1e); leg.position.set(x,0.225,z); leg.parent = g;} return g; }});
registerAsset({ id:'prop_barrel', cat:'props', label:'Tonneau', icon:'🛢️', color:0x8a6a3f, size:[0.6,0.8,0.6],
  build:(c)=>{ const g = group(mkCyl(0.3,0.3,0.8,c,12));
    for(const hy of [0.15,0.4,0.65]){
      const hoop = BABYLON.MeshBuilder.CreateTorus(_uid('torus'), {diameter:0.305*2, thickness:0.02*2, tessellation:14}, _scene);
      const hoopMat = mkStdMat(_uid('mat'), _scene); hoopMat.diffuseColor = hexIntToColor3(0x3a3a3a); hoopMat.metadata = {metalness:0.6, roughness:0.4};
      hoop.material = hoopMat; hoop.rotation.x=Math.PI/2; hoop.position.y=hy; hoop.metadata = {castShadow:false}; hoop.parent = g; }
    const lid = BABYLON.MeshBuilder.CreateDisc(_uid('disc'), {radius:0.28, tessellation:12}, _scene);
    const lidMat = mkStdMat(_uid('mat'), _scene); lidMat.diffuseColor = hexIntToColor3(0x3a3a3a); lidMat.metadata = {metalness:0.3, roughness:0.6};
    lid.material = lidMat; lid.rotation.x=-Math.PI/2; lid.position.y=0.801; lid.parent = g;
    return g; }});
registerAsset({ id:'prop_crate', cat:'props', label:'Caisse', icon:'📦', color:0x8a6a3f, size:[0.6,0.6,0.6],
  build:(c)=>{ const g = group(mkBox(0.6,0.6,0.6,c));
    for(const [sx,sz] of [[-0.28,-0.28],[0.28,-0.28],[-0.28,0.28],[0.28,0.28]]){
      const edge = mkBox(0.05,0.62,0.05,0x4a3520); edge.position.set(sx,0.31,sz); edge.metadata = {castShadow:false}; edge.parent = g;
    }
    return g; }});
registerAsset({ id:'prop_chest', cat:'props', label:'Coffre', icon:'🧰', color:0x6b4a2e, size:[0.8,0.55,0.5],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const base=mkBox(0.8,0.35,0.5,c); base.parent = g;
    const lid=BABYLON.MeshBuilder.CreateCylinder(_uid('cyl'), {diameterTop:0.25*2, diameterBottom:0.25*2, height:0.5, tessellation:10, arc:0.5}, _scene);
    const lidMat = mkStdMat(_uid('mat'), _scene); lidMat.diffuseColor = hexIntToColor3(c); lidMat.metadata = {roughness:0.9}; lidMat.backFaceCulling = false;
    lid.material = lidMat; lid.rotation.z=Math.PI/2; lid.position.set(0,0.35,0); lid.parent = g;
    const lock=mkBox(0.08,0.1,0.05,0xd0a020); lock.position.set(0,0.35,0.26); lock.parent = g; return g; }});
registerAsset({ id:'prop_bed', cat:'props', label:'Lit', icon:'🛏️', color:0x8a8a90, size:[1.4,0.6,2],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const frame=mkBox(1.4,0.3,2,0x6b4a2e); frame.parent = g;
    const mattress=mkBox(1.3,0.2,1.9,0xe8e0d0); mattress.position.y=0.4; mattress.parent = g;
    const pillow=mkBox(0.5,0.12,0.35,0xffffff); pillow.position.set(0,0.55,-0.75); pillow.parent = g; return g; }});
registerAsset({ id:'prop_fireplace', cat:'props', label:'Cheminée', icon:'🔥', color:0x7a776c, size:[1.2,1.8,0.6],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const body=mkBox(1.2,1.8,0.6,c); body.parent = g;
    const hearth=mkBox(0.9,0.15,0.5,0x2a2a2a); hearth.position.set(0,0.3,0.05); hearth.parent = g;
    const flame=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.18*2, height:0.4, tessellation:6}, _scene);
    const flameMat = mkStdMat(_uid('mat'), _scene);
    flameMat.diffuseColor = hexIntToColor3(0xff8a2a); flameMat.emissiveColor = hexIntToColor3(0xff5a1e).scale(0.9);
    flame.material = flameMat; flame.position.set(0,0.5,0.1); flame.parent = g; return g; }});
registerAsset({ id:'prop_lamp', cat:'props', label:'Lampe', icon:'💡', color:0x2a2a2a, size:[0.3,1.6,0.3],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const pole=mkCyl(0.05,0.06,1.4,0x2a2a2a); pole.parent = g;
    const shade=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.22*2, height:0.3, tessellation:10}, _scene);
    const shadeMat = mkStdMat(_uid('mat'), _scene);
    shadeMat.diffuseColor = hexIntToColor3(0xf0e8c0); shadeMat.emissiveColor = hexIntToColor3(0xfff0b0).scale(0.6);
    shade.material = shadeMat; shade.position.y=1.5; shade.parent = g; return g; }});
registerAsset({ id:'prop_lantern', cat:'props', label:'Lanterne', icon:'🏮', color:0xb03a2a, size:[0.4,0.6,0.4],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const body=mkCyl(0.18,0.18,0.4,0xb03a2a,10);
    body.material.emissiveColor=hexIntToColor3(0xff6a2a).scale(0.5); body.parent = g;
    const top=mkCyl(0.02,0.1,0.1,0x3a2a1e); top.position.y=0.25; top.parent = g; const bottom=mkCyl(0.1,0.02,0.1,0x3a2a1e); bottom.position.y=-0.25; bottom.parent = g; return g; }});
registerAsset({ id:'prop_torch', cat:'props', label:'Torche', icon:'🔥', color:0x6b4a2e, size:[0.15,1.2,0.15],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const stick=mkCyl(0.03,0.04,1,0x6b4a2e); stick.parent = g;
    const flame=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.09*2, height:0.22, tessellation:6}, _scene);
    const flameMat = mkStdMat(_uid('mat'), _scene);
    flameMat.diffuseColor = hexIntToColor3(0xff8a2a); flameMat.emissiveColor = hexIntToColor3(0xff5a1e).scale(0.9);
    flame.material = flameMat; flame.position.y=0.6; flame.parent = g; return g; }});
registerAsset({ id:'prop_statue', cat:'props', label:'Statue', icon:'🗿', color:0xa8a29a, size:[0.8,2,0.6],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const base=mkBox(0.9,0.3,0.7,c); base.parent = g;
    const body=mkCyl(0.28,0.34,1.4,c,10); body.position.y=1; body.parent = g;
    const head=BABYLON.MeshBuilder.CreatePolyhedron(_uid('poly'), {type:3, size:0.24}, _scene);
    const headMat = mkStdMat(_uid('mat'), _scene); headMat.diffuseColor = hexIntToColor3(c);
    head.material = headMat; head.convertToFlatShadedMesh(); head.position.y=1.85; head.parent = g; return g; }});
registerAsset({ id:'prop_statue_giant', cat:'props', label:'Statue géante', icon:'🗿', color:0x8a857a, size:[2,6,1.6],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const base=mkBox(2.2,0.6,1.8,c); base.parent = g;
    const body=mkCyl(0.7,0.9,4,c,12); body.position.y=2.6; body.parent = g;
    const head=BABYLON.MeshBuilder.CreatePolyhedron(_uid('poly'), {type:3, size:0.6}, _scene);
    const headMat = mkStdMat(_uid('mat'), _scene); headMat.diffuseColor = hexIntToColor3(c);
    head.material = headMat; head.convertToFlatShadedMesh(); head.position.y=5; head.parent = g; return g; }});
registerAsset({ id:'prop_sign', cat:'props', label:'Panneau', icon:'🪧', color:0x6b4a2e, size:[0.9,1.2,0.1],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const post=mkCyl(0.05,0.06,1,0x6b4a2e); post.parent = g;
    const board=mkBox(0.8,0.5,0.05,0xd8c8a0); board.position.y=1.05; board.parent = g; return g; }});
registerAsset({ id:'prop_dirsign', cat:'props', label:'Panneau directionnel', icon:'➡️', color:0x6b4a2e, size:[1,1.4,0.1],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const post=mkCyl(0.05,0.06,1.3,0x6b4a2e); post.parent = g;
    const arrow1=mkBox(0.6,0.2,0.04,0xd8c8a0); arrow1.position.set(0.2,1.1,0); arrow1.parent = g;
    const arrow2=mkBox(0.5,0.2,0.04,0xd8c8a0); arrow2.position.set(-0.15,0.85,0); arrow2.rotation.z=0.3; arrow2.parent = g; return g; }});
registerAsset({ id:'prop_flag', cat:'props', label:'Drapeau', icon:'🚩', color:0xd8384a, size:[0.6,1.8,0.05],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const pole=mkCyl(0.03,0.04,1.8,0x2a2a2a); pole.parent = g;
    const cloth=mkBox(0.5,0.35,0.03,0xd8384a); cloth.position.set(0.28,0.75,0); cloth.parent = g; return g; }});
registerAsset({ id:'prop_banner', cat:'props', label:'Bannière', icon:'🎏', color:0x3a5cb0, size:[0.5,2,0.05],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const cloth=mkBox(0.5,1.8,0.04,0x3a5cb0); cloth.parent = g;
    const emblem=BABYLON.MeshBuilder.CreateDisc(_uid('disc'), {radius:0.14, tessellation:10}, _scene);
    const emblemMat = mkStdMat(_uid('mat'), _scene); emblemMat.diffuseColor = hexIntToColor3(0xf0c020);
    emblem.material = emblemMat; emblem.position.set(0,0.4,0.03); emblem.parent = g; return g; }});
registerAsset({ id:'prop_clock', cat:'props', label:'Horloge', icon:'🕐', color:0x3a2a1e, size:[0.6,0.6,0.15],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const face=mkCyl(0.3,0.3,0.08,0xe8e0d0,16); face.rotation.z=Math.PI/2; face.parent = g;
    const rim=BABYLON.MeshBuilder.CreateTorus(_uid('torus'), {diameter:0.3*2, thickness:0.03*2, tessellation:16}, _scene);
    const rimMat = mkStdMat(_uid('mat'), _scene); rimMat.diffuseColor = hexIntToColor3(0x3a2a1e);
    rim.material = rimMat; rim.rotation.y=Math.PI/2; rim.parent = g; return g; }});
registerAsset({ id:'prop_bell', cat:'props', label:'Cloche', icon:'🔔', color:0xc0a030, size:[0.5,0.6,0.5],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene);
    const bell=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.28*2, height:0.4, tessellation:10, arc:1}, _scene);
    const bellMat = mkStdMat(_uid('mat'), _scene); bellMat.diffuseColor = hexIntToColor3(c); bellMat.metadata = {metalness:0.7, roughness:0.3}; bellMat.backFaceCulling = false;
    bell.material = bellMat; bell.position.y=0.3; bell.parent = g;
    const clapper=BABYLON.MeshBuilder.CreateSphere(_uid('sphere'), {diameter:0.05*2, segments:6}, _scene);
    const clapperMat = mkStdMat(_uid('mat'), _scene); clapperMat.diffuseColor = hexIntToColor3(0x3a2a1e);
    clapper.material = clapperMat; clapper.position.y=0.08; clapper.parent = g; return g; }});
registerAsset({ id:'prop_flowerpot', cat:'props', label:'Pot de fleurs', icon:'🪴', color:0xb0623a, size:[0.4,0.5,0.4],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const pot=mkCyl(0.16,0.2,0.28,0xb0623a,10); pot.parent = g;
    const plant=BABYLON.MeshBuilder.CreatePolyhedron(_uid('poly'), {type:3, size:0.16}, _scene);
    const plantMat = mkStdMat(_uid('mat'), _scene); plantMat.diffuseColor = hexIntToColor3(0x4f7a3a);
    plant.material = plantMat; plant.convertToFlatShadedMesh(); plant.position.y=0.35; plant.parent = g; return g; }});
registerAsset({ id:'prop_decofountain', cat:'props', label:'Fontaine décorative', icon:'⛲', color:0xc9c0a8, size:[1.6,1.4,1.6],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const basin=mkCyl(0.75,0.8,0.3,c,16); basin.parent = g;
    const water=BABYLON.MeshBuilder.CreateDisc(_uid('disc'), {radius:0.65, tessellation:16}, _scene);
    const waterMat = mkStdMat(_uid('mat'), _scene); waterMat.diffuseColor = hexIntToColor3(0x2f6f8f); waterMat.alpha = 0.8;
    water.material = waterMat; water.rotation.x=-Math.PI/2; water.position.y=0.31; water.parent = g;
    const pedestal=mkCyl(0.14,0.18,0.9,c,10); pedestal.position.y=0.3; pedestal.parent = g; return g; }});
registerAsset({ id:'prop_cart', cat:'props', label:'Chariot', icon:'🛒', color:0x6b4a2e, size:[1.4,0.9,0.9],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const bed=mkBox(1.4,0.4,0.9,c); bed.position.y=0.5; bed.parent = g;
    for(const x of [-0.5,0.5]){
      const wheel=BABYLON.MeshBuilder.CreateTorus(_uid('torus'), {diameter:0.28*2, thickness:0.06*2, tessellation:14}, _scene);
      const wheelMat = mkStdMat(_uid('mat'), _scene); wheelMat.diffuseColor = hexIntToColor3(0x3a2a1e);
      wheel.material = wheelMat; wheel.rotation.y=Math.PI/2; wheel.position.set(x,0.28,0.5); wheel.parent = g;}
    return g; }});
registerAsset({ id:'prop_brokenwheel', cat:'props', label:'Roue cassée', icon:'☸️', color:0x5c4530, size:[0.7,0.15,0.7],
  build:(c)=>{
    const wheel=BABYLON.MeshBuilder.CreateTorus(_uid('torus'), {diameter:0.32*2, thickness:0.05*2, tessellation:12, arc:0.75}, _scene);
    const wheelMat = mkStdMat(_uid('mat'), _scene); wheelMat.diffuseColor = hexIntToColor3(c); wheelMat.metadata = {roughness:0.9}; wheelMat.backFaceCulling = false;
    wheel.material = wheelMat; wheel.rotation.x=Math.PI/2; wheel.position.y=0.32; wheel.rotation.z=0.4;
    const hub = BABYLON.MeshBuilder.CreateCylinder(_uid('cyl'), {diameterTop:0.06*2, diameterBottom:0.06*2, height:0.06, tessellation:8}, _scene);
    const hubMat = mkStdMat(_uid('mat'), _scene); hubMat.diffuseColor = hexIntToColor3(0x3a2a1a); hubMat.metadata = {roughness:0.9};
    hub.material = hubMat; hub.rotation.x=Math.PI/2; hub.metadata = {castShadow:false}; hub.parent = wheel;
    for(let i=0;i<3;i++){
      const spokeLen=0.12+Math.random()*0.06;
      const spoke=BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:0.03,height:spokeLen,depth:0.02}, _scene);
      const spokeMat = mkStdMat(_uid('mat'), _scene); spokeMat.diffuseColor = hexIntToColor3(c); spokeMat.metadata = {roughness:0.9};
      spoke.material = spokeMat;
      const ang=(i/3)*Math.PI*2+0.3; spoke.position.set(Math.sin(ang)*spokeLen*0.5,0,Math.cos(ang)*spokeLen*0.5); spoke.rotation.z=-ang; spoke.metadata = {castShadow:false}; spoke.parent = hub; }
    return group(wheel); }});
registerAsset({ id:'prop_cage', cat:'props', label:'Cage', icon:'🔒', color:0x3a3a3a, size:[0.8,1.2,0.8],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); for(let i=0;i<8;i++){ const bar=mkCyl(0.02,0.02,1.1,c,6); const ang=i/8*Math.PI*2; bar.position.set(Math.cos(ang)*0.36,0.55,Math.sin(ang)*0.36); bar.parent = g;}
    const top=mkCyl(0.38,0.38,0.03,c,12); top.position.y=1.1; top.parent = g; const bottom=mkCyl(0.38,0.38,0.03,c,12); bottom.position.y=0.02; bottom.parent = g; return g; }});
registerAsset({ id:'prop_throne', cat:'props', label:'Trône', icon:'👑', color:0xc0a030, size:[1,2,1],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const seat=mkBox(0.8,0.15,0.8,c); seat.position.y=0.6; seat.parent = g;
    const back=mkBox(0.8,1.4,0.15,c); back.position.set(0,1.1,-0.35); back.parent = g;
    for(const [x,z] of [[-0.35,-0.35],[0.35,-0.35],[-0.35,0.35],[0.35,0.35]]){ const leg=mkBox(0.1,0.6,0.1,c); leg.position.set(x,0.3,z); leg.parent = g;}
    const gem=BABYLON.MeshBuilder.CreatePolyhedron(_uid('poly'), {type:3, size:0.08}, _scene);
    const gemMat = mkStdMat(_uid('mat'), _scene);
    gemMat.diffuseColor = hexIntToColor3(0xd8384a); gemMat.emissiveColor = hexIntToColor3(0x8a1a2a).scale(0.4);
    gem.material = gemMat; gem.position.set(0,1.7,-0.32); gem.parent = g; return g; }});
registerAsset({ id:'prop_carpet', cat:'props', label:'Tapis', icon:'🟥', color:0x9a2a2a, size:[2,0.05,1.2],
  build:(c)=>{ const g = group(mkBox(2,0.03,1.2,c));
    const border = hexIntToColor3(c).scale(0.6);
    const inset = mkBox(1.7,0.032,0.9,border,{opacity:1}); inset.position.y=0.001; inset.metadata = {castShadow:false}; inset.parent = g;
    const center = mkBox(1.2,0.033,0.55,c); center.position.y=0.002; center.metadata = {castShadow:false}; center.parent = g;
    return g; }});
registerAsset({ id:'prop_altar', cat:'props', label:'Autel', icon:'🕯️', color:0x8a8578, size:[1.4,1,0.8],
  build:(c)=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); const base=mkBox(1.4,0.8,0.8,c); base.parent = g;
    const slab=mkBox(1.6,0.15,1,c); slab.position.y=0.47; slab.parent = g;
    for(const x of [-0.5,0.5]){ const candle=mkCyl(0.04,0.04,0.3,0xe8e0d0); candle.position.set(x,0.7,0); candle.parent = g;
      const flame=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.03*2, height:0.08, tessellation:6}, _scene);
      const flameMat = mkStdMat(_uid('mat'), _scene);
      flameMat.diffuseColor = hexIntToColor3(0xff8a2a); flameMat.emissiveColor = hexIntToColor3(0xff5a1e).scale(0.9);
      flame.material = flameMat; flame.position.set(x,0.9,0); flame.parent = g;} return g; }});
registerAsset({ id:'prop_decocrystal', cat:'props', label:'Cristal décoratif', icon:'💎', color:0x8a4ad8, size:[0.5,0.8,0.5],
  build:()=> buildCrystalAsset(0x8a4ad8, 0.8) });
registerAsset({ id:'prop_campfire', cat:'props', label:'Feu de camp', icon:'🔥', color:0x4a3a2a, size:[0.8,0.6,0.8],
  build:()=>{ const g=new BABYLON.TransformNode(_uid('grp'), _scene); for(let i=0;i<5;i++){ const log=mkCyl(0.05,0.06,0.6,0x4a3a2a,6); log.rotation.z=Math.PI/2; log.rotation.y=i/5*Math.PI; log.position.y=0.06; log.parent = g;}
    const flame=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.2*2, height:0.5, tessellation:8}, _scene);
    const flameMat = mkStdMat(_uid('mat'), _scene);
    flameMat.diffuseColor = hexIntToColor3(0xff8a2a); flameMat.emissiveColor = hexIntToColor3(0xff5a1e).scale(1);
    flame.material = flameMat; flame.position.y=0.35; flame.parent = g;
    const flame2=BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.12*2, height:0.3, tessellation:8}, _scene);
    const flame2Mat = mkStdMat(_uid('mat'), _scene);
    flame2Mat.diffuseColor = hexIntToColor3(0xffd020); flame2Mat.emissiveColor = hexIntToColor3(0xffb020).scale(1);
    flame2.material = flame2Mat; flame2.position.y=0.4; flame2.parent = g; return g; }});


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
    const g = new BABYLON.TransformNode(_uid('grp'), _scene);
    const frameColor = 0x6b7178;
    const frame = mkBevelBox(0.62,0.62,0.05, frameColor, {bevel:0.012, roughness:0.4, metalness:0.35, map:texStylizedPanel(frameColor)});
    frame.parent = g;
    const plaque = mkBevelBox(0.46,0.46,0.03, c, {bevel:0.008, roughness:0.5, metalness:0.08, map:texStylizedPanel(c, 0x8a7255)});
    plaque.position.y = frame.position.y; // recentre verticalement sur le cadre
    plaque.position.z = -0.006; // léger retrait par rapport au cadre en surplomb
    plaque.parent = g;
    // motif/numéro gravé (accent ocre désaturé, cf. brief)
    const mark = mkBox(0.22,0.05,0.02,0x8a7255); mark.position.set(0,frame.position.y,0.015); mark.parent = g;
    // 4 vis de fixation aux coins
    [[-0.26,-0.26],[0.26,-0.26],[-0.26,0.26],[0.26,0.26]].forEach(([bx,by])=>{
      const bolt = mkCyl(0.014,0.014,0.02,0x3a3d42,8);
      bolt.rotation.x = Math.PI/2; bolt.position.set(bx, frame.position.y+by, 0.026); bolt.parent = g;
    });
    // écaillure de peinture ponctuelle sur un coin (usure géométrique, pas que texture)
    const chip = mkBox(0.05,0.04,0.052,0x3a3d42); chip.position.set(0.24,frame.position.y+0.24,0); chip.rotation.z=0.3; chip.parent = g;
    return g;
  }});
// Plaque au sol stylisée AAA : chanfrein périphérique prononcé (seul
// élément 3D porteur de lecture vue en plongée), joint sombre encaissé,
// rainures antidérapantes, boulons de fixation — voir l'analyse "plaque
// au sol" du brief.
registerAsset({ id:'tac_floor_plaque', cat:'tactical', label:'Plaque au sol (AAA)', icon:'▧', color:0xb8b0a0, size:[1.0,0.07,1.0],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('grp'), _scene);
    // joint périphérique sombre encaissé (base légèrement plus large, visible en liseré)
    const joint = mkBox(1.06,0.02,1.06,0x5a5248); joint.metadata = {castShadow:false}; joint.parent = g;
    // plaque avec chanfrein périphérique prononcé (capte la lumière rasante)
    const plaque = mkBevelBox(1.0,0.05,1.0, c, {bevel:0.028, bevelSegments:3, roughness:0.62, metalness:0.06, map:texStylizedPanel(c, 0x5a5248)});
    plaque.position.y += 0.02; plaque.parent = g;
    // rainures antidérapantes (pattern chevron, relief très faible)
    for(let i=-2;i<=2;i++){
      const groove = mkBox(0.62,0.006,0.035,0x5a5248);
      groove.position.set(0, plaque.position.y+0.05, i*0.16);
      groove.rotation.y = 0.78; groove.metadata = {castShadow:false}; groove.parent = g;
    }
    // boulons de fixation en périphérie
    [[-0.42,-0.42],[0.42,-0.42],[-0.42,0.42],[0.42,0.42]].forEach(([bx,bz])=>{
      const bolt = mkCyl(0.02,0.02,0.02,0x3a3d42,8);
      bolt.rotation.x = Math.PI/2; bolt.position.set(bx, plaque.position.y+0.04, bz); bolt.parent = g;
    });
    return g;
  }});

registerAsset({ id:'tac_explosive_barrel', cat:'tactical', label:'Baril explosif', icon:'🛢️', color:0xc23a2a, size:[0.6,0.9,0.6],
  build:(c)=>{
    const g = group(mkCyl(0.3,0.3,0.85,c));
    const band = mkCyl(0.31,0.31,0.1,0x2a2a2a,16); band.position.y=0.15; band.parent = g;
    const skull = mkBox(0.22,0.22,0.02,0xf0d020); skull.position.set(0,0,0.31); skull.parent = g;
    return g;
  }});
registerAsset({ id:'tac_ammo_crate', cat:'tactical', label:'Caisse de munitions', icon:'📦', color:0x5a6a4a, size:[0.7,0.45,0.5],
  build:(c)=>{
    const g = group(mkBox(0.7,0.4,0.5,c,{roughness:0.75}));
    const lid = mkBox(0.72,0.06,0.52,hexIntToColor3(c).scale(0.8),{roughness:0.7}); lid.position.y=0.23; lid.parent = g;
    for(const sx of [-0.28,0.28]){ const clasp = mkBox(0.06,0.08,0.03,0x2a2a2a); clasp.position.set(sx,0.2,0.26); clasp.parent = g; }
    return g;
  }});
registerAsset({ id:'tac_ac_unit', cat:'tactical', label:'Générateur / climatiseur', icon:'⚙️', color:0x8a9098, size:[0.9,0.8,0.6],
  build:(c)=>{
    const g = group(mkBox(0.9,0.75,0.6,c,{metalness:0.4,roughness:0.5}));
    for(let i=0;i<3;i++){ const vent = mkBox(0.7,0.03,0.02,0x3a3d42); vent.position.set(0,0.15+i*0.12,0.31); vent.parent = g; }
    const fan = mkCyl(0.16,0.16,0.05,0x2a2a2a,16); fan.rotation.x=Math.PI/2; fan.position.set(0,-0.1,0.32); fan.parent = g;
    return g;
  }});
registerAsset({ id:'tac_team_banner', cat:'tactical', label:"Banderole d'équipe", icon:'🚩', color:0xd83a3a, size:[1.0,2.2,0.06],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('grp'), _scene);
    const pole = mkCyl(0.04,0.04,2.4,0x2a2a2a,8); pole.position.y=1.2; pole.parent = g;
    const banner = mkBox(1.0,1.6,0.03,c,{roughness:0.8}); banner.position.set(0.52,1.6,0); banner.parent = g;
    return g;
  }});
registerAsset({ id:'tac_signal_cone', cat:'tactical', label:'Cône de signalisation', icon:'🔺', color:0xff7a1a, size:[0.35,0.5,0.35],
  build:(c)=>{
    // Pas de mk* pour un cône (mkCyl impose un rayon haut ET bas) — même
    // convention manuelle que mkBox/mkCyl : ombre portée + reçue,
    // origine ramenée à la base (sinon la moitié du cône passerait sous
    // le sol, ConeGeometry étant centrée par défaut).
    const m = BABYLON.MeshBuilder.CreateCylinder(_uid('cone'), {diameterTop:0, diameterBottom:0.2*2, height:0.5, tessellation:10}, _scene);
    const mat = mkStdMat(_uid('mat'), _scene);
    mat.diffuseColor = hexIntToColor3(c); mat.metadata = { roughness:0.65 };
    m.material = mat;
    m.receiveShadows = true; m.metadata = { castShadow:true }; m.position.y = 0.25;
    return m;
  }});

// ---- VERTICALITÉ ----
registerAsset({ id:'vert_stairs', cat:'vertical', label:'Escalier', icon:'🪜', color:0x8a8378, size:[1.6,2.4,3],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('grp'), _scene);
    const steps = 8;
    for(let i=0;i<steps;i++){
      const s = mkBox(1.6,2.4/steps,3/steps,c);
      s.position.set(0, (i+0.5)*(2.4/steps), -1.5+(i+0.5)*(3/steps));
      s.parent = g;
    }
    return g;
  }});
registerAsset({ id:'vert_ramp', cat:'vertical', label:'Rampe', icon:'📐', color:0x8a8378, size:[2,2,4.2],
  build:(c)=>{ const r = mkBox(2,0.3,4.2,c); r.rotation.x = -0.45; r.position.y = 1;
    for(let i=0;i<5;i++){
      const strip=BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:1.9,height:0.03,depth:0.12}, _scene);
      const stripMat = mkStdMat(_uid('mat'), _scene); stripMat.diffuseColor = hexIntToColor3(0xf0c020); stripMat.metadata = {roughness:0.6};
      strip.material = stripMat; strip.position.set(0, 0.165, -1.68+i*0.84); strip.metadata = {castShadow:false}; strip.parent = r; }
    for(const sx of [-1.02,1.02]){
      const rail=BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:0.06,height:0.5,depth:4.22}, _scene);
      const railMat = mkStdMat(_uid('mat'), _scene); railMat.diffuseColor = hexIntToColor3(0x3a3a3a); railMat.metadata = {metalness:0.4, roughness:0.5};
      rail.material = railMat; rail.position.set(sx,0.4,0); rail.metadata = {castShadow:false}; rail.parent = r; }
    return r; }});
registerAsset({ id:'vert_ladder', cat:'vertical', label:'Échelle', icon:'🪛', color:0x3a3a3a, size:[0.6,3,0.15],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('grp'), _scene);
    const rail1 = mkBox(0.06,3,0.06,c); rail1.position.x=-0.25;
    const rail2 = mkBox(0.06,3,0.06,c); rail2.position.x=0.25;
    rail1.parent = g; rail2.parent = g;
    for(let i=0;i<7;i++){ const rung = mkBox(0.56,0.05,0.05,c); rung.position.y = 0.3+i*0.4; rung.parent = g; }
    return g;
  }});
registerAsset({ id:'vert_elevator', cat:'vertical', label:'Ascenseur', icon:'🛗', color:0x6a6a6a, size:[2,0.2,2],
  build:(c)=>{ const base = mkBox(2,0.2,2,c,{metalness:0.4});
    for(const [sx,sz] of [[-0.95,0],[0.95,0],[0,-0.95],[0,0.95]]){
      const post = mkBox(0.08,1,0.08,0x3a3a3a); post.position.set(sx,0.6,sz); post.metadata = {castShadow:false}; post.parent = base;
    }
    const rail1 = mkBox(1.9,0.05,0.05,0x3a3a3a); rail1.position.set(0,1.08,0.95); rail1.metadata = {castShadow:false}; rail1.parent = base;
    const rail2 = rail1.clone(_uid('box')); rail2.position.z=-0.95; rail2.parent = base;
    const rail3 = mkBox(0.05,0.05,1.9,0x3a3a3a); rail3.position.set(0.95,1.08,0); rail3.metadata = {castShadow:false}; rail3.parent = base;
    const panel = mkBox(0.25,0.35,0.06,0x2a2a2a); panel.position.set(-0.95,0.5,0.95); panel.metadata = {castShadow:false}; panel.parent = base;
    const btn = BABYLON.MeshBuilder.CreateDisc(_uid('disc'), {radius:0.03, tessellation:8}, _scene);
    const btnMat = mkStdMat(_uid('mat'), _scene);
    btnMat.diffuseColor = hexIntToColor3(0xf0c020); btnMat.emissiveColor = hexIntToColor3(0xf0c020).scale(0.6);
    btn.material = btnMat; btn.position.set(-0.95,0.5,0.99); btn.parent = base;
    return base; }});
registerAsset({ id:'vert_rope', cat:'vertical', label:'Corde', icon:'🪢', color:0x8a6a3f, size:[0.08,4,0.08],
  build:(c)=> mkCyl(0.05,0.05,4,c,6) });
registerAsset({ id:'vert_walkway', cat:'vertical', label:'Passerelle', icon:'🌉', color:0x5c6470, size:[1.6,0.15,5],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('grp'), _scene);
    const deck = mkBox(1.6,0.15,5,c,{metalness:0.3}); deck.parent = g;
    const rail1 = mkBox(0.06,0.9,5,0x3a3a3a); rail1.position.set(-0.77,0.9,0); rail1.parent = g;
    const rail2 = mkBox(0.06,0.9,5,0x3a3a3a); rail2.position.set(0.77,0.9,0); rail2.parent = g;
    return g;
  }});
registerAsset({ id:'vert_balcony', cat:'vertical', label:'Balcon', icon:'🏗️', color:0xb9ac8e, size:[3,0.2,1.6],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('grp'), _scene);
    const floor = mkBox(3,0.2,1.6,c); floor.parent = g;
    const rail = mkBox(3,0.8,0.08,0x3a3a3a); rail.position.set(0,0.8,0.76); rail.parent = g;
    return g;
  }});
registerAsset({ id:'vert_access_ramp', cat:'vertical', label:"Rampe d'accès", icon:'📐', color:0x8a8a86, size:[4,1.5,3],
  build:(c)=>{
    // TODO-PORT: géométrie originale = THREE.Shape triangulaire (profil de
    // rampe) extrudée sur depth=3 (THREE.ExtrudeGeometry) puis pivotée de
    // PI/2 — pas d'équivalent MeshBuilder direct ; simplifiée ici en boîte
    // pleine aux dimensions englobantes (4 x 1.5 x 3), cf. règle de
    // portage "ExtrudeGeometry custom -> box englobante".
    const ramp = BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:4,height:1.5,depth:3}, _scene);
    const rampMat = mkStdMat(_uid('mat'), _scene); rampMat.diffuseColor = hexIntToColor3(c); rampMat.metadata = {roughness:0.85};
    ramp.material = rampMat; ramp.position.set(0,0.75,0); ramp.metadata = {castShadow:true}; ramp.receiveShadows = true;
    // Bandes antidérapantes — approximées à plat sur le dessus de la boîte
    // englobante (la géométrie en pente réelle a été simplifiée ci-dessus).
    const stripMat = mkStdMat(_uid('mat'), _scene); stripMat.diffuseColor = hexIntToColor3(0xf0c020); stripMat.metadata = {roughness:0.6};
    [-1.2,-0.4,0.4,1.2].forEach(x=>{
      const strip = BABYLON.MeshBuilder.CreateBox(_uid('box'), {width:0.15,height:0.03,depth:2.8}, _scene);
      strip.material = stripMat;
      strip.position.set(x, 0.77, 0); strip.metadata = {castShadow:false};
      strip.parent = ramp;
    });
    const g = group(ramp);
    return g;
  }});
registerAsset({ id:'vert_platform', cat:'vertical', label:'Plateforme surélevée', icon:'🔲', color:0x6b6f76, size:[3,1.2,3],
  build:(c)=>{
    const g = group(mkBox(3,0.2,3,c,{roughness:0.8}));
    for(const [sx,sz] of [[-1.3,-1.3],[1.3,-1.3],[-1.3,1.3],[1.3,1.3]]){
      const leg = mkBox(0.18,1.2,0.18,0x3a3a3a); leg.position.set(sx,-0.6,sz); leg.parent = g;
    }
    return g;
  }});
registerAsset({ id:'vert_hatch', cat:'vertical', label:'Trappe au sol', icon:'⬜', color:0x4a4f57, size:[1.2,0.08,1.2],
  build:(c)=>{
    const g = group(mkBox(1.2,0.06,1.2,c,{metalness:0.5,roughness:0.4}));
    for(let i=1;i<4;i++){ const seam = mkBox(1.15,0.01,0.02,0x2a2e33); seam.position.set(0,0.035,-0.6+i*0.3); seam.parent = g; }
    const handle = mkCyl(0.03,0.03,0.12,0x1a1a1a,8); handle.rotation.x=Math.PI/2; handle.position.set(0,0.08,0.4); handle.parent = g;
    return g;
  }});
registerAsset({ id:'vert_watchtower', cat:'vertical', label:"Tour d'observation", icon:'🗼', color:0x6b5a3f, size:[2,4.5,2],
  build:(c)=>{
    const g = new BABYLON.TransformNode(_uid('grp'), _scene);
    for(const [sx,sz] of [[-0.85,-0.85],[0.85,-0.85],[-0.85,0.85],[0.85,0.85]]){
      const leg = mkBox(0.14,4.2,0.14,c,{roughness:0.85}); leg.position.set(sx,2.1,sz); leg.parent = g;
    }
    const deck = mkBox(2,0.15,2,c,{roughness:0.8}); deck.position.y=4.2; deck.parent = g;
    [[0,4.5,1],[0,4.5,-1],[1,4.5,0,Math.PI/2],[-1,4.5,0,Math.PI/2]].forEach(([px,py,pz,ry])=>{
      const r = mkBox(2,0.6,0.06,0x3a3a3a); r.position.set(px,py,pz); if(ry) r.rotation.y=ry; r.parent = g;
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

// map_assets_babylon_partE.js — Portage Babylon.js de map_assets.js, lignes
// 4065-4478 (Three.js r128 -> Babylon.js 8.33.1). Section "SOLS" : la
// fonction mkFloorTile(size,color,pattern,tex) et les registerAsset({...})
// de la catégorie "floors" (dalles de 4x4m). Statements top-level, à
// fusionner dans la fermeture window.MapAssets = (function(){...})() du
// fichier principal — s'appuie sur les helpers déjà portés là-bas (mkBox,
// mkCyl, group, hexIntToColor3, cachedTexture, wrapCanvasTexture,
// mkRepeatTex, registerAsset, _scene, _uid) ainsi que sur les fonctions
// tex*Floor / texConcrete déjà portées à l'identique.

// ---- Petits helpers de forme locaux à cette section (pas dans le socle
// commun) : Three.js utilisait ConeGeometry/SphereGeometry/CircleGeometry/
// DodecahedronGeometry directement pour les petits détails de décor des
// dalles (touffes d'herbe, galets, flaques, empreintes...) — Babylon n'a
// pas d'équivalent "mkBox/mkCyl" tout prêt pour ces formes, donc on les
// réimplémente ici sur le même modèle (StandardMaterial + metadata
// roughness/metalness + castShadow via metadata) pour rester cohérent
// avec le reste du portage.
function shade(colorIn, factor){
  return hexIntToColor3(colorIn).scale(factor);
}
function mkFloorCone(radius, height, segs, color, opts={}){
  // ConeGeometry(radius,height,segs) -> cylindre Babylon avec diamètre du
  // dessus = 0 (une pointe), équivalent visuel d'un cône Three.js.
  const m = BABYLON.MeshBuilder.CreateCylinder(_uid('fcone'), { diameterTop:0, diameterBottom:radius*2, height, tessellation:segs }, _scene);
  const mat = mkStdMat(_uid('fconeMat'), _scene);
  mat.diffuseColor = hexIntToColor3(color);
  mat.metadata = { roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.1 };
  m.material = mat;
  m.receiveShadows = true;
  m.metadata = { castShadow: true };
  return m;
}
function mkFloorSphere(radius, segs, color, opts={}){
  const m = BABYLON.MeshBuilder.CreateSphere(_uid('fsphere'), { diameter:radius*2, segments:segs }, _scene);
  const mat = mkStdMat(_uid('fsphereMat'), _scene);
  mat.diffuseColor = hexIntToColor3(color);
  mat.metadata = { roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.1 };
  m.material = mat;
  m.receiveShadows = true;
  m.metadata = { castShadow: true };
  return m;
}
function mkFloorDisc(radius, segs, color, opts={}){
  // CircleGeometry -> CreateDisc : même plan par défaut (XY, face vers
  // +Z) donc la même rotation.x=-Math.PI/2 appliquée par l'appelant pour
  // le coucher à plat au sol reste valable telle quelle.
  const m = BABYLON.MeshBuilder.CreateDisc(_uid('fdisc'), { radius, tessellation:segs }, _scene);
  const mat = mkStdMat(_uid('fdiscMat'), _scene);
  mat.diffuseColor = hexIntToColor3(color);
  mat.metadata = { roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.1 };
  m.material = mat;
  m.receiveShadows = true;
  m.metadata = { castShadow: true };
  return m;
}
function mkFloorDodeca(radius, color, opts={}){
  // DodecahedronGeometry -> CreatePolyhedron type:2 (dodécaèdre standard
  // Babylon) ; "size" n'est pas strictement le même rayon que Three mais
  // l'effet visuel (petit caillou anguleux) est équivalent.
  const m = BABYLON.MeshBuilder.CreatePolyhedron(_uid('fdodeca'), { type:2, size:radius }, _scene);
  const mat = mkStdMat(_uid('fdodecaMat'), _scene);
  mat.diffuseColor = hexIntToColor3(color);
  mat.metadata = { roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.1 };
  m.material = mat;
  m.receiveShadows = true;
  m.metadata = { castShadow: true };
  return m;
}
function mkFloorCyl(rt, rb, h, segs, color, opts={}){
  // Comme mkCyl mais avec roughness/metalness personnalisables (mkCyl du
  // socle commun fixe roughness=0.8 et n'a pas de metalness) — utilisé
  // pour les flaques (boue/glace) qui ont besoin d'un rendu plus brillant.
  const m = BABYLON.MeshBuilder.CreateCylinder(_uid('fcyl'), { diameterTop:rt*2, diameterBottom:rb*2, height:h, tessellation:segs }, _scene);
  const mat = mkStdMat(_uid('fcylMat'), _scene);
  mat.diffuseColor = hexIntToColor3(color);
  mat.metadata = { roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.1 };
  m.material = mat;
  m.receiveShadows = true;
  m.metadata = { castShadow: true };
  return m;
}

// ---- SOLS ---- dalles de 4×4m posables librement (snap sur la grille)
// pour construire un vrai sol personnalisé plutôt que de dépendre du
// sol par défaut uniforme de la scène — chacune a un motif de surface
// distinct (joints, lattes, caillebotis...) pour rester lisible même
// sans texture externe.
function mkFloorTile(size, color, pattern, tex){
  const g = new BABYLON.TransformNode(_uid('floortile'), _scene);
  // Même précaution que mkBox : cloner avant de régler .repeat, la
  // texture vient du cache partagé (voir cachedTexture) et deux dalles
  // voisines ne doivent jamais se marcher dessus visuellement — géré par
  // mkBox lui-même via opts.map/repeatX/repeatY.
  const base = mkBox(size, 0.15, size, color, tex ? { map:tex, repeatX:2, repeatY:2 } : {});
  base.metadata.castShadow = false;
  base.parent = g;
  // Liseré clair sur le pourtour de CHAQUE dalle (4 fines bandes) — aide
  // à distinguer une dalle de la suivante une fois plusieurs posées côte
  // à côte, quel que soit le motif de surface choisi.
  const edgeColor = shade(color, 1.18);
  [[0,-size/2+0.03,'x'],[0,size/2-0.03,'x'],[-size/2+0.03,0,'z'],[size/2-0.03,0,'z']].forEach(([ex,ez,ax])=>{
    const edge = ax==='x' ? mkBox(size-0.1,0.008,0.06,edgeColor) : mkBox(0.06,0.008,size-0.1,edgeColor);
    edge.position.set(ex,0.154,ez); edge.metadata.castShadow=false;
    edge.parent = g;
  });
  if(pattern==='seams'){
    // Grille de joints de dalle (lignes dans les deux directions X et Z)
    const seamColor = shade(color, 0.78);
    for(let i=1;i<4;i++){
      const lineX = mkBox(size, 0.006, 0.025, seamColor);
      lineX.position.set(0, 0.153, -size/2 + i*(size/4));
      lineX.metadata.castShadow = false;
      lineX.parent = g;
      const lineZ = mkBox(0.025, 0.006, size, seamColor);
      lineZ.position.set(-size/2 + i*(size/4), 0.153, 0);
      lineZ.metadata.castShadow = false;
      lineZ.parent = g;
    }
    // boulons d'ancrage aux 4 coins
    [[-size/2+0.3,-size/2+0.3],[size/2-0.3,-size/2+0.3],[-size/2+0.3,size/2-0.3],[size/2-0.3,size/2-0.3]].forEach(([bx,bz])=>{
      const bolt = mkCyl(0.05,0.05,0.02,0x3a3a3a,8);
      bolt.position.set(bx,0.161,bz); bolt.metadata.castShadow=false;
      bolt.parent = g;
    });
    // fissure fine (usure)
    const crack = mkBox(0.02,0.006,size*0.4, shade(color,0.6));
    crack.position.set(size*0.22,0.153,-size*0.15); crack.rotation.y=0.4; crack.metadata.castShadow=false;
    crack.parent = g;
    // grille d'évacuation d'eau au centre
    const drain = mkCyl(0.22,0.22,0.02,0x1c1e22,16);
    drain.position.set(0,0.161,0); drain.metadata.castShadow=false;
    drain.parent = g;
  }
  if(pattern==='planks'){
    for(let i=1;i<8;i++){
      const seam = mkBox(size, 0.005, 0.03, shade(color,0.75));
      seam.position.set(0, 0.153, -size/2 + i*(size/8));
      seam.metadata.castShadow = false;
      seam.parent = g;
    }
    // légère variation de teinte entre lattes, pour casser l'uniformité
    for(let i=0;i<8;i++){
      if(i%2===0) continue;
      const tint = mkBox(size, 0.152, size/8-0.03, shade(color,0.93));
      tint.position.set(0, 0.076, -size/2 + (i+0.5)*(size/8));
      tint.metadata.castShadow = false;
      tint.parent = g;
    }
    // nœuds de bois (petits ovales sombres)
    [[-0.9,-1],[1.1,0.6],[0.3,1.4]].forEach(([kx,kz])=>{
      const knot = mkCyl(0.06,0.06,0.008,shade(color,0.55),8);
      knot.position.set(kx,0.154,kz); knot.metadata.castShadow=false;
      knot.parent = g;
    });
    // têtes de clous en ligne au centre de chaque latte
    for(let i=0;i<8;i++){
      const nail = mkCyl(0.014,0.014,0.006,0x2a2a2a,6);
      nail.position.set(-size/2+0.3,0.154,-size/2+(i+0.5)*(size/8)); nail.metadata.castShadow=false;
      nail.parent = g;
    }
  }
  if(pattern==='grate'){
    base.material.albedoColor = base.material.albedoColor.scale(0.9); // mkBox pose désormais un PBRMaterial (albedoColor), plus StandardMaterial (diffuseColor)
    for(let i=1;i<10;i++){
      const bar = mkBox(0.04,0.1,size,0x1c1e22);
      bar.position.set(-size/2+i*(size/10), 0.1, 0);
      bar.metadata.castShadow = false;
      bar.parent = g;
    }
    // traverses perpendiculaires (vraie grille de caillebotis)
    for(let i=1;i<5;i++){
      const cross = mkBox(size,0.03,0.05,0x14161a);
      cross.position.set(0,0.155,-size/2+i*(size/5)); cross.metadata.castShadow=false;
      cross.parent = g;
    }
    // boulons de fixation aux 4 coins + reflet métallique bas
    [[-size/2+0.25,-size/2+0.25],[size/2-0.25,size/2-0.25]].forEach(([bx,bz])=>{
      const bolt = mkCyl(0.05,0.05,0.03,0x555b62,8);
      bolt.position.set(bx,0.17,bz); bolt.metadata.castShadow=false;
      bolt.parent = g;
    });
  }
  if(pattern==='tile'){
    for(let i=1;i<4;i++){
      const s1 = mkBox(size,0.005,0.025,0xffffff); s1.position.set(0,0.153,-size/2+i*(size/4)); s1.metadata.castShadow=false; s1.parent = g;
      const s2 = mkBox(0.025,0.005,size,0xffffff); s2.position.set(-size/2+i*(size/4),0.153,0); s2.metadata.castShadow=false; s2.parent = g;
    }
    // carreau ébréché (usure) + grille de sol centrale + léger lustre
    const chip = mkBox(0.3,0.14,0.3, shade(color,0.85));
    chip.position.set(-size*0.25,0.005,size*0.2); chip.metadata.castShadow=false;
    chip.parent = g;
    const drain2 = mkBox(0.3,0.02,0.3,0x8f9499);
    drain2.position.set(0,0.161,0); drain2.metadata.castShadow=false;
    drain2.parent = g;
  }
  if(pattern==='grass'){
    // touffes d'herbe éparses (petits cônes fins), position pseudo-
    // aléatoire mais déterministe pour un rendu stable d'un chargement à l'autre
    let seed = 42;
    const rnd = ()=>{ seed = (seed*9301+49297)%233280; return seed/233280; };
    for(let i=0;i<22;i++){
      const tuft = mkFloorCone(0.05,0.22,5, shade(color,0.7+rnd()*0.5));
      tuft.position.set((rnd()-0.5)*(size-0.3), 0.15+0.09, (rnd()-0.5)*(size-0.3));
      tuft.rotation.y = rnd()*Math.PI;
      tuft.metadata.castShadow = false;
      tuft.parent = g;
    }
    // petites fleurs + galets épars + patch de terre nue
    for(let i=0;i<4;i++){
      const flower = mkFloorSphere(0.035,6,[0xffe08a,0xffffff,0xff9ab8][i%3]);
      flower.position.set((rnd()-0.5)*(size-0.4), 0.2, (rnd()-0.5)*(size-0.4));
      flower.metadata.castShadow = false;
      flower.parent = g;
    }
    for(let i=0;i<5;i++){
      const pebble = mkFloorSphere(0.04+rnd()*0.03,6,0x8a8a82);
      pebble.position.set((rnd()-0.5)*(size-0.3), 0.16, (rnd()-0.5)*(size-0.3));
      pebble.metadata.castShadow = false;
      pebble.parent = g;
    }
    const dirt = mkCyl(0.5,0.5,0.01,0x5a4a35,10);
    dirt.position.set(size*0.2,0.156,-size*0.2); dirt.metadata.castShadow=false;
    dirt.parent = g;
  }
  if(pattern==='ripples'){
    // ondulations de sable : fines bandes légèrement plus sombres, en arc
    for(let i=0;i<4;i++){
      const ripple = mkBox(size*0.75, 0.008, 0.1, shade(color,0.85));
      ripple.position.set(0, 0.153, -size/2 + 0.5 + i*(size/4));
      ripple.rotation.y = 0.15*(i%2===0?1:-1);
      ripple.metadata.castShadow = false;
      ripple.parent = g;
    }
    // coquillages + galets clairs + petit monticule
    let seed2 = 7;
    const rnd2 = ()=>{ seed2 = (seed2*9301+49297)%233280; return seed2/233280; };
    for(let i=0;i<4;i++){
      const shell = mkFloorCone(0.05,0.03,6,0xf0e6d2);
      shell.rotation.x = Math.PI/2;
      shell.position.set((rnd2()-0.5)*(size-0.4), 0.16, (rnd2()-0.5)*(size-0.4));
      shell.metadata.castShadow = false;
      shell.parent = g;
    }
    const mound = mkCyl(0.4,0.6,0.1,shade(color,1.05),10);
    mound.position.set(-size*0.25,0.155,size*0.25); mound.metadata.castShadow=false;
    mound.parent = g;
  }
  if(pattern==='dunes'){
    // sable du désert : rides de vent plus nombreuses et plus
    // resserrées que le sable de plage, pas de coquillages, une
    // dune surélevée et quelques cailloux secs épars
    for(let i=0;i<7;i++){
      const ripple = mkBox(size*0.85, 0.006, 0.07, shade(color,0.82));
      ripple.position.set(0, 0.153, -size/2 + 0.28 + i*(size/7));
      ripple.rotation.y = 0.1*(i%2===0?1:-1);
      ripple.metadata.castShadow = false;
      ripple.parent = g;
    }
    let seedDn = 19;
    const rndDn = ()=>{ seedDn = (seedDn*9301+49297)%233280; return seedDn/233280; };
    for(let i=0;i<5;i++){
      const rock = mkFloorDodeca(0.03+rndDn()*0.02, shade(color,0.45+rndDn()*0.2), {roughness:1});
      rock.position.set((rndDn()-0.5)*(size-0.3), 0.16, (rndDn()-0.5)*(size-0.3));
      rock.rotation.set(rndDn()*Math.PI,rndDn()*Math.PI,0);
      rock.metadata.castShadow = false;
      rock.parent = g;
    }
    const dune = mkCyl(0.55,0.85,0.14,shade(color,1.06),12);
    dune.position.set(size*0.22,0.155,-size*0.2); dune.metadata.castShadow=false;
    dune.parent = g;
  }
  if(pattern==='finesand'){
    // sable fin : quasiment plat, juste une très légère ride et un
    // petit creux, pour rester "propre" sans relief marqué
    const ripple = mkBox(size*0.6, 0.004, 0.05, shade(color,0.92));
    ripple.position.set(0, 0.153, size*0.1); ripple.rotation.y = 0.08; ripple.metadata.castShadow=false;
    ripple.parent = g;
    const dimple = mkCyl(0.3,0.3,0.006,shade(color,0.9),16);
    dimple.position.set(-size*0.2,0.153,-size*0.18); dimple.metadata.castShadow=false;
    dimple.parent = g;
  }
  if(pattern==='rockysand'){
    // sable rocailleux : sable de base + nombreux galets de tailles
    // et tons variés, densité élevée comme une plage de galets
    let seedR = 53;
    const rndR = ()=>{ seedR = (seedR*9301+49297)%233280; return seedR/233280; };
    for(let i=0;i<32;i++){
      const tone = rndR()<0.55
        ? shade(color,0.45+rndR()*0.35)
        : shade(0x9a958a,0.65+rndR()*0.55);
      const pebble = mkFloorSphere(0.03+rndR()*0.06,7,tone,{roughness:0.75});
      pebble.scaling.y = 0.55+rndR()*0.25;
      pebble.position.set((rndR()-0.5)*(size-0.25), 0.158, (rndR()-0.5)*(size-0.25));
      pebble.rotation.y = rndR()*Math.PI;
      pebble.metadata.castShadow = false;
      pebble.parent = g;
    }
  }
  if(pattern==='dirt'){
    // terre battue : petits cailloux épars + touffe d'herbe rare +
    // motte surélevée, déterministe pour un rendu stable
    let seedD = 11;
    const rndD = ()=>{ seedD = (seedD*9301+49297)%233280; return seedD/233280; };
    for(let i=0;i<10;i++){
      const pebble = mkFloorSphere(0.03+rndD()*0.04,6, shade(color,0.4+rndD()*0.3), {roughness:0.95});
      pebble.position.set((rndD()-0.5)*(size-0.3), 0.156, (rndD()-0.5)*(size-0.3));
      pebble.metadata.castShadow = false;
      pebble.parent = g;
    }
    for(let i=0;i<3;i++){
      const tuft = mkFloorCone(0.035,0.14,5,0x6f7f3c);
      tuft.position.set((rndD()-0.5)*(size-0.4), 0.15+0.06, (rndD()-0.5)*(size-0.4));
      tuft.rotation.y = rndD()*Math.PI;
      tuft.metadata.castShadow = false;
      tuft.parent = g;
    }
    const mound2 = mkCyl(0.35,0.45,0.03,shade(color,1.08),10);
    mound2.position.set(size*0.22,0.156,-size*0.22); mound2.metadata.castShadow=false;
    mound2.parent = g;
  }
  if(pattern==='mud'){
    // boue : flaques (disques sombres semi-brillants légèrement en
    // creux) + éclaboussures + planche de traversée rudimentaire
    let seedM = 5;
    const rndM = ()=>{ seedM = (seedM*9301+49297)%233280; return seedM/233280; };
    [[-size*0.2,-size*0.15,0.55],[size*0.28,size*0.1,0.4],[0.05,size*0.3,0.32]].forEach(([px,pz,pr])=>{
      const puddle = mkFloorCyl(pr,pr,0.012,16,0x2c2418,{roughness:0.15,metalness:0.05});
      puddle.position.set(px,0.153,pz); puddle.metadata.castShadow=false; puddle.receiveShadows=true;
      puddle.parent = g;
    });
    for(let i=0;i<14;i++){
      const splat = mkFloorDisc(0.02+rndM()*0.04,6, shade(color,0.4), {roughness:1});
      splat.rotation.x = -Math.PI/2;
      splat.position.set((rndM()-0.5)*(size-0.3), 0.154, (rndM()-0.5)*(size-0.3));
      splat.metadata.castShadow = false;
      splat.parent = g;
    }
    const plank = mkBox(size*0.28,0.04,0.9,0x5a4326);
    plank.position.set(-size*0.32,0,size*0.05); plank.rotation.y = 0.15; plank.metadata.castShadow=false;
    plank.parent = g;
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
        const crack = mkBox(len,0.01,0.02, shade(color,0.3));
        crack.position.set(x+Math.cos(ang)*len/2, 0.152, z+Math.sin(ang)*len/2);
        crack.rotation.y = -ang; crack.metadata.castShadow=false;
        crack.parent = g;
        x += Math.cos(ang)*len; z += Math.sin(ang)*len; ang += (rndC()-0.5)*1.1;
      }
    }
    for(let i=0;i<3;i++){
      const flake = mkBox(0.4+rndC()*0.3,0.02,0.4+rndC()*0.3, shade(color,1.05));
      flake.position.set((rndC()-0.5)*(size-0.6),0.16,(rndC()-0.5)*(size-0.6));
      flake.rotation.y = rndC()*Math.PI; flake.metadata.castShadow=false;
      flake.parent = g;
    }
  }
  if(pattern==='graveldirt'){
    // chemin de terre caillouteux : nombreux petits galets de tons
    // gris/brun mêlés, densité plus élevée qu'un simple sol de terre
    let seedG = 71;
    const rndG = ()=>{ seedG = (seedG*9301+49297)%233280; return seedG/233280; };
    for(let i=0;i<26;i++){
      const tone = rndG()<0.5
        ? shade(color,0.4+rndG()*0.35)
        : shade(0x8a877e,0.7+rndG()*0.5);
      const pebble = mkFloorSphere(0.025+rndG()*0.05,6,tone,{roughness:0.9});
      pebble.position.set((rndG()-0.5)*(size-0.25), 0.157, (rndG()-0.5)*(size-0.25));
      pebble.metadata.castShadow = false;
      pebble.parent = g;
    }
    const rut1 = mkBox(size*0.18,0.01,size*0.85, shade(color,0.55));
    rut1.position.set(-size*0.22,0.153,0); rut1.metadata.castShadow=false;
    rut1.parent = g;
    const rut2 = mkBox(size*0.18,0.01,size*0.85, shade(color,0.55));
    rut2.position.set(size*0.22,0.153,0); rut2.metadata.castShadow=false;
    rut2.parent = g;
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
        const tint = shade(color,0.82+rndP()*0.36);
        const stone = mkBox(cw-0.06+(rndP()-0.5)*0.03, stoneH, ch-0.06+(rndP()-0.5)*0.03, tint, {roughness:0.9});
        stone.position.set(px, 0.15+stoneH/2, pz);
        stone.rotation.y = (rndP()-0.5)*0.05;
        stone.metadata.castShadow = true; stone.receiveShadows = true;
        stone.parent = g;
      }
    }
    for(let i=0;i<4;i++){
      const weed = mkFloorCone(0.025,0.1,5,0x5c7a34);
      weed.position.set((rndP()-0.5)*(size-0.3), 0.15+0.19+0.03, (rndP()-0.5)*(size-0.3));
      weed.rotation.y = rndP()*Math.PI;
      weed.metadata.castShadow = false;
      weed.parent = g;
    }
  }
  if(pattern==='snow'){
    // neige : monticule doux + quelques empreintes de pas (creux peu
    // profonds, en paire alternée façon trace de passage)
    const drift = mkCyl(0.5,0.7,0.08,shade(color,1.03),12);
    drift.position.set(-size*0.22,0.155,size*0.2); drift.metadata.castShadow=false;
    drift.parent = g;
    let seedSn = 41;
    const rndSn = ()=>{ seedSn = (seedSn*9301+49297)%233280; return seedSn/233280; };
    let fx = -size*0.3, fz = -size*0.35, fang = 0.4;
    for(let i=0;i<5;i++){
      const step = mkFloorDisc(0.09,10, shade(color,0.8), {roughness:1});
      step.rotation.x=-Math.PI/2;
      step.position.set(fx + (i%2===0?0.08:-0.08), 0.153, fz);
      step.metadata.castShadow=false;
      step.parent = g;
      fx += Math.cos(fang)*0.32; fz += Math.sin(fang)*0.32+0.2;
    }
    void rndSn;
  }
  if(pattern==='ice'){
    // glace : flaque gelée légèrement bombée et brillante au centre +
    // arête de fracture surélevée (plaque de glace qui a un peu bougé)
    const puddle = mkCyl(0.9,0.9,0.02,shade(color,1.08),16);
    puddle.position.set(0,0.153,0); puddle.metadata.castShadow=false;
    puddle.material.metadata.roughness = 0.08; puddle.material.metadata.metalness = 0.05;
    puddle.parent = g;
    const ridge = mkBox(size*0.7,0.03,0.06, shade(color,1.1));
    ridge.position.set(size*0.05,0.16,-size*0.15); ridge.rotation.y=0.5; ridge.metadata.castShadow=false;
    ridge.parent = g;
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


  /* ============================================================
     NATURE — helpers partagés (rocks/arbres/cristaux/eau/terrain), pour
     garder ~57+ assets nature lisibles sans dupliquer la construction
     géométrie/matériau à chaque fois. C'est le cœur de la demande
     initiale (arbres plus réalistes) : voir buildTreeAsset ci-dessous.
     ============================================================ */
  // Roche : mouchetis minéral (grain granite) + veines/craquelures sombres
  // + quelques taches de lichen clair — au lieu d'un aplat de couleur
  // unique sur chaque facette du polyèdre (même principe que texBark/
  // texLeafy pour les arbres, Phase 4).
  function texRockSurface(baseHex){
    return cachedTexture('rocksurf_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=256;
      const ctx = cv.getContext('2d');
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      // Mouchetis minéral dense (grain granite) : clair/sombre entremêlés
      for(let i=0;i<3200;i++){
        ctx.globalAlpha = 0.12+Math.random()*0.22;
        ctx.fillStyle = Math.random()<0.5 ? '#000' : (Math.random()<0.5?'#fff':base.scale(1.3).toHexString());
        const s=1+Math.random()*2.2;
        ctx.fillRect(Math.random()*256,Math.random()*256,s,s);
      }
      ctx.globalAlpha=1;
      // Grandes zones de teinte (patine, exposition inégale)
      for(let i=0;i<10;i++){
        const patch = hueJitter(base, 0.02, 0.15, 0.16);
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = patch.toHexString();
        const r = 20+Math.random()*35;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.7,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      // Craquelures/veines anguleuses sombres
      for(let i=0;i<6;i++){
        let x=Math.random()*256, y=Math.random()*256, ang=Math.random()*Math.PI*2;
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth=0.8+Math.random()*1.2;
        ctx.beginPath(); ctx.moveTo(x,y);
        for(let s=0;s<6;s++){ ang+=(Math.random()-0.5)*1.3; x+=Math.cos(ang)*18; y+=Math.sin(ang)*18; ctx.lineTo(x,y); }
        ctx.stroke();
      }
      // Taches de lichen clair épars (rochers exposés)
      for(let i=0;i<5;i++){
        ctx.globalAlpha = 0.15+Math.random()*0.15;
        ctx.fillStyle = '#c9c9a0';
        const r = 4+Math.random()*8;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.8,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.14);
      return wrapCanvasTexture('rocksurf_'+baseHex, cv);
    });
  }
  function mkRockMat(color){
    return mkPbrMat(_uid('rockMat'), texRockSurface(color), 0.92);
  }
  function buildRock(baseSize, colorHex){
    const g = new BABYLON.TransformNode(_uid('rockGrp'), _scene);
    const rockMat = mkRockMat(colorHex);
    const rock = BABYLON.MeshBuilder.CreatePolyhedron(_uid('rock'), {type:2, size:baseSize}, _scene); // type 2 = dodécaèdre (12 faces), équiv. THREE.DodecahedronGeometry
    rock.material = rockMat;
    rock.scaling.set(1, 0.7+Math.random()*0.15, 0.85+Math.random()*0.2);
    rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    rock.position.y = baseSize*0.55;
    rock.metadata = {castShadow:true}; rock.receiveShadows = true;
    rock.parent = g;
    // petit rocher compagnon, casse la silhouette trop parfaite d'un seul bloc
    const rock2 = BABYLON.MeshBuilder.CreatePolyhedron(_uid('rock2'), {type:2, size:baseSize*0.45}, _scene);
    rock2.material = rockMat;
    rock2.position.set(baseSize*0.6, baseSize*0.3, baseSize*0.3);
    rock2.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,0);
    rock2.metadata = {castShadow:true};
    rock2.parent = g;
    return g;
  }
  registerAsset({ id:'nat_rock_s', cat:'nature', family:'Roches & minéraux', label:'Rocher (petit)', icon:'🪨', color:0x8a897e, size:[0.9,0.6,0.9],
    build:(c)=> buildRock(0.5, c) });
  registerAsset({ id:'nat_rock_m', cat:'nature', family:'Roches & minéraux', label:'Rocher (moyen)', icon:'🪨', color:0x82806f, size:[1.5,1.0,1.5],
    build:(c)=> buildRock(0.85, c) });
  registerAsset({ id:'nat_rock_l', cat:'nature', family:'Roches & minéraux', label:'Rocher (grand)', icon:'🪨', color:0x76746a, size:[2.4,1.6,2.2],
    build:(c)=>{
      const g = buildRock(1.4, c);
      const mossMat = mkStdMat(_uid('mossMat'), _scene);
      mossMat.diffuseColor = new BABYLON.Color3(0x5c/255,0x7a/255,0x3e/255); mossMat.metadata={roughness:1};
      const moss = BABYLON.MeshBuilder.CreateSphere(_uid('moss'), {diameter:1, segments:8, slice:0.4}, _scene);
      moss.material = mossMat;
      moss.position.set(0.3,1.9,0.2); moss.scaling.set(1.3,0.4,1.1); moss.metadata={castShadow:false};
      moss.parent = g;
      return g;
    }});
  registerAsset({ id:'nat_bush', cat:'nature', family:'Végétation basse', label:'Buisson dense', icon:'🌳', color:0x4f7a3a, size:[1.2,1,1.2],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('bushGrp'), _scene);
      for(let i=0;i<4;i++){
        const lobeMat = mkStdMat(_uid('lobeMat'), _scene);
        lobeMat.diffuseColor = hexIntToColor3(c).scale(0.85+Math.random()*0.3); lobeMat.metadata={roughness:1};
        const lobe = BABYLON.MeshBuilder.CreatePolyhedron(_uid('lobe'), {type:3, size:0.35+Math.random()*0.12}, _scene); // type 3 = icosaèdre
        lobe.material = lobeMat;
        lobe.position.set((Math.random()-0.5)*0.5, 0.35+Math.random()*0.2, (Math.random()-0.5)*0.5);
        lobe.metadata = {castShadow:true};
        lobe.parent = g;
      }
      addSway(g, 0.035, 1.1);
      return g;
    }});
  registerAsset({ id:'nat_fern', cat:'nature', family:'Végétation basse', label:'Fougère haute', icon:'🌿', color:0x3f6b32, size:[0.7,0.5,0.7],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('fernGrp'), _scene);
      const frondMat = mkStdMat(_uid('frondMat'), _scene);
      frondMat.diffuseColor = hexIntToColor3(c); frondMat.metadata={roughness:1};
      for(let i=0;i<6;i++){
        const frond = BABYLON.MeshBuilder.CreateCylinder(_uid('frond'), {diameterTop:0, diameterBottom:0.18, height:0.5, tessellation:4}, _scene);
        frond.material = frondMat;
        const ang = (i/6)*Math.PI*2;
        frond.position.set(Math.sin(ang)*0.1, 0.25, Math.cos(ang)*0.1);
        frond.rotation.z = Math.sin(ang)*0.5; frond.rotation.x = Math.cos(ang)*0.5+0.3;
        frond.metadata = {castShadow:false};
        frond.parent = g;
      }
      addSway(g, 0.05, 1.6);
      return g;
    }});
  registerAsset({ id:'nat_flowers', cat:'nature', family:'Végétation basse', label:'Parterre de fleurs', icon:'🌸', color:0x4f7a3a, size:[1,0.3,1],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('flowersGrp'), _scene);
      const base = mkCyl(0.45,0.5,0.05,c,10); base.position.y=0.02; base.metadata={castShadow:false}; base.parent=g;
      const petalColors = [0xe85d75, 0xf0c020, 0xffffff, 0xb15de0];
      const stemMat = mkStdMat(_uid('stemMat'), _scene);
      stemMat.diffuseColor = hexIntToColor3(0x3f6b32);
      for(let i=0;i<10;i++){
        const stem = BABYLON.MeshBuilder.CreateCylinder(_uid('stem'), {diameterTop:0.02,diameterBottom:0.02,height:0.18,tessellation:4}, _scene);
        stem.material = stemMat;
        const ang = Math.random()*Math.PI*2, dist = Math.random()*0.35;
        stem.position.set(Math.sin(ang)*dist, 0.11, Math.cos(ang)*dist);
        stem.metadata={castShadow:false};
        stem.parent = g;
        const bloomMat = mkStdMat(_uid('bloomMat'), _scene);
        bloomMat.diffuseColor = hexIntToColor3(petalColors[i%petalColors.length]);
        const bloom = BABYLON.MeshBuilder.CreateSphere(_uid('bloom'), {diameter:0.09,segments:6}, _scene);
        bloom.material = bloomMat;
        bloom.position.set(stem.position.x, 0.2, stem.position.z);
        bloom.metadata={castShadow:false};
        bloom.parent = g;
      }
      addSway(g, 0.04, 2.0);
      return g;
    }});
  registerAsset({ id:'nat_mushroom', cat:'nature', family:'Champignons & bois mort', label:'Champignons', icon:'🍄', color:0xc0472b, size:[0.4,0.3,0.4],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('mushroomGrp'), _scene);
      const stemMat = mkStdMat(_uid('mstemMat'), _scene);
      stemMat.diffuseColor = hexIntToColor3(0xe8dcc0);
      const capMat = mkStdMat(_uid('capMat'), _scene);
      capMat.diffuseColor = hexIntToColor3(c); capMat.metadata={roughness:0.8};
      const dotMat = mkStdMat(_uid('dotMat'), _scene);
      dotMat.diffuseColor = hexIntToColor3(0xf0f0f0); dotMat.backFaceCulling=false;
      for(let i=0;i<3;i++){
        const s = 0.6+Math.random()*0.5;
        const stem = BABYLON.MeshBuilder.CreateCylinder(_uid('mstem'), {diameterTop:0.05*s,diameterBottom:0.06*s,height:0.12*s,tessellation:6}, _scene);
        stem.material = stemMat;
        stem.position.set((i-1)*0.1,0.06*s,(i%2)*0.06); stem.metadata={castShadow:false};
        stem.parent = g;
        const cap = BABYLON.MeshBuilder.CreateSphere(_uid('cap'), {diameter:0.12*s,segmentsW:8,segmentsH:6,slice:0.55}, _scene);
        cap.material = capMat;
        cap.position.set(stem.position.x, 0.12*s, stem.position.z); cap.metadata={castShadow:true};
        cap.parent = g;
        for(let d=0;d<4;d++){
          const dot = BABYLON.MeshBuilder.CreateDisc(_uid('dot'), {radius:0.008*s,tessellation:5}, _scene);
          dot.material = dotMat;
          dot.position.set(cap.position.x+(Math.random()-0.5)*0.07*s, cap.position.y+0.045*s, cap.position.z+(Math.random()-0.5)*0.07*s);
          dot.rotation.x = -Math.PI/2.3; dot.metadata={castShadow:false};
          dot.parent = g;
        }
      }
      return g;
    }});
  registerAsset({ id:'nat_deadtree', cat:'nature', family:'Champignons & bois mort', label:'Arbre mort noueux', icon:'🌲', color:0x5c4a3a, size:[1.2,4,1.2],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('deadtreeGrp'), _scene);
      const trunk = mkCyl(0.16,0.24,3.2,c,8); trunk.position.y=1.6; trunk.rotation.z=0.06; trunk.metadata={castShadow:true};
      trunk.parent = g;
      for(let i=0;i<5;i++){
        const len = 0.7+Math.random()*0.6;
        const branch = mkCyl(0.03,0.06,len,c,6);
        const h = 1.6+Math.random()*1.4, ang = Math.random()*Math.PI*2, tilt = 0.6+Math.random()*0.7;
        branch.position.set(Math.sin(ang)*0.15, h, Math.cos(ang)*0.15);
        branch.rotation.z = tilt*(Math.random()<0.5?1:-1);
        branch.rotation.y = ang;
        branch.metadata = {castShadow:true};
        branch.parent = g;
      }
      return g;
    }});
  registerAsset({ id:'nat_log', cat:'nature', family:'Champignons & bois mort', label:'Tronc au sol', icon:'🪵', color:0x6b5330, size:[2.2,0.5,0.6],
    build:(c)=>{
      const g = new BABYLON.TransformNode(_uid('logGrp'), _scene);
      const log = mkCyl(0.28,0.28,2.2,c,10); log.rotation.z=Math.PI/2; log.position.y=0.28; log.metadata={castShadow:true}; log.receiveShadows=true;
      log.parent = g;
      const endCap = mkCyl(0.27,0.27,0.03,0xe8dcc0,10); endCap.rotation.z=Math.PI/2; endCap.position.set(1.1,0.28,0); endCap.metadata={castShadow:false};
      endCap.parent = g;
      const ringMat = mkStdMat(_uid('logRingMat'), _scene);
      ringMat.diffuseColor = hexIntToColor3(0xb08a5a); ringMat.backFaceCulling = false;
      for(let i=0;i<3;i++){
        const ring = BABYLON.MeshBuilder.CreateTorus(_uid('logRing'), {diameter:(0.06*i+0.04)*2, thickness:0.01, tessellation:16}, _scene);
        ring.material = ringMat;
        ring.rotation.y=Math.PI/2; ring.position.set(1.115,0.28,0); ring.metadata={castShadow:false};
        ring.parent = g;
      }
      const mossMat = mkStdMat(_uid('logMossMat'), _scene);
      mossMat.diffuseColor = hexIntToColor3(0x5c7a3e); mossMat.metadata={roughness:1};
      for(let i=0;i<3;i++){
        const moss = BABYLON.MeshBuilder.CreateSphere(_uid('logMoss'), {diameter:0.24,segmentsW:7,segmentsH:5,slice:0.4}, _scene);
        moss.material = mossMat;
        moss.position.set(-0.7+i*0.6, 0.5, 0); moss.scaling.set(1.4,0.4,1.1); moss.metadata={castShadow:false};
        moss.parent = g;
      }
      return g;
    }});

  // ============================================================
  // NATURE ÉTENDUE — arbres, végétation basse, minéraux, eau, terrain.
  // buildTreeAsset() est le cœur de la demande initiale (arbres plus
  // réalistes) : porté avec la MÊME logique de composition (tronc +
  // évasement des racines + frondaison par lobes teintés indépendamment)
  // que la version Three.js, juste avec les primitives Babylon.
  // ============================================================
  // ============================================================
  // RÉALISME DES ARBRES (Phase 4) — écorce et feuillage texturés au lieu
  // d'aplats de couleur, canopée en icosphère subdivisée (plus ronde,
  // moins "gemme low-poly") au lieu du polyèdre à facettes brutes utilisé
  // partout ailleurs (rochers, etc. — volontairement facetés, EUX).
  // ============================================================
  // Écorce : lattes verticales irrégulières (plaques d'écorce) + rainures
  // sombres + quelques nœuds — même famille que texWoodFloor mais en
  // beaucoup plus rugueux/vertical (grain du bois vivant, pas un parquet).
  function texBark(baseHex){
    return cachedTexture('bark_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=128; cv.height=256;
      const ctx = cv.getContext('2d');
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.scale(0.75).toHexString(); ctx.fillRect(0,0,128,256);
      // Lattes verticales d'écorce, largeur irrégulière, légère variation
      // de teinte par latte pour casser l'aplat.
      let x = 0;
      while(x<128){
        const w = 8+Math.random()*10;
        const shade = hueJitter(base, 0.02, 0.1, 0.14);
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(x,0,w-1,256);
        x += w;
      }
      // Rainures verticales sombres (sillons entre les plaques d'écorce),
      // légèrement sinueuses plutôt que parfaitement droites.
      for(let i=0;i<14;i++){
        const gx = Math.random()*128;
        ctx.strokeStyle = 'rgba(0,0,0,'+(0.25+Math.random()*0.25)+')';
        ctx.lineWidth = 1+Math.random()*1.5;
        ctx.beginPath(); let x2=gx;
        ctx.moveTo(x2,0);
        for(let y=16;y<=256;y+=16){ x2 += (Math.random()-0.5)*6; ctx.lineTo(x2,y); }
        ctx.stroke();
      }
      // Nœuds épars (cercles concentriques sombres)
      for(let i=0;i<3;i++){
        const nx=Math.random()*128, ny=Math.random()*256, nr=4+Math.random()*4;
        ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1;
        for(let r=nr;r>0;r-=2){ ctx.beginPath(); ctx.ellipse(nx,ny,r,r*1.3,0,0,Math.PI*2); ctx.stroke(); }
      }
      // Grain fin
      for(let i=0;i<1400;i++){
        ctx.globalAlpha = 0.06+Math.random()*0.08;
        ctx.fillStyle = Math.random()<0.5?'#000':'#fff';
        ctx.fillRect(Math.random()*128,Math.random()*256,1,1+Math.random());
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.12);
      const tex = wrapCanvasTexture('bark_'+baseHex, cv);
      mkRepeatTex(tex, 1, 3);
      return tex;
    });
  }
  // Feuillage : mouchetis de taches vert foncé/clair superposées (grappes
  // de feuilles vues de loin) + quelques trouées sombres (ombre propre
  // entre les groupes de feuilles) — donne une vraie texture à la canopée
  // plutôt qu'un vert plat, sans passer par des cartes de feuilles
  // individuelles (hors-scope pour cette passe).
  function texLeafy(baseHex){
    return cachedTexture('leafy_'+baseHex, ()=>{
      const cv = document.createElement('canvas'); cv.width=cv.height=256;
      const ctx = cv.getContext('2d');
      const base = hexIntToColor3(baseHex);
      ctx.fillStyle = base.toHexString(); ctx.fillRect(0,0,256,256);
      // Grosses touffes (large échelle) — variation de teinte ET de
      // luminosité pour suggérer le volume des grappes de feuillage.
      for(let i=0;i<40;i++){
        const patch = hueJitter(base, 0.04, 0.18, 0.16);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = patch.toHexString();
        const r = 10+Math.random()*20;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*(0.7+Math.random()*0.3),Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      // Trouées sombres entre les grappes (ombre propre)
      for(let i=0;i<18;i++){
        ctx.globalAlpha = 0.18+Math.random()*0.15;
        ctx.fillStyle = base.scale(0.4).toHexString();
        const r = 6+Math.random()*10;
        ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
      // Mouchetis fin (feuilles individuelles suggérées)
      for(let i=0;i<3000;i++){
        const shade = base.scale(0.6+Math.random()*0.7);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = shade.toHexString();
        ctx.fillRect(Math.random()*256,Math.random()*256,1.6,1.6);
      }
      ctx.globalAlpha=1;
      addVignette(ctx,256,0.18);
      return wrapCanvasTexture('leafy_'+baseHex, cv);
    });
  }
  // Segment de tronc/branche texturé écorce (remplace mkCyl pour les
  // arbres spécifiquement — mkCyl reste inchangé, utilisé par ~200 autres
  // assets, pas question d'en changer le rendu partout).
  // PBRMaterial plutôt que StandardMaterial pour l'écorce/le feuillage :
  // seuls matériaux de toute la bibliothèque à en bénéficier pour l'instant
  // (livrable Phase 4 dédié) — réponse physique correcte à l'éclairage
  // (Fresnel, rugosité réelle) au lieu de l'approximation spéculaire de
  // StandardMaterial. Nécessite un environnement (IBL) posé sur la scène
  // consommatrice pour ne pas paraître plus terne que l'ancien
  // StandardMaterial sous éclairage direct seul — voir ensureDefaultEnvironment().
  function mkPbrMat(name, albedoTex, roughness){
    const m = new BABYLON.PBRMaterial(name, _scene);
    m.albedoTexture = albedoTex;
    m.roughness = roughness;
    m.metallic = 0;
    m.metadata = { roughness, metalness: 0 };
    return m;
  }
  function mkBarkSegment(rt, rb, h, color, segs=7){
    const m = BABYLON.MeshBuilder.CreateCylinder(_uid('barkSeg'), {diameterTop:rt*2, diameterBottom:rb*2, height:h, tessellation:segs}, _scene);
    const barkTexSrc = texBark(color);
    const tex = barkTexSrc.clone(); // .clone() ne copie PAS le contenu dessiné (canvas interne vierge) : recopie explicite requise, voir mkBox pour le détail du bug
    tex.getContext().drawImage(barkTexSrc.getContext().canvas, 0, 0);
    tex.update();
    tex.vScale = h/1.4;
    m.material = mkPbrMat(_uid('barkMat'), tex, 0.92); // écorce très mate
    m.receiveShadows = true;
    m.metadata = { castShadow: true };
    m.position.y = h/2;
    return m;
  }
  // Blob de feuillage rond en icosphère SUBDIVISÉE (plus organique que le
  // polyèdre à facettes brutes de buildRock/buildRockAsset, volontairement
  // anguleux EUX) + texture de feuillage au lieu d'un aplat de couleur.
  function mkFoliageBlob(radius, color, subdivisions=2){
    const m = BABYLON.MeshBuilder.CreateIcoSphere(_uid('foliage'), {radius, subdivisions, flat:false}, _scene);
    m.material = mkPbrMat(_uid('foliageMat'), texLeafy(color), 0.8); // feuillage mat mais un peu moins que l'écorce (surface cireuse des feuilles)
    m.metadata = { castShadow: true };
    return m;
  }
  function buildTreeAsset(trunkColor, trunkH, trunkR, canopyType, canopyColor, canopyR){
    const g = new BABYLON.TransformNode(_uid('treeGrp'), _scene);
    if(canopyType!=='bamboo' && canopyType!=='baobab'){
      const trunk = mkBarkSegment(trunkR*0.68, trunkR, trunkH, trunkColor, 7);
      trunk.parent = g;
      // Évasement des racines au pied — un tronc parfaitement cylindrique
      // du sol jusqu'en haut est le signal "primitive procédurale" le plus
      // net, avant même la forme de la frondaison.
      const flare = mkBarkSegment(trunkR, trunkR*1.55, trunkH*0.1, trunkColor, 7);
      flare.metadata={castShadow:false}; flare.parent = g;
    }
    const canopyMat = mkStdMat(_uid('canopyMat'), _scene);
    canopyMat.diffuseColor = hexIntToColor3(canopyColor); canopyMat.metadata={roughness:0.9};
    if(canopyType==='cone'){
      // 4 étages dégressifs plutôt que 2 gros cônes empilés — un vrai
      // conifère a plusieurs couronnes de branches qui se chevauchent.
      const tiers = 4;
      let cy = trunkH + canopyR*0.35;
      for(let i=0;i<tiers;i++){
        const t = i/(tiers-1);
        const rTier = canopyR*(1.05-t*0.55)*(0.92+Math.random()*0.16);
        const hTier = canopyR*(1.05-t*0.3);
        const tier = BABYLON.MeshBuilder.CreateCylinder(_uid('coneTier'), {diameterTop:0, diameterBottom:rTier*2, height:hTier, tessellation:8}, _scene);
        tier.material = mkPbrMat(_uid('tierMat'), texLeafy(canopyColor), 0.8);
        tier.position.set((Math.random()-0.5)*0.06,cy+hTier*0.4,(Math.random()-0.5)*0.06);
        tier.rotation.y = Math.random()*Math.PI; tier.metadata={castShadow:true}; tier.parent = g;
        cy += hTier*0.62;
      }
    } else if(canopyType==='round'){
      // Un seul blob sphérique + 2-3 touffes secondaires décalées, chacune
      // avec sa propre teinte (hueJitter), pour casser la silhouette
      // parfaitement sphérique.
      const cy = trunkH + canopyR*0.75;
      const top = mkFoliageBlob(canopyR, canopyColor);
      top.position.y = cy; top.scaling.y = 0.85; top.parent = g;
      const lobeCount = 2+Math.floor(Math.random()*2);
      for(let i=0;i<lobeCount;i++){
        const lobeR = canopyR*(0.4+Math.random()*0.2);
        const lobe = mkFoliageBlob(lobeR, canopyColor);
        const ang = (i/lobeCount)*Math.PI*2 + Math.random()*0.6;
        lobe.position.set(Math.sin(ang)*canopyR*0.65, cy+(Math.random()-0.5)*canopyR*0.5, Math.cos(ang)*canopyR*0.65);
        lobe.metadata={castShadow:true}; lobe.parent = g;
      }
    } else if(canopyType==='palm'){
      const crown = BABYLON.MeshBuilder.CreateSphere(_uid('crown'), {diameter:0.44,segments:6}, _scene);
      crown.material = canopyMat; crown.position.y = trunkH; crown.parent = g;
      for(let i=0;i<7;i++){
        // Palme en 2 segments (tige droite + pointe qui retombe) plutôt
        // qu'une seule planche rigide.
        const frondGroup = new BABYLON.TransformNode(_uid('frondGrp'), _scene);
        const base = mkBox(0.2,0.035,canopyR*1.3,canopyColor);
        base.position.z = canopyR*0.65; base.parent = frondGroup;
        const tip = mkBox(0.16,0.03,canopyR*0.9,canopyColor);
        tip.position.z = canopyR*1.3; tip.rotation.x = -0.35; tip.parent = frondGroup;
        frondGroup.position.set(0,trunkH+0.05,0);
        frondGroup.rotation.y = i/7*Math.PI*2 + (Math.random()-0.5)*0.15;
        frondGroup.rotation.z = -0.45+(Math.random()-0.5)*0.1;
        frondGroup.parent = g;
      }
      const coconutMat = mkStdMat(_uid('coconutMat'), _scene);
      coconutMat.diffuseColor = hexIntToColor3(0x4a3420); coconutMat.metadata={roughness:0.9};
      for(let i=0;i<3;i++){
        const coconut = BABYLON.MeshBuilder.CreateSphere(_uid('coconut'), {diameter:0.18,segments:7}, _scene);
        coconut.material = coconutMat;
        const ang = Math.random()*Math.PI*2;
        coconut.position.set(Math.sin(ang)*0.18,trunkH-0.1,Math.cos(ang)*0.18); coconut.metadata={castShadow:false};
        coconut.parent = g;
      }
    } else if(canopyType==='weeping'){
      const top = mkFoliageBlob(canopyR, canopyColor);
      top.position.y = trunkH + canopyR*0.5; top.scaling.set(1.35,0.65,1.35); top.parent = g;
      const lobeCount2 = 2+Math.floor(Math.random()*2);
      for(let i=0;i<lobeCount2;i++){
        const lobeR = canopyR*(0.35+Math.random()*0.2);
        const lobe = mkFoliageBlob(lobeR, canopyColor);
        const ang = (i/lobeCount2)*Math.PI*2 + Math.random()*0.6;
        lobe.position.set(Math.sin(ang)*canopyR*0.7, trunkH+canopyR*0.5+(Math.random()-0.5)*canopyR*0.4, Math.cos(ang)*canopyR*0.7);
        lobe.metadata={castShadow:true}; lobe.parent = g;
      }
      for(let i=0;i<16;i++){
        const strand = mkCyl(0.02,0.025, 1.0+Math.random()*0.9, canopyColor, 4);
        const ang = Math.random()*Math.PI*2, dist = canopyR*Math.random()*0.85;
        strand.position.set(Math.cos(ang)*dist, trunkH+canopyR*0.35+(Math.random()-0.5)*0.3, Math.sin(ang)*dist);
        strand.rotation.set((Math.random()-0.5)*0.15,0,(Math.random()-0.5)*0.15);
        strand.metadata={castShadow:false}; strand.parent = g;
      }
    } else if(canopyType==='baobab'){
      // Tronc propre au baobab, bien plus massif que le tronc générique
      // partagé — le tronc démesurément épais EST le trait qui définit
      // un baobab.
      const trunkBaobab = mkBarkSegment(trunkR*2.6, trunkR*3.4, trunkH*0.72, trunkColor, 9);
      trunkBaobab.parent = g;
      const neckBaobab = mkBarkSegment(trunkR*1.1, trunkR*2.4, trunkH*0.28, trunkColor, 8);
      neckBaobab.position.y = trunkH*0.72; neckBaobab.parent = g;
      const top = mkFoliageBlob(canopyR, canopyColor);
      top.position.y = trunkH + canopyR*0.55; top.parent = g;
      for(let i=0;i<3;i++){
        const branch = mkBarkSegment(0.12,0.18,canopyR*0.9,trunkColor,5);
        branch.position.y = trunkH; branch.rotation.z = 0.9+i*0.1; branch.rotation.y = i*2.1;
        branch.parent = g;
      }
    } else if(canopyType==='bamboo'){
      // Cannes épaisses + noeuds annelés (le trait le plus reconnaissable
      // du bambou) + léger dévers organique par canne + feuillage en
      // petites touffes angulaires plutôt qu'un seul cône plein.
      const nodeMat = mkStdMat(_uid('nodeMat'), _scene);
      nodeMat.diffuseColor = hexIntToColor3(trunkColor); nodeMat.metadata={roughness:0.55,metalness:0.05};
      nodeMat.backFaceCulling = false;
      for(let i=0;i<6;i++){
        const h = trunkH*(0.85+Math.random()*0.3);
        const lean = (Math.random()-0.5)*0.1;
        const stalk = mkCyl(0.07,0.09,h,trunkColor,8);
        stalk.position.x = (Math.random()-0.5)*0.7; stalk.position.z = (Math.random()-0.5)*0.7; // garde le y=h/2 posé par mkCyl
        stalk.rotation.z = lean; stalk.rotation.x = (Math.random()-0.5)*0.1;
        stalk.metadata={castShadow:true}; stalk.parent = g;
        const nodeCount = 4+Math.floor(Math.random()*2);
        for(let n=1;n<nodeCount;n++){
          const node = BABYLON.MeshBuilder.CreateTorus(_uid('bambooNode'), {diameter:0.17, thickness:0.024, tessellation:10}, _scene);
          node.material = nodeMat;
          node.rotation.x = Math.PI/2;
          node.position.set(stalk.position.x + Math.sin(lean)*h*(n/nodeCount), (n/nodeCount)*h, stalk.position.z);
          node.metadata={castShadow:false}; node.parent = g;
        }
        for(let leaf=0;leaf<3;leaf++){
          const blade = BABYLON.MeshBuilder.CreateCylinder(_uid('bambooLeaf'), {diameterTop:0, diameterBottom:0.18, height:0.5, tessellation:4}, _scene);
          blade.material = canopyMat;
          const leafAng = Math.random()*Math.PI*2;
          blade.position.set(stalk.position.x+Math.sin(lean)*h, h*(0.78+leaf*0.07), stalk.position.z);
          blade.rotation.z = Math.PI/2.3 * (leaf%2===0?1:-1) + (Math.random()-0.5)*0.3;
          blade.rotation.y = leafAng;
          blade.metadata={castShadow:false}; blade.parent = g;
        }
      }
    }
    // Léger dévers organique sur l'arbre ENTIER — aucun arbre naturel
    // n'est parfaitement vertical.
    g.rotation.z = (Math.random()-0.5)*0.07; g.rotation.x = (Math.random()-0.5)*0.07;
    return g;
  }
  function buildRockAsset(color, radius, jaggedness, count){
    const g = new BABYLON.TransformNode(_uid('rockAssetGrp'), _scene);
    const rockMat = mkRockMat(color);
    for(let i=0;i<(count||1);i++){
      const r = radius*(i===0?1:0.4+Math.random()*0.4);
      const rock = BABYLON.MeshBuilder.CreatePolyhedron(_uid('rockA'), {type:2, size:r}, _scene);
      rock.material = rockMat;
      rock.position.set(i===0?0:(Math.random()-0.5)*radius*1.6, r*0.6, i===0?0:(Math.random()-0.5)*radius*1.6);
      rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      rock.scaling.set(1, 0.75+Math.random()*0.3, 1);
      rock.metadata={castShadow:true}; rock.receiveShadows=true;
      rock.parent = g;
    }
    // Mousse/lichen au pied + galets épars — ancre visuellement la roche
    // dans le sol plutôt qu'un "caillou flottant".
    const mossMat = mkStdMat(_uid('rockMossMat'), _scene);
    mossMat.diffuseColor = hexIntToColor3(0x5c7a3e); mossMat.alpha = 0.5; mossMat.metadata={roughness:1};
    mossMat.backFaceCulling = false;
    const moss = BABYLON.MeshBuilder.CreateDisc(_uid('rockMoss'), {radius:radius*0.7,tessellation:10}, _scene);
    moss.material = mossMat;
    moss.rotation.x=-Math.PI/2; moss.position.set(radius*0.25,0.015,radius*0.15); moss.metadata={castShadow:false};
    moss.parent = g;
    for(let i=0;i<3;i++){
      const pebble = BABYLON.MeshBuilder.CreatePolyhedron(_uid('pebble'), {type:2, size:radius*(0.08+Math.random()*0.08)}, _scene);
      pebble.material = rockMat;
      const ang = Math.random()*Math.PI*2, dist = radius*(0.8+Math.random()*0.5);
      pebble.position.set(Math.sin(ang)*dist, radius*0.07, Math.cos(ang)*dist);
      pebble.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);
      pebble.metadata={castShadow:false};
      pebble.parent = g;
    }
    return g;
  }
  function buildCrystalAsset(color, height){
    const g = new BABYLON.TransformNode(_uid('crystalGrp'), _scene);
    // MeshPhysicalMaterial(transmission) n'a pas d'équivalent StandardMaterial
    // fidèle sans PBR — approximé ici par un alpha élevé + emissive léger
    // (le vrai effet "verre translucide" reviendra avec PBRMaterial en Phase 4).
    const mat = mkStdMat(_uid('crystalMat'), _scene);
    mat.diffuseColor = hexIntToColor3(color);
    mat.alpha = 0.92;
    mat.emissiveColor = hexIntToColor3(color).scale(0.12);
    mat.metadata = {roughness:0.15, metalness:0, transmission:0.55};
    for(let i=0;i<4;i++){
      const h = height*(0.5+Math.random()*0.6);
      const shard = BABYLON.MeshBuilder.CreateCylinder(_uid('shard'), {diameterTop:0, diameterBottom:height*0.32, height:h, tessellation:5}, _scene);
      shard.material = mat;
      shard.position.set((Math.random()-0.5)*height*0.5, h/2, (Math.random()-0.5)*height*0.5);
      shard.rotation.set((Math.random()-0.5)*0.3,Math.random()*Math.PI,(Math.random()-0.5)*0.3);
      shard.metadata={castShadow:true};
      shard.parent = g;
    }
    return g;
  }
  function buildWaterPatch(color, w, d, opts){
    opts = opts||{};
    const mat = mkStdMat(_uid('waterMat'), _scene);
    mat.diffuseColor = hexIntToColor3(color);
    mat.alpha = opts.opacity||0.82;
    mat.metadata = {roughness:0.12, metalness:0.05};
    const mesh = BABYLON.MeshBuilder.CreateDisc(_uid('water'), {radius:1, tessellation:20}, _scene);
    mesh.material = mat;
    mesh.scaling.set(w/2,d/2,1); mesh.rotation.x=-Math.PI/2; mesh.position.y=0.05;
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

  /* ============================================================
     3. VENT — léger balancement des feuillages (utilisé par les assets
     Nature ci-dessus, ex. buildTreeAsset/nat_bush/nat_fern/nat_flowers).
     BABYLON.TransformNode/Mesh n'a pas de .userData comme THREE.Object3D
     — on utilise .metadata, l'équivalent officiel Babylon. updateSway
     doit être appelée depuis la boucle de rendu de l'appelant (voir
     Phase 2/3 : match engine / map_editor.html) pour faire réellement
     bouger les objets enregistrés.
     ============================================================ */
  const swayingObjects = [];
  function addSway(obj, amp=0.06, speed=1.4){
    obj.metadata = obj.metadata || {};
    obj.metadata._swayPhase = Math.random()*Math.PI*2;
    obj.metadata._swayAmp = amp;
    obj.metadata._swaySpeed = speed;
    obj.metadata._swayBaseRotZ = obj.rotation.z;
    swayingObjects.push(obj);
  }
  function updateSway(elapsed){
    for(let i=swayingObjects.length-1;i>=0;i--){
      const o = swayingObjects[i];
      if(!o.parent){ swayingObjects.splice(i,1); continue; } // objet supprimé entretemps
      o.rotation.z = o.metadata._swayBaseRotZ + Math.sin(elapsed*o.metadata._swaySpeed + o.metadata._swayPhase)*o.metadata._swayAmp;
    }
  }

  return {
    init, ensureDefaultEnvironment, ASSETS, ASSET_CATS, ASSET_SUBCATS, BIOME_ASSET_DEFS, addModularPlinth, addSeams, addSway, addVignette, addWeathering, addWindowGrid,
    buildBridgeSpan, buildCrystalAsset, buildGroundPatch, buildRock, buildRockAsset, buildSimpleHouse, buildTower, buildTreeAsset, buildWaterPatch,
    cachedTexture, group, hueJitter, hexIntToColor3, color3ToHexInt, mkBevelBox, mkBox, mkCyl, mkFloorTile, mkRepeatTex,
    mkTextSprite, mkZonePad, registerAsset, swayingObjects,
    texBamboo, texBrick, texChainlink, texConcrete, texCopper, texCorrugated, texCrackedEarthFloor,
    texDesertSandFloor, texDirtFloor, texFineSandFloor, texGlassCurtain, texGranite, texGrassFloor,
    texGravelDirtFloor, texIceFloor, texMarble, texMetalFloor, texMudFloor, texObsidian, texPaveFloor,
    texRockySandFloor, texRuins, texRust, texSandFloor, texSnowFloor, texStoneBlock, texStuc,
    texStylizedPanel, texTemple, texTileFloor, texWoodFloor, updateSway,
  };
})();
