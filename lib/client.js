/**
 * Browser half of dsh-plugin-session-tags.
 *
 * Three seats, one shared store:
 *
 *   sidebar.workspaces.session.menu.item  → the row's "标签" entry, opening the picker
 *   shell.overlay                         → the picker dialog itself
 *   sidebar.session.row.hover             → the tag chip inside the row's hover card
 *   settings.plugins.tab                  → tag definitions (name + colour)
 *
 * The store belongs to the host: it is pulled once here and then kept current by
 * the host's event stream while the page is visible. Hiding the page closes the
 * stream and showing it opens a new one, whose first frame is the current
 * snapshot — so every window and device shows the same tags, and nothing is held
 * open in the background.
 *
 * The title colour is the one thing no slot exposes, so it is a stylesheet rule
 * keyed on the row's own `data-row-key` attribute: one rule per tagged Session,
 * regenerated whenever the store changes. Nothing else in the host DOM is
 * written, and removing the style element restores the shipped colours.
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-session-tags",
	factory: (require) => {
		const React = require("react");
		const h = React.createElement;

		const NS = "session-tags";
		const ROUTE = "/session-tags";
		const STREAM_ROUTE = "/session-tags/events";
		const LOCAL_KEY = "dsh.session-tags.v1";
		/** Debounce for persisting tag-definition edits made in the settings page. */
		const SAVE_DELAY_MS = 400;
		/** Ignore a second pull that would only repeat one made moments ago. */
		const PULL_GAP_MS = 2000;

		/** Tag colours. Every entry but purple is a theme token, so light/dark follow the app. */
		const PALETTE = [
			{ id: "green", value: "var(--dsw-alias-state-success-primary)", fallback: "#2f9e44" },
			{ id: "amber", value: "var(--dsw-alias-state-warn-primary)", fallback: "#d9a60b" },
			{ id: "red", value: "var(--dsw-alias-state-error-primary)", fallback: "#d64545" },
			{ id: "blue", value: "var(--dsw-alias-state-business-primary)", fallback: "#3b7ddd" },
			{ id: "purple", value: "#a855f7", fallback: "#a855f7" },
			{ id: "gray", value: "var(--dsw-alias-state-idle-primary)", fallback: "#8a8f98" }
		];
		/** A tag colour is either a palette name or the user's own `#rrggbb`. */
		const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
		const FALLBACK_COLOR = PALETTE[PALETTE.length - 1].value;

		const DEFAULT_TAGS = [
			{ id: "done", label: "已完成", color: "green" },
			{ id: "testing", label: "等待测试", color: "amber" },
			{ id: "progress", label: "进行中", color: "blue" },
			{ id: "blocked", label: "待修复", color: "red" },
			{ id: "later", label: "待处理", color: "purple" }
		];

		const DICTS = {
			zh: {
				"menu.assign": "标签",
				"menu.assigned": "标签：{name}",
				"picker.title": "设置会话标签",
				"picker.clear": "清除标签",
				"picker.empty": "还没有标签。先到 设置 → 插件 → 会话标签 里添加。",
				"picker.close": "关闭",
				"picker.newPlaceholder": "新标签文字…",
				"picker.create": "新建并应用",
				"picker.hint": "标签的文字和颜色可以在 设置 → 插件 → 会话标签 里修改。",
				"settings.tab": "会话标签",
				"settings.intro": "给侧栏的会话打标签：标签会改变会话标题的颜色，鼠标停在会话上时会显示标签名。",
				"settings.add": "添加标签",
				"settings.newTag": "新标签",
				"settings.name": "标签名",
				"settings.delete": "删除",
				"settings.custom": "自定义颜色",
				"settings.offline": "没连上宿主进程，标签只保存在这个浏览器里。",
				"color.green": "绿",
				"color.amber": "黄",
				"color.red": "红",
				"color.blue": "蓝",
				"color.purple": "紫",
				"color.gray": "灰"
			},
			en: {
				"menu.assign": "Tag",
				"menu.assigned": "Tag: {name}",
				"picker.title": "Set session tag",
				"picker.clear": "Clear tag",
				"picker.empty": "No tags yet. Add some in Settings → Plugins → Session tags.",
				"picker.close": "Close",
				"picker.newPlaceholder": "New tag text…",
				"picker.create": "Create and apply",
				"picker.hint": "Rename tags and change their colours in Settings → Plugins → Session tags.",
				"settings.tab": "Session tags",
				"settings.intro": "Tag sidebar sessions: the tag colour tints the session title and the tag name shows on the row's hover card.",
				"settings.add": "Add tag",
				"settings.newTag": "New tag",
				"settings.name": "Tag name",
				"settings.delete": "Delete",
				"settings.custom": "Custom colour",
				"settings.offline": "The host process is unreachable, so tags live in this browser only.",
				"color.green": "Green",
				"color.amber": "Amber",
				"color.red": "Red",
				"color.blue": "Blue",
				"color.purple": "Purple",
				"color.gray": "Gray"
			}
		};

		/** Identity translation until the Client locale service hands one over. */
		let translate = (key, params) => {
			const template = DICTS.zh[key] ?? DICTS.en[key] ?? key;
			if (params === undefined) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) =>
				name in params ? String(params[name]) : match
			);
		};
		const t = (key, params) => translate(key, params);

		/** Everything the seats read; mutations go through the helpers below. */
		const store = {
			tags: DEFAULT_TAGS,
			assignments: {},
			picker: null,
			loaded: false,
			host: true,
			listeners: new Set()
		};

		function emit() {
			for (const listener of [...store.listeners]) {
				try {
					listener();
				} catch (error) {
					// One broken subscriber must not stop the others.
				}
			}
		}

		function colorOf(tag) {
			if (tag === undefined || tag === null) return FALLBACK_COLOR;
			if (typeof tag.color === "string" && HEX_COLOR.test(tag.color)) return tag.color;
			const entry = PALETTE.find((item) => item.id === tag.color);
			return entry === undefined ? FALLBACK_COLOR : entry.value;
		}

		/** The same colour as a real hex, for `<input type="color">` values. */
		function hexOf(tag) {
			if (tag !== undefined && tag !== null && typeof tag.color === "string" && HEX_COLOR.test(tag.color)) {
				return tag.color;
			}
			const entry = PALETTE.find((item) => item.id === (tag === undefined || tag === null ? "" : tag.color));
			return entry === undefined ? "#8a8f98" : entry.fallback;
		}

		function tagOf(tagId) {
			if (typeof tagId !== "string") return undefined;
			return store.tags.find((tag) => tag.id === tagId);
		}

		/** Adopt a host or local snapshot. */
		function adopt(snapshot) {
			if (snapshot === null || typeof snapshot !== "object") return;
			if (Array.isArray(snapshot.tags) && snapshot.tags.length > 0) store.tags = snapshot.tags;
			if (snapshot.assignments !== null && typeof snapshot.assignments === "object") {
				store.assignments = { ...snapshot.assignments };
			}
		}

		function readLocal() {
			try {
				const raw = window.localStorage.getItem(LOCAL_KEY);
				return raw === null ? undefined : JSON.parse(raw);
			} catch (error) {
				return undefined;
			}
		}

		function saveLocal() {
			try {
				window.localStorage.setItem(
					LOCAL_KEY,
					JSON.stringify({ tags: store.tags, assignments: store.assignments })
				);
			} catch (error) {
				// Storage may be unavailable; the host copy is the durable one regardless.
			}
		}

		/** Adopt one authoritative snapshot and let every seat re-render. */
		function receive(snapshot) {
			adopt(snapshot);
			store.host = true;
			store.loaded = true;
			emit();
		}

		let lastPullAt = 0;
		/** Read the whole state; the event stream keeps it current from then on. */
		async function refresh() {
			lastPullAt = Date.now();
			try {
				const response = await fetch(ROUTE, { cache: "no-store" });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				receive(await response.json());
			} catch (error) {
				// Only the first load falls back to this browser's copy, and only when the
				// host is unreachable; a later failure keeps the last good snapshot.
				if (store.loaded) return;
				const local = readLocal();
				if (local !== undefined) adopt(local);
				store.host = false;
				store.loaded = true;
				emit();
			}
		}

		/** Follow host pushes; returns a disposer, or a no-op without EventSource. */
		function follow() {
			if (typeof EventSource !== "function") return () => {};
			const source = new EventSource(STREAM_ROUTE);
			source.addEventListener("message", (event) => {
				let snapshot;
				try {
					snapshot = JSON.parse(event.data);
				} catch (error) {
					return;
				}
				receive(snapshot);
			});
			source.addEventListener("error", () => {
				// A dropped stream reconnects by itself; this pull covers the reconnect
				// that never comes, so the page cannot sit on a stale snapshot.
				if (Date.now() - lastPullAt > PULL_GAP_MS) void refresh();
			});
			return () => source.close();
		}

		let stopStream = null;
		/**
		 * Hold the connection only while the page is being looked at. Hiding it closes the
		 * stream, and showing it opens a new one — the snapshot that arrives on connect is
		 * the catch-up, so a closed tab or a sleeping phone keeps nothing alive.
		 */
		function syncStream() {
			if (document.visibilityState === "hidden") {
				if (stopStream !== null) {
					stopStream();
					stopStream = null;
				}
				return;
			}
			if (stopStream === null) stopStream = follow();
		}

		async function post(body) {
			saveLocal();
			try {
				const response = await fetch(ROUTE, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				adopt(await response.json());
				store.host = true;
			} catch (error) {
				store.host = false;
			}
			saveLocal();
			emit();
		}

		/** One Session's tag; `tagId === null` clears it. */
		function assign(sessionId, tagId) {
			const next = { ...store.assignments };
			if (tagId === null || tagId === undefined) delete next[sessionId];
			else next[sessionId] = tagId;
			store.assignments = next;
			emit();
			void post({ action: "assign", sessionId, tagId: tagId ?? null });
		}

		function publishTags(tags) {
			store.tags = tags;
			const known = new Set(tags.map((tag) => tag.id));
			const next = {};
			for (const [sessionId, tagId] of Object.entries(store.assignments)) {
				if (known.has(tagId)) next[sessionId] = tagId;
			}
			store.assignments = next;
			emit();
			void post({ action: "tags", tags });
		}

		let saveTimer = null;
		/** Persist definition edits once typing pauses. */
		function publishTagsSoon(tags) {
			store.tags = tags;
			emit();
			if (saveTimer !== null) clearTimeout(saveTimer);
			saveTimer = setTimeout(() => {
				saveTimer = null;
				publishTags(store.tags);
			}, SAVE_DELAY_MS);
		}

		/** Create one tag and put it on `sessionId` in a single host round-trip. */
		function createTag(sessionId, label, color) {
			const text = typeof label === "string" ? label.trim().slice(0, 40) : "";
			if (text === "" || sessionId === null || sessionId === undefined) return;
			const tag = {
				id: nextTagId(),
				label: text,
				color: typeof color === "string" && color !== "" ? color : "gray"
			};
			store.tags = [...store.tags, tag];
			store.assignments = { ...store.assignments, [sessionId]: tag.id };
			emit();
			void post({ action: "createAndAssign", sessionId, tag });
		}

		function openPicker(sessionId) {
			store.picker = sessionId;
			emit();
		}

		function closePicker() {
			store.picker = null;
			emit();
		}

		/** Re-render a component on every store change. */
		function useStoreVersion() {
			const [, bump] = React.useState(0);
			React.useEffect(() => {
				const listener = () => bump((value) => value + 1);
				store.listeners.add(listener);
				return () => {
					store.listeners.delete(listener);
				};
			}, []);
			return store;
		}

		const TAG_ICON = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none" };
		function TagIcon() {
			return h(
				"svg",
				{ ...TAG_ICON, "aria-hidden": true },
				h("path", {
					d: "M2.5 3.2c0-.4.3-.7.7-.7h4.1c.2 0 .4.1.5.2l5.3 5.3c.3.3.3.7 0 1l-3.9 3.9a.7.7 0 0 1-1 0L2.7 7.6a.7.7 0 0 1-.2-.5V3.2Z",
					stroke: "currentColor",
					"stroke-width": 1.2,
					"stroke-linejoin": "round"
				}),
				h("circle", { cx: 5.2, cy: 5.5, r: 1.05, fill: "currentColor" })
			);
		}

		const CSS = `
.sg-menuItemWrap { position: relative; }
.sg-menuItem { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 34px; padding: 6px 8px; border: none; border-radius: var(--dsw-radius-md); background: transparent; cursor: pointer; font-family: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); text-align: left; }
.sg-menuItem:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sg-menuItem:focus-visible { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
.sg-menuIcon { display: inline-flex; flex: none; width: 14px; height: 14px; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }
.sg-menuLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-swatch { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.sg-hoverTag { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 20px; color: #cfd3d6; }
.sg-backdrop { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px; pointer-events: auto; }
.sg-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.35)); backdrop-filter: var(--dsw-mask-blur, blur(2px)); }
.sg-dialog { position: relative; z-index: 1; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; width: min(360px, 100%); max-height: min(70vh, 560px); overflow: auto; padding: 16px; border-radius: var(--dsw-radius-panel); background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary); }
.sg-dialogTitle { font-size: 14px; line-height: 20px; }
.sg-choiceList { display: flex; flex-direction: column; gap: 2px; }
.sg-choice { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 5px 8px; border: none; border-radius: var(--dsw-radius-md); background: transparent; cursor: pointer; font-family: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); text-align: left; }
.sg-choice:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sg-choice:focus-visible { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
.sg-choiceLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-choiceActive { color: var(--dsw-alias-brand-primary); }
.sg-check { flex: none; font-size: 12px; color: var(--dsw-alias-brand-primary); }
.sg-empty { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.sg-dialogFooter { display: flex; justify-content: flex-end; }
.sg-footerButton { padding: 5px 14px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: transparent; cursor: pointer; font-family: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); }
.sg-footerButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sg-section { display: flex; flex-direction: column; gap: 10px; padding: 4px 0 12px; }
.sg-intro { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.sg-tagList { display: flex; flex-direction: column; }
.sg-tagRow { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.sg-input { flex: 1; min-width: 0; padding: 4px 6px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; font-family: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); outline: none; }
.sg-input:focus { border-color: var(--dsw-alias-brand-primary); }
.sg-colors { display: flex; align-items: center; gap: 5px; flex: none; }
.sg-colorButton { width: 14px; height: 14px; padding: 0; border: none; border-radius: 50%; cursor: pointer; }
.sg-colorButtonOn { box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1), 0 0 0 3px var(--dsw-alias-label-primary); }
.sg-textButton { flex: none; padding: 3px 8px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; cursor: pointer; font-family: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.sg-textButton:hover { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.sg-add { align-self: flex-start; padding: 5px 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: transparent; cursor: pointer; font-family: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); }
.sg-add:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sg-offline { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-primary); }
.sg-create { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.sg-create .sg-input { flex: 1 1 130px; }
.sg-createButton { padding: 5px 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: transparent; cursor: pointer; font-family: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); }
.sg-createButton:disabled { opacity: 0.45; cursor: default; }
.sg-createButton:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); }
.sg-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.sg-colorInput { width: 22px; height: 16px; padding: 0; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-xs); background: transparent; cursor: pointer; }
`;

		/** The row's "标签" entry: dismiss the menu first, then raise the picker. */
		function TagMenuItem(props) {
			useStoreVersion();
			const sessionId = props.sessionId;
			const hook = typeof props.useMenuOpenState === "function" ? props.useMenuOpenState : undefined;
			const state = hook === undefined ? undefined : hook();
			const setMenuOpen = Array.isArray(state) && typeof state[1] === "function" ? state[1] : undefined;
			const tag = tagOf(store.assignments[sessionId]);
			return h(
				"div",
				{ className: "sg-menuItemWrap" },
				h(
					"button",
					{
						type: "button",
						role: "menuitem",
						className: "sg-menuItem",
						onClick: () => {
							try {
								if (setMenuOpen !== undefined) setMenuOpen(false);
							} catch (error) {
								// A missing menu simply stays open.
							}
							openPicker(sessionId);
						}
					},
					h("span", { className: "sg-menuIcon" }, h(TagIcon)),
					h("span", { className: "sg-menuLabel" }, tag === undefined
						? t("menu.assign")
						: t("menu.assigned", { name: tag.label })),
					tag === undefined
						? null
						: h("span", { className: "sg-swatch", style: { background: colorOf(tag) } })
				)
			);
		}

		/** One tag chip in the Session row's hover card. */
		function HoverTag(props) {
			useStoreVersion();
			const tag = tagOf(store.assignments[props.sessionId]);
			if (tag === undefined) return null;
			return h(
				"div",
				{ className: "sg-hoverTag" },
				h("span", { className: "sg-swatch", style: { background: colorOf(tag) } }),
				h("span", null, tag.label)
			);
		}

		/** The picker dialog; mounted in the frame overlay and inert while closed. */
		function TagPicker() {
			useStoreVersion();
			const sessionId = store.picker;
			const dialogRef = React.useRef(null);
			/** Draft for the "create a tag right here" form. */
			const [draft, setDraft] = React.useState("");
			const [draftColor, setDraftColor] = React.useState("gray");

			React.useEffect(() => {
				if (sessionId === null) return undefined;
				setDraft("");
				setDraftColor("gray");
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						closePicker();
					}
				};
				document.addEventListener("keydown", onKeyDown);
				const timer = setTimeout(() => {
					try {
						const button = dialogRef.current?.querySelector("button");
						if (button !== null && button !== undefined) button.focus();
					} catch (error) {
						// Focus is a courtesy; the dialog works without it.
					}
				}, 0);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
					clearTimeout(timer);
				};
			}, [sessionId]);

			if (sessionId === null) return null;
			const current = store.assignments[sessionId];
			return h(
				"div",
				{ className: "sg-backdrop", role: "presentation", onMouseDown: (event) => {
					if (event.target === event.currentTarget) closePicker();
				} },
				h("div", { className: "sg-mask", "aria-hidden": "true" }),
				h(
					"div",
					{
						ref: dialogRef,
						className: "sg-dialog",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("picker.title")
					},
					h("div", { className: "sg-dialogTitle" }, t("picker.title")),
					store.tags.length === 0
						? h("div", { className: "sg-empty" }, t("picker.empty"))
						: h(
								"div",
								{ className: "sg-choiceList" },
								store.tags.map((tag) =>
									h(
										"button",
										{
											key: tag.id,
											type: "button",
											className: current === tag.id ? "sg-choice sg-choiceActive" : "sg-choice",
											onClick: () => {
												assign(sessionId, tag.id);
												closePicker();
											}
										},
										h("span", { className: "sg-swatch", style: { background: colorOf(tag) } }),
										h("span", { className: "sg-choiceLabel" }, tag.label),
										current === tag.id ? h("span", { className: "sg-check" }, "✓") : null
									)
								)
							),
					h(
						"div",
						{ className: "sg-create" },
						h("input", {
							className: "sg-input",
							value: draft,
							placeholder: t("picker.newPlaceholder"),
							"aria-label": t("picker.newPlaceholder"),
							maxLength: 40,
							onChange: (event) => setDraft(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter" && draft.trim() !== "") {
									event.preventDefault();
									createTag(sessionId, draft, draftColor);
									closePicker();
								}
							}
						}),
						h(
							"span",
							{ className: "sg-colors" },
							PALETTE.map((entry) =>
								h("button", {
									key: entry.id,
									type: "button",
									title: t(`color.${entry.id}`),
									"aria-label": t(`color.${entry.id}`),
									className: draftColor === entry.id ? "sg-colorButton sg-colorButtonOn" : "sg-colorButton",
									style: { background: entry.value },
									onClick: () => setDraftColor(entry.id)
								})
							),
							h("input", {
								type: "color",
								className: "sg-colorInput",
								"aria-label": t("settings.custom"),
								title: t("settings.custom"),
								value: HEX_COLOR.test(draftColor) ? draftColor : hexOf({ color: draftColor }),
								onChange: (event) => setDraftColor(event.target.value)
							})
						),
						h(
							"button",
							{
								type: "button",
								className: "sg-createButton",
								disabled: draft.trim() === "",
								onClick: () => {
									createTag(sessionId, draft, draftColor);
									closePicker();
								}
							},
							t("picker.create")
						)
					),
					h(
						"div",
						{ className: "sg-choiceList" },
						h(
							"button",
							{
								type: "button",
								className: "sg-choice",
								onClick: () => {
									assign(sessionId, null);
									closePicker();
								}
							},
							h("span", { className: "sg-menuIcon" }, h(TagIcon)),
							h("span", { className: "sg-choiceLabel" }, t("picker.clear"))
						)
					),
					h("div", { className: "sg-hint" }, t("picker.hint")),
					h(
						"div",
						{ className: "sg-dialogFooter" },
						h(
							"button",
							{ type: "button", className: "sg-footerButton", onClick: closePicker },
							t("picker.close")
						)
					)
				)
			);
		}

		function nextTagId() {
			return `tag-${Date.now().toString(36)}`;
		}

		/** One editable tag definition. */
		function TagRow(props) {
			const tag = props.tag;
			return h(
				"div",
				{ className: "sg-tagRow" },
				h("input", {
					className: "sg-input",
					value: tag.label,
					"aria-label": t("settings.name"),
					maxLength: 40,
					onChange: (event) => {
						const label = event.target.value;
						publishTagsSoon(store.tags.map((item) => (item.id === tag.id ? { ...item, label } : item)));
					},
					onBlur: () => {
						if (tag.label.trim() === "") {
							publishTags(store.tags.map((item) => (item.id === tag.id ? { ...item, label: t("settings.newTag") } : item)));
						}
					}
				}),
				h(
					"span",
					{ className: "sg-colors" },
					PALETTE.map((entry) =>
						h("button", {
							key: entry.id,
							type: "button",
							title: t(`color.${entry.id}`),
							"aria-label": t(`color.${entry.id}`),
							className: entry.id === tag.color ? "sg-colorButton sg-colorButtonOn" : "sg-colorButton",
							style: { background: entry.value },
							onClick: () => {
								publishTags(store.tags.map((item) => (item.id === tag.id ? { ...item, color: entry.id } : item)));
							}
						})
					),
					h("input", {
						type: "color",
						className: "sg-colorInput",
						"aria-label": t("settings.custom"),
						title: t("settings.custom"),
						value: hexOf(tag),
						onChange: (event) => {
							const color = event.target.value;
							publishTags(store.tags.map((item) => (item.id === tag.id ? { ...item, color } : item)));
						}
					})
				),
				h(
					"button",
					{
						type: "button",
						className: "sg-textButton",
						onClick: () => {
							publishTags(store.tags.filter((item) => item.id !== tag.id));
						}
					},
					t("settings.delete")
				)
			);
		}

		/** Settings → Plugins tab: the tag definitions. */
		function SettingsSection() {
			useStoreVersion();
			return h(
				"div",
				{ className: "sg-section" },
				h("div", { className: "sg-intro" }, t("settings.intro")),
				h(
					"div",
					{ className: "sg-tagList" },
					store.tags.map((tag) => h(TagRow, { key: tag.id, tag: tag }))
				),
				h(
					"button",
					{
						type: "button",
						className: "sg-add",
						onClick: () => {
							publishTags([...store.tags, { id: nextTagId(), label: t("settings.newTag"), color: "gray" }]);
						}
					},
					t("settings.add")
				),
				store.loaded && store.host === false ? h("div", { className: "sg-offline" }, t("settings.offline")) : null
			);
		}

		/** One rule per tagged Session: the row's second span is its title. */
		function titleRules() {
			const rules = [];
			for (const [sessionId, tagId] of Object.entries(store.assignments)) {
				const tag = tagOf(tagId);
				if (tag === undefined) continue;
				const key = `session:${sessionId}`.replace(/["\\]/g, "\\$&");
				rules.push(`[data-row-key="${key}"] > span:nth-of-type(2) { color: ${colorOf(tag)}; }`);
			}
			return rules.join("\n");
		}

		function apply(ctx) {
			try {
				if (ctx.locale !== undefined && typeof ctx.locale.register === "function") {
					try {
						const dispose = ctx.locale.register(NS, DICTS);
						ctx.effect(() => dispose, "session-tags: locale");
						translate = ctx.locale.bind(NS);
					} catch (error) {
						// Re-registering an existing namespace keeps the previous dictionary.
					}
				}
			} catch (error) {
				// Locale is a convenience; the built-in Chinese copy still renders.
			}

			const style = document.createElement("style");
			style.setAttribute("data-dsh-session-tags", "");
			const syncStyles = () => {
				style.textContent = `${CSS}\n${titleRules()}`;
			};
			syncStyles();
			document.head.appendChild(style);
			store.listeners.add(syncStyles);
			ctx.effect(
				() => () => {
					store.listeners.delete(syncStyles);
					if (saveTimer !== null) {
						clearTimeout(saveTimer);
						saveTimer = null;
					}
					style.remove();
				},
				"session-tags: styles and timers"
			);

			try {
				ctx.slots.inject("sidebar.workspaces.session.menu.item", () =>
					ctx.slots.register(
						{
							name: "sidebar.workspaces.session.menu.item",
							id: "session-tags",
							order: 350
						},
						TagMenuItem
					)
				);
			} catch (error) {
				// Row menu absent; the picker stays reachable from the settings page.
			}

			try {
				ctx.slots.inject("sidebar.session.row.hover", () =>
					ctx.slots.register(
						{
							name: "sidebar.session.row.hover",
							id: "session-tags",
							order: 20
						},
						HoverTag
					)
				);
			} catch (error) {
				// Hover card absent.
			}

			try {
				ctx.slots.inject("shell.overlay", () =>
					ctx.slots.register(
						{
							name: "shell.overlay",
							id: "session-tags-picker",
							order: 60
						},
						TagPicker
					)
				);
			} catch (error) {
				// Without an overlay the picker cannot open; the settings page still edits tags.
			}

			try {
				ctx.slots.inject("settings.plugins.tab", () =>
					ctx.slots.register(
						{
							name: "settings.plugins.tab",
							id: "session-tags",
							order: 45,
							label: () => t("settings.tab")
						},
						SettingsSection
					)
				);
			} catch (error) {
				// Settings page absent.
			}

			void refresh();
			syncStream();
			document.addEventListener("visibilitychange", syncStream);
			ctx.effect(() => () => {
				document.removeEventListener("visibilitychange", syncStream);
				if (stopStream !== null) {
					stopStream();
					stopStream = null;
				}
			}, "session-tags: event stream");
		}

		return {
			inject: ["slots"],
			apply
		};
	}
});
