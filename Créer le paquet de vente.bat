@echo off
cd /d "%~dp0"
title Creation du paquet de vente - Esports Director
echo Minification du code et creation du zip de vente...
echo (fichiers sources de ce dossier non modifies, tout se passe sur une copie)
echo.
python build_release.py
if errorlevel 1 (
  echo.
  echo Une erreur s'est produite. Verifie que Python et le module rjsmin
  echo sont installes ^(pip install rjsmin^).
)
echo.
pause
