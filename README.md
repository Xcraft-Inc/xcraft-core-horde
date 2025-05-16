# 📘 Documentation du module xcraft-core-horde

## Aperçu

Le module `xcraft-core-horde` est un composant central de l'écosystème Xcraft qui gère la communication et la coordination entre plusieurs instances d'applications (appelées "hordes"). Il permet de créer une architecture distribuée où plusieurs processus (esclaves ou "slaves") peuvent communiquer entre eux, formant ainsi un système cohérent et résilient.

Une horde est un nœud serveur où des services sont déployés. Une horde peut avoir des sous-hordes, créant ainsi un graphe de serveurs où les commandes et événements peuvent être échangés selon des règles définies. Tous les nœuds (serveurs comme clients) sont des hordes. Lorsqu'un "client" se connecte à un serveur principal, c'est simplement parce que dans ses paramètres de horde, une sous-horde est spécifiée.

## Structure du module

Le module s'organise autour de deux classes principales :

- **Slave** : Représente une instance d'application connectée à la horde. Chaque esclave peut être un processus distinct avec sa propre configuration.
- **Horde** : Gère l'ensemble des esclaves, leur cycle de vie et la communication entre eux.

Le module expose également des commandes Xcraft permettant de manipuler la horde depuis l'extérieur.

## Fonctionnement global

### Concept de Horde et Tribus

Dans l'architecture Xcraft, une "horde" représente un ensemble d'applications qui collaborent. Chaque application peut être divisée en "tribus" (tribes), qui sont des instances distinctes partageant le même code mais avec des configurations différentes.

Le système permet de :
- Démarrer et arrêter des esclaves dynamiquement
- Connecter des esclaves existants
- Diffuser des messages entre les esclaves
- Surveiller l'état de santé des connexions

### Communication entre esclaves

La communication entre les esclaves est assurée par un système de bus basé sur `xcraft-core-bus` et `xcraft-core-transport`. Trois modes de communication sont disponibles :

1. **Broadcast** : Envoie un message à tous les esclaves (sauf l'émetteur)
2. **Fwcast** (Forward cast) : Transmet un message à un esclave spécifique
3. **Unicast** : Envoie un message à un esclave spécifique en fonction d'un "orcName"

### Surveillance et résilience

Le module intègre un système de surveillance qui détecte les latences et les déconnexions :
- Mesure le temps de réponse entre les esclaves
- Affiche des indicateurs de performance
- Peut afficher une interface de superposition (overlay) en cas de déconnexion
- Tente de rétablir les connexions perdues

Le système utilise différents seuils de latence pour déclencher des actions appropriées :
- Moins de 1000ms : Fonctionnement normal
- Entre 1000ms et 10000ms : Indication de latence
- Plus de 10000ms : Affichage d'un overlay (si configuré)
- Plus de 20000ms : Destruction du socket pour préparer un redémarrage (sauf en mode développement)

## Exemples d'utilisation

### Chargement automatique des hordes

```javascript
const horde = require('xcraft-core-horde');
const resp = /* objet de réponse Xcraft */;

// Chargement automatique des hordes selon la configuration
await horde.autoload(resp);
```

### Ajout manuel d'un esclave

```javascript
const horde = require('xcraft-core-horde');
const resp = /* objet de réponse Xcraft */;

// Ajouter un esclave pour une application spécifique
const slaveId = await horde.add(resp, 'myApp', null);
console.log(`Nouvel esclave créé avec l'ID: ${slaveId}`);
```

### Envoi de messages entre esclaves

```javascript
const horde = require('xcraft-core-horde');

// Diffuser un message à tous les esclaves
horde.broadcast('sourceSlaveId', 'mon.topic', { data: 'Hello world' });

// Envoyer un message à un esclave spécifique
horde.fwcast('myApp-0', 'mon.topic', { data: 'Message ciblé' });

// Envoyer un message à un esclave en fonction d'un orcName
horde.unicast('mon.topic', { data: 'Message pour un orc spécifique' }, 'monOrcName');
```

## Interactions avec d'autres modules

Le module `xcraft-core-horde` interagit étroitement avec plusieurs autres modules de l'écosystème Xcraft :

- **[xcraft-core-bus]** : Pour la communication entre les processus
- **[xcraft-core-transport]** : Pour le routage des messages
- **[xcraft-core-etc]** : Pour la gestion de la configuration
- **[xcraft-core-daemon]** : Pour la gestion des processus esclaves
- **[xcraft-core-busclient]** : Pour la connexion aux bus
- **[xcraft-core-host]** : Pour l'accès aux informations sur l'hôte

## Configuration avancée

| Option | Description | Type | Valeur par défaut |
|--------|-------------|------|------------------|
| `hordes` | Liste des hordes à charger automatiquement | Array | `[]` |
| `topology` | Configuration de la topologie des hordes | String/Object | `''` |
| `autoload` | Indique si la topologie doit être chargée automatiquement | Boolean | `true` |
| `connection.useOverlay` | Active/désactive l'affichage d'une superposition en cas de déconnexion | Boolean | `true` |

### Variables d'environnement

| Variable | Description | Exemple | Valeur par défaut |
|----------|-------------|---------|------------------|
| `NODE_ENV` | Environnement d'exécution, affecte le comportement de reconnexion | `development` | - |
| `GOBLINS_APP` | Identifiant de l'application Goblins | `myApp@variant` | - |

## Détails des sources

### `horde.js`

Définit les commandes Xcraft exposées par le module :
- `load` : Charge les hordes configurées
- `reload` : Décharge puis recharge les hordes
- `slave.add` : Ajoute un esclave à la horde
- `slave.remove` : Supprime un esclave de la horde

### `lib/index.js`

Contient l'implémentation principale du module avec les classes `Slave` et `Horde`.

#### Classe `Slave`

Représente un esclave dans la horde. Principales fonctionnalités :
- Connexion à un esclave existant
- Démarrage d'un nouvel esclave
- Gestion des événements et des commandes
- Arrêt gracieux de l'esclave

La classe `Slave` gère également :
- La transmission des événements entre les bus
- La configuration spécifique à chaque esclave
- La surveillance de l'état de la connexion
- La gestion des modes passif et sans transfert (noForwarding)

#### Classe `Horde`

Gère l'ensemble des esclaves et leur communication. Principales fonctionnalités :
- Chargement automatique des hordes selon la configuration
- Ajout et suppression d'esclaves
- Diffusion de messages entre les esclaves
- Surveillance de l'état des connexions
- Gestion des tribus

La classe `Horde` implémente également :
- Un système de détection de latence avec différents niveaux d'alerte
- Un mécanisme de routage intelligent des messages
- La gestion des topologies complexes avec plusieurs tribus
- Des méthodes pour charger et décharger dynamiquement les esclaves

Le module utilise intensivement les générateurs JavaScript (avec la bibliothèque `gigawatts`) pour gérer les opérations asynchrones de manière séquentielle.

_Cette documentation a été mise à jour automatiquement._

[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus
[xcraft-core-transport]: https://github.com/Xcraft-Inc/xcraft-core-transport
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-daemon]: https://github.com/Xcraft-Inc/xcraft-core-daemon
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host