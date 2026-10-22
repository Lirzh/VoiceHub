import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ALLOWED_BACKUP_FILENAME_PREFIXES, isAllowedBackupFilename } from '../../server/utils/backup-filename.ts'

// 备份产出侧的全部文件名前缀（结构性提取，新增 filePrefix 若未登记会被本用例拦下）
const exportSource = readFileSync(
  new URL('../../server/api/admin/backup/export.post.ts', import.meta.url),
  'utf8'
)
const producedPrefixes = [
  ...new Set(
    exportSource
      .split('\n')
      .filter((line) => line.includes('filePrefix ='))
      .flatMap((line) => [...line.matchAll(/'([a-z-]+)'/g)].map((match) => `${match[1]}-`))
  ),
  'uploaded-'
]

test('备份产出侧的每个前缀都可下载（白名单与命名保持同步）', () => {
  assert.ok(producedPrefixes.length >= 6, `应至少覆盖 6 个前缀，实际 ${producedPrefixes.length}`)

  for (const prefix of producedPrefixes) {
    const filename = `${prefix}2026-10-22T00-00-00-000Z.json`
    assert.equal(
      isAllowedBackupFilename(filename),
      true,
      `${prefix} 是 export/upload 实际产出的备份名，必须留在下载白名单内`
    )
  }
})

test('白名单只收录备份产出前缀', () => {
  assert.deepEqual([...ALLOWED_BACKUP_FILENAME_PREFIXES].sort(), [...producedPrefixes].sort())
})

test('拒绝非备份文件与路径遍历', () => {
  const rejected = [
    'notes.json',
    'database-backup-2026-10-22.txt',
    '../database-backup-2026-10-22.json',
    'sub/database-backup-2026-10-22.json',
    'database-backup-2026-10-22.json/../../etc/passwd',
    'database-backup-.json\0.txt',
    '',
    `database-backup-${'x'.repeat(300)}.json`,
    undefined,
    null,
    123
  ]

  for (const filename of rejected) {
    assert.equal(isAllowedBackupFilename(filename), false, `${String(filename)} 必须被拒绝`)
  }
})
