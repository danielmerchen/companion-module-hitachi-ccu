# Hitachi: Camera CCU (Bitfocus Companion module)

Controls Hitachi broadcast cameras through their CCU's TCP control port (default `10001`), the same connection a
Hitachi RCP uses. One connection per CCU. Developed against a **Z-HD5500 head / CU-HD1500 CCU / CA-HF1300STD adapter**,
using packet captures of a real RCP plus the DK-H200 command list (a sibling model).

> The CCU control port has **no authentication** and accepts **one client at a time**. Keep it on a trusted lab network
> and do not point two controllers (e.g. Companion and a script) at the same CCU.

## Features

| Area | What it does | Evidence |
| --- | --- | --- |
| Power | on / off / toggle, readback | hardware-verified |
| IRIS | set, step, **set to f-stop**, **step in stops**, `iris_fstop` variable | hardware-verified (f-stop = lens position / 10) |
| Master black | set, step, readback | hardware-verified |
| Lens extender, head alarm | read-only variables / feedbacks | request frames captured; reply meaning from the PDF |
| Auto black | press-and-hold (5 s) latch with progress animation, result variable | capture-verified |
| Auto white | same latch | **PDF only, not yet captured** |

Presets (Companion 5 layered buttons): status buttons, IRIS + BLACK gauges, and StreamDeck+ knob presets (see [companion/HELP.md](companion/HELP.md)).

Planned: gain, gamma, flare, detail, V. color temp, master gain, bars, test pattern, masking, skin detail, call,
ext chart, shutter. See [TODO.md](TODO.md). All wire frames and their evidence level: [docs/PROTOCOL.md](docs/PROTOCOL.md).
Usage and variables: [companion/HELP.md](companion/HELP.md).

## Which branch / version

| Companion | Use | Module API |
| --- | --- | --- |
| 5.x | `main` (v0.7.x and later) | v2 (`@companion-module/base` ~2.1, ESM, default export) |
| 3.x / 4.x | branch `v1`, tag `v0.5.1` | v1 (`@companion-module/base` ~1.14). **No longer maintained**: it will not get fixes or new features. |

`main` is the only maintained build. The `v1` branch is kept for reference and for Companion 3.x / 4.x installs that already use it.
Differences worth knowing: the CCU IP default is blank on `main` (it was a lab address on `v1`), and `main` is tested with a fake v2 host
(the real `InstanceBase` driven through a simulated instance context) rather than the v1 IPC host.

## Install

**Download the `.tgz` from the [Releases](https://github.com/danielmerchen/companion-module-hitachi-ccu/releases) page** (the asset named `hitachi-ccu-<version>.tgz`),
not GitHub's "Source code" archives: Companion only loads a *built* package, and a source archive is rejected with
`Module Api version is too new/old ... 0.0.0` because the source manifest keeps a placeholder API version that the build stamps.

Download a packaged `hitachi-ccu-<version>.tgz` (or build one, below) and import it in Companion under
**Modules -> Import module package**, then set the connection's module version.

Or point Companion's **Developer modules path** at the parent folder of a checkout (the folder must be named
`companion-module-hitachi-ccu`).

## Develop

    npm install
    npm test            # protocol, client vs simulated CCU, module vs simulated Companion host, latch
    npm run package     # builds hitachi-ccu-<version>.tgz

Branches: `main` is the Companion **v2 module API** build and the only maintained one; `v1` is the old Companion v1 API build (unmaintained).
Tests run the real `@companion-module/base` against a simulated CCU; set `MODULE_ENTRY=/path/to/unpacked/main.js` to run the module-level tests against a packaged build.

## Safety

Auto functions (`40 xx`) write their result to camera memory, so the module only sends them behind a 5 s press-and-hold
(minimum, not configurable lower). Memory backup / scene commands (`60`-`67`) and character display (`48`) are never sent.
Test writes on a non-live camera first.

## License

MIT, see [LICENSE](LICENSE).
