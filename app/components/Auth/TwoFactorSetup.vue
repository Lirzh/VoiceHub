<template>
  <div class="twofactor-container">
    <!-- 状态显示 -->
    <div class="status-card">
      <div class="status-header">
        <div class="status-icon" :class="isEnabled ? 'icon-enabled' : 'icon-disabled'">
          <ShieldCheck :size="20" />
        </div>
        <div class="status-info">
          <h3 class="status-title">双重认证 (2FA)</h3>
          <p class="status-desc">
            {{ isEnabled ? '您的账户已开启双重认证保护' : '未开启，建议开启以提升账户安全性' }}
          </p>
        </div>
      </div>
      
      <button
        v-if="!isEnabled"
        @click="startSetup"
        class="btn-primary"
      >
        开启
      </button>
      <button
        v-else
        @click="confirmDisable"
        class="btn-danger"
      >
        关闭
      </button>
    </div>

    <!-- 开启流程 -->
    <div v-if="showSetup" class="setup-card">
      <div class="setup-header">
        <div>
          <h4 class="setup-title">设置双重认证</h4>
          <p class="setup-desc">请使用 Google Authenticator 或其他验证器应用扫描下方二维码</p>
        </div>
        <button @click="cancelSetup" class="btn-close">
          <X :size="20" />
        </button>
      </div>

      <div class="setup-content">
        <!-- 二维码区域 -->
        <div class="qr-wrapper">
          <div class="qr-bg">
            <img v-if="qrCodeUrl" :src="qrCodeUrl" alt="2FA QR Code" class="qr-image" />
            <div v-else class="qr-placeholder">
              <Loader2 class="icon-spin" />
            </div>
          </div>
        </div>

        <!-- 验证输入区域 -->
        <div class="input-section">
          <div class="input-group">
            <label class="input-label">手动输入密钥</label>
            <div class="input-row">
              <code class="code-display">
                {{ secret }}
              </code>
              <button 
                @click="copySecret"
                class="btn-icon"
                title="复制密钥"
              >
                <Copy :size="16" />
              </button>
            </div>
          </div>

          <div class="input-group">
            <label class="input-label">验证码</label>
            <div class="verify-row">
              <input
                v-model="verificationCode"
                type="text"
                placeholder="请输入6位验证码"
                maxlength="6"
                class="verify-input"
                @keyup.enter="enable2FA"
              />
              <button
                @click="enable2FA"
                :disabled="loading || verificationCode.length !== 6"
                class="btn-submit"
              >
                <Loader2 v-if="loading" class="icon-spin" :size="16" />
                <span>验证并开启</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <UIConfirmDialog
      :show="showDisableConfirm"
      title="关闭双重认证"
      message="关闭后，您的账户将不再受到双重认证保护。为确保安全，请输入您的登录密码以确认。"
      confirm-text="验证并关闭"
      type="danger"
      :show-input="true"
      input-placeholder="请输入当前登录密码"
      input-type="password"
      @confirm="disable2FA"
      @cancel="showDisableConfirm = false"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ShieldCheck, X, Copy, Loader2 } from '@lucide/vue'
import { useToast } from '~/composables/useToast'

const props = defineProps({
  initialEnabled: {
    type: Boolean,
    default: false
  }
})

const isEnabled = ref(props.initialEnabled || false)
const showSetup = ref(false)
const showDisableConfirm = ref(false)
const loading = ref(false)
const qrCodeUrl = ref('')
const secret = ref('')
const verificationCode = ref('')
const { showToast } = useToast()

const startSetup = async () => {
  try {
    loading.value = true
    const data = await $fetch('/api/user/2fa/generate', {
      method: 'POST'
    })

    if (data) {
      qrCodeUrl.value = data.qrCode
      secret.value = data.secret
      showSetup.value = true
      verificationCode.value = ''
    }
  } catch (err) {
    showToast(err.data?.message || err.message || '获取验证码失败', 'error')
  } finally {
    loading.value = false
  }
}

const cancelSetup = () => {
  showSetup.value = false
  qrCodeUrl.value = ''
  secret.value = ''
  verificationCode.value = ''
}

const copySecret = async () => {
  try {
    await navigator.clipboard.writeText(secret.value)
    showToast('密钥已复制', 'success')
  } catch (err) {
    showToast('复制失败', 'error')
  }
}

const enable2FA = async () => {
  if (verificationCode.value.length !== 6) return
  
  try {
    loading.value = true
    const { error } = await useFetch('/api/user/2fa/enable', {
      method: 'POST',
      body: {
        token: verificationCode.value,
        secret: secret.value
      }
    })

    if (error.value) throw error.value

    showToast('双重认证已开启', 'success')
    isEnabled.value = true
    cancelSetup()
  } catch (err) {
    showToast(err.data?.message || err.message || '验证失败', 'error')
  } finally {
    loading.value = false
  }
}

const confirmDisable = () => {
  showDisableConfirm.value = true
}

const disable2FA = async (password) => {
  if (!password) {
    showToast('请输入密码', 'warning')
    return
  }
  
  try {
    loading.value = true
    const { error } = await useFetch('/api/user/2fa/disable', {
      method: 'POST',
      body: { password }
    })

    if (error.value) throw error.value

    showToast('双重认证已关闭', 'success')
    isEnabled.value = false
    showDisableConfirm.value = false
  } catch (err) {
    showToast(err.data?.message || err.message || '关闭失败', 'error')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.twofactor-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* 状态卡片 */
.status-card {
  background-color: var(--components_Auth_TwoFactorSetup_bg-card, rgba(17, 17, 17, 0.5));
  border: 1px solid var(--components_Auth_TwoFactorSetup_border, #27272a);
  border-radius: 1rem;
  padding: 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.status-icon {
  padding: 0.5rem;
  border-radius: 0.5rem;
}

.icon-enabled {
  background-color: var(--components_Auth_TwoFactorSetup_bg-status-enabled, rgba(16, 185, 129, 0.1));
  color: var(--components_Auth_TwoFactorSetup_text-status-enabled, #4ade80);
}

.icon-disabled {
  background-color: var(--components_Auth_TwoFactorSetup_bg-status-disabled, #27272a);
  color: var(--components_Auth_TwoFactorSetup_text-status-disabled, #71717a);
}

.status-info {
  display: flex;
  flex-direction: column;
}

.status-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--components_Auth_TwoFactorSetup_text-primary, #f4f4f5);
  margin: 0;
}

.status-desc {
  font-size: 0.75rem;
  color: var(--components_Auth_TwoFactorSetup_text-secondary, #71717a);
  margin: 0.25rem 0 0 0;
}

.btn-primary {
  padding: 0.5rem 1rem;
  background-color: var(--components_Auth_TwoFactorSetup_bg-button-primary, #2563eb);
  color: var(--components_Auth_TwoFactorSetup_text-button-primary, #ffffff);
  font-size: 0.875rem;
  font-weight: 700;
  border-radius: 0.5rem;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-primary:hover {
  background-color: var(--components_Auth_TwoFactorSetup_bg-button-primary-hover, #3b82f6);
}

.btn-danger {
  padding: 0.5rem 1rem;
  background-color: var(--components_Auth_TwoFactorSetup_bg-button-danger, rgba(239, 68, 68, 0.1));
  color: var(--components_Auth_TwoFactorSetup_text-button-danger, #ef4444);
  font-size: 0.875rem;
  font-weight: 700;
  border-radius: 0.5rem;
  border: 1px solid var(--components_Auth_TwoFactorSetup_border-button-danger, rgba(239, 68, 68, 0.2));
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-danger:hover {
  background-color: var(--components_Auth_TwoFactorSetup_bg-button-danger-hover, rgba(239, 68, 68, 0.15));
}

/* 设置面板 */
.setup-card {
  background-color: var(--components_Auth_TwoFactorSetup_bg-modal, rgba(17, 17, 17, 0.3));
  border: 1px solid var(--components_Auth_TwoFactorSetup_border, #27272a);
  border-radius: 1rem;
  padding: 1.5rem;
}

.setup-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.setup-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--components_Auth_TwoFactorSetup_text-primary, #f4f4f5);
  margin: 0 0 0.5rem 0;
}

.setup-desc {
  font-size: 0.875rem;
  color: var(--components_Auth_TwoFactorSetup_text-secondary, #71717a);
  margin: 0;
}

.btn-close {
  padding: 0.5rem;
  color: var(--components_Auth_TwoFactorSetup_text-close, #71717a);
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 0.5rem;
  transition: color 0.2s;
}

.btn-close:hover {
  color: var(--components_Auth_TwoFactorSetup_text-close-hover, #d4d4d8);
}

/* 内容区域 */
.setup-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

@media (min-width: 768px) {
  .setup-content {
    flex-direction: row;
    align-items: flex-start;
  }
}

/* 二维码 */
.qr-wrapper {
  flex-shrink: 0;
}

.qr-bg {
  background-color: #ffffff;
  padding: 0.5rem;
  border-radius: 0.5rem;
}

.qr-image {
  width: 12rem;
  height: 12rem;
  display: block;
}

.qr-placeholder {
  width: 12rem;
  height: 12rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--components_Auth_TwoFactorSetup_bg-placeholder, #f5f5f5);
  color: var(--components_Auth_TwoFactorSetup_text-placeholder, #a1a1aa);
  border-radius: 0.5rem;
}

/* 输入区域 */
.input-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.input-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--components_Auth_TwoFactorSetup_text-label, #71717a);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.code-display {
  flex: 1;
  padding: 0.75rem 1rem;
  background-color: var(--components_Auth_TwoFactorSetup_bg-code, #18181b);
  border-radius: 0.5rem;
  border: 1px solid var(--components_Auth_TwoFactorSetup_border-code, #27272a);
  font-family: monospace;
  font-size: 0.875rem;
  color: var(--components_Auth_TwoFactorSetup_text-code, #d4d4d8);
}

.btn-icon {
  padding: 0.75rem;
  background-color: var(--components_Auth_TwoFactorSetup_bg-copy, #18181b);
  border-radius: 0.5rem;
  border: none;
  color: var(--components_Auth_TwoFactorSetup_text-copy, #a1a1aa);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background-color: var(--components_Auth_TwoFactorSetup_bg-copy-hover, #27272a);
  color: var(--components_Auth_TwoFactorSetup_text-close-hover, #d4d4d8);
}

.verify-row {
  display: flex;
  gap: 0.5rem;
}

.verify-input {
  flex: 1;
  padding: 0.75rem 1rem;
  background-color: var(--components_Auth_TwoFactorSetup_bg-input, #18181b);
  border: 1px solid var(--components_Auth_TwoFactorSetup_border-input, #27272a);
  border-radius: 0.5rem;
  color: var(--components_Auth_TwoFactorSetup_text-input, #f4f4f5);
  font-size: 0.875rem;
  outline: none;
  transition: all 0.2s;
  text-align: center;
  letter-spacing: 0.2em;
  font-family: monospace;
}

.verify-input::placeholder {
  color: var(--components_Auth_TwoFactorSetup_text-input-placeholder, #52525b);
}

.verify-input:focus {
  border-color: var(--components_Auth_TwoFactorSetup_border-input-focus, #3b82f6);
  box-shadow: 0 0 0 1px var(--components_Auth_TwoFactorSetup_shadow-input-focus, rgba(59, 130, 246, 0.2));
}

.btn-submit {
  padding: 0.75rem 1.5rem;
  background-color: var(--components_Auth_TwoFactorSetup_bg-button-primary, #2563eb);
  color: var(--components_Auth_TwoFactorSetup_text-button-primary, #ffffff);
  font-size: 0.875rem;
  font-weight: 700;
  border-radius: 0.5rem;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: background-color 0.2s;
}

.btn-submit:hover:not(:disabled) {
  background-color: var(--components_Auth_TwoFactorSetup_bg-button-primary-hover, #3b82f6);
}

.btn-submit:disabled {
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
</style>
