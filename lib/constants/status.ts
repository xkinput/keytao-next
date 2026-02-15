// Batch status mapping
export const BATCH_STATUS_MAP: Record<string, string> = {
  Draft: '草稿',
  Submitted: '已提交',
  Approved: '已批准',
  Rejected: '已拒绝',
  Published: '已发布'
}

// Pull request status mapping
export const PR_STATUS_MAP: Record<string, string> = {
  Pending: '待审核',
  Approved: '已通过',
  Rejected: '已拒绝'
}

// Issue status mapping
export const ISSUE_STATUS_MAP: Record<string, string> = {
  Open: '打开',
  Closed: '关闭',
  Resolved: '已解决'
}

// Phrase status mapping
export const PHRASE_STATUS_MAP: Record<string, string> = {
  Finish: '已完成',
  Draft: '草稿',
  Reject: '已拒绝'
}

// Generic status color mapping
export const STATUS_COLOR_MAP: Record<string, 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'secondary'> = {
  Draft: 'default',
  Submitted: 'primary',
  Approved: 'success',
  Rejected: 'danger',
  Published: 'secondary',
  Pending: 'primary',
  Open: 'primary',
  Closed: 'default',
  Resolved: 'success',
  Finish: 'success',
  Reject: 'danger'
}

// Phrase status color mapping (different from batch Draft color)
export const PHRASE_STATUS_COLOR_MAP: Record<string, 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'secondary'> = {
  Finish: 'success',
  Draft: 'warning',
  Reject: 'danger'
}
