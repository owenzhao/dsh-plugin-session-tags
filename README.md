# dsh-plugin-session-tags

Coloured tags for DeepSeek Harness sessions.

- **Sidebar row menu → 标签** opens a picker; the chosen tag tints that session's
  sidebar title and shows its label on the row's hover card.
- The same picker creates a tag on the spot: type a name, pick one of six colours
  or any custom colour, then **新建并应用** tags the session immediately.
- **Settings → Plugins → 会话标签** renames tags, recolours them (palette or
  custom), deletes them, or adds an empty one.
- Assignments and definitions persist to `<DSH_HOME>/state/session-tags.json`;
  when the host route is unreachable the browser falls back to `localStorage`.

A tag colour is either a palette name (`green`, `amber`, `red`, `blue`, `purple`,
`gray` — theme tokens, so light/dark follow the app) or an explicit `#rrggbb`.

## Seats used

| Seat | Purpose |
|---|---|
| `sidebar.workspaces.session.menu.item` | the `标签` row in a session's `...` menu |
| `shell.overlay` | the picker dialog |
| `sidebar.session.row.hover` | the tag chip on the hover card |
| `settings.plugins.tab` | tag definitions |

The title colour is a generated stylesheet rule keyed on the row's own
`data-row-key="session:<id>"` attribute; unmounting the plugin removes it and the
shipped colours return.

## Host route

```
GET  /session-tags                                          → { tags, assignments }
POST /session-tags { action: 'assign' }                     → snapshot
POST /session-tags { action: 'createAndAssign', sessionId, tag } → snapshot
POST /session-tags { action: 'tags', tags }                 → snapshot
```

## Install

```sh
plugin_manager install_bundle → /absolute/path/to/dsh-plugin-session-tags
```
