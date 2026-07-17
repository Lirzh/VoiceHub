<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="show"
        class="confirm-overlay"
        @click="handleOverlayClick"
      >
        <div
          class="confirm-modal"
          @click.stop
        >
          <!-- 内容 -->
          <div class="confirm-content">
            <!-- 图标 -->
            <div
              class="confirm-icon"
              :class="iconClasses"
            >
              <Icon :name="iconName" :size="40" />
            </div>

            <!-- 文字内容 -->
            <div class="confirm-text">
              <h4 class="confirm-title">{{ title }}</h4>
              <p class="confirm-message">
                {{ message }}
              </p>
              
              <!-- 可选的输入框 -->
              <div v-if="showInput" class="confirm-input-wrapper">
                <input
                  v-model="inputValue"
                  :type="inputType"
                  :placeholder="inputPlaceholder"
                  class="confirm-input"
                  @keyup.enter="handleConfirm"
                />
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="confirm-actions">
              <button
                class="btn-confirm-cancel"
                :disabled="loading"
                @click="handleCancel"
              >
                {{ cancelText }}
              </button>
              <button
                class="btn-confirm"
                :class="confirmBtnClasses"
                :disabled="loading || (showInput && !inputValue)"
                @click="handleConfirm"
              >
                <Icon v-if="loading" name="loader" :size="16" class="icon-spin" />
                {{ loading ? '处理中...' : confirmText }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: '确认操作'
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'warning',
    validator: (value) => ['warning', 'danger', 'info', 'success'].includes(value)
  },
  confirmText: {
    type: String,
    default: '确认'
  },
  cancelText: {
    type: String,
    default: '取消'
  },
  loading: {
    type: Boolean,
    default: false
  },
  closeOnOverlay: {
    type: Boolean,
    default: true
  },
  showInput: {
    type: Boolean,
    default: false
  },
  inputType: {
    type: String,
    default: 'text'
  },
  inputPlaceholder: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['confirm', 'cancel', 'close', 'update:show'])

const inputValue = ref('')

watch(() => props.show, (newVal) => {
  if (newVal) {
    inputValue.value = ''
  }
})

const handleConfirm = () => {
  if (props.showInput) {
    emit('confirm', inputValue.value)
  } else {
    emit('confirm')
  }
}

const handleCancel = () => {
  emit('cancel')
  emit('close')
  emit('update:show', false)
}

const handleOverlayClick = () => {
  if (props.closeOnOverlay && !props.loading) {
    handleCancel()
  }
}

const iconName = computed(() => {
  switch (props.type) {
    case 'danger':
      return 'alert-circle'
    case 'success':
      return 'success'
    case 'info':
      return 'info'
    case 'warning':
    default:
      return 'alert-triangle'
  }
})

const iconClasses = computed(() => {
  switch (props.type) {
    case 'danger':
      return 'icon-danger'
    case 'success':
      return 'icon-success'
    case 'info':
      return 'icon-info'
    case 'warning':
    default:
      return 'icon-warning'
  }
})

const confirmBtnClasses = computed(() => {
  switch (props.type) {
    case 'danger':
      return 'btn-danger'
    case 'success':
      return 'btn-success'
    case 'info':
      return 'btn-info'
    case 'warning':
    default:
      return 'btn-warning'
  }
})
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background-color: var(--components_UI_ConfirmDialog_overlay-bg, rgba(0, 0, 0, 0.8));
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.confirm-modal {
  width: 100%;
  max-width: 28rem;
  background-color: var(--components_UI_ConfirmDialog_modal-bg, #18181b);
  border: 1px solid var(--components_UI_ConfirmDialog_modal-border, #27272a);
  border-radius: 1.5rem;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.confirm-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem;
  text-align: center;
}

.confirm-icon {
  width: 5rem;
  height: 5rem;
  border-radius: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
  transition: background-color 0.2s;
  border: 1px solid;
}

.icon-warning {
  background-color: var(--components_UI_ConfirmDialog_icon-warning-bg, rgba(245, 158, 11, 0.1));
  color: var(--components_UI_ConfirmDialog_icon-warning-color, #f59e0b);
  border-color: var(--components_UI_ConfirmDialog_icon-warning-border, rgba(245, 158, 11, 0.2));
  box-shadow: 0 4px 6px -1px rgba(245, 158, 11, 0.2);
}

.icon-danger {
  background-color: var(--components_UI_ConfirmDialog_icon-danger-bg, rgba(239, 68, 68, 0.1));
  color: var(--components_UI_ConfirmDialog_icon-danger-color, #ef4444);
  border-color: var(--components_UI_ConfirmDialog_icon-danger-border, rgba(239, 68, 68, 0.2));
  box-shadow: 0 4px 6px -1px rgba(239, 68, 68, 0.2);
}

.icon-success {
  background-color: var(--components_UI_ConfirmDialog_icon-success-bg, rgba(16, 185, 129, 0.1));
  color: var(--components_UI_ConfirmDialog_icon-success-color, #10b981);
  border-color: var(--components_UI_ConfirmDialog_icon-success-border, rgba(16, 185, 129, 0.2));
  box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2);
}

.icon-info {
  background-color: var(--components_UI_ConfirmDialog_icon-info-bg, rgba(59, 130, 246, 0.1));
  color: var(--components_UI_ConfirmDialog_icon-info-color, #3b82f6);
  border-color: var(--components_UI_ConfirmDialog_icon-info-border, rgba(59, 130, 246, 0.2));
  box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.2);
}

.confirm-text {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 2rem;
}

.confirm-title {
  font-size: 1.25rem;
  font-weight: 900;
  color: var(--components_UI_ConfirmDialog_title-color, #f4f4f5);
  letter-spacing: -0.02em;
  margin: 0;
}

.confirm-message {
  font-size: 0.875rem;
  color: var(--components_UI_ConfirmDialog_message-color, #71717a);
  line-height: 1.6;
  font-weight: 500;
  white-space: pre-line;
  word-break: break-all;
}

.confirm-input-wrapper {
  padding-top: 1rem;
  width: 100%;
}

.confirm-input {
  width: 100%;
  background-color: var(--components_UI_ConfirmDialog_input-bg, rgba(39, 39, 42, 0.5));
  border: 1px solid var(--components_UI_ConfirmDialog_input-border, rgba(63, 63, 70, 0.5));
  border-radius: 0.75rem;
  padding: 0.75rem 1rem;
  color: var(--components_UI_ConfirmDialog_title-color, #f4f4f5);
  font-size: 0.875rem;
  outline: none;
  transition: all 0.2s;
}

.confirm-input::placeholder {
  color: var(--components_UI_ConfirmDialog_input-placeholder, #52525b);
}

.confirm-input:focus {
  border-color: var(--components_UI_ConfirmDialog_input-focus, #3b82f6);
  box-shadow: 0 0 0 1px var(--components_UI_ConfirmDialog_input-focus, #3b82f6);
}

.confirm-actions {
  display: flex;
  gap: 0.75rem;
  width: 100%;
}

.btn-confirm-cancel {
  flex: 1;
  padding: 1.5rem 1.5rem;
  background-color: var(--components_UI_ConfirmDialog_cancel-bg, #27272a);
  color: var(--components_UI_ConfirmDialog_cancel-text, #d4d4d8);
  font-size: 0.75rem;
  font-weight: 900;
  border-radius: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  transition: all 0.2s;
  cursor: pointer;
  border: none;
}

.btn-confirm-cancel:hover:not(:disabled) {
  background-color: var(--components_UI_ConfirmDialog_cancel-hover, #3f3f46);
}

.btn-confirm-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-confirm {
  flex: 2;
  padding: 1.5rem 1.5rem;
  color: white;
  font-size: 0.75rem;
  font-weight: 900;
  border-radius: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  transition: all 0.2s;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: none;
}

.btn-confirm:active:not(:disabled) {
  transform: scale(0.95);
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-warning {
  background-color: var(--components_UI_ConfirmDialog_btn-warning-bg, #d97706);
  box-shadow: 0 10px 15px -3px var(--components_UI_ConfirmDialog_btn-warning-shadow, rgba(217, 119, 6, 0.2));
}

.btn-warning:hover:not(:disabled) {
  background-color: var(--components_UI_ConfirmDialog_btn-warning-hover, #f59e0b);
}

.btn-danger {
  background-color: var(--components_UI_ConfirmDialog_btn-danger-bg, #dc2626);
  box-shadow: 0 10px 15px -3px var(--components_UI_ConfirmDialog_btn-danger-shadow, rgba(220, 38, 38, 0.2));
}

.btn-danger:hover:not(:disabled) {
  background-color: var(--components_UI_ConfirmDialog_btn-danger-hover, #ef4444);
}

.btn-success {
  background-color: var(--components_UI_ConfirmDialog_btn-success-bg, #059669);
  box-shadow: 0 10px 15px -3px var(--components_UI_ConfirmDialog_btn-success-shadow, rgba(5, 150, 105, 0.2));
}

.btn-success:hover:not(:disabled) {
  background-color: var(--components_UI_ConfirmDialog_btn-success-hover, #10b981);
}

.btn-info {
  background-color: var(--components_UI_ConfirmDialog_btn-info-bg, #2563eb);
  box-shadow: 0 10px 15px -3px var(--components_UI_ConfirmDialog_btn-info-shadow, rgba(37, 99, 235, 0.2));
}

.btn-info:hover:not(:disabled) {
  background-color: var(--components_UI_ConfirmDialog_btn-info-hover, #3b82f6);
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
