/**
 * Phrases Export API
 * Export all Finish phrases as Rime YAML zip package
 * Admin only
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminPermission } from '@/lib/adminAuth';
import { PhraseStatus } from '@prisma/client';
import { convertPhrasesToRimeDicts } from '@/lib/services/rimeConverter';
import JSZip from 'jszip';
import { format } from 'date-fns';

export async function GET() {
  try {
    // Check admin permission
    const authCheck = await checkAdminPermission()
    if (!authCheck.authorized) {
      return authCheck.response
    }

    // Query all Finish phrases
    const phrases = await prisma.phrase.findMany({
      where: {
        status: PhraseStatus.Finish,
      },
      orderBy: [
        { type: 'asc' },
        { code: 'asc' },
        { weight: 'asc' },
      ],
    });

    if (phrases.length === 0) {
      return NextResponse.json(
        { error: 'No finished phrases found' },
        { status: 404 }
      );
    }

    // Convert to Rime dictionaries using shared converter
    const dictFiles = convertPhrasesToRimeDicts(phrases);

    if (dictFiles.size === 0) {
      return NextResponse.json(
        { error: 'No dictionary files generated' },
        { status: 500 }
      );
    }

    // Create zip package
    const zip = new JSZip();
    for (const [fileName, content] of dictFiles.entries()) {
      zip.file(fileName, content);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // Return zip file
    const timestamp = format(new Date(), 'yyyyMMdd-HHmmss');
    const filename = `keytao-phrases-${timestamp}.zip`;

    return new NextResponse(zipBlob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Export phrases error:', error);
    return NextResponse.json(
      { error: 'Failed to export phrases' },
      { status: 500 }
    );
  }
}
