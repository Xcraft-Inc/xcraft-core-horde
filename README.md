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
2. **Fwcast** (Forward cast) : Transmet un message à un esclave spécifique selon une clé de routage
3. **Unicast** : Envoie un message à un esclave spécifique en fonction d'un "orcName"

### Surveillance et résilience

Le module intègre un système de surveillance qui détecte les latences et les déconnexions :
- Mesure le temps de réponse entre les esclaves
- Affiche des indicateurs de performance via l'événement `greathall::<perf>`
- Peut afficher une interface de superposition (overlay) en cas de déconnexion
- Tente de rétablir les connexions perdues

Le système utilise différents seuils de latence pour déclencher des actions appropriées :
- Moins de 1000ms : Fonctionnement normal
- Entre 1000ms et 10000ms : Indication de latence
- Plus de 10000ms : Affichage d'un overlay (si configuré)
- Plus de 20000ms : Destruction du socket pour préparer un redémarrage (sauf en mode développement ou avec `optimistLag`)

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
- **[xcraft-server]** : Pour l'initialisation de l'environnement

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

### `config.js`

Définit la configuration du module via `xcraft-core-etc` avec les options suivantes :
- Configuration des hordes à charger automatiquement
- Paramètres de topologie
- Options de connexion et d'overlay

### `horde.js`

Définit les commandes Xcraft exposées par le module :

**`load`** - Charge les hordes configurées automatiquement. Émet un événement `horde.load.{id}.finished` en cas de succès ou `horde.load.{id}.error` en cas d'erreur.

**`reload`** - Décharge puis recharge toutes les hordes. Combine les opérations `unload` et `autoload`.

**`slave.add`** - Ajoute un esclave à la horde pour une application spécifique. Retourne l'ID de l'esclave créé.

**`slave.remove`** - Supprime un esclave de la horde en utilisant son ID (PID).

### `lib/index.js`

Contient l'implémentation principale du module avec les classes `Slave` et `Horde`.

#### Classe `Slave`

Représente un esclave dans la horde et hérite d'`EventEmitter`. Chaque esclave possède :

- Un identifiant unique (`_name` ou PID du processus)
- Une clé de routage (`_routingKey`) basée sur l'ID de horde et la tribu
- Un client bus pour la communication
- Optionnellement un daemon pour les processus démarrés localement

**Propriétés principales :**

- `id` : Retourne le PID du processus ou l'UUID si pas de daemon
- `routingKey` : Clé de routage pour identifier l'esclave
- `isConnected` : État de la connexion au bus
- `isPassive` : Mode passif (ne transmet que certains événements)
- `noForwarding` : Mode sans transfert automatique

**Méthodes principales :**

**`connect(busConfig)`** - Connecte l'esclave à un bus existant. Configure le client bus et établit les gestionnaires d'événements pour le transfert des messages.

**`start()`** - Démarre un nouveau processus esclave en utilisant `xcraft-core-daemon`. Configure automatiquement les paramètres d'application et de tribu.

**`stop(shutdown)`** - Arrête l'esclave de manière gracieuse. Si `shutdown` est true, envoie une commande d'arrêt au serveur.

**`busConfig(pid)`** - Génère la configuration du bus pour un processus donné en utilisant les paramètres de l'application et de la tribu.

#### Classe `Horde`

Gère l'ensemble des esclaves et leur communication. Utilise une `Map` pour stocker les esclaves et gère la topologie des connexions.

**Propriétés principales :**

- `routingKey` : Clé de routage de la horde principale
- `commands` : Registre complet des commandes de tous les esclaves
- `public` : Registre des commandes publiques (esclaves sans noForwarding)
- `isTribeDispatcher` : Indique si cette horde gère la distribution des tribus

**Méthodes principales :**

**`autoload(resp)`** - Charge automatiquement toutes les hordes configurées selon la topologie. Gère les hordes simples et celles avec tribus multiples.

**`add(slave, horde, busConfig)`** - Ajoute un esclave à la horde. Configure la surveillance des performances et établit les connexions.

**`remove(id, resp)`** - Supprime un esclave de la horde et nettoie ses ressources.

**`broadcast(hordeId, topic, msg)`** - Diffuse un message à tous les esclaves sauf l'émetteur. Gère le routage par ligne si spécifié.

**`fwcast(routingKey, topic, msg)`** - Transmet un message à un esclave spécifique identifié par sa clé de routage.

**`unicast(topic, msg, orcName)`** - Envoie un message à un esclave spécifique en utilisant le système de routage par orcName.

**`stop(all)`** - Arrête tous les esclaves. Si `all` est true, envoie des commandes d'arrêt aux serveurs.

**`unload(resp)`** - Décharge tous les esclaves de la horde.

#### Gestion des tribus

Le module supporte deux modes de déploiement :

1. **Mode simple** : Une horde avec une tribu principale (0) et optionnellement des tribus supplémentaires
2. **Mode distribué** : Connexion à des tribus existantes selon la configuration de topologie

La gestion des tribus permet de répartir la charge et d'organiser les services selon des critères métier.

#### Surveillance des performances

Chaque esclave connecté fait l'objet d'une surveillance continue :
- Mesure de la latence des communications
- Détection des déconnexions
- Émission d'événements `greathall::<perf>` pour l'interface utilisateur
- Gestion automatique de la reconnexion en cas de problème

_Cette documentation a été mise à jour automatiquement._

[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus
[xcraft-core-transport]: https://github.com/Xcraft-Inc/xcraft-core-transport
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-daemon]: https://github.com/Xcraft-Inc/xcraft-core-daemon
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-server]: https://github.com/Xcraft-Inc/xcraft-server