import type { Config, PayloadHandler, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { ORIGINAL_NAME_TTL_MS, originalNameKey } from '../../src/lib/originalName'
import { rememberOriginalNames } from '../../src/plugins/rememberOriginalNames'

const PATH = '/storage-s3-generate-signed-url'

// A stand-in for the storage plugin's handler: reads the body once, like the real one.
function signingHandler(response: () => Response) {
  return vi.fn<PayloadHandler>(async (req) => {
    await req.json!()
    return response()
  })
}

function signed(objectKey: unknown = 'folder-uuid') {
  return () =>
    Response.json({ clientUploadContext: { _objectKey: objectKey }, filename: 'a.png', url: 'u' })
}

function setup(handler: PayloadHandler, kvSet = vi.fn(async () => {})) {
  const config = rememberOriginalNames({
    endpoints: [{ path: PATH, method: 'post', handler }],
  } as unknown as Config)
  const wrapped = config.endpoints![0]!.handler
  const logger = { error: vi.fn() }

  async function call(body: unknown) {
    const json = vi.fn(async () => body)
    const req = { json, payload: { kv: { set: kvSet }, logger } } as unknown as PayloadRequest
    const response = await wrapped(req)
    return { response, json }
  }
  return { call, kvSet, logger }
}

describe('rememberOriginalNames', () => {
  it('stores the cleaned name under the signed upload folder', async () => {
    const now = Date.now()
    const { call, kvSet } = setup(signingHandler(signed()))
    await call({ filename: 'C:\\pics\\browser test?.png' })

    expect(kvSet).toHaveBeenCalledTimes(1)
    const [key, value] = kvSet.mock.calls[0] as unknown as [string, { name: string; expiresAt: number }]
    expect(key).toBe(originalNameKey('folder-uuid'))
    expect(value.name).toBe('browser test?.png')
    expect(value.expiresAt).toBeGreaterThanOrEqual(now + ORIGINAL_NAME_TTL_MS)
  })

  it('reads the request body once and gives the plugin the same body', async () => {
    const handler = signingHandler(signed())
    const { call } = setup(handler)
    const { json } = await call({ filename: 'a.png' })

    expect(json).toHaveBeenCalledTimes(1)
    const seen = await handler.mock.calls[0]![0].json!()
    expect(seen).toEqual({ filename: 'a.png' })
  })

  it('returns the plugin response unchanged and still readable', async () => {
    const { call } = setup(signingHandler(signed()))
    const { response } = await call({ filename: 'a.png' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ url: 'u', filename: 'a.png' })
  })

  it('stores nothing when the plugin refuses the request', async () => {
    const { call, kvSet } = setup(
      signingHandler(() => Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 })),
    )
    const { response } = await call({ filename: 'a.png' })

    expect(response.status).toBe(403)
    expect(kvSet).not.toHaveBeenCalled()
  })

  it('stores nothing without a usable name or folder', async () => {
    const { call, kvSet } = setup(signingHandler(signed()))
    await call({ filename: '   ' })
    await call(null)

    const noFolder = setup(signingHandler(signed(42)))
    await noFolder.call({ filename: 'a.png' })

    expect(kvSet).not.toHaveBeenCalled()
    expect(noFolder.kvSet).not.toHaveBeenCalled()
  })

  it('does not fail the upload when the store fails', async () => {
    const kvSet = vi.fn(async () => {
      throw new Error('db down')
    })
    const { call, logger } = setup(signingHandler(signed()), kvSet)
    const { response } = await call({ filename: 'a.png' })

    expect(response.status).toBe(200)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('passes a request without a JSON body straight to the plugin', async () => {
    const handler = vi.fn<PayloadHandler>(async () => new Response('bad', { status: 400 }))
    const config = rememberOriginalNames({
      endpoints: [{ path: PATH, method: 'post', handler }],
    } as unknown as Config)
    const req = { payload: {} } as unknown as PayloadRequest
    const response = await config.endpoints![0]!.handler(req)

    expect(response.status).toBe(400)
    expect(handler).toHaveBeenCalledWith(req)
  })

  it('fails at startup when the storage plugin endpoint is missing', () => {
    expect(() => rememberOriginalNames({} as Config)).toThrow(/storage-s3-generate-signed-url/)
    expect(() =>
      rememberOriginalNames({
        endpoints: [{ path: PATH, method: 'get', handler: vi.fn() }],
      } as unknown as Config),
    ).toThrow()
  })
})
