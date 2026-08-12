import { defineEventHandler } from 'h3'
import { and, count, db, eq, exists, schedules, semesters, songs, votes } from '~/drizzle/db'
import { createApiError } from '~~/server/utils/apiError'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createApiError(403, 'ADMIN_PERMISSION_DENIED', '需要管理员权限')
  }

  try {
    // 获取所有学期
    const semesterList = await db.select().from(semesters).orderBy(semesters.createdAt)

    // 获取每个学期的统计数据
    const semesterStats = await Promise.all(
      semesterList.map(async (semester) => {
        // 统计该学期的歌曲数量
        const totalSongsResult = await db
          .select({ count: count() })
          .from(songs)
          .where(eq(songs.semester, semester.name))

        // 统计该学期的排期数量（通过关联歌曲）
        const totalSchedulesResult = await db
          .select({ count: count() })
          .from(schedules)
          .innerJoin(songs, eq(schedules.songId, songs.id))
          .where(eq(songs.semester, semester.name))

        // 统计该学期有投票的歌曲数量
        const totalRequestsResult = await db
          .select({ count: count() })
          .from(songs)
          .where(
            and(
              eq(songs.semester, semester.name),
              exists(db.select().from(votes).where(eq(votes.songId, songs.id)))
            )
          )

        const [totalSongs, totalSchedules, totalRequests] = [
          totalSongsResult[0]?.count || 0,
          totalSchedulesResult[0]?.count || 0,
          totalRequestsResult[0]?.count || 0
        ]

        return {
          semester: semester.name,
          totalSongs,
          totalSchedules,
          totalRequests,
          isActive: semester.isActive
        }
      })
    )

    return semesterStats
  } catch (error) {
    console.error('获取学期对比数据失败:', error)
    throw createApiError(500, 'ADMIN_STATS_FAILED', '获取学期对比数据失败')
  }
})
