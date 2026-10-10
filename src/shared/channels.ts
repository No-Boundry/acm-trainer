/**
 * 跨进程共享的 IPC 通道常量。
 * 命名规范：`域:动作`，见 docs/03-详细设计 §3。
 */
export const IpcChannels = {
  // 冒烟/系统
  Ping: 'db:ping',

  // 题库
  ProblemsList: 'problems:list',
  ProblemsGet: 'problems:get',
  ProblemsSync: 'problems:sync',
  ProblemsLastSync: 'problems:lastSync',
  ProblemsTags: 'problems:tags',
  LuoguSync: 'luogu:sync', // v1.1 FR-8：洛谷题库同步
  LuoguImportPractice: 'luogu:importPractice', // v1.2 FR-8.9：UID 做题记录导入
  LeetcodeSync: 'leetcode:sync', // v1.9 FR-21：力扣题库同步
  ProblemsSyncProgress: 'problems:sync:progress', // main -> renderer 事件

  // 练习记录
  RecordsCreate: 'records:create',
  RecordsList: 'records:list',
  RecordsUpdate: 'records:update',
  RecordsDelete: 'records:delete',
  RecordsStats: 'records:stats',
  StatsDifficulty: 'stats:difficulty', // v1.9 FR-22：按题目难度标签统计

  // 题单 + 训练计划 + 间隔复习（v1.10 FR-27~FR-29）
  ListsList: 'lists:list',
  ListsGet: 'lists:get',
  ListsCreate: 'lists:create',
  ListsUpdate: 'lists:update',
  ListsDelete: 'lists:delete',
  ListsAddProblems: 'lists:addProblems',
  ListsRemoveItem: 'lists:removeItem',
  ListsSetDone: 'lists:setDone',
  ListsSetNote: 'lists:setNote',
  ListsParseText: 'lists:parseText',
  ListsGenerate: 'lists:generate',
  ListsReview: 'lists:review',
  ListsDueReviews: 'lists:dueReviews',
  PlansList: 'plans:list',
  PlansGet: 'plans:get',
  PlansCreate: 'plans:create',
  PlansDelete: 'plans:delete',
  PlansToggleTask: 'plans:toggleTask',
  PlansMarkBusy: 'plans:markBusy',
  PlansUnmarkBusy: 'plans:unmarkBusy',
  PlansReschedule: 'plans:reschedule',

  // 笔记
  NotesList: 'notes:list',
  NotesGet: 'notes:get',
  NotesCreate: 'notes:create',
  NotesUpdate: 'notes:update',
  NotesDelete: 'notes:delete',

  // 模板
  TemplatesList: 'templates:list',
  TemplatesGet: 'templates:get',
  TemplatesCreate: 'templates:create',
  TemplatesUpdate: 'templates:update',
  TemplatesDelete: 'templates:delete',
  TemplatesCopy: 'templates:copy',

  // 虚拟比赛
  ContestsCreate: 'contests:create',
  ContestsGenerate: 'contests:generate',
  ContestsStart: 'contests:start',
  ContestsSubmit: 'contests:submit',
  ContestsFinish: 'contests:finish',
  ContestsList: 'contests:list',
  ContestsGet: 'contests:get',
  ContestsResult: 'contests:result',
  ContestsDelete: 'contests:delete',

  // 水平评估
  RatingGet: 'rating:get',
  RatingRecalc: 'rating:recalc',

  // 题面（v1.8：用 Edge 浏览器打开；洛谷登录窗口仅用于 UID 导入登录态）
  StatementOpen: 'statement:open',
  LuoguOpenLogin: 'luogu:openLogin',

  // v1.8.2：打开外部链接（仅 https，系统浏览器；用于 STL 速查等参考资料）
  AppOpenExternal: 'app:openExternal',

  // 设置
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  SettingsGetAll: 'settings:getAll',

  // 数据备份
  DataExport: 'data:export',
  DataImport: 'data:import',

  // 个人资料（v1.4：用户名/头像）
  ProfilePickAvatar: 'profile:pickAvatar',
  ProfileReadAvatar: 'profile:readAvatar',

  // 技能树（v1.6 FR-9）
  SkillGet: 'skill:get',

} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** 主进程 → 渲染进程的事件通道（preload on 白名单） */
export const EVENT_CHANNELS: readonly string[] = [IpcChannels.ProblemsSyncProgress]

/** 渲染进程 → 主进程的 invoke 通道（preload invoke 白名单） */
export const INVOKE_CHANNELS: readonly string[] = Object.values(IpcChannels).filter(
  (c) => !EVENT_CHANNELS.includes(c)
)
