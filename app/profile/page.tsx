'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader, Button, Input, Divider, Chip } from '@heroui/react'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import { useAuthStore } from '@/lib/store/auth'
import { BarChart3, FileText, GitPullRequest, Lock, Calendar, Clock, CheckCircle } from 'lucide-react'
import { BATCH_STATUS_MAP, STATUS_COLOR_MAP } from '@/lib/constants/status'

interface BatchStatus {
  Draft?: number
  Submitted?: number
  Approved?: number
  Rejected?: number
  Published?: number
}

interface PRStatus {
  Pending?: number
  Approved?: number
  Rejected?: number
}

interface RecentBatch {
  id: string
  description: string | null
  status: string
  createAt: string
  _count: {
    pullRequests: number
  }
}

interface UserStats {
  batchesCount: number
  pullRequestsCount: number
  batchesByStatus: BatchStatus
  pullRequestsByStatus: PRStatus
  recentBatches: RecentBatch[]
}

export default function ProfilePage() {
  const router = useRouter()
  const user = useAuthStore(state => state.user)
  const token = useAuthStore(state => state.token)
  const setAuth = useAuthStore(state => state.setAuth)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [editNickname, setEditNickname] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState(false)

  const { data: stats, isLoading } = useAPI<UserStats>('/api/user/stats')

  const handleEditProfile = () => {
    setEditNickname(user?.nickname || '')
    setEditEmail(user?.email || '')
    setIsEditingProfile(true)
    setProfileError('')
    setProfileSuccess(false)
  }

  const handleCancelEdit = () => {
    setIsEditingProfile(false)
    setEditNickname('')
    setEditEmail('')
    setProfileError('')
    setProfileSuccess(false)
  }

  const handleSaveProfile = async () => {
    setProfileError('')
    setProfileSuccess(false)
    setIsSavingProfile(true)

    try {
      const data = await apiRequest<{
        message: string
        user: { id: number; name: string; nickname?: string | null; email?: string | null }
      }>('/api/user/update-profile', {
        withAuth: true,
        method: 'POST',
        body: {
          nickname: editNickname,
          email: editEmail
        }
      })

      if (token) {
        setAuth(token, data.user)
      }

      setProfileSuccess(true)
      setIsEditingProfile(false)
    } catch (error) {
      console.error('Update profile error:', error)
      setProfileError(error instanceof Error ? error.message : '更新失败，请稍后重试')
    } finally {
      setIsSavingProfile(false)
    }
  }

  // Auto-hide success messages after 3 seconds
  useEffect(() => {
    if (profileSuccess) {
      const timer = setTimeout(() => {
        setProfileSuccess(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [profileSuccess])

  const handleChangePassword = async () => {
    setPasswordError('')
    setPasswordSuccess(false)

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('请填写所有密码字段')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('新密码与确认密码不一致')
      return
    }

    if (newPassword.length < 6) {
      setPasswordError('新密码长度至少为6个字符')
      return
    }

    setIsChangingPassword(true)

    try {
      await apiRequest<{ message: string }>('/api/user/change-password', {
        method: 'POST',
        body: {
          currentPassword,
          newPassword
        }
      })

      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      console.error('Change password error:', error)
      setPasswordError(error instanceof Error ? error.message : '修改密码失败，请稍后重试')
    } finally {
      setIsChangingPassword(false)
    }
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, "default" | "primary" | "secondary" | "success" | "warning" | "danger"> = {
      Draft: 'default',
      Submitted: 'primary',
      Approved: 'success',
      Rejected: 'danger',
      Published: 'secondary',
      Pending: 'warning'
    }
    return colors[status] || 'default'
  }

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Card>
          <CardBody>
            <p className="text-center text-default-500">请先登录</p>
            <Button
              color="primary"
              className="mt-4"
              onPress={() => router.push('/login')}
            >
              前往登录
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">我的资料</h1>
          <p className="text-default-500 mt-2">查看统计信息和管理账户设置</p>
        </div>

        <div className="grid gap-6">
          {/* User Info Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <h2 className="text-xl font-semibold">账户信息</h2>
                {!isEditingProfile && (
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    onPress={handleEditProfile}
                  >
                    编辑资料
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardBody>
              {isEditingProfile ? (
                <div className="space-y-4">
                  <Input
                    label="昵称"
                    placeholder="请输入昵称"
                    value={editNickname}
                    onChange={(e) => setEditNickname(e.target.value)}
                    isDisabled={isSavingProfile}
                  />
                  <Input
                    type="email"
                    label="邮箱"
                    placeholder="请输入邮箱"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    isDisabled={isSavingProfile}
                  />

                  {profileError && (
                    <p className="text-sm text-danger">{profileError}</p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      color="primary"
                      onPress={handleSaveProfile}
                      isLoading={isSavingProfile}
                      isDisabled={isSavingProfile}
                    >
                      保存
                    </Button>
                    <Button
                      variant="flat"
                      onPress={handleCancelEdit}
                      isDisabled={isSavingProfile}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-default-600">用户名</p>
                      <p className="text-lg font-semibold">{user.name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-default-600">昵称</p>
                      <p className="text-lg font-semibold">{user.nickname || "未设置"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-default-600">邮箱</p>
                      <p className="text-lg font-semibold">{user.email || "未设置"}</p>
                    </div>
                  </div>

                  {profileSuccess && (
                    <p className="text-sm text-success mt-4">资料更新成功！</p>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          {/* Statistics Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                <h2 className="text-xl font-semibold">数据统计</h2>
              </div>
            </CardHeader>
            <CardBody>
              {isLoading ? (
                <p className="text-center text-default-500">加载中...</p>
              ) : stats ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-primary-50 rounded-lg">
                      <FileText className="w-8 h-8 mx-auto mb-2 text-primary" />
                      <p className="text-2xl font-bold text-primary">{stats.batchesCount}</p>
                      <p className="text-sm text-default-600">提交批次</p>
                    </div>
                    <div className="text-center p-4 bg-success-50 rounded-lg">
                      <GitPullRequest className="w-8 h-8 mx-auto mb-2 text-success" />
                      <p className="text-2xl font-bold text-success">{stats.pullRequestsCount}</p>
                      <p className="text-sm text-default-600">修改提议</p>
                    </div>
                    <div className="text-center p-4 bg-warning-50 rounded-lg">
                      <Clock className="w-8 h-8 mx-auto mb-2 text-warning" />
                      <p className="text-2xl font-bold text-warning">
                        {stats.batchesByStatus.Submitted || 0}
                      </p>
                      <p className="text-sm text-default-600">待审核批次</p>
                    </div>
                    <div className="text-center p-4 bg-secondary-50 rounded-lg">
                      <CheckCircle className="w-8 h-8 mx-auto mb-2 text-secondary" />
                      <p className="text-2xl font-bold text-secondary">
                        {stats.batchesByStatus.Published || 0}
                      </p>
                      <p className="text-sm text-default-600">已发布批次</p>
                    </div>
                  </div>

                  <Divider />

                  {/* Recent Batches */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Calendar className="w-5 h-5" />
                      最近的批次
                    </h3>
                    {stats.recentBatches.length > 0 ? (
                      <div className="space-y-2">
                        {stats.recentBatches.map((batch) => (
                          <Card
                            key={batch.id}
                            isPressable
                            onPress={() => router.push(`/batch/${batch.id}`)}
                            className="hover:bg-default-100"
                          >
                            <CardBody className="py-3">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <p className="font-medium">
                                    {batch.description || '无描述'}
                                  </p>
                                  <p className="text-xs text-default-500 mt-1">
                                    {new Date(batch.createAt).toLocaleString('zh-CN')} · {batch._count.pullRequests} 个修改
                                  </p>
                                </div>
                                <Chip
                                  size="sm"
                                  color={STATUS_COLOR_MAP[batch.status] || 'default'}
                                  variant="flat"
                                >
                                  {BATCH_STATUS_MAP[batch.status] || batch.status}
                                </Chip>
                              </div>
                            </CardBody>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-default-500 py-4">暂无批次记录</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-center text-default-500">加载失败</p>
              )}
            </CardBody>
          </Card>

          {/* Change Password Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                <h2 className="text-xl font-semibold">修改密码</h2>
              </div>
            </CardHeader>
            <CardBody>
              <div className="space-y-4 max-w-md">
                <Input
                  type="password"
                  label="当前密码"
                  placeholder="请输入当前密码"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  isDisabled={isChangingPassword}
                />
                <Input
                  type="password"
                  label="新密码"
                  placeholder="请输入新密码（至少6个字符）"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  isDisabled={isChangingPassword}
                />
                <Input
                  type="password"
                  label="确认新密码"
                  placeholder="请再次输入新密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  isDisabled={isChangingPassword}
                />

                {passwordError && (
                  <p className="text-sm text-danger">{passwordError}</p>
                )}

                {passwordSuccess && (
                  <p className="text-sm text-success">密码修改成功！</p>
                )}

                <Button
                  color="primary"
                  onPress={handleChangePassword}
                  isLoading={isChangingPassword}
                  isDisabled={isChangingPassword}
                >
                  修改密码
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
