#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Empaquette une version "à vendre" du jeu : copie tous les fichiers du jeu
dans un dossier temporaire, MINIFIE le JavaScript au passage (fichiers .js
et blocs <script> inline dans les .html) pour que le code ne soit plus
lisible tel quel par quiconque récupère le zip, puis produit le fichier
zip final dans Site du jeu/build/.

Ne touche JAMAIS aux fichiers sources de ce dossier (Version en
developpement) : tout le travail de minification se fait sur des COPIES,
dans un dossier temporaire supprimé à la fin. Le dossier de dev reste
donc toujours lisible/éditable normalement.

Usage : double-clique "Créer le paquet de vente.bat", ou lance
    python build_release.py
"""
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

# La console Windows par defaut (cp1252) plante sur certains caracteres que
# renvoie esbuild dans ses messages d'erreur formates (bordures de cadre
# unicode) — on force l'UTF-8 pour eviter un crash qui masquerait l'erreur
# esbuild reelle (bien plus utile a voir que ce crash d'encodage).
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent
SITE_DIR = PROJECT_ROOT.parent / "Site du jeu"
BUILD_DIR = SITE_DIR / "build"
ESBUILD = PROJECT_ROOT / "devtools" / "esbuild.exe"

if not ESBUILD.exists():
    print(f"esbuild.exe introuvable ({ESBUILD}). Ce fichier est un outil de\n"
          f"build (pas livré aux joueurs) — voir devtools/README.txt pour le\n"
          f"retélécharger si besoin.")
    sys.exit(1)

# Ré-encodage des musiques : les .mp3 d'origine sont en 256/320 kbps (qualité
# album) alors que ce sont des boucles d'ambiance jouées en fond de jeu. À
# 128 kbps la différence est inaudible dans ces conditions, et le paquet perd
# une quarantaine de Mo — ce qui le fait repasser sous la limite des 100 Mo par
# fichier de GitHub. Les originaux ne sont JAMAIS modifiés : comme pour le JS,
# le ré-encodage se fait sur la copie, dans le dossier temporaire.
AUDIO_BITRATE = "128k"


def find_ffmpeg():
    """Cherche ffmpeg dans devtools/ (s'il y est déposé un jour, pour rendre le
    build autonome comme esbuild), puis sur le PATH, puis dans les paquets
    winget — après une installation par winget, le PATH n'est à jour que dans
    les consoles ouvertes ensuite, donc le chercher là évite un faux négatif."""
    local = PROJECT_ROOT / "devtools" / "ffmpeg.exe"
    if local.exists():
        return local
    found = shutil.which("ffmpeg")
    if found:
        return Path(found)
    packages = Path.home() / "AppData" / "Local" / "Microsoft" / "WinGet" / "Packages"
    if packages.is_dir():
        for candidate in packages.glob("Gyan.FFmpeg*/**/ffmpeg.exe"):
            return candidate
    return None


FFMPEG = find_ffmpeg()

# Fichiers/dossiers du dépôt de dev à NE PAS inclure dans la version vendue.
EXCLUDE_TOP_LEVEL = {
    ".claude", "__pycache__", ".git",
    "build_release.py", "Créer le paquet de vente.bat",
    "boutique_site.zip", "devtools",
}

INLINE_SCRIPT_RE = re.compile(r"(<script>)(.*?)(</script>)", re.DOTALL)


def detect_version() -> str:
    """Lit la version courante directement dans script.js (PATCH_NOTES_HISTORY),
    pour ne jamais avoir à la retaper à la main dans ce script."""
    script_js = PROJECT_ROOT / "script.js"
    text = script_js.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"PATCH_NOTES_HISTORY\s*=\s*\[\s*\{\s*version\s*:\s*'([^']+)'", text)
    return m.group(1) if m else "dev"


def safe_minify_js(original: str, label: str) -> tuple:
    """Minifie via esbuild (vrai analyseur JS complet — contrairement à
    rjsmin, testé et abandonné : il corrompait silencieusement du code
    réel, ex. instructions "return" et déclarations perdues). esbuild
    échoue bruyamment (code de sortie != 0) sur du JS invalide plutôt que
    de produire un résultat corrompu en silence, donc une erreur ici veut
    dire "le fichier original a un souci", pas "la minification a raté" —
    dans les deux cas, on garde l'original par sécurité."""
    if not original.strip():
        return original, False
    try:
        proc = subprocess.run(
            [str(ESBUILD), "--minify", "--loader=js"],
            input=original, capture_output=True, text=True, encoding="utf-8",
        )
    except Exception as err:
        print(f"  ! {label} : impossible de lancer esbuild ({err}) — conservé tel quel.")
        return original, False
    if proc.returncode != 0 or not proc.stdout.strip():
        print(f"  ! {label} : esbuild a échoué — conservé tel quel.\n{proc.stderr.strip()[:400]}")
        return original, False
    return proc.stdout, True


def process_file(src: Path, dst: Path, stats: dict):
    dst.parent.mkdir(parents=True, exist_ok=True)
    suffix = src.suffix.lower()

    # Bibliothèques tierces rapatriées en local (vendor/) : recopiées telles
    # quelles, jamais reminifiées. Elles sont déjà optimisées à la source, et
    # les repasser au minifieur ne ferait que prendre le risque de casser un
    # code qu'on ne maîtrise pas — esbuild renomme les fonctions, or certaines
    # bibliothèques s'appuient dessus (constructor.name, enregistrement de
    # types). Aucun gain à espérer, un vrai risque à courir.
    if "vendor" in src.parts:
        shutil.copy2(src, dst)
        return

    if suffix == ".js":
        original = src.read_text(encoding="utf-8", errors="ignore")
        minified, ok = safe_minify_js(original, src.name)
        dst.write_text(minified, encoding="utf-8")
        stats["before"] += len(original.encode("utf-8"))
        stats["after"] += len(minified.encode("utf-8"))
        if ok:
            stats["minified_files"] += 1

    elif suffix in (".html", ".htm"):
        original = src.read_text(encoding="utf-8", errors="ignore")
        before_total = len(original)

        def repl(m):
            open_tag, body, close_tag = m.group(1), m.group(2), m.group(3)
            minified, ok = safe_minify_js(body, f"{src.name} (script inline)")
            if ok:
                stats["minified_files"] += 1
            return open_tag + minified + close_tag

        result = INLINE_SCRIPT_RE.sub(repl, original)
        dst.write_text(result, encoding="utf-8")
        stats["before"] += before_total
        stats["after"] += len(result)

    elif suffix == ".mp3" and FFMPEG is not None:
        proc = subprocess.run(
            [str(FFMPEG), "-v", "error", "-y", "-i", str(src),
             "-codec:a", "libmp3lame", "-b:a", AUDIO_BITRATE,
             "-map_metadata", "0", str(dst)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        # Même principe que pour esbuild : au moindre pépin on garde
        # l'original, plutôt que de risquer un fichier audio tronqué qui
        # passerait inaperçu jusque chez les joueurs.
        if proc.returncode != 0 or not dst.exists() or dst.stat().st_size == 0:
            print(f"  ! {src.name} : ffmpeg a échoué — conservé tel quel.\n"
                  f"{(proc.stderr or '').strip()[:400]}")
            shutil.copy2(src, dst)
        else:
            stats["audio_before"] += src.stat().st_size
            stats["audio_after"] += dst.stat().st_size
            stats["audio_files"] += 1

    else:
        shutil.copy2(src, dst)


def build():
    version = detect_version()
    print(f"Version détectée : {version}")
    print(f"Dossier source   : {PROJECT_ROOT}")

    if FFMPEG is None:
        print("! ffmpeg introuvable : les musiques resteront en 256/320 kbps et le\n"
              "  paquet dépassera les 100 Mo (limite GitHub par fichier).\n"
              "  Pour l'installer :  winget install Gyan.FFmpeg")

    with tempfile.TemporaryDirectory(prefix="esports_director_build_") as tmp:
        staging = Path(tmp) / "game"
        staging.mkdir()

        stats = {"before": 0, "after": 0, "minified_files": 0,
                 "audio_before": 0, "audio_after": 0, "audio_files": 0}

        for item in PROJECT_ROOT.iterdir():
            if item.name in EXCLUDE_TOP_LEVEL:
                continue
            if item.is_dir():
                for src in item.rglob("*"):
                    if src.is_file():
                        rel = src.relative_to(PROJECT_ROOT)
                        process_file(src, staging / rel, stats)
            else:
                process_file(item, staging / item.name, stats)

        BUILD_DIR.mkdir(parents=True, exist_ok=True)
        # Nettoie les anciens paquets pour ne jamais laisser traîner une
        # version obsolète à côté de la nouvelle.
        for old in BUILD_DIR.glob("EsportsDirector_*.zip"):
            old.unlink()

        dest_zip = BUILD_DIR / f"EsportsDirector_{version}.zip"
        with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in staging.rglob("*"):
                if f.is_file():
                    zf.write(f, f.relative_to(staging))

        saved_pct = (1 - stats["after"] / stats["before"]) * 100 if stats["before"] else 0
        print(f"Fichiers JS minifiés : {stats['minified_files']}")
        print(f"Taille du code JS/HTML : {stats['before']/1024:.0f} Ko -> "
              f"{stats['after']/1024:.0f} Ko ({saved_pct:.0f}% en moins)")
        if stats["audio_files"]:
            print(f"Musiques ré-encodées en {AUDIO_BITRATE} : {stats['audio_files']} — "
                  f"audio : {stats['audio_before']/1048576:.1f} Mo -> "
                  f"{stats['audio_after']/1048576:.1f} Mo")
        print(f"Paquet de vente créé : {dest_zip}")
        print(f"Taille finale du zip : {dest_zip.stat().st_size/1024/1024:.1f} Mo")


if __name__ == "__main__":
    build()
