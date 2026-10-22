/*
 * Tasks Enhancer
 * 1) 排序：按完成时间整理当前笔记中的任务（未完成任务置顶/置底，支持非任务内容置顶、分组标题、选区排序）
 * 2) 转为任务：把选中的多行一键加上任务前缀
 * 3) 一键整理：把散落各处的任务归档到 Tasks 目录下的日期文件，未完成任务顺延到下一天
 * 免构建，修改本文件后重启 Obsidian 即可生效。
 */
"use strict";

const { Plugin, PluginSettingTab, Setting, Notice, Menu, Modal, MarkdownView, addIcon } = require("obsidian");

// 图标：一个主图标 + 各功能图标（lucide 风格，24x24，描边用 currentColor 以适配主题）
const ICON_MAIN = "tasks-enhancer"; // 清单 + 勾选：任务增强
const ICON_SORT = "tasks-enhancer-sort"; // 上下箭头：排序
const ICON_ARCHIVE = "tasks-enhancer-archive"; // 归档箱：一键整理
const ICON_CONVERT = "tasks-enhancer-convert"; // 清单 + 加号：转为任务
const ICON_LIFT = "tasks-enhancer-lift"; // 向上箭头：非任务内容置顶

const SVG_OPEN =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
	'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

const ICONS = {
	// list-checks
	[ICON_MAIN]:
		SVG_OPEN +
		'<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>' +
		'<path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>',
	// arrow-down-up
	[ICON_SORT]:
		SVG_OPEN +
		'<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/>' +
		'<path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>',
	// archive
	[ICON_ARCHIVE]:
		SVG_OPEN +
		'<rect x="2" y="3" width="20" height="5" rx="1"/>' +
		'<path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>',
	// list-plus
	[ICON_CONVERT]:
		SVG_OPEN +
		'<path d="M16 6H3"/><path d="M11 12H3"/><path d="M16 18H3"/>' +
		'<path d="M18 9v6"/><path d="M21 12h-6"/></svg>',
	// arrow-up-to-line
	[ICON_LIFT]: SVG_OPEN + '<path d="M5 3h14"/><path d="M12 21V7"/><path d="m5 14 7-7 7 7"/></svg>'
};

// 排序范围
const SCOPE_BLOCK = "block";
const SCOPE_FILE = "file";
// 非任务内容位置
const NON_TASK_KEEP = "keep";
const NON_TASK_TOP = "top";
// 分组标题
const HEADINGS_OFF = "off";
const HEADINGS_FILE = "file";
const HEADINGS_BLOCK = "block";
// 自动排序时机
const AUTO_OFF = "off";
const AUTO_SAVE = "onSave";
const AUTO_IDLE = "onIdle";
// 整理范围
const ARCHIVE_FILE = "file";
const ARCHIVE_FOLDER = "folder";
const ARCHIVE_VAULT = "vault";
// 整理方式
const ARCHIVE_MOVE = "move";
const ARCHIVE_COPY = "copy";
// 未完成任务去向
const UNFINISHED_NEXT = "next"; // 基准日 + 1 天的日期文件
const UNFINISHED_CUSTOM = "custom"; // 指定的固定文件
const UNFINISHED_KEEP = "keep"; // 留在原文件

const DEFAULT_SETTINGS = {
	// —— 排序结果 ——
	scope: SCOPE_BLOCK,
	unfinished: "top",
	unfinishedKey: "none",
	doneKey: "done-asc",
	splitCancelled: false,
	noTimeLast: false,
	nonTask: NON_TASK_KEEP,
	// —— 分组标题 ——
	groupHeadings: HEADINGS_OFF,
	headingTodo: "## 待办",
	headingDone: "## 已完成",
	headingCancelled: "## 已取消",
	// —— 触发方式 ——
	selectionOnly: true,
	autoSort: AUTO_OFF,
	autoFolder: "",
	idleSeconds: 10,
	// —— 转为任务 ——
	taskPrefix: "- [ ] ",
	convertSkipBlank: true,
	convertSkipExisting: true,
	convertSkipFence: true,
	// —— 任务整理 ——
	archiveFolder: "Tasks",
	archiveFileFormat: "YYYY-MM-DD",
	archiveScope: ARCHIVE_FILE,
	archiveSourceFolder: "diary",
	archiveIncludeSubfolders: true,
	archiveDateFrom: "",
	archiveDateTo: "",
	archiveBaseDate: "",
	archiveUnfinishedTarget: UNFINISHED_NEXT,
	archiveUnfinishedPath: "",
	archiveMode: ARCHIVE_MOVE,
	archiveNoTimeDone: "base",
	archiveExcludeTasksFolder: false,
	archiveRemoveEmptyTasks: true,
	archiveSkipDuplicates: false,
	archiveDeleteEmptySource: false,
	archiveGroupHeadings: false,
	archiveConfirm: true,
	// —— 其他 ——
	showNotice: true
};

/* ------------------------------------------------------------------ *
 * 通用工具
 * ------------------------------------------------------------------ */

function splitLines(text) {
	return String(text || "").split(/\r\n|\r|\n/);
}

function detectEol(text) {
	return String(text || "").indexOf("\r\n") >= 0 ? "\r\n" : "\n";
}

function pad2(value) {
	return String(value).padStart(2, "0");
}

function formatDate(date) {
	return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

function todayIso() {
	return formatDate(new Date());
}

function addDays(isoDate, days) {
	const parts = String(isoDate || "").split("-").map(Number);
	if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return todayIso();
	return formatDate(new Date(parts[0], parts[1] - 1, parts[2] + days));
}

// timeKey（YYYYMMDDHHMMSS 数字）→ 日期部分 "YYYY-MM-DD"
function isoFromTimeKey(timeKey) {
	const day = Math.floor(timeKey / 1e6);
	const y = Math.floor(day / 10000);
	const m = Math.floor((day % 10000) / 100);
	const d = day % 100;
	return y + "-" + pad2(m) + "-" + pad2(d);
}

function joinPath(folder, name) {
	const base = String(folder || "").replace(/^\/+|\/+$/g, "");
	return base ? base + "/" + name : name;
}

function normalizeFolder(path) {
	return String(path || "").replace(/^\/+|\/+$/g, "");
}

// 归档文件名：支持 YYYY / MM / DD 占位符，始终保证 .md 后缀
function formatArchiveFileName(format, isoDate) {
	const parts = String(isoDate || "").split("-");
	const tokens = { YYYY: parts[0] || "", MM: parts[1] || "", DD: parts[2] || "" };
	let name = String(format || "YYYY-MM-DD")
		.replace(/YYYY/g, tokens.YYYY)
		.replace(/MM/g, tokens.MM)
		.replace(/DD/g, tokens.DD);
	if (!/\.md$/i.test(name)) name += ".md";
	return name;
}

/* ------------------------------------------------------------------ *
 * 解析层
 * ------------------------------------------------------------------ */

// 只在行首识别任务：`- [x] xxx` / `* [ ] xxx` / `1. [/] xxx`
const TASK_LINE_RE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\[(.)\][ \t]*(.*)$/;
const FENCE_RE = /^[ \t]*(```|~~~)/;
const DONE_MARKER_CHARS = "✅❌✔✓☑";
const KEEP_FIELD_RE = /^\[(?:done|completion|completed|cancelled|canceled|完成|结束|完成时间|取消时间)\s*::/i;

function leadingWhitespace(line) {
	const m = /^[ \t]*/.exec(line);
	return m ? m[0] : "";
}

// 判断某行是否属于上一级任务节点的附属内容（缩进更深）
function isDeeperIndent(line, baseIndent) {
	if (line.trim() === "") return false;
	const lead = leadingWhitespace(line);
	if (lead.length <= baseIndent.length) return false;
	return baseIndent.length === 0 || lead.startsWith(baseIndent);
}

function isBlankLine(line) {
	return line.trim() === "";
}

// 去时间戳后的任务主体，用于整理时去重（仅在开启去重时生效）
function taskLineKey(line) {
	const text = String(line || "").trim();
	if (!text) return "";
	return text
		.replace(new RegExp("[" + DONE_MARKER_CHARS + "]\\s*\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?)?", "g"), "")
		.replace(/\s+/g, " ")
		.trim();
}

// 元数据剥离：完成/取消时间戳、📅⏳🛫➕ 日期字段、优先级符号、内联字段
// 注意不剥离 🔁 及其内容，所以「- [x] 烧水 🔁 every day ✅ 2026-02-01」不算空任务
const METADATA_STRIP_RE = new RegExp(
	"(?:[" + DONE_MARKER_CHARS + "]|[\\u{1F4C5}\\u{23F3}\\u{1F6EB}\\u{2795}])\\s*\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?)?",
	"gu"
);
const PRIORITY_STRIP_RE = /[\u{23EB}\u{1F53C}\u{1F53D}]/gu;
const INLINE_FIELD_RE = /\[[^\]]*::[^\]]*\]/g;

// 任务正文剥离元数据后是否为空：空任务在整理时直接删除，不进归档文件
function isEmptyTaskBody(body) {
	const text = String(body || "")
		.replace(METADATA_STRIP_RE, "")
		.replace(INLINE_FIELD_RE, "")
		.replace(PRIORITY_STRIP_RE, "")
		.trim();
	return text === "";
}

// 把 YYYY-MM-DD[ T| ]HH:mm[:ss] 转成可直接比较的数字（无依赖、无时区问题）
function dateKeyFrom(match) {
	const y = Number(match[1]);
	const mo = Number(match[2]);
	const d = Number(match[3]);
	const h = Number(match[4] || 0);
	const mi = Number(match[5] || 0);
	const s = Number(match[6] || 0);
	return y * 1e10 + mo * 1e8 + d * 1e6 + h * 1e4 + mi * 1e2 + s;
}

// 取文本中最后一个日期时间（同行的多个日期时以最后一个为准）
function lastDateKey(text) {
	const re = /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/g;
	let last = null;
	let m;
	while ((m = re.exec(text)) !== null) last = m;
	return last ? dateKeyFrom(last) : null;
}

// 完成 / 取消时间：`✅ 2026-10-08 20:56:59`、`❌ 2026-10-08`、`[done:: 2026-10-08]`
function extractTimeKey(body) {
	const markerRe = new RegExp(
		"[" + DONE_MARKER_CHARS + "]\\s*(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2})(?::(\\d{2}))?)?",
		"g"
	);
	let last = null;
	let m;
	while ((m = markerRe.exec(body)) !== null) last = m;
	if (last) return dateKeyFrom(last);

	const fieldRe =
		/\[(?:done|completion|completed|cancelled|canceled|完成|结束|完成时间|取消时间)\s*::\s*([^\]]+)\]/gi;
	let field = null;
	while ((m = fieldRe.exec(body)) !== null) field = m;
	if (field) {
		const key = lastDateKey(field[1]);
		if (key !== null) return key;
	}

	// 兜底：去掉 created/due 等无关内联字段后，取行内最后一个日期
	const stripped = body.replace(/\[[^\]]*::[^\]]*\]/g, (seg) => (KEEP_FIELD_RE.test(seg) ? seg : ""));
	return lastDateKey(stripped);
}

// 单个字段的日期：优先 emoji（📅 2026-10-10），其次内联字段（[due:: 2026-10-10]）
function emojiOrFieldDateKey(body, emoji, fieldNames) {
	const m = new RegExp(
		emoji + "\\s*(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2})(?::(\\d{2}))?)?"
	).exec(body);
	if (m) return dateKeyFrom(m);

	const fieldRe = new RegExp("\\[\\s*(?:" + fieldNames.join("|") + ")\\s*::\\s*([^\\]]+)\\]", "i");
	const field = fieldRe.exec(body);
	if (field) return lastDateKey(field[1]);
	return null;
}

// 优先级：⏫ 高 > 🔼 中 > 无 > 🔽 低
function extractPriorityRank(body) {
	if (/⏫/.test(body) || /\[priority::\s*(?:highest|high)\]/i.test(body)) return 3;
	if (/🔼/.test(body) || /\[priority::\s*(?:medium|normal)\]/i.test(body)) return 2;
	if (/🔽/.test(body) || /\[priority::\s*(?:low|lowest)\]/i.test(body)) return 1;
	return 0;
}

function extractFieldKeys(body) {
	return {
		dueKey: emojiOrFieldDateKey(body, "📅", ["due", "截止", "截止日期"]),
		createdKey: emojiOrFieldDateKey(body, "➕", ["created", "createddate", "创建", "创建时间"]),
		startKey: emojiOrFieldDateKey(body, "🛫", ["start", "开始", "开始时间"]),
		scheduledKey: emojiOrFieldDateKey(body, "⏳", ["scheduled", "计划", "计划时间"]),
		priorityRank: extractPriorityRank(body)
	};
}

function classifyStatus(status) {
	if (status === "x" || status === "X") return "done";
	if (status === "-") return "cancelled";
	return "unfinished"; // 空格（待办）与 `/`（进行中）都算未完成
}

/**
 * 把全文拆成两种片段：
 *  - { kind: "raw" }  非任务内容（普通文字、标题、空行、frontmatter、代码块…）
 *  - { kind: "node" } 一个顶层任务行 + 它缩进更深的子行（子任务/补充说明）
 */
function parseDocument(content) {
	const lines = splitLines(content);
	const items = [];
	let inFence = false;
	let fenceToken = "";
	let inFrontmatter = false;
	let nodeIndex = 0;

	function pushRaw(line, flags) {
		items.push({
			kind: "raw",
			lines: [line],
			frontmatter: !!(flags && flags.frontmatter),
			fence: !!(flags && flags.fence)
		});
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		if (i === 0 && trimmed === "---") {
			inFrontmatter = true;
			pushRaw(line, { frontmatter: true });
			continue;
		}
		if (inFrontmatter) {
			pushRaw(line, { frontmatter: true });
			if (trimmed === "---" || trimmed === "...") inFrontmatter = false;
			continue;
		}

		const fence = FENCE_RE.exec(line);
		if (fence) {
			if (!inFence) {
				inFence = true;
				fenceToken = fence[1];
				pushRaw(line, { fence: true });
				continue;
			}
			if (fence[1] === fenceToken) {
				inFence = false;
				pushRaw(line, { fence: true });
				continue;
			}
		}
		if (inFence) {
			pushRaw(line, { fence: true });
			continue;
		}

		const match = TASK_LINE_RE.exec(line);
		if (match) {
			const indent = match[1];
			const status = match[2];
			const body = match[3];
			const block = [line];
			let j = i + 1;
			while (j < lines.length) {
				const next = lines[j];
				if (isBlankLine(next)) break;
				if (!isDeeperIndent(next, indent)) break;
				block.push(next);
				j++;
			}
			const state = classifyStatus(status);
			const fields = extractFieldKeys(body);
			items.push({
				kind: "node",
				indent: indent.length,
				status: status,
				state: state,
				body: body,
				lines: block,
				startLine: i,
				endLine: j - 1,
				index: nodeIndex++,
				timeKey: state === "unfinished" ? null : extractTimeKey(body),
				dueKey: fields.dueKey,
				createdKey: fields.createdKey,
				startKey: fields.startKey,
				scheduledKey: fields.scheduledKey,
				priorityRank: fields.priorityRank
			});
			i = j - 1;
			continue;
		}

		pushRaw(line);
	}

	return { items: items, nodeCount: nodeIndex, lineCount: lines.length };
}

/* ------------------------------------------------------------------ *
 * 变换层：空行压缩、非任务置顶、分组标题
 * ------------------------------------------------------------------ */

function isBlankRawItem(item) {
	return item.kind === "raw" && !item.fence && item.lines.length === 1 && isBlankLine(item.lines[0]);
}

function blankRawItem() {
	return { kind: "raw", lines: [""], frontmatter: false, fence: false };
}

// 压缩连续空行：只在代码块之外生效，并去掉首尾多余空行
function compactBlankLines(items) {
	const out = [];
	let previousBlank = false;
	for (const item of items) {
		if (isBlankRawItem(item)) {
			if (previousBlank) continue;
			previousBlank = true;
			out.push(item);
			continue;
		}
		previousBlank = false;
		out.push(item);
	}
	while (out.length && isBlankRawItem(out[0])) out.shift();
	while (out.length && isBlankRawItem(out[out.length - 1])) out.pop();
	return out;
}

function headingTitleFor(group, opts) {
	if (group === "unfinished") return (opts.headingTodo || "").trim();
	if (group === "cancelled") return (opts.headingCancelled || "").trim();
	return (opts.headingDone || "").trim();
}

function headingTitles(opts) {
	return [opts.headingTodo, opts.headingDone, opts.headingCancelled].map((t) => (t || "").trim());
}

function groupOf(node, opts) {
	if (node.state === "unfinished") return "unfinished";
	if (node.state === "cancelled" && opts.splitCancelled) return "cancelled";
	return "done";
}

// 幂等：删除上一次插入的分组标题行（连同其后紧跟的一个空行）
function stripGroupHeadings(items, opts) {
	const titles = new Set(headingTitles(opts).filter(Boolean));
	if (!titles.size) return items;
	const out = [];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item.kind === "raw" && item.lines.length === 1 && titles.has(item.lines[0].trim())) {
			const next = items[i + 1];
			if (next && next.kind === "raw" && next.lines.length === 1 && isBlankLine(next.lines[0])) i++;
			continue;
		}
		out.push(item);
	}
	return out;
}

// 在每段连续任务前插入分组标题（空组不插）
function insertGroupHeadings(items, opts) {
	const out = [];
	let i = 0;
	while (i < items.length) {
		const item = items[i];
		if (item.kind !== "node") {
			out.push(item);
			i++;
			continue;
		}
		let j = i;
		while (j < items.length && items[j].kind === "node") j++;
		let currentGroup = null;
		for (let k = i; k < j; k++) {
			const node = items[k];
			const group = groupOf(node, opts);
			if (group !== currentGroup) {
				const title = headingTitleFor(group, opts);
				if (title) out.push({ kind: "raw", lines: [title], frontmatter: false, fence: false });
				currentGroup = group;
			}
			out.push(node);
		}
		i = j;
	}
	return out;
}

// 非任务内容整体前移：frontmatter → 非任务文本（压缩空行）→ 空行 → 任务
function liftNonTask(items, sortedNodes) {
	const frontmatter = [];
	const raws = [];
	for (const item of items) {
		if (item.frontmatter) frontmatter.push(item);
		else if (item.kind === "raw") raws.push(item);
	}
	const compact = compactBlankLines(raws);
	const assembled = frontmatter.concat(compact);
	if (compact.length && sortedNodes.length) assembled.push(blankRawItem());
	return assembled.concat(sortedNodes);
}

/* ------------------------------------------------------------------ *
 * 排序层
 * ------------------------------------------------------------------ */

// "due-asc" / "priority" → { field, direction }
function parseKeySpec(spec) {
	const text = String(spec || "none");
	const dash = text.lastIndexOf("-");
	const field = dash > 0 ? text.slice(0, dash) : text;
	let direction = dash > 0 && text.slice(dash + 1) === "desc" ? -1 : 1;
	if (field === "priority" && dash <= 0) direction = -1; // 优先级默认 高 → 低
	return { field: field, direction: direction };
}

function valueForField(node, field) {
	if (field === "due") return node.dueKey;
	if (field === "created") return node.createdKey;
	if (field === "priority") return node.priorityRank;
	return node.timeKey; // done
}

function makeComparator(spec, opts) {
	const { field, direction } = parseKeySpec(spec);
	const missing = opts.noTimeLast ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
	return (a, b) => {
		const rawA = valueForField(a, field);
		const rawB = valueForField(b, field);
		const va = rawA === null || rawA === undefined ? missing : rawA;
		const vb = rawB === null || rawB === undefined ? missing : rawB;
		if (va === vb) return a.index - b.index; // 稳定兜底：保持原有相对顺序
		return (va - vb) * direction;
	};
}

function sortNodes(nodes, opts) {
	const unfinished = [];
	const done = [];
	const cancelled = [];
	for (const node of nodes) {
		if (node.state === "unfinished") unfinished.push(node);
		else if (node.state === "cancelled" && opts.splitCancelled) cancelled.push(node);
		else done.push(node);
	}

	const finishedCmp = makeComparator(opts.doneKey, opts);
	done.sort(finishedCmp);
	cancelled.sort(finishedCmp);
	if (opts.unfinishedKey && opts.unfinishedKey !== "none") unfinished.sort(makeComparator(opts.unfinishedKey, opts));

	return opts.unfinished === "bottom"
		? done.concat(cancelled, unfinished)
		: unfinished.concat(done, cancelled);
}

function renderItems(items, eol) {
	const out = [];
	for (const item of items) {
		for (const line of item.lines) out.push(line);
	}
	return out.join(eol);
}

/**
 * 排序入口（纯函数，便于本地自检）
 * @returns {{ text: string, changed: boolean, count: number }}
 */
function sortMarkdown(content, opts) {
	const eol = detectEol(content);
	let items = parseDocument(content).items;
	let processed = 0;

	// —— 选区模式：只重排选区内的任务，行数保持不变 ——
	if (opts.selection && typeof opts.selection.startLine === "number") {
		const startLine = opts.selection.startLine;
		const endLine = opts.selection.endLine;
		const slots = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.kind === "node" && item.startLine >= startLine && item.endLine <= endLine) slots.push(i);
		}
		if (slots.length > 1) {
			const sorted = sortNodes(
				slots.map((i) => items[i]),
				opts
			);
			for (let x = 0; x < slots.length; x++) items[slots[x]] = sorted[x];
			processed = slots.length;
		}
		const text = renderItems(items, eol);
		return { text: text, changed: text !== content, count: processed };
	}

	if (opts.groupHeadings && opts.groupHeadings !== HEADINGS_OFF) {
		items = stripGroupHeadings(items, opts);
	}

	const liftTop = opts.nonTask === NON_TASK_TOP || opts.groupHeadings === HEADINGS_FILE;

	if (liftTop) {
		const nodes = items.filter((item) => item.kind === "node");
		const sorted = sortNodes(nodes, opts);
		items = liftNonTask(items, sorted);
		processed = sorted.length;
	} else if (opts.scope === SCOPE_FILE) {
		const slots = [];
		for (let i = 0; i < items.length; i++) {
			if (items[i].kind === "node") slots.push(i);
		}
		if (slots.length > 1) {
			const sorted = sortNodes(
				slots.map((i) => items[i]),
				opts
			);
			for (let x = 0; x < slots.length; x++) items[slots[x]] = sorted[x];
			processed = slots.length;
		}
	} else {
		let i = 0;
		while (i < items.length) {
			if (items[i].kind !== "node") {
				i++;
				continue;
			}
			let j = i;
			while (j < items.length && items[j].kind === "node") j++;
			let k = i;
			while (k < j) {
				const indent = items[k].indent;
				let m = k;
				while (m < j && items[m].indent === indent) m++;
				if (m - k > 1) {
					const sorted = sortNodes(items.slice(k, m), opts);
					for (let x = 0; x < sorted.length; x++) items[k + x] = sorted[x];
					processed += sorted.length;
				}
				k = m;
			}
			i = j;
		}
	}

	if (opts.groupHeadings && opts.groupHeadings !== HEADINGS_OFF) {
		items = insertGroupHeadings(items, opts);
	}

	const text = renderItems(items, eol);
	return { text: text, changed: text !== content, count: processed };
}

/* ------------------------------------------------------------------ *
 * 转为任务（纯函数）
 * ------------------------------------------------------------------ */

/**
 * 把一段文本里的普通行加上任务前缀
 * opts: { prefix, skipBlank, skipExisting, skipFence }
 * @returns {{ text: string, converted: number, skipped: number }}
 */
function convertLinesToTasks(text, opts) {
	const eol = detectEol(text);
	const prefix = String((opts && opts.prefix) || "- [ ] ");
	const skipBlank = !opts || opts.skipBlank !== false;
	const skipExisting = !opts || opts.skipExisting !== false;
	const skipFence = !opts || opts.skipFence !== false;

	const out = [];
	let converted = 0;
	let skipped = 0;
	let inFence = false;
	let fenceToken = "";

	for (const line of splitLines(text)) {
		const fence = FENCE_RE.exec(line);
		if (fence) {
			if (!inFence) {
				inFence = true;
				fenceToken = fence[1];
			} else if (fence[1] === fenceToken) {
				inFence = false;
			}
			out.push(line);
			continue;
		}
		if (inFence && skipFence) {
			out.push(line);
			continue;
		}
		if (isBlankLine(line) && skipBlank) {
			out.push(line);
			skipped++;
			continue;
		}
		if (skipExisting && TASK_LINE_RE.test(line)) {
			out.push(line);
			skipped++;
			continue;
		}
		const indent = leadingWhitespace(line);
		const rest = line.slice(indent.length);
		out.push(rest === "" ? indent + prefix.replace(/\s+$/, "") : indent + prefix + rest);
		converted++;
	}

	return { text: out.join(eol), converted: converted, skipped: skipped };
}

/* ------------------------------------------------------------------ *
 * 一键整理（纯函数规划，不触碰磁盘）
 * ------------------------------------------------------------------ */

// 未完成任务的目标文件路径（规划、确认框、写盘共用）
// custom 为纯固定路径：不做日期替换，仅归一化斜杠并补 .md；留空时回退到下一天文件
function unfinishedTargetPath(opts) {
	const nextPath = joinPath(opts.archiveFolder, formatArchiveFileName(opts.fileFormat, opts.nextDate));
	if ((opts.unfinishedTarget || UNFINISHED_NEXT) !== UNFINISHED_CUSTOM) return nextPath;
	const custom = String(opts.unfinishedPath || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (!custom) return nextPath;
	return /\.md$/i.test(custom) ? custom : custom + ".md";
}

/**
 * 计算整理方案。
 * sources: [{ path, content }]
 * opts: { archiveFolder, fileFormat, baseDate, nextDate, mode, unfinishedTarget,
 *         unfinishedPath, noTimeDoneTarget, skipDuplicates, dateFrom, dateTo }
 * existing: { 目标文件路径: 现有内容 }（用于去重）
 * @returns {{ targets: object, updatedSources: object, stats: object }}
 */
function planArchive(sources, opts, existing) {
	const targets = Object.create(null);
	const updatedSources = Object.create(null);
	const perTarget = Object.create(null);
	const seen = new Set();

	let sourceCount = 0;
	let doneCount = 0;
	let unfinishedCount = 0;
	let skippedCount = 0;
	let duplicateCount = 0;
	let emptyCount = 0;
	let alreadyThereCount = 0;

	if (existing) {
		for (const path of Object.keys(existing)) {
			for (const line of splitLines(existing[path])) {
				const key = taskLineKey(line);
				if (key) seen.add(key);
			}
		}
	}

	for (const source of sources) {
		const content = source.content || "";
		const eol = detectEol(content);
		const doc = parseDocument(content);
		const moved = new Set();
		const removed = new Set();

		for (let i = 0; i < doc.items.length; i++) {
			const node = doc.items[i];
			if (node.kind !== "node") continue;

			// 没有具体任务内容的行：直接删除，不写入任何归档文件
			if (opts.removeEmpty !== false && isEmptyTaskBody(node.body)) {
				emptyCount++;
				removed.add(i);
				continue;
			}

			let path = null;
			if (node.state === "unfinished") {
				if ((opts.unfinishedTarget || UNFINISHED_NEXT) === UNFINISHED_KEEP) {
					skippedCount++;
					continue;
				}
				path = unfinishedTargetPath(opts);
				if (!path) {
					skippedCount++;
					continue;
				}
			} else {
				let targetDate = null;
				if (node.timeKey === null) {
					if (opts.noTimeDoneTarget === "keep") {
						skippedCount++;
						continue;
					}
					targetDate = opts.baseDate;
				} else {
					const day = isoFromTimeKey(node.timeKey);
					if (opts.dateFrom && day < opts.dateFrom) {
						skippedCount++;
						continue;
					}
					if (opts.dateTo && day > opts.dateTo) {
						skippedCount++;
						continue;
					}
					targetDate = day;
				}
				path = joinPath(opts.archiveFolder, formatArchiveFileName(opts.fileFormat, targetDate));
			}

			// 目标文件就是它当前所在的文件：已经在正确位置，跳过（避免自我搬运造成重复）
			if (opts.skipSameFile !== false && path === source.path) {
				skippedCount++;
				alreadyThereCount++;
				continue;
			}

			if (opts.skipDuplicates) {
				const key = taskLineKey(node.lines[0]);
				if (key) {
					if (seen.has(key)) {
						duplicateCount++;
						skippedCount++;
						continue;
					}
					seen.add(key);
				}
			}

			if (!targets[path]) {
				targets[path] = [];
				perTarget[path] = 0;
			}
			for (const line of node.lines) targets[path].push(line);
			perTarget[path] += 1;
			if (node.state === "unfinished") unfinishedCount++;
			else doneCount++;
			moved.add(i);
		}

		if (!moved.size && !removed.size) continue;
		sourceCount++;
		const isMove = opts.mode === ARCHIVE_MOVE;
		// 移动模式：移除已归档 + 空任务；复制模式：只移除空任务
		const rest = doc.items.filter((item, index) => !(removed.has(index) || (isMove && moved.has(index))));
		let text = renderItems(compactBlankLines(rest), eol);
		if (text !== "" && /\n$/.test(content) && !/\n$/.test(text)) text += eol;
		updatedSources[source.path] = text;
	}

	return {
		targets: targets,
		updatedSources: updatedSources,
		stats: {
			sourceCount: sourceCount,
			doneCount: doneCount,
			unfinishedCount: unfinishedCount,
			skippedCount: skippedCount,
			duplicateCount: duplicateCount,
			emptyCount: emptyCount,
			alreadyThereCount: alreadyThereCount,
			perTarget: perTarget,
			targetCount: Object.keys(targets).length
		}
	};
}

/**
 * 只删除“任务内容为空”的行，不做归档（供独立清理命令使用）
 * @returns {{ text: string, removed: number, changed: boolean }}
 */
function cleanEmptyTasks(content) {
	const eol = detectEol(content);
	const doc = parseDocument(content);
	const removed = new Set();
	for (let i = 0; i < doc.items.length; i++) {
		const node = doc.items[i];
		if (node.kind === "node" && isEmptyTaskBody(node.body)) removed.add(i);
	}
	if (!removed.size) return { text: content, removed: 0, changed: false };
	const rest = doc.items.filter((item, index) => !removed.has(index));
	let text = renderItems(compactBlankLines(rest), eol);
	if (text !== "" && /\n$/.test(content) && !/\n$/.test(text)) text += eol;
	return { text: text, removed: removed.size, changed: text !== content };
}

// 归档文件内部排序选项：无时分的已完成任务最前，有分秒的按时间升序
function archiveSortOptions(settings) {
	return Object.assign({}, settings, {
		scope: SCOPE_FILE,
		nonTask: NON_TASK_KEEP,
		doneKey: "done-asc",
		noTimeLast: false,
		groupHeadings: settings.archiveGroupHeadings ? HEADINGS_FILE : HEADINGS_OFF,
		selection: undefined
	});
}

/* ------------------------------------------------------------------ *
 * 确认弹窗
 * ------------------------------------------------------------------ */

class ConfirmModal extends Modal {
	constructor(app, title, lines, confirmText, onConfirm) {
		super(app);
		this.title = title;
		this.lines = lines || [];
		this.confirmText = confirmText || "继续";
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.title });
		const list = contentEl.createEl("div");
		list.addClass("tasks-enhancer-confirm");
		for (const line of this.lines) {
			list.createEl("div", { text: line });
		}
		const buttons = new Setting(contentEl);
		buttons.addButton((button) =>
			button
				.setButtonText(this.confirmText)
				.setCta()
				.onClick(() => {
					this.close();
					if (this.onConfirm) this.onConfirm();
				})
		);
		buttons.addButton((button) =>
			button.setButtonText("取消").onClick(() => {
				this.close();
			})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/* ------------------------------------------------------------------ *
 * 插件壳层
 * ------------------------------------------------------------------ */

class TasksEnhancerPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.selfWrites = new Map();
		this.autoRefs = [];
		this.saveTimer = null;
		this.idleTimer = null;

		for (const id of Object.keys(ICONS)) addIcon(id, ICONS[id]);
		this.addRibbonIcon(ICON_MAIN, "Tasks Enhancer", (event) => this.showMainMenu(event));

		this.addCommand({
			id: "sort-default",
			name: "排序当前文件（按设置）",
			icon: ICON_SORT,
			callback: () => this.runSort({})
		});
		this.addCommand({
			id: "sort-top-asc",
			name: "未完成置顶 · 完成时间从早到晚",
			icon: ICON_SORT,
			callback: () => this.runSort({ unfinished: "top", doneKey: "done-asc" })
		});
		this.addCommand({
			id: "sort-top-desc",
			name: "未完成置顶 · 完成时间从晚到早",
			icon: ICON_SORT,
			callback: () => this.runSort({ unfinished: "top", doneKey: "done-desc" })
		});
		this.addCommand({
			id: "sort-bottom-asc",
			name: "未完成置底 · 完成时间从早到晚",
			icon: ICON_SORT,
			callback: () => this.runSort({ unfinished: "bottom", doneKey: "done-asc" })
		});
		this.addCommand({
			id: "sort-bottom-desc",
			name: "未完成置底 · 完成时间从晚到早",
			icon: ICON_SORT,
			callback: () => this.runSort({ unfinished: "bottom", doneKey: "done-desc" })
		});
		this.addCommand({
			id: "sort-selection",
			name: "排序选中的任务区域",
			icon: ICON_SORT,
			callback: () => this.runSort({}, { forceSelection: true })
		});
		this.addCommand({
			id: "sort-nontask-top",
			name: "非任务内容置顶并排序",
			icon: ICON_LIFT,
			callback: () => this.runSort({ nonTask: NON_TASK_TOP })
		});
		this.addCommand({
			id: "toggle-scope",
			name: "切换排序范围（连续块 / 整文件）",
			icon: ICON_SORT,
			callback: async () => {
				const next = this.settings.scope === SCOPE_FILE ? SCOPE_BLOCK : SCOPE_FILE;
				this.settings.scope = next;
				await this.saveSettings();
				this.notify("排序范围已切换为：" + (next === SCOPE_FILE ? "整文件" : "连续块"));
			}
		});
		this.addCommand({
			id: "convert-selection",
			name: "把选中的行转为任务",
			icon: ICON_CONVERT,
			callback: () => this.convertSelection()
		});
		this.addCommand({
			id: "archive-now",
			name: "一键整理：把任务归档到 Tasks 日期文件",
			icon: ICON_ARCHIVE,
			callback: () => this.runArchive()
		});
		this.addCommand({
			id: "clean-empty-tasks",
			name: "清理当前文件的空任务行",
			icon: ICON_CONVERT,
			callback: () => this.cleanEmptyTasksInActiveFile()
		});
		this.addCommand({
			id: "open-settings",
			name: "打开 Tasks Enhancer 设置",
			icon: "gear",
			callback: () => this.openPluginSettings()
		});

		// 编辑器右键菜单
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				if (!view || !this.isMarkdownFile(view.file)) return;
				menu.addSeparator();
				menu.addItem((item) =>
					item
						.setTitle("Tasks Enhancer：按设置排序")
						.setIcon(ICON_SORT)
						.onClick(() => this.runSort({}, { editor: editor }))
				);
				menu.addItem((item) =>
					item
						.setTitle("Tasks Enhancer：排序选中区域")
						.setIcon(ICON_SORT)
						.onClick(() => this.runSort({}, { editor: editor, forceSelection: true }))
				);
				menu.addItem((item) =>
					item
						.setTitle("Tasks Enhancer：选中的行转为任务")
						.setIcon(ICON_CONVERT)
						.onClick(() => this.convertSelection(editor))
				);
				menu.addItem((item) =>
					item
						.setTitle("Tasks Enhancer：非任务内容置顶并排序")
						.setIcon(ICON_LIFT)
						.onClick(() => this.runSort({ nonTask: NON_TASK_TOP }, { editor: editor }))
				);
				menu.addItem((item) =>
					item
						.setTitle("Tasks Enhancer：清理空任务行")
						.setIcon(ICON_CONVERT)
						.onClick(() => this.cleanEmptyTasksInActiveFile())
				);
			})
		);

		// 文件列表右键菜单
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!this.isMarkdownFile(file)) return;
				menu.addSeparator();
				menu.addItem((item) =>
					item
						.setTitle("Tasks Enhancer：排序此文件")
						.setIcon(ICON_SORT)
						.onClick(() => this.sortFile(file, this.resolveOpts({})))
				);
				menu.addItem((item) =>
					item
						.setTitle("Tasks Enhancer：非任务内容置顶并排序")
						.setIcon(ICON_LIFT)
						.onClick(() => this.sortFile(file, this.resolveOpts({ nonTask: NON_TASK_TOP })))
				);
				menu.addItem((item) =>
					item
						.setTitle("Tasks Enhancer：整理此文件的任务")
						.setIcon(ICON_ARCHIVE)
						.onClick(() => this.runArchive([file]))
				);
				menu.addItem((item) =>
					item
						.setTitle("Tasks Enhancer：清理空任务行")
						.setIcon(ICON_CONVERT)
						.onClick(() => this.cleanEmptyTasksInFile(file))
				);
			})
		);

		this.setupAutoSort();
		this.addSettingTab(new TasksEnhancerSettingTab(this.app, this));
	}

	onunload() {
		this.teardownAutoSort();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.migrateSettings();
	}

	// 旧版本用布尔值 carryOverUnfinished 控制是否顺延，改为三选下拉后做一次性迁移
	migrateSettings() {
		if (Object.prototype.hasOwnProperty.call(this.settings, "carryOverUnfinished")) {
			const legacy = this.settings.carryOverUnfinished;
			if (!this.settings.archiveUnfinishedTarget || this.settings.archiveUnfinishedTarget === UNFINISHED_NEXT) {
				this.settings.archiveUnfinishedTarget = legacy === false ? UNFINISHED_KEEP : UNFINISHED_NEXT;
			}
			delete this.settings.carryOverUnfinished;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	queueSave() {
		if (this.pendingSave) window.clearTimeout(this.pendingSave);
		this.pendingSave = window.setTimeout(() => {
			this.pendingSave = null;
			this.saveSettings().catch((error) => console.error("Tasks Enhancer 保存设置失败", error));
		}, 600);
	}

	resolveOpts(override) {
		return Object.assign({}, this.settings, override || {});
	}

	isMarkdownFile(file) {
		return !!file && file.extension === "md";
	}

	notify(message) {
		if (this.settings && this.settings.showNotice === false) return;
		new Notice(message);
	}

	activeEditor() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view && view.editor ? view.editor : null;
	}

	openPluginSettings() {
		try {
			this.app.setting.open();
			if (this.app.setting.openTabById && this.manifest && this.manifest.id) {
				this.app.setting.openTabById(this.manifest.id);
			}
		} catch (error) {
			console.error("Tasks Enhancer 打开设置失败", error);
			this.notify("Tasks Enhancer：无法打开设置，请手动进入插件设置页");
		}
	}

	/* —— 左侧图标菜单 —— */

	// 点击左侧图标：已展开则收起，未展开则弹出（同一图标二次点击切换开关）
	showMainMenu(event) {
		const opened = this.mainMenu;
		this.mainMenu = null;
		if (opened) {
			this.closeMenu(opened);
			return;
		}

		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("一键排序：按设置整理当前文件")
				.setIcon(ICON_SORT)
				.onClick(() => this.runSort({}))
		);
		menu.addItem((item) =>
			item.setTitle("一键整理：归档到 Tasks 日期文件").setIcon(ICON_ARCHIVE).onClick(() => this.runArchive())
		);
		menu.addItem((item) =>
			item.setTitle("选中的行转为任务").setIcon(ICON_CONVERT).onClick(() => this.convertSelection())
		);
		menu.addItem((item) =>
			item.setTitle("非任务内容置顶并排序").setIcon(ICON_LIFT).onClick(() => this.runSort({ nonTask: NON_TASK_TOP }))
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle("打开 Tasks Enhancer 设置").setIcon("gear").onClick(() => this.openPluginSettings())
		);
		try {
			if (event && menu.showAtMouseEvent) menu.showAtMouseEvent(event);
			else menu.showAtPosition({ x: 200, y: 200 });
			this.mainMenu = menu;
			this.watchMenuDismiss(menu);
		} catch (error) {
			console.error("Tasks Enhancer 打开菜单失败", error);
			this.runSort({});
		}
	}

	closeMenu(menu) {
		try {
			if (typeof menu.close === "function") menu.close();
		} catch (error) {
			console.error("Tasks Enhancer 关闭菜单失败", error);
		}
	}

	// 菜单因选中项、点击别处或 Esc 关闭时，同步清掉引用，保证下次点击是“展开”
	watchMenuDismiss(menu) {
		const clear = () => {
			if (this.mainMenu === menu) this.mainMenu = null;
		};
		window.setTimeout(() => {
			function detach() {
				document.removeEventListener("click", onClick, false);
				document.removeEventListener("keydown", onKey, false);
			}
			function onClick() {
				detach();
				clear();
			}
			function onKey(evt) {
				if (evt && evt.key === "Escape") {
					detach();
					clear();
				}
			}
			document.addEventListener("click", onClick, false);
			document.addEventListener("keydown", onKey, false);
		}, 0);
	}

	/* —— 转为任务 —— */

	async convertSelection(editorOverride) {
		const editor = editorOverride || this.activeEditor();
		if (!editor) {
			this.notify("Tasks Enhancer：请在编辑器里选中要转换的行");
			return;
		}
		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		const startLine = Math.min(from.line, to.line);
		const endLine = Math.max(from.line, to.line);
		const lines = [];
		for (let i = startLine; i <= endLine; i++) lines.push(editor.getLine(i));
		const result = convertLinesToTasks(lines.join("\n"), this.settings);
		if (!result.converted) {
			this.notify("Tasks Enhancer：选中的行没有可转换的内容");
			return;
		}
		editor.replaceRange(
			result.text,
			{ line: startLine, ch: 0 },
			{ line: endLine, ch: editor.getLine(endLine).length }
		);
		this.notify("Tasks Enhancer：已把 " + result.converted + " 行转为任务");
	}

	/* —— 空任务清理 —— */

	async cleanEmptyTasksInActiveFile() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			this.notify("Tasks Enhancer：当前没有打开的文件");
			return;
		}
		await this.cleanEmptyTasksInFile(file);
	}

	async cleanEmptyTasksInFile(file) {
		if (!this.isMarkdownFile(file)) {
			this.notify("Tasks Enhancer：只能清理 Markdown 文件");
			return;
		}
		try {
			const original = await this.app.vault.cachedRead(file);
			const result = cleanEmptyTasks(original);
			if (!result.changed) {
				this.notify("Tasks Enhancer：没有空任务行");
				return;
			}
			await this.app.vault.process(file, () => result.text);
			this.markSelfWrite(file);
			this.notify("Tasks Enhancer：已删除 " + result.removed + " 个空任务行");
		} catch (error) {
			console.error("Tasks Enhancer 清理空任务失败：" + (file && file.path), error);
			this.notify("Tasks Enhancer：清理失败，详情见控制台");
		}
	}

	/* —— 一键整理 —— */

	resolveBaseDate() {
		const raw = (this.settings.archiveBaseDate || "").trim();
		return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayIso();
	}

	async collectArchiveSources() {
		const folder = normalizeFolder(this.settings.archiveFolder);
		const all = this.app.vault.getMarkdownFiles();
		let files = all;

		if (this.settings.archiveScope === ARCHIVE_FILE) {
			const active = this.app.workspace.getActiveFile();
			files = this.isMarkdownFile(active) ? [active] : [];
		} else if (this.settings.archiveScope === ARCHIVE_FOLDER) {
			const source = normalizeFolder(this.settings.archiveSourceFolder);
			if (source) {
				files = this.settings.archiveIncludeSubfolders
					? all.filter((file) => file.path === source || file.path.startsWith(source + "/"))
					: all.filter((file) => file.path.startsWith(source + "/"));
			}
		}

		// 默认允许整理归档目录内的文件：同一文件内的任务会在规划阶段跳过，不会自我搬运
		if (folder && this.settings.archiveExcludeTasksFolder === true) {
			files = files.filter((file) => !(file.path === folder || file.path.startsWith(folder + "/")));
		}
		return files;
	}

	archiveOptions(baseDate, nextDate) {
		return {
			archiveFolder: this.settings.archiveFolder,
			fileFormat: this.settings.archiveFileFormat,
			baseDate: baseDate,
			nextDate: nextDate,
			mode: this.settings.archiveMode,
			unfinishedTarget: this.settings.archiveUnfinishedTarget || UNFINISHED_NEXT,
			unfinishedPath: (this.settings.archiveUnfinishedPath || "").trim(),
			removeEmpty: this.settings.archiveRemoveEmptyTasks !== false,
			skipSameFile: true,
			noTimeDoneTarget: this.settings.archiveNoTimeDone === "keep" ? "keep" : "base",
			skipDuplicates: this.settings.archiveSkipDuplicates !== false,
			dateFrom: (this.settings.archiveDateFrom || "").trim(),
			dateTo: (this.settings.archiveDateTo || "").trim()
		};
	}

	async readExistingTargets(paths) {
		const existing = Object.create(null);
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && typeof file.extension === "string") {
				existing[path] = await this.app.vault.cachedRead(file);
			}
		}
		return existing;
	}

	async runArchive(fileOverride) {
		try {
			const files = fileOverride || (await this.collectArchiveSources());
			if (!files.length) {
				this.notify("Tasks Enhancer：没有找到可整理的文件");
				return;
			}
			const baseDate = this.resolveBaseDate();
			const nextDate = addDays(baseDate, 1);
			const opts = this.archiveOptions(baseDate, nextDate);

			const sources = [];
			for (const file of files) {
				sources.push({ path: file.path, content: await this.app.vault.cachedRead(file) });
			}
			let plan = planArchive(sources, opts);
			const existing = await this.readExistingTargets(Object.keys(plan.targets));
			if (Object.keys(existing).length) plan = planArchive(sources, opts, existing);

			if (!plan.stats.doneCount && !plan.stats.unfinishedCount && !plan.stats.emptyCount) {
				this.notify("Tasks Enhancer：没有需要整理的任务");
				return;
			}

			const summary = this.archiveSummary(plan, baseDate, nextDate, opts, existing);
			if (this.settings.archiveConfirm !== false) {
				new ConfirmModal(this.app, "确认整理任务？", summary, "开始整理", () =>
					this.applyArchive(plan, files, opts)
				).open();
			} else {
				await this.applyArchive(plan, files, opts);
			}
		} catch (error) {
			console.error("Tasks Enhancer 整理失败", error);
			this.notify("Tasks Enhancer：整理失败，详情见控制台");
		}
	}

	archiveSummary(plan, baseDate, nextDate, opts, existing) {
		const stats = plan.stats;
		const lines = [];
		lines.push("整理基准日：" + baseDate + "（下一天为 " + nextDate + "）");
		lines.push("涉及源文件：" + stats.sourceCount + " 个，共 " + (stats.doneCount + stats.unfinishedCount) + " 条任务");
		lines.push("已完成/已取消：" + stats.doneCount + " 条");
		if (stats.unfinishedCount) lines.push("未完成：" + stats.unfinishedCount + " 条 → " + unfinishedTargetPath(opts));
		if (stats.emptyCount) lines.push("空任务：" + stats.emptyCount + " 条 → 从原文件删除，不写入归档文件");
		if (stats.alreadyThereCount) lines.push("已在目标文件中、无需移动：" + stats.alreadyThereCount + " 条");
		if (stats.duplicateCount) lines.push("因重复被跳过：" + stats.duplicateCount + " 条");
		if (stats.skippedCount - stats.duplicateCount > 0) {
			lines.push("因日期区间/设置被跳过：" + (stats.skippedCount - stats.duplicateCount) + " 条");
		}
		lines.push("");
		lines.push("将写入的日期文件：");
		const paths = Object.keys(plan.targets).sort();
		for (const path of paths.slice(0, 12)) {
			const state = existing && existing[path] !== undefined ? "已存在，追加合并" : "新建";
			lines.push("  · " + path + "（" + stats.perTarget[path] + " 条，" + state + "）");
		}
		if (paths.length > 12) lines.push("  · …… 其余 " + (paths.length - 12) + " 个文件");
		lines.push("");
		lines.push(
			opts.mode === ARCHIVE_MOVE
				? "整理方式：移动（原文件里的这些任务行会被移除，不会删除文件本身）"
				: "整理方式：复制（原文件保留）"
		);
		if (this.settings.archiveDeleteEmptySource === true) {
			lines.push("注意：整理后变为空的文件会被删除（该行为由设置开启）。");
		}
		return lines;
	}

	async applyArchive(plan, files, opts) {
		const folder = normalizeFolder(opts.archiveFolder);
		if (folder) await this.ensureFolder(folder);

		const sortOpts = archiveSortOptions(this.settings);
		let created = 0;
		let updated = 0;

		for (const path of Object.keys(plan.targets)) {
			const dir = path.indexOf("/") > 0 ? path.slice(0, path.lastIndexOf("/")) : "";
			if (dir) await this.ensureFolder(dir);
			const existingFile = this.app.vault.getAbstractFileByPath(path);
			const additions = plan.targets[path];
			const previous = existingFile && typeof existingFile.extension === "string"
				? await this.app.vault.cachedRead(existingFile)
				: "";
			const eol = previous ? detectEol(previous) : "\n";
			const combined = previous
				? previous.replace(/\s+$/, "") + eol + additions.join(eol)
				: additions.join(eol);
			const sorted = sortMarkdown(combined, sortOpts);
			const text = sorted.text + eol;

			if (existingFile && typeof existingFile.extension === "string") {
				await this.app.vault.process(existingFile, () => text);
				updated++;
			} else {
				await this.app.vault.create(path, text);
				created++;
			}
			this.markSelfWriteByPath(path);
		}

		let removedFiles = 0;
		for (const file of files) {
			const next = plan.updatedSources[file.path];
			if (next === undefined) continue;
			await this.app.vault.process(file, () => next);
			this.markSelfWrite(file);
			updated++;
			if (opts.mode === ARCHIVE_MOVE && this.settings.archiveDeleteEmptySource === true && next.trim() === "") {
				await this.app.vault.delete(file);
				removedFiles++;
			}
		}

		this.notify(
			"Tasks Enhancer：整理完成，归档 " +
				(plan.stats.doneCount + plan.stats.unfinishedCount) +
				" 条，删除空任务 " + plan.stats.emptyCount + " 条（新建 " + created + " / 更新 " + updated + " 个文件" +
				(removedFiles ? "，删除空文件 " + removedFiles + " 个" : "") +
				"）"
		);
	}

	async ensureFolder(folder) {
		try {
			const exists = await this.app.vault.adapter.exists(folder, false);
			if (!exists) await this.app.vault.createFolder(folder);
		} catch (error) {
			console.error("Tasks Enhancer 创建目录失败：" + folder, error);
			throw error;
		}
	}

	/* —— 自我写入守卫 —— */

	markSelfWrite(file) {
		if (!file) return;
		const now = Date.now();
		this.selfWrites.set(file.path, now);
		if (this.selfWrites.size > 50) {
			for (const [path, time] of this.selfWrites) {
				if (now - time > 10000) this.selfWrites.delete(path);
			}
		}
	}

	markSelfWriteByPath(path) {
		this.selfWrites.set(path, Date.now());
	}

	isSelfWrite(file) {
		if (!file) return false;
		const time = this.selfWrites.get(file.path);
		if (time && Date.now() - time < 2000) return true;
		const byPath = this.selfWrites.get(file.path);
		return !!byPath && Date.now() - byPath < 2000;
	}

	/* —— 自动排序 —— */

	setupAutoSort() {
		this.teardownAutoSort();
		if (this.settings.autoSort === AUTO_SAVE) {
			const ref = this.app.vault.on("modify", (file) => this.scheduleSaveSort(file));
			this.autoRefs.push({ target: this.app.vault, ref: ref });
		} else if (this.settings.autoSort === AUTO_IDLE) {
			const ref = this.app.workspace.on("editor-change", (editor, info) => {
				const file = (info && info.file) || this.app.workspace.getActiveFile();
				this.scheduleIdleSort(file);
			});
			this.autoRefs.push({ target: this.app.workspace, ref: ref });
		}
	}

	teardownAutoSort() {
		if (this.autoRefs) {
			for (const entry of this.autoRefs) {
				try {
					entry.target.offref(entry.ref);
				} catch (error) {
					console.error("Tasks Enhancer 注销自动排序事件失败", error);
				}
			}
		}
		this.autoRefs = [];
		if (this.saveTimer) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (this.idleTimer) {
			window.clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	scheduleSaveSort(file) {
		if (!this.isMarkdownFile(file) || this.isSelfWrite(file) || !this.inAutoFolder(file)) return;
		if (this.saveTimer) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			this.autoSortFile(file);
		}, 400);
	}

	scheduleIdleSort(file) {
		if (!this.isMarkdownFile(file) || this.isSelfWrite(file) || !this.inAutoFolder(file)) return;
		const seconds = Math.max(2, Number(this.settings.idleSeconds) || 10);
		if (this.idleTimer) window.clearTimeout(this.idleTimer);
		this.idleTimer = window.setTimeout(() => {
			this.idleTimer = null;
			this.autoSortFile(file);
		}, seconds * 1000);
	}

	inAutoFolder(file) {
		const folder = (this.settings.autoFolder || "").trim().replace(/^\/+|\/+$/g, "");
		if (!folder) return true;
		return file.path === folder || file.path.startsWith(folder + "/");
	}

	async autoSortFile(file) {
		if (!this.isMarkdownFile(file) || this.isSelfWrite(file) || !this.inAutoFolder(file)) return;
		try {
			const opts = this.resolveOpts({ showNotice: false });
			const original = await this.app.vault.cachedRead(file);
			const result = sortMarkdown(original, opts);
			if (!result.changed) return;
			await this.app.vault.process(file, (data) =>
				data === original ? result.text : sortMarkdown(data, opts).text
			);
			this.markSelfWrite(file);
		} catch (error) {
			console.error("Tasks Enhancer 自动排序失败：" + file.path, error);
		}
	}

	/* —— 排序入口 —— */

	async runSort(override, ctx) {
		const options = ctx || {};
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			this.notify("Tasks Enhancer：当前没有打开的文件");
			return;
		}
		if (!this.isMarkdownFile(file)) {
			this.notify("Tasks Enhancer：只能排序 Markdown 文件");
			return;
		}
		const editor = options.editor || this.activeEditor();
		await this.sortFile(file, this.resolveOpts(override), editor, options);
	}

	async sortFile(file, opts, editor, ctx) {
		const context = ctx || {};
		try {
			if (editor) {
				const selection = editor.getSelection();
				const hasSelection = !!selection && selection.length > 0;
				const wantSelection = context.forceSelection || (hasSelection && opts.selectionOnly !== false);
				if (wantSelection) {
					if (hasSelection) {
						await this.sortSelection(editor, file, opts);
						return;
					}
					if (context.forceSelection) {
						this.notify("Tasks Enhancer：请先选中要排序的区域");
						return;
					}
				}
			}

			const original = await this.app.vault.cachedRead(file);
			const result = sortMarkdown(original, opts);
			if (!result.changed) {
				this.notify("Tasks Enhancer：任务顺序无需调整");
				return;
			}
			await this.app.vault.process(file, (data) =>
				data === original ? result.text : sortMarkdown(data, opts).text
			);
			this.markSelfWrite(file);
			this.notify("Tasks Enhancer：已排序 " + result.count + " 个任务");
		} catch (error) {
			console.error("Tasks Enhancer 排序失败：" + (file && file.path), error);
			this.notify("Tasks Enhancer：排序失败，详情见控制台");
		}
	}

	async sortSelection(editor, file, opts) {
		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		const startLine = Math.min(from.line, to.line);
		const endLine = Math.max(from.line, to.line);
		const content = editor.getValue();
		const eol = detectEol(content);
		const before = splitLines(content);
		const result = sortMarkdown(
			content,
			Object.assign({}, opts, { selection: { startLine: startLine, endLine: endLine } })
		);
		if (!result.changed) {
			this.notify("Tasks Enhancer：选区内任务顺序无需调整");
			return;
		}
		const after = splitLines(result.text);
		if (after.length !== before.length) {
			this.notify("Tasks Enhancer：选区排序中止（行数发生变化）");
			return;
		}
		editor.replaceRange(
			after.slice(startLine, endLine + 1).join(eol),
			{ line: startLine, ch: 0 },
			{ line: endLine, ch: editor.getLine(endLine).length }
		);
		this.markSelfWrite(file);
		this.notify("Tasks Enhancer：已排序选区内 " + result.count + " 个任务");
	}
}

/* ------------------------------------------------------------------ *
 * 设置面板
 * ------------------------------------------------------------------ */

class TasksEnhancerSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const containerEl = this.containerEl;
		containerEl.empty();
		const settings = this.plugin.settings;

		const section = (text) => new Setting(containerEl).setName(text).setHeading();

		const dropdown = (name, desc, options, value, apply) => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addDropdown((component) => {
					for (const option of options) component.addOption(option.value, option.label);
					component.setValue(value).onChange(async (next) => {
						apply(next);
						await this.plugin.saveSettings();
					});
				});
		};

		const toggle = (name, desc, value, apply) => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((component) =>
					component.setValue(!!value).onChange(async (next) => {
						apply(next);
						await this.plugin.saveSettings();
					})
				);
		};

		const text = (name, desc, value, placeholder, apply) => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((component) =>
					component
						.setPlaceholder(placeholder)
						.setValue(value || "")
						.onChange((next) => {
							apply(next);
							this.plugin.queueSave();
						})
				);
		};

		/* —— 排序结果 —— */
		section("排序结果");

		dropdown(
			"未完成任务位置",
			"未完成的待办统一放在任务区的最上面或最下面。",
			[
				{ value: "top", label: "置顶" },
				{ value: "bottom", label: "置底" }
			],
			settings.unfinished,
			(value) => (settings.unfinished = value)
		);

		dropdown(
			"未完成任务排序依据",
			"未完成任务之间的排列方式。选“保持原顺序”时它们不会被重新排列。",
			[
				{ value: "none", label: "保持原顺序" },
				{ value: "due-asc", label: "截止日期：早 → 晚" },
				{ value: "due-desc", label: "截止日期：晚 → 早" },
				{ value: "created-asc", label: "创建时间：早 → 晚" },
				{ value: "created-desc", label: "创建时间：晚 → 早" },
				{ value: "priority", label: "优先级：高 → 低" }
			],
			settings.unfinishedKey,
			(value) => (settings.unfinishedKey = value)
		);

		dropdown(
			"已完成任务排序依据",
			"已完成与已取消任务之间的排列方式。“完成时间”即勾选任务时写入的时间戳。",
			[
				{ value: "done-asc", label: "完成时间：早 → 晚" },
				{ value: "done-desc", label: "完成时间：晚 → 早" },
				{ value: "due-asc", label: "截止日期：早 → 晚" },
				{ value: "due-desc", label: "截止日期：晚 → 早" },
				{ value: "created-asc", label: "创建时间：早 → 晚" },
				{ value: "created-desc", label: "创建时间：晚 → 早" }
			],
			settings.doneKey,
			(value) => (settings.doneKey = value)
		);

		dropdown(
			"排序范围",
			"连续块：只在相邻的任务行内部排序，空行与正文作为分隔；整文件：全文任务统一重排。",
			[
				{ value: SCOPE_BLOCK, label: "连续块" },
				{ value: SCOPE_FILE, label: "整文件" }
			],
			settings.scope,
			(value) => (settings.scope = value)
		);

		toggle(
			"取消任务单独分组",
			"开启后，标记为取消（❌ 或 [-]）的任务单独成组，排在所有已完成任务之后。",
			settings.splitCancelled,
			(value) => (settings.splitCancelled = value)
		);

		toggle(
			"没有时间的任务视为最新",
			"已勾选但没有记录时间的任务：关闭时当作最早，开启时当作最新。",
			settings.noTimeLast,
			(value) => (settings.noTimeLast = value)
		);

		/* —— 非任务内容 —— */
		section("非任务内容");

		dropdown(
			"非任务内容位置",
			"保持原位：标题、正文、代码块留在原处，任务就地排序；集中置顶：把非任务内容整体移到文件顶部并压缩多余空行，任务统一排在下方（此时排序范围按整文件处理，YAML 属性区始终留在最前）。",
			[
				{ value: NON_TASK_KEEP, label: "保持原位" },
				{ value: NON_TASK_TOP, label: "集中置顶" }
			],
			settings.nonTask,
			(value) => (settings.nonTask = value)
		);

		/* —— 分组标题 —— */
		section("分组标题");

		dropdown(
			"插入分组标题",
			"排序时自动为各组加上标题。“整文件”会把非任务内容置顶后在任务区插入；“连续块”在每个任务段内分别插入。重复排序不会产生重复标题。",
			[
				{ value: HEADINGS_OFF, label: "不插入" },
				{ value: HEADINGS_FILE, label: "整文件：任务区统一插入" },
				{ value: HEADINGS_BLOCK, label: "连续块：每段分别插入" }
			],
			settings.groupHeadings,
			(value) => (settings.groupHeadings = value)
		);

		text("待办标题", "未完成任务那一组的标题文字，留空则不插入。", settings.headingTodo, "## 待办", (value) => (settings.headingTodo = value));
		text("已完成标题", "已完成任务那一组的标题文字，留空则不插入。", settings.headingDone, "## 已完成", (value) => (settings.headingDone = value));
		text(
			"已取消标题",
			"取消任务那一组的标题文字，留空则不插入。仅在开启“取消任务单独分组”时生效。",
			settings.headingCancelled,
			"## 已取消",
			(value) => (settings.headingCancelled = value)
		);

		/* —— 转为任务 —— */
		section("转为任务");

		text(
			"任务前缀",
			"选中多行后加在每行开头的文本，需包含状态符号（例如 - [ ] ）。",
			settings.taskPrefix,
			"- [ ] ",
			(value) => (settings.taskPrefix = value)
		);
		toggle("跳过空行", "选区里的空行不加前缀。", settings.convertSkipBlank, (value) => (settings.convertSkipBlank = value));
		toggle("跳过已经是任务的行", "已带复选框的行保持不动。", settings.convertSkipExisting, (value) => (settings.convertSkipExisting = value));
		toggle("跳过代码块内的行", "``` 与 ~~~ 围栏内的行不转换。", settings.convertSkipFence, (value) => (settings.convertSkipFence = value));

		/* —— 任务整理 —— */
		section("任务整理");

		text("归档目录", "整理后的日期文件放在哪个目录（相对仓库根），不存在时会自动创建。", settings.archiveFolder, "Tasks", (value) => (settings.archiveFolder = value));
		text("日期文件名格式", "支持 YYYY / MM / DD 占位符，例如 YYYY-MM-DD 或 YYYY年MM月DD日。", settings.archiveFileFormat, "YYYY-MM-DD", (value) => (settings.archiveFileFormat = value));

		dropdown(
			"整理范围",
			"整理哪些文件：当前文件、某个文件夹，或整个仓库（归目录本身始终排除）。",
			[
				{ value: ARCHIVE_FILE, label: "当前文件" },
				{ value: ARCHIVE_FOLDER, label: "指定文件夹" },
				{ value: ARCHIVE_VAULT, label: "整个仓库" }
			],
			settings.archiveScope,
			(value) => (settings.archiveScope = value)
		);

		text("来源文件夹", "“指定文件夹”时的路径，例如 diary；留空表示仓库根目录。", settings.archiveSourceFolder, "diary", (value) => (settings.archiveSourceFolder = value));
		toggle("包含子文件夹", "整理来源文件夹时一并处理子文件夹。", settings.archiveIncludeSubfolders, (value) => (settings.archiveIncludeSubfolders = value));

		text("完成日期起始", "只整理完成日期不早于该日期的任务，留空不限。格式 YYYY-MM-DD。", settings.archiveDateFrom, "2026-10-01", (value) => (settings.archiveDateFrom = value));
		text("完成日期截止", "只整理完成日期不晚于该日期的任务，留空不限。格式 YYYY-MM-DD。", settings.archiveDateTo, "2026-10-31", (value) => (settings.archiveDateTo = value));

		text("整理基准日", "未完成任务顺延到“基准日 + 1 天”的文件，留空表示今天。格式 YYYY-MM-DD。", settings.archiveBaseDate, "留空 = 今天", (value) => (settings.archiveBaseDate = value));

		dropdown(
			"未完成任务去向",
			"整理时未完成的待办写到哪里：基准日 + 1 天的日期文件、你指定的固定文件，或留在原文件不动。",
			[
				{ value: UNFINISHED_NEXT, label: "基准日 + 1 天的日期文件" },
				{ value: UNFINISHED_CUSTOM, label: "指定的固定文件" },
				{ value: UNFINISHED_KEEP, label: "留在原文件" }
			],
			settings.archiveUnfinishedTarget,
			(value) => (settings.archiveUnfinishedTarget = value)
		);

		text(
			"未完成任务的输出文件",
			"“指定的固定文件”时填写，例如 Tasks/待办。纯固定路径，不做日期替换，自动补 .md；留空则回退到基准日 + 1 天。",
			settings.archiveUnfinishedPath,
			"Tasks/待办",
			(value) => (settings.archiveUnfinishedPath = value)
		);

		dropdown(
			"整理方式",
			"移动：原文件中的这些任务行被移除；复制：原文件保留一份。",
			[
				{ value: ARCHIVE_MOVE, label: "移动" },
				{ value: ARCHIVE_COPY, label: "复制" }
			],
			settings.archiveMode,
			(value) => (settings.archiveMode = value)
		);

		dropdown(
			"无完成时间的已完成任务",
			"已勾选但没有时间记录的任务归到基准日文件，还是留在原文件。",
			[
				{ value: "base", label: "归到基准日文件" },
				{ value: "keep", label: "留在原文件" }
			],
			settings.archiveNoTimeDone,
			(value) => (settings.archiveNoTimeDone = value)
		);

		toggle(
			"跳过重复任务",
			"默认关闭：即使内容相同也全部照常移动。开启后，目标文件里已存在的同内容任务不再重复写入。",
			settings.archiveSkipDuplicates,
			(value) => (settings.archiveSkipDuplicates = value)
		);
		toggle(
			"整理时排除归档目录",
			"开启后不扫描归档目录（默认 Tasks）下的文件，恢复旧行为。默认关闭：归档目录里的文件可以被再次整理。",
			settings.archiveExcludeTasksFolder,
			(value) => (settings.archiveExcludeTasksFolder = value)
		);

		toggle(
			"整理时删除空任务行",
			"没有具体任务内容的行（如 - [ ] 或只有时间戳的行）直接从原文件删除，不写入归档文件。移动与复制模式都会清理。",
			settings.archiveRemoveEmptyTasks,
			(value) => (settings.archiveRemoveEmptyTasks = value)
		);
		toggle("归档文件插入分组标题", "整理后的日期文件里自动加上“已完成 / 待办”等标题。", settings.archiveGroupHeadings, (value) => (settings.archiveGroupHeadings = value));
		toggle("整理前弹确认框", "执行前展示将影响的文件与任务数量，取消则不写入任何文件。", settings.archiveConfirm, (value) => (settings.archiveConfirm = value));
		toggle("删除整理后变空的文件", "默认关闭；开启后，源文件被移空时会被删除。", settings.archiveDeleteEmptySource, (value) => (settings.archiveDeleteEmptySource = value));

		/* —— 触发方式 —— */
		section("触发方式");

		toggle(
			"只排序选中的区域",
			"编辑器中有选中内容时，只重排选区内的任务，其余内容不动。",
			settings.selectionOnly,
			(value) => (settings.selectionOnly = value)
		);

		dropdown(
			"自动排序",
			"关闭：只在你手动触发时排序；文件保存时：文件被修改后自动排序；编辑空闲时：停止输入若干秒后自动排序。",
			[
				{ value: AUTO_OFF, label: "关闭" },
				{ value: AUTO_SAVE, label: "文件保存时" },
				{ value: AUTO_IDLE, label: "编辑空闲时" }
			],
			settings.autoSort,
			(value) => {
				settings.autoSort = value;
				this.plugin.setupAutoSort();
			}
		);

		text(
			"自动排序的文件夹",
			"只对该目录下的文件自动排序，留空表示所有文件。",
			settings.autoFolder,
			"diary",
			(value) => (settings.autoFolder = value)
		);

		new Setting(containerEl)
			.setName("空闲秒数")
			.setDesc("“编辑空闲时”自动排序需要等待的秒数，最小 2 秒。")
			.addText((component) =>
				component
					.setPlaceholder("10")
					.setValue(String(settings.idleSeconds))
					.onChange((value) => {
						const seconds = Number(value);
						if (Number.isFinite(seconds) && seconds >= 2) {
							settings.idleSeconds = Math.round(seconds);
							this.plugin.queueSave();
						}
					})
			);

		/* —— 其他 —— */
		section("其他");

		toggle("显示操作提示", "排序/整理完成后在右上角显示统计信息。", settings.showNotice, (value) => (settings.showNotice = value));
	}
}

module.exports = TasksEnhancerPlugin;
module.exports.default = TasksEnhancerPlugin;
// 供本地自检使用（Obsidian 运行时不会用到）
module.exports.sortMarkdown = sortMarkdown;
module.exports.parseDocument = parseDocument;
module.exports.extractTimeKey = extractTimeKey;
module.exports.extractFieldKeys = extractFieldKeys;
module.exports.convertLinesToTasks = convertLinesToTasks;
module.exports.planArchive = planArchive;
module.exports.unfinishedTargetPath = unfinishedTargetPath;
module.exports.isEmptyTaskBody = isEmptyTaskBody;
module.exports.cleanEmptyTasks = cleanEmptyTasks;
module.exports.archiveSortOptions = archiveSortOptions;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
