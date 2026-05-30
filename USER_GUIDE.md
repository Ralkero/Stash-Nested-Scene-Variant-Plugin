# User Guide

## What This Plugin Does

The plugin follows this Stash metadata model:

- Franchise goes in `Studio`.
- Artist or creator goes in `Groups`.
- Featured characters go in `Tags`.
- Performers are not used for artist tagging.

It also lets you link alternate versions of a scene as variants:

- the main scene remains the visible primary scene
- alternate scenes remain separate Stash Scene records
- child variants can receive the `Variant Hidden` tag
- the primary scene stores its child list in `custom_fields`

No files are moved, merged, deleted, or edited.

## Auto-Tagging

Use the `Bulk auto-tag scenes` task.

Important defaults:

- dry-run is on
- missing object creation is off
- overwrite is off

The parser looks at:

- file path
- basename
- title
- details
- existing Studio, Group, Tag names and aliases
- embedded seed aliases

Confidence behavior:

- `0.90+`: apply
- `0.60-0.89`: add/preserve `Needs Review`
- below `0.60`: skip

The plugin always reads the current scene first and sends merged final `groups` and `tag_ids` arrays so existing metadata is preserved.

## Linking Variants From The UI

Open a scene page and use the `Variants` panel. The panel is only shown on exact scene-player pages, and it should disappear when you return to the scene browsing grid.

The panel has a `Dry run` checkbox that is enabled by default. Leave it checked to queue a preview task and inspect the Stash task log. Uncheck it only when you are ready to apply the relationship.

For a normal scene:

- `Add Existing Scene` links another scene under the current scene.
- `Add This Under Another` makes the current scene a child of another primary scene.

For a primary scene:

- linked variants appear as buttons
- clicking a variant navigates to its normal scene page

For a child variant:

- the panel links back to the primary scene
- sibling variants are listed
- `Unlink` removes the relationship
- `Promote` makes the child the new primary for the set

Every destructive-looking action asks for confirmation. These operations only change Stash metadata and plugin-owned custom fields.

## Browsing Variants

On the scene browsing page, primary scenes with linked variants show a small chain-link dropdown beside the normal Tags and Groups indicators below the thumbnail. Open it to see the linked variants, then choose one to navigate to that scene.

Nested child variants are hidden from the scene browsing page by default. To temporarily show them, open the Scenes toolbar ellipsis menu and use `Show nested variants`. The setting is stored in your browser local storage.

## Linking Variants From Tasks

Run `Link variant` with:

```text
primarySceneId=<primary scene id>
childSceneId=<child scene id>
label=<Alt Angle / Alt Outfit / Custom>
dryRun=true
```

After checking the log, repeat with:

```text
dryRun=false
```

## Variant Data Model

Primary scene custom fields:

```json
{
  "variant_role": "primary",
  "variant_set_id": "set_scene_123",
  "variant_children": "[\"456\", \"789\"]"
}
```

Child scene custom fields:

```json
{
  "variant_role": "variant",
  "variant_set_id": "set_scene_123",
  "variant_parent_id": "123",
  "variant_label": "Alt Angle",
  "variant_sort_index": "1"
}
```

The code reads both array and JSON-string `variant_children`. V1 writes JSON strings for compatibility.

## Rules And Guardrails

The plugin does not allow:

- linking a scene to itself
- duplicate child IDs
- circular parent-child links
- nesting a primary scene under another primary
- multi-level variant trees
- silent metadata overwrites
- deleting scenes
- removing unrelated custom fields

## Hiding Child Variants

V1 uses two layers for hiding child variants:

- The UI script hides nested variant cards by default when it can read plugin variant metadata.
- The `Variant Hidden` helper tag can still be used for a Stash-native saved filter.

For the most reliable long-term setup, create a saved filter on the Scenes page that excludes the `Variant Hidden` tag, then set that saved filter as your default.

This is safer than relying on deprecated default-filter mutations or fragile UI filtering patches.

## Known V1 Limitations

- Scene card dropdowns and the toolbar toggle are best-effort DOM integrations and may need adjustment if Stash changes its card or toolbar markup.
- The scene search modal is intentionally simple in V1, but it supports title/path text search and pasted scene IDs.
- Inline player swapping is not implemented. Clicking variants navigates to their normal scene pages.
