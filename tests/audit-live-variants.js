const fs = require("fs");
const path = require("path");

const STASH_URL = process.env.STASH_URL || "http://127.0.0.1:9999/graphql";
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.env.TEMP || ".", "scene-variant-audit");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function customFields(scene) {
  return scene && scene.custom_fields && typeof scene.custom_fields === "object" ? scene.custom_fields : {};
}

function variantChildren(scene) {
  const raw = customFields(scene).variant_children;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch (_) {
    // Fall through to legacy delimited storage.
  }
  return raw.split(/[,\s|]+/).filter(Boolean).map(String);
}

function basename(scene) {
  const file = asArray(scene.files)[0] || {};
  return String(file.basename || file.path || scene.title || `Scene ${scene.id}`).split(/[\\/]/).pop();
}

function standardizedParts(scene) {
  return basename(scene)
    .replace(/\.[^.]+$/, "")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+[-\u2013\u2014]\s+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function aliases(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[|,;\r\n]+/).map(x => x.trim()).filter(Boolean);
  return [];
}

function objectMatchesText(obj, text) {
  if (!obj || !obj.name) return false;
  const haystack = ` ${normalize(text)} `;
  return [obj.name, ...aliases(obj.aliases)].some(name => {
    const key = normalize(name);
    return key && haystack.includes(` ${key} `);
  });
}

function sceneIdentity(scene) {
  const parts = standardizedParts(scene);
  const filenameArtist = parts.length >= 2 ? parts[0] : "";
  const groups = asArray(scene.groups).map(entry => entry && entry.group).filter(Boolean);
  const matchedGroup = groups.find(group => objectMatchesText(group, filenameArtist));
  const artist = matchedGroup || (groups.length === 1 ? groups[0] : null);
  const artistLabel = artist && artist.name || filenameArtist;

  const filenameCharacters = parts.length >= 2 ? parts[1] : "";
  const usableTags = asArray(scene.tags).filter(tag => {
    const key = normalize(tag && tag.name);
    return key && !key.includes("variant hidden") && !key.includes("needs review");
  });
  let matchingTags = usableTags.filter(tag => objectMatchesText(tag, filenameCharacters));
  if (!matchingTags.length && usableTags.length === 1) matchingTags = usableTags;
  const characterLabels = matchingTags.length
    ? matchingTags.map(tag => tag.name)
    : (parts.length >= 3
      ? String(filenameCharacters).split(/\s*(?:,|\+|&|\band\b)\s*/i).filter(Boolean)
      : []);
  const characterKeys = [...new Set(characterLabels.map(normalize).filter(Boolean))].sort();
  let filenameCharacterKey = normalize(filenameCharacters);
  if (parts.length === 2) {
    filenameCharacterKey = filenameCharacterKey
      .replace(/\bv\s*\d{1,3}\b/g, " ")
      .replace(/\s+\d{1,3}$/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return {
    artistKey: normalize(artistLabel),
    artistLabel,
    characterKey: characterKeys.join("|"),
    characterLabels,
    filenameCharacterKey
  };
}

const DESCRIPTOR_PATTERNS = [
  /\b(?:std|standard|default|regular|normal|vanilla)\b/gi,
  /\b(?:alt|alternate|alternative)(?:\s+(?:angle|angles))?(?:\s*\d+)?\b/gi,
  /\b(?:bonus|loop|preview|clip|angle|camera|cam|scene|part)(?:\s*\d+)?\b/gi,
  /\b(?:nude|clothed|switched|vertical|portrait|phone|pov|cropped|crop)\b/gi,
  /\b(?:watermarked|watermark|censored|silent|muted|no\s+logo|nologo)\b/gi,
  /\b(?:rev|revision)\s*\d+\b/gi,
  /\b(?:full|complete|uncut|original|base|main)\b/gi
];

function descriptorInfo(scene, identity) {
  const parts = standardizedParts(scene);
  if (parts.length < 2) return null;
  let rawTail = parts.length >= 3 ? parts.slice(2).join(" - ") : "";
  if (parts.length === 2 && identity && identity.characterLabels.length) {
    const characterPart = normalize(parts[1]);
    let remainder = characterPart;
    identity.characterLabels
      .map(normalize)
      .sort((a, b) => b.length - a.length)
      .forEach(label => {
        if (remainder === label) remainder = "";
        else if (remainder.startsWith(`${label} `)) remainder = remainder.slice(label.length).trim();
      });
    rawTail = remainder;
  }
  let core = normalize(rawTail);
  const descriptors = [];
  DESCRIPTOR_PATTERNS.forEach(pattern => {
    core = core.replace(pattern, match => {
      descriptors.push(normalize(match));
      return " ";
    });
  });
  core = core
    .replace(/\b(?:4k|2k|2160p|1440p|1080p|720p|uhd|hd)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const versionMatches = normalize(rawTail).match(/\bv\s*\d{1,3}\b/g) || [];
  const versions = [...new Set(versionMatches.map(value => value.replace(/\s+/g, "")))];
  const hasDescriptor = descriptors.length > 0;
  return {
    rawTail,
    core,
    versions,
    descriptors: [...new Set(descriptors)],
    hasDescriptor
  };
}

function media(scene) {
  const file = asArray(scene.files)[0] || {};
  const fingerprints = {};
  asArray(file.fingerprints).forEach(fp => {
    if (fp && fp.type && fp.value) fingerprints[normalize(fp.type)] = String(fp.value).toLowerCase();
  });
  return {
    duration: Number(file.duration) || 0,
    width: Number(file.width) || 0,
    height: Number(file.height) || 0,
    phash: fingerprints.phash || ""
  };
}

function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length || !/^[0-9a-f]+$/i.test(a + b)) return null;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let value = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (value) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
}

function durationCompatible(a, b, tolerance = 2) {
  if (!a.duration || !b.duration) return true;
  return Math.abs(a.duration - b.duration) <= tolerance;
}

function orientationCompatible(a, b, leftScene, rightScene) {
  if (!a.width || !a.height || !b.width || !b.height) return true;
  const ar = a.width / a.height;
  const br = b.width / b.height;
  if (Math.abs(ar - br) <= 0.08) return true;
  const leftText = normalize(basename(leftScene));
  const rightText = normalize(basename(rightScene));
  return Math.abs(ar - (1 / br)) <= 0.08 &&
    /\b(?:vertical|portrait|phone)\b/.test(`${leftText} ${rightText}`);
}

function partitionByMedia(items) {
  const partitions = [];
  items.forEach(item => {
    let target = partitions.find(partition => partition.every(member =>
      durationCompatible(member.media, item.media) &&
      orientationCompatible(member.media, item.media, member.scene, item.scene)
    ));
    if (!target) {
      target = [];
      partitions.push(target);
    }
    target.push(item);
  });
  return partitions;
}

function familyKey(item) {
  const info = item.descriptor;
  if (!info) return "";
  const version = info.versions.join("+");
  const coreWithoutVersion = info.core.replace(/\bv\s*\d{1,3}\b/g, " ").replace(/\s+/g, " ").trim();
  return [
    item.identity.artistKey,
    item.identity.filenameCharacterKey || item.identity.characterKey,
    coreWithoutVersion,
    version
  ].join("||");
}

function setRoot(scene, byId) {
  const cf = customFields(scene);
  if (cf.variant_role === "primary") return String(scene.id);
  if (cf.variant_role === "variant" && cf.variant_parent_id) return String(cf.variant_parent_id);
  return "";
}

async function gql(query, variables) {
  const response = await fetch(STASH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors));
  return payload.data;
}

async function loadScenes() {
  const query = `query AuditScenes($filter: FindFilterType) {
    findScenes(filter: $filter) {
      count
      scenes {
        id title details custom_fields
        studio { id name }
        groups { group { id name aliases } scene_index }
        tags { id name aliases }
        files { path basename width height duration fingerprints { type value } }
      }
    }
  }`;
  const scenes = [];
  let page = 1;
  const perPage = 500;
  while (true) {
    const data = await gql(query, { filter: { page, per_page: perPage, sort: "id", direction: "ASC" } });
    const batch = data.findScenes.scenes || [];
    scenes.push(...batch);
    if (scenes.length >= Number(data.findScenes.count) || batch.length < perPage) break;
    page++;
  }
  return scenes;
}

function analyzeExistingSets(items, byId) {
  const findings = [];
  items.filter(item => customFields(item.scene).variant_role === "primary").forEach(primary => {
    const members = [primary, ...variantChildren(primary.scene).map(id => byId[id]).filter(Boolean)];
    const identities = new Set(members.map(item =>
      `${item.identity.artistKey}|${item.identity.filenameCharacterKey || item.identity.characterKey}`
    ).filter(Boolean));
    const versions = new Set(members.flatMap(item => item.descriptor ? item.descriptor.versions : []));
    const durations = members.map(item => item.media.duration).filter(Boolean);
    const maxDurationDelta = durations.length ? Math.max(...durations) - Math.min(...durations) : 0;
    const reasons = [];
    if (identities.size > 1) reasons.push("mixed_identity");
    if (versions.size > 1) reasons.push("mixed_explicit_versions");
    if (maxDurationDelta > 2.01) reasons.push("large_duration_range");
    if (reasons.length) {
      findings.push({
        primaryId: String(primary.scene.id),
        primary: basename(primary.scene),
        reasons,
        versions: [...versions],
        maxDurationDelta: Math.round(maxDurationDelta * 100) / 100,
        members: members.map(item => ({
          id: String(item.scene.id),
          filename: basename(item.scene),
          duration: item.media.duration,
          versions: item.descriptor ? item.descriptor.versions : []
        }))
      });
    }
  });
  return findings;
}

function analyzeMissedFamilies(items) {
  const groups = {};
  items.forEach(item => {
    const key = familyKey(item);
    if (!key || !item.identity.artistKey || !item.identity.characterKey) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  const findings = [];
  Object.keys(groups).forEach(key => {
    partitionByMedia(groups[key]).forEach(partition => {
      if (partition.length < 2) return;
      const roots = new Set(partition.map(item => item.root).filter(Boolean));
      const unassigned = partition.filter(item => !item.root);
      const descriptorCount = partition.filter(item => item.descriptor && item.descriptor.hasDescriptor).length;
      if (!unassigned.length || descriptorCount < 1) return;

      let minPHashDistance = null;
      let pHashPairsAt12 = 0;
      for (let i = 0; i < partition.length; i++) {
        for (let j = i + 1; j < partition.length; j++) {
          const distance = hammingHex(partition[i].media.phash, partition[j].media.phash);
          if (distance === null) continue;
          minPHashDistance = minPHashDistance === null ? distance : Math.min(minPHashDistance, distance);
          if (distance <= 12) pHashPairsAt12++;
        }
      }
      const strongFilenamePattern =
        partition.some(item => item.descriptor.descriptors.some(value => /^(?:std|standard|default)$/.test(value))) ||
        partition.filter(item => item.descriptor.descriptors.some(value => /^(?:alt|alternate|alternative)/.test(value))).length >= 2 ||
        partition.filter(item => item.descriptor.descriptors.some(value => /^bonus/.test(value))).length >= 1;
      const confidence = pHashPairsAt12 > 0 ? "high" : (strongFilenamePattern ? "review" : "low");
      findings.push({
        key,
        confidence,
        artist: partition[0].identity.artistLabel,
        characters: partition[0].identity.characterLabels,
        core: partition[0].descriptor.core,
        versions: partition[0].descriptor.versions,
        existingRoots: [...roots],
        sceneCount: partition.length,
        unassignedCount: unassigned.length,
        minPHashDistance,
        pHashPairsAt12,
        members: partition.map(item => ({
          id: String(item.scene.id),
          filename: basename(item.scene),
          duration: item.media.duration,
          dimensions: `${item.media.width}x${item.media.height}`,
          root: item.root,
          descriptors: item.descriptor.descriptors
        }))
      });
    });
  });

  const rank = { high: 0, review: 1, low: 2 };
  findings.sort((a, b) =>
    rank[a.confidence] - rank[b.confidence] ||
    b.unassignedCount - a.unassignedCount ||
    a.artist.localeCompare(b.artist) ||
    a.members[0].filename.localeCompare(b.members[0].filename)
  );
  return findings;
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value === null || value === undefined ? "" : value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function main() {
  const scenes = await loadScenes();
  const items = scenes.map(scene => {
    const identity = sceneIdentity(scene);
    return {
      scene,
      identity,
      descriptor: descriptorInfo(scene, identity),
      media: media(scene)
    };
  });
  const byId = {};
  items.forEach(item => { byId[String(item.scene.id)] = item; });
  items.forEach(item => { item.root = setRoot(item.scene, byId); });

  const existingSetIssues = analyzeExistingSets(items, byId);
  const missedFamilies = analyzeMissedFamilies(items);
  const report = {
    generatedAt: new Date().toISOString(),
    stashUrl: STASH_URL,
    sceneCount: scenes.length,
    existingSetIssueCount: existingSetIssues.length,
    missedFamilyCount: missedFamilies.length,
    missedSceneCount: missedFamilies.reduce((sum, family) => sum + family.unassignedCount, 0),
    existingSetIssues,
    missedFamilies
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, "missed-variant-audit.json");
  const csvPath = path.join(OUTPUT_DIR, "missed-variant-families.csv");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const rows = [
    ["Confidence", "Artist", "Characters", "Core", "Versions", "Scenes", "Unassigned", "MinPHashDistance", "ExistingRoots", "Members"]
  ];
  missedFamilies.forEach(family => {
    rows.push([
      family.confidence,
      family.artist,
      family.characters,
      family.core,
      family.versions,
      family.sceneCount,
      family.unassignedCount,
      family.minPHashDistance,
      family.existingRoots,
      family.members.map(member => `${member.id}: ${member.filename}`)
    ]);
  });
  fs.writeFileSync(csvPath, rows.map(row => row.map(csvEscape).join(",")).join("\r\n"));
  console.log(JSON.stringify({
    jsonPath,
    csvPath,
    sceneCount: report.sceneCount,
    existingSetIssueCount: report.existingSetIssueCount,
    missedFamilyCount: report.missedFamilyCount,
    missedSceneCount: report.missedSceneCount
  }, null, 2));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
