# To do

## Build (frames captured from a real RCP, 2026-10-05)
- [ ] Gain R/G/B (analog `00`-`02`), gamma R/G/B (`03`-`05`), flare R/G/B (`06`-`08`), detail (`2C`); detent = `0x40`, 16-bit values
- [ ] V. color temp (`D4`, relative step: `30 D4 01 00` / `30 D4 FF 00`, knob on the RCP)
- [ ] Master gain (`20 01 V 00`), bars, test pattern, masking, skin detail, camera call, ext chart (detect gate `20 19`)
- [ ] Shutter on/off (`20 05`), shutter presets (needs full preset capture), variable / angle (analog `38`)
- [x] F-stop values as the bare number (`iris_fstop` is `6.0`; `f/` is added in preset text) (v0.7.0, main)
- [ ] Gain/IRIS/MB at full 16-bit (quarter-step) resolution

## Capture first
- [ ] Auto white (`40 10`) and auto setup on the RCP (white card needed)
- [ ] Shutter: every preset step, variable and angle
- [ ] Ext chart: confirm gray / skin / white-shading states vs RCP buttons
- [x] Fiber alarm (not in the PDF): decoded from fiber-pull tests as `fiber_link` (v0.10.0); the front-panel cable-condition bars are not exposed
- [ ] Verify on hardware: extender and alarm replies with the condition active

## Platforms
- [x] Companion v2 module API port (`main`, v0.6.0); `v1` branch kept for reference only
- [x] `v1` is no longer maintained (decision 2026-10-06); `main` only
- [ ] **Q-SYS control plugin** (Lua) exposing the same controls for Q-SYS Designer

## Presets (v0.7.0)
- [ ] Tune the layered preset styling (gauge colours, font sizes, bounds) in a real Companion 5; they could not be previewed outside Companion
- [ ] StreamDeck+ push-to-change-sensitivity (needs local-variable toggling) if wanted
