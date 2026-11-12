import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { apiUpload } from '../api/client'

const MAX_MB = 50      // per file: the backend refuses a bigger file, so say so before uploading it
const MAX_FILES = 5   // per pick: every file is safe on its own, but hundreds would keep the user waiting for minutes

// one line per picked file, and how far it got
type Item = {
    file: File
    status: 'waiting' | 'importing' | 'done' | 'failed'
    result?: any     // the summary the backend sent back (done)
    error?: string   // why it failed (failed)
}

// quick checks before uploading, for a clear message without a round trip. The backend checks all of this again
function problem(file: File) {
    if (!file.name.toLowerCase().endsWith('.json')) return 'not a .json file'
    if (file.size === 0) return 'the file is empty'
    if (file.size > MAX_MB * 1024 * 1024) return `bigger than ${MAX_MB} MB`
    return ''
}

// what one line of the list says
function line({ file, status, result, error }: Item) {
    if (status === 'waiting') return `⏸ ${file.name}: waiting`
    if (status === 'importing') return `⏳ ${file.name}: importing...`
    if (status === 'failed') return `✘ ${file.name}: failed, ${error}`
    return `✔ ${file.name}: ${result.total_rows.toLocaleString()} rows, ${result.accepted.toLocaleString()} accepted, `
        + `${result.exact_duplicates.toLocaleString()} exact duplicates, ${result.conflicting_duplicates.toLocaleString()} conflicting, `
        + `${result.invalid.toLocaleString()} invalid, in ${result.run.duration_ms} ms`
}

const ImportButton = ({ onDone }: { onDone: () => void }) => {
    const [items, setItems] = useState<Item[]>([])
    const [importing, setImporting] = useState(false)
    const picker = useRef<HTMLInputElement>(null)

    // the user picked one or more files: every one starts as "waiting"
    function pick(e: ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? [])
        if (files.length > MAX_FILES) {
            alert(`Pick at most ${MAX_FILES} files at a time`)
            e.target.value = ''
            return setItems([])
        }
        setItems(files.map((file) => ({ file, status: 'waiting' })))
    }

    // changes one line of the list, the others stay as they are
    function update(index: number, change: Partial<Item>) {
        setItems((list) => list.map((item, i) => (i === index ? { ...item, ...change } : item)))
    }

    // uploads the files ONE AFTER ANOTHER: the next starts only when the previous answer is back.
    // In the order picked, so "first valid occurrence wins" follows that order. A failed file does not stop the others
    async function runImport() {
        setImporting(true)
        for (let i = 0; i < items.length; i++) {
            const file = items[i].file
            const reason = problem(file)
            if (reason) {
                update(i, { status: 'failed', error: reason })
                continue
            }
            update(i, { status: 'importing' })
            try {
                const result = await apiUpload('/api/import', file)   // the same single-file endpoint as before
                update(i, { status: 'done', result })
            } catch (e: any) {
                update(i, { status: 'failed', error: e.message })
            }
        }
        setImporting(false)
        if (picker.current) picker.current.value = ''   // empty the picker, so the same files can be picked again
        onDone()                                          // refresh the dashboard once, after the last file
    }

    const hasWaiting = items.some((item) => item.status === 'waiting')

    return (
        <div className="mb-4">
            <div className="input-group" style={{ maxWidth: 560 }}>
                <input
                    ref={picker}
                    type="file"
                    multiple
                    accept=".json,application/json"
                    aria-label="Events files (JSON)"
                    className="form-control"
                    onChange={pick}
                    disabled={importing}
                />
                <button className="btn btn-dark" onClick={runImport} disabled={!hasWaiting || importing}>
                    {importing ? 'Importing...' : 'Import'}
                </button>
            </div>
            {items.length > 0 && (
                <ul className="list-group mt-3" style={{ maxWidth: 760 }}>
                    {items.map((item, i) => (
                        <li key={i} className="list-group-item">{line(item)}</li>
                    ))}
                </ul>
            )}
        </div>
    )
}

export default ImportButton
