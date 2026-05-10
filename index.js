import _ from 'lodash'
import path from 'path'
import { mkdir, writeFile, unlink } from 'fs/promises'
import YAML from 'yaml'

export default ({
    runtime,
    onLoaded,
    onPersist,
    useLogger,
    useJournal,
    matchEntity,
    normalize,
    constants: { OPERATION },
}) => {
    async function saveEntity(entity, use) {
        const entityFile = path.join(runtime.options.archivesFolder, `${entity.name}.yml`)
        const normalized = normalize(_.get(entity, use))
        const entityDump = YAML.stringify(normalized)

        await mkdir(path.dirname(entityFile), { recursive: true })
        await writeFile(entityFile, entityDump, 'utf8')
    }

    async function deleteEntity(entity) {
        const entityName = entity.name || entity.id.replace(`/${entity.collection}`, '').replace(path.extname(entity.id), '')
        const entityFile = path.join(runtime.options.archivesFolder, `${entityName}.yml`)
        await unlink(entityFile)
    }

    onLoaded(async () => {
        const logger = useLogger()
        runtime.options.archives = runtime.config.archives?.archivesFolder || 'archives'
        runtime.options.archivesFolder = path.join(runtime.options.workingFolder, runtime.options.archives)

        logger.info('Archives folder: %s', runtime.options.archivesFolder)
        await mkdir(runtime.options.archivesFolder, { recursive: true })
    })

    onPersist(async (signal) => {
        const logger = useLogger()
        const archives = runtime.config.archive?.archives || []
        if (!archives.length) return

        for await (let { entity, operation } of useJournal('Archive', [OPERATION.CREATE, OPERATION.UPDATE, OPERATION.DELETE], signal)) {
            if (!entity?.meta) continue

            for (let { match, use = 'meta' } of archives) {
                if (!matchEntity(entity, match)) continue

                switch (operation) {
                    case OPERATION.CREATE:
                    case OPERATION.UPDATE:
                        logger.trace('Archive %s %s: %s', entity.collection, operation, entity.id)
                        await saveEntity(entity, use)
                        break
                    case OPERATION.DELETE:
                        logger.trace('Archive %s %s: %s', entity.collection, operation, entity.id)
                        await deleteEntity(entity)
                        break
                }
            }
        }
    })
}
