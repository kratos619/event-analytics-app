import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { apiUpload } from '../api/client'

const MAX_MB = 50   // the backend refuses a bigger file, so say so before uploading it

const ImportButton = ({ onDone }: { onDone: () => void }) => {
    const [file, setFile] = useState<File | null>(null)
    const [importing, setImporting] = useState(false)
    const [result, setResult] = useState<any>(null)
    const [error, setError] = useState('')
    const picker = useRef<HTMLInputElement>(null)

    function pick(e: ChangeEvent<HTMLInputElement>) {
        setFile(e.target.files?.[0] ?? null)
        setResult(null)
        setError('')
    }

    async function runImport() {
        if (!file) return
        if (file.size > MAX_MB * 1024 * 1024) return setError(`${file.name} is bigger than ${MAX_MB} MB`)
        setImporting(true)
        setError('')
        setResult(null)
        try {
            let d = await apiUpload('/api/import', file)
            setResult(d)
            setFile(null)
            if (picker.current) picker.current.value = ''   // empty the picker, so the same file can be picked again
            onDone()
        } catch (e: any) {
            setError(e.message)
        } finally {
            setImporting(false)
        }
    }

    return (
        <div className="mb-4">
            <div className="input-group" style={{ maxWidth: 560 }}>
                <input
                    ref={picker}
                    type="file"
                    accept=".json,application/json"
                    aria-label="Events file (JSON)"
                    className="form-control"
                    onChange={pick}
                    disabled={importing}
                />
                <button className="btn btn-dark" onClick={runImport} disabled={!file || importing}>
                    {importing ? 'Importing...' : 'Import'}
                </button>
            </div>
            {error && <div className="alert alert-danger mt-3 mb-0">Import failed: {error}</div>}
            {result && !error && (
                <div className="alert alert-success mt-3 mb-0">
                    {result.run.file_name}: finished in {result.run.duration_ms} ms, {result.total_rows.toLocaleString()} rows read,{' '}
                    {result.accepted.toLocaleString()} accepted, {result.exact_duplicates.toLocaleString()} exact duplicates,{' '}
                    {result.conflicting_duplicates.toLocaleString()} conflicting duplicates, {result.invalid.toLocaleString()} invalid.
                </div>
            )}
        </div>
    )
}

export default ImportButton
