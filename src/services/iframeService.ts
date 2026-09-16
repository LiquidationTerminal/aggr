import { syncCrosshair, syncMarket } from '@/components/chart/common'
import {
  ensureIndexedProducts,
  indexedProducts,
  stripStableQuote
} from '@/services/productsService'
import store from '@/store'
import workspacesService from '@/services/workspacesService'
import { INFRAME } from '@/utils/constants'
import { subscribeOnce } from '../utils/store'

interface PaneSpec {
  /** explicit market ids, e.g. BINANCE_FUTURES:btcusdt */
  markets?: string[]
  /** coins to resolve from the product index, e.g. ETH */
  bases?: string[]
}

// Exchanges list low-priced coins as 1000PEPE, 1000000MOG, kPEPE (Hyperliquid)…
const normalizeBase = (base: string) =>
  String(base)
    .replace(/^k(?=[A-Z])/, '')
    .toUpperCase()
    .replace(/^(1000000|100000|10000|1000|100)(?=[A-Z])/, '')

// USD and USDT only (Bitfinex calls USDT "UST"); USDC books would roughly double the connections
const QUOTES = new Set(['USD', 'USDT', 'UST'])

/**
 * liquidation-terminal: markets for the given coins, shaped like the user's own BTC
 * workspace — perpetuals on every allowed exchange, spot only on `spotExchanges`.
 */
async function resolveBases(
  bases: string[],
  exchanges: string[],
  spotExchanges: string[]
) {
  await ensureIndexedProducts()
  const wanted = new Set(bases.map(normalizeBase))
  const allowed = new Set(exchanges)
  const spotAllowed = new Set(spotExchanges)
  const markets: string[] = []

  for (const exchangeId of Object.keys(indexedProducts)) {
    if (allowed.size && !allowed.has(exchangeId)) {
      continue
    }

    for (const product of indexedProducts[exchangeId]) {
      const typeAllowed =
        product.type === 'perp' ||
        (product.type === 'spot' && spotAllowed.has(exchangeId))

      if (
        typeAllowed &&
        wanted.has(normalizeBase(product.base)) &&
        QUOTES.has(String(product.quote).toUpperCase()) &&
        stripStableQuote(product.quote) === 'USD'
      ) {
        markets.push(product.id)
      }
    }
  }

  return markets
}

class IframeService {
  constructor() {
    this.initialize()
  }

  async initialize() {
    await subscribeOnce('app/SET_BOOTED')
    this.listen()
    // liquidation-terminal: hand the current audio level and timeframe over so the parent's controls start in sync
    this.send('ready', {
      audioVolume: store.state.settings.useAudio
        ? store.state.settings.audioVolume
        : 0,
      timeframe: this.chartTimeframe()
    })
  }

  /**
   * liquidation-terminal: the global settings the embedding app renders in its own widget
   * popover, plus which exchanges are connected.
   */
  globalSettings() {
    const settings = store.state.settings
    const exchanges = (
      store.getters['exchanges/getExchanges'] as string[]
    ).map(id => ({ id, disabled: !!store.state.exchanges[id].disabled }))

    return {
      exchanges,
      settings: {
        preferQuoteCurrencySize: settings.preferQuoteCurrencySize,
        aggregationLength: settings.aggregationLength,
        calculateSlippage: settings.calculateSlippage,
        disableAnimations: settings.disableAnimations,
        autoHideHeaders: settings.autoHideHeaders,
        autoHideNames: settings.autoHideNames,
        normalizeWatermarks: settings.normalizeWatermarks,
        showThresholdsAsTable: settings.showThresholdsAsTable,
        timezoneOffset: settings.timezoneOffset,
        backgroundColor: settings.backgroundColor,
        textColor: settings.textColor,
        buyColor: settings.buyColor,
        sellColor: settings.sellColor,
        audioVolume: settings.useAudio ? settings.audioVolume : 0,
        audioFilters: settings.audioFilters
      }
    }
  }

  /** liquidation-terminal: timeframe of the first chart pane, which the parent's control mirrors */
  chartTimeframe() {
    for (const paneId in store.state.panes.panes) {
      if (store.state.panes.panes[paneId].type === 'chart') {
        return store.state[paneId]?.timeframe
      }
    }

    return null
  }

  /** liquidation-terminal: hand the whole workspace over so the embedding app can back it up */
  async exportWorkspace() {
    const workspace = await workspacesService.getWorkspace()

    if (!workspace) {
      return
    }

    const copy = JSON.parse(JSON.stringify(workspace))

    if (copy.states && copy.states.panes) {
      delete copy.states.panes.marketsListeners
    }

    this.send('workspace', copy)
  }

  listen() {
    window.addEventListener('message', event => {
      if (
        !event.data ||
        typeof event.data !== 'string' ||
        !event.data.startsWith('{') ||
        !event.data.endsWith('}')
      ) {
        return
      }

      const json = JSON.parse(event.data)

      if (!json || !json.op) {
        return
      }

      switch (json.op) {
        case 'crosshair':
          syncCrosshair(json.data)
          break
        case 'market':
          syncMarket(json.data)
          break
        case 'panes':
          this.setPanesMarkets(json.data)
          break
        case 'openSettings':
          this.openSettings()
          break
        case 'getSettings':
          this.send('settings', this.globalSettings())
          break
        case 'setSetting':
          // liquidation-terminal: the embedding app renders aggr's global settings in its own
          // UI and drives them through the store's own mutations.
          store.commit(`settings/${json.data.mutation}`, json.data.value)
          this.send('settings', this.globalSettings())
          break
        case 'setColor':
          store.dispatch('settings/setColor', {
            type: json.data.type,
            value: json.data.value
          })
          this.send('settings', this.globalSettings())
          break
        case 'toggleExchange':
          store.dispatch('exchanges/toggleExchange', json.data.id).then(() => {
            this.send('settings', this.globalSettings())
          })
          break
        case 'setTimeframe':
          // liquidation-terminal: the embedding app owns the timeframe control. Commit the
          // mutation directly; the action reads window.event for its shift-key shortcut.
          for (const paneId in store.state.panes.panes) {
            if (store.state.panes.panes[paneId].type === 'chart') {
              store.commit(`${paneId}/SET_TIMEFRAME`, json.data?.timeframe)
            }
          }
          break
        case 'exportWorkspace':
          this.exportWorkspace()
          break
        case 'importWorkspace':
          workspacesService.addAndSetWorkspace(json.data)
          break
        case 'setAudio':
          // liquidation-terminal: the embedding page owns the audio control, including its
          // global mute. setAudioVolume also flips useAudio, so volume 0 turns sound off.
          store.dispatch('settings/setAudioVolume', Number(json.data?.volume) || 0)
          break
        case 'resumeAudio':
          // liquidation-terminal: the parent forwards its first user gesture. With
          // allow="autoplay" on the frame that activation lets this frame resume audio too;
          // audioService retries on focus, so replay a focus to run its normal resume flow.
          window.dispatchEvent(new Event('focus'))
          break
      }
    })
  }

  /** liquidation-terminal: the widget's gear button opens aggr's own settings dialog */
  async openSettings() {
    const [{ default: dialogService }, { default: SettingsDialog }] =
      await Promise.all([
        import('@/services/dialogService'),
        import('@/components/settings/SettingsDialog.vue')
      ])

    dialogService.open(SettingsDialog)
  }

  /**
   * liquidation-terminal: point individual panes at a set of coins.
   * { panes: { chart: { bases: ['ETH'] }, trades: { markets: [...], bases: ['SOL'] } }, exchanges: [...] }
   */
  async setPanesMarkets(data: {
    panes?: { [paneId: string]: PaneSpec }
    exchanges?: string[]
    spotExchanges?: string[]
  }) {
    const applied: { [paneId: string]: number } = {}

    for (const [paneId, spec] of Object.entries(data.panes || {})) {
      if (!store.state[paneId]) {
        continue
      }

      const resolved = spec.bases?.length
        ? await resolveBases(
            spec.bases,
            data.exchanges || [],
            data.spotExchanges || []
          )
        : []
      const markets = Array.from(new Set([...(spec.markets || []), ...resolved]))

      if (!markets.length) {
        continue
      }

      await store.dispatch('panes/setMarketsForPane', { id: paneId, markets })
      applied[paneId] = markets.length
    }

    this.send('panes', applied)
  }

  send(op: string, data?: any) {
    window.parent.postMessage(
      JSON.stringify({
        op,
        data
      }),
      '*'
    )
  }
}

export default INFRAME ? new IframeService() : null
