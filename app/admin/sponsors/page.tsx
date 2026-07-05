'use client'

import { useState } from 'react'
import { Button, Input, Select, SelectItem, Switch, Chip, Spinner } from '@/lib/heroui-compat'
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import { useAPI } from '@/lib/hooks/useSWR'
import { apiRequest } from '@/lib/hooks/useSWR'
import { mutate as globalMutate } from 'swr'
import toast from 'react-hot-toast'

interface Sponsor {
  id: number
  payerName: string
  remark: string | null
  amount: number
  message: string | null
  channel: string
  visible: boolean
  createdAt: string
}

const channelOptions = [
  { value: 'wechat', label: '微信' },
  { value: 'alipay', label: '支付宝' },
  { value: 'other', label: '其他' },
]

const channelColor: Record<string, 'success' | 'primary' | 'default'> = {
  wechat: 'success',
  alipay: 'primary',
  other: 'default',
}

const SPONSORS_KEY = '/api/sponsors'

export default function AdminSponsorsPage() {
  const { data: sponsors, isLoading, mutate } = useAPI<Sponsor[]>('/api/admin/sponsors')

  const [form, setForm] = useState({
    payerName: '',
    remark: '',
    amount: '',
    message: '',
    channel: 'wechat',
    visible: true,
  })
  const [submitting, setSubmitting] = useState(false)

  const handleAdd = async () => {
    if (!form.payerName.trim()) return toast.error('付款姓名不能为空')
    const amount = parseInt(form.amount)
    if (!amount || amount <= 0) return toast.error('金额必须为正整数')

    setSubmitting(true)
    try {
      await apiRequest('/api/sponsors', {
        method: 'POST',
        body: {
          payerName: form.payerName.trim(),
          remark: form.remark.trim() || null,
          amount,
          message: form.message.trim() || null,
          channel: form.channel,
          visible: form.visible,
        },
        withAuth: true,
      })
      toast.success('添加成功')
      setForm({ payerName: '', remark: '', amount: '', message: '', channel: 'wechat', visible: true })
      mutate()
      globalMutate((key: unknown) => Array.isArray(key) && key[0] === SPONSORS_KEY, undefined, { revalidate: true })
    } catch {
      toast.error('添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleVisible = async (id: number, visible: boolean) => {
    try {
      await apiRequest(`/api/sponsors/${id}`, { method: 'PATCH', body: { visible }, withAuth: true })
      mutate()
      globalMutate((key: unknown) => Array.isArray(key) && key[0] === SPONSORS_KEY, undefined, { revalidate: true })
    } catch {
      toast.error('操作失败')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除该赞助记录？')) return
    try {
      await apiRequest(`/api/sponsors/${id}`, { method: 'DELETE', withAuth: true })
      toast.success('已删除')
      mutate()
      globalMutate((key: unknown) => Array.isArray(key) && key[0] === SPONSORS_KEY, undefined, { revalidate: true })
    } catch {
      toast.error('删除失败')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <h1 className="text-xl font-bold">赞助者管理</h1>

      {/* Add form */}
      <div className="rounded-2xl border border-default-200 bg-content1 p-5 flex flex-col gap-3">
        <p className="text-sm font-semibold text-default-600">录入赞助</p>
        <div className="flex flex-wrap gap-2">
          <Input
            label="付款姓名 *" size="sm" className="flex-1 min-w-32"
            value={form.payerName} onValueChange={(v: string) => setForm(f => ({ ...f, payerName: v }))}
          />
          <Input
            label="备注名（展示用）" size="sm" className="flex-1 min-w-32"
            placeholder="留空则展示付款姓名"
            value={form.remark} onValueChange={(v: string) => setForm(f => ({ ...f, remark: v }))}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            label="金额（元）*" size="sm" type="number" className="w-28 shrink-0"
            value={form.amount} onValueChange={(v: string) => setForm(f => ({ ...f, amount: v }))}
          />
          <Select
            label="渠道" size="sm" className="w-28 shrink-0"
            selectedKeys={[form.channel]}
            onSelectionChange={keys => setForm(f => ({ ...f, channel: Array.from(keys)[0] as string }))}
            disallowEmptySelection
          >
            {channelOptions.map(o => <SelectItem key={o.value}>{o.label}</SelectItem>)}
          </Select>
          <Input
            label="留言（可选）" size="sm" className="flex-1 min-w-40"
            value={form.message} onValueChange={(v: string) => setForm(f => ({ ...f, message: v }))}
          />
          <div className="flex items-center gap-2 self-end pb-1">
            <span className="text-xs text-default-500">公开</span>
            <Switch size="sm" isSelected={form.visible} onValueChange={(v: boolean) => setForm(f => ({ ...f, visible: v }))} />
          </div>
        </div>
        <Button
          color="primary" size="sm" startContent={<Plus className="w-4 h-4" />}
          isLoading={submitting} onPress={handleAdd} className="self-start"
        >
          添加
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : !sponsors || sponsors.length === 0 ? (
        <p className="text-sm text-default-400 text-center py-6">暂无记录</p>
      ) : (
        <div className="rounded-2xl border border-default-200 bg-content1 overflow-hidden divide-y divide-default-100">
          {sponsors.map(s => (
            <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${!s.visible ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{s.remark?.trim() || s.payerName}</span>
                  {s.remark?.trim() && <span className="text-xs text-default-400">({s.payerName})</span>}
                  <Chip size="sm" color={channelColor[s.channel] ?? 'default'} variant="flat" className="h-4 text-[10px]">
                    {channelOptions.find(o => o.value === s.channel)?.label ?? s.channel}
                  </Chip>
                  <span className="text-xs text-pink-500 font-semibold">¥{s.amount}</span>
                </div>
                {s.message && <p className="text-xs text-default-400 mt-0.5 truncate">{s.message}</p>}
                <p className="text-[10px] text-default-300 mt-0.5">
                  {new Date(s.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm" variant="light" isIconOnly className="w-7 h-7 min-w-0"
                  onPress={() => toggleVisible(s.id, !s.visible)}
                >
                  {s.visible ? <Eye className="w-3.5 h-3.5 text-default-400" /> : <EyeOff className="w-3.5 h-3.5 text-default-300" />}
                </Button>
                <Button
                  size="sm" variant="light" color="danger" isIconOnly className="w-7 h-7 min-w-0"
                  onPress={() => handleDelete(s.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
