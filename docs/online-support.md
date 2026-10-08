# 在线客服前端与后端接口预留

## 功能计划

从已包含安全修复的本地 `hydra`（`dcec84b`）建立 `codex/online-support` 分支。此次实现前端交互，并为未来后端保留类型化接口；不新增服务器、真实账号认证或上传服务。

1. 在 `/app` 增加右下角客服入口，支持文字、图片、消息记录、未读提示和移动端。
2. 新增由构建环境配置的私密客服入口 `/<SUPPORT_PORTAL_PATH>` 和工作台 `/<SUPPORT_PORTAL_PATH>/desk`，显示会话列表、用户资料与历史消息，支持搜索、筛选、回复、已读与解决状态。
3. 所有入口覆盖现有六种语言。前端读写统一经过 `src/lib/support-service.ts`，本地演示使用独立 IndexedDB 数据；生产后端契约放在 `src/lib/support-api.ts`。
4. 验证双向文字与图片消息、跨标签页同步、未读、筛选、用户资料、移动端布局、退出清理以及原有安全回归。

普通用户继续通过原有 `/app/start` 入口进入 `/app`，使用右下角客服对话框，无需访问私密 URL。私密 URL 仅用于客服进入独立工作台，登录页明确标为客服登录，不提供普通用户登录切换。两类会话独立：普通用户会话不能进入客服工作台，客服会话不会创建普通用户会话。

当前 `/app/start` 和客服入口都是**本地预览**。普通用户的邮箱和客服的姓名、邮箱仅作为展示信息，不认证账号，也不赋予真实客服权限。预览只在同一浏览器、同一站点内的标签页之间同步；不同设备不会互通。生产上线时应替换本地适配器，并接入真实的普通用户和客服认证。

开始新的普通用户预览或退出普通用户预览时，删除与该预览关联的客服会话及附件，旧标签页不可继续保存。客服工作台中的示例用户需由“加载示例”按钮主动添加，均为虚构数据；这些独立示例不会因普通用户退出而被删除。不要将真实客服凭证或客户资料填入预览。

## 私密客服入口配置

客服入口使用手工选定的固定词组，没有默认路径。`SUPPORT_PORTAL_PATH` 只在开发服务器或构建时读取，未配置时不生成客服页面。词组由 2–5 个小写英文单词组成，使用连字符连接，每个单词为 2–16 个字母；不能与已有公开路径 `developer-api` 或 `zh-hant` 冲突。以下仅为配置示例：

```dotenv
SUPPORT_PORTAL_PATH=amber-fern-nook
```

将选定的实际值保存到已被 Git 忽略的 `.env.local`，供本地开发与构建使用；生产环境在构建平台设置同名变量。不要提交实际值，不要使用 `PUBLIC_` 前缀，也不要将入口写入客户可下载的 JavaScript。中文入口为 `/zh/<SUPPORT_PORTAL_PATH>`，中文工作台为 `/zh/<SUPPORT_PORTAL_PATH>/desk`；尖括号内容是占位符，实际地址使用环境配置的值。

原 `/support/login` 和 `/support` 以及其语言版本均返回 404，不跳转到新入口。普通用户客服窗不提供客服登录链接。私密页面设置 `noindex,nofollow,noarchive`，移除 canonical、hreflang、`og:url` 元信息及第三方字体请求；不要在 `robots.txt` 或 `_headers` 暴露该路径。

更换入口时选定新词组、更新构建环境并重新构建，部署时完整替换旧输出，清除旧入口文件。入口保持不公开链接；当前仍为本地预览，真实客服权限和客户数据访问由后端会话及权限校验控制。后端 API 保持 `/api/support` 前缀，无需随入口更换。

## 接口契约

`SupportBackendApi` 仅定义未来适配器需要实现的方法，没有网络请求或后端实现。以下路径均以 `/api/support` 为前缀。普通用户身份由既有账号服务器会话取得；客服身份由独立的服务器客服会话取得。接口不能接受浏览器生成的会话标识、用户资料或角色作为认证依据。

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

`/conversations/current` 应优先于 `/:id` 路由匹配。会话列表分页返回 `{ items, nextCursor }`；没有下一页时 `nextCursor` 为 `null`。消息按稳定的服务器顺序返回，`createdAt`、`updatedAt`、`joinedAt`、`expiresAt` 均为服务器生成的 UTC ISO 8601 字符串。未读数量由服务器针对当前访问者计算。

会话详情包含 `customer: { id, name, email, joinedAt, preferredLocale, workspaceCount, credits }`。前端不提供或更新这些账号字段；服务器应根据客服权限返回可见字段。消息发件人 `user` 或 `agent` 也由服务器会话确定。

每个普通 JSON 响应使用统一包裹：

```ts
{ ok: true, data: result, requestId: "..." }
// 或失败响应，HTTP 状态码同时反映失败类型：
{ ok: false, error: { code: "forbidden", message: "..." }, requestId: "..." }
```

错误码包括 `unauthorized`、`forbidden`、`not_found`、`validation_error`、`payload_too_large`、`unsupported_media`、`rate_limited`、`conflict` 和 `internal_error`。校验失败可附 `fields`；限流可附 `retryAfterSeconds`。失败不得让前端显示“发送成功”；适配器处理会话失效、重试与错误文案。

适配器在请求开始和返回客户资料、会话或消息之前均需确认当前账号会话没有退出或替换。退出时失效所有待处理响应；即使旧请求已成功提交，也不能把晚返回的旧账号资料重新写入或展示。前端刷新还需按本地操作版本丢弃早于发送确认的快照，避免已确认消息被旧响应暂时移除。

## 图片、消息和鉴权约束

- 文字最多 4,000 字符；至少有文字或一个附件，每条消息最多一个图片附件。图片仅接受 PNG、JPEG、WebP，每张最多 2 MiB、2,500 万像素；客户端在浏览器解码前检查结构头和尺寸，再通过浏览器解码复验。结构头预检不能证明完整压缩数据合法，服务器仍需独立校验实际文件大小、解码结果、尺寸与附件数量。
- 生产图片先上传再发送附件 ID。服务器检查上传者和会话访问权限，并返回限时授权 URL；不要将本地演示的 Data URL 存入生产消息 DTO，也不要使用永久公开的客户图片 URL。
- 发送消息使用客户端 UUID `clientMessageId`。同一会话和认证发送者重试相同 ID 应返回原消息；同一 ID 搭配不同内容返回 `conflict`。
- 普通用户只能访问自己的会话、消息、附件和事件。只有服务器验证的客服权限可查看其他用户资料、搜索会话、回复及改变状态。每个 `:id` 都重新检查访问权限。
- Cookie 使用 `HttpOnly`、`Secure` 与适当的 `SameSite`。对写接口实施 CSRF 防护、来源检查和限流，退出后撤销服务器会话。消息展示只使用安全文本和已验证图片地址，不能将消息作为 HTML 注入页面。

## 实时事件

SSE 的事件名称与 `SupportEventDto.type` 一致：`message.created`、`conversation.updated`、`conversation.read`、`conversation.typing`、`session.expired`。每个事件包含可续传的 `id` 与类型对应的 `data`，仅发送当前账号有权查看的内容。适配器可用 `lastEventId` 恢复连接，按消息 ID 去重，并在断线后重新获取会话状态；退出或组件销毁时关闭连接。

本地适配器使用同源广播提示其他标签页重新读 IndexedDB，没有 SSE 或 WebSocket；客服在线状态由本地工作台的短时租约模拟。接入后端时替换服务边界的适配器，将服务器会话、上传、分页及事件转换为 UI 所需数据；清除本地演示数据并移除“加载示例”入口。

## 客服在线状态

普通用户聊天入口和窗口显示“客服在线”、“暂无客服在线，可先留言”或“正在确认客服状态”。工作台打开并成功发送连接心跳后才计为在线，单纯存在登录会话不计入。心跳每 10 秒续期，租约 45 秒到期；客服退出时撤销该会话全部租约，关闭工作台发送停止通知，无法发送时由超时清理。后台页签仍可保持连接，实际浏览器后台节流或设备休眠会使租约到期。

每个工作台页签使用独立 UUID `sourceId`，关闭一个页签不影响同一客服的其他页签，也不影响其他客服；至少一个有效租约存在时客户看到在线。查询失败、异常响应或客户断网时显示无法确认状态，不把上次在线结果当成最新结果，也不误报为离线。离线时仍允许文字和图片留言，草稿和历史不会因为状态变化被清除。

生产租约由服务器绑定真实客服 Cookie 会话，验证 `online` 布尔值、页签 ID、写接口来源和访问权限，并限制续期频率/来源数；浏览器不能声明客服角色或过期时间。客户端只读取是否有客服在线，不读取客服名单或会话标识。本地 IndexedDB 与仓库外 HTTP 模拟后端保留同样的短时状态语义，模拟后端租约只驻留内存。

## 消息回执与输入提示

双方发送的文字和图片下方显示“未读 / 已读”；已读位置覆盖到该消息时才改变回执。只有对方打开对应会话、页面可见且获得焦点、消息滚动到底部，并且没有图片查看器或覆盖消息的资料面板时，才推进已读位置。输入提示、会话列表和后台页签都不能标记消息已读。

有焦点的输入框出现非空文字时，通知对方“正在输入”并显示三点动画。输入状态不包含草稿内容，不新增聊天消息，也不改变已读位置。持续输入至多每 1.5 秒续期；停顿 2 秒、失焦、关闭聊天、切换会话、成功发送或退出时清除。短时状态最多保留 5 秒，避免断线或关闭浏览器后残留；解决会话时清除双方状态。每个页签使用独立 `sourceId`，一个页签停止输入不能清除另一个页签的有效状态。启用减少动画偏好时显示静态圆点。

生产 `conversation.typing` 事件包含 `{ conversationId, sender, typing, expiresAt }`，身份、过期时间与会话权限由服务器确定；不能信任浏览器提供的角色、会话归属或过期时间。输入状态应使用短期内存存储并限流，不写入消息历史。本地 IndexedDB 适配器使用有期限的独立记录；仓库外的 HTTP 模拟后端使用内存租约，可供独立浏览器双向联测。

UI 会话模型校验拒绝稀疏数组、乱序或重复时间的消息，以及超出消息历史的已读游标。生产 DTO 仍以稳定消息顺序和 `lastReadMessageId` 为准；适配器需为 UI 映射严格递增的数值位置，不能把可能发生在同一毫秒的原始 `createdAt` 直接当成唯一读位置。

## 验收

聊天攻击回归在本地测试数据上验证双向恶意消息、姓名、文件名的纯文本展示，包括 HTML、脚本、SVG、事件处理器、JavaScript URL 与 Markdown 链接；同时观察脚本执行标记、可执行 DOM、弹窗和攻击地址请求，避免将浏览器拦截外连误判为渲染安全。非法或伪装图片应在解码前拒绝，并保留草稿、原附件和已提交消息。

存储攻击回归验证伪造或混用会话、角色字段注入、原型字段与非法 ID、并发写入达到 200 条后的拒绝和历史完整性。这些是本地演示服务边界的校验：浏览器使用者仍可自行修改 IndexedDB，或者调用不验证凭据的演示客服登录方法，不能将其当成真实身份认证。私密 URL 也不提供客服权限。

真实服务器尚未实现，跨用户会话或附件越权、客服凭据验证、CSRF、网络消息限流与上传端安全不能由本轮前端测试证明。上线时需按上述后端契约逐请求验证权限，并针对真实 API 补充攻击联测。

- 普通用户预览进入 `/app` 后可打开右下角客服窗，发送文字和有效图片，并看到客服回复和未读提示。
- 客服可通过独立入口进入工作台，查看会话、用户资料、消息和图片；搜索与状态筛选可用，回复和解决状态可同步。
- 窄屏可操作会话列表和消息，键盘可开关客服窗，空消息和不支持的图片得到明确反馈。
- 本地退出或重置后，旧普通用户数据不可恢复或继续写入；跨标签页退出生效，虚构样例由显式操作生成。
- 构建、适当的状态测试、浏览器回归以及现有安全检查通过；生产认证与网络联调留待后端适配器实现。
