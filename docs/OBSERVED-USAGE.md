# Observed use of the CCU protocol

How the CCU control port actually behaved in our tests, as opposed to what the command list says. Companion to
[PROTOCOL.md](PROTOCOL.md) (frame reference). Evidence labels: **HW** = seen on hardware, **CAP** = seen in an RCP/CCU
packet capture, **USER** = reported by the person running the equipment and not independently tested, **INF** = inferred.

Equipment: four Hitachi systems (Z-HD5500 head, CU-HD1500 CCU, CA-HF1300STD adapter) with an RU-1500JY RCP on the
first. All tests were on cameras cleared as not live. The only Hitachi document available was the DK-H200 command list,
a sibling model, so every mode map in it is a guide, not an authority.

## How it was observed

- **Capture:** a Mac on a managed switch with the CCU's port mirrored, `tcpdump -i <iface> -w x.pcap 'host <ccu> and tcp port 10001'`
  (no root needed when the user is in the `access_bpf` group), decoded with the module's own frame parser. CAP.
- **Direct tests:** short scripts using the same framing code as the module, connecting straight to the CCU, reading first,
  writing only the documented/captured frame under test, then reading back and restoring the original value. HW.
- **Method that worked best:** have the operator do one thing on the RCP (or pull one fiber) while calling each step out, and
  line the calls up with frame timestamps.
- **Never sent while testing:** auto functions (`40`), character display (`48`), scene/backup (`60`-`67`), writes to
  undocumented modes. Read requests of undocumented modes are safe and were used freely (about 20 frames per second at most,
  well under the RCP's own 30-50 during a sync).

## Connection model

- The CCU accepts the **RCP plus one remote client**. A second remote client gets `ECONNREFUSED` immediately. Stop other
  controllers (for example a Companion connection) before running scripts against the same CCU. HW.
- The CCU does not filter by source port or address: a write from local port 1024 behaved the same as any other port, and
  a different controller product working against it was reported. HW, USER.
- No physical LOCAL/REMOTE switch exists on the CCU, and the RCP being switched off changed nothing about our writes. HW, USER.
- On connect the CCU sends `0A 01 FF` by itself. It also pushes status frames unprompted (see below), so apply every frame
  you receive, not only replies to your own requests. HW.
- The RCP's own session never dropped or reconnected during any of the fiber tests (no SYN, FIN or RST in the capture). CAP.

### What the RCP does at connect (earlier captures)

`08 00 FF FF` (the general "taken"), then a read sweep of about 200 distinct requests, then only a `23 22` heartbeat every
1.5-3 s and `0B 10` (answered `0A 10 FF`) every 7-15 s. IRIS and master black are re-read only at resync events, never polled.
CAP.

## Control rights: why analog sets seemed to "do nothing"

The CCU **never acknowledges a `30 xx` analog set and silently ignores it** unless that connection first sent
`08 02 FF 00` (reply `0A 03 FF`). Symptoms we saw before finding this: the CCU's own read-back stayed at the old value
while a well-formed frame had been sent. HW.

Things that did **not** unlock it (all tried while the set was being ignored): the general `08 00 FF` and `08 00 FF FF`
(both answered `0A 01 FF`), a tiny RCP-sized step, binding source port 1024, and switching the RCP off. HW.

Found by capturing the RCP while the operator pressed its IRIS/MB enable key: the RCP sent `08 02 FF 00`, the CCU answered
`0A 03 FF`, and the first `30 2E` write followed 5 ms later. CAP. Sending only `08 02 FF 00` before a set was then enough. HW.

The CCU revokes control around power-on, auto functions and a fiber relink (`0A 01 00`, `0A 03 00`), so the module re-claims
before every analog set. On/off writes (power, bars) needed no claim. HW.

## Analog values

- 16 bit, `hi lo`, signed upper byte, same layout for set and reply (`30 2B hi lo` / `32 2B hi lo`). The RCP's captured
  master black frames step by `0x0080` per update when turned slowly (more when turned faster); the module sends quarter steps (`0x40`). CAP, HW.
- A set is silent: always verify with a read request at least 200 ms later. Optimistic UI values can look right while the CCU
  disagreed. HW.
- Master black at baseline read `32 2B 01 00` (value 1); a `+0x80` step was accepted and restored exactly. HW.

## IRIS and the f-stop

- Status `22` (`13 22` -> `12 22 hi lo`) is the lens iris position and equals **f-number x 10** exactly across the lens's marked
  range, measured by sweeping the RCP and reading the position at each marked stop. HW.

| f-number | 1.8 | 2.0 | 2.8 | 4.0 | 5.0 | 7.0 | 9.0 | 10.0 | 16.0 | 22.0 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| position | 18 | 20 | 28 | 40 | 50 | 70 | 90 | 100 | 160 | 220 |

- `FFFF` is the fully-closed limit (one step past the last marked stop) and `FF00` means no lens. `FFFF` also appeared
  momentarily at the closed end of fast sweeps before the position read back a real value, so only trust it once it persists. HW.
- The lens **lags a moving IRIS command**. Moving to a target f-stop works as a closed loop: set a command, poll the lens
  position until two reads agree (about 120 ms apart, after a 250 ms minimum), then correct. A command-to-settled-position
  table measured with each command held until the lens stopped is a good first guess, and a learned curve converges on a
  different lens within a move or two. A table taken during a fast sweep was off by several command units. HW.
- IRIS sets only take effect while the IRIS mode (on/off `04`, bits 0-1) reads REMOTE (0); AUTO (2) ignores them. CAP, HW.

## Bars

`20 08 00 EE` switches the color bars off and `20 08 01 EE` on; `23 08` reads the state back (`22 08 xx`, bit 0 = bars). The
mask `EE` changes bits 0 and 4, and bit 4 was already 0. Bars were on, sent off, and read back off on four cameras, with no
control claim needed. CAP, HW.

## Fiber link to the camera head

The CCU reports the link two ways: **on/off mode `50`** (`23 50` -> `22 50 xx`) and **status `0F`** (`13 0F` -> `12 0F xx`).
Both can be read on demand and are also pushed on change (`12 0F` also arrives about every 2.7 s). Neither is in the DK-H200
list. HW.

| Condition | `22 50` | `12 0F` |
| --- | --- | --- |
| Both strands, healthy | `11` | `00` |
| One half up | `10` | `00` |
| Link down (one strand alone in some tests, or none) | `80` | `20` |
| Losing the link | `40` (and `81`/`41`) | `10` |

Timelines (relative, from the captures):

- **Pull one connector or both:** `12 0F` 00 -> 10 -> 20 and `22 50` -> 40/81 -> 80 within about a quarter of a second, with no
  control reset and no resync. The CCU's front-panel cable-condition meter drops to one red segment (CCU side).
- **Insert:** `22 50` -> 10 and `12 0F` -> 00 immediately, then `22 50` -> 11 within about 1-3 s. About 3-4 s later the
  CCU revokes and re-grants control (`0A 01 00`, `0A 01 FF`, `1A 10 36`, `0A 03 FF`, `0A 10 00`, `0A 10 FF`) and the RCP re-reads
  about 200 values in a burst (roughly 250 packets per 2 s). During this `12 23` dipped to `FB` or `0F` for about a second and
  `12 13` showed `08` once; the meaning of both is unknown.
- **One strand alone** (duplex fiber, so the two strands go in together; "alone" means one of the pair seated): one position
  brought the link up as `10`/`00` and the other did not change `80`/`20`. Which physical strand is which was not established.
  INF.
- A `22 50 00 F0` (four-byte) frame was seen once during a fast pull; unexplained.

**Not exposed:** the front-panel CABLE CONDITION bars (four segments each for HEAD and CCU) were not found in any value the
CCU reports. We replayed the RCP's whole read sweep healthy and with the link down: the only differing replies were `12 0F`
and a length difference in `22 08`. `12 23` and `12 13` did not track the bars. HW.

**While the link is down, head-dependent reads get no reply at all** (type and version strings, unit names, the `1A xx` and
`46 xx` groups): 35 of the 197 replayed requests went unanswered, 162 were answered. That silence is itself a usable
"head offline" signal. HW.

## Other observations

- Power: off is immediate, on appears in the readback after about 1.3 s, and an on sent about 5 s after an off was ignored.
  Wait about 8 s. HW.
- On a healthy camera, mode `02` read `05` and mode `0B` read `03`; their meanings are unknown. HW.
- The RCP also polls undocumented groups (`1B xx` -> `1A`, `47 xx` -> `46`, analog banks `53` and `57`); the replies are `00`/small
  values and their meanings are unknown. CAP.
- Status mode `00` (camera type) read `CD` on the Z-HD5500, which is not one of the types in the DK-H200 list. CAP.
