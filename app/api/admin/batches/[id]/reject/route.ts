import { NextResponse } from 'next/server'

export function POST() {
  return NextResponse.json({ error: '请在审核页为词条分别记录审核决定' }, { status: 410 })
}
