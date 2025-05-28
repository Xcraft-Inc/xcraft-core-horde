# 📘 Documentation du module xcraft-core-horde

## Aperçu

Le module `xcraft-core-horde` est un composant central de l'écosystème Xcraft qui gère la communication et la coordination entre plusieurs instances d'applications (appelées "hordes"). Il permet de créer une architecture distribuée où plusieurs processus (esclaves ou "slaves") peuvent communiquer entre eux, formant ainsi un système cohérent et résilient.

Une horde est un nœud serveur où des services sont déployés. Une horde peut avoir des sous-hordes, créant ainsi un graphe de serveurs où les commandes et événements peuvent être échangés selon des règles définies. Tous les nœuds (serveurs comme clients) sont des hordes. Lorsqu'un "client" se connecte à un serveur principal, c'est simplement parce que dans ses paramètres de horde, une sous-horde est spécifiée.

## Sommaire

- [Aperçu](#aperçu)
- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
  - [Concept de Horde et Tribus](#concept-de-horde-et-tribus)
  - [Communication entre esclaves](#communication-entre-esclaves)
  - [Surveillance et résilience](#surveillance-et-résilience)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)
- [API Reference](#api-reference)

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
horde.broadcast('sourceSlaveId', 'mon.topic', {data: 'Hello world'});

// Envoyer un message à un esclave spécifique
horde.fwcast('myApp-0', 'mon.topic', {data: 'Message ciblé'});

// Envoyer un message à un esclave en fonction d'un orcName
horde.unicast(
  'mon.topic',
  {data: 'Message pour un orc spécifique'},
  'monOrcName'
);
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

| Option                  | Description                                                            | Type          | Valeur par défaut |
| ----------------------- | ---------------------------------------------------------------------- | ------------- | ----------------- |
| `hordes`                | Liste des hordes à charger automatiquement                             | Array         | `[]`              |
| `topology`              | Configuration de la topologie des hordes                               | String/Object | `''`              |
| `autoload`              | Indique si la topologie doit être chargée automatiquement              | Boolean       | `true`            |
| `connection.useOverlay` | Active/désactive l'affichage d'une superposition en cas de déconnexion | Boolean       | `true`            |

### Variables d'environnement

| Variable      | Description                                                       | Exemple         | Valeur par défaut |
| ------------- | ----------------------------------------------------------------- | --------------- | ----------------- |
| `NODE_ENV`    | Environnement d'exécution, affecte le comportement de reconnexion | `development`   | -                 |
| `GOBLINS_APP` | Identifiant de l'application Goblins                              | `myApp@variant` | -                 |

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

## API Reference

### Classe Slave

Représente un esclave dans la horde et hérite d'`EventEmitter`. Chaque esclave possède :

- Un identifiant unique (`_name` ou PID du processus)
- Une clé de routage (`_routingKey`) basée sur l'ID de horde et la tribu
- Un client bus pour la communication
- Optionnellement un daemon pour les processus démarrés localement

#### Propriétés

| Propriété        | Type      | Description                                                    |
| ---------------- | --------- | -------------------------------------------------------------- |
| `id`             | `string`  | Retourne le PID du processus ou l'UUID si pas de daemon       |
| `horde`          | `string`  | Identifiant de la horde                                        |
| `routingKey`     | `string`  | Clé de routage pour identifier l'esclave                       |
| `commands`       | `object`  | Registre des commandes disponibles                             |
| `busClient`      | `object`  | Client de bus pour la communication                            |
| `isDaemon`       | `boolean` | Indique si l'esclave est un processus daemon                   |
| `isConnected`    | `boolean` | État de la connexion au bus                                    |
| `isPassive`      | `boolean` | Mode passif (ne transmet que certains événements)             |
| `noForwarding`   | `boolean` | Mode sans transfert automatique                                |
| `tribe`          | `number`  | Numéro de la tribu                                             |
| `totalTribes`    | `number`  | Nombre total de tribus configurées                             |
| `lastErrorReason`| `string`  | Dernière raison d'erreur de connexion                          |

#### Méthodes

**`connect(busConfig)`**
- **Description** : Connecte l'esclave à un bus existant
- **Paramètres** :
  - `busConfig` (object) : Configuration du bus
- **Retour** : Promise
- **Usage** : Configure le client bus et établit les gestionnaires d'événements pour le transfert des messages

**`start()`**
- **Description** : Démarre un nouveau processus esclave
- **Retour** : Promise
- **Usage** : Utilise `xcraft-core-daemon` pour créer un nouveau processus avec les paramètres d'application et de tribu

**`stop(shutdown)`**
- **Description** : Arrête l'esclave de manière gracieuse
- **Paramètres** :
  - `shutdown` (boolean) : Si true, envoie une commande d'arrêt au serveur
- **Retour** : Promise

**`busConfig(pid)`**
- **Description** : Génère la configuration du bus pour un processus donné
- **Paramètres** :
  - `pid` (string|number) : Identifiant du processus
- **Retour** : object - Configuration du bus
- **Usage** : Utilise les paramètres de l'application et de la tribu pour générer la config

#### Événements

| Événement           | Description                                    |
| ------------------- | ---------------------------------------------- |
| `commands.registry` | Émis lors de la mise à jour du registre       |
| `token.changed`     | Émis lors du changement de token               |
| `orcname.changed`   | Émis lors du changement d'orcName              |
| `reconnect`         | Émis lors d'une reconnexion réussie            |
| `reconnect attempt` | Émis lors d'une tentative de reconnexion      |

### Classe Horde

Gère l'ensemble des esclaves et leur communication. Utilise une `Map` pour stocker les esclaves et gère la topologie des connexions.

#### Propriétés

| Propriété           | Type      | Description                                                    |
| ------------------- | --------- | -------------------------------------------------------------- |
| `routingKey`        | `string`  | Clé de routage de la horde principale                          |
| `commands`          | `object`  | Registre complet des commandes de tous les esclaves           |
| `public`            | `object`  | Registre des commandes publiques (esclaves sans noForwarding) |
| `config`            | `object`  | Configuration de la horde                                      |
| `isTribeDispatcher` | `boolean` | Indique si cette horde gère la distribution des tribus        |
| `busClient`         | `object`  | Interface de client bus pour l'envoi de commandes             |

#### Méthodes

**`autoload(resp)`**
- **Description** : Charge automatiquement toutes les hordes configurées
- **Paramètres** :
  - `resp` (object) : Objet de réponse Xcraft
- **Retour** : Promise
- **Usage** : Gère les hordes simples et celles avec tribus multiples selon la topologie

**`add(slave, horde, busConfig)`**
- **Description** : Ajoute un esclave à la horde
- **Paramètres** :
  - `slave` (Slave|object) : Instance Slave ou objet de réponse
  - `horde` (string) : Identifiant de la horde
  - `busConfig` (object) : Configuration du bus (optionnel)
- **Retour** : Promise<string> - ID de l'esclave créé
- **Usage** : Configure la surveillance des performances et établit les connexions

**`remove(id, resp)`**
- **Description** : Supprime un esclave de la horde
- **Paramètres** :
  - `id` (string) : Identifiant de l'esclave
  - `resp` (object) : Objet de réponse Xcraft
- **Retour** : Promise
- **Usage** : Nettoie les ressources et supprime l'esclave de la collection

**`broadcast(hordeId, topic, msg)`**
- **Description** : Diffuse un message à tous les esclaves sauf l'émetteur
- **Paramètres** :
  - `hordeId` (string) : ID de la horde émettrice
  - `topic` (string) : Sujet du message
  - `msg` (object) : Contenu du message
- **Usage** : Gère le routage par ligne si spécifié dans le topic

**`fwcast(routingKey, topic, msg)`**
- **Description** : Transmet un message à un esclave spécifique
- **Paramètres** :
  - `routingKey` (string) : Clé de routage de l'esclave cible
  - `topic` (string) : Sujet du message
  - `msg` (object) : Contenu du message
- **Retour** : boolean - True si le message a été envoyé

**`unicast(topic, msg, orcName)`**
- **Description** : Envoie un message à un esclave spécifique par orcName
- **Paramètres** :
  - `topic` (string) : Sujet du message
  - `msg` (object) : Contenu du message
  - `orcName` (string) : Nom de l'orc cible (optionnel, utilise msg.orcName si absent)
- **Retour** : boolean - True si le message a été envoyé

**`stop(all)`**
- **Description** : Arrête tous les esclaves
- **Paramètres** :
  - `all` (boolean) : Si true, envoie des commandes d'arrêt aux serveurs
- **Retour** : Promise

**`unload(resp)`**
- **Description** : Décharge tous les esclaves de la horde
- **Paramètres** :
  - `resp` (object) : Objet de réponse Xcraft
- **Retour** : Promise

**`getSlaves()`**
- **Description** : Retourne la liste des clés de routage des esclaves
- **Retour** : Array<string> - Liste des clés de routage

**`getTribe(routingKey)`**
- **Description** : Retourne le numéro de tribu pour une clé de routage
- **Paramètres** :
  - `routingKey` (string) : Clé de routage
- **Retour** : number - Numéro de tribu ou -1 si non trouvé

**`getSlave(routingKey)`**
- **Description** : Retourne l'instance Slave pour une clé de routage
- **Paramètres** :
  - `routingKey` (string) : Clé de routage
- **Retour** : Slave|number - Instance Slave ou -1 si non trouvé

**`isNoForwarding(hordeId)`**
- **Description** : Vérifie si une horde est en mode noForwarding
- **Paramètres** :
  - `hordeId` (string) : Identifiant de la horde
- **Retour** : boolean|undefined

### Gestion des tribus

Le module supporte deux modes de déploiement :

1. **Mode simple** : Une horde avec une tribu principale (0) et optionnellement des tribus supplémentaires
2. **Mode distribué** : Connexion à des tribus existantes selon la configuration de topologie

La gestion des tribus permet de répartir la charge et d'organiser les services selon des critères métier.

### Surveillance des performances

Chaque esclave connecté fait l'objet d'une surveillance continue :

- Mesure de la latence des communications
- Détection des déconnexions
- Émission d'événements `greathall::<perf>` pour l'interface utilisateur
- Gestion automatique de la reconnexion en cas de problème

Les événements `greathall::<perf>` contiennent les informations suivantes :

```javascript
{
  horde: string,        // Identifiant de la horde
  delta: number,        // Latence en millisecondes
  lag: boolean,         // Indique si il y a de la latence
  overlay: boolean,     // Indique si l'overlay doit être affiché
  noSocket: boolean,    // Indique si la connexion est perdue
  reason: string        // Raison de l'erreur de connexion
}
```

### Commandes Xcraft exposées

Le module expose les commandes suivantes sur le bus Xcraft :

| Commande       | Description                                    | Paramètres requis |
| -------------- | ---------------------------------------------- | ----------------- |
| `horde.load`   | Charge les hordes configurées automatiquement | -                 |
| `horde.reload` | Recharge toutes les hordes                     | -                 |
| `horde.slave.add` | Ajoute un esclave à la horde                | `appId`           |
| `horde.slave.remove` | Supprime un esclave de la horde          | `slaveId` (PID)   |

_Cette documentation a été mise à jour automatiquement._

[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus
[xcraft-core-transport]: https://github.com/Xcraft-Inc/xcraft-core-transport
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-daemon]: https://github.com/Xcraft-Inc/xcraft-core-daemon
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-server]: https://github.com/Xcraft-Inc/xcraft-server