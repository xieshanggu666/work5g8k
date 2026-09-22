<template>
  <div class="canvas-wrap">
    <canvas ref="cv" :width="W" :height="H" @click="onClick"></canvas>
    <div class="map-tip" v-if="store.selectedPlot">
      已选中地块 ({{ store.selectedPlot.x }},{{ store.selectedPlot.y }}) · 点击其他耕地切换
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useGameStore } from '@/store/game'

const store = useGameStore()
const cv = ref(null)
const TILE = 60
const W = 900
const H = 620
let ctx = null
let raf = null
let time = 0

function tile(pos) { return pos * TILE }

function draw() {
  if (!ctx) return
  time++
  ctx.clearRect(0, 0, W, H)
  drawBackground()
  drawBuildings()
  drawPlots()
  drawAnimals()
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
  const xx = Math.floor(((e.clientX - rect.left) / rect.width) * W / TILE)
  const yy = Math.floor(((e.clientY - rect.top) / rect.height) * (H - 30) / TILE)
  const plot = store.plots.find((p) => p.x === xx && p.y === yy && p.x <= 5 && p.y <= 5)
  if (plot) store.selectPlot(plot.id)
  else store.selectPlot(null)
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
.map-tip {
  position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.6);
  color: #ffd54f; padding: 4px 10px; border-radius: 6px; font-size: 12px;
}
</style>