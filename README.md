[README.md](https://github.com/user-attachments/files/33598442/README.en.md)
# dsh-confetti

English | [中文](README.zh.md)

**Every time a conversation finishes a turn, a party popper fires from each bottom corner of the window — and a button in the composer fires one on demand.**

A DeepSeek Harness (DSH) client plugin:

- **Automatic** — when a conversation's last step lands (`running` flips `true → false`), both bottom corners fire: the confetti arcs toward the center, tumbles, falls, fades, and the canvas recycles itself.
- **Manual** — a 🎉 button in the composer's tool row, immediately left of Send. One press, one burst; press it as often as you like, it is not subject to the automatic celebration's cooldown.
- Client-only effect: the Host half is an empty shell (no services, routes or tools).
- No build step: `lib/client.js` is exactly what the Client module loader executes. React is loaded lazily, only when the composer button is registered; without it everything still works (that is how the preview page runs).
- `requestAnimationFrame` only runs while confetti is in the air — otherwise the plugin is completely still.
- Honors `prefers-reduced-motion`: with the OS setting on it fires one small puff and skips the second wave.

## Status: installed in this machine's `desktop` profile

It is mounted as a **link** (`link:D:/interesting things/dsh-confetti`), which means:

- this directory *is* the plugin — edits to `lib/client.js` cannot be lost;
- the Host re-snapshots a new revision (the `rev` on `/plugins/events` changes), so a page reload picks it up;
- don't delete or move the directory, that unmounts the plugin (run `dsh plugin --profile desktop remove dsh-confetti` first if you mean it).

After installing, **reload the page once** (restarting the desktop app works too) so the browser fetches the new client bundle.

The console prints one line once it is armed:

```
[dsh-confetti] armed — every completed turn gets a popper in each bottom corner; press the confetti button in the composer to fire one now
```

## Where the button lives

The `🎉` sits in the **composer's right-hand tool row**, directly left of Send (slot `conversation.input.right`, `order: 10`). It carries a hover tooltip, is keyboard reachable (`Tab`, then `Enter`/`Space`), and both the tooltip and the accessible name come from the UI locale dictionary (中文「撒彩带」/ English "Confetti").

The button only means "one more burst": it never touches conversation state, and it works whether or not a turn is running.

## See it right now

Three ways, none of which need a full turn to finish:

1. Press the 🎉 beside the composer.
2. Run `__dshConfetti.fire()` in the console (`fire({ density: 2 })` for a denser burst, `__dshConfetti.clear()` to drop the canvas).
3. Open `preview/confetti.html` directly — it loads `../lib/client.js` (the plugin itself) behind a minimal module-loader stand-in. It has no React, so it gets the confetti but not the button.

## Installing from scratch (on another machine)

```powershell
dsh plugin --profile desktop add "D:\interesting things\dsh-confetti"
```

Package layout:

```
package.json        dsh.bundle.patch → cordis.patch.yml
                    dsh.client = { platform: 'web', inject: [ui-slots, locale] }
cordis.patch.yml    - insert: [{ id: dsh-confetti, name: dsh-confetti }]
lib/index.js        Host half: name / inject / empty apply — it exists only so the
                    package joins the loader tree
lib/client.js       Client half: __ModuleLoader__ factory = confetti engine +
                    completion detection + button
icon.svg            Icon shown on the Plugins page
preview/…           Standalone preview page (dev only, not shipped)
verify/…            Headless simulation and frame renderer (dev only, not shipped)
```

Manual mount (no CLI): copy the directory to `%USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-confetti`, add `"dsh-confetti"` to the profile's `package.json` (under `dependencies`, as `link:<dir>`) and to `dsh.profile.bundles`, then restart.

## When it fires (the automatic rules)

It subscribes to the client Session list snapshot, `ctx.get('sessions').list`, and compares `byId[id].running` per session:

- Only an **observed** `true → false` counts. Sessions that are already `running: false` when the page loads stay quiet, so opening an old conversation never fires.
- Delegated children (`origin === 'subagent'` or a `parentId`) are skipped, so a workflow or a subagent batch finishing does not machine-gun the screen.
- 900 ms cooldown: several sessions settling at the same instant produce a single celebration.
- Backgrounded pages (`document.visibilityState === 'hidden'`) are skipped, and returning does not replay them.
- The button goes through the same `fire()` but never queues and never takes the cooldown.

## Configuration (optional)

It works with zero configuration. To tune it, add `config` to the entry in the profile patch:

```yaml
- id: dsh-confetti
  name: 'dsh-confetti'
  config:
    enabled: true     # false = mount nothing; the plugin is fully silent (no button either)
    button: true      # false = keep the automatic effect, drop the composer button
    density: 1        # confetti count multiplier, 0.25 – 3
```

## Self-check (after changing the code)

`verify/` is browser-free: DOM stubs, a fake React, fake slot/locale services and a fake clock run the real `lib/client.js` and record every canvas draw call.

```powershell
node verify/simulate.mjs verify/frames.json 1280 800   # physics + trigger + button assertions
powershell -File verify/render-frame.ps1                # replay the captured frames as PNGs
```

What `simulate.mjs` asserts: idle history silent, turn start silent, one celebration for a top-level finish, subagent finishes silent, cooldown suppresses and later releases, disposal unsubscribes, disposal leaves no canvas behind; for the button it checks the slot and id, that `label` resolves through the dictionary, that `<button class="dsh-confetti-button">` renders, that `aria-label`/`title` are translated, that a click really fires, and that `button: false` registers nothing.

## Uninstall

```powershell
dsh plugin --profile desktop remove dsh-confetti
```

## Implementation notes

- **Why `conversation.input.right` for the button?** That slot is defined as "compact controls before the composer submit action" — the shell owns both placement and lifetime. The plugin positions nothing itself, and when a shell does not declare the slot the registration callback simply never runs (graceful by construction).
- **Why isn't the confetti a slot component?** The effect occupies no UI space: the canvas is appended to `document.body` on the first celebration and removed with the plugin. A React component that only `return null` would buy nothing.
- **Why not the Host?** The host-side `agent/status` event does report a turn closing slightly earlier, but that needs resident Host state and a Client↔Host channel. The client session snapshot already carries the authoritative `running` bit (the shipped sidebar and the subagent surfaces read exactly that field), so subscribing to it is zero-latency and needs no RPC.
- **Physics** are authored per 60 Hz frame and rescaled at runtime with `dt * 60`, so a 144 Hz display and a throttled background tab trace the same arc. The canvas scales by `devicePixelRatio` (capped at 2). At most 640 pieces; pieces that leave the frame or outlive their TTL are recycled, and the loop stops itself when the queue empties.
- **Large displays**: tuned on 1280×800, launch speed and paper size get a 0.82–1.5 multiplier derived from the square root of the viewport area, so a 2K/4K window does not dilute the effect.
