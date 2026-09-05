/**
 * AI ROLES — Définition des 5 rôles Valorant
 */

'use strict';

const ROLE_DEFINITIONS = {
  'Duelist': {
    description: 'Premier à engager les combats',
    statMods: { aggression: +15, aim: +10, clutch: +10 },
    weapons: ['Phantom', 'Vandal'],
    utilities: []
  },
  'Initiator': {
    description: 'Récupère l\'information',
    statMods: { gameSense: +15, reaction: +10, utility: +15 },
    weapons: ['Specter', 'Judge'],
    utilities: []
  },
  'Controller': {
    description: 'Contrôle les zones',
    statMods: { discipline: +15, utility: +20 },
    weapons: ['Bulldog', 'Guardian'],
    utilities: []
  },
  'Sentinel': {
    description: 'Défend les flancs',
    statMods: { discipline: +20, gameSense: +10, aim: +5 },
    weapons: ['Guardian', 'Operator'],
    utilities: []
  },
  'Flex': {
    description: 'Adaptable',
    statMods: { communication: +10, gameSense: +10 },
    weapons: ['Phantom', 'Vandal'],
    utilities: []
  }
};
