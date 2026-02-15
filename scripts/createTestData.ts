/**
 * Create test data from test suite scenarios
 */

const API_BASE = 'http://localhost:3000'
const BEARER_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwibmFtZSI6ImFkbWluIiwiaWF0IjoxNzcwODM3NTU3LCJleHAiOjE3NzE0NDIzNTd9.EAtS8IAgh2k-IQFfMvTVJJCzEvupEBwJs5D1S6HeCZA'

interface PhraseData {
  word: string
  code: string
  weight: number
  type: string
}

interface TestOperation {
  action: 'Create' | 'Delete' | 'Change'
  word: string
  oldWord?: string
  code: string
  type?: string
  weight?: number
}

interface TestScenario {
  name: string
  description: string
  seeds: PhraseData[]  // Initial database state (will be approved)
  operations: TestOperation[]  // Test operations to create as PRs
}

// Test scenarios from the test suite - each scenario will create a separate batch
const testScenarios: TestScenario[] = [
  {
    name: 'Scenario 1',
    description: 'Add duplicate code phrase',
    seeds: [
      { word: 'S1词', code: 'sacode', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Create', word: 'S1重码', code: 'sacode', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 2',
    description: 'Add conflict then delete conflicting phrase',
    seeds: [
      { word: 'S2词', code: 'sbcode', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Create', word: 'S2重码', code: 'sbcode', type: 'Phrase' },
      { action: 'Delete', word: 'S2词', code: 'sbcode' },
    ]
  },
  {
    name: 'Scenario 3',
    description: 'Delete phrase then add to same code',
    seeds: [
      { word: 'S3词', code: 'sccode', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Delete', word: 'S3词', code: 'sccode' },
      { action: 'Create', word: 'S3新词', code: 'sccode', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 4',
    description: 'Change phrase then add to same code',
    seeds: [
      { word: 'S4词', code: 'sdcode', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Change', word: 'S4新词', oldWord: 'S4词', code: 'sdcode', type: 'Phrase' },
      { action: 'Create', word: 'S4词', code: 'sdcode', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 5',
    description: 'Duplicate items in batch',
    seeds: [],
    operations: [
      { action: 'Create', word: '测试', code: 'test', type: 'Phrase' },
      { action: 'Create', word: '测试', code: 'test', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 6',
    description: 'Change with missing oldWord',
    seeds: [
      { word: 'S6词', code: 'sfcode', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Change', word: 'S6新词', oldWord: '不存在', code: 'sfcode', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 7',
    description: 'Delete non-existent phrase',
    seeds: [],
    operations: [
      { action: 'Delete', word: '不存在', code: 'sgxxxx' },
    ]
  },
  {
    name: 'Scenario 8',
    description: 'Change without oldWord',
    seeds: [],
    operations: [
      { action: 'Change', word: 'S8新词', code: 'shabc', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 9',
    description: 'Delete → Create (position freed)',
    seeds: [
      { word: 'S9词', code: 'sicode', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Delete', word: 'S9词', code: 'sicode' },
      { action: 'Create', word: 'S9新词', code: 'sicode', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 10',
    description: 'Create → Delete cycle',
    seeds: [],
    operations: [
      { action: 'Create', word: 'S10新词', code: 'sjcode', type: 'Phrase' },
      { action: 'Delete', word: 'S10新词', code: 'sjcode' },
    ]
  },
  {
    name: 'Scenario 11',
    description: 'Multiple Creates - weight progression',
    seeds: [
      { word: 'S11词1', code: 'sktest', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Create', word: 'S11词2', code: 'sktest', type: 'Phrase' },
      { action: 'Create', word: 'S11词3', code: 'sktest', type: 'Phrase' },
      { action: 'Create', word: 'S11词4', code: 'sktest', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 12',
    description: 'Delete all → Create (weight resets)',
    seeds: [
      { word: 'S12词A', code: 'slcode', weight: 100, type: 'Phrase' },
      { word: 'S12词B', code: 'slcode', weight: 101, type: 'Phrase' },
    ],
    operations: [
      { action: 'Delete', word: 'S12词A', code: 'slcode' },
      { action: 'Delete', word: 'S12词B', code: 'slcode' },
      { action: 'Create', word: 'S12词C', code: 'slcode', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 13',
    description: 'Change A→B, then Create A (name reuse)',
    seeds: [
      { word: 'S13原词', code: 'smcode', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Change', word: 'S13新词', oldWord: 'S13原词', code: 'smcode', type: 'Phrase' },
      { action: 'Create', word: 'S13原词', code: 'smcode', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 14',
    description: 'Complex chain - Delete, Change, Create',
    seeds: [
      { word: 'S14词一', code: 'snchain', weight: 100, type: 'Phrase' },
      { word: 'S14词二', code: 'snchain', weight: 101, type: 'Phrase' },
      { word: 'S14词三', code: 'snchain', weight: 102, type: 'Phrase' },
    ],
    operations: [
      { action: 'Delete', word: 'S14词一', code: 'snchain' },
      { action: 'Change', word: 'S14词二改', oldWord: 'S14词二', code: 'snchain', type: 'Phrase' },
      { action: 'Create', word: 'S14词四', code: 'snchain', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 15',
    description: 'Batch duplicate detection',
    seeds: [],
    operations: [
      { action: 'Create', word: 'S15重复词', code: 'socode', type: 'Phrase' },
      { action: 'Create', word: 'S15重复词', code: 'socode', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 16',
    description: 'Delete reduces weight for Create',
    seeds: [
      { word: 'S16词A', code: 'spcode', weight: 100, type: 'Phrase' },
      { word: 'S16词B', code: 'spcode', weight: 101, type: 'Phrase' },
      { word: 'S16词C', code: 'spcode', weight: 102, type: 'Phrase' },
    ],
    operations: [
      { action: 'Delete', word: 'S16词A', code: 'spcode' },
      { action: 'Create', word: 'S16词D', code: 'spcode', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 17',
    description: 'Multiple Deletes reduce weight progressively',
    seeds: [
      { word: 'S17词1', code: 'sqmulti', weight: 100, type: 'Phrase' },
      { word: 'S17词2', code: 'sqmulti', weight: 101, type: 'Phrase' },
      { word: 'S17词3', code: 'sqmulti', weight: 102, type: 'Phrase' },
      { word: 'S17词4', code: 'sqmulti', weight: 103, type: 'Phrase' },
    ],
    operations: [
      { action: 'Delete', word: 'S17词1', code: 'sqmulti' },
      { action: 'Delete', word: 'S17词2', code: 'sqmulti' },
      { action: 'Delete', word: 'S17词3', code: 'sqmulti' },
      { action: 'Create', word: 'S17词5', code: 'sqmulti', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 18',
    description: 'Exact word+code combination duplicate',
    seeds: [
      { word: 'S18这里', code: 'srfelk', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Create', word: 'S18这里', code: 'srfelk', type: 'Phrase' },
    ]
  },
  {
    name: 'Scenario 18b',
    description: 'Different word with same code (重码 allowed)',
    seeds: [
      { word: 'S18b这里', code: 'ssfelk', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Create', word: 'S18b那里', code: 'ssfelk', type: 'Phrase' },
    ]
  },
  {
    name: 'Additional',
    description: 'Alternative code generation',
    seeds: [
      { word: 'SA如果', code: 'sarjgl', weight: 100, type: 'Phrase' },
    ],
    operations: [
      { action: 'Create', word: 'SA茹果', code: 'sarjgl', type: 'Phrase' },
    ]
  },
]

async function createPhrasesPRs() {
  console.log('🚀 Starting to create test data...\n')

  try {
    const testBatchIds: string[] = []
    let totalSeedPRs = 0
    let totalTestPRs = 0

    for (let scenarioIdx = 0; scenarioIdx < testScenarios.length; scenarioIdx++) {
      const scenario = testScenarios[scenarioIdx]
      console.log(`\n${'='.repeat(80)}`)
      console.log(`📋 ${scenario.name}: ${scenario.description}`)
      console.log(`${'='.repeat(80)}`)

      // Step 1: Create and approve seed batch (if seeds exist)
      if (scenario.seeds.length > 0) {
        console.log(`\n🌱 Step 1: Creating seed data...`)

        // Create seed batch
        const seedBatchResponse = await fetch(`${API_BASE}/api/batches`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${BEARER_TOKEN}`
          },
          body: JSON.stringify({
            description: `[SEED] ${scenario.name} - Initial data`
          })
        })

        if (!seedBatchResponse.ok) {
          const error = await seedBatchResponse.json()
          console.error(`   ❌ Failed to create seed batch: ${error.error}`)
          continue
        }

        const seedBatchResult = await seedBatchResponse.json()
        const seedBatchId = seedBatchResult.batch.id
        console.log(`   📦 Seed batch ID: ${seedBatchId}`)

        // Create seed PRs
        let createdCount = 0
        for (let i = 0; i < scenario.seeds.length; i++) {
          const seed = scenario.seeds[i]
          const response = await fetch(`${API_BASE}/api/pull-requests`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${BEARER_TOKEN}`
            },
            body: JSON.stringify({
              action: 'Create',
              word: seed.word,
              code: seed.code,
              type: seed.type,
              batchId: seedBatchId,
              remark: `[SEED] ${scenario.name}`
            })
          })

          if (!response.ok) {
            const error = await response.json()
            console.log(`   ⏭️  Seed "${seed.word} @ ${seed.code}" - ${error.error}`)
            continue
          }

          createdCount++
          totalSeedPRs++
        }

        if (createdCount === 0) {
          console.log(`   ⏭️  All seeds already exist, skipping batch creation`)
        } else {
          console.log(`   ✅ Created ${createdCount} seed PR(s)`)

          // Submit seed batch
          const submitResponse = await fetch(`${API_BASE}/api/batches/${seedBatchId}/submit`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${BEARER_TOKEN}`
            }
          })

          if (!submitResponse.ok) {
            const error = await submitResponse.json()
            console.error(`   ❌ Failed to submit seed batch: ${error.error}`)
            continue
          }
          console.log(`   📝 Seed batch submitted`)

          // Approve seed batch
          const approveResponse = await fetch(`${API_BASE}/api/admin/batches/${seedBatchId}/approve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${BEARER_TOKEN}`
            },
            body: JSON.stringify({
              reviewNote: `Auto-approved for test data: ${scenario.name}`
            })
          })

          if (!approveResponse.ok) {
            const error = await approveResponse.json()
            console.error(`   ❌ Failed to approve seed batch: ${error.error || error.details}`)
            continue
          }
          console.log(`   ✅ Seed batch approved - data now in database`)
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      }

      // Step 2: Create test operations batch
      if (scenario.operations.length > 0) {
        console.log(`\n🧪 Step 2: Creating test operations batch...`)

        const testBatchResponse = await fetch(`${API_BASE}/api/batches`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${BEARER_TOKEN}`
          },
          body: JSON.stringify({
            description: `[Test Suite] ${scenario.name}: ${scenario.description}`
          })
        })

        if (!testBatchResponse.ok) {
          const error = await testBatchResponse.json()
          console.error(`   ❌ Failed to create test batch: ${error.error}`)
          continue
        }

        const testBatchResult = await testBatchResponse.json()
        const testBatchId = testBatchResult.batch.id
        testBatchIds.push(testBatchId)
        console.log(`   📦 Test batch ID: ${testBatchId}`)

        // Create test operation PRs
        for (let i = 0; i < scenario.operations.length; i++) {
          const op = scenario.operations[i]
          const response = await fetch(`${API_BASE}/api/pull-requests`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${BEARER_TOKEN}`
            },
            body: JSON.stringify({
              action: op.action,
              word: op.word,
              oldWord: op.oldWord,
              code: op.code,
              type: op.type,
              // Only send weight for Change operations, not Create
              ...(op.action !== 'Create' && op.weight !== undefined ? { weight: op.weight } : {}),
              batchId: testBatchId,
              remark: `[TEST] ${scenario.name}`
            })
          })

          if (!response.ok) {
            const error = await response.json()
            console.error(`   ❌ Failed to create test PR: ${error.error}`)
            continue
          }

          totalTestPRs++
        }
        console.log(`   ✅ Created ${scenario.operations.length} test operation PR(s)`)
      }
    }

    console.log('\n' + '='.repeat(80))
    console.log('✨ All test data created successfully!')
    console.log('='.repeat(80))
    console.log(`\n📊 Summary:`)
    console.log(`   Total scenarios: ${testScenarios.length}`)
    console.log(`   Test batches: ${testBatchIds.length}`)
    console.log(`   Seed PRs (approved): ${totalSeedPRs}`)
    console.log(`   Test PRs: ${totalTestPRs}`)
    console.log(`\n📦 Test Batch URLs:`)
    testBatchIds.forEach((id, idx) => {
      const scenario = testScenarios[idx]
      console.log(`\n   ${idx + 1}. ${scenario.name}`)
      console.log(`      ${scenario.description}`)
      console.log(`      Seeds: ${scenario.seeds.length} (approved), Operations: ${scenario.operations.length}`)
      console.log(`      🔗 ${API_BASE}/batch/${id}`)
    })

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

createPhrasesPRs()
