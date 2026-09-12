'use strict';
/* ============================================================================
   Ce fichier consolide, en un seul moteur RÉELLEMENT exécuté et testé, les
   modules envisagés séparément (ai-core / ai-agents / ai-navigation /
   ai-vision / ai-combat / ai-memory / ai-strategy / ai-renderer). Chaque
   section ci-dessous correspond à l'un de ces modules — commentée comme
   telle — pour que la correspondance reste claire, mais le tout tourne
   ensemble dans un seul contexte JS plutôt qu'en fichiers séparés non reliés
   (index.html ne chargeait d'ailleurs aucun des ai-*.js fournis).
   ============================================================================ */

// La carte n'est plus figée dans ce moteur : il est désormais PARTAGÉ par
// toutes les cartes (valorant_ai_match.html = Zenith,
// valorant_ai_match_outpost.html = Outpost, ...). Chaque page hôte définit
// window.MATCH_CONFIG = { mapId, mapLabel, mapData:[...] } AVANT de charger
// ce fichier. `.slice()` : on travaille sur une COPIE du tableau de la
// config, pour que la mutation en place utilisée par l'aperçu Map Editor
// (MAP_DATA.length=0 / MAP_DATA.push(...), juste en dessous) ne modifie
// jamais window.MATCH_CONFIG.mapData lui-même.
const MAP_DATA = window.MATCH_CONFIG.mapData.slice();

// Aperçu direct depuis le Map Editor ("Tester en match", voir
// map_editor.html) : si ?preview=1 est présent, remplace MAP_DATA par la
// carte en cours d'édition (transmise via sessionStorage — même fenêtre/
// onglet ouvert par le bouton, jamais persisté ailleurs) au lieu de la
// carte fournie par window.MATCH_CONFIG ci-dessus. MAP_DATA reste `const` :
// on mute le tableau en place plutôt que de le réassigner.
if(new URLSearchParams(location.search).get('preview')==='1'){
  try{
    const raw = sessionStorage.getItem('mapEditorPreviewData');
    if(raw){ const parsed = JSON.parse(raw); MAP_DATA.length = 0; MAP_DATA.push(...parsed); }
  } catch(e){ /* JSON invalide ou storage indisponible : on garde la carte par défaut */ }
}

/* ============================================================
   MODULE: RENDERER (scène de base) + carte réelle (window.MATCH_CONFIG)
   ============================================================ */
const wrap = document.getElementById('canvasWrap');
const canvas = document.createElement('canvas');
canvas.style.width='100%'; canvas.style.height='100%'; canvas.style.display='block';
wrap.appendChild(canvas);
// adaptToDeviceRatio (4e argument) remplace renderer.setPixelRatio ; la
// taille de rendu suit le canvas via engine.resize() (voir le gestionnaire
// 'resize' plus bas), il n'y a plus de renderer.setSize explicite.
const engine = new BABYLON.Engine(canvas, true, {}, true);
const scene = new BABYLON.Scene(engine);
scene.useRightHandedSystem = true; // même convention que Three.js : positions/rotations de MAP_DATA réutilisables telles quelles
// map_assets_babylon.js construit ses meshes sur une BABYLON.Scene qu'on doit
// lui donner explicitement (l'original Three.js n'avait besoin d'aucune
// scène pour fabriquer une géométrie). À faire AVANT le moindre appel à
// MapAssets.ASSETS[].build(), donc juste après la création de la scène.
window.MapAssets.init(scene);
window.MapAssets.ensureDefaultEnvironment(scene); // IBL requis par les PBRMaterial écorce/feuillage (Phase 4) — sans effet sur le reste (StandardMaterial)
scene.clearColor = BABYLON.Color4.FromHexString('#11141cff');
// PCFShadowMap plutôt que PCFSoftShadowMap : nettement moins de
// texel-lookups par fragment ombré pour un flou à peine différent à la
// distance de caméra de ce jeu, sur une scène qui recalcule sa carte
// d'ombre à chaque frame puisque les agents bougent en continu.
// (Babylon : réglé sur le ShadowGenerator créé plus bas, une fois `sun`
// défini — voir shadowGenerator.usePercentageCloserFiltering.)
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
scene.imageProcessingConfiguration.exposure = 1.08;
const camera = new BABYLON.UniversalCamera('cam', new BABYLON.Vector3(0,10,0), scene);
camera.fov = 45 * Math.PI/180; camera.minZ = 0.5; camera.maxZ = 600;
scene.activeCamera = camera; // position réelle posée juste après par positionCamera()
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0,1,0), scene);
hemi.diffuse = BABYLON.Color3.FromHexString('#cfe0ff'); hemi.groundColor = BABYLON.Color3.FromHexString('#1c2016'); hemi.intensity = 1.05;
const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(0,-1,0), scene);
sun.diffuse = BABYLON.Color3.FromHexString('#fff3d6'); sun.intensity = 1.15;
sun.position.set(60,105,40);
// Un ShadowGenerator remplace renderer.shadowMap.enabled/type + sun.shadow.*.
// 1536 = la taille de carte d'ombre demandée à l'origine (sun.shadow.mapSize).
const shadowGenerator = new BABYLON.ShadowGenerator(1536, sun);
if(engine.webGLVersion >= 2){
  // Contact hardening (PCSS) : la pénombre s'élargit avec la distance à
  // l'objet occultant, comme une vraie ombre portée — plus proche d'Unreal
  // qu'un simple flou PCF uniforme. Remplace usePercentageCloserFiltering
  // (les deux modes de filtrage sont exclusifs l'un de l'autre).
  shadowGenerator.useContactHardeningShadow = true;
  shadowGenerator.contactHardeningLightSizeUVRatio = 0.08;
} else {
  shadowGenerator.usePercentageCloserFiltering = true;
}
shadowGenerator.bias = 0.0012;      // Three utilisait -0.0012 : la convention de signe est inversée entre les deux moteurs
shadowGenerator.normalBias = 0.02;
const fillLight = new BABYLON.DirectionalLight('fill', new BABYLON.Vector3(0.6,-0.7,0.5), scene); fillLight.position.set(-40,50,-30); fillLight.diffuse = BABYLON.Color3.FromHexString('#aecbff'); fillLight.intensity = 0.28;

/* ------------------------------------------------------------
   Pipeline de post-traitement (absent jusqu'ici : seul le tone mapping
   ACES était réglé). Bloom + grading + occlusion ambiante pour se
   rapprocher d'un rendu type Unreal. Pas de profondeur de champ ici : ce
   n'est pas une caméra cinématique mais l'outil tactique du joueur, qui a
   besoin de tout voir net à toute distance de zoom.
   ------------------------------------------------------------ */
const renderPipeline = new BABYLON.DefaultRenderingPipeline('matchPost', true, scene, [camera]);
renderPipeline.fxaaEnabled = true;
renderPipeline.bloomEnabled = true;
renderPipeline.bloomThreshold = 0.8;
renderPipeline.bloomWeight = 0.45;
renderPipeline.bloomKernel = 64;
renderPipeline.bloomScale = 0.5;
renderPipeline.sharpenEnabled = true;
renderPipeline.sharpen.edgeAmount = 0.25;
renderPipeline.imageProcessingEnabled = true;
renderPipeline.imageProcessing.contrast = 1.08;
renderPipeline.imageProcessing.vignetteEnabled = true;
renderPipeline.imageProcessing.vignetteWeight = 1.2;
renderPipeline.imageProcessing.vignetteColor = new BABYLON.Color4(0,0,0,0);

// SSAO2 : occlusion ambiante réelle (contacts assombris sous/entre les
// objets, ce qu'un simple soleil+hémisphérique ne peut pas simuler) —
// nécessite WebGL2 ; dégradation silencieuse sur un contexte WebGL1
// (pas de crash, juste pas d'effet).
if(engine.webGLVersion >= 2){
  const ssao = new BABYLON.SSAO2RenderingPipeline('matchSSAO', scene, { ssaoRatio:0.75, blurRatio:1 }, [camera]);
  ssao.radius = 2.5;
  ssao.totalStrength = 0.9;
  ssao.expensiveBlur = false;
  ssao.samples = 16;
  ssao.maxZ = 120;
}

/* ------------------------------------------------------------
   Passerelles Three.js -> Babylon.js : petites briques que Three
   fournissait en standard et que Babylon n'expose pas sous la même forme
   (couleurs hex, HSL, boîtes englobantes, sprites billboardés). Regroupées
   ici une fois pour toutes plutôt que réécrites à chaque site d'appel.
   ------------------------------------------------------------ */
function hexToColor3(hex){ return BABYLON.Color3.FromHexString('#'+(hex>>>0).toString(16).padStart(6,'0')); }
// Color3.toHexString() de Babylon ne borne PAS les canaux à [0,1] avant
// conversion : après un .scale(f) avec f>1 la chaîne produite est fausse.
// On borne donc systématiquement avant de fabriquer une couleur CSS.
function colorHex(c){
  const q = v=> Math.round(Math.min(1,Math.max(0,v))*255).toString(16).padStart(2,'0');
  return q(c.r)+q(c.g)+q(c.b);
}
// Babylon n'a pas d'équivalent de Color.getHSL/setHSL (toHSV est un autre
// modèle colorimétrique, il changerait le rendu du jitter) — algorithme
// HSL<->RGB standard, identique à celui de Three.
function _colorToHSL(c){ const r=c.r,g=c.g,b=c.b; const max=Math.max(r,g,b),min=Math.min(r,g,b); let h=0,s=0; const l=(max+min)/2; if(max!==min){ const d=max-min; s=l>0.5?d/(2-max-min):d/(max+min); switch(max){ case r: h=(g-b)/d+(g<b?6:0); break; case g: h=(b-r)/d+2; break; case b: h=(r-g)/d+4; break; } h/=6; } return {h,s,l}; }
function _hslToColor3(h,s,l){ h=((h%1)+1)%1; let r,g,b; if(s===0){ r=g=b=l; } else { const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; }; const q=l<0.5?l*(1+s):l+s-l*s; const p=2*l-q; r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3); } return new BABYLON.Color3(r,g,b); }
// PBRMaterial (Phase 4, personnages) : roughness/metalness étaient jusqu'ici
// rangés en simple metadata JAMAIS appliqués au rendu (voir note d'origine
// ci-dessous, conservée) — passe désormais réellement en PBR, comme le
// reste de la scène (murs/sols/arbres/rochers) depuis les livrables
// précédents. mkStdMat ne construit QUE des matériaux d'agents/props ici
// (~10 sites d'appel, pas les ~200 assets de map_assets_babylon.js) : rayon
// d'impact contenu, safe à convertir d'un coup.
function mkStdMat(name, color, opts={}){
  const m = new BABYLON.PBRMaterial(name, scene);
  m.albedoColor = (color && color.r!==undefined) ? color : hexToColor3(color);
  m.alpha = opts.opacity ?? 1;
  m.roughness = opts.roughness ?? 0.8;
  m.metallic = opts.metalness ?? 0;
  m.metadata = { roughness: m.roughness, metalness: m.metallic };
  return m;
}
// MeshBasicMaterial = matériau NON éclairé : dans Babylon cela s'obtient
// avec disableLighting + emissiveColor (et non diffuseColor), sans quoi les
// effets visuels ci-dessous cesseraient de "briller" hors de la lumière.
function mkUnlitMat(name, color, opts={}){
  const m = new BABYLON.StandardMaterial(name, scene);
  m.emissiveColor = (color && color.r!==undefined) ? color : hexToColor3(color);
  m.disableLighting = true;
  m.alpha = opts.opacity ?? 1;
  if(opts.doubleSided) m.backFaceCulling = false;
  if(opts.depthWrite===false) m.disableDepthWrite = true;
  return m;
}
// Babylon n'a pas de Sprite billboardé utilisable comme celui de Three
// (BABYLON.Sprite passe par un SpriteManager, tout autre système) : un
// simple plan en billboard total rend exactement le même service.
function mkSpritePlane(name, w, h, scene){
  const p = BABYLON.MeshBuilder.CreatePlane(name, {width:w, height:h}, scene);
  p.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  return p;
}
// Équivalent minimal du Box3 de Three.js (mêmes noms de méthodes) : Babylon
// n'a pas de classe de boîte englobante avec cette API, et tout le moteur de
// jeu (navigation, occlusion, cadrage caméra) s'appuie dessus.
class Box3 {
  constructor(min, max){
    this.min = min ? {x:min.x,y:min.y,z:min.z} : {x:Infinity,y:Infinity,z:Infinity};
    this.max = max ? {x:max.x,y:max.y,z:max.z} : {x:-Infinity,y:-Infinity,z:-Infinity};
  }
  clone(){ return new Box3(this.min, this.max); }
  union(b){
    this.min.x=Math.min(this.min.x,b.min.x); this.min.y=Math.min(this.min.y,b.min.y); this.min.z=Math.min(this.min.z,b.min.z);
    this.max.x=Math.max(this.max.x,b.max.x); this.max.y=Math.max(this.max.y,b.max.y); this.max.z=Math.max(this.max.z,b.max.z);
    return this;
  }
  expandByPoint(p){
    this.min.x=Math.min(this.min.x,p.x); this.min.y=Math.min(this.min.y,p.y); this.min.z=Math.min(this.min.z,p.z);
    this.max.x=Math.max(this.max.x,p.x); this.max.y=Math.max(this.max.y,p.y); this.max.z=Math.max(this.max.z,p.z);
    return this;
  }
  getCenter(target){ target.x=(this.min.x+this.max.x)/2; target.y=(this.min.y+this.max.y)/2; target.z=(this.min.z+this.max.z)/2; return target; }
  getSize(target){ target.x=this.max.x-this.min.x; target.y=this.max.y-this.min.y; target.z=this.max.z-this.min.z; return target; }
  setFromObject(node){
    this.min = {x:Infinity,y:Infinity,z:Infinity}; this.max = {x:-Infinity,y:-Infinity,z:-Infinity};
    const meshes = node.getChildMeshes ? node.getChildMeshes(false) : [];
    if(node.getBoundingInfo && meshes.indexOf(node)===-1) meshes.push(node); // un Mesh feuille n'est pas son propre enfant
    meshes.forEach(m=>{
      m.computeWorldMatrix(true);
      const bi = m.getBoundingInfo();
      const mn = bi.boundingBox.minimumWorld, mx = bi.boundingBox.maximumWorld;
      this.min.x=Math.min(this.min.x,mn.x); this.min.y=Math.min(this.min.y,mn.y); this.min.z=Math.min(this.min.z,mn.z);
      this.max.x=Math.max(this.max.x,mx.x); this.max.y=Math.max(this.max.y,mx.y); this.max.z=Math.max(this.max.z,mx.z);
    });
    return this;
  }
}

// Petite variation procédurale de teinte/rugosité par instance : évite le
// rendu "plastique uniforme" des mêmes 6-8 couleurs plates répétées partout.
function jitterColor(hex, amt){
  const c = hexToColor3(hex);
  const j = ()=> 1 + (Math.random()*2-1)*amt;
  c.r=Math.min(1,c.r*j()); c.g=Math.min(1,c.g*j()); c.b=Math.min(1,c.b*j());
  return c;
}
function mkBox(w,h,d,color,opts={}){
  const mat = new BABYLON.StandardMaterial('mkBox', scene);
  mat.specularColor = new BABYLON.Color3(0.05,0.05,0.05); // reflet blanc dur par défaut de Babylon, absent de Three.js — corrigé ici (voir map_assets_babylon.js pour le contexte complet du bug)
  mat.diffuseColor = jitterColor(color,0.06);
  mat.alpha = opts.opacity ?? 1;
  mat.metadata = { roughness: opts.roughness ?? (.78+Math.random()*0.14) }; // pas d'équivalent StandardMaterial : conservé pour une passe PBR ultérieure
  if(opts.map){
    // Clone impératif : la texture vient du cache partagé (voir cachedTexture)
    // — sans clone, régler .repeat ici changerait le rendu de TOUS les autres
    // objets qui réutilisent cette même texture (elle vit sur l'objet Texture
    // partagé, pas sur ce matériau).
    const tex = opts.map.clone();
    // .clone() sur une DynamicTexture ne copie pas le contenu déjà dessiné du canvas
    // (le clone démarre avec un canvas interne vierge) — sans ce redraw explicite,
    // la texture clonée est invisible/vide tant qu'on ne la redessine pas ici.
    tex.getContext().drawImage(opts.map.getContext().canvas, 0, 0);
    tex.update();
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = opts.repeatX??1; tex.vScale = opts.repeatY??1;
    mat.diffuseTexture = tex; mat.diffuseColor = new BABYLON.Color3(1,1,1); // laisse la texture porter la couleur
  }
  const m = BABYLON.MeshBuilder.CreateBox('mkBox', {width:w, height:h, depth:d}, scene); m.material = mat;
  m.position.y = h/2; m.castShadow=true; m.receiveShadow=true; return m;
}
function mkCyl(r,h,color){ const mat = new BABYLON.StandardMaterial('mkCyl', scene); mat.specularColor = new BABYLON.Color3(0.05,0.05,0.05); mat.diffuseColor = jitterColor(color,0.06); mat.metadata = { roughness:.75+Math.random()*0.15 }; const m = BABYLON.MeshBuilder.CreateCylinder('mkCyl', {diameterTop:r*2, diameterBottom:r*2, height:h, tessellation:14}, scene); m.material = mat; m.position.y = h/2; m.castShadow=true; m.receiveShadow=true; return m; }
function mkCone(r,h,color){ const mat = new BABYLON.StandardMaterial('mkCone', scene); mat.specularColor = new BABYLON.Color3(0.05,0.05,0.05); mat.diffuseColor = jitterColor(color,0.06); mat.metadata = { roughness:.8 }; const m = BABYLON.MeshBuilder.CreateCylinder('mkCone', {diameterTop:0, diameterBottom:r*2, height:h, tessellation:10}, scene); m.material = mat; m.position.y = h/2; m.castShadow=true; m.receiveShadow=true; return m; }
// Variante à rayons haut/bas indépendants de mkCyl (radius unique) — requise
// pour porter les silhouettes de landmarks de biome (troncs effilés, pics,
// piliers) depuis map_editor.html, qui utilise le mkCyl(rt,rb,h,color,segs)
// de map_assets_babylon.js (signature différente du mkCyl local ci-dessus,
// propre à ce fichier). Nouvelle fonction plutôt que de changer la
// signature de mkCyl : celui-ci a déjà des appelants existants (agents,
// Spike, fumée) qu'il ne faut pas casser.
function mkTaperCyl(rt,rb,h,color,segs=12){
  const mat = new BABYLON.StandardMaterial('mkTaperCyl', scene);
  mat.specularColor = new BABYLON.Color3(0.05,0.05,0.05);
  mat.diffuseColor = jitterColor(color,0.06);
  mat.metadata = { roughness:.78+Math.random()*0.14 };
  const m = BABYLON.MeshBuilder.CreateCylinder('mkTaperCyl', {diameterTop:rt*2, diameterBottom:rb*2, height:h, tessellation:segs}, scene);
  m.material = mat; m.position.y = h/2; m.castShadow=true; m.receiveShadow=true; return m;
}
// La bibliothèque d'assets partagée détaille chaque objet avec des dizaines
// de petites pièces (boulons, coutures, feuilles...) — invisibles dans
// l'ombre projetée à la distance de caméra de ce jeu, mais chacune coûte un
// draw call dans la passe d'ombre. Un vrai relevé en jeu montrait 6989
// mailles projetant une ombre sur 13418 au total pour la seule carte Zenith.
// On ne garde l'ombre portée que pour les pièces assez grandes pour que ça
// se voie ; ne touche jamais la géométrie/position/passe de rendu normale.
const SHADOW_CASTER_MIN_RADIUS = 0.12;
function pruneSmallShadowCasters(root, minRadius=SHADOW_CASTER_MIN_RADIUS){
  (root.getChildMeshes ? root.getChildMeshes(false) : []).forEach(o=>{
    if(!o.castShadow) return;
    const bi = o.getBoundingInfo && o.getBoundingInfo();
    if(!bi) return;
    const bs = bi.boundingSphere;
    if(!bs) return;
    const scale = Math.max(o.scaling.x,o.scaling.y,o.scaling.z);
    if(bs.radius*scale < minRadius) o.castShadow = false;
  });
}

/* ============================================================
   GÉNÉRATEURS DE TEXTURES PROCÉDURALES (canvas -> CanvasTexture) — de
   vraies surfaces texturées (pavé, bois, herbe, bambou, pierre de temple)
   au lieu d'aplats de couleur, avec mise en cache par (type+couleur) pour
   ne générer chaque canvas qu'une seule fois.
   ============================================================ */
const _texCache = {};
function cachedTexture(key, generator){ if(!_texCache[key]) _texCache[key] = generator(); return _texCache[key]; }
function addVignette(ctx, size, strength=0.16){
  const grad = ctx.createRadialGradient(size/2,size/2,size*0.15,size/2,size/2,size*0.72);
  grad.addColorStop(0,'rgba(0,0,0,0)'); grad.addColorStop(1,'rgba(0,0,0,'+strength+')');
  ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
}
function hueJitter(color, hueAmt=0.02, satAmt=0.12, lightAmt=0.16){
  const hsl = _colorToHSL(color);
  const c2 = _hslToColor3((hsl.h+(Math.random()-0.5)*hueAmt+1)%1, Math.max(0,Math.min(1,hsl.s+(Math.random()-0.5)*satAmt)), Math.max(0,Math.min(1,hsl.l+(Math.random()-0.5)*lightAmt)));
  return c2;
}
function texPaveFloor(baseHex){
  return cachedTexture('pavefloor_'+baseHex, ()=>{
    const cv = document.createElement('canvas'); cv.width=cv.height=256;
    const ctx = cv.getContext('2d');
    const base = hexToColor3(baseHex);
    ctx.fillStyle = '#'+colorHex(base.scale(0.45)); ctx.fillRect(0,0,256,256);
    const rows=7, cols=7, cw=256/cols, ch=256/rows, joint=2.6;
    for(let row=-1; row<rows+1; row++){
      const offset = (row%2===0) ? 0 : cw/2;
      for(let col=-1; col<cols+1; col++){
        const jx=(Math.random()-0.5)*3, jy=(Math.random()-0.5)*3;
        const x=col*cw+offset+joint/2+jx, y=row*ch+joint/2+jy;
        const w=cw-joint+(Math.random()-0.5)*3, h=ch-joint+(Math.random()-0.5)*3;
        const stone = hueJitter(base, 0.02, 0.15, 0.22);
        ctx.fillStyle = '#'+colorHex(stone);
        ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(x,y,w,h,2); else ctx.rect(x,y,w,h); ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1.4;
        ctx.beginPath(); ctx.moveTo(x+1,y+h-1); ctx.lineTo(x+1,y+1); ctx.lineTo(x+w-1,y+1); ctx.stroke();
        ctx.strokeStyle='rgba(0,0,0,0.22)'; ctx.lineWidth=1.4;
        ctx.beginPath(); ctx.moveTo(x+w-1,y+1); ctx.lineTo(x+w-1,y+h-1); ctx.lineTo(x+1,y+h-1); ctx.stroke();
        for(let g=0;g<10;g++){ ctx.globalAlpha=0.08+Math.random()*0.1; ctx.fillStyle=Math.random()<0.5?'#000':'#fff'; ctx.fillRect(x+Math.random()*w,y+Math.random()*h,1,1); }
        ctx.globalAlpha=1;
      }
    }
    addVignette(ctx,256,0.16);
    const tex = new BABYLON.DynamicTexture('pavefloor_'+baseHex, cv, scene, true); tex.update(); return tex;
  });
}
function texWoodFloor(baseHex){
  return cachedTexture('woodfloor_'+baseHex, ()=>{
    const cv = document.createElement('canvas'); cv.width=cv.height=256;
    const ctx = cv.getContext('2d');
    const base = hexToColor3(baseHex);
    for(let row=0;row<8;row++){
      const shade = hueJitter(base, 0.015, 0.08, 0.2);
      ctx.fillStyle = '#'+colorHex(shade); ctx.fillRect(0,row*32,256,32);
      ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(0,row*32); ctx.lineTo(256,row*32); ctx.stroke();
      for(let i=0;i<9;i++){
        ctx.strokeStyle='rgba(0,0,0,'+(0.04+Math.random()*0.08)+')'; ctx.lineWidth=0.4+Math.random()*0.8;
        ctx.beginPath(); const y=row*32+2+Math.random()*28;
        ctx.moveTo(0,y); ctx.bezierCurveTo(80,y+(Math.random()-0.5)*8,180,y+(Math.random()-0.5)*8,256,y); ctx.stroke();
      }
      ctx.globalAlpha=0.05; ctx.fillStyle='#fff'; ctx.fillRect(0,row*32+2,256,6); ctx.globalAlpha=1;
      if(Math.random()<0.5){
        const kx=Math.random()*256, ky=row*32+16;
        ctx.fillStyle='rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(kx,ky,4,6,0,0,Math.PI*2); ctx.fill();
      }
    }
    addVignette(ctx,256,0.15);
    const tex = new BABYLON.DynamicTexture('woodfloor_'+baseHex, cv, scene, true); tex.update(); return tex;
  });
}
function texGrassFloor(baseHex){
  return cachedTexture('grassfloor_'+baseHex, ()=>{
    const cv = document.createElement('canvas'); cv.width=cv.height=256;
    const ctx = cv.getContext('2d');
    const base = hexToColor3(baseHex);
    ctx.fillStyle = '#'+colorHex(base); ctx.fillRect(0,0,256,256);
    for(let i=0;i<26;i++){
      const patch = hueJitter(base, 0.03, 0.15, 0.12);
      ctx.globalAlpha=0.18; ctx.fillStyle='#'+colorHex(patch);
      const r=14+Math.random()*22;
      ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,r,r*0.7,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
    for(let i=0;i<4000;i++){
      const shade = base.scale(0.7+Math.random()*0.55);
      ctx.globalAlpha=0.5; ctx.fillStyle='#'+colorHex(shade);
      ctx.fillRect(Math.random()*256,Math.random()*256,1.5,1.5);
    }
    for(let i=0;i<900;i++){
      const shade = base.scale(0.55+Math.random()*0.7);
      ctx.strokeStyle='#'+colorHex(shade); ctx.globalAlpha=0.4+Math.random()*0.3; ctx.lineWidth=0.6;
      const x=Math.random()*256, y=Math.random()*256, len=2+Math.random()*3, ang=Math.random()*Math.PI;
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+Math.cos(ang)*len,y-Math.sin(ang)*len); ctx.stroke();
    }
    ctx.globalAlpha=1;
    addVignette(ctx,256,0.16);
    const tex = new BABYLON.DynamicTexture('grassfloor_'+baseHex, cv, scene, true); tex.update(); return tex;
  });
}
function texBamboo(baseHex){
  return cachedTexture('bamboo_'+baseHex, ()=>{
    const cv = document.createElement('canvas'); cv.width=cv.height=256;
    const ctx = cv.getContext('2d');
    const base = hexToColor3(baseHex);
    ctx.fillStyle = '#'+colorHex(base); ctx.fillRect(0,0,256,256);
    const sw=256/8;
    for(let i=0;i<8;i++){
      const shade = base.scale(0.85+Math.random()*0.3);
      ctx.fillStyle = '#'+colorHex(shade); ctx.fillRect(i*sw+1,0,sw-2,256);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(i*sw+2,0,2,256);
    }
    for(let y=20;y<256;y+=48){ ctx.fillStyle='rgba(60,50,20,0.4)'; ctx.fillRect(0,y,256,4); }
    const tex = new BABYLON.DynamicTexture('bamboo_'+baseHex, cv, scene, true); tex.update(); return tex;
  });
}
function texTemple(baseHex){
  return cachedTexture('temple_'+baseHex, ()=>{
    const cv = document.createElement('canvas'); cv.width=cv.height=256;
    const ctx = cv.getContext('2d');
    const base = hexToColor3(baseHex);
    ctx.fillStyle = '#'+colorHex(base); ctx.fillRect(0,0,256,256);
    for(let y=0;y<256;y+=32){
      ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(256,y); ctx.stroke();
      for(let x=8;x<256;x+=32){ ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.strokeRect(x,y+6,20,20); }
    }
    addVignette(ctx,256,0.14);
    const tex = new BABYLON.DynamicTexture('temple_'+baseHex, cv, scene, true); tex.update(); return tex;
  });
}
// Les trois générateurs suivants (sable / béton / grès) n'existaient que dans
// valorant_ai_match_outpost.html — ils rejoignent la famille ci-dessus
// maintenant que le moteur est partagé entre les cartes.
function texSand(baseHex){
  return cachedTexture('sand_'+baseHex, ()=>{
    const cv = document.createElement('canvas'); cv.width=cv.height=256;
    const ctx = cv.getContext('2d');
    const base = hexToColor3(baseHex);
    ctx.fillStyle = '#'+colorHex(base); ctx.fillRect(0,0,256,256);
    for(let i=0;i<18;i++){
      const dune = hueJitter(base,0.02,0.12,0.14);
      ctx.globalAlpha=0.22; ctx.fillStyle='#'+colorHex(dune);
      const y=Math.random()*256, amp=6+Math.random()*10;
      ctx.beginPath(); ctx.moveTo(0,y);
      for(let x=0;x<=256;x+=16){ ctx.lineTo(x, y+Math.sin(x*0.05+i)*amp); }
      ctx.lineTo(256,256); ctx.lineTo(0,256); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha=1;
    for(let i=0;i<3000;i++){
      const shade = base.scale(0.75+Math.random()*0.5);
      ctx.globalAlpha=0.4; ctx.fillStyle='#'+colorHex(shade);
      ctx.fillRect(Math.random()*256,Math.random()*256,1.4,1.4);
    }
    ctx.globalAlpha=1;
    addVignette(ctx,256,0.16);
    const tex = new BABYLON.DynamicTexture('sand_'+baseHex, cv, scene, true); tex.update(); return tex;
  });
}
function texConcrete(baseHex){
  return cachedTexture('concrete_'+baseHex, ()=>{
    const cv = document.createElement('canvas'); cv.width=cv.height=256;
    const ctx = cv.getContext('2d');
    const base = hexToColor3(baseHex);
    ctx.fillStyle = '#'+colorHex(base); ctx.fillRect(0,0,256,256);
    for(let i=0;i<3500;i++){
      const shade = base.scale(0.7+Math.random()*0.6);
      ctx.globalAlpha=0.35; ctx.fillStyle='#'+colorHex(shade);
      ctx.fillRect(Math.random()*256,Math.random()*256,1.2,1.2);
    }
    ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(0,0,0,0.18)'; ctx.lineWidth=2;
    for(let x=0;x<256;x+=64){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,256); ctx.stroke(); }
    for(let y=0;y<256;y+=64){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(256,y); ctx.stroke(); }
    for(let i=0;i<6;i++){
      ctx.globalAlpha=0.08+Math.random()*0.08; ctx.fillStyle='#000';
      ctx.beginPath(); ctx.ellipse(Math.random()*256,Math.random()*256,10+Math.random()*20,6+Math.random()*10,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
    addVignette(ctx,256,0.15);
    const tex = new BABYLON.DynamicTexture('concrete_'+baseHex, cv, scene, true); tex.update(); return tex;
  });
}
function texSandstone(baseHex){
  return cachedTexture('sandstone_'+baseHex, ()=>{
    const cv = document.createElement('canvas'); cv.width=cv.height=256;
    const ctx = cv.getContext('2d');
    const base = hexToColor3(baseHex);
    ctx.fillStyle = '#'+colorHex(base); ctx.fillRect(0,0,256,256);
    const rows=6, cols=6, cw=256/cols, ch=256/rows;
    for(let row=0;row<rows;row++){
      const offset = (row%2===0) ? 0 : cw/2;
      for(let col=-1; col<cols+1; col++){
        const x=col*cw+offset, y=row*ch;
        const stone = hueJitter(base, 0.015, 0.1, 0.16);
        ctx.fillStyle = '#'+colorHex(stone);
        ctx.fillRect(x+1,y+1,cw-2,ch-2);
      }
    }
    ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.lineWidth=1.4;
    for(let row=0;row<=rows;row++){ ctx.beginPath(); ctx.moveTo(0,row*ch); ctx.lineTo(256,row*ch); ctx.stroke(); }
    addVignette(ctx,256,0.18);
    const tex = new BABYLON.DynamicTexture('sandstone_'+baseHex, cv, scene, true); tex.update(); return tex;
  });
}

// La géométrie détaillée de chaque asset (murs/sols/nature/structures/zones...)
// vient désormais de map_assets.js, PARTAGÉE avec l'éditeur de carte
// (map_editor.html) — remplace l'ancienne resucée SIZE/buildAsset qui ne
// reconstruisait qu'une boîte plate pour la plupart des assets, bien plus
// pauvre que ce que l'éditeur savait déjà générer. Toute carte construite
// dans l'éditeur s'affiche donc ici avec exactement le même niveau de
// détail, sans portage manuel asset par asset.
function buildAsset(o){
  const def = MapAssets.ASSETS.find(a=>a.id===o.assetId);
  if(def && def.build) return def.build(o.color);
  // Filet de sécurité : identifiant totalement inconnu de la bibliothèque
  // partagée (ne devrait pas arriver avec une carte exportée par l'éditeur).
  const g = new BABYLON.TransformNode('asset_fallback', scene);
  const fb = BABYLON.MeshBuilder.CreateBox('asset_fallback_box', {width:1, height:1, depth:1}, scene);
  const fbMat = new BABYLON.StandardMaterial('asset_fallback_mat', scene); fbMat.specularColor = new BABYLON.Color3(0.05,0.05,0.05); fbMat.diffuseColor = hexToColor3(o.color||0x888888); fb.material = fbMat;
  fb.parent = g;
  return g;
}
const rootGroup = new BABYLON.TransformNode('rootGroup', scene);
const zones = {};
const floorNodes = [];
const occluderBoxes = [];
const navBlockBoxes = []; // sous-ensemble d'occluderBoxes qui bloque le PASSAGE (les portes bloquent la vue mais pas la marche, faute de mécanique d'ouverture/fermeture)
// Utilitaires actifs (voir MODULE: UTILITAIRES plus bas) — fumées qui
// bloquent la vue comme un mur, pièges Sentinel qui ralentissent l'ennemi.
// Vidés à chaque nouveau round (voir startRound).
let activeSmokes = []; // {center:{x,z}, radius, expiresAt, mesh}
let activeTraps = [];  // {center:{x,z}, radius, ownerTeam, slow, mesh}
let activeDamageZones = []; // {center:{x,z}, radius, dps, ownerTeam, caster, expiresAt, mesh}
const BLOCKING_PREFIXES = ['wall_','bld_','cover_'];
// Union des listes des deux cartes d'origine (Zenith + Outpost) depuis que
// ce moteur est partagé : un identifiant absent du MAP_DATA de la carte
// chargée ne se déclenche simplement jamais, un sur-ensemble est donc sûr.
// (Outpost seul apportait nat_baobab / nat_cactus_giant / prop_statue_giant.)
const BLOCKING_EXACT = new Set(['prop_crate','prop_barrel','prop_statue','nat_bamboo','nat_cherry','tac_door','nat_baobab','nat_cactus_giant','prop_statue_giant']);
const NAV_PASSABLE_EXACT = new Set(['tac_door']);
function isBlockingAsset(id){ return BLOCKING_PREFIXES.some(p=>id.startsWith(p)) || BLOCKING_EXACT.has(id); }
// Empreinte au sol d'un objet : ne garde que les parties de mesh qui
// touchent (quasi) le sol — un arbre dont la cime est à 2.5m de haut ne
// doit pas bloquer le passage sous son feuillage, seul son tronc compte.
function groundFootprint(obj){
  const box = new Box3(); let any=false;
  (obj.getChildMeshes ? obj.getChildMeshes(false) : []).forEach(child=>{
    child.computeWorldMatrix(true);
    const bb = child.getBoundingInfo().boundingBox;
    const b = new Box3(bb.minimumWorld, bb.maximumWorld);
    if(b.min.y <= 0.55){ box.union(b); any=true; }
  });
  return any ? box : new Box3().setFromObject(obj);
}
const bbox = new Box3();
// 'mixed' = comportement d'avant cette fonctionnalité (aucun marqueur de
// biome trouvé dans MAP_DATA — cartes plus anciennes ou biome "Mixte").
let mapBiome = 'mixed';
MAP_DATA.forEach(o=>{
  // Marqueur de biome posé par le Map Editor (voir applyBiome(), map_editor.html) :
  // ne construit rien de visible (juste un Group vide côté buildAsset),
  // sert uniquement à faire voyager le choix de biome jusqu'ici — capturé
  // une fois pour colorer le sol et peupler le décor autour de la carte
  // (voir makeGroundTexture/scatterBiomeDecoration plus bas), sans quoi
  // le sol restait toujours identique (vert générique) quel que soit le
  // biome choisi dans l'éditeur — signalé par un joueur.
  if(o.assetId.startsWith('biome_')){ mapBiome = o.assetId.slice(6); return; }
  const obj = buildAsset(o);
  obj.position.set(o.pos[0], o.pos[1], o.pos[2]);
  obj.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
  obj.scaling.set(o.scl[0], o.scl[1], o.scl[2]);
  obj.parent = rootGroup;
  pruneSmallShadowCasters(obj);
  if(o.assetId.startsWith('zone_')) zones[o.assetId] = { x:o.pos[0], z:o.pos[2] };
  if(o.assetId.startsWith('floor_')){
    floorNodes.push({ x:o.pos[0], z:o.pos[2] });
    // Une tuile de sol posée à plat ne projette jamais une ombre qu'on
    // puisse voir (rien en dessous, quasi coplanaire avec ses voisines) —
    // sur la carte Zenith, les tuiles de sol représentent à elles seules
    // 10271 des 13418 mailles de la scène et 5511 des 6989 projetant une
    // ombre : de très loin le plus gros contributeur à la passe d'ombre,
    // recalculée entièrement à chaque frame tant qu'un agent bouge.
    (obj.getChildMeshes ? obj.getChildMeshes(false) : []).forEach(c=>{ c.castShadow=false; });
  }
  if(isBlockingAsset(o.assetId)){
    obj.computeWorldMatrix(true);
    occluderBoxes.push(new Box3().setFromObject(obj));
    if(!NAV_PASSABLE_EXACT.has(o.assetId)) navBlockBoxes.push(groundFootprint(obj));
  }
  bbox.expandByPoint({x:o.pos[0], y:0, z:o.pos[2]});
});
const mapCenter = bbox.getCenter({x:0,y:0,z:0});
const mapSize = bbox.getSize({x:0,y:0,z:0});
const mapRadius = Math.max(mapSize.x, mapSize.z)*0.62 + 12;

// Soleil + brouillard de distance calés sur la taille réelle de la carte
// (ombres portées nettes sur toute son emprise, estompage en profondeur
// plutôt qu'un horizon qui coupe brutalement).
sun.setDirectionToTarget(new BABYLON.Vector3(mapCenter.x, 0, mapCenter.z));
sun.autoUpdateExtends = false; // sinon Babylon recalcule le frustum d'ombre tout seul et écrase les bornes ci-dessous
sun.orthoLeft = -mapRadius*1.3; sun.orthoRight = mapRadius*1.3;
sun.orthoTop = mapRadius*1.3; sun.orthoBottom = -mapRadius*1.3;
sun.shadowMinZ = 20; sun.shadowMaxZ = 260;
scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR; scene.fogColor = hexToColor3(0xaab8c9); scene.fogStart = mapRadius*1.5; scene.fogEnd = mapRadius*3.4;

// Ciel : le clearColor plat d'origine (#11141c, marine sombre) donnait un
// horizon noir "vide" sous un soleil pourtant réel et fixe (cf. ci-dessus) —
// incohérent avec des cartes en plein jour. Dôme de ciel physique accroché
// à la vraie direction de la lumière (le halo solaire tombe donc au bon
// endroit) ; fogColor repris ci-dessus en gris-bleu d'horizon plutôt que
// la couleur marine arbitraire, pour que le brouillard de distance se
// fonde dans le ciel au lieu de creuser un puits noir à l'horizon.
// Diamètre calé sur camera.maxZ (600), PAS sur mapRadius : `infiniteDistance`
// recentre déjà le dôme sur la caméra à chaque frame, donc sa taille
// absolue n'a pas besoin de suivre la carte — et un dôme plus grand que le
// plan de coupe lointain de la caméra serait purement et simplement
// clippé (invisible, juste le clearColor brut derrière).
const skyDome = BABYLON.MeshBuilder.CreateSphere('skyDome', { diameter: camera.maxZ*1.8, segments:16, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
skyDome.infiniteDistance = true; // reste centré sur la caméra, jamais "dépassé" au zoom arrière ou en pan
skyDome.isPickable = false;
skyDome.doNotSyncBoundingInfo = true;
skyDome.applyFog = false; // le dôme (rayon réel ~540) dépasse largement fogEnd : sans ceci le brouillard linéaire le noierait en un disque plat
const skyMat = new BABYLON.SkyMaterial('skyMat', scene);
skyMat.backFaceCulling = false; // le dôme est vu DE L'INTÉRIEUR (sideOrientation BACKSIDE) : sans ceci le culling standard élimine toute sa surface, rendu invisible
// Valeurs proches des réglages par défaut officiels de SkyMaterial (démos
// Babylon) : un turbidity/rayleigh trop bas rendait le ciel très sombre et
// terne (vérifié par lecture directe des pixels du canvas, le rendu
// composité restant trop peu lumineux pour être lisible sur une capture).
skyMat.luminance = 1.0;
skyMat.turbidity = 10;
skyMat.rayleigh = 2.5;
skyMat.mieCoefficient = 0.005;
skyMat.mieDirectionalG = 0.8;
skyMat.useSunPosition = true;
// SkyMaterial attend une POSITION de soleil (pas une direction) : on
// l'extrapole loin dans le sens opposé à sun.direction (la lumière voyage
// le long de `direction`, donc la source est à l'opposé).
skyMat.sunPosition = sun.direction.scale(-1).normalize().scale(150);
skyDome.material = skyMat;

// Texture procédurale (grain + variation de teinte) sur le sol : casse
// l'aplat de couleur uniforme d'un simple PlaneGeometry coloré.
// Couleur de base du sol selon le biome choisi dans le Map Editor (voir
// mapBiome, capturé depuis le marqueur biome_* dans MAP_DATA plus haut) —
// mêmes teintes que map_editor.html (BIOME_GROUND_COLOR/BIOME_COLOR) pour
// que ce qu'on voit en jeu corresponde à ce qui était prévisualisé.
// Auparavant fixe (#2f4a26, un vert générique) quel que soit le biome
// choisi — le sol ne changeait donc jamais visuellement à l'export.
const MATCH_BIOME_GROUND_COLOR = {
  mixed:'#3a4a2e', tropical:'#1f6b3a', desert:'#dba653', savanna:'#b9a052',
  tundra:'#c7d1cc', taiga:'#2e4d38', mountain:'#8a8578', swamp:'#4a5a3a',
  canyon:'#a8623f', prairie:'#5fa347', city:'#6b6e73', temperate:'#3f6b32',
};
// Auparavant : un simple remplissage de couleur + 2400 points de bruit
// d'alpha aléatoire — un aplat quasi uniforme vu la distance de caméra de
// ce jeu. Remplacé par les VRAIES textures procédurales de sol déjà
// utilisées pour les dalles de la bibliothèque d'assets (touffes d'herbe,
// rides de sable, boue, terre craquelée...) — même qualité que ce qui est
// déjà posé au sol dans les zones bâties, pour que le terrain environnant
// n'ait plus l'air plat et générique en comparaison.
const MATCH_BIOME_TEX_FN = {
  mixed:'texGrassFloor', tropical:'texGrassFloor', desert:'texDesertSandFloor',
  savanna:'texDirtFloor', tundra:'texSnowFloor', taiga:'texGrassFloor',
  mountain:'texGravelDirtFloor', swamp:'texMudFloor', canyon:'texCrackedEarthFloor',
  prairie:'texGrassFloor', city:'texConcrete', temperate:'texGrassFloor',
};
function makeGroundTexture(){
  const hexStr = MATCH_BIOME_GROUND_COLOR[mapBiome] || MATCH_BIOME_GROUND_COLOR.mixed;
  const hexInt = parseInt(hexStr.slice(1), 16);
  const fnName = MATCH_BIOME_TEX_FN[mapBiome] || 'texGrassFloor';
  const srcTex = MapAssets[fnName](hexInt);
  // srcTex vient du cache partagé de MapAssets (mêmes textures que les
  // dalles de sol) : cloner avant de régler uScale/vScale, sinon on
  // changerait le rendu de toutes les dalles qui réutilisent cette même
  // texture ailleurs sur la carte. Et .clone() sur une DynamicTexture ne
  // copie PAS le contenu déjà dessiné (canvas interne vierge) — recopie
  // explicite requise avant .update(), voir map_assets_babylon.js/mkBox
  // pour le détail complet de ce bug.
  const tex = srcTex.clone();
  tex.getContext().drawImage(srcTex.getContext().canvas, 0, 0);
  tex.update();
  tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  tex.uScale = tex.vScale = mapRadius*0.55;
  return tex;
}
const groundSize = Math.max(mapSize.x, mapSize.z)*2.6 + 100;
// PBRMaterial (Phase 4) plutôt que StandardMaterial : cohérent avec le
// reste du terrain (murs/sols bâtis déjà en PBR depuis le livrable 3), et
// la rugosité devient réellement appliquée au rendu au lieu d'un simple
// metadata inerte.
const groundMat = new BABYLON.PBRMaterial('groundMat', scene);
groundMat.albedoTexture = makeGroundTexture();
groundMat.roughness = 0.95; groundMat.metallic = 0;
groundMat.metadata = { roughness:0.95, metalness:0 };
// CreateGround est déjà horizontal (contrairement à CreatePlane) : le
// ground.rotation.x = -Math.PI/2 d'origine n'a plus lieu d'être.
// `subdivisions` : sans ça le sol reste un simple quad (2 triangles), pas
// assez de sommets pour porter le relief ci-dessous. 48 plutôt que 100 (une
// première passe trop détaillée a fait chuter le framerate) : suffisant
// pour un relief lu à distance dans un anneau purement décoratif, jamais
// inspecté de près.
const ground = BABYLON.MeshBuilder.CreateGround('ground', {width:groundSize, height:groundSize, subdivisions:48}, scene); ground.material = groundMat;
ground.position.set(mapCenter.x,-0.08,mapCenter.z); ground.receiveShadows=true;

// ---- Relief du décor environnant par biome (identité visuelle AAA,
// "le relief représente 70% de l'identité d'un biome") ----------------
// Porté de map_editor.html (biomeRawHeight/bioFbm), SIMPLIFIÉ : ce moteur
// n'a qu'un seul biome fixe par carte (mapBiome), jamais un mélange
// angulaire multi-biomes — pas besoin de biomeWeights() ici.
// RISQUE CRITIQUE maîtrisé : le relief ne doit JAMAIS toucher la zone
// jouable (rayon < mapRadius), sous peine de fausser la ligne de vue et le
// pathfinding (calculés à plat, voir Box3/groundFootprint plus haut) — le
// relief n'agit qu'au-delà de mapRadius, avec une rampe douce
// (TERRAIN_BLEND) plutôt qu'une marche brutale à la frontière.
const bioSeed = 17.0 + Math.random()*900;
function bioHash(x,y){
  const n = Math.sin(x*127.1 + y*311.7 + bioSeed)*43758.5453123;
  return n - Math.floor(n);
}
function bioValueNoise(x,y){
  const xi=Math.floor(x), yi=Math.floor(y);
  const xf=x-xi, yf=y-yi;
  const u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf);
  const a=bioHash(xi,yi), b=bioHash(xi+1,yi), c=bioHash(xi,yi+1), d=bioHash(xi+1,yi+1);
  return a + (b-a)*u + (c-a)*v + (a-b-c+d)*u*v;
}
function bioFbm(x,y,octaves){
  let amp=0.5, freq=1, sum=0, norm=0;
  for(let i=0;i<octaves;i++){
    sum += amp*bioValueNoise(x*freq, y*freq);
    norm += amp;
    amp *= 0.5; freq *= 2.05;
  }
  return sum/norm; // ~0..1
}
function biomeRawHeight(name, x, z, r){
  switch(name){
    case 'mountain': {
      const ridge = 1 - Math.abs(bioFbm(x*0.02, z*0.02, 4)*2-1);
      let h = ridge*ridge*38 + bioFbm(x*0.055, z*0.055, 3)*7;
      h *= 0.4 + 0.6*Math.max(0, Math.min(1, r/(mapRadius*1.95)));
      return h;
    }
    case 'canyon': {
      const n = bioFbm(x*0.022, z*0.022, 4);
      const trench = Math.abs(n-0.5)*2;
      return -9 + trench*20 + bioFbm(x*0.09,z*0.09,3)*3;
    }
    case 'desert': {
      const wave = Math.sin(x*0.045 + bioFbm(x*0.018,z*0.018,3)*5)*0.5+0.5;
      return wave*7.5 + bioFbm(x*0.08,z*0.08,3)*1.8;
    }
    case 'tropical':
      return bioFbm(x*0.022, z*0.022, 4)*6 - 0.4;
    case 'temperate':
      return bioFbm(x*0.02, z*0.02, 4)*4.2 - 0.6;
    case 'taiga':
      return bioFbm(x*0.02, z*0.02, 4)*5 - 0.5;
    case 'savanna':
      return bioFbm(x*0.016, z*0.016, 3)*2.4 - 0.2;
    case 'tundra':
      return bioFbm(x*0.03, z*0.03, 3)*1.1 - 0.1;
    case 'swamp':
      return bioFbm(x*0.025, z*0.025, 3)*1.2 - 1.4;
    case 'city':
      return bioFbm(x*0.02, z*0.02, 2)*0.4;
    case 'prairie':
      return bioFbm(x*0.022, z*0.022, 3)*1.3 - 0.2;
    default: // 'mixed' : aucune identité de relief propre, quasi plat
      return bioFbm(x*0.02, z*0.02, 3)*0.8 - 0.1;
  }
}
const TERRAIN_BLEND = 26; // rampe douce sur ~26 unités au-delà de mapRadius avant relief plein — évite une marche brutale
function matchTerrainHeight(x,z){
  const dx = x-mapCenter.x, dz = z-mapCenter.z;
  const r = Math.sqrt(dx*dx+dz*dz);
  if(r<=mapRadius) return 0; // zone jouable : jamais de relief, ligne de vue/pathfinding intacts
  const blend = Math.min(1, (r-mapRadius)/TERRAIN_BLEND);
  return biomeRawHeight(mapBiome, x, z, r)*blend;
}
// Déplace les sommets du sol au-delà de mapRadius selon le relief ci-dessus
// (la zone jouable, rayon <= mapRadius, reste à y=0 — jamais touchée).
(function applyGroundRelief(){
  const pos = ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  for(let i=0;i<pos.length;i+=3){
    const wx = mapCenter.x+pos[i], wz = mapCenter.z+pos[i+2];
    pos[i+1] = matchTerrainHeight(wx, wz);
  }
  ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
  const normals = [];
  BABYLON.VertexData.ComputeNormals(pos, ground.getIndices(), normals);
  ground.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
})();
// Décor cohérent avec le biome choisi, éparpillé au-delà de la zone
// jouable (jamais dans le pathfinding/la navigation) — sans ça, le sol
// changeait bien de couleur avec le biome mais restait un plan totalement
// nu, "vide" (signalé). Puise dans la bibliothèque d'assets déjà partagée
// (MapAssets.ASSETS) plutôt que d'inventer de nouvelles géométries.
// Volontairement modeste en nombre : voir l'optimisation FPS plus haut
// dans ce fichier — le sol de la carte représente déjà l'essentiel des
// mailles de la scène, pas la peine d'en rajouter des centaines de plus.
// Pools resserrés (Phase 5, identité AAA par biome — "moins de 30%
// d'éléments visuels partagés entre deux biomes"). Avant : nat_bush/
// nat_deadtree/nat_log/nat_fern/nat_mushroom réutilisés génériquement dans
// 5 à 7 biomes sur 12, rendant plusieurs biomes quasi indiscernables sans
// regarder la seule couleur du sol. Chaque pool ci-dessous vient d'une
// famille d'assets déjà largement exclusive au catalogue (Cactus pour
// désert, cristaux pour ville, glace pour toundra, arbres nommés pour
// temperate...) — recombinaison de l'existant, aucun nouvel asset requis.
// Recouvrement max vérifié entre deux biomes voisins : 1 élément sur 4
// (25%), jamais plus (ex. mountain/canyon partagent seulement nat_cliff).
const MATCH_BIOME_SCATTER = {
  mixed:     ['nat_oak','nat_bush','nat_tallgrass'],
  tropical:  ['nat_palm','nat_liana','nat_vine','nat_flowerbush'],
  desert:    ['nat_cactus','nat_cactus_giant','nat_agave','nat_dune2'],
  savanna:   ['nat_baobab','nat_acacia','nat_drybush','nat_rock2'],
  tundra:    ['nat_iceblock','nat_icefloe','nat_glacier','nat_snowpile'],
  taiga:     ['nat_fir','nat_pine','nat_deadtree','nat_stump'],
  mountain:  ['nat_spire','nat_cliff','nat_bigrock','nat_rock_l'],
  swamp:     ['nat_mangrove','nat_algae','nat_bramble','nat_log'],
  canyon:    ['nat_crater','nat_cliff','nat_rock_m','nat_rock_s'],
  prairie:   ['nat_prairie2','nat_sunflower','nat_flower_red','nat_flower_yellow','nat_tallgrass'],
  city:      ['nat_crystal_blue','nat_crystal_green','nat_crystal_red','nat_rock_m'],
  temperate: ['nat_cherry','nat_maple','nat_birch','nat_bamboo'],
};
// ---- Landmarks de biome : 1 repère majeur, visible de loin, par biome
// (identité AAA — "silhouette exclusive" reconnaissable à 500m). Porté des
// closures build() de map_editor.html (placeLandmark, un par biome) — même
// géométrie, adaptée à l'idiome de CE fichier : pas de shim `.add()` façon
// Three.js ici (`child.parent = g` directement), et `addBiomeObj(obj)`
// devient `obj.parent = rootGroup` + `pruneSmallShadowCasters(obj)` (déjà
// utilisée par le scatter ci-dessous). `mkCyl` local à ce fichier n'a
// qu'un seul rayon (contrairement à celui de map_assets_babylon.js utilisé
// par l'éditeur) : les silhouettes effilées (troncs, pics, piliers)
// utilisent donc `mkTaperCyl` (voir plus haut) plutôt que `mkCyl`.
// Portée volontairement limitée au SEUL repère majeur par biome (règle 03) :
// les 3 repères secondaires + 10 points mineurs par biome (grottes,
// fossiles, passages secrets...) restent un chantier de contenu séparé,
// pour un livrable ultérieur — pas de landmark pour 'city' non plus,
// fidèle à la source (city n'a que scatterBuildings côté éditeur).
const BIOME_LANDMARK_BUILDERS = {
  temperate: (x,z,y)=>{
    const deadtreeAsset = MapAssets.ASSETS.find(a=>a.id==='nat_deadtree');
    if(!deadtreeAsset) return;
    const obj = deadtreeAsset.build(deadtreeAsset.color);
    obj.position.set(x,y,z);
    obj.scaling.set(3.2,3.6,3.2);
    obj.rotation.y = Math.random()*Math.PI*2;
    obj.parent = rootGroup; pruneSmallShadowCasters(obj);
  },
  desert: (x,z,y)=>{
    const g = new BABYLON.TransformNode('landmarkDesert', scene);
    const stone = 0xc98f52;
    const pillarH = 9+Math.random()*2, gap = 5+Math.random()*1.5;
    [-1,1].forEach(side=>{
      const p = mkBox(2.2, pillarH, 2.4, stone, { roughness:0.9 });
      p.position.x = side*(gap/2+1.1);
      p.parent = g;
    });
    const lintel = mkBox(gap+4.6, 2.4, 2.6, stone, { roughness:0.9 });
    lintel.position.y = pillarH+1.2;
    lintel.parent = g;
    g.position.set(x,y,z); g.rotation.y = Math.random()*Math.PI*2;
    g.parent = rootGroup; pruneSmallShadowCasters(g);
  },
  savanna: (x,z,y)=>{
    const g = new BABYLON.TransformNode('landmarkSavanna', scene);
    const trunkH = 7+Math.random()*2, trunkR = 2.4+Math.random()*0.6;
    const trunk = mkTaperCyl(trunkR*0.75, trunkR, trunkH, 0x7a6a4a, 9);
    trunk.parent = g;
    const canopy = BABYLON.MeshBuilder.CreatePolyhedron('baobabCanopy', {type:3, size:trunkR*2.1}, scene);
    canopy.scaling.set(1,0.42,1);
    const canopyMat = new BABYLON.PBRMaterial('baobabCanopyMat', scene);
    canopyMat.albedoColor = hexToColor3(0x6a7a3a); canopyMat.roughness = 0.95; canopyMat.metadata = {roughness:0.95,metalness:0};
    canopy.material = canopyMat;
    canopy.position.y = trunkH*0.98;
    canopy.parent = g;
    g.position.set(x,y,z); g.rotation.y = Math.random()*Math.PI*2;
    g.parent = rootGroup; pruneSmallShadowCasters(g);
  },
  tundra: (x,z,y)=>{
    const g = new BABYLON.TransformNode('landmarkTundra', scene);
    const spireH = 10+Math.random()*3;
    const spire = mkTaperCyl(0.3, 2.4+Math.random()*0.6, spireH, 0xcfe8f0, 7);
    spire.parent = g;
    const rib = mkTaperCyl(0.12,0.16, 2.6, 0xe8e2d0, 6);
    rib.rotation.z = Math.PI/2;
    rib.position.set(1.6, 0.3, 0.4);
    rib.parent = g;
    g.position.set(x,y,z); g.rotation.y = Math.random()*Math.PI*2;
    g.parent = rootGroup; pruneSmallShadowCasters(g);
  },
  taiga: (x,z,y)=>{
    const trunkH = 13+Math.random()*3;
    const trunk = mkTaperCyl(0.1, 0.55+Math.random()*0.15, trunkH, 0x4a3a2c, 7);
    trunk.position.set(x,y+trunkH/2,z);
    trunk.rotation.y = Math.random()*Math.PI*2;
    trunk.parent = rootGroup; pruneSmallShadowCasters(trunk);
    for(let i=0;i<5;i++){
      const branch = mkTaperCyl(0.03,0.08, 0.8+Math.random()*0.6, 0x4a3a2c, 5);
      branch.rotation.z = Math.PI/2.3*(Math.random()<0.5?1:-1);
      branch.position.set(x, y+2+i*(trunkH-3)/5, z);
      branch.parent = rootGroup; pruneSmallShadowCasters(branch);
    }
  },
  mountain: (x,z,y)=>{
    const g = new BABYLON.TransformNode('landmarkMountain', scene);
    const peakH = 16+Math.random()*4;
    const peak = mkTaperCyl(0.4, 3.6+Math.random()*0.8, peakH, 0x847f70, 6);
    peak.parent = g;
    let cairnY = peakH, cairnR = 0.65;
    for(let i=0;i<4;i++){
      const stone = BABYLON.MeshBuilder.CreatePolyhedron('cairn', {type:2, size:cairnR}, scene);
      const stoneMat = new BABYLON.StandardMaterial('cairnMat', scene);
      stoneMat.diffuseColor = hexToColor3(0x9a958a); stoneMat.specularColor = new BABYLON.Color3(0,0,0);
      stone.material = stoneMat;
      stone.position.set((Math.random()-0.5)*0.2, cairnY+cairnR*0.7, (Math.random()-0.5)*0.2);
      stone.parent = g;
      cairnY += cairnR*1.1; cairnR *= 0.72;
    }
    g.position.set(x,y,z); g.rotation.y = Math.random()*Math.PI*2;
    g.parent = rootGroup; pruneSmallShadowCasters(g);
  },
  swamp: (x,z,y)=>{
    const g = new BABYLON.TransformNode('landmarkSwamp', scene);
    const wood = 0x3a3a2c;
    const trunkH = 8+Math.random()*2;
    const trunk = mkTaperCyl(0.3, 0.9, trunkH, wood, 7);
    trunk.parent = g;
    for(let i=0;i<7;i++){
      const ang = (i/7)*Math.PI*2 + Math.random()*0.3;
      const root = mkTaperCyl(0.12,0.22, 2.6+Math.random()*1.2, wood, 6);
      root.position.set(Math.cos(ang)*1.3, 0, Math.sin(ang)*1.3);
      root.rotation.z = Math.cos(ang)*1.15; root.rotation.x = -Math.sin(ang)*1.15;
      root.parent = g;
    }
    g.position.set(x,y,z); g.rotation.y = Math.random()*Math.PI*2;
    g.parent = rootGroup; pruneSmallShadowCasters(g);
  },
  canyon: (x,z,y)=>{
    const g = new BABYLON.TransformNode('landmarkCanyon', scene);
    const stone = 0x9a5a3a;
    const pillarH = 12+Math.random()*3, gap = 3+Math.random()*1;
    [-1,1].forEach(side=>{
      const p = mkTaperCyl(1.3+Math.random()*0.3, 1.9, pillarH, stone, 8);
      p.position.x = side*(gap/2+1.5);
      p.parent = g;
    });
    const lintel = mkBox(gap+5.5, 2.8, 2.2, stone, { roughness:0.92 });
    lintel.position.y = pillarH+1.4;
    lintel.rotation.z = (Math.random()-0.5)*0.05;
    lintel.parent = g;
    g.position.set(x,y,z); g.rotation.y = Math.random()*Math.PI*2;
    g.parent = rootGroup; pruneSmallShadowCasters(g);
  },
  prairie: (x,z,y)=>{
    const g = new BABYLON.TransformNode('landmarkPrairie', scene);
    const count = 7+Math.floor(Math.random()*3), ringR = 3.6+Math.random()*0.8;
    for(let i=0;i<count;i++){
      const ang = (i/count)*Math.PI*2;
      const slabH = 2.2+Math.random()*1;
      const slab = mkBox(0.6, slabH, 0.35, 0x8a857a, { roughness:0.95 });
      slab.position.set(Math.cos(ang)*ringR, slabH/2, Math.sin(ang)*ringR);
      slab.rotation.y = ang;
      slab.rotation.z = (Math.random()-0.5)*0.1;
      slab.parent = g;
    }
    g.position.set(x,y,z); g.rotation.y = Math.random()*Math.PI*2;
    g.parent = rootGroup; pruneSmallShadowCasters(g);
  },
  tropical: (x,z,y)=>{
    const g = new BABYLON.TransformNode('landmarkTropical', scene);
    const stone = 0x5c6b52;
    const h = 9+Math.random()*2.5;
    const monolith = mkBox(1.8,h,1.4, stone, { roughness:0.97 });
    monolith.parent = g;
    const head = BABYLON.MeshBuilder.CreatePolyhedron('idolHead', {type:2, size:1.3}, scene);
    const headMat = new BABYLON.PBRMaterial('idolHeadMat', scene);
    headMat.albedoColor = hexToColor3(stone); headMat.roughness = 0.95; headMat.metadata = {roughness:0.95,metalness:0};
    head.material = headMat;
    head.position.y = h*0.98;
    head.parent = g;
    for(let i=0;i<6;i++){
      const vine = mkTaperCyl(0.04,0.05, 2+Math.random()*2.5, 0x3f6b32, 5);
      vine.position.set((Math.random()-0.5)*1.6, h*(0.3+Math.random()*0.5), 0.75);
      vine.rotation.x = 0.08*(Math.random()-0.5);
      vine.parent = g;
    }
    g.position.set(x,y,z); g.rotation.y = Math.random()*Math.PI*2;
    g.parent = rootGroup; pruneSmallShadowCasters(g);
  },
};
function placeBiomeLandmark(){
  const build = BIOME_LANDMARK_BUILDERS[mapBiome];
  if(!build) return; // 'mixed' ou biome sans repère dédié (city) : rien à placer
  const angle = Math.random()*Math.PI*2;
  const dist = mapRadius*(1.3+Math.random()*0.5);
  const x = mapCenter.x+Math.cos(angle)*dist, z = mapCenter.z+Math.sin(angle)*dist;
  build(x, z, matchTerrainHeight(x,z));
}
function scatterBiomeDecoration(){
  const pool = MATCH_BIOME_SCATTER[mapBiome] || MATCH_BIOME_SCATTER.mixed;
  // Densité par palier (règle 04, version simplifiée pour ce moteur : la
  // carte n'est jamais parcourue à pied, juste regardée à distance, donc
  // pas besoin des 6 bandes radiales de l'éditeur) : palier proche =
  // détaillé à échelle normale, palier lointain = moins nombreux mais bien
  // plus gros — "dense en silhouettes, léger en détails" au loin.
  function scatterTier(count, distMin, distMax, scaleMin, scaleMax, noShadow){
    for(let i=0;i<count;i++){
      const id = pool[Math.floor(Math.random()*pool.length)];
      const def = MapAssets.ASSETS.find(a=>a.id===id);
      if(!def || !def.build) continue;
      const angle = Math.random()*Math.PI*2;
      const dist = mapRadius*(distMin+Math.random()*(distMax-distMin));
      const wx = mapCenter.x+Math.cos(angle)*dist, wz = mapCenter.z+Math.sin(angle)*dist;
      const obj = def.build(def.color);
      // Hauteur échantillonnée sur le relief (§5.1) plutôt que fixée à 0 :
      // sans ça, les objets flottent ou s'enfoncent dès que le sol vallonne.
      obj.position.set(wx, matchTerrainHeight(wx,wz), wz);
      obj.rotation.y = Math.random()*Math.PI*2;
      const s = scaleMin+Math.random()*(scaleMax-scaleMin);
      obj.scaling.set(s,s,s);
      obj.parent = rootGroup;
      if(noShadow){
        // Palier lointain : agrandir tout l'objet (règle "silhouette plus
        // grosse au loin") repasse mécaniquement AU-DESSUS du seuil de
        // pruneSmallShadowCasters plein de petites pièces (écorce, cartes
        // de feuilles...) normalement élaguées — sur des dizaines d'objets
        // ça a fait chuter le framerate à ~1 img/s (mesuré : 780-1280ms par
        // frame). Ces objets sont décor lointain, jamais inspectés de
        // près : aucune ombre visible n'en vaut le coût, on désactive
        // totalement plutôt que d'élaguer au cas par cas.
        (obj.getChildMeshes ? obj.getChildMeshes(false) : []).forEach(m=> m.castShadow=false);
      } else {
        pruneSmallShadowCasters(obj);
      }
    }
  }
  // Total (54) volontairement resté proche de l'ancien COUNT=70 fixe —
  // voir la note de perf ci-dessus, mesuré à ~50-125ms de construction par
  // objet sur cet environnement : ne pas gonfler le total sans raison.
  scatterTier(36, 1.05, 1.45, 0.85, 1.35, false);
  scatterTier(18, 1.45, 1.95, 1.6, 2.6, true);
  placeBiomeLandmark();
}
scatterBiomeDecoration();

// Enregistrement effectif auprès du ShadowGenerator — AJOUTÉ lors du
// portage Babylon (absent de la traduction ligne-à-ligne d'origine, qui
// ne faisait que recopier le marqueur castShadow/receiveShadow de
// Three.js, inerte en Babylon sans cet appel explicite). Fait exprès en
// UNE passe finale ici, après la boucle MAP_DATA ET scatterBiomeDecoration
// — jamais depuis pruneSmallShadowCasters lui-même : les tuiles de sol
// désactivent leur castShadow APRÈS l'appel à pruneSmallShadowCasters qui
// les construit (voir plus haut, "Une tuile de sol posée à plat..."), donc
// enregistrer immédiatement les projecteurs d'ombre à cet instant-là
// aurait figé les tuiles de sol comme projecteurs d'ombre malgré la
// désactivation qui suit — annulant l'optimisation perf que ce code
// cherchait explicitement à obtenir (10271 des 13418 mailles de la carte).
function finalizeShadowCasters(root){
  (root.getChildMeshes ? root.getChildMeshes(false) : []).forEach(o=>{
    o.receiveShadows = true;
    const wantsCast = o.castShadow === true || (o.metadata && o.metadata.castShadow === true);
    if(wantsCast) shadowGenerator.addShadowCaster(o, false);
  });
}
finalizeShadowCasters(rootGroup);

/* ============================================================
   MODULE: NAVIGATION — vraie grille fine (navmesh) couvrant toute
   l'emprise de la carte : une cellule est praticable si elle est
   recouverte par une dalle de sol ET non occupée par un mur / bâtiment /
   prop / caisse (les portes bloquent la vue mais pas le passage, faute
   de mécanique d'ouverture). Le chemin est cherché en A* sur cette
   grille (jamais de raccourci à travers un mur), puis simplifié et
   arrondi aux angles pour une trajectoire fluide plutôt qu'en ligne
   brisée.
   ============================================================ */
const CELL = 0.5;
const gridMinX = Math.min(...floorNodes.map(f=>f.x)) - 2.5;
const gridMinZ = Math.min(...floorNodes.map(f=>f.z)) - 2.5;
const gridMaxX = Math.max(...floorNodes.map(f=>f.x)) + 2.5;
const gridMaxZ = Math.max(...floorNodes.map(f=>f.z)) + 2.5;
const gridW = Math.ceil((gridMaxX-gridMinX)/CELL)+1;
const gridH = Math.ceil((gridMaxZ-gridMinZ)/CELL)+1;
const walkableGrid = new Uint8Array(gridW*gridH);
function gxz(x,z){ return { gx: Math.round((x-gridMinX)/CELL), gz: Math.round((z-gridMinZ)/CELL) }; }
function gidx(gx,gz){ return gz*gridW+gx; }
function worldOf(gx,gz){ return { x: gridMinX+gx*CELL, z: gridMinZ+gz*CELL }; }
// Applique une fonction sur toutes les cellules dont le CENTRE tombe
// réellement dans la boîte (et non toute la plage arrondie, qui
// sur-couvrirait les petits objets).
function rasterizeBox(b, margin, fn){
  const x0=Math.max(0,Math.floor((b.min.x-margin-gridMinX)/CELL)), x1=Math.min(gridW-1,Math.ceil((b.max.x+margin-gridMinX)/CELL));
  const z0=Math.max(0,Math.floor((b.min.z-margin-gridMinZ)/CELL)), z1=Math.min(gridH-1,Math.ceil((b.max.z+margin-gridMinZ)/CELL));
  for(let gz=z0; gz<=z1; gz++) for(let gx=x0; gx<=x1; gx++){
    const w = worldOf(gx,gz);
    if(w.x>=b.min.x-margin && w.x<=b.max.x+margin && w.z>=b.min.z-margin && w.z<=b.max.z+margin) fn(gidx(gx,gz));
  }
}
const FLOOR_HALF = 2.02;
floorNodes.forEach(f=>{
  const b = new Box3({x:f.x-FLOOR_HALF,y:0,z:f.z-FLOOR_HALF}, {x:f.x+FLOOR_HALF,y:0,z:f.z+FLOOR_HALF});
  rasterizeBox(b, 0, i=> walkableGrid[i]=1);
});
navBlockBoxes.forEach(b=> rasterizeBox(b, 0.12, i=> walkableGrid[i]=0));
function isWalkableCell(gx,gz){ return gx>=0 && gx<gridW && gz>=0 && gz<gridH && walkableGrid[gidx(gx,gz)]===1; }
// Garde-fou : une carte dont la grille est coupée en îlots disjoints est
// injouable EN SILENCE — findPath renvoie un chemin d'un seul point quand la
// destination est dans un autre îlot (voir le "carte disjointe" plus bas),
// donc les agents concernés restent plantés à leur spawn tout le round, ce
// qui se lit en jeu comme un mur invisible qui ne tombe jamais. Constaté sur
// Outpost : deux pyramides posées aux échelles 3.5 et 2 recouvraient à elles
// seules tout le centre de la carte et le site A. On vérifie donc une fois au
// chargement que les spawns et les sites communiquent vraiment.
function checkNavConnectivity(){
  const keys = ['zone_spawn_atk','zone_spawn_def','zone_siteA','zone_siteB'].filter(k=> zones[k]);
  if(keys.length < 2) return;
  const from = keys[0], start = nearestWalkableCell(zones[from]);
  const seen = new Uint8Array(gridW*gridH), stack = [gidx(start.gx,start.gz)];
  seen[stack[0]] = 1;
  while(stack.length){
    const cur = stack.pop(), cgx = cur%gridW, cgz = (cur-cgx)/gridW;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = cgx+dx, nz = cgz+dz;
      if(!isWalkableCell(nx,nz)) continue;
      const ni = gidx(nx,nz);
      if(!seen[ni]){ seen[ni] = 1; stack.push(ni); }
    }
  }
  const lost = keys.slice(1).filter(k=>{ const c = nearestWalkableCell(zones[k]); return !seen[gidx(c.gx,c.gz)]; });
  if(lost.length){
    console.warn('[NAV] Carte coupée en morceaux — '+lost.join(', ')+' injoignable(s) depuis '+from
      +'. Les agents concernés resteront bloqués à leur spawn tout le round.'
      +' Cause habituelle : un décor trop grand (pyramide, bâtiment) posé en travers des couloirs.');
  }
}
checkNavConnectivity();
function nearestWalkableCell(pt){
  const c = gxz(pt.x, pt.z);
  if(isWalkableCell(c.gx,c.gz)) return c;
  for(let r=1;r<30;r++){
    for(let dz=-r;dz<=r;dz++) for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dz))!==r) continue;
      if(isWalkableCell(c.gx+dx,c.gz+dz)) return {gx:c.gx+dx, gz:c.gz+dz};
    }
  }
  return c;
}
const NEI8 = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2],[-1,-1,Math.SQRT2]];
function heapPush(heap,item){ heap.push(item); let i=heap.length-1; while(i>0){ const p=(i-1)>>1; if(heap[p][0]<=heap[i][0]) break; [heap[p],heap[i]]=[heap[i],heap[p]]; i=p; } }
function heapPop(heap){ const top=heap[0]; const last=heap.pop(); if(heap.length){ heap[0]=last; let i=0; while(true){ let l=2*i+1,r=2*i+2,s=i; if(l<heap.length&&heap[l][0]<heap[s][0]) s=l; if(r<heap.length&&heap[r][0]<heap[s][0]) s=r; if(s===i) break; [heap[s],heap[i]]=[heap[i],heap[s]]; i=s; } } return top; }
function astarCells(startCell, goalCell){
  const startI = gidx(startCell.gx,startCell.gz), goalI = gidx(goalCell.gx,goalCell.gz);
  if(startI===goalI) return [startI];
  // Biais spatial aléatoire par zone (6x6 cellules), tiré une fois par
  // appel : rend certains couloirs temporairement "moins chers" que
  // d'autres pour ce trajet précis, sans jamais permettre de traverser un
  // mur. Résultat : les joueurs n'empruntent pas systématiquement le même
  // couloir le plus court — chacun (et chaque round) varie sa route.
  const HCELL = 6; const blockBias = new Map();
  function biasOf(gx,gz){
    const key = (gx/HCELL|0)+'_'+(gz/HCELL|0);
    let v = blockBias.get(key);
    if(v===undefined){ v = 0.8+Math.random()*0.55; blockBias.set(key,v); }
    return v;
  }
  const gScore = new Map([[startI,0]]); const cameFrom = new Map(); const closed = new Set();
  const h = (gx,gz)=> Math.hypot(gx-goalCell.gx, gz-goalCell.gz);
  const heap = [[h(startCell.gx,startCell.gz), startI]];
  let iterations = 0;
  while(heap.length){
    if(++iterations > 90000) break; // garde-fou perf
    const [,cur] = heapPop(heap);
    if(cur===goalI) break;
    if(closed.has(cur)) continue;
    closed.add(cur);
    const cgx = cur % gridW, cgz = (cur - cgx)/gridW;
    for(const [dx,dz,cost] of NEI8){
      const nx=cgx+dx, nz=cgz+dz;
      if(!isWalkableCell(nx,nz)) continue;
      if(dx!==0 && dz!==0 && (!isWalkableCell(cgx+dx,cgz) || !isWalkableCell(cgx,cgz+dz))) continue; // pas de coupe d'angle
      const ni = gidx(nx,nz);
      if(closed.has(ni)) continue;
      const tentative = gScore.get(cur)+cost*biasOf(nx,nz);
      if(tentative < (gScore.has(ni)?gScore.get(ni):Infinity)){
        gScore.set(ni, tentative); cameFrom.set(ni, cur);
        heapPush(heap, [tentative+h(nx,nz), ni]);
      }
    }
  }
  if(!gScore.has(goalI)) return null;
  const path=[goalI]; let cur=goalI;
  while(cur!==startI){ cur=cameFrom.get(cur); if(cur===undefined) return null; path.push(cur); }
  path.reverse(); return path;
}
// Réduction du nombre de points par tir de rayon (string-pulling) : ne
// garde un point que si la trajectoire directe depuis le dernier point
// gardé se remettrait à traverser un obstacle sans lui.
function simplifyPath(pts){
  if(pts.length<=2) return pts;
  const out=[pts[0]]; let anchor=0;
  for(let i=1;i<pts.length-1;i++){
    if(!hasClearPath(pts[anchor], pts[i+1])){ out.push(pts[i]); anchor=i; }
  }
  out.push(pts[pts.length-1]);
  return out;
}
// Arrondit chaque angle interne (coupe de coin façon Bézier quadratique,
// rayon borné pour rester dans le couloir) : la trajectoire n'est plus une
// ligne brisée mais une succession de courbes.
function smoothPath(pts){
  if(pts.length<=2) return pts;
  const out=[pts[0]];
  for(let i=1;i<pts.length-1;i++){
    const a=pts[i-1], b=pts[i], c=pts[i+1];
    const d1=Math.hypot(b.x-a.x,b.z-a.z), d2=Math.hypot(c.x-b.x,c.z-b.z);
    const r=Math.min(0.9, d1*0.35, d2*0.35);
    if(r<0.15){ out.push(b); continue; }
    const t1=Math.max(0,1-r/d1), t2=Math.min(1,r/d2);
    const p1={x:a.x+(b.x-a.x)*t1, z:a.z+(b.z-a.z)*t1};
    const p2={x:b.x+(c.x-b.x)*t2, z:b.z+(c.z-b.z)*t2};
    const steps=6;
    for(let s=1;s<=steps;s++){
      const t=s/steps;
      out.push({ x:(1-t)*(1-t)*p1.x + 2*(1-t)*t*b.x + t*t*p2.x, z:(1-t)*(1-t)*p1.z + 2*(1-t)*t*b.z + t*t*p2.z });
    }
  }
  out.push(pts[pts.length-1]);
  return out;
}
function nearestNode(pt){ let b=0,bd=Infinity; for(let i=0;i<floorNodes.length;i++){ const d=(floorNodes[i].x-pt.x)**2+(floorNodes[i].z-pt.z)**2; if(d<bd){bd=d;b=i;} } return b; }
function nearestNodes(pt,n){ return floorNodes.map((f,i)=>({i,d:(f.x-pt.x)**2+(f.z-pt.z)**2})).sort((a,b)=>a.d-b.d).slice(0,n).map(o=>o.i); }
function findPath(fromIdx,toIdx){
  const startPt = floorNodes[fromIdx], goalPt = floorNodes[toIdx];
  const startCell = nearestWalkableCell(startPt), goalCell = nearestWalkableCell(goalPt);
  const cellPath = astarCells(startCell, goalCell);
  if(!cellPath) return [startPt]; // carte disjointe (ne devrait pas arriver) : reste sur place plutôt que de traverser un mur
  const pts = cellPath.map(i=>{ const gx=i%gridW, gz=(i-gx)/gridW; return worldOf(gx,gz); });
  pts[0] = {x:startPt.x, z:startPt.z};
  pts[pts.length-1] = {x:goalPt.x, z:goalPt.z};
  return smoothPath(simplifyPath(pts));
}
function pathLength(path){ let l=0; for(let i=1;i<path.length;i++) l+=Math.hypot(path[i].x-path[i-1].x, path[i].z-path[i-1].z); return l; }
function pointAlongPath(path, dist){
  if(dist<=0) return {x:path[0].x, z:path[0].z};
  let rem = dist;
  for(let i=1;i<path.length;i++){
    const segLen = Math.hypot(path[i].x-path[i-1].x, path[i].z-path[i-1].z);
    if(rem<=segLen){ const t = segLen>0?rem/segLen:0; return { x:path[i-1].x+(path[i].x-path[i-1].x)*t, z:path[i-1].z+(path[i].z-path[i-1].z)*t }; }
    rem -= segLen;
  }
  return {x:path[path.length-1].x, z:path[path.length-1].z};
}

/* ============================================================
   MODULE: VISION / LIGNE DE VUE — raycasting réel contre murs et
   objets (pas de "toujours visible" comme dans le stub d'origine).
   ============================================================ */
// Distance minimale entre le segment [p1,p2] (plan XZ) et un point donné —
// sert à tester si une fumée (cercle au sol) coupe une ligne de vue, sans
// dépendre des subtilités de Ray.intersectSphere (origine dans la sphère,
// intersection derrière l'origine, etc.).
function segmentDistToPoint2D(p1, p2, c){
  const dx=p2.x-p1.x, dz=p2.z-p1.z, len2=dx*dx+dz*dz;
  let t = len2<1e-6 ? 0 : ((c.x-p1.x)*dx + (c.z-p1.z)*dz)/len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p1.x+dx*t-c.x, p1.z+dz*t-c.z);
}
// Intersection rayon/boîte AABB (méthode des "slabs"), réimplémentation
// fidèle de Ray.prototype.intersectBox de Three.js (r128) — Babylon.Ray n'expose
// qu'un test booléen (intersectsBoxMinMax), sans le point d'impact dont
// hasLineOfSight a besoin pour vérifier qu'il tombe STRICTEMENT entre
// les deux extrémités du segment testé. Calcul en nombres bruts (aucun
// objet alloué) : cette fonction tourne dans le chemin chaud de l'IA,
// plusieurs dizaines d'appels par frame pendant un duel, chacun balayant
// occluderBoxes — c'est ce que cherchaient à éviter les vecteurs partagés
// de la version Three.js.
function rayIntersectBoxDist(ox,oy,oz, dx,dy,dz, bmin,bmax){
  let tmin = -Infinity, tmax = Infinity;
  const o=[ox,oy,oz], d=[dx,dy,dz], mn=[bmin.x,bmin.y,bmin.z], mx=[bmax.x,bmax.y,bmax.z];
  for(let i=0;i<3;i++){
    if(Math.abs(d[i]) < 1e-12){
      if(o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      let t1=(mn[i]-o[i])/d[i], t2=(mx[i]-o[i])/d[i];
      if(t1>t2){ const tmp=t1; t1=t2; t2=tmp; }
      tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2);
      if(tmin>tmax) return null;
    }
  }
  if(tmax<0) return null;
  return tmin>=0 ? tmin : tmax;
}
function hasLineOfSight(p1, p2, height=1.1, boxes=occluderBoxes){
  const fx=p1.x, fy=height, fz=p1.z, tx=p2.x, ty=height, tz=p2.z;
  const ddx=tx-fx, ddy=ty-fy, ddz=tz-fz;
  const dist = Math.hypot(ddx,ddy,ddz);
  if(dist<0.05) return true;
  const dx=ddx/dist, dy=ddy/dist, dz=ddz/dist;
  for(let i=0;i<boxes.length;i++){
    const hd = rayIntersectBoxDist(fx,fy,fz, dx,dy,dz, boxes[i].min, boxes[i].max);
    if(hd!==null && hd>0.15 && hd<dist-0.15) return false;
  }
  // Fumées actives (voir MODULE: UTILITAIRES) : bloquent la vue comme un
  // mur — seulement pour la vraie ligne de vue (boxes par défaut), jamais
  // pour hasClearPath (navigation au sol, appelée avec navBlockBoxes) :
  // une fumée ne bloque jamais le passage physique.
  if(boxes===occluderBoxes && activeSmokes.length){
    const now = SimClock.now();
    for(let i=0;i<activeSmokes.length;i++){
      const s = activeSmokes[i];
      if(s.expiresAt>now && segmentDistToPoint2D(p1, p2, s.center)<=s.radius) return false;
    }
  }
  return true;
}
// Passage praticable entre deux points (mêmes murs/obstacles que la vue,
// mais ignore les portes : pas de mécanique d'ouverture/fermeture ici).
function hasClearPath(p1, p2){ return hasLineOfSight(p1, p2, 0.2, navBlockBoxes); }
function pushOutOfObstacles(pos){
  const M=0.4;
  for(let i=0;i<navBlockBoxes.length;i++){
    const b=navBlockBoxes[i]; const minX=b.min.x-M,maxX=b.max.x+M,minZ=b.min.z-M,maxZ=b.max.z+M;
    if(pos.x<minX||pos.x>maxX||pos.z<minZ||pos.z>maxZ) continue;
    const cx=(b.min.x+b.max.x)/2, cz=(b.min.z+b.max.z)/2, halfX=(maxX-minX)/2, halfZ=(maxZ-minZ)/2;
    const dx=pos.x-cx, dz=pos.z-cz, ox=halfX-Math.abs(dx), oz=halfZ-Math.abs(dz);
    if(ox<oz) pos.x = cx+(dx>=0?1:-1)*halfX; else pos.z = cz+(dz>=0?1:-1)*halfZ;
  }
  return pos;
}

/* Caméra spectateur : orbite (glisser) + zoom (molette) + déplacement
   libre au clavier (ZQSD/AZERTY ou WASD/QWERTY, + flèches) qui déplace le
   point regardé sur la carte au lieu de rester bloqué sur son centre. */
let camAzimuth=0.8, camPolar=0.62, camDist=mapRadius*1.4;
const camTarget = { x: mapCenter.x, z: mapCenter.z };
const CAM_MARGIN = 14;
const camBounds = { minX: bbox.min.x-CAM_MARGIN, maxX: bbox.max.x+CAM_MARGIN, minZ: bbox.min.z-CAM_MARGIN, maxZ: bbox.max.z+CAM_MARGIN };
const POLAR_MIN=0.18, POLAR_MAX=Math.PI/2-0.06, ZOOM_MIN=Math.max(14,mapRadius*0.35), ZOOM_MAX=mapRadius*2.6;
function positionCamera(){
  const sp=Math.sin(camPolar), cp=Math.cos(camPolar);
  camera.position.set(camTarget.x+Math.cos(camAzimuth)*sp*camDist, cp*camDist, camTarget.z+Math.sin(camAzimuth)*sp*camDist);
  camera.upVector.set(0,1,0); camera.setTarget(new BABYLON.Vector3(camTarget.x,1.5,camTarget.z));
}
positionCamera();
let dragging=false,lastX=0,lastY=0; wrap.style.cursor='grab';
wrap.addEventListener('pointerdown', e=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; wrap.style.cursor='grabbing'; exitSpectateMode(); exitDirectorMode(); });
window.addEventListener('pointerup', ()=>{ dragging=false; wrap.style.cursor='grab'; });
window.addEventListener('pointermove', e=>{ if(!dragging) return; const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY; camAzimuth-=dx*0.006; camPolar=Math.max(POLAR_MIN,Math.min(POLAR_MAX,camPolar-dy*0.005)); positionCamera(); });
wrap.addEventListener('wheel', e=>{ e.preventDefault(); exitSpectateMode(); exitDirectorMode(); camDist=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,camDist*Math.exp(e.deltaY*0.0012))); positionCamera(); }, {passive:false});
// Le gestionnaire 'resize' unique est posé avec la boucle de rendu, tout
// en bas du fichier (engine.resize()) : Babylon recalcule seul le ratio
// d'aspect depuis le canvas, il n'y a plus ni camera.aspect ni
// updateProjectionMatrix à mettre à jour ici.

// ZQSD (AZERTY) / WASD (QWERTY) / flèches : déplace la caméra sur la carte,
// relatif à l'orientation actuelle de la vue.
const camKeys = new Set();
const CAM_KEY_MAP = { KeyW:'F', KeyZ:'F', ArrowUp:'F', KeyS:'B', ArrowDown:'B', KeyA:'L', KeyQ:'L', ArrowLeft:'L', KeyD:'R', ArrowRight:'R' };
window.addEventListener('keydown', e=>{ const m=CAM_KEY_MAP[e.code]; if(m){ camKeys.add(m); if(document.activeElement===document.body) e.preventDefault(); } });
window.addEventListener('keyup', e=>{ const m=CAM_KEY_MAP[e.code]; if(m) camKeys.delete(m); });
function updateCameraMove(dtReal){
  if(!camKeys.size) return;
  const speed = camDist*0.9; // plus on est loin/zoomé, plus on va vite
  const fwdX=Math.cos(camAzimuth), fwdZ=Math.sin(camAzimuth); // direction "vers l'avant" de la vue actuelle
  const rightX=Math.cos(camAzimuth-Math.PI/2), rightZ=Math.sin(camAzimuth-Math.PI/2);
  let mx=0,mz=0;
  if(camKeys.has('F')){ mx-=fwdX; mz-=fwdZ; }
  if(camKeys.has('B')){ mx+=fwdX; mz+=fwdZ; }
  if(camKeys.has('L')){ mx-=rightX; mz-=rightZ; }
  if(camKeys.has('R')){ mx+=rightX; mz+=rightZ; }
  const len = Math.hypot(mx,mz);
  if(len>0.001){
    camTarget.x = clamp(camTarget.x + (mx/len)*speed*dtReal, camBounds.minX, camBounds.maxX);
    camTarget.z = clamp(camTarget.z + (mz/len)*speed*dtReal, camBounds.minZ, camBounds.maxZ);
    positionCamera();
  }
}

/* ============================================================
   MODULE: VUE SUBJECTIVE (première personne) — cliquer un joueur dans
   le HUD bascule la caméra à hauteur de ses yeux, orientée dans sa
   direction de visée réelle (this.facing, déjà suivi pour l'IA/le
   rendu). Repositionnée à CHAQUE frame dans animate() (juste avant le
   rendu, après tickRound) plutôt que via positionCamera() : c'est un
   mode entièrement séparé de la caméra spectateur libre (orbite/zoom/
   déplacement clavier), qui continue de mémoriser sa position en
   arrière-plan pour qu'on la retrouve telle quelle à la sortie.
   ============================================================ */
let spectatedAgent = null;
const SPECTATE_EYE_Y = 1.55;
function nearestAliveAlly(agent){
  const allies = agent.team.agents.filter(a=> a.alive && a!==agent);
  if(!allies.length) return null;
  let best=allies[0], bestDist=Infinity;
  allies.forEach(a=>{
    const d = Math.hypot(a.pos.x-agent.pos.x, a.pos.z-agent.pos.z);
    if(d<bestDist){ bestDist=d; best=a; }
  });
  return best;
}
function updateSpectateBanner(){
  const banner = document.getElementById('spectateBanner');
  document.querySelectorAll('.sb-card.spectating').forEach(el=> el.classList.remove('spectating'));
  if(!spectatedAgent){ banner.classList.remove('show'); return; }
  banner.classList.add('show');
  banner.querySelector('.spec-name').textContent = displayNameOf(spectatedAgent.name);
  const card = document.getElementById('sb_'+spectatedAgent.id);
  if(card) card.classList.add('spectating');
}
function setSpectated(agent){
  if(spectatedAgent===agent){ exitSpectateMode(); return; }
  exitDirectorMode(); // modes mutuellement exclusifs
  if(spectatedAgent) spectatedAgent.mesh.setEnabled(true);
  spectatedAgent = agent;
  updateSpectateBanner();
}
// Sur un joueur déjà mort au moment du clic (carte grisée) : bascule
// directement sur son allié vivant le plus proche plutôt que de pointer
// une caméra sur un corps immobile, pour un clic toujours utile.
function trySpectate(agent){
  if(agent.alive) setSpectated(agent);
  else { const ally = nearestAliveAlly(agent); if(ally) setSpectated(ally); }
}
function exitSpectateMode(){
  if(!spectatedAgent) return;
  spectatedAgent.mesh.setEnabled(true);
  spectatedAgent = null;
  updateSpectateBanner();
}
// Appelée depuis animate(), juste avant le rendu : positionne la caméra
// à hauteur des yeux de l'agent suivi et bascule automatiquement sur son
// allié vivant le plus proche dès que ce dernier meurt (voir demande :
// "quand il meurt ça switch sur son allié le plus proche").
function updateSpectateCamera(){
  if(!spectatedAgent) return;
  if(!spectatedAgent.alive){
    const dead = spectatedAgent;
    dead.mesh.setEnabled(true); // rend la main à la logique normale de syncMesh (fondu de mort)
    const ally = nearestAliveAlly(dead);
    if(!ally){ spectatedAgent=null; updateSpectateBanner(); return; }
    spectatedAgent = ally;
    updateSpectateBanner();
  }
  const a = spectatedAgent;
  a.mesh.setEnabled(false); // pas de vue sur son propre corps en première personne
  camera.position.set(a.pos.x, SPECTATE_EYE_Y, a.pos.z);
  camera.upVector.set(0,1,0);
  camera.setTarget(new BABYLON.Vector3(a.pos.x+Math.sin(a.facing), SPECTATE_EYE_Y, a.pos.z+Math.cos(a.facing)));
}

/* ============================================================
   MODULE: MODE RÉALISATEUR — caméra "broadcast" qui suit tout seule les
   duels les plus intenses (deux ennemis vivants qui s'engagent l'un
   l'autre), plutôt que de rester sur un plan large statique ou d'obliger
   à cliquer un joueur soi-même. Contrainte explicitement demandée :
   "quand il y a plusieurs duels ne switch pas direct" — un duel choisi
   reste VERROUILLÉ un minimum de temps (DIRECTOR_MIN_LOCK) avant de
   pouvoir en reprendre un autre, même si un duel "plus important"
   démarre entre-temps ; seule la résolution du duel suivi (mort d'un des
   deux) débloque une réévaluation immédiate.
   ============================================================ */
let directorMode = false;
let directorDuel = null; // {a,b}
let directorLockUntil = 0;
let directorAngle = Math.random()*Math.PI*2;
const DIRECTOR_MIN_LOCK = 3.5;
// Paires d'ennemis actuellement engagés (état COMBAT + cible vivante) —
// ignore l'aggro à sens unique (poursuite d'un ennemi qui ne riposte
// pas), un vrai "duel" suppose que la cible existe encore pour riposter.
function findActiveDuels(){
  const duels = []; const seen = new Set();
  [...teamA.agents, ...teamB.agents].forEach(a=>{
    if(!a.alive || a.state!=='COMBAT' || !a.targetEnemy || !a.targetEnemy.alive) return;
    const b = a.targetEnemy;
    const key = a.id<b.id ? a.id+'|'+b.id : b.id+'|'+a.id;
    if(seen.has(key)) return;
    seen.add(key);
    duels.push({a, b});
  });
  return duels;
}
// Score d'"intérêt" d'un duel : tirs récents des deux côtés (échange
// actif, pas juste une visée qui vient de commencer), clutch (dernier
// vivant de son équipe), vies basses (issue proche), post-plant (tension
// accrue), distance courte (plus lisible à l'écran qu'un duel à 40m).
function scoreDuel(duel){
  const {a,b} = duel, now = SimClock.now();
  let score = Math.max(0,1-(now-a.lastShotAt)/2)*10 + Math.max(0,1-(now-b.lastShotAt)/2)*10;
  if(a.team.agents.filter(x=>x.alive).length===1) score += 15;
  if(b.team.agents.filter(x=>x.alive).length===1) score += 15;
  score += (1-a.hp/a.maxHp)*8 + (1-b.hp/b.maxHp)*8;
  if(typeof planted!=='undefined' && planted) score += 6;
  score += Math.max(0, 10-Math.hypot(a.pos.x-b.pos.x, a.pos.z-b.pos.z));
  return score;
}
function updateDirectorBanner(){
  const banner = document.getElementById('directorBanner');
  if(!directorMode || !directorDuel){ banner.classList.remove('show'); return; }
  banner.classList.add('show');
  banner.querySelector('.dir-name').textContent = `${displayNameOf(directorDuel.a.name)} vs ${displayNameOf(directorDuel.b.name)}`;
}
function enterDirectorMode(){
  exitSpectateMode();
  directorMode = true;
  directorDuel = null; directorLockUntil = 0;
  document.getElementById('directorBtn').classList.add('active');
  updateDirectorBanner();
}
function exitDirectorMode(){
  if(!directorMode) return;
  directorMode = false; directorDuel = null;
  document.getElementById('directorBtn').classList.remove('active');
  updateDirectorBanner();
}
// Appelée depuis animate(), juste avant le rendu — même emplacement que
// updateSpectateCamera, mode mutuellement exclusif avec elle.
function updateDirectorCamera(dtReal){
  if(!directorMode) return;
  const now = SimClock.now();
  const stillEngaged = directorDuel && directorDuel.a.alive && directorDuel.b.alive
    && directorDuel.a.state==='COMBAT' && directorDuel.a.targetEnemy===directorDuel.b;
  if(!stillEngaged) directorLockUntil = 0; // duel résolu : réévaluation immédiate autorisée
  if(now>=directorLockUntil){
    const duels = findActiveDuels();
    if(duels.length){
      let best=duels[0], bestScore=-Infinity;
      duels.forEach(d=>{ const s=scoreDuel(d); if(s>bestScore){ bestScore=s; best=d; } });
      const changed = !directorDuel || (best.a!==directorDuel.a && best.a!==directorDuel.b);
      directorDuel = best;
      directorLockUntil = now + DIRECTOR_MIN_LOCK;
      if(changed) updateDirectorBanner();
    } else if(directorDuel){
      // Le duel suivi vient de se résoudre et rien ne le remplace dans
      // l'immédiat : repasse en plan d'ensemble (voir fallback plus bas)
      // plutôt que de rester figé sur les deux derniers duellistes, dont
      // un est peut-être mort — sinon la caméra semble "plantée" en
      // attendant le prochain duel.
      directorDuel = null;
      updateDirectorBanner();
    }
  }
  let midX, midZ, orbitDist;
  if(directorDuel){
    const {a,b} = directorDuel;
    midX=(a.pos.x+b.pos.x)/2; midZ=(a.pos.z+b.pos.z)/2;
    const dist = Math.max(4, Math.hypot(a.pos.x-b.pos.x, a.pos.z-b.pos.z));
    orbitDist = Math.min(26, Math.max(9, dist*1.8));
  } else {
    // Aucun duel en cours (juste après activation, en pleine barrière de
    // spawn, ou entre deux engagements) : plan d'ensemble sur le centre
    // de gravité des joueurs vivants plutôt qu'une caméra totalement
    // inerte tant qu'aucun duel n'a démarré — c'est ce qui donnait
    // l'impression que le mode réalisateur "met du temps à s'activer"
    // (signalé par un joueur), alors qu'il attendait juste, immobile, le
    // premier duel avant de faire quoi que ce soit.
    const alive = [...teamA.agents, ...teamB.agents].filter(a=>a.alive);
    if(!alive.length) return;
    midX = alive.reduce((s,a)=>s+a.pos.x,0)/alive.length;
    midZ = alive.reduce((s,a)=>s+a.pos.z,0)/alive.length;
    orbitDist = 34;
  }
  directorAngle += dtReal*0.12; // léger travelling continu, plus cinématique qu'un plan figé
  camera.position.set(midX+Math.cos(directorAngle)*orbitDist*0.72, orbitDist*0.55, midZ+Math.sin(directorAngle)*orbitDist*0.72);
  camera.upVector.set(0,1,0);
  camera.setTarget(new BABYLON.Vector3(midX, 1.2, midZ));
}

/* ============================================================
   MODULE: ROLES / ROSTER — 5 rôles Valorant, stats individuelles
   (aim, réaction, game sense, agressivité, discipline, communication,
   clutch, utilité) qui influencent réellement les décisions plus bas.
   ============================================================ */
const ROLES = ['Duelist','Initiator','Controller','Sentinel','Flex'];
const ROLE_MODS = {
  Duelist:   { aggression:+18, aim:+10, clutch:+8 },
  Initiator: { gameSense:+14, reaction:+8, utility:+12 },
  Controller:{ discipline:+14, utility:+18 },
  Sentinel:  { discipline:+18, gameSense:+8, aim:+4 },
  Flex:      { communication:+10, gameSense:+8 },
};
// Style de jeu individuel — un rôle Valorant n'est pas qu'une pastille de
// stats : il détermine un vrai comportement observable sur le terrain.
const PLAYSTYLE_BY_ROLE = { Duelist:'Entry Fragger', Initiator:'Initiator Playmaker', Controller:'Controller Stratégique', Sentinel:'Sentinel Ancre', Flex:'Lurker' };
// Accent visuel par RÔLE (petite pièce du modèle, en plus de la couleur
// d'équipe déjà présente) — pour distinguer les coéquipiers d'un coup
// d'œil au-delà de l'étiquette de nom (voir Agent.buildMesh).
const ROLE_ACCENT_COLOR = { Duelist:0xff9c3d, Initiator:0x3dd6ff, Controller:0xb06dff, Sentinel:0x5ee06a, Flex:0xd8d8d8 };
// Identité visuelle par AGENT VALOSTRIKE (le personnage réellement joué,
// this.kit.agent — voir playerToAIKit côté script.js) : jusqu'ici tous les
// agents portaient exactement la même tenue grise/olive/tan, seule la
// couleur d'équipe (anneau au sol/visière/brassard, inchangée) distinguait
// les joueurs. `primary` recolore le gilet/pantalon (plus grande surface
// visible après la couleur d'équipe elle-même), `accent` la pièce de rôle
// (roleMat) — un thème par agent, dérivé de son nom/titre/sorts (ex. Ignis
// "Maître du Feu" → orange braise, Obscura "Maîtresse des Ombres" → noir
// violacé). Couvre les 24 agents du roster (AGENT_KITS, valorant.js).
// `accessories` : pièces de silhouette ajoutées par Agent.buildMesh (voir
// plus bas, section "Pièces de silhouette par agent") — chaque type
// (hood/cape/crest/shoulderSpikes/shoulderPlate/chestEmblem) est un
// builder générique partagé, paramétré différemment par agent, plutôt que
// 24 géométries bespoke : même logique que les arbres/rochers (quelques
// formes réutilisables + variation par instance) appliquée aux personnages.
// `glow` : la tête reste cagoulée (vue isométrique, un visage détaillé ne
// se lirait jamais à cette distance de caméra — voir buildMesh) donc
// l'identité "visage" passe par la VISIÈRE : couleur/forme par agent
// systématiquement, plus un liseré émissif (yeux qui luisent) sur les
// agents à identité élémentaire/magique marquée.
const AGENT_VISUAL_THEME = {
  // Duellistes
  Kaidan:  { primary:0x3a2a5c, accent:0x1a1a22, accessories:[{type:'hood'},{type:'cape'}], glow:true },
  Rhoven:  { primary:0x6b1f1f, accent:0x1c1c1c, accessories:[{type:'shoulderSpikes', side:'right', count:3}] },
  Ignis:   { primary:0xc1501f, accent:0x2a2220, accessories:[{type:'shoulderPlate', side:'right'},{type:'chestEmblem'}], glow:true },
  Vexal:   { primary:0x241633, accent:0x8a4fd6, accessories:[{type:'cape'},{type:'chestEmblem'}], glow:true },
  Solmara: { primary:0xd4a017, accent:0xe8dcc0, accessories:[{type:'crest'},{type:'chestEmblem'}], glow:true },
  Drakko:  { primary:0x2e5c3a, accent:0x7a2020, accessories:[{type:'shoulderSpikes', side:'both', count:2},{type:'crest'}] },
  Halcyon: { primary:0x9fd6e0, accent:0xb8c4c8, accessories:[{type:'cape', light:true}] },
  // Initiateurs
  Sondra:  { primary:0x8a5a3a, accent:0xb87333, accessories:[{type:'shoulderPlate', side:'left'}] },
  Pryzm:   { primary:0x3ec9c9, accent:0xe0f0f0, accessories:[{type:'crest'},{type:'chestEmblem'}], glow:true },
  Kestrix: { primary:0x9a8560, accent:0xb5824a, accessories:[{type:'shoulderPlate', side:'left'},{type:'hood'}] },
  Marrow:  { primary:0xd8d0c0, accent:0x1a1a1a, accessories:[{type:'hood'},{type:'chestEmblem'}], glow:true },
  Voltane: { primary:0x2a7fd6, accent:0xe0c020, accessories:[{type:'crest'},{type:'chestEmblem'}], glow:true },
  Ashra:   { primary:0x6a6660, accent:0x8a2a1e, accessories:[{type:'hood'},{type:'cape'}] },
  // Contrôleurs
  Nimbus:  { primary:0x5a6b7a, accent:0xd8dee2, accessories:[{type:'cape'},{type:'crest'}] },
  Verdane: { primary:0x3a6b3a, accent:0x5c4530, accessories:[{type:'shoulderPlate', side:'left'},{type:'crest'}] },
  Grael:   { primary:0x6a6a68, accent:0x9a5a30, accessories:[{type:'shoulderSpikes', side:'both', count:2},{type:'shoulderPlate', side:'right'}] },
  Mistara: { primary:0xaebcc4, accent:0xe8eef0, accessories:[{type:'cape', light:true},{type:'hood'}] },
  Obscura: { primary:0x18161c, accent:0x4a2a5c, accessories:[{type:'hood'},{type:'cape'}], glow:true },
  Corvane: { primary:0x1a1a1e, accent:0x2a2e3c, accessories:[{type:'shoulderPlate', side:'left'},{type:'hood'}] },
  // Sentinelles
  Sentra:  { primary:0x6a6e70, accent:0xd6621f, accessories:[{type:'chestEmblem'},{type:'shoulderPlate', side:'right'}] },
  Warden:  { primary:0x3a5a7a, accent:0xb0b8c0, accessories:[{type:'shoulderPlate', side:'left'},{type:'chestEmblem'}] },
  Bastian: { primary:0x3a3d40, accent:0x9a2020, accessories:[{type:'chestEmblem'},{type:'shoulderPlate', side:'right'}] },
  Locke:   { primary:0x4a4a48, accent:0xb5601f, accessories:[{type:'shoulderSpikes', side:'right', count:2},{type:'chestEmblem'}] },
  Thorne:  { primary:0x3a4a28, accent:0x5c3a24, accessories:[{type:'shoulderSpikes', side:'left', count:3},{type:'hood'}] },
};
const NAMES_A = ['Halcyon "Odren"','Pryzm "Ronin"','Corvane "Aspen"','Warden "Gallor"','Kaidan "Clover44"'];
const NAMES_B = ['Nimbus "Milestone44"','Kaidan "Helior"','Pryzm "Rioren"','Warden "Sorian"','Pryzm "Neranis"'];

function rand(min,max){ return min+Math.random()*(max-min); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function genStats(role){
  const base = ()=> Math.round(rand(45,75));
  const s = { aim:base(), reaction:base(), gameSense:base(), aggression:base(), discipline:base(), communication:base(), clutch:base(), utility:base() };
  const mods = ROLE_MODS[role]||{};
  Object.keys(mods).forEach(k=> s[k] = clamp(s[k]+mods[k],10,99));
  return s;
}

const TEAM_A_TAG = 0xff5f5f, TEAM_B_TAG = 0x4ecd6a; // rouge=attaque, vert=défense — tagColor suit `side`, pas l'équipe A/B
function initialsOf(name){ const c=(name||'').replace(/"/g,'').trim(); const p=c.split(/\s+/).filter(Boolean); return ((p[0]?.[0]||'')+(p[1]?.[0]||'')||c.slice(0,2)||'?').toUpperCase(); }
// Diminutif d'équipe (ex. "Eintracht Frankfurt" -> "EF") — repli utilisé
// UNIQUEMENT si le manager n'a pas fourni le vrai tag (state.org.tag ou
// dérivé côté script.js, voir runAIZenithMatch) : mêmes règles que
// deriveTeamTag côté manager, pour rester cohérent en simulation autonome.
function deriveTeamTagLocal(name){
  const words = (name||'').replace(/[^A-Za-zÀ-ÿ ]/g,'').trim().split(/\s+/).filter(Boolean);
  if(words.length>=2) return (words[0][0]+words[1][0]).toUpperCase();
  const w = words[0] || 'TAG';
  return w.slice(0,3).toUpperCase();
}
function displayNameOf(name){ const m=(name||'').match(/"([^"]+)"/); return m?m[1]:(name||'Joueur'); }
// teamTag (optionnel) : diminutif d'équipe (Team.tag, ex. "JL" pour
// joblife) affiché devant le pseudo — convention esport classique
// ("JL Kreta"), jusqu'ici seul le pseudo nu apparaissait au-dessus des
// personnages alors que Team.tag existait déjà (transmis depuis
// script.js via matchInit → rebuildTeams, juste jamais lu ici).
function mkNameTag(name, tagColor, teamTag){
  const c=document.createElement('canvas'); c.width=240; c.height=64; const ctx=c.getContext('2d');
  ctx.fillStyle='#'+tagColor.toString(16).padStart(6,'0'); ctx.beginPath(); ctx.arc(30,32,27,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=3; ctx.stroke();
  ctx.fillStyle='#0a0e16'; ctx.font='800 22px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(initialsOf(name),30,33);
  const label = teamTag ? teamTag.toUpperCase()+' '+displayNameOf(name) : displayNameOf(name); ctx.font='700 21px Arial';
  const tw = ctx.measureText(label).width; const bw = Math.min(170,tw+16);
  ctx.fillStyle='rgba(8,11,17,.75)'; ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(62,14,bw,36,6) : ctx.rect(62,14,bw,36); ctx.fill();
  ctx.fillStyle='#eef2f7'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(label,70,32);
  const tex=new BABYLON.DynamicTexture('nameTag', c, scene, true); tex.update();
  const sp=mkSpritePlane('nameTag', 2.0, 0.53, scene);
  const spMat=new BABYLON.StandardMaterial('nameTagMat', scene);
  spMat.specularColor = new BABYLON.Color3(0.05,0.05,0.05);
  spMat.diffuseTexture = tex; spMat.diffuseTexture.hasAlpha = true; spMat.useAlphaFromDiffuseTexture = true;
  spMat.emissiveColor = new BABYLON.Color3(1,1,1); spMat.disableLighting = true; spMat.disableDepthWrite = true;
  sp.material = spMat;
  sp.alphaIndex=998; return sp; // alphaIndex remplace renderOrder (tri des transparents côté Babylon)
}

/* ============================================================
   MODULE: AGENTS — mesh + étiquette persistante (nom + avatar rond
   d'initiales, il n'existe aucune vraie photo de profil dans les
   données du jeu donc on reprend la même convention que partout
   ailleurs dans l'application).
   ============================================================ */
class Agent{
  // realStats (optionnel) : stats 0-99 issues d'un vrai joueur du manager
  // (voir Team ci-dessus) — remplace le tirage aléatoire genStats(role)
  // quand fourni, pour que l'aim/game sense/clutch réels du joueur pèsent
  // sur les duels, l'agressivité, les décisions d'achat, etc.
  // kit (optionnel) : sorts RÉELS de l'agent joué (signature/A/B/ultimate,
  // noms + coûts + stats déjà résolus à la valeur de patch en vigueur, voir
  // playerToAIKit côté manager) — remplace le rôle générique
  // (smoke/flash/piège) par les VRAIS sorts créés pour ce personnage.
  constructor(id, name, role, side, team, realStats, kit){
    this.id = id; this.name = name; this.role = role; this.side = side; this.team = team;
    this.playstyle = PLAYSTYLE_BY_ROLE[role] || 'Flex player';
    this.stats = realStats || genStats(role);
    this.kit = kit || null;
    this.maxHp = 100; this.hp = 100; this.alive = true;
    this.weapon = { name:'Striker-9', dmgBody:32, dmgHead:118, dmgLeg:24, rofMs:210, range:20, tierRank:0 };
    this.armor = false;
    this.pos = { x:0, z:0 }; this.facing = 0; // radians
    this.speed = 0; this.maxSpeed = 5.6 * (this.playstyle==='Entry Fragger' ? 1.08 : 1); // premier à travers le choke
    this.path = null; this.pathLen = 0; this.pathDist = 0;
    this.state = 'IDLE'; // IDLE|MOVING|COMBAT|HOLD|POSTPLANT|RETAKE|DEAD
    this.targetEnemy = null;
    this.lastShotAt = -9999;
    this.lastEngagedTargetId = null; // détecte le PREMIER tir d'un nouvel engagement (voir CombatSystem.tryShoot, bonus game sense)
    this.blindedUntil = -Infinity; // aveuglé par un flash tant que SimClock.now() < cette valeur (voir MODULE: UTILITAIRES)
    this.rootedUntil = -Infinity; // étourdi/immobilisé par un sort (ne bouge pas, ne tire pas)
    this.aimMultUntil = -Infinity; this.aimMult = 1; // précision temporairement modifiée : <1 = déstabilisé (désorientation/réduction précision), >1 = amplifié par un allié
    this.revengeTargetId = null;
    this.kills = 0; this.deaths = 0; this.assists = 0;
    // Vraies stats de match accumulées en direct (voir CombatSystem.tryShoot/
    // onKill/endRound) — jusqu'ici seuls kills/deaths existaient réellement
    // (assists jamais crédité), ADR/KAST/HS%/premiers kills/clutchs étaient
    // ré-estimés après coup côté manager à partir des attributs du joueur,
    // sans rapport avec ce qui s'était réellement passé dans CE match.
    this.damageDealt = 0; this.hitsTotal = 0; this.hitsHead = 0;
    this.kastRounds = 0; this.firstKills = 0; this.firstDeaths = 0; this.clutchesWon = 0;
    this._roundAssists = 0; this._roundDamageTaken = {};
    this.credits = 800; // économie individuelle, comme en vrai (chaque joueur a sa propre banque)
    this.ownedAbilities = { a:false, b:false }; // sorts A/B achetés CE round (voir decideBuyForAgent)
    this.sigCooldownUntil = -Infinity; // sort signature (gratuit, à recharge — voir Recharge (s))
    this.ultimatePoints = 0; // accumulés via les points requis de l'ultime (1 par élimination)
    this.destination = null; // {x,z} noeud visé
    this.holdSince = null; this.holdLimit = rand(3,7); // anti-camp : temps max figé avant repositionnement
    this.mesh = this.buildMesh();
    finalizeShadowCasters(this.mesh); // enregistrement réel auprès du ShadowGenerator (voir la note à l'appel équivalent pour rootGroup) — sans ordre à respecter ici (rien ne désactive castShadow sur un agent après coup)
    this.tagColor = side==='ATTACK' ? TEAM_A_TAG : TEAM_B_TAG;
    this.updateTag();
  }
  buildMesh(){
    const g = new BABYLON.TransformNode('agent_'+this.id, scene);
    const teamColor = this.side==='ATTACK' ? 0xff5f5f : 0x4ecd6a;
    const mat = mkStdMat('agentMat', teamColor, { roughness:0.55, metalness:0.12 });
    const accentMat = mkStdMat('agentAccent', hexToColor3(teamColor).scale(0.42), { roughness:0.75 });
    // Tenue tactique en tons ternes (gris/olive/tan, référence CS) au lieu
    // du rouge/vert vif sur tout le corps — la couleur d'équipe reste
    // lisible via l'anneau au sol (déjà existant) + la visière/le brassard
    // (mat/accentMat, désormais réservés à ces petits éléments seulement)
    // plutôt que de teindre l'intégralité de la tenue.
    // Thème de l'AGENT VALOSTRIKE réellement joué (this.kit.agent, résolu
    // côté manager par playerToAIKit — voir script.js) : recolore
    // gilet/pantalon/pièce de rôle/arme selon son identité propre, par-
    // dessus la base terne ci-dessus. En repli (kit absent, ex. bots de
    // démo sans données manager) : on retrouve le nom d'agent dans
    // this.name lui-même, qui suit la convention 'Agent "Pseudo"' (voir
    // NAMES_A/NAMES_B) — sans thème reconnu, la tenue reste neutre comme
    // avant.
    const visualAgentName = (this.kit && this.kit.agent) || (/^(\w+)\s+"/.exec(this.name||'')||[])[1] || null;
    const theme = AGENT_VISUAL_THEME[visualAgentName] || null;
    const shirtMat = mkStdMat('agentShirt', 0x9a978c, { roughness:0.8 });
    const vestMat = mkStdMat('agentVest', theme ? theme.primary : 0x5c5c46, { roughness:0.85 });
    const pantsMat = mkStdMat('agentPants', theme ? hexToColor3(theme.primary).scale(0.62) : 0x8a7a5c, { roughness:0.85 });
    // Teinte de peau variée par personnage (avant : la même couleur exacte
    // pour les 10 agents d'un match, rendu "clones") — léger décalage
    // teinte/saturation/luminosité aléatoire autour d'une base neutre.
    const skinBase = hexToColor3(0xd8a87a);
    const skinHsl = _colorToHSL(skinBase);
    const skinCol = _hslToColor3(
      (skinHsl.h+(Math.random()-0.5)*0.04+1)%1,
      Math.max(0,Math.min(1,skinHsl.s+(Math.random()-0.5)*0.15)),
      Math.max(0.15,Math.min(0.85,skinHsl.l+(Math.random()-0.5)*0.3))
    );
    const skinMat = mkStdMat('agentSkin', skinCol, { roughness:0.85 });
    // Skin d'arme : légère teinte vers l'accent de l'agent plutôt qu'un
    // gunmetal 100% neutre — reste lisible comme une arme (majorité
    // toujours sombre/métallique), juste une touche d'identité.
    const gunBaseCol = hexToColor3(0x22252a);
    const gunCol = theme ? gunBaseCol.scale(0.8).add(hexToColor3(theme.accent).scale(0.2)) : gunBaseCol;
    const gunMat = mkStdMat('agentGun', gunCol, { roughness:0.4, metalness:0.55 });
    const bootMat = mkStdMat('agentBoot', 0x1c1c1e, { roughness:0.8 });
    // Accent de rôle (Duelliste/Initiateur/Contrôleur/Sentinelle/Flex,
    // déjà connu) sur une petite pièce du modèle, en plus de la couleur
    // d'équipe — distingue les coéquipiers d'un coup d'œil au-delà de
    // l'étiquette de nom. Le thème d'agent (plus spécifique) prend le pas
    // sur l'accent de rôle (plus générique) quand les deux existent.
    const roleMat = mkStdMat('agentRole', theme ? theme.accent : (ROLE_ACCENT_COLOR[this.role]||0xd8d8d8), { roughness:0.5, metalness:0.25 });
    const cast = m=>{ m.castShadow=true; return m; };
    const cyl = (n,rt,rb,h,seg,material)=>{ const m = BABYLON.MeshBuilder.CreateCylinder(n, {diameterTop:rt*2, diameterBottom:rb*2, height:h, tessellation:seg}, scene); m.material = material; return m; };
    const box = (n,w,h,d,material)=>{ const m = BABYLON.MeshBuilder.CreateBox(n, {width:w, height:h, depth:d}, scene); m.material = material; return m; };
    const sph = (n,r,seg,material)=>{ const m = BABYLON.MeshBuilder.CreateSphere(n, {diameter:r*2, segments:seg}, scene); m.material = material; return m; };

    // Jambes — pivot au niveau de la HANCHE (pas du milieu de la cuisse
    // comme avant) : un Group posé à hauteur de hanche contient la jambe
    // ET la botte, décalées vers le bas à l'intérieur du pivot, pour que
    // la rotation de marche batte depuis l'articulation anatomiquement
    // correcte au lieu de faire pivoter tout le membre sur son propre
    // centre. La botte suit alors naturellement le mouvement de marche.
    const legPivotL = new BABYLON.TransformNode('legPivotL', scene); legPivotL.position.set(-0.13,0.55,0); legPivotL.parent = g;
    const legL = cast(cyl('legL',0.09,0.1,0.48,8, pantsMat)); legL.position.y=-0.24; legL.parent = legPivotL;
    const bootL = cast(box('bootL',0.13,0.09,0.21, bootMat)); bootL.position.set(0,-0.475,0.03); bootL.parent = legPivotL;
    const legPivotR = new BABYLON.TransformNode('legPivotR', scene); legPivotR.position.set(0.13,0.55,0); legPivotR.parent = g;
    const legR = cast(cyl('legR',0.09,0.1,0.48,8, pantsMat)); legR.position.y=-0.24; legR.parent = legPivotR;
    const bootR = cast(box('bootR',0.13,0.09,0.21, bootMat)); bootR.position.set(0,-0.475,0.03); bootR.parent = legPivotR;
    // Torse (buste conique, plus large aux épaules)
    const torso = cast(cyl('torso',0.27,0.22,0.5,10, shirtMat)); torso.position.y=0.8; torso.parent = g;
    // Ceinture + pochettes tactiques (rien ne suggérait un équipement porté
    // à la taille jusqu'ici — juste un buste nu au-dessus des jambes)
    const belt = cast(cyl('belt',0.24,0.235,0.06,10, bootMat)); belt.position.y=0.56; belt.parent = g;
    for(const px of [-0.16,0.16]){
      const pouch = cast(box('pouch',0.09,0.1,0.08, vestMat)); pouch.position.set(px,0.52,0.16); pouch.parent = g;
    }
    // Sac à dos — casse la silhouette plate de dos, cohérent avec le
    // gilet/pochettes déjà présents à l'avant.
    const backpack = cast(box('backpack',0.22,0.28,0.13, vestMat)); backpack.position.set(0,0.85,-0.14); backpack.parent = g;
    // Gilet tactique (plastron)
    const vest = cast(box('vest',0.32,0.28,0.14, vestMat)); vest.position.set(0,0.85,0.1); vest.parent = g;
    // Brassard d'équipe — puisque tout le reste de la tenue passe en tons
    // ternes, il faut un petit repère de couleur d'équipe directement sur
    // le corps (en plus de l'anneau au sol déjà existant) pour rester
    // lisible d'un coup d'œil en jeu.
    const armband = cast(cyl('armband',0.07,0.07,0.05,8, accentMat)); armband.position.set(0.303,0.87,0); armband.rotation.z=-0.12; armband.castShadow=false; armband.parent = g;
    // Épaulette de rôle
    const roleBadge = cast(box('roleBadge',0.1,0.1,0.06, roleMat)); roleBadge.position.set(-0.28,1.0,0.09); roleBadge.parent = g;
    // Cou — la tête posait directement sur le torse jusqu'ici, jonction
    // sphère-sur-cylindre trop nette pour lire comme une silhouette humaine.
    // Couleur cagoule (comme la tête, voir plus bas) : un cou à nu sous une
    // tête masquée ne collait pas au style opérateur tactique visé.
    const neck = cast(cyl('neck',0.07,0.08,0.1,8, bootMat)); neck.position.y=1.06; neck.parent = g;
    // Épaules + bras + mains
    const shoulderL = cast(sph('shoulderL',0.11,6, shirtMat)); shoulderL.position.set(-0.28,1.0,0); shoulderL.parent = g;
    const shoulderR = cast(sph('shoulderR',0.11,6, shirtMat)); shoulderR.position.set(0.28,1.0,0); shoulderR.parent = g;
    const armL = cast(cyl('armL',0.06,0.055,0.42,8, shirtMat)); armL.position.set(-0.3,0.78,0); armL.rotation.z=0.12; armL.parent = g;
    const armR = cast(cyl('armR',0.06,0.055,0.42,8, shirtMat)); armR.position.set(0.3,0.78,0); armR.rotation.z=-0.12; armR.parent = g;
    // Mains repositionnées près de l'arme (avant : accrochées à hauteur de
    // hanche, sans rapport avec la position du fusil — on aurait dit des
    // bras ballants plutôt qu'un personnage tenant réellement son arme).
    const handL = cast(sph('handL',0.05,6, skinMat)); handL.position.set(0.1,0.74,0.44); handL.parent = g;
    const handR = cast(sph('handR',0.05,6, skinMat)); handR.position.set(0.16,0.77,0.24); handR.parent = g;
    // Tête cagoulée façon opérateur tactique (référence demandée : tenue
    // CS-like — cagoule noire couvrant tout le crâne, pas de peau/cheveux
    // visibles) + visière/lunettes de protection par-dessus. Remplace la
    // tête peau nue + cheveux du passage précédent : la caméra de ce jeu
    // est vue de dessus/isométrique de toute façon, un visage détaillé ne
    // s'y voit jamais — autant assumer complètement le look "cagoulé".
    const head = cast(sph('head',0.16,8, bootMat)); head.position.y=1.16; head.scaling.set(0.92,1,0.98); head.parent = g;
    // Visière = identité "visage" par agent. La tête reste cagoulée (voir
    // note ci-dessus, un visage détaillé ne se lirait jamais à la distance
    // de caméra de ce jeu) donc c'est la SEULE pièce de tête qui varie par
    // agent — couleur d'accent systématique, plus lueur émissive (façon
    // "yeux qui luisent") sur les agents à identité élémentaire/magique
    // marquée (theme.glow). La couleur d'ÉQUIPE reste lisible ailleurs
    // (anneau au sol + brassard, jamais touchés ici).
    const visorMat = mkStdMat('visor', theme ? theme.accent : hexToColor3(teamColor), { roughness:0.3, metalness:0.35 });
    if(theme && theme.glow) visorMat.emissiveColor = hexToColor3(theme.accent).scale(0.55);
    const visor = cast(box('visor',0.2,0.07,0.06, visorMat)); visor.position.set(0,1.17,0.13); visor.parent = g;
    // Pièces de silhouette par agent (theme.accessories) : quelques formes
    // génériques réutilisables (capuche/cape/crête/pointes d'épaule/plaque
    // d'épaule/emblème de poitrine), combinées et positionnées différemment
    // par agent plutôt que 24 géométries bespoke — même principe que les
    // arbres/rochers de la bibliothèque d'assets. Bots de démo/agents sans
    // thème reconnu : aucune pièce ajoutée, silhouette de base inchangée.
    if(theme && theme.accessories){
      const accMatCache = {};
      const accMat = (key, roughness, metalness)=>{
        if(!accMatCache[key]) accMatCache[key] = mkStdMat('agentAcc_'+key, theme.primary, { roughness, metalness });
        return accMatCache[key];
      };
      theme.accessories.forEach(acc=>{
        if(acc.type==='hood'){
          const hm = accMat('hood', 0.9, 0);
          const hood = cast(sph('hoodPiece',0.19,8, hm)); hood.scaling.set(1,1.05,1.08); hood.position.set(0,1.19,-0.03); hood.parent = g;
          // cyl(n,rt,rb,h,...) : rt=diamètre du HAUT local, rb=diamètre du
          // BAS local (voir définition de cyl plus haut). rb large (base
          // attachée à la capuche) → rt ~0 (pointe qui s'éloigne).
          const tip = cast(cyl('hoodTip',0,0.075,0.14,6, hm)); tip.position.set(0,1.34,-0.08); tip.rotation.x=-0.3; tip.parent = g;
        } else if(acc.type==='cape'){
          const cm = accMat('cape', 0.85, 0);
          const w = acc.light ? 0.26 : 0.34, alpha = acc.light ? 0.85 : 1;
          const cape = cast(box('cape',w,0.58,0.03, cm)); cape.material.alpha = alpha;
          cape.position.set(0,0.92,-0.15); cape.rotation.x=0.2; cape.parent = g;
        } else if(acc.type==='crest'){
          const cm = accMat('crest', 0.35, 0.35);
          // Pointe vers le HAUT : base large (rb) posée sur la tête, sommet
          // fin (rt) — même logique rt/rb que hoodTip ci-dessus.
          const crest = cast(cyl('crest',0.008,0.05,0.19,6, cm)); crest.position.set(0,1.32,-0.02); crest.parent = g;
        } else if(acc.type==='shoulderSpikes'){
          const sm = accMat('spikes', 0.55, 0.2);
          const sides = acc.side==='both' ? [-1,1] : acc.side==='left' ? [-1] : [1];
          const count = acc.count||3;
          sides.forEach(sx=>{
            for(let i=0;i<count;i++){
              // Base large (rb, à l'épaule) → pointe fine (rt~0) qui se dresse.
              const spike = cast(cyl('spike',0,0.05-i*0.008,0.15-i*0.022,6, sm));
              spike.position.set(sx*0.29, 1.04+i*0.035, -0.03+i*0.035);
              spike.rotation.z = sx*0.55;
              spike.parent = g;
            }
          });
        } else if(acc.type==='shoulderPlate'){
          const pm = accMat('plate', 0.5, 0.25);
          const sx = acc.side==='left' ? -1 : 1;
          const plate = cast(sph('shoulderPlate',0.15,7, pm)); plate.scaling.set(1,0.65,1);
          plate.position.set(sx*0.29,1.03,0); plate.parent = g;
        } else if(acc.type==='chestEmblem'){
          const em = accMat('emblem', 0.3, 0.4);
          const emblem = cast(box('chestEmblem',0.1,0.1,0.02, em)); emblem.position.set(0,0.88,0.175); emblem.castShadow=false; emblem.parent = g;
        }
      });
    }
    // Arme tenue devant — plusieurs pièces (corps/crosse/chargeur/poignée
    // avant) au lieu d'une seule boîte plate, silhouette ajustée au vrai
    // palier d'achat une fois le premier achat résolu (voir
    // updateWeaponMesh/buildGunGroup, appelées depuis decideBuyForAgent).
    const gun = new BABYLON.TransformNode('gun', scene); gun.position.set(0.16,0.78,0.36); gun.parent = g;
    this._gunMat = gunMat;
    // Anneau de contact au sol (repère visuel sous les pieds)
    // (RingGeometry n'existe pas dans Babylon : approché par un tore fin,
    // déjà à plat dans le plan XZ — le rotation.x=-PI/2 d'origine, qui ne
    // servait qu'à coucher l'anneau de Three, n'a plus lieu d'être.)
    const ring = BABYLON.MeshBuilder.CreateTorus('ring', {diameter:0.92, thickness:0.08, tessellation:20}, scene);
    ring.material = mkUnlitMat('ringMat', teamColor, { doubleSided:true });
    ring.position.y=0.03; ring.parent = g;
    // Barre de vie flottante (fond fixe + barre colorée dont la largeur
    // suit hp/maxHp, mise à jour chaque frame dans syncMesh) — indicateur
    // d'état visible directement sur le personnage, au-delà du scoreboard
    // latéral déjà existant. Plans billboardés (voir mkSpritePlane) plutôt
    // qu'une texture canvas : un simple scaling à chaque coup encaissé,
    // jamais de regénération coûteuse.
    const hpBg = mkSpritePlane('hpBg', 0.62, 0.09, scene);
    hpBg.material = mkUnlitMat('hpBgMat', 0x14171c, { opacity:0.85, depthWrite:false });
    hpBg.position.y=1.98; hpBg.alphaIndex=996; hpBg.parent = g;
    const hpFg = mkSpritePlane('hpFg', 0.58, 0.06, scene);
    hpFg.material = mkUnlitMat('hpFgMat', 0x4ecd6a, { depthWrite:false });
    hpFg.position.set(0,1.98,0.001); hpFg.alphaIndex=997; hpFg.parent = g;
    // Pastille d'armure (visible seulement si l'agent a un gilet ce round)
    const armorPip = mkSpritePlane('armorPip', 0.12, 0.12, scene);
    armorPip.material = mkUnlitMat('armorPipMat', 0x5aa8ff, { depthWrite:false });
    armorPip.position.set(0.36,1.98,0.001); armorPip.alphaIndex=997; armorPip.setEnabled(false); armorPip.parent = g;
    this._mat=mat; this._accentMat=accentMat; this._ring=ring; this._torso=torso;
    this._fadeMats=[mat,accentMat,shirtMat,vestMat,pantsMat]; // tenue complète, pour le fondu à la mort (voir syncMesh)
    this._legL=legPivotL; this._legR=legPivotR; this._gun=gun; this._gunRestZ=0.36;
    this._hpFg=hpFg; this._hpFgBaseW=0.58; this._armorPip=armorPip;
    this.updateWeaponMesh();
    pruneSmallShadowCasters(g);
    return g;
  }
  // Ajuste la silhouette de l'arme tenue selon le palier d'achat RÉEL
  // (this.weapon.tierRank, voir NEXUS_WEAPONS/decideBuyForAgent) au lieu
  // de la même boîte grise pour tout le monde — pistolet court, fusil
  // moyen, arme lourde longue. Reconstruit désormais plusieurs pièces
  // (corps/chargeur/crosse/poignée avant/canon selon le palier) au lieu
  // de redimensionner une seule boîte plate.
  updateWeaponMesh(){
    if(!this._gun) return;
    this._gun.getChildren().slice().forEach(c=> c.dispose());
    const tierRank = (this.weapon && this.weapon.tierRank) || 0;
    const len = tierRank>=3 ? 0.5 : tierRank>=1 ? 0.34 : 0.2;
    const thick = tierRank>=3 ? 0.075 : tierRank>=1 ? 0.065 : 0.05;
    const gm = this._gunMat;
    const body = BABYLON.MeshBuilder.CreateBox('gunBody', {width:thick, height:thick+0.015, depth:len}, scene); body.material = gm; body.castShadow=true; body.parent = this._gun;
    const mag = BABYLON.MeshBuilder.CreateBox('gunMag', {width:thick*0.55, height:tierRank>=1?0.16:0.09, depth:thick*0.6}, scene); mag.material = gm;
    mag.position.set(0,-(thick+0.015)/2-(tierRank>=1?0.08:0.045),len*0.1); mag.rotation.x = tierRank>=1?0.15:0; mag.parent = this._gun;
    if(tierRank>=1){
      const stock = BABYLON.MeshBuilder.CreateBox('gunStock', {width:thick*0.7, height:thick*0.9, depth:0.14}, scene); stock.material = gm; stock.position.z=-len/2-0.06; stock.parent = this._gun;
      const grip = BABYLON.MeshBuilder.CreateBox('gunGrip', {width:thick*0.5, height:0.1, depth:thick*0.5}, scene); grip.material = gm; grip.position.set(0,-(thick+0.015)/2-0.05,len*0.32); grip.rotation.x=-0.3; grip.parent = this._gun;
    }
    if(tierRank>=3){
      const barrel = BABYLON.MeshBuilder.CreateCylinder('gunBarrel', {diameterTop:thick*0.44, diameterBottom:thick*0.44, height:0.16, tessellation:6}, scene); barrel.material = gm; barrel.rotation.x=Math.PI/2; barrel.position.z=len/2+0.08; barrel.parent = this._gun;
    }
    this._gunRestZ = 0.2 + len/2 + (tierRank>=3?0.05:0);
    this._gun.position.z = this._gunRestZ;
    pruneSmallShadowCasters(this._gun);
    finalizeShadowCasters(this._gun); // ré-enregistre les nouvelles pièces d'arme après un changement de palier d'achat (les anciennes ont été dispose()es, voir plus haut)
  }
  updateTag(){
    if(this._tag){ g_remove(this.mesh,this._tag); }
    const t = mkNameTag(this.name, this.tagColor, this.team && this.team.tag); t.position.y=1.7; t.parent = this.mesh; this._tag=t;
  }
  setColor(hex){
    // .albedoColor, pas .diffuseColor : mkStdMat construit du PBRMaterial
    // depuis la Phase 4 (voir mkStdMat) — .diffuseColor y est une propriété
    // morte (aucune erreur, mais aucun effet non plus), ce qui cassait
    // silencieusement la remise à la couleur d'équipe au respawn.
    this._mat.albedoColor = hexToColor3(hex);
    this._ring.material.emissiveColor = hexToColor3(hex);
    this._accentMat.albedoColor = hexToColor3(hex).scale(0.42);
  }
  // Anime marche/recul de tir/mort à partir de l'état déjà suivi
  // (speed/lastShotAt/alive) — aucun squelette/rig, cohérent avec le
  // style low-poly composé de primitives, juste des rotations/décalages
  // calculés directement à chaque frame.
  syncMesh(){
    this.mesh.position.set(this.pos.x,0,this.pos.z);
    this.mesh.rotation.y = this.facing;
    if(this._hpFg){
      const frac = Math.max(0, Math.min(1, this.hp/this.maxHp));
      // Le plan de la barre est déjà créé à sa largeur réelle (_hpFgBaseW) :
      // scaling est un FACTEUR, là où le scale d'un Sprite Three était une
      // largeur absolue — on divise donc par la largeur de base pour
      // retrouver exactement la même largeur à l'écran (plancher compris).
      this._hpFg.scaling.x = Math.max(0.01, this._hpFgBaseW*frac)/this._hpFgBaseW;
      this._hpFg.position.x = -this._hpFgBaseW*(1-frac)/2;
      this._hpFg.material.emissiveColor = hexToColor3(frac>0.5?0x4ecd6a:frac>0.25?0xe0b23c:0xe05a4c);
    }
    if(this._armorPip) this._armorPip.setEnabled(!!this.armor && this.alive);
    if(!this.alive){
      // Mort : bascule progressive vers le sol + fondu, plutôt qu'une
      // disparition instantanée (voir CombatSystem.tryShoot, qui pose
      // _deathAnimStart au lieu de couper mesh.visible directement).
      if(this._deathAnimStart!=null){
        const t = Math.min(1, (SimClock.now()-this._deathAnimStart)/0.6);
        this.mesh.setEnabled(true);
        this.mesh.rotation.x = t*(Math.PI/2.4);
        if(!this._deathFadeOn){ this._deathFadeOn=true; } // Babylon bascule seul en mélange alpha dès que material.alpha < 1
        const op = Math.max(0, 1-t*1.15); this._fadeMats.forEach(m=> m.alpha=op);
        if(t>=1) this.mesh.setEnabled(false);
      } else {
        this.mesh.setEnabled(false);
      }
      if(this._tag) this._tag.setEnabled(false);
      return;
    }
    this.mesh.setEnabled(true);
    if(this._tag) this._tag.setEnabled(true);
    // Marche : jambes en balancier selon la vitesse réelle, pose neutre
    // à l'arrêt (this.speed déjà mis à jour par le pathfinding).
    if(this._legL && this._legR){
      if(this.speed>0.05){
        const phase = SimClock.now()*this.speed*3.2;
        this._legL.rotation.x = Math.sin(phase)*0.55;
        this._legR.rotation.x = -Math.sin(phase)*0.55;
      } else {
        this._legL.rotation.x = 0; this._legR.rotation.x = 0;
      }
    }
    // Recul de tir : this.lastShotAt existe déjà (mis à jour à CHAQUE tir
    // tenté, touché ou non, voir CombatSystem.tryShoot) — décale l'arme
    // brièvement vers l'arrière puis relâche, sans nouvel état à ajouter.
    if(this._gun){
      const sinceShot = SimClock.now()-this.lastShotAt;
      this._gun.position.z = sinceShot<0.12 ? this._gunRestZ-(0.12-sinceShot)/0.12*0.09 : this._gunRestZ;
    }
  }
  respawn(spawnPt){
    this._roundDamageTaken = {}; // nouvelle vie = plus aucun dégât "en attente" pour le calcul d'assist
    this.hp=this.maxHp; this.alive=true; this.state='IDLE'; this.speed=0;
    this.path=null; this.targetEnemy=null; this.destination=null; this.lastEngagedTargetId=null; this.blindedUntil=-Infinity;
    this.rootedUntil=-Infinity; this.aimMultUntil=-Infinity; this.aimMult=1;
    this.ownedAbilities={ a:false, b:false }; // sorts A/B rachetés chaque round — jamais conservés d'un round à l'autre
    this.holdSince=null; this.holdLimit=rand(3,7);
    const safe = pushOutOfObstacles({x:spawnPt.x,z:spawnPt.z});
    this.pos.x=safe.x; this.pos.z=safe.z;
    this.setColor(this.side==='ATTACK'?0xff5f5f:0x4ecd6a);
    // Efface toute trace de l'animation de mort de la vie précédente
    // (inclinaison + fondu) — sinon elle resterait visible à cette vie.
    this._deathAnimStart = null;
    this.mesh.rotation.x = 0;
    if(this._deathFadeOn){ this._fadeMats.forEach(m=>{ m.alpha=1; }); this._deathFadeOn=false; }
    this.mesh.scaling.set(1,1,1);
    this.syncMesh();
  }
  goTo(nodeIdx){
    const fromIdx = nearestNode(this.pos);
    const raw = findPath(fromIdx, nodeIdx);
    this.path = raw; this.pathLen = pathLength(raw); this.pathDist = 0;
    this.destination = floorNodes[nodeIdx];
    if(this.state!=='COMBAT') this.state='MOVING';
  }
}
function g_remove(group, obj){ obj.parent = null; if(obj.material){ if(obj.material.diffuseTexture) obj.material.diffuseTexture.dispose(); obj.material.dispose(); } obj.dispose(); }

/* ============================================================
   MODULE: MEMOIRE TACTIQUE / DUELS — historique des confrontations et
   mécanique de revanche : si A élimine B, B priorise activement A lors
   des engagements suivants (dès son prochain respawn).
   ============================================================ */
const DuelMemory = {
  history: [],  // {killerId, victimId, round, weapon}
  recordKill(killer, victim, round){
    this.history.push({ killerId:killer.id, victimId:victim.id, round });
    // La victime cherchera sa revanche dès son prochain round.
    victim.revengeTargetId = killer.id;
  },
  clearRevengeIfTargetGone(agent, allAgents){
    if(agent.revengeTargetId){
      const t = allAgents.find(a=>a.id===agent.revengeTargetId);
      if(!t || !t.alive) { /* garde la cible en mémoire même si morte ce round-ci : la revanche vise le prochain live du tueur */ }
    }
  },
  h2h(aId,bId){
    const aKills = this.history.filter(h=>h.killerId===aId && h.victimId===bId).length;
    const bKills = this.history.filter(h=>h.killerId===bId && h.victimId===aId).length;
    return { aKills, bKills };
  }
};

/* ============================================================
   MODULE: COMMUNICATION — les agents partagent l'information avec leur
   équipe (repérages, spike vu, zone libre) plutôt que d'avoir une
   connaissance omnisciente de la position adverse.
   ============================================================ */
class TeamBlackboard{
  constructor(){ this.messages = []; }
  clear(){ this.messages = []; }
  report(fromAgent, type, data){ this.messages.push({ from:fromAgent.id, type, data, t: SimClock.now() }); }
  recentEnemySightings(withinSec=6){
    const now = SimClock.now();
    return this.messages.filter(m=> m.type==='ENEMY_SEEN' && now-m.t < withinSec);
  }
}

/* ============================================================
   Horloge de simulation (indépendante du framerate, pilotable en
   vitesse x1/x2/x4/x8).
   ============================================================ */
const SimClock = {
  t: 0, speed: 1, running: false,
  now(){ return this.t; },
  tick(dtReal){ if(this.running) this.t += dtReal*this.speed; },
};
// Vrai lors d'un "Passer le round"/"Simuler le match" (voir plus bas) :
// raccourcit le délai réel entre deux rounds dans endRound() — sinon
// "Simuler le match" resterait bloqué ~2s par round sur ce setTimeout.
let ffMode = false;

/* ============================================================
   MODULE: COMBAT — duels réels (pas de "aléatoire pur") : la chance de
   toucher dépend de l'aim, de la distance, du mouvement du tireur et de
   sa cible, et de la réaction. Chaque tir produit un traceur visible
   (touché ou manqué) pour bien suivre les échanges à l'écran.
   ============================================================ */
function spawnTracer(p1, p2, hit){
  const line = BABYLON.MeshBuilder.CreateLines('tracer', {points:[ new BABYLON.Vector3(p1.x,1.15,p1.z), new BABYLON.Vector3(p2.x,1.15,p2.z) ]}, scene);
  // LineBasicMaterial n'a pas d'équivalent : un mesh Lines porte sa couleur
  // et son opacité directement, sans matériau intermédiaire.
  line.color = hexToColor3(hit?0xffe27a:0xffffff); line.alpha = 0.95;
  let t=0; const anim=()=>{ t+=0.16; line.alpha=Math.max(0,0.95-t*1.3); if(t<0.7) requestAnimationFrame(anim); else line.dispose(); };
  anim();
}
function spawnHitFlash(p){
  const m = BABYLON.MeshBuilder.CreateSphere('hitFlash', {diameter:0.28, segments:8}, scene);
  m.material = mkUnlitMat('hitFlashMat', 0xff3b3b, { opacity:0.9 });
  m.position.set(p.x,1.15,p.z);
  let t=0; const anim=()=>{ t+=0.12; m.scaling.setAll(1+t*4); m.material.alpha=Math.max(0,0.9-t*1.5); if(t<0.6) requestAnimationFrame(anim); else m.dispose(); };
  anim();
}
/* ============================================================
   Marqueur de mort : croix au sol à l'endroit d'une élimination,
   effacée au round suivant. Le corps du joueur disparaît instantanément
   dès sa mort (cf. appel dans CombatSystem.tryShoot).
   ============================================================ */
const deathMarkers = [];
function spawnDeathMarker(pos, side){
  const color = side==='ATTACK' ? 0xff5f5f : 0x4ecd6a;
  const g = new BABYLON.TransformNode('deathMarker', scene);
  const barMat = mkUnlitMat('deathMarkerMat', color);
  const bar1 = BABYLON.MeshBuilder.CreateBox('deathBar1', {width:0.75, height:0.03, depth:0.13}, scene); bar1.material = barMat; bar1.rotation.y = Math.PI/4;
  const bar2 = BABYLON.MeshBuilder.CreateBox('deathBar2', {width:0.75, height:0.03, depth:0.13}, scene); bar2.material = barMat; bar2.rotation.y = -Math.PI/4;
  bar1.parent = g; bar2.parent = g;
  g.position.set(pos.x, 0.165, pos.z); // juste au-dessus de la dalle de sol (haut à y=0.15), posée dessus et non flottante
  deathMarkers.push(g);
}
function clearDeathMarkers(){
  deathMarkers.forEach(m=> m.dispose());
  deathMarkers.length = 0;
}
/* ============================================================
   Modèle de la spike posée : boîtier jaune + cœur rouge clignotant,
   visible dès la pose, retiré à la fin de la manche (désamorçage,
   explosion, ou début du round suivant).
   ============================================================ */
let spikeMesh = null;
function spawnSpikeMesh(pos){
  const g = new BABYLON.TransformNode('spike', scene);
  const body = BABYLON.MeshBuilder.CreateBox('spikeBody', {width:0.42, height:0.24, depth:0.3}, scene);
  body.material = mkStdMat('spikeBodyMat', 0xf4c430, { roughness:.35, metalness:.4 });
  body.position.y = 0.12; body.parent = g;
  const core = BABYLON.MeshBuilder.CreateSphere('spikeCore', {diameter:0.18, segments:8}, scene);
  core.material = mkUnlitMat('spikeCoreMat', 0xff2020);
  core.position.set(0,0.24,0.14); core.parent = g;
  const glow = new BABYLON.PointLight('spikeGlow', new BABYLON.Vector3(0,0,0), scene);
  glow.diffuse = hexToColor3(0xff2020); glow.intensity = 1.2; glow.range = 3.2;
  glow.position.set(0,0.3,0); glow.parent = g;
  g.position.set(pos.x, 0, pos.z);
  spikeMesh = { group:g, core, glow };
}
function removeSpikeMesh(){
  if(spikeMesh){ spikeMesh.group.dispose(); spikeMesh=null; }
}
function updateSpikeVisual(){
  if(!spikeMesh || !planted || !plantT) return;
  const remaining = PLANT_TIMER - (SimClock.now()-plantT);
  const freq = remaining<8 ? 6.5 : remaining<20 ? 3.2 : 1.4; // clignote plus vite à l'approche de l'explosion
  const on = Math.sin(SimClock.now()*freq*Math.PI*2) > 0;
  spikeMesh.core.setEnabled(on);
  spikeMesh.glow.intensity = on ? 1.3 : 0.15;
}
/* ============================================================
   MODULE: BARRIÈRE DE SPAWN — comme en vrai, chaque équipe reste
   immobilisée derrière une barrière translucide pendant les premières
   secondes du round (SETUP_TIME) au lieu de pouvoir partir prendre ses
   positions/angles dès l'instant du spawn — signalé par un joueur
   ("les défenseurs peuvent se balader pendant pour prendre des poses et
   angles"). Le blocage réel se fait côté simulation (tickRound ne fait
   avancer personne tant que phase==='SETUP', voir plus bas) ; ces murs
   ne sont que le retour visuel de cette immobilisation, posés aux deux
   points de spawn fixes de la carte (zones.zone_spawn_atk/_def).
   ============================================================ */
const SETUP_TIME = 10; // secondes, comme le temps de barrière en compétitif
// Rayon de la barrière : les agents peuvent bouger librement DEDANS
// (mise en place normale) mais ne peuvent pas le dépasser tant que la
// barrière est levée (voir le clamp dans tickRound) — même valeur que le
// mur bleu visuel ci-dessous, pour que ce qu'on voit corresponde
// exactement à ce qui bloque réellement le déplacement.
const SPAWN_BARRIER_RADIUS = 6.5;
let spawnBarriers = [];
function spawnBarrierMesh(pos){
  const g = new BABYLON.TransformNode('spawnBarrier', scene);
  const r = SPAWN_BARRIER_RADIUS, h = 3.2;
  const wall = BABYLON.MeshBuilder.CreateCylinder('barrierWall',
    {diameterTop:r*2, diameterBottom:r*2, height:h, tessellation:28, cap:BABYLON.Mesh.NO_CAP}, scene);
  wall.material = mkUnlitMat('barrierWallMat', 0x3fa9ff, { opacity:0.16, doubleSided:true, depthWrite:false });
  wall.position.y = h/2; wall.parent = g;
  // CreateTorus est déjà à plat dans le plan XZ : le rotation.x qui couchait
  // le TorusGeometry de Three n'a plus lieu d'être.
  const edgeTop = BABYLON.MeshBuilder.CreateTorus('barrierEdgeTop', {diameter:r*2, thickness:0.1, tessellation:40}, scene);
  edgeTop.material = mkUnlitMat('barrierEdgeTopMat', 0x6fc3ff, { opacity:0.85 });
  edgeTop.position.y = h; edgeTop.parent = g;
  const edgeBottom = edgeTop.clone('barrierEdgeBottom'); edgeBottom.material = edgeTop.material.clone('barrierEdgeBottomMat'); edgeBottom.position.y = 0; edgeBottom.parent = g;
  g.position.set(pos.x, 0, pos.z);
  return { group:g, wall };
}
function raiseSpawnBarriers(){
  lowerSpawnBarriers();
  const spAtk = zones.zone_spawn_atk, spDef = zones.zone_spawn_def;
  if(spAtk) spawnBarriers.push(spawnBarrierMesh(spAtk));
  if(spDef) spawnBarriers.push(spawnBarrierMesh(spDef));
}
function lowerSpawnBarriers(){
  spawnBarriers.forEach(b=> b.group.dispose());
  spawnBarriers = [];
}
// Léger effet de pulsation façon "champ de force" — appelée depuis
// animate() à chaque frame, no-op tant qu'aucune barrière n'est levée.
function updateSpawnBarriersVisual(){
  if(!spawnBarriers.length) return;
  const pulse = 0.5+0.5*Math.sin(SimClock.now()*3);
  spawnBarriers.forEach(b=>{ b.wall.material.alpha = 0.12+pulse*0.08; });
}
function spawnExplosion(pos){
  const g = new BABYLON.TransformNode('explosion', scene);
  const core = BABYLON.MeshBuilder.CreateSphere('explosionCore', {diameter:1.0, segments:12}, scene);
  core.material = mkUnlitMat('explosionCoreMat', 0xffcf4a, { opacity:0.95 });
  // RingGeometry -> tore fin (pas d'équivalent exact côté Babylon), déjà à
  // plat : le rotation.x=-Math.PI/2 d'origine n'a plus lieu d'être.
  const ring = BABYLON.MeshBuilder.CreateTorus('explosionRing', {diameter:0.4, thickness:0.2, tessellation:32}, scene);
  ring.material = mkUnlitMat('explosionRingMat', 0xff6a1f, { opacity:0.8, doubleSided:true });
  ring.position.y=0.05;
  core.parent = g; ring.parent = g;
  g.position.set(pos.x, 0.6, pos.z);
  let t=0;
  const anim=()=>{
    t+=0.05;
    core.scaling.setAll(1+t*10); core.material.alpha=Math.max(0,0.95-t*1.2);
    ring.scaling.setAll(1+t*14); ring.material.alpha=Math.max(0,0.8-t*1.0);
    if(t<1.0) requestAnimationFrame(anim); else g.dispose();
  };
  anim();
}
// Rayon de souffle : tout agent vivant encore présent autour de la spike
// au moment de l'explosion (attaquant en tenue trop proche compris, comme
// dans le vrai jeu) meurt.
const SPIKE_BLAST_RADIUS = 8;
function explodeSpike(){
  if(!spikePos) return;
  spawnExplosion(spikePos);
  [...teamA.agents, ...teamB.agents].forEach(a=>{
    if(!a.alive) return;
    if(Math.hypot(a.pos.x-spikePos.x, a.pos.z-spikePos.z) <= SPIKE_BLAST_RADIUS){
      a.hp=0; a.alive=false; a.state='DEAD'; a.deaths++;
      a._deathAnimStart = SimClock.now(); if(a._tag) a._tag.setEnabled(false);
      spawnDeathMarker(a.pos, a.side);
    }
  });
  removeSpikeMesh();
}
// Réflexe de prise de couvert : déclenché quand un agent survit à un tir
// venant d'un ennemi qu'il n'avait pas dans son champ de vision (tir dans
// le dos ou sur le flanc) — sans ça, il restait figé sans réagir tant que
// le tireur n'entrait pas naturellement dans son cône de vision. Cherche
// le nœud le plus proche qui casse la ligne de vue avec le tireur ; à
// défaut, recule dans la direction opposée au tir.
function reactToSurpriseDamage(target, shooter){
  const now = SimClock.now();
  // Anti-spam : un seul réflexe par courte fenêtre, pas un goTo() relancé
  // à chaque balle reçue pendant la même rafale.
  if(now - (target._lastCoverReact||-999) < 1.5) return;
  const dx = shooter.pos.x-target.pos.x, dz = shooter.pos.z-target.pos.z;
  const toShooter = Math.atan2(dx,dz);
  let diff = toShooter-target.facing; diff = Math.atan2(Math.sin(diff),Math.cos(diff));
  const shooterInFOV = Math.abs(diff) <= FOV/2;
  // Déjà engagé de face contre ce tireur précis : le duel normal (tryShoot
  // riposte, smoothFace vers la cible) suffit, pas besoin d'esquive.
  if(shooterInFOV && target.targetEnemy===shooter) return;

  target._lastCoverReact = now;
  const candidates = nearestNodes(target.pos, 14).filter(i=> !hasLineOfSight(shooter.pos, floorNodes[i]));
  let coverIdx = candidates.length ? candidates[0] : null;
  if(coverIdx===null){
    // Pas de couvert direct à portée : recule au moins en s'éloignant du tireur.
    const away = nearestNodes(target.pos, 20).map(i=>{
      const f = floorNodes[i];
      return { i, gain: Math.hypot(f.x-shooter.pos.x,f.z-shooter.pos.z) - Math.hypot(shooter.pos.x-target.pos.x,shooter.pos.z-target.pos.z) };
    }).sort((a,b)=>b.gain-a.gain);
    coverIdx = away.length ? away[0].i : null;
  }
  if(coverIdx!==null){
    target.goTo(coverIdx);
    target.state = 'MOVING';
  }
  // Se retourne partiellement vers la menace, pour avoir une chance de la
  // repérer et riposter au tick suivant plutôt que de tourner le dos en fuyant.
  smoothFace(target, toShooter, 0.5);
}
const CombatSystem = {
  tryShoot(shooter, target, round, onKill, isClutch){
    const now = SimClock.now();
    if(now - shooter.lastShotAt < shooter.weapon.rofMs/1000) return;
    shooter.lastShotAt = now;
    const dist = Math.hypot(shooter.pos.x-target.pos.x, shooter.pos.z-target.pos.z);
    if(dist > shooter.weapon.range) return;
    if(!hasLineOfSight(shooter.pos, target.pos)) return; // jamais de tir à travers un mur/objet

    // Premier tir d'un NOUVEL engagement (pas une rafale déjà en cours sur
    // la même cible) : c'est le pré-aim/l'anticipation qui joue, donc le
    // game sense — plus il est élevé, meilleure la précision de ce tir
    // d'ouverture précis.
    const isFirstShot = shooter.lastEngagedTargetId !== target.id;
    shooter.lastEngagedTargetId = target.id;

    // Chance de toucher : aim, distance, mouvement de la cible (plus dur
    // à toucher en mouvement), réaction du tireur, léger biais si le
    // tireur poursuit sa cible de revanche (concentration accrue), game
    // sense sur le tir d'ouverture, sang-froid (clutch) en situation 1vX.
    const aimFactor = shooter.stats.aim/100;
    const distFactor = clamp(1 - dist/shooter.weapon.range, 0.15, 1);
    const targetMoveFactor = target.speed>0.5 ? 0.78 : 1.0;
    const reactionFactor = 0.75 + (shooter.stats.reaction/100)*0.35;
    const revengeFocus = shooter.revengeTargetId===target.id ? 1.08 : 1.0;
    const gameSenseFactor = isFirstShot ? 1 + (shooter.stats.gameSense/100)*0.18 : 1.0;
    const clutchFactor = isClutch ? 0.88 + (shooter.stats.clutch/100)*0.22 : 1.0;
    // Sorts en vigueur (voir MODULE: UTILITAIRES) : précision réduite si
    // désorienté/sous debuff, amplifiée si un allié vient de buff.
    const spellAimMult = now < shooter.aimMultUntil ? shooter.aimMult : 1;
    const hitChance = clamp(0.32 + aimFactor*0.5*distFactor*targetMoveFactor*reactionFactor*revengeFocus*gameSenseFactor*clutchFactor*spellAimMult, 0.05, 0.93);

    const hit = Math.random() < hitChance;
    spawnTracer(shooter.pos, hit? {x:target.pos.x,z:target.pos.z} : {x:target.pos.x+rand(-1.6,1.6), z:target.pos.z+rand(-1.6,1.6)}, hit);
    if(!hit) return;

    spawnHitFlash(target.pos);
    const hsRoll = Math.random() < (0.12 + aimFactor*0.16);
    let dmg = hsRoll ? shooter.weapon.dmgHead : shooter.weapon.dmgBody;
    if(target.armor && !hsRoll) dmg *= 0.85; // l'armure amortit les tirs au corps, pas les headshots
    target.hp -= dmg;
    // Vraies stats de dégâts/HS (voir Agent.damageDealt/hitsTotal/hitsHead) —
    // tout tir touché compte, kill ou non, pour un ADR/HS% réels en fin de
    // match plutôt qu'une estimation basée sur les attributs du joueur.
    shooter.damageDealt += Math.min(dmg, target.hp+dmg); // jamais plus que les PV réellement retirés (dégâts "overkill" non comptés, comme en vrai)
    shooter.hitsTotal++;
    if(hsRoll) shooter.hitsHead++;
    target._roundDamageTaken[shooter.id] = (target._roundDamageTaken[shooter.id]||0) + dmg;
    if(target.hp <= 0){
      target.hp = 0; target.alive = false; target.state='DEAD';
      shooter.kills++; target.deaths++;
      // Assist : coéquipier du tueur (jamais lui-même) ayant infligé au
      // moins 50 dégâts à la cible pendant CETTE vie — seuil calqué sur la
      // vraie règle Valorant. N'existait jusqu'ici tout simplement pas :
      // .assists restait à 0 toute la partie, pour tout le monde.
      Object.keys(target._roundDamageTaken).forEach(attackerId=>{
        if(attackerId===shooter.id) return;
        if(target._roundDamageTaken[attackerId] < 50) return;
        const attacker = [...teamA.agents, ...teamB.agents].find(a=>a.id===attackerId);
        if(attacker && attacker.team===shooter.team){ attacker.assists++; attacker._roundAssists++; }
      });
      roundKillEvents.push({ killerId:shooter.id, victimId:target.id, time:SimClock.now() });
      shooter.credits = Math.min(NEXUS_MAX, shooter.credits + 200); // prime par élimination
      const wasRevenge = target.revengeTargetId === shooter.id;
      DuelMemory.recordKill(shooter, target, round);
      spawnDeathMarker(target.pos, target.side);
      // Le corps ne disparaît plus instantanément : bascule progressive
      // vers le sol + fondu, gérée frame par frame dans Agent.syncMesh à
      // partir de ce timestamp (voir _deathAnimStart).
      target._deathAnimStart = SimClock.now();
      if(target._tag) target._tag.setEnabled(false);
      onKill(shooter, target, hsRoll, wasRevenge);
    } else {
      reactToSurpriseDamage(target, shooter);
    }
  }
};

const ROUND_STRATEGIES = {
  RUSH_A:   { name:'Rush A',        sites:['A'],      intensity:'high' },
  RUSH_B:   { name:'Rush B',        sites:['B'],      intensity:'high' },
  DEFAULT:  { name:'Default',       sites:['A','B'],  intensity:'medium' },
  SPLIT_A:  { name:'Split A',       sites:['A'],      intensity:'medium', split:true },
  SPLIT_B:  { name:'Split B',       sites:['B'],      intensity:'medium', split:true },
  FAKE_A_B: { name:'Fake A → B',    sites:['A','B'],  intensity:'medium', fake:true },
  FAKE_B_A: { name:'Fake B → A',    sites:['B','A'],  intensity:'medium', fake:true },
  MID_CTRL: { name:'Prise mid',     sites:['A','B'],  intensity:'medium' },
};
class StrategyEngine{
  constructor(team){ this.team=team; this.history=[]; this.results={}; }
  select(roundNumber, economy, myScore, enemyScore, siteMemory, doctrine=0){
    const weights = {};
    Object.values(ROUND_STRATEGIES).forEach(strat=>{
      let w = 1.0;
      const lastThree = this.history.slice(-3);
      w *= Math.pow(0.55, lastThree.filter(s=>s===strat.name).length);
      const st = this.results[strat.name];
      if(st) w *= (0.5 + st.wins/(st.wins+st.losses+1));
      // Mémoire de site : si un site a été perdu 3x d'affilée récemment,
      // fortement réduire les stratégies qui le ciblent en priorité.
      strat.sites.forEach(site=>{
        const mem = siteMemory[site];
        if(mem && mem.recentLosses>=3) w *= 0.3;
      });
      const avgAgg = this.team.agents.reduce((s,a)=>s+a.stats.aggression,0)/this.team.agents.length;
      if(strat.intensity==='high' && avgAgg>62) w *= 1.35;
      if(strat.intensity==='medium' && avgAgg<=62) w *= 1.1;
      if(myScore===0 && enemyScore>=5 && strat.intensity==='high') w *= 1.3;
      // Doctrine d'entrée (-2 Exécutions travaillées..+2 Rush systématique,
      // voir VALORANT_DOCTRINES côté script.js) : vient S'AJOUTER au biais
      // agressivité ci-dessus, pas le remplacer — un vrai levier joueur sur
      // un système jusqu'ici 100% IA (aucune branche team.self n'existait).
      if(strat.intensity==='high') w *= (1 + doctrine*0.18);
      else w *= (1 - doctrine*0.10);
      if(strat.fake) w *= (1 + Math.max(0,-doctrine)*0.12); // doctrine prudente favorise un peu plus les faux-semblants
      weights[strat.name] = Math.max(0.08,w);
    });
    const entries = Object.entries(weights); const total = entries.reduce((s,[,w])=>s+w,0);
    let r = Math.random()*total; let chosen = ROUND_STRATEGIES.DEFAULT;
    for(const [name,w] of entries){ r -= w; if(r<=0){ chosen = Object.values(ROUND_STRATEGIES).find(s=>s.name===name); break; } }
    this.history.push(chosen.name); if(this.history.length>10) this.history.shift();
    if(!this.results[chosen.name]) this.results[chosen.name] = {wins:0,losses:0};
    return chosen;
  }
  recordResult(strategyName, won){
    if(!this.results[strategyName]) this.results[strategyName] = {wins:0,losses:0};
    this.results[strategyName][won?'wins':'losses']++;
  }
}

/* ============================================================
   MODULE: ÉCONOMIE — Nexus Protocol : phase d'achat en début de manche
   (armes/armure selon les crédits NX disponibles) et gains de NX en fin de
   manche (victoire, défaite avec prime de série de défaites, prime de pose
   de spike). Couvre les 7 paliers officiels Nexus Protocol : Pistol Round /
   Save / Eco / Semi Buy / Force Buy / Full Buy / Hyper Buy, avec
   l'arsenal complet (21 armes, noms 100% originaux) réparti par palier.
   ============================================================ */
const NEXUS_WEAPONS = {
  save:   { pool:['Striker-9'], cost:0,    tierRank:0, dmgBody:32, dmgHead:118, dmgLeg:24, rofMs:210, range:20 },
  pistol: { pool:['Striker-9'], cost:800,  tierRank:0, dmgBody:32, dmgHead:118, dmgLeg:24, rofMs:210, range:20 },
  eco:    { pool:['Vipereye','Cindermark','Apex-73'], cost:1500, tierRank:1, dmgBody:22, dmgHead:66,  dmgLeg:16, rofMs:130, range:16 },
  semi:   { pool:['Rapidfang','Glidewhisper','Duskcaster','Nervegun','Havoc Breaker','Cindersweep','Ruinmaw'], cost:3000, tierRank:2, dmgBody:27, dmgHead:82,  dmgLeg:22, rofMs:88,  range:27 },
  force:  { pool:['Bramblecoil','Solace-7','Rapidfang','Nervegun','Ruinmaw'], cost:4200, tierRank:2, dmgBody:30, dmgHead:100, dmgLeg:23, rofMs:150, range:24 },
  full:   { pool:['Kinetic Surge','Ashborne','Northlight','Longshadow','Halfmoon'], cost:6300, tierRank:3, dmgBody:39, dmgHead:160, dmgLeg:29, rofMs:180, range:44 },
  hyper:  { pool:['Kinetic Surge','Northlight','Voidline','Juggernaut Array','Devastator Prime'], cost:9800, tierRank:4, dmgBody:44, dmgHead:175, dmgLeg:32, rofMs:165, range:48 },
};
const NEXUS_BUY_LABELS = { pistol:'PISTOL ROUND', eco:'ECO', save:'SAVE', semi:'SEMI BUY', force:'FORCE BUY', full:'FULL BUY', hyper:'HYPER BUY' };
const NEXUS_MAX = 15000;
const ARMOR_COST = 1000;
function pickNexusWeapon(tierKey){
  const t = NEXUS_WEAPONS[tierKey];
  const name = t.pool[Math.floor(Math.random()*t.pool.length)];
  return { name, dmgBody:t.dmgBody, dmgHead:t.dmgHead, dmgLeg:t.dmgLeg, rofMs:t.rofMs, range:t.range, tierRank:t.tierRank };
}
// Achat individuel : chaque joueur a sa propre banque NX et décide seul selon
// SES crédits (comme en vrai — deux coéquipiers peuvent avoir des achats
// différents après une manche où l'un a plus fraggé que l'autre).
// doctrine (-2 Économe..+2 Opportuniste, voir VALORANT_DOCTRINES côté
// script.js, transmis via matchInit → team.ecoDoctrine) décale le palier
// d'achat choisi SANS changer les crédits réellement dépensés plus bas —
// Opportuniste force-buy avec moins de crédits en poche, Économe reste en
// retrait plus longtemps même en ayant largement de quoi.
function decideBuyForAgent(agent, doctrine=0){
  const c = agent.credits;
  const shifted = c + doctrine*400;
  let tier;
  if(shifted>=9800) tier='hyper';
  else if(shifted>=6300) tier='full';
  else if(shifted>=4200) tier='force';
  else if(shifted>=3000) tier='semi';
  else if(shifted>=1500) tier='eco';
  else if(shifted>=800) tier='pistol';
  else tier='save';
  // Conservation des armes (SAVE) : si l'équipement déjà en main est au
  // moins du niveau de ce que ce palier achèterait, l'agent économise sa
  // trésorerie NX plutôt que de racheter inutilement.
  const carriedRank = agent.weapon ? (agent.weapon.tierRank||0) : 0;
  if(tier!=='save' && agent.weapon && agent.weapon.name!=='Striker-9' && carriedRank>=NEXUS_WEAPONS[tier].tierRank){
    tier='save';
  }
  const cost = tier==='save' ? 0 : NEXUS_WEAPONS[tier].cost;
  const canArmor = c - cost >= ARMOR_COST;
  agent.credits = Math.max(0, c - cost - (canArmor?ARMOR_COST:0));
  if(tier!=='save') agent.weapon = pickNexusWeapon(tier);
  agent.armor = canArmor; agent.buyType = NEXUS_BUY_LABELS[tier];
  agent.updateWeaponMesh(); // silhouette de l'arme tenue à jour (voir Agent.updateWeaponMesh)
  buyAbilitiesForAgent(agent);
  return agent.buyType;
}
// Coût réel (patché) du sort A/B, tel qu'envoyé par le manager (voir
// playerToAIKit) — null si ce sort n'a pas de stat "Coût" (signature à
// recharge, ultime à points).
function abilityCost(ability){
  return (ability && ability.stats && typeof ability.stats['Coût']==='number') ? ability.stats['Coût'] : null;
}
// Achète les sorts A/B avec ce qu'il reste de trésorerie APRÈS arme+armure
// (même pool NX que le reste, comme en vrai) — la moins chère d'abord, pour
// repartir avec au moins un sort plutôt qu'aucun quand le budget est juste.
function buyAbilitiesForAgent(agent){
  if(!agent.kit) return;
  const candidates = ['a','b'].map(key=>({ key, cost: abilityCost(agent.kit[key]) })).filter(c=>c.cost!=null);
  candidates.sort((x,y)=>x.cost-y.cost);
  candidates.forEach(c=>{
    if(agent.credits>=c.cost){ agent.credits -= c.cost; agent.ownedAbilities[c.key] = true; }
  });
}
function syncTeamEconomy(team){ team.economy = team.agents.reduce((s,a)=>s+a.credits,0); }
function decideBuy(team){
  team.agents.forEach(a=> decideBuyForAgent(a, team.ecoDoctrine||0));
  // Type d'achat affiché au niveau équipe = le plus fréquent chez ses joueurs.
  const counts = {};
  team.agents.forEach(a=>{ counts[a.buyType]=(counts[a.buyType]||0)+1; });
  team.buyType = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
  syncTeamEconomy(team);
  return team.buyType;
}
// Gains de crédits de fin de manche : victoire, défaite (avec prime de
// série de défaites, plafonnée), et prime de pose pour l'attaque même en
// cas de défaite (règle officielle). Répartis à chaque joueur individuellement.
function awardEconomy(winningTeam, losingTeam, spikePlanted){
  winningTeam.agents.forEach(a=> a.credits = Math.min(NEXUS_MAX, a.credits + 3000));
  winningTeam.lossStreak = 0;
  losingTeam.lossStreak = (losingTeam.lossStreak||0) + 1;
  const lossBonus = Math.min(2400, 1900 + (losingTeam.lossStreak-1)*500);
  losingTeam.agents.forEach(a=> a.credits = Math.min(NEXUS_MAX, a.credits + lossBonus));
  // Prime de pose : l'attaque la touche même en perdant la manche (désamorçage) —
  // pas si elle gagne, ce qui serait déjà récompensé par le bonus de victoire.
  if(spikePlanted && losingTeam===attackTeam) attackTeam.agents.forEach(a=> a.credits = Math.min(NEXUS_MAX, a.credits + 300));
  syncTeamEconomy(winningTeam); syncTeamEconomy(losingTeam);
}

/* ============================================================
   MODULE: TEAM
   ============================================================ */
class Team{
  // statsOverrides (optionnel) : tableau parallèle à `names`, une entrée
  // {role, stats} par joueur — stats déjà à l'échelle 0-99 (aim, reaction,
  // gameSense, aggression, discipline, communication, clutch, utility).
  // Fourni par le manager (script.js) via le message 'matchInit' pour que
  // le niveau réel du roster pèse sur la simulation ; sans lui, on retombe
  // sur les rôles fixes ROLES + stats aléatoires (genStats) comme avant.
  constructor(name, side, names, statsOverrides, tag){
    this.name=name; this.side=side;
    this.tag = tag || deriveTeamTagLocal(name);
    this.agents = names.map((n,i)=>{
      const ov = statsOverrides && statsOverrides[i];
      return new Agent(`${side}_${i}`, n, (ov&&ov.role)||ROLES[i], side, this, ov&&ov.stats, ov&&ov.kit);
    });
    this.strategy = new StrategyEngine(this);
    this.blackboard = new TeamBlackboard();
    this.siteMemory = { A:{recentLosses:0}, B:{recentLosses:0} };
    this.economy = this.agents.reduce((s,a)=>s+a.credits,0); // pistol round (800 NX/joueur), agrégé pour l'affichage équipe
    this.lossStreak = 0;
    this.buyType = null;
    this.currentStrategy = null;
    // Time-Out réglementaire (voir MODULE: TIME-OUT) : 1 par side, jamais
    // régénéré (swapSides() change .side mais ne touche pas ce budget —
    // "1 par side" veut dire pour toute la moitié jouée sur ce side, pas
    // par round), + 1 unique pour toute l'overtime (round>24), partagé
    // quel que soit le side joué en OT.
    this.timeoutsBySide = { ATTACK:1, DEFENSE:1 };
    this.timeoutsOT = 1;
    this.lastTimeoutRound = -999; // anti-spam IA (voir maybeCallAiTimeout)
  }
  alive(){ return this.agents.filter(a=>a.alive); }
}

/* ============================================================
   MODULE: DÉCISION / MOUVEMENT / VISION / COMBAT — appelé à chaque tick
   pour chaque agent vivant. Rassemble : NAVIGATION (chemin réel, jamais
   de ligne droite/téléport), VISION (FOV+LOS), COMMUNICATION (partage
   d'info via blackboard), DUELS (priorité de cible incl. revanche),
   POST-PLANT / CLUTCH (comportements spéciaux), ANIMATION (rotation
   fluide, accélération/décélération).
   ============================================================ */
const FOV = Math.PI*0.78, VIEW_DIST = 38;

function visibleEnemiesOf(agent, enemyTeam){
  const out = [];
  if(agent.blindedUntil > SimClock.now()) return out; // aveuglé par un flash : ne voit rien tant que ça dure
  for(const e of enemyTeam.agents){
    if(!e.alive) continue;
    const dx=e.pos.x-agent.pos.x, dz=e.pos.z-agent.pos.z, dist=Math.hypot(dx,dz);
    if(dist>VIEW_DIST) continue;
    const toEnemy = Math.atan2(dx,dz);
    let diff = toEnemy-agent.facing; diff = Math.atan2(Math.sin(diff),Math.cos(diff));
    if(Math.abs(diff) > FOV/2) continue;
    if(!hasLineOfSight(agent.pos,e.pos)) continue;
    out.push({ agent:e, dist });
  }
  return out;
}

function pickTarget(agent, visible){
  if(!visible.length) return null;
  // Revanche : si la cible de revanche est visible, elle est priorisée
  // très fortement (agressivité/priorité ciblée envers cet adversaire).
  const revenge = agent.revengeTargetId && visible.find(v=>v.agent.id===agent.revengeTargetId);
  if(revenge && Math.random() < 0.85) return revenge.agent;
  // Sinon : le plus proche, avec une part d'agressivité (les joueurs
  // agressifs challengent plus volontiers un duel à portée moyenne).
  visible.sort((a,b)=>a.dist-b.dist);
  const aggr = agent.stats.aggression/100;
  const idx = (Math.random() < aggr*0.4) ? Math.min(visible.length-1, Math.floor(Math.random()*2)) : 0;
  return visible[idx].agent;
}

function smoothFace(agent, targetYaw, turnSpeed){
  let diff = targetYaw-agent.facing; diff = Math.atan2(Math.sin(diff),Math.cos(diff));
  agent.facing += diff*turnSpeed;
}

// Légère répulsion entre coéquipiers/adversaires trop proches : la
// navigation seule peut faire coïncider deux destinations voisines, ce qui
// ferait sinon superposer littéralement deux modèles au même endroit.
const AGENT_SEPARATION_DIST = 0.75;
function separateAgents(dt){
  const alive = [...teamA.agents, ...teamB.agents].filter(a=>a.alive);
  for(let i=0;i<alive.length;i++) for(let j=i+1;j<alive.length;j++){
    const a=alive[i], b=alive[j];
    const dx=b.pos.x-a.pos.x, dz=b.pos.z-a.pos.z, d=Math.hypot(dx,dz);
    if(d>=AGENT_SEPARATION_DIST || d<0.001) continue;
    const push = (AGENT_SEPARATION_DIST-d)*0.5*clamp(dt*6,0,1);
    const nx=dx/d, nz=dz/d;
    const pa = pushOutOfObstacles({x:a.pos.x-nx*push, z:a.pos.z-nz*push});
    const pb = pushOutOfObstacles({x:b.pos.x+nx*push, z:b.pos.z+nz*push});
    a.pos.x=pa.x; a.pos.z=pa.z; b.pos.x=pb.x; b.pos.z=pb.z;
  }
}

function tickAgent(agent, myTeam, enemyTeam, ctx, dt){
  // Un agent mort ressortait immédiatement ici, AVANT tout appel à
  // syncMesh() — l'animation de mort (bascule + fondu, voir syncMesh)
  // n'était donc jamais rejouée frame par frame et le corps restait figé
  // tel qu'il était juste avant de mourir (signalé : "le corps reste
  // affiché"). syncMesh() gère déjà correctement les deux cas (vivant/
  // mort), on peut donc l'appeler ici sans condition avant de sortir.
  if(!agent.alive){ agent.syncMesh(); return; }

  // ---- CANAL POSE / DÉSAMORÇAGE : verrouillé sur l'action, comme dans le
  // vrai jeu — ne tire pas, ne bouge pas, pendant que la spike est posée ou
  // désamorcée (mais reste une cible normale pour l'adversaire).
  if(agent===plantingAgent || agent===defusingAgent){
    agent.speed = 0; agent.targetEnemy = null;
    agent.syncMesh();
    return;
  }

  // ---- ÉTOURDI/IMMOBILISÉ (voir MODULE: UTILITAIRES) : ne bouge pas, ne
  // tire pas, mais reste une cible normale — comme la pose/désamorçage.
  if(agent.rootedUntil > SimClock.now()){
    agent.speed = 0; agent.targetEnemy = null;
    agent.syncMesh();
    return;
  }

  // ---- VISION + COMMUNICATION ----
  const visible = visibleEnemiesOf(agent, enemyTeam);
  if(visible.length){
    myTeam.blackboard.report(agent, 'ENEMY_SEEN', { count:visible.length, x:agent.pos.x, z:agent.pos.z });
  }

  // ---- DUELS : sélection de cible (incl. revanche) ----
  if(visible.length){
    agent.targetEnemy = pickTarget(agent, visible);
    agent.state = 'COMBAT';
  } else if(agent.state==='COMBAT'){
    agent.targetEnemy = null;
    agent.state = agent.path ? 'MOVING' : 'IDLE';
  }

  // ---- CLUTCH : 1vX — priorise la temporisation/l'isolement des duels ----
  const aliveMine = myTeam.alive().length;
  const aliveEnemy = enemyTeam.alive().length;
  const isClutch = aliveMine===1 && aliveEnemy>=2;

  if(agent.state==='COMBAT' && agent.targetEnemy && agent.targetEnemy.alive){
    const dx=agent.targetEnemy.pos.x-agent.pos.x, dz=agent.targetEnemy.pos.z-agent.pos.z;
    smoothFace(agent, Math.atan2(dx,dz), clamp(0.12+agent.stats.reaction/400,0.1,0.35));
    // En clutch, un joueur discipliné temporise plutôt que de challenger tout de suite.
    const holdBack = isClutch && agent.stats.discipline>60 && Math.random()<0.4;
    if(!holdBack) CombatSystem.tryShoot(agent, agent.targetEnemy, ctx.round, ctx.onKill, isClutch);
    agent.speed *= 0.85; // ralentit en duel (ANIMATION : jamais robotique)
  } else {
    // ---- NAVIGATION : suit strictement le chemin sur le graphe réel ----
    if(agent.path && agent.pathDist < agent.pathLen){
      // Piège Sentinel adverse (voir MODULE: UTILITAIRES) : ralentit la
      // vitesse de croisière visée, pas juste la position instantanée —
      // l'agent reste ralenti tant qu'il traverse la zone.
      const targetSpeed = agent.maxSpeed * (agent.state==='HOLD' ? 0 : 1) * trapSlowFactorFor(agent, myTeam); // POSTPLANT doit encore rejoindre sa position de tenue, pas rester figé au point du plant
      agent.speed += (targetSpeed-agent.speed)*clamp(dt*2.2,0,1); // accélère/décélère, jamais de saut de vitesse
      agent.pathDist = Math.min(agent.pathLen, agent.pathDist + agent.speed*dt);
      const pt = pointAlongPath(agent.path, agent.pathDist);
      const ahead = pointAlongPath(agent.path, Math.min(agent.pathLen, agent.pathDist+0.4));
      const dx=ahead.x-pt.x, dz=ahead.z-pt.z;
      if(Math.hypot(dx,dz)>0.01) smoothFace(agent, Math.atan2(dx,dz), 0.14);
      const safe = pushOutOfObstacles({x:pt.x,z:pt.z});
      agent.pos.x = safe.x; agent.pos.z = safe.z;
      if(agent.pathDist>=agent.pathLen){ agent.speed=0; if(agent.state==='MOVING'||agent.state==='RETAKE') agent.state='HOLD'; }
    } else {
      // Pas de chemin exploitable (arrivé, ou repli sur place suite à un
      // graphe disjoint côté findPath) : sortir de MOVING/RETAKE pour que
      // l'anti-camp puisse le rediriger, sinon il reste figé indéfiniment
      // (ex. un défenseur en tenue post-plant qui n'atteint jamais son
      // point de retake assigné).
      agent.speed *= 0.8;
      if(agent.state==='MOVING'||agent.state==='RETAKE') agent.state='HOLD';
    }
  }

  // ---- ANTI-CAMP : une pause pour tenir un angle reste normale, mais un
  // joueur ne doit jamais rester figé indéfiniment au même endroit — passé
  // un délai (variable par joueur), il se repositionne légèrement.
  if((agent.state==='HOLD' || agent.state==='IDLE') && !agent.targetEnemy){
    if(agent.holdSince===null) agent.holdSince = SimClock.now();
    else if(SimClock.now()-agent.holdSince > agent.holdLimit){
      const around = nearestNodes(agent.pos,12).filter(i=>{
        const f=floorNodes[i], d=Math.hypot(f.x-agent.pos.x,f.z-agent.pos.z);
        return d>1.8 && d<7;
      });
      if(around.length) agent.goTo(around[Math.floor(Math.random()*around.length)]);
      agent.holdSince = SimClock.now(); agent.holdLimit = rand(3,7);
    }
  } else {
    agent.holdSince = null;
  }

  agent.syncMesh();
}

/* ============================================================
   MODULE: ROTATIONS DÉFENSIVES — jamais instantanées : un défenseur
   qui rejoint l'autre site parcourt physiquement le chemin réel.
   ============================================================ */
function maybeRotateDefenders(defTeam, ctx){
  if(ctx.rotationTriggered) return;
  // Communication d'équipe : une bonne com fait confiance à UN seul call
  // fiable pour lancer la rotation, une mauvaise com attend confirmation
  // (un 2e call) avant de bouger — même info dispo, réaction plus lente.
  const avgComm = defTeam.agents.reduce((s,a)=>s+a.stats.communication,0)/defTeam.agents.length;
  // Doctrine de rotation/retake (-2 Prudent..+2 Agressif, voir
  // VALORANT_DOCTRINES côté script.js, transmis via matchInit →
  // team.retakeDoctrine) : vient s'ajouter au seuil déjà dérivé de la
  // communication d'équipe — Agressif peut réagir dès 1 repérage même
  // sans bonne com (risque accru de se faire punir par un fake), Prudent
  // peut monter jusqu'à 3 même avec bonne com (plus lent, plus sûr).
  const sightingsBase = avgComm>=65 ? 1 : 2;
  const sightingsNeeded = Math.max(1, Math.min(3, Math.round(sightingsBase - (defTeam.retakeDoctrine||0)*0.6)));
  const sightings = defTeam.blackboard.recentEnemySightings(5);
  if(sightings.length < sightingsNeeded) return;
  // Moyenne des positions rapportées → quel site est réellement pressuré.
  const avgX = sightings.reduce((s,m)=>s+m.data.x,0)/sightings.length;
  const avgZ = sightings.reduce((s,m)=>s+m.data.z,0)/sightings.length;
  const dA = Math.hypot(avgX-zones.zone_siteA.x, avgZ-zones.zone_siteA.z);
  const dB = Math.hypot(avgX-zones.zone_siteB.x, avgZ-zones.zone_siteB.z);
  const threatSite = dA<dB ? 'A' : 'B';
  // Le Sentinel ancre son site et ne tourne qu'en dernier recours (rôle :
  // tenir seul face à un pick, jamais abandonner sans y être contraint).
  const otherHolders = defTeam.agents.filter(a=>a.alive && a._assignedSite && a._assignedSite!==threatSite);
  const holders = otherHolders.filter(a=>a.playstyle!=='Sentinel Ancre');
  const pool = holders.length ? holders : otherHolders;
  if(!pool.length) return;
  const toRotate = pool.slice(0, Math.min(2, pool.length));
  const targetNodes = spreadNodes(zones['zone_site'+threatSite], toRotate.length, 3.0, 16);
  toRotate.forEach((a,i)=>{ a.goTo(targetNodes[i%targetNodes.length]); a._assignedSite = threatSite; ctx.log(`🔄 ${displayNameOf(a.name)} rotate vers ${threatSite}`); });
  ctx.rotationTriggered = true;
}

/* ============================================================
   MODULE: UTILITAIRES — fumée (bloque vraiment la vue, voir
   hasLineOfSight), flash (aveugle vraiment, voir visibleEnemiesOf) et
   piège Sentinel (ralentit vraiment l'ennemi qui le traverse, voir
   tickAgent) — pas juste du flavor visuel. Portée/durée/efficacité
   scalent avec la stat "utility" (Utilisation des utilitaires/Contrôle de
   zone) du lanceur ou de la moyenne d'équipe selon le cas.
   ============================================================ */
const UTILITY_BASE = { smokeRadius:4.2, smokeDuration:13, flashRadius:7.5, flashDuration:1.3, trapRadius:2.6, trapSlow:0.4 };
function teamAvgUtility(team){ return team.agents.reduce((s,a)=>s+a.stats.utility,0)/team.agents.length; }
// 0.75x à 1.25x selon la stat 0-99 — jamais nulle (même un mauvais
// utilitaire reste un utilitaire), jamais démesurée non plus.
function utilityScale(utility){ return 0.75 + clamp(utility,0,99)/99*0.5; }

function spawnSmokeVisual(pt, radius){
  const m = BABYLON.MeshBuilder.CreateSphere('smoke', {diameter:radius*2, segments:12}, scene);
  m.material = mkStdMat('smokeMat', 0xdfe6ee, { opacity:0.5 });
  m.position.set(pt.x,1.4,pt.z); m.scaling.setAll(0.15);
  let t=0; const grow=()=>{ t+=0.08; m.scaling.setAll(Math.min(1,t)); if(t<1) requestAnimationFrame(grow); };
  grow();
  return m;
}
function spawnFlashVisual(pt){
  const m = BABYLON.MeshBuilder.CreateSphere('flash', {diameter:0.6, segments:10}, scene);
  m.material = mkUnlitMat('flashMat', 0xffffff, { opacity:1 });
  m.position.set(pt.x,1.3,pt.z);
  let t=0; const anim=()=>{ t+=0.05; m.scaling.setAll(1+t*12); m.material.alpha=Math.max(0,1-t*1.3); if(t<0.9) requestAnimationFrame(anim); else m.dispose(); };
  anim();
}
function spawnTrapVisual(pt, radius){
  // RingGeometry -> tore fin (pas d'équivalent exact côté Babylon), déjà à
  // plat dans le plan XZ : le rotation.x=-Math.PI/2 d'origine disparaît.
  const m = BABYLON.MeshBuilder.CreateTorus('trap', {diameter:radius*1.82, thickness:radius*0.18, tessellation:28}, scene);
  m.material = mkUnlitMat('trapMat', 0xffcf4a, { opacity:0.4, doubleSided:true });
  m.position.set(pt.x,0.05,pt.z);
  return m;
}
// Nuage de fumée : bloque réellement la vue (voir hasLineOfSight) pendant
// sa durée, jamais le passage physique. Rayon/durée scalent avec la stat
// utility du lanceur (ou moyenne d'équipe si aucun joueur précis n'est
// désigné — un exec de groupe, pas une fumée individuelle).
function deploySmoke(pt, utility){
  const scale = utilityScale(utility);
  const radius = UTILITY_BASE.smokeRadius*scale, duration = UTILITY_BASE.smokeDuration*scale;
  const mesh = spawnSmokeVisual(pt, radius);
  activeSmokes.push({ center:{x:pt.x,z:pt.z}, radius, expiresAt: SimClock.now()+duration, mesh });
}
// Flash : aveugle (voir visibleEnemiesOf) tout agent adverse dans son rayon
// d'effet QUI A LIGNE DE VUE sur le point d'impact au moment du pop — pas
// à travers un mur. Durée scale avec l'utility du lanceur.
function deployFlash(pt, casterUtility, targetTeam, log){
  const duration = UTILITY_BASE.flashDuration*utilityScale(casterUtility);
  const now = SimClock.now();
  let blinded = 0;
  targetTeam.agents.forEach(a=>{
    if(!a.alive) return;
    if(Math.hypot(a.pos.x-pt.x, a.pos.z-pt.z) > UTILITY_BASE.flashRadius) return;
    if(!hasLineOfSight(a.pos, pt)) return;
    a.blindedUntil = now+duration;
    blinded++;
  });
  spawnFlashVisual(pt);
  if(blinded && log) log(`⚡ Flash — ${blinded} joueur${blinded>1?'s':''} adverse${blinded>1?'s':''} aveuglé${blinded>1?'s':''}`);
}
// Piège Sentinel : zone qui ralentit tout ennemi qui la traverse (voir
// tickAgent), posée pour toute la durée du round là où le Sentinel tient
// son site — pas un objet qu'on déclenche, une zone de contrôle passive.
function deployTrap(pt, utility, ownerTeam){
  const scale = utilityScale(utility);
  const radius = UTILITY_BASE.trapRadius*scale, slow = UTILITY_BASE.trapSlow*scale;
  const mesh = spawnTrapVisual(pt, radius);
  activeTraps.push({ center:{x:pt.x,z:pt.z}, radius, slow, ownerTeam, mesh });
}
// Retire les fumées expirées de la scène — appelé chaque tick (voir
// tickRound). Les pièges, eux, durent tout le round (nettoyés dans
// startRound, comme clearDeathMarkers).
function pruneExpiredSmokes(){
  const now = SimClock.now();
  for(let i=activeSmokes.length-1;i>=0;i--){
    if(activeSmokes[i].expiresAt<=now){ activeSmokes[i].mesh.dispose(); activeSmokes.splice(i,1); }
  }
}
function clearAllUtility(){
  activeSmokes.forEach(s=> s.mesh.dispose()); activeSmokes = [];
  activeTraps.forEach(t=> t.mesh.dispose()); activeTraps = [];
  activeDamageZones.forEach(z=> z.mesh.dispose()); activeDamageZones = [];
}
// Facteur de ralentissement subi par un agent s'il se trouve dans un piège
// ADVERSE actif (jamais dans le sien) — 1 = vitesse normale.
function trapSlowFactorFor(agent, myTeam){
  let factor = 1;
  for(let i=0;i<activeTraps.length;i++){
    const t = activeTraps[i];
    if(t.ownerTeam===myTeam) continue;
    if(Math.hypot(agent.pos.x-t.center.x, agent.pos.z-t.center.z)<=t.radius) factor *= (1-t.slow);
  }
  return factor;
}

/* ============================================================
   SORTS RÉELS PAR AGENT — classe automatiquement CHAQUE sort d'AGENT_KITS
   (voir valorant.js côté manager) en un effet mécanique concret, à partir
   des stats qu'il possède plutôt que d'un nom codé en dur agent par agent
   (aucun agent, présent ou futur, n'a besoin d'être ajouté ici à la main).
   Coûts/durées/dégâts viennent tous de ability.stats, déjà résolus à la
   valeur de patch en vigueur côté manager (voir playerToAIKit) — un
   buff/nerf en vigueur s'applique donc automatiquement.
   ============================================================ */
function classifyAbility(ability){
  if(!ability || !ability.stats) return null;
  const s = ability.stats;
  if('Dégâts/s' in s) return 'DAMAGE_ZONE';
  if('Dégâts' in s || 'Dégâts max' in s || 'Dégâts traînée' in s || 'Dégâts/rayon' in s) return 'DAMAGE_BURST';
  if('Durée aveuglement (s)' in s) return 'FLASH';
  if('Durée étourdissement (s)' in s || 'Durée immobilisation (s)' in s || 'Nombre de secousses' in s) return 'STUN';
  if('Durée désorientation (s)' in s || 'Réduction précision (%)' in s) return 'DEBUFF';
  if('Ralentissement (%)' in s) return 'SLOW';
  if('Durée révélation (s)' in s || 'Durée trace (s)' in s || 'Durée suivi (s)' in s || 'Nombre de drones' in s || 'Durée vol (s)' in s) return 'REVEAL';
  if('Amplification (%)' in s || 'Soin par élim.' in s) return 'BUFF';
  if('Durée (s)' in s) return 'SMOKE';
  return null;
}
// Lance UN sort précis (A/B/signature/ultime) d'un agent précis, à son
// point d'impact — dispatché selon classifyAbility. caster/allyTeam/
// enemyTeam/log toujours fournis, même par les défenseurs (pas seulement
// à l'entrée attaquante).
function castAbility(caster, ability, pt, allyTeam, enemyTeam, log){
  const type = classifyAbility(ability);
  if(!type) return;
  const s = ability.stats, now = SimClock.now();
  const label = `${ability.name} (${displayNameOf(caster.name)})`;
  const inRange = (a, r)=> Math.hypot(a.pos.x-pt.x,a.pos.z-pt.z)<=r && a.alive;
  if(type==='SMOKE'){
    const duration = s['Durée (s)'] || UTILITY_BASE.smokeDuration;
    const mesh = spawnSmokeVisual(pt, UTILITY_BASE.smokeRadius);
    activeSmokes.push({ center:{x:pt.x,z:pt.z}, radius:UTILITY_BASE.smokeRadius, expiresAt: now+duration, mesh });
    log(`🌫️ ${label}`);
  } else if(type==='FLASH'){
    const duration = s['Durée aveuglement (s)'] || UTILITY_BASE.flashDuration;
    let n=0;
    enemyTeam.agents.forEach(a=>{ if(inRange(a,UTILITY_BASE.flashRadius) && hasLineOfSight(a.pos,pt)){ a.blindedUntil=now+duration; n++; } });
    spawnFlashVisual(pt);
    log(`⚡ ${label} — ${n} aveuglé${n>1?'s':''}`);
  } else if(type==='STUN'){
    const duration = s['Durée étourdissement (s)'] || s['Durée immobilisation (s)'] || 1.5;
    let n=0;
    enemyTeam.agents.forEach(a=>{ if(inRange(a,UTILITY_BASE.flashRadius*0.65) && hasLineOfSight(a.pos,pt)){ a.rootedUntil=now+duration; a.blindedUntil=Math.max(a.blindedUntil,now+duration); n++; } });
    spawnFlashVisual(pt);
    log(`💫 ${label} — ${n} étourdi${n>1?'s':''}`);
  } else if(type==='DEBUFF'){
    const duration = s['Durée désorientation (s)'] || 2.5;
    const mult = 1-(s['Réduction précision (%)']||30)/100;
    let n=0;
    enemyTeam.agents.forEach(a=>{ if(inRange(a,UTILITY_BASE.flashRadius) && hasLineOfSight(a.pos,pt)){ a.aimMultUntil=now+duration; a.aimMult=mult; n++; } });
    spawnFlashVisual(pt);
    log(`🌀 ${label} — ${n} déstabilisé${n>1?'s':''}`);
  } else if(type==='SLOW'){
    const duration = s['Durée (s)'] || 6, slow = (s['Ralentissement (%)']||30)/100;
    const radius = UTILITY_BASE.trapRadius*1.3;
    const mesh = spawnTrapVisual(pt, radius);
    activeTraps.push({ center:{x:pt.x,z:pt.z}, radius, slow, ownerTeam:allyTeam, mesh, expiresAt: now+duration });
    log(`🐌 ${label}`);
  } else if(type==='DAMAGE_ZONE'){
    const duration = s['Durée (s)'] || 5, dps = s['Dégâts/s'] || 10;
    const mesh = spawnTrapVisual(pt, UTILITY_BASE.trapRadius);
    activeDamageZones.push({ center:{x:pt.x,z:pt.z}, radius:UTILITY_BASE.trapRadius, dps, ownerTeam:allyTeam, caster, mesh, expiresAt: now+duration });
    log(`🔥 ${label}`);
  } else if(type==='DAMAGE_BURST'){
    const dmg = s['Dégâts'] || s['Dégâts max'] || s['Dégâts traînée'] || s['Dégâts/rayon'] || 40;
    let n=0;
    enemyTeam.agents.forEach(a=>{
      if(!inRange(a,UTILITY_BASE.trapRadius*1.4) || !hasLineOfSight(a.pos,pt)) return;
      a.hp -= dmg; n++;
      if(a.hp<=0){
        a.hp=0; a.alive=false; a.state='DEAD'; caster.kills++; a.deaths++;
        caster.credits = Math.min(NEXUS_MAX, caster.credits+200);
        DuelMemory.recordKill(caster, a, roundNumber);
        spawnDeathMarker(a.pos, a.side);
        a._deathAnimStart = SimClock.now(); if(a._tag) a._tag.setEnabled(false);
        onKill(caster, a, false, false);
      }
    });
    spawnHitFlash(pt);
    log(`💥 ${label} — ${n} touché${n>1?'s':''}`);
  } else if(type==='REVEAL'){
    let n=0;
    enemyTeam.agents.forEach(a=>{ if(inRange(a,UTILITY_BASE.flashRadius)){ allyTeam.blackboard.report(caster,'ENEMY_SEEN',{count:1,x:a.pos.x,z:a.pos.z}); n++; } });
    log(`📡 ${label}${n?` — ${n} repéré${n>1?'s':''}`:''}`);
  } else if(type==='BUFF'){
    const mult = 1+(s['Amplification (%)']||15)/100;
    let n=0;
    allyTeam.agents.forEach(a=>{ if(inRange(a,UTILITY_BASE.trapRadius*1.6)){ a.aimMultUntil=now+5; a.aimMult=mult; n++; } });
    log(`✨ ${label} — ${n} allié${n>1?'s':''} amplifié${n>1?'s':''}`);
  }
}
// Dégâts de zone (Viper-like) : tick continu (dps*dt) tant qu'un ennemi
// s'y trouve — appelé chaque tick (voir tickRound), gère aussi sa propre
// expiration (pas besoin d'un pruneExpired séparé comme les fumées).
function applyDamageZones(dt, round){
  for(let i=activeDamageZones.length-1;i>=0;i--){
    const z = activeDamageZones[i];
    if(z.expiresAt<=SimClock.now()){ z.mesh.dispose(); activeDamageZones.splice(i,1); continue; }
    [teamA,teamB].forEach(team=>{
      if(team===z.ownerTeam) return;
      team.agents.forEach(a=>{
        if(!a.alive) return;
        if(Math.hypot(a.pos.x-z.center.x,a.pos.z-z.center.z)>z.radius) return;
        a.hp -= z.dps*dt;
        if(a.hp<=0){
          a.hp=0; a.alive=false; a.state='DEAD'; z.caster.kills++; a.deaths++;
          z.caster.credits = Math.min(NEXUS_MAX, z.caster.credits+200);
          DuelMemory.recordKill(z.caster, a, round);
          spawnDeathMarker(a.pos, a.side);
          a._deathAnimStart = SimClock.now(); if(a._tag) a._tag.setEnabled(false);
          onKill(z.caster, a, false, false);
        }
      });
    });
  }
}
// À l'entrée (voir startRound) : chaque attaquant vivant qui possède un
// sort A/B acheté ce round (voir buyAbilitiesForAgent), ou dont le
// signature est disponible (hors recharge), a une chance de le lancer sur
// le site visé — c'est ce qui fait que TOUS les agents créés (pas
// seulement Controller/Initiator) peuvent s'exprimer en simulation.
function castEntryUtility(attackTeam, defendTeam, pt, log){
  const now = SimClock.now();
  attackTeam.agents.forEach(caster=>{
    if(!caster.alive || !caster.kit) return;
    ['a','b'].forEach(key=>{
      if(!caster.ownedAbilities[key]) return;
      if(Math.random() < 0.45) castAbility(caster, caster.kit[key], pt, attackTeam, defendTeam, log);
    });
    const sig = caster.kit.signature;
    if(sig && now>=caster.sigCooldownUntil && Math.random()<0.3){
      castAbility(caster, sig, pt, attackTeam, defendTeam, log);
      const cd = (sig.stats && sig.stats['Recharge (s)']) || 35;
      caster.sigCooldownUntil = now+cd;
    }
  });
}
// Ultime : accumule 1 point par élimination (voir onKill, qui incrémente
// ultimatePoints) jusqu'au seuil "Points requis" du kit, puis se
// lance automatiquement à la prochaine entrée — version amplifiée (rayon/
// durée/dégâts x1.6) pour marquer le coup, comme un vrai ultime.
function tryCastUltimates(team, pt, allyIsAttack, enemyTeam, log){
  team.agents.forEach(caster=>{
    if(!caster.alive || !caster.kit || !caster.kit.ultimate) return;
    const need = caster.kit.ultimate.stats['Points requis'];
    if(!need || caster.ultimatePoints<need) return;
    const amped = { name:caster.kit.ultimate.name, stats:{...caster.kit.ultimate.stats} };
    Object.keys(amped.stats).forEach(k=>{ if(typeof amped.stats[k]==='number' && k!=='Points requis') amped.stats[k]*=1.6; });
    castAbility(caster, amped, pt, team, enemyTeam, log);
    caster.ultimatePoints = 0;
  });
}

/* ============================================================
   MODULE: CORE — orchestrateur de match (rounds, spawn, stratégies,
   post-plant, victoire). Règles officielles : premier à 13 manches,
   changement de côté après le 12e round, prolongation à 12-12 (2
   manches d'écart pour gagner). `teamA`/`teamB` gardent leur identité
   (roster, stats) toute la partie ; `attackTeam`/`defendTeam` sont les
   références qui, elles, changent de côté à la mi-match — toute la
   logique de round doit utiliser ces dernières, jamais teamA/teamB
   directement pour "qui attaque".
   ============================================================ */
// Construction reconstructible : par défaut noms/rôles génériques (usage
// autonome, fichier ouvert seul) — remplacée par le vrai roster du
// manager si un message 'matchInit' arrive avant le lancement du match
// (voir le listener plus bas). Les scoreboard cards DOM sont reconstruites
// à l'identique de leur premier rendu (mkScoreCard, plus loin) si l'équipe
// est reconstruite après le premier rendu.
let teamA = new Team('Équipe A','ATTACK', NAMES_A);
let teamB = new Team('Équipe B','DEFENSE', NAMES_B);
// Bandeau CURRENT/NEXT/DECIDER (voir buildVetoBannerInfo côté manager) —
// vide si le manager ne fournit rien (simulation autonome hors popup).
function setVetoBanner(v){
  const el = document.getElementById('vetoInfo');
  if(!v){ el.innerHTML = ''; return; }
  const parts = [`<span>CURRENT: <b>${escapeAttrLocal((v.current||'').toUpperCase())}</b></span>`];
  if(v.next) parts.push(`<span>NEXT: <b>${escapeAttrLocal(v.next.toUpperCase())}</b></span>`);
  if(v.decider) parts.push(`<span>DECIDER: <b>${escapeAttrLocal(v.decider.toUpperCase())}</b></span>`);
  el.innerHTML = parts.join('');
}
function setContextBanner(label){
  document.getElementById('contextInfo').textContent = label || '';
}
function rebuildTeams(nameA, nameB, namesA, namesB, statsA, statsB, tagA, tagB, ecoA, entryA, retakeA, ecoB, entryB, retakeB){
  teamA.agents.forEach(a=> a.mesh.dispose());
  teamB.agents.forEach(a=> a.mesh.dispose());
  teamA = new Team(nameA||'Équipe A','ATTACK', namesA||NAMES_A, statsA, tagA);
  teamB = new Team(nameB||'Équipe B','DEFENSE', namesB||NAMES_B, statsB, tagB);
  // Doctrines tactiques (voir VALORANT_DOCTRINES côté script.js) — stockées
  // sur chaque Team, lues avec un filet ||0 par decideBuy/StrategyEngine.
  // select/maybeRotateDefenders (jamais undefined, y compris en mode
  // autonome hors intégration manager, où ces paramètres restent absents).
  teamA.ecoDoctrine = ecoA||0; teamA.entryDoctrine = entryA||0; teamA.retakeDoctrine = retakeA||0;
  teamB.ecoDoctrine = ecoB||0; teamB.entryDoctrine = entryB||0; teamB.retakeDoctrine = retakeB||0;
  // attackTeam/defendTeam (utilisées par toute la logique de round : spawn,
  // déplacement, combat...) pointaient encore vers les ANCIENS teamA/teamB
  // génériques après un rebuild : leurs mesh venaient d'être retirés de la
  // scène juste au-dessus, donc la simulation faisait bouger des agents
  // invisibles pendant que les nouveaux (bon roster, ajoutés à la scène)
  // restaient figés à leur position par défaut (0,0), jamais spawnés — d'où
  // des persos absents ou plantés hors carte. matchInit n'arrive que tant
  // que phase==='IDLE' (avant tout swapSides), donc ATTACK/DEFENSE = teamA/teamB.
  attackTeam = teamA; defendTeam = teamB;
  document.getElementById('sbAtk').innerHTML = '';
  document.getElementById('sbDef').innerHTML = '';
  document.getElementById('sbAtk').append(...teamA.agents.map(a=>mkScoreCard(a,false)));
  document.getElementById('sbDef').append(...teamB.agents.map(a=>mkScoreCard(a,true)));
  updateScoreboard();
}

/* ============================================================
   MODULE: INTÉGRATION MANAGER — reçoit le vrai roster (noms/rôles/stats
   0-99 déjà à l'échelle) depuis script.js quand ce fichier est embarqué en
   iframe dans la popup de match du manager, au lieu de tourner en
   autonome avec des noms/stats génériques. Protocole aligné sur celui déjà
   utilisé par les autres vues carte du jeu (voir MAP_3D_SCENES côté
   script.js) : handshake 'ready', puis 'matchInit'/'speed' entrants, et
   'matchResult' sortant une fois le match terminé.
   ============================================================ */
window.addEventListener('message', (e)=>{
  const msg = e.data;
  if(!msg || !msg.type) return;
  if(msg.type==='matchInit' && phase==='IDLE'){
    rebuildTeams(msg.selfName, msg.oppName, msg.rosterA&&msg.rosterA.map(p=>p.name), msg.rosterB&&msg.rosterB.map(p=>p.name), msg.rosterA, msg.rosterB, msg.selfTag, msg.oppTag, msg.ecoDoctrineA, msg.entryDoctrineA, msg.retakeDoctrineA, msg.ecoDoctrineB, msg.entryDoctrineB, msg.retakeDoctrineB);
    setVetoBanner(msg.vetoBanner);
    setContextBanner(msg.matchContext);
  } else if(msg.type==='speed' && msg.multiplier){
    SimClock.speed = msg.multiplier;
    document.querySelectorAll('.speed-btn').forEach(b=> b.classList.toggle('active', parseInt(b.dataset.speed,10)===msg.multiplier));
  } else if(msg.type==='play'){
    if(!SimClock.running){ SimClock.running = true; document.getElementById('playPauseBtn').innerHTML = '<i>⏸</i> Pause'; if(phase==='IDLE') startRound(); }
  } else if(msg.type==='pause'){
    SimClock.running = false; document.getElementById('playPauseBtn').innerHTML = '<i>▶</i> Lancer le match';
  }
  // Remarque : pas de 'skipRound'/'skipMap' depuis le manager — le
  // fast-forward ("Passer le round"/"Simuler le match", voir les boutons
  // #skipRoundBtn/#simAllBtn) est une action LOCALE à ce popup, jamais
  // pilotée depuis l'extérieur (cohérent avec "l'IA décide seule").
});
// Handshake identique aux autres vues carte du jeu : tant que le parent
// n'a pas reçu 'ready', ses messages (matchInit compris) sont mis en
// attente de son côté plutôt que perdus — voir _liveMapMsgBound/
// _liveMapQueue dans script.js.
if(window.parent !== window) window.parent.postMessage({ type:'ready' }, '*');
let attackTeam = teamA, defendTeam = teamB;
function swapSides(){
  roundHistory = []; // nouvelle mi-temps : les pips repartent de zéro, comme en vrai
  [attackTeam, defendTeam] = [defendTeam, attackTeam];
  attackTeam.side='ATTACK'; defendTeam.side='DEFENSE';
  // Mi-match : l'économie repart de zéro comme au vrai round pistolet 1
  // (800 NX, pistolet de base, pas d'armure) — sans ça, l'équipe qui
  // dominait la 1re mi-temps entrait en 2e mi-temps avec son stock de
  // crédits ET son arme déjà en poche (carriedRank déjà au niveau du
  // palier visé → decideBuyForAgent la laissait en SAVE malgré une
  // trésorerie pleine), donc plus aucun vrai round pistolet et un
  // déséquilibre qui ne reflète plus le jeu réel (signalé : "l'économie
  // n'est pas cohérente dans les parties").
  [...attackTeam.agents, ...defendTeam.agents].forEach(a=>{
    a.credits = 800;
    a.weapon = { name:'Striker-9', dmgBody:32, dmgHead:118, dmgLeg:24, rofMs:210, range:20, tierRank:0 };
    a.armor = false;
  });
  attackTeam.lossStreak = 0; defendTeam.lossStreak = 0;
  [...attackTeam.agents, ...defendTeam.agents].forEach(a=>{
    a.side = (a.team===attackTeam) ? 'ATTACK' : 'DEFENSE';
    a.tagColor = a.side==='ATTACK' ? TEAM_A_TAG : TEAM_B_TAG;
    a.updateTag();
    // updateTag() ne rafraîchit que l'étiquette flottante au-dessus du
    // personnage dans la scène 3D — la pastille du tableau de bord 2D
    // (.sb-avatar, posée une seule fois dans mkScoreCard) restait donc
    // figée sur la couleur de la 1re mi-temps après un changement de côté
    // (signalé : joueurs bien verts sur le terrain, pastille toujours
    // rouge dans le panneau latéral).
    const cardEl = document.getElementById('sb_'+a.id);
    const avatarEl = cardEl && cardEl.querySelector('.sb-avatar');
    if(avatarEl) avatarEl.style.background = '#'+a.tagColor.toString(16).padStart(6,'0');
  });
  log(`🔄 Changement de côté — ${attackTeam===teamA?'Équipe A':'Équipe B'} passe à l'attaque, ${defendTeam===teamA?'Équipe A':'Équipe B'} passe à la défense`);
}
let roundNumber = 0, scoreA = 0, scoreB = 0;
let roundHistory = []; // 'A'|'B' par round de la mi-temps en cours — pips du bandeau de score, remis à zéro à swapSides()
// Journal des kills de la manche EN COURS (voir startRound/onKill/endRound) —
// sert à dériver KAST/premier kill/premier mort/clutch en fin de manche,
// pour que le récap envoyé au manager (matchResult) reflète ce qui s'est
// RÉELLEMENT passé plutôt que d'être ré-estimé après coup côté script.js
// à partir des seules attributs du joueur (écart signalé : "manque de
// logique entre la map simulée en 3D et ce que ça affiche dans le récap").
let roundKillEvents = [];
// Log persistant sur TOUT le match (contrairement à roundHistory, jamais
// remis à zéro à la mi-temps) : { winner:'A'|'B', winnerOnAttack:bool } par
// round — sert uniquement à calculer camp dominant/série la plus longue en
// fin de match (voir matchOver plus bas), pour renvoyer les mêmes champs
// que le moteur statistique (simulateMapForTeams, script.js) au manager.
let fullRoundLog = [];
const MATCH_TARGET = 13;
const ROUND_TIME = 100;     // 1:40, comme en compétitif
const PLANT_TIMER = 45;     // secondes simulées avant explosion après plant
const DEFUSE_TIME = 4;
const PLANT_TIME = 2;       // secondes pour poser la spike

let phase = 'IDLE'; // IDLE|SETUP|LIVE|POSTPLANT|ROUNDEND|MATCHEND
let roundStartT = 0, plantT = null, defuseStartT = null, defusingAgent = null;
let planted = false, spikeSite = null, spikePos = null;
let plantingAgent = null, plantStartT = null;
let rotationTriggered = false;
let spikeRushSent = false; // un seul défenseur envoyé se ruer sur la spike par round (voir tickRound)

// Bandeau tactique retiré de l'affichage (texte flottant sans fond,
// illisible par-dessus la carte) — log() ne fait plus rien côté rendu,
// gardée en no-op pour ne pas casser tous ses appels dans le reste du
// fichier (narration des événements : buy, stratégie, rotations, sorts...).
function log(msg){}
function killFeedPush(killer, victim, headshot, revenge){
  const el = document.getElementById('killfeed');
  const d = document.createElement('div'); d.className = 'kf-item'+(revenge?' revenge':'');
  d.innerHTML = `<span class="n ${killer.side==='ATTACK'?'atk':'def'}">${displayNameOf(killer.name)}</span>
    <span class="wpn">${headshot?'🎯 headshot':(killer.weapon&&killer.weapon.name||'Striker-9')}</span> ➜
    <span class="n ${victim.side==='ATTACK'?'atk':'def'}" style="opacity:.7;">${displayNameOf(victim.name)}</span>
    ${revenge?'<span class="kf-revenge-tag">REVANCHE</span>':''}`;
  el.appendChild(d);
  while(el.children.length>6) el.removeChild(el.firstChild);
}
function showBanner(main, sub){
  const b = document.getElementById('centerBanner');
  b.querySelector('.main').textContent = main; b.querySelector('.sub').textContent = sub||'';
  b.classList.add('show');
  setTimeout(()=> b.classList.remove('show'), 1900);
}

function onKill(killer, victim, headshot, revenge){
  killFeedPush(killer, victim, headshot, revenge);
  if(revenge) log(`⚔️ ${displayNameOf(victim.name)} venge sa mort face à ${displayNameOf(killer.name)} !`);
  killer.ultimatePoints = (killer.ultimatePoints||0)+1; // charge l'ultime (voir tryCastUltimates)
  updateScoreboard();
}

function pickDefenderSetup(){
  const memA = attackTeam.siteMemory.A.recentLosses, memB = attackTeam.siteMemory.B.recentLosses;
  // Les attaquants ayant récemment forcé un site = défenseurs s'y renforcent.
  const heavy = memA>memB ? 'A' : (memB>memA ? 'B' : (Math.random()<0.5?'A':'B'));
  const counts = heavy==='A' ? [3,2] : [2,3];
  return { A:counts[0], B:counts[1] };
}

/* ============================================================
   POSITIONNEMENT D'ÉQUIPE — jamais un point unique partagé par tout un
   groupe (ça les ferait se tasser au même endroit) : chaque joueur tient
   un nœud distinct, si possible espacé d'au moins `spacing` de ses
   coéquipiers, pour une vraie tenue de position tactique.
   ============================================================ */
function spreadFromList(list, count, spacing){
  const chosen = [];
  for(const idx of list){
    const f = floorNodes[idx];
    if(chosen.every(ci=>{ const cf=floorNodes[ci]; return Math.hypot(cf.x-f.x,cf.z-f.z)>=spacing; })){
      chosen.push(idx);
      if(chosen.length>=count) break;
    }
  }
  if(chosen.length<count){
    for(const idx of list){ if(!chosen.includes(idx)){ chosen.push(idx); if(chosen.length>=count) break; } }
  }
  return chosen;
}
// Distance d'un point au couvert (mur/bâtiment/prop/caisse) le plus proche
// — 0 s'il est dedans (ne devrait pas arriver sur un nœud praticable).
function distToNearestCover(pt){
  let best = Infinity;
  for(const b of navBlockBoxes){
    const dx = Math.max(b.min.x-pt.x, 0, pt.x-b.max.x);
    const dz = Math.max(b.min.z-pt.z, 0, pt.z-b.max.z);
    const d = Math.hypot(dx,dz);
    if(d<best){ best=d; if(best<0.05) break; }
  }
  return best===Infinity ? 8 : best;
}
// Réordonne une liste de nœuds pour privilégier les positions "avantageuses" :
// proches de la zone visée, ET adossées à un couvert (angle/coin, 0.4-1.6u
// d'un mur ou d'une caisse) plutôt qu'en plein milieu d'un espace ouvert.
function tacticalSort(list, zonePt){
  return list.map(i=>{
    const f = floorNodes[i];
    const dz = Math.hypot(f.x-zonePt.x, f.z-zonePt.z);
    const cov = distToNearestCover(f);
    const coverPenalty = cov<0.35 ? 2.5 : Math.abs(cov-1.0)*0.8;
    return { i, score: dz*0.35 + coverPenalty };
  }).sort((a,b)=>a.score-b.score).map(o=>o.i);
}
function spreadNodes(zonePt, count, spacing=3.2, poolSize=30){
  return spreadFromList(tacticalSort(nearestNodes(zonePt, poolSize), zonePt), count, spacing);
}
// Comme spreadNodes, mais borné à un rayon max autour du point — utilisé
// pour la tenue post-plant : les attaquants doivent rester assez proches
// de la spike pour empêcher le désamorçage, pas juste "vers le site".
function spreadNodesNear(zonePt, count, spacing, maxRadius, poolSize=30){
  const all = nearestNodes(zonePt, poolSize);
  const near = all.filter(i=>{ const f=floorNodes[i]; return Math.hypot(f.x-zonePt.x,f.z-zonePt.z)<=maxRadius; });
  return spreadFromList(tacticalSort(near.length ? near : all, zonePt), count, spacing);
}
// Deux flancs angulairement opposés autour d'un point (pour une exécution
// "split" crédible : deux sous-groupes qui n'arrivent pas du même côté).
function twoFlanks(zonePt, poolSize=44){
  const pool = nearestNodes(zonePt, poolSize)
    .map(i=>({ i, ang: Math.atan2(floorNodes[i].x-zonePt.x, floorNodes[i].z-zonePt.z), d: Math.hypot(floorNodes[i].x-zonePt.x, floorNodes[i].z-zonePt.z) }))
    .filter(o=>o.d>1.8);
  pool.sort((a,b)=>a.ang-b.ang);
  const mid = Math.floor(pool.length/2);
  return { flankA: pool.slice(0,mid).map(o=>o.i), flankB: pool.slice(mid).map(o=>o.i) };
}

/* ============================================================
   MODULE: TIME-OUT TACTIQUE — réglementaire façon compétitif pro (1 par
   side, jamais récupéré une fois pris, +1 unique pour toute l'overtime).
   Se déclenche toujours à la coupure entre deux rounds (jamais en plein
   combat) : le bouton pose juste un flag `pendingPlayerTimeout`, réévalué
   juste avant le prochain startRound() (voir la fin d'endRound). teamA =
   l'équipe du joueur par convention (voir matchInit/rebuildTeams, plus
   haut) : seule elle peut être déclenchée manuellement ; teamB (IA
   adverse) peut aussi en demander un elle-même dans certaines situations
   (série de défaites), pour plus de réalisme.
   ============================================================ */
const TIMEOUT_DURATION = 30; // secondes RÉELLES, indépendantes de SimClock.speed
let pendingPlayerTimeout = false;
let timeoutState = { active:false, team:null, remaining:0 };
let timeoutHistory = [];
function timeoutsRemaining(team){ return roundNumber>24 ? team.timeoutsOT : team.timeoutsBySide[team.side]; }
function consumeTimeout(team){
  if(roundNumber>24) team.timeoutsOT = Math.max(0, team.timeoutsOT-1);
  else team.timeoutsBySide[team.side] = Math.max(0, team.timeoutsBySide[team.side]-1);
}
function requestPlayerTimeout(){
  if(timeoutState.active || pendingPlayerTimeout) return;
  if(timeoutsRemaining(teamA)<=0) return;
  pendingPlayerTimeout = true;
  updateTimeoutButton();
}
// Appelée juste avant startRound() du round suivant (voir fin d'endRound) :
// l'IA adverse (teamB) demande parfois un Time-Out après une série de
// défaites, avec un cooldown anti-spam et un tirage pour ne pas être
// systématique/prévisible à chaque fois que la condition est réunie.
function maybeCallAiTimeout(){
  if(pendingPlayerTimeout) return false; // le joueur passe en premier s'il a déjà demandé
  const ai = teamB;
  if(timeoutsRemaining(ai)<=0) return false;
  if(ai.lossStreak<2) return false;
  if(roundNumber-ai.lastTimeoutRound<=2) return false;
  if(Math.random()>=0.5) return false;
  startTimeout(ai);
  return true;
}
function startTimeout(team){
  consumeTimeout(team);
  team.lastTimeoutRound = roundNumber;
  timeoutState = { active:true, team, remaining:TIMEOUT_DURATION };
  timeoutHistory.push({ round:Math.max(1,roundNumber), teamName:team.name, side:team.side, score:`${scoreA}:${scoreB}` });
  pendingPlayerTimeout = false;
  // Nouveau Time-Out : efface le plan du précédent (sinon un vieil arbre
  // resterait affiché avant que le coach en génère un nouveau).
  currentTimeoutTree = null; selectedTreeNodeId = null;
  const input = document.getElementById('timeoutKeywordInput'); if(input) input.value = '';
  const warn = document.getElementById('timeoutKeywordWarning'); if(warn) warn.style.display = 'none';
  document.getElementById('timeoutTreeView').innerHTML = '';
  renderTimeoutNodeDetail(null);
  timeoutVisualGeneration++; clearTimeoutPlanVisuals();
  spawnTimeoutEffect(team);
  pushTimeoutFeedCard(team);
  updateTimeoutPopup();
  updateTimeoutCoachPanel();
  updateTimeoutCounters(); // rafraîchit tout de suite le compteur ATK/DEF TO, sans attendre le prochain tick périodique de updateScoreboard()
  updateTimeoutHistoryPanel();
}
function skipTimeout(){
  if(!timeoutState.active) return;
  timeoutState.active = false;
  updateTimeoutPopup();
  updateTimeoutCoachPanel();
  timeoutVisualGeneration++; clearTimeoutPlanVisuals();
  startRound();
}
// Appelée depuis animate() à CHAQUE frame, indépendamment de SimClock —
// le compte à rebours du Time-Out tourne en temps réel, pas en temps
// simulé (une vraie pause tactique dure pareil à x1 ou x8).
function updateTimeoutCountdown(dtReal){
  if(!timeoutState.active) return;
  timeoutState.remaining -= dtReal;
  if(timeoutState.remaining<=0){
    timeoutState.active = false;
    updateTimeoutPopup();
    updateTimeoutCoachPanel();
    timeoutVisualGeneration++; clearTimeoutPlanVisuals();
    startRound();
    return;
  }
  updateTimeoutPopup();
}
function timeoutTeamColor(team){ return team.side==='ATTACK' ? TEAM_A_TAG : TEAM_B_TAG; } // rouge=attaque, vert=défense, cohérent avec le reste du HUD
function spawnTimeoutEffect(team){
  const pt = team.side==='ATTACK' ? zones.zone_spawn_atk : zones.zone_spawn_def;
  if(!pt) return;
  const color = timeoutTeamColor(team);
  const g = new BABYLON.TransformNode('timeoutFx', scene);
  const beam = BABYLON.MeshBuilder.CreateCylinder('timeoutBeam', {diameterTop:1, diameterBottom:6, height:14, tessellation:20, cap:BABYLON.Mesh.NO_CAP}, scene);
  beam.material = mkUnlitMat('timeoutBeamMat', color, { opacity:0.35, doubleSided:true, depthWrite:false });
  beam.position.y = 7; beam.parent = g;
  // RingGeometry -> tore fin (pas d'équivalent exact côté Babylon), déjà à
  // plat dans le plan XZ : le rotation.x=-Math.PI/2 d'origine disparaît.
  const ring = BABYLON.MeshBuilder.CreateTorus('timeoutRing', {diameter:3.6, thickness:3.2, tessellation:32}, scene);
  ring.material = mkUnlitMat('timeoutRingMat', color, { opacity:0.6, doubleSided:true });
  ring.position.y = 0.05; ring.parent = g;
  g.position.set(pt.x, 0, pt.z);
  let t=0;
  const anim=()=>{
    t += 0.02;
    beam.material.alpha = Math.max(0, 0.35*(1-t*0.35)) * (0.6+0.4*Math.sin(t*8));
    ring.scaling.setAll(1+t*0.6);
    ring.material.alpha = Math.max(0, 0.6-t*0.15);
    if(t<4) requestAnimationFrame(anim); else g.dispose();
  };
  anim();
}
function pushTimeoutFeedCard(team){
  const el = document.getElementById('killfeed');
  const d = document.createElement('div'); d.className = 'kf-item kf-timeout';
  const sideLabel = team.side==='ATTACK' ? 'Attaque' : 'Défense';
  d.innerHTML = `⏸ <span class="n">${team.name}</span> demande un Time-Out <span class="wpn">(${sideLabel}, ${scoreA}:${scoreB})</span>`;
  el.appendChild(d);
  while(el.children.length>6) el.removeChild(el.firstChild);
}
function updateTimeoutPopup(){
  const p = document.getElementById('timeoutPopup');
  if(!timeoutState.active){ p.classList.remove('show'); return; }
  p.classList.add('show');
  const team = timeoutState.team;
  document.getElementById('toBadge').style.background = '#'+timeoutTeamColor(team).toString(16).padStart(6,'0');
  document.getElementById('toName').textContent = `${team.name} a demandé un Time-Out`;
  document.getElementById('toMeta').textContent = `${team.side==='ATTACK'?'Attaque':'Défense'} — Score ${scoreA}:${scoreB}`;
  const m = Math.floor(Math.max(0,timeoutState.remaining)/60), s = Math.floor(Math.max(0,timeoutState.remaining)%60);
  document.getElementById('toClock').textContent = `${m}:${String(s).padStart(2,'0')}`;
}
function updateTimeoutButton(){
  const btn = document.getElementById('timeoutBtn');
  if(!btn) return;
  const left = timeoutsRemaining(teamA);
  btn.disabled = timeoutState.active || pendingPlayerTimeout || left<=0;
  btn.classList.toggle('active', pendingPlayerTimeout);
  btn.innerHTML = pendingPlayerTimeout ? '<i>⏸</i> Time-Out en attente' : `<i>⏸</i> Time-Out (${left})`;
}
function updateTimeoutCounters(){
  const otPhase = roundNumber>24;
  document.getElementById('sbTimeoutA').textContent = otPhase ? `OT TO: ${teamA.timeoutsOT}` : `${teamA.side==='ATTACK'?'ATK':'DEF'} TO: ${teamA.timeoutsBySide[teamA.side]}`;
  document.getElementById('sbTimeoutB').textContent = otPhase ? `OT TO: ${teamB.timeoutsOT}` : `${teamB.side==='ATTACK'?'ATK':'DEF'} TO: ${teamB.timeoutsBySide[teamB.side]}`;
  updateTimeoutButton();
}
function updateTimeoutHistoryPanel(){
  const list = document.getElementById('timeoutHistoryList');
  if(!timeoutHistory.length){ list.innerHTML = '<div class="th-empty">Aucun Time-Out pour le moment</div>'; return; }
  list.innerHTML = timeoutHistory.slice().reverse().map(h=>
    `<div class="th-item"><span class="th-round">R${h.round}</span>${h.teamName} — ${h.side==='ATTACK'?'Attaque':'Défense'} (${h.score})</div>`
  ).join('');
}

/* ============================================================
   MODULE: TIME-OUT — CONSIGNE TACTIQUE + ARBRE 3 ROUNDS (étape 2). Le
   coach tape un mot-clé ("Fast B", "Split A"...), reconnu contre une
   table de correspondance vers les leviers RÉELLEMENT consommés par la
   simulation (site visé, intensité, split, fake, biais éco/entrée/
   défense — les mêmes que StrategyEngine.select/decideBuyForAgent/
   pickDefenderSetup) — pas de nouveau système parallèle. L'arbre à 7
   nœuds (racine + 2 + 4) projette l'économie RÉELLE round par round avec
   les mêmes formules que awardEconomy (voir plus haut) : jamais un achat
   recommandé que l'équipe ne pourrait pas vraiment payer.
   ============================================================ */
const TIMEOUT_KEYWORDS = {
  'fast b': { site:'B', intensity:'high' },
  'fast a': { site:'A', intensity:'high' },
  'contact a': { site:'A', intensity:'medium', entryBias:-1 },
  'contact b': { site:'B', intensity:'medium', entryBias:-1 },
  'default': { site:null, intensity:'medium' },
  'split a': { site:'A', intensity:'medium', split:true },
  'split b': { site:'B', intensity:'medium', split:true },
  'fake b -> a': { site:'A', fakeSite:'B', intensity:'medium', fake:true },
  'fake a -> b': { site:'B', fakeSite:'A', intensity:'medium', fake:true },
  'mid control': { site:null, intensity:'medium', mid:true },
  'rush mid': { site:null, intensity:'high', mid:true },
  'double mid': { site:null, intensity:'high', mid:true },
  'slow round': { site:null, intensity:'low' },
  'reprise setup': { site:null, intensity:'low', defenseBias:1 },
  'eco': { site:null, intensity:'low', ecoBias:-2 },
  'force buy': { site:null, intensity:'medium', ecoBias:2 },
  'anti eco': { site:null, intensity:'medium', ecoBias:1 },
  'aggressive ct': { defenseBias:1, intensity:'medium' },
  'passive ct': { defenseBias:-1, intensity:'low' },
  'stack site': { defenseBias:1, intensity:'medium' },
  'fast execute': { site:null, intensity:'high' },
  'lurk setup': { lurk:true, intensity:'medium' },
  // Ajouts (au-delà de la liste fournie) : mêmes leviers, autres angles
  // de coaching fréquents en compétitif.
  'retake setup': { retake:true, defenseBias:1, intensity:'low' },
  'hold angles wide': { defenseBias:0.5, intensity:'low' },
  'hold angles close': { defenseBias:-0.5, intensity:'low' },
  'bait + trade': { entryBias:0.5, intensity:'medium' },
  'full send': { intensity:'high', entryBias:2 },
  'info round': { intensity:'low', lurk:true },
};
function normalizeTimeoutInput(raw){
  return (raw||'').toLowerCase().trim().replace(/→/g,'->').replace(/\s+/g,' ')
    .normalize('NFD').replace(/[̀-ͯ]/g,'');
}
function parseTimeoutKeyword(raw){
  const norm = normalizeTimeoutInput(raw);
  if(!norm) return null;
  let bestKey = null;
  Object.keys(TIMEOUT_KEYWORDS).forEach(k=>{
    if((norm===k || norm.includes(k)) && (!bestKey || k.length>bestKey.length)) bestKey = k;
  });
  return bestKey ? { key:bestKey, ...TIMEOUT_KEYWORDS[bestKey] } : null;
}
// Choix automatique pour un Time-Out déclenché par l'IA (pas de saisie
// humaine) : Eco si l'économie projetée ne permet même pas un Eco Buy,
// sinon un Fast sur le site où l'équipe a perdu le MOINS récemment
// (siteMemory, déjà utilisé par pickDefenderSetup/StrategyEngine).
function autoPickTimeoutKeyword(team){
  const perPlayer = team.economy / Math.max(1,team.agents.length);
  if(perPlayer < NEXUS_WEAPONS.eco.cost) return { key:'eco', ...TIMEOUT_KEYWORDS['eco'] };
  const avoidSite = team.siteMemory.A.recentLosses > team.siteMemory.B.recentLosses ? 'b' : 'a';
  const key = 'fast '+avoidSite;
  return { key, ...TIMEOUT_KEYWORDS[key] };
}
// Palier d'achat pour un montant NX/joueur donné — MÊME logique que
// decideBuyForAgent (voir plus haut), sans rien consommer : l'arbre ne
// doit jamais recommander un palier hors de portée réelle.
function tierForCredits(c){
  if(c>=NEXUS_WEAPONS.hyper.cost) return 'hyper';
  if(c>=NEXUS_WEAPONS.full.cost) return 'full';
  if(c>=NEXUS_WEAPONS.force.cost) return 'force';
  if(c>=NEXUS_WEAPONS.semi.cost) return 'semi';
  if(c>=NEXUS_WEAPONS.eco.cost) return 'eco';
  if(c>=NEXUS_WEAPONS.pistol.cost) return 'pistol';
  return 'save';
}
function buildBuyRecommendation(perPlayerCredits, ecoBias){
  const shifted = perPlayerCredits + (ecoBias||0)*400; // même décalage que decideBuyForAgent
  const tier = tierForCredits(shifted);
  return { tier, label:NEXUS_BUY_LABELS[tier], cost:NEXUS_WEAPONS[tier].cost };
}
function pickSiteAvoidingLosses(team, preferredSite){
  if(preferredSite) return preferredSite;
  return team.siteMemory.A.recentLosses<=team.siteMemory.B.recentLosses ? 'A' : 'B';
}
const TIMEOUT_ABILITY_LABELS = { SMOKE:'fumées', FLASH:'flashs', DAMAGE_ZONE:'zones de dégâts', DAMAGE_BURST:'dégâts directs', SLOW:'ralentissements', STUN:'étourdissements', DEBUFF:'désorientation', REVEAL:'repérage', BUFF:'soutien' };
function utilityNotesFor(team){
  const types = new Set();
  team.agents.forEach(a=>{
    if(!a.kit) return;
    ['a','b'].forEach(key=>{ const t = classifyAbility(a.kit[key]); if(t) types.add(t); });
  });
  if(!types.size) return 'Aucun kit de sorts assigné (agents génériques, pas d\'utilitaire à planifier)';
  return 'Utilitaire disponible : ' + [...types].map(t=>TIMEOUT_ABILITY_LABELS[t]||t).join(', ');
}
function directiveToLabel(directive, site){
  // NB: `site` (2e paramètre) est TOUJOURS résolu à une valeur concrète
  // (voir pickSiteAvoidingLosses, appelé dans node() avant ce label) —
  // pour distinguer "un site a vraiment été demandé" (Fast A/Split B...)
  // de "aucune préférence de site" (Default/Eco/Slow Round...), on doit
  // tester directive.site (le champ D'ORIGINE, potentiellement null),
  // pas `site` qui a toujours une valeur à ce stade.
  if(directive.split) return `Split ${site}`;
  if(directive.fake) return `Fake ${directive.fakeSite} → ${site}`;
  if(directive.retake) return 'Setup Retake';
  if(directive.mid && directive.intensity==='high') return 'Rush Mid';
  if(directive.mid) return 'Contrôle Mid';
  if((directive.ecoBias||0)<=-1) return 'Eco structurée';
  if((directive.ecoBias||0)>=2) return 'Force Buy';
  if(directive.lurk) return 'Lurk Setup';
  if(directive.intensity==='high') return directive.site ? `Fast ${site}` : 'Full Send';
  if(directive.intensity==='low') return directive.site ? `Reprise posée ${site}` : 'Slow Round';
  if(!directive.site) return 'Default';
  return `Contact ${site}`;
}
function objectiveFor(directive, site){
  if(directive.split) return `Diviser l'attention défensive sur ${site} par deux flancs distincts.`;
  if(directive.fake) return `Faire réagir la défense sur ${directive.fakeSite} avant de basculer sur ${site}.`;
  if(directive.retake) return 'Se replier en formation pour un retake coordonné plutôt que défendre en avancé.';
  if(directive.mid) return 'Prendre le contrôle du mid pour garder les deux sites ouverts.';
  if((directive.ecoBias||0)<=-1) return 'Sauver l\'armement pour repartir sur un achat complet au round suivant.';
  if((directive.ecoBias||0)>=2) return 'Casser le rythme adverse avec un armement au-dessus de l\'économie normale.';
  if(directive.lurk) return 'Isoler un joueur en information/flanc pendant que le reste du groupe exécute.';
  if(directive.intensity==='high') return `Prendre ${site||'le site'} rapidement, avant que la défense ne s'installe.`;
  if(directive.intensity==='low') return 'Temporiser, récolter de l\'information avant de s\'engager pleinement.';
  return `Exécution standard sur ${site||'les deux sites'}, adaptée à la lecture défensive du round.`;
}
function keyPointsFor(directive){
  const pts = [];
  if(directive.split) pts.push('Départs synchronisés sur les deux flancs');
  if(directive.fake) pts.push('Faux engagement crédible (utilitaire visible) avant la bascule');
  if(directive.mid) pts.push('Duel mid à gagner avant toute exécution');
  if((directive.ecoBias||0)<=-1) pts.push('Ne pas engager les duels défavorables');
  if((directive.ecoBias||0)>=2) pts.push('Jouer la surprise, ne pas économiser l\'utilitaire');
  if(directive.lurk) pts.push('Lurker isolé, timing communiqué avant le push');
  if(directive.retake) pts.push('Regroupement avant l\'engagement, pas de duel isolé');
  if(directive.intensity==='high') pts.push('Vitesse d\'exécution, pas de swing inutile');
  if(!pts.length) pts.push('Lecture adaptative selon le setup défensif observé en jeu');
  return pts;
}
function winConditionFor(directive, site){
  if((directive.ecoBias||0)<=-1) return 'Round probablement perdu — l\'objectif est l\'économie, pas la victoire';
  if(directive.split) return `Prise de ${site} malgré une défense qui doit se diviser`;
  return `Pose de la Spike sur ${site||'un site'} avec au moins 2 survivants côté attaque`;
}
// Construit les 7 nœuds (racine + 2 + 4) en chaînant l'économie RÉELLE
// round par round (mêmes formules que awardEconomy : +3000 la victoire,
// min(2400,1900+(streak-1)*500) la défaite) — jamais de texte scripté
// déconnecté de ce que l'équipe peut vraiment se payer.
function buildTimeoutTree(team, rootDirective){
  const baseCredits = team.economy / Math.max(1,team.agents.length);
  const baseStreak = team.lossStreak;
  const project = (start, won, streakBefore)=> won
    ? Math.min(NEXUS_MAX, start+3000)
    : Math.min(NEXUS_MAX, start + Math.min(2400, 1900+Math.max(0,streakBefore)*500));
  let uid = 0;
  const node = (label, credits, directive)=>{
    const buy = buildBuyRecommendation(credits, directive.ecoBias);
    const site = pickSiteAvoidingLosses(team, directive.site);
    return {
      _id: 'tton'+(uid++), label, directive, site,
      stratName: directiveToLabel(directive, site),
      objective: objectiveFor(directive, site),
      recommendedBuy: `${buy.label} — ${Math.round(credits)} NX/joueur projetés (palier ${buy.cost} NX)`,
      recommendedUtility: utilityNotesFor(team),
      keyPoints: keyPointsFor(directive),
      winCondition: winConditionFor(directive, site),
      children: { win:null, loss:null },
    };
  };

  const root = node('Round 1', baseCredits, rootDirective);

  const credits2A = project(baseCredits, true, 0);
  const node2A = node('Round 2A', credits2A, { site:root.site, intensity:'medium', mid:true });

  const credits2B = project(baseCredits, false, baseStreak);
  const streakAfterLoss1 = baseStreak+1;
  const canForce2B = credits2B >= NEXUS_WEAPONS.force.cost;
  const node2B = node('Round 2B', credits2B, canForce2B
    ? { site:pickSiteAvoidingLosses(team,null), ecoBias:2 }
    : { ecoBias:-2 });

  root.children.win = node2A; root.children.loss = node2B;

  const credits3A = project(credits2A, true, 0);
  node2A.children.win = node('Round 3A', credits3A, { site:node2A.site, split:true });
  const credits3B = project(credits2A, false, 0);
  node2A.children.loss = node('Round 3B', credits3B, { site:pickSiteAvoidingLosses(team,null), intensity:'medium', entryBias:-1 });

  const credits3C = project(credits2B, true, 0);
  node2B.children.win = node('Round 3C', credits3C, { site:node2B.site, intensity:'high', mid:true });
  const credits3D = project(credits2B, false, streakAfterLoss1);
  const canForce3D = credits3D >= NEXUS_WEAPONS.force.cost;
  node2B.children.loss = node('Round 3D', credits3D, canForce3D ? { ecoBias:1 } : { ecoBias:-2, intensity:'low' });

  return root;
}
let currentTimeoutTree = null, selectedTreeNodeId = null;
function findTimeoutNodeById(node, id){
  if(!node) return null;
  if(node._id===id) return node;
  return findTimeoutNodeById(node.children.win, id) || findTimeoutNodeById(node.children.loss, id);
}
function renderTimeoutTreeNodeHtml(node, depth, branchLabel){
  let html = `<div class="tt-row" style="padding-left:${depth*14}px">`
    + (branchLabel ? `<span class="tt-branch tt-${branchLabel==='win'?'win':'loss'}">${branchLabel==='win'?'Victoire':'Défaite'}</span>` : '')
    + `<span class="tt-node" data-id="${node._id}">${node.label} — ${node.stratName}</span></div>`;
  if(node.children.win) html += renderTimeoutTreeNodeHtml(node.children.win, depth+1, 'win');
  if(node.children.loss) html += renderTimeoutTreeNodeHtml(node.children.loss, depth+1, 'loss');
  return html;
}
function renderTimeoutNodeDetail(node){
  const el = document.getElementById('timeoutNodeDetail');
  if(!node){ el.innerHTML = '<div class="td-empty">Sélectionne un round dans l\'arbre</div>'; return; }
  el.innerHTML = `
    <div class="td-title">${node.label} — ${node.stratName}</div>
    <div class="td-row"><b>Objectif</b><span>${node.objective}</span></div>
    <div class="td-row"><b>Achats recommandés</b><span>${node.recommendedBuy}</span></div>
    <div class="td-row"><b>Utilitaires</b><span>${node.recommendedUtility}</span></div>
    <div class="td-row"><b>Points clés</b><span>${node.keyPoints.join(' · ')}</span></div>
    <div class="td-row"><b>Condition de succès</b><span>${node.winCondition}</span></div>
  `;
}
/* ============================================================
   MODULE: TIME-OUT — VISUALISATION 3D DU PLAN (étape 4). Pour le nœud
   d'arbre actuellement sélectionné, dessine sur la vraie carte les
   trajectoires calculées par le MÊME pathfinding que celui qui déplace
   réellement les agents (findPath/nearestNode, voir Agent.goTo) — jamais
   des lignes droites arbitraires — plus des icônes d'utilitaire aux
   sites concernés, dérivées du vrai kit de l'équipe. Purement visuel,
   aucun effet sur la simulation ; nettoyé à chaque changement de nœud et
   à la fin du Time-Out (voir timeoutVisualGeneration, qui invalide les
   animations en cours sans avoir à les traquer une par une).
   ============================================================ */
let timeoutPlanVisuals = [];
let timeoutVisualGeneration = 0;
function clearTimeoutPlanVisuals(){
  timeoutPlanVisuals.forEach(v=> v.dispose());
  timeoutPlanVisuals = [];
}
// Chaîne de cylindres couchés plutôt qu'une vraie ligne : la largeur d'un
// Line (LineBasicMaterial) est ignorée par la plupart des implémentations
// WebGL (limitation connue, pas un bug ici) et resterait quasi invisible
// à l'échelle de la carte — une vraie géométrie 3D reste visible quel que
// soit le navigateur. Même pattern groupe-englobant que makeArrowHead
// (rotation X locale pour coucher à plat, rotation Y du groupe englobant
// pour pointer vers la vraie direction du segment).
function makePathLine(points, color, yOffset=0.12){
  const group = new BABYLON.TransformNode('pathLine', scene);
  const mat = mkUnlitMat('pathLineMat', color, { opacity:0.85 });
  for(let i=0;i<points.length-1;i++){
    const a=points[i], b=points[i+1];
    const dx=b.x-a.x, dz=b.z-a.z, len=Math.hypot(dx,dz);
    if(len<0.05) continue;
    const inner = BABYLON.MeshBuilder.CreateCylinder('pathSeg', {diameterTop:0.3, diameterBottom:0.3, height:len, tessellation:6}, scene);
    inner.material = mat;
    inner.rotation.x = Math.PI/2;
    const outer = new BABYLON.TransformNode('pathSegPivot', scene);
    inner.parent = outer;
    outer.rotation.y = Math.atan2(dx,dz);
    outer.position.set((a.x+b.x)/2, yOffset, (a.z+b.z)/2);
    outer.parent = group;
  }
  timeoutPlanVisuals.push(group);
}
// Flèche à plat (pointe vers +Z local une fois couchée) portée par un
// groupe englobant qui ne fait QUE tourner autour de l'axe vertical
// mondial — sépare le "coucher à plat" (rotation locale X) du "pointer
// dans la direction de déplacement" (rotation Y du groupe englobant),
// sinon les deux rotations composées sur le même objet ne tournent plus
// autour des axes attendus (ordre d'Euler XYZ). Même convention d'angle
// (Math.atan2(dx,dz)) que agent.facing, déjà utilisée partout ailleurs
// dans ce fichier pour orienter un objet dans une direction de trajet.
function makeArrowHead(pos, dirAngle, color){
  const outer = new BABYLON.TransformNode('arrowHead', scene);
  const cone = BABYLON.MeshBuilder.CreateCylinder('arrowCone', {diameterTop:0, diameterBottom:1.0, height:1.3, tessellation:10}, scene);
  cone.material = mkUnlitMat('arrowConeMat', color);
  cone.rotation.x = Math.PI/2;
  cone.parent = outer;
  outer.rotation.y = dirAngle;
  outer.position.set(pos.x, 0.6, pos.z);
  timeoutPlanVisuals.push(outer);
}
// Point lumineux qui parcourt le chemin en boucle — le "timing" du plan,
// rendu comme un travelling animé plutôt qu'un chiffre figé. S'arrête de
// lui-même dès que `gen` ne correspond plus à la génération courante
// (nœud changé, Time-Out terminé) : pas besoin de traquer/annuler cette
// boucle explicitement ailleurs dans le code.
function makeTravelingPulse(points, color, gen){
  const dot = BABYLON.MeshBuilder.CreateSphere('pulse', {diameter:0.52, segments:8}, scene);
  dot.material = mkUnlitMat('pulseMat', color);
  timeoutPlanVisuals.push(dot);
  const totalLen = pathLength(points);
  let t = 0;
  const anim=()=>{
    if(gen!==timeoutVisualGeneration){ dot.dispose(); return; }
    t += 0.007; if(t>1) t=0;
    const pt = pointAlongPath(points, totalLen*t);
    dot.position.set(pt.x, 0.4, pt.z);
    requestAnimationFrame(anim);
  };
  anim();
}
// Le nœud de sol le plus proche d'un point de zone (spawn/site) tombe
// parfois sur un îlot mal connecté au reste du graphe de nav (findPath
// retombe alors sur son filet de sécurité "reste sur place", un chemin
// à 1 seul point) — plutôt que de se contenter du nœud le plus proche,
// on essaie plusieurs candidats du pool le plus proche jusqu'à trouver
// une paire qui produit un vrai chemin exploitable. Repéré en testant
// sur la carte Outpost : le spawn/site le plus proche en distance brute
// n'était pas toujours le mieux connecté.
function resolveTimeoutPathPoints(fromPt, toPt){
  const fromCandidates = nearestNodes(fromPt, 8);
  const toCandidates = nearestNodes(toPt, 8);
  for(const fi of fromCandidates){
    for(const ti of toCandidates){
      const pts = findPath(fi, ti);
      if(pts && pts.length>=2) return pts;
    }
  }
  return null;
}
function drawTimeoutPathAnimated(fromPt, toPt, color, gen){
  if(!fromPt || !toPt) return;
  // Filet de sécurité : sur au moins une carte (Outpost), le spawn
  // d'attaque et un site se sont révélés dans deux régions du graphe de
  // nav totalement déconnectées (bug de rasterisation de la carte,
  // indépendant de cette fonctionnalité — vérifié par un BFS complet,
  // pas juste un échec ponctuel d'A*). Plutôt que de n'afficher aucune
  // trajectoire dans ce cas, on trace une ligne directe indicative — le
  // Time-Out reste utile même si la carte a ce défaut de fond.
  const pts = resolveTimeoutPathPoints(fromPt, toPt) || [fromPt, toPt];
  makePathLine(pts, color);
  const end = pts[pts.length-1], prev = pts[pts.length-2];
  makeArrowHead(end, Math.atan2(end.x-prev.x, end.z-prev.z), color);
  makeTravelingPulse(pts, color, gen);
}
const TIMEOUT_UTIL_MARKER_COLOR = { SMOKE:0xdedede, FLASH:0xffe066, DAMAGE_ZONE:0xff5f5f, DAMAGE_BURST:0xff5f5f, SLOW:0x5ee0c0, STUN:0xffb454, DEBUFF:0xb06dff, REVEAL:0x3dd6ff, BUFF:0x5ee06a };
// Icônes d'utilitaire dérivées du vrai kit de l'équipe (classifyAbility,
// même fonction que le moteur de jeu réel) réparties autour du site visé
// — pas les points de cast exacts d'un round réel (qui dépendent de
// positions d'agents vivants, non pertinent pour un plan hypothétique),
// mais un vrai reflet de ce que CETTE équipe peut effectivement poser.
function drawTimeoutUtilityIcons(team, sitePt, gen){
  if(!sitePt) return;
  const types = new Set();
  team.agents.forEach(a=>{ if(!a.kit) return; ['a','b'].forEach(key=>{ const t=classifyAbility(a.kit[key]); if(t) types.add(t); }); });
  const arr = [...types];
  arr.forEach((t,i)=>{
    const angle = (i/Math.max(1,arr.length))*Math.PI*2;
    const r = 4.5;
    const color = TIMEOUT_UTIL_MARKER_COLOR[t] || 0xffffff;
    const g = new BABYLON.TransformNode('utilIcon', scene);
    // CreateTorus est déjà à plat dans le plan XZ : le rotation.x=-Math.PI/2
    // qui couchait le TorusGeometry de Three n'a plus lieu d'être.
    const ring = BABYLON.MeshBuilder.CreateTorus('utilRing', {diameter:1.0, thickness:0.16, tessellation:20}, scene);
    ring.material = mkUnlitMat('utilRingMat', color, { opacity:0.9 });
    ring.position.y = 0.1; ring.parent = g;
    const core = BABYLON.MeshBuilder.CreateSphere('utilCore', {diameter:0.44, segments:6}, scene);
    core.material = mkUnlitMat('utilCoreMat', color);
    core.position.y = 0.5; core.parent = g;
    g.position.set(sitePt.x+Math.cos(angle)*r, 0, sitePt.z+Math.sin(angle)*r);
    timeoutPlanVisuals.push(g);
  });
}
function renderTimeoutPlanVisuals(node){
  timeoutVisualGeneration++;
  clearTimeoutPlanVisuals();
  if(!node || !timeoutState.active) return;
  const team = timeoutState.team;
  const spawnPt = team.side==='ATTACK' ? zones.zone_spawn_atk : zones.zone_spawn_def;
  if(!spawnPt) return;
  const gen = timeoutVisualGeneration;
  const directive = node.directive;
  // directive.site (le champ D'ORIGINE, potentiellement null pour Default/
  // Eco/Slow Round...) — PAS node.site, qui est toujours résolu à une
  // valeur concrète via pickSiteAvoidingLosses (voir buildTimeoutTree) —
  // même correction que directiveToLabel plus haut, sinon un "Eco" sans
  // site précis dessinait une seule trajectoire ciblée au lieu des deux
  // ouvertures possibles.
  const targetSite = directive.site ? zones['zone_site'+directive.site] : null;
  const siteA = zones.zone_siteA, siteB = zones.zone_siteB;

  if(directive.split && targetSite){
    const { flankA, flankB } = twoFlanks(targetSite);
    if(flankA.length) drawTimeoutPathAnimated(spawnPt, floorNodes[flankA[0]], ROLE_ACCENT_COLOR.Duelist, gen);
    if(flankB.length) drawTimeoutPathAnimated(spawnPt, floorNodes[flankB[0]], ROLE_ACCENT_COLOR.Initiator, gen);
  } else if(directive.fake && targetSite){
    const fakeSite = zones['zone_site'+directive.fakeSite];
    drawTimeoutPathAnimated(spawnPt, fakeSite, ROLE_ACCENT_COLOR.Flex, gen);
    drawTimeoutPathAnimated(spawnPt, targetSite, ROLE_ACCENT_COLOR.Duelist, gen);
  } else if(targetSite){
    drawTimeoutPathAnimated(spawnPt, targetSite, ROLE_ACCENT_COLOR.Duelist, gen);
    if(directive.lurk){
      const otherSite = node.site==='A' ? siteB : siteA;
      drawTimeoutPathAnimated(spawnPt, otherSite, ROLE_ACCENT_COLOR.Sentinel, gen);
    }
  } else {
    // Pas de site précis (Default/Eco/Slow Round...) : les deux ouvertures
    // restent possibles, affichées toutes les deux dans une même couleur
    // neutre plutôt que de trancher arbitrairement pour l'une.
    drawTimeoutPathAnimated(spawnPt, siteA, ROLE_ACCENT_COLOR.Controller, gen);
    drawTimeoutPathAnimated(spawnPt, siteB, ROLE_ACCENT_COLOR.Controller, gen);
  }
  drawTimeoutUtilityIcons(team, targetSite || siteA, gen);
}

function selectTimeoutTreeNode(id){
  if(!currentTimeoutTree) return;
  const node = findTimeoutNodeById(currentTimeoutTree, id);
  if(!node) return;
  selectedTreeNodeId = id;
  document.querySelectorAll('#timeoutTreeView .tt-node').forEach(el=> el.classList.toggle('selected', el.dataset.id===id));
  renderTimeoutNodeDetail(node);
  renderTimeoutPlanVisuals(node);
}
function renderTimeoutTree(root){
  document.getElementById('timeoutTreeView').innerHTML = renderTimeoutTreeNodeHtml(root, 0, null);
  document.querySelectorAll('#timeoutTreeView .tt-node').forEach(el=>{
    el.addEventListener('click', ()=> selectTimeoutTreeNode(el.dataset.id));
  });
  selectTimeoutTreeNode(root._id);
}
/* ============================================================
   MODULE: TIME-OUT — ASSISTANT COACH (étape 3). Note automatiquement
   chaque mot-clé de TIMEOUT_KEYWORDS sur des signaux RÉELLEMENT suivis
   par la simulation (aucune donnée inventée) : historique de réussite
   par stratégie (StrategyEngine.results, déjà alimenté par
   recordResult), siteMemory (déjà utilisé par le vrai moteur de
   stratégie/défense), écart d'économie réel entre les deux équipes,
   série de défaites en cours (team.lossStreak). Le score le plus élevé
   devient la recommandation, converti en % de confiance affiché avec
   les 2-3 signaux qui ont le plus pesé dans la décision.
   ============================================================ */
// Quelques mots-clés correspondent directement à une stratégie nommée du
// vrai moteur (ROUND_STRATEGIES) : leur historique réel de victoires/
// défaites (StrategyEngine.results) est alors un signal disponible.
const TIMEOUT_TO_STRATEGY_NAME = {
  'fast a':'Rush A', 'fast b':'Rush B', 'split a':'Split A', 'split b':'Split B',
  'default':'Default', 'mid control':'Prise mid', 'rush mid':'Prise mid', 'double mid':'Prise mid',
  'fake b -> a':'Fake B → A', 'fake a -> b':'Fake A → B',
};
function scoreTimeoutOption(team, enemyTeam, key, directive){
  let score = 0;
  const reasons = [];
  const stratName = TIMEOUT_TO_STRATEGY_NAME[key];
  if(stratName && team.strategy.results[stratName]){
    const r = team.strategy.results[stratName];
    const total = r.wins+r.losses;
    if(total>0){
      const winRate = r.wins/total;
      const weight = Math.abs(winRate-0.5)*24;
      score += (winRate-0.5)*24;
      reasons.push({ text:`${stratName} réussi ${r.wins}/${total} dernières fois`, weight });
    }
  }
  const perPlayer = team.economy/Math.max(1,team.agents.length);
  const enemyPerPlayer = enemyTeam.economy/Math.max(1,enemyTeam.agents.length);
  if((directive.ecoBias||0)>=1){
    if(enemyPerPlayer < NEXUS_WEAPONS.semi.cost){ score += 9; reasons.push({ text:`économie adverse limitée (~${Math.round(enemyPerPlayer)} NX/joueur)`, weight:9 }); }
    else { score -= 4; }
  }
  if((directive.ecoBias||0)<=-1){
    if(perPlayer < NEXUS_WEAPONS.semi.cost){ score += 8; reasons.push({ text:`économie propre trop juste pour un achat solide (~${Math.round(perPlayer)} NX/joueur)`, weight:8 }); }
    else { score -= 5; }
  }
  if(directive.site){
    const mem = team.siteMemory[directive.site].recentLosses;
    const otherSite = directive.site==='A' ? 'B' : 'A';
    const otherMem = team.siteMemory[otherSite].recentLosses;
    if(mem<otherMem){ const w=(otherMem-mem)*3.5; score+=w; reasons.push({ text:`défense adverse plus perméable sur ${directive.site} (${mem} perte(s) récente(s) contre ${otherMem} sur ${otherSite})`, weight:w }); }
    else if(mem>otherMem) score -= (mem-otherMem)*3.5;
  }
  if(team.lossStreak>=2){
    if(directive.split || directive.fake || (directive.ecoBias||0)>=1){ score += 6; reasons.push({ text:`série de ${team.lossStreak} défaites — casser le rythme plutôt que répéter`, weight:6 }); }
    else if(!directive.site && !directive.ecoBias && !directive.mid) score -= 3; // Default plat peu adapté à une série de défaites
  }
  return { score, reasons };
}
function getAssistantCoachRecommendation(team){
  const enemyTeam = team===teamA ? teamB : teamA;
  let best = null;
  Object.keys(TIMEOUT_KEYWORDS).forEach(key=>{
    const directive = TIMEOUT_KEYWORDS[key];
    const { score, reasons } = scoreTimeoutOption(team, enemyTeam, key, directive);
    if(!best || score>best.score) best = { key, directive, score, reasons };
  });
  const confidence = Math.max(15, Math.min(95, Math.round(50+best.score)));
  const topReasons = best.reasons.slice().sort((a,b)=>b.weight-a.weight).slice(0,3).map(r=>r.text);
  return { key:best.key, directive:best.directive, confidence, reasons: topReasons.length?topReasons:['Aucun signal fort disponible — choix par défaut prudent'] };
}
function riskLabelFor(directive){
  if((directive.ecoBias||0)>=2) return 'Élevé (mise économique)';
  if(directive.split || directive.fake) return 'Moyen (coordination requise)';
  if((directive.ecoBias||0)<=-1) return 'Faible (round sacrifié pour l\'économie)';
  return 'Modéré';
}
function timeoutKeywordDisplayName(key){ return key.replace(/\b\w/g, c=>c.toUpperCase()); }
function renderAssistantRecommendation(rec){
  const box = document.getElementById('timeoutAssistantBox');
  box.style.display = 'block';
  document.getElementById('abRecText').textContent = timeoutKeywordDisplayName(rec.key);
  document.getElementById('abConfidence').textContent = rec.confidence+'%';
  document.getElementById('abRisk').textContent = riskLabelFor(rec.directive);
  document.getElementById('abReasons').innerHTML = rec.reasons.map(r=>`<li>${r}</li>`).join('');
}
function hideAssistantRecommendation(){ document.getElementById('timeoutAssistantBox').style.display = 'none'; }
let assistantCoachActive = false;
function toggleAssistantCoach(){
  assistantCoachActive = !assistantCoachActive;
  document.getElementById('timeoutAssistantBtn').classList.toggle('active', assistantCoachActive);
  document.getElementById('timeoutKeywordInput').disabled = assistantCoachActive;
  document.getElementById('timeoutGenerateBtn').textContent = assistantCoachActive ? 'Actualiser la recommandation' : 'Générer le plan';
  generateTimeoutPlan();
}
function generateTimeoutPlan(){
  const team = timeoutState.team;
  if(!team) return;
  let directive;
  const warn = document.getElementById('timeoutKeywordWarning');
  if(team===teamA && assistantCoachActive){
    const rec = getAssistantCoachRecommendation(team);
    directive = rec.directive;
    document.getElementById('timeoutKeywordInput').value = timeoutKeywordDisplayName(rec.key);
    warn.style.display = 'none';
    renderAssistantRecommendation(rec);
  } else if(team===teamA){
    hideAssistantRecommendation();
    const raw = document.getElementById('timeoutKeywordInput').value;
    directive = parseTimeoutKeyword(raw);
    if(!directive){
      warn.textContent = raw.trim()
        ? 'Consigne non reconnue — essaie : Fast B, Split A, Default, Eco, Force Buy, Mid Control...'
        : '';
      warn.style.display = raw.trim() ? 'block' : 'none';
      directive = { site:null, intensity:'medium' }; // repli : Default
    } else {
      warn.style.display = 'none';
    }
  } else {
    hideAssistantRecommendation();
    directive = autoPickTimeoutKeyword(team);
  }
  currentTimeoutTree = buildTimeoutTree(team, directive);
  renderTimeoutTree(currentTimeoutTree);
}
function updateTimeoutCoachPanel(){
  const panel = document.getElementById('timeoutCoachPanel');
  if(!timeoutState.active){ panel.classList.remove('show'); return; }
  panel.classList.add('show');
  const isPlayer = timeoutState.team===teamA;
  document.getElementById('timeoutInputRow').style.display = isPlayer ? 'flex' : 'none';
  document.getElementById('timeoutAssistantBtn').style.display = isPlayer ? 'inline-flex' : 'none';
  document.getElementById('timeoutCoachHead').textContent = isPlayer
    ? '🧠 Coaching tactique — tape ta consigne (ex. Fast B, Split A, Eco...)'
    : `🧠 Coaching tactique — plan de ${timeoutState.team.name} (IA)`;
  if(!currentTimeoutTree && (!isPlayer || assistantCoachActive)) generateTimeoutPlan();
}

function startRound(){
  roundNumber++;
  if(roundNumber===13) swapSides(); // mi-match : changement de côté officiel
  phase='SETUP'; planted=false; spikeSite=null; spikePos=null; plantT=null; defuseStartT=null; defusingAgent=null; plantingAgent=null; plantStartT=null; rotationTriggered=false; spikeRushSent=false;
  removeSpikeMesh();
  raiseSpawnBarriers(); // murs bleus de spawn — personne ne bouge tant que phase==='SETUP' (voir tickRound)
  attackTeam.blackboard.clear(); defendTeam.blackboard.clear();
  clearDeathMarkers();
  clearAllUtility(); // fumées/pièges du round précédent ne doivent pas persister
  document.getElementById('killfeed').innerHTML = ''; // les kills du round précédent ne doivent pas trainer dans le nouveau
  roundStartT = SimClock.now();
  // Journal de kills + compteurs kill/assist DE LA MANCHE (pas les totaux
  // cumulés .kills/.assists) : remis à zéro à chaque nouvelle manche, voir
  // endRound pour le calcul KAST/premier kill/clutch qui s'appuie dessus.
  roundKillEvents = [];
  [...attackTeam.agents, ...defendTeam.agents].forEach(a=>{ a._roundAssists = 0; });

  // ---- ÉCONOMIE : phase d'achat avant le spawn ----
  const atkBuy = decideBuy(attackTeam), defBuy = decideBuy(defendTeam);
  log(`💰 Attaque : ${atkBuy} (${attackTeam.economy} NX restants) — Défense : ${defBuy} (${defendTeam.economy} NX restants)`);

  // ---- SPAWN : aucune position conservée du round précédent ----
  const spAtk = zones.zone_spawn_atk, spDef = zones.zone_spawn_def;
  const atkSpawnNodes = nearestNodes(spAtk,5), defSpawnNodes = nearestNodes(spDef,5);
  attackTeam.agents.forEach((a,i)=> a.respawn(floorNodes[atkSpawnNodes[i]]));
  defendTeam.agents.forEach((a,i)=> a.respawn(floorNodes[defSpawnNodes[i]]));

  // ---- STRATÉGIE (VARIABILITÉ + MÉMOIRE) ----
  const strat = attackTeam.strategy.select(roundNumber, attackTeam.economy, scoreA, scoreB, attackTeam.siteMemory, attackTeam.entryDoctrine||0);
  attackTeam.currentStrategy = strat;
  log(`🧠 Attaque : ${strat.name}`);

  const defSetup = pickDefenderSetup();
  let cursor = 0;
  ['A','B'].forEach(site=>{
    const n = defSetup[site];
    const nodes = spreadNodes(zones['zone_site'+site], n, 3.5, 30);
    for(let k=0;k<n;k++){
      const a = defendTeam.agents[cursor++];
      a._assignedSite = site;
      const nodeIdx = nodes[k % nodes.length];
      a.goTo(nodeIdx);
      // Zone de contrôle sur la position de tenue : le VRAI sort du
      // défenseur s'il en a un adapté (piège/zone/repérage — A ou B
      // acheté ce round), sinon repli générique pour le Sentinel qui
      // ancre son site (rôle sans kit résolu, ex. IA adverse générique).
      const holdPt = floorNodes[nodeIdx];
      let castHold = false;
      if(a.kit){
        ['a','b'].forEach(key=>{
          if(castHold || !a.ownedAbilities[key]) return;
          const type = classifyAbility(a.kit[key]);
          if(type==='SLOW' || type==='DAMAGE_ZONE' || type==='REVEAL' || type==='SMOKE'){
            castAbility(a, a.kit[key], holdPt, defendTeam, attackTeam, log);
            castHold = true;
          }
        });
      }
      if(!castHold && a.playstyle==='Sentinel Ancre') deployTrap(holdPt, a.stats.utility, defendTeam);
    }
  });

  const primarySite = strat.sites[0];
  const targetIdxPrimary = nearestNode(zones['zone_site'+primarySite]);
  if(strat.split){
    // Deux sous-groupes qui arrivent par deux flancs différents, chacun
    // tenant un nœud distinct — pas deux joueurs empilés au même point.
    const siteCenter = zones['zone_site'+primarySite];
    const { flankA, flankB } = twoFlanks(siteCenter);
    const groupA = spreadFromList(tacticalSort(flankA, siteCenter), 3, 3.0), groupB = spreadFromList(tacticalSort(flankB, siteCenter), 2, 3.0);
    attackTeam.agents.forEach((a,i)=>{ a.goTo((i<3 ? groupA[i%groupA.length] : groupB[(i-3)%groupB.length]) ?? targetIdxPrimary); });
    if(attackTeam.agents.some(a=>a.kit)){
      castEntryUtility(attackTeam, defendTeam, zones['zone_site'+primarySite], log);
    } else {
      // Repli générique (aucun kit résolu, ex. simulation autonome hors
      // manager) : fumée/flash par moyenne d'utility de rôle, comme avant.
      const utilSplit = teamAvgUtility(attackTeam);
      deploySmoke(zones['zone_site'+primarySite], utilSplit);
      log(`🌫️ Controller ouvre les fumées — entrée split ${primarySite}`);
      if(Math.random() < 0.3+utilSplit/100*0.35) deployFlash(zones['zone_site'+primarySite], utilSplit, defendTeam, log);
    }
  } else {
    // Le Lurker ne rejoint pas le pack : il tient l'autre site/le flanc pour
    // guetter une rotation défensive plutôt que de pousser avec le groupe.
    const lurker = attackTeam.agents.find(a=>a.playstyle==='Lurker' && a.alive);
    const pushers = lurker ? attackTeam.agents.filter(a=>a!==lurker) : attackTeam.agents;
    const spread = spreadNodes(zones['zone_site'+primarySite], pushers.length, 3.2, 30);
    pushers.forEach((a,i)=> a.goTo(spread[i%spread.length]));
    if(lurker){
      const secondarySite = primarySite==='A' ? 'B' : 'A';
      const lurkNodes = spreadNodesNear(zones['zone_site'+secondarySite], 1, 2.0, 12, 20);
      lurker.goTo(lurkNodes[0]);
      log(`👤 ${displayNameOf(lurker.name)} lurk côté ${secondarySite}`);
    }
    if(strat.intensity==='high'){
      if(attackTeam.agents.some(a=>a.kit)){
        castEntryUtility(attackTeam, defendTeam, zones['zone_site'+primarySite], log);
      } else {
        const utilPush = teamAvgUtility(attackTeam);
        deploySmoke(zones['zone_site'+primarySite], utilPush);
        if(Math.random() < 0.3+utilPush/100*0.35) deployFlash(zones['zone_site'+primarySite], utilPush, defendTeam, log);
      }
    }
    if(strat.name==='Default' || strat.name==='Prise mid') log('ℹ️ Initiator récupère de l\'information avant l\'exécution');
  }
  tryCastUltimates(attackTeam, zones['zone_site'+primarySite], true, defendTeam, log);
  if(strat.fake){
    const secondary = strat.sites[1];
    const delay = rand(9,13);
    // +SETUP_TIME : ce délai doit s'écouler une fois la barrière tombée
    // (action réellement en cours), pas depuis roundStartT qui marque le
    // tout début du round, barrière comprise — sinon un délai tiré court
    // (9-10s) pouvait s'être déjà écoulé pendant la barrière elle-même et
    // déclencher le fake instantanément dès la fin de celle-ci.
    attackTeam._fakeSwitch = { at: roundStartT+SETUP_TIME+delay, site: secondary, done:false };
    log(`🎭 Fake ${primarySite} → ${secondary} prévu`);
  } else {
    attackTeam._fakeSwitch = null;
  }
  // phase reste 'SETUP' (posé en tête de cette fonction) : c'est tickRound
  // qui la fait passer à 'LIVE' une fois SETUP_TIME écoulé et la barrière
  // de spawn levée (voir plus haut) — la passer à 'LIVE' ici, tout de
  // suite, annulerait complètement la barrière qu'on vient de poser.
}

function endRound(winnerSide, reason){
  phase='ROUNDEND';
  const attackWon = winnerSide==='ATTACK';
  const winningTeam = attackWon ? attackTeam : defendTeam;
  const losingTeam = attackWon ? defendTeam : attackTeam;
  if(winningTeam===teamA){ scoreA++; roundHistory.push('A'); } else { scoreB++; roundHistory.push('B'); }
  fullRoundLog.push({ winner: winningTeam===teamA?'A':'B', winnerOnAttack: attackWon });
  awardEconomy(winningTeam, losingTeam, planted);
  attackTeam.strategy.recordResult(attackTeam.currentStrategy.name, attackWon);
  const site = spikeSite || attackTeam.currentStrategy.sites[0];
  const mem = attackTeam.siteMemory[site];
  mem.recentLosses = attackWon ? 0 : mem.recentLosses+1;
  // KAST + premier kill/mort + clutch de LA MANCHE qui vient de se terminer,
  // dérivés du vrai déroulé (roundKillEvents) plutôt que ré-estimés après
  // coup : Kill, Assist, Survie, ou Trade (le tueur meurt à son tour dans
  // les 5s) — définition standard de KAST.
  const allAgentsThisRound = [...attackTeam.agents, ...defendTeam.agents];
  const kastIds = new Set();
  roundKillEvents.forEach(e=> kastIds.add(e.killerId));
  allAgentsThisRound.forEach(a=>{ if(a._roundAssists>0) kastIds.add(a.id); if(a.alive) kastIds.add(a.id); });
  roundKillEvents.forEach(e=>{
    const killerTradedWithin5s = roundKillEvents.some(e2=> e2.victimId===e.killerId && e2.time>e.time && e2.time-e.time<=5);
    if(killerTradedWithin5s) kastIds.add(e.victimId);
  });
  allAgentsThisRound.forEach(a=>{ if(kastIds.has(a.id)) a.kastRounds++; });
  if(roundKillEvents.length){
    const first = roundKillEvents[0];
    const firstKiller = allAgentsThisRound.find(a=>a.id===first.killerId);
    const firstVictim = allAgentsThisRound.find(a=>a.id===first.victimId);
    if(firstKiller) firstKiller.firstKills++;
    if(firstVictim) firstVictim.firstDeaths++;
  }
  // Clutch : la manche vient d'être remportée avec un(e) SEUL(E) survivant(e)
  // côté gagnant, sur un effectif d'au moins 2 — proxy simple mais fidèle
  // d'une situation 1vX assumée jusqu'au bout.
  const winnerSurvivors = winningTeam.agents.filter(a=>a.alive);
  if(winnerSurvivors.length===1 && winningTeam.agents.length>=2) winnerSurvivors[0].clutchesWon++;
  updateScoreboard();
  showBanner(attackWon ? 'Attaque remporte la manche' : 'Défense remporte la manche', reason);
  log(`🏁 Fin de manche (${reason}) — ${scoreA}:${scoreB}`);
  setTimeout(()=>{
    // Règle officielle : premier à 13, sauf égalité 12-12 → prolongation,
    // gagnée par 2 manches d'écart (pas de plafond fixe une fois en OT).
    const inOvertime = scoreA>=12 && scoreB>=12;
    const matchOver = inOvertime ? Math.abs(scoreA-scoreB)>=2 : (scoreA>=MATCH_TARGET || scoreB>=MATCH_TARGET);
    if(matchOver){
      phase='MATCHEND';
      showBanner(scoreA>scoreB?'Équipe A remporte le match':'Équipe B remporte le match', `${scoreA} : ${scoreB}`);
      // Camp dominant/série la plus longue à partir de fullRoundLog (jamais
      // remis à zéro à la mi-temps, contrairement à roundHistory) — mêmes
      // règles que simulateMapForTeams (script.js) : streak>0 compte pour A,
      // <0 pour B, "camp dominant" = celui qui gagne le plus de rounds sur
      // ce camp précis, tous rounds confondus (les deux équipes jouent
      // chaque camp une mi-temps). Calculé ici (pas côté script.js) car
      // fullRoundLog ne sort jamais de cet iframe.
      let sideWinsA={atk:0,def:0}, sideWinsB={atk:0,def:0}, streakEnd=0, maxStreakA=0, maxStreakB=0;
      fullRoundLog.forEach(r=>{
        if(r.winner==='A'){ sideWinsA[r.winnerOnAttack?'atk':'def']++; streakEnd = streakEnd>0?streakEnd+1:1; }
        else { sideWinsB[r.winnerOnAttack?'atk':'def']++; streakEnd = streakEnd<0?streakEnd-1:-1; }
        maxStreakA = Math.max(maxStreakA, streakEnd>0?streakEnd:0);
        maxStreakB = Math.max(maxStreakB, streakEnd<0?-streakEnd:0);
      });
      const attackDominant = (sideWinsA.atk>=sideWinsB.atk) ? teamA.name : teamB.name;
      const defenseDominant = (sideWinsA.def>=sideWinsB.def) ? teamA.name : teamB.name;
      // Résultat renvoyé au manager (voir listener 'matchInit' plus haut) :
      // mêmes champs (K/D/A par joueur, nommés) que ceux déjà consommés
      // par les stats de saison/classements/finances côté script.js, pour
      // que ce moteur puisse s'y brancher sans toucher à cette logique.
      if(window.parent !== window) window.parent.postMessage({
        type:'matchResult',
        winner: scoreA>scoreB ? 'A' : 'B',
        scoreA, scoreB,
        // Stats RÉELLEMENT accumulées pendant le match (voir Agent, plus
        // haut) — script.js (deriveStatsFromAIResult) doit les utiliser
        // directement plutôt que de ré-estimer ADR/KAST/HS%/premiers kills/
        // clutchs à partir des seuls attributs du joueur.
        statsA: teamA.agents.map(a=>({ name:a.name, kills:a.kills, deaths:a.deaths, assists:a.assists,
          damageDealt:Math.round(a.damageDealt), hitsTotal:a.hitsTotal, hitsHead:a.hitsHead,
          kastRounds:a.kastRounds, firstKills:a.firstKills, firstDeaths:a.firstDeaths, clutchesWon:a.clutchesWon })),
        statsB: teamB.agents.map(a=>({ name:a.name, kills:a.kills, deaths:a.deaths, assists:a.assists,
          damageDealt:Math.round(a.damageDealt), hitsTotal:a.hitsTotal, hitsHead:a.hitsHead,
          kastRounds:a.kastRounds, firstKills:a.firstKills, firstDeaths:a.firstDeaths, clutchesWon:a.clutchesWon })),
        attackDominant, defenseDominant, maxStreakA, maxStreakB,
      }, '*');
    } else {
      if(inOvertime) log(`⏱️ Prolongation — ${scoreA}:${scoreB}`);
      // Time-Out : toujours à la coupure entre deux rounds, jamais en plein
      // combat — le joueur passe en priorité s'il a déjà demandé (bouton),
      // sinon l'IA adverse peut en demander un elle-même dans certaines
      // situations (voir maybeCallAiTimeout). L'un ou l'autre démarre déjà
      // la séquence lui-même (startTimeout) ; sinon, round suivant normal.
      if(pendingPlayerTimeout) startTimeout(teamA);
      else if(!maybeCallAiTimeout()) startRound();
    }
  }, ffMode ? 30 : 2200/SimClock.speed);
}

function tickRound(dt){
  if(phase==='SETUP' && SimClock.now()-roundStartT>=SETUP_TIME){
    phase='LIVE';
    lowerSpawnBarriers();
  }
  if(phase!=='SETUP' && phase!=='LIVE' && phase!=='POSTPLANT') return;
  const ctx = { round:roundNumber, onKill, log, rotationTriggered };
  if(phase==='SETUP'){
    // Barrière de spawn : les agents se déplacent normalement vers leurs
    // positions de tenue/entrée (tickAgent tourne comme en LIVE, ils
    // peuvent donc se mettre en place) mais restent "laissés" (leash)
    // dans SPAWN_BARRIER_RADIUS autour du spawn de LEUR équipe tant que
    // la barrière est levée — correction demandée après un premier essai
    // qui figeait tout le monde entièrement. Combat/plant/défusage/
    // rotations restent désactivés ici (de toute façon hors de portée :
    // les deux spawns sont bien plus éloignés l'un de l'autre que ce
    // rayon, personne ne peut voir l'adversaire pendant la barrière).
    //
    // IMPORTANT : la position d'un agent en mouvement est DÉRIVÉE de
    // agent.pathDist (voir tickAgent, pointAlongPath) — se contenter de
    // ramener agent.pos au bord du rayon après coup ne suffit pas,
    // pathDist continuerait d'avancer normalement en coulisses (invisible,
    // "gratuit") pendant toute la barrière, et l'agent TÉLÉPORTERAIT à
    // sa position réelle (10s de marche non bridée) dès la chute du mur.
    // On restaure donc pathDist ET pos ensemble dès que le tick dépasse
    // le rayon, comme si l'agent butait vraiment contre le mur ce tick-ci.
    const spAtk = zones.zone_spawn_atk, spDef = zones.zone_spawn_def;
    const tickLeashed = (agent, team, enemyTeam, spawn)=>{
      const prevPathDist = agent.pathDist, prevX = agent.pos.x, prevZ = agent.pos.z;
      tickAgent(agent, team, enemyTeam, ctx, dt);
      const dx=agent.pos.x-spawn.x, dz=agent.pos.z-spawn.z;
      if(Math.hypot(dx,dz) > SPAWN_BARRIER_RADIUS){
        agent.pathDist = prevPathDist;
        agent.pos.x = prevX; agent.pos.z = prevZ;
        agent.speed = 0;
      }
    };
    attackTeam.agents.forEach(a=> tickLeashed(a, attackTeam, defendTeam, spAtk));
    defendTeam.agents.forEach(a=> tickLeashed(a, defendTeam, attackTeam, spDef));
    separateAgents(dt);
    // Filet de sécurité purement visuel après la résolution de collisions
    // (separateAgents peut légèrement pousser un agent hors du rayon) —
    // ne touche jamais pathDist, un micro-ajustement de position ici est
    // sans conséquence sur la reprise du chemin ensuite.
    const clampVisual = (agent, spawn)=>{
      const dx=agent.pos.x-spawn.x, dz=agent.pos.z-spawn.z, dist=Math.hypot(dx,dz);
      if(dist>SPAWN_BARRIER_RADIUS){ const k=SPAWN_BARRIER_RADIUS/dist; agent.pos.x=spawn.x+dx*k; agent.pos.z=spawn.z+dz*k; }
    };
    attackTeam.agents.forEach(a=> clampVisual(a, spAtk));
    defendTeam.agents.forEach(a=> clampVisual(a, spDef));
    return;
  }
  const elapsed = SimClock.now()-roundStartT;
  updateSpikeVisual();
  pruneExpiredSmokes();
  applyDamageZones(dt, roundNumber);

  // Fake → bascule physique vers l'autre site (jamais instantanée : un
  // nouveau chemin est recalculé depuis la position actuelle).
  if(attackTeam._fakeSwitch && !attackTeam._fakeSwitch.done && SimClock.now()>=attackTeam._fakeSwitch.at){
    const aliveAtk = attackTeam.agents.filter(a=>a.alive);
    const switchNodes = spreadNodes(zones['zone_site'+attackTeam._fakeSwitch.site], aliveAtk.length, 3.2, 30);
    aliveAtk.forEach((a,i)=> a.goTo(switchNodes[i%switchNodes.length]));
    attackTeam._fakeSwitch.done = true;
    log(`↩️ Rotation vers ${attackTeam._fakeSwitch.site} après le fake`);
  }

  attackTeam.agents.forEach(a=> tickAgent(a, attackTeam, defendTeam, ctx, dt));
  defendTeam.agents.forEach(a=> tickAgent(a, defendTeam, attackTeam, ctx, dt));
  separateAgents(dt);
  rotationTriggered = ctx.rotationTriggered || rotationTriggered;
  if(phase==='LIVE') maybeRotateDefenders(defendTeam, {rotationTriggered, log:(m)=>{log(m); rotationTriggered=true;}});

  // ---- Détection de plant : un attaquant vivant arrivé sur le site,
  // en l'absence de défenseur vivant à portée immédiate, canalise la pose
  // pendant PLANT_TIME (interrompue s'il meurt, s'éloigne ou est engagé). ----
  if(!planted && phase==='LIVE'){
    const site = attackTeam.currentStrategy.sites[attackTeam._fakeSwitch?.done ? 1 : 0] || attackTeam.currentStrategy.sites[0];
    const sitePt = zones['zone_site'+site];
    if(plantingAgent){
      const stillValid = plantingAgent.alive && plantingAgent.state!=='COMBAT' && Math.hypot(plantingAgent.pos.x-sitePt.x,plantingAgent.pos.z-sitePt.z)<4.6;
      if(!stillValid){ plantingAgent=null; plantStartT=null; }
    }
    if(!plantingAgent){
      const planter = attackTeam.agents.find(a=>a.alive && Math.hypot(a.pos.x-sitePt.x,a.pos.z-sitePt.z)<4.2 && a.state!=='COMBAT');
      if(planter){ plantingAgent=planter; plantStartT=SimClock.now(); log(`💣 ${displayNameOf(planter.name)} pose la spike...`); }
    } else if(SimClock.now()-plantStartT >= PLANT_TIME){
      planted = true; spikeSite = site; spikePos = {x:sitePt.x,z:sitePt.z}; plantT = SimClock.now();
      phase='POSTPLANT';
      spawnSpikeMesh(spikePos);
      log(`💣 Spike posée au site ${site} par ${displayNameOf(plantingAgent.name)}`);
      // Post-plant : attaquants vivants prennent des positions de tenue
      // autour du site ; défenseurs reviennent tenter le retake.
      const aliveAtkPP = attackTeam.agents.filter(a=>a.alive), aliveDefRT = defendTeam.agents.filter(a=>a.alive);
      // Tenue post-plant resserrée autour de la spike (< 5u, sous le rayon
      // de contestation de 6u) : les attaquants doivent pouvoir intercepter
      // tout défenseur qui approche pour désamorcer, pas juste "être sur le site".
      const holdNodes = spreadNodesNear(sitePt, aliveAtkPP.length, 1.8, 5.0, 24);
      const retakeNodes = spreadNodes(sitePt, aliveDefRT.length, 3.0, 20);
      aliveAtkPP.forEach((a,i)=>{ a.goTo(holdNodes[i%holdNodes.length]); a.state='POSTPLANT'; });
      aliveDefRT.forEach((a,i)=>{ a.goTo(retakeNodes[i%retakeNodes.length]); a.state='RETAKE'; });
      plantingAgent=null; plantStartT=null;
    }
  }

  // ---- Défusage ----
  if(planted && !defusingAgent){
    const defuser = defendTeam.agents.find(a=>a.alive && Math.hypot(a.pos.x-spikePos.x,a.pos.z-spikePos.z)<2.2 && !attackTeam.agents.some(x=>x.alive && Math.hypot(x.pos.x-spikePos.x,x.pos.z-spikePos.z)<6));
    if(defuser){ defusingAgent=defuser; defuseStartT=SimClock.now(); log(`🔧 ${displayNameOf(defuser.name)} désamorce...`); }
    else if(attackTeam.alive().length===0){
      // Plus aucun attaquant vivant : rien ne justifie plus de tenir une
      // position de retake à distance — un défenseur doit activement
      // rejoindre la spike, plutôt que d'attendre passivement de s'y
      // trouver par hasard (le point de retake assigné n'est pas garanti
      // à portée de désamorçage, voir spreadNodes ci-dessus).
      if(!spikeRushSent){
        const rusher = defendTeam.agents.filter(a=>a.alive).sort((a,b)=>Math.hypot(a.pos.x-spikePos.x,a.pos.z-spikePos.z)-Math.hypot(b.pos.x-spikePos.x,b.pos.z-spikePos.z))[0];
        if(rusher){ rusher.goTo(nearestNode(spikePos)); spikeRushSent=true; log(`🏃 ${displayNameOf(rusher.name)} se rue vers la spike pour désamorcer.`); }
      }
    }
  }
  if(defusingAgent){
    if(!defusingAgent.alive || Math.hypot(defusingAgent.pos.x-spikePos.x,defusingAgent.pos.z-spikePos.z)>2.4){ defusingAgent=null; defuseStartT=null; }
    else if(SimClock.now()-defuseStartT >= DEFUSE_TIME){ removeSpikeMesh(); endRound('DEFENSE','Spike désamorcée'); return; }
  }

  // ---- Conditions de victoire ----
  if(defendTeam.alive().length===0 && !planted){ endRound('ATTACK','Élimination'); return; }
  if(defendTeam.alive().length===0 && planted){ endRound('ATTACK','Élimination post-plant'); return; }
  if(attackTeam.alive().length===0 && !planted){ endRound('DEFENSE','Élimination'); return; }
  if(attackTeam.alive().length===0 && planted && !defusingAgent){ /* défenseurs doivent encore désamorcer */ }
  if(planted && SimClock.now()-plantT >= PLANT_TIMER){ explodeSpike(); endRound('ATTACK','Spike explosée'); return; }
  // +SETUP_TIME : le round dispose des 100s (1:40) réglementaires de temps
  // de jeu réel une fois la barrière tombée, pas 100s moins les quelques
  // secondes passées immobilisé au spawn.
  if(!planted && elapsed >= ROUND_TIME+SETUP_TIME){ endRound('DEFENSE','Temps écoulé'); return; }
}

/* ============================================================
   UI — scoreboard (fiches joueurs avec avatar), boucle principale
   ============================================================ */
function mkScoreCard(agent, isRight){
  const d = document.createElement('div'); d.className='sb-card'+(isRight?' right':''); d.id='sb_'+agent.id;
  d.innerHTML = `<div class="sb-avatar" style="background:#${agent.tagColor.toString(16).padStart(6,'0')};">${initialsOf(agent.name)}</div>
    <div class="sb-cardmain">
      <div class="sb-cardtop">
        <span class="sb-name">${displayNameOf(agent.name)}</span>
        ${agent.kit?`<span class="sb-agent">${agent.kit.agent}</span>`:''}
      </div>
      <div class="sb-hpbar"><div class="sb-hpfill" id="hp_${agent.id}"></div></div>
      <div class="sb-cardbottom">
        <div class="sb-abilities" id="ab_${agent.id}"></div>
        <span class="sb-weapon" id="wpn_${agent.id}"></span>
      </div>
    </div>
    <div class="sb-cardside">
      <div class="sb-kda" id="kda_${agent.id}">0/0/0</div>
      <div class="sb-credits" id="cr_${agent.id}">800 NX</div>
    </div>`;
  // Clique un joueur dans le HUD → bascule la caméra à la première
  // personne sur lui (voir MODULE: VUE SUBJECTIVE plus haut) ; un
  // second clic sur le même joueur quitte le mode.
  d.addEventListener('click', ()=> trySpectate(agent));
  return d;
}
document.getElementById('sbAtk').append(...teamA.agents.map(a=>mkScoreCard(a,false)));
document.getElementById('sbDef').append(...teamB.agents.map(a=>mkScoreCard(a,true)));
function pipsHtml(forTeam){
  return roundHistory.map(w=> `<div class="pip ${(w==='A'?teamA:teamB)===forTeam?'won':''}"></div>`).join('');
}
/* ============================================================
   MINIMAP — projection 2D (plan X/Z) de la géométrie 3D déjà calculée
   (bbox/occluderBoxes, voir plus haut) : murs, position des joueurs
   vivants (couleur = camp), spike si posée. Jamais une carte séparée à
   maintenir à la main — la même géométrie que la scène 3D fait foi.
   ============================================================ */
const MINIMAP_SIZE = 190, MINIMAP_PAD = 12;
const MINIMAP_SCALE = (MINIMAP_SIZE-MINIMAP_PAD*2) / Math.max(mapSize.x, mapSize.z);
function worldToMinimap(x, z){
  return { x: MINIMAP_PAD+(x-bbox.min.x)*MINIMAP_SCALE, y: MINIMAP_PAD+(z-bbox.min.z)*MINIMAP_SCALE };
}
function drawMinimap(){
  const cv = document.getElementById('minimap');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0,0,MINIMAP_SIZE,MINIMAP_SIZE);
  ctx.fillStyle = 'rgba(10,13,20,.9)';
  ctx.fillRect(0,0,MINIMAP_SIZE,MINIMAP_SIZE);
  ctx.fillStyle = 'rgba(157,216,224,.3)';
  occluderBoxes.forEach(b=>{
    const p1 = worldToMinimap(b.min.x,b.min.z), p2 = worldToMinimap(b.max.x,b.max.z);
    ctx.fillRect(Math.min(p1.x,p2.x), Math.min(p1.y,p2.y), Math.max(1,Math.abs(p2.x-p1.x)), Math.max(1,Math.abs(p2.y-p1.y)));
  });
  if(planted && spikePos){
    const p = worldToMinimap(spikePos.x, spikePos.z);
    ctx.fillStyle = '#ff5f5f';
    ctx.beginPath(); ctx.moveTo(p.x,p.y-4); ctx.lineTo(p.x+4,p.y+3); ctx.lineTo(p.x-4,p.y+3); ctx.closePath(); ctx.fill();
  }
  [...teamA.agents, ...teamB.agents].forEach(a=>{
    if(!a.alive) return;
    const p = worldToMinimap(a.pos.x, a.pos.z);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2);
    ctx.fillStyle = a.side==='ATTACK' ? '#ff5f5f' : '#4ecd6a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.stroke();
  });
}
function updateScoreboard(){
  drawMinimap();
  document.getElementById('sbNameA').textContent = teamA.tag;
  document.getElementById('sbNameB').textContent = teamB.tag;
  document.getElementById('sbScoreA').textContent = scoreA;
  document.getElementById('sbScoreB').textContent = scoreB;
  document.getElementById('sbPipsA').innerHTML = pipsHtml(teamA);
  document.getElementById('sbPipsB').innerHTML = pipsHtml(teamB);
  document.getElementById('sbEcoA').textContent = teamA.economy+' NX';
  document.getElementById('sbEcoB').textContent = teamB.economy+' NX';
  // Couleur du tag alignée sur le camp ACTUEL (attaque=rouge, défense=vert)
  // — recalculée à chaque appel pour rester correcte après un changement
  // de côté à la mi-match (swapSides). Badge = même couleur, comme le
  // reste des accents ATK/DEF déjà utilisés partout dans ce HUD.
  document.getElementById('sbNameA').className = 'sb-tag ' + (teamA===attackTeam?'atk':'def');
  document.getElementById('sbNameB').className = 'sb-tag ' + (teamB===attackTeam?'atk':'def');
  document.getElementById('sbBadgeA').style.background = teamA===attackTeam ? 'var(--atk)' : 'var(--def)';
  document.getElementById('sbBadgeB').style.background = teamB===attackTeam ? 'var(--atk)' : 'var(--def)';
  updateTimeoutCounters();
  document.getElementById('roundLabel').textContent = 'ROUND '+Math.max(1,roundNumber);
  document.getElementById('phaseLabel').textContent = {IDLE:'En attente',SETUP:'Mise en place',LIVE:'En cours',POSTPLANT:'Post-plant',ROUNDEND:'Fin de manche',MATCHEND:'Match terminé'}[phase]||'';
  const timerEl = document.getElementById('roundTimer');
  let remaining = null;
  if(phase==='LIVE') remaining = ROUND_TIME+SETUP_TIME - (SimClock.now()-roundStartT);
  else if(phase==='POSTPLANT') remaining = PLANT_TIMER - (SimClock.now()-plantT);
  if(remaining!=null){
    remaining = Math.max(0, remaining);
    const m = Math.floor(remaining/60), s = Math.floor(remaining%60);
    timerEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
    timerEl.classList.toggle('low', remaining<=10);
    timerEl.style.visibility = 'visible';
  } else {
    timerEl.style.visibility = 'hidden';
  }
  [...teamA.agents, ...teamB.agents].forEach(a=>{
    const card = document.getElementById('sb_'+a.id); if(!card) return;
    card.classList.toggle('dead', !a.alive);
    document.getElementById('hp_'+a.id).style.width = Math.max(0,a.hp)+'%';
    document.getElementById('kda_'+a.id).textContent = `${a.kills}/${a.deaths}/${a.assists}`;
    document.getElementById('cr_'+a.id).textContent = a.credits+' NX';
    document.getElementById('wpn_'+a.id).textContent = a.weapon.name;
    const abEl = document.getElementById('ab_'+a.id);
    if(a.kit){
      const parts = ['signature','a','b'].map(key=>{
        const ab = a.kit[key];
        if(!ab) return '';
        const cost = abilityCost(ab);
        const owned = key==='signature' || a.ownedAbilities[key];
        const short = key==='signature' ? 'C' : key.toUpperCase();
        return `<span class="sb-spell ${owned?'owned':''}" title="${escapeAttrLocal(ab.name)}${cost!=null?` — ${cost} NX`:''}">${short}</span>`;
      });
      const ult = a.kit.ultimate;
      if(ult){
        const need = ult.stats['Points requis'];
        const ready = need && a.ultimatePoints>=need;
        parts.push(`<span class="sb-spell ult ${ready?'ready':''}" title="${escapeAttrLocal(ult.name)} — ${a.ultimatePoints}/${need||'?'}">X</span>`);
      }
      abEl.innerHTML = parts.join('');
    } else {
      abEl.innerHTML = '';
    }
  });
}
function escapeAttrLocal(s){ return String(s).replace(/"/g,'&quot;'); }

let lastReal = performance.now();
engine.runRenderLoop(()=>{
  const now = performance.now();
  const dtReal = Math.min(0.1,(now-lastReal)/1000);
  lastReal = now;
  updateCameraMove(dtReal);
  SimClock.tick(dtReal);
  const dtSim = dtReal*SimClock.speed;
  if(SimClock.running) tickRound(dtSim);
  if(SimClock.running && (Math.floor(SimClock.now()*4)%2===0)) updateScoreboard();
  updateSpawnBarriersVisual();
  updateTimeoutCountdown(dtReal);
  updateSpectateCamera();
  updateDirectorCamera(dtReal);
  scene.render();
});
window.addEventListener('resize', ()=> engine.resize());
updateScoreboard();
document.getElementById('spectateExitBtn').addEventListener('click', exitSpectateMode);
document.getElementById('directorExitBtn').addEventListener('click', exitDirectorMode);
window.addEventListener('keydown', e=>{ if(e.code==='Escape'){ exitSpectateMode(); exitDirectorMode(); } });
document.getElementById('directorBtn').addEventListener('click', ()=>{ directorMode ? exitDirectorMode() : enterDirectorMode(); });
document.getElementById('timeoutBtn').addEventListener('click', requestPlayerTimeout);
document.getElementById('timeoutSkipBtn').addEventListener('click', skipTimeout);
document.getElementById('timeoutHistoryBtn').addEventListener('click', ()=>{
  document.getElementById('timeoutHistoryPanel').classList.toggle('show');
  updateTimeoutHistoryPanel();
});
document.getElementById('timeoutHistoryCloseBtn').addEventListener('click', ()=> document.getElementById('timeoutHistoryPanel').classList.remove('show'));
document.getElementById('timeoutGenerateBtn').addEventListener('click', generateTimeoutPlan);
document.getElementById('timeoutKeywordInput').addEventListener('keydown', e=>{ if(e.key==='Enter') generateTimeoutPlan(); });
document.getElementById('timeoutAssistantBtn').addEventListener('click', toggleAssistantCoach);
updateTimeoutButton();
updateTimeoutHistoryPanel();

document.getElementById('playPauseBtn').onclick = (e)=>{
  SimClock.running = !SimClock.running;
  e.currentTarget.innerHTML = SimClock.running ? '<i>⏸</i> Pause' : '<i>▶</i> Lancer le match';
  if(SimClock.running && phase==='IDLE') startRound();
};
document.querySelectorAll('.speed-btn').forEach(btn=>{
  btn.onclick = ()=>{
    SimClock.speed = parseInt(btn.dataset.speed,10);
    document.querySelectorAll('.speed-btn').forEach(b=>b.classList.toggle('active', b===btn));
  };
});

// ---- Fast-forward : "Passer le round" / "Simuler le match" ----
// Fait tourner tickRound() en boucle synchrone avec un pas de temps FIXE
// (indépendant du framerate réel, contrairement à la vitesse x1-x8 qui reste
// bornée par requestAnimationFrame) jusqu'à ce que le round se termine
// (endRound() sort la phase de LIVE/POSTPLANT) — même logique de résolution
// que le direct, juste jouée sans attendre les vraies secondes qui passent.
function ensureMatchStarted(){
  if(!SimClock.running){ SimClock.running = true; document.getElementById('playPauseBtn').innerHTML = '<i>⏸</i> Pause'; }
  if(phase==='IDLE') startRound();
}
function tickCurrentRoundInstant(){
  const FIXED_DT = 1/20;
  let guard = 0;
  // SimClock.t doit avancer ici aussi (pas seulement via SimClock.tick(),
  // jamais appelée pendant ce fast-forward synchrone) : sinon elapsed
  // (SimClock.now()-roundStartT, lu par tickRound pour le temps de manche/
  // post-plant) reste figé à sa valeur de départ pour toujours, la manche
  // n'expire donc jamais par le temps et "Passer le round"/"Simuler le
  // match" tournent à vide jusqu'au garde-fou (20000 itérations) sans
  // jamais conclure la manche — bug remonté par un joueur ("les boutons
  // pour passer des rounds et matchs ne fonctionnent pas").
  // 'SETUP' inclus : sans lui, ce fast-forward reste bloqué à vie juste
  // après startRound() (phase vaut 'SETUP' pendant SETUP_TIME, jamais
  // 'LIVE'/'POSTPLANT' au tout premier passage) — la barrière de spawn ne
  // doit pas empêcher "Passer le round"/"Simuler le match" de fonctionner.
  while(guard++<20000 && (phase==='SETUP' || phase==='LIVE' || phase==='POSTPLANT')){ tickRound(FIXED_DT); SimClock.t += FIXED_DT; }
  updateScoreboard();
}
document.getElementById('skipRoundBtn').onclick = ()=>{
  if(phase==='MATCHEND') return;
  ensureMatchStarted();
  tickCurrentRoundInstant();
  // Sans ça, la boucle animate() (qui tourne en continu, indépendamment de
  // ce skip explicite) restait "running" et enchaînait aussitôt le round
  // suivant en direct dès que endRound() l'ouvrait ~2s plus tard — on
  // "passait" bien le round demandé, mais on se retrouvait aussitôt à
  // jouer le suivant en temps réel au lieu de s'arrêter dessus. La mise en
  // place du round suivant (spawn/achat/stratégie, voir endRound->
  // startRound) se fait quand même après le délai normal — juste figée,
  // en pause, prête à regarder ou à passer à nouveau.
  SimClock.running = false;
  document.getElementById('playPauseBtn').innerHTML = '<i>▶</i> Lancer le match';
};
document.getElementById('simAllBtn').onclick = async ()=>{
  if(phase==='MATCHEND') return;
  ffMode = true;
  ensureMatchStarted();
  let guard = 0;
  while(phase!=='MATCHEND' && guard++<48){ // 48 rounds : large marge au-delà d'une prolongation raisonnable
    tickCurrentRoundInstant();
    // Laisse le setTimeout raccourci de endRound() (voir ffMode) enchaîner
    // le round suivant, ou passer en MATCHEND — rien d'autre à y attendre.
    await new Promise(r=> setTimeout(r, 45));
  }
  ffMode = false;
};

