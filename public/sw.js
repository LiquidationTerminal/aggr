/* eslint-disable */

// liquidation-terminal: server push alerts were removed, so this worker only needs to exist
// (the app registers it for install/offline behaviour). The push and notificationclick
// handlers, and their link back to aggr.trade, are gone.
self.addEventListener('fetch', event => {})
