import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRootAdminPermission } from '@/lib/adminAuth'
import { isValidPhraseType, PHRASE_TYPE_CONFIGS, type PhraseType } from '@/lib/constants/phraseTypes'
import { CODE_PATTERN, MAX_CODE_LENGTH } from '@/lib/constants/codeValidation'
import { calculateWeightForType } from '@/lib/services/batchConflictService'

interface ImportResult {
  success: boolean
  word?: string
  code?: string
  error?: string
}

export async function POST(request: NextRequest) {
  // 验证ROOT管理员权限
  const authCheck = await checkRootAdminPermission()
  if (!authCheck.authorized) {
    return authCheck.response
  }

  const session = authCheck.session!

  try {
    const { startIndex, lines, type } = await request.json()

    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 5000) {
      return NextResponse.json({
        error: '无效的数据格式或超过批次限制（最多5000条）'
      }, { status: 400 })
    }

    if (typeof startIndex !== 'number' || startIndex < 0) {
      return NextResponse.json({
        error: '无效的startIndex参数'
      }, { status: 400 })
    }

    // Validate type
    if (type && !isValidPhraseType(type)) {
      return NextResponse.json({
        error: `无效的类型参数，支持的类型: ${Object.keys(PHRASE_TYPE_CONFIGS).join(', ')}`
      }, { status: 400 })
    }
    const phraseType = type || 'Phrase'

    const results: ImportResult[] = []
    const validItems: Array<{ index: number; word: string; code: string }> = []

    // Step 1: Validate all items
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const currentLine = startIndex + i + 1

      if (typeof line !== 'string') {
        results.push({
          success: false,
          error: `第 ${currentLine} 行：无效的数据格式`
        })
        continue
      }

      // Parse line
      const parts = line.split('\t')
      if (parts.length < 2) {
        results.push({
          success: false,
          error: `第 ${currentLine} 行：格式错误，缺少 Tab 分隔符`
        })
        continue
      }

      const word = parts[0]?.trim()
      const code = parts[1]?.trim()

      // Validate word
      if (!word) {
        results.push({
          success: false,
          word,
          code,
          error: `第 ${currentLine} 行：词条不能为空`
        })
        continue
      }

      // Validate code
      if (!code) {
        results.push({
          success: false,
          word,
          code,
          error: `第 ${currentLine} 行：编码不能为空`
        })
        continue
      }

      // Check code length
      if (code.length > MAX_CODE_LENGTH) {
        results.push({
          success: false,
          word,
          code,
          error: `第 ${currentLine} 行：编码长度超过${MAX_CODE_LENGTH}个字符（${word} - ${code}）`
        })
        continue
      }

      // Check code format
      if (!CODE_PATTERN.test(code)) {
        results.push({
          success: false,
          word,
          code,
          error: `第 ${currentLine} 行：编码格式错误（${word} - ${code}）`
        })
        continue
      }

      validItems.push({ index: i, word, code })
    }

    // Step 2: Batch processing - optimized for performance
    if (validItems.length > 0) {
      // Batch check: query existing phrases (word+code combinations)
      const existingPhrases = await prisma.phrase.findMany({
        where: {
          OR: validItems.map(item => ({
            word: item.word,
            code: item.code
          }))
        },
        select: {
          word: true,
          code: true
        }
      })

      const existingCombinations = new Set(
        existingPhrases.map(p => `${p.word}:${p.code}`)
      )

      // Filter out existing combinations
      const itemsToInsert: Array<{ index: number; word: string; code: string }> = []

      for (const item of validItems) {
        const combination = `${item.word}:${item.code}`

        if (existingCombinations.has(combination)) {
          results.push({
            success: false,
            word: item.word,
            code: item.code,
            error: `第 ${startIndex + item.index + 1} 行：词条和编码的组合已存在（${item.word} - ${item.code}）`
          })
        } else {
          itemsToInsert.push(item)
        }
      }

      // Step 3: Batch calculate weights
      if (itemsToInsert.length > 0) {
        // Get unique codes to query
        const uniqueCodes = Array.from(new Set(itemsToInsert.map(item => item.code)))

        // Batch query: count existing phrases per code AND type
        // Different types should have independent weight calculation
        const codeGroups = await prisma.phrase.groupBy({
          by: ['code', 'type'],
          where: {
            code: { in: uniqueCodes }
          },
          _count: {
            code: true
          }
        })

        const codeTypeCountMap = new Map<string, number>(
          codeGroups.map(g => [`${g.code}:${g.type}`, g._count.code])
        )

        // Calculate weights for items to insert, considering batch order
        const batchCodeTypeCount = new Map<string, number>()

        const phrasesToCreate = itemsToInsert.map(item => {
          const codeTypeKey = `${item.code}:${phraseType}`
          const existingCount = codeTypeCountMap.get(codeTypeKey) || 0
          const batchCount = batchCodeTypeCount.get(codeTypeKey) || 0

          // Use unified weight calculation function
          const weight = calculateWeightForType(phraseType as PhraseType, existingCount, batchCount)

          // Increment batch counter for this code+type combination
          batchCodeTypeCount.set(codeTypeKey, batchCount + 1)

          return {
            word: item.word,
            code: item.code,
            type: phraseType,
            status: 'Finish' as const,
            weight,
            userId: session.id
          }
        })

        // Step 4: Batch insert using createMany (10-100x faster than loop create)
        try {
          const createResult = await prisma.phrase.createMany({
            data: phrasesToCreate,
            skipDuplicates: true // Skip if unique constraint violated
          })

          // Mark successful inserts
          const successCount = createResult.count

          // Since createMany doesn't return which records succeeded, 
          // we assume all non-duplicates succeeded
          for (let i = 0; i < itemsToInsert.length; i++) {
            results.push({
              success: true,
              word: itemsToInsert[i].word,
              code: itemsToInsert[i].code
            })
          }
        } catch (err: unknown) {
          // If batch insert fails, fall back to individual inserts for error reporting
          console.warn('Batch insert failed, falling back to individual inserts:', err)

          for (const item of itemsToInsert) {
            const codeTypeKey = `${item.code}:${phraseType}`
            const existingCount = codeTypeCountMap.get(codeTypeKey) || 0
            const batchCount = batchCodeTypeCount.get(codeTypeKey) || 0

            // Use unified weight calculation function
            const weight = calculateWeightForType(phraseType as PhraseType, existingCount, batchCount)

            try {
              await prisma.phrase.create({
                data: {
                  word: item.word,
                  code: item.code,
                  type: phraseType,
                  status: 'Finish',
                  weight,
                  userId: session.id
                }
              })

              results.push({
                success: true,
                word: item.word,
                code: item.code
              })

              batchCodeTypeCount.set(codeTypeKey, batchCount + 1)
            } catch (err: unknown) {
              const error = err as { code?: string; meta?: { target?: string[] }; message?: string }
              const lineNumber = startIndex + item.index + 1
              let errorMsg = `第 ${lineNumber} 行：创建失败（${item.word} - ${item.code}）`

              if (error.code === 'P2002') {
                const target = error.meta?.target
                if (target?.includes('word') && target?.includes('code')) {
                  errorMsg = `第 ${lineNumber} 行：词条和编码的组合已存在（${item.word} - ${item.code}）`
                } else if (target?.includes('code')) {
                  errorMsg = `第 ${lineNumber} 行：编码冲突（${item.code}）`
                }
              }

              results.push({
                success: false,
                word: item.word,
                code: item.code,
                error: errorMsg
              })
            }
          }
        }
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Import phrases error:', error)
    return NextResponse.json(
      { error: '导入失败' },
      { status: 500 }
    )
  }
}
