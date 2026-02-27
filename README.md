# 📘 xcraft-core-horde

## Aperçu

Le module `xcraft-core-horde` est un composant central de l'écosystème Xcraft qui gère la communication et la coordination entre plusieurs instances d'applications (appelées "hordes"). Il permet de créer une architecture distribuée où plusieurs processus (esclaves ou "slaves") peuvent communiquer entre eux, formant ainsi un système cohérent et résilient.

Une horde est un nœud serveur où des services sont déployés. Une horde peut avoir des sous-hordes, créant ainsi un graphe de serveurs où les commandes et événements peuvent être échangés selon des règles définies. Lorsqu'un "client" se connecte à un serveur principal, c'est simplement parce que dans ses paramètres de horde, une sous-horde est spécifiée.

## Sommaire

- [Aperçu](#aperçu)
- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)
- [Licence](#licence)

## Structure du module

Le module s'organise autour de deux classes principales :

- **`Slave`** : Représente une instance d'application connectée à la horde. Chaque esclave peut être un processus distinct avec sa propre configuration de bus et sa clé de routage.
- **`Horde`** : Gère l'ensemble des esclaves, leur cycle de vie, la topologie et la communication entre eux.

Le module expose également des commandes Xcraft (via `horde.js`) permettant de manipuler la horde depuis le bus.

## Fonctionnement global

### Concept de Horde et Tribus

Dans l'architecture Xcraft, une "horde" représente un ensemble d'applications qui collaborent. Chaque application peut être divisée en "tribus" (tribes), qui sont des instances distinctes partageant le même code mais avec des configurations de bus différentes (ports distincts).

La clé de routage d'un esclave suit le pattern `{hordeId}` pour la tribu principale (0) ou `{hordeId}-{tribe}` pour les tribus numérotées.

Le système permet de :

- Démarrer de nouveaux processus esclaves via `xcraft-core-daemon`
- Connecter des esclaves existants via leur configuration de bus
- Diffuser des messages entre les esclaves (broadcast, fwcast, unicast)
- Surveiller l'état de santé et la latence des connexions

### Communication entre esclaves

La communication est assurée par `xcraft-core-bus` et `xcraft-core-transport`. Trois modes sont disponibles :

1. **Broadcast** : Envoie un message à tous les esclaves (sauf l'émetteur). Gère également le routage par ligne si le topic le spécifie.
2. **Fwcast** (Forward cast) : Transmet un message à un esclave spécifique identifié par sa clé de routage.
3. **Unicast** : Envoie un message à un esclave spécifique via le routeur axon associé à un `orcName`.

Le mode `noForwarding` permet à un esclave de ne pas agir comme proxy : les messages ne sont pas automatiquement réacheminés, mais des informations de forwarding sont ajoutées pour permettre un routage explicite.

Le mode `passive` restreint la transmission aux seuls événements de commandes (`.finished`, `.error`), aux événements `.orcished` et aux appels RPC.

### Surveillance et résilience

Chaque esclave connecté fait l'objet d'une surveillance par intervalle d'une seconde mesurant la latence via `performance.now()` et `events.lastPerf()`. Des événements `greathall::<perf>` sont émis avec le payload suivant :

```javascript
{
  horde: string,     // Identifiant de la horde
  delta: number,     // Latence en millisecondes
  lag: boolean,      // Présence de latence
  overlay: boolean,  // Affichage de l'overlay demandé
  noSocket: boolean, // Connexion perdue
  reason: string     // Raison de l'erreur de connexion
}
```

Les seuils déclencheurs sont les suivants :

- **< 1000 ms** : Fonctionnement normal ; l'événement est émis une seule fois lors du retour à la normale.
- **1000–10 000 ms** : Latence signalée sans overlay.
- **> 10 000 ms** : Latence critique avec overlay (si `connection.useOverlay` est activé).
- **≥ 20 000 ms** (configurable via `setMaxLagDeltaTime`) : Destruction du socket push pour préparer une reconnexion, sauf en mode `development` ou avec l'option `optimistLag`.

### Chargement de la topologie

Lors de l'`autoload`, le module lit la liste des hordes configurées et, pour chacune :

- Si la topologie définit des `tribes` pour cette horde, il utilise `_loadTribes` pour se connecter aux tribus existantes de l'application courante (en excluant la tribu courante).
- Sinon, il utilise `_loadSingle` pour démarrer ou se connecter à la tribu principale (0) puis aux tribus supplémentaires déclarées dans la configuration de bus.

La topologie peut aussi être surchargée au démarrage via l'argument `--topology` (JSON).

## Exemples d'utilisation

### Chargement automatique des hordes

```javascript
const horde = require('xcraft-core-horde');
// resp est l'objet de réponse Xcraft disponible dans une quête ou commande
await horde.autoload(resp);
```

### Ajout manuel d'un esclave

```javascript
const horde = require('xcraft-core-horde');

// Ajouter un esclave pour une application spécifique (démarre un nouveau processus)
const slaveId = await horde.add(resp, 'myApp', null);
console.log(`Nouvel esclave créé avec l'ID: ${slaveId}`);
```

### Envoi de messages entre esclaves

```javascript
const horde = require('xcraft-core-horde');

// Diffuser à tous les esclaves (sauf l'émetteur)
horde.broadcast('sourceSlaveId', 'mon.topic', {data: 'Hello world'});

// Transmettre à un esclave spécifique via sa clé de routage
horde.fwcast('myApp-0', 'mon.topic', {data: 'Message ciblé'});

// Envoyer via orcName
horde.unicast('mon.topic', {data: 'Message pour un orc'}, 'monOrcName');
```

### Rechargement des hordes via le bus

```javascript
// Via le bus Xcraft (dans une quête Goblin)
await this.quest.cmd('horde.reload');
```

## Interactions avec d'autres modules

- **[xcraft-core-bus]** : Notification des changements de registre de commandes, de token et de reconnexion ; émission des événements de performance.
- **[xcraft-core-busclient]** : Création des `BusClient` pour la connexion aux bus esclaves ; client global pour l'émission d'événements.
- **[xcraft-core-transport]** : Routage unicast via les routeurs axon associés aux `orcName`.
- **[xcraft-core-etc]** : Lecture de la configuration du module et des bus esclaves.
- **[xcraft-core-daemon]** : Lancement des processus esclaves en tant que daemons.
- **[xcraft-core-host]** : Accès aux informations d'application (`appId`, `variantId`, `appData`, `appConfigPath`).
- **[xcraft-server]** : Initialisation de l'environnement (`initEtc`) pour les esclaves.

## Configuration avancée

| Option                  | Description                                                           | Type            | Valeur par défaut |
| ----------------------- | --------------------------------------------------------------------- | --------------- | ----------------- |
| `hordes`                | Liste des hordes à charger automatiquement                            | `Array`         | `[]`              |
| `topology`              | Configuration JSON de la topologie des hordes (hôtes, ports, tribus…) | `String/Object` | `''`              |
| `autoload`              | Charge automatiquement la topologie au démarrage                      | `Boolean`       | `true`            |
| `connection.useOverlay` | Active l'affichage d'une superposition UI en cas de déconnexion       | `Boolean`       | `true`            |

### Variables d'environnement

| Variable      | Description                                                                                    | Exemple         | Valeur par défaut |
| ------------- | ---------------------------------------------------------------------------------------------- | --------------- | ----------------- |
| `NODE_ENV`    | Environnement d'exécution ; désactive la destruction de socket en `development`                | `development`   | —                 |
| `GOBLINS_APP` | Identifiant de l'application Goblins, utilisé lors du chargement de la config bus d'un esclave | `myApp@variant` | —                 |

## Détails des sources

### `horde.js`

Fichier de commandes Xcraft exposées sur le bus. Toutes les commandes sont déclarées en mode `parallel`.

- **`horde.load`** — Déclenche `horde.autoload(resp)`. Émet `horde.load.{id}.finished` ou `horde.load.{id}.error`.
- **`horde.reload`** — Exécute `horde.unload` puis `horde.autoload`. Émet `horde.reload.{id}.finished` ou `horde.reload.{id}.error`.
- **`horde.slave.add`** — Ajoute un esclave pour l'`appId` fourni en paramètre. Retourne `{slaveId}` via `horde.slave.add.{id}.finished`.
- **`horde.slave.remove`** — Supprime l'esclave identifié par `slaveId`. Paramètre requis : `pid`.

### `lib/index.js`

Contient l'implémentation principale avec les classes `Slave` et `Horde`.

#### Classe `Slave`

Hérite d'`EventEmitter`. Représente un esclave, qu'il soit un processus démarré localement (via `xcraft-core-daemon`) ou une connexion vers un serveur distant.

##### Propriétés

- **`id`** — PID du processus daemon ou UUID généré si pas de daemon.
- **`horde`** — Identifiant de la horde (`hordeId`).
- **`routingKey`** — Clé de routage : `{hordeId}` ou `{hordeId}-{tribe}`.
- **`commands`** — Registre des commandes disponibles sur cet esclave.
- **`busClient`** — Instance `BusClient` pour la communication.
- **`isDaemon`** — `true` si l'esclave a été démarré via un daemon local.
- **`isConnected`** — État de la connexion au bus.
- **`isPassive`** — Mode passif (transmission restreinte).
- **`noForwarding`** — Mode sans proxy automatique.
- **`tribe`** — Numéro de tribu.
- **`totalTribes`** — Nombre total de tribus (setter).
- **`lastErrorReason`** — Dernière raison d'erreur de connexion.

##### Méthodes publiques

- **`connect(busConfig)`** — Connecte l'esclave à un bus existant. Configure le `BusClient`, les handlers d'événements et le proxy `catchAll` pour le transfert des messages vers la horde. Les messages de commande (`.finished`, `.error`) et les événements orcishés sont routés en unicast ou fwcast avant un éventuel broadcast.

- **`start()`** — Démarre un nouveau processus esclave via `xcraft-core-daemon` avec les arguments `--app` et `--tribe`. Tente de lire la configuration du bus toutes les 5 secondes (jusqu'à 10 tentatives) avant d'appeler `connect`.

- **`stop(shutdown)`** — Arrête l'esclave. Si `shutdown` est `true`, envoie la commande `shutdown` au serveur et arrête le daemon le cas échéant.

- **`busConfig(pid)`** — Génère la configuration de bus pour un PID donné en initialisant l'environnement `xcraft-core-etc` avec le bon chemin d'application et de variante.

##### Événements émis

- **`commands.registry`** — Mise à jour du registre de commandes.
- **`token.changed`** — Changement de token d'authentification.
- **`orcname.changed`** — Changement d'orcName.
- **`reconnect`** — Reconnexion réussie.
- **`reconnect attempt`** — Tentative de reconnexion en cours.

#### Classe `Horde`

Gère l'ensemble des esclaves via une `Map` (`_slaves`) et les intervalles de surveillance (`_deltaInterval`).

##### Propriétés

- **`routingKey`** — Clé de routage de la horde courante.
- **`commands`** — Registre complet de tous les esclaves (y compris `noForwarding`).
- **`public`** — Registre des seuls esclaves sans `noForwarding`.
- **`config`** — Configuration chargée depuis `xcraft-core-etc`.
- **`isTribeDispatcher`** — `true` si cette horde gère la distribution des tribus pour son propre `appId`.
- **`busClient`** — Objet exposant `command.send(routingKey, cmd, msg)` pour envoyer une commande vers un esclave spécifique avec enrichissement du message (ARP, route, nice).

##### Méthodes publiques

- **`setMaxLagDeltaTime(delta=20000)`** — Définit le seuil de latence (ms) au-delà duquel le socket push est détruit pour forcer une reconnexion.

- **`autoload(resp)`** — Charge toutes les hordes configurées selon leur topologie (tribus ou mode simple).

- **`add(slave, horde, busConfig)`** — Ajoute un esclave. Si `busConfig` est fourni, connecte l'esclave ; sinon le démarre. Configure la surveillance des performances par intervalle d'une seconde.

- **`remove(id, resp)`** — Supprime un esclave : nettoie l'intervalle de surveillance, les listeners et appelle `stop(false)`.

- **`broadcast(hordeId, topic, msg)`** — Diffuse un message à tous les esclaves sauf l'émetteur, avec routage par ligne si applicable.

- **`fwcast(routingKey, topic, msg)`** — Transmet un message à l'esclave correspondant à la clé de routage. Retourne `true` en cas de succès.

- **`unicast(topic, msg, orcName?)`** — Envoie un message via le routeur axon associé à l'`orcName`. Retourne `true` en cas de succès.

- **`stop(all)`** — Arrête tous les esclaves. Si `all` est `true` ou si l'esclave est un daemon, envoie la commande de shutdown.

- **`unload(resp)`** — Décharge tous les esclaves en appelant `remove` pour chacun.

- **`getSlaves()`** — Retourne la liste des clés de routage de tous les esclaves actifs.

- **`getTribe(routingKey)`** — Retourne le numéro de tribu associé à une clé de routage, ou `-1` si non trouvé.

- **`getSlave(routingKey)`** — Retourne l'instance `Slave` associée à une clé de routage, ou `-1` si non trouvée.

- **`isNoForwarding(hordeId)`** — Retourne `true` si l'esclave de la horde spécifiée est en mode `noForwarding`.

Le module exporte une instance singleton de `Horde` (`module.exports = new Horde()`) ainsi que la classe `Horde` elle-même (`module.exports.Horde = Horde`).

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus
[xcraft-core-transport]: https://github.com/Xcraft-Inc/xcraft-core-transport
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-daemon]: https://github.com/Xcraft-Inc/xcraft-core-daemon
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-server]: https://github.com/Xcraft-Inc/xcraft-server

_Ce contenu a été généré par IA_
