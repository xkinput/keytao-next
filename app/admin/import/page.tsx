'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader, Button, Progress, Textarea, Chip, Listbox, ListboxItem, Select, SelectItem, Spinner } from '@heroui/react'
import { apiRequest, useAPI } from '@/lib/hooks/useSWR'
import { type PhraseType, getPhraseTypeOptions } from '@/lib/constants/phraseTypes'
import { useAuthStore } from '@/lib/store/auth'

interface ImportError {
  line: number
  word?: string
  code?: string
  error: string
}

export default function ImportPage() {
  const router = useRouter()
  const { token, isAuthenticated } = useAuthStore()

  // Check ROOT admin permission
  const { data: adminCheck, isLoading, mutate: refreshStats } = useAPI<{
    isRootAdmin: boolean
    phrasesByType: Record<string, number>
  }>(
    isAuthenticated() && token ? '/api/admin/stats' : null
  )

  const [file, setFile] = useState<File | null>(null)
  const [content, setContent] = useState('')
  const [phraseType, setPhraseType] = useState<PhraseType>('Phrase')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentLine, setCurrentLine] = useState(0)
  const [totalLines, setTotalLines] = useState(0)
  const [successCount, setSuccessCount] = useState(0)
  const [errors, setErrors] = useState<ImportError[]>([])
  const [importSpeed, setImportSpeed] = useState(0)
  const [startTime, setStartTime] = useState(0)

  // Redirect if not ROOT admin
  useEffect(() => {
    if (!isLoading && adminCheck && !adminCheck.isRootAdmin) {
      router.push('/admin')
    }
  }, [adminCheck, isLoading, router])

  // Show loading while checking permission
  if (isLoading || !adminCheck) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" label="验证权限中..." />
      </div>
    )
  }

  // Show access denied if not ROOT admin
  if (!adminCheck.isRootAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardBody className="text-center py-8">
            <h2 className="text-xl font-bold text-danger mb-2">权限不足</h2>
            <p className="text-default-500">此功能仅限初始管理员访问</p>
          </CardBody>
        </Card>
      </div>
    )
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = event.target?.result as string
        // Remove YAML frontmatter and filter comment lines
        const cleanedText = removeYamlFrontmatter(text)
        const validLines = filterValidLines(cleanedText.split('\n'))
        // Remove weight column (keep only word and code)
        const linesWithoutWeight = removeWeightColumn(validLines)
        const filteredContent = linesWithoutWeight.join('\n')
        setContent(filteredContent)

        // Auto-detect phrase type based on filename
        const detectedType = detectPhraseTypeFromFilename(selectedFile.name)
        setPhraseType(detectedType)
      }
      reader.readAsText(selectedFile)
    }
  }

  const detectPhraseTypeFromFilename = (filename: string): PhraseType => {
    const lowerName = filename.toLowerCase()

    // Check for each phrase type's rime filename pattern
    if (lowerName.includes('css-single') || lowerName.includes('css_single')) {
      return 'CSSSingle'
    }
    if (lowerName.includes('css') || lowerName.includes('声笔笔')) {
      return 'CSS'
    }
    if (lowerName.includes('single') || lowerName.includes('单字')) {
      return 'Single'
    }
    if (lowerName.includes('phrase') || lowerName.includes('词组')) {
      return 'Phrase'
    }
    if (lowerName.includes('supplement') || lowerName.includes('补充')) {
      return 'Supplement'
    }
    if (lowerName.includes('symbol') || lowerName.includes('符号')) {
      return 'Symbol'
    }
    if (lowerName.includes('link') || lowerName.includes('链接')) {
      return 'Link'
    }
    if (lowerName.includes('english') || lowerName.includes('英文')) {
      return 'English'
    }

    // Default to Phrase if no match
    return 'Phrase'
  }

  const removeYamlFrontmatter = (text: string): string => {
    // First, remove all comment lines (starting with #)
    const withoutComments = text
      .split('\n')
      .filter(line => !line.trim().startsWith('#'))
      .join('\n')

    // Then match YAML frontmatter: starts with --- and ends with ... or ---
    const yamlPattern = /^---[\s\S]*?(\.\.\.|---)[^\r\n]*[\r\n]*/
    return withoutComments.replace(yamlPattern, '')
  }

  const filterValidLines = (lines: string[]): string[] => {
    return lines.filter(line => {
      const trimmed = line.trim()
      // Filter out empty lines and comment lines (starting with #)
      return trimmed && !trimmed.startsWith('#')
    })
  }

  const removeWeightColumn = (lines: string[]): string[] => {
    return lines.map(line => {
      const parts = line.split('\t')
      // Only keep first two columns: word and code
      if (parts.length >= 2) {
        return `${parts[0]}\t${parts[1]}`
      }
      return line
    })
  }

  const handleImport = async () => {
    if (!content) {
      alert('请先选择文件或输入内容')
      return
    }

    if (!phraseType) {
      alert('请选择词条类型')
      return
    }

    setImporting(true)
    setProgress(0)
    setCurrentLine(0)
    setSuccessCount(0)
    setErrors([])
    setImportSpeed(0)
    setStartTime(Date.now())

    try {
      // Remove YAML frontmatter and filter out comment lines
      const cleanedContent = removeYamlFrontmatter(content)
      const lines = filterValidLines(cleanedContent.split('\n'))
      setTotalLines(lines.length)

      // Process in batches of 5000 (optimized for performance)
      const batchSize = 5000
      let processedCount = 0
      let successTotal = 0

      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, Math.min(i + batchSize, lines.length))

        try {
          const response = await apiRequest<{
            results: Array<{
              success: boolean
              word?: string
              code?: string
              error?: string
            }>
          }>(
            '/api/admin/import/phrases',
            {
              method: 'POST',
              body: {
                startIndex: i,
                lines: batch.map(line => line.trim()),
                type: phraseType
              }
            }
          )

          // Process results - batch update for performance
          let batchSuccessCount = 0
          const batchErrors: ImportError[] = []

          response.results.forEach((result, idx) => {
            const lineNumber = i + idx + 1

            if (result.success) {
              batchSuccessCount++
            } else if (result.error) {
              batchErrors.push({
                line: lineNumber,
                word: result.word,
                code: result.code,
                error: result.error || '未知错误'
              })
            }
          })

          // Batch state updates (more efficient)
          successTotal += batchSuccessCount
          processedCount += response.results.length

          setSuccessCount(successTotal)
          if (batchErrors.length > 0) {
            setErrors(prev => [...prev, ...batchErrors])
          }
          setCurrentLine(processedCount)
          setProgress((processedCount / lines.length) * 100)

          // Calculate import speed
          const elapsed = (Date.now() - startTime) / 1000
          const speed = Math.round(processedCount / elapsed)
          setImportSpeed(speed)
        } catch (err: unknown) {
          const error = err as { info?: { error?: string } }
          // If batch fails, mark all items in batch as failed
          for (let j = 0; j < batch.length; j++) {
            setErrors(prev => [...prev, {
              line: i + j + 1,
              error: error.info?.error || `第 ${i + j + 1} 行：导入失败`
            }])
            processedCount++
          }
          setCurrentLine(processedCount)
          setProgress((processedCount / lines.length) * 100)
        }
      }
    } catch (error) {
      console.error(error)
      alert('导入过程出错')
    } finally {
      setImporting(false)
      // Refresh stats after import completes
      refreshStats()
    }
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-8">词库导入</h1>

        <Card className="mb-6">
          <CardHeader>
            <h3 className="text-lg font-semibold">上传词库文件</h3>
          </CardHeader>
          <CardBody className="gap-4">
            {!importing && successCount === 0 && errors.length === 0 && (
              <>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium mb-2">
                      选择 TXT/YAML 文件（每行格式：词[Tab]编码）
                    </label>
                    <input
                      type="file"
                      accept=".txt,.yaml,.yml"
                      onChange={handleFileChange}
                      className="block w-full text-sm text-default-500
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-md file:border-0
                          file:text-sm file:font-semibold
                          file:bg-primary file:text-primary-foreground
                          hover:file:bg-primary-600"
                    />
                    {file && (
                      <p className="mt-2 text-sm text-default-500">
                        已选择: {file.name} ({(file.size / 1024).toFixed(2)} KB)
                      </p>
                    )}
                  </div>

                  <div className="w-48">
                    <Select
                      selectedKeys={[phraseType]}
                      onChange={(e) => setPhraseType(e.target.value as PhraseType)}
                      label="选择类型"
                      placeholder="请选择词条类型"
                      isRequired
                      isDisabled={importing}
                    >
                      {getPhraseTypeOptions().map((type) => (
                        <SelectItem key={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </Select>
                    {adminCheck?.phrasesByType && (
                      <p className="mt-2 text-sm text-default-500">
                        当前词库: {adminCheck.phrasesByType[phraseType] || 0} 条
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    或直接粘贴内容
                  </label>
                  <Textarea
                    placeholder="每行一条，格式：词条[Tab]编码&#10;权重会根据已有词条自动计算（即使输入有权重列也会被忽略）&#10;# 开头的注释行和空行会被自动过滤"
                    value={content}
                    onValueChange={setContent}
                    minRows={10}
                    className="font-mono text-sm"
                  />
                </div>

                <div>
                  <Button
                    color="primary"
                    onPress={handleImport}
                    isDisabled={!content || !phraseType}
                  >
                    开始导入
                  </Button>
                </div>
              </>
            )}

            {importing && (
              <div className="space-y-2">
                <Progress
                  value={progress}
                  showValueLabel
                  valueLabel={`已处理 ${currentLine} / 共 ${totalLines} 词`}
                  className="max-w-md"
                />
                <div className="flex items-center gap-4 mt-2">
                  <Chip color="success" variant="flat" size="sm">
                    成功: {successCount}
                  </Chip>
                  <Chip color="danger" variant="flat" size="sm">
                    失败: {errors.length}
                  </Chip>
                  {importSpeed > 0 && (
                    <Chip color="primary" variant="flat" size="sm">
                      速度: {importSpeed} 词/秒
                    </Chip>
                  )}
                </div>
              </div>
            )}

            {(successCount > 0 || errors.length > 0) && (
              <div className="space-y-3">
                {!importing && (
                  <div className="p-3 bg-content2 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Chip color="success" variant="flat" size="sm">
                        成功: {successCount}
                      </Chip>
                      <Chip color="danger" variant="flat" size="sm">
                        失败: {errors.length}
                      </Chip>
                      <Chip color="default" variant="flat" size="sm">
                        总计: {totalLines}
                      </Chip>
                    </div>
                  </div>
                )}

                {successCount > 0 && (
                  <div className="border border-success-200 dark:border-success-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-success-700 dark:text-success-400">
                        ✓ 成功导入 {successCount} 条词条
                      </span>
                    </div>
                  </div>
                )}

                {errors.length > 0 && (
                  <div className="border border-danger-200 dark:border-danger-800 rounded-lg overflow-hidden">
                    <div className="px-3 py-1.5 bg-danger-50 dark:bg-danger-900/20 border-b border-danger-200 dark:border-danger-800">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-danger-700 dark:text-danger-400">
                          导入错误
                        </span>
                        <span className="text-xs text-danger-600 dark:text-danger-500">{errors.length} 条</span>
                      </div>
                    </div>
                    <Listbox
                      aria-label="导入错误列表"
                      items={errors}
                      isVirtualized
                      virtualization={{
                        maxListboxHeight: 400,
                        itemHeight: 56
                      }}
                      classNames={{
                        base: "bg-danger-50/50 dark:bg-danger-900/10",
                        list: "p-0 divide-y divide-danger-100 dark:divide-danger-900/30"
                      }}
                      itemClasses={{
                        base: "px-3 py-2 data-[hover=true]:bg-danger-50 dark:data-[hover=true]:bg-danger-900/20",
                        wrapper: "gap-0.5",
                        title: "text-xs font-medium text-danger-700 dark:text-danger-400",
                        description: "text-xs text-danger-600/70 dark:text-danger-500/70 font-mono"
                      }}
                    >
                      {(err) => (
                        <ListboxItem
                          key={`error-${err.line}`}
                          textValue={err.error}
                          description={(err.word || err.code) ? `${err.word || '-'} → ${err.code || '-'}` : undefined}
                        >
                          {err.error}
                        </ListboxItem>
                      )}
                    </Listbox>
                  </div>
                )}
              </div>
            )}

            {!importing && (successCount > 0 || errors.length > 0) && (
              <div className="flex gap-2">
                <Button
                  color="primary"
                  onPress={() => {
                    setFile(null)
                    setContent('')
                    setSuccessCount(0)
                    setErrors([])
                    setProgress(0)
                    setCurrentLine(0)
                    setTotalLines(0)
                    setImportSpeed(0)
                    setStartTime(0)
                  }}
                >
                  重新导入
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">格式说明</h3>
          </CardHeader>
          <CardBody>
            <div className="space-y-3 text-sm text-default-600">
              <div>
                <p className="font-semibold text-default-900 mb-1">基本格式</p>
                <p>• 每行一条词条，使用 Tab 键分隔词和编码</p>
                <p>• 格式：<code className="bg-content2 px-2 py-1 rounded">词条[Tab]编码</code></p>
                <p>• 示例：<code className="bg-content2 px-2 py-1 rounded">并不比	bbb</code></p>
              </div>

              <div>
                <p className="font-semibold text-default-900 mb-1">YAML 格式支持</p>
                <p>• 支持带 YAML 前缀的文件，系统会自动去除前缀区域</p>
                <p>• <span className="font-semibold text-success">支持注释行</span>：以 # 开头的行会被自动忽略</p>
              </div>

              <div>
                <p className="font-semibold text-default-900 mb-1">验证规则</p>
                <p>• <span className="font-semibold text-warning">编码可为字母、分号+字母、单分号(;)或双分号(;;)，最长6字符</span></p>
                <p>• 词条和编码都不能为空</p>
                <p>• 空行会被自动忽略</p>
                <p>• <span className="font-semibold text-primary">编码不能重复</span>（同一编码只能对应一个词条）</p>
                <p>• <span className="font-semibold text-success">词条可以重复</span>（同一词条可以有不同编码）</p>
                <p>• 相同的词条和编码组合不能重复导入</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </main>
    </div>
  )
}
