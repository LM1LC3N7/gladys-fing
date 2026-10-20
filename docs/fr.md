# Fing

Les appareils de votre réseau vus par [Fing](https://www.fing.com), dans
Gladys, par l'API locale d'un **Fing Agent** (le logiciel Fing sur un
ordinateur toujours allumé ou un Raspberry Pi) ou d'une **Fingbox** :

- chaque appareil que Fing connaît peut devenir un appareil Gladys (onglet
  Découverte) : **en ligne** (oui / non), **adresse IP** et **dernier
  changement** (la dernière fois que Fing l'a vu arriver ou partir) ;
- le réseau devient un appareil avec ses **appareils en ligne** et ses
  **appareils** au total ;
- trois déclencheurs de scène : **Appareil en ligne** (un téléphone de retour
  à la maison, par exemple), **Appareil hors ligne** et **Nouvel appareil sur
  le réseau**.

Lecture seule : Gladys ne change jamais rien dans Fing (aucun appareil
bloqué, rien de renommé).

> **Cette intégration n'a jamais été testée avec un vrai Fing Agent.** Cette
> première version a été portée depuis fing-agent-pyapi, la bibliothèque de
> Fing qu'utilise Home Assistant, et testée seulement contre un faux Fing
> Agent. Dites sur le forum Gladys ce qui marche et ce qui ne marche pas.

Intégration non officielle, sans lien avec Fing.

## Avant de commencer : activer l'API locale

1. Installez un Fing Agent sur un ordinateur ou un Raspberry Pi qui reste
   allumé, dans votre réseau, ou utilisez une Fingbox, et laissez-le analyser
   le réseau.
2. Dans l'application Fing, ouvrez les réglages de l'agent (ou de la
   Fingbox) et activez son **API locale**. L'application affiche une **clé
   d'API** : copiez-la. Les noms des menus changent selon les versions de
   l'application ; l'API locale peut demander un abonnement Fing, vérifiez
   dans l'application.
3. Donnez à l'agent une adresse IP fixe dans votre box : Gladys le joint par
   son adresse.

## Configuration

- **Adresse du Fing Agent** : son adresse IP (`192.168.1.20`) ou son nom
  d'hôte. Une adresse collée depuis un navigateur
  (`http://192.168.1.20:49090`) est lue comme son hôte et son port.
  `https`, un chemin ou des paramètres sont refusés.
- **Port de l'API locale** : `49090` sauf si vous l'avez changé.
- **Clé d'API de l'API locale** : gardée par Gladys dans sa base, jamais
  réaffichée, envoyée seulement au Fing Agent. L'API locale de Fing est en
  HTTP simple et prend la clé dans l'adresse de la requête
  (`/1/devices?auth=…`) : la clé traverse votre réseau local en clair.
  Gardez l'agent sur un réseau de confiance. L'intégration n'écrit jamais
  cette adresse, la clé ni une adresse MAC dans ses journaux, ni la clé dans
  son volume `/data`.
- **Rafraîchissement** : fréquence de lecture des appareils (toutes les
  minutes par défaut, une requête à chaque fois). Les déclencheurs de scène
  démarrent jusqu'à ce délai après le changement, en plus du temps que Fing
  met lui-même à le voir.

Le bouton **Tester la connexion** relit les appareils et indique combien
sont en ligne.

## Appareils

Fing liste tous les appareils qu'il a vus sur le réseau, en ligne ou non.
L'onglet **Découverte** les montre tous (500 au plus) ; n'ajoutez que ceux à
suivre (téléphones pour la présence, un NAS, une imprimante…).

- L'appareil Gladys d'un appareil Fing a pour clé son **adresse MAC** : un
  renommage dans Fing ou une nouvelle adresse IP garde le même appareil et
  son historique. Son nom dans la Découverte est celui donné dans Fing, sinon
  son fabricant et son modèle, ou son type, avec son adresse IP.
- **Téléphones et adresses Wi-Fi privées** : les téléphones et ordinateurs
  récents utilisent une adresse MAC aléatoire différente par réseau Wi-Fi, et
  certains la changent de temps en temps. Pour une présence stable,
  désactivez l'adresse privée (aléatoire) pour le réseau de la maison sur le
  téléphone ; sinon le téléphone apparaît comme un nouvel appareil après
  chaque changement.
- **En ligne** suit ce que dit Fing. Fing attend quelques minutes avant de
  dire qu'un appareil est parti : un téléphone en veille peut ne plus
  répondre en Wi-Fi pendant un moment.
- **Dernier changement** est publié comme une date en UTC
  (`2026-10-17 08:00 UTC`).
- Un appareil que Fing ne liste plus garde ses dernières valeurs dans Gladys
  et est montré injoignable.

L'appareil **Fing network** compte les appareils que Fing liste (tous, même
au-delà des 500 suivis) et ceux en ligne.

## Déclencheurs de scène

- **Appareil en ligne**, **Appareil hors ligne** : un appareil que Fing
  voyait hors ligne (en ligne) est en ligne (hors ligne) à la lecture
  suivante. Filtrez sur un appareil ou laissez vide pour tous. Variables :
  le nom, l'adresse IP et le fabricant de l'appareil.
- **Nouvel appareil sur le réseau** : Fing liste une adresse MAC qu'il ne
  listait pas à la lecture précédente. Utile pour être prévenu quand un
  appareil inconnu rejoint votre réseau. L'appareil n'est pas encore dans
  Gladys : pas de filtre d'appareil. Les mêmes variables.

Aucun déclencheur ne part à la première lecture, après une panne du Fing
Agent ou après un redémarrage de l'intégration (chaque lecture n'est
comparée qu'à la précédente) : un appareil apparu pendant ce temps n'est pas
annoncé. Trente événements au plus sont envoyés par lecture.

## En cas de problème

Le statut de connexion de l'intégration dit ce qui se passe :

- **Clé d'API refusée** (HTTP 401 ou 403) : Gladys s'arrête et ne réessaie
  pas seul, même après un redémarrage. Vérifiez la clé dans l'application
  Fing, collez-la et enregistrez la configuration.
- **HTTP 429 ou erreur serveur (5xx)** : toutes les requêtes sont suspendues
  (d'une minute à six heures), et la pause survit à un redémarrage.
- **Pas de réponse, mauvaise adresse ou mauvais port** : Gladys réessaie,
  jamais plus vite que le rafraîchissement, en attendant plus longtemps à
  chaque fois (jusqu'à 30 minutes).

## Vie privée

Gladys ne garde que ce qu'il montre : le nom, le fabricant, le modèle, le
type, l'adresse IP, l'état et le dernier changement de chaque appareil. Le
contact auquel Fing a lié un appareil et l'identifiant du réseau ne sont pas
gardés. Les adresses MAC ne servent qu'aux identifiants externes des appareils ;
elles ne sont jamais écrites dans un journal.
