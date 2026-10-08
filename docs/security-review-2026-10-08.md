# 合并分支安全复审（2026-10-08）

基线：`codex/frontend-audit-fixes` / `3b60537`。三个 agent 分别审查预览存储和应用、公开表单和主题、在线客服；主 agent 复核依赖、远端 CI 和三浏览器安全矩阵。测试使用隔离的静态构建、本地 HTTP server、合成账号和图片，不访问真实支付、兑换、客户数据或生产写接口。

## 确认的问题和修复

| 问题 | 复现与影响范围 | 修复和回归 |
| --- | --- | --- |
| 缓存库绕过安全限制 | Astro 锁定的 `http-cache-semantics@4.2.0` 被扫描报告高危 GHSA-ch52-4w7c-c8xp。本地库测试用 `max-stale` 可命中本应拒绝的 Set-Cookie、private、no-store、no-cache 响应。升级 4.3.0 后扫描清零，但这四个行为仍失败。当前项目为静态输出，该库用于 Astro 远程资产缓存；未证明公开站存在跨用户缓存或凭据窃取路径。 | 升级 4.3.0，使用 pnpm `patchedDependencies` 管理补丁，在陈旧缓存处理前执行安全限制。行为回归验证拒绝敏感响应，同时保留合法 public 的陈旧缓存使用。CI 增加高危依赖扫描；不能用扫描清零代替行为验证。 |
| 环境值和私密输入进入原生 GET URL（P2） | 绕过事件处理器调用原生 `form.submit()`，环境值因 `name=v` 和默认 GET 被放进 URL；聊天、个人资料、日程等动态表单同样默认 GET。 | 动态表单显式 POST；环境值无 `name`，由 JS 读取。验证原生提交的 URL/正文不含环境值、常规保存不持久化环境值、重载清空内存值。 |
| 接口重定向转发 CDK/邮箱（P2，配置后触发） | 两个不同 origin 的本地 server 实收 307/308 转发的 POST 内容。仓库当前兑换/等候名单端点为空，不能说默认站点已对外泄漏。 | Checkout/Cta 的 JSON POST 禁止重定向，失败保留 CDK、允许重试；目标 server 收到零请求。部署必须配置最终 POST URL。 |
| Checkout 在漏安全头时可被 iframe 操作（P2，部署漏头后触发） | 本地剥除 CSP/X-Frame-Options 后，嵌入的兑换/付款字段可用。 | 页面脚本独立检查顶层窗口，六语言提示并保持字段、提交禁用；保留响应头模板。 |
| 兑换 pending 时重复提交（P2） | 双击和重复 submit 事件会产生多个 CDK POST。 | pending 锁保护提交及选项；错误恢复、保留输入，明确重试可成功。此为前端重复操作保护，生产支付/兑换仍须服务器幂等校验。 |
| 超量持久化状态先构造大对象再拒绝（P2，本地存储边界） | 逻辑 37 MiB 消息集合此前完整复制并序列化后才检查容量；浏览器 IndexedDB 还能保留稀疏数组及包装字符串。 | 逐字符串计入 JSON/UTF-8 字节并提前拒绝，严格检查稠密数组和字符串类型；恰好 1 MiB 有效状态仍被接受。拒绝后已提交快照不变且仍可退出。浏览器读取原始数据时自身的结构化克隆不由该校验控制。 |
| 退出/换账号后的旧客服响应重新显示消息（P2，本地预览边界） | 延迟真实 IDB 事务结果交付并禁用跨页通知，退出后旧 refresh 结果仍可绘入客户消息。 | 在异步读取和已读操作后复验当前预览会话，失效则停止组件并清理历史。回归覆盖退出、替换账号和延迟结果交付。 |

缓存公告：[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)。本轮测试显示 npm 的版本范围扫描不能独立证明 4.3.0 修复了公告中的行为，因此保留本地补丁与行为门禁；未来更新依赖也必须通过这些测试。独立复核又覆盖指令大小写、`stale-while-revalidate`、`stale-if-error`、请求/Vary 匹配以及共享 `s-maxage`。补丁统一用于请求评估、错误回退和 TTL，14 项行为测试验证敏感响应不重用、合法 public 及私有缓存行为仍可用；不是对所有 HTTP 缓存实现的安全保证。限制依据见 [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html#name-serving-stale-responses)。

## 同时修复的交互问题

- 远端合并提交的 CI 原先真实失败：客户发送后的滚动定位被先前 Home 键的浏览器滚动动画覆盖。两端历史容器采用明确的瞬时键盘导航，保留子控件行为；时序探针在普通及四倍 CPU 降速下验证最终保持在底部。
- 主题中的可选 Observer 缺失或构造失败会隐藏内容并中断后续事件安装，现已提供可见降级；主题增加与主站一致的 `no-referrer` meta，以防 host 漏发对应响应头。

## 验证口径

完整门禁包括冻结锁文件安装、依赖审计、Astro/TypeScript/未使用代码检查、配置及未配置客服入口的两个独立构建、全部单元/浏览器测试、覆盖率门禁。核心安全矩阵在 Chromium、Firefox、WebKit 验证持久化 XSS、秘密的 URL/存储隔离、重载清理、跨页退出撤销、原生 CDK 提交和 no-script 表单。

本机完整 `pnpm test:coverage` 已通过，退出码 0。Chromium、WebKit 的新增安全矩阵已通过；Firefox 的 sandbox 环境无法正常启动，明确跳过。CI 设置 `TEST_REQUIRE_BROWSERS=1`，缺失或启动失败必须失败，不能算兼容性通过。远端结果以 [该分支的 Actions](https://github.com/HerbiusYang/fells.dev/actions?query=branch%3Acodex%2Ffrontend-audit-fixes) 中对应提交为准。

| 完整本机门禁 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，包括受管理依赖补丁 |
| `pnpm audit --json` | 0 个已知漏洞，包含生产和开发依赖 |
| Astro、TypeScript、未使用代码 | 通过；Astro 142 文件，零错误/警告/提示 |
| 单元测试 | 92/92 通过 |
| 配置入口的浏览器测试 | 107 通过、0 失败、2 项 Firefox 环境跳过 |
| 无入口的公共客服测试 | 1/1 通过，覆盖六语言 |
| Node 行/分支/函数覆盖率 | 99.33% / 89.83% / 91.67%，已加载代码口径 |
| Chromium JS 执行覆盖率 | 83.36%，24 个去重脚本 |

测试覆盖率是执行范围指标，不等于所有业务已验证或不存在漏洞。当前登录、应用及客服仍是明确标识的本地预览，`support-api.ts` 只定义后端契约。真实服务端认证、权限、Cookie/CSRF、支付幂等、限流及生产 HTTP 响应头不在本仓库本次验证的证明范围内。

公开表单/模板的详细复现见 [补充记录](../reports/frontend-audit-2026-10-08/public-security-followup.md)，客服时序复现见 [客服记录](../reports/frontend-audit-2026-10-08/support-security-followup.md)。
