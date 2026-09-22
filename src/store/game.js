import { defineStore } from 'pinia'

async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opt.body = JSON.stringify(body)
  const r = await fetch('/api' + path, opt)
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || '请求失败')
  return data
}

export const useGameStore = defineStore('game', {
  state: () => ({
    loaded: false,
    player: null,
    crops: [],
    inventory: [],
    buildings: [],
    animals: [],
    plots: [],
    weather: null,
    weatherLog: [],
    recipes: [],
    productionJobs: [],
    queueCapacity: 0,
    queuedBatches: 0,
    reservoirs: [],
    canals: [],
    irrigation: null,
    irrigationLog: [],
    irrCosts: {},
    buildMode: null,          // 灌溉建设模式：reservoir/canal/demolish
    selectedPlot: null,
    seedMode: false,
    selectedCropId: null,
    toast: null,
    timeline: []
  }),
  getters: {
    seasonLabel: (s) => {
      const map = ['🌸 春', '☀️ 夏', '🍂 秋', '❄️ 冬']
      return s.player ? map[s.player.season % 4] : '🌸 春'
    },
    currentSeason: (s) => s.player?.season ?? 0
  },
  actions: {
    async load() {
      const d = await api('/state')
      this.player = d.player
      this.crops = d.crops
      this.inventory = d.inventory
      this.buildings = d.buildings
      this.animals = d.animals
      this.plots = d.plots
      this.weather = d.weather
      this.weatherLog = d.weatherLog || []
      this.recipes = d.recipes || []
      this.productionJobs = d.productionJobs || []
      this.queueCapacity = d.queueCapacity || 0
      this.queuedBatches = d.queuedBatches || 0
      this.reservoirs = d.reservoirs || []
      this.canals = d.canals || []
      this.irrigation = d.irrigation || null
      this.irrigationLog = d.irrigationLog || []
      this.irrCosts = d.irrCosts || {}
      // 刷新选中地块引用（plots 数组已整体替换）
      if (this.selectedPlot) {
        this.selectedPlot = this.plots.find((p) => p.id === this.selectedPlot.id) || null
      }
      this.loaded = true
    },
    pushLog(msg, type = 'info') {
      this.timeline.unshift({ msg, type, time: new Date().toLocaleTimeString('zh-CN') })
      if (this.timeline.length > 30) this.timeline.pop()
    },
    showToast(msg, type = 'info') {
      this.toast = { msg, type, id: Date.now() }
      this.pushLog(msg, type)
    },
    clearToast() { this.toast = null },

    async refresh() { await this.load() },

    async plant() {
      if (!this.selectedPlot || !this.selectedCropId) return
      try {
        await api('/plant', 'POST', { plotId: this.selectedPlot.id, cropId: this.selectedCropId })
        await this.load()
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async water() {
      if (!this.selectedPlot) return
      await api('/water', 'POST', { plotId: this.selectedPlot.id })
      await this.load()
    },
    async fertilize() {
      if (!this.selectedPlot) return
      await api('/fertilize', 'POST', { plotId: this.selectedPlot.id })
      await this.load()
    },
    async clean() {
      if (!this.selectedPlot) return
      await api('/clean', 'POST', { plotId: this.selectedPlot.id })
      await this.load()
    },
    async harvest() {
      if (!this.selectedPlot) return
      const r = await api('/harvest', 'POST', { plotId: this.selectedPlot.id })
      if (r.ok) this.showToast(`收获 ${r.yield} +${r.gold}金`, 'success')
      else this.showToast('作物还未成熟', 'warn')
      await this.load()
    },
    async nextDay(n = 1) {
      const r = await api('/skip', 'POST', { n })
      await this.load()
      const logs = r.logs || []
      // 天气结算记录只进时间线，不弹 toast；加工完工取第一条弹提示
      logs.forEach((m) => { if (!m.startsWith('✅')) this.pushLog(m, 'warn') })
      const done = logs.filter((m) => m.startsWith('✅'))
      if (done.length) this.showToast(done[0], 'success')
      else this.showToast(`时间 +${n} 天`, 'info')
    },
    async protect(gold, matQty) {
      try {
        await api('/weather/protect', 'POST', { gold, matQty })
        await this.load()
        this.showToast('已投入防护资源', 'success')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async buyMat(qty = 1) {
      try {
        await api('/buymat', 'POST', { qty })
        await this.load()
        this.showToast('已购入防灾物资', 'success')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async buySeed(cropId, qty = 1) {
      try {
        await api('/buyseed', 'POST', { cropId, qty })
        await this.load()
        this.showToast('已购买种子', 'success')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async sellCrop(cropId, qty = 1) {
      try {
        const r = await api('/sellcrop', 'POST', { cropId, qty })
        await this.load()
        this.showToast(`售出${r.sold}，+${r.gain}金`, 'success')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async buyAnimal(species) {
      try {
        await api('/animal', 'POST', { species })
        await this.load()
        this.showToast('已领养', 'success')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async feedAnimal(id) {
      await api('/feed', 'POST', { id })
      await this.load()
    },
    async collectAnimal(id) {
      try {
        const r = await api('/collect', 'POST', { id })
        await this.load()
        this.showToast(`收集 ${r.item} +${r.gold}金`, 'success')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    // 批量排产
    async enqueueProduction(recipeId, qty) {
      try {
        await api('/production/enqueue', 'POST', { recipeId, qty })
        await this.load()
        this.showToast(`已排产 ${qty} 批，开工后按天自动推进`, 'success')
      } catch (e) { this.showToast(e.message, 'warn'); throw e }
    },
    // 取消工单（退未开工批次的原料）
    async cancelProduction(id) {
      try {
        const r = await api('/production/cancel', 'POST', { id })
        await this.load()
        if (r.refundBatches > 0) this.showToast(`已取消，退回 ${r.refundBatches} 批原料`, 'info')
        else this.showToast('已取消（无未开工批次可退料）', 'info')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    // 完工入库：传 id 领单个，不传一键全领
    async collectProduction(id = null) {
      try {
        const r = await api('/production/collect', 'POST', id == null ? {} : { id })
        await this.load()
        const text = r.picked.map((p) => `${p.name}×${p.qty}`).join('、')
        this.showToast(`完工入库：${text}`, 'success')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async upgradeBuilding(id) {
      try {
        await api('/upgrade', 'POST', { id })
        await this.load()
        this.showToast('建筑升级成功', 'success')
      } catch (e) { this.showToast(e.message, 'warn') }
    },

    // ===== 灌溉 =====
    setBuildMode(m) { this.buildMode = this.buildMode === m ? null : m },
    async buildIrr(kind, x, y) {
      try {
        await api('/irrigation/build', 'POST', { kind, x, y })
        await this.load()
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async toggleIrr(kind, id) {
      try {
        const r = await api('/irrigation/toggle', 'POST', { kind, id })
        await this.load()
        this.showToast(r.active ? '已恢复启用' : '已停用（不再输水）', 'info')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async demolishIrr(kind, id) {
      try {
        const r = await api('/irrigation/demolish', 'POST', { kind, id })
        await this.load()
        this.showToast(`已拆除，返还 🪙${r.refund}`, 'info')
      } catch (e) { this.showToast(e.message, 'warn') }
    },
    async setPlotIrr(irrigated, priority = 1) {
      if (!this.selectedPlot) return
      try {
        await api('/irrigation/plot', 'POST', { plotId: this.selectedPlot.id, irrigated, priority })
        await this.load()
        this.showToast(irrigated ? '已接入灌溉网络' : '已断开灌溉', 'success')
      } catch (e) { this.showToast(e.message, 'warn') }
    },

    selectPlot(id) {
      this.selectedPlot = this.plots.find((p) => p.id === id) || null
    },
    setSeedMode(s) { this.seedMode = s }
  }
})