/**
 * 启动时安全配置校验。
 *
 * 背景：历史版本的 docker-compose.yml / .env.example 预置了公开的示例密钥
 * （JWT_SECRET=your-jwt-secret-here）。任何按 README 快速部署且未修改 .env 的实例，
 * 其 JWT 签名密钥是公开已知的，攻击者可以自行签发任意管理员身份令牌
 * （{userId, role, jti, tokenVersion}），造成完整的管理员接管。
 *
 * 这里在服务启动时 fail-fast：检测到弱密钥或缺失密钥则拒绝启动。
 */

// 公开仓库中出现过的示例值，等价于没有密钥
const KNOWN_PLACEHOLDER_SECRETS = [
  'your-jwt-secret-here',
  'your-very-secure-jwt-secret-key',
  'your-secret-key',
  'secret',
  'change-me',
  'jwt-secret',
  'voicehub-secret',
  '你的密钥',
  '你的jwt密钥'
]

const MIN_SECRET_LENGTH = 32

function validateJwtSecret(): void {
  const secret = String(process.env.JWT_SECRET || '').trim()
  const problems: string[] = []

  if (!secret) {
    problems.push('JWT_SECRET 未设置')
  } else if (KNOWN_PLACEHOLDER_SECRETS.includes(secret.toLowerCase())) {
    problems.push('JWT_SECRET 仍是公开示例值（攻击者可在 GitHub 上查到）')
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET 长度不足 ${MIN_SECRET_LENGTH} 位（当前 ${secret.length} 位）`)
  } else if (/^(.)\1+$/.test(secret)) {
    problems.push('JWT_SECRET 是单一字符重复，熵值过低')
  }

  if (problems.length === 0) return

  console.error('')
  console.error('╔══════════════════════════════════════════════════════════════╗')
  console.error('║  安全校验失败：拒绝启动                                       ║')
  console.error('╚══════════════════════════════════════════════════════════════╝')
  for (const problem of problems) {
    console.error(`  ✗ ${problem}`)
  }
  console.error('')
  console.error('  JWT_SECRET 用于签发登录会话与管理员令牌，一旦可预测即等于任意管理员接管。')
  console.error('  请生成一个高强度随机密钥后重新启动：')
  console.error('')
  console.error('      openssl rand -base64 48')
  console.error('')
  console.error('  然后写入 .env：  JWT_SECRET=<生成的值>')
  console.error('')
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    // 测试环境不阻断，避免影响现有测试
    return
  }
  process.exit(1)
}

/**
 * 非致命配置提示：缺失不会造成安全事件，但会让对应功能静默降级，
 * 启动时打印一次，避免管理员直到用户报障才发现。
 */
function warnOptionalSecurityConfig(): void {
  if (process.env.NODE_ENV !== 'production') return

  if (!String(process.env.NUXT_PUBLIC_HOST || '').trim()) {
    console.warn(
      '[安全配置] NUXT_PUBLIC_HOST 未配置：「忘记密码」接口将拒绝发送重置邮件（503），且内部 API 的来源校验只能依赖 Host 头。请设为站点对外域名。'
    )
  }

  const pluginSecret = String(process.env.PLUGIN_SHARED_SECRET || '').trim()
  if (pluginSecret && pluginSecret.length < 32) {
    console.warn(
      '[安全配置] PLUGIN_SHARED_SECRET 长度不足 32，插件 HMAC 签名不会启用，相关请求仍按旧行为放行。'
    )
  }
}

export default defineNitroPlugin(() => {
  validateJwtSecret()
  warnOptionalSecurityConfig()
})
