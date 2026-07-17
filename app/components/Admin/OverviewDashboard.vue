<template>
  <div class="overview-container">
    <!-- 统计卡片网格 -->
    <div class="stat-grid">
      <div
        v-for="(stat, i) in statCards"
        :key="i"
        class="stat-card"
      >
        <div class="stat-header">
          <div
            :class="[
              'stat-icon-box',
              stat.color === 'blue'
                ? 'stat-icon-box-blue'
                : stat.color === 'emerald'
                  ? 'stat-icon-box-emerald'
                  : stat.color === 'pink'
                    ? 'stat-icon-box-pink'
                    : 'stat-icon-box-zinc'
            ]"
          >
            <component :is="stat.icon" :size="24" />
          </div>
          <div
            v-if="stat.trend"
            :class="[
              'stat-trend',
              stat.trendDown ? 'stat-trend-down' : 'stat-trend-up'
            ]"
          >
            <TrendingDown v-if="stat.trendDown" :size="12" />
            <TrendingUp v-else :size="12" />
            {{ stat.trend }}
          </div>
        </div>
        <div class="stat-content">
          <p class="stat-label">{{ stat.label }}</p>
          <h4 class="stat-value">{{ stat.value }}</h4>
        </div>
      </div>
    </div>

    <div class="main-grid">
      <!-- 最近活动 -->
      <div
        class="activity-panel"
      >
        <div class="panel-header">
          <h3 class="panel-title">
            <Activity :size="18" class="panel-icon-blue" /> 最近活动
          </h3>
          <button
            class="panel-refresh"
            :class="{ 'animate-spin': loadingActivities }"
            @click="refreshActivities"
          >
            <RefreshCw :size="16" />
          </button>
        </div>
        <div
          class="panel-content"
        >
          <div
            v-if="loadingActivities && recentActivities.length === 0"
            class="empty-state"
          >
            <RefreshCw :size="24" class="animate-spin" />
            <span>加载中...</span>
          </div>
          <div
            v-else-if="recentActivities.length === 0"
            class="empty-state"
          >
            <Inbox :size="24" />
            <span>暂无活动记录</span>
          </div>
          <template v-else>
            <div
              v-for="(activity, idx) in recentActivities"
              :key="idx"
              class="activity-item"
            >
              <div
                :class="[
                  'activity-icon',
                  getActivityStyle(activity.type).bg
                ]"
              >
                <component :is="getActivityStyle(activity.type).icon" :size="18" />
              </div>
              <div class="activity-info">
                <h5
                  class="activity-title"
                >
                  {{ activity.title }}
                </h5>
                <p class="activity-description">{{ activity.description }}</p>
                <div class="activity-time">
                  <Clock :size="10" class="time-icon" />
                  <span class="time-text">{{
                    formatTime(activity.createdAt)
                  }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 系统状态 -->
      <div
        class="status-panel"
      >
        <div class="panel-header">
          <h3 class="panel-title">
            <ShieldCheck :size="18" class="panel-icon-emerald" /> 系统状态
          </h3>
          <span
            :class="[
              'status-badge',
              systemStatus.online
                ? 'status-badge-online'
                : 'status-badge-offline'
            ]"
          >
            {{ systemStatus.online ? '在线' : '离线' }}
          </span>
        </div>
        <div class="status-content">
          <div
            v-for="(status, i) in statusItems"
            :key="i"
            class="status-row"
          >
            <div class="status-left">
              <div
                :class="[
                  'status-dot',
                  status.active
                    ? 'status-dot-active'
                    : 'status-dot-inactive'
                ]"
              />
              <span class="status-label">{{ status.label }}</span>
            </div>
            <span class="status-value">{{ status.value }}</span>
          </div>
        </div>
        <div class="status-footer">
          <span class="footer-label">实例 ID</span>
          <button
            type="button"
            class="footer-button"
            :title="instanceId || '暂无实例 ID'"
            :disabled="!instanceId"
            @click="copyInstanceId"
          >
            {{ instanceId || '暂无实例 ID' }}
          </button>
        </div>
      </div>

      <!-- 快速操作 -->
      <div
        class="quick-actions-panel"
      >
        <div class="panel-header">
          <h3 class="panel-title">
            <Zap :size="18" class="panel-icon-yellow" /> 快速操作
          </h3>
        </div>
        <div class="quick-actions-content">
          <button
            v-for="(action, i) in quickActions"
            :key="i"
            :class="[
              'quick-action-button',
              action.primary ? 'quick-action-primary' : 'quick-action-secondary'
            ]"
            @click="navigateTo(action.id)"
          >
            <component :is="action.icon" :size="18" />
            {{ action.label }}
            <ExternalLink v-if="action.primary" :size="14" class="action-external" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  Activity,
  Ban,
  Bell,
  Calendar,
  Clock,
  ExternalLink,
  Heart,
  Inbox,
  Music,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  Zap
} from '@lucide/vue'
import packageJson from '~~/package.json'
import { useToast } from '~/composables/useToast'

const emit = defineEmits(['navigate'])
const { success: showSuccess, error: showError } = useToast()

const systemVersion = ref(packageJson.version)
const stats = ref({
  totalSongs: 0,
  totalUsers: 0,
  todaySchedules: 0,
  weeklyRequests: 0,
  songsChange: 0,
  usersChange: 0,
  requestsChange: 0,
  totalSchedules: 0,
  currentSemester: '',
  blacklistCount: 0
})

const recentActivities = ref([])
const loadingActivities = ref(false)
const instanceId = ref('')

const systemStatus = ref({
  online: true,
  database: true,
  api: true
})

// 统计卡片数据
const statCards = computed(() => [
  {
    label: '总歌曲数',
    value: formatNumber(stats.value.totalSongs),
    icon: Music,
    color: 'blue',
    trend: stats.value.songsChange !== 0 ? `${Math.abs(stats.value.songsChange)}%` : null,
    trendDown: stats.value.songsChange < 0
  },
  {
    label: '注册用户',
    value: formatNumber(stats.value.totalUsers),
    icon: Users,
    color: 'emerald'
  },
  {
    label: '今日排期',
    value: formatNumber(stats.value.todaySchedules),
    icon: Calendar,
    color: 'zinc'
  },
  {
    label: '本周点歌',
    value: formatNumber(stats.value.weeklyRequests),
    icon: Heart,
    color: 'pink',
    trend: stats.value.requestsChange !== 0 ? `${Math.abs(stats.value.requestsChange)}%` : null,
    trendDown: stats.value.requestsChange < 0
  }
])

// 系统状态项
const statusItems = computed(() => [
  {
    label: '数据库连接',
    value: systemStatus.value.database ? '正常' : '异常',
    active: systemStatus.value.database
  },
  {
    label: 'API服务',
    value: systemStatus.value.api ? '正常' : '异常',
    active: systemStatus.value.api
  },
  {
    label: '当前学期',
    value: stats.value.currentSemester || '未设置',
    active: !!stats.value.currentSemester
  },
  {
    label: '黑名单项目',
    value: `${stats.value.blacklistCount} 项`,
    active: stats.value.blacklistCount >= 0
  },
  { label: '系统版本', value: `v${systemVersion.value}`, active: true }
])

// 快速操作
const quickActions = [
  { label: '管理排期', icon: Calendar, id: 'schedule', primary: true },
  { label: '用户管理', icon: Users, id: 'users' },
  { label: '发送通知', icon: Bell, id: 'notifications' },
  { label: '黑名单管理', icon: Ban, id: 'blacklist' }
]

const formatNumber = (num) => {
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}

const getActivityStyle = (type) => {
  const styles = {
    song: { icon: Music, bg: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
    user: { icon: Users, bg: 'bg-pink-500/10 text-pink-500 border-pink-500/20' },
    schedule: { icon: Calendar, bg: 'bg-blue-500/10 text-blue-500 border-blue-500/20' }
  }

  return styles[type] || { icon: Activity, bg: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20' }
}

const loadStats = async () => {
  try {
    const response = await $fetch('/api/admin/stats', {
      ...useAuth().getAuthConfig()
    })
    stats.value = response
  } catch (error) {
    console.error('加载统计数据失败:', error)
  }
}

const loadSystemStatus = async () => {
  try {
    const response = await $fetch('/api/system/status')
    systemStatus.value.online = response?.status === 'ok'
    systemStatus.value.database = !!response?.database?.connected
    systemStatus.value.api = response?.status === 'ok'
    instanceId.value = response?.instance?.instanceId || ''
  } catch (error) {
    console.error('加载系统状态失败:', error)
    systemStatus.value.online = false
    systemStatus.value.database = false
    systemStatus.value.api = false
    instanceId.value = ''
  }
}

const copyToClipboard = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  return copied
}

const copyInstanceId = async () => {
  if (!instanceId.value) {
    showError('暂无实例 ID')
    return
  }

  try {
    const copied = await copyToClipboard(instanceId.value)
    if (copied) {
      showSuccess('实例 ID 已复制')
    } else {
      showError('复制失败')
    }
  } catch (error) {
    console.error('复制实例 ID 失败:', error)
    showError('复制失败')
  }
}

const loadRecentActivities = async () => {
  loadingActivities.value = true
  try {
    const response = await $fetch('/api/admin/activities', {
      ...useAuth().getAuthConfig()
    })
    recentActivities.value = response.activities || []
  } catch (error) {
    console.error('加载活动记录失败:', error)
    recentActivities.value = []
  } finally {
    loadingActivities.value = false
  }
}

const refreshActivities = () => {
  loadRecentActivities()
}

const formatTime = (dateString) => {
  const date = new Date(dateString)
  const now = getSyncedDate()
  const diff = now - date

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return `${Math.floor(diff / 86400000)}天前`
}

const navigateTo = (tab) => {
  emit('navigate', tab)
}

onMounted(() => {
  loadStats()
  loadSystemStatus()
  loadRecentActivities()
})
</script>

<style scoped>
.overview-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  animation: fadeIn 0.7s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(1rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 1.5rem;
}

@media (min-width: 640px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1280px) {
  .stat-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.stat-card {
  background-color: var(--components_Admin_OverviewDashboard_bg-card, #ffffff);
  border: 1px solid var(--components_Admin_OverviewDashboard_border-card, #e5e7eb);
  border-radius: 1rem;
  padding: 1.5rem;
  position: relative;
  overflow: hidden;
  transition: all 0.2s;
  box-shadow: var(--components_Admin_OverviewDashboard_shadow-card, 0 10px 15px -3px rgba(0, 0, 0, 0.05));
}

.stat-card:hover {
  border-color: var(--components_Admin_OverviewDashboard_border-card-hover, #d1d5db);
}

.stat-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.stat-icon-box {
  padding: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid transparent;
}

.stat-icon-box-blue {
  background-color: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  border-color: rgba(59, 130, 246, 0.2);
}

.stat-icon-box-emerald {
  background-color: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.2);
}

.stat-icon-box-pink {
  background-color: rgba(236, 72, 153, 0.1);
  color: #ec4899;
  border-color: rgba(236, 72, 153, 0.2);
}

.stat-icon-box-zinc {
  background-color: rgba(107, 114, 128, 0.1);
  color: var(--components_Admin_OverviewDashboard_text-label, #6b7280);
  border-color: rgba(107, 114, 128, 0.2);
}

.stat-trend {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.6875rem;
  font-weight: 700;
}

.stat-trend-up {
  color: #10b981;
}

.stat-trend-down {
  color: #ef4444;
}

.stat-content {
  margin-top: 0;
}

.stat-label {
  color: var(--components_Admin_OverviewDashboard_text-label, #6b7280);
  font-size: 0.875rem;
  font-weight: 500;
  margin: 0;
}

.stat-value {
  font-size: 1.875rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--components_Admin_OverviewDashboard_text-value, #18181b);
  margin: 0;
}

.main-grid {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 2rem;
}

@media (min-width: 1024px) {
  .main-grid {
    grid-template-columns: repeat(12, 1fr);
  }
}

.activity-panel {
  background-color: var(--components_Admin_OverviewDashboard_bg-card, #ffffff);
  border: 1px solid var(--components_Admin_OverviewDashboard_border-card, #e5e7eb);
  border-radius: 1.5rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--components_Admin_OverviewDashboard_shadow-card, 0 10px 15px -3px rgba(0, 0, 0, 0.05));
}

@media (min-width: 1024px) {
  .activity-panel {
    grid-column: span 5;
  }
}

.status-panel {
  background-color: var(--components_Admin_OverviewDashboard_bg-card, #ffffff);
  border: 1px solid var(--components_Admin_OverviewDashboard_border-card, #e5e7eb);
  border-radius: 1rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--components_Admin_OverviewDashboard_shadow-card, 0 10px 15px -3px rgba(0, 0, 0, 0.05));
}

@media (min-width: 1024px) {
  .status-panel {
    grid-column: span 4;
  }
}

.quick-actions-panel {
  background-color: var(--components_Admin_OverviewDashboard_bg-card, #ffffff);
  border: 1px solid var(--components_Admin_OverviewDashboard_border-card, #e5e7eb);
  border-radius: 1.5rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--components_Admin_OverviewDashboard_shadow-card, 0 10px 15px -3px rgba(0, 0, 0, 0.05));
}

@media (min-width: 1024px) {
  .quick-actions-panel {
    grid-column: span 3;
  }
}

.panel-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--components_Admin_OverviewDashboard_border-card, #e5e7eb);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-size: 1.125rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--components_Admin_OverviewDashboard_text-value, #18181b);
  margin: 0;
}

.panel-icon-blue {
  color: #3b82f6;
}

.panel-icon-emerald {
  color: #10b981;
}

.panel-icon-yellow {
  color: #eab308;
}

.panel-refresh {
  padding: 0.5rem;
  color: var(--components_Admin_OverviewDashboard_text-secondary, #9ca3af);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.2s;
}

.panel-refresh:hover {
  color: var(--components_Admin_OverviewDashboard_text-value, #18181b);
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  gap: 0.25rem;
  min-height: 380px;
  max-height: 500px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--components_Admin_OverviewDashboard_text-secondary, #9ca3af);
  gap: 0.75rem;
  padding: 5rem;
}

.empty-state span {
  font-size: 0.875rem;
}

.activity-item {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  border-radius: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.activity-item:hover {
  background-color: var(--components_Admin_OverviewDashboard_bg-item-hover, #f3f4f6);
}

.activity-icon {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
}

.activity-info {
  flex: 1;
  min-width: 0;
}

.activity-title {
  font-weight: 700;
  font-size: 0.875rem;
  color: var(--components_Admin_OverviewDashboard_text-value, #18181b);
  margin: 0;
  transition: color 0.2s;
}

.activity-item:hover .activity-title {
  color: var(--components_Admin_OverviewDashboard_text-hover, #2563eb);
}

.activity-description {
  font-size: 0.75rem;
  color: var(--components_Admin_OverviewDashboard_text-secondary, #9ca3af);
  margin: 0.25rem 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-time {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.5rem;
}

.time-icon {
  color: var(--components_Admin_OverviewDashboard_text-tertiary, #6b7280);
}

.time-text {
  font-size: 0.625rem;
  color: var(--components_Admin_OverviewDashboard_text-tertiary, #6b7280);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-content {
  padding: 1.5rem;
  gap: 1.5rem;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.status-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
}

.status-dot-active {
  background-color: #10b981;
  box-shadow: 0 0 10px var(--components_Admin_OverviewDashboard_141_0, rgba(16, 185, 129, 0.7));
}

.status-dot-inactive {
  background-color: var(--components_Admin_OverviewDashboard_text-tertiary, #6b7280);
}

.status-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--components_Admin_OverviewDashboard_text-secondary, #9ca3af);
}

.status-value {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--components_Admin_OverviewDashboard_text-value, #18181b);
}

.status-footer {
  margin-top: auto;
  border-top: 1px solid var(--components_Admin_OverviewDashboard_border-card, #e5e7eb);
  padding: 1rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  text-align: center;
}

.footer-label {
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: var(--components_Admin_OverviewDashboard_text-tertiary, #6b7280);
}

.footer-button {
  max-width: 100%;
  font-size: 0.75rem;
  color: var(--components_Admin_OverviewDashboard_text-secondary, #9ca3af);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.2s;
  word-break: break-all;
  line-height: 1.5;
}

.footer-button:hover:not(:disabled) {
  color: var(--components_Admin_OverviewDashboard_text-value, #18181b);
}

.footer-button:disabled {
  cursor: default;
}

.status-badge {
  padding: 0.25rem 0.75rem;
  font-size: 0.625rem;
  font-weight: 900;
  text-transform: uppercase;
  border-radius: 9999px;
  border: 1px solid transparent;
}

.status-badge-online {
  background-color: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.2);
}

.status-badge-offline {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.2);
}

.quick-actions-content {
  padding: 1.5rem;
  gap: 0.75rem;
}

.quick-action-button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-radius: 0.5rem;
  border: 1px solid transparent;
  font-weight: 700;
  font-size: 0.875rem;
  transition: all 0.2s;
  text-align: left;
  cursor: pointer;
}

.quick-action-primary {
  background-color: #2563eb;
  border-color: #1d4ed8;
  color: white;
  box-shadow: 0 20px 25px -5px rgba(37, 99, 235, 0.1);
}

.quick-action-primary:hover {
  background-color: #1d4ed8;
}

.quick-action-secondary {
  background-color: var(--components_Admin_OverviewDashboard_bg-quick-secondary, #f3f4f6);
  border-color: var(--components_Admin_OverviewDashboard_border-card, #e5e7eb);
  color: var(--components_Admin_OverviewDashboard_text-quick-secondary, #6b7280);
}

.quick-action-secondary:hover {
  border-color: var(--components_Admin_OverviewDashboard_bg-quick-secondary-hover, #e5e7eb);
  color: var(--components_Admin_OverviewDashboard_text-value, #18181b);
}

.action-external {
  margin-left: auto;
  opacity: 0.5;
}

/* 自定义滚动条样式 */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--components_Admin_OverviewDashboard_440_0);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--components_Admin_OverviewDashboard_444_0);
}
</style>
