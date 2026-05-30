# Scene Metadata Variants

Stash v0.31.1 plugin package for two workflows:

- auto-tag scenes using the custom mapping `franchise -> Studio`, `artist -> Groups`, `characters -> Tags`
- link alternate scene versions as variants while keeping every scene and file separate

The plugin uses an embedded JavaScript task/hook engine plus a UI JavaScript panel. It does not write to SQLite, delete scenes, move files, merge files, or use Performers for artist metadata.

## Files

- `plugin.yml` - Stash plugin manifest, settings, tasks, hook, UI assets
- `scene-metadata-variants.js` - embedded JS task/hook engine
- `ui/scene-variants.js` - scene-page panel and best-effort scene-card badge UI
- `ui/scene-variants.css` - UI styling
- `tests/run-tests.js` - mock GraphQL test harness
- `examples/aliases.example.json` - sample alias map shape for task args or future embedded seeds
- `GRAPHQL.md` - exact GraphQL operations and schema assumptions
- `INSTALL.md` - installation steps
- `TESTING.md` - test and manual verification steps
- `USER_GUIDE.md` - user-facing workflow guide
- `ROLLBACK.md` - rollback and recovery procedures

## V1 Status

This V1 is implemented and mock-tested. Live Stash v0.31.1 schema introspection has not yet been run in this workspace, so install first with `dryRun: true` and verify in the GraphQL/task logs before live writes.

## Key Safety Defaults

- `dryRun: true`
- `createMissingTags: false`
- `createMissingGroups: false`
- `createMissingStudios: false`
- `allowOverwrite: false`
- `variantScanLimit: 0`, meaning validate/rollback scans all variant pages instead of inheriting the small bulk auto-tag discovery limit
- hook runs dry-run by default
- helper tags are merged with existing character tags
- variant custom fields are updated with `partial` / `remove`
