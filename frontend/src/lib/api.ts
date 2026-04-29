/**
 * Constructs the API endpoint URL
 * @param endpoint - The API endpoint (e.g., '/api/health')
 * @returns The endpoint URL that will be proxied to the backend
 */
export function get_api_url(endpoint: string): string {
  // Ensure endpoint starts with /
  return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
}

/**
 * Wrapper around fetch for API calls
 * @param endpoint - The API endpoint
 * @param options - Fetch options
 * @returns Promise with the fetch response
 */
export async function api_fetch(endpoint: string, options?: RequestInit): Promise<Response> {
  const url = get_api_url(endpoint);
  return fetch(url, options);
}
