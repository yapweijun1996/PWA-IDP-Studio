/** Fail closed for HTTP errors, absent identity, invalid JSON, and mixed deployments. */
export async function requireBuildIdentity(build: string, result: Pick<Response, 'ok' | 'json'> | Promise<Pick<Response, 'ok' | 'json'>>): Promise<void> {
  const response = await result;
  if (!response.ok) throw new Error('Build identity request failed');
  const identity: unknown = await response.json();
  if (!identity || typeof identity !== 'object' || !('build' in identity) || identity.build !== build) throw new Error('Build identity mismatch');
}
