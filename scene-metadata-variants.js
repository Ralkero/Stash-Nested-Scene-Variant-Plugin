/*
 * Scene Metadata Variants - Stash v0.31.1 embedded JavaScript plugin.
 *
 * Custom taxonomy:
 * - franchise -> Scene Studio
 * - artist / creator -> Scene Groups
 * - featured characters -> Scene Tags
 * - Performers are intentionally unused.
 *
 * Safety posture:
 * - dryRun defaults to true
 * - sceneUpdate groups/tag_ids are treated as replacement fields
 * - current groups/tags are always merged before writes
 * - custom_fields uses partial/remove only
 * - no file operations, no SQLite access, no scene deletion
 */

var SceneMetadataVariants = (function () {
  "use strict";

  var VERSION = "0.1.8";
  var PLUGIN_ID = "stash-scene-metadata-variants-v1";

  var DEFAULT_CONFIG = {
    dryRun: true,
    createMissingTags: false,
    createMissingGroups: false,
    createMissingStudios: false,
    confidenceThreshold: 0.9,
    reviewThreshold: 0.6,
    franchiseStudioField: "studio",
    variantHiddenTag: "Variant Hidden",
    needsReviewTag: "Needs Review",
    allowOverwrite: false,
    sceneDiscoveryLimit: 50,
    sceneDiscoveryPageSize: 100,
    variantScanLimit: 0,
    variantScanPageSize: 100,
    enableManualVariantNesting: true,
    addHiddenTagWhenNested: true,
    removeHiddenTagWhenUnlinked: true,
    copyPrimaryStudioToVariantIfMissing: true,
    copyPrimaryGroupsToVariantIfMissing: true,
    copyPrimaryTagsToVariantIfMissing: false,
    allowVariantMetadataOverwrite: false,
    variantChildrenStorage: "json"
  };

  var VARIANT_KEYS = [
    "variant_role",
    "variant_set_id",
    "variant_children",
    "variant_parent_id",
    "variant_label",
    "variant_sort_index"
  ];

  var EMBEDDED_ALIASES = {
    studios: {
      "resident evil": "Resident Evil",
      "re": "Resident Evil",
      "street fighter": "Street Fighter",
      "sf": "Street Fighter",
      "final fantasy": "Final Fantasy",
      "ff": "Final Fantasy",
      "legend of zelda": "Legend of Zelda",
      "the legend of zelda": "Legend of Zelda",
      "zelda": "Legend of Zelda",
      "overwatch": "Overwatch",
      "nier": "Nier: Automata",
      "nier automata": "Nier: Automata"
    },
    groups: {
      "nodu": "NoduSFM",
      "nodusfm": "NoduSFM",
      "nodu sfm": "NoduSFM"
    },
    characters: {
      "cammy": "Cammy White",
      "cammy white": "Cammy White",
      "chun li": "Chun-Li",
      "chun-li": "Chun-Li",
      "2b": "2B",
      "2 b": "2B",
      "dva": "D.Va",
      "d va": "D.Va",
      "d.va": "D.Va",
      "jill": "Jill Valentine",
      "jill valentine": "Jill Valentine"
    },
    characterStudios: {
      "cammy white": "Street Fighter",
      "chun li": "Street Fighter",
      "2b": "Nier: Automata",
      "d va": "Overwatch",
      "jill valentine": "Resident Evil"
    }
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function logLine(level, message, runtime) {
    var line = "[scene-metadata-variants] " + level + " " + message;
    if (typeof console !== "undefined" && console && typeof console.log === "function") {
      console.log(line);
    }
    try {
      if (runtime && runtime.log && typeof runtime.log.Info === "function") runtime.log.Info(line);
      else if (runtime && runtime.log && typeof runtime.log.info === "function") runtime.log.info(line);
      else if (runtime && typeof runtime.log === "function") runtime.log(line);
    } catch (e) {
      // console.log remains the portable output path.
    }
  }

  function progress(runtime, fraction) {
    try {
      if (runtime && runtime.log && typeof runtime.log.Progress === "function") {
        runtime.log.Progress(Math.max(0, Math.min(1, fraction || 0)));
      }
    } catch (e) {
      // Progress helpers vary by Stash runtime.
    }
  }

  function gqlDo(query, variables, runtime, operationName) {
    var client = null;
    if (runtime && runtime.gql && typeof runtime.gql.Do === "function") client = runtime.gql;
    else if (typeof gql !== "undefined" && gql && typeof gql.Do === "function") client = gql;
    else if (runtime && typeof runtime.Do === "function") client = runtime;
    if (!client) throw new Error("gql.Do unavailable for " + (operationName || "GraphQL"));
    try {
      return client.Do(query, variables || {});
    } catch (err) {
      throw new Error((operationName || "GraphQL") + " failed: " + String(err && err.message || err));
    }
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compact(value) {
    return normalize(value).replace(/\s+/g, "");
  }

  function uniq(values) {
    var out = [];
    var seen = {};
    for (var i = 0; i < (values || []).length; i++) {
      var v = values[i];
      if (v === undefined || v === null || v === "") continue;
      var key = String(v);
      if (!seen[key]) {
        seen[key] = true;
        out.push(v);
      }
    }
    return out;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function parseJSONMaybe(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }

  function coerceBool(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      var n = normalize(value);
      if (n === "true" || n === "yes" || n === "1" || n === "on") return true;
      if (n === "false" || n === "no" || n === "0" || n === "off") return false;
    }
    return fallback;
  }

  function normalizeThreshold(value, fallback) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return fallback;
    if (n > 1) n = n / 100;
    return Math.max(0, Math.min(1, n));
  }

  function runtimeArgs(args) {
    var raw = args || {};
    var merged = {};
    if (raw.Args && typeof raw.Args === "object") merged = Object.assign(merged, raw.Args);
    if (raw.args && typeof raw.args === "object") merged = Object.assign(merged, raw.args);
    if (raw.ArgsMap && typeof raw.ArgsMap === "object") merged = Object.assign(merged, raw.ArgsMap);
    if (raw.args_map && typeof raw.args_map === "object") merged = Object.assign(merged, raw.args_map);
    return Object.assign(merged, raw);
  }

  function mergeConfig(args) {
    var raw = runtimeArgs(args);
    var fromConfig = parseJSONMaybe(raw.config, raw.config || {});
    var cfg = Object.assign({}, DEFAULT_CONFIG, raw, fromConfig || {});
    cfg.dryRun = coerceBool(cfg.dryRun, DEFAULT_CONFIG.dryRun);
    cfg.createMissingTags = coerceBool(cfg.createMissingTags, DEFAULT_CONFIG.createMissingTags);
    cfg.createMissingGroups = coerceBool(cfg.createMissingGroups, DEFAULT_CONFIG.createMissingGroups);
    cfg.createMissingStudios = coerceBool(cfg.createMissingStudios, DEFAULT_CONFIG.createMissingStudios);
    cfg.allowOverwrite = coerceBool(cfg.allowOverwrite, DEFAULT_CONFIG.allowOverwrite);
    cfg.enableManualVariantNesting = coerceBool(cfg.enableManualVariantNesting, true);
    cfg.addHiddenTagWhenNested = coerceBool(cfg.addHiddenTagWhenNested, true);
    cfg.removeHiddenTagWhenUnlinked = coerceBool(cfg.removeHiddenTagWhenUnlinked, true);
    cfg.copyPrimaryStudioToVariantIfMissing = coerceBool(cfg.copyPrimaryStudioToVariantIfMissing, true);
    cfg.copyPrimaryGroupsToVariantIfMissing = coerceBool(cfg.copyPrimaryGroupsToVariantIfMissing, true);
    cfg.copyPrimaryTagsToVariantIfMissing = coerceBool(cfg.copyPrimaryTagsToVariantIfMissing, false);
    cfg.allowVariantMetadataOverwrite = coerceBool(cfg.allowVariantMetadataOverwrite, false);
    cfg.confidenceThreshold = normalizeThreshold(cfg.confidenceThreshold, DEFAULT_CONFIG.confidenceThreshold);
    cfg.reviewThreshold = normalizeThreshold(cfg.reviewThreshold, DEFAULT_CONFIG.reviewThreshold);
    cfg.sceneDiscoveryLimit = Math.max(1, Math.min(500, Number(cfg.sceneDiscoveryLimit) || 50));
    cfg.sceneDiscoveryPageSize = Math.max(1, Math.min(250, Number(cfg.sceneDiscoveryPageSize) || 100));
    cfg.variantScanLimit = Math.max(0, Math.min(100000, Number(cfg.variantScanLimit) || 0));
    cfg.variantScanPageSize = Math.max(1, Math.min(250, Number(cfg.variantScanPageSize) || 100));
    cfg.variantHiddenTag = String(cfg.variantHiddenTag || DEFAULT_CONFIG.variantHiddenTag);
    cfg.needsReviewTag = String(cfg.needsReviewTag || DEFAULT_CONFIG.needsReviewTag);
    cfg.franchiseStudioField = String(cfg.franchiseStudioField || DEFAULT_CONFIG.franchiseStudioField);
    cfg.variantChildrenStorage = String(cfg.variantChildrenStorage || DEFAULT_CONFIG.variantChildrenStorage);
    return cfg;
  }

  function sceneIdsFromArgs(args) {
    var raw = runtimeArgs(args);
    var v = raw.scene_ids || raw.sceneIds || raw.scene_id || raw.sceneId;
    if (Array.isArray(v)) return uniq(v.map(String));
    if (typeof v === "number") return [String(v)];
    if (typeof v === "string") return uniq(v.split(/[,\s|]+/).filter(Boolean));
    return [];
  }

  function getArg(args, key, fallback) {
    var raw = runtimeArgs(args);
    return raw[key] !== undefined ? raw[key] : fallback;
  }

  function normalizeAliasMap(aliasMap) {
    var raw = parseJSONMaybe(aliasMap, aliasMap || {});
    var source = raw && Object.keys(raw).length ? raw : EMBEDDED_ALIASES;
    var out = { studios: {}, groups: {}, characters: {}, characterStudios: {} };
    Object.keys(out).forEach(function (bucket) {
      var map = source[bucket] || {};
      Object.keys(map).forEach(function (k) {
        var nk = normalize(k);
        if (nk) out[bucket][nk] = map[k];
      });
    });
    return out;
  }

  function aliasValues(obj) {
    if (!obj || !obj.aliases) return [];
    if (Array.isArray(obj.aliases)) return obj.aliases.map(String).filter(Boolean);
    if (typeof obj.aliases === "string") return obj.aliases.split(/[|,;\n\r]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    return [];
  }

  function objectMatchesName(obj, wanted) {
    var target = normalize(wanted);
    if (!target || !obj) return false;
    if (normalize(obj.name) === target || compact(obj.name) === compact(wanted)) return true;
    var aliases = aliasValues(obj);
    for (var i = 0; i < aliases.length; i++) {
      if (normalize(aliases[i]) === target || compact(aliases[i]) === compact(wanted)) return true;
    }
    return false;
  }

  function pathParts(path) {
    return String(path || "").split(/[\\/]/).filter(Boolean);
  }

  function splitArtistTitle(basename) {
    var base = String(basename || "").replace(/\.[^.]+$/, "");
    var parts = base.split(/\s+[-\u2013\u2014]\s+/);
    if (parts.length < 2) return { artist: "", title: base };
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }

  function parseSceneCandidates(scene, aliasMap, runtimeIndex) {
    var file = scene && scene.files && scene.files[0] || {};
    var parts = pathParts(file.path || file.basename || "");
    var folder = parts.length > 1 ? parts[parts.length - 2] : "";
    var split = splitArtistTitle(file.basename || parts[parts.length - 1] || scene.title || "");
    var titleText = [split.title, scene.title || "", scene.details || ""].join(" ");
    var fullText = [folder, split.artist, titleText].join(" ");
    var studios = [];
    var groups = [];
    var characters = [];

    function pushCandidate(list, name, source, confidence, aliasText) {
      if (!name) return;
      var key = normalize(name);
      for (var i = 0; i < list.length; i++) if (normalize(list[i].name) === key) return;
      list.push({ name: name, source: source, confidence: confidence, aliasText: aliasText || "" });
    }

    var folderNorm = normalize(folder);
    if (aliasMap.studios[folderNorm]) pushCandidate(studios, aliasMap.studios[folderNorm], "folder_alias", 0.96, folder);
    else if (runtimeIndex.studios[folderNorm]) pushCandidate(studios, runtimeIndex.studios[folderNorm], "folder_existing", 0.94, folder);

    Object.keys(aliasMap.studios).forEach(function (key) {
      if (containsPhrase(fullText, key)) pushCandidate(studios, aliasMap.studios[key], "alias", 0.96, key);
    });
    Object.keys(runtimeIndex.studios).forEach(function (key) {
      if (containsPhrase(fullText, key)) pushCandidate(studios, runtimeIndex.studios[key], "existing", 0.92, key);
    });

    var artistNorm = normalize(split.artist);
    if (artistNorm) {
      var artistName = aliasMap.groups[artistNorm] || runtimeIndex.groups[artistNorm] || split.artist;
      var source = aliasMap.groups[artistNorm] ? "alias" : (runtimeIndex.groups[artistNorm] ? "existing" : "filename_artist");
      pushCandidate(groups, artistName, source, source === "filename_artist" ? 0.91 : 0.97, split.artist);
    }

    Object.keys(aliasMap.characters).forEach(function (key) {
      if (containsPhrase(titleText, key)) pushCandidate(characters, aliasMap.characters[key], "alias", 0.97, key);
    });
    Object.keys(runtimeIndex.characters).forEach(function (key) {
      if (containsPhrase(titleText, key)) pushCandidate(characters, runtimeIndex.characters[key], "existing", 0.92, key);
    });

    for (var i = 0; i < characters.length; i++) {
      var cn = normalize(characters[i].name);
      var studio = aliasMap.characterStudios[cn] || runtimeIndex.characterStudios[cn];
      if (studio && !studios.length) pushCandidate(studios, studio, "character_studio", 0.93, characters[i].name);
    }

    return {
      studios: studios,
      groups: groups,
      characters: characters,
      raw: { folder: folder, artist: split.artist, title: split.title }
    };
  }

  function containsPhrase(text, phraseNorm) {
    var t = " " + normalize(text) + " ";
    var p = " " + normalize(phraseNorm) + " ";
    return p.trim() && t.indexOf(p) !== -1;
  }

  function decision(confidence, cfg) {
    if (confidence >= cfg.confidenceThreshold) return "apply";
    if (confidence >= cfg.reviewThreshold) return "review";
    return "skip";
  }

  function currentSceneState(scene) {
    var groupIds = [];
    asArray(scene.groups).forEach(function (g) {
      if (g && g.group && g.group.id) groupIds.push(String(g.group.id));
    });
    var tagIds = [];
    asArray(scene.tags).forEach(function (t) {
      if (t && t.id) tagIds.push(String(t.id));
    });
    return {
      studioId: scene.studio && scene.studio.id ? String(scene.studio.id) : null,
      groupIds: uniq(groupIds),
      tagIds: uniq(tagIds)
    };
  }

  function groupInputs(ids) {
    return uniq(ids).map(function (id) { return { group_id: String(id) }; });
  }

  function buildRuntimeIndex(runtime, cfg, aliasMap) {
    var index = { studios: {}, groups: {}, characters: {}, characterStudios: {} };
    function add(bucket, key, value) {
      var nk = normalize(key);
      if (nk && !index[bucket][nk]) index[bucket][nk] = value;
    }
    function addObj(bucket, obj) {
      if (!obj || !obj.name) return;
      add(bucket, obj.name, obj.name);
      aliasValues(obj).forEach(function (a) { add(bucket, a, obj.name); });
    }
    try {
      asArray(gqlDo(FIND_STUDIOS, { filter: { page: 1, per_page: 500 } }, runtime, "RuntimeStudios").findStudios.studios).forEach(function (s) {
        addObj("studios", s);
      });
    } catch (e1) {
      logLine("WARN", "runtime studio index unavailable: " + String(e1.message || e1), runtime);
    }
    try {
      asArray(gqlDo(FIND_GROUPS, { filter: { page: 1, per_page: 500 } }, runtime, "RuntimeGroups").findGroups.groups).forEach(function (g) {
        addObj("groups", g);
      });
    } catch (e2) {
      logLine("WARN", "runtime group index unavailable: " + String(e2.message || e2), runtime);
    }
    try {
      asArray(gqlDo(FIND_TAGS, { filter: { page: 1, per_page: 500 } }, runtime, "RuntimeTags").findTags.tags).forEach(function (t) {
        addObj("characters", t);
        asArray(t.parents).forEach(function (p) {
          var studio = index.studios[normalize(p && p.name)] || aliasMap.studios[normalize(p && p.name)];
          if (studio) {
            add("characterStudios", t.name, studio);
            aliasValues(t).forEach(function (a) { add("characterStudios", a, studio); });
          }
        });
      });
    } catch (e3) {
      logLine("WARN", "runtime tag index unavailable: " + String(e3.message || e3), runtime);
    }
    return index;
  }

  function findScene(id, runtime) {
    var res = gqlDo(GET_SCENE, { id: String(id) }, runtime, "FindScene");
    if (!res || !res.findScene) throw new Error("Scene not found: " + id);
    return res.findScene;
  }

  function findExistingByName(kind, name, runtime) {
    var query = kind === "studio" ? FIND_STUDIOS : (kind === "group" ? FIND_GROUPS : FIND_TAGS);
    var root = kind === "studio" ? "findStudios" : (kind === "group" ? "findGroups" : "findTags");
    var listKey = kind === "studio" ? "studios" : (kind === "group" ? "groups" : "tags");
    var filterKey = kind === "studio" ? "studio_filter" : (kind === "group" ? "group_filter" : "tag_filter");
    var vars = { filter: { per_page: 25 } };
    vars[filterKey] = { name: { value: name, modifier: "EQUALS" } };
    var exactRes = gqlDo(query, vars, runtime, "Find" + kind);
    var exact = asArray(((exactRes && exactRes[root]) || {})[listKey]);
    for (var i = 0; i < exact.length; i++) if (objectMatchesName(exact[i], name)) return exact[i];
    var fuzzyVars = { filter: { q: name, per_page: 25 } };
    var fuzzyRoot = gqlDo(query, fuzzyVars, runtime, "Search" + kind)[root] || {};
    var items = asArray(fuzzyRoot[listKey]);
    for (var j = 0; j < items.length; j++) if (objectMatchesName(items[j], name)) return items[j];
    for (var k = 0; k < items.length; k++) {
      if (safeCloseMatch(name, items[k].name)) return items[k];
    }
    return null;
  }

  function safeCloseMatch(wanted, existing) {
    var a = compact(wanted);
    var b = compact(existing);
    if (!a || !b || a.length < 4) return false;
    var suffixes = ["sfm", "3d", "vr", "anim", "animation", "studio"];
    for (var i = 0; i < suffixes.length; i++) {
      if (b === a + suffixes[i]) return true;
    }
    return false;
  }

  function createObject(kind, name, runtime) {
    if (kind === "studio") return (gqlDo(CREATE_STUDIO, { input: { name: name } }, runtime, "CreateStudio").studioCreate || null);
    if (kind === "group") return (gqlDo(CREATE_GROUP, { input: { name: name } }, runtime, "CreateGroup").groupCreate || null);
    return (gqlDo(CREATE_TAG, { input: { name: name } }, runtime, "CreateTag").tagCreate || null);
  }

  function resolveCandidate(kind, candidate, cfg, runtime, summary) {
    if (!candidate) return null;
    var existing = findExistingByName(kind, candidate.name, runtime);
    if (existing) return existing;
    var canCreate = kind === "studio" ? cfg.createMissingStudios : (kind === "group" ? cfg.createMissingGroups : cfg.createMissingTags);
    if (!canCreate) return null;
    if (cfg.dryRun) {
      summary.wouldCreate.push(kind + ":" + candidate.name);
      return { id: "dryrun:" + kind + ":" + candidate.name, name: candidate.name, dryRun: true };
    }
    var created = createObject(kind, candidate.name, runtime);
    if (created && created.id) {
      if (kind === "studio") summary.studiosCreated++;
      else if (kind === "group") summary.groupsCreated++;
      else summary.tagsCreated++;
    }
    return created;
  }

  function findOrCreateTag(name, cfg, runtime, summary) {
    var found = findExistingByName("tag", name, runtime);
    if (found) return found;
    if (!cfg.createMissingTags) return null;
    if (cfg.dryRun) {
      summary.wouldCreate.push("tag:" + name);
      return { id: "dryrun:tag:" + name, name: name, dryRun: true };
    }
    var created = createObject("tag", name, runtime);
    if (created && created.id) summary.tagsCreated++;
    return created;
  }

  function processAutoTagScene(sceneId, cfg, aliasMap, runtimeIndex, runtime, summary) {
    summary.scanned++;
    var scene = findScene(sceneId, runtime);
    var state = currentSceneState(scene);
    var candidates = parseSceneCandidates(scene, aliasMap, runtimeIndex);
    var studioCandidate = candidates.studios[0] || null;
    var groupCandidates = candidates.groups;
    var characterCandidates = candidates.characters;
    var confStudio = studioCandidate ? studioCandidate.confidence : 0;
    var confArtist = groupCandidates.length ? groupCandidates[0].confidence : 0;
    var confChars = characterCandidates.length ? characterCandidates[0].confidence : 0;
    var finalConfidence = Math.max(confStudio, confArtist, confChars);
    var action = decision(finalConfidence, cfg);
    var file = scene.files && scene.files[0] || {};
    var logPrefix = "scene=" + scene.id + " path=" + (file.path || file.basename || "") +
      " franchise=" + (studioCandidate && studioCandidate.name || "") +
      " artist=" + groupCandidates.map(function (g) { return g.name; }).join("|") +
      " characters=" + characterCandidates.map(function (c) { return c.name; }).join("|") +
      " confidence=" + finalConfidence.toFixed(2) + " action=" + action;

    if (action === "skip") {
      summary.skipped++;
      logLine("INFO", "AUTO_TAG_SKIP " + logPrefix, runtime);
      return { result: "skipped", sceneId: scene.id };
    }

    if (action === "review") {
      var reviewTag = findOrCreateTag(cfg.needsReviewTag, cfg, runtime, summary);
      var reviewTagIds = reviewTag && reviewTag.id ? [String(reviewTag.id)] : [];
      var nextTags = uniq(state.tagIds.concat(reviewTagIds));
      if (!cfg.dryRun && reviewTagIds.length && nextTags.length !== state.tagIds.length) {
        gqlDo(UPDATE_SCENE, { input: { id: scene.id, tag_ids: nextTags } }, runtime, "MarkNeedsReview");
        summary.needsReview++;
      } else if (cfg.dryRun) {
        summary.needsReview++;
      }
      logLine("INFO", "AUTO_TAG_REVIEW " + logPrefix, runtime);
      return { result: "review", sceneId: scene.id };
    }

    var matchedStudio = resolveCandidate("studio", studioCandidate, cfg, runtime, summary);
    var matchedGroups = [];
    for (var i = 0; i < groupCandidates.length; i++) {
      var group = resolveCandidate("group", groupCandidates[i], cfg, runtime, summary);
      if (group && group.id) matchedGroups.push(String(group.id));
    }
    var matchedTags = [];
    for (var c = 0; c < characterCandidates.length; c++) {
      var tag = resolveCandidate("tag", characterCandidates[c], cfg, runtime, summary);
      if (tag && tag.id) matchedTags.push(String(tag.id));
    }

    var nextStudio = state.studioId;
    if (matchedStudio && matchedStudio.id && (!state.studioId || cfg.allowOverwrite)) {
      nextStudio = String(matchedStudio.id);
    }
    var nextGroups = cfg.allowOverwrite ? matchedGroups : uniq(state.groupIds.concat(matchedGroups));
    var nextTagsApply = cfg.allowOverwrite ? matchedTags : uniq(state.tagIds.concat(matchedTags));
    var input = { id: String(scene.id) };
    if (nextStudio !== state.studioId) input.studio_id = nextStudio;
    if (nextGroups.join("|") !== state.groupIds.join("|")) input.groups = groupInputs(nextGroups);
    if (nextTagsApply.join("|") !== state.tagIds.join("|")) input.tag_ids = nextTagsApply;

    if (Object.keys(input).length === 1) {
      summary.noOp++;
      logLine("INFO", "AUTO_TAG_NOOP " + logPrefix, runtime);
      return { result: "noop", sceneId: scene.id };
    }

    if (cfg.dryRun) {
      summary.dryRun++;
      logLine("INFO", "AUTO_TAG_DRY_RUN " + logPrefix + " update=" + JSON.stringify(input), runtime);
      return { result: "dry_run", sceneId: scene.id, input: input };
    }

    gqlDo(UPDATE_SCENE, { input: input }, runtime, "AutoTagSceneUpdate");
    summary.updated++;
    logLine("INFO", "AUTO_TAG_UPDATED " + logPrefix, runtime);
    return { result: "updated", sceneId: scene.id, input: input };
  }

  function bulkAutoTag(args, runtime) {
    var cfg = mergeConfig(args);
    var aliasMap = normalizeAliasMap(getArg(args, "aliases", EMBEDDED_ALIASES));
    var runtimeIndex = buildRuntimeIndex(runtime, cfg, aliasMap);
    var ids = sceneIdsFromArgs(args);
    var summary = emptySummary();
    if (!ids.length) ids = discoverSceneIds(cfg, runtime);
    logLine("INFO", "BULK_AUTO_TAG_START version=" + VERSION + " dryRun=" + cfg.dryRun + " scenes=" + ids.length, runtime);
    for (var i = 0; i < ids.length; i++) {
      try {
        processAutoTagScene(ids[i], cfg, aliasMap, runtimeIndex, runtime, summary);
      } catch (err) {
        summary.failures++;
        logLine("ERROR", "AUTO_TAG_ERROR scene=" + ids[i] + " error=" + String(err && err.message || err), runtime);
      }
      progress(runtime, ids.length ? (i + 1) / ids.length : 1);
    }
    logLine("INFO", "BULK_AUTO_TAG_SUMMARY " + summaryString(summary), runtime);
    return { Output: "Bulk auto-tag complete: " + summaryString(summary), summary: summary };
  }

  function emptySummary() {
    return {
      scanned: 0,
      updated: 0,
      dryRun: 0,
      skipped: 0,
      noOp: 0,
      needsReview: 0,
      studiosCreated: 0,
      groupsCreated: 0,
      tagsCreated: 0,
      linked: 0,
      unlinked: 0,
      rebuilt: 0,
      validated: 0,
      fixed: 0,
      failures: 0,
      wouldCreate: []
    };
  }

  function summaryString(s) {
    return "scanned=" + s.scanned +
      " updated=" + s.updated +
      " dryRun=" + s.dryRun +
      " skipped=" + s.skipped +
      " noOp=" + s.noOp +
      " needsReview=" + s.needsReview +
      " studiosCreated=" + s.studiosCreated +
      " groupsCreated=" + s.groupsCreated +
      " tagsCreated=" + s.tagsCreated +
      " linked=" + s.linked +
      " unlinked=" + s.unlinked +
      " rebuilt=" + s.rebuilt +
      " validated=" + s.validated +
      " fixed=" + s.fixed +
      " failures=" + s.failures;
  }

  function discoverSceneIds(cfg, runtime) {
    var ids = [];
    var page = 1;
    while (ids.length < cfg.sceneDiscoveryLimit) {
      var res = gqlDo(FIND_SCENES, { filter: { page: page, per_page: cfg.sceneDiscoveryPageSize, sort: "id", direction: "DESC" } }, runtime, "FindScenesBulk");
      var scenes = res && res.findScenes && res.findScenes.scenes || [];
      for (var i = 0; i < scenes.length && ids.length < cfg.sceneDiscoveryLimit; i++) {
        ids.push(String(scenes[i].id));
      }
      if (scenes.length < cfg.sceneDiscoveryPageSize) break;
      page++;
    }
    return ids;
  }

  function customFields(scene) {
    return scene && scene.custom_fields && typeof scene.custom_fields === "object" ? scene.custom_fields : {};
  }

  function variantChildren(scene) {
    var cf = customFields(scene);
    var raw = cf.variant_children;
    if (Array.isArray(raw)) return uniq(raw.map(String));
    var parsed = parseJSONMaybe(raw, []);
    if (Array.isArray(parsed)) return uniq(parsed.map(String));
    if (typeof raw === "string" && raw.trim()) return uniq(raw.split(/[,\s|]+/).filter(Boolean).map(String));
    return [];
  }

  function encodeChildren(children, cfg) {
    var values = uniq((children || []).map(String));
    if (cfg.variantChildrenStorage === "array") return values;
    return JSON.stringify(values);
  }

  function variantSetIdFor(primaryId) {
    return "set_scene_" + String(primaryId);
  }

  function updateSceneFields(sceneId, partial, remove, runtime, dryRun) {
    var input = { id: String(sceneId), custom_fields: {} };
    if (partial && Object.keys(partial).length) input.custom_fields.partial = partial;
    if (remove && remove.length) input.custom_fields.remove = remove;
    if (dryRun) return { dryRun: true, input: input };
    return gqlDo(UPDATE_SCENE, { input: input }, runtime, "UpdateSceneCustomFields").sceneUpdate;
  }

  function updateSceneTags(scene, nextTagIds, runtime, dryRun) {
    var current = currentSceneState(scene);
    var next = uniq(nextTagIds.map(String));
    if (next.join("|") === current.tagIds.join("|")) return { noop: true };
    var input = { id: String(scene.id), tag_ids: next };
    if (dryRun) return { dryRun: true, input: input };
    return gqlDo(UPDATE_SCENE, { input: input }, runtime, "UpdateSceneTags").sceneUpdate;
  }

  function updateSceneMetadataIfMissing(child, primary, cfg, runtime) {
    var input = { id: String(child.id) };
    var childState = currentSceneState(child);
    var primaryState = currentSceneState(primary);
    if (cfg.copyPrimaryStudioToVariantIfMissing && primaryState.studioId && (!childState.studioId || cfg.allowVariantMetadataOverwrite)) {
      input.studio_id = primaryState.studioId;
    }
    if (cfg.copyPrimaryGroupsToVariantIfMissing && primaryState.groupIds.length && (!childState.groupIds.length || cfg.allowVariantMetadataOverwrite)) {
      input.groups = groupInputs(cfg.allowVariantMetadataOverwrite ? primaryState.groupIds : uniq(childState.groupIds.concat(primaryState.groupIds)));
    }
    if (cfg.copyPrimaryTagsToVariantIfMissing && primaryState.tagIds.length) {
      input.tag_ids = cfg.allowVariantMetadataOverwrite ? primaryState.tagIds : uniq(childState.tagIds.concat(primaryState.tagIds));
    }
    if (Object.keys(input).length === 1) return { noop: true };
    if (cfg.dryRun) return { dryRun: true, input: input };
    return gqlDo(UPDATE_SCENE, { input: input }, runtime, "CopyVariantMetadata").sceneUpdate;
  }

  function addHiddenTag(scene, cfg, runtime, summary) {
    if (!cfg.addHiddenTagWhenNested) return null;
    var tag = findOrCreateTag(cfg.variantHiddenTag, cfg, runtime, summary || emptySummary());
    if (!tag || !tag.id) return null;
    var ids = uniq(currentSceneState(scene).tagIds.concat([String(tag.id)]));
    return updateSceneTags(scene, ids, runtime, cfg.dryRun);
  }

  function removeHiddenTag(scene, cfg, runtime) {
    if (!cfg.removeHiddenTagWhenUnlinked) return null;
    var hidden = null;
    asArray(scene.tags).forEach(function (t) { if (normalize(t.name) === normalize(cfg.variantHiddenTag)) hidden = String(t.id); });
    if (!hidden) return null;
    var ids = currentSceneState(scene).tagIds.filter(function (id) { return String(id) !== hidden; });
    return updateSceneTags(scene, ids, runtime, cfg.dryRun);
  }

  function assertCanLink(primary, child) {
    if (String(primary.id) === String(child.id)) throw new Error("Cannot link a scene to itself");
    var primaryCf = customFields(primary);
    var childCf = customFields(child);
    if (primaryCf.variant_role === "variant") throw new Error("Selected primary scene is itself a variant; multi-level nesting is not supported in V1");
    if (childCf.variant_role === "primary" && variantChildren(child).length) throw new Error("Selected child is already a primary scene with variants; nesting would create a tree");
    if (childCf.variant_role === "variant" && childCf.variant_parent_id && String(childCf.variant_parent_id) !== String(primary.id)) {
      throw new Error("Selected child is already a variant of another primary");
    }
  }

  function linkVariant(primarySceneId, childSceneId, label, options, runtime) {
    var cfg = mergeConfig(options || {});
    var summary = emptySummary();
    var primary = findScene(primarySceneId, runtime);
    var child = findScene(childSceneId, runtime);
    assertCanLink(primary, child);
    var children = variantChildren(primary);
    if (children.indexOf(String(child.id)) === -1) children.push(String(child.id));
    var setId = customFields(primary).variant_set_id || variantSetIdFor(primary.id);
    var childIndex = children.indexOf(String(child.id)) + 1;
    var primaryPartial = {
      variant_role: "primary",
      variant_set_id: setId,
      variant_children: encodeChildren(children, cfg)
    };
    var childPartial = {
      variant_role: "variant",
      variant_set_id: setId,
      variant_parent_id: String(primary.id),
      variant_label: String(label || "Variant"),
      variant_sort_index: String(childIndex)
    };
    updateSceneFields(primary.id, primaryPartial, [], runtime, cfg.dryRun);
    updateSceneFields(child.id, childPartial, [], runtime, cfg.dryRun);
    addHiddenTag(child, cfg, runtime, summary);
    updateSceneMetadataIfMissing(child, primary, cfg, runtime);
    summary.linked++;
    logLine("INFO", "VARIANT_LINK primary=" + primary.id + " child=" + child.id + " label=" + childPartial.variant_label + " dryRun=" + cfg.dryRun, runtime);
    return { result: cfg.dryRun ? "dry_run" : "linked", primaryId: String(primary.id), childId: String(child.id), summary: summary };
  }

  function unlinkVariant(childSceneId, options, runtime) {
    var cfg = mergeConfig(options || {});
    var child = findScene(childSceneId, runtime);
    var cf = customFields(child);
    if (cf.variant_role !== "variant" || !cf.variant_parent_id) return { result: "noop", childId: String(child.id) };
    var parent = findScene(cf.variant_parent_id, runtime);
    var children = variantChildren(parent).filter(function (id) { return String(id) !== String(child.id); });
    if (children.length) {
      updateSceneFields(parent.id, { variant_role: "primary", variant_set_id: cf.variant_set_id || variantSetIdFor(parent.id), variant_children: encodeChildren(children, cfg) }, [], runtime, cfg.dryRun);
    } else {
      updateSceneFields(parent.id, {}, ["variant_role", "variant_set_id", "variant_children"], runtime, cfg.dryRun);
    }
    updateSceneFields(child.id, {}, ["variant_role", "variant_set_id", "variant_parent_id", "variant_label", "variant_sort_index"], runtime, cfg.dryRun);
    removeHiddenTag(child, cfg, runtime);
    logLine("INFO", "VARIANT_UNLINK parent=" + parent.id + " child=" + child.id + " dryRun=" + cfg.dryRun, runtime);
    return { result: cfg.dryRun ? "dry_run" : "unlinked", parentId: String(parent.id), childId: String(child.id) };
  }

  function moveVariantToPrimary(childSceneId, newPrimarySceneId, options, runtime) {
    var cfg = mergeConfig(options || {});
    var oldCfg = Object.assign({}, cfg, { removeHiddenTagWhenUnlinked: false });
    unlinkVariant(childSceneId, oldCfg, runtime);
    return linkVariant(newPrimarySceneId, childSceneId, getArg(options, "label", "Variant"), cfg, runtime);
  }

  function renameVariant(childSceneId, newLabel, options, runtime) {
    var cfg = mergeConfig(options || {});
    var child = findScene(childSceneId, runtime);
    if (customFields(child).variant_role !== "variant") throw new Error("Scene is not a child variant");
    updateSceneFields(child.id, { variant_label: String(newLabel || "Variant") }, [], runtime, cfg.dryRun);
    return { result: cfg.dryRun ? "dry_run" : "renamed", childId: String(child.id), label: String(newLabel || "Variant") };
  }

  function reorderVariants(primarySceneId, orderedChildIds, options, runtime) {
    var cfg = mergeConfig(options || {});
    var primary = findScene(primarySceneId, runtime);
    if (customFields(primary).variant_role !== "primary") throw new Error("Scene is not a primary scene");
    var unique = uniq((orderedChildIds || []).map(String));
    var current = variantChildren(primary);
    for (var i = 0; i < current.length; i++) {
      if (unique.indexOf(current[i]) === -1) unique.push(current[i]);
    }
    updateSceneFields(primary.id, { variant_children: encodeChildren(unique, cfg) }, [], runtime, cfg.dryRun);
    for (var j = 0; j < unique.length; j++) {
      updateSceneFields(unique[j], { variant_sort_index: String(j + 1) }, [], runtime, cfg.dryRun);
    }
    return { result: cfg.dryRun ? "dry_run" : "reordered", primaryId: String(primary.id), children: unique };
  }

  function promoteVariantToPrimary(childSceneId, options, runtime) {
    var cfg = mergeConfig(options || {});
    var child = findScene(childSceneId, runtime);
    var cf = customFields(child);
    if (cf.variant_role !== "variant" || !cf.variant_parent_id) throw new Error("Scene is not a child variant");
    var oldParent = findScene(cf.variant_parent_id, runtime);
    var siblings = variantChildren(oldParent).filter(function (id) { return String(id) !== String(child.id); });
    var newSetId = variantSetIdFor(child.id);
    updateSceneFields(child.id, { variant_role: "primary", variant_set_id: newSetId, variant_children: encodeChildren(siblings, cfg) }, ["variant_parent_id", "variant_label", "variant_sort_index"], runtime, cfg.dryRun);
    removeHiddenTag(child, cfg, runtime);
    updateSceneFields(oldParent.id, {}, ["variant_role", "variant_set_id", "variant_children"], runtime, cfg.dryRun);
    for (var i = 0; i < siblings.length; i++) {
      updateSceneFields(siblings[i], { variant_parent_id: String(child.id), variant_set_id: newSetId, variant_sort_index: String(i + 1) }, [], runtime, cfg.dryRun);
    }
    return { result: cfg.dryRun ? "dry_run" : "promoted", primaryId: String(child.id), children: siblings };
  }

  function rebuildVariantSet(primarySceneId, options, runtime) {
    var cfg = mergeConfig(options || {});
    var primary = findScene(primarySceneId, runtime);
    var children = variantChildren(primary);
    var setId = customFields(primary).variant_set_id || variantSetIdFor(primary.id);
    updateSceneFields(primary.id, { variant_role: "primary", variant_set_id: setId, variant_children: encodeChildren(children, cfg) }, [], runtime, cfg.dryRun);
    for (var i = 0; i < children.length; i++) {
      updateSceneFields(children[i], { variant_role: "variant", variant_parent_id: String(primary.id), variant_set_id: setId, variant_sort_index: String(i + 1) }, [], runtime, cfg.dryRun);
    }
    return { result: cfg.dryRun ? "dry_run" : "rebuilt", primaryId: String(primary.id), children: children };
  }

  function validateVariantGraph(options, runtime) {
    var cfg = mergeConfig(options || {});
    var report = { errors: [], warnings: [], scenesChecked: 0, fixes: 0 };
    var scenes = findAllScenesWithCustomFields(runtime, cfg.variantScanLimit, cfg.variantScanPageSize);
    var byId = {};
    scenes.forEach(function (s) { byId[String(s.id)] = s; });
    scenes.forEach(function (s) {
      report.scenesChecked++;
      var cf = customFields(s);
      if (cf.variant_role === "variant") {
        if (!cf.variant_parent_id) report.errors.push("child_missing_parent:" + s.id);
        if (String(cf.variant_parent_id) === String(s.id)) report.errors.push("self_parent:" + s.id);
        var parent = byId[String(cf.variant_parent_id)];
        if (!parent) report.errors.push("parent_missing:" + s.id + "->" + cf.variant_parent_id);
        else if (variantChildren(parent).indexOf(String(s.id)) === -1) {
          report.errors.push("parent_missing_child:" + cf.variant_parent_id + " missing " + s.id);
          if (getArg(options, "fix", false) && !cfg.dryRun) {
            var kids = variantChildren(parent);
            kids.push(String(s.id));
            updateSceneFields(parent.id, { variant_children: encodeChildren(kids, cfg) }, [], runtime, false);
            report.fixes++;
          }
        }
      }
      if (cf.variant_role === "primary") {
        var seen = {};
        variantChildren(s).forEach(function (childId) {
          if (seen[childId]) report.errors.push("duplicate_child:" + s.id + " child " + childId);
          seen[childId] = true;
          var child = byId[String(childId)];
          if (child && customFields(child).variant_role === "primary") report.errors.push("nested_primary:" + childId);
        });
      }
    });
    logLine("INFO", "VARIANT_VALIDATE checked=" + report.scenesChecked + " errors=" + report.errors.length + " fixes=" + report.fixes + " dryRun=" + cfg.dryRun, runtime);
    return report;
  }

  function rollbackVariantData(options, runtime) {
    var cfg = mergeConfig(options || {});
    var scenes = findAllScenesWithCustomFields(runtime, cfg.variantScanLimit, cfg.variantScanPageSize);
    var count = 0;
    scenes.forEach(function (s) {
      var cf = customFields(s);
      var hasVariantKey = false;
      for (var i = 0; i < VARIANT_KEYS.length; i++) if (cf[VARIANT_KEYS[i]] !== undefined) hasVariantKey = true;
      if (!hasVariantKey) return;
      updateSceneFields(s.id, {}, VARIANT_KEYS, runtime, cfg.dryRun);
      removeHiddenTag(s, cfg, runtime);
      count++;
    });
    logLine("INFO", "VARIANT_ROLLBACK scenes=" + count + " dryRun=" + cfg.dryRun, runtime);
    return { result: cfg.dryRun ? "dry_run" : "rolled_back", scenes: count };
  }

  function findAllScenesWithCustomFields(runtime, limit, pageSize) {
    var out = [];
    var page = 1;
    var perPage = Math.max(1, Math.min(250, Number(pageSize) || 100));
    var max = Math.max(0, Number(limit) || 0);
    while (!max || out.length < max) {
      var res = gqlDo(FIND_SCENES_WITH_CUSTOM_FIELDS, { filter: { page: page, per_page: perPage, sort: "id", direction: "ASC" } }, runtime, "FindScenesWithCustomFields");
      var scenes = res && res.findScenes && res.findScenes.scenes || [];
      var count = res && res.findScenes && Number(res.findScenes.count) || 0;
      for (var i = 0; i < scenes.length && (!max || out.length < max); i++) out.push(scenes[i]);
      if (!scenes.length) break;
      if (scenes.length < perPage) break;
      if (count && out.length >= count) break;
      page++;
    }
    return out;
  }

  function dispatch(args, runtime) {
    var mode = String(getArg(args, "mode", "bulk_auto_tag"));
    var cfg = mergeConfig(args || {});
    logLine("INFO", "START version=" + VERSION + " mode=" + mode + " dryRun=" + cfg.dryRun, runtime);
    if (mode === "bulk_auto_tag" || mode === "bulk") return bulkAutoTag(args, runtime);
    if (mode === "hook_create") {
      var hookContext = getArg(args, "hookContext", null) || getArg(args, "HookContext", null);
      var hookId = getArg(args, "id", null) || (hookContext && hookContext.id);
      if (!hookId) throw new Error("Hook did not provide a scene id");
      return bulkAutoTag(Object.assign({}, args || {}, { scene_ids: [String(hookId)], dryRun: cfg.dryRun }), runtime);
    }
    if (mode === "link_variant") return linkVariant(getArg(args, "primarySceneId"), getArg(args, "childSceneId"), getArg(args, "label", "Variant"), args, runtime);
    if (mode === "unlink_variant") return unlinkVariant(getArg(args, "childSceneId") || getArg(args, "sceneId"), args, runtime);
    if (mode === "move_variant") return moveVariantToPrimary(getArg(args, "childSceneId"), getArg(args, "newPrimarySceneId"), args, runtime);
    if (mode === "promote_variant") return promoteVariantToPrimary(getArg(args, "childSceneId") || getArg(args, "sceneId"), args, runtime);
    if (mode === "rename_variant") return renameVariant(getArg(args, "childSceneId") || getArg(args, "sceneId"), getArg(args, "label", "Variant"), args, runtime);
    if (mode === "reorder_variants") return reorderVariants(getArg(args, "primarySceneId"), parseJSONMaybe(getArg(args, "orderedChildIds", "[]"), []), args, runtime);
    if (mode === "rebuild_variant_set") return rebuildVariantSet(getArg(args, "primarySceneId") || getArg(args, "sceneId"), args, runtime);
    if (mode === "validate_variant_graph") return validateVariantGraph(args, runtime);
    if (mode === "rollback_variants") return rollbackVariantData(args, runtime);
    throw new Error("Unknown mode: " + mode);
  }

  function embeddedRuntime() {
    var runtime = {};
    if (typeof gql !== "undefined") runtime.gql = gql;
    if (typeof log !== "undefined") runtime.log = log;
    return runtime;
  }

  function embeddedInput() {
    if (typeof input !== "undefined" && input) return input;
    return {};
  }

  var GET_SCENE = "query FindSceneForMetadataVariants($id: ID!) { findScene(id: $id) { id title details custom_fields studio { id name aliases } groups { group { id name aliases } scene_index } tags { id name aliases parents { id name } } files { path basename } } }";
  var FIND_SCENES = "query FindScenesForMetadataVariants($filter: FindFilterType) { findScenes(filter: $filter) { count scenes { id title details custom_fields studio { id name } groups { group { id name } scene_index } tags { id name } files { path basename } } } }";
  var FIND_SCENES_WITH_CUSTOM_FIELDS = "query FindScenesWithCustomFields($filter: FindFilterType) { findScenes(filter: $filter) { count scenes { id title custom_fields tags { id name } } } }";
  var FIND_STUDIOS = "query FindStudiosForMetadataVariants($studio_filter: StudioFilterType, $filter: FindFilterType) { findStudios(studio_filter: $studio_filter, filter: $filter) { count studios { id name aliases } } }";
  var FIND_GROUPS = "query FindGroupsForMetadataVariants($group_filter: GroupFilterType, $filter: FindFilterType) { findGroups(group_filter: $group_filter, filter: $filter) { count groups { id name aliases } } }";
  var FIND_TAGS = "query FindTagsForMetadataVariants($tag_filter: TagFilterType, $filter: FindFilterType) { findTags(tag_filter: $tag_filter, filter: $filter) { count tags { id name aliases parents { id name } } } }";
  var CREATE_STUDIO = "mutation CreateStudioForMetadataVariants($input: StudioCreateInput!) { studioCreate(input: $input) { id name aliases } }";
  var CREATE_GROUP = "mutation CreateGroupForMetadataVariants($input: GroupCreateInput!) { groupCreate(input: $input) { id name aliases } }";
  var CREATE_TAG = "mutation CreateTagForMetadataVariants($input: TagCreateInput!) { tagCreate(input: $input) { id name aliases } }";
  var UPDATE_SCENE = "mutation UpdateSceneForMetadataVariants($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id title custom_fields studio { id name } groups { group { id name } scene_index } tags { id name } } }";

  return {
    VERSION: VERSION,
    PLUGIN_ID: PLUGIN_ID,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    normalize: normalize,
    mergeConfig: mergeConfig,
    parseSceneCandidates: parseSceneCandidates,
    bulkAutoTag: bulkAutoTag,
    linkVariant: linkVariant,
    unlinkVariant: unlinkVariant,
    moveVariantToPrimary: moveVariantToPrimary,
    promoteVariantToPrimary: promoteVariantToPrimary,
    renameVariant: renameVariant,
    reorderVariants: reorderVariants,
    rebuildVariantSet: rebuildVariantSet,
    validateVariantGraph: validateVariantGraph,
    rollbackVariantData: rollbackVariantData,
    dispatch: dispatch,
    _test: {
      customFields: customFields,
      variantChildren: variantChildren,
      encodeChildren: encodeChildren,
      currentSceneState: currentSceneState,
      summaryString: summaryString
    },
    main: function () {
      return dispatch(embeddedInput(), embeddedRuntime());
    }
  };
})();

var SceneMetadataVariantsOutput;

if (typeof module !== "undefined" && module.exports && typeof process !== "undefined" && process.versions && process.versions.node) {
  module.exports = SceneMetadataVariants;
}

if (typeof input !== "undefined" || typeof gql !== "undefined") {
  SceneMetadataVariantsOutput = SceneMetadataVariants.main();
}

SceneMetadataVariantsOutput;
