# dsh-confetti

中文 | [English](README.en.md)

**对话完成的瞬间，窗口左下角和右下角各喷出一束彩带；输入框旁边还有一个按钮，按一下也能喷。**

一个 DSH 客户端插件：

- **自动**：某次对话的最后一步落地（`running` 由 `true` 翻成 `false`），画面两个下角各打一炮——彩带朝画面中心抛出去，翻着面、落下来、淡出，然后画布自己收工。
- **手动**：输入框工具栏（发送键左侧那一排）多一个 🎉 按钮，按一次撒一把；连点连撒，不受自动庆祝的冷却限制。
- 纯客户端效果，Host 半边是空壳（没有服务、路由、工具）
- 零构建：`lib/client.js` 就是交给 Client 模块加载器执行的产物；React 只在注册输入框按钮时懒加载，没有 React 也能跑（预览页就是这种情形）
- 只有彩带在飞的时候才有一帧一个的 `requestAnimationFrame`，其余时间完全静止
- 尊重 `prefers-reduced-motion`：系统开了「减少动态效果」时只喷很小一撮，且没有第二波

## 当前状态：已装在本机 desktop profile 上

这条 profile 里它是以 **链接**（`link:D:/interesting things/dsh-confetti`）方式挂载的，也就是说：

- 这个目录就是插件的真身，改 `lib/client.js` 不会丢失；
- Host 会重新快照新版本（`/plugins/events` 的 `rev` 会变），刷新页面即生效；
- 目录别删、别挪，删了插件就失效（可先 `dsh plugin --profile desktop remove dsh-confetti`）。

装完之后**刷新一次页面**（桌面端也可以重启），让浏览器拉到新的客户端 bundle。

控制台里会有一行待命日志：

```
[dsh-confetti] armed — every completed turn gets a popper in each bottom corner; press the confetti button in the composer to fire one now
```

## 那个按钮在哪

`🎉` 在**输入框右侧工具栏**，就在发送键左边（插槽 `conversation.input.right`，`order: 10`）。鼠标悬停有提示，键盘 `Tab` 可聚焦、`Enter/Space` 触发，提示与无障碍标签都走界面语言的词典（中文「撒彩带」/ English "Confetti"）。

按钮只负责「再喷一次」，不改任何会话状态；对话没在跑的时候也能按。

## 想立刻看效果

三种方式，都不用等一轮完整对话：

1. 按输入框旁的 🎉。
2. 控制台执行 `__dshConfetti.fire()`（`fire({ density: 2 })` 更密，`__dshConfetti.clear()` 收画布）。
3. 双击 `preview/confetti.html` —— 这个页面直接加载 `../lib/client.js`（插件本体），只为它准备了一个最小的模块加载器替身；它没有 React，所以只有彩带没有按钮。

## 从零安装（换台机器时）

```powershell
dsh plugin --profile desktop add "D:\interesting things\dsh-confetti"
```

插件包结构：

```
package.json        dsh.bundle.patch → cordis.patch.yml
                    dsh.client = { platform: 'web', inject: [ui-slots, locale] }
cordis.patch.yml    - insert: [{ id: dsh-confetti, name: dsh-confetti }]
lib/index.js        Host 半边：name / inject / 空 apply（只为让包进得了 loader 树）
lib/client.js       Client 半边：__ModuleLoader__ 工厂 = 彩带引擎 + 完成检测 + 按钮
icon.svg            Plugins 页显示的图标
preview/…           独立预览页
verify/…            无头仿真与帧渲染（开发用，随包不发）
```

手动挂载（无 CLI 时）：把目录放到 `%USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-confetti`，在 profile 的 `package.json` 里把 `"dsh-confetti"` 加进 `dependencies`（值写 `link:<目录>`）与 `dsh.profile.bundles`，重启。

## 触发条件（自动喷的规则）

订阅客户端会话列表快照 `ctx.get('sessions').list`，逐个会话比较 `byId[id].running`：

- 只认**亲眼看到**的 `true → false`：页面刚打开时已经是 `running: false` 的历史会话不会喷，打开旧会话不会乱放炮
- 跳过委派出去的子会话（`origin === 'subagent'` 或带 `parentId`），一个 workflow / subagent 批量收尾不会连喷
- 900ms 冷却：多个会话同一刻收尾，只庆祝一次
- 页面在后台（`document.visibilityState === 'hidden'`）时跳过，切回来不会补喷
- 按钮是手动触发，走的是同一条 `fire()`，但不排队、不吃冷却

## 配置（可选）

零配置即可用。要调的话，在 profile 的 patch 里给这个 entry 加 `config`：

```yaml
- id: dsh-confetti
  name: 'dsh-confetti'
  config:
    enabled: true     # false = 不挂监听，插件彻底安静（按钮也没有）
    button: true      # false = 只要自动效果，不要输入框旁的按钮
    density: 1        # 彩带数量倍率，0.25 ~ 3
```

## 自检（改完代码想知道有没有坏）

`verify/` 里是一套不依赖浏览器的验证：用 DOM 桩 + 假 React + 假槽位/词典服务把真实的 `lib/client.js` 跑起来，记录 canvas 的每一次绘制操作，并驱动假时钟。

```powershell
node verify/simulate.mjs verify/frames.json 1280 800   # 物理 + 触发 + 按钮断言
powershell -File verify/render-frame.ps1                # 把抓到的帧重绘成 PNG
```

`simulate.mjs` 断言的内容：历史会话静默、开跑静默、顶层收尾喷一次、子会话静默、冷却生效与失效、卸载退订、卸载后画布清空；按钮则校验注册的插槽与 id、`label` 走词典、渲染出 `<button class="dsh-confetti-button">`、`aria-label`/`title` 是译文、点击真的喷、`button: false` 时不注册。

## 卸载

```powershell
dsh plugin --profile desktop remove dsh-confetti
```

## 实现备注

- **按钮为什么在 `conversation.input.right`？** 这个插槽按定义就是「发送键之前的紧凑控件」，位置与展示时长都由外壳分配；插件不自己摆放任何东西，外壳没声明这个插槽时注册回调根本不会执行（天然降级）。
- **彩带为什么不是插槽组件？** 效果不占任何界面位置：画布在第一次庆祝时按需挂到 `document.body`，随插件卸载移除；一个只 `return null` 的 React 组件换不来好处。
- **为什么不走 Host？** Host 的 `agent/status` 事件确实能更早感知收尾，但那需要 Host 半边的常驻状态和一条 Client↔Host 通道；客户端的会话快照本来就带权威的 `running` 位（官方侧边栏、子代理面板读的正是它），订阅它零延迟、零 RPC。
- **物理量**按 60Hz 帧书写，运行时用 `dt * 60` 折算，高刷屏与后台限速下弧线一致；画布按 `devicePixelRatio`（上限 2）缩放；粒子最多 640 片，飞出画面或寿命到点即回收，动画队列空了自动停表。
- **大屏适配**：以 1280×800 为基准，按视口面积开方给初速与纸片尺寸做一个 0.82 ~ 1.5 的倍数，2K/4K 窗口里同样的观感不会被稀释。
