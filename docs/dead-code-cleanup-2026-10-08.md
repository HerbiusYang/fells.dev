# 死代码清理记录

日期：2026-10-08。基线：`4a55144cc8c962f53adea82999fb34c27675e52b`。分支：`codex/dead-code-cleanup`。

全仓扫描覆盖基线的 192 个 Git 跟踪文件，包括源码、路由、组件、布局、模板、静态资源、六语言字典、测试、脚本、依赖及构建/CI 配置。用户先审阅清单，再授权复核无问题后删除。三个 agent 分别重新核对导出与动态调用、CSS 消费者、字典消费路径；主 agent 复核完整 diff 并加强静态门禁。

## 已清理范围

| 分类 | 数量 | 具体范围 |
| --- | ---: | --- |
| 多余导出/重导出 | 9 | `notifyPreview`、`MAX_SUPPORT_BOARD_BYTES`、`notifySupport`、`SupportUser`、`SupportMessage`、后两者在 service 的重导出、`AgentId`、`buildDirectory` |
| 无消费者的返回成员 | 2 | presence 的 `activity`；availability Reader 的 `refresh` |
| 未使用图标数据 | 3 | `ICONS.search/chart/sidebar` |
| 无匹配元素的 CSS 选择器 | 9 | 下表列出 |
| 未读取文案定义 | 252 | 42 个路径 × `en/zh/zh-hant/ja/ko/es` 六语言 |

多余导出仅移除导出声明；其内部实现、类型、容量限制和通知仍保留。两个返回成员对应的内部函数、定时器和事件监听仍保留。去掉 TypeScript 类型导出并不代表浏览器包产生同等字节缩减。

| 文件 | 删除的 CSS 选择器 |
| --- | --- |
| `src/components/pages/AppPage.astro` | `.fx .pop .mi.active`、`.fx .chan .logo`、`.fx .plug .logo` |
| `templates/apple-launch/index.html` | `.vh`、`.btn.dark`、`.btn.dark:hover`、`.tile .hint`、`.cmp tbody td span` |
| `templates/synara/index.html` | `.count b` |

popover 的 `:hover`、调色板的 `.active`、主题状态、对话框及媒体查询均保留。三个文件的非样式内容逐字保持一致。

## 已删除的词典路径

以下路径在对应六语言文件中同步删除；未修改其他文案值。

| 字典组 | 路径 |
| --- | --- |
| `src/i18n/*.ts` | `ui.billingPeriod` |
| `src/i18n/pages/*.ts` | `common.ctaButton`、`blog.viewAll` |
| `src/i18n/app/*.ts` | `preview`、`nav.switchWs`、`nav.startChat`、`nav.search`、`account.tips`、`members.manage`、`members.copied`、`plugins.advanced` |
| 同上 | `wsSettings.overview.rename`、`wsSettings.computer.settings`、`wsSettings.computer.envSub`、`wsSettings.computer.save`、`wsSettings.computer.saved`、`wsSettings.usage.weeks` |
| 同上 | `billing.credits`、`billing.paysFor`、`topup.close` |
| 同上 | `invite.sub`、`invite.card`、`invite.upTo`、`invite.pct`、`invite.pctSub`、`invite.code`、`invite.friendGets`、`invite.how`、`invite.steps` |
| 同上 | `invite.mine`、`invite.stats`、`invite.available`、`invite.pending`、`invite.total`、`invite.history`、`invite.noHistory`、`invite.rules`、`invite.copy`、`invite.copied` |
| 同上 | `help.copy`、`example.title`、`common.today` |

消费审查包含应用字典 `A` 的别名和动态读取；整字典序列化不等于这些字段有功能消费者。邀请弹窗实际读取 `invite.title` 与 `security.inviteUnavailable`，旧邀请正文其余 19 个字段不再使用。`invite.steps` 按一个数组字段统计。

保留 `invite.title`、`api.preview`、`account.credits`、`common.close`、`help.copied`、`example.name`、`example.chats[].title`、`security.envNotice` 等有用途字段。AST 复核六语言键结构一致，所有其他文案 initializer 文本保持一致。

## 保留范围与持续检查

`src/lib/support-api.ts` 是有文档明确用途的预留后端 DTO/接口契约，继续保留及显式 Knip 排除。没有确认可整文件删除的页面、组件、布局、图片、测试或直接依赖。

Knip 改为全部默认问题类别检查及生产严格检查，移除 `ignoreExportsUsedInFile`，标记生产源码范围，并对齐实际测试入口。七个有内部调用、又直接用于安全/边界单测的导出以 `@internal` 精确标记；生产扫描忽略其对外导出，普通扫描仍检查测试消费者。具体名单与门禁口径见 [前端质量说明](frontend-quality.md)。

静态门禁无法独立证明所有 CSS、动态属性和词典路径均有用途；本次清理结论基于静态扫描、实际消费路径、动态状态复核与完整回归验证。

## 验证

完整验证运行 `pnpm test:coverage`，包括 Astro、严格 TypeScript、两次 Knip、配置/未配置客服入口的独立构建、单元测试、浏览器回归及覆盖率门禁。GitHub Actions 使用 `TEST_REQUIRE_BROWSERS=1`，要求 Chromium、Firefox、WebKit 测试实际执行。

本次本地完整验证退出码为 0：

| 检查 | 结果 |
| --- | --- |
| Astro | 142 个文件，零错误、警告、提示 |
| 严格 TypeScript、普通 Knip、生产严格 Knip | 均通过 |
| 单元测试 | 92/92 通过，0 跳过 |
| 配置客服入口的浏览器测试 | 107 通过、0 失败、2 项 Firefox 环境跳过 |
| 未配置客服入口的公共组件测试 | 1/1 通过，0 跳过 |
| Node 行/分支/函数覆盖率 | 99.34% / 89.83% / 91.67% |
| Chromium JS 执行覆盖率 | 83.35%，24 个去重脚本 |
| 依赖审计 | `pnpm audit --audit-level=high` 通过，报告所有级别已知漏洞均为 0 |
| `git diff --check` | 通过 |

本机 Firefox 因沙箱运行条件不可用而跳过，以上本地结果不能作为 Firefox 兼容性通过的证据。远端清理分支的严格三浏览器结果应以该提交的 GitHub Actions 记录为准。
