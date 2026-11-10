import { and, eq } from 'drizzle-orm'
import { db, userIdentities, users } from '~/drizzle/db'
import { JWTEnhanced } from '~~/server/utils/jwt-enhanced'

export interface TwoFactorChallengeResult {
  userId: number
  methods: string[]
  maskedEmail: string
  tempToken: string
}

// 检测用户是否开启 TOTP，开启则生成 2fa_pending 预认证临时令牌。
// 供密码登录、OAuth 登录、WebAuthn 登录统一复用，避免任一登录方式绕过二次验证。
// 返回 null 表示该用户未开启 TOTP，可直接签发会话。
export async function buildTwoFactorChallenge(
  userId: number,
  email?: string | null,
  emailVerified?: boolean | null
): Promise<TwoFactorChallengeResult | null> {
  const totpIdentity = await db.query.userIdentities.findFirst({
    where: and(eq(userIdentities.userId, userId), eq(userIdentities.provider, 'totp'))
  })
  if (!totpIdentity) return null

  const [user] = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const tempToken = JWTEnhanced.sign(
    {
      userId,
      tokenVersion: user?.tokenVersion,
      type: 'pre-auth',
      scope: '2fa_pending'
    },
    { expiresIn: '5m' }
  )

  const methods = ['totp']
  let maskedEmail = ''
  if (email && emailVerified) {
    methods.push('email')
    const [local, domain] = email.split('@')
    if (local && domain) {
      maskedEmail = local.length <= 2 ? `***@${domain}` : `${local.slice(0, 2)}****@${domain}`
    }
  }

  return { userId, methods, maskedEmail, tempToken }
}
