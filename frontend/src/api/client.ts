const BASE = import.meta.env.VITE_API_BASE ?? ''

export type Filters = { dealer_id: string; event_type: string; from: string; to: string }
export const emptyFilters: Filters = { dealer_id: '', event_type: '', from: '', to: '' }

// get JSON from the backend. If the answer is not OK, throw the server's message
export async function apiGet(path: string) {
    const res = await fetch(`${BASE}${path}`)
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))   // a proxy error page is not JSON
        throw new Error(body.message ?? `API ${res.status}`)
    }
    return res.json()
}

// sends the picked file as the body of a POST (the events file is JSON), used by the import button
export async function apiUpload(path: string, file: File) {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: file })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.message ?? `API ${res.status}`)
    return body
}

// ?dealer_id=...&from=...  the empty filters are left out
export function filterQuery(filters: any) {
    const params = new URLSearchParams()
    for (const key in filters) {
        if (filters[key]) params.set(key, filters[key])
    }
    return `?${params}`
}
