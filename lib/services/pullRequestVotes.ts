import type { Prisma, PullRequest } from '@prisma/client'

const proposalFields = [
  'word', 'oldWord', 'code', 'action', 'type', 'weight', 'phraseId', 'targetPhraseId', 'targetFingerprint',
] as const

type Proposal = Pick<PullRequest, typeof proposalFields[number]>

export function resetVotesForProposalEdit(
  before: Proposal,
  changes: Partial<Proposal>,
): Pick<Prisma.PullRequestUpdateInput, 'likedBy' | 'dislikedBy'> | undefined {
  const changed = proposalFields.some(key => changes[key] !== undefined && changes[key] !== before[key])
  return changed ? { likedBy: { set: [] }, dislikedBy: { set: [] } } : undefined
}
