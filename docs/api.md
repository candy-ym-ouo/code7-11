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
| `GET` | `/media/:id/preview` | 审核员获取短期私有预览 |
| `POST` | `/media/:id/privacy-approve` | 审核员确认隐私并发布派生图 |
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

审核员的能力由管理员授予的**临时委托**决定：每条委托包含审核动作集合、分类集合（空=全部分类）、地理区域（`null`=不限地区）和最长 30 天的有效期。审核队列只返回在委托范围内的条目；执行动作时服务端再次强制校验，越权返回 `403 FORBIDDEN`（页面层按钮禁用只是辅助）。管理员不受委托限制。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/moderation/queue` | 内容、评论、媒体和举报队列（审核员仅见委托范围内条目） |
| `POST` | `/moderation/features/:id/approve` | 批准内容或修订（需 `feature.approve`） |
| `POST` | `/moderation/features/:id/reject` | 拒绝（需 `feature.reject`，高风险审计） |
| `POST` | `/moderation/features/:id/request-changes` | 要求修改（需 `feature.request_changes`） |
| `POST` | `/moderation/features/:id/hide` | 隐藏（需 `feature.hide`，高风险审计） |
| `POST` | `/moderation/features/:id/restore` | 管理员恢复（不可委托，仅管理员） |
| `POST` | `/moderation/comments/:id/approve` | 批准评论（需 `comment.approve`） |
| `POST` | `/moderation/comments/:id/reject` | 拒绝评论（需 `comment.reject`，高风险审计） |
| `POST` | `/moderation/comments/:id/hide` | 隐藏评论（需 `comment.hide`，高风险审计） |
| `POST` | `/moderation/reports/:id/resolve` | 处理举报（需 `report.resolve`；`hide` 还需对应隐藏权限，`restore` 仅管理员） |
| `GET` | `/moderation/my-scope` | 审核员查询自己当前有效的委托范围 |
| `GET` | `/moderation/audit` | 管理员审计日志（支持 `action`、`resourceType`、`delegationOnly` 过滤） |

## 审核权限委托（仅管理员）

地区 `region` 支持两种形式：矩形 `{"type":"bbox","bbox":[minLon,minLat,maxLon,maxLat]}`，或闭合的 GeoJSON `{"type":"Polygon","coordinates":[...]}`；`null` 表示不限地区。`categoryKeys` 为空数组表示全部分类。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/admin/moderators` | 可被授予范围的审核员列表 |
| `GET` | `/admin/delegations` | 自己发起的委托，支持 `granteeId`、`status=active|revoked|expired|all` |
| `POST` | `/admin/delegations` | 授予临时范围（5 分钟至 30 天，理由必填，写入审计 `delegation.granted`） |
| `DELETE` | `/admin/delegations/:id` | 提前撤销（理由必填，写入审计 `delegation.revoked`） |

`POST /admin/delegations` 请求体：

```json
{
  "granteeId": "uuid",
  "permissions": ["feature.approve", "feature.reject"],
  "categoryKeys": ["bench", "drinking_water"],
  "region": { "type": "bbox", "bbox": [116.3, 39.8, 116.5, 40.0] },
  "validUntil": "2026-10-02T00:00:00.000Z",
  "reason": "汛期专项，负责两周饮水处审核"
}
```

可委托权限：`feature.approve`、`feature.reject`、`feature.request_changes`、`feature.hide`、`comment.approve`、`comment.reject`、`comment.hide`、`media.privacy_approve`、`report.resolve`。其中拒绝、隐藏、媒体隐私确认和举报处理为高风险动作，审计元数据会带 `highRisk:true` 与 `delegationId`；委托授予/撤销使用 `resource_type=moderation_delegation` 写入同一条审计流，可用 `GET /moderation/audit?delegationOnly=true` 统一查看。
