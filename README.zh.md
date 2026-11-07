# dsh-plugin-session-tags

给 DeepSeek Harness 的会话打彩色标签。

标签是**有名字的一套**：名字和颜色在设置里统一定义，会话标题按标签染色，悬停时显示标签名——不是随手给一条会话涂个颜色，而是一套能跨设备同步的状态标记。

- 侧栏会话行的 `...` 菜单里点 **「标签」**：选中后该会话标题变色，鼠标停在会话上时悬浮卡片显示标签名。
- 选择框里可以直接新建标签：输入文字 + 选六种预设颜色或任意自定义颜色，点「新建并应用」当场打上。
- **设置 → 插件 → 会话标签** 里可以改文字、改颜色（预设或自定义）、删除、新增空白标签。
- 定义与分配保存在 `<DSH_HOME>/state/session-tags.json`；宿主路由不可达时退回 `localStorage`。
- 所有窗口和设备都跟随宿主的事件流：手机上打的标签，桌面不用重启就能看到。

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

## 宿主路由

```
GET  /session-tags                                              → { tags, assignments }
POST /session-tags { action: 'assign' }                         → 快照
POST /session-tags { action: 'createAndAssign', sessionId, tag } → 快照
POST /session-tags { action: 'tags', tags }                     → 快照
GET  /session-tags/events                                       → 同一份快照的 text/event-stream，
                                                                 之后每次写入都再推一遍
```

事件流负责让窗口之间、设备之间保持一致：任何一次成功的写入都会推给所有打开的流。
页面只在可见时挂着这条流——隐藏就断开，再显示时重新连上，而新连上的第一帧就是当前快照。
所以息屏的手机、切到后台的窗口不会一直占着连接，重新打开本身就是一次同步。建立不起流时
客户端会在下次重连时再拉一次 `/session-tags`，所以流被拒绝或被代理掐掉时退化成慢轮询，
不会停在旧状态。

## 安装

桌面版：**插件** → 安装，填包名 `dsh-plugin-session-tags`。网页版：

```sh
dsh plugin --profile web add dsh-plugin-session-tags@0.2.3
```

开发时指向本地目录：

```sh
plugin_manager install_bundle → /absolute/path/to/dsh-plugin-session-tags
```
