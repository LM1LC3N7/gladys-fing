// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, button, errors). Errors
// thrown to Gladys are English (one language per message, like the core's);
// the statuses and button answers are { en, fr }. No text ever holds the API
// key or a MAC address.
// -----------------------------------------------------------------------------

import { CODES } from './fing/errors.js';

const plural = (n, one, many) => (n === 1 ? one : many);
/** French: 0 and 1 take the singular ("0 appareil en ligne"). */
const pluralFr = (n, one, many) => (n <= 1 ? one : many);
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

/** Why the Fing Agent failed, in a few words. */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.TIMEOUT:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.HTTP:
      return { en: `HTTP error ${err.status}`, fr: `erreur HTTP ${err.status}` };
    case CODES.BAD_ANSWER:
      return { en: 'unexpected answer', fr: 'réponse inattendue' };
    case CODES.TOO_LARGE:
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case CODES.CLOSED:
      return { en: 'configuration changed', fr: 'configuration changée' };
    default:
      return { en: 'error', fr: 'erreur' };
  }
}

const RETRY = (delay) => ({
  en: `Retried in ${minutes(delay)} min.`,
  fr: `Nouvel essai dans ${minutes(delay)} min.`,
});

const join = (...parts) => ({
  en: parts
    .map((p) => p.en)
    .filter(Boolean)
    .join(' '),
  fr: parts
    .map((p) => p.fr)
    .filter(Boolean)
    .join(' '),
});

export const T = {
  status: {
    ok: ({ total, online, capped }) =>
      join(
        {
          en: `Fing answers: ${online} of ${total} ${plural(total, 'device', 'devices')} online.`,
          fr: `Fing répond : ${online} ${pluralFr(online, 'appareil en ligne', 'appareils en ligne')} sur ${total}.`,
        },
        capped > 0
          ? {
              en: `${capped} more ${plural(capped, 'device is', 'devices are')} left out (500 at most).`,
              fr: `${capped} ${pluralFr(capped, 'autre appareil est ignoré', 'autres appareils sont ignorés')} (500 au plus).`,
            }
          : {},
      ),
    noDevice: {
      en: 'Fing answers, but lists no device yet: let the Fing Agent scan the network for a few minutes.',
      fr: 'Fing répond, mais ne liste encore aucun appareil : laissez le Fing Agent analyser le réseau quelques minutes.',
    },
    hostMissing: {
      en: 'Type the address of the Fing Agent (the computer, Raspberry Pi or Fingbox that runs it), e.g. 192.168.1.20.',
      fr: 'Saisissez l’adresse du Fing Agent (l’ordinateur, le Raspberry Pi ou la Fingbox qui le fait tourner), ex. 192.168.1.20.',
    },
    hostInvalid: {
      en: 'The address of the Fing Agent is not valid: type an IP address or a host name only (e.g. 192.168.1.20), without https, path or query.',
      fr: 'L’adresse du Fing Agent n’est pas valide : saisissez seulement une adresse IP ou un nom d’hôte (ex. 192.168.1.20), sans https, chemin ni paramètres.',
    },
    portInvalid: {
      en: 'The port must be a number between 1 and 65535 (49090 by default).',
      fr: 'Le port doit être un nombre entre 1 et 65535 (49090 par défaut).',
    },
    missingKey: {
      en: 'Type the API key of the local API (Fing app, the Fing Agent, Local API).',
      fr: 'Saisissez la clé d’API de l’API locale (application Fing, le Fing Agent, API locale).',
    },
    keyInvalid: {
      en: 'The API key holds a space or an invisible character (copied with it?): paste it again, only the key.',
      fr: 'La clé d’API contient une espace ou un caractère invisible (copié avec ?) : collez-la de nouveau, la clé seule.',
    },
    keyRefused: {
      en: 'The Fing Agent refused the API key (HTTP 401 or 403: wrong key, or the local API turned off). Gladys does not try again by itself: check the key in the Fing app (Local API), paste it and save the configuration.',
      fr: 'Le Fing Agent a refusé la clé d’API (HTTP 401 ou 403 : clé fausse, ou API locale désactivée). Gladys ne réessaie pas seul : vérifiez la clé dans l’application Fing (API locale), collez-la et enregistrez la configuration.',
    },
    notFing: (delay) =>
      join(
        {
          en: 'This address does not answer like the local API of a Fing Agent: check the address, the port (49090 by default) and that the local API is turned on in the Fing app.',
          fr: 'Cette adresse ne répond pas comme l’API locale d’un Fing Agent : vérifiez l’adresse, le port (49090 par défaut) et que l’API locale est activée dans l’application Fing.',
        },
        RETRY(delay),
      ),
    busy: (delay) =>
      join(
        {
          en: 'The Fing Agent asks Gladys to slow down (HTTP 429): every request is paused.',
          fr: 'Le Fing Agent demande à Gladys de ralentir (HTTP 429) : toutes les requêtes sont suspendues.',
        },
        RETRY(delay),
      ),
    serverError: (status, delay) =>
      join(
        {
          en: `The Fing Agent answers with a server error (HTTP ${status}): every request is paused.`,
          fr: `Le Fing Agent répond par une erreur serveur (HTTP ${status}) : toutes les requêtes sont suspendues.`,
        },
        RETRY(delay),
      ),
    paused: (delay) =>
      join(
        {
          en: 'The Fing Agent asked Gladys to wait (HTTP 429 or a server error): the pause goes on.',
          fr: 'Le Fing Agent a demandé à Gladys d’attendre (HTTP 429 ou erreur serveur) : la pause continue.',
        },
        RETRY(delay),
      ),
    unreachable: (err, delay) =>
      join(
        { en: 'The Fing Agent does not answer:', fr: 'Le Fing Agent ne répond pas :' },
        reasonOf(err),
        { en: '—', fr: '—' },
        RETRY(delay),
      ),
  },
  test: {
    ok: ({ total, online }) => ({
      en: `Connected: ${online} of ${total} ${plural(total, 'device', 'devices')} online. Add the ones to follow from the Discovery tab.`,
      fr: `Connecté : ${online} ${pluralFr(online, 'appareil en ligne', 'appareils en ligne')} sur ${total}. Ajoutez ceux à suivre depuis l’onglet Découverte.`,
    }),
  },
  errors: {
    readOnly: 'This integration only reads Fing: nothing can be changed from Gladys',
    notConnected: 'The Fing Agent is not connected: see the configuration of the integration',
    testTooLong:
      'The Fing Agent has not answered yet: see the connection status in a moment (nothing else to do)',
  },
};
