# Third-party notices

Nothing but the Gladys SDK is installed at runtime. One library's logic is
ported to JavaScript; its notice follows.

## fing-agent-pyapi (fing_agent_api)

- Project: <https://github.com/fingltd/fing-agent-pyapi>, published on PyPI
  as `fing_agent_api`.
- Copyright: Fing Ltd and the contributors of fing-agent-pyapi (author
  declared in its `pyproject.toml`: Lorenzo Gasparini).
- Version read: 1.1.0, commit `3e9c0d8` (2026-03-27).
- License: Apache License, Version 2.0. The repository ships the standard
  text of the license and no NOTICE file. The full text of the Apache
  License 2.0 is the `LICENSE` file of this repository (identical text),
  copied into the Docker image next to this file.

What is ported (rewritten in JavaScript, not copied): the request of the
local API of a Fing Agent (`GET http://<host>:<port>/1/devices?auth=<key>`,
port 49090 by default) and the reading of its answer (`devices[]` with
`mac`, `ip` as a list, `state` where `UP` is online, `name`, `type`, `make`,
`model`, `last_changed`), in `src/fing/client.js` and `src/fing/parse.js`.
Changed from the original: a time limit of 20 s instead of 120 s, a size cap
on the answer, no redirect followed, the key URL-encoded and never logged,
MAC addresses normalized to 12 hexadecimal digits, devices without a valid
MAC left out. The contacts (`/1/people`) and the agent description (UPnP on
port 44444) are not used.

Fing is a trademark of Fing Ltd; this integration is unofficial and not
affiliated with Fing.

## LM1LC3N7/gladys-netbird

The structure of the app (start queue, epochs of the loop, refusal kept as
a salted HMAC in `/data`, bounded pauses, state budget, transport badges)
and the test helpers follow this integration of the same author, under the
Apache License 2.0 of this repository.
