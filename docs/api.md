# API 约定

基础路径：`/api/v1`。

- JSON 请求由 Zod 校验。
- 认证使用 `Authorization: Bearer <token>`。
- 刷新令牌使用 HttpOnly Cookie；刷新请求需要 `X-CSRF-Token`。
- 错误返回类似 RFC 9457 的结构，并包含 `code`、`detail` 和 `requestId`。
- 地图查询必须传 `bbox=minLon,minLat,maxLon,maxLat`，单次跨度限制为 5 度。

## 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/categories` | 分类与详情 schema |
| `GET` | `/features?bbox=...` | 查询已发布地图要素 |
| `GET` | `/features/:id` | 已发布详情；作者和审核员可查看私有状态 |
| `GET` | `/features/:id/comments` | 已发布评论 |
| `GET` | `/features/:id/confirmations` | 时效确认汇总 |
| `GET` | `/health/live` | 进程存活 |
| `GET` | `/health/ready` | 数据库就绪 |

## 账号接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/auth/register` | 注册并加入验证邮件 outbox |
| `POST` | `/auth/verify-email` | 邮箱验证 |
| `POST` | `/auth/login` | 登录并建立刷新会话 |
| `POST` | `/auth/refresh` | 轮换刷新令牌 |
| `POST` | `/auth/logout` | 撤销会话 |
| `POST` | `/auth/password/forgot` | 发送重置邮件 |
| `POST` | `/auth/password/reset` | 重置密码 |
| `GET` | `/me` | 当前用户 |
| `PATCH` | `/me` | 修改昵称 |
| `POST` | `/me/export` | 导出账号数据 |
| `POST` | `/me/delete` | 申请删除账号 |

## 投稿接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/features` | 创建草稿 |
| `PATCH` | `/features/:id/draft` | 更新草稿或被拒内容 |
| `POST` | `/features/:id/submit` | 提交最新草稿 |
| `POST` | `/features/:id/revisions` | 为已发布内容创建修订 |
| `POST` | `/features/:id/revisions/:revisionId/submit` | 提交修订 |
| `GET` | `/features/:id/revisions` | 作者/审核员查看历史 |
| `GET` | `/me/features` | 我的投稿 |
| `DELETE` | `/features/:id` | 软删除 |
| `POST` | `/features/:id/confirmations` | 记录时效确认 |

## 媒体接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/media/uploads` | 创建隔离区签名上传 |
| `POST` | `/media/uploads/:id/complete` | 提交隐私框并启动服务端处理 |
| `GET` | `/media/:id` | 查询处理状态 |
| `GET` | `/media/:id/preview` | 审核员获取短期私有预览（需有效委托） |
| `POST` | `/media/:id/privacy-approve` | 审核员确认隐私并发布派生图（高风险，需高风险委托） |
| `POST` | `/media/:id/retry` | 重试失败处理 |
| `DELETE` | `/media/:id` | 删除媒体对象 |

## 评论、举报和通知

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/features/:id/comments` | 创建待审核评论 |
| `PATCH` | `/comments/:id` | 15 分钟编辑窗口 |
| `DELETE` | `/comments/:id` | 删除评论 |
| `POST` | `/reports` | 举报内容或评论 |
| `GET` | `/me/notifications` | 通知列表 |
| `POST` | `/me/notifications/:id/read` | 标记已读 |

## 审核接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/moderation/queue` | 内容、评论、媒体和举报队列（审核员仅见委托范围内条目） |
| `GET` | `/moderation/scope` | 当前用户的有效委托范围（供页面过滤） |
| `POST` | `/moderation/features/:id/approve` | 批准内容或修订（限委托范围） |
| `POST` | `/moderation/features/:id/reject` | 拒绝（限委托范围） |
| `POST` | `/moderation/features/:id/request-changes` | 要求修改（限委托范围） |
| `POST` | `/moderation/features/:id/hide` | 隐藏（高风险，需高风险委托） |
| `POST` | `/moderation/features/:id/restore` | 管理员恢复 |
| `POST` | `/moderation/comments/:id/approve` | 批准评论（限委托范围） |
| `POST` | `/moderation/comments/:id/reject` | 拒绝评论（限委托范围） |
| `POST` | `/moderation/comments/:id/hide` | 隐藏评论（高风险，需高风险委托） |
| `POST` | `/moderation/reports/:id/resolve` | 处理举报；hide/restore 为高风险动作 |
| `GET` | `/moderation/audit` | 管理员审计日志 |

## 审核权限委托（管理员）

委托按分类与地区（bbox）授予临时审核范围，最长 30 天；`allowHighRisk` 控制隐藏、媒体隐私确认等高风险操作。委托、撤销、越权拒绝与高风险操作都写入同一审计日志。越权请求返回 `403` 与 `DELEGATION_SCOPE_EXCEEDED`，并记录 `moderation.scope_denied` 审计。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/admin/delegations?status=` | 委托列表（active / revoked / expired / all） |
| `POST` | `/admin/delegations` | 授予委托：`delegateEmail`、`categoryKeys`（空为全部）、`region`、`regionName`、`allowHighRisk`、`expiresInHours`、`note` |
| `POST` | `/admin/delegations/:id/revoke` | 撤销委托：`reason` |
| `GET` | `/admin/delegations/audit` | 委托、撤销、越权拒绝与高风险操作的共同审计视图 |
