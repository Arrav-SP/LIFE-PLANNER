// Types for the npm: imports Deno resolves at deploy time (typecheck only).
declare module 'npm:web-push@3.6.7' {
  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void
    sendNotification(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, options?: { TTL?: number }): Promise<unknown>
  }
  export default webpush
}
