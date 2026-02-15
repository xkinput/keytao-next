/**
 * Phrases Export API
 * Export all Finish phrases as Rime YAML zip package
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PhraseType, PhraseStatus, Phrase } from '@prisma/client';
import JSZip from 'jszip';
import { format } from 'date-fns';

interface RimeEntry {
  word: string;
  code: string;
  weight?: number;
}

interface RimeDict {
  name: string;
  version: string;
  sort: string;
  entries: RimeEntry[];
}

/**
 * Convert PhraseType enum to file suffix
 */
function phraseTypeToSuffix(type: PhraseType): string {
  const typeMap: Record<PhraseType, string> = {
    Single: 'single',
    Phrase: 'phrase',
    Supplement: 'supplement',
    Symbol: 'symbol',
    Link: 'link',
    CSS: 'css',
    CSSSingle: 'css-single',
    English: 'english',
  };
  return typeMap[type];
}

/**
 * Convert Phrase to Rime entry
 */
function phraseToRimeEntry(phrase: Phrase): RimeEntry {
  return {
    word: phrase.word,
    code: phrase.code,
    weight: phrase.weight || undefined,
  };
}

/**
 * Group phrases by type
 */
function groupPhrasesByType(phrases: Phrase[]): Map<PhraseType, Phrase[]> {
  const grouped = new Map<PhraseType, Phrase[]>();

  for (const phrase of phrases) {
    if (!grouped.has(phrase.type)) {
      grouped.set(phrase.type, []);
    }
    grouped.get(phrase.type)!.push(phrase);
  }

  return grouped;
}

/**
 * Generate Rime YAML content
 */
function generateRimeYaml(dict: RimeDict): string {
  const lines: string[] = [];

  // Header
  lines.push('# Rime dictionary');
  lines.push('# encoding: utf-8');
  lines.push('---');
  lines.push(`name: ${dict.name}`);
  lines.push(`version: "${dict.version}"`);
  lines.push(`sort: ${dict.sort}`);
  lines.push('columns:');
  lines.push('  - text');
  lines.push('  - code');
  if (dict.entries.some(e => e.weight !== undefined)) {
    lines.push('  - weight');
  }
  lines.push('...');
  lines.push('');

  // Sort entries by code, then by weight ascending (smaller weight first)
  const sortedEntries = [...dict.entries].sort((a, b) => {
    if (a.code !== b.code) {
      return a.code.localeCompare(b.code);
    }
    return (a.weight || 0) - (b.weight || 0);
  });

  for (const entry of sortedEntries) {
    const parts = [entry.word, entry.code];
    if (entry.weight !== undefined) {
      parts.push(entry.weight.toString());
    }
    lines.push(parts.join('\t'));
  }

  return lines.join('\n');
}

/**
 * Convert phrases to Rime dictionary files
 */
function convertPhrasesToRimeDicts(
  phrases: Phrase[],
  version?: string
): Map<string, string> {
  const result = new Map<string, string>();
  const grouped = groupPhrasesByType(phrases);
  const dateVersion = version || format(new Date(), 'yyyy.MM.dd');

  for (const [type, typePhrases] of grouped.entries()) {
    const entries: RimeEntry[] = typePhrases.map(phraseToRimeEntry);

    if (entries.length === 0) {
      continue;
    }

    const suffix = phraseTypeToSuffix(type);
    const dictName = `keytao.${suffix}`;
    const fileName = `${dictName}.dict.yaml`;

    const dict: RimeDict = {
      name: dictName,
      version: dateVersion,
      sort: 'by_weight',
      entries,
    };

    const content = generateRimeYaml(dict);
    result.set(fileName, content);

    // Special handling for Single type: generate keytao-dz and keytao-cx
    if (type === PhraseType.Single) {
      const dzDict: RimeDict = {
        name: 'keytao-dz',
        version: 'Q1',
        sort: 'by_weight',
        entries,
      };
      result.set('keytao-dz.dict.yaml', generateRimeYaml(dzDict));

      const cxDict: RimeDict = {
        name: 'keytao-cx',
        version: 'Q1',
        sort: 'by_weight',
        entries,
      };
      result.set('keytao-cx.dict.yaml', generateRimeYaml(cxDict));
    }
  }

  return result;
}

export async function GET() {
  try {
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

    // Convert to Rime dictionaries
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
