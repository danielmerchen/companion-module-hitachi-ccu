# Hitachi CCU control protocol (TCP 10001)

Reverse-engineered on a Z-HD5500 / CU-HD1500 / CA-HF1300STD from RCP packet captures and the DK-H200 command list
(Nov 30, 2015). Evidence labels: **HW** = verified on hardware, **CAP** = byte-identical to RCP/CCU traffic in a capture,
**DOC** = DK-H200 PDF only, **INF** = inferred.

## Framing

`STX (02)` + ASCII-hex uppercase of `n DT1..DTn SUML SUMH` + `ETX (03)`, where `SUM = ~(n + DT1 + .. + DTn) & 0xFFFF`,
sent low byte first. No ACK/NAK on TCP. One TCP segment can hold several frames; parse the stream.
Example, power on: DT `20 22 01 FE` -> wire `02 "04202201FEBAFE" 03`.

## Command families (DT1 = CTL, DT2 = MODE)

| Kind | Set | Request | Response |
| --- | --- | --- | --- |
| On/off bit fields | `20 MODE DT3 MASK` | `23 MODE` | `22 MODE DT3` |
| Analog bank A (16-bit) | `30 MODE hi lo` | `33 MODE` | `32 MODE hi lo` |
| Status | n/a | `13 MODE` | `12 MODE data` |
| Auto functions | `40 MODE` | n/a | `40 00 RESULT` |
| Control right | `08 MODE FF xx` | `0B 10` | `0A MODE FF/00` |

MASK: a `0` bit means "change this bit". The CCU echoes the resulting byte as a `22` frame after each on/off write.
Analog values: signed 16-bit, upper byte signed, lower byte in quarter steps (`00/40/80/C0`); one knob detent is `0x40`.

## Control right (the important gotcha)

The CCU **silently ignores every analog set (`30 xx`)** unless the connection has claimed the analog group with
`08 02 FF 00` (answered `0A 03 FF`). **HW, CAP.** The general `08 00 FF` Taken (answered `0A 01 FF`) does not unlock it.
The CCU revokes it (`0A 03 00`) after power-on and after auto functions, so the module re-claims before every analog set.
On/off writes and power need no claim (CAP, HW for power).

## Frames

| Meaning | DT | Evidence |
| --- | --- | --- |
| Power on / off | `20 22 01 FE` / `20 22 00 FE` | HW / CAP |
| Read power, IRIS, master black, lens position, IRIS mode | `23 22`, `33 2E`, `33 2B`, `13 22`, `23 04` | CAP |
| Read extender, head alarm | `23 12`, `13 13` | CAP |
| Analog control-right claim | `08 02 FF 00` -> `0A 03 FF` | HW, CAP |
| IRIS / master black set | `30 2E hi lo` / `30 2B hi lo` | HW (after claim) |
| Lens position | status `22`: `0000` open .. `FFFF` closed, `FF00` no lens; **value / 10 = f-number** (f/1.8 .. f/22) | HW |
| IRIS mode | on/off `04` bits 0-1: 0 = REMOTE, 2 = AUTO | CAP |
| Auto black | `40 20` -> `40 00 00` after ~19 s (CAP ON closes iris, then `0A 03 00`) | CAP |
| Auto white | `40 10` | DOC |
| Bars | `20 08 01 EE` / `20 08 00 EE` (echo `22 08 01/00`) | CAP |
| Test pattern | `20 09 08 F7` / `20 09 00 F7` | CAP |
| Masking | `20 02 80 3F` / `20 02 00 3F` | CAP |
| Skin detail | `20 06 01 FE` / `20 06 00 FE` | CAP |
| Camera call | `20 03 04 FB` / `20 03 00 FB` | CAP |
| Ext chart (detect gate) | `20 19 V FC`; cycled `02` gray, `01` skin, `03` white shading, `00` off | CAP |
| Master gain | `20 01 V 00`: `40` = -3 dB, `00` = 0, `01` = +3, `02` = +6 | CAP |
| Shutter on/off | `20 05 01 FE` / `20 05 00 FE` | CAP |
| Shutter preset (1/125 step) | `20 05 30 C7` (PDF preset table does not match this camera) | CAP |
| Gain R/G/B | analog `00` / `01` / `02` | CAP |
| Gamma R/G/B | analog `03` / `04` / `05` | CAP |
| Flare R/G/B | analog `06` / `07` / `08` | CAP |
| Detail | analog `2C` | CAP |
| V. color temp | analog `D4`, relative steps `0100` / `FF00` (reads back `0000`) | CAP |
| Extender | `22 12`: bit 0 = x2, bit 1 = x0.8 | DOC |
| Head alarm | `12 13`: `01` fan, `02` temperature | DOC |

## Never sent

Memory backup and scene control (`60`-`67`; EEPROM rated ~100,000 writes), character display (`48`), and any write to a mode
not documented or captured. Auto functions only behind the 5 s hold latch.

## Behaviour notes

- Power off is immediate; power on appears in the readback after ~1.3 s; an on sent ~5 s after an off was ignored (wait ~8 s).
- The CCU accepts one TCP client at a time; a second connection is refused.
- The RCP re-reads IRIS and master black only at resync events; it never polls them.
