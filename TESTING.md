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

### Scene Card Badge

Refresh the Scenes page after linking variants. Primary scene cards should show a small `N variants` badge when the DOM structure allows the UI script to attach it.

V1 limitation: Stash UI patching is experimental, so the badge is best-effort DOM integration rather than a guaranteed React component patch. The authoritative hiding mechanism is the `Variant Hidden` saved filter.

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
- Stash exposes the UI assets at `/plugin/scene-metadata-variants-v1/javascript` and `/plugin/scene-metadata-variants-v1/css`

Still verify manually in the UI before calling the V1 fully production-proven:

- the `Variants` panel appears on scene pages after a browser refresh
- the scene-card badge attaches correctly in your current Stash theme
- a small real `Link variant` run writes the expected custom fields and helper tag
