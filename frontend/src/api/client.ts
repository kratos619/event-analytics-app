const BASE = import.meta.env.VITE_API_BASE ?? ''

// get JSON from the backend. If the answer is not OK, throw the server's message
export async function apiGet(path: string) {
    const res = await fetch(`${BASE}${path}`)
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))   // a proxy error page is not JSON
        throw new Error(body.message ?? `API ${res.status}`)
    }
    return res.json()
}

// ?dealer_id=...&from=...  the empty filters are left out
export function filterQuery(filters: any) {
    const params = new URLSearchParams()
    for (const key in filters) {
        if (filters[key]) params.set(key, filters[key])
    }
    return `?${params}`
}
