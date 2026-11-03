import { useState } from 'react'
import { apiPost } from '../api/client'

const ImportButton = ({ onDone }: { onDone: () => void }) => {
    const [importing, setImporting] = useState(false)
    const [result, setResult] = useState<any>(null)
    const [error, setError] = useState('')

    async function runImport() {
        setImporting(true)
        setError('')
        try {
            setResult(await apiPost('/api/import'))
            onDone()
        } catch (e: any) {
            setError(e.message)
        } finally {
            setImporting(false)
        }
    }

    return (
        <div className="mb-4">
            <button className="btn btn-dark" onClick={runImport} disabled={importing}>
                {importing ? 'Importing...' : 'Import events file'}
            </button>
            {error && <div className="alert alert-danger mt-3 mb-0">Import failed: {error}</div>}
            {result && !error && (
                <div className="alert alert-success mt-3 mb-0">
                    Import finished in {result.run.duration_ms} ms: {result.total_rows.toLocaleString()} rows read,{' '}
                    {result.accepted.toLocaleString()} accepted, {result.exact_duplicates.toLocaleString()} exact duplicates,{' '}
                    {result.conflicting_duplicates.toLocaleString()} conflicting duplicates, {result.invalid.toLocaleString()} invalid.
                </div>
            )}
        </div>
    )
}

export default ImportButton
