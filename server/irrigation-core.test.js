// 灌溉核心算法单测（纯函数，node 可直接运行）：node server/irrigation-core.test.js
import { buildNetwork, planAllocation, plotCompIndex } from './irrigation-core.js'

let passed = 0
function assert(cond, name) {
  if (!cond) { console.error('❌', name); process.exitCode = 1 }
  else { passed++; console.log('✅', name) }
}

// —— 场景 1：蓄水池—水渠—地块串联 ——
// 池(6,0) → 渠(6,1) → 渠(6,2)，地块(5,2) 与渠(6,2) 相邻
{
  const res = [{ id: 1, x: 6, y: 0, water: 100, capacity: 300, active: 1 }]
  const canals = [
    { id: 1, x: 6, y: 1, active: 1 },
    { id: 2, x: 6, y: 2, active: 1 }
  ]
  const { components } = buildNetwork(res, canals)
  assert(components.length === 1, 'S1: 串联网络为 1 个分量')
  assert(components[0].water === 100, 'S1: 分量水量=100')
  assert(plotCompIndex(components, 5, 2) === 0, 'S1: 地块(5,2)接入分量')
  assert(plotCompIndex(components, 0, 0) === -1, 'S1: 远处地块未接入')

  const plots = [{ id: 10, x: 5, y: 2, crop_id: 1, water: 60, irr_priority: 1 }]
  const { give, ok, remain } = planAllocation(components, plots, 100)
  assert(give.get(10) === 40, 'S1: 补到目标水位(40)')
  assert(ok.get(10) === 1, 'S1: 供水正常')
  assert(remain[0] === 60, 'S1: 余水 60')
}

// —— 场景 2：水量不足时高优先级先满足，低优先级断流 ——
{
  const res = [{ id: 1, x: 6, y: 0, water: 50, capacity: 300, active: 1 }]
  const canals = [{ id: 1, x: 6, y: 1, active: 1 }]
  const { components } = buildNetwork(res, canals)
  const plots = [
    { id: 1, x: 5, y: 1, crop_id: 1, water: 20, irr_priority: 0 }, // 低，需 80
    { id: 2, x: 7, y: 1, crop_id: 1, water: 20, irr_priority: 2 }, // 高，需 80
    { id: 3, x: 5, y: 0, crop_id: 1, water: 20, irr_priority: 1 }  // 中，需 80（邻接池）
  ]
  const { give, ok, remain } = planAllocation(components, plots, 100)
  assert(give.get(2) === 50, 'S2: 高优先级独得全部 50 水')
  assert(!give.has(1) && !give.has(3), 'S2: 中/低优先级无水')
  assert(ok.get(2) === 1 && ok.get(1) === 0 && ok.get(3) === 0, 'S2: 低/中断流')
  assert(remain[0] === 0, 'S2: 水量耗尽')
}

// —— 场景 3：同优先级按缺水程度分配；部分满足也算供水 ——
{
  const res = [{ id: 1, x: 6, y: 0, water: 30, capacity: 300, active: 1 }]
  const { components } = buildNetwork(res, [])
  const plots = [
    { id: 1, x: 5, y: 0, crop_id: 1, water: 10, irr_priority: 1 }, // 需 90
    { id: 2, x: 7, y: 0, crop_id: 1, water: 50, irr_priority: 1 }  // 需 50
  ]
  const { give, ok } = planAllocation(components, plots, 100)
  assert(give.get(1) === 30, 'S3: 同级更缺水者优先，得 30（部分满足）')
  assert(ok.get(1) === 1, 'S3: 部分满足仍算供水')
  assert(ok.get(2) === 0, 'S3: 未分到水的断流')
}

// —— 场景 4：停用的渠/池不参与网络 → 断流；恢复启用 → 复水 ——
{
  const res = [{ id: 1, x: 6, y: 0, water: 100, capacity: 300, active: 1 }]
  const canalOff = [{ id: 1, x: 6, y: 1, active: 0 }] // 停用
  let { components } = buildNetwork(res, canalOff)
  const plots = [{ id: 1, x: 5, y: 1, crop_id: 1, water: 20, irr_priority: 1 }]
  let r = planAllocation(components, plots, 100)
  assert(ok0(r.ok.get(1)), 'S4: 水渠停用 → 地块断流')
  assert(!r.give.has(1), 'S4: 停用时无水分配')

  const canalOn = [{ id: 1, x: 6, y: 1, active: 1 }] // 恢复启用
  ;({ components } = buildNetwork(res, canalOn))
  r = planAllocation(components, plots, 100)
  assert(r.give.get(1) === 80 && r.ok.get(1) === 1, 'S4: 恢复启用 → 断流恢复')

  // 蓄水池停用：整个分量消失
  const resOff = [{ id: 1, x: 6, y: 0, water: 100, capacity: 300, active: 0 }]
  ;({ components } = buildNetwork(resOff, canalOn))
  assert(components.length === 0, 'S4: 蓄水池停用 → 分量消失')
  r = planAllocation(components, plots, 100)
  assert(r.ok.get(1) === 0, 'S4: 池停用 → 断流')
}
function ok0(v) { return v === 0 }

// —— 场景 5：多分量各自分配各自的水；空地不参与 ——
{
  const res = [
    { id: 1, x: 6, y: 0, water: 10, capacity: 300, active: 1 },
    { id: 2, x: 10, y: 0, water: 200, capacity: 300, active: 1 }
  ]
  const { components } = buildNetwork(res, [])
  assert(components.length === 2, 'S5: 两个互不相邻的池 = 2 个分量')
  const plots = [
    { id: 1, x: 5, y: 0, crop_id: 1, water: 95, irr_priority: 1 }, // 池1旁，需 5
    { id: 2, x: 9, y: 0, crop_id: 1, water: 10, irr_priority: 1 }, // 池2旁，需 90
    { id: 3, x: 11, y: 0, crop_id: null, water: 10, irr_priority: 1 } // 空地
  ]
  const { give, ok, remain } = planAllocation(components, plots, 100)
  assert(give.get(1) === 5, 'S5: 池1分量供水 5')
  assert(give.get(2) === 90, 'S5: 池2分量供水 90')
  assert(!give.has(3) && ok.get(3) === 1, 'S5: 空地不分配也不算断流')
  const r1 = remain[components.findIndex((c) => c.reservoirs[0].id === 1)]
  const r2 = remain[components.findIndex((c) => c.reservoirs[0].id === 2)]
  assert(r1 === 5 && r2 === 110, 'S5: 各分量独立扣水')
}

// —— 场景 6：两个池通过水渠串联共享水量 ——
{
  const res = [
    { id: 1, x: 6, y: 0, water: 0, capacity: 300, active: 1 },
    { id: 2, x: 6, y: 2, water: 100, capacity: 300, active: 1 }
  ]
  const canals = [{ id: 1, x: 6, y: 1, active: 1 }]
  const { components } = buildNetwork(res, canals)
  assert(components.length === 1 && components[0].water === 100, 'S6: 渠连通两池共享水量')
  const plots = [{ id: 1, x: 5, y: 0, crop_id: 1, water: 0, irr_priority: 1 }]
  const { give } = planAllocation(components, plots, 100)
  assert(give.get(1) === 100, 'S6: 空池旁地块也能取到下游池的水')
}

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : ''}`)
