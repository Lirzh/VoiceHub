import { db } from '~/drizzle/db'
import { playTimes, schedules, songs, users, votes, songReplayRequests } from '~/drizzle/schema'
import { and, asc, count, desc, eq, gte, lte, ne } from 'drizzle-orm'
import { createSongSelectedNotification } from '../../services/notificationService'
import { cacheService } from '~~/server/services/cacheService'
import { redeemCardCodeForSchedule } from '~~/server/services/cardCodeLifecycleService'
import { getServerDate } from '~~/server/utils/serverTime'

export default defineEventHandler(async (event) => {
  // 检查用户认证和权限
  const user = event.context.user

  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权访问'
    })
  }

  if (!['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '只有歌曲管理员及以上权限才能创建排期'
    })
  }

  const body = await readBody(event)

  if (!body.songId || !body.playDate) {
    throw createError({
      statusCode: 400,
      message: '歌曲ID和播放日期不能为空'
    })
  }

  // 检查是否为草稿模式（默认直接发布）
  const isDraft = body.isDraft === true

  try {
    // 检查歌曲是否存在
    const songResult = await db.select().from(songs).where(eq(songs.id, body.songId)).limit(1)

    const song = songResult[0]

    if (!song) {
      throw createError({
        statusCode: 404,
        message: '歌曲不存在'
      })
    }

    // 保存创建的排期，供 transaction 外部的响应使用
    // 注意：schedule 的实际值必须在事务内部设置，避免 ReferenceError
    let createdSchedule: any = null

    await db.transaction(async (tx) => {
      // 获取序号，如果未提供则查找当天最大序号+1
      // 使用 .for('update') 行锁：防止多个并发请求拿到相同的序号
      let sequence = body.sequence || 1

      if (!body.sequence) {
        const inputDateStr =
          typeof body.playDate === 'string' ? body.playDate : body.playDate.toISOString()

        const startOfDay = new Date(inputDateStr + 'T00:00:00.000Z')
        const endOfDay = new Date(inputDateStr + 'T23:59:59.999Z')

        const sameDaySchedules = await tx
          .select()
          .from(schedules)
          .where(and(gte(schedules.playDate, startOfDay), lte(schedules.playDate, endOfDay)))
          .for('update')
          .orderBy(desc(schedules.sequence))
          .limit(1)

        if (sameDaySchedules.length > 0) {
          sequence = (sameDaySchedules[0].sequence || 0) + 1
        }
      }

      // 解析输入的日期字符串，确保日期正确
      const inputDateStr =
        typeof body.playDate === 'string' ? body.playDate : body.playDate.toISOString()

      // 直接使用输入的日期字符串，添加时间部分以避免时区问题
      const playDate = new Date(inputDateStr + 'T00:00:00.000Z')

      // 创建排期
      const scheduleResult = await tx
        .insert(schedules)
        .values({
          songId: body.songId,
          playDate: playDate,
          sequence: sequence,
          playTimeId: body.playTimeId || null,
          isDraft: isDraft,
          publishedAt: isDraft ? null : getServerDate()
        })
        .returning()

      // 捕获在 tx 外用于响应的引用
      createdSchedule = {
        ...scheduleResult[0],
        song: {
          id: song.id,
          title: song.title,
          artist: song.artist,
          requesterId: song.requesterId,
          cardCodeId: song.cardCodeId
        }
      }

      // 只有在非草稿模式下才创建通知和更新重播状态
      if (!isDraft) {
        // 检查该歌曲是否已经有其他已发布的排期
        const existingPublished = await tx
          .select({ id: schedules.id })
          .from(schedules)
          .where(
            and(
              eq(schedules.songId, createdSchedule.song.id),
              eq(schedules.isDraft, false),
              ne(schedules.id, scheduleResult[0].id)
            )
          )
          .limit(1)

        if (existingPublished.length === 0) {
          await createSongSelectedNotification(
            createdSchedule.song.requesterId,
            createdSchedule.song.id,
            {
              title: createdSchedule.song.title,
              artist: createdSchedule.song.artist,
              playDate: createdSchedule.playDate
            }
          )

          await tx
            .update(songReplayRequests)
            .set({ status: 'FULFILLED', updatedAt: scheduleResult[0].publishedAt || getServerDate() })
            .where(
              and(
                eq(songReplayRequests.songId, createdSchedule.song.id),
                eq(songReplayRequests.status, 'PENDING')
              )
            )
        } else {
          console.log(`歌曲 ${createdSchedule.song.id} 已有其他正式排期，不再重复发送通知或更新重播状态`)
        }
        await redeemCardCodeForSchedule(tx, {
          songId: createdSchedule.song.id,
          cardCodeId: createdSchedule.song.cardCodeId,
          operatorId: user.id,
          at: scheduleResult[0].publishedAt || getServerDate()
        })
      }
    })

    // 清除相关缓存
    try {
      await cacheService.clearSchedulesCache()
      await cacheService.clearSongsCache()
      console.log(`[Cache] 排期缓存和歌曲列表缓存已清除（${isDraft ? '保存草稿' : '创建排期'}）`)
    } catch (cacheError) {
      console.error('[Cache] 清除缓存失败:', cacheError)
    }

    // 重新缓存完整的排期列表
    try {
      const schedulesData = await db
        .select({
          id: schedules.id,
          playDate: schedules.playDate,
          sequence: schedules.sequence,
          played: schedules.played,
          playTimeId: schedules.playTimeId,
          songId: schedules.songId,
          songTitle: songs.title,
          songArtist: songs.artist,
          songRequesterId: songs.requesterId,
          songPlayed: songs.played,
          songCover: songs.cover,
          songMusicPlatform: songs.musicPlatform,
          songMusicId: songs.musicId,
          songPlayUrl: songs.playUrl,
          songSemester: songs.semester,
          requesterName: users.name,
          requesterGrade: users.grade,
          requesterClass: users.class,
          playTimeName: playTimes.name,
          playTimeStartTime: playTimes.startTime,
          playTimeEndTime: playTimes.endTime,
          playTimeEnabled: playTimes.enabled
        })
        .from(schedules)
        .innerJoin(songs, eq(schedules.songId, songs.id))
        .innerJoin(users, eq(songs.requesterId, users.id))
        .leftJoin(playTimes, eq(schedules.playTimeId, playTimes.id))
        .where(eq(schedules.isDraft, false))
        .orderBy(asc(schedules.playDate))

      const allUsers = await db
        .select({
          id: users.id,
          name: users.name,
          grade: users.grade,
          class: users.class
        })
        .from(users)

      const nameToUsers = new Map()
      allUsers.forEach((u) => {
        if (u.name) {
          if (!nameToUsers.has(u.name)) nameToUsers.set(u.name, [])
          nameToUsers.get(u.name).push(u)
        }
      })

      const songIds = schedulesData.map((s) => s.songId)
      const voteCounts = await Promise.all(
        songIds.map(async (songId) => {
          const voteCountResult = await db
            .select({ count: count() })
            .from(votes)
            .where(eq(votes.songId, songId))
          return { songId, count: voteCountResult[0].count }
        })
      )
      const voteCountMap = new Map(voteCounts.map((v) => [v.songId, v.count]))

      const formattedSchedules = schedulesData.map((sch) => {
        const dateOnly = sch.playDate
        let requesterName = sch.requesterName || '未知用户'

        const sameNameUsers = nameToUsers.get(requesterName)
        if (sameNameUsers && sameNameUsers.length > 1) {
          if (sch.requesterGrade) {
            const sameGradeUsers = sameNameUsers.filter(
              (u: { id: number; name: string | null; grade: string | null; class: string | null }) =>
                u.grade === sch.requesterGrade
            )
            if (sameGradeUsers.length > 1 && sch.requesterClass) {
              requesterName = `${requesterName}（${sch.requesterGrade} ${sch.requesterClass}）`
            } else {
              requesterName = `${requesterName}（${sch.requesterGrade}）`
            }
          }
        }

        return {
          id: sch.id,
          playDate: dateOnly.toISOString().split('T')[0],
          sequence: sch.sequence || 1,
          played: sch.played || false,
          playTimeId: sch.playTimeId,
          playTime: sch.playTimeName
            ? {
                id: sch.playTimeId,
                name: sch.playTimeName,
                startTime: sch.playTimeStartTime,
                endTime: sch.playTimeEndTime,
                enabled: sch.playTimeEnabled
              }
            : null,
          song: {
            id: sch.songId,
            title: sch.songTitle,
            artist: sch.songArtist,
            requester: requesterName,
            voteCount: voteCountMap.get(sch.songId) || 0,
            played: sch.songPlayed || false,
            cover: sch.songCover || null,
            musicPlatform: sch.songMusicPlatform || null,
            musicId: sch.songMusicId || null,
            playUrl: sch.songPlayUrl || null,
            semester: sch.songSemester || null
          }
        }
      })

      if (formattedSchedules && formattedSchedules.length > 0) {
        await cacheService.setSchedulesList(formattedSchedules)
        console.log(`[Cache] 完整排期列表已重新缓存，数量: ${formattedSchedules.length}`)
      } else {
        console.log('[Cache] 没有排期数据需要缓存')
      }
    } catch (cacheError) {
      console.warn('[Cache] 重新缓存完整排期列表失败，但不影响排期创建:', cacheError)
    }

    return {
      ...createdSchedule,
      isDraft: isDraft,
      publishedAt: isDraft ? null : createdSchedule.publishedAt,
      message: isDraft ? '排期草稿保存成功' : '排期创建成功，通知已发送'
    }
  } catch (error: any) {
    console.error('创建排期失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '创建排期失败'
    })
  }
})
