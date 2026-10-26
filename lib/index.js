/**
 * Host half of dsh-plugin-session-tags.
 *
 * The browser half owns every bit of presentation; the only thing it cannot do
 * is keep state across reloads and windows. So this half owns one small file
 * (`<DSH_HOME>/state/session-tags.json`) and serves it on one route:
 *
 *   GET  /session-tags                       → { tags, assignments }
 *   POST /session-tags { action: 'assign' }  → the same snapshot
 *   POST /session-tags { action: 'tags' }    → replace the tag definitions
 *
 * A Session's tag is keyed by its Session id; the tag list is what the picker
 * and the settings page display. Assignments whose tag disappeared are dropped
 * on read, so deleting a tag never leaves a dangling colour behind.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROUTE = "/session-tags";
const STATE_DIR = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "state");
const STATE_FILE = join(STATE_DIR, "session-tags.json");
const MAX_BODY = 64 * 1024;
const COLORS = new Set(["green", "amber", "red", "blue", "purple", "gray"]);
/** A tag colour is either one of the palette names above or an explicit `#rrggbb`. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The tag set a fresh install starts with. */
const DEFAULT_TAGS = [
	{ id: "done", label: "已完成", color: "green" },
	{ id: "testing", label: "等待测试", color: "amber" },
	{ id: "progress", label: "进行中", color: "blue" },
	{ id: "blocked", label: "待修复", color: "red" },
	{ id: "later", label: "待处理", color: "gray" }
];

function readState() {
	try {
		const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
		return parsed !== null && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeState(next) {
	try {
		mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`);
	} catch {
		// A read-only home only loses durability; the browser keeps its own copy.
	}
}

/** Coerce one persisted or submitted tag list into the shape this plugin serves. */
function normalizeTags(value) {
	if (!Array.isArray(value)) return undefined;
	const seen = new Set();
	const tags = [];
	for (const entry of value) {
		if (entry === null || typeof entry !== "object") continue;
		const id = typeof entry.id === "string" ? entry.id.trim() : "";
		const label = typeof entry.label === "string" ? entry.label.trim().slice(0, 40) : "";
		const rawColor = typeof entry.color === "string" ? entry.color.trim() : "";
		const color = COLORS.has(rawColor) ? rawColor : HEX_COLOR.test(rawColor) ? rawColor.toLowerCase() : "gray";
		if (id === "" || label === "" || seen.has(id)) continue;
		seen.add(id);
		tags.push({ id, label, color });
	}
	return tags.length === 0 ? undefined : tags;
}

/** The complete state the page works from. */
function snapshot() {
	const state = readState();
	const tags = normalizeTags(state.tags) ?? DEFAULT_TAGS;
	const known = new Set(tags.map((tag) => tag.id));
	const assignments = {};
	const stored =
		state.assignments !== null && typeof state.assignments === "object" ? state.assignments : {};
	for (const [sessionId, tagId] of Object.entries(stored)) {
		if (typeof tagId === "string" && known.has(tagId)) assignments[sessionId] = tagId;
	}
	return { tags, assignments };
}

/** Apply one accepted mutation and answer with the resulting snapshot. */
function mutate(body) {
	const state = readState();
	const current = snapshot();
	if (body.action === "assign") {
		const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
		if (sessionId === "") return current;
		const assignments = { ...state.assignments, ...current.assignments };
		const tagId = typeof body.tagId === "string" ? body.tagId : undefined;
		if (tagId === undefined || !current.tags.some((tag) => tag.id === tagId)) delete assignments[sessionId];
		else assignments[sessionId] = tagId;
		writeState({ ...state, tags: current.tags, assignments });
		return snapshot();
	}
	if (body.action === "createAndAssign") {
		const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
		const created = normalizeTags([body.tag])?.[0];
		if (sessionId === "" || created === undefined) return current;
		const tags = [...current.tags.filter((tag) => tag.id !== created.id), created];
		const assignments = { ...state.assignments, ...current.assignments, [sessionId]: created.id };
		writeState({ ...state, tags, assignments });
		return snapshot();
	}
	if (body.action === "tags") {
		const tags = normalizeTags(body.tags) ?? DEFAULT_TAGS;
		const known = new Set(tags.map((tag) => tag.id));
		const assignments = {};
		for (const [sessionId, tagId] of Object.entries({ ...state.assignments, ...current.assignments })) {
			if (typeof tagId === "string" && known.has(tagId)) assignments[sessionId] = tagId;
		}
		writeState({ ...state, tags, assignments });
		return snapshot();
	}
	return current;
}

export function apply(ctx) {
	ctx.inject(["webServer"], (scoped) => {
		try {
			const dispose = scoped.webServer.register({
				kind: "exact",
				path: ROUTE,
				handler: (req, res) => {
					res.setHeader("content-type", "application/json; charset=utf-8");
					res.setHeader("cache-control", "no-store");
					if (req.method !== "POST") {
						res.end(JSON.stringify(snapshot()));
						return;
					}
					let body = "";
					req.on("data", (chunk) => {
						body += chunk;
						if (body.length > MAX_BODY) req.destroy();
					});
					req.on("end", () => {
						try {
							const parsed = JSON.parse(body || "{}");
							res.end(JSON.stringify(mutate(parsed !== null && typeof parsed === "object" ? parsed : {})));
						} catch {
							res.statusCode = 400;
							res.end(JSON.stringify({ error: "invalid JSON body" }));
						}
					});
				}
			});
			scoped.effect(() => dispose, "session-tags: route");
		} catch {
			// Headless runs have no web server; the browser half then keeps its own copy.
		}
	});
}
