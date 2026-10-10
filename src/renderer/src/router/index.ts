import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardPage from '../pages/DashboardPage.vue'
import ProblemsPage from '../pages/ProblemsPage.vue'
import NotesPage from '../pages/NotesPage.vue'
import TemplatesPage from '../pages/TemplatesPage.vue'
import StatsPage from '../pages/StatsPage.vue'
import ContestsPage from '../pages/ContestsPage.vue'
import RatingPage from '../pages/RatingPage.vue'
import SettingsPage from '../pages/SettingsPage.vue'
import SkillTreePage from '../pages/SkillTreePage.vue'
import ReferencePage from '../pages/ReferencePage.vue'
import ListsPage from '../pages/ListsPage.vue'

/**
 * 路由表（11 个页面，与 docs/03-详细设计 §7.2 对齐 + 设置页 FR-7 + 技能树 FR-9 + 题单/计划 FR-27/28）。
 */
const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', component: DashboardPage, meta: { title: '首页' } },
  { path: '/problems', component: ProblemsPage, meta: { title: '题库' } },
  { path: '/lists', component: ListsPage, meta: { title: '题单 / 计划' } },
  { path: '/stats', component: StatsPage, meta: { title: '统计' } },
  { path: '/notes', component: NotesPage, meta: { title: '笔记 / 错题本' } },
  { path: '/templates', component: TemplatesPage, meta: { title: '模板库' } },
  { path: '/contests', component: ContestsPage, meta: { title: '虚拟比赛' } },
  { path: '/rating', component: RatingPage, meta: { title: '水平评估' } },
  { path: '/skills', component: SkillTreePage, meta: { title: '学习路径' } },
  { path: '/reference', component: ReferencePage, meta: { title: 'STL 速查' } },
  { path: '/settings', component: SettingsPage, meta: { title: '设置' } }
]

export default createRouter({
  history: createWebHashHistory(),
  routes
})
