# mikser-io-archive

Archive plugin for [Mikser](https://github.com/almero-digital-marketing/mikser-io). Persists matching entities to YAML files in a configurable archives folder, keeping snapshots in sync on create, update, and delete.

## Install

```bash
npm install mikser-io-archive
```

## Usage

```js
// mikser.config.js
export default {
  plugins: ['archive'],
  archives: {
    archivesFolder: 'archives'
  },
  archive: {
    archives: [
      { match: { collection: 'pages' }, use: 'meta' }
    ]
  }
}
```

Each entry in `archive.archives` selects entities via `match` and dumps the slice at `use` (default `meta`) to `<archivesFolder>/<entity.name>.yml`. `match` accepts:

- an **object** — partial match against the entity (lodash `isMatch`)
- a **string** — glob against `entity.id`, or `@/<glob>` to match against `entity.name`
- a **function** — `(entity) => boolean`

## License

ISC
