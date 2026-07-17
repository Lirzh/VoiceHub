<!-- 侧边栏组件 -->
<template>
  <aside
    :class="[
      'sidebar',
      isOpen ? 'sidebar-open' : 'sidebar-closed'
    ]"
  >
    <div class="sidebar-content">
      <!-- 品牌标识区域 -->
      <div class="sidebar-brand">
        <NuxtLink to="/" class="brand-link">
          <div class="brand-logo">
            <img :src="logo" alt="VoiceHub Logo" class="logo-image" >
          </div>
          <div class="brand-text">
            <h1 class="brand-title">VoiceHub</h1>
            <p class="brand-subtitle">管理控制台</p>
          </div>
        </NuxtLink>
      </div>

      <!-- 导航菜单区域 -->
      <nav class="sidebar-nav">
        <div v-for="(group, idx) in menuGroups" :key="idx" class="menu-group">
          <template v-if="shouldShowGroup(group)">
            <h3 class="group-title">{{ group.section }}</h3>
            <template v-for="item in group.items" :key="item.id">
              <button
                v-if="permissions.canAccessPage(item.permissionId || item.id)"
                :class="[
                  'menu-item',
                  activeTab === item.id ? 'menu-item-active' : 'menu-item-inactive'
                ]"
                @click="onNavigate(item.id)"
              >
                <component
                  :is="item.icon"
                  :size="18"
                  :class="[
                    'menu-icon',
                    activeTab === item.id ? 'menu-icon-active' : 'menu-icon-inactive'
                  ]"
                />
                <span class="menu-label">{{ item.label }}</span>
                <div
                  v-if="activeTab === item.id"
                  class="menu-indicator"
                />
              </button>
            </template>
          </template>
        </div>
      </nav>

      <!-- 用户信息及退出登录 -->
      <div class="sidebar-footer">
        <div class="user-card">
          <img
            v-if="currentUser?.avatar && !avatarError"
            :src="currentUser.avatar"
            class="user-avatar"
            @error="avatarError = true"
          >
          <div
            v-else
            class="user-avatar-fallback"
          >
            {{ (currentUser?.name || '管').charAt(0) }}
          </div>
          <div class="user-info">
            <p class="user-name">{{ currentUser?.name || '管理员' }}</p>
            <p class="user-role">{{ currentUser?.role?.replace('_', ' ') || 'ADMIN' }}</p>
          </div>
          <button
            class="logout-button"
            title="退出登录"
            @click="$emit('logout')"
          >
            <LogOut :size="16" />
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
/**
 * 后台管理侧边栏组件
 */
import {
  LayoutDashboard,
  CalendarDays,
  Printer,
  Music2,
  BarChart3,
  Users,
  Key,
  Bell,
  Mail,
  LogOut,
  Clock,
  FileEdit,
  BookOpen,
  Ban,
  Globe,
  Database,
  Lock,
  Ticket
} from '@lucide/vue'
import logo from '~~/public/images/logo.png'

const avatarError = ref(false)

const props = defineProps({
  // 侧边栏是否打开（移动端）
  isOpen: Boolean,
  // 当前激活的标签页 ID
  activeTab: String,
  // 当前登录用户信息
  currentUser: Object,
  // 权限控制对象
  permissions: Object,
  // 站点标题
  siteTitle: String
})

watch(
  () => props.currentUser?.avatar,
  () => {
    avatarError.value = false
  }
)

const emit = defineEmits(['navigate', 'close', 'logout'])

// 菜单分组配置
const menuGroups = [
  {
    section: '概览',
    items: [{ icon: LayoutDashboard, label: '数据概览', id: 'overview' }]
  },
  {
    section: '内容管理',
    items: [
      { icon: CalendarDays, label: '排期管理', id: 'schedule' },
      { icon: Printer, label: '打印排期', id: 'print' },
      { icon: Music2, label: '歌曲管理', id: 'songs' },
      { icon: BarChart3, label: '数据分析', id: 'data-analysis', permissionId: 'data-analysis' }
    ]
  },
  {
    section: '用户管理',
    items: [{ icon: Users, label: '用户管理', id: 'users' }]
  },
  {
    section: 'API管理',
    items: [{ icon: Key, label: 'API密钥管理', id: 'api-keys' }]
  },
  {
    section: '系统管理',
    items: [
      { icon: Bell, label: '通知管理', id: 'notifications' },
      { icon: Mail, label: '邮件配置', id: 'smtp-config' },
      { icon: Clock, label: '播出时段', id: 'playtimes' },
      { icon: FileEdit, label: '投稿管理', id: 'request-times' },
      { icon: BookOpen, label: '学期管理', id: 'semesters' },
      { icon: Ban, label: '黑名单管理', id: 'blacklist' },
      { icon: Ticket, label: '点歌券管理', id: 'card-codes' },
      { icon: Globe, label: '站点配置', id: 'site-config' },
      { icon: Database, label: '数据库操作', id: 'database' }
    ]
  },
  {
    section: '账户管理',
    items: [{ icon: Lock, label: '修改密码', id: 'password' }]
  }
]

/**
 * 判断是否应该显示该菜单组
 * @param {Object} group 菜单组对象
 */
const shouldShowGroup = (group) => {
  if (!props.permissions) return true
  return group.items.some((item) => props.permissions.canAccessPage(item.permissionId || item.id))
}

/**
 * 导航点击处理
 * @param {string} id 菜单项 ID
 */
const onNavigate = (id) => {
  if (id === 'password') {
    navigateTo('/change-password')
    return
  }
  emit('navigate', id)
}

/**
 * 获取角色显示名称
 * @param {string} role 角色标识
 */
const getRoleDisplayName = (role) => {
  const roleNames = {
    USER: '普通用户',
    SONG_ADMIN: '歌曲管理员',
    ADMIN: '管理员',
    SUPER_ADMIN: '超级管理员'
  }
  return roleNames[role] || role
}
</script>

<style scoped>
.sidebar {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 50;
  width: 16rem;
  background-color: var(--components_Admin_Sidebar_bg, rgba(28, 28, 30, 0.95));
  border-right: 1px solid var(--components_Admin_Sidebar_border, #27272a);
  transform: translateX(-100%);
  transition: transform 0.3s ease-in-out;
}

@media (min-width: 1024px) {
  .sidebar {
    transform: translateX(0);
  }
}

.sidebar-open {
  transform: translateX(0);
}

.sidebar-closed {
  transform: translateX(-100%);
}

@media (min-width: 1024px) {
  .sidebar-closed {
    transform: translateX(0);
  }
}

.sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1rem;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  padding: 0 0.5rem;
  margin-bottom: 1.5rem;
  margin-top: 0.5rem;
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  text-decoration: none;
  transition: opacity 0.2s;
}

.brand-link:hover {
  opacity: 0.8;
}

.brand-logo {
  flex-shrink: 0;
  transition: transform 0.3s;
}

.brand-link:hover .brand-logo {
  transform: scale(1.1);
}

.logo-image {
  width: 2rem;
  height: 2rem;
  object-fit: contain;
}

.brand-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.brand-title {
  font-weight: 700;
  font-size: 1.125rem;
  color: var(--components_Admin_Sidebar_text-primary, #f4f4f5);
  line-height: 1;
  letter-spacing: -0.02em;
  margin: 0;
}

.brand-subtitle {
  font-size: 0.625rem;
  color: var(--components_Admin_Sidebar_text-secondary, #71717a);
  margin-top: 0.375rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  font-weight: 700;
  line-height: 1;
}

.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  overflow-y: auto;
  padding-right: 0.5rem;
}

.menu-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.group-title {
  padding: 0 0.75rem;
  font-size: 0.625rem;
  font-weight: 700;
  color: var(--components_Admin_Sidebar_text-tertiary, #52525b);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  margin-bottom: 0.5rem;
}

.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 700;
  transition: all 0.2s;
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
}

.menu-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--components_Admin_Sidebar_focus-ring, rgba(59, 130, 246, 0.8));
}

.menu-item-active {
  background-color: var(--components_Admin_Sidebar_menu-active-bg, rgba(37, 99, 235, 0.1));
  color: var(--components_Admin_Sidebar_menu-active-text, #60a5fa);
  border-color: var(--components_Admin_Sidebar_menu-active-border, rgba(59, 130, 246, 0.2));
}

.menu-item-inactive {
  color: var(--components_Admin_Sidebar_menu-inactive-text, #71717a);
  border-color: transparent;
}

.menu-item-inactive:hover {
  color: var(--components_Admin_Sidebar_menu-hover-text, #e4e4e7);
  background-color: var(--components_Admin_Sidebar_menu-hover-bg, rgba(52, 52, 59, 0.4));
}

.menu-icon {
  flex-shrink: 0;
}

.menu-icon-active {
  color: var(--components_Admin_Sidebar_menu-active-text, #60a5fa);
}

.menu-icon-inactive {
  color: var(--components_Admin_Sidebar_menu-inactive-text, #71717a);
}

.menu-item-inactive:hover .menu-icon-inactive {
  color: var(--components_Admin_Sidebar_menu-hover-text, #e4e4e7);
}

.menu-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-indicator {
  margin-left: auto;
  width: 0.25rem;
  height: 0.25rem;
  background-color: var(--components_Admin_Sidebar_menu-active-text, #60a5fa);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--components_Admin_Sidebar_menu-active-glow, rgba(96, 165, 250, 0.5));
}

.sidebar-footer {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--components_Admin_Sidebar_border, #27272a);
}

.user-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background-color: var(--components_Admin_Sidebar_user-card-bg, rgba(23, 23, 23, 0.5));
  border: 1px solid var(--components_Admin_Sidebar_user-card-border, rgba(39, 39, 42, 0.5));
  transition: background-color 0.2s;
}

.user-card:hover {
  background-color: var(--components_Admin_Sidebar_user-card-hover-bg, rgba(39, 39, 42, 0.3));
}

.user-avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  object-fit: cover;
  border: 1px solid var(--components_Admin_Sidebar_user-avatar-border, #3f3f46);
  flex-shrink: 0;
}

.user-avatar-fallback {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  background-color: var(--components_Admin_Sidebar_user-avatar-bg, #18181b);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--components_Admin_Sidebar_user-avatar-text, #71717a);
  font-weight: 700;
  border: 1px solid var(--components_Admin_Sidebar_user-avatar-border, #3f3f46);
  flex-shrink: 0;
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-size: 0.75rem;
  font-weight: 900;
  color: var(--components_Admin_Sidebar_text-primary, #f4f4f5);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: 0.625rem;
  color: var(--components_Admin_Sidebar_text-secondary, #71717a);
  margin: 0.125rem 0 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logout-button {
  padding: 0.5rem;
  color: var(--components_Admin_Sidebar_logout-text, #52525b);
  background: none;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
}

.logout-button:hover {
  color: var(--components_Admin_Sidebar_logout-hover-text, #f87171);
  background-color: var(--components_Admin_Sidebar_logout-hover-bg, rgba(248, 113, 113, 0.1));
}

/* 自定义滚动条样式 */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--components_Admin_Sidebar_252_0);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--components_Admin_Sidebar_256_0);
}
</style>
