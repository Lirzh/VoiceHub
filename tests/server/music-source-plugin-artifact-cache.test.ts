import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { artifactKey, cacheArtifact, readCachedArtifact, storeArtifact } from '../../server/utils/music-source-plugins/artifact-cache.ts'

const makeArtifact = (id, revision, hash = 'f'.repeat(64)) => ({
  id,
  revision,
  hash,
  source: 'var p = 1',
  protocol: 'musicfree',
  capability: { protocol: 'musicfree', name: 'Audiomack', sources: {}, search: true, lyric: false, variables: [] }
})

test('落盘失败不阻断，产物仍可从内存缓存取回', async () => {
  const item = makeArtifact(randomUUID(), 3)
  const warnings = []
  const warn = console.warn
  console.warn = (msg) => warnings.push(String(msg))
  try {
    await storeArtifact(item, () => Promise.reject(Object.assign(new Error('read-only file system'), { code: 'EROFS' })))
  } finally {
    console.warn = warn
  }
  assert.equal(readCachedArtifact(item)?.hash, item.hash)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /EROFS/)
})

test('可写文件系统照常落盘', async () => {
  const item = makeArtifact(randomUUID(), 1)
  const written = []
  await storeArtifact(item, async (a) => { written.push(a) })
  assert.deepEqual(written, [item])
  assert.equal(artifactKey(item), `${item.id}:1:${item.hash}`)
})

test('同一插件只保留最近两份产物', async () => {
  const id = randomUUID()
  for (const revision of [1, 2, 3]) cacheArtifact(makeArtifact(id, revision))
  assert.equal(readCachedArtifact(makeArtifact(id, 1)), null)
  assert.ok(readCachedArtifact(makeArtifact(id, 2)))
  assert.ok(readCachedArtifact(makeArtifact(id, 3)))
})

test('不同插件的缓存互不干扰', () => {
  const a = randomUUID()
  const b = randomUUID()
  cacheArtifact(makeArtifact(a, 1))
  cacheArtifact(makeArtifact(b, 7))
  assert.ok(readCachedArtifact(makeArtifact(a, 1)))
  assert.ok(readCachedArtifact(makeArtifact(b, 7)))
  assert.equal(readCachedArtifact(makeArtifact(a, 7)), null)
})
