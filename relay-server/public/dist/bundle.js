(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // relay-server/fleet-work-context.js
  var require_fleet_work_context = __commonJS({
    "relay-server/fleet-work-context.js"(exports, module) {
      "use strict";
      var CODEX_GOAL_AGENT_TYPES = /* @__PURE__ */ new Set(["codex", "codex_cli", "codex-desktop"]);
      var ACTIVE_ACTIVITY_KINDS2 = /* @__PURE__ */ new Set([
        "thinking",
        "generating",
        "reading_files",
        "running_command",
        "applying_patch",
        "working"
      ]);
      var ACTIVE_TASK_STATES = /* @__PURE__ */ new Set(["active", "in_progress", "in-progress", "working", "running"]);
      var PENDING_TASK_STATES = /* @__PURE__ */ new Set(["pending", "queued", "todo", "not_started", "not-started"]);
      var COMPLETE_TASK_STATES = /* @__PURE__ */ new Set(["completed", "complete", "done", "passed", "success", "succeeded"]);
      var TERMINAL_TASK_STATES = /* @__PURE__ */ new Set([...COMPLETE_TASK_STATES, "cancelled", "canceled", "failed", "skipped"]);
      var GENERIC_ACTIVITY_LABELS = /* @__PURE__ */ new Set([
        "",
        "active",
        "idle",
        "ready",
        "thinking",
        "generating",
        "working",
        "busy",
        "connected"
      ]);
      var MAX_CONTEXT_TEXT = 240;
      var MAX_CONTEXT_LABEL = 32;
      var MAX_CONTEXT_SOURCE = 48;
      function normalizedAgentType(value) {
        return String(value || "").trim().toLowerCase();
      }
      function goalLifecycleSupported2(agentType, capabilities) {
        if (capabilities && typeof capabilities.goal_lifecycle === "boolean") {
          return capabilities.goal_lifecycle;
        }
        return CODEX_GOAL_AGENT_TYPES.has(normalizedAgentType(agentType));
      }
      function timestampMs3(value) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
        const parsed = Date.parse(String(value || ""));
        return Number.isFinite(parsed) ? parsed : 0;
      }
      function firstTimestamp(...values) {
        for (const value of values) {
          const parsed = timestampMs3(value);
          if (parsed) return new Date(parsed).toISOString();
        }
        return null;
      }
      function containsCredentialShape(value) {
        return /(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i.test(value);
      }
      function boundedDisplayText(value, maximum = MAX_CONTEXT_TEXT) {
        if (typeof value !== "string" && typeof value !== "number") return "";
        let text = String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
        if (!text || containsCredentialShape(text)) return "";
        if (/^[{[]\s*["']?[\w.-]+["']?\s*:/.test(text)) return "";
        if (/^(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|zsh|fish)\s+-/i.test(text)) return "";
        text = text.replace(/^(?:[-*•]\s+|#{1,6}\s+)/, "").trim();
        return text.slice(0, maximum).trim();
      }
      function taskState(task) {
        return String(task?.state || task?.status || "").trim().toLowerCase();
      }
      function taskText(task) {
        return boundedDisplayText(
          task?.subject || task?.text || task?.content || task?.description || task?.label
        );
      }
      function normalizeProgress(completed, total) {
        const normalizedTotal = Number(total);
        const normalizedCompleted = Number(completed);
        if (!Number.isInteger(normalizedTotal) || normalizedTotal <= 0) return null;
        if (!Number.isInteger(normalizedCompleted) || normalizedCompleted < 0) return null;
        return {
          completed: Math.min(normalizedCompleted, normalizedTotal),
          total: normalizedTotal
        };
      }
      function explicitGoalProgress(goal) {
        const value = Number(goal?.progress_percent ?? goal?.percent_complete ?? goal?.percent ?? goal?.progress);
        if (!Number.isFinite(value)) return null;
        return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
      }
      function normalizeFleetWorkContext(value, options = {}) {
        if (!value || typeof value !== "object") return null;
        const kind = String(value.kind || "").trim().toLowerCase().replace(/[^a-z_]/g, "").slice(0, 24);
        if (!kind || kind === "goal" && options.goalCapable === false) return null;
        const label = boundedDisplayText(value.label, MAX_CONTEXT_LABEL);
        const text = boundedDisplayText(value.text);
        const source = boundedDisplayText(value.source, MAX_CONTEXT_SOURCE).replace(/\s+/g, "_").toLowerCase();
        if (!label || !text || !source) return null;
        const progress = normalizeProgress(value.completed, value.total);
        const percent2 = Number(value.percent);
        return {
          kind,
          label,
          text,
          source,
          updated_at: firstTimestamp(value.updated_at) || null,
          ...progress || {},
          ...Number.isFinite(percent2) ? { percent: Math.max(0, Math.min(100, percent2)) } : {},
          ...value.state ? { state: boundedDisplayText(value.state, 32).toLowerCase() } : {}
        };
      }
      function latestUserRequestFromMessages2(messages) {
        const rows = Array.isArray(messages) ? messages : [];
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const message = rows[index];
          if (String(message?.role || "").toLowerCase() !== "user") continue;
          const text = boundedDisplayText(message?.content || message?.text);
          if (!text) continue;
          return {
            text,
            updated_at: firstTimestamp(
              message?.timestamp,
              message?.created_at,
              message?.ts,
              message?.server_ts
            )
          };
        }
        return null;
      }
      function planLabel(agentType, taskCount) {
        const type = normalizedAgentType(agentType);
        if (type === "claude" || type === "claude_cli" || type === "claude-desktop") {
          return taskCount > 1 ? "Tasks" : "Task";
        }
        if (["antigravity", "antigravity_panel", "antigravity-v2", "gemini", "continue", "continue_yolo", "roo_code", "cline"].includes(type)) {
          return "Task";
        }
        return taskCount > 1 ? "Tasks" : "Plan";
      }
      function structuredTaskCandidate(agentType, activity) {
        const taskList = activity?.task_list;
        const tasks = Array.isArray(taskList?.tasks) ? taskList.tasks : [];
        const useful = tasks.filter((task) => taskText(task));
        if (useful.length > 0) {
          const active = useful.find((task) => ACTIVE_TASK_STATES.has(taskState(task)));
          const pending = useful.find((task) => PENDING_TASK_STATES.has(taskState(task)));
          const selected = active || pending;
          if (selected) {
            const explicitTotal = Number(taskList.total);
            const total = Number.isInteger(explicitTotal) && explicitTotal > 0 ? explicitTotal : tasks.length;
            const explicitCompleted = Number(taskList.completed);
            const completed = Number.isInteger(explicitCompleted) && explicitCompleted >= 0 ? explicitCompleted : tasks.filter((task) => COMPLETE_TASK_STATES.has(taskState(task))).length;
            return {
              kind: "plan",
              label: planLabel(agentType, total),
              text: taskText(selected),
              source: "task_list",
              updated_at: firstTimestamp(selected.updated_at, selected.updatedAt, taskList.updated_at, activity.updated_at),
              ...normalizeProgress(completed, total)
            };
          }
        }
        const step = activity?.step;
        const stepState = taskState(step);
        const stepValue = typeof step === "object" ? step?.text || step?.content || step?.description || step?.label || step?.name : step;
        const text = boundedDisplayText(stepValue);
        if (text && !TERMINAL_TASK_STATES.has(stepState)) {
          return {
            kind: "plan",
            label: planLabel(agentType, 1),
            text,
            source: "step",
            updated_at: firstTimestamp(step?.updated_at, step?.updatedAt, activity.updated_at)
          };
        }
        return null;
      }
      function currentCandidate(activity) {
        const current = activity?.current;
        if (!current || typeof current !== "object") return null;
        const text = boundedDisplayText(current.label || current.title || current.name);
        if (!text) return null;
        const kind = String(current.kind || "").trim().toLowerCase();
        const responseLike = ["response", "thinking", "generating", "message"].includes(kind);
        return {
          kind: responseLike ? "response" : "activity",
          label: responseLike ? "Current response" : "Current activity",
          text,
          source: kind ? `current_${kind}` : "current",
          updated_at: firstTimestamp(current.updated_at, current.since, activity.updated_at)
        };
      }
      function contextCardCandidate(agentType, activity) {
        const card = activity?.context_card;
        if (!card || typeof card !== "object") return null;
        const text = boundedDisplayText(card.task || card.title || card.mode || card.label || card.text);
        if (!text) return null;
        return {
          kind: "task",
          label: planLabel(agentType, 1),
          text,
          source: "context_card",
          updated_at: firstTimestamp(card.updated_at, activity.updated_at)
        };
      }
      function requestCandidate(latestUserRequest) {
        const value = typeof latestUserRequest === "string" ? { text: latestUserRequest } : latestUserRequest;
        const text = boundedDisplayText(value?.text || value?.content);
        if (!text) return null;
        return {
          kind: "request",
          label: "Request",
          text,
          source: "latest_user_request",
          updated_at: firstTimestamp(value?.updated_at, value?.timestamp, value?.created_at)
        };
      }
      function activityCandidate(activity) {
        const label = boundedDisplayText(activity?.label, 160);
        if (!label || GENERIC_ACTIVITY_LABELS.has(label.toLowerCase())) return null;
        return {
          kind: "activity",
          label: "Current activity",
          text: label,
          source: "activity_label",
          updated_at: firstTimestamp(activity?.updated_at, activity?.started_at, activity?.since)
        };
      }
      function goalCandidate(activity, goalCapable) {
        if (!goalCapable || !activity?.goal || typeof activity.goal !== "object") return null;
        const goal = activity.goal;
        const text = boundedDisplayText(goal.objective || goal.text);
        if (!text) return null;
        const progress = normalizeProgress(goal.completed, goal.total);
        const percent2 = explicitGoalProgress(goal);
        return {
          kind: "goal",
          label: "Goal",
          text,
          source: "goal",
          updated_at: firstTimestamp(goal.updated_at, goal.observed_at, activity.updated_at),
          ...progress || {},
          ...percent2 == null ? {} : { percent: percent2 },
          ...goal.state || goal.status ? { state: String(goal.state || goal.status).toLowerCase().slice(0, 32) } : {}
        };
      }
      function newerCandidate(first, second) {
        if (!first) return second;
        if (!second) return first;
        const firstMs = timestampMs3(first.updated_at);
        const secondMs = timestampMs3(second.updated_at);
        return secondMs > firstMs && firstMs > 0 ? second : first;
      }
      function projectFleetWorkContext2(options = {}) {
        const activity = options.activity && typeof options.activity === "object" ? options.activity : {};
        const goalCapable = goalLifecycleSupported2(options.agentType, options.capabilities);
        if (options.preferProvided !== false) {
          const provided = normalizeFleetWorkContext(activity.work_context, { goalCapable });
          if (provided) return provided;
        }
        const goal = goalCandidate(activity, goalCapable);
        if (goal) return normalizeFleetWorkContext(goal, { goalCapable });
        const plan = structuredTaskCandidate(options.agentType, activity);
        const current = currentCandidate(activity);
        const contextCard = contextCardCandidate(options.agentType, activity);
        const request = requestCandidate(options.latestUserRequest);
        const activityFallback = activityCandidate(activity);
        const active = ACTIVE_ACTIVITY_KINDS2.has(String(activity.kind || "").toLowerCase());
        let selected = plan || contextCard;
        if (active && current) selected = newerCandidate(selected, current);
        if (!selected) selected = current || contextCard || request || activityFallback;
        if (!selected && request) selected = request;
        if (!selected) {
          selected = {
            kind: "empty",
            label: "Current work",
            text: "No current work reported",
            source: "none",
            updated_at: firstTimestamp(activity.updated_at)
          };
        }
        return normalizeFleetWorkContext(selected, { goalCapable });
      }
      module.exports = {
        CODEX_GOAL_AGENT_TYPES,
        MAX_CONTEXT_TEXT,
        boundedDisplayText,
        goalLifecycleSupported: goalLifecycleSupported2,
        latestUserRequestFromMessages: latestUserRequestFromMessages2,
        normalizeFleetWorkContext,
        projectFleetWorkContext: projectFleetWorkContext2,
        timestampMs: timestampMs3
      };
    }
  });

  // frontend/file-utils.js
  var TEXT_EXTS = /* @__PURE__ */ new Set([
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "json",
    "md",
    "css",
    "html",
    "htm",
    "sh",
    "bash",
    "yaml",
    "yml",
    "txt",
    "env",
    "csv",
    "xml",
    "sql",
    "go",
    "rs",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
    "rb",
    "php",
    "swift",
    "kt",
    "scala",
    "r",
    "m",
    "tf",
    "toml",
    "ini",
    "cfg",
    "conf",
    "log",
    "gitignore",
    "dockerfile",
    "makefile",
    "vue",
    "svelte",
    "graphql",
    "gql"
  ]);
  var LANG_MAP = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    sh: "bash",
    bash: "bash",
    rs: "rust",
    kt: "kotlin",
    tf: "hcl",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    graphql: "graphql",
    gql: "graphql"
  };
  function getLang(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    return LANG_MAP[ext] || ext;
  }
  function isTextFile(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    return TEXT_EXTS.has(ext);
  }
  var AGENT_DISPLAY = {
    claude: "Claude Code",
    claude_cli: "Claude Code CLI",
    codex: "Codex",
    codex_cli: "Codex CLI",
    cursor_cli: "Cursor CLI",
    gemini: "Gemini",
    continue: "Continue",
    continue_yolo: "Continue YOLO",
    roo_code: "Roo Code",
    cline: "Cline",
    antigravity: "Antigravity",
    antigravity_panel: "Antigravity Chat",
    "codex-desktop": "Codex Desktop",
    cursor: "Cursor",
    "claude-desktop": "Claude Desktop"
  };
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function sessionLabel(sessionOrId, fallbackId) {
    if (sessionOrId && typeof sessionOrId === "object") {
      const name = AGENT_DISPLAY[sessionOrId.agent_type] || sessionOrId.display_name || sessionOrId.agent_type || "Agent";
      const workspace = sessionOrId.workspace_name || sessionOrId.window_title || "";
      return workspace ? name + " \u2014 " + workspace : name;
    }
    const id = fallbackId || sessionOrId;
    if (typeof id !== "string") return "Agent";
    if (UUID_RE.test(id)) return "Agent Session";
    const parts = id.split("-");
    const agent = parts[0];
    const win = parts[1] || "";
    const suffix = parts[2] || "";
    const winLabel = win ? " (win " + win + suffix + ")" : "";
    return (AGENT_DISPLAY[agent] || agent) + winLabel;
  }

  // frontend/markdown.js
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHtml(String(s)).replace(/"/g, "&quot;");
  }
  function looksLikePath(line) {
    return /^[A-Za-z]:\\/.test(line) || line.includes("\\") || line.includes("/") || /^[.~]\//.test(line);
  }
  function countDiffStats(text) {
    let adds = 0;
    let dels = 0;
    text.split("\n").forEach((line) => {
      if (/^\+\+\+|^---|^@@/.test(line)) return;
      if (line.startsWith("+")) adds++;
      if (line.startsWith("-")) dels++;
    });
    return { adds, dels };
  }
  function hasEditLikeToolName(name) {
    return /\b(edit|edited|patch|diff|apply_patch|write)\b/i.test(String(name || ""));
  }
  function hasRenderableDiffPayload(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
    for (const line of lines) {
      if (!line) continue;
      if (/^(diff --git|index )/.test(line)) return true;
      if (/^@@/.test(line)) return true;
      if (/^---[ \t]/.test(line) || /^\+\+\+[ \t]/.test(line)) return true;
      if (/^[+\- ]/.test(line)) {
        const payload = line.slice(1).trim();
        if (!payload) continue;
        if (/^[\d\s()+\-]+$/.test(payload)) continue;
        return true;
      }
    }
    return false;
  }
  function toolDotClass(name) {
    const lower = (name || "").toLowerCase();
    if (lower.includes("bash") || lower.includes("run") || lower.includes("command") || lower.includes("execute")) return "dot-bash";
    if (lower.includes("read")) return "dot-read";
    if (lower.includes("edit") || lower.includes("write") || lower.includes("patch")) return "dot-write";
    if (lower.includes("search") || lower.includes("grep") || lower.includes("find") || lower.includes("glob")) return "dot-search";
    if (lower.includes("browser") || lower.includes("web") || lower.includes("fetch")) return "dot-browser";
    return "dot-default";
  }
  function parseToolSections(content) {
    const lines = String(content || "").split("\n");
    const chunks = [];
    let markdownBuffer = [];
    let currentTool = null;
    let inFence = false;
    function flushMarkdown() {
      const text = markdownBuffer.join("\n").trim();
      if (text) chunks.push({ type: "markdown", content: text });
      markdownBuffer = [];
    }
    function flushTool() {
      if (!currentTool) return;
      const body = currentTool.lines.join("\n").trimEnd();
      chunks.push({ type: "tool", name: currentTool.name, content: body });
      currentTool = null;
    }
    lines.forEach((line) => {
      const isFenceLine = /^```/.test(line.trim());
      const match = !inFence ? line.match(/^\[([^\]\n]+)\]\s*$/) : null;
      const codexOp = !inFence ? line.match(/^(Ran .+|Read .+|Edited file|Edit .+|Analyzed .+|Search(?:ed)? .+|Bash .+)\s*$/) : null;
      const bareOutputBlock = !inFence && line.match(/^(\d+\s+lines?(?:\s+of\s+output)?)$/i);
      if (match) {
        if (match[1].trim() === "end") {
          flushTool();
          return;
        }
        flushMarkdown();
        flushTool();
        currentTool = { name: match[1].trim(), lines: [] };
        return;
      }
      if (bareOutputBlock) {
        flushMarkdown();
        flushTool();
        currentTool = { name: bareOutputBlock[1].trim(), lines: [] };
        return;
      }
      if (codexOp) {
        flushMarkdown();
        flushTool();
        currentTool = { name: codexOp[1].trim(), lines: [] };
        return;
      }
      if (currentTool) currentTool.lines.push(line);
      else markdownBuffer.push(line);
      if (isFenceLine) inFence = !inFence;
    });
    flushMarkdown();
    flushTool();
    return chunks.length > 0 ? chunks : [{ type: "markdown", content: String(content || "") }];
  }
  function isDiffContent(text) {
    if (!text) return false;
    const normalized = String(text).replace(/\r\n?/g, "\n");
    if (/^(diff --git|index )/m.test(normalized)) return true;
    if (/^@@/m.test(normalized) || /^---[ \t]/m.test(normalized) && /^\+\+\+[ \t]/m.test(normalized)) return true;
    const lines = normalized.split("\n").map((line) => line.trimEnd());
    const nonEmpty = lines.filter(Boolean);
    if (nonEmpty.length < 4) return false;
    const changed = nonEmpty.filter((line) => /^[+-](?![-+]{2})/.test(line)).length;
    const adds = nonEmpty.filter((line) => /^\+(?!\+\+ )/.test(line)).length;
    const dels = nonEmpty.filter((line) => /^-(?!-- )/.test(line)).length;
    const context = nonEmpty.filter((line) => /^ /.test(line)).length;
    return changed >= 3 && adds >= 1 && dels >= 1 && context >= 1;
  }
  function extractDiffFilename(text) {
    const plus = text.match(/^\+\+\+[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);
    if (plus) {
      const p = plus[1].trim();
      if (p && p !== "/dev/null") return p;
    }
    const minus = text.match(/^---[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);
    if (minus) {
      const p = minus[1].trim();
      if (p && p !== "/dev/null") return p;
    }
    return null;
  }
  var MAX_WORD_DIFF_LEN = 300;
  function charLCS(a, b) {
    if (a.length > MAX_WORD_DIFF_LEN || b.length > MAX_WORD_DIFF_LEN) return null;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i2 = 1; i2 <= m; i2++) {
      for (let j2 = 1; j2 <= n; j2++) {
        dp[i2][j2] = a[i2 - 1] === b[j2 - 1] ? dp[i2 - 1][j2 - 1] + 1 : Math.max(dp[i2 - 1][j2], dp[i2][j2 - 1]);
      }
    }
    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        ops.unshift({ type: "eq" });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.unshift({ type: "ins" });
        j--;
      } else {
        ops.unshift({ type: "del" });
        i--;
      }
    }
    return ops;
  }
  function lcsDeletedRanges(ops) {
    const ranges = [];
    let pos = 0, start = null;
    for (const op of ops) {
      if (op.type === "del") {
        if (start === null) start = pos;
        pos++;
      } else if (op.type === "eq") {
        if (start !== null) {
          ranges.push({ start, end: pos });
          start = null;
        }
        pos++;
      }
    }
    if (start !== null) ranges.push({ start, end: pos });
    return ranges;
  }
  function lcsInsertedRanges(ops) {
    const ranges = [];
    let pos = 0, start = null;
    for (const op of ops) {
      if (op.type === "ins") {
        if (start === null) start = pos;
        pos++;
      } else if (op.type === "eq") {
        if (start !== null) {
          ranges.push({ start, end: pos });
          start = null;
        }
        pos++;
      }
    }
    if (start !== null) ranges.push({ start, end: pos });
    return ranges;
  }
  function injectMarksIntoHtml(html, ranges, cls) {
    if (!ranges || !ranges.length) return html;
    let result = "";
    let textPos = 0;
    let ri = 0;
    let inMark = false;
    let i = 0;
    while (i < html.length) {
      if (html[i] === "<") {
        if (inMark) {
          result += "</mark>";
          inMark = false;
        }
        const end = html.indexOf(">", i);
        if (end === -1) {
          result += html[i++];
          continue;
        }
        result += html.slice(i, end + 1);
        i = end + 1;
        if (ri < ranges.length && textPos >= ranges[ri].start && textPos < ranges[ri].end) {
          result += `<mark class="${cls}">`;
          inMark = true;
        }
      } else {
        if (inMark && textPos >= ranges[ri].end) {
          result += "</mark>";
          inMark = false;
          ri++;
        }
        if (!inMark && ri < ranges.length && textPos >= ranges[ri].start) {
          result += `<mark class="${cls}">`;
          inMark = true;
        }
        if (html[i] === "&") {
          const semi = html.indexOf(";", i + 1);
          const end = semi !== -1 && semi - i <= 8 ? semi + 1 : i + 1;
          result += html.slice(i, end);
          i = end;
        } else {
          result += html[i++];
        }
        textPos++;
      }
    }
    if (inMark) result += "</mark>";
    return result;
  }
  function addLineNumbers(hlHtml) {
    const lines = splitHighlightedLines(hlHtml);
    if (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    return lines.map(
      (line, i) => `<span class="code-line"><span class="code-line-num">${i + 1}</span>${line}</span>`
    ).join("");
  }
  var INLINE_FILE_REF_RE = /[A-Za-z]:\\[^\n"'`<>]+?\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?|(?:\.{1,2}[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?/g;
  function renderInlineFileRefs(text) {
    const source = String(text || "");
    let html = "";
    let lastIndex = 0;
    for (const match of source.matchAll(INLINE_FILE_REF_RE)) {
      const value = match[0];
      const start = match.index || 0;
      const end = start + value.length;
      const prev = start > 0 ? source[start - 1] : "";
      const next = end < source.length ? source[end] : "";
      const looksIsolated = (!prev || /[\s([{"'`]/.test(prev)) && (!next || /[\s)\]},"'`:;]/.test(next));
      const trimmed = value.trim();
      if (!looksIsolated || !looksLikePath(trimmed)) continue;
      html += escapeHtml(source.slice(lastIndex, start));
      html += `<button class="inline-file-ref tool-open-file" type="button" title="Open file preview" data-open-path="${escapeAttr(trimmed)}" data-copy-path="${escapeAttr(trimmed)}">${escapeHtml(trimmed)}</button>`;
      lastIndex = end;
    }
    html += escapeHtml(source.slice(lastIndex));
    return html || "&nbsp;";
  }
  function renderPlainTextCode(rawText) {
    const lines = String(rawText || "").replace(/\r\n/g, "\n").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.map(
      (line, i) => `<span class="code-line"><span class="code-line-num">${i + 1}</span>${renderInlineFileRefs(line)}</span>`
    ).join("");
  }
  function diffGutter(oldNum, newNum) {
    return `<span class="diff-gutter"><span class="diff-gutter-num diff-gutter-old">${oldNum != null ? oldNum : ""}</span><span class="diff-gutter-num diff-gutter-new">${newNum != null ? newNum : ""}</span></span>`;
  }
  function splitGutter(num) {
    return `<span class="diff-gutter"><span class="diff-gutter-num">${num != null ? num : ""}</span></span>`;
  }
  function assignLineNumbers(entries) {
    let oldLine = 0, newLine = 0;
    for (const entry of entries) {
      if (entry.type === "hunk") {
        const m = entry.raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) {
          oldLine = parseInt(m[1], 10) - 1;
          newLine = parseInt(m[2], 10) - 1;
        }
        entry.oldLine = null;
        entry.newLine = null;
      } else if (entry.type === "add") {
        entry.oldLine = null;
        entry.newLine = ++newLine;
      } else if (entry.type === "del") {
        entry.oldLine = ++oldLine;
        entry.newLine = null;
      } else if (entry.type === "ctx") {
        entry.oldLine = ++oldLine;
        entry.newLine = ++newLine;
      } else {
        entry.oldLine = null;
        entry.newLine = null;
      }
    }
  }
  function buildSplitRows(entries, hlLines, wordDiffContent) {
    const rows = [];
    const getContent = (idx) => wordDiffContent.has(idx) ? wordDiffContent.get(idx) : hlLines && hlLines[idx] != null ? hlLines[idx] : escapeHtml(
      entries[idx].raw.startsWith("+") || entries[idx].raw.startsWith("-") ? entries[idx].raw.slice(1) : entries[idx].raw.startsWith(" ") ? entries[idx].raw.slice(1) : entries[idx].raw
    );
    const hlCls = (idx) => hlLines && hlLines[idx] != null ? " diff-hl" : "";
    let i = 0;
    while (i < entries.length) {
      const e = entries[i];
      if (e.type === "meta") {
        const html = `<span class="diff-meta">${escapeHtml(e.raw)}</span>`;
        rows.push({ type: "both", html });
        i++;
        continue;
      }
      if (e.type === "hunk") {
        const html = `<span class="diff-hunk">${escapeHtml(e.raw)}</span>`;
        rows.push({ type: "both", html });
        i++;
        continue;
      }
      if (e.type === "ctx") {
        rows.push({ type: "ctx", content: getContent(i), hlCls: hlCls(i), oldLine: e.oldLine, newLine: e.newLine });
        i++;
        continue;
      }
      let di = i;
      while (di < entries.length && entries[di].type === "del") di++;
      let ai = di;
      while (ai < entries.length && entries[ai].type === "add") ai++;
      const delCount = di - i, addCount = ai - di;
      const pairs = Math.min(delCount, addCount);
      for (let k = 0; k < pairs; k++) {
        rows.push({
          type: "pair",
          delContent: getContent(i + k),
          delHlCls: hlCls(i + k),
          addContent: getContent(di + k),
          addHlCls: hlCls(di + k),
          delOldLine: entries[i + k].oldLine,
          addNewLine: entries[di + k].newLine
        });
      }
      for (let k = pairs; k < delCount; k++) {
        rows.push({ type: "del", content: getContent(i + k), hlCls: hlCls(i + k), oldLine: entries[i + k].oldLine });
      }
      for (let k = pairs; k < addCount; k++) {
        rows.push({ type: "add", content: getContent(di + k), hlCls: hlCls(di + k), newLine: entries[di + k].newLine });
      }
      i = ai > i ? ai : i + 1;
    }
    return rows;
  }
  function renderSplitHtml(rows) {
    const left = [], right = [];
    for (const row of rows) {
      if (row.type === "both") {
        left.push(row.html);
        right.push(row.html);
      } else if (row.type === "ctx") {
        left.push(`<span class="diff-ctx${row.hlCls}">${splitGutter(row.oldLine)}${row.content}</span>`);
        right.push(`<span class="diff-ctx${row.hlCls}">${splitGutter(row.newLine)}${row.content}</span>`);
      } else if (row.type === "pair") {
        left.push(`<span class="diff-del${row.delHlCls}">${splitGutter(row.delOldLine)}${row.delContent}</span>`);
        right.push(`<span class="diff-add${row.addHlCls}">${splitGutter(row.addNewLine)}${row.addContent}</span>`);
      } else if (row.type === "del") {
        left.push(`<span class="diff-del${row.hlCls}">${splitGutter(row.oldLine)}${row.content}</span>`);
        right.push(`<span class="diff-empty"></span>`);
      } else if (row.type === "add") {
        left.push(`<span class="diff-empty"></span>`);
        right.push(`<span class="diff-add${row.hlCls}">${splitGutter(row.newLine)}${row.content}</span>`);
      }
    }
    return `<div class="diff-split"><div class="diff-split-col diff-split-old"><code class="hljs diff-code">${left.join("")}</code></div><div class="diff-split-col diff-split-new"><code class="hljs diff-code">${right.join("")}</code></div></div>`;
  }
  function splitHighlightedLines(html) {
    const lines = [];
    let current = "";
    const openTags = [];
    let i = 0;
    while (i < html.length) {
      if (html[i] === "\n") {
        lines.push(current + "</span>".repeat(openTags.length));
        current = openTags.map((cls) => `<span class="${cls}">`).join("");
        i++;
      } else if (html[i] === "<") {
        if (html.startsWith("</span>", i)) {
          openTags.pop();
          current += "</span>";
          i += 7;
        } else if (html.startsWith("<span", i)) {
          const end = html.indexOf(">", i);
          if (end === -1) {
            current += html[i++];
            continue;
          }
          const tag = html.slice(i, end + 1);
          const m = tag.match(/class="([^"]*)"/);
          openTags.push(m ? m[1] : "");
          current += tag;
          i = end + 1;
        } else {
          current += html[i++];
        }
      } else {
        current += html[i++];
      }
    }
    if (current || openTags.length) {
      lines.push(current + "</span>".repeat(openTags.length));
    }
    return lines;
  }
  function renderDiff(text, lang) {
    const hljsLang = (() => {
      if (!lang || typeof hljs === "undefined") return null;
      if (hljs.getLanguage(lang)) return lang;
      const ext = lang.split(".").pop().toLowerCase();
      return hljs.getLanguage(ext) ? ext : null;
    })();
    const rawLines = text.split("\n");
    const entries = rawLines.map((line) => {
      if (/^\+\+\+|^---/.test(line)) return { type: "meta", raw: line };
      if (/^@@/.test(line)) return { type: "hunk", raw: line };
      if (line.startsWith("+")) return { type: "add", raw: line };
      if (line.startsWith("-")) return { type: "del", raw: line };
      return { type: "ctx", raw: line };
    });
    assignLineNumbers(entries);
    let hlLines = null;
    if (hljsLang) {
      try {
        const stripped = entries.map((e) => {
          if (e.type === "meta" || e.type === "hunk") return "";
          return e.raw.startsWith("+") || e.raw.startsWith("-") ? e.raw.slice(1) : e.raw.startsWith(" ") ? e.raw.slice(1) : e.raw;
        });
        const result = hljs.highlight(stripped.join("\n"), { language: hljsLang });
        hlLines = splitHighlightedLines(result.value);
      } catch (_) {
        hlLines = null;
      }
    }
    const wordDiffContent = /* @__PURE__ */ new Map();
    for (let si = 0; si < entries.length; ) {
      if (entries[si].type !== "del") {
        si++;
        continue;
      }
      let di = si;
      while (di < entries.length && entries[di].type === "del") di++;
      let ai = di;
      while (ai < entries.length && entries[ai].type === "add") ai++;
      const delCount = di - si;
      const addCount = ai - di;
      if (delCount === addCount && delCount > 0) {
        for (let k = 0; k < delCount; k++) {
          const delIdx = si + k;
          const addIdx = di + k;
          const delPlain = entries[delIdx].raw.slice(1);
          const addPlain = entries[addIdx].raw.slice(1);
          const ops = charLCS(delPlain, addPlain);
          if (!ops) continue;
          const lcsLen = ops.filter((o) => o.type === "eq").length;
          const maxLen = Math.max(delPlain.length, addPlain.length);
          if (maxLen > 0 && lcsLen / maxLen < 0.15) continue;
          const delBase = hlLines && hlLines[delIdx] != null ? hlLines[delIdx] : escapeHtml(delPlain);
          const addBase = hlLines && hlLines[addIdx] != null ? hlLines[addIdx] : escapeHtml(addPlain);
          wordDiffContent.set(delIdx, injectMarksIntoHtml(delBase, lcsDeletedRanges(ops), "diff-word-del"));
          wordDiffContent.set(addIdx, injectMarksIntoHtml(addBase, lcsInsertedRanges(ops), "diff-word-add"));
        }
      }
      si = ai > si ? ai : si + 1;
    }
    let adds = 0, dels = 0;
    let hunkId = 0;
    let hasHunks = false;
    const outputLines = entries.map((entry, i) => {
      if (entry.type === "meta") {
        return `<span class="diff-meta">${escapeHtml(entry.raw)}</span>`;
      }
      if (entry.type === "hunk") {
        hasHunks = true;
        hunkId++;
        return `<span class="diff-hunk diff-hunk-btn" data-hunk-id="${hunkId}" role="button" tabindex="0" title="Toggle context lines">${escapeHtml(entry.raw)}</span>`;
      }
      const plain = entry.raw.startsWith("+") || entry.raw.startsWith("-") ? entry.raw.slice(1) : entry.raw.startsWith(" ") ? entry.raw.slice(1) : entry.raw;
      const content = wordDiffContent.has(i) ? wordDiffContent.get(i) : hlLines && hlLines[i] != null ? hlLines[i] : escapeHtml(plain);
      const hlClass = hlLines && hlLines[i] != null ? " diff-hl" : "";
      const hunkAttr = hunkId > 0 ? ` data-hunk-ctx="${hunkId}"` : "";
      if (entry.type === "add") {
        adds++;
        return `<span class="diff-add${hlClass}"${hunkAttr}>${diffGutter(null, entry.newLine)}${content}</span>`;
      }
      if (entry.type === "del") {
        dels++;
        return `<span class="diff-del${hlClass}"${hunkAttr}>${diffGutter(entry.oldLine, null)}${content}</span>`;
      }
      return `<span class="diff-ctx${hlClass}"${hunkAttr}>${diffGutter(entry.oldLine, entry.newLine)}${content}</span>`;
    });
    const stats = adds || dels ? `<span class="diff-stat-add">+${adds}</span><span class="diff-stat-del">-${dels}</span>` : "";
    const splitRows = buildSplitRows(entries, hlLines, wordDiffContent);
    const splitHtml = renderSplitHtml(splitRows);
    return { body: outputLines.join(""), stats, splitHtml, hasHunks };
  }
  var SPLIT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`;
  var SEARCH_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  var COPY_SVG = `<svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  var CHECK_SVG = `<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  var codeRenderer = new marked.Renderer();
  codeRenderer.code = function(code, infostring) {
    let text = typeof code === "object" ? code.text || code.raw || "" : code || "";
    let info = typeof code === "object" ? code.lang || "" : infostring || "";
    const lang = info.split(/\s/)[0].toLowerCase() || "text";
    const isDiff = lang === "diff" || lang === "patch" || isDiffContent(text);
    const isPlainTextBlock = !isDiff && (lang === "text" || lang === "markdown");
    let body;
    let statsHtml = "";
    let filepath = "";
    let splitHtml = "";
    let diffResult = null;
    if (isDiff) {
      filepath = extractDiffFilename(text) || "";
      const diffLang = filepath ? getLang(filepath) : null;
      diffResult = renderDiff(text, diffLang);
      body = diffResult.body;
      statsHtml = diffResult.stats;
      splitHtml = diffResult.splitHtml || "";
    } else {
      if (isPlainTextBlock) {
        body = renderPlainTextCode(text);
      } else {
        try {
          body = hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang }).value : hljs.highlightAuto(text).value;
        } catch (e) {
          body = escapeHtml(text);
        }
      }
    }
    const rawText = text;
    if (!isDiff && !isPlainTextBlock) body = addLineNumbers(body);
    const displayLang = isDiff || lang === "text" ? "" : lang;
    const filepathHtml = filepath ? `<button class="diff-filepath" title="Open file preview" data-copy-path="${escapeAttr(filepath)}" data-open-path="${escapeAttr(filepath)}">${escapeHtml(filepath)}</button>` : "";
    const splitToggle = splitHtml ? `<button class="diff-split-toggle" title="Toggle side-by-side view">${SPLIT_SVG}</button>` : "";
    const ctxCollapseToggle = isDiff && diffResult && diffResult.hasHunks ? `<button class="diff-ctx-collapse-all" title="Collapse/expand all context lines">Context</button>` : "";
    const collapsible = false;
    const expandToggle = "";
    const wrapOn = typeof localStorage !== "undefined" && localStorage.getItem("codeblock_wrap_pref") === "1";
    const wrapToggle = `<button class="code-wrap-toggle${wrapOn ? " active" : ""}" title="${wrapOn ? "Disable word wrap" : "Enable word wrap"}">${wrapOn ? "No Wrap" : "Wrap"}</button>`;
    const rawAttr = !isDiff ? ` data-raw="${escapeAttr(rawText)}"` : "";
    return `<div class="code-block${isDiff ? " diff-block" : ""}${collapsible ? " code-collapsible" : ""}${wrapOn ? " code-wrap" : ""}" data-diff-mode="unified">
    <div class="code-header">
      <span class="code-lang">${displayLang}</span>
      ${filepathHtml}
      <span class="diff-stats">${statsHtml}</span>
      ${ctxCollapseToggle}
      ${splitToggle}
      ${expandToggle}
      ${wrapToggle}
      <button class="code-search-btn" title="Search in block">${SEARCH_SVG}</button>
      <button class="code-copy" title="Copy code">${COPY_SVG}${CHECK_SVG}<span class="copy-label">Copy</span></button>
    </div>
    <div class="code-search-bar" hidden>
      <input class="code-search-input" type="text" placeholder="Search\u2026" aria-label="Search in code block">
      <span class="code-search-count"></span>
      <button class="code-search-prev" title="Previous match">&#8593;</button>
      <button class="code-search-next" title="Next match">&#8595;</button>
      <button class="code-search-close" title="Close search">&#10005;</button>
    </div>
    <pre><code class="hljs${isDiff ? " diff-code" : ""}"${rawAttr}>${body}</code></pre>
    ${splitHtml}
  </div>`;
  };
  marked.use({ renderer: codeRenderer, breaks: true, gfm: true });
  function extractToolPreview(name, lines) {
    const lname = (name || "").toLowerCase();
    if (lname === "bash" || lname === "run" || lname === "execute" || lname === "shell") {
      const cmd = lines.find((l) => l.trim());
      return cmd ? cmd.trim().substring(0, 80) : "";
    }
    const first = lines.find((l) => l.trim());
    if (first && looksLikePath(first.trim())) return first.trim();
    if (first) return first.trim().substring(0, 60);
    return "";
  }
  function renderToolSection(name, text, index) {
    const lines = String(text || "").replace(/\n+$/, "").split("\n");
    const nonEmpty = lines.find((line) => line.trim());
    const path = nonEmpty && looksLikePath(nonEmpty.trim()) ? nonEmpty.trim() : "";
    const renderToolPath = (value, extraClass = "") => {
      const trimmed = String(value || "").trim();
      if (!trimmed) return "";
      const className = ["tool-path", extraClass, looksLikePath(trimmed) ? "tool-open-file" : ""].filter(Boolean).join(" ");
      if (!looksLikePath(trimmed)) return `<span class="${className}">${escapeHtml(trimmed)}</span>`;
      return `<button class="${className}" type="button" title="Open file preview" data-open-path="${escapeAttr(trimmed)}" data-copy-path="${escapeAttr(trimmed)}">${escapeHtml(trimmed)}</button>`;
    };
    const lineCount = lines.filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === "")).length;
    const isOutputBlock = /^\d+\s+lines?(?:\s+of\s+output)?$/i.test(name.trim());
    const hasContent = lines.some((l) => l.trim());
    const isEmpty = isOutputBlock && lineCount === 0 || !hasContent;
    const isBashBlock = /^Bash\b/i.test(name.trim());
    const isCommandOnlyBash = isBashBlock && lines.every((line) => {
      const t = line.trim();
      return !t || /^\$\s+/.test(t);
    });
    const collapsed = !hasContent;
    const visibleText = lines.join("\n");
    const stats = countDiffStats(text);
    const renderAsDiff = isDiffContent(text) || hasEditLikeToolName(name) && (stats.adds || stats.dels);
    const filepath = renderAsDiff ? extractDiffFilename(text) || path : path;
    const diffLang = renderAsDiff && filepath ? getLang(filepath) : null;
    const diffText = (() => {
      if (!renderAsDiff) return visibleText;
      let t = visibleText;
      const fenceMatch = t.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```\s*$/m);
      if (fenceMatch) t = fenceMatch[1];
      const dlines = t.split("\n");
      let start = 0;
      while (start < dlines.length) {
        const l = dlines[start];
        if (l.startsWith("+") || l.startsWith("-") || l.startsWith("@@") || l.startsWith(" ")) break;
        start++;
      }
      return dlines.slice(start).join("\n");
    })();
    const hasDiffBody = renderAsDiff && hasRenderableDiffPayload(diffText);
    const diff = hasDiffBody ? renderDiff(diffText, diffLang) : null;
    const statHtml = stats.adds || stats.dels ? `<span class="tool-stat-add">+${stats.adds}</span><span class="tool-stat-del">-${stats.dels}</span>` : "";
    const editSummary = renderAsDiff ? (() => {
      for (const l of lines) {
        const t = l.trim();
        if (t && !t.startsWith("```") && !t.startsWith("+") && !t.startsWith("-") && !t.startsWith("@@") && !t.startsWith(" ")) return t;
      }
      return "";
    })() : "";
    const preview = collapsed && !filepath ? editSummary || extractToolPreview(name, lines) : editSummary || "";
    const hasBody = !isEmpty && (hasDiffBody || !renderAsDiff);
    return `<section class="tool-section${collapsed ? " collapsed" : ""}" data-tool-index="${index}">
    <button class="tool-toggle" type="button" aria-expanded="${collapsed ? "false" : "true"}">
      <span class="tool-chevron">${hasBody ? collapsed ? "\u25B8" : "\u25BE" : ""}</span>
      <span class="tool-dot ${toolDotClass(name)}">\u25CF</span>
      <span class="tool-toggle-main">
        ${(() => {
      const spaceIdx = name.indexOf(" ");
      if (spaceIdx > 0) {
        const verb = name.substring(0, spaceIdx);
        const desc = name.substring(spaceIdx + 1).trim();
        return `<span class="tool-name">${escapeHtml(verb)}</span>${renderToolPath(desc)}`;
      }
      return `<span class="tool-name">${escapeHtml(name)}</span>`;
    })()}
        ${filepath ? renderToolPath(filepath, "tool-path-secondary") : ""}
        ${preview ? `<span class="tool-preview">${escapeHtml(preview)}</span>` : ""}
      </span>
      <span class="tool-toggle-side">
        ${statHtml}
        ${isOutputBlock && lineCount > 0 ? `<span class="tool-line-count">${lineCount} lines</span>` : ""}
      </span>
    </button>
    ${hasBody ? `<div class="tool-body"${collapsed ? " hidden" : ""}>
      ${hasDiffBody ? `<div class="code-block diff-block tool-diff-block" data-diff-mode="unified">
            <div class="code-header">
              <span class="code-lang"></span>
              ${filepath ? `<button class="diff-filepath" title="Open file preview" data-copy-path="${escapeAttr(filepath)}" data-open-path="${escapeAttr(filepath)}">${escapeHtml(filepath)}</button>` : ""}
              <span class="diff-stats">${diff?.stats || ""}</span>
              ${diff?.hasHunks ? `<button class="diff-ctx-collapse-all" title="Collapse/expand all context lines">Context</button>` : ""}
              ${diff?.splitHtml ? `<button class="diff-split-toggle" title="Toggle side-by-side view">${SPLIT_SVG}</button>` : ""}
            </div>
            <pre><code class="hljs diff-code">${diff?.body || ""}</code></pre>
            ${diff?.splitHtml || ""}
          </div>` : (() => {
      const _io = parseIOBlock(visibleText);
      if (_io) return renderIOBlock(_io, index + "_b");
      const trimmed = visibleText.trim();
      if (trimmed.startsWith("```")) return `<div class="tool-body-md">${marked.parse(trimmed)}</div>`;
      return `<pre class="tool-body-pre"><code>${escapeHtml(visibleText)}</code></pre>`;
    })()}
    </div>` : ""}
  </section>`;
  }
  var IO_BLOCK_RE = /^IN\n\n?```([^\n]*)\n([\s\S]*?)\n```\n\n?OUT(?:\n\n?```([^\n]*)\n([\s\S]*?)\n```)?[\s]*$/;
  var IO_PLAIN_RE = /^IN\n([\s\S]*?)(?:\nOUT\n([\s\S]*))?$/;
  function parseIOBlock(content) {
    if (!content) return null;
    const c = content.replace(/\r\n/g, "\n");
    if (!c.startsWith("IN\n")) return null;
    const m = c.match(IO_BLOCK_RE);
    if (m) return { inLang: m[1] || "", inText: m[2] || "", outLang: m[3] || "", outText: m[4] || "" };
    const mp = c.match(IO_PLAIN_RE);
    if (mp) return { inLang: "", inText: (mp[1] || "").trim(), outLang: "", outText: (mp[2] || "").trim() };
    return null;
  }
  function renderIOBlock(io, index) {
    const inLines = (io.inText || "").trimEnd().split("\n");
    const outLines = (io.outText || "").trimEnd().split("\n");
    const renderRow = (label, lines) => {
      const fullHtml = escapeHtml(lines.join("\n"));
      const emptyNote = lines.length === 0 || lines.length === 1 && !lines[0].trim() ? '<span class="tool-io-empty">(no output)</span>' : "";
      return `<div class="tool-io-row">
      <span class="tool-io-label">${label}</span>
      <div class="tool-io-content">${emptyNote || `<code class="tool-io-code">${fullHtml}</code>`}</div>
    </div>`;
    };
    const outEmpty = outLines.length === 0 || outLines.length === 1 && !outLines[0].trim();
    return `<div class="tool-io-block" data-tool-index="${index}">${renderRow("IN", inLines)}${outEmpty ? "" : renderRow("OUT", outLines)}</div>`;
  }
  function parseFileChangesBlock(content) {
    const text = String(content || "").replace(/\r\n/g, "\n");
    if (!text.trim()) return null;
    const rawLines = text.split("\n");
    const headerRe = /^\s*(\d+)\s+file(?:\(s\)|s?)\s+changed(?:\s+in\s+this\s+conversation)?/i;
    const headerLineIdx = rawLines.findIndex((line) => headerRe.test(line));
    if (headerLineIdx === -1) return null;
    const header = rawLines[headerLineIdx].trim();
    const countMatch = header.match(headerRe);
    if (!countMatch) return null;
    const totalsFromLine = (line) => {
      const match = String(line || "").match(/\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)/);
      return match ? { adds: Number(match[1]) || 0, dels: Number(match[2]) || 0 } : null;
    };
    let totals = totalsFromLine(header);
    let pendingAdds = null;
    const entries = [];
    let pendingPath = "";
    let lastConsumedIdx = headerLineIdx;
    for (let ri = headerLineIdx + 1; ri < rawLines.length; ri++) {
      const line = rawLines[ri].trim();
      if (!line) continue;
      if (!totals) {
        const t = totalsFromLine(line);
        if (t) {
          totals = t;
          lastConsumedIdx = ri;
          continue;
        }
      }
      const addsOnly = line.match(/^\+(\d+)$/);
      if (addsOnly) {
        pendingAdds = Number(addsOnly[1]) || 0;
        lastConsumedIdx = ri;
        continue;
      }
      const delsOnly = line.match(/^-(\d+)$/);
      if (delsOnly && pendingAdds != null && !totals) {
        totals = { adds: pendingAdds, dels: Number(delsOnly[1]) || 0 };
        pendingAdds = null;
        lastConsumedIdx = ri;
        continue;
      }
      const statsOnly = line.match(/^\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)$/);
      if (statsOnly && pendingPath) {
        entries.push({
          filepath: pendingPath,
          adds: Number(statsOnly[1]) || 0,
          dels: Number(statsOnly[2]) || 0
        });
        pendingPath = "";
        lastConsumedIdx = ri;
        continue;
      }
      const entry = line.match(/^(.+?)\s+\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)(?:\s+.*)?$/);
      if (!entry) {
        if (looksLikePath(line)) {
          pendingPath = line;
          lastConsumedIdx = ri;
          continue;
        }
        break;
      }
      const filepath = entry[1].trim();
      if (!filepath || /^\+?\d+$/.test(filepath)) {
        break;
      }
      entries.push({
        filepath,
        adds: Number(entry[2]) || 0,
        dels: Number(entry[3]) || 0
      });
      pendingPath = "";
      lastConsumedIdx = ri;
    }
    if (entries.length === 0) return null;
    const adds = totals?.adds ?? entries.reduce((sum, entry) => sum + entry.adds, 0);
    const dels = totals?.dels ?? entries.reduce((sum, entry) => sum + entry.dels, 0);
    const beforeText = rawLines.slice(0, headerLineIdx).join("\n").replace(/\s+$/g, "");
    const afterText = rawLines.slice(lastConsumedIdx + 1).join("\n").replace(/^\s+/g, "");
    return {
      count: Number(countMatch[1]) || entries.length,
      title: header.replace(/\s+\+\d+.*$/, "").trim(),
      adds,
      dels,
      entries,
      beforeText,
      afterText
    };
  }
  function renderFileChangesBlockFromParsed(parsed, index) {
    const entryHtml = parsed.entries.map((entry) => {
      const path = escapeHtml(entry.filepath);
      return `<div class="file-changes-item">
      <span class="file-changes-path">${path}</span>
      <span class="file-changes-stats"><span class="diff-stat-add">+${entry.adds}</span><span class="diff-stat-del">-${entry.dels}</span></span>
    </div>`;
    }).join("");
    return `<section class="file-changes-section" data-file-changes-index="${index}">
    <button class="file-changes-toggle" type="button" aria-expanded="true">
      <span class="file-changes-chevron">v</span>
      <span class="file-changes-icon">files</span>
      <span class="file-changes-title">${escapeHtml(parsed.title || `${parsed.count} file(s) changed`)}</span>
      <span class="file-changes-summary">
        <span class="diff-stat-add">+${parsed.adds}</span>
        <span class="diff-stat-del">-${parsed.dels}</span>
      </span>
    </button>
    ${parsed.entries.length ? `<div class="file-changes-list">${entryHtml}</div>` : ""}
  </section>`;
  }
  function renderSubagentsBlock(payload, index) {
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) return null;
    const titleText = parsed.title || "Subagents";
    const items = parsed.items.map((it, i) => {
      const status = String(it.status || "unknown").toLowerCase();
      const icon = status === "running" ? '<span class="subagent-spinner" aria-hidden="true"></span>' : status === "done" ? '<span class="subagent-icon subagent-icon-done" aria-hidden="true">&#10003;</span>' : status === "failed" ? '<span class="subagent-icon subagent-icon-fail" aria-hidden="true">&#10007;</span>' : '<span class="subagent-icon subagent-icon-unknown" aria-hidden="true">&#9679;</span>';
      const promptText = String(it.prompt || "").trim();
      const stats = String(it.stats || "").trim();
      const calls = Array.isArray(it.tool_calls) ? it.tool_calls.filter(Boolean) : [];
      const callsHtml = calls.length ? `<ul class="subagent-calls">${calls.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join("")}</ul>` : "";
      return `<li class="subagent-item subagent-status-${escapeHtml(status)}">
      <div class="subagent-row">${icon}<div class="subagent-prompt" title="${escapeHtml(promptText)}">${escapeHtml(promptText)}</div></div>
      ${stats ? `<div class="subagent-stats">${escapeHtml(stats)}</div>` : ""}
      ${callsHtml}
    </li>`;
    }).join("");
    return `<section class="subagents-section" data-subagents-index="${index}">
    <div class="subagents-header"><span class="subagents-icon" aria-hidden="true">&#9783;</span><span class="subagents-title">${escapeHtml(titleText)}</span></div>
    <ul class="subagents-list">${items}</ul>
  </section>`;
  }
  function extractTaskCompletedWrapper(content) {
    const m = String(content || "").match(/^Task Completed\s*\n+([\s\S]*?)\s*$/);
    if (!m) return { content, wrap: false };
    let body = m[1].replace(/HAS_CHANGES\s*$/i, "").trimEnd();
    return { content: body, wrap: true };
  }
  function wrapTaskCompletedHtml(innerHtml) {
    return `<section class="task-completed-section">
    <div class="task-completed-header">
      <span class="task-completed-icon" aria-hidden="true">&#10003;</span>
      <span class="task-completed-title">Task Completed</span>
    </div>
    <div class="task-completed-body">${innerHtml}</div>
  </section>`;
  }
  function extractSubagentsBlocks(content) {
    const blocks = [];
    const re = /^~~~subagents\s*\n([\s\S]*?)\n~~~\s*$/gm;
    const replaced = String(content || "").replace(re, (_m, payload) => {
      const html = renderSubagentsBlock(payload, blocks.length) || "";
      blocks.push(html);
      return `\0SUBAGENTS_BLOCK_${blocks.length - 1}\0`;
    });
    return { content: replaced, blocks };
  }
  function renderStructuredContent(content) {
    const { content: stripped, wrap: wrapTaskCompleted } = extractTaskCompletedWrapper(content);
    content = stripped;
    const { content: prepped, blocks: subagentBlocks } = extractSubagentsBlocks(content);
    content = prepped;
    const html = parseToolSections(content).map((chunk, index) => {
      try {
        if (chunk.type === "tool") return renderToolSection(chunk.name, chunk.content, index);
        const io = parseIOBlock(chunk.content);
        if (io) return renderIOBlock(io, index);
        const fileChangesParsed = parseFileChangesBlock(chunk.content);
        if (fileChangesParsed) {
          const cardHtml = renderFileChangesBlockFromParsed(fileChangesParsed, index);
          const beforeHtml = (fileChangesParsed.beforeText || "").trim() ? marked.parse(fileChangesParsed.beforeText) : "";
          const afterHtml = (fileChangesParsed.afterText || "").trim() ? marked.parse(fileChangesParsed.afterText) : "";
          return beforeHtml + cardHtml + afterHtml;
        }
        if (!(chunk.content || "").trim()) return "";
        return marked.parse(chunk.content || "");
      } catch (e) {
        return '<pre style="color:var(--red,#f26d78);font-size:11px">[render error: ' + escapeHtml(String(e)) + "]</pre><pre>" + escapeHtml(chunk.content || "") + "</pre>";
      }
    }).join("");
    let htmlWithSubagents = html;
    if (subagentBlocks.length) {
      htmlWithSubagents = htmlWithSubagents.replace(/\s*SUBAGENTS_BLOCK_(\d+)\s*/g, (_m, i) => {
        return subagentBlocks[Number(i)] || "";
      });
    }
    const tmp = document.createElement("div");
    if (typeof DOMPurify !== "undefined") {
      tmp.innerHTML = DOMPurify.sanitize(htmlWithSubagents, { ADD_DATA_URI_TAGS: ["img"], ALLOW_DATA_ATTR: true });
    } else {
      tmp.textContent = htmlWithSubagents;
    }
    const diffBlocks = Array.from(tmp.querySelectorAll(".diff-block"));
    const fileEntries = diffBlocks.map((block, i) => {
      const pathEl = block.querySelector(".diff-filepath");
      if (!pathEl) return null;
      const filepath = pathEl.textContent.trim();
      if (!filepath) return null;
      const addEl = block.querySelector(".diff-stat-add, .tool-stat-add");
      const delEl = block.querySelector(".diff-stat-del, .tool-stat-del");
      const adds = addEl ? parseInt(addEl.textContent, 10) || 0 : 0;
      const dels = delEl ? parseInt(delEl.textContent, 10) || 0 : 0;
      block.id = `diff-file-${i}`;
      return { filepath, adds, dels, id: `diff-file-${i}` };
    }).filter(Boolean);
    if (fileEntries.length >= 2) {
      const totalAdds = fileEntries.reduce((s, e) => s + e.adds, 0);
      const totalDels = fileEntries.reduce((s, e) => s + e.dels, 0);
      const chips = fileEntries.map((e) => {
        const name = e.filepath.split(/[/\\]/).pop();
        return `<a class="diff-summary-chip" data-target="${escapeAttr(e.id)}" href="#${escapeAttr(e.id)}" title="${escapeAttr(e.filepath)}"><span class="diff-summary-name">${escapeHtml(name)}</span><span class="diff-stat-add">+${e.adds}</span><span class="diff-stat-del">-${e.dels}</span></a>`;
      }).join("");
      const totals = `<span class="diff-summary-totals"><span class="diff-summary-count">${fileEntries.length} files</span><span class="diff-stat-add">+${totalAdds}</span><span class="diff-stat-del">-${totalDels}</span></span>`;
      const bar = document.createElement("div");
      bar.className = "diff-summary-bar";
      bar.innerHTML = chips + totals;
      tmp.insertBefore(bar, tmp.firstChild);
    }
    if (wrapTaskCompleted) return wrapTaskCompletedHtml(tmp.innerHTML);
    return tmp.innerHTML;
  }
  function _codeTextMap(codeEl) {
    const ranges = [];
    let offset = 0;
    const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT, null);
    let node;
    while (node = walker.nextNode()) {
      if (node.parentElement && node.parentElement.classList.contains("code-line-num")) continue;
      const len = node.nodeValue.length;
      ranges.push({ node, start: offset, end: offset + len });
      offset += len;
    }
    return { text: ranges.map((r) => r.node.nodeValue).join(""), ranges };
  }
  function _codeSearchClear(block) {
    if (!block) return;
    const codeEl = block.querySelector("code");
    if (!codeEl) return;
    codeEl.querySelectorAll("mark.code-search-mark").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
    const count = block.querySelector(".code-search-count");
    if (count) count.textContent = "";
    delete block._searchState;
  }
  function _codeSearchRun(block) {
    if (!block) return;
    _codeSearchClear(block);
    const input = block.querySelector(".code-search-input");
    const query = input ? input.value : "";
    if (!query) return;
    const codeEl = block.querySelector("code");
    if (!codeEl) return;
    const { text, ranges } = _codeTextMap(codeEl);
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchOffsets = [];
    let pos = 0;
    while (pos < text.length) {
      const idx = lowerText.indexOf(lowerQuery, pos);
      if (idx === -1) break;
      matchOffsets.push(idx);
      pos = idx + query.length;
    }
    if (!matchOffsets.length) {
      const count2 = block.querySelector(".code-search-count");
      if (count2) count2.textContent = "0 / 0";
      return;
    }
    const allMarks = [];
    for (let mi = matchOffsets.length - 1; mi >= 0; mi--) {
      const matchStart = matchOffsets[mi];
      const matchEnd = matchStart + query.length;
      const overlapping = ranges.filter((r) => r.end > matchStart && r.start < matchEnd);
      for (let ri = overlapping.length - 1; ri >= 0; ri--) {
        const r = overlapping[ri];
        const localStart = Math.max(0, matchStart - r.start);
        const localEnd = Math.min(r.node.nodeValue.length, matchEnd - r.start);
        const node = r.node;
        const text2 = node.nodeValue;
        const mark = document.createElement("mark");
        mark.className = "code-search-mark";
        mark.textContent = text2.slice(localStart, localEnd);
        const parent = node.parentNode;
        if (localEnd < text2.length) {
          parent.insertBefore(document.createTextNode(text2.slice(localEnd)), node.nextSibling);
        }
        parent.insertBefore(mark, localEnd < text2.length ? node.nextSibling.previousSibling : node.nextSibling);
        if (localStart > 0) {
          node.nodeValue = text2.slice(0, localStart);
        } else {
          parent.removeChild(node);
        }
        allMarks.unshift(mark);
      }
    }
    block._searchState = { marks: allMarks, current: 0 };
    const count = block.querySelector(".code-search-count");
    if (count) count.textContent = allMarks.length ? `1 / ${allMarks.length}` : "0 / 0";
    if (allMarks.length) {
      allMarks[0].classList.add("current");
      allMarks[0].scrollIntoView({ block: "nearest" });
    }
  }
  function _codeSearchNav(block, direction) {
    if (!block || !block._searchState) return;
    const { marks } = block._searchState;
    if (!marks.length) return;
    marks[block._searchState.current].classList.remove("current");
    block._searchState.current = (block._searchState.current + direction + marks.length) % marks.length;
    const cur = marks[block._searchState.current];
    cur.classList.add("current");
    cur.scrollIntoView({ block: "nearest" });
    const count = block.querySelector(".code-search-count");
    if (count) count.textContent = `${block._searchState.current + 1} / ${marks.length}`;
  }
  function _extractLastOpenBlock(text) {
    const matches = [];
    let i = 0;
    while (i < text.length) {
      if ((i === 0 || text[i - 1] === "\n") && text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`") {
        matches.push(i);
        i += 3;
      } else {
        i++;
      }
    }
    if (matches.length % 2 === 0) return null;
    const openIdx = matches[matches.length - 1];
    const blockText = text.slice(openIdx + 3);
    const firstNL = blockText.indexOf("\n");
    if (firstNL === -1) return { lang: "text", code: "" };
    const info = blockText.slice(0, firstNL).trim();
    const lang = info.split(/\s/)[0].toLowerCase() || "text";
    const code = blockText.slice(firstNL + 1);
    return { lang, code };
  }
  var richContentVisibilityCallbacks = /* @__PURE__ */ new Map();
  var richContentVisibilityObserver = null;
  var richContentHtmlCache = /* @__PURE__ */ new Map();
  var richContentHtmlCacheBytes = 0;
  var RICH_CONTENT_CACHE_MAX_ENTRIES = 256;
  var RICH_CONTENT_CACHE_MAX_BYTES = 8 * 1024 * 1024;
  function richContentHash(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function observeNearViewport(node, callback) {
    const target = node?.closest?.(".message") || node;
    if (!target || typeof IntersectionObserver === "undefined") {
      callback();
      return () => {
      };
    }
    if (!richContentVisibilityObserver) {
      richContentVisibilityObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callbacks2 = richContentVisibilityCallbacks.get(entry.target);
          if (!callbacks2) continue;
          richContentVisibilityCallbacks.delete(entry.target);
          richContentVisibilityObserver.unobserve(entry.target);
          for (const activate of callbacks2) activate();
        }
      }, { root: null, rootMargin: "35% 0px", threshold: 0 });
    }
    let callbacks = richContentVisibilityCallbacks.get(target);
    if (!callbacks) {
      callbacks = /* @__PURE__ */ new Set();
      richContentVisibilityCallbacks.set(target, callbacks);
      richContentVisibilityObserver.observe(target);
    }
    callbacks.add(callback);
    return () => {
      const active = richContentVisibilityCallbacks.get(target);
      if (!active) return;
      active.delete(callback);
      if (active.size > 0) return;
      richContentVisibilityCallbacks.delete(target);
      richContentVisibilityObserver?.unobserve(target);
    };
  }
  function cachedRichContentHtml(content, cacheIdentity) {
    const text = String(content || "");
    const key = `${cacheIdentity || "content"}${text.length}${richContentHash(text)}`;
    const cached = richContentHtmlCache.get(key);
    if (cached && cached.content === text) {
      richContentHtmlCache.delete(key);
      richContentHtmlCache.set(key, cached);
      return cached.html;
    }
    const rendered = renderStructuredContent(text);
    const html = typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(rendered, { ADD_DATA_URI_TAGS: ["img"], ALLOW_DATA_ATTR: true }) : rendered;
    const bytes = (text.length + html.length) * 2;
    richContentHtmlCache.set(key, { content: text, html, bytes });
    richContentHtmlCacheBytes += bytes;
    while (richContentHtmlCache.size > RICH_CONTENT_CACHE_MAX_ENTRIES || richContentHtmlCacheBytes > RICH_CONTENT_CACHE_MAX_BYTES) {
      const oldestKey = richContentHtmlCache.keys().next().value;
      const oldest = richContentHtmlCache.get(oldestKey);
      richContentHtmlCache.delete(oldestKey);
      richContentHtmlCacheBytes -= oldest?.bytes || 0;
    }
    return html;
  }
  function MarkdownContent({
    content,
    monospace = false,
    onOpenPath = null,
    autoExpandLongCodeBlocks = false,
    deferUntilVisible = false,
    cacheIdentity = ""
  }) {
    const ref = React.useRef(null);
    const lastContent = React.useRef(null);
    const onOpenPathRef = React.useRef(onOpenPath);
    const [richContentReady, setRichContentReady] = React.useState(!deferUntilVisible);
    onOpenPathRef.current = onOpenPath;
    React.useEffect(() => {
      if (!deferUntilVisible) {
        setRichContentReady(true);
        return void 0;
      }
      if (richContentReady) return void 0;
      return observeNearViewport(ref.current, () => setRichContentReady(true));
    }, [deferUntilVisible, richContentReady]);
    React.useEffect(() => {
      if (!ref.current) return;
      if (!richContentReady) return;
      if (content === lastContent.current) return;
      const prev = lastContent.current;
      if (prev !== null && content.startsWith(prev)) {
        const openBlock = _extractLastOpenBlock(content);
        if (openBlock && !isDiffContent(openBlock.code)) {
          const codeBlocks = ref.current.querySelectorAll(".code-block:not(.diff-block)");
          const lastBlock = codeBlocks.length > 0 ? codeBlocks[codeBlocks.length - 1] : null;
          const pre = lastBlock?.querySelector(":scope > pre");
          const codeEl = pre?.querySelector("code");
          if (codeEl) {
            const scrollTop = pre.scrollTop;
            let highlighted;
            try {
              highlighted = typeof hljs !== "undefined" && hljs.getLanguage(openBlock.lang) ? hljs.highlight(openBlock.code, { language: openBlock.lang }).value : escapeHtml(openBlock.code);
            } catch (_) {
              highlighted = escapeHtml(openBlock.code);
            }
            codeEl.innerHTML = addLineNumbers(highlighted);
            codeEl.dataset.raw = openBlock.code;
            pre.scrollTop = scrollTop;
            lastContent.current = content;
            return;
          }
        }
      }
      const snap = { toolCollapsed: {}, fileChangesCollapsed: {}, codeScroll: [], ctxHidden: {}, ctxCollapseActive: {} };
      if (lastContent.current !== null) {
        ref.current.querySelectorAll(".tool-section[data-tool-index]").forEach((s) => {
          snap.toolCollapsed[s.dataset.toolIndex] = s.classList.contains("collapsed");
        });
        ref.current.querySelectorAll(".file-changes-section[data-file-changes-index]").forEach((s) => {
          snap.fileChangesCollapsed[s.dataset.fileChangesIndex] = s.classList.contains("collapsed");
        });
        ref.current.querySelectorAll(".code-block pre").forEach((pre, i) => {
          snap.codeScroll[i] = pre.scrollTop;
        });
        ref.current.querySelectorAll(".diff-block, .tool-diff-block").forEach((block, bi) => {
          block.querySelectorAll(".diff-hunk-btn").forEach((h) => {
            snap.ctxHidden[`${bi}:${h.dataset.hunkId}`] = h.classList.contains("diff-hunk-ctx-collapsed");
          });
          const colBtn = block.querySelector(".diff-ctx-collapse-all");
          if (colBtn) snap.ctxCollapseActive[bi] = colBtn.classList.contains("active");
        });
      }
      lastContent.current = content;
      ref.current.innerHTML = cachedRichContentHtml(content, cacheIdentity);
      ref.current.querySelectorAll(".tool-section[data-tool-index]").forEach((s) => {
        const idx = s.dataset.toolIndex;
        if (!(idx in snap.toolCollapsed)) return;
        const want = snap.toolCollapsed[idx];
        const has = s.classList.contains("collapsed");
        if (want !== has) {
          s.classList.toggle("collapsed", want);
          const body = s.querySelector(".tool-body");
          const chevron = s.querySelector(".tool-chevron");
          const btn = s.querySelector(".tool-toggle");
          if (body) body.hidden = want;
          if (chevron) chevron.textContent = want ? "\u25B8" : "\u25BE";
          if (btn) btn.setAttribute("aria-expanded", want ? "false" : "true");
        }
      });
      ref.current.querySelectorAll(".file-changes-section[data-file-changes-index]").forEach((s) => {
        const idx = s.dataset.fileChangesIndex;
        if (!(idx in snap.fileChangesCollapsed)) return;
        const want = snap.fileChangesCollapsed[idx];
        const has = s.classList.contains("collapsed");
        if (want !== has) {
          s.classList.toggle("collapsed", want);
          const list = s.querySelector(".file-changes-list");
          const chevron = s.querySelector(".file-changes-chevron");
          const btn = s.querySelector(".file-changes-toggle");
          if (list) list.hidden = want;
          if (chevron) chevron.textContent = want ? ">" : "v";
          if (btn) btn.setAttribute("aria-expanded", want ? "false" : "true");
        }
      });
      ref.current.querySelectorAll(".diff-block, .tool-diff-block").forEach((block, bi) => {
        const code = block.querySelector("code");
        if (!code) return;
        block.querySelectorAll(".diff-hunk-btn").forEach((h) => {
          const key = `${bi}:${h.dataset.hunkId}`;
          if (!(key in snap.ctxHidden) || !snap.ctxHidden[key]) return;
          code.querySelectorAll(`[data-hunk-ctx="${h.dataset.hunkId}"].diff-ctx`).forEach((s) => s.classList.add("diff-ctx-hidden"));
          h.classList.add("diff-hunk-ctx-collapsed");
        });
        if (snap.ctxCollapseActive[bi]) {
          const colBtn = block.querySelector(".diff-ctx-collapse-all");
          if (colBtn) colBtn.classList.add("active");
        }
      });
      ref.current.querySelectorAll(".code-copy").forEach((btn) => {
        btn.onclick = () => {
          const codeEl = btn.closest(".code-block").querySelector("code");
          const code = codeEl.dataset.raw !== void 0 ? codeEl.dataset.raw : codeEl.textContent;
          navigator.clipboard.writeText(code).then(() => {
            btn.querySelector(".copy-icon").style.display = "none";
            btn.querySelector(".check-icon").style.display = "";
            btn.querySelector(".copy-label").textContent = "Copied";
            btn.classList.add("copied");
            setTimeout(() => {
              btn.querySelector(".copy-icon").style.display = "";
              btn.querySelector(".check-icon").style.display = "none";
              btn.querySelector(".copy-label").textContent = "Copy";
              btn.classList.remove("copied");
            }, 2e3);
          }).catch(() => {
          });
        };
      });
      ref.current.querySelectorAll(".tool-toggle").forEach((btn) => {
        btn.onclick = () => {
          const section = btn.closest(".tool-section");
          const body = section?.querySelector(".tool-body");
          const chevron = btn.querySelector(".tool-chevron");
          const collapsed = section.classList.toggle("collapsed");
          if (body) body.hidden = collapsed;
          if (chevron) chevron.textContent = collapsed ? "\u25B8" : "\u25BE";
          btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
        };
      });
      ref.current.querySelectorAll(".file-changes-toggle").forEach((btn) => {
        btn.onclick = () => {
          const section = btn.closest(".file-changes-section");
          const list = section?.querySelector(".file-changes-list");
          const chevron = btn.querySelector(".file-changes-chevron");
          const collapsed = section.classList.toggle("collapsed");
          if (list) list.hidden = collapsed;
          if (chevron) chevron.textContent = collapsed ? ">" : "v";
          btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
        };
      });
      ref.current.querySelectorAll(".tool-io-more-btn").forEach((btn) => {
        btn.onclick = () => {
          const previewDiv = btn.closest(".tool-io-preview");
          const fullDiv = previewDiv?.nextElementSibling;
          if (!previewDiv || !fullDiv) return;
          previewDiv.hidden = true;
          fullDiv.hidden = false;
        };
      });
      ref.current.querySelectorAll(".tool-io-collapse-btn").forEach((btn) => {
        btn.onclick = () => {
          const fullDiv = btn.closest(".tool-io-full");
          const previewDiv = fullDiv?.previousElementSibling;
          if (!fullDiv || !previewDiv) return;
          fullDiv.hidden = true;
          previewDiv.hidden = false;
        };
      });
      ref.current.querySelectorAll(".diff-summary-chip").forEach((chip) => {
        chip.onclick = (e) => {
          e.preventDefault();
          const targetId = chip.dataset.target;
          const target = targetId && ref.current.querySelector(`#${CSS.escape(targetId)}`);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "nearest" });
            ref.current.querySelectorAll(".diff-summary-chip").forEach((c) => c.classList.remove("active"));
            chip.classList.add("active");
          }
        };
      });
      ref.current.querySelectorAll(".diff-split-toggle").forEach((btn) => {
        btn.onclick = () => {
          const block = btn.closest(".diff-block");
          if (!block) return;
          const pre = block.querySelector(":scope > pre");
          const split = block.querySelector(".diff-split");
          const isSplit = block.dataset.diffMode === "split";
          const nowSplit = !isSplit;
          block.dataset.diffMode = nowSplit ? "split" : "unified";
          btn.classList.toggle("active", nowSplit);
          btn.title = nowSplit ? "Toggle unified view" : "Toggle side-by-side view";
        };
      });
      ref.current.querySelectorAll(".diff-filepath[data-copy-path], .tool-open-file[data-open-path], .inline-file-ref[data-open-path]").forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const path = btn.dataset.openPath || btn.dataset.copyPath;
          const openPath = onOpenPathRef.current;
          if (path && typeof openPath === "function") {
            e.preventDefault();
            openPath(path);
            return;
          }
          if (!btn.dataset.copyPath) return;
          navigator.clipboard.writeText(path).then(() => {
            const original = btn.textContent;
            btn.textContent = "Copied!";
            btn.classList.add("diff-filepath-copied");
            setTimeout(() => {
              btn.textContent = original;
              btn.classList.remove("diff-filepath-copied");
            }, 1500);
          }).catch(() => {
          });
        };
      });
      ref.current.querySelectorAll(".code-expand-toggle").forEach((btn) => {
        btn.onclick = () => {
          const block = btn.closest(".code-block");
          if (!block) return;
          const expanded = block.classList.toggle("code-expanded");
          btn.textContent = expanded ? "Collapse" : "Expand";
          btn.title = expanded ? "Collapse block" : "Expand block";
          if (!expanded) {
            block.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        };
      });
      if (autoExpandLongCodeBlocks) {
        ref.current.querySelectorAll(".code-collapsible").forEach((block) => {
          block.classList.add("code-expanded");
          const btn = block.querySelector(".code-expand-toggle");
          if (btn) {
            btn.textContent = "Collapse";
            btn.title = "Collapse block";
          }
        });
      }
      ref.current.querySelectorAll(".code-wrap-toggle").forEach((btn) => {
        btn.onclick = () => {
          const wrapped = localStorage.getItem("codeblock_wrap_pref") !== "1";
          localStorage.setItem("codeblock_wrap_pref", wrapped ? "1" : "0");
          ref.current.querySelectorAll(".code-block").forEach((block) => {
            block.classList.toggle("code-wrap", wrapped);
            const tb = block.querySelector(".code-wrap-toggle");
            if (tb) {
              tb.textContent = wrapped ? "No Wrap" : "Wrap";
              tb.title = wrapped ? "Disable word wrap" : "Enable word wrap";
              tb.classList.toggle("active", wrapped);
            }
          });
        };
      });
      ref.current.querySelectorAll(".code-search-btn").forEach((btn) => {
        btn.onclick = () => {
          const block = btn.closest(".code-block");
          if (!block) return;
          const bar = block.querySelector(".code-search-bar");
          const input = block.querySelector(".code-search-input");
          if (!bar) return;
          const isOpen = !bar.hidden;
          if (isOpen) {
            _codeSearchClear(block);
            bar.hidden = true;
            btn.classList.remove("active");
          } else {
            bar.hidden = false;
            btn.classList.add("active");
            input && input.focus();
          }
        };
      });
      ref.current.querySelectorAll(".code-search-input").forEach((input) => {
        input.oninput = () => _codeSearchRun(input.closest(".code-block"));
        input.onkeydown = (e) => {
          const block = input.closest(".code-block");
          if (e.key === "Enter") {
            e.shiftKey ? _codeSearchNav(block, -1) : _codeSearchNav(block, 1);
            e.preventDefault();
          }
          if (e.key === "Escape") {
            _codeSearchClear(block);
            block.querySelector(".code-search-bar").hidden = true;
            block.querySelector(".code-search-btn").classList.remove("active");
          }
        };
      });
      ref.current.querySelectorAll(".code-search-next").forEach((btn) => {
        btn.onclick = () => _codeSearchNav(btn.closest(".code-block"), 1);
      });
      ref.current.querySelectorAll(".code-search-prev").forEach((btn) => {
        btn.onclick = () => _codeSearchNav(btn.closest(".code-block"), -1);
      });
      ref.current.querySelectorAll(".code-search-close").forEach((btn) => {
        btn.onclick = () => {
          const block = btn.closest(".code-block");
          _codeSearchClear(block);
          block.querySelector(".code-search-bar").hidden = true;
          block.querySelector(".code-search-btn").classList.remove("active");
        };
      });
      ref.current.querySelectorAll(".diff-hunk-btn").forEach((hunkSpan) => {
        hunkSpan.onclick = (e) => {
          e.stopPropagation();
          const id = hunkSpan.dataset.hunkId;
          const code = hunkSpan.closest("code");
          if (!code) return;
          const ctxSpans = code.querySelectorAll(`[data-hunk-ctx="${id}"].diff-ctx`);
          const collapsed = ctxSpans.length > 0 && ctxSpans[0].classList.contains("diff-ctx-hidden");
          ctxSpans.forEach((s) => s.classList.toggle("diff-ctx-hidden", !collapsed));
          hunkSpan.classList.toggle("diff-hunk-ctx-collapsed", !collapsed);
        };
        hunkSpan.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            hunkSpan.click();
          }
        };
      });
      ref.current.querySelectorAll(".diff-ctx-collapse-all").forEach((btn) => {
        btn.onclick = () => {
          const block = btn.closest(".diff-block, .tool-diff-block");
          if (!block) return;
          const code = block.querySelector("code");
          if (!code) return;
          const ctxSpans = code.querySelectorAll(".diff-ctx");
          const anyVisible = Array.from(ctxSpans).some((s) => !s.classList.contains("diff-ctx-hidden"));
          const nowCollapsed = anyVisible;
          ctxSpans.forEach((s) => s.classList.toggle("diff-ctx-hidden", nowCollapsed));
          code.querySelectorAll(".diff-hunk-btn").forEach((s) => s.classList.toggle("diff-hunk-ctx-collapsed", nowCollapsed));
          btn.classList.toggle("active", nowCollapsed);
          btn.title = nowCollapsed ? "Expand all context lines" : "Collapse all context lines";
        };
      });
      ref.current.querySelectorAll(".tool-show-all").forEach((btn) => {
        btn.onclick = () => {
          const body = btn.closest(".tool-body");
          const code = body?.querySelector("code");
          const section = btn.closest(".tool-section");
          if (!code || !section) return;
          const index = Number(section.dataset.toolIndex || "-1");
          const toolChunk = parseToolSections(content || "")[index];
          if (!toolChunk || toolChunk.type !== "tool") return;
          code.textContent = toolChunk.content || "";
          btn.remove();
        };
      });
      if (snap.codeScroll.length) {
        ref.current.querySelectorAll(".code-block pre").forEach((pre, i) => {
          if (i < snap.codeScroll.length && snap.codeScroll[i] > 0) {
            pre.scrollTop = snap.codeScroll[i];
          }
        });
      }
      let cleanupObserver = null;
      const summaryBar = ref.current.querySelector(".diff-summary-bar");
      if (summaryBar && typeof IntersectionObserver !== "undefined") {
        const diffBlocks = Array.from(ref.current.querySelectorAll(".diff-block[id]"));
        if (diffBlocks.length >= 2) {
          let scrollRoot = null;
          let el = ref.current.parentElement;
          while (el && el !== document.body) {
            const style = window.getComputedStyle(el);
            if (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflow === "auto" || style.overflow === "scroll") {
              scrollRoot = el;
              break;
            }
            el = el.parentElement;
          }
          const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              const id = entry.target.id;
              summaryBar.querySelectorAll(".diff-summary-chip").forEach((chip) => {
                chip.classList.toggle("active", chip.dataset.target === id);
              });
            });
          }, { root: scrollRoot, threshold: 0.1 });
          diffBlocks.forEach((block) => observer.observe(block));
          cleanupObserver = () => observer.disconnect();
        }
      }
      return () => {
        if (cleanupObserver) cleanupObserver();
      };
    }, [content, autoExpandLongCodeBlocks, cacheIdentity, richContentReady]);
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `message-body${monospace ? " monospace-body" : ""}`,
        ref,
        "data-rich-content-ready": richContentReady ? "true" : "false"
      }
    );
  }

  // frontend/message-delta.js
  function createProvisionalStream(sessionId, clientMessageId = null, nowMs = Date.now()) {
    return {
      sessionId,
      messageId: null,
      blockIndex: 0,
      seq: -1,
      content: "",
      open: true,
      startedAtMs: nowMs,
      clientMessageId
    };
  }
  function shouldClearEmptyProvisionalOnTerminal(stream, activity, thinking = false) {
    if (!stream || String(stream.content || "").length > 0 || thinking) return false;
    const kind = String(activity?.kind || "idle").toLowerCase();
    return ["idle", "waiting_for_user", "completed", "done", "failed", "error", "interrupted"].includes(kind);
  }
  function reduceMessageDeltaStream(current, message, nowMs = Date.now()) {
    const sessionId = message?.session_id || message?.session || "";
    const messageId = message?.message_id || "";
    const blockIndex = Number(message?.block_index);
    const seq = Number(message?.seq);
    if (!sessionId || !messageId || !Number.isSafeInteger(blockIndex) || blockIndex < 0 || !Number.isSafeInteger(seq) || seq < 0) {
      return { accepted: false, code: "invalid_identity", stream: current || null };
    }
    if (message.op === "block_open") {
      if (seq !== 0) return { accepted: false, code: "invalid_open_sequence", stream: current || null };
      return {
        accepted: true,
        stream: {
          ...createProvisionalStream(sessionId, current?.clientMessageId || null, current?.startedAtMs || nowMs),
          messageId,
          blockIndex,
          seq
        }
      };
    }
    if (!current || current.messageId !== messageId || current.blockIndex !== blockIndex || !current.open) {
      return { accepted: false, code: "stream_not_open", stream: current || null };
    }
    if (seq !== current.seq + 1) return { accepted: false, code: "sequence_gap", stream: current };
    if (message.op === "append") {
      if (typeof message.append !== "string" || message.append.length === 0) {
        return { accepted: false, code: "invalid_append", stream: current };
      }
      return {
        accepted: true,
        stream: { ...current, seq, content: `${current.content || ""}${message.append}` }
      };
    }
    if (message.op === "block_close") {
      return { accepted: true, stream: { ...current, seq, open: false } };
    }
    return { accepted: false, code: "invalid_operation", stream: current };
  }

  // frontend/message-time.js
  function parseMessageInstant(value) {
    if (value == null || value === "") return null;
    let epochMs = null;
    if (typeof value === "number" || typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) epochMs = numeric > 1e12 ? numeric : numeric * 1e3;
    } else {
      const parsed = Date.parse(String(value));
      if (Number.isFinite(parsed) && parsed > 0) epochMs = parsed;
    }
    if (!Number.isFinite(epochMs) || epochMs <= 0) return null;
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) return null;
    return {
      epoch_ms: date.getTime(),
      epoch_seconds: date.getTime() / 1e3,
      iso: date.toISOString()
    };
  }
  function messageInstant(message) {
    if (!message || typeof message !== "object") return null;
    return parseMessageInstant(message.created_at) || parseMessageInstant(message.timestamp) || parseMessageInstant(message.ts) || null;
  }
  function normalizeMessageTimestamp(message) {
    if (!message || typeof message !== "object") return message;
    const instant = messageInstant(message);
    if (!instant) return message;
    if (message.timestamp === instant.iso && message.timestamp_ms === instant.epoch_ms && Number(message.ts) === instant.epoch_seconds) return message;
    return {
      ...message,
      ts: instant.epoch_seconds,
      timestamp: instant.iso,
      timestamp_ms: instant.epoch_ms
    };
  }
  function normalizeTranscriptTimestamps(messages) {
    if (!Array.isArray(messages)) return [];
    let changed = false;
    const normalized = messages.map((message) => {
      const next = normalizeMessageTimestamp(message);
      if (next !== message) changed = true;
      return next;
    });
    return changed ? normalized : messages;
  }
  function formatVisibleMessageTime(instant, now = /* @__PURE__ */ new Date(), locale = void 0) {
    const parsed = instant && typeof instant === "object" && Number.isFinite(instant.epoch_ms) ? instant : parseMessageInstant(instant);
    if (!parsed) return "";
    const date = new Date(parsed.epoch_ms);
    const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    const options = sameDay ? { hour: "numeric", minute: "2-digit" } : {
      ...date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" },
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    };
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
  function formatAbsoluteMessageTime(instant, locale = void 0) {
    const parsed = instant && typeof instant === "object" && Number.isFinite(instant.epoch_ms) ? instant : parseMessageInstant(instant);
    if (!parsed) return "";
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeStyle: "long"
    }).format(new Date(parsed.epoch_ms));
  }

  // frontend/state-sequence.js
  function createStateSequenceGate() {
    const latestByKey = /* @__PURE__ */ new Map();
    const maxKeys = 2048;
    let relayEpoch = "";
    return {
      reset(nextEpoch = "") {
        const normalized = String(nextEpoch || "");
        if (normalized === relayEpoch) return;
        relayEpoch = normalized;
        latestByKey.clear();
      },
      accept(message, key) {
        const seq = Number(message?.state_seq);
        if (!Number.isSafeInteger(seq) || seq < 0) return true;
        const epoch = String(message?.state_epoch || relayEpoch || "legacy");
        if (relayEpoch && epoch !== relayEpoch) return false;
        if (!relayEpoch) {
          relayEpoch = epoch;
        }
        const normalizedKey = String(key || message?.type || "state");
        const previous = latestByKey.get(normalizedKey);
        if (previous?.epoch === epoch && seq <= previous.seq) return false;
        if (latestByKey.has(normalizedKey)) latestByKey.delete(normalizedKey);
        latestByKey.set(normalizedKey, { epoch, seq });
        while (latestByKey.size > maxKeys) latestByKey.delete(latestByKey.keys().next().value);
        return true;
      },
      size() {
        return latestByKey.size;
      }
    };
  }

  // frontend/session-title.js
  var IMAGE_REFERENCE_RE = /(?:!\[[^\]]*\]\([^)]*\)|\[File:\s*[^\]]+\]|\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)\b)/gi;
  var ABSOLUTE_PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/gi;
  var GENERIC_TITLE_KEYS = /* @__PURE__ */ new Set([
    "agent",
    "agentmanager",
    "agentsession",
    "antigravity",
    "antigravitychat",
    "antigravityv2",
    "claude",
    "claudecli",
    "claudecode",
    "claudecodecli",
    "claudedesktop",
    "cline",
    "codex",
    "codexcli",
    "codexdesktop",
    "connected",
    "connectedsession",
    "continue",
    "continueyolo",
    "cursor",
    "cursoragent",
    "cursorcli",
    "cursoride",
    "gemini",
    "geminicodeassist",
    "newchat",
    "newconversation",
    "other",
    "proceed",
    "resume",
    "roocode",
    "session",
    "unknown",
    "attachment",
    "file",
    "image",
    "screenshot",
    "disregardthatlastmessage",
    "ignorethatlastmessage"
  ]);
  function stringValue(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    return stringValue(value.text || value.content || value.markdown || value.value || "");
  }
  function resetNoiseRegexes() {
    IMAGE_REFERENCE_RE.lastIndex = 0;
    ABSOLUTE_PATH_RE.lastIndex = 0;
  }
  function isLowSignalChatTitle(value) {
    const text = stringValue(value).replace(/\s+/g, " ").trim();
    if (!text) return true;
    if (/^\[(?:attachment|file|image|screenshot)(?:\s*:[^\]]*)?\]$/i.test(text)) return true;
    if (/^new\s+(?:antigravity|claude|codex|continue|cursor|gemini|roo)(?:\s+(?:agent|chat|cli|code|desktop|ide|panel))*\s+(?:chat|conversation|session|thread)$/i.test(text)) return true;
    const hasAttachmentNoise = IMAGE_REFERENCE_RE.test(text) || ABSOLUTE_PATH_RE.test(text);
    resetNoiseRegexes();
    if (hasAttachmentNoise) {
      const remainder = text.replace(IMAGE_REFERENCE_RE, " ").replace(ABSOLUTE_PATH_RE, " ").replace(/\b(?:read|open|view|inspect|check|review|show|load|attach|attached|upload|uploaded|file|image|screenshot)\b/gi, " ").replace(/[^a-z0-9]+/gi, "").trim();
      resetNoiseRegexes();
      if (remainder.length < 12) return true;
    }
    let key = text.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/^remoteagent(?:chat)?/, "");
    if (!key) return !/[\p{L}\p{N}]/u.test(text);
    if (GENERIC_TITLE_KEYS.has(key)) return true;
    key = key.replace(/(?:new|production|session|chat|smoke|test|probe|verification|fixture|extension|ext|ide|app|panel|pane)$/g, "");
    return GENERIC_TITLE_KEYS.has(key);
  }
  function summarizeMessageContent(content) {
    const original = stringValue(content);
    if (!original) return "";
    const text = original.replace(/<goal_context>[\s\S]*?<\/goal_context>/gi, " ").replace(/```[\s\S]*?```/g, " ").replace(IMAGE_REFERENCE_RE, " ").replace(ABSOLUTE_PATH_RE, " ").replace(/<[^>\n]{1,120}>/g, " ").replace(/`([^`]+)`/g, "$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i, "").replace(/\s+/g, " ").trim();
    resetNoiseRegexes();
    if (!text || isLowSignalChatTitle(text)) return "";
    if (/^(?:thinking|working|tool result|tool:|exit code|wall time|read|open|view|inspect|check|review|show|load|attach|attached|uploaded|file|image|screenshot)\b/i.test(text) && text.split(/\s+/).length <= 4) return "";
    if (/^[^\p{L}\p{N}]+$/u.test(text)) return "";
    return text.slice(0, 80).trim();
  }
  function titleFromSessionMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    for (const message of list) {
      if (String(message?.role || "").toLowerCase() !== "user") continue;
      const title = summarizeMessageContent(message?.content || message?.content_blocks);
      if (title) return title;
    }
    return "";
  }
  var TITLE_SOURCE_RANK = Object.freeze({
    fallback: 0,
    route: 0.5,
    message: 1,
    summary: 2,
    custom: 3,
    native: 4
  });
  var SESSION_TITLE_METADATA_FIELDS = Object.freeze([
    "codex_desktop_active_thread_title",
    "cursor_agent_title",
    "native_chat_title",
    "session_title",
    "thread_title",
    "conversation_title",
    "title",
    "display_title",
    "summary",
    "chat_title",
    "chat_title_source",
    "thread_name",
    "conversation_name",
    "custom_display_name",
    "is_new_chat_draft",
    "is_list_view"
  ]);
  function normalizedTitle(value) {
    return stringValue(value).replace(/\s+/g, " ").trim();
  }
  function sessionChatTitleMetadataPatch(source) {
    if (!source || typeof source !== "object") return {};
    return Object.fromEntries(SESSION_TITLE_METADATA_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(source, field)).map((field) => [field, source[field]]));
  }
  function resolveSessionChatTitleProjection(session, customDisplayName = "", messages = [], derivedMessageTitle = "") {
    const source = session && typeof session === "object" ? session : {};
    const nativeCandidates = [
      ["codex_desktop_active_thread_title", source.codex_desktop_active_thread_title],
      ["cursor_agent_title", source.cursor_agent_title],
      ["native_chat_title", source.native_chat_title],
      ["session_title", source.session_title],
      ["thread_title", source.thread_title],
      ["conversation_title", source.conversation_title],
      ["title", source.title],
      ["display_title", source.display_title],
      ["chat_title", source.chat_title_source === "summary" ? "" : source.chat_title],
      ["thread_name", source.thread_name],
      ["conversation_name", source.conversation_name]
    ];
    const nativeTitle = nativeCandidates.map(([field, value]) => ({ field, title: normalizedTitle(value) })).find((candidate) => candidate.title && !isLowSignalChatTitle(candidate.title));
    if (nativeTitle) return { title: nativeTitle.title.slice(0, 80).trim(), source: "native", field: nativeTitle.field };
    const customTitle = normalizedTitle(customDisplayName);
    if (customTitle && !isLowSignalChatTitle(customTitle)) {
      return { title: customTitle.slice(0, 80).trim(), source: "custom", field: "custom_display_name" };
    }
    const summaryCandidates = [
      ["chat_title", source.chat_title_source === "summary" ? source.chat_title : ""],
      ["summary", source.summary],
      ["derived_message_title", derivedMessageTitle]
    ];
    const summaryTitle = summaryCandidates.map(([field, value]) => ({ field, title: summarizeMessageContent(value) })).find((candidate) => candidate.title);
    if (summaryTitle) return { title: summaryTitle.title, source: "summary", field: summaryTitle.field };
    const messageTitle = titleFromSessionMessages(messages);
    if (messageTitle) return { title: messageTitle, source: "message", field: "first_meaningful_user_message" };
    return { title: "New chat", source: "fallback", field: "new_chat" };
  }
  function retainStrongerSessionChatTitleProjection(previous, next) {
    if (!previous?.title) return next;
    if (!next?.title) return previous;
    const previousRank = TITLE_SOURCE_RANK[previous.source] ?? 0;
    const nextRank = TITLE_SOURCE_RANK[next.source] ?? 0;
    return nextRank >= previousRank ? next : previous;
  }
  function resolveSessionChatTitle(session, customDisplayName = "", messages = [], derivedMessageTitle = "") {
    return resolveSessionChatTitleProjection(session, customDisplayName, messages, derivedMessageTitle).title;
  }

  // frontend/session-registry.js
  var UNSAFE_PATCH_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  function sessionRegistryId(value) {
    return typeof value === "string" ? value : value?.session_id || value?.id || "";
  }
  function sessionRegistryValueEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (left == null || right == null || typeof left !== typeof right) return false;
    if (typeof left !== "object") return false;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      for (let index = 0; index < left.length; index += 1) {
        if (!sessionRegistryValueEqual(left[index], right[index])) return false;
      }
      return true;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key) || !sessionRegistryValueEqual(left[key], right[key])) return false;
    }
    return true;
  }
  function createSessionRegistry(items = []) {
    const list = [];
    const order = [];
    const byId = /* @__PURE__ */ Object.create(null);
    const indexById = /* @__PURE__ */ Object.create(null);
    for (const item of Array.isArray(items) ? items : []) {
      const id = sessionRegistryId(item);
      if (!id || Object.prototype.hasOwnProperty.call(byId, id)) continue;
      indexById[id] = list.length;
      order.push(id);
      byId[id] = item;
      list.push(item);
    }
    return { byId, indexById, order, list };
  }
  function titleResetRequested(value) {
    return value?.is_new_chat_draft === true || value?.is_list_view === true;
  }
  function preserveDurableSessionTitle(previousItem, incomingItem) {
    if (!previousItem || typeof previousItem !== "object" || !incomingItem || typeof incomingItem !== "object" || titleResetRequested(incomingItem) || isLowSignalChatTitle(previousItem.chat_title) || !isLowSignalChatTitle(incomingItem.chat_title)) {
      return incomingItem;
    }
    return {
      ...incomingItem,
      chat_title: previousItem.chat_title,
      chat_title_source: previousItem.chat_title_source || incomingItem.chat_title_source || null
    };
  }
  function reconcileSessionRegistry(previous, items) {
    const prior = previous?.byId ? previous : createSessionRegistry();
    const incoming = Array.isArray(items) ? items : [];
    const list = [];
    const order = [];
    const byId = /* @__PURE__ */ Object.create(null);
    const indexById = /* @__PURE__ */ Object.create(null);
    let changed = incoming.length !== prior.list.length;
    for (const item of incoming) {
      const id = sessionRegistryId(item);
      if (!id || Object.prototype.hasOwnProperty.call(byId, id)) continue;
      const previousItem = prior.byId[id];
      const protectedItem = preserveDurableSessionTitle(previousItem, item);
      const nextItem = previousItem !== void 0 && sessionRegistryValueEqual(previousItem, protectedItem) ? previousItem : protectedItem;
      indexById[id] = list.length;
      order.push(id);
      byId[id] = nextItem;
      list.push(nextItem);
      if (!Object.is(nextItem, previousItem) || prior.order[list.length - 1] !== id) changed = true;
    }
    if (list.length !== incoming.length || list.length !== prior.list.length) changed = true;
    return changed ? { byId, indexById, order, list } : prior;
  }
  function patchSessionRegistry(previous, message) {
    const prior = previous?.byId ? previous : createSessionRegistry();
    const id = message?.session_id || message?.session || "";
    if (!id || !Object.prototype.hasOwnProperty.call(prior.byId, id)) return prior;
    const current = prior.byId[id];
    const base = current && typeof current === "object" ? current : { session_id: id };
    const patch = message?.patch && typeof message.patch === "object" ? message.patch : {};
    const removedFields = Array.isArray(message?.removed_fields) ? message.removed_fields : [];
    const resetTitle = titleResetRequested(patch);
    const preserveTitle = !resetTitle && !isLowSignalChatTitle(base.chat_title) && (!Object.prototype.hasOwnProperty.call(patch, "chat_title") || isLowSignalChatTitle(patch.chat_title));
    let next = base;
    for (const [key, value] of Object.entries(patch)) {
      if (UNSAFE_PATCH_KEYS.has(key) || key === "session_id" || key === "id") continue;
      if (preserveTitle && (key === "chat_title" || key === "chat_title_source")) continue;
      if (sessionRegistryValueEqual(next[key], value)) continue;
      if (next === base) next = { ...base };
      next[key] = value;
    }
    for (const key of removedFields) {
      if (typeof key !== "string" || UNSAFE_PATCH_KEYS.has(key) || key === "session_id" || key === "id") continue;
      if (preserveTitle && (key === "chat_title" || key === "chat_title_source")) continue;
      if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
      if (next === base) next = { ...base };
      delete next[key];
    }
    if (next === base) return prior;
    next.session_id = id;
    const index = prior.indexById[id];
    const list = prior.list.slice();
    list[index] = next;
    const byId = Object.assign(/* @__PURE__ */ Object.create(null), prior.byId);
    byId[id] = next;
    return {
      byId,
      indexById: prior.indexById,
      order: prior.order,
      list
    };
  }

  // frontend/transcript-cache.js
  var TRANSCRIPT_CACHE_LIMIT = 10;
  var transcriptCache = /* @__PURE__ */ new Map();
  var transcriptListeners = /* @__PURE__ */ new Map();
  var EMPTY_TRANSCRIPT = Object.freeze([]);
  function normalizedSessionId(sessionId) {
    return String(sessionId || "").trim();
  }
  function getCachedTranscript(sessionId) {
    const id = normalizedSessionId(sessionId);
    if (!id || !transcriptCache.has(id)) return null;
    const messages = transcriptCache.get(id);
    transcriptCache.delete(id);
    transcriptCache.set(id, messages);
    return messages;
  }
  function getTranscriptSnapshot(sessionId) {
    const id = normalizedSessionId(sessionId);
    return id && transcriptCache.get(id) || EMPTY_TRANSCRIPT;
  }
  function subscribeCachedTranscript(sessionId, listener) {
    const id = normalizedSessionId(sessionId);
    if (!id || typeof listener !== "function") return () => {
    };
    const listeners = transcriptListeners.get(id) || /* @__PURE__ */ new Set();
    listeners.add(listener);
    transcriptListeners.set(id, listeners);
    return () => {
      const current = transcriptListeners.get(id);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) transcriptListeners.delete(id);
    };
  }
  function notifyTranscript(sessionId) {
    const listeners = transcriptListeners.get(sessionId);
    if (!listeners) return;
    [...listeners].forEach((listener) => listener());
  }
  function setCachedTranscript(sessionId, messages, limit = TRANSCRIPT_CACHE_LIMIT) {
    const id = normalizedSessionId(sessionId);
    if (!id || !Array.isArray(messages)) return [];
    const normalizedMessages = normalizeTranscriptTimestamps(messages);
    const previous = transcriptCache.get(id);
    transcriptCache.delete(id);
    transcriptCache.set(id, normalizedMessages);
    const evicted = [];
    const boundedLimit = Math.max(1, Number(limit) || TRANSCRIPT_CACHE_LIMIT);
    while (transcriptCache.size > boundedLimit) {
      const oldest = transcriptCache.keys().next().value;
      transcriptCache.delete(oldest);
      evicted.push(oldest);
    }
    if (previous !== normalizedMessages) notifyTranscript(id);
    evicted.forEach(notifyTranscript);
    return evicted;
  }
  function deleteCachedTranscript(sessionId) {
    const id = normalizedSessionId(sessionId);
    if (!id || !transcriptCache.has(id)) return false;
    transcriptCache.delete(id);
    notifyTranscript(id);
    return true;
  }
  function transcriptMapSnapshot() {
    return Object.fromEntries([...transcriptCache.entries()]);
  }
  function updateTranscriptStore(updater) {
    const previous = transcriptMapSnapshot();
    const next = typeof updater === "function" ? updater(previous) : updater;
    if (!next || next === previous || typeof next !== "object") return previous;
    const nextIds = new Set(Object.keys(next));
    Object.keys(previous).forEach((id) => {
      if (!nextIds.has(id)) deleteCachedTranscript(id);
    });
    Object.entries(next).forEach(([id, messages]) => {
      if (Array.isArray(messages) && previous[id] !== messages) setCachedTranscript(id, messages);
    });
    return next;
  }
  var transcriptStoreView = new Proxy({}, {
    get(_target, property) {
      if (typeof property !== "string") return void 0;
      return transcriptCache.get(property);
    },
    ownKeys() {
      return [...transcriptCache.keys()];
    },
    getOwnPropertyDescriptor(_target, property) {
      if (typeof property === "string" && transcriptCache.has(property)) {
        return { configurable: true, enumerable: true, value: transcriptCache.get(property) };
      }
      return void 0;
    },
    set(_target, property, value) {
      if (typeof property !== "string" || !Array.isArray(value)) return false;
      setCachedTranscript(property, value);
      return true;
    },
    deleteProperty(_target, property) {
      return typeof property === "string" ? deleteCachedTranscript(property) : false;
    }
  });

  // frontend/fleet-activity.js
  var FLEET_ACTIVE_KINDS = /* @__PURE__ */ new Set([
    "thinking",
    "generating",
    "reading_files",
    "running_command",
    "applying_patch",
    "working"
  ]);
  var FLEET_ATTENTION_KINDS = /* @__PURE__ */ new Set([
    "waiting_for_user",
    "needs_attention",
    "blocked",
    "rate_limited",
    "usage_limited",
    "budget_limited",
    "failed",
    "error"
  ]);
  var FLEET_ATTENTION_GOAL_STATES = /* @__PURE__ */ new Set([
    "blocked",
    "usagelimited",
    "budgetlimited",
    "failed"
  ]);
  var FLEET_TERMINAL_GOAL_STATES = /* @__PURE__ */ new Set(["complete", "completed", "cancelled", "canceled"]);
  var DEFAULT_ACTIVITY_FRESHNESS_MS = 15e3;
  function normalizedGoalState(activity) {
    return String(activity?.goal?.state || activity?.goal?.status || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  }
  function timestampMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function fleetActivityObservedAtMs(activity) {
    return Math.max(
      timestampMs(activity?.transport?.client_received_at_ms),
      timestampMs(activity?.transport?.relay_forwarded_at_ms),
      timestampMs(activity?.observed_at),
      timestampMs(activity?.updatedAt),
      timestampMs(activity?.updated_at)
    );
  }
  function fleetActivityIsFresh(activity, options = {}) {
    if (options.connected === false || String(options.health || "").toLowerCase() === "disconnected") return false;
    if (options.fresh === false) return false;
    if (options.requireFreshness !== true) return true;
    const observedAtMs = fleetActivityObservedAtMs(activity);
    if (!observedAtMs) return false;
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const freshnessMs = Math.max(1e3, Number(options.freshnessMs) || DEFAULT_ACTIVITY_FRESHNESS_MS);
    return nowMs - observedAtMs <= freshnessMs;
  }
  function classifyFleetActivity(activity, needsAttention = false, options = {}) {
    const kind = String(activity?.kind || "").trim().toLowerCase();
    const goalState = normalizedGoalState(activity);
    if (needsAttention || FLEET_ATTENTION_KINDS.has(kind) || FLEET_ATTENTION_GOAL_STATES.has(goalState)) {
      return "needs_attention";
    }
    if (FLEET_TERMINAL_GOAL_STATES.has(goalState)) return "idle";
    if (kind === "idle" && goalState !== "active") return "idle";
    if (!fleetActivityIsFresh(activity, options)) return "stale";
    const hasExecutionProof = activity?.generating === true || FLEET_ACTIVE_KINDS.has(kind);
    if (hasExecutionProof && goalState === "active") return "working_goal";
    if (hasExecutionProof) return "working";
    if (goalState === "active") return "between_goal_turns";
    return "idle";
  }
  function fleetStateLabel(state) {
    if (state === "working_goal") return "Working on goal";
    if (state === "working") return "Working";
    if (state === "between_goal_turns") return "Between goal turns";
    if (state === "needs_attention") return "Needs attention";
    if (state === "stale") return "Stale";
    return "Idle";
  }
  function fleetStateIsWorking(state) {
    return state === "working_goal" || state === "working";
  }
  function finiteTimestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }
  function normalizeFleetActivityTrace(trace, clientReceivedAtMs = Date.now()) {
    if (!trace || typeof trace !== "object") return null;
    const proxyEmittedAtMs = finiteTimestamp(trace.proxy_emitted_at_ms);
    const relayReceivedAtMs = finiteTimestamp(trace.relay_received_at_ms);
    const relayForwardedAtMs = finiteTimestamp(trace.relay_forwarded_at_ms);
    const clientAtMs = finiteTimestamp(clientReceivedAtMs) || Date.now();
    return {
      proxy_emitted_at_ms: proxyEmittedAtMs,
      relay_received_at_ms: relayReceivedAtMs,
      relay_forwarded_at_ms: relayForwardedAtMs,
      client_received_at_ms: clientAtMs,
      latency_ms: proxyEmittedAtMs == null ? null : Math.max(0, clientAtMs - proxyEmittedAtMs)
    };
  }
  function fleetFreshnessLabel(activity) {
    const latency = Number(activity?.transport?.latency_ms);
    return Number.isFinite(latency) ? `${Math.round(latency)} ms` : "Awaiting live update";
  }

  // frontend/semantic-notifications.js
  var SEMANTIC_NOTIFICATION_TYPES = Object.freeze([
    "goal_completed",
    "goal_attention"
  ]);
  var TYPE_SET = new Set(SEMANTIC_NOTIFICATION_TYPES);
  var LEDGER_KEY = "remote-agent-chat:semantic-notifications:v1";
  var CLAIM_PREFIX = "remote-agent-chat:semantic-notification-claim:v1:";
  var MAX_LEDGER_ENTRIES = 256;
  var LEDGER_RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
  function normalizeSemanticNotification(value) {
    if (!value || typeof value !== "object" || value.type !== "semantic_notification") return null;
    const eventType = String(value.event_type || "").trim();
    const dedupeKey = String(value.dedupe_key || "").trim();
    const sessionId = String(value.session_id || value.session || "").trim();
    if (!TYPE_SET.has(eventType) || !dedupeKey || !sessionId) return null;
    const category = String(value.category || eventType).trim();
    if (category !== eventType) return null;
    return {
      ...value,
      type: "semantic_notification",
      event_type: eventType,
      category,
      dedupe_key: dedupeKey,
      session_id: sessionId,
      session: sessionId,
      title: String(value.title || "").trim() || (eventType === "goal_completed" ? "Goal completed" : "Goal needs attention"),
      body: String(value.body || "").trim(),
      created_at: value.created_at || (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function mergeSemanticNotifications(previous, incoming, limit = 100) {
    const byKey = /* @__PURE__ */ new Map();
    [...Array.isArray(previous) ? previous : [], ...Array.isArray(incoming) ? incoming : [incoming]].map(normalizeSemanticNotification).filter(Boolean).forEach((event) => byKey.set(event.dedupe_key, event));
    return [...byKey.values()].slice(-Math.max(1, Number(limit) || 100));
  }
  function semanticNotificationAllowed(event, preferences = {}) {
    const normalized = normalizeSemanticNotification(event);
    return !!normalized && preferences?.[normalized.category] === true;
  }
  function readLedger(storage, nowMs) {
    try {
      const parsed = JSON.parse(storage?.getItem(LEDGER_KEY) || "{}");
      return Object.fromEntries(Object.entries(parsed || {}).filter(([, timestamp]) => Number(timestamp) > nowMs - LEDGER_RETENTION_MS).slice(-MAX_LEDGER_ENTRIES));
    } catch {
      return {};
    }
  }
  function markConsumed(storage, dedupeKey, nowMs) {
    const ledger = readLedger(storage, nowMs);
    if (ledger[dedupeKey]) return false;
    ledger[dedupeKey] = nowMs;
    const entries = Object.entries(ledger).slice(-MAX_LEDGER_ENTRIES);
    try {
      storage?.setItem(LEDGER_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
    }
    return true;
  }
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function claimWithStorage(storage, dedupeKey, nowMs) {
    if (!storage) return true;
    if (readLedger(storage, nowMs)[dedupeKey]) return false;
    const claimKey = `${CLAIM_PREFIX}${encodeURIComponent(dedupeKey).slice(0, 320)}`;
    const token = `${nowMs}:${Math.random().toString(36).slice(2)}`;
    try {
      storage.setItem(claimKey, JSON.stringify({ token, at: nowMs }));
      await wait(20);
      const claim = JSON.parse(storage.getItem(claimKey) || "{}");
      if (claim.token !== token) return false;
      if (!markConsumed(storage, dedupeKey, nowMs)) return false;
      const confirmed = readLedger(storage, nowMs)[dedupeKey] === nowMs;
      if (confirmed) storage.removeItem(claimKey);
      return confirmed;
    } catch {
      return markConsumed(storage, dedupeKey, nowMs);
    }
  }
  async function claimSemanticNotification(event, {
    storage = typeof localStorage !== "undefined" ? localStorage : null,
    locks = typeof navigator !== "undefined" ? navigator.locks : null,
    now = () => Date.now()
  } = {}) {
    const normalized = normalizeSemanticNotification(event);
    if (!normalized) return false;
    const claim = () => claimWithStorage(storage, normalized.dedupe_key, now());
    if (locks?.request) {
      return locks.request(`rac-semantic:${normalized.dedupe_key}`, { mode: "exclusive" }, claim);
    }
    return claim();
  }
  async function recordSemanticNotificationStage(event, stage, {
    channel = "web-in-app",
    reasonCode = "",
    clientId = "web-app"
  } = {}) {
    const normalized = normalizeSemanticNotification(event);
    if (!normalized || !["claimed", "displayed", "suppressed"].includes(stage)) return false;
    if (typeof fetch !== "function") return false;
    try {
      const response = await fetch("/api/notifications/semantic-receipts", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dedupe_key: normalized.dedupe_key,
          stage,
          channel,
          ...reasonCode ? { reason_code: reasonCode } : {},
          client_id: clientId
        })
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // frontend/delivery-tracking.js
  function resolveDeliverySession(transcripts, clientMessageId, sessionHint = "") {
    if (!clientMessageId) return "";
    const store = transcripts || {};
    if (sessionHint && (store[sessionHint] || []).some((message) => message?._cid === clientMessageId)) {
      return sessionHint;
    }
    return Object.keys(store).find((sessionId) => (store[sessionId] || []).some((message) => message?._cid === clientMessageId)) || "";
  }
  function updateDeliveryMessage(transcripts, clientMessageId, sessionId, updater) {
    if (!clientMessageId || !sessionId || typeof updater !== "function") return transcripts;
    const current = transcripts?.[sessionId] || [];
    let changed = false;
    const updated = current.map((message) => {
      if (message?._cid !== clientMessageId) return message;
      const next = updater(message);
      if (next !== message) changed = true;
      return next;
    });
    return changed ? { ...transcripts, [sessionId]: updated } : transcripts;
  }

  // frontend/navigation-epoch.js
  var NAVIGATION_EPOCH_MAX_ENTRIES = 512;
  function normalizeNavigationEpoch(value) {
    const epoch = Number(value);
    if (!Number.isSafeInteger(epoch) || epoch <= 0) return 0;
    return epoch;
  }
  function navigationSessionId(message) {
    return String(
      message?.navigation_session_id || message?.session_id || message?.session || ""
    );
  }
  function createNavigationEpochGate(options = {}) {
    const maxEntries = Math.max(
      1,
      Number(options.maxEntries) || NAVIGATION_EPOCH_MAX_ENTRIES
    );
    const latestBySession = /* @__PURE__ */ new Map();
    function remember(sessionId, epoch) {
      latestBySession.delete(sessionId);
      latestBySession.set(sessionId, epoch);
      while (latestBySession.size > maxEntries) {
        latestBySession.delete(latestBySession.keys().next().value);
      }
    }
    return {
      accept(message) {
        const sessionId = navigationSessionId(message);
        const epoch = normalizeNavigationEpoch(message?.navigation_epoch);
        if (!sessionId || !epoch) return true;
        const latest = latestBySession.get(sessionId) || 0;
        if (epoch < latest) return false;
        remember(sessionId, epoch);
        return true;
      },
      latest(sessionId) {
        return latestBySession.get(String(sessionId || "")) || 0;
      },
      get size() {
        return latestBySession.size;
      }
    };
  }

  // android-app/lib/host-resources.js
  var HOST_RESOURCE_HISTORY_LIMIT = 900;
  var HOST_RESOURCE_DETAIL_LIMIT = 180;
  var HOST_RESOURCE_CHART_RANGES = Object.freeze({
    live: 3e4,
    "1m": 6e4,
    "5m": 5 * 6e4,
    "15m": 15 * 6e4,
    since_open: Infinity
  });
  var HOST_RESOURCE_METRICS = Object.freeze({
    cpu_total_percent: ["cpu", "totalPercent"],
    cpu_user_percent: ["cpu", "userPercent"],
    cpu_privileged_percent: ["cpu", "privilegedPercent"],
    memory_used_percent: ["memory", "usedPercent"],
    memory_commit_percent: ["memory", "commitPercent"],
    disk_read_bps: ["disk", "readBps"],
    disk_write_bps: ["disk", "writeBps"],
    disk_read_iops: ["disk", "readIops"],
    disk_write_iops: ["disk", "writeIops"],
    network_receive_bps: ["network", "receiveBps"],
    network_send_bps: ["network", "sendBps"],
    network_receive_pps: ["network", "receivePps"],
    network_send_pps: ["network", "sendPps"]
  });
  function finiteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }
  function nullableNumber(value) {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }
  function positiveNumber(value) {
    return Math.max(0, finiteNumber(value));
  }
  function percent(value) {
    return Math.max(0, Math.min(100, finiteNumber(value)));
  }
  function safeCounter(value) {
    const text = String(value ?? "0");
    return /^\d+$/.test(text) ? text : "0";
  }
  function capturedAtMs(value) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function normalizedProcess(process, index) {
    const pid = Math.max(0, Math.round(finiteNumber(process?.pid)));
    const startTime = process?.start_time ? String(process.start_time) : "";
    const stableKey = String(process?.stable_key || `${pid || "process"}:${startTime || index}`);
    const attributionLevel = String(process?.attribution_level || (process?.attributed ? "runtime" : "unattributed"));
    return {
      key: stableKey,
      stableKey,
      parentKey: process?.parent_key ? String(process.parent_key) : "",
      pid,
      parentPid: Math.max(0, Math.round(finiteNumber(process?.parent_pid))),
      startTime,
      name: String(process?.name || "Process"),
      status: String(process?.status || "running"),
      attributed: process?.attributed === true,
      attributionLevel,
      attributionReason: String(process?.attribution_reason || "No proved agent relationship"),
      ownedSessionId: process?.owned_session_id ? String(process.owned_session_id) : "",
      agentLabel: process?.agent_label ? String(process.agent_label) : "",
      agentTypes: Array.isArray(process?.agent_types) ? process.agent_types.map(String) : [],
      workspaceLabel: process?.workspace_label ? String(process.workspace_label) : "",
      sessionCount: Math.max(0, Math.round(finiteNumber(process?.session_count))),
      cpuPercent: percent(process?.cpu_host_percent ?? process?.cpu_percent),
      cpuHostPercent: percent(process?.cpu_host_percent ?? process?.cpu_percent),
      cpuCoreEquivalent: positiveNumber(process?.cpu_core_equivalent ?? process?.cpu_percent),
      memoryBytes: positiveNumber(process?.memory_bytes),
      privateBytes: positiveNumber(process?.private_bytes ?? process?.memory_bytes),
      commitBytes: positiveNumber(process?.commit_bytes ?? process?.private_bytes),
      ioReadBps: positiveNumber(process?.io_read_bps),
      ioWriteBps: positiveNumber(process?.io_write_bps),
      ioReadOps: positiveNumber(process?.io_read_ops),
      ioWriteOps: positiveNumber(process?.io_write_ops),
      threadCount: Math.max(0, Math.round(finiteNumber(process?.thread_count))),
      handleCount: Math.max(0, Math.round(finiteNumber(process?.handle_count))),
      uptimeSeconds: process?.uptime_seconds == null ? null : positiveNumber(process.uptime_seconds),
      childCount: Math.max(0, Math.round(finiteNumber(process?.child_count))),
      selectedAs: Array.isArray(process?.selected_as) ? process.selected_as.map(String) : [],
      selectedParentPresent: process?.selected_parent_present !== false,
      counterTotals: {
        ioReadBytes: safeCounter(process?.counter_totals?.io_read_bytes),
        ioWriteBytes: safeCounter(process?.counter_totals?.io_write_bytes),
        ioReadOperations: safeCounter(process?.counter_totals?.io_read_operations),
        ioWriteOperations: safeCounter(process?.counter_totals?.io_write_operations)
      }
    };
  }
  function normalizedDisk(raw, index) {
    return {
      id: String(raw?.id || `disk-${index}`),
      label: String(raw?.label || `Disk ${index + 1}`),
      kind: String(raw?.kind || "unknown"),
      readBps: positiveNumber(raw?.read_bps),
      writeBps: positiveNumber(raw?.write_bps),
      readIops: positiveNumber(raw?.read_iops),
      writeIops: positiveNumber(raw?.write_iops),
      busyPercent: percent(raw?.busy_percent),
      readLatencyMs: positiveNumber(raw?.read_latency_ms),
      writeLatencyMs: positiveNumber(raw?.write_latency_ms),
      queueLength: positiveNumber(raw?.queue_length),
      capacityBytes: positiveNumber(raw?.capacity_bytes),
      freeBytes: positiveNumber(raw?.free_bytes),
      freePercent: percent(raw?.free_percent),
      available: raw?.available !== false
    };
  }
  function normalizedAdapter(raw, index) {
    return {
      id: String(raw?.id || `adapter-${index}`),
      label: String(raw?.label || `Adapter ${index + 1}`),
      kind: String(raw?.kind || "unknown"),
      physicalDefault: raw?.physical_default === true,
      receiveBps: positiveNumber(raw?.receive_bps),
      sendBps: positiveNumber(raw?.send_bps),
      receivePps: positiveNumber(raw?.receive_pps),
      sendPps: positiveNumber(raw?.send_pps),
      linkSpeedBps: positiveNumber(raw?.link_speed_bps),
      utilizationPercent: percent(raw?.utilization_percent),
      receiveErrors: positiveNumber(raw?.receive_errors),
      sendErrors: positiveNumber(raw?.send_errors),
      receiveDiscards: positiveNumber(raw?.receive_discards),
      sendDiscards: positiveNumber(raw?.send_discards),
      available: raw?.available !== false
    };
  }
  function normalizeHostResources(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return {
        available: false,
        status: "waiting",
        schemaVersion: 0,
        source: "",
        capturedAt: "",
        capturedAtMs: 0,
        sampleSequence: 0,
        sampleIntervalMs: 0,
        droppedGapCount: 0,
        machineLabel: "",
        system: null,
        processes: [],
        attributedProcesses: [],
        sampling: null,
        privacy: null,
        capabilities: null,
        error: null
      };
    }
    const rawSystem = snapshot.system && typeof snapshot.system === "object" ? snapshot.system : null;
    const rawCpu = rawSystem?.cpu && typeof rawSystem.cpu === "object" ? rawSystem.cpu : {};
    const rawMemory = rawSystem?.memory && typeof rawSystem.memory === "object" ? rawSystem.memory : {};
    const rawDisk = rawSystem?.disk && typeof rawSystem.disk === "object" ? rawSystem.disk : {};
    const rawNetwork = rawSystem?.network && typeof rawSystem.network === "object" ? rawSystem.network : {};
    const system = rawSystem ? {
      cpuPercent: percent(rawCpu.total_percent ?? rawSystem.cpu_percent),
      cpu: {
        totalPercent: percent(rawCpu.total_percent ?? rawSystem.cpu_percent),
        userPercent: percent(rawCpu.user_percent),
        privilegedPercent: percent(rawCpu.privileged_percent),
        idlePercent: percent(rawCpu.idle_percent),
        queueLength: positiveNumber(rawCpu.queue_length),
        frequencyMhz: positiveNumber(rawCpu.current_frequency_mhz),
        logicalCoreCount: Math.max(0, Math.round(finiteNumber(rawCpu.logical_core_count))),
        physicalCoreCount: Math.max(0, Math.round(finiteNumber(rawCpu.physical_core_count))),
        perLogical: Array.isArray(rawCpu.per_logical) ? rawCpu.per_logical : []
      },
      memory: {
        totalBytes: positiveNumber(rawMemory.total_bytes),
        usedBytes: positiveNumber(rawMemory.used_bytes),
        availableBytes: positiveNumber(rawMemory.available_bytes),
        usedPercent: percent(rawMemory.used_percent),
        cacheBytes: positiveNumber(rawMemory.cache_bytes),
        commitBytes: positiveNumber(rawMemory.commit_bytes),
        commitLimitBytes: positiveNumber(rawMemory.commit_limit_bytes),
        commitPeakBytes: positiveNumber(rawMemory.commit_peak_bytes),
        commitPercent: percent(rawMemory.commit_percent),
        pagedPoolBytes: positiveNumber(rawMemory.paged_pool_bytes),
        nonpagedPoolBytes: positiveNumber(rawMemory.nonpaged_pool_bytes),
        pagefileUsedBytes: positiveNumber(rawMemory.pagefile_used_bytes),
        pagesPerSec: positiveNumber(rawMemory.pages_per_sec),
        faultsPerSec: positiveNumber(rawMemory.faults_per_sec)
      },
      disk: {
        readBps: positiveNumber(rawDisk.read_bps),
        writeBps: positiveNumber(rawDisk.write_bps),
        busyPercent: percent(rawDisk.busy_percent),
        readIops: positiveNumber(rawDisk.read_iops),
        writeIops: positiveNumber(rawDisk.write_iops),
        readLatencyMs: positiveNumber(rawDisk.read_latency_ms),
        writeLatencyMs: positiveNumber(rawDisk.write_latency_ms),
        transferLatencyMs: positiveNumber(rawDisk.transfer_latency_ms),
        queueLength: positiveNumber(rawDisk.queue_length)
      },
      disks: (Array.isArray(rawSystem.disks) ? rawSystem.disks : []).map(normalizedDisk),
      network: {
        receiveBps: positiveNumber(rawNetwork.receive_bps),
        sendBps: positiveNumber(rawNetwork.send_bps),
        receivePps: positiveNumber(rawNetwork.receive_pps),
        sendPps: positiveNumber(rawNetwork.send_pps),
        utilizationPercent: percent(rawNetwork.utilization_percent),
        outputQueueLength: positiveNumber(rawNetwork.output_queue_length),
        receiveErrors: positiveNumber(rawNetwork.receive_errors),
        sendErrors: positiveNumber(rawNetwork.send_errors),
        receiveDiscards: positiveNumber(rawNetwork.receive_discards),
        sendDiscards: positiveNumber(rawNetwork.send_discards),
        tcpRetransmitsPerSec: positiveNumber(rawNetwork.tcp_retransmits_per_sec)
      },
      networkAdapters: (Array.isArray(rawSystem.network_adapters) ? rawSystem.network_adapters : []).map(normalizedAdapter),
      processCount: Math.max(0, Math.round(finiteNumber(rawSystem.process_count))),
      threadCount: Math.max(0, Math.round(finiteNumber(rawSystem.thread_count))),
      handleCount: Math.max(0, Math.round(finiteNumber(rawSystem.handle_count))),
      uptimeSeconds: positiveNumber(rawSystem.uptime_seconds)
    } : null;
    const processes = (Array.isArray(snapshot.processes) ? snapshot.processes : []).map(normalizedProcess).sort((left, right) => Number(right.attributed) - Number(left.attributed) || right.cpuHostPercent - left.cpuHostPercent || right.memoryBytes - left.memoryBytes || left.pid - right.pid);
    const capturedAt = snapshot.captured_at ? String(snapshot.captured_at) : "";
    return {
      available: snapshot.status === "fresh" && !!system,
      status: String(snapshot.status || "unavailable"),
      schemaVersion: Math.max(0, Math.round(finiteNumber(snapshot.schema_version))),
      source: String(snapshot.source || ""),
      capturedAt,
      capturedAtMs: capturedAtMs(capturedAt),
      sampleSequence: Math.max(0, Math.round(finiteNumber(snapshot.sample_sequence))),
      sampleIntervalMs: Math.max(0, Math.round(finiteNumber(snapshot.sample_interval_ms))),
      droppedGapCount: Math.max(0, Math.round(finiteNumber(snapshot.dropped_gap_count))),
      machineLabel: snapshot.machine_label ? String(snapshot.machine_label) : "",
      system,
      processes,
      attributedProcesses: processes.filter((process) => process.attributed),
      sampling: snapshot.sampling && typeof snapshot.sampling === "object" ? snapshot.sampling : null,
      privacy: snapshot.privacy && typeof snapshot.privacy === "object" ? snapshot.privacy : null,
      capabilities: snapshot.capabilities && typeof snapshot.capabilities === "object" ? snapshot.capabilities : null,
      error: snapshot.error && typeof snapshot.error === "object" ? snapshot.error : null
    };
  }
  function normalizeHostResourcePoint(frame) {
    if (!frame || typeof frame !== "object") return null;
    const sequence = Number(frame.sample_sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
    const source = frame.frame_kind === "system" ? frame : frame.system || {};
    const cpu = source.cpu || {};
    const memory = source.memory || {};
    const disk = source.disk || {};
    const network = source.network || {};
    return {
      sampleSequence: sequence,
      capturedAt: String(frame.captured_at || ""),
      capturedAtMs: capturedAtMs(frame.captured_at),
      monotonicMs: positiveNumber(frame.monotonic_ms),
      sampleIntervalMs: positiveNumber(frame.sample_interval_ms),
      droppedGapCount: Math.max(0, Math.round(finiteNumber(frame.dropped_gap_count))),
      status: String(frame.status || "unavailable"),
      cpu: {
        totalPercent: nullableNumber(cpu.total_percent ?? source.cpu_percent),
        userPercent: nullableNumber(cpu.user_percent),
        privilegedPercent: nullableNumber(cpu.privileged_percent)
      },
      memory: { usedPercent: nullableNumber(memory.used_percent), commitPercent: nullableNumber(memory.commit_percent) },
      disk: {
        readBps: nullableNumber(disk.read_bps),
        writeBps: nullableNumber(disk.write_bps),
        readIops: nullableNumber(disk.read_iops),
        writeIops: nullableNumber(disk.write_iops)
      },
      network: {
        receiveBps: nullableNumber(network.receive_bps),
        sendBps: nullableNumber(network.send_bps),
        receivePps: nullableNumber(network.receive_pps),
        sendPps: nullableNumber(network.send_pps)
      }
    };
  }
  function mergeOrderedHostResourceFrames(previous, incoming, limit = HOST_RESOURCE_HISTORY_LIMIT) {
    const bySequence = /* @__PURE__ */ new Map();
    [...Array.isArray(previous) ? previous : [], ...Array.isArray(incoming) ? incoming : [incoming]].forEach((frame) => {
      const sequence = Number(frame?.sample_sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 1) return;
      if (!bySequence.has(sequence)) bySequence.set(sequence, frame);
    });
    const boundedLimit = Math.max(1, Math.min(HOST_RESOURCE_HISTORY_LIMIT, Number(limit) || HOST_RESOURCE_HISTORY_LIMIT));
    return [...bySequence.entries()].sort((left, right) => left[0] - right[0]).slice(-boundedLimit).map(([, frame]) => frame);
  }
  function hostResourceMetricValue(frame, metric) {
    const point = frame?.sampleSequence ? frame : normalizeHostResourcePoint(frame);
    const path = HOST_RESOURCE_METRICS[metric];
    if (!point || !path) return null;
    return nullableNumber(path.reduce((value, key) => value?.[key], point));
  }
  function hostResourceIntervalStats(points, metric) {
    const samples = (Array.isArray(points) ? points : []).map((frame) => ({
      frame,
      point: frame?.sampleSequence ? frame : normalizeHostResourcePoint(frame),
      value: hostResourceMetricValue(frame, metric)
    })).filter((sample) => sample.point && sample.value !== null);
    if (!samples.length) return { current: null, min: null, average: null, max: null, p95: null, peakSequence: null, count: 0 };
    const values = samples.map((sample) => sample.value);
    const ordered = [...values].sort((left, right) => left - right);
    const peak = samples.reduce((best, sample) => sample.value > best.value ? sample : best, samples[0]);
    return {
      current: values.at(-1),
      min: Math.min(...values),
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      max: Math.max(...values),
      p95: ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)],
      peakSequence: peak.point.sampleSequence,
      count: values.length
    };
  }
  function hostResourceHasGap(previous, current) {
    if (!current || current.status !== "fresh") return true;
    if (!previous) return false;
    return current.sampleSequence !== previous.sampleSequence + 1 || current.droppedGapCount > previous.droppedGapCount || current.sampleIntervalMs > Math.max(2500, previous.sampleIntervalMs * 2.5);
  }
  function downsampleHostResourceSeries(frames, metric, targetBuckets = 240) {
    const points = mergeOrderedHostResourceFrames([], frames).map(normalizeHostResourcePoint).filter(Boolean);
    if (!points.length) return [];
    const target = Math.max(1, Math.round(Number(targetBuckets) || 240));
    const width = points.length <= target ? 1 : Math.ceil(points.length / target);
    const output = [];
    for (let offset = 0; offset < points.length; offset += width) {
      const rows = points.slice(offset, offset + width);
      const stats = hostResourceIntervalStats(rows, metric);
      output.push({
        startSequence: rows[0].sampleSequence,
        endSequence: rows.at(-1).sampleSequence,
        capturedAtStartMs: rows[0].capturedAtMs,
        capturedAtEndMs: rows.at(-1).capturedAtMs,
        current: stats.current,
        min: stats.min,
        average: stats.average,
        max: stats.max,
        p95: stats.p95,
        peakSequence: stats.peakSequence,
        count: stats.count,
        gap: rows.some((row, index) => hostResourceHasGap(index ? rows[index - 1] : points[offset - 1], row))
      });
    }
    return output;
  }
  function selectHostResourceRange(frames, range = "live") {
    const ordered = mergeOrderedHostResourceFrames([], frames);
    const duration = HOST_RESOURCE_CHART_RANGES[range] ?? HOST_RESOURCE_CHART_RANGES.live;
    if (!ordered.length || duration === Infinity) return ordered;
    const latest = ordered.reduce((maximum, frame) => Math.max(maximum, capturedAtMs(frame?.captured_at)), 0);
    if (!latest) return ordered.slice(-Math.max(2, Math.ceil(duration / 1e3)));
    return ordered.filter((frame) => capturedAtMs(frame?.captured_at) >= latest - duration);
  }
  function formatHostResourceBytes(value) {
    const bytes = positiveNumber(value);
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let scaled = bytes / 1024;
    let unitIndex = 0;
    while (scaled >= 1024 && unitIndex < units.length - 1) {
      scaled /= 1024;
      unitIndex += 1;
    }
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${scaled.toFixed(digits)} ${units[unitIndex]}`;
  }
  function formatHostResourceRate(value) {
    return `${formatHostResourceBytes(value)}/s`;
  }
  function formatHostResourcePercent(value) {
    return value == null ? "\u2014" : `${finiteNumber(value).toFixed(finiteNumber(value) >= 10 ? 1 : 2)}%`;
  }
  function formatHostResourceAge(capturedAt, nowMs = Date.now()) {
    const captured = Date.parse(capturedAt || "");
    if (!Number.isFinite(captured)) return "Waiting for local sample";
    const ageSeconds = Math.max(0, Math.round((nowMs - captured) / 1e3));
    if (ageSeconds < 2) return "Updated now";
    if (ageSeconds < 60) return `Updated ${ageSeconds}s ago`;
    return `Updated ${Math.floor(ageSeconds / 60)}m ago`;
  }
  function formatHostResourceTimestamp(value) {
    const parsed = typeof value === "number" ? value : Date.parse(String(value || ""));
    if (!Number.isFinite(parsed)) return "Unknown time";
    return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // frontend/hooks.jsx
  var { useState, useEffect, useRef, useCallback } = React;
  var CODEX_CLI_HISTORY_CHUNK_BYTES = 1024 * 1024;
  var HISTORY_CHUNK_TIMEOUT_MS = 15e3;
  var MAX_HISTORY_CHUNK_RETRIES = 1;
  var CONFIG_CONTROL_TIMEOUT_MS = 15e3;
  var DELIVERY_STAGE_TIMEOUT_MS = Object.freeze({
    queued: 1e4,
    accepted: 3e4,
    launch_accepted: 3e4,
    delivered: 3e4,
    steered: 3e4
  });
  var RELAY_RECONNECT_DELAYS_MS = [250, 500, 1e3, 2e3, 3e3];
  var CLIENT_RUNTIME_RECORD_LIMIT = 512;
  var STARTUP_DEFERRED_RELAY_TYPES = /* @__PURE__ */ new Set([
    "history",
    "history_snapshot",
    "history_chunk",
    "transcript_resync_required",
    "chat_list"
  ]);
  function boundedRecordWith(previous, key, value, limit = CLIENT_RUNTIME_RECORD_LIMIT) {
    const next = { ...previous || {} };
    if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key];
    next[key] = value;
    const keys = Object.keys(next);
    const overflow = keys.length - Math.max(1, Number(limit) || CLIENT_RUNTIME_RECORD_LIMIT);
    for (let index = 0; index < overflow; index += 1) delete next[keys[index]];
    return next;
  }
  function shallowMapMerge(prev, next) {
    const entries = Object.entries(next || {});
    if (!entries.length) return prev;
    let changed = false;
    const merged = { ...prev };
    entries.forEach(([key, value]) => {
      if (Object.is(prev[key], value)) return;
      if (sessionRegistryValueEqual(prev[key] ?? null, value ?? null)) return;
      merged[key] = value;
      changed = true;
    });
    return changed ? merged : prev;
  }
  function shouldMergeHistorySnapshot(type, msg, priorHistoryMeta) {
    const authoritativeFullSnapshot = (type === "history_snapshot" || type === "history") && !msg?.partial && (!msg?.mode || msg.mode === "full");
    if (authoritativeFullSnapshot) return false;
    return !!(msg?.partial || msg?.mode === "tail" || priorHistoryMeta?.mode === "chunked" || priorHistoryMeta?.partial);
  }
  function stableHistoryMessageId(msg) {
    if (!msg) return "";
    if (msg.source_message_id) return `source${msg.source_message_id}`;
    if (msg.native_source_id) return `native${msg.native_source_id}`;
    if (msg.id != null) return `id${msg.id}`;
    if (msg.server_message_id != null) return `server${msg.server_message_id}`;
    if (msg.sequence != null && msg.ts != null) return `seq${msg.sequence}${msg.ts}${msg.role || ""}`;
    if (msg.client_message_id) return `client${msg.client_message_id}`;
    if (msg.client_msg_id) return `client${msg.client_msg_id}`;
    return "";
  }
  function historyMessagesOverlapMatch(left, right) {
    if (!left || !right) return false;
    const leftId = stableHistoryMessageId(left);
    const rightId = stableHistoryMessageId(right);
    if (leftId && rightId) return leftId === rightId;
    return left.role === right.role && String(left.content || "") === String(right.content || "");
  }
  function preserveOptimisticMessagesAcrossHistory(authoritativeMessages, previousMessages) {
    const source = Array.isArray(authoritativeMessages) ? authoritativeMessages : [];
    const pending = (Array.isArray(previousMessages) ? previousMessages : []).filter((message) => message?._optimistic && message?._cid);
    if (pending.length === 0) return source;
    const authoritative = [...source];
    pending.forEach((optimistic) => {
      const matchIndex = authoritative.findIndex((message) => message?.role === "user" && (message.client_message_id === optimistic._cid || message.client_msg_id === optimistic._cid || String(message.content || "") === String(optimistic.content || "")));
      if (matchIndex >= 0) {
        const authoritativeStatus = authoritative[matchIndex]?.status;
        authoritative[matchIndex] = {
          ...authoritative[matchIndex],
          _cid: optimistic._cid,
          _optimistic: true,
          _delivered: optimistic._delivered || authoritative[matchIndex]._delivered || authoritativeStatus === "delivered" || authoritativeStatus === "agent_started",
          _agentStarted: optimistic._agentStarted || authoritative[matchIndex]._agentStarted || authoritativeStatus === "agent_started",
          _sendError: authoritativeStatus === "failed" ? authoritative[matchIndex].failure_code || optimistic._sendError || "Send failed" : optimistic._sendError || null
        };
      } else {
        authoritative.push(optimistic);
      }
    });
    return authoritative;
  }
  function mergeHistoryTailByOverlap(existing, incoming) {
    const current = Array.isArray(existing) ? existing : [];
    const nextIncoming = Array.isArray(incoming) ? incoming : [];
    if (!current.length) return nextIncoming;
    if (!nextIncoming.length) return current;
    const maxOverlap = Math.min(current.length, nextIncoming.length);
    for (let overlap = maxOverlap; overlap >= 1; overlap--) {
      let matches = true;
      for (let index = 0; index < overlap; index++) {
        if (!historyMessagesOverlapMatch(current[current.length - overlap + index], nextIncoming[index])) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      if (overlap === nextIncoming.length) return current;
      return [...current, ...nextIncoming.slice(overlap)];
    }
    return null;
  }
  function removeSupersededCliTranscriptPlaceholders(messages) {
    const current = Array.isArray(messages) ? messages : [];
    const isPendingPlaceholder = (message) => {
      const content = String(message?.content || "");
      return /\*\*(?:Claude Code|Codex|Cursor) CLI is waiting for a native transcript\.\*\*/i.test(content) && /placeholder will be replaced with the real CLI chat history/i.test(content);
    };
    if (!current.some(isPendingPlaceholder) || !current.some((message) => !isPendingPlaceholder(message))) {
      return current;
    }
    return current.filter((message) => !isPendingPlaceholder(message));
  }
  function shouldRefreshNativeCliPlaceholder(session, messages) {
    const agentType = session?.agent_type || session?.agentType || "";
    if (agentType !== "codex_cli" && agentType !== "cursor_cli") return false;
    if (!Array.isArray(messages) || messages.length !== 1) return false;
    const only = messages[0];
    if (only?.role !== "assistant") return false;
    return /\*\*(?:Codex|Cursor) CLI is waiting for a native transcript\.\*\*/.test(String(only.content || ""));
  }
  function sessionMetadataActivityMaps(sessionList) {
    const activities = {};
    const thinkingContent = {};
    const thinking = {};
    (sessionList || []).forEach((session) => {
      if (!session || typeof session !== "object" || !session.session_id || !session.activity) return;
      const kind = session.activity.kind || "working";
      const label = session.activity.label || (kind === "idle" ? "" : "Working");
      activities[session.session_id] = {
        kind,
        label,
        updatedAt: session.activity.updated_at || null,
        startedAt: session.activity.started_at || null,
        interruptHint: session.activity.interrupt_hint || "",
        goal: session.activity.goal || null,
        thinking: session.activity.thinking || null,
        current: session.activity.current || null,
        step: session.activity.step || null,
        usage: session.activity.usage || null,
        task_list: session.activity.task_list || null,
        context_card: session.activity.context_card || null,
        thinkingContent: session.activity.thinking?.text || session.activity.thinkingContent || "",
        transport: session.activity.transport || null
      };
      thinkingContent[session.session_id] = session.activity.thinking?.text || session.activity.thinkingContent || "";
      thinking[session.session_id] = ["thinking", "generating", "running_command", "applying_patch", "reading_files", "working"].includes(kind) ? label : false;
    });
    return { activities, thinkingContent, thinking };
  }
  function useRelay() {
    const [sessionRegistry, setSessionRegistry] = useState(() => createSessionRegistry());
    const sessions = sessionRegistry.list;
    const setSessions = useCallback((updater) => {
      setSessionRegistry((previous) => {
        const next = typeof updater === "function" ? updater(previous.list) : updater;
        return reconcileSessionRegistry(previous, next);
      });
    }, []);
    const messages = transcriptStoreView;
    const setMessages = updateTranscriptStore;
    const [historyMeta, setHistoryMeta] = useState({});
    const [historyLoading, setHistoryLoading] = useState({});
    const [connected, setConnected] = useState(false);
    const [connectionHealth, setConnectionHealth] = useState({ state: "connecting", rttMs: null, lastAckAt: null });
    const [unread, setUnread] = useState({});
    const [thinking, setThinking] = useState({});
    const [thinkingContent, setThinkingContent] = useState({});
    const [activities, setActivities] = useState({});
    const [health, setHealth] = useState({});
    const [deliveryStates, setDeliveryStates] = useState({});
    const [queuedMessages, setQueuedMessages] = useState({});
    const [scheduledSends, setScheduledSends] = useState([]);
    const [launchStates, setLaunchStates] = useState({});
    const [justLaunched, setJustLaunched] = useState(null);
    const [permissionPrompts, setPermissionPrompts] = useState({});
    const [errorPrompts, setErrorPrompts] = useState({});
    const [agentConfigs, setAgentConfigs] = useState({});
    const [workspaces, setWorkspaces] = useState([]);
    const [chatLists, setChatLists] = useState({});
    const [threadLists, setThreadLists] = useState({});
    const [terminalOutputs, setTerminalOutputs] = useState({});
    const [fileChanges, setFileChanges] = useState({});
    const [branchLists, setBranchLists] = useState({});
    const [skillLists, setSkillLists] = useState({});
    const [automationViews, setAutomationViews] = useState({});
    const [controlResults, setControlResults] = useState({});
    const [configControlStates, setConfigControlStates] = useState({});
    const [directoryListings, setDirectoryListings] = useState({});
    const [fileContents, setFileContents] = useState({});
    const [duplicateProxyAlarms, setDuplicateProxyAlarms] = useState([]);
    const [nightlyValidationFailures, setNightlyValidationFailures] = useState([]);
    const [latestAppUpdateValidation, setLatestAppUpdateValidation] = useState(null);
    const [providerUsage, setProviderUsage] = useState(null);
    const [providerUsageRefreshReceipt, setProviderUsageRefreshReceipt] = useState(null);
    const [providerUsageCostDetail, setProviderUsageCostDetail] = useState(null);
    const [hostResources, setHostResources] = useState(null);
    const [hostResourceError, setHostResourceError] = useState(null);
    const [hostResourceHistory, setHostResourceHistory] = useState([]);
    const [hostResourceDetails, setHostResourceDetails] = useState([]);
    const [hostResourceSubscription, setHostResourceSubscription] = useState({
      id: "",
      status: "idle",
      aggregateOnly: false,
      resumed: false
    });
    const [provisionalStreams, setProvisionalStreams] = useState({});
    const [semanticNotifications, setSemanticNotifications] = useState([]);
    const thinkingTimers = useRef({});
    const deliveryTimers = useRef({});
    const deliveryStatesRef = useRef({});
    const deliverySessionsRef = useRef({});
    const configControlStatesRef = useRef({});
    const configControlTimers = useRef({});
    const agentConfigsRef = useRef({});
    const wsRef = useRef(null);
    const sessionSubscriptionsRef = useRef([]);
    const sessionSubscriptionSerial = useRef(0);
    const reconnectAttempt = useRef(0);
    const reconnectTimer = useRef(null);
    const heartbeatTimer = useRef(null);
    const heartbeatTimeoutTimer = useRef(null);
    const heartbeatPending = useRef(null);
    const heartbeatSequence = useRef(0);
    const heartbeatIntervalMs = useRef(1e4);
    const heartbeatTimeoutMs = useRef(3e4);
    const offlineSendQueue = useRef([]);
    const activeSessionRef = useRef(null);
    const handleRelayMessageRef = useRef(null);
    const stateSequenceGate = useRef(createStateSequenceGate());
    const navigationEpochGate = useRef(createNavigationEpochGate());
    const historyRequestSerial = useRef(0);
    const latestHistoryRequest = useRef({});
    const historyChunkSerial = useRef(0);
    const latestHistoryChunkRequest = useRef({});
    const historyChunkTimers = useRef({});
    const historyChunkState = useRef({});
    const activeCursorThreadIdentity = useRef({});
    const pendingCursorThreadHistoryReset = useRef({});
    const startupReady = useRef(false);
    const startupDeferredMessages = useRef(/* @__PURE__ */ new Map());
    const startupDrainHandle = useRef(null);
    const provisionalStreamsRef = useRef({});
    const provisionalFlushHandle = useRef(null);
    const provisionalPendingFlush = useRef(/* @__PURE__ */ new Map());
    const hostResourceDesiredRef = useRef({ active: false, aggregateOnly: false });
    const hostResourceSubscriptionRef = useRef("");
    const hostResourceSubscribeRequestRef = useRef("");
    const hostResourceRequestSerial = useRef(0);
    const hostResourceHistoryRequestRef = useRef({ system: "", detail: "" });
    const hostResourceHistoryCursorRef = useRef({ system: 0, detail: 0 });
    const hostResourceLastLiveSequenceRef = useRef({ system: 0, detail: 0 });
    function restoreCachedTranscript(sessionId) {
      const cached = getCachedTranscript(sessionId);
      if (!cached) return false;
      return true;
    }
    function publishProvisionalStream(sessionId, stream, streamTrace = null) {
      provisionalStreamsRef.current = { ...provisionalStreamsRef.current, [sessionId]: stream };
      provisionalPendingFlush.current.set(sessionId, { stream, streamTrace });
      if (provisionalFlushHandle.current != null) return;
      const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
      provisionalFlushHandle.current = raf(() => {
        provisionalFlushHandle.current = null;
        const pending = [...provisionalPendingFlush.current.entries()];
        provisionalPendingFlush.current.clear();
        if (!pending.length) return;
        setProvisionalStreams((prev) => {
          const next = { ...prev };
          pending.forEach(([id, item]) => {
            next[id] = item.stream;
          });
          return next;
        });
        pending.forEach(([id, item]) => {
          if (item.streamTrace) recordStreamTraceAfterPaint({ stream_trace: item.streamTrace }, id);
        });
      });
    }
    function openProvisionalStream(sessionId, clientMessageId = null) {
      if (!sessionId) return;
      const existing = provisionalStreamsRef.current[sessionId];
      if (existing?.open) return;
      const stream = createProvisionalStream(sessionId, clientMessageId);
      provisionalStreamsRef.current = { ...provisionalStreamsRef.current, [sessionId]: stream };
      setProvisionalStreams((prev) => ({ ...prev, [sessionId]: stream }));
    }
    function clearProvisionalStream(sessionId) {
      if (!sessionId || !provisionalStreamsRef.current[sessionId]) return;
      const nextRef = { ...provisionalStreamsRef.current };
      delete nextRef[sessionId];
      provisionalStreamsRef.current = nextRef;
      provisionalPendingFlush.current.delete(sessionId);
      setProvisionalStreams((prev) => {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    }
    function clearAllProvisionalStreams() {
      provisionalStreamsRef.current = {};
      provisionalPendingFlush.current.clear();
      setProvisionalStreams({});
    }
    function cancelStartupDrain() {
      const pending = startupDrainHandle.current;
      startupDrainHandle.current = null;
      if (!pending) return;
      if (pending.kind === "idle" && typeof cancelIdleCallback === "function") cancelIdleCallback(pending.id);
      else clearTimeout(pending.id);
    }
    function scheduleStartupDrain() {
      if (startupDrainHandle.current || startupDeferredMessages.current.size === 0) return;
      const drainOne = () => {
        startupDrainHandle.current = null;
        const iterator = startupDeferredMessages.current.entries().next();
        if (iterator.done) return;
        const [key, deferred] = iterator.value;
        startupDeferredMessages.current.delete(key);
        handleRelayMessageRef.current?.(deferred);
        scheduleStartupDrain();
      };
      if (typeof requestIdleCallback === "function") {
        startupDrainHandle.current = { kind: "idle", id: requestIdleCallback(drainOne, { timeout: 250 }) };
      } else {
        startupDrainHandle.current = { kind: "timer", id: setTimeout(drainOne, 32) };
      }
    }
    function markStartupReadyAfterPaint() {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        startupReady.current = true;
        scheduleStartupDrain();
      }));
    }
    const send = useCallback((msg) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    }, []);
    const requestProviderUsageRefresh = useCallback((force = false) => {
      const requestId = `provider-usage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setProviderUsageRefreshReceipt({ requestId, status: "requested" });
      send({
        type: "provider_usage_refresh",
        protocol_version: 1,
        force: force === true,
        request_id: requestId
      });
      return requestId;
    }, [send]);
    const requestProviderUsageCostDetail = useCallback((options = {}) => {
      const requestId = `provider-cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const query = {
        days: Math.max(1, Math.min(365, Number(options.days) || 365)),
        providerId: options.providerId ? String(options.providerId) : "",
        project: options.project ? String(options.project) : "",
        cursor: /^\d+$/.test(String(options.cursor ?? "0")) ? String(options.cursor ?? "0") : "0",
        pageSize: Math.max(1, Math.min(256, Number(options.pageSize) || 256))
      };
      setProviderUsageCostDetail({ requestId, status: "loading", query, detail: null, error: null });
      send({
        type: "provider_usage_cost_detail_request",
        protocol_version: 1,
        request_id: requestId,
        days: query.days,
        provider_id: query.providerId || null,
        project: query.project || null,
        cursor: query.cursor,
        page_size: query.pageSize
      });
      return requestId;
    }, [send]);
    const requestHostResourceRefresh = useCallback((force = false) => {
      const requestId = `host-resource-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setHostResourceError(null);
      send({
        type: "host_resource_refresh",
        protocol_version: 1,
        force: force === true,
        request_id: requestId
      });
      return requestId;
    }, [send]);
    const clearHostResources = useCallback(() => {
      setHostResources(null);
      setHostResourceError(null);
      setHostResourceHistory([]);
      setHostResourceDetails([]);
      hostResourceHistoryCursorRef.current = { system: 0, detail: 0 };
      hostResourceLastLiveSequenceRef.current = { system: 0, detail: 0 };
    }, []);
    const sendHostResourceSubscribe = useCallback((aggregateOnly, resumeSubscriptionId = "") => {
      const requestId = `host-resource-subscribe-${Date.now()}-${++hostResourceRequestSerial.current}`;
      hostResourceSubscribeRequestRef.current = requestId;
      setHostResourceError(null);
      setHostResourceSubscription((previous) => ({
        ...previous,
        status: resumeSubscriptionId ? "reconnecting" : "subscribing",
        aggregateOnly: aggregateOnly === true
      }));
      send({
        type: "host_resource_subscribe",
        protocol_version: 1,
        request_id: requestId,
        ...resumeSubscriptionId ? { resume_subscription_id: resumeSubscriptionId } : {},
        aggregate_only: aggregateOnly === true
      });
      return requestId;
    }, [send]);
    const requestHostResourceHistory = useCallback((stream, afterSequence = 0) => {
      const normalizedStream = stream === "detail" ? "detail" : "system";
      const subscriptionId = hostResourceSubscriptionRef.current;
      if (!subscriptionId) return null;
      const requestId = `host-resource-history-${normalizedStream}-${Date.now()}-${++hostResourceRequestSerial.current}`;
      hostResourceHistoryRequestRef.current[normalizedStream] = requestId;
      send({
        type: "host_resource_history_request",
        protocol_version: 1,
        request_id: requestId,
        subscription_id: subscriptionId,
        stream: normalizedStream,
        after_sequence: Math.max(0, Math.round(Number(afterSequence) || 0)),
        max_points: normalizedStream === "detail" ? 8 : 64
      });
      return requestId;
    }, [send]);
    const subscribeHostResources = useCallback((aggregateOnly = false) => {
      const normalizedAggregateOnly = aggregateOnly === true;
      const previous = hostResourceDesiredRef.current;
      const previousId = hostResourceSubscriptionRef.current;
      if (previous.active && previous.aggregateOnly === normalizedAggregateOnly && previousId) return previousId;
      if (previousId && previous.aggregateOnly !== normalizedAggregateOnly) {
        send({
          type: "host_resource_unsubscribe",
          protocol_version: 1,
          request_id: `host-resource-unsubscribe-${Date.now()}-${++hostResourceRequestSerial.current}`,
          subscription_id: previousId
        });
        hostResourceSubscriptionRef.current = "";
      }
      hostResourceDesiredRef.current = { active: true, aggregateOnly: normalizedAggregateOnly };
      clearHostResources();
      sendHostResourceSubscribe(normalizedAggregateOnly, "");
      return null;
    }, [clearHostResources, send, sendHostResourceSubscribe]);
    const unsubscribeHostResources = useCallback(() => {
      hostResourceDesiredRef.current = { active: false, aggregateOnly: false };
      const subscriptionId = hostResourceSubscriptionRef.current;
      hostResourceSubscriptionRef.current = "";
      hostResourceSubscribeRequestRef.current = "";
      hostResourceHistoryRequestRef.current = { system: "", detail: "" };
      if (subscriptionId) send({
        type: "host_resource_unsubscribe",
        protocol_version: 1,
        request_id: `host-resource-unsubscribe-${Date.now()}-${++hostResourceRequestSerial.current}`,
        subscription_id: subscriptionId
      });
      clearHostResources();
      setHostResourceSubscription({ id: "", status: "idle", aggregateOnly: false, resumed: false });
    }, [clearHostResources, send]);
    const setSessionSubscriptions = useCallback((sessionIds) => {
      const normalized = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).filter((id) => typeof id === "string" && id.length > 0))].sort().slice(0, 128);
      if (normalized.length === sessionSubscriptionsRef.current.length && normalized.every((id, index) => id === sessionSubscriptionsRef.current[index])) return;
      sessionSubscriptionsRef.current = normalized;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "subscribe",
          protocol_version: 1,
          request_id: `web-sub-${Date.now()}-${++sessionSubscriptionSerial.current}`,
          sessions: normalized
        }));
      }
    }, []);
    function clearRelayHeartbeat() {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (heartbeatTimeoutTimer.current) clearTimeout(heartbeatTimeoutTimer.current);
      heartbeatTimer.current = null;
      heartbeatTimeoutTimer.current = null;
      heartbeatPending.current = null;
    }
    function sendRelayHeartbeat(ws = wsRef.current) {
      if (!ws || ws.readyState !== WebSocket.OPEN || heartbeatPending.current) return;
      const requestId = `web-hb-${Date.now()}-${++heartbeatSequence.current}`;
      const sentAt = Date.now();
      heartbeatPending.current = { requestId, sentAt };
      ws.send(JSON.stringify({
        type: "heartbeat",
        protocol_version: 1,
        request_id: requestId,
        client_ts: new Date(sentAt).toISOString()
      }));
      heartbeatTimeoutTimer.current = setTimeout(() => {
        if (heartbeatPending.current?.requestId !== requestId) return;
        heartbeatPending.current = null;
        heartbeatTimeoutTimer.current = null;
        setConnectionHealth({ state: "stale", rttMs: null, lastAckAt: null });
        try {
          ws.close();
        } catch {
        }
      }, heartbeatTimeoutMs.current);
    }
    function startRelayHeartbeat(msg, ws = wsRef.current) {
      clearRelayHeartbeat();
      heartbeatIntervalMs.current = Math.max(1e3, Number(msg?.heartbeat_interval_ms) || 1e4);
      heartbeatTimeoutMs.current = Math.max(
        heartbeatIntervalMs.current * 2,
        Number(msg?.heartbeat_timeout_ms) || 3e4
      );
      sendRelayHeartbeat(ws);
      heartbeatTimer.current = setInterval(() => sendRelayHeartbeat(ws), heartbeatIntervalMs.current);
    }
    function handleHeartbeatAck(msg) {
      const pending = heartbeatPending.current;
      if (!pending || pending.requestId !== msg.request_id) return;
      if (heartbeatTimeoutTimer.current) clearTimeout(heartbeatTimeoutTimer.current);
      heartbeatTimeoutTimer.current = null;
      heartbeatPending.current = null;
      const rttMs = Math.max(0, Date.now() - pending.sentAt);
      const state = rttMs <= 500 ? "healthy" : rttMs <= 2e3 ? "slow" : "poor";
      setConnectionHealth({ state, rttMs, lastAckAt: Date.now() });
    }
    function clearDeliveryTimeout(clientMessageId) {
      const timer = deliveryTimers.current[clientMessageId];
      if (timer) clearTimeout(timer);
      delete deliveryTimers.current[clientMessageId];
    }
    function setTrackedDeliveryState(clientMessageId, state) {
      if (!clientMessageId) return;
      if (!Object.prototype.hasOwnProperty.call(deliveryStatesRef.current, clientMessageId) && Object.keys(deliveryStatesRef.current).length >= CLIENT_RUNTIME_RECORD_LIMIT) {
        const oldest = Object.keys(deliveryStatesRef.current)[0];
        clearDeliveryTimeout(oldest);
        delete deliverySessionsRef.current[oldest];
      }
      deliveryStatesRef.current = boundedRecordWith(deliveryStatesRef.current, clientMessageId, state);
      setDeliveryStates((prev) => boundedRecordWith(prev, clientMessageId, state));
    }
    function trackDeliverySession(clientMessageId, sessionId) {
      if (!clientMessageId || !sessionId) return;
      deliverySessionsRef.current = boundedRecordWith(
        deliverySessionsRef.current,
        clientMessageId,
        sessionId
      );
    }
    function updateTrackedDeliveryMessage(clientMessageId, sessionHint, updater) {
      if (!clientMessageId) return;
      setMessages((prev) => {
        const sessionId = resolveDeliverySession(
          prev,
          clientMessageId,
          sessionHint || deliverySessionsRef.current[clientMessageId] || ""
        );
        if (!sessionId) return prev;
        trackDeliverySession(clientMessageId, sessionId);
        return updateDeliveryMessage(prev, clientMessageId, sessionId, updater);
      });
    }
    function markDeliveryFailed(clientMessageId, reason, sessionId = "") {
      if (!clientMessageId) return;
      if (deliveryStatesRef.current[clientMessageId] === "agent_started") return;
      clearDeliveryTimeout(clientMessageId);
      setTrackedDeliveryState(clientMessageId, "failed");
      updateTrackedDeliveryMessage(clientMessageId, sessionId, (message) => ({
        ...message,
        _sendError: reason || "Send failed"
      }));
    }
    function armDeliveryTimeout(clientMessageId, stage, reason) {
      clearDeliveryTimeout(clientMessageId);
      const timeoutMs = DELIVERY_STAGE_TIMEOUT_MS[stage];
      if (!timeoutMs) return;
      deliveryTimers.current[clientMessageId] = setTimeout(() => {
        delete deliveryTimers.current[clientMessageId];
        if (deliveryStatesRef.current[clientMessageId] !== stage) return;
        markDeliveryFailed(clientMessageId, reason);
      }, timeoutMs);
    }
    useEffect(() => {
      agentConfigsRef.current = agentConfigs;
    }, [agentConfigs]);
    function configControlKey(sessionId, field) {
      return `${sessionId}:${field}`;
    }
    function setConfigControlState(key, value) {
      if (!Object.prototype.hasOwnProperty.call(configControlStatesRef.current, key) && Object.keys(configControlStatesRef.current).length >= CLIENT_RUNTIME_RECORD_LIMIT) {
        clearConfigControlTimer(Object.keys(configControlStatesRef.current)[0]);
      }
      configControlStatesRef.current = boundedRecordWith(configControlStatesRef.current, key, value);
      setConfigControlStates(configControlStatesRef.current);
    }
    function clearConfigControlTimer(key) {
      const timer = configControlTimers.current[key];
      if (timer) clearTimeout(timer);
      delete configControlTimers.current[key];
    }
    function rollbackConfigControl(key, error) {
      const transaction = configControlStatesRef.current[key];
      if (!transaction || !["pending", "awaiting_config"].includes(transaction.status)) return;
      clearConfigControlTimer(key);
      const current = agentConfigsRef.current[transaction.sessionId] || {};
      const restored = { ...current, [transaction.configKey]: transaction.previousValue };
      agentConfigsRef.current = { ...agentConfigsRef.current, [transaction.sessionId]: restored };
      setAgentConfigs((prev) => ({
        ...prev,
        [transaction.sessionId]: { ...prev[transaction.sessionId] || {}, [transaction.configKey]: transaction.previousValue }
      }));
      setConfigControlState(key, { ...transaction, status: "failed", error: error || "Control change failed and was rolled back.", completedAt: Date.now() });
    }
    function submitConfigControl(sessionId, field, configKey, requestedValue, payload, requestId) {
      const key = configControlKey(sessionId, field);
      clearConfigControlTimer(key);
      const current = agentConfigsRef.current[sessionId] || {};
      const transaction = {
        sessionId,
        field,
        configKey,
        requestId,
        previousValue: current[configKey],
        requestedValue,
        status: "pending",
        error: null,
        startedAt: Date.now()
      };
      const optimistic = { ...current, [configKey]: requestedValue };
      agentConfigsRef.current = { ...agentConfigsRef.current, [sessionId]: optimistic };
      setAgentConfigs((prev) => ({ ...prev, [sessionId]: { ...prev[sessionId] || {}, [configKey]: requestedValue } }));
      setConfigControlState(key, transaction);
      configControlTimers.current[key] = setTimeout(
        () => rollbackConfigControl(key, "Timed out waiting for the agent to confirm this setting."),
        CONFIG_CONTROL_TIMEOUT_MS
      );
      send({ ...payload, session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function reconcileConfigControls(sessionId, configMessage) {
      Object.entries(configControlStatesRef.current).forEach(([key, transaction]) => {
        if (transaction.sessionId !== sessionId || !["pending", "awaiting_config"].includes(transaction.status)) return;
        if (!Object.prototype.hasOwnProperty.call(configMessage, transaction.configKey)) return;
        if (configMessage[transaction.configKey] !== transaction.requestedValue) return;
        clearConfigControlTimer(key);
        setConfigControlState(key, { ...transaction, status: "ok", error: null, completedAt: Date.now() });
      });
    }
    const connect = useCallback(() => {
      cancelStartupDrain();
      startupReady.current = false;
      startupDeferredMessages.current.clear();
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/client-ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        reconnectAttempt.current = 0;
        setConnected(true);
        setConnectionHealth({ state: "connecting", rttMs: null, lastAckAt: null });
        ws.send(JSON.stringify({
          type: "subscribe",
          protocol_version: 1,
          request_id: `web-sub-${Date.now()}-${++sessionSubscriptionSerial.current}`,
          sessions: sessionSubscriptionsRef.current
        }));
        if (hostResourceDesiredRef.current.active) {
          sendHostResourceSubscribe(
            hostResourceDesiredRef.current.aggregateOnly,
            hostResourceSubscriptionRef.current
          );
        }
      };
      ws.onclose = () => {
        clearRelayHeartbeat();
        Object.entries(configControlStatesRef.current).forEach(([key, transaction]) => {
          if (["pending", "awaiting_config"].includes(transaction?.status)) {
            rollbackConfigControl(key, "Connection changed before the native setting was confirmed. Retry after reconnecting.");
          }
        });
        Object.values(historyChunkTimers.current).forEach((timer) => clearTimeout(timer));
        historyChunkTimers.current = {};
        Object.keys(historyChunkState.current).forEach((id) => {
          historyChunkState.current[id] = {
            ...historyChunkState.current[id] || {},
            inFlight: false
          };
        });
        setHistoryLoading({});
        clearAllProvisionalStreams();
        setConnected(false);
        setConnectionHealth({ state: "offline", rttMs: null, lastAckAt: null });
        if (hostResourceDesiredRef.current.active) {
          setHostResourceSubscription((previous) => ({ ...previous, status: "reconnecting" }));
        }
        if (wsRef.current !== ws) return;
        const attempt = reconnectAttempt.current++;
        const delay = RELAY_RECONNECT_DELAYS_MS[Math.min(attempt, RELAY_RECONNECT_DELAYS_MS.length - 1)];
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          connect();
        }, delay);
      };
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.stream_trace && typeof msg.stream_trace === "object") {
          msg.stream_trace = { ...msg.stream_trace, browser_received_at_ms: Date.now() };
        }
        handleRelayMessageRef.current(msg);
      };
    }, [send, sendHostResourceSubscribe]);
    useEffect(() => {
      connect();
      return () => {
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        clearRelayHeartbeat();
        Object.values(deliveryTimers.current).forEach((timer) => clearTimeout(timer));
        deliveryTimers.current = {};
        Object.values(configControlTimers.current).forEach((timer) => clearTimeout(timer));
        configControlTimers.current = {};
        cancelStartupDrain();
        if (provisionalFlushHandle.current != null) {
          if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(provisionalFlushHandle.current);
          else clearTimeout(provisionalFlushHandle.current);
          provisionalFlushHandle.current = null;
        }
        provisionalPendingFlush.current.clear();
        const current = wsRef.current;
        wsRef.current = null;
        try {
          current?.close();
        } catch {
        }
      };
    }, [connect]);
    function mergeSessionMetadataActivity(sessionList) {
      const normalized = sessionMetadataActivityMaps(sessionList);
      setActivities((prev) => shallowMapMerge(prev, normalized.activities));
      setThinkingContent((prev) => shallowMapMerge(prev, normalized.thinkingContent));
      setThinking((prev) => shallowMapMerge(prev, normalized.thinking));
    }
    function clearRemovedSessionActivity(sessionList) {
      const liveIds = new Set((sessionList || []).map((session) => session && typeof session === "object" ? session.session_id : session).filter(Boolean));
      const retainLive = (previous) => {
        let changed = false;
        const next = { ...previous };
        Object.keys(next).forEach((id) => {
          if (liveIds.has(id)) return;
          delete next[id];
          changed = true;
        });
        return changed ? next : previous;
      };
      Object.keys(thinkingTimers.current).forEach((id) => {
        if (liveIds.has(id)) return;
        clearTimeout(thinkingTimers.current[id]);
        delete thinkingTimers.current[id];
      });
      [
        latestHistoryRequest,
        latestHistoryChunkRequest,
        historyChunkState,
        activeCursorThreadIdentity,
        pendingCursorThreadHistoryReset
      ].forEach((ref) => {
        Object.keys(ref.current).forEach((id) => {
          if (!liveIds.has(id)) delete ref.current[id];
        });
      });
      Object.keys(provisionalStreamsRef.current).forEach((id) => {
        if (!liveIds.has(id)) delete provisionalStreamsRef.current[id];
      });
      for (const id of provisionalPendingFlush.current.keys()) {
        if (!liveIds.has(id)) provisionalPendingFlush.current.delete(id);
      }
      Object.keys(historyChunkTimers.current).forEach((id) => {
        if (liveIds.has(id)) return;
        clearTimeout(historyChunkTimers.current[id]);
        delete historyChunkTimers.current[id];
      });
      let configChanged = false;
      Object.entries(configControlStatesRef.current).forEach(([key, transaction]) => {
        if (liveIds.has(transaction?.sessionId)) return;
        clearConfigControlTimer(key);
        delete configControlStatesRef.current[key];
        configChanged = true;
      });
      if (configChanged) setConfigControlStates({ ...configControlStatesRef.current });
      setActivities(retainLive);
      setThinkingContent(retainLive);
      setThinking(retainLive);
      setHistoryMeta(retainLive);
      setHistoryLoading(retainLive);
      setUnread(retainLive);
      setHealth(retainLive);
      setQueuedMessages(retainLive);
      setPermissionPrompts(retainLive);
      setErrorPrompts(retainLive);
      setAgentConfigs(retainLive);
      setChatLists(retainLive);
      setThreadLists(retainLive);
      setTerminalOutputs(retainLive);
      setFileChanges(retainLive);
      setBranchLists(retainLive);
      setSkillLists(retainLive);
      setAutomationViews(retainLive);
      setDirectoryListings(retainLive);
      setProvisionalStreams(retainLive);
      setFileContents((previous) => {
        let changed = false;
        const next = { ...previous };
        Object.keys(next).forEach((key) => {
          const separator = key.indexOf(":");
          const sessionId = separator >= 0 ? key.slice(0, separator) : key;
          if (liveIds.has(sessionId)) return;
          delete next[key];
          changed = true;
        });
        return changed ? next : previous;
      });
    }
    function mergeSessionConfigHints(sessionList) {
      const next = {};
      (sessionList || []).forEach((session) => {
        if (!session || typeof session !== "object" || !session.session_id) return;
        if (typeof session.auto_approve_permissions !== "boolean") return;
        next[session.session_id] = { auto_approve_permissions: session.auto_approve_permissions };
      });
      if (Object.keys(next).length > 0) {
        setAgentConfigs((prev) => {
          let changed = false;
          const merged = { ...prev };
          Object.entries(next).forEach(([sid, hints]) => {
            const nextCfg = { ...merged[sid] || {}, ...hints };
            if (sessionRegistryValueEqual(merged[sid] || {}, nextCfg)) return;
            merged[sid] = nextCfg;
            changed = true;
          });
          return changed ? merged : prev;
        });
      }
    }
    function mergeSessionChatLists(sessionList) {
      const next = {};
      (sessionList || []).forEach((session) => {
        if (!session || typeof session !== "object" || !session.session_id) return;
        if (Array.isArray(session.chat_list)) next[session.session_id] = session.chat_list;
      });
      setChatLists((prev) => shallowMapMerge(prev, next));
    }
    function mergeSessionHealth(sessionList) {
      const next = {};
      (sessionList || []).forEach((session) => {
        if (!session || typeof session !== "object" || !session.session_id) return;
        if (!session.status) return;
        next[session.session_id] = session.status;
      });
      setHealth((prev) => shallowMapMerge(prev, next));
    }
    function requestHistory(sessionOrId, options = {}) {
      const id = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.session_id;
      if (!id) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const requestId = `hist-${Date.now()}-${++historyRequestSerial.current}`;
      latestHistoryRequest.current[id] = requestId;
      const afterSequence = Math.max(0, Math.floor(Number(options.afterSequence ?? options.after_sequence) || 0));
      const mode = afterSequence > 0 ? "delta" : options.full ? "full" : "tail";
      setHistoryLoading((prev) => ({
        ...prev,
        [id]: { mode, requestedAt: Date.now(), requestId }
      }));
      const payload = {
        type: afterSequence > 0 ? "history_request" : "get_history",
        session: id,
        session_id: id,
        request_id: requestId
      };
      if (afterSequence > 0) payload.after_sequence = afterSequence;
      const limit = Number(options.limit || options.tailLimit || 0);
      if (afterSequence <= 0 && Number.isFinite(limit) && limit > 0 && !options.full) {
        payload.limit = Math.floor(limit);
        payload.tail = true;
      }
      if (options.full) payload.full = true;
      send(payload);
    }
    function requestHistoryChunk(sessionOrId, options = {}) {
      const id = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.session_id;
      if (!id) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const mode = options.mode === "older" ? "older" : options.mode === "around" ? "around" : "tail";
      const source = options.source || "relay_sqlite";
      const replace = mode === "around" || mode === "tail" && options.replace !== false;
      const beforeOffset = options.beforeOffset ?? options.before_offset ?? null;
      const beforeId = options.beforeId ?? options.before_id ?? null;
      const aroundId = options.aroundId ?? options.around_id ?? null;
      const requestCursorSig = `${mode}${source}${beforeOffset ?? ""}${beforeId ?? ""}${aroundId ?? ""}`;
      const currentChunkState = historyChunkState.current[id] || {};
      const nowMs = Date.now();
      if (currentChunkState.inFlight && mode !== "around") return;
      if (mode === "older" && currentChunkState.lastRequestSig === requestCursorSig && nowMs - Number(currentChunkState.lastRequestAt || 0) < 1500) {
        return;
      }
      const requestId = `histchunk-${Date.now()}-${++historyChunkSerial.current}`;
      const chunkBytes = Math.max(256 * 1024, Math.min(16 * 1024 * 1024, Number(options.chunkBytes || options.chunk_bytes || CODEX_CLI_HISTORY_CHUNK_BYTES) || CODEX_CLI_HISTORY_CHUNK_BYTES));
      if (mode !== "older") {
        const retryBaselineKeys = Number(options.retryAttempt || 0) > 0 ? currentChunkState.baselineMessageKeys : null;
        const baselineMessageKeys = Array.isArray(retryBaselineKeys) ? retryBaselineKeys : (messages[id] || []).map(messageDedupeKey).filter(Boolean);
        clearTimeout(historyChunkTimers.current[id]);
        historyChunkState.current[id] = {
          source,
          chunkBytes,
          limit: options.limit || null,
          inFlight: true,
          mode,
          replace,
          baselineMessageKeys,
          lastRequestSig: requestCursorSig,
          lastRequestAt: nowMs
        };
      } else {
        historyChunkState.current[id] = { ...historyChunkState.current[id] || {}, source, chunkBytes, limit: options.limit || historyChunkState.current[id]?.limit || null, inFlight: true, mode, lastRequestSig: requestCursorSig, lastRequestAt: nowMs };
      }
      latestHistoryChunkRequest.current[id] = requestId;
      setHistoryMeta((prev) => {
        if (!prev[id]?.error) return prev;
        const nextMeta = { ...prev[id] };
        delete nextMeta.error;
        return { ...prev, [id]: nextMeta };
      });
      setHistoryLoading((prev) => ({
        ...prev,
        [id]: { mode, kind: "chunked", requestedAt: Date.now(), requestId }
      }));
      const payload = {
        type: "history_chunk_request",
        session: id,
        session_id: id,
        request_id: requestId,
        mode,
        source,
        replace,
        chunk_bytes: chunkBytes
      };
      const limit = Number(options.limit || options.tailLimit || 0);
      if (Number.isFinite(limit) && limit > 0) payload.limit = Math.floor(limit);
      if (options.userInitiated || options.user_initiated) payload.user_initiated = true;
      if (mode === "older" && beforeOffset != null) payload.before_offset = beforeOffset;
      if (mode === "older" && beforeId != null) payload.before_id = beforeId;
      if (mode === "around" && aroundId != null) payload.around_id = aroundId;
      send(payload);
      historyChunkTimers.current[id] = setTimeout(() => {
        delete historyChunkTimers.current[id];
        if (latestHistoryChunkRequest.current[id] !== requestId) return;
        const latestState = historyChunkState.current[id] || {};
        if (!latestState.inFlight) return;
        historyChunkState.current[id] = { ...latestState, inFlight: false };
        const retryAttempt = Number(options.retryAttempt || 0);
        if (retryAttempt < MAX_HISTORY_CHUNK_RETRIES && wsRef.current?.readyState === WebSocket.OPEN) {
          requestHistoryChunk(id, {
            ...options,
            mode,
            source,
            beforeOffset,
            beforeId,
            chunkBytes,
            retryAttempt: retryAttempt + 1
          });
          return;
        }
        setHistoryLoading((prev) => {
          if (prev[id]?.requestId !== requestId) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setHistoryMeta((prev) => ({
          ...prev,
          [id]: {
            ...prev[id] || {},
            error: "Transcript history request timed out. Retry to load the latest messages."
          }
        }));
      }, HISTORY_CHUNK_TIMEOUT_MS);
    }
    function messageDedupeKey(msg) {
      if (!msg) return "";
      if (msg.source_message_id) return `source${msg.source_message_id}`;
      if (msg.native_source_id) return `native${msg.native_source_id}`;
      if (msg.id != null) return `id${msg.id}`;
      if (msg.server_message_id != null) return `server${msg.server_message_id}`;
      if (msg.sequence != null && msg.ts != null) return `seq${msg.sequence}${msg.ts}${msg.role || ""}`;
      if (msg.client_msg_id) return `client${msg.client_msg_id}`;
      const blocks = Array.isArray(msg.content_blocks) ? JSON.stringify(msg.content_blocks) : "";
      return `${msg.role || ""}${msg.content || ""}${blocks}`;
    }
    function mergeHistoryChunk(existing, incoming, mode) {
      const current = Array.isArray(existing) ? existing : [];
      const nextIncoming = Array.isArray(incoming) ? incoming : [];
      if (mode === "older") {
        const seen2 = new Set(current.map(messageDedupeKey));
        const older = [];
        nextIncoming.forEach((msg) => {
          const key = messageDedupeKey(msg);
          if (seen2.has(key)) return;
          seen2.add(key);
          older.push(msg);
        });
        return older.length ? [...older, ...current] : current;
      }
      const overlapMerged = mergeHistoryTailByOverlap(current, nextIncoming);
      if (overlapMerged) return overlapMerged;
      const seen = new Set(current.map(messageDedupeKey));
      const merged = [...current];
      let added = 0;
      nextIncoming.forEach((msg) => {
        const key = messageDedupeKey(msg);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(msg);
        added++;
      });
      return added ? merged : current;
    }
    function mergeHistoryTailSnapshot(existing, incoming) {
      const current = Array.isArray(existing) ? existing : [];
      const nextIncoming = Array.isArray(incoming) ? incoming : [];
      if (!current.length) return nextIncoming;
      if (!nextIncoming.length) return current;
      const overlapMerged = mergeHistoryTailByOverlap(current, nextIncoming);
      if (overlapMerged) return overlapMerged;
      const seen = new Set(current.map(messageDedupeKey));
      const merged = [...current];
      let added = 0;
      nextIncoming.forEach((msg) => {
        const key = messageDedupeKey(msg);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(msg);
        added++;
      });
      return added ? merged : current;
    }
    function reconcileHistoryTailReplacement(existing, incoming, chunkState, responseSource) {
      const current = Array.isArray(existing) ? existing : [];
      const nextIncoming = Array.isArray(incoming) ? incoming : [];
      const baselineKeys = new Set(Array.isArray(chunkState?.baselineMessageKeys) ? chunkState.baselineMessageKeys : []);
      const nativeSource = chunkState?.source === "native" || responseSource === "codex_cli_jsonl" || responseSource === "cursor_cli_jsonl";
      if (nativeSource && baselineKeys.size > nextIncoming.length) return current;
      const arrivedAfterRequest = current.filter((message) => {
        const key = messageDedupeKey(message);
        return key && !baselineKeys.has(key);
      });
      if (arrivedAfterRequest.length === 0) return nextIncoming;
      return mergeHistoryChunk(nextIncoming, arrivedAfterRequest, "tail");
    }
    function shouldPreserveTranscriptInListView(session) {
      if (!session || typeof session !== "object") return false;
      return ["codex", "codex-desktop", "cursor", "codex_cli", "cursor_cli", "roo_code", "cline"].includes(session.agent_type);
    }
    function clearSessionTranscript(sessionId) {
      if (!sessionId) return;
      setMessages((prev) => ({ ...prev, [sessionId]: [] }));
      setQueuedMessages((prev) => ({ ...prev, [sessionId]: [] }));
      setThinking((prev) => ({ ...prev, [sessionId]: false }));
      setThinkingContent((prev) => ({ ...prev, [sessionId]: "" }));
      setActivities((prev) => ({ ...prev, [sessionId]: false }));
      setHistoryMeta((prev) => ({ ...prev, [sessionId]: null }));
      setHistoryLoading((prev) => {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    }
    function respondToPrompt(sessionId, promptId, choiceId, details = {}) {
      const requestId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const instruction = typeof details.instruction === "string" ? details.instruction.trim() : "";
      const submittingChoiceId = choiceId || (Array.isArray(details.answers) ? "question_answers" : instruction ? "alternate_instruction" : null);
      setPermissionPrompts((prev) => prev[sessionId] ? { ...prev, [sessionId]: { ...prev[sessionId], submitting_choice_id: submittingChoiceId, request_id: requestId, error: null } } : prev);
      send({
        type: "permission_response",
        session_id: sessionId,
        prompt_id: promptId,
        ...choiceId ? { choice_id: choiceId } : {},
        ...Array.isArray(details.answers) ? { answers: details.answers } : {},
        ...instruction ? { instruction } : {},
        request_id: requestId
      });
    }
    function respondToErrorPrompt(sessionId, promptId, actionId) {
      const requestId = `errprompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setErrorPrompts((prev) => prev[sessionId] ? { ...prev, [sessionId]: { ...prev[sessionId], submitting_action_id: actionId, request_id: requestId, error: null } } : prev);
      send({ type: "error_prompt_action", session_id: sessionId, prompt_id: promptId, action_id: actionId, request_id: requestId });
    }
    function interruptSession(sessionId) {
      const requestId = `interrupt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "agent_interrupt", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function requestAgentConfig(sessionId) {
      const requestId = `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "agent_config_request", session_id: sessionId, request_id: requestId });
    }
    function setAgentModel(sessionId, modelId) {
      const requestId = `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const config = agentConfigsRef.current[sessionId] || {};
      const configKey = config.config_semantics === "observed_and_next_send" ? "next_send_model_id" : "model_id";
      return submitConfigControl(sessionId, "model", configKey, modelId, { type: "agent_set_model", model_id: modelId }, requestId);
    }
    function setAgentEffort(sessionId, effort) {
      const requestId = `effort-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const config = agentConfigsRef.current[sessionId] || {};
      const configKey = config.config_semantics === "observed_and_next_send" ? "next_send_effort" : "effort";
      return submitConfigControl(sessionId, "effort", configKey, effort, { type: "agent_set_effort", effort }, requestId);
    }
    function setAgentPermissionMode(sessionId, mode) {
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return submitConfigControl(sessionId, "permission_mode", "permission_mode", mode, { type: "agent_set_permission_mode", mode }, requestId);
    }
    function setAutoApprovePermissions(sessionId, enabled) {
      const requestId = `autoperm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return submitConfigControl(sessionId, "auto_approve_permissions", "auto_approve_permissions", !!enabled, { type: "agent_set_auto_approve_permissions", enabled: !!enabled }, requestId);
    }
    function setAntigravityMode(sessionId, mode) {
      const requestId = `mode-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const configKey = Object.prototype.hasOwnProperty.call(agentConfigsRef.current[sessionId] || {}, "conversation_mode") ? "conversation_mode" : "mode";
      return submitConfigControl(sessionId, "mode", configKey, mode, { type: "agent_set_mode", mode }, requestId);
    }
    function setCodexConfig(sessionId, {
      model_id,
      effort,
      speed,
      access_mode,
      permission_profile,
      confirm_bypass,
      workspace_mode
    }) {
      const requestId = `codex-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const config = agentConfigsRef.current[sessionId] || {};
      const options = [
        ["model", "model_id", model_id],
        ["effort", "effort", effort],
        ["speed", "speed", speed],
        ["access_mode", "permission_mode", access_mode],
        ["workspace_mode", "workspace_mode", workspace_mode],
        ["permission_profile", "permission_profile", permission_profile]
      ];
      const [field, configKey, requestedValue] = options.find(([, , value]) => value != null) || ["codex_config", "model_id", model_id];
      return submitConfigControl(sessionId, field, configKey, requestedValue, {
        type: "set_codex_config",
        model_id,
        effort,
        speed,
        access_mode,
        permission_profile,
        confirm_bypass,
        workspace_mode,
        source_revision: config.source_revision
      }, requestId);
    }
    function newThread(sessionId) {
      const requestId = `new-thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      clearSessionTranscript(sessionId);
      send({ type: "new_thread", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function openPanel(sessionId) {
      const requestId = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "open_panel", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function openNativeWindow(sessionId) {
      const requestId = `native-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "open_native_window", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function requestChatList(sessionId) {
      const requestId = `chatlist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "chat_list", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function switchChat(sessionId, chatId) {
      const requestId = `switch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "switch_chat", session_id: sessionId, chat_id: chatId, request_id: requestId });
      return requestId;
    }
    function newChat(sessionId) {
      const requestId = `newchat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "new_chat", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function requestThreadList(sessionId) {
      const requestId = `threads-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "thread_list", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function switchThread(sessionId, threadId) {
      const requestId = `swthread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      clearSessionTranscript(sessionId);
      send({ type: "switch_thread", session_id: sessionId, thread_id: threadId, request_id: requestId });
      return requestId;
    }
    function requestTerminalOutput(sessionId) {
      const requestId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "terminal_output", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function sendTerminalInput(sessionId, text) {
      const requestId = `termin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "terminal_input", session_id: sessionId, request_id: requestId, text });
      return requestId;
    }
    function requestFileChanges(sessionId) {
      const requestId = `diff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "file_changes", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function respondToFileChange(sessionId, changeId, action) {
      const requestId = `filechg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({
        type: "file_change_response",
        session_id: sessionId,
        change_id: changeId,
        action,
        request_id: requestId
      });
      return requestId;
    }
    function requestDirectoryListing(sessionId, dirPath) {
      const requestId = `dir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "list_directory", session_id: sessionId, request_id: requestId, path: dirPath || "." });
      return requestId;
    }
    function requestFileContent(sessionId, filePath) {
      const requestId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "read_file", session_id: sessionId, request_id: requestId, path: filePath });
      return requestId;
    }
    function requestSkillList(sessionId) {
      const requestId = `skills-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "skill_list", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function showCodexAutomation(sessionId) {
      const requestId = `automation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "automation_view_action", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function sendAttachment(sessionId, base64Data, mimeType, filename) {
      const requestId = `attach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "send_attachment", session_id: sessionId, request_id: requestId, data: base64Data, mime_type: mimeType, filename });
      return requestId;
    }
    function switchWorkspace(sessionId, folderPath) {
      const requestId = `swws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return submitConfigControl(sessionId, "workspace", "file_access_scope", folderPath, { type: "switch_workspace", folder_path: folderPath }, requestId);
    }
    function requestBranchList(sessionId) {
      const requestId = `branches-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "branch_list", session_id: sessionId, request_id: requestId });
      return requestId;
    }
    function switchBranch(sessionId, branchName) {
      const requestId = `swbranch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "switch_branch", session_id: sessionId, branch_name: branchName, request_id: requestId });
      return requestId;
    }
    function createBranch(sessionId, branchName) {
      const requestId = `newbranch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: "create_branch", session_id: sessionId, branch_name: branchName, request_id: requestId });
      return requestId;
    }
    function launchSession(agentType, workspacePath, options = {}) {
      const requestId = `launch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setLaunchStates((prev) => boundedRecordWith(prev, requestId, { status: "launching", agentType }));
      send({
        type: "launch_session",
        agent_type: agentType,
        workspace_path: workspacePath || void 0,
        model_id: options.model_id || void 0,
        permission_mode: options.permission_mode || void 0,
        effort: options.effort || void 0,
        request_id: requestId
      });
      return requestId;
    }
    function resumeSession(sourceSession, agentType, workspacePath, options = {}) {
      const requestId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setLaunchStates((prev) => boundedRecordWith(prev, requestId, { status: "launching", agentType }));
      send({
        type: "resume_session",
        source_session: sourceSession,
        agent_type: agentType || "claude",
        workspace_path: workspacePath || void 0,
        cli_session_id: options.cli_session_id || void 0,
        model_id: options.model_id || void 0,
        permission_mode: options.permission_mode || void 0,
        request_id: requestId
      });
      return requestId;
    }
    function closeSession(sessionId, isDisconnected) {
      if (isDisconnected) {
        send({ type: "dismiss_session", session: sessionId });
      } else {
        send({ type: "close_session", session: sessionId });
      }
    }
    function sendToSession(session, content, retryClientMessageId = "") {
      const cid = retryClientMessageId || `cmsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      trackDeliverySession(cid, session);
      const retryMessage = retryClientMessageId ? (transcriptStoreView[session] || []).find((message) => message._cid === cid) : null;
      const createdAt = messageInstant(retryMessage)?.iso || (/* @__PURE__ */ new Date()).toISOString();
      setMessages((prev) => {
        const existing = prev[session] || [];
        const hasRetryTarget = retryClientMessageId && existing.some((message) => message._cid === cid);
        return {
          ...prev,
          [session]: hasRetryTarget ? existing.map((message) => message._cid === cid ? { ...message, content, _optimistic: true, _delivered: false, _agentStarted: false, _sendError: null } : message) : [...existing, normalizeMessageTimestamp({
            role: "user",
            content,
            _cid: cid,
            _optimistic: true,
            created_at: createdAt
          })]
        };
      });
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setTrackedDeliveryState(cid, "queued");
        armDeliveryTimeout(cid, "queued", "Timed out waiting for relay acceptance.");
        send({ type: "send", session, content, client_message_id: cid, created_at: createdAt });
      } else if (offlineSendQueue.current.length < 20) {
        offlineSendQueue.current = [
          ...offlineSendQueue.current.filter((item) => item.cid !== cid),
          { session, content, cid, created_at: createdAt }
        ];
        clearDeliveryTimeout(cid);
        setTrackedDeliveryState(cid, "offline_queued");
      } else {
        setTrackedDeliveryState(cid, "queued");
        markDeliveryFailed(cid, "Offline send queue is full. Reconnect or retry after another message sends.");
      }
      return cid;
    }
    function flushOfflineSendQueue() {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || offlineSendQueue.current.length === 0) return;
      const queued = offlineSendQueue.current;
      offlineSendQueue.current = [];
      queued.forEach((item) => {
        trackDeliverySession(item.cid, item.session);
        setTrackedDeliveryState(item.cid, "queued");
        armDeliveryTimeout(item.cid, "queued", "Timed out waiting for relay acceptance after reconnect.");
        ws.send(JSON.stringify({
          type: "send",
          session: item.session,
          content: item.content,
          client_message_id: item.cid,
          created_at: item.created_at
        }));
      });
    }
    function steerMessage(sessionId, clientMessageId, content, nativeIndex) {
      const msg = { type: "steer", session_id: sessionId, client_message_id: clientMessageId, content };
      if (nativeIndex != null) msg.native_index = nativeIndex;
      send(msg);
      if (clientMessageId && clientMessageId.startsWith("native-")) {
        setQueuedMessages((prev) => ({ ...prev, [sessionId]: (prev[sessionId] || []).filter((m) => m.cid !== clientMessageId) }));
      }
    }
    function discardQueuedMessage(sessionId, clientMessageId) {
      clearDeliveryTimeout(clientMessageId);
      delete deliveryStatesRef.current[clientMessageId];
      delete deliverySessionsRef.current[clientMessageId];
      send({ type: "discard_queued", session_id: sessionId, client_message_id: clientMessageId });
      setQueuedMessages((prev) => ({ ...prev, [sessionId]: (prev[sessionId] || []).filter((m) => m.cid !== clientMessageId) }));
      setDeliveryStates((prev) => {
        const next = { ...prev };
        delete next[clientMessageId];
        return next;
      });
      setMessages((prev) => {
        const msgs = prev[sessionId] || [];
        return { ...prev, [sessionId]: msgs.filter((m) => m._cid !== clientMessageId) };
      });
    }
    function editQueuedMessage(sessionId, clientMessageId, newContent) {
      setQueuedMessages((prev) => ({
        ...prev,
        [sessionId]: (prev[sessionId] || []).map((m) => m.cid === clientMessageId ? {
          ...m,
          content: newContent,
          content_blocks: (m.content_blocks || []).map((block) => block?.type === "queued_message" ? { ...block, content: newContent } : block)
        } : m)
      }));
      setMessages((prev) => {
        const msgs = prev[sessionId] || [];
        return { ...prev, [sessionId]: msgs.map((m) => m._cid === clientMessageId ? { ...m, content: newContent } : m) };
      });
      send({ type: "edit_queued", session_id: sessionId, client_message_id: clientMessageId, content: newContent });
    }
    function mergeScheduledSend(job) {
      if (!job?.id) return;
      setScheduledSends((prev) => {
        const next = prev.filter((item) => item.id !== job.id);
        return ["completed", "cancelled"].includes(job.state) ? next : [job, ...next];
      });
    }
    async function refreshScheduledSends() {
      const response = await fetch("/api/scheduled-sends", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Could not load scheduled sends (${response.status})`);
      const body = await response.json();
      setScheduledSends((body.scheduled_sends || []).filter((job) => !["completed", "cancelled"].includes(job.state)));
      return body.scheduled_sends || [];
    }
    async function scheduleSend(sessionId, content, triggerKind, deliverAt = null) {
      const response = await fetch("/api/scheduled-sends", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          content,
          trigger_kind: triggerKind,
          ...triggerKind === "at" ? { deliver_at: deliverAt } : {}
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not schedule message (${response.status})`);
      mergeScheduledSend(body.scheduled_send);
      return body.scheduled_send;
    }
    async function cancelScheduledSend(id) {
      const response = await fetch(`/api/scheduled-sends/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not cancel scheduled message (${response.status})`);
      mergeScheduledSend(body.scheduled_send);
      return body.scheduled_send;
    }
    function recordStreamTraceAfterPaint(msg, sessionId) {
      if (!msg?.stream_trace || typeof window === "undefined") return;
      const trace = { ...msg.stream_trace, session_id: sessionId || msg.session || msg.session_id || "" };
      const raf = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
      raf(() => raf(() => {
        const rows = Array.isArray(window.__RAC_STREAM_TRACES__) ? window.__RAC_STREAM_TRACES__ : [];
        rows.push({ ...trace, browser_paint_at_ms: Date.now() });
        if (rows.length > 500) rows.splice(0, rows.length - 500);
        window.__RAC_STREAM_TRACES__ = rows;
      }));
    }
    function handleRelayMessage(msg) {
      const t = msg.type;
      if (!navigationEpochGate.current.accept(msg)) return;
      if (t === "navigation_started") return;
      if (t === "connection_ack") stateSequenceGate.current.reset(msg.state_epoch);
      const stateSessionId = msg.session || msg.session_id || "";
      const stateKey = t === "session_list" || t === "session_snapshot" || t === "proxy_session_snapshot" ? "session_list" : (t === "status" || t === "proxy_status" || t === "session_status" || t === "session_summary" || t === "session_patch") && stateSessionId ? `status:${stateSessionId}` : "";
      if (stateKey && !stateSequenceGate.current.accept(msg, stateKey)) return;
      if (t === "heartbeat_ack") {
        handleHeartbeatAck(msg);
        return;
      }
      if (t === "provider_usage_snapshot") {
        if (msg.snapshot && typeof msg.snapshot === "object") setProviderUsage(msg.snapshot);
        return;
      }
      if (t === "provider_usage_refresh_receipt") {
        setProviderUsageRefreshReceipt((previous) => !previous || !msg.request_id || previous.requestId === msg.request_id ? { requestId: msg.request_id || previous?.requestId || "", status: msg.status || "error", ...msg } : previous);
        return;
      }
      if (t === "provider_usage_cost_detail") {
        setProviderUsageCostDetail((previous) => previous?.requestId === msg.request_id ? { ...previous, status: "ready", detail: msg.detail, error: null } : previous);
        return;
      }
      if (t === "provider_usage_cost_detail_error") {
        setProviderUsageCostDetail((previous) => previous?.requestId === msg.request_id ? { ...previous, status: "error", error: msg.code || "cost_detail_failed" } : previous);
        return;
      }
      if (t === "host_resource_snapshot") {
        if (msg.snapshot && typeof msg.snapshot === "object") {
          setHostResources(msg.snapshot);
          setHostResourceError(null);
        }
        return;
      }
      if (t === "host_resource_subscription_ack") {
        if (!hostResourceDesiredRef.current.active || msg.request_id !== hostResourceSubscribeRequestRef.current || typeof msg.subscription_id !== "string") return;
        const previousId = hostResourceSubscriptionRef.current;
        const subscriptionId = msg.subscription_id;
        const resumed = msg.resumed === true && previousId === subscriptionId;
        hostResourceSubscriptionRef.current = subscriptionId;
        hostResourceSubscribeRequestRef.current = "";
        if (!resumed) {
          setHostResourceHistory([]);
          setHostResourceDetails([]);
          setHostResources(null);
          hostResourceHistoryCursorRef.current = { system: 0, detail: 0 };
          hostResourceLastLiveSequenceRef.current = { system: 0, detail: 0 };
        }
        setHostResourceSubscription({
          id: subscriptionId,
          status: "live",
          aggregateOnly: msg.aggregate_only === true,
          resumed
        });
        requestHostResourceHistory("system", resumed ? hostResourceHistoryCursorRef.current.system : 0);
        requestHostResourceHistory("detail", resumed ? hostResourceHistoryCursorRef.current.detail : 0);
        return;
      }
      if (t === "host_resource_history_chunk") {
        const chunk = msg.chunk;
        const stream = chunk?.stream === "detail" ? "detail" : chunk?.stream === "system" ? "system" : "";
        if (!stream || msg.subscription_id !== hostResourceSubscriptionRef.current || msg.request_id !== hostResourceHistoryRequestRef.current[stream]) return;
        const points = Array.isArray(chunk.points) ? chunk.points : [];
        if (stream === "system") {
          setHostResourceHistory((previous) => mergeOrderedHostResourceFrames(previous, points, HOST_RESOURCE_HISTORY_LIMIT));
        } else {
          setHostResourceDetails((previous) => mergeOrderedHostResourceFrames(previous, points, HOST_RESOURCE_DETAIL_LIMIT));
          const latest = points.filter((point) => point && typeof point === "object").sort((left, right) => Number(left.sample_sequence || 0) - Number(right.sample_sequence || 0)).at(-1);
          if (latest) setHostResources(latest);
        }
        const nextSequence = Math.max(
          hostResourceHistoryCursorRef.current[stream],
          Math.round(Number(chunk.next_sequence) || 0)
        );
        hostResourceHistoryCursorRef.current[stream] = nextSequence;
        hostResourceHistoryRequestRef.current[stream] = "";
        if (chunk.done !== true) requestHostResourceHistory(stream, nextSequence);
        return;
      }
      if (t === "host_resource_live") {
        const point = msg.point;
        const sequence = Number(point?.sample_sequence);
        if (msg.subscription_id !== hostResourceSubscriptionRef.current || !Number.isSafeInteger(sequence) || sequence <= hostResourceLastLiveSequenceRef.current.system) return;
        hostResourceLastLiveSequenceRef.current.system = sequence;
        hostResourceHistoryCursorRef.current.system = Math.max(hostResourceHistoryCursorRef.current.system, sequence);
        setHostResourceHistory((previous) => mergeOrderedHostResourceFrames(previous, point, HOST_RESOURCE_HISTORY_LIMIT));
        setHostResourceError(null);
        return;
      }
      if (t === "host_resource_detail") {
        const snapshot = msg.snapshot;
        const sequence = Number(snapshot?.sample_sequence);
        if (msg.subscription_id !== hostResourceSubscriptionRef.current || !Number.isSafeInteger(sequence) || sequence <= hostResourceLastLiveSequenceRef.current.detail) return;
        hostResourceLastLiveSequenceRef.current.detail = sequence;
        hostResourceHistoryCursorRef.current.detail = Math.max(hostResourceHistoryCursorRef.current.detail, sequence);
        setHostResourceDetails((previous) => mergeOrderedHostResourceFrames(previous, snapshot, HOST_RESOURCE_DETAIL_LIMIT));
        setHostResources(snapshot);
        setHostResourceError(null);
        return;
      }
      if (t === "host_resource_unsubscribed") {
        if (msg.subscription_id && msg.subscription_id !== hostResourceSubscriptionRef.current) return;
        return;
      }
      if (t === "host_resource_error") {
        setHostResourceError({
          code: msg.code || "unavailable",
          message: msg.message || "Windows host metrics are unavailable."
        });
        return;
      }
      if (t === "semantic_notification") {
        setSemanticNotifications((previous) => mergeSemanticNotifications(previous, msg));
        return;
      }
      if (!startupReady.current && !msg.request_id && STARTUP_DEFERRED_RELAY_TYPES.has(t)) {
        const id = msg.session || msg.session_id || "global";
        const source = t === "history_chunk" ? msg.source || "native" : "";
        startupDeferredMessages.current.set(`${t}:${id}:${source}`, msg);
        while (startupDeferredMessages.current.size > 256) {
          startupDeferredMessages.current.delete(startupDeferredMessages.current.keys().next().value);
        }
        return;
      }
      if (t === "session_list") {
        clearRemovedSessionActivity(msg.sessions || []);
        setSessionRegistry((prev) => reconcileSessionRegistry(prev, msg.sessions || []));
        mergeSessionMetadataActivity(msg.sessions || []);
        mergeSessionConfigHints(msg.sessions || []);
        mergeSessionChatLists(msg.sessions || []);
        mergeSessionHealth(msg.sessions || []);
        (msg.sessions || []).forEach((s) => {
          const id = s && typeof s === "object" ? s.session_id : s;
          const preserveListViewHistory = shouldPreserveTranscriptInListView(s);
          if (s && typeof s === "object" && s.is_list_view && !preserveListViewHistory) {
            if (id) setMessages((prev) => {
              if (prev[id] && prev[id].length > 0) return { ...prev, [id]: [] };
              return prev;
            });
          }
        });
        if (Array.isArray(msg.workspaces)) setWorkspaces((prev) => sessionRegistryValueEqual(prev, msg.workspaces) ? prev : msg.workspaces);
        return;
      }
      if (t === "session_snapshot" || t === "proxy_session_snapshot") {
        clearRemovedSessionActivity(msg.sessions || []);
        setSessionRegistry((prev) => reconcileSessionRegistry(prev, msg.sessions || []));
        mergeSessionMetadataActivity(msg.sessions || []);
        mergeSessionConfigHints(msg.sessions || []);
        mergeSessionChatLists(msg.sessions || []);
        mergeSessionHealth(msg.sessions || []);
        (msg.sessions || []).forEach((s) => {
          const id = s && typeof s === "object" ? s.session_id : s;
          const preserveListViewHistory = shouldPreserveTranscriptInListView(s);
          if (s && typeof s === "object" && s.is_list_view && !preserveListViewHistory) {
            if (id) setMessages((prev) => {
              if (prev[id] && prev[id].length > 0) return { ...prev, [id]: [] };
              return prev;
            });
          }
        });
        return;
      }
      if (t === "connection_ack") {
        startRelayHeartbeat(msg);
        if (Array.isArray(msg.semantic_notifications)) {
          setSemanticNotifications((previous) => mergeSemanticNotifications(previous, msg.semantic_notifications));
        }
        flushOfflineSendQueue();
        refreshScheduledSends().catch(() => {
        });
        setDuplicateProxyAlarms(Array.isArray(msg.duplicate_proxy_alarms) ? msg.duplicate_proxy_alarms : []);
        setNightlyValidationFailures(Array.isArray(msg.nightly_validation_failures) ? msg.nightly_validation_failures : []);
        setLatestAppUpdateValidation(msg.latest_app_update_validation || null);
        if (msg.provider_usage && typeof msg.provider_usage === "object") setProviderUsage(msg.provider_usage);
        if (msg.sessions && msg.sessions.length > 0) {
          setSessionRegistry((prev) => reconcileSessionRegistry(prev, msg.sessions));
          mergeSessionMetadataActivity(msg.sessions);
          mergeSessionConfigHints(msg.sessions);
          mergeSessionChatLists(msg.sessions);
          mergeSessionHealth(msg.sessions);
          msg.sessions.forEach((s) => {
            const preserveListViewHistory = shouldPreserveTranscriptInListView(s);
            if (s && typeof s === "object" && s.is_list_view && !preserveListViewHistory) {
              const id = s.session_id;
              if (id) setMessages((prev) => {
                if (prev[id] && prev[id].length > 0) return { ...prev, [id]: [] };
                return prev;
              });
            }
          });
        }
        if (Array.isArray(msg.workspaces)) setWorkspaces((prev) => sessionRegistryValueEqual(prev, msg.workspaces) ? prev : msg.workspaces);
        if (msg.session_health) {
          const h = {};
          Object.entries(msg.session_health).forEach(([id, v]) => {
            h[id] = typeof v === "object" ? v.health : v;
          });
          setHealth((prev) => shallowMapMerge(prev, h));
        }
        if (msg.agent_configs && typeof msg.agent_configs === "object") {
          setAgentConfigs((prev) => ({ ...prev, ...msg.agent_configs }));
        }
        {
          const restored = {};
          (msg.open_prompts || []).forEach((p) => {
            const sid = p.session_id || p.session;
            if (sid) restored[sid] = { ...p, received_at: Date.now() };
          });
          setPermissionPrompts(restored);
        }
        {
          const restored = {};
          (msg.open_error_prompts || []).forEach((p) => {
            const sid = p.session_id || p.session;
            if (sid) restored[sid] = { ...p, received_at: Date.now() };
          });
          setErrorPrompts(restored);
        }
        markStartupReadyAfterPaint();
        return;
      }
      if (t === "session_patch") {
        const id = msg.session || msg.session_id;
        if (!id) return;
        setSessionRegistry((prev) => patchSessionRegistry(prev, msg));
        const patch = msg.patch && typeof msg.patch === "object" ? msg.patch : {};
        const projected = { session_id: id, ...patch };
        if (patch.activity) mergeSessionMetadataActivity([projected]);
        if (patch.model_id !== void 0 || patch.permission_mode !== void 0 || patch.capabilities !== void 0) {
          mergeSessionConfigHints([projected]);
        }
        if (patch.chat_list) mergeSessionChatLists([projected]);
        if (patch.status) mergeSessionHealth([projected]);
        return;
      }
      if (t === "session_health") {
        const id = msg.session || msg.session_id;
        if (id) setHealth((prev) => ({ ...prev, [id]: msg.health }));
        return;
      }
      if (t === "scheduled_send_status") {
        mergeScheduledSend(msg.scheduled_send);
        return;
      }
      if (t === "session_summary") {
        const id = msg.session || msg.session_id;
        if (!id) return;
        setSessions((prev) => prev.map((session) => {
          const sessionId = typeof session === "string" ? session : session?.session_id;
          if (sessionId !== id) return session;
          return {
            ...typeof session === "object" ? session : {},
            session_id: id,
            ...msg.status ? { status: msg.status } : {},
            ...msg.activity ? { activity: msg.activity } : {},
            ...msg.goal ? { goal: msg.goal } : {},
            ...msg.last_snippet != null ? { last_snippet: msg.last_snippet } : {},
            ...msg.last_message_at != null ? { last_message_at: msg.last_message_at } : {},
            ...sessionChatTitleMetadataPatch(msg)
          };
        }));
        if (msg.status) setHealth((prev) => ({ ...prev, [id]: msg.status }));
        if (msg.activity) {
          const kind = String(msg.activity.kind || "idle").toLowerCase();
          handleRelayMessage({
            type: "status",
            session: id,
            activity: msg.activity,
            activity_trace: msg.activity_trace,
            thinking: ["thinking", "generating", "running_command", "applying_patch", "reading_files", "working"].includes(kind),
            label: msg.activity.label || ""
          });
        }
        if (Number(msg.unread_delta) > 0 && id !== activeSessionRef.current) {
          setUnread((prev) => ({ ...prev, [id]: (prev[id] || 0) + Number(msg.unread_delta) }));
        }
        return;
      }
      if (t === "message_delta") {
        const id = msg.session_id || msg.session;
        if (!id) return;
        const reduced = reduceMessageDeltaStream(provisionalStreamsRef.current[id] || null, msg);
        if (!reduced.accepted) return;
        publishProvisionalStream(id, reduced.stream, msg.stream_trace || null);
        return;
      }
      if (t === "transcript_resync_required") {
        const id = msg.session_id || msg.session;
        if (!id || id !== activeSessionRef.current) return;
        const currentChunkState = historyChunkState.current[id] || {};
        historyChunkState.current[id] = { ...currentChunkState, inFlight: false };
        clearTimeout(historyChunkTimers.current[id]);
        delete historyChunkTimers.current[id];
        requestHistoryChunk(id, {
          mode: "tail",
          source: "relay_sqlite",
          replace: true
        });
        return;
      }
      if (t === "history" || t === "history_snapshot") {
        const id = msg.session || msg.session_id;
        if (!id) return;
        if (msg.request_id && latestHistoryRequest.current[id] && latestHistoryRequest.current[id] !== msg.request_id) {
          return;
        }
        const sessionObj = sessions.find((s) => (typeof s === "object" ? s.session_id : s) === id);
        const preserveListViewHistory = shouldPreserveTranscriptInListView(sessionObj);
        if (sessionObj && typeof sessionObj === "object" && sessionObj.is_list_view && msg.messages?.length > 0 && !preserveListViewHistory) {
          setHistoryLoading((prev) => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
          return;
        }
        if (!msg.partial && (!msg.mode || msg.mode === "full")) clearProvisionalStream(id);
        const nextMessages = msg.messages || [];
        const priorHistoryMeta = historyMeta[id] || null;
        const forceCursorIdentityReplace = !!pendingCursorThreadHistoryReset.current[id] && nextMessages.length > 0;
        const shouldMergeTailSnapshot = !forceCursorIdentityReplace && shouldMergeHistorySnapshot(t, msg, priorHistoryMeta);
        setMessages((prev) => {
          const mergedRaw = shouldMergeTailSnapshot ? mergeHistoryTailSnapshot(prev[id], nextMessages) : nextMessages;
          const merged = removeSupersededCliTranscriptPlaceholders(
            preserveOptimisticMessagesAcrossHistory(mergedRaw, prev[id])
          );
          if (merged === prev[id]) return prev;
          return { ...prev, [id]: merged };
        });
        setHistoryMeta((prev) => {
          const nextMeta = {
            ...shouldMergeTailSnapshot ? prev[id] || {} : {},
            partial: !!msg.partial || !!(shouldMergeTailSnapshot && prev[id]?.partial),
            loaded: shouldMergeTailSnapshot ? Math.max(
              Number(prev[id]?.loaded || 0),
              Number(msg.loaded_messages ?? nextMessages.length) || nextMessages.length,
              (messages[id] || []).length
            ) : Number(msg.loaded_messages ?? nextMessages.length) || nextMessages.length,
            total: Number(msg.total_messages ?? prev[id]?.total ?? nextMessages.length) || nextMessages.length,
            limit: msg.limit || null,
            mode: shouldMergeTailSnapshot ? prev[id]?.mode || "chunked" : msg.mode || (msg.partial ? "tail" : "full")
          };
          if (sessionRegistryValueEqual(prev[id] || null, nextMeta)) return prev;
          return { ...prev, [id]: nextMeta };
        });
        setHistoryLoading((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (forceCursorIdentityReplace) delete pendingCursorThreadHistoryReset.current[id];
        return;
      }
      if (t === "history_chunk") {
        const id = msg.session || msg.session_id;
        if (!id) return;
        const currentChunkState = historyChunkState.current[id] || {};
        const isCompatibleTailResponse = msg.mode !== "older" && currentChunkState.mode === "tail" && (msg.source || "relay_sqlite") === (currentChunkState.source || "relay_sqlite");
        if (msg.request_id && latestHistoryChunkRequest.current[id] && latestHistoryChunkRequest.current[id] !== msg.request_id && !isCompatibleTailResponse) {
          return;
        }
        if (msg.error && (!Array.isArray(msg.messages) || msg.messages.length === 0)) {
          setHistoryLoading((prev) => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
          historyChunkState.current[id] = {
            ...historyChunkState.current[id] || {},
            inFlight: false
          };
          clearTimeout(historyChunkTimers.current[id]);
          delete historyChunkTimers.current[id];
          setHistoryMeta((prev) => ({
            ...prev,
            [id]: {
              ...prev[id] || {},
              error: String(msg.error?.message || msg.error || "Transcript history could not be loaded.")
            }
          }));
          return;
        }
        const mode = msg.mode === "older" ? "older" : msg.mode === "around" ? "around" : "tail";
        const cursor = msg.cursor || {};
        const nextBeforeOffset = cursor.next_before_offset ?? null;
        const nextBeforeId = cursor.next_before_id ?? null;
        const hasMore = !!(msg.partial && (nextBeforeOffset != null || nextBeforeId != null));
        const incoming = Array.isArray(msg.messages) ? msg.messages : [];
        const replaceTail = mode === "around" || mode === "tail" && msg.replace === true;
        const estimatedMessages = replaceTail ? incoming : mergeHistoryChunk(messages[id], incoming, mode);
        const estimatedLength = estimatedMessages.length;
        setMessages((prev) => {
          const merged = removeSupersededCliTranscriptPlaceholders(
            preserveOptimisticMessagesAcrossHistory(
              replaceTail ? reconcileHistoryTailReplacement(prev[id], incoming, currentChunkState, msg.source) : mergeHistoryChunk(prev[id], incoming, mode),
              prev[id]
            )
          );
          if (merged === prev[id]) return prev;
          return { ...prev, [id]: merged };
        });
        setHistoryMeta((prev) => {
          const nextMeta = {
            ...prev[id] || {},
            partial: hasMore,
            loaded: replaceTail ? Number(msg.loaded_messages ?? estimatedLength) || estimatedLength : Math.max(Number(prev[id]?.loaded || 0), Number(msg.loaded_messages || 0), estimatedLength),
            total: Number(msg.total_messages || prev[id]?.total || estimatedLength) || estimatedLength,
            limit: null,
            mode: "chunked",
            source: msg.source || "native",
            cursor,
            bytes_total: cursor.total_bytes || 0
          };
          delete nextMeta.error;
          if (sessionRegistryValueEqual(prev[id] || null, nextMeta)) return prev;
          return { ...prev, [id]: nextMeta };
        });
        setHistoryLoading((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        historyChunkState.current[id] = {
          ...historyChunkState.current[id] || {},
          inFlight: false,
          nextBeforeOffset,
          nextBeforeId
        };
        clearTimeout(historyChunkTimers.current[id]);
        delete historyChunkTimers.current[id];
        return;
      }
      if (t === "history_delta") {
        const id = msg.session || msg.session_id;
        if (!id) return;
        if (msg.request_id && latestHistoryRequest.current[id] && latestHistoryRequest.current[id] !== msg.request_id) return;
        const rawDelta = Array.isArray(msg.messages) ? msg.messages : Array.isArray(msg.events) ? msg.events : [];
        const newMsgs = rawDelta.map((event) => event?.message || event).filter(Boolean);
        const estimated = mergeHistoryChunk(messages[id], newMsgs, "tail");
        setMessages((prev) => {
          const merged = removeSupersededCliTranscriptPlaceholders(mergeHistoryChunk(prev[id], newMsgs, "tail"));
          if (merged === prev[id]) return prev;
          return { ...prev, [id]: merged };
        });
        setHistoryMeta((prev) => {
          const prior = prev[id] || {};
          const loaded = Math.max(Number(prior.loaded || 0), estimated.length);
          const total = Math.max(Number(msg.total_messages || 0), Number(prior.total || 0), loaded);
          return {
            ...prev,
            [id]: {
              ...prior,
              loaded,
              total,
              last_sequence: Number(msg.last_sequence || prior.last_sequence || 0),
              mode: prior.mode || "chunked"
            }
          };
        });
        setHistoryLoading((prev) => {
          if (prev[id]?.requestId !== msg.request_id) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        return;
      }
      if (t === "status" || t === "proxy_status" || t === "session_status") {
        const id = msg.session || msg.session_id;
        if (!id) return;
        const activityKind = msg.activity?.kind || "";
        const isThinking = msg.thinking || ["thinking", "generating", "running_command", "applying_patch", "reading_files", "working"].includes(activityKind);
        if (shouldClearEmptyProvisionalOnTerminal(
          provisionalStreamsRef.current[id],
          msg.activity || (!isThinking ? { kind: "idle" } : null),
          isThinking
        )) clearProvisionalStream(id);
        const label = msg.label || msg.activity?.label || (activityKind === "idle" ? "" : "Thinking");
        const activity = isThinking || msg.activity ? {
          kind: msg.activity?.kind || (isThinking ? "thinking" : "working"),
          label,
          updatedAt: msg.activity?.updated_at || null,
          startedAt: msg.activity?.started_at || null,
          interruptHint: msg.activity?.interrupt_hint || "",
          goal: msg.activity?.goal || null,
          thinking: msg.activity?.thinking || null,
          current: msg.activity?.current || null,
          step: msg.activity?.step || null,
          usage: msg.activity?.usage || null,
          task_list: msg.activity?.task_list || null,
          context_card: msg.activity?.context_card || null,
          thinkingContent: msg.activity?.thinking?.text || msg.activity?.thinkingContent || "",
          transport: normalizeFleetActivityTrace(msg.activity_trace)
        } : false;
        if (isThinking) {
          clearTimeout(thinkingTimers.current[id]);
          setThinking((prev) => Object.is(prev[id], label) ? prev : { ...prev, [id]: label });
          setActivities((prev) => shallowMapMerge(prev, { [id]: activity }));
          const nextThinkingContent = msg.activity?.thinking?.text ?? msg.thinking_content ?? msg.activity?.thinkingContent;
          if (nextThinkingContent != null) {
            setThinkingContent((prev) => Object.is(prev[id], nextThinkingContent) ? prev : { ...prev, [id]: nextThinkingContent });
          }
        } else if (activityKind === "idle") {
          clearTimeout(thinkingTimers.current[id]);
          setThinking((prev) => prev[id] === false ? prev : { ...prev, [id]: false });
          setActivities((prev) => {
            const nextActivity = activity;
            return Object.is(prev[id], nextActivity) ? prev : { ...prev, [id]: nextActivity };
          });
          setThinkingContent((prev) => prev[id] === "" ? prev : { ...prev, [id]: "" });
        } else if (msg.activity?.goal || msg.activity?.task_list || msg.activity?.step || msg.activity?.usage) {
          clearTimeout(thinkingTimers.current[id]);
          setThinking((prev) => prev[id] === false ? prev : { ...prev, [id]: false });
          setActivities((prev) => shallowMapMerge(prev, { [id]: activity }));
        } else {
          clearTimeout(thinkingTimers.current[id]);
          thinkingTimers.current[id] = setTimeout(() => {
            setThinking((prev) => prev[id] === false ? prev : { ...prev, [id]: false });
            setActivities((prev) => prev[id] === false ? prev : { ...prev, [id]: false });
            setThinkingContent((prev) => prev[id] === "" ? prev : { ...prev, [id]: "" });
          }, 4e3);
        }
        recordStreamTraceAfterPaint(msg, id);
        return;
      }
      if (t === "permission_prompt") {
        const sid = msg.session_id || msg.session;
        if (sid) setPermissionPrompts((prev) => ({ ...prev, [sid]: { ...msg, received_at: Date.now() } }));
        return;
      }
      if (t === "permission_prompt_expired") {
        const sid = msg.session_id || msg.session;
        if (sid) setPermissionPrompts((prev) => {
          const { [sid]: _, ...rest } = prev;
          return rest;
        });
        return;
      }
      if (t === "session_error_prompt") {
        const sid = msg.session_id || msg.session;
        if (sid) setErrorPrompts((prev) => ({ ...prev, [sid]: { ...msg, received_at: Date.now() } }));
        return;
      }
      if (t === "session_error_prompt_cleared") {
        const sid = msg.session_id || msg.session;
        if (sid) setErrorPrompts((prev) => {
          const { [sid]: _, ...rest } = prev;
          return rest;
        });
        return;
      }
      if (t === "chat_list") {
        const sid = msg.session_id || msg.session;
        if (sid) setChatLists((prev) => ({ ...prev, [sid]: msg.chats || [] }));
        return;
      }
      if (t === "branch_list") {
        const sid = msg.session_id || msg.session;
        if (sid) setBranchLists((prev) => ({ ...prev, [sid]: { branches: msg.branches || [], current: msg.current || "" } }));
        return;
      }
      if (t === "thread_list") {
        const sid = msg.session_id || msg.session;
        if (sid) {
          const threads = msg.threads || [];
          const activeThread = threads.find((thread) => thread?.active);
          const cursorIdentity = String(activeThread?.cache_key || "");
          const previousIdentity = activeCursorThreadIdentity.current[sid] || "";
          if (cursorIdentity && previousIdentity && cursorIdentity !== previousIdentity) {
            pendingCursorThreadHistoryReset.current[sid] = cursorIdentity;
            clearSessionTranscript(sid);
          }
          if (cursorIdentity) activeCursorThreadIdentity.current[sid] = cursorIdentity;
          setThreadLists((prev) => ({ ...prev, [sid]: threads }));
        }
        return;
      }
      if (t === "duplicate_proxy_alarm") {
        setDuplicateProxyAlarms(Array.isArray(msg.duplicate_sessions) ? msg.duplicate_sessions : []);
        return;
      }
      if (t === "nightly_validation_status") {
        setNightlyValidationFailures(Array.isArray(msg.failures) ? msg.failures : []);
        return;
      }
      if (t === "app_update_validation_status") {
        setLatestAppUpdateValidation(msg.validation || null);
        return;
      }
      if (t === "skill_list") {
        const sid = msg.session_id || msg.session;
        if (sid) setSkillLists((prev) => ({ ...prev, [sid]: { installed: msg.installed || [], recommended: msg.recommended || [] } }));
        return;
      }
      if (t === "codex_automation_view") {
        const sid = msg.session_id || msg.session;
        if (sid) setAutomationViews((prev) => ({ ...prev, [sid]: msg.view || null }));
        return;
      }
      if (t === "terminal_output") {
        const sid = msg.session_id || msg.session;
        if (sid) setTerminalOutputs((prev) => ({ ...prev, [sid]: msg.entries || [] }));
        return;
      }
      if (t === "file_changes") {
        const sid = msg.session_id || msg.session;
        if (sid) setFileChanges((prev) => ({ ...prev, [sid]: msg.entries || [] }));
        return;
      }
      if (t === "directory_listing") {
        const sid = msg.session_id || msg.session;
        if (sid) setDirectoryListings((prev) => ({ ...prev, [sid]: { path: msg.path, entries: msg.entries || [] } }));
        return;
      }
      if (t === "file_content") {
        const sid = msg.session_id || msg.session;
        if (sid) setFileContents((prev) => boundedRecordWith(prev, `${sid}:${msg.path}`, { path: msg.path, content: msg.content, truncated: msg.truncated }));
        return;
      }
      if (t === "agent_config") {
        const sid = msg.session_id || msg.session;
        if (!sid) return;
        reconcileConfigControls(sid, msg);
        setAgentConfigs((prev) => {
          const existing = prev[sid] || {};
          const next = { ...existing, ...msg };
          if ((!Array.isArray(msg.available_models) || msg.available_models.length === 0) && Array.isArray(existing.available_models) && existing.available_models.length > 0) {
            next.available_models = existing.available_models;
          }
          Object.values(configControlStatesRef.current).forEach((transaction) => {
            if (transaction.sessionId !== sid || !["pending", "awaiting_config"].includes(transaction.status)) return;
            next[transaction.configKey] = transaction.requestedValue;
          });
          agentConfigsRef.current = { ...agentConfigsRef.current, [sid]: next };
          return { ...prev, [sid]: next };
        });
        return;
      }
      if (t === "agent_control_result") {
        const sid = msg.session_id || msg.session;
        if (msg.request_id) {
          setControlResults((prev) => boundedRecordWith(prev, msg.request_id, { ...msg, received_at: Date.now() }));
          const pendingEntry = Object.entries(configControlStatesRef.current).find(([, transaction]) => transaction.requestId === msg.request_id && transaction.sessionId === sid && ["pending", "awaiting_config"].includes(transaction.status));
          if (pendingEntry) {
            const [key, transaction] = pendingEntry;
            if (msg.result === "failed") {
              rollbackConfigControl(key, msg.error?.message || msg.error || "The agent rejected this setting.");
            } else if (msg.result === "ok") {
              setConfigControlState(key, { ...transaction, status: "awaiting_config" });
              if (sid) requestAgentConfig(sid);
            }
          }
        }
        if (sid && msg.result === "ok" && msg.command === "new_thread") {
          clearSessionTranscript(sid);
        }
        if (sid && msg.result === "ok" && ["new_thread", "switch_thread"].includes(msg.command)) {
          requestThreadList(sid);
        }
        if (sid && msg.result === "ok" && msg.command === "switch_chat") {
          requestChatList(sid);
        }
        if (msg.command === "permission_response" && sid) {
          if (msg.result === "ok") {
            setPermissionPrompts((prev) => {
              const { [sid]: _, ...rest } = prev;
              return rest;
            });
          } else if (msg.result === "failed") {
            setPermissionPrompts((prev) => prev[sid] ? { ...prev, [sid]: { ...prev[sid], submitting_choice_id: null, error: msg.error?.message || "Permission response failed" } } : prev);
          }
        }
        if (msg.command === "error_prompt_action" && sid && msg.result === "failed") {
          setErrorPrompts((prev) => prev[sid] ? { ...prev, [sid]: { ...prev[sid], submitting_action_id: null, error: msg.error?.message || "Error prompt action failed" } } : prev);
        }
        if (msg.command === "file_change_response" && sid && msg.result === "ok") {
          requestFileChanges(sid);
        }
        return;
      }
      if (t === "message_accepted") {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid && sid) trackDeliverySession(cid, sid);
        const storedStatus = ["accepted", "delivered", "agent_started", "failed"].includes(msg.status) ? msg.status : "accepted";
        const persistedStatus = storedStatus === "accepted" && msg.launch_accepted_at ? "launch_accepted" : storedStatus;
        if (cid && persistedStatus === "failed") {
          markDeliveryFailed(cid, msg.failure_code || "Send failed", sid);
          return;
        }
        const current = cid ? deliveryStatesRef.current[cid] : null;
        if (cid && !["busy_queued", "steered", "launch_accepted", "delivered", "agent_started"].includes(current)) {
          setTrackedDeliveryState(cid, persistedStatus);
          if (persistedStatus === "accepted") {
            armDeliveryTimeout(cid, "accepted", "Relay accepted the message, but native delivery timed out.");
          } else if (persistedStatus === "launch_accepted") {
            armDeliveryTimeout(cid, "launch_accepted", "The native launch was accepted, but no native user turn was observed.");
          } else if (persistedStatus === "delivered") {
            armDeliveryTimeout(cid, "delivered", "Message reached the agent, but agent activity did not start in time.");
          } else {
            clearDeliveryTimeout(cid);
          }
        }
        if (cid) {
          updateTrackedDeliveryMessage(cid, sid, (message) => normalizeMessageTimestamp({
            ...message,
            ...msg.created_at != null ? { created_at: msg.created_at } : {},
            ...msg.timestamp != null ? { timestamp: msg.timestamp } : {},
            ...msg.ts != null ? { ts: msg.ts } : {},
            ...msg.launch_accepted_at != null ? { _launchAcceptedAt: msg.launch_accepted_at } : {},
            _delivered: persistedStatus === "delivered" || persistedStatus === "agent_started",
            _agentStarted: persistedStatus === "agent_started",
            _sendError: null
          }));
        }
        return;
      }
      if (t === "proxy_send_result" && msg.result === "launch_accepted") {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid && sid) trackDeliverySession(cid, sid);
        if (cid && !["delivered", "agent_started"].includes(deliveryStatesRef.current[cid])) {
          setTrackedDeliveryState(cid, "launch_accepted");
          armDeliveryTimeout(cid, "launch_accepted", "The native launch was accepted, but no native user turn was observed.");
          updateTrackedDeliveryMessage(cid, sid, (message) => ({
            ...message,
            _launchAcceptedAt: msg.accepted_at || (/* @__PURE__ */ new Date()).toISOString(),
            _sendError: null
          }));
        }
        return;
      }
      if (t === "message_delivered" || t === "proxy_send_result" && msg.result === "delivered") {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid && sid) trackDeliverySession(cid, sid);
        if (cid && deliveryStatesRef.current[cid] !== "agent_started") {
          setTrackedDeliveryState(cid, "delivered");
          armDeliveryTimeout(cid, "delivered", "Message reached the agent, but agent activity did not start in time.");
        }
        if (cid) {
          updateTrackedDeliveryMessage(cid, sid, (message) => ({
            ...message,
            _delivered: true,
            _sendError: null
          }));
        }
        return;
      }
      if (t === "agent_started") {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid && sid) trackDeliverySession(cid, sid);
        if (cid) {
          clearDeliveryTimeout(cid);
          setTrackedDeliveryState(cid, "agent_started");
        }
        if (sid) openProvisionalStream(sid, cid || null);
        if (cid) {
          updateTrackedDeliveryMessage(cid, sid, (message) => ({
            ...message,
            _delivered: true,
            _agentStarted: true,
            _sendError: null
          }));
        }
        return;
      }
      if (t === "message_failed" || t === "proxy_send_result" && msg.result === "failed") {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (sid) clearProvisionalStream(sid);
        if (cid) {
          const failureReason = msg.reason || msg.message || msg.error?.message || "Send failed";
          markDeliveryFailed(cid, failureReason, sid);
        }
        return;
      }
      if (t === "message_queued") {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid) {
          const contentBlocks = Array.isArray(msg.content_blocks) ? msg.content_blocks : [];
          const queuedBlock = contentBlocks.find((block) => block?.type === "queued_message");
          clearDeliveryTimeout(cid);
          setTrackedDeliveryState(cid, "busy_queued");
          if (sid) {
            setQueuedMessages((prev) => ({
              ...prev,
              [sid]: [...prev[sid] || [], {
                cid,
                content: queuedBlock?.content ?? msg.content,
                content_blocks: contentBlocks,
                queuedAt: msg.queued_at
              }]
            }));
          }
        }
        return;
      }
      if (t === "queue_delivered") {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid) {
          setTrackedDeliveryState(cid, "accepted");
          armDeliveryTimeout(cid, "accepted", "Queued message left the relay, but native delivery timed out.");
          if (sid) setQueuedMessages((prev) => ({ ...prev, [sid]: (prev[sid] || []).filter((m) => m.cid !== cid) }));
        }
        return;
      }
      if (t === "steer_result") {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid) {
          if (msg.result === "ok") {
            setTrackedDeliveryState(cid, "steered");
            armDeliveryTimeout(cid, "steered", "Message was steered, but agent activity did not start in time.");
          } else {
            markDeliveryFailed(cid, msg.error?.message || msg.error || "The desktop proxy rejected the message.", sid);
          }
          if (sid) setQueuedMessages((prev) => ({ ...prev, [sid]: (prev[sid] || []).filter((m) => m.cid !== cid) }));
        }
        return;
      }
      if (t === "native_queue") {
        const sid = msg.session_id || msg.session;
        const items = msg.items || [];
        if (sid) {
          setQueuedMessages((prev) => {
            const existing = (prev[sid] || []).filter((m) => m.cid && m.cid.startsWith("cmsg-"));
            const native = items.map((item, i) => ({
              cid: `native-${i}`,
              content: item.content_blocks?.find((block) => block?.type === "queued_message")?.content ?? item.text,
              content_blocks: Array.isArray(item.content_blocks) ? item.content_blocks : [],
              native: true,
              nativeIndex: item.index,
              status: item.state || "queued"
            }));
            return { ...prev, [sid]: [...existing, ...native] };
          });
        }
        return;
      }
      if (t === "rate_limit_active") {
        const sid = msg.session_id || msg.session;
        const pct = msg.percent_used ?? null;
        const isHardLimit = pct == null || pct >= 100;
        if (sid) {
          setSessions((prev) => prev.map(
            (s) => (typeof s === "string" ? s : s?.session_id) === sid ? { ...typeof s === "object" ? s : {}, session_id: sid, rate_limited_until: msg.retry_after_hint || (isHardLimit ? "unknown" : null), rate_limit_active: isHardLimit, percent_used: pct } : s
          ));
        }
        return;
      }
      if (t === "rate_limit_cleared") {
        const sid = msg.session_id || msg.session;
        if (sid) {
          setSessions((prev) => prev.map(
            (s) => (typeof s === "string" ? s : s?.session_id) === sid ? { ...typeof s === "object" ? s : {}, session_id: sid, rate_limited_until: null, rate_limit_active: false, percent_used: null } : s
          ));
        }
        return;
      }
      if (t === "session_launching") {
        return;
      }
      if (t === "session_launch_ack") {
        const reqId = msg.request_id;
        const sid = msg.session_id || msg.session;
        if (reqId) {
          setLaunchStates((prev) => {
            const { [reqId]: _removed, ...rest } = prev;
            return rest;
          });
        }
        if (sid) setJustLaunched(sid);
        return;
      }
      if (t === "session_launch_failed") {
        const reqId = msg.request_id;
        const error = msg.reason || msg.error || "Launch failed";
        if (reqId) {
          setLaunchStates((prev) => boundedRecordWith(
            prev,
            reqId,
            { ...prev[reqId], status: "failed", error }
          ));
        }
        return;
      }
      if (t === "session_closed") {
        const id = msg.session || msg.session_id;
        if (id) {
          setSessions((prev) => prev.filter((s) => (typeof s === "string" ? s : s?.session_id) !== id));
        }
        return;
      }
      if (t === "message" || t === "proxy_message" || t === "message_event") {
        const id = msg.session || msg.session_id || msg.message?.session_id;
        const role = msg.role || msg.message?.role;
        const content = msg.content || msg.message?.content;
        const contentBlocks = Array.isArray(msg.content_blocks) ? msg.content_blocks : Array.isArray(msg.message?.content_blocks) ? msg.message.content_blocks : null;
        const clientMessageId = msg.client_message_id || msg.message?.client_message_id || null;
        const deliveryStatus = msg.status || msg.message?.status || null;
        const nativeDelivered = deliveryStatus === "delivered" || deliveryStatus === "agent_started";
        if (!id || !role || !content) return;
        if (role === "assistant") clearProvisionalStream(id);
        const incomingMessage = normalizeMessageTimestamp({
          role,
          content,
          ...contentBlocks ? { content_blocks: contentBlocks } : {},
          ...msg.source_message_id ? { source_message_id: msg.source_message_id } : {},
          ...msg.native_source_id ? { native_source_id: msg.native_source_id } : {},
          ...msg.source_cursor ? { source_cursor: msg.source_cursor } : {},
          ...msg.source ? { source: msg.source } : {},
          ...msg.server_message_id != null ? { server_message_id: msg.server_message_id } : {},
          ...clientMessageId ? { client_message_id: clientMessageId } : {},
          ...deliveryStatus ? { status: deliveryStatus } : {},
          ...msg.sequence != null ? { sequence: msg.sequence } : {},
          ...msg.created_at != null ? { created_at: msg.created_at } : {},
          ...msg.timestamp != null ? { timestamp: msg.timestamp } : {},
          ...msg.ts != null ? { ts: msg.ts } : {}
        });
        setMessages((prev) => {
          const existing = prev[id] || [];
          if (role === "user") {
            const idx = existing.findIndex((m) => m._optimistic && (clientMessageId && m._cid === clientMessageId || !clientMessageId && m.content === content));
            if (idx >= 0) {
              const updated = [...existing];
              const prev_msg = existing[idx];
              updated[idx] = normalizeMessageTimestamp({
                ...prev_msg,
                role,
                content,
                ...contentBlocks ? { content_blocks: contentBlocks } : {},
                ...incomingMessage.source_message_id ? { source_message_id: incomingMessage.source_message_id } : {},
                ...incomingMessage.native_source_id ? { native_source_id: incomingMessage.native_source_id } : {},
                ...incomingMessage.source_cursor ? { source_cursor: incomingMessage.source_cursor } : {},
                ...incomingMessage.source ? { source: incomingMessage.source } : {},
                ...incomingMessage.server_message_id != null ? { server_message_id: incomingMessage.server_message_id } : {},
                ...incomingMessage.client_message_id ? { client_message_id: incomingMessage.client_message_id } : {},
                ...incomingMessage.status ? { status: incomingMessage.status } : {},
                ...incomingMessage.sequence != null ? { sequence: incomingMessage.sequence } : {},
                ...incomingMessage.created_at != null ? { created_at: incomingMessage.created_at } : {},
                ...incomingMessage.timestamp != null ? { timestamp: incomingMessage.timestamp } : {},
                ...incomingMessage.ts != null ? { ts: incomingMessage.ts } : {},
                _delivered: prev_msg._delivered || nativeDelivered,
                _agentStarted: prev_msg._agentStarted || deliveryStatus === "agent_started",
                _cid: prev_msg._cid,
                _optimistic: prev_msg._optimistic
              });
              return { ...prev, [id]: removeSupersededCliTranscriptPlaceholders(updated) };
            }
          }
          const stableIncomingId = stableHistoryMessageId(incomingMessage);
          if (existing.some((message) => stableIncomingId ? stableHistoryMessageId(message) === stableIncomingId : message.role === role && message.content === content)) {
            return prev;
          }
          return {
            ...prev,
            [id]: removeSupersededCliTranscriptPlaceholders([
              ...existing,
              {
                ...incomingMessage,
                ...role === "user" && clientMessageId ? { _cid: clientMessageId } : {},
                _delivered: role === "user" && nativeDelivered,
                _agentStarted: role === "user" && deliveryStatus === "agent_started"
              }
            ])
          };
        });
        if (role === "assistant" && id !== activeSessionRef.current) {
          setUnread((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
        }
        return;
      }
    }
    handleRelayMessageRef.current = handleRelayMessage;
    return { sessions, messages, provisionalStreams, historyMeta, historyLoading, connected, connectionHealth, unread, setUnread, thinking, thinkingContent, activities, health, deliveryStates, launchStates, justLaunched, setJustLaunched, permissionPrompts, respondToPrompt, errorPrompts, respondToErrorPrompt, interruptSession, agentConfigs, configControlStates, requestAgentConfig, setAgentModel, setAgentEffort, setAgentPermissionMode, setAutoApprovePermissions, setAntigravityMode, setCodexConfig, newThread, openPanel, openNativeWindow, requestChatList, switchChat, newChat, chatLists, requestThreadList, switchThread, threadLists, switchWorkspace, requestTerminalOutput, sendTerminalInput, terminalOutputs, requestFileChanges, respondToFileChange, fileChanges, sendAttachment, send, sendToSession, steerMessage, discardQueuedMessage, editQueuedMessage, queuedMessages, scheduledSends, scheduleSend, cancelScheduledSend, refreshScheduledSends, launchSession, resumeSession, closeSession, activeSessionRef, restoreCachedTranscript, setSessionSubscriptions, workspaces, branchLists, requestBranchList, switchBranch, createBranch, skillLists, requestSkillList, automationViews, showCodexAutomation, controlResults, directoryListings, requestDirectoryListing, fileContents, requestFileContent, requestHistory, requestHistoryChunk, duplicateProxyAlarms, nightlyValidationFailures, latestAppUpdateValidation, providerUsage, providerUsageRefreshReceipt, requestProviderUsageRefresh, providerUsageCostDetail, requestProviderUsageCostDetail, hostResources, hostResourceError, hostResourceHistory, hostResourceDetails, hostResourceSubscription, subscribeHostResources, unsubscribeHostResources, requestHostResourceRefresh, clearHostResources, semanticNotifications };
  }

  // frontend/session-pins.js
  function sessionIdOf(session) {
    return typeof session === "string" ? session : session?.session_id || session?.id || "";
  }
  function sessionPinOrder(preference) {
    const value = Number(preference?.pin_order);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }
  function sessionIsPinned(preference) {
    return preference?.pinned === true || sessionPinOrder(preference) > 0;
  }
  function partitionPinnedSessions(sessions, preferences = {}) {
    const pinned = [];
    const unpinned = [];
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const id = sessionIdOf(session);
      const preference = id ? preferences[id] : null;
      if (sessionIsPinned(preference)) {
        pinned.push({ session, id, order: sessionPinOrder(preference) });
      } else {
        unpinned.push(session);
      }
    }
    pinned.sort((left, right) => (left.order || Number.MAX_SAFE_INTEGER) - (right.order || Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
    return {
      pinned: pinned.map((entry) => entry.session),
      unpinned
    };
  }

  // frontend/workspace-groups.js
  var GROUP_ALIAS_STORAGE_KEY = "remote-agent-chat:group-aliases:v1";
  var DEFAULT_GROUP_ALIASES = Object.freeze({
    "^remoteagent": "Remote Agent Chat"
  });
  var ACTIVE_ACTIVITY_KINDS = /* @__PURE__ */ new Set([
    "thinking",
    "generating",
    "running_command",
    "applying_patch",
    "reading_files",
    "working"
  ]);
  var VALIDATOR_SESSION_KINDS = /* @__PURE__ */ new Set(["validator", "test", "fixture", "probe", "e2e", "throwaway"]);
  var TEST_SESSION_PATH_PATTERNS = [
    /(?:^|\/)cursor-test(?:\/|$)/i,
    /(?:^|\/)remote-agent-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway|switch-anchor)(?:-|\/|$)))[^/]+(?:\/|$)/i,
    /(?:^|\/)rac-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway)(?:-|\/|$)))[^/]+(?:\/|$)/i,
    /(?:^|\/)reply-with-exactly-rac-[^/]*(?:\/|$)/i
  ];
  function sessionIdOf2(session) {
    return typeof session === "string" ? session : session?.session_id || session?.id || "";
  }
  function sessionIsTestSession(session) {
    if (!session || typeof session !== "object") return false;
    if (session.is_test_session === false) return false;
    if (session.is_test_session === true || session.is_test_session === 1 || session.is_test_session === "true" || session.validator_session === true) return true;
    if (VALIDATOR_SESSION_KINDS.has(String(session.session_kind || session.session_class || "").trim().toLowerCase())) return true;
    const pathProbe = String(session.workspace_path || session.project_root || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
    if (TEST_SESSION_PATH_PATTERNS.some((pattern) => pattern.test(pathProbe))) return true;
    const identityProbe = [session.workspace_name, session.display_name, session.window_title, session.chat_title].filter(Boolean).join("/").toLowerCase();
    return /(?:^|[\s/_-])(?:validator|fixture|throwaway)(?:$|[\s/_-])/i.test(identityProbe);
  }
  function timestampMs2(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function latestMessageTimestamp(messages) {
    return (Array.isArray(messages) ? messages : []).reduce((latest, message) => Math.max(
      latest,
      timestampMs2(message?.ts ?? message?.timestamp ?? message?.created_at ?? message?.updated_at)
    ), 0);
  }
  function sidebarSessionState(session, options = {}) {
    const id = sessionIdOf2(session);
    const sourceActivity = options.activities?.[id] || (typeof session === "object" ? session.activity : null) || { kind: "idle" };
    const thinking = !!options.thinking?.[id];
    const activity = thinking && !sourceActivity.generating ? { ...sourceActivity, kind: ACTIVE_ACTIVITY_KINDS.has(String(sourceActivity.kind || "").toLowerCase()) ? sourceActivity.kind : "thinking", generating: true } : sourceActivity;
    const needsAttention = !!options.pendingPrompts?.[id] || !!options.errorPrompts?.[id] || typeof session === "object" && session.rate_limit_active === true;
    return classifyFleetActivity(activity, needsAttention, {
      connected: options.connected,
      health: options.health?.[id] || options.healthMap?.[id],
      nowMs: options.nowMs,
      freshnessMs: options.freshnessMs,
      requireFreshness: options.requireFreshness === true
    });
  }
  function partitionSidebarSessionsByWorking(sessions, options = {}) {
    const working = [];
    const nonWorking = [];
    const states = {};
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const id = sessionIdOf2(session);
      if (!id) continue;
      const state = sidebarSessionState(session, options);
      states[id] = state;
      (fleetStateIsWorking(state) ? working : nonWorking).push(session);
    }
    return { working, nonWorking, states };
  }
  function createSidebarWorkingLedger(workingSessions, options = {}) {
    const sessions = Array.isArray(workingSessions) ? workingSessions : [];
    const sessionOrder = sessions.map(sessionIdOf2).filter(Boolean);
    return {
      version: 1,
      revision: Number(options.revision || 0),
      sessionOrder,
      fallbackSessionById: Object.fromEntries(sessions.map((session) => [sessionIdOf2(session), session]).filter(([id]) => id))
    };
  }
  function reconcileSidebarWorkingLedger(ledger, workingSessions, options = {}) {
    const sessions = Array.isArray(workingSessions) ? workingSessions : [];
    const sourceById = Object.fromEntries(sessions.map((session) => [sessionIdOf2(session), session]).filter(([id]) => id));
    const desiredIds = Object.keys(sourceById);
    const current = ledger?.version === 1 ? ledger : createSidebarWorkingLedger(sessions, options);
    const currentIds = Array.isArray(current.sessionOrder) ? current.sessionOrder : [];
    const membershipChanged = desiredIds.length !== currentIds.length || desiredIds.some((id) => !currentIds.includes(id));
    if (!membershipChanged) {
      return {
        ledger: current,
        sessions: currentIds.map((id) => sourceById[id] || current.fallbackSessionById?.[id]).filter(Boolean),
        structuralChanged: false,
        deferred: false
      };
    }
    if (options.freezeStructure) {
      return {
        ledger: current,
        sessions: currentIds.map((id) => sourceById[id] || current.fallbackSessionById?.[id]).filter(Boolean),
        structuralChanged: true,
        deferred: true
      };
    }
    const desiredSet = new Set(desiredIds);
    const sessionOrder = currentIds.filter((id) => desiredSet.has(id));
    for (const id of desiredIds) {
      if (!sessionOrder.includes(id)) sessionOrder.push(id);
    }
    const next = {
      version: 1,
      revision: Number(current.revision || 0) + 1,
      sessionOrder,
      fallbackSessionById: Object.fromEntries(sessionOrder.map((id) => [
        id,
        sourceById[id] || current.fallbackSessionById?.[id]
      ]).filter(([, session]) => !!session))
    };
    return {
      ledger: next,
      sessions: sessionOrder.map((id) => sourceById[id] || next.fallbackSessionById[id]).filter(Boolean),
      structuralChanged: true,
      deferred: false
    };
  }
  function sidebarSessionRank(session, options = {}) {
    const id = sessionIdOf2(session);
    const activity = options.activities?.[id] || (typeof session === "object" ? session.activity : null) || null;
    const state = sidebarSessionState(session, options);
    const hasPrompt = state === "needs_attention";
    const active = fleetStateIsWorking(state);
    const messageTimestamp = Math.max(
      timestampMs2(options.lastMessageAt?.[id]),
      latestMessageTimestamp(options.messages?.[id])
    );
    const fallbackTimestamp = Math.max(
      timestampMs2(activity?.updatedAt ?? activity?.updated_at),
      timestampMs2(activity?.startedAt ?? activity?.started_at),
      timestampMs2(typeof session === "object" ? session.last_message_at : null),
      timestampMs2(typeof session === "object" ? session.last_seen_at : null),
      timestampMs2(typeof session === "object" ? session.created_at : null)
    );
    return {
      id,
      tier: hasPrompt ? 2 : active && options.rankWorking !== false ? 1 : 0,
      recency: messageTimestamp || fallbackTimestamp
    };
  }
  function orderSidebarGroups(groups, options = {}) {
    const previousGroups = new Map((options.previousGroupOrder || []).map((key, index) => [key, index]));
    const previousSessions = new Map((options.previousSessionOrder || []).map((id, index) => [id, index]));
    const stableGroupPosition = (key, fallback) => previousGroups.has(key) ? previousGroups.get(key) : previousGroups.size + fallback;
    const stableSessionPosition = (id, fallback) => previousSessions.has(id) ? previousSessions.get(id) : previousSessions.size + fallback;
    const ranked = (Array.isArray(groups) ? groups : []).map((group, groupIndex) => {
      const sessions = (group.sessions || []).map((session, sessionIndex) => ({
        session,
        sessionIndex,
        ...sidebarSessionRank(session, options)
      })).sort((left, right) => right.tier - left.tier || right.recency - left.recency || stableSessionPosition(left.id, left.sessionIndex) - stableSessionPosition(right.id, right.sessionIndex) || left.id.localeCompare(right.id));
      return {
        group: { ...group, sessions: sessions.map((row) => row.session) },
        groupIndex,
        tier: sessions.reduce((highest, row) => Math.max(highest, row.tier), 0),
        recency: sessions.reduce((latest, row) => Math.max(latest, row.recency), 0)
      };
    });
    ranked.sort((left, right) => right.tier - left.tier || right.recency - left.recency || stableGroupPosition(left.group.key, left.groupIndex) - stableGroupPosition(right.group.key, right.groupIndex) || left.group.key.localeCompare(right.group.key));
    return ranked.map((row) => row.group);
  }
  function sidebarOrderSnapshot(groups) {
    return {
      groupOrder: (groups || []).map((group) => group.key),
      sessionOrder: (groups || []).flatMap((group) => (group.sessions || []).map(sessionIdOf2))
    };
  }
  function sidebarMembershipSignature(groups) {
    return (groups || []).flatMap((group) => (group.sessions || []).map((session) => `${group.key}:${sessionIdOf2(session)}`)).sort().join("|");
  }
  function sidebarGroupKey(group) {
    return String(group?.key || "unscoped");
  }
  function sidebarSourceIndex(groups) {
    const sessionById = {};
    const groupBySession = {};
    const groupMeta = {};
    for (const group of groups || []) {
      const key = sidebarGroupKey(group);
      groupMeta[key] = { ...group, sessions: [] };
      for (const session of group.sessions || []) {
        const id = sessionIdOf2(session);
        if (!id) continue;
        sessionById[id] = session;
        groupBySession[id] = key;
      }
    }
    return { sessionById, groupBySession, groupMeta };
  }
  function sidebarAppliedSnapshot(ledger) {
    return {
      groupOrder: [...ledger?.groupOrder || []],
      sessionOrder: [...ledger?.sessionOrder || []]
    };
  }
  function sidebarOrderKeysMatch(left, right) {
    return (left?.groupOrder || []).join("|") === (right?.groupOrder || []).join("|") && (left?.sessionOrder || []).join("|") === (right?.sessionOrder || []).join("|");
  }
  function preferredSidebarSnapshot(groups, options = {}, ledger = null) {
    return sidebarOrderSnapshot(orderSidebarGroups(groups, {
      ...options,
      previousGroupOrder: ledger?.groupOrder || options.previousGroupOrder,
      previousSessionOrder: ledger?.sessionOrder || options.previousSessionOrder
    }));
  }
  function createSidebarOrderLedger(groups, options = {}) {
    const ordered = orderSidebarGroups(groups, options);
    const source = sidebarSourceIndex(ordered);
    const snapshot = sidebarOrderSnapshot(ordered);
    return {
      version: 1,
      revision: Number(options.revision || 0),
      groupOrder: snapshot.groupOrder,
      sessionOrder: snapshot.sessionOrder,
      groupBySession: source.groupBySession,
      groupMeta: source.groupMeta,
      fallbackSessionById: source.sessionById,
      sourceMembership: sidebarMembershipSignature(groups)
    };
  }
  function projectSidebarOrderLedger(ledger, groups) {
    const source = sidebarSourceIndex(groups);
    const grouped = new Map((ledger?.groupOrder || []).map((key) => [key, []]));
    for (const id of ledger?.sessionOrder || []) {
      const key = ledger.groupBySession?.[id];
      if (!key || !grouped.has(key)) continue;
      const session = source.sessionById[id] || ledger.fallbackSessionById?.[id];
      if (session) grouped.get(key).push(session);
    }
    return (ledger?.groupOrder || []).map((key) => ({
      ...source.groupMeta[key] || ledger.groupMeta?.[key] || { key },
      key,
      sessions: grouped.get(key) || []
    })).filter((group) => group.sessions.length > 0);
  }
  function sidebarPreferredOrderChanged(ledger, groups, options = {}) {
    const preferred = preferredSidebarSnapshot(groups, options, ledger);
    if (!sidebarOrderKeysMatch(sidebarAppliedSnapshot(ledger), preferred)) return true;
    const source = sidebarSourceIndex(groups);
    return Object.entries(source.groupBySession).some(([id, key]) => ledger.groupBySession?.[id] !== key);
  }
  function reconcileSidebarOrderLedger(ledger, groups, options = {}) {
    const current = ledger?.version === 1 ? ledger : createSidebarOrderLedger(groups, options);
    const sourceMembership = sidebarMembershipSignature(groups);
    if ((current.sessionOrder || []).length === 0 && sourceMembership) {
      const cold = createSidebarOrderLedger(groups, {
        ...options,
        revision: Number(current.revision || 0) + 1
      });
      return {
        ledger: cold,
        groups: projectSidebarOrderLedger(cold, groups),
        orderChanged: false,
        structuralChanged: true,
        deferred: false
      };
    }
    if (sourceMembership === current.sourceMembership) {
      return {
        ledger: current,
        groups: projectSidebarOrderLedger(current, groups),
        orderChanged: sidebarPreferredOrderChanged(current, groups, options),
        structuralChanged: false,
        deferred: false
      };
    }
    if (options.freezeStructure) {
      return {
        ledger: current,
        groups: projectSidebarOrderLedger(current, groups),
        orderChanged: true,
        structuralChanged: true,
        deferred: true
      };
    }
    const source = sidebarSourceIndex(groups);
    const presentIds = new Set(Object.keys(source.sessionById));
    const groupBySession = {};
    const sessionOrder = [];
    const groupOrder = [];
    const groupMeta = { ...current.groupMeta || {} };
    const fallbackSessionById = {};
    for (const id of current.sessionOrder || []) {
      if (!presentIds.has(id)) continue;
      sessionOrder.push(id);
      groupBySession[id] = current.groupBySession?.[id] || source.groupBySession[id];
      fallbackSessionById[id] = source.sessionById[id];
    }
    for (const group of groups || []) {
      const key = sidebarGroupKey(group);
      for (const session of group.sessions || []) {
        const id = sessionIdOf2(session);
        if (!id || groupBySession[id]) continue;
        sessionOrder.push(id);
        groupBySession[id] = key;
        fallbackSessionById[id] = session;
        groupMeta[key] = { ...group, sessions: [] };
      }
    }
    for (const key of current.groupOrder || []) {
      if (sessionOrder.some((id) => groupBySession[id] === key)) groupOrder.push(key);
    }
    for (const id of sessionOrder) {
      const key = groupBySession[id];
      if (!groupOrder.includes(key)) groupOrder.push(key);
    }
    const next = {
      version: 1,
      revision: Number(current.revision || 0) + 1,
      groupOrder,
      sessionOrder,
      groupBySession,
      groupMeta,
      fallbackSessionById,
      sourceMembership
    };
    return {
      ledger: next,
      groups: projectSidebarOrderLedger(next, groups),
      orderChanged: sidebarPreferredOrderChanged(next, groups, options),
      structuralChanged: true,
      deferred: false
    };
  }
  function sortSidebarOrderLedger(ledger, groups, options = {}) {
    return createSidebarOrderLedger(groups, {
      ...options,
      previousGroupOrder: ledger?.groupOrder,
      previousSessionOrder: ledger?.sessionOrder,
      revision: Number(ledger?.revision || 0) + 1
    });
  }
  function normalizedDirectory(value) {
    const text = String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!text || text.toLowerCase() === "unknown") return null;
    if (!/^(?:[A-Za-z]:\/|\/\/|\/)/.test(text)) return null;
    return { key: text.toLowerCase(), path: text };
  }
  function directoryLabel(value) {
    const normalized = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized.split("/").filter(Boolean).pop() || "Unscoped";
  }
  function isSameOrChildPath(pathKey, rootKey) {
    return pathKey === rootKey || pathKey.startsWith(`${rootKey}/`);
  }
  function normalizedAliasProbe(value) {
    return directoryLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  function canonicalAliasKey(value) {
    return `alias:${String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }
  function normalizeGroupAliases(value) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.entries({ ...DEFAULT_GROUP_ALIASES, ...input }).filter(([pattern, title]) => String(pattern).trim() && String(title).trim()).map(([pattern, title]) => [String(pattern).trim(), String(title).trim()]));
  }
  function matchingGroupAlias(directory, session, groupAliases) {
    const explicit = session && typeof session === "object" ? session.group_alias || session.project_group || null : null;
    if (typeof explicit === "string" && explicit.trim()) {
      const title = explicit.trim();
      return { key: canonicalAliasKey(title), title };
    }
    if (!directory) return null;
    const probe = normalizedAliasProbe(directory.path);
    for (const [pattern, title] of Object.entries(normalizeGroupAliases(groupAliases))) {
      try {
        if (new RegExp(pattern, "i").test(probe)) {
          return { key: canonicalAliasKey(title), title };
        }
      } catch {
      }
    }
    return null;
  }
  function groupSessionsByDirectory(sessionList, agentConfigs = {}, groupAliases = DEFAULT_GROUP_ALIASES) {
    const sessions = Array.isArray(sessionList) ? sessionList : [];
    const explicitRoots = sessions.map((session) => normalizedDirectory(session && typeof session === "object" ? session.project_root : null)).filter(Boolean).sort((left, right) => right.key.length - left.key.length);
    const groups = [];
    const byKey = /* @__PURE__ */ new Map();
    for (const session of sessions) {
      const id = typeof session === "string" ? session : session?.session_id || session?.id;
      const config = id ? agentConfigs[id] : null;
      const explicitRoot = normalizedDirectory(session && typeof session === "object" ? session.project_root : null);
      const workspace = normalizedDirectory(session && typeof session === "object" ? session.workspace_path : null) || normalizedDirectory(config?.file_access_scope);
      const inheritedRoot = !explicitRoot && workspace ? explicitRoots.find((root) => isSameOrChildPath(workspace.key, root.key)) : null;
      const directory = explicitRoot || inheritedRoot || workspace;
      const alias = matchingGroupAlias(directory, session, groupAliases);
      const key = alias?.key || directory?.key || "unscoped";
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          label: alias?.title || (directory ? directoryLabel(directory.path) : "Unscoped"),
          path: directory?.path || null,
          sessions: []
        };
        byKey.set(key, group);
        groups.push(group);
      }
      group.sessions.push(session);
    }
    return groups;
  }

  // frontend/broadcast-send-policy.js
  var MAX_BROADCAST_SESSIONS = 20;
  var MAX_BROADCAST_CONTENT_CHARS = 65536;
  var BROADCAST_SEND_AGENT_TYPES = /* @__PURE__ */ new Set([
    "claude",
    "claude_cli",
    "claude-desktop",
    "codex",
    "codex_cli",
    "codex-desktop",
    "cursor",
    "cursor_cli",
    "gemini",
    "continue",
    "continue_yolo",
    "roo_code",
    "cline",
    "antigravity",
    "antigravity_panel",
    "antigravity-v2"
  ]);
  function sessionSupportsBroadcast(session, config = {}, health = "unknown", connected = true) {
    const sessionId = typeof session === "string" ? session : String(session?.session_id || session?.id || "");
    const agentType = typeof session === "object" ? String(session?.agent_type || config?.agent_type || "") : String(config?.agent_type || "");
    const capabilities = config?.capabilities || {};
    return !!sessionId && !!connected && BROADCAST_SEND_AGENT_TYPES.has(agentType) && health !== "disconnected" && session?.disconnected !== true && session?.is_list_view !== true && capabilities.send !== false && capabilities.send_message !== false && capabilities.message_send !== false;
  }
  function normalizeBroadcastRequest(request, canSendToSession = () => true) {
    const rawIds = Array.isArray(request?.session_ids) ? request.session_ids : [];
    const sessionIds = [...new Set(rawIds.map((value) => String(value || "").trim()).filter(Boolean))];
    const content = typeof request?.content === "string" ? request.content.trim() : "";
    if (sessionIds.length < 1 || sessionIds.length > MAX_BROADCAST_SESSIONS) {
      return { ok: false, error: `Select between 1 and ${MAX_BROADCAST_SESSIONS} sessions` };
    }
    if (!content || content.length > MAX_BROADCAST_CONTENT_CHARS) {
      return { ok: false, error: `Prompt must contain 1-${MAX_BROADCAST_CONTENT_CHARS} characters` };
    }
    const confirmation = `SEND TO ${sessionIds.length} SESSIONS`;
    if (request?.confirmation !== confirmation) {
      return { ok: false, error: "Broadcast confirmation does not match the selected session count" };
    }
    const unsupported = sessionIds.filter((sessionId) => !canSendToSession(sessionId));
    if (unsupported.length) return { ok: false, error: "One or more selected sessions cannot receive messages", unsupported };
    return { ok: true, sessionIds, content, confirmation };
  }
  function createBroadcastReceiptState(sessionIds) {
    return Object.fromEntries(sessionIds.map((sessionId) => [sessionId, { status: "queued", error: null }]));
  }

  // frontend/title-disclosure.jsx
  var { useEffect: useEffect2, useLayoutEffect, useRef: useRef2, useState: useState2 } = React;
  var VIEWPORT_MARGIN = 12;
  var SIDEBAR_GAP = 10;
  var MAX_WIDTH = 360;
  var MIN_DESKTOP_WIDTH = 210;
  var TOUCH_HOLD_MS = 450;
  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  }
  function safeDisclosureId(value) {
    return `title-disclosure-${String(value || "title").replace(/[^a-z0-9_-]+/gi, "-")}`;
  }
  function FullTitleDisclosure({
    title,
    disclosureKey,
    kind = "title",
    wrapperClassName,
    triggerClassName,
    disclosureClassName,
    triggerLabel,
    triggerTag = "button"
  }) {
    const triggerRef = useRef2(null);
    const disclosureRef = useRef2(null);
    const touchTimerRef = useRef2(null);
    const stateRef = useRef2({ focused: false, hovered: false, latched: false });
    const [open, setOpen] = useState2(false);
    const [latched, setLatched] = useState2(false);
    const [placement, setPlacement] = useState2(null);
    const disclosureId = safeDisclosureId(`${kind}-${disclosureKey}`);
    const Trigger = triggerTag;
    function syncOpen() {
      const state = stateRef.current;
      setOpen(state.focused || state.hovered || state.latched);
    }
    function closeDisclosure({ restoreFocus = false } = {}) {
      stateRef.current = { focused: false, hovered: false, latched: false };
      setLatched(false);
      setPlacement(null);
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    }
    function latchDisclosure() {
      stateRef.current.latched = true;
      setLatched(true);
      setOpen(true);
    }
    function clearTouchTimer() {
      if (!touchTimerRef.current) return;
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    useEffect2(() => () => clearTouchTimer(), []);
    useEffect2(() => {
      if (!open || !latched) return void 0;
      const dismiss = (event) => {
        if (triggerRef.current?.contains(event.target) || disclosureRef.current?.contains(event.target)) return;
        closeDisclosure();
      };
      document.addEventListener("pointerdown", dismiss, true);
      return () => document.removeEventListener("pointerdown", dismiss, true);
    }, [open, latched]);
    useLayoutEffect(() => {
      if (!open) return void 0;
      let frame = null;
      const updatePlacement = () => {
        frame = null;
        const trigger = triggerRef.current;
        const disclosure = disclosureRef.current;
        if (!trigger || !disclosure) return;
        const anchor = trigger.getBoundingClientRect();
        if (anchor.bottom <= 0 || anchor.top >= window.innerHeight || anchor.right <= 0 || anchor.left >= window.innerWidth) {
          closeDisclosure();
          return;
        }
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
        const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches === true || viewportWidth <= 640;
        const rightEdge = Math.max(anchor.right, sidebar?.right || anchor.right);
        const availableRight = viewportWidth - rightEdge - SIDEBAR_GAP - VIEWPORT_MARGIN;
        const measuredHeight = disclosure.getBoundingClientRect().height;
        if (!coarsePointer && availableRight >= MIN_DESKTOP_WIDTH) {
          const width = Math.min(MAX_WIDTH, availableRight);
          const top = clamp(anchor.top, VIEWPORT_MARGIN, viewportHeight - measuredHeight - VIEWPORT_MARGIN);
          setPlacement({
            mode: "right",
            left: rightEdge + SIDEBAR_GAP,
            top,
            width
          });
          return;
        }
        setPlacement({
          mode: "sheet",
          bottom: VIEWPORT_MARGIN,
          left: VIEWPORT_MARGIN,
          width: Math.min(MAX_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2)
        });
      };
      const schedulePlacement = () => {
        if (frame !== null) return;
        frame = requestAnimationFrame(updatePlacement);
      };
      schedulePlacement();
      window.addEventListener("resize", schedulePlacement);
      document.addEventListener("scroll", schedulePlacement, true);
      return () => {
        if (frame !== null) cancelAnimationFrame(frame);
        window.removeEventListener("resize", schedulePlacement);
        document.removeEventListener("scroll", schedulePlacement, true);
      };
    }, [open, title]);
    const triggerProps = {
      ref: triggerRef,
      className: triggerClassName,
      role: triggerTag === "button" ? void 0 : "button",
      type: triggerTag === "button" ? "button" : void 0,
      tabIndex: triggerTag === "button" ? void 0 : 0,
      "aria-label": triggerLabel,
      "aria-describedby": open ? disclosureId : void 0,
      "aria-expanded": open,
      onPointerEnter: (event) => {
        if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") return;
        stateRef.current.hovered = true;
        syncOpen();
      },
      onPointerLeave: (event) => {
        if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") return;
        stateRef.current.hovered = false;
        syncOpen();
      },
      onPointerDown: (event) => {
        if (event.pointerType !== "touch") return;
        clearTouchTimer();
        touchTimerRef.current = setTimeout(() => {
          touchTimerRef.current = null;
          latchDisclosure();
        }, TOUCH_HOLD_MS);
      },
      onPointerUp: clearTouchTimer,
      onPointerCancel: clearTouchTimer,
      onFocus: () => {
        stateRef.current.focused = true;
        syncOpen();
      },
      onBlur: () => {
        stateRef.current.focused = false;
        syncOpen();
      },
      onClick: (event) => {
        event.stopPropagation();
        latchDisclosure();
      },
      onContextMenu: (event) => {
        event.preventDefault();
        event.stopPropagation();
        latchDisclosure();
      },
      onKeyDown: (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDisclosure({ restoreFocus: true });
          return;
        }
        if (triggerTag !== "button" && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          latchDisclosure();
        }
      }
    };
    const resolvedPlacement = placement || {
      mode: "measuring",
      left: -1e4,
      top: VIEWPORT_MARGIN,
      width: MAX_WIDTH
    };
    const portal = open && ReactDOM.createPortal(
      /* @__PURE__ */ React.createElement(
        "div",
        {
          ref: disclosureRef,
          id: disclosureId,
          className: `title-disclosure-portal ${disclosureClassName || ""}`.trim(),
          role: "tooltip",
          "data-title-disclosure-for": disclosureKey,
          "data-title-disclosure-kind": kind,
          "data-placement": resolvedPlacement.mode,
          style: {
            left: `${resolvedPlacement.left}px`,
            top: resolvedPlacement.top == null ? "auto" : `${resolvedPlacement.top}px`,
            bottom: resolvedPlacement.bottom == null ? "auto" : `${resolvedPlacement.bottom}px`,
            width: resolvedPlacement.mode === "sheet" ? `${resolvedPlacement.width}px` : "max-content",
            maxWidth: `${resolvedPlacement.width}px`,
            minWidth: `${Math.min(MIN_DESKTOP_WIDTH, resolvedPlacement.width)}px`
          }
        },
        title
      ),
      document.body
    );
    return /* @__PURE__ */ React.createElement("div", { className: wrapperClassName }, /* @__PURE__ */ React.createElement(Trigger, { ...triggerProps }, title), portal);
  }

  // frontend/provider-usage.js
  var STATUS_RANK = Object.freeze({
    unavailable: 6,
    auth_required: 5,
    rate_limited: 4,
    stale: 3,
    refreshing: 2,
    fresh: 1
  });
  function finitePercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
  }
  function finiteNumber2(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  function normalizePace(value) {
    if (!value || typeof value !== "object") return null;
    const category = ["slow", "steady", "racing", "burning"].includes(value.category) ? value.category : "";
    const expectedUsedPercent = finitePercent(value.expected_used_percent);
    if (!category || expectedUsedPercent == null) return null;
    const budgets = value.budget_percent && typeof value.budget_percent === "object" ? Object.fromEntries(["now", "next_hour", "next_five_hours", "today"].map((key) => [key, finitePercent(value.budget_percent[key]) ?? 0])) : null;
    return {
      stage: String(value.stage || ""),
      category,
      expectedUsedPercent,
      actualUsedPercent: finitePercent(value.actual_used_percent),
      deltaPercent: finiteNumber2(value.delta_percent),
      projectedUsedPercent: finitePercent(value.projected_used_at_reset_percent),
      exhaustionAt: value.exhaustion_at ? String(value.exhaustion_at) : "",
      willLastToReset: value.will_last_to_reset === true,
      budgets
    };
  }
  function normalizedWindow(window2, index) {
    const usedPercent = finitePercent(window2?.used_percent);
    const status = String(window2?.status || (usedPercent == null ? "unavailable" : "available"));
    if (usedPercent == null && status !== "unavailable") return null;
    const warningThreshold = finitePercent(window2?.thresholds?.warning_percent) ?? 80;
    const criticalThreshold = Math.max(warningThreshold, finitePercent(window2?.thresholds?.critical_percent) ?? 90);
    const normalized = {
      id: String(window2?.id || `window-${index + 1}`),
      label: String(window2?.label || "Usage"),
      scope: window2?.scope ? String(window2.scope) : "",
      modelScope: window2?.model_scope && typeof window2.model_scope === "object" ? {
        id: String(window2.model_scope.id || ""),
        label: String(window2.model_scope.label || "")
      } : null,
      usedPercent,
      remainingPercent: finiteNumber2(window2?.remaining_percent) ?? (usedPercent == null ? null : 100 - usedPercent),
      visualPercent: finitePercent(window2?.visual_percent) ?? (usedPercent == null ? null : Math.min(100, usedPercent)),
      durationMinutes: Number.isFinite(Number(window2?.duration_minutes)) ? Number(window2.duration_minutes) : null,
      startsAt: window2?.starts_at ? String(window2.starts_at) : "",
      resetsAt: window2?.resets_at ? String(window2.resets_at) : "",
      resetDescription: window2?.reset_description ? String(window2.reset_description) : "",
      windowKind: window2?.window_kind ? String(window2.window_kind) : "",
      source: window2?.source ? String(window2.source) : "",
      provenance: window2?.provenance ? String(window2.provenance) : "",
      freshnessStatus: window2?.freshness_status ? String(window2.freshness_status) : "",
      status,
      error: window2?.error && typeof window2.error === "object" ? window2.error : null,
      thresholds: { warningPercent: warningThreshold, criticalPercent: criticalThreshold },
      pace: normalizePace(window2?.pace)
    };
    normalized.tone = usedPercent == null ? "unavailable" : usedPercent >= criticalThreshold || usedPercent >= 100 ? "critical" : usedPercent >= warningThreshold ? "warning" : "ok";
    return normalized;
  }
  function providerUsageTone(entry) {
    if (entry?.status === "auth_required" || entry?.status === "unavailable") return "unavailable";
    if (entry?.status === "rate_limited") return "stale";
    const tones = new Set((entry?.windows || []).map((window2) => window2.tone));
    const maximum = Math.max(-1, ...(entry?.windows || []).map((window2) => window2.usedPercent ?? -1));
    if (tones.has("critical")) return "critical";
    if (tones.has("warning")) return "warning";
    if (entry?.status === "stale") return "stale";
    return maximum >= 0 ? "ok" : "unknown";
  }
  function normalizeEntry(snapshot, index) {
    const windows = (Array.isArray(snapshot?.windows) ? snapshot.windows : []).map(normalizedWindow).filter(Boolean).sort((left, right) => right.usedPercent - left.usedPercent || left.label.localeCompare(right.label));
    const entry = {
      key: `${snapshot?.provider_id || "provider"}:${snapshot?.account_fingerprint || index}:${snapshot?.quota_domain || "quota"}`,
      providerId: String(snapshot?.provider_id || "unknown"),
      providerName: String(snapshot?.provider_name || "Provider"),
      quotaDomain: String(snapshot?.quota_domain || ""),
      dashboardUrl: snapshot?.dashboard_url ? String(snapshot.dashboard_url) : "",
      accountFingerprint: String(snapshot?.account_fingerprint || ""),
      accountLabel: String(snapshot?.account_label || "Local account"),
      plan: snapshot?.plan ? String(snapshot.plan) : "",
      source: snapshot?.source ? String(snapshot.source) : "",
      sourceHistory: Array.isArray(snapshot?.source_history) ? snapshot.source_history : [],
      status: String(snapshot?.status || "unavailable"),
      capturedAt: snapshot?.captured_at ? String(snapshot.captured_at) : "",
      staleAfter: snapshot?.stale_after ? String(snapshot.stale_after) : "",
      lastGoodCapturedAt: snapshot?.last_good_captured_at ? String(snapshot.last_good_captured_at) : "",
      windows,
      credits: snapshot?.credits && typeof snapshot.credits === "object" ? snapshot.credits : null,
      resetCredits: snapshot?.reset_credits && typeof snapshot.reset_credits === "object" ? snapshot.reset_credits : null,
      error: snapshot?.error && typeof snapshot.error === "object" ? snapshot.error : null,
      requestCount: Math.max(0, Number(snapshot?.request_count) || 0),
      latencyMs: Number.isFinite(Number(snapshot?.latency_ms)) ? Number(snapshot.latency_ms) : null,
      sessionCount: Math.max(0, Number(snapshot?.session_count) || 0),
      harnessTypes: Array.isArray(snapshot?.mapped_harness_types) ? snapshot.mapped_harness_types.map(String).sort() : []
    };
    entry.tone = providerUsageTone(entry);
    entry.maximumUsedPercent = windows.length > 0 ? Math.max(...windows.map((window2) => window2.usedPercent)) : null;
    return entry;
  }
  function normalizeProviderUsage(payload) {
    const candidates = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
    const deduplicated = /* @__PURE__ */ new Map();
    candidates.map(normalizeEntry).forEach((entry) => {
      const previous = deduplicated.get(entry.key);
      const previousTime = Date.parse(previous?.capturedAt || "") || 0;
      const nextTime = Date.parse(entry.capturedAt || "") || 0;
      if (!previous || nextTime >= previousTime) deduplicated.set(entry.key, entry);
    });
    const entries = [...deduplicated.values()].sort((left, right) => (STATUS_RANK[right.status] || 0) - (STATUS_RANK[left.status] || 0) || (right.maximumUsedPercent ?? -1) - (left.maximumUsedPercent ?? -1) || left.providerName.localeCompare(right.providerName) || left.accountLabel.localeCompare(right.accountLabel));
    const providerIds = new Set(entries.map((entry) => entry.providerId));
    const reporting = entries.filter((entry) => entry.windows.length > 0 || entry.credits || entry.resetCredits).length;
    const nearLimit = entries.filter((entry) => ["warning", "critical"].includes(entry.tone) && entry.maximumUsedPercent < 100).length;
    const exhausted = entries.filter((entry) => entry.maximumUsedPercent >= 100).length;
    const generation = Number(payload?.generation) || 0;
    const inFlight = payload?.in_flight === true;
    const freshEntries = entries.filter((entry) => entry.status === "fresh").length;
    const staleEntries = entries.filter((entry) => entry.status === "stale").length;
    const collectionState = inFlight ? "refreshing" : generation === 0 && entries.length === 0 ? "not-started" : entries.length === 0 ? "ready" : freshEntries === entries.length ? "ready" : freshEntries > 0 ? "partial" : staleEntries > 0 ? "stale" : "unavailable";
    return {
      schemaVersion: Number(payload?.schema_version) || 0,
      generation,
      generatedAt: payload?.generated_at ? String(payload.generated_at) : "",
      pollIntervalMs: Math.max(0, Number(payload?.poll_interval_ms) || 0),
      inFlight,
      collectionState,
      summaryAuthoritative: generation > 0 || entries.length > 0,
      estimatedCost: normalizeEstimatedCost(payload?.estimated_cost),
      entries,
      summary: {
        providers: providerIds.size,
        accounts: entries.length,
        reporting,
        nearLimit,
        exhausted
      }
    };
  }
  function costRows(value) {
    return Array.isArray(value) ? value.filter((row) => row && typeof row === "object").map((row) => ({ ...row })) : [];
  }
  function nullableNonnegative(value) {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
  }
  function normalizeEstimatedCost(value) {
    if (!value || typeof value !== "object") return null;
    return {
      schemaVersion: Number(value.schema_version) || 0,
      catalogVersion: String(value.catalog_version || ""),
      label: String(value.label || "Local estimated API-equivalent cost"),
      status: String(value.status || "unavailable"),
      generatedAt: value.generated_at ? String(value.generated_at) : "",
      range: value.range && typeof value.range === "object" ? value.range : { days: 365, since: "", until: "" },
      tokens: {
        input: nullableNonnegative(value.tokens?.input),
        cached: nullableNonnegative(value.tokens?.cached),
        output: nullableNonnegative(value.tokens?.output)
      },
      costUsd: nullableNonnegative(value.cost_usd),
      records: nullableNonnegative(value.records),
      byProvider: costRows(value.by_provider),
      byModel: costRows(value.by_model),
      byProject: costRows(value.by_project),
      byDay: costRows(value.by_day),
      bySpeed: costRows(value.by_speed),
      dailyBreakdown: costRows(value.daily_breakdown),
      unknownModels: costRows(value.unknown_models),
      scan: value.scan && typeof value.scan === "object" ? value.scan : {},
      reasonCode: String(value.reason_code || ""),
      reasonPath: String(value.reason_path || ""),
      lastGoodGeneratedAt: value.last_good_generated_at ? String(value.last_good_generated_at) : "",
      detail: value.detail && typeof value.detail === "object" ? {
        totalRows: Math.max(0, Number(value.detail.total_rows) || 0),
        inlineRows: Math.max(0, Number(value.detail.inline_rows) || 0),
        pageSize: Math.max(0, Number(value.detail.page_size) || 0),
        nextCursor: value.detail.next_cursor == null ? "" : String(value.detail.next_cursor),
        truncated: value.detail.truncated === true,
        collections: costRows(value.detail.collections)
      } : null
    };
  }
  function addCostRow(map, key, row, labelFields) {
    if (!map.has(key)) map.set(key, Object.fromEntries(labelFields.map((field) => [field, row[field]])));
    const target = map.get(key);
    target.input = (Number(target.input) || 0) + (Number(row.input) || 0);
    target.cached = (Number(target.cached) || 0) + (Number(row.cached) || 0);
    target.output = (Number(target.output) || 0) + (Number(row.output) || 0);
    target.cost_usd = (Number(target.cost_usd) || 0) + (Number(row.cost_usd) || 0);
    target.records = (Number(target.records) || 0) + (Number(row.records) || 0);
  }
  function selectEstimatedCost(cost, options = {}) {
    if (!cost) return null;
    const days = Math.max(1, Math.min(365, Number(options.days) || 1));
    const untilMs = Date.parse(`${cost.range?.until || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const sinceMs = untilMs - (days - 1) * 24 * 60 * 60 * 1e3;
    const rows = cost.dailyBreakdown.filter((row) => {
      const dayMs = Date.parse(`${row.day}T00:00:00.000Z`);
      return Number.isFinite(dayMs) && dayMs >= sinceMs && dayMs <= untilMs && (!options.project || row.project === options.project) && (!options.providerId || row.provider_id === options.providerId);
    });
    const groups = { provider: /* @__PURE__ */ new Map(), model: /* @__PURE__ */ new Map(), project: /* @__PURE__ */ new Map(), day: /* @__PURE__ */ new Map(), speed: /* @__PURE__ */ new Map() };
    const total = { input: 0, cached: 0, output: 0, cost_usd: 0, records: 0 };
    rows.forEach((row) => {
      addCostRow(/* @__PURE__ */ new Map([["total", total]]), "total", row, []);
      addCostRow(groups.provider, row.provider_id, row, ["provider_id"]);
      addCostRow(groups.model, `${row.provider_id}|${row.model}`, row, ["provider_id", "model"]);
      addCostRow(groups.project, `${row.provider_id}|${row.project}`, row, ["provider_id", "project"]);
      addCostRow(groups.day, row.day, row, ["day"]);
      addCostRow(groups.speed, row.speed, row, ["speed"]);
    });
    const values = (map) => [...map.values()].map((row) => ({ ...row, cost_usd: Number((row.cost_usd || 0).toFixed(8)) }));
    return {
      days,
      tokens: { input: total.input, cached: total.cached, output: total.output },
      costUsd: Number(total.cost_usd.toFixed(8)),
      records: total.records,
      byProvider: values(groups.provider),
      byModel: values(groups.model),
      byProject: values(groups.project),
      byDay: values(groups.day),
      bySpeed: values(groups.speed)
    };
  }
  function formatProviderPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "Unavailable";
    return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
  }
  function formatProviderUsageAge(value, nowMs = Date.now()) {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return "Not yet refreshed";
    const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1e3));
    if (seconds < 10) return "Updated just now";
    if (seconds < 60) return `Updated ${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Updated ${minutes}m ago`;
    return `Updated ${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  }
  function formatProviderUsageReset(value, nowMs = Date.now()) {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return value ? String(value) : "";
    const deltaSeconds = Math.max(0, Math.floor((timestamp - nowMs) / 1e3));
    const minutes = Math.floor(deltaSeconds / 60);
    const countdown = deltaSeconds < 60 ? `${deltaSeconds}s` : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    const absolute = new Date(timestamp).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
    return `in ${countdown} (${absolute})`;
  }
  function formatProviderCredits(credits) {
    if (!credits || typeof credits !== "object") return "";
    if (credits.unlimited === true) return "Unlimited credits";
    if (credits.unit && Number.isFinite(Number(credits.balance))) return `${credits.balance} ${credits.unit}`;
    const currency = credits.currency === "USD" ? "$" : credits.currency ? `${credits.currency} ` : "";
    if (Number.isFinite(Number(credits.balance))) return `${currency}${Number(credits.balance).toFixed(2)} balance`;
    if (Number.isFinite(Number(credits.used)) && (Number.isFinite(Number(credits.included)) || Number.isFinite(Number(credits.bonus)))) {
      const parts = [`${currency}${Number(credits.used).toFixed(2)} used`];
      if (Number.isFinite(Number(credits.included))) parts.push(`${currency}${Number(credits.included).toFixed(2)} included`);
      if (Number.isFinite(Number(credits.bonus))) parts.push(`${currency}${Number(credits.bonus).toFixed(2)} bonus`);
      return parts.join(" \xB7 ");
    }
    if (Number.isFinite(Number(credits.used)) && Number.isFinite(Number(credits.limit))) {
      return `${currency}${Number(credits.used).toFixed(2)} of ${currency}${Number(credits.limit).toFixed(2)} used`;
    }
    return credits.enabled === false ? "Extra usage disabled" : "";
  }

  // frontend/app.jsx
  var import_fleet_work_context = __toESM(require_fleet_work_context());
  var {
    goalLifecycleSupported,
    latestUserRequestFromMessages,
    projectFleetWorkContext
  } = import_fleet_work_context.default;
  var { useState: useState3, useRef: useRef3, useEffect: useEffect3, useLayoutEffect: useLayoutEffect2 } = React;
  var DRAFT_STORAGE_KEY = "remote-agent-chat:drafts:v1";
  var SHOW_TEST_SESSIONS_STORAGE_KEY = "remote-agent-chat:show-test-sessions:v1";
  var DEFAULT_INITIAL_HISTORY_LIMIT = 120;
  var CODEX_INITIAL_HISTORY_LIMIT = 500;
  var CODEX_CLI_INITIAL_HISTORY_LIMIT = 160;
  var CODEX_CLI_INITIAL_HISTORY_CHUNK_BYTES = 256 * 1024;
  var EMPTY_MESSAGES = Object.freeze([]);
  var SLASH_COMMANDS = [
    { command: "/plan", detail: "Outline the implementation approach and major steps." },
    { command: "/review", detail: "Review the current changes for bugs, regressions, and missing tests." },
    { command: "/fix", detail: "Implement or repair the current issue." },
    { command: "/summarize", detail: "Summarize the current state and important changes." }
  ];
  var AGENT_CONFIG = {
    claude: { name: "Claude Code", color: "#cc785c", abbr: "CC", logo: "/logo-claude-in-ag.svg" },
    claude_cli: { name: "Claude Code CLI", color: "#d97757", abbr: "CLI", logo: "/logo-claude-in-ag.svg" },
    "claude-desktop": { name: "Claude Desktop", color: "#cc785c", abbr: "CD", logo: "/logo-claude-in-ag.svg" },
    codex: { name: "Codex", color: "#10a37f", abbr: "CX", logo: "/logo-codex-in-ag.svg" },
    codex_cli: { name: "Codex CLI", color: "#10a37f", abbr: "CLI", logo: "/logo-codex.svg" },
    "codex-desktop": { name: "Codex Desktop", color: "#10a37f", abbr: "CX", logo: "/logo-codex.svg" },
    cursor: { name: "Cursor", color: "#7AA2F7", abbr: "CR", logo: "/logo-cursor.svg" },
    cursor_cli: { name: "Cursor CLI", color: "#7c6cf0", abbr: "CLI", logo: "/logo-cursor.svg" },
    gemini: { name: "Gemini", color: "#4285f4", abbr: "GC", logo: "/logo-gemini-in-ag.svg" },
    continue: { name: "Continue", color: "#d29922", abbr: "CN", logo: "/logo-continue.png" },
    continue_yolo: { name: "Continue YOLO", color: "#f59e0b", abbr: "CY", logo: "/logo-continue.png" },
    roo_code: { name: "Roo Code", color: "#06b6d4", abbr: "RC", logo: "/logo-continue.png" },
    cline: { name: "Cline", color: "#6366f1", abbr: "CL", logo: "/logo-cline.svg" },
    antigravity: { name: "Antigravity", color: "#a855f7", abbr: "AG", logo: "/logo-antigravity.svg" },
    antigravity_panel: { name: "Antigravity Chat", color: "#a855f7", abbr: "AC", logo: "/logo-antigravity.svg" },
    "antigravity-v2": { name: "Antigravity v2", color: "#7c3aed", abbr: "A2", logo: null }
  };
  var DEFAULT_AGENT = { name: "Agent", color: "#8b949e", abbr: "AG" };
  function isContinueLikeAgentType(agentType) {
    return agentType === "continue" || agentType === "continue_yolo";
  }
  function isClineLikeAgentType(agentType) {
    return agentType === "cline" || agentType === "roo_code";
  }
  function isCodexTranscriptAgentType(agentType) {
    return agentType === "codex" || agentType === "codex-desktop";
  }
  function historyLimitForAgentType(agentType) {
    if (agentType === "codex_cli" || agentType === "cursor_cli") return CODEX_CLI_INITIAL_HISTORY_LIMIT;
    if (isCodexTranscriptAgentType(agentType)) return CODEX_INITIAL_HISTORY_LIMIT;
    return DEFAULT_INITIAL_HISTORY_LIMIT;
  }
  function safeString(value, fallback = "") {
    if (typeof value === "string") return value;
    if (value == null) return fallback;
    return String(value);
  }
  function normalizeMessageContent(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
        if (typeof part.url === "string") return part.url;
        if (typeof part.image_url === "string") return part.image_url;
        return "";
      }).filter(Boolean).join(" ");
    }
    if (content && typeof content === "object") {
      if (typeof content.text === "string") return content.text;
      if (typeof content.content === "string") return content.content;
      if (typeof content.url === "string") return content.url;
      if (typeof content.image_url === "string") return content.image_url;
      try {
        return JSON.stringify(content);
      } catch {
        return "";
      }
    }
    return "";
  }
  function stableContentHash(value) {
    const text = typeof value === "string" ? value : safeString(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function messageIdentityKey(msg, fallbackIndex = 0) {
    if (!msg || typeof msg !== "object") return `empty:${fallbackIndex}`;
    if (msg._cid) return `cid:${msg._cid}`;
    if (msg.source_message_id) return `source:${msg.source_message_id}`;
    if (msg.native_source_id) return `native:${msg.native_source_id}`;
    if (msg.id != null) return `id:${msg.id}`;
    if (msg.server_message_id != null) return `server:${msg.server_message_id}`;
    if (msg.client_msg_id) return `client:${msg.client_msg_id}`;
    if (msg.sequence != null) return `seq:${msg.sequence}`;
    const content = normalizeMessageContent(msg.content) || contentBlocksFallback(msg.content_blocks);
    const blocks = Array.isArray(msg.content_blocks) ? JSON.stringify(msg.content_blocks) : "";
    return [
      "body",
      msg.role || "",
      msg.ts || "",
      stableContentHash(`${content}
${blocks}`)
    ].join(":");
  }
  function messageContentIdentityHash(msg) {
    const content = normalizeMessageContent(msg?.content) || contentBlocksFallback(msg?.content_blocks);
    const blocks = Array.isArray(msg?.content_blocks) ? JSON.stringify(msg.content_blocks) : "";
    return stableContentHash(`${content}
${blocks}`);
  }
  function topLevelMessageBlockType(msg) {
    if (msg?.role === "user") return "user";
    return normalizeContentBlocks(msg?.content_blocks)[0]?.type || "markdown";
  }
  function scrollIdentityKeysForMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    return list.map((msg, i) => messageIdentityKey(msg, i));
  }
  function setScrollTopInstant(element, value) {
    if (!element) return;
    const previous = element.style.scrollBehavior;
    element.style.scrollBehavior = "auto";
    element.scrollTop = value;
    requestAnimationFrame(() => {
      if (element.style.scrollBehavior === "auto") {
        element.style.scrollBehavior = previous;
      }
    });
  }
  function recoverUploadedImageMarkdown(content) {
    const text = normalizeMessageContent(content);
    const match = text.match(/^\[File: ([^\]]+?) [→\u2192] ([A-Za-z]:\\.+?\\uploads\\([^\\\]]+))\]$/);
    if (!match) return text;
    const [, originalName, , storedName] = match;
    if (!/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(originalName)) return text;
    return `![${originalName}](/uploads/${storedName})`;
  }
  function hasVisibleMessageContent(content) {
    return normalizeMessageContent(content).trim().length > 0;
  }
  function normalizeContentBlocks(blocks) {
    if (!Array.isArray(blocks)) return [];
    return blocks.filter((block) => block && typeof block === "object").map((block) => {
      const type = safeString(block.type || "markdown").toLowerCase();
      if (type === "code") {
        const lang = safeString(block.language || block.lang || "").trim();
        const content = normalizeMessageContent(block.content || block.text || block.markdown || "");
        return { ...block, type: "markdown", content: `\`\`\`${lang}
${content}
\`\`\`` };
      }
      if (type === "file_change") return { ...block, type: "file_changes" };
      if (type === "tool") return { ...block, type: "tool_call" };
      if (type === "tool_output" || type === "result") return { ...block, type: "tool_result" };
      if (type === "thought") return { ...block, type: "thinking" };
      if (type === "task_list") return { ...block, type: "plan" };
      if (type === "queue" || type === "queued") return { ...block, type: "queued_message" };
      if (type === "banner" || type === "notification") return { ...block, type: "notice" };
      if (type === "worked" || type === "activity") return { ...block, type: "status" };
      return block;
    });
  }
  function contentBlockText(block) {
    if (!block || typeof block !== "object") return "";
    const terminalParts = [
      block.workdir ? `cwd: ${block.workdir}` : null,
      block.command ? `$ ${block.command}` : null,
      block.stdout || null,
      block.stderr ? `stderr:
${block.stderr}` : null,
      block.exit_code != null ? `exit code: ${block.exit_code}` : null
    ].filter(Boolean);
    if (terminalParts.length) return terminalParts.join("\n\n");
    if (Array.isArray(block.files) && block.files.length > 0) {
      const files = block.files.map((file) => [
        file.path || file.file || "",
        file.added != null ? `+${file.added}` : "",
        file.removed != null ? `-${file.removed}` : ""
      ].filter(Boolean).join(" ")).filter(Boolean).join("\n");
      return [block.content || block.text || block.markdown || "", files].filter(Boolean).join("\n\n");
    }
    if (Array.isArray(block.tasks) && block.tasks.length > 0) {
      const tasks = block.tasks.map((task) => {
        const text = safeString(task?.text || task?.step || task?.title).trim();
        const state = safeString(task?.state || task?.status || "pending").trim();
        return text ? `[${state}] ${text}` : "";
      }).filter(Boolean).join("\n");
      return [block.content || "", tasks].filter(Boolean).join("\n");
    }
    return block.content || block.text || block.markdown || block.title || block.label || "";
  }
  function hasVisibleMessage(msg) {
    if (!msg) return false;
    if (hasVisibleMessageContent(msg.content)) return true;
    return normalizeContentBlocks(msg.content_blocks).some(
      (block) => normalizeMessageContent(contentBlockText(block)).trim().length > 0
    );
  }
  function contentBlocksFallback(blocks) {
    return normalizeContentBlocks(blocks).map((block) => normalizeMessageContent(contentBlockText(block))).filter(Boolean).join("\n\n");
  }
  function ContentBlockActions({ actions }) {
    if (!Array.isArray(actions) || actions.length === 0) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "content-block-actions" }, actions.map((action, actionIndex) => /* @__PURE__ */ React.createElement(
      "span",
      {
        key: action.id || actionIndex,
        className: `content-block-action-label${action.unsupported ? " unsupported" : ""}`,
        title: action.unsupported ? "This Codex control is visible in the source app but is not currently available from the web UI." : void 0
      },
      action.label || action.id || "Action"
    )));
  }
  var TRANSCRIPT_DISCLOSURE_CACHE_LIMIT = 512;
  var transcriptDisclosureState = /* @__PURE__ */ new Map();
  function rememberTranscriptDisclosure(stateKey, open) {
    if (!stateKey) return;
    transcriptDisclosureState.delete(stateKey);
    transcriptDisclosureState.set(stateKey, open);
    while (transcriptDisclosureState.size > TRANSCRIPT_DISCLOSURE_CACHE_LIMIT) {
      transcriptDisclosureState.delete(transcriptDisclosureState.keys().next().value);
    }
  }
  function TranscriptDisclosure({ className, summary, children, stateKey = "", defaultOpen = true }) {
    const [open, setOpen] = React.useState(() => stateKey && transcriptDisclosureState.has(stateKey) ? transcriptDisclosureState.get(stateKey) : defaultOpen);
    const handleToggle = React.useCallback((event) => {
      const nextOpen = event.currentTarget.open;
      setOpen(nextOpen);
      rememberTranscriptDisclosure(stateKey, nextOpen);
    }, [stateKey]);
    return /* @__PURE__ */ React.createElement(
      "details",
      {
        className,
        open,
        onToggle: handleToggle
      },
      /* @__PURE__ */ React.createElement("summary", null, summary),
      children
    );
  }
  function cursorFileChangeSummaryParts(value) {
    const match = safeString(value).trim().match(/^(Edited\s+\d+\s+files?)(?:\s+(\+\d+))?(?:\s+(-\d+))?$/i);
    if (!match) return null;
    return { label: match[1], additions: match[2] || "", deletions: match[3] || "" };
  }
  function ContentBlocks({
    blocks,
    monospace,
    autoExpandLongCodeBlocks,
    onOpenPath,
    agentType,
    richContentEager = true,
    richContentCacheIdentity = ""
  }) {
    const normalized = normalizeContentBlocks(blocks);
    if (normalized.length === 0) return null;
    const isCursor = safeString(agentType).toLowerCase() === "cursor";
    const isClaude = safeString(agentType).toLowerCase() === "claude";
    const isCodex = safeString(agentType).toLowerCase() === "codex";
    const isCodexDesktop = safeString(agentType).toLowerCase() === "codex-desktop";
    const isAntigravityV2 = safeString(agentType).toLowerCase() === "antigravity-v2";
    function blockBody(block) {
      const terminalParts = [
        block.workdir ? `cwd: ${block.workdir}` : null,
        block.command ? `$ ${block.command}` : null,
        block.stdout || null,
        block.stderr ? `stderr:
${block.stderr}` : null,
        block.exit_code != null ? `exit code: ${block.exit_code}` : null
      ].filter(Boolean);
      if (terminalParts.length) return terminalParts.join("\n\n");
      return normalizeMessageContent(block.content || block.text || block.markdown || "");
    }
    function richMarkdown(value, blockIndex) {
      return /* @__PURE__ */ React.createElement(
        MarkdownContent,
        {
          content: value,
          monospace,
          autoExpandLongCodeBlocks,
          onOpenPath,
          deferUntilVisible: !richContentEager,
          cacheIdentity: `${richContentCacheIdentity}:block:${blockIndex}`
        }
      );
    }
    return /* @__PURE__ */ React.createElement("div", { className: `content-blocks${isCursor ? " content-blocks-cursor" : ""}` }, normalized.map((block, index) => {
      const type = safeString(block.type || "markdown").toLowerCase();
      const title = safeString(block.title || block.label || block.summary || type);
      const body = blockBody(block);
      if (type === "status") {
        return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-status-chip", title }, title || "Status");
      }
      if (type === "thinking") {
        const bodyIsTitleOnly = !body || safeString(body).replace(/\s+/g, " ").trim() === title;
        if (isCodex) {
          const nativeThinkingBody = body && !bodyIsTitleOnly ? body : title && title.toLowerCase() !== "thinking" ? title : "";
          return nativeThinkingBody ? /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-thinking-native" }, richMarkdown(nativeThinkingBody, index)) : null;
        }
        if (isCodexDesktop && bodyIsTitleOnly) {
          return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-thinking-codex-desktop" }, /* @__PURE__ */ React.createElement("span", null, title || "Worked"), /* @__PURE__ */ React.createElement("span", { className: "content-block-thinking-codex-desktop-chevron", "aria-hidden": "true" }, "\u2304"));
        }
        if (isCodexDesktop) {
          return /* @__PURE__ */ React.createElement(TranscriptDisclosure, { key: index, stateKey: `${richContentCacheIdentity}:disclosure:${index}`, className: "content-block content-block-thinking-codex-desktop", summary: title || "Worked" }, richMarkdown(body, index));
        }
        if (isCursor && bodyIsTitleOnly) {
          return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-status-chip thinking", title }, title || "Thinking");
        }
        return /* @__PURE__ */ React.createElement(TranscriptDisclosure, { key: index, stateKey: `${richContentCacheIdentity}:disclosure:${index}`, className: "content-block content-block-thinking", summary: title || "Thinking" }, body && !bodyIsTitleOnly && richMarkdown(body, index));
      }
      if (type === "tool_call" || type === "tool_result") {
        const bodyIsTitleOnly = !body || safeString(body).replace(/\s+/g, " ").trim() === title;
        if (isCursor && bodyIsTitleOnly) {
          return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-status-chip tool", title }, title || "Tool");
        }
        return /* @__PURE__ */ React.createElement(TranscriptDisclosure, { key: index, stateKey: `${richContentCacheIdentity}:disclosure:${index}`, className: `content-block content-block-${type === "tool_result" ? "tool-result" : "tool"}`, summary: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", null, title || (type === "tool_result" ? "Tool result" : "Tool")), block.status && /* @__PURE__ */ React.createElement("span", { className: `content-block-status ${safeString(block.status).toLowerCase()}` }, block.status)) }, body && /* @__PURE__ */ React.createElement("pre", { className: "content-block-pre" }, body), /* @__PURE__ */ React.createElement(ContentBlockActions, { actions: block.actions }));
      }
      if (type === "terminal") {
        if (isClaude) {
          const titleParts = (title || "Bash").match(/^(\S+)(?:\s+([\s\S]*))?$/);
          const toolName = titleParts?.[1] || "Bash";
          const toolDescription = titleParts?.[2] || "";
          const terminalStatus = safeString(block.status || "running").toLowerCase();
          return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-terminal-claude", role: "group", "aria-label": title || "Bash command" }, /* @__PURE__ */ React.createElement("div", { className: "content-block-terminal-claude-header" }, /* @__PURE__ */ React.createElement("span", { className: `content-block-terminal-claude-dot ${terminalStatus}`, "aria-hidden": "true" }), /* @__PURE__ */ React.createElement("strong", null, toolName), toolDescription && /* @__PURE__ */ React.createElement("span", null, toolDescription)), /* @__PURE__ */ React.createElement("div", { className: "content-block-terminal-claude-body" }, block.command && /* @__PURE__ */ React.createElement("div", { className: "content-block-terminal-claude-row" }, /* @__PURE__ */ React.createElement("span", null, "IN"), /* @__PURE__ */ React.createElement("pre", null, block.command)), block.stdout && /* @__PURE__ */ React.createElement("div", { className: "content-block-terminal-claude-row" }, /* @__PURE__ */ React.createElement("span", null, "OUT"), /* @__PURE__ */ React.createElement("pre", null, block.stdout)), block.stderr && /* @__PURE__ */ React.createElement("div", { className: "content-block-terminal-claude-row error" }, /* @__PURE__ */ React.createElement("span", null, "ERR"), /* @__PURE__ */ React.createElement("pre", null, block.stderr))), /* @__PURE__ */ React.createElement(ContentBlockActions, { actions: block.actions }));
        }
        if (isCodexDesktop) {
          return /* @__PURE__ */ React.createElement(TranscriptDisclosure, { key: index, stateKey: `${richContentCacheIdentity}:disclosure:${index}`, className: "content-block content-block-terminal-codex-desktop", summary: /* @__PURE__ */ React.createElement("span", null, "Ran commands") }, body && /* @__PURE__ */ React.createElement("pre", { className: "content-block-pre" }, body), /* @__PURE__ */ React.createElement(ContentBlockActions, { actions: block.actions }));
        }
        return /* @__PURE__ */ React.createElement(TranscriptDisclosure, { key: index, stateKey: `${richContentCacheIdentity}:disclosure:${index}`, className: "content-block content-block-terminal", summary: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", null, title || "Terminal"), block.exit_code != null && /* @__PURE__ */ React.createElement("span", { className: "content-block-status" }, "exit ", block.exit_code)) }, body && /* @__PURE__ */ React.createElement("pre", { className: "content-block-pre" }, body), /* @__PURE__ */ React.createElement(ContentBlockActions, { actions: block.actions }));
      }
      if (type === "file_changes") {
        const cursorSummary = cursorFileChangeSummaryParts(title);
        const isCursorSummaryOnly = Boolean(
          isCursor && cursorSummary && !body && (!Array.isArray(block.files) || block.files.length === 0) && (!Array.isArray(block.actions) || block.actions.length === 0)
        );
        if (isCursorSummaryOnly) {
          return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-file-change content-block-file-change-cursor-summary" }, /* @__PURE__ */ React.createElement("span", null, cursorSummary.label), cursorSummary.additions && /* @__PURE__ */ React.createElement("span", { className: "content-block-add" }, cursorSummary.additions), cursorSummary.deletions && /* @__PURE__ */ React.createElement("span", { className: "content-block-del" }, cursorSummary.deletions));
        }
        const stats = [
          block.files_changed != null ? `${block.files_changed} files` : null,
          block.additions != null ? `+${block.additions}` : null,
          block.deletions != null ? `-${block.deletions}` : null
        ].filter(Boolean).join(" ");
        return /* @__PURE__ */ React.createElement(TranscriptDisclosure, { key: index, stateKey: `${richContentCacheIdentity}:disclosure:${index}`, className: "content-block content-block-file-change", summary: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", null, title || "File changes", stats ? ` ${stats}` : ""), block.status && /* @__PURE__ */ React.createElement("span", { className: `content-block-status ${safeString(block.status).toLowerCase()}` }, block.status)) }, Array.isArray(block.files) && block.files.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "content-block-file-list" }, block.files.map((file, fileIndex) => /* @__PURE__ */ React.createElement("div", { className: "content-block-file-row", key: file.path || fileIndex }, /* @__PURE__ */ React.createElement("span", { className: "content-block-file-path" }, file.path || "file"), file.added != null && /* @__PURE__ */ React.createElement("span", { className: "content-block-add" }, "+", file.added), file.removed != null && /* @__PURE__ */ React.createElement("span", { className: "content-block-del" }, "-", file.removed)))), body && richMarkdown(body, index), /* @__PURE__ */ React.createElement(ContentBlockActions, { actions: block.actions }));
      }
      if (type === "artifact") {
        return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-artifact" }, /* @__PURE__ */ React.createElement("div", { className: "content-block-title" }, title || "Artifact"), body && richMarkdown(body, index));
      }
      if (type === "plan") {
        const tasks = Array.isArray(block.tasks) ? block.tasks : [];
        return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-plan" }, /* @__PURE__ */ React.createElement("div", { className: "content-block-title" }, title || "Plan"), tasks.length > 0 && /* @__PURE__ */ React.createElement("ol", { className: "content-block-plan-list" }, tasks.map((task, taskIndex) => {
          const state = safeString(task?.state || task?.status || "pending").toLowerCase();
          return /* @__PURE__ */ React.createElement("li", { key: task.id || taskIndex, className: `content-block-plan-item ${state}` }, /* @__PURE__ */ React.createElement("span", { className: "content-block-plan-marker", "aria-hidden": "true" }, state === "completed" ? "\u2713" : state === "in_progress" ? "\u2022" : "\u25CB"), /* @__PURE__ */ React.createElement("span", null, task.text || task.step || task.title || ""));
        })), body && !tasks.length && richMarkdown(body, index));
      }
      if (type === "queued_message") {
        return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-queued-message" }, /* @__PURE__ */ React.createElement("span", { className: "content-block-queued-label" }, title || "Queued message"), body && /* @__PURE__ */ React.createElement("span", { className: "content-block-queued-body" }, body));
      }
      if (type === "notice") {
        return /* @__PURE__ */ React.createElement("div", { key: index, className: `content-block content-block-notice ${safeString(block.tone || block.status || "info").toLowerCase()}` }, /* @__PURE__ */ React.createElement("div", { className: "content-block-title" }, title || "Notice"), body && richMarkdown(body, index), /* @__PURE__ */ React.createElement(ContentBlockActions, { actions: block.actions }));
      }
      if (type === "error" && isAntigravityV2) {
        return /* @__PURE__ */ React.createElement(
          TranscriptDisclosure,
          {
            key: index,
            stateKey: `${richContentCacheIdentity}:disclosure:${index}`,
            className: "content-block content-block-error content-block-error-antigravity-v2",
            defaultOpen: false,
            summary: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "content-block-error-antigravity-v2-label" }, title || "Error"), body && /* @__PURE__ */ React.createElement("span", { className: "content-block-error-antigravity-v2-message" }, body))
          },
          /* @__PURE__ */ React.createElement(ContentBlockActions, { actions: block.actions })
        );
      }
      if (type === "prompt" || type === "error") {
        return /* @__PURE__ */ React.createElement("div", { key: index, className: `content-block content-block-${type}` }, /* @__PURE__ */ React.createElement("div", { className: "content-block-title" }, title || type), body && richMarkdown(body, index), /* @__PURE__ */ React.createElement(ContentBlockActions, { actions: block.actions }));
      }
      return /* @__PURE__ */ React.createElement("div", { key: index, className: "content-block content-block-markdown" }, richMarkdown(body || title, index));
    }));
  }
  function hasSubstantiveLiveText(content) {
    const text = normalizeMessageContent(content).trim();
    if (!text) return false;
    if (text.length < 4) return false;
    if (/^[\s*._|`~•·▌]+$/.test(text)) return false;
    if (!/[A-Za-z0-9]/.test(text)) return false;
    return true;
  }
  function MessageTimestamp({ message = null, instant = null }) {
    const parsed = instant == null ? messageInstant(message) : parseMessageInstant(instant);
    if (!parsed) {
      return /* @__PURE__ */ React.createElement(
        "span",
        {
          className: "message-timestamp message-timestamp-unknown",
          "aria-label": "Sent time unknown",
          title: "Sent time unknown"
        },
        "Time unknown"
      );
    }
    const absolute = formatAbsoluteMessageTime(parsed);
    return /* @__PURE__ */ React.createElement(
      "time",
      {
        className: "message-timestamp",
        dateTime: parsed.iso,
        title: absolute,
        "aria-label": `Sent ${absolute}`
      },
      formatVisibleMessageTime(parsed)
    );
  }
  function isUuidLike(value) {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
  function agentFromId(id) {
    if (!id) return DEFAULT_AGENT;
    const prefix = id.split("-")[0].toLowerCase();
    return AGENT_CONFIG[prefix] || DEFAULT_AGENT;
  }
  function normalizeAgentTypeHint(value) {
    const raw = safeString(value).toLowerCase();
    if (!raw) return null;
    if (raw.includes("roo code") || raw.includes("roo_code") || raw.includes("roo-cline")) return "roo_code";
    if (raw.includes("cline") || raw.includes("claude-dev")) return "cline";
    if (raw.includes("continue yolo") || raw.includes("continue_yolo")) return "continue_yolo";
    if (raw.includes("continue")) return "continue";
    if (raw.includes("codex cli") || raw.includes("codex_cli")) return "codex_cli";
    if (raw.includes("codex desktop")) return "codex-desktop";
    if (raw.includes("cursor cli") || raw.includes("cursor_cli")) return "cursor_cli";
    if (/\bcursor\b/.test(raw) || raw === "cursor" || raw.includes("cursor ide")) return "cursor";
    if (raw.includes("codex")) return "codex";
    if (raw.includes("claude code") || raw.includes("claude")) return "claude";
    if (raw.includes("antigravity chat") || raw.includes("antigravity_panel")) return "antigravity_panel";
    if (raw.includes("antigravity-v2") || raw.includes("antigravity v2")) return "antigravity-v2";
    return null;
  }
  function normalizedSessionAgentType(sessionOrId) {
    if (sessionOrId && typeof sessionOrId === "object") {
      const direct = sessionOrId.agent_type;
      if (AGENT_CONFIG[direct]) return direct;
      return normalizeAgentTypeHint(sessionOrId.display_name) || normalizeAgentTypeHint(sessionOrId.agent_type) || normalizeAgentTypeHint(sessionOrId.session_title) || normalizeAgentTypeHint(sessionOrId.window_title) || normalizeAgentTypeHint(sessionOrId.chat_title) || normalizeAgentTypeHint(sessionOrId.session_id);
    }
    if (typeof sessionOrId === "string") {
      const prefix = sessionOrId.split("-")[0].toLowerCase();
      if (AGENT_CONFIG[prefix]) return prefix;
      return normalizeAgentTypeHint(sessionOrId);
    }
    return null;
  }
  function sessionIdOf3(sessionOrId) {
    return typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.session_id;
  }
  function sessionAgent(sessionOrId, agentConfig) {
    if (sessionOrId && typeof sessionOrId === "object") {
      const type2 = normalizedSessionAgentType(sessionOrId);
      return AGENT_CONFIG[type2] || agentFromId(sessionOrId.session_id);
    }
    const type = normalizedSessionAgentType(sessionOrId);
    return AGENT_CONFIG[type] || agentFromId(sessionOrId);
  }
  function sessionSubLabel(sessionOrId, fallbackId, agentConfig) {
    if (sessionOrId && typeof sessionOrId === "object") {
      const workspaceCandidate = workspaceCandidateFromSession(sessionOrId, agentConfig);
      const scopeBasename = agentConfig?.file_access_scope ? agentConfig.file_access_scope.replace(/\\/g, "/").split("/").filter(Boolean).pop() : null;
      const panelSuffix = sessionOrId.agent_type === "antigravity_panel" && sessionOrId.panel_title ? ` / ${sessionOrId.panel_title}` : "";
      const workspacePart = (workspaceCandidate?.label || sessionOrId.workspace_name || scopeBasename || sessionOrId.window_title || sessionOrId.workspace_path || fallbackId || "Session") + panelSuffix;
      if (sessionOrId.chat_title && !workspacePart.includes("/")) {
        return `${workspacePart} / ${sessionOrId.chat_title}`;
      }
      return workspacePart;
    }
    const id = fallbackId || sessionOrId;
    if (typeof id !== "string") return "Session";
    if (isUuidLike(id)) return "Connected session";
    const parts = id.split("-");
    return parts.slice(1).join("-") || id;
  }
  function basenameFromPath(value) {
    const text = safeString(value).replace(/\\/g, "/").replace(/\/+$/, "").trim();
    if (!text) return "";
    return text.split("/").filter(Boolean).pop() || text;
  }
  function normalizePathForDisplay(value) {
    return safeString(value).replace(/\\/g, "/").replace(/\/+$/, "").trim();
  }
  function looksLikeAbsolutePath(value) {
    const text = normalizePathForDisplay(value);
    return /^[A-Za-z]:\//.test(text) || text.startsWith("//") || text.startsWith("/");
  }
  function isUserHomeOrDocumentsPath(value) {
    const text = normalizePathForDisplay(value).toLowerCase();
    return /^[a-z]:\/users\/[^/]+$/.test(text) || /^[a-z]:\/users\/[^/]+\/documents$/.test(text) || /^\/users\/[^/]+$/.test(text) || /^\/users\/[^/]+\/documents$/.test(text) || /^\/home\/[^/]+$/.test(text);
  }
  function userProfileNameFromPath(value) {
    const text = normalizePathForDisplay(value);
    const windowsMatch = text.match(/^[A-Za-z]:\/Users\/([^/]+)(?:\/|$)/i);
    if (windowsMatch) return windowsMatch[1];
    const unixMatch = text.match(/^\/(?:Users|home)\/([^/]+)(?:\/|$)/i);
    return unixMatch ? unixMatch[1] : "";
  }
  function isUserHomeWorkspaceName(nameValue, pathValue) {
    const profileName = userProfileNameFromPath(pathValue);
    return Boolean(profileName) && safeString(nameValue).trim().toLowerCase() === profileName.toLowerCase();
  }
  function stripWorkspaceDecorations(value) {
    return safeString(value).replace(/\s+\(Workspace\)$/i, "").replace(/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i, "").trim();
  }
  function isEditorAppChromeLabel(value) {
    const text = safeString(value).trim();
    return /^(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i.test(text);
  }
  function hasEditorAppChromeSuffix(value) {
    return /\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?\s*$/i.test(safeString(value));
  }
  function parseVSCodeWindowParts(value) {
    const raw = safeString(value).trim();
    if (!raw) return [];
    const parts = raw.split(/\s+-\s+/).map((part) => stripWorkspaceDecorations(part)).filter(Boolean);
    while (parts.length && isEditorAppChromeLabel(parts[parts.length - 1])) {
      parts.pop();
    }
    return parts;
  }
  var IMAGE_TITLE_RE = /\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\b|[\s._-]*\d{2,}(?:\s*[x\u00d7]\s*\d{2,})?|[\s._-]*[a-z0-9]{3,})/i;
  var ABSOLUTE_PATH_TITLE_RE = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/i;
  var LOW_SIGNAL_WORKSPACE_LABELS = /* @__PURE__ */ new Set([
    "agent",
    "agent manager",
    "agent session",
    "antigravity",
    "antigravity chat",
    "antigravity v2",
    "claude",
    "claude code",
    "codex",
    "codex cli",
    "codex desktop",
    "connected session",
    "other",
    "session",
    "unknown"
  ]);
  var LOW_SIGNAL_WORKSPACE_KEYS = new Set(
    Array.from(LOW_SIGNAL_WORKSPACE_LABELS, (label) => label.replace(/[^a-z0-9]+/g, ""))
  );
  function humanizeWorkspaceLabel(value) {
    const stripped = stripWorkspaceDecorations(value);
    if (!stripped) return "";
    const base = basenameFromPath(stripped);
    const hadWordSeparators = /[-_]/.test(base);
    let label = base.replace(/[-_]+/g, " ");
    if (hadWordSeparators || !/\s/.test(base)) {
      label = label.replace(/([a-z])([A-Z])/g, "$1 $2");
    }
    return label.replace(/\s+/g, " ").trim();
  }
  function isLowSignalWorkspaceLabel(value) {
    const label = humanizeWorkspaceLabel(value).toLowerCase();
    if (!label) return true;
    if (/^window\s+\d+$/.test(label)) return true;
    if (isEditorAppChromeLabel(label)) return true;
    if (LOW_SIGNAL_WORKSPACE_LABELS.has(label)) return true;
    const compact = label.replace(/[^a-z0-9]+/g, "");
    return LOW_SIGNAL_WORKSPACE_KEYS.has(compact);
  }
  function workspaceLabelsEqual(left, right) {
    return safeString(left).toLowerCase() === safeString(right).toLowerCase();
  }
  function makeWorkspaceCandidate(label, key) {
    const display = humanizeWorkspaceLabel(label);
    if (isLowSignalWorkspaceLabel(display)) return null;
    return {
      label: display,
      key: safeString(key || display).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
    };
  }
  function pathWorkspaceCandidate(pathValue) {
    const pathText = normalizePathForDisplay(pathValue);
    if (!pathText || !looksLikeAbsolutePath(pathText) || isUserHomeOrDocumentsPath(pathText)) return null;
    return makeWorkspaceCandidate(basenameFromPath(pathText), pathText);
  }
  function vscodeWorkspaceCandidate(titleValue) {
    const parts = parseVSCodeWindowParts(titleValue);
    if (parts.length < 2) return null;
    return makeWorkspaceCandidate(parts[parts.length - 1], parts[parts.length - 1]);
  }
  function namedWorkspaceCandidate(value) {
    const raw = safeString(value);
    if (hasEditorAppChromeSuffix(raw)) return null;
    const text = stripWorkspaceDecorations(value);
    if (!text || looksLikeAbsolutePath(text)) return null;
    if (parseVSCodeWindowParts(text).length >= 2) return null;
    return makeWorkspaceCandidate(text, text);
  }
  function workspaceTextVariants(label) {
    const base = safeString(label).toLowerCase().trim();
    return [
      base,
      base.replace(/\s+/g, "-"),
      base.replace(/\s+/g, "")
    ].filter(Boolean);
  }
  function knownWorkspaceCandidateFromText(values, knownWorkspaces = []) {
    const textFields = values.map((value) => safeString(value).toLowerCase()).filter(Boolean);
    const sortedKnown = [...knownWorkspaces].sort((a, b) => b.label.length - a.label.length);
    for (const known of sortedKnown) {
      const variants = workspaceTextVariants(known.label);
      if (textFields.some((text) => variants.some((variant) => variant && text.includes(variant)))) {
        return known;
      }
    }
    return null;
  }
  function workspaceCandidateFromSession(sessionOrId, agentConfig, knownWorkspaces = []) {
    if (!sessionOrId || typeof sessionOrId !== "object") return null;
    const knownMatch = knownWorkspaceCandidateFromText([
      sessionOrId.window_title,
      sessionOrId.workspace_name,
      sessionOrId.chat_title,
      sessionOrId.session_title
    ], knownWorkspaces);
    const directCandidates = [
      pathWorkspaceCandidate(sessionOrId.workspace_path),
      pathWorkspaceCandidate(agentConfig?.file_access_scope),
      knownMatch,
      vscodeWorkspaceCandidate(sessionOrId.window_title),
      vscodeWorkspaceCandidate(sessionOrId.workspace_name),
      isUserHomeWorkspaceName(sessionOrId.workspace_name, sessionOrId.workspace_path) ? null : namedWorkspaceCandidate(sessionOrId.workspace_name)
    ].filter(Boolean);
    if (directCandidates.length > 0) {
      const candidate = directCandidates[0];
      return knownWorkspaces.find((known) => workspaceLabelsEqual(known.label, candidate.label)) || candidate;
    }
    const textFields = [
      sessionOrId.chat_title,
      sessionOrId.session_title,
      sessionOrId.title,
      sessionOrId.display_title,
      sessionOrId.window_title,
      sessionOrId.workspace_name
    ].map((value) => safeString(value).toLowerCase()).filter(Boolean);
    const textMatch = knownWorkspaceCandidateFromText(textFields, knownWorkspaces);
    if (textMatch) return textMatch;
    return null;
  }
  function stripTitleNoise(content) {
    return normalizeMessageContent(content).replace(/!\[[^\]]*\]\((?:data:image\/[^)]+|\/uploads\/[^)]+|[^)]*\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi, " ").replace(/\[File:\s*[^\]]+\]/gi, " ").replace(ABSOLUTE_PATH_TITLE_RE, " ").replace(IMAGE_TITLE_RE, " ").replace(/<goal_context>[\s\S]*?<\/goal_context>/gi, " ").replace(/<[^>\n]{1,80}>/g, " ").replace(/```[\s\S]*?```/g, " ").replace(/`([^`]+)`/g, "$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i, "").replace(/\s+/g, " ").trim();
  }
  function sidebarChatTitle(sessionOrId, fallbackId, agentConfig, sessionMessages = []) {
    return resolveSessionChatTitle(
      sessionOrId,
      sessionOrId && typeof sessionOrId === "object" ? sessionOrId.custom_display_name : "",
      sessionMessages
    );
  }
  function workspaceKeyOf(sessionOrId) {
    if (!sessionOrId || typeof sessionOrId !== "object") return null;
    if (sessionOrId.workspace_path) return safeString(sessionOrId.workspace_path).toLowerCase();
    const raw = safeString(sessionOrId.workspace_name || sessionOrId.window_title || "");
    if (!raw) return null;
    return raw.split(" / ")[0].trim().toLowerCase() || null;
  }
  function findVisiblePaneSession(sessionList, targetSession) {
    const targetId = sessionIdOf3(targetSession);
    const targetKey = workspaceKeyOf(targetSession);
    if (!targetKey) return null;
    return (sessionList || []).find(
      (session) => session && typeof session === "object" && session.agent_type === "antigravity_panel" && sessionIdOf3(session) !== targetId && workspaceKeyOf(session) === targetKey
    ) || null;
  }
  function formatPaneSummary(session) {
    if (!session || typeof session !== "object") return "";
    return [
      session.panel_title || null,
      session.panel_model || null,
      session.panel_mode || null
    ].filter(Boolean).join(" \xB7 ");
  }
  function harnessLayoutForAgentType(agentType) {
    if (agentType === "claude") return "claude-document";
    if (agentType === "codex_cli") return "codex-terminal";
    if (agentType === "cursor") return "cursor-cards";
    if (agentType === "codex-desktop" || agentType === "codex") return "codex-thread";
    return "unified-flow";
  }
  function composerSkinForAgentType(agentType) {
    if (agentType === "codex_cli") return "codex-cli";
    if (agentType === "codex" || agentType === "codex-desktop") return "codex";
    if (agentType === "claude" || agentType === "claude_cli") return "claude";
    if (agentType === "cursor" || agentType === "cursor_cli") return "cursor";
    return "default";
  }
  function fuzzySessionMatchScore(value, query) {
    const text = safeString(value).toLowerCase().replace(/\s+/g, " ").trim();
    const needle = safeString(query).toLowerCase().replace(/\s+/g, " ").trim();
    if (!needle) return 0;
    const directIndex = text.indexOf(needle);
    if (directIndex >= 0) return 2e3 - Math.min(directIndex, 500) - Math.max(0, text.length - needle.length) * 0.01;
    let score = 0;
    let cursor = 0;
    let previous = -1;
    for (const char of needle) {
      if (char === " ") continue;
      const index = text.indexOf(char, cursor);
      if (index < 0) return Number.NEGATIVE_INFINITY;
      score += previous < 0 ? Math.max(0, 80 - index) : Math.max(1, 24 - (index - previous - 1) * 3);
      if (index === 0 || /[\s/\\_.:-]/.test(text[index - 1])) score += 35;
      previous = index;
      cursor = index + 1;
    }
    return score;
  }
  function rankQuickSwitcherItems(items, query) {
    const terms = safeString(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [...items];
    return items.map((item, sidebarIndex) => {
      const score = terms.reduce((total, term) => {
        const fields = Array.isArray(item.searchFields) && item.searchFields.length ? item.searchFields : [item.searchText];
        const next = Math.max(...fields.map((field) => fuzzySessionMatchScore(field, term)));
        return Number.isFinite(total) && Number.isFinite(next) ? total + next : Number.NEGATIVE_INFINITY;
      }, 0);
      return { item, sidebarIndex, score };
    }).filter((row) => Number.isFinite(row.score)).sort((left, right) => Number(!!right.item.working) - Number(!!left.item.working) || right.score - left.score || left.sidebarIndex - right.sidebarIndex).map((row) => row.item);
  }
  function isEditableShortcutTarget(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
  }
  function countTranscriptArrivalsSince(baseline, current) {
    if (!baseline || !current || baseline.sessionId !== current.sessionId) return 0;
    const settled = Math.max(0, Number(current.messageCount || 0) - Number(baseline.messageCount || 0));
    const provisionalChanged = !!current.provisionalId && (current.provisionalId !== baseline.provisionalId || Number(current.provisionalLength || 0) > Number(baseline.provisionalLength || 0));
    return settled + (provisionalChanged && settled === 0 ? 1 : 0);
  }
  function useStableSidebarGroups(groups, rankOptions, freezeStructure = false) {
    const [ledger, setLedger] = React.useState(() => createSidebarOrderLedger(groups, rankOptions));
    const projection = React.useMemo(() => reconcileSidebarOrderLedger(ledger, groups, {
      ...rankOptions,
      freezeStructure
    }), [ledger, groups, rankOptions, freezeStructure]);
    React.useEffect(() => {
      if (projection.ledger !== ledger) setLedger(projection.ledger);
    }, [ledger, projection]);
    const sortNow = React.useCallback(() => {
      setLedger((previous) => sortSidebarOrderLedger(previous, groups, rankOptions));
    }, [groups, rankOptions]);
    return {
      groups: projection.groups,
      orderChanged: projection.orderChanged,
      sortNow,
      revision: projection.ledger.revision
    };
  }
  function formatVisiblePaneSummary(session) {
    if (!session || typeof session !== "object") return "";
    if (session.visible_pane_visible) {
      return [
        session.visible_pane_title || null,
        session.visible_pane_location === "right" ? "Right Pane" : null
      ].filter(Boolean).join(" \xB7 ");
    }
    return formatPaneSummary(session);
  }
  function formatAntigravityQuotaLabel(modelName) {
    const raw = safeString(modelName);
    if (!raw) return "";
    return raw.replace(/^Gemini\s+/i, "G ").replace(/^Claude\s+/i, "").replace(/\s*\(Thinking\)\s*/i, "").replace(/\s*\(Medium\)\s*/i, "").replace(/\s+/g, " ").trim();
  }
  function formatAntigravityQuotaSummary(models, maxItems = 3) {
    if (!Array.isArray(models) || models.length === 0) return "";
    return models.slice(0, maxItems).map((entry) => {
      const pct = entry?.percent_used;
      if (pct == null) return null;
      const label = formatAntigravityQuotaLabel(entry?.model);
      if (!label) return null;
      return `${label} ${pct}%`;
    }).filter(Boolean).join(" \xB7 ");
  }
  function agentTypeLabel(agentType) {
    if (!agentType) return "";
    return AGENT_CONFIG[agentType]?.name || agentType;
  }
  function usageSnapshotForSession(session, activityOverride = null) {
    if (!session || typeof session !== "object") {
      return { hasSignal: false, percentUsed: null, remainingPercent: null, state: "unknown", resetAt: null, quotaModels: [] };
    }
    const usage = activityOverride?.usage || session.activity?.usage || null;
    const quotaModels = Array.isArray(session.antigravity_quota_models) ? session.antigravity_quota_models.map((entry) => ({
      model: safeString(entry?.model),
      percent_used: Number.isFinite(Number(entry?.percent_used)) ? Math.max(0, Math.min(100, Number(entry.percent_used))) : null,
      refreshes_in: safeString(entry?.refreshes_in || entry?.resets_at)
    })).filter((entry) => entry.model && entry.percent_used != null) : [];
    const directPercent = [usage?.percent_used, session.percent_used].map((value) => Number(value)).find(Number.isFinite);
    const quotaPercent = quotaModels.length > 0 ? Math.max(...quotaModels.map((entry) => entry.percent_used)) : null;
    const percentUsed = Number.isFinite(directPercent) ? Math.max(0, Math.min(100, directPercent)) : quotaPercent;
    const exhausted = !!session.rate_limit_active || usage?.state === "exhausted" || usage?.rate_limited === true;
    const state = exhausted ? "exhausted" : percentUsed != null && percentUsed >= 90 ? "critical" : percentUsed != null && percentUsed >= 80 ? "warning" : percentUsed != null ? "ok" : "unknown";
    const resetAt = safeString(
      usage?.resets_at || session.rate_limited_until || quotaModels.find((entry) => entry.refreshes_in)?.refreshes_in
    );
    return {
      hasSignal: exhausted || percentUsed != null || !!resetAt,
      percentUsed,
      remainingPercent: percentUsed == null ? null : Math.max(0, 100 - Math.round(percentUsed)),
      state,
      resetAt: resetAt && resetAt !== "unknown" ? resetAt : null,
      quotaModels
    };
  }
  function sessionHostLabel(session) {
    if (!session || typeof session !== "object") return "";
    return safeString(session.host_label || (session.host_type === "vscode" ? "VS Code" : session.host_type === "antigravity_ide" ? "Antigravity IDE" : ""));
  }
  var HEALTH_COLOR = {
    healthy: "#3fb950",
    degraded: "#d29922",
    disconnected: "#f85149"
  };
  var ACTIVITY_META = {
    thinking: { icon: "\u25CC", tone: "thinking" },
    generating: { icon: "\u2726", tone: "thinking" },
    reading_files: { icon: "\u229E", tone: "info" },
    running_command: { icon: ">", tone: "info" },
    applying_patch: { icon: "\u0394", tone: "info" },
    waiting_for_user: { icon: "?", tone: "idle" },
    idle: { icon: "\xB7", tone: "idle" },
    working: { icon: "\u2022", tone: "info" }
  };
  function NativeActivitySpinner({ agentType, compact = false, animate = true }) {
    const type = String(agentType || "default").toLowerCase();
    const staticClass = animate ? "" : " static";
    if (type === "claude" || type === "claude_cli") {
      return /* @__PURE__ */ React.createElement("span", { className: `native-activity-spinner claude${compact ? " compact" : ""}${staticClass}` }, animate ? /* @__PURE__ */ React.createElement(ClaudeSpinner, null) : /* @__PURE__ */ React.createElement("span", { className: "claude-spinner-icon" }, SPINNER_SYMBOLS[0]));
    }
    if (type === "codex" || type === "codex-desktop" || type === "codex_cli") {
      return /* @__PURE__ */ React.createElement("span", { className: `native-activity-spinner codex${compact ? " compact" : ""}${staticClass}`, "aria-label": "Working" }, "\u25CC");
    }
    if (type === "cursor") {
      return /* @__PURE__ */ React.createElement("span", { className: `native-activity-spinner cursor${compact ? " compact" : ""}${staticClass}`, "aria-label": "Generating" }, /* @__PURE__ */ React.createElement("i", null), /* @__PURE__ */ React.createElement("i", null), /* @__PURE__ */ React.createElement("i", null));
    }
    return /* @__PURE__ */ React.createElement("span", { className: `native-activity-spinner generic${compact ? " compact" : ""}${staticClass}` }, /* @__PURE__ */ React.createElement("i", null));
  }
  function DeliveryStatus({ msg, deliveryStates, onSteer, onRetry }) {
    if (msg._optimistic) {
      const status = deliveryStates[msg._cid] || "queued";
      if (status === "offline_queued") return /* @__PURE__ */ React.createElement("span", { className: "delivery offline-queued", title: "Queued until relay reconnects", "aria-label": "Queued offline" }, "offline");
      if (status === "queued") return /* @__PURE__ */ React.createElement("span", { className: "delivery queued", title: "Sending\u2026", "aria-label": "Sending to relay" }, "\xB7\xB7\xB7");
      if (status === "busy_queued") return /* @__PURE__ */ React.createElement("span", { className: "delivery busy-queued", title: "Agent is busy \u2014 message queued", "aria-label": "Queued while agent is busy" }, /* @__PURE__ */ React.createElement("span", { className: "queued-label" }, "queued"), onSteer && /* @__PURE__ */ React.createElement("button", { className: "steer-btn", onClick: (e) => {
        e.stopPropagation();
        onSteer(msg._cid, msg.content);
      }, title: "Inject into agent's context now" }, "Steer \u25B8"));
      if (status === "steered") return /* @__PURE__ */ React.createElement("span", { className: "delivery steered", title: "Injected into agent context", "aria-label": "Steered into agent context" }, "\u2933");
      if (status === "accepted") return /* @__PURE__ */ React.createElement("span", { className: "delivery accepted", title: "Received by relay", "aria-label": "Relay accepted; native receipt pending" }, "\u2713");
      if (status === "launch_accepted") return /* @__PURE__ */ React.createElement("span", { className: "delivery launch-accepted", title: "Native launch accepted; user-turn receipt pending", "aria-label": "Native launch accepted; user-turn receipt pending" }, "\u2197");
      if (status === "delivered") return /* @__PURE__ */ React.createElement("span", { className: "delivery delivered", title: "Native user turn observed", "aria-label": "Native user turn delivered" }, "\u2713\u2713");
      if (status === "agent_started") return /* @__PURE__ */ React.createElement("span", { className: "delivery agent-started", title: "Agent started working", "aria-label": "Agent started working" }, "\u25B6");
      if (status === "failed") return /* @__PURE__ */ React.createElement("span", { className: "delivery failed", title: msg._sendError || "Failed \u2014 agent may be offline", "aria-label": `Send failed: ${msg._sendError || "agent may be offline"}` }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\u2715"), onRetry && /* @__PURE__ */ React.createElement("button", { type: "button", className: "delivery-retry", onClick: (event) => {
        event.stopPropagation();
        onRetry(msg);
      } }, "Retry"));
    }
    if (msg._agentStarted || msg.status === "agent_started") return /* @__PURE__ */ React.createElement("span", { className: "delivery agent-started", title: "Agent started working", "aria-label": "Agent started working" }, "\u25B6");
    if (msg._delivered || msg.status === "delivered") return /* @__PURE__ */ React.createElement("span", { className: "delivery delivered", title: "Native user turn observed", "aria-label": "Native user turn delivered" }, "\u2713\u2713");
    if (msg.status === "failed") return /* @__PURE__ */ React.createElement("span", { className: "delivery failed", title: msg.failure_code || "Send failed", "aria-label": `Send failed: ${msg.failure_code || "unknown failure"}` }, "\u2715");
    if (msg._launchAcceptedAt || msg.launch_accepted_at) return /* @__PURE__ */ React.createElement("span", { className: "delivery launch-accepted", title: "Native launch accepted; user-turn receipt pending", "aria-label": "Native launch accepted; user-turn receipt pending" }, "\u2197");
    if (msg.status === "accepted") return /* @__PURE__ */ React.createElement("span", { className: "delivery accepted", title: "Received by relay; native receipt pending", "aria-label": "Relay accepted; native receipt pending" }, "\u2713");
    return /* @__PURE__ */ React.createElement("span", { className: "delivery recorded", title: "Recorded \u2014 native delivery receipt unknown", "aria-label": "Recorded; native delivery receipt unknown" }, "Recorded");
  }
  function useStableWorkingSessions(sessions, freezeStructure = false) {
    const [ledger, setLedger] = React.useState(() => createSidebarWorkingLedger(sessions));
    const projection = React.useMemo(
      () => reconcileSidebarWorkingLedger(ledger, sessions, { freezeStructure }),
      [ledger, sessions, freezeStructure]
    );
    React.useEffect(() => {
      if (projection.ledger !== ledger) setLedger(projection.ledger);
    }, [ledger, projection]);
    return {
      sessions: projection.sessions,
      revision: projection.ledger.revision,
      deferred: projection.deferred
    };
  }
  function useSidebarFreshnessClock(activities, sessions) {
    const [nowMs, setNowMs] = React.useState(Date.now());
    React.useEffect(() => {
      const now = Date.now();
      const activityRows = [
        ...Object.values(activities || {}),
        ...Array.isArray(sessions) ? sessions.map((session) => session?.activity) : []
      ];
      const nextDeadline = activityRows.reduce((next, activity) => {
        const observedAt = fleetActivityObservedAtMs(activity);
        const deadline = observedAt ? observedAt + DEFAULT_ACTIVITY_FRESHNESS_MS : 0;
        if (deadline <= now) return next;
        return next === 0 ? deadline : Math.min(next, deadline);
      }, 0);
      if (!nextDeadline) return void 0;
      const timer = setTimeout(() => setNowMs(Date.now()), Math.max(25, nextDeadline - now + 25));
      return () => clearTimeout(timer);
    }, [activities, sessions, nowMs]);
    return nowMs;
  }
  function ProvisionalStreamingBubble({ stream, activeAgent, monospace }) {
    const textRef = useRef3(null);
    const renderedContentRef = useRef3("");
    useLayoutEffect2(() => {
      const node = textRef.current;
      if (!node) return;
      const next = String(stream?.content || "");
      const previous = renderedContentRef.current;
      if (next.startsWith(previous)) {
        const append = next.slice(previous.length);
        if (append) node.appendChild(document.createTextNode(append));
      } else {
        node.textContent = next;
      }
      renderedContentRef.current = next;
    }, [stream?.content]);
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `message assistant live-draft provisional-stream${monospace ? " monospace" : ""}`,
        "data-message-id": stream?.messageId || "awaiting-first-delta",
        "data-message-role": "assistant",
        "data-message-timestamp": parseMessageInstant(stream?.startedAtMs)?.iso || void 0,
        "data-stream-open": stream?.open ? "true" : "false"
      },
      /* @__PURE__ */ React.createElement("div", { className: "assistant-gutter" }, /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "agent-badge transcript-agent-badge",
          style: { color: activeAgent.color, borderColor: activeAgent.color + "55", background: activeAgent.color + "18" }
        },
        activeAgent.logo ? /* @__PURE__ */ React.createElement("img", { src: activeAgent.logo, alt: activeAgent.abbr, className: "agent-badge-logo" }) : activeAgent.abbr
      )),
      /* @__PURE__ */ React.createElement("div", { className: "assistant-content" }, /* @__PURE__ */ React.createElement("div", { className: "message-role" }, /* @__PURE__ */ React.createElement("span", { className: "message-role-label" }, activeAgent.name), /* @__PURE__ */ React.createElement(MessageTimestamp, { instant: stream?.startedAtMs })), /* @__PURE__ */ React.createElement("div", { className: "provisional-stream-text", ref: textRef }), stream?.open && /* @__PURE__ */ React.createElement("span", { className: "provisional-stream-caret", "aria-label": "Streaming response" }))
    );
  }
  function TranscriptMessage({
    msg,
    messageKey,
    activeAgent,
    assistantMonospace,
    autoExpandLongCodeBlocks,
    onOpenPath,
    agentType,
    preview,
    fileContents,
    onClosePreview,
    deliveryState,
    onSteer,
    onRetry,
    richContentEager,
    searchMatch = false
  }) {
    const normalizedContent = normalizeMessageContent(msg.content) || contentBlocksFallback(msg.content_blocks);
    const renderableUserContent = recoverUploadedImageMarkdown(msg.content);
    const instant = messageInstant(msg);
    const hasStructuredBlocks = msg.role !== "user" && normalizeContentBlocks(msg.content_blocks).length > 0;
    const sourceIdentity = msg.source_message_id || msg.native_source_id || "";
    const contentIdentityHash = messageContentIdentityHash(msg);
    const blockType = topLevelMessageBlockType(msg);
    if (msg.role === "user") {
      const deliveryStatesForMessage = msg._cid ? { [msg._cid]: deliveryState } : {};
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `message user transcript-virtual-row${msg._optimistic && deliveryState === "failed" ? " failed" : ""}${searchMatch ? " search-match" : ""}`,
          "data-message-key": messageKey,
          "data-message-id": msg.id || void 0,
          "data-message-role": "user",
          "data-message-block-type": blockType,
          "data-message-content-hash": contentIdentityHash,
          "data-message-source-id": sourceIdentity || void 0,
          "data-message-timestamp": instant?.iso || "unknown"
        },
        /* @__PURE__ */ React.createElement("div", { className: "user-gutter" }, /* @__PURE__ */ React.createElement("div", { className: "user-glyph" })),
        /* @__PURE__ */ React.createElement("div", { className: "user-content" }, /* @__PURE__ */ React.createElement("div", { className: "message-role" }, /* @__PURE__ */ React.createElement("span", { className: "message-role-label" }, "You"), /* @__PURE__ */ React.createElement(MessageTimestamp, { message: msg }), /* @__PURE__ */ React.createElement(DeliveryStatus, { msg, deliveryStates: deliveryStatesForMessage, onSteer, onRetry })), /!\[[^\]]*\]\((?:data:|\/uploads\/)/.test(renderableUserContent) ? /* @__PURE__ */ React.createElement("div", { className: "user-text" }, /* @__PURE__ */ React.createElement(
          MarkdownContent,
          {
            content: renderableUserContent,
            deferUntilVisible: !richContentEager,
            cacheIdentity: `${messageKey}:user`
          }
        )) : /* @__PURE__ */ React.createElement("div", { className: "user-text" }, normalizedContent))
      );
    }
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `message assistant transcript-virtual-row${assistantMonospace ? " monospace" : ""}${searchMatch ? " search-match" : ""}`,
        "data-message-key": messageKey,
        "data-message-id": msg.id || void 0,
        "data-message-role": "assistant",
        "data-message-block-type": blockType,
        "data-message-content-hash": contentIdentityHash,
        "data-message-source-id": sourceIdentity || void 0,
        "data-message-timestamp": instant?.iso || "unknown"
      },
      /* @__PURE__ */ React.createElement("div", { className: "assistant-gutter" }, /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "agent-badge transcript-agent-badge",
          style: { color: activeAgent.color, borderColor: activeAgent.color + "55", background: activeAgent.color + "18" }
        },
        activeAgent.logo ? /* @__PURE__ */ React.createElement("img", { src: activeAgent.logo, alt: activeAgent.abbr, className: "agent-badge-logo" }) : activeAgent.abbr
      )),
      /* @__PURE__ */ React.createElement("div", { className: "assistant-content" }, /* @__PURE__ */ React.createElement("div", { className: "message-role" }, /* @__PURE__ */ React.createElement("span", { className: "message-role-label" }, activeAgent.name), /* @__PURE__ */ React.createElement(MessageTimestamp, { message: msg })), hasStructuredBlocks ? /* @__PURE__ */ React.createElement(
        ContentBlocks,
        {
          blocks: msg.content_blocks,
          monospace: assistantMonospace,
          autoExpandLongCodeBlocks,
          onOpenPath: (path) => onOpenPath(messageKey, path),
          agentType,
          richContentEager,
          richContentCacheIdentity: messageKey
        }
      ) : /* @__PURE__ */ React.createElement(
        MarkdownContent,
        {
          content: normalizeMessageContent(msg.content),
          monospace: assistantMonospace,
          autoExpandLongCodeBlocks,
          onOpenPath: (path) => onOpenPath(messageKey, path),
          deferUntilVisible: !richContentEager,
          cacheIdentity: `${messageKey}:assistant`
        }
      ), preview && /* @__PURE__ */ React.createElement(
        TranscriptInlineFilePreview,
        {
          sessionId: preview.sessionId,
          filePath: preview.path,
          fileContents,
          onClose: onClosePreview
        }
      ))
    );
  }
  function transcriptPreviewKey(preview) {
    return preview ? `${preview.sessionId}${preview.messageKey}${preview.path}` : "";
  }
  function activeAgentKey(agent) {
    return [agent?.name, agent?.color, agent?.abbr, agent?.logo || ""].join("");
  }
  function areTranscriptMessagePropsEqual(prev, next) {
    return prev.msg === next.msg && prev.messageKey === next.messageKey && prev.assistantMonospace === next.assistantMonospace && prev.autoExpandLongCodeBlocks === next.autoExpandLongCodeBlocks && prev.agentType === next.agentType && activeAgentKey(prev.activeAgent) === activeAgentKey(next.activeAgent) && transcriptPreviewKey(prev.preview) === transcriptPreviewKey(next.preview) && prev.fileContents === next.fileContents && prev.deliveryState === next.deliveryState && prev.onRetry === next.onRetry && prev.richContentEager === next.richContentEager && prev.searchMatch === next.searchMatch;
  }
  var MemoTranscriptMessage = React.memo(TranscriptMessage, areTranscriptMessagePropsEqual);
  var TRANSCRIPT_WINDOW_THRESHOLD = 100;
  var TRANSCRIPT_WINDOW_OVERSCAN_PX = 1200;
  var TRANSCRIPT_WINDOW_FALLBACK_ROWS = 32;
  function estimatedTranscriptRowHeight(message) {
    const content = normalizeMessageContent(message?.content) || contentBlocksFallback(message?.content_blocks);
    const lineCount = Math.max(1, safeString(content).split("\n").length);
    if (message?.role === "user") return Math.min(180, 40 + Math.max(0, lineCount - 1) * 18);
    const wrappedLines = Math.ceil(safeString(content).length / 100);
    const structuredBonus = normalizeContentBlocks(message?.content_blocks).length * 28;
    return Math.min(420, 68 + Math.max(lineCount, wrappedLines) * 18 + structuredBonus);
  }
  function transcriptPrefixIndex(prefix, offset) {
    let low = 0;
    let high = Math.max(0, prefix.length - 1);
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (prefix[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }
  function VirtualTranscriptRow({ index, messageKey, onMeasure, children }) {
    const rowRef = React.useRef(null);
    React.useLayoutEffect(() => {
      const node = rowRef.current;
      if (!node) return void 0;
      const measure = () => onMeasure(index, messageKey, node.getBoundingClientRect().height);
      measure();
      if (typeof ResizeObserver === "undefined") return void 0;
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, [index, messageKey, onMeasure]);
    return /* @__PURE__ */ React.createElement("div", { className: "transcript-window-row", "data-window-index": index, ref: rowRef }, children);
  }
  function useTranscriptWindow({ messages, containerRef, sessionId, routeActive }) {
    const enabled = routeActive && messages.length > TRANSCRIPT_WINDOW_THRESHOLD;
    const enabledRef = React.useRef(enabled);
    enabledRef.current = enabled;
    const heightsRef = React.useRef(/* @__PURE__ */ new Map());
    const heightsSessionRef = React.useRef(sessionId);
    if (heightsSessionRef.current !== sessionId) {
      heightsRef.current.clear();
      heightsSessionRef.current = sessionId;
    }
    const prefixRef = React.useRef([0]);
    const viewportAnchorRef = React.useRef(null);
    const pendingAnchorRestoreRef = React.useRef(null);
    const anchorReleaseTimerRef = React.useRef(0);
    const routeRestoreFrameRef = React.useRef(0);
    const previousWindowRef = React.useRef({ sessionId: null, keys: [], prefix: [0] });
    const measureFrameRef = React.useRef(0);
    const scrollFrameRef = React.useRef(0);
    const pinnedIndexRef = React.useRef(null);
    const pinnedMessageKeyRef = React.useRef(null);
    const pinReleaseTimerRef = React.useRef(0);
    const pendingAnchorDeltaRef = React.useRef(0);
    const [heightRevision, setHeightRevision] = React.useState(0);
    const [range, setRange] = React.useState({ sessionId: null, start: 0, end: 0 });
    const keys = React.useMemo(
      () => messages.map((message, index) => `${sessionId || ""}${messageIdentityKey(message, index)}`),
      [messages, sessionId]
    );
    const prefix = React.useMemo(() => {
      const next = new Array(messages.length + 1);
      next[0] = 0;
      for (let index = 0; index < messages.length; index += 1) {
        const measured = heightsRef.current.get(keys[index]);
        next[index + 1] = next[index] + (measured || estimatedTranscriptRowHeight(messages[index]));
      }
      return next;
    }, [messages, keys, heightRevision]);
    prefixRef.current = prefix;
    const captureViewportAnchor = React.useCallback(() => {
      if (pendingAnchorRestoreRef.current) return;
      const list = containerRef.current;
      if (!enabled || !list) return;
      const listRect = list.getBoundingClientRect();
      const listTop = listRect.top;
      const rows = Array.from(list.querySelectorAll(".transcript-window-row[data-window-index]"));
      const anchorRow = rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= listTop && rect.top < listRect.bottom;
      }) || rows.find((row) => row.getBoundingClientRect().bottom > listTop) || rows[0];
      if (!anchorRow) return;
      const index = Number(anchorRow.dataset.windowIndex);
      if (!Number.isInteger(index) || !keys[index]) return;
      viewportAnchorRef.current = {
        sessionId,
        key: keys[index],
        viewportOffset: anchorRow.getBoundingClientRect().top - listTop
      };
    }, [containerRef, enabled, keys, sessionId]);
    const releasePinnedIndex = React.useCallback(() => {
      pinnedIndexRef.current = null;
      pinnedMessageKeyRef.current = null;
      if (pinReleaseTimerRef.current) clearTimeout(pinReleaseTimerRef.current);
      pinReleaseTimerRef.current = 0;
    }, []);
    const updateRange = React.useCallback(() => {
      const list = containerRef.current;
      if (!enabled || !list) return;
      const pendingAnchor = pendingAnchorRestoreRef.current;
      if (pendingAnchor?.sessionId === sessionId) {
        const pendingIndex = keys.indexOf(pendingAnchor.key);
        if (pendingIndex >= 0) {
          setRange((previous) => previous.sessionId === sessionId && previous.start === pendingIndex && previous.end === Math.min(messages.length, pendingIndex + TRANSCRIPT_WINDOW_FALLBACK_ROWS) ? previous : {
            sessionId,
            start: pendingIndex,
            end: Math.min(messages.length, pendingIndex + TRANSCRIPT_WINDOW_FALLBACK_ROWS)
          });
          return;
        }
      }
      captureViewportAnchor();
      const activePrefix = prefixRef.current;
      const startOffset = Math.max(0, list.scrollTop - TRANSCRIPT_WINDOW_OVERSCAN_PX);
      const endOffset = list.scrollTop + list.clientHeight + TRANSCRIPT_WINDOW_OVERSCAN_PX;
      const rawStart = Math.max(0, transcriptPrefixIndex(activePrefix, startOffset) - 1);
      const rawEnd = Math.min(messages.length, transcriptPrefixIndex(activePrefix, endOffset) + 2);
      let start2 = rawEnd >= messages.length ? Math.max(0, messages.length - TRANSCRIPT_WINDOW_FALLBACK_ROWS) : rawStart;
      let end2 = rawEnd;
      const pinnedKey = pinnedMessageKeyRef.current;
      const resolvedPinnedIndex = pinnedKey ? keys.indexOf(pinnedKey) : pinnedIndexRef.current;
      if (resolvedPinnedIndex >= 0) pinnedIndexRef.current = resolvedPinnedIndex;
      const pinnedIndex = resolvedPinnedIndex;
      if (Number.isInteger(pinnedIndex) && pinnedIndex >= 0 && pinnedIndex < messages.length) {
        start2 = Math.min(start2, Math.max(0, pinnedIndex - TRANSCRIPT_WINDOW_FALLBACK_ROWS));
        end2 = Math.max(end2, Math.min(messages.length, pinnedIndex + TRANSCRIPT_WINDOW_FALLBACK_ROWS + 1));
      }
      React.startTransition(() => {
        setRange((previous) => previous.sessionId === sessionId && previous.start === start2 && previous.end === end2 ? previous : { sessionId, start: start2, end: end2 });
      });
    }, [captureViewportAnchor, containerRef, enabled, keys, messages.length, sessionId]);
    React.useLayoutEffect(() => {
      const previous = previousWindowRef.current;
      previousWindowRef.current = { sessionId, keys, prefix };
      if (!enabled || previous.sessionId !== sessionId || !previous.keys.length) {
        if (!pendingAnchorRestoreRef.current?.routeRestore) {
          pendingAnchorRestoreRef.current = null;
        }
        if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
        anchorReleaseTimerRef.current = 0;
        captureViewportAnchor();
        return;
      }
      const anchor = viewportAnchorRef.current;
      if (!anchor || anchor.sessionId !== sessionId || !anchor.key) return;
      const previousIndex = previous.keys.indexOf(anchor.key);
      const nextIndex = keys.indexOf(anchor.key);
      if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) return;
      const list = containerRef.current;
      if (!list) return;
      const previousOffset = previous.prefix[previousIndex] || 0;
      const nextOffset = prefix[nextIndex] || 0;
      pendingAnchorRestoreRef.current = {
        sessionId,
        key: anchor.key,
        viewportOffset: anchor.viewportOffset
      };
      pinnedIndexRef.current = nextIndex;
      pinnedMessageKeyRef.current = anchor.key;
      if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
      anchorReleaseTimerRef.current = setTimeout(() => {
        pendingAnchorRestoreRef.current = null;
        anchorReleaseTimerRef.current = 0;
        releasePinnedIndex();
        captureViewportAnchor();
      }, 1500);
      setRange({
        sessionId,
        start: nextIndex,
        end: Math.min(messages.length, nextIndex + TRANSCRIPT_WINDOW_FALLBACK_ROWS)
      });
      setScrollTopInstant(list, Math.max(0, list.scrollTop + nextOffset - previousOffset));
    }, [captureViewportAnchor, containerRef, enabled, keys, messages.length, prefix, releasePinnedIndex, sessionId]);
    React.useLayoutEffect(() => {
      const pending = pendingAnchorRestoreRef.current;
      if (!pending || pending.sessionId !== sessionId) return;
      const index = keys.indexOf(pending.key);
      if (index < range.start || index >= range.end) return;
      const list = containerRef.current;
      const row = list?.querySelector(`.transcript-window-row[data-window-index="${index}"]`);
      if (!list || !row) return;
      if (pending.atBottom) {
        setScrollTopInstant(list, list.scrollHeight);
        viewportAnchorRef.current = pending;
        return;
      }
      const currentOffset = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
      const correction = currentOffset - pending.viewportOffset;
      if (Math.abs(correction) >= 0.5) {
        setScrollTopInstant(list, Math.max(0, list.scrollTop + correction));
      }
      viewportAnchorRef.current = pending;
    }, [containerRef, enabled, keys, prefix, range, sessionId]);
    React.useLayoutEffect(() => {
      const pending = pendingAnchorRestoreRef.current;
      if (!enabled || !pending?.routeRestore) return;
      let active = true;
      const restoreRouteAnchor = () => {
        if (!active) return;
        const current = pendingAnchorRestoreRef.current;
        const list = containerRef.current;
        if (!current?.routeRestore || current.sessionId !== sessionId || !list) return;
        const index = keys.indexOf(current.key);
        const row = index >= 0 ? list.querySelector(`.transcript-window-row[data-window-index="${index}"]`) : null;
        if (row) {
          if (current.atBottom) {
            setScrollTopInstant(list, list.scrollHeight);
          } else {
            const offset = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
            const correction = offset - current.viewportOffset;
            if (Math.abs(correction) >= 0.5) {
              setScrollTopInstant(list, Math.max(0, list.scrollTop + correction));
            }
          }
        }
        routeRestoreFrameRef.current = requestAnimationFrame(restoreRouteAnchor);
      };
      restoreRouteAnchor();
      if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
      anchorReleaseTimerRef.current = setTimeout(() => {
        pendingAnchorRestoreRef.current = null;
        anchorReleaseTimerRef.current = 0;
        if (routeRestoreFrameRef.current) cancelAnimationFrame(routeRestoreFrameRef.current);
        routeRestoreFrameRef.current = 0;
        releasePinnedIndex();
        captureViewportAnchor();
      }, 1500);
      return () => {
        active = false;
        if (routeRestoreFrameRef.current) cancelAnimationFrame(routeRestoreFrameRef.current);
        routeRestoreFrameRef.current = 0;
      };
    }, [captureViewportAnchor, containerRef, enabled, keys, releasePinnedIndex, sessionId]);
    React.useLayoutEffect(() => {
      if (!enabled) {
        releasePinnedIndex();
        return void 0;
      }
      const list = containerRef.current;
      if (!list) return void 0;
      updateRange();
      const onScroll = () => {
        captureViewportAnchor();
        const pinnedKey = pinnedMessageKeyRef.current;
        const resolvedPinnedIndex = pinnedKey ? keys.indexOf(pinnedKey) : pinnedIndexRef.current;
        if (resolvedPinnedIndex >= 0) pinnedIndexRef.current = resolvedPinnedIndex;
        const pinnedIndex = resolvedPinnedIndex;
        const activePrefix = prefixRef.current;
        if (Number.isInteger(pinnedIndex) && pinnedIndex >= 0 && pinnedIndex < messages.length) {
          const pinnedStart = activePrefix[pinnedIndex] || 0;
          const pinnedEnd = activePrefix[pinnedIndex + 1] || pinnedStart;
          const viewportStart = list.scrollTop;
          const viewportEnd = viewportStart + list.clientHeight;
          if (pinnedEnd < viewportStart - TRANSCRIPT_WINDOW_OVERSCAN_PX || pinnedStart > viewportEnd + TRANSCRIPT_WINDOW_OVERSCAN_PX) {
            releasePinnedIndex();
          }
        }
        if (scrollFrameRef.current) return;
        scrollFrameRef.current = requestAnimationFrame(() => {
          scrollFrameRef.current = 0;
          updateRange();
        });
      };
      list.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        list.removeEventListener("scroll", onScroll);
        if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = 0;
      };
    }, [captureViewportAnchor, enabled, routeActive, sessionId, keys, messages.length, updateRange, releasePinnedIndex]);
    React.useLayoutEffect(() => {
      if (!enabled) return;
      updateRange();
    }, [enabled, prefix, updateRange]);
    const onMeasure = React.useCallback((index, key, rawHeight) => {
      if (!enabledRef.current) return;
      const nextHeight = Math.max(1, Math.ceil(rawHeight));
      const previousHeight = heightsRef.current.get(key) || estimatedTranscriptRowHeight(messages[index]);
      if (Math.abs(nextHeight - previousHeight) < 1) return;
      heightsRef.current.set(key, nextHeight);
      const list = containerRef.current;
      const anchorIndex = list ? transcriptPrefixIndex(prefixRef.current, list.scrollTop) : 0;
      if (index < anchorIndex) pendingAnchorDeltaRef.current += nextHeight - previousHeight;
      if (measureFrameRef.current) return;
      measureFrameRef.current = requestAnimationFrame(() => {
        measureFrameRef.current = 0;
        if (!enabledRef.current) {
          pendingAnchorDeltaRef.current = 0;
          return;
        }
        const activeList = containerRef.current;
        const anchorDelta = pendingAnchorDeltaRef.current;
        pendingAnchorDeltaRef.current = 0;
        if (activeList && Math.abs(anchorDelta) >= 1) {
          setScrollTopInstant(activeList, Math.max(0, activeList.scrollTop + anchorDelta));
        }
        setHeightRevision((revision) => revision + 1);
      });
    }, [containerRef, messages]);
    React.useLayoutEffect(() => {
      if (enabled || !measureFrameRef.current) return;
      cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = 0;
      pendingAnchorDeltaRef.current = 0;
    }, [enabled]);
    React.useEffect(() => () => {
      if (measureFrameRef.current) cancelAnimationFrame(measureFrameRef.current);
      if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
      if (pinReleaseTimerRef.current) clearTimeout(pinReleaseTimerRef.current);
      if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
      if (routeRestoreFrameRef.current) cancelAnimationFrame(routeRestoreFrameRef.current);
    }, []);
    const scrollToIndex = React.useCallback((index, align = "center") => {
      const list = containerRef.current;
      const activePrefix = prefixRef.current;
      if (!list || index < 0 || index >= messages.length) return false;
      pinnedIndexRef.current = index;
      pinnedMessageKeyRef.current = keys[index] || null;
      if (pinReleaseTimerRef.current) clearTimeout(pinReleaseTimerRef.current);
      pinReleaseTimerRef.current = setTimeout(() => {
        releasePinnedIndex();
      }, 1500);
      const rowStart = activePrefix[index] || 0;
      const rowEnd = activePrefix[index + 1] || rowStart;
      const target = align === "start" ? rowStart : align === "end" ? rowEnd - list.clientHeight : rowStart - Math.max(0, (list.clientHeight - (rowEnd - rowStart)) / 2);
      setScrollTopInstant(list, Math.max(0, target));
      const start2 = Math.max(0, index - TRANSCRIPT_WINDOW_FALLBACK_ROWS);
      const end2 = Math.min(messages.length, index + TRANSCRIPT_WINDOW_FALLBACK_ROWS + 1);
      setRange({ sessionId, start: start2, end: end2 });
      return true;
    }, [containerRef, keys, messages.length, releasePinnedIndex, sessionId]);
    const prepareForPrepend = React.useCallback(() => {
      captureViewportAnchor();
      const anchor = viewportAnchorRef.current;
      if (!anchor || anchor.sessionId !== sessionId) return false;
      const index = keys.indexOf(anchor.key);
      if (index < 0) return false;
      pinnedIndexRef.current = index;
      pinnedMessageKeyRef.current = anchor.key;
      return true;
    }, [captureViewportAnchor, keys, sessionId]);
    const prepareForRouteChange = React.useCallback(() => {
      const list = containerRef.current;
      if (!enabled || !list) return false;
      captureViewportAnchor();
      const anchor = viewportAnchorRef.current;
      if (!anchor || anchor.sessionId !== sessionId || !anchor.key) return false;
      const index = keys.indexOf(anchor.key);
      if (index < 0) return false;
      pendingAnchorRestoreRef.current = {
        ...anchor,
        routeRestore: true,
        atBottom: list.scrollHeight - list.scrollTop - list.clientHeight < 80
      };
      pinnedIndexRef.current = index;
      pinnedMessageKeyRef.current = anchor.key;
      return true;
    }, [captureViewportAnchor, containerRef, enabled, keys, sessionId]);
    const cancelRouteRestore = React.useCallback(() => {
      if (!pendingAnchorRestoreRef.current?.routeRestore) return false;
      pendingAnchorRestoreRef.current = null;
      if (anchorReleaseTimerRef.current) clearTimeout(anchorReleaseTimerRef.current);
      anchorReleaseTimerRef.current = 0;
      if (routeRestoreFrameRef.current) cancelAnimationFrame(routeRestoreFrameRef.current);
      routeRestoreFrameRef.current = 0;
      releasePinnedIndex();
      captureViewportAnchor();
      return true;
    }, [captureViewportAnchor, releasePinnedIndex]);
    let start = 0;
    let end = messages.length;
    if (enabled) {
      if (range.sessionId === sessionId && range.end > range.start) {
        start = range.start;
        end = range.end;
      } else {
        start = Math.max(0, messages.length - TRANSCRIPT_WINDOW_FALLBACK_ROWS);
      }
    }
    return {
      enabled,
      start,
      end,
      totalHeight: prefix[prefix.length - 1] || 0,
      topSpacerHeight: enabled ? prefix[start] || 0 : 0,
      bottomSpacerHeight: enabled ? prefix[prefix.length - 1] - (prefix[end] || 0) : 0,
      onMeasure,
      scrollToIndex,
      prepareForPrepend,
      prepareForRouteChange,
      cancelRouteRestore
    };
  }
  function QueuedItem({ qm, onSteer, onDiscard, onEdit }) {
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [editing, setEditing] = React.useState(false);
    const [editText, setEditText] = React.useState(qm.content);
    const menuRef = React.useRef(null);
    React.useEffect(() => {
      if (!menuOpen) return;
      const close = (e) => {
        if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      };
      document.addEventListener("mousedown", close);
      return () => document.removeEventListener("mousedown", close);
    }, [menuOpen]);
    if (editing) {
      return /* @__PURE__ */ React.createElement("div", { className: "queued-item editing" }, /* @__PURE__ */ React.createElement(
        "textarea",
        {
          className: "queued-edit-input",
          value: editText,
          onChange: (e) => setEditText(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onEdit(editText);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          },
          rows: 2,
          autoFocus: true
        }
      ), /* @__PURE__ */ React.createElement("button", { className: "steer-btn", onClick: () => {
        onEdit(editText);
        setEditing(false);
      } }, "Save"), /* @__PURE__ */ React.createElement("button", { className: "queued-trash-btn", onClick: () => setEditing(false), title: "Cancel" }, "\u2715"));
    }
    if (qm.native) {
      return /* @__PURE__ */ React.createElement("div", { className: "queued-item native" }, /* @__PURE__ */ React.createElement("span", { className: "queued-item-text" }, qm.content), qm.status && qm.status !== "queued" && /* @__PURE__ */ React.createElement("span", { className: `queued-item-status ${qm.status}` }, qm.status), /* @__PURE__ */ React.createElement("div", { className: "queued-actions" }, /* @__PURE__ */ React.createElement("button", { className: "steer-btn", onClick: onSteer, title: "Click Steer in Codex" }, "Steer \u25B8"), /* @__PURE__ */ React.createElement("button", { className: "queued-trash-btn", onClick: onDiscard, title: "Delete queued message" }, "\u{1F5D1}")));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "queued-item" }, /* @__PURE__ */ React.createElement("span", { className: "queued-item-text" }, qm.content), /* @__PURE__ */ React.createElement("div", { className: "queued-actions" }, /* @__PURE__ */ React.createElement("button", { className: "steer-btn", onClick: onSteer, title: "Send to agent now" }, "Steer \u25B8"), /* @__PURE__ */ React.createElement("button", { className: "queued-trash-btn", onClick: onDiscard, title: "Discard message" }, "\u{1F5D1}"), /* @__PURE__ */ React.createElement("div", { className: "queued-menu-wrap", ref: menuRef }, /* @__PURE__ */ React.createElement("button", { className: "queued-more-btn", onClick: () => setMenuOpen(!menuOpen), title: "More options" }, "\xB7\xB7\xB7"), menuOpen && /* @__PURE__ */ React.createElement("div", { className: "queued-dropdown" }, /* @__PURE__ */ React.createElement("button", { onClick: () => {
      setMenuOpen(false);
      setEditText(qm.content);
      setEditing(true);
    } }, "\u270F Edit message"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
      setMenuOpen(false);
      onDiscard();
    } }, "\u{1F5D1} Discard")))));
  }
  function SessionCard({ session, health, unread, isThinking, isActive, agentConfig, activity, sessionMessages, hasBlockingPrompt, blockingPromptLabel, muted, pinned, workspaceLabel, menuOpen, onMenuToggle, onSelect, onClose, onManage, onPinChange, onAutomations, showAutomationsActive, onSkills, showSkillsActive }) {
    const sessionId = sessionIdOf3(session);
    const agent = sessionAgent(session, agentConfig);
    const winLabel = sessionSubLabel(session, sessionId, agentConfig);
    const chatTitle = sidebarChatTitle(session, sessionId, agentConfig, sessionMessages);
    const cardTitle = [chatTitle, winLabel || agent.name].filter(Boolean).join(" - ");
    const dotColor = HEALTH_COLOR[health] || "#444c56";
    const rateLimitedUntil = session?.rate_limited_until || null;
    const isHardLimited = session?.rate_limit_active === true;
    const pctUsed = session?.percent_used;
    const isAntigravitySession = session?.agent_type === "antigravity" || session?.agent_type === "antigravity_panel";
    const quotaSummary = isAntigravitySession ? formatAntigravityQuotaSummary(session?.antigravity_quota_models, 3) : "";
    const activityLabel = isThinking && activity?.label ? activity.label : null;
    const hostLabel = sessionHostLabel(session);
    const agentContext = workspaceLabel ? `${agent.name} / ${workspaceLabel}` : agent.name;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `session-card${isActive ? " active" : ""}${isHardLimited ? " rate-limited" : ""}${pinned ? " pinned" : ""}`,
        "data-session-id": sessionId,
        onClick: onSelect,
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          onSelect();
        },
        tabIndex: 0,
        "aria-label": `${chatTitle}. ${winLabel || agent.name}`,
        title: cardTitle || sessionId
      },
      /* @__PURE__ */ React.createElement("div", { className: "session-card-badge-wrap" }, /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "agent-badge",
          style: { color: agent.color, borderColor: agent.color + "55", background: agent.color + "18" }
        },
        agent.logo ? /* @__PURE__ */ React.createElement("img", { src: agent.logo, alt: agent.abbr, className: "agent-badge-logo" }) : agent.abbr
      ), /* @__PURE__ */ React.createElement("div", { className: "session-card-health", style: { background: dotColor }, title: health || "unknown" }), muted && /* @__PURE__ */ React.createElement("span", { className: "session-card-muted", title: "Notifications muted", "aria-label": "Notifications muted" }, "M"), pinned && /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: "session-card-pin-toggle",
          title: `Unpin ${chatTitle}`,
          "aria-label": `Unpin ${chatTitle}`,
          "aria-pressed": "true",
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onPinChange?.(false);
          }
        },
        /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\u{1F4CC}")
      ), /* @__PURE__ */ React.createElement("span", { className: "session-card-attention-slot" }, hasBlockingPrompt && /* @__PURE__ */ React.createElement("span", { className: "session-card-perm-badge", title: blockingPromptLabel || "Action required" }, "\u26A0"), !hasBlockingPrompt && isThinking && /* @__PURE__ */ React.createElement("span", { className: "session-card-native-status", title: activityLabel || "Thinking\u2026" }, /* @__PURE__ */ React.createElement(NativeActivitySpinner, { agentType: session?.agent_type, compact: true, animate: false })), !isThinking && !hasBlockingPrompt && unread > 0 && /* @__PURE__ */ React.createElement("span", { className: "session-card-badge" }, unread > 99 ? "99+" : unread))),
      /* @__PURE__ */ React.createElement("div", { className: "session-card-body" }, /* @__PURE__ */ React.createElement(
        FullTitleDisclosure,
        {
          title: chatTitle,
          disclosureKey: sessionId,
          kind: "session",
          wrapperClassName: "session-title-details",
          triggerClassName: "session-card-name",
          disclosureClassName: "session-title-disclosure",
          triggerLabel: `Show full title: ${chatTitle}`,
          triggerTag: "div"
        }
      ), /* @__PURE__ */ React.createElement("div", { className: `session-card-sub${hasBlockingPrompt ? " perm-active" : ""}` }, hasBlockingPrompt ? `${agentContext} \xB7 ${blockingPromptLabel || "Action required"}` : isHardLimited ? `${agentContext} \xB7 \u23F3 Rate limited${rateLimitedUntil && rateLimitedUntil !== "unknown" ? ` \xB7 ${rateLimitedUntil}` : ""}` : quotaSummary ? `${agentContext} \xB7 ${quotaSummary}` : isAntigravitySession && pctUsed != null ? `${agentContext} \xB7 \u{1F4CA} ${pctUsed}% used${rateLimitedUntil && rateLimitedUntil !== "unknown" ? ` \xB7 ${rateLimitedUntil}` : ""}` : pctUsed >= 80 ? `${agentContext} \xB7 \u{1F4CA} ${pctUsed}% used` : activityLabel ? `${agentContext} \xB7 ${activityLabel}` : hostLabel ? `${agentContext} \xB7 ${hostLabel}` : agentContext)),
      /* @__PURE__ */ React.createElement("div", { className: "session-card-right" }, /* @__PURE__ */ React.createElement(
        "details",
        {
          className: "session-card-menu",
          open: menuOpen,
          onToggle: (event) => onMenuToggle?.(event.currentTarget.open),
          onClick: (event) => event.stopPropagation()
        },
        /* @__PURE__ */ React.createElement("summary", { className: "session-card-manage", title: "Session actions", "aria-label": `Session actions for ${chatTitle}` }, "\u22EF"),
        /* @__PURE__ */ React.createElement("div", { className: "session-card-menu-popover", role: "menu", "aria-label": `Actions for ${chatTitle}` }, /* @__PURE__ */ React.createElement("button", { role: "menuitem", onClick: () => onPinChange?.(!pinned) }, pinned ? "Unpin chat" : "Pin chat"), /* @__PURE__ */ React.createElement("button", { role: "menuitem", onClick: () => onManage && onManage() }, "Manage session"), onAutomations && /* @__PURE__ */ React.createElement("button", { role: "menuitem", className: showAutomationsActive ? "active" : "", onClick: () => onAutomations() }, "Automations"), onSkills && /* @__PURE__ */ React.createElement("button", { role: "menuitem", className: showSkillsActive ? "active" : "", onClick: () => onSkills() }, "Skills"), /* @__PURE__ */ React.createElement("button", { role: "menuitem", className: "danger", onClick: () => onClose && onClose() }, "Close session"))
      ))
    );
  }
  function sessionCardMessagesKey(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) return "0";
    const first = list[0];
    const last = list[list.length - 1];
    return [
      list.length,
      first?.role || "",
      safeString(first?.content).slice(0, 120),
      last?.role || "",
      safeString(last?.content).slice(0, 120)
    ].join("");
  }
  function sessionCardAgentConfigKey(config) {
    if (!config) return "";
    return [
      config.model_id || "",
      config.effort || "",
      config.permission_mode || "",
      config.file_access_scope || ""
    ].join("");
  }
  function sessionCardActivityKey(activity) {
    if (!activity) return "";
    return [
      activity.kind || "",
      activity.label || "",
      activity.goal?.status || "",
      activity.goal?.label || ""
    ].join("");
  }
  function areSessionCardPropsEqual(prev, next) {
    return prev.session === next.session && prev.health === next.health && prev.unread === next.unread && prev.isThinking === next.isThinking && prev.isActive === next.isActive && prev.hasBlockingPrompt === next.hasBlockingPrompt && prev.blockingPromptLabel === next.blockingPromptLabel && prev.muted === next.muted && prev.pinned === next.pinned && prev.workspaceLabel === next.workspaceLabel && prev.menuOpen === next.menuOpen && prev.showAutomationsActive === next.showAutomationsActive && prev.showSkillsActive === next.showSkillsActive && sessionCardAgentConfigKey(prev.agentConfig) === sessionCardAgentConfigKey(next.agentConfig) && sessionCardActivityKey(prev.activity) === sessionCardActivityKey(next.activity) && sessionCardMessagesKey(prev.sessionMessages) === sessionCardMessagesKey(next.sessionMessages);
  }
  var MemoSessionCard = React.memo(SessionCard, areSessionCardPropsEqual);
  var SPINNER_SYMBOLS_FWD = ["\xB7", "\u2722", "*", "\u2736", "\u273B", "\u273D"];
  var SPINNER_SYMBOLS = [...SPINNER_SYMBOLS_FWD, ...[...SPINNER_SYMBOLS_FWD].reverse()];
  function ClaudeSpinner() {
    const [frame, setFrame] = React.useState(0);
    const [reducedMotion, setReducedMotion] = React.useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    React.useEffect(() => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return void 0;
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = (event) => setReducedMotion(event.matches);
      setReducedMotion(query.matches);
      query.addEventListener?.("change", update);
      return () => query.removeEventListener?.("change", update);
    }, []);
    React.useEffect(() => {
      if (reducedMotion) {
        setFrame(0);
        return void 0;
      }
      let remaining = SPINNER_SYMBOLS.length * 3;
      const id = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(id);
          setFrame(0);
          return;
        }
        setFrame((f) => (f + 1) % SPINNER_SYMBOLS.length);
      }, 120);
      return () => clearInterval(id);
    }, [reducedMotion]);
    return /* @__PURE__ */ React.createElement("span", { className: "claude-spinner-icon" }, SPINNER_SYMBOLS[frame]);
  }
  function formatActivityElapsed(updatedAt, nowMs) {
    const started = updatedAt ? new Date(updatedAt).getTime() : 0;
    if (!Number.isFinite(started) || started <= 0) return "";
    const totalSeconds = Math.max(0, Math.floor((nowMs - started) / 1e3));
    return formatClockDuration(totalSeconds, { includeSeconds: true });
  }
  function formatClockDuration(totalSeconds, { includeSeconds = false } = {}) {
    totalSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return includeSeconds ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${String(hours % 24).padStart(2, "0")}h ${String(remMinutes).padStart(2, "0")}m${includeSeconds ? ` ${String(seconds).padStart(2, "0")}s` : ""}`;
    }
    return `${hours}h ${String(remMinutes).padStart(2, "0")}m${includeSeconds ? ` ${String(seconds).padStart(2, "0")}s` : ""}`;
  }
  function formatGoalElapsed(goal, nowMs) {
    if (!goal) return "";
    const base = Number(goal.time_used_seconds ?? goal.timeUsedSeconds ?? 0) || 0;
    const goalUpdated = goal.updated_at ? new Date(goal.updated_at).getTime() : 0;
    const liveDelta = (goal.state || goal.status) === "active" && Number.isFinite(goalUpdated) && goalUpdated > 0 ? Math.max(0, Math.floor((nowMs - goalUpdated) / 1e3)) : 0;
    return formatClockDuration(base + liveDelta, { includeSeconds: true });
  }
  function ActivityRow({ activity, thinkingText, agentType, pinned = false }) {
    const kind = activity?.kind || "working";
    const meta = ACTIVITY_META[kind] || ACTIVITY_META.working;
    const goal = activity?.goal || null;
    const isActive = meta.tone === "thinking" || meta.tone === "info";
    const goalActive = (goal?.state || goal?.status) === "active";
    const hasCanonicalChannels = !!(activity?.thinking || activity?.current);
    const legacyText = String(thinkingText || activity?.thinkingContent || "").trim();
    const isClaude = agentType === "claude" || agentType === "claude_cli";
    const thinking = activity?.thinking || (!hasCanonicalChannels && (kind === "thinking" || isClaude) ? { text: legacyText, since: activity?.startedAt || activity?.updatedAt || null } : null);
    const current = activity?.current || (!hasCanonicalChannels && !thinking && isActive ? {
      kind: kind === "running_command" ? "tool" : "answer",
      label: activity?.label || (kind === "running_command" ? "Running command" : "Working"),
      partial: legacyText,
      since: activity?.startedAt || activity?.updatedAt || null
    } : null);
    const step = activity?.step || null;
    const usage = activity?.usage || null;
    const [nowMs, setNowMs] = React.useState(Date.now());
    const thinkingTimerSource = thinking ? thinking.since || activity?.startedAt || activity?.updatedAt : null;
    const currentTimerSource = current ? current.since || activity?.startedAt || activity?.updatedAt : null;
    const hasTimestamp = (value) => Boolean(value) && Number.isFinite(new Date(value).getTime());
    const hasLiveTimerSource = goalActive && hasTimestamp(goal?.updated_at) || hasTimestamp(thinkingTimerSource) || hasTimestamp(currentTimerSource);
    React.useEffect(() => {
      if (!hasLiveTimerSource) return void 0;
      const id = setInterval(() => setNowMs(Date.now()), 1e3);
      return () => clearInterval(id);
    }, [hasLiveTimerSource, goal?.updated_at, thinkingTimerSource, currentTimerSource]);
    const hint = activity?.interruptHint || activity?.interrupt_hint || "";
    const goalElapsed = goal ? formatGoalElapsed(goal, nowMs) : "";
    const goalText = String(goal?.text || goal?.objective || "").trim();
    const thinkingElapsed = thinking ? formatActivityElapsed(thinkingTimerSource, nowMs) : "";
    const currentElapsed = current ? formatActivityElapsed(currentTimerSource, nowMs) : "";
    if (!goal && !thinking && !current && !step && !usage) return null;
    return /* @__PURE__ */ React.createElement("div", { className: `live-status-stack${pinned ? " pinned" : ""}`, "data-testid": "live-status-stack" }, current && /* @__PURE__ */ React.createElement("div", { className: `live-current-status ${current.kind || "answer"}`, "data-live-channel": "current" }, /* @__PURE__ */ React.createElement("div", { className: "live-current-tool-heading" }, current.kind === "tool" ? /* @__PURE__ */ React.createElement("span", { className: "live-status-icon" }, "\u25B6") : /* @__PURE__ */ React.createElement(NativeActivitySpinner, { agentType, compact: true }), /* @__PURE__ */ React.createElement("span", { className: "live-status-label" }, current.label || (current.kind === "tool" ? "Running tool" : "Working")), /* @__PURE__ */ React.createElement("span", { className: "live-status-meta" }, [currentElapsed, hint].filter(Boolean).join(" \xB7 "))), current.partial && (current.kind === "tool" ? /* @__PURE__ */ React.createElement("pre", { className: "live-current-output" }, current.partial) : /* @__PURE__ */ React.createElement("p", { className: "live-current-narration" }, current.partial))), thinking && /* @__PURE__ */ React.createElement("div", { className: "live-thinking-row", "data-live-channel": "thinking" }, /* @__PURE__ */ React.createElement("div", { className: "live-thinking-heading" }, /* @__PURE__ */ React.createElement(NativeActivitySpinner, { agentType }), /* @__PURE__ */ React.createElement("span", { className: "live-status-label" }, thinking.label || activity?.label || "Thinking"), thinkingElapsed && /* @__PURE__ */ React.createElement("span", { className: "live-status-meta" }, thinkingElapsed)), thinking.text && /* @__PURE__ */ React.createElement("div", { className: "live-thinking-text" }, thinking.text)), step && /* @__PURE__ */ React.createElement("div", { className: "live-step-wrap", "data-live-channel": "step" }, /* @__PURE__ */ React.createElement("div", { className: "live-step-chip", title: step.text || "" }, step.state === "in_progress" ? /* @__PURE__ */ React.createElement(NativeActivitySpinner, { agentType, compact: true }) : /* @__PURE__ */ React.createElement("span", null, "\u25CC"), /* @__PURE__ */ React.createElement("span", null, "Step ", step.current || 1, " / ", step.total || 1), (step.added != null || step.deleted != null) && /* @__PURE__ */ React.createElement("span", { className: "live-step-diff" }, "\xB7 +", step.added || 0, " \u2212", step.deleted || 0))), goal && /* @__PURE__ */ React.createElement("details", { className: "live-goal-row", "data-live-channel": "goal" }, /* @__PURE__ */ React.createElement("summary", { title: goalText }, /* @__PURE__ */ React.createElement("span", { className: "live-status-icon" }, "\u26F3"), /* @__PURE__ */ React.createElement("span", { className: "live-status-label" }, goal.label || "Pursuing goal"), /* @__PURE__ */ React.createElement("span", { className: "live-goal-objective" }, goalText || "Active goal"), /* @__PURE__ */ React.createElement("span", { className: "live-status-meta" }, goalElapsed || goal.state || goal.status || "active")), goalText && /* @__PURE__ */ React.createElement("div", { className: "live-goal-expanded" }, goalText)), usage && /* @__PURE__ */ React.createElement("div", { className: "live-usage-banner", "data-live-channel": "usage", role: "status" }, /* @__PURE__ */ React.createElement("div", { className: "live-usage-title" }, usage.title || "You're out of Codex and Work usage"), /* @__PURE__ */ React.createElement("div", { className: "live-usage-detail" }, usage.detail || (usage.resets_at ? `Your rate limit resets at ${usage.resets_at}.` : "Usage is currently exhausted."))));
  }
  function TaskList({ taskList, sessionId }) {
    const planBlock = taskList?.content_blocks?.find((block) => block?.type === "plan");
    const typedTaskList = planBlock ? { ...taskList, ...planBlock } : taskList;
    if (!typedTaskList || !typedTaskList.tasks || typedTaskList.tasks.length === 0) return null;
    const storageKey = sessionId ? `remote-agent-chat:task-list-collapsed:${sessionId}` : null;
    const defaultCollapsed = false;
    const [collapsed, setCollapsed] = React.useState(() => {
      if (!storageKey) return defaultCollapsed;
      const saved = localStorage.getItem(storageKey);
      return saved == null ? defaultCollapsed : saved === "1";
    });
    React.useEffect(() => {
      if (!storageKey) {
        setCollapsed(defaultCollapsed);
        return;
      }
      const saved = localStorage.getItem(storageKey);
      setCollapsed(saved == null ? defaultCollapsed : saved === "1");
    }, [storageKey, defaultCollapsed]);
    const toggleCollapsed = () => {
      setCollapsed((prev) => {
        const next = !prev;
        if (storageKey) localStorage.setItem(storageKey, next ? "1" : "0");
        return next;
      });
    };
    const stateIcon = { completed: "\u2713", in_progress: "\u25CC", pending: "\u25CB" };
    const stateCls = { completed: "done", in_progress: "active", pending: "" };
    const activeTask = typedTaskList.tasks.find((t) => t.state === "in_progress");
    return /* @__PURE__ */ React.createElement("div", { className: `codex-task-list${collapsed ? " collapsed" : ""}` }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "codex-task-header",
        onClick: toggleCollapsed,
        "aria-expanded": !collapsed,
        title: collapsed ? "Expand task list" : "Collapse task list"
      },
      /* @__PURE__ */ React.createElement("span", { className: "codex-task-chevron" }, collapsed ? "\u25B8" : "\u25BE"),
      /* @__PURE__ */ React.createElement("span", { className: "codex-task-count" }, typedTaskList.completed, "/", typedTaskList.total, " tasks"),
      collapsed && activeTask?.text && /* @__PURE__ */ React.createElement("span", { className: "codex-task-active-summary" }, activeTask.text)
    ), !collapsed && /* @__PURE__ */ React.createElement("div", { className: "codex-task-items" }, typedTaskList.tasks.map((t, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: `codex-task-item ${stateCls[t.state] || ""}` }, /* @__PURE__ */ React.createElement("span", { className: "codex-task-icon" }, stateIcon[t.state] || "\u25CB"), /* @__PURE__ */ React.createElement("span", { className: "codex-task-text" }, t.text)))));
  }
  function ClineContextCard({ card, tone = "cline" }) {
    if (!card) return null;
    const pct = Number.isFinite(Number(card.percent_used)) ? Math.max(0, Math.min(100, Number(card.percent_used))) : null;
    const title = safeString(card.title || "Current context");
    const subtitle = safeString(card.subtitle || "");
    const detail = safeString(card.detail || "");
    const usageLabel = safeString(card.label || card.usage_label || "");
    return /* @__PURE__ */ React.createElement("div", { className: `cline-context-card ${tone}-context-card` }, /* @__PURE__ */ React.createElement("div", { className: "cline-context-header" }, /* @__PURE__ */ React.createElement("div", { className: "cline-context-copy" }, /* @__PURE__ */ React.createElement("div", { className: "cline-context-title" }, title), subtitle && /* @__PURE__ */ React.createElement("div", { className: "cline-context-subtitle" }, subtitle), detail && /* @__PURE__ */ React.createElement("div", { className: "cline-context-detail" }, detail)), usageLabel && /* @__PURE__ */ React.createElement("div", { className: "cline-context-usage" }, usageLabel)), pct != null && /* @__PURE__ */ React.createElement("div", { className: "cline-context-meter", title: `${card.percent_used}% of context window used` }, /* @__PURE__ */ React.createElement("div", { className: "cline-context-meter-fill", style: { width: `${pct}%` } })));
  }
  function promptChoiceId(choice, index) {
    return choice?.choice_id || choice?.id || choice?.value || `choice-${index}`;
  }
  function promptChoiceLabel(choice, index) {
    return choice?.label || choice?.title || choice?.text || choice?.name || promptChoiceId(choice, index);
  }
  function typedPromptBlock(prompt, acceptedTypes) {
    const accepted = new Set(Array.isArray(acceptedTypes) ? acceptedTypes : [acceptedTypes]);
    return (Array.isArray(prompt?.content_blocks) ? prompt.content_blocks : []).find((block) => accepted.has(block?.type)) || null;
  }
  function promptBody(prompt) {
    return typedPromptBlock(prompt, "prompt")?.content || prompt?.prompt_text || prompt?.message || prompt?.text || "Agent requires permission to continue.";
  }
  function formatPromptCountdown(msLeft) {
    const totalSeconds = Math.max(0, Math.ceil(msLeft / 1e3));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  function PermissionOverlay({ prompt, sessionId, agentType, onRespond, onDismissFocus }) {
    const [now, setNow] = React.useState(Date.now());
    const [questionSelections, setQuestionSelections] = React.useState({});
    const [questionOtherText, setQuestionOtherText] = React.useState({});
    const [alternateInstruction, setAlternateInstruction] = React.useState("");
    const [keyboardChoiceId, setKeyboardChoiceId] = React.useState(null);
    const [keyboardDismissed, setKeyboardDismissed] = React.useState(false);
    React.useEffect(() => {
      const timer = setInterval(() => setNow(Date.now()), 500);
      return () => clearInterval(timer);
    }, []);
    React.useEffect(() => {
      setQuestionSelections({});
      setQuestionOtherText({});
      setAlternateInstruction("");
      setKeyboardChoiceId(null);
      setKeyboardDismissed(false);
    }, [prompt?.prompt_id]);
    const timeoutMs = Math.max(0, Number(prompt?.timeout_ms) || 0);
    const receivedAt = Number(prompt?.received_at) || Date.now();
    const msLeft = timeoutMs > 0 ? Math.max(0, timeoutMs - (now - receivedAt)) : 0;
    const choices = Array.isArray(prompt?.choices) ? prompt.choices : [];
    const submittingChoiceId = prompt?.submitting_choice_id || null;
    const defaultChoiceId = prompt?.default_choice || null;
    const questions = prompt?.kind === "question" && Array.isArray(prompt?.questions) ? prompt.questions.filter((question) => Array.isArray(question?.choices) && question.choices.length > 0) : [];
    const structuredQuestion = questions.length > 0;
    const claudeActionPrompt = agentType === "claude" && !structuredQuestion;
    const claudeCommand = safeString(prompt?.command).trim();
    const claudeTitle = safeString(prompt?.title).trim() || (!claudeCommand ? promptBody(prompt) : "Allow this action?");
    const claudeDescription = safeString(prompt?.description).trim();
    const alternateInstructionSupported = claudeActionPrompt && prompt?.alternate_instruction_supported === true;
    const structuredKeyboardChoices = questions.flatMap((question) => question.choices.map((choice, index) => ({
      question,
      choiceId: promptChoiceId(choice, index)
    }))).slice(0, 9);
    const toggleQuestionChoice = (question, choiceId) => {
      setQuestionSelections((prev) => {
        const current = Array.isArray(prev[question.question_id]) ? prev[question.question_id] : [];
        const next = question.multi_select ? current.includes(choiceId) ? current.filter((id) => id !== choiceId) : [...current, choiceId] : [choiceId];
        return { ...prev, [question.question_id]: next };
      });
    };
    const questionReady = questions.every((question) => {
      const selected = questionSelections[question.question_id] || [];
      if (selected.length === 0) return false;
      return selected.every((choiceId) => {
        const choice = question.choices.find((item, index) => promptChoiceId(item, index) === choiceId);
        return !choice?.requires_text || safeString(questionOtherText[`${question.question_id}:${choiceId}`]).trim();
      });
    });
    const submitQuestionAnswers = () => {
      if (!questionReady || submittingChoiceId) return;
      const answers = questions.map((question) => {
        const choiceIds = questionSelections[question.question_id] || [];
        const otherChoice = question.choices.find((choice, index) => choice.requires_text && choiceIds.includes(promptChoiceId(choice, index)));
        const otherChoiceIndex = otherChoice ? question.choices.indexOf(otherChoice) : -1;
        const otherChoiceId = otherChoice ? promptChoiceId(otherChoice, otherChoiceIndex) : null;
        return {
          question_id: question.question_id,
          choice_ids: choiceIds,
          ...otherChoiceId ? { other_text: safeString(questionOtherText[`${question.question_id}:${otherChoiceId}`]).trim() } : {}
        };
      });
      onRespond(sessionId, prompt.prompt_id, null, { answers });
    };
    React.useEffect(() => {
      const handlePromptKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          const claudeCancelChoice = claudeActionPrompt ? choices.find((choice, index) => /^(?:reject|deny|cancel|block|not now|no)\b/i.test(
            promptChoiceLabel(choice, index).replace(/^\d+\s+/, "")
          )) : null;
          if (claudeCancelChoice && !submittingChoiceId) {
            onRespond(sessionId, prompt.prompt_id, promptChoiceId(claudeCancelChoice, choices.indexOf(claudeCancelChoice)));
            return;
          }
          setKeyboardDismissed(true);
          onDismissFocus?.();
          return;
        }
        if (keyboardDismissed) return;
        const editableTarget = isEditableShortcutTarget(event.target);
        const otherTextSubmit = event.key === "Enter" && event.target?.closest?.(".permission-other-input");
        const alternateInstructionSubmit = event.key === "Enter" && !event.shiftKey && event.target?.closest?.(".permission-alternate-input");
        const composerTarget = event.target?.matches?.(".input-area textarea");
        if (alternateInstructionSubmit) {
          event.preventDefault();
          const instruction = alternateInstruction.trim();
          if (instruction && !submittingChoiceId) {
            onRespond(sessionId, prompt.prompt_id, null, { instruction });
          }
          return;
        }
        if (submittingChoiceId || editableTarget && !otherTextSubmit && !composerTarget) return;
        if (/^[1-9]$/.test(event.key)) {
          const optionIndex = Number(event.key) - 1;
          event.preventDefault();
          if (structuredQuestion) {
            const option = structuredKeyboardChoices[optionIndex];
            if (option) toggleQuestionChoice(option.question, option.choiceId);
          } else {
            const choice = choices[optionIndex];
            if (choice) setKeyboardChoiceId(promptChoiceId(choice, optionIndex));
          }
          return;
        }
        if (event.key !== "Enter") return;
        if (structuredQuestion) {
          if (questionReady) {
            event.preventDefault();
            submitQuestionAnswers();
          }
          return;
        }
        const selectedChoiceId = keyboardChoiceId || defaultChoiceId;
        if (selectedChoiceId && choices.some((choice, index) => promptChoiceId(choice, index) === selectedChoiceId)) {
          event.preventDefault();
          onRespond(sessionId, prompt.prompt_id, selectedChoiceId);
        }
      };
      window.addEventListener("keydown", handlePromptKey);
      return () => window.removeEventListener("keydown", handlePromptKey);
    }, [
      alternateInstruction,
      choices,
      claudeActionPrompt,
      defaultChoiceId,
      keyboardDismissed,
      keyboardChoiceId,
      onDismissFocus,
      onRespond,
      prompt?.prompt_id,
      questionReady,
      questionSelections,
      questionOtherText,
      sessionId,
      structuredKeyboardChoices,
      structuredQuestion,
      submittingChoiceId
    ]);
    return /* @__PURE__ */ React.createElement("div", { className: "permission-overlay" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `permission-card${claudeActionPrompt ? " permission-card-claude" : ""}`,
        role: "dialog",
        "aria-modal": "false",
        "aria-label": claudeActionPrompt ? "Claude Code permission prompt" : "Permission or question prompt",
        onPointerDown: () => setKeyboardDismissed(false)
      },
      claudeActionPrompt ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "permission-title permission-title-claude" }, claudeTitle), claudeCommand && /* @__PURE__ */ React.createElement("pre", { className: "permission-command-claude" }, claudeCommand), claudeDescription && /* @__PURE__ */ React.createElement("div", { className: "permission-body permission-body-claude" }, claudeDescription)) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "permission-eyebrow" }, "Permission Required"), /* @__PURE__ */ React.createElement("div", { className: "permission-title" }, "Agent Paused In ", sessionId ? sessionSubLabel(sessionId, sessionId) : "Active Session"), /* @__PURE__ */ React.createElement("div", { className: "permission-body" }, promptBody(prompt)), /* @__PURE__ */ React.createElement("div", { className: "permission-meta" }, timeoutMs > 0 && /* @__PURE__ */ React.createElement("span", { className: "permission-timer" }, "Auto-choice in ", formatPromptCountdown(msLeft)), defaultChoiceId && /* @__PURE__ */ React.createElement("span", { className: "permission-default" }, "Default: ", defaultChoiceId))),
      prompt?.error && /* @__PURE__ */ React.createElement("div", { className: "permission-error" }, prompt.error),
      /* @__PURE__ */ React.createElement("div", { className: `permission-actions${structuredQuestion ? " permission-question-list" : ""}` }, structuredQuestion ? questions.map((question, questionIndex) => /* @__PURE__ */ React.createElement("fieldset", { className: "permission-question", key: question.question_id || questionIndex }, /* @__PURE__ */ React.createElement("legend", null, safeString(question.label, `Question ${questionIndex + 1}`)), safeString(question.message).trim() && /* @__PURE__ */ React.createElement("div", { className: "permission-question-message" }, safeString(question.message)), /* @__PURE__ */ React.createElement("div", { className: "permission-question-options" }, question.choices.map((choice, index) => {
        const choiceId = promptChoiceId(choice, index);
        const selected = (questionSelections[question.question_id] || []).includes(choiceId);
        const otherKey = `${question.question_id}:${choiceId}`;
        return /* @__PURE__ */ React.createElement("div", { className: "permission-question-option", key: choiceId }, /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            className: `permission-action${selected ? " selected" : ""}`,
            role: question.multi_select ? "checkbox" : "radio",
            "aria-checked": selected,
            disabled: !!submittingChoiceId,
            "aria-keyshortcuts": structuredKeyboardChoices.findIndex((option) => option.question === question && option.choiceId === choiceId) >= 0 ? String(structuredKeyboardChoices.findIndex((option) => option.question === question && option.choiceId === choiceId) + 1) : void 0,
            onClick: () => toggleQuestionChoice(question, choiceId)
          },
          structuredKeyboardChoices.findIndex((option) => option.question === question && option.choiceId === choiceId) >= 0 && /* @__PURE__ */ React.createElement("kbd", { className: "permission-key-hint" }, structuredKeyboardChoices.findIndex((option) => option.question === question && option.choiceId === choiceId) + 1),
          /* @__PURE__ */ React.createElement("span", { className: "permission-choice-marker", "aria-hidden": "true" }, question.multi_select ? selected ? "\u2713" : "\u25A1" : selected ? "\u25CF" : "\u25CB"),
          /* @__PURE__ */ React.createElement("span", { className: "permission-choice-copy" }, /* @__PURE__ */ React.createElement("span", null, promptChoiceLabel(choice, index)), safeString(choice?.description).trim() && /* @__PURE__ */ React.createElement("span", { className: "permission-action-desc" }, safeString(choice.description)))
        ), selected && choice.requires_text && /* @__PURE__ */ React.createElement(
          "input",
          {
            className: "permission-other-input",
            type: "text",
            value: questionOtherText[otherKey] || "",
            maxLength: 2e3,
            disabled: !!submittingChoiceId,
            placeholder: "Enter another answer",
            "aria-label": `${promptChoiceLabel(choice, index)} answer`,
            onChange: (event) => setQuestionOtherText((prev) => ({ ...prev, [otherKey]: event.target.value }))
          }
        ));
      })))) : choices.map((choice, index) => {
        const choiceId = promptChoiceId(choice, index);
        const isPending = submittingChoiceId === choiceId;
        const isDefault = defaultChoiceId && defaultChoiceId === choiceId;
        const isSelected = keyboardChoiceId === choiceId;
        const isNativeSelected = claudeActionPrompt && !keyboardChoiceId && !defaultChoiceId && index === 0;
        const displayLabel = claudeActionPrompt ? promptChoiceLabel(choice, index).replace(new RegExp(`^${index + 1}\\s+`), "") : promptChoiceLabel(choice, index);
        const destination = claudeActionPrompt ? safeString(choice?.destination).trim() : "";
        const labelPrefix = destination && displayLabel.endsWith(destination) ? displayLabel.slice(0, -destination.length) : displayLabel;
        return /* @__PURE__ */ React.createElement(
          "button",
          {
            key: choiceId,
            className: `permission-action${isDefault ? " default" : ""}${isSelected || isNativeSelected ? " selected" : ""}${isPending ? " pending" : ""}`,
            disabled: !!submittingChoiceId,
            "aria-pressed": isSelected || isNativeSelected,
            "aria-keyshortcuts": index < 9 ? String(index + 1) : void 0,
            onClick: () => onRespond(sessionId, prompt.prompt_id, choiceId)
          },
          index < 9 && /* @__PURE__ */ React.createElement("kbd", { className: "permission-key-hint" }, safeString(choice?.shortcut, String(index + 1))),
          /* @__PURE__ */ React.createElement("span", null, labelPrefix, destination && /* @__PURE__ */ React.createElement("span", { className: "permission-choice-destination-claude" }, destination)),
          safeString(choice?.description).trim() && /* @__PURE__ */ React.createElement("span", { className: "permission-action-desc" }, safeString(choice.description)),
          isPending && /* @__PURE__ */ React.createElement("span", { className: "permission-action-state" }, "Sending...")
        );
      })),
      alternateInstructionSupported && /* @__PURE__ */ React.createElement(
        "textarea",
        {
          className: "permission-alternate-input",
          rows: "1",
          maxLength: 2e3,
          value: alternateInstruction,
          disabled: !!submittingChoiceId,
          placeholder: safeString(prompt?.alternate_instruction_placeholder, "Tell Claude what to do instead"),
          "aria-label": "Tell Claude what to do instead",
          onChange: (event) => setAlternateInstruction(event.target.value)
        }
      ),
      structuredQuestion && /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: "permission-question-submit",
          disabled: !questionReady || !!submittingChoiceId,
          onClick: submitQuestionAnswers
        },
        submittingChoiceId ? "Sending..." : safeString(prompt.submit_label, "Submit answers")
      ),
      /* @__PURE__ */ React.createElement("div", { className: "permission-keyboard-help" }, claudeActionPrompt ? safeString(prompt?.cancel_hint, "Esc to cancel") : "1\u20139 select \xB7 Enter submit \xB7 Esc return to composer")
    ));
  }
  function errorPromptActionLabel(action) {
    return safeString(action?.label, "Action");
  }
  function isBlockingErrorPrompt(prompt) {
    return !!prompt && prompt.blocking !== false && prompt.display_mode !== "inline";
  }
  function ErrorPromptOverlay({ prompt, sessionId, onRespond }) {
    const block = typedPromptBlock(prompt, ["error", "notice"]);
    const actions = Array.isArray(prompt?.actions) ? prompt.actions : block?.actions || [];
    const submittingActionId = prompt?.submitting_action_id || null;
    const errorOutput = safeString(prompt?.error_output || block?.error_output).trim();
    return /* @__PURE__ */ React.createElement("div", { className: "permission-overlay" }, /* @__PURE__ */ React.createElement("div", { className: "permission-card error-prompt-card" }, /* @__PURE__ */ React.createElement("div", { className: "permission-eyebrow error-prompt-eyebrow" }, "Action Required"), /* @__PURE__ */ React.createElement("div", { className: "permission-title" }, safeString(block?.label || prompt?.title, "Error handling model response")), /* @__PURE__ */ React.createElement("div", { className: "permission-body" }, safeString(block?.content || prompt?.message, "There was an error handling the model response.")), errorOutput && /* @__PURE__ */ React.createElement("div", { className: "error-prompt-output-wrap" }, /* @__PURE__ */ React.createElement("div", { className: "error-prompt-output-label" }, "Error Output"), /* @__PURE__ */ React.createElement("pre", { className: "error-prompt-output" }, errorOutput)), prompt?.error && /* @__PURE__ */ React.createElement("div", { className: "permission-error" }, prompt.error), /* @__PURE__ */ React.createElement("div", { className: "permission-actions" }, actions.map((action) => {
      const actionId = safeString(action?.action_id);
      const isPending = submittingActionId === actionId;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: actionId || errorPromptActionLabel(action),
          className: `permission-action error-prompt-action${isPending ? " pending" : ""}`,
          disabled: !!submittingActionId,
          onClick: () => onRespond(sessionId, prompt.prompt_id, actionId)
        },
        /* @__PURE__ */ React.createElement("span", null, errorPromptActionLabel(action)),
        isPending && /* @__PURE__ */ React.createElement("span", { className: "permission-action-state" }, "Sending...")
      );
    }))));
  }
  function ErrorPromptInline({ prompt, sessionId, onRespond }) {
    const block = typedPromptBlock(prompt, ["error", "notice"]);
    const actions = Array.isArray(prompt?.actions) ? prompt.actions : block?.actions || [];
    const submittingActionId = prompt?.submitting_action_id || null;
    const errorOutput = safeString(prompt?.error_output || block?.error_output).trim();
    return /* @__PURE__ */ React.createElement("div", { className: "inline-error-prompt" }, /* @__PURE__ */ React.createElement("div", { className: "inline-error-prompt-body" }, /* @__PURE__ */ React.createElement("div", { className: "inline-error-prompt-title" }, safeString(block?.label || prompt?.title, "Codex requires attention")), /* @__PURE__ */ React.createElement("div", { className: "inline-error-prompt-message" }, safeString(block?.content || prompt?.message, "There was an error handling the model response.")), errorOutput && /* @__PURE__ */ React.createElement("pre", { className: "inline-error-prompt-output" }, errorOutput), prompt?.error && /* @__PURE__ */ React.createElement("div", { className: "permission-error" }, prompt.error)), /* @__PURE__ */ React.createElement("div", { className: "inline-error-prompt-actions" }, actions.map((action) => {
      const actionId = safeString(action?.action_id);
      const isPending = submittingActionId === actionId;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: actionId || errorPromptActionLabel(action),
          className: `permission-action error-prompt-action${isPending ? " pending" : ""}`,
          disabled: !!submittingActionId,
          onClick: () => onRespond(sessionId, prompt.prompt_id, actionId)
        },
        /* @__PURE__ */ React.createElement("span", null, errorPromptActionLabel(action)),
        isPending && /* @__PURE__ */ React.createElement("span", { className: "permission-action-state" }, "Sending...")
      );
    })));
  }
  function NewSessionPanel({ launchStates, onLaunch, onResume, onClose, workspaces, showTestSessions = false }) {
    const [mode, setMode] = React.useState("new");
    const [agentType, setAgentType] = React.useState("claude");
    const [wsMode, setWsMode] = React.useState("");
    const [customPath, setCustomPath] = React.useState("");
    const [claudeCliModel, setClaudeCliModel] = React.useState("deepseek-v4-pro:cloud");
    const [codexCliModel, setCodexCliModel] = React.useState("gpt-5.5");
    const [cursorCliModel, setCursorCliModel] = React.useState("grok-4.5-fast-high");
    const [requestId, setRequestId] = React.useState(null);
    const [history, setHistory] = React.useState([]);
    const [historyLoading, setHistoryLoading] = React.useState(false);
    const currentLaunch = requestId ? launchStates[requestId] : null;
    const isLaunching = currentLaunch?.status === "launching";
    const launchError = currentLaunch?.status === "failed" ? currentLaunch.error : null;
    const hasWorkspaces = (workspaces || []).length > 0;
    React.useEffect(() => {
      if (requestId && !launchStates[requestId]) onClose();
    }, [launchStates, requestId]);
    React.useEffect(() => {
      if (mode === "resume" && !historyLoading) {
        setHistoryLoading(true);
        fetch(`/api/sessions/history?limit=30&include_test=${showTestSessions ? "true" : "false"}`, { credentials: "same-origin" }).then((r) => r.json()).then((data) => setHistory(data.sessions || [])).catch(() => setHistory([])).finally(() => setHistoryLoading(false));
      }
    }, [mode, showTestSessions]);
    function handleSubmit(e) {
      e.preventDefault();
      if (isLaunching) return;
      const wsPath = wsMode === "custom" ? customPath.trim() : wsMode;
      const launchOptions = agentType === "claude_cli" ? { model_id: claudeCliModel.trim() || "default" } : agentType === "codex_cli" ? { model_id: codexCliModel.trim() || "gpt-5.5", permission_mode: "workspace-write", effort: "medium" } : agentType === "cursor_cli" ? { model_id: cursorCliModel.trim() || "grok-4.5-fast-high", permission_mode: "force" } : {};
      const rid = onLaunch(agentType, wsPath || void 0, launchOptions);
      setRequestId(rid);
    }
    function handleResume(session) {
      if (isLaunching) return;
      const resumeAgentType = session.agent_type || agentType;
      const wsPath = session.workspace_path || (wsMode === "custom" ? customPath.trim() : wsMode) || void 0;
      const rid = onResume(session.session_id, resumeAgentType, wsPath, {
        cli_session_id: session.cli_session_id || void 0,
        model_id: session.model_id || void 0,
        permission_mode: session.permission_mode || void 0
      });
      setRequestId(rid);
    }
    function timeAgo(isoStr) {
      if (!isoStr) return "";
      const diff = Date.now() - new Date(isoStr).getTime();
      const mins = Math.floor(diff / 6e4);
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    }
    return /* @__PURE__ */ React.createElement("div", { className: "new-session-panel" }, /* @__PURE__ */ React.createElement("div", { className: "new-session-header" }, /* @__PURE__ */ React.createElement("span", null, mode === "new" ? "New Session" : "Resume Session"), /* @__PURE__ */ React.createElement("button", { className: "new-session-close", onClick: onClose, title: "Cancel" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "new-session-tabs" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `new-session-tab${mode === "new" ? " active" : ""}`,
        onClick: () => setMode("new")
      },
      "New"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `new-session-tab${mode === "resume" ? " active" : ""}`,
        onClick: () => setMode("resume")
      },
      "Resume"
    )), mode === "new" ? /* @__PURE__ */ React.createElement("form", { className: "new-session-form", onSubmit: handleSubmit }, /* @__PURE__ */ React.createElement("div", { className: "new-session-agents" }, Object.entries(AGENT_CONFIG).map(([key, cfg]) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key,
        type: "button",
        className: `new-session-agent-btn${agentType === key ? " selected" : ""}`,
        style: agentType === key ? { borderColor: cfg.color, color: cfg.color, background: cfg.color + "18" } : {},
        onClick: () => setAgentType(key)
      },
      /* @__PURE__ */ React.createElement("span", { className: "agent-badge new-session-badge", style: { color: cfg.color, borderColor: cfg.color + "55", background: cfg.color + "18" } }, cfg.abbr),
      /* @__PURE__ */ React.createElement("span", { className: "new-session-agent-name" }, cfg.name)
    ))), hasWorkspaces ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "new-session-workspace",
        value: wsMode,
        onChange: (e) => setWsMode(e.target.value),
        disabled: isLaunching
      },
      /* @__PURE__ */ React.createElement("option", { value: "" }, "No workspace (default)"),
      workspaces.map((w, i) => /* @__PURE__ */ React.createElement("option", { key: i, value: w.path || w.title }, w.title)),
      /* @__PURE__ */ React.createElement("option", { value: "custom" }, "Custom path\u2026")
    ), wsMode === "custom" && /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "new-session-workspace",
        type: "text",
        placeholder: "Enter workspace path",
        value: customPath,
        onChange: (e) => setCustomPath(e.target.value),
        disabled: isLaunching,
        autoFocus: true
      }
    )) : /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "new-session-workspace",
        type: "text",
        placeholder: "Workspace path (optional)",
        value: customPath,
        onChange: (e) => setCustomPath(e.target.value),
        disabled: isLaunching
      }
    ), agentType === "claude_cli" && /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "new-session-workspace",
        type: "text",
        placeholder: "Claude CLI model, e.g. deepseek-v4-pro:cloud",
        value: claudeCliModel,
        onChange: (e) => setClaudeCliModel(e.target.value),
        disabled: isLaunching
      }
    ), agentType === "codex_cli" && /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "new-session-workspace",
        value: codexCliModel,
        onChange: (e) => setCodexCliModel(e.target.value),
        disabled: isLaunching
      },
      KNOWN_CODEX_CLI_MODELS.map((model) => /* @__PURE__ */ React.createElement("option", { key: model.id, value: model.id }, model.label))
    ), agentType === "cursor_cli" && /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "new-session-workspace",
        value: cursorCliModel,
        onChange: (e) => setCursorCliModel(e.target.value),
        disabled: isLaunching
      },
      KNOWN_CURSOR_CLI_MODELS.map((model) => /* @__PURE__ */ React.createElement("option", { key: model.id, value: model.id }, model.label))
    ), launchError && /* @__PURE__ */ React.createElement("div", { className: "new-session-error" }, launchError), /* @__PURE__ */ React.createElement("button", { className: "new-session-submit", type: "submit", disabled: isLaunching }, isLaunching ? /* @__PURE__ */ React.createElement("span", { className: "new-session-spinner" }) : null, isLaunching ? "Launching\u2026" : "Launch")) : /* @__PURE__ */ React.createElement("div", { className: "new-session-form" }, /* @__PURE__ */ React.createElement("div", { className: "new-session-agents" }, Object.entries(AGENT_CONFIG).map(([key, cfg]) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key,
        type: "button",
        className: `new-session-agent-btn${agentType === key ? " selected" : ""}`,
        style: agentType === key ? { borderColor: cfg.color, color: cfg.color, background: cfg.color + "18" } : {},
        onClick: () => setAgentType(key)
      },
      /* @__PURE__ */ React.createElement("span", { className: "agent-badge new-session-badge", style: { color: cfg.color, borderColor: cfg.color + "55", background: cfg.color + "18" } }, cfg.abbr),
      /* @__PURE__ */ React.createElement("span", { className: "new-session-agent-name" }, cfg.name)
    ))), launchError && /* @__PURE__ */ React.createElement("div", { className: "new-session-error" }, launchError), historyLoading ? /* @__PURE__ */ React.createElement("div", { className: "session-history-loading" }, /* @__PURE__ */ React.createElement("span", { className: "new-session-spinner" }), " Loading history\u2026") : history.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "session-history-empty" }, "No past sessions found") : /* @__PURE__ */ React.createElement("div", { className: "session-history-list" }, history.filter((s) => !agentType || !s.agent_type || s.agent_type === agentType).map((s) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: s.session_id,
        className: "session-history-item",
        onClick: () => handleResume(s),
        disabled: isLaunching
      },
      /* @__PURE__ */ React.createElement("div", { className: "session-history-preview" }, s.preview || "(empty session)"),
      /* @__PURE__ */ React.createElement("div", { className: "session-history-meta" }, /* @__PURE__ */ React.createElement("span", null, s.message_count, " msg", s.message_count !== 1 ? "s" : ""), s.agent_type && /* @__PURE__ */ React.createElement("span", { className: "session-history-workspace" }, AGENT_CONFIG[s.agent_type]?.name || s.agent_type), s.workspace_name && /* @__PURE__ */ React.createElement("span", { className: "session-history-workspace", title: s.workspace_path || "" }, s.workspace_name), /* @__PURE__ */ React.createElement("span", null, timeAgo(s.last_active_at)))
    )))));
  }
  var PERMISSION_MODES = {
    claude: [
      { value: "default", label: "Ask before edit" },
      { value: "acceptEdits", label: "Edit automatically" },
      { value: "plan", label: "Plan mode" },
      { value: "auto", label: "Auto mode" },
      { value: "bypassPermissions", label: "Bypass permissions" }
    ],
    claude_cli: [
      { value: "default", label: "Default" },
      { value: "acceptEdits", label: "Accept edits" },
      { value: "auto", label: "Auto" },
      { value: "bypassPermissions", label: "Bypass permissions" },
      { value: "dontAsk", label: "Do not ask" },
      { value: "plan", label: "Plan" }
    ],
    continue_yolo: [
      { value: "ask", label: "Ask for permissions" },
      { value: "bypass", label: "Bypass permissions" }
    ],
    roo_code: [
      { value: "BRRR", label: "BRRR" },
      { value: "YOLO", label: "YOLO" },
      { value: "Ask", label: "Ask" },
      { value: "Auto-approve", label: "Auto-approve" }
    ],
    cline: [
      { value: "YOLO", label: "YOLO" }
    ],
    codex_cli: [
      { value: "read-only", label: "Read only" },
      { value: "workspace-write", label: "Workspace write" },
      { value: "danger-full-access", label: "Full access" }
    ],
    cursor_cli: [
      { value: "default", label: "Default" },
      { value: "force", label: "Force (Yolo)" },
      { value: "plan", label: "Plan" },
      { value: "ask", label: "Ask" }
    ],
    codex: [],
    // Codex permission mode not configurable via settings
    gemini: []
    // Gemini permission mode not configurable via settings
  };
  function defaultPermissionModeFor(agentType) {
    if (agentType === "codex_cli") return "workspace-write";
    if (agentType === "cursor_cli") return "force";
    if (agentType === "continue_yolo" || agentType === "roo_code" || agentType === "cline") return "ask";
    return "default";
  }
  var KNOWN_CLAUDE_MODELS = [
    { id: "default", label: "Auto" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { id: "claude-opus-4-0", label: "Claude Opus 4" },
    { id: "claude-sonnet-4-0", label: "Claude Sonnet 4" },
    { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet" },
    { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku", label: "Claude 3.5 Haiku" },
    { id: "deepseek-v4-pro:cloud", label: "DeepSeek V4 Pro (Ollama Cloud)" }
  ];
  var KNOWN_CODEX_CLI_MODELS = [
    { id: "gpt-5.6", label: "GPT-5.6" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
    { id: "gpt-5.2", label: "GPT-5.2" },
    { id: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
    { id: "gpt-5.1", label: "GPT-5.1" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "ollama:deepseek-v4-pro:cloud", label: "DeepSeek V4 Pro (Ollama Cloud)" },
    { id: "ollama:kimi-k2.6:cloud", label: "Kimi K2.6 (Ollama Cloud)" }
  ];
  var KNOWN_CURSOR_CLI_MODELS = [
    { id: "grok-4.5-fast-high", label: "Grok 4.5 Fast (High)" },
    { id: "grok-4.5-fast-xhigh", label: "Grok 4.5 Fast (XHigh)" },
    { id: "claude-fable-5-thinking-high", label: "Claude Fable 5 (Thinking High)" },
    { id: "claude-opus-4-8-thinking-high", label: "Claude Opus 4.8 (Thinking High)" },
    { id: "composer-2.5", label: "Composer 2.5" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
    { id: "gpt-5.5-high", label: "GPT-5.5 (High)" },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" }
  ];
  var ANTIGRAVITY_MODES = [
    { id: "Planning", label: "Planning" },
    { id: "Fast", label: "Fast" }
  ];
  var ROO_CODE_MODES = [
    { id: "Architect", label: "Architect" },
    { id: "Code", label: "Code" },
    { id: "Ask", label: "Ask" },
    { id: "Debug", label: "Debug" },
    { id: "Orchestrator", label: "Orchestrator" }
  ];
  var CLINE_MODES = [
    { id: "Plan", label: "Plan" },
    { id: "Act", label: "Act" }
  ];
  var KNOWN_ANTIGRAVITY_MODELS = [
    { id: "Gemini 3.1 Pro (High)", label: "Gemini 3.1 Pro (High)" },
    { id: "Gemini 3.1 Pro (Low)", label: "Gemini 3.1 Pro (Low)" },
    { id: "Gemini 3 Flash", label: "Gemini 3 Flash" },
    { id: "Claude Sonnet 4.6 (Thinking)", label: "Claude Sonnet 4.6 (Thinking)" },
    { id: "Claude Opus 4.6 (Thinking)", label: "Claude Opus 4.6 (Thinking)" },
    { id: "GPT-OSS 120B (Medium)", label: "GPT-OSS 120B (Medium)" }
  ];
  var KNOWN_GEMINI_MODELS = [
    { id: "Default", label: "Default" },
    { id: "2.5 Flash", label: "Gemini 2.5 Flash" },
    { id: "2.5 Pro", label: "Gemini 2.5 Pro" },
    { id: "3 Flash Preview", label: "Gemini 3 Flash Preview" },
    { id: "3.1 Pro Preview", label: "Gemini 3.1 Pro Preview" }
  ];
  function composerModelOptionsFor(agentType, config) {
    if (Array.isArray(config?.available_models) && config.available_models.length > 0) {
      return config.available_models.map((model) => typeof model === "string" ? { id: model, label: model } : model);
    }
    if (agentType === "continue_yolo" || agentType === "continue" || agentType === "roo_code" || agentType === "cline") return [];
    if (agentType === "claude_cli") return KNOWN_CLAUDE_MODELS;
    if (agentType === "codex_cli") return KNOWN_CODEX_CLI_MODELS;
    if (agentType === "cursor_cli") return KNOWN_CURSOR_CLI_MODELS;
    if (agentType === "antigravity" || agentType === "antigravity_panel") return KNOWN_ANTIGRAVITY_MODELS;
    if (agentType === "gemini") return KNOWN_GEMINI_MODELS;
    return KNOWN_CLAUDE_MODELS;
  }
  function modeOptionsFor(agentType, config) {
    if (Array.isArray(config?.available_modes) && config.available_modes.length > 0) {
      return config.available_modes.map((mode) => typeof mode === "string" ? { id: mode, label: mode } : mode);
    }
    if (agentType === "roo_code") return ROO_CODE_MODES;
    if (agentType === "cline") return CLINE_MODES;
    if (agentType === "antigravity" || agentType === "antigravity_panel") return ANTIGRAVITY_MODES;
    return [];
  }
  function permissionModeOptionsFor(agentType, config) {
    if (Array.isArray(config?.available_permission_modes) && config.available_permission_modes.length > 0) {
      return config.available_permission_modes.map((mode) => typeof mode === "string" ? { value: mode, label: mode } : { value: mode.id || mode.value, label: mode.label || mode.id || mode.value }).filter((mode) => mode.value);
    }
    return PERMISSION_MODES[agentType] || [];
  }
  function applicationServerKeyBytes(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
  }
  var NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze({
    permission_required: true,
    agent_ready: true,
    turn_ready: false,
    goal_completed: false,
    goal_attention: true,
    agent_error: true,
    session_offline: true,
    rate_limit_cleared: true,
    completion_sound: false,
    completion_haptic: false
  });
  var NOTIFICATION_PREFERENCE_PENDING = Object.freeze(
    Object.fromEntries(Object.keys(NOTIFICATION_PREFERENCE_DEFAULTS).map((key) => [key, false]))
  );
  var attentionAudioContext = null;
  var lastAttentionSoundAt = 0;
  function primeAttentionAudio() {
    if (typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    attentionAudioContext || (attentionAudioContext = new AudioContextClass());
    if (attentionAudioContext.state === "suspended") {
      attentionAudioContext.resume().catch(() => {
      });
    }
    return attentionAudioContext;
  }
  function playAttentionSound(kind = "completion") {
    const wallNow = Date.now();
    if (wallNow - lastAttentionSoundAt < 600) return false;
    const context = primeAttentionAudio();
    if (!context || context.state !== "running") return false;
    lastAttentionSoundAt = wallNow;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(kind === "prompt" ? 740 : 620, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === "prompt" ? 880 : 760, now + 0.11);
    gain.gain.setValueAtTime(1e-4, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(1e-4, now + 0.14);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
    return true;
  }
  function attentionEventIsUnfocused(sessionId, activeSessionId) {
    if (sessionId !== activeSessionId) return true;
    if (typeof document === "undefined") return false;
    return document.visibilityState !== "visible" || !document.hasFocus();
  }
  function NotificationSettingsPanel({ onClose, onPreferencesChange }) {
    const defaults = NOTIFICATION_PREFERENCE_DEFAULTS;
    const [preferences, setPreferences] = useState3(defaults);
    const [loading, setLoading] = useState3(true);
    const [saving, setSaving] = useState3(null);
    const [error, setError] = useState3("");
    const [webPushStatus, setWebPushStatus] = useState3("checking");
    const [webPushBusy, setWebPushBusy] = useState3(false);
    async function loadPreferences() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/preferences/notifications", { credentials: "same-origin" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Unable to load notification settings.");
        const next = { ...defaults, ...body.preferences || {}, turn_ready: false };
        setPreferences(next);
        onPreferencesChange?.(next);
      } catch (err) {
        setError(err.message || "Unable to load notification settings.");
      } finally {
        setLoading(false);
      }
    }
    async function loadWebPushState() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setWebPushStatus("unsupported");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setWebPushStatus(subscription ? "enabled" : Notification.permission === "denied" ? "denied" : "available");
      } catch {
        setWebPushStatus("error");
      }
    }
    useEffect3(() => {
      loadPreferences();
      loadWebPushState();
    }, []);
    async function enableWebPush() {
      if (webPushBusy) return;
      setWebPushBusy(true);
      setError("");
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setWebPushStatus(permission === "denied" ? "denied" : "available");
          return;
        }
        const configResponse = await fetch("/api/push/web-config", { credentials: "same-origin" });
        const config = await configResponse.json().catch(() => ({}));
        if (!configResponse.ok || !config.public_key) throw new Error(config.error || "Web Push is unavailable.");
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKeyBytes(config.public_key)
          });
        }
        const response = await fetch("/api/push/web-subscription", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Unable to register browser notifications.");
        setWebPushStatus("enabled");
      } catch (err) {
        setWebPushStatus("error");
        setError(err.message || "Unable to enable browser notifications.");
      } finally {
        setWebPushBusy(false);
      }
    }
    async function disableWebPush() {
      if (webPushBusy) return;
      setWebPushBusy(true);
      setError("");
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await fetch("/api/push/web-subscription", {
            method: "DELETE",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint })
          });
          await subscription.unsubscribe();
        }
        setWebPushStatus("available");
      } catch (err) {
        setWebPushStatus("error");
        setError(err.message || "Unable to disable browser notifications.");
      } finally {
        setWebPushBusy(false);
      }
    }
    async function togglePreference(key) {
      if (saving || key === "turn_ready") return;
      const previous = preferences;
      const next = { ...preferences, [key]: !preferences[key] };
      if (key === "completion_sound" && next.completion_sound) primeAttentionAudio();
      setPreferences(next);
      setSaving(key);
      setError("");
      try {
        const response = await fetch("/api/preferences/notifications", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences: next })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Unable to save notification settings.");
        const saved = { ...defaults, ...body.preferences || {} };
        setPreferences(saved);
        onPreferencesChange?.(saved);
      } catch (err) {
        setPreferences(previous);
        setError(err.message || "Unable to save notification settings.");
      } finally {
        setSaving(null);
      }
    }
    return /* @__PURE__ */ React.createElement("div", { className: "settings-panel notification-settings-panel" }, /* @__PURE__ */ React.createElement("div", { className: "settings-panel-header" }, /* @__PURE__ */ React.createElement("span", null, "Notifications"), /* @__PURE__ */ React.createElement("button", { className: "settings-panel-close", onClick: onClose, title: "Close" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "settings-panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "notification-setting-row web-push-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Browser notifications"), /* @__PURE__ */ React.createElement("small", null, webPushStatus === "enabled" ? "Enabled for this browser" : webPushStatus === "denied" ? "Blocked in browser site settings" : webPushStatus === "unsupported" ? "Not supported by this browser" : webPushStatus === "checking" ? "Checking browser support\u2026" : "Receive notifications when this PWA is closed")), webPushStatus === "enabled" ? /* @__PURE__ */ React.createElement("button", { type: "button", disabled: webPushBusy, onClick: disableWebPush }, "Disable") : /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        disabled: webPushBusy || webPushStatus === "checking" || webPushStatus === "unsupported" || webPushStatus === "denied",
        onClick: enableWebPush
      },
      webPushBusy ? "Enabling\u2026" : "Enable"
    )), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Permission required"), /* @__PURE__ */ React.createElement("small", null, "When an agent needs approval to continue")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: preferences.permission_required,
        disabled: loading || !!saving,
        onChange: () => togglePreference("permission_required")
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Turn finished"), /* @__PURE__ */ React.createElement("small", null, "Unavailable until this harness supplies an authoritative native turn boundary")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: false,
        disabled: true,
        onChange: () => togglePreference("turn_ready")
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Goal completed"), /* @__PURE__ */ React.createElement("small", null, "Only when the native goal reaches its terminal completed state")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: preferences.goal_completed,
        disabled: loading || !!saving,
        onChange: () => togglePreference("goal_completed")
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Goal needs attention"), /* @__PURE__ */ React.createElement("small", null, "Paused, blocked, limited, cancelled, or failed goals")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: preferences.goal_attention,
        disabled: loading || !!saving,
        onChange: () => togglePreference("goal_attention")
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "settings-note" }, "Active /goal loop checkpoints stay quiet between turns."), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Agent error or rate limit"), /* @__PURE__ */ React.createElement("small", null, "When an agent stops and needs attention")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: preferences.agent_error,
        disabled: loading || !!saving,
        onChange: () => togglePreference("agent_error")
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Session offline"), /* @__PURE__ */ React.createElement("small", null, "When an agent disconnects from the relay")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: preferences.session_offline,
        disabled: loading || !!saving,
        onChange: () => togglePreference("session_offline")
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Rate limit cleared"), /* @__PURE__ */ React.createElement("small", null, "When a model's rate limit expires")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: preferences.rate_limit_cleared,
        disabled: loading || !!saving,
        onChange: () => togglePreference("rate_limit_cleared")
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Notification sound"), /* @__PURE__ */ React.createElement("small", null, "Subtle cue for allowed prompts and explicit goal lifecycle events")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: preferences.completion_sound,
        disabled: loading || !!saving,
        onChange: () => togglePreference("completion_sound")
      }
    )), loading && /* @__PURE__ */ React.createElement("div", { className: "settings-note" }, "Loading relay preferences\u2026"), !!error && /* @__PURE__ */ React.createElement("div", { className: "notification-settings-error", role: "alert" }, /* @__PURE__ */ React.createElement("span", null, error), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: loadPreferences }, "Retry")), /* @__PURE__ */ React.createElement("div", { className: "settings-note" }, "These preferences sync across web and Android.")));
  }
  function SessionManagementPanel({ sessions, preferences, initialSessionId, onSave, onExport, onClose }) {
    const firstId = initialSessionId || sessionIdOf3(sessions[0]) || "";
    const [selectedId, setSelectedId] = useState3(firstId);
    const [displayName, setDisplayName] = useState3("");
    const [saving, setSaving] = useState3(false);
    const [exporting, setExporting] = useState3("");
    const [error, setError] = useState3("");
    const selected = sessions.find((session) => sessionIdOf3(session) === selectedId) || null;
    const preference = preferences[selectedId] || { display_name: "", archived: false, muted: false, pinned: false, pin_order: 0 };
    useEffect3(() => {
      setDisplayName(preference.display_name || "");
      setError("");
    }, [selectedId, preference.display_name]);
    useEffect3(() => {
      if (initialSessionId) setSelectedId(initialSessionId);
    }, [initialSessionId]);
    async function update(updates) {
      if (!selectedId || saving) return;
      setSaving(true);
      setError("");
      try {
        await onSave(selectedId, updates);
      } catch (err) {
        setError(err.message || "Unable to save session settings.");
      } finally {
        setSaving(false);
      }
    }
    async function downloadExport(format) {
      if (!selectedId || exporting) return;
      setExporting(format);
      setError("");
      try {
        await onExport(selectedId, format);
      } catch (err) {
        setError(err.message || "Unable to export session.");
      } finally {
        setExporting("");
      }
    }
    return /* @__PURE__ */ React.createElement("div", { className: "settings-panel session-management-panel" }, /* @__PURE__ */ React.createElement("div", { className: "settings-panel-header" }, /* @__PURE__ */ React.createElement("span", null, "Manage sessions"), /* @__PURE__ */ React.createElement("button", { className: "settings-panel-close", onClick: onClose, title: "Close" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "settings-panel-body" }, sessions.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "settings-note" }, "No sessions available.") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { className: "settings-row session-management-field" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Session"), /* @__PURE__ */ React.createElement("select", { value: selectedId, onChange: (event) => setSelectedId(event.target.value) }, sessions.map((session) => {
      const id = sessionIdOf3(session);
      const pref = preferences[id] || {};
      const label = pref.display_name || session?.display_name || session?.workspace_name || session?.name || id;
      return /* @__PURE__ */ React.createElement("option", { key: id, value: id }, pref.archived ? "[Hidden] " : "", label);
    }))), selected && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { className: "settings-row session-management-field" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Custom name"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: displayName,
        maxLength: 100,
        placeholder: selected?.display_name || selected?.workspace_name || selected?.name || selectedId,
        onChange: (event) => setDisplayName(event.target.value)
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Pin chat"), /* @__PURE__ */ React.createElement("small", null, "Keep this chat in the operator-ordered pinned section")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: !!preference.pinned,
        disabled: saving,
        onChange: () => update({ pinned: !preference.pinned })
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "notification-setting-row" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Mute notifications"), /* @__PURE__ */ React.createElement("small", null, "Suppress push notifications for this session")), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: !!preference.muted,
        disabled: saving,
        onChange: () => update({ muted: !preference.muted })
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "session-management-actions" }, /* @__PURE__ */ React.createElement("button", { disabled: saving, onClick: () => update({ display_name: displayName }) }, "Save name"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: preference.archived ? "" : "danger",
        disabled: saving,
        onClick: () => update({ archived: !preference.archived })
      },
      preference.archived ? "Restore to sidebar" : "Hide from sidebar"
    )), /* @__PURE__ */ React.createElement("div", { className: "session-management-actions session-export-actions", "aria-label": "Export session" }, /* @__PURE__ */ React.createElement("button", { disabled: !!exporting, onClick: () => downloadExport("markdown") }, exporting === "markdown" ? "Preparing\u2026" : "Download Markdown"), /* @__PURE__ */ React.createElement("button", { disabled: !!exporting, onClick: () => downloadExport("json") }, exporting === "json" ? "Preparing\u2026" : "Download JSON")))), !!error && /* @__PURE__ */ React.createElement("div", { className: "settings-error", role: "alert" }, error), /* @__PURE__ */ React.createElement("div", { className: "settings-note" }, "Names, pinned order, hidden state, and mute settings sync across web and Android.")));
  }
  function ScheduledSendPanel({ sessionId, initialContent, jobs, onSchedule, onCancel, onCreated, onClose }) {
    const [content, setContent] = useState3(initialContent || "");
    const [triggerKind, setTriggerKind] = useState3("idle");
    const [deliverAt, setDeliverAt] = useState3(() => {
      const date = new Date(Date.now() + 60 * 60 * 1e3);
      return new Date(date.getTime() - date.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    });
    const [error, setError] = useState3("");
    const [saving, setSaving] = useState3(false);
    async function createJob(event) {
      event.preventDefault();
      setSaving(true);
      setError("");
      try {
        await onSchedule(sessionId, content, triggerKind, triggerKind === "at" ? new Date(deliverAt).toISOString() : null);
        onCreated?.();
        setContent("");
      } catch (err) {
        setError(err.message);
      } finally {
        setSaving(false);
      }
    }
    async function cancelJob(id) {
      try {
        await onCancel(id);
      } catch (err) {
        setError(err.message);
      }
    }
    return /* @__PURE__ */ React.createElement("div", { className: "settings-panel scheduled-send-panel", "data-testid": "scheduled-send-panel" }, /* @__PURE__ */ React.createElement("div", { className: "settings-panel-header" }, /* @__PURE__ */ React.createElement("span", null, "Schedule message"), /* @__PURE__ */ React.createElement("button", { className: "settings-panel-close", onClick: onClose, title: "Close" }, "\xD7")), /* @__PURE__ */ React.createElement("form", { className: "settings-panel-body", onSubmit: createJob }, /* @__PURE__ */ React.createElement("label", { className: "settings-row session-management-field" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Message"), /* @__PURE__ */ React.createElement("textarea", { value: content, maxLength: 524288, onChange: (event) => setContent(event.target.value) })), /* @__PURE__ */ React.createElement("label", { className: "settings-row session-management-field" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Deliver"), /* @__PURE__ */ React.createElement("select", { value: triggerKind, onChange: (event) => setTriggerKind(event.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "idle" }, "When session is next idle"), /* @__PURE__ */ React.createElement("option", { value: "at" }, "At a specific time"))), triggerKind === "at" && /* @__PURE__ */ React.createElement("label", { className: "settings-row session-management-field" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Local time"), /* @__PURE__ */ React.createElement("input", { type: "datetime-local", value: deliverAt, onChange: (event) => setDeliverAt(event.target.value) })), /* @__PURE__ */ React.createElement("div", { className: "session-management-actions" }, /* @__PURE__ */ React.createElement("button", { type: "submit", disabled: saving || !content.trim() }, saving ? "Scheduling\u2026" : "Schedule")), !!error && /* @__PURE__ */ React.createElement("div", { className: "settings-error", role: "alert" }, error), !!jobs.length && /* @__PURE__ */ React.createElement("div", { className: "scheduled-send-list" }, /* @__PURE__ */ React.createElement("strong", null, "Pending"), jobs.map((job) => /* @__PURE__ */ React.createElement("div", { className: "scheduled-send-row", key: job.id }, /* @__PURE__ */ React.createElement("span", null, job.trigger_kind === "idle" ? "Next idle" : new Date(job.deliver_at).toLocaleString(), " \xB7 ", job.content), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => cancelJob(job.id), disabled: job.state !== "pending" }, job.state === "dispatching" ? "Sending\u2026" : "Cancel"))))));
  }
  function AgentSettingsPanel({ session, config, configControlStates, onRequestRefresh, onSetModel, onSetEffort, onSetPermissionMode, onSetAutoApprovePermissions, onSetMode, onSetCodexConfig, onSwitchWorkspace, onClose }) {
    const [showBypassConfirmation, setShowBypassConfirmation] = React.useState(false);
    const [localBypassRestoreProfile, setLocalBypassRestoreProfile] = React.useState(null);
    const sessionId = sessionIdOf3(session);
    const controlFor = (field) => configControlStates?.[`${sessionId}:${field}`] || null;
    const isPendingControl = (control) => control && (control.status === "pending" || control.status === "awaiting_config");
    const modelControl = controlFor("model");
    const permissionControl = controlFor("permission_mode");
    const effortControl = controlFor("effort");
    const autoApproveControl = controlFor("auto_approve_permissions");
    const modeControl = controlFor("mode");
    const speedControl = controlFor("speed");
    const accessControl = controlFor("access_mode");
    const permissionProfileControl = controlFor("permission_profile");
    const workspaceControl = controlFor("workspace");
    const activeControl = [modelControl, permissionControl, effortControl, autoApproveControl, modeControl, speedControl, accessControl, permissionProfileControl, workspaceControl].find((control) => isPendingControl(control) || control?.status === "failed");
    const controlStatusLabel = activeControl ? isPendingControl(activeControl) ? `Saving ${activeControl.field.replace(/_/g, " ")}\u2026` : activeControl.error : null;
    const agentType = session && typeof session === "object" ? session.agent_type : null;
    const caps = config?.capabilities || {};
    const splitObservedConfig = agentType === "codex_cli" && config?.config_semantics === "observed_and_next_send";
    const isVsCodeCodex = agentType === "codex";
    const codexControlsAvailable = !isVsCodeCodex || config?.controls_available !== false;
    const currentModel = config?.model_id || "unknown";
    const nextSendModel = config?.next_send_model_id || "";
    const rateLimitedUntil = session && typeof session === "object" ? session.rate_limited_until || null : null;
    const antigravityQuotaModels = Array.isArray(session?.antigravity_quota_models) ? session.antigravity_quota_models : [];
    const activeQuotaModel = session?.active_quota_model || null;
    const permMode = config?.permission_mode || "unknown";
    const convMode = config?.conversation_mode || "unknown";
    const currentMode = config?.mode && config.mode !== "unknown" ? config.mode : convMode;
    const autoApproveEnabled = typeof config?.auto_approve_permissions === "boolean" ? config.auto_approve_permissions : !!session?.auto_approve_permissions;
    const effortLevel = config?.effort || null;
    const nextSendEffort = config?.next_send_effort || "";
    const fileScope = config?.file_access_scope || "unknown";
    const permModes = permissionModeOptionsFor(agentType, config);
    const modeOptions = modeOptionsFor(agentType, config);
    let modelOptions = agentType === "claude" || agentType === "claude_cli" ? KNOWN_CLAUDE_MODELS : agentType === "codex_cli" ? KNOWN_CODEX_CLI_MODELS : agentType === "cursor_cli" ? KNOWN_CURSOR_CLI_MODELS : agentType === "antigravity" || agentType === "antigravity_panel" ? KNOWN_ANTIGRAVITY_MODELS : agentType === "gemini" ? KNOWN_GEMINI_MODELS : [];
    if (config?.available_models && Array.isArray(config.available_models) && config.available_models.length > 0) {
      modelOptions = config.available_models.map((m) => typeof m === "string" ? { id: m, label: m } : m);
    }
    React.useEffect(() => {
      if (sessionId) onRequestRefresh(sessionId);
    }, [sessionId]);
    function handleModelChange(modelId) {
      if (!modelId || modelId === (splitObservedConfig ? nextSendModel : currentModel)) return;
      onSetModel(sessionId, modelId);
    }
    function handlePermModeChange(mode) {
      if (!mode || mode === permMode) return;
      onSetPermissionMode(sessionId, mode);
    }
    function handleEffortChange(effort) {
      if (!effort || effort === (splitObservedConfig ? nextSendEffort : effortLevel)) return;
      onSetEffort && onSetEffort(sessionId, effort);
    }
    function handleModeChange(mode) {
      if (!mode || mode === currentMode) return;
      onSetMode && onSetMode(sessionId, mode);
    }
    function handleAutoApproveChange(enabled) {
      if (autoApproveEnabled === !!enabled) return;
      onSetAutoApprovePermissions && onSetAutoApprovePermissions(sessionId, !!enabled);
    }
    function handleCodexPermissionProfile(permissionProfile, confirmBypass = false) {
      if (!permissionProfile || permissionProfile === config?.permission_profile) return;
      if (permissionProfile === "full-access" && !confirmBypass) {
        setShowBypassConfirmation(true);
        return;
      }
      if (permissionProfile === "full-access") {
        setLocalBypassRestoreProfile(
          config?.permission_profile && config.permission_profile !== "full-access" ? config.permission_profile : "auto"
        );
      }
      setShowBypassConfirmation(false);
      onSetCodexConfig?.({
        permission_profile: permissionProfile,
        ...confirmBypass ? { confirm_bypass: true } : {}
      });
    }
    return /* @__PURE__ */ React.createElement("div", { className: "settings-panel" }, /* @__PURE__ */ React.createElement("div", { className: "settings-panel-header" }, /* @__PURE__ */ React.createElement("span", null, "Session Settings"), /* @__PURE__ */ React.createElement("button", { className: "settings-panel-close", onClick: onClose, title: "Close" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "settings-panel-body" }, rateLimitedUntil && /* @__PURE__ */ React.createElement("div", { className: "settings-rl-banner" }, /* @__PURE__ */ React.createElement("span", { className: "settings-rl-icon" }, "\u26A0"), /* @__PURE__ */ React.createElement("span", { className: "settings-rl-text" }, "Rate limited", rateLimitedUntil !== "unknown" ? /* @__PURE__ */ React.createElement(React.Fragment, null, " \u2014 available after ", /* @__PURE__ */ React.createElement("strong", null, rateLimitedUntil)) : /* @__PURE__ */ React.createElement(React.Fragment, null, " \u2014 reset time unknown"))), /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, splitObservedConfig ? "Observed model" : "Model"), /* @__PURE__ */ React.createElement("div", { className: "settings-model-wrap" }, splitObservedConfig ? /* @__PURE__ */ React.createElement("span", { className: `settings-value${currentModel === "unknown" ? " dim" : ""}`, title: config?.model_provenance?.source || "No exact native metadata observed" }, currentModel) : caps.set_model && modelOptions.length > 0 ? /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: currentModel,
        disabled: isPendingControl(modelControl),
        onChange: (e) => handleModelChange(e.target.value)
      },
      modelOptions.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label)),
      agentType !== "antigravity" && agentType !== "gemini" && !modelOptions.some((m) => m.id === currentModel) && currentModel !== "unknown" && /* @__PURE__ */ React.createElement("option", { value: currentModel }, currentModel)
    ) : /* @__PURE__ */ React.createElement("span", { className: `settings-value${currentModel === "unknown" ? " dim" : ""}` }, currentModel), rateLimitedUntil && /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "model-rl-badge",
        title: `Rate limited${rateLimitedUntil !== "unknown" ? ` \u2014 resets at ${rateLimitedUntil}` : ""}`
      },
      "\u26A0"
    )), modelControl?.status === "ok" && /* @__PURE__ */ React.createElement("span", { className: "settings-inline-ok" }, "Saved")), splitObservedConfig && caps.set_model && modelOptions.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Next send model"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: nextSendModel,
        disabled: isPendingControl(modelControl),
        onChange: (e) => handleModelChange(e.target.value)
      },
      /* @__PURE__ */ React.createElement("option", { value: "", disabled: true }, "Choose model\u2026"),
      modelOptions.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
    ), /* @__PURE__ */ React.createElement("span", { className: `settings-value small${config?.next_send_model_status === "failed" ? " error" : ""}` }, config?.next_send_model_status || "unset")), (agentType === "antigravity" || agentType === "antigravity_panel") && antigravityQuotaModels.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row", style: { alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Quotas"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 } }, session?.available_ai_credits != null && /* @__PURE__ */ React.createElement("span", { className: "settings-value" }, "AI credits: ", session.available_ai_credits), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } }, antigravityQuotaModels.map((entry, index) => {
      const pct = entry?.percent_used;
      const label = formatAntigravityQuotaLabel(entry?.model);
      const tone = pct >= 90 ? "#f85149" : pct >= 75 ? "#d29922" : "#8b949e";
      const isActiveQuota = !!activeQuotaModel && activeQuotaModel === entry?.model;
      return /* @__PURE__ */ React.createElement(
        "span",
        {
          key: entry?.model || `quota-${index}`,
          className: "composer-hint",
          title: entry?.refreshes_in ? `${entry.model} \xB7 resets in ${entry.refreshes_in}` : entry?.model || "",
          style: {
            color: tone,
            border: `1px solid ${isActiveQuota ? tone : "#30363d"}`,
            borderRadius: 999,
            padding: "2px 8px",
            background: isActiveQuota ? `${tone}18` : "rgba(110,118,129,0.08)"
          }
        },
        label,
        " ",
        pct != null ? `${pct}%` : "n/a"
      );
    })))), (agentType === "antigravity" || agentType === "antigravity_panel") && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Mode"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: currentMode === "unknown" ? "Planning" : currentMode,
        disabled: isPendingControl(modeControl),
        onChange: (e) => handleModeChange(e.target.value)
      },
      ANTIGRAVITY_MODES.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
    ), modeControl?.status === "ok" && /* @__PURE__ */ React.createElement("span", { className: "settings-inline-ok" }, "Saved")), isClineLikeAgentType(agentType) && caps.set_mode && modeOptions.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Mode"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: currentMode === "unknown" ? modeOptions[0].id : currentMode,
        disabled: isPendingControl(modeControl),
        onChange: (e) => handleModeChange(e.target.value)
      },
      modeOptions.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label)),
      currentMode !== "unknown" && !modeOptions.some((m) => m.id === currentMode) && /* @__PURE__ */ React.createElement("option", { value: currentMode }, currentMode)
    ), modeControl?.status === "ok" && /* @__PURE__ */ React.createElement("span", { className: "settings-inline-ok" }, "Saved")), (agentType === "claude" || agentType === "claude_cli" || agentType === "codex_cli" || agentType === "cursor_cli" || agentType === "continue_yolo" || isClineLikeAgentType(agentType)) && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Permission mode"), caps.permission_mode_change && permModes.length > 0 ? /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: permMode === "unknown" ? defaultPermissionModeFor(agentType) : permMode,
        disabled: isPendingControl(permissionControl),
        onChange: (e) => handlePermModeChange(e.target.value)
      },
      permModes.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.value, value: m.value }, m.label)),
      !permModes.some((m) => m.value === permMode) && permMode !== "unknown" && /* @__PURE__ */ React.createElement("option", { value: permMode }, permMode)
    ) : /* @__PURE__ */ React.createElement("span", { className: `settings-value${permMode === "unknown" ? " dim" : ""}` }, permMode), permissionControl?.status === "ok" && /* @__PURE__ */ React.createElement("span", { className: "settings-inline-ok" }, "Saved")), agentType === "codex_cli" && config?.approval_policy && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Approval policy"), /* @__PURE__ */ React.createElement("span", { className: "settings-value" }, config.approval_policy)), agentType === "claude" && effortLevel && effortLevel !== "unknown" && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Effort"), /* @__PURE__ */ React.createElement("span", { className: "settings-value" }, ((config?.available_efforts || []).find((m) => m.id === effortLevel) || {}).label || effortLevel)), (agentType === "claude_cli" || agentType === "codex_cli" || agentType === "cursor_cli") && caps.set_effort && (config?.available_efforts || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, splitObservedConfig ? "Observed effort" : "Effort"), splitObservedConfig ? /* @__PURE__ */ React.createElement("span", { className: `settings-value${!effortLevel || effortLevel === "unknown" ? " dim" : ""}`, title: config?.effort_provenance?.source || "No exact native metadata observed" }, effortLevel || "unknown") : /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: effortLevel || "medium",
        disabled: isPendingControl(effortControl),
        onChange: (e) => handleEffortChange(e.target.value)
      },
      (config.available_efforts || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
    ), effortControl?.status === "ok" && /* @__PURE__ */ React.createElement("span", { className: "settings-inline-ok" }, "Saved")), splitObservedConfig && caps.set_effort && (config?.available_efforts || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Next send effort"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: nextSendEffort,
        disabled: isPendingControl(effortControl),
        onChange: (e) => handleEffortChange(e.target.value)
      },
      /* @__PURE__ */ React.createElement("option", { value: "", disabled: true }, "Choose effort\u2026"),
      (config.available_efforts || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
    ), /* @__PURE__ */ React.createElement("span", { className: `settings-value small${config?.next_send_effort_status === "failed" ? " error" : ""}` }, config?.next_send_effort_status || "unset")), (agentType === "codex" || agentType === "codex-desktop") && caps.set_codex_config && /* @__PURE__ */ React.createElement(React.Fragment, null, caps.codex_model_change && (config?.available_models || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, isVsCodeCodex ? "Next turn model" : "Model"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: config?.model_id || "unknown",
        disabled: isPendingControl(modelControl) || !codexControlsAvailable,
        onChange: (e) => {
          onSetCodexConfig?.({ model_id: e.target.value });
        }
      },
      (config?.available_models || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label)),
      config?.model_id && !(config?.available_models || []).some((m) => m.id === config.model_id) && config.model_id !== "unknown" && /* @__PURE__ */ React.createElement("option", { value: config.model_id }, config.model_id)
    ), modelControl?.status === "ok" && /* @__PURE__ */ React.createElement("span", { className: "settings-inline-ok" }, "Saved")), caps.codex_effort_change && (config?.available_efforts || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, isVsCodeCodex ? "Next turn effort" : "Effort"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: (config?.effort || "unknown").toLowerCase(),
        disabled: isPendingControl(effortControl) || !codexControlsAvailable,
        onChange: (e) => {
          onSetCodexConfig?.({ effort: e.target.value });
        }
      },
      (config?.available_efforts || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
    ), effortControl?.status === "ok" && /* @__PURE__ */ React.createElement("span", { className: "settings-inline-ok" }, "Saved")), caps.codex_permission_profile_change && (config?.available_permission_profiles || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Next turn permissions"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: config?.permission_profile || "unknown",
        disabled: isPendingControl(permissionProfileControl) || !codexControlsAvailable,
        onChange: (e) => handleCodexPermissionProfile(e.target.value)
      },
      (config?.available_permission_profiles || []).map((profile) => /* @__PURE__ */ React.createElement("option", { key: profile.id, value: profile.id }, profile.label))
    ), permissionProfileControl?.status === "ok" && /* @__PURE__ */ React.createElement("span", { className: "settings-inline-ok" }, "Saved")), showBypassConfirmation && /* @__PURE__ */ React.createElement("div", { className: "settings-bypass-confirmation", role: "alert" }, /* @__PURE__ */ React.createElement("strong", null, "Enable Bypass permissions?"), /* @__PURE__ */ React.createElement("span", null, "Full access sets approval policy to Never and sandbox access to danger-full-access for this Codex conversation."), /* @__PURE__ */ React.createElement("div", { className: "settings-bypass-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setShowBypassConfirmation(false) }, "Cancel"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "danger", onClick: () => handleCodexPermissionProfile("full-access", true) }, "Enable Full access"))), isVsCodeCodex && config?.bypass_permissions_active && (localBypassRestoreProfile || config?.bypass_restore_profile) && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Bypass permissions"), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "settings-restore-safe",
        disabled: isPendingControl(permissionProfileControl),
        onClick: () => handleCodexPermissionProfile(localBypassRestoreProfile || config.bypass_restore_profile)
      },
      "Restore previous safe permissions"
    )), isVsCodeCodex && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Approval policy"), /* @__PURE__ */ React.createElement("span", { className: "settings-value" }, config?.approval_policy || "Native custom policy")), /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Access / sandbox"), /* @__PURE__ */ React.createElement("span", { className: "settings-value" }, config?.permission_mode || "Native custom access")), !codexControlsAvailable && /* @__PURE__ */ React.createElement("div", { className: "settings-control-unavailable", role: "status" }, config?.controls_unavailable_reason || "Codex controls are unavailable for this conversation.")), caps.codex_access_change && (config?.available_access || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Access"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: config?.permission_mode || "unknown",
        disabled: isPendingControl(accessControl),
        onChange: (e) => {
          onSetCodexConfig?.({ access_mode: e.target.value });
        }
      },
      (config?.available_access || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
    )), caps.codex_speed_change && (config?.available_speeds || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Speed"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: (config?.speed || "standard").toLowerCase(),
        disabled: isPendingControl(speedControl),
        onChange: (e) => {
          onSetCodexConfig?.({ speed: e.target.value });
        }
      },
      (config?.available_speeds || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
    )), agentType === "codex-desktop" && config?.branch && config.branch !== "unknown" && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Branch"), /* @__PURE__ */ React.createElement("span", { className: "settings-value" }, config.branch)), agentType === "codex-desktop" && config?.sandbox_status && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Sandbox"), /* @__PURE__ */ React.createElement("span", { className: `settings-value${config.sandbox_status.active ? "" : " dim"}` }, config.sandbox_status.active ? "\u{1F7E2}" : "\u26AA", " ", config.sandbox_status.label || (config.sandbox_status.active ? "Active" : "Inactive"))), agentType === "codex-desktop" && (config?.available_workspaces || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Workspace"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "settings-perm-select",
        value: config?.file_access_scope || "",
        disabled: isPendingControl(workspaceControl),
        onChange: (e) => {
          if (onSwitchWorkspace) onSwitchWorkspace(sessionId, e.target.value);
        }
      },
      (config.available_workspaces || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.path || m.id }, m.label))
    )), controlStatusLabel && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: activeControl?.status === "failed" ? "settings-error" : "settings-inline-ok", role: "status" }, controlStatusLabel))), (agentType === "codex" || agentType === "codex-desktop") && !caps.set_codex_config && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Access"), /* @__PURE__ */ React.createElement("span", { className: `settings-value${permMode === "unknown" ? " dim" : ""}` }, permMode)), isContinueLikeAgentType(agentType) && config?.mode && config.mode !== "unknown" && /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Mode"), /* @__PURE__ */ React.createElement("span", { className: "settings-value" }, config.mode)), caps.auto_approve_permissions_toggle && /* @__PURE__ */ React.createElement("div", { className: "settings-row settings-row-checkbox" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Tool Prompts"), /* @__PURE__ */ React.createElement("label", { className: "settings-checkbox" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: autoApproveEnabled,
        disabled: isPendingControl(autoApproveControl),
        onChange: (e) => handleAutoApproveChange(e.target.checked)
      }
    ), /* @__PURE__ */ React.createElement("span", null, "Auto-approve permission prompts")), autoApproveControl?.status === "ok" && /* @__PURE__ */ React.createElement("span", { className: "settings-inline-ok" }, "Saved")), (() => {
      const workspaceDisplay = fileScope !== "unknown" ? fileScope : session?.workspace_name || session?.window_title || null;
      return /* @__PURE__ */ React.createElement("div", { className: "settings-row" }, /* @__PURE__ */ React.createElement("span", { className: "settings-label" }, "Workspace"), /* @__PURE__ */ React.createElement(
        "span",
        {
          className: `settings-value small${!workspaceDisplay ? " dim" : ""}`,
          title: workspaceDisplay || ""
        },
        workspaceDisplay ? fileScope !== "unknown" ? workspaceDisplay.split(/[\\/]/).pop() || workspaceDisplay : workspaceDisplay : "\u2014"
      ));
    })(), controlStatusLabel && !(agentType === "codex" || agentType === "codex-desktop") && /* @__PURE__ */ React.createElement("div", { className: activeControl?.status === "failed" ? "settings-error" : "settings-inline-ok", role: "status" }, controlStatusLabel)), /* @__PURE__ */ React.createElement("div", { className: "settings-panel-footer" }, /* @__PURE__ */ React.createElement("button", { className: "settings-refresh", onClick: () => {
      if (sessionId) onRequestRefresh(sessionId);
    } }, "\u21BB Refresh")));
  }
  function ChatListPanel({ chats, sessionId, onSwitch, onNew, onClose }) {
    return /* @__PURE__ */ React.createElement("div", { className: "chat-list-panel" }, /* @__PURE__ */ React.createElement("div", { className: "chat-list-header" }, /* @__PURE__ */ React.createElement("span", { className: "chat-list-title" }, "Conversations"), /* @__PURE__ */ React.createElement("button", { className: "chat-list-new-btn", onClick: onNew, title: "New conversation" }, "+"), /* @__PURE__ */ React.createElement("button", { className: "chat-list-close-btn", onClick: onClose, title: "Close" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "chat-list-body" }, !chats || chats.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "chat-list-empty" }, "No conversations found") : chats.map((chat, i) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: chat.id || i,
        className: `chat-list-item${chat.active ? " active" : ""}`,
        onClick: () => onSwitch(chat.id),
        title: chat.title
      },
      /* @__PURE__ */ React.createElement("span", { className: "chat-list-item-title" }, chat.title),
      chat.active && /* @__PURE__ */ React.createElement("span", { className: "chat-list-item-active" }, "\u25CF")
    ))));
  }
  function AntigravityV2NavPanel({ items, onNavigate, onNew, onClose, embedded = false, loading = false }) {
    const normalized = Array.isArray(items) ? items : [];
    const navItems = normalized.filter((item) => item?.kind === "nav");
    const projects = normalized.filter((item) => item?.kind === "project");
    const chats = normalized.filter((item) => !item?.kind || item.kind === "chat");
    const seeAllItems = normalized.filter((item) => item?.kind === "see_all");
    const projectKeys = [];
    const projectLabels = /* @__PURE__ */ new Map();
    projects.forEach((project) => {
      const key = project.project_index != null ? `idx:${project.project_index}` : `name:${project.project || project.title || "Project"}`;
      if (!projectLabels.has(key)) {
        projectKeys.push(key);
        projectLabels.set(key, project.title || project.project || "Project");
      }
    });
    chats.forEach((chat) => {
      const key = chat.project_index != null ? `idx:${chat.project_index}` : `name:${chat.project || "Other"}`;
      if (!projectLabels.has(key)) {
        projectKeys.push(key);
        projectLabels.set(key, chat.project || "Other");
      }
    });
    const ungrouped = chats.filter((chat) => chat.project_index == null && !chat.project);
    function navTitle(action) {
      if (action === "new_conversation") return "New Conversation";
      if (action === "conversation_history") return "Conversation History";
      if (action === "scheduled_tasks") return "Scheduled Tasks";
      return "Agent Manager";
    }
    function renderChat(chat, i) {
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: chat.id || i,
          className: `agv2-chat-item${chat.active ? " active" : ""}`,
          type: "button",
          onClick: () => onNavigate(chat.id),
          title: chat.title || "Untitled"
        },
        /* @__PURE__ */ React.createElement("span", { className: "agv2-chat-title" }, chat.title || "Untitled"),
        chat.age && /* @__PURE__ */ React.createElement("span", { className: "agv2-chat-age" }, chat.age),
        chat.active && /* @__PURE__ */ React.createElement("span", { className: "agv2-chat-active" }, "\u25CF")
      );
    }
    const body = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "agv2-nav-actions" }, (navItems.length ? navItems : [
      { id: "__agv2:new_conversation", action: "new_conversation" },
      { id: "__agv2:conversation_history", action: "conversation_history" },
      { id: "__agv2:scheduled_tasks", action: "scheduled_tasks" }
    ]).map((item) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: item.id || item.action,
        className: `agv2-nav-action ${item.action || ""}`,
        type: "button",
        onClick: () => item.action === "new_conversation" ? onNew() : onNavigate(item.id)
      },
      /* @__PURE__ */ React.createElement("span", { className: "agv2-nav-action-icon" }, item.action === "new_conversation" ? "+" : item.action === "scheduled_tasks" ? "\u25F7" : "\u21BA"),
      /* @__PURE__ */ React.createElement("span", null, item.title || navTitle(item.action))
    ))), /* @__PURE__ */ React.createElement("div", { className: "agv2-project-list" }, projectKeys.length === 0 && ungrouped.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "chat-list-empty" }, loading ? "Loading conversations..." : "No projects or conversations found") : /* @__PURE__ */ React.createElement(React.Fragment, null, projectKeys.map((projectKey) => {
      const label = projectLabels.get(projectKey) || "Project";
      const projectChats = chats.filter((chat) => {
        const key = chat.project_index != null ? `idx:${chat.project_index}` : `name:${chat.project || "Other"}`;
        return key === projectKey;
      });
      const projectSeeAll = seeAllItems.filter((item) => {
        const key = item.project_index != null ? `idx:${item.project_index}` : `name:${item.project || "Other"}`;
        return key === projectKey;
      });
      return /* @__PURE__ */ React.createElement("section", { className: "agv2-project-section", key: projectKey }, /* @__PURE__ */ React.createElement("div", { className: "agv2-project-header" }, /* @__PURE__ */ React.createElement("span", { className: "agv2-project-icon" }, "\u2302"), /* @__PURE__ */ React.createElement("span", { className: "agv2-project-title" }, label)), /* @__PURE__ */ React.createElement("div", { className: "agv2-project-chats" }, projectChats.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "agv2-project-empty" }, "No visible conversations") : projectChats.map(renderChat), projectSeeAll.map((item) => /* @__PURE__ */ React.createElement(
        "button",
        {
          key: item.id,
          className: "agv2-see-all",
          type: "button",
          onClick: () => onNavigate(item.id)
        },
        item.title || "See all"
      ))));
    }), ungrouped.length > 0 && /* @__PURE__ */ React.createElement("section", { className: "agv2-project-section" }, /* @__PURE__ */ React.createElement("div", { className: "agv2-project-header" }, /* @__PURE__ */ React.createElement("span", { className: "agv2-project-icon" }, "\u2302"), /* @__PURE__ */ React.createElement("span", { className: "agv2-project-title" }, "Other")), /* @__PURE__ */ React.createElement("div", { className: "agv2-project-chats" }, ungrouped.map(renderChat))))));
    if (embedded) {
      return /* @__PURE__ */ React.createElement("div", { className: "agv2-nav-embedded" }, body);
    }
    return /* @__PURE__ */ React.createElement("div", { className: "chat-list-panel agv2-nav-panel" }, /* @__PURE__ */ React.createElement("div", { className: "chat-list-header" }, /* @__PURE__ */ React.createElement("span", { className: "chat-list-title" }, "Antigravity Agent Manager"), /* @__PURE__ */ React.createElement("button", { className: "chat-list-new-btn", onClick: onNew, title: "New conversation" }, "+"), /* @__PURE__ */ React.createElement("button", { className: "chat-list-close-btn", onClick: onClose, title: "Close" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "chat-list-body agv2-nav-body" }, body));
  }
  function ThreadHistoryPanel({ threads, sessionId, onSwitch, onNew, onClose, newLabel = "New thread" }) {
    return /* @__PURE__ */ React.createElement("div", { className: "chat-list-panel" }, /* @__PURE__ */ React.createElement("div", { className: "chat-list-header" }, /* @__PURE__ */ React.createElement("span", { className: "chat-list-title" }, "Threads"), /* @__PURE__ */ React.createElement("button", { className: "chat-list-new-btn", onClick: onNew, title: newLabel }, "+"), /* @__PURE__ */ React.createElement("button", { className: "chat-list-close-btn", onClick: onClose, title: "Close" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "chat-list-body" }, !threads || threads.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "chat-list-empty" }, "No threads found") : threads.map((thread, i) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: thread.cache_key || thread.id || i,
        className: `chat-list-item${thread.active ? " active" : ""}`,
        onClick: () => onSwitch(thread.id),
        title: thread.title
      },
      /* @__PURE__ */ React.createElement("span", { className: "chat-list-item-title" }, thread.title),
      thread.age && /* @__PURE__ */ React.createElement("span", { className: "chat-list-item-age" }, thread.age),
      thread.active && /* @__PURE__ */ React.createElement("span", { className: "chat-list-item-active" }, "\u25CF")
    ))));
  }
  function ThreadTabsBar({ threads, activeThreadId, onSwitch, onNew, onOpenHistory, showDraftTab = false, newLabel = "New chat" }) {
    return /* @__PURE__ */ React.createElement("div", { className: "thread-tabs-bar" }, /* @__PURE__ */ React.createElement("div", { className: "thread-tabs-scroll" }, showDraftTab && /* @__PURE__ */ React.createElement("button", { className: "thread-tab active draft", type: "button", title: newLabel }, /* @__PURE__ */ React.createElement("span", { className: "thread-tab-title" }, newLabel)), (threads || []).map((thread, i) => {
      const isActive = activeThreadId ? thread.id === activeThreadId : !!thread.active;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: thread.cache_key || thread.id || i,
          className: `thread-tab${isActive ? " active" : ""}`,
          type: "button",
          title: thread.title || "Untitled",
          onClick: () => onSwitch(thread.id)
        },
        /* @__PURE__ */ React.createElement("span", { className: "thread-tab-title" }, thread.title || "Untitled"),
        thread.age && /* @__PURE__ */ React.createElement("span", { className: "thread-tab-age" }, thread.age)
      );
    })), /* @__PURE__ */ React.createElement("div", { className: "thread-tabs-actions" }, /* @__PURE__ */ React.createElement("button", { className: "thread-tabs-btn", type: "button", onClick: onOpenHistory, title: "Show all threads" }, "All"), /* @__PURE__ */ React.createElement("button", { className: "thread-tabs-btn accent", type: "button", onClick: onNew, title: newLabel }, "+")));
  }
  function BranchSelectorPanel({ branchData, sessionId, currentBranch, onSwitch, onCreate, onClose }) {
    const [search, setSearch] = React.useState("");
    const [creating, setCreating] = React.useState(false);
    const [newName, setNewName] = React.useState("");
    const branches = branchData?.branches || [];
    const current = branchData?.current || currentBranch || "";
    const filtered = search ? branches.filter((b) => b.toLowerCase().includes(search.toLowerCase())) : branches;
    return /* @__PURE__ */ React.createElement("div", { className: "branch-selector-panel" }, /* @__PURE__ */ React.createElement("div", { className: "branch-selector-header" }, /* @__PURE__ */ React.createElement("span", { className: "branch-selector-title" }, "Branches"), /* @__PURE__ */ React.createElement("button", { className: "chat-list-close-btn", onClick: onClose, title: "Close" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "branch-selector-search" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        className: "branch-search-input",
        placeholder: "Search branches\u2026",
        value: search,
        onChange: (e) => setSearch(e.target.value),
        autoFocus: true
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "branch-selector-body" }, filtered.length === 0 && !creating && /* @__PURE__ */ React.createElement("div", { className: "chat-list-empty" }, "No branches found"), filtered.map((branch, i) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: branch,
        className: `branch-item${branch === current ? " active" : ""}`,
        onClick: () => {
          if (branch !== current) onSwitch(branch);
        },
        title: branch
      },
      /* @__PURE__ */ React.createElement("span", { className: "branch-item-icon" }, branch === current ? "\u2713" : ""),
      /* @__PURE__ */ React.createElement("span", { className: "branch-item-name" }, branch)
    ))), /* @__PURE__ */ React.createElement("div", { className: "branch-selector-footer" }, creating ? /* @__PURE__ */ React.createElement("form", { className: "branch-create-form", onSubmit: (e) => {
      e.preventDefault();
      if (newName.trim()) {
        onCreate(newName.trim());
        setCreating(false);
        setNewName("");
      }
    } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        className: "branch-create-input",
        placeholder: "new-branch-name",
        value: newName,
        onChange: (e) => setNewName(e.target.value),
        autoFocus: true
      }
    ), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "branch-create-submit", disabled: !newName.trim() }, "Create"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "branch-create-cancel", onClick: () => {
      setCreating(false);
      setNewName("");
    } }, "\u2715")) : /* @__PURE__ */ React.createElement("button", { className: "branch-create-btn", onClick: () => setCreating(true) }, "+ Create and checkout new branch")));
  }
  function TerminalViewer({ entries, canRead, canInput, onClose, onRefresh, onSend, controlResults }) {
    const [command, setCommand] = useState3("");
    const [requestId, setRequestId] = useState3(null);
    const controlResult = requestId ? controlResults?.[requestId] : null;
    function submitCommand(event) {
      event.preventDefault();
      const text = command.trim();
      if (!text || !onSend) return;
      setRequestId(onSend(text));
      setCommand("");
    }
    return /* @__PURE__ */ React.createElement("div", { className: "terminal-viewer" }, /* @__PURE__ */ React.createElement("div", { className: "terminal-viewer-header" }, /* @__PURE__ */ React.createElement("span", { className: "terminal-viewer-title" }, "Terminal"), canRead && /* @__PURE__ */ React.createElement("button", { className: "terminal-viewer-refresh", onClick: onRefresh, title: "Refresh" }, "\u21BB"), /* @__PURE__ */ React.createElement("button", { className: "terminal-viewer-close", onClick: onClose, title: "Close" }, "\u2715")), canRead ? /* @__PURE__ */ React.createElement("div", { className: "terminal-viewer-body" }, !entries || entries.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "terminal-viewer-empty" }, "No terminal output captured") : entries.map((entry, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "terminal-entry" }, entry.command && /* @__PURE__ */ React.createElement("div", { className: "terminal-command" }, "$ ", entry.command), /* @__PURE__ */ React.createElement("pre", { className: "terminal-output" }, entry.output)))) : /* @__PURE__ */ React.createElement("div", { className: "terminal-viewer-empty" }, "Terminal output is unavailable for this harness."), canInput && /* @__PURE__ */ React.createElement("form", { className: "terminal-input-form", onSubmit: submitCommand }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "terminal-input",
        type: "text",
        value: command,
        onChange: (event) => setCommand(event.target.value),
        placeholder: "Enter a command in this session's terminal",
        "aria-label": "Terminal command"
      }
    ), /* @__PURE__ */ React.createElement("button", { className: "terminal-input-send", type: "submit", disabled: !command.trim() }, "Run"), requestId && /* @__PURE__ */ React.createElement("div", { className: `terminal-input-status ${controlResult?.result || "pending"}`, role: "status" }, !controlResult ? "Command pending\u2026" : controlResult.result === "ok" ? "Command sent" : `Command failed: ${controlResult.error?.message || controlResult.error?.code || "unknown error"}`)));
  }
  function DiffViewer({ entries, onClose, onRefresh, onAccept, onReject }) {
    const summaryChips = (summary) => {
      const text = String(summary || "").trim();
      if (!text) return [];
      return text.split(/\s+/).filter(Boolean).map((token) => ({
        text: token,
        cls: token.startsWith("+") ? "add" : token.startsWith("-") ? "del" : "neutral"
      }));
    };
    return /* @__PURE__ */ React.createElement("div", { className: "diff-viewer" }, /* @__PURE__ */ React.createElement("div", { className: "diff-viewer-header" }, /* @__PURE__ */ React.createElement("span", { className: "diff-viewer-title" }, "File Changes"), /* @__PURE__ */ React.createElement("button", { className: "diff-viewer-refresh", onClick: onRefresh, title: "Refresh" }, "\u21BB"), /* @__PURE__ */ React.createElement("button", { className: "diff-viewer-close", onClick: onClose, title: "Close" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "diff-viewer-body" }, !entries || entries.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "diff-viewer-empty" }, "No file changes detected") : entries.map((entry, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "diff-entry" }, entry.file && /* @__PURE__ */ React.createElement("div", { className: "diff-file-header" }, /* @__PURE__ */ React.createElement("span", null, entry.file || entry.path), (entry.can_accept || entry.can_reject) && onAccept && onReject && /* @__PURE__ */ React.createElement("span", { className: "diff-file-actions" }, entry.can_accept && /* @__PURE__ */ React.createElement("button", { type: "button", className: "diff-action-accept", onClick: () => onAccept(entry.id || entry.path) }, "Accept"), entry.can_reject && /* @__PURE__ */ React.createElement("button", { type: "button", className: "diff-action-reject", onClick: () => onReject(entry.id || entry.path) }, "Reject"))), entry.summary && /* @__PURE__ */ React.createElement("div", { className: "diff-file-summary" }, summaryChips(entry.summary).map((chip, ci) => /* @__PURE__ */ React.createElement("span", { key: ci, className: `diff-file-summary-chip diff-file-summary-chip-${chip.cls}` }, chip.text))), entry.content ? /* @__PURE__ */ React.createElement("pre", { className: "diff-content" }, entry.content.split("\n").map((line, li) => {
      const cls = line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-del" : line.startsWith("@@") ? "diff-hunk" : "";
      return /* @__PURE__ */ React.createElement("span", { key: li, className: cls }, line, "\n");
    })) : !entry.summary && /* @__PURE__ */ React.createElement("pre", { className: "diff-content" }, "No content")))));
  }
  var FILE_ICONS = {
    directory: "\u{1F4C1}",
    md: "\u{1F4C4}",
    txt: "\u{1F4C4}",
    json: "\u{1F4CB}",
    js: "\u{1F4DC}",
    jsx: "\u{1F4DC}",
    ts: "\u{1F4DC}",
    tsx: "\u{1F4DC}",
    py: "\u{1F40D}",
    html: "\u{1F310}",
    css: "\u{1F3A8}",
    yml: "\u2699",
    yaml: "\u2699",
    toml: "\u2699",
    sh: "\u26A1",
    bat: "\u26A1",
    ps1: "\u26A1",
    env: "\u{1F512}",
    lock: "\u{1F512}",
    png: "\u{1F5BC}",
    jpg: "\u{1F5BC}",
    gif: "\u{1F5BC}",
    svg: "\u{1F5BC}",
    default: "\u{1F4C4}"
  };
  function getFileIcon(entry) {
    if (entry.type === "directory") return FILE_ICONS.directory;
    const ext = entry.name.split(".").pop().toLowerCase();
    return FILE_ICONS[ext] || FILE_ICONS.default;
  }
  function formatFileSize(bytes) {
    if (bytes == null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  var VIEWABLE_EXTENSIONS = /* @__PURE__ */ new Set([
    "md",
    "txt",
    "json",
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "html",
    "css",
    "yml",
    "yaml",
    "toml",
    "sh",
    "bat",
    "ps1",
    "cfg",
    "conf",
    "ini",
    "xml",
    "csv",
    "log",
    "env",
    "gitignore",
    "dockerignore",
    "sql",
    "rs",
    "go",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
    "rb",
    "php",
    "swift",
    "kt",
    "scala",
    "r",
    "lua",
    "vim",
    "zsh",
    "bash",
    "fish"
  ]);
  function isViewableFile(name) {
    const ext = name.split(".").pop().toLowerCase();
    return VIEWABLE_EXTENSIONS.has(ext) || name.startsWith(".");
  }
  function isMarkdownFile(name) {
    return name.toLowerCase().endsWith(".md");
  }
  function MarkdownViewer({ path: filePath, content, truncated, onBack }) {
    const rendered = React.useMemo(() => {
      if (!content) return "";
      try {
        const html = marked.parse(content);
        return DOMPurify.sanitize(html);
      } catch (e) {
        return `<pre>${DOMPurify.sanitize(content)}</pre>`;
      }
    }, [content]);
    const bodyRef = React.useRef(null);
    React.useEffect(() => {
      if (bodyRef.current) {
        bodyRef.current.querySelectorAll("pre code").forEach((block) => {
          hljs.highlightElement(block);
        });
      }
    }, [rendered]);
    const fileName = filePath ? filePath.split("/").pop().split("\\").pop() : "File";
    return /* @__PURE__ */ React.createElement("div", { className: "file-viewer" }, /* @__PURE__ */ React.createElement("div", { className: "file-viewer-header" }, /* @__PURE__ */ React.createElement("button", { className: "file-viewer-back", onClick: onBack, title: "Back to files" }, "\u2190"), /* @__PURE__ */ React.createElement("span", { className: "file-viewer-title", title: filePath }, fileName), truncated && /* @__PURE__ */ React.createElement("span", { className: "file-viewer-truncated" }, "truncated")), /* @__PURE__ */ React.createElement("div", { className: "file-viewer-body markdown-body", ref: bodyRef, dangerouslySetInnerHTML: { __html: rendered } }));
  }
  function PlainFileViewer({ path: filePath, content, truncated, onBack }) {
    const fileName = filePath ? filePath.split("/").pop().split("\\").pop() : "File";
    const ext = fileName.split(".").pop().toLowerCase();
    const highlighted = React.useMemo(() => {
      if (!content) return "";
      try {
        if (ext && hljs.getLanguage(ext)) {
          return hljs.highlight(content, { language: ext }).value;
        }
        return hljs.highlightAuto(content).value;
      } catch (e) {
        return DOMPurify.sanitize(content);
      }
    }, [content, ext]);
    return /* @__PURE__ */ React.createElement("div", { className: "file-viewer" }, /* @__PURE__ */ React.createElement("div", { className: "file-viewer-header" }, /* @__PURE__ */ React.createElement("button", { className: "file-viewer-back", onClick: onBack, title: "Back to files" }, "\u2190"), /* @__PURE__ */ React.createElement("span", { className: "file-viewer-title", title: filePath }, fileName), truncated && /* @__PURE__ */ React.createElement("span", { className: "file-viewer-truncated" }, "truncated")), /* @__PURE__ */ React.createElement("div", { className: "file-viewer-body" }, /* @__PURE__ */ React.createElement("pre", { className: "file-viewer-code" }, /* @__PURE__ */ React.createElement("code", { dangerouslySetInnerHTML: { __html: highlighted } }))));
  }
  function buildTranscriptPreviewContent(filePath, content) {
    const lang = getLang(filePath || "text");
    const maxBackticks = Math.max(...String(content || "").match(/`+/g)?.map((run) => run.length) || [0]);
    const fence = "`".repeat(Math.max(3, maxBackticks + 1));
    return `${fence}${lang}
${content || ""}
${fence}`;
  }
  function TranscriptInlineFilePreview({ sessionId, filePath, fileContents, onClose }) {
    const key = `${sessionId}:${filePath}`;
    const fileData = fileContents[key];
    const content = fileData?.content || "";
    const truncated = fileData?.truncated || false;
    const previewContent = React.useMemo(
      () => buildTranscriptPreviewContent(filePath, content),
      [filePath, content]
    );
    return /* @__PURE__ */ React.createElement("div", { className: "transcript-inline-preview" }, /* @__PURE__ */ React.createElement("div", { className: "transcript-inline-preview-header" }, /* @__PURE__ */ React.createElement("span", { className: "transcript-inline-preview-title", title: filePath }, filePath), truncated && /* @__PURE__ */ React.createElement("span", { className: "file-viewer-truncated" }, "truncated"), /* @__PURE__ */ React.createElement("button", { className: "transcript-inline-preview-close", onClick: onClose, title: "Collapse" }, "Collapse")), !fileData ? /* @__PURE__ */ React.createElement("div", { className: "transcript-file-loading" }, /* @__PURE__ */ React.createElement("div", null, "Loading file preview...")) : /* @__PURE__ */ React.createElement(MarkdownContent, { content: previewContent, monospace: true }));
  }
  function FileBrowser({ sessionId, listing, fileContents, onNavigate, onOpenFile, onClose, onRefresh, viewingFile, onBackToListing }) {
    if (viewingFile) {
      const key = `${sessionId}:${viewingFile}`;
      const fileData = fileContents[key];
      const content = fileData?.content || "";
      const truncated = fileData?.truncated || false;
      if (isMarkdownFile(viewingFile)) {
        return /* @__PURE__ */ React.createElement(MarkdownViewer, { path: viewingFile, content, truncated, onBack: onBackToListing });
      }
      return /* @__PURE__ */ React.createElement(PlainFileViewer, { path: viewingFile, content, truncated, onBack: onBackToListing });
    }
    const entries = listing?.entries || [];
    const currentPath = listing?.path || ".";
    const pathParts = currentPath === "." ? [] : currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
    return /* @__PURE__ */ React.createElement("div", { className: "file-browser" }, /* @__PURE__ */ React.createElement("div", { className: "file-browser-header" }, /* @__PURE__ */ React.createElement("span", { className: "file-browser-title" }, "Files"), /* @__PURE__ */ React.createElement("button", { className: "file-browser-refresh", onClick: onRefresh, title: "Refresh" }, "\u21BB"), /* @__PURE__ */ React.createElement("button", { className: "file-browser-close", onClick: onClose, title: "Close" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "file-browser-breadcrumbs" }, /* @__PURE__ */ React.createElement("button", { className: "breadcrumb-item", onClick: () => onNavigate(".") }, "root"), pathParts.map((part, i) => {
      const subPath = pathParts.slice(0, i + 1).join("/");
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: subPath }, /* @__PURE__ */ React.createElement("span", { className: "breadcrumb-sep" }, "/"), /* @__PURE__ */ React.createElement("button", { className: "breadcrumb-item", onClick: () => onNavigate(subPath) }, part));
    })), /* @__PURE__ */ React.createElement("div", { className: "file-browser-body" }, entries.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "file-browser-empty" }, "Empty directory") : /* @__PURE__ */ React.createElement("div", { className: "file-browser-list" }, currentPath !== "." && /* @__PURE__ */ React.createElement("div", { className: "file-browser-entry", onClick: () => {
      const parent = pathParts.slice(0, -1).join("/") || ".";
      onNavigate(parent);
    } }, /* @__PURE__ */ React.createElement("span", { className: "file-entry-icon" }, "\u{1F4C1}"), /* @__PURE__ */ React.createElement("span", { className: "file-entry-name" }, "..")), entries.map((entry) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: entry.name,
        className: `file-browser-entry${entry.type === "directory" ? " is-dir" : ""}${isViewableFile(entry.name) ? " is-viewable" : ""}`,
        onClick: () => {
          if (entry.type === "directory") {
            const newPath = currentPath === "." ? entry.name : `${currentPath}/${entry.name}`;
            onNavigate(newPath);
          } else if (isViewableFile(entry.name)) {
            const filePath = currentPath === "." ? entry.name : `${currentPath}/${entry.name}`;
            onOpenFile(filePath);
          }
        }
      },
      /* @__PURE__ */ React.createElement("span", { className: "file-entry-icon" }, getFileIcon(entry)),
      /* @__PURE__ */ React.createElement("span", { className: "file-entry-name" }, entry.name),
      /* @__PURE__ */ React.createElement("span", { className: "file-entry-meta" }, entry.type === "file" && formatFileSize(entry.size))
    )))));
  }
  var SCHEDULE_LABELS = {
    daily: "Daily",
    weekdays: "Weekdays",
    weekly: "Weekly",
    custom: "Custom"
  };
  var CATEGORY_ICONS = {
    "Status reports": "\u{1F4CA}",
    "Release prep": "\u{1F680}",
    "Code quality": "\u{1F50D}",
    "Documentation": "\u{1F4DD}",
    "General": "\u2699"
  };
  function AutomationCard({ automation, onEdit, onRun, onToggle }) {
    const icon = CATEGORY_ICONS[automation.category] || "\u2699";
    const scheduleLabel = SCHEDULE_LABELS[automation.schedule] || automation.schedule;
    const agentCfg = AGENT_CONFIG[automation.target_agent_type] || DEFAULT_AGENT;
    return /* @__PURE__ */ React.createElement("div", { className: `automation-card${automation.enabled ? "" : " disabled"}`, onClick: () => onEdit(automation) }, /* @__PURE__ */ React.createElement("div", { className: "automation-card-icon" }, icon), /* @__PURE__ */ React.createElement("div", { className: "automation-card-body" }, /* @__PURE__ */ React.createElement("div", { className: "automation-card-name" }, automation.name), automation.description && /* @__PURE__ */ React.createElement("div", { className: "automation-card-desc" }, automation.description)), /* @__PURE__ */ React.createElement("div", { className: "automation-card-meta" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "automation-card-agent",
        style: { color: agentCfg.color },
        title: agentCfg.name
      },
      agentCfg.abbr
    ), /* @__PURE__ */ React.createElement("span", { className: "automation-card-schedule" }, scheduleLabel, " ", String(automation.cron_hour).padStart(2, "0"), ":", String(automation.cron_minute).padStart(2, "0"))), /* @__PURE__ */ React.createElement("div", { className: "automation-card-actions", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "automation-run-btn",
        title: "Run now",
        onClick: () => onRun(automation)
      },
      "\u25B6"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `automation-toggle-btn${automation.enabled ? " on" : ""}`,
        title: automation.enabled ? "Disable" : "Enable",
        onClick: () => onToggle(automation)
      },
      automation.enabled ? "\u25CF" : "\u25CB"
    )));
  }
  function AutomationModal({ automation, sessions, onSave, onDelete, onClose }) {
    const isNew = !automation?.id;
    const [form, setForm] = useState3({
      name: automation?.name || "",
      description: automation?.description || "",
      category: automation?.category || "General",
      prompt: automation?.prompt || "",
      schedule: automation?.schedule || "daily",
      cron_hour: automation?.cron_hour ?? 9,
      cron_minute: automation?.cron_minute ?? 0,
      cron_days: automation?.cron_days || [1, 2, 3, 4, 5],
      target_agent_type: automation?.target_agent_type || "claude",
      target_session: automation?.target_session || "",
      enabled: automation?.enabled !== false
    });
    const [saving, setSaving] = useState3(false);
    function setField(key, value) {
      setForm((prev) => ({ ...prev, [key]: value }));
    }
    function toggleDay(day) {
      setForm((prev) => {
        const days = prev.cron_days.includes(day) ? prev.cron_days.filter((d) => d !== day) : [...prev.cron_days, day].sort();
        return { ...prev, cron_days: days };
      });
    }
    async function handleSubmit(e) {
      e.preventDefault();
      if (!form.name.trim() || !form.prompt.trim()) return;
      setSaving(true);
      await onSave({ ...form, target_session: form.target_session || null });
      setSaving(false);
    }
    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return /* @__PURE__ */ React.createElement("div", { className: "automation-modal-overlay", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "automation-modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "automation-modal-header" }, /* @__PURE__ */ React.createElement("span", null, isNew ? "New Automation" : "Edit Automation"), /* @__PURE__ */ React.createElement("button", { className: "automation-modal-close", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("form", { className: "automation-modal-form", onSubmit: handleSubmit }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Name"), /* @__PURE__ */ React.createElement("input", { type: "text", value: form.name, onChange: (e) => setField("name", e.target.value), placeholder: "e.g. Daily standup summary", required: true })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Description"), /* @__PURE__ */ React.createElement("input", { type: "text", value: form.description, onChange: (e) => setField("description", e.target.value), placeholder: "Brief description (optional)" })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Category"), /* @__PURE__ */ React.createElement("select", { value: form.category, onChange: (e) => setField("category", e.target.value) }, Object.keys(CATEGORY_ICONS).map((cat) => /* @__PURE__ */ React.createElement("option", { key: cat, value: cat }, CATEGORY_ICONS[cat], " ", cat)))), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Prompt"), /* @__PURE__ */ React.createElement("textarea", { rows: 4, value: form.prompt, onChange: (e) => setField("prompt", e.target.value), placeholder: "The prompt to send to the agent...", required: true })), /* @__PURE__ */ React.createElement("div", { className: "automation-modal-row" }, /* @__PURE__ */ React.createElement("label", { className: "half" }, /* @__PURE__ */ React.createElement("span", null, "Target Agent"), /* @__PURE__ */ React.createElement("select", { value: form.target_agent_type, onChange: (e) => setField("target_agent_type", e.target.value) }, Object.entries(AGENT_CONFIG).map(([key, cfg]) => /* @__PURE__ */ React.createElement("option", { key, value: key }, cfg.name)))), /* @__PURE__ */ React.createElement("label", { className: "half" }, /* @__PURE__ */ React.createElement("span", null, "Specific Session (optional)"), /* @__PURE__ */ React.createElement("select", { value: form.target_session, onChange: (e) => setField("target_session", e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Any matching session"), (sessions || []).map((s) => {
      const id = typeof s === "string" ? s : s?.session_id;
      const agent = sessionAgent(s);
      return /* @__PURE__ */ React.createElement("option", { key: id, value: id }, agent.name, ": ", sessionLabel(id) || id);
    })))), /* @__PURE__ */ React.createElement("div", { className: "automation-modal-row" }, /* @__PURE__ */ React.createElement("label", { className: "third" }, /* @__PURE__ */ React.createElement("span", null, "Schedule"), /* @__PURE__ */ React.createElement("select", { value: form.schedule, onChange: (e) => setField("schedule", e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "daily" }, "Daily"), /* @__PURE__ */ React.createElement("option", { value: "weekdays" }, "Weekdays"), /* @__PURE__ */ React.createElement("option", { value: "weekly" }, "Weekly"), /* @__PURE__ */ React.createElement("option", { value: "custom" }, "Custom days"))), /* @__PURE__ */ React.createElement("label", { className: "third" }, /* @__PURE__ */ React.createElement("span", null, "Hour"), /* @__PURE__ */ React.createElement("input", { type: "number", min: 0, max: 23, value: form.cron_hour, onChange: (e) => setField("cron_hour", parseInt(e.target.value) || 0) })), /* @__PURE__ */ React.createElement("label", { className: "third" }, /* @__PURE__ */ React.createElement("span", null, "Minute"), /* @__PURE__ */ React.createElement("input", { type: "number", min: 0, max: 59, value: form.cron_minute, onChange: (e) => setField("cron_minute", parseInt(e.target.value) || 0) }))), (form.schedule === "custom" || form.schedule === "weekly") && /* @__PURE__ */ React.createElement("div", { className: "automation-days-row" }, /* @__PURE__ */ React.createElement("span", null, "Days:"), DAY_NAMES.map((name, i) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: i,
        type: "button",
        className: `automation-day-btn${form.cron_days.includes(i) ? " active" : ""}`,
        onClick: () => toggleDay(i)
      },
      name
    ))), /* @__PURE__ */ React.createElement("div", { className: "automation-modal-footer" }, !isNew && /* @__PURE__ */ React.createElement("button", { type: "button", className: "automation-delete-btn", onClick: () => onDelete(automation) }, "Delete"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }), /* @__PURE__ */ React.createElement("button", { type: "button", className: "automation-cancel-btn", onClick: onClose }, "Cancel"), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "automation-save-btn", disabled: saving || !form.name.trim() || !form.prompt.trim() }, saving ? "Saving..." : isNew ? "Create" : "Save")))));
  }
  function AutomationsView({ sessions, onBack }) {
    const [automations, setAutomations] = useState3([]);
    const [loading, setLoading] = useState3(true);
    const [editTarget, setEditTarget] = useState3(null);
    const [toast, setToast] = useState3("");
    function showToast(msg) {
      setToast(msg);
      setTimeout(() => setToast(""), 3e3);
    }
    async function fetchAutomations() {
      try {
        const res = await fetch("/api/automations");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setAutomations(data.automations || []);
      } catch (e) {
        showToast("Failed to load automations");
      } finally {
        setLoading(false);
      }
    }
    useEffect3(() => {
      fetchAutomations();
    }, []);
    async function handleSave(form) {
      const isNew = !editTarget?.id;
      const url = isNew ? "/api/automations" : `/api/automations/${editTarget.id}`;
      const method = isNew ? "POST" : "PUT";
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form)
        });
        if (!res.ok) throw new Error("Save failed");
        showToast(isNew ? "Automation created" : "Automation updated");
        setEditTarget(null);
        fetchAutomations();
      } catch {
        showToast("Failed to save automation");
      }
    }
    async function handleDelete(automation) {
      if (!window.confirm(`Delete "${automation.name}"?`)) return;
      try {
        await fetch(`/api/automations/${automation.id}`, { method: "DELETE" });
        showToast("Automation deleted");
        setEditTarget(null);
        fetchAutomations();
      } catch {
        showToast("Failed to delete");
      }
    }
    async function handleRun(automation) {
      try {
        const res = await fetch(`/api/automations/${automation.id}/run`, { method: "POST" });
        const data = await res.json();
        if (res.ok) {
          showToast(`Running "${automation.name}"...`);
        } else {
          showToast(data.error || "Failed to run");
        }
      } catch {
        showToast("Failed to run automation");
      }
    }
    async function handleToggle(automation) {
      try {
        await fetch(`/api/automations/${automation.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !automation.enabled })
        });
        fetchAutomations();
      } catch {
        showToast("Failed to toggle");
      }
    }
    const categories = {};
    for (const auto of automations) {
      const cat = auto.category || "General";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(auto);
    }
    return /* @__PURE__ */ React.createElement("div", { className: "automations-view" }, /* @__PURE__ */ React.createElement("div", { className: "automations-header" }, /* @__PURE__ */ React.createElement("button", { className: "automations-back", onClick: onBack, title: "Back to sessions" }, "\u2190"), /* @__PURE__ */ React.createElement("div", { className: "automations-header-text" }, /* @__PURE__ */ React.createElement("h2", null, "Automations"), /* @__PURE__ */ React.createElement("p", null, "Automate work by sending scheduled prompts to your agents.")), /* @__PURE__ */ React.createElement("button", { className: "automations-new-btn", onClick: () => setEditTarget({}) }, "+ New automation")), loading ? /* @__PURE__ */ React.createElement("div", { className: "automations-loading" }, "Loading automations...") : automations.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "automations-empty" }, /* @__PURE__ */ React.createElement("div", { className: "automations-empty-icon" }, "\u2699"), /* @__PURE__ */ React.createElement("div", { className: "automations-empty-text" }, "No automations yet"), /* @__PURE__ */ React.createElement("div", { className: "automations-empty-sub" }, "Create your first automation to schedule recurring prompts to your agents."), /* @__PURE__ */ React.createElement("button", { className: "automations-new-btn", onClick: () => setEditTarget({}) }, "+ New automation")) : /* @__PURE__ */ React.createElement("div", { className: "automations-body" }, Object.entries(categories).map(([cat, items]) => /* @__PURE__ */ React.createElement("div", { key: cat, className: "automations-category" }, /* @__PURE__ */ React.createElement("h3", { className: "automations-category-title" }, cat), /* @__PURE__ */ React.createElement("div", { className: "automations-card-grid" }, items.map((auto) => /* @__PURE__ */ React.createElement(
      AutomationCard,
      {
        key: auto.id,
        automation: auto,
        onEdit: setEditTarget,
        onRun: handleRun,
        onToggle: handleToggle
      }
    )))))), editTarget !== null && /* @__PURE__ */ React.createElement(
      AutomationModal,
      {
        automation: editTarget?.id ? editTarget : null,
        sessions,
        onSave: handleSave,
        onDelete: handleDelete,
        onClose: () => setEditTarget(null)
      }
    ), toast && /* @__PURE__ */ React.createElement("div", { className: "automations-toast" }, toast));
  }
  function CodexAutomationPane({ view, onShow }) {
    if (!view?.visible) return null;
    const statusRows = Array.isArray(view.status_rows) ? view.status_rows : [];
    const detailRows = Array.isArray(view.detail_rows) ? view.detail_rows : [];
    const status = view.status || statusRows.find((row) => row.label === "Status")?.value || "";
    return /* @__PURE__ */ React.createElement("aside", { className: "codex-automation-pane", "aria-label": "Codex automation" }, /* @__PURE__ */ React.createElement("div", { className: "codex-automation-pane-header" }, /* @__PURE__ */ React.createElement("div", { className: "codex-automation-pane-icon" }, "o"), /* @__PURE__ */ React.createElement("div", { className: "codex-automation-pane-title" }, view.title || "Automation")), view.description && /* @__PURE__ */ React.createElement("div", { className: "codex-automation-pane-desc" }, view.description), (statusRows.length > 0 || status) && /* @__PURE__ */ React.createElement("div", { className: "codex-automation-pane-section" }, /* @__PURE__ */ React.createElement("div", { className: "codex-automation-pane-section-title" }, "Status"), statusRows.length > 0 ? statusRows.map((row, i) => /* @__PURE__ */ React.createElement("div", { key: `${row.label}-${i}`, className: "codex-automation-pane-row" }, /* @__PURE__ */ React.createElement("span", null, row.label), /* @__PURE__ */ React.createElement("strong", { className: row.label === "Status" && /active/i.test(row.value) ? "active" : "" }, row.value))) : /* @__PURE__ */ React.createElement("div", { className: "codex-automation-pane-row" }, /* @__PURE__ */ React.createElement("span", null, "Status"), /* @__PURE__ */ React.createElement("strong", null, status))), detailRows.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "codex-automation-pane-section" }, /* @__PURE__ */ React.createElement("div", { className: "codex-automation-pane-section-title" }, "Details"), detailRows.map((row, i) => /* @__PURE__ */ React.createElement("div", { key: `${row.label}-${i}`, className: "codex-automation-pane-row" }, /* @__PURE__ */ React.createElement("span", null, row.label), /* @__PURE__ */ React.createElement("strong", null, row.value)))), view.action_label && /* @__PURE__ */ React.createElement("button", { className: "codex-automation-pane-action", onClick: onShow }, view.action_label));
  }
  function formatUsageTokens(value) {
    return new Intl.NumberFormat([], { notation: "compact", maximumFractionDigits: 1 }).format(Math.max(0, Number(value) || 0));
  }
  function UsageCostPanel({ cost, detailState, onRequestDetail }) {
    const [days, setDays] = React.useState(1);
    const [project, setProject] = React.useState("");
    const localSelected = React.useMemo(() => selectEstimatedCost(cost, { days, project }), [cost, days, project]);
    const detail = detailState?.status === "ready" ? detailState.detail : null;
    const detailMatches = !!detail && Number(detail.query?.days) === days && String(detail.query?.project || "") === project && (!cost?.generatedAt || String(detail.generated_at || "") === cost.generatedAt);
    const loadingInitialPageMatches = detailState?.status === "loading" && Number(detailState.query?.days) === days && String(detailState.query?.project || "") === project && String(detailState.query?.cursor || "0") === "0";
    const readyInitialPageMatches = detailMatches && String(detail.pagination?.cursor || "0") === "0";
    const selected = detailMatches ? {
      costUsd: Math.max(0, Number(detail.summary?.cost_usd) || 0),
      records: Math.max(0, Number(detail.summary?.records) || 0),
      tokens: {
        input: Math.max(0, Number(detail.summary?.tokens?.input) || 0),
        cached: Math.max(0, Number(detail.summary?.tokens?.cached) || 0),
        output: Math.max(0, Number(detail.summary?.tokens?.output) || 0)
      },
      byModel: Array.isArray(detail.summary?.by_model) ? detail.summary.by_model : [],
      byDay: Array.isArray(detail.summary?.by_day) ? detail.summary.by_day : []
    } : localSelected;
    React.useEffect(() => {
      if (!cost?.detail?.truncated || !onRequestDetail) return;
      if (loadingInitialPageMatches || readyInitialPageMatches) return;
      onRequestDetail({ days, project, cursor: "0", pageSize: cost.detail.pageSize || 256 });
    }, [cost?.detail?.truncated, cost?.detail?.pageSize, cost?.generatedAt, days, project, onRequestDetail]);
    if (!cost) return null;
    const hasAuthoritativeTotals = (["ready", "partial", "stale"].includes(cost.status) || cost.status === "scanning" && !!cost.lastGoodGeneratedAt) && cost.costUsd != null && cost.records != null && cost.tokens.input != null && cost.tokens.cached != null && cost.tokens.output != null;
    const stateCopy = {
      "not-started": ["Not scanned yet", "The local cost scan has not completed."],
      idle: ["Not scanned yet", "The local cost scan has not completed."],
      scanning: ["Scanning local history", "Provider quota remains available while cost files are scanned."],
      error: ["Cost scan unavailable", "The last cost payload failed its bounded structural contract. Provider quota is still current."],
      unavailable: ["Cost scan unavailable", "Local cost sources are unavailable. Provider quota is still current."],
      cancelled: ["Cost scan cancelled", "No zero total is reported because the scan did not complete."]
    }[cost.status] || ["Cost data pending", "Waiting for an authoritative local cost scan."];
    if (!hasAuthoritativeTotals) return /* @__PURE__ */ React.createElement("section", { className: "usage-cost-panel", "aria-labelledby": "usage-cost-heading" }, /* @__PURE__ */ React.createElement("div", { className: "usage-cost-heading" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("h3", { id: "usage-cost-heading" }, "Local estimated API-equivalent cost"), /* @__PURE__ */ React.createElement("small", null, "Separate from subscription quota")), /* @__PURE__ */ React.createElement("span", { className: `usage-cost-status ${cost.status}` }, cost.status)), /* @__PURE__ */ React.createElement("div", { className: "usage-cost-state", role: "status" }, /* @__PURE__ */ React.createElement("strong", null, stateCopy[0]), /* @__PURE__ */ React.createElement("span", null, stateCopy[1]), cost.reasonCode && /* @__PURE__ */ React.createElement("small", null, "Reason: ", cost.reasonCode, cost.reasonPath ? ` (${cost.reasonPath})` : "")), /* @__PURE__ */ React.createElement("div", { className: "usage-cost-scan" }, Number.isFinite(Number(cost.scan.files_complete)) ? `Incremental local JSONL scan - ${cost.scan.files_complete}/${cost.scan.files_total || 0} files` : "Incremental local JSONL scan has not reported file progress."));
    const projects = [...new Set(cost.byProject.map((row) => row.project).filter(Boolean))].sort();
    const modelRows = [...selected?.byModel || []].sort((left, right) => right.cost_usd - left.cost_usd).slice(0, 12);
    const dayRows = [...selected?.byDay || []].sort((left, right) => left.day.localeCompare(right.day));
    const maximumDayCost = Math.max(1e-6, ...dayRows.map((row) => Number(row.cost_usd) || 0));
    return /* @__PURE__ */ React.createElement("section", { className: "usage-cost-panel", "aria-labelledby": "usage-cost-heading" }, /* @__PURE__ */ React.createElement("div", { className: "usage-cost-heading" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("h3", { id: "usage-cost-heading" }, "Local estimated API-equivalent cost"), /* @__PURE__ */ React.createElement("small", null, "Separate from subscription quota \xB7 pricing ", cost.catalogVersion || "unavailable")), /* @__PURE__ */ React.createElement("span", { className: `usage-cost-status ${cost.status}` }, cost.status)), /* @__PURE__ */ React.createElement("div", { className: "usage-cost-controls" }, /* @__PURE__ */ React.createElement("label", null, "Range", /* @__PURE__ */ React.createElement("select", { value: days, onChange: (event) => setDays(Number(event.target.value)) }, [1, 7, 30, 90, 365].map((value) => /* @__PURE__ */ React.createElement("option", { key: value, value }, value === 1 ? "Today" : `${value} days`)))), /* @__PURE__ */ React.createElement("label", null, "Project", /* @__PURE__ */ React.createElement("select", { value: project, onChange: (event) => setProject(event.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "All projects"), projects.map((value) => /* @__PURE__ */ React.createElement("option", { key: value, value }, value))))), /* @__PURE__ */ React.createElement("div", { className: "usage-cost-summary" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "$", (selected?.costUsd || 0).toFixed(2)), /* @__PURE__ */ React.createElement("small", null, "estimated cost")), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, formatUsageTokens(selected?.tokens.input)), /* @__PURE__ */ React.createElement("small", null, "input tokens")), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, formatUsageTokens(selected?.tokens.cached)), /* @__PURE__ */ React.createElement("small", null, "cached tokens")), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, formatUsageTokens(selected?.tokens.output)), /* @__PURE__ */ React.createElement("small", null, "output tokens"))), cost.detail?.truncated && /* @__PURE__ */ React.createElement("div", { className: "usage-cost-detail-state", role: "status" }, detailMatches ? `Showing detail rows ${Number(detail.pagination?.cursor || 0) + 1}-${Number(detail.pagination?.cursor || 0) + Number(detail.pagination?.returned_rows || 0)} of ${Number(detail.pagination?.total_rows || 0)}.` : detailState?.status === "error" ? "Cost detail is unavailable." : `Loading a bounded detail page for ${cost.detail.totalRows} cost-detail rows.`), /* @__PURE__ */ React.createElement("div", { className: "usage-cost-chart", role: "img", "aria-label": `${days}-day estimated cost by day` }, (dayRows.length ? dayRows : [{ day: "No data", cost_usd: 0 }]).map((row) => /* @__PURE__ */ React.createElement("span", { key: row.day, title: `${row.day}: $${Number(row.cost_usd).toFixed(4)}` }, /* @__PURE__ */ React.createElement("i", { style: { height: `${Math.max(3, Number(row.cost_usd) / maximumDayCost * 100)}%` } }), /* @__PURE__ */ React.createElement("small", null, row.day.slice(5))))), cost.detail?.truncated && /* @__PURE__ */ React.createElement("details", { className: "usage-cost-detail-table" }, /* @__PURE__ */ React.createElement("summary", null, "Cost detail rows"), detailState?.status === "loading" && /* @__PURE__ */ React.createElement("div", { className: "usage-cost-detail-state" }, "Loading cost detail\u2026"), detailState?.status === "error" && /* @__PURE__ */ React.createElement("div", { className: "usage-cost-detail-state" }, "Cost detail unavailable: ", detailState.error), detailMatches && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "usage-cost-detail-pager", "aria-label": "Cost detail pagination" }, /* @__PURE__ */ React.createElement("button", { type: "button", disabled: Number(detail.pagination?.cursor || 0) <= 0, onClick: () => onRequestDetail({
      days,
      project,
      cursor: String(Math.max(0, Number(detail.pagination.cursor || 0) - Number(detail.pagination.page_size || 256))),
      pageSize: detail.pagination.page_size || 256
    }) }, "Previous"), /* @__PURE__ */ React.createElement("span", null, detail.pagination.returned_rows, " rows \xB7 ", detail.pagination.total_rows, " total"), /* @__PURE__ */ React.createElement("button", { type: "button", disabled: !detail.pagination?.next_cursor, onClick: () => onRequestDetail({
      days,
      project,
      cursor: detail.pagination.next_cursor,
      pageSize: detail.pagination.page_size || 256
    }) }, "Next")), /* @__PURE__ */ React.createElement("div", { className: "usage-cost-table-wrap" }, /* @__PURE__ */ React.createElement("table", { className: "usage-cost-table" }, /* @__PURE__ */ React.createElement("caption", null, "Paginated local cost detail"), /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Day"), /* @__PURE__ */ React.createElement("th", null, "Provider / model"), /* @__PURE__ */ React.createElement("th", null, "Project"), /* @__PURE__ */ React.createElement("th", null, "Speed"), /* @__PURE__ */ React.createElement("th", null, "Cost"))), /* @__PURE__ */ React.createElement("tbody", null, (detail.rows || []).map((row, index) => /* @__PURE__ */ React.createElement("tr", { key: `${detail.pagination.cursor}:${index}` }, /* @__PURE__ */ React.createElement("td", null, row.day), /* @__PURE__ */ React.createElement("th", { scope: "row" }, row.provider_id, " \xB7 ", row.model), /* @__PURE__ */ React.createElement("td", null, row.project), /* @__PURE__ */ React.createElement("td", null, row.speed), /* @__PURE__ */ React.createElement("td", null, "$", Number(row.cost_usd).toFixed(4))))))))), /* @__PURE__ */ React.createElement("div", { className: "usage-cost-table-wrap" }, /* @__PURE__ */ React.createElement("table", { className: "usage-cost-table" }, /* @__PURE__ */ React.createElement("caption", null, "Estimated cost and tokens by provider model"), /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Provider / model"), /* @__PURE__ */ React.createElement("th", null, "Input"), /* @__PURE__ */ React.createElement("th", null, "Cached"), /* @__PURE__ */ React.createElement("th", null, "Output"), /* @__PURE__ */ React.createElement("th", null, "Cost"))), /* @__PURE__ */ React.createElement("tbody", null, modelRows.map((row) => /* @__PURE__ */ React.createElement("tr", { key: `${row.provider_id}:${row.model}` }, /* @__PURE__ */ React.createElement("th", { scope: "row" }, row.provider_id === "openai-codex" ? "Codex" : "Claude", " \xB7 ", row.model), /* @__PURE__ */ React.createElement("td", null, formatUsageTokens(row.input)), /* @__PURE__ */ React.createElement("td", null, formatUsageTokens(row.cached)), /* @__PURE__ */ React.createElement("td", null, formatUsageTokens(row.output)), /* @__PURE__ */ React.createElement("td", null, "$", Number(row.cost_usd).toFixed(4))))))), cost.unknownModels.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "usage-cost-fallbacks" }, /* @__PURE__ */ React.createElement("strong", null, "Fallback pricing"), cost.unknownModels.map((item) => /* @__PURE__ */ React.createElement("span", { key: `${item.provider_id}:${item.model}` }, item.model, " \u2192 ", item.fallback))), /* @__PURE__ */ React.createElement("div", { className: "usage-cost-scan" }, "Incremental local JSONL scan \xB7 ", cost.scan.files_complete || 0, "/", cost.scan.files_total || 0, " files \xB7 ", cost.records, " deduplicated records"));
  }
  function UsageDashboard({ usage, refreshReceipt, costDetail, onBack, onRefresh, onRequestCostDetail }) {
    const normalized = React.useMemo(() => normalizeProviderUsage(usage), [usage]);
    const [nowMs, setNowMs] = React.useState(Date.now());
    React.useEffect(() => {
      if (normalized.collectionState === "not-started") onRefresh(false);
      const timer = setInterval(() => setNowMs(Date.now()), 3e4);
      return () => clearInterval(timer);
    }, [onRefresh, normalized.collectionState]);
    const statusLabel = (status) => ({
      fresh: "Fresh",
      refreshing: "Refreshing",
      stale: "Stale",
      auth_required: "Sign in required",
      rate_limited: "Refresh limited",
      unavailable: "Unavailable"
    })[status] || "Unavailable";
    return /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard", "data-testid": "usage-dashboard" }, /* @__PURE__ */ React.createElement("div", { className: "automations-header usage-dashboard-header" }, /* @__PURE__ */ React.createElement("button", { className: "automations-back", onClick: onBack, title: "Back to sessions" }, "\u2190"), /* @__PURE__ */ React.createElement("div", { className: "automations-header-text" }, /* @__PURE__ */ React.createElement("h2", null, "Usage & limits"), /* @__PURE__ */ React.createElement("p", null, "Provider-account quotas shared by connected harnesses. Warnings start at 80% used.")), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "usage-dashboard-refresh",
        onClick: () => onRefresh(true),
        disabled: normalized.inFlight,
        "aria-label": "Refresh provider usage"
      },
      normalized.inFlight ? "Refreshing\u2026" : "Refresh"
    )), normalized.collectionState !== "ready" && /* @__PURE__ */ React.createElement("div", { className: `usage-dashboard-collection-state ${normalized.collectionState}`, role: "status" }, /* @__PURE__ */ React.createElement("strong", null, {
      "not-started": "Provider usage has not been collected yet",
      refreshing: "Refreshing provider usage",
      partial: "Some provider usage is unavailable",
      stale: "Showing last-good provider usage",
      unavailable: "Provider usage is unavailable"
    }[normalized.collectionState] || "Provider usage is pending"), /* @__PURE__ */ React.createElement("span", null, "Generation ", normalized.generation, normalized.generatedAt ? ` \xB7 ${formatProviderUsageAge(normalized.generatedAt, nowMs)}` : "")), /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-summary", "aria-label": "Usage summary" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, normalized.summaryAuthoritative ? normalized.summary.providers : "\u2014"), /* @__PURE__ */ React.createElement("span", null, "providers")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, normalized.summaryAuthoritative ? normalized.summary.accounts : "\u2014"), /* @__PURE__ */ React.createElement("span", null, "accounts")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, normalized.summaryAuthoritative ? normalized.summary.reporting : "\u2014"), /* @__PURE__ */ React.createElement("span", null, "reporting")), /* @__PURE__ */ React.createElement("div", { className: normalized.summary.nearLimit > 0 ? "warning" : "" }, /* @__PURE__ */ React.createElement("strong", null, normalized.summaryAuthoritative ? normalized.summary.nearLimit : "\u2014"), /* @__PURE__ */ React.createElement("span", null, "near limit")), /* @__PURE__ */ React.createElement("div", { className: normalized.summary.exhausted > 0 ? "critical" : "" }, /* @__PURE__ */ React.createElement("strong", null, normalized.summaryAuthoritative ? normalized.summary.exhausted : "\u2014"), /* @__PURE__ */ React.createElement("span", null, "exhausted"))), refreshReceipt && /* @__PURE__ */ React.createElement("div", { className: `usage-refresh-receipt ${refreshReceipt.status}`, role: "status" }, "Refresh ", refreshReceipt.status, refreshReceipt.generation != null ? ` \xB7 generation ${refreshReceipt.generation}` : ""), /* @__PURE__ */ React.createElement(UsageCostPanel, { cost: normalized.estimatedCost, detailState: costDetail, onRequestDetail: onRequestCostDetail }), /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-grid" }, normalized.entries.map((entry) => {
      const creditLabel = formatProviderCredits(entry.credits);
      const creditReset = entry.credits?.resets_at ? formatProviderUsageReset(entry.credits.resets_at, nowMs) : "";
      return /* @__PURE__ */ React.createElement(
        "details",
        {
          open: true,
          className: `usage-dashboard-card ${entry.tone}`,
          key: entry.key,
          "data-provider-id": entry.providerId,
          "data-account-fingerprint": entry.accountFingerprint
        },
        /* @__PURE__ */ React.createElement("summary", { className: "usage-dashboard-card-summary" }, /* @__PURE__ */ React.createElement("span", { className: "usage-dashboard-provider-mark", "aria-hidden": "true" }, entry.providerName.slice(0, 2).toUpperCase()), /* @__PURE__ */ React.createElement("span", { className: "usage-dashboard-card-title" }, /* @__PURE__ */ React.createElement("strong", null, entry.providerName), /* @__PURE__ */ React.createElement("span", null, entry.accountLabel, entry.plan ? ` \xB7 ${entry.plan}` : "")), /* @__PURE__ */ React.createElement("span", { className: `usage-dashboard-status ${entry.status}` }, statusLabel(entry.status))),
        /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-card-body" }, /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-card-meta" }, /* @__PURE__ */ React.createElement("span", null, entry.sessionCount, " mapped session", entry.sessionCount === 1 ? "" : "s"), /* @__PURE__ */ React.createElement("span", null, entry.harnessTypes.length > 0 ? entry.harnessTypes.join(", ") : "No mapped surfaces"), /* @__PURE__ */ React.createElement("span", null, formatProviderUsageAge(entry.capturedAt, nowMs))), entry.windows.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-windows" }, entry.windows.map((window2) => {
          const tone = window2.tone;
          const reset = window2.resetDescription || formatProviderUsageReset(window2.resetsAt, nowMs);
          return /* @__PURE__ */ React.createElement("div", { className: `usage-dashboard-window ${tone}`, key: window2.id }, /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-window-heading" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, window2.label), window2.modelScope?.label ? /* @__PURE__ */ React.createElement("small", null, "Model: ", window2.modelScope.label) : window2.scope && window2.scope !== window2.label ? /* @__PURE__ */ React.createElement("small", null, window2.scope) : null), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, window2.remainingPercent == null ? "Unavailable" : `${formatProviderPercent(window2.remainingPercent)} left`), /* @__PURE__ */ React.createElement("small", null, window2.usedPercent == null ? "No reported value" : `${formatProviderPercent(window2.usedPercent)} used`))), window2.usedPercent != null && /* @__PURE__ */ React.createElement(
            "div",
            {
              className: "usage-dashboard-meter",
              role: "progressbar",
              "aria-label": `${entry.providerName} ${window2.label}`,
              "aria-valuetext": `${formatProviderPercent(window2.usedPercent)} used`,
              "aria-valuemin": "0",
              "aria-valuemax": "100",
              "aria-valuenow": Math.round(window2.visualPercent)
            },
            /* @__PURE__ */ React.createElement("span", { style: { width: `${window2.visualPercent}%` } })
          ), /* @__PURE__ */ React.createElement("div", { className: "usage-window-thresholds" }, "Warning ", formatProviderPercent(window2.thresholds.warningPercent), " \xB7 Critical ", formatProviderPercent(window2.thresholds.criticalPercent)), window2.pace && /* @__PURE__ */ React.createElement("div", { className: `usage-pace ${window2.pace.category}` }, /* @__PURE__ */ React.createElement("div", { className: "usage-pace-heading" }, /* @__PURE__ */ React.createElement("span", { className: "usage-pace-category" }, window2.pace.category), /* @__PURE__ */ React.createElement("span", null, "Ideal ", formatProviderPercent(window2.pace.expectedUsedPercent), " \xB7 projected ", formatProviderPercent(window2.pace.projectedUsedPercent))), /* @__PURE__ */ React.createElement("div", { className: "usage-pace-chart", role: "img", "aria-label": `${window2.label} actual ${formatProviderPercent(window2.usedPercent)}, ideal ${formatProviderPercent(window2.pace.expectedUsedPercent)}, projected ${formatProviderPercent(window2.pace.projectedUsedPercent)}` }, /* @__PURE__ */ React.createElement("span", { className: "usage-pace-actual", style: { width: `${window2.visualPercent}%` } }), /* @__PURE__ */ React.createElement("i", { className: "usage-pace-ideal", style: { left: `${Math.min(100, window2.pace.expectedUsedPercent)}%` } }), /* @__PURE__ */ React.createElement("i", { className: "usage-pace-projected", style: { left: `${Math.min(100, window2.pace.projectedUsedPercent)}%` } })), /* @__PURE__ */ React.createElement("div", { className: "usage-pace-budgets" }, Object.entries({ Now: "now", "+1 hour": "next_hour", "+5 hours": "next_five_hours", Today: "today" }).map(([label, key]) => /* @__PURE__ */ React.createElement("span", { key }, /* @__PURE__ */ React.createElement("small", null, label), /* @__PURE__ */ React.createElement("strong", null, formatProviderPercent(window2.pace.budgets?.[key] || 0))))), /* @__PURE__ */ React.createElement("div", { className: "usage-pace-outcome" }, window2.usedPercent >= 100 ? "Quota is exhausted" : window2.pace.willLastToReset ? "Current pace lasts to reset" : `Projected exhaustion ${formatProviderUsageReset(window2.pace.exhaustionAt, nowMs)}`)), reset && /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-reset" }, "Resets ", reset), /* @__PURE__ */ React.createElement("div", { className: "usage-window-provenance" }, window2.source || entry.source, window2.provenance ? ` \xB7 ${window2.provenance}` : ""));
        })) : /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-unavailable" }, entry.error?.message || "This provider did not report quota windows."), (creditLabel || entry.resetCredits) && /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-credit-row" }, creditLabel && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Credits"), creditLabel, creditReset && /* @__PURE__ */ React.createElement("small", null, "Resets ", creditReset)), entry.resetCredits && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, "Rate-limit resets"), entry.resetCredits.available_count || 0, " available")), Array.isArray(entry.resetCredits?.details) && entry.resetCredits.details.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-reset-credits" }, entry.resetCredits.details.map((credit, index) => /* @__PURE__ */ React.createElement("span", { key: `${credit.title || "reset"}-${index}` }, /* @__PURE__ */ React.createElement("strong", null, credit.title || `Reset credit ${index + 1}`), credit.status && /* @__PURE__ */ React.createElement("small", null, credit.status), credit.expires_at && /* @__PURE__ */ React.createElement("small", null, "Expires ", formatProviderUsageReset(credit.expires_at, nowMs))))), entry.error?.message && entry.windows.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-stale-error" }, "Last refresh: ", entry.error.message), /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-source-row" }, /* @__PURE__ */ React.createElement("span", null, "Source: ", entry.source ? entry.source.replace(/_/g, " ") : "not available", entry.latencyMs != null ? ` \xB7 ${entry.latencyMs} ms` : ""), entry.dashboardUrl && /* @__PURE__ */ React.createElement("a", { href: entry.dashboardUrl, target: "_blank", rel: "noreferrer" }, "Open provider dashboard")))
      );
    }), normalized.entries.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-empty" }, /* @__PURE__ */ React.createElement("strong", null, normalized.collectionState === "ready" ? "The completed scan found no provider usage." : "Provider usage is not available yet."), /* @__PURE__ */ React.createElement("span", null, normalized.collectionState === "ready" ? "Connect a supported Codex, Claude Code, Antigravity, or Cursor session, then refresh." : "Quota totals remain unknown until a provider collection completes."))));
  }
  var HOST_RESOURCE_CHART_WIDTH = 640;
  var HOST_RESOURCE_CHART_HEIGHT = 220;
  var HOST_RESOURCE_CHART_MARGIN = Object.freeze({ left: 54, right: 14, top: 12, bottom: 32 });
  function clampHostViewport(viewport) {
    const width = Math.max(0.04, Math.min(1, Number(viewport?.end) - Number(viewport?.start) || 1));
    const start = Math.max(0, Math.min(1 - width, Number(viewport?.start) || 0));
    return { start, end: start + width };
  }
  function hostResourceChartPath(samples, valueField, xFor, yFor) {
    let path = "";
    let drawing = false;
    samples.forEach((sample) => {
      const value = sample[valueField];
      if (sample.gap || value == null || !Number.isFinite(value)) {
        drawing = false;
        return;
      }
      path += `${drawing ? "L" : "M"}${xFor(sample).toFixed(2)},${yFor(value).toFixed(2)} `;
      drawing = true;
    });
    return path.trim();
  }
  function HostResourceChart({
    title,
    description,
    frames,
    series,
    percentScale = false,
    viewport,
    onViewportChange,
    crosshairSequence,
    onCrosshairChange
  }) {
    const chartRef = React.useRef(null);
    const pointersRef = React.useRef(/* @__PURE__ */ new Map());
    const gestureRef = React.useRef(null);
    const [hiddenSeries, setHiddenSeries] = React.useState({});
    const [scale, setScale] = React.useState({ mode: "auto", fixedMax: null });
    const plotWidth = HOST_RESOURCE_CHART_WIDTH - HOST_RESOURCE_CHART_MARGIN.left - HOST_RESOURCE_CHART_MARGIN.right;
    const plotHeight = HOST_RESOURCE_CHART_HEIGHT - HOST_RESOURCE_CHART_MARGIN.top - HOST_RESOURCE_CHART_MARGIN.bottom;
    const orderedFrames = Array.isArray(frames) ? frames : [];
    const boundedViewport = clampHostViewport(viewport);
    const startIndex = Math.max(0, Math.floor((orderedFrames.length - 1) * boundedViewport.start));
    const endIndex = Math.min(orderedFrames.length, Math.ceil((orderedFrames.length - 1) * boundedViewport.end) + 1);
    const visibleFrames = orderedFrames.slice(startIndex, Math.max(startIndex + 1, endIndex));
    const chartSeries = series.map((entry) => {
      const sourceFrames = entry.frames || visibleFrames;
      const visibleSequences = new Set(visibleFrames.map((frame) => frame.sample_sequence));
      const boundedSource = entry.frames ? sourceFrames.filter((frame) => visibleSequences.has(frame.sample_sequence)) : sourceFrames;
      return {
        ...entry,
        visibleFrames: boundedSource,
        samples: downsampleHostResourceSeries(boundedSource, entry.metric, 180)
      };
    });
    const activeSeries = chartSeries.filter((entry) => !hiddenSeries[entry.key]);
    const autoMaximum = Math.max(1, ...activeSeries.flatMap((entry) => entry.samples.map((sample) => sample.max || 0))) * 1.08;
    const yMaximum = percentScale ? 100 : scale.mode === "fixed" && scale.fixedMax ? scale.fixedMax : autoMaximum;
    const sequenceMinimum = visibleFrames[0]?.sample_sequence || 0;
    const sequenceMaximum = visibleFrames.at(-1)?.sample_sequence || Math.max(1, sequenceMinimum);
    const xFor = (sample) => HOST_RESOURCE_CHART_MARGIN.left + (sample.endSequence - sequenceMinimum) / Math.max(1, sequenceMaximum - sequenceMinimum) * plotWidth;
    const yFor = (value) => HOST_RESOURCE_CHART_MARGIN.top + plotHeight - Math.max(0, Math.min(yMaximum, value)) / Math.max(1, yMaximum) * plotHeight;
    const crosshairFrame = visibleFrames.find((frame) => frame.sample_sequence === crosshairSequence) || visibleFrames.at(-1) || null;
    const crosshairX = crosshairFrame ? HOST_RESOURCE_CHART_MARGIN.left + (crosshairFrame.sample_sequence - sequenceMinimum) / Math.max(1, sequenceMaximum - sequenceMinimum) * plotWidth : null;
    const formatValue = series[0]?.format || ((value) => String(value));
    function clientFraction(event) {
      const bounds = chartRef.current?.getBoundingClientRect();
      if (!bounds?.width) return 0.5;
      return Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    }
    function sequenceAtFraction(fraction) {
      if (!visibleFrames.length) return 0;
      const index = Math.max(0, Math.min(visibleFrames.length - 1, Math.round(fraction * (visibleFrames.length - 1))));
      return visibleFrames[index].sample_sequence;
    }
    function zoomAt(factor, fraction = 0.5) {
      const current = clampHostViewport(viewport);
      const width = Math.max(0.04, Math.min(1, (current.end - current.start) * factor));
      const absoluteCenter = current.start + (current.end - current.start) * fraction;
      onViewportChange(clampHostViewport({ start: absoluteCenter - width * fraction, end: absoluteCenter + width * (1 - fraction) }));
    }
    React.useEffect(() => {
      const node = chartRef.current;
      if (!node) return void 0;
      const onWheel = (event) => {
        event.preventDefault();
        zoomAt(event.deltaY > 0 ? 1.2 : 0.8, clientFraction(event));
      };
      node.addEventListener("wheel", onWheel, { passive: false });
      return () => node.removeEventListener("wheel", onWheel);
    });
    function onPointerDown(event) {
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
      }
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      onCrosshairChange(sequenceAtFraction(clientFraction(event)));
      if (pointersRef.current.size === 1) {
        gestureRef.current = { mode: "pan", pointerId: event.pointerId, startX: event.clientX, viewport: clampHostViewport(viewport) };
      } else if (pointersRef.current.size === 2) {
        const points = [...pointersRef.current.values()];
        gestureRef.current = {
          mode: "pinch",
          distance: Math.max(1, Math.abs(points[1].x - points[0].x)),
          center: (clientFraction({ clientX: points[0].x }) + clientFraction({ clientX: points[1].x })) / 2,
          viewport: clampHostViewport(viewport)
        };
      }
    }
    function onPointerMove(event) {
      if (!pointersRef.current.has(event.pointerId)) {
        onCrosshairChange(sequenceAtFraction(clientFraction(event)));
        return;
      }
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const gesture = gestureRef.current;
      if (gesture?.mode === "pinch" && pointersRef.current.size >= 2) {
        const points = [...pointersRef.current.values()];
        const distance = Math.max(1, Math.abs(points[1].x - points[0].x));
        const originalWidth = gesture.viewport.end - gesture.viewport.start;
        const width = Math.max(0.04, Math.min(1, originalWidth * gesture.distance / distance));
        const absoluteCenter = gesture.viewport.start + originalWidth * gesture.center;
        onViewportChange(clampHostViewport({
          start: absoluteCenter - width * gesture.center,
          end: absoluteCenter + width * (1 - gesture.center)
        }));
        return;
      }
      if (gesture?.mode === "pan" && gesture.pointerId === event.pointerId) {
        const bounds = chartRef.current?.getBoundingClientRect();
        const width = gesture.viewport.end - gesture.viewport.start;
        const shift = bounds?.width ? -(event.clientX - gesture.startX) / bounds.width * width : 0;
        onViewportChange(clampHostViewport({ start: gesture.viewport.start + shift, end: gesture.viewport.end + shift }));
      }
    }
    function onPointerUp(event) {
      pointersRef.current.delete(event.pointerId);
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
      }
      if (pointersRef.current.size === 0) gestureRef.current = null;
    }
    function onKeyDown(event) {
      if (!visibleFrames.length) return;
      const currentIndex = Math.max(0, visibleFrames.findIndex((frame) => frame.sample_sequence === crosshairSequence));
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        if (event.shiftKey) {
          const width = boundedViewport.end - boundedViewport.start;
          const shift = width * (event.key === "ArrowLeft" ? -0.1 : 0.1);
          onViewportChange(clampHostViewport({ start: boundedViewport.start + shift, end: boundedViewport.end + shift }));
        } else {
          const next = Math.max(0, Math.min(visibleFrames.length - 1, currentIndex + (event.key === "ArrowLeft" ? -1 : 1)));
          onCrosshairChange(visibleFrames[next].sample_sequence);
        }
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        onCrosshairChange((event.key === "Home" ? visibleFrames[0] : visibleFrames.at(-1)).sample_sequence);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAt(0.75);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomAt(1.25);
      }
    }
    return /* @__PURE__ */ React.createElement("section", { className: "host-resource-chart", "aria-label": `${title} chart` }, /* @__PURE__ */ React.createElement("div", { className: "host-resource-chart-heading" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", null, title), /* @__PURE__ */ React.createElement("small", null, description)), !percentScale && /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setScale((previous) => previous.mode === "auto" ? { mode: "fixed", fixedMax: autoMaximum } : { mode: "auto", fixedMax: null }) }, scale.mode === "auto" ? "Auto scale" : `Fixed ${formatValue(scale.fixedMax)}`)), /* @__PURE__ */ React.createElement("div", { className: "host-resource-chart-legend", "aria-label": `${title} series` }, chartSeries.map((entry) => /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        key: entry.key,
        "aria-pressed": !hiddenSeries[entry.key],
        onClick: () => setHiddenSeries((previous) => ({ ...previous, [entry.key]: !previous[entry.key] }))
      },
      /* @__PURE__ */ React.createElement("i", { style: { background: entry.color } }),
      entry.label
    ))), /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "host-resource-chart-canvas",
        ref: chartRef,
        role: "application",
        tabIndex: "0",
        "aria-label": `${title}. Drag to pan, wheel or pinch to zoom, arrow keys move the synchronized crosshair, shift plus arrows pan, plus and minus zoom.`,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
        onKeyDown
      },
      /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${HOST_RESOURCE_CHART_WIDTH} ${HOST_RESOURCE_CHART_HEIGHT}`, "aria-hidden": "true" }, [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const y = HOST_RESOURCE_CHART_MARGIN.top + plotHeight * fraction;
        return /* @__PURE__ */ React.createElement("line", { key: fraction, className: "host-resource-chart-grid", x1: HOST_RESOURCE_CHART_MARGIN.left, x2: HOST_RESOURCE_CHART_WIDTH - HOST_RESOURCE_CHART_MARGIN.right, y1: y, y2: y });
      }), /* @__PURE__ */ React.createElement("text", { x: "4", y: HOST_RESOURCE_CHART_MARGIN.top + 4 }, formatValue(yMaximum)), /* @__PURE__ */ React.createElement("text", { x: "4", y: HOST_RESOURCE_CHART_MARGIN.top + plotHeight + 4 }, formatValue(0)), activeSeries.flatMap((entry) => entry.samples.map((sample) => sample.gap || sample.min == null || sample.max == null ? null : /* @__PURE__ */ React.createElement(
        "line",
        {
          key: `${entry.key}-${sample.endSequence}`,
          className: "host-resource-chart-range",
          stroke: entry.color,
          x1: xFor(sample),
          x2: xFor(sample),
          y1: yFor(sample.min),
          y2: yFor(sample.max)
        }
      ))), activeSeries.map((entry) => /* @__PURE__ */ React.createElement(
        "path",
        {
          key: entry.key,
          className: "host-resource-chart-line",
          stroke: entry.color,
          strokeDasharray: entry.dashed ? "6 4" : void 0,
          d: hostResourceChartPath(entry.samples, "average", xFor, yFor)
        }
      )), crosshairX != null && /* @__PURE__ */ React.createElement("line", { className: "host-resource-chart-crosshair", x1: crosshairX, x2: crosshairX, y1: HOST_RESOURCE_CHART_MARGIN.top, y2: HOST_RESOURCE_CHART_MARGIN.top + plotHeight }), /* @__PURE__ */ React.createElement("text", { x: HOST_RESOURCE_CHART_MARGIN.left, y: HOST_RESOURCE_CHART_HEIGHT - 7 }, formatHostResourceTimestamp(visibleFrames[0]?.captured_at)), /* @__PURE__ */ React.createElement("text", { textAnchor: "end", x: HOST_RESOURCE_CHART_WIDTH - HOST_RESOURCE_CHART_MARGIN.right, y: HOST_RESOURCE_CHART_HEIGHT - 7 }, formatHostResourceTimestamp(visibleFrames.at(-1)?.captured_at))),
      crosshairFrame && /* @__PURE__ */ React.createElement("div", { className: "host-resource-chart-tooltip", role: "status" }, /* @__PURE__ */ React.createElement("strong", null, formatHostResourceTimestamp(crosshairFrame.captured_at), " / seq ", crosshairFrame.sample_sequence), chartSeries.map((entry) => /* @__PURE__ */ React.createElement("span", { key: entry.key }, /* @__PURE__ */ React.createElement("i", { style: { background: entry.color } }), entry.label, ": ", entry.format(hostResourceMetricValue(
        entry.visibleFrames.find((frame) => frame.sample_sequence === crosshairFrame.sample_sequence),
        entry.metric
      )))))
    ), /* @__PURE__ */ React.createElement("div", { className: "host-resource-chart-stats" }, chartSeries.filter((entry) => !hiddenSeries[entry.key]).map((entry) => {
      const stats = hostResourceIntervalStats(entry.visibleFrames, entry.metric);
      const peakFrame = entry.visibleFrames.find((frame) => frame.sample_sequence === stats.peakSequence);
      return /* @__PURE__ */ React.createElement("span", { key: entry.key }, /* @__PURE__ */ React.createElement("strong", null, entry.label), " current ", entry.format(stats.current), " / min ", entry.format(stats.min), " / avg ", entry.format(stats.average), " / max ", entry.format(stats.max), " / p95 ", entry.format(stats.p95), /* @__PURE__ */ React.createElement("small", null, "Peak ", formatHostResourceTimestamp(peakFrame?.captured_at)));
    })), /* @__PURE__ */ React.createElement("details", { className: "host-resource-chart-data" }, /* @__PURE__ */ React.createElement("summary", null, "Accessible data table"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("caption", null, "Latest ", Math.min(120, visibleFrames.length), " of ", visibleFrames.length, " visible samples"), /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Time / sequence"), chartSeries.map((entry) => /* @__PURE__ */ React.createElement("th", { key: entry.key }, entry.label)))), /* @__PURE__ */ React.createElement("tbody", null, visibleFrames.slice(-120).map((frame) => /* @__PURE__ */ React.createElement("tr", { key: frame.sample_sequence }, /* @__PURE__ */ React.createElement("th", null, formatHostResourceTimestamp(frame.captured_at), " / ", frame.sample_sequence), chartSeries.map((entry) => /* @__PURE__ */ React.createElement("td", { key: entry.key }, entry.format(hostResourceMetricValue(entry.visibleFrames.find((candidate) => candidate.sample_sequence === frame.sample_sequence), entry.metric)))))))))));
  }
  function hostResourceProcessRows(processes, search, filter, sort, expanded) {
    const query = search.trim().toLowerCase();
    const matches = (process) => (!query || [process.name, process.agentLabel, process.workspaceLabel, process.pid, process.attributionReason].some((value) => String(value || "").toLowerCase().includes(query))) && (filter === "all" || process.attributionLevel === filter);
    const candidates = processes.filter(matches);
    const candidateKeys = new Set(candidates.map((process) => process.stableKey));
    const compare = (left, right) => {
      if (sort === "name") return (left.agentLabel || left.name).localeCompare(right.agentLabel || right.name) || left.pid - right.pid;
      if (sort === "memory") return right.memoryBytes - left.memoryBytes || left.pid - right.pid;
      if (sort === "read") return right.ioReadBps - left.ioReadBps || left.pid - right.pid;
      if (sort === "write") return right.ioWriteBps - left.ioWriteBps || left.pid - right.pid;
      return right.cpuHostPercent - left.cpuHostPercent || left.pid - right.pid;
    };
    const children = /* @__PURE__ */ new Map();
    candidates.forEach((process) => {
      const parent = candidateKeys.has(process.parentKey) ? process.parentKey : "";
      children.set(parent, [...children.get(parent) || [], process]);
    });
    const rows = [];
    function visit(parent, depth) {
      (children.get(parent) || []).sort(compare).forEach((process) => {
        rows.push({ process, depth });
        if (expanded[process.stableKey] !== false) visit(process.stableKey, depth + 1);
      });
    }
    visit("", 0);
    return rows;
  }
  function HostResourceDashboard({
    snapshot,
    error,
    history,
    details,
    subscription,
    onBack,
    onRefresh,
    onSubscribe,
    onUnsubscribe
  }) {
    const normalized = React.useMemo(() => normalizeHostResources(snapshot), [snapshot]);
    const [nowMs, setNowMs] = React.useState(Date.now());
    const [range, setRange] = React.useState("live");
    const [pausedSequence, setPausedSequence] = React.useState(null);
    const [viewport, setViewport] = React.useState({ start: 0, end: 1 });
    const [crosshairSequence, setCrosshairSequence] = React.useState(0);
    const [aggregateOnly, setAggregateOnly] = React.useState(false);
    const [processSearch, setProcessSearch] = React.useState("");
    const [processFilter, setProcessFilter] = React.useState("all");
    const [processSort, setProcessSort] = React.useState("cpu");
    const [expandedProcesses, setExpandedProcesses] = React.useState({});
    const [selectedProcessKey, setSelectedProcessKey] = React.useState("");
    React.useEffect(() => {
      onSubscribe(aggregateOnly);
      return () => onUnsubscribe();
    }, [aggregateOnly, onSubscribe, onUnsubscribe]);
    React.useEffect(() => {
      const timer = setInterval(() => setNowMs(Date.now()), 1e3);
      return () => clearInterval(timer);
    }, []);
    const liveHistory = React.useMemo(() => pausedSequence == null ? history : history.filter((frame) => frame.sample_sequence <= pausedSequence), [history, pausedSequence]);
    const rangeFrames = React.useMemo(() => selectHostResourceRange(liveHistory, range), [liveHistory, range]);
    React.useEffect(() => {
      if (!crosshairSequence && rangeFrames.length) setCrosshairSequence(rangeFrames.at(-1).sample_sequence);
    }, [crosshairSequence, rangeFrames]);
    const system = normalized.system;
    const diskRate = system ? system.disk.readBps + system.disk.writeBps : 0;
    const networkRate = system ? system.network.receiveBps + system.network.sendBps : 0;
    const processRows = React.useMemo(() => hostResourceProcessRows(
      normalized.processes,
      processSearch,
      processFilter,
      processSort,
      expandedProcesses
    ), [normalized.processes, processSearch, processFilter, processSort, expandedProcesses]);
    const selectedProcess = normalized.processes.find((process) => process.stableKey === selectedProcessKey) || null;
    const selectedProcessFrames = React.useMemo(() => selectedProcessKey ? details.flatMap((detail) => {
      const process = (detail.processes || []).find((entry) => entry.stable_key === selectedProcessKey);
      if (!process) return [];
      return [{
        frame_kind: "system",
        sample_sequence: detail.sample_sequence,
        captured_at: detail.captured_at,
        sample_interval_ms: detail.sample_interval_ms,
        dropped_gap_count: detail.dropped_gap_count,
        status: detail.status,
        cpu: { total_percent: process.cpu_host_percent },
        disk: { read_bps: process.io_read_bps, write_bps: process.io_write_bps }
      }];
    }) : [], [details, selectedProcessKey]);
    const percent2 = (value) => value == null ? "\u2014" : formatHostResourcePercent(value);
    const rate = (value) => value == null ? "\u2014" : formatHostResourceRate(value);
    const cpuSeries = [
      { key: "cpu-total", metric: "cpu_total_percent", label: "Total", color: "#58a6ff", format: percent2 },
      { key: "cpu-user", metric: "cpu_user_percent", label: "User", color: "#3fb950", format: percent2 },
      { key: "cpu-kernel", metric: "cpu_privileged_percent", label: "Kernel", color: "#d29922", format: percent2 },
      ...selectedProcessFrames.length ? [{ key: "process-cpu", metric: "cpu_total_percent", label: `${selectedProcess?.agentLabel || selectedProcess?.name || "Process"} overlay`, color: "#f778ba", format: percent2, frames: selectedProcessFrames, dashed: true }] : []
    ];
    const diskSeries = [
      { key: "disk-read", metric: "disk_read_bps", label: "Read", color: "#58a6ff", format: rate },
      { key: "disk-write", metric: "disk_write_bps", label: "Write", color: "#f0883e", format: rate },
      ...selectedProcessFrames.length ? [
        { key: "process-read", metric: "disk_read_bps", label: "Process read overlay", color: "#bc8cff", format: rate, frames: selectedProcessFrames, dashed: true },
        { key: "process-write", metric: "disk_write_bps", label: "Process write overlay", color: "#f778ba", format: rate, frames: selectedProcessFrames, dashed: true }
      ] : []
    ];
    return /* @__PURE__ */ React.createElement("div", { className: "host-resource-dashboard", "data-testid": "host-resource-dashboard" }, /* @__PURE__ */ React.createElement("div", { className: "automations-header host-resource-header" }, /* @__PURE__ */ React.createElement("button", { className: "automations-back", onClick: onBack, title: "Back to sessions" }, "\u2190"), /* @__PURE__ */ React.createElement("div", { className: "automations-header-text" }, /* @__PURE__ */ React.createElement("h2", null, "Host resources"), /* @__PURE__ */ React.createElement("p", null, "Live, ephemeral Windows metrics. Process commands and executable paths never leave the proxy.")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "usage-dashboard-refresh", onClick: () => onRefresh(true), "aria-label": "Capture host resource detail now" }, "Capture detail")), /* @__PURE__ */ React.createElement("div", { className: "host-resource-meta" }, /* @__PURE__ */ React.createElement("span", { className: `host-resource-status ${normalized.status}` }, subscription?.status === "reconnecting" ? "Reconnecting" : normalized.available ? "Live" : "Unavailable"), /* @__PURE__ */ React.createElement("span", null, aggregateOnly ? "Aggregate-only" : normalized.machineLabel || "Windows host"), /* @__PURE__ */ React.createElement("span", null, formatHostResourceAge(normalized.capturedAt, nowMs)), /* @__PURE__ */ React.createElement("span", null, "1s system / 5s detail / seq ", normalized.sampleSequence || "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "host-resource-controls", "aria-label": "Host resource timeline controls" }, /* @__PURE__ */ React.createElement("div", { className: "host-resource-range", role: "group", "aria-label": "Time range" }, [["live", "Live"], ["1m", "1m"], ["5m", "5m"], ["15m", "15m"], ["since_open", "Since open"]].map(([value, label]) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: value,
        type: "button",
        className: range === value ? "active" : "",
        "aria-pressed": range === value,
        onClick: () => {
          setRange(value);
          setViewport({ start: 0, end: 1 });
        }
      },
      label
    ))), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setPausedSequence((previous) => previous == null ? history.at(-1)?.sample_sequence || 0 : null) }, pausedSequence == null ? "Pause" : "Resume"), /* @__PURE__ */ React.createElement("button", { type: "button", disabled: viewport.start === 0 && viewport.end === 1, onClick: () => setViewport({ start: 0, end: 1 }) }, "Reset zoom"), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: aggregateOnly, onChange: (event) => {
      setAggregateOnly(event.target.checked);
      setSelectedProcessKey("");
    } }), " Aggregate-only privacy"), /* @__PURE__ */ React.createElement("span", null, rangeFrames.length, " samples", pausedSequence == null ? "" : ` / paused at ${pausedSequence}`)), (error || normalized.error) && /* @__PURE__ */ React.createElement("div", { className: "host-resource-error", role: "status" }, error?.message || normalized.error?.message), system ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "host-resource-summary", "aria-label": "Host resource summary" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, Math.round(system.cpuPercent), "%"), /* @__PURE__ */ React.createElement("span", null, "CPU"), /* @__PURE__ */ React.createElement("small", null, system.cpu.logicalCoreCount || "\u2014", " logical / ", system.cpu.physicalCoreCount || "\u2014", " physical cores")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, Math.round(system.memory.usedPercent), "%"), /* @__PURE__ */ React.createElement("span", null, "memory"), /* @__PURE__ */ React.createElement("small", null, formatHostResourceBytes(system.memory.usedBytes), " / ", formatHostResourceBytes(system.memory.totalBytes), "; commit ", Math.round(system.memory.commitPercent), "%")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, formatHostResourceRate(diskRate)), /* @__PURE__ */ React.createElement("span", null, "disk I/O"), /* @__PURE__ */ React.createElement("small", null, "Read ", formatHostResourceRate(system.disk.readBps), " / write ", formatHostResourceRate(system.disk.writeBps), " / ", Math.round(system.disk.busyPercent), "% busy")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, formatHostResourceRate(networkRate)), /* @__PURE__ */ React.createElement("span", null, "network I/O"), /* @__PURE__ */ React.createElement("small", null, "Receive ", formatHostResourceRate(system.network.receiveBps), " / send ", formatHostResourceRate(system.network.sendBps)))), /* @__PURE__ */ React.createElement("div", { className: "host-resource-charts" }, /* @__PURE__ */ React.createElement(HostResourceChart, { title: "CPU", description: "Host utilization (%)", frames: rangeFrames, series: cpuSeries, percentScale: true, viewport, onViewportChange: setViewport, crosshairSequence, onCrosshairChange: setCrosshairSequence }), /* @__PURE__ */ React.createElement(HostResourceChart, { title: "Memory", description: "Physical used and committed (%)", frames: rangeFrames, series: [
      { key: "memory-used", metric: "memory_used_percent", label: "Physical used", color: "#bc8cff", format: percent2 },
      { key: "memory-commit", metric: "memory_commit_percent", label: "Committed", color: "#f778ba", format: percent2 }
    ], percentScale: true, viewport, onViewportChange: setViewport, crosshairSequence, onCrosshairChange: setCrosshairSequence }), /* @__PURE__ */ React.createElement(HostResourceChart, { title: "Disk", description: "Aggregate throughput (IEC bytes/s)", frames: rangeFrames, series: diskSeries, viewport, onViewportChange: setViewport, crosshairSequence, onCrosshairChange: setCrosshairSequence }), /* @__PURE__ */ React.createElement(HostResourceChart, { title: "Network", description: "Physical-default receive and send (IEC bytes/s)", frames: rangeFrames, series: [
      { key: "network-receive", metric: "network_receive_bps", label: "Receive", color: "#3fb950", format: rate },
      { key: "network-send", metric: "network_send_bps", label: "Send", color: "#d29922", format: rate }
    ], viewport, onViewportChange: setViewport, crosshairSequence, onCrosshairChange: setCrosshairSequence })), !aggregateOnly && /* @__PURE__ */ React.createElement("section", { className: "host-resource-process-section", "aria-labelledby": "host-resource-process-heading" }, /* @__PURE__ */ React.createElement("div", { className: "host-resource-process-heading" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("strong", { id: "host-resource-process-heading" }, "Processes"), /* @__PURE__ */ React.createElement("small", null, "Union of owned, top CPU, memory, read, and write. Attribution never implies unproved per-session ownership.")), /* @__PURE__ */ React.createElement("span", null, normalized.attributedProcesses.length, " attributed / ", normalized.processes.length, " shown")), /* @__PURE__ */ React.createElement("div", { className: "host-resource-process-controls" }, /* @__PURE__ */ React.createElement("label", null, "Search ", /* @__PURE__ */ React.createElement("input", { value: processSearch, onChange: (event) => setProcessSearch(event.target.value), placeholder: "Name, PID, agent, workspace" })), /* @__PURE__ */ React.createElement("label", null, "Attribution ", /* @__PURE__ */ React.createElement("select", { value: processFilter, onChange: (event) => setProcessFilter(event.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "All"), /* @__PURE__ */ React.createElement("option", { value: "owned" }, "Owned"), /* @__PURE__ */ React.createElement("option", { value: "runtime" }, "Runtime match"), /* @__PURE__ */ React.createElement("option", { value: "workspace-associated" }, "Workspace-associated"), /* @__PURE__ */ React.createElement("option", { value: "unattributed" }, "Unattributed"))), /* @__PURE__ */ React.createElement("label", null, "Sort ", /* @__PURE__ */ React.createElement("select", { value: processSort, onChange: (event) => setProcessSort(event.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "cpu" }, "CPU"), /* @__PURE__ */ React.createElement("option", { value: "memory" }, "Memory"), /* @__PURE__ */ React.createElement("option", { value: "read" }, "Read"), /* @__PURE__ */ React.createElement("option", { value: "write" }, "Write"), /* @__PURE__ */ React.createElement("option", { value: "name" }, "Name")))), selectedProcess && /* @__PURE__ */ React.createElement("div", { className: "host-resource-process-overlay", role: "region", "aria-label": `Process detail for ${selectedProcess.agentLabel || selectedProcess.name}` }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, selectedProcess.agentLabel || selectedProcess.name), /* @__PURE__ */ React.createElement("span", null, selectedProcess.name, " / PID ", selectedProcess.pid, " / started ", selectedProcess.startTime ? formatHostResourceTimestamp(selectedProcess.startTime) : "unknown"), /* @__PURE__ */ React.createElement("small", null, selectedProcess.attributionLevel, ": ", selectedProcess.attributionReason, ". CPU and disk overlays use the same synchronized timebase.")), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setSelectedProcessKey("") }, "Remove overlay"), /* @__PURE__ */ React.createElement("dl", null, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Host CPU"), /* @__PURE__ */ React.createElement("dd", null, selectedProcess.cpuHostPercent.toFixed(1), "%")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Core equivalent"), /* @__PURE__ */ React.createElement("dd", null, selectedProcess.cpuCoreEquivalent.toFixed(1), "%")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Working set"), /* @__PURE__ */ React.createElement("dd", null, formatHostResourceBytes(selectedProcess.memoryBytes))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Private / commit"), /* @__PURE__ */ React.createElement("dd", null, formatHostResourceBytes(selectedProcess.privateBytes), " / ", formatHostResourceBytes(selectedProcess.commitBytes))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Threads / handles"), /* @__PURE__ */ React.createElement("dd", null, selectedProcess.threadCount, " / ", selectedProcess.handleCount)), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "I/O operations"), /* @__PURE__ */ React.createElement("dd", null, "R ", selectedProcess.ioReadOps, " / W ", selectedProcess.ioWriteOps)), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "64-bit byte counters"), /* @__PURE__ */ React.createElement("dd", null, "R ", selectedProcess.counterTotals.ioReadBytes, " / W ", selectedProcess.counterTotals.ioWriteBytes)), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("dt", null, "Detail samples"), /* @__PURE__ */ React.createElement("dd", null, selectedProcessFrames.length, " / 5s cadence")))), /* @__PURE__ */ React.createElement("div", { className: "host-resource-process-scroll" }, /* @__PURE__ */ React.createElement("table", { className: "host-resource-process-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { scope: "col" }, "Agent / process tree"), /* @__PURE__ */ React.createElement("th", { scope: "col" }, "Confidence"), /* @__PURE__ */ React.createElement("th", { scope: "col" }, "CPU host / core"), /* @__PURE__ */ React.createElement("th", { scope: "col" }, "Memory"), /* @__PURE__ */ React.createElement("th", { scope: "col" }, "Read"), /* @__PURE__ */ React.createElement("th", { scope: "col" }, "Write"))), /* @__PURE__ */ React.createElement("tbody", null, processRows.map(({ process, depth }) => /* @__PURE__ */ React.createElement("tr", { key: process.stableKey, className: `${process.attributed ? "attributed" : ""} ${selectedProcessKey === process.stableKey ? "selected" : ""}`, "data-agent-attributed": process.attributed ? "true" : "false" }, /* @__PURE__ */ React.createElement("td", { style: { "--process-depth": depth } }, process.childCount > 0 && /* @__PURE__ */ React.createElement("button", { className: "host-resource-process-expand", type: "button", "aria-label": `${expandedProcesses[process.stableKey] === false ? "Expand" : "Collapse"} ${process.name}`, "aria-expanded": expandedProcesses[process.stableKey] !== false, onClick: () => setExpandedProcesses((previous) => ({ ...previous, [process.stableKey]: previous[process.stableKey] !== false ? false : true })) }, expandedProcesses[process.stableKey] === false ? "+" : "-"), /* @__PURE__ */ React.createElement("button", { className: "host-resource-process-select", type: "button", onClick: () => setSelectedProcessKey(process.stableKey) }, /* @__PURE__ */ React.createElement("strong", null, process.agentLabel || process.name), /* @__PURE__ */ React.createElement("span", null, process.agentLabel ? `${process.name} / ` : "", "PID ", process.pid, process.workspaceLabel ? ` / ${process.workspaceLabel}` : "", process.parentKey ? " / child process" : process.parentPid ? ` / parent PID ${process.parentPid} outside sample` : ""))), /* @__PURE__ */ React.createElement("td", { "data-label": "Confidence" }, /* @__PURE__ */ React.createElement("strong", null, process.attributionLevel), /* @__PURE__ */ React.createElement("span", { title: process.attributionReason }, process.attributionReason)), /* @__PURE__ */ React.createElement("td", { "data-label": "CPU host / core" }, process.cpuHostPercent.toFixed(1), "% / ", process.cpuCoreEquivalent.toFixed(1), "%"), /* @__PURE__ */ React.createElement("td", { "data-label": "Memory" }, formatHostResourceBytes(process.memoryBytes)), /* @__PURE__ */ React.createElement("td", { "data-label": "Read" }, formatHostResourceRate(process.ioReadBps)), /* @__PURE__ */ React.createElement("td", { "data-label": "Write" }, formatHostResourceRate(process.ioWriteBps)))))))), /* @__PURE__ */ React.createElement("div", { className: "host-resource-privacy" }, /* @__PURE__ */ React.createElement("strong", null, "Privacy boundary:"), " sanitized metrics cross the authenticated relay only to this requester while this view is open. The relay does not cache, persist, log, or restore them. Process command lines and executable paths remain local and are never transmitted. Aggregate-only mode also removes machine, device, adapter, workspace, process, and PID labels.")) : /* @__PURE__ */ React.createElement("div", { className: "usage-dashboard-empty host-resource-empty" }, /* @__PURE__ */ React.createElement("strong", null, "Waiting for the Windows proxy."), /* @__PURE__ */ React.createElement("span", null, "The subscription is ", subscription?.status || "starting", ". Gaps remain visible; unavailable samples are not interpolated.")));
  }
  function fleetWorkContextProgress(context) {
    const explicit = Number(context?.percent);
    if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));
    const completed = Number(context?.completed);
    const total = Number(context?.total);
    return Number.isInteger(completed) && Number.isInteger(total) && total > 0 ? Math.max(0, Math.min(100, completed / total * 100)) : null;
  }
  function fleetSessionSnippet(session, sessionMessages) {
    const direct = safeString(session?.last_snippet).trim();
    if (direct) return direct.replace(/\s+/g, " ").slice(0, 180);
    const list = Array.isArray(sessionMessages) ? sessionMessages : [];
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const text = stripTitleNoise(list[index]?.content || contentBlocksFallback(list[index]?.content_blocks));
      if (text) return text.slice(0, 180);
    }
    return "No recent message reported.";
  }
  function fleetElapsed(activity, nowMs) {
    if (activity?.goal) return formatGoalElapsed(activity.goal, nowMs);
    const startedAt = Date.parse(activity?.startedAt || activity?.started_at || activity?.since || "");
    return Number.isFinite(startedAt) ? formatClockDuration(Math.max(0, (nowMs - startedAt) / 1e3), { includeSeconds: true }) : "live";
  }
  function reconcileFleetSelection(previous, entryById, limit = MAX_BROADCAST_SESSIONS) {
    const next = previous.filter((id) => entryById[id]?.canReceiveBroadcast).slice(0, limit);
    return next.length === previous.length && next.every((id, index) => id === previous[index]) ? previous : next;
  }
  function FleetView({ sessions, activities, thinking, permissionPrompts, errorPrompts, messages, agentConfigs, sessionAttention, health, connected, deliveryStates, onBroadcastSend, onBack, onSelectSession }) {
    const [nowMs, setNowMs] = React.useState(Date.now());
    const [showIdle, setShowIdle] = React.useState(false);
    const [selectedIds, setSelectedIds] = React.useState([]);
    const [broadcastPrompt, setBroadcastPrompt] = React.useState("");
    const [broadcastConfirmation, setBroadcastConfirmation] = React.useState("");
    const [broadcastError, setBroadcastError] = React.useState("");
    const [broadcastReceipts, setBroadcastReceipts] = React.useState({});
    React.useEffect(() => {
      const timer = setInterval(() => setNowMs(Date.now()), 1e3);
      return () => clearInterval(timer);
    }, []);
    const allEntries = React.useMemo(() => (sessions || []).map((session) => {
      const id = sessionIdOf3(session);
      const hasLiveActivity = Object.prototype.hasOwnProperty.call(activities, id);
      const activity = hasLiveActivity ? activities[id] || { kind: "idle", label: "" } : session?.activity || { kind: "idle", label: "" };
      const prompt = permissionPrompts[id] || (isBlockingErrorPrompt(errorPrompts[id]) ? errorPrompts[id] : null);
      const attentionSignal = sessionAttention[id] || null;
      const attention = !!prompt || attentionSignal?.kind === "goal_attention";
      const config = agentConfigs[id] || {};
      const agentType = session?.agent_type;
      const goalCapable = goalLifecycleSupported(agentType, config.capabilities);
      const capabilitySafeActivity = goalCapable ? activity : { ...activity, goal: null };
      const activityForState = thinking[id] && !capabilitySafeActivity?.kind ? { ...capabilitySafeActivity, kind: "thinking" } : capabilitySafeActivity;
      const state = classifyFleetActivity(activityForState, attention, {
        connected,
        health: health[id],
        nowMs,
        requireFreshness: true
      });
      const needsAttention = state === "needs_attention";
      const working = fleetStateIsWorking(state);
      const agent = sessionAgent(session, config);
      const workContext = projectFleetWorkContext({
        agentType,
        capabilities: config.capabilities,
        activity: capabilitySafeActivity,
        latestUserRequest: latestUserRequestFromMessages(messages[id] || [])
      });
      const goal = workContext.kind === "goal" ? capabilitySafeActivity?.goal || null : null;
      const activityKind = safeString(capabilitySafeActivity?.kind).replace(/_/g, " ");
      return {
        id,
        session,
        agent,
        activity: capabilitySafeActivity,
        attention: needsAttention,
        working,
        state,
        goal,
        config,
        title: sidebarChatTitle(session, id, config, messages[id] || []),
        status: prompt ? safeString(prompt.title).trim() || "Action required" : safeString(activity?.label).trim() || (state === "idle" ? goal ? "Goal paused" : "Idle" : activityKind || (goal ? "Goal active" : "Working")),
        workContext,
        progress: fleetWorkContextProgress(workContext),
        snippet: fleetSessionSnippet(session, messages[id] || []),
        health: health[id] || "unknown",
        canReceiveBroadcast: sessionSupportsBroadcast(session, agentConfigs[id], health[id] || "unknown", connected),
        freshness: fleetFreshnessLabel(activity),
        activityLatencyMs: Number.isFinite(Number(activity?.transport?.latency_ms)) ? Math.round(Number(activity.transport.latency_ms)) : null
      };
    }).filter(Boolean).sort((left, right) => Number(right.attention) - Number(left.attention) || Number(right.working) - Number(left.working) || left.title.localeCompare(right.title)), [sessions, activities, thinking, permissionPrompts, errorPrompts, messages, agentConfigs, sessionAttention, health, connected, nowMs]);
    const entries = React.useMemo(() => allEntries.filter((entry) => showIdle || entry.state !== "idle" || entry.goal), [allEntries, showIdle]);
    const attentionCount = allEntries.filter((entry) => entry.state === "needs_attention").length;
    const workingCount = allEntries.filter((entry) => entry.working).length;
    const workingGoalCount = allEntries.filter((entry) => entry.state === "working_goal").length;
    const idleCount = allEntries.filter((entry) => entry.state === "idle").length;
    const entryById = React.useMemo(() => Object.fromEntries(entries.map((entry) => [entry.id, entry])), [entries]);
    const expectedConfirmation = `SEND TO ${selectedIds.length} SESSIONS`;
    React.useEffect(() => {
      if (selectedIds.length <= MAX_BROADCAST_SESSIONS && selectedIds.every((id) => entryById[id]?.canReceiveBroadcast)) return;
      setSelectedIds((previous) => reconcileFleetSelection(previous, entryById));
    }, [entryById, selectedIds]);
    React.useEffect(() => {
      if (Object.keys(broadcastReceipts).length === 0) return;
      setBroadcastReceipts((previous) => {
        let changed = false;
        const next = {};
        Object.entries(previous).forEach(([sessionId, receipt]) => {
          const lifecycle = deliveryStates[receipt.clientMessageId] || receipt.status;
          const status = ["offline_queued", "busy_queued", "steered"].includes(lifecycle) ? "queued" : lifecycle;
          const normalized = ["queued", "accepted", "launch_accepted", "delivered", "agent_started", "failed"].includes(status) ? status : receipt.status;
          next[sessionId] = normalized === receipt.status ? receipt : { ...receipt, status: normalized };
          if (next[sessionId] !== receipt) changed = true;
        });
        return changed ? next : previous;
      });
    }, [deliveryStates]);
    function toggleBroadcastSelection(sessionId) {
      setBroadcastError("");
      setSelectedIds((previous) => previous.includes(sessionId) ? previous.filter((id) => id !== sessionId) : previous.length < MAX_BROADCAST_SESSIONS ? [...previous, sessionId] : previous);
    }
    function submitBroadcast() {
      const normalized = normalizeBroadcastRequest({
        session_ids: selectedIds,
        content: broadcastPrompt,
        confirmation: broadcastConfirmation
      }, (sessionId) => !!entryById[sessionId]?.canReceiveBroadcast);
      if (!normalized.ok) {
        setBroadcastError(normalized.error);
        return;
      }
      const initial = createBroadcastReceiptState(normalized.sessionIds);
      const receipts = {};
      normalized.sessionIds.forEach((sessionId) => {
        const clientMessageId = onBroadcastSend(sessionId, normalized.content);
        receipts[sessionId] = {
          ...initial[sessionId],
          clientMessageId,
          title: entryById[sessionId]?.title || sessionId
        };
      });
      setBroadcastReceipts(receipts);
      setBroadcastPrompt("");
      setBroadcastConfirmation("");
      setBroadcastError("");
    }
    return /* @__PURE__ */ React.createElement("div", { className: "fleet-view", "data-testid": "fleet-view" }, /* @__PURE__ */ React.createElement("div", { className: "automations-header fleet-view-header" }, /* @__PURE__ */ React.createElement("button", { className: "automations-back", onClick: onBack, title: "Back to sessions" }, "\u2190"), /* @__PURE__ */ React.createElement("div", { className: "automations-header-text" }, /* @__PURE__ */ React.createElement("h2", null, "Fleet view"), /* @__PURE__ */ React.createElement("p", null, "Live monitoring across every active harness session."))), /* @__PURE__ */ React.createElement("div", { className: "fleet-summary", "aria-label": "Fleet summary" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, allEntries.length), /* @__PURE__ */ React.createElement("span", null, "sessions")), /* @__PURE__ */ React.createElement("div", { className: workingCount ? "working" : "" }, /* @__PURE__ */ React.createElement("strong", null, workingCount), /* @__PURE__ */ React.createElement("span", null, "working")), /* @__PURE__ */ React.createElement("div", { className: workingGoalCount ? "working-goal" : "" }, /* @__PURE__ */ React.createElement("strong", null, workingGoalCount), /* @__PURE__ */ React.createElement("span", null, "on goal")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, idleCount), /* @__PURE__ */ React.createElement("span", null, "idle")), /* @__PURE__ */ React.createElement("div", { className: attentionCount ? "attention" : "" }, /* @__PURE__ */ React.createElement("strong", null, attentionCount), /* @__PURE__ */ React.createElement("span", null, "need attention"))), /* @__PURE__ */ React.createElement("div", { className: "fleet-filter-row" }, /* @__PURE__ */ React.createElement("span", null, workingCount, " working now"), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setShowIdle((value) => !value), "aria-pressed": showIdle }, showIdle ? "Hide idle sessions" : `Show ${idleCount} idle session${idleCount === 1 ? "" : "s"}`)), /* @__PURE__ */ React.createElement("section", { className: "fleet-broadcast", "data-testid": "broadcast-send" }, /* @__PURE__ */ React.createElement("div", { className: "fleet-broadcast-heading" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, "Broadcast prompt"), /* @__PURE__ */ React.createElement("span", null, "Select up to ", MAX_BROADCAST_SESSIONS, " capable sessions.")), /* @__PURE__ */ React.createElement("span", null, selectedIds.length, " selected")), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        value: broadcastPrompt,
        onChange: (event) => setBroadcastPrompt(event.target.value),
        maxLength: MAX_BROADCAST_CONTENT_CHARS,
        placeholder: "Prompt every selected session...",
        "aria-label": "Broadcast prompt"
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "fleet-broadcast-confirm" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Type ", /* @__PURE__ */ React.createElement("strong", null, expectedConfirmation), " to confirm"), /* @__PURE__ */ React.createElement("input", { value: broadcastConfirmation, onChange: (event) => setBroadcastConfirmation(event.target.value), "aria-label": "Broadcast confirmation" })), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: submitBroadcast, disabled: !connected || selectedIds.length === 0 || !broadcastPrompt.trim() || broadcastConfirmation !== expectedConfirmation }, "Send to ", selectedIds.length || 0)), broadcastError && /* @__PURE__ */ React.createElement("div", { className: "fleet-broadcast-error", role: "alert" }, broadcastError), Object.keys(broadcastReceipts).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "fleet-broadcast-receipts", "aria-label": "Broadcast delivery receipts" }, Object.entries(broadcastReceipts).map(([sessionId, receipt]) => /* @__PURE__ */ React.createElement("span", { key: sessionId, className: `fleet-broadcast-receipt ${receipt.status}`, title: receipt.title }, /* @__PURE__ */ React.createElement("strong", null, receipt.title), /* @__PURE__ */ React.createElement("em", null, receipt.status.replace(/_/g, " ")))))), entries.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "fleet-empty" }, /* @__PURE__ */ React.createElement("strong", null, "Fleet is idle"), /* @__PURE__ */ React.createElement("span", null, idleCount, " connected session", idleCount === 1 ? " is" : "s are", " idle. Show idle sessions to inspect them.")) : /* @__PURE__ */ React.createElement("div", { className: "fleet-grid" }, entries.map((entry) => /* @__PURE__ */ React.createElement("div", { role: "button", tabIndex: 0, className: `fleet-card state-${entry.state}${entry.attention ? " attention" : ""}${selectedIds.includes(entry.id) ? " selected" : ""}`, key: entry.id, "data-session-id": entry.id, "data-activity-state": entry.state, "data-activity-lag-ms": entry.activityLatencyMs ?? "", onClick: () => onSelectSession(entry.id, entry.session), onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") onSelectSession(entry.id, entry.session);
    } }, /* @__PURE__ */ React.createElement("span", { className: "fleet-card-top" }, /* @__PURE__ */ React.createElement("span", { className: "agent-badge", style: { color: entry.agent.color, borderColor: entry.agent.color + "55", background: entry.agent.color + "18" } }, entry.agent.logo ? /* @__PURE__ */ React.createElement("img", { src: entry.agent.logo, alt: "", className: "agent-badge-logo" }) : entry.agent.abbr), /* @__PURE__ */ React.createElement("span", { className: "fleet-card-identity" }, /* @__PURE__ */ React.createElement("strong", null, entry.title), /* @__PURE__ */ React.createElement("span", null, entry.agent.name)), /* @__PURE__ */ React.createElement("span", { className: `fleet-health ${entry.health}`, title: entry.health }), /* @__PURE__ */ React.createElement("label", { className: `fleet-select${entry.canReceiveBroadcast ? "" : " unavailable"}`, onClick: (event) => event.stopPropagation() }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: selectedIds.includes(entry.id), disabled: !entry.canReceiveBroadcast, onChange: () => toggleBroadcastSelection(entry.id), "aria-label": `Select ${entry.title} for broadcast` }), /* @__PURE__ */ React.createElement("span", null, entry.canReceiveBroadcast ? "Select" : "Unavailable"))), /* @__PURE__ */ React.createElement("span", { className: "fleet-card-status" }, entry.working && /* @__PURE__ */ React.createElement(NativeActivitySpinner, { agentType: entry.session?.agent_type, compact: true, animate: false }), /* @__PURE__ */ React.createElement("span", { className: `fleet-state-badge ${entry.state}` }, fleetStateLabel(entry.state)), /* @__PURE__ */ React.createElement("strong", null, entry.status), entry.working && /* @__PURE__ */ React.createElement("time", null, fleetElapsed(entry.activity, nowMs))), /* @__PURE__ */ React.createElement("span", { className: "fleet-freshness", title: "Proxy-to-Fleet delivery time" }, "Activity ", entry.freshness), entry.session?.agent_type === "codex_cli" && entry.config?.config_semantics === "observed_and_next_send" && /* @__PURE__ */ React.createElement("span", { className: "fleet-freshness", title: "Native observation and pending next-send override" }, "Observed ", entry.config.observed_model_id || "unknown", " / ", entry.config.observed_effort || "unknown", " \xB7 ", "Next ", entry.config.next_send_model_id || "unset", " / ", entry.config.next_send_effort || "unset"), /* @__PURE__ */ React.createElement(
      "span",
      {
        className: `fleet-work-context kind-${entry.workContext.kind}`,
        "aria-label": `${entry.workContext.label}: ${entry.workContext.text}`,
        "data-work-context-kind": entry.workContext.kind,
        "data-work-context-source": entry.workContext.source
      },
      /* @__PURE__ */ React.createElement("strong", null, entry.workContext.label),
      /* @__PURE__ */ React.createElement("span", null, entry.workContext.text),
      Number.isInteger(entry.workContext.completed) && Number.isInteger(entry.workContext.total) ? /* @__PURE__ */ React.createElement("em", null, entry.workContext.completed, "/", entry.workContext.total) : null
    ), (entry.workContext.kind === "goal" || entry.progress != null) && /* @__PURE__ */ React.createElement(
      "span",
      {
        className: `fleet-work-meter kind-${entry.workContext.kind}${entry.progress == null && entry.working ? " indeterminate" : ""}${entry.working ? "" : " inactive"}`,
        "aria-label": entry.progress == null ? `${entry.workContext.label} ${fleetStateLabel(entry.state).toLowerCase()}` : Number.isInteger(entry.workContext.completed) && Number.isInteger(entry.workContext.total) ? `${entry.workContext.label} ${entry.workContext.completed} of ${entry.workContext.total} complete` : `${entry.workContext.label} ${Math.round(entry.progress)}% complete`
      },
      /* @__PURE__ */ React.createElement("span", { style: entry.progress == null ? void 0 : { width: `${entry.progress}%` } })
    ), /* @__PURE__ */ React.createElement("span", { className: "fleet-snippet" }, entry.snippet), /* @__PURE__ */ React.createElement("span", { className: "fleet-jump", "aria-label": "Open session" }, "Open session ", /* @__PURE__ */ React.createElement("span", { className: "fleet-jump-chevron", "aria-hidden": "true" }, "\u203A"))))));
  }
  function TranscriptSearchView({ onBack, onOpenResult }) {
    const [query, setQuery] = React.useState("");
    const [project, setProject] = React.useState("");
    const [harness, setHarness] = React.useState("");
    const [dateFrom, setDateFrom] = React.useState("");
    const [dateTo, setDateTo] = React.useState("");
    const [results, setResults] = React.useState([]);
    const [indexReady, setIndexReady] = React.useState(true);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState("");
    async function runSearch(event) {
      event?.preventDefault();
      if (query.trim().length < 2 || loading) return;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ q: query.trim(), limit: "50" });
        if (project.trim()) params.set("project", project.trim());
        if (harness.trim()) params.set("harness", harness.trim());
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);
        const response = await fetch(`/api/search/messages?${params.toString()}`, { credentials: "same-origin" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Transcript search failed.");
        setResults(Array.isArray(body.results) ? body.results : []);
        setIndexReady(body.index?.ready !== false);
      } catch (searchError) {
        setResults([]);
        setError(searchError?.message || "Transcript search failed.");
      } finally {
        setLoading(false);
      }
    }
    return /* @__PURE__ */ React.createElement("div", { className: "transcript-search-view", "data-testid": "transcript-search-view" }, /* @__PURE__ */ React.createElement("div", { className: "automations-header transcript-search-header" }, /* @__PURE__ */ React.createElement("button", { className: "skills-back", onClick: onBack, title: "Back to sessions" }, "\u2190"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", null, "Transcript search"), /* @__PURE__ */ React.createElement("p", null, "Search every relay-backed message."))), /* @__PURE__ */ React.createElement("form", { className: "transcript-search-form", onSubmit: runSearch }, /* @__PURE__ */ React.createElement("label", { className: "transcript-search-query" }, /* @__PURE__ */ React.createElement("span", null, "Search text"), /* @__PURE__ */ React.createElement("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Words from any conversation", maxLength: 200, autoFocus: true })), /* @__PURE__ */ React.createElement("div", { className: "transcript-search-filters" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Project"), /* @__PURE__ */ React.createElement("input", { value: project, onChange: (event) => setProject(event.target.value), placeholder: "Exact workspace or project", maxLength: 300 })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Harness"), /* @__PURE__ */ React.createElement("input", { value: harness, onChange: (event) => setHarness(event.target.value), placeholder: "e.g. codex_cli", maxLength: 80 })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "From"), /* @__PURE__ */ React.createElement("input", { type: "date", value: dateFrom, onChange: (event) => setDateFrom(event.target.value) })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "To"), /* @__PURE__ */ React.createElement("input", { type: "date", value: dateTo, onChange: (event) => setDateTo(event.target.value) }))), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "transcript-search-submit", disabled: query.trim().length < 2 || loading }, loading ? "Searching\u2026" : "Search transcripts")), !indexReady && /* @__PURE__ */ React.createElement("div", { className: "transcript-search-indexing" }, "Older history is still indexing; current results are partial."), error && /* @__PURE__ */ React.createElement("div", { className: "transcript-search-error", role: "alert" }, error), !loading && !error && results.length === 0 && query.trim().length >= 2 && /* @__PURE__ */ React.createElement("div", { className: "fleet-empty" }, /* @__PURE__ */ React.createElement("strong", null, "No matches"), /* @__PURE__ */ React.createElement("span", null, "Try fewer words or clear a filter.")), /* @__PURE__ */ React.createElement("div", { className: "transcript-search-results", "aria-live": "polite" }, results.map((result) => /* @__PURE__ */ React.createElement("button", { type: "button", className: "transcript-search-result", key: `${result.session_id}:${result.message_id}`, onClick: () => onOpenResult(result) }, /* @__PURE__ */ React.createElement("span", { className: "transcript-search-result-top" }, /* @__PURE__ */ React.createElement("strong", null, result.workspace_name || result.project_root || result.session_id), /* @__PURE__ */ React.createElement("em", null, result.agent_type || "unknown", " \xB7 ", result.role)), /* @__PURE__ */ React.createElement("span", { className: "transcript-search-snippet" }, result.snippet || "(empty message)"), /* @__PURE__ */ React.createElement("span", { className: "transcript-search-result-bottom" }, /* @__PURE__ */ React.createElement("time", null, result.matched_at ? new Date(result.matched_at).toLocaleString() : ""), /* @__PURE__ */ React.createElement("span", null, "Open match \u203A"))))));
  }
  function SkillsView({ skills, onRefresh, onBack }) {
    const installed = skills?.installed || [];
    const recommended = skills?.recommended || [];
    const loading = installed.length === 0 && recommended.length === 0;
    return /* @__PURE__ */ React.createElement("div", { className: "skills-view" }, /* @__PURE__ */ React.createElement("div", { className: "skills-header" }, /* @__PURE__ */ React.createElement("button", { className: "skills-back", onClick: onBack, title: "Back to sessions" }, "\u2190"), /* @__PURE__ */ React.createElement("div", { className: "skills-header-text" }, /* @__PURE__ */ React.createElement("h2", null, "Skills"), /* @__PURE__ */ React.createElement("p", { className: "skills-subtitle" }, "Give Codex superpowers.")), /* @__PURE__ */ React.createElement("button", { className: "skills-refresh-btn", onClick: onRefresh, title: "Refresh skills" }, "\u21BB")), loading ? /* @__PURE__ */ React.createElement("div", { className: "skills-loading" }, "Loading skills\u2026") : /* @__PURE__ */ React.createElement("div", { className: "skills-body" }, installed.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "skills-section" }, /* @__PURE__ */ React.createElement("h3", { className: "skills-section-title" }, "Installed"), /* @__PURE__ */ React.createElement("div", { className: "skills-card-list" }, installed.map((skill, i) => /* @__PURE__ */ React.createElement("div", { key: skill.id || i, className: "skills-card" }, /* @__PURE__ */ React.createElement("div", { className: "skills-card-icon" }, skill.icon ? /* @__PURE__ */ React.createElement("img", { src: skill.icon, alt: "", className: "skills-card-img" }) : /* @__PURE__ */ React.createElement("span", { className: "skills-card-placeholder" }, "\u2699")), /* @__PURE__ */ React.createElement("div", { className: "skills-card-body" }, /* @__PURE__ */ React.createElement("div", { className: "skills-card-name" }, skill.name), skill.description && /* @__PURE__ */ React.createElement("div", { className: "skills-card-desc" }, skill.description)), /* @__PURE__ */ React.createElement("div", { className: "skills-card-action installed" }, "\u2713"))))), recommended.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "skills-section" }, /* @__PURE__ */ React.createElement("h3", { className: "skills-section-title" }, "Recommended"), /* @__PURE__ */ React.createElement("div", { className: "skills-card-list" }, recommended.map((skill, i) => /* @__PURE__ */ React.createElement("div", { key: skill.id || i, className: "skills-card" }, /* @__PURE__ */ React.createElement("div", { className: "skills-card-icon" }, skill.icon ? /* @__PURE__ */ React.createElement("img", { src: skill.icon, alt: "", className: "skills-card-img" }) : /* @__PURE__ */ React.createElement("span", { className: "skills-card-placeholder" }, "\u2699")), /* @__PURE__ */ React.createElement("div", { className: "skills-card-body" }, /* @__PURE__ */ React.createElement("div", { className: "skills-card-name" }, skill.name), skill.description && /* @__PURE__ */ React.createElement("div", { className: "skills-card-desc" }, skill.description)), /* @__PURE__ */ React.createElement("div", { className: "skills-card-action available" }, "+")))))));
  }
  var AppErrorBoundary = class extends React.Component {
    constructor(props) {
      super(props);
      this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
      return { error };
    }
    componentDidCatch(error, info) {
      try {
        console.error("Agent Chat render crash", error, info);
        sessionStorage.setItem("agent-chat:last-render-error", JSON.stringify({
          message: error?.message || String(error),
          stack: error?.stack || "",
          componentStack: info?.componentStack || "",
          at: (/* @__PURE__ */ new Date()).toISOString()
        }));
      } catch {
      }
    }
    render() {
      if (!this.state.error) return this.props.children;
      return /* @__PURE__ */ React.createElement("div", { className: "app-crash" }, /* @__PURE__ */ React.createElement("div", { className: "app-crash-card" }, /* @__PURE__ */ React.createElement("div", { className: "app-crash-title" }, "Agent Chat hit a render error"), /* @__PURE__ */ React.createElement("div", { className: "app-crash-body" }, this.state.error?.message || "Unknown UI error"), /* @__PURE__ */ React.createElement("div", { className: "app-crash-actions" }, /* @__PURE__ */ React.createElement("button", { className: "app-crash-btn", onClick: () => location.reload() }, "Refresh"))));
    }
  };
  function App() {
    const { sessions, messages, provisionalStreams, historyMeta, historyLoading, connected, connectionHealth, unread, setUnread, thinking, thinkingContent, activities, health, deliveryStates, launchStates, justLaunched, setJustLaunched, permissionPrompts, respondToPrompt, errorPrompts, respondToErrorPrompt, interruptSession, agentConfigs, configControlStates, requestAgentConfig, setAgentModel, setAgentEffort, setAgentPermissionMode, setAutoApprovePermissions, setAntigravityMode, setCodexConfig, newThread, openPanel, openNativeWindow, requestChatList, switchChat, newChat, chatLists, requestThreadList, switchThread, threadLists, switchWorkspace, requestTerminalOutput, sendTerminalInput, terminalOutputs, requestFileChanges, respondToFileChange, fileChanges, sendAttachment, send, sendToSession, steerMessage, discardQueuedMessage, editQueuedMessage, queuedMessages, scheduledSends, scheduleSend, cancelScheduledSend, launchSession, resumeSession, closeSession, activeSessionRef, restoreCachedTranscript, setSessionSubscriptions, workspaces, branchLists, requestBranchList, switchBranch, createBranch, skillLists, requestSkillList, automationViews, showCodexAutomation, controlResults, directoryListings, requestDirectoryListing, fileContents, requestFileContent, requestHistory, requestHistoryChunk, duplicateProxyAlarms, nightlyValidationFailures, latestAppUpdateValidation, providerUsage, providerUsageRefreshReceipt, requestProviderUsageRefresh, providerUsageCostDetail, requestProviderUsageCostDetail, hostResources, hostResourceError, hostResourceHistory, hostResourceDetails, hostResourceSubscription, subscribeHostResources, unsubscribeHostResources, requestHostResourceRefresh, semanticNotifications } = useRelay();
    const [activeSession, setActiveSession] = useState3(null);
    const subscribeActiveTranscript = React.useCallback(
      (listener) => subscribeCachedTranscript(activeSession, listener),
      [activeSession]
    );
    const readActiveTranscript = React.useCallback(
      () => getTranscriptSnapshot(activeSession),
      [activeSession]
    );
    const activeTranscriptMessages = React.useSyncExternalStore(
      subscribeActiveTranscript,
      readActiveTranscript,
      readActiveTranscript
    );
    const [drafts, setDrafts] = useState3({});
    const [draftFiles, setDraftFiles] = useState3({});
    const [sidebarOpen, setSidebarOpen] = useState3(false);
    const [toast, setToast] = useState3("");
    const [attentionToast, setAttentionToast] = useState3(null);
    const [sessionAttention, setSessionAttention] = useState3({});
    const [attentionFeedbackPreferences, setAttentionFeedbackPreferences] = useState3(NOTIFICATION_PREFERENCE_PENDING);
    const [notificationPreferencesLoaded, setNotificationPreferencesLoaded] = useState3(false);
    const attentionToastTimerRef = useRef3(null);
    const previousPermissionPromptsRef = useRef3({});
    const promptSoundReadyRef = useRef3(false);
    const [uploading, setUploading] = useState3(false);
    const [showSlashMenu, setShowSlashMenu] = useState3(false);
    const [showNewSession, setShowNewSession] = useState3(false);
    const [showNotificationSettings, setShowNotificationSettings] = useState3(false);
    const [showSessionManagement, setShowSessionManagement] = useState3(false);
    const [showScheduledSend, setShowScheduledSend] = useState3(false);
    const [managedSessionId, setManagedSessionId] = useState3("");
    const [sessionPreferences, setSessionPreferences] = useState3({});
    const [sessionPreferencesLoaded, setSessionPreferencesLoaded] = useState3(false);
    const [openSidebarMenuId, setOpenSidebarMenuId] = useState3("");
    const [showSettings, setShowSettings] = useState3(false);
    const [showComposerSettings, setShowComposerSettings] = useState3(false);
    const [quickSwitcherOpen, setQuickSwitcherOpen] = useState3(false);
    const [quickSwitcherQuery, setQuickSwitcherQuery] = useState3("");
    const [quickSwitcherIndex, setQuickSwitcherIndex] = useState3(0);
    const [shortcutHelpOpen, setShortcutHelpOpen] = useState3(false);
    const [stopPending, setStopPending] = useState3({});
    const [interruptConfirmSession, setInterruptConfirmSession] = useState3(null);
    const interruptConfirmRef = useRef3({ sessionId: null, expiresAt: 0 });
    const interruptConfirmTimerRef = useRef3(null);
    const [showJumpButton, setShowJumpButton] = useState3(false);
    const [newMessagesBelow, setNewMessagesBelow] = useState3(0);
    const [showChatList, setShowChatList] = useState3(false);
    const [agv2NavigatorOpen, setAgv2NavigatorOpen] = useState3(true);
    const [optimisticV2ChatFocus, setOptimisticV2ChatFocus] = useState3({});
    const [showThreadList, setShowThreadList] = useState3(false);
    const [pendingDraftThreads, setPendingDraftThreads] = useState3({});
    const [optimisticThreadFocus, setOptimisticThreadFocus] = useState3({});
    const [draftMessageBaselines, setDraftMessageBaselines] = useState3({});
    const [showTerminal, setShowTerminal] = useState3(false);
    const [showDiffViewer, setShowDiffViewer] = useState3(false);
    const [showBranchSelector, setShowBranchSelector] = useState3(false);
    const [showAutomations, setShowAutomations] = useState3(false);
    const [showSkills, setShowSkills] = useState3(false);
    const [showUsageDashboard, setShowUsageDashboard] = useState3(false);
    const [showHostResourceDashboard, setShowHostResourceDashboard] = useState3(false);
    const [showFleetView, setShowFleetView] = useState3(false);
    const [showTranscriptSearch, setShowTranscriptSearch] = useState3(false);
    const [transcriptSearchTarget, setTranscriptSearchTarget] = useState3(null);
    const [showFileBrowser, setShowFileBrowser] = useState3(false);
    const [fileBrowserPath, setFileBrowserPath] = useState3(".");
    const [viewingFile, setViewingFile] = useState3(null);
    const [transcriptPreview, setTranscriptPreview] = useState3(null);
    const systemBannerRef = useRef3(null);
    const [systemBannerHeight, setSystemBannerHeight] = useState3(0);
    const quickSwitcherInputRef = useRef3(null);
    const [theme, setTheme] = useState3(() => {
      try {
        return localStorage.getItem("remote-agent-chat-theme") || "dark";
      } catch {
        return "dark";
      }
    });
    const [collapsedSessionGroups, setCollapsedSessionGroups] = useState3(() => {
      try {
        const stored = JSON.parse(localStorage.getItem("remote-agent-chat:collapsed-directories:v1") || "[]");
        return Array.isArray(stored) ? Object.fromEntries(stored.map((key) => [String(key), true])) : {};
      } catch {
        return {};
      }
    });
    const [showTestSessions, setShowTestSessions] = useState3(() => {
      try {
        return localStorage.getItem(SHOW_TEST_SESSIONS_STORAGE_KEY) === "1";
      } catch {
        return false;
      }
    });
    useEffect3(() => {
      try {
        localStorage.setItem(SHOW_TEST_SESSIONS_STORAGE_KEY, showTestSessions ? "1" : "0");
      } catch {
      }
    }, [showTestSessions]);
    const [sessionGroupAliases] = useState3(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(GROUP_ALIAS_STORAGE_KEY) || "{}");
        return normalizeGroupAliases(stored);
      } catch {
        return normalizeGroupAliases(DEFAULT_GROUP_ALIASES);
      }
    });
    useEffect3(() => {
      try {
        localStorage.setItem(GROUP_ALIAS_STORAGE_KEY, JSON.stringify(sessionGroupAliases));
      } catch {
      }
    }, [sessionGroupAliases]);
    useEffect3(() => {
      fetch("/api/preferences/sessions", { credentials: "same-origin" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("Session settings unavailable"))).then((body) => {
        setSessionPreferences(body.preferences || {});
        setSessionPreferencesLoaded(true);
      }).catch(() => {
      });
    }, []);
    useEffect3(() => {
      let mounted = true;
      fetch("/api/preferences/notifications", { credentials: "same-origin" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("Notification settings unavailable"))).then((body) => {
        if (mounted) {
          setAttentionFeedbackPreferences({
            ...NOTIFICATION_PREFERENCE_DEFAULTS,
            ...body.preferences || {},
            turn_ready: false
          });
          setNotificationPreferencesLoaded(true);
        }
      }).catch(() => {
      });
      return () => {
        mounted = false;
      };
    }, []);
    useEffect3(() => {
      if (!attentionFeedbackPreferences.completion_sound) return void 0;
      const prime = () => primeAttentionAudio();
      document.addEventListener("pointerdown", prime, { once: true });
      document.addEventListener("keydown", prime, { once: true });
      return () => {
        document.removeEventListener("pointerdown", prime);
        document.removeEventListener("keydown", prime);
      };
    }, [attentionFeedbackPreferences.completion_sound]);
    async function saveSessionPreference(sessionId, updates) {
      const response = await fetch(`/api/preferences/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preference: updates })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to save session settings.");
      setSessionPreferences((previous) => ({ ...previous, [sessionId]: body.preference }));
      if (body.preference?.archived && activeSession === sessionId) setActiveSession(null);
      return body.preference;
    }
    async function downloadSessionExport(sessionId, format) {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export?format=${encodeURIComponent(format)}`, {
        credentials: "same-origin"
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Unable to export session.");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      let filename = `session.${format === "json" ? "json" : "md"}`;
      if (encodedName) {
        try {
          filename = decodeURIComponent(encodedName);
        } catch {
        }
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    }
    useEffect3(() => {
      try {
        const collapsed = Object.keys(collapsedSessionGroups).filter((key) => collapsedSessionGroups[key]);
        localStorage.setItem("remote-agent-chat:collapsed-directories:v1", JSON.stringify(collapsed));
      } catch {
      }
    }, [collapsedSessionGroups]);
    const toggleSessionGroup = React.useCallback((key) => {
      setCollapsedSessionGroups((previous) => ({ ...previous, [key]: !previous[key] }));
    }, []);
    const steerMessageRef = useRef3(steerMessage);
    useEffect3(() => {
      steerMessageRef.current = steerMessage;
    }, [steerMessage]);
    const handleTranscriptSteer = React.useCallback((cid, content) => {
      if (!activeSession) return;
      steerMessageRef.current(activeSession, cid, content);
    }, [activeSession]);
    const sendToSessionRef = useRef3(sendToSession);
    useEffect3(() => {
      sendToSessionRef.current = sendToSession;
    }, [sendToSession]);
    const handleTranscriptRetry = React.useCallback((message) => {
      if (!activeSession || !message?._cid) return;
      sendToSessionRef.current(activeSession, message.content, message._cid);
    }, [activeSession]);
    const requestFileContentRef = useRef3(requestFileContent);
    useEffect3(() => {
      requestFileContentRef.current = requestFileContent;
    }, [requestFileContent]);
    const allManagedSessions = React.useMemo(() => [...sessions || []].map((session) => {
      const id = sessionIdOf3(session);
      const preference = sessionPreferences[id];
      if (!preference?.display_name) return session;
      return typeof session === "object" ? { ...session, custom_display_name: preference.display_name } : { session_id: id, custom_display_name: preference.display_name };
    }), [sessions, sessionPreferences]);
    const testSessionIds = React.useMemo(() => new Set(
      allManagedSessions.filter(sessionIsTestSession).map(sessionIdOf3)
    ), [allManagedSessions]);
    const operatorManagedSessions = React.useMemo(
      () => allManagedSessions.filter((session) => !sessionIsTestSession(session)),
      [allManagedSessions]
    );
    const sidebarManagedSessions = showTestSessions ? allManagedSessions : operatorManagedSessions;
    const orderedSessions = React.useMemo(
      () => sidebarManagedSessions.filter((session) => !sessionPreferences[sessionIdOf3(session)]?.archived),
      [sidebarManagedSessions, sessionPreferences]
    );
    const operatorOrderedSessions = React.useMemo(
      () => operatorManagedSessions.filter((session) => !sessionPreferences[sessionIdOf3(session)]?.archived),
      [operatorManagedSessions, sessionPreferences]
    );
    const sidebarNowMs = useSidebarFreshnessClock(activities, orderedSessions);
    const sidebarStateOptions = React.useMemo(() => ({
      activities,
      thinking,
      pendingPrompts: permissionPrompts,
      errorPrompts: Object.fromEntries(Object.entries(errorPrompts || {}).filter(([, prompt]) => isBlockingErrorPrompt(prompt))),
      health,
      connected,
      nowMs: sidebarNowMs,
      requireFreshness: true
    }), [activities, thinking, permissionPrompts, errorPrompts, health, connected, sidebarNowMs]);
    const {
      working: workingSessionCandidates,
      states: sidebarStateBySessionId
    } = React.useMemo(
      () => partitionSidebarSessionsByWorking(orderedSessions, sidebarStateOptions),
      [orderedSessions, sidebarStateOptions]
    );
    const sidebarListRef = useRef3(null);
    const pendingSidebarSortAnchorRef = useRef3(null);
    const sidebarInteractionTimerRef = useRef3(null);
    const [sidebarStructureLocked, setSidebarStructureLocked] = useState3(false);
    const beginSidebarInteraction = React.useCallback(() => {
      if (sidebarInteractionTimerRef.current) clearTimeout(sidebarInteractionTimerRef.current);
      sidebarInteractionTimerRef.current = null;
      setSidebarStructureLocked(true);
    }, []);
    const endSidebarInteraction = React.useCallback((delay = 0) => {
      if (sidebarInteractionTimerRef.current) clearTimeout(sidebarInteractionTimerRef.current);
      sidebarInteractionTimerRef.current = setTimeout(() => {
        sidebarInteractionTimerRef.current = null;
        setSidebarStructureLocked(false);
      }, delay);
    }, []);
    React.useEffect(() => {
      const releasePointer = () => endSidebarInteraction(80);
      window.addEventListener("pointerup", releasePointer, true);
      window.addEventListener("pointercancel", releasePointer, true);
      return () => {
        window.removeEventListener("pointerup", releasePointer, true);
        window.removeEventListener("pointercancel", releasePointer, true);
        if (sidebarInteractionTimerRef.current) clearTimeout(sidebarInteractionTimerRef.current);
      };
    }, [endSidebarInteraction]);
    const {
      sessions: workingSessions,
      revision: workingOrderRevision
    } = useStableWorkingSessions(workingSessionCandidates, sidebarStructureLocked);
    const workingSessionIds = React.useMemo(
      () => new Set(workingSessions.map(sessionIdOf3)),
      [workingSessions]
    );
    const { pinned: allPinnedSessions, unpinned: allUnpinnedSessions } = React.useMemo(
      () => partitionPinnedSessions(orderedSessions, sessionPreferences),
      [orderedSessions, sessionPreferences]
    );
    const pinnedSessions = React.useMemo(
      () => allPinnedSessions.filter((session) => !workingSessionIds.has(sessionIdOf3(session))),
      [allPinnedSessions, workingSessionIds]
    );
    const rawSessionGroups = React.useMemo(
      () => groupSessionsByDirectory(allUnpinnedSessions, agentConfigs, sessionGroupAliases),
      [allUnpinnedSessions, agentConfigs, sessionGroupAliases]
    );
    const workspaceLabelBySessionId = React.useMemo(() => Object.fromEntries(
      groupSessionsByDirectory(orderedSessions, agentConfigs, sessionGroupAliases).flatMap((group) => group.sessions.map((session) => [sessionIdOf3(session), group.label]))
    ), [orderedSessions, agentConfigs, sessionGroupAliases]);
    const sidebarRankOptions = React.useMemo(() => ({
      ...sidebarStateOptions,
      messages,
      rankWorking: false
    }), [sidebarStateOptions, messages]);
    const {
      groups: stableSessionGroups,
      orderChanged: sidebarOrderChanged,
      sortNow: sortSidebarNow,
      revision: sidebarOrderRevision
    } = useStableSidebarGroups(rawSessionGroups, sidebarRankOptions, sidebarStructureLocked);
    const sessionGroups = React.useMemo(() => stableSessionGroups.map((group) => ({
      ...group,
      sessions: group.sessions.filter((session) => !workingSessionIds.has(sessionIdOf3(session)))
    })).filter((group) => group.sessions.length > 0), [stableSessionGroups, workingSessionIds]);
    const applySidebarSortNow = React.useCallback(() => {
      const list = sidebarListRef.current;
      const selectedCard = activeSession ? list?.querySelector(`[data-session-id="${CSS.escape(activeSession)}"]`) : null;
      pendingSidebarSortAnchorRef.current = selectedCard ? {
        sessionId: activeSession,
        top: selectedCard.getBoundingClientRect().top
      } : null;
      sortSidebarNow();
    }, [activeSession, sortSidebarNow]);
    const sidebarDisplaySessions = React.useMemo(
      () => [...workingSessions, ...pinnedSessions, ...sessionGroups.flatMap((group) => group.sessions)],
      [workingSessions, pinnedSessions, sessionGroups]
    );
    const summarizeSidebarSessions = React.useCallback((sessionList) => sessionList.reduce((result, session) => {
      const id = sessionIdOf3(session);
      result.unread += testSessionIds.has(id) ? 0 : unread[id] || 0;
      result.hasPrompt = result.hasPrompt || !!permissionPrompts[id] || !!isBlockingErrorPrompt(errorPrompts[id]);
      result.working = result.working || fleetStateIsWorking(sidebarStateBySessionId[id]);
      return result;
    }, { unread: 0, hasPrompt: false, working: false }), [
      testSessionIds,
      unread,
      permissionPrompts,
      errorPrompts,
      sidebarStateBySessionId
    ]);
    const workingSessionSummary = React.useMemo(
      () => summarizeSidebarSessions(workingSessions),
      [summarizeSidebarSessions, workingSessions]
    );
    const pinnedSessionSummary = React.useMemo(
      () => summarizeSidebarSessions(pinnedSessions),
      [summarizeSidebarSessions, pinnedSessions]
    );
    const quickSwitcherItems = React.useMemo(() => sidebarDisplaySessions.map((session) => {
      const id = sessionIdOf3(session);
      const agent = sessionAgent(session, agentConfigs[id]);
      const title = sidebarChatTitle(session, id, agentConfigs[id], messages[id] || []);
      const subtitle = sessionSubLabel(session, id, agentConfigs[id]);
      const groupLabel = workspaceLabelBySessionId[id] || "Unscoped";
      const searchFields = [
        title,
        subtitle,
        groupLabel,
        sessionPreferences[id]?.pinned ? "Pinned" : "",
        agent.name,
        session?.agent_type,
        session?.workspace_name,
        session?.workspace_path,
        id
      ].filter(Boolean);
      return {
        id,
        session,
        groupLabel,
        title,
        subtitle,
        agentName: agent.name,
        agentColor: agent.color,
        working: fleetStateIsWorking(sidebarStateBySessionId[id]),
        searchFields,
        searchText: searchFields.join(" ")
      };
    }), [sidebarDisplaySessions, workspaceLabelBySessionId, sessionPreferences, agentConfigs, messages, sidebarStateBySessionId]);
    const quickSwitcherResults = React.useMemo(
      () => rankQuickSwitcherItems(quickSwitcherItems, quickSwitcherQuery).slice(0, 60),
      [quickSwitcherItems, quickSwitcherQuery]
    );
    useEffect3(() => {
      setQuickSwitcherIndex((index) => Math.max(0, Math.min(index, quickSwitcherResults.length - 1)));
    }, [quickSwitcherResults.length]);
    useEffect3(() => {
      if (!quickSwitcherOpen) return void 0;
      const frame = requestAnimationFrame(() => {
        quickSwitcherInputRef.current?.focus();
        quickSwitcherInputRef.current?.select();
      });
      return () => cancelAnimationFrame(frame);
    }, [quickSwitcherOpen]);
    useEffect3(() => {
      if (!quickSwitcherOpen) return;
      document.getElementById(`quick-switcher-option-${quickSwitcherIndex}`)?.scrollIntoView({ block: "nearest" });
    }, [quickSwitcherIndex, quickSwitcherOpen]);
    useEffect3(() => {
      const closeQuickSwitcher = () => {
        setQuickSwitcherOpen(false);
        setQuickSwitcherQuery("");
        setQuickSwitcherIndex(0);
        requestAnimationFrame(() => textareaRef.current?.focus());
      };
      const chooseItem = (item) => {
        if (!item) return;
        selectSession(item.id, item.session);
        setSidebarOpen(false);
        closeQuickSwitcher();
      };
      const onGlobalShortcut = (event) => {
        const key = safeString(event.key).toLowerCase();
        if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "p") {
          event.preventDefault();
          setShortcutHelpOpen(false);
          setQuickSwitcherOpen(true);
          return;
        }
        if (quickSwitcherOpen) {
          if (event.key === "Escape") {
            event.preventDefault();
            closeQuickSwitcher();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setQuickSwitcherIndex((index) => quickSwitcherResults.length ? (index + 1) % quickSwitcherResults.length : 0);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setQuickSwitcherIndex((index) => quickSwitcherResults.length ? (index - 1 + quickSwitcherResults.length) % quickSwitcherResults.length : 0);
          } else if (event.key === "Enter" && quickSwitcherResults.length > 0) {
            event.preventDefault();
            chooseItem(quickSwitcherResults[quickSwitcherIndex] || quickSwitcherResults[0]);
          }
          return;
        }
        if (shortcutHelpOpen) {
          if (event.key === "Escape" || event.key === "?" && !isEditableShortcutTarget(event.target)) {
            event.preventDefault();
            setShortcutHelpOpen(false);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }
          return;
        }
        if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          if (quickSwitcherItems.length === 0) return;
          event.preventDefault();
          const currentIndex = quickSwitcherItems.findIndex((item) => item.id === activeSession);
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const fallback = direction > 0 ? -1 : 0;
          const nextIndex = (Math.max(currentIndex, fallback) + direction + quickSwitcherItems.length) % quickSwitcherItems.length;
          chooseItem(quickSwitcherItems[nextIndex]);
          return;
        }
        if (event.key === "?" && !event.altKey && !event.ctrlKey && !event.metaKey && !isEditableShortcutTarget(event.target)) {
          event.preventDefault();
          setShortcutHelpOpen(true);
        }
      };
      window.addEventListener("keydown", onGlobalShortcut);
      return () => window.removeEventListener("keydown", onGlobalShortcut);
    }, [activeSession, quickSwitcherIndex, quickSwitcherItems, quickSwitcherOpen, quickSwitcherResults, shortcutHelpOpen]);
    const sidebarAnchorRef = useRef3(null);
    useLayoutEffect2(() => {
      const list = sidebarListRef.current;
      if (!list) {
        sidebarAnchorRef.current = null;
        return;
      }
      const explicitSortAnchor = pendingSidebarSortAnchorRef.current;
      let restoredExplicitSort = false;
      if (explicitSortAnchor?.sessionId) {
        const card = Array.from(list.querySelectorAll("[data-session-id]")).find((node) => node.dataset.sessionId === explicitSortAnchor.sessionId);
        if (card) {
          const delta = card.getBoundingClientRect().top - explicitSortAnchor.top;
          if (Math.abs(delta) > 0.5) list.scrollTop += delta;
          restoredExplicitSort = true;
        }
        pendingSidebarSortAnchorRef.current = null;
      }
      const restorePreviousAnchor = () => {
        const previous = sidebarAnchorRef.current;
        if (!previous?.sessionId) return;
        const card = Array.from(list.querySelectorAll("[data-session-id]")).find((node) => node.dataset.sessionId === previous.sessionId);
        if (!card) return;
        const delta = card.getBoundingClientRect().top - previous.top;
        if (Math.abs(delta) > 0.5) list.scrollTop += delta;
        if (previous.menuOpen) {
          const menu = card.querySelector("details.session-card-menu");
          if (menu) menu.open = true;
        }
        if (previous.focusTitle && !list.contains(document.activeElement)) {
          const focusTarget = Array.from(card.querySelectorAll("button, [tabindex]")).find((node) => node.getAttribute("title") === previous.focusTitle);
          focusTarget?.focus({ preventScroll: true });
        }
      };
      const captureAnchor = () => {
        const listRect = list.getBoundingClientRect();
        const cards = Array.from(list.querySelectorAll("[data-session-id]"));
        const focusedCard = document.activeElement?.closest?.("[data-session-id]");
        const visibleCard = cards.find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.bottom > listRect.top && rect.top < listRect.bottom;
        });
        const card = focusedCard || visibleCard || cards[0];
        if (!card) return null;
        return {
          sessionId: card.dataset.sessionId,
          top: card.getBoundingClientRect().top,
          focusTitle: focusedCard ? document.activeElement?.getAttribute?.("title") || null : null,
          menuOpen: !!card.querySelector("details.session-card-menu[open]")
        };
      };
      if (!restoredExplicitSort) restorePreviousAnchor();
      sidebarAnchorRef.current = captureAnchor();
      return () => {
        sidebarAnchorRef.current = captureAnchor();
      };
    }, [activeSession, workingOrderRevision, sidebarOrderRevision]);
    const activeSessionMeta = React.useMemo(
      () => orderedSessions.find((s) => sessionIdOf3(s) === activeSession),
      [orderedSessions, activeSession]
    );
    const activeUsageSnapshot = React.useMemo(
      () => usageSnapshotForSession(activeSessionMeta, activeSession ? activities[activeSession] : null),
      [activeSessionMeta, activeSession, activities]
    );
    const activeMessagesForScroll = activeSession ? activeTranscriptMessages : EMPTY_MESSAGES;
    const activeProvisionalStream = activeSession ? provisionalStreams[activeSession] || null : null;
    const activeNativeCliPlaceholder = shouldRefreshNativeCliPlaceholder(activeSessionMeta, activeMessagesForScroll);
    const activeActivityForScroll = activeSession ? activities[activeSession] : null;
    const activeThinkingForScroll = activeSession ? thinkingContent[activeSession] || "" : "";
    const activePermissionPromptForScroll = activeSession ? permissionPrompts[activeSession] || null : null;
    const activeErrorPromptForScroll = activeSession ? errorPrompts[activeSession] || null : null;
    const activeLiveScrollVersion = React.useMemo(() => {
      const activity = activeActivityForScroll && typeof activeActivityForScroll === "object" ? activeActivityForScroll : null;
      const goal = activity?.goal || null;
      const tasks = Array.isArray(activity?.task_list?.tasks) ? activity.task_list.tasks.map((task) => `${task.state || ""}:${task.text || task.title || task.label || ""}`).join("|") : "";
      return [
        activeThinkingForScroll,
        activity?.kind || "",
        activity?.label || "",
        activity?.updatedAt || "",
        activity?.startedAt || "",
        activity?.interruptHint || "",
        activity?.thinkingContent || "",
        goal?.status || "",
        goal?.label || "",
        goal?.objective || "",
        goal?.time_used_seconds ?? goal?.timeUsedSeconds ?? "",
        goal?.updated_at || "",
        tasks,
        activePermissionPromptForScroll?.id || activePermissionPromptForScroll?.request_id || "",
        activeErrorPromptForScroll?.id || activeErrorPromptForScroll?.request_id || "",
        activeProvisionalStream?.messageId || "",
        activeProvisionalStream?.content?.length || 0,
        activeProvisionalStream?.open ? "open" : "closed"
      ].join("");
    }, [
      activeActivityForScroll,
      activeThinkingForScroll,
      activePermissionPromptForScroll,
      activeErrorPromptForScroll,
      activeProvisionalStream
    ]);
    const activeTranscriptArrival = {
      sessionId: activeSession,
      messageCount: activeMessagesForScroll.length,
      provisionalId: activeProvisionalStream?.messageId || "",
      provisionalLength: activeProvisionalStream?.content?.length || 0
    };
    const messagesEndRef = useRef3(null);
    const messagesListRef = useRef3(null);
    const isAtBottom = useRef3(true);
    const stickyToNewestRef = useRef3(true);
    const userScrollIntentUntilRef = useRef3(0);
    const programmaticScrollUntilRef = useRef3(0);
    const scrollPinGenerationRef = useRef3(0);
    const pinnedToNewestUntilRef = useRef3(0);
    const requestOlderHistoryRef = useRef3(null);
    const nonWindowedPrependAnchorRef = useRef3(null);
    const selectedSessionRef = useRef3(activeSession);
    const scrollSnapshotRef = useRef3({
      sessionId: null,
      keys: [],
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      atBottom: true
    });
    const routeScrollSnapshotRef = useRef3(null);
    const routeScrollRestoreFrameRef = useRef3(0);
    const textareaRef = useRef3(null);
    const fileInputRef = useRef3(null);
    const transcriptArrivalRef = useRef3(activeTranscriptArrival);
    const jumpBaselineRef = useRef3(activeTranscriptArrival);
    const sendHistoryRef = useRef3({});
    const sendHistoryCursorRef = useRef3({ sessionId: null, index: 0, scratch: "" });
    const prevConnected = useRef3(connected);
    const pendingAttachmentReqs = useRef3({});
    const seenAttachmentResults = useRef3({});
    transcriptArrivalRef.current = activeTranscriptArrival;
    useLayoutEffect2(() => {
      selectedSessionRef.current = activeSession;
    }, [activeSession]);
    useEffect3(() => {
      const onError = (event) => {
        try {
          sessionStorage.setItem("agent-chat:last-window-error", JSON.stringify({
            message: event?.error?.message || event?.message || "Unknown window error",
            stack: event?.error?.stack || "",
            at: (/* @__PURE__ */ new Date()).toISOString()
          }));
        } catch {
        }
      };
      const onRejection = (event) => {
        try {
          const reason = event?.reason;
          sessionStorage.setItem("agent-chat:last-promise-error", JSON.stringify({
            message: reason?.message || safeString(reason, "Unhandled promise rejection"),
            stack: reason?.stack || "",
            at: (/* @__PURE__ */ new Date()).toISOString()
          }));
        } catch {
        }
      };
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
      return () => {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
      };
    }, []);
    useEffect3(() => {
      try {
        const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (saved) setDrafts(JSON.parse(saved));
      } catch {
      }
    }, []);
    useEffect3(() => {
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
      } catch {
      }
    }, [drafts]);
    useEffect3(() => {
      try {
        localStorage.setItem("remote-agent-chat-theme", theme);
      } catch {
      }
      document.documentElement.setAttribute("data-theme", theme);
    }, [theme]);
    useEffect3(() => {
      if (!activeSession && orderedSessions.length > 0) {
        const requestedId = new URLSearchParams(window.location.search).get("session");
        const requested = requestedId ? orderedSessions.find((session) => sessionIdOf3(session) === requestedId) : null;
        const selected = requested || orderedSessions[0];
        const id = sessionIdOf3(selected);
        if (id) {
          selectSession(id, selected);
          if (requested) window.history.replaceState({}, "", window.location.pathname);
        }
      }
    }, [orderedSessions, activeSession]);
    useEffect3(() => {
      if (!("serviceWorker" in navigator)) return void 0;
      const handlePushClick = (event) => {
        if (event.data?.type !== "push_notification_clicked") return;
        const requestedId = event.data.data?.session_id;
        const requested = orderedSessions.find((session) => sessionIdOf3(session) === requestedId);
        if (requestedId && requested) selectSession(requestedId, requested);
      };
      navigator.serviceWorker.addEventListener("message", handlePushClick);
      return () => navigator.serviceWorker.removeEventListener("message", handlePushClick);
    }, [orderedSessions]);
    useEffect3(() => {
      if (!justLaunched) return;
      const found = orderedSessions.find((s) => (typeof s === "string" ? s : s?.session_id) === justLaunched);
      if (found) {
        selectSession(justLaunched, found);
        setJustLaunched(null);
      }
    }, [justLaunched, orderedSessions]);
    useEffect3(() => {
      const list = messagesListRef.current;
      if (!list) return;
      let touchStartY = null;
      const markUserScrollAwayIntent = () => {
        userScrollIntentUntilRef.current = Date.now() + 1200;
        programmaticScrollUntilRef.current = 0;
        scrollPinGenerationRef.current += 1;
        if (stickyToNewestRef.current) {
          jumpBaselineRef.current = transcriptArrivalRef.current;
          setNewMessagesBelow(0);
        }
      };
      const onWheel = (event) => {
        if (event.deltaY < -1) markUserScrollAwayIntent();
      };
      const onPointerDown = (event) => {
        const rect = list.getBoundingClientRect();
        if (event.clientX >= rect.right - 16) markUserScrollAwayIntent();
      };
      const onTouchStart = (event) => {
        touchStartY = event.touches?.[0]?.clientY ?? null;
      };
      const onTouchMove = (event) => {
        const y = event.touches?.[0]?.clientY ?? null;
        if (touchStartY != null && y != null && y - touchStartY > 4) markUserScrollAwayIntent();
      };
      const onKeyDown2 = (event) => {
        if (["ArrowUp", "PageUp", "Home"].includes(event.key)) markUserScrollAwayIntent();
      };
      const onScroll = () => {
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        const now = Date.now();
        const userInitiated = now < userScrollIntentUntilRef.current;
        const programmatic = now < programmaticScrollUntilRef.current;
        isAtBottom.current = atBottom;
        if (atBottom) {
          stickyToNewestRef.current = true;
        } else if (userInitiated && !programmatic) {
          stickyToNewestRef.current = false;
          pinnedToNewestUntilRef.current = 0;
        }
        if (userInitiated && !programmatic && list.scrollTop < 160) {
          requestOlderHistoryRef.current?.();
        }
        setShowJumpButton(!atBottom && !stickyToNewestRef.current);
        scrollSnapshotRef.current = {
          ...scrollSnapshotRef.current,
          scrollTop: list.scrollTop,
          scrollHeight: list.scrollHeight,
          clientHeight: list.clientHeight,
          atBottom: atBottom || stickyToNewestRef.current
        };
      };
      list.addEventListener("scroll", onScroll, { passive: true });
      list.addEventListener("wheel", onWheel, { passive: true });
      list.addEventListener("touchstart", onTouchStart, { passive: true });
      list.addEventListener("touchmove", onTouchMove, { passive: true });
      list.addEventListener("pointerdown", onPointerDown, { passive: true });
      window.addEventListener("keydown", onKeyDown2);
      return () => {
        list.removeEventListener("scroll", onScroll);
        list.removeEventListener("wheel", onWheel);
        list.removeEventListener("touchstart", onTouchStart);
        list.removeEventListener("touchmove", onTouchMove);
        list.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("keydown", onKeyDown2);
      };
    }, [activeSession]);
    function stickTranscriptToNewest(keys, frameCount = 2) {
      const sessionAtStart = activeSession;
      const pinGeneration = scrollPinGenerationRef.current + 1;
      scrollPinGenerationRef.current = pinGeneration;
      const apply = () => {
        const list = messagesListRef.current;
        if (!list || selectedSessionRef.current !== sessionAtStart || scrollPinGenerationRef.current !== pinGeneration) return false;
        programmaticScrollUntilRef.current = Date.now() + 800;
        stickyToNewestRef.current = true;
        jumpBaselineRef.current = transcriptArrivalRef.current;
        setScrollTopInstant(list, list.scrollHeight);
        isAtBottom.current = true;
        setShowJumpButton(false);
        setNewMessagesBelow(0);
        scrollSnapshotRef.current = {
          sessionId: sessionAtStart,
          keys,
          scrollTop: list.scrollTop,
          scrollHeight: list.scrollHeight,
          clientHeight: list.clientHeight,
          atBottom: true
        };
        return true;
      };
      apply();
      let remaining = Math.max(0, frameCount);
      const tick = () => {
        if (remaining <= 0) return;
        remaining -= 1;
        if (apply()) requestAnimationFrame(tick);
      };
      if (remaining > 0) requestAnimationFrame(tick);
    }
    function pinTranscriptToNewest() {
      const list = messagesListRef.current;
      if (!list) return;
      const keys = scrollIdentityKeysForMessages(activeMessagesForScroll);
      pinnedToNewestUntilRef.current = Date.now() + 5e3;
      stickTranscriptToNewest(keys, 4);
    }
    useLayoutEffect2(() => {
      const list = messagesListRef.current;
      if (!list) return;
      const keys = scrollIdentityKeysForMessages(activeMessagesForScroll);
      const prev = scrollSnapshotRef.current || {};
      const sameSession = prev.sessionId === activeSession;
      const prevKeys = Array.isArray(prev.keys) ? prev.keys : [];
      const prevFirst = prevKeys[0] || null;
      const prevLast = prevKeys[prevKeys.length - 1] || null;
      const prevFirstIndex = prevFirst ? keys.indexOf(prevFirst) : -1;
      const prevLastIndex = prevLast ? keys.indexOf(prevLast) : -1;
      const sameRenderedKeys = !!(sameSession && keys.length === prevKeys.length && keys.every((key, index) => key === prevKeys[index]));
      const previousBottomGap = (Number(prev.scrollHeight) || 0) - (Number(prev.scrollTop) || 0) - (Number(prev.clientHeight) || 0);
      const forcePinnedToNewest = Date.now() < pinnedToNewestUntilRef.current;
      const wasAtBottom = forcePinnedToNewest || stickyToNewestRef.current || prev.atBottom !== false || previousBottomGap < 120;
      const olderPrepended = !!(sameSession && prevKeys.length && prevFirstIndex > 0 && prevLastIndex >= prevFirstIndex);
      if (sameRenderedKeys && !forcePinnedToNewest && !wasAtBottom) {
      } else if (!sameSession) {
        setTranscriptPreview(null);
        stickTranscriptToNewest(keys, 3);
      } else if (olderPrepended) {
        stickyToNewestRef.current = false;
        pinnedToNewestUntilRef.current = 0;
        if (list.dataset.transcriptWindowed !== "true") {
          const heightDelta = list.scrollHeight - (Number(prev.scrollHeight) || 0);
          programmaticScrollUntilRef.current = Date.now() + 500;
          setScrollTopInstant(list, Math.max(0, (Number(prev.scrollTop) || 0) + heightDelta));
          const anchor = nonWindowedPrependAnchorRef.current;
          const anchorRow = anchor ? Array.from(list.querySelectorAll(".message[data-message-key]")).find((row) => row.dataset.messageKey === anchor.messageKey) : null;
          if (anchorRow) {
            const currentOffset = anchorRow.getBoundingClientRect().top - list.getBoundingClientRect().top;
            const correction = currentOffset - anchor.viewportOffset;
            if (Math.abs(correction) >= 0.5) {
              setScrollTopInstant(list, Math.max(0, list.scrollTop + correction));
            }
          }
          nonWindowedPrependAnchorRef.current = null;
        }
      } else if (wasAtBottom) {
        stickTranscriptToNewest(keys, 3);
      }
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      isAtBottom.current = atBottom;
      setShowJumpButton(!atBottom && !stickyToNewestRef.current);
      setNewMessagesBelow(atBottom || stickyToNewestRef.current ? 0 : countTranscriptArrivalsSince(jumpBaselineRef.current, activeTranscriptArrival));
      scrollSnapshotRef.current = {
        sessionId: activeSession,
        keys,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        atBottom: atBottom || stickyToNewestRef.current
      };
    }, [activeSession, activeMessagesForScroll, activeLiveScrollVersion]);
    useEffect3(() => {
      if (activeSession) requestAgentConfig(activeSession);
    }, [activeSession]);
    useEffect3(() => {
      setStopPending((prev) => {
        const keys = Object.keys(prev).filter((sid) => !thinking[sid]);
        if (keys.length === 0) return prev;
        const next = { ...prev };
        keys.forEach((sid) => delete next[sid]);
        return next;
      });
    }, [thinking]);
    useEffect3(() => {
      if (!prevConnected.current && connected) showToast("Reconnected");
      if (prevConnected.current && !connected) showToast("Disconnected \u2014 reconnecting...");
      prevConnected.current = connected;
    }, [connected]);
    function showToast(msg) {
      setToast(msg);
      setTimeout(() => setToast(""), 3e3);
    }
    function attentionSessionLabel(sessionId) {
      const session = orderedSessions.find((item) => sessionIdOf3(item) === sessionId);
      return session ? sidebarChatTitle(session, sessionId, agentConfigs[sessionId], messages[sessionId] || []) : sessionId;
    }
    function showAttentionToast(sessionId, kind, title, detail = "") {
      if (attentionToastTimerRef.current) clearTimeout(attentionToastTimerRef.current);
      setAttentionToast({
        sessionId,
        kind,
        title,
        detail: detail || attentionSessionLabel(sessionId)
      });
      attentionToastTimerRef.current = setTimeout(() => {
        attentionToastTimerRef.current = null;
        setAttentionToast(null);
      }, 8e3);
    }
    function clearAttentionToast() {
      if (attentionToastTimerRef.current) clearTimeout(attentionToastTimerRef.current);
      attentionToastTimerRef.current = null;
      setAttentionToast(null);
    }
    useEffect3(() => () => {
      if (attentionToastTimerRef.current) clearTimeout(attentionToastTimerRef.current);
    }, []);
    useEffect3(() => {
      const previous = previousPermissionPromptsRef.current;
      const current = permissionPrompts || {};
      const resolvedSessionIds = Object.keys(previous).filter((sessionId) => !current[sessionId]);
      if (resolvedSessionIds.length > 0) {
        setSessionAttention((existing) => {
          const next = { ...existing };
          resolvedSessionIds.forEach((sessionId) => {
            if (next[sessionId]?.kind === "prompt") delete next[sessionId];
          });
          return next;
        });
        setAttentionToast((existing) => existing?.kind === "prompt" && resolvedSessionIds.includes(existing.sessionId) ? null : existing);
      }
      Object.entries(current).forEach(([sessionId, prompt]) => {
        const promptId = prompt?.prompt_id || prompt?.request_id || prompt?.id || "prompt";
        const previousPrompt = previous[sessionId];
        const previousPromptId = previousPrompt?.prompt_id || previousPrompt?.request_id || previousPrompt?.id || null;
        if (promptId === previousPromptId) return;
        if (promptSoundReadyRef.current && attentionFeedbackPreferences.completion_sound && attentionEventIsUnfocused(sessionId, activeSession)) {
          playAttentionSound("prompt");
        }
        if (sessionId === activeSession) return;
        const title = prompt?.kind === "question" ? "Question needs an answer" : "Permission needs attention";
        setSessionAttention((existing) => ({
          ...existing,
          [sessionId]: { kind: "prompt", promptId }
        }));
        showAttentionToast(sessionId, "prompt", title);
      });
      previousPermissionPromptsRef.current = current;
      promptSoundReadyRef.current = true;
    }, [permissionPrompts, activeSession, attentionFeedbackPreferences.completion_sound]);
    useEffect3(() => {
      if (!notificationPreferencesLoaded || !sessionPreferencesLoaded) return void 0;
      let cancelled = false;
      async function processSemanticNotifications() {
        for (const event of semanticNotifications || []) {
          const sessionId = event.session_id || event.session;
          if (!semanticNotificationAllowed(event, attentionFeedbackPreferences)) {
            recordSemanticNotificationStage(event, "suppressed", { reasonCode: "client_preference" });
            continue;
          }
          if (sessionPreferences[sessionId]?.muted) {
            recordSemanticNotificationStage(event, "suppressed", { reasonCode: "session_muted" });
            continue;
          }
          if (!attentionEventIsUnfocused(sessionId, activeSession)) {
            recordSemanticNotificationStage(event, "suppressed", { reasonCode: "focused_session" });
            continue;
          }
          const claimed = await claimSemanticNotification(event);
          if (cancelled) continue;
          if (!claimed) {
            recordSemanticNotificationStage(event, "suppressed", { reasonCode: "client_duplicate" });
            continue;
          }
          recordSemanticNotificationStage(event, "claimed");
          const kind = event.event_type;
          if (attentionFeedbackPreferences.completion_sound) {
            playAttentionSound(kind === "goal_attention" ? "prompt" : "completion");
          }
          if (sessionId !== activeSession) {
            setSessionAttention((existing) => ({
              ...existing,
              [sessionId]: {
                kind,
                dedupeKey: event.dedupe_key,
                createdAt: event.created_at || (/* @__PURE__ */ new Date()).toISOString()
              }
            }));
          }
          showAttentionToast(sessionId, kind, event.title, event.body);
          const afterPaint = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
          afterPaint(() => {
            if (!cancelled) recordSemanticNotificationStage(event, "displayed");
          });
        }
      }
      processSemanticNotifications().catch(() => {
      });
      return () => {
        cancelled = true;
      };
    }, [
      semanticNotifications,
      activeSession,
      sessionPreferences,
      attentionFeedbackPreferences,
      notificationPreferencesLoaded,
      sessionPreferencesLoaded
    ]);
    function setDraftForSession(sessionId, value) {
      if (!sessionId) return;
      setDrafts((prev) => ({ ...prev, [sessionId]: value }));
    }
    function setDraftFileForSession(sessionId, file) {
      if (!sessionId) return;
      setDraftFiles((prev) => {
        const next = { ...prev };
        if (file === null) {
          delete next[sessionId];
          return next;
        }
        const existing = next[sessionId] || [];
        if (Array.isArray(file)) {
          next[sessionId] = file;
        } else {
          next[sessionId] = [...existing, file];
        }
        return next;
      });
    }
    function removeDraftFile(sessionId, index) {
      if (!sessionId) return;
      setDraftFiles((prev) => {
        const next = { ...prev };
        const arr = [...next[sessionId] || []];
        arr.splice(index, 1);
        if (arr.length === 0) delete next[sessionId];
        else next[sessionId] = arr;
        return next;
      });
    }
    async function uploadBinaryDraft(sessionId, base64, mimeType, filename) {
      const resp = await fetch("/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content: base64, mimeType })
      });
      if (!resp.ok) throw new Error("Upload failed");
      const { url } = await resp.json();
      setDraftFileForSession(sessionId, { name: filename, url, isText: false, mimeType });
      return url;
    }
    function requestDirectImageAttach(sessionId, base64, mimeType, filename) {
      const requestId = sendAttachment(sessionId, base64, mimeType, filename);
      pendingAttachmentReqs.current[requestId] = {
        sessionId,
        filename,
        mimeType,
        base64,
        createdAt: Date.now()
      };
      showToast(`Sending image to Codex: ${filename}`);
      return requestId;
    }
    useEffect3(() => {
      const entries = Object.entries(controlResults || {});
      for (const [requestId, result] of entries) {
        if (!requestId.startsWith("attach-") || seenAttachmentResults.current[requestId]) continue;
        seenAttachmentResults.current[requestId] = true;
        const pending = pendingAttachmentReqs.current[requestId];
        delete pendingAttachmentReqs.current[requestId];
        if (!pending) continue;
        if (result?.result === "ok") {
          showToast(`Image attached to Codex: ${pending.filename}`);
          continue;
        }
        (async () => {
          try {
            await uploadBinaryDraft(pending.sessionId, pending.base64, pending.mimeType, pending.filename);
            showToast(`Direct image attach failed \u2014 added ${pending.filename} as a file link draft`);
          } catch {
            const detail = result?.error?.message || result?.error?.code || "unknown error";
            showToast(`Image attach failed: ${detail}`);
          }
        })();
      }
    }, [controlResults]);
    function historyRequestOptionsFor(sessionMeta) {
      const agentType = sessionMeta?.agent_type;
      return {
        limit: historyLimitForAgentType(agentType),
        ...agentType === "codex_cli" || agentType === "cursor_cli" ? { chunkBytes: CODEX_CLI_INITIAL_HISTORY_CHUNK_BYTES } : {}
      };
    }
    function historyRequestOptionsForSessionId(sessionId) {
      const meta = orderedSessions.find((session) => sessionIdOf3(session) === sessionId);
      return historyRequestOptionsFor(meta);
    }
    function selectSession(id, sessionMeta) {
      const reselectingActiveSession = activeSessionRef.current === id;
      restoreCachedTranscript(id);
      setActiveSession(id);
      activeSessionRef.current = id;
      sendHistoryCursorRef.current = {
        sessionId: id,
        index: (sendHistoryRef.current[id] || []).length,
        scratch: ""
      };
      setUnread((prev) => ({ ...prev, [id]: 0 }));
      setSessionAttention((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (attentionToast?.sessionId === id) clearAttentionToast();
      setSidebarOpen(false);
      setShowSlashMenu(false);
      setShowChatList(false);
      setShowThreadList(false);
      setShowTranscriptSearch(false);
      if (reselectingActiveSession) {
        setTimeout(() => requestHistory(id, historyRequestOptionsFor(sessionMeta)), 0);
      }
    }
    function openTranscriptSearchResult(result) {
      const id = result?.session_id;
      const messageId = Number(result?.message_id);
      if (!id || !Number.isSafeInteger(messageId) || messageId <= 0) return;
      const sessionMeta = orderedSessions.find((session) => sessionIdOf3(session) === id) || {
        session_id: id,
        workspace_path: result.workspace_path || null,
        project_root: result.project_root || null,
        workspace_name: result.workspace_name || null,
        agent_type: result.agent_type || null,
        status: "history"
      };
      transcriptWindow.cancelRouteRestore();
      routeScrollSnapshotRef.current = null;
      setTranscriptSearchTarget({ sessionId: id, messageId });
      selectSession(id, sessionMeta);
      setShowTranscriptSearch(false);
    }
    async function handleFileSelect(e) {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      e.target.value = "";
      for (const file of files) {
        if (file.size > 2 * 1024 * 1024) {
          showToast(`${file.name}: too large (max 2 MB)`);
          continue;
        }
        if (isTextFile(file.name) && file.size < 500 * 1024) {
          await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
              setDraftFileForSession(activeSession, { name: file.name, content: ev.target.result, isText: true });
              resolve();
            };
            reader.onerror = () => {
              showToast(`Failed to read ${file.name}`);
              resolve();
            };
            reader.readAsText(file);
          });
        } else {
          setUploading(true);
          try {
            await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = async (ev) => {
                const base64 = ev.target.result.split(",")[1];
                const caps = activeConfig?.capabilities || {};
                if (caps.send_attachment && file.type.startsWith("image/")) {
                  requestDirectImageAttach(activeSession, base64, file.type, file.name);
                } else {
                  await uploadBinaryDraft(activeSession, base64, file.type, file.name);
                  showToast(`Uploaded: ${file.name}`);
                }
                resolve();
              };
              reader.onerror = () => {
                showToast(`Failed to read ${file.name}`);
                resolve();
              };
              reader.readAsDataURL(file);
            });
          } catch {
            showToast(`Upload failed: ${file.name}`);
          } finally {
            setUploading(false);
          }
        }
      }
    }
    async function handlePaste(e) {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;
      e.preventDefault();
      if (!activeSession) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        showToast("Image too large (max 2 MB)");
        return;
      }
      const ext = file.type === "image/jpeg" ? "jpg" : "png";
      const filename = `screenshot-${Date.now()}.${ext}`;
      setUploading(true);
      try {
        await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = async (ev) => {
            const base64 = ev.target.result.split(",")[1];
            const caps = activeConfig?.capabilities || {};
            if (caps.send_attachment) {
              requestDirectImageAttach(activeSession, base64, file.type, filename);
            } else {
              await uploadBinaryDraft(activeSession, base64, file.type, filename);
              showToast("Screenshot attached");
            }
            resolve();
          };
          reader.onerror = () => {
            showToast("Failed to read clipboard image");
            resolve();
          };
          reader.readAsDataURL(file);
        });
      } catch {
        showToast("Paste upload failed");
      } finally {
        setUploading(false);
      }
    }
    function sendMessage() {
      if (activeBlockingPrompt) return;
      const currentInput2 = activeSession ? drafts[activeSession] || "" : "";
      const attachedFiles2 = activeSession ? draftFiles[activeSession] || [] : [];
      const text = currentInput2.trim();
      if (!text && attachedFiles2.length === 0) return;
      if (!activeSession) return;
      let content = "";
      if (attachedFiles2.length > 0) {
        const fileParts = attachedFiles2.map((f) => {
          if (f.isText) {
            const lang = getLang(f.name);
            return `\`${f.name}\`
\`\`\`${lang}
${f.content}
\`\`\``;
          }
          if ((f.mimeType || "").startsWith("image/")) {
            return `![${f.name}](${f.url})`;
          }
          return `[File: ${f.name}](${f.url})`;
        });
        content = fileParts.join("\n\n");
        if (text) content += `

${text}`;
      } else {
        content = text;
      }
      sendToSession(activeSession, content);
      if (text) {
        const previous = sendHistoryRef.current[activeSession] || [];
        const next = previous[previous.length - 1] === text ? previous : [...previous, text].slice(-100);
        sendHistoryRef.current[activeSession] = next;
        sendHistoryCursorRef.current = { sessionId: activeSession, index: next.length, scratch: "" };
      }
      setPendingDraftThreads((prev) => ({ ...prev, [activeSession]: false }));
      setDraftMessageBaselines((prev) => ({
        ...prev,
        [activeSession]: Math.min(prev[activeSession] || 0, (messages[activeSession] || []).length)
      }));
      setDraftForSession(activeSession, "");
      setDraftFileForSession(activeSession, null);
      setShowSlashMenu(false);
      textareaRef.current?.focus();
    }
    function clearInterruptConfirm() {
      if (interruptConfirmTimerRef.current) clearTimeout(interruptConfirmTimerRef.current);
      interruptConfirmTimerRef.current = null;
      interruptConfirmRef.current = { sessionId: null, expiresAt: 0 };
      setInterruptConfirmSession(null);
    }
    function armInterruptConfirm() {
      if (!activeSession) return;
      const expiresAt = Date.now() + 2500;
      interruptConfirmRef.current = { sessionId: activeSession, expiresAt };
      setInterruptConfirmSession(activeSession);
      if (interruptConfirmTimerRef.current) clearTimeout(interruptConfirmTimerRef.current);
      interruptConfirmTimerRef.current = setTimeout(() => {
        if (interruptConfirmRef.current.sessionId === activeSession && interruptConfirmRef.current.expiresAt === expiresAt) {
          interruptConfirmRef.current = { sessionId: null, expiresAt: 0 };
          interruptConfirmTimerRef.current = null;
          setInterruptConfirmSession(null);
        }
      }, 2500);
    }
    function performInterrupt() {
      if (!activeSession || !thinking[activeSession] || stopPending[activeSession]) {
        clearInterruptConfirm();
        return;
      }
      clearInterruptConfirm();
      setStopPending((prev) => ({ ...prev, [activeSession]: true }));
      interruptSession(activeSession);
    }
    useEffect3(() => () => {
      if (interruptConfirmTimerRef.current) clearTimeout(interruptConfirmTimerRef.current);
    }, []);
    useEffect3(() => {
      if (interruptConfirmSession && (interruptConfirmSession !== activeSession || !thinking[interruptConfirmSession])) {
        clearInterruptConfirm();
      }
    }, [activeSession, thinking, interruptConfirmSession]);
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        if (showSlashMenu) {
          setShowSlashMenu(false);
          return;
        }
        if (activeBlockingPrompt) return;
        if (isActiveThinking && !isStopPending) {
          e.preventDefault();
          const armed = interruptConfirmRef.current.sessionId === activeSession && interruptConfirmRef.current.expiresAt >= Date.now();
          if (armed) performInterrupt();
          else armInterruptConfirm();
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && interruptConfirmRef.current.sessionId === activeSession && interruptConfirmRef.current.expiresAt >= Date.now()) {
        e.preventDefault();
        performInterrupt();
        return;
      }
      const history = activeSession ? sendHistoryRef.current[activeSession] || [] : [];
      const historyCursor = sendHistoryCursorRef.current;
      const historyCursorActive = historyCursor.sessionId === activeSession && historyCursor.index >= 0 && historyCursor.index < history.length;
      if (e.key === "ArrowUp" && history.length > 0 && (currentInput === "" || historyCursorActive)) {
        e.preventDefault();
        const cursor = historyCursor.sessionId === activeSession ? historyCursor : { sessionId: activeSession, index: history.length, scratch: currentInput };
        cursor.index = Math.max(0, cursor.index - 1);
        sendHistoryCursorRef.current = cursor;
        setDraftForSession(activeSession, history[cursor.index]);
        return;
      }
      if (e.key === "ArrowDown" && historyCursorActive) {
        e.preventDefault();
        const nextIndex = Math.min(history.length, historyCursor.index + 1);
        sendHistoryCursorRef.current = { ...historyCursor, index: nextIndex };
        setDraftForSession(activeSession, nextIndex === history.length ? historyCursor.scratch : history[nextIndex]);
        return;
      }
      if (e.key === "Tab" && showSlashMenu && filteredSlashCommands.length > 0) {
        e.preventDefault();
        applySlashCommand(filteredSlashCommands[0].command);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }
    const isActiveThinking = activeSession ? !!thinking[activeSession] : false;
    const isStopPending = activeSession ? !!stopPending[activeSession] : false;
    const currentInput = activeSession ? drafts[activeSession] || "" : "";
    const attachedFiles = activeSession ? draftFiles[activeSession] || [] : [];
    const resizeComposerTextarea = React.useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const maximum = Math.max(42, Math.floor(window.innerHeight * 0.4));
      textarea.style.height = "auto";
      const nextHeight = Math.max(42, Math.min(textarea.scrollHeight, maximum));
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > maximum ? "auto" : "hidden";
    }, []);
    useLayoutEffect2(() => {
      resizeComposerTextarea();
    }, [activeSession, currentInput, resizeComposerTextarea]);
    useEffect3(() => {
      window.addEventListener("resize", resizeComposerTextarea);
      return () => window.removeEventListener("resize", resizeComposerTextarea);
    }, [resizeComposerTextarea]);
    const rawCurrentMessages = activeMessagesForScroll;
    const draftBaseline = activeSession && pendingDraftThreads[activeSession] ? draftMessageBaselines[activeSession] || 0 : 0;
    const currentMessages = React.useMemo(() => {
      const baseline = Math.min(draftBaseline, rawCurrentMessages.length);
      if (baseline <= 0) return rawCurrentMessages;
      if (baseline >= rawCurrentMessages.length) return EMPTY_MESSAGES;
      return rawCurrentMessages.slice(baseline);
    }, [rawCurrentMessages, draftBaseline]);
    const renderedMessages = React.useMemo(() => {
      return currentMessages.filter((msg) => hasVisibleMessage(msg));
    }, [currentMessages]);
    const chatRouteActive = !showAutomations && !showSkills && !showUsageDashboard && !showHostResourceDashboard && !showFleetView && !showTranscriptSearch;
    const transcriptWindow = useTranscriptWindow({
      messages: renderedMessages,
      containerRef: messagesListRef,
      sessionId: activeSession,
      routeActive: chatRouteActive
    });
    const captureChatRouteScroll = React.useCallback(() => {
      const list = messagesListRef.current;
      if (!list) return;
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      routeScrollSnapshotRef.current = {
        sessionId: activeSession,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        atBottom
      };
      transcriptWindow.prepareForRouteChange();
    }, [activeSession, transcriptWindow.prepareForRouteChange]);
    useLayoutEffect2(() => {
      if (!chatRouteActive || transcriptWindow.enabled) return void 0;
      const pending = routeScrollSnapshotRef.current;
      const list = messagesListRef.current;
      if (!list || pending?.sessionId !== activeSession) return void 0;
      const restore = () => {
        const activeList = messagesListRef.current;
        if (!activeList || pending.sessionId !== activeSession) return;
        const target = pending.atBottom ? activeList.scrollHeight : Math.min(pending.scrollTop, Math.max(0, activeList.scrollHeight - activeList.clientHeight));
        programmaticScrollUntilRef.current = Date.now() + 800;
        setScrollTopInstant(activeList, target);
      };
      restore();
      routeScrollRestoreFrameRef.current = requestAnimationFrame(() => {
        routeScrollRestoreFrameRef.current = 0;
        restore();
      });
      return () => {
        if (routeScrollRestoreFrameRef.current) cancelAnimationFrame(routeScrollRestoreFrameRef.current);
        routeScrollRestoreFrameRef.current = 0;
      };
    }, [activeSession, chatRouteActive, transcriptWindow.enabled]);
    useEffect3(() => {
      if (!renderProfileEnabled) return void 0;
      window.__RAC_TRANSCRIPT_WINDOW__ = {
        total: renderedMessages.length,
        scrollToIndex: transcriptWindow.scrollToIndex
      };
      return () => {
        if (window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex === transcriptWindow.scrollToIndex) {
          delete window.__RAC_TRANSCRIPT_WINDOW__;
        }
      };
    }, [renderedMessages.length, transcriptWindow.scrollToIndex]);
    const activePrompt = activeSession ? permissionPrompts[activeSession] || null : null;
    const activeErrorPrompt = activeSession ? errorPrompts[activeSession] || null : null;
    const activeBlockingErrorPrompt = isBlockingErrorPrompt(activeErrorPrompt) ? activeErrorPrompt : null;
    const activeInlineErrorPrompt = activeErrorPrompt && !isBlockingErrorPrompt(activeErrorPrompt) ? activeErrorPrompt : null;
    const activeBlockingPrompt = activePrompt || activeBlockingErrorPrompt;
    const activeBlockingPromptLabel = activePrompt ? "Permission required" : activeBlockingErrorPrompt ? safeString(activeBlockingErrorPrompt.title, "Action required") : null;
    const canSend = !!(currentInput.trim() || attachedFiles.length > 0) && !!activeSession && !uploading && !activeBlockingPrompt;
    const relayHealthState = connected ? connectionHealth?.state || "connecting" : "offline";
    const relayRttText = connectionHealth?.rttMs != null ? ` \xB7 ${connectionHealth.rttMs} ms` : "";
    const unreadTotal = Object.entries(unread).reduce((total, [sessionId, count]) => testSessionIds.has(sessionId) ? total : total + Number(count || 0), 0);
    const attentionTotal = Object.keys(sessionAttention).filter((sessionId) => sessionId !== activeSession && !testSessionIds.has(sessionId)).length;
    const appUpdateValidationAgeMs = latestAppUpdateValidation?.completed_at ? Date.now() - Date.parse(latestAppUpdateValidation.completed_at) : Number.POSITIVE_INFINITY;
    const recentAppUpdateValidation = appUpdateValidationAgeMs >= 0 && appUpdateValidationAgeMs <= 24 * 60 * 60 * 1e3 ? latestAppUpdateValidation : null;
    const visibleNightlyValidationFailures = recentAppUpdateValidation ? nightlyValidationFailures.filter((item) => item.run_id !== recentAppUpdateValidation.run_id) : nightlyValidationFailures;
    const hasSystemBanner = duplicateProxyAlarms.length > 0 || visibleNightlyValidationFailures.length > 0 || !!recentAppUpdateValidation;
    const slashQuery = currentInput.startsWith("/") ? currentInput.slice(1).trim().toLowerCase() : "";
    const filteredSlashCommands = currentInput.startsWith("/") ? SLASH_COMMANDS.filter((item) => item.command.slice(1).includes(slashQuery)) : [];
    useLayoutEffect2(() => {
      const banner = systemBannerRef.current;
      if (!hasSystemBanner || !banner) {
        setSystemBannerHeight(0);
        return void 0;
      }
      const updateHeight = () => setSystemBannerHeight(Math.ceil(banner.getBoundingClientRect().height));
      updateHeight();
      if (typeof ResizeObserver === "undefined") return void 0;
      const observer = new ResizeObserver(updateHeight);
      observer.observe(banner);
      return () => observer.disconnect();
    }, [hasSystemBanner, duplicateProxyAlarms.length, visibleNightlyValidationFailures.length, recentAppUpdateValidation?.run_id]);
    const activeConfig = activeSession ? agentConfigs[activeSession] || null : null;
    const activeConfigControls = activeSession ? Object.values(configControlStates || {}).filter((control) => control.sessionId === activeSession) : [];
    const activePendingConfigControl = activeConfigControls.find((control) => control.status === "pending" || control.status === "awaiting_config") || null;
    const activeFailedConfigControl = activeConfigControls.find((control) => control.status === "failed") || null;
    const activeHistoryMeta = activeSession ? historyMeta[activeSession] || null : null;
    const activeHistoryLoading = activeSession ? historyLoading[activeSession] || null : null;
    useEffect3(() => {
      if (!activeSession || !connected) return;
      if (transcriptSearchTarget?.sessionId === activeSession) return;
      const existing = messages[activeSession] || [];
      const lastSequence = existing.reduce((maximum, message) => Math.max(maximum, Number(message?.sequence || 0)), 0);
      if (lastSequence > 0) {
        requestHistory(activeSession, { afterSequence: lastSequence });
        return;
      }
      const tailOptions = historyRequestOptionsFor(activeSessionMeta);
      const chunkSource = activeSessionMeta?.agent_type === "codex_cli" || activeSessionMeta?.agent_type === "cursor_cli" ? "native" : "relay_sqlite";
      requestHistoryChunk(activeSession, { ...tailOptions, mode: "tail", source: chunkSource });
    }, [activeSession, connected, activeSessionMeta?.agent_type, transcriptSearchTarget?.sessionId]);
    useEffect3(() => {
      if (!connected || !transcriptSearchTarget || activeSession !== transcriptSearchTarget.sessionId) return;
      const targetAlreadyLoaded = (messages[activeSession] || []).some((message) => String(message?.id) === String(transcriptSearchTarget.messageId));
      if (targetAlreadyLoaded) return;
      const requestAroundMatch = () => requestHistoryChunk(activeSession, {
        mode: "around",
        source: "relay_sqlite",
        aroundId: transcriptSearchTarget.messageId,
        limit: 200,
        replace: true,
        userInitiated: true
      });
      requestAroundMatch();
      const retryTimer = setTimeout(requestAroundMatch, 600);
      return () => clearTimeout(retryTimer);
    }, [connected, activeSession, transcriptSearchTarget?.sessionId, transcriptSearchTarget?.messageId, messages[activeSession]]);
    useEffect3(() => {
      if (!transcriptSearchTarget || activeSession !== transcriptSearchTarget.sessionId) return void 0;
      const selector = `[data-message-id="${transcriptSearchTarget.messageId}"]`;
      const targetIndex = renderedMessages.findIndex((message) => String(message?.id) === String(transcriptSearchTarget.messageId));
      if (targetIndex >= 0) transcriptWindow.scrollToIndex(targetIndex, "center");
      let attempts = 0;
      let clearHighlightTimer = null;
      const timer = setInterval(() => {
        attempts++;
        const row = messagesListRef.current?.querySelector(selector);
        if (row) {
          clearInterval(timer);
          row.scrollIntoView({ block: "center", behavior: "instant" });
          clearHighlightTimer = setTimeout(() => {
            setTranscriptSearchTarget((current) => current?.sessionId === activeSession && String(current?.messageId) === String(transcriptSearchTarget.messageId) ? null : current);
          }, 5e3);
        } else if (attempts >= 40) {
          clearInterval(timer);
          setTranscriptSearchTarget(null);
          showToast("Matched message could not be loaded");
        }
      }, 100);
      return () => {
        clearInterval(timer);
        if (clearHighlightTimer) clearTimeout(clearHighlightTimer);
      };
    }, [activeSession, transcriptSearchTarget?.sessionId, transcriptSearchTarget?.messageId, messages[activeSession], renderedMessages, transcriptWindow.scrollToIndex]);
    useEffect3(() => {
      setSessionSubscriptions(activeSession ? [activeSession] : []);
    }, [activeSession, setSessionSubscriptions]);
    useEffect3(() => {
      if (!activeSession || !connected || !activeNativeCliPlaceholder) return;
      const tailOptions = historyRequestOptionsFor(activeSessionMeta);
      requestHistoryChunk(activeSession, { ...tailOptions, mode: "tail", source: "native" });
    }, [activeSession, connected, activeNativeCliPlaceholder]);
    const isAntigravityV2 = activeSessionMeta?.agent_type === "antigravity-v2";
    const rawActiveChatList = activeSession ? chatLists[activeSession] || [] : [];
    const optimisticV2Focus = activeSession ? optimisticV2ChatFocus[activeSession] : null;
    const activeChatList = React.useMemo(() => {
      if (!(isAntigravityV2 && optimisticV2Focus?.id)) return rawActiveChatList;
      return rawActiveChatList.map((item) => !item?.kind || item.kind === "chat" ? { ...item, active: item.id === optimisticV2Focus.id } : item);
    }, [rawActiveChatList, isAntigravityV2, optimisticV2Focus?.id]);
    const activeChatListLoaded = !!(activeSession && Object.prototype.hasOwnProperty.call(chatLists, activeSession));
    const activeV2ConversationCount = activeChatList.filter((item) => !item?.kind || item.kind === "chat").length;
    const showAntigravityV2Navigator = !!(activeSession && isAntigravityV2 && !showFileBrowser);
    const autoExpandLongCodeBlocks = activeSessionMeta?.agent_type === "antigravity" || activeSessionMeta?.agent_type === "antigravity_panel" || activeSessionMeta?.agent_type === "antigravity-v2";
    const visiblePaneSession = activeSessionMeta ? findVisiblePaneSession(orderedSessions, activeSessionMeta) : null;
    const codexWorkbenchPaneSummary = activeSessionMeta?.agent_type === "codex" && activeSessionMeta?.visible_pane_visible ? {
      pane_agent: activeSessionMeta.visible_pane_agent || null,
      summary: formatVisiblePaneSummary(activeSessionMeta),
      sourceSession: activeSessionMeta
    } : null;
    const fallbackPaneSummary = visiblePaneSession ? {
      pane_agent: visiblePaneSession.panel_agent || null,
      summary: formatVisiblePaneSummary(visiblePaneSession),
      sourceSession: visiblePaneSession
    } : null;
    const effectiveVisiblePane = codexWorkbenchPaneSummary || fallbackPaneSummary;
    const rawVisiblePaneSummary = effectiveVisiblePane?.summary || "";
    const visiblePaneAgent = effectiveVisiblePane?.pane_agent || null;
    const visiblePaneLabel = rawVisiblePaneSummary || agentTypeLabel(visiblePaneAgent) || sessionSubLabel(effectiveVisiblePane?.sourceSession, sessionIdOf3(effectiveVisiblePane?.sourceSession));
    const visiblePaneSummary = visiblePaneLabel;
    const activeCodexPaneLive = !!(activeSessionMeta && activeSessionMeta.agent_type === "codex" && activeSessionMeta.visible_pane_visible && activeSessionMeta.visible_pane_agent === "codex");
    const activeCodexPaneMismatch = !!(activeSessionMeta && activeSessionMeta.agent_type === "codex" && activeSessionMeta.visible_pane_visible && activeSessionMeta.visible_pane_agent && activeSessionMeta.visible_pane_agent !== "codex");
    const activeAgent = sessionAgent(activeSessionMeta || activeSession, activeConfig);
    const activeWorkspaceLabel = activeSession ? workspaceLabelBySessionId[activeSession] : "";
    const activeWorkspacePath = activeSessionMeta && typeof activeSessionMeta === "object" ? activeSessionMeta.workspace_path : "";
    const activeWorkspaceBasename = activeWorkspacePath ? activeWorkspacePath.split(/[\\/]/).filter(Boolean).pop() || activeWorkspacePath : "";
    const activeWorkspaceContext = activeWorkspaceBasename || (activeWorkspaceLabel && activeWorkspaceLabel !== "Unscoped" ? activeWorkspaceLabel : "") || safeString(activeSessionMeta?.workspace_name) || "Unscoped";
    const activeTitleProjectionCacheRef = useRef3(/* @__PURE__ */ new Map());
    const activeTitleSession = React.useMemo(() => isAntigravityV2 && optimisticV2Focus?.title ? { ...activeSessionMeta || {}, native_chat_title: optimisticV2Focus.title } : activeSessionMeta, [activeSessionMeta, isAntigravityV2, optimisticV2Focus?.title]);
    const activeChatTitleProjection = React.useMemo(() => {
      if (!activeSession) return { title: "Agent Chat", source: "fallback", field: "no_session" };
      const next = resolveSessionChatTitleProjection(
        activeTitleSession,
        activeTitleSession?.custom_display_name || "",
        activeMessagesForScroll
      );
      const retained = retainStrongerSessionChatTitleProjection(
        activeTitleProjectionCacheRef.current.get(activeSession),
        next
      );
      activeTitleProjectionCacheRef.current.set(activeSession, retained);
      return retained;
    }, [activeSession, activeTitleSession, activeMessagesForScroll]);
    const activeChatTitle = activeChatTitleProjection.title;
    const activeAutomationView = activeSession ? automationViews[activeSession] : null;
    const activeLooksLikeCodex = activeAgent?.name === "Codex";
    const showVisiblePaneBanner = !!(activeLooksLikeCodex && activeSessionMeta && activeSessionMeta.agent_type === "codex" && (activeCodexPaneMismatch && visiblePaneSession || !codexWorkbenchPaneSummary && visiblePaneSession && (visiblePaneSession.panel_agent === "antigravity_panel" || visiblePaneSummary)));
    const canLaunchNewThread = !!activeConfig?.capabilities?.new_thread;
    const isCodexDesktop = activeSessionMeta?.agent_type === "codex-desktop";
    const isCursor = activeSessionMeta?.agent_type === "cursor";
    const isDesktopAgent = isCodexDesktop || isCursor;
    const newThreadLabel = isDesktopAgent ? "New chat" : "New thread";
    const activeMachine = activeSessionMeta && typeof activeSessionMeta === "object" ? activeSessionMeta.machine_label : "";
    const activeHostLabel = sessionHostLabel(activeSessionMeta);
    const lastUserMsg = React.useMemo(() => {
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        if (currentMessages[i]?.role === "user") return currentMessages[i];
      }
      return null;
    }, [currentMessages]);
    const lastUserText = lastUserMsg ? normalizeMessageContent(lastUserMsg.content).replace(/\s+/g, " ").trim() : "";
    const activeHealth = activeSession ? health[activeSession] || activeSessionMeta?.status || "unknown" : "";
    const normalizeTranscriptPreviewPath = React.useCallback((rawPath) => {
      const cleaned = safeString(rawPath).replace(/\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\)\s*$/i, "").replace(/^["'`]+|["'`]+$/g, "").trim();
      if (!cleaned) return "";
      const normalized = cleaned.replace(/\\/g, "/");
      const workspace = safeString(activeWorkspacePath).replace(/\\/g, "/").replace(/\/+$/, "");
      if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
        if (!workspace) return "";
        const lhs = normalized.toLowerCase();
        const rhs = workspace.toLowerCase();
        if (lhs === rhs) return ".";
        if (lhs.startsWith(rhs + "/")) return normalized.slice(workspace.length + 1);
        return "";
      }
      return normalized.replace(/^\.\/+/, "").replace(/^\/+/, "");
    }, [activeWorkspacePath]);
    const openTranscriptPreview = React.useCallback((messageKey, rawPath) => {
      if (!activeSession) return;
      const relativePath = normalizeTranscriptPreviewPath(rawPath);
      if (!relativePath) {
        showToast("File is outside the current workspace");
        return;
      }
      setTranscriptPreview((prev) => prev && prev.sessionId === activeSession && prev.messageKey === messageKey && prev.path === relativePath ? null : { sessionId: activeSession, messageKey, path: relativePath });
      requestFileContentRef.current(activeSession, relativePath);
    }, [activeSession, normalizeTranscriptPreviewPath]);
    const closeTranscriptPreview = React.useCallback(() => setTranscriptPreview(null), []);
    const activeActivity = activeSession ? activities[activeSession] !== void 0 ? activities[activeSession] : activeSessionMeta && typeof activeSessionMeta === "object" ? activeSessionMeta.activity : null : null;
    const activeContextCard = activeActivity?.context_card || null;
    const showLastUserBanner = !!(activeSession && lastUserText && !((activeSessionMeta?.agent_type === "cline" || activeSessionMeta?.agent_type === "roo_code") && activeContextCard));
    const assistantMonospace = ["claude_cli", "codex_cli", "cursor_cli"].includes(activeSessionMeta?.agent_type);
    const lastAssistantMsg = React.useMemo(() => {
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        if (currentMessages[i]?.role === "assistant") return currentMessages[i];
      }
      return null;
    }, [currentMessages]);
    const liveThinkingText = activeSession ? (thinkingContent[activeSession] || "").trim() : "";
    const lastAssistantText = lastAssistantMsg ? normalizeMessageContent(lastAssistantMsg.content).trim() : "";
    const showPinnedThinkingRow = !!(activeActivity && !activeActivity?.thinking && !activeActivity?.current && !activeActivity?.task_list && hasSubstantiveLiveText(liveThinkingText));
    const showLiveAssistantDraft = !!(activeSession && !activeProvisionalStream && activeActivity && (activeActivity.kind === "thinking" || activeActivity.kind === "generating") && !activeActivity?.thinking && !activeActivity?.current && !showPinnedThinkingRow && hasSubstantiveLiveText(liveThinkingText) && (activeSessionMeta?.agent_type === "codex" || activeSessionMeta?.agent_type === "codex-desktop" || activeSessionMeta?.agent_type === "cursor" || activeSessionMeta?.agent_type === "antigravity_panel") && liveThinkingText !== lastAssistantText && !lastAssistantText.includes(liveThinkingText));
    const showTranscriptFooterActivity = !!(activeActivity && (activeActivity?.goal || activeActivity?.thinking || activeActivity?.current || activeActivity?.step || activeActivity?.usage || activeActivity?.task_list || activeActivity.kind !== "idle" || hasSubstantiveLiveText(liveThinkingText || activeActivity.thinkingContent || "")));
    const showPartialHistoryBanner = !!(activeSession && activeHistoryMeta?.partial && Number(activeHistoryMeta.total || 0) > Number(activeHistoryMeta.loaded || currentMessages.length || 0));
    const partialHistoryLoaded = Number(activeHistoryMeta?.loaded || currentMessages.length || 0);
    const partialHistoryTotal = Number(activeHistoryMeta?.total || partialHistoryLoaded || 0);
    function loadOlderActiveHistory() {
      if (!activeSession) return;
      if (!transcriptWindow.prepareForPrepend()) {
        const list = messagesListRef.current;
        const listRect = list?.getBoundingClientRect();
        const listTop = listRect?.top || 0;
        const rows = list ? Array.from(list.querySelectorAll(".message[data-message-key]")) : [];
        const anchorRow = rows.find((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top >= listTop && rect.top < listRect.bottom;
        }) || rows.find((row) => row.getBoundingClientRect().bottom > listTop) || rows[0] || null;
        nonWindowedPrependAnchorRef.current = anchorRow ? {
          messageKey: anchorRow.dataset.messageKey,
          viewportOffset: anchorRow.getBoundingClientRect().top - listTop
        } : null;
      }
      const chunkSource = activeSessionMeta?.agent_type === "codex_cli" || activeSessionMeta?.agent_type === "cursor_cli" ? "native" : "relay_sqlite";
      requestHistoryChunk(activeSession, {
        mode: activeHistoryMeta?.cursor ? "older" : "tail",
        source: chunkSource,
        userInitiated: true,
        beforeOffset: activeHistoryMeta?.cursor?.next_before_offset,
        beforeId: activeHistoryMeta?.cursor?.next_before_id,
        ...historyRequestOptionsFor(activeSessionMeta)
      });
    }
    useEffect3(() => {
      requestOlderHistoryRef.current = showPartialHistoryBanner && !activeHistoryLoading ? loadOlderActiveHistory : null;
      return () => {
        requestOlderHistoryRef.current = null;
      };
    }, [
      activeSession,
      activeSessionMeta?.agent_type,
      activeHistoryLoading,
      showPartialHistoryBanner,
      activeHistoryMeta?.cursor?.next_before_offset,
      activeHistoryMeta?.cursor?.next_before_id
    ]);
    function retryActiveHistory() {
      if (!activeSession) return;
      const chunkSource = activeSessionMeta?.agent_type === "codex_cli" || activeSessionMeta?.agent_type === "cursor_cli" ? "native" : "relay_sqlite";
      requestHistoryChunk(activeSession, {
        ...historyRequestOptionsFor(activeSessionMeta),
        mode: "tail",
        source: chunkSource,
        userInitiated: true
      });
    }
    const shouldBottomAlignMessages = !!(activeSession && (currentMessages.length > 0 || showLiveAssistantDraft || activeProvisionalStream));
    const activeAgentMemoKey = activeAgentKey(activeAgent);
    const renderedMessageNodes = React.useMemo(() => renderedMessages.slice(transcriptWindow.start, transcriptWindow.end).map((msg, windowIndex) => {
      const i = transcriptWindow.start + windowIndex;
      const messageKey = messageIdentityKey(msg, i);
      const searchMatch = !!(transcriptSearchTarget?.sessionId === activeSession && String(msg?.id) === String(transcriptSearchTarget?.messageId));
      const richContentEager = transcriptWindow.enabled || searchMatch || i >= Math.max(0, renderedMessages.length - 48);
      const preview = transcriptPreview?.sessionId === activeSession && transcriptPreview?.messageKey === messageKey ? transcriptPreview : null;
      const messageNode = /* @__PURE__ */ React.createElement(
        MemoTranscriptMessage,
        {
          key: messageKey,
          msg,
          messageKey,
          activeAgent,
          assistantMonospace,
          autoExpandLongCodeBlocks,
          onOpenPath: openTranscriptPreview,
          agentType: activeSessionMeta?.agent_type,
          preview,
          fileContents,
          onClosePreview: closeTranscriptPreview,
          deliveryState: msg._cid ? deliveryStates[msg._cid] : null,
          onSteer: handleTranscriptSteer,
          onRetry: handleTranscriptRetry,
          richContentEager,
          searchMatch
        }
      );
      return transcriptWindow.enabled ? /* @__PURE__ */ React.createElement(
        VirtualTranscriptRow,
        {
          key: messageKey,
          index: i,
          messageKey: `${activeSession || ""}${messageKey}`,
          onMeasure: transcriptWindow.onMeasure
        },
        messageNode
      ) : messageNode;
    }), [
      renderedMessages,
      transcriptWindow.start,
      transcriptWindow.end,
      transcriptWindow.enabled,
      transcriptWindow.onMeasure,
      activeSession,
      transcriptSearchTarget?.sessionId,
      transcriptSearchTarget?.messageId,
      activeAgentMemoKey,
      assistantMonospace,
      autoExpandLongCodeBlocks,
      openTranscriptPreview,
      activeSessionMeta?.agent_type,
      transcriptPreview,
      fileContents,
      closeTranscriptPreview,
      deliveryStates,
      handleTranscriptSteer,
      handleTranscriptRetry
    ]);
    const hasThreadCap = activeConfig?.capabilities?.thread_list;
    const hasNativeDraftThread = !!activeSessionMeta?.is_new_chat_draft;
    const showDesktopThreadTabs = !!(activeSession && (activeSessionMeta?.agent_type === "codex-desktop" || activeSessionMeta?.agent_type === "cursor") && hasThreadCap && (threadLists[activeSession]?.length > 0 || pendingDraftThreads[activeSession] || hasNativeDraftThread) && !showFileBrowser);
    const desktopThreadTabs = React.useMemo(() => {
      const list = [...threadLists[activeSession] || []];
      if (list.length === 0) return list;
      const focusId = optimisticThreadFocus[activeSession];
      const focusIndex = focusId ? list.findIndex((thread) => thread.id === focusId) : -1;
      const activeIndex = focusIndex >= 0 ? focusIndex : list.findIndex((thread) => thread.active);
      if (activeIndex > 0) {
        const [activeThread] = list.splice(activeIndex, 1);
        list.unshift(activeThread);
      }
      return list;
    }, [activeSession, threadLists, optimisticThreadFocus]);
    const activeTranscriptRenderKey = React.useMemo(() => {
      const focusedThreadId = optimisticThreadFocus[activeSession];
      const activeThread = (threadLists[activeSession] || []).find((thread) => thread?.active);
      const activeThreadId = activeThread?.cache_key || activeThread?.id;
      const draftKey = pendingDraftThreads[activeSession] || hasNativeDraftThread ? "draft" : "";
      return `${activeSession || "none"}:${draftKey || focusedThreadId || activeThreadId || "default"}`;
    }, [activeSession, threadLists, optimisticThreadFocus, pendingDraftThreads, hasNativeDraftThread]);
    const noMessages = currentMessages.length === 0;
    React.useEffect(() => {
      if (activeSession && hasThreadCap && noMessages) {
        requestThreadList(activeSession);
      }
    }, [activeSession, hasThreadCap, noMessages]);
    React.useEffect(() => {
      if (!(activeSession && isAntigravityV2 && connected)) return void 0;
      requestChatList(activeSession);
      const retryTimers = [600, 1800, 4200].map((delay) => setTimeout(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        requestChatList(activeSession);
      }, delay));
      const refreshIfVisible = () => {
        if (typeof document !== "undefined" && document.hidden) return;
        requestChatList(activeSession);
      };
      const intervalId = setInterval(refreshIfVisible, 3e4);
      const onVisibility = () => refreshIfVisible();
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
      return () => {
        retryTimers.forEach((timer) => clearTimeout(timer));
        clearInterval(intervalId);
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      };
    }, [activeSession, isAntigravityV2, connected]);
    React.useEffect(() => {
      if (activeSession && isAntigravityV2) {
        setAgv2NavigatorOpen(true);
        setShowChatList(false);
      }
    }, [activeSession, isAntigravityV2]);
    React.useEffect(() => {
      if (!(activeSession && isAntigravityV2)) return;
      const activeChat = rawActiveChatList.find((item) => (!item?.kind || item.kind === "chat") && item.active);
      if (!activeChat) return;
      setOptimisticV2ChatFocus((prev) => {
        const current = prev[activeSession];
        if (!current) return prev;
        if (current.id !== activeChat.id && Date.now() - (current.at || 0) < 15e3) return prev;
        const next = { ...prev };
        delete next[activeSession];
        return next;
      });
    }, [activeSession, isAntigravityV2, rawActiveChatList]);
    React.useEffect(() => {
      if (!(activeSession && hasThreadCap && (isDesktopAgent || showThreadList))) return void 0;
      requestThreadList(activeSession);
      const intervalId = setInterval(
        () => requestThreadList(activeSession),
        showThreadList ? 3e3 : 5e3
      );
      return () => clearInterval(intervalId);
    }, [activeSession, activeSessionMeta?.agent_type, hasThreadCap, showThreadList]);
    React.useEffect(() => {
      if (!activeSession) return;
      const baseline = draftMessageBaselines[activeSession] || 0;
      const rawCount = rawCurrentMessages.length;
      if (baseline > rawCount) {
        setDraftMessageBaselines((prev) => ({ ...prev, [activeSession]: rawCount }));
      }
    }, [activeSession, draftMessageBaselines, rawCurrentMessages.length]);
    React.useEffect(() => {
      if (!activeSession || currentMessages.length === 0) return;
      setPendingDraftThreads((prev) => prev[activeSession] ? { ...prev, [activeSession]: false } : prev);
    }, [activeSession, currentMessages.length]);
    React.useEffect(() => {
      if (!activeSession) return;
      const liveThreads = threadLists[activeSession] || [];
      const focusedThreadId = optimisticThreadFocus[activeSession];
      if (!focusedThreadId) return;
      if (liveThreads.some((thread) => thread.id === focusedThreadId && thread.active)) {
        setOptimisticThreadFocus((prev) => {
          const next = { ...prev };
          delete next[activeSession];
          return next;
        });
      }
    }, [activeSession, threadLists, optimisticThreadFocus]);
    function handleNewThread(sessionId = activeSession) {
      if (!sessionId) return;
      setPendingDraftThreads((prev) => ({ ...prev, [sessionId]: true }));
      setOptimisticThreadFocus((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setDraftMessageBaselines((prev) => ({
        ...prev,
        [sessionId]: (messages[sessionId] || []).length
      }));
      setShowThreadList(false);
      newThread(sessionId);
    }
    function handleSwitchThread(sessionId, threadId) {
      if (!(sessionId && threadId)) return;
      setPendingDraftThreads((prev) => ({ ...prev, [sessionId]: false }));
      setOptimisticThreadFocus((prev) => ({ ...prev, [sessionId]: threadId }));
      setDraftMessageBaselines((prev) => ({ ...prev, [sessionId]: 0 }));
      switchThread(sessionId, threadId);
    }
    function handleAntigravityV2New(sessionId = activeSession) {
      if (!sessionId) return;
      setAgv2NavigatorOpen(true);
      setShowChatList(false);
      setOptimisticV2ChatFocus((prev) => ({
        ...prev,
        [sessionId]: { id: "__agv2:new_conversation", title: "New Conversation", kind: "nav", at: Date.now() }
      }));
      newChat(sessionId);
    }
    function handleAntigravityV2Navigate(itemId, sessionId = activeSession) {
      if (!(sessionId && itemId)) return;
      setAgv2NavigatorOpen(true);
      setShowChatList(false);
      const item = (chatLists[sessionId] || []).find((entry) => entry?.id === itemId);
      const fallbackTitle = itemId === "__agv2:new_conversation" ? "New Conversation" : itemId === "__agv2:conversation_history" ? "Conversation History" : itemId === "__agv2:scheduled_tasks" ? "Scheduled Tasks" : "Antigravity v2";
      setOptimisticV2ChatFocus((prev) => ({
        ...prev,
        [sessionId]: {
          id: itemId,
          title: item?.title || fallbackTitle,
          kind: item?.kind || "chat",
          at: Date.now()
        }
      }));
      if (itemId === "__agv2:new_conversation") {
        handleAntigravityV2New(sessionId);
        return;
      }
      switchChat(sessionId, itemId);
    }
    function updateInput(value) {
      if (!activeSession) return;
      sendHistoryCursorRef.current = {
        sessionId: activeSession,
        index: (sendHistoryRef.current[activeSession] || []).length,
        scratch: value
      };
      setDraftForSession(activeSession, value);
      setShowSlashMenu(value.startsWith("/"));
    }
    function applySlashCommand(command) {
      if (!activeSession) return;
      const templates = {
        "/plan": `${command} Outline the implementation approach and major steps.`,
        "/review": `${command} Review the current changes for bugs, regressions, and missing tests.`,
        "/fix": `${command} Implement or repair the current issue.`,
        "/summarize": `${command} Summarize the current state and important changes.`
      };
      const nextValue = templates[command] || `${command} `;
      setDraftForSession(activeSession, nextValue);
      setShowSlashMenu(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    function renderSidebarSessionCard(session, pinned = false, workspaceLabel = "") {
      const id = sessionIdOf3(session);
      return /* @__PURE__ */ React.createElement(
        MemoSessionCard,
        {
          key: id,
          session,
          health: health[id],
          unread: testSessionIds.has(id) ? 0 : unread[id] || 0,
          isThinking: !!thinking[id],
          isActive: id === activeSession,
          agentConfig: agentConfigs[id] || null,
          activity: activities[id] || null,
          sessionMessages: messages[id] || [],
          hasBlockingPrompt: !!permissionPrompts[id] || !!isBlockingErrorPrompt(errorPrompts[id]),
          blockingPromptLabel: permissionPrompts[id] ? "Permission required" : errorPrompts[id]?.title || "Action required",
          muted: !!sessionPreferences[id]?.muted,
          pinned,
          workspaceLabel,
          menuOpen: openSidebarMenuId === id,
          onMenuToggle: (open) => setOpenSidebarMenuId((current) => open ? id : current === id ? "" : current),
          onPinChange: (nextPinned) => saveSessionPreference(id, { pinned: nextPinned }).catch((error) => {
            showToast(error?.message || `Unable to ${nextPinned ? "pin" : "unpin"} chat`);
          }),
          onSelect: () => selectSession(id, session),
          onManage: () => {
            setManagedSessionId(id);
            setShowSessionManagement(true);
            setShowNotificationSettings(false);
            setShowNewSession(false);
          },
          onClose: () => {
            const isDisconnected = health[id] === "disconnected" || !health[id];
            const msg = isDisconnected ? "Remove session from the list?" : `Close session "${id}"?`;
            if (window.confirm(msg)) closeSession(id, isDisconnected);
          },
          onAutomations: session?.agent_type === "codex-desktop" ? () => {
            if (!showAutomations) captureChatRouteScroll();
            setShowAutomations((open) => !open);
            setShowSkills(false);
            setShowFleetView(false);
            setShowUsageDashboard(false);
            setShowHostResourceDashboard(false);
            setSidebarOpen(false);
          } : void 0,
          showAutomationsActive: showAutomations,
          onSkills: session?.agent_type === "codex-desktop" ? () => {
            if (!showSkills) captureChatRouteScroll();
            setShowSkills((open) => !open);
            setShowAutomations(false);
            setShowFleetView(false);
            setShowUsageDashboard(false);
            setShowHostResourceDashboard(false);
            setSidebarOpen(false);
            if (!skillLists[id]) requestSkillList(id);
          } : void 0,
          showSkillsActive: showSkills
        }
      );
    }
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `app${hasSystemBanner ? " has-system-banner" : ""}`,
        style: hasSystemBanner ? { "--system-banner-height": `${systemBannerHeight}px` } : void 0
      },
      quickSwitcherOpen && /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "quick-switcher-overlay",
          onMouseDown: (event) => {
            if (event.target !== event.currentTarget) return;
            setQuickSwitcherOpen(false);
            setQuickSwitcherQuery("");
            setQuickSwitcherIndex(0);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }
        },
        /* @__PURE__ */ React.createElement("div", { className: "quick-switcher", role: "dialog", "aria-modal": "true", "aria-label": "Switch session" }, /* @__PURE__ */ React.createElement("div", { className: "quick-switcher-input-wrap" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\u2315"), /* @__PURE__ */ React.createElement(
          "input",
          {
            ref: quickSwitcherInputRef,
            className: "quick-switcher-input",
            value: quickSwitcherQuery,
            onChange: (event) => {
              setQuickSwitcherQuery(event.target.value);
              setQuickSwitcherIndex(0);
            },
            placeholder: "Search sessions, projects, or harnesses",
            "aria-label": "Search sessions",
            "aria-controls": "quick-switcher-results",
            "aria-activedescendant": quickSwitcherResults.length ? `quick-switcher-option-${quickSwitcherIndex}` : void 0,
            autoComplete: "off",
            spellCheck: "false"
          }
        ), /* @__PURE__ */ React.createElement("kbd", null, "Esc")), /* @__PURE__ */ React.createElement("div", { className: "quick-switcher-results", id: "quick-switcher-results", role: "listbox" }, quickSwitcherResults.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "quick-switcher-empty" }, "No matching sessions") : quickSwitcherResults.map((item, index) => /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            role: "option",
            id: `quick-switcher-option-${index}`,
            "aria-selected": index === quickSwitcherIndex,
            className: `quick-switcher-option${index === quickSwitcherIndex ? " selected" : ""}${item.id === activeSession ? " active" : ""}`,
            key: item.id,
            onMouseEnter: () => setQuickSwitcherIndex(index),
            onClick: () => {
              selectSession(item.id, item.session);
              setSidebarOpen(false);
              setQuickSwitcherOpen(false);
              setQuickSwitcherQuery("");
              setQuickSwitcherIndex(0);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }
          },
          /* @__PURE__ */ React.createElement("span", { className: "quick-switcher-dot", style: { background: item.agentColor } }),
          /* @__PURE__ */ React.createElement("span", { className: "quick-switcher-copy" }, /* @__PURE__ */ React.createElement("span", { className: "quick-switcher-title" }, item.title), /* @__PURE__ */ React.createElement("span", { className: "quick-switcher-meta" }, item.groupLabel, " \xB7 ", item.agentName, item.subtitle ? ` \xB7 ${item.subtitle}` : "")),
          item.id === activeSession && /* @__PURE__ */ React.createElement("span", { className: "quick-switcher-current" }, "Current")
        ))), /* @__PURE__ */ React.createElement("div", { className: "quick-switcher-footer" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("kbd", null, "\u2191"), /* @__PURE__ */ React.createElement("kbd", null, "\u2193"), " Navigate"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("kbd", null, "Enter"), " Switch"), /* @__PURE__ */ React.createElement("span", null, quickSwitcherResults.length, " of ", quickSwitcherItems.length)))
      ),
      shortcutHelpOpen && /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "shortcut-help-overlay",
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setShortcutHelpOpen(false);
          }
        },
        /* @__PURE__ */ React.createElement("div", { className: "shortcut-help", role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts" }, /* @__PURE__ */ React.createElement("div", { className: "shortcut-help-header" }, /* @__PURE__ */ React.createElement("strong", null, "Keyboard shortcuts"), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setShortcutHelpOpen(false), "aria-label": "Close keyboard shortcuts" }, "\xD7")), /* @__PURE__ */ React.createElement("div", { className: "shortcut-help-list" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "Switch session"), /* @__PURE__ */ React.createElement("kbd", null, "Ctrl/Cmd P")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "Previous / next session"), /* @__PURE__ */ React.createElement("kbd", null, "Alt \u2191 / \u2193")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "Focus composer"), /* @__PURE__ */ React.createElement("kbd", null, "Ctrl/Cmd K")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "Send / newline"), /* @__PURE__ */ React.createElement("kbd", null, "Enter / Shift Enter")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "Open / close this guide"), /* @__PURE__ */ React.createElement("kbd", null, "?"))), /* @__PURE__ */ React.createElement("div", { className: "shortcut-help-note" }, "Shortcuts never switch or submit while you are typing unless they include Ctrl/Cmd or Alt."))
      ),
      /* @__PURE__ */ React.createElement("div", { className: `overlay ${sidebarOpen ? "open" : ""}`, onClick: () => setSidebarOpen(false) }),
      hasSystemBanner && /* @__PURE__ */ React.createElement("div", { className: `duplicate-proxy-banner${recentAppUpdateValidation?.status === "pass" && duplicateProxyAlarms.length === 0 && visibleNightlyValidationFailures.length === 0 ? " app-update-pass" : ""}`, role: recentAppUpdateValidation?.status === "pass" && duplicateProxyAlarms.length === 0 && visibleNightlyValidationFailures.length === 0 ? "status" : "alert", ref: systemBannerRef }, duplicateProxyAlarms.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("strong", null, "Duplicate proxy detected."), /* @__PURE__ */ React.createElement("span", null, duplicateProxyAlarms.length, " session", duplicateProxyAlarms.length === 1 ? "" : "s", " claimed by multiple proxies. Stop the extra proxy to prevent conflicting controls.")), visibleNightlyValidationFailures.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("strong", null, "Nightly validation failed."), /* @__PURE__ */ React.createElement("span", null, visibleNightlyValidationFailures.map((item) => `${item.harness} (${item.app_version})`).join(", "), ". Check the validation ledger before using affected controls.")), recentAppUpdateValidation && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("strong", null, recentAppUpdateValidation.status === "pass" ? "App update validated." : "App update drift validation failed."), /* @__PURE__ */ React.createElement("span", null, recentAppUpdateValidation.harness, " ", recentAppUpdateValidation.previous_app_version, " -> ", recentAppUpdateValidation.app_version, ". ", recentAppUpdateValidation.status === "pass" ? "Harness controls remain available." : "A triage item was added to the maturity backlog."))),
      /* @__PURE__ */ React.createElement("div", { className: `sidebar ${sidebarOpen ? "open" : ""}` }, /* @__PURE__ */ React.createElement("div", { className: "sidebar-header" }, /* @__PURE__ */ React.createElement("span", { className: "logo" }, "\u232C"), /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }, "Agent Sessions"), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `new-session-btn notification-settings-btn${shortcutHelpOpen ? " active" : ""}`,
          title: "Keyboard shortcuts (?)",
          "aria-label": "Keyboard shortcuts",
          onClick: () => {
            setShortcutHelpOpen((open) => !open);
            setQuickSwitcherOpen(false);
          }
        },
        "?"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `new-session-btn notification-settings-btn${showNotificationSettings ? " active" : ""}`,
          title: "Notification settings",
          "aria-label": "Notification settings",
          onClick: () => {
            setShowNotificationSettings((open) => !open);
            setShowNewSession(false);
            setShowSessionManagement(false);
          }
        },
        "\u2662"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `new-session-btn notification-settings-btn${showSessionManagement ? " active" : ""}`,
          title: "Manage sessions",
          "aria-label": "Manage sessions",
          onClick: () => {
            setManagedSessionId(
              activeSession && (showTestSessions || !testSessionIds.has(activeSession)) ? activeSession : sessionIdOf3(sidebarManagedSessions[0]) || ""
            );
            setShowSessionManagement((open) => !open);
            setShowNewSession(false);
            setShowNotificationSettings(false);
          }
        },
        "\u22EF"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `new-session-btn${showNewSession ? " active" : ""}`,
          title: "New session",
          onClick: () => {
            setShowNewSession((o) => !o);
            setShowNotificationSettings(false);
            setShowSessionManagement(false);
          }
        },
        "+"
      )), /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `sidebar-order-control${sidebarOrderChanged ? " changed" : ""}`,
          "aria-hidden": !sidebarOrderChanged,
          "aria-live": "polite"
        },
        /* @__PURE__ */ React.createElement("span", null, "Order changed"),
        /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            onClick: applySidebarSortNow,
            disabled: !sidebarOrderChanged,
            tabIndex: sidebarOrderChanged ? 0 : -1
          },
          "Sort now"
        )
      ), showNotificationSettings && /* @__PURE__ */ React.createElement(
        NotificationSettingsPanel,
        {
          onClose: () => setShowNotificationSettings(false),
          onPreferencesChange: (next) => {
            setAttentionFeedbackPreferences({ ...next, turn_ready: false });
            setNotificationPreferencesLoaded(true);
          }
        }
      ), showSessionManagement && /* @__PURE__ */ React.createElement(
        SessionManagementPanel,
        {
          sessions: sidebarManagedSessions,
          preferences: sessionPreferences,
          initialSessionId: managedSessionId,
          onSave: saveSessionPreference,
          onExport: downloadSessionExport,
          onClose: () => setShowSessionManagement(false)
        }
      ), showNewSession && /* @__PURE__ */ React.createElement(
        NewSessionPanel,
        {
          launchStates,
          onLaunch: (agentType, workspacePath, options) => launchSession(agentType, workspacePath, options),
          onResume: (sourceSession, agentType, workspacePath, options) => resumeSession(sourceSession, agentType, workspacePath, options),
          onClose: () => setShowNewSession(false),
          workspaces,
          showTestSessions
        }
      ), /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "session-list",
          ref: sidebarListRef,
          onPointerDown: beginSidebarInteraction,
          onPointerUp: () => endSidebarInteraction(80),
          onPointerCancel: () => endSidebarInteraction(80),
          onScroll: () => {
            beginSidebarInteraction();
            endSidebarInteraction(180);
          }
        },
        orderedSessions.length === 0 && !showNewSession && /* @__PURE__ */ React.createElement("div", { className: "session-empty" }, "No agents connected"),
        workingSessions.length > 0 && /* @__PURE__ */ React.createElement("section", { className: "session-group working-session-group", "aria-label": "Working now" }, /* @__PURE__ */ React.createElement("div", { className: "session-group-header" }, /* @__PURE__ */ React.createElement("span", { className: "working-session-group-icon", "aria-hidden": "true" }, "W"), /* @__PURE__ */ React.createElement("span", { className: "session-group-name pinned-session-group-name" }, "Working now"), /* @__PURE__ */ React.createElement("span", { className: "session-group-status-slot" }, workingSessionSummary.hasPrompt && /* @__PURE__ */ React.createElement("span", { className: "session-group-alert", title: "Action required" }, "!"), /* @__PURE__ */ React.createElement("span", { className: "session-group-working", title: "Sessions working" }), workingSessionSummary.unread > 0 && /* @__PURE__ */ React.createElement("span", { className: "session-group-unread", title: `${workingSessionSummary.unread} unread` }, workingSessionSummary.unread > 99 ? "99+" : workingSessionSummary.unread), /* @__PURE__ */ React.createElement("span", { className: "session-group-count" }, workingSessions.length))), /* @__PURE__ */ React.createElement("div", { className: "session-group-items" }, /* @__PURE__ */ React.createElement("div", { className: "session-group-items-inner" }, workingSessions.map((session) => {
          const id = sessionIdOf3(session);
          return renderSidebarSessionCard(
            session,
            !!sessionPreferences[id]?.pinned,
            workspaceLabelBySessionId[id] || "Unscoped"
          );
        })))),
        pinnedSessions.length > 0 && /* @__PURE__ */ React.createElement("section", { className: "session-group pinned-session-group", "aria-label": "Pinned chats" }, /* @__PURE__ */ React.createElement("div", { className: "session-group-header" }, /* @__PURE__ */ React.createElement("span", { className: "session-group-pin-icon", "aria-hidden": "true" }, "\u{1F4CC}"), /* @__PURE__ */ React.createElement("span", { className: "session-group-name pinned-session-group-name" }, "Pinned chats"), /* @__PURE__ */ React.createElement("span", { className: "session-group-status-slot" }, pinnedSessionSummary.hasPrompt && /* @__PURE__ */ React.createElement("span", { className: "session-group-alert", title: "Action required" }, "!"), pinnedSessionSummary.working && /* @__PURE__ */ React.createElement("span", { className: "session-group-working", title: "Session working" }), pinnedSessionSummary.unread > 0 && /* @__PURE__ */ React.createElement("span", { className: "session-group-unread", title: `${pinnedSessionSummary.unread} unread` }, pinnedSessionSummary.unread > 99 ? "99+" : pinnedSessionSummary.unread), /* @__PURE__ */ React.createElement("span", { className: "session-group-count" }, pinnedSessions.length))), /* @__PURE__ */ React.createElement("div", { className: "session-group-items" }, /* @__PURE__ */ React.createElement("div", { className: "session-group-items-inner" }, pinnedSessions.map((session) => renderSidebarSessionCard(session, true))))),
        sessionGroups.map((group) => {
          const collapsed = !!collapsedSessionGroups[group.key];
          const summary = summarizeSidebarSessions(group.sessions);
          return /* @__PURE__ */ React.createElement("div", { className: `session-group${collapsed ? " collapsed" : ""}`, key: group.key }, /* @__PURE__ */ React.createElement("div", { className: "session-group-header" }, /* @__PURE__ */ React.createElement(
            "button",
            {
              type: "button",
              className: "session-group-toggle",
              title: `${collapsed ? "Expand" : "Collapse"} ${group.label}`,
              "aria-label": `${collapsed ? "Expand" : "Collapse"} ${group.label}`,
              "aria-expanded": !collapsed,
              onClick: () => toggleSessionGroup(group.key)
            },
            /* @__PURE__ */ React.createElement("span", { className: "session-group-caret", "aria-hidden": "true" }, collapsed ? ">" : "v")
          ), /* @__PURE__ */ React.createElement(
            FullTitleDisclosure,
            {
              title: group.label,
              disclosureKey: group.key,
              kind: "group",
              wrapperClassName: "session-group-title-details",
              triggerClassName: "session-group-name",
              disclosureClassName: "session-group-disclosure",
              triggerLabel: `Show full group name: ${group.label}`
            }
          ), /* @__PURE__ */ React.createElement("span", { className: "session-group-status-slot" }, summary.hasPrompt && /* @__PURE__ */ React.createElement("span", { className: "session-group-alert", title: "Action required" }, "!"), summary.working && /* @__PURE__ */ React.createElement("span", { className: "session-group-working", title: "Session working" }), summary.unread > 0 && /* @__PURE__ */ React.createElement("span", { className: "session-group-unread", title: `${summary.unread} unread` }, summary.unread > 99 ? "99+" : summary.unread), /* @__PURE__ */ React.createElement("span", { className: "session-group-count" }, group.sessions.length))), /* @__PURE__ */ React.createElement("div", { className: "session-group-items", "aria-hidden": collapsed }, /* @__PURE__ */ React.createElement("div", { className: "session-group-items-inner" }, group.sessions.map((session) => renderSidebarSessionCard(session, false)))));
        })
      ), /* @__PURE__ */ React.createElement("div", { className: "sidebar-footer" }, /* @__PURE__ */ React.createElement("span", { className: `status-dot ${relayHealthState}` }), /* @__PURE__ */ React.createElement("span", { className: "sidebar-footer-health" }, /* @__PURE__ */ React.createElement("span", null, connected ? `Relay ${relayHealthState}` : "Reconnecting\u2026"), /* @__PURE__ */ React.createElement("span", { className: "sidebar-footer-rtt" }, connected ? relayRttText.replace(/^\s*·\s*/, "") || "\xA0" : "\xA0")), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: `sidebar-footer-action test-session-toggle${showTestSessions ? " active" : ""}`,
          title: showTestSessions ? "Hide test sessions" : `Show test sessions (${testSessionIds.size})`,
          "aria-label": showTestSessions ? "Hide test sessions" : "Show test sessions",
          "aria-pressed": showTestSessions,
          onClick: () => setShowTestSessions((value) => !value)
        },
        "T",
        testSessionIds.size > 99 ? "99+" : testSessionIds.size || ""
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: `sidebar-footer-action${showUsageDashboard ? " active" : ""}`,
          title: "Usage and limits",
          "aria-label": "Usage and limits",
          onClick: () => {
            if (!showUsageDashboard) captureChatRouteScroll();
            setShowUsageDashboard((open) => !open);
            setShowHostResourceDashboard(false);
            setShowAutomations(false);
            setShowSkills(false);
            setShowNewSession(false);
            setShowNotificationSettings(false);
            setShowSessionManagement(false);
            setShowFleetView(false);
            setShowTranscriptSearch(false);
            setSidebarOpen(false);
          }
        },
        "\u25D4"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: `sidebar-footer-action host-resource-footer-action${showHostResourceDashboard ? " active" : ""}`,
          title: "Host resources",
          "aria-label": "Host resources",
          onClick: () => {
            if (!showHostResourceDashboard) captureChatRouteScroll();
            setShowHostResourceDashboard((open) => !open);
            setShowUsageDashboard(false);
            setShowFleetView(false);
            setShowAutomations(false);
            setShowSkills(false);
            setShowNewSession(false);
            setShowNotificationSettings(false);
            setShowSessionManagement(false);
            setShowTranscriptSearch(false);
            setSidebarOpen(false);
          }
        },
        "R"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: `sidebar-footer-action fleet-footer-action${showFleetView ? " active" : ""}`,
          title: "Fleet view",
          "aria-label": "Fleet view",
          onClick: () => {
            if (!showFleetView) captureChatRouteScroll();
            setShowFleetView((open) => !open);
            setShowUsageDashboard(false);
            setShowHostResourceDashboard(false);
            setShowAutomations(false);
            setShowSkills(false);
            setShowNewSession(false);
            setShowNotificationSettings(false);
            setShowSessionManagement(false);
            setShowTranscriptSearch(false);
            setSidebarOpen(false);
          }
        },
        "\u25A6"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: `sidebar-footer-action transcript-search-footer-action${showTranscriptSearch ? " active" : ""}`,
          title: "Search all transcripts",
          "aria-label": "Search all transcripts",
          onClick: () => {
            if (!showTranscriptSearch) captureChatRouteScroll();
            setShowTranscriptSearch((open) => !open);
            setShowFleetView(false);
            setShowUsageDashboard(false);
            setShowHostResourceDashboard(false);
            setShowAutomations(false);
            setShowSkills(false);
            setShowNewSession(false);
            setShowNotificationSettings(false);
            setShowSessionManagement(false);
            setSidebarOpen(false);
          }
        },
        "\u2315"
      ), /* @__PURE__ */ React.createElement("a", { href: "/agent-chat.apk", download: true, className: "apk-download-link", title: "Download Android APK" }, "\u2B07 APK"))),
      /* @__PURE__ */ React.createElement("div", { className: `main${showAutomations || showSkills || showUsageDashboard || showHostResourceDashboard || showFleetView || showTranscriptSearch ? " automations-active" : ""}` }, showAutomations && /* @__PURE__ */ React.createElement(
        AutomationsView,
        {
          sessions,
          onBack: () => setShowAutomations(false)
        }
      ), showSkills && /* @__PURE__ */ React.createElement(
        SkillsView,
        {
          skills: skillLists[activeSession] || null,
          onRefresh: () => activeSession && requestSkillList(activeSession),
          onBack: () => setShowSkills(false)
        }
      ), showScheduledSend && activeSession && /* @__PURE__ */ React.createElement(
        ScheduledSendPanel,
        {
          sessionId: activeSession,
          initialContent: currentInput,
          jobs: scheduledSends.filter((job) => job.session_id === activeSession),
          onSchedule: scheduleSend,
          onCancel: cancelScheduledSend,
          onCreated: () => setDraftForSession(activeSession, ""),
          onClose: () => setShowScheduledSend(false)
        }
      ), showUsageDashboard && /* @__PURE__ */ React.createElement(
        UsageDashboard,
        {
          usage: providerUsage,
          refreshReceipt: providerUsageRefreshReceipt,
          costDetail: providerUsageCostDetail,
          onBack: () => setShowUsageDashboard(false),
          onRefresh: requestProviderUsageRefresh,
          onRequestCostDetail: requestProviderUsageCostDetail
        }
      ), showHostResourceDashboard && /* @__PURE__ */ React.createElement(
        HostResourceDashboard,
        {
          snapshot: hostResources,
          error: hostResourceError,
          history: hostResourceHistory,
          details: hostResourceDetails,
          subscription: hostResourceSubscription,
          onBack: () => setShowHostResourceDashboard(false),
          onRefresh: requestHostResourceRefresh,
          onSubscribe: subscribeHostResources,
          onUnsubscribe: unsubscribeHostResources
        }
      ), showFleetView && /* @__PURE__ */ React.createElement(
        FleetView,
        {
          sessions: operatorOrderedSessions,
          activities,
          thinking,
          permissionPrompts,
          errorPrompts,
          messages,
          agentConfigs,
          sessionAttention,
          health,
          connected,
          deliveryStates,
          onBroadcastSend: sendToSession,
          onBack: () => setShowFleetView(false),
          onSelectSession: (sessionId, session) => {
            selectSession(sessionId, session);
            setShowFleetView(false);
          }
        }
      ), showTranscriptSearch && /* @__PURE__ */ React.createElement(
        TranscriptSearchView,
        {
          onBack: () => setShowTranscriptSearch(false),
          onOpenResult: openTranscriptSearchResult
        }
      ), !showAutomations && !showSkills && !showUsageDashboard && !showHostResourceDashboard && !showFleetView && !showTranscriptSearch && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "topbar" }, /* @__PURE__ */ React.createElement("button", { className: "hamburger", onClick: () => setSidebarOpen((o) => !o) }, "\u2630", unreadTotal > 0 && /* @__PURE__ */ React.createElement("span", { className: "hamburger-badge" }, unreadTotal), attentionTotal > 0 && /* @__PURE__ */ React.createElement("span", { className: "hamburger-attention", title: `${attentionTotal} session${attentionTotal === 1 ? "" : "s"} need attention`, "aria-label": `${attentionTotal} sessions need attention` }, "!")), /* @__PURE__ */ React.createElement("div", { className: "topbar-context" }, activeSession ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "topbar-title-row",
          role: "group",
          "aria-label": `${activeAgent.name} chat: ${activeChatTitle}`
        },
        /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "agent-badge topbar-agent-badge",
            style: { color: activeAgent.color, borderColor: activeAgent.color + "55", background: activeAgent.color + "18" }
          },
          activeAgent.logo ? /* @__PURE__ */ React.createElement("img", { src: activeAgent.logo, alt: activeAgent.abbr, className: "agent-badge-logo" }) : activeAgent.abbr
        ),
        /* @__PURE__ */ React.createElement("div", { className: "topbar-title-group", style: { color: activeAgent.color } }, /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "topbar-title-projection",
            "data-chat-title-source": activeChatTitleProjection.source,
            "data-chat-title-field": activeChatTitleProjection.field
          },
          /* @__PURE__ */ React.createElement(
            FullTitleDisclosure,
            {
              title: activeChatTitle,
              disclosureKey: `topbar-${activeSession}`,
              kind: "chat",
              wrapperClassName: "topbar-title-details",
              triggerClassName: "topbar-title",
              disclosureClassName: "topbar-title-disclosure",
              triggerLabel: `Show full chat title: ${activeChatTitle}`,
              triggerTag: "div"
            }
          )
        ), /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "topbar-subtitle",
            title: activeWorkspacePath || void 0
          },
          /* @__PURE__ */ React.createElement("span", { className: "topbar-workspace-icon" }, "\u2302"),
          activeWorkspaceContext,
          activeConfig?.branch && activeConfig.branch !== "unknown" && /* @__PURE__ */ React.createElement(
            "button",
            {
              className: `topbar-branch-btn${showBranchSelector ? " active" : ""}`,
              title: `Branch: ${activeConfig.branch}`,
              onClick: () => {
                const next = !showBranchSelector;
                setShowBranchSelector(next);
                if (next) requestBranchList(activeSession);
              }
            },
            /* @__PURE__ */ React.createElement("span", { className: "topbar-branch-icon" }, "\u2442"),
            activeConfig.branch
          )
        ))
      ), /* @__PURE__ */ React.createElement("div", { className: "topbar-meta" }, /* @__PURE__ */ React.createElement("button", { className: "theme-toggle-btn", onClick: () => setTheme((t) => t === "light" ? "dark" : "light"), title: "Toggle Light/Dark Mode" }, theme === "light" ? "\u{1F319}" : "\u2600\uFE0F"), /* @__PURE__ */ React.createElement(
        "span",
        {
          className: `context-pill ${connected ? "ok" : "warn"}`,
          title: connected ? "Relay connected" : "Relay disconnected \u2014 reconnecting"
        },
        connected ? "relay live" : "reconnecting"
      ), /* @__PURE__ */ React.createElement(
        "span",
        {
          className: `context-pill topbar-proxy-health ${activeHealth === "healthy" ? "ok" : activeHealth === "degraded" ? "warn" : activeHealth === "disconnected" ? "error" : ""}`,
          title: `Proxy: ${activeHealth || "connecting"}`
        },
        /* @__PURE__ */ React.createElement("span", { className: "topbar-health-dot" }),
        activeHealth === "healthy" ? "live" : activeHealth === "degraded" ? "degraded" : activeHealth === "disconnected" ? "offline" : "connecting"
      ), activeMachine && /* @__PURE__ */ React.createElement("span", { className: "context-pill", title: "Remote machine" }, activeMachine), activeHostLabel && /* @__PURE__ */ React.createElement("span", { className: "context-pill", title: "Native editor host" }, activeHostLabel), activeUsageSnapshot.hasSignal && /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: `context-pill usage-context-pill ${activeUsageSnapshot.state}`,
          title: activeUsageSnapshot.resetAt ? `Usage resets ${activeUsageSnapshot.resetAt}` : "Open usage and limits",
          onClick: () => {
            captureChatRouteScroll();
            setShowUsageDashboard(true);
            setShowHostResourceDashboard(false);
            setShowFleetView(false);
          }
        },
        activeUsageSnapshot.state === "exhausted" ? "limit reached" : `${activeUsageSnapshot.remainingPercent}% left`
      ), activeSessionMeta?.agent_type === "codex" && activeSessionMeta?.visible_pane_visible && /* @__PURE__ */ React.createElement(
        "span",
        {
          className: `context-pill ${activeCodexPaneLive ? "ok" : "warn"}`,
          title: activeCodexPaneLive ? "This Codex session is the visible right-hand pane" : `Visible right-hand pane is ${visiblePaneLabel}`
        },
        activeCodexPaneLive ? "right pane live" : `right pane: ${agentTypeLabel(activeSessionMeta.visible_pane_agent) || "other"}`
      ), currentMessages.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "context-pill", title: "Messages in this session" }, currentMessages.length, " msg", currentMessages.length !== 1 ? "s" : ""), (activeConfig?.capabilities?.chat_list || isAntigravityV2) && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `context-pill chat-list-toggle${(isAntigravityV2 ? agv2NavigatorOpen : showChatList) ? " active" : ""}`,
          title: isAntigravityV2 ? `${agv2NavigatorOpen ? "Hide" : "Show"} Agent Manager projects and conversations` : "View conversations",
          onClick: () => {
            if (isAntigravityV2) {
              setAgv2NavigatorOpen((open) => !open);
              setShowChatList(false);
              requestChatList(activeSession);
              return;
            }
            const next = !showChatList;
            setShowChatList(next);
            if (next) requestChatList(activeSession);
          }
        },
        isAntigravityV2 ? "projects" : "chats"
      ), activeConfig?.capabilities?.thread_list && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `context-pill chat-list-toggle${showThreadList ? " active" : ""}`,
          title: "View threads",
          onClick: () => {
            const next = !showThreadList;
            setShowThreadList(next);
            if (next) requestThreadList(activeSession);
          }
        },
        "threads"
      ), (activeConfig?.capabilities?.terminal_output || activeConfig?.capabilities?.terminal_input) && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `context-pill terminal-toggle${showTerminal ? " active" : ""}`,
          title: "Open terminal controls",
          onClick: () => {
            const next = !showTerminal;
            setShowTerminal(next);
            if (next && activeConfig?.capabilities?.terminal_output) requestTerminalOutput(activeSession);
          }
        },
        "terminal"
      ), activeConfig?.capabilities?.file_changes && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `context-pill diff-toggle${showDiffViewer ? " active" : ""}`,
          title: "View file changes",
          onClick: () => {
            const next = !showDiffViewer;
            setShowDiffViewer(next);
            if (next) requestFileChanges(activeSession);
          }
        },
        "changes"
      ), activeAutomationView?.visible && /* @__PURE__ */ React.createElement("span", { className: "context-pill ok", title: activeAutomationView.title || "Automation" }, "automation"), activeConfig?.capabilities?.file_browser && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: `context-pill files-toggle${showFileBrowser ? " active" : ""}`,
          title: "Browse workspace files",
          onClick: () => {
            const next = !showFileBrowser;
            setShowFileBrowser(next);
            if (next) {
              setViewingFile(null);
              setFileBrowserPath(".");
              requestDirectoryListing(activeSession, ".");
            }
          }
        },
        "files"
      ), activeConfig?.capabilities?.open_panel && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "context-pill open-panel-btn",
          title: "Open panel in Antigravity",
          onClick: () => openPanel(activeSession)
        },
        "open panel"
      ), activeConfig?.capabilities?.native_window && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "context-pill open-panel-btn",
          title: `Open this ${agentTypeLabel(activeSessionMeta?.agent_type) || "CLI"} session in a native command window`,
          onClick: () => openNativeWindow(activeSession)
        },
        "native"
      ), isActiveThinking && activeActivity?.label && activeActivity.label !== "Generating" && /* @__PURE__ */ React.createElement("span", { className: "context-pill thinking", title: activeActivity.label }, activeActivity.label.length > 40 ? activeActivity.label.substring(0, 40) + "\u2026" : activeActivity.label))) : /* @__PURE__ */ React.createElement("div", { className: "topbar-title-group" }, /* @__PURE__ */ React.createElement("div", { className: "topbar-title" }, "Agent Chat"), /* @__PURE__ */ React.createElement("div", { className: "topbar-subtitle" }, "Select a session to inspect its transcript and status")))), (activeSessionMeta?.agent_type === "cline" || activeSessionMeta?.agent_type === "roo_code") && activeContextCard && /* @__PURE__ */ React.createElement("div", { className: `cline-context-strip ${activeSessionMeta?.agent_type === "roo_code" ? "roo-context-strip" : ""}` }, /* @__PURE__ */ React.createElement(
        ClineContextCard,
        {
          card: activeContextCard,
          tone: activeSessionMeta?.agent_type === "roo_code" ? "roo" : "cline"
        }
      )), showBranchSelector && activeSession && activeConfig?.capabilities?.branch_list && /* @__PURE__ */ React.createElement(
        BranchSelectorPanel,
        {
          branchData: branchLists[activeSession] || null,
          sessionId: activeSession,
          currentBranch: activeConfig?.branch,
          onSwitch: (branchName) => {
            switchBranch(activeSession, branchName);
            setShowBranchSelector(false);
          },
          onCreate: (branchName) => {
            createBranch(activeSession, branchName);
            setShowBranchSelector(false);
          },
          onClose: () => setShowBranchSelector(false)
        }
      ), showFileBrowser && activeSession && activeConfig?.capabilities?.file_browser && /* @__PURE__ */ React.createElement(
        FileBrowser,
        {
          sessionId: activeSession,
          listing: directoryListings[activeSession],
          fileContents,
          viewingFile,
          onNavigate: (dirPath) => {
            setFileBrowserPath(dirPath);
            setViewingFile(null);
            requestDirectoryListing(activeSession, dirPath);
          },
          onOpenFile: (filePath) => {
            setViewingFile(filePath);
            requestFileContent(activeSession, filePath);
          },
          onBackToListing: () => setViewingFile(null),
          onRefresh: () => {
            if (viewingFile) {
              requestFileContent(activeSession, viewingFile);
            } else {
              requestDirectoryListing(activeSession, fileBrowserPath);
            }
          },
          onClose: () => {
            setShowFileBrowser(false);
            setViewingFile(null);
          }
        }
      ), /* @__PURE__ */ React.createElement("div", { className: `messages-wrap${activeAutomationView?.visible ? " has-automation-pane" : ""}`, style: showFileBrowser ? { display: "none" } : void 0 }, showDesktopThreadTabs && /* @__PURE__ */ React.createElement(
        ThreadTabsBar,
        {
          threads: desktopThreadTabs,
          activeThreadId: optimisticThreadFocus[activeSession] || null,
          showDraftTab: !!pendingDraftThreads[activeSession] || hasNativeDraftThread,
          newLabel: newThreadLabel,
          onSwitch: (threadId) => handleSwitchThread(activeSession, threadId),
          onNew: () => handleNewThread(activeSession),
          onOpenHistory: () => {
            requestThreadList(activeSession);
            setShowThreadList(true);
          }
        }
      ), showLastUserBanner && /* @__PURE__ */ React.createElement("div", { className: "last-user-banner", title: lastUserText }, /* @__PURE__ */ React.createElement("span", { className: "last-user-banner-icon" }, "\u21B5"), /* @__PURE__ */ React.createElement("span", { className: "last-user-banner-text" }, lastUserText)), showVisiblePaneBanner && /* @__PURE__ */ React.createElement("div", { className: "rate-limit-overlay warning" }, /* @__PURE__ */ React.createElement("span", { className: "rate-limit-icon" }, "\u2318"), /* @__PURE__ */ React.createElement("span", { className: "rate-limit-text" }, "The visible right-hand pane for this workspace is showing ", /* @__PURE__ */ React.createElement("strong", null, visiblePaneSummary || sessionSubLabel(visiblePaneSession, sessionIdOf3(visiblePaneSession))), ", not this transcript."), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "context-pill",
          onClick: () => selectSession(sessionIdOf3(visiblePaneSession), visiblePaneSession),
          title: "Switch to the live right-hand pane session"
        },
        "View live pane"
      )), showAntigravityV2Navigator && /* @__PURE__ */ React.createElement("div", { className: `agv2-session-nav${agv2NavigatorOpen ? "" : " collapsed"}` }, /* @__PURE__ */ React.createElement("div", { className: "agv2-session-nav-header" }, /* @__PURE__ */ React.createElement("div", { className: "agv2-session-nav-copy" }, /* @__PURE__ */ React.createElement("span", { className: "agv2-session-nav-title" }, "Agent Manager"), /* @__PURE__ */ React.createElement("span", { className: "agv2-session-nav-meta" }, activeV2ConversationCount, " conversation", activeV2ConversationCount === 1 ? "" : "s")), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "agv2-session-nav-btn",
          type: "button",
          onClick: () => requestChatList(activeSession),
          title: "Refresh Agent Manager conversations"
        },
        "Refresh"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "agv2-session-nav-btn",
          type: "button",
          onClick: () => {
            setAgv2NavigatorOpen((open) => !open);
            requestChatList(activeSession);
          },
          title: agv2NavigatorOpen ? "Hide Agent Manager conversations" : "Show Agent Manager conversations"
        },
        agv2NavigatorOpen ? "Hide" : "Show"
      )), agv2NavigatorOpen && /* @__PURE__ */ React.createElement(
        AntigravityV2NavPanel,
        {
          items: activeChatList,
          embedded: true,
          loading: !activeChatListLoaded,
          onNavigate: (itemId) => handleAntigravityV2Navigate(itemId),
          onNew: () => handleAntigravityV2New(activeSession)
        }
      )), showJumpButton && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "jump-to-newest",
          onClick: pinTranscriptToNewest
        },
        newMessagesBelow > 0 ? `\u2193 ${newMessagesBelow} new` : "\u2193 Jump to Newest"
      ), /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `messages harness-theme harness-theme-${safeString(activeSessionMeta?.agent_type || "default").replace(/[^a-z0-9_-]/gi, "-")}`,
          "data-agent-type": activeSessionMeta?.agent_type || "default",
          "data-layout": harnessLayoutForAgentType(activeSessionMeta?.agent_type),
          "data-transcript-windowed": transcriptWindow.enabled ? "true" : "false",
          "data-total-message-count": renderedMessages.length,
          "data-window-start": transcriptWindow.start,
          "data-window-end": transcriptWindow.end,
          key: activeTranscriptRenderKey,
          ref: messagesListRef
        },
        shouldBottomAlignMessages && /* @__PURE__ */ React.createElement("div", { className: "messages-flex-spacer" }),
        activePrompt && /* @__PURE__ */ React.createElement(
          PermissionOverlay,
          {
            prompt: activePrompt,
            sessionId: activeSession,
            agentType: activeSessionMeta?.agent_type,
            onRespond: respondToPrompt,
            onDismissFocus: () => textareaRef.current?.focus()
          }
        ),
        activeBlockingErrorPrompt && !activePrompt && /* @__PURE__ */ React.createElement(
          ErrorPromptOverlay,
          {
            prompt: activeBlockingErrorPrompt,
            sessionId: activeSession,
            onRespond: respondToErrorPrompt
          }
        ),
        (activeSessionMeta?.rate_limit_active || activeSessionMeta?.percent_used != null && activeSessionMeta.percent_used >= 80) && /* @__PURE__ */ React.createElement("div", { className: `rate-limit-overlay${activeSessionMeta?.rate_limit_active ? " critical" : activeSessionMeta?.percent_used >= 90 ? " critical" : activeSessionMeta?.percent_used >= 75 ? " warning" : ""}` }, /* @__PURE__ */ React.createElement("span", { className: "rate-limit-icon" }, activeSessionMeta?.rate_limit_active ? "\u23F3" : "\u{1F4CA}"), /* @__PURE__ */ React.createElement("span", { className: "rate-limit-text" }, activeSessionMeta?.rate_limit_active ? /* @__PURE__ */ React.createElement(React.Fragment, null, "Rate limited", activeSessionMeta.rate_limited_until && activeSessionMeta.rate_limited_until !== "unknown" ? /* @__PURE__ */ React.createElement(React.Fragment, null, " \u2014 resets in ", /* @__PURE__ */ React.createElement("strong", null, activeSessionMeta.rate_limited_until)) : null) : /* @__PURE__ */ React.createElement(React.Fragment, null, "Used ", /* @__PURE__ */ React.createElement("strong", null, activeSessionMeta.percent_used, "%"), " of session limit", activeSessionMeta.rate_limited_until && activeSessionMeta.rate_limited_until !== "unknown" ? /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 resets in ", /* @__PURE__ */ React.createElement("strong", null, activeSessionMeta.rate_limited_until)) : null))),
        showPartialHistoryBanner && /* @__PURE__ */ React.createElement("div", { className: "history-tail-banner" }, /* @__PURE__ */ React.createElement("span", null, "Showing latest ", partialHistoryLoaded.toLocaleString(), " of ", partialHistoryTotal.toLocaleString(), " messages"), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: loadOlderActiveHistory, disabled: !!activeHistoryLoading }, activeHistoryLoading ? "Loading older messages..." : "Load older messages")),
        !activeSession ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { className: "icon" }, "\u{1F916}"), /* @__PURE__ */ React.createElement("div", null, "Select an agent session")) : currentMessages.length === 0 && !activeProvisionalStream && hasThreadCap && activeSessionMeta?.is_list_view && threadLists[activeSession]?.length > 0 && !pendingDraftThreads[activeSession] && !hasNativeDraftThread ? /* @__PURE__ */ React.createElement("div", { className: "thread-picker-empty" }, /* @__PURE__ */ React.createElement("div", { className: "thread-picker-header" }, "Select a chat"), /* @__PURE__ */ React.createElement("div", { className: "thread-picker-list" }, threadLists[activeSession].map((thread, i) => /* @__PURE__ */ React.createElement(
          "button",
          {
            key: thread.cache_key || thread.id || i,
            className: `thread-picker-item${thread.active ? " active" : ""}`,
            onClick: () => {
              handleSwitchThread(activeSession, thread.id);
            },
            title: thread.title
          },
          /* @__PURE__ */ React.createElement("span", { className: "thread-picker-title" }, thread.title || "Untitled"),
          thread.age && /* @__PURE__ */ React.createElement("span", { className: "thread-picker-age" }, thread.age)
        ))), /* @__PURE__ */ React.createElement(
          "button",
          {
            className: "thread-picker-new",
            onClick: () => handleNewThread(activeSession)
          },
          "+ New Thread"
        )) : currentMessages.length === 0 && !activeProvisionalStream && isAntigravityV2 && activeSessionMeta?.is_list_view ? /* @__PURE__ */ React.createElement("div", { className: "thread-picker-empty agv2-picker-empty" }, /* @__PURE__ */ React.createElement("div", { className: "thread-picker-header" }, "Choose a conversation or start a new one"), agv2NavigatorOpen ? null : chatLists[activeSession]?.length > 0 ? /* @__PURE__ */ React.createElement(
          AntigravityV2NavPanel,
          {
            items: chatLists[activeSession] || [],
            embedded: true,
            loading: !activeChatListLoaded,
            onNavigate: (itemId) => handleAntigravityV2Navigate(itemId),
            onNew: () => handleAntigravityV2New(activeSession)
          }
        ) : /* @__PURE__ */ React.createElement("button", { className: "thread-picker-new", onClick: () => handleAntigravityV2New(activeSession) }, "+ New Conversation")) : currentMessages.length === 0 && !activeProvisionalStream && isAntigravityV2 && chatLists[activeSession]?.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "thread-picker-empty agv2-picker-empty" }, /* @__PURE__ */ React.createElement("div", { className: "thread-picker-header" }, "Select an Antigravity project or conversation"), !agv2NavigatorOpen && /* @__PURE__ */ React.createElement(
          AntigravityV2NavPanel,
          {
            items: chatLists[activeSession] || [],
            embedded: true,
            loading: !activeChatListLoaded,
            onNavigate: (itemId) => handleAntigravityV2Navigate(itemId),
            onNew: () => handleAntigravityV2New(activeSession)
          }
        )) : currentMessages.length === 0 && !activeProvisionalStream && activeSessionMeta?.is_list_view && chatLists[activeSession]?.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "thread-picker-empty" }, /* @__PURE__ */ React.createElement("div", { className: "thread-picker-header" }, "Select a conversation or type a new message"), /* @__PURE__ */ React.createElement("div", { className: "thread-picker-list" }, chatLists[activeSession].map((chat, i) => /* @__PURE__ */ React.createElement(
          "button",
          {
            key: chat.id || i,
            className: `thread-picker-item${chat.active ? " active" : ""}`,
            onClick: () => switchChat(activeSession, chat.id),
            title: chat.title
          },
          /* @__PURE__ */ React.createElement("span", { className: "thread-picker-title" }, chat.title || "Untitled")
        )))) : currentMessages.length === 0 && !activeProvisionalStream && activeHistoryMeta?.error ? /* @__PURE__ */ React.createElement("div", { className: "empty-state history-error-state" }, /* @__PURE__ */ React.createElement("div", { className: "icon" }, "\u26A0"), /* @__PURE__ */ React.createElement("div", null, activeHistoryMeta.error), /* @__PURE__ */ React.createElement("button", { type: "button", className: "thread-picker-new", onClick: retryActiveHistory }, "Retry transcript")) : currentMessages.length === 0 && !activeProvisionalStream && activeHistoryLoading ? /* @__PURE__ */ React.createElement("div", { className: "empty-state history-loading-state" }, /* @__PURE__ */ React.createElement("span", { className: "new-session-spinner" }), /* @__PURE__ */ React.createElement("div", null, activeHistoryLoading.mode === "older" ? "Loading older messages..." : "Loading latest messages...")) : currentMessages.length === 0 && !activeProvisionalStream ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { className: "icon" }, "\u{1F4AC}"), /* @__PURE__ */ React.createElement("div", null, "No messages yet")) : /* @__PURE__ */ React.createElement(React.Fragment, null, transcriptWindow.enabled && /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "transcript-window-spacer top",
            "data-testid": "transcript-window-top-spacer",
            style: { height: `${transcriptWindow.topSpacerHeight}px` }
          }
        ), renderedMessageNodes, transcriptWindow.enabled && /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "transcript-window-spacer bottom",
            "data-testid": "transcript-window-bottom-spacer",
            style: { height: `${transcriptWindow.bottomSpacerHeight}px` }
          }
        )),
        activeProvisionalStream && /* @__PURE__ */ React.createElement(
          ProvisionalStreamingBubble,
          {
            stream: activeProvisionalStream,
            activeAgent,
            monospace: assistantMonospace
          }
        ),
        showLiveAssistantDraft && /* @__PURE__ */ React.createElement(
          "div",
          {
            className: `message assistant live-draft${assistantMonospace ? " monospace" : ""}`,
            "data-message-role": "assistant",
            "data-message-timestamp": parseMessageInstant(activeActivity?.started_at || activeActivity?.updated_at)?.iso || "unknown"
          },
          /* @__PURE__ */ React.createElement("div", { className: "assistant-gutter" }, /* @__PURE__ */ React.createElement(
            "div",
            {
              className: "agent-badge transcript-agent-badge",
              style: { color: activeAgent.color, borderColor: activeAgent.color + "55", background: activeAgent.color + "18" }
            },
            activeAgent.logo ? /* @__PURE__ */ React.createElement("img", { src: activeAgent.logo, alt: activeAgent.abbr, className: "agent-badge-logo" }) : activeAgent.abbr
          )),
          /* @__PURE__ */ React.createElement("div", { className: "assistant-content" }, /* @__PURE__ */ React.createElement("div", { className: "message-role" }, /* @__PURE__ */ React.createElement("span", { className: "message-role-label" }, activeAgent.name), /* @__PURE__ */ React.createElement(MessageTimestamp, { instant: activeActivity?.started_at || activeActivity?.updated_at })), /* @__PURE__ */ React.createElement(MarkdownContent, { content: liveThinkingText, monospace: assistantMonospace, autoExpandLongCodeBlocks, onOpenPath: (path) => openTranscriptPreview("live-draft", path) }))
        ),
        activeInlineErrorPrompt && !activePrompt && /* @__PURE__ */ React.createElement(
          ErrorPromptInline,
          {
            prompt: activeInlineErrorPrompt,
            sessionId: activeSession,
            onRespond: respondToErrorPrompt
          }
        ),
        /* @__PURE__ */ React.createElement("div", { ref: messagesEndRef })
      ), /* @__PURE__ */ React.createElement(
        CodexAutomationPane,
        {
          view: activeAutomationView,
          onShow: () => activeSession && showCodexAutomation(activeSession)
        }
      )), (activeActivity?.task_list || showTranscriptFooterActivity) && !showFileBrowser && /* @__PURE__ */ React.createElement("div", { className: "transcript-live-footer", "data-testid": "transcript-live-footer" }, activeActivity?.task_list && !activeActivity?.step && /* @__PURE__ */ React.createElement("div", { className: "session-tasklist-strip" }, /* @__PURE__ */ React.createElement(TaskList, { taskList: activeActivity.task_list, sessionId: activeSession })), showTranscriptFooterActivity && /* @__PURE__ */ React.createElement("div", { className: "composer-live-status-strip" }, /* @__PURE__ */ React.createElement(
        ActivityRow,
        {
          activity: activeActivity,
          thinkingText: activeSession ? thinkingContent[activeSession] || "" : "",
          agentType: activeSessionMeta?.agent_type,
          pinned: true
        }
      ))), showSettings && activeSession && /* @__PURE__ */ React.createElement(
        AgentSettingsPanel,
        {
          session: activeSessionMeta || activeSession,
          config: activeConfig,
          configControlStates,
          onRequestRefresh: requestAgentConfig,
          onSetModel: (sid, modelId) => setAgentModel(sid, modelId),
          onSetEffort: (sid, effort) => setAgentEffort(sid, effort),
          onSetPermissionMode: (sid, mode) => setAgentPermissionMode(sid, mode),
          onSetAutoApprovePermissions: (sid, enabled) => setAutoApprovePermissions(sid, enabled),
          onSetMode: (sid, mode) => setAntigravityMode && setAntigravityMode(sid, mode),
          onSetCodexConfig: (updates) => setCodexConfig(activeSession, updates),
          onSwitchWorkspace: (sid, folderPath) => switchWorkspace(sid, folderPath),
          onClose: () => setShowSettings(false)
        }
      ), false, showChatList && activeSession && activeConfig?.capabilities?.chat_list && !isAntigravityV2 && /* @__PURE__ */ React.createElement(
        ChatListPanel,
        {
          chats: chatLists[activeSession] || [],
          sessionId: activeSession,
          onSwitch: (chatId) => {
            switchChat(activeSession, chatId);
            setShowChatList(false);
          },
          onNew: () => {
            newChat(activeSession);
            setShowChatList(false);
          },
          onClose: () => setShowChatList(false)
        }
      ), showThreadList && activeSession && activeConfig?.capabilities?.thread_list && /* @__PURE__ */ React.createElement(
        ThreadHistoryPanel,
        {
          threads: threadLists[activeSession] || [],
          sessionId: activeSession,
          newLabel: newThreadLabel,
          onSwitch: (threadId) => {
            handleSwitchThread(activeSession, threadId);
            setShowThreadList(false);
          },
          onNew: () => {
            handleNewThread(activeSession);
            setShowThreadList(false);
          },
          onClose: () => setShowThreadList(false)
        }
      ), !showFileBrowser && showTerminal && activeSession && (activeConfig?.capabilities?.terminal_output || activeConfig?.capabilities?.terminal_input) && /* @__PURE__ */ React.createElement(
        TerminalViewer,
        {
          entries: terminalOutputs[activeSession] || [],
          canRead: !!activeConfig?.capabilities?.terminal_output,
          canInput: !!activeConfig?.capabilities?.terminal_input,
          onRefresh: () => requestTerminalOutput(activeSession),
          onSend: (text) => sendTerminalInput(activeSession, text),
          controlResults,
          onClose: () => setShowTerminal(false)
        }
      ), !showFileBrowser && showDiffViewer && activeSession && activeConfig?.capabilities?.file_changes && /* @__PURE__ */ React.createElement(
        DiffViewer,
        {
          entries: fileChanges[activeSession] || [],
          onRefresh: () => requestFileChanges(activeSession),
          onAccept: (changeId) => respondToFileChange(activeSession, changeId, "accept"),
          onReject: (changeId) => respondToFileChange(activeSession, changeId, "reject"),
          onClose: () => setShowDiffViewer(false)
        }
      ), /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `input-area composer-skin-${composerSkinForAgentType(activeSessionMeta?.agent_type)}`,
          "data-composer-skin": composerSkinForAgentType(activeSessionMeta?.agent_type),
          style: showFileBrowser ? { display: "none" } : void 0
        },
        /* @__PURE__ */ React.createElement("label", { className: `attach-btn ${!activeSession || !connected || !!activeBlockingPrompt ? "disabled" : ""}`, title: "Attach file" }, /* @__PURE__ */ React.createElement("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" })), /* @__PURE__ */ React.createElement(
          "input",
          {
            type: "file",
            hidden: true,
            multiple: true,
            ref: fileInputRef,
            onChange: handleFileSelect,
            disabled: !activeSession || !connected || !!activeBlockingPrompt
          }
        )),
        /* @__PURE__ */ React.createElement("div", { className: "input-col" }, attachedFiles.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "file-chips" }, attachedFiles.map((f, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "file-chip" }, /* @__PURE__ */ React.createElement("span", null, "\u{1F4C4} ", f.name, f.isText ? "" : " (uploaded)"), /* @__PURE__ */ React.createElement("button", { onClick: () => removeDraftFile(activeSession, i) }, "\xD7")))), showSlashMenu && filteredSlashCommands.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "slash-menu" }, filteredSlashCommands.map((item) => /* @__PURE__ */ React.createElement(
          "button",
          {
            key: item.command,
            type: "button",
            className: "slash-item",
            onClick: () => applySlashCommand(item.command)
          },
          /* @__PURE__ */ React.createElement("span", { className: "slash-command" }, item.command),
          /* @__PURE__ */ React.createElement("span", { className: "slash-detail" }, item.detail)
        ))), activeSession && (queuedMessages[activeSession] || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "queued-bar" }, (queuedMessages[activeSession] || []).map((qm) => /* @__PURE__ */ React.createElement(
          QueuedItem,
          {
            key: qm.cid,
            qm,
            onSteer: () => steerMessage(activeSession, qm.cid, qm.content, qm.nativeIndex),
            onDiscard: () => discardQueuedMessage(activeSession, qm.cid),
            onEdit: (newContent) => editQueuedMessage(activeSession, qm.cid, newContent)
          }
        ))), /* @__PURE__ */ React.createElement("div", { className: "textarea-row" }, /* @__PURE__ */ React.createElement(
          "textarea",
          {
            ref: textareaRef,
            value: currentInput,
            onChange: (e) => updateInput(e.target.value),
            onKeyDown,
            onPaste: handlePaste,
            placeholder: activeBlockingPrompt ? `Resolve the ${activePrompt ? "permission prompt" : "error prompt"} above to continue` : activeSession ? window.innerWidth < 600 ? "Enter message\u2026" : "Message\u2026 (/ for commands)" : "Select a session",
            disabled: !activeSession || !!activeBlockingPrompt,
            rows: 1
          }
        ), /* @__PURE__ */ React.createElement("div", { className: "textarea-btns" }, activeSession && /* @__PURE__ */ React.createElement(
          "button",
          {
            className: `composer-gear-btn schedule-send-btn${showScheduledSend ? " active" : ""}`,
            onClick: () => setShowScheduledSend((open) => !open),
            title: "Schedule this message",
            "aria-label": "Schedule message"
          },
          "\u25F7"
        ), activeSession && /* @__PURE__ */ React.createElement(
          "button",
          {
            className: `composer-gear-btn${showComposerSettings ? " active" : ""}`,
            onClick: () => setShowComposerSettings((s) => !s),
            title: "Toggle settings"
          },
          "\u2699"
        ), canLaunchNewThread && /* @__PURE__ */ React.createElement(
          "button",
          {
            className: "composer-gear-btn mobile-hide",
            onClick: () => handleNewThread(activeSession),
            title: newThreadLabel
          },
          "\u270E"
        ), (activeConfig?.capabilities?.chat_list || isAntigravityV2) && /* @__PURE__ */ React.createElement(
          "button",
          {
            className: `composer-gear-btn mobile-hide${(isAntigravityV2 ? agv2NavigatorOpen : showChatList) ? " active" : ""}`,
            onClick: () => {
              if (isAntigravityV2) {
                setAgv2NavigatorOpen((open) => !open);
                setShowChatList(false);
                requestChatList(activeSession);
                return;
              }
              const willShow = !showChatList;
              setShowChatList(willShow);
              if (willShow) requestChatList(activeSession);
            },
            title: isAntigravityV2 ? "Agent Manager conversations" : "Chat history"
          },
          "\u2630"
        ), activeConfig?.capabilities?.thread_list && /* @__PURE__ */ React.createElement(
          "button",
          {
            className: `composer-gear-btn mobile-hide${showThreadList ? " active" : ""}`,
            onClick: () => {
              const willShow = !showThreadList;
              setShowThreadList(willShow);
              if (willShow) requestThreadList(activeSession);
            },
            title: "Thread history"
          },
          "\u229F"
        ), activeConfig?.capabilities?.open_panel && /* @__PURE__ */ React.createElement(
          "button",
          {
            className: "composer-gear-btn mobile-hide",
            onClick: () => openPanel(activeSession),
            title: "Open panel"
          },
          "\u229E"
        ), activeConfig?.capabilities?.native_window && /* @__PURE__ */ React.createElement(
          "button",
          {
            className: "composer-gear-btn mobile-hide",
            onClick: () => openNativeWindow(activeSession),
            title: "Open native command window"
          },
          "cmd"
        ), activeConfig?.capabilities?.new_chat && /* @__PURE__ */ React.createElement(
          "button",
          {
            className: "composer-gear-btn mobile-hide",
            onClick: () => isAntigravityV2 ? handleAntigravityV2New(activeSession) : newChat(activeSession),
            title: isAntigravityV2 ? "New Antigravity conversation" : "New chat"
          },
          "+"
        ), isActiveThinking ? /* @__PURE__ */ React.createElement(
          "button",
          {
            className: `stop-btn${isStopPending ? " pending" : ""}`,
            title: isStopPending ? "Interrupting\u2026" : "Interrupt agent",
            disabled: isStopPending,
            onClick: performInterrupt
          },
          isStopPending ? /* @__PURE__ */ React.createElement("span", { className: "stop-btn-spinner" }) : "\u25A0"
        ) : /* @__PURE__ */ React.createElement("button", { className: "send-btn", onClick: sendMessage, disabled: !canSend, title: connected ? "Send" : "Queue until reconnected" }, uploading ? "\u2026" : "\u2191"))), /* @__PURE__ */ React.createElement("div", { className: "composer-meta" }, interruptConfirmSession === activeSession && isActiveThinking && !isStopPending && /* @__PURE__ */ React.createElement("span", { className: "interrupt-confirm-inline", role: "status", "aria-live": "polite" }, "Press Esc again or Enter to interrupt"), (isContinueLikeAgentType(activeSessionMeta?.agent_type) || isClineLikeAgentType(activeSessionMeta?.agent_type)) && activeConfig?.mode && activeConfig.mode !== "unknown" && /* @__PURE__ */ React.createElement("span", { className: "composer-hint", style: { color: "#d29922" } }, activeConfig.mode), (isContinueLikeAgentType(activeSessionMeta?.agent_type) || isClineLikeAgentType(activeSessionMeta?.agent_type)) && activeConfig?.model_id && activeConfig.model_id !== "unknown" && /* @__PURE__ */ React.createElement("span", { className: "composer-hint", style: { color: "#d29922" } }, activeConfig.model_id), activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" && /* @__PURE__ */ React.createElement("span", { className: "composer-hint", style: { color: "#8b949e" } }, "Observed ", activeConfig.observed_model_id || "unknown", " / ", activeConfig.observed_effort || "unknown", " \xB7 ", "Next ", activeConfig.next_send_model_id || "unset", " / ", activeConfig.next_send_effort || "unset"), activeSessionMeta?.agent_type === "antigravity-v2" && activeConfig?.model_id && activeConfig.model_id !== "unknown" && /* @__PURE__ */ React.createElement("span", { className: "composer-hint", style: { color: "#8b949e" } }, activeConfig.model_id), (activeSessionMeta?.agent_type === "antigravity" || activeSessionMeta?.agent_type === "antigravity_panel") && (Array.isArray(activeSessionMeta?.antigravity_quota_models) && activeSessionMeta.antigravity_quota_models.length > 0 ? /* @__PURE__ */ React.createElement("span", { className: "composer-hint", style: { color: "#8b949e" } }, formatAntigravityQuotaSummary(activeSessionMeta.antigravity_quota_models, 4)) : activeSessionMeta?.percent_used != null ? /* @__PURE__ */ React.createElement("span", { className: "composer-hint", style: { color: activeSessionMeta.percent_used >= 90 ? "#f85149" : activeSessionMeta.percent_used >= 75 ? "#d29922" : "#8b949e" } }, "Quota ", activeSessionMeta.percent_used, "%", activeSessionMeta?.rate_limited_until && activeSessionMeta.rate_limited_until !== "unknown" ? ` \xB7 ${activeSessionMeta.rate_limited_until}` : "") : null), /* @__PURE__ */ React.createElement("span", { className: "composer-hint" }, "Enter send"), /* @__PURE__ */ React.createElement("span", { className: "composer-hint" }, "Shift+Enter newline"), /* @__PURE__ */ React.createElement("span", { className: "composer-hint" }, "Ctrl/Cmd+K focus"), /* @__PURE__ */ React.createElement("span", { className: "composer-hint" }, "/ commands"), /* @__PURE__ */ React.createElement("span", { className: "composer-hint" }, "Ctrl+V image"), activeSession && currentInput && /* @__PURE__ */ React.createElement("span", { className: "composer-hint draft-live" }, "draft saved")), activeSession && /* @__PURE__ */ React.createElement("div", { className: `composer-settings${showComposerSettings ? " is-open" : ""}` }, (activePendingConfigControl || activeFailedConfigControl) && /* @__PURE__ */ React.createElement("div", { className: `composer-control-state ${activeFailedConfigControl ? "failed" : "pending"}`, role: "status" }, activeFailedConfigControl ? activeFailedConfigControl.error : `Saving ${activePendingConfigControl.field.replace(/_/g, " ")}\u2026`), (activeConfig?.capabilities?.set_model || activeSessionMeta?.agent_type === "antigravity" || activeSessionMeta?.agent_type === "antigravity_panel") && /* @__PURE__ */ React.createElement(React.Fragment, null, activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" && /* @__PURE__ */ React.createElement("span", { className: "composer-setting-label", "data-control": "observed-model" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, "Observed model"), /* @__PURE__ */ React.createElement("span", { className: "composer-hint" }, activeConfig.observed_model_id || "unknown")), /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "model" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" ? "Next model" : "Model"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" ? activeConfig.next_send_model_id || "" : activeConfig?.model_id || "default",
            onChange: (e) => setAgentModel(activeSession, e.target.value)
          },
          activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" && /* @__PURE__ */ React.createElement("option", { value: "", disabled: true }, "Choose model\u2026"),
          composerModelOptionsFor(activeSessionMeta?.agent_type, activeConfig).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label)),
          !composerModelOptionsFor(activeSessionMeta?.agent_type, activeConfig).some((m) => m.id === activeConfig.model_id) && activeConfig?.model_id && activeConfig.model_id !== "unknown" && activeConfig?.config_semantics !== "observed_and_next_send" && /* @__PURE__ */ React.createElement("option", { value: activeConfig.model_id }, activeConfig.model_id)
        ), activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" && /* @__PURE__ */ React.createElement("span", { className: "composer-hint" }, activeConfig.next_send_model_status || "unset"))), (activeSessionMeta?.agent_type === "antigravity" || activeSessionMeta?.agent_type === "antigravity_panel") && /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "mode" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, "Mode"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: activeConfig?.conversation_mode || "Planning",
            onChange: (e) => setAntigravityMode(activeSession, e.target.value)
          },
          ANTIGRAVITY_MODES.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
        )), (isClineLikeAgentType(activeSessionMeta?.agent_type) || activeSessionMeta?.agent_type === "cursor") && activeConfig?.capabilities?.set_mode && modeOptionsFor(activeSessionMeta?.agent_type, activeConfig).length > 0 && /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "mode" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, "Mode"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: activeConfig?.mode || modeOptionsFor(activeSessionMeta?.agent_type, activeConfig)[0]?.id || "unknown",
            onChange: (e) => setAntigravityMode(activeSession, e.target.value)
          },
          modeOptionsFor(activeSessionMeta?.agent_type, activeConfig).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label)),
          activeConfig?.mode && activeConfig.mode !== "unknown" && !modeOptionsFor(activeSessionMeta?.agent_type, activeConfig).some((m) => m.id === activeConfig.mode) && /* @__PURE__ */ React.createElement("option", { value: activeConfig.mode }, activeConfig.mode)
        )), activeConfig?.capabilities?.permission_mode_change && /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "permission" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, activeSessionMeta?.agent_type === "codex_cli" ? "Access" : "Permission"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: activeConfig.permission_mode || defaultPermissionModeFor(activeSessionMeta?.agent_type),
            onChange: (e) => setAgentPermissionMode(activeSession, e.target.value),
            title: "Permission mode"
          },
          permissionModeOptionsFor(activeSessionMeta?.agent_type || "claude", activeConfig).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.value, value: m.value }, m.label)),
          activeConfig.permission_mode && !permissionModeOptionsFor(activeSessionMeta?.agent_type, activeConfig).some((m) => m.value === activeConfig.permission_mode) && activeConfig.permission_mode !== "unknown" && /* @__PURE__ */ React.createElement("option", { value: activeConfig.permission_mode }, activeConfig.permission_mode)
        )), (activeSessionMeta?.agent_type === "claude_cli" || activeSessionMeta?.agent_type === "codex_cli" || activeSessionMeta?.agent_type === "cursor_cli") && activeConfig?.capabilities?.set_effort && (activeConfig.available_efforts || []).length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" && /* @__PURE__ */ React.createElement("span", { className: "composer-setting-label", "data-control": "observed-effort" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, "Observed effort"), /* @__PURE__ */ React.createElement("span", { className: "composer-hint" }, activeConfig.observed_effort || "unknown")), /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "effort" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" ? "Next effort" : "Effort"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" ? activeConfig.next_send_effort || "" : activeConfig.effort || "medium",
            onChange: (e) => setAgentEffort(activeSession, e.target.value),
            title: `${activeSessionMeta?.agent_type === "codex_cli" ? "Codex" : activeSessionMeta?.agent_type === "cursor_cli" ? "Cursor" : "Claude"} CLI effort`
          },
          activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" && /* @__PURE__ */ React.createElement("option", { value: "", disabled: true }, "Choose effort\u2026"),
          (activeConfig.available_efforts || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
        ), activeSessionMeta?.agent_type === "codex_cli" && activeConfig?.config_semantics === "observed_and_next_send" && /* @__PURE__ */ React.createElement("span", { className: "composer-hint" }, activeConfig.next_send_effort_status || "unset"))), activeConfig?.capabilities?.auto_approve_permissions_toggle && /* @__PURE__ */ React.createElement("label", { className: "composer-setting-toggle", title: "Automatically approve permission prompts for this session" }, /* @__PURE__ */ React.createElement(
          "input",
          {
            type: "checkbox",
            checked: typeof activeConfig?.auto_approve_permissions === "boolean" ? activeConfig.auto_approve_permissions : !!activeSessionMeta?.auto_approve_permissions,
            onChange: (e) => setAutoApprovePermissions(activeSession, e.target.checked)
          }
        ), /* @__PURE__ */ React.createElement("span", null, "Auto-approve prompts")), activeConfig?.capabilities?.set_codex_config && /* @__PURE__ */ React.createElement(React.Fragment, null, activeConfig?.capabilities?.codex_model_change && /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "model" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, activeSessionMeta?.agent_type === "codex" ? "Next model" : "Model"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: activeConfig.model_id || "unknown",
            disabled: activeSessionMeta?.agent_type === "codex" && activeConfig.controls_available === false || ["pending", "awaiting_config"].includes(configControlStates?.[`${activeSession}:model`]?.status),
            onChange: (e) => setCodexConfig(activeSession, { model_id: e.target.value }),
            title: activeSessionMeta?.agent_type === "codex" ? "Next-turn Codex model" : "Codex Desktop model"
          },
          (activeConfig.available_models || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label)),
          activeConfig.model_id && !(activeConfig.available_models || []).some((m) => m.id === activeConfig.model_id) && activeConfig.model_id !== "unknown" && /* @__PURE__ */ React.createElement("option", { value: activeConfig.model_id }, activeConfig.model_id)
        )), activeConfig?.capabilities?.codex_effort_change && /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "effort" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, activeSessionMeta?.agent_type === "codex" ? "Next effort" : "Effort"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: (activeConfig.effort || "unknown").toLowerCase(),
            disabled: activeSessionMeta?.agent_type === "codex" && activeConfig.controls_available === false || ["pending", "awaiting_config"].includes(configControlStates?.[`${activeSession}:effort`]?.status),
            onChange: (e) => setCodexConfig(activeSession, { effort: e.target.value }),
            title: activeSessionMeta?.agent_type === "codex" ? "Next-turn reasoning effort" : "Codex Desktop reasoning effort"
          },
          (activeConfig.available_efforts || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label))
        )), activeConfig?.capabilities?.codex_permission_profile_change && /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "permission-profile" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, "Next permissions"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: activeConfig.permission_profile || "unknown",
            disabled: activeConfig.controls_available === false || ["pending", "awaiting_config"].includes(configControlStates?.[`${activeSession}:permission_profile`]?.status),
            onChange: (e) => setCodexConfig(activeSession, { permission_profile: e.target.value }),
            title: "Next-turn native Codex permissions profile"
          },
          activeConfig.permission_profile === "full-access" && /* @__PURE__ */ React.createElement("option", { value: "full-access", disabled: true }, "Full access"),
          (activeConfig.available_permission_profiles || []).filter((profile) => profile.id !== "full-access").map((profile) => /* @__PURE__ */ React.createElement("option", { key: profile.id, value: profile.id }, profile.label))
        )), activeConfig?.capabilities?.codex_bypass_permissions && /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            className: "composer-desktop-action composer-bypass-action",
            onClick: () => {
              setShowSettings(true);
              setShowComposerSettings(false);
            },
            title: "Review and confirm Full access in Session Settings"
          },
          activeConfig.bypass_permissions_active ? "Bypass active" : "Bypass\u2026"
        ), activeConfig?.capabilities?.codex_speed_change && /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "speed" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, "Speed"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: (activeConfig.speed || "standard").toLowerCase(),
            onChange: (e) => setCodexConfig(activeSession, { speed: e.target.value }),
            title: "Speed"
          },
          (activeConfig.available_speeds || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label)),
          activeConfig.speed && !(activeConfig.available_speeds || []).some((m) => m.id === activeConfig.speed) && activeConfig.speed !== "unknown" && /* @__PURE__ */ React.createElement("option", { value: activeConfig.speed }, activeConfig.speed)
        )), activeConfig?.capabilities?.codex_access_change && /* @__PURE__ */ React.createElement("label", { className: "composer-setting-label", "data-control": "permission" }, /* @__PURE__ */ React.createElement("span", { className: "composer-setting-key" }, "Access"), /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: activeConfig.permission_mode || "unknown",
            onChange: (e) => setCodexConfig(activeSession, { access_mode: e.target.value }),
            title: "Codex Desktop access mode"
          },
          (activeConfig.available_access || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, m.label)),
          activeConfig.permission_mode && !(activeConfig.available_access || []).some((m) => m.id === activeConfig.permission_mode) && activeConfig.permission_mode !== "unknown" && /* @__PURE__ */ React.createElement("option", { value: activeConfig.permission_mode }, activeConfig.permission_mode)
        )), activeSessionMeta?.agent_type === "codex-desktop" && (activeConfig.available_workspaces || []).length > 0 && /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "composer-setting-select",
            value: activeConfig.file_access_scope || "",
            onChange: (e) => switchWorkspace(activeSession, e.target.value),
            title: "Switch workspace"
          },
          (activeConfig.available_workspaces || []).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.path || m.id }, m.label))
        )), activeWorkspacePath && /* @__PURE__ */ React.createElement("span", { className: "composer-workspace", title: activeWorkspacePath }, "\u2302 ", activeWorkspaceBasename || activeWorkspacePath), /* @__PURE__ */ React.createElement(
          "button",
          {
            className: "composer-desktop-action",
            onClick: () => {
              setShowSettings(true);
              setShowComposerSettings(false);
            }
          },
          "\u2699 Session details"
        ), /* @__PURE__ */ React.createElement("div", { className: "composer-mobile-actions" }, /* @__PURE__ */ React.createElement(
          "button",
          {
            className: "composer-mobile-action",
            onClick: () => {
              setShowSettings(true);
              setShowComposerSettings(false);
            }
          },
          "\u2699 Session details"
        ), canLaunchNewThread && /* @__PURE__ */ React.createElement("button", { className: "composer-mobile-action", onClick: () => newThread(activeSession) }, "\u270E New thread"), (activeConfig?.capabilities?.chat_list || isAntigravityV2) && /* @__PURE__ */ React.createElement("button", { className: "composer-mobile-action", onClick: () => {
          requestChatList(activeSession);
          if (isAntigravityV2) {
            setAgv2NavigatorOpen(true);
            setShowChatList(false);
          } else {
            setShowChatList(true);
          }
          setShowComposerSettings(false);
        } }, "\u2630 ", isAntigravityV2 ? "Projects" : "Chat history"), activeConfig?.capabilities?.thread_list && /* @__PURE__ */ React.createElement("button", { className: "composer-mobile-action", onClick: () => {
          requestThreadList(activeSession);
          setShowThreadList(true);
          setShowComposerSettings(false);
        } }, "\u229F Threads"), activeConfig?.capabilities?.open_panel && /* @__PURE__ */ React.createElement("button", { className: "composer-mobile-action", onClick: () => openPanel(activeSession) }, "\u229E Open panel"), activeConfig?.capabilities?.new_chat && /* @__PURE__ */ React.createElement("button", { className: "composer-mobile-action", onClick: () => isAntigravityV2 ? handleAntigravityV2New(activeSession) : newChat(activeSession) }, "+ New chat"))))
      ))),
      attentionToast && /* @__PURE__ */ React.createElement("div", { className: "attention-toast", role: "status", "aria-live": "polite" }, /* @__PURE__ */ React.createElement("span", { className: `attention-toast-icon ${attentionToast.kind}`, "aria-hidden": "true" }, attentionToast.kind === "prompt" || attentionToast.kind === "goal_attention" ? "!" : "\u2713"), /* @__PURE__ */ React.createElement("span", { className: "attention-toast-copy" }, /* @__PURE__ */ React.createElement("strong", null, attentionToast.title), /* @__PURE__ */ React.createElement("span", null, attentionToast.detail)), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            const session = orderedSessions.find((item) => sessionIdOf3(item) === attentionToast.sessionId);
            if (session) selectSession(attentionToast.sessionId, session);
            clearAttentionToast();
          }
        },
        "Jump"
      )),
      /* @__PURE__ */ React.createElement("div", { className: `toast ${toast ? "visible" : ""}` }, toast)
    );
  }
  var renderProfileEnabled = (() => {
    try {
      return new URLSearchParams(window.location.search).get("render_profile") === "1";
    } catch {
      return false;
    }
  })();
  function recordRenderProfile(id, phase, actualDuration, baseDuration, startTime, commitTime) {
    const entries = window.__RAC_RENDER_PROFILER__ || (window.__RAC_RENDER_PROFILER__ = []);
    entries.push({
      id,
      phase,
      route: document.querySelector('[data-testid="fleet-view"]') ? "fleet" : document.querySelector('[data-testid="usage-dashboard"]') ? "usage" : document.querySelector('[data-testid="host-resource-dashboard"]') ? "host-resources" : document.querySelector(".messages") ? "chat" : "other",
      actual_duration_ms: Number(actualDuration.toFixed(3)),
      base_duration_ms: Number(baseDuration.toFixed(3)),
      start_time_ms: Number(startTime.toFixed(3)),
      commit_time_ms: Number(commitTime.toFixed(3))
    });
    if (entries.length > 2e3) entries.splice(0, entries.length - 2e3);
  }
  var appRoot = /* @__PURE__ */ React.createElement(AppErrorBoundary, null, /* @__PURE__ */ React.createElement(App, null));
  ReactDOM.createRoot(document.getElementById("root")).render(
    renderProfileEnabled ? /* @__PURE__ */ React.createElement(React.Profiler, { id: "AgentChatRoot", onRender: recordRenderProfile }, appRoot) : appRoot
  );

  // frontend/init.js
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function() {
      navigator.serviceWorker.register("/sw.js").catch(function(err) {
        console.warn("SW registration failed:", err);
      });
    });
  }
  if (window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches) {
    document.body.classList.add("pwa-standalone");
  }
})();
