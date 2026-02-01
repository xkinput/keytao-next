'use client'

import { useState } from 'react'
import { Card, CardBody, CardHeader, Button, Progress, Textarea, Chip, Listbox, ListboxItem, Select, SelectItem } from '@heroui/react'
import Navbar from '@/app/components/Navbar'
import { apiRequest } from '@/lib/hooks/useSWR'

type PhraseType = 'Single' | 'Phrase' | 'Sentence' | 'Symbol' | 'Link' | 'Poem' | 'Other'

const PHRASE_TYPES: Array<{ value: PhraseType; label: string }> = [
  { value: 'Single', label: '单字' },
  { value: 'Phrase', label: '词组' },
  { value: 'Sentence', label: '短句' },
  { value: 'Symbol', label: '符号' },
  { value: 'Link', label: '链接' },
  { value: 'Poem', label: '诗句' },
  { value: 'Other', label: '其他' },
]

interface ImportError {
  line: number
  word?: string
  code?: string
  error: string
}

interface SuccessItem {
  line: number
  word: string
  code: string
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [content, setContent] = useState('')
  const [phraseType, setPhraseType] = useState<PhraseType>('Phrase')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentLine, setCurrentLine] = useState(0)
  const [totalLines, setTotalLines] = useState(0)
  const [successCount, setSuccessCount] = useState(0)
  const [successItems, setSuccessItems] = useState<SuccessItem[]>([])
  const [errors, setErrors] = useState<ImportError[]>([])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = event.target?.result as string
        // Remove YAML frontmatter if exists
        const cleanedText = removeYamlFrontmatter(text)
        setContent(cleanedText)

        // Auto-detect phrase type based on first two lines
        const lines = cleanedText.split('\n').filter(line => line.trim())
        if (lines.length >= 2) {
          const firstWord = lines[0].split('\t')[0]?.trim()
          const secondWord = lines[1].split('\t')[0]?.trim()

          // Check if both words are single character
          if (firstWord && secondWord && firstWord.length === 1 && secondWord.length === 1) {
            setPhraseType('Single')
          } else {
            setPhraseType('Phrase')
          }
        }
      }
      reader.readAsText(selectedFile)
    }
  }

  const removeYamlFrontmatter = (text: string): string => {
    // Check if text starts with YAML frontmatter (--- ... --- or --- ... ...)
    // Matches: ---\n[content]\n... or ---\n[content]\n---
    const yamlPattern = /^---\s*\n[\s\S]*?\n(\.\.\.|\-\-\-)\s*\n/
    return text.replace(yamlPattern, '')
  }

  const handleImport = async () => {
    if (!content) {
      alert('请先选择文件或输入内容')
      return
    }

    setImporting(true)
    setProgress(0)
    setCurrentLine(0)
    setSuccessCount(0)
    setSuccessItems([])
    setErrors([])

    try {
      // Remove YAML frontmatter before processing
      const cleanedContent = removeYamlFrontmatter(content)
      const lines = cleanedContent.split('\n').filter(line => line.trim())
      setTotalLines(lines.length)

      // Process in batches of 1000
      const batchSize = 1000
      let processedCount = 0

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

          // Process results
          response.results.forEach((result, idx) => {
            const lineNumber = i + idx + 1

            if (result.success) {
              setSuccessCount(prev => prev + 1)
              if (result.word && result.code) {
                const word = result.word
                const code = result.code
                setSuccessItems(prev => [...prev, {
                  line: lineNumber,
                  word,
                  code
                }])
              }
            } else if (result.error) {
              setErrors(prev => [...prev, {
                line: lineNumber,
                word: result.word,
                code: result.code,
                error: result.error || '未知错误'
              }])
            }
            processedCount++
            setCurrentLine(processedCount)
            setProgress((processedCount / lines.length) * 100)
          })
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
    }
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
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
                      <label className="block text-sm font-medium mb-2">
                        词条类型
                      </label>
                      <Select
                        selectedKeys={[phraseType]}
                        onChange={(e) => setPhraseType(e.target.value as PhraseType)}
                        label="选择类型"
                        placeholder="请选择词条类型"
                      >
                        {PHRASE_TYPES.map((type) => (
                          <SelectItem key={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      或直接粘贴内容
                    </label>
                    <Textarea
                      placeholder="每行一条，格式：词条[Tab]编码&#10;支持 YAML 前缀，系统会自动去除"
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
                      isDisabled={!content}
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

                  {successItems.length > 0 && (
                    <div className="border border-success-200 dark:border-success-800 rounded-lg overflow-hidden">
                      <div className="px-3 py-1.5 bg-success-50 dark:bg-success-900/20 border-b border-success-200 dark:border-success-800">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-success-700 dark:text-success-400">
                            成功导入
                          </span>
                          <span className="text-xs text-success-600 dark:text-success-500">{successCount} 条</span>
                        </div>
                      </div>
                      <Listbox
                        aria-label="成功导入列表"
                        items={successItems}
                        isVirtualized
                        virtualization={{
                          maxListboxHeight: 160,
                          itemHeight: 28
                        }}
                        classNames={{
                          base: "bg-success-50/50 dark:bg-success-900/10",
                          list: "p-0"
                        }}
                        itemClasses={{
                          base: "px-3 py-1 data-[hover=true]:bg-success-100 dark:data-[hover=true]:bg-success-900/30",
                          title: "text-xs text-success-700 dark:text-success-400 font-mono"
                        }}
                      >
                        {(item) => (
                          <ListboxItem key={`success-${item.line}`} textValue={`${item.word} ${item.code}`}>
                            {item.word} → {item.code}
                          </ListboxItem>
                        )}
                      </Listbox>
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
                      setSuccessItems([])
                      setErrors([])
                      setProgress(0)
                      setCurrentLine(0)
                      setTotalLines(0)
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
                </div>

                <div>
                  <p className="font-semibold text-default-900 mb-1">验证规则</p>
                  <p>• <span className="font-semibold text-warning">编码必须是纯字母，最长6个字母</span></p>
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
    </>
  )
}
