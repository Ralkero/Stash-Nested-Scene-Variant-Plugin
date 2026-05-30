# V1 Implementation Checklist

Authoritative spec: `C:\Users\jmswo\Downloads\Nested Scene Variant Plugin.md`

## Package

- [x] Single Stash plugin package.
- [x] Embedded JavaScript task/hook engine.
- [x] UI JavaScript/CSS assets.
- [x] Documentation: install, testing, user guide, rollback.
- [x] Live Stash v0.31.1 schema introspection verified.

## Auto-Tagger

- [x] Manual bulk task.
- [x] `Scene.Create.Post` hook entrypoint that re-fetches scene by ID.
- [x] Custom taxonomy: franchise -> Studio, artist -> Groups, characters -> Tags.
- [x] No Performer creation or modification.
- [x] Dry-run default.
- [x] Field confidence and final confidence.
- [x] Needs Review behavior for mid-confidence matches.
- [x] Full-array merge before `sceneUpdate`.
- [x] No metadata deletion or overwrite unless configured.
- [x] Existing-object lookup before creation.
- [x] Stash `input.Args`, `input.args`, `ArgsMap`, and `args_map` task config is normalized before dispatch.
- [x] Embedded JS entrypoint runs in Stash even if a CommonJS-like `module` object exists.
- [x] Embedded JS leaves the task result as the final evaluated value for Stash.

## Variants

- [x] Custom-field model for primary/child relationships.
- [x] Reads both array and JSON-string `variant_children`.
- [x] Writes plugin-owned keys through `custom_fields.partial` / `remove`.
- [x] Link variant.
- [x] Unlink variant.
- [x] Move variant to a new primary.
- [x] Promote variant to primary.
- [x] Rename variant label.
- [x] Reorder variants.
- [x] Rebuild set.
- [x] Validate graph.
- [x] Rollback all variant data.
- [x] Add/remove `Variant Hidden` helper tag additively.
- [x] Prevent self-links, circular links, duplicate child IDs, and multi-level nesting.

## UI

- [x] Scene page Variants panel.
- [x] Scene page panel only appears on exact scene-player pages and is removed on browse pages.
- [x] Manual add-as-variant workflow using scene ID input.
- [x] Unlink and promote buttons.
- [x] Navigation-first variant selector.
- [x] Best-effort scene card footer variant dropdown beside Tags/Groups indicators.
- [x] Thumbnail-corner variant badge removed.
- [x] Nested child variant cards hidden by default on scene browsing pages.
- [x] Best-effort toolbar ellipsis toggle to show/hide nested variants.
- [x] UI task runner uses the actual Stash manifest plugin ID.
- [x] UI variant actions default to dry-run through a visible toggle.
- [x] Document saved-filter hiding workflow.
- [x] Document V1 UI limitations.

## Verification

- [x] Mock GraphQL test harness.
- [x] Auto-tag dry-run does not mutate.
- [x] Auto-tag real run merges current groups/tags.
- [x] Link variant updates both scenes and adds hidden tag.
- [x] Unlink removes plugin fields and preserves metadata.
- [x] Self-link and primary-as-child are rejected.
- [x] Validation detects graph errors.
- [x] Live dry-run validate task completed through Stash.
- [x] Live dry-run link task completed through Stash without changing tested scenes.
- [x] Live real link/unlink smoke test completed through Stash and returned tested scenes to their original state.
- [x] Stash exposes plugin UI JS/CSS asset endpoints.
- [ ] Manual UI and small real-write verification in live Stash v0.31.1.
