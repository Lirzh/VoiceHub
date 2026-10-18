import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginArtifact } from './types'

const artifactRoot = join(process.cwd(), '.data', 'music-source-plugins')

/** 每个插件在内存里保留的产物份数；落盘只是缓存，只读文件系统时靠它撑住当前进程 */
const KEEP_PER_PLUGIN = 2

export type ArtifactPointer = Pick<PluginArtifact, 'id' | 'revision' | 'hash'>

const memoryArtifacts = new Map<string, PluginArtifact>()

export const artifactKey = (pointer: ArtifactPointer) => `${pointer.id}:${pointer.revision}:${pointer.hash}`
export const artifactFile = (pointer: ArtifactPointer) =>
  join(artifactRoot, `${pointer.id}-${pointer.revision}-${pointer.hash}.json`)

/** 写入前先淘汰同一插件最旧的多余条目，Map 保持插入顺序 */
export function cacheArtifact(artifact: PluginArtifact): void {
  memoryArtifacts.set(artifactKey(artifact), artifact)
  const stale = [...memoryArtifacts.keys()].filter((key) => key.startsWith(`${artifact.id}:`))
  for (const key of stale.slice(0, stale.length - KEEP_PER_PLUGIN)) memoryArtifacts.delete(key)
}

export function readCachedArtifact(pointer: ArtifactPointer): PluginArtifact | null {
  return memoryArtifacts.get(artifactKey(pointer)) || null
}

async function writeArtifactFile(artifact: PluginArtifact): Promise<void> {
  await mkdir(artifactRoot, { recursive: true })
  const target = artifactFile(artifact)
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(artifact), { mode: 0o600 })
  await rename(temporary, target)
}

/**
 * 保存插件产物：内存缓存始终写入，落盘失败不视为加载失败。
 * serverless / EdgeOne 等只读文件系统下（EROFS/EPERM/EACCES），产物可由 scriptUrl
 * 重新下载得到，仅保留内存缓存即可让当前实例正常工作，冷启动后按需重建。
 */
export async function storeArtifact(
  artifact: PluginArtifact,
  write: (artifact: PluginArtifact) => Promise<void> = writeArtifactFile
): Promise<void> {
  cacheArtifact(artifact)
  try {
    await write(artifact)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code || String((error as Error)?.message || error)
    console.warn(`[插件音源] 产物 ${artifactKey(artifact)} 落盘失败，仅保留内存缓存：${code}`)
  }
}
