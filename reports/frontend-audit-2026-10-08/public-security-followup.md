# Checkout 与公开模板复审（2026-10-08）

审查基线：`codex/frontend-audit-fixes` / `3b60537`。仅使用隔离工作区源码及 loopback 浏览器 fixture；未访问生产支付、兑换或邮件接口。

## 已确认并修复

1. **配置兑换端点的重定向会转发 CDK（P2，开放端点后触发）。** 原 Checkout `fetch` 使用默认跟随重定向。本地两个不同 origin 的 HTTP server 实证：配置端点返回 307 后，第二个 server 收到 `POST {email:"redirect-audit@example.invalid",cdk:"DUMMY-REDIRECT-CDK"}`。Cta/email waitlist 使用同一默认行为。当前实际部署字段为空，不能表述为默认公开站已经对外泄漏。现在所有这些 JSON POST 使用 `redirect:"error"`；307/308 回归验证原端点收到一次请求，目标端点收到零次，兑换失败保留 CDK 并允许重试。上线配置必须填写最终 POST URL。

2. **遗漏 host 响应头时 Checkout 仍可嵌入操作（P2，host 漏头后触发）。** fixture 去掉 CSP `frame-ancestors` / X-Frame-Options 后，iframe `/checkout/?mode=redeem` 的 CDK 和提交按钮都 enabled；Auth 已有独立保护。现在 Checkout 在解析数据及启用字段之前检查 `window.self !== window.top`，显示六语言提示并保留 disabled。现有响应头也保留。回归在全部六语言剥除响应头后确认字段和付款按钮仍 disabled。

3. **兑换 pending 时双击发送两次 CDK POST（P2）。** 原版本对真实 `dblclick()` 捕获到两个请求，按钮始终 enabled。现在 pending 期间锁住提交、选项和字段，并拦截重复 submit 事件；失败恢复字段、保留 CDK，下一次显式重试可成功。回归覆盖真实双击、重复事件、500 失败和 200 重试。

4. **可选 Observer 失败阻断主题内容和交互（P2，浏览器 API 缺失或构造失败）。** 禁用 IntersectionObserver 时 Synara 抛错，28 个内容块 opacity 为 0，Ask href 未初始化；Apple 缺 ResizeObserver 时 15 个 reveal 内容块隐藏、详情监听器未安装。现在装饰失败时揭示全部内容，Apple 用 resize 事件继续更新陈列；后续分享、菜单、详情、配对均继续工作。missing 和 throwing 两种 fixture 都通过。

5. **主题隐私策略补强。** 主站已有 `no-referrer` meta，主题仅依赖 host header。ThemePreview 现在同样在外部资源之前输出该 meta；新增回归去掉 host Referrer-Policy 并关闭 JavaScript，确认真实导航无 Referer。当前正常发送响应头的部署不存在本项已确认的查询泄漏。

## 已验证的其他边界

- URL 选择字段中的 HTML、恶意 `redirect` 参数不能执行；奖励码仅作 input value 并从 URL 清除。支付模板对 email/code 进行 URL 编码，包含 `&`、`=` 的邮箱不会增加参数。
- payment/shop 目标仅来自受信任的 `src/site.ts`；未发现 URL query 可指定支付目标的路径。没有把修改受信任部署配置的假设当作远程攻击。
- 配置 shop 的真实新页导航没有 opener，未收到 checkout Referer；Synara Ask 链接保留 `noopener noreferrer`，分享及复制只含 origin/path，不含 query/hash。
- 未开放兑换时 waitlist 仅收到 email/order，没有 CDK；CDK 保留于输入框。Auth/Checkout/Cta 的原生表单 method 为 POST，初始 disabled；CDK 无 name，原生提交无法序列化它。
- 原始 HTML/SVG/innerHTML 的来源为 checked-in 模板及常量，没有发现用户输入流入这些 sink。

## 验证

- `astro check`：140 文件，0 errors / warnings / hints。
- 独立 build：`/tmp/fells-public-security-dist`，99 页。
- 新增 `tests/browser/public-security.test.mjs`：12 / 12 pass，无 skip。
- 既有 `app-flows.test.mjs` + `security.test.mjs` + `marketing.test.mjs`：48 / 48 pass，无 skip。
- 测试使用 `TEST_DIST_DIR=/tmp/fells-public-security-dist` 与本地 Google Chrome，不使用共享 dist。

最终源码证据：`CheckoutPage.astro` 的 frame guard / enableControls / POST redirect / submit lock；`Cta.astro` 的 redirect 和 pending 保护；`ThemePreview.astro` 的 referrer meta；两 checked-in template 的 Observer 降级。所有新回归位于独立 public-security 文件，未修改共享 security 测试。
