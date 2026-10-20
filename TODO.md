# TODO — Fing v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own: the claim is in /t/10385 (lot 10).

## Status

- [x] **Milestone 1 — core** (2026-10-20): local API of a Fing Agent / Fingbox
      ported from fing-agent-pyapi 1.1.0 (`GET /1/devices?auth=<key>`, port
      49090 by default); one device per Fing device keyed by its MAC address
      (online, IP address, last change), one network device (online / total);
      triggers `device_online`, `device_offline`, `new_device` (none at the
      first reading, after a failure, after a restart); poll 60 s by default;
      key refusal final and remembered (salted HMAC in `/data`), lifted only by
      saving the configuration; 429 / 5xx pause bounded and persisted; status
      and Discovery sent again at every `connected`; a published device never
      loses a feature of the created one; read only; docs en/fr. Tested with
      unit tests against the SDK's fake Gladys, a fake Fing Agent (in memory
      and on loopback http) and loopback servers. **Never tested with a real
      Fing Agent.** No Docker on this PC: no e2e test in a container. The
      store validator was not run by the development agent (it runs in the
      real terminal only).
- [x] **Review corrections 1** (2026-10-20): a date out of the range of
      `Date` (1e300, nanoseconds) is unknown and one device that cannot be
      published never stops the others (I1); a reading that ends after a
      restart publishes, fires and sets nothing (I2); Discovery, the test
      button and every `connected` answer from the last reading while it is
      younger than the poll interval, the comparison going on (I3); a Fing
      label holding a MAC address is replaced (M1); a MAC listed twice is
      merged the same way in any order (M2); devices created in Gladys are
      followed first and `new_device` compares with every MAC of the
      previous reading (M3); a pause with nothing read yet still publishes
      the network device (M4). Each with a test.

## Decisions

- **Version 0.1.0** set by hand in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-fing:0.1.0`);
  the first release (patch) gives 0.1.1.
- **Reference**: fing-agent-pyapi (Apache-2.0, Fing Ltd, used by Home
  Assistant), commit `3e9c0d8`; logic ported, nothing copied; notice in
  `THIRD_PARTY_NOTICES.md`, copied into the image.
- **External id = MAC address** normalized to 12 lowercase hex digits
  (`ext:<selector>:device:aabbccddeeff`): stable across a rename or a new IP,
  whatever spelling Fing uses (`AA:BB:…`, `aa-bb-…`). Null and broadcast
  addresses refused. MAC addresses are never logged, never in `/data`, never
  in a scene variable; they only make the external ids. Random (private)
  Wi-Fi addresses of phones are documented (a new device per change).
- **Online** is `unknown`/`binary` read only, never a switch nor a
  `presence-sensor` (that category drives the user presence logic of the
  core, a decision for later: see Next). IP and last change are texts; the
  counts are `counter-sensor`/`integer`. No unit.
- **Plain HTTP**: Fing's local API has no https and takes the key in the
  query string. Said in the manifest and the docs (crosses the local network
  in clear); the transport follows no redirect (the key would leave), errors
  carry a code only (Node's messages hold the address), the key is
  URL-encoded.
- **Refusal**: HTTP 401 or 403 on `/1/devices` (the only request) is a
  refused key. Not checked against a real agent: what Fing answers to a bad
  key is unknown (TODO below).
- **Timeout 20 s** (the Python library waits 120 s): the test button must
  answer within its 30 s.
- **New device** = a MAC address absent from the whole previous reading of
  this run (all MACs, not only the 500 followed; in memory; nothing
  persisted, no MAC in `/data`): not announced after a restart or an outage.
  A device leaving the list and coming back is announced again.
- **Never read faster than the interval**: the scan button, the test button
  and a reconnection to Gladys reuse the last reading while it is younger
  than the poll interval (status, Discovery, states, badges sent again from
  it; the loop keeps its rhythm; the comparison goes on). A configuration
  saved with another agent or key reads at once; a refused key forgets the
  last reading.
- **Followed devices**: those created in Gladys first, then MAC order, 500
  at most.
- **Duplicates**: a MAC listed twice is merged (online if one entry is, the
  latest last change, the other fields of the entry changed last).
- **Labels**: a name, vendor, model or type holding a MAC address is
  dropped (the fallback name is used).
- **Dates**: within 2000-2200 only (numbers: seconds or milliseconds),
  else unknown.
- **Scene variables** `device_name`, `ip`, `vendor`: a string or null, never
  undefined nor NaN. No MAC address.
- **Caps**: 5000 devices read, 500 followed, 30 events per reading, 250
  states per minute (counts, then online, then the texts in turn), answer
  8 MiB at most.
- **Not used in v1**: contacts (`/1/people`, Fing desktop only), the agent
  description (UPnP XML on port 44444: an XML parser for little gain), no
  dashboard widget.

## Next

- Check against a real Fing Agent: the status code of a wrong key, the date
  format of `last_changed`, the MAC spelling, the time Fing takes to mark a
  device down.
- Link a device to a Gladys user for presence (`presence-sensor`), if the
  SDK allows it.
- A dashboard widget (devices online, new devices).
- Optional: the agent description (port 44444) for the test button.
