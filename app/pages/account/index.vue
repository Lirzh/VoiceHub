<template>
  <div class="account-page">
    <div class="top-nav">
      <div class="nav-container">
        <div class="nav-left">
          <button class="btn-back" @click="goBack">
            <ArrowLeft :size="20" />
          </button>
          <div class="nav-title">
            <h1 class="title-main">账号管理</h1>
            <p class="title-sub">Account Management</p>
          </div>
        </div>
      </div>
    </div>

    <div class="page-container">
      <div class="content-grid">
        <div class="left-section">
          <section class="user-card">
            <div class="avatar-wrapper">
              <div class="avatar">
                <img
                  v-if="auth.user.value?.avatar && !avatarError"
                  :src="auth.user.value.avatar"
                  class="avatar-image"
                  @error="avatarError = true"
                >
                <span v-else>{{ userInitials }}</span>
              </div>
              <div class="avatar-badge">
                <User :size="16" />
              </div>
            </div>

            <div class="user-info">
              <h2 class="user-name">{{ auth.user.value?.name || auth.user.value?.username }}</h2>
              <p class="user-username">@{{ auth.user.value?.username }}</p>
            </div>

            <div class="user-tags">
              <span class="tag role-tag">{{ roleName }}</span>
              <span v-if="auth.user.value?.grade" class="tag">{{ auth.user.value?.grade }}</span>
              <span v-if="auth.user.value?.class" class="tag">{{ auth.user.value?.class }}</span>
            </div>
          </section>
        </div>

        <div class="right-section">
          <section v-if="hasOAuthProviders" class="section-card">
            <div class="section-header">
              <div class="section-icon purple-icon">
                <LinkIcon :size="20" />
              </div>
              <div class="section-title">
                <h2>第三方账号绑定</h2>
                <p>绑定社交账号以便更快捷地登录系统</p>
              </div>
            </div>
            <AuthOAuthBindingCard />
          </section>

          <section class="section-card">
            <div class="section-header api-header">
              <div class="section-icon emerald-icon">
                <KeyRound :size="20" />
              </div>
              <div class="section-title">
                <h2>个人 API Key</h2>
                <p>用于个人集成和投稿</p>
              </div>
              <button
                class="btn-primary"
                :disabled="apiKeyLoading || apiKeyCreating"
                @click="createPersonalApiKey"
              >
                <RefreshCw v-if="apiKeyCreating" :size="14" class="icon-spin" />
                <Plus v-else :size="14" />
                创建 API Key
              </button>
            </div>

            <div v-if="apiKeyLoading" class="loading-state">
              <RefreshCw :size="16" class="icon-spin" />
              <span>正在加载 API Key...</span>
            </div>

            <div v-else-if="personalApiKeys.length === 0" class="empty-state">
              <KeyRound :size="28" class="empty-icon" />
              <p class="empty-title">还没有个人 API Key</p>
              <p class="empty-desc">创建后可用于个人侧的集成与投稿。</p>
            </div>

            <div v-else class="api-key-list">
              <div v-for="key in personalApiKeys" :key="key.id" class="api-key-card">
                <div class="api-key-header">
                  <div class="api-key-info">
                    <div class="api-key-name-row">
                      <h3 class="api-key-name">{{ key.name }}</h3>
                      <span :class="['status-tag', `status-${key.status}`]">
                        {{ getApiKeyStatusLabel(key.status) }}
                      </span>
                    </div>
                    <p class="api-key-desc">{{ key.description || '暂无描述' }}</p>
                  </div>
                  <button
                    class="btn-danger"
                    :disabled="apiKeyDeletingId === key.id"
                    @click="deletePersonalApiKey(key)"
                  >
                    <RefreshCw v-if="apiKeyDeletingId === key.id" :size="13" class="icon-spin" />
                    <Trash2 v-else :size="13" />
                    删除
                  </button>
                </div>

                <div class="api-key-details">
                  <div class="detail-item">
                    <p class="detail-label">Key 前缀</p>
                    <p class="detail-value prefix">{{ key.keyPrefix }}...</p>
                  </div>
                  <div class="detail-item">
                    <p class="detail-label">创建时间</p>
                    <p class="detail-value">{{ formatDate(key.createdAt) }}</p>
                  </div>
                  <div class="detail-item">
                    <p class="detail-label">最后使用</p>
                    <p class="detail-value">{{ key.lastUsedAt ? formatDate(key.lastUsedAt) : '从未使用' }}</p>
                  </div>
                  <div class="detail-item">
                    <p class="detail-label">调用次数</p>
                    <button class="btn-ghost" @click="openPersonalApiKeyLogs(key)">
                      {{ key.usageCount || 0 }}
                    </button>
                  </div>
                  <div class="detail-item">
                    <p class="detail-label">过期时间</p>
                    <p class="detail-value">{{ key.expiresAt ? formatDate(key.expiresAt) : '永不过期' }}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="section-card">
            <div class="section-header">
              <div class="section-icon blue-icon">
                <Lock :size="20" />
              </div>
              <div class="section-title">
                <h2>修改密码</h2>
                <p>为了您的账号安全，建议定期更换高强度密码</p>
              </div>
            </div>
            <div class="form-container">
              <AuthChangePasswordForm />
            </div>
          </section>

          <section class="section-card">
            <AuthTwoFactorSetup :initial-enabled="auth.user.value?.has2FA" />
          </section>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model:show="showDeleteConfirmDialog"
      type="danger"
      title="删除个人 API Key"
      :message="deleteConfirmMessage"
      confirm-text="删除"
      cancel-text="取消"
      :loading="apiKeyDeletingId !== null"
      @confirm="confirmDeletePersonalApiKey"
      @cancel="cancelDeletePersonalApiKey"
    />

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="createdApiKey" class="modal-overlay">
          <div class="modal-card api-created-modal">
            <div class="modal-header">
              <div class="modal-title">
                <h3>API Key 创建成功</h3>
                <p>完整 Key 只会显示这一次</p>
              </div>
              <button class="btn-close" @click="closeCreatedApiKey">
                <X :size="20" />
              </button>
            </div>

            <div class="modal-body">
              <div class="alert-warning">
                <AlertTriangle :size="18" />
                <p>请现在复制并保存。关闭窗口后，VoiceHub 不会再次显示完整 Key。</p>
              </div>

              <div class="api-key-display">
                <p class="display-label">完整 Key</p>
                <div class="display-row">
                  <div class="api-key-value">{{ createdApiKey.apiKey }}</div>
                  <button
                    class="btn-copy"
                    :class="{ copied: apiKeyCopied }"
                    @click="copyApiKey(createdApiKey.apiKey)"
                  >
                    <Check v-if="apiKeyCopied" :size="16" />
                    <Copy v-else :size="16" />
                  </button>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn-secondary" @click="closeCreatedApiKey">
                我已保存，关闭
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showApiKeyLogsModal" class="modal-overlay">
          <div class="modal-card logs-modal">
            <div class="modal-header">
              <div class="modal-title">
                <h3>调用记录</h3>
                <p>{{ selectedApiKeyForLogs?.name || '个人 API Key' }} · 共 {{ apiKeyLogsPagination.total }} 条</p>
              </div>
              <button class="btn-close" @click="closePersonalApiKeyLogs">
                <X :size="20" />
              </button>
            </div>

            <div class="modal-body">
              <div v-if="apiKeyLogsLoading" class="loading-state">
                <RefreshCw :size="16" class="icon-spin" />
                <span>正在加载调用记录...</span>
              </div>

              <div v-else-if="apiKeyLogs.length === 0" class="empty-state">
                <p class="empty-title">暂无调用记录</p>
                <p class="empty-desc">这个令牌还没有产生过 API 调用。</p>
              </div>

              <div v-else>
                <div class="logs-table-wrapper">
                  <table class="logs-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>方法</th>
                        <th>接口</th>
                        <th>状态</th>
                        <th>IP</th>
                        <th>耗时</th>
                        <th>错误</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="log in apiKeyLogs" :key="log.id">
                        <td>{{ formatDate(log.createdAt) }}</td>
                        <td>
                          <span :class="['method-tag', `method-${log.method}`]">{{ log.method }}</span>
                        </td>
                        <td>{{ log.endpoint }}</td>
                        <td :class="['status-code', getStatusClass(log.statusCode)]">{{ log.statusCode }}</td>
                        <td>{{ log.ipAddress }}</td>
                        <td>{{ log.responseTimeMs }} ms</td>
                        <td>{{ log.errorMessage || '无' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="pagination">
                  <p class="pagination-info">第 {{ apiKeyLogsPagination.page }} / {{ apiKeyLogsPagination.totalPages || 1 }} 页</p>
                  <div class="pagination-buttons">
                    <button
                      class="btn-pagination"
                      :disabled="apiKeyLogsPagination.page <= 1 || apiKeyLogsLoading"
                      @click="changePersonalApiKeyLogsPage(apiKeyLogsPagination.page - 1)"
                    >
                      上一页
                    </button>
                    <button
                      class="btn-pagination"
                      :disabled="apiKeyLogsPagination.page >= apiKeyLogsPagination.totalPages || apiKeyLogsLoading"
                      @click="changePersonalApiKeyLogsPage(apiKeyLogsPagination.page + 1)"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Link as LinkIcon,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  User,
  X
} from '@lucide/vue'
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const { showToast } = useToast()
const { oauthProviders, refreshSiteConfig } = useSiteConfig()

const hasOAuthProviders = computed(() => {
  return oauthProviders.value.length > 0
})

const avatarError = ref(false)
const personalApiKeys = ref([])
const apiKeyLoading = ref(false)
const apiKeyCreating = ref(false)
const apiKeyDeletingId = ref(null)
const createdApiKey = ref(null)
const apiKeyCopied = ref(false)
const showDeleteConfirmDialog = ref(false)
const pendingDeleteApiKey = ref(null)
const showApiKeyLogsModal = ref(false)
const selectedApiKeyForLogs = ref(null)
const apiKeyLogs = ref([])
const apiKeyLogsLoading = ref(false)
const apiKeyLogsPagination = ref({
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0
})

watch(
  () => auth.user.value?.avatar,
  () => {
    avatarError.value = false
  }
)

onMounted(() => {
  refreshSiteConfig()
  loadPersonalApiKeys()

  if (route.query.message) {
    showToast(route.query.message, 'success')
    router.replace({ query: { ...route.query, message: undefined, error: undefined } })
  }
  if (route.query.error) {
    showToast(route.query.error, 'error')
    router.replace({ query: { ...route.query, message: undefined, error: undefined } })
  }
})

const userInitials = computed(() => {
  const name = auth.user.value?.name || auth.user.value?.username || 'U'
  return name.charAt(0).toUpperCase()
})

const roleName = computed(() => {
  const role = auth.user.value?.role
  const map = {
    ADMIN: '管理员',
    SUPER_ADMIN: '超级管理员',
    SONG_ADMIN: '审歌员',
    USER: '普通用户'
  }
  return map[role] || role
})

const goBack = () => {
  navigateTo('/')
}

const loadPersonalApiKeys = async () => {
  apiKeyLoading.value = true
  try {
    const response = await $fetch('/api/user/api-keys')
    if (response.success) {
      personalApiKeys.value = response.data || []
    }
  } catch (error) {
    console.error('加载个人 API Key 失败:', error)
    showToast(error.data?.message || '加载个人 API Key 失败', 'error')
  } finally {
    apiKeyLoading.value = false
  }
}

const createPersonalApiKey = async () => {
  apiKeyCreating.value = true
  try {
    const response = await $fetch('/api/user/api-keys', {
      method: 'POST',
      body: {
        name: '个人 API Key',
        description: '用于个人集成和投稿'
      }
    })

    if (response.success) {
      createdApiKey.value = response.data
      showToast('个人 API Key 创建成功', 'success')
      await loadPersonalApiKeys()
    }
  } catch (error) {
    console.error('创建个人 API Key 失败:', error)
    showToast(error.data?.message || '创建个人 API Key 失败', 'error')
  } finally {
    apiKeyCreating.value = false
  }
}

const deletePersonalApiKey = async (key) => {
  pendingDeleteApiKey.value = key
  showDeleteConfirmDialog.value = true
}

const confirmDeletePersonalApiKey = async () => {
  const key = pendingDeleteApiKey.value
  if (!key) {
    showDeleteConfirmDialog.value = false
    return
  }

  apiKeyDeletingId.value = key.id
  try {
    const response = await $fetch(`/api/user/api-keys/${key.id}`, {
      method: 'DELETE'
    })

    if (response.success) {
      showToast('个人 API Key 已删除', 'success')
      await loadPersonalApiKeys()
    }
  } catch (error) {
    console.error('删除个人 API Key 失败:', error)
    showToast(error.data?.message || '删除个人 API Key 失败', 'error')
  } finally {
    apiKeyDeletingId.value = null
    showDeleteConfirmDialog.value = false
    pendingDeleteApiKey.value = null
  }
}

const cancelDeletePersonalApiKey = () => {
  showDeleteConfirmDialog.value = false
  pendingDeleteApiKey.value = null
}

const deleteConfirmMessage = computed(() => {
  const key = pendingDeleteApiKey.value
  if (!key) {
    return '确定要删除这个个人 API Key 吗？删除后相关集成将无法继续使用。'
  }
  return `确定要删除个人 API Key "${key.name}"吗？删除后相关集成将无法继续使用。`
})

const copyApiKey = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    apiKeyCopied.value = true
    showToast('已复制到剪贴板', 'success')
    setTimeout(() => {
      apiKeyCopied.value = false
    }, 2000)
  } catch (error) {
    console.error('复制 API Key 失败:', error)
    showToast('复制失败，请手动选择 Key 复制', 'error')
  }
}

const closeCreatedApiKey = () => {
  createdApiKey.value = null
  apiKeyCopied.value = false
}

const openPersonalApiKeyLogs = async (key) => {
  if (!key) {
    return
  }

  selectedApiKeyForLogs.value = key
  showApiKeyLogsModal.value = true
  apiKeyLogsPagination.value = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  }
  await loadPersonalApiKeyLogs(1)
}

const loadPersonalApiKeyLogs = async (page = 1) => {
  const key = selectedApiKeyForLogs.value
  if (!key) return

  apiKeyLogsLoading.value = true
  try {
    const response = await $fetch(`/api/user/api-keys/${key.id}/logs`, {
      query: {
        page,
        limit: apiKeyLogsPagination.value.limit
      }
    })

    if (response.success) {
      apiKeyLogs.value = response.data?.logs || []
      apiKeyLogsPagination.value = response.data?.pagination || {
        page,
        limit: apiKeyLogsPagination.value.limit,
        total: 0,
        totalPages: 0
      }
    }
  } catch (error) {
    console.error('加载个人 API Key 调用记录失败:', error)
    showToast(error.data?.message || '加载调用记录失败', 'error')
    apiKeyLogs.value = []
  } finally {
    apiKeyLogsLoading.value = false
  }
}

const changePersonalApiKeyLogsPage = async (page) => {
  if (page < 1) return
  if (apiKeyLogsPagination.value.totalPages > 0 && page > apiKeyLogsPagination.value.totalPages) return
  await loadPersonalApiKeyLogs(page)
}

const closePersonalApiKeyLogs = () => {
  showApiKeyLogsModal.value = false
  selectedApiKeyForLogs.value = null
  apiKeyLogs.value = []
  apiKeyLogsLoading.value = false
}

const formatDate = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getApiKeyStatusLabel = (status) => {
  const map = {
    active: '可用',
    inactive: '停用',
    expired: '已过期'
  }
  return map[status] || status
}

const getStatusClass = (statusCode) => {
  if (statusCode >= 200 && statusCode < 300) return 'status-success'
  if (statusCode >= 300 && statusCode < 400) return 'status-warning'
  return 'status-error'
}
</script>

<style scoped>
.account-page {
  min-height: 100vh;
  background-color: var(--pages_account_index_bg-page);
  color: var(--pages_account_index_text-secondary);
  padding-bottom: 6rem;
}

.top-nav {
  position: sticky;
  top: 0;
  z-index: 30;
  background-color: var(--pages_account_index_bg-nav);
  backdrop-filter: blur(24px);
  padding: 1rem;
  margin-bottom: 2rem;
}

.dark .top-nav {
  background-color: var(--pages_account_index_bg-nav);
}

.nav-container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.btn-back {
  padding: 0.5rem;
  border: 1px solid var(--pages_account_index_border-button-ghost);
  background-color: var(--pages_account_index_bg-button-ghost);
  color: var(--pages_account_index_text-button-ghost);
  border-radius: 0.75rem;
  transition: all 0.2s;
  cursor: pointer;
}

.btn-back:hover {
  background-color: var(--pages_account_index_bg-button-ghost-hover);
  color: var(--pages_account_index_text-primary);
}

.nav-title {
  display: flex;
  flex-direction: column;
}

.title-main {
  font-size: 1.25rem;
  font-weight: 900;
  color: var(--pages_account_index_text-primary);
  letter-spacing: -0.02em;
  margin: 0;
}

.title-sub {
  font-size: 0.625rem;
  color: var(--pages_account_index_text-quaternary);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  margin: 0.125rem 0 0 0;
}

.page-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
}

@media (min-width: 1024px) {
  .content-grid {
    grid-template-columns: repeat(12, 1fr);
  }

  .left-section {
    grid-column: span 4;
  }

  .right-section {
    grid-column: span 8;
  }
}

.left-section {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.right-section {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.user-card {
  background-color: var(--pages_account_index_bg-user-card, rgba(28, 28, 30, 0.6));
  border-radius: 1.5rem;
  padding: 1.5rem;
  box-shadow: var(--pages_account_index_shadow-card, 0 25px 50px -12px rgba(0, 0, 0, 0.5));
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.dark .user-card {
  background-color: var(--pages_account_index_bg-user-card, rgba(28, 28, 30, 0.6));
}

.avatar-wrapper {
  position: relative;
}

.avatar {
  width: 8rem;
  height: 8rem;
  border-radius: 50%;
  overflow: hidden;
  background: var(--pages_account_index_bg-avatar, linear-gradient(135deg, #3b82f6, #6366f1));
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 3rem;
  font-weight: 900;
  box-shadow: var(--pages_account_index_shadow-avatar, 0 25px 50px -12px rgba(59, 130, 246, 0.3));
  margin-bottom: 1.5rem;
  transition: transform 0.5s;
}

.avatar-wrapper:hover .avatar {
  transform: scale(1.05);
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-badge {
  position: absolute;
  bottom: -0.25rem;
  right: -0.25rem;
  padding: 0.5rem;
  background-color: var(--pages_account_index_bg-section);
  border-radius: 50%;
  color: var(--pages_account_index_text-icon-blue, #60a5fa);
  box-shadow: var(--pages_account_index_shadow-badge, 0 10px 15px -3px rgba(0, 0, 0, 0.3));
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.user-name {
  font-size: 1.5rem;
  font-weight: 900;
  color: var(--pages_account_index_text-primary);
  letter-spacing: -0.02em;
  margin: 0;
}

.user-username {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pages_account_index_text-quaternary);
  margin: 0;
}

.user-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.tag {
  padding: 0.25rem 0.75rem;
  background-color: var(--pages_account_index_bg-tag);
  color: var(--pages_account_index_text-tertiary);
  font-size: 0.625rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border-radius: 9999px;
}

.role-tag {
  background-color: var(--pages_account_index_bg-icon-blue, rgba(59, 130, 246, 0.1));
  color: var(--pages_account_index_text-icon-blue, #60a5fa);
}

.section-card {
  background-color: var(--pages_account_index_bg-section-card, rgba(28, 28, 30, 0.6));
  border-radius: 1.5rem;
  padding: 1.5rem;
  box-shadow: var(--pages_account_index_shadow-card, 0 25px 50px -12px rgba(0, 0, 0, 0.5));
}

.dark .section-card {
  background-color: var(--pages_account_index_bg-section-card, rgba(28, 28, 30, 0.6));
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-bottom: 1.25rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--pages_account_index_border-primary);
}

.api-header {
  flex-wrap: wrap;
  justify-content: space-between;
}

.section-icon {
  padding: 0.625rem;
  border-radius: 0.75rem;
}

.purple-icon {
  background-color: var(--pages_account_index_bg-icon-purple, rgba(168, 85, 247, 0.1));
  color: var(--pages_account_index_text-icon-purple, #c084fc);
}

.emerald-icon {
  background-color: var(--pages_account_index_bg-icon-emerald, rgba(16, 185, 129, 0.1));
  color: var(--pages_account_index_text-icon-emerald, #34d399);
}

.blue-icon {
  background-color: var(--pages_account_index_bg-icon-blue, rgba(59, 130, 246, 0.1));
  color: var(--pages_account_index_text-icon-blue, #60a5fa);
}

.section-title {
  display: flex;
  flex-direction: column;
}

.section-title h2 {
  font-size: 1rem;
  font-weight: 900;
  color: var(--pages_account_index_text-primary);
  margin: 0;
}

.section-title p {
  font-size: 0.75rem;
  color: var(--pages_account_index_text-quaternary);
  margin: 0.125rem 0 0 0;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: var(--pages_account_index_bg-button-primary, #10b981);
  color: var(--pages_account_index_text-button-primary, #ffffff);
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: 0.75rem;
  transition: all 0.2s;
  border: none;
  cursor: pointer;
}

.btn-primary:hover {
  background-color: var(--pages_account_index_bg-button-primary-hover, #059669);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  font-size: 0.75rem;
  color: var(--pages_account_index_text-quaternary);
  text-align: center;
}

.empty-state {
  border-radius: 1rem;
  background-color: var(--pages_account_index_bg-dashed);
  padding: 1.25rem 1.5rem;
  text-align: center;
}

.empty-icon {
  margin: 0 auto 0.75rem;
  color: var(--pages_account_index_text-icon);
}

.empty-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--pages_account_index_text-secondary);
  margin: 0;
}

.empty-desc {
  font-size: 0.75rem;
  color: var(--pages_account_index_text-disabled);
  margin: 0.5rem 0 0 0;
  line-height: 1.6;
}

.api-key-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.api-key-card {
  border-radius: 1rem;
  border: 1px solid var(--pages_account_index_border-api-key, rgba(229, 231, 235, 0.7));
  background-color: var(--pages_account_index_bg-dashed);
  padding: 1rem;
}

.dark .api-key-card {
  border-color: var(--pages_account_index_border-api-key-dark, rgba(44, 44, 46, 0.7));
}

.api-key-header {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

@media (min-width: 768px) {
  .api-key-header {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
  }
}

.api-key-info {
  min-width: 0;
}

.api-key-name-row {
  display: flex;
  flex-wrap: items;
  gap: 0.5rem;
  align-items: center;
}

.api-key-name {
  font-size: 0.875rem;
  font-weight: 900;
  color: var(--pages_account_index_text-primary);
  margin: 0;
}

.status-tag {
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.625rem;
  font-weight: 900;
  border: 1px solid;
}

.status-active {
  background-color: var(--pages_account_index_bg-icon-emerald, rgba(16, 185, 129, 0.1));
  color: var(--pages_account_index_text-icon-emerald, #34d399);
  border-color: var(--pages_account_index_border-icon-emerald, rgba(16, 185, 129, 0.2));
}

.status-inactive {
  background-color: var(--pages_account_index_bg-card);
  color: var(--pages_account_index_text-quaternary);
  border-color: var(--pages_account_index_border-tag-status);
}

.status-expired {
  background-color: var(--pages_account_index_bg-button-danger, rgba(239, 68, 68, 0.1));
  color: var(--pages_account_index_text-button-danger, #f87171);
  border-color: var(--pages_account_index_border-button-danger, rgba(239, 68, 68, 0.2));
}

.api-key-desc {
  font-size: 0.75rem;
  color: var(--pages_account_index_text-quaternary);
  margin: 0.25rem 0 0 0;
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--pages_account_index_border-button-danger, rgba(239, 68, 68, 0.2));
  background-color: var(--pages_account_index_bg-button-danger, rgba(239, 68, 68, 0.1));
  color: var(--pages_account_index_text-button-danger, #f87171);
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: 0.75rem;
  transition: all 0.2s;
  cursor: pointer;
}

.btn-danger:hover {
  background-color: var(--pages_account_index_bg-button-danger-hover, rgba(239, 68, 68, 0.15));
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.api-key-details {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-top: 1.25rem;
}

@media (min-width: 768px) {
  .api-key-details {
    grid-template-columns: repeat(5, 1fr);
  }
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.detail-label {
  font-size: 0.625rem;
  font-weight: 900;
  color: var(--pages_account_index_text-disabled);
  text-transform: uppercase;
  letter-spacing: 0.25em;
  margin: 0;
}

.detail-value {
  font-size: 0.75rem;
  color: var(--pages_account_index_text-tertiary);
  margin: 0;
}

.detail-value.prefix {
  font-family: monospace;
  color: var(--pages_account_index_text-code, #60a5fa);
}

.btn-ghost {
  font-size: 0.75rem;
  font-weight: 700;
  border: 1px solid var(--pages_account_index_border-button-ghost);
  background-color: var(--pages_account_index_bg-button-ghost);
  color: var(--pages_account_index_text-button-ghost);
  border-radius: 0.5rem;
  padding: 0.25rem 0.5rem;
  transition: all 0.2s;
  cursor: pointer;
}

.btn-ghost:hover {
  background-color: var(--pages_account_index_bg-button-ghost-hover);
}

.btn-ghost:disabled {
  opacity: 0.6;
  cursor: default;
}

.form-container {
  max-width: 25rem;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background-color: var(--pages_account_index_bg-modal-overlay, rgba(0, 0, 0, 0.7));
  backdrop-filter: blur(4px);
}

.modal-card {
  width: 100%;
  background-color: var(--pages_account_index_bg-section);
  border-radius: 1.5rem;
  box-shadow: var(--pages_account_index_shadow-modal, 0 25px 50px -12px rgba(0, 0, 0, 0.5));
  overflow: hidden;
}

.api-created-modal {
  max-width: 36rem;
}

.logs-modal {
  max-width: 56rem;
}

.modal-header {
  padding: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  display: flex;
  flex-direction: column;
}

.modal-title h3 {
  font-size: 1.125rem;
  font-weight: 900;
  color: var(--pages_account_index_text-primary);
  margin: 0;
}

.modal-title p {
  font-size: 0.75rem;
  color: var(--pages_account_index_text-quaternary);
  margin: 0.25rem 0 0 0;
}

.btn-close {
  padding: 0.5rem;
  border: 1px solid var(--pages_account_index_border-button-ghost);
  background-color: var(--pages_account_index_bg-button-ghost);
  color: var(--pages_account_index_text-button-ghost);
  border-radius: 0.75rem;
  transition: all 0.2s;
  cursor: pointer;
}

.btn-close:hover {
  background-color: var(--pages_account_index_bg-button-ghost-hover);
}

.modal-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.alert-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  border-radius: 1rem;
  border: 1px solid var(--pages_account_index_border-warning, rgba(245, 158, 11, 0.2));
  background-color: var(--pages_account_index_bg-warning, rgba(245, 158, 11, 0.1));
  padding: 1rem;
  color: var(--pages_account_index_text-warning, #fbbf24);
}

.alert-warning svg {
  flex-shrink: 0;
  margin-top: 0.125rem;
}

.alert-warning p {
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.6;
  margin: 0;
}

.api-key-display {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.display-label {
  font-size: 0.625rem;
  font-weight: 900;
  color: var(--pages_account_index_text-disabled);
  text-transform: uppercase;
  letter-spacing: 0.25em;
  margin: 0;
}

.display-row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.api-key-value {
  flex: 1;
  min-width: 0;
  border-radius: 0.75rem;
  border: 1px solid var(--pages_account_index_border-primary);
  background-color: var(--pages_account_index_bg-page);
  padding: 0.75rem 1rem;
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--pages_account_index_text-code, #60a5fa);
  word-break: break-all;
  user-select: all;
}

.btn-copy {
  width: 3rem;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--pages_account_index_border-button-ghost);
  background-color: var(--pages_account_index_bg-button-ghost);
  color: var(--pages_account_index_text-button-ghost);
  transition: all 0.2s;
  cursor: pointer;
}

.btn-copy:hover {
  background-color: var(--pages_account_index_bg-button-ghost-hover);
}

.btn-copy.copied {
  background-color: var(--pages_account_index_bg-button-success, #10b981);
  color: white;
  border-color: var(--pages_account_index_bg-button-success, #10b981);
}

.modal-footer {
  padding: 1.5rem;
}

.btn-secondary {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--pages_account_index_border-button-secondary);
  background-color: var(--pages_account_index_bg-button-secondary);
  color: var(--pages_account_index_text-button-secondary);
  font-size: 0.75rem;
  font-weight: 900;
  border-radius: 0.75rem;
  transition: all 0.2s;
  cursor: pointer;
}

.btn-secondary:hover {
  border-color: var(--pages_account_index_border-button-hover);
  background-color: var(--pages_account_index_bg-button-secondary-hover);
}

.logs-table-wrapper {
  overflow: hidden;
  border-radius: 1rem;
  border: 1px solid var(--pages_account_index_border-primary);
}

.logs-table {
  min-width: 100%;
  text-align: left;
}

.logs-table thead {
  position: sticky;
  top: 0;
  background-color: var(--pages_account_index_bg-table-header);
  backdrop-filter: blur(4px);
}

.logs-table th {
  padding: 0.75rem 1rem;
  font-size: 0.625rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  color: var(--pages_account_index_text-quaternary);
}

.logs-table td {
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
}

.logs-table tbody tr:last-child {
  border-bottom: none;
}

.logs-table tbody tr {
  border-bottom: 1px solid var(--pages_account_index_border-row);
}

.logs-table td:first-child {
  color: var(--pages_account_index_text-tertiary);
  white-space: nowrap;
}

.logs-table td:nth-child(2) {
  padding-right: 0.5rem;
}

.logs-table td:nth-child(3) {
  color: var(--pages_account_index_text-secondary);
  word-break: break-all;
}

.logs-table td:nth-child(4) {
  font-weight: 700;
}

.logs-table td:nth-child(5),
.logs-table td:nth-child(6) {
  color: var(--pages_account_index_text-tertiary);
  white-space: nowrap;
}

.logs-table td:nth-child(7) {
  color: var(--pages_account_index_text-quaternary);
  word-break: break-all;
}

.method-tag {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.625rem;
  font-weight: 900;
  border: 1px solid;
}

.method-GET {
  background-color: var(--pages_account_index_bg-icon-emerald, rgba(16, 185, 129, 0.1));
  color: var(--pages_account_index_text-icon-emerald, #34d399);
  border-color: var(--pages_account_index_border-icon-emerald, rgba(16, 185, 129, 0.2));
}

.method-POST {
  background-color: var(--pages_account_index_bg-icon-blue, rgba(59, 130, 246, 0.1));
  color: var(--pages_account_index_text-icon-blue, #60a5fa);
  border-color: var(--pages_account_index_border-icon-blue, rgba(59, 130, 246, 0.2));
}

.method-PUT {
  background-color: var(--pages_account_index_bg-warning, rgba(245, 158, 11, 0.1));
  color: var(--pages_account_index_text-warning, #fbbf24);
  border-color: var(--pages_account_index_border-warning, rgba(245, 158, 11, 0.2));
}

.method-DELETE {
  background-color: var(--pages_account_index_bg-button-danger, rgba(239, 68, 68, 0.1));
  color: var(--pages_account_index_text-button-danger, #f87171);
  border-color: var(--pages_account_index_border-button-danger, rgba(239, 68, 68, 0.2));
}

.status-code.status-success {
  color: var(--pages_account_index_text-icon-emerald, #34d399);
}

.status-code.status-warning {
  color: var(--pages_account_index_text-warning, #fbbf24);
}

.status-code.status-error {
  color: var(--pages_account_index_text-button-danger, #f87171);
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 1rem;
}

.pagination-info {
  font-size: 0.75rem;
  color: var(--pages_account_index_text-quaternary);
  margin: 0;
}

.pagination-buttons {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-pagination {
  padding: 0.5rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--pages_account_index_border-button-secondary);
  background-color: var(--pages_account_index_bg-button-secondary);
  color: var(--pages_account_index_text-button-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  transition: all 0.2s;
  cursor: pointer;
}

.btn-pagination:hover:not(:disabled) {
  border-color: var(--pages_account_index_border-button-hover);
  background-color: var(--pages_account_index_bg-button-secondary-hover);
}

.btn-pagination:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-card,
.modal-leave-to .modal-card {
  transform: scale(0.95);
}
</style>