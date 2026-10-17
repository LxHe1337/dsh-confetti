# dsh-confetti

中文 | [English](README.md)

**每轮对话收尾，窗口左下角与右下角各喷一束彩带；输入框旁还有一个 🎉 按钮，按一下也能喷。**

一个 DeepSeek Harness（DSH）的 Web 客户端插件：纯前端效果，不需要 Host 服务、不需要构建步骤、不注册任何工具。

![对话收尾后 0.4 秒的两束彩带](docs/effect.png)

> 上图是无头仿真在 0.4 s 抓到的画布内容（真实引擎绘制指令的回放），不是 UI 截图。

## 特性

- **自动**：某个会话的最后一步落地（`running` 由 `true` 翻成 `false`），两个下角各打一炮——彩带朝画面中心抛出去、翻着面下落、淡出，然后画布自己收工。
- **手动**：输入框右侧工具栏（发送键左边）多一个 🎉，按一次撒一把；连点连撒，不受自动庆祝的冷却限制。
- **轻**：只有彩带在飞的时候才有 `requestAnimationFrame`，其余时间零开销；粒子上限 640 片，飞出画面即回收，队列空了自动停表。
- **不打扰**：跳过子会话、后台标签页不补喷、尊重 `prefers-reduced-motion`（开启时只喷一小撮，且没有第二波）。
- **不占地**：不新开面板、不加持久 UI；唯一的界面席位是外壳已经留好的输入框工具栏插槽。

## 安装

前提：一个正在运行的 DSH（桌面端，或 `dsh web`），以及一个 profile。下文以 `desktop` 为例；`$env:DSH_PROFILE` 会告诉你当前是哪个。

```powershell
git clone https://github.com/<you>/dsh-confetti.git
dsh plugin --profile desktop add ./dsh-confetti
```

装完刷新一次页面（桌面端重新打开也行），让浏览器拉到新的客户端 bundle。

这条命令是按**链接**方式挂载的，所以克隆下来的目录就是插件本体：之后改 `lib/client.js`、刷新页面即可生效，不需要重新安装。

确认它活着——控制台应出现一行：

```
[dsh-confetti] armed — every completed turn gets a popper in each bottom corner; press the confetti button in the composer to fire one now
```

没有 CLI 时的手动挂载：把仓库目录放到 `%USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-confetti`，在该 profile 的 `package.json` 中把 `"dsh-confetti"` 加进 `dependencies`（值写 `link:<目录>`）与 `dsh.profile.bundles`，然后重启。

> 这里的示例按 Windows / PowerShell 写。macOS 与 Linux 上 `dsh` 命令相同，profile 目录在 `~/.dsh/profiles/<profile>`；`verify/` 里的渲染脚本只支持 PowerShell，但仿真本身只需要 Node。

## 用法

### 自动：什么时候喷

插件订阅客户端的会话列表快照 `ctx.get('sessions').list`，逐个会话比较 `byId[id].running`：

- 只认**亲眼看到**的 `true → false`：页面刚打开时已经是 `running: false` 的历史会话不会喷，打开旧会话不会乱放炮。
- 跳过委派出去的子会话（`origin === 'subagent'` 或带 `parentId`），一个 workflow / subagent 批量收尾不会连喷。
- 900 ms 冷却：多个会话同一刻收尾，只庆祝一次。
- 页面在后台（`document.visibilityState === 'hidden'`）时跳过，切回来不会补喷。

### 手动：那个按钮

`🎉` 在输入框右侧工具栏，紧挨发送键（插槽 `conversation.input.right`，`order: 10`）。悬停有提示，`Tab` 可聚焦、`Enter`/`Space` 触发；提示与无障碍标签走界面词典（中文「撒彩带」/ English "Confetti"）。

按钮只负责「再喷一次」，不改任何会话状态——不生成内容、不发消息，对话没在跑时也能按。

### 控制台 API

```js
__dshConfetti.fire()               // 喷一次
__dshConfetti.fire({ density: 2 }) // 更密
__dshConfetti.clear()              // 收掉画布与所有粒子
```

## 配置

零配置即可用。要调的话，在 profile 的 patch（`cordis.patch.yml`）里给这个 entry 加 `config`：

```yaml
- id: dsh-confetti
  name: 'dsh-confetti'
  config:
    enabled: true     # false = 什么都不挂（按钮也没有）
    button: true      # false = 保留自动效果，去掉输入框按钮
    density: 1        # 彩带数量倍率，0.25 ~ 3
```

## 兼容性

- 自动效果只要求客户端存在会话列表快照；拿不到时每 500 ms 重试，30 秒后安静放弃。
- 按钮需要外壳声明 `conversation.input.right` 插槽。没有该插槽的版本上注册回调根本不会执行——按钮自然消失，彩带照旧。

## 它怎么工作

- **完成信号**：客户端会话快照本身就带权威的 `running` 位（官方侧边栏与子代理面板读的正是它），订阅它零延迟、零 RPC。Host 侧的 `agent/status` 事件虽然更早，但需要常驻 Host 状态和一条 Client↔Host 通道，不值当。
- **按钮席位**：`conversation.input.right` 按定义就是「发送键之前的紧凑控件」，位置与生命周期都由外壳分配；插件不自己摆放任何东西。
- **彩带不进渲染树**：画布在第一次庆祝时按需挂到 `document.body`（`position: fixed`、指针穿透、`aria-hidden`），随插件卸载移除。一个只 `return null` 的 React 组件换不来好处。
- **物理**：按 60 Hz 帧书写，运行时用 `dt * 60` 折算，高刷屏和后台限速下弧线一致；画布按 `devicePixelRatio`（上限 2）缩放；以 1280×800 为基准，按视口面积开方给初速与纸片尺寸一个 0.82 ~ 1.5 的倍数，2K/4K 窗口里观感不被稀释。
- **React 只用于按钮**：模块工厂里没有顶层副作用，`require('react')` 懒加载且失败时降级，所以同一份 `lib/client.js` 在没有 React 的预览页里也能跑。

## 开发

| 路径 | 作用 |
|---|---|
| `lib/client.js` | 客户端半边：`__ModuleLoader__` 工厂 = 彩带引擎 + 完成检测 + 按钮 |
| `lib/index.js` | Host 半边：`name` / `inject` / 空 `apply`，只为让包进得了 loader 树 |
| `cordis.patch.yml` | bundle 补丁：把插件插进 profile 的层叠 |
| `icon.svg` | Plugins 页显示的图标 |
| `preview/confetti.html` | 独立预览页：直接加载 `lib/client.js`，自带最小模块加载器替身 |
| `verify/simulate.mjs` | 无头仿真：DOM 桩 + 假 React + 假槽位/词典服务 + 假时钟，跑真实 bundle 并断言 |
| `verify/render-frame.ps1` | 把仿真抓到的画布指令回放成 PNG |
| `docs/` | README 用的效果图 |

自检：

```powershell
node verify/simulate.mjs verify/frames.json 1280 800   # 物理 + 触发 + 按钮断言
powershell -File verify/render-frame.ps1                # 重绘抓到的帧
```

`simulate.mjs` 断言的内容：历史会话静默、开跑静默、顶层收尾喷一次、子会话静默、冷却生效与失效、卸载退订且不留画布；按钮侧校验注册的插槽与 id、`label` 走词典、渲染出 `<button class="dsh-confetti-button">`、`aria-label`/`title` 是译文、点击真的喷、`button: false` 时不注册。

想看效果但不想等一轮对话：双击 `preview/confetti.html`（无 React，所以只有彩带没有按钮），或直接在控制台 `__dshConfetti.fire()`。

## 卸载

```powershell
dsh plugin --profile desktop remove dsh-confetti
```

## 许可

[MIT](LICENSE)
