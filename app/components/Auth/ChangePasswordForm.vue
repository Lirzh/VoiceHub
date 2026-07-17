<template>
  <div class="password-form-container">
    <form class="password-form" @submit.prevent="handleChangePassword">
      <div v-if="!isFirstLogin" class="form-group">
        <label for="current-password" class="form-label">当前密码</label>
        <div class="input-wrapper">
          <div class="input-icon">
            <Lock :size="18" />
          </div>
          <input
            id="current-password"
            v-model="currentPassword"
            :class="[
              formInput,
              error ? 'input-error' : ''
            ]"
            :type="showCurrentPassword ? 'text' : 'password'"
            placeholder="请输入当前密码"
            required
            @input="error = ''"
          >
          <button
            class="toggle-password"
            type="button"
            @click="showCurrentPassword = !showCurrentPassword"
          >
            <Eye v-if="!showCurrentPassword" :size="18" />
            <EyeOff v-else :size="18" />
          </button>
        </div>
      </div>

      <div class="form-group">
        <label for="new-password" class="form-label">新密码</label>
        <div class="input-wrapper">
          <div class="input-icon">
            <KeyRound :size="18" />
          </div>
          <input
            id="new-password"
            v-model="newPassword"
            :class="[
              formInput,
              error ? 'input-error' : ''
            ]"
            :type="showNewPassword ? 'text' : 'password'"
            placeholder="请输入新密码"
            required
            @input="
              error = '';
              validatePassword()
            "
          >
          <button
            class="toggle-password"
            type="button"
            @click="showNewPassword = !showNewPassword"
          >
            <Eye v-if="!showNewPassword" :size="18" />
            <EyeOff v-else :size="18" />
          </button>
        </div>

        <!-- 密码强度指示器 -->
        <div v-if="newPassword" class="password-strength">
          <div class="strength-bar">
            <div
              class="strength-fill"
              :class="passwordStrength.colorClass"
              :style="{ width: passwordStrength.width }"
            />
          </div>
          <div class="strength-info">
            <span class="strength-label">密码强度</span>
            <span
              class="strength-text"
              :class="passwordStrength.textColorClass"
            >
              {{ passwordStrength.text }}
            </span>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label for="confirm-password" class="form-label">确认新密码</label>
        <div class="input-wrapper">
          <div class="input-icon">
            <CheckCircle2 :size="18" />
          </div>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            :class="[
              formInput,
              error || (confirmPassword && newPassword !== confirmPassword) ? 'input-error' : ''
            ]"
            :type="showConfirmPassword ? 'text' : 'password'"
            placeholder="请再次输入新密码"
            required
            @input="error = ''"
          >
          <button
            class="toggle-password"
            type="button"
            @click="showConfirmPassword = !showConfirmPassword"
          >
            <Eye v-if="!showConfirmPassword" :size="18" />
            <EyeOff v-else :size="18" />
          </button>
        </div>

        <!-- 密码匹配提示 -->
        <div v-if="confirmPassword" class="password-match">
          <div v-if="newPassword !== confirmPassword" class="match-error">
            <XCircle :size="12" />
            <span>密码不匹配</span>
          </div>
          <div v-else class="match-success">
            <CheckCircle2 :size="12" />
            <span>密码匹配</span>
          </div>
        </div>
      </div>

      <!-- 状态消息 -->
      <div v-if="error" class="alert-box alert-error">
        <AlertCircle :size="16" />
        <span>{{ error }}</span>
      </div>

      <div v-if="success" class="alert-box alert-success">
        <CheckCircle2 :size="16" />
        <span>{{ success }}</span>
      </div>

      <button
        :disabled="loading || !isFormValid"
        class="submit-button"
        type="submit"
      >
        <Loader2 v-if="loading" :size="18" class="icon-spin" />
        <span>{{ loading ? '处理中...' : isFirstLogin ? '设置初始密码' : '确认修改密码' }}</span>
      </button>
    </form>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2
} from '@lucide/vue'

// 组件属性
const props = defineProps({
  isFirstLogin: {
    type: Boolean,
    default: false
  }
})

const auth = useAuth()
const router = useRouter()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)

// 密码显示状态
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)

// 表单输入框基础样式
const formInput = 'form-input'

// 密码强度计算
const passwordStrength = computed(() => {
  const password = newPassword.value
  if (!password) return { width: '0%', colorClass: '', textColorClass: '', text: '' }

  let score = 0

  if (password.length >= 8) score += 25
  if (/[A-Z]/.test(password)) score += 25
  if (/[a-z]/.test(password)) score += 25
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 25

  if (score < 50) {
    return {
      width: `${score || 10}%`,
      colorClass: 'strength-weak',
      textColorClass: 'text-weak',
      text: '弱'
    }
  } else if (score < 75) {
    return {
      width: `${score}%`,
      colorClass: 'strength-medium',
      textColorClass: 'text-medium',
      text: '中等'
    }
  } else if (score < 100) {
    return {
      width: `${score}%`,
      colorClass: 'strength-strong',
      textColorClass: 'text-strong',
      text: '强'
    }
  } else {
    return {
      width: '100%',
      colorClass: 'strength-very-strong',
      textColorClass: 'text-very-strong',
      text: '极强'
    }
  }
})

// 表单验证
const isFormValid = computed(() => {
  if (props.isFirstLogin) {
    return (
      newPassword.value &&
      confirmPassword.value &&
      newPassword.value === confirmPassword.value &&
      newPassword.value.length >= 8
    )
  } else {
    return (
      currentPassword.value &&
      newPassword.value &&
      confirmPassword.value &&
      newPassword.value === confirmPassword.value &&
      newPassword.value.length >= 8
    )
  }
})

const validatePassword = () => {
  if (newPassword.value && newPassword.value.length < 8) {
    error.value = '密码长度至少为8位'
  } else {
    error.value = ''
  }
}

const handleChangePassword = async () => {
  if (newPassword.value !== confirmPassword.value) {
    error.value = '新密码和确认密码不匹配'
    return
  }

  if (newPassword.value.length < 8) {
    error.value = '新密码长度至少为8位'
    return
  }

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    if (props.isFirstLogin) {
      await auth.setInitialPassword(newPassword.value)
      success.value = '密码设置成功！正在跳转...'

      // 清空表单
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''

      // 密码设置完成后跳转
      setTimeout(async () => {
        // 更新用户状态
        await auth.refreshUser()

        if (auth.isAdmin.value) {
          router.push('/dashboard')
        } else {
          router.push('/')
        }
      }, 2000)
    } else {
      await auth.changePassword(currentPassword.value, newPassword.value)
      success.value = '密码修改成功！请重新登录'

      // 清空表单
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''

      // 密码修改后登出
      setTimeout(() => {
        auth.logout()
        router.push('/login')
      }, 2000)
    }
  } catch (err) {
    // 提取错误信息，支持多种错误格式（优先使用 message）
    if (err.data && err.data.message) {
      error.value = err.data.message
    } else if (err.data && err.data.statusMessage) {
      error.value = err.data.statusMessage
    } else if (err.message) {
      error.value = err.message
    } else if (err.statusMessage) {
      error.value = err.statusMessage
    } else {
      error.value = '操作失败，请重试'
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.password-form-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.password-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-label {
  font-size: 0.75rem;
  font-weight: 900;
  color: var(--components_Auth_ChangePasswordForm_text-label, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-left: 0.25rem;
}

.input-wrapper {
  position: relative;
}

.input-icon {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--components_Auth_ChangePasswordForm_text-label, #6b7280);
  transition: color 0.2s;
  pointer-events: none;
}

.input-wrapper:focus-within .input-icon {
  color: var(--components_Auth_ChangePasswordForm_text-icon-focus, #3b82f6);
}

.form-input {
  width: 100%;
  background-color: var(--components_Auth_ChangePasswordForm_bg-input, #27272a);
  border: 1px solid var(--components_Auth_ChangePasswordForm_border, #27272a);
  border-radius: 0.75rem;
  padding: 0.75rem 3rem;
  font-size: 0.875rem;
  color: var(--components_Auth_ChangePasswordForm_text-input, #e4e4e7);
  outline: none;
  transition: all 0.2s;
}

.form-input::placeholder {
  color: var(--components_Auth_ChangePasswordForm_text-placeholder, #52525b);
}

.form-input:focus {
  border-color: var(--components_Auth_ChangePasswordForm_border-focus, rgba(59, 130, 246, 0.2));
}

.input-error {
  border-color: var(--components_Auth_ChangePasswordForm_border-error, #f43f5e) !important;
  box-shadow: 0 0 15px var(--components_Auth_ChangePasswordForm_22_0, rgba(244, 63, 94, 0.1));
}

.toggle-password {
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%);
  padding: 0.25rem;
  background: none;
  border: none;
  color: var(--components_Auth_ChangePasswordForm_text-label, #6b7280);
  cursor: pointer;
  border-radius: 0.25rem;
  transition: color 0.2s;
}

.toggle-password:hover {
  color: var(--components_Auth_ChangePasswordForm_text-icon, #9ca3af);
}

/* 密码强度指示器 */
.password-strength {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.strength-bar {
  height: 0.25rem;
  width: 100%;
  background-color: var(--components_Auth_ChangePasswordForm_border, #27272a);
  border-radius: 9999px;
  overflow: hidden;
}

.strength-fill {
  height: 100%;
  transition: width 0.5s ease;
}

.strength-weak {
  background-color: var(--components_Auth_ChangePasswordForm_bg-strength-weak, #f43f5e);
}

.strength-medium {
  background-color: var(--components_Auth_ChangePasswordForm_bg-strength-medium, #f59e0b);
}

.strength-strong {
  background-color: var(--components_Auth_ChangePasswordForm_bg-strength-strong, #3b82f6);
}

.strength-very-strong {
  background-color: var(--components_Auth_ChangePasswordForm_bg-strength-very-strong, #10b981);
}

.strength-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.strength-label {
  font-size: 0.625rem;
  font-weight: 900;
  color: var(--components_Auth_ChangePasswordForm_text-label, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.strength-text {
  font-size: 0.625rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.text-weak {
  color: var(--components_Auth_ChangePasswordForm_text-strength-weak, #f43f5e);
}

.text-medium {
  color: var(--components_Auth_ChangePasswordForm_text-strength-medium, #f59e0b);
}

.text-strong {
  color: var(--components_Auth_ChangePasswordForm_text-strength-strong, #3b82f6);
}

.text-very-strong {
  color: var(--components_Auth_ChangePasswordForm_text-strength-very-strong, #10b981);
}

/* 密码匹配提示 */
.password-match {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.625rem;
  font-weight: 700;
}

.match-error {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--components_Auth_ChangePasswordForm_text-error, #f43f5e);
}

.match-success {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--components_Auth_ChangePasswordForm_text-success, #10b981);
}

/* 提示框 */
.alert-box {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.alert-error {
  background-color: var(--components_Auth_ChangePasswordForm_bg-error, #f43f5e10);
  border: 1px solid var(--components_Auth_ChangePasswordForm_border-error-box, #f43f5e20);
  color: var(--components_Auth_ChangePasswordForm_text-error, #f43f5e);
}

.alert-success {
  background-color: var(--components_Auth_ChangePasswordForm_bg-success, #10b98110);
  border: 1px solid var(--components_Auth_ChangePasswordForm_border-success-box, #10b98120);
  color: var(--components_Auth_ChangePasswordForm_text-success, #10b981);
}

/* 提交按钮 */
.submit-button {
  width: 100%;
  padding: 0.75rem 1rem;
  background-color: var(--components_Auth_ChangePasswordForm_bg-button-primary, #2563eb);
  color: var(--components_Auth_ChangePasswordForm_text-button-primary, #ffffff);
  font-size: 0.875rem;
  font-weight: 900;
  border-radius: 0.75rem;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.2s;
  box-shadow: 0 10px 15px -3px var(--components_Auth_ChangePasswordForm_shadow-button-primary, rgba(37, 99, 235, 0.2));
}

.submit-button:hover:not(:disabled) {
  background-color: var(--components_Auth_ChangePasswordForm_bg-button-primary-hover, #3b82f6);
}

.submit-button:active:not(:disabled) {
  transform: scale(0.98);
}

.submit-button:disabled {
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
