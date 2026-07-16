(function () {
  "use strict";

  var PLUGIN_IDS = ["scene-metadata-variants-v1", "stash-scene-metadata-variants-v1", "scene-metadata-variants", "Scene Metadata Variants", "Scene Variant Sets"];
  var PLUGIN_VERSION = "0.5.17";
  var DRY_RUN_KEY = "scene-metadata-variants-ui-dry-run";
  var SHOW_NESTED_KEY = "scene-metadata-variants-show-nested";
  var REVIEW_KEY_PREFIX = "scene-metadata-variants-v2-review:";
  var REVIEW_BOUNDS_KEY = "scene-metadata-variants-review-bounds-v1:";
  var DISCOVERY_MODEL_VERSION = 7;
  var REVIEW_SELECTION_VERSION = 1;
  var APPROVAL_POLICY_VERSION = 1;
  var MEMBERSHIP_POLICY_VERSION = 1;
  var TASKS = {
    discover: "Variant Sets: Discover Candidate Variants",
    applyBatch: "Variant Sets: Process approved families",
    link: "Variant Sets: Attach child scene",
    unlink: "Variant Sets: Detach child scene",
    promote: "Variant Sets: Make child primary",
    rename: "Variant Sets: Rename child label",
    reorder: "Variant Sets: Reorder children"
  };
  var baseURL = (document.querySelector("base") && document.querySelector("base").getAttribute("href")) || "/";
  var cache = {};
  var scenePanelLoadId = null;
  var scenePanelRequestToken = 0;
  var scenePanelRefreshTimer = null;
  var scenePanelWatchId = null;

  function gql(query, variables) {
    return fetch(baseURL + "graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (res) {
      return res.json();
    }).then(function (json) {
      if (json.errors && json.errors.length) throw new Error(json.errors.map(function (e) { return e.message; }).join("; "));
      return json.data;
    });
  }

  function sceneIdFromLocation() {
    var m = window.location.pathname.match(/(?:^|\/)scenes?\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  }

  function isScenesBrowseRoute() {
    return /(?:^|\/)scenes\/?$/.test(window.location.pathname);
  }

  function customFields(scene) {
    return scene && scene.custom_fields && typeof scene.custom_fields === "object" ? scene.custom_fields : {};
  }

  function variantChildren(scene) {
    var raw = customFields(scene).variant_children;
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === "string" && raw.trim()) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch (e) {
        return raw.split(/[,\s|]+/).filter(Boolean).map(String);
      }
    }
    return [];
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  function retrySceneRead(work, attempts) {
    var remaining = attempts === undefined ? 3 : attempts;
    return work().catch(function (err) {
      if (remaining <= 1 || !/database is locked|database is busy|SQLITE_BUSY/i.test(String(err && err.message || err))) throw err;
      return wait((4 - remaining) * 150 + 150).then(function () {
        return retrySceneRead(work, remaining - 1);
      });
    });
  }

  function findScene(id) {
    var query = "query VariantUiFindScene($id: ID!) { findScene(id: $id) { id title custom_fields studio { id name } groups { group { id name aliases } } tags { id name aliases } files { path basename width height duration } paths { screenshot preview webp vtt sprite } } }";
    return retrySceneRead(function () {
      return gql(query, { id: String(id) });
    }).then(function (data) {
      return data.findScene;
    });
  }

  function findScenesByIds(ids) {
    var orderedIds = [];
    var seen = {};
    (ids || []).forEach(function (id) {
      var normalized = String(id || "");
      if (!normalized || seen[normalized]) return;
      seen[normalized] = true;
      orderedIds.push(normalized);
    });
    if (!orderedIds.length) return Promise.resolve([]);

    var query = "query VariantUiFindScenes($ids: [ID!]) { findScenes(ids: $ids, filter: { per_page: -1 }) { scenes { id title custom_fields studio { id name } groups { group { id name aliases } } tags { id name aliases } files { path basename width height duration } paths { screenshot preview webp vtt sprite } } } }";
    return retrySceneRead(function () {
      return gql(query, { ids: orderedIds });
    }).then(function (data) {
      var byId = {};
      (((data || {}).findScenes || {}).scenes || []).forEach(function (scene) {
        if (scene && scene.id !== undefined) byId[String(scene.id)] = scene;
      });
      return orderedIds.map(function (id) { return byId[id] || null; }).filter(Boolean);
    });
  }

  function searchScenes(text) {
    if (/^\d+$/.test(String(text || "").trim())) {
      return findScene(String(text).trim()).then(function (scene) {
        return scene ? [scene] : [];
      });
    }
    var query = "query VariantUiSearchScenes($filter: FindFilterType) { findScenes(filter: $filter) { count scenes { id title custom_fields studio { id name } groups { group { id name aliases } } tags { id name aliases } files { path basename width height duration } paths { screenshot preview webp vtt sprite } } } }";
    return gql(query, { filter: { q: String(text || ""), per_page: 20 } }).then(function (data) {
      return (data.findScenes && data.findScenes.scenes) || [];
    });
  }

  function runPluginTaskWithId(pluginId, taskName, args) {
    var query = "mutation RunVariantPluginTask($plugin_id: ID!, $task_name: String!, $args_map: Map) { runPluginTask(plugin_id: $plugin_id, task_name: $task_name, args_map: $args_map) }";
    return gql(query, { plugin_id: pluginId, task_name: taskName, args_map: args || {} });
  }

  function runPluginTask(taskName, args) {
    var index = 0;
    function attempt() {
      return runPluginTaskWithId(PLUGIN_IDS[index], taskName, args).catch(function (err) {
        index++;
        if (index < PLUGIN_IDS.length) return attempt();
        throw err;
      });
    }
    return attempt();
  }

  function runPluginOperationWithId(pluginId, args) {
    var query = "mutation RunVariantPluginOperation($plugin_id: ID!, $args: Map) { runPluginOperation(plugin_id: $plugin_id, args: $args) }";
    return gql(query, { plugin_id: pluginId, args: args || {} }).then(function (data) {
      return data && data.runPluginOperation;
    });
  }

  function runPluginOperation(args) {
    var index = 0;
    function attempt() {
      return runPluginOperationWithId(PLUGIN_IDS[index], args).catch(function (err) {
        index++;
        if (index < PLUGIN_IDS.length) return attempt();
        throw err;
      });
    }
    return attempt();
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function sceneTitle(scene) {
    if (!scene) return "";
    if (scene.title) return scene.title;
    var file = scene.files && scene.files[0];
    return (file && (file.basename || file.path)) || ("Scene " + scene.id);
  }

  function goScene(id) {
    window.location.href = baseURL.replace(/\/$/, "") + "/scenes/" + id;
  }

  function infoText(scene) {
    var cf = customFields(scene);
    if (cf.variant_role === "primary") return variantChildren(scene).length + " linked variants";
    if (cf.variant_role === "variant") return "Variant of scene " + cf.variant_parent_id;
    return "No variants linked.";
  }

  function button(label, onClick, tone) {
    var className = "smv-button" + (tone ? " smv-button-" + tone : "");
    var b = el("button", className, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    var tooltip = buttonTooltip(label);
    if (tooltip) setControlTooltip(b, tooltip);
    return b;
  }

  var BUTTON_TOOLTIPS = {
    "approval": "Open approval commands for suggested or currently visible variant families.",
    "approve all suggested": "Approve every family classified as a strong automatic suggestion.",
    "approve visible": "Approve all families currently shown by the active filter and search.",
    "unapprove visible": "Return all currently visible families to review status.",
    "clear all approvals": "Remove approval from every candidate family without deleting the review draft.",
    "select scenes": "Enter scene-selection mode for multi-scene editing commands.",
    "done selecting": "Leave scene-selection mode and clear the temporary editing selection.",
    "actions": "Open editing commands for the scenes selected in the candidate list.",
    "merge families": "Combine the selected scenes' families with another compatible family.",
    "move scenes": "Move the selected scenes into another compatible variant family.",
    "create family from scenes": "Create a new draft family from the selected scenes.",
    "remove scenes from families": "Remove selected scenes from their draft families without changing Stash.",
    "remove selected families": "Remove the selected draft families from this review list without changing Stash.",
    "discover families": "Scan Stash duplicate evidence and metadata for reviewable variant families.",
    "create manual family": "Choose scenes manually to create a new draft variant family.",
    "preview approved links": "Queue a dry run of every approved family without changing scene metadata.",
    "create variant sets": "Create the approved variant relationships after a successful dry run.",
    "preview required": "Queue the required dry run before creating the approved variant sets.",
    "reset review": "Clear the saved browser review draft, approvals, filters, and manual corrections.",
    "close": "Close this Scene Variant plugin window.",
    "add scene": "Search for another scene and add it to this draft family.",
    "cancel": "Close this window without making the pending selection.",
    "find scene": "Search Stash using the entered title, path, or scene ID.",
    "choose scene": "Use this scene for the pending variant-family action.",
    "retry variant list": "Reload this scene's variant relationship data from Stash.",
    "add selected": "Add the checked variants to the Session Scene Queue in displayed order.",
    "add all variants": "Add every other scene in this family to the Session Scene Queue.",
    "review candidate families": "Open candidate discovery, family correction, approval, preview, and apply controls.",
    "attach child scene": "Search for a scene to link as a child variant of the current scene.",
    "nest this scene": "Choose a primary scene and make the current scene one of its variants.",
    "detach from set": "Remove the current scene from its variant family without deleting it.",
    "make set primary": "Promote the current variant to primary and move its siblings under it.",
    "variant family review": "Open the Scene Variant candidate discovery and review window.",
    "show nested variants": "Show child variants alongside primary scenes on the scene browsing page.",
    "hide nested variants": "Hide child variants from the scene browsing page while keeping primary scenes visible."
  };

  function normalizedControlLabel(value) {
    return String(value || "")
      .replace(/\(\s*\d+\s*\)/g, "")
      .replace(/\b\d+\s+selected families\b/i, "selected families")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function buttonTooltip(label) {
    var key = normalizedControlLabel(label);
    if (BUTTON_TOOLTIPS[key]) return BUTTON_TOOLTIPS[key];
    if (/^merge \d+ selected families$/.test(key) || key === "merge selected families") {
      return "Merge the selected compatible draft families into one family.";
    }
    return "";
  }

  function setControlTooltip(control, text) {
    if (!control || !text) return control;
    control.setAttribute("data-smv-tooltip", String(text));
    control.removeAttribute("title");
    return control;
  }

  function tooltipControlFromEvent(target) {
    if (!target || !target.closest) return null;
    var control = target.closest(
      "button, input, select, textarea, a.smv-scene-thumbnail, a.smv-scene-link, " +
      ".smv-review-family, .smv-resize-handle, [role='button']"
    );
    if (!control) return null;
    var insidePlugin = control.closest(
      ".smv-panel, .smv-modal-backdrop, .smv-card-variant-menu, .smv-browse-discovery"
    );
    var pluginClass = typeof control.className === "string" && /\bsmv-/.test(control.className);
    var discoverTask = control.tagName === "BUTTON" &&
      (control.textContent || "").replace(/\s+/g, " ").trim() === TASKS.discover;
    return insidePlugin || pluginClass || discoverTask ? control : null;
  }

  function tooltipTextForControl(control) {
    if (!control) return "";
    var explicit = control.getAttribute("data-smv-tooltip");
    if (explicit) return explicit;

    var nativeTitle = control.getAttribute("title");
    if (nativeTitle) {
      setControlTooltip(control, nativeTitle);
      return nativeTitle;
    }

    if (control.classList.contains("smv-review-family")) {
      return "Drag this family onto another compatible family to merge them. Use Select Scenes for scene-level edits.";
    }
    if (control.classList.contains("smv-resize-handle")) {
      return "Drag this edge or corner to resize the candidate review window.";
    }
    if (control.classList.contains("smv-family-search-result")) {
      return "Choose this family as the target for the pending merge or move action.";
    }
    if (control.classList.contains("smv-review-filter")) {
      return "Choose which candidate-family statuses are displayed.";
    }
    if (control.classList.contains("smv-review-search")) {
      return "Filter candidate families as you type using scene titles and IDs.";
    }
    if (control.classList.contains("smv-search-input")) {
      return control.getAttribute("placeholder") || "Search for a scene or variant family.";
    }
    if (control.classList.contains("smv-player-variant-open")) {
      return "Open this variant in the scene player.";
    }
    if (control.classList.contains("smv-family-status")) {
      return control.getAttribute("aria-pressed") === "true"
        ? "This family is approved. Click to return it to review."
        : "Approve this family for the next dry run and live apply.";
    }
    if (control.matches(".smv-review-member input[type='text']")) {
      return "Edit the label stored for this child variant.";
    }
    if (control.matches(".smv-review-primary select")) {
      return control.disabled
        ? "This existing family's primary is fixed here. Use family editing controls to reorganize it."
        : "Choose which scene should be the primary parent of this draft family.";
    }
    if (control.matches(".smv-mode input[type='checkbox']")) {
      return "When enabled, manual player-page relationship actions run as previews without changing Stash.";
    }

    var aria = control.getAttribute("aria-label");
    if (aria) return aria;
    var labelTooltip = buttonTooltip(control.textContent || "");
    if (labelTooltip) return labelTooltip;
    if (control.matches("a.smv-scene-thumbnail")) return "Open this scene. Hover to play Stash's generated preview.";
    if (control.matches("a.smv-scene-link")) return "Open this scene in a new tab.";
    if (control.tagName === "SELECT") return "Choose an option from this list.";
    if (control.tagName === "TEXTAREA" || control.tagName === "INPUT") {
      return control.getAttribute("placeholder") || "Edit this value.";
    }
    if (control.tagName === "BUTTON") {
      var label = (control.textContent || "").replace(/\s+/g, " ").trim();
      return label ? "Use " + label + "." : "Activate this control.";
    }
    return "";
  }

  function installControlTooltips() {
    if (window.__smvControlTooltips) return;
    window.__smvControlTooltips = true;

    var tooltip = el("div", "smv-control-tooltip");
    tooltip.id = "smv-control-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.appendChild(tooltip);

    var activeControl = null;
    var showTimer = 0;
    var pointerX = 0;
    var pointerY = 0;
    var keyboardMode = false;

    function clearTimer() {
      if (showTimer) window.clearTimeout(showTimer);
      showTimer = 0;
    }

    function positionTooltip(control) {
      tooltip.style.left = "0px";
      tooltip.style.top = "0px";
      var box = tooltip.getBoundingClientRect();
      var margin = 10;
      var left;
      var top;
      if (keyboardMode) {
        var rect = control.getBoundingClientRect();
        left = rect.left + (rect.width / 2) - (box.width / 2);
        top = rect.bottom + 9;
        if (top + box.height > window.innerHeight - margin) top = rect.top - box.height - 9;
      } else {
        left = pointerX + 14;
        top = pointerY + 18;
        if (top + box.height > window.innerHeight - margin) top = pointerY - box.height - 14;
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - box.height - margin));
      tooltip.style.left = Math.round(left) + "px";
      tooltip.style.top = Math.round(top) + "px";
    }

    function showTooltip(control, useKeyboard) {
      clearTimer();
      var text = tooltipTextForControl(control);
      if (!text) return;
      activeControl = control;
      keyboardMode = !!useKeyboard;
      showTimer = window.setTimeout(function () {
        if (activeControl !== control) return;
        tooltip.textContent = text;
        tooltip.hidden = false;
        control.setAttribute("aria-describedby", tooltip.id);
        positionTooltip(control);
      }, 180);
    }

    function hideTooltip(control) {
      if (control && activeControl && control !== activeControl) return;
      clearTimer();
      if (activeControl && activeControl.getAttribute("aria-describedby") === tooltip.id) {
        activeControl.removeAttribute("aria-describedby");
      }
      activeControl = null;
      tooltip.hidden = true;
    }

    document.addEventListener("mouseover", function (event) {
      var control = tooltipControlFromEvent(event.target);
      if (!control || control === activeControl) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      showTooltip(control, false);
    }, true);
    document.addEventListener("mousemove", function (event) {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (activeControl && !keyboardMode && !tooltip.hidden) positionTooltip(activeControl);
    }, true);
    document.addEventListener("mouseout", function (event) {
      if (!activeControl) return;
      var next = event.relatedTarget;
      if (next && activeControl.contains(next)) return;
      if (activeControl === tooltipControlFromEvent(event.target)) hideTooltip(activeControl);
    }, true);
    document.addEventListener("focusin", function (event) {
      var control = tooltipControlFromEvent(event.target);
      if (control) showTooltip(control, true);
    }, true);
    document.addEventListener("focusout", function (event) {
      if (activeControl && activeControl === tooltipControlFromEvent(event.target)) hideTooltip(activeControl);
    }, true);
    document.addEventListener("pointerdown", function () { hideTooltip(); }, true);
    window.addEventListener("scroll", function () { hideTooltip(); }, true);
    window.addEventListener("resize", function () { hideTooltip(); });
  }

  function brandHeader(title) {
    var header = el("div", "smv-brand-header");
    header.appendChild(el("div", "smv-brand-mark", "VS"));
    var copy = el("div", "smv-brand-copy");
    copy.appendChild(el("div", "smv-brand-kicker", "SCENE VARIANT SETS | " + PLUGIN_VERSION));
    copy.appendChild(el("div", "smv-title", title));
    header.appendChild(copy);
    return header;
  }

  function uiDryRun() {
    return window.localStorage.getItem(DRY_RUN_KEY) !== "false";
  }

  function setUiDryRun(value) {
    window.localStorage.setItem(DRY_RUN_KEY, value ? "true" : "false");
  }

  function taskJobId(data) {
    return data && data.runPluginTask ? String(data.runPluginTask) : "";
  }

  function afterTask(data, dryRun) {
    var job = taskJobId(data);
    if (dryRun) {
      window.alert("Dry run queued" + (job ? " as job " + job : "") + ". Check the Stash task log before applying.");
      return;
    }
    window.location.reload();
  }

  function showNestedVariants() {
    return window.localStorage.getItem(SHOW_NESTED_KEY) === "true";
  }

  function setShowNestedVariants(value) {
    window.localStorage.setItem(SHOW_NESTED_KEY, value ? "true" : "false");
  }

  function variantStatus(scene) {
    var cf = customFields(scene);
    if (cf.variant_role === "primary") return "Primary scene with " + variantChildren(scene).length + " variants";
    if (cf.variant_role === "variant") return "Already variant of: " + cf.variant_parent_id;
    return "Normal";
  }

  function sceneSummary(scene) {
    var file = scene.files && scene.files[0];
    var groups = (scene.groups || []).map(function (g) { return g.group && g.group.name; }).filter(Boolean).join(", ");
    var tags = (scene.tags || []).slice(0, 5).map(function (t) { return t.name; }).join(", ");
    return {
      studio: scene.studio && scene.studio.name || "",
      groups: groups,
      tags: tags,
      path: file && (file.basename || file.path) || ""
    };
  }

  function reviewStem(value) {
    var raw = String(value || "").split(/[\\/]/).pop() || "";
    return raw.replace(/\.[a-z0-9]{2,5}$/i, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function reviewAliases(value) {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") return value.split(/[|,;\n\r]+/).map(function (part) { return part.trim(); }).filter(Boolean);
    return [];
  }

  function reviewIdentityForScene(scene) {
    var file = scene && scene.files && scene.files[0] || {};
    var base = String(file.basename || file.path || sceneTitle(scene)).split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,5}$/i, " ").replace(/\[[^\]]*\]/g, " ").trim();
    var parts = base.split(/\s+[-\u2013\u2014]\s+/).map(function (part) { return part.trim(); }).filter(Boolean);
    var rawArtist = parts.length >= 2 ? parts[0] : "";
    var artistKey = reviewStem(rawArtist);
    var artistLabel = rawArtist;
    var groups = (scene.groups || []).map(function (entry) { return entry && entry.group; }).filter(Boolean);
    var matchedGroup = null;
    groups.forEach(function (group) {
      var names = [group.name].concat(reviewAliases(group.aliases));
      if (names.some(function (name) { return reviewStem(name) === artistKey; })) matchedGroup = group;
    });
    if (!matchedGroup && groups.length === 1) matchedGroup = groups[0];
    if (matchedGroup) {
      artistLabel = matchedGroup.name;
      artistKey = reviewStem(matchedGroup.name);
    }

    var characterText = parts.length >= 3 ? parts[1] : (parts.length === 2 ? parts[1] : "");
    var textKey = reviewStem(characterText);
    var characterLabels = [];
    (scene.tags || []).forEach(function (tag) {
      var names = [tag.name].concat(reviewAliases(tag.aliases));
      if (names.some(function (name) {
        var key = reviewStem(name);
        return key && (textKey === key || (" " + textKey + " ").indexOf(" " + key + " ") !== -1);
      })) characterLabels.push(tag.name);
    });
    if (!characterLabels.length && parts.length >= 3) {
      characterLabels = String(parts[1]).split(/\s*(?:,|\+|&|\band\b)\s*/i).filter(Boolean);
    }
    var characterMap = {};
    characterLabels.forEach(function (label) {
      var key = reviewStem(label);
      if (key) characterMap[key] = String(label);
    });
    var characterKeys = Object.keys(characterMap).sort();
    return {
      artistKey: artistKey,
      artistLabel: artistLabel || "",
      characterKey: characterKeys.join("|"),
      characterLabels: characterKeys.map(function (key) { return characterMap[key]; })
    };
  }

  function reviewIdentityCompatible(a, b) {
    var left = a || {};
    var right = b || {};
    if (left.artistKey && right.artistKey && left.artistKey !== right.artistKey) return false;
    if (left.characterKey && right.characterKey && left.characterKey !== right.characterKey) return false;
    return true;
  }

  function reviewFamilyIdentity(family) {
    if (family && family.identity) return family.identity;
    var identity = {};
    (family && family.members || []).forEach(function (member) {
      var next = member.identity || {};
      if (!identity.artistKey && next.artistKey) {
        identity.artistKey = next.artistKey;
        identity.artistLabel = next.artistLabel;
      }
      if (!identity.characterKey && next.characterKey) {
        identity.characterKey = next.characterKey;
        identity.characterLabels = next.characterLabels;
      }
    });
    return identity;
  }

  function reviewNumberInfo(member) {
    if (member && member.hasExplicitNumber !== undefined) {
      return {
        hasNumber: !!member.hasExplicitNumber,
        number: member.variantNumber === null || member.variantNumber === undefined ? null : Number(member.variantNumber),
        base: member.familyStem || member.filenameStem || ""
      };
    }
    var stem = reviewStem(member && (member.path || member.title));
    var explicit = stem.match(/^(.*?)(?:\s+)(?:v|ver|version|part|scene|clip|cam|camera|angle)\s*(\d{1,3})$/i);
    if (explicit && explicit[1].trim()) return { hasNumber: true, number: Number(explicit[2]), base: explicit[1].trim() };
    var bare = stem.match(/^(.*\S)\s+(\d{1,2})$/);
    if (bare) return { hasNumber: true, number: Number(bare[2]), base: bare[1].trim() };
    return { hasNumber: false, number: null, base: stem };
  }

  function reviewParentPreference(value) {
    var n = reviewStem(value);
    var definitions = [
      ["std", "Standard", 3, 0.24], ["standard", "Standard", 3, 0.24], ["default", "Default", 3, 0.24],
      ["regular", "Regular", 2, 0.10], ["normal", "Normal", 2, 0.10], ["vanilla", "Vanilla", 2, 0.10],
      ["full version", "Full version", 2, 0.12], ["full animation", "Full animation", 2, 0.12],
      ["full anim", "Full animation", 2, 0.12], ["full audio", "Full audio", 2, 0.10],
      ["complete", "Complete", 2, 0.10], ["uncut", "Uncut", 2, 0.10],
      ["original", "Original", 1, 0.05], ["base", "Base", 1, 0.05], ["main", "Main", 1, 0.05]
    ];
    var labels = [];
    var rank = 0;
    var score = 0;
    definitions.forEach(function (entry) {
      var phrase = entry[0];
      if ((" " + n + " ").indexOf(" " + phrase + " ") === -1) return;
      if (labels.indexOf(entry[1]) === -1) labels.push(entry[1]);
      rank = Math.max(rank, entry[2]);
      score += entry[3];
    });
    if (/(?:^|\s)full$/.test(n)) {
      labels.push("Full");
      rank = Math.max(rank, 2);
      score += 0.10;
    }
    return { rank: rank, score: Math.min(0.3, score), labels: labels };
  }

  function preferredReviewPrimary(members) {
    var list = (members || []).slice();
    var stems = {};
    list.forEach(function (member) { stems[member.filenameStem || reviewStem(member.path || member.title)] = true; });
    var originals = {};
    list.forEach(function (member) {
      var info = reviewNumberInfo(member);
      if (info.hasNumber && stems[info.base]) originals[info.base] = true;
    });
    list.sort(function (a, b) {
      var ar = Number(a.parentPreferenceRank) || 0;
      var br = Number(b.parentPreferenceRank) || 0;
      if ((ar >= 3 || br >= 3) && ar !== br) return br - ar;
      var as = a.filenameStem || reviewStem(a.path || a.title);
      var bs = b.filenameStem || reviewStem(b.path || b.title);
      var ao = !!a.isCanonicalOriginal || !!originals[as];
      var bo = !!b.isCanonicalOriginal || !!originals[bs];
      if (ao !== bo) return ao ? -1 : 1;
      var ai = reviewNumberInfo(a);
      var bi = reviewNumberInfo(b);
      if (ai.hasNumber !== bi.hasNumber) return ai.hasNumber ? 1 : -1;
      if (ai.hasNumber && bi.hasNumber && ai.number !== bi.number) return ai.number - bi.number;
      var scoreDiff = Number(b.parentScore || 0) - Number(a.parentScore || 0);
      if (Math.abs(scoreDiff) > 0.000001) return scoreDiff;
      return String(a.sceneId).localeCompare(String(b.sceneId), undefined, { numeric: true });
    });
    return list[0] || null;
  }

  function sceneToReviewMember(scene) {
    var file = scene && scene.files && scene.files[0] || {};
    var member = {
      sceneId: String(scene.id),
      title: sceneTitle(scene),
      path: file.path || file.basename || "",
      role: "child",
      label: "Variant",
      parentScore: 0.5,
      filenameStem: reviewStem(file.basename || file.path || sceneTitle(scene)),
      variantTokens: [],
      existingVariant: variantStatus(scene),
      identity: reviewIdentityForScene(scene),
      media: {
        screenshot: scene.paths && scene.paths.screenshot || "",
        preview: scene.paths && scene.paths.preview || "",
        webp: scene.paths && scene.paths.webp || "",
        vtt: scene.paths && scene.paths.vtt || "",
        sprite: scene.paths && scene.paths.sprite || "",
        width: Number(file.width) || 0,
        height: Number(file.height) || 0,
        duration: Number(file.duration) || 0
      }
    };
    var parentPreference = reviewParentPreference(file.basename || file.path || sceneTitle(scene));
    member.parentPreferenceRank = parentPreference.rank;
    member.parentPreferenceScore = parentPreference.score;
    member.parentSignals = parentPreference.labels;
    var info = reviewNumberInfo(member);
    member.familyStem = info.base;
    member.hasExplicitNumber = info.hasNumber;
    member.variantNumber = info.number;
    member.isCanonicalOriginal = false;
    return member;
  }

  function reviewFamilyId(members) {
    return "nsv2-manual-" + (members || []).map(function (member) { return String(member.sceneId); }).sort(function (a, b) {
      return a.localeCompare(b, undefined, { numeric: true });
    }).join("-");
  }

  function reviewStorageKey() {
    return REVIEW_KEY_PREFIX + window.location.origin + ":" + baseURL.replace(/\/+$/, "");
  }

  function emptyReviewState() {
    return {
      version: PLUGIN_VERSION,
      updatedAt: new Date().toISOString(),
      families: [],
      approvals: {},
      lastDryRunAt: "",
      lastDryRunJobId: "",
      lastDiscoveryAt: "",
      lastDiscoveryCount: 0,
      lastDiscoverySeconds: 0,
      lastSuppressedExisting: 0,
      lastSuppressedSingletons: 0,
      needsMediaRefresh: false,
      discoveryModelVersion: DISCOVERY_MODEL_VERSION,
      selectionVersion: REVIEW_SELECTION_VERSION,
      approvalPolicyVersion: APPROVAL_POLICY_VERSION,
      membershipPolicyVersion: MEMBERSHIP_POLICY_VERSION
    };
  }

  function loadReviewState() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem(reviewStorageKey()) || "null");
      if (parsed && parsed.families && parsed.approvals) {
        parsed.families = parsed.families.filter(reviewableFamily);
        var retainedFamilyIds = {};
        parsed.families.forEach(function (family) { retainedFamilyIds[family.familyId] = true; });
        Object.keys(parsed.approvals).forEach(function (familyId) {
          if (!retainedFamilyIds[familyId]) delete parsed.approvals[familyId];
        });
        if (parsed.selectionVersion !== REVIEW_SELECTION_VERSION) {
          Object.keys(parsed.approvals).forEach(function (familyId) {
            var approval = parsed.approvals[familyId];
            approval.approved = false;
            (approval.children || []).forEach(function (child) { child.include = true; });
          });
          parsed.lastDryRunAt = "";
          parsed.lastDryRunJobId = "";
        }
        if (parsed.approvalPolicyVersion !== APPROVAL_POLICY_VERSION) {
          parsed.families.forEach(function (family) {
            var approval = parsed.approvals[family.familyId];
            if (!approval) return;
            var suggested = family.status === "auto_suggest";
            approval.approved = suggested;
            approval.manualApproval = false;
            (approval.children || []).forEach(function (child) { child.include = true; });
          });
          parsed.lastDryRunAt = "";
          parsed.lastDryRunJobId = "";
        }
        if (parsed.membershipPolicyVersion !== MEMBERSHIP_POLICY_VERSION) {
          Object.keys(parsed.approvals).forEach(function (familyId) {
            var membershipApproval = parsed.approvals[familyId];
            (membershipApproval.children || []).forEach(function (child) { child.include = true; });
          });
          parsed.lastDryRunAt = "";
          parsed.lastDryRunJobId = "";
        }
        var missingMedia = parsed.families.some(function (family) {
          return (family.members || []).some(function (member) { return !member.media; });
        });
        parsed.needsMediaRefresh = missingMedia || parsed.discoveryModelVersion !== DISCOVERY_MODEL_VERSION;
        parsed.discoveryModelVersion = DISCOVERY_MODEL_VERSION;
        parsed.selectionVersion = REVIEW_SELECTION_VERSION;
        parsed.approvalPolicyVersion = APPROVAL_POLICY_VERSION;
        parsed.membershipPolicyVersion = MEMBERSHIP_POLICY_VERSION;
        parsed.version = PLUGIN_VERSION;
        return parsed;
      }
    } catch (e) {
      // Fall through to a fresh state.
    }
    return emptyReviewState();
  }

  function saveReviewState(state) {
    state.version = PLUGIN_VERSION;
    state.discoveryModelVersion = DISCOVERY_MODEL_VERSION;
    state.selectionVersion = REVIEW_SELECTION_VERSION;
    state.approvalPolicyVersion = APPROVAL_POLICY_VERSION;
    state.membershipPolicyVersion = MEMBERSHIP_POLICY_VERSION;
    state.updatedAt = new Date().toISOString();
    window.localStorage.setItem(reviewStorageKey(), JSON.stringify(state));
  }

  function memberById(family, id) {
    var found = null;
    (family.members || []).forEach(function (member) {
      if (String(member.sceneId) === String(id)) found = member;
    });
    return found;
  }

  function evidenceSceneIds(family, key) {
    var values = family && family.evidence && family.evidence[key];
    return Array.isArray(values) ? values.map(String) : [];
  }

  function candidateMembers(family) {
    var ids = evidenceSceneIds(family, "candidateSceneIds");
    var hasExplicitCandidates = !!(
      family &&
      family.evidence &&
      Array.isArray(family.evidence.candidateSceneIds)
    );
    if (!hasExplicitCandidates) return (family && family.members || []).slice();
    var wanted = {};
    ids.forEach(function (id) { wanted[id] = true; });
    return (family && family.members || []).filter(function (member) {
      return wanted[String(member.sceneId)];
    });
  }

  function existingFamilyMembers(family) {
    var ids = evidenceSceneIds(family, "existingFamilySceneIds");
    if (!ids.length) return [];
    var wanted = {};
    ids.forEach(function (id) { wanted[id] = true; });
    return (family && family.members || []).filter(function (member) {
      return wanted[String(member.sceneId)];
    });
  }

  function approvalMembers(family) {
    var ids = evidenceSceneIds(family, "approvalSceneIds");
    if (!ids.length) return candidateMembers(family);
    var wanted = {};
    ids.forEach(function (id) { wanted[id] = true; });
    return (family && family.members || []).filter(function (member) {
      return wanted[String(member.sceneId)];
    });
  }

  function reviewableFamily(family) {
    if (!family || !family.members) return false;
    var type = family.evidence && family.evidence.candidateType;
    if (type === "attach_to_existing") {
      return candidateMembers(family).length > 0 && existingFamilyMembers(family).length > 0;
    }
    return family.members.length >= 2;
  }

  function approvalForFamily(state, family) {
    var approval = state.approvals[family.familyId];
    if (!approval) {
      var suggested = family.status === "auto_suggest";
      approval = {
        familyId: family.familyId,
        approved: suggested,
        manualApproval: false,
        primarySceneId: String(family.proposedPrimaryId),
        children: []
      };
      approvalMembers(family).forEach(function (member) {
        if (String(member.sceneId) !== String(approval.primarySceneId)) {
          approval.children.push({ sceneId: String(member.sceneId), include: true, label: member.label || "Variant" });
        }
      });
      state.approvals[family.familyId] = approval;
    }
    return approval;
  }

  function resetApprovalChildren(family, approval) {
    var existing = {};
    (approval.children || []).forEach(function (child) {
      existing[String(child.sceneId)] = child;
    });
    approval.children = [];
    approvalMembers(family).forEach(function (member) {
      if (String(member.sceneId) === String(approval.primarySceneId)) return;
      var prior = existing[String(member.sceneId)] || {};
      approval.children.push({
        sceneId: String(member.sceneId),
        include: true,
        label: prior.label || member.label || "Variant"
      });
    });
  }

  function mergeDiscoveredFamilies(state, families) {
    var previousApprovals = state.approvals || {};
    state.families = (families || []).filter(reviewableFamily);
    var nextApprovals = {};
    state.families.forEach(function (family) {
      var previous = previousApprovals[family.familyId];
      if (previous && previous.manualApproval === true) nextApprovals[family.familyId] = previous;
      approvalForFamily({ approvals: nextApprovals }, family);
      resetApprovalChildren(family, nextApprovals[family.familyId]);
    });
    state.approvals = nextApprovals;
    state.lastDryRunAt = "";
    state.lastDryRunJobId = "";
    saveReviewState(state);
  }

  function approvedPayload(state) {
    var out = [];
    (state.families || []).forEach(function (family) {
      var approval = state.approvals[family.familyId];
      if (!approval || !approval.approved) return;
      var children = approval.children || [];
      if (!children.length) return;
      out.push({
        familyId: family.familyId,
        approved: true,
        primarySceneId: String(approval.primarySceneId),
        replaceExistingChildren: !!(family.evidence && family.evidence.replaceExistingChildren),
        children: children.map(function (child) {
          return { sceneId: String(child.sceneId), label: child.label || "Variant", include: true };
        })
      });
    });
    return out;
  }

  function pct(value) {
    var n = Number(value) || 0;
    return Math.round(n * 100) + "%";
  }

  function evidenceText(family) {
    var ev = family.evidence || {};
    var identity = reviewFamilyIdentity(family);
    var primary = memberById(family, family.proposedPrimaryId);
    var sourceText = "filename evidence";
    if (ev.candidateType === "attach_to_existing") sourceText = "matches existing family " + ev.existingFamilyPrimaryId;
    else if (ev.candidateType === "replace_existing_primary") sourceText = "rebuilds existing family with preferred primary " + family.proposedPrimaryId;
    else if (ev.candidateType === "merge_existing_families") sourceText = "merges existing families under preferred primary " + family.proposedPrimaryId;
    else if (ev.candidateType === "split_existing_family") sourceText = "splits a mixed existing set into an exact version family";
    else if (ev.manualEdited) sourceText = "manually edited draft";
    else if (ev.descriptorFamily) sourceText = "exact descriptor family";
    else if (ev.duplicateNeighborhood) sourceText = "strict duplicate + exact identity neighborhood";
    else if (ev.source === "combined") sourceText = "Stash duplicate + filename bridge";
    else if (ev.stashDuplicateCluster) sourceText = "Stash duplicate cluster";
    return [
      "confidence " + pct(family.confidence),
      sourceText,
      "filename " + pct(ev.filenameSimilarity),
      "metadata " + pct(ev.metadataOverlap),
      ev.mediaVerified ? "media checked" : "media metadata unavailable",
      "artist " + (identity.artistLabel || "unresolved"),
      "character " + ((identity.characterLabels || []).join(", ") || "unresolved"),
      "parent signal " + (primary && primary.parentSignals && primary.parentSignals.length ? primary.parentSignals.join(", ") : "none")
    ].join(" | ");
  }

  function familySearchText(family) {
    var parts = [family.familyId, family.status];
    (family.members || []).forEach(function (member) {
      parts.push(member.title, member.sceneId, (member.variantTokens || []).join(" "));
    });
    return parts.join(" ").toLowerCase();
  }

  function sceneHref(id) {
    return baseURL.replace(/\/$/, "") + "/scenes/" + String(id);
  }

  function sceneLink(member, className) {
    var link = el("a", className || "smv-scene-link", member ? member.title : "Unknown scene");
    if (member) {
      link.href = sceneHref(member.sceneId);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = "Open scene " + member.sceneId + " in a new tab";
    }
    return link;
  }

  function mediaUrl(value) {
    var url = String(value || "");
    if (!url || /^(?:https?:|data:|blob:)/i.test(url)) return url;
    return baseURL.replace(/\/$/, "") + "/" + url.replace(/^\//, "");
  }

  function sceneThumbnail(member, className) {
    var media = member && member.media || {};
    var screenshot = mediaUrl(media.screenshot || media.webp);
    var preview = mediaUrl(media.preview);
    var animatedFallback = !preview && media.webp && media.webp !== media.screenshot ? mediaUrl(media.webp) : "";
    var link = el("a", "smv-scene-thumbnail" + (className ? " " + className : ""));
    link.href = sceneHref(member.sceneId);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = "Open scene " + member.sceneId;
    link.setAttribute("aria-label", "Open scene " + member.sceneId + ": " + (member.title || "Untitled scene"));
    if (Number(media.height) > Number(media.width) && Number(media.width) > 0) link.classList.add("is-portrait");

    var image = document.createElement("img");
    image.className = "smv-scene-thumbnail-image";
    image.loading = "lazy";
    image.alt = "";
    image.draggable = false;
    if (screenshot) image.src = screenshot;
    else link.classList.add("is-missing");
    link.appendChild(image);

    var video = null;
    if (preview) {
      video = document.createElement("video");
      video.className = "smv-scene-thumbnail-video";
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "none";
      video.disableRemotePlayback = true;
      video.setAttribute("aria-hidden", "true");
      video.addEventListener("playing", function () { link.classList.add("is-previewing"); });
      video.addEventListener("error", function () { link.classList.remove("is-previewing"); });
      link.appendChild(video);
    }

    function startPreview() {
      if (video) {
        if (!video.src) video.src = preview;
        var playResult = video.play();
        if (playResult && playResult.catch) playResult.catch(function () {});
      } else if (animatedFallback) {
        image.src = animatedFallback;
      }
    }

    function stopPreview() {
      if (video) {
        video.pause();
        try { video.currentTime = 0; } catch (e) { /* Preview may not have loaded yet. */ }
        link.classList.remove("is-previewing");
      } else if (screenshot && animatedFallback) {
        image.src = screenshot;
      }
    }

    link.addEventListener("mouseenter", startPreview);
    link.addEventListener("mouseleave", stopPreview);
    link.addEventListener("focus", startPreview);
    link.addEventListener("blur", stopPreview);
    return link;
  }

  function addScenesToSessionQueue(sceneIds) {
    var seen = {};
    var normalized = [];
    (sceneIds || []).forEach(function (sceneId) {
      var id = String(sceneId || "").trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      normalized.push(id);
    });
    if (!normalized.length) return { requestedSceneIDs: [], addedSceneIDs: [] };

    var api = window.StashSessionQueue;
    if (api && typeof api.addMany === "function") {
      var result = api.addMany(normalized) || {};
      return {
        requestedSceneIDs: normalized,
        addedSceneIDs: Array.isArray(result.addedSceneIDs) ? result.addedSceneIDs.map(String) : normalized
      };
    }

    if (document.getElementById("stash-session-queue-panel")) {
      window.dispatchEvent(new CustomEvent("stash:session-scene-queue-add", {
        detail: { sceneIDs: normalized.slice() }
      }));
      return { requestedSceneIDs: normalized, addedSceneIDs: normalized.slice() };
    }

    throw new Error("Session Scene Queue is not available. Enable the stash-session-queue plugin and reload Stash.");
  }

  function playerVariantThumbnail(scene) {
    var thumbnail = sceneThumbnail(sceneToReviewMember(scene), "smv-player-variant-thumbnail");
    thumbnail.target = "_self";
    thumbnail.removeAttribute("rel");
    thumbnail.title = "Play " + sceneTitle(scene);
    thumbnail.setAttribute("aria-label", "Play " + sceneTitle(scene));
    thumbnail.addEventListener("click", function (event) {
      event.preventDefault();
      goScene(scene.id);
    });
    return thumbnail;
  }

  function playerVariantNumberInfo(scene) {
    var info = reviewNumberInfo(sceneToReviewMember(scene));
    if (info.hasNumber) return info;

    var label = String(customFields(scene).variant_label || "");
    var explicit = label.match(/(?:^|\s)(?:v|ver|version|variant|part|scene|clip|cam|camera|angle)\s*#?\s*(\d{1,3})(?:\s|$)/i);
    if (explicit) return { hasNumber: true, number: Number(explicit[1]), base: label };

    var sortIndex = Number(customFields(scene).variant_sort_index);
    if (Number.isFinite(sortIndex) && sortIndex > 0) {
      return { hasNumber: true, number: sortIndex, base: label };
    }
    return { hasNumber: false, number: null, base: label };
  }

  function comparePlayerVariantScenes(a, b) {
    var aPrimary = customFields(a).variant_role === "primary";
    var bPrimary = customFields(b).variant_role === "primary";
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;

    var ai = playerVariantNumberInfo(a);
    var bi = playerVariantNumberInfo(b);
    if (ai.hasNumber !== bi.hasNumber) return ai.hasNumber ? 1 : -1;
    if (ai.hasNumber && bi.hasNumber && ai.number !== bi.number) return ai.number - bi.number;

    var titleDiff = sceneTitle(a).localeCompare(sceneTitle(b), undefined, { numeric: true, sensitivity: "base" });
    if (titleDiff) return titleDiff;
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function makeResizableReviewModal(modal) {
    var margin = 12;
    var storageKey = REVIEW_BOUNDS_KEY + window.location.origin + ":" + baseURL.replace(/\/+$/, "");
    var saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(storageKey) || "null"); } catch (e) { saved = null; }

    function viewportLimits() {
      return {
        width: Math.max(320, window.innerWidth),
        height: Math.max(320, window.innerHeight),
        minWidth: Math.min(760, Math.max(296, window.innerWidth - (margin * 2))),
        minHeight: Math.min(460, Math.max(296, window.innerHeight - (margin * 2)))
      };
    }

    function applyBounds(bounds) {
      modal.style.left = Math.round(bounds.left) + "px";
      modal.style.top = Math.round(bounds.top) + "px";
      modal.style.width = Math.round(bounds.width) + "px";
      modal.style.height = Math.round(bounds.height) + "px";
    }

    function constrainedBounds(bounds) {
      var limits = viewportLimits();
      var maxWidth = Math.max(limits.minWidth, limits.width - (margin * 2));
      var maxHeight = Math.max(limits.minHeight, limits.height - (margin * 2));
      var width = clamp(Number(bounds.width) || maxWidth, limits.minWidth, maxWidth);
      var height = clamp(Number(bounds.height) || maxHeight, limits.minHeight, maxHeight);
      var rawLeft = Number(bounds.left);
      var rawTop = Number(bounds.top);
      if (!Number.isFinite(rawLeft)) rawLeft = (limits.width - width) / 2;
      if (!Number.isFinite(rawTop)) rawTop = (limits.height - height) / 2;
      var left = clamp(rawLeft, margin, Math.max(margin, limits.width - margin - width));
      var top = clamp(rawTop, margin, Math.max(margin, limits.height - margin - height));
      return { left: left, top: top, width: width, height: height };
    }

    var defaultWidth = Math.min(1240, window.innerWidth - (margin * 2));
    var defaultHeight = Math.min(880, window.innerHeight - (margin * 2));
    var initial = saved && saved.width && saved.height ? saved : {
      width: defaultWidth,
      height: defaultHeight,
      left: (window.innerWidth - defaultWidth) / 2,
      top: (window.innerHeight - defaultHeight) / 2
    };
    modal.classList.add("smv-resizable-modal");
    applyBounds(constrainedBounds(initial));

    var active = null;
    var edges = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];
    edges.forEach(function (edge) {
      var handle = el("div", "smv-resize-handle smv-resize-" + edge);
      handle.setAttribute("aria-hidden", "true");
      handle.dataset.edge = edge;
      handle.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        var rect = modal.getBoundingClientRect();
        active = {
          edge: edge,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
        handle.setPointerCapture(event.pointerId);
        document.body.classList.add("smv-is-resizing");
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
      });
      modal.appendChild(handle);
    });

    function onPointerMove(event) {
      if (!active || event.pointerId !== active.pointerId) return;
      event.preventDefault();
      var limits = viewportLimits();
      var dx = event.clientX - active.startX;
      var dy = event.clientY - active.startY;
      var left = active.left;
      var top = active.top;
      var right = active.right;
      var bottom = active.bottom;
      if (active.edge.indexOf("w") !== -1) left = clamp(active.left + dx, margin, active.right - limits.minWidth);
      if (active.edge.indexOf("e") !== -1) right = clamp(active.right + dx, active.left + limits.minWidth, limits.width - margin);
      if (active.edge.indexOf("n") !== -1) top = clamp(active.top + dy, margin, active.bottom - limits.minHeight);
      if (active.edge.indexOf("s") !== -1) bottom = clamp(active.bottom + dy, active.top + limits.minHeight, limits.height - margin);
      applyBounds({ left: left, top: top, width: right - left, height: bottom - top });
    }

    function saveCurrentBounds() {
      var rect = modal.getBoundingClientRect();
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }));
      } catch (e) {
        // Resizing still works when browser storage is unavailable.
      }
    }

    function onPointerUp(event) {
      if (!active || event.pointerId !== active.pointerId) return;
      active = null;
      document.body.classList.remove("smv-is-resizing");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      saveCurrentBounds();
    }

    function onWindowResize() {
      var rect = modal.getBoundingClientRect();
      applyBounds(constrainedBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }));
      saveCurrentBounds();
    }

    window.addEventListener("resize", onWindowResize);
    return function () {
      active = null;
      document.body.classList.remove("smv-is-resizing");
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }

  function openVariantReviewModal() {
    var existing = document.querySelector(".smv-review-backdrop");
    if (existing) {
      var existingModal = existing.querySelector(".smv-review-modal");
      if (existingModal && existingModal._smvResizeCleanup) existingModal._smvResizeCleanup();
      existing.remove();
    }

    var state = loadReviewState();
    var backdrop = el("div", "smv-modal-backdrop smv-review-backdrop");
    var modal = el("div", "smv-modal smv-review-modal");
    var status = el("div", "smv-review-summary", "");
    var controls = el("div", "smv-review-controls");
    var filter = document.createElement("select");
    filter.className = "smv-review-filter";
    filter.setAttribute("aria-label", "Filter candidate families");
    [
      ["all", "All families"],
      ["approved", "Approved"],
      ["auto_suggest", "Suggested"],
      ["review", "Needs review"],
      ["ignore", "Ignored"]
    ].forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry[0];
      option.textContent = entry[1];
      filter.appendChild(option);
    });
    var search = document.createElement("input");
    search.type = "search";
    search.className = "smv-review-search";
    search.placeholder = "Filter by scene title or ID";
    search.setAttribute("aria-label", "Filter candidate scenes");
    var approvalActions = el("div", "smv-approval-actions");
    var approvalButton = button("Approval", function () {
      bulkActions.classList.remove("is-open");
      bulkButton.setAttribute("aria-expanded", "false");
      approvalActions.classList.toggle("is-open");
      approvalButton.setAttribute("aria-expanded", approvalActions.classList.contains("is-open") ? "true" : "false");
    }, "apply");
    approvalButton.classList.add("smv-approval-actions-button");
    approvalButton.setAttribute("aria-haspopup", "menu");
    approvalButton.setAttribute("aria-expanded", "false");
    var approvalMenu = el("div", "smv-approval-actions-menu");
    approvalMenu.setAttribute("role", "menu");
    approvalMenu.appendChild(button("Approve All Suggested", function () {
      setFamilyApprovals((state.families || []).filter(function (family) { return family.status === "auto_suggest"; }), true);
    }, "quiet"));
    approvalMenu.appendChild(button("Approve Visible", function () {
      setFamilyApprovals(visibleFamilies(), true);
    }, "quiet"));
    approvalMenu.appendChild(button("Unapprove Visible", function () {
      setFamilyApprovals(visibleFamilies(), false);
    }, "quiet"));
    approvalMenu.appendChild(button("Clear All Approvals", function () {
      setFamilyApprovals(state.families || [], false);
    }, "danger"));
    approvalActions.appendChild(approvalButton);
    approvalActions.appendChild(approvalMenu);
    var editToggle = button("Select Scenes", function () {
      editMode = !editMode;
      if (!editMode) clearSceneSelection();
      render();
    }, "attach");
    editToggle.classList.add("smv-edit-selection-toggle");
    var bulkActions = el("div", "smv-bulk-actions");
    var bulkButton = button("Actions (0)", function () {
      if (bulkButton.disabled) return;
      approvalActions.classList.remove("is-open");
      approvalButton.setAttribute("aria-expanded", "false");
      bulkActions.classList.toggle("is-open");
      bulkButton.setAttribute("aria-expanded", bulkActions.classList.contains("is-open") ? "true" : "false");
    }, "attach");
    bulkButton.classList.add("smv-bulk-actions-button");
    bulkButton.setAttribute("aria-haspopup", "menu");
    bulkButton.setAttribute("aria-expanded", "false");
    var bulkMenu = el("div", "smv-bulk-actions-menu");
    bulkMenu.setAttribute("role", "menu");
    bulkMenu.appendChild(button("Merge Families", openMergeSelectedFamilies, "quiet"));
    bulkMenu.appendChild(button("Move Scenes", openMoveSelectedScenes, "quiet"));
    bulkMenu.appendChild(button("Create Family From Scenes", createFamilyFromSelectedScenes, "quiet"));
    bulkMenu.appendChild(button("Remove Scenes From Families", removeSelectedScenes, "danger"));
    bulkMenu.appendChild(button("Remove Selected Families", deleteSelectedFamilies, "danger"));
    bulkActions.appendChild(bulkButton);
    bulkActions.appendChild(bulkMenu);
    var visibleCount = el("span", "smv-review-visible-count", "");
    controls.appendChild(filter);
    controls.appendChild(search);
    controls.appendChild(approvalActions);
    controls.appendChild(editToggle);
    controls.appendChild(bulkActions);
    controls.appendChild(visibleCount);
    var list = el("div", "smv-review-list");
    var footer = el("div", "smv-modal-footer smv-review-footer");
    var scan = button("Discover Families", runDiscovery, "primary");
    var createManual = button("Create Manual Family", createManualFamily, "attach");
    var dryRun = button("Preview Approved Links", queueDryRun, "preview");
    var live = button("Create Variant Sets", applyLive, "apply");
    var clear = button("Reset Review", function () {
      if (!window.confirm("Clear saved candidate review draft?")) return;
      state = emptyReviewState();
      activeFilter = "all";
      searchText = "";
      selectedSceneIds = {};
      editMode = false;
      filter.value = "all";
      search.value = "";
      saveReviewState(state);
      render();
    });
    var close = button("Close", function () {
      stopProgressTimer();
      if (modal._smvResizeCleanup) modal._smvResizeCleanup();
      backdrop.remove();
    }, "quiet");

    var activeFilter = "all";
    var searchText = "";
    var selectedSceneIds = {};
    var editMode = false;
    var isDiscovering = false;
    var progressStartedAt = 0;
    var progressTimer = null;
    var familyDrag = null;
    var familyDragFrame = 0;
    var suppressFamilyClickUntil = 0;

    filter.addEventListener("change", function () {
      activeFilter = filter.value;
      render();
    });
    search.addEventListener("input", function () {
      searchText = search.value.trim().toLowerCase();
      render();
    });
    modal.addEventListener("click", function (event) {
      if (!approvalActions.contains(event.target)) {
        approvalActions.classList.remove("is-open");
        approvalButton.setAttribute("aria-expanded", "false");
      }
      if (!bulkActions.contains(event.target)) {
        bulkActions.classList.remove("is-open");
        bulkButton.setAttribute("aria-expanded", "false");
      }
    });
    modal.addEventListener("click", function (event) {
      if (Date.now() >= suppressFamilyClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    footer.appendChild(scan);
    footer.appendChild(createManual);
    footer.appendChild(dryRun);
    footer.appendChild(live);
    footer.appendChild(clear);
    footer.appendChild(close);
    modal.appendChild(brandHeader("Variant Family Review"));
    modal.appendChild(status);
    modal.appendChild(controls);
    modal.appendChild(list);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) {
        stopProgressTimer();
        if (modal._smvResizeCleanup) modal._smvResizeCleanup();
        backdrop.remove();
      }
    });
    document.body.appendChild(backdrop);
    modal._smvResizeCleanup = makeResizableReviewModal(modal);

    function render() {
      list.innerHTML = "";
      var families = state.families || [];
      var approved = approvedPayload(state);
      if (isDiscovering) {
        renderDiscoveryProgress();
        return;
      }
      var filtered = visibleFamilies();
      updateReviewSummary();
      visibleCount.textContent = filtered.length + " shown";
      updateBulkActions();
      editToggle.textContent = editMode ? "Done Selecting" : "Select Scenes";
      editToggle.classList.toggle("is-active", editMode);
      bulkActions.hidden = !editMode;
      controls.classList.toggle("is-empty", !families.length);
      scan.disabled = false;
      createManual.disabled = false;
      clear.disabled = false;
      approvalButton.disabled = false;
      editToggle.disabled = false;
      live.disabled = !approved.length;
      live.textContent = state.lastDryRunAt ? "Create Variant Sets" : "Preview Required";
      live.title = state.lastDryRunAt
        ? "Create the approved variant sets."
        : "Queue the required dry-run preview. Your review draft and approvals are preserved.";
      live.classList.toggle("is-preview-required", !state.lastDryRunAt && approved.length > 0);
      dryRun.disabled = !approved.length;
      if (!families.length) {
        var empty = el("div", "smv-empty-state");
        empty.appendChild(el("div", "smv-empty-state-title", "No candidates yet"));
        empty.appendChild(el("div", "smv-empty", "Discovery results will appear here as reviewable scene families."));
        list.appendChild(empty);
        return;
      }
      if (!filtered.length) {
        list.appendChild(el("div", "smv-empty-state", "No candidate families match this filter."));
        return;
      }
      filtered.forEach(function (family) {
        list.appendChild(renderFamily(family));
      });
    }

    function stopProgressTimer() {
      if (progressTimer) window.clearInterval(progressTimer);
      progressTimer = null;
    }

    function elapsedSeconds() {
      return Math.max(0, (Date.now() - progressStartedAt) / 1000).toFixed(1);
    }

    function markDraftChanged() {
      state.lastDryRunAt = "";
      state.lastDryRunJobId = "";
      saveReviewState(state);
    }

    function visibleFamilies() {
      return (state.families || []).filter(function (family) {
        var approval = approvalForFamily(state, family);
        if (activeFilter === "approved" && !approval.approved) return false;
        if (activeFilter === "auto_suggest" && family.status !== "auto_suggest") return false;
        if ((activeFilter === "review" || activeFilter === "ignore") &&
            (approval.approved || family.status !== activeFilter)) return false;
        return !searchText || familySearchText(family).indexOf(searchText) !== -1;
      });
    }

    function updateReviewSummary() {
      var families = state.families || [];
      var approvedCount = families.filter(function (family) {
        var approval = state.approvals[family.familyId];
        return approval && approval.approved;
      }).length;
      var needsReviewCount = Math.max(0, families.length - approvedCount);
      var discoverySummary = state.lastDiscoveryAt
        ? "Last discovery: " + state.lastDiscoveryCount + " actionable families in " + state.lastDiscoverySeconds + "s" +
          " | omitted " + (Number(state.lastSuppressedExisting) || 0) + " already-linked families" +
          " and " + (Number(state.lastSuppressedSingletons) || 0) + " unsupported singletons"
        : "Discovery has not been run in this browser.";
      var previewSummary = state.lastDryRunAt ? "preview ready" : "preview required";
      status.textContent = families.length
        ? approvedCount + " approved | " + needsReviewCount + " need review | " + selectedSceneCount() + " scenes selected for editing | " + previewSummary + " | " + families.length + " families. " + discoverySummary
        : "No candidate families loaded. Select Discover Families to begin.";
    }

    function setFamilyApprovals(families, approved) {
      (families || []).forEach(function (family) {
        var approval = approvalForFamily(state, family);
        approval.approved = approved;
        approval.manualApproval = true;
      });
      approvalActions.classList.remove("is-open");
      approvalButton.setAttribute("aria-expanded", "false");
      markDraftChanged();
      render();
    }

    function selectedSceneCount() {
      return Object.keys(selectedSceneIds).filter(function (sceneId) { return selectedSceneIds[sceneId]; }).length;
    }

    function updateBulkActions() {
      var count = selectedSceneCount();
      bulkButton.textContent = "Actions (" + count + ")";
      bulkButton.disabled = !editMode || count === 0 || isDiscovering;
      if (bulkButton.disabled) bulkActions.classList.remove("is-open");
      bulkButton.setAttribute("aria-expanded", bulkActions.classList.contains("is-open") ? "true" : "false");
    }

    function sceneSelectionCheckbox(sceneId, label) {
      var selectScene = document.createElement("input");
      selectScene.type = "checkbox";
      selectScene.className = "smv-scene-selector";
      selectScene.checked = !!selectedSceneIds[String(sceneId)];
      selectScene.setAttribute("aria-label", label || ("Select scene " + sceneId));
      selectScene.addEventListener("change", function () {
        if (selectScene.checked) selectedSceneIds[String(sceneId)] = true;
        else delete selectedSceneIds[String(sceneId)];
        updateBulkActions();
        updateReviewSummary();
      });
      return selectScene;
    }

    function renderDiscoveryProgress() {
      var elapsed = elapsedSeconds();
      status.textContent = "Discovering candidate variants | " + elapsed + "s elapsed";
      controls.classList.add("is-empty");
      visibleCount.textContent = "";
      scan.disabled = true;
      createManual.disabled = true;
      dryRun.disabled = true;
      live.disabled = true;
      clear.disabled = true;
      approvalButton.disabled = true;
      editToggle.disabled = true;
      var progress = el("div", "smv-discovery-progress");
      progress.setAttribute("role", "status");
      progress.setAttribute("aria-live", "polite");
      progress.appendChild(el("div", "smv-discovery-spinner"));
      var copy = el("div", "smv-discovery-copy");
      copy.appendChild(el("div", "smv-discovery-title", "Checking duplicate fingerprints and scene evidence"));
      copy.appendChild(el("div", "smv-result-meta", "Candidate families will appear here when the scan completes."));
      progress.appendChild(copy);
      var track = el("div", "smv-discovery-track");
      track.appendChild(el("div", "smv-discovery-track-fill"));
      progress.appendChild(track);
      list.appendChild(progress);
    }

    function renderFamily(family) {
      var approval = approvalForFamily(state, family);
      var card = el("div", "smv-review-family");
      card.setAttribute("data-family-id", family.familyId);
      card.classList.toggle("is-approved", !!approval.approved);
      var heading = el("div", "smv-review-family-heading");
      var proposedPrimary = memberById(family, approval.primarySceneId) || memberById(family, family.proposedPrimaryId);
      if (editMode && proposedPrimary) heading.appendChild(sceneSelectionCheckbox(proposedPrimary.sceneId, "Select " + proposedPrimary.title));
      var statusLabels = { auto_suggest: "Suggested", review: "Review", ignore: "Ignored" };
      var statusButton = el("button",
        "smv-family-status " + (approval.approved ? "smv-family-status-approved" : "smv-family-status-" + family.status),
        approval.approved ? "Approved" : (statusLabels[family.status] || family.status));
      statusButton.type = "button";
      statusButton.setAttribute("aria-pressed", approval.approved ? "true" : "false");
      setControlTooltip(statusButton, approval.approved
        ? "Approved for the next preview and apply. Click to return this family to review."
        : "Click to approve this family for the next preview and apply.");
      statusButton.addEventListener("click", function () {
        approval.approved = !approval.approved;
        approval.manualApproval = true;
        markDraftChanged();
        render();
      });
      heading.appendChild(statusButton);
      if (proposedPrimary) heading.appendChild(sceneThumbnail(proposedPrimary, "smv-primary-thumbnail"));
      heading.appendChild(sceneLink(proposedPrimary, "smv-review-family-title smv-scene-link"));
      if (proposedPrimary && proposedPrimary.parentSignals && proposedPrimary.parentSignals.length) {
        heading.appendChild(el("span", "smv-parent-signal", proposedPrimary.parentSignals.join(", ")));
      }
      heading.appendChild(el("span", "smv-family-id", family.familyId));
      card.appendChild(heading);
      var existingMembers = existingFamilyMembers(family);
      var additions = candidateMembers(family);
      var candidateType = family.evidence && family.evidence.candidateType;
      var purpose = "Create a new family from " + additions.length + " related unassigned scenes.";
      if (candidateType === "attach_to_existing") {
        purpose = "Add " + additions.length + " proposed " + (additions.length === 1 ? "scene" : "scenes") +
          " to the existing " + existingMembers.length + "-scene family below.";
      } else if (candidateType === "replace_existing_primary") {
        purpose = "Rebuild this family around the preferred unnumbered or standard scene while retaining the existing links.";
      } else if (candidateType === "merge_existing_families") {
        purpose = "Merge the related existing sets and new matches under the preferred primary.";
      } else if (candidateType === "split_existing_family") {
        purpose = "Split these matching scenes out of a mixed existing set. Scenes from other explicit versions will remain separate.";
      }
      card.appendChild(el("div", "smv-family-purpose", purpose));
      card.appendChild(el("div", "smv-result-meta", evidenceText(family)));
      var meter = el("div", "smv-confidence-meter");
      var meterFill = el("div", "smv-confidence-meter-fill");
      meterFill.style.width = pct(family.confidence);
      meter.appendChild(meterFill);
      card.appendChild(meter);

      var primaryRow = el("label", "smv-review-primary");
      primaryRow.appendChild(document.createTextNode("Primary "));
      var select = document.createElement("select");
      select.setAttribute("aria-label", "Choose the primary scene for this variant family");
      (family.members || []).forEach(function (member) {
        var option = document.createElement("option");
        option.value = String(member.sceneId);
        option.textContent = member.title + " (ID " + member.sceneId + ")";
        select.appendChild(option);
      });
      select.value = String(approval.primarySceneId);
      if (candidateType === "attach_to_existing") {
        select.disabled = true;
        setControlTooltip(select, "The existing family primary remains the target. Use the editing actions to reorganize established families.");
      }
      select.addEventListener("change", function () {
        approval.primarySceneId = select.value;
        resetApprovalChildren(family, approval);
        approval.approved = false;
        approval.manualApproval = true;
        markDraftChanged();
        render();
      });
      primaryRow.appendChild(select);
      card.appendChild(primaryRow);

      var editActions = el("div", "smv-family-edit-actions");
      editActions.appendChild(button("Add Scene", function () { addSceneToFamily(family.familyId); }, "attach"));
      card.appendChild(editActions);

      if (existingMembers.length) {
        var existingContext = el("div", "smv-existing-family-context");
        existingContext.appendChild(el("div", "smv-existing-family-title", "Existing family (" + existingMembers.length + " scenes)"));
        var existingList = el("div", "smv-existing-family-members");
        existingMembers.forEach(function (member) {
          var existingRow = el("div", "smv-existing-family-member");
          existingRow.appendChild(sceneThumbnail(member, "smv-existing-thumbnail"));
          var relation = String(member.sceneId) === String(family.evidence.existingFamilyPrimaryId) ? "Primary" : "Current variant";
          var copy = el("div", "smv-existing-family-copy");
          copy.appendChild(el("div", "smv-existing-family-role", relation));
          copy.appendChild(sceneLink(member, "smv-scene-link"));
          existingRow.appendChild(copy);
          existingList.appendChild(existingRow);
        });
        existingContext.appendChild(existingList);
        card.appendChild(existingContext);
      }

      var members = el("div", "smv-review-members");
      if (existingMembers.length) {
        members.appendChild(el("div", "smv-proposed-additions-title",
          candidateType === "attach_to_existing" ? "Proposed additions" : "Members in rebuilt family"));
      }
      (approval.children || []).forEach(function (child) {
        var member = memberById(family, child.sceneId);
        var row = el("div", "smv-review-member");
        if (editMode) row.appendChild(sceneSelectionCheckbox(child.sceneId, "Select " + (member ? member.title : ("scene " + child.sceneId))));
        var includedIndicator = el("span", "smv-member-included", "Included");
        includedIndicator.title = "This scene is a member of the draft family and will be linked when the family is approved.";
        var label = document.createElement("input");
        label.type = "text";
        label.value = child.label || "Variant";
        label.setAttribute("aria-label", "Edit variant label for " + (member ? member.title : ("scene " + child.sceneId)));
        label.addEventListener("change", function () {
          child.label = label.value || "Variant";
          approval.approved = false;
          approval.manualApproval = true;
          markDraftChanged();
          render();
        });
        row.appendChild(includedIndicator);
        if (member) row.appendChild(sceneThumbnail(member));
        var memberLink = sceneLink(member, "smv-review-member-title smv-scene-link");
        memberLink.appendChild(document.createTextNode(" (ID " + child.sceneId + ")"));
        row.appendChild(memberLink);
        row.appendChild(label);
        if (member && member.variantTokens && member.variantTokens.length) {
          row.appendChild(el("span", "smv-review-token", member.variantTokens.join(", ")));
        }
        if (member && member.parentSignals && member.parentSignals.length) {
          row.appendChild(el("span", "smv-parent-signal", member.parentSignals.join(", ")));
        }
        members.appendChild(row);
      });
      card.appendChild(members);
      setupFamilyDrag(card, family);
      return card;
    }

    function familyDragInteractiveTarget(target) {
      return !!(target && target.closest && target.closest(
        "a, button, input, select, textarea, label, [role='button'], [contenteditable='true'], .smv-scene-thumbnail"
      ));
    }

    function clearFamilyDropTarget() {
      if (!familyDrag || !familyDrag.targetCard) return;
      familyDrag.targetCard.classList.remove("is-drop-target", "is-drop-invalid");
      familyDrag.targetCard = null;
      familyDrag.targetId = "";
    }

    function stopFamilyDragScroll() {
      if (familyDragFrame) window.cancelAnimationFrame(familyDragFrame);
      familyDragFrame = 0;
    }

    function autoScrollFamilyDrag() {
      familyDragFrame = 0;
      if (!familyDrag || !familyDrag.active) return;
      var rect = list.getBoundingClientRect();
      var edge = Math.min(92, Math.max(52, rect.height * 0.16));
      var velocity = 0;
      if (familyDrag.pointerY < rect.top + edge) {
        velocity = -22 * Math.min(1, Math.max(0, (rect.top + edge - familyDrag.pointerY) / edge));
      } else if (familyDrag.pointerY > rect.bottom - edge) {
        velocity = 22 * Math.min(1, Math.max(0, (familyDrag.pointerY - (rect.bottom - edge)) / edge));
      }
      if (velocity) {
        list.scrollTop += velocity;
        updateFamilyDropTarget(familyDrag.pointerX, familyDrag.pointerY);
      }
      familyDragFrame = window.requestAnimationFrame(autoScrollFamilyDrag);
    }

    function updateFamilyDropTarget(clientX, clientY) {
      if (!familyDrag || !familyDrag.active) return;
      var hit = document.elementFromPoint(clientX, clientY);
      var targetCard = hit && hit.closest && hit.closest(".smv-review-family");
      if (!targetCard || targetCard === familyDrag.sourceCard) targetCard = null;
      if (familyDrag.targetCard === targetCard) return;
      clearFamilyDropTarget();
      if (!targetCard) return;
      var targetId = targetCard.getAttribute("data-family-id") || "";
      var source = draftFamilyById(familyDrag.sourceId);
      var target = draftFamilyById(targetId);
      var compatible = source && target &&
        reviewIdentityCompatible(reviewFamilyIdentity(source), reviewFamilyIdentity(target));
      familyDrag.targetCard = targetCard;
      familyDrag.targetId = targetId;
      targetCard.classList.add(compatible ? "is-drop-target" : "is-drop-invalid");
    }

    function beginFamilyDrag() {
      if (!familyDrag || familyDrag.active) return;
      familyDrag.active = true;
      familyDrag.sourceCard.classList.add("is-dragging");
      document.body.classList.add("smv-is-family-dragging");
      var source = draftFamilyById(familyDrag.sourceId);
      var primary = source && (memberById(source, source.proposedPrimaryId) || (source.members || [])[0]);
      var ghost = el("div", "smv-family-drag-ghost");
      ghost.appendChild(el("div", "smv-family-drag-title", primary ? primary.title : "Variant family"));
      ghost.appendChild(el("div", "smv-family-drag-meta", ((source && source.members || []).length) + " scenes | Drop onto another family to merge"));
      document.body.appendChild(ghost);
      familyDrag.ghost = ghost;
      familyDragFrame = window.requestAnimationFrame(autoScrollFamilyDrag);
    }

    function moveFamilyDrag(event) {
      if (!familyDrag || event.pointerId !== familyDrag.pointerId) return;
      familyDrag.pointerX = event.clientX;
      familyDrag.pointerY = event.clientY;
      var distance = Math.hypot(event.clientX - familyDrag.startX, event.clientY - familyDrag.startY);
      if (!familyDrag.active && distance >= 7) beginFamilyDrag();
      if (!familyDrag.active) return;
      event.preventDefault();
      if (familyDrag.ghost) {
        familyDrag.ghost.style.transform = "translate3d(" + (event.clientX + 14) + "px," + (event.clientY + 14) + "px,0)";
      }
      updateFamilyDropTarget(event.clientX, event.clientY);
    }

    function finishFamilyDrag(event) {
      if (!familyDrag || event.pointerId !== familyDrag.pointerId) return;
      var sourceId = familyDrag.sourceId;
      var targetId = familyDrag.targetId;
      var wasActive = familyDrag.active;
      stopFamilyDragScroll();
      clearFamilyDropTarget();
      if (familyDrag.sourceCard) familyDrag.sourceCard.classList.remove("is-dragging");
      if (familyDrag.ghost) familyDrag.ghost.remove();
      document.body.classList.remove("smv-is-family-dragging");
      window.removeEventListener("pointermove", moveFamilyDrag);
      window.removeEventListener("pointerup", finishFamilyDrag);
      window.removeEventListener("pointercancel", cancelFamilyDrag);
      familyDrag = null;
      if (!wasActive) return;
      suppressFamilyClickUntil = Date.now() + 350;
      event.preventDefault();
      if (targetId && targetId !== sourceId) mergeFamilyDrafts(targetId, sourceId);
    }

    function cancelFamilyDrag(event) {
      if (!familyDrag || (event && event.pointerId !== familyDrag.pointerId)) return;
      stopFamilyDragScroll();
      clearFamilyDropTarget();
      if (familyDrag.sourceCard) familyDrag.sourceCard.classList.remove("is-dragging");
      if (familyDrag.ghost) familyDrag.ghost.remove();
      document.body.classList.remove("smv-is-family-dragging");
      window.removeEventListener("pointermove", moveFamilyDrag);
      window.removeEventListener("pointerup", finishFamilyDrag);
      window.removeEventListener("pointercancel", cancelFamilyDrag);
      familyDrag = null;
    }

    function setupFamilyDrag(card, family) {
      card.addEventListener("pointerdown", function (event) {
        if (event.button !== 0 || isDiscovering || familyDrag || familyDragInteractiveTarget(event.target)) return;
        familyDrag = {
          pointerId: event.pointerId,
          sourceId: family.familyId,
          sourceCard: card,
          targetCard: null,
          targetId: "",
          startX: event.clientX,
          startY: event.clientY,
          pointerX: event.clientX,
          pointerY: event.clientY,
          active: false,
          ghost: null
        };
        event.preventDefault();
        window.addEventListener("pointermove", moveFamilyDrag, { passive: false });
        window.addEventListener("pointerup", finishFamilyDrag);
        window.addEventListener("pointercancel", cancelFamilyDrag);
      });
    }

    function draftFamilyById(familyId) {
      var found = null;
      (state.families || []).forEach(function (family) {
        if (family.familyId === familyId) found = family;
      });
      return found;
    }

    function preferencesForFamilies(familyIds) {
      var preferences = {};
      (familyIds || []).forEach(function (familyId) {
        var approval = state.approvals[familyId];
        (approval && approval.children || []).forEach(function (child) {
          preferences[String(child.sceneId)] = { label: child.label || "Variant" };
        });
      });
      return preferences;
    }

    function makeManualFamily(members, sourceFamilies) {
      var unique = {};
      (members || []).forEach(function (member) {
        var id = String(member.sceneId);
        if (!unique[id]) unique[id] = member;
        else if (member.isCanonicalOriginal) unique[id].isCanonicalOriginal = true;
      });
      var list = Object.keys(unique).map(function (id) { return unique[id]; });
      var existingTargets = {};
      var existingIds = {};
      (sourceFamilies || []).forEach(function (family) {
        var evidence = family && family.evidence || {};
        if (evidence.candidateType !== "attach_to_existing" || !evidence.existingFamilyPrimaryId) return;
        existingTargets[String(evidence.existingFamilyPrimaryId)] = true;
        evidenceSceneIds(family, "existingFamilySceneIds").forEach(function (id) { existingIds[id] = true; });
      });
      var targetIds = Object.keys(existingTargets);
      var preservedTargetId = targetIds.length === 1 ? targetIds[0] : "";
      var primary = preservedTargetId ? memberById({ members: list }, preservedTargetId) : null;
      primary = primary || preferredReviewPrimary(list) || list[0];
      list.forEach(function (member) {
        var isPrimary = primary && String(member.sceneId) === String(primary.sceneId);
        member.role = isPrimary ? "parent" : "child";
        if (preservedTargetId) {
          member.relationshipState = existingIds[String(member.sceneId)]
            ? (isPrimary ? "existing_primary" : "existing_child")
            : "proposed_addition";
        }
        if (isPrimary) member.label = "Primary";
        else if (!member.label || member.label === "Primary") member.label = "Variant";
      });
      var confidence = 0;
      (sourceFamilies || []).forEach(function (family) { confidence = Math.max(confidence, Number(family.confidence) || 0); });
      var identity = {};
      list.forEach(function (member) {
        var next = member.identity || {};
        if (!identity.artistKey && next.artistKey) {
          identity.artistKey = next.artistKey;
          identity.artistLabel = next.artistLabel;
        }
        if (!identity.characterKey && next.characterKey) {
          identity.characterKey = next.characterKey;
          identity.characterLabels = next.characterLabels;
        }
      });
      var candidateIds = list.filter(function (member) {
        return !preservedTargetId || !existingIds[String(member.sceneId)];
      }).map(function (member) { return String(member.sceneId); });
      var retainedExistingIds = list.filter(function (member) {
        return preservedTargetId && existingIds[String(member.sceneId)];
      }).map(function (member) { return String(member.sceneId); });
      return {
        familyId: preservedTargetId
          ? "nsv2-existing-" + preservedTargetId + "-add-" + candidateIds.slice().sort(function (a, b) {
            return a.localeCompare(b, undefined, { numeric: true });
          }).join("-")
          : reviewFamilyId(list),
        status: "review",
        confidence: confidence,
        proposedPrimaryId: primary ? String(primary.sceneId) : "",
        members: list,
        identity: identity,
        evidence: {
          stashDuplicateCluster: (sourceFamilies || []).some(function (family) { return family.evidence && family.evidence.stashDuplicateCluster; }),
          source: "manual",
          candidateType: preservedTargetId ? "attach_to_existing" : "manual",
          candidateSceneIds: candidateIds,
          existingFamilySceneIds: retainedExistingIds,
          existingFamilyPrimaryId: preservedTargetId,
          manualEdited: true,
          filenameSimilarity: 0,
          metadataOverlap: 0,
          sceneIds: list.map(function (member) { return String(member.sceneId); })
        }
      };
    }

    function replaceDraftFamilies(oldIds, newFamily, preferences) {
      var firstIndex = state.families.length;
      state.families.forEach(function (family, index) {
        if (oldIds.indexOf(family.familyId) !== -1) firstIndex = Math.min(firstIndex, index);
      });
      state.families = state.families.filter(function (family) { return oldIds.indexOf(family.familyId) === -1; });
      if (newFamily && reviewableFamily(newFamily)) state.families.splice(Math.min(firstIndex, state.families.length), 0, newFamily);
      oldIds.forEach(function (familyId) { delete state.approvals[familyId]; });
      if (newFamily && reviewableFamily(newFamily)) {
        var approval = {
          familyId: newFamily.familyId,
          approved: false,
          primarySceneId: String(newFamily.proposedPrimaryId),
          children: []
        };
        candidateMembers(newFamily).forEach(function (member) {
          if (String(member.sceneId) === approval.primarySceneId) return;
          var prior = preferences[String(member.sceneId)] || {};
          approval.children.push({ sceneId: String(member.sceneId), include: true, label: prior.label || member.label || "Variant" });
        });
        state.approvals[newFamily.familyId] = approval;
      }
      markDraftChanged();
      render();
    }

    function mergeFamilyDrafts(targetId, sourceId) {
      var target = draftFamilyById(targetId);
      var source = draftFamilyById(sourceId);
      if (!target || !source || target === source) return;
      if (!reviewIdentityCompatible(reviewFamilyIdentity(target), reviewFamilyIdentity(source))) {
        window.alert("These families have different known artists or characters and cannot be merged.");
        return;
      }
      var preferences = preferencesForFamilies([targetId, sourceId]);
      var merged = makeManualFamily((target.members || []).concat(source.members || []), [target, source]);
      replaceDraftFamilies([targetId, sourceId], merged, preferences);
    }

    function selectedSceneRecords() {
      var records = [];
      (state.families || []).forEach(function (family) {
        (family.members || []).forEach(function (member) {
          if (selectedSceneIds[String(member.sceneId)]) records.push({ family: family, member: member });
        });
      });
      return records;
    }

    function selectedFamilyIds(records) {
      var ids = {};
      (records || selectedSceneRecords()).forEach(function (record) { ids[record.family.familyId] = true; });
      return Object.keys(ids);
    }

    function clearSceneSelection() {
      selectedSceneIds = {};
      bulkActions.classList.remove("is-open");
    }

    function replaceFamiliesBatch(oldIds, newFamilies, preferences) {
      var firstIndex = state.families.length;
      state.families.forEach(function (family, index) {
        if (oldIds.indexOf(family.familyId) !== -1) firstIndex = Math.min(firstIndex, index);
      });
      state.families = state.families.filter(function (family) { return oldIds.indexOf(family.familyId) === -1; });
      oldIds.forEach(function (familyId) { delete state.approvals[familyId]; });
      (newFamilies || []).filter(reviewableFamily).forEach(function (family, offset) {
        state.families.splice(Math.min(firstIndex + offset, state.families.length), 0, family);
        var approval = {
          familyId: family.familyId,
          approved: false,
          primarySceneId: String(family.proposedPrimaryId),
          children: []
        };
        candidateMembers(family).forEach(function (member) {
          if (String(member.sceneId) === approval.primarySceneId) return;
          var prior = preferences[String(member.sceneId)] || {};
          approval.children.push({ sceneId: String(member.sceneId), include: true, label: prior.label || member.label || "Variant" });
        });
        state.approvals[family.familyId] = approval;
      });
      clearSceneSelection();
      markDraftChanged();
      render();
    }

    function openFamilySearchModal(title, excludedIds, onSelect, selectedAction) {
      var excluded = {};
      (excludedIds || []).forEach(function (familyId) { excluded[familyId] = true; });
      var candidates = (state.families || []).filter(function (family) { return !excluded[family.familyId]; });
      var backdrop = el("div", "smv-modal-backdrop");
      var modal = el("div", "smv-modal smv-family-search-modal");
      modal.appendChild(brandHeader(title));
      var input = el("input", "smv-search-input");
      input.type = "search";
      input.placeholder = "Search family title, artist, character, or scene ID";
      input.setAttribute("aria-label", "Search variant families");
      modal.appendChild(input);
      if (selectedAction) {
        var selectedActionButton = button(selectedAction.label, function () {
          backdrop.remove();
          selectedAction.run();
        }, "primary");
        selectedActionButton.classList.add("smv-family-search-selected-action");
        modal.appendChild(selectedActionButton);
      }
      var results = el("div", "smv-family-search-results");
      modal.appendChild(results);
      var footer = el("div", "smv-modal-footer");
      footer.appendChild(button("Cancel", function () { backdrop.remove(); }, "quiet"));
      modal.appendChild(footer);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      function renderCandidates() {
        var query = input.value.trim().toLowerCase();
        results.innerHTML = "";
        var filtered = candidates.filter(function (family) {
          return !query || familySearchText(family).indexOf(query) !== -1 ||
            evidenceText(family).toLowerCase().indexOf(query) !== -1;
        });
        if (!filtered.length) {
          results.appendChild(el("div", "smv-empty", "No matching families."));
          return;
        }
        filtered.forEach(function (family) {
          var primary = memberById(family, family.proposedPrimaryId) || (family.members || [])[0];
          var row = el("button", "smv-family-search-result");
          row.type = "button";
          row.setAttribute("aria-label", "Choose family " + (primary ? primary.title : family.familyId));
          if (primary) row.appendChild(sceneThumbnail(primary, "smv-search-thumbnail"));
          var copy = el("span", "smv-family-search-result-copy");
          copy.appendChild(el("span", "smv-result-title", primary ? primary.title : family.familyId));
          copy.appendChild(el("span", "smv-result-meta", (family.members || []).length + " scenes | " + evidenceText(family)));
          row.appendChild(copy);
          row.addEventListener("click", function () {
            backdrop.remove();
            onSelect(family);
          });
          results.appendChild(row);
        });
      }

      input.addEventListener("input", renderCandidates);
      input.addEventListener("keydown", function (event) {
        if (event.key === "Escape") backdrop.remove();
      });
      renderCandidates();
      input.focus();
    }

    function openMergeSelectedFamilies() {
      var records = selectedSceneRecords();
      var sourceIds = selectedFamilyIds(records);
      if (!records.length) return;
      function mergeFamilyIds(mergeIds) {
        var sourceFamilies = mergeIds.map(draftFamilyById).filter(Boolean);
        var targetIdentity = reviewFamilyIdentity(sourceFamilies[0]);
        if (sourceFamilies.some(function (family) { return !reviewIdentityCompatible(targetIdentity, reviewFamilyIdentity(family)); })) {
          window.alert("These families have different known artists or characters and cannot be merged.");
          return;
        }
        var preferences = preferencesForFamilies(mergeIds);
        var members = [];
        sourceFamilies.forEach(function (family) { members = members.concat(family.members || []); });
        var merged = makeManualFamily(members, sourceFamilies);
        replaceFamiliesBatch(mergeIds, [merged], preferences);
      }
      var selectedAction = sourceIds.length > 1 ? {
        label: "Merge " + sourceIds.length + " Selected Families",
        run: function () { mergeFamilyIds(sourceIds); }
      } : null;
      openFamilySearchModal("Merge Selected Families", sourceIds, function (target) {
        var mergeIds = sourceIds.concat([target.familyId]);
        mergeFamilyIds(mergeIds);
      }, selectedAction);
    }

    function openMoveSelectedScenes() {
      var records = selectedSceneRecords();
      var sourceIds = selectedFamilyIds(records);
      if (!records.length) return;
      openFamilySearchModal("Move Selected Scenes Into", sourceIds, function (target) {
        var targetIdentity = reviewFamilyIdentity(target);
        if (records.some(function (record) { return !reviewIdentityCompatible(targetIdentity, record.member.identity); })) {
          window.alert("One or more selected scenes have a different known artist or character and cannot be moved into that family.");
          return;
        }
        var affectedIds = sourceIds.concat([target.familyId]);
        var preferences = preferencesForFamilies(affectedIds);
        var movedIds = {};
        var movedMembers = [];
        records.forEach(function (record) {
          movedIds[String(record.member.sceneId)] = true;
          movedMembers.push(record.member);
        });
        var rebuilt = [];
        sourceIds.forEach(function (familyId) {
          var family = draftFamilyById(familyId);
          var remaining = (family.members || []).filter(function (member) { return !movedIds[String(member.sceneId)]; });
          if (remaining.length) rebuilt.push(makeManualFamily(remaining, [family]));
        });
        rebuilt.push(makeManualFamily((target.members || []).concat(movedMembers), [target].concat(sourceIds.map(draftFamilyById).filter(Boolean))));
        replaceFamiliesBatch(affectedIds, rebuilt, preferences);
      });
    }

    function createFamilyFromSelectedScenes() {
      var records = selectedSceneRecords();
      if (records.length < 2) {
        window.alert("Select at least two scenes to create a family.");
        return;
      }
      var sourceIds = selectedFamilyIds(records);
      var identity = records[0].member.identity;
      if (records.some(function (record) { return !reviewIdentityCompatible(identity, record.member.identity); })) {
        window.alert("The selected scenes have different known artists or characters and cannot form one family.");
        return;
      }
      var preferences = preferencesForFamilies(sourceIds);
      var selectedIds = {};
      records.forEach(function (record) { selectedIds[String(record.member.sceneId)] = true; });
      var rebuilt = [];
      sourceIds.forEach(function (familyId) {
        var family = draftFamilyById(familyId);
        var remaining = (family.members || []).filter(function (member) { return !selectedIds[String(member.sceneId)]; });
        if (remaining.length) rebuilt.push(makeManualFamily(remaining, [family]));
      });
      rebuilt.push(makeManualFamily(records.map(function (record) { return record.member; }), sourceIds.map(draftFamilyById).filter(Boolean)));
      replaceFamiliesBatch(sourceIds, rebuilt, preferences);
    }

    function removeSelectedScenes() {
      var records = selectedSceneRecords();
      if (!records.length) return;
      if (!window.confirm("Remove the selected scenes from their draft families? No Stash scene data will be changed.")) return;
      var sourceIds = selectedFamilyIds(records);
      var preferences = preferencesForFamilies(sourceIds);
      var selectedIds = {};
      records.forEach(function (record) {
        selectedIds[String(record.member.sceneId)] = true;
        delete preferences[String(record.member.sceneId)];
      });
      var rebuilt = [];
      sourceIds.forEach(function (familyId) {
        var family = draftFamilyById(familyId);
        var remaining = (family.members || []).filter(function (member) { return !selectedIds[String(member.sceneId)]; });
        if (remaining.length) rebuilt.push(makeManualFamily(remaining, [family]));
      });
      replaceFamiliesBatch(sourceIds, rebuilt, preferences);
    }

    function deleteSelectedFamilies() {
      var familyIds = selectedFamilyIds();
      if (!familyIds.length) return;
      if (!window.confirm("Remove " + familyIds.length + " selected draft families? No Stash scene data will be changed.")) return;
      replaceFamiliesBatch(familyIds, [], {});
    }

    function addSceneToFamily(familyId) {
      var family = draftFamilyById(familyId);
      if (!family) return;
      openSceneSearchModal("Add Scene to Variant Family", function (scene) {
        var sceneId = String(scene.id);
        var existingFamily = null;
        (state.families || []).forEach(function (candidate) {
          if ((candidate.members || []).some(function (member) { return String(member.sceneId) === sceneId; })) existingFamily = candidate;
        });
        if (existingFamily && existingFamily.familyId === familyId) {
          window.alert("That scene is already in this draft family.");
          return;
        }
        if (existingFamily) {
          if (window.confirm("That scene is already in another candidate family. Merge the two families?")) mergeFamilyDrafts(familyId, existingFamily.familyId);
          return;
        }
        var newMember = sceneToReviewMember(scene);
        if (!reviewIdentityCompatible(reviewFamilyIdentity(family), newMember.identity)) {
          window.alert("That scene has a different known artist or character and cannot be added to this family.");
          return;
        }
        var preferences = preferencesForFamilies([familyId]);
        var updated = makeManualFamily((family.members || []).concat([newMember]), [family]);
        replaceDraftFamilies([familyId], updated, preferences);
      });
    }

    function deleteDraftFamily(familyId) {
      if (!window.confirm("Remove this candidate family from the browser review draft? No Stash scene data will be changed.")) return;
      replaceDraftFamilies([familyId], null, {});
    }

    function createManualFamily() {
      openSceneSearchModal("Choose Primary for Manual Family", function (scene) {
        var sceneId = String(scene.id);
        var existingFamily = null;
        (state.families || []).forEach(function (candidate) {
          if ((candidate.members || []).some(function (member) { return String(member.sceneId) === sceneId; })) existingFamily = candidate;
        });
        if (existingFamily) {
          window.alert("That scene is already in a draft family. Use Add Scene or Merge Families on that family instead.");
          return;
        }
        var primaryMember = sceneToReviewMember(scene);
        openSceneSearchModal("Choose a Variant for the New Family", function (variantScene) {
          if (String(variantScene.id) === sceneId) {
            window.alert("Choose a different scene as the variant.");
            return;
          }
          var variantMember = sceneToReviewMember(variantScene);
          if (!reviewIdentityCompatible(primaryMember.identity, variantMember.identity)) {
            window.alert("The selected scenes have different known artists or characters and cannot form one family.");
            return;
          }
          var family = makeManualFamily([primaryMember, variantMember], []);
          family.proposedPrimaryId = sceneId;
          replaceDraftFamilies([], family, {});
        });
      });
    }

    function runDiscovery() {
      clearSceneSelection();
      editMode = false;
      isDiscovering = true;
      progressStartedAt = Date.now();
      stopProgressTimer();
      progressTimer = window.setInterval(render, 250);
      render();
      runPluginOperation({ mode: "discover_variant_candidates", dryRun: true }).then(function (result) {
        stopProgressTimer();
        isDiscovering = false;
        state.lastDiscoveryAt = new Date().toISOString();
        state.lastDiscoveryCount = (result && result.families || []).length;
        state.lastDiscoverySeconds = Number(elapsedSeconds());
        state.lastSuppressedExisting = Number(result && result.suppressedExistingFamilies) || 0;
        state.lastSuppressedSingletons = Number(result && result.suppressedSingletonSuggestions) || 0;
        state.needsMediaRefresh = false;
        mergeDiscoveredFamilies(state, result && result.families || []);
        render();
      }).catch(function (err) {
        stopProgressTimer();
        isDiscovering = false;
        scan.disabled = false;
        clear.disabled = false;
        status.textContent = "Discovery failed: " + (err && err.message || err);
        list.innerHTML = "";
        list.appendChild(el("div", "smv-error-state", "No candidate data was changed. Try discovery again after checking the Stash log."));
      });
    }

    function queueDryRun() {
      var approvals = approvedPayload(state);
      if (!approvals.length) return;
      dryRun.disabled = true;
      runPluginTask(TASKS.applyBatch, { mode: "preview_variant_batch", dryRun: true, approvalsJson: JSON.stringify(approvals) }).then(function (data) {
        state.lastDryRunAt = new Date().toISOString();
        state.lastDryRunJobId = taskJobId(data);
        saveReviewState(state);
        dryRun.disabled = false;
        render();
        window.alert("Approved links queued for preview" + (state.lastDryRunJobId ? " as job " + state.lastDryRunJobId : "") + ". Check the Stash task log before creating variant sets.");
      }).catch(function (err) {
        dryRun.disabled = false;
        window.alert("Dry run failed: " + (err && err.message || err));
      });
    }

    function applyLive() {
      var approvals = approvedPayload(state);
      if (!approvals.length) return;
      if (!state.lastDryRunAt) {
        if (!window.confirm("A dry-run preview is required before creating variant sets. Queue the preview now? Your current corrections and approvals will remain saved.")) return;
        queueDryRun();
        return;
      }
      if (!window.confirm("Create the approved variant sets? This writes only plugin-owned relationship metadata and keeps scenes and files separate.")) return;
      var args = { mode: "apply_variant_batch", confirmed: true, approvalsJson: JSON.stringify(approvals) };
      args.dryRun = false;
      live.disabled = true;
      runPluginTask(TASKS.applyBatch, args).then(function (data) {
        state.lastDryRunAt = "";
        state.lastDryRunJobId = "";
        saveReviewState(state);
        window.alert("Variant-set creation queued" + (taskJobId(data) ? " as job " + taskJobId(data) : "") + ". Refresh after the job finishes.");
        window.location.reload();
      }).catch(function (err) {
        live.disabled = false;
        window.alert("Live apply failed: " + (err && err.message || err));
      });
    }

    render();
    if (!state.families || !state.families.length || state.needsMediaRefresh) runDiscovery();
  }

  function openSceneSearchModal(title, onSelect) {
    var backdrop = el("div", "smv-modal-backdrop");
    var modal = el("div", "smv-modal");
    modal.appendChild(brandHeader(title));

    var searchRow = el("div", "smv-search-row");
    var input = el("input", "smv-search-input");
    input.type = "text";
    input.placeholder = "Search title, path, or paste scene ID";
    input.setAttribute("aria-label", "Search Stash scenes by title, path, or scene ID");
    var searchButton = button("Find Scene", runSearch, "primary");
    searchRow.appendChild(input);
    searchRow.appendChild(searchButton);
    modal.appendChild(searchRow);

    var results = el("div", "smv-search-results");
    modal.appendChild(results);

    var footer = el("div", "smv-modal-footer");
    footer.appendChild(button("Cancel", function () { backdrop.remove(); }, "quiet"));
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    input.focus();

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") runSearch();
      if (event.key === "Escape") backdrop.remove();
    });

    function runSearch() {
      var q = input.value.trim();
      results.textContent = "Searching...";
      searchScenes(q).then(function (scenes) {
        results.innerHTML = "";
        if (!scenes.length) {
          results.appendChild(el("div", "smv-empty", "No scenes found."));
          return;
        }
        scenes.forEach(function (scene) {
          var summary = sceneSummary(scene);
          var row = el("div", "smv-result");
          row.appendChild(sceneThumbnail(sceneToReviewMember(scene), "smv-search-thumbnail"));
          var main = el("div", "smv-result-main");
          main.appendChild(el("div", "smv-result-title", sceneTitle(scene)));
          main.appendChild(el("div", "smv-result-meta", "ID " + scene.id + " | " + variantStatus(scene)));
          if (summary.studio) main.appendChild(el("div", "smv-result-meta", "Studio: " + summary.studio));
          if (summary.groups) main.appendChild(el("div", "smv-result-meta", "Groups: " + summary.groups));
          if (summary.tags) main.appendChild(el("div", "smv-result-meta", "Tags: " + summary.tags));
          if (summary.path) main.appendChild(el("div", "smv-result-path", summary.path));
          row.appendChild(main);
          row.appendChild(button("Choose Scene", function () {
            backdrop.remove();
            onSelect(scene);
          }, "primary"));
          results.appendChild(row);
        });
      }).catch(function (err) {
        results.textContent = "Search failed: " + (err && err.message || err);
      });
    }
  }

  function renderPanel(scene, related) {
    var old = document.querySelector(".smv-panel");
    if (old) old.remove();

    var panel = el("section", "smv-panel");
    var panelBody = el("div", "smv-panel-body");
    panel.setAttribute("data-smv-scene-id", String(scene.id));
    panel.appendChild(panelBody);
    panelBody.appendChild(brandHeader("Variant Set Manager"));
    panelBody.appendChild(el("div", "smv-status", infoText(scene)));
    if (related.error) {
      panelBody.appendChild(el("div", "smv-load-warning", "The variant list could not be refreshed yet. Stash reported: " + related.error));
      panelBody.appendChild(button("Retry Variant List", function () {
        removePanel();
        scheduleScenePageSetup(0);
      }, "preview"));
    }

    var mode = el("label", "smv-mode");
    var dryRunBox = document.createElement("input");
    dryRunBox.type = "checkbox";
    dryRunBox.checked = uiDryRun();
    dryRunBox.setAttribute("aria-label", "Preview manual relationship changes without modifying Stash");
    dryRunBox.addEventListener("change", function () { setUiDryRun(dryRunBox.checked); });
    mode.appendChild(dryRunBox);
    mode.appendChild(document.createTextNode(" Preview changes only"));
    panelBody.appendChild(mode);

    var cf = customFields(scene);
    var familyScenes = [];
    if (cf.variant_role === "primary") familyScenes = [scene].concat(related.children || []);
    else if (cf.variant_role === "variant") familyScenes = (related.primary ? [related.primary] : []).concat(related.siblings || []);
    var uniqueFamilyScenes = [];
    var familySceneIds = {};
    familyScenes.forEach(function (familyScene) {
      var id = String(familyScene && familyScene.id || "");
      if (!id || familySceneIds[id]) return;
      familySceneIds[id] = true;
      uniqueFamilyScenes.push(familyScene);
    });
    uniqueFamilyScenes.sort(comparePlayerVariantScenes);

    var queueSelected = {};
    var queueSelectionInputs = {};
    var queueCandidates = uniqueFamilyScenes.filter(function (familyScene) {
      return String(familyScene.id) !== String(scene.id);
    });
    var list = el("div", "smv-list smv-player-variant-list");
    var queueStatus = el("div", "smv-player-queue-status", "");
    queueStatus.setAttribute("role", "status");
    queueStatus.setAttribute("aria-live", "polite");
    var addSelectedButton = null;

    function relationshipLabel(familyScene) {
      if (String(familyScene.id) === String(scene.id)) return "Now playing";
      if (customFields(familyScene).variant_role === "primary") return "Primary";
      return customFields(familyScene).variant_label || "Variant";
    }

    function updateQueueSelection() {
      var count = Object.keys(queueSelected).filter(function (sceneId) { return queueSelected[sceneId]; }).length;
      if (!addSelectedButton) return;
      addSelectedButton.textContent = "Add Selected (" + count + ")";
      addSelectedButton.disabled = count === 0;
    }

    function queueScenes(sceneIds) {
      try {
        var result = addScenesToSessionQueue(sceneIds);
        var added = result.addedSceneIDs.length;
        queueStatus.textContent = added
          ? "Added " + added + (added === 1 ? " scene" : " scenes") + " to the playback queue."
          : "Those scenes are already in the playback queue.";
        Object.keys(queueSelected).forEach(function (sceneId) {
          delete queueSelected[sceneId];
          if (queueSelectionInputs[sceneId]) queueSelectionInputs[sceneId].checked = false;
        });
        updateQueueSelection();
      } catch (err) {
        queueStatus.textContent = String(err && err.message || err);
      }
    }

    uniqueFamilyScenes.forEach(function (familyScene) {
      var id = String(familyScene.id);
      var isCurrent = id === String(scene.id);
      var row = el("div", "smv-player-variant-row" + (isCurrent ? " is-current" : ""));
      if (!isCurrent) {
        var selector = document.createElement("input");
        selector.type = "checkbox";
        selector.className = "smv-player-queue-selector";
        selector.setAttribute("aria-label", "Select " + sceneTitle(familyScene) + " for the playback queue");
        selector.addEventListener("change", function () {
          if (selector.checked) queueSelected[id] = true;
          else delete queueSelected[id];
          updateQueueSelection();
        });
        queueSelectionInputs[id] = selector;
        row.appendChild(selector);
      } else {
        row.appendChild(el("span", "smv-player-queue-selector-placeholder"));
      }
      row.appendChild(playerVariantThumbnail(familyScene));
      var copy = el("div", "smv-player-variant-copy");
      copy.appendChild(el("div", "smv-player-variant-role", relationshipLabel(familyScene)));
      if (isCurrent) {
        copy.appendChild(el("div", "smv-player-variant-title", sceneTitle(familyScene)));
      } else {
        var open = el("button", "smv-player-variant-title smv-player-variant-open", sceneTitle(familyScene));
        open.type = "button";
        open.setAttribute("aria-label", "Play variant " + sceneTitle(familyScene));
        open.addEventListener("click", function () { goScene(familyScene.id); });
        copy.appendChild(open);
      }
      row.appendChild(copy);
      list.appendChild(row);
    });
    panelBody.appendChild(list);

    if (queueCandidates.length) {
      var queueActions = el("div", "smv-player-queue-actions");
      addSelectedButton = button("Add Selected (0)", function () {
        queueScenes(Object.keys(queueSelected).filter(function (sceneId) { return queueSelected[sceneId]; }));
      }, "attach");
      addSelectedButton.disabled = true;
      queueActions.appendChild(addSelectedButton);
      queueActions.appendChild(button("Add All Variants", function () {
        queueScenes(queueCandidates.map(function (familyScene) { return String(familyScene.id); }));
      }, "primary"));
      panelBody.appendChild(queueActions);
      panelBody.appendChild(queueStatus);
    }

    var actions = el("div", "smv-actions");
    actions.appendChild(button("Review Candidate Families", function () {
      openVariantReviewModal();
    }, "primary"));
    actions.appendChild(button("Attach Child Scene", function () {
      openSceneSearchModal("Choose a Child Scene", function (selected) {
        var label = window.prompt("Variant label", "Variant") || "Variant";
        var dryRun = uiDryRun();
        if (!window.confirm((dryRun ? "Dry-run add " : "Add ") + "\"" + sceneTitle(selected) + "\" as a variant of \"" + sceneTitle(scene) + "\"?")) return;
        runPluginTask(TASKS.link, { mode: "link_variant", dryRun: dryRun, primarySceneId: String(scene.id), childSceneId: String(selected.id), label: label }).then(function (data) {
          afterTask(data, dryRun);
        }).catch(alert);
      });
    }, "attach"));
    actions.appendChild(button("Nest This Scene", function () {
      openSceneSearchModal("Choose a Primary Scene", function (selected) {
        var label = window.prompt("Variant label", "Variant") || "Variant";
        var dryRun = uiDryRun();
        if (!window.confirm((dryRun ? "Dry-run making " : "Make ") + "\"" + sceneTitle(scene) + "\" a variant of \"" + sceneTitle(selected) + "\"?")) return;
        runPluginTask(TASKS.link, { mode: "link_variant", dryRun: dryRun, primarySceneId: String(selected.id), childSceneId: String(scene.id), label: label }).then(function (data) {
          afterTask(data, dryRun);
        }).catch(alert);
      });
    }, "attach"));

    if (cf.variant_role === "variant") {
      actions.appendChild(button("Detach From Set", function () {
        var dryRun = uiDryRun();
        if (!window.confirm((dryRun ? "Dry-run unlink this variant?" : "Unlink this variant?") + " This does not delete files or scenes.")) return;
        runPluginTask(TASKS.unlink, { mode: "unlink_variant", dryRun: dryRun, childSceneId: String(scene.id) }).then(function (data) {
          afterTask(data, dryRun);
        }).catch(alert);
      }, "danger"));
      actions.appendChild(button("Make Set Primary", function () {
        var dryRun = uiDryRun();
        if (!window.confirm((dryRun ? "Dry-run promote this variant to primary?" : "Promote this variant to primary?") + " This does not delete files or scenes.")) return;
        runPluginTask(TASKS.promote, { mode: "promote_variant", dryRun: dryRun, childSceneId: String(scene.id) }).then(function (data) {
          afterTask(data, dryRun);
        }).catch(alert);
      }, "apply"));
    }

    panelBody.appendChild(actions);

    var panelToggle = el("button", "smv-panel-toggle");
    var panelToggleChevron = el("span", "smv-panel-toggle-chevron");
    panelToggle.type = "button";
    panelToggle.setAttribute("aria-expanded", "true");
    panelToggle.setAttribute("aria-label", "Hide variant set manager");
    setControlTooltip(panelToggle, "Hide the Scene Variant player controls.");
    panelToggle.appendChild(panelToggleChevron);
    panelToggle.addEventListener("click", function () {
      var collapsed = panel.classList.toggle("is-collapsed");
      panelBody.hidden = collapsed;
      panelToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      panelToggle.setAttribute("aria-label", collapsed ? "Show variant set manager" : "Hide variant set manager");
      setControlTooltip(panelToggle, collapsed
        ? "Show the Scene Variant player controls."
        : "Hide the Scene Variant player controls.");
    });
    panel.appendChild(panelToggle);

    if (!mountPanel(panel)) {
      panel.remove();
      scheduleScenePageSetup(100);
    }
  }

  function scenePanelTarget() {
    return document.querySelector(".scene-tabs") ||
      document.querySelector("#scene-details-container") ||
      document.querySelector(".details-tab");
  }

  function mountPanel(panel) {
    var target = scenePanelTarget();
    if (!target) return false;
    target.insertBefore(panel, target.firstChild);
    return true;
  }

  function panelMatchesScene(panel, sceneId) {
    var target = scenePanelTarget();
    return !!(panel &&
      target &&
      panel.getAttribute("data-smv-scene-id") === String(sceneId) &&
      panel.parentNode === target);
  }

  function removePanel() {
    Array.prototype.forEach.call(document.querySelectorAll(".smv-panel"), function (panel) {
      panel.remove();
    });
  }

  function loadRelated(scene) {
    var cf = customFields(scene);
    if (cf.variant_role === "primary") {
      return findScenesByIds(variantChildren(scene)).then(function (children) {
        return { children: children, siblings: [], primary: null, error: "" };
      });
    }
    if (cf.variant_role === "variant" && cf.variant_parent_id) {
      return findScene(cf.variant_parent_id).then(function (primary) {
        return findScenesByIds(variantChildren(primary)).then(function (siblings) {
          return { primary: primary, siblings: siblings, children: [], error: "" };
        });
      });
    }
    return Promise.resolve({ children: [], siblings: [], primary: null, error: "" });
  }

  function scheduleScenePageSetup(delay) {
    window.clearTimeout(scenePanelRefreshTimer);
    scenePanelRefreshTimer = window.setTimeout(function () {
      scenePanelRefreshTimer = null;
      setupScenePage();
    }, delay === undefined ? 100 : delay);
  }

  function setupScenePage() {
    var id = sceneIdFromLocation();
    if (!id) {
      scenePanelRequestToken++;
      scenePanelLoadId = null;
      removePanel();
      return;
    }

    var existing = document.querySelector(".smv-panel");
    var target = scenePanelTarget();
    if (!target) {
      if (existing) removePanel();
      return;
    }
    if (panelMatchesScene(existing, id)) return;
    if (existing) removePanel();
    if (scenePanelLoadId === String(id)) return;

    scenePanelLoadId = String(id);
    var requestToken = ++scenePanelRequestToken;
    findScene(id).then(function (scene) {
      if (!scene) return;
      if (requestToken !== scenePanelRequestToken || sceneIdFromLocation() !== String(id)) return;
      return loadRelated(scene).then(function (related) {
        if (requestToken !== scenePanelRequestToken || sceneIdFromLocation() !== String(id)) return;
        renderPanel(scene, related);
      }).catch(function (err) {
        if (requestToken !== scenePanelRequestToken || sceneIdFromLocation() !== String(id)) return;
        renderPanel(scene, {
          children: [],
          siblings: [],
          primary: null,
          error: String(err && err.message || err)
        });
      });
    }).catch(function (err) {
      console.warn("[scene-metadata-variants] panel failed", err);
    }).then(function () {
      if (requestToken === scenePanelRequestToken) scenePanelLoadId = null;
    });
  }

  function sceneIdFromHref(href) {
    var m = String(href || "").match(/\/scenes?\/(\d+)/);
    return m ? m[1] : null;
  }

  function cardForAnchor(anchor) {
    return anchor.closest(".scene-card") ||
      anchor.closest(".scene-card-container") ||
      anchor.closest(".card") ||
      anchor.closest("[class*='scene-card']") ||
      anchor.parentElement;
  }

  function metadataRowScore(node, card) {
    if (!node || node === card || node.querySelector(".smv-card-variant-menu")) return 0;
    var text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 80) return 0;
    var iconCount = node.querySelectorAll("svg, i, .fa, .svg-inline--fa, [data-icon]").length;
    var digitCount = (text.match(/\d+/g) || []).length;
    var className = String(node.className || "");
    var score = 0;
    if (iconCount >= 2) score += 8;
    else if (iconCount === 1) score += 4;
    if (digitCount >= 2) score += 8;
    else if (digitCount === 1) score += 4;
    if (/tag|group|studio|performer|marker|meta|indicator|count|footer/i.test(className)) score += 5;
    if (/title|image|thumbnail|preview|caption|description/i.test(className)) score -= 8;
    if (node.querySelector("a[href*='/scenes/']")) score -= 6;
    return score;
  }

  function bestMetadataRow(card) {
    if (!card) return null;
    var best = null;
    var bestScore = 0;
    var nodes = Array.prototype.slice.call(card.querySelectorAll("div, span, footer, section"));
    nodes.forEach(function (node) {
      var score = metadataRowScore(node, card);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
    return bestScore >= 8 ? best : null;
  }

  function ensureMetadataRow(card) {
    var row = bestMetadataRow(card);
    if (row) return row;
    row = el("div", "smv-metadata-row-fallback");
    card.appendChild(row);
    return row;
  }

  function cardFooter(card) {
    if (!card) return null;
    var selectors = [
      ".scene-card-footer .scene-card-tags",
      ".scene-card-footer [class*='tag']",
      ".scene-card-footer [class*='group']",
      ".scene-card-footer",
      ".scene-card__footer",
      ".card-footer",
      ".scene-card__details",
      ".scene-card-info",
      ".scene-card__info"
    ];
    for (var i = 0; i < selectors.length; i++) {
      var found = card.querySelector(selectors[i]);
      if (found) return found;
    }
    return ensureMetadataRow(card);
  }

  function chainIcon() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "smv-chain-icon");
    var p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p1.setAttribute("d", "M10.5 13.5 13.5 10.5");
    var p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p2.setAttribute("d", "M8.6 15.4 7.4 16.6a3.2 3.2 0 0 1-4.5-4.5l3.2-3.2a3.2 3.2 0 0 1 4.5 0l.7.7");
    var p3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p3.setAttribute("d", "M15.4 8.6 16.6 7.4a3.2 3.2 0 0 1 4.5 4.5l-3.2 3.2a3.2 3.2 0 0 1-4.5 0l-.7-.7");
    [p1, p2, p3].forEach(function (path) {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
    });
    return svg;
  }

  function variantDropdown(menu) {
    return menu && (menu._smvDropdown || menu.querySelector(".smv-variant-dropdown"));
  }

  function positionVariantDropdown(menu) {
    var dropdown = variantDropdown(menu);
    var trigger = menu && menu.querySelector(".smv-variant-trigger");
    if (!dropdown || !trigger) return;
    var rect = trigger.getBoundingClientRect();
    var margin = 8;
    var width = Math.max(210, Math.min(320, window.innerWidth - (margin * 2)));
    var left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    dropdown.style.minWidth = width + "px";
    dropdown.style.left = left + "px";
    dropdown.style.top = Math.max(margin, rect.bottom + 6) + "px";
    window.setTimeout(function () {
      if (!dropdown.classList.contains("is-open")) return;
      var menuRect = dropdown.getBoundingClientRect();
      if (menuRect.bottom > window.innerHeight - margin && rect.top > menuRect.height + margin) {
        dropdown.style.top = Math.max(margin, rect.top - menuRect.height - 6) + "px";
      }
    }, 0);
  }

  function closeVariantMenus() {
    Array.prototype.forEach.call(document.querySelectorAll(".smv-card-variant-menu.is-open"), function (node) {
      node.classList.remove("is-open");
      var dropdown = variantDropdown(node);
      if (dropdown) dropdown.classList.remove("is-open");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".smv-variant-dropdown.is-open"), function (node) {
      node.classList.remove("is-open");
    });
  }

  function fillVariantMenu(menu, scene) {
    if (menu.getAttribute("data-loaded") === "true") return;
    var dropdown = variantDropdown(menu);
    if (!dropdown) return;
    dropdown.textContent = "Loading...";
    findScenesByIds(variantChildren(scene)).then(function (children) {
      dropdown.innerHTML = "";
      children.forEach(function (child) {
        var item = el("button", "smv-variant-option", (customFields(child).variant_label || "Variant") + ": " + sceneTitle(child));
        item.type = "button";
        item.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          goScene(child.id);
        });
        dropdown.appendChild(item);
      });
      if (!dropdown.children.length) dropdown.appendChild(el("div", "smv-variant-empty", "No variants found"));
      menu.setAttribute("data-loaded", "true");
    }).catch(function () {
      dropdown.textContent = "Variant list failed";
    });
  }

  function applyVariantVisibility(card, scene) {
    if (!card) return;
    var isChild = customFields(scene).variant_role === "variant";
    if (isChild && !showNestedVariants()) {
      card.classList.add("smv-hidden-variant-card");
      card.setAttribute("data-smv-hidden-variant", "true");
    } else {
      card.classList.remove("smv-hidden-variant-card");
      if (card.getAttribute("data-smv-hidden-variant") === "true") card.removeAttribute("data-smv-hidden-variant");
    }
  }

  function addVariantMenuToCard(anchor, scene) {
    var cf = customFields(scene);
    var count = variantChildren(scene).length;
    var card = cardForAnchor(anchor);
    if (!card) return;
    applyVariantVisibility(card, scene);
    if (cf.variant_role !== "primary" || !count || card.querySelector(".smv-card-variant-menu")) return;
    var footer = ensureMetadataRow(card) || cardFooter(card);
    var menu = el("span", "smv-card-variant-menu");
    var trigger = el("button", "smv-variant-trigger");
    trigger.type = "button";
    trigger.title = count + " variants";
    trigger.appendChild(chainIcon());
    trigger.appendChild(el("span", "smv-variant-count", String(count)));
    var dropdown = el("div", "smv-variant-dropdown");
    dropdown.setAttribute("role", "menu");
    menu.appendChild(trigger);
    menu._smvDropdown = dropdown;
    dropdown._smvOwner = menu;
    document.body.appendChild(dropdown);
    trigger.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var opening = !menu.classList.contains("is-open");
      closeVariantMenus();
      if (opening) {
        menu.classList.add("is-open");
        dropdown.classList.add("is-open");
        positionVariantDropdown(menu);
        fillVariantMenu(menu, scene);
        positionVariantDropdown(menu);
      }
    });
    footer.appendChild(menu);
  }

  function setupCardVariantMenus() {
    if (sceneIdFromLocation()) return;
    var anchors = Array.prototype.slice.call(document.querySelectorAll("a[href*='/scene']"));
    anchors.slice(0, 80).forEach(function (a) {
      var id = sceneIdFromHref(a.getAttribute("href"));
      if (!id || cache[id] === "loading") return;
      if (cache[id]) {
        addVariantMenuToCard(a, cache[id]);
        return;
      }
      cache[id] = "loading";
      findScene(id).then(function (scene) {
        cache[id] = scene;
        addVariantMenuToCard(a, scene);
      }).catch(function () {
        cache[id] = null;
      });
    });
  }

  function toggleNestedVariantVisibility() {
    setShowNestedVariants(!showNestedVariants());
    Array.prototype.forEach.call(document.querySelectorAll("[data-smv-hidden-variant='true'], .smv-hidden-variant-card"), function (card) {
      card.classList.remove("smv-hidden-variant-card");
      card.removeAttribute("data-smv-hidden-variant");
    });
    setupCardVariantMenus();
  }

  function menuText() {
    return showNestedVariants() ? "Hide nested variants" : "Show nested variants";
  }

  function injectEllipsisMenuToggle(root) {
    if (!isScenesBrowseRoute()) return;
    var containers = Array.prototype.slice.call((root || document).querySelectorAll(".dropdown-menu, [role='menu'], .popover, .modal, .btn-group.open > .dropdown-menu, .show > .dropdown-menu, .show[role='menu']"));
    containers.forEach(function (container) {
      if (!container || container.querySelector(".smv-show-nested-toggle")) return;
      if (container.classList && container.classList.contains("smv-variant-dropdown")) return;
      if (container.closest && container.closest(".smv-card-variant-menu")) return;
      if (container.querySelector(".smv-variant-option")) return;
      var item = el("button", "smv-show-nested-toggle", menuText());
      item.type = "button";
      item.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleNestedVariantVisibility();
        item.textContent = menuText();
      });
      container.appendChild(item);
    });
  }

  function browseToolbarContainer() {
    var selectors = [
      ".scene-toolbar",
      ".scene-list-header",
      ".toolbar",
      "[class*='SceneToolbar']",
      "[class*='scene-toolbar']",
      "[class*='Toolbar']"
    ];
    for (var i = 0; i < selectors.length; i++) {
      var found = document.querySelector(selectors[i]);
      if (found && !found.querySelector(".smv-browse-discovery")) return found;
    }
    return null;
  }

  function ensureBrowseDiscoveryEntry() {
    var existing = document.querySelector(".smv-browse-discovery");
    if (!isScenesBrowseRoute()) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    var container = browseToolbarContainer();
    if (!container) return;
    var entry = button("Variant Family Review", function () {
      openVariantReviewModal();
    }, "primary");
    entry.className += " smv-browse-discovery";
    container.appendChild(entry);
  }

  function setupToolbarToggleWatcher() {
    document.addEventListener("click", function (event) {
      if (!isScenesBrowseRoute()) return;
      var target = event.target;
      var button = target && target.closest && target.closest("button, .btn, [role='button']");
      if (!button) return;
      var text = (button.textContent || "").trim();
      var label = button.getAttribute("aria-label") || button.getAttribute("title") || "";
      var hasIcon = !!button.querySelector("svg, i, .fa, .svg-inline--fa");
      if (text === "..." || text === "\u2026" || /more|options|ellipsis|menu/i.test(label) || hasIcon) {
        setTimeout(function () { injectEllipsisMenuToggle(document); }, 80);
        setTimeout(function () { injectEllipsisMenuToggle(document); }, 250);
        setTimeout(function () { injectEllipsisMenuToggle(document); }, 600);
      }
    }, true);
  }

  function setupDiscoveryTaskInterceptor() {
    if (window.__smvDiscoveryTaskInterceptor) return;
    window.__smvDiscoveryTaskInterceptor = true;
    document.addEventListener("click", function (event) {
      var target = event.target;
      var taskButton = target && target.closest && target.closest("button");
      if (!taskButton) return;
      if ((taskButton.textContent || "").replace(/\s+/g, " ").trim() !== TASKS.discover) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      openVariantReviewModal();
    }, true);
  }

  function refresh() {
    scheduleScenePageSetup(0);
    setupCardVariantMenus();
    ensureBrowseDiscoveryEntry();
  }

  function start() {
    installControlTooltips();
    scenePanelWatchId = sceneIdFromLocation();
    refresh();
    if (window.PluginApi && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", function () {
        setTimeout(refresh, 250);
      });
    }
    var observer = new MutationObserver(function () {
      var sceneId = sceneIdFromLocation();
      var panel = document.querySelector(".smv-panel");
      if (sceneId && (!panel || panel.getAttribute("data-smv-scene-id") !== String(sceneId))) {
        scheduleScenePageSetup();
      } else if (!sceneId && panel) {
        removePanel();
      }
      setupCardVariantMenus();
      injectEllipsisMenuToggle(document);
      ensureBrowseDiscoveryEntry();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setInterval(function () {
      var sceneId = sceneIdFromLocation();
      var panel = document.querySelector(".smv-panel");
      if (sceneId !== scenePanelWatchId) {
        scenePanelWatchId = sceneId;
        scenePanelRequestToken++;
        scenePanelLoadId = null;
        removePanel();
        scheduleScenePageSetup(0);
        return;
      }
      if (sceneId && !panelMatchesScene(panel, sceneId)) {
        scheduleScenePageSetup(0);
      } else if (!sceneId && panel) {
        removePanel();
      }
    }, 750);
    document.addEventListener("click", function () { closeVariantMenus(); });
    setupToolbarToggleWatcher();
    setupDiscoveryTaskInterceptor();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
