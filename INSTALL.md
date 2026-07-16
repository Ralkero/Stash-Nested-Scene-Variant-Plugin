# Install

Target: Stash v0.31.1.

1. Copy the whole `stash-scene-metadata-variants-v1` folder into your Stash plugin directory.

   On a normal Windows install this is usually:

   ```text
   C:\Users\<you>\.stash\plugins\stash-scene-metadata-variants-v1
   ```

2. In Stash, go to Settings -> Plugins.

3. Click Reload Plugins.

4. Confirm the plugin appears as `Scene Variant Sets`.

   The manifest file is named `scene-metadata-variants-v1.yml` on purpose. Stash uses the YAML filename as the plugin ID, so a generic `plugin.yml` can collide with other local plugins.

5. Leave `dryRun` enabled for the first run.

### Optional Playback Queue Companion

The player-page `Add Selected` and `Add All Variants` controls require the separate `Session Scene Queue` plugin version `1.2.0` or later.

Install its folder beside this plugin in the same Stash plugins directory, then reload plugins. Scene Variant discovery, review, linking, thumbnails, sorting, and player navigation continue to work when the queue companion is not installed.

6. Keep creation settings disabled until dry-run output looks correct:

   ```text
   createMissingTags: false
   createMissingGroups: false
   createMissingStudios: false
   allowOverwrite: false
   ```

7. Run the `Variant Sets: Preview metadata backfill` task against a small selected set first.

8. Open the task log and verify proposed Studio, Group, and Tag changes.

9. For variants, test with two harmless scenes:

   - Run `Variant Sets: Attach child scene` with `dryRun: true`.
   - Confirm the task log shows the expected parent/child IDs.
   - Run it again with `dryRun: false` only after the dry-run is correct.

## UI

The plugin loads:

```text
ui/scene-variants.js
ui/scene-variants.css
```

After reload, open a scene page. A compact `Variant Set Manager` panel with a `VS` mark should appear near the scene content. If it does not appear, check the browser console and Stash plugin reload logs.

On the Scenes browsing page, primary scene cards with variants should show a small chain-link dropdown beside the normal Tags and Groups indicators. Child variant cards are hidden by default; open the toolbar ellipsis menu and use `Show nested variants` to toggle them temporarily.

## Saved Filter For Hidden Variants

V1 uses the helper tag `Variant Hidden` to hide child variants from normal browsing.

Recommended setup:

1. Create or let the plugin create the `Variant Hidden` tag.
2. Go to the Scenes page.
3. Build a filter that excludes scenes with the `Variant Hidden` tag.
4. Save it as something like `Scenes - hide variants`.
5. Set that saved filter as your default Scenes page filter in Stash.

The plugin does not use deprecated default-filter GraphQL mutations.
