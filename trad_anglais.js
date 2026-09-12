/* ============================================================
   I18N — Système de traduction du CHROME STATIQUE de l'interface
   (menus, en-têtes d'écran, boutons communs, labels d'options, titres de
   modales). Ceci NE couvre PAS le contenu de simulation généré
   dynamiquement en JS par script.js (mails, commentaires de match, notes
   de patch fictives PATCH_NOTES, texte narratif, noms de compétitions
   fictives, etc.) — ce contenu reste en français pour l'instant, voir la
   mission de traduction pour le détail du périmètre.

   CONVENTION (à respecter pour toute traduction ajoutée par la suite) :
   - Clés anglaises descriptives, namespacées par écran :
       menu.*      -> écran #screen-mainmenu
       newgame.*   -> écran #screen-newgame
       options.*   -> écran #screen-options : chrome statique (data-i18n
                      posé directement dans index.html) ET contenu de
                      chaque onglet (renderAudioTab/renderGraphicsTab/etc.,
                      script.js — via le helper T(cle, texteFr) défini plus
                      bas, qui génère un <span data-i18n> à interpoler
                      directement dans le HTML généré)
       modal.*     -> titres des fenêtres modales (vctSlot, lolLeague,
                      rlRegion, gcRegion, nego)
       common.*    -> libellés réutilisés tels quels partout (Retour,
                      Annuler, ...)
   - Sur l'élément HTML dont le textContent doit être traduit : attribut
     data-i18n="cle.namespacee". Si l'élément mélange une icône <i> et du
     texte, le texte est isolé dans un <span data-i18n="..."> dédié pour ne
     jamais écraser l'icône via textContent.
   - Sur un attribut plutôt que le textContent (ex: placeholder, title) :
     data-i18n-attr-<nomAttribut>="cle.namespacee", ex.
     data-i18n-attr-placeholder="..." ou data-i18n-attr-title="...".
     Les attributs actuellement supportés sont listés dans I18N_ATTRS
     ci-dessous ; ajouter un nom à ce tableau suffit pour en supporter un
     nouveau (aria-label, etc.).
   - Toute clé absente du dictionnaire de la langue active retombe
     silencieusement sur le texte français déjà présent dans le HTML —
     jamais de clé brute affichée à l'écran.
   ============================================================ */

const I18N = {
  en: {
    // --- common ---
    'common.back': 'Back',
    'common.cancel': 'Cancel',
    'common.scrollForMore': 'More content below',
    'common.free': 'Free',
    'common.choose': 'Choose',
    'common.buy': 'Buy',
    'common.change': 'Change',
    'common.select': 'Select',
    'common.join': 'Join',
    'common.league': 'League',
    'common.region': 'Region',
    'common.teamsRivals': '{count} rival teams',
    'common.startingLeague': 'Starting league',
    'common.noAffiliatedTeams': 'No organization yet affiliated: 10 spots to fill via the Kickoff.',
    'common.regionFull': 'Region full ({count}/{max}), no slot for sale this month.',
    'common.startingLeagueText': 'Choose the ERL league your League of Legends section will begin in.',
    'common.chooseLeagueButton': 'Choose a league',
    'common.regionText': 'Choose the Game Changers region your section will start in.',
    'common.chooseRegionButton': 'Choose a region',
    'vct.slot.freeTitle': 'Choose your starting Challenger slot',
    'vct.slot.freeDescription': 'Select the slot your Valostrike section will occupy at launch, in one of the Challenger leagues below. The chosen team leaves the circuit and your organisation takes over the slot at no cost: you are starting your journey from scratch.',
    'vct.slot.buyTitle': 'Buy a Challenger slot',
    'vct.slot.buyDescription': 'There is no vacant slot in the VST circuit: to enter Valorant Tier 2, you must buy the place of an existing team in one of the Challenger leagues below. The chosen team leaves the circuit and your organisation takes over the slot.',
    'vct.slot.chosenTitle': 'You take over the spot of {team}',
    'vct.slot.chosenSub': '{label} : Free',
    'vct.slot.emptyText': 'Select the Challenger slot to buy in order to register your Valostrike section.',
    'vct.slot.emptyButton': 'Choose a slot',

    // --- main menu (#screen-mainmenu) ---
    'menu.subtitle': 'Build the reference esports organization',
    'menu.nav.continue': 'Continue',
    'menu.nav.newGame': 'New Game',
    'menu.nav.loadGame': 'Load Game',
    'menu.nav.multiplayer': 'Multiplayer',
    'menu.nav.multiplayer.tooltip': 'Coming soon',
    'menu.nav.options': 'Options',
    'menu.nav.quit': 'Quit Game',
    'menu.patchnotes.title': 'Update Notes',
    'menu.patchnotes.item21': "New playable map: Quai IX. A nighttime commercial port with a real 3D engine (like Zenith and Outpost). Three correction passes after direct feedback. First, a real corridor network (connected mid, 3 attacker spawn exits, 2 approaches per site on top of the flank). Then a tighter mid made of narrow corridors (2-3 cells instead of 6-13) and Site B moved closer to defender spawn with a direct link. Finally, on further feedback (\"corridors are too direct, add coherent props\"): every route now zigzags (each corridor turns at least twice instead of running straight), and the set dressing is far denser — streetlamps along every stretch, alternating crates/barrels/pallets/sandbags along the edges, directional signs at junctions, plus a vehicle and concrete blocks added to Site A. Added to the competitive map pool (joins out-of-rotation first, becomes eligible for active rotation at the next major patch)",
    'menu.patchnotes.item20': "Map Editor: biomes still looked too alike beyond density — the editor's preview only pulled from 8 generic props (logs, ferns, mushrooms, bushes) recycled identically across every biome, and Desert/Futuristic City had NO detail props at all (unlike what a played match already showed, e.g. cacti/dunes in desert). Each biome now draws from its own set of characteristic elements in the editor too: cacti and dunes in desert, mangroves/reeds/algae in swamp, baobabs in savanna, crystals in futuristic city, sunflowers/flowers in prairie, rock spires in mountain, etc. — the editor preview finally matches what actually shows up once the map is played",
    'menu.patchnotes.item19': "Map Editor: fixed two issues that made ALL biomes look too empty, not just Tundra/City. The real root cause: the decoration ring extended much farther out (480m) than the fog actually lets you see (already nearly invisible past 250-300m), so a good chunk of the generated decoration was wasted out of view — the ring is now pulled in to 300m with more sampling bands, concentrating the same amount of decoration into the area that's actually visible (roughly 3x denser to the eye). Also found a real shape bug on broadleaf trees (tropical, prairie...): their canopy was stretched 70% taller than it was wide, making it read as a pointy conifer even though the correct round model was being used — proportions fixed for a wide, rounded canopy",
    'menu.patchnotes.item18': "Map Editor: the Tundra biome was by far the emptiest of all the biomes — 50% of the terrain stayed bare versus 80-98% covered for the others, and without a single ice/snow element despite the theme (just generic rocks/bushes tinted pale). Density raised to 85%, with two new theme-appropriate elements (ice blocks, snow patches). The Futuristic City biome, also noticeably emptier than the rest (48%), gains some rubble/concrete blocks on top of the towers already there",
    'menu.patchnotes.item17': "Map Editor: the biome picked for a map (Desert, Tundra, Tropical Forest...) is finally visible once the map is actually played — until now, that choice only affected the editor's own preview and vanished entirely on export, with the ground always staying the same generic green in-game no matter which biome was selected. The editor's buildable ground (the cells without a floor tile on them, previously always grey) now takes on the chosen biome's tint, and the played map carries that same ground color across its whole area, plus a bit of matching decoration (cacti in desert, firs in taiga, ice in tundra...) scattered around the play area so it no longer looks empty",
    'menu.patchnotes.item16': "3D simulation (Valostrike): tactical Time-Out — final stage, 3D plan visualization. During a Time-Out, picking a round in the tree now draws the trajectories directly on the map using the same pathfinding that actually moves the agents (so it follows the real walls/corridors, never an arbitrary line), with one animated arrow per flank (a different color for a Split or a Fake), a glowing dot traveling the route to convey timing, and utility icons (smoke/flash/etc.) drawn from the team's real kit around the targeted site. Everything is cleared automatically once the Time-Out ends. The Time-Out system is now complete across all 4 planned stages",
    'menu.patchnotes.item15': "3D simulation (Valostrike): tactical Time-Out — added the Assistant Coach (stage 3). A dedicated button lets the AI automatically recommend an instruction instead of typing one manually, with a confidence %, a risk level, and 2-3 concrete reasons (real per-strategy win-rate history, economy gap between the two teams, which site the opposing defense has been most permeable on recently, an ongoing losing streak) — no invented data, only signals already tracked by the real game engine",
    'menu.patchnotes.item14': "3D simulation (Valostrike): the tactical Time-Out (stage 2) now lets you type an instruction during the pause (Fast B, Split A, Eco, Force Buy, Mid Control, Retake Setup...) — over 25 recognized keywords. A 3-round decision tree is generated automatically, with a Win branch and a Loss branch at every round, up to 4 possible scenarios by round 3. Each round in the tree gives a strategy, an objective, a recommended buy, and the utility actually available in the real roster — the projected economy at each round uses the same formulas as the real game (win/loss bonus), so the tree never recommends a purchase the team couldn't actually afford. When the AI opponent calls the Time-Out, it also generates its own plan (shown read-only)",
    'menu.patchnotes.item13': "3D simulation (Valostrike): added the tactical Time-Out, pro-competitive style (stage 1). Each team gets 1 Time-Out per side (never regained once used) plus 1 shared for the whole overtime. A dedicated button triggers it (always at the break between two rounds, never mid-fight); the AI opponent can also call one itself after a losing streak. Announcement popup with team/score/side/a real 30s countdown, a colored light pulse at the team's spawn in the 3D view, a dedicated card in the event feed, a permanent counter under the score banner (auto-switches to an overtime counter from round 25), and a browsable history of every Time-Out called this match. The tactical payload (instructions, 3-round plan, AI recommendations, 3D plan visualization) is coming in a future update",
    'menu.patchnotes.item12': "3D simulation (Valostrike): the spawn barrier (blue walls, 10s at round start) used to fully freeze both teams in place — they can now move normally to get set up, they just can't cross the wall before it drops, just like the real game. Also fixed a deeper bug found while building this: an agent's position while moving is derived from an internal progress counter that kept advancing even while the agent was visually stuck at the wall — without the fix, everyone would have literally teleported to their real position (10s of unbounded walking) the instant the barrier dropped",
    'menu.patchnotes.item11': "3D simulation (Valostrike): added the spawn barrier, just like the real game — at the start of every round, a translucent blue wall holds each team in place at its spawn for 10 seconds before anyone can move. Until now defenders would head straight for their positions/angles the instant they spawned, before the round had actually started (flagged by a player). Director mode: fixed the slow activation — the camera stayed completely frozen as long as no duel was happening (e.g. right after turning it on, or during the spawn barrier); it now immediately shows a wide establishing shot and cuts to the first duel as soon as one starts",
    'menu.patchnotes.item10': "Map simulation without a 3D engine (Valostrike): the round feed now shows a short situation line when a round ends on a clutch (e.g. \"Clutch 1v2 for the defense — round won by defusing despite being outnumbered\"), computed from the round's real kills instead of a bare \"1v2\" badge with no follow-through. Also fixed: buy-types (Force/Semi/Full/Hyper Buy) could be picked even without enough credits to actually afford them (e.g. a Force Buy from 4000 NX for a purchase that costs 4200), which wiped the bank next round and made two very close economies (4100 vs 4200 NX) look visibly inconsistent; Save cost 500 NX instead of 0 (saving should never cost anything)",
    'menu.patchnotes.item0z': "Fixed a real NX economy bug in the 3D simulation (Valostrike): the halftime side swap (round 13) never reset credits or cleared already-purchased weapons — the team that dominated the first half would enter the second half with its full credit stash AND its weapon still in hand, which flat-out removed the second half's pistol round and threw off the rest of the match's balance. Both teams now correctly restart at 800 NX with the base pistol at round 13, just like the real round 1",
    'menu.patchnotes.item0y': "FPS optimization for the 3D simulation (Valostrike): the Zenith map turned out to be built from over 13,000 meshes just for its ground (detailed paving made of hundreds of small tiles), nearly 7,000 of which were needlessly recomputing their cast shadow every single frame — a flat-lying floor tile never has a visible shadow to cast. Those floor tiles, along with the smallest procedural details (bolts, seams...) too fine for their shadow to be visible, no longer cast shadows at all; shadow quality trimmed slightly (still crisp, just cheaper to keep recalculating continuously); the AI's line-of-sight check (already called dozens of times per frame mid-duel) no longer reallocates memory on every call",
    'menu.patchnotes.item0x': "Fixed a bug that kept first-person view from working in real gameplay: the player cards in the HUD (Zenith and Outpost) were actually inert to clicks — the mouse click passed straight through the card onto the 3D scene behind it — which my own earlier testing, done by calling code directly rather than a real mouse click, failed to catch. Clicking a player in the HUD now correctly switches to first-person view",
    'menu.patchnotes.item0w': "3D simulation (Valostrike): new first-person view. Clicking a player in the HUD switches the camera to eye level, facing their actual aim direction, instead of staying on the free spectator view — clicking the same player again (or Escape) exits the mode. If the followed player dies, the camera automatically switches to their nearest living ally instead of staying locked on a motionless body; if no allies remain alive, it returns to the free view. Any manual camera input (drag/scroll) also exits first-person mode",
    'menu.patchnotes.item0v': "3D simulation (Valostrike): the team tag now shows in front of the nickname above characters (e.g. \"JL Kreta\" for org JL) — the data already existed on the manager side but was never read by the in-game floating label. Full head-to-toe tactical operator look (CS-style reference), body included this time: torso/arms/vest/pouches/backpack/legs switch to muted gray-olive-tan tones instead of bright red/green across the whole outfit — the team color stays readable via the ground ring, the visor, and a new small armband on the arm instead of tinting the entire body. Fully balaclava'd head (no more visible skin/hair) with protective goggles/visor, hands repositioned to actually hold the weapon",
    'menu.patchnotes.item0u': "3D simulation (Valostrike): characters reworked, more detailed and more anatomically believable. Neck added between head and torso (previously: a sphere sitting bare on a cylinder), hands, boots, belt + tactical pouches, backpack, jaw, slightly flattened head instead of a perfect sphere. Fixed the leg pivot: walking used to rotate the whole leg around its own center instead of hinging from the hip — boots now follow the motion naturally. Weapon rebuilt from several parts (body/magazine/stock/foregrip/barrel depending on the real purchase tier) instead of a single flat box. About 24 elements per character vs. 13 before, in both simulation files (Zenith and Outpost)",
    'menu.patchnotes.item0t': "Map Editor: tree realism rework, shared engine across the whole Trees family. Every trunk (except Bamboo/Baobab, handled separately) now has root flare at the base — a perfectly cylindrical trunk from ground to top was the most obvious \"geometric primitive\" tell. Every tree also gets a slight natural lean, none are perfectly vertical anymore. Fir/Pine: 4 tapering, differently-tinted branch tiers instead of 2 identical big cones. Weeping willow: foliage broken into several clumps + 16 hanging strands (up from 10, all identical before). Baobab: its own massive, swollen trunk instead of the same thin generic trunk as every other tree — that oversized trunk is precisely what defines a baobab. Palm: fronds in 2 segments that droop under their own weight instead of a stiff flat board, plus coconuts",
    'menu.patchnotes.item0s': "Map Editor: full audit closing out the detail pass. Cactus (spines + flowers) and snow pile (ice shards) enriched. The rest of the library was checked one by one: the big structures (Building, Tower, Warehouse, Factory, Office...) were already very detailed (up to 220 elements), and the remaining small props/water elements (flag, flowerpot, lily pad, pond...) are already at the right level for what they represent — no detail added just for the sake of it",
    'menu.patchnotes.item0r': "Map Editor: another round of detail — décor, props, and verticality elements this time. Concrete block, barrel (hoops + lid), crate (corner battens), broken wheel (hub + spokes), carpet (border + center medallion): all used to be a single bare shape. Vertical ramp and access ramp: anti-slip strips + guard rails, like the parking ramp. Elevator: previously a flat slab, now gets posts, guard rails, and a control panel",
    'menu.patchnotes.item0q': "Map Editor: continuing the detail pass, this time on Nature and Structures. Round-canopy trees (Oak, Birch, Cherry, Maple — previously a single smooth cone, all identical) now have their foliage broken into several slightly differently-tinted clumps instead of a perfect ball. Houses (all 9 in the \"Regional houses\" family, including Wood/Stone/Chalet/Hut/Cabin...) used to be just 3 boxes (walls/roof/door) — they now get windows, a chimney, and a doorstep. Fallen log, lone rock, and big rock enriched (moss, scattered pebbles, cut-end ring). Ramp, Pyramid, and Tent — each previously a single bare shape — gained anti-slip strips and guard rails, a distinct capstone and low entrance, and an entrance flap with guy-ropes/stakes",
    'menu.patchnotes.item0p': "Map Editor: fixed a real geometry bug affecting close to 30 assets (bamboo, modular walls — including every corner piece —, several themed walls, all 4 new cover objects, gas station, silo, fort, mine, greenhouse, bus shelter, tall grass, reed, liana, mangrove...): many objects were planted half-buried in the ground due to a wrong height calculation, making them look flimsy, crooked, or just \"ugly\" once placed. Bamboo in particular was unrecognizable: hair-thin canes half-swallowed by the ground. Bamboo canes reworked: much thicker, ringed nodes (the one truly recognizable bamboo trait, missing before), a slight natural lean per cane, and leaf clusters instead of a single solid cone. New reusable detail system (chips, cracks, stains, bolts) applied to the bare-est walls (Brick, Wood, Marble, Granite, Rusty, Temple); the Obsidian wall, previously completely empty, now gets glowing crystalline veins and raised volcanic glass shards",
    'menu.patchnotes.item0o': "Map Editor: organization/realism pass plus a look aligned with the game. Asset palette reorganized: the 3 huge categories (Walls 65, Nature 66, Structures 67) are now grouped into themed families (Modular, Historic, Industrial, Trees, Water...) instead of one flat grid of 60-70 tiles to scroll through. Asset search is fixed: searching a modular variant (e.g. \"door\") now finds every door, with its subcategory auto-expanded. New always-visible \"Map objects\" panel in the inspector, listing every placed object grouped by category, clickable to select (Shift/Ctrl+click to add/remove), with highlighting synced both ways with the viewport. Duplicate nature labels are now distinct (Dense/Sparse bush, Tall/Low fern, Gnarled/Bare dead tree). The editor now reuses the game's own colors and typography (charcoal + gold, Manrope/Fraunces fonts) instead of its old blue/cyan theme. All procedural textures (stone, brick, concrete, wood, floors...) now render at 512x512 instead of 256x256, noticeably finer. A subtle per-instance tint variation was added to walls/décor without dedicated surface detail, to break up the identical-flat-color look",
    'menu.patchnotes.item0n': "Map Editor improvements: a \"Test in match\" button that opens your current map straight into a real 3D match (no more manual JSON copy-pasting), and a \"Check for Valostrike\" button that verifies sites/spawns and enough floor coverage before you play. Multi-select editing finally works properly (moving/rotating/scaling multiple objects used to collapse them all onto the first selected one). A visible ground grid follows the chosen snap step, undo/redo now gives visual feedback, category headers show item counts, and a fill light softens the previously hard shadows. 13 new décor assets (cover, verticality, tactical elements)",
    'menu.patchnotes.item0m': "Valostrike 3D maps and characters: the Map Editor's scenery library (284 assets, highly detailed walls/structures/nature) is now SHARED with the 3D match engine — Zenith and Outpost instantly gain that full level of detail (no more walls/props reduced to plain gray boxes), and any new map built in the editor will render the same way in an actual match. On the character side: legs that animate while walking, visible recoil on every shot, a death that tips over and fades out instead of vanishing instantly, a floating health bar and armor pip above each agent, a weapon silhouette that follows the real buy tier, and a role-based color accent (Duelist/Initiator/Controller/Sentinel/Flex)",
    'menu.patchnotes.item0l': "New Valostrike strategy levers, specific to tactical FPS: economic doctrine (force-buy vs disciplined save, genuinely drives NX purchases), site entry aggressiveness (rush vs worked executions, genuinely drives the AI's round-by-round choices), rotation/retake discipline — all 3 with a real in-match effect, not a generic strength multiplier. Agent composition synergy (already shown on the tier list) now actually counts toward real team strength, for you and your opponents alike. A dedicated button lets the Head Coach handle these doctrines for you",
    'menu.patchnotes.item0k': "Complete rework of Rocket Champ strategy: the single style borrowed from Valostrike is replaced by 3 dedicated tactical axes (Tempo, Boost discipline, Mechanical approach), each with a real in-match effect — but only if your roster's attributes actually support it. Dynamic roles (1st/2nd/3rd man), arena mastery and a real box score (goals/assists/saves per player) now apply to EVERY league match, plus opponent-specific prep, an automatic tempo adjustment when trailing in a series, and a button to let the Head Coach fully handle this tactical prep",
    'menu.patchnotes.item0j': "Valostrike match recap (3D-simulated maps) rebuilt to reflect the match you actually played: damage, HS%, KAST%, first kills/deaths and clutches are now computed from what really happened on the map (the 3D engine now tracks every hit/shot/assist round by round) instead of being estimated from player attributes alone — assists, which were always stuck at 0, are now genuinely tracked too",
    'menu.patchnotes.item0i': "Fixed a Rocket Champ strategy bug: an RLCS match (Opens/Majors/LCQ/Worlds) involving your team completely ignored the style chosen in \"Formation & identité tactique\" (and used a very simplified strength calculation) — aligned on the same engine as the rest of the league",
    'menu.patchnotes.item0h': "Starting level reworked into 5 scenarios with their own identity (Streamer going pro, Club takeover, Ambitious startup, Sponsored organization, Custom) instead of 4 starred difficulty tiers — each with its own budget/reputation/supporters balance (Sponsored organization starts with a real sponsor already signed), Custom replaces Realistic mode and lets you set everything by hand with sliders",
    'menu.patchnotes.item0g': "New crest system: the Identity Forge (mood-keyword generation, 3 hand-tunable layers — shape/emblem/accent, a live-morphing preview) replaces the flat color-tag badge, on the creation screen and everywhere the organization is shown",
    'menu.patchnotes.item0f': "Recalibrated Valostrike/Valostrike GC ratings to match VLR.gg's real scale: an average performance used to score ~0.58 instead of ~1.00, so every rating in the game looked abnormally low",
    'menu.patchnotes.item0e': "Fixed a Valostrike GC calendar bug: Stage 3 (July-August) could start at any point in the year for a section joined later on, causing off-season matches (e.g. in December)",
    'menu.patchnotes.item0d': 'Fixed a critical 3D engine bug (Zenith/Outpost maps): "Skip round" and "Simulate match" no longer advanced round time, so they spun endlessly without ever concluding',
    'menu.patchnotes.item0c': 'Score now properly centered in the live Rocket Champ match popup, regardless of team name length',
    'menu.patchnotes.item0b': 'Creation screen: game selection tiles tightened up, cleanly aligned 2 by 2',
    'menu.patchnotes.item0a': "Fixed a navigation bug: advancing a day from a section opened via the sidebar switcher no longer sends you to another section",
    'menu.patchnotes.item1': 'New Rocket Champ strategy system: manual team playstyle (with a real effect on matches) and a prioritized training attribute',
    'menu.patchnotes.item2': 'Fixed a display bug in the sidebar section switcher (menu was clipped/mispositioned)',
    'menu.patchnotes.item3': 'Valostrike Ranked made coherent: the top of the ladder is now dominated by real pros signed to VCT International teams, not random free agents',
    'menu.patchnotes.item4': 'Captain system for Rocket Champ: designate one from a player profile, with a leadership rating and a team bonus',
    'menu.patchnotes.item5': 'Mail: merged inbox across all active sections, with filters by section, category and priority',
    'menu.patchnotes.item6': 'Music player: track progress bar (with elapsed/remaining time) and a dedicated volume slider, alongside the mute button',
    'menu.patchnotes.item7': 'Update notes: the main menu card now opens a popup with the full patch',
    'menu.patchnotes.item8': 'Fully removed the organization logo/crest system (creation and display), replaced with a colored tag badge',
    'menu.discord.tooltip': 'Join the Discord',

    // --- new game (#screen-newgame) ---
    'newgame.title': 'Create your organization',
    'newgame.subtitle': 'Define the identity that will carry your colors on the global esports scene',
    'newgame.field.difficulty': 'Starting level',
    'newgame.field.orgName': 'Organization name',
    'newgame.field.orgNamePlaceholder': 'E.g.: Phoenix Esports',
    'newgame.randomName.tooltip': 'Generate a random name',
    'newgame.field.orgTag': 'Tag (2-3 letters)',
    'newgame.field.colors': 'Color',
    'newgame.color.customTooltip': 'Choose a custom color',
    'newgame.field.firstSection': 'First esports section',
    'newgame.create': 'Create my organization',

    // --- options (#screen-options) — chrome statique uniquement ---
    'options.title': 'Options',
    'options.subtitle': 'Fully customize your Esports Director experience',
    'options.tab.audio': 'Audio',
    'options.tab.graphics': 'Graphics',
    'options.tab.interface': 'Interface',
    'options.tab.language': 'Language',
    'options.tab.accessibility': 'Accessibility',
    'options.tab.system': 'System',
    'options.tab.cheat': 'Developer',
    'options.actions.reset': 'Reset',
    'options.actions.apply': 'Apply',

    // --- dashboard chrome (sidebar + topbar, partagé par toutes les pages
    // du dashboard) ---
    'dashboard.nav.general': 'General',
    'dashboard.nav.social': 'Social',
    'dashboard.nav.mail': 'Mail',
    'dashboard.nav.club': 'Club',
    'dashboard.nav.calendar': 'Calendar',
    'dashboard.nav.infrastructure': 'Infrastructure',
    'dashboard.nav.slots': 'Slots',
    'dashboard.nav.finances': 'Finances',
    'dashboard.nav.budget': 'Budget',
    'dashboard.nav.sponsors': 'Sponsors',
    'dashboard.nav.squad': 'Squad',
    'dashboard.nav.staff': 'Staff',
    'dashboard.nav.delegation': 'Delegation',
    'dashboard.nav.transfers': 'Transfers',
    'dashboard.topbar.music': 'Music',
    'dashboard.topbar.advance': 'Advance',
    'dashboard.topbar.advance.tooltip': 'Advance one day',
    'dashboard.topbar.playMatch': 'Play match',
    'dashboard.topbar.playMatch.tooltip': "Play today's match",

    // --- page Général (renderGeneralPage, script.js) ---
    'general.title': 'Overview',
    'general.subtitle': 'Welcome at the helm of',
    'general.hero.noEvent': 'No upcoming event this month.',
    'general.hero.play': 'Play',
    'general.stat.budget': 'Budget',
    'general.stat.reputation': 'Reputation',
    'general.stat.supporters': 'Supporters',
    'general.stat.mainSponsor': 'Main sponsor',
    'general.stat.none': 'None',
    'general.stat.gotoBudget': 'Go to Finances > Budget',
    'general.stat.gotoSponsors': 'Go to Finances > Sponsors',
    'general.structure.title': 'Structure overview',
    'general.org.title': 'Organization',
    'general.org.name': 'Name',
    'general.org.tag': 'Tag',
    'general.org.activeSections': 'Active sections',
    'general.org.date': 'Date',
    'general.standing.title': 'Standing',
    'general.standing.section': 'Section',
    'general.standing.position': 'Position',
    'general.standing.record': 'Record',
    'general.standing.none': 'No competition in progress.',
    'general.social.title': 'Social',
    'general.social.seeAll': 'See full feed',
    'general.social.empty': "Nothing to report for now, advance in time to see the scene come alive.",

    // --- modal titles ---
    'modal.vctSlot.title': 'Buy out a Challenger slot',
    'modal.lolLeague.title': 'Choose your ERL league',
    'modal.rlRegion.title': 'Choose your RLCS region',
    'modal.gcRegion.title': 'Choose your Game Changers region',
    'modal.nego.title': 'Negotiation',

    // --- options tab CONTENT (renderAudioTab/renderGraphicsTab/etc.,
    // script.js) — deuxième passe, complète le chrome statique ci-dessus ---
    'options.audio.title': 'Audio',
    'options.audio.sub': 'Real-time preview — each slider plays a test sound at its new volume.',
    'options.audio.master': 'Master volume',
    'options.audio.master.desc': 'Controls every sound in the game',
    'options.audio.music': 'Music volume',
    'options.audio.music.desc': 'Menu and club ambient music',
    'options.audio.nowPlaying': 'Now playing',
    'options.audio.nowPlaying.desc': 'Shuffled lofi playlist, next track plays automatically',
    'options.audio.skip': 'Next',
    'options.audio.sfx': 'Sound effects volume',
    'options.audio.sfx.desc': 'Clicks, notifications, match results',
    'options.audio.ui': 'Interface volume',
    'options.audio.ui.desc': 'Menu navigation sounds',
    'options.audio.muted': 'Mute',
    'options.audio.muted.desc': 'Instantly disables all sound',
    'options.audio.test': 'Test sound',

    'options.graphics.title': 'Graphics',
    'options.graphics.sub': "Since Esports Director runs in a browser, some settings (resolution, FPS, V-Sync) are indicative rather than hardware-level; fullscreen, brightness and contrast are fully functional.",
    'options.graphics.displayMode': 'Display mode',
    'options.graphics.displayMode.fullscreen': 'Fullscreen',
    'options.graphics.displayMode.windowed': 'Windowed',
    'options.graphics.displayMode.borderless': 'Borderless',
    'options.graphics.fpsLimit': 'FPS limit',
    'options.graphics.fpsLimit.unlimited': 'Unlimited',
    'options.graphics.vsync': 'V-Sync',
    'options.graphics.vsync.desc': 'Vertical synchronization',
    'options.graphics.quality': 'Graphics quality',
    'options.graphics.quality.desc': 'Low also reduces animations and decorative effects',
    'options.graphics.quality.low': 'Low',
    'options.graphics.quality.medium': 'Medium',
    'options.graphics.quality.high': 'High',
    'options.graphics.quality.ultra': 'Ultra',
    'options.graphics.brightness': 'Brightness',
    'options.graphics.brightness.desc': 'Real effect, visible immediately',
    'options.graphics.contrast': 'Contrast',
    'options.graphics.contrast.desc': 'Real effect, visible immediately',

    'options.interface.title': 'Interface',
    'options.interface.sub': 'Adjust interface readability and mouse responsiveness.',
    'options.interface.mouseSensitivity': 'Mouse sensitivity',
    'options.interface.mouseSensitivity.desc': 'Drag sensitivity, especially on 3D map views',
    'options.interface.tooltips': 'Show tooltips',
    'options.interface.notifications': 'Show notifications',
    'options.interface.notifications.desc': 'Confirmation and info toasts',
    'options.interface.animations': 'Show animations',
    'options.interface.animations.desc': 'Decorative interface transitions and animations',
    'options.interface.confirmDestructive': 'Confirm before destructive actions',
    'options.interface.confirmDestructive.desc': 'Dismissal, contract termination, slot buyout... Turn off to act immediately without a confirmation window.',

    'options.language.sub': "Esports Director's interface chrome (menus, screens, options) is available in French and English; simulation content (mails, match commentary...) remains in French for now. Other languages are saved for a future translation update.",

    'options.accessibility.title': 'Accessibility',
    'options.accessibility.sub': 'Settings that are actually applied to the interface, including colorblindness assist filters.',
    'options.accessibility.colorblind': 'Colorblind mode',
    'options.accessibility.colorblind.none': 'None',
    'options.accessibility.colorblind.protanopia': 'Protanopia',
    'options.accessibility.colorblind.deuteranopia': 'Deuteranopia',
    'options.accessibility.colorblind.tritanopia': 'Tritanopia',
    'options.accessibility.highContrast': 'High contrast',
    'options.accessibility.highContrast.desc': 'Reinforces borders and separators',
    'options.accessibility.reduceEffects': 'Reduce visual effects',
    'options.accessibility.reduceEffects.desc': 'Hides glow effects and decorative particles',
    'options.accessibility.reduceMotion': 'Reduce animations',
    'options.accessibility.reduceMotion.desc': 'Disables transitions and animations',
    'options.accessibility.textSize': 'Custom text size',
    'options.accessibility.textSize.desc': 'Adjusts the text size across the whole interface',

    'options.system.title': 'System',
    'options.system.sub': "Since the game runs in a browser, there's no classic save folder: your games are stored in your browser's local storage, but can be exported/imported as a file.",
    'options.system.autosave': 'Autosave',
    'options.system.autosaveInterval': 'Autosave interval',
    'options.system.saveLocation': 'Save location',
    'options.system.saveLocation.desc': "Browser local storage (localStorage)",
    'options.system.export': 'Export',
    'options.system.import': 'Import',
    'options.system.mainMenu': 'Main menu',
    'options.system.mainMenu.desc': 'Your game stays saved, you can resume it later.',
    'options.system.mainMenu.button': 'Back to main menu',

    'general.org.director': 'Director',

    'options.save.title': 'Save',
    'options.save.sub': 'Manage your game save and return to the menu or quit the game cleanly.',
    'options.save.manage': 'Saves',
    'options.save.manage.desc': 'Create a new save, or load/rename/delete an existing one — several versions of the same career can coexist',
    'options.save.manage.button': 'Save',

    'saveslot.title': 'Load a game',
    'saveslot.storage.used': 'used',
    'saveslot.cleanup.button': 'Clean up',
    'saveslot.cleanup.title': 'Deletes old automatic saves, keeps all your manual saves/versions',
    'saveslot.empty': 'No save yet.',
    'saveslot.rename': 'Rename',
    'saveslot.duplicate': 'Duplicate as new version',
    'saveslot.delete': 'Delete',
    'saveslot.new': 'New save',
    'saveslot.close': 'Close',
    'saveslot.load': 'Load',
    'saveslot.selectPrompt': 'Select a save to see its details.',
    'saveslot.detail.type': 'Type',
    'saveslot.detail.date': 'In-game date',
    'saveslot.detail.lastSaved': 'Last saved',
    'saveslot.detail.size': 'Size',

    'options.dev.locked.title': 'Developer mode',
    'options.dev.locked.sub': 'Locked — enter the access code to unlock cheat/debug tools.',
    'options.dev.locked.code': 'Access code',
    'options.dev.locked.code.desc': 'The unlock is remembered on this device, no need to re-enter it every game.',
    'options.dev.locked.unlock': 'Unlock',
    'options.dev.noGame.title': 'Developer mode',
    'options.dev.noGame.sub': 'No game in progress — load or start a game to access cheat tools.',
    'options.dev.lock.label': 'Lock',
    'options.dev.lock.button': 'Re-lock',
    'options.dev.lock.desc': 'Re-locks developer mode access on this device.',
    'options.dev.title': 'Developer mode',
    'options.dev.sub': 'Test/debug tools, directly modify your current game state.',
    'options.dev.budget': 'Current budget',
    'options.dev.budget.add': 'Add money',
    'options.dev.reputation': 'Current reputation',
    'options.dev.reputation.add': 'Add',
    'options.dev.reputation.set': 'Set',
    'options.dev.quick': 'Quick tools',
    'options.dev.quick.desc': 'Fast debugging, generation and progression helpers for testing game scenarios.',
    'options.dev.quick.sections': 'All sections',
    'options.dev.quick.month': '+1 month',
    'options.dev.squad': 'Squad & staff',
    'options.dev.squad.desc': 'Automatically generates a full squad and all staff for each active section (also activates Valorant if needed, random Challenger slot).',
    'options.dev.squad.button': 'Generate squad + staff',
    'options.dev.forfeit': 'Valostrike forfeit',
    'options.dev.forfeit.desc': 'A forfeit was declared for this split (incomplete roster at lock), stays blocked until the next split unless lifted manually here.',
    'options.dev.forfeit.button': 'Lift forfeit',
    'options.dev.relock.desc': 'Re-locks developer mode access on this device (the code will be asked again).',
  },
  // de/es/pt : pas encore de dictionnaire — le sélecteur de langue continue
  // d'afficher le toast "bientôt disponible" pour ces langues (voir
  // script.js, handler .opt-lang-option), applyI18n() ne fait donc jamais
  // rien pour elles (dict introuvable -> retour anticipé silencieux).
};

// Attributs pour lesquels une traduction ciblée (plutôt que le textContent)
// est prise en charge via data-i18n-attr-<nom>. Ajouter un nom ici suffit à
// activer la convention pour un nouvel attribut.
const I18N_ATTRS = ['placeholder', 'title'];

// Applique la traduction de la langue demandée (paramètre `lang`, sinon
// settings.language) à tous les éléments statiques marqués data-i18n /
// data-i18n-attr-* du DOM courant.
//
// Réversible : le texte français d'origine de chaque élément est capturé
// une seule fois (dataset.i18nFr / dataset.i18nFr<Attr>) lors du tout
// premier passage, puis systématiquement utilisé comme fallback — c'est ce
// qui permet de rappeler applyI18n('fr') (ex. handler .opt-lang-option, ou
// applySettings(settings) après un "Annuler" dans les Options) pour
// revenir proprement au français même après une prévisualisation en
// anglais, sans jamais perdre le texte d'origine. Fallback silencieux dans
// tous les cas où rien ne doit changer : langue 'fr', aucun dictionnaire
// pour la langue demandée (de/es/pt), ou clé précise absente du
// dictionnaire — jamais de clé brute affichée à l'écran.
function applyI18n(lang){
  try{
    const targetLang = lang || (typeof settings !== 'undefined' && settings && settings.language) || 'fr';
    const dict = (targetLang !== 'fr') ? I18N[targetLang] : null;

    document.querySelectorAll('[data-i18n]').forEach(el=>{
      if(el.dataset.i18nFr === undefined) el.dataset.i18nFr = el.textContent;
      const key = el.getAttribute('data-i18n');
      const val = dict ? dict[key] : undefined;
      el.textContent = (val !== undefined) ? val : el.dataset.i18nFr;
    });

    I18N_ATTRS.forEach(attr=>{
      const snapshotKey = 'i18nFr' + attr.charAt(0).toUpperCase() + attr.slice(1);
      document.querySelectorAll(`[data-i18n-attr-${attr}]`).forEach(el=>{
        if(el.dataset[snapshotKey] === undefined) el.dataset[snapshotKey] = el.getAttribute(attr) || '';
        const key = el.getAttribute(`data-i18n-attr-${attr}`);
        const val = dict ? dict[key] : undefined;
        el.setAttribute(attr, (val !== undefined) ? val : el.dataset[snapshotKey]);
      });
    });
  }catch(e){ /* jamais bloquant : en cas de souci, le français d'origine reste affiché */ }
}

// Pour le contenu généré dynamiquement (template literals de script.js,
// ex. renderAudioTab) : T(cle, texteFrançais) retourne un <span data-i18n>
// prêt à être interpolé directement dans le HTML généré, plutôt que de
// poser l'attribut à la main sur un élément statique. applyI18n() traite
// ces spans exactement comme n'importe quel [data-i18n] une fois insérés
// dans le DOM (voir l'appel ajouté à la fin de renderOptionsPanel(),
// script.js — indispensable ici puisque ce HTML est régénéré à chaque
// changement d'onglet, contrairement au chrome statique traduit une seule
// fois au chargement).
function T(key, fr){
  return `<span data-i18n="${key}">${fr}</span>`;
}

// Équivalent de T() pour un attribut assigné directement en JS (ex. .title
// sur un bouton dont le contenu est réécrit à chaque render, comme
// btnAdvanceDay) plutôt qu'un attribut HTML statique data-i18n-attr-*
// traité par applyI18n() : pas de balise possible dans un attribut, donc
// retourne directement la chaîne traduite (ou le français si pas de
// traduction/langue française).
function translatedFallback(key, fr){
  try{
    const lang = (typeof settings !== 'undefined' && settings && settings.language) || 'fr';
    const dict = I18N[lang];
    return (dict && dict[key] !== undefined) ? dict[key] : fr;
  }catch(e){ return fr; }
}

/* ------------------------------------------------------------
   HORS SCOPE pour cette première passe (voir mission de traduction) :
   - Tout le contenu généré par script.js pour les mails, commentaires de
     match, notes de patch fictives (PATCH_NOTES), texte narratif de
     simulation, noms de compétitions fictives, etc.
   ------------------------------------------------------------ */
