# GraphQL Operations

The embedded engine uses only GraphQL through `gql.Do()`. It does not write to SQLite.

## Queries

- `FindSceneForMetadataVariants`
  - `findScene(id)`
  - reads `id`, `title`, `details`, `custom_fields`, `studio`, `groups`, `tags`, `files`

- `FindScenesForMetadataVariants`
  - `findScenes(filter)`
  - used by bulk auto-tagging when no explicit `scene_ids` are supplied

- `FindScenesWithCustomFields`
  - `findScenes(filter)`
  - used by validation and rollback scans

- `FindDuplicateScenesForMetadataVariants`
  - `findDuplicateScenes(distance, duration_diff)`
  - used by V2 read-only variant candidate discovery
  - returns clusters of scenes that are treated as evidence, not automatic links

- `FindStudiosForMetadataVariants`
  - `findStudios(studio_filter, filter)`

- `FindGroupsForMetadataVariants`
  - `findGroups(group_filter, filter)`

- `FindTagsForMetadataVariants`
  - `findTags(tag_filter, filter)`

## Mutations

- `CreateStudioForMetadataVariants`
  - `studioCreate(input: StudioCreateInput!)`

- `CreateGroupForMetadataVariants`
  - `groupCreate(input: GroupCreateInput!)`

- `CreateTagForMetadataVariants`
  - `tagCreate(input: TagCreateInput!)`

- `UpdateSceneForMetadataVariants`
  - `sceneUpdate(input: SceneUpdateInput!)`
  - applies `studio_id`, `groups`, `tag_ids`, and `custom_fields`

- `runPluginOperation(plugin_id, args)`
  - used by the UI to run V2 discovery immediately and receive candidate families for review

- `runPluginTask(plugin_id, task_name, args_map)`
  - used by the UI for queued dry-run and live batch apply jobs

## Safety Assumptions

- `sceneUpdate.groups` and `sceneUpdate.tag_ids` are treated as replacement fields.
- The plugin reads current scene state first and sends merged arrays.
- Variant data uses `custom_fields.partial` and `custom_fields.remove`.
- V1 writes `variant_children` as a JSON string for portability and reads either JSON strings or arrays.
- V2 candidate discovery does not mutate scenes.
- V2 review drafts are browser-local until `Variant Sets: Process approved families` writes approved relationships.

## Live Verification Needed

Confirm these in the target Stash v0.31.1 GraphQL playground:

- `CustomFieldsInput.partial` accepts string values for all variant keys.
- `SceneUpdateInput.groups` accepts `[{ group_id: ID }]`.
- `runPluginTask(plugin_id, task_name, args_map)` is callable from UI JavaScript.
- `runPluginOperation(plugin_id, args)` is callable from UI JavaScript.
- `findDuplicateScenes(distance, duration_diff)` returns scene clusters in the target instance.
- `Group.aliases` shape matches the target instance behavior.
