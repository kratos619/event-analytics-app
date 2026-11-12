import { useEffect, useState } from 'react'
import { apiGet } from '../api/client'

const LIMIT = 10

const QualityPanel = ({ refresh }: { refresh: number }) => {
    const [quality, setQuality] = useState<any>(null)
    const [rows, setRows] = useState<any>(null)   // one page of the rows we did not save
    const [reason, setReason] = useState('')      // '' means all reasons
    const [page, setPage] = useState(1)
    const [error, setError] = useState('')

    useEffect(() => {
        async function loadQuality() {
            try {
                setQuality(await apiGet('/api/quality'))
            } catch (e: any) {
                setError(e.message)
            }
        }
        loadQuality()
    }, [refresh])

    useEffect(() => {
        async function loadRows() {
            try {
                const filter = reason ? `&reason=${reason}` : ''
                setRows(await apiGet(`/api/quality/rejected?page=${page}&limit=${LIMIT}${filter}`))
                setError('')
            } catch (e: any) {
                setError(e.message)
            }
        }
        loadRows()
    }, [reason, page, refresh])

    const pick = (newReason: string) => {
        setReason(newReason)
        setPage(1)
    }

    if (error) return <div className="alert alert-danger">Could not load the data quality: {error}</div>
    if (!quality || !rows) return <div className="spinner-border" role="status" />

    // a newer import that failed: everything it saved was rolled back, so it only gets a warning
    const failed = quality.last_failed
    const warning = failed && (
        <div className="alert alert-warning">
            The latest import, {failed.file_name}, failed ({failed.error}) after {failed.total_rows.toLocaleString()} rows.
            {failed.rolled_back && ' Everything it saved was rolled back.'}
        </div>
    )

    if (!quality.last_import) {
        return warning || <div className="alert alert-info">No import yet, so there is nothing to check.</div>
    }

    const run = quality.last_import   // the latest COMPLETED import: its rejected rows are the ones in the database
    const all = quality.by_reason.reduce((sum: number, r: any) => sum + r.count, 0)
    const pages = Math.max(1, Math.ceil(rows.total / LIMIT))

    return (
        <div className="card mb-4">
            <div className="card-body">
                {warning}
                <h2 className="h6">Data quality ({run.file_name}: {run.status}, {run.total_rows.toLocaleString()} rows read)</h2>
                <div className="row g-3 mb-3">
                    <div className="col-4"><div className="fs-4 fw-semibold">{run.invalid.toLocaleString()}</div><div className="text-muted small">invalid rows</div></div>
                    <div className="col-4"><div className="fs-4 fw-semibold">{run.exact_duplicates.toLocaleString()}</div><div className="text-muted small">exact duplicates</div></div>
                    <div className="col-4"><div className="fs-4 fw-semibold">{run.conflicting_duplicates.toLocaleString()}</div><div className="text-muted small">conflicting duplicates</div></div>
                </div>

                <div className="d-flex flex-wrap gap-2 mb-3">
                    <button className={`btn btn-sm ${reason === '' ? 'btn-dark' : 'btn-outline-dark'}`} onClick={() => pick('')}>All ({all.toLocaleString()})</button>
                    {quality.by_reason.map((r: any) => (
                        <button key={r.reason} className={`btn btn-sm ${reason === r.reason ? 'btn-dark' : 'btn-outline-dark'}`} onClick={() => pick(r.reason)}>
                            {r.reason} ({r.count.toLocaleString()})
                        </button>
                    ))}
                </div>

                <div className="table-responsive">
                    <table className="table table-sm mb-2">
                        <thead>
                            <tr><th>Row</th><th>Reason</th><th>Event id</th><th>Original row</th></tr>
                        </thead>
                        <tbody>
                            {rows.records.map((r: any) => (
                                <tr key={r.row_number}>
                                    <td>{r.row_number}</td>
                                    <td>{r.reason}</td>
                                    <td>{r.raw?.event_id ?? '(missing)'}</td>
                                    <td className="text-muted small">{JSON.stringify(r.raw).slice(0, 110)}...</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="d-flex align-items-center gap-3">
                    <button className="btn btn-sm btn-outline-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                    <span className="small">Page {page} of {pages}</span>
                    <button className="btn btn-sm btn-outline-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
            </div>
        </div>
    )
}

export default QualityPanel
