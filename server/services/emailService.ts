import nodemailer from 'nodemailer'
import { db } from '~/drizzle/db'
import { systemSettings, users, notificationSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'

/**
 * 创建邮件传输器
 */
async function createTransporter() {
  // 获取系统设置
  const settingsResult = await db.select().from(systemSettings).limit(1)
  const settings = settingsResult[0]
  
  // 从系统设置或环境变量获取SMTP配置
  const smtpHost = settings?.smtpHost || process.env.SMTP_HOST
  const smtpPort = settings?.smtpPort || process.env.SMTP_PORT
  const smtpSecure = settings?.smtpSecure === undefined ? 
    (process.env.SMTP_SECURE === 'true') : settings.smtpSecure
  const smtpUser = settings?.smtpUser || process.env.SMTP_USER
  const smtpPass = settings?.smtpPass || process.env.SMTP_PASS
  const smtpFrom = settings?.smtpFrom || process.env.SMTP_FROM
  
  // 检查必要配置是否存在
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !smtpFrom) {
    throw new Error('缺少SMTP配置，请在系统设置或环境变量中配置SMTP参数')
  }
  
  // 创建传输器
  return nodemailer.createTransporter({
    host: smtpHost,
    port: parseInt(smtpPort),
    secure: smtpSecure, // true for 465, false for other ports
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  })
}

/**
 * 发送邮件
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  try {
    // 创建传输器
    const transporter = await createTransporter()
    
    // 获取发件人地址
    const settingsResult = await db.select().from(systemSettings).limit(1)
    const settings = settingsResult[0]
    const smtpFrom = settings?.smtpFrom || process.env.SMTP_FROM
    
    // 发送邮件
    const info = await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      html
    })
    
    console.log('邮件发送成功:', info.messageId)
    return true
  } catch (error) {
    console.error('发送邮件失败:', error)
    return false
  }
}

/**
 * 发送通知邮件
 */
export async function sendNotificationEmail(
  userId: number,
  title: string,
  content: string
): Promise<boolean> {
  try {
    // 获取用户信息
    const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    const user = userResult[0]
    
    // 检查用户是否存在且有邮箱
    if (!user || !user.email) {
      return false
    }
    
    // 获取用户通知设置
    const settingsResult = await db.select().from(notificationSettings).where(eq(notificationSettings.userId, userId)).limit(1)
    const notificationSettings = settingsResult[0]
    
    // 检查用户是否启用了邮件通知
    if (notificationSettings && !notificationSettings.emailEnabled) {
      return false
    }
    
    // 构建邮件内容
    const html = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">${title}</h2>
        <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0; color: #555;">${content}</p>
        </div>
        <p style="color: #888; font-size: 14px;">
          此邮件来自 VoiceHub 通知系统。<br>
          如果您不希望收到此类通知，请登录系统修改通知设置。
        </p>
      </div>
    `
    
    // 发送邮件
    return await sendEmail(user.email, title, html)
  } catch (error) {
    console.error('发送通知邮件失败:', error)
    return false
  }
}