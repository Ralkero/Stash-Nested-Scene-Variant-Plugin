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

  var VERSION = "0.5.17";
  var PLUGIN_ID = "scene-metadata-variants-v1";

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
    variantChildrenStorage: "json",
    variantDiscoveryDistance: 4,
    variantDiscoveryDurationDiff: 2,
    variantDiscoveryLimit: 200,
    variantFilenameHeuristics: true,
    variantMetadataHeuristics: true,
    variantAutoSuggestThreshold: 0.94,
    variantReviewThreshold: 0.82
  };

  var VARIANT_KEYS = [
    "variant_role",
    "variant_set_id",
    "variant_children",
    "variant_parent_id",
    "variant_label",
    "variant_sort_index"
  ];

  var VARIANT_TOKEN_DEFINITIONS = [
    { token: "preview", label: "Preview", penalty: 0.22 },
    { token: "trailer", label: "Trailer", penalty: 0.22 },
    { token: "clip", label: "Clip", penalty: 0.18 },
    { token: "sample", label: "Sample", penalty: 0.18 },
    { token: "loop", label: "Loop", penalty: 0.14 },
    { token: "edit", label: "Edit", penalty: 0.12 },
    { token: "camera", label: "Camera", penalty: 0.08 },
    { token: "cam", label: "Camera", penalty: 0.08 },
    { token: "alt", label: "Alternate", penalty: 0.08 },
    { token: "v2", label: "Version 2", penalty: 0.04 },
    { token: "wm", label: "Watermarked", penalty: 0.16 },
    { token: "watermarked", label: "Watermarked", penalty: 0.16 },
    { token: "watermark", label: "Watermarked", penalty: 0.16 },
    { token: "censored", label: "Censored", penalty: 0.18 },
    { token: "censor", label: "Censored", penalty: 0.18 },
    { token: "clothed", label: "Clothed", penalty: 0.12 },
    { token: "cloth", label: "Clothed", penalty: 0.10 },
    { token: "bra", label: "Clothed", penalty: 0.08 },
    { token: "toponly", label: "Top only", penalty: 0.08 },
    { token: "top only", label: "Top only", penalty: 0.08 },
    { token: "silent", label: "Silent", penalty: 0.18 },
    { token: "mute", label: "Muted", penalty: 0.18 },
    { token: "muted", label: "Muted", penalty: 0.18 },
    { token: "cropped", label: "Cropped", penalty: 0.14 },
    { token: "crop", label: "Cropped", penalty: 0.14 },
    { token: "vertical", label: "Vertical", penalty: 0.10 },
    { token: "portrait", label: "Vertical", penalty: 0.10 },
    { token: "phone", label: "Phone", penalty: 0.12 },
    { token: "switched", label: "Switched", penalty: 0.08 },
    { token: "revision", label: "Revision", penalty: 0.04 },
    { token: "rev", label: "Revision", penalty: 0.04 },
    { token: "no male audio", label: "NMA", penalty: 0.08 },
    { token: "nma", label: "NMA", penalty: 0.08 },
    { token: "pov", label: "POV", penalty: 0.12 },
    { token: "point of view", label: "POV", penalty: 0.12 },
    { token: "bonus", label: "Bonus", penalty: 0.10 },
    { token: "nude", label: "Nude", penalty: 0.04 },
    { token: "old version", label: "Old version", penalty: 0.12 },
    { token: "nologo", label: "No logo", penalty: 0.02 },
    { token: "no logo", label: "No logo", penalty: 0.02 }
  ];

  var QUALITY_TOKENS = {
    "2160p": 0.22,
    "4k": 0.22,
    "1440p": 0.18,
    "2k": 0.16,
    "1080p": 0.12,
    "720p": 0.04,
    "480p": -0.05
  };

  var CANONICAL_PARENT_MARKERS = [
    { phrase: "std", label: "Standard", rank: 3, score: 0.24 },
    { phrase: "standard", label: "Standard", rank: 3, score: 0.24 },
    { phrase: "default", label: "Default", rank: 3, score: 0.24 },
    { phrase: "regular", label: "Regular", rank: 2, score: 0.10 },
    { phrase: "normal", label: "Normal", rank: 2, score: 0.10 },
    { phrase: "vanilla", label: "Vanilla", rank: 2, score: 0.10 },
    { phrase: "full version", label: "Full version", rank: 2, score: 0.12 },
    { phrase: "full animation", label: "Full animation", rank: 2, score: 0.12 },
    { phrase: "full anim", label: "Full animation", rank: 2, score: 0.12 },
    { phrase: "full audio", label: "Full audio", rank: 2, score: 0.10 },
    { phrase: "complete", label: "Complete", rank: 2, score: 0.10 },
    { phrase: "uncut", label: "Uncut", rank: 2, score: 0.10 },
    { phrase: "full", label: "Full", rank: 2, score: 0.10, terminalOnly: true },
    { phrase: "original", label: "Original", rank: 1, score: 0.05 },
    { phrase: "base", label: "Base", rank: 1, score: 0.05 },
    { phrase: "main", label: "Main", rank: 1, score: 0.05 }
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
    cfg.variantFilenameHeuristics = coerceBool(cfg.variantFilenameHeuristics, true);
    cfg.variantMetadataHeuristics = coerceBool(cfg.variantMetadataHeuristics, true);
    cfg.confidenceThreshold = normalizeThreshold(cfg.confidenceThreshold, DEFAULT_CONFIG.confidenceThreshold);
    cfg.reviewThreshold = normalizeThreshold(cfg.reviewThreshold, DEFAULT_CONFIG.reviewThreshold);
    cfg.variantAutoSuggestThreshold = normalizeThreshold(cfg.variantAutoSuggestThreshold, DEFAULT_CONFIG.variantAutoSuggestThreshold);
    cfg.variantReviewThreshold = normalizeThreshold(cfg.variantReviewThreshold, DEFAULT_CONFIG.variantReviewThreshold);
    cfg.sceneDiscoveryLimit = Math.max(1, Math.min(500, Number(cfg.sceneDiscoveryLimit) || 50));
    cfg.sceneDiscoveryPageSize = Math.max(1, Math.min(250, Number(cfg.sceneDiscoveryPageSize) || 100));
    cfg.variantScanLimit = Math.max(0, Math.min(100000, Number(cfg.variantScanLimit) || 0));
    cfg.variantScanPageSize = Math.max(1, Math.min(250, Number(cfg.variantScanPageSize) || 100));
    cfg.variantDiscoveryDistance = Math.max(0, Math.min(64, Math.round(Number(cfg.variantDiscoveryDistance) || DEFAULT_CONFIG.variantDiscoveryDistance)));
    cfg.variantDiscoveryDurationDiff = Math.max(0, Math.min(600, Number(cfg.variantDiscoveryDurationDiff) || DEFAULT_CONFIG.variantDiscoveryDurationDiff));
    cfg.variantDiscoveryLimit = Math.max(2, Math.min(2000, Number(cfg.variantDiscoveryLimit) || DEFAULT_CONFIG.variantDiscoveryLimit));
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

  function firstFile(scene) {
    return scene && scene.files && scene.files[0] || {};
  }

  function sceneDisplayTitle(scene) {
    var file = firstFile(scene);
    return String((scene && scene.title) || file.basename || file.path || ("Scene " + (scene && scene.id || "")));
  }

  function scenePathText(scene) {
    var file = firstFile(scene);
    return [sceneDisplayTitle(scene), scene && scene.details || "", file.basename || "", file.path || ""].join(" ");
  }

  var NON_CHARACTER_TERMS = {
    "alt": true, "angle": true, "angles": true, "animation": true, "bonus": true,
    "clip": true, "compilation": true, "cowgirl": true, "doggy": true, "loop": true,
    "missionary": true, "position": true, "preview": true, "scene": true, "test": true,
    "version": true, "watermarked": true
  };

  function standardizedNameParts(scene) {
    var file = firstFile(scene);
    var base = basenameNoExt(file.basename || file.path || sceneDisplayTitle(scene));
    base = base.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
    return base.split(/\s+[-\u2013\u2014]\s+/).map(function (part) { return part.trim(); }).filter(Boolean);
  }

  function matchingSceneGroup(scene, rawArtist) {
    var groups = asArray(scene && scene.groups).map(function (entry) { return entry && entry.group; }).filter(Boolean);
    for (var i = 0; i < groups.length; i++) {
      if (objectMatchesName(groups[i], rawArtist)) return groups[i];
    }
    return groups.length === 1 ? groups[0] : null;
  }

  function characterFieldParts(value) {
    return String(value || "").split(/\s*(?:,|\+|&|\band\b)\s*/i).map(function (part) {
      return part.trim();
    }).filter(Boolean);
  }

  function likelyCharacterTag(tag, text) {
    if (!tag || !tag.name) return false;
    var normalizedName = normalize(tag.name);
    if (!normalizedName || NON_CHARACTER_TERMS[normalizedName] || normalizedName.indexOf("variant hidden") !== -1 || normalizedName.indexOf("needs review") !== -1) return false;
    if (containsPhrase(text, tag.name)) return true;
    var aliases = aliasValues(tag);
    for (var i = 0; i < aliases.length; i++) if (containsPhrase(text, aliases[i])) return true;
    return false;
  }

  function sceneVariantIdentity(scene) {
    var parts = standardizedNameParts(scene);
    var rawArtist = parts.length >= 2 ? parts[0] : "";
    var group = matchingSceneGroup(scene, rawArtist);
    var artistLabel = group && group.name || rawArtist;
    var artistKey = normalize(artistLabel);
    var characterText = parts.length >= 2 ? parts[1] : "";
    var matchingTags = asArray(scene && scene.tags).filter(function (tag) { return likelyCharacterTag(tag, characterText); });
    var characterLabels = [];
    var filenameCharacterLabels = [];
    if (parts.length >= 3) {
      characterFieldParts(parts[1]).forEach(function (rawLabel) {
        var matched = matchingTags.filter(function (tag) { return likelyCharacterTag(tag, rawLabel); })[0];
        filenameCharacterLabels.push(String(matched && matched.name || rawLabel));
      });
      matchingTags.forEach(function (tag) {
        var key = normalize(tag.name);
        if (!filenameCharacterLabels.some(function (label) { return normalize(label) === key; })) {
          filenameCharacterLabels.push(String(tag.name));
        }
      });
      characterLabels = filenameCharacterLabels.slice();
    } else if (matchingTags.length) {
      matchingTags.forEach(function (tag) {
        characterLabels.push(String(tag.name));
        filenameCharacterLabels.push(String(tag.name));
      });
    } else if (characterText) {
      Object.keys(EMBEDDED_ALIASES.characters).forEach(function (alias) {
        if (containsPhrase(characterText, alias)) characterLabels.push(EMBEDDED_ALIASES.characters[alias]);
      });
      if (!characterLabels.length) {
        var words = normalize(characterText).split(/\s+/).filter(Boolean);
        var generic = words.some(function (word) { return !!NON_CHARACTER_TERMS[word]; });
        if (!generic && words.length > 0 && words.length <= 3) characterLabels = characterFieldParts(characterText);
      }
      filenameCharacterLabels = characterLabels.slice();
    }
    var characterMap = {};
    characterLabels.forEach(function (label) {
      var key = normalize(label);
      if (key) characterMap[key] = String(label);
    });
    var characterKeys = Object.keys(characterMap).sort();
    var filenameCharacterMap = {};
    filenameCharacterLabels.forEach(function (label) {
      var key = normalize(label);
      if (key) filenameCharacterMap[key] = true;
    });
    return {
      artistKey: artistKey,
      artistLabel: artistLabel || "",
      artistSource: group ? "stash_group" : (rawArtist ? "filename" : "unknown"),
      characterKey: characterKeys.join("|"),
      characterLabels: characterKeys.map(function (key) { return characterMap[key]; }),
      characterSource: matchingTags.length ? "stash_tags" : (characterKeys.length ? "filename" : "unknown"),
      filenameCharacterKey: Object.keys(filenameCharacterMap).sort().join("|")
    };
  }

  function identityCompatible(a, b) {
    var left = a || {};
    var right = b || {};
    if (left.artistKey && right.artistKey && left.artistKey !== right.artistKey) return false;
    if (left.filenameCharacterKey && right.filenameCharacterKey &&
        left.filenameCharacterKey !== right.filenameCharacterKey) return false;
    if (left.characterKey && right.characterKey && left.characterKey !== right.characterKey) return false;
    return true;
  }

  function mergeIdentity(base, addition) {
    var out = Object.assign({}, base || {});
    var next = addition || {};
    if (!out.artistKey && next.artistKey) {
      out.artistKey = next.artistKey;
      out.artistLabel = next.artistLabel;
      out.artistSource = next.artistSource;
    }
    if (!out.characterKey && next.characterKey) {
      out.characterKey = next.characterKey;
      out.characterLabels = next.characterLabels;
      out.characterSource = next.characterSource;
    }
    if (!out.filenameCharacterKey && next.filenameCharacterKey) out.filenameCharacterKey = next.filenameCharacterKey;
    return out;
  }

  function partitionVariantCluster(rawScenes, cfg) {
    var items = [];
    var seen = {};
    asArray(rawScenes).forEach(function (scene) {
      if (!scene || scene.id === undefined || scene.id === null || seen[String(scene.id)]) return;
      seen[String(scene.id)] = true;
      var identity = sceneVariantIdentity(scene);
      items.push({ scene: scene, identity: identity, completeness: (identity.artistKey ? 1 : 0) + (identity.characterKey ? 1 : 0) });
    });
    items.sort(function (a, b) {
      if (a.completeness !== b.completeness) return b.completeness - a.completeness;
      return String(a.scene.id).localeCompare(String(b.scene.id), undefined, { numeric: true });
    });
    var partitions = [];
    items.forEach(function (item) {
      var matches = [];
      partitions.forEach(function (partition, index) {
        if (!identityCompatible(partition.identity, item.identity)) return;
        var score = 0;
        if (partition.identity.artistKey && item.identity.artistKey && partition.identity.artistKey === item.identity.artistKey) score += 2;
        if (partition.identity.characterKey && item.identity.characterKey && partition.identity.characterKey === item.identity.characterKey) score += 2;
        matches.push({ index: index, score: score });
      });
      matches.sort(function (a, b) { return b.score - a.score; });
      var selected = matches.length === 1 || (matches.length > 1 && matches[0].score > matches[1].score) ? matches[0] : null;
      if (!selected) {
        partitions.push({ scenes: [item.scene], identity: item.identity });
      } else {
        partitions[selected.index].scenes.push(item.scene);
        partitions[selected.index].identity = mergeIdentity(partitions[selected.index].identity, item.identity);
      }
    });
    var settings = mergeConfig(cfg || {});
    var mediaPartitions = [];
    partitions.forEach(function (partition) {
      partition.scenes.forEach(function (scene) {
        var selected = null;
        for (var i = 0; i < mediaPartitions.length; i++) {
          if (!identityCompatible(mediaPartitions[i].identity, sceneVariantIdentity(scene))) continue;
          var compatible = mediaPartitions[i].scenes.every(function (member) {
            return versionCompatible(member, scene) && sceneMediaCompatibility(member, scene, settings).compatible;
          });
          if (compatible) {
            selected = mediaPartitions[i];
            break;
          }
        }
        if (selected) selected.scenes.push(scene);
        else mediaPartitions.push({ scenes: [scene], identity: sceneVariantIdentity(scene) });
      });
    });
    var coherentPartitions = [];
    mediaPartitions.forEach(function (partition) {
      var scenes = partition.scenes;
      var parent = scenes.map(function (_, index) { return index; });
      function find(index) {
        while (parent[index] !== index) {
          parent[index] = parent[parent[index]];
          index = parent[index];
        }
        return index;
      }
      function union(a, b) {
        var ra = find(a);
        var rb = find(b);
        if (ra !== rb) parent[rb] = ra;
      }
      for (var i = 0; i < scenes.length; i++) {
        for (var j = i + 1; j < scenes.length; j++) {
          if (versionCompatible(scenes[i], scenes[j]) && filenameSimilarity(scenes[i], scenes[j]) >= 0.82) union(i, j);
        }
      }
      var groups = {};
      scenes.forEach(function (scene, index) {
        var root = String(find(index));
        if (!groups[root]) groups[root] = [];
        groups[root].push(scene);
      });
      var grouped = Object.keys(groups).map(function (root) { return groups[root]; });
      var hasStrongSubgroup = grouped.some(function (group) { return group.length > 1; });
      if (!hasStrongSubgroup) {
        coherentPartitions.push(partition);
        return;
      }
      grouped.forEach(function (group) {
        coherentPartitions.push({
          scenes: group,
          identity: group.reduce(function (identity, scene) {
            return mergeIdentity(identity, sceneVariantIdentity(scene));
          }, {})
        });
      });
    });
    return coherentPartitions;
  }

  function basenameNoExt(value) {
    var raw = String(value || "").split(/[?#]/)[0];
    var base = raw.split(/[\\/]/).pop() || raw;
    try {
      base = decodeURIComponent(base);
    } catch (e) {
      // Keep the raw basename when URL decoding is not applicable.
    }
    return base.replace(/\.[a-z0-9]{2,5}$/i, "");
  }

  function qualityScore(text) {
    var n = normalize(text);
    var score = 0;
    Object.keys(QUALITY_TOKENS).forEach(function (token) {
      if (containsPhrase(n, token)) score = Math.max(score, QUALITY_TOKENS[token]);
    });
    return score;
  }

  function canonicalVariantText(scene) {
    var file = firstFile(scene);
    return basenameNoExt(file.basename || file.path || sceneDisplayTitle(scene));
  }

  function canonicalMarkerMatches(text, marker) {
    var n = normalize(String(text || "").replace(/\[[^\]]*\]/g, " "));
    var phrase = normalize(marker && marker.phrase);
    if (!n || !phrase) return false;
    if (marker.terminalOnly) return new RegExp("(?:^|\\s)" + phrase.replace(/\s+/g, "\\s+") + "$").test(n);
    return containsPhrase(n, phrase);
  }

  function canonicalParentInfo(sceneOrText) {
    var text = typeof sceneOrText === "string" ? sceneOrText : canonicalVariantText(sceneOrText);
    var labels = [];
    var rank = 0;
    var score = 0;
    CANONICAL_PARENT_MARKERS.forEach(function (marker) {
      if (!canonicalMarkerMatches(text, marker)) return;
      if (labels.indexOf(marker.label) === -1) labels.push(marker.label);
      rank = Math.max(rank, Number(marker.rank) || 0);
      score += Number(marker.score) || 0;
    });
    return { rank: rank, score: Math.min(0.3, score), labels: labels, strong: rank >= 3 };
  }

  function explicitFullVersionScore(text) {
    var n = normalize(text);
    var score = 0;
    if (containsPhrase(n, "uncensored")) score += 0.08;
    if (containsPhrase(n, "raw")) score += 0.05;
    if (containsPhrase(n, "nsfw")) score += 0.03;
    if (containsPhrase(n, "final cut") || containsPhrase(n, "final version") || containsPhrase(n, "final render")) score += 0.05;
    return Math.min(0.16, score);
  }

  function numericVariantInfo(scene) {
    var info = terminalVariantNumberInfo(normalizedVariantStem(scene));
    if (!info.hasNumber) return { hasNumber: false, number: null, score: 0.08 };
    var number = info.number;
    var penalty = 0.015 + Math.min(0.09, Math.max(0, number - 1) * 0.006);
    return { hasNumber: true, number: number, score: -penalty, base: info.base };
  }

  function variantTokens(text) {
    var n = normalize(text);
    var found = [];
    VARIANT_TOKEN_DEFINITIONS.forEach(function (def) {
      if (containsPhrase(n, def.token)) {
        var exists = false;
        for (var i = 0; i < found.length; i++) if (found[i].token === def.token || found[i].label === def.label) exists = true;
        if (!exists) found.push({ token: def.token, label: def.label, penalty: def.penalty });
      }
    });
    return found;
  }

  function tokenPenalty(tokens) {
    var total = 0;
    (tokens || []).forEach(function (t) { total += Number(t.penalty) || 0; });
    return Math.min(0.5, total);
  }

  function normalizedVariantStemInternal(scene, removeDescriptorNumbers) {
    var file = firstFile(scene);
    var split = splitArtistTitle(file.basename || sceneDisplayTitle(scene));
    var stem = basenameNoExt(split.title || file.basename || sceneDisplayTitle(scene));
    stem = stem.replace(/\[[^\]]*\]/g, " ");
    stem = stem.replace(/\([^)]*\)/g, " ");
    var n = normalize(stem);
    if (removeDescriptorNumbers) {
      n = n.replace(/\b(?:alt|alternate)\s+angles?(?:\s+\d{1,3})?\b/g, " ");
    }
    VARIANT_TOKEN_DEFINITIONS.forEach(function (def) {
      var phrase = normalize(def.token).replace(/\s+/g, "\\s+");
      var suffix = removeDescriptorNumbers ? "(?:\\s+\\d{1,3})?" : "";
      n = (" " + n + " ").replace(new RegExp(" " + phrase + suffix + " ", "g"), " ");
    });
    Object.keys(QUALITY_TOKENS).forEach(function (token) {
      n = (" " + n + " ").replace(new RegExp(" " + normalize(token) + " ", "g"), " ");
    });
    CANONICAL_PARENT_MARKERS.forEach(function (marker) {
      var phrase = normalize(marker.phrase).replace(/\s+/g, "\\s+");
      if (marker.terminalOnly) n = n.replace(new RegExp("(?:^|\\s)" + phrase + "$"), " ");
      else n = (" " + n + " ").replace(new RegExp(" " + phrase + " ", "g"), " ");
    });
    n = n.replace(/\b(?:hd|uhd|vr|sfm|sound|audio|final|fixed|uncensored|censored)\b/g, " ");
    return n.replace(/\s+/g, " ").trim();
  }

  function normalizedVariantStem(scene) {
    return normalizedVariantStemInternal(scene, false);
  }

  function normalizedFamilyStem(scene) {
    return normalizedVariantStemInternal(scene, true);
  }

  function terminalVariantNumberInfo(stem) {
    var n = String(stem || "").replace(/\s+/g, " ").trim();
    var explicit = n.match(/^(.*?)(?:\s+)(?:v|ver|version|part|scene|clip|cam|camera|angle)\s*(\d{1,3})$/i);
    if (explicit && explicit[1].trim()) {
      return { hasNumber: true, number: Number(explicit[2]), base: explicit[1].trim(), explicit: true };
    }
    var bare = n.match(/^(.*\S)\s+(\d{1,2})$/);
    if (bare && bare[1].trim()) {
      return { hasNumber: true, number: Number(bare[2]), base: bare[1].trim(), explicit: false };
    }
    return { hasNumber: false, number: null, base: n, explicit: false };
  }

  function explicitVersionKey(sceneOrText) {
    var text = typeof sceneOrText === "string" ? sceneOrText : scenePathText(sceneOrText);
    var matches = normalize(text).match(/\bv\s*(\d{1,3})\b/g) || [];
    if (!matches.length) return "";
    var number = (matches[0].match(/\d{1,3}/) || [])[0];
    return number ? "v" + String(Number(number)) : "";
  }

  function versionCompatible(a, b) {
    var left = explicitVersionKey(a);
    var right = explicitVersionKey(b);
    return !left || !right || left === right;
  }

  function baseFamilyStemForScene(scene) {
    var stem = normalizedFamilyStem(scene);
    var version = explicitVersionKey(scene);
    if (version) {
      stem = (" " + stem + " ").replace(new RegExp("\\s" + version.replace(/^v/, "v\\s*") + "\\s", "g"), " ");
    }
    return terminalVariantNumberInfo(stem.replace(/\s+/g, " ").trim()).base;
  }

  function familyStemForScene(scene) {
    var base = baseFamilyStemForScene(scene);
    var version = explicitVersionKey(scene);
    return base + (version ? "|version:" + version : "");
  }

  function tokenSet(text) {
    var words = normalize(text).split(/\s+/).filter(function (w) { return w && w.length > 1; });
    var out = {};
    words.forEach(function (w) { out[w] = true; });
    return out;
  }

  function setSimilarity(a, b) {
    var ak = Object.keys(a || {});
    var bk = Object.keys(b || {});
    if (!ak.length && !bk.length) return 0;
    var union = {};
    var intersection = 0;
    ak.forEach(function (k) { union[k] = true; });
    bk.forEach(function (k) {
      if (union[k]) intersection++;
      union[k] = true;
    });
    return intersection / Math.max(1, Object.keys(union).length);
  }

  function stemSimilarity(as, bs) {
    if (!as || !bs) return 0;
    if (as === bs) return 1;
    var ai = terminalVariantNumberInfo(as);
    var bi = terminalVariantNumberInfo(bs);
    if ((ai.hasNumber && ai.base === bs) || (bi.hasNumber && bi.base === as) ||
        (ai.hasNumber && bi.hasNumber && ai.base === bi.base)) return 1;
    var sim = setSimilarity(tokenSet(as), tokenSet(bs));
    if (as.indexOf(bs) !== -1 || bs.indexOf(as) !== -1) sim = Math.max(sim, 0.82);
    return Math.max(0, Math.min(1, sim));
  }

  function filenameSimilarity(a, b) {
    if (!versionCompatible(a, b)) return 0;
    return stemSimilarity(normalizedVariantStem(a), normalizedVariantStem(b));
  }

  function fingerprintValue(scene, type) {
    var match = asArray(firstFile(scene).fingerprints).filter(function (fingerprint) {
      return normalize(fingerprint && fingerprint.type) === normalize(type);
    })[0];
    return match && String(match.value || "").toLowerCase() || "";
  }

  function hexHammingDistance(a, b) {
    if (!a || !b || a.length !== b.length || !/^[0-9a-f]+$/i.test(a + b)) return null;
    var distance = 0;
    for (var i = 0; i < a.length; i++) {
      var value = parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16);
      while (value) {
        distance += value & 1;
        value >>= 1;
      }
    }
    return distance;
  }

  function sceneMediaCompatibility(a, b, cfg) {
    var af = firstFile(a);
    var bf = firstFile(b);
    var durationA = Number(af.duration) || 0;
    var durationB = Number(bf.duration) || 0;
    var durationDelta = durationA && durationB ? Math.abs(durationA - durationB) : null;
    var durationLimit = Math.max(0, Number(cfg && cfg.variantDiscoveryDurationDiff) || DEFAULT_CONFIG.variantDiscoveryDurationDiff);
    var aspectA = Number(af.width) > 0 && Number(af.height) > 0 ? Number(af.width) / Number(af.height) : 0;
    var aspectB = Number(bf.width) > 0 && Number(bf.height) > 0 ? Number(bf.width) / Number(bf.height) : 0;
    var aspectDelta = aspectA && aspectB ? Math.abs(aspectA - aspectB) : null;
    var phashDistance = hexHammingDistance(fingerprintValue(a, "phash"), fingerprintValue(b, "phash"));
    var phashLimit = Math.max(0, Number(cfg && cfg.variantDiscoveryDistance) || DEFAULT_CONFIG.variantDiscoveryDistance);
    var compatible = true;
    if (durationDelta !== null && durationDelta > durationLimit) compatible = false;
    if (aspectDelta !== null && aspectDelta > 0.08) compatible = false;
    if (phashDistance !== null && phashDistance > phashLimit) compatible = false;
    return {
      compatible: compatible,
      verified: durationDelta !== null || aspectDelta !== null || phashDistance !== null,
      durationDelta: durationDelta,
      aspectDelta: aspectDelta,
      phashDistance: phashDistance
    };
  }

  function hasOrientationVariantSignal(scene) {
    var text = scenePathText(scene);
    return containsPhrase(text, "vertical") || containsPhrase(text, "portrait") ||
      containsPhrase(text, "phone") || containsPhrase(text, "rotated") ||
      containsPhrase(text, "rotation");
  }

  function duplicateNeighborhoodCompatibility(a, b, cfg) {
    var af = firstFile(a);
    var bf = firstFile(b);
    var durationA = Number(af.duration) || 0;
    var durationB = Number(bf.duration) || 0;
    var durationDelta = durationA && durationB ? Math.abs(durationA - durationB) : null;
    var durationLimit = Math.max(0, Number(cfg && cfg.variantDiscoveryDurationDiff) || DEFAULT_CONFIG.variantDiscoveryDurationDiff);
    var aspectA = Number(af.width) > 0 && Number(af.height) > 0 ? Number(af.width) / Number(af.height) : 0;
    var aspectB = Number(bf.width) > 0 && Number(bf.height) > 0 ? Number(bf.width) / Number(bf.height) : 0;
    var aspectDelta = aspectA && aspectB ? Math.abs(aspectA - aspectB) : null;
    var rotatedAspectDelta = aspectA && aspectB ? Math.abs(aspectA - (1 / aspectB)) : null;
    var rotationCompatible = rotatedAspectDelta !== null && rotatedAspectDelta <= 0.08 &&
      (hasOrientationVariantSignal(a) || hasOrientationVariantSignal(b));
    var compatible = true;
    if (durationDelta !== null && durationDelta > durationLimit) compatible = false;
    if (aspectDelta !== null && aspectDelta > 0.08 && !rotationCompatible) compatible = false;
    return {
      compatible: compatible,
      durationDelta: durationDelta,
      aspectDelta: aspectDelta,
      rotatedAspectDelta: rotatedAspectDelta,
      rotationCompatible: rotationCompatible
    };
  }

  function familyMediaEvidence(members, cfg) {
    var verifiedPairs = 0;
    var maxDurationDelta = 0;
    var maxAspectDelta = 0;
    var maxPHashDistance = 0;
    for (var i = 0; i < members.length; i++) {
      for (var j = i + 1; j < members.length; j++) {
        var left = { files: [{ duration: members[i].media.duration, width: members[i].media.width, height: members[i].media.height, fingerprints: members[i].media.fingerprints }] };
        var right = { files: [{ duration: members[j].media.duration, width: members[j].media.width, height: members[j].media.height, fingerprints: members[j].media.fingerprints }] };
        var evidence = sceneMediaCompatibility(left, right, cfg);
        if (evidence.verified) verifiedPairs++;
        if (evidence.durationDelta !== null) maxDurationDelta = Math.max(maxDurationDelta, evidence.durationDelta);
        if (evidence.aspectDelta !== null) maxAspectDelta = Math.max(maxAspectDelta, evidence.aspectDelta);
        if (evidence.phashDistance !== null) maxPHashDistance = Math.max(maxPHashDistance, evidence.phashDistance);
      }
    }
    return {
      mediaVerified: verifiedPairs > 0,
      verifiedMediaPairs: verifiedPairs,
      maxDurationDelta: Math.round(maxDurationDelta * 1000) / 1000,
      maxAspectDelta: Math.round(maxAspectDelta * 1000) / 1000,
      maxPHashDistance: maxPHashDistance
    };
  }

  function metadataTokens(scene) {
    var out = {};
    if (scene && scene.studio && scene.studio.name) out["studio:" + normalize(scene.studio.name)] = true;
    asArray(scene && scene.groups).forEach(function (g) {
      if (g && g.group && g.group.name) out["group:" + normalize(g.group.name)] = true;
    });
    asArray(scene && scene.tags).forEach(function (t) {
      if (t && t.name) out["tag:" + normalize(t.name)] = true;
    });
    return out;
  }

  function metadataSimilarity(a, b) {
    return setSimilarity(metadataTokens(a), metadataTokens(b));
  }

  function metadataCompleteness(scene) {
    var score = 0;
    if (scene && scene.title) score += 0.18;
    if (scene && scene.details) score += 0.08;
    if (scene && scene.studio && scene.studio.id) score += 0.18;
    if (asArray(scene && scene.groups).length) score += 0.18;
    if (asArray(scene && scene.tags).length) score += 0.22;
    if (firstFile(scene).basename || firstFile(scene).path) score += 0.16;
    return Math.min(1, score);
  }

  function parentScore(scene) {
    var text = scenePathText(scene);
    var tokens = variantTokens(text);
    var numberInfo = numericVariantInfo(scene);
    var canonical = canonicalParentInfo(scene);
    var score = 0.52 + (metadataCompleteness(scene) * 0.28) + qualityScore(text) + explicitFullVersionScore(text) + canonical.score + numberInfo.score - tokenPenalty(tokens);
    var cf = customFields(scene);
    if (cf.variant_role === "primary") score += 0.12;
    if (cf.variant_role === "variant") score -= 0.32;
    return Math.max(0, Math.min(1, score));
  }

  function canonicalOriginalIds(scenes) {
    var stems = {};
    asArray(scenes).forEach(function (scene) {
      stems[normalizedVariantStem(scene)] = true;
    });
    var originals = {};
    asArray(scenes).forEach(function (scene) {
      var info = terminalVariantNumberInfo(normalizedVariantStem(scene));
      if (info.hasNumber && stems[info.base]) originals[info.base] = true;
    });
    var ids = {};
    asArray(scenes).forEach(function (scene) {
      if (originals[normalizedVariantStem(scene)]) ids[String(scene.id)] = true;
    });
    return ids;
  }

  function compareParentScenes(a, b, scenes) {
    var originals = canonicalOriginalIds(scenes);
    var ap = canonicalParentInfo(a);
    var bp = canonicalParentInfo(b);
    if ((ap.strong || bp.strong) && ap.rank !== bp.rank) return bp.rank - ap.rank;
    var ao = !!originals[String(a.id)];
    var bo = !!originals[String(b.id)];
    if (ao !== bo) return ao ? -1 : 1;
    var ai = numericVariantInfo(a);
    var bi = numericVariantInfo(b);
    if (ai.hasNumber !== bi.hasNumber) return ai.hasNumber ? 1 : -1;
    if (ai.hasNumber && bi.hasNumber && ai.number !== bi.number) return ai.number - bi.number;
    var scoreDiff = parentScore(b) - parentScore(a);
    if (Math.abs(scoreDiff) > 0.000001) return scoreDiff;
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  }

  function averagePairScore(scenes, scorer) {
    var total = 0;
    var count = 0;
    for (var i = 0; i < scenes.length; i++) {
      for (var j = i + 1; j < scenes.length; j++) {
        total += scorer(scenes[i], scenes[j]);
        count++;
      }
    }
    return count ? total / count : 0;
  }

  function existingVariantSummary(scene) {
    var cf = customFields(scene);
    if (!cf.variant_role) return "";
    if (cf.variant_role === "primary") return "primary";
    if (cf.variant_role === "variant") return "variant_of_" + String(cf.variant_parent_id || "");
    return String(cf.variant_role);
  }

  function familyIdFor(sceneIds) {
    return "nsv2-" + uniq(sceneIds.map(String)).sort().join("-");
  }

  function labelForVariant(scene) {
    var tokens = variantTokens(scenePathText(scene));
    if (tokens.length) return tokens[0].label;
    return "Variant";
  }

  function variantMemberForScene(scene, primaryId, originalIds) {
    var isPrimary = String(scene.id) === String(primaryId);
    var file = firstFile(scene);
    var paths = scene && scene.paths || {};
    var memberIdentity = sceneVariantIdentity(scene);
    var parentPreference = canonicalParentInfo(scene);
    return {
      sceneId: String(scene.id),
      title: sceneDisplayTitle(scene),
      path: file.path || file.basename || "",
      role: isPrimary ? "parent" : "child",
      label: isPrimary ? "Primary" : labelForVariant(scene),
      parentScore: parentScore(scene),
      filenameStem: normalizedVariantStem(scene),
      familyStem: familyStemForScene(scene),
      explicitVersion: explicitVersionKey(scene),
      hasExplicitNumber: numericVariantInfo(scene).hasNumber,
      variantNumber: numericVariantInfo(scene).number,
      isCanonicalOriginal: !!(originalIds && originalIds[String(scene.id)]),
      parentPreferenceRank: parentPreference.rank,
      parentPreferenceScore: parentPreference.score,
      parentSignals: parentPreference.labels,
      variantTokens: variantTokens(scenePathText(scene)).map(function (t) { return t.label; }),
      existingVariant: existingVariantSummary(scene),
      identity: memberIdentity,
      media: {
        screenshot: paths.screenshot || "",
        preview: paths.preview || "",
        webp: paths.webp || "",
        vtt: paths.vtt || "",
        sprite: paths.sprite || "",
        width: Number(file.width) || 0,
        height: Number(file.height) || 0,
        duration: Number(file.duration) || 0,
        fingerprints: asArray(file.fingerprints).map(function (fingerprint) {
          return { type: fingerprint.type, value: fingerprint.value };
        })
      }
    };
  }

  function familyConfidence(scenes, evidence, cfg) {
    var filename = evidence.filenameSimilarity;
    var metadata = evidence.metadataOverlap;
    if (evidence.stashDuplicateCluster) {
      return Math.max(0.65, Math.min(1, 0.48 + (filename * 0.34) + (metadata * 0.18)));
    }
    return Math.min(1, (filename * 0.72) + (metadata * 0.28));
  }

  function familyStatus(confidence, cfg) {
    if (confidence >= cfg.variantAutoSuggestThreshold) return "auto_suggest";
    if (confidence >= cfg.variantReviewThreshold) return "review";
    return "ignore";
  }

  function buildVariantFamily(rawScenes, source, cfg, index) {
    var byId = {};
    var scenes = [];
    asArray(rawScenes).forEach(function (scene) {
      if (!scene || scene.id === undefined || scene.id === null) return;
      var id = String(scene.id);
      if (!byId[id]) {
        byId[id] = true;
        scenes.push(scene);
      }
    });
    if (scenes.length < 2) return null;

    var originalIds = canonicalOriginalIds(scenes);
    scenes.sort(function (a, b) { return compareParentScenes(a, b, scenes); });
    var primary = scenes[0];
    var sceneIds = scenes.map(function (s) { return String(s.id); });
    var evidence = {
      stashDuplicateCluster: source === "stash_duplicate" || source === "duplicate_neighborhood",
      duplicateNeighborhood: source === "duplicate_neighborhood",
      descriptorFamily: source === "descriptor_family",
      source: source,
      duplicateClusterIndex: source === "stash_duplicate" ? index : null,
      filenameSimilarity: cfg.variantFilenameHeuristics ? averagePairScore(scenes, filenameSimilarity) : 0,
      metadataOverlap: cfg.variantMetadataHeuristics ? averagePairScore(scenes, metadataSimilarity) : 0,
      sceneIds: sceneIds
    };
    var confidence = familyConfidence(scenes, evidence, cfg);
    var status = familyStatus(confidence, cfg);
    if ((source === "duplicate_neighborhood" || source === "descriptor_family") && status !== "ignore") status = "review";
    var identity = {};
    scenes.forEach(function (scene) { identity = mergeIdentity(identity, sceneVariantIdentity(scene)); });
    if (status === "auto_suggest" && (!identity.artistKey || !identity.characterKey)) status = "review";
    evidence.identityVerified = !!identity.artistKey && !!identity.characterKey;
    var members = scenes.map(function (scene) {
      return variantMemberForScene(scene, primary.id, originalIds);
    });
    Object.assign(evidence, familyMediaEvidence(members, cfg));
    return {
      familyId: familyIdFor(sceneIds),
      status: status,
      confidence: Math.round(confidence * 1000) / 1000,
      proposedPrimaryId: String(primary.id),
      members: members,
      evidence: evidence,
      identity: identity
    };
  }

  function findDuplicateVariantClusters(cfg, runtime) {
    var res = gqlDo(FIND_DUPLICATE_SCENES, {
      distance: cfg.variantDiscoveryDistance,
      duration_diff: cfg.variantDiscoveryDurationDiff
    }, runtime, "FindDuplicateScenesForVariants");
    return asArray(res && res.findDuplicateScenes);
  }

  function filenameVariantClusters(scenes) {
    var groups = {};
    var numbered = {};
    var exactStems = {};
    asArray(scenes).forEach(function (scene) {
      var stem = normalizedVariantStem(scene);
      if (!stem || stem.length < 4) return;
      exactStems[stem] = true;
      if (!groups[stem]) groups[stem] = [];
      groups[stem].push(scene);
      var info = terminalVariantNumberInfo(stem);
      if (info.hasNumber) {
        if (!numbered[info.base]) numbered[info.base] = [];
        numbered[info.base].push({ scene: scene, number: info.number, explicit: info.explicit });
      }
    });
    var clusters = Object.keys(groups).map(function (key) { return groups[key]; }).filter(function (cluster) { return cluster.length > 1; });
    Object.keys(numbered).forEach(function (base) {
      var entries = numbered[base];
      var numbers = {};
      entries.forEach(function (entry) { numbers[entry.number] = true; });
      var hasOriginal = !!exactStems[base];
      var numericValues = Object.keys(numbers).map(Number);
      var explicitSequence = entries.some(function (entry) { return entry.explicit; });
      var alphaWordCount = base.split(/\s+/).filter(function (word) { return /^[a-z]+$/.test(word); }).length;
      var safeBareSequence = numericValues.length >= 3 && (Math.max.apply(Math, numericValues) <= 12 || alphaWordCount >= 2);
      if (!hasOriginal && !explicitSequence && !safeBareSequence) return;
      var cluster = entries.map(function (entry) { return entry.scene; });
      if (hasOriginal) cluster = cluster.concat(groups[base] || []);
      if (cluster.length > 1) clusters.push(cluster);
    });
    return clusters;
  }

  function sceneHasVariantNeighborhoodEvidence(scene) {
    if (scene && Array.isArray(scene.variantTokens) && scene.variantTokens.length) return true;
    if (scene && Array.isArray(scene.parentSignals) && scene.parentSignals.length) return true;
    return variantTokens(scenePathText(scene)).length > 0 ||
      canonicalParentInfo(scene).labels.length > 0;
  }

  function findScenesForVariantIdentity(identity, runtime) {
    var terms = [];
    if (identity && identity.artistLabel) terms.push(identity.artistLabel);
    asArray(identity && identity.characterLabels).forEach(function (label) { terms.push(label); });
    if (!terms.length) return [];
    var res = gqlDo(FIND_SCENES, {
      filter: { q: terms.join(" "), page: 1, per_page: 500, sort: "id", direction: "ASC" }
    }, runtime, "FindVariantIdentityNeighborhood");
    return asArray(res && res.findScenes && res.findScenes.scenes);
  }

  function partitionDuplicateNeighborhood(rawScenes, cfg) {
    var scenes = [];
    var seen = {};
    asArray(rawScenes).forEach(function (scene) {
      if (!scene || scene.id === undefined || scene.id === null || seen[String(scene.id)]) return;
      seen[String(scene.id)] = true;
      scenes.push(scene);
    });
    scenes.sort(function (a, b) {
      var af = firstFile(a);
      var bf = firstFile(b);
      var durationDiff = (Number(af.duration) || 0) - (Number(bf.duration) || 0);
      if (Math.abs(durationDiff) > 0.001) return durationDiff;
      return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    });
    var partitions = [];
    scenes.forEach(function (scene) {
      var selected = null;
      for (var i = 0; i < partitions.length; i++) {
        if (partitions[i].every(function (member) {
          return duplicateNeighborhoodCompatibility(member, scene, cfg).compatible;
        })) {
          selected = partitions[i];
          break;
        }
      }
      if (selected) selected.push(scene);
      else partitions.push([scene]);
    });
    return partitions.filter(function (partition) { return partition.length > 1; });
  }

  function duplicateSupportedNeighborhoodFamilies(anchorFamilies, cfg, runtime, sceneCache) {
    var out = [];
    var searchCache = {};
    var processed = {};
    asArray(anchorFamilies).forEach(function (family, index) {
      if (!family || !family.evidence || !family.evidence.stashDuplicateCluster) return;
      var identity = family.identity || {};
      if (!identity.artistKey || !identity.characterKey) return;
      if (!asArray(family.members).some(sceneHasVariantNeighborhoodEvidence)) return;
      var stems = {};
      asArray(family.members).forEach(function (member) {
        var stem = member.familyStem || terminalVariantNumberInfo(member.filenameStem || "").base;
        if (stem) stems[stem] = true;
      });
      Object.keys(stems).forEach(function (stem) {
        var familyKey = identity.artistKey + "|" + identity.characterKey + "|" + stem;
        if (processed[familyKey]) return;
        processed[familyKey] = true;
        var identityKey = identity.artistKey + "|" + identity.characterKey;
        if (!searchCache[identityKey]) {
          try {
            searchCache[identityKey] = findScenesForVariantIdentity(identity, runtime);
          } catch (err) {
            searchCache[identityKey] = [];
            logLine("WARN", "variant identity neighborhood unavailable for " + identityKey + ": " +
              String(err && err.message || err), runtime);
          }
        }
        var exactMatches = searchCache[identityKey].filter(function (scene) {
          var candidateIdentity = sceneVariantIdentity(scene);
          if (candidateIdentity.artistKey !== identity.artistKey || !identityCompatible(candidateIdentity, identity)) return false;
          return familyStemForScene(scene) === stem;
        });
        var anchorScenes = exactMatches.filter(function (scene) {
          return asArray(family.members).some(function (member) { return String(member.sceneId) === String(scene.id); });
        });
        exactMatches = exactMatches.filter(function (scene) {
          if (anchorScenes.some(function (anchor) { return String(anchor.id) === String(scene.id); })) return true;
          if (sceneHasVariantNeighborhoodEvidence(scene)) return true;
          var distance = minimumPHashDistanceToScenes(scene, anchorScenes);
          return distance !== null && distance <= 12;
        });
        var hasAnchor = exactMatches.some(function (scene) {
          return asArray(family.members).some(function (member) { return String(member.sceneId) === String(scene.id); });
        });
        if (!hasAnchor) return;
        partitionDuplicateNeighborhood(exactMatches, cfg).forEach(function (partition, partitionIndex) {
          if (!partition.some(sceneHasVariantNeighborhoodEvidence)) return;
          partition.forEach(function (scene) { sceneCache[String(scene.id)] = scene; });
          var expanded = buildVariantFamily(partition, "duplicate_neighborhood", cfg, index + ":" + partitionIndex);
          if (expanded) out.push(expanded);
        });
      });
    });
    return out;
  }

  function findAllScenesForVariantDiscovery(runtime, sceneCache) {
    var scenes = [];
    var page = 1;
    var perPage = 500;
    while (true) {
      var res = gqlDo(FIND_SCENES, {
        filter: { page: page, per_page: perPage, sort: "id", direction: "ASC" }
      }, runtime, "FindAllScenesForVariantDiscovery");
      var root = res && res.findScenes || {};
      var batch = asArray(root.scenes);
      batch.forEach(function (scene) {
        scenes.push(scene);
        sceneCache[String(scene.id)] = scene;
      });
      if (batch.length < perPage || scenes.length >= (Number(root.count) || scenes.length)) break;
      page++;
    }
    return scenes;
  }

  function descriptorSignalCount(scene) {
    var count = variantTokens(scenePathText(scene)).length;
    if (canonicalParentInfo(scene).labels.length) count++;
    return count;
  }

  function minimumPHashDistance(scenes) {
    var minimum = null;
    for (var i = 0; i < scenes.length; i++) {
      for (var j = i + 1; j < scenes.length; j++) {
        var distance = hexHammingDistance(fingerprintValue(scenes[i], "phash"), fingerprintValue(scenes[j], "phash"));
        if (distance !== null && (minimum === null || distance < minimum)) minimum = distance;
      }
    }
    return minimum;
  }

  function minimumPHashDistanceToScenes(scene, references) {
    var minimum = null;
    asArray(references).forEach(function (reference) {
      var distance = hexHammingDistance(fingerprintValue(scene, "phash"), fingerprintValue(reference, "phash"));
      if (distance !== null && (minimum === null || distance < minimum)) minimum = distance;
    });
    return minimum;
  }

  function descriptorVariantFamilies(scenes, cfg) {
    var groups = {};
    asArray(scenes).forEach(function (scene) {
      var identity = sceneVariantIdentity(scene);
      if (!identity.artistKey || !identity.characterKey || !identity.filenameCharacterKey) return;
      var stem = familyStemForScene(scene);
      if (!stem || stem.length < 4) return;
      var key = identity.artistKey + "|" + identity.filenameCharacterKey + "|" + stem;
      if (!groups[key]) groups[key] = [];
      groups[key].push(scene);
    });

    var families = [];
    Object.keys(groups).forEach(function (key, groupIndex) {
      var signaledGroupScenes = groups[key].filter(function (scene) { return descriptorSignalCount(scene) > 0; });
      var eligibleGroupScenes = groups[key].filter(function (scene) {
        if (descriptorSignalCount(scene) > 0) return true;
        if (!numericVariantInfo(scene).hasNumber) return true;
        var distance = minimumPHashDistanceToScenes(scene, signaledGroupScenes);
        return distance !== null && distance <= 12;
      });
      partitionDuplicateNeighborhood(eligibleGroupScenes, cfg).forEach(function (partition, partitionIndex) {
        if (partition.length < 2) return;
        var signaledScenes = partition.filter(function (scene) { return descriptorSignalCount(scene) > 0; });
        var minimumDistance = minimumPHashDistance(partition);
        var hasConstrainedPHashSupport = minimumDistance !== null && minimumDistance <= 12;
        if (signaledScenes.length < 2 && !(signaledScenes.length >= 1 && hasConstrainedPHashSupport)) return;
        var family = buildVariantFamily(partition, "descriptor_family", cfg, groupIndex + ":" + partitionIndex);
        if (!family) return;
        family.evidence.minimumPHashDistance = minimumDistance;
        family.evidence.constrainedPHashSupport = hasConstrainedPHashSupport;
        family.evidence.descriptorSceneIds = signaledScenes.map(function (scene) { return String(scene.id); });
        family.status = "review";
        families.push(family);
      });
    });
    return families;
  }

  function compareParentMembers(a, b) {
    var ar = Number(a.parentPreferenceRank) || 0;
    var br = Number(b.parentPreferenceRank) || 0;
    if ((ar >= 3 || br >= 3) && ar !== br) return br - ar;
    if (!!a.isCanonicalOriginal !== !!b.isCanonicalOriginal) return a.isCanonicalOriginal ? -1 : 1;
    if (!!a.hasExplicitNumber !== !!b.hasExplicitNumber) return a.hasExplicitNumber ? 1 : -1;
    if (a.hasExplicitNumber && b.hasExplicitNumber && Number(a.variantNumber) !== Number(b.variantNumber)) {
      return Number(a.variantNumber) - Number(b.variantNumber);
    }
    var scoreDiff = Number(b.parentScore || 0) - Number(a.parentScore || 0);
    if (Math.abs(scoreDiff) > 0.000001) return scoreDiff;
    return String(a.sceneId).localeCompare(String(b.sceneId), undefined, { numeric: true });
  }

  function combineFamilyGroup(group, cfg) {
    var memberMap = {};
    var hasDuplicate = false;
    var hasFilename = false;
    var hasDuplicateNeighborhood = false;
    var hasDescriptorFamily = false;
    var minimumPHashDistanceValue = null;
    var duplicateIndexes = [];
    var filenameSimilarityScore = 0;
    var metadataOverlapScore = 0;
    var confidence = 0;
    var identity = {};
    group.forEach(function (family) {
      var evidence = family.evidence || {};
      hasDuplicate = hasDuplicate || !!evidence.stashDuplicateCluster;
      hasDuplicateNeighborhood = hasDuplicateNeighborhood || !!evidence.duplicateNeighborhood;
      hasDescriptorFamily = hasDescriptorFamily || !!evidence.descriptorFamily;
      if (evidence.minimumPHashDistance !== null && evidence.minimumPHashDistance !== undefined) {
        minimumPHashDistanceValue = minimumPHashDistanceValue === null
          ? Number(evidence.minimumPHashDistance)
          : Math.min(minimumPHashDistanceValue, Number(evidence.minimumPHashDistance));
      }
      hasFilename = hasFilename || evidence.source === "filename" || evidence.source === "combined";
      if (evidence.duplicateClusterIndex !== null && evidence.duplicateClusterIndex !== undefined) duplicateIndexes.push(evidence.duplicateClusterIndex);
      asArray(evidence.duplicateClusterIndexes).forEach(function (value) { duplicateIndexes.push(value); });
      filenameSimilarityScore = Math.max(filenameSimilarityScore, Number(evidence.filenameSimilarity) || 0);
      metadataOverlapScore = Math.max(metadataOverlapScore, Number(evidence.metadataOverlap) || 0);
      confidence = Math.max(confidence, Number(family.confidence) || 0);
      identity = mergeIdentity(identity, family.identity || {});
      asArray(family.members).forEach(function (member) {
        var id = String(member.sceneId);
        if (!memberMap[id]) memberMap[id] = member;
        else {
          memberMap[id].isCanonicalOriginal = !!memberMap[id].isCanonicalOriginal || !!member.isCanonicalOriginal;
          if (Number(member.parentScore) > Number(memberMap[id].parentScore)) memberMap[id].parentScore = member.parentScore;
        }
      });
    });
    var members = Object.keys(memberMap).map(function (id) { return memberMap[id]; });
    members.sort(compareParentMembers);
    filenameSimilarityScore = averagePairScore(members, function (a, b) {
      return stemSimilarity(a.filenameStem, b.filenameStem);
    });
    var primary = members[0];
    members.forEach(function (member) {
      var isPrimary = String(member.sceneId) === String(primary.sceneId);
      member.role = isPrimary ? "parent" : "child";
      if (isPrimary) member.label = "Primary";
      else if (!member.label || member.label === "Primary") member.label = (member.variantTokens && member.variantTokens[0]) || "Variant";
    });
    var sceneIds = members.map(function (member) { return String(member.sceneId); });
    var evidence = {
      stashDuplicateCluster: hasDuplicate,
      duplicateNeighborhood: hasDuplicateNeighborhood,
      descriptorFamily: hasDescriptorFamily,
      source: hasDuplicateNeighborhood ? "duplicate_neighborhood" :
        (hasDescriptorFamily ? "descriptor_family" :
          (hasDuplicate && hasFilename ? "combined" : (hasDuplicate ? "stash_duplicate" : "filename"))),
      duplicateClusterIndex: duplicateIndexes.length ? duplicateIndexes[0] : null,
      duplicateClusterIndexes: uniq(duplicateIndexes.map(String)).map(Number),
      filenameSimilarity: filenameSimilarityScore,
      metadataOverlap: metadataOverlapScore,
      sceneIds: sceneIds
    };
    if (minimumPHashDistanceValue !== null) {
      evidence.minimumPHashDistance = minimumPHashDistanceValue;
      evidence.constrainedPHashSupport = minimumPHashDistanceValue <= 12;
    }
    Object.assign(evidence, familyMediaEvidence(members, cfg));
    confidence = familyConfidence(members, evidence, cfg);
    confidence = Math.round(Math.min(1, confidence) * 1000) / 1000;
    var status = familyStatus(confidence, cfg);
    if ((hasDuplicateNeighborhood || hasDescriptorFamily) && status !== "ignore") status = "review";
    if (status === "auto_suggest" && (!identity.artistKey || !identity.characterKey)) status = "review";
    evidence.identityVerified = !!identity.artistKey && !!identity.characterKey;
    return {
      familyId: familyIdFor(sceneIds),
      status: status,
      confidence: confidence,
      proposedPrimaryId: String(primary.sceneId),
      members: members,
      evidence: evidence,
      identity: identity
    };
  }

  function mergeFamilies(families, cfg) {
    var eligible = asArray(families).filter(function (family) { return family && family.members && family.members.length > 1; });
    var parent = eligible.map(function (_, index) { return index; });
    function find(index) {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    }
    function union(a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    var owner = {};
    eligible.forEach(function (family, familyIndex) {
      family.members.forEach(function (member) {
        var id = String(member.sceneId);
        if (!owner[id]) owner[id] = [];
        owner[id].forEach(function (priorIndex) {
          if (identityCompatible(family.identity, eligible[priorIndex].identity)) union(familyIndex, priorIndex);
        });
        owner[id].push(familyIndex);
      });
    });
    var groups = {};
    eligible.forEach(function (family, index) {
      var root = String(find(index));
      if (!groups[root]) groups[root] = [];
      groups[root].push(family);
    });
    return Object.keys(groups).map(function (root) { return combineFamilyGroup(groups[root], cfg); }).sort(function (a, b) {
      if (a.status !== b.status) {
        var rank = { auto_suggest: 0, review: 1, ignore: 2 };
        return rank[a.status] - rank[b.status];
      }
      return b.confidence - a.confidence;
    });
  }

  function memberExistingPrimaryId(member) {
    var summary = String(member && member.existingVariant || "");
    if (summary === "primary") return String(member.sceneId);
    var match = summary.match(/^variant_of_(.+)$/);
    return match ? String(match[1]) : "";
  }

  function chooseExistingPrimary(family) {
    var counts = {};
    var primarySeen = {};
    asArray(family && family.members).forEach(function (member) {
      var primaryId = memberExistingPrimaryId(member);
      if (!primaryId) return;
      counts[primaryId] = (counts[primaryId] || 0) + 1;
      if (String(member.existingVariant) === "primary") primarySeen[primaryId] = true;
    });
    var ids = Object.keys(counts);
    ids.sort(function (a, b) {
      if (counts[a] !== counts[b]) return counts[b] - counts[a];
      if (!!primarySeen[a] !== !!primarySeen[b]) return primarySeen[a] ? -1 : 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
    return {
      primaryId: ids[0] || "",
      primaryIds: ids,
      ambiguous: ids.length > 1 && counts[ids[0]] === counts[ids[1]]
    };
  }

  function actionableCandidateFamilies(families, cfg, runtime, sceneCache) {
    var suppressedExisting = 0;
    var suppressedSingletons = 0;
    var cache = sceneCache || {};

    function cachedScene(id) {
      var key = String(id);
      if (!cache[key]) {
        try {
          cache[key] = findScene(key, runtime);
        } catch (err) {
          logLine("WARN", "candidate family context unavailable for scene " + key + ": " + String(err && err.message || err), runtime);
          return null;
        }
      }
      return cache[key];
    }

    var shaped = [];
    asArray(families).forEach(function (family) {
      var unassigned = asArray(family.members).filter(function (member) {
        return !memberExistingPrimaryId(member);
      });
      var target = chooseExistingPrimary(family);

      if (!target.primaryId) {
        if (!unassigned.length) {
          suppressedExisting++;
          return;
        }
        if (unassigned.length < 2) {
          suppressedSingletons++;
          return;
        }
        family.members = unassigned;
        family.proposedPrimaryId = String((preferredMember(unassigned) || {}).sceneId || family.proposedPrimaryId);
        family.members.forEach(function (member) {
          var isPrimary = String(member.sceneId) === String(family.proposedPrimaryId);
          member.role = isPrimary ? "parent" : "child";
          member.relationshipState = "unassigned";
          if (isPrimary) member.label = "Primary";
        });
        family.familyId = familyIdFor(unassigned.map(function (member) { return member.sceneId; }));
        family.evidence.candidateType = "new_family";
        family.evidence.candidateSceneIds = unassigned.map(function (member) { return String(member.sceneId); });
        family.evidence.existingFamilySceneIds = [];
        family.evidence.existingFamilyPrimaryId = "";
        family.evidence.sceneIds = family.evidence.candidateSceneIds.slice();
        shaped.push(family);
        return;
      }

      var existingSceneMap = {};
      target.primaryIds.forEach(function (primaryId) {
        var primaryScene = cachedScene(primaryId);
        if (!primaryScene) return;
        existingSceneMap[String(primaryScene.id)] = primaryScene;
        variantChildren(primaryScene).forEach(function (childId) {
          var childScene = cachedScene(childId);
          if (childScene) existingSceneMap[String(childScene.id)] = childScene;
        });
      });
      var existingScenes = Object.keys(existingSceneMap).map(function (id) { return existingSceneMap[id]; });
      if (!existingScenes.length) {
        suppressedSingletons++;
        return;
      }
      var expectedStems = {};
      asArray(family.members).forEach(function (member) {
        if (member.familyStem) expectedStems[String(member.familyStem)] = true;
      });
      var matchingExistingScenes = existingScenes.filter(function (scene) {
        var identity = sceneVariantIdentity(scene);
        return identityCompatible(identity, family.identity) && !!expectedStems[familyStemForScene(scene)];
      });
      var matchingExistingIds = {};
      matchingExistingScenes.forEach(function (scene) { matchingExistingIds[String(scene.id)] = true; });
      var excludedExistingScenes = existingScenes.filter(function (scene) {
        return !matchingExistingIds[String(scene.id)];
      });
      var familyMemberIds = {};
      asArray(family.members).forEach(function (member) { familyMemberIds[String(member.sceneId)] = true; });
      matchingExistingScenes = matchingExistingScenes.filter(function (scene) {
        return !!familyMemberIds[String(scene.id)];
      });
      var candidateScenes = unassigned.map(function (member) {
        return cachedScene(member.sceneId);
      }).filter(Boolean);
      var originalIds = canonicalOriginalIds(matchingExistingScenes.concat(candidateScenes));
      var existingMembers = matchingExistingScenes.map(function (scene) {
        var member = variantMemberForScene(scene, target.primaryId, originalIds);
        member.relationshipState = target.primaryIds.indexOf(String(scene.id)) !== -1 ? "existing_primary" : "existing_child";
        return member;
      });
      var existingIds = {};
      existingMembers.forEach(function (member) { existingIds[String(member.sceneId)] = true; });
      var candidateMembers = unassigned.filter(function (member) {
        return !existingIds[String(member.sceneId)];
      }).map(function (member) {
        member.relationshipState = "proposed_addition";
        member.role = "child";
        if (!member.label || member.label === "Primary") member.label = (member.variantTokens && member.variantTokens[0]) || "Variant";
        return member;
      });
      var repairMembers = existingMembers.concat(candidateMembers);
      var needsSplitRepair = excludedExistingScenes.length > 0 && existingMembers.length > 0;
      if (!candidateMembers.length && !needsSplitRepair) {
        suppressedExisting++;
        return;
      }
      if (repairMembers.length < 2) {
        suppressedSingletons++;
        return;
      }

      family.members = repairMembers;
      var recommended = preferredMember(family.members);
      var recommendedId = String(recommended && recommended.sceneId || target.primaryId);
      var candidateType = "attach_to_existing";
      if (needsSplitRepair) candidateType = "split_existing_family";
      else if (target.primaryIds.length > 1) candidateType = "merge_existing_families";
      else if (recommendedId !== String(target.primaryId)) candidateType = "replace_existing_primary";
      family.proposedPrimaryId = candidateType === "attach_to_existing" ? String(target.primaryId) : recommendedId;
      family.members.forEach(function (member) {
        var isPrimary = String(member.sceneId) === String(family.proposedPrimaryId);
        member.role = isPrimary ? "parent" : "child";
        if (isPrimary) member.label = "Primary";
        else if (!member.label || member.label === "Primary") member.label = (member.variantTokens && member.variantTokens[0]) || "Variant";
      });
      var familyIdMembers = candidateType === "split_existing_family" ? family.members : candidateMembers;
      family.familyId = "nsv2-existing-" + target.primaryIds.slice().sort(function (a, b) {
        return a.localeCompare(b, undefined, { numeric: true });
      }).join("-") + "-add-" + familyIdMembers.map(function (member) {
        return String(member.sceneId);
      }).sort(function (a, b) {
        return a.localeCompare(b, undefined, { numeric: true });
      }).join("-");
      family.evidence.candidateType = candidateType;
      family.evidence.candidateSceneIds = candidateMembers.map(function (member) { return String(member.sceneId); });
      family.evidence.existingFamilySceneIds = existingMembers.map(function (member) { return String(member.sceneId); });
      family.evidence.existingFamilyPrimaryId = String(target.primaryId);
      family.evidence.existingFamilyPrimaryIds = target.primaryIds.map(String);
      family.evidence.excludedExistingFamilySceneIds = excludedExistingScenes.map(function (scene) { return String(scene.id); });
      family.evidence.replaceExistingChildren = candidateType === "split_existing_family";
      family.evidence.approvalSceneIds = candidateType === "attach_to_existing"
        ? family.evidence.candidateSceneIds.slice()
        : family.members.filter(function (member) {
          return String(member.sceneId) !== String(family.proposedPrimaryId);
        }).map(function (member) { return String(member.sceneId); });
      family.evidence.matchedSceneIds = asArray(family.evidence.sceneIds).map(String);
      family.evidence.sceneIds = family.members.map(function (member) { return String(member.sceneId); });
      family.evidence.alternateExistingFamilyPrimaryIds = target.primaryIds.filter(function (id) {
        return String(id) !== String(target.primaryId);
      });
      if (candidateType !== "attach_to_existing" || target.ambiguous || family.evidence.alternateExistingFamilyPrimaryIds.length) family.status = "review";
      shaped.push(family);
    });

    return {
      families: shaped,
      suppressedExisting: suppressedExisting,
      suppressedSingletons: suppressedSingletons
    };
  }

  function preferredMember(members) {
    var sorted = asArray(members).slice().sort(compareParentMembers);
    return sorted[0] || null;
  }

  function discoverVariantCandidates(options, runtime) {
    var cfg = mergeConfig(options || {});
    var families = [];
    var clusters = [];
    var sceneCache = {};
    try {
      clusters = findDuplicateVariantClusters(cfg, runtime);
      clusters.forEach(function (cluster, index) {
        asArray(cluster).forEach(function (scene) { sceneCache[String(scene.id)] = scene; });
        partitionVariantCluster(cluster, cfg).forEach(function (partition) {
          var family = buildVariantFamily(partition.scenes, "stash_duplicate", cfg, index);
          if (family) families.push(family);
        });
      });
    } catch (err) {
      logLine("WARN", "duplicate scene discovery unavailable: " + String(err && err.message || err), runtime);
    }

    if (cfg.variantFilenameHeuristics) {
      var filenameScenes = [];
      var seenFilenameSceneIds = {};
      clusters.forEach(function (cluster) {
        asArray(cluster).forEach(function (scene) {
          var id = String(scene.id);
          if (!seenFilenameSceneIds[id]) {
            seenFilenameSceneIds[id] = true;
            filenameScenes.push(scene);
          }
        });
      });
      filenameVariantClusters(filenameScenes).forEach(function (cluster, index) {
        partitionVariantCluster(cluster, cfg).forEach(function (partition) {
          var family = buildVariantFamily(partition.scenes, "filename", cfg, index);
          if (family && family.status !== "ignore") families.push(family);
        });
      });

      try {
        descriptorVariantFamilies(findAllScenesForVariantDiscovery(runtime, sceneCache), cfg).forEach(function (family) {
          families.push(family);
        });
      } catch (descriptorErr) {
        logLine("WARN", "descriptor family discovery unavailable: " +
          String(descriptorErr && descriptorErr.message || descriptorErr), runtime);
      }
    }

    duplicateSupportedNeighborhoodFamilies(families, cfg, runtime, sceneCache).forEach(function (family) {
      families.push(family);
    });
    families = mergeFamilies(families, cfg);
    var actionable = actionableCandidateFamilies(families, cfg, runtime, sceneCache);
    families = actionable.families.slice(0, cfg.variantDiscoveryLimit);
    logLine("INFO", "VARIANT_DISCOVERY families=" + families.length + " duplicateClusters=" + clusters.length +
      " suppressedExisting=" + actionable.suppressedExisting + " suppressedSingletons=" + actionable.suppressedSingletons +
      " dryRun=" + cfg.dryRun, runtime);
    return {
      result: "variant_candidates",
      schema_version: 2,
      dryRun: cfg.dryRun,
      generatedAt: nowIso(),
      settings: {
        distance: cfg.variantDiscoveryDistance,
        durationDiff: cfg.variantDiscoveryDurationDiff,
        limit: cfg.variantDiscoveryLimit,
        filenameHeuristics: cfg.variantFilenameHeuristics,
        metadataHeuristics: cfg.variantMetadataHeuristics,
        autoSuggestThreshold: cfg.variantAutoSuggestThreshold,
        reviewThreshold: cfg.variantReviewThreshold
      },
      suppressedExistingFamilies: actionable.suppressedExisting,
      suppressedSingletonSuggestions: actionable.suppressedSingletons,
      families: families
    };
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

  function parseApprovalsArg(args) {
    var raw = getArg(args, "approvals", null);
    if (raw === null || raw === undefined) raw = getArg(args, "approvalsJson", null);
    if (raw === null || raw === undefined) raw = getArg(args, "families", null);
    var parsed = parseJSONMaybe(raw, raw);
    if (parsed && parsed.approvals) parsed = parsed.approvals;
    if (parsed && parsed.families) parsed = parsed.families;
    if (!Array.isArray(parsed)) return [];
    return parsed;
  }

  function approvalPrimaryId(approval) {
    return String(approval.primarySceneId || approval.approvedPrimaryId || approval.proposedPrimaryId || "");
  }

  function approvalChildren(approval, primaryId) {
    var children = [];
    var rawChildren = approval.children || approval.approvedChildren || [];
    if (!rawChildren.length && approval.members) {
      rawChildren = approval.members.filter(function (member) {
        return String(member.sceneId) !== String(primaryId) && member.include !== false && member.approved !== false;
      });
    }
    asArray(rawChildren).forEach(function (child) {
      var id = String(child.sceneId || child.childSceneId || child.id || "");
      if (!id || id === String(primaryId) || child.include === false || child.approved === false) return;
      children.push({
        sceneId: id,
        label: String(child.label || child.variantLabel || "Variant")
      });
    });
    return children;
  }

  function applyOneVariantChild(primaryId, child, options, runtime) {
    var childScene = findScene(child.sceneId, runtime);
    var childCf = customFields(childScene);
    if (childCf.variant_role === "variant" && childCf.variant_parent_id && String(childCf.variant_parent_id) !== String(primaryId)) {
      return moveVariantToPrimary(child.sceneId, primaryId, Object.assign({}, options || {}, { label: child.label }), runtime);
    }
    return linkVariant(primaryId, child.sceneId, child.label, options, runtime);
  }

  function reconcileVariantFamily(primaryId, children, options, runtime) {
    var cfg = mergeConfig(options || {});
    var replaceExistingChildren = coerceBool(getArg(options, "replaceExistingChildren", false), false);
    var primary = findScene(primaryId, runtime);
    var initialPrimaryChildren = variantChildren(primary);
    var childMap = {};
    asArray(children).forEach(function (child) {
      if (!child || !child.sceneId || String(child.sceneId) === String(primaryId)) return;
      childMap[String(child.sceneId)] = {
        sceneId: String(child.sceneId),
        label: String(child.label || "Variant")
      };
    });

    if (!replaceExistingChildren) {
      initialPrimaryChildren.forEach(function (childId) {
        if (!childMap[String(childId)]) childMap[String(childId)] = { sceneId: String(childId), label: "Variant" };
      });
    }

    var loaded = {};
    function load(id) {
      var key = String(id);
      if (!loaded[key]) loaded[key] = findScene(key, runtime);
      return loaded[key];
    }
    loaded[String(primary.id)] = primary;

    Object.keys(childMap).forEach(function (childId) {
      var childScene = load(childId);
      var childCf = customFields(childScene);
      if (childCf.variant_label && childMap[childId].label === "Variant") {
        childMap[childId].label = String(childCf.variant_label);
      }
      if (childCf.variant_role === "primary") {
        variantChildren(childScene).forEach(function (grandchildId) {
          if (!childMap[String(grandchildId)] && String(grandchildId) !== String(primaryId)) {
            childMap[String(grandchildId)] = { sceneId: String(grandchildId), label: "Variant" };
          }
        });
      }
    });

    var childIds = Object.keys(childMap).sort(function (a, b) {
      return a.localeCompare(b, undefined, { numeric: true });
    });
    childIds.forEach(load);
    var desired = {};
    childIds.forEach(function (id) { desired[String(id)] = true; });
    var affectedParents = {};
    [primary].concat(childIds.map(function (id) { return loaded[id]; })).forEach(function (scene) {
      var cf = customFields(scene);
      if (cf.variant_role === "variant" && cf.variant_parent_id && String(cf.variant_parent_id) !== String(primaryId)) {
        affectedParents[String(cf.variant_parent_id)] = true;
      }
    });
    childIds.forEach(function (id) {
      var scene = loaded[id];
      if (customFields(scene).variant_role === "primary" && String(id) !== String(primaryId)) affectedParents[String(id)] = true;
    });

    if (cfg.dryRun) {
      return {
        result: "dry_run",
        primaryId: String(primaryId),
        children: childIds,
        replacedPrimaryIds: Object.keys(affectedParents),
        removedChildIds: replaceExistingChildren ? initialPrimaryChildren.filter(function (id) { return !desired[String(id)]; }) : []
      };
    }

    Object.keys(affectedParents).forEach(function (parentId) {
      if (String(parentId) === String(primaryId) || desired[String(parentId)]) return;
      var oldParent = load(parentId);
      var remaining = variantChildren(oldParent).filter(function (childId) {
        return !desired[String(childId)] && String(childId) !== String(primaryId);
      });
      if (remaining.length) {
        updateSceneFields(oldParent.id, {
          variant_role: "primary",
          variant_set_id: customFields(oldParent).variant_set_id || variantSetIdFor(oldParent.id),
          variant_children: encodeChildren(remaining, cfg)
        }, [], runtime, false);
      } else {
        updateSceneFields(oldParent.id, {}, ["variant_role", "variant_set_id", "variant_children"], runtime, false);
      }
    });

    var setId = customFields(primary).variant_set_id || variantSetIdFor(primary.id);
    updateSceneFields(primary.id, {
      variant_role: "primary",
      variant_set_id: setId,
      variant_children: encodeChildren(childIds, cfg)
    }, ["variant_parent_id", "variant_label", "variant_sort_index"], runtime, false);
    removeHiddenTag(primary, cfg, runtime);

    if (replaceExistingChildren) {
      initialPrimaryChildren.filter(function (id) { return !desired[String(id)]; }).forEach(function (childId) {
        var excludedChild = load(childId);
        var excludedCf = customFields(excludedChild);
        if (excludedCf.variant_role === "variant" && String(excludedCf.variant_parent_id || "") === String(primary.id)) {
          updateSceneFields(childId, {}, ["variant_role", "variant_set_id", "variant_parent_id", "variant_label", "variant_sort_index"], runtime, false);
          removeHiddenTag(excludedChild, cfg, runtime);
        }
      });
    }

    var summary = emptySummary();
    childIds.forEach(function (childId, index) {
      var childScene = loaded[childId];
      updateSceneFields(childId, {
        variant_role: "variant",
        variant_set_id: setId,
        variant_parent_id: String(primary.id),
        variant_label: childMap[childId].label,
        variant_sort_index: String(index + 1)
      }, ["variant_children"], runtime, false);
      addHiddenTag(childScene, cfg, runtime, summary);
      updateSceneMetadataIfMissing(childScene, primary, cfg, runtime);
    });
    logLine("INFO", "VARIANT_RECONCILE primary=" + primary.id + " children=" + childIds.length +
      " replacedPrimaries=" + Object.keys(affectedParents).join("|") + " dryRun=false", runtime);
    return {
      result: "reconciled",
      primaryId: String(primary.id),
      children: childIds,
      replacedPrimaryIds: Object.keys(affectedParents)
    };
  }

  function applyVariantBatch(options, runtime) {
    var cfg = mergeConfig(options || {});
    var approvals = parseApprovalsArg(options || {});
    var confirmed = coerceBool(getArg(options, "confirmed", false), false);
    if (!cfg.dryRun && !confirmed) {
      throw new Error("Live variant batch apply requires confirmed=true");
    }
    var result = {
      result: cfg.dryRun ? "dry_run" : "applied",
      dryRun: cfg.dryRun,
      families: 0,
      links: 0,
      failures: [],
      operations: []
    };

    approvals.forEach(function (approval) {
      if (!approval || approval.approved === false || approval.status === "ignored" || approval.status === "ignore") return;
      var primaryId = approvalPrimaryId(approval);
      var children = approvalChildren(approval, primaryId);
      if (!primaryId || !children.length) return;
      result.families++;
      try {
        var applied = reconcileVariantFamily(primaryId, children, Object.assign({}, options || {}, {
          replaceExistingChildren: approval.replaceExistingChildren === true
        }), runtime);
        result.links += children.length;
        children.forEach(function (child) {
          result.operations.push({
            familyId: String(approval.familyId || ""),
            primarySceneId: String(primaryId),
            childSceneId: String(child.sceneId),
            label: child.label,
            result: applied && applied.result || (cfg.dryRun ? "dry_run" : "reconciled")
          });
        });
      } catch (err) {
        result.failures.push({
          familyId: String(approval.familyId || ""),
          primarySceneId: String(primaryId),
          childSceneId: "",
          error: String(err && err.message || err)
        });
      }
    });

    logLine("INFO", "VARIANT_BATCH_APPLY families=" + result.families + " links=" + result.links + " failures=" + result.failures.length + " dryRun=" + cfg.dryRun, runtime);
    return result;
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
    if (mode === "discover_variant_candidates") return discoverVariantCandidates(args, runtime);
    if (mode === "preview_variant_batch") return applyVariantBatch(Object.assign({}, args || {}, { dryRun: true }), runtime);
    if (mode === "apply_variant_batch") return applyVariantBatch(args, runtime);
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

  var GET_SCENE = "query FindSceneForMetadataVariants($id: ID!) { findScene(id: $id) { id title details custom_fields studio { id name aliases } groups { group { id name aliases } scene_index } tags { id name aliases parents { id name } } files { path basename width height duration fingerprints { type value } } paths { screenshot preview webp vtt sprite } } }";
  var FIND_SCENES = "query FindScenesForMetadataVariants($filter: FindFilterType) { findScenes(filter: $filter) { count scenes { id title details custom_fields studio { id name } groups { group { id name aliases } scene_index } tags { id name aliases } files { path basename width height duration fingerprints { type value } } paths { screenshot preview webp vtt sprite } } } }";
  var FIND_SCENES_WITH_CUSTOM_FIELDS = "query FindScenesWithCustomFields($filter: FindFilterType) { findScenes(filter: $filter) { count scenes { id title custom_fields tags { id name } } } }";
  var FIND_DUPLICATE_SCENES = "query FindDuplicateScenesForMetadataVariants($distance: Int, $duration_diff: Float) { findDuplicateScenes(distance: $distance, duration_diff: $duration_diff) { id title details custom_fields studio { id name } groups { group { id name aliases } scene_index } tags { id name aliases } files { path basename width height duration fingerprints { type value } } paths { screenshot preview webp vtt sprite } } }";
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
    discoverVariantCandidates: discoverVariantCandidates,
    applyVariantBatch: applyVariantBatch,
    validateVariantGraph: validateVariantGraph,
    rollbackVariantData: rollbackVariantData,
    dispatch: dispatch,
    _test: {
      customFields: customFields,
      variantChildren: variantChildren,
      encodeChildren: encodeChildren,
      currentSceneState: currentSceneState,
      sceneVariantIdentity: sceneVariantIdentity,
      identityCompatible: identityCompatible,
      partitionVariantCluster: partitionVariantCluster,
      canonicalParentInfo: canonicalParentInfo,
      normalizedVariantStem: normalizedVariantStem,
      terminalVariantNumberInfo: terminalVariantNumberInfo,
      filenameSimilarity: filenameSimilarity,
      sceneMediaCompatibility: sceneMediaCompatibility,
      duplicateNeighborhoodCompatibility: duplicateNeighborhoodCompatibility,
      partitionDuplicateNeighborhood: partitionDuplicateNeighborhood,
      metadataSimilarity: metadataSimilarity,
      parentScore: parentScore,
      actionableCandidateFamilies: actionableCandidateFamilies,
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
  // Stash's JS interface reads only the final value's Output property.
  SceneMetadataVariantsOutput = { Output: SceneMetadataVariants.main() };
}

SceneMetadataVariantsOutput;
