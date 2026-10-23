# Hitachi: Camera CCU

Controls a Hitachi camera through its CCU's TCP control port (default **10001**), the same
connection a Hitachi RCP uses. One connection per camera/CCU.

## Configuration

| Field | Meaning |
| --- | --- |
| CCU IP address | The CCU (not the RCP) |
| CCU control port | 10001 |
| Lens wide-open f-stop / smallest f-stop | Only used by the iris gauge: it shows 100% at the wide-open value and 0% at the smallest, linear in stops (defaults 1.8 and 22; set them to your lens) |
| Poll interval | How often values are read back (default 1000 ms). The CCU also pushes changes by itself. |
| Send "Taken" when connecting | Off by default. Claims control the way the RCP does; it may take control away from a physical RCP. |

## Actions

- **Power ON / OFF / toggle**
- **Taken (claim control)**
- **IRIS set / IRIS step** and **Master black set / Master black step** (signed -128..127)
- **IRIS set to f-stop** (absolute, e.g. 4 or 5.6) and **IRIS step f-stop** (relative, in stops: 0.33 = close
  1/3 stop, -1 = open one stop). These drive the lens to the target by checking the lens-position readback and
  correcting, so they take about 1-3 seconds. They only work in REMOTE iris mode, and log a warning if the lens
  can't reach the target. Lens position resolution is 0.1, so one stop up from f/4 lands on f/5.7 (the marked 5.6).
  Calling them again while one is running queues the next after the first finishes.
- **Power: hold to send (press)**: powers the camera on, off or **toggle** (flips whatever it is at the end of the hold) only if the button is held for the whole hold time (default 3 s, 1-15), with the same progress animation
  (add the *Press-and-hold progress* feedback). Pair it with **Hold: cancel (release)** on button release. Several cameras can share one button: add the action once per camera connection
  (they all count down together; put the progress feedback from one of them on the button) for an **all cameras on / off** button. Presets: *Power toggle (hold 2 s)*, *Power ON (hold 3 s)* and *Power OFF (hold 3 s)*. The *Text while holding* option sets what the button says during the countdown.
- **Auto function: hold to send (press)** / **Hold: cancel (release)**: auto white (`40 10`) and auto
  black (`40 20`). Use both on one button (press and release). It sends only if the button is held for the whole
  hold time (default and minimum 5 s); releasing early cancels. There is deliberately no un-latched auto action,
  because these write their result to camera memory. The Auto functions presets are set up this way.
- **Refresh all values now**

Step actions work from the last value read from the camera and clamp at -128 / 127.
Pressing a step button repeatedly accumulates correctly even before the camera reads back.

IRIS set only has an effect while the camera's IRIS mode is **REMOTE** (see `iris_mode`).

## Variables

Use as `$(<connection label>:<name>)`.

| Variable | Value |
| --- | --- |
| `link_status` | Connected / No reply / Disconnected |
| `power` | ON / OFF / ? |
| `iris` | Commanded IRIS, signed -128..127 |
| `iris_pct` | `iris` as 0-100% (-128 = 0%, 127 = 100%) |
| `iris_mode` | REMOTE / AUTO |
| `iris_follow` | Lens iris position, raw 0 (open) .. 65535 (closed) |
| `iris_follow_pct` | Lens iris position as % open (NO LENS if no lens) |
| `iris_fstop` | Lens aperture as the **f-number only**, e.g. `2.8` (`CLOSED` at the mechanical limit, `NO LENS` if unplugged). Add the `f/` in your button text, e.g. `f/$(label:iris_fstop)` |
| `master_black` | Master black, signed -128..127 |
| `extender` | Lens extender: x1 / x2 / x0.8 (read only) |
| `cam_alarm` | Camera head alarm: OK / HEAD FAN / HEAD TEMP (read only) |
| `fiber_link` | Fiber link to the camera head: OK / PARTIAL / CHANGING / DOWN (read only) |
| `fiber_raw` | The two raw bytes behind `fiber_link` as hex, e.g. `11/00` OK, `10/00` partial, `80/20` down (for diagnosing) |
| `auto_result` | Camera's answer to the last auto white / black: OK, LOW LIGHT, IRIS NOT CLOSED, ... (`-` if none yet) |

`?` means the value has not been read yet.

## Feedbacks

- **Camera power state** (boolean): highlight on ON or OFF
- **CCU connection healthy** (boolean)
- **IRIS mode is** (boolean): e.g. warn when in AUTO, where IRIS set is ignored
- **IRIS value compare** / **Master black value compare** (boolean)
- **Camera head alarm active** (boolean), **Lens extender is** (boolean)
- **Show lens extender on button** / **Show camera head alarm on button** (advanced; the alarm button turns red)
- **Fiber link is** (boolean: OK / PARTIAL / CHANGING / DOWN), **Show fiber link on button** (advanced; red when DOWN, amber when PARTIAL or CHANGING)
- **Press-and-hold progress (auto functions)** (advanced): fill and countdown while held, then SENT and the camera's result
- **Show IRIS value on button** / **Show master black value on button** / **Show lens f-stop on button** (advanced):
  put the live value on a button without typing a variable name

## Presets

Companion 5 layered buttons (they need Companion 5):

- **Status:** connection (green when connected), camera power (green / red), iris mode (amber in AUTO), extender + head alarm (red on alarm), last auto result.
- **Gauges:** one button with **IRIS and BLACK** gauges side by side with their values underneath (iris as `f/5.6`, black as `+3`), or each as its own ring gauge.
  The iris gauge is linear in *stops* between the lens limits in the connection settings, so equal gauge steps are equal exposure steps. Black is centred on 0.
  The raw IRIS value (-128..127) is still available as the `iris` variable but is not shown on any preset.
- **StreamDeck+ knobs:** turn = step, push = reset. Clockwise opens the iris (or raises black). F-stop knobs step by 1/3 stop (also fine 1/6 and coarse 1 stop; push goes to f/4);
  master black knobs step by 1 (or 4; push goes to 0).

The values these buttons show come from *value feedbacks* (`Value: iris gauge`, `Value: iris as text`, ...) that each preset binds to local variables; you can use the same
feedbacks in your own layered buttons.

Classic buttons:

Power, IRIS (including f-stop) and Master black groups (value display, up, down, zero), Lens (extender, alarm), Auto functions (auto white, auto black, 5 s hold), plus Taken and Refresh.

## What has been verified

Verified against a real CCU: connecting, power ON/OFF, power readback.

Verified byte-for-byte against RCP packet captures: the read requests for power, IRIS, Master black,
lens iris position and IRIS mode, and how the CCU's replies decode.

**IRIS and Master black SET verified on hardware** (2026-10-05, non-live camera): `30 2E` / `30 2B` with a
16-bit value (signed upper byte; the RCP also uses `80` in the lower byte for half steps). The CCU only
accepts them after the analog control right is claimed with `08 02 FF 00` (reply `0A 03 FF`), which the
module now sends before each set. Without it the CCU silently ignores the set. Test on a non-live camera first.

**Auto black is capture-verified**: the RCP sends `40 20` with no claim before it, the CCU closes the iris (CAP ON) for
about 19 s and answers `40 00 00` (OK), then revokes the analog control right (`0A 03 00`; the module re-claims it
before each IRIS / Master Black set). The button waits for that answer and then shows the result for 5 s.

**Extender, head alarm and auto white come from the DK-H200 command list only** (mode `12`, status `13`, `40 10`).
The RCP's read requests for the extender and alarm are byte-identical to ours (captured), but the reply meaning on
the Z-HD5500 and the auto white frame have not been checked on hardware.
Ext-chart and the auto-setup command are not in the document and are not implemented.

**Fiber link is decoded from hardware tests, not from the PDF** (2026-10-20, Z-HD5500 / CU-HD1500, duplex fiber pulled and
reinserted with the CCU's own status captured). Both bytes can be read on demand (`23 50` answers `22 50 xx`,
`13 0F` answers `12 0F xx`; the CCU also pushes them on change). Observed pairs (`22 50` / `12 0F`):

| Condition | Bytes |
| --- | --- |
| Both strands, healthy | `11` / `00` |
| One half up | `10` / `00` |
| Link down (either strand alone, or none) | `80` / `20` |
| Losing the link | `40` / `10` on the way down |

Plugging back in goes `10` then `11` within a second, and the CCU revokes and re-grants control about 3 s later
(`0A 01 00`, `0A 01 FF`, `0A 03 FF`). Anything not in the table shows as CHANGING. The front-panel CABLE CONDITION bars
(4 segments each for CCU and Head) were not found in any value the CCU reports, so they are not available.

**`iris_fstop` is hardware-calibrated** (2026-10-05, non-live camera): the lens iris position
(`iris_follow`) is exactly the f-number times 10 (18 -> f/1.8, 220 -> f/22.0) across the lens's full
marked range on the unit tested. `0xFFFF` is the CCU's "fully closed" sentinel, one step beyond the
last marked stop, not a numeric value. This is specific to the lens on that camera; a different lens may
not follow the same scale.

## Troubleshooting

- **Status "Connected, but no reply"**: the TCP port accepted the connection but the CCU is not answering.
  Check that the IP is the CCU and that nothing else is holding the control port.
- **IRIS set does nothing**: check `iris_mode`; try the **Taken** action first (or enable "Send Taken" in the config).
- **IRIS / Master Black set does nothing (readback never changes)**: the CCU ignores analog sets until the
  analog control right is claimed on the connection. The module sends `08 02 FF 00` (answered `0A 03 FF`)
  before every IRIS / Master Black set, exactly as the RCP does when its IRIS/MB enable is pressed. Enable
  debug logging to see the `tx`/`rx` frames if a set still has no effect.
- **Power ON does nothing right after OFF**: the camera ignored an ON sent about 5 s after an OFF in testing. Wait ~8 s.
