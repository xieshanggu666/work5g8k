import { db } from './db.js'
import { buildNetwork, planAllocation, plotCompIndex } from './irrigation-core.js'

const q = (sql, ...p) => db.prepare(sql).all(...p)
const q1 = (sql, ...p) => db.prepare(sql).get(...p)
const run = (sql, ...p) => db.prepare(sql).run(...p)

// ===== 建设与结算参数 =====
export const COSTS = {
  reservoir: { gold: 150, refund: 75, capacity: 300, startWater: 150, name: '蓄水池' },
  canal: { gold: 15, refund: 7, name: '水渠' }
}
const RAIN_GAIN = 80    // 降雨每池每日补水
const STORM_GAIN = 120  // 暴雨每池每日补水
const DROUGHT_LOSS = 6  // 干旱每级严重度每日蒸发
const HEAT_LOSS = 4     // 酷暑每级严重度每日蒸发
const DAILY_EVAP = 2    // 每日自然蒸发
const IRR_TARGET = 100  // 灌溉目标水位

// 可建校验：返回 null 表示可建，否则返回原因
export function cellFree(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return '坐标无效'
  if (x < 0 || x > 14 || y < 0 || y > 9) return '超出农场范围'
  if (x <= 5 && y <= 5) return '不能建在耕地上'
  for (const b of q('SELECT x,y FROM buildings')) {
    if (x >= b.x && x <= b.x + 1 && y >= b.y && y <= b.y + 1) return '不能建在建筑上'
  }
  if (y === 8 && x >= 8 && x <= 10) return '畜棚活动区，无法施工'
  if (q1('SELECT id FROM reservoirs WHERE x=? AND y=?', x, y)) return '此处已有蓄水池'
  if (q1('SELECT id FROM canals WHERE x=? AND y=?', x, y)) return '此处已有水渠'
  return null
}

// ===== 建造：花金币放置蓄水池/水渠 =====
export function buildNode(kind, x, y) {
  const cfg = COSTS[kind]
  if (!cfg) throw Object.assign(new Error('未知的设施类型'), { status: 400 })
  const err = cellFree(x, y)
  if (err) throw Object.assign(new Error(err), { status: 400 })
  db.exec('BEGIN IMMEDIATE')
  try {
    const p = q1('SELECT gold, abs_day FROM player WHERE id=1')
    if (p.gold < cfg.gold) throw Object.assign(new Error(`金币不足（需 🪙${cfg.gold}）`), { status: 400 })
    run('UPDATE player SET gold=gold-? WHERE id=1', cfg.gold)
    if (kind === 'reservoir') {
      run('INSERT INTO reservoirs (x,y,capacity,water,active,built_abs) VALUES (?,?,?,?,1,?)',
        x, y, cfg.capacity, cfg.startWater, p.abs_day)
    } else {
      run('INSERT INTO canals (x,y,active,built_abs) VALUES (?,?,1,?)', x, y, p.abs_day)
    }
    db.exec('COMMIT')
    return { ok: true, gold: p.gold - cfg.gold }
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已结束，忽略 */ }
    throw e
  }
}

// ===== 停用/启用：停用的设施不参与输水（水渠断流、蓄水池不补水不蒸发）=====
export function toggleNode(kind, id) {
  const table = kind === 'reservoir' ? 'reservoirs' : kind === 'canal' ? 'canals' : null
  if (!table) throw Object.assign(new Error('未知的设施类型'), { status: 400 })
  const node = q1(`SELECT * FROM ${table} WHERE id=?`, id)
  if (!node) throw Object.assign(new Error('设施不存在'), { status: 404 })
  run(`UPDATE ${table} SET active=? WHERE id=?`, node.active ? 0 : 1, id)
  return { ok: true, active: node.active ? 0 : 1 }
}

// ===== 拆除：返还部分金币，蓄水池余水作废 =====
export function demolishNode(kind, id) {
  const table = kind === 'reservoir' ? 'reservoirs' : kind === 'canal' ? 'canals' : null
  if (!table) throw Object.assign(new Error('未知的设施类型'), { status: 400 })
  const node = q1(`SELECT * FROM ${table} WHERE id=?`, id)
  if (!node) throw Object.assign(new Error('设施不存在'), { status: 404 })
  const refund = COSTS[kind].refund
  db.exec('BEGIN IMMEDIATE')
  try {
    run(`DELETE FROM ${table} WHERE id=?`, id)
    run('UPDATE player SET gold=gold+? WHERE id=1', refund)
    db.exec('COMMIT')
    return { ok: true, refund }
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已结束，忽略 */ }
    throw e
  }
}

// ===== 地块接入/断开灌溉；priority 0低 1中 2高 =====
export function setPlotIrrigation(plotId, irrigated, priority) {
  const plot = q1('SELECT * FROM plots WHERE id=?', plotId)
  if (!plot) throw Object.assign(new Error('地块不存在'), { status: 404 })
  const pr = Math.max(0, Math.min(2, Math.floor(Number(priority) || 0)))
  run('UPDATE plots SET irrigated=?, irr_priority=? WHERE id=?', irrigated ? 1 : 0, pr, plotId)
  return { ok: true }
}

// 前端视图：给每段水渠标注通水状态（active 且所在分量有水即通水）
export function irrigationView() {
  const reservoirs = q('SELECT * FROM reservoirs')
  const canals = q('SELECT * FROM canals')
  const { components } = buildNetwork(reservoirs, canals)
  const flowingCanal = new Set()
  for (const comp of components) {
    if (comp.water <= 0) continue
    for (const c of comp.canals) flowingCanal.add(c.id)
  }
  return {
    reservoirs,
    canals: canals.map((c) => ({ ...c, flowing: c.active && flowingCanal.has(c.id) ? 1 : 0 }))
  }
}

// 网络概览（灌溉面板顶部统计）
export function irrigationSummary() {
  const res = q('SELECT * FROM reservoirs')
  return {
    reservoirs: res.length,
    activeRes: res.filter((r) => r.active).length,
    canals: q1('SELECT COUNT(*) c FROM canals').c,
    water: Math.round(res.reduce((s, r) => s + r.water, 0)),
    capacity: res.reduce((s, r) => s + r.capacity, 0),
    linkedPlots: q1('SELECT COUNT(*) c FROM plots WHERE irrigated=1').c,
    cutPlots: q1('SELECT COUNT(*) c FROM plots WHERE irrigated=1 AND irr_ok=0').c
  }
}

// ===== 灌溉逐日结算（在 advanceDay 事务内、地块四维消耗之后调用）=====
// 降雨补水 → 蒸发耗水 → 按连通分量与优先级分配有限水量 → 记录断流/恢复。
// 幂等：irrigation_log 按 abs_day 唯一，同一天重复进入直接跳过，重试不会重复扣水。
export function settleIrrigation(absDay) {
  if (q1('SELECT id FROM irrigation_log WHERE abs_day=?', absDay)) return []
  const hasNodes = q1('SELECT (SELECT COUNT(*) FROM reservoirs)+(SELECT COUNT(*) FROM canals) c').c > 0
  const linked = q('SELECT * FROM plots WHERE irrigated=1')
  if (!hasNodes && !linked.length) return []
  const weatherLogs = []
  const transitions = []

  // 今日天气（settleWeather 已先于本函数落 weather_log，同一事务内可见）
  const w = q1(`SELECT e.type, e.severity FROM weather_events e
                JOIN weather_log l ON l.event_id=e.id WHERE l.abs_day=? LIMIT 1`, absDay)
  const type = w?.type || 'sunny'
  const sev = w?.severity || 0

  // —— 降雨补水 / 干旱耗水（仅启用中的蓄水池）——
  const resCount = q1('SELECT COUNT(*) c FROM reservoirs WHERE active=1').c
  if (resCount > 0) {
    if (type === 'rain' || type === 'storm') {
      const gain = type === 'rain' ? RAIN_GAIN : STORM_GAIN
      run('UPDATE reservoirs SET water=MIN(capacity, water+?) WHERE active=1', gain)
      weatherLogs.push(`🌧️ ${type === 'rain' ? '降雨' : '暴雨'}为 ${resCount} 座蓄水池补水，各 +${gain}`)
    }
    let evap = DAILY_EVAP
    if (type === 'drought') evap += DROUGHT_LOSS * sev
    else if (type === 'heatwave') evap += HEAT_LOSS * sev
    run('UPDATE reservoirs SET water=MAX(0, water-?) WHERE active=1', evap)
    if (type === 'drought' || type === 'heatwave') {
      weatherLogs.push(`🏜️ ${type === 'drought' ? '干旱' : '酷暑'}蒸发，每座蓄水池 -${evap}`)
    }
  }

  // —— 按连通分量与优先级分配有限水量 ——
  const reservoirs = q('SELECT * FROM reservoirs')
  const canals = q('SELECT * FROM canals')
  const { components } = buildNetwork(reservoirs, canals)
  const { give, ok, remain } = planAllocation(components, linked, IRR_TARGET)

  let usedTotal = 0
  for (const [plotId, g] of give) {
    run('UPDATE plots SET water=MIN(100, water+?) WHERE id=?', g, plotId)
    usedTotal += g
  }
  // 分量余水写回各蓄水池（按建造顺序，先建的池子优先保留余水）
  components.forEach((comp, ci) => {
    let left = remain[ci]
    for (const r of comp.reservoirs) {
      const keep = Math.max(0, Math.min(r.water, left))
      if (keep !== r.water) run('UPDATE reservoirs SET water=? WHERE id=?', keep, r.id)
      left -= keep
    }
  })
  // 断流/恢复：状态翻转才落库；有作物的地块同时写日志
  for (const pl of linked) {
    const nowOk = ok.get(pl.id) ?? 1
    if (nowOk === pl.irr_ok) continue
    run('UPDATE plots SET irr_ok=? WHERE id=?', nowOk, pl.id)
    if (!pl.crop_id) continue
    transitions.push(nowOk
      ? `💧 地块(${pl.x},${pl.y}) 恢复灌溉供水`
      : `🚱 地块(${pl.x},${pl.y}) 灌溉断流：${reasonOf(pl, components, reservoirs, canals)}`)
  }

  const logs = [...weatherLogs]
  if (usedTotal > 0) logs.push(`💧 灌溉网络供水 ${give.size} 块地，耗水 ${Math.round(usedTotal)}`)
  logs.push(...transitions)
  run('INSERT INTO irrigation_log (abs_day,msg) VALUES (?,?)', absDay, JSON.stringify(logs))
  return logs
}

// 断流原因（仅用于日志文案）：接入分量但分不到水 → 水量不足；
// 四邻只有停用的设施 → 设施已停用；否则是水渠未连通蓄水池
function reasonOf(pl, components, reservoirs, canals) {
  if (plotCompIndex(components, pl.x, pl.y) >= 0) return '蓄水池水量不足'
  const nearInactive = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const nx = pl.x + dx, ny = pl.y + dy
    return reservoirs.some((r) => !r.active && r.x === nx && r.y === ny)
        || canals.some((c) => !c.active && c.x === nx && c.y === ny)
  })
  return nearInactive ? '相邻设施已停用' : '水渠未连通蓄水池'
}
