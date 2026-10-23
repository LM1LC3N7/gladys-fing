# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-20

### Added

- First version: the devices of a network seen by a Fing Agent or a Fingbox,
  through its local API (address, port 49090 by default, API key), read only.
- One Gladys device per Fing device, keyed on its MAC address: online, IP
  address, last change. One network device: devices online and in total.
- Scene triggers: device online, device offline, new device on the network
  (never at the first reading nor after an outage).
- A refused API key stops the integration until the configuration is saved
  (remembered in `/data` as a salted HMAC); HTTP 429 and 5xx pause every
  request, the pause kept in `/data` and bounded; other failures retried,
  never faster than the refresh.
- Test the connection button. The scan button, the test button and a
  reconnection to Gladys never read the agent faster than the refresh: they
  answer from the last reading while it is recent.
- A name that is a MAC address is replaced by the vendor, model or type; a
  device listed twice by Fing is merged; the devices added to Gladys are
  always among the 500 followed.
- Documentation in English and French. Never tested with a real Fing Agent.

[Unreleased]: https://github.com/LM1LC3N7/gladys-fing/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-fing/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-fing/releases/tag/v0.1.1
