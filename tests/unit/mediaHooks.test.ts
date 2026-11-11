import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { APIError } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { beforeMediaOperation, type IncomingFile } from '../../src/hooks/media'
import { deleteFolder } from '../../src/lib/r2'
import { MAX_UPLOAD_BYTES } from '../../src/lib/uploadRules'

// R2 is replaced by a mock. Each test checks what the hook asked it to delete.
vi.mock('../../src/lib/r2', () => ({ deleteFolder: vi.fn(async () => {}) }))
const deleteFolderMock = vi.mocked(deleteFolder)

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48])
const NOT_PNG = Buffer.from('plain text, not a png')

type OperationArgs = Parameters<typeof beforeMediaOperation>[0]

function fakeReq(file?: Partial<IncomingFile>) {
  const logger = { error: vi.fn() }
  const req = {
    file: file && { name: 'a.png', mimetype: 'image/png', size: 0, data: PNG, ...file },
    payload: { logger },
  }
  return { req, logger }
}

function run(req: unknown, operation = 'create') {
  return beforeMediaOperation({ req, operation } as unknown as OperationArgs)
}

async function rejection(req: unknown): Promise<APIError> {
  const error = await Promise.resolve(run(req)).then(
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
  it('skips operations other than create and update, and writes without a file', async () => {
    const { req } = fakeReq({ data: NOT_PNG })
    await expect(run(req, 'delete')).resolves.toBeUndefined()
    await expect(run(req, 'read')).resolves.toBeUndefined()
    await expect(run(fakeReq().req, 'update')).resolves.toBeUndefined()
  })

  it('checks a new file on update too', async () => {
    const { req } = fakeReq({ data: NOT_PNG })
    await expect(run(req, 'update')).rejects.toBeInstanceOf(APIError)
  })
})

describe('beforeMediaOperation: server-side uploads', () => {
  it('accepts a valid file', async () => {
    const { req } = fakeReq()
    await expect(run(req)).resolves.toBeUndefined()
    expect(deleteFolderMock).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a type outside the allowlist',
      { mimetype: 'text/html', name: 'a.html' },
      'File type text/html is not allowed.',
    ],
    [
      'a file over 5 MB',
      { data: Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]) },
      'File is larger than 5 MB.',
    ],
    ['an extension that does not match', { name: 'a.jpg' }, 'File name must end with .png.'],
    [
      'content that does not match the type',
      { data: NOT_PNG },
      'File content does not match its type.',
    ],
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
  it('reads the temp file and accepts a valid upload', async () => {
    const { req } = fakeReq(await directUpload(PNG))
    await expect(run(req)).resolves.toBeUndefined()
    expect(deleteFolderMock).not.toHaveBeenCalled()
  })

  it('rejects bad content and deletes the upload folder, with and without a prefix', async () => {
    const prefixed = await directUpload(NOT_PNG)
    prefixed.clientUploadContext.prefix = 'media'
    const error = await rejection(fakeReq(prefixed).req)
    expect(error.message).toBe('File content does not match its type.')
    expect(deleteFolderMock).toHaveBeenCalledWith('media/folder-uuid')

    await rejection(fakeReq(await directUpload(NOT_PNG)).req)
    expect(deleteFolderMock).toHaveBeenLastCalledWith('folder-uuid')
  })

  it('measures the size from the temp file, not from the declared size', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)])
    const { req } = fakeReq({ ...(await directUpload(big)), size: 10 })
    expect((await rejection(req)).message).toBe('File is larger than 5 MB.')
  })

  it('still returns the validation error when the R2 cleanup fails, and logs it', async () => {
    deleteFolderMock.mockRejectedValueOnce(new Error('R2 down'))
    const { req, logger } = fakeReq(await directUpload(NOT_PNG))

    const error = await rejection(req)

    expect(error.message).toBe('File content does not match its type.')
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
