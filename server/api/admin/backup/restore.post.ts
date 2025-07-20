import { createError, defineEventHandler, readBody } from 'h3'
import { prisma } from '../../../models/schema'
import { promises as fs } from 'fs'
import path from 'path'

export default defineEventHandler(async (event) => {
  try {
    // 验证管理员权限
    const user = event.context.user
    if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw createError({
        statusCode: 403,
        statusMessage: '权限不足'
      })
    }

    const body = await readBody(event)
    const { filename, mode = 'merge', clearExisting = false } = body

    if (!filename) {
      throw createError({
        statusCode: 400,
        statusMessage: '请指定备份文件名'
      })
    }

    console.log(`开始恢复数据库备份: ${filename}`)
    
    // 读取备份文件
    const backupDir = path.join(process.cwd(), 'backups')
    const filepath = path.join(backupDir, filename)

    let backupData
    try {
      const fileContent = await fs.readFile(filepath, 'utf8')
      backupData = JSON.parse(fileContent)
    } catch (error) {
      throw createError({
        statusCode: 404,
        statusMessage: '备份文件不存在或格式错误'
      })
    }

    // 验证备份文件格式
    if (!backupData.metadata || !backupData.data) {
      throw createError({
        statusCode: 400,
        statusMessage: '备份文件格式无效'
      })
    }

    console.log(`备份文件信息:`)
    console.log(`- 版本: ${backupData.metadata.version}`)
    console.log(`- 创建时间: ${backupData.metadata.timestamp}`)
    console.log(`- 创建者: ${backupData.metadata.creator}`)
    console.log(`- 总记录数: ${backupData.metadata.totalRecords}`)

    const restoreResults = {
      success: true,
      message: '数据恢复完成',
      details: {
        tablesProcessed: 0,
        recordsRestored: 0,
        errors: [],
        warnings: []
      }
    }

    // 如果需要清空现有数据
    if (clearExisting) {
      console.log('清空现有数据...')
      try {
        // 按照外键依赖顺序删除数据
        await prisma.notification.deleteMany()
        await prisma.notificationSettings.deleteMany()
        await prisma.schedule.deleteMany()
        await prisma.vote.deleteMany()
        await prisma.song.deleteMany()
        await prisma.user.deleteMany()
        await prisma.playTime.deleteMany()
        await prisma.semester.deleteMany()
        await prisma.systemSettings.deleteMany()
        console.log('✅ 现有数据已清空')
      } catch (error) {
        console.error('清空数据失败:', error)
        restoreResults.details.warnings.push(`清空数据失败: ${error.message}`)
      }
    }

    // 定义恢复顺序（考虑外键依赖）
    const restoreOrder = [
      'systemSettings',
      'playTimes', 
      'semesters',
      'users',
      'songs',
      'votes',
      'schedules',
      'notificationSettings',
      'notifications'
    ]

    // 开始事务恢复
    await prisma.$transaction(async (tx) => {
      for (const tableName of restoreOrder) {
        if (!backupData.data[tableName]) {
          continue
        }

        const tableData = backupData.data[tableName]
        if (!Array.isArray(tableData) || tableData.length === 0) {
          continue
        }

        console.log(`恢复表: ${tableName} (${tableData.length} 条记录)`)
        
        try {
          let restoredCount = 0

          for (const record of tableData) {
            try {
              // 根据表名选择恢复策略
              switch (tableName) {
                case 'users':
                  if (mode === 'merge') {
                    await tx.user.upsert({
                      where: { username: record.username },
                      update: {
                        name: record.name,
                        grade: record.grade,
                        class: record.class,
                        role: record.role,
                        lastLogin: record.lastLogin ? new Date(record.lastLogin) : null,
                        lastLoginIp: record.lastLoginIp,
                        passwordChangedAt: record.passwordChangedAt ? new Date(record.passwordChangedAt) : null
                      },
                      create: {
                        username: record.username,
                        name: record.name,
                        password: record.password,
                        grade: record.grade,
                        class: record.class,
                        role: record.role,
                        lastLogin: record.lastLogin ? new Date(record.lastLogin) : null,
                        lastLoginIp: record.lastLoginIp,
                        passwordChangedAt: record.passwordChangedAt ? new Date(record.passwordChangedAt) : null
                      }
                    })
                  } else {
                    await tx.user.create({
                      data: {
                        username: record.username,
                        name: record.name,
                        password: record.password,
                        grade: record.grade,
                        class: record.class,
                        role: record.role,
                        lastLogin: record.lastLogin ? new Date(record.lastLogin) : null,
                        lastLoginIp: record.lastLoginIp,
                        passwordChangedAt: record.passwordChangedAt ? new Date(record.passwordChangedAt) : null
                      }
                    })
                  }
                  break

                case 'songs':
                  const songData = {
                    title: record.title,
                    artist: record.artist,
                    requesterId: record.requesterId,
                    played: record.played,
                    playedAt: record.playedAt ? new Date(record.playedAt) : null,
                    semester: record.semester,
                    preferredPlayTimeId: record.preferredPlayTimeId,
                    cover: record.cover,
                    musicPlatform: record.musicPlatform,
                    musicId: record.musicId
                  }
                  
                  if (mode === 'merge') {
                    await tx.song.upsert({
                      where: { id: record.id },
                      update: songData,
                      create: { ...songData, id: record.id }
                    })
                  } else {
                    await tx.song.create({ data: songData })
                  }
                  break

                case 'playTimes':
                  if (mode === 'merge') {
                    await tx.playTime.upsert({
                      where: { id: record.id },
                      update: {
                        name: record.name,
                        startTime: record.startTime,
                        endTime: record.endTime,
                        enabled: record.enabled,
                        description: record.description
                      },
                      create: {
                        id: record.id,
                        name: record.name,
                        startTime: record.startTime,
                        endTime: record.endTime,
                        enabled: record.enabled,
                        description: record.description
                      }
                    })
                  } else {
                    await tx.playTime.create({
                      data: {
                        name: record.name,
                        startTime: record.startTime,
                        endTime: record.endTime,
                        enabled: record.enabled,
                        description: record.description
                      }
                    })
                  }
                  break

                case 'semesters':
                  if (mode === 'merge') {
                    await tx.semester.upsert({
                      where: { name: record.name },
                      update: {
                        isActive: record.isActive
                      },
                      create: {
                        name: record.name,
                        isActive: record.isActive
                      }
                    })
                  } else {
                    await tx.semester.create({
                      data: {
                        name: record.name,
                        isActive: record.isActive
                      }
                    })
                  }
                  break

                case 'systemSettings':
                  if (mode === 'merge') {
                    await tx.systemSettings.upsert({
                      where: { id: record.id },
                      update: {
                        enablePlayTimeSelection: record.enablePlayTimeSelection
                      },
                      create: {
                        id: record.id,
                        enablePlayTimeSelection: record.enablePlayTimeSelection
                      }
                    })
                  } else {
                    await tx.systemSettings.create({
                      data: {
                        enablePlayTimeSelection: record.enablePlayTimeSelection
                      }
                    })
                  }
                  break

                // 其他表的处理逻辑...
                default:
                  console.warn(`暂不支持恢复表: ${tableName}`)
                  continue
              }

              restoredCount++
            } catch (recordError) {
              console.error(`恢复记录失败 (${tableName}):`, recordError)
              restoreResults.details.errors.push(`${tableName}: ${recordError.message}`)
            }
          }

          console.log(`✅ ${tableName}: 恢复了 ${restoredCount}/${tableData.length} 条记录`)
          restoreResults.details.recordsRestored += restoredCount
          restoreResults.details.tablesProcessed++

        } catch (tableError) {
          console.error(`恢复表 ${tableName} 失败:`, tableError)
          restoreResults.details.errors.push(`表 ${tableName}: ${tableError.message}`)
        }
      }
    })

    console.log(`✅ 数据恢复完成`)
    console.log(`📊 处理了 ${restoreResults.details.tablesProcessed} 个表`)
    console.log(`📊 恢复了 ${restoreResults.details.recordsRestored} 条记录`)

    if (restoreResults.details.errors.length > 0) {
      console.warn(`⚠️ 发生了 ${restoreResults.details.errors.length} 个错误`)
      restoreResults.success = false
      restoreResults.message = '数据恢复完成，但存在错误'
    }

    return restoreResults

  } catch (error) {
    console.error('恢复数据库备份失败:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || '恢复数据库备份失败'
    })
  }
})
