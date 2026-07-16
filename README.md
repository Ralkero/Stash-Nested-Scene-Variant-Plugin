# Scene Variant Sets

Stash v0.31.1 plugin package for three workflows:

- auto-tag scenes using the custom mapping `franchise -> Studio`, `artist -> Groups`, `characters -> Tags`
- link alternate scene versions as variants while keeping every scene and file separate
- discover likely variant families with Stash duplicate clusters plus filename/metadata evidence, then review and batch-apply them

The plugin uses an embedded JavaScript task/hook engine plus a UI JavaScript panel. It does not write to SQLite, delete scenes, move files, merge files, or use Performers for artist metadata.

## Files

- `scene-metadata-variants-v1.yml` - Stash plugin manifest, settings, tasks, hook, UI assets
- `scene-metadata-variants.js` - embedded JS task/hook engine
- `ui/scene-variants.js` - scene-page panel, scene-card variant dropdown, and nested-variant visibility toggle
- `ui/scene-variants.css` - UI styling
- `tests/run-tests.js` - mock GraphQL test harness
- `examples/aliases.example.json` - sample alias map shape for task args or future embedded seeds
- `GRAPHQL.md` - exact GraphQL operations and schema assumptions
- `INSTALL.md` - installation steps
- `TESTING.md` - test and manual verification steps
- `USER_GUIDE.md` - user-facing workflow guide
- `ROLLBACK.md` - rollback and recovery procedures
- `CHANGELOG.md` - release notes

## V2 Status

V2 adds assisted candidate discovery and batch review on top of the V1 custom-field relationship model. The discovery scan is read-only. Stash's duplicate checker remains the strict primary source: filename evidence may bridge duplicate-supported scenes, but a similar title alone cannot create a family. A secondary descriptor pass can propose review-only families outside those clusters when scenes have the same complete artist and character identity, explicit version, normalized scene stem, compatible duration and dimensions, and recognized variant markers such as `Std`, `Bonus`, `Alt`, `Nude`, `Loop`, `Vertical`, or `Phone`. Plain numeric suffixes do not qualify as descriptor evidence. This secondary path uses only a constrained local pHash comparison and never raises the global duplicate distance. Every proposed family is constrained to one canonical artist and one complete character set, using Stash Groups/Tags plus standardized filename fields. Explicit `V1`, `V2`, and later identifiers remain separate family boundaries. Explicit main-version markers such as `Std`, `Standard`, and `Default` are preferred as primary; otherwise an unnumbered original is preferred. Review can safely rebuild a partial existing set around that stronger primary or split an existing set that incorrectly mixes explicit versions. Review rows reuse Stash's generated screenshots and preview videos for lazy hover previews. The viewport-aware review dialog can be resized from every edge or corner and remembers its bounds. Clicking a family's status badge changes it to `Approved`; clicking it again returns the family to review. Every scene present in the draft family is automatically included. Use `Select Scenes` and `Remove Scenes From Families` to correct mistaken membership. Families can also be dragged from any noninteractive area and dropped onto another family to merge them, with smooth edge scrolling for long result lists. Cyan editing checkboxes enable the Actions menu for searchable family merges, moving scenes, creating a family, and removing selected scenes or families. Draft review state is stored in browser localStorage, and approved batches must be queued as a dry run before live apply is enabled.

V1 remains implemented, mock-tested, and smoke-tested against the local Stash v0.31.1 GraphQL endpoint. The live schema check confirmed `custom_fields.partial/remove`, `SceneGroupInput`, `runPluginTask(args_map)`, `runPluginOperation(args)`, `findDuplicateScenes(distance, duration_diff)`, and Stash's embedded `input.Args` casing. Dry-run validate/link tasks completed successfully, and a real link/unlink smoke test wrote and then removed variant custom fields on scenes `2110` and `2109`. Still use `dryRun: true` first for new workflows or larger batches.

The scene-page `Variant Set Manager` panel is only mounted on exact scene-player routes such as `/scenes/123`. It is removed when returning to browsing pages. Scene browsing cards use a footer dropdown next to the normal Tags/Groups indicators; the old thumbnail-corner `N variants` badge has been removed. Nested child variants are hidden from scene browsing by default, with a best-effort `Show nested variants` toggle injected into the Scenes toolbar ellipsis menu.

On scene-player pages, every member of the current variant family is shown with its Stash screenshot and generated hover preview. Related scenes can be selected individually and added to the Session Scene Queue, or all other family members can be queued in one action. The currently playing scene remains visible but is not queued again.

Player families are displayed in numeric variant order with the primary first. The manager starts expanded and can be collapsed with the full-width chevron at its lower edge. Scene Variant controls throughout the player manager and candidate review expose descriptive mouse-hover and keyboard-focus tooltips.

The queue buttons require the optional companion plugin `Session Scene Queue` version `1.2.0` or later. All other Scene Variant features work without it.

The manifest is intentionally named `scene-metadata-variants-v1.yml` because Stash uses the YAML filename as the plugin ID. A generic `plugin.yml` filename can collide with other manually installed plugins.

## Key Safety Defaults

- `dryRun: true`
- `createMissingTags: false`
- `createMissingGroups: false`
- `createMissingStudios: false`
- `allowOverwrite: false`
- `variantScanLimit: 0`, meaning validate/rollback scans all variant pages instead of inheriting the small bulk auto-tag discovery limit
- `variantDiscoveryDistance: 4`, the maximum pHash distance requested from Stash and accepted by direct media checks
- `variantDiscoveryDurationDiff: 2`, the maximum duration difference in seconds
- `variantDiscoveryLimit: 200`, bounding the candidate families returned to the review UI
- scene-create hook is not registered; run manual dry-run tasks after scans/imports
- helper tags are merged with existing character tags
- variant custom fields are updated with `partial` / `remove`
- candidate drafts are local browser state until an approved batch is explicitly applied
