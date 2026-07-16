<template>
  <div class="backup-manager">
    <!-- 标题 -->
    <div class="header">
      <h3>数据库备份</h3>
      <p class="description">导出和导入数据库备份</p>
    </div>

    <!-- 主要功能区 -->
    <div class="actions-grid">
      <div class="action-card">
        <div class="action-icon">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7,10 12,15 17,10" />
            <line x1="12" x2="12" y1="15" y2="3" />
          </svg>
        </div>
        <div class="card-content">
          <h4>导出备份</h4>
          <p>创建数据库备份文件</p>
          <button
            :disabled="createLoading"
            class="action-btn primary"
            @click="showCreateModal = true"
          >
            <span v-if="createLoading">导出中...</span>
            <span v-else>开始导出</span>
          </button>
        </div>
      </div>

      <div class="action-card">
        <div class="action-icon">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17,8 12,3 7,8" />
            <line x1="12" x2="12" y1="3" y2="15" />
          </svg>
        </div>
        <div class="card-content">
          <h4>导入备份</h4>
          <p>从备份文件恢复数据</p>
          <button
            :disabled="uploadLoading"
            class="action-btn secondary"
            @click="showUploadModal = true"
          >
            <span v-if="uploadLoading">导入中...</span>
            <span v-else>选择文件</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 创建备份模态框 -->
    <div v-if="showCreateModal" class="modal-overlay" @click="showCreateModal = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>创建数据库备份</h3>
          <button class="close-btn" @click="showCreateModal = false">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>备份类型</label>
            <div class="radio-group">
              <label class="radio-option">
                <input v-model="createForm.tables" type="radio" value="all" >
                <span>完整备份（推荐）</span>
                <small>备份所有数据表</small>
              </label>
              <label class="radio-option">
                <input v-model="createForm.tables" type="radio" value="users" >
                <span>仅用户数据</span>
                <small>只备份用户相关数据</small>
              </label>
            </div>
          </div>
          <div class="form-group">
            <label class="checkbox-option">
              <input v-model="createForm.includeSystemData" type="checkbox" >
              <span>包含系统设置</span>
              <small>包含系统配置和设置数据</small>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="action-btn secondary" @click="showCreateModal = false">取消</button>
          <button :disabled="createLoading" class="action-btn primary" @click="createBackup">
            <span v-if="createLoading">创建中...</span>
            <span v-else>创建备份</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 导入备份模态框 -->
    <div v-if="showUploadModal" class="modal-overlay" @click="showUploadModal = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>导入备份文件</h3>
          <button class="close-btn" @click="showUploadModal = false">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="upload-section">
            <div
              :class="{ 'drag-over': isDragOver }"
              class="upload-area"
              @click="$refs.fileInput.click()"
              @dragleave="isDragOver = false"
              @drop="handleDrop"
              @dragover.prevent="isDragOver = true"
            >
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17,8 12,3 7,8" />
                <line x1="12" x2="12" y1="3" y2="15" />
              </svg>
              <h4>选择或拖拽备份文件</h4>
              <p>支持 .json 格式的备份文件，最大 100MB</p>
              <input
                ref="fileInput"
                accept=".json,application/json"
                style="display: none"
                type="file"
                @change="handleFileSelect"
              >
            </div>

            <div v-if="selectedFile" class="selected-file">
              <div class="file-info">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
                <div class="file-details">
                  <span class="file-name">{{ selectedFile.name }}</span>
                  <span class="file-size">{{ formatFileSize(selectedFile.size) }}</span>
                </div>
              </div>
              <button
                class="remove-file-btn"
                @click="clearSelectedFile"
              >
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <line x1="18" x2="6" y1="6" y2="18" />
                  <line x1="6" x2="18" y1="6" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div class="form-group">
            <label>恢复模式</label>
            <div class="radio-group">
              <label class="radio-option">
                <input v-model="restoreForm.mode" type="radio" value="merge" >
                <span>合并模式（推荐）</span>
                <small>更新现有记录，添加新记录</small>
              </label>
              <label class="radio-option">
                <input v-model="restoreForm.mode" type="radio" value="replace" >
                <span>替换模式</span>
                <small>先清空数据，然后导入备份</small>
              </label>
            </div>
          </div>

          <div v-if="restoreForm.mode === 'replace'" class="form-group">
            <label class="checkbox-option danger">
              <input v-model="restoreForm.clearExisting" type="checkbox" >
              <span>我确认要清空现有数据</span>
              <small>此操作不可逆，请谨慎操作</small>
            </label>
          </div>

          <div
            v-if="restoreForm.mode === 'replace' && hasSuperAdminInBackup"
            class="form-group"
          >
            <label class="checkbox-option">
              <input v-model="restoreForm.overwriteSuperAdmin" type="checkbox" >
              <span>覆盖备份中的超级管理员账号数据</span>
              <small>关闭时将保留当前超级管理员及其第三方绑定、2FA相关数据</small>
            </label>
          </div>

          <div class="warning-box">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path
                d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
              />
              <line x1="12" x2="12" y1="9" y2="13" />
              <line x1="12" x2="12.01" y1="17" y2="17" />
            </svg>
            <div>
              <h4>注意</h4>
              <p>导入备份将会影响现有数据，请确保您了解操作的后果。</p>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="action-btn secondary" @click="showUploadModal = false">取消</button>
          <button
            :disabled="
              !selectedFile ||
              uploadLoading ||
              (restoreForm.mode === 'replace' && !restoreForm.clearExisting)
            "
            class="action-btn primary"
            @click="uploadFile"
          >
            <span v-if="uploadLoading">导入中...</span>
            <span v-else>开始导入</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useAuth } from '~/composables/useAuth'

// 响应式数据
const createLoading = ref(false)
const uploadLoading = ref(false)
const showCreateModal = ref(false)
const showUploadModal = ref(false)
const selectedFile = ref(null)
const isDragOver = ref(false)
const hasSuperAdminInBackup = ref(false)

// 表单数据
const createForm = ref({
  tables: 'all',
  includeSystemData: true
})

const getDefaultRestoreForm = () => ({
  mode: 'merge',
  clearExisting: false,
  overwriteSuperAdmin: false
})
const restoreForm = ref(getDefaultRestoreForm())

// 创建备份
const createBackup = async () => {
  createLoading.value = true
  try {
    const response = await $fetch('/api/admin/backup/export', {
      method: 'POST',
      body: {
        tables: createForm.value.tables,
        includeSystemData: createForm.value.includeSystemData
      }
    })

    console.log('服务器响应:', response)

    if (response.success && response.backup) {
      const { backup } = response

      // 强制进行浏览器下载
      let dataToDownload

      if (backup.downloadMode === 'direct' && backup.data) {
        // 直接下载模式：服务器返回了完整数据
        dataToDownload = backup.data
        console.log('使用直接下载模式')

        // 创建并下载文件
        try {
          const dataStr = JSON.stringify(dataToDownload, null, 2)
          const blob = new Blob([dataStr], {
            type: 'application/json;charset=utf-8'
          })

          // 创建下载链接
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = backup.filename
          link.style.display = 'none'

          // 添加到DOM，点击，然后移除
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)

          // 清理URL对象
          URL.revokeObjectURL(url)

          // 显示成功消息
          const sizeText = backup.size ? ` (${formatFileSize(backup.size)})` : ''
          if (window.$showNotification) {
            window.$showNotification(`备份文件已下载: ${backup.filename}${sizeText}`, 'success')
          }

          console.log('✅ 文件下载成功:', backup.filename)
        } catch (downloadError) {
          console.error('下载失败:', downloadError)
          if (window.$showNotification) {
            window.$showNotification('文件下载失败: ' + downloadError.message, 'error')
          }
        }
      } else if (backup.downloadMode === 'file' && backup.filename) {
        // 文件下载模式：通过API下载文件
        console.log('使用文件下载模式')

        try {
          // 使用 $fetch 进行认证请求，然后创建下载
          const response = await $fetch(
            `/api/admin/backup/download?filename=${encodeURIComponent(backup.filename)}`,
            {
              method: 'GET'
            }
          )

          // 创建 Blob 并下载
          const blob = new Blob([response], {
            type: 'application/json'
          })

          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = backup.filename
          link.style.display = 'none'

          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)

          URL.revokeObjectURL(url)

          // 显示成功消息
          const sizeText = backup.size ? ` (${formatFileSize(backup.size)})` : ''
          if (window.$showNotification) {
            window.$showNotification(`备份文件已下载: ${backup.filename}${sizeText}`, 'success')
          }

          console.log('✅ 文件下载成功:', backup.filename)
        } catch (downloadError) {
          console.error('文件下载失败:', downloadError)
          if (window.$showNotification) {
            window.$showNotification('文件下载失败: ' + downloadError.message, 'error')
          }
        }
      } else {
        console.error('无效的下载模式或缺少数据')
        if (window.$showNotification) {
          window.$showNotification('备份创建失败：无效的响应格式', 'error')
        }
        showCreateModal.value = false
        return
      }
    } else {
      console.error('服务器响应格式错误:', response)
      if (window.$showNotification) {
        window.$showNotification('备份创建失败：服务器响应格式错误', 'error')
      }
    }

    showCreateModal.value = false
  } catch (error) {
    console.error('创建备份失败:', error)
    const errorMessage = error.data?.message || error.message || '未知错误'
    if (window.$showNotification) {
      window.$showNotification('创建备份失败: ' + errorMessage, 'error')
    }
  } finally {
    createLoading.value = false
  }
}

// 文件选择处理
const parseBackupSuperAdmin = async (file) => {
  try {
    const text = await file.text()
    const backupData = JSON.parse(text)
    const users = Array.isArray(backupData?.data?.users) ? backupData.data.users : []
    hasSuperAdminInBackup.value = users.some((item) => item?.role === 'SUPER_ADMIN')
    if (!hasSuperAdminInBackup.value) {
      restoreForm.value.overwriteSuperAdmin = false
    }
  } catch (error) {
    hasSuperAdminInBackup.value = false
    restoreForm.value.overwriteSuperAdmin = false
    if (window.$showNotification) {
      window.$showNotification('无法解析备份文件，请检查文件格式是否正确。', 'error')
    }
    console.error('解析备份文件失败:', error)
  }
}

const clearSelectedFile = () => {
  selectedFile.value = null
  hasSuperAdminInBackup.value = false
  restoreForm.value.overwriteSuperAdmin = false
}

const handleFileSelect = async (event) => {
  const file = event.target.files[0]
  if (file) {
    selectedFile.value = file
    await parseBackupSuperAdmin(file)
  }
}

// 拖拽处理
const handleDrop = async (event) => {
  event.preventDefault()
  isDragOver.value = false

  const files = event.dataTransfer.files
  if (files.length > 0) {
    selectedFile.value = files[0]
    await parseBackupSuperAdmin(files[0])
  }
}

// 上传文件
const uploadFile = async () => {
  if (!selectedFile.value) return

  uploadLoading.value = true

  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    formData.append('mode', restoreForm.value.mode)
    formData.append('clearExisting', restoreForm.value.clearExisting)
    formData.append('overwriteSuperAdmin', restoreForm.value.overwriteSuperAdmin)

    const response = await $fetch('/api/admin/backup/restore', {
      method: 'POST',
      body: formData
    })

    if (response.success) {
      // 关闭模态框并重置表单
      showUploadModal.value = false
      clearSelectedFile()
      restoreForm.value = getDefaultRestoreForm()

      // 显示成功通知
      if (window.$showNotification) {
        window.$showNotification(
          `备份恢复成功！处理了 ${response.details?.tablesProcessed || 0} 个表，恢复了 ${response.details?.recordsRestored || 0} 条记录`,
          'success'
        )

        // 如果有错误，显示警告
        if (response.details?.errors && response.details.errors.length > 0) {
          setTimeout(() => {
            window.$showNotification(
              `恢复过程中发生了 ${response.details.errors.length} 个错误`,
              'warning'
            )
          }, 1000)
        }

        // 显示即将重定向的通知
        setTimeout(() => {
          window.$showNotification('数据库恢复完成，3秒后将返回首页重新登录', 'info')
        }, 2000)
      }

      // 清除认证状态并重定向到首页
      setTimeout(() => {
        const { logout } = useAuth()
        if (logout) {
          logout()
        }
        // 清除本地存储的认证信息
        localStorage.removeItem('auth-token')
        localStorage.removeItem('user-info')

        // 重定向到首页
        window.location.href = '/'
      }, 5000)
    } else {
      if (window.$showNotification) {
        window.$showNotification('备份导入失败: ' + (response.message || '未知错误'), 'error')
      }
    }
  } catch (error) {
    console.error('导入备份失败:', error)
    if (window.$showNotification) {
      window.$showNotification('导入备份失败: ' + (error.data?.message || error.message), 'error')
    }
  } finally {
    uploadLoading.value = false
  }
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
</script>

<style scoped>
/* 主容器 */
.backup-manager {
  min-height: 100vh;
  background: var(--components_Admin_BackupManager_523_0);
  color: var(--components_Admin_BackupManager_524_0);
  padding: 2rem;
  position: relative;
}

/* 头部区域 */
.header {
  text-align: center;
  margin-bottom: 3rem;
}

.header h3 {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--components_Admin_BackupManager_538_0);
  margin: 0 0 1rem 0;
}

.header .description {
  font-size: 1.125rem;
  color: var(--components_Admin_BackupManager_544_0);
  margin: 0;
}

/* 操作卡片网格 */
.actions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

/* 操作卡片 */
.action-card {
  background: var(--components_Admin_BackupManager_559_0);
  border: 1px solid var(--components_Admin_BackupManager_560_0);
  border-radius: 12px;
  padding: 2rem;
  text-align: center;
  transition: all 0.2s ease;
}

.action-card:hover {
  border-color: var(--components_Admin_BackupManager_568_0);
  background: var(--components_Admin_BackupManager_569_0);
}

.action-card .card-content {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 200px;
}

/* 图标样式 */
.action-icon {
  width: 4rem;
  height: 4rem;
  margin: 0 auto 1.5rem;
  background: var(--components_Admin_BackupManager_585_0);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--components_Admin_BackupManager_590_0);
}

.action-icon svg {
  width: 2rem;
  height: 2rem;
}

/* 卡片文本 */
.action-card h4 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--components_Admin_BackupManager_602_0);
  margin: 0 0 0.75rem 0;
}

.action-card p {
  color: var(--components_Admin_BackupManager_607_0);
  font-size: 1rem;
  margin: 0 0 2rem 0;
  line-height: 1.6;
  flex-grow: 1;
}

/* 按钮样式 */
.action-btn {
  width: 100%;
  padding: 1rem 1.5rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: block;
  text-align: center;
  color: white;
  box-sizing: border-box;
  margin-bottom: 0.5rem;
}

.action-btn.primary {
  background: var(--components_Admin_BackupManager_632_0);
}

.action-btn.primary:hover {
  background: var(--components_Admin_BackupManager_636_0);
}

.action-btn.secondary {
  background: var(--components_Admin_BackupManager_640_0);
}

.action-btn.secondary:hover {
  background: var(--components_Admin_BackupManager_644_0);
}

.action-btn:disabled {
  background: var(--components_Admin_BackupManager_648_0) !important;
  color: var(--components_Admin_BackupManager_649_0) !important;
  cursor: not-allowed;
  opacity: 0.6;
}

.action-btn svg {
  width: 1.125rem;
  height: 1.125rem;
}

/* 模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--components_Admin_BackupManager_666_0);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1.5rem;
}

.modal {
  background: var(--components_Admin_BackupManager_675_0);
  border: 1px solid var(--components_Admin_BackupManager_676_0);
  border-radius: 12px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
}

.progress-modal {
  max-width: 600px;
}

.progress-info {
  padding: 20px;
}

.current-status h4 {
  margin: 0 0 15px 0;
  color: var(--components_Admin_BackupManager_694_0);
  font-size: 18px;
}

.progress-stats p {
  margin: 5px 0;
  color: var(--components_Admin_BackupManager_700_0);
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: var(--components_Admin_BackupManager_706_0);
  border-radius: 4px;
  margin: 15px 0;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--components_Admin_BackupManager_714_0), var(--components_Admin_BackupManager_714_1));
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-details,
.progress-errors {
  margin-top: 20px;
}

.progress-details h5,
.progress-errors h5 {
  margin: 0 0 10px 0;
  color: var(--components_Admin_BackupManager_727_0);
  font-size: 14px;
  font-weight: 600;
}

.details-list,
.errors-list {
  max-height: 150px;
  overflow-y: auto;
  border: 1px solid var(--components_Admin_BackupManager_736_0);
  border-radius: 6px;
  padding: 10px;
  background: var(--components_Admin_BackupManager_739_0);
}

.detail-item {
  padding: 4px 0;
  color: var(--components_Admin_BackupManager_744_0);
  font-size: 13px;
  border-bottom: 1px solid var(--components_Admin_BackupManager_746_0);
}

.detail-item:last-child {
  border-bottom: none;
}

.error-item {
  padding: 4px 0;
  color: var(--components_Admin_BackupManager_755_0);
  font-size: 13px;
  border-bottom: 1px solid var(--components_Admin_BackupManager_757_0);
}

.error-item:last-child {
  border-bottom: none;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2rem 2rem 0 2rem;
  margin-bottom: 1.5rem;
}

.modal-title {
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--components_Admin_BackupManager_775_0);
  margin: 0;
}

.close-btn {
  background: var(--components_Admin_BackupManager_780_0);
  border: none;
  color: var(--components_Admin_BackupManager_782_0);
  cursor: pointer;
  padding: 0.75rem;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--components_Admin_BackupManager_790_0);
  color: var(--components_Admin_BackupManager_791_0);
}

.close-btn svg {
  width: 1.25rem;
  height: 1.25rem;
}

.modal-body {
  padding: 0 2rem 2rem 2rem;
}

.modal-footer {
  padding: 1.5rem 2rem;
  border-top: 1px solid var(--components_Admin_BackupManager_805_0);
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  background: var(--components_Admin_BackupManager_809_0);
}

.modal-footer button {
  min-width: 120px;
}

/* 表单样式 */
.form-group {
  margin-bottom: 2rem;
}

.form-group label {
  display: block;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--components_Admin_BackupManager_825_0);
  margin-bottom: 1rem;
}

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.radio-option,
.checkbox-option {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1.25rem;
  background: var(--components_Admin_BackupManager_841_0);
  border: 1px solid var(--components_Admin_BackupManager_842_0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.radio-option:hover,
.checkbox-option:hover {
  border-color: var(--components_Admin_BackupManager_850_0);
  background: var(--components_Admin_BackupManager_851_0);
}

.radio-option input[type='radio'],
.checkbox-option input[type='checkbox'] {
  width: 1.25rem;
  height: 1.25rem;
  margin: 0;
  accent-color: var(--components_Admin_BackupManager_859_0);
  cursor: pointer;
}

.radio-option > div,
.checkbox-option > div {
  flex: 1;
}

.radio-option span,
.checkbox-option span {
  display: block;
  font-size: 1rem;
  font-weight: 500;
  color: var(--components_Admin_BackupManager_873_0);
  margin-bottom: 0.25rem;
}

.radio-option small,
.checkbox-option small {
  display: block;
  font-size: 0.875rem;
  color: var(--components_Admin_BackupManager_881_0);
  line-height: 1.4;
}

.checkbox-option.danger {
  border-color: var(--components_Admin_BackupManager_886_0);
  background: var(--components_Admin_BackupManager_887_0);
}

.checkbox-option.danger span {
  color: var(--components_Admin_BackupManager_891_0);
}

.checkbox-option.danger small {
  color: var(--components_Admin_BackupManager_895_0);
}

/* 文件上传区域 */
.upload-section {
  margin-bottom: 2rem;
}

.upload-area {
  border: 2px dashed var(--components_Admin_BackupManager_904_0);
  border-radius: 8px;
  padding: 3rem 2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--components_Admin_BackupManager_910_0);
}

.upload-area:hover,
.upload-area.drag-over {
  border-color: var(--components_Admin_BackupManager_915_0);
  background: var(--components_Admin_BackupManager_916_0);
}

.upload-area svg {
  width: 4rem;
  height: 4rem;
  color: var(--components_Admin_BackupManager_922_0);
  margin-bottom: 1.5rem;
}

.upload-area h4 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--components_Admin_BackupManager_929_0);
  margin: 0 0 0.5rem 0;
}

.upload-area p {
  color: var(--components_Admin_BackupManager_934_0);
  font-size: 1rem;
  margin: 0;
}

.selected-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem;
  background: var(--components_Admin_BackupManager_944_0);
  border: 1px solid var(--components_Admin_BackupManager_945_0);
  border-radius: 8px;
  margin-top: 1rem;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
}

.file-info svg {
  width: 1.5rem;
  height: 1.5rem;
  color: var(--components_Admin_BackupManager_960_0);
  flex-shrink: 0;
}

.file-details {
  flex: 1;
}

.file-name {
  display: block;
  font-size: 1rem;
  font-weight: 500;
  color: var(--components_Admin_BackupManager_972_0);
  margin-bottom: 0.25rem;
}

.file-size {
  display: block;
  font-size: 0.875rem;
  color: var(--components_Admin_BackupManager_979_0);
}

.remove-file-btn {
  background: var(--components_Admin_BackupManager_983_0);
  border: none;
  padding: 0.75rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--components_Admin_BackupManager_989_0);
}

.remove-file-btn:hover {
  background: var(--components_Admin_BackupManager_993_0);
}

.remove-file-btn svg {
  width: 1rem;
  height: 1rem;
}

/* 警告框 */
.warning-box {
  background: var(--components_Admin_BackupManager_1003_0);
  border: 1px solid var(--components_Admin_BackupManager_1004_0);
  border-radius: 8px;
  padding: 1.5rem;
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 2rem;
}

.warning-box svg {
  width: 1.5rem;
  height: 1.5rem;
  color: var(--components_Admin_BackupManager_1016_0);
  flex-shrink: 0;
  margin-top: 0.125rem;
}

.warning-box > div {
  flex: 1;
}

.warning-box h4 {
  color: var(--components_Admin_BackupManager_1026_0);
  font-weight: 600;
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
}

.warning-box p {
  color: var(--components_Admin_BackupManager_1033_0);
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
}

/* 通知样式 */
.notification {
  position: fixed;
  top: 1.5rem;
  right: 1.5rem;
  padding: 1rem 1.5rem;
  border-radius: 8px;
  color: white;
  font-weight: 500;
  box-shadow: 0 4px 12px var(--components_Admin_BackupManager_1048_0);
  z-index: 1001;
  animation: slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 300px;
  max-width: 500px;
}

.notification.success {
  background: var(--components_Admin_BackupManager_1059_0);
  border: 1px solid var(--components_Admin_BackupManager_1060_0);
}

.notification.error {
  background: var(--components_Admin_BackupManager_1064_0);
  border: 1px solid var(--components_Admin_BackupManager_1065_0);
}

.notification.warning {
  background: var(--components_Admin_BackupManager_1069_0);
  border: 1px solid var(--components_Admin_BackupManager_1070_0);
}

.notification.info {
  background: var(--components_Admin_BackupManager_1074_0);
  border: 1px solid var(--components_Admin_BackupManager_1075_0);
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(100%) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes slideOutRight {
  from {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateX(100%) scale(0.9);
  }
}

/* 响应式设计 */
@media (max-width: 1024px) {
  .actions-grid {
    grid-template-columns: 1fr;
    max-width: 600px;
  }
}

@media (max-width: 768px) {
  .backup-manager {
    padding: 1.5rem;
  }

  .header h3 {
    font-size: 1.75rem;
  }

  .actions-grid {
    gap: 1.5rem;
    grid-template-columns: 1fr;
  }

  .action-card {
    padding: 2rem;
  }

  .action-card .card-content {
    width: 100%;
    display: flex;
    flex-direction: column;
    height: auto;
    min-height: 180px;
  }

  .action-card p {
    flex-grow: 1;
    margin-bottom: 1.5rem;
  }

  .action-btn {
    width: 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
    padding: 1rem 1.5rem !important;
    font-size: 1rem !important;
    display: block !important;
    text-align: center !important;
    border-radius: 8px !important;
    box-sizing: border-box !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 0.75rem !important;
  }

  .modal {
    margin: 1rem;
    max-height: calc(100vh - 2rem);
  }

  .notification {
    top: 1rem;
    right: 1rem;
    left: 1rem;
    max-width: none;
  }
}

@media (max-width: 480px) {
  .backup-manager {
    padding: 1rem;
  }

  .header {
    margin-bottom: 2rem;
  }

  .header h3 {
    font-size: 1.5rem;
  }

  .actions-grid {
    gap: 1rem;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .action-card {
    padding: 1.5rem;
    width: 100%;
    box-sizing: border-box;
  }

  .action-card .card-content {
    width: 100%;
    display: flex;
    flex-direction: column;
    height: auto;
    min-height: 160px;
  }

  .action-icon {
    width: 3rem;
    height: 3rem;
    margin-bottom: 1rem;
  }

  .action-icon svg {
    width: 1.5rem;
    height: 1.5rem;
  }

  .action-card h4 {
    font-size: 1.25rem;
    margin-bottom: 0.75rem;
  }

  .action-card p {
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
    flex-grow: 1;
  }

  .action-btn {
    width: 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
    padding: 1rem !important;
    font-size: 0.95rem !important;
    font-weight: 600 !important;
    display: block !important;
    text-align: center !important;
    border-radius: 8px !important;
    box-sizing: border-box !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
    margin-bottom: 0.75rem !important;
  }

  .action-btn span {
    display: inline-block;
    width: 100%;
  }

  .action-btn svg {
    display: none !important;
  }

  .modal {
    margin: 0.5rem;
    max-width: calc(100vw - 1rem);
    border-radius: 1rem;
  }

  .modal-header {
    padding: 1.25rem;
  }

  .modal-title {
    font-size: 1.25rem;
  }

  .modal-body {
    padding: 0 1.25rem 1.25rem;
  }

  .modal-footer {
    padding: 1rem 1.25rem;
    flex-direction: column;
    gap: 0.75rem;
  }

  .modal-footer .action-btn {
    width: 100% !important;
    order: 2;
  }

  .modal-footer .action-btn.primary {
    order: 1;
  }

  .form-group {
    margin-bottom: 1.5rem;
  }

  .form-group label {
    font-size: 1rem;
    margin-bottom: 0.75rem;
  }

  .radio-option,
  .checkbox-option {
    padding: 1rem;
    gap: 0.75rem;
  }

  .radio-option input[type='radio'],
  .checkbox-option input[type='checkbox'] {
    width: 1.125rem;
    height: 1.125rem;
  }

  .upload-area {
    padding: 1.5rem 1rem;
  }

  .upload-area svg {
    width: 2.5rem;
    height: 2.5rem;
    margin-bottom: 1rem;
  }

  .upload-area h4 {
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }

  .upload-area p {
    font-size: 0.85rem;
  }

  .selected-file {
    margin-top: 1rem;
  }

  .file-info {
    gap: 0.75rem;
  }

  .file-name {
    font-size: 0.875rem;
  }

  .file-size {
    font-size: 0.75rem;
  }

  .warning-box {
    padding: 1rem;
    gap: 0.75rem;
  }

  .warning-box h4 {
    font-size: 0.875rem;
  }

  .warning-box p {
    font-size: 0.8rem;
  }
}
</style>
