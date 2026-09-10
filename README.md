# X Follow Manager

用于 X/Twitter 的本地用户脚本：识别互关与未回关账号，读取页面自身网络响应中的用户数据，并提供受控的条件取关与自动回关。

Local userscript for X/Twitter. It detects mutual and non-mutual follows, reads user data from X page responses, and provides controlled conditional unfollow and follow-back actions.

## 安装 / Installation

安装 Tampermonkey、Violentmonkey 或 Userscripts 后，直接点击即可安装，无需复制粘贴：

After installing Tampermonkey, Violentmonkey, or Userscripts, click the link below to install without copying and pasting:

- [一键安装脚本 / Install userscript](https://raw.githubusercontent.com/monkey-sking/x-follow-manager/main/x-follow-manager.user.js)
- [查看源码 / View source](https://github.com/monkey-sking/x-follow-manager/blob/main/x-follow-manager.user.js)

如果浏览器直接显示源码，请右键 raw 链接并选择使用脚本管理器安装。

If the browser displays the raw source directly, right-click the raw link and choose your userscript manager's install option.

## 功能 / Features

- `/following`：隐藏互关、筛选未回关、显示关注者/关注中数量。
- `/following`: hide mutual follows, find non-followers, and show follower/following counts.
- `/followers`：识别尚未回关的关注者，并手动执行回关。
- `/followers`: find followers you do not follow back and follow them back manually.
- `/verified_followers`: manage verified followers with the same follow-back workflow.
- 白名单、认证/保护账号排除、简介关键词条件。
- Whitelist, verified/protected-account exclusions, and bio-keyword filters.
- 默认预览、逐项勾选、每日上限和操作间隔。
- Dry-run-first workflow, per-account selection, daily limits, and delays.
- 数据只在当前浏览器本地处理，不发送到第三方服务。
- Data is processed locally in the browser and is not sent to third-party services.

## 使用 / Usage

在 X 的“正在关注”或“关注者”页面打开脚本面板。自动回关默认关闭，需要手动开启并点击“执行回关”。

Open the script panel on X's Following or Followers page. Follow-back is disabled by default; enable it and click “执行回关 / Follow back” when ready.

脚本优先解析 X 当前页面的 GraphQL 响应，无法解析时回退到 DOM。取关和回关都会改变账号状态，请低频、少量操作，并先使用预览和白名单。

The script first parses X's GraphQL responses and falls back to the DOM when necessary. Unfollow and follow-back change account state; use small batches, conservative delays, preview mode, and a whitelist.

## 安全说明 / Safety

脚本不会调用 X 私有 API 直接写入关系，只通过页面原生按钮执行。X 的内部接口和 DOM 可能变化，使用前请检查候选名单。

The script does not directly write relationships through X's private API; it clicks native page buttons. X's internal APIs and DOM may change, so review candidates before execution.
