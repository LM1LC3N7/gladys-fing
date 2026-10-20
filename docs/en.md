# Fing

The devices of your network seen by [Fing](https://www.fing.com), in Gladys,
through the local API of a **Fing Agent** (the Fing software on an always-on
computer or a Raspberry Pi) or a **Fingbox**:

- each device Fing knows can become a Gladys device (Discovery tab):
  **online** (yes / no), **IP address** and **last change** (when Fing last
  saw it come or go);
- the network becomes a device with its **devices online** and its
  **devices** in total;
- three scene triggers: **Device online** (a phone back home, for instance),
  **Device offline** and **New device on the network**.

Read only: Gladys never changes anything in Fing (no device blocked, nothing
renamed).

> **This integration has never been tested with a real Fing Agent.** This
> first version was ported from fing-agent-pyapi, the library of Fing that
> Home Assistant uses, and tested against a fake Fing Agent only. Please
> report what works and what does not on the Gladys forum.

Unofficial integration, not affiliated with Fing.

## Before you start: turn on the local API

1. Install a Fing Agent on a computer or a Raspberry Pi that stays on, in
   your home network, or use a Fingbox, and let it scan the network.
2. In the Fing app, open the settings of the agent (or Fingbox) and turn on
   its **local API**. The app shows an **API key**: copy it. The names of
   the menus change between versions of the app; the local API may need a
   Fing subscription, check in the app.
3. Give the agent a fixed IP address in your router: Gladys reaches it by
   its address.

## Configuration

- **Address of the Fing Agent**: its IP address (`192.168.1.20`) or host
  name. An address pasted from a browser (`http://192.168.1.20:49090`) is
  read as its host and port. `https`, a path or a query are refused.
- **Port of the local API**: `49090` unless you changed it.
- **API key of the local API**: kept by Gladys in its database, never shown
  again, sent only to the Fing Agent. Fing's local API is plain HTTP and
  takes the key in the address of the request (`/1/devices?auth=…`): the
  key crosses your local network in clear. Keep the agent on a network you
  trust. The integration never writes this address, the key or a MAC
  address in its logs, nor the key in its `/data` volume.
- **Refresh**: how often Gladys reads the devices (every minute by
  default, one request each time). The scene triggers start up to this long
  after the change, on top of the time Fing itself takes to notice it.

The **Test the connection** button reads the devices again and says how
many are online.

## Devices

Fing lists every device it ever saw on the network, online or not. The
**Discovery** tab shows them all (500 at most); add only the ones you want
to follow (phones for presence, a NAS, a printer...).

- The Gladys device of a Fing device is keyed on its **MAC address**: a
  rename in Fing or a new IP address keeps the same device and its history.
  Its name in Discovery is the name given in Fing, or else its vendor and
  model, or its type, with its IP address.
- **Phones and private Wi-Fi addresses**: recent phones and computers use a
  different, random MAC address per Wi-Fi network, and some change it from
  time to time. For a stable presence, turn off the private (random)
  address for your home network on the phone; otherwise the phone shows up
  as a new device after each change.
- **Online** follows what Fing reports. Fing waits a few minutes before it
  says a device left: a phone asleep may stop answering on Wi-Fi for a
  while.
- **Last change** is published as a date in UTC (`2026-10-17 08:00 UTC`).
- A device Fing no longer lists keeps its last values in Gladys and is
  shown as unreachable.

The **Fing network** device counts the devices Fing lists (all of them, even
beyond the 500 followed) and those online.

## Scene triggers

- **Device online**, **Device offline**: a device Fing saw offline (online)
  is online (offline) at the next reading. Filter on one device or leave
  the box empty for any. Variables: the name, the IP address and the vendor
  of the device.
- **New device on the network**: Fing lists a MAC address it did not list
  at the previous reading. Useful to be told when an unknown device joins
  your network. The device is not yet in Gladys: no device filter. The same
  variables.

No trigger fires at the first reading, after an outage of the Fing Agent,
or after a restart of the integration (the readings are compared with the
previous one only): a device that appeared during that time is not
announced. Thirty events at most are sent per reading.

## When something goes wrong

The connection status of the integration says what happens:

- **Refused API key** (HTTP 401 or 403): Gladys stops and does not try again
  by itself, even after a restart. Check the key in the Fing app, paste it
  and save the configuration.
- **HTTP 429 or a server error (5xx)**: every request is paused (one minute
  to six hours), and the pause survives a restart.
- **No answer, wrong address or port**: Gladys tries again, never faster
  than the refresh, waiting longer each time (up to 30 minutes).

## Privacy

Gladys keeps only what it shows: the name, vendor, model, type, IP address,
state and last change of each device. The contact Fing linked a device to,
and the network id, are not kept. MAC addresses only make the external ids
of the devices; they are never written in a log.
