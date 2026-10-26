# dsh-plugin-session-tags

给 DeepSeek Harness 的会话打彩色标签。

- 侧栏会话行的 `...` 菜单里点 **「标签」**：选中后该会话标题变色，鼠标停在会话上时悬浮卡片显示标签名。
- 选择框里可以直接新建标签：输入文字 + 选六种预设颜色或任意自定义颜色，点「新建并应用」当场打上。
- **设置 → 插件 → 会话标签** 里可以改文字、改颜色（预设或自定义）、删除、新增空白标签。
- 定义与分配保存在 `<DSH_HOME>/state/session-tags.json`；宿主路由不可达时退回 `localStorage`。

颜色可以取预设名（`green`、`amber`、`red`、`blue`、`purple`、`gray`，都是主题 token，跟随深浅色），
也可以是显式的 `#rrggbb`。

## 用到的座位

| 座位 | 用途 |
|---|---|
| `sidebar.workspaces.session.menu.item` | 会话行 `...` 菜单里的「标签」 |
| `shell.overlay` | 选择框 |
| `sidebar.session.row.hover` | 悬浮卡片上的标签 |
| `settings.plugins.tab` | 标签定义 |

标题颜色没有现成座位，所以是按行自己的 `data-row-key="session:<id>"` 生成一条样式规则；
插件卸载时规则移除，标题恢复原色。

## 安装

```sh
plugin_manager install_bundle → /absolute/path/to/dsh-plugin-session-tags
```
