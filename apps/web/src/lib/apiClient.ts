/**
 * Thin fetch wrapper for JSON endpoints. Always sends cookies, throws a typed
 * ApiError on non-2xx, and parses the JSON body. Use this instead of bare fetch.
 */
import { extractErrorMessage } from '@persistent/shared'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    }
  })

  const text = await response.text()
  const body = text ? safeParse(text) : null

  if (!response.ok) {
    throw new ApiError(response.status, extractErrorMessage(body, `Request failed (${response.status}).`))
  }
  return body as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
