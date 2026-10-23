# Driving Bitfocus Companion 5 programmatically (how buttons were built here)

Notes for driving Companion 5 programmatically. Verified against Companion 5.0.2. Evidence labels: **verified** = done and observed in this project.

## Method (verified)

Companion's admin UI talks to the server over a **tRPC websocket at `/trpc`** (plain JSON, no transformer). Driving that
directly is much faster than clicking, and stable.

1. Open the Companion admin UI in a Chrome tab and run JS in the page (DevTools console or any browser automation); the page origin gives same-origin websocket access: `new WebSocket('ws://'+location.host+'/trpc')`.
2. Frame: `{id, method:'query'|'mutation'|'subscription', params:{path, input}}`. Replies: `{id, result:{type:'started'|'data', data}}`
   or `{id, error:{message,...}}`. Stop a subscription with `{id, method:'subscription.stop', params:{id:<subscription id>}}`.
3. Helpers to re-create after **every page navigation / reload** (they are lost; the socket also dies on reload):
   - `call(method,path,input,ms=8000)` -> promise resolved by id, with timeout.
   - `sub(path,input,ms)` -> start a subscription, collect messages for `ms`, stop it, return them. (Subscriptions send an
     `init` data message first; read state from it.)
4. Long scripts: a single console call can time out (~45 s). Run long sequences as a **fire-and-forget async IIFE** that writes progress
   to `window.__done` / `window.__err`, then poll with short calls (wait, then read the variable). Typical cost:
   ~1-3 s per mutation, ~1 s per `sub` read.
5. Keep ids in `window` variables and print only labels or counts.
6. Source of truth for shapes: download the UI bundle (`curl .../assets/index-*.js`) and grep for `W.<router>.<proc>.mutationOptions`
   and the nearby `mutateAsync({...})` call. Keep a local copy of the bundle for reference.
7. Always verify visually: open `/buttons/<page>`, wait ~5-8 s (the grid renders blank briefly), then zoom in on the grid.
   Do not `hotPressControl` with `surfaceId:'edit'` unless you want the editor to jump to that button (it navigates and drops the page JS).

## Procedures and input shapes (verified unless noted)

- Connections: `instances.connections.watch {}` (sub; objects have `id,label,moduleId,moduleVersionId,enabled`),
  `.watchEdit {connectionId}` (config incl. host), `.add {module:{type,product},label,versionId}`,
  `.setConfig {connectionId,label,enabled,updatePolicy,config,secrets}`, `.setEnabled {connectionId,enabled}`,
  `.setModuleAndVersion {connectionId,moduleId,versionId}` (switch module version), `.reorder {connectionId,collectionId,dropIndex}`,
  `.collections.add {collectionName}`. Labels cannot contain spaces.
- Module install: Modules page file input (upload to the file input button, not the label); the `.tgz` must be
  the **built** package from a GitHub Release.
- Pages: `pages.watch {}` -> `{order:[pageId...], pages:{id:{name,controls:{row:{col:controlId}},gridSize}}}`. Page N = `order[N-1]`.
  `controls[row][col]`. Global grid in `userConfig.watchConfig` (here 21 cols x 6 rows). `pages.clearPage`, `pages.recreateNav {pageNumber}`.
  Export: `GET /int/export/page/<n>` (gzip JSON).
- Creating a button: **a blank location cannot be created** (`controls.resetControl` on an empty slot does nothing).
  Use `controls.importPreset {connectionId,presetId,location:{pageNumber,column,row},variableValues:{}}` (variableValues REQUIRED;
  returns the new controlId) with any simple module preset, then rewrite it. Cheap base presets: Hitachi `fstop_4`,
  Panasonic `exposure-iris-up`.
- Reading a button: `controls.watchControl {controlId}` -> `config:{type:'button-layered', style:{layers[]}, feedbacks[],
steps:{'0':{action_sets:{down:[],up:[],<ms>:[]}, options}}, localVariables}`. Option values are `{isExpression,value}`.
- Style (layered buttons): `controls.styles.updateOption {controlId,elementId,key,value:{isExpression:false,value}}`.
  Layers: `canvas` (decoration key: `none` removes the yellow location strip), `box0`, `image0`, `text0`; extra layers via
  `controls.styles.addElement {controlId,type:'text'|'image'|...,index:null}` then read the new layer id from the config.
  Text `fontsize` is % of element height (use ~42 for a half-height header, ~78 for one big line, 80 for arrows); `fontsizeAllowShrink:true`.
- Actions: `controls.entities.add {controlId,entityLocation:{stepId:'0',setId:'down'|'up'|<ms number>},ownerId:null,connectionId,
entityType:'action',entityDefinition:'<actionId>'}` -> returns the entity id (string). `connectionId:'internal'` for Companion
  internal actions (e.g. `custom_variable_set_value`, options `name`,`value`). `.remove {controlId,entityLocation,entityId}`,
  `.setOption {controlId,entityLocation,entityId,key,value:{isExpression,value}}`.
- Timed (long-press) action sets: `controls.actionSets.add {controlId,stepId:'0'}` creates set `1000`;
  `.rename {controlId,stepId,oldSetId:1000,newSetId:2900}` (**numbers, not strings**). Use the **numeric** `setId` in
  `entityLocation` for timed sets (`setId:2900`), but the key in the config is the string `"2900"`. A long-release set runs on
  release after the hold time and the short `up` set does NOT run in that case (verified), so put "cancel" in both.
- Feedbacks: `controls.entities.add` with `entityLocation:'feedbacks'`, `entityType:'feedback'`; style overrides for layered buttons via
  `controls.entities.replaceStyleOverride {controlId,entityLocation:'feedbacks',entityId,override:{overrideId:<random 20 chars>,
elementId:'text0',elementProperty:'text',override:{isExpression:false,value:'text'}}}`. For **advanced** module feedbacks the
  override value is the _name of the returned property_ (`'text'`,`'color'`,`'png64'`,`'bgcolor'`) mapped onto
  `text0.text`, `text0.color`, `<image layer id>.base64Image`, `box0.color`. For **boolean** feedbacks the override is the literal value
  (e.g. `box0.color = 13135360`). Remove: `.removeStyleOverride {..., overrideId}`.
- Custom variables: `customVariables.create {name,defaultVal:''}`, `.setPersistence {name,value:true}` (note: `value`, not `persistent`),
  `.setCurrent {name,value}`, `customVariables.watch {}`. Reference as `$(custom:name)`.
- Expressions (option `isExpression:true`): Companion expressions do NOT support `parseFloat()` or `number()`; use `$(custom:x) * 1`.
- Press simulation: `controls.hotPressControl {location:{pageNumber,column,row},direction:true|false,surfaceId:'edit'}`
  (press then release; hold by waiting between the two calls). Beware this moves real hardware: only on a camera confirmed not live.
- Logs: `logs.watch` (sub; messages have `source`,`message`). The first place to look when an action "does nothing"
  (e.g. `Error executing action ... Unsupported function "parseFloat"`).
- Variables/feedback/action definitions (read only): `variables.definitions.watch {}`, `variables.values.connection` (query, `{label}`),
  `instances.definitions.feedbacks`/`.actions` (subs), `instances.definitions.presets {connectionId}`.
- Scanning all buttons: collect ids from `pages.watch`, then `watchControl` in batches of ~15 concurrently (1467 controls took ~20 s) and
  filter on `steps` / layer text. Used to find a user-made button by text.

## Safety

Companion actions here move real cameras. Only test-press on a camera the user has cleared as non-live, restore values,
and say what was changed. Do not wipe or overwrite user-made buttons; scan for them first. Import modules only as the built `.tgz`.
