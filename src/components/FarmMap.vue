<template>
  <div class="canvas-wrap">
    <canvas ref="cv" :width="W" :height="H" :class="{building: store.buildMode}"
            @click="onClick" @mousemove="onMove" @mouseleave="hover=null"></canvas>
    <div class="map-tip" v-if="store.buildMode">
      {{ buildTip }} · 在灌溉面板再次点击按钮退出
    </div>
    <div class="map-tip" v-else-if="store.selectedPlot">
      已选中地块 ({{ store.selectedPlot.x }},{{ store.selectedPlot.y }}) · 点击其他耕地切换
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useGameStore } from '@/store/game'

const store = useGameStore()
const cv = ref(null)
const hover = ref(null)
const TILE = 60
const W = 900
const H = 620
let ctx = null
let raf = null
let time = 0

const buildTip = computed(() => ({
  reservoir: `🛢️ 点击空地建造蓄水池（🪙${store.irrCosts.reservoir?.gold ?? 150}）`,
  canal: `〰️ 点击空地铺设水渠（🪙${store.irrCosts.canal?.gold ?? 15}/段，可连续点击）`,
  demolish: '⛏️ 点击蓄水池/水渠拆除（返还50%）'
}[store.buildMode] || ''))

function tile(pos) { return pos * TILE }

function draw() {
  if (!ctx) return
  time++
  ctx.clearRect(0, 0, W, H)
  drawBackground()
  drawIrrigation()
  drawBuildings()
  drawPlots()
  drawAnimals()
  drawHover()
}

function drawBackground() {
  const seasons = ['#cde8b8', '#dff0b0', '#ecd9a8', '#e8e6ef']
  const sky = ['#bfe3ff', '#d9f2ff', '#f5e9c8', '#dfe3f5']
  ctx.fillStyle = sky[store.currentSeason % 4]
  ctx.fillRect(0, 0, W, H)
  // 草地
  ctx.fillStyle = seasons[store.currentSeason % 4]
  ctx.fillRect(0, 40, W, H)
  // 简单网格背景植物点缀
  ctx.fillStyle = 'rgba(0,80,0,0.06)'
  for (let i = 0; i < 40; i++) {
    const px = (i * 97 + time) % W
    const py = 60 + ((i * 53) % (H - 80))
    ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill()
  }
  // 天气氛围
  const wt = store.weather?.type
  const tints = {
    rain: 'rgba(40,80,160,0.15)', storm: 'rgba(20,30,60,0.28)', blizzard: 'rgba(255,255,255,0.35)',
    freeze: 'rgba(180,210,255,0.25)', frost: 'rgba(200,220,255,0.2)', heatwave: 'rgba(255,120,0,0.12)',
    drought: 'rgba(255,200,60,0.15)', wind: 'rgba(150,150,150,0.1)'
  }
  if (tints[wt]) {
    ctx.fillStyle = tints[wt]
    ctx.fillRect(0, 0, W, H)
  }
  if (wt && wt !== 'sunny') {
    ctx.font = '26px serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(store.weather.icon, W - 12, 8)
  }
}

// ===== 灌溉网络：水渠（连通即输水）+ 蓄水池（水位可视化）=====
function drawIrrigation() {
  const key = (x, y) => x + ',' + y
  const canalAt = new Map(store.canals.map((c) => [key(c.x, c.y), c]))
  const resAt = new Map(store.reservoirs.map((r) => [key(r.x, r.y), r]))
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

  // 水渠：先画渠槽连接条，再画中心块与水道
  for (const c of store.canals) {
    const cx = tile(c.x) + TILE / 2
    const cy = tile(c.y) + TILE / 2
    const links = DIRS.filter(([dx, dy]) => canalAt.has(key(c.x + dx, c.y + dy)) || resAt.has(key(c.x + dx, c.y + dy)))
    // 渠槽
    ctx.fillStyle = c.active ? 'rgba(109,81,57,0.9)' : 'rgba(70,70,70,0.75)'
    for (const [dx, dy] of links) {
      ctx.fillRect(cx - 7 + (dx < 0 ? -TILE / 2 : 0), cy - 7 + (dy < 0 ? -TILE / 2 : 0),
        dx !== 0 ? TILE / 2 + 7 : 14, dy !== 0 ? TILE / 2 + 7 : 14)
    }
    ctx.fillRect(cx - 9, cy - 9, 18, 18)
    // 水道：通水亮蓝 / 断流灰蓝 / 停用暗灰
    ctx.fillStyle = !c.active ? '#455a64' : c.flowing ? '#29b6f6' : '#78909c'
    for (const [dx, dy] of links) {
      ctx.fillRect(cx - 4 + (dx < 0 ? -TILE / 2 : 0), cy - 4 + (dy < 0 ? -TILE / 2 : 0),
        dx !== 0 ? TILE / 2 + 4 : 8, dy !== 0 ? TILE / 2 + 4 : 8)
    }
    ctx.fillRect(cx - 5, cy - 5, 10, 10)
    if (!c.active) {
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('⏸', cx, cy - 13)
    }
  }

  // 蓄水池：池壁 + 按水位填充 + 水量文本
  for (const r of store.reservoirs) {
    const x = tile(r.x)
    const y = tile(r.y)
    ctx.fillStyle = r.active ? '#01579b' : '#37474f'
    ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12)
    const ratio = Math.max(0, Math.min(1, r.water / r.capacity))
    const wh = (TILE - 20) * ratio
    ctx.fillStyle = r.active ? '#4fc3f7' : '#78909c'
    ctx.fillRect(x + 10, y + TILE - 10 - wh, TILE - 20, wh)
    // 水面波光
    if (r.active && ratio > 0.12) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.beginPath()
      const wy = y + TILE - 10 - wh + 3
      ctx.moveTo(x + 13, wy + Math.sin(time / 10 + r.id) * 1.5)
      ctx.lineTo(x + TILE - 13, wy + Math.cos(time / 12 + r.id) * 1.5)
      ctx.stroke()
    }
    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#fff'
    ctx.fillText(Math.round(r.water), x + TILE / 2, y + TILE / 2)
    if (!r.active) {
      ctx.font = '12px sans-serif'
      ctx.fillText('⏸', x + TILE / 2, y + 15)
    }
  }
}

// 建造/拆除模式下的悬停格高亮（绿可建 / 红不可建）
function drawHover() {
  if (!store.buildMode || !hover.value) return
  const { x, y } = hover.value
  if (x < 0 || x > 14 || y < 0 || y > 9) return
  const ok = store.buildMode === 'demolish'
    ? store.reservoirs.some((r) => r.x === x && r.y === y) || store.canals.some((c) => c.x === x && c.y === y)
    : canBuildAt(x, y)
  ctx.fillStyle = ok ? 'rgba(76,175,80,0.35)' : 'rgba(239,83,80,0.3)'
  ctx.fillRect(tile(x), tile(y), TILE, TILE)
  ctx.strokeStyle = ok ? '#4caf50' : '#ef5350'
  ctx.lineWidth = 2
  ctx.strokeRect(tile(x) + 1, tile(y) + 1, TILE - 2, TILE - 2)
  ctx.lineWidth = 1
}

// 前端可建性预判（最终以后端校验为准）
function canBuildAt(x, y) {
  if (x < 0 || x > 14 || y < 0 || y > 9) return false
  if (x <= 5 && y <= 5) return false
  for (const b of store.buildings) {
    if (x >= b.x && x <= b.x + 1 && y >= b.y && y <= b.y + 1) return false
  }
  if (y === 8 && x >= 8 && x <= 10) return false
  if (store.reservoirs.some((r) => r.x === x && r.y === y)) return false
  if (store.canals.some((c) => c.x === x && c.y === y)) return false
  return true
}

function drawBuildings() {
  const bdefs = {
    manure: { e: '🏠', w: 2, h: 2 },
    mill: { e: '⚙️', w: 2, h: 2 },
    barn: { e: '🐖', w: 2, h: 2 },
    market: { e: '🏪', w: 2, h: 2 }
  }
  const names = { 农舍: 'manure', 加工坊: 'mill', 畜棚: 'barn', 市场: 'market' }
  for (const b of store.buildings) {
    const d = bdefs[names[b.name]] || bdefs.manure
    const x = tile(b.x)
    const y = tile(b.y)
    ctx.fillStyle = 'rgba(120,80,40,0.25)'
    ctx.fillRect(x + 2, y + 2, TILE * d.w - 4, TILE * d.h - 4)
    ctx.strokeStyle = 'rgba(120,80,40,0.4)'
    ctx.strokeRect(x + 2, y + 2, TILE * d.w - 4, TILE * d.h - 4)
    ctx.font = (TILE * d.w) + 'px serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(d.e, x + TILE * d.w / 2, y + TILE * d.h / 2)
    // 名称 + 等级
    ctx.font = '12px sans-serif'
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    ctx.fillText(b.name + ' Lv.' + b.level, x + TILE * d.w / 2, y + TILE * d.h - 6)
    // 升级高亮
    ctx.fillStyle = '#ffd54f'
    ctx.fillText('🔧', x + TILE * d.w - 16, y + 12)
  }
}

function drawPlots() {
  for (const p of store.plots) {
    if (p.x > 5 || p.y > 5) continue
    const x = tile(p.x)
    const y = tile(p.y) + 30
    // 耕地底
    ctx.fillStyle = '#8d6e52'
    ctx.fillRect(x, y, TILE, TILE)
    ctx.strokeStyle = '#6d5139'
    ctx.strokeRect(x, y, TILE, TILE)
    const sel = store.selectedPlot?.id === p.id
    if (sel) {
      ctx.save()
      ctx.strokeStyle = '#ffd54f'
      ctx.lineWidth = 3
      ctx.strokeRect(x - 2, y - 2, TILE + 4, TILE + 4)
      ctx.restore()
    }
    if (p.crop_id) {
      const crop = store.crops.find((c) => c.id === p.crop_id)
      if (crop) drawCrop(x, y, p, crop)
    }
    // 状态标记
    if (p.crop_id) {
      drawStatus(x, y, p)
    }
    // 灌溉接入标记：💧 供水正常 / 🚱 断流
    if (p.irrigated) {
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(p.irr_ok ? '💧' : '🚱', x + 3, y + TILE - 4)
    }
  }
}

function drawCrop(x, y, plot, crop) {
  const full = plot.stage >= (crop.days - 1)
  const ratio = Math.min(plot.stage, crop.days - 1) / Math.max(crop.days - 1, 1)
  // 生长进度条
  const px = x + 4, py = y + 4, pw = TILE - 8
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(px, py, pw, 5)
  ctx.fillStyle = full ? '#ffd54f' : '#8bc34a'
  ctx.fillRect(px, py, pw * Math.max(ratio, 0.08), 5)
  // 作物图形随阶段变化
  const grown = ratio > 0.5
  ctx.font = (grown ? 26 : 16) + 'px serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (!grown) ctx.font = '20px serif'
  ctx.globalAlpha = 0.5 + ratio * 0.5
  ctx.fillText(grown || full ? crop.sprite : '🌱', x + TILE / 2, y + TILE / 2 + 4)
  ctx.globalAlpha = 1
  if (full) {
    ctx.font = '10px sans-serif'
    ctx.fillStyle = '#ffd54f'
    ctx.fillText('成熟', x + TILE / 2, y + TILE / 2 + 18)
  }
}

function drawStatus(x, y, p) {
  const ctxStatus = (val, color, dx) => {
    ctx.fillStyle = color
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(val <= 25 ? '⚠' + Math.round(val) : '' + Math.round(val), x + TILE / 2 + dx, y + TILE - 8)
  }
  // 状态指示三色小圆点
  const dot = (ok, dx) => {
    ctx.fillStyle = ok ? '#4caf50' : '#ef5350'
    ctx.beginPath(); ctx.arc(x + TILE / 2 + dx, y - 4, 4, 0, 7); ctx.fill()
  }
  dot(p.water >= 30, -12); dot(p.fert >= 30, 0); dot(p.light >= 30 && p.pest <= 0.6, 12)
}

function drawAnimals() {
  for (const a of store.animals) {
    const x = tile(a.x) + 6
    const y = tile(a.y) + 36
    const icons = { chicken: '🐔', cow: '🐄', sheep: '🐑' }
    const bob = Math.sin(time / 8 + a.id) * 3
    const scale = 1 + (a.feed < 40 ? -0.3 : 0)
    ctx.font = (22 * scale) + 'px serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.globalAlpha = Math.max(0.4, a.feed / 100)
    ctx.fillText(icons[a.species], x, y + bob)
    ctx.globalAlpha = 1
    if (a.ready) {
      ctx.font = '9px sans-serif'
      ctx.fillStyle = '#ffd54f'
      ctx.fillText('●可收集', x, y + 16)
    }
  }
}

function onClick(e) {
  const rect = cv.value.getBoundingClientRect()
  const gx = Math.floor(((e.clientX - rect.left) / rect.width) * W / TILE)
  const gy = Math.floor(((e.clientY - rect.top) / rect.height) * H / TILE)
  // 灌溉建设/拆除模式：点击空地放置，点击设施拆除
  if (store.buildMode === 'reservoir' || store.buildMode === 'canal') {
    store.buildIrr(store.buildMode, gx, gy)
    return
  }
  if (store.buildMode === 'demolish') {
    const r = store.reservoirs.find((r) => r.x === gx && r.y === gy)
    if (r) return store.demolishIrr('reservoir', r.id)
    const c = store.canals.find((c) => c.x === gx && c.y === gy)
    if (c) return store.demolishIrr('canal', c.id)
    return
  }
  // 点击灌溉设施：查看状态
  const res = store.reservoirs.find((r) => r.x === gx && r.y === gy)
  if (res) {
    store.showToast(`🛢️ 蓄水池 💦${Math.round(res.water)}/${res.capacity}${res.active ? '' : '（已停用）'}`, 'info')
    return
  }
  const can = store.canals.find((c) => c.x === gx && c.y === gy)
  if (can) {
    store.showToast(`〰️ 水渠 · ${!can.active ? '已停用' : can.flowing ? '通水中' : '断流（未连通或水量不足）'}`, 'info')
    return
  }
  // 地块选择（耕地绘制带 30px 偏移，沿用原换算）
  const yy = Math.floor(((e.clientY - rect.top) / rect.height) * (H - 30) / TILE)
  const plot = store.plots.find((p) => p.x === gx && p.y === yy && p.x <= 5 && p.y <= 5)
  if (plot) store.selectPlot(plot.id)
  else store.selectPlot(null)
}

function onMove(e) {
  const rect = cv.value.getBoundingClientRect()
  hover.value = {
    x: Math.floor(((e.clientX - rect.left) / rect.width) * W / TILE),
    y: Math.floor(((e.clientY - rect.top) / rect.height) * H / TILE)
  }
}

onMounted(() => {
  ctx = cv.value.getContext('2d')
  const loop = () => { draw(); raf = requestAnimationFrame(loop) }
  loop()
})
onBeforeUnmount(() => { cancelAnimationFrame(raf) })
</script>

<style scoped>
.canvas-wrap { position: relative; background: #bfe3ff; border-radius: 10px; overflow: hidden; }
canvas { display: block; width: 100%; height: auto; cursor: crosshair; }
canvas.building { cursor: copy; }
.map-tip {
  position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.6);
  color: #ffd54f; padding: 4px 10px; border-radius: 6px; font-size: 12px;
}
</style>