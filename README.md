# 📘 xcraft-core-horde

## Aperçu

Le module `xcraft-core-horde` est le composant Xcraft chargé de la gestion et de la coordination d'une **horde** : un ensemble de processus applicatifs (« esclaves » ou _slaves_) qui collaborent au sein d'une même architecture distribuée. Il permet de démarrer de nouveaux processus, de se connecter à des processus existants, de router les commandes et les événements entre eux, et de surveiller la santé de chaque connexion.

Une horde est un nœud serveur où des services sont déployés. Une horde peut posséder des sous-hordes, formant ainsi un graphe de serveurs à travers lequel commandes et événements circulent selon des règles de routage précises. Un « client » qui se connecte à un serveur principal ne fait en réalité que déclarer ce serveur comme une sous-horde dans sa propre configuration de topologie.

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

Le module s'organise autour de deux classes principales définies dans `lib/index.js` :

- **`Slave`** — Représente une instance d'application connectée à la horde, qu'elle soit démarrée localement (processus daemon) ou simplement connectée à un bus distant déjà actif. Chaque esclave possède sa propre clé de routage et son propre `BusClient`.
- **`Horde`** — Orchestre l'ensemble des esclaves : cycle de vie, topologie, diffusion des messages et surveillance de la latence des connexions. Le module exporte une **instance singleton** de cette classe.

En complément, le module expose :

- **`horde.js`** — Un ensemble de commandes Xcraft (`horde.load`, `horde.reload`, `horde.slave.add`, `horde.slave.remove`) exposées sur le bus.
- **`lib/offlineChecker.js`** — Un utilitaire (`OfflineChecker`) permettant à un acteur Goblin de surveiller la connectivité d'une horde spécifique.
- **`config.js`** — La définition des options configurables via `xcraft-core-etc`.

## Fonctionnement global

### Concept de Horde et de Tribus

Chaque application Xcraft peut être divisée en **tribus** (_tribes_) : des instances distinctes du même code, chacune avec sa propre configuration de bus (ports différents). La tribu principale porte le numéro `0`.

La clé de routage (`routingKey`) d'un esclave suit le format :

- `{hordeId}` pour la tribu principale,
- `{hordeId}-{tribe}` pour les tribus numérotées.

Le module permet de :

- démarrer de nouveaux processus esclaves via [xcraft-core-daemon][xcraft-core-daemon] ;
- se connecter à des esclaves déjà en cours d'exécution via leur configuration de bus ;
- diffuser des messages entre esclaves (broadcast, fwcast, unicast) ;
- surveiller en continu l'état de santé et la latence de chaque connexion.

### Communication entre esclaves

La communication repose sur [xcraft-core-bus][xcraft-core-bus] et [xcraft-core-transport][xcraft-core-transport]. Trois modes de transmission sont disponibles :

1. **Broadcast** — Diffuse un message à tous les esclaves, à l'exception de l'émetteur. Un routage par ligne (`Router.extractLineId`) restreint la diffusion aux seuls esclaves concernés lorsque le topic référence une ligne spécifique.
2. **Fwcast** (_forward cast_) — Transmet un message à un esclave précis, identifié par sa clé de routage.
3. **Unicast** — Envoie un message à un esclave précis via le routeur axon associé à un `orcName`.

Chaque esclave connecté s'abonne à l'ensemble des topics (`['*::*']`) via son `BusClient`, sauf s'il fonctionne en mode `noForwarding`. Le gestionnaire `catchAll` reçu sur ce `BusClient` agit comme un proxy : il réachemine les messages de commande (`.finished`, `.error`) et les événements orcishés (`.orcished`) vers la horde locale via `fwcast` ou `unicast`, puis retombe sur un `broadcast` si aucune des deux tentatives n'a abouti.

- Le mode **`noForwarding`** signale que l'esclave ne doit pas agir comme proxy automatique : les informations de forwarding sont alors ajoutées au message pour permettre un routage explicite côté horde parente.
- Le mode **`passive`** restreint la transmission aux seuls événements de commandes, aux événements `.orcished` et aux appels RPC (`_xcraftRPC`), en ignorant les autres événements tant que l'esclave n'est pas connecté.

### Surveillance et résilience

Chaque esclave connecté est surveillé par un intervalle d'une seconde qui mesure la latence via `performance.now()` et `busClient.events.lastPerf()`. Un événement `greathall::<perf>` est émis avec le payload suivant :

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

Seuils appliqués :

- **< 1000 ms** — Fonctionnement normal ; l'événement `lag: false` n'est émis qu'une seule fois, au moment du retour à la normale.
- **1000 – 10 000 ms** — Latence signalée, sans overlay.
- **≥ 10 000 ms** — Latence critique ; l'overlay est activé si `connection.useOverlay` est vrai.
- **≥ `maxLagDeltaTime`** (20 000 ms par défaut, réglable via `setMaxLagDeltaTime`) — Le socket push de l'esclave est détruit pour préparer une reconnexion, sauf en environnement `NODE_ENV=development` ou si l'option de topologie `optimistLag` est active.

Si l'esclave n'a plus de socket (`lastPerf < 0`), la dernière latence connue est conservée (`prevPerf`) et `reason` reprend la dernière erreur de connexion (`lastErrorReason`) du `BusClient`.

### Chargement de la topologie

Lors de l'appel à `autoload`, le module parcourt la liste des hordes déclarées dans la configuration et, pour chacune :

- si la topologie définit des `tribes` pour cette horde, il utilise `_loadTribes` afin de se connecter à toutes les tribus de l'application courante (à l'exception de la tribu courante) — l'horde qui gère sa propre distribution de tribus devient alors le « tribe dispatcher » (`isTribeDispatcher`) ;
- sinon, il utilise `_loadSingle` afin de démarrer ou de se connecter à la tribu principale (0), puis aux tribus supplémentaires éventuellement déclarées dans la configuration de bus de l'esclave.

La topologie peut être exprimée sous forme de chaîne JSON ou d'objet (contrainte imposée par Inquirer, qui ne gère que des chaînes) ; elle peut également être surchargée au démarrage via l'argument `--topology` grâce à `modules.mergeOverloads` de [xcraft-core-utils][xcraft-core-utils].

## Exemples d'utilisation

### Chargement automatique des hordes

```javascript
const horde = require('xcraft-core-horde');
// resp est l'objet de réponse Xcraft disponible dans une quête ou une commande
await horde.autoload(resp);
```

### Ajout d'un esclave via le bus

```javascript
// Depuis une quête Goblin, ajoute un esclave pour l'application 'myApp'
const {slaveId} = yield this.quest.cmd('horde.slave.add', {appId: 'myApp'});

// Puis, pour le retirer :
yield this.quest.cmd('horde.slave.remove', {pid: slaveId});
```

> Note : `Horde.add()` est également utilisable directement en interne (c'est ce que fait `autoload`), mais depuis une commande du bus il est préférable de passer par `horde.slave.add` / `horde.slave.remove` comme ci-dessus.

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
// Depuis une quête Goblin
yield this.quest.cmd('horde.reload');
```

### Surveillance de la connectivité d'une horde depuis un acteur

```javascript
const OfflineChecker = require('xcraft-core-horde/lib/offlineChecker.js');

// Dans le constructeur/init d'un acteur Goblin
const checker = new OfflineChecker(quest, 'myApp', async (isConnected) => {
  if (isConnected) {
    quest.log.info('myApp est de nouveau en ligne');
  } else {
    quest.log.warn('myApp est hors ligne');
  }
});
```

## Interactions avec d'autres modules

- **[xcraft-core-bus][xcraft-core-bus]** — Notification des changements de registre de commandes, de token et de reconnexion ; obtention du token courant.
- **[xcraft-core-busclient][xcraft-core-busclient]** — Création des `BusClient` pour la connexion aux bus esclaves ; accès au client global (`getGlobal()`) pour l'émission d'événements de diffusion et de performance.
- **[xcraft-core-transport][xcraft-core-transport]** — Résolution des routeurs axon pour le mode unicast et extraction des identifiants de ligne pour le broadcast ciblé.
- **[xcraft-core-etc][xcraft-core-etc]** — Chargement de la configuration du module ainsi que de la configuration de bus (`xcraft-core-bus`) de chaque esclave.
- **[xcraft-core-daemon][xcraft-core-daemon]** — Démarrage des processus esclaves en tant que daemons détachés.
- **[xcraft-core-host][xcraft-core-host]** — Accès aux informations de l'application hôte (`appId`, `appArgs`, `variantId`, `appData`, `appCompany`, `appConfigPath`, `projectPath`).
- **[xcraft-core-utils][xcraft-core-utils]** — Fusion de la topologie fournie en ligne de commande (`modules.mergeOverloads`).
- **[xcraft-server][xcraft-server]** — Initialisation de l'environnement (`init-env.js#initEtc`) pour chaque esclave démarré.

## Configuration avancée

Le fichier `config.js` définit les options suivantes, exploitées par [xcraft-core-etc][xcraft-core-etc] :

| Option                  | Description                                                           | Type            | Valeur par défaut |
| ----------------------- | --------------------------------------------------------------------- | --------------- | ----------------- |
| `hordes`                | Liste des hordes à charger automatiquement                            | `Array`         | `[]`              |
| `topology`              | Configuration JSON de la topologie des hordes (hôtes, ports, tribus…) | `String/Object` | `''`              |
| `autoload`              | Charge automatiquement la topologie au démarrage                      | `Boolean`       | `true`            |
| `connection.useOverlay` | Active l'affichage d'une superposition UI en cas de déconnexion       | `Boolean`       | `true`            |

### Variables d'environnement

| Variable      | Description                                                                                                                              | Exemple         | Valeur par défaut |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------- |
| `NODE_ENV`    | Environnement d'exécution ; en `development`, la destruction automatique du socket en cas de lag important est désactivée                | `development`   | —                 |
| `GOBLINS_APP` | Identifiant temporaire de l'application Goblins positionné le temps de résoudre la configuration de bus d'un esclave (`Slave.busConfig`) | `myApp@variant` | —                 |

## Détails des sources

### `horde.js`

Fichier de commandes Xcraft exposées sur le bus, toutes déclarées en mode `parallel` :

- **`horde.load`** — Appelle `horde.autoload(resp)`. Émet `horde.load.{id}.finished` en cas de succès, ou `horde.load.{id}.error` (avec `code`, `message`, `stack`) en cas d'échec.
- **`horde.reload`** — Appelle successivement `horde.unload(resp)` puis `horde.autoload(resp)`. Émet `horde.reload.{id}.finished` ou `horde.reload.{id}.error`.
- **`horde.slave.add`** — Ajoute un esclave pour l'`appId` fourni dans les données du message. Retourne `{slaveId}` via `horde.slave.add.{id}.finished`.
- **`horde.slave.remove`** — Supprime l'esclave identifié par le paramètre requis `pid` (`slaveId`). Émet `horde.slave.remove.{id}.finished` (sans payload) ou `horde.slave.remove.{id}.error`.

### `lib/index.js`

Contient l'implémentation principale du module : les classes `Slave` et `Horde`, ainsi que l'instance singleton exportée.

#### Classe `Slave`

Hérite d'`EventEmitter`. Représente un esclave, qu'il s'agisse d'un processus démarré localement via [xcraft-core-daemon][xcraft-core-daemon] ou d'une simple connexion vers un serveur déjà actif.

##### Propriétés

- **`id`** — PID du processus daemon, ou UUID généré (`_name`) si l'esclave n'a pas de daemon associé.
- **`horde`** — Identifiant de la horde (`hordeId`).
- **`routingKey`** — Clé de routage : `{hordeId}` ou `{hordeId}-{tribe}`.
- **`commands`** — Registre des commandes disponibles sur cet esclave.
- **`busClient`** — Instance `BusClient` utilisée pour la communication.
- **`isDaemon`** — `true` si l'esclave a été démarré via un daemon local.
- **`isConnected`** — État courant de la connexion au bus.
- **`isPassive`** — `true` si l'esclave fonctionne en mode passif.
- **`noForwarding`** — `true` si l'esclave ne doit pas réacheminer automatiquement les messages.
- **`tribe`** — Numéro de la tribu.
- **`totalTribes`** _(setter uniquement)_ — Nombre total de tribus de la horde.
- **`lastErrorReason`** — Dernière raison d'erreur rapportée par le `BusClient`.

##### Méthodes publiques

- **`connect(busConfig)`** — Connecte l'esclave à un bus existant. Instancie le `BusClient` (abonné à `['*::*']` sauf en mode `noForwarding`), relaie les événements `commands.registry`, `token.changed`, `orcname.changed`, `reconnect` et `reconnect attempt`, puis installe un gestionnaire `catchAll` qui agit comme proxy de réacheminement (fwcast/unicast avec repli sur broadcast) pour tous les messages reçus, à l'exception des topics `greathall::*` et des messages déjà diffusés (`_xcraftBroadcasted`).
- **`start()`** — Démarre un nouveau processus esclave via [xcraft-core-daemon][xcraft-core-daemon], avec les arguments `--app` et `--tribe` (et `--total-tribes` si plusieurs tribus sont configurées). Tente de lire le fichier de configuration du bus toutes les 5 secondes, jusqu'à 10 tentatives, avant d'appeler `connect`. Lève une erreur si la tribu n'est pas définie.
- **`stop(shutdown)`** — Arrête l'esclave proprement : retire tous les listeners, envoie la commande `shutdown` au bus distant si `shutdown` est vrai et que l'esclave n'est pas en mode `noForwarding`, puis arrête le daemon local le cas échéant.
- **`busConfig(pid)`** — Construit la configuration de bus pour un PID donné, en initialisant temporairement `GOBLINS_APP` et en appelant `initEtc` de [xcraft-server][xcraft-server] avec le bon chemin d'application/variante.

##### Événements émis

- **`commands.registry`** — Le registre de commandes de l'esclave a été mis à jour.
- **`token.changed`** — Le token d'authentification du `BusClient` a changé.
- **`orcname.changed`** — L'`orcName` associé a changé.
- **`reconnect`** — Reconnexion réussie au bus distant.
- **`reconnect attempt`** — Une tentative de reconnexion est en cours.

#### Classe `Horde`

Gère l'ensemble des esclaves via une `Map` privée (`_slaves`), les intervalles de surveillance de latence (`_deltaInterval`) et les promesses de connexion passive (`#connects`).

##### Propriétés

- **`routingKey`** — Clé de routage de la horde courante (dépend de la tribu locale).
- **`commands`** — Registre complet de tous les esclaves, y compris ceux en mode `noForwarding`.
- **`public`** — Registre des seuls esclaves qui ne sont pas en mode `noForwarding`.
- **`config`** — Configuration chargée depuis [xcraft-core-etc][xcraft-core-etc].
- **`isTribeDispatcher`** — `true` si cette horde a la charge de distribuer les tribus de son propre `appId`.
- **`busClient`** — Objet exposant `command.send(routingKey, cmd, msg)`, qui enrichit le message (ARP, `route`, priorité `nice`, `router`) avant de le transmettre à l'esclave correspondant.

##### Méthodes publiques

- **`setMaxLagDeltaTime(delta=20000)`** — Définit le seuil de latence (en ms) au-delà duquel le socket push d'un esclave est détruit.
- **`autoload(resp)`** — Charge toutes les hordes déclarées dans la configuration, en tenant compte de leur topologie (tribus ou mode simple). Ne fait rien si aucune horde n'est configurée.
- **`waitAutoload(timeout=5000)`** — Attend la résolution des connexions passives en attente, avec un intervalle de vérification de 200 ms. Retourne dès qu'une erreur de connexion est détectée sur un esclave, afin d'éviter une attente inutile lorsque le serveur distant est inaccessible.
- **`add(slave, horde, busConfig)`** — Ajoute un esclave à la horde. Si une `busConfig` est fournie (ou trouvée dans la topologie), connecte l'esclave existant et met en place la surveillance de latence ; sinon, démarre un nouveau processus via `slave.start()`. Notifie le registre de commandes via `xBus.notifyCmdsRegistry()`.
- **`remove(id, resp)`** — Retire un esclave : nettoie son intervalle de surveillance, retire ses listeners et appelle `slave.stop(false)`.
- **`broadcast(hordeId, topic, msg)`** — Diffuse un message à tous les esclaves sauf celui d'origine (`hordeId`), en tenant compte d'un éventuel filtrage par ligne (`Router.extractLineId`) et en ignorant les esclaves passifs non connectés.
- **`fwcast(routingKey, topic, msg)`** — Transmet un message à l'esclave correspondant à la clé de routage donnée. Retourne `true` en cas de succès, `false` sinon.
- **`unicast(topic, msg, orcName?)`** — Envoie un message via le routeur axon associé à l'`orcName` (déduit de `msg.orcName` si non fourni). Retourne `true` en cas de succès.
- **`stop(all)`** — Arrête tous les esclaves (envoi de `shutdown` si `all` est vrai ou si l'esclave est un daemon local) et nettoie tous les intervalles de surveillance.
- **`unload(resp)`** — Décharge tous les esclaves en appelant `remove` pour chacun d'eux.
- **`getSlaves()`** — Retourne la liste des clés de routage de tous les esclaves actifs.
- **`getTribe(routingKey)`** — Retourne le numéro de tribu associé à une clé de routage, ou `-1` si non trouvée.
- **`getSlave(routingKey)`** — Retourne l'instance `Slave` associée à une clé de routage, ou `-1` si non trouvée.
- **`isNoForwarding(hordeId)`** — Indique si l'esclave associé à la horde donnée fonctionne en mode `noForwarding`.
- **`hasSyncing(hordeId)`** — Indique si la synchronisation est activée pour la horde donnée (absence de l'option `noSync` dans la topologie).

Le module exporte une **instance singleton** de `Horde` (`module.exports = new Horde()`) ainsi que la classe elle-même (`module.exports.Horde = Horde`), permettant d'instancier une horde alternative si nécessaire.

### `lib/offlineChecker.js`

Utilitaire permettant à un acteur Goblin de surveiller l'état de connectivité d'une horde spécifique, sans avoir à gérer directement l'abonnement à l'événement de performance.

#### Classe `OfflineChecker`

##### Constructeur

- **`constructor(quest, hordeId, callback)`** — Initialise l'état de connexion courant à partir de `xHorde.getSlave(hordeId)`, puis souscrit (via `quest.sub.local` et `quest.goblin.defer` pour la désinscription automatique) à l'événement `greathall::<perf>`. Le `callback` (asynchrone) reçoit un booléen — `true` si la horde vient de se reconnecter, `false` si elle vient de se déconnecter — et n'est invoqué que lors d'une transition d'état, jamais de façon répétée.

La détection s'appuie sur le champ `noSocket` du payload : si `noSocket` vaut `true`, la horde est considérée hors ligne. Les événements marqués `syncing`, ou concernant une autre horde que celle surveillée, sont ignorés.

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

---

[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-transport]: https://github.com/Xcraft-Inc/xcraft-core-transport
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-daemon]: https://github.com/Xcraft-Inc/xcraft-core-daemon
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-server]: https://github.com/Xcraft-Inc/xcraft-server

_Ce contenu a été généré par IA_
