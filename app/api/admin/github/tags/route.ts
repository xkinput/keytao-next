/**
 * GET  /api/admin/github/tags  - Get latest version tag
 * POST /api/admin/github/tags  - Create and push a new tag
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { createGithubSyncService } from '@/lib/services/githubSync';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function GET() {
  try {
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const githubService = createGithubSyncService();
    const latestTag = await githubService.getLatestVersionTag();

    return NextResponse.json({ success: true, latestTag });
  } catch (error) {
    console.error('[Tags] GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取 Tag 失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const { tagName, message } = await request.json() as { tagName: string; message?: string };

    if (!tagName || typeof tagName !== 'string') {
      return NextResponse.json(
        { success: false, error: 'tagName 不能为空' },
        { status: 400 }
      );
    }

    if (!/^v\d+\.\d+\.\d+$/.test(tagName)) {
      return NextResponse.json(
        { success: false, error: 'Tag 格式必须为 v[x.x.x]，例如 v1.0.0' },
        { status: 400 }
      );
    }

    const githubService = createGithubSyncService();
    await githubService.createAndPushTag(
      tagName,
      message || `Release ${tagName}`
    );

    console.log(`[Tags] Created and pushed tag: ${tagName}`);

    return NextResponse.json({ success: true, tagName });
  } catch (error) {
    console.error('[Tags] POST error:', error);
    const msg = error instanceof Error ? error.message : '发布 Tag 失败';
    // 422 = tag already exists
    const status = (error as { status?: number }).status === 422 ? 409 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
