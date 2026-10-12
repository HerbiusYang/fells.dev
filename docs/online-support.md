# 在线客服接入

## 当前实现

现有用户客服窗与独立客服工作台通过 `src/lib/support-service.ts` → `src/lib/support-http.ts` 调用同源 `/api/support`，消息、已读位置、会话状态和附件由真实后端持久化。原 IndexedDB `support-store.ts` 保留给明确的本地存储单测，页面默认不调用它，也不生成示例会话。页面布局、消息控件、图片查看器、搜索、筛选与移动导航保持现有交互。

普通用户先经 `/app/start` 真实账号登录，以 `fells_user` HttpOnly Cookie 打开 `/app` 中的右下角客服窗。客服在私密入口输入已有客服账号和密码，后端仅允许现有 owner/ops 账号，签发独立 `fells_support` HttpOnly Cookie。登录接口字段仍叫 `email`，可以传后端现有账号名；账号名不是邮箱时客服邮箱展示为空。客服登录或退出不改变普通用户 Cookie。

用户资料由后端读取；工作区数量来自实际工作区存储，余额明确显示 **USD API 额度**，不混入人民币现金或赠金。消息失败保留草稿；图片上传后再发送附件 ID，同一草稿的网络重试复用消息 UUID 与已上传附件。

## 私密客服入口

`SUPPORT_PORTAL_PATH` 只在开发服务器或构建时读取，未配置时不生成客服页面。格式为 2–5 个小写英文词，以连字符连接，每词 2–16 个字母；不可与已有公开路径冲突。示例：

```dotenv
SUPPORT_PORTAL_PATH=amber-fern-nook
```

实际值保存到 Git 忽略的 `.env.local` 或构建平台环境。不要使用 `PUBLIC_` 前缀。用户页面及下载的公共 JavaScript 不包含此入口；普通用户客服窗不提供客服登录链接。各语言沿用自己的路径前缀。

原 `/support`、`/support/login` 及语言版本返回 404。私密页面保留 `noindex,nofollow,noarchive`，不输出 canonical、hreflang 链接、`og:url` 元信息或第三方字体请求。入口地址不授予客服权限，所有数据访问仍由后端逐请求鉴权。更换地址时完整替换构建输出，清除旧页面。

## 接口与会话绑定

`src/lib/support-api.ts` 定义后端 DTO；UI 只通过服务边界访问。以下路径均以 `/api/support` 为前缀：

| 方法和路径 | 前端方法 | 请求与响应 |
| --- | --- | --- |
| `POST /session` | `loginOperator` | `{ email, password }`；返回客服资料和过期时间，由服务器设置会话 Cookie |
| `GET /session` | `readOperatorSession` | 返回客服会话或 `null` |
| `DELETE /session` | `logoutOperator` | 撤销客服服务器会话；返回 `null` |
| `GET /availability` | `getAvailability` | 已认证客户读取 `{ online }`，不返回客服个人资料 |
| `PUT /session/availability` | `setAvailability` | 客服专用；`{ online, sourceId }`，维护工作台连接租约，返回 `null` |
| `GET /conversations` | `listConversations` | 客服专用；查询 `cursor`, `limit`, `status`, `search`，返回会话摘要分页 |
| `GET /conversations/current` | `getCurrentConversation` | 普通用户自己的会话或 `null` |
| `POST /conversations/current` | `ensureCurrentConversation` | 不传用户 ID；幂等获取或创建当前用户会话 |
| `GET /conversations/:id` | `getConversation` | 返回会话详情、用户资料和双方已读位置 |
| `GET /conversations/:id/messages` | `listMessages` | 查询 `cursor`, `limit`，返回消息分页 |
| `POST /attachments` | `uploadAttachment` | `multipart/form-data` 的 `file`；返回附件 ID、元信息与限时访问 URL |
| `POST /conversations/:id/messages` | `sendMessage` | `{ clientMessageId, text, attachmentIds }`；返回服务器确认的消息 |
| `PATCH /conversations/:id/read` | `markRead` | `{ lastReadMessageId }`；服务器确定读者身份并返回已读位置 |
| `GET /conversations/:id/typing` | `getTyping` | 返回双方短时输入状态 `{ user, agent }` |
| `PUT /conversations/:id/typing` | `setTyping` | `{ typing, sourceId }`；服务器确定发送者身份，`sourceId` 仅区分页签；返回 `null` |
| `PATCH /conversations/:id/status` | `setStatus` | 客服专用；`{ status: "open" \| "resolved" }`，返回更新后的摘要 |
| `GET /events` | `openEvents` | 已认证 SSE 流；也可由未来适配器使用 WebSocket 实现同一事件模型 |


普通 JSON 使用 `{ ok: true, data, requestId }`；错误使用相应 HTTP 状态和 `{ ok: false, error: { code, message }, requestId }`。列表和消息通过 `{ items, nextCursor }` 分页；适配器读取所有页，客服资料加载最多四个并发请求，不使用演示的 200 条消息或 40 个会话上限。

通用接口明确发送 `X-Fells-Support-Audience: customer|operator`，选择对应 Cookie 后仍进行真实鉴权。两种有效 Cookie 同时存在而未选择 audience 的通用请求返回 409。`/conversations/current` 固定用户身份，`/session` 固定客服身份。

用户请求还携带 `X-Fells-Expected-User` 与 `/api/app/bootstrap` 的 `session_id` 对应的 `X-Fells-Expected-Session`。客服会话 DTO 新增 `sessionId`（Cookie 的 SHA256 摘要），请求携带 `X-Fells-Expected-Operator` 和 `X-Fells-Expected-Operator-Session`。摘要不是凭证，只拒绝其他页签替换 Cookie 后，旧 UI 对新账号或新会话的请求；后端始终以 HttpOnly Cookie 确认身份。

账号变化通过同页 `CustomEvent` 与 `BroadcastChannel('fells.session.changed')` 的 `{ audience: 'customer'|'operator' }` 通知。另一 audience 的通知不清除当前客服会话。变化时立即关闭该身份的 SSE、取消请求、清除资料/草稿，并拒绝迟到响应。服务器 401 与事件 `session.expired` 也执行同样清理。

## 图片与消息

- 文本限制为 JavaScript UTF-16 `length` 的 4,000 单位；至少有文字或一个附件，每条最多一张图片。身份和 sender 不由浏览器消息载荷指定。
- 图片限定 PNG/JPEG/WebP、2 MiB、2,500 万像素。前端先检查文件结构和尺寸，再执行浏览器解码；后端独立完整解码并检查类型和尺寸。
- 附件经 multipart `file` 上传后获得 ID；历史中的图片转换为同源、带 audience 与短期签名的访问地址。读取还需要相应有效 Cookie 与会话权限，链接不会成为公开客户图片。
- 同会话、同真实发送者与同 UUID 的相同内容重试返回原消息；不同内容冲突返回 409。未确认成功不清空草稿。
- 按服务器消息 ID 保持顺序。为现有 UI 的数值已读位置做严格递增投影，处理同毫秒消息；推进已读时仍发送准确的 `lastReadMessageId`。

## 实时、已读与在线状态

页面使用真实 EventSource，事件名称为 `message.created`、`conversation.updated`、`conversation.read`、`conversation.typing`、`session.expired`。SSE URL 通过 `audience`、`expected_user`/`expected_operator` 以及 `expected_session`/`expected_operator_session` 绑定初始身份；服务器逐秒验证会话。EventSource 不能读 HTTP 401，客户端在连接错误后查询普通身份接口；短期网络失败允许原生重连。重新获取完整状态后按 ID 去重，15 秒轮询作为补充，组件结束时关闭连接。

只有对话打开、页面可见且有焦点、历史滚到末尾且未被图片查看器或资料面板覆盖时推进已读。输入状态不含草稿内容：每页 UUID `sourceId`，持续输入最多每 1.5 秒续期，停顿 2 秒、失焦、关闭、切换会话、发送确认或退出后清除；服务器 5 秒到期。

客服工作台每 10 秒续期在线租约，服务器 45 秒到期。关闭一页不影响其他页，退出撤销该客服会话的全部租约。客户只看到在线布尔状态，网络异常显示无法确认，离线仍可留言。当前后端租约为单实例内存状态；多实例部署需共享租约和事件传输。

## 测试

- `tests/support-http.test.mjs`：真实适配器协议单测，验证身份/会话绑定、两种 audience、分页、同毫秒已读、消息 UUID 重试、附件复用、私有 URL、迟到响应和流关闭。
- `tests/browser/support*.test.mjs`：构建产物的 HTTP 契约 fixture 回归，验证账号/密码表单、消息/图片/已读/状态、失败草稿、跨页退出、私密入口与六语言 320px 布局。fixture 仅存在于测试，生产页面仍使用真实 HTTP。
- `tests/browser/support-live.test.mjs`：显式启用时，通过现有前端页面访问隔离的本机真实 API/PostgreSQL，验证登录、双向 SSE、文字/图片、已读、输入状态、解决/重开及独立退出。必须提供 `FELLS_LIVE_TEST=1`、`FELLS_LIVE_TEST_PASSWORD` 和本机测试账号；可用 `FELLS_BROWSER_BASE`、`FELLS_TEST_USER`、`FELLS_TEST_OPERATOR`、`FELLS_TEST_SUPPORT_PORTAL` 指定配置。仅允许 loopback 地址，不提交凭证。

运行正常构建和测试：`pnpm build`、`pnpm test`、`pnpm test:browser`。私密工作台相关浏览器用例需要配置构建入口；真实联测需要已启动的隔离后端。后端权限、CSRF、并发持久化和会话撤销另外由后端隔离 PostgreSQL 回归覆盖。
