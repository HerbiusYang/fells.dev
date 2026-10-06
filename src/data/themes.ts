export const themes = [
  { id: "main", name: "主站", label: "深色 · 产品与工作区", href: "/zh/", description: "完整的产品站，适合介绍套餐、Agent 和云端工作区。" },
  { id: "synara", name: "Synara", label: "暖灰 · 编辑式布局", href: "/themes/synara/", description: "更轻松的工作区叙事，支持浅色与深色外观。" },
  { id: "apple-launch", name: "Apple Launch", label: "白色 · 产品发布", href: "/themes/apple-launch/", description: "以产品图片、横向陈列和细节卡片介绍 Claude 套餐。" },
] as const;

export type ThemeId = typeof themes[number]["id"];
