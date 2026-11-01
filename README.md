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
- Every window and device follows the host's event stream, so a tag set on the
  phone shows up on the desktop without a reload.

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
GET  /session-tags/events                                   → that snapshot as a text/event-stream,
                                                              pushed again after every mutation
```

The stream is what keeps windows and devices together: each accepted mutation is
written to every open stream. A page holds that stream only while it is visible —
hiding it closes the connection, showing it opens a new one, and the first frame
of a new stream is the current snapshot. So a sleeping phone or a hidden window
keeps nothing alive, and coming back is the catch-up. A client that cannot
establish a stream at all pulls `/session-tags` on the next reconnect attempt, so
a stripped stream degrades to slow polling instead of a stale page.

## Install

```sh
plugin_manager install_bundle → /absolute/path/to/dsh-plugin-session-tags
```
