import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'

interface ImportResult {
  success: boolean
  word?: string
  code?: string
  error?: string
}

export async function POST(request: NextRequest) {
  // 验证管理员权限
  const authCheck = await checkAdminPermission()
  if (!authCheck.authorized) {
    return authCheck.response
  }

  const session = authCheck.session!

  try {
    const { startIndex, lines, type } = await request.json()

    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 1000) {
      return NextResponse.json({
        error: '无效的数据格式或超过批次限制（最多1000条）'
      }, { status: 400 })
    }

    if (typeof startIndex !== 'number' || startIndex < 0) {
      return NextResponse.json({
        error: '无效的startIndex参数'
      }, { status: 400 })
    }

    // Validate type
    const validTypes = ['Single', 'Phrase', 'Sentence', 'Symbol', 'Link', 'Poem', 'Other']
    const phraseType = type && validTypes.includes(type) ? type : 'Phrase'

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

      // Check code length (max 6 letters)
      if (code.length > 6) {
        results.push({
          success: false,
          word,
          code,
          error: `第 ${currentLine} 行：编码长度超过6个字母（${word} - ${code}）`
        })
        continue
      }

      // Check code is pure letters
      if (!/^[a-zA-Z]+$/.test(code)) {
        results.push({
          success: false,
          word,
          code,
          error: `第 ${currentLine} 行：编码必须是纯字母（${word} - ${code}）`
        })
        continue
      }

      validItems.push({ index: i, word, code })
    }

    // Step 2: Batch check existing phrases
    if (validItems.length > 0) {
      const codes = validItems.map(item => item.code)

      // Check for duplicate codes within the batch
      const batchCodesSet = new Set<string>()
      const batchDuplicates = new Set<string>()
      for (const item of validItems) {
        if (batchCodesSet.has(item.code)) {
          batchDuplicates.add(item.code)
        } else {
          batchCodesSet.add(item.code)
        }
      }

      // Query existing phrases: check codes and word+code combinations
      const existingPhrases = await prisma.phrase.findMany({
        where: {
          OR: [
            { code: { in: codes } },
            {
              AND: validItems.map(item => ({
                word: item.word,
                code: item.code
              }))
            }
          ]
        },
        select: {
          word: true,
          code: true
        }
      })

      const existingCodesMap = new Map(existingPhrases.map((p: { word: string; code: string }) => [p.code, p.word]))
      const existingCombinations = new Set(existingPhrases.map((p: { word: string; code: string }) => `${p.word}:${p.code}`))

      // Count phrases per code for weight calculation
      const codeCountMap = new Map<string, number>()
      for (const phrase of existingPhrases) {
        codeCountMap.set(phrase.code, (codeCountMap.get(phrase.code) || 0) + 1)
      }

      // Step 3: Process each valid item
      const processedCodes = new Map<string, number>()

      for (const item of validItems) {
        const { index, word, code } = item
        const lineNumber = startIndex + index + 1
        const combination = `${word}:${code}`

        // Check if word+code combination already exists
        if (existingCombinations.has(combination)) {
          results.push({
            success: false,
            word,
            code,
            error: `第 ${lineNumber} 行：词条和编码的组合已存在（${word} - ${code}）`
          })
          continue
        }

        // Calculate weight based on code duplication count
        // Base weight is 100, +1 for each existing phrase with same code
        const existingCount = codeCountMap.get(code) || 0
        const batchCount = processedCodes.get(code) || 0
        const weight = 100 + existingCount + batchCount

        // Create phrase
        try {
          await prisma.phrase.create({
            data: {
              word,
              code,
              type: phraseType,
              status: 'Finish',
              weight,
              user: {
                connect: { id: session.id }
              }
            }
          })

          results.push({
            success: true,
            word,
            code
          })

          // Mark as processed and increment batch count for this code
          processedCodes.set(code, batchCount + 1)
          existingCombinations.add(combination)
        } catch (err: unknown) {
          const error = err as { code?: string; meta?: { target?: string[] }; message?: string }
          const lineNumber = startIndex + index + 1
          let errorMsg = `第 ${lineNumber} 行：创建失败（词条：${word}，编码：${code}）`

          // Provide detailed error message based on Prisma error
          if (error.code === 'P2002') {
            // Unique constraint violation
            const target = error.meta?.target
            if (target?.includes('word') && target?.includes('code')) {
              errorMsg = `第 ${lineNumber} 行：词条和编码的组合已存在（${word} - ${code}）`
            } else if (target?.includes('code')) {
              errorMsg = `第 ${lineNumber} 行：编码冲突（${code}）`
            }
          } else if (error.message) {
            errorMsg = `第 ${lineNumber} 行：创建失败（词条：${word}，编码：${code}，原因：${error.message}）`
          }

          results.push({
            success: false,
            word,
            code,
            error: errorMsg
          })
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
