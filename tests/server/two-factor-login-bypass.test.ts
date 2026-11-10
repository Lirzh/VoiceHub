import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

// buildTwoFactorChallenge 依赖 DB 查询与 JWT 签发，用 fixture 注入状态。
const modules: Record<string, string> = {
  '~/drizzle/db': `
    export const userIdentities = {
      userId: { key: 'userId' },
      provider: { key: 'provider' },
      id: { key: 'id' }
    }
    export const users = { id: { key: 'id' }, tokenVersion: { key: 'tokenVersion' } }
    export const db = new Proxy({}, {
      get: (_, key) => {
        if (key === 'query') return {
          userIdentities: {
            findFirst: (opts) => globalThis.__tfaFixtures.findIdentity(opts.where)
          }
        }
        // db.select().from(users).where(...).limit(1) 链式调用
        return () => {
          const chain = {
            from: () => chain,
            where: () => chain,
            limit: () => globalThis.__tfaFixtures.selectUser()
          }
          return chain
        }
      }
    })
  `,
  '~/drizzle/schema': `
    export const userIdentities = {
      userId: { key: 'userId' },
      provider: { key: 'provider' },
      id: { key: 'id' }
    }
    export const users = { id: { key: 'id' }, tokenVersion: { key: 'tokenVersion' } }
  `,
  'drizzle-orm': `
    export const eq = (field, value) => ({ field: field.key, value })
    export const and = (...conditions) => conditions
  `,
  '~~/server/utils/jwt-enhanced': `
    export class JWTEnhanced {
      static sign(payload, options) {
        globalThis.__tfaFixtures.signedPayload = payload
        return 'mock-temp-token'
      }
    }
  `
}

async function loadChallenge() {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../../server/utils/two-factor-challenge.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
    tsconfigRaw: { compilerOptions: {} },
    plugins: [{
      name: 'tfa-fixture', setup(builder) {
        builder.onResolve({ filter: /^(drizzle-orm|~\/|~~\/)/ }, (args) => ({ path: args.path, namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          if (!modules[args.path]) throw new Error(`未配置依赖: ${args.path}`)
          return { contents: modules[args.path], loader: 'js' }
        })
      }
    }]
  })
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports)
  return module.exports.buildTwoFactorChallenge
}

const buildTwoFactorChallenge = await loadChallenge()

function fixture({ hasTotp = true, email = null, emailVerified = false, tokenVersion = 3 } = {}) {
  const state = {
    signedPayload: null,
    findIdentity: () => (hasTotp ? { id: 1, provider: 'totp' } : null),
    selectUser: () => [{ tokenVersion }]
  }
  ;(globalThis as any).__tfaFixtures = state
  return state
}

test('未开启 TOTP 返回 null，不签发预认证令牌', async () => {
  fixture({ hasTotp: false })
  const result = await buildTwoFactorChallenge(42)
  assert.equal(result, null)
})

test('开启 TOTP 返回 methods/tempToken，payload 为 2fa_pending', async () => {
  const state = fixture({ email: 'student@school.edu.cn', emailVerified: true })
  const result = await buildTwoFactorChallenge(42, 'student@school.edu.cn', true)
  assert.ok(result)
  assert.equal(result.userId, 42)
  assert.deepEqual(result.methods, ['totp', 'email'])
  assert.equal(result.tempToken, 'mock-temp-token')
  assert.match(result.maskedEmail, /school\.edu\.cn$/)
  assert.equal(state.signedPayload.userId, 42)
  assert.equal(state.signedPayload.scope, '2fa_pending')
  assert.equal(state.signedPayload.tokenVersion, 3)
})

test('未验证邮箱不提供 email 方式，仅 TOTP', async () => {
  fixture({ email: 'student@school.edu.cn', emailVerified: false })
  const result = await buildTwoFactorChallenge(42, 'student@school.edu.cn', false)
  assert.deepEqual(result!.methods, ['totp'])
  assert.equal(result!.maskedEmail, '')
})

test('OAuth 回调在 createAuthSession 前调用 2FA 门控', () => {
  const source = read('../../server/api/auth/[provider]/callback.get.ts')
  const sessionIdx = source.indexOf('createAuthSession(event, existingIdentity.user')
  const gateIdx = source.indexOf('buildTwoFactorChallenge(')
  assert.ok(sessionIdx > 0, 'OAuth 回调应签发会话')
  assert.ok(gateIdx > 0, 'OAuth 回调应检测 TOTP')
  assert.ok(gateIdx < sessionIdx, 'TOTP 门控必须在签发会话之前')
  assert.match(source, /setCookie\(event, 'pre-auth-token'/)
})

test('WebAuthn 登录在 createAuthSession 前调用 2FA 门控', () => {
  const source = read('../../server/api/auth/webauthn/login/verify.post.ts')
  const sessionIdx = source.indexOf('createAuthSession(event, identity.user')
  const gateIdx = source.indexOf('buildTwoFactorChallenge(user.id')
  assert.ok(sessionIdx > 0, 'WebAuthn 登录应签发会话')
  assert.ok(gateIdx > 0, 'WebAuthn 登录应检测 TOTP')
  assert.ok(gateIdx < sessionIdx, 'TOTP 门控必须在签发会话之前')
})
