'use client'

import { useState } from 'react'
import { Card, CardBody, CardHeader, Button, Progress, Textarea } from '@heroui/react'
import Navbar from '@/app/components/Navbar'
import { apiRequest } from '@/lib/hooks/useSWR'

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [content, setContent] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = event.target?.result as string
        setContent(text)
      }
      reader.readAsText(selectedFile)
    }
  }

  const handleImport = async () => {
    if (!content) {
      alert('请先选择文件或输入内容')
      return
    }

    setImporting(true)
    setProgress(0)
    setResult(null)

    try {
      const lines = content.split('\n').filter(line => line.trim())
      const total = lines.length
      let success = 0
      let failed = 0

      // Process in batches
      const batchSize = 50
      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, Math.min(i + batchSize, lines.length))

        const data = await apiRequest<{ success: number; failed: number }>(
          '/api/admin/import/phrases',
          {
            method: 'POST',
            body: { lines: batch }
          }
        )

        success += data.success || 0
        failed += data.failed || 0

        setProgress(Math.min(((i + batchSize) / total) * 100, 100))
      }

      setResult({ success, failed })
    } catch (error) {
      console.error(error)
      alert('导入失败')
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
              <div>
                <label className="block text-sm font-medium mb-2">
                  选择 TXT 文件（每行格式：词\t编码）
                </label>
                <input
                  type="file"
                  accept=".txt"
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

              <div>
                <label className="block text-sm font-medium mb-2">
                  或直接粘贴内容
                </label>
                <Textarea
                  placeholder="每行一条，格式：词\t编码"
                  value={content}
                  onValueChange={setContent}
                  minRows={10}
                  className="font-mono text-sm"
                />
              </div>

              {importing && (
                <Progress
                  value={progress}
                  label="导入进度"
                  showValueLabel
                  className="max-w-md"
                />
              )}

              {result && (
                <div className="p-4 bg-content2 rounded-lg">
                  <p className="text-success font-semibold mb-1">
                    成功导入: {result.success} 条
                  </p>
                  <p className="text-danger font-semibold">
                    导入失败: {result.failed} 条
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  color="primary"
                  onPress={handleImport}
                  isLoading={importing}
                  isDisabled={!content || importing}
                >
                  开始导入
                </Button>
                <Button
                  variant="flat"
                  onPress={() => {
                    setFile(null)
                    setContent('')
                    setResult(null)
                    setProgress(0)
                  }}
                  isDisabled={importing}
                >
                  清空
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">格式说明</h3>
            </CardHeader>
            <CardBody>
              <div className="space-y-2 text-sm text-default-600">
                <p>• 每行一条词条，使用 Tab 键分隔词和编码</p>
                <p>• 格式：<code className="bg-content2 px-2 py-1 rounded">词\t编码</code></p>
                <p>• 示例：<code className="bg-content2 px-2 py-1 rounded">你好\tnihao</code></p>
                <p>• 空行会被自动忽略</p>
                <p>• 重复的词条会被跳过</p>
              </div>
            </CardBody>
          </Card>
        </main>
      </div>
    </>
  )
}
