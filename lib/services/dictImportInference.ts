import type { InferResponse } from './phraseInference'

export interface DictImportInferenceDecision {
  finalCode: string
  status: 'new' | 'shifted' | 'overflow' | 'error'
  statusDetail?: string
}

export function resolveDictImportInference(
  inputCode: string | undefined,
  infer: InferResponse,
): DictImportInferenceDecision {
  if (inputCode) return { finalCode: inputCode, status: 'new' }

  if (infer.suggestionStatus === 'pronunciation-unresolved') {
    return {
      finalCode: '',
      status: 'error',
      statusDetail: '读音存在歧义，请单独审词确认读音后再填写编码',
    }
  }

  if (infer.suggestionStatus === 'pronunciation-unavailable') {
    return {
      finalCode: '',
      status: 'error',
      statusDetail: '权威读音服务暂不可用，请稍后重试',
    }
  }

  if (infer.suggestionStatus === 'occupied' && infer.suggestion === null) {
    return {
      finalCode: infer.codes.at(-1) ?? infer.codes[0] ?? '',
      status: 'overflow',
    }
  }

  if (infer.suggestion === null) {
    return {
      finalCode: '',
      status: 'error',
      statusDetail: '未返回可验证的候选编码，请单独审词',
    }
  }

  if (infer.isBaseConflict) {
    return {
      finalCode: infer.suggestion,
      status: 'shifted',
      statusDetail: `${infer.codes[0]} → ${infer.suggestion}`,
    }
  }

  return { finalCode: infer.suggestion, status: 'new' }
}
