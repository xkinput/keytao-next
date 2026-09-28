import { Alert, Card, CardBody, Code, Link } from '@/lib/heroui-compat'

export default function LinuxGuide() {
  return (
    <>
      <Card className="min-w-0">
        <CardBody className="space-y-4 text-sm text-default-700">
          <h2 className="text-xl font-semibold">1. 推荐：安装 KeyTao 应用</h2>
          <p>
            从 <Link href="https://github.com/xkinput/keytao-app/releases" isExternal showAnchorIcon>KeyTao App Releases</Link> 下载对应架构的 deb/rpm，
            系统包名为 <Code>key-tao</Code>。以下指南适用于包含自启动项与 KDE 启动项的新包；旧包缺少这些文件时，请先升级。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="text-left text-default-600 mb-2">
                计划沿用的附件名，最终以 Release 附件为准；<Code>{'<version>'}</Code> 不含前缀 v。
              </caption>
              <thead>
                <tr className="border-b border-default-200">
                  <th scope="col" className="p-2">架构</th>
                  <th scope="col" className="p-2">Debian / Ubuntu</th>
                  <th scope="col" className="p-2">Fedora 等 rpm 发行版</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-default-200">
                  <th scope="row" className="p-2">x64（x86_64）</th>
                  <td className="p-2"><Code>{'keytao-app-<version>-linux-x64.deb'}</Code></td>
                  <td className="p-2"><Code>{'keytao-app-<version>-linux-x64.rpm'}</Code></td>
                </tr>
                <tr>
                  <th scope="row" className="p-2">arm64（aarch64）</th>
                  <td className="p-2"><Code>{'keytao-app-<version>-linux-arm64.deb'}</Code></td>
                  <td className="p-2"><Code>{'keytao-app-<version>-linux-arm64.rpm'}</Code></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>将文件名换成实际下载的文件；arm64 用户同时替换架构。</p>
          <div className="bg-default-50 rounded-lg p-4 space-y-2 border border-default-200">
            <p className="font-semibold">Debian / Ubuntu</p>
            <pre className="overflow-x-auto"><code>{'sudo apt install "./keytao-app-<version>-linux-x64.deb"'}</code></pre>
            <p className="font-semibold">Fedora（使用 dnf 的系统）</p>
            <pre className="overflow-x-auto"><code>{'sudo dnf install "./keytao-app-<version>-linux-x64.rpm"'}</code></pre>
          </div>
          <ul className="list-disc pl-5 space-y-2">
            <li><Code>keytao-app</Code>：安装、更新、部署方案并查看输入法状态的图形应用。</li>
            <li><Code>keytao-ime</Code>：系统输入法守护进程，不依赖 Fcitx5 进程。</li>
            <li>包内自带 librime、OpenCC 数据、rime-plugins 和基础 rime-data，无需另装系统 librime。</li>
            <li><Code className="break-all">/usr/share/ibus/component/keytao.xml</Code>：供系统 IBus 发现并按需启动 KeyTao。</li>
            <li><Code className="break-all">/etc/xdg/autostart/keytao-ime.desktop</Code>：登录自启动，设置 <Code>NotShowIn=GNOME;</Code>；GNOME 由系统 IBus 启动。</li>
            <li><Code className="break-all">/usr/share/applications/keytao-wayland-launcher.desktop</Code>：供 KDE 虚拟键盘设置选择。</li>
          </ul>
          <Alert color="primary" description="装好应用包后，还需在 App 中安装并部署键道方案，再按桌面环境启用输入法。" />
          <details className="bg-default-50 rounded-lg p-4 border border-default-200">
            <summary className="cursor-pointer font-semibold">Nix / NixOS 用户</summary>
            <p className="mt-3">
              可使用仓库的 <Link href="https://github.com/xkinput/keytao-app/blob/main/flake.nix" isExternal showAnchorIcon>flake</Link> 与{' '}
              <Link href="https://github.com/xkinput/keytao-app/blob/main/nix/nixos.nix" isExternal showAnchorIcon>NixOS module</Link>，
              导入 <Code className="break-all">inputs.keytao-app.nixosModules.default</Code> 并设置 <Code>services.keytao-app.enable = true;</Code>。
              module 安装程序并设置 <Code>XMODIFIERS=@im=keytao</Code>，但不能据此认为 deb/rpm 的新增启动项已在 Nix 中安装。
            </p>
          </details>
        </CardBody>
      </Card>

      <Card className="min-w-0">
        <CardBody className="space-y-4 text-sm text-default-700">
          <h2 className="text-xl font-semibold">2. 按桌面环境启用</h2>
          <p>先在终端确认桌面与会话类型：</p>
          <pre className="bg-default-50 rounded-lg p-4 overflow-x-auto border border-default-200"><code>{`printf '%s\\n' "$XDG_CURRENT_DESKTOP" "$XDG_SESSION_TYPE"`}</code></pre>
          <section className="bg-default-50 rounded-lg p-4 space-y-3 border border-default-200">
            <h3 className="font-semibold">KDE Plasma · Wayland</h3>
            <ol className="list-decimal pl-5 space-y-2">
              <li>打开「系统设置 → 键盘 → 虚拟键盘」，选择「KeyTao / 键道输入法 (Wayland)」。</li>
              <li>按下一节设置 <Code>XMODIFIERS=@im=keytao</Code>，供 XWayland 应用使用；不要全局设置 <Code>GTK_IM_MODULE</Code> 或 <Code>QT_IM_MODULE</Code>。</li>
              <li>注销后重新登录，再打开应用测试输入。</li>
            </ol>
            <p>KWin 单独启动原生 Wayland 输入进程；包的自启动项另开普通 <Code>keytao-ime</Code>，服务 XIM/IBus 客户端。两类进程同时存在是正常现象；手动运行 daemon 不能代替 KWin 虚拟键盘进程。</p>
            <p>列表中没有 KeyTao 时，先检查启动项：</p>
            <pre className="overflow-x-auto"><code>ls /usr/share/applications/keytao-wayland-launcher.desktop</code></pre>
            <p>文件存在但选择未保存时，Plasma 6 可执行以下命令，然后注销重登：</p>
            <pre className="overflow-x-auto"><code>{'kwriteconfig6 --file "$HOME/.config/kwinrc" --group Wayland --key InputMethod keytao-wayland-launcher.desktop'}</code></pre>
          </section>
          <section className="bg-default-50 rounded-lg p-4 space-y-3 border border-default-200">
            <h3 className="font-semibold">KDE Plasma · X11</h3>
            <p>使用普通 <Code>keytao-ime</Code> 的 XIM/IBus 前端，无需配置 Wayland 虚拟键盘。按下一节设置 XIM 环境变量，注销重登后由自启动项运行；需要 IBus 模块的应用再单独配置。</p>
          </section>
          <section className="bg-default-50 rounded-lg p-4 space-y-3 border border-default-200">
            <h3 className="font-semibold">GNOME · Wayland / X11</h3>
            <ol className="list-decimal pl-5 space-y-2">
              <li>两种会话都使用系统 IBus 的 KeyTao engine。安装包后注销重登，让 IBus 读取 <Code>keytao.xml</Code>。</li>
              <li>打开「设置 → 键盘 → 输入源 → 添加」，在「其他 / 中文」中选择「KeyTao / 键道」；也可用 <Code>ibus-setup</Code> 添加。</li>
              <li><Code>Super+Space</Code> 切换到 KeyTao，<Code>Shift+Super+Space</Code> 切到上一个输入源。</li>
            </ol>
            <p>没有找到输入源时，在当前 GNOME 会话中检查：</p>
            <pre className="overflow-x-auto"><code>{'ls /usr/share/ibus/component/keytao.xml\nibus restart\nibus list-engine | grep keytao'}</code></pre>
            <Alert color="warning" description="保留系统 ibus-daemon。GNOME 不使用 KeyTao 通用 Wayland 后端或 KDE launcher，也不要套用下文非 GNOME 的 IBUS_ADDRESS 覆盖；KeyTao 需要连接系统 IBus 总线。" />
            <p>有系统 IBus 面板时使用系统候选窗，KeyTao 自绘主题不能完全控制其外观。</p>
          </section>
          <section className="bg-default-50 rounded-lg p-4 space-y-3 border border-default-200">
            <h3 className="font-semibold">其他桌面</h3>
            <ul className="list-disc pl-5 space-y-2">
              <li>Unity、Budgie、Pantheon、Cinnamon：使用 IBus engine，通过桌面输入源或 <Code>ibus-setup</Code> 选择 KeyTao，并保留系统 IBus。</li>
              <li>其他 Wayland 会话：合成器须支持 <Code>input-method-v2</Code>；有 XWayland 时还会启用 XIM/IBus，纯 Wayland 只启用 Wayland 前端。仅使用 Wayland 不代表兼容。</li>
              <li>其他 X11 会话：使用 XIM/IBus，按下一节设置环境变量。</li>
            </ul>
            <p>包提供非 GNOME 的 XDG 自启动。如果窗口管理器不执行 XDG 自启动，需在它的会话启动配置中运行 <Code>keytao-ime</Code>；诊断时也可在该图形会话的终端运行。</p>
          </section>
        </CardBody>
      </Card>

      <Card className="min-w-0">
        <CardBody className="space-y-4 text-sm text-default-700">
          <h2 className="text-xl font-semibold">3. 环境变量：设置什么、写在哪里</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>X11 / XWayland 应用使用 KeyTao XIM：设置 <Code>XMODIFIERS=@im=keytao</Code>，前提是 daemon 已启用 XIM。</li>
            <li>KDE、GTK 原生 Wayland：不要全局设置 <Code>GTK_IM_MODULE</Code> / <Code>QT_IM_MODULE</Code>，避免把 X11 应用的设置扩散到整个会话。</li>
            <li>非 GNOME 的 GTK / Qt 应用需要 IBus 兼容路径时，只为目标应用设置 <Code>GTK_IM_MODULE=ibus</Code> / <Code>QT_IM_MODULE=ibus</Code>；GTK 还需可用的 <Code>im-ibus.so</Code>。</li>
            <li>非 GNOME 应用需显式连接 KeyTao IBus 兼容层时，只在应用启动脚本中将 <Code>IBUS_ADDRESS</Code> 设为当前 session bus，见下方 QQ 示例。</li>
            <li>GNOME 沿用桌面管理的 IBus 环境，不照搬非 GNOME 应用的启动脚本。</li>
          </ul>
          <p>普通安装无需设置 <Code>RIME_LIB_DIR</Code>、<Code>LD_LIBRARY_PATH</Code> 或共享数据目录变量，程序会定位包内 runtime。</p>
          <p className="font-semibold">选择当前会话确实会读取的一处保存，不需要每个文件都写：</p>
          <div className="bg-default-50 rounded-lg p-4 space-y-3 border border-default-200">
            <h3 className="font-semibold"><Code>~/.config/environment.d/keytao.conf</Code></h3>
            <p>使用 <Code>NAME=value</Code>，不写 export。已核对的图形会话范围为 GDM 或 Plasma 5.22+；其他登录方式不能直接套用。适用时创建此文件，写入：</p>
            <pre className="overflow-x-auto"><code>XMODIFIERS=@im=keytao</code></pre>
          </div>
          <div className="bg-default-50 rounded-lg p-4 space-y-3 border border-default-200">
            <h3 className="font-semibold"><Code>~/.profile</Code></h3>
            <p>仅在已确认登录 shell / 图形会话读取它时适用。各登录管理器的读取链路未逐一核实，不能当作通用兜底；适用时添加：</p>
            <pre className="overflow-x-auto"><code>{'export XMODIFIERS="@im=keytao"'}</code></pre>
          </div>
          <p><Code>/etc/environment</Code> 的加载范围未核实，仓库也没有配套配置，因此不提供通用写入步骤。需先确认发行版的会话配置规则，不能假定它与前两者等价。</p>
          <Alert
            color="warning"
            title="保存后注销并重新登录，再重新打开目标应用"
            description={<>仅在终端 <Code>source ~/.profile</Code> 不会更新已运行桌面和应用的环境。新会话用 <Code>printenv XMODIFIERS</Code> 核对；若未继承，检查文件是否被加载，必要时重启。</>}
          />
        </CardBody>
      </Card>

      <Card className="min-w-0">
        <CardBody className="space-y-4 text-sm text-default-700">
          <h2 className="text-xl font-semibold">4. 启动、安装方案与日常使用</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>从应用菜单打开 KeyTao，或在终端运行 <Code>keytao-app</Code>。</li>
            <li>首次打开按引导选择键道方案和版本，点击「安装方案」，等待完成。</li>
            <li>点击「部署方案」，确认完成后结束引导，再按上面的桌面步骤启用 KeyTao。</li>
            <li>在输入框中测试：单独按下再松开 <Code>Shift</Code> 切换中英文，<Code>F4</Code> 打开 Rime 方案 / 选项菜单。</li>
            <li>更新方案或修改配置后，回到「方案」页点击「部署」；「检查本地」可刷新方案状态。</li>
          </ol>
          <p>部署后 App 写入重载通知，daemon 读取后加载新方案；IBus 路径中已有的预编辑内容可能到下一次按键才刷新。新包在退出 App 后保留 <Code>keytao-ime</Code>，不必一直开着 App 窗口。</p>
          <p>在「输入法」页查看「Linux 系统输入法」状态。KDE Wayland 重点确认 <Code>KWIN_WAYLAND</Code> 和 <Code>XIM+IBUS</Code> 两类进程；仅显示“运行中”不能证明所有应用的输入路径均已启用。也可执行：</p>
          <pre className="bg-default-50 rounded-lg p-4 overflow-x-auto border border-default-200"><code>pgrep -af keytao-ime</code></pre>
        </CardBody>
      </Card>

      <Card className="min-w-0">
        <CardBody className="space-y-4 text-sm text-default-700">
          <h2 className="text-xl font-semibold">5. 数据与日志</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>方案、词库、用户配置：<Code>~/.local/share/keytao</Code>；设置 <Code>XDG_DATA_HOME</Code> 时为 <Code>$XDG_DATA_HOME/keytao</Code>。</li>
            <li>重载通知：数据目录内的 <Code>keytao-ime.reload</Code>。</li>
            <li>日志目录：<Code>~/.local/state/keytao/log</Code>；<Code>XDG_STATE_HOME</Code> 为有效绝对路径时，使用 <Code>$XDG_STATE_HOME/keytao/log</Code>。</li>
            <li>当前日志：日志目录内的 <Code>keytao-ime.log</Code>，按日滚动。</li>
          </ul>
          <p>默认路径下查看日志：</p>
          <pre className="bg-default-50 rounded-lg p-4 overflow-x-auto border border-default-200"><code>{'tail -f "$HOME/.local/state/keytao/log/keytao-ime.log"'}</code></pre>
          <Alert color="warning" description="KeyTao 与手动 ibus-rime 的数据目录独立。把方案放进 ibus-rime 目录后，keytao-ime 不会自动读取。" />
        </CardBody>
      </Card>

      <Card className="min-w-0">
        <CardBody className="space-y-4 text-sm text-default-700">
          <h2 className="text-xl font-semibold">6. 常见问题与避坑</h2>
          <details className="bg-default-50 rounded-lg p-4 border border-default-200">
            <summary className="cursor-pointer font-semibold">登录后没有输入法，或只有部分应用能输入</summary>
            <div className="mt-3 space-y-3">
              <p>先看进程和日志，再确认桌面启用方式，以及应用运行于 Wayland 还是 X11 / XWayland。KDE 原生 Wayland 与 XWayland 分属不同进程；GNOME 要检查输入源是否选中 KeyTao。</p>
              <p>日志中可查找 <Code>KWin Virtual Keyboard mode</Code>、<Code>X11 XIM server running</Code>、<Code>IBus D-Bus backend started</Code>，定位已启动的前端。</p>
              <p>非 GNOME 图形会话需要详细日志时可运行：</p>
              <pre className="overflow-x-auto"><code>RUST_LOG=keytao_ime=trace keytao-ime</code></pre>
              <p>这会替换普通 daemon，仍不能代替 KWin 私有进程。</p>
            </div>
          </details>
          <details className="bg-default-50 rounded-lg p-4 border border-default-200">
            <summary className="cursor-pointer font-semibold">IBus / Fcitx5 冲突</summary>
            <ul className="mt-3 list-disc pl-5 space-y-2">
              <li>非 GNOME、使用 KeyTao IBus 兼容层时，不要同时启动另一套 <Code>ibus-daemon</Code>，以免争用 <Code>org.freedesktop.IBus</Code>；对应日志为 <Code>IBus: failed to request IBus name</Code>。</li>
              <li>停用其他输入法的自动启动，避免 Fcitx5 等占用 Wayland 输入法槽位；<Code>zwp_input_method_v2: Unavailable</Code> 表示该前端不可用。KDE 虚拟键盘应选择 KeyTao。</li>
              <li><strong>GNOME 和其他使用 IBus engine 的桌面必须保留系统 IBus。</strong>无需为 KeyTao 再运行 Fcitx5 或选择 ibus-rime。</li>
            </ul>
          </details>
          <details className="bg-default-50 rounded-lg p-4 border border-default-200">
            <summary className="cursor-pointer font-semibold">Chromium / Electron 原生 Wayland 排查</summary>
            <div className="mt-3 space-y-3">
              <p>以下是文档已核对的上游参数规则，未实测 KeyTao 与这些应用的原生 Wayland 组合，不代表逐应用兼容承诺。</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>应用已运行于原生 Wayland 时，需添加 <Code>--enable-wayland-ime</Code>。</li>
                <li>Chromium 可配 <Code>--wayland-text-input-version=3</Code>；KWin 上优先用 <Code>--wayland-text-input-version=1</Code>。</li>
                <li>文档所核对的 Electron 只支持 text-input-v1，不能照搬 Chromium 的 v3 参数；原生路径不通时改走 XWayland / IBus。</li>
              </ul>
              <Link href="https://fcitx-im.org/wiki/Using_Fcitx_5_on_Wayland" isExternal showAnchorIcon>上游参数说明</Link>
            </div>
          </details>
          <details className="bg-default-50 rounded-lg p-4 border border-default-200">
            <summary className="cursor-pointer font-semibold">QQ / 微信的 XWayland 启动脚本（非 GNOME）</summary>
            <div className="mt-3 space-y-3">
              <p>仅适用于非 GNOME、使用 KeyTao IBus 兼容层的应用。先用 <Code>pgrep -af keytao-ime</Code> 确认普通 daemon 已启动，再用以下脚本启动 QQ：</p>
              <pre className="overflow-x-auto"><code>{'#!/usr/bin/env bash\nset -euo pipefail\nunset WAYLAND_DISPLAY\nexport DISPLAY="${DISPLAY:-:0}"\nexport QT_QPA_PLATFORM=xcb\nexport GDK_BACKEND=x11\nexport XMODIFIERS="@im=keytao"\nexport QT_IM_MODULE=ibus\nexport GTK_IM_MODULE=ibus\nexport IBUS_ADDRESS="${IBUS_ADDRESS:-${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}}"\nexec qq --ozone-platform-hint=x11 "$@"'}</code></pre>
              <p>微信将最后一行换为 <Code>{'exec wechat "$@"'}</Code>。这些设置仅作用于该应用，不要写入全局环境文件；GNOME 应用应连接系统 IBus，不使用此脚本的总线覆盖。</p>
              <p>GTK/Electron 仍未连接 IBus 时，检查系统是否提供 <Code>im-ibus.so</Code>。模块存在但未被发现，可在脚本的 exec 前生成并指定缓存；先将 <Code>IBUS_SO</Code> 改为发行版的实际路径：</p>
              <pre className="overflow-x-auto"><code>{'IBUS_SO="/usr/lib/gtk-3.0/3.0.0/immodules/im-ibus.so"\nmkdir -p "$HOME/.cache"\ngtk-query-immodules-3.0 "$IBUS_SO" > "$HOME/.cache/keytao-gtk-immodules.cache"\nexport GTK_PATH="$(dirname "$(dirname "$IBUS_SO")")${GTK_PATH:+:$GTK_PATH}"\nexport GTK_IM_MODULE_FILE="$HOME/.cache/keytao-gtk-immodules.cache"'}</code></pre>
            </div>
          </details>
        </CardBody>
      </Card>

      <Card className="min-w-0 bg-default-50 border-default-200">
        <CardBody className="text-sm text-default-700">
          <details>
            <summary className="cursor-pointer text-lg font-semibold">7. 备选：手动安装 ibus-rime</summary>
            <div className="mt-4 space-y-3">
              <p>如果需要使用系统 IBus/Rime，可选择这条独立路径：</p>
              <ol className="list-decimal pl-5 space-y-2">
                <li>通过包管理器安装 <Code>ibus-rime</Code>：Debian / Ubuntu 执行 <Code>sudo apt install ibus-rime</Code>，Fedora 执行 <Code>sudo dnf install ibus-rime</Code>。</li>
                <li>从 <Link href="https://github.com/xkinput/KeyTao/releases" isExternal showAnchorIcon>键道方案 Releases</Link> 获取文件名含 <Code>keytao-linux</Code> 的 Linux 方案包，将方案文件放入 <Code>~/.config/ibus/rime</Code>。</li>
                <li>在系统 IBus 中添加并选择 Rime，重新部署方案，再通过 Rime 方案菜单选择键道。</li>
              </ol>
              <Alert color="warning" description="这条路径不使用 keytao-ime 的数据目录。若从 KeyTao 独立 daemon 切换过来，应先停用其自启动及 KDE 虚拟键盘选择，避免与系统 IBus 争用。" />
            </div>
          </details>
        </CardBody>
      </Card>
    </>
  )
}
