/**
 * liquidation-terminal: pane titles are fixed and cannot be renamed.
 * The embedding app shows the chart's symbol in its own header, so the chart pane
 * carries no title of its own.
 */
export function fixedPaneName(paneId: string, type: string): string {
  if (paneId === 'liquidations') {
    return 'REKTS'
  }

  if (type === 'chart') {
    return ''
  }

  if (type === 'trades') {
    return 'SignificantTrades'
  }

  return type
}
