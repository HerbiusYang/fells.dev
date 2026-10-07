# 在线客服前端与后端接口预留

## 功能计划

从已包含安全修复的本地 `hydra`（`dcec84b`）建立 `codex/online-support` 分支。此次实现前端交互，并为未来后端保留类型化接口；不新增服务器、真实账号认证或上传服务。

1. 在 `/app` 增加右下角客服入口，支持文字、图片、消息记录、未读提示和移动端。
2. 新增由构建环境配置的私密客服入口 `/<SUPPORT_PORTAL_PATH>` 和工作台 `/<SUPPORT_PORTAL_PATH>/desk`，显示会话列表、用户资料与历史消息，支持搜索、筛选、回复、已读与解决状态。
3. 所有入口覆盖现有六种语言。前端读写统一经过 `src/lib/support-service.ts`，本地演示使用独立 IndexedDB 数据；生产后端契约放在 `src/lib/support-api.ts`。
4. 验证双向文字与图片消息、跨标签页同步、未读、筛选、用户资料、移动端布局、退出清理以及原有安全回归。

当前 `/app/start` 和客服入口都是**本地预览**。普通用户的邮箱和客服的姓名、邮箱仅作为展示信息，不认证账号，也不赋予真实客服权限。预览只在同一浏览器、同一站点内的标签页之间同步；不同设备不会互通。生产上线时应替换本地适配器，并接入真实的普通用户和客服认证。

开始新的普通用户预览或退出普通用户预览时，删除与该预览关联的客服会话及附件，旧标签页不可继续保存。客服工作台中的示例用户需由“加载示例”按钮主动添加，均为虚构数据；这些独立示例不会因普通用户退出而被删除。不要将真实客服凭证或客户资料填入预览。

## 私密客服入口配置

客服入口没有固定默认路径。`SUPPORT_PORTAL_PATH` 只在开发服务器或构建时读取，未配置时不生成客服页面。使用以下命令生成 192 位随机值：

```bash
node -e "console.log('SUPPORT_PORTAL_PATH=' + require('node:crypto').randomBytes(24).toString('hex'))"
```

将输出保存到已被 Git 忽略的 `.env.local`，供本地开发与构建使用；生产环境在构建平台设置同名变量。不要提交实际值，不要使用 `PUBLIC_` 前缀，也不要将入口写入客户可下载的 JavaScript。中文入口为 `/zh/<SUPPORT_PORTAL_PATH>`，中文工作台为 `/zh/<SUPPORT_PORTAL_PATH>/desk`；尖括号内容是占位符，实际地址使用环境配置的值。

原 `/support/login` 和 `/support` 以及其语言版本均返回 404，不跳转到新入口。普通用户客服窗不提供客服登录链接。私密页面设置 `noindex,nofollow,noarchive`，移除 canonical、hreflang、`og:url` 元信息及第三方字体请求；不要在 `robots.txt` 或 `_headers` 暴露该路径。

轮换入口时生成新值、更新构建环境并重新构建，部署时完整替换旧输出，清除旧入口文件。随机且不公开链接的路径可降低猜测与公开链接发现的概率，无法保证永不被发现，也不提供身份认证。当前仍为本地预览；真实客服权限和客户数据访问必须由后端会话及权限校验控制。后端 API 保持 `/api/support` 前缀，无需随入口轮换。

## 接口契约

`SupportBackendApi` 仅定义未来适配器需要实现的方法，没有网络请求或后端实现。以下路径均以 `/api/support` 为前缀。普通用户身份由既有账号服务器会话取得；客服身份由独立的服务器客服会话取得。接口不能接受浏览器生成的会话标识、用户资料或角色作为认证依据。

| 方法和路径 | 前端方法 | 请求与响应 |
| --- | --- | --- |
| `POST /session` | `loginOperator` | `{ email, password }`；返回客服资料和过期时间，由服务器设置会话 Cookie |
| `GET /session` | `readOperatorSession` | 返回客服会话或 `null` |
| `DELETE /session` | `logoutOperator` | 撤销客服服务器会话；返回 `null` |
| `GET /conversations` | `listConversations` | 客服专用；查询 `cursor`, `limit`, `status`, `search`，返回会话摘要分页 |
| `GET /conversations/current` | `getCurrentConversation` | 普通用户自己的会话或 `null` |
| `POST /conversations/current` | `ensureCurrentConversation` | 不传用户 ID；幂等获取或创建当前用户会话 |
| `GET /conversations/:id` | `getConversation` | 返回会话详情、用户资料和双方已读位置 |
| `GET /conversations/:id/messages` | `listMessages` | 查询 `cursor`, `limit`，返回消息分页 |
| `POST /attachments` | `uploadAttachment` | `multipart/form-data` 的 `file`；返回附件 ID、元信息与限时访问 URL |
| `POST /conversations/:id/messages` | `sendMessage` | `{ clientMessageId, text, attachmentIds }`；返回服务器确认的消息 |
| `PATCH /conversations/:id/read` | `markRead` | `{ lastReadMessageId }`；服务器确定读者身份并返回已读位置 |
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

## 图片、消息和鉴权约束

- 文字最多 4,000 字符；至少有文字或一个附件，每条消息最多一个图片附件。图片仅接受 PNG、JPEG、WebP，每张最多 2 MiB；客户端做体验校验，服务器仍需独立校验实际文件大小、内容与附件数量。
- 生产图片先上传再发送附件 ID。服务器检查上传者和会话访问权限，并返回限时授权 URL；不要将本地演示的 Data URL 存入生产消息 DTO，也不要使用永久公开的客户图片 URL。
- 发送消息使用客户端 UUID `clientMessageId`。同一会话和认证发送者重试相同 ID 应返回原消息；同一 ID 搭配不同内容返回 `conflict`。
- 普通用户只能访问自己的会话、消息、附件和事件。只有服务器验证的客服权限可查看其他用户资料、搜索会话、回复及改变状态。每个 `:id` 都重新检查访问权限。
- Cookie 使用 `HttpOnly`、`Secure` 与适当的 `SameSite`。对写接口实施 CSRF 防护、来源检查和限流，退出后撤销服务器会话。消息展示只使用安全文本和已验证图片地址，不能将消息作为 HTML 注入页面。

## 实时事件

SSE 的事件名称与 `SupportEventDto.type` 一致：`message.created`、`conversation.updated`、`conversation.read`、`session.expired`。每个事件包含可续传的 `id` 与类型对应的 `data`，仅发送当前账号有权查看的内容。适配器可用 `lastEventId` 恢复连接，按消息 ID 去重，并在断线后重新获取会话状态；退出或组件销毁时关闭连接。

本地适配器使用同源广播提示其他标签页重新读 IndexedDB，没有 SSE、WebSocket 或真实在线状态。接入后端时替换服务边界的适配器，将服务器会话、上传、分页及事件转换为 UI 所需数据；清除本地演示数据并移除“加载示例”入口。

## 验收

- 普通用户预览进入 `/app` 后可打开右下角客服窗，发送文字和有效图片，并看到客服回复和未读提示。
- 客服可通过独立入口进入工作台，查看会话、用户资料、消息和图片；搜索与状态筛选可用，回复和解决状态可同步。
- 窄屏可操作会话列表和消息，键盘可开关客服窗，空消息和不支持的图片得到明确反馈。
- 本地退出或重置后，旧普通用户数据不可恢复或继续写入；跨标签页退出生效，虚构样例由显式操作生成。
- 构建、适当的状态测试、浏览器回归以及现有安全检查通过；生产认证与网络联调留待后端适配器实现。
