import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { isTrustedOrigin, normalizeOrigin } from '~~/server/utils/request-utils'
import { createApiError } from '~~/server/utils/apiError'
import { SERVER_ERROR_CODES } from '~~/server/config/constants'
import { getServerTimestamp } from '~~/server/utils/serverTime'

/** 未配置 PLUGIN_SHARED_SECRET 时只告警一次，避免每次插件请求刷日志 */
let legacyPluginBypassWarned = false

/**
 * 校验外部受信客户端的 HMAC 签名。
 * 签名串： `${timestamp}\n${method}\n${pathname}\n${nonce}`
 * 时间窗 5 分钟。
 */
async function verifyPluginSignature(event: H3Event, pathname: string): Promise<boolean> {
  const secret = String(process.env.PLUGIN_SHARED_SECRET || '')
  if (!secret || secret.length < 32) return false

  const timestamp = String(getHeader(event, 'x-plugin-timestamp') || '')
  const nonce = String(getHeader(event, 'x-plugin-nonce') || '')
  const signature = String(getHeader(event, 'x-plugin-signature') || '')
  if (!timestamp || !nonce || !signature) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Math.floor(getServerTimestamp() / 1000) - ts) > 300) return false

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}\n${getMethod(event)}\n${pathname}\n${nonce}`)
    .digest('hex')

  const a = Buffer.from(signature, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  // nonce 一次性消费，防重放（依赖 Redis；未配置 Redis 时退化为时间窗约束）
  try {
    const { getStore, setStore } = await import('~~/server/utils/captchaStore')
    const key = `plugin-nonce:${nonce}`
    const used = await getStore(key)
    if (used) return false
    await setStore(key, '1', 300)
  } catch {
    // Redis 不可用时仅依赖 5 分钟时间窗
  }
  return true
}

export default defineEventHandler(async (event) => {
  const requestUrl = getRequestURL(event)
  const pathname = requestUrl.pathname
  const method = getMethod(event)
  
  // 只处理特定的内部API路由，防止站外调用
  const isProtectedApi = pathname.startsWith('/api/api-enhanced/netease') ||
                         pathname.startsWith('/api/native-api') ||
                         pathname.startsWith('/api/music-source-plugins/')

  if (!isProtectedApi) {
    return
  }

  // 受信任的外部客户端（如 ClassIslandPlugin）需要显式授权才能绕过 Origin 校验。
  // 安全说明：该标记头本身可被伪造，因此配置了 PLUGIN_SHARED_SECRET 时必须同时通过
  // HMAC 校验（5 分钟时间窗 + 方法/路径绑定）。签名方案要求客户端同步适配，
  // 未配置密钥的实例仍按旧行为放行并告警，避免升级即刻打断全部插件调用。
  if (getHeader(event, 'x-requested-from') === 'ClassIslandPlugin') {
    const secretConfigured = String(process.env.PLUGIN_SHARED_SECRET || '').length >= 32
    if (secretConfigured) {
      if (await verifyPluginSignature(event, pathname)) {
        return
      }
      throw createApiError(403, SERVER_ERROR_CODES.PLUGIN_SIGNATURE_INVALID, '插件签名无效')
    }

    if (!legacyPluginBypassWarned) {
      legacyPluginBypassWarned = true
      console.warn(
        '[CORS Middleware] 检测到 x-requested-from: ClassIslandPlugin 绕过请求，但 PLUGIN_SHARED_SECRET 未配置（长度需 ≥32）；' +
          '该标记头可被伪造，配置密钥后插件客户端需改为附带 x-plugin-timestamp / x-plugin-nonce / x-plugin-signature 签名头。'
      )
    }
    return
  }

  // 显式配置 NUXT_PUBLIC_HOST 时使用配置来源校验。
  // 未配置时仍使用 Host 头；云平台等公开 Host 继续校验，仅当反向代理把 Host 改写为回环地址时跳过。
  const config = useRuntimeConfig(event)
  let configuredHost = typeof config.public?.host === 'string' ? config.public.host.trim() : ''
  if (!configuredHost) {
    const hostHeader = getHeader(event, 'x-forwarded-host') || getHeader(event, 'host')
    if (!hostHeader) {
      throw createError({ statusCode: 400, message: 'Bad Request: 缺少Host请求头' })
    }

    configuredHost = (hostHeader.split(',')[0] || '').trim()

    try {
      const hostOrigin = normalizeOrigin(configuredHost, requestUrl.protocol)
      if (isLoopbackHostname(hostOrigin.hostname)) {
        return
      }
    } catch {
      throw createError({ statusCode: 400, message: 'Bad Request: Host请求头无效' })
    }

    // 如果 x-forwarded-proto 存在，可以带上协议，使校验更精准
    const forwardedProto = getHeader(event, 'x-forwarded-proto')
    if (forwardedProto && !configuredHost.includes('://')) {
      const proto = (forwardedProto.split(',')[0] || '').trim()
      configuredHost = `${proto}://${configuredHost}`
    }
  }

  // CORS 限制：禁止站外网站调用
  const origin = getHeader(event, 'origin')
  const referer = getHeader(event, 'referer')
  const secFetchSite = getHeader(event, 'sec-fetch-site')
  const secFetchMode = getHeader(event, 'sec-fetch-mode')
  const sourceUrl = origin || referer

  // Fetch Metadata 由浏览器生成且脚本无法修改，同源请求不应被部署平台改写的 Host 误伤。
  if (secFetchSite === 'same-origin') return

  if (sourceUrl) {
    try {
      const sourceOrigin = normalizeOrigin(sourceUrl, requestUrl.protocol)
      const trustedOrigin = normalizeOrigin(configuredHost, requestUrl.protocol)
      const isSameLoopbackOrigin =
        isLoopbackHostname(sourceOrigin.hostname) &&
        isLoopbackHostname(trustedOrigin.hostname) &&
        sourceOrigin.protocol === trustedOrigin.protocol &&
        sourceOrigin.port === trustedOrigin.port

      const matchesConfiguredOrigin = isTrustedOrigin(sourceOrigin, trustedOrigin)
      const requestHost = getHeader(event, 'x-forwarded-host') || getHeader(event, 'host')
      const requestProto = getHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim() || requestUrl.protocol.replace(':', '')
      const firstHost = requestHost?.split(',')[0]?.trim()
      const hostOrigin = firstHost
        ? normalizeOrigin(`${requestProto}://${firstHost}`, requestUrl.protocol)
        : null
      const matchesRequestHost = hostOrigin && isTrustedOrigin(sourceOrigin, hostOrigin)

      if (!matchesConfiguredOrigin && !matchesRequestHost && !isSameLoopbackOrigin) {
        console.warn(`[CORS Middleware] 拦截跨域请求: 来源 ${sourceOrigin.origin}, 期望 ${trustedOrigin.origin}, 路径 ${pathname}`)
        throw createError({
          statusCode: 403,
          message: 'Forbidden: 内部API不允许跨域请求'
        })
      }
    } catch (e: unknown) {
      if (
        typeof e === 'object' &&
        e !== null &&
        'statusCode' in e &&
        typeof e.statusCode === 'number'
      ) {
        throw e
      }
      console.warn(`[CORS Middleware] 无效的来源 URL: ${sourceUrl}`, e)
      throw createError({
        statusCode: 400,
        message: 'Bad Request: Origin或Referer头无效'
      })
    }
  } else if (isTrustedFetchMetadata(secFetchSite, secFetchMode, method)) {
    // 浏览器隐私策略可能移除来源头，此时 Fetch Metadata 是更稳定的同源信号。
    return
  } else {
    // 没有来源信息且缺少可信 Fetch Metadata 时，仍按站外请求处理。
    console.warn(`[CORS Middleware] 拦截无Origin/Referer头的请求: 路径 ${pathname}, sec-fetch-site: ${secFetchSite || 'missing'}`)
    throw createError({
      statusCode: 403,
      message: 'Forbidden: 访问此API必须提供Origin或Referer头'
    })
  }
})

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function isTrustedFetchMetadata(
  secFetchSite: string | undefined,
  secFetchMode: string | undefined,
  method: string
): boolean {
  const normalizedMethod = method.toUpperCase()
  const safeMethod = normalizedMethod === 'GET' || normalizedMethod === 'HEAD'

  if (secFetchSite === 'same-origin') return true

  if (secFetchSite === 'none') {
    const isNavigation = !secFetchMode || secFetchMode === 'navigate'
    return safeMethod && isNavigation
  }

  // 兼容不发送 Fetch Metadata 的老浏览器、WebView 或反向代理；跨站请求有明确标记时仍会被拒绝。
  return !secFetchSite && safeMethod
}
