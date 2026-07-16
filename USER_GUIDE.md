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

## Nested Scene Variants V2 Discovery

Use `Review Candidate Families` from a scene page's `Variant Set Manager` panel, `Variant Family Review` from the Scenes browse toolbar, or `Variant Sets: Discover Candidate Variants` from Settings -> Tasks. All three open the same interactive review window.

The V2 scan is read-only. It uses:

- Stash `findDuplicateScenes(distance, duration_diff)` duplicate clusters as the primary discovery source
- normalized filename similarity for bridging duplicate-supported scenes
- a review-only descriptor pass for exact artist, complete character signature, scene stem, explicit version, duration, and dimension matches
- shared Studio, Groups, and Tags
- duration, aspect-ratio, and available pHash compatibility
- variant/downgrade tokens such as `preview`, `clip`, `loop`, `watermarked`, `silent`, `alt`, `v2`, and `cropped`

While discovery runs, the review window shows an activity indicator and elapsed time. When it finishes, candidate families appear immediately with Suggested/Review classifications, confidence evidence, filters, title search, scene thumbnails, and links to open each scene. Hover a thumbnail, or focus it with the keyboard, to play Stash's existing generated preview. Numbered siblings are grouped only when supported by stronger duplicate or descriptor evidence, and overlapping compatible duplicate clusters are merged. Explicit `V1`, `V2`, and later scene versions remain separate. When an unnumbered original exists it is proposed as primary.

Candidate families are constrained to one artist and one complete character set. Canonical Stash Groups and character Tags take priority over filename spelling, while standardized filename character fields prevent incomplete tags from combining different multi-character scenes. Reliable artist, character, explicit-version, duration, aspect-ratio, or pHash conflicts split candidates into separate families. Missing identity evidence is labeled `unresolved` and prevents automatic suggestion until reviewed. Filename similarity or a plain numeric suffix by itself never creates a candidate family. Descriptor-only families require recognizable signals such as `Std`, `Bonus`, `Alt`, `Nude`, `Loop`, `Vertical`, or `Phone` and are always presented for review rather than auto-suggested.

Primary selection recognizes explicit main-version language. `Std`, `Standard`, and `Default` are strong selectors. `Regular`, `Normal`, and `Vanilla` are supporting evidence, while contextual terms such as `Full Version`, `Full Anim`, `Full Audio`, `Complete`, and `Uncut` indicate completeness. `Original`, `Base`, and `Main` are weaker evidence. Clear variant descriptors such as `POV`, `Bonus`, `Nude`, and `Old Version` still reduce parent suitability. Parent signals appear as green labels in the review window.

The review window stores its draft in browser localStorage. Suggested results start approved; review and ignored results start unapproved. Click the yellow `Review` status, or another unapproved status badge, to change it to green `Approved`. Click `Approved` again to return the family to its previous review status. Every scene shown as a member is automatically included when that family is approved. The `Included` badge is informational rather than a second approval control. To correct a mistaken member, enable `Select Scenes`, select it, then use `Actions` -> `Remove Scenes From Families`. Use the Approval menu to approve all suggested families, approve or unapprove the visible filtered set, or clear every approval. The same cyan editing controls support merging families, moving scenes, creating a family from selected scenes, and removing selected families. Merge Families opens a search field and filters candidate families immediately as you type. You can also drag a family from any space that is not a link, thumbnail, button, or form control and drop it onto another family to merge them. Holding a dragged family near the top or bottom of the visible results scrolls the list smoothly. Editing selection never changes Apply approval. Manual edits unapprove only the affected family. Nothing is written to Stash while you edit the draft. Any edit clears the previous dry-run authorization. When approvals exist without a current preview, the live button reads `Preview Required`; click it to queue the dry run without losing the draft. After that succeeds, it changes to `Create Variant Sets`.

Manual merge and add-scene controls reject scenes with a different known artist or character. Correct the scene's Stash metadata or filename first, then run discovery again if two scenes that should match are blocked.

The review window opens at a viewport-aware size and can be resized by dragging any edge or corner. Its last size and position are stored in browser localStorage and constrained automatically if the browser window becomes smaller.

To apply a reviewed family:

1. Click the family status so it reads `Approved`.
2. Confirm the proposed primary scene or select a different primary.
3. Confirm the included members and edit child labels where needed.
4. Click `Preview Approved Links`.
5. Inspect the Stash task log for the queued dry-run job.
6. Return to the review window and click `Create Variant Sets`.

Live apply writes only the same plugin-owned variant custom fields used by manual V1 linking.

## Auto-Tagging

Use the `Variant Sets: Preview metadata backfill` task.

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

Open a scene page and use the `Variant Set Manager` panel. The panel is only shown on exact scene-player pages, and it should disappear when you return to the scene browsing grid.

Each family member is shown with its Stash screenshot. Hover or keyboard-focus the thumbnail to play Stash's generated multi-frame preview. Select any related scenes and choose `Add Selected`, or choose `Add All Variants` to append every other family member to the Session Scene Queue. The scene currently playing is shown for context but is not added again.

The family list keeps the primary first and sorts numbered variants in ascending order. Queue actions use the same order. The full-width chevron at the bottom collapses or expands the manager; each newly opened scene starts expanded.

Mouse over any Scene Variant control to see a short explanation. The same tooltip appears when the control receives keyboard focus.

Queue controls require the optional `Session Scene Queue` companion plugin version `1.2.0` or later. The rest of the Scene Variant plugin remains available without it.

The panel has a `Preview changes only` checkbox that is enabled by default. Leave it checked to queue a preview task and inspect the Stash task log. Uncheck it only when you are ready to apply the relationship.

For a normal scene:

- `Attach Child Scene` links another scene under the current scene.
- `Nest This Scene` makes the current scene a child of another primary scene.

For a primary scene:

- linked variants appear as preview rows
- clicking a variant title or thumbnail navigates to its normal scene page

For a child variant:

- the panel links back to the primary scene
- sibling variants are listed
- `Detach From Set` removes the relationship
- `Make Set Primary` makes the child the new primary for the set

Every destructive-looking action asks for confirmation. These operations only change Stash metadata and plugin-owned custom fields.

## Browsing Variants

On the scene browsing page, primary scenes with linked variants show a small chain-link dropdown beside the normal Tags and Groups indicators below the thumbnail. Open it to see the linked variants, then choose one to navigate to that scene.

Nested child variants are hidden from the scene browsing page by default. To temporarily show them, open the Scenes toolbar ellipsis menu and use `Show nested variants`. The setting is stored in your browser local storage.

## Linking Variants From Tasks

Run `Variant Sets: Discover Candidate Variants` from Settings -> Tasks to open the interactive read-only discovery review.

Run `Variant Sets: Attach child scene` with:

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
