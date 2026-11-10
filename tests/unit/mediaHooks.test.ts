import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { APIError } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ORIGINAL_NAME_CONTEXT_KEY,
  beforeMediaChange,
  beforeMediaOperation,
  type IncomingFile,
} from '../../src/hooks/media'
import { originalNameKey, storedOriginalName } from '../../src/lib/originalName'
import { deleteFolder } from '../../src/lib/r2'
import { MAX_UPLOAD_BYTES } from '../../src/lib/uploadRules'

// R2 is replaced by a mock. Each test checks what the hook asked it to delete.
vi.mock('../../src/lib/r2', () => ({ deleteFolder: vi.fn(async () => {}) }))
const deleteFolderMock = vi.mocked(deleteFolder)

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48])
const NOT_PNG = Buffer.from('plain text, not a png')

type OperationArgs = Parameters<typeof beforeMediaOperation>[0]
type ChangeArgs = Parameters<typeof beforeMediaChange>[0]

// A fake request: a Map-backed key-value store, a logger, and the incoming file.
function fakeReq(file?: Partial<IncomingFile>, kv = new Map<string, unknown>()) {
  const store = {
    get: vi.fn(async (key: string) => (kv.has(key) ? kv.get(key) : null)),
    delete: vi.fn(async (key: string) => void kv.delete(key)),
  }
  const logger = { error: vi.fn() }
  const req = {
    file: file && { name: 'a.png', mimetype: 'image/png', size: 0, data: PNG, ...file },
    context: {} as Record<string, unknown>,
    payload: { kv: store, logger },
  }
  return { req, kv, store, logger }
}

function runOperation(req: unknown, operation = 'create') {
  return beforeMediaOperation({ req, operation } as unknown as OperationArgs)
}

async function rejection(req: unknown): Promise<APIError> {
  const error = await Promise.resolve(runOperation(req)).then(
    () => null,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(APIError)
  return error as APIError
}

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'media-hook-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
beforeEach(() => {
  deleteFolderMock.mockReset()
  deleteFolderMock.mockResolvedValue(undefined)
})

// A direct upload: Payload has read the R2 object into a temp file, and data is empty.
async function directUpload(content: Buffer, name = 'a.png') {
  const tempFilePath = path.join(dir, `${Math.random()}.bin`)
  await writeFile(tempFilePath, content)
  return {
    name,
    data: Buffer.alloc(0),
    tempFilePath,
    clientUploadContext: { prefix: '', _objectKey: 'folder-uuid' },
  }
}

describe('beforeMediaOperation: when it runs', () => {
  it('skips operations other than create and update', async () => {
    const { req } = fakeReq({ data: NOT_PNG })
    await expect(runOperation(req, 'delete')).resolves.toBeUndefined()
    await expect(runOperation(req, 'read')).resolves.toBeUndefined()
  })

  it('skips a write without a file', async () => {
    const { req } = fakeReq()
    await expect(runOperation(req, 'update')).resolves.toBeUndefined()
    expect(req.context).toEqual({})
  })

  it('checks a new file on update too', async () => {
    const { req } = fakeReq({ data: NOT_PNG })
    await expect(runOperation(req, 'update')).rejects.toBeInstanceOf(APIError)
  })
})

describe('beforeMediaOperation: server-side uploads', () => {
  it('accepts a valid file and keeps its cleaned name', async () => {
    const { req } = fakeReq({ name: 'C:\\pics\\photo?.png' })
    await runOperation(req)
    expect(req.context[ORIGINAL_NAME_CONTEXT_KEY]).toBe('photo?.png')
    expect(deleteFolderMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a type outside the allowlist', { mimetype: 'text/html', name: 'a.html' }, 'File type text/html is not allowed.'],
    ['a file over 5 MB', { data: Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]) }, 'File is larger than 5 MB.'],
    ['an extension that does not match', { name: 'a.jpg' }, 'File name must end with .png.'],
    ['content that does not match the type', { data: NOT_PNG }, 'File content does not match its type.'],
  ])('rejects %s with the reason as the message', async (_case, file, message) => {
    const { req } = fakeReq(file)
    const error = await rejection(req)

    expect(error.status).toBe(400)
    expect(error.message).toBe(message)
    expect(error.data).toEqual({ errors: [{ message, path: 'filename' }] })
    expect(error.isPublic).toBe(true)
    // Nothing was uploaded to R2 on this path, so nothing is deleted.
    expect(deleteFolderMock).not.toHaveBeenCalled()
  })
})

describe('beforeMediaOperation: direct uploads', () => {
  it('reads the temp file, takes the stored name and deletes the entry', async () => {
    const { req, kv, store } = fakeReq(await directUpload(PNG, 'browser test.png'))
    kv.set(originalNameKey('folder-uuid'), storedOriginalName('browser test?.png', Date.now()))

    await runOperation(req)

    expect(req.context[ORIGINAL_NAME_CONTEXT_KEY]).toBe('browser test?.png')
    expect(store.delete).toHaveBeenCalledWith(originalNameKey('folder-uuid'))
    expect(kv.size).toBe(0)
    expect(deleteFolderMock).not.toHaveBeenCalled()
  })

  it('rejects bad content, deletes the upload folder and the stored name', async () => {
    const file = await directUpload(NOT_PNG)
    file.clientUploadContext.prefix = 'media'
    const { req, kv } = fakeReq(file)
    kv.set(originalNameKey('folder-uuid'), storedOriginalName('a.png', Date.now()))

    const error = await rejection(req)

    expect(error.message).toBe('File content does not match its type.')
    expect(deleteFolderMock).toHaveBeenCalledWith('media/folder-uuid')
    expect(kv.size).toBe(0)
  })

  it('deletes a folder without a prefix by its UUID alone', async () => {
    const { req } = fakeReq(await directUpload(NOT_PNG))
    await rejection(req)
    expect(deleteFolderMock).toHaveBeenCalledWith('folder-uuid')
  })

  it('measures the size from the temp file, not from the declared size', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)])
    const { req } = fakeReq({ ...(await directUpload(big)), size: 10 })
    const error = await rejection(req)
    expect(error.message).toBe('File is larger than 5 MB.')
  })

  it('still returns the validation error when the R2 cleanup fails', async () => {
    deleteFolderMock.mockRejectedValueOnce(new Error('R2 down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { req } = fakeReq(await directUpload(NOT_PNG))

    const error = await rejection(req)

    expect(error.message).toBe('File content does not match its type.')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('falls back to the file name when no name was stored', async () => {
    const { req } = fakeReq(await directUpload(PNG, 'browser test.png'))
    await runOperation(req)
    expect(req.context[ORIGINAL_NAME_CONTEXT_KEY]).toBe('browser test.png')
  })

  it('ignores an expired stored name and still deletes it', async () => {
    const { req, kv } = fakeReq(await directUpload(PNG, 'b.png'))
    kv.set(originalNameKey('folder-uuid'), storedOriginalName('old?.png', Date.now() - 7 * 3600_000))

    await runOperation(req)

    expect(req.context[ORIGINAL_NAME_CONTEXT_KEY]).toBe('b.png')
    expect(kv.size).toBe(0)
  })

  it('falls back to the file name when the store fails', async () => {
    const { req, store, logger } = fakeReq(await directUpload(PNG, 'b.png'))
    store.get.mockRejectedValueOnce(new Error('db down'))

    await runOperation(req)

    expect(req.context[ORIGINAL_NAME_CONTEXT_KEY]).toBe('b.png')
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('does not read the store for a server-side upload', async () => {
    const { req, store } = fakeReq({ name: 'a.png' })
    await runOperation(req)
    expect(store.get).not.toHaveBeenCalled()
  })
})

describe('beforeMediaChange', () => {
  function runChange(operation: string, context: Record<string, unknown>) {
    const data = { originalName: 'sent by the client.png' }
    return beforeMediaChange({ data, req: { context }, operation } as unknown as ChangeArgs)
  }

  it('sets originalName from the server on create', () => {
    const data = runChange('create', { [ORIGINAL_NAME_CONTEXT_KEY]: 'a?.png' })
    expect(data.originalName).toBe('a?.png')
  })

  it('leaves originalName alone on update', () => {
    const data = runChange('update', { [ORIGINAL_NAME_CONTEXT_KEY]: 'a?.png' })
    expect(data.originalName).toBe('sent by the client.png')
  })

  it('does nothing without a name from the operation hook', () => {
    expect(runChange('create', {}).originalName).toBe('sent by the client.png')
    expect(runChange('create', { [ORIGINAL_NAME_CONTEXT_KEY]: null }).originalName).toBe(
      'sent by the client.png',
    )
  })
})
