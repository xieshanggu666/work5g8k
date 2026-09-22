// ===== 灌溉核心算法（纯函数，不依赖数据库，便于单测）=====
// 网络模型：蓄水池是水源，水渠是输水通道，二者按 4-邻接连成网络；
// 网络被划分为若干「连通分量」，同一分量内所有启用蓄水池的水量共享，
// 地块只要四邻接触到某分量的水渠/蓄水池，即从该分量取水。

export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
export const cellKey = (x, y) => x + ',' + y

// 以「启用中的蓄水池」为源，沿「启用中的水渠」4-邻接扩散，划分连通分量。
// 返回 { components: [{ reservoirs, canals, water }] }
//   —— components[i].water 为该分量当前可用总水量（只统计启用中的池）
export function buildNetwork(reservoirs, canals) {
  const resAt = new Map(reservoirs.filter((r) => r.active).map((r) => [cellKey(r.x, r.y), r]))
  const canalAt = new Map(canals.filter((c) => c.active).map((c) => [cellKey(c.x, c.y), c]))
  const seen = new Set()
  const components = []
  for (const r0 of resAt.values()) {
    const k0 = cellKey(r0.x, r0.y)
    if (seen.has(k0)) continue
    const comp = { reservoirs: [], canals: [], water: 0 }
    const stack = [k0]
    seen.add(k0)
    while (stack.length) {
      const [cx, cy] = stack.pop().split(',').map(Number)
      const r = resAt.get(cellKey(cx, cy))
      if (r) { comp.reservoirs.push(r); comp.water += r.water }
      else comp.canals.push(canalAt.get(cellKey(cx, cy)))
      for (const [dx, dy] of DIRS) {
        const nk = cellKey(cx + dx, cy + dy)
        if (seen.has(nk)) continue
        if (resAt.has(nk) || canalAt.has(nk)) { seen.add(nk); stack.push(nk) }
      }
    }
    components.push(comp)
  }
  return { components }
}

// 地块归属哪个分量：四邻接触到分量的水渠/蓄水池即属该分量；都不沾返回 -1
export function plotCompIndex(components, px, py) {
  for (let i = 0; i < components.length; i++) {
    const cells = components[i].cells || (components[i].cells = compCellSet(components[i]))
    if (DIRS.some(([dx, dy]) => cells.has(cellKey(px + dx, py + dy)))) return i
  }
  return -1
}

function compCellSet(comp) {
  const s = new Set()
  for (const r of comp.reservoirs) s.add(cellKey(r.x, r.y))
  for (const c of comp.canals) s.add(cellKey(c.x, c.y))
  return s
}

// 按连通关系与优先级分配有限水量。
// 参数：
//   components —— buildNetwork 的结果（comp.water 为可用水量）
//   linkedPlots —— 已接入灌溉的地块（需含 id/x/y/crop_id/water/irr_priority）
//   target —— 灌溉目标水位（补到该值为止）
// 返回 { give: Map<plotId, 水量>, ok: Map<plotId, 0|1>, remain: number[] }
//   —— ok=0 即断流（未连通或分量水量耗尽）；无需供水的地块恒为 1
export function planAllocation(components, linkedPlots, target = 100) {
  const give = new Map()
  const ok = new Map()
  const remain = components.map((c) => c.water)
  const byComp = components.map(() => [])
  for (const pl of linkedPlots) {
    const ci = plotCompIndex(components, pl.x, pl.y)
    if (ci < 0) {
      // 未连通任何启用中的网络：有作物的地块记断流
      ok.set(pl.id, pl.crop_id ? 0 : 1)
    } else {
      byComp[ci].push(pl)
    }
  }
  components.forEach((comp, ci) => {
    const list = byComp[ci]
    if (!list.length) return
    let avail = remain[ci]
    // 需要供水的地块：有作物且水位未满；优先级高者优先，同级更缺水者优先
    const needy = list
      .filter((pl) => pl.crop_id && pl.water < target)
      .map((pl) => ({ pl, need: target - pl.water }))
      .sort((a, b) => (b.pl.irr_priority - a.pl.irr_priority) || (b.need - a.need))
    for (const { pl, need } of needy) {
      const g = Math.max(0, Math.min(need, avail))
      if (g > 0) { give.set(pl.id, g); avail -= g }
    }
    remain[ci] = avail
    for (const pl of list) {
      const needsWater = pl.crop_id && pl.water < target
      ok.set(pl.id, !needsWater || give.has(pl.id) ? 1 : 0)
    }
  })
  return { give, ok, remain }
}
