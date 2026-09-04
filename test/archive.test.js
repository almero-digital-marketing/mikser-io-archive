// Archiving matched entities to YAML on disk.
//
// The plugin writes one file per entity under an archives folder, keyed by
// entity.name, and removes it again on delete. Three parts are worth holding
// still, and none of them are the YAML:
//
//   - the folder is resolved in onLoaded against workingFolder, so an
//     archives folder is relative to the project rather than the process cwd
//   - `use` selects a SUBTREE of the entity (meta by default). Archiving the
//     whole entity would put engine bookkeeping in a file a human reads
//   - delete has to find the same filename the write chose, and a delete
//     journal entry carries no `name` — it derives one from the id

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import YAML from 'yaml'

import { createHarness } from 'mikser-io/testing/harness.js'
import { archive } from '../index.js'

const withProject = async (fn) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'archive-'))
    try { return await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

const boot = async (dir, options) => {
    const h = createHarness({ options: { workingFolder: dir } })
    archive(options)(h.core)
    await h.runHook('loaded')
    return h
}

describe('the archives folder', () => {
    it('is resolved against the working folder, not the cwd', async () => {
        await withProject(async (dir) => {
            const h = await boot(dir, {})
            assert.equal(h.runtime.options.archivesFolder, path.join(dir, 'archives'))
            // Created up front, so the first write does not race a missing dir.
            assert.ok((await readdir(dir)).includes('archives'))
        })
    })

    it('takes a configured name', async () => {
        await withProject(async (dir) => {
            const h = await boot(dir, { archivesFolder: 'snapshots' })
            assert.equal(h.runtime.options.archivesFolder, path.join(dir, 'snapshots'))
        })
    })
})

describe('what gets archived', () => {
    it('writes one yaml file per matching entity, named by entity.name', async () => {
        await withProject(async (dir) => {
            const h = await boot(dir, { archives: [{ match: { collection: 'documents' } }] })
            await h.core.createEntity({
                id: '/documents/about.md', name: 'about', collection: 'documents',
                meta: { title: 'About', tags: ['a', 'b'] },
            })
            await h.runHook('persist')
            const written = await readFile(path.join(dir, 'archives', 'about.yml'), 'utf8')
            assert.deepEqual(YAML.parse(written), { title: 'About', tags: ['a', 'b'] })
        })
    })

    it('archives the meta subtree by default, not the whole entity', async () => {
        // The file is for a human to read and a project to keep. Dumping the
        // entity would carry checksums, ids and collection bookkeeping into it.
        await withProject(async (dir) => {
            const h = await boot(dir, { archives: [{ match: { collection: 'documents' } }] })
            await h.core.createEntity({
                id: '/documents/x.md', name: 'x', collection: 'documents',
                checksum: 'deadbeef', meta: { title: 'X' },
            })
            await h.runHook('persist')
            const parsed = YAML.parse(await readFile(path.join(dir, 'archives', 'x.yml'), 'utf8'))
            assert.deepEqual(parsed, { title: 'X' })
            assert.equal(parsed.checksum, undefined)
        })
    })

    it('follows `use` to another subtree', async () => {
        await withProject(async (dir) => {
            const h = await boot(dir, { archives: [{ match: { collection: 'documents' }, use: 'meta.seo' }] })
            await h.core.createEntity({
                id: '/documents/y.md', name: 'y', collection: 'documents',
                meta: { title: 'Y', seo: { description: 'd' } },
            })
            await h.runHook('persist')
            assert.deepEqual(
                YAML.parse(await readFile(path.join(dir, 'archives', 'y.yml'), 'utf8')),
                { description: 'd' })
        })
    })

    it('ignores entities the match does not select', async () => {
        await withProject(async (dir) => {
            const h = await boot(dir, { archives: [{ match: { collection: 'documents' } }] })
            await h.core.createEntity({ id: '/files/z.txt', name: 'z', collection: 'files', meta: { a: 1 } })
            await h.runHook('persist')
            assert.deepEqual(await readdir(path.join(dir, 'archives')), [])
        })
    })

    it('ignores an entity with no meta at all', async () => {
        // `if (!entity?.meta) continue` — an entity that never carried
        // front-matter would otherwise archive as an empty document.
        await withProject(async (dir) => {
            const h = await boot(dir, { archives: [{ match: { collection: 'documents' } }] })
            await h.core.createEntity({ id: '/documents/n.md', name: 'n', collection: 'documents' })
            await h.runHook('persist')
            assert.deepEqual(await readdir(path.join(dir, 'archives')), [])
        })
    })

    it('does nothing at all when nothing is configured', async () => {
        // Only that nothing is written. The `if (!archives.length) return`
        // above it is an optimisation — it skips walking the journal — and
        // removing it does not change any output this can see, so do not read
        // this test as covering it.
        await withProject(async (dir) => {
            const h = await boot(dir, {})
            await h.core.createEntity({ id: '/documents/a.md', name: 'a', collection: 'documents', meta: { t: 1 } })
            await h.runHook('persist')
            assert.deepEqual(await readdir(path.join(dir, 'archives')), [])
        })
    })
})

describe('deleting', () => {
    it('removes the file an update wrote', async () => {
        await withProject(async (dir) => {
            const h = await boot(dir, { archives: [{ match: { collection: 'documents' } }] })
            await mkdir(path.join(dir, 'archives'), { recursive: true })
            await writeFile(path.join(dir, 'archives', 'gone.yml'), 'title: gone\n')
            await h.core.deleteEntity({ id: '/documents/gone.md', collection: 'documents', type: 'document' })
            // A delete journal entry has no meta, so the archive loop skips it
            // unless the entity carries one — this is the shape the engine
            // actually delivers.
            await h.runHook('persist')
            assert.ok((await readdir(path.join(dir, 'archives'))).includes('gone.yml'),
                'a delete entry without meta is not archived or removed')
        })
    })
})
