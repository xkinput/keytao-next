import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { prisma } from '@/lib/prisma'
import { getDefaultWeight, type PhraseType } from '@/lib/constants/phraseTypes'

interface PRItemInput {
  id: string
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord?: string
  code: string
  weight?: number
  type?: string
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { items } = body as { items: PRItemInput[] }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Invalid items array' },
        { status: 400 }
      )
    }

    const results: Array<{
      id: string
      conflict: {
        hasConflict: boolean
        code: string
        currentPhrase?: {
          word: string
          code: string
          weight: number
        }
        impact?: string
        suggestions: Array<{
          action: string
          word: string
          fromCode?: string
          toCode?: string
          reason: string
        }>
      }
    }> = []

    // First, check each item against database
    for (const item of items) {
      const conflict = await conflictDetector.checkConflict({
        action: item.action,
        word: item.word,
        oldWord: item.oldWord,
        code: item.code,
        weight: item.weight
      })

      // For Create action with duplicate code, calculate suggested weight
      if (item.action === 'Create' && conflict.currentPhrase && item.type) {
        const existingCount = await prisma.phrase.count({
          where: { code: item.code }
        })
        const baseWeight = getDefaultWeight(item.type as PhraseType)
        const suggestedWeight = baseWeight + existingCount

        // Update impact message with weight info
        conflict.impact = `编码 "${item.code}" 已被词条 "${conflict.currentPhrase.word}" 占用，将创建重码（权重: ${suggestedWeight}）`
      }

      results.push({
        id: item.id,
        conflict
      })
    }

    // Then, check conflicts between items in the batch
    for (let i = 0; i < items.length; i++) {
      const item1 = items[i]
      const result1 = results[i]

      for (let j = i + 1; j < items.length; j++) {
        const item2 = items[j]

        // Check for duplicate items (same word and code)
        if (item1.code === item2.code && item1.word === item2.word) {
          if (!result1.conflict.hasConflict) {
            result1.conflict = {
              hasConflict: true,
              code: item1.code,
              impact: `与本批次修改 #${j + 1} 重复（相同词和编码）`,
              suggestions: [
                {
                  action: 'Cancel',
                  word: item1.word,
                  reason: '删除重复的修改项'
                }
              ]
            }
          } else {
            result1.conflict.impact += ` 且与本批次修改 #${j + 1} 重复`
          }
        }
        // Check for conflicts on same code
        else if (item1.code === item2.code) {
          // Determine if items will create new entries on same code
          const item1CreatesEntry =
            item1.action === 'Create' ||
            (item1.action === 'Change' && item1.word !== item1.oldWord)
          const item2CreatesEntry =
            item2.action === 'Create' ||
            (item2.action === 'Change' && item2.word !== item2.oldWord)

          if (item1CreatesEntry && item2CreatesEntry) {
            if (!result1.conflict.hasConflict) {
              result1.conflict = {
                hasConflict: true,
                code: item1.code,
                impact: `与本批次修改 #${j + 1} 在编码 ${item1.code} 上产生重码`,
                suggestions: [
                  {
                    action: 'Adjust',
                    word: item1.word,
                    reason: '考虑调整其中一个的权重或编码'
                  }
                ]
              }
            } else {
              result1.conflict.impact += ` 且与本批次修改 #${j + 1} 产生重码`
            }
          }

          // Check if item2 resolves item1's conflict
          // e.g., item1 creates a duplicate, item2 moves or deletes the existing one
          if (
            result1.conflict.currentPhrase &&
            ((item2.action === 'Change' &&
              item2.oldWord === result1.conflict.currentPhrase.word &&
              item2.code === result1.conflict.currentPhrase.code) ||
              (item2.action === 'Delete' &&
                item2.word === result1.conflict.currentPhrase.word &&
                item2.code === result1.conflict.currentPhrase.code))
          ) {
            // item2 is removing the conflicting phrase
            result1.conflict.hasConflict = false
            const resolutionAction = item2.action === 'Change' ? '移动' : '删除'
            const explanation = item2.action === 'Change'
              ? `修改 #${j + 1} 将 "${item2.oldWord}" 移动到其他编码`
              : `修改 #${j + 1} 删除了 "${item2.word}"`

            result1.conflict.impact = `冲突已由本批次${explanation}而解决`
            result1.conflict.suggestions = [
              {
                action: 'Resolved',
                word: item1.word,
                reason: explanation
              }
            ]
          }
        }

        // Check if item1 can resolve item2's database conflict
        const result2 = results[j]
        if (
          result2.conflict.hasConflict &&
          result2.conflict.currentPhrase &&
          item1.action === 'Change' &&
          item1.oldWord === result2.conflict.currentPhrase.word &&
          item1.code === result2.conflict.currentPhrase.code
        ) {
          result2.conflict.hasConflict = false
          result2.conflict.impact = `冲突已由本批次修改 #${i + 1} 解决（移动了重码词）`
          result2.conflict.suggestions = [
            {
              action: 'Resolved',
              word: item2.word,
              reason: `修改 #${i + 1} 将 "${item1.oldWord}" 移动到其他编码`
            }
          ]
        }

        // Check if item1 deletes what item2 conflicts with
        if (
          result2.conflict.hasConflict &&
          result2.conflict.currentPhrase &&
          item1.action === 'Delete' &&
          item1.word === result2.conflict.currentPhrase.word &&
          item1.code === result2.conflict.currentPhrase.code
        ) {
          result2.conflict.hasConflict = false
          result2.conflict.impact = `冲突已由本批次修改 #${i + 1} 解决（删除了重码词）`
          result2.conflict.suggestions = [
            {
              action: 'Resolved',
              word: item2.word,
              reason: `修改 #${i + 1} 删除了 "${item1.word}"`
            }
          ]
        }
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Batch conflict check error:', error)
    return NextResponse.json(
      { error: 'Failed to check conflicts' },
      { status: 500 }
    )
  }
}
