import assert from 'node:assert/strict'
import test from 'node:test'
import { isSameSiteWrite } from '../../server/utils/request-utils.ts'

const DEV = { requestHost: 'pages-pro-26-cfa3.pages-scf-sg-pro.qcloudteo.com', protocol: 'http:' }

test('浏览器同源写操作不受反代改写 Host 影响', () => {
  assert.equal(
    isSameSiteWrite({
      ...DEV,
      secFetchSite: 'same-origin',
      origin: 'https://voicehub-dev.lirzh.top'
    }),
    true
  )
})

test('缺少 Fetch Metadata 时非跨站取值一律放行', () => {
  for (const secFetchSite of ['same-site', 'none', 'NONE']) {
    assert.equal(isSameSiteWrite({ ...DEV, secFetchSite, origin: 'https://voicehub-dev.lirzh.top' }), true)
  }
})

test('浏览器标记 cross-site 时拒绝', () => {
  assert.equal(isSameSiteWrite({ ...DEV, secFetchSite: 'cross-site' }), false)
  // 多级取值以第一段为准
  assert.equal(isSameSiteWrite({ ...DEV, secFetchSite: 'cross-site, same-origin' }), false)
})

test('无 Fetch Metadata 且 Origin 与可信域名不符时拒绝', () => {
  assert.equal(isSameSiteWrite({ ...DEV, origin: 'https://evil.example.com' }), false)
})

test('显式配置公开域名时以配置为准，忽略客户端可控的 Host 头', () => {
  const signals = {
    origin: 'https://voicehub.example.com',
    configuredHost: 'voicehub.example.com',
    requestHost: 'attacker.example.com',
    protocol: 'https:'
  }
  assert.equal(isSameSiteWrite(signals), true)
  assert.equal(isSameSiteWrite({ ...signals, origin: 'https://attacker.example.com' }), false)
})

test('无 Origin 头的非浏览器客户端保持放行', () => {
  assert.equal(isSameSiteWrite(DEV), true)
  assert.equal(isSameSiteWrite({ ...DEV, origin: '   ' }), true)
})

test('主机名相同但端口不同视为跨站', () => {
  assert.equal(
    isSameSiteWrite({
      origin: 'http://127.0.0.1:3000',
      configuredHost: 'http://127.0.0.1:4000',
      protocol: 'http:'
    }),
    false
  )
})

test('非法 Origin 或空可信域名按跨站处理', () => {
  assert.equal(isSameSiteWrite({ ...DEV, origin: 'not a url' }), false)
  assert.equal(isSameSiteWrite({ origin: 'https://voicehub.example.com', configuredHost: '', protocol: 'https:' }), false)
})
