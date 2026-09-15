import { syncCrosshair, syncMarket } from '@/components/chart/common'
import {
  ensureIndexedProducts,
  indexedProducts,
  stripStableQuote
} from '@/services/productsService'
import store from '@/store'
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
    this.send('ready')
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
