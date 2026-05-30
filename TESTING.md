# Testing

## Automated Mock Tests

From this folder:

```powershell
node --check .\scene-metadata-variants.js
node --check .\ui\scene-variants.js
node .\tests\run-tests.js
```

Current mock coverage:

- dry-run auto-tagging performs no create/update mutations
- real auto-tagging merges existing Groups and Tags before `sceneUpdate`
- Stash-style `input.args` values are honored for live task config
- Stash v0.31.1 `input.Args` casing is honored for live task config
- embedded JS runs `main()` in a Stash-like runtime even if `module` exists
- variant linking updates both scenes
- `Variant Hidden` is added additively
- unlink removes only plugin-owned custom fields and the helper tag
- self-linking is rejected
- nesting an existing primary under another scene is rejected
- graph validation reports a child missing from its parent
- graph validation scans beyond the normal bulk auto-tag discovery limit
- rollback scans all variant pages and preserves unrelated scene metadata
- the UI task runner includes the actual Stash plugin ID from `scene-metadata-variants-v1.yml`
- the UI exposes a persistent dry-run mode and does not force live writes
- the scene page panel is removed outside exact scene-player routes
- the scene browsing UI exposes a footer variant dropdown and no longer renders the old thumbnail-corner badge
- nested variant card hiding and the show/hide toggle hooks are present in the UI bundle

## Manual Verification In Stash

Use a small set of scenes first.

### Auto-Tag Dry Run

1. Select 1-3 scenes.
2. Run `Bulk auto-tag scenes`.
3. Keep `dryRun: true`.
4. Confirm logs include:

   ```text
   AUTO_TAG_DRY_RUN
   BULK_AUTO_TAG_SUMMARY
   ```

5. Confirm no Studio, Group, or Tag assignments changed.

### Auto-Tag Live Run

1. Turn on only the creation flags you actually want.
2. Keep `allowOverwrite: false`.
3. Run on the same tiny set.
4. Confirm existing Groups and Tags were preserved.
5. Confirm no Performer objects were created or modified.

### Hook

The `Scene.Create.Post` hook defaults to dry-run. Add one test scene through normal Stash scan/import and confirm the task log shows the hook re-fetching and evaluating the scene by ID.

### Variant Link

1. Pick one primary scene and one child variant scene.
2. Run `Link variant` with:

   ```text
   primarySceneId=<primary id>
   childSceneId=<child id>
   label=Alt Angle
   dryRun=true
   ```

3. Confirm the dry-run output references both scenes.
4. Re-run with `dryRun=false`.
5. Open both scenes and confirm:

   - primary has `variant_role=primary`
   - child has `variant_role=variant`
   - child points to the primary
   - child has `Variant Hidden`
   - existing character Tags remain present

### UI

1. Open the primary scene page.
2. Confirm the `Variants` panel lists linked variants.
3. Confirm the `Dry run` checkbox is checked by default.
4. Click a variant and confirm it navigates to that scene page.
5. Open the child scene page.
6. Confirm the panel shows a primary link and sibling list.
7. Return to the Scenes browsing page.
8. Confirm the scene-page `Variants` panel disappears.

### Scene Card Variant Dropdown

Refresh the Scenes page after linking variants. Primary scene cards should show a small chain-link dropdown beside the normal Tags and Groups indicators below the thumbnail. Open the dropdown and confirm each child variant is listed and navigates to the correct scene.

The old thumbnail-corner `N variants` badge should not appear.

### Nested Variant Visibility Toggle

By default, child variant cards should be hidden on the Scenes browsing page. Open the toolbar ellipsis menu and use `Show nested variants`; child variant cards should appear. Toggle it again and they should hide.

V1 limitation: Stash UI patching is experimental, so the dropdown and toolbar toggle are best-effort DOM integrations rather than guaranteed React component patches. The authoritative fallback hiding mechanism is the `Variant Hidden` saved filter.

### Variant Maintenance Scan

`Validate variant graph` and `Rollback variant data` use `variantScanLimit`, not `sceneDiscoveryLimit`. The default `variantScanLimit=0` means scan all pages returned by Stash. Set a positive limit only when you intentionally want a bounded maintenance run.

## Live Schema Checks

Checked against the local Stash v0.31.1 GraphQL endpoint on 2026-05-29:

- `SceneUpdateInput.custom_fields` exists
- `CustomFieldsInput` exposes `full`, `partial`, and `remove`
- `SceneGroupInput` exposes `group_id` and `scene_index`
- `runPluginTask` accepts `args_map`
- the plugin loads with ID `scene-metadata-variants-v1`
- dry-run `Validate variant graph` completed as job `5` with status `FINISHED`
- dry-run `Link variant` completed as job `6` with status `FINISHED`, and scenes `2110` and `2109` remained unchanged afterward
- jobs `9`, `10`, `11`, and `12` exposed live-entrypoint/config issues; fixed by `0.1.7` with Stash-style `input.Args` normalization, a Stash-safe Node export guard, and explicit final evaluated task output
- real `Link variant` completed as job `14`: scene `2110` became primary, scene `2109` became a variant, and `Variant Hidden` tag `195` was created/applied
- real `Unlink variant` completed as job `15`: plugin-owned variant fields and the helper tag were removed from scene `2109`; scenes `2110` and `2109` returned to empty `custom_fields` and empty scene tags
- temporary diagnostic tag `Codex JS Smoke Temporary Tag` was deleted after the input-shape investigation
- Stash exposes the UI assets at `/plugin/scene-metadata-variants-v1/javascript` and `/plugin/scene-metadata-variants-v1/css`

Still verify manually in the UI before calling the V1 fully production-proven:

- the `Variants` panel appears on scene pages after a browser refresh
- the scene-card variant dropdown attaches beside the Tags and Groups indicators in your current Stash theme
- nested variant cards hide by default and can be shown from the toolbar ellipsis menu
- the UI dry-run checkbox queues a dry-run task before applying a relationship
