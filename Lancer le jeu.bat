@echo off
cd /d "%~dp0"
title Serveur Esports Director - NE FERME PAS cette fenetre pendant que tu joues
echo Demarrage du jeu...

rem Python portable fourni avec le jeu (runtime\python-embed) : aucune
rem installation requise chez le joueur. Si ce dossier est absent (ex. en
rem cours de developpement sur cette machine), on retombe sur un Python
rem deja installe sur le systeme.
set "PYEXE=%~dp0runtime\python-embed\python.exe"
if not exist "%PYEXE%" set "PYEXE=python"

start "" http://localhost:8935
"%PYEXE%" -m http.server 8935
if errorlevel 1 (
  echo.
  echo Impossible de demarrer le serveur du jeu.
  echo Si le probleme persiste, installe Python (python.org) puis relance ce fichier.
  pause
)
