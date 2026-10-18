import type { H3Event } from 'h3'
import { getRequestHeader, getRequestURL } from 'h3'
import { pluginError } from './errors'
import { createApiError } from '../apiError'
import { isSameSiteWrite } from '../request-utils'
import { SERVER_ERROR_CODES } from '../../config/constants'
import { checkDistributedRateLimit } from '../rateLimiter'
import { getClientIP } from '../ip-utils'

export async function pluginAccess(event: H3Event, admin = false) {
  const user = event.context.user
  if (!user) throw createApiError(401, SERVER_ERROR_CODES.AUTH_UNAUTHORIZED, '请先登录')
  if (admin && user.role !== 'SUPER_ADMIN') throw createApiError(403, SERVER_ERROR_CODES.COMMON_INSUFFICIENT_PERMISSION, '需要超级管理员权限')
  if (admin && !['GET', 'HEAD'].includes(event.method) && !isSameSiteWrite(writeSignals(event))) {
    throw pluginError('PLUGIN_CROSS_SITE_REQUEST', 403)
  }
  for (const key of [`user:${user.id}`, `ip:${getClientIP(event)}`]) {
    const limit = await checkDistributedRateLimit(`music-plugins:${admin ? 'admin' : 'call'}:${key}`, admin ? 60 : 90, 60000)
    if (!limit.isAllowed) throw createApiError(429, SERVER_ERROR_CODES.COMMON_RATE_LIMITED_SECONDS, '请求过于频繁', { params: [60] })
  }
  return user
}

/** 收集同源判定信号；配置了 NUXT_PUBLIC_HOST 时以其为准，不采信客户端可控的 Host 头 */
function writeSignals(event: H3Event) {
  const configuredHost = String(useRuntimeConfig(event).public?.host || '').trim()
  const requestHost = getRequestHeader(event, 'x-forwarded-host') || getRequestHeader(event, 'host')
  const forwardedProto = (getRequestHeader(event, 'x-forwarded-proto') || '').split(',')[0]?.trim()
  return {
    secFetchSite: getRequestHeader(event, 'sec-fetch-site'),
    origin: getRequestHeader(event, 'origin'),
    configuredHost,
    requestHost,
    protocol: forwardedProto === 'https' ? 'https:' : getRequestURL(event).protocol
  }
}
