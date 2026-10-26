# dsh-plugin-session-tags

Coloured tags for DeepSeek Harness sessions.

- **Sidebar row menu → 标签** opens a picker; the chosen tag tints that session's
  sidebar title and shows its label on the row's hover card.
- **Settings → Plugins → 会话标签** edits the tag definitions (name and colour);
  edits persist to `<DSH_HOME>/state/session-tags.json`.

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

## Install

```sh
plugin_manager install_bundle → /absolute/path/to/dsh-plugin-session-tags
```
