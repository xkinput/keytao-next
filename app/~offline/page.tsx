export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full border border-default-200 bg-content1 px-3 py-1 text-xs text-default-500">
        KeyTao PWA
      </div>
      <h1 className="text-3xl font-bold tracking-tight">当前处于离线状态</h1>
      <p className="max-w-xl text-sm leading-6 text-default-500">
        网络恢复后页面会自动刷新。已经缓存过的静态页面和资源仍可继续访问，但依赖在线接口或远程方案下载的功能会暂时不可用。
      </p>
    </main>
  )
}