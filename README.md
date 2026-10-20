# gladys-fing

A [Gladys Assistant](https://gladysassistant.com) external integration for
[Fing](https://www.fing.com): the devices of your network seen by a Fing
Agent or a Fingbox, through its local API. Read only.

- One Gladys device per device Fing knows (picked in the Discovery tab),
  keyed on its MAC address: **online**, **IP address**, **last change**.
- One network device: devices **online** and in **total**.
- Scene triggers: **Device online**, **Device offline**, **New device on the
  network**.

**Never tested with a real Fing Agent**: ported from
[fing-agent-pyapi](https://github.com/fingltd/fing-agent-pyapi) (Apache-2.0,
Fing Ltd) and tested against a fake agent only.

Unofficial integration, not affiliated with Fing.

## Documentation

- English: [docs/en.md](docs/en.md)
- Français : [docs/fr.md](docs/fr.md)

## Security

- The API key is kept by Gladys in its database, never shown again, and sent
  only to the Fing Agent. Fing's local API is plain HTTP with the key in the
  query string: it crosses the local network in clear.
- The URL, the key and the MAC addresses are never logged; `/data` holds only
  a salted HMAC of a refused key and the end of a pause.
- See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Development

```bash
npm install
npm run format:check
npm run lint
npm test
npm run cover   # regenerate cover.png
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the rules, and
[TODO.md](TODO.md) for the status and decisions.

## License

Apache License 2.0, see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
