import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Next.js encodes every server action id as a 42 character string generated at
// build time. This app ships no server actions, so a POST carrying a
// `next-action` header of any other length is stale-client or unrelated traffic.
// Reject it here so the request never reaches the action handler, which would
// otherwise log "Failed to find Server Action" for every such request.
const SERVER_ACTION_ID_LENGTH = 42

export function proxy(request: NextRequest) {
  const actionId = request.headers.get('next-action')

  if (actionId && actionId.length !== SERVER_ACTION_ID_LENGTH) {
    return NextResponse.json(
      { error: 'Unknown server action' },
      { status: 400 },
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    {
      source: '/:path*',
      has: [{ type: 'header', key: 'next-action' }],
    },
  ],
}