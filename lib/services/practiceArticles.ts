export interface PracticeArticleOption {
  id: string
  title: string
  text: string
  detail?: string
  url?: string
  source: 'builtin' | 'wikisource'
}

export const DEFAULT_PRACTICE_ARTICLE_OPTIONS: PracticeArticleOption[] = [
  {
    id: 'builtin:default-longform',
    title: '键道练习长文',
    text: '夜色落下来时，桌前只剩下屏幕的光和键盘轻微的回声。人一旦静下来，就会发现输入并不是把字一个个敲出来这么简单，它更像是在整理呼吸、整理节奏，也整理自己看待错误的方式。刚开始练习的时候，总希望一口气就把速度提上去，看见数字往上跳，心里才觉得今天没有白练。可是真正让人稳定下来的，从来不是一时的冲刺，而是那些看起来枯燥的重复：看准字词，确认编码，按下去，再检查自己是不是在急躁里偷了步骤。练习久了以后，会慢慢明白速度不是目的，顺手也不是目的，真正重要的是输入时那种没有迟疑的清楚感。眼睛知道自己在看什么，手指知道下一步应该去哪里，心里也不会因为一个错字就立刻乱掉。等这种感觉逐渐建立起来，再长的句子也不会让人发慌，再密的文字也只是需要一点时间去拆开、去完成。到那个时候，键盘不再只是工具，练习也不再只是任务，它会变成一种很安静的推进：今天比昨天更稳一点，明天又比今天更完整一点。',
    detail: '内置兜底长文',
    source: 'builtin',
  },
]

export function normalizePracticeArticleText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}